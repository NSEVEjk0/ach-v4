import test from 'node:test';
import assert from 'node:assert/strict';
import {V4RpcProvider}from '../dist/v4.js';
import {ContractExecutionError}from 'near-api-js/rpc-errors';
function clock(t){
 let now=Date.now();const waits=[];
 t.mock.method(Date,'now',()=>now);
 t.mock.method(globalThis,'setTimeout',(callback,delay,...args)=>{waits.push(delay);now+=delay;queueMicrotask(()=>callback(...args));return 1;});
 return{waits,advance:milliseconds=>{now+=milliseconds;}};
}
function connection(url,sendJsonRpc){return{connection:{url},sendJsonRpc};}
test('RPC failover preserves transaction bytes and does not retry contract failures',async()=>{
 const provider=new V4RpcProvider(['https://first.example','https://second.example']),calls=[];
 provider.connections=[{connection:{url:'https://first.example'},sendJsonRpc:async(method,params)=>{calls.push({method,params});throw Object.assign(new Error('rate limit'),{cause:429});}},{connection:{url:'https://second.example'},sendJsonRpc:async(method,params)=>{calls.push({method,params});return{status:{SuccessValue:''}};}}];
 const params={signed_tx_base64:'exact-public-signed-bytes',wait_until:'FINAL'};
 const result=await provider.sendJsonRpc('send_tx',params);assert.ok(result.status.SuccessValue!==undefined);assert.equal(calls.length,2);assert.equal(calls[0].params,calls[1].params);assert.equal(calls[1].params.signed_tx_base64,'exact-public-signed-bytes');
 const logical=new V4RpcProvider('https://third.example');let fallback=0;
 logical.connections=[{connection:{url:'https://third.example'},sendJsonRpc:async()=>{throw new Error('INSUFFICIENT_AVAILABLE_BALANCE');}},{connection:{url:'https://fourth.example'},sendJsonRpc:async()=>{fallback++;}}];
 await assert.rejects(logical.sendJsonRpc('query',{}),/INSUFFICIENT_AVAILABLE_BALANCE/);assert.equal(fallback,0);
});
test('a 515-second provider cooldown remains shared and fails promptly until its actual expiry',async t=>{
 const time=clock(t),url='https://long-cooldown.example',provider=new V4RpcProvider(url);let calls=0;
 const send=async()=>{if(++calls===1)throw Object.assign(new Error('Too many requests; retry after 515 seconds'),{cause:429});return{ready:true};};
 provider.connections=[connection(url,send)];
 await assert.rejects(provider.sendJsonRpc('query',{}),/^Error: RPC_UNAVAILABLE$/);assert.deepEqual(time.waits,[]);assert.equal(calls,1);
 const restarted=new V4RpcProvider(url);restarted.connections=[connection(url,send)];
 time.advance(60000);await assert.rejects(restarted.sendJsonRpc('query',{}),/RPC_UNAVAILABLE/);assert.equal(calls,1);assert.deepEqual(time.waits,[]);
 time.advance(452999);await assert.rejects(restarted.sendJsonRpc('query',{}),/RPC_UNAVAILABLE/);assert.equal(calls,1);
 time.advance(2001);assert.deepEqual(await restarted.sendJsonRpc('query',{}),{ready:true});assert.equal(calls,2);assert.deepEqual(time.waits,[]);
});
test('a short transport outage retries the exact payload once when its cooldown is eligible',async t=>{
 const time=clock(t),url='https://short-cooldown.example',provider=new V4RpcProvider(url),calls=[];
 provider.connections=[connection(url,async(method,params)=>{calls.push({method,params});if(calls.length===1)throw Object.assign(new Error('unavailable'),{cause:503});return{confirmed:true};})];
 const params={signed_tx_base64:'unchanged-serialized-signed-transaction',wait_until:'FINAL'};
 assert.deepEqual(await provider.sendJsonRpc('send_tx',params),{confirmed:true});assert.deepEqual(time.waits,[2000]);assert.equal(calls.length,2);assert.equal(calls[0].params,params);assert.equal(calls[1].params,params);assert.equal(calls[1].method,'send_tx');
});
test('simultaneous shorter transport failures cannot erase a provider rate-limit cooldown',async t=>{
 const time=clock(t),url='https://shared-cooldown.example',long=new V4RpcProvider(url),short=new V4RpcProvider(url);let releaseLong,releaseShort;
 const longReady=new Promise(resolve=>{releaseLong=resolve;}),shortReady=new Promise(resolve=>{releaseShort=resolve;});
 long.connections=[connection(url,async()=>{await longReady;throw Object.assign(new Error('retry after 515 seconds'),{cause:429});})];
 short.connections=[connection(url,async()=>{await shortReady;throw Object.assign(new Error('unavailable'),{cause:503});})];
 const longFailure=assert.rejects(long.sendJsonRpc('query',{}),/RPC_UNAVAILABLE/),shortFailure=assert.rejects(short.sendJsonRpc('query',{}),/RPC_UNAVAILABLE/);
 releaseLong();await longFailure;releaseShort();await shortFailure;assert.deepEqual(time.waits,[]);
 time.advance(60000);let calls=0;const probe=new V4RpcProvider(url);probe.connections=[connection(url,async()=>{calls++;return{};})];
 await assert.rejects(probe.sendJsonRpc('query',{}),/RPC_UNAVAILABLE/);assert.equal(calls,0);
});
test('typed contract rejections containing timeout text are returned without retry or failover',async t=>{
 const time=clock(t),provider=new V4RpcProvider(['https://contract-error.example','https://contract-fallback.example']),error=new ContractExecutionError('Smart contract panicked: application timeout','block-hash',1);let fallback=0;
 provider.connections=[connection('https://contract-error.example',async()=>{throw error;}),connection('https://contract-fallback.example',async()=>{fallback++;return{};})];
 await assert.rejects(provider.sendJsonRpc('query',{}),caught=>caught===error);assert.equal(fallback,0);assert.deepEqual(time.waits,[]);
});
test('HTTP rate-limit responses preserve provider cooldown and fail over with unchanged signed transaction bytes',async t=>{
 const time=clock(t),first='https://http-rate-limit.example',second='https://http-failover.example',provider=new V4RpcProvider([first,second]),requests=[];
 t.mock.method(globalThis,'fetch',async(url,options)=>{
  requests.push({url,body:JSON.parse(options.body)});
  return url===first?new Response('Too many requests; retry after 515 seconds',{status:429,headers:{'Retry-After':'515'}}):Response.json({jsonrpc:'2.0',id:requests.at(-1).body.id,result:{status:{SuccessValue:''}}});
 });
 const params={signed_tx_base64:'signed-public-bytes-never-regenerated',wait_until:'FINAL'};
 assert.deepEqual(await provider.sendJsonRpc('send_tx',params),{status:{SuccessValue:''}});
 assert.equal(requests.length,2);assert.deepEqual(requests[0].body.params,params);assert.deepEqual(requests[1].body.params,params);assert.deepEqual(time.waits,[]);
 time.advance(60000);await assert.rejects(new V4RpcProvider(first).sendJsonRpc('query',{}),/RPC_UNAVAILABLE/);assert.equal(requests.length,2);assert.deepEqual(time.waits,[]);
});
