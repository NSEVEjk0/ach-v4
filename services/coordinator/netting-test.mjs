import {randomBytes} from 'node:crypto';
import {canonicalV4,v4Digest,v4NetPlan,v4FundedInvoiceId,v4ChargeId,v4PurchaseGroupId,v4FundingGroupHash,v4PrivateInvoiceCommitment,v4PrivateInputCommitment,v4PrivateDisclosureHash,encryptV4Invoice,V4_MAX_PRIVATE_INVOICES} from '../../packages/client/dist/v4.js';
import {orderHash} from '../agents/runtime.mjs';
import {serviceErrorCode} from '../lib/http.mjs';
import {sessionAgentKinds} from '../lib/workflow.mjs';

const retryable=code=>/UNKNOWN|UNAVAILABLE|PRIVATE_PROCESSING/.test(code);
async function all(work){const results=await Promise.allSettled(work);const failed=results.find(r=>r.status==='rejected');if(failed)throw failed.reason;return results.map(r=>r.value);}
/** Every chosen agent has an invoice. Large private tests use at most six edges. */
export function testEdges(participants,privateMode){
 const count=participants.length;
 if(!privateMode||count<=V4_MAX_PRIVATE_INVOICES)return participants.map((p,index)=>[p,participants[(index+1)%count]]);
 // A forest with six edges can include up to twelve distinct signers.
 // Put Audit last so each debit belongs to Research or a funded extra wallet.
 const ordered=[participants[0],participants[1],...participants.slice(3),participants[2]],components=count-V4_MAX_PRIVATE_INVOICES,edges=[];
 let cursor=0;
 for(let component=0;component<components;component++){
  const size=Math.floor(count/components)+(component<count%components?1:0),group=ordered.slice(cursor,cursor+size);cursor+=size;
  for(let index=0;index<group.length-1;index++)edges.push([group[index],group[index+1]]);
 }
 return edges;
}

/** Scripted, signer-backed test bills. No planning/inference is required. */
export class NettingTester{
 constructor({store,privateStore,config,getIdentity,getClient,getPrivateClient,clock=Date.now,onChange=()=>{}}){Object.assign(this,{store,privateStore,config,getIdentity,getClient,getPrivateClient,clock,onChange});this.running=new Map();}
 prepare(session,input){
  if(this.config.network!=='testnet'||session.state!=='READY')throw new Error('SESSION_PROVISIONING');
  if(!session.judge_testing)throw new Error('FRESH_JUDGE_WORKSPACE_REQUIRED');
  if(!input||!/^[a-f\d]{32}$/.test(input.request_id)||!Number.isInteger(input.agent_count)||!['public','private'].includes(input.privacy)||Object.keys(input).some(k=>!['request_id','agent_count','privacy'].includes(k)))throw new Error('INVALID_NETTING_TEST');
  sessionAgentKinds(input.agent_count);
  if(input.agent_count>session.participants.length)throw new Error('TEST_AGENT_COUNT_LIMIT');
  if(input.privacy==='private'&&!this.config.private?.enabled)throw new Error('PRIVATE_MODE_UNAVAILABLE');
  const id='test-netting-'+input.request_id;
  const job=this.store.startSessionJob(id,session.id,{...input,privacy:input.privacy==='private'?'encrypted':'public'},{kind:'test'});
  if(job.state==='FAILED'&&retryable(job.error)&&this.clock()<job.created_at_ms+900000){job.state='WAITING';this.store.saveJob(job);}
  return job;
 }
 async run(session,input){
  const publicJob=this.prepare(session,input),id=publicJob.id;
  if(publicJob.state==='COMPLETE')return publicJob.result;
  if(publicJob.state==='FAILED')throw new Error(publicJob.error??'NETTING_TEST_FAILED');
  if(this.running.has(id))return this.running.get(id);
  const task=this.execute(session,input,publicJob).catch(error=>{
   const job=this.store.job(id),code=serviceErrorCode(error,'SERVICE_OR_CHAIN_UNAVAILABLE');
   job.state=retryable(code)?'WAITING':'FAILED';job.error=code;job.retry_at_ms=this.clock()+10000;this.store.saveJob(job);this.onChange(session.id);throw error;
  }).finally(()=>this.running.delete(id));this.running.set(id,task);return task;
 }
 stage(job,phase){job.state='STARTED';job.phase=phase;delete job.error;this.store.saveJob(job);this.onChange(job.session_id);}
 async execute(session,input,publicJob){
  const chosen=session.participants.slice(0,input.agent_count),identities=await all(chosen.map(p=>this.getIdentity(session,p)));
  if(new Set(identities.map(i=>i.account_id)).size!==chosen.length||new Set(chosen.map(p=>p.public_key)).size!==chosen.length||identities.some((i,index)=>i.account_id!==chosen[index].account_id||Buffer.from(i.key.getPublicKey().data).toString('hex')!==chosen[index].public_key))throw new Error('SESSION_IDENTITY_SCOPE_REQUIRED');
  const byAccount=new Map(identities.map(i=>[i.account_id,i])),client=await this.getClient();
  let job=this.privateStore.startJob(publicJob.id,session.id,input);
  if(!job.input){
   const groupId=v4PurchaseGroupId(this.config,identities[0].account_id,'judge-'+input.request_id),deadline_ms=this.clock()+900000;
   const edges=testEdges(chosen,input.privacy==='private');
   job.orders=edges.map(([buyer,seller],index)=>{
    const purchase_id=v4Digest(groupId+':'+index).slice(0,32),artifact_hash=v4Digest('ACH signed synthetic test bill:'+purchase_id);
    return{purchase_id,terms_version:1,buyer:buyer.account_id,seller:seller.account_id,asset:this.config.token,price:index===0?'100000':'80000',service:'netting-test',input_hash:v4Digest('judge-test:'+index),privacy:input.privacy,deadline_ms,funding_group_id:groupId,expected_artifact_hash:artifact_hash,reservation_salt:randomBytes(32).toString('hex')};
   });
   job.specs=job.orders.map(order=>({id:v4FundedInvoiceId(this.config,order),purchase_id:order.purchase_id,terms_version:1,buyer:order.buyer,seller:order.seller,asset:order.asset,amount:order.price,service:order.service,terms_hash:orderHash(this.config,order),artifact_hash:order.expected_artifact_hash,ready_at_ms:this.clock(),expires_at_ms:deadline_ms}));
   const plan=v4NetPlan(job.specs);
   job.input={id:groupId,private:input.privacy==='private',deadline_ms,positions:plan.positions,orders:job.orders.map(order=>({purchase_id:order.purchase_id,terms_version:1,buyer:order.buyer,seller:order.seller,order_commitment:input.privacy==='private'?v4Digest(canonicalV4('private-order',this.config.network,this.config.vault,[v4ChargeId(this.config,order),orderHash(this.config,order),order.reservation_salt])):orderHash(this.config,order),public_terms:input.privacy==='private'?null:{amount:order.price,service:order.service,terms_hash:orderHash(this.config,order),artifact_hash:order.expected_artifact_hash}}))};
   this.privateStore.saveJob(job);
  }
  publicJob.group_id=job.input.id;publicJob.invoice_count=job.input.orders.length;this.store.saveJob(publicJob);
  let group;try{group=await client.purchaseGroup(job.input.id);}catch(error){if(!/PURCHASE_GROUP_NOT_FOUND/.test(error.message))throw error;}
  if(group&&v4FundingGroupHash(this.config,job.input)!==group.hash)throw new Error('PURCHASE_GROUP_HASH_MISMATCH');
  if(group?.status==='EXPIRED')throw new Error('NETTING_TEST_EXPIRED');
  if(!group||!['READY','SETTLED'].includes(group.status)){
   if(job.input.deadline_ms<=this.clock())throw new Error('NETTING_TEST_EXPIRED');
   this.stage(publicJob,'Checking each agent’s spending permissions');
   const policies=await all(identities.map(async identity=>({account_id:identity.account_id,policy:(await identity.client.balance()).policy})));
   const policyByAccount=new Map(policies.map(p=>[p.account_id,p.policy]));
   if(policies.some(p=>!p.policy||p.policy.revoked||p.policy.expires_at_ms<=job.input.deadline_ms||p.policy.services.length&&!p.policy.services.includes('netting-test')))throw new Error('AGENT_AUTHORITY_EXPIRED_OR_REVOKED');
   this.stage(publicJob,'Funding the exact net commitments');
   if(!group){await identities[0].client.proposePurchaseGroup(job.input);group=await client.purchaseGroup(job.input.id);}
   if(group.status==='COLLECTING'){
    await all(identities.filter(i=>!group.approvals.some(a=>a.account_id===i.account_id)).map(async identity=>{
     const own=job.input.positions.find(p=>p.account_id===identity.account_id),incident=job.specs.filter(i=>[i.buyer,i.seller].includes(identity.account_id)),expected=v4NetPlan(incident).positions.find(p=>p.account_id===identity.account_id);
     if(!own||!expected||own.net!==expected.net)throw new Error('EXACT_NET_AUTHORIZATION_REQUIRED');
     return identity.client.authorizePurchaseGroup(group,expected.net);
    }));group=await client.purchaseGroup(job.input.id);
   }
   if(group.status!=='FUNDED')throw new Error('PURCHASE_GROUP_NOT_FUNDED');
   if(input.privacy==='public'){
    this.stage(publicJob,'Signing and accepting every test bill');
    await all(job.specs.map(async spec=>{
     const buyer=byAccount.get(spec.buyer),seller=byAccount.get(spec.seller),invoice=(await buyer.client.proposeInvoice(spec)).value;
     await buyer.client.acceptInvoice(invoice);await seller.client.acceptInvoice(invoice);
    }));
   }else{
    this.stage(publicJob,'Encrypting the signed private bills');
    if(!job.envelopes){
     const encryption=await client.privateEncryptionKey();if(!encryption||encryption.worker_hash!==this.config.private.hash)throw new Error('PRIVATE_MODE_UNAVAILABLE');
     job.envelopes=job.specs.map(spec=>{
      const salt=randomBytes(32).toString('hex'),commitment=v4PrivateInvoiceCommitment(this.config,spec,salt);
      return encryptV4Invoice(this.config,encryption,{spec,salt,signatures:[spec.buyer,spec.seller].map(account_id=>({account_id,key_epoch:policyByAccount.get(account_id).epoch,signature:Buffer.from(byAccount.get(account_id).key.sign(Buffer.from(commitment,'hex')).signature).toString('base64')}))});
     });this.privateStore.saveJob(job);
    }
    await all(job.orders.map((order,index)=>byAccount.get(order.buyer).client.authorizePrivatePurchase({purchase_id:order.purchase_id,terms_version:1,seller:order.seller,order_commitment:job.input.orders[index].order_commitment,deadline_ms:job.input.deadline_ms})));
    let pending=job.request?await client.privateRequest(job.request.id):null;
    if(pending?.status==='PROCESSING'&&pending.deadline_ms<=this.clock())pending=(await client.expirePrivateRequest(pending.id)).value;
    if(pending&&['FAILED','EXPIRED','INVALID_OUTPUT'].includes(pending.status)){job.attempt=(job.attempt??0)+1;delete job.request;pending=null;}
    if(!job.request){
     if((job.attempt??0)>=3)throw new Error('PRIVATE_SPONSOR_QUOTA_REACHED');
     const request={id:job.input.id+'-net-'+(job.attempt??0),funding_group_id:job.input.id,profile:this.config.private.profile,members:job.input.positions.map(p=>p.account_id),deadline_ms:Math.min(this.clock()+300000,job.input.deadline_ms),encrypted_invoices:job.envelopes};
     const commitment=v4PrivateInputCommitment(this.config,request.id,request.deadline_ms,this.config.private.hash,request.encrypted_invoices),disclosure=v4PrivateDisclosureHash(this.config,commitment,request.members);
     request.disclosure_signatures=request.members.map(account_id=>({account_id,key_epoch:policyByAccount.get(account_id).epoch,signature:Buffer.from(byAccount.get(account_id).key.sign(Buffer.from(disclosure,'hex')).signature).toString('base64')}));
     if(!this.store.job('tee-'+request.id)&&this.store.jobs(session.id).filter(j=>j.id.startsWith('tee-')).length>=12)throw new Error('PRIVATE_SPONSOR_QUOTA_REACHED');
     this.store.startJob('tee-'+request.id,session.id,{privacy:'encrypted',funding_group_id:job.input.id});
     job.request=request;this.privateStore.saveJob(job);publicJob.round_id=request.id;this.store.saveJob(publicJob);
    }
    this.stage(publicJob,'Verifying and netting in OutLayer');
    if(!pending)await(await this.getPrivateClient()).requestPrivateRound(job.request);
    pending=await client.privateRequest(job.request.id);
    if(pending?.status!=='VERIFIED')throw new Error('PRIVATE_PROCESSING');
   }
   group=await client.purchaseGroup(job.input.id);
  }
  if(!['READY','SETTLED'].includes(group.status)||!group.round_id)throw new Error('PAYMENT_COMMITMENT_REQUIRED');
  publicJob.round_id=group.round_id;this.store.saveJob(publicJob);
  const latest=this.store.session(session.id)??session;latest.round_ids=[...new Set([...(latest.round_ids??[]),group.round_id])];this.store.updateSession(latest);session.round_ids=latest.round_ids;
  let round=await client.round(group.round_id);
  if(round.status==='READY'||round.status==='SETTLED'&&publicJob.settlement_operation_id==='settle:'+round.input.id){
   publicJob.settlement_operation_id='settle:'+round.input.id;this.store.saveJob(publicJob);
   this.stage(publicJob,'Settling the funded round on NEAR');
   const settled=await client.settleRound(round);round=settled.value;
   this.store.eventOnce(session.id,'round-settled',round.input.id,{tx_hash:settled.tx_hash,evidence:settled.evidence,net_settlement_volume:round.net_settlement_volume,private:round.input.private});
  }
  if(round.status!=='SETTLED')throw new Error('ROUND_SYNCHRONIZATION_UNAVAILABLE');
  publicJob.state='COMPLETE';publicJob.phase='Settled';publicJob.result={round_id:round.input.id,group_id:job.input.id,agent_count:input.agent_count,invoice_count:job.input.orders.length,private:input.privacy==='private',network:this.config.network,gross_invoice_volume:round.gross_invoice_volume,net_settlement_volume:round.net_settlement_volume,elapsed_ms:this.clock()-publicJob.created_at_ms};
  delete publicJob.error;delete publicJob.retry_at_ms;
  this.store.saveJob(publicJob);job.state='COMPLETE';this.privateStore.saveJob(job);this.onChange(session.id);return publicJob.result;
 }
 async privateSummary(session){
  const client=await this.getClient(),entries=[];
  for(const job of this.privateStore.jobs(session.id).filter(j=>j.payload.privacy==='private'))for(const envelope of job.envelopes??[]){
   const spec=job.specs.find(s=>v4ChargeId(this.config,s)===envelope.nullifier),registered=await client.privateInvoice(envelope.nullifier);
   entries.push({nullifier:envelope.nullifier,commitment:envelope.commitment,parties:[spec.buyer,spec.seller],status:registered?.status??'SIGNED',round_id:registered?.round_id??null,funding_group_id:job.input.id,verification_mode:'funded-group',ready_at_ms:spec.ready_at_ms,envelope});
  }
  return{invoices:entries};
 }
 resume(){
  for(const session of this.store.pendingSessions())for(const job of this.store.jobs(session.id).filter(j=>j.id.startsWith('test-netting-')&&['STARTED','WAITING'].includes(j.state)))if(!this.running.has(job.id)&&(!job.retry_at_ms||job.retry_at_ms<=this.clock()))void this.run(session,{...job.payload,privacy:job.payload.privacy==='encrypted'?'private':'public'}).catch(()=>{});
 }
}
