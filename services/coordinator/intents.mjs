import {OneClickIntents,validateQuoteRequest,assertQuoteMatches,isIntentsAssetId} from '../../packages/intents/dist/index.js';
import {validIntentsAddress,normalizeIntentsAddress,memoDepositMode,quoteLifetimeMs} from './intents-addresses.mjs';

export const NEAR_USDC='nep141:17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1';
export const BASE_USDC='nep141:base-0x833589fcd6edb6e08f4c7c32d4f71b54bda02913.omft.near';
export const MAX_ROUTE_PREVIEWS=48;

export class IntentsQuotes {
 constructor({store,client=new OneClickIntents(),clock=Date.now}){Object.assign(this,{store,client,clock});this.cached=null;this.catalogueTask=null;this.running=new Map();}
 async tokens(){
  if(this.cached&&this.cached.until>this.clock())return this.cached.tokens;
  if(this.catalogueTask)return this.catalogueTask;
  const task=(async()=>{
   const all=await this.client.tokens();
   if(!Array.isArray(all)||all.length<1||all.length>2000||all.some(t=>!t||!isIntentsAssetId(t.assetId)||!Number.isInteger(t.decimals)||t.decimals<0||t.decimals>36||typeof t.blockchain!=='string'||!/^[a-z\d_-]{1,32}$/.test(t.blockchain)||typeof t.symbol!=='string'||!t.symbol.length||t.symbol.length>64||/[\u0000-\u001f\u007f]/.test(t.symbol))||new Set(all.map(t=>t.assetId)).size!==all.length)throw new Error('INTENTS_CATALOGUE_UNAVAILABLE');
   const settlement=all.find(t=>t.assetId===NEAR_USDC);
   if(!settlement||settlement.symbol!=='USDC'||settlement.decimals!==6||settlement.blockchain!=='near'||settlement.contractAddress&&settlement.contractAddress!==NEAR_USDC.slice(7))throw new Error('INTENTS_SETTLEMENT_ASSET_UNAVAILABLE');
   const tokens=all.map(t=>({...t}));
   this.cached={tokens,until:this.clock()+300000};return tokens;
  })().finally(()=>{if(this.catalogueTask===task)this.catalogueTask=null;});
  this.catalogueTask=task;return task;
 }
 async quote(session,input){
  if(!input||!/^[a-f\d]{32}$/.test(input.request_id)||!['funding','payout'].includes(input.direction))throw new Error('INVALID_ROUTE_REQUEST');
  if(Object.keys(input).some(k=>!['request_id','direction','asset_id','amount','recipient','refund_to'].includes(k)))throw new Error('INVALID_ROUTE_REQUEST');
  const tokens=await this.tokens(),asset=input.asset_id??BASE_USDC,external=tokens.find(t=>t.assetId===asset),settlement=tokens.find(t=>t.assetId===NEAR_USDC);
  if(!external||asset===NEAR_USDC)throw new Error('VERIFIED_ROUTE_ASSETS_REQUIRED');
  const origin=input.direction==='funding'?external:settlement,destination=input.direction==='funding'?settlement:external;
  if(!validIntentsAddress(origin.blockchain,input.refund_to)||!validIntentsAddress(destination.blockchain,input.recipient))throw new Error('INVALID_ROUTE_ADDRESS');
  const refundTo=normalizeIntentsAddress(origin.blockchain,input.refund_to),recipient=normalizeIntentsAddress(destination.blockchain,input.recipient);
  if(typeof input.amount!=='string'||input.amount.length>78||!/^[1-9]\d*$/.test(input.amount))throw new Error('INVALID_ROUTE_AMOUNT');
  const id='quote-'+input.request_id;
  if(this.store.jobs(session.id).filter(j=>j.id.startsWith('quote-')).length>=MAX_ROUTE_PREVIEWS&&!this.store.job(id))throw new Error('SESSION_ROUTE_QUOTA_REACHED');
  let job=this.store.startJob(id,session.id,input);if(job.state==='COMPLETE')return this.present(job.result);
  if(this.running.has(id))return this.running.get(id);
  const task=(async()=>{
   const request={dry:true,swapType:'EXACT_INPUT',slippageTolerance:100,originAsset:origin.assetId,destinationAsset:destination.assetId,amount:input.amount,refundTo,recipient,deadline:new Date(this.clock()+quoteLifetimeMs(origin.blockchain)).toISOString(),depositType:'ORIGIN_CHAIN',refundType:'ORIGIN_CHAIN',recipientType:'DESTINATION_CHAIN',depositMode:memoDepositMode(origin.blockchain)};
   validateQuoteRequest(request,this.clock());
   const response=await this.client.quote(request);
   assertQuoteMatches(request,response);
   job.state='COMPLETE';job.result={id:input.request_id,direction:input.direction,network:'mainnet',source:origin,destination,request,response,state:'QUOTED',dry:true,quoted_at_ms:this.clock()};this.store.saveJob(job);
   return job.result;
  })().finally(()=>this.running.delete(id));this.running.set(id,task);return task;
 }
 present(result){return{...result,state:Date.parse(result.request.deadline)<=this.clock()?'EXPIRED':'QUOTED'};}
 async status(session,{id}){
  if(typeof id!=='string'||!/^[a-f\d]{32}$/.test(id))throw new Error('INVALID_ROUTE_REQUEST');
  const job=this.store.job('quote-'+id);if(!job||job.session_id!==session.id||job.state!=='COMPLETE')throw new Error('SESSION_ROUTE_REQUIRED');
  return{...this.present(job.result),checked_at_ms:this.clock()};
 }
}
