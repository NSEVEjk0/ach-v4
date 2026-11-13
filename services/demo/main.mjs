import path from 'node:path';import {readFileSync}from 'node:fs';
import {StateStore}from '../lib/store.mjs';import {loadConfig}from '../lib/config.mjs';import {serve,readJson,sessionBearer}from '../lib/http.mjs';import {DemoSponsor}from './sponsor.mjs';
import {privatePath}from '../lib/paths.mjs';
import {requireIdentityAccount}from '../lib/workflow.mjs';
const config=loadConfig(),rootIdentity=requireIdentityAccount(config,'root',JSON.parse(readFileSync(process.env.ACH_V4_ROOT_IDENTITY??privatePath('root.json'),'utf8')));const store=new StateStore(privatePath('coordinator.sqlite'));const sponsor=new DemoSponsor({store,config,rootIdentity,identityRoot:privatePath('identities')});
sponsor.resume();setInterval(()=>sponsor.resume(),5000).unref();
serve({port:config.service_layout.ports.demo,token:process.env.ACH_V4_SERVICE_TOKEN,handle:async(req,url)=>{
 if(url.pathname==='/session'&&req.method==='POST'){const body=await readJson(req);if(!/^[a-f\d]{64}$/.test(body.ip_hash))throw new Error('TRUSTED_RATE_LIMIT_ID_REQUIRED');return sponsor.createSession(body.ip_hash,undefined,{agent_count:body.agent_count??3});}
 const session=store.authenticate(sessionBearer(req));
 if(url.pathname==='/session-new'&&req.method==='POST'){const body=await readJson(req);return sponsor.createSession(body.ip_hash,session,{agent_count:body.agent_count??3});}
 if(url.pathname==='/session-switch'&&req.method==='POST'){const body=await readJson(req);return store.switchSession(session,body.session_id);}
 if(url.pathname==='/withdraw'&&req.method==='POST')return sponsor.withdraw(session,await readJson(req));if(url.pathname==='/revoke'&&req.method==='POST')return sponsor.revoke(session,await readJson(req));if(url.pathname==='/recover'&&req.method==='POST')return sponsor.recover(session,await readJson(req));if(url.pathname==='/deposit'&&req.method==='POST')return sponsor.deposit(session,await readJson(req));if(url.pathname==='/cancel'&&req.method==='POST')return sponsor.cancel(session,await readJson(req));throw new Error('METHOD_NOT_FOUND');
}});
