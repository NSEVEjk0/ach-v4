import test from 'node:test';
import assert from 'node:assert/strict';
import {OwnerIntentsRouter,ownerRouteHash,destinationReceiptVerifier} from '../dist/owner.js';

const near={assetId:'nep141:usdc.near',symbol:'USDC',blockchain:'near',decimals:6,contractAddress:'usdc.near'},base={assetId:'nep141:base-usdc.omft.near',symbol:'USDC',blockchain:'base',decimals:6,contractAddress:'0x'+'22'.repeat(20)};
function setup(){
 const records=new Map(),withdrawals=new Map(),sends=new Map();let receipt,withdrawCount=0,sendCount=0,depositCount=0,loseResponse=true;
 const store={get:async id=>records.has(id)?structuredClone(records.get(id)):undefined,put:async r=>records.set(r.id,structuredClone(r))};
 const ach={deployment:{network:'mainnet',vault:'vault.near',token:'usdc.near'},transport:{account_id:'owner.near'},assertDeployment:async()=>{},withdrawal:async id=>withdrawals.get(id),withdraw:async(id,amount)=>{withdrawCount++;withdrawals.set(id,{status:'COMPLETED',amount});},deposit:async(id,amount)=>{depositCount++;return{value:amount,evidence:'near_final',tx_hash:'vault-credit'};}};
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
 const fetcher=async(_url,options)=>{const q=JSON.parse(options.body);return{ok:true,json:async()=>({result:q.method==='eth_blockNumber'?head:{status,blockNumber:'0xf8',logs:[{address:contract,topics:[topic,'0x'+'00'.repeat(32),to],data:'0x'+(10000000n).toString(16).padStart(64,'0')}]}})};};
 const verifier=destinationReceiptVerifier([near,base],{nearRpc:'https://rpc.near.org',baseRpc:'https://mainnet.base.org',baseConfirmations:12,fetcher});
 const result={status:'SUCCESS',swapDetails:{destinationChainTxHashes:[{hash:'destination'}]}};
 assert.equal(await verifier(r,result),undefined,'nine blocks must not meet a twelve-block confirmation requirement');
 head='0x110';assert.equal((await verifier(r,result)).amount,'10000000');contract='0x'+'44'.repeat(20);assert.equal(await verifier(r,result),undefined);
 contract=base.contractAddress;status='0x0';assert.equal(await verifier(r,result),undefined);
});
