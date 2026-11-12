import path from 'node:path';
import {readFileSync}from 'node:fs';
import {loadConfig,loadIdentity}from '../lib/config.mjs';
import {StateStore}from '../lib/store.mjs';
import {serve,readJson,serviceFetch}from '../lib/http.mjs';
import {KeyPair}from '../../packages/client/dist/near.js';
import {ServiceAgent}from './runtime.mjs';
import {privatePath}from '../lib/paths.mjs';
import {sessionAccountId}from '../lib/workflow.mjs';
const config=loadConfig(),kind=process.env.ACH_AGENT_KIND;
if(!['research','visual','audit'].includes(kind))throw new Error('EXPLICIT_AGENT_KIND_REQUIRED');
const sealingKey=readFileSync(privatePath(kind+'-storage.key'),'utf8').trim(),ingressSecret=readFileSync(privatePath(kind+'-ingress.key'),'utf8').trim();
const store=new StateStore(privatePath(kind+'.sqlite'),{sealingKey}),sessions=new StateStore(privatePath('coordinator.sqlite')),identities=new Map(),token=process.env.ACH_V4_SERVICE_TOKEN;
const actor=new ServiceAgent({kind,config,store,ingressSecret,getIdentity:async id=>{
 if(!identities.has(id)){const expected=sessionAccountId(config,id,kind),i=loadIdentity(privatePath('identities',kind,id+'.json'),config,store);if(i.account_id!==expected||i.account_id!==sessions.session(id)?.participants.find(participant=>participant.kind===kind)?.account_id)throw new Error('SESSION_IDENTITY_SCOPE_REQUIRED');identities.set(id,{...i,key:KeyPair.fromString(i.data.secret_key)});}return identities.get(id);
},dispatch:(provider,session,request)=>serviceFetch(config.services[provider],token)('/purchase',{session_id:session.id,...request}),verifyPrivate:(session,request)=>serviceFetch(config.services.coordinator,token)('/verify-private-receipt',{session_id:session.id,...request}),preparePrivateGroup:(session,request)=>serviceFetch(config.services.coordinator,token)('/prepare-private-group',{session_id:session.id,...request})});
serve({port:config.service_layout.ports[kind],token,handle:async(req,url)=>{
 if(req.method!=='POST')throw new Error('METHOD_NOT_FOUND');const body=await readJson(req),session=sessions.session(body.session_id);
 if(!session||session.expires_at_ms<=Date.now())throw new Error('SESSION_EXPIRED');
 if(url.pathname==='/purchase')return actor.handle(session,body);
 if(url.pathname==='/brief')return actor.runBrief(session,body.request);
 if(url.pathname==='/propose')return actor.propose(session,body.request);
 if(url.pathname==='/approve')return actor.approve(session,body.round);
 if(url.pathname==='/private-summary')return actor.privateSummary(session);
 if(url.pathname==='/private-disclosure')return actor.disclosePrivate(session,body.request);
 if(url.pathname==='/encryption-key')return actor.encryptionKey(session);
 throw new Error('METHOD_NOT_FOUND');
}});
