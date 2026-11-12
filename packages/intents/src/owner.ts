import {canonicalV4,v4Digest} from '@ach/client/v4';
import type {AchV4Client} from '@ach/client/v4';
import {OneClickIntents,reconcileRoute,assertQuoteMatches,validateQuoteRequest} from './index.js';
import {routeJson} from './http.js';
import type {Route,QuoteRequest,DestinationReceipt,IntentsToken,StatusResponse} from './index.js';

export interface OwnerRoute extends Route {
 network:'mainnet'; vault:string; owner_id:string; kind:'funding'|'payout'; source_chain:string;
 destination_chain:string; source_contract?:string; approval_hash:string; withdrawal_id?:string; deposit_id?:string;
 source_submission_recorded?:boolean;source_attempt_recorded?:boolean;deposit_confirmed?:boolean;deposit_tx?:string;deposit_amount?:string;
}
export interface RouteStore {get(id:string):Promise<OwnerRoute|undefined>;put(route:OwnerRoute):Promise<void>}
/** The sender retains its key and must journal its signed transaction before broadcast. */
export interface SourceSender {
 account_id:string;asset_id:string;
 sendExactQuote(route:OwnerRoute,operationId:string):Promise<{tx_hash:string;confirmed:boolean}>;
 /** Observe previously signed bytes only; this must never send a new transfer. */
 reconcileExactQuote?(route:OwnerRoute,operationId:string):Promise<{tx_hash:string;confirmed:boolean}>;
}
export type ReceiptVerifier=(route:OwnerRoute,status:StatusResponse)=>Promise<DestinationReceipt|undefined>;
export function ownerRouteHash(route:Omit<OwnerRoute,'approval_hash'>):string {
 const q=route.response.quote,r=route.request;
 return v4Digest(canonicalV4('owner-intents-route','mainnet',route.vault,[route.id,route.owner_id,route.kind,r.originAsset,r.destinationAsset,route.source_chain,route.destination_chain,r.amount,q.amountOut,q.minAmountOut,r.recipient,r.refundTo,r.deadline,q.deadline??'',q.depositAddress??'',q.depositMemo??'',String(r.slippageTolerance),r.depositMode,route.response.correlationId,String(r.dry),r.swapType,r.depositType,r.refundType,r.recipientType,route.source_contract??'',route.destination_contract??'']));
}

// Multiple router wrappers over the same durable store share one route lock.
// Stores used by other processes must provide their own exclusive writer.
const routeQueues=new WeakMap<RouteStore,Map<string,Promise<void>>>();
async function withRouteLock<T>(store:RouteStore,id:string,work:()=>Promise<T>):Promise<T>{
 let queues=routeQueues.get(store);if(!queues){queues=new Map();routeQueues.set(store,queues);}
 const previous=queues.get(id)??Promise.resolve();let release!:()=>void;
 const current=new Promise<void>(resolve=>{release=resolve;});queues.set(id,current);await previous;
 try{return await work();}finally{release();if(queues.get(id)===current)queues.delete(id);}
}

/** Mainnet-only routing. Testnet balances never enter this class. */
export class OwnerIntentsRouter {
 constructor(private readonly ach:AchV4Client,private readonly api:OneClickIntents,private readonly store:RouteStore,private readonly verifyReceipt:ReceiptVerifier,private readonly clock:()=>number=Date.now){
  if(ach.deployment.network!=='mainnet')throw new Error('MAINNET_ROUTER_REQUIRED');
 }
 private async record(id:string):Promise<OwnerRoute>{
  const r=await this.store.get(id);
  if(!r||r.network!=='mainnet'||r.vault!==this.ach.deployment.vault||r.owner_id!==this.ach.transport.account_id||r.approval_hash!==ownerRouteHash(r))throw new Error('OWNER_ROUTE_BINDING_MISMATCH');
  assertQuoteMatches(r.request,r.response);
  return r;
 }
 async prepare(id:string,kind:'funding'|'payout',request:QuoteRequest):Promise<OwnerRoute>{
  const immutable=structuredClone(request);
  return withRouteLock(this.store,id,()=>this.prepareRoute(id,kind,immutable));
 }
 private async prepareRoute(id:string,kind:'funding'|'payout',request:QuoteRequest):Promise<OwnerRoute>{
  if(!/^[a-f\d]{32}$/.test(id)||request.dry)throw new Error('LIVE_OWNER_QUOTE_REQUIRED');
  const old=await this.store.get(id);
  if(old){if(old.kind!==kind||JSON.stringify(old.request)!==JSON.stringify(request))throw new Error('REQUEST_ID_CONFLICT');return this.record(id);}
  validateQuoteRequest(request,this.clock());
  await this.ach.assertDeployment(true);
  const tokens=await this.api.tokens(),source=tokens.find(t=>t.assetId===request.originAsset),destination=tokens.find(t=>t.assetId===request.destinationAsset);
  const settlement='nep141:'+this.ach.deployment.token;
  if(!source||!destination||![destination.decimals,source.decimals].every(decimals=>Number.isInteger(decimals)&&decimals>=0&&decimals<=36))throw new Error('VERIFIED_ROUTE_ASSETS_REQUIRED');
  if(kind==='funding'?(destination.assetId!==settlement||destination.blockchain!=='near'||destination.decimals!==6||request.recipient!==this.ach.transport.account_id):(source.assetId!==settlement||source.blockchain!=='near'||source.decimals!==6||request.refundTo!==this.ach.transport.account_id))throw new Error('OWNER_CONTROLLED_ROUTE_REQUIRED');
  const response=await this.api.quote(request);
  assertQuoteMatches(request,response);
  if(Date.parse(response.quote.deadline!)<=this.clock())throw new Error('QUOTE_EXPIRED_RECONCILE_BEFORE_RESEND');
  const body={id,kind,network:'mainnet' as const,vault:this.ach.deployment.vault,owner_id:this.ach.transport.account_id,request,response,state:'QUOTED' as const,source_chain:source.blockchain,destination_chain:destination.blockchain,source_contract:source.contractAddress,destination_contract:destination.contractAddress};
  const route={...body,approval_hash:ownerRouteHash(body)};await this.store.put(route);return route;
 }
 async execute(id:string,approvedHash:string,sender:SourceSender):Promise<OwnerRoute>{
  return withRouteLock(this.store,id,()=>this.executeRoute(id,approvedHash,sender));
 }
 private async executeRoute(id:string,approvedHash:string,sender:SourceSender):Promise<OwnerRoute>{
  let route=await this.record(id);
  if(route.approval_hash!==approvedHash||sender.asset_id!==route.request.originAsset||sender.account_id!==route.request.refundTo)throw new Error('EXACT_OWNER_ROUTE_APPROVAL_REQUIRED');
  if(['RECEIVED','REFUNDED','FAILED'].includes(route.state))return route;
  await this.ach.assertDeployment(true);
  if(!route.known_source_tx){
   const expired=Date.parse(route.response.quote.deadline!)<=this.clock();
   if(expired&&(!route.source_attempt_recorded||!sender.reconcileExactQuote))throw new Error('QUOTE_EXPIRED_RECONCILE_BEFORE_RESEND');
   if(route.kind==='payout'){
    const withdrawalId=route.withdrawal_id??'intents-'+id;
    route={...route,withdrawal_id:withdrawalId,state:'WITHDRAWING'};await this.store.put(route);
    let withdrawal=await this.ach.withdrawal(withdrawalId);
    if(!withdrawal){if(expired)throw new Error('QUOTE_EXPIRED_RECONCILE_BEFORE_RESEND');await this.ach.withdraw(withdrawalId,route.request.amount);withdrawal=await this.ach.withdrawal(withdrawalId);}
    if(!withdrawal||withdrawal.status==='PENDING')return route;
    if(withdrawal.amount!==route.request.amount||withdrawal.account_id!==route.owner_id||withdrawal.receiver_id!==route.owner_id)throw new Error('WITHDRAWAL_ROUTE_BINDING_MISMATCH');
    if(withdrawal.status!=='COMPLETED')throw new Error('WITHDRAWAL_RESTORED_ROUTE_NOT_SENT');
   }
   // SourceSender retries this exact operation through its persistent transaction journal.
   const expiredBeforeSend=Date.parse(route.response.quote.deadline!)<=this.clock();
   if(expiredBeforeSend&&(!route.source_attempt_recorded||!sender.reconcileExactQuote))throw new Error('QUOTE_EXPIRED_RECONCILE_BEFORE_RESEND');
   route={...route,source_attempt_recorded:true,state:'RECONCILING_SOURCE'};await this.store.put(route);
   const sent=expiredBeforeSend?await sender.reconcileExactQuote!(route,'intents-source:'+id):await sender.sendExactQuote(route,'intents-source:'+id);
   if(!sent.tx_hash)throw new Error('SOURCE_BROADCAST_UNCONFIRMED');
   route={...route,known_source_tx:sent.tx_hash,state:'RECONCILING_SOURCE'};await this.store.put(route);
  }
  if(!route.source_submission_recorded){
   await this.api.submitKnownDeposit(route.response.quote.depositAddress!,route.known_source_tx!,route.response.quote.depositMemo);
   route={...route,source_submission_recorded:true};await this.store.put(route);
  }
  return this.refreshRoute(id);
 }
 async refresh(id:string):Promise<OwnerRoute>{
  return withRouteLock(this.store,id,()=>this.refreshRoute(id));
 }
 private async refreshRoute(id:string):Promise<OwnerRoute>{
  const route=await this.record(id),status=await this.api.status(route.response.quote.depositAddress!,route.response.quote.depositMemo);
  const receipt=status.status==='SUCCESS'?await this.verifyReceipt(route,status):undefined;
  const next=reconcileRoute(route,status,receipt) as OwnerRoute;await this.store.put(next);return next;
 }
 async depositReceivedFunding(id:string):Promise<OwnerRoute>{
  return withRouteLock(this.store,id,()=>this.depositFundingRoute(id));
 }
 private async depositFundingRoute(id:string):Promise<OwnerRoute>{
  let route=await this.record(id);
  if(route.kind!=='funding'||route.state!=='RECEIVED'||!route.receipt?.confirmed)throw new Error('CONFIRMED_OWNER_RECEIPT_REQUIRED');
  if(route.deposit_confirmed)return route;
  // A destination transaction can batch several transfers to the same owner.
  // Deposit at most this route's approved output, leaving any surplus with them.
  const amount=(BigInt(route.receipt.amount)<BigInt(route.response.quote.amountOut)?BigInt(route.receipt.amount):BigInt(route.response.quote.amountOut)).toString();
  const depositId=route.deposit_id??'intents-deposit-'+id;
  route={...route,deposit_id:depositId,deposit_amount:amount};await this.store.put(route);
  const result=await this.ach.deposit(depositId,amount);
  if(result.value!==amount||result.evidence!=='near_final')throw new Error('ACH_DEPOSIT_NOT_ACCEPTED');
  route={...route,deposit_confirmed:true,deposit_tx:result.tx_hash};await this.store.put(route);return route;
 }
}

/** NEAR NEP-141 source leg with the owner's durable, signer-backed transport. */
export class NearTokenRouteSender implements SourceSender {
 readonly account_id:string;readonly asset_id:string;
 constructor(private readonly ach:AchV4Client){if(ach.deployment.network!=='mainnet')throw new Error('MAINNET_ROUTER_REQUIRED');this.account_id=ach.transport.account_id;this.asset_id='nep141:'+ach.deployment.token;}
 private transfer(route:OwnerRoute,operationId:string){
  if(route.network!=='mainnet'||route.vault!==this.ach.deployment.vault||route.owner_id!==this.account_id||route.approval_hash!==ownerRouteHash(route))throw new Error('OWNER_ROUTE_BINDING_MISMATCH');
  assertQuoteMatches(route.request,route.response);
  if(route.request.originAsset!==this.asset_id||route.request.refundTo!==this.account_id||route.source_chain!=='near'||!route.response.quote.depositAddress||route.request.depositMode!=='SIMPLE'||route.response.quote.depositMemo)throw new Error('UNSUPPORTED_NEAR_SOURCE_ROUTE');
  return{args:{receiver_id:route.response.quote.depositAddress,amount:route.request.amount,memo:'ach-intents:'+route.id},options:{operation_id:operationId,deposit:1n,gas:50_000_000_000_000n}};
 }
 async sendExactQuote(route:OwnerRoute,operationId:string){
  await this.ach.assertDeployment(true);const {args,options}=this.transfer(route,operationId);
  if(Date.parse(route.response.quote.deadline!)<=Date.now())throw new Error('QUOTE_EXPIRED_RECONCILE_BEFORE_RESEND');
  const result=await this.ach.transport.call(this.ach.deployment.token,'ft_transfer',args,options);
  return{tx_hash:result.tx_hash,confirmed:result.evidence==='near_final'};
 }
 async reconcileExactQuote(route:OwnerRoute,operationId:string){
  const {args,options}=this.transfer(route,operationId);
  if(!this.ach.transport.reconcile)throw new Error('SOURCE_RECONCILIATION_REQUIRED');
  const result=await this.ach.transport.reconcile(this.ach.deployment.token,'ft_transfer',args,options);
  return{tx_hash:result.tx_hash,confirmed:result.evidence==='near_final'};
 }
}

interface RpcResponse {result?:any;error?:unknown}
async function rpc(url:string,method:string,params:unknown,fetcher:typeof fetch){
 const result=await fetcher(url,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({jsonrpc:'2.0',id:'ach-route-receipt',method,params}),redirect:'error',signal:AbortSignal.timeout(20000)});
 if(!result.ok)throw new Error('DESTINATION_READ_UNAVAILABLE');const body=await routeJson<RpcResponse>(result);if(body.error||body.result===undefined)throw new Error('DESTINATION_READ_UNAVAILABLE');return body.result;
}
/** Receipt data comes from an independently configured chain RPC, never browser input. */
export function destinationReceiptVerifier(tokens:IntentsToken[],options:{nearRpc:string;baseRpc:string;baseConfirmations?:number;fetcher?:typeof fetch}):ReceiptVerifier{
 const fetcher=options.fetcher??fetch,confirmations=options.baseConfirmations??12;
 if(!Number.isInteger(confirmations)||confirmations<1)throw new Error('INVALID_RECEIPT_CONFIRMATIONS');
 if(![options.nearRpc,options.baseRpc].every(endpoint=>{const url=new URL(endpoint);return url.protocol==='https:'&&!url.username&&!url.password&&!url.hash;}))throw new Error('HTTPS_RECEIPT_RPC_REQUIRED');
 return async(route,status)=>{
  const token=tokens.find(t=>t.assetId===route.request.destinationAsset);
  if(!token||token.blockchain!==route.destination_chain||!token.contractAddress||route.destination_contract&&token.contractAddress.toLowerCase()!==route.destination_contract.toLowerCase()||token.blockchain==='near'&&token.contractAddress!==(route.request.destinationAsset.slice('nep141:'.length)))throw new Error('VERIFIED_DESTINATION_ASSET_REQUIRED');
  for(const tx of status.swapDetails.destinationChainTxHashes??[]){
   let amount=0n;
   if(token.blockchain==='near'){
    const result=await rpc(options.nearRpc,'tx',{tx_hash:tx.hash,sender_account_id:route.request.recipient,wait_until:'FINAL'},fetcher);
    if(result.final_execution_status&&result.final_execution_status!=='FINAL')continue;
    if(result.status?.SuccessValue===undefined||result.transaction?.hash!==tx.hash)continue;
    for(const receipt of result.receipts_outcome??[]){if(receipt.outcome?.executor_id!==token.contractAddress||receipt.outcome.status?.SuccessValue===undefined)continue;
     for(const log of receipt.outcome.logs??[]){if(!log.startsWith('EVENT_JSON:'))continue;let event;try{event=JSON.parse(log.slice(11));}catch{continue;}
      if(event.standard==='nep141'&&event.event==='ft_transfer')for(const transfer of event.data??[])if(transfer.new_owner_id===route.request.recipient&&/^(0|[1-9]\d{0,38})$/.test(transfer.amount))amount+=BigInt(transfer.amount);
     }
    }
   }else if(token.blockchain==='base'){
    const result=await rpc(options.baseRpc,'eth_getTransactionReceipt',[tx.hash],fetcher);if(!result||result.status!=='0x1'||result.transactionHash!==tx.hash||!/^0x[a-fA-F\d]+$/.test(result.blockNumber))continue;
    const head=BigInt(await rpc(options.baseRpc,'eth_blockNumber',[],fetcher));if(head-BigInt(result.blockNumber)+1n<BigInt(confirmations))continue;
    const transferTopic='0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef',to=route.request.recipient.toLowerCase().replace(/^0x/,'').padStart(64,'0');
    for(const log of result.logs??[])if(log.address?.toLowerCase()===token.contractAddress.toLowerCase()&&log.topics?.length===3&&log.topics[0]?.toLowerCase()===transferTopic&&log.topics[2]?.slice(2).toLowerCase()===to&&/^0x[a-fA-F\d]{64}$/.test(log.data))amount+=BigInt(log.data);
   }else throw new Error('DESTINATION_VERIFIER_UNSUPPORTED');
   if(amount>=BigInt(route.response.quote.minAmountOut))return{chain:token.blockchain,asset:token.assetId,recipient:route.request.recipient,amount:amount.toString(),tx_hash:tx.hash,confirmed:true};
  }
  return undefined;
 };
}
