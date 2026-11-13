import test from 'node:test';import assert from 'node:assert/strict';
import {DemoSponsor}from '../demo/sponsor.mjs';
import {StateStore}from '../lib/store.mjs';
import {mkdtempSync,mkdirSync,writeFileSync,readFileSync,rmSync}from 'node:fs';import {tmpdir}from 'node:os';import path from 'node:path';
import {KeyPair}from '../../packages/client/dist/near.js';
import {AchV4Client,v4Digest}from '../../packages/client/dist/v4.js';
import {WasmChain,artifacts}from '../../tests/v4/wasm-chain.mjs';
test('a rejected or unconfirmed deposit cannot be reported as credited',async()=>{
 const input={request_id:'a'.repeat(32),account_id:'owner.testnet',amount:'100'};
 let result={value:'0',evidence:'near_final',tx_hash:'refund'};
 const temporary=mkdtempSync(path.join(tmpdir(),'ach-sponsor-test-')),store=new StateStore(path.join(temporary,'store.sqlite'));
 const sponsor=Object.assign(Object.create(DemoSponsor.prototype),{store,ownerFor:()=>({deposit:async()=>result})});
 const session={id:'test-session'};try{
 await assert.rejects(sponsor.deposit(session,input),/DEPOSIT_NOT_CREDITED/);
 result={value:'100',evidence:'unknown',tx_hash:'unconfirmed'};
 await assert.rejects(sponsor.deposit(session,input),/DEPOSIT_NOT_CREDITED/);
 result={value:'100',evidence:'near_final',tx_hash:'confirmed'};
 assert.deepEqual(await sponsor.deposit(session,input),result);
 assert.equal(store.eventPage(session.id).items.filter(e=>e.kind==='deposit-completed').length,1);
 }finally{store.close();rmSync(temporary,{recursive:true,force:true});}
});

async function batchedSponsorFixture(count,{losePolicyResponse=false}={}){
 const directory=mkdtempSync(path.join(tmpdir(),'ach-batched-wallets-')),store=new StateStore(path.join(directory,'store.sqlite')),chain=new WasmChain({now:Date.now()});
 const root='ach-v4r2-demo-1234abcd.testnet',config={protocol_version:4,workflow_revision:2,network:'testnet',root,vault:'ach-vault-v4r2-1234abcd.testnet',token:'ach-usdc-v4r2-1234abcd.testnet',coordinator_id:'desk.'+root,decimals:6,rpc_url:'https://rpc.invalid',private:{enabled:true},sponsor_limits:{maxNative:'26000000000000000000000000',perSessionNative:'2000000000000000000000000',vaultStorageNative:'800000000000000000000000',intervalMs:0}};
 await chain.deploy(config.vault,artifacts.vault);await chain.deploy(config.token,artifacts.token);
 await chain.invoke(config.vault,'init',{network:'testnet',token:config.token,owner_id:root,coordinator_id:config.coordinator_id,private_worker:null});await chain.invoke(config.token,'init',{owner_id:root});await chain.invoke(config.token,'storage_deposit',{account_id:config.vault});
 const sponsor=new DemoSponsor({store,config,rootIdentity:{account_id:root,secret_key:KeyPair.fromRandom('ed25519').toString()},identityRoot:path.join(directory,'identities')}),transactions=[],deposits=new Set();let policiesInFlight=0,peakPolicies=0,policyReplies=0,lost=false;
 sponsor.enqueue=()=>{};
 sponsor.executeActions=async(account,id,receiver,actions)=>{
  const payload=v4Digest(JSON.stringify({receiver,actions},(_,v)=>typeof v==='bigint'?v.toString():v)),prior=await store.get(id);
  if(prior){assert.equal(prior.payload_hash,payload);assert.equal(prior.signer_id,account.accountId);return prior.result;}
  const policy=/^wallet-policy-v[23]:/.test(id);if(policy){policiesInFlight++;peakPolicies=Math.max(peakPolicies,policiesInFlight);}
  try{
   for(const action of actions){
    if(action.addKey){const permission=action.addKey.accessKey.permission,key=Buffer.from(action.addKey.publicKey.data).toString('hex');chain.addKey(receiver,key,{owner:permission.enum==='fullAccess',methods:permission.functionCall?.methodNames??[],receiver:permission.functionCall?.receiverId});}
    if(action.functionCall){const call=action.functionCall;await chain.invoke(receiver,call.methodName,JSON.parse(Buffer.from(call.args).toString()),{account:account.accountId,deposit:call.deposit});}
   }
   if(policy)await new Promise(resolve=>setTimeout(resolve,10));
   const result={tx_hash:v4Digest(id),evidence:'near_final'};transactions.push({id,account:account.accountId,receiver,actions});await store.put({id,payload_hash:payload,signer_id:account.accountId,state:'CONFIRMED',result});
   if(policy){policyReplies++;if(losePolicyResponse&&!lost&&id.endsWith(':visual')){lost=true;throw new Error('RPC_UNAVAILABLE');}}
   return result;
  }finally{if(policy)policiesInFlight--;}
 };
 sponsor.ownerFor=(session,accountId)=>{
  const participant=session.participants.find(p=>p.account_id===accountId),identity=sponsor.ownerIdentity(session,participant.kind),key=Buffer.from(KeyPair.fromString(identity.owner_secret).getPublicKey().data).toString('hex'),owner=new AchV4Client(config,chain.transport(accountId,key,{owner:true}),'owner');
  return{deposit:async(id,amount)=>{const result=await owner.deposit(id,amount);deposits.add(accountId+':'+id);return{...result,evidence:'near_final'};}};
 };
 // Native confirmations are mocked here; every registration, policy, mint
 // and credited deposit above executes the real compiled contract offline.
 const {session}=await sponsor.createSession('a'.repeat(64),undefined,{agent_count:count});chain.now=session.expires_at_ms-86400000;
 return{directory,store,chain,config,sponsor,session,transactions,deposits,peak:()=>peakPolicies,replies:()=>policyReplies,inFlight:()=>policiesInFlight,cleanup:()=>{store.close();rmSync(directory,{recursive:true,force:true});}};
}

test('batched setup waits for every independent policy result and resumes lost replies without minting or funding twice',async()=>{
 const h=await batchedSponsorFixture(3,{losePolicyResponse:true});try{
  await assert.rejects(h.sponsor.provision(h.session),/RPC_UNAVAILABLE/);assert.equal(h.store.session(h.session.id).state,'PROVISIONING');assert.equal(h.inFlight(),0);assert.equal(h.replies(),3);assert.equal(h.deposits.size,0);
  await h.sponsor.provision(h.store.session(h.session.id));const ready=h.store.session(h.session.id);
  assert.equal(ready.state,'READY');assert.equal(ready.participants.length,3);assert.ok(h.peak()>1);assert.equal(h.transactions.length+h.deposits.size,11);
  const before=h.transactions.length;await h.sponsor.provision(ready);assert.equal(h.transactions.length,before);assert.equal(h.deposits.size,1);
  const available=await Promise.all(ready.participants.map(p=>h.chain.invoke(h.config.vault,'get_balance',{account_id:p.account_id})));assert.equal(available.reduce((sum,r)=>sum+BigInt(r.value.available),0n),1000000n);
  assert.equal(h.store.eventPage(ready.id).items.filter(e=>e.kind==='session-ready').length,1);assert.ok(!JSON.stringify(ready).includes('secret'));
 }finally{h.cleanup();}
});

test('twelve-wallet sponsorship covers its actual native allocations, funds independent judge owners, and bounds batch gas',async()=>{
 const h=await batchedSponsorFixture(12);try{
  await h.sponsor.provision(h.session);const ready=h.store.session(h.session.id);assert.equal(ready.participants.length,12);assert.equal(h.deposits.size,12);assert.equal(ready.initial_balance,'60000000');
  const native=h.transactions.reduce((sum,t)=>sum+t.actions.reduce((n,a)=>n+BigInt(a.transfer?.deposit??0),0n),0n);assert.ok(native<=BigInt(ready.sponsor_native_reserved));assert.ok(BigInt(ready.sponsor_native_reserved)>2000000000000000000000000n);
  for(const t of h.transactions)assert.ok(t.actions.reduce((sum,a)=>sum+BigInt(a.functionCall?.gas??0),0n)<=300000000000000n);
  const all=await Promise.all(ready.participants.map(p=>h.chain.invoke(h.config.vault,'get_balance',{account_id:p.account_id})));assert.equal(all.reduce((sum,r)=>sum+BigInt(r.value.balance),0n),60000000n);assert.ok(all.every(r=>r.value.available==='5000000'&&r.value.policy.gross_budget==='100000000'));
  assert.equal(new Set(ready.participants.map(p=>p.public_key)).size,12);assert.ok(ready.participants.every(p=>p.account_id.endsWith('.'+h.config.root)));
 }finally{h.cleanup();}
});

test('prepared wallets are claimed without another chain transaction or sponsor charge',async()=>{
 const h=await batchedSponsorFixture(3);try{
  await h.sponsor.provision(h.session);
  const standby=h.store.session(h.session.id);standby.prepared_pool=true;h.store.updateSession(standby);
  const before=h.transactions.length,charges=h.store.db.prepare('SELECT sessions,native_reserved FROM sponsor_days').get();
  assert.equal(h.store.pendingSessions().length,0);
  const opened=await h.sponsor.createSession('b'.repeat(64),undefined,{agent_count:3});
  assert.equal(opened.session.state,'READY');assert.equal(opened.session.id,standby.id);assert.equal(opened.session.prepared_pool,undefined);assert.equal(opened.session.requested_agent_count,3);
  assert.equal(h.transactions.length,before);assert.deepEqual(h.store.db.prepare('SELECT sessions,native_reserved FROM sponsor_days').get(),charges);
  assert.equal(h.store.authenticate(opened.token).id,standby.id);assert.equal(h.store.pendingSessions().length,1);
  await new Promise(resolve=>setImmediate(resolve));
 }finally{h.cleanup();}
});

test('prepared-session claims isolate visitors, rotate unused tokens and preserve family ownership',()=>{
 const directory=mkdtempSync(path.join(tmpdir(),'ach-prepared-sessions-')),filename=path.join(directory,'store.sqlite'),store=new StateStore(filename),second=new StateStore(filename),now=Date.now();
 const put=(id,count,token)=>store.putSession({id,family_id:id,created_at_ms:now-1000,expires_at_ms:now+86400000,state:'READY',agent_count:count,participants:[],prepared_pool:true,provisioned_at_ms:now-500},token,'c'.repeat(64));
 try{
  put('1'.repeat(32),12,'1'.repeat(64));put('2'.repeat(32),12,'2'.repeat(64));
  assert.throws(()=>store.authenticate('1'.repeat(64)),/SESSION_REQUIRED/);
  const a=store.claimPreparedSession('a'.repeat(64),null,6,{intervalMs:0}),b=second.claimPreparedSession('b'.repeat(64),null,12,{intervalMs:0});
  assert.notEqual(a.session.id,b.session.id);assert.equal(a.session.requested_agent_count,6);assert.equal(a.session.agent_count,12);
  assert.throws(()=>store.authenticate(a.session.id==='1'.repeat(32)?'1'.repeat(64):'2'.repeat(64)),/SESSION_EXPIRED/);
  assert.equal(store.claimPreparedSession('d'.repeat(64),null,12,{intervalMs:0}),undefined);
  assert.throws(()=>store.switchSession(a.session,b.session.id),/SESSION_OWNER_SCOPE_REQUIRED/);
  put('3'.repeat(32),3,'3'.repeat(64));
  const next=store.claimPreparedSession('a'.repeat(64),a.session,3,{intervalMs:0});assert.equal(next.session.family_id,a.session.id);assert.equal(store.switchSession(a.session,next.session.id).session.id,next.session.id);
 }finally{second.close();store.close();rmSync(directory,{recursive:true,force:true});}
});

test('a prepared pool retains visitor rate limits and cannot claim unfinished or expiring wallets',()=>{
 const directory=mkdtempSync(path.join(tmpdir(),'ach-prepared-admission-')),store=new StateStore(path.join(directory,'store.sqlite')),now=Date.now();
 try{
  store.putSession({id:'a'.repeat(32),created_at_ms:now,expires_at_ms:now+86400000,state:'READY',agent_count:3},'a'.repeat(64),'a'.repeat(64));
  const standby={id:'b'.repeat(32),created_at_ms:now,expires_at_ms:now+86400000,state:'PROVISIONING',agent_count:3,prepared_pool:true};store.putSession(standby,'b'.repeat(64),'c'.repeat(64));
  assert.equal(store.claimPreparedSession('b'.repeat(64),null,3),undefined);
  standby.state='READY';store.updateSession(standby);
  assert.throws(()=>store.claimPreparedSession('a'.repeat(64),null,3,{intervalMs:10000}),/WORKSPACE_RATE_LIMITED/);
  assert.throws(()=>store.claimPreparedSession('a'.repeat(64),null,3,{intervalMs:0,ipLimit:1}),/FREE_SESSION_QUOTA_REACHED/);
  standby.expires_at_ms=now+30000;store.updateSession(standby);store.db.prepare('UPDATE sessions SET expires_at=? WHERE id=?').run(standby.expires_at_ms,standby.id);
  assert.equal(store.claimPreparedSession('b'.repeat(64),null,3),undefined);
 }finally{store.close();rmSync(directory,{recursive:true,force:true});}
});

test('hosted owner identity files cannot select another wallet or deployment namespace',async()=>{
 const directory=mkdtempSync(path.join(tmpdir(),'ach-owner-scope-')),id='a'.repeat(32),root='ach-v4r2-demo-1234abcd.testnet',account_id=`r-${id.slice(0,12)}.${root}`;
 const config={protocol_version:4,workflow_revision:2,network:'testnet',root,vault:'ach-vault-v4r2-1234abcd.testnet',token:'ach-usdc-v4r2-1234abcd.testnet',decimals:6,rpc_url:'https://rpc.invalid'};
 const session={id,participants:[{kind:'research',account_id}]},filename=path.join(directory,'owners',id+'-research.json'),owner_secret=KeyPair.fromRandom('ed25519').toString();
 const sponsor=Object.assign(Object.create(DemoSponsor.prototype),{config,identityRoot:directory,owners:new Map()});
 mkdirSync(path.dirname(filename),{mode:0o700});
 try{
  writeFileSync(filename,JSON.stringify({account_id:'legacy-owner.testnet',owner_secret}),{mode:0o600});
  assert.throws(()=>sponsor.ownerFor(session,account_id),/SESSION_IDENTITY_SCOPE_REQUIRED/);
  assert.equal(sponsor.owners.size,0);
  sponsor.store={ensureSessionReservation(){throw new Error('SPONSOR_RESERVATION_ATTEMPTED');}};
  await assert.rejects(sponsor.provision(session),/SESSION_IDENTITY_SCOPE_REQUIRED/);
  writeFileSync(filename,JSON.stringify({account_id,owner_secret}));
  assert.equal(sponsor.ownerFor(session,account_id).transport.account_id,account_id);
  const foreign='r-'+id.slice(0,12)+'.historical-demo.testnet';
  writeFileSync(filename,JSON.stringify({account_id:foreign,owner_secret}));
  assert.throws(()=>sponsor.ownerFor({...session,participants:[{kind:'research',account_id:foreign}]},foreign),/SESSION_IDENTITY_SCOPE_REQUIRED/);
 }finally{rmSync(directory,{recursive:true,force:true});}
});
