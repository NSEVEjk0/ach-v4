// Provision fresh, faucet-funded ACH v4 accounts. Existing identities are never
// replaced, and legacy ACH balances are never used as a deployment funding pool.
import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import { Account, KeyPair, JsonRpcProvider, actions } from '../packages/client/dist/near.js';
import { V4RpcProvider } from '../packages/client/dist/v4.js';
import { StateStore } from '../services/lib/store.mjs';
import { durableActions } from '../services/lib/transactions.mjs';
import {privateRoot,privatePath,manifestPath} from '../services/lib/paths.mjs';
import {requireFreshAccounts}from '../services/lib/workflow.mjs';

const directory = privateRoot;
mkdirSync(directory, { recursive: true, mode: 0o700 });
if(process.argv.includes('--refill-sponsor')||process.argv.includes('--refill-vault-storage')){
  const storageRefill=process.argv.includes('--refill-vault-storage'),prefix=storageRefill?'vault-storage-refill':'sponsor-refill',count=storageRefill?2:3;
  const config=JSON.parse(readFileSync(manifestPath,'utf8')),root=JSON.parse(readFileSync(privatePath('root.json'),'utf8'));
  requireFreshAccounts(config);
  if(config.network!=='testnet'||config.token_has_monetary_value!==false||config.status!=='deployed'||root.role!=='sponsor'||!root.account_id.endsWith('.testnet'))throw new Error('TESTNET_SPONSOR_REFILL_ONLY');
  if(root.account_id!==config.root)throw new Error('ROOT_IDENTITY_NAMESPACE_MISMATCH');
  const recipient=storageRefill?config.vault:root.account_id;
  const provider=new V4RpcProvider(config.rpc_urls??config.rpc_url),day=new Date().toISOString().slice(0,10).replaceAll('-',''),suffix=root.account_id.match(/([a-f\d]{8})\.testnet$/)?.[1];
  if(!suffix)throw new Error('SPONSOR_NAMESPACE_REQUIRED');
  const journal=new StateStore(privatePath(prefix+'.sqlite'));
  try{for(let index=0;index<count;index++){
    const account_id=`ach-${storageRefill?'storage':'native'}-${day}-${index}-${suffix}.testnet`,filename=privatePath(`${prefix}-${day}-${index}.json`);
    let identity;
    if(existsSync(filename))identity=JSON.parse(readFileSync(filename,'utf8'));
    else{const key=KeyPair.fromRandom('ed25519');identity={account_id,secret_key:key.toString(),public_key:key.getPublicKey().toString()};writeFileSync(filename,JSON.stringify(identity),{mode:0o600,flag:'wx'});}
    if(identity.account_id!==account_id)throw new Error('SPONSOR_REFILL_IDENTITY_CONFLICT');
    try{await provider.viewAccount({accountId:account_id,blockQuery:{finality:'final'}});}catch(error){
      if(!/UNKNOWN_ACCOUNT|does not exist/.test(JSON.stringify(error)+error.message))throw error;
      const response=await fetch('https://helper.testnet.near.org/account',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({newAccountId:account_id,newAccountPublicKey:identity.public_key}),signal:AbortSignal.timeout(30000)});
      if(!response.ok)throw new Error('TESTNET_SPONSOR_FAUCET_'+response.status);
      const receipt=await response.json();if(receipt.error)throw new Error('TESTNET_SPONSOR_FAUCET_REJECTED');
      writeFileSync(privatePath(`${prefix}-faucet-${day}-${index}.json`),JSON.stringify(receipt),{mode:0o600});
    }
    for(let attempt=0;attempt<20;attempt++){
      try{await provider.viewAccessKey({accountId:account_id,publicKey:identity.public_key,finalityQuery:{finality:'final'}});break;}
      catch(error){if(!/AccessKeyDoesNotExist|AccountDoesNotExist/.test(error.name))throw error;if(attempt===19)throw new Error('SPONSOR_FAUCET_FINALITY_UNCONFIRMED');await new Promise(resolve=>setTimeout(resolve,1000));}
    }
    const result=await durableActions(new Account(account_id,provider,identity.secret_key),journal,'refill:'+account_id,recipient,[actions.transfer(9_500_000_000_000_000_000_000_000n)]);
    console.log(JSON.stringify({phase:'testnet-'+prefix,index:index+1,native_units:'9500000000000000000000000',tx_hash:result.tx_hash,visitor_charge:false}));
  }}finally{journal.close();}
  console.log(JSON.stringify({[prefix]:'passed',daily_native_cap:(BigInt(count)*9_500_000_000_000_000_000_000_000n).toString(),recipient,customer_tokens_used:false}));process.exit(0);
}
const planFile = path.join(directory, 'accounts.json');
let plan;
if (existsSync(planFile)) plan = JSON.parse(readFileSync(planFile, 'utf8'));
else {
  const suffix = randomBytes(4).toString('hex');
  plan = { network: 'testnet', workflow_revision:2, rpc_url: 'https://test.rpc.fastnear.com', root: `ach-v4r2-demo-${suffix}.testnet`, vault: `ach-vault-v4r2-${suffix}.testnet`, token: `ach-usdc-v4r2-${suffix}.testnet` };
  writeFileSync(planFile, JSON.stringify(plan, null, 2), { mode: 0o600, flag: 'wx' });
}
requireFreshAccounts(plan);
const provider = new JsonRpcProvider({ url: plan.rpc_url });
for (const role of ['root', 'vault', 'token']) {
  const filename = path.join(directory, `${role}.json`);
  let identity;
  if (existsSync(filename)) identity = JSON.parse(readFileSync(filename, 'utf8'));
  else {
    const key = KeyPair.fromRandom('ed25519');
    identity = { account_id: plan[role], secret_key: key.toString(), public_key: key.getPublicKey().toString(), role: role === 'root' ? 'sponsor' : 'deployer' };
    writeFileSync(filename, JSON.stringify(identity), { mode: 0o600, flag: 'wx' });
  }
  if (identity.account_id !== plan[role]) throw new Error('DEPLOYMENT_IDENTITY_CONFLICT');
  let account;
  try { account = await provider.viewAccount({ accountId: identity.account_id, blockQuery: { finality: 'final' } }); }
  catch (error) {
    if (!JSON.stringify(error).includes('UNKNOWN_ACCOUNT') && !/does not exist/.test(error.message)) throw new Error('ACCOUNT_LOOKUP_UNCONFIRMED');
    const response = await fetch('https://helper.testnet.near.org/account', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ newAccountId: identity.account_id, newAccountPublicKey: identity.public_key }), signal: AbortSignal.timeout(30_000) });
    if (!response.ok) throw new Error(`TESTNET_FAUCET_${response.status}`);
    const receipt = await response.json();
    writeFileSync(path.join(directory, `faucet-${role}.json`), JSON.stringify(receipt, null, 2), { mode: 0o600 });
    if (receipt.error) throw new Error('TESTNET_FAUCET_REJECTED');
    for (let attempt = 0; attempt < 20; attempt++) {
      try { account = await provider.viewAccount({ accountId: identity.account_id, blockQuery: { finality: 'final' } }); break; }
      catch { await new Promise(resolve => setTimeout(resolve, 1000)); }
    }
    if (!account) throw new Error('FAUCET_ACCOUNT_NOT_CONFIRMED');
  }
  await provider.viewAccessKey({ accountId: identity.account_id, publicKey: identity.public_key, blockQuery: { finality: 'final' } });
  console.log(JSON.stringify({ role, account_id: identity.account_id, native_balance: account.amount.toString(), keys_saved_privately: true }));
}
