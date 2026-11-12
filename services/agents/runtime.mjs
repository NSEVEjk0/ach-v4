import {randomBytes}from 'node:crypto';
import {canonicalV4,v4Digest,v4InvoiceHash,verifyV4InvoiceSignature,v4NetPlan,v4PrivateInvoiceCommitment,v4PrivateInputCommitment,v4PrivateDisclosureHash,encryptV4Invoice,v4ChargeId,v4FundingGroupHash,v4FundedInvoiceId,v4PurchaseGroupId}from '../../packages/client/dist/v4.js';
import {referencePacket,auditPacket,chartArtifact,validateArtifact,SOURCE_CORPUS,EXAMPLE_DATA}from './artifacts.mjs';
import {planBrief}from './planner.mjs';
import {openBrief,sealResult,briefPublicKey}from './privacy.mjs';

export const SERVICES=Object.freeze({references:{kind:'research',price:'80000',name:'Cited reference packet'},chart:{kind:'visual',price:'100000',name:'Chart generation'},audit:{kind:'audit',price:'100000',name:'Schema and provenance audit'}});
export function orderHash(config,order){return v4Digest(canonicalV4('order',config.network,config.vault,[order.purchase_id,order.buyer,order.seller,order.asset,order.price,order.service,order.input_hash,String(order.deadline_ms),order.privacy??'public',...(order.funding_group_id?[order.funding_group_id,order.expected_artifact_hash]:[])]));}
const purchaseId=(parent,service)=>v4Digest(parent+':'+service).slice(0,32);
const privateOrderCommitment=(config,order,salt)=>v4Digest(canonicalV4('private-order',config.network,config.vault,[v4ChargeId(config,{buyer:order.buyer,purchase_id:order.purchase_id,terms_version:1}),orderHash(config,order),salt]));
export function expectedArtifact(service,input){
 if(service==='references')return referencePacket(input.brief,input.data);
 const audit=auditPacket(input.data,referencePacket(input.brief,input.data).references);
 if(service==='audit')return audit;
 if(service==='chart')return chartArtifact(input.brief,input.data,input.verified?audit:undefined);
 throw new Error('INVALID_SERVICE_ORDER');
}
export class ServiceAgent{
 constructor({kind,config,store,getIdentity,dispatch,clock=Date.now,planner=planBrief,ingressSecret,verifyPrivate,preparePrivateGroup}){
  Object.assign(this,{kind,config,store,getIdentity,dispatch,clock,planner,ingressSecret,verifyPrivate,preparePrivateGroup});this.inflight=new Map();
 }
 async prepareFundingGroup(session,request,plan,brief,data){
  const identity=await this.getIdentity(session.id),id=v4PurchaseGroupId(this.config,identity.account_id,request.request_id);
  let job=this.store.startJob('fund-'+id,session.id,{request_id:request.request_id,privacy:request.privacy,plan,brief,data});
  if(!job.input){
   const account=kind=>session.participants.find(p=>p.kind===kind)?.account_id;
   const chartId=purchaseId(request.request_id,'chart'),auditId=purchaseId(chartId,'audit');
   const specs=[['chart',chartId,'research','visual',{brief:plan.title??brief,data,verified:plan.needs_audit}]];
   if(plan.needs_audit)specs.push(['audit',auditId,'visual','audit',{brief:plan.title??brief,data}],['references',purchaseId(auditId,'references'),'audit','research',{brief:plan.title??brief,data}]);
   const deadline_ms=this.clock()+900000;
   job.orders=specs.map(([service,purchase_id,buyer,seller,input])=>({service,input,purchase_id,buyer:account(buyer),seller:account(seller),asset:this.config.token,price:SERVICES[service].price,privacy:request.privacy,input_hash:v4Digest(JSON.stringify(input)),deadline_ms,funding_group_id:id,expected_artifact_hash:v4Digest(JSON.stringify(expectedArtifact(service,input))),...(request.privacy==='private'?{reservation_salt:randomBytes(32).toString('hex')}: {})}));
   const positions=v4NetPlan(job.orders.map(o=>({id:'bill-'+o.purchase_id,buyer:o.buyer,seller:o.seller,amount:o.price}))).positions;
   job.input={id,private:request.privacy==='private',deadline_ms,positions,orders:job.orders.map(o=>({purchase_id:o.purchase_id,terms_version:1,buyer:o.buyer,seller:o.seller,order_commitment:request.privacy==='private'?privateOrderCommitment(this.config,o,o.reservation_salt):orderHash(this.config,o),public_terms:request.privacy==='private'?null:{amount:o.price,service:o.service,terms_hash:orderHash(this.config,o),artifact_hash:o.expected_artifact_hash}}))};
   this.store.saveJob(job);
  }
  let group=(await identity.client.proposePurchaseGroup(job.input)).value;
  for(const p of group.input.positions){
   if(group.approvals.some(a=>a.account_id===p.account_id)||group.status!=='COLLECTING')continue;
   const kind=session.participants.find(a=>a.account_id===p.account_id)?.kind;if(!kind)throw new Error('SESSION_PARTICIPANT_REQUIRED');
   const response=await this.dispatch(kind,session,{authorize_group:{input:job.input,orders:job.orders}});group=response.group;
  }
  if(!['FUNDED','READY','SETTLED'].includes(group.status))throw new Error('PURCHASE_GROUP_NOT_FUNDED');
  job.state='COMPLETE';job.result={group};this.store.saveJob(job);return group;
 }
 async authorizeGroup(session,{input,orders}){
  const identity=await this.getIdentity(session.id);
  v4FundingGroupHash(this.config,input);
  if(!Array.isArray(orders)||orders.length!==input.orders.length||input.positions.some(p=>!session.participants.some(a=>a.account_id===p.account_id)))throw new Error('SESSION_PURCHASE_GROUP_REQUIRED');
  const supplied=orders.map(o=>v4ChargeId(this.config,{...o,terms_version:1})).sort(),committedCharges=input.orders.map(o=>v4ChargeId(this.config,o)).sort();
  if(new Set(supplied).size!==supplied.length||JSON.stringify(supplied)!==JSON.stringify(committedCharges))throw new Error('PURCHASE_GROUP_ORDER_SET_MISMATCH');
  const ownOrders=orders.filter(o=>o.buyer===identity.account_id||o.seller===identity.account_id);
  let net=0n;
  for(const order of ownOrders){
   const definition=SERVICES[order.service],committed=input.orders.find(o=>o.purchase_id===order.purchase_id&&o.buyer===order.buyer);
   if(!definition||definition.price!==order.price||!committed||committed.terms_version!==1||committed.seller!==order.seller||order.seller===identity.account_id&&definition.kind!==this.kind||order.asset!==this.config.token||order.funding_group_id!==input.id||order.deadline_ms!==input.deadline_ms||order.input_hash!==v4Digest(JSON.stringify(order.input))||order.expected_artifact_hash!==v4Digest(JSON.stringify(expectedArtifact(order.service,order.input))))throw new Error('FUNDED_ORDER_TERMS_MISMATCH');
   if(input.private&&!/^[a-f\d]{64}$/.test(order.reservation_salt??''))throw new Error('PRIVATE_ORDER_NOT_AUTHORIZED');
   const commitment=input.private?privateOrderCommitment(this.config,order,order.reservation_salt):orderHash(this.config,order);
   if(commitment!==committed.order_commitment||input.private!==(order.privacy==='private'))throw new Error('PURCHASE_GROUP_HASH_MISMATCH');
   if(!input.private&&(committed.public_terms?.amount!==order.price||committed.public_terms.service!==order.service||committed.public_terms.terms_hash!==orderHash(this.config,order)||committed.public_terms.artifact_hash!==order.expected_artifact_hash))throw new Error('FUNDED_ORDER_TERMS_MISMATCH');
   net+=order.seller===identity.account_id?BigInt(order.price):-BigInt(order.price);
  }
  const own=input.positions.find(p=>p.account_id===identity.account_id);
  if(!ownOrders.length||!own||own.net!==net.toString())throw new Error('EXACT_NET_AUTHORIZATION_REQUIRED');
  const preparedOrders=ownOrders.filter(o=>o.buyer===identity.account_id).map(order=>this.store.startJob('order-'+order.purchase_id,session.id,{order}));
  let group=await identity.client.purchaseGroup(input.id);if(v4FundingGroupHash(this.config,input)!==group.hash)throw new Error('PURCHASE_GROUP_HASH_MISMATCH');
  group=(await identity.client.authorizePurchaseGroup(group,net.toString())).value;
  for(const prepared of preparedOrders){const order=prepared.payload.order;
   if(!prepared.signature){prepared.signature=Buffer.from(identity.key.sign(Buffer.from(orderHash(this.config,order),'hex')).signature).toString('base64');prepared.state='COMPLETE';this.store.saveJob(prepared);}
  }
  this.store.event(session.id,'purchase-group-authorized',input.id,{account_id:identity.account_id,net:own.net});return{group};
 }
 async purchase(session,service,input,parent,privacy='public'){
  const identity=await this.getIdentity(session.id),provider=session.participants.find(p=>p.kind===SERVICES[service]?.kind);
  if(!provider)throw new Error('PROVIDER_UNAVAILABLE');
  const wallet=await identity.client.balance(),price=SERVICES[service].price,id=purchaseId(parent,service);
  const body={service,input,purchase_id:id,buyer:identity.account_id,seller:provider.account_id,asset:this.config.token,price,privacy};
  let job=this.store.startJob('buy-'+id,session.id,body);if(job.state==='COMPLETE')return job.result;
  if(!wallet.policy||wallet.policy.revoked||wallet.policy.expires_at_ms<=this.clock()||BigInt(price)>BigInt(wallet.policy.max_invoice))throw new Error('AGENT_PURCHASE_BUDGET_EXCEEDED');
  const prepared=this.store.job('order-'+id);
  if(!prepared||prepared.session_id!==session.id)throw new Error('BUYER_FUNDED_ORDER_REQUIRED');
  if(!job.order){
   job.order=prepared.payload.order;job.signature=prepared.signature;
   if(job.order.input_hash!==v4Digest(JSON.stringify(input))||job.order.service!==service||job.order.privacy!==privacy)throw new Error('FUNDED_ORDER_TERMS_MISMATCH');this.store.saveJob(job);
  }
  if(privacy==='private'&&!job.private_authorization){
   const order_commitment=privateOrderCommitment(this.config,job.order,job.order.reservation_salt);
   job.private_authorization=(await identity.client.authorizePrivatePurchase({purchase_id:id,terms_version:1,seller:provider.account_id,order_commitment})).value;this.store.saveJob(job);
  }
  const delivered=await this.dispatch(provider.kind,session,{order:job.order,signature:job.signature}),spec=delivered.invoice?.spec;
  if(!spec||spec.buyer!==identity.account_id||spec.seller!==provider.account_id||spec.amount!==price||spec.purchase_id!==id||spec.terms_hash!==orderHash(this.config,job.order)||spec.artifact_hash!==job.order.expected_artifact_hash||delivered.artifact_commitment!==spec.artifact_hash)throw new Error('DELIVERY_OR_INVOICE_MISMATCH');
  let invoice,envelope;
  if(privacy==='private'){
   const contribution=job.contribution??delivered.contribution;
   if(!contribution?.spec||!contribution.salt||!Array.isArray(contribution.signatures))throw new Error('PRIVATE_CONTRIBUTION_MISSING');
   const commitment=v4PrivateInvoiceCommitment(this.config,contribution.spec,contribution.salt),providerWallet=await identity.client.balance(provider.account_id);
   const sellerSignature=contribution.signatures.find(s=>s.account_id===provider.account_id);
   if(commitment!==delivered.invoice.hash||!sellerSignature||!providerWallet.policy||providerWallet.policy.revoked||sellerSignature.key_epoch!==providerWallet.policy.epoch||!verifyV4InvoiceSignature(providerWallet.policy.key,commitment,sellerSignature.signature))throw new Error('PRIVATE_SIGNATURE_INVALID');
   if(!job.contribution){
    contribution.signatures=contribution.signatures.filter(s=>s.account_id===provider.account_id);
    contribution.signatures.push({account_id:identity.account_id,key_epoch:wallet.policy.epoch,signature:Buffer.from(identity.key.sign(Buffer.from(commitment,'hex')).signature).toString('base64')});
    job.contribution=contribution;this.store.saveJob(job);
   }
   const encryption=await identity.client.privateEncryptionKey();if(!encryption)throw new Error('PRIVATE_MODE_UNAVAILABLE');
   envelope=job.envelope??encryptV4Invoice(this.config,encryption,job.contribution);job.envelope=envelope;this.store.saveJob(job);
   await this.dispatch(provider.kind,session,{accept_private:job.contribution,purchase_id:id});
   if(!this.verifyPrivate||(await this.verifyPrivate(session,{envelope,parties:[spec.buyer,spec.seller]})).verified!==true)throw new Error('PRIVATE_PROCESSING');
   invoice={...delivered.invoice,status:'ACCEPTED',private:true,charge_id:envelope.nullifier};
  }else{
   if(delivered.invoice.hash!==v4InvoiceHash(this.config,spec))throw new Error('INVOICE_HASH_MISMATCH');
   invoice=(await identity.client.acceptInvoice(delivered.invoice)).value;
  }
  job={...job,state:'COMPLETE',result:{...delivered,invoice,...(envelope?{envelope}:{}),bills:[invoice,...(delivered.bills??[])],envelopes:[...(envelope?[envelope]:[]),...(delivered.envelopes??[])]}};
  this.store.saveJob(job);
  this.store.event(session.id,'purchase-accepted',invoice.spec.id,privacy==='private'?{private:true,service}:{buyer:spec.buyer,seller:spec.seller,amount:spec.amount,service});
  return job.result;
 }
 async handle(session,request){
  if(request.authorize_group)return this.authorizeGroup(session,request.authorize_group);
  if(request.release_purchase)return this.releasePurchase(session,request.release_purchase);
  if(request.accept_private)return this.acceptPrivate(session,request);
  const id=request.order?.purchase_id;if(typeof id!=='string'||!/^[a-f\d]{32}$/.test(id))throw new Error('INVALID_PURCHASE_ID');
  const key=session.id+':'+id,fingerprint=v4Digest(JSON.stringify(request)),existing=this.inflight.get(key);
  if(existing){if(existing.fingerprint!==fingerprint)throw new Error('REQUEST_ID_CONFLICT');return existing.task;}
  const task=this.executePurchase(session,request).finally(()=>this.inflight.delete(key));this.inflight.set(key,{fingerprint,task});return task;
 }
 async executePurchase(session,{order,signature}){
  const identity=await this.getIdentity(session.id),definition=SERVICES[order.service];
  if(!definition||definition.kind!==this.kind||order.seller!==identity.account_id||order.asset!==this.config.token||order.price!==definition.price||order.input_hash!==v4Digest(JSON.stringify(order.input))||!['public','private'].includes(order.privacy??'public'))throw new Error('INVALID_SERVICE_ORDER');
  if(!session.participants.some(p=>p.account_id===order.buyer))throw new Error('SESSION_PARTICIPANT_REQUIRED');
  if(!order.funding_group_id||order.expected_artifact_hash!==v4Digest(JSON.stringify(expectedArtifact(order.service,order.input))))throw new Error('BUYER_FUNDED_ORDER_REQUIRED');
  const group=await identity.client.purchaseGroup(order.funding_group_id);
  if(!['FUNDED','READY','SETTLED'].includes(group.status)||group.status==='FUNDED'&&group.input.deadline_ms<=this.clock())throw new Error('PURCHASE_GROUP_NOT_DELIVERABLE');
  const funded=await identity.client.purchaseOrder(v4ChargeId(this.config,{...order,terms_version:1}));
  const commitment=order.privacy==='private'?privateOrderCommitment(this.config,order,order.reservation_salt):orderHash(this.config,order);
  if(!funded||funded.group_id!==group.input.id||funded.status!=='AUTHORIZED'||funded.order.seller!==identity.account_id||funded.order.order_commitment!==commitment||group.input.private!==(order.privacy==='private')||order.deadline_ms!==group.input.deadline_ms)throw new Error('FUNDED_ORDER_TERMS_MISMATCH');
  if(!group.input.private&&(funded.order.public_terms?.amount!==order.price||funded.order.public_terms.service!==order.service||funded.order.public_terms.terms_hash!==orderHash(this.config,order)||funded.order.public_terms.artifact_hash!==order.expected_artifact_hash))throw new Error('FUNDED_ORDER_TERMS_MISMATCH');
  const buyer=await identity.client.balance(order.buyer),p=buyer.policy;
  if(!p||p.revoked||!verifyV4InvoiceSignature(p.key,orderHash(this.config,order),signature))throw new Error('INVALID_ORDER_SIGNATURE');
  if(BigInt(order.price)>BigInt(p.max_invoice)||p.counterparties.length&&!p.counterparties.includes(identity.account_id)||p.services.length&&!p.services.includes(order.service))throw new Error('ORDER_OUTSIDE_PERMISSION');
  if(order.privacy==='private'){
   if(!/^[a-f\d]{64}$/.test(order.reservation_salt??''))throw new Error('PRIVATE_ORDER_NOT_AUTHORIZED');
   const authorization=await identity.client.privatePurchase(v4ChargeId(this.config,{buyer:order.buyer,purchase_id:order.purchase_id,terms_version:1}));
   if(!authorization||authorization.buyer!==order.buyer||authorization.seller!==identity.account_id||authorization.policy_epoch!==p.epoch||authorization.order_commitment!==privateOrderCommitment(this.config,order,order.reservation_salt))throw new Error('PRIVATE_ORDER_NOT_AUTHORIZED');
  }
  let job=this.store.startJob('sell-'+order.purchase_id,session.id,{order,signature});
  if(job.state==='COMPLETE')return order.privacy==='private'?{...job.result,contribution:job.contribution}:job.result;
  if(job.state==='STARTED'&&(order.deadline_ms<=this.clock()||p.expires_at_ms<=this.clock()))throw new Error('ORDER_EXPIRED');
  if(!job.artifact){
   let artifact;
   if(order.service==='references')artifact=referencePacket(order.input.brief,order.input.data);
   else if(order.service==='audit'){
    const reference=await this.purchase(session,'references',{brief:order.input.brief,data:order.input.data},order.purchase_id,order.privacy);
    artifact=auditPacket(order.input.data,expectedArtifact('references',order.input).references);job.dependencies=reference.bills;job.envelopes=reference.envelopes;
   }else{
    let audit;if(order.input.verified){const result=await this.purchase(session,'audit',{brief:order.input.brief,data:order.input.data},order.purchase_id,order.privacy);audit=expectedArtifact('audit',order.input);job.dependencies=result.bills;job.envelopes=result.envelopes;}
    artifact=chartArtifact(order.input.brief,order.input.data,audit);
   }
   if(!validateArtifact(order.service,artifact)||v4Digest(JSON.stringify(artifact))!==order.expected_artifact_hash)throw new Error('PROVIDER_OUTPUT_REFUSED');
   job={...job,state:'DELIVERED',artifact,delivered_at_ms:this.clock()};this.store.saveJob(job);this.store.event(session.id,'artifact-delivered',job.id,{service:order.service,private:order.privacy==='private'});
  }
  if(!job.spec){
   job.spec={id:v4FundedInvoiceId(this.config,{...order,terms_version:1}),purchase_id:order.purchase_id,terms_version:1,buyer:order.buyer,seller:order.seller,asset:order.asset,amount:order.price,service:order.service,terms_hash:orderHash(this.config,order),artifact_hash:v4Digest(JSON.stringify(job.artifact)),ready_at_ms:job.delivered_at_ms,expires_at_ms:order.deadline_ms};
   this.store.saveJob(job);
  }
  if(order.privacy==='private'){
   if(!this.config.private?.enabled)throw new Error('PRIVATE_MODE_UNAVAILABLE');
   if(!job.contribution){
    const salt=randomBytes(32).toString('hex'),hash=v4PrivateInvoiceCommitment(this.config,job.spec,salt),own=await identity.client.balance();
    job.contribution={spec:job.spec,salt,signatures:[{account_id:identity.account_id,key_epoch:own.policy.epoch,signature:Buffer.from(identity.key.sign(Buffer.from(hash,'hex')).signature).toString('base64')}]};this.store.saveJob(job);
   }
   return{artifact_commitment:job.spec.artifact_hash,invoice:{spec:job.spec,hash:v4PrivateInvoiceCommitment(this.config,job.spec,job.contribution.salt),status:'PROPOSED',private:true},contribution:job.contribution,bills:job.dependencies??[],envelopes:job.envelopes??[]};
  }
  let invoice=(await identity.client.proposeInvoice(job.spec)).value;invoice=(await identity.client.acceptInvoice(invoice)).value;
  job={...job,state:'COMPLETE',result:{artifact_commitment:job.spec.artifact_hash,invoice,bills:job.dependencies??[],envelopes:job.envelopes??[]}};this.store.saveJob(job);return job.result;
 }
 async acceptPrivate(session,{accept_private:contribution,purchase_id}){
  const job=this.store.job('sell-'+purchase_id);
  if(!job?.contribution||job.session_id!==session.id||job.payload.order.privacy!=='private')throw new Error('PRIVATE_PURCHASE_NOT_FOUND');
  const hash=v4PrivateInvoiceCommitment(this.config,job.spec,job.contribution.salt);
  if(v4PrivateInvoiceCommitment(this.config,contribution.spec,contribution.salt)!==hash||contribution.signatures.length!==2)throw new Error('PRIVATE_INVOICE_MISMATCH');
  const identity=await this.getIdentity(session.id),signers=new Set();
  for(const s of contribution.signatures){
   const b=await identity.client.balance(s.account_id);
   if(![job.spec.buyer,job.spec.seller].includes(s.account_id)||signers.has(s.account_id)||!b.policy||b.policy.revoked||s.key_epoch!==b.policy.epoch||!verifyV4InvoiceSignature(b.policy.key,hash,s.signature))throw new Error('PRIVATE_SIGNATURE_INVALID');signers.add(s.account_id);
  }
  const encryption=await identity.client.privateEncryptionKey();if(!encryption)throw new Error('PRIVATE_MODE_UNAVAILABLE');
  job.contribution=contribution;job.envelope=job.envelope??encryptV4Invoice(this.config,encryption,contribution);job.state='COMPLETE';
  job.result={artifact_commitment:job.spec.artifact_hash,invoice:{spec:job.spec,hash,charge_id:job.envelope.nullifier,status:'ACCEPTED',private:true},envelope:job.envelope,bills:job.dependencies??[],envelopes:job.envelopes??[]};this.store.saveJob(job);return{accepted:true};
 }
 async releasePurchase(session,{purchase_id}){
  const job=this.store.job('sell-'+purchase_id);if(!job?.artifact||job.session_id!==session.id||!job.payload.order.funding_group_id||job.state!=='COMPLETE')throw new Error('PURCHASE_NOT_FOUND');
  const identity=await this.getIdentity(session.id),group=await identity.client.purchaseGroup(job.payload.order.funding_group_id);
  if(!['READY','SETTLED'].includes(group.status)||!group.round_id)throw new Error('PAYMENT_COMMITMENT_REQUIRED');
  const round=await identity.client.round(group.round_id);
  if(!['READY','SETTLED'].includes(round.status))throw new Error('PAYMENT_COMMITMENT_REQUIRED');
  const invoiceId=group.input.private?v4ChargeId(this.config,job.spec):job.spec.id,commitment=group.input.private?v4PrivateInvoiceCommitment(this.config,job.spec,job.contribution.salt):v4InvoiceHash(this.config,job.spec);
  if(round.input.invoice_hashes[round.input.invoice_ids.indexOf(invoiceId)]!==commitment)throw new Error('PAYMENT_COMMITMENT_REQUIRED');
  return{artifact:job.artifact,round_id:round.input.id};
 }
 async runBrief(session,request){
  const key='brief:'+session.id+':'+request.request_id;
  const fingerprint=v4Digest(JSON.stringify(request)),existing=this.inflight.get(key);
  if(existing){if(existing.fingerprint!==fingerprint)throw new Error('REQUEST_ID_CONFLICT');return existing.task;}
  const task=this.executeBrief(session,request).finally(()=>this.inflight.delete(key));this.inflight.set(key,{fingerprint,task});return task;
 }
 async executeBrief(session,request){
  let {request_id,brief,mode='report',privacy='public',budget='300000',data=EXAMPLE_DATA}=request;
  if(this.kind!=='research')throw new Error('RESEARCH_DESK_REQUIRED');
  if(privacy==='private'){
   if(!this.config.private?.enabled||!this.ingressSecret)throw new Error('PRIVATE_MODE_UNAVAILABLE');
   ({brief,data}=openBrief(this.config,session,request,this.ingressSecret));
  }
  if(!['public','private'].includes(privacy)||typeof brief!=='string'||brief.trim().length<8||brief.length>800||!['report','chart','auto'].includes(mode)||!/^[a-f\d-]{16,40}$/.test(request_id)||!auditPacket(data,SOURCE_CORPUS).valid)throw new Error('INVALID_BRIEF');
  if(!/^(0|[1-9]\d*)$/.test(budget)||BigInt(budget)>500000n)throw new Error('INVALID_BRIEF_BUDGET');
  if(BigInt(budget)<(mode==='report'?280000n:100000n))throw new Error('BRIEF_BUDGET_TOO_LOW');
  let job=this.store.startJob('brief-'+request_id,session.id,{request_id,brief,mode,privacy,budget,data});
  if(job.state==='COMPLETE')return privacy==='private'?job.response:job.result;
  if(!job.plan){job.plan=await this.planner({brief,mode,budget,privacy,data},SOURCE_CORPUS,{reserveAttempt:()=>this.store.consumePlannerAttempt(job.id)});this.store.saveJob(job);this.store.event(session.id,'procurement-planned',job.id,{kind:job.plan.kind,model:job.plan.model??null,private:privacy==='private'});}
  let group=await this.prepareFundingGroup(session,{request_id,privacy},job.plan,brief,data);
  const packet=referencePacket(brief,data),chart=await this.purchase(session,'chart',{brief:job.plan.title??brief,data,verified:job.plan.needs_audit},request_id,privacy);
  packet.references=packet.references.filter((_,index)=>job.plan.source_indices.includes(index));
  if(privacy==='private'&&group.status==='FUNDED'){
   if(!this.preparePrivateGroup)throw new Error('PRIVATE_MODE_UNAVAILABLE');
   const prepared=await this.preparePrivateGroup(session,{group_id:group.input.id,envelopes:chart.envelopes});
   if(prepared.ready!==true)throw new Error('PRIVATE_PROCESSING');
  }
  group=await(await this.getIdentity(session.id)).client.purchaseGroup(group.input.id);
  if(!['READY','SETTLED'].includes(group.status))throw new Error('PAYMENT_COMMITMENT_REQUIRED');
  const actual=await this.dispatch('visual',session,{release_purchase:{purchase_id:chart.invoice.spec.purchase_id}});
  if(!validateArtifact('chart',actual.artifact)||v4Digest(JSON.stringify(actual.artifact))!==chart.invoice.spec.artifact_hash)throw new Error('DELIVERY_OR_INVOICE_MISMATCH');
  const result={brief,mode,references:packet,chart:actual.artifact,initial_invoice_id:chart.invoice.spec.id,bills:chart.bills,funding_group_id:group.input.id,round_id:group.round_id,provider_names:['Research Desk','Visual Studio',...(job.plan.needs_audit?['Audit Desk']:[])],planner:job.plan};
  job={...job,state:'COMPLETE',result};if(privacy==='private')job.response=sealResult(this.config,session,request,result,this.ingressSecret);
  this.store.saveJob(job);return privacy==='private'?job.response:result;
 }
 async privateSummary(session){
  const identity=await this.getIdentity(session.id),entries=new Map();
  for(const j of this.store.jobs(session.id)){
   const i=j.result?.invoice;if(j.state!=='COMPLETE'||!i?.private||!j.envelope)continue;
   const nullifier=v4ChargeId(this.config,i.spec),registered=await identity.client.privateInvoice(nullifier);
   entries.set(nullifier,{nullifier,commitment:i.hash,parties:[i.spec.buyer,i.spec.seller],status:registered?.status??'SIGNED',round_id:registered?.round_id??null,funding_group_id:j.payload.order?.funding_group_id??j.order?.funding_group_id??null,envelope:j.envelope,ready_at_ms:i.spec.ready_at_ms});
  }return{invoices:[...entries.values()]};
 }
 async propose(session,{id,invoice_ids,deadline_ms}){
  const identity=await this.getIdentity(session.id);
  for(const invoiceId of invoice_ids){const i=await identity.client.invoice(invoiceId);if(!session.participants.some(p=>p.account_id===i.spec.buyer)||!session.participants.some(p=>p.account_id===i.spec.seller))throw new Error('SESSION_INVOICE_REQUIRED');}
  return identity.client.proposeRound(id,invoice_ids,deadline_ms);
 }
 privatePosition(session,identity,ids,hashes){
  const own=new Map();for(const j of this.store.jobs(session.id)){const i=j.result?.invoice;if(j.state==='COMPLETE'&&i?.private&&[i.spec.buyer,i.spec.seller].includes(identity.account_id))own.set(v4ChargeId(this.config,i.spec),i);}
  let net=0n,count=0;
  for(const[id,index]of ids.map((id,index)=>[id,index])){const i=own.get(id);if(!i)continue;if(hashes[index]!==i.hash)throw new Error('PRIVATE_INVOICE_INCLUSION_MISMATCH');if(!session.participants.some(p=>p.account_id===i.spec.buyer)||!session.participants.some(p=>p.account_id===i.spec.seller))throw new Error('SESSION_INVOICE_REQUIRED');net+=i.spec.seller===identity.account_id?BigInt(i.spec.amount):-BigInt(i.spec.amount);count++;}
  if(!count)throw new Error('PRIVATE_OWN_INVOICES_MISSING');return{net:net.toString()};
 }
 async disclosePrivate(session,request){
  const identity=await this.getIdentity(session.id);
  if(!this.config.private?.enabled||request.verification_only||request.profile!==this.config.private.profile||!Array.isArray(request.members)||!request.members.includes(identity.account_id)||request.members.some(id=>!session.participants.some(p=>p.account_id===id)))throw new Error('PRIVATE_DISCLOSURE_PARTY');
  if(!Number.isSafeInteger(request.deadline_ms)||request.deadline_ms<=this.clock()||request.deadline_ms>this.clock()+300000)throw new Error('PRIVATE_DEADLINE');
  const encryption=await identity.client.privateEncryptionKey();if(!encryption||encryption.worker_hash!==this.config.private.hash)throw new Error('PRIVATE_KEY_BINDING_MISMATCH');
  const input=v4PrivateInputCommitment(this.config,request.id,request.deadline_ms,encryption.worker_hash,request.encrypted_invoices);
  const expected=this.privatePosition(session,identity,request.encrypted_invoices.map(e=>e.nullifier),request.encrypted_invoices.map(e=>e.commitment));
  const wallet=await identity.client.balance(),policy=wallet.policy;
  if(!policy||policy.revoked||policy.expires_at_ms<=request.deadline_ms)throw new Error('AGENT_AUTHORITY_EXPIRED_OR_REVOKED');
  const debit=BigInt(expected.net)<0n?-BigInt(expected.net):0n;
  if(debit>BigInt(policy.max_net_commitment))throw new Error('NET_COMMITMENT_LIMIT_EXCEEDED');
  let committed=0n;
  if(request.funding_group_id){const group=await identity.client.purchaseGroup(request.funding_group_id);const own=group.input.positions.find(p=>p.account_id===identity.account_id);if(group.status!=='FUNDED'||!own||own.net!==expected.net)throw new Error('PURCHASE_GROUP_NET_MISMATCH');committed=BigInt(group.approvals.find(a=>a.account_id===identity.account_id)?.required??'0');}
  if(debit>BigInt(wallet.available)+committed)throw new Error('INSUFFICIENT_AVAILABLE_BALANCE');
  const disclosure=v4PrivateDisclosureHash(this.config,input,request.members);
  return{account_id:identity.account_id,key_epoch:policy.epoch,signature:Buffer.from(identity.key.sign(Buffer.from(disclosure,'hex')).signature).toString('base64')};
 }
 async approve(session,round){
  const identity=await this.getIdentity(session.id);let expected;
  if(round.input.private){
   expected=this.privatePosition(session,identity,round.input.invoice_ids,round.input.invoice_hashes);
  }else{
   const invoices=await Promise.all(round.input.invoice_ids.map(id=>identity.client.invoice(id)));
   if(invoices.some(i=>!session.participants.some(p=>p.account_id===i.spec.buyer)||!session.participants.some(p=>p.account_id===i.spec.seller)))throw new Error('SESSION_INVOICE_REQUIRED');
   expected=v4NetPlan(invoices.map(i=>i.spec)).positions.find(p=>p.account_id===identity.account_id);
  }
  if(!expected)throw new Error('ROUND_PARTICIPANT_REQUIRED');
  const result=await identity.client.authorizeRound(round,expected.net);
  this.store.event(session.id,'round-authorized',round.input.id,{account_id:identity.account_id,net:expected.net,tx_hash:result.tx_hash,evidence:result.evidence});return result;
 }
 async encryptionKey(session){
  if(!this.ingressSecret)throw new Error('PRIVATE_MODE_UNAVAILABLE');const identity=await this.getIdentity(session.id),public_key=briefPublicKey(this.ingressSecret);
  const binding=v4Digest(canonicalV4('service-encryption-key',this.config.network,this.config.vault,[session.id,identity.account_id,public_key]));
  return{public_key,account_id:identity.account_id,session_id:session.id,algorithm:'X25519-HKDF-SHA256-AES-256-GCM',signature:Buffer.from(identity.key.sign(Buffer.from(binding,'hex')).signature).toString('base64')};
 }
}
