import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync}from 'node:fs';
import {tmpdir}from 'node:os';
import path from 'node:path';
import {setup}from './fixtures/commerce.mjs';
import {StateStore}from '../lib/store.mjs';
import {DemoSponsor}from '../demo/sponsor.mjs';

const temporary=()=>mkdtempSync(path.join(tmpdir(),'ach-evaluation-'));
const session=(id,family=id)=>({id,family_id:family,created_at_ms:Date.now(),expires_at_ms:Date.now()+3600000,state:'READY',participants:[],round_ids:[]});

test('six independent judging briefs clear against actual Wasm without the former two-brief limit or duplicate payments',async()=>{
 const h=await setup();try{
  let first,firstResult;
  for(let index=1;index<=6;index++){
   h.chain.now+=6000;
   const request={request_id:index.toString(16).padStart(32,'0'),brief:'Create an audited chart for this repeated evaluation',mode:'report',privacy:'public'};
   const result=await h.coordinator.run(h.session,request),snapshot=await h.coordinator.snapshot(h.session),round=snapshot.rounds.find(r=>r.input.id===result.round_id);
   assert.equal(round.status,'READY');assert.equal(round.input.invoice_ids.length,3);assert.equal(round.net_settlement_volume,'20000');
   await h.coordinator.clear(h.session,{request_id:(index+32).toString(16).padStart(32,'0'),selected_accounts:round.input.positions.map(p=>p.account_id),invoice_ids:round.input.invoice_ids,privacy:'public'});
   if(index===1){first=request;firstResult=result;}
  }
  const snapshot=await h.coordinator.snapshot(h.session),amount=kind=>snapshot.balances.find(b=>b.account_id===h.identities.get(kind).account_id).balance;
  assert.equal(snapshot.jobs.length,6);assert.equal(snapshot.rounds.length,6);assert.equal(snapshot.invoices.length,18);assert.ok(snapshot.rounds.every(r=>r.status==='SETTLED'));assert.ok(snapshot.invoices.every(i=>i.status==='SETTLED'));
  assert.equal(amount('research'),'880000');assert.equal(amount('visual'),'0');assert.equal(amount('audit'),'120000');
  const transactions=h.chain.transactions.length;assert.deepEqual(await h.coordinator.run(h.session,first),firstResult);assert.equal(h.chain.transactions.length,transactions);
 }finally{h.cleanup();}
});

test('test-workspace switching preserves earlier encrypted work and receipts, survives restart, and rejects foreign or expired workspaces',()=>{
 const directory=temporary(),filename=path.join(directory,'store.sqlite');let store=new StateStore(filename);
 const parent=session('a'.repeat(32)),child=session('b'.repeat(32),parent.id),foreign=session('c'.repeat(32)),expired={...session('d'.repeat(32),parent.id),expires_at_ms:Date.now()-1};
 try{
  for(const [index,s]of [parent,child,foreign,expired].entries())store.putSession(s,String(index+1).repeat(64),'e'.repeat(64));
  const job=store.startJob('run-encrypted-evaluation',parent.id,{privacy:'encrypted',sealed_brief:{ciphertext:'opaque-private-input'}});job.state='COMPLETE';job.result={kind:'encrypted-result',ciphertext:'opaque-private-result'};store.saveJob(job);store.event(parent.id,'round-settled','original-round',{tx_hash:'original-receipt'});
  const workspaces=store.workspaceSessions(child);assert.deepEqual(new Set(workspaces.map(s=>s.id)),new Set([parent.id,child.id]));assert.ok(!JSON.stringify(workspaces).includes('opaque-private'));assert.ok(!JSON.stringify(workspaces).includes('token'));
  for(const target of [foreign.id,expired.id,undefined,'invalid'])assert.throws(()=>store.switchSession({...child,family_id:foreign.id},target),/SESSION_OWNER_SCOPE_REQUIRED/);
  const opened=store.switchSession(child,parent.id);assert.equal(store.authenticate(opened.token).id,parent.id);assert.equal(store.authenticate('1'.repeat(64)).id,parent.id);
  store.close();store=new StateStore(filename);assert.equal(store.authenticate(opened.token).id,parent.id);assert.deepEqual(store.job(job.id),job);assert.equal(store.eventPage(parent.id).items[0].data.tx_hash,'original-receipt');
  const rotated=store.switchSession(child,parent.id);assert.throws(()=>store.authenticate(opened.token),/SESSION_EXPIRED/);assert.equal(store.authenticate(rotated.token).id,parent.id);assert.equal(store.db.prepare('SELECT COUNT(*) AS n FROM session_access').get().n,1);
 }finally{store.close();rmSync(directory,{recursive:true,force:true});}
});

test('brief admission serializes active work, preserves retry identity and bounds shared inference resources without a two-brief counter',()=>{
 const directory=temporary(),filename=path.join(directory,'store.sqlite'),store=new StateStore(filename),other=new StateStore(filename),owner=session('a'.repeat(32)),peer=session('b'.repeat(32)),payload={brief:'A valid repeated evaluation brief'},now=Date.now();
 try{
  store.putSession(owner,'1'.repeat(64),'a'.repeat(64));store.putSession(peer,'2'.repeat(64),'b'.repeat(64));
  let job=store.startBrief('run-one',owner.id,payload,{now,maxPlannerCallsPerDay:6});
  assert.deepEqual(other.startBrief(job.id,owner.id,payload,{now,maxPlannerCallsPerDay:6}),job);
  assert.throws(()=>other.startBrief('run-two',owner.id,payload,{now:now+6000,maxPlannerCallsPerDay:6}),/SESSION_BRIEF_IN_PROGRESS/);
  assert.throws(()=>other.startBrief(job.id,peer.id,payload,{now,maxPlannerCallsPerDay:6}),/REQUEST_ID_CONFLICT/);
  assert.throws(()=>other.startBrief(job.id,owner.id,{brief:'Changed payload'},{now,maxPlannerCallsPerDay:6}),/REQUEST_ID_CONFLICT/);
  job.state='COMPLETE';store.saveJob(job);assert.throws(()=>other.startBrief('run-two',owner.id,payload,{now:now+1,maxPlannerCallsPerDay:6}),/BRIEF_RATE_LIMITED/);
  for(const [index,id]of ['run-two','run-three'].entries()){job=other.startBrief(id,owner.id,payload,{now:now+6000*(index+1),maxPlannerCallsPerDay:6});job.state='COMPLETE';other.saveJob(job);}
  assert.equal(store.jobs(owner.id).length,3);assert.equal(store.db.prepare('SELECT requests_reserved FROM inference_days').get().requests_reserved,6);
  assert.throws(()=>other.startBrief('run-four',peer.id,payload,{now:now+18000,maxPlannerCallsPerDay:6}),/SPONSORED_INFERENCE_UNAVAILABLE/);assert.equal(store.job('run-four'),undefined);assert.equal(store.db.prepare('SELECT requests_reserved FROM inference_days').get().requests_reserved,6);
 }finally{other.close();store.close();rmSync(directory,{recursive:true,force:true});}
});

test('renewable evaluation workspaces lift session-count caps while retaining native sponsorship and creation-rate limits',async()=>{
 const directory=temporary(),store=new StateStore(path.join(directory,'store.sqlite')),queued=[];
 const config={network:'testnet',sponsor_limits:{dailyLimit:null,ipLimit:null,maxNative:'8',perSessionNative:'1',intervalMs:0}},sponsor=Object.assign(Object.create(DemoSponsor.prototype),{store,config,enqueue:s=>queued.push(s.id)});
 try{
  let parent;for(let index=0;index<8;index++){const opened=await sponsor.createSession('a'.repeat(64),parent);parent??=opened.session;assert.equal(opened.session.family_id,parent.id);assert.equal(store.authenticate(opened.token).id,opened.session.id);}
  assert.equal(queued.length,8);assert.equal(store.workspaceSessions(parent).length,8);await assert.rejects(sponsor.createSession('a'.repeat(64),parent),/FREE_SESSION_QUOTA_REACHED/);assert.equal(queued.length,8);
  config.sponsor_limits={...config.sponsor_limits,maxNative:'10',intervalMs:10000};await assert.rejects(sponsor.createSession('a'.repeat(64),parent),/WORKSPACE_RATE_LIMITED/);
  await assert.rejects(sponsor.createSession('b'.repeat(64),{id:'f'.repeat(32)}),/SESSION_EXPIRED/);
  assert.equal(store.db.prepare('SELECT native_reserved FROM sponsor_days').get().native_reserved,'8');assert.equal(store.db.prepare('SELECT COUNT(*) AS n FROM sessions').get().n,8);
 }finally{store.close();rmSync(directory,{recursive:true,force:true});}
});

test('a fresh judging workspace trades with independent Wasm wallets and can reopen its original settled work',async()=>{
 const h=await setup();try{
  h.chain.now+=6000;
  const run=async(s,id)=>{const result=await h.coordinator.run(s,{request_id:id.repeat(32),brief:'Create an audited chart for this repeatable evaluation',mode:'report',privacy:'public'}),snapshot=await h.coordinator.snapshot(s),round=snapshot.rounds.find(round=>round.input.id===result.round_id);await h.coordinator.clear(s,{request_id:(id==='a'?'b':'d').repeat(32),selected_accounts:round.input.positions.map(position=>position.account_id),invoice_ids:round.input.invoice_ids,privacy:'public'});return h.coordinator.snapshot(s);};
  const original=await run(h.session,'a');let prepared;
  const sponsor=Object.assign(Object.create(DemoSponsor.prototype),{store:h.store,config:{network:'testnet',sponsor_limits:{dailyLimit:null,ipLimit:null,maxNative:'2',perSessionNative:'1',intervalMs:0}},enqueue:s=>{prepared=h.addWorkspace(s);}});
  const opened=await sponsor.createSession('a'.repeat(64),h.session),fresh=await prepared;
  assert.equal(fresh.state,'READY');assert.equal(h.store.authenticate(opened.token).id,fresh.id);assert.equal(fresh.family_id,h.session.id);
  assert.ok(fresh.participants.every(participant=>!h.session.participants.some(original=>original.account_id===participant.account_id)));
  const before=await h.coordinator.snapshot(fresh);assert.equal(before.jobs.length,0);assert.equal(before.invoices.length,0);assert.equal(before.balances.find(balance=>balance.account_id===fresh.participants.find(participant=>participant.kind==='research').account_id).available,'1000000');
  const settled=await run(fresh,'c');assert.equal(settled.rounds.length,1);assert.equal(settled.rounds[0].net_settlement_volume,'20000');assert.equal(settled.rounds[0].status,'SETTLED');
  const restored=h.store.authenticate(h.store.switchSession(fresh,h.session.id).token),after=await h.coordinator.snapshot(restored);assert.deepEqual(after.jobs,original.jobs);assert.deepEqual(after.invoices,original.invoices);assert.deepEqual(after.rounds,original.rounds);assert.deepEqual(after.balances,original.balances);
  assert.equal((await h.chain.invoke(h.config.vault,'get_backing_status',{})).value.tracked_token_custody,'2000000');
 }finally{h.cleanup();}
});
