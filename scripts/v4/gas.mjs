import assert from 'node:assert/strict';
import {readFileSync,writeFileSync,existsSync}from 'node:fs';
import {randomBytes}from 'node:crypto';
import {Account,KeyPair,actions,SignedTransaction}from '../../packages/client/dist/near.js';
import {AchV4Client,V4NearTransport,V4RpcProvider,v4Digest,v4InvoiceHash}from '../../packages/client/dist/v4.js';
import {StateStore}from '../../services/lib/store.mjs';
import {durableActions}from '../../services/lib/transactions.mjs';
import {privatePath,manifestPath}from '../../services/lib/paths.mjs';
import {requireServiceLayout}from '../../services/lib/workflow.mjs';
import {scaleFixture}from './scale-fixture.mjs';
const config=JSON.parse(readFileSync(manifestPath,'utf8'));assert.equal(config.network,'testnet','BOUNDED_TESTNET_FIXTURE_ONLY');
requireServiceLayout(config);
const file=privatePath('gas-fixture-identities.json'),rootIdentity=JSON.parse(readFileSync(privatePath('root.json'),'utf8'));
assert.equal(rootIdentity.account_id,config.root,'ROOT_IDENTITY_NAMESPACE_MISMATCH');
if(existsSync(privatePath('supervisor.pid'))){
 const pid=Number(readFileSync(privatePath('supervisor.pid'),'utf8'));if(!Number.isSafeInteger(pid)||pid<=1)throw new Error('INVALID_SUPERVISOR_PID');
 try{process.kill(pid,0);throw new Error('STOP_CANDIDATE_SERVICES_FOR_EXCLUSIVE_SPONSOR_SIGNER');}catch(error){if(error.code!=='ESRCH')throw error;}
}
const save=(file,value)=>writeFileSync(file,JSON.stringify(value,null,2),{mode:0o600});
let fixture;if(existsSync(file))fixture=JSON.parse(readFileSync(file,'utf8'));else{
 const seed=randomBytes(8).toString('hex');fixture={workflow_revision:2,seed,created_at_ms:Date.now(),registration_deadline_ms:Date.now()+86400000,round_deadlines:{},identities:[]};
 for(let n=0;n<12;n++){const prefix=`g${String(n).padStart(2,'0')}-${seed.slice(0,8)}`,label=prefix.padEnd(63-rootIdentity.account_id.length,'x'),key=KeyPair.fromRandom('ed25519');fixture.identities.push({account_id:label+'.'+rootIdentity.account_id,secret_key:key.toString(),public_key:key.getPublicKey().toString()});}
 save(file,fixture);
}
assert.equal(fixture.workflow_revision,2,'FRESH_GAS_FIXTURE_REQUIRED');
const journal=new StateStore(privatePath('gas-fixtures.sqlite')),provider=new V4RpcProvider(config.rpc_urls??config.rpc_url),root=new Account(rootIdentity.account_id,provider,rootIdentity.secret_key);
const reportFile=privatePath('gas.json'),report=existsSync(reportFile)?JSON.parse(readFileSync(reportFile,'utf8')):{kind:'bounded-testnet-financial-fixtures',workflow_revision:2,vault:config.vault,code_hash:config.code_hash,source_service_work:false,participant_limit:12,invoice_limit:48,native_account_funding_cap:'9360000000000000000000000',rounds:[],passed:false};
assert.equal(report.vault,config.vault);
assert.equal(report.workflow_revision,2,'FRESH_GAS_REPORT_REQUIRED');assert.equal(report.code_hash,config.code_hash);
report.native_account_funding_cap='9360000000000000000000000';
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
async function batch(id,identity,batchActions){
 const result=await confirmed(()=>durableActions(new Account(identity.account_id,provider,identity.secret_key),journal,id,config.vault,batchActions));
 const status=await provider.viewTransactionStatus({txHash:result.tx_hash,accountId:identity.account_id,waitUntil:'FINAL'});
 assert.equal(status.final_execution_status,'FINAL');assert.ok(status.status?.SuccessValue!==undefined);
 const outcomes=[status.transaction_outcome,...status.receipts_outcome].map(record=>record.outcome);
 return{...result,gas_burnt:outcomes.reduce((sum,outcome)=>sum+BigInt(outcome.gas_burnt),0n).toString(),tokens_burnt:outcomes.reduce((sum,outcome)=>sum+BigInt(outcome.tokens_burnt),0n).toString()};
}
try{
 const sponsorClient=new AchV4Client(config,new V4NearTransport(rootIdentity.account_id,config.rpc_urls??config.rpc_url,rootIdentity.secret_key,journal),'owner');
 await sponsorClient.assertDeployment();
 // The candidate supervisor must be stopped: account creation and sponsorship
 // share its root signer. Historical services are never stopped by this script.
 const sessions=new StateStore(privatePath('coordinator.sqlite'));
 try{for(let n=0;;n++){if(sessions.pendingSessions().every(s=>s.state==='READY'))break;if(n>240)throw new Error('SPONSOR_PROVISIONING_STILL_ACTIVE');if(n%20===0)console.log(JSON.stringify({phase:'gas-waits-for-wallet-setup',state:'waiting'}));await new Promise(r=>setTimeout(r,2000));}}finally{sessions.close();}
 for(let n=0;n<12;n++){
  const i=fixture.identities[n];await confirmed(()=>durableActions(root,journal,'gas-account:'+n,i.account_id,[actions.createAccount(),actions.transfer(180_000_000_000_000_000_000_000n),actions.addFullAccessKey(KeyPair.fromString(i.secret_key).getPublicKey())]));
  await confirmed(()=>durableActions(root,journal,'gas-prepaid-headroom:'+n,i.account_id,[actions.transfer(100_000_000_000_000_000_000_000n)]));
  // NEAR reserves a higher gas price before inclusion than its current price.
  // Keep these explicit maximum-size fixture signers above that prepayment.
  await confirmed(()=>durableActions(root,journal,'gas-seller-prepaid-headroom:'+n,i.account_id,[actions.transfer(500_000_000_000_000_000_000_000n)]));
  await confirmed(()=>sponsorClient.sponsorAccount(i.account_id,('Explicit scale fixture '+n).padEnd(64,'.'),fixture.registration_deadline_ms,'gas-registration-sponsorship:'+n));
  await confirmed(()=>clients[n].register(('Explicit scale fixture '+n).padEnd(64,'.'),'gas-register:'+n));
 }
 const before=await provider.callFunction({contractId:config.vault,method:'get_config',args:{},blockQuery:{finality:'final'}});
 report.history_before={accounts:before.accounts,invoices:before.invoices,rounds:before.rounds};
 // Two complete maximum-size rounds accumulate 96 bounded fixture invoices.
 // Owner-consented invoices are labelled as fixtures and contain no service work.
 for(let roundIndex=0;roundIndex<2;roundIndex++){
  if(report.rounds.some(r=>r.fixture_index===roundIndex))continue;
  fixture.round_attempts??={};let attempt=fixture.round_attempts[roundIndex]??0;
  if(!fixture.round_deadlines[roundIndex]){fixture.round_deadlines[roundIndex]=Date.now()+600000;save(file,fixture);}
  let inputs=scaleFixture(config,{...fixture,seed:fixture.seed+(attempt?'-a'+attempt:'')},roundIndex,fixture.round_deadlines[roundIndex]);
  let prior;
  try{prior=await clients[0].purchaseGroup(inputs.input.id);}catch(error){if(!String(error.message).includes('PURCHASE_GROUP_NOT_FOUND'))throw error;}
  if(prior&&['PROPOSED','COLLECTING','FUNDED','EXPIRED'].includes(prior.status)&&prior.input.deadline_ms<=Date.now()){
   if(prior.status!=='EXPIRED')await confirmed(()=>clients[0].expirePurchaseGroup(prior.input.id));
   report.expired_attempts??=[];report.expired_attempts.push({fixture_index:roundIndex,attempt,group_id:prior.input.id,reason:'expired-incomplete-financial-fixture'});save(reportFile,report);
   attempt++;assert.ok(attempt<=3,'BOUNDED_SCALE_FIXTURE_RETRY_REQUIRED');fixture.round_attempts[roundIndex]=attempt;fixture.round_deadlines[roundIndex]=Date.now()+600000;save(file,fixture);
   inputs=scaleFixture(config,{...fixture,seed:fixture.seed+'-a'+attempt},roundIndex,fixture.round_deadlines[roundIndex]);
  }
  const{input,specs,amount}=inputs,attemptId=attempt?':a'+attempt:'';
  const proposed=await confirmed(()=>clients[0].proposePurchaseGroup(input));
  let group=proposed.value;assert.equal(group.input.positions.length,12);assert.ok(group.input.positions.every(position=>position.net==='0'));
  const approvals=await Promise.all(clients.map(client=>confirmed(()=>client.authorizePurchaseGroup(group,'0'))));
  group=await clients[0].purchaseGroup(input.id);
  assert.ok(['FUNDED','READY','SETTLED'].includes(group.status));
  const receiptBatches=await Promise.all(Array.from({length:12},async(_,buyer)=>{
   const own=specs.filter(i=>i.buyer===fixture.identities[buyer].account_id),calls=own.flatMap(spec=>[actions.functionCall('propose_invoice',{spec},25_000_000_000_000n,1n),actions.functionCall('accept_invoice',{id:spec.id,expected_hash:v4InvoiceHash(config,spec)},25_000_000_000_000n,1n)]);
   return batch(`gas-invoices:${roundIndex}:${buyer}${attemptId}`,fixture.identities[buyer],calls);
  }));
  console.log(JSON.stringify({phase:'gas-fixture-invoices',round:roundIndex+1,accepted_buyers:12,independent_signers:true}));
  const sellers=await Promise.all(Array.from({length:12},(_,seller)=>batch(`gas-sellers:${roundIndex}:${seller}${attemptId}`,fixture.identities[seller],specs.filter(i=>i.seller===fixture.identities[seller].account_id).map((spec,index)=>actions.functionCall('accept_invoice',{id:spec.id,expected_hash:v4InvoiceHash(config,spec)},index===3?200_000_000_000_000n:25_000_000_000_000n,1n)))));
  receiptBatches.push(...sellers);
  const roundId=input.id;
  const ready=await confirmed(()=>clients[0].round(roundId));assert.ok(['READY','SETTLED'].includes(ready.status));const settled=await confirmed(()=>clients[0].settleRound(ready));assert.equal(settled.value.status,'SETTLED');
  assert.equal(ready.input.positions.length,12);assert.equal(ready.input.invoice_ids.length,48);assert.equal(ready.net_settlement_volume,'0');
  const history=await provider.callFunction({contractId:config.vault,method:'get_config',args:{},blockQuery:{finality:'final'}}),storage=await provider.viewAccount({accountId:config.vault,blockQuery:{finality:'final'}});
  const record={fixture_index:roundIndex,round_id:roundId,participants:12,invoices:48,group_id_bytes:input.id.length,purchase_id_bytes:96,invoice_id_bytes:specs[0].id.length,participant_id_bytes:64,amount_digits:amount.toString().length,zero_funding:true,propose:measured(proposed),approvals:approvals.map(measured),receipt_batches:receiptBatches.map(measured),settle:measured(settled),accumulated_invoices:history.invoices,storage_bytes:storage.storage_usage};
  const max=[proposed,...approvals,...receiptBatches,settled].reduce((m,r)=>BigInt(r.gas_burnt)>m?BigInt(r.gas_burnt):m,0n);record.maximum_operation_gas=max.toString();assert.ok(max<240_000_000_000_000n,'MAXIMUM_SIZE_EXCEEDS_CONSERVATIVE_GAS_MARGIN');
  report.rounds.push(record);save(reportFile,report);console.log(JSON.stringify({phase:'maximum-gas-fixture',round:roundIndex+1,state:'passed',maximum_tgas:Number(max)/1e12,accumulated_invoices:history.invoices}));
 }
 const backing=await provider.callFunction({contractId:config.vault,method:'get_backing_status',args:{},blockQuery:{finality:'final'}});assert.equal(backing.claims_equal_tracked_custody,true);report.backing=backing;report.passed=true;report.finished_at=new Date().toISOString();save(reportFile,report);
 const updated=JSON.parse(readFileSync(manifestPath,'utf8'));updated.limits.gas_verified=true;updated.limits.gas_evidence='gas.json';save(manifestPath,updated);
 console.log(JSON.stringify({gas_limit_verification:'passed',fixture_service_activity:false,limits:{participants:12,invoices:48},repository_pushed:config.source?.repository_pushed===true}));
}finally{journal.close();}
