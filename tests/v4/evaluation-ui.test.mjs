import test from 'node:test';
import assert from 'node:assert/strict';
import {localWebModules}from './web-modules.mjs';
const modules=localWebModules({components:true});test.after(()=>modules.cleanup());
const {createElement}=await import(modules.reactUrl),{renderToStaticMarkup}=await import(modules.reactServerUrl),{default:WorkForm}=await import(modules.url('WorkForm'));

test('the actual work form allows a third and later brief, offers fresh workspaces, and preserves pending, stale and budget restrictions',()=>{
 const props={data:{session:{participants:[]},jobs:Array.from({length:4},()=>({state:'COMPLETE'})),privacy:{enabled:true}},brief:'Create a chart for the next evaluation',dataset:'Requests,12',mode:'report',budget:'300000',privacy:'public',pending:'',running:false,stale:false,onBrief:()=>{},onDataset:()=>{},onMode:()=>{},onBudget:()=>{},onPrivacy:()=>{},onRun:()=>{},onNewWorkspace:()=>{}};
 const render=extra=>renderToStaticMarkup(createElement(WorkForm,{...props,...extra})),button=html=>html.match(/<button\b[^>]*type="submit"[^>]*>/)?.[0];
 const html=render();assert.ok(button(html));assert.ok(!button(html).includes('disabled'));assert.ok(html.includes('Free demo briefs'));assert.ok(html.includes('Start another test workspace'));assert.ok(!/\b[0-2] free brief|briefs remaining/.test(html));
 for(const extra of [{stale:true},{running:true},{pending:'workspace'},{budget:'100000'}])assert.ok(button(render(extra)).includes('disabled'));
 assert.ok(!button(render({mode:'chart',budget:'100000'})).includes('disabled'));
});
