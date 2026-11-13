'use client';
import {useEffect,useRef,useState} from 'react';
import Link from 'next/link';
import {ArrowRight,ArrowLeftRight,ChevronDown,Clock3} from 'lucide-react';
import {api,errorText} from '../../lib/v4';
import {chainName,parseTokenAmount,tokenAmount,suggestedAmount,addressHint} from '../../lib/intents';
import type {RouteToken} from '../../lib/intents';
import {PanelHeading} from './Interface';

const NEAR_USDC='nep141:17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1';
const BASE_USDC='nep141:base-0x833589fcd6edb6e08f4c7c32d4f71b54bda02913.omft.near';
interface RouteQuote {
 id:string;direction:string;network:string;state:string;dry:boolean;
 request:{recipient:string;refundTo:string;amount:string;deadline:string;depositMode:string};
 source:RouteToken;destination:RouteToken;
 response:{quote:{amountOut:string;minAmountOut:string;timeEstimate:number;deadline?:string}};
}
const preferred=(tokens:RouteToken[])=>tokens.find(t=>t.symbol==='USDC')??tokens.find(t=>!t.symbol.includes('DEPRECATED'))??tokens[0];

export default function FundingRoutes({enabled}:{enabled:boolean}){
 const[expanded,setExpanded]=useState(false),[direction,setDirection]=useState('funding');
 const[tokens,setTokens]=useState<RouteToken[]>([]),[asset,setAsset]=useState(BASE_USDC),[amount,setAmount]=useState('10');
 const[recipient,setRecipient]=useState(''),[refund,setRefund]=useState(''),[quote,setQuote]=useState<RouteQuote|null>(null);
 const[pending,setPending]=useState(false),[catalogueLoading,setCatalogueLoading]=useState(false),[error,setError]=useState(''),[now,setNow]=useState(Date.now());
 const operation=useRef<{id:string;payload:string}|null>(null);
 const external=tokens.find(t=>t.assetId===asset),settlement=tokens.find(t=>t.assetId===NEAR_USDC);
 const source=direction==='funding'?external:settlement,destination=direction==='funding'?settlement:external;
 const chains=[...new Set(tokens.filter(t=>t.assetId!==NEAR_USDC).map(t=>t.blockchain))].sort((a,b)=>chainName(a).localeCompare(chainName(b)));
 const expiresAt=quote?Math.min(Date.parse(quote.request.deadline),Date.parse(quote.response.quote.deadline??quote.request.deadline)):0;
 const expired=Boolean(quote&&expiresAt<=now);

 useEffect(()=>{
  if(!enabled)return;let alive=true;setCatalogueLoading(true);
  api<RouteToken[]>('intents/tokens').then(list=>{
   if(!alive)return;setTokens(list);
   if(!list.some(t=>t.assetId===BASE_USDC)){
    const selected=preferred(list.filter(t=>t.assetId!==NEAR_USDC));
    if(selected){setAsset(selected.assetId);setAmount(suggestedAmount(selected));}
   }
  }).catch(cause=>{if(alive)setError(errorText(cause instanceof Error?cause.message:'INTENTS_UNAVAILABLE'));}).finally(()=>{if(alive)setCatalogueLoading(false);});
  return()=>{alive=false;};
 },[enabled]);
 useEffect(()=>{operation.current=null;setQuote(null);setError('');},[direction,asset,amount,recipient,refund]);
 useEffect(()=>{if(!quote)return;setNow(Date.now());const timer=setInterval(()=>setNow(Date.now()),1000);return()=>clearInterval(timer);},[quote]);
 function selectAsset(value:string){
  const token=tokens.find(t=>t.assetId===value);setAsset(value);
  if(direction==='funding'){setRefund('');if(token)setAmount(suggestedAmount(token));}else setRecipient('');
 }
 async function requestQuote(){
  if(!source||!destination)return;setPending(true);setError('');
  try{
   if(expired)operation.current=null;
   const payload=JSON.stringify({direction,asset_id:asset,amount:parseTokenAmount(amount,source.decimals),recipient:recipient.trim(),refund_to:refund.trim()});
   if(operation.current?.payload!==payload)operation.current={id:crypto.randomUUID().replaceAll('-',''),payload};
   setQuote(await api<RouteQuote>('intents/quote',{request_id:operation.current.id,...JSON.parse(payload)}));
  }catch(cause){setError(errorText(cause instanceof Error?cause.message:'INTENTS_UNAVAILABLE'));}
  finally{setPending(false);}
 }
 return <section className="work-surface funding-routes">
  <PanelHeading title="Move funds between chains" description="Choose a chain and token from the live Intents catalogue."><span className="tag">NEAR Intents</span></PanelHeading>
  <div className="route-introduction"><p>ACH settles bills in USDC on NEAR. Preview funding from another asset or a payout to your chosen chain and token.</p><p className="form-hint">These are real mainnet dry quotes. The site sends no cross-chain transfer, and your sponsored test balance stays on testnet.{chains.length>0&&` The current catalogue lists ${chains.length} chains and ${tokens.length} assets.`}</p><button className="button secondary" aria-expanded={expanded} aria-controls="route-preview" onClick={()=>setExpanded(value=>!value)}>{expanded?'Close route preview':'Preview a route'}<ChevronDown size={16}/></button></div>
  {expanded&&<div className="route-body" id="route-preview">
   <form className="route-form" onSubmit={event=>{event.preventDefault();void requestQuote();}}>
    <label>Direction<select disabled={pending} value={direction} onChange={event=>{setDirection(event.target.value);setRecipient('');setRefund('');setAmount(event.target.value==='payout'?'10':external?suggestedAmount(external):'10');}}><option value="funding">Chosen asset → NEAR USDC · funding</option><option value="payout">NEAR USDC → chosen asset · payout</option></select></label>
    <label>Chain<select disabled={pending||catalogueLoading||!external} value={external?.blockchain??''} onChange={event=>{const selected=preferred(tokens.filter(t=>t.blockchain===event.target.value&&t.assetId!==NEAR_USDC));if(selected)selectAsset(selected.assetId);}}>{!chains.length&&<option value="">{catalogueLoading?'Loading chains…':'Catalogue unavailable'}</option>}{chains.map(chain=><option key={chain} value={chain}>{chainName(chain)}</option>)}</select></label>
    <label>Token<select disabled={pending||!external} value={asset} onChange={event=>selectAsset(event.target.value)}>{tokens.filter(t=>t.blockchain===external?.blockchain&&t.assetId!==NEAR_USDC).map(t=><option key={t.assetId} value={t.assetId}>{t.symbol}{tokens.filter(other=>other.blockchain===t.blockchain&&other.symbol===t.symbol).length>1?` · ${t.assetId.slice(-22)}`:''}</option>)}</select></label>
    <label>Amount in {source?.symbol??'the sending token'}<input disabled={pending} inputMode="decimal" value={amount} onChange={event=>setAmount(event.target.value)}/><span className="form-hint">{source?`${chainName(source.blockchain)} · up to ${source.decimals} decimal places`:'Choose an asset first.'}</span></label>
    <label>Receiving {destination?chainName(destination.blockchain):'chain'} account<input disabled={pending} value={recipient} onChange={event=>setRecipient(event.target.value)} placeholder={destination?.blockchain==='near'?'your-account.near':'Your receiving address'}/><span className="form-hint">{destination&&addressHint(destination.blockchain)}</span></label>
    <label>Refund {source?chainName(source.blockchain):'chain'} account<input disabled={pending} value={refund} onChange={event=>setRefund(event.target.value)} placeholder={source?.blockchain==='near'?'your-account.near':'Your refund address'}/><span className="form-hint">{source&&addressHint(source.blockchain)}</span></label>
    <p className="form-hint">Use your own mainnet accounts. Each quote binds the assets, both destinations, amount, minimum receipt and expiry. Availability and minimum amounts depend on the route provider.</p>
    <button className="button primary" type="submit" disabled={pending||!enabled||!source||!destination||!recipient||!refund}>{pending?'Getting quote…':'Get a mainnet quote'}<ArrowRight size={16}/></button>
    {!enabled&&<p role="status" className="form-hint">The quote service is reconnecting. Your available test funds remain usable.</p>}
    {error&&<p className="inline-error" role="alert">{error}</p>}
   </form>
   <div className="route-review" aria-live="polite">{quote?<>
    <span className={`tag ${expired?'warning-tag':''}`}>{expired?<Clock3 size={14}/>:<ArrowLeftRight size={14}/>} {expired?'Quote expired':'No transfer sent'}</span>
    <h3>{tokenAmount(quote.request.amount,quote.source.decimals)} {quote.source.symbol}<br/>{chainName(quote.source.blockchain)} to {chainName(quote.destination.blockchain)}</h3>
    <dl className="policy-list"><div><dt>Expected receipt</dt><dd>{tokenAmount(quote.response.quote.amountOut,quote.destination.decimals)} {quote.destination.symbol}</dd></div><div><dt>Minimum receipt</dt><dd>{tokenAmount(quote.response.quote.minAmountOut,quote.destination.decimals)} {quote.destination.symbol}</dd></div><div><dt>Slippage cap</dt><dd>1%</dd></div><div><dt>Expires</dt><dd>{new Date(expiresAt).toLocaleTimeString()}</dd></div></dl>
    <p className="destination-label">Receiving account<span className="mono">{quote.request.recipient}</span></p><p className="destination-label">Refund account<span className="mono">{quote.request.refundTo}</span></p>
    {quote.request.depositMode==='MEMO'&&<p className="form-hint">This funding route requires a deposit memo when executed. This dry quote creates no deposit address.</p>}
    <p className="form-hint">{expired?'Get a fresh quote to review the current route.':'Incoming funds become an ACH balance after NEAR USDC reaches the owner and a separate vault deposit is confirmed.'}</p>
    <Link className="text-button" href="/developers#funding">Read the owner routing guide<ArrowRight size={15}/></Link>
   </>:<><span className="section-kicker">Route review</span><h3>Check where your funds will arrive.</h3><p>Review the minimum receipt, expiry and refund account here. Funding arrives at the owner before an ACH deposit. A payout starts with an ACH withdrawal to the owner.</p></>}</div>
  </div>}
 </section>;
}
