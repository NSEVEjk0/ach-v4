import {OneClickIntents,validateQuoteRequest} from '../../packages/intents/dist/index.js';

export const NEAR_USDC='nep141:17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1';
export const BASE_USDC='nep141:base-0x833589fcd6edb6e08f4c7c32d4f71b54bda02913.omft.near';
const validAddress=(chain,address)=>typeof address==='string'&&(chain==='near'?/^(?:[a-z0-9]+[._-])*[a-z0-9]+$/.test(address)&&address.length>=2&&address.length<=64&&!address.endsWith('.testnet'):/^0x[a-fA-F\d]{40}$/.test(address));

export class IntentsQuotes {
 constructor({store,client=new OneClickIntents(),clock=Date.now}){Object.assign(this,{store,client,clock});this.cached=null;this.running=new Map();}
 async tokens(){
  if(this.cached&&this.cached.until>this.clock())return this.cached.tokens;
  const all=await this.client.tokens(),tokens=all.filter(t=>[NEAR_USDC,BASE_USDC].includes(t.assetId));
  if(tokens.length!==2||tokens.some(t=>t.symbol!=='USDC'||t.decimals!==6||!['near','base'].includes(t.blockchain)||t.assetId!==(t.blockchain==='near'?NEAR_USDC:BASE_USDC)))throw new Error('INTENTS_SETTLEMENT_ASSET_UNAVAILABLE');
  this.cached={tokens,until:this.clock()+300000};return tokens;
 }
 async quote(session,input){
  if(!input||!/^[a-f\d]{32}$/.test(input.request_id)||!['funding','payout'].includes(input.direction))throw new Error('INVALID_ROUTE_REQUEST');
  const tokens=await this.tokens(),origin=tokens.find(t=>t.assetId===(input.direction==='funding'?BASE_USDC:NEAR_USDC)),destination=tokens.find(t=>t.assetId===(input.direction==='funding'?NEAR_USDC:BASE_USDC));
  if(!validAddress(origin.blockchain,input.refund_to)||!validAddress(destination.blockchain,input.recipient))throw new Error('INVALID_ROUTE_ADDRESS');
  if(!/^(0|[1-9]\d*)$/.test(input.amount)||BigInt(input.amount)<1000000n||BigInt(input.amount)>500000000n)throw new Error('ROUTE_PREVIEW_AMOUNT_LIMIT');
  const id='quote-'+input.request_id;
  if(this.store.jobs(session.id).filter(j=>j.id.startsWith('quote-')).length>=8&&!this.store.job(id))throw new Error('SESSION_ROUTE_QUOTA_REACHED');
  let job=this.store.startJob(id,session.id,input);if(job.state==='COMPLETE')return job.result;
  if(this.running.has(id))return this.running.get(id);
  const task=(async()=>{
   const request={dry:true,swapType:'EXACT_INPUT',slippageTolerance:100,originAsset:origin.assetId,destinationAsset:destination.assetId,amount:input.amount,refundTo:input.refund_to,recipient:input.recipient,deadline:new Date(this.clock()+600000).toISOString(),depositType:'ORIGIN_CHAIN',refundType:'ORIGIN_CHAIN',recipientType:'DESTINATION_CHAIN',depositMode:'SIMPLE'};
   validateQuoteRequest(request,this.clock());
   const response=await this.client.quote(request);
   job.state='COMPLETE';job.result={id:input.request_id,direction:input.direction,network:'mainnet',source:origin,destination,request,response,state:'QUOTED',dry:true,quoted_at_ms:this.clock()};this.store.saveJob(job);
   return job.result;
  })().finally(()=>this.running.delete(id));this.running.set(id,task);return task;
 }
 async status(session,{id}){
  if(typeof id!=='string'||!/^[a-f\d]{32}$/.test(id))throw new Error('INVALID_ROUTE_REQUEST');
  const job=this.store.job('quote-'+id);if(!job||job.session_id!==session.id||job.state!=='COMPLETE')throw new Error('SESSION_ROUTE_REQUIRED');
  return{...job.result,state:Date.parse(job.result.request.deadline)<=this.clock()?'EXPIRED':'QUOTED',checked_at_ms:this.clock()};
 }
}
