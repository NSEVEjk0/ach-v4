import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {Worker} from 'node:worker_threads';
import {StateStore} from '../lib/store.mjs';
import {Coordinator} from '../coordinator/coordinator.mjs';
import {NettingTester} from '../coordinator/netting-test.mjs';
import {v4PurchaseGroupId} from '../../packages/client/dist/v4.js';

const config={protocol_version:4,network:'testnet',vault:'vault.admission.testnet',token:'usd.admission.testnet'};
const brief=id=>({request_id:id.repeat(32),privacy:'public',mode:'report',brief:'Make a chart for the judge.'});
const net=id=>({request_id:id.repeat(32),agent_count:3,privacy:'public'});
function fixture(){
 const directory=mkdtempSync(path.join(tmpdir(),'ach-admission-')),filename=path.join(directory,'coordinator.sqlite'),store=new StateStore(filename),other=new StateStore(filename),now=Date.now();
 const session={id:'a'.repeat(32),created_at_ms:now,expires_at_ms:now+86_400_000,state:'READY',judge_testing:true,participants:['research','visual','audit'].map(kind=>({kind,account_id:kind+'.admission.testnet'})),round_ids:[]};
 store.putSession(session,'b'.repeat(64),'c'.repeat(64));
 let clock=now+6000;
 const makeCoordinator=s=>new Coordinator({store:s,config,clock:()=>clock,agents:{},sponsor:{}}),makeTester=s=>new NettingTester({store:s,config,clock:()=>clock});
 return{directory,filename,store,other,now,session,coordinator:makeCoordinator(store),peerCoordinator:makeCoordinator(other),tester:makeTester(store),peerTester:makeTester(other),advance(){clock+=6000;},cleanup(){other.close();store.close();rmSync(directory,{recursive:true,force:true});}};
}
function finish(store,job,state='COMPLETE'){job.state=state;store.saveJob(job);return job;}
function clear(session,id){return{request_id:id.repeat(32),privacy:'public',invoice_ids:['invoice-'+id],selected_accounts:session.participants.map(p=>p.account_id)};}

test('separate tabs reserve shared agent work, preserve exact replay, and allow unrelated clearing without a judge test',()=>{
 const h=fixture();try{
  const running=h.coordinator.prepareRun(h.session,brief('1'));
  assert.throws(()=>h.peerTester.prepare(h.session,net('2')),/SESSION_PAYMENT_IN_PROGRESS/);
  assert.equal(h.store.job('test-netting-'+net('2').request_id),undefined);
  finish(h.store,running);
  const job=h.peerTester.prepare(h.session,net('2'));
  assert.deepEqual(h.tester.prepare(h.session,net('2')),job);
  assert.throws(()=>h.tester.prepare(h.session,net('3')),/SESSION_PAYMENT_IN_PROGRESS/);
  assert.throws(()=>h.tester.prepare(h.session,{...net('2'),agent_count:4}),/TEST_AGENT_COUNT_LIMIT/);
  assert.throws(()=>h.tester.prepare(h.session,{...net('2'),privacy:'private'}),/PRIVATE_MODE_UNAVAILABLE/);
  assert.throws(()=>h.tester.prepare({...h.session,id:'d'.repeat(32)},net('2')),/REQUEST_ID_CONFLICT/);
  assert.throws(()=>h.peerCoordinator.prepareRun(h.session,brief('3')),/SESSION_NETTING_TEST_IN_PROGRESS/);
  assert.throws(()=>h.coordinator.prepareClear(h.session,clear(h.session,'4')),/SESSION_NETTING_TEST_IN_PROGRESS/);
  assert.equal(h.store.job('run-'+brief('3').request_id),undefined);
  assert.equal(h.store.db.prepare('SELECT requests_reserved FROM inference_days').get().requests_reserved,2);
  finish(h.other,job,'WAITING');
  assert.throws(()=>h.coordinator.prepareClear(h.session,clear(h.session,'4')),/SESSION_NETTING_TEST_IN_PROGRESS/);
  assert.equal(h.tester.prepare(h.session,net('2')).state,'WAITING');
  finish(h.other,job);
  assert.equal(h.tester.prepare(h.session,net('2')).state,'COMPLETE');
  const first=h.coordinator.prepareClear(h.session,clear(h.session,'4')),second=h.peerCoordinator.prepareClear(h.session,clear(h.session,'5'));
  assert.equal(first.state,'STARTED');assert.equal(second.state,'STARTED');
  assert.throws(()=>h.tester.prepare(h.session,net('6')),/SESSION_PAYMENT_IN_PROGRESS/);
  h.advance();assert.equal(h.peerCoordinator.prepareRun(h.session,brief('7')).state,'STARTED');
 }finally{h.cleanup();}
});

test('failed and committed jobs reacquire admission before retrying across a restart',async()=>{
 const h=fixture();try{
  const request=brief('1'),old=h.coordinator.prepareRun(h.session,request);old.error='RPC_UNAVAILABLE';finish(h.store,old,'FAILED');
  const competing=h.peerTester.prepare(h.session,net('2'));
  assert.throws(()=>h.coordinator.prepareRun(h.session,request),/SESSION_NETTING_TEST_IN_PROGRESS/);
  const group={input:{id:v4PurchaseGroupId(config,h.session.participants[0].account_id,request.request_id),positions:h.session.participants.map(p=>({account_id:p.account_id}))},status:'READY',round_id:'original-round'};
  await assert.rejects(h.coordinator.recoverCommittedRun(h.session,old,group),/SESSION_NETTING_TEST_IN_PROGRESS/);
  assert.equal(h.store.job(old.id).state,'FAILED');
  finish(h.other,competing);
  const recovered=await h.coordinator.recoverCommittedRun(h.session,old,group);
  assert.equal(recovered.state,'WAITING');assert.equal(recovered.payment_committed,true);assert.equal(recovered.request_hash,old.request_hash);
  assert.throws(()=>h.peerTester.prepare(h.session,net('3')),/SESSION_PAYMENT_IN_PROGRESS/);
  finish(h.store,recovered);
  const failedTest=h.tester.prepare(h.session,net('3'));failedTest.error='RPC_UNAVAILABLE';finish(h.store,failedTest,'FAILED');
  h.advance();const running=h.peerCoordinator.prepareRun(h.session,brief('4'));
  assert.throws(()=>h.tester.prepare(h.session,net('3')),/SESSION_PAYMENT_IN_PROGRESS/);
  assert.equal(h.store.job(failedTest.id).state,'FAILED');
  finish(h.other,running);
  const resumed=h.peerTester.prepare(h.session,net('3'));
  assert.equal(resumed.state,'WAITING');assert.equal(resumed.id,failedTest.id);assert.equal(resumed.created_at_ms,failedTest.created_at_ms);
  assert.equal(h.coordinator.prepareRun(h.session,request).state,'COMPLETE');
  assert.throws(()=>h.coordinator.prepareRun(h.session,brief('5')),/SESSION_NETTING_TEST_IN_PROGRESS/);
  assert.throws(()=>h.peerTester.prepare(h.session,{...net('3'),privacy:'private'}),/PRIVATE_MODE_UNAVAILABLE/);
 }finally{h.cleanup();}
});

test('judge tests require an explicit integer count and keep their request identity and shared quota',()=>{
 const h=fixture();h.tester.config={...config,private:{enabled:true}};h.peerTester.config=h.tester.config;
 try{
  for(const count of [undefined,null,'3',3.5])assert.throws(()=>h.tester.prepare(h.session,{...net('1'),agent_count:count}),/INVALID_NETTING_TEST/);
  const original=h.tester.prepare(h.session,net('1'));
  assert.throws(()=>h.peerTester.prepare(h.session,{...net('1'),privacy:'private'}),/REQUEST_ID_CONFLICT/);
  finish(h.store,original);
  for(let index=2;index<=12;index++){const input={...net('1'),request_id:index.toString(16).padStart(32,'0')};finish(h.other,h.peerTester.prepare(h.session,input));}
  assert.throws(()=>h.tester.prepare(h.session,net('f')),/SESSION_CLEARING_QUOTA_REACHED/);
  assert.deepEqual(h.peerTester.prepare(h.session,net('1')),original);
  assert.equal(h.store.jobs(h.session.id).filter(j=>j.id.startsWith('test-netting-')).length,12);
 }finally{h.cleanup();}
});

const workerSource=`
 const {parentPort,workerData}=require('node:worker_threads');
 (async()=>{
  const {StateStore}=await import(workerData.module),store=new StateStore(workerData.filename);
  try{
   parentPort.postMessage({ready:true});Atomics.wait(new Int32Array(workerData.start),0,0);
   try{
    const job=workerData.kind==='run'?store.startBrief(workerData.id,workerData.session,workerData.payload,{intervalMs:0}):store.startSessionJob(workerData.id,workerData.session,workerData.payload,{kind:workerData.kind});
    parentPort.postMessage({id:job.id,state:job.state});
   }catch(error){parentPort.postMessage({error:error.message});}
  }finally{store.close();}
 })().catch(error=>{throw error;});
`;
test('simultaneous separate connections admit exactly one competing judge operation',{timeout:10000},async()=>{
 for(const competitor of ['test','run','clear']){
  const h=fixture(),start=new SharedArrayBuffer(4),workers=[];
  try{
   const results=[],ready=[];
   for(const [index,kind]of ['test',competitor].entries()){
    const id=(kind==='test'?'test-netting-':kind+'-')+String(index+1).repeat(32),payload=kind==='test'?net(String(index+1)):kind==='run'?brief(String(index+1)):clear(h.session,String(index+1));
    const worker=new Worker(workerSource,{eval:true,workerData:{module:new URL('../lib/store.mjs',import.meta.url).href,filename:h.filename,start,session:h.session.id,id,kind,payload}});workers.push(worker);
    let resolveReady,rejectReady;ready.push(new Promise((resolve,reject)=>{resolveReady=resolve;rejectReady=reject;}));
    results.push(new Promise((resolve,reject)=>{worker.on('message',message=>message.ready?resolveReady():resolve(message));worker.on('error',error=>{rejectReady(error);reject(error);});}));
   }
   await Promise.all(ready);Atomics.store(new Int32Array(start),0,1);Atomics.notify(new Int32Array(start),0);
   const attempts=await Promise.all(results);
   assert.equal(attempts.filter(result=>result.state==='STARTED').length,1);
   assert.equal(attempts.filter(result=>/SESSION_PAYMENT_IN_PROGRESS|SESSION_NETTING_TEST_IN_PROGRESS/.test(result.error??'')).length,1);
   assert.equal(h.store.jobs(h.session.id).length,1);
  }finally{await Promise.all(workers.map(worker=>worker.terminate()));h.cleanup();}
 }
});
