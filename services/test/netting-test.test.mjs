import test from 'node:test';import assert from 'node:assert/strict';
import path from 'node:path';
import {StateStore} from '../lib/store.mjs';
import {NettingTester} from '../coordinator/netting-test.mjs';
import {V4BroadcastUnknown} from '../../packages/client/dist/v4.js';
import {setup} from './fixtures/commerce.mjs';
function tester(h,privateStore){
 return new NettingTester({store:h.store,privateStore,config:h.config,clock:()=>h.chain.now,getIdentity:async(session,p)=>h.identities.get(p.kind),getClient:async()=>h.identities.get('coordinator').client,getPrivateClient:async()=>h.owners.get('coordinator')});
}
test('twelve judge agents sign actual public Wasm bills, settle their exact net, and replay without another payment',async()=>{
 const h=await setup({agentCount:12}),privateStore=new StateStore(path.join(h.temp,'netting.sqlite'),{sealingKey:'4'.repeat(64)}),engine=tester(h,privateStore);h.coordinator.tester=engine;
 try{
  const input={request_id:'5'.repeat(32),agent_count:12,privacy:'public'},before=await h.coordinator.snapshot(h.session),result=await engine.run(h.session,input),after=await h.coordinator.snapshot(h.session);
  assert.equal(result.invoice_count,12);assert.equal(result.net_settlement_volume,'20000');assert.equal(result.gross_invoice_volume,'980000');
  assert.equal(after.rounds.length,1);assert.equal(after.rounds[0].status,'SETTLED');assert.equal(after.rounds[0].approvals.length,12);assert.equal(after.invoices.length,12);
  assert.equal(after.balances.reduce((sum,b)=>sum+BigInt(b.balance),0n),before.balances.reduce((sum,b)=>sum+BigInt(b.balance),0n));
  assert.equal(after.balances.find(b=>b.account_id===h.identities.get('research').account_id).available,'980000');assert.equal(after.balances.find(b=>b.account_id===h.identities.get('visual').account_id).available,'20000');
  const transactions=h.chain.transactions.length;assert.deepEqual(await tester(h,privateStore).run(h.session,input),result);assert.equal(h.chain.transactions.length,transactions);
  assert.equal(h.store.eventPage(h.session.id).items.filter(e=>e.kind==='round-settled').length,1);
 }finally{privateStore.close();h.cleanup();}
});
test('six encrypted invoices include twelve independently signing judge agents and settle in one real worker run',async()=>{
 const h=await setup({agentCount:12,privateMode:true}),privateStore=new StateStore(path.join(h.temp,'netting.sqlite'),{sealingKey:'6'.repeat(64)}),engine=tester(h,privateStore);h.coordinator.tester=engine;
 try{
  const result=await engine.run(h.session,{request_id:'7'.repeat(32),agent_count:12,privacy:'private'}),after=await h.coordinator.snapshot(h.session);
  assert.equal(result.invoice_count,6);assert.equal(result.gross_invoice_volume,null);assert.equal(result.net_settlement_volume,'500000');
  const net=h.workerRuns.filter(r=>r.input.operation==='net');assert.equal(net.length,1);assert.equal(net[0].input.policies.length,12);assert.equal(net[0].input.disclosure_signatures.length,12);assert.equal(net[0].input.encrypted_invoices.length,6);
  assert.equal(h.workerRuns.filter(r=>r.input.operation==='verify').length,0);assert.equal(after.invoices.length,0);assert.equal(after.private_invoices.length,6);assert.ok(after.private_invoices.every(i=>i.status==='SETTLED'));assert.equal(after.rounds[0].approvals.length,12);
  assert.ok(!JSON.stringify(privateStore.db.prepare('SELECT data FROM jobs').all()).includes('"amount"'));
  assert.equal(after.balances.reduce((sum,b)=>sum+BigInt(b.balance),0n),10000000n);
 }finally{privateStore.close();h.cleanup();}
});
test('lost worker confirmations resume the original funded judge group; foreign keys and excessive counts fail closed',async()=>{
 const h=await setup({agentCount:6,privateMode:true}),privateStore=new StateStore(path.join(h.temp,'netting.sqlite'),{sealingKey:'8'.repeat(64)}),engine=tester(h,privateStore);h.coordinator.tester=engine;
 try{
  const input={request_id:'9'.repeat(32),agent_count:6,privacy:'private'},owner=h.owners.get('coordinator'),send=owner.requestPrivateRound.bind(owner);let lost=true;
  owner.requestPrivateRound=async request=>{const result=await send(request);if(lost){lost=false;throw new V4BroadcastUnknown('private:'+request.id,'confirmed-lost');}return result;};
  await assert.rejects(engine.run(h.session,input),V4BroadcastUnknown);assert.equal(h.store.job('test-netting-'+input.request_id).state,'WAITING');
  const restarted=tester(h,privateStore),result=await restarted.run(h.session,input);assert.equal(result.net_settlement_volume,'20000');assert.equal(h.workerRuns.filter(r=>r.input.operation==='net').length,1);
  assert.throws(()=>restarted.prepare(h.session,{...input,request_id:'a'.repeat(32),agent_count:13}),/TEST_AGENT_COUNT_LIMIT/);
  assert.throws(()=>restarted.prepare({...h.session,id:'b'.repeat(32)},input),/REQUEST_ID_CONFLICT/);
  const foreign={...h.session,participants:[{...h.session.participants[0],account_id:'foreign.testnet'},...h.session.participants.slice(1)]};
  await assert.rejects(restarted.run(foreign,{...input,request_id:'c'.repeat(32)}),/SESSION_IDENTITY_SCOPE_REQUIRED/);
 }finally{privateStore.close();h.cleanup();}
});
