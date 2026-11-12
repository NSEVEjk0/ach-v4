import assert from 'node:assert/strict';
import {generateKeyPairSync,sign,randomBytes}from 'node:crypto';import {mkdtempSync,rmSync}from 'node:fs';import path from 'node:path';
import {spawn}from 'node:child_process';
import {fileURLToPath}from 'node:url';import {tmpdir}from 'node:os';
import {WasmChain,artifacts}from '../../../tests/v4/wasm-chain.mjs';
import {AchV4Client,v4NetPlan,v4PurchaseGroupId,v4FundedInvoiceId}from '../../../packages/client/dist/v4.js';
import {TRADING_METHODS}from '../../demo/sponsor.mjs';
import {StateStore}from '../../lib/store.mjs';import {ServiceAgent}from '../../agents/runtime.mjs';import {Coordinator}from '../../coordinator/coordinator.mjs';import {validateArtifact,chartArtifact}from '../../agents/artifacts.mjs';
export const config={protocol_version:4,workflow_revision:2,network:'testnet',vault:'vault.commerce.testnet',token:'usd.commerce.testnet',decimals:6,rpc_url:'https://test.rpc.fastnear.com'};
const defaultConfig=config;
const repoRoot=fileURLToPath(new URL('../../../',import.meta.url));
export const methods=[...TRADING_METHODS,'expire_private_request'];
async function privateWorker(input){
 const child=spawn(path.join(repoRoot,'target/debug/ach-private-netting'),[],{cwd:repoRoot,env:{...process.env,PROTECTED_INVOICE_KEY:'11'.repeat(32)},stdio:['pipe','pipe','pipe']});
 let stdout='',stderr='';child.stdout.on('data',bytes=>stdout+=bytes);child.stderr.on('data',bytes=>stderr+=bytes);
 const timer=setTimeout(()=>child.kill('SIGKILL'),10000);
 try{const done=new Promise((resolve,reject)=>{child.once('error',reject);child.once('close',(code,signal)=>code===0?resolve(stdout.trim()):reject(new Error('PRIVATE_FIXTURE_WORKER_FAILED:'+String(signal??code)+':'+stderr)));});child.stdin.end(input);return await done;}
 finally{clearTimeout(timer);}
}
export async function setup({privateMode=false}={}){
 const config={...defaultConfig,...(privateMode?{private:{enabled:true,hash:'c'.repeat(64),profile:'private-v4'}}:{})};
 const temp=mkdtempSync(path.join(tmpdir(),'ach-v4-test-'));const chain=new WasmChain({now:Date.now()}),workerRuns=[];await chain.deploy(config.vault,artifacts.vault);await chain.deploy(config.token,artifacts.token);
 const coordinatorId='desk.commerce.testnet';await chain.invoke(config.vault,'init',{network:'testnet',token:config.token,owner_id:coordinatorId,coordinator_id:coordinatorId,private_worker:null});await chain.invoke(config.token,'init',{owner_id:coordinatorId});await chain.invoke(config.token,'storage_deposit',{account_id:config.vault});
 const identities=new Map(),owners=new Map();const session={id:'1234567890abcdef1234567890abcdef',created_at_ms:chain.now,expires_at_ms:chain.now+86_400_000,participants:[],round_ids:[]};
 for(const kind of ['research','visual','audit','coordinator']){const accountId=kind==='coordinator'?coordinatorId:`${kind}.commerce.testnet`;const {publicKey,privateKey}=generateKeyPairSync('ed25519');const key=publicKey.export({type:'spki',format:'der'}).subarray(-32).toString('hex'),ownerKey='f'.repeat(64);
  chain.addKey(accountId,key,{methods,receiver:config.vault});chain.addKey(accountId,ownerKey,{owner:true});const owner=new AchV4Client(config,chain.transport(accountId,ownerKey,{owner:true}),'owner');
  await chain.invoke(config.vault,'authorize_account_registration',{account_id:accountId,name:kind,expires_at_ms:session.expires_at_ms},{account:coordinatorId,deposit:1n});
  await owner.register(kind);await owner.setPolicy({key,max_invoice:'100000',gross_budget:'1000000',max_net_commitment:'1000000',expires_at_ms:chain.now+86_400_000,counterparties:[],services:[]},`policy:${kind}`);await chain.invoke(config.token,'storage_deposit',{account_id:accountId});owners.set(kind,owner);
  identities.set(kind,{account_id:accountId,key:{sign:hash=>({signature:sign(null,hash,privateKey)})},client:new AchV4Client(config,chain.transport(accountId,key))});
  if(kind!=='coordinator')session.participants.push({kind,name:kind,account_id:accountId,public_key:key});
 }
 await chain.invoke(config.token,'mint',{account_id:identities.get('research').account_id,amount:'1000000'},{account:coordinatorId,deposit:1n});await owners.get('research').deposit('initial','1000000');
 if(privateMode){
  chain.externals.set('outlayer.testnet',async(method,args,{predecessor})=>{
   assert.equal(method,'request_execution');assert.equal(predecessor,config.vault);assert.equal(args.source.WasmUrl.hash,config.private.hash);
   const output=await privateWorker(args.input_data);workerRuns.push({input:JSON.parse(args.input_data),output:JSON.parse(output)});return output;
  });
  await chain.invoke(config.vault,'pin_private_worker',{worker:{outlayer_account:'outlayer.testnet',url:'https://example.com/private.wasm',hash:config.private.hash,profile:config.private.profile}},{account:config.vault,deposit:1n});
  await chain.invoke(config.vault,'request_private_encryption_key',{profile:config.private.profile},{account:coordinatorId,deposit:20_000_000_000_000_000_000_000n});
  assert.ok(await identities.get('coordinator').client.privateEncryptionKey(),'the worker key must be recorded by the actual vault callback');
 }
 const store=new StateStore(path.join(temp,'coordinator.sqlite')),actorStores=new Map(),sealingKeys=new Map(['research','visual','audit'].map(k=>[k,randomBytes(32).toString('hex')]));const token=randomBytes(32).toString('hex');store.putSession(session,token,'a'.repeat(64));let actors=new Map(),coordinator;
 const identityGroups=new Map([[session.id,identities]]),ownerGroups=new Map([[session.id,owners]]);
 const makeActor=kind=>{const actorStore=new StateStore(path.join(temp,`${kind}.sqlite`),{sealingKey:sealingKeys.get(kind)});actorStores.set(kind,actorStore);return new ServiceAgent({kind,config,store:actorStore,ingressSecret:'22'.repeat(32),getIdentity:async sessionId=>{const identity=identityGroups.get(sessionId)?.get(kind);if(!identity)throw new Error('SESSION_IDENTITY_SCOPE_REQUIRED');return identity;},clock:()=>chain.now,planner:async({brief,mode})=>({kind:'test-fixture',title:brief,needs_audit:mode==='report',source_indices:[0,1,2],summary:'Commission the selected deliverable and validate the requested schema.'}),dispatch:(provider,s,r)=>actors.get(provider).handle(s,r),verifyPrivate:(s,r)=>coordinator.verifyPrivateReceipt(s,r),preparePrivateGroup:(s,r)=>coordinator.preparePrivateGroup(s,r)});};
 async function addWorkspace(next){
  if(identityGroups.has(next.id))return store.session(next.id);
  chain.now=Math.max(chain.now,Date.now());
  const nextIdentities=new Map(),nextOwners=new Map();
  for(const kind of ['research','visual','audit']){
   const accountId=`${kind[0]}-${next.id.slice(0,12)}.commerce.testnet`,{publicKey,privateKey}=generateKeyPairSync('ed25519'),key=publicKey.export({type:'spki',format:'der'}).subarray(-32).toString('hex'),ownerKey='f'.repeat(64);
   chain.addKey(accountId,key,{methods,receiver:config.vault});chain.addKey(accountId,ownerKey,{owner:true});
   const owner=new AchV4Client(config,chain.transport(accountId,ownerKey,{owner:true}),'owner');
   await chain.invoke(config.vault,'authorize_account_registration',{account_id:accountId,name:kind,expires_at_ms:next.expires_at_ms},{account:coordinatorId,deposit:1n});
   await owner.register(kind);await owner.setPolicy({key,max_invoice:'100000',gross_budget:'1000000',max_net_commitment:'1000000',expires_at_ms:next.expires_at_ms,counterparties:[],services:[]},`policy:${next.id}:${kind}`);await chain.invoke(config.token,'storage_deposit',{account_id:accountId});
   nextOwners.set(kind,owner);nextIdentities.set(kind,{account_id:accountId,key:{sign:hash=>({signature:sign(null,hash,privateKey)})},client:new AchV4Client(config,chain.transport(accountId,key))});next.participants.push({kind,name:kind,account_id:accountId,public_key:key});
  }
  identityGroups.set(next.id,nextIdentities);ownerGroups.set(next.id,nextOwners);
  const research=nextIdentities.get('research').account_id;await chain.invoke(config.token,'mint',{account_id:research,amount:'1000000'},{account:coordinatorId,deposit:1n});await nextOwners.get('research').deposit(next.id,'1000000');
  next.state='READY';store.updateSession(next);store.event(next.id,'session-ready',next.id,{testnet:false,local_wasm:true});return next;
 }
 for(const kind of ['research','visual','audit'])actors.set(kind,makeActor(kind));
 const agents={runBrief:(s,r)=>actors.get('research').runBrief(s,r),propose:(kind,s,r)=>actors.get(kind).propose(s,r),approve:(kind,s,r)=>actors.get(kind).approve(s,r)};
 agents.privateSummary=(kind,s)=>actors.get(kind).privateSummary(s);
 agents.disclosePrivate=(kind,s,r)=>actors.get(kind).disclosePrivate(s,r);
 coordinator=new Coordinator({store,config,getClient:async()=>identities.get('coordinator').client,getPrivateClient:async()=>owners.get('coordinator'),agents,sponsor:{},clock:()=>chain.now});
 return{temp,config,chain,session,token,store,actors,actorStores,identities,owners,ownerGroups,addWorkspace,coordinator,workerRuns,
  restart:()=>{for(const s of actorStores.values())s.close();for(const kind of ['research','visual','audit'])actors.set(kind,makeActor(kind));coordinator=new Coordinator({store,config,getClient:async()=>identities.get('coordinator').client,getPrivateClient:async()=>owners.get('coordinator'),agents,sponsor:{},clock:()=>chain.now});return coordinator;},
  cleanup:()=>{store.close();for(const s of actorStores.values())s.close();rmSync(temp,{recursive:true,force:true});}};
}
