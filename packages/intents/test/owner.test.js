import test from 'node:test';
import assert from 'node:assert/strict';
import {OwnerIntentsRouter,ownerRouteHash,destinationReceiptVerifier,NearTokenRouteSender} from '../dist/owner.js';

const near={assetId:'nep141:usdc.near',symbol:'USDC',blockchain:'near',decimals:6,contractAddress:'usdc.near'},base={assetId:'nep141:base-usdc.omft.near',symbol:'USDC',blockchain:'base',decimals:6,contractAddress:'0x'+'22'.repeat(20)};
function setup(){
 const records=new Map(),withdrawals=new Map(),sends=new Map();let receipt,withdrawCount=0,sendCount=0,depositCount=0,loseResponse=true;
 const store={get:async id=>records.has(id)?structuredClone(records.get(id)):undefined,put:async r=>records.set(r.id,structuredClone(r))};
 const ach={deployment:{network:'mainnet',vault:'vault.near',token:'usdc.near'},transport:{account_id:'owner.near'},assertDeployment:async()=>{},withdrawal:async id=>withdrawals.get(id),withdraw:async(id,amount)=>{withdrawCount++;withdrawals.set(id,{status:'COMPLETED',amount,account_id:'owner.near',receiver_id:'owner.near'});},deposit:async(id,amount)=>{depositCount++;return{value:amount,evidence:'near_final',tx_hash:'vault-credit'};}};
 const api={tokens:async()=>[near,base],quote:async request=>({correlationId:'quote',quoteRequest:structuredClone(request),quote:{depositAddress:'deposit.near',amountIn:request.amount,amountOut:'10000000',minAmountOut:'9900000',deadline:request.deadline,timeEstimate:30}}),submitKnownDeposit:async()=>{},status:async()=>({status:'SUCCESS',updatedAt:new Date().toISOString(),quoteResponse:records.values().next().value.response,swapDetails:{destinationChainTxHashes:[{hash:'destination'}]}})};
 const request={dry:false,swapType:'EXACT_INPUT',slippageTolerance:100,originAsset:near.assetId,destinationAsset:base.assetId,amount:'10000000',refundTo:'owner.near',recipient:'0x'+'11'.repeat(20),deadline:new Date(Date.now()+600000).toISOString(),depositType:'ORIGIN_CHAIN',refundType:'ORIGIN_CHAIN',recipientType:'DESTINATION_CHAIN',depositMode:'SIMPLE'};
 const sender={account_id:'owner.near',asset_id:near.assetId,sendExactQuote:async(_route,id)=>{if(!sends.has(id)){sends.set(id,{tx_hash:'source',confirmed:true});sendCount++;if(loseResponse){loseResponse=false;throw new Error('SOURCE_RESPONSE_LOST');}}return sends.get(id);}};
 const router=()=>new OwnerIntentsRouter(ach,api,store,async()=>receipt);
 return{ach,api,records,store,request,sender,router,setReceipt:r=>receipt=r,counts:()=>({withdrawCount,sendCount,depositCount})};
}

test('an exact owner approval binds source, destination, refunds and the complete quote',async()=>{
 const h=setup(),id='1'.repeat(32),r=await h.router().prepare(id,'payout',h.request);
 await assert.rejects(h.router().execute(id,'0'.repeat(64),h.sender),/EXACT_OWNER/);assert.deepEqual(h.counts(),{withdrawCount:0,sendCount:0,depositCount:0});
 const changed=structuredClone(r);changed.request.recipient='0x'+'33'.repeat(20);h.records.set(id,changed);
 await assert.rejects(h.router().execute(id,r.approval_hash,h.sender),/BINDING/);
 h.records.set(id,r);await assert.rejects(h.router().prepare(id,'payout',{...h.request,amount:'1'}),/CONFLICT/);
 await assert.rejects(h.router().prepare('2'.repeat(32),'payout',{...h.request,refundTo:'coordinator.near'}),/OWNER_CONTROLLED/);
 assert.throws(()=>new OwnerIntentsRouter({...h.ach,deployment:{...h.ach.deployment,network:'testnet'}},h.api,h.store,async()=>undefined),/MAINNET/);
 assert.equal(r.approval_hash,ownerRouteHash(r));
});

test('restart after a lost source response does not withdraw or transfer twice; SUCCESS awaits destination evidence',async()=>{
 const h=setup(),id='3'.repeat(32),r=await h.router().prepare(id,'payout',h.request);
 await assert.rejects(h.router().execute(id,r.approval_hash,h.sender),/SOURCE_RESPONSE_LOST/);
 const pending=await h.router().execute(id,r.approval_hash,h.sender);assert.equal(pending.state,'AWAITING_RECEIPT');assert.deepEqual(h.counts(),{withdrawCount:1,sendCount:1,depositCount:0});
 h.setReceipt({chain:'base',asset:base.assetId,recipient:h.request.recipient,amount:'10000000',tx_hash:'destination',confirmed:true});
 const done=await h.router().refresh(id);assert.equal(done.state,'RECEIVED');await h.router().execute(id,r.approval_hash,h.sender);assert.deepEqual(h.counts(),{withdrawCount:1,sendCount:1,depositCount:0});
});

test('incoming routing credits ACH only through a separate, confirmed authenticated deposit',async()=>{
 const h=setup(),id='4'.repeat(32),request={...h.request,originAsset:base.assetId,destinationAsset:near.assetId,refundTo:h.request.recipient,recipient:'owner.near'};
 await h.router().prepare(id,'funding',request);await h.router().refresh(id);await assert.rejects(h.router().depositReceivedFunding(id),/CONFIRMED_OWNER/);assert.equal(h.counts().depositCount,0);
 h.setReceipt({chain:'near',asset:near.assetId,recipient:'owner.near',amount:'10000000',tx_hash:'destination',confirmed:true});await h.router().refresh(id);
 assert.equal((await h.router().depositReceivedFunding(id)).deposit_confirmed,true);await h.router().depositReceivedFunding(id);assert.equal(h.counts().depositCount,1);
});

test('receipt verification checks the independent token contract, recipient and chain confirmations',async()=>{
 const h=setup(),id='5'.repeat(32),r=await h.router().prepare(id,'payout',h.request);let head='0x100',contract=base.contractAddress,status='0x1';
 const topic='0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef',to='0x'+h.request.recipient.slice(2).padStart(64,'0');
 const fetcher=async(_url,options)=>{assert.equal(options.redirect,'error');const q=JSON.parse(options.body);return new Response(JSON.stringify({result:q.method==='eth_blockNumber'?head:{status,transactionHash:'destination',blockNumber:'0xf8',logs:[{address:contract,topics:[topic,'0x'+'00'.repeat(32),to],data:'0x'+(10000000n).toString(16).padStart(64,'0')}]}}));};
 const verifier=destinationReceiptVerifier([near,base],{nearRpc:'https://rpc.near.org',baseRpc:'https://mainnet.base.org',baseConfirmations:12,fetcher});
 const result={status:'SUCCESS',swapDetails:{destinationChainTxHashes:[{hash:'destination'}]}};
 assert.equal(await verifier(r,result),undefined,'nine blocks must not meet a twelve-block confirmation requirement');
 head='0x110';assert.equal((await verifier(r,result)).amount,'10000000');contract='0x'+'44'.repeat(20);assert.equal(await verifier(r,result),undefined);
 contract=base.contractAddress;status='0x0';assert.equal(await verifier(r,result),undefined);
});

test('concurrent router instances preserve one approved quote and one source operation',async()=>{
 const h=setup(),id='6'.repeat(32),originalQuote=h.api.quote;let quotes=0;
 h.api.quote=async request=>{quotes++;await new Promise(resolve=>setTimeout(resolve,10));return originalQuote(request);};
 const [first,second]=await Promise.all([h.router().prepare(id,'payout',h.request),h.router().prepare(id,'payout',structuredClone(h.request))]);assert.equal(quotes,1);assert.equal(first.approval_hash,second.approval_hash);
 const executed=await Promise.allSettled([h.router().execute(id,first.approval_hash,h.sender),h.router().execute(id,first.approval_hash,h.sender)]);
 assert.equal(executed[0].status,'rejected');assert.equal(executed[1].status,'fulfilled');assert.deepEqual(h.counts(),{withdrawCount:1,sendCount:1,depositCount:0});assert.equal(h.records.get(id).source_submission_recorded,true);
});

test('concurrent funding refresh cannot erase a confirmed deposit or consume a batch surplus',async()=>{
 const h=setup(),id='7'.repeat(32),request={...h.request,originAsset:base.assetId,destinationAsset:near.assetId,refundTo:h.request.recipient,recipient:'owner.near'};
 await h.router().prepare(id,'funding',request);h.setReceipt({chain:'near',asset:near.assetId,recipient:'owner.near',amount:'20000000',tx_hash:'destination',confirmed:true});await h.router().refresh(id);
 const deposit=h.ach.deposit;let started,release,credited;const entered=new Promise(resolve=>started=resolve),pending=new Promise(resolve=>release=resolve);
 h.ach.deposit=async(id,amount)=>{credited=amount;started();await pending;return deposit(id,amount);};
 const status=h.api.status;h.api.status=async()=>{await new Promise(resolve=>setTimeout(resolve,20));return status();};
 const deposited=h.router().depositReceivedFunding(id);await entered;const refreshed=h.router().refresh(id);release();await Promise.all([deposited,refreshed]);
 assert.equal(credited,'10000000');assert.equal(h.records.get(id).deposit_amount,'10000000');assert.equal(h.records.get(id).deposit_confirmed,true);await h.router().depositReceivedFunding(id);assert.equal(h.counts().depositCount,1);
});

test('an expired lost source response can only be recovered without broadcasting again',async()=>{
 const h=setup(),id='8'.repeat(32);let now=Date.now();const router=new OwnerIntentsRouter(h.ach,h.api,h.store,async()=>undefined,()=>now),route=await router.prepare(id,'payout',h.request);
 await assert.rejects(router.execute(id,route.approval_hash,h.sender),/SOURCE_RESPONSE_LOST/);now=Date.parse(h.request.deadline);
 await assert.rejects(router.execute(id,route.approval_hash,h.sender),/QUOTE_EXPIRED/);assert.equal(h.counts().sendCount,1);
 let reconciled=0;h.sender.reconcileExactQuote=async()=>{reconciled++;return{tx_hash:'source',confirmed:true};};
 const recovered=await router.execute(id,route.approval_hash,h.sender);assert.equal(recovered.known_source_tx,'source');assert.equal(reconciled,1);assert.equal(h.counts().sendCount,1);
 const untouched=setup(),emptyId='9'.repeat(32);now=Date.now();const fresh=new OwnerIntentsRouter(untouched.ach,untouched.api,untouched.store,async()=>undefined,()=>now),quote=await fresh.prepare(emptyId,'payout',untouched.request);now=Date.parse(untouched.request.deadline);untouched.sender.reconcileExactQuote=h.sender.reconcileExactQuote;
 await assert.rejects(fresh.execute(emptyId,quote.approval_hash,untouched.sender),/QUOTE_EXPIRED/);assert.deepEqual(untouched.counts(),{withdrawCount:0,sendCount:0,depositCount:0});
});

test('a quote expiring during withdrawal cannot trigger a new source transfer',async()=>{
 const h=setup(),id='a'.repeat(32);let now=Date.now();const router=new OwnerIntentsRouter(h.ach,h.api,h.store,async()=>undefined,()=>now),route=await router.prepare(id,'payout',h.request),withdraw=h.ach.withdraw;
 h.ach.withdraw=async(...args)=>{await withdraw(...args);now=Date.parse(h.request.deadline);};
 await assert.rejects(router.execute(id,route.approval_hash,h.sender),/QUOTE_EXPIRED/);assert.deepEqual(h.counts(),{withdrawCount:1,sendCount:0,depositCount:0});
});

test('independent destination verification rejects substituted contracts, transactions and non-final NEAR execution',async()=>{
 const h=setup(),id='b'.repeat(32),request={...h.request,originAsset:base.assetId,destinationAsset:near.assetId,refundTo:h.request.recipient,recipient:'owner.near'},route=await h.router().prepare(id,'funding',request);let finality='EXECUTED',txHash='destination';
 const status={status:'SUCCESS',swapDetails:{destinationChainTxHashes:[{hash:'destination'}]}};
 const fetcher=async()=>new Response(JSON.stringify({result:{final_execution_status:finality,status:{SuccessValue:''},transaction:{hash:txHash},receipts_outcome:[{outcome:{executor_id:'usdc.near',status:{SuccessValue:''},logs:['EVENT_JSON:'+JSON.stringify({standard:'nep141',event:'ft_transfer',data:[{new_owner_id:'owner.near',amount:'10000000'}]})]}}]}}));
 const options={nearRpc:'https://rpc.near.org',baseRpc:'https://mainnet.base.org',fetcher},verify=destinationReceiptVerifier([near,base],options);
 assert.equal(await verify(route,status),undefined);finality='FINAL';assert.equal((await verify(route,status)).confirmed,true);
 txHash='substituted';assert.equal(await verify(route,status),undefined);txHash='destination';
 await assert.rejects(destinationReceiptVerifier([{...near,contractAddress:'forged.near'},base],options)(route,status),/VERIFIED_DESTINATION/);
 assert.throws(()=>destinationReceiptVerifier([near,base],{...options,baseRpc:'https://user:password@mainnet.base.org'}),/HTTPS_RECEIPT/);
});

test('the NEAR source sender uses only read-only reconciliation for an expired recorded quote',async()=>{
 const h=setup(),id='c'.repeat(32),route=await h.router().prepare(id,'payout',h.request);let broadcasts=0,reads=0;
 h.ach.transport.call=async()=>{broadcasts++;throw new Error('UNEXPECTED_BROADCAST');};
 h.ach.transport.reconcile=async(contract,method,args,options)=>{reads++;assert.equal(contract,'usdc.near');assert.equal(method,'ft_transfer');assert.equal(args.receiver_id,'deposit.near');assert.equal(args.amount,'10000000');assert.equal(options.operation_id,'intents-source:'+id);return{tx_hash:'source',evidence:'near_final'};};
 route.request.deadline=new Date(Date.now()-1000).toISOString();route.response.quote.deadline=route.request.deadline;route.response.quoteRequest=structuredClone(route.request);route.approval_hash=ownerRouteHash(route);
 const sender=new NearTokenRouteSender(h.ach);await assert.rejects(sender.sendExactQuote(route,'intents-source:'+id),/QUOTE_EXPIRED/);assert.equal((await sender.reconcileExactQuote(route,'intents-source:'+id)).tx_hash,'source');assert.equal(reads,1);assert.equal(broadcasts,0);
 const changed=structuredClone(route);changed.request.amount='10000001';await assert.rejects(sender.reconcileExactQuote(changed,'intents-source:'+id),/BINDING/);assert.equal(reads,1);
});
