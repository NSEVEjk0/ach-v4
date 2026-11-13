import test from 'node:test';
import assert from 'node:assert/strict';
import {localWebModules}from './web-modules.mjs';
const modules=localWebModules({components:true});test.after(()=>modules.cleanup());
const {createElement}=await import(modules.reactUrl),{renderToStaticMarkup}=await import(modules.reactServerUrl),{default:WorkForm}=await import(modules.url('WorkForm')),{default:NettingTest}=await import(modules.url('NettingTest'));

test('the actual work form allows a third and later brief, offers fresh workspaces, and preserves pending, stale and budget restrictions',()=>{
 const props={data:{session:{participants:[]},jobs:Array.from({length:4},()=>({state:'COMPLETE'})),privacy:{enabled:true}},brief:'Create a chart for the next evaluation',dataset:'Requests,12',mode:'report',budget:'300000',privacy:'public',pending:'',running:false,stale:false,onBrief:()=>{},onDataset:()=>{},onMode:()=>{},onBudget:()=>{},onPrivacy:()=>{},onRun:()=>{},onNewWorkspace:()=>{}};
 const render=extra=>renderToStaticMarkup(createElement(WorkForm,{...props,...extra})),button=html=>html.match(/<button\b[^>]*type="submit"[^>]*>/)?.[0];
 const html=render();assert.ok(button(html));assert.ok(!button(html).includes('disabled'));assert.ok(html.includes('Free demo briefs'));assert.ok(html.includes('Start another test workspace'));assert.ok(!/\b[0-2] free brief|briefs remaining/.test(html));
 for(const extra of [{stale:true},{running:true},{pending:'workspace'},{budget:'100000'}])assert.ok(button(render(extra)).includes('disabled'));
 assert.ok(!button(render({mode:'chart',budget:'100000'})).includes('disabled'));
});

test('fresh judge wallets remain available during stale balance reads while round execution and busy workspaces stay blocked',()=>{
 const session={id:'current-workspace',agent_count:12,judge_testing:true,participants:Array.from({length:3},(_,i)=>({account_id:'agent-'+i}))};
 const data={session,jobs:[],test_jobs:[],privacy:{enabled:true}};
 const props={data,pending:false,stale:true,onNewWorkspace:()=>{},onRefresh:()=>{},onRound:()=>{}};
 const render=extra=>renderToStaticMarkup(createElement(NettingTest,{...props,...extra}));
 const button=html=>html.match(/<button\b[^>]*class="button primary"[^>]*>/)?.[0];
 const preparing=render();assert.ok(preparing.includes('Prepare 12 judge wallets'));assert.ok(!button(preparing).includes('disabled'));
 // Preparing another workspace also remains available if private processing is offline.
 assert.ok(!button(render({data:{...data,privacy:{enabled:false}}})).includes('disabled'));
 for(const extra of [{pending:true},{data:{...data,jobs:[{state:'WAITING'}]}},{data:{...data,test_jobs:[{state:'STARTED',id:'active',agent_count:3}]}}])assert.ok(button(render(extra)).includes('disabled'));
 const ready={...data,session:{...session,participants:Array.from({length:12},(_,i)=>({account_id:'agent-'+i}))}};
 const staleRound=render({data:ready});assert.ok(staleRound.includes('Run signed netting test'));assert.ok(button(staleRound).includes('disabled'));
 assert.ok(!button(render({data:ready,stale:false})).includes('disabled'));
});
