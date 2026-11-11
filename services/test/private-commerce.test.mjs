import test from 'node:test';
import assert from 'node:assert/strict';
import {generateKeyPairSync,createPublicKey,diffieHellman,hkdfSync,createCipheriv,createDecipheriv,randomBytes}from 'node:crypto';
import {canonicalV4,V4BroadcastUnknown}from '../../packages/client/dist/v4.js';
import {setup}from './commerce.test.mjs';

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
  const before=await h.coordinator.snapshot(h.session);assert.ok(before.private_invoices.every(i=>i.status==='ACCEPTED'));
  const round=await h.coordinator.clear(h.session,{request_id:'d'.repeat(32),privacy:'private',selected_accounts:h.session.participants.map(p=>p.account_id),invoice_ids:before.private_invoices.map(i=>i.nullifier)});
  assert.equal(round.round.status,'SETTLED');assert.equal(round.round.net_settlement_volume,'20000');
 }finally{h.cleanup();}
});

test('private deliveries become durable accepted receipts before clearing, survive key rotation, and remain encrypted',async()=>{
 const h=await setup({privateMode:true});try{
  const id='88888888888888888888888888888888',secret='Confidential workload account 92713',labels=[{label:'Private customer cohort 92713',value:91},{label:'Private research requests 64281',value:64}];
  const key=await h.actors.get('research').encryptionKey(h.session),sealed=encryptedBrief(h.config,h.session,id,key.public_key,secret,labels);
  const request={request_id:id,mode:'report',budget:'300000',privacy:'private',sealed_brief:sealed.sealed_brief};
  const response=await h.coordinator.run(h.session,request);assert.equal(response.kind,'encrypted-result');
  const delivered=sealed.open(response);assert.equal(delivered.chart.audit.valid,true);assert.equal(delivered.bills.length,3);
  const before=await h.coordinator.snapshot(h.session);assert.equal(before.invoices.length,0);assert.equal(before.private_invoices.length,3);assert.ok(before.private_invoices.every(i=>i.status==='ACCEPTED'));
  assert.equal(before.rounds.length,0,'receipt verification must not create a funded or lingering clearing proposal');
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
