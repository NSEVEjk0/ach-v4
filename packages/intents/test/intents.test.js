import test from 'node:test';import assert from 'node:assert/strict';
import {INTENTS_STATUS,routeState,reconcileRoute,assertQuoteMatches,validateQuoteRequest,OneClickIntents}from '../dist/index.js';
const request={dry:false,swapType:'EXACT_INPUT',slippageTolerance:100,originAsset:'nep141:eth.omft.near',destinationAsset:'nep141:usdc.near',amount:'100000',refundTo:'0xowner',recipient:'owner.near',deadline:new Date(Date.now()+600000).toISOString(),depositType:'ORIGIN_CHAIN',refundType:'ORIGIN_CHAIN',recipientType:'DESTINATION_CHAIN',depositMode:'SIMPLE'};
const quote={correlationId:'one',quoteRequest:request,quote:{depositAddress:'0xdeposit',amountIn:'100000',amountOut:'10000',minAmountOut:'9900',deadline:request.deadline,timeEstimate:30}};
const route={id:'r',request,response:quote,state:'QUOTED',destination_chain:'near'};
test('all official statuses remain distinct and SUCCESS needs destination evidence',()=>{assert.equal(INTENTS_STATUS.length,7);assert.equal(routeState('SUCCESS'),'AWAITING_RECEIPT');assert.equal(routeState('REFUNDED'),'REFUNDED');for(const status of INTENTS_STATUS){const r=reconcileRoute(route,{status,updatedAt:'now',quoteResponse:quote,swapDetails:{}});assert.notEqual(r.state,'RECEIVED');assert.equal(r.raw_status,status);}});
test('current catalogue asset schemes validate without weakening quote identity binding',()=>{
 for(const asset of ['nep141:btc.omft.near','nep245:v2_1.omni.hot.tg:1100_native','1cs_v1:hypercore:hip1:token'])validateQuoteRequest({...request,originAsset:asset});
 for(const asset of ['nep141:','unknown:token','nep245:invalid\nasset'])assert.throws(()=>validateQuoteRequest({...request,originAsset:asset}),/INVALID_ROUTE_ASSET/);
 assert.throws(()=>assertQuoteMatches(request,{...quote,quoteRequest:{...request,destinationAsset:'nep245:other:token'}}),/IDENTITY_MISMATCH/);
});
test('destination receipt checks chain, amount, asset, recipient and transaction',()=>{const status={status:'SUCCESS',updatedAt:'now',quoteResponse:quote,swapDetails:{destinationChainTxHashes:[{hash:'tx'}]}};const receipt={chain:'near',asset:request.destinationAsset,recipient:request.recipient,amount:'10000',tx_hash:'tx',confirmed:true};assert.equal(reconcileRoute(route,status,receipt).state,'RECEIVED');for(const invalid of [{...receipt,chain:'base'},{...receipt,recipient:'attacker.near'},{...receipt,amount:'9899'},{...receipt,tx_hash:'other'},{...receipt,confirmed:false}])assert.throws(()=>reconcileRoute(route,status,invalid),/MISMATCH/);});
test('mutated/refunded/expired routes cannot masquerade as paid',()=>{assert.throws(()=>assertQuoteMatches(request,{...quote,quoteRequest:{...request,recipient:'other.near'}}),/IDENTITY/);assert.throws(()=>assertQuoteMatches({...request,dry:true},{...quote,quoteRequest:{...request,dry:true}}),/DRY/);assert.throws(()=>validateQuoteRequest({...request,deadline:'2020-01-01'}),/DEADLINE/);const refunded=reconcileRoute(route,{status:'REFUNDED',updatedAt:'now',quoteResponse:quote,swapDetails:{}});assert.throws(()=>reconcileRoute(refunded,{status:'SUCCESS',updatedAt:'now',quoteResponse:quote,swapDetails:{}}),/TERMINAL/);});

test('status reconciliation binds the entire approved quote and failed routes cannot become paid',()=>{
 const status={status:'SUCCESS',updatedAt:'now',quoteResponse:quote,swapDetails:{}};
 for(const change of [q=>q.correlationId='other',q=>q.quote.amountOut='11000',q=>q.quote.minAmountOut='9000',q=>q.quote.deadline=new Date(Date.now()+300000).toISOString(),q=>q.quote.depositMemo='unexpected']){const changed=structuredClone(status);change(changed.quoteResponse);assert.throws(()=>reconcileRoute(route,changed),/ROUTE_STATUS_IDENTITY/);}
 assert.throws(()=>assertQuoteMatches({...request,depositMode:'MEMO'},{...quote,quoteRequest:{...request,depositMode:'MEMO'}}),/DEPOSIT_MODE/);
 const failed=reconcileRoute(route,{...status,status:'FAILED'});assert.throws(()=>reconcileRoute(failed,status),/TERMINAL/);assert.equal(reconcileRoute(failed,{...status,status:'REFUNDED'}).state,'REFUNDED');
});

test('authenticated Intents requests reject redirects and bound third-party response bodies',async()=>{
 let reads=0;const fetcher=async(url,options)=>{assert.ok(url.startsWith('https://1click.chaindefuser.com/v0/'));assert.equal(options.redirect,'error');assert.equal(options.headers.Authorization,'Bearer local-api-test');return new Response('{}',{headers:{'content-length':'2000001'}});};
 await assert.rejects(new OneClickIntents(fetcher,'local-api-test').tokens(),/ROUTE_RESPONSE_TOO_LARGE/);
 let cancelled=false;const stream=new ReadableStream({pull(controller){reads++;controller.enqueue(new Uint8Array(1000001));},cancel(){cancelled=true;}},{highWaterMark:0});
 await assert.rejects(new OneClickIntents(async()=>new Response(stream)).tokens(),/ROUTE_RESPONSE_TOO_LARGE/);assert.equal(reads,2);assert.equal(cancelled,true);
 await assert.rejects(new OneClickIntents(async()=>new Response(new Uint8Array([0xc0]))).tokens(),/INVALID_ROUTE_RESPONSE/);
 assert.deepEqual(await new OneClickIntents(async()=>new Response('[]')).tokens(),[]);
});
