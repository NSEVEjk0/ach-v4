import test from 'node:test';import assert from 'node:assert/strict';
import {generateKeyPairSync,sign,randomBytes}from 'node:crypto';import {mkdtempSync,rmSync}from 'node:fs';import path from 'node:path';
import {spawn}from 'node:child_process';
import {fileURLToPath}from 'node:url';import {tmpdir}from 'node:os';
import {WasmChain,artifacts}from '../../tests/v4/wasm-chain.mjs';
import {AchV4Client,v4NetPlan}from '../../packages/client/dist/v4.js';
import {StateStore}from '../lib/store.mjs';import {ServiceAgent}from '../agents/runtime.mjs';import {Coordinator}from '../coordinator/coordinator.mjs';import {validateArtifact,chartArtifact}from '../agents/artifacts.mjs';
const config={protocol_version:4,network:'testnet',vault:'vault.commerce.testnet',token:'usd.commerce.testnet',decimals:6,rpc_url:'https://test.rpc.fastnear.com'};
const defaultConfig=config;
const repoRoot=fileURLToPath(new URL('../../',import.meta.url));
const methods=['propose_invoice','accept_invoice','authorize_private_purchase','propose_round','authorize_round','cancel_round_authorization','settle_round','expire_round','release_stale_round','expire_private_request'];
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
  chain.addKey(accountId,key,{methods,receiver:config.vault});chain.addKey(accountId,ownerKey,{owner:true});const owner=new AchV4Client(config,chain.transport(accountId,ownerKey,{owner:true}),'owner');await owner.register(kind);await owner.setPolicy({key,max_invoice:'100000',gross_budget:'1000000',max_net_commitment:'1000000',expires_at_ms:chain.now+86_400_000,counterparties:[],services:[]},`policy:${kind}`);await chain.invoke(config.token,'storage_deposit',{account_id:accountId});owners.set(kind,owner);
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
 const makeActor=kind=>{const actorStore=new StateStore(path.join(temp,`${kind}.sqlite`),{sealingKey:sealingKeys.get(kind)});actorStores.set(kind,actorStore);return new ServiceAgent({kind,config,store:actorStore,ingressSecret:'22'.repeat(32),getIdentity:async()=>identities.get(kind),clock:()=>chain.now,planner:async({brief,mode})=>({kind:'test-fixture',title:brief,needs_audit:mode==='report',source_indices:[0,1,2],summary:'Commission the selected deliverable and validate the requested schema.'}),dispatch:(provider,s,r)=>actors.get(provider).handle(s,r),verifyPrivate:(s,r)=>coordinator.verifyPrivateReceipt(s,r)});};
 for(const kind of ['research','visual','audit'])actors.set(kind,makeActor(kind));
 const agents={runBrief:(s,r)=>actors.get('research').runBrief(s,r),propose:(kind,s,r)=>actors.get(kind).propose(s,r),approve:(kind,s,r)=>actors.get(kind).approve(s,r)};
 agents.privateSummary=(kind,s)=>actors.get(kind).privateSummary(s);
 agents.disclosePrivate=(kind,s,r)=>actors.get(kind).disclosePrivate(s,r);
 coordinator=new Coordinator({store,config,getClient:async()=>identities.get('coordinator').client,getPrivateClient:async()=>owners.get('coordinator'),agents,sponsor:{},clock:()=>chain.now});
 return{temp,config,chain,session,token,store,actors,actorStores,identities,owners,coordinator,workerRuns,
  restart:()=>{for(const s of actorStores.values())s.close();for(const kind of ['research','visual','audit'])actors.set(kind,makeActor(kind));coordinator=new Coordinator({store,config,getClient:async()=>identities.get('coordinator').client,getPrivateClient:async()=>owners.get('coordinator'),agents,sponsor:{},clock:()=>chain.now});return coordinator;},
  cleanup:()=>{store.close();for(const s of actorStores.values())s.close();rmSync(temp,{recursive:true,force:true});}};
}
test('independent service agents produce accepted work, clear, restart and withdraw without duplicate charges',async()=>{
 const h=await setup();try{
  const request={request_id:'11111111111111111111111111111111',brief:'Create a sourced chart about agent commerce',mode:'report',privacy:'public'};
  const result=await h.coordinator.run(h.session,request);assert.equal(result.chart.kind,'chart');assert.equal(result.chart.audit.valid,true);assert.equal(result.references.references.length,3);assert.equal(validateArtifact('chart',result.chart),true);
  const before=await h.coordinator.snapshot(h.session);assert.equal(before.invoices.length,3);assert.ok(before.invoices.every(i=>i.status==='ACCEPTED'));assert.equal(new Set(before.invoices.map(i=>i.spec.seller)).size,3);
  const plan=v4NetPlan(before.invoices.map(i=>i.spec));assert.equal(plan.net_settlement_volume,'20000');const clearRequest={request_id:'22222222222222222222222222222222',selected_accounts:h.session.participants.map(p=>p.account_id),invoice_ids:before.invoices.map(i=>i.spec.id)};
  const [a,b]=await Promise.all([h.coordinator.clear(h.session,clearRequest),h.coordinator.clear(h.session,clearRequest)]);assert.equal(a.round.status,'SETTLED');assert.equal(b.round.hash,a.round.hash);
  const restarted=h.restart();const again=await restarted.run(h.session,request);assert.equal(again.chart.sha256,result.chart.sha256);await restarted.clear(h.session,clearRequest);const after=await restarted.snapshot(h.session);assert.equal(after.invoices.length,3);assert.equal(after.rounds.length,1);
  assert.equal(after.balances.find(b=>b.account_id.startsWith('research.')).available,'980000');assert.equal(after.balances.find(b=>b.account_id.startsWith('audit.')).available,'20000');
  await h.owners.get('audit').withdraw('agent-owner-cashout','20000');assert.equal((await h.owners.get('audit').withdrawal('agent-owner-cashout')).status,'COMPLETED');
 }finally{h.cleanup();}
});
test('one-way work settles at maximum waiting without compression',async()=>{const h=await setup();try{await h.coordinator.run(h.session,{request_id:'33333333333333333333333333333333',brief:'Make a chart without buying an audit',mode:'chart',privacy:'public'});const before=await h.coordinator.snapshot(h.session);assert.equal(before.invoices.length,1);h.chain.now+=31_000;await h.coordinator.tick();const after=await h.coordinator.snapshot(h.store.session(h.session.id));assert.equal(after.invoices[0].status,'SETTLED');assert.equal(after.rounds[0].net_settlement_volume,'100000');assert.equal(after.rounds[0].gross_invoice_volume,'100000');}finally{h.cleanup();}});
test('lost proposal responses and missing indexes recover funded rounds without rebilling',async()=>{
 const h=await setup();try{
  const request={request_id:'7'.repeat(32),brief:'Create a chart and audit its sources',mode:'report',privacy:'public'};
  await h.coordinator.run(h.session,request);
  const before=await h.coordinator.snapshot(h.session),clear={request_id:'8'.repeat(32),selected_accounts:h.session.participants.map(p=>p.account_id),invoice_ids:before.invoices.map(i=>i.spec.id)};
  const client=h.identities.get('coordinator').client,propose=client.proposeRound.bind(client);let proposals=0;
  client.proposeRound=async(...args)=>{proposals++;await propose(...args);throw new Error('SERVICE_OR_CHAIN_UNAVAILABLE');};
  await assert.rejects(h.coordinator.clear(h.session,clear),/SERVICE_OR_CHAIN_UNAVAILABLE/);
  const intent=h.store.job('clear-'+clear.request_id);
  assert.equal(intent.state,'WAITING');assert.ok(h.store.session(h.session.id).round_ids.includes(intent.round_id));
  let round=await client.round(intent.round_id);
  for(const p of round.input.positions)round=(await h.actors.get(h.session.participants.find(a=>a.account_id===p.account_id).kind).approve(h.session,round)).value;
  assert.equal(round.status,'READY');
  // Simulate the missing index left by the previous runtime, while keeping
  // its signed proposal journal and the actual funded contract round intact.
  const forget=()=>{const session=h.store.session(h.session.id);session.round_ids=[];h.store.updateSession(session);};
  forget();let restarted=h.restart();
  const funded=await restarted.snapshot(h.store.session(h.session.id));assert.equal(funded.rounds.length,1);assert.equal(funded.rounds[0].status,'READY');
  assert.ok(h.store.session(h.session.id).round_ids.includes(intent.round_id));
  forget();h.chain.now+=11000;await restarted.tick();
  assert.equal(h.store.job('clear-'+clear.request_id).state,'COMPLETE');
  forget();restarted=h.restart();const settled=await restarted.snapshot(h.store.session(h.session.id));
  assert.equal(settled.rounds.length,1);assert.equal(settled.rounds[0].status,'SETTLED');assert.ok(settled.invoices.every(i=>i.status==='SETTLED'));
  assert.equal(settled.balances.find(b=>b.account_id.startsWith('research.')).available,'980000');
  assert.equal(settled.balances.find(b=>b.account_id.startsWith('audit.')).available,'20000');
  await restarted.run(h.session,request);await restarted.clear(h.session,clear);assert.equal(proposals,1);assert.equal((await restarted.snapshot(h.store.session(h.session.id))).invoices.length,3);
 }finally{h.cleanup();}
});
test('private requests fail before plaintext storage; session artifacts and operation IDs are isolated',async()=>{const h=await setup();try{assert.throws(()=>h.coordinator.authenticate('b'.repeat(64)),/SESSION_EXPIRED/);await assert.rejects(h.coordinator.run(h.session,{request_id:'44444444444444444444444444444444',brief:'secret terms',mode:'report',privacy:'private'}),/PRIVATE_MODE_UNAVAILABLE/);assert.equal(h.store.jobs(h.session.id).length,0);const request={request_id:'55555555555555555555555555555555',brief:'Make a harmless demonstration chart',mode:'chart',privacy:'public'};await h.coordinator.run(h.session,request);await assert.rejects(h.coordinator.run(h.session,{...request,brief:'Change the signed purchase'}),/REQUEST_ID_CONFLICT/);const artifact=chartArtifact('<script>alert(1)</script>',[{label:'<img src=x>',value:1}]);assert.ok(!artifact.svg.includes('<script>'));assert.equal(validateArtifact('chart',artifact),true);}finally{h.cleanup();}});
test('fourth agent retains its signing key and independently joins a funded clearing round',async()=>{const h=await setup();try{const external='external.commerce.testnet';const {publicKey}=generateKeyPairSync('ed25519');const key=publicKey.export({type:'spki',format:'der'}).subarray(-32).toString('hex');const ownerKey='e'.repeat(64);h.chain.addKey(external,key,{methods,receiver:config.vault});h.chain.addKey(external,ownerKey,{owner:true});const owner=new AchV4Client(config,h.chain.transport(external,ownerKey,{owner:true}),'owner');await owner.register('External agent');await owner.setPolicy({key,max_invoice:'100000',gross_budget:'100000',max_net_commitment:'100000',expires_at_ms:h.chain.now+86_400_000,counterparties:[],services:[]},'external-policy');const client=new AchV4Client(config,h.chain.transport(external,key));
 const seller=h.identities.get('research');const spec={id:'external-bill',purchase_id:'external-purchase',terms_version:1,buyer:external,seller:seller.account_id,asset:config.token,amount:'80000',service:'references',terms_hash:'a'.repeat(64),artifact_hash:'b'.repeat(64),ready_at_ms:h.chain.now,expires_at_ms:h.chain.now+100_000};const bill=(await seller.client.proposeInvoice(spec)).value;await seller.client.acceptInvoice(bill);await client.acceptInvoice(bill);await h.chain.invoke(config.token,'mint',{account_id:external,amount:'80000'},{account:'desk.commerce.testnet',deposit:1n});await owner.deposit('external-owned-funding','80000');let round=(await client.proposeRound('external-round',[spec.id],h.chain.now+30_000)).value;round=(await client.authorizeRound(round,'-80000')).value;round=(await seller.client.authorizeRound(round,'80000')).value;await client.settleRound(round);assert.equal((await client.balance()).available,'0');assert.equal((await seller.client.balance()).available,'1080000');assert.equal(h.identities.has('external'),false);
 }finally{h.cleanup();}});
test('an unincluded proposal does not block balances; final receipts stop repeated chain reads',async()=>{
 const h=await setup();try{
  const id='private-unincluded-intent',job=h.coordinator.prepareClear(h.session,{request_id:'6'.repeat(32),privacy:'private',selected_accounts:h.session.participants.slice(0,2).map(p=>p.account_id),invoice_ids:['a'.repeat(64)]});
  job.round_id=id;job.state='FAILED';job.error='CHAIN_EXECUTION_FAILED';h.store.saveJob(job);h.coordinator.appendRound(h.session,id);
  const session=h.store.session(h.session.id),snapshot=await h.coordinator.snapshot(session);assert.equal(snapshot.balances.length,3);assert.equal(snapshot.rounds.length,0);assert.equal(snapshot.financial_data_available,true);
  let reads=0;const reader={round:async()=>{reads++;return{status:'SETTLED',input:{id:'immutable-round'}};}};
  await h.coordinator.readRound(reader,'immutable-round');await h.coordinator.readRound(reader,'immutable-round');assert.equal(reads,1);
  h.coordinator.invalidateSnapshot(session.id);const actual=h.identities.get('coordinator').client.transport.view;
  h.identities.get('coordinator').client.transport.view=async(contract,method,args)=>{if(method==='get_round')throw Object.assign(new Error('RPC rate limit'),{cause:429});return actual(contract,method,args);};
  await assert.rejects(h.coordinator.snapshot(session),/RPC rate limit/);
 }finally{h.cleanup();}
});
