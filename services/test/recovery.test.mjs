import test from 'node:test';
import assert from 'node:assert/strict';
import {setup}from './fixtures/commerce.mjs';
import {V4BroadcastUnknown}from '../../packages/client/dist/v4.js';

const brief=id=>({request_id:id.repeat(32),brief:'Create an audited chart of the service workloads',mode:'report',privacy:'public'});

test('repeated lost RPC confirmations recover one funded group without another purchase or inference',async()=>{
 for(const failure of [new Error('RPC_UNAVAILABLE'),new V4BroadcastUnknown('recorded-operation','recorded-transaction'),new TypeError('fetch failed'),Object.assign(new Error('request timed out'),{name:'TimeoutError'})]){
  const h=await setup();try{
   const run=h.coordinator.agents.runBrief,actor=h.actors.get('research'),plan=actor.planner;
   let plans=0,lost=0;
   actor.planner=async(...args)=>{plans++;return plan(...args);};
   h.coordinator.agents.runBrief=async(...args)=>{
    const result=await run(...args);
    if(lost++<4)throw failure;
    return result;
   };
   const request=brief('1');
   for(let attempt=0;attempt<4;attempt++){
    await assert.rejects(h.coordinator.run(h.session,request),error=>error===failure);
    const job=h.store.job('run-'+request.request_id);assert.equal(job.state,'WAITING');assert.equal(job.failures,0);
   }
   const result=await h.coordinator.run(h.session,request),snapshot=await h.coordinator.snapshot(h.session);
   assert.equal(plans,1);assert.equal(snapshot.funding_groups.length,1);assert.equal(snapshot.rounds.length,1);assert.equal(snapshot.invoices.length,3);
   assert.equal(result.round_id,snapshot.rounds[0].input.id);assert.equal(snapshot.rounds[0].net_settlement_volume,'20000');
   assert.equal(snapshot.balances.find(b=>b.account_id===h.identities.get('research').account_id).reserved,'20000');
   assert.equal(h.store.db.prepare('SELECT requests_reserved FROM inference_days').get().requests_reserved,2);
   for(const balance of snapshot.balances)assert.equal(balance.gross_purchase_budget_used,balance.account_id===h.identities.get('audit').account_id?'80000':'100000');
  }finally{h.cleanup();}
 }
});

test('old failed RPC work resumes within its deadline while service failures and expired requests remain bounded',async()=>{
 const h=await setup();try{
  const request=brief('2'),job=h.coordinator.prepareRun(h.session,request);
  job.state='FAILED';job.error='RPC_UNAVAILABLE';job.failures=3;h.store.saveJob(job);
  const restarted=h.restart();await restarted.run(h.session,request);
  assert.equal(h.store.job(job.id).state,'COMPLETE');assert.equal(h.store.job(job.id).failures,3);
  h.chain.now+=5100;
  const failedRequest=brief('3'),failed=restarted.prepareRun(h.session,failedRequest);
  failed.state='FAILED';failed.error='SERVICE_UNAVAILABLE';failed.failures=3;h.store.saveJob(failed);
  await assert.rejects(restarted.run(h.session,failedRequest),/SERVICE_UNAVAILABLE/);
  h.chain.now+=5100;
  const expiredRequest=brief('4'),expired=restarted.prepareRun(h.session,expiredRequest);
  expired.state='FAILED';expired.error='RPC_UNAVAILABLE';expired.created_at_ms=h.chain.now-restarted.jobTimeoutMs;h.store.saveJob(expired);
  await assert.rejects(restarted.run(h.session,expiredRequest),/RPC_UNAVAILABLE/);
  const snapshot=await restarted.snapshot(h.session);assert.equal(snapshot.funding_groups.length,1);assert.equal(snapshot.invoices.length,3);
 }finally{h.cleanup();}
});

test('an unavailable earlier workspace cannot block later settlement or expired reservation refunds',async()=>{
 for(const expire of [false,true]){
  const h=await setup();try{
   const next={id:'abcdef1234567890abcdef1234567890',family_id:h.session.id,created_at_ms:h.chain.now,expires_at_ms:h.session.expires_at_ms,participants:[],round_ids:[],state:'PROVISIONING'};
   h.store.putSession(next,'b'.repeat(64),'c'.repeat(64));await h.addWorkspace(next);
   if(expire)h.actors.get('visual').executePurchase=async()=>{throw new Error('SERVICE_UNAVAILABLE');};
   const request=brief('5');
   if(expire)await assert.rejects(h.coordinator.run(next,request),/SERVICE_UNAVAILABLE/);
   else await h.coordinator.run(next,request);
   const before=await h.coordinator.snapshot(next);assert.equal(before.balances.find(b=>b.account_id===next.participants.find(p=>p.kind==='research').account_id).reserved,'20000');
   if(expire)h.chain.now=before.funding_groups[0].input.deadline_ms;
   const snapshot=h.coordinator.snapshot.bind(h.coordinator);
   h.coordinator.snapshot=session=>session.id===h.session.id?Promise.reject(new Error('RPC_UNAVAILABLE')):snapshot(session);
   await assert.rejects(h.coordinator.tick(),/RPC_UNAVAILABLE/);
   const after=await snapshot(next);
   if(expire){
    assert.equal(after.funding_groups[0].status,'EXPIRED');assert.equal(after.rounds.length,0);
    for(const balance of after.balances){assert.equal(balance.reserved,'0');assert.equal(balance.gross_purchase_budget_used,'0');}
    assert.equal(after.balances.find(b=>b.account_id===next.participants.find(p=>p.kind==='research').account_id).available,'1000000');
   }else{
    assert.equal(after.rounds.length,1);assert.equal(after.rounds[0].status,'SETTLED');assert.equal(after.rounds[0].net_settlement_volume,'20000');
    assert.equal(h.store.eventPage(next.id).items.filter(e=>e.kind==='round-settled').length,1);
   }
  }finally{h.cleanup();}
 }
});
