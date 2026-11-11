import {v4NetPlan,v4Digest,V4_MAX_PRIVATE_INVOICES,V4BroadcastUnknown}from '../../packages/client/dist/v4.js';
const jobError=error=>/^[A-Z_\d]+$/.test(error?.message??'')?error.message:'SERVICE_OR_CHAIN_UNAVAILABLE';
const retryable=code=>/UNAVAILABLE|UNKNOWN|SYNCHRONIZATION|PRIVATE_PROCESSING/.test(code);
export class Coordinator{
 constructor({store,config,getClient,getPrivateClient,agents,sponsor,clock=Date.now,snapshotTtlMs=0,jobTimeoutMs=600000}){Object.assign(this,{store,config,getClient,getPrivateClient,agents,sponsor,clock,snapshotTtlMs,jobTimeoutMs});this.running=new Map();this.lastSync=null;this.snapshots=new Map();this.snapshotTasks=new Map();}
 invalidateSnapshot(id){this.snapshots.delete(id);this.snapshotTasks.delete(id);}
 async readRound(client,id){
  const cached=await this.store.get('terminal-round:'+id);if(cached)return cached.round;
  const round=await client.round(id);
  if(['SETTLED','EXPIRED','STALE','CANCELLED'].includes(round.status))await this.store.put({id:'terminal-round:'+id,round});
  return round;
 }
 recoverRoundIndex(session){
  const latest=this.store.session(session.id)??session;
  const recorded=this.store.jobs(session.id).filter(j=>j.id.startsWith('clear-')&&typeof j.round_id==='string').map(j=>j.round_id);
  const ids=[...new Set([...(latest.round_ids??[]),...(session.round_ids??[]),...recorded])];
  // The durable proposal intent precedes broadcast. A lost response must not
  // hide the round, including a READY or SETTLED round from an older runtime.
  if(JSON.stringify(ids)!==JSON.stringify(latest.round_ids??[])){latest.round_ids=ids;this.store.updateSession(latest);}
  session.round_ids=ids;return ids;
 }
 async start(ipHash){return this.sponsor.createSession(ipHash);}
 authenticate(token){return this.store.authenticate(token,this.clock());}
 prepareRun(session,request){
  if(session.state&&session.state!=='READY')throw new Error('SESSION_PROVISIONING');
  if(!request||!/^[a-f\d-]{16,40}$/.test(request.request_id)||!['public','private'].includes(request.privacy??'public')||!['report','chart','auto'].includes(request.mode??'report'))throw new Error('INVALID_BRIEF');
  const budget=request.budget??'300000';
  if(!/^(0|[1-9]\d*)$/.test(budget)||BigInt(budget)>500000n)throw new Error('INVALID_BRIEF_BUDGET');
  if(BigInt(budget)<((request.mode??'report')==='report'?280000n:100000n))throw new Error('BRIEF_BUDGET_TOO_LOW');
  if(request.privacy==='private'){
   if(!this.config.private?.enabled||!request.sealed_brief||request.brief!==undefined||request.data!==undefined)throw new Error('PRIVATE_MODE_UNAVAILABLE');
  }else if(typeof request.brief!=='string'||request.brief.trim().length<8||request.brief.length>800)throw new Error('INVALID_BRIEF');
  const id='run-'+request.request_id;
  if(this.store.jobs(session.id).filter(j=>j.id.startsWith('run-')).length>=2&&!this.store.job(id))throw new Error('SESSION_JOB_QUOTA_REACHED');
  const job=this.store.startJob(id,session.id,request.privacy==='private'?{...request,privacy:'encrypted'}:request);
  // Resume the same bounded operation, including a transient failure saved
  // by an earlier runtime. Its purchase IDs, approvals and quota stay fixed.
  const privateConfirmation=request.privacy==='private'&&this.store.jobs(session.id).some(j=>j.id.startsWith('receipt-')&&j.request&&['STARTED','WAITING'].includes(j.state));
  if(job.state==='FAILED'&&this.clock()<job.created_at_ms+this.jobTimeoutMs&&((job.error==='AI_PLAN_INVALID'&&(job.attempts??0)<3)||(retryable(job.error)&&((job.failures??0)<3||privateConfirmation)))){job.state='WAITING';delete job.error;this.store.saveJob(job);this.invalidateSnapshot(session.id);}
  return job;
 }
 prepareClear(session,request){
  if(session.state&&session.state!=='READY')throw new Error('SESSION_PROVISIONING');
  if(!request||!/^[a-f\d-]{16,40}$/.test(request.request_id)||!['public','private'].includes(request.privacy??'public')||!Array.isArray(request.invoice_ids)||request.invoice_ids.length<1||request.invoice_ids.length>48||new Set(request.invoice_ids).size!==request.invoice_ids.length)throw new Error('INVALID_CLEARING_REQUEST');
  if(request.privacy==='private'&&request.invoice_ids.length>V4_MAX_PRIVATE_INVOICES)throw new Error('PRIVATE_INVOICE_LIMIT');
  const selected=request.selected_accounts;
  if(!Array.isArray(selected)||selected.length<2||selected.length>12||new Set(selected).size!==selected.length||selected.some(id=>!session.participants.some(p=>p.account_id===id)))throw new Error('SELECT_ROUND_PARTICIPANTS');
  const id='clear-'+request.request_id;
  if(this.store.jobs(session.id).filter(j=>j.id.startsWith('clear-')).length>=12&&!this.store.job(id))throw new Error('SESSION_CLEARING_QUOTA_REACHED');
  return this.store.startJob(id,session.id,{...request,privacy:request.privacy==='private'?'encrypted':'public'});
 }
 async run(session,request){
  const id='run-'+request.request_id;
  let job=this.prepareRun(session,request);if(job.state==='COMPLETE')return job.result;
  if(job.state==='FAILED')throw new Error(job.error??'SERVICE_UNAVAILABLE');
  if(this.running.has(id))return this.running.get(id);
  const task=(async()=>{
   job.attempts=(job.attempts??0)+1;job.state='STARTED';this.store.saveJob(job);this.invalidateSnapshot(session.id);
   this.store.event(session.id,'brief-started',id,{mode:request.mode,private:request.privacy==='private'});
   try{
    const result=await this.agents.runBrief(session,request);job={...job,state:'COMPLETE',result};this.store.saveJob(job);this.invalidateSnapshot(session.id);
    const latest=this.store.session(session.id)??session;latest.last_job_id=id;this.store.updateSession(latest);this.store.event(session.id,'brief-completed',id,{mode:request.mode,private:request.privacy==='private'});return result;
   }catch(error){const code=jobError(error),processing=code==='PRIVATE_PROCESSING',failures=(job.failures??0)+(processing?0:1),withinDeadline=this.clock()<job.created_at_ms+this.jobTimeoutMs;job={...job,failures,state:withinDeadline&&retryable(code)&&(processing||failures<3)?'WAITING':'FAILED',error:code,retry_at_ms:this.clock()+10000};this.store.saveJob(job);this.invalidateSnapshot(session.id);throw error;}
  })().finally(()=>this.running.delete(id));this.running.set(id,task);return task;
 }
 async privateInvoices(session){
  if(!this.config.private?.enabled||!this.agents.privateSummary)return[];
  if(!this.store.jobs(session.id).some(j=>j.id.startsWith('run-')&&j.payload.privacy==='encrypted'))return[];
  const responses=await Promise.all(session.participants.map(p=>this.agents.privateSummary(p.kind,session))),seen=new Map();
  for(const response of responses)for(const i of response.invoices){const prior=seen.get(i.nullifier);if(prior&&prior.commitment!==i.commitment)throw new Error('PRIVATE_CONTRIBUTION_CONFLICT');seen.set(i.nullifier,i);}
  const invoices=[...seen.values()];await this.store.put({id:'private-index:'+session.id,invoices,at_ms:this.clock()});return invoices;
 }
 async verifyPrivateReceipt(session,{envelope,parties}){
  if(!this.config.private?.enabled||!this.getPrivateClient)throw new Error('PRIVATE_MODE_UNAVAILABLE');
  if(!envelope||!/^[a-f\d]{64}$/.test(envelope.nullifier??'')||!/^[a-f\d]{64}$/.test(envelope.commitment??'')||!Array.isArray(parties)||parties.length!==2||new Set(parties).size!==2||parties.some(id=>!session.participants.some(p=>p.account_id===id)))throw new Error('PRIVATE_RECEIPT_SCOPE_MISMATCH');
  const members=[...parties].sort(),key='receipt-'+envelope.nullifier;
  let job=this.store.startJob(key,session.id,{privacy:'encrypted',nullifier:envelope.nullifier,commitment:envelope.commitment,members});
  if(job.state==='COMPLETE')return job.result;
  if(this.running.has(key))return this.running.get(key);
  const task=(async()=>{
   const client=await this.getClient();
   const already=await client.privateInvoice(envelope.nullifier);
   if(already){if(already.charge.commitment!==envelope.commitment)throw new Error('PRIVATE_RECEIPT_COMMITMENT_MISMATCH');job.state='COMPLETE';job.result={verified:true,nullifier:envelope.nullifier};this.store.saveJob(job);return job.result;}
   let pending=job.request?await client.privateRequest(job.request.id):null;
   if(pending?.status==='PROCESSING'&&pending.deadline_ms<=this.clock()){pending=(await client.expirePrivateRequest(pending.id)).value;}
   if(pending&&['FAILED','EXPIRED','INVALID_OUTPUT'].includes(pending.status)){job.attempt=(job.attempt??0)+1;delete job.request;pending=null;}
   if(!job.request){
    const id='verify-'+envelope.nullifier+(job.attempt?'-'+job.attempt:'');
    if(!this.store.job('tee-'+id)&&this.store.jobs(session.id).filter(j=>j.id.startsWith('tee-')).length>=12)throw new Error('PRIVATE_SPONSOR_QUOTA_REACHED');
    job.request={id,profile:this.config.private.profile,members,deadline_ms:this.clock()+300000,encrypted_invoices:[envelope],verification_only:true};
    this.store.startJob('tee-'+id,session.id,{privacy:'encrypted',...job.request});this.store.saveJob(job);
   }
   if(!pending){
    const privateClient=await this.getPrivateClient();
    try{await privateClient.requestPrivateRound(job.request);}
    catch(error){
     if(!(error instanceof V4BroadcastUnknown)&&jobError(error)!=='RPC_UNAVAILABLE')throw error;
     // The signed request is durably recorded. Its confirmation is pending;
     // the buyer must resume this purchase rather than count a service failure.
     job.state='WAITING';this.store.saveJob(job);return{verified:false,state:'WAITING'};
    }
   }
   const registered=await client.privateInvoice(envelope.nullifier);
   if(registered&&registered.charge.commitment===envelope.commitment){job.state='COMPLETE';job.result={verified:true,nullifier:envelope.nullifier};this.store.saveJob(job);this.store.event(session.id,'private-receipt-verified',envelope.nullifier,{private:true});return job.result;}
   job.state='WAITING';this.store.saveJob(job);return{verified:false,state:'WAITING'};
  })().finally(()=>this.running.delete(key));this.running.set(key,task);return task;
 }
 async snapshot(session){
  if(!this.snapshotTtlMs)return this.readSnapshot(session);
  const cached=this.snapshots.get(session.id);if(cached&&this.clock()-cached.at<this.snapshotTtlMs)return cached.value;
  if(this.snapshotTasks.has(session.id))return this.snapshotTasks.get(session.id);
  // An invalidated read may still finish. It must neither repopulate the
  // cache nor remove a newer read that started after a job or balance changed.
  const task=this.readSnapshot(session).then(value=>{if(this.snapshotTasks.get(session.id)===task)this.snapshots.set(session.id,{at:this.clock(),value});return value;}).finally(()=>{if(this.snapshotTasks.get(session.id)===task)this.snapshotTasks.delete(session.id);});
  this.snapshotTasks.set(session.id,task);return task;
 }
 async readSnapshot(session){
  const deployment={protocol_version:4,network:this.config.network,vault:this.config.vault,token:this.config.token,decimals:6,code_hash:this.config.code_hash,rpc_url:this.config.rpc_url,rpc_urls:this.config.rpc_urls??[this.config.rpc_url]};
  const basic={session:{id:session.id,created_at_ms:session.created_at_ms,participants:session.participants,initial_balance:'1000000',expires_at_ms:session.expires_at_ms,state:session.state??'READY',testnet:true},deployment,privacy:{enabled:Boolean(this.config.private?.enabled),verified:Boolean(this.config.private?.private_round_verified),worker_hash:this.config.private?.hash,reason:this.config.private?.enabled?'Invoice contents and deliverables are encrypted for the participating agents. Participants, net movements and timing remain public.':'Private computation is being connected.'},intents:{enabled:Boolean(this.config.intents?.dry_quotes_enabled),network:'mainnet',routes_exercised:Boolean(this.config.intents?.mainnet_routes_exercised),reason:'Funding and payouts route through owner-controlled accounts. The free session uses test funds.'}};
  if(session.state&&session.state!=='READY')return{...basic,balances:[],invoices:[],private_invoices:[],rounds:[],jobs:[],events:this.store.events(session.id),last_sync_at_ms:null,financial_data_available:false};
  this.recoverRoundIndex(session);
  const client=await this.getClient(),seen=new Map();
  const [balances,externalBalances,recoveryWithdrawals]=await Promise.all([
   Promise.all(session.participants.map(p=>client.balance(p.account_id))),
   Promise.all(session.participants.map(async p=>({account_id:p.account_id,amount:await client.transport.view(this.config.token,'ft_balance_of',{account_id:p.account_id})}))),
   Promise.all(session.participants.map(p=>client.recoveryWithdrawal(p.account_id))),
  ]);
  for(const p of session.participants){let cursor=0;do{const page=await client.listInvoices(cursor,100,p.account_id);for(const i of page.items)seen.set(i.spec.id,i);cursor=page.next_cursor;}while(cursor!==null);}
  const rounds=[];for(const id of session.round_ids??[]){
   try{rounds.push(await this.readRound(client,id));}
   catch(error){
    if(!/ROUND_NOT_FOUND/.test(error.message))throw error;
    const pending=await client.privateRequest(id);
    // A durable local intent can precede successful inclusion. Keep its job
    // visible, without inventing a financial round or failing other reads.
    if(!pending&&!this.store.jobs(session.id).some(j=>j.id.startsWith('clear-')&&j.round_id===id))throw new Error('ROUND_SYNCHRONIZATION_UNAVAILABLE');
   }
  }
  let privateInvoices=[],privateDataAvailable=true;
  try{privateInvoices=await this.privateInvoices(session);}catch{privateDataAvailable=false;privateInvoices=(await this.store.get('private-index:'+session.id))?.invoices??[];}
  const jobs=this.store.jobs(session.id).filter(j=>j.id.startsWith('run-'));
  this.lastSync=this.clock();
  return{...basic,balances,external_balances:externalBalances,recovery_withdrawals:recoveryWithdrawals,invoices:[...seen.values()].sort((a,b)=>a.sequence-b.sequence),private_invoices:privateInvoices.map(({envelope,...i})=>i),private_data_available:privateDataAvailable,rounds,
   jobs:jobs.map(j=>({id:j.id,state:j.state,result:j.result?.kind==='encrypted-result'?null:j.result??null,sealed_result:j.result?.kind==='encrypted-result'?j.result:null,error:j.error??null})),
   pending_actions:this.store.jobs(session.id).filter(j=>j.id.startsWith('clear-')&&j.state!=='COMPLETE').map(j=>({id:j.id,state:j.state,reason:j.reason??j.error??null,round_id:j.round_id??null})),
   events:this.store.events(session.id),last_sync_at_ms:this.lastSync,financial_data_available:true};
 }
 async clear(session,request){
  const prepared=this.prepareClear(session,request);
  if(prepared.state==='COMPLETE')return prepared.result;
  if(prepared.state==='FAILED')throw new Error(prepared.error??'CLEARING_FAILED');
  const key='clear-'+request.request_id;if(this.running.has(key))return this.running.get(key);
  const task=this.performClear(session,request).catch(error=>{const job=this.store.job(key);if(job){job.error=jobError(error);job.state=retryable(job.error)?'WAITING':'FAILED';job.retry_at_ms=this.clock()+10000;this.store.saveJob(job);}throw error;}).finally(()=>{this.running.delete(key);this.invalidateSnapshot(session.id);});this.running.set(key,task);return task;
 }
 appendRound(session,id){const latest=this.store.session(session.id)??session;if(!latest.round_ids?.includes(id)){latest.round_ids=[...(latest.round_ids??[]),id];this.store.updateSession(latest);}session.round_ids=latest.round_ids;}
 async performClear(session,request){
  const{request_id,selected_accounts,invoice_ids,privacy='public'}=request;
  if(!/^[a-f\d-]{16,40}$/.test(request_id)||!Array.isArray(invoice_ids)||invoice_ids.length<1||invoice_ids.length>48||new Set(invoice_ids).size!==invoice_ids.length)throw new Error('INVALID_CLEARING_REQUEST');
  const key='clear-'+request_id;
  if(this.store.jobs(session.id).filter(j=>j.id.startsWith('clear-')).length>=12&&!this.store.job(key))throw new Error('SESSION_CLEARING_QUOTA_REACHED');
  let job=this.store.startJob(key,session.id,{...request,privacy:privacy==='private'?'encrypted':'public'});
  const client=await this.getClient(),selected=new Set(selected_accounts);
  if(selected.size<2||[...selected].some(id=>!session.participants.some(p=>p.account_id===id)))throw new Error('SELECT_ROUND_PARTICIPANTS');
  let round;
  if(job.round_id){
   this.appendRound(session,job.round_id);
   try{round=await client.round(job.round_id);}catch{
    if(privacy!=='private'){round=(await client.proposeRound(job.round_id,invoice_ids,job.deadline_ms)).value;}
    else{
    let req=await client.privateRequest(job.round_id);
    if(!req){const privateClient=await this.getPrivateClient();await privateClient.requestPrivateRound(job.private_request);return{state:'WAITING',round:null,reason:'PRIVATE_PROCESSING'};}
    if(req?.status==='PROCESSING'&&req.deadline_ms<=this.clock()){req=(await client.expirePrivateRequest(req.id)).value;}
    else if(req?.status==='PROCESSING')return{state:'WAITING',round:null,reason:'PRIVATE_PROCESSING'};
    if(!req||!['FAILED','EXPIRED','INVALID_OUTPUT'].includes(req.status))throw new Error('PRIVATE_ROUND_UNAVAILABLE');
    }
   }
   if(round?.status==='SETTLED'){job.state='COMPLETE';job.result={round};this.store.saveJob(job);return{round};}
   if(round&&['EXPIRED','STALE','CANCELLED'].includes(round.status)||!round){job.attempt=(job.attempt??0)+1;delete job.round_id;round=null;}
  }
  if(!round){
   job.deadline_ms=this.clock()+300000;
   if(privacy==='private'){
    if(!this.config.private?.enabled||!this.getPrivateClient)throw new Error('PRIVATE_MODE_UNAVAILABLE');
    const all=await this.privateInvoices(session),included=invoice_ids.map(id=>all.find(i=>i.nullifier===id));
    if(included.some(i=>!i||i.status!=='ACCEPTED'||i.parties.some(p=>!selected.has(p))))throw new Error('SELECTED_INVOICE_SCOPE_MISMATCH');
    const members=[...new Set(included.flatMap(i=>i.parties))];
    job.round_id='private-'+request_id+(job.attempt?'-'+job.attempt:'');
    const executionId='tee-'+job.round_id;
    if(!this.store.job(executionId)&&this.store.jobs(session.id).filter(j=>j.id.startsWith('tee-')).length>=12)throw new Error('PRIVATE_SPONSOR_QUOTA_REACHED');
    job.private_request={id:job.round_id,profile:this.config.private.profile,members,deadline_ms:job.deadline_ms,encrypted_invoices:included.map(i=>i.envelope)};
    job.private_request.disclosure_signatures=await Promise.all(members.map(id=>this.agents.disclosePrivate(session.participants.find(p=>p.account_id===id).kind,session,job.private_request)));
    this.store.startJob(executionId,session.id,{privacy:'encrypted',...job.private_request});this.store.saveJob(job);this.appendRound(session,job.round_id);
    const privateClient=await this.getPrivateClient();
    await privateClient.requestPrivateRound(job.private_request);
    const req=await client.privateRequest(job.round_id);
    if(req?.status!=='VERIFIED'){job.state='WAITING';job.reason='PRIVATE_PROCESSING';this.store.saveJob(job);return{state:'WAITING',round:null,reason:job.reason};}
    round=await client.round(job.round_id);
   }else{
    const invoices=await Promise.all(invoice_ids.map(id=>client.invoice(id)));
    if(invoices.some(i=>i.status!=='ACCEPTED'||!selected.has(i.spec.buyer)||!selected.has(i.spec.seller)))throw new Error('SELECTED_INVOICE_SCOPE_MISMATCH');
    const plan=v4NetPlan(invoices.map(i=>i.spec));
    for(const position of plan.positions){const wallet=await client.balance(position.account_id);if(BigInt(position.net)<0n&&-BigInt(position.net)>BigInt(wallet.available)){job.state='WAITING';job.reason='INSUFFICIENT_AVAILABLE_BALANCE';this.store.saveJob(job);return{state:'WAITING',round:null,reason:job.reason};}}
    job.round_id='round-'+request_id+(job.attempt?'-'+job.attempt:'');this.store.saveJob(job);this.appendRound(session,job.round_id);
    round=(await client.proposeRound(job.round_id,invoice_ids,job.deadline_ms)).value;this.appendRound(session,round.input.id);
   }
  }
  for(const position of round.input.positions){
   if(round.approvals.some(a=>a.account_id===position.account_id)||round.status!=='COLLECTING')continue;
   const party=session.participants.find(p=>p.account_id===position.account_id);
   try{round=(await this.agents.approve(party.kind,session,round)).value;}
   catch(error){job.state='WAITING';job.reason=/^[A-Z_\d]+$/.test(error.message)?error.message:'PARTICIPANT_UNAVAILABLE';this.store.saveJob(job);return{state:'WAITING',round,reason:job.reason};}
  }
  if(round.status==='READY'){
   const result=await client.settleRound(round);round=result.value;this.store.event(session.id,'round-settled',round.input.id,{tx_hash:result.tx_hash,evidence:result.evidence,net_settlement_volume:round.net_settlement_volume,private:round.input.private});
  }
  job={...job,state:round.status==='SETTLED'?'COMPLETE':'WAITING',result:{round}};this.store.saveJob(job);return{round};
 }
 async tick(){
  for(const session of this.store.pendingSessions()){
   if(session.state&&session.state!=='READY')continue;const client=await this.getClient();
   this.recoverRoundIndex(session);
   for(const id of session.round_ids??[])try{
    if(await this.store.get('terminal-round:'+id))continue;
    const r=await this.readRound(client,id);
    if(r.status==='READY'){const settled=await client.settleRound(r);await this.store.put({id:'terminal-round:'+id,round:settled.value});this.invalidateSnapshot(session.id);}
    else if(r.status==='COLLECTING'&&r.input.deadline_ms<=this.clock()){const expired=await client.expireRound(id);await this.store.put({id:'terminal-round:'+id,round:expired.value});this.invalidateSnapshot(session.id);}
   }catch{}
   for(const job of this.store.jobs(session.id)){
    if(!['WAITING','STARTED'].includes(job.state)||job.retry_at_ms&&job.retry_at_ms>this.clock())continue;
    if(job.id.startsWith('run-')&&!this.running.has(job.id)){const r={...job.payload,privacy:job.payload.privacy==='encrypted'?'private':job.payload.privacy};void this.run(session,r).catch(()=>{});}
    else if(job.id.startsWith('clear-')&&!this.running.has(job.id)){const r={...job.payload,privacy:job.payload.privacy==='encrypted'?'private':job.payload.privacy};await this.clear(session,r).catch(()=>{});}
   }
   const data=await this.snapshot(this.store.session(session.id)??session);
   const accepted=data.invoices.filter(i=>i.status==='ACCEPTED'&&this.clock()-i.spec.ready_at_ms>=30000);
   const consenting=new Set(data.balances.filter(b=>b.policy&&!b.policy.revoked&&b.policy.expires_at_ms>this.clock()+300000).map(b=>b.account_id));
   const eligible=accepted.filter(i=>consenting.has(i.spec.buyer)&&consenting.has(i.spec.seller)).slice(0,48);
   if(eligible.length){
    const candidates=[eligible,...eligible.map(i=>[i])];
    for(const invoices of candidates){
     const plan=v4NetPlan(invoices.map(i=>i.spec));
     if(plan.positions.some(p=>BigInt(p.net)<0n&&-BigInt(p.net)>BigInt(data.balances.find(b=>b.account_id===p.account_id)?.available??'0')))continue;
     const request_id=v4Digest(session.id+':'+invoices.map(i=>i.spec.id).sort().join(':')).slice(0,32);
     const result=await this.clear(session,{request_id,selected_accounts:plan.positions.map(p=>p.account_id),invoice_ids:invoices.map(i=>i.spec.id)}).catch(()=>null);
     if(result?.round?.status==='SETTLED')break;
    }
   }
   if(data.private_data_available)for(const receipt of data.private_invoices.filter(i=>i.status==='SIGNED')){
    const encrypted=(await this.store.get('private-index:'+session.id))?.invoices.find(i=>i.nullifier===receipt.nullifier);
    if(encrypted)await this.verifyPrivateReceipt(session,{envelope:encrypted.envelope,parties:encrypted.parties}).catch(()=>{});
   }
   const privateEligible=data.private_invoices.filter(i=>i.status==='ACCEPTED'&&this.clock()-i.ready_at_ms>=30000&&i.parties.every(p=>consenting.has(p)));
   if(privateEligible.length){const included=privateEligible.slice(0,V4_MAX_PRIVATE_INVOICES);const request_id=v4Digest(session.id+':private:'+included.map(i=>i.nullifier).sort().join(':')).slice(0,32);await this.clear(session,{request_id,privacy:'private',selected_accounts:[...consenting],invoice_ids:included.map(i=>i.nullifier)}).catch(()=>{});}
  }
 }
}
