import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {StateStore} from '../lib/store.mjs';
import {Coordinator} from '../coordinator/coordinator.mjs';

const empty=()=>({balances:[],invoices:[],private_invoices:[],funding_groups:[],rounds:[],private_data_available:true});
function fixture(count){
 const directory=mkdtempSync(path.join(tmpdir(),'ach-audit-schedule-')),store=new StateStore(path.join(directory,'store.sqlite')),reads=[],data=new Map(),fail=new Set();let now=Date.now();
 const sessions=Array.from({length:count},(_,index)=>({id:'workspace-'+index,created_at_ms:now+index,expires_at_ms:now+3600000,state:'READY',participants:[],round_ids:[]}));
 for(const session of sessions){store.putSession(session,String(sessions.indexOf(session)+1).padStart(64,'0'),'a'.repeat(64));data.set(session.id,empty());}
 const client={},coordinator=new Coordinator({store,config:{network:'testnet',vault:'vault.audit.testnet',token:'token.audit.testnet'},getClient:async()=>client,clock:()=>now});
 coordinator.readSnapshot=async session=>{reads.push(session.id);if(fail.has(session.id))throw new Error('RPC_UNAVAILABLE');return structuredClone(data.get(session.id));};
 return{store,sessions,reads,data,fail,client,coordinator,advance:ms=>{now+=ms;},now:()=>now,cleanup:()=>{store.close();rmSync(directory,{recursive:true,force:true});}};
}

test('idle workspace audits rotate with a bounded restart burst while foreground refreshes stay fresh',async()=>{
 const h=fixture(8);try{
  for(let index=0;index<8;index++){const before=h.reads.length;await h.coordinator.tick();assert.equal(h.reads.length-before,1);assert.equal(h.reads.at(-1),h.sessions[index].id);}
  await h.coordinator.tick();assert.equal(h.reads.length,8,'idle workspaces must not be re-read every tick');
  await h.coordinator.snapshot(h.sessions[6]);assert.equal(h.reads.at(-1),h.sessions[6].id,'foreground snapshots are independent of the background audit interval');
  h.coordinator.invalidateSnapshot(h.sessions[6].id);await h.coordinator.tick();assert.equal(h.reads.length,10,'a changed workspace is reconciled without waiting for its idle interval');
  h.advance(60000);await h.coordinator.tick();assert.equal(h.reads.at(-1),h.sessions[0].id);
  const expired={...h.sessions[0],expires_at_ms:Date.now()-1};h.store.updateSession(expired);await h.coordinator.tick();assert.equal(h.coordinator.auditSchedule.has(expired.id),false);
  const restarted=new Coordinator({store:h.store,config:h.coordinator.config,getClient:async()=>h.client,clock:h.now});let reads=0;restarted.readSnapshot=async()=>{reads++;return empty();};await restarted.tick();assert.equal(reads,1,'restart must not audit all previously completed workspaces at once');
 }finally{h.cleanup();}
});

test('unfinished test and clearing work run before idle audits and an unavailable idle workspace cannot starve them',async()=>{
 const h=fixture(8);try{
  for(const [index,prefix]of [[6,'test-netting-'],[7,'clear-']]){const job=h.store.startJob(prefix+'pending',h.sessions[index].id,{invoice_ids:[]});job.state='WAITING';job.retry_at_ms=h.now()+100000;h.store.saveJob(job);}
  h.fail.add(h.sessions[0].id);let resumes=0;h.coordinator.tester={resume:()=>{resumes++;}};
  await assert.rejects(h.coordinator.tick(),/RPC_UNAVAILABLE/);assert.deepEqual(h.reads,[h.sessions[6].id,h.sessions[7].id,h.sessions[0].id]);
  await h.coordinator.tick();assert.deepEqual(h.reads.slice(3),[h.sessions[6].id,h.sessions[7].id,h.sessions[1].id]);assert.equal(resumes,2);
  assert.equal(h.coordinator.auditSchedule.get(h.sessions[0].id).at,h.now(),'failed idle attempts advance the rotation');
 }finally{h.cleanup();}
});

test('known reservations keep their expiry checks frequent until the released workspace becomes idle',async()=>{
 const h=fixture(1);try{
  const session=h.sessions[0],state=h.data.get(session.id),deadline=h.now()+10000;
  state.balances=[{account_id:'buyer.testnet',reserved:'20'}];state.funding_groups=[{status:'FUNDED',input:{id:'reserved-group',deadline_ms:deadline}}];
  let expiries=0;h.client.expirePurchaseGroup=async id=>{assert.equal(id,'reserved-group');expiries++;state.funding_groups[0].status='EXPIRED';state.balances[0].reserved='0';};
  await h.coordinator.tick();h.advance(5000);await h.coordinator.tick();assert.equal(h.reads.length,2);
  h.advance(5000);await h.coordinator.tick();assert.equal(expiries,1,'reservation expiry must not wait for the idle interval');
  await h.coordinator.tick();const reads=h.reads.length;await h.coordinator.tick();assert.equal(h.reads.length,reads,'a fully released workspace returns to the idle schedule');
 }finally{h.cleanup();}
});

test('periodic idle audits discover externally accepted invoices and preserve automatic clearing',async()=>{
 const h=fixture(1);try{
  const session=h.sessions[0],state=h.data.get(session.id),start=h.now();
  state.balances=['buyer.testnet','seller.testnet'].map(account_id=>({account_id,available:'1000',reserved:'0',policy:{revoked:false,expires_at_ms:start+900000,max_net_commitment:'1000'}}));
  await h.coordinator.tick();h.advance(10000);
  state.invoices=[{status:'ACCEPTED',spec:{id:'external-invoice',purchase_id:'external-purchase',terms_version:1,buyer:'buyer.testnet',seller:'seller.testnet',amount:'100',ready_at_ms:start}}];
  const cleared=[];h.coordinator.clear=async(_,request,options)=>{cleared.push({request,options});state.invoices[0].status='SETTLED';return{round:{status:'SETTLED'}};};
  await h.coordinator.tick();assert.equal(cleared.length,0);assert.equal(h.reads.length,1);
  h.advance(50000);await h.coordinator.tick();assert.equal(h.reads.length,2);assert.deepEqual(cleared[0].request.invoice_ids,['external-invoice']);assert.equal(cleared[0].options.automatic,true);
 }finally{h.cleanup();}
});
