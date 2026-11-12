import test from 'node:test';
import assert from 'node:assert/strict';
import {planBrief}from '../agents/planner.mjs';
import {v4Digest}from '../../packages/client/dist/v4.js';
import {mkdtempSync,rmSync}from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {StateStore}from '../lib/store.mjs';
import {ServiceAgent}from '../agents/runtime.mjs';
const request={brief:'Create an audited chart of workload data.',mode:'report',budget:'300000',privacy:'public',data:[{label:'Calls',value:12}]};
const sources=[{name:'Fixture source',finding:'A controlled reference for this test.'}];
const valid={title:'Workload chart',needs_audit:true,source_indices:[0],summary:'Commission the chart and a schema audit within the authorized budget.'};
test('a malformed model plan gets one correction; valid output retains its actual response evidence',async()=>{
 let calls=0;const result=await planBrief(request,sources,{key:'test-only',model:'fixture-model',fetcher:async(url,options)=>{
  const body=JSON.parse(options.body);calls++;if(calls===2)assert.match(body.messages[0].content,/previous response/);
  return new Response(JSON.stringify({id:'fixture-response-'+calls,model:'fixture-model',choices:[{message:{content:calls===1?'malformed JSON':JSON.stringify(valid)}}]}));
 }});
 assert.equal(calls,2);assert.equal(result.kind,'llm');assert.equal(result.response_id,'fixture-response-2');assert.deepEqual(result.attempts.map(a=>a.valid),[false,true]);
});
test('model corrections remain bounded and cannot authorize a price or a different budget',async()=>{
 let calls=0;await assert.rejects(planBrief(request,sources,{key:'test-only',model:'fixture-model',fetcher:async()=>{calls++;return new Response(JSON.stringify({id:'bad',model:'fixture-model',choices:[{message:{content:JSON.stringify({...valid,price:'0'})}}]}));}}),/AI_PLAN_INVALID/);assert.equal(calls,2);
 await assert.rejects(planBrief({...request,mode:'chart',budget:'100000'},sources,{key:'test-only',model:'fixture-model',fetcher:async()=>new Response(JSON.stringify({id:'bad-budget',model:'fixture-model',choices:[{message:{content:JSON.stringify(valid)}}]}))}),/AI_PLAN_OUTSIDE_BUDGET/);
});
test('private planning pins the credential endpoint, redacts input and preserves streamed UTF-8 response evidence',async()=>{
 const privateRequest={...request,privacy:'private',brief:'Secret brief 92713',data:[{label:'Secret label 92713',value:12}]};
 const raw=JSON.stringify({id:'streamed-fixture',model:'fixture-model',choices:[{message:{content:JSON.stringify({...valid,title:'Workload café chart'})}}],usage:{total_tokens:42}}),bytes=Buffer.from(raw);let offset=0;
 const result=await planBrief(privateRequest,sources,{key:'test-only',model:'fixture-model',fetcher:async(url,options)=>{
  assert.equal(url,'https://cloud-api.near.ai/v1/chat/completions');assert.equal(options.redirect,'error');assert.equal(options.headers.Authorization,'Bearer test-only');assert.ok(options.signal);
  const payload=JSON.parse(JSON.parse(options.body).messages[1].content);assert.equal(payload.labels,undefined);assert.ok(!JSON.stringify(payload).includes('92713'));
  return new Response(new ReadableStream({pull(controller){if(offset===bytes.length)return controller.close();controller.enqueue(bytes.subarray(offset,++offset));}},{highWaterMark:0}));
 }});
 assert.equal(result.title,'Workload café chart');assert.equal(result.response_hash,v4Digest(raw));assert.equal(result.attempts[0].response_hash,result.response_hash);assert.deepEqual(result.usage,{total_tokens:42});
});
test('an excessive declared planner response is cancelled without reading or retrying it',async()=>{
 let reads=0,cancelled=false,calls=0;
 const response=new Response(new ReadableStream({pull(){reads++;},cancel(){cancelled=true;}},{highWaterMark:0}),{headers:{'content-length':'20001'}});
 await assert.rejects(planBrief(request,sources,{key:'test-only',fetcher:async()=>{calls++;return response;}}),/AI_PLANNER_RESPONSE_TOO_LARGE/);
 assert.equal(reads,0);assert.equal(cancelled,true);assert.equal(calls,1);
});
test('planner byte limits stop undeclared multibyte responses before reading the remaining stream',async()=>{
 let reads=0,cancelled=false,calls=0;
 const response=new Response(new ReadableStream({pull(controller){reads++;controller.enqueue(Buffer.from('€'.repeat(4000)));},cancel(){cancelled=true;}},{highWaterMark:0}));
 await assert.rejects(planBrief(request,sources,{key:'test-only',fetcher:async()=>{calls++;return response;}}),/AI_PLANNER_RESPONSE_TOO_LARGE/);
 assert.equal(reads,2);assert.equal(cancelled,true);assert.equal(calls,1);
});
test('invalid UTF-8 from the planner cannot be silently replaced with a valid-looking plan',async()=>{
 const bytes=Buffer.from(JSON.stringify({id:'invalid-encoding',model:'fixture-model',choices:[{message:{content:JSON.stringify(valid)}}]}));bytes[bytes.indexOf('Workload')]=0xc0;
 await assert.rejects(planBrief(request,sources,{key:'test-only',model:'fixture-model',fetcher:async()=>new Response(bytes)}),/AI_PLANNER_RESPONSE_INVALID/);
});
test('a planner transport that followed a redirect is rejected before consuming its response',async()=>{
 let reads=0,cancelled=false;
 const response=new Response(new ReadableStream({pull(){reads++;},cancel(){cancelled=true;}},{highWaterMark:0}));Object.defineProperty(response,'redirected',{value:true});
 await assert.rejects(planBrief(request,sources,{key:'test-only',fetcher:async()=>response}),/AI_PLANNER_UNAVAILABLE/);
 assert.equal(reads,0);assert.equal(cancelled,true);
});

test('invalid model corrections cannot spend again through a second connection or a store restart',async()=>{
 const directory=mkdtempSync(path.join(os.tmpdir(),'ach-planner-budget-')),filename=path.join(directory,'state.sqlite');let first,second;let calls=0;
 try{
  first=new StateStore(filename);second=new StateStore(filename);first.startJob('brief-bounded','evaluation',{privacy:'public'});
  const fetcher=async()=>{calls++;return new Response(JSON.stringify({id:'invalid-plan',model:'fixture-model',choices:[{message:{content:'invalid JSON'}}]}));};
  await assert.rejects(planBrief(request,sources,{key:'test-only',model:'fixture-model',fetcher,reserveAttempt:()=>first.consumePlannerAttempt('brief-bounded')}),/AI_PLAN_INVALID/);
  assert.equal(calls,2);assert.throws(()=>second.consumePlannerAttempt('brief-bounded'),/AI_PLANNER_ATTEMPTS_EXHAUSTED/);
  first.close();first=new StateStore(filename);
  await assert.rejects(planBrief(request,sources,{key:'test-only',model:'fixture-model',fetcher,reserveAttempt:()=>first.consumePlannerAttempt('brief-bounded')}),/AI_PLANNER_ATTEMPTS_EXHAUSTED/);
  assert.equal(calls,2);
 }finally{first?.close();second?.close();rmSync(directory,{recursive:true,force:true});}
});

test('ambiguous transport failures consume a durable attempt before each real service request',async()=>{
 const directory=mkdtempSync(path.join(os.tmpdir(),'ach-planner-restart-')),filename=path.join(directory,'state.sqlite');let store;let calls=0;
 try{
  const input={...request,request_id:'e'.repeat(32)},session={id:'evaluation'};
  for(let restart=0;restart<3;restart++){
   store=new StateStore(filename);
   const actor=new ServiceAgent({kind:'research',config:{},store,planner:(brief,catalogue,options)=>planBrief(brief,catalogue,{...options,key:'test-only',model:'fixture-model',fetcher:async()=>{calls++;throw new Error('SERVICE_UNAVAILABLE');}})});
   await assert.rejects(actor.runBrief(session,input),restart<2?/SERVICE_UNAVAILABLE/:/AI_PLANNER_ATTEMPTS_EXHAUSTED/);
   store.close();store=null;
  }
  assert.equal(calls,2);
 }finally{store?.close();rmSync(directory,{recursive:true,force:true});}
});
