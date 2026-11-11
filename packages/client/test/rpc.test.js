import test from 'node:test';
import assert from 'node:assert/strict';
import {V4RpcProvider}from '../dist/v4.js';
test('RPC failover preserves transaction bytes and does not retry contract failures',async()=>{
 const provider=new V4RpcProvider(['https://first.example','https://second.example']),calls=[];
 provider.connections=[{connection:{url:'https://first.example'},sendJsonRpc:async(method,params)=>{calls.push({method,params});throw Object.assign(new Error('rate limit'),{cause:429});}},{connection:{url:'https://second.example'},sendJsonRpc:async(method,params)=>{calls.push({method,params});return{status:{SuccessValue:''}};}}];
 const params={signed_tx_base64:'exact-public-signed-bytes',wait_until:'FINAL'};
 const result=await provider.sendJsonRpc('send_tx',params);assert.ok(result.status.SuccessValue!==undefined);assert.equal(calls.length,2);assert.equal(calls[0].params,calls[1].params);assert.equal(calls[1].params.signed_tx_base64,'exact-public-signed-bytes');
 const logical=new V4RpcProvider('https://third.example');let fallback=0;
 logical.connections=[{connection:{url:'https://third.example'},sendJsonRpc:async()=>{throw new Error('INSUFFICIENT_AVAILABLE_BALANCE');}},{connection:{url:'https://fourth.example'},sendJsonRpc:async()=>{fallback++;}}];
 await assert.rejects(logical.sendJsonRpc('query',{}),/INSUFFICIENT_AVAILABLE_BALANCE/);assert.equal(fallback,0);
});
