import assert from 'node:assert/strict';
import {readFileSync,writeFileSync,existsSync}from 'node:fs';
import {randomBytes}from 'node:crypto';
import {Account,KeyPair,actions,SignedTransaction}from '../../packages/client/dist/near.js';
import {AchV4Client,V4NearTransport,V4RpcProvider,v4Digest,v4InvoiceHash}from '../../packages/client/dist/v4.js';
import {StateStore}from '../../services/lib/store.mjs';
import {durableActions}from '../../services/lib/transactions.mjs';
import {privatePath,manifestPath}from '../../services/lib/paths.mjs';
const config=JSON.parse(readFileSync(manifestPath,'utf8'));assert.equal(config.network,'testnet','BOUNDED_TESTNET_FIXTURE_ONLY');
const file=privatePath('gas-fixture-identities.json'),rootIdentity=JSON.parse(readFileSync(privatePath('root.json'),'utf8'));
const save=(file,value)=>writeFileSync(file,JSON.stringify(value,null,2),{mode:0o600});
let fixture;if(existsSync(file))fixture=JSON.parse(readFileSync(file,'utf8'));else{
 const seed=randomBytes(8).toString('hex');fixture={seed,created_at_ms:Date.now(),identities:[]};
 for(let n=0;n<12;n++){const prefix=`g${String(n).padStart(2,'0')}-${seed.slice(0,8)}`,label=prefix.padEnd(63-rootIdentity.account_id.length,'x'),key=KeyPair.fromRandom('ed25519');fixture.identities.push({account_id:label+'.'+rootIdentity.account_id,secret_key:key.toString(),public_key:key.getPublicKey().toString()});}
 save(file,fixture);
}
const journal=new StateStore(privatePath('gas-fixtures.sqlite')),provider=new V4RpcProvider(config.rpc_urls??config.rpc_url),root=new Account(rootIdentity.account_id,provider,rootIdentity.secret_key);
const reportFile=privatePath('gas.json'),report=existsSync(reportFile)?JSON.parse(readFileSync(reportFile,'utf8')):{kind:'bounded-testnet-financial-fixtures',vault:config.vault,code_hash:config.code_hash,source_service_work:false,participant_limit:12,invoice_limit:48,native_account_funding_cap:'3360000000000000000000000',rounds:[],passed:false};
assert.equal(report.vault,config.vault);
const clients=fixture.identities.map(i=>new AchV4Client(config,new V4NearTransport(i.account_id,config.rpc_urls??config.rpc_url,i.secret_key,journal),'owner'));
if(process.argv.includes('--diagnose')){
 try{for(const row of journal.db.prepare('SELECT data FROM operations').all()){
  const op=JSON.parse(row.data);if(!['SIGNED','UNKNOWN'].includes(op.state))continue;
  try{await provider.sendTransactionUntil(SignedTransaction.decode(Buffer.from(op.signed_transaction,'base64')),'FINAL');console.log(JSON.stringify({phase:'gas-operation-diagnostic',id:op.id,state:'included'}));}
  catch(error){console.log(JSON.stringify({phase:'gas-operation-diagnostic',id:op.id,name:error.name,type:error.type,cause:error.cause,codes:String(error.message).match(/\b[A-Z][A-Z_\d]{5,}\b/g),message:String(error.message).slice(0,180)}));}
 }}finally{journal.close();}process.exit(0);
}
const measured=result=>({tx_hash:result.tx_hash,gas_burnt:result.gas_burnt,tokens_burnt:result.tokens_burnt});
async function confirmed(work){for(let n=0;n<6;n++){try{return await work();}catch(error){if(!/UNAVAILABLE|confirmation is unknown/.test(error.message)||n===5)throw error;console.log(JSON.stringify({phase:'gas-transaction-reconciliation',state:'waiting'}));await new Promise(r=>setTimeout(r,3000));}}}
async function batch(id,identity,batchActions){return confirmed(()=>durableActions(new Account(identity.account_id,provider,identity.secret_key),journal,id,config.vault,batchActions));}
try{
 // The sponsor's account-creation key has one writer. Await free-session setup.
 const sessions=new StateStore(privatePath('coordinator.sqlite'));
 try{for(let n=0;;n++){if(sessions.pendingSessions().every(s=>s.state==='READY'))break;if(n>240)throw new Error('SPONSOR_PROVISIONING_STILL_ACTIVE');if(n%20===0)console.log(JSON.stringify({phase:'gas-waits-for-wallet-setup',state:'waiting'}));await new Promise(r=>setTimeout(r,2000));}}finally{sessions.close();}
 for(let n=0;n<12;n++){
  const i=fixture.identities[n];await confirmed(()=>durableActions(root,journal,'gas-account:'+n,i.account_id,[actions.createAccount(),actions.transfer(180_000_000_000_000_000_000_000n),actions.addFullAccessKey(KeyPair.fromString(i.secret_key).getPublicKey())]));
  await confirmed(()=>durableActions(root,journal,'gas-prepaid-headroom:'+n,i.account_id,[actions.transfer(100_000_000_000_000_000_000_000n)]));
  await confirmed(()=>clients[n].register(('Explicit scale fixture '+n).padEnd(64,'.'),'gas-register:'+n));
 }
 const before=await provider.callFunction({contractId:config.vault,method:'get_config',args:{},blockQuery:{finality:'final'}});
 report.history_before={accounts:before.accounts,invoices:before.invoices,rounds:before.rounds};
 // Two complete maximum-size rounds accumulate 96 bounded fixture invoices.
 // Owner-consented invoices are labelled as fixtures and contain no service work.
 for(let roundIndex=0;roundIndex<2;roundIndex++){
  if(report.rounds.some(r=>r.fixture_index===roundIndex))continue;
  const amount=((1n<<100n)-1n)/96n;
  const specs=Array.from({length:48},(_,index)=>{const buyer=index%12,seller=(buyer+1)%12,unique=`scale-fixture-${fixture.seed}-${roundIndex}-${index}`;return{id:unique.padEnd(96,'i'),purchase_id:unique.padEnd(96,'p'),terms_version:1,buyer:fixture.identities[buyer].account_id,seller:fixture.identities[seller].account_id,asset:config.token,amount:amount.toString(),service:'explicit-no-service-scale-fixture'.padEnd(96,'s'),terms_hash:v4Digest('maximum-record-financial-fixture'),artifact_hash:v4Digest('no-delivery-scale-fixture'),ready_at_ms:fixture.created_at_ms,expires_at_ms:fixture.created_at_ms+7200000};});
  for(let buyer=0;buyer<12;buyer++){
   const own=specs.filter(i=>i.buyer===fixture.identities[buyer].account_id),calls=own.flatMap(spec=>[actions.functionCall('propose_invoice',{spec},25_000_000_000_000n,1n),actions.functionCall('accept_invoice',{id:spec.id,expected_hash:v4InvoiceHash(config,spec)},25_000_000_000_000n,1n)]);
   await batch(`gas-invoices:${roundIndex}:${buyer}`,fixture.identities[buyer],calls);
   if(buyer%3===0)console.log(JSON.stringify({phase:'gas-fixture-invoices',round:roundIndex+1,accepted_buyers:buyer+1}));
  }
  for(let seller=0;seller<12;seller++)await batch(`gas-sellers:${roundIndex}:${seller}`,fixture.identities[seller],specs.filter(i=>i.seller===fixture.identities[seller].account_id).map(spec=>actions.functionCall('accept_invoice',{id:spec.id,expected_hash:v4InvoiceHash(config,spec)},25_000_000_000_000n,1n)));
  const roundId=`scale-round-${fixture.seed}-${roundIndex}`.padEnd(96,'r'),existing=await journal.get('round:'+roundId),deadline=existing?JSON.parse(Buffer.from((await import('../../packages/client/dist/near.js')).SignedTransaction.decode(Buffer.from(existing.signed_transaction,'base64')).transaction.actions[0].functionCall.args)).deadline_ms:Date.now()+600000;
  const proposed=await confirmed(()=>clients[0].proposeRound(roundId,specs.map(i=>i.id),deadline));const round=proposed.value;assert.equal(round.input.positions.length,12);assert.equal(round.net_settlement_volume,'0');
  const approvals=[];for(let start=0;start<12;start+=3)approvals.push(...await Promise.all(clients.slice(start,start+3).map(client=>confirmed(()=>client.authorizeRound(round,'0')))));
  const ready=await confirmed(()=>clients[0].round(roundId));assert.ok(['READY','SETTLED'].includes(ready.status));const settled=await confirmed(()=>clients[0].settleRound(ready));assert.equal(settled.value.status,'SETTLED');
  const history=await provider.callFunction({contractId:config.vault,method:'get_config',args:{},blockQuery:{finality:'final'}}),storage=await provider.viewAccount({accountId:config.vault,blockQuery:{finality:'final'}});
  const record={fixture_index:roundIndex,round_id:roundId,participants:12,invoices:48,record_id_bytes:96,participant_id_bytes:64,amount_digits:amount.toString().length,zero_funding:true,propose:measured(proposed),approvals:approvals.map(measured),settle:measured(settled),accumulated_invoices:history.invoices,storage_bytes:storage.storage_usage};
  const max=[proposed,...approvals,settled].reduce((m,r)=>BigInt(r.gas_burnt)>m?BigInt(r.gas_burnt):m,0n);record.maximum_operation_gas=max.toString();assert.ok(max<90_000_000_000_000n,'MAXIMUM_SIZE_EXCEEDS_CONSERVATIVE_GAS_MARGIN');
  report.rounds.push(record);save(reportFile,report);console.log(JSON.stringify({phase:'maximum-gas-fixture',round:roundIndex+1,state:'passed',maximum_tgas:Number(max)/1e12,accumulated_invoices:history.invoices}));
 }
 const backing=await provider.callFunction({contractId:config.vault,method:'get_backing_status',args:{},blockQuery:{finality:'final'}});assert.equal(backing.claims_equal_tracked_custody,true);report.backing=backing;report.passed=true;report.finished_at=new Date().toISOString();save(reportFile,report);
 const updated=JSON.parse(readFileSync(manifestPath,'utf8'));updated.limits.gas_verified=true;updated.limits.gas_evidence='gas.json';save(manifestPath,updated);
 console.log(JSON.stringify({gas_limit_verification:'passed',fixture_service_activity:false,limits:{participants:12,invoices:48},repository_pushed:false}));
}finally{journal.close();}
