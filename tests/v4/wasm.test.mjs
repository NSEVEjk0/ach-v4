import test from 'node:test';
import assert from 'node:assert/strict';
import { WasmChain, artifacts } from './wasm-chain.mjs';
import { AchV4Client, v4InvoiceHash, v4RoundHash, v4ChargeId } from '../../packages/client/dist/v4.js';

const vault = 'vault.ach-v4.testnet', token = 'usd.ach-v4.testnet', coordinator = 'desk.ach-v4.testnet';
const deployment = { protocol_version: 4, network: 'testnet', vault, token, decimals: 6, rpc_url: 'https://test.rpc.fastnear.com' };
const members = ['research.ach-v4.testnet', 'visual.ach-v4.testnet', 'audit.ach-v4.testnet'];
const methods = ['propose_invoice','accept_invoice','propose_round','authorize_round','cancel_round_authorization','settle_round','expire_round','release_stale_round','cancel_invoice_by_agreement'];
async function setup() {
  const chain = new WasmChain(); await chain.deploy(vault, artifacts.vault); await chain.deploy(token, artifacts.token);
  await chain.invoke(vault, 'init', { network:'testnet', token, owner_id:coordinator, coordinator_id:coordinator, private_worker:null });
  await chain.invoke(token, 'init', { owner_id:coordinator });
  await chain.invoke(token, 'storage_deposit', { account_id:vault });
  const clients = [], owners = [];
  for (const [index, account] of [...members, coordinator].entries()) {
    const key = String(index+1).repeat(64); const ownerKey = 'f'.repeat(64);
    chain.addKey(account,key,{methods,receiver:vault});chain.addKey(account,ownerKey,{owner:true});
    const owner = new AchV4Client(deployment,chain.transport(account,ownerKey,{owner:true}),'owner');
    await owner.register(account);await owner.setPolicy({key,max_invoice:'100000',gross_budget:'1000000',max_net_commitment:'1000000',expires_at_ms:chain.now+86_400_000,counterparties:[],services:[]},`policy:${account}`);
    clients.push(new AchV4Client(deployment,chain.transport(account,key)));owners.push(owner);
    await chain.invoke(token,'storage_deposit',{account_id:account});
  }
  return {chain,clients,owners};
}
test('actual Wasm exports and TypeScript agree on all hashes; token callbacks settle a real service-price cycle', async () => {
  const {chain,clients,owners}=await setup();
  await chain.invoke(token,'mint',{account_id:members[0],amount:'20000'},{account:coordinator,deposit:1n});
  const deposit=await owners[0].deposit('minimal','20000');assert.equal(deposit.value,'20000');
  const bills=[];
  for(const [index,[buyer,seller,amount]]of [[0,1,'100000'],[1,2,'100000'],[2,0,'80000']].entries()){
    const spec={id:`bill-${index}`,purchase_id:`purchase-${index}`,terms_version:1,buyer:members[buyer],seller:members[seller],asset:token,amount,service:'research',terms_hash:'a'.repeat(64),artifact_hash:'b'.repeat(64),ready_at_ms:chain.now,expires_at_ms:chain.now+100_000};
    let invoice=(await clients[seller].proposeInvoice(spec)).value;
    assert.equal(invoice.hash,v4InvoiceHash(deployment,spec));assert.equal(invoice.charge_id,v4ChargeId(deployment,spec));
    await clients[buyer].acceptInvoice(invoice);await clients[seller].acceptInvoice(invoice);bills.push(invoice);
  }
  let round=(await clients[0].proposeRound('actual-wasm',bills.map(i=>i.spec.id),chain.now+30_000)).value;
  assert.equal(round.hash,v4RoundHash(deployment,round.input));
  for(let i=0;i<3;i++)round=(await clients[i].authorizeRound(round,round.input.positions.find(p=>p.account_id===members[i]).net)).value;
  assert.equal(round.status,'READY');await assert.rejects(clients[0].cancelRound(round),/IRREVOCABLE/);
  await clients[2].settleRound(round);await clients[0].settleRound(round);
  assert.equal((await clients[0].balance()).balance,'0');assert.equal((await clients[1].balance()).balance,'0');assert.equal((await clients[2].balance()).balance,'20000');
  const backing=await chain.invoke(vault,'get_backing_status',{});const custody=await chain.invoke(token,'ft_balance_of',{account_id:vault});assert.equal(backing.value.tracked_token_custody,custody.value);
  await owners[2].withdraw('take-receipt','20000');assert.equal((await owners[2].withdrawal('take-receipt')).status,'COMPLETED');assert.equal((await owners[2].balance()).balance,'0');
  assert.equal((await chain.invoke(token,'ft_balance_of',{account_id:members[2]})).value,'20000');
});
test('authenticated token transfer failure refunds; forged credit and trading-key administration fail',async()=>{
 const {chain,clients,owners}=await setup();
 await assert.rejects(chain.invoke(vault,'ft_on_transfer',{sender_id:members[0],amount:'100',msg:'deposit'},{account:members[0]}),/TOKEN_CALLBACK_ONLY/);
 await assert.rejects(clients[0].withdraw('bad-owner','1'),/OWNER_SIGNER_REQUIRED/);
 await chain.invoke(token,'mint',{account_id:members[0],amount:'100000'},{account:coordinator,deposit:1n});await owners[0].deposit('cash','100000');chain.failTransfer=true;
 await owners[0].withdraw('fails','100000');assert.equal((await owners[0].withdrawal('fails')).status,'RESTORED');assert.equal((await owners[0].balance()).balance,'100000');
 chain.failTransfer=false;await owners[0].withdraw('works','100000');assert.equal((await owners[0].withdrawal('works')).status,'COMPLETED');
 assert.equal((await chain.invoke(token,'ft_balance_of',{account_id:members[0]})).value,'100000');
});
export {setup, deployment,members};
