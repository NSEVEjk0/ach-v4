import test from 'node:test';import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';import {tmpdir} from 'node:os';import path from 'node:path';
import {StateStore} from '../lib/store.mjs';import {IntentsQuotes,NEAR_USDC,BASE_USDC} from '../coordinator/intents.mjs';
test('route previews validate current asset identities, persist retries, expire and stay in the owning session',async()=>{
 const temp=mkdtempSync(path.join(tmpdir(),'ach-intents-test-')),store=new StateStore(path.join(temp,'routes.sqlite'));let now=Date.now(),calls=0;
 const tokens=[{assetId:NEAR_USDC,blockchain:'near',symbol:'USDC',decimals:6},{assetId:BASE_USDC,blockchain:'base',symbol:'USDC',decimals:6}];
 const client={tokens:async()=>tokens,quote:async request=>{calls++;return{correlationId:'fixture',quoteRequest:request,quote:{amountIn:request.amount,amountOut:'9900000',minAmountOut:'9800000',timeEstimate:30}};}};
 const quotes=new IntentsQuotes({store,client,clock:()=>now}),s={id:'session-one'},input={request_id:'a'.repeat(32),direction:'funding',amount:'10000000',recipient:'owner.near',refund_to:'0x'+'11'.repeat(20)};
 try{
  const first=await quotes.quote(s,input);assert.equal(first.dry,true);assert.equal(first.response.quote.depositAddress,undefined);assert.deepEqual(await quotes.quote(s,input),first);assert.equal(calls,1);
  await assert.rejects(quotes.quote(s,{...input,recipient:'attacker.near'}),/CONFLICT/);await assert.rejects(quotes.status({id:'another-session'},{id:input.request_id}),/SESSION_ROUTE/);
  await assert.rejects(quotes.quote(s,{...input,request_id:'b'.repeat(32),recipient:'owner.testnet'}),/ADDRESS/);
  now+=600001;assert.equal((await quotes.status(s,{id:input.request_id})).state,'EXPIRED');assert.equal(store.jobs(s.id).length,1);
  tokens[0].decimals=18;await assert.rejects(quotes.tokens(),/ASSET_UNAVAILABLE/);
 }finally{store.close();rmSync(temp,{recursive:true,force:true});}
});
