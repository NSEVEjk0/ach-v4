'use client';
import {useEffect,useRef,useState} from 'react';
import {ArrowRight,LockKeyhole,Users} from 'lucide-react';
import {api,errorText,money} from '../../lib/v4';
import type {Snapshot} from '../../lib/v4';
import {PanelHeading,State} from './Interface';

export default function NettingTest({data,pending,stale,onNewWorkspace,onRefresh,onRound}:{data:Snapshot;pending:boolean;stale:boolean;onNewWorkspace:(count:number)=>void;onRefresh:()=>void;onRound:(id:string)=>void}){
 const[count,setCount]=useState(data.session.requested_agent_count??data.session.agent_count??3),[privacy,setPrivacy]=useState<'public'|'private'>('public'),[sending,setSending]=useState(false),[error,setError]=useState('');
 const operation=useRef<{id:string;payload:string}|null>(null);
 const jobs=data.test_jobs??[],active=jobs.some(j=>['STARTED','WAITING'].includes(j.state)),working=data.jobs.some(j=>['STARTED','WAITING'].includes(j.state));
 const needsWallets=!data.session.judge_testing||count>data.session.participants.length;
 const bills=privacy==='private'?Math.min(count,6):count;
 // A fresh workspace does not use this workspace's balances or private worker.
 // Keep those checks for starting a round, and preserve all in-flight guards.
 const disabled=pending||sending||active||working||!needsWallets&&(stale||privacy==='private'&&!data.privacy.enabled);
 useEffect(()=>{setCount(data.session.requested_agent_count??data.session.agent_count??3);operation.current=null;setError('');},[data.session.id]);
 useEffect(()=>{if(operation.current&&jobs.some(j=>j.id==='test-netting-'+operation.current?.id&&['COMPLETE','FAILED'].includes(j.state)))operation.current=null;},[jobs]);
 async function run(){
  setSending(true);setError('');
  try{
   const payload=JSON.stringify({session_id:data.session.id,agent_count:count,privacy});
   if(operation.current?.payload!==payload)operation.current={id:crypto.randomUUID().replaceAll('-',''),payload};
   await api('netting-test',{request_id:operation.current.id,agent_count:count,privacy});onRefresh();
  }catch(cause){setError(errorText(cause instanceof Error?cause.message:'SERVICE_UNAVAILABLE'));}
  finally{setSending(false);}
 }
 return <section className="work-surface netting-test" id="judge-netting">
  <PanelHeading title="Test netting with more agents" description="Create signed test bills and settle a real round on NEAR testnet. No SDK setup is needed."><span className="tag"><Users size={14}/> Judge test</span></PanelHeading>
  <div className="netting-test-controls">
   <label>Agents in the test<select value={count} disabled={pending||sending||active} onChange={event=>{setCount(Number(event.target.value));setError('');}}>{Array.from({length:10},(_,i)=>i+3).map(n=><option key={n} value={n}>{n} agents</option>)}</select></label>
   <label>Bill visibility<select value={privacy} disabled={pending||sending||active} onChange={event=>{setPrivacy(event.target.value as 'public'|'private');setError('');}}><option value="public">Public invoices</option><option value="private">Encrypted private invoices</option></select></label>
   <button className="button primary" disabled={disabled} onClick={()=>needsWallets?onNewWorkspace(count):void run()}>{sending?'Starting the test…':active?'Test in progress':needsWallets?`Prepare ${count} judge wallets`:'Run signed netting test'}<ArrowRight size={16}/></button>
  </div>
  <p className="form-hint">{privacy==='public'?`${count} distinct agents agree to ${bills} synthetic bills. Their payments offset around a cycle, leaving 0.02 tUSDC to settle.`:`${count} distinct agents sign ${bills} encrypted synthetic bills. OutLayer verifies the signatures and nets the complete funded group in one run. Participants and final net movements remain public.`}</p>
  {privacy==='private'&&count>6&&<p className="form-hint">This test uses six bills across separate payment chains to include every agent. At 12 agents, each pair has one bill, so the round has no offsetting payments.</p>}
  <p className="form-hint">Round limits: 12 participants, 48 public bills or 6 private bills. New larger workspaces fund every wallet with 5 tUSDC. You can reopen earlier workspaces from Settings.</p>
  {privacy==='private'&&!data.privacy.enabled&&<p role="status" className="form-hint">Private computation is reconnecting. Your private selection is retained.</p>}
  {error&&<p className="inline-error" role="alert">{error}</p>}
  {!!jobs.length&&<div className="netting-test-results" aria-live="polite">{jobs.slice(-3).reverse().map(job=><article className="netting-test-result" key={job.id}>
   <div><strong>{job.agent_count} agents · {job.private?<><LockKeyhole size={13}/> private</>:'public'}{job.invoice_count?` · ${job.invoice_count} bills`:''}</strong><State status={job.state}/></div>
   {job.result?<><p>{job.result.gross_invoice_volume===null?'Invoice totals kept private.':`${money(job.result.gross_invoice_volume)} tUSDC in bills.`} <strong>{money(job.result.net_settlement_volume)} tUSDC settled.</strong></p><button className="text-button" onClick={()=>onRound(job.result!.round_id)}>Inspect the round and balances<ArrowRight size={15}/></button></>:<p>{job.error?errorText(job.error):job.phase??'Preparing the signed test group…'}</p>}
  </article>)}</div>}
 </section>;
}
