import test from 'node:test';import assert from 'node:assert/strict';
import {generateKeyPairSync}from 'node:crypto';
import {AchV4Client,v4NetPlan,v4PurchaseGroupId,v4FundedInvoiceId}from '../../packages/client/dist/v4.js';
import {validateArtifact,chartArtifact}from '../agents/artifacts.mjs';
import {setup,config,methods}from './fixtures/commerce.mjs';
test('independent service agents produce accepted work, clear, restart and withdraw without duplicate charges',async()=>{
 const h=await setup();try{
  const request={request_id:'11111111111111111111111111111111',brief:'Create a sourced chart about agent commerce',mode:'report',privacy:'public'};
  const result=await h.coordinator.run(h.session,request);assert.equal(result.chart.kind,'chart');assert.equal(result.chart.audit.valid,true);assert.equal(result.references.references.length,3);assert.equal(validateArtifact('chart',result.chart),true);
  const before=await h.coordinator.snapshot(h.session);assert.equal(before.invoices.length,3);assert.ok(before.invoices.every(i=>i.status==='READY'));assert.equal(new Set(before.invoices.map(i=>i.spec.seller)).size,3);assert.equal(before.balances.find(b=>b.account_id.startsWith('research.')).reserved,'20000');
  const plan=v4NetPlan(before.invoices.map(i=>i.spec));assert.equal(plan.net_settlement_volume,'20000');const clearRequest={request_id:'22222222222222222222222222222222',selected_accounts:h.session.participants.map(p=>p.account_id),invoice_ids:before.invoices.map(i=>i.spec.id)};
  const [a,b]=await Promise.all([h.coordinator.clear(h.session,clearRequest),h.coordinator.clear(h.session,clearRequest)]);assert.equal(a.round.status,'SETTLED');assert.equal(b.round.hash,a.round.hash);
  const restarted=h.restart();const again=await restarted.run(h.session,request);assert.equal(again.chart.sha256,result.chart.sha256);await restarted.clear(h.session,clearRequest);const after=await restarted.snapshot(h.session);assert.equal(after.invoices.length,3);assert.equal(after.rounds.length,1);
  assert.equal(after.balances.find(b=>b.account_id.startsWith('research.')).available,'980000');assert.equal(after.balances.find(b=>b.account_id.startsWith('audit.')).available,'20000');
  await h.owners.get('audit').withdraw('agent-owner-cashout','20000');assert.equal((await h.owners.get('audit').withdrawal('agent-owner-cashout')).status,'COMPLETED');
 }finally{h.cleanup();}
});
test('one-way work settles at maximum waiting without compression',async()=>{const h=await setup();try{await h.coordinator.run(h.session,{request_id:'33333333333333333333333333333333',brief:'Make a chart without buying an audit',mode:'chart',privacy:'public'});const before=await h.coordinator.snapshot(h.session);assert.equal(before.invoices.length,1);h.chain.now+=31_000;await h.coordinator.tick();const after=await h.coordinator.snapshot(h.store.session(h.session.id));assert.equal(after.invoices[0].status,'SETTLED');assert.equal(after.rounds[0].net_settlement_volume,'100000');assert.equal(after.rounds[0].gross_invoice_volume,'100000');}finally{h.cleanup();}});
test('lost settlement responses and missing indexes recover funded rounds without rebilling',async()=>{
 const h=await setup();try{
  const request={request_id:'7'.repeat(32),brief:'Create a chart and audit its sources',mode:'report',privacy:'public'};
  await h.coordinator.run(h.session,request);
  const before=await h.coordinator.snapshot(h.session),clear={request_id:'8'.repeat(32),selected_accounts:h.session.participants.map(p=>p.account_id),invoice_ids:before.invoices.map(i=>i.spec.id)};
  const client=h.identities.get('coordinator').client,settle=client.settleRound.bind(client);let settlements=0;
  client.settleRound=async(...args)=>{settlements++;await settle(...args);throw new Error('SERVICE_OR_CHAIN_UNAVAILABLE');};
  await assert.rejects(h.coordinator.clear(h.session,clear),/SERVICE_OR_CHAIN_UNAVAILABLE/);
  const intent=h.store.job('clear-'+clear.request_id);
  assert.equal(intent.state,'WAITING');assert.ok(h.store.session(h.session.id).round_ids.includes(intent.round_id));
  const round=await client.round(intent.round_id);assert.equal(round.status,'SETTLED');
  // Simulate the missing index left by the previous runtime, while keeping
  // its signed proposal journal and the actual funded contract round intact.
  const forget=()=>{const session=h.store.session(h.session.id);session.round_ids=[];h.store.updateSession(session);};
  forget();let restarted=h.restart();
  const funded=await restarted.snapshot(h.store.session(h.session.id));assert.equal(funded.rounds.length,1);assert.equal(funded.rounds[0].status,'SETTLED');
  assert.ok(h.store.session(h.session.id).round_ids.includes(intent.round_id));
  forget();h.chain.now+=11000;await restarted.tick();
  assert.equal(h.store.job('clear-'+clear.request_id).state,'COMPLETE');
  forget();restarted=h.restart();const settled=await restarted.snapshot(h.store.session(h.session.id));
  assert.equal(settled.rounds.length,1);assert.equal(settled.rounds[0].status,'SETTLED');assert.ok(settled.invoices.every(i=>i.status==='SETTLED'));
  assert.equal(settled.balances.find(b=>b.account_id.startsWith('research.')).available,'980000');
  assert.equal(settled.balances.find(b=>b.account_id.startsWith('audit.')).available,'20000');
  await restarted.run(h.session,request);await restarted.clear(h.session,clear);assert.equal(settlements,1);assert.equal((await restarted.snapshot(h.store.session(h.session.id))).invoices.length,3);
 }finally{h.cleanup();}
});
test('private requests fail before plaintext storage; session artifacts and operation IDs are isolated',async()=>{const h=await setup();try{assert.throws(()=>h.coordinator.authenticate('b'.repeat(64)),/SESSION_EXPIRED/);await assert.rejects(h.coordinator.run(h.session,{request_id:'44444444444444444444444444444444',brief:'secret terms',mode:'report',privacy:'private'}),/PRIVATE_MODE_UNAVAILABLE/);assert.equal(h.store.jobs(h.session.id).length,0);const request={request_id:'55555555555555555555555555555555',brief:'Make a harmless demonstration chart',mode:'chart',privacy:'public'};await h.coordinator.run(h.session,request);await assert.rejects(h.coordinator.run(h.session,{...request,brief:'Change the signed purchase'}),/REQUEST_ID_CONFLICT/);const artifact=chartArtifact('<script>alert(1)</script>',[{label:'<img src=x>',value:1}]);assert.ok(!artifact.svg.includes('<script>'));assert.equal(validateArtifact('chart',artifact),true);}finally{h.cleanup();}});
test('fourth agent retains its signing key and independently joins a funded clearing round',async()=>{const h=await setup();try{const external='external.commerce.testnet';const {publicKey}=generateKeyPairSync('ed25519');const key=publicKey.export({type:'spki',format:'der'}).subarray(-32).toString('hex');const ownerKey='e'.repeat(64);h.chain.addKey(external,key,{methods,receiver:config.vault});h.chain.addKey(external,ownerKey,{owner:true});const owner=new AchV4Client(config,h.chain.transport(external,ownerKey,{owner:true}),'owner');await h.chain.invoke(config.vault,'authorize_account_registration',{account_id:external,name:'External agent',expires_at_ms:h.chain.now+86_400_000},{account:'desk.commerce.testnet',deposit:1n});await owner.register('External agent');await owner.setPolicy({key,max_invoice:'100000',gross_budget:'100000',max_net_commitment:'100000',expires_at_ms:h.chain.now+86_400_000,counterparties:[],services:[]},'external-policy');const client=new AchV4Client(config,h.chain.transport(external,key));
 const seller=h.identities.get('research');const spec={purchase_id:'external-purchase',terms_version:1,buyer:external,seller:seller.account_id,asset:config.token,amount:'80000',service:'references',terms_hash:'a'.repeat(64),artifact_hash:'b'.repeat(64),ready_at_ms:h.chain.now,expires_at_ms:h.chain.now+100_000};spec.id=v4FundedInvoiceId(config,spec);
 await h.chain.invoke(config.token,'storage_deposit',{account_id:external});await h.chain.invoke(config.token,'mint',{account_id:external,amount:'80000'},{account:'desk.commerce.testnet',deposit:1n});await owner.deposit('external-owned-funding','80000');
 const input={id:v4PurchaseGroupId(config,external,'external-round'),private:false,deadline_ms:spec.expires_at_ms,positions:v4NetPlan([spec]).positions,orders:[{purchase_id:spec.purchase_id,terms_version:1,buyer:external,seller:seller.account_id,order_commitment:spec.terms_hash,public_terms:{amount:spec.amount,service:spec.service,terms_hash:spec.terms_hash,artifact_hash:spec.artifact_hash}}]};
 let group=(await client.proposePurchaseGroup(input)).value;group=(await client.authorizePurchaseGroup(group,'-80000')).value;await seller.client.authorizePurchaseGroup(group,'80000');
 const bill=(await seller.client.proposeInvoice(spec)).value;await seller.client.acceptInvoice(bill);const round=await client.round(input.id);assert.equal(round.status,'READY');await client.settleRound(round);assert.equal((await client.balance()).available,'0');assert.equal((await seller.client.balance()).available,'1080000');assert.equal(h.identities.has('external'),false);
 }finally{h.cleanup();}});
test('an unincluded proposal does not block balances; final receipts stop repeated chain reads',async()=>{
 const h=await setup();try{
  const id='private-unincluded-intent',job=h.coordinator.prepareClear(h.session,{request_id:'6'.repeat(32),privacy:'private',selected_accounts:h.session.participants.slice(0,2).map(p=>p.account_id),invoice_ids:['a'.repeat(64)]});
  job.round_id=id;job.state='FAILED';job.error='CHAIN_EXECUTION_FAILED';h.store.saveJob(job);h.coordinator.appendRound(h.session,id);
  const session=h.store.session(h.session.id),snapshot=await h.coordinator.snapshot(session);assert.equal(snapshot.balances.length,3);assert.equal(snapshot.rounds.length,0);assert.equal(snapshot.financial_data_available,true);
  let reads=0;const reader={round:async()=>{reads++;return{status:'SETTLED',input:{id:'immutable-round'}};}};
  await h.coordinator.readRound(reader,'immutable-round');await h.coordinator.readRound(reader,'immutable-round');assert.equal(reads,1);
  h.coordinator.invalidateSnapshot(session.id);const actual=h.identities.get('coordinator').client.transport.view;
  h.identities.get('coordinator').client.transport.view=async(contract,method,args)=>{if(method==='get_round')throw Object.assign(new Error('RPC rate limit'),{cause:429});return actual(contract,method,args);};
  await assert.rejects(h.coordinator.snapshot(session),/RPC rate limit/);
 }finally{h.cleanup();}
});
