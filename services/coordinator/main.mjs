import path from 'node:path';
import {readFileSync,writeFileSync,existsSync}from 'node:fs';
import {randomBytes}from 'node:crypto';
import {loadConfig,loadIdentity}from '../lib/config.mjs';
import {AchV4Client,V4NearTransport}from '../../packages/client/dist/v4.js';
import {StateStore}from '../lib/store.mjs';
import {serve,readJson,serviceFetch,sessionBearer}from '../lib/http.mjs';
import {Coordinator}from './coordinator.mjs';
import {IntentsQuotes}from './intents.mjs';
import {NettingTester}from './netting-test.mjs';
import {KeyPair}from '../../packages/client/dist/near.js';
import {SERVICES}from '../agents/runtime.mjs';
import {privatePath}from '../lib/paths.mjs';
import {requireIdentityAccount,sessionAccountId}from '../lib/workflow.mjs';
const config=loadConfig(),store=new StateStore(privatePath('coordinator.sqlite')),token=process.env.ACH_V4_SERVICE_TOKEN;
const identity=loadIdentity(privatePath('coordinator.json'),config,store);requireIdentityAccount(config,'coordinator',identity.data);await identity.client.assertDeployment();
const intents=new IntentsQuotes({store});
const owner=requireIdentityAccount(config,'coordinator',JSON.parse(readFileSync(privatePath('coordinator-owner.json'),'utf8')));
const privateClient=new AchV4Client(config,new V4NearTransport(owner.account_id,config.rpc_urls??config.rpc_url,owner.secret_key,store),'owner');
const call=(kind,payload,route)=>serviceFetch(config.services[kind],token)(route,payload);
const coordinator=new Coordinator({store,config,getClient:async()=>identity.client,getPrivateClient:async()=>privateClient,snapshotTtlMs:10000,
 agents:{runBrief:(s,r)=>call('research',{session_id:s.id,request:r},'/brief'),approve:(k,s,r)=>call(k,{session_id:s.id,round:r},'/approve'),privateSummary:(k,s)=>call(k,{session_id:s.id},'/private-summary'),disclosePrivate:(k,s,r)=>call(k,{session_id:s.id,request:r},'/private-disclosure')},
 sponsor:{createSession:(ip,agent_count=3)=>serviceFetch(config.services.demo,token)('/session',{ip_hash:ip,agent_count})}});
const testStorageKey=privatePath('netting-storage.key');
if(!existsSync(testStorageKey))writeFileSync(testStorageKey,randomBytes(32).toString('hex'),{mode:0o600,flag:'wx'});
const privateTestStore=new StateStore(privatePath('netting.sqlite'),{sealingKey:readFileSync(testStorageKey,'utf8').trim()}),testIdentities=new Map();
const tester=new NettingTester({store,privateStore:privateTestStore,config,getClient:async()=>identity.client,getPrivateClient:async()=>privateClient,onChange:id=>coordinator.invalidateSnapshot(id),getIdentity:async(session,participant)=>{
 const expected=sessionAccountId(config,session.id,participant.kind);if(expected!==participant.account_id)throw new Error('SESSION_IDENTITY_SCOPE_REQUIRED');
 const cacheKey=session.id+':'+participant.kind;
 if(!testIdentities.has(cacheKey)){const loaded=loadIdentity(privatePath('identities',participant.kind,session.id+'.json'),config,privateTestStore);if(loaded.account_id!==expected)throw new Error('SESSION_IDENTITY_SCOPE_REQUIRED');testIdentities.set(cacheKey,{...loaded,key:KeyPair.fromString(loaded.data.secret_key)});}
 return testIdentities.get(cacheKey);
}});coordinator.tester=tester;
let ticking=false;setInterval(async()=>{if(ticking)return;ticking=true;try{await coordinator.tick();}catch{console.error('ACH_V4_RECONCILIATION_UNAVAILABLE');}finally{ticking=false}},5000).unref();
serve({port:Number(new URL(config.services.coordinator).port),token,handle:async(req,url)=>{
 if(url.pathname==='/config'&&req.method==='GET')return{protocol_version:4,workflow_revision:config.workflow_revision,network:config.network,vault:config.vault,token:config.token,decimals:6,code_hash:config.code_hash,status:'deployed',privacy:{enabled:Boolean(config.private?.enabled),worker_hash:config.private?.hash},intents:config.intents,source_pushed:config.source?.repository_pushed===true};
 if(url.pathname==='/session'&&req.method==='POST'){const a=await readJson(req);return coordinator.start(a.ip_hash,a.agent_count??3);}
 if(url.pathname==='/verify-private-receipt'&&req.method==='POST'){const a=await readJson(req),s=store.session(a.session_id);if(!s||s.expires_at_ms<=Date.now())throw new Error('SESSION_EXPIRED');return coordinator.verifyPrivateReceipt(s,a);}
 if(url.pathname==='/prepare-private-group'&&req.method==='POST'){const a=await readJson(req),s=store.session(a.session_id);if(!s||s.expires_at_ms<=Date.now())throw new Error('SESSION_EXPIRED');return coordinator.preparePrivateGroup(s,a);}
 const bearer=sessionBearer(req),session=coordinator.authenticate(bearer);
 if(url.pathname==='/session'&&req.method==='GET')return{session:{id:session.id,state:session.state??'READY',expires_at_ms:session.expires_at_ms}};
 if(url.pathname==='/sessions'&&req.method==='GET')return{sessions:store.workspaceSessions(session)};
 if(['/session-new','/session-switch'].includes(url.pathname)&&req.method==='POST')return serviceFetch(config.services.demo,token)(url.pathname,await readJson(req),bearer);
 if(url.pathname==='/intents/tokens'&&req.method==='GET')return intents.tokens();
 if(url.pathname==='/intents/quote'&&req.method==='POST')return intents.quote(session,await readJson(req));
 if(url.pathname==='/intents/status'&&req.method==='POST')return intents.status(session,await readJson(req));
 if(url.pathname==='/snapshot'&&req.method==='GET')return coordinator.snapshot(session);
 if(url.pathname==='/history'&&req.method==='GET'){const value=url.searchParams.get('before');return store.eventPage(session.id,{before:value===null?null:Number(value)});}
 if(url.pathname==='/clearing-policy'&&req.method==='POST')return coordinator.setClearingPolicy(session,await readJson(req));
 if(url.pathname==='/run'&&req.method==='POST'){
  const request=await readJson(req);if(!/^[a-f\d-]{16,40}$/.test(request.request_id))throw new Error('INVALID_REQUEST_ID');
  const old=await coordinator.recoverCommittedRun(session,coordinator.prepareRun(session,request));if(old.state==='COMPLETE')return{state:'COMPLETE',job_id:old.id};
  if(old.state==='FAILED')throw new Error(old.error??'SERVICE_UNAVAILABLE');
  void coordinator.run(session,request).catch(()=>{});return{state:'STARTED',job_id:'run-'+request.request_id};
 }
 if(url.pathname==='/clear'&&req.method==='POST'){
  const request=await readJson(req);if(!/^[a-f\d-]{16,40}$/.test(request.request_id))throw new Error('INVALID_REQUEST_ID');
  const old=coordinator.prepareClear(session,request);if(old.state==='COMPLETE')return old.result;if(old.state==='FAILED')throw new Error(old.error??'CLEARING_FAILED');
  void coordinator.clear(session,request).catch(()=>{});return{state:'STARTED',round:null,job_id:'clear-'+request.request_id};
 }
 if(url.pathname==='/netting-test'&&req.method==='POST'){
  const request=await readJson(req),job=tester.prepare(session,request);
  if(job.state==='COMPLETE')return{state:'COMPLETE',job_id:job.id,result:job.result};
  if(job.state==='FAILED')throw new Error(job.error??'NETTING_TEST_FAILED');
  void tester.run(session,request).catch(()=>{});return{state:'STARTED',job_id:job.id};
 }
 if(['/withdraw','/revoke','/recover','/deposit','/cancel'].includes(url.pathname)&&req.method==='POST'){const result=await serviceFetch(config.services.demo,token)(url.pathname,await readJson(req),bearer);coordinator.invalidateSnapshot(session.id);return result;}
 if(url.pathname==='/private-key'&&req.method==='GET')return call('research',{session_id:session.id},'/encryption-key');
 if(['/settle','/expire'].includes(url.pathname)&&req.method==='POST'){const a=await readJson(req);coordinator.recoverRoundIndex(session);if(!session.round_ids?.includes(a.id))throw new Error('SESSION_ROUND_SCOPE_REQUIRED');const round=await identity.client.round(a.id);const result=await(url.pathname==='/settle'?identity.client.settleRound(round):identity.client.expireRound(a.id));if(url.pathname==='/settle')coordinator.recordSettlement(session,result);coordinator.invalidateSnapshot(session.id);return result;}
 if(url.pathname==='/services'&&req.method==='GET')return Object.entries(SERVICES).map(([id,s])=>({id,...s}));
 throw new Error('METHOD_NOT_FOUND');
}});
