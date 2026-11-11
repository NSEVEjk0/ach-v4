import path from 'node:path';
import {readFileSync}from 'node:fs';
import {loadConfig,loadIdentity}from '../lib/config.mjs';
import {AchV4Client,V4NearTransport}from '../../packages/client/dist/v4.js';
import {StateStore}from '../lib/store.mjs';
import {serve,readJson,serviceFetch,sessionBearer}from '../lib/http.mjs';
import {Coordinator}from './coordinator.mjs';
import {IntentsQuotes}from './intents.mjs';
import {SERVICES}from '../agents/runtime.mjs';
import {privatePath}from '../lib/paths.mjs';
const config=loadConfig(),store=new StateStore(privatePath('coordinator.sqlite')),token=process.env.ACH_V4_SERVICE_TOKEN;
const identity=loadIdentity(privatePath('coordinator.json'),config,store);await identity.client.assertDeployment();
const intents=new IntentsQuotes({store});
const owner=JSON.parse(readFileSync(privatePath('coordinator-owner.json'),'utf8'));
const privateClient=new AchV4Client(config,new V4NearTransport(owner.account_id,config.rpc_urls??config.rpc_url,owner.secret_key,store),'owner');
const call=(kind,payload,route)=>serviceFetch(config.services[kind],token)(route,payload);
const coordinator=new Coordinator({store,config,getClient:async()=>identity.client,getPrivateClient:async()=>privateClient,snapshotTtlMs:10000,
 agents:{runBrief:(s,r)=>call('research',{session_id:s.id,request:r},'/brief'),approve:(k,s,r)=>call(k,{session_id:s.id,round:r},'/approve'),privateSummary:(k,s)=>call(k,{session_id:s.id},'/private-summary'),disclosePrivate:(k,s,r)=>call(k,{session_id:s.id,request:r},'/private-disclosure')},
 sponsor:{createSession:ip=>serviceFetch(config.services.demo,token)('/session',{ip_hash:ip})}});
let ticking=false;setInterval(async()=>{if(ticking)return;ticking=true;try{await coordinator.tick();}catch{console.error('ACH_V4_RECONCILIATION_UNAVAILABLE');}finally{ticking=false}},5000).unref();
serve({port:Number(new URL(config.services.coordinator).port),token,handle:async(req,url)=>{
 if(url.pathname==='/config'&&req.method==='GET')return{protocol_version:4,network:config.network,vault:config.vault,token:config.token,decimals:6,code_hash:config.code_hash,status:'deployed',privacy:{enabled:Boolean(config.private?.enabled),worker_hash:config.private?.hash},intents:config.intents,source_pushed:false};
 if(url.pathname==='/session'&&req.method==='POST'){const a=await readJson(req);return coordinator.start(a.ip_hash);}
 if(url.pathname==='/verify-private-receipt'&&req.method==='POST'){const a=await readJson(req),s=store.session(a.session_id);if(!s||s.expires_at_ms<Date.now())throw new Error('SESSION_EXPIRED');return coordinator.verifyPrivateReceipt(s,a);}
 const bearer=sessionBearer(req),session=coordinator.authenticate(bearer);
 if(url.pathname==='/intents/tokens'&&req.method==='GET')return intents.tokens();
 if(url.pathname==='/intents/quote'&&req.method==='POST')return intents.quote(session,await readJson(req));
 if(url.pathname==='/intents/status'&&req.method==='POST')return intents.status(session,await readJson(req));
 if(url.pathname==='/snapshot'&&req.method==='GET')return coordinator.snapshot(session);
 if(url.pathname==='/run'&&req.method==='POST'){
  const request=await readJson(req);if(!/^[a-f\d-]{16,40}$/.test(request.request_id))throw new Error('INVALID_REQUEST_ID');
  const old=coordinator.prepareRun(session,request);if(old.state==='COMPLETE')return{state:'COMPLETE',job_id:old.id};
  if(old.state==='FAILED')throw new Error(old.error??'SERVICE_UNAVAILABLE');
  void coordinator.run(session,request).catch(()=>{});return{state:'STARTED',job_id:'run-'+request.request_id};
 }
 if(url.pathname==='/clear'&&req.method==='POST'){
  const request=await readJson(req);if(!/^[a-f\d-]{16,40}$/.test(request.request_id))throw new Error('INVALID_REQUEST_ID');
  const old=coordinator.prepareClear(session,request);if(old.state==='COMPLETE')return old.result;if(old.state==='FAILED')throw new Error(old.error??'CLEARING_FAILED');
  void coordinator.clear(session,request).catch(()=>{});return{state:'STARTED',round:null,job_id:'clear-'+request.request_id};
 }
 if(['/withdraw','/revoke','/recover','/deposit','/cancel'].includes(url.pathname)&&req.method==='POST'){const result=await serviceFetch(config.services.demo,token)(url.pathname,await readJson(req),bearer);coordinator.invalidateSnapshot(session.id);return result;}
 if(url.pathname==='/private-key'&&req.method==='GET')return call('research',{session_id:session.id},'/encryption-key');
 if(['/settle','/expire'].includes(url.pathname)&&req.method==='POST'){const a=await readJson(req);if(!session.round_ids?.includes(a.id))throw new Error('SESSION_ROUND_SCOPE_REQUIRED');const round=await identity.client.round(a.id);const result=await(url.pathname==='/settle'?identity.client.settleRound(round):identity.client.expireRound(a.id));coordinator.invalidateSnapshot(session.id);return result;}
 if(url.pathname==='/services'&&req.method==='GET')return Object.entries(SERVICES).map(([id,s])=>({id,...s}));
 throw new Error('METHOD_NOT_FOUND');
}});
