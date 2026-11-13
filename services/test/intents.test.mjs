import test from 'node:test';import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';import {tmpdir} from 'node:os';import path from 'node:path';
import {StateStore} from '../lib/store.mjs';import {IntentsQuotes,NEAR_USDC,BASE_USDC} from '../coordinator/intents.mjs';
import {validIntentsAddress,normalizeIntentsAddress} from '../coordinator/intents-addresses.mjs';
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

test('catalogue routes retain native precision, NEP-245 and Chain Signatures identities, both directions and memo requirements',async()=>{
 const directory=mkdtempSync(path.join(tmpdir(),'ach-many-chains-')),store=new StateStore(path.join(directory,'quotes.sqlite'));let calls=0,tokenReads=0;
 const near={assetId:NEAR_USDC,blockchain:'near',symbol:'USDC',decimals:6};
 const assets=[
  {assetId:'nep141:btc.omft.near',blockchain:'btc',symbol:'BTC',decimals:8,address:'1BitcoinEaterAddressDontSendf59kuE',amount:'10000'},
  {assetId:'nep141:sol.omft.near',blockchain:'sol',symbol:'SOL',decimals:9,address:'11111111111111111111111111111111',amount:'100000000'},
  {assetId:'nep141:eth.omft.near',blockchain:'eth',symbol:'ETH',decimals:18,address:'0x'+'11'.repeat(20),amount:'123456789012345678'},
  {assetId:'nep245:v2_1.omni.hot.tg:1100_token',blockchain:'stellar',symbol:'XLM',decimals:7,address:'G'+'A'.repeat(55),amount:'100000001'},
  {assetId:'1cs_v1:hypercore:hip1:0x6d1e7cde53ba9467b783cb7c530ce054',blockchain:'hypercore',symbol:'USDC',decimals:8,address:'0x'+'22'.repeat(20),amount:'1000000000'},
  {assetId:'nep245:v2_1.omni.hot.tg:36900_native',blockchain:'adi',symbol:'ADI',decimals:18,address:'0x'+'33'.repeat(20),amount:'1000000000000000000'},
  {assetId:'nep141:qtc.omft.near',blockchain:'qtc',symbol:'QTC',decimals:12,address:'QTC1_example_chain_address',amount:'1000000000000'},
 ];
 const client={tokens:async()=>{tokenReads++;return[near,...assets];},quote:async request=>{calls++;return{correlationId:'quote-'+calls,quoteRequest:request,quote:{amountIn:request.amount,amountOut:'10000001',minAmountOut:'9900000',timeEstimate:30}};}};
 const routes=new IntentsQuotes({store,client}),session={id:'judge'};
 try{
  const [one,two]=await Promise.all([routes.tokens(),routes.tokens()]);assert.equal(one.length,8);assert.equal(two.length,8);assert.equal(tokenReads,1);
  for(const[assetIndex,asset]of assets.entries())for(const direction of ['funding','payout']){
   const input={request_id:(assetIndex*2+(direction==='payout'?1:0)+1).toString(16).padStart(32,'0'),asset_id:asset.assetId,direction,amount:direction==='funding'?asset.amount:'10000000',recipient:direction==='funding'?'judge.near':asset.address,refund_to:direction==='funding'?asset.address:'judge.near'};
   const result=await routes.quote(session,input);assert.equal(result.request.amount,input.amount);assert.equal(result.request.originAsset,direction==='funding'?asset.assetId:NEAR_USDC);assert.equal(result.request.destinationAsset,direction==='funding'?NEAR_USDC:asset.assetId);
   assert.equal(result.request.depositMode,direction==='funding'&&asset.blockchain==='stellar'?'MEMO':'SIMPLE');assert.equal(result.dry,true);
   assert.deepEqual(await routes.quote(session,input),result);
  }
  assert.equal(calls,14);
  await assert.rejects(routes.quote(session,{request_id:'f'.repeat(32),direction:'funding',asset_id:'nep141:unlisted.near',amount:'1',recipient:'judge.near',refund_to:'address'}),/VERIFIED_ROUTE_ASSETS/);
  assert.equal(validIntentsAddress('sol','0x'+'11'.repeat(20)),false);assert.equal(validIntentsAddress('near','judge.testnet'),false);assert.equal(validIntentsAddress('xrp','rDsbeomae4FXwgQTJp9Rs64Qg9vDiTCdBv:123'),false);assert.equal(validIntentsAddress('zec','u1'+'q'.repeat(120)),false);
 }finally{store.close();rmSync(directory,{recursive:true,force:true});}
});

test('48 route previews remain bounded and a provider response cannot substitute assets or identities',async()=>{
 const directory=mkdtempSync(path.join(tmpdir(),'ach-route-quota-')),store=new StateStore(path.join(directory,'routes.sqlite'));let corrupt=false;
 const client={tokens:async()=>[{assetId:NEAR_USDC,blockchain:'near',symbol:'USDC',decimals:6},{assetId:BASE_USDC,blockchain:'base',symbol:'USDC',decimals:6}],quote:async request=>({correlationId:'fixture',quoteRequest:corrupt?{...request,recipient:'attacker.near'}:request,quote:{amountIn:request.amount,amountOut:'10000000',minAmountOut:'9900000',timeEstimate:30}})};
 const routes=new IntentsQuotes({store,client}),session={id:'many-routes'},input={direction:'funding',amount:'10000000',recipient:'judge.near',refund_to:'0x'+'11'.repeat(20)};
 try{
  for(let n=0;n<48;n++)await routes.quote(session,{...input,request_id:n.toString(16).padStart(32,'0')});
  await assert.rejects(routes.quote(session,{...input,request_id:'f'.repeat(32)}),/SESSION_ROUTE_QUOTA/);
  await routes.quote(session,{...input,request_id:'0'.repeat(32)});
  corrupt=true;await assert.rejects(routes.quote({id:'different'},{...input,request_id:'e'.repeat(32)}),/QUOTE_IDENTITY_MISMATCH/);
  assert.equal(store.job('quote-'+'e'.repeat(32)).state,'STARTED');
 }finally{store.close();rmSync(directory,{recursive:true,force:true});}
});

test('verified alternative address forms quote in both directions with canonical request identities',async()=>{
 const directory=mkdtempSync(path.join(tmpdir(),'ach-address-forms-')),store=new StateStore(path.join(directory,'quotes.sqlite'));let calls=0,attack;
 // These public vectors also produced real mainnet dry quotes in both directions.
 const forms=[
  {chain:'doge',address:'AEc5iZhX1i5WQdRSvtgEBhVAGEC4eEe3Kr'},
  {chain:'dash',address:'7paTouunkdJFW2avnNgKGwrSVCeQMH8wcM'},
  {chain:'tron',address:'418840E6C55B9ADA326D211D818C34A994AECED808',canonical:'TNPeeaaFB7K9cmo4uQpcU32zGK8G1NYqeL'},
  {chain:'sui',address:'cc64b79a3adf4d3c21ad25a97e3ecbe83e659e68964f62e6a1da8a037346a4ce',canonical:'0xcc64b79a3adf4d3c21ad25a97e3ecbe83e659e68964f62e6a1da8a037346a4ce'},
  {chain:'zec',address:'tex1m2g868nlnyw64xnraxzukf4aeuffvn2wyxwjqx'},
  {chain:'btc',address:'BC1Q973XRRGJE6ETKKN9Q9AZZSGPXEDDATS8CKVP5S',canonical:'bc1q973xrrgje6etkkn9q9azzsgpxeddats8ckvp5s'},
 ];
 const tokens=[{assetId:NEAR_USDC,blockchain:'near',symbol:'USDC',decimals:6},...forms.map(f=>({assetId:'nep141:'+f.chain+'.omft.near',blockchain:f.chain,symbol:f.chain.toUpperCase(),decimals:8}))];
 const client={tokens:async()=>tokens,quote:async request=>{calls++;return{correlationId:'form-'+calls,quoteRequest:attack==='identity'?{...request,refundTo:forms[2].address}:request,quote:{amountIn:attack==='amount'?'124999999':request.amount,amountOut:'100000000',minAmountOut:'99000000',timeEstimate:30}};}};
 const routes=new IntentsQuotes({store,client}),session={id:'address-forms'};
 try{
  for(const[index,form]of forms.entries())for(const direction of ['funding','payout']){
   const input={request_id:(index*2+(direction==='payout'?1:0)+1).toString(16).padStart(32,'0'),direction,asset_id:tokens[index+1].assetId,amount:'125000000',recipient:direction==='funding'?'judge.near':form.address,refund_to:direction==='funding'?form.address:'judge.near'};
   assert.equal(validIntentsAddress(form.chain,form.address),true);
   const result=await routes.quote(session,input),canonical=form.canonical??form.address;
   assert.equal(result.request.recipient,direction==='funding'?'judge.near':canonical);assert.equal(result.request.refundTo,direction==='funding'?canonical:'judge.near');
   assert.equal(result.request.amount,input.amount);assert.equal(result.dry,true);assert.equal(result.request.dry,true);assert.equal(result.response.quote.depositAddress,undefined);
   assert.deepEqual(await routes.quote(session,input),result);assert.equal(direction==='funding'?input.refund_to:input.recipient,form.address);
  }
  assert.equal(calls,12);
  const input={request_id:'f'.repeat(32),direction:'funding',asset_id:tokens[3].assetId,amount:'125000000',recipient:'judge.near',refund_to:forms[2].address};
  attack='identity';await assert.rejects(routes.quote(session,input),/QUOTE_IDENTITY_MISMATCH/);assert.equal(store.job('quote-'+input.request_id).state,'STARTED');
  attack='amount';await assert.rejects(routes.quote(session,{...input,request_id:'e'.repeat(32)}),/QUOTE_AMOUNT_MISMATCH/);assert.equal(store.job('quote-'+'e'.repeat(32)).state,'STARTED');
 }finally{store.close();rmSync(directory,{recursive:true,force:true});}
});

test('address normalization does not admit unsupported prefixes, mixed case or truncated forms',()=>{
 assert.equal(normalizeIntentsAddress('tron','418840E6C55B9ADA326D211D818C34A994AECED808'),'TNPeeaaFB7K9cmo4uQpcU32zGK8G1NYqeL');
 assert.equal(normalizeIntentsAddress('sui','AB'.repeat(32)),'0x'+'ab'.repeat(32));
 assert.equal(validIntentsAddress('doge','9rXaYLQ5w7caWuWWsyCXDiFHNBtuwEqCmP'),false);
 assert.equal(validIntentsAddress('btc','BC1Q973xRRGJE6ETKKN9Q9AZZSGPXEDDATS8CKVP5S'),false);
 assert.equal(validIntentsAddress('tron','418840E6C55B9ADA326D211D818C34A994AECED80'),false);
 assert.equal(validIntentsAddress('tron','428840E6C55B9ADA326D211D818C34A994AECED808'),false);
 assert.equal(validIntentsAddress('sui','a'.repeat(63)),false);
 assert.equal(validIntentsAddress('zec','tex1'+'q'.repeat(37)),false);
 assert.equal(validIntentsAddress('zec','zs1'+'q'.repeat(75)),false);
 assert.equal(validIntentsAddress('tron',' 418840E6C55B9ADA326D211D818C34A994AECED808'),false);
});
