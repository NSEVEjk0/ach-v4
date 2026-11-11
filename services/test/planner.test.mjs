import test from 'node:test';
import assert from 'node:assert/strict';
import {planBrief}from '../agents/planner.mjs';
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
