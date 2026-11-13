import test from 'node:test';
import assert from 'node:assert/strict';
import {generateKeyPairSync,createPublicKey,diffieHellman,hkdfSync,createCipheriv,createDecipheriv,randomBytes}from 'node:crypto';
import {canonicalV4,V4BroadcastUnknown,v4PrivateInvoiceCommitment,encryptV4Invoice,v4PrivateInputCommitment}from '../../packages/client/dist/v4.js';
import {setup}from './fixtures/commerce.mjs';
import {privateNegativeFixture}from '../../scripts/v4/private-negative-fixture.mjs';

function encryptedBrief(config,session,id,publicHex,brief,data){
 const pair=generateKeyPairSync('x25519'),peer=createPublicKey({key:Buffer.concat([Buffer.from('302a300506032b656e032100','hex'),Buffer.from(publicHex,'hex')]),format:'der',type:'spki'});
 const aes=Buffer.from(hkdfSync('sha256',diffieHellman({privateKey:pair.privateKey,publicKey:peer}),Buffer.alloc(0),Buffer.from('ach-private-brief-v4'),32)),nonce=randomBytes(12),cipher=createCipheriv('aes-256-gcm',aes,nonce);
 cipher.setAAD(canonicalV4('private-brief',config.network,config.vault,[session.id,id]));
 const ciphertext=Buffer.concat([cipher.update(JSON.stringify({brief,data})),cipher.final(),cipher.getAuthTag()]);
 return{sealed_brief:{ephemeral_public_key:pair.publicKey.export({type:'spki',format:'der'}).subarray(-32).toString('hex'),nonce:nonce.toString('hex'),ciphertext:ciphertext.toString('base64')},open(response){
  const encoded=Buffer.from(response.ciphertext,'base64'),decipher=createDecipheriv('aes-256-gcm',aes,Buffer.from(response.nonce,'hex'));
  decipher.setAAD(canonicalV4('private-result',config.network,config.vault,[session.id,id]));decipher.setAuthTag(encoded.subarray(-16));
  return JSON.parse(Buffer.concat([decipher.update(encoded.subarray(0,-16)),decipher.final()]).toString());
 }};
}

test('late private receipt responses resume all three purchases without losing proof or rebilling',async()=>{
 const h=await setup({privateMode:true});try{
  const id='a'.repeat(32),key=await h.actors.get('research').encryptionKey(h.session);
  const sealed=encryptedBrief(h.config,h.session,id,key.public_key,'Create an audited private workload chart',[{label:'Requests',value:42}]);
  const request={request_id:id,mode:'report',budget:'300000',privacy:'private',sealed_brief:sealed.sealed_brief};
  const verify=h.coordinator.verifyPrivateReceipt.bind(h.coordinator),delayed=new Set();
  h.coordinator.verifyPrivateReceipt=async(session,receipt)=>{
   const result=await verify(session,receipt);
   if(!delayed.has(receipt.envelope.nullifier)){delayed.add(receipt.envelope.nullifier);throw new Error('PRIVATE_PROCESSING');}
   return result;
  };
  for(let attempt=0;attempt<3;attempt++){
   await assert.rejects(h.coordinator.run(h.session,request),/PRIVATE_PROCESSING/);
   assert.equal(h.store.job('run-'+id).state,'WAITING','verified work must remain resumable while the remaining receipts finish');
   if(attempt===0)h.config.private.batch_funded_invoices=true;
  }
  const response=await h.coordinator.run(h.session,request),result=sealed.open(response);
  assert.equal(result.bills.length,3);assert.equal(result.chart.audit.valid,true);
  assert.equal(h.workerRuns.filter(r=>r.input.operation==='verify').length,3,'a late response must not submit another worker charge');
  for(const member of h.session.participants)assert.equal((await h.identities.get(member.kind).client.balance()).gross_purchase_budget_used,'100000');
  const before=await h.coordinator.snapshot(h.session);assert.equal(before.private_invoices.length,3);
  const round=await h.coordinator.clear(h.session,{request_id:'b'.repeat(32),privacy:'private',selected_accounts:h.session.participants.map(p=>p.account_id),invoice_ids:before.private_invoices.map(i=>i.nullifier)});
  assert.equal(round.round.status,'SETTLED');assert.equal(round.round.net_settlement_volume,'20000');
 }finally{h.cleanup();}
});

test('one funded-group worker run verifies all signed private bills and releases nothing before its chain proof',async()=>{
 const h=await setup({privateMode:true,batchPrivate:true});try{
  const id='1'.repeat(32),key=await h.actors.get('research').encryptionKey(h.session);
  const sealed=encryptedBrief(h.config,h.session,id,key.public_key,'Private group 92713',[{label:'Confidential requests',value:42}]);
  const request={request_id:id,mode:'report',budget:'300000',privacy:'private',sealed_brief:sealed.sealed_brief};
  const prepare=h.coordinator.preparePrivateGroup.bind(h.coordinator);
  h.coordinator.preparePrivateGroup=async()=>({ready:false,state:'WAITING'});
  await assert.rejects(h.coordinator.run(h.session,request),/PRIVATE_PROCESSING/);
  const pending=await h.coordinator.snapshot(h.session);
  assert.equal(pending.private_invoices.length,3);
  assert.ok(pending.private_invoices.every(i=>i.status==='SIGNED'&&i.verification_mode==='funded-group'));
  assert.equal(pending.funding_groups[0].status,'FUNDED');
  assert.equal(pending.jobs[0].result,null);
  assert.equal(h.workerRuns.filter(r=>['verify','net'].includes(r.input.operation)).length,0);
  const staged=h.actorStores.get('visual').jobs(h.session.id).find(j=>j.id.startsWith('sell-')&&j.payload.order.service==='chart');
  await assert.rejects(h.actors.get('visual').releasePurchase(h.session,{purchase_id:staged.spec.purchase_id}),/PAYMENT_COMMITMENT_REQUIRED/);
  await h.coordinator.tick();await Promise.allSettled([...h.coordinator.running.values()]);
  assert.equal(h.workerRuns.filter(r=>['verify','net'].includes(r.input.operation)).length,0,'reconciliation must preserve the complete-group verification choice');
  h.coordinator.preparePrivateGroup=prepare;
  const restarted=h.restart(),result=sealed.open(await restarted.run(h.session,request));
  assert.equal(result.bills.length,3);assert.ok(result.bills.every(i=>i.status==='READY'));
  assert.equal(result.chart.audit.valid,true);
  assert.equal(h.workerRuns.filter(r=>r.input.operation==='verify').length,0);
  const net=h.workerRuns.filter(r=>r.input.operation==='net');assert.equal(net.length,1);
  assert.equal(net[0].input.encrypted_invoices.length,3);assert.equal(net[0].input.disclosure_signatures.length,3);
  assert.ok(!JSON.stringify(net[0]).includes('92713'));
  const before=await restarted.snapshot(h.session),settled=await restarted.clear(h.session,{request_id:'2'.repeat(32),privacy:'private',selected_accounts:h.session.participants.map(p=>p.account_id),invoice_ids:before.private_invoices.map(i=>i.nullifier)});
  assert.equal(settled.round.status,'SETTLED');assert.equal(settled.round.net_settlement_volume,'20000');
  assert.equal(h.workerRuns.filter(r=>r.input.operation==='net').length,1);
  for(const participant of h.session.participants)assert.equal((await h.identities.get(participant.kind).client.balance()).gross_purchase_budget_used,'100000');
 }finally{h.cleanup();}
});

test('a lost full-group worker response resumes its original round after restart without another execution',async()=>{
 const h=await setup({privateMode:true,batchPrivate:true});try{
  const id='3'.repeat(32),key=await h.actors.get('research').encryptionKey(h.session);
  const sealed=encryptedBrief(h.config,h.session,id,key.public_key,'Recover the same private group',[{label:'Requests',value:42}]);
  const request={request_id:id,mode:'report',budget:'300000',privacy:'private',sealed_brief:sealed.sealed_brief};
  const owner=h.owners.get('coordinator'),send=owner.requestPrivateRound.bind(owner);let dropped=false;
  owner.requestPrivateRound=async input=>{const result=await send(input);if(!input.verification_only&&!dropped){dropped=true;throw new V4BroadcastUnknown('private:'+input.id,'confirmed-response-lost');}return result;};
  await assert.rejects(h.coordinator.run(h.session,request),V4BroadcastUnknown);
  assert.equal(h.store.job('run-'+id).state,'WAITING');
  const result=sealed.open(await h.restart().run(h.session,request));assert.equal(result.bills.length,3);
  assert.ok(result.bills.every(i=>['READY','SETTLED'].includes(i.status)));
  assert.equal(h.workerRuns.filter(r=>r.input.operation==='net').length,1);
  assert.equal(h.workerRuns.filter(r=>r.input.operation==='verify').length,0);
 }finally{h.cleanup();}
});

test('unknown private broadcasts remain pending and reconcile existing failed work without another charge',async()=>{
 const h=await setup({privateMode:true});try{
  const id='c'.repeat(32),key=await h.actors.get('research').encryptionKey(h.session);
  const sealed=encryptedBrief(h.config,h.session,id,key.public_key,'Create a private chart and verify its sources',[{label:'Requests',value:42}]);
  const request={request_id:id,mode:'report',budget:'300000',privacy:'private',sealed_brief:sealed.sealed_brief};
  const owner=h.owners.get('coordinator'),send=owner.requestPrivateRound.bind(owner);let broadcasts=0;
  owner.requestPrivateRound=async input=>{const result=await send(input);if(!input.verification_only)return result;broadcasts++;throw new V4BroadcastUnknown('private:'+input.id,'confirmed-but-response-lost');};
  for(let attempt=0;attempt<3;attempt++){
   await assert.rejects(h.coordinator.run(h.session,request),/PRIVATE_PROCESSING/);
   const job=h.store.job('run-'+id);assert.equal(job.state,'WAITING');assert.equal(job.failures,attempt===0?0:3);
   if(attempt===0){job.state='FAILED';job.error='SERVICE_UNAVAILABLE';job.failures=3;h.store.saveJob(job);}
  }
  const response=await h.coordinator.run(h.session,request),result=sealed.open(response);
  assert.equal(result.bills.length,3);assert.equal(result.chart.audit.valid,true);assert.equal(broadcasts,3);
  assert.equal(h.workerRuns.filter(r=>r.input.operation==='verify').length,3);
  assert.equal(h.store.job('run-'+id).failures,3,'historical failures remain recorded');
  for(const member of h.session.participants)assert.equal((await h.identities.get(member.kind).client.balance()).gross_purchase_budget_used,'100000');
  const before=await h.coordinator.snapshot(h.session);assert.ok(before.private_invoices.every(i=>i.status==='READY'));
  const round=await h.coordinator.clear(h.session,{request_id:'d'.repeat(32),privacy:'private',selected_accounts:h.session.participants.map(p=>p.account_id),invoice_ids:before.private_invoices.map(i=>i.nullifier)});
  assert.equal(round.round.status,'SETTLED');assert.equal(round.round.net_settlement_volume,'20000');
 }finally{h.cleanup();}
});

test('committed private work reopens its original encrypted result after a restart and timeout without another worker charge',async()=>{
 const h=await setup({privateMode:true});try{
  const id='e'.repeat(32),key=await h.actors.get('research').encryptionKey(h.session);
  const sealed=encryptedBrief(h.config,h.session,id,key.public_key,'Recover private workload 92713',[{label:'Private requests',value:42}]);
  const request={request_id:id,mode:'report',budget:'300000',privacy:'private',sealed_brief:sealed.sealed_brief};
  h.coordinator.setClearingPolicy(h.session,{mode:'manual'});
  const run=h.coordinator.agents.runBrief;let original;
  h.coordinator.agents.runBrief=async(...args)=>{original=await run(...args);throw new TypeError('fetch failed');};
  await assert.rejects(h.coordinator.run(h.session,request),/fetch failed/);
  const failed=h.store.job('run-'+id);failed.state='FAILED';failed.error='SERVICE_OR_CHAIN_UNAVAILABLE';failed.failures=3;h.store.saveJob(failed);
  const charged=h.workerRuns.length;
  h.coordinator.agents.runBrief=run;const restarted=h.restart();h.chain.now=failed.created_at_ms+restarted.jobTimeoutMs+1;
  assert.deepEqual(await restarted.run(h.session,request),original);
  assert.equal(sealed.open(original).chart.audit.valid,true);assert.equal(h.workerRuns.length,charged);
  const recovered=h.store.job(failed.id);assert.equal(recovered.state,'COMPLETE');assert.equal(recovered.payment_committed,true);assert.equal(recovered.failures,3);
  assert.equal(h.store.db.prepare('SELECT requests_reserved FROM inference_days').get().requests_reserved,2);
  const snapshot=await restarted.snapshot(h.session);
  assert.equal(snapshot.funding_groups.length,1);assert.equal(snapshot.rounds.length,1);assert.equal(snapshot.private_invoices.length,3);
  assert.equal(snapshot.jobs.find(job=>job.id===failed.id).result,null);assert.ok(!JSON.stringify(snapshot).includes('92713'));
  const cleared=await restarted.clear(h.session,{request_id:'f'.repeat(32),privacy:'private',selected_accounts:h.session.participants.map(p=>p.account_id),invoice_ids:snapshot.private_invoices.map(invoice=>invoice.nullifier)});
  assert.equal(cleared.round.status,'SETTLED');assert.equal(cleared.round.net_settlement_volume,'20000');assert.equal(h.workerRuns.length,charged);
  assert.deepEqual(await restarted.run(h.session,request),original);
 }finally{h.cleanup();}
});

test('private deliveries become durable accepted receipts before clearing, survive key rotation, and remain encrypted',async()=>{
 const h=await setup({privateMode:true});try{
  const id='88888888888888888888888888888888',secret='Confidential workload account 92713',labels=[{label:'Private customer cohort 92713',value:91},{label:'Private research requests 64281',value:64}];
  const key=await h.actors.get('research').encryptionKey(h.session),sealed=encryptedBrief(h.config,h.session,id,key.public_key,secret,labels);
  const request={request_id:id,mode:'report',budget:'300000',privacy:'private',sealed_brief:sealed.sealed_brief};
  const response=await h.coordinator.run(h.session,request);assert.equal(response.kind,'encrypted-result');
  const delivered=sealed.open(response);assert.equal(delivered.chart.audit.valid,true);assert.equal(delivered.bills.length,3);
  const before=await h.coordinator.snapshot(h.session);assert.equal(before.invoices.length,0);assert.equal(before.private_invoices.length,3);assert.ok(before.private_invoices.every(i=>i.status==='READY'));
  assert.equal(before.rounds.length,1,'useful delivery requires exactly one fully funded clearing group');assert.equal(before.rounds[0].status,'READY');
  const verifications=h.workerRuns.filter(r=>r.input.operation==='verify');assert.equal(verifications.length,3);
  for(const run of verifications){assert.equal(run.output.operation,'verify');assert.ok(run.output.positions.every(p=>p.net==='0'));assert.ok(run.input.encrypted_invoices.every(e=>Buffer.from(e.ciphertext,'base64').length===2064));assert.ok(!JSON.stringify(run).includes(secret));assert.ok(!JSON.stringify(run.output).includes('artifact_hash'));}
  for(const participant of h.session.participants)assert.equal((await h.identities.get(participant.kind).client.balance()).gross_purchase_budget_used,'100000');
  assert.equal((await h.identities.get('coordinator').client.balance()).active_proposals,0);
  const visual=h.identities.get('visual');await h.owners.get('visual').setPolicy({key:(await visual.client.balance()).policy.key,max_invoice:'100000',gross_budget:'1000000',max_net_commitment:'1000000',expires_at_ms:h.chain.now+86_400_000,counterparties:[],services:[]},'rotate-private-policy');
  const result=await h.coordinator.clear(h.session,{request_id:'99999999999999999999999999999999',privacy:'private',selected_accounts:h.session.participants.map(p=>p.account_id),invoice_ids:before.private_invoices.map(i=>i.nullifier)});
  assert.equal(h.workerRuns.filter(r=>r.input.operation==='net').length,1);assert.equal(h.workerRuns.find(r=>r.input.operation==='net').input.disclosure_signatures.length,3);
  assert.equal(result.round.status,'SETTLED');assert.equal(result.round.gross_invoice_volume,null);assert.equal(result.round.net_settlement_volume,'20000');
  assert.equal((await h.identities.get('research').client.balance()).gross_purchase_budget_used,'100000','clearing must not charge the purchase cap again');
  const restarted=h.restart();assert.deepEqual(await restarted.run(h.session,request),response);
  const after=await restarted.snapshot(h.store.session(h.session.id));assert.equal(after.private_invoices.length,3);assert.ok(after.private_invoices.every(i=>i.status==='SETTLED'));
  for(const store of [h.store,...h.actorStores.values()]){
   const raw=JSON.stringify(store.db.prepare('SELECT data FROM jobs').all());assert.ok(!raw.includes(secret));assert.ok(!raw.includes(labels[0].label));assert.ok(!raw.includes('artifact_hash'));
  }
  restarted.agents.privateSummary=async()=>{throw new Error('PROVIDER_UNAVAILABLE');};
  const offline=await restarted.snapshot(h.store.session(h.session.id));assert.equal(offline.balances.length,3);assert.equal(offline.private_data_available,false);
  await h.owners.get('audit').withdraw('private-owner-withdrawal','20000');assert.equal((await h.owners.get('audit').withdrawal('private-owner-withdrawal')).status,'COMPLETED');
 }finally{h.cleanup();}
});

test('the release tamper fixture first funds its private order and refunds its cash and allowance only at group expiry',async()=>{
 const h=await setup({privateMode:true});try{
  const buyer=h.identities.get('research'),seller=h.identities.get('visual'),coordinator=h.owners.get('coordinator'),before=await buyer.client.balance(),{input,spec,salt}=privateNegativeFixture(h.config,{seed:'d'.repeat(32),buyer:buyer.account_id,seller:seller.account_id,now:h.chain.now});
  let group=(await buyer.client.proposePurchaseGroup(input)).value;
  for(const identity of [buyer,seller])group=(await identity.client.authorizePurchaseGroup(group,input.positions.find(position=>position.account_id===identity.account_id).net)).value;
  assert.equal(group.status,'FUNDED');assert.equal((await buyer.client.balance()).reserved,'1');
  const authorization=(await buyer.client.authorizePrivatePurchase({purchase_id:spec.purchase_id,terms_version:1,seller:seller.account_id,order_commitment:input.orders[0].order_commitment,deadline_ms:input.deadline_ms})).value;
  const commitment=v4PrivateInvoiceCommitment(h.config,spec,salt),contribution={spec,salt,signatures:await Promise.all([buyer,seller].map(async identity=>({account_id:identity.account_id,key_epoch:(await identity.client.balance()).policy.epoch,signature:Buffer.from(identity.key.sign(Buffer.from(commitment,'hex')).signature).toString('base64')})))};
  const envelope=encryptV4Invoice(h.config,await coordinator.privateEncryptionKey(),contribution),bytes=Buffer.from(envelope.ciphertext,'base64');bytes[40]^=1;envelope.ciphertext=bytes.toString('base64');
  const request={id:'release-negative-fixture',profile:h.config.private.profile,members:[buyer.account_id,seller.account_id],deadline_ms:h.chain.now+300000,encrypted_invoices:[envelope],verification_only:true};request.input_commitment=v4PrivateInputCommitment(h.config,request.id,request.deadline_ms,h.config.private.hash,[envelope]);
  await coordinator.requestPrivateRound(request);assert.ok(['FAILED','INVALID_OUTPUT'].includes((await coordinator.privateRequest(request.id)).status));assert.equal(await coordinator.privateInvoice(authorization.charge_id),null);
  await h.owners.get('research').cancelPendingPrivatePurchase(authorization);await h.owners.get('visual').cancelPendingPrivatePurchase(authorization);assert.equal((await buyer.client.balance()).reserved,'1');
  h.chain.now=input.deadline_ms+1;await h.owners.get('research').expirePurchaseGroup(input.id);
  const after=await buyer.client.balance();assert.equal(after.balance,before.balance);assert.equal(after.reserved,before.reserved);assert.equal(after.gross_purchase_budget_used,before.gross_purchase_budget_used);assert.equal((await coordinator.privatePurchase(authorization.charge_id)).status,'CANCELLED');
 }finally{h.cleanup();}
});
