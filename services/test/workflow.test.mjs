import test from 'node:test';
import assert from 'node:assert/strict';
import {setup}from './fixtures/commerce.mjs';
import {ServiceAgent}from '../agents/runtime.mjs';
import {isSafeSvg,chartArtifact,validateArtifact}from '../agents/artifacts.mjs';
import {clearingCandidates}from '../coordinator/selection.mjs';
import {v4PurchaseGroupId,v4NetPlan}from '../../packages/client/dist/v4.js';
import {requireCurrentWorkflow,requireFreshAccounts}from '../lib/workflow.mjs';

const brief=id=>({request_id:id.repeat(32),brief:'Create a chart with verified workload data',mode:'report',privacy:'public'});
const clearing=(h,snapshot,id)=>({request_id:id.repeat(32),selected_accounts:h.session.participants.map(p=>p.account_id),invoice_ids:snapshot.invoices.map(i=>i.spec.id)});

test('agents reject missing, duplicated and substituted orders before signing the funded group',async()=>{
 const h=await setup();try{
  await h.coordinator.run(h.session,brief('1'));
  const id=v4PurchaseGroupId(h.config,h.identities.get('research').account_id,'1'.repeat(32)),job=h.actorStores.get('research').job('fund-'+id),actor=h.actors.get('research');
  const before=await h.identities.get('research').client.balance();
  for(const orders of [job.orders.slice(1),[job.orders[0],job.orders[0],job.orders[2]],[{...job.orders[0],purchase_id:'f'.repeat(32)},...job.orders.slice(1)]])await assert.rejects(actor.authorizeGroup(h.session,{input:job.input,orders}),/SESSION_PURCHASE_GROUP_REQUIRED|PURCHASE_GROUP_ORDER_SET_MISMATCH/);
  const altered=structuredClone(job.orders);altered[0].expected_artifact_hash='e'.repeat(64);
  await assert.rejects(actor.authorizeGroup(h.session,{input:job.input,orders:altered}),/FUNDED_ORDER_TERMS_MISMATCH/);
  assert.deepEqual(await h.identities.get('research').client.balance(),before);
  const foreign={...h.session,id:'f'.repeat(32)};
  await assert.rejects(h.actors.get('visual').releasePurchase(foreign,{purchase_id:job.orders[0].purchase_id}),/PURCHASE_NOT_FOUND/);
 }finally{h.cleanup();}
});

test('inflight requests bind their full payload and stay isolated by session',async()=>{
 let release;const gate=new Promise(resolve=>release=resolve),actor=Object.create(ServiceAgent.prototype);actor.inflight=new Map();
 let executions=0;actor.executePurchase=async session=>{executions++;await gate;return{session:session.id};};
 const payload={order:{purchase_id:'a'.repeat(32)},signature:'original'},one=actor.handle({id:'one'},payload),again=actor.handle({id:'one'},payload);
 await assert.rejects(actor.handle({id:'one'},{...payload,signature:'changed'}),/REQUEST_ID_CONFLICT/);
 const other=actor.handle({id:'two'},payload);release();
 assert.deepEqual(await one,{session:'one'});assert.deepEqual(await again,{session:'one'});assert.deepEqual(await other,{session:'two'});assert.equal(executions,2);
});

test('an incomplete group withholds useful output and refunds cash and allowance at its deadline',async()=>{
 const h=await setup();try{
  const visual=h.identities.get('visual').client,accept=visual.acceptInvoice.bind(visual);visual.acceptInvoice=async invoice=>{if(invoice.spec.service==='chart')throw new Error('SERVICE_UNAVAILABLE');return accept(invoice);};
  await assert.rejects(h.coordinator.run(h.session,brief('2')),/SERVICE_UNAVAILABLE/);
  const snapshot=await h.coordinator.snapshot(h.session),group=snapshot.funding_groups[0],seller=h.actorStores.get('visual').jobs(h.session.id).find(j=>j.id.startsWith('sell-'));
  assert.equal(group.status,'FUNDED');assert.equal(snapshot.jobs[0].result,null);assert.equal(snapshot.balances.find(b=>b.account_id===h.identities.get('research').account_id).reserved,'20000');
  assert.ok(seller.artifact,'the provider completed its work internally');
  await assert.rejects(h.actors.get('visual').releasePurchase(h.session,{purchase_id:seller.spec.purchase_id}),/PURCHASE_NOT_FOUND|PAYMENT_COMMITMENT_REQUIRED/);
  h.chain.now=group.input.deadline_ms;await h.coordinator.tick();
  const expired=await h.coordinator.snapshot(h.session);assert.equal(expired.funding_groups[0].status,'EXPIRED');assert.ok(expired.invoices.every(i=>i.status==='CANCELLED'));
  for(const balance of expired.balances){assert.equal(balance.reserved,'0');assert.equal(balance.gross_purchase_budget_used,'0');}
  assert.equal(expired.balances.find(b=>b.account_id===h.identities.get('research').account_id).available,'1000000');
  await assert.rejects(h.actors.get('visual').releasePurchase(h.session,{purchase_id:seller.spec.purchase_id}),/PURCHASE_NOT_FOUND|PAYMENT_COMMITMENT_REQUIRED/);
 }finally{h.cleanup();}
});

test('lost funding and final-work responses recover the original purchase group without rebilling',async()=>{
 for(const failure of ['funding','result']){
  const h=await setup();try{
   let lost=true;
   if(failure==='funding'){const client=h.identities.get('visual').client,send=client.authorizePurchaseGroup.bind(client);client.authorizePurchaseGroup=async(...args)=>{const value=await send(...args);if(lost){lost=false;throw new Error('SERVICE_UNAVAILABLE');}return value;};}
   else{const run=h.coordinator.agents.runBrief;h.coordinator.agents.runBrief=async(...args)=>{const value=await run(...args);if(lost){lost=false;throw new Error('SERVICE_UNAVAILABLE');}return value;};}
   const request=brief('3');await assert.rejects(h.coordinator.run(h.session,request),/SERVICE_UNAVAILABLE/);
   const restarted=h.restart(),result=await restarted.run(h.session,request),snapshot=await restarted.snapshot(h.session);
   assert.equal(snapshot.rounds.length,1);assert.equal(snapshot.funding_groups.length,1);assert.equal(result.round_id,snapshot.rounds[0].input.id);assert.ok(snapshot.invoices.every(i=>i.status==='READY'));
   for(const balance of snapshot.balances)assert.equal(balance.gross_purchase_budget_used,balance.account_id===h.identities.get('audit').account_id?'80000':'100000');
   assert.equal(snapshot.balances.find(b=>b.account_id===h.identities.get('research').account_id).reserved,'20000');
   assert.equal((await restarted.run(h.session,request)).chart.sha256,result.chart.sha256);
  }finally{h.cleanup();}
 }
});

test('manual scheduling survives restart, forbids partial funded collection, and records automatic settlement once',async()=>{
 const h=await setup();try{
  await h.coordinator.run(h.session,brief('4'));let snapshot=await h.coordinator.snapshot(h.session);
  const partial={...clearing(h,snapshot,'5'),invoice_ids:[snapshot.invoices[0].spec.id]};await assert.rejects(h.coordinator.clear(h.session,partial),/FUNDED_GROUP_MUST_CLEAR_TOGETHER/);
  const restarted=h.restart();h.chain.now+=31_000;await restarted.tick();snapshot=await restarted.snapshot(h.store.session(h.session.id));assert.equal(snapshot.rounds[0].status,'READY');assert.equal(snapshot.session.clearing_policy.mode,'manual');
  restarted.setClearingPolicy(h.session,{mode:'automatic'});await restarted.tick();await restarted.tick();snapshot=await restarted.snapshot(h.store.session(h.session.id));
  assert.equal(snapshot.rounds.length,1);assert.equal(snapshot.rounds[0].status,'SETTLED');assert.equal(snapshot.rounds[0].net_settlement_volume,'20000');
  assert.equal(h.store.eventPage(h.session.id).items.filter(e=>e.kind==='round-settled').length,1);
 }finally{h.cleanup();}
});

test('timed-out UI requests finish READY payments and do not sponsor a replacement for missing rounds',async()=>{
 const h=await setup();try{
  await h.coordinator.run(h.session,brief('6'));const snapshot=await h.coordinator.snapshot(h.session),job=h.coordinator.prepareClear(h.session,clearing(h,snapshot,'7'));
  job.round_id=snapshot.rounds[0].input.id;job.created_at_ms=h.chain.now-h.coordinator.jobTimeoutMs;h.store.saveJob(job);await h.coordinator.tick();
  assert.equal(h.store.job(job.id).state,'COMPLETE');assert.equal((await h.coordinator.snapshot(h.session)).rounds.length,1);
  const missing=h.coordinator.prepareClear(h.session,{...clearing(h,snapshot,'8'),privacy:'private'});missing.round_id='pg-missing-net-0';missing.created_at_ms=h.chain.now-h.coordinator.jobTimeoutMs;missing.state='WAITING';h.store.saveJob(missing);
  const before=h.chain.transactions.length;await h.coordinator.tick();assert.equal(h.store.job(missing.id).error,'CLEARING_REQUEST_EXPIRED');assert.equal(h.chain.transactions.length,before);
 }finally{h.cleanup();}
});

test('bounded graph selection finds an unfunded intermediate cycle and skips over-limit full groups',()=>{
 const bill=(id,buyer,seller,amount='100')=>({spec:{id,purchase_id:id,terms_version:1,buyer,seller,amount}}),wallet=account_id=>({account_id,available:'0',policy:{max_net_commitment:'1000'}});
 const invoices=[bill('ab','aa','bb'),bill('ba','bb','aa'),bill('cb','cc','bb')],candidates=clearingCandidates(invoices,['aa','bb','cc'].map(wallet));
 assert.deepEqual(candidates[0].invoices.map(i=>i.spec.id).sort(),['ab','ba']);assert.equal(candidates[0].plan.net_settlement_volume,'0');
 const many=[...invoices,...Array.from({length:12},(_,n)=>bill('extra'+n,'x'+n,'y'+n))];assert.deepEqual(clearingCandidates(many,[...new Set(many.flatMap(i=>[i.spec.buyer,i.spec.seller]))].map(wallet))[0].invoices.map(i=>i.spec.id).sort(),['ab','ba']);
});

test('active clearing requests protect their invoice scope while unrelated feasible business proceeds',async()=>{
 const h=await setup();try{
  const ids=['protected-a','protected-b'],pending=h.coordinator.prepareClear(h.session,{request_id:'9'.repeat(32),invoice_ids:ids,selected_accounts:h.session.participants.map(p=>p.account_id)},{automatic:true});pending.state='WAITING';pending.retry_at_ms=h.chain.now+100000;h.store.saveJob(pending);
  const [a,b,c]=h.session.participants.map(p=>p.account_id),invoice=(id,buyer,seller)=>({status:'ACCEPTED',spec:{id,purchase_id:id,terms_version:1,buyer,seller,amount:'100',ready_at_ms:h.chain.now-31_000}}),invoices=[invoice(ids[0],a,b),invoice(ids[1],b,a),invoice('unrelated',c,a)];
  h.coordinator.snapshot=async()=>({funding_groups:[],rounds:[],private_data_available:true,private_invoices:[],invoices,balances:[a,b,c].map(account_id=>({account_id,available:'1000',policy:{revoked:false,expires_at_ms:h.chain.now+900000,max_net_commitment:'1000'}}))});
  const selected=[];h.coordinator.clear=async(session,request)=>{selected.push(request.invoice_ids);return{round:{status:'SETTLED'}};};await h.coordinator.tick();assert.deepEqual(selected,[['unrelated']]);
 }finally{h.cleanup();}
});

test('History pages include the latest events, retain stable cursors, and reject expired session tokens exactly',async()=>{
 const h=await setup();try{
  for(let n=0;n<215;n++)h.store.event(h.session.id,'deposit-requested','test-'+n,{account_id:h.session.participants[0].account_id,amount:String(n)});
  const latest=h.store.eventPage(h.session.id);assert.equal(latest.items.length,100);assert.equal(latest.items.at(-1).reference,'test-214');
  h.store.event(h.session.id,'deposit-requested','new-after-page',{});
  const older=h.store.eventPage(h.session.id,{before:latest.next_cursor}),oldest=h.store.eventPage(h.session.id,{before:older.next_cursor});
  assert.equal(new Set([...latest.items,...older.items,...oldest.items].map(e=>e.sequence)).size,215);assert.equal(oldest.items[0].reference,'test-0');assert.equal(oldest.next_cursor,null);
  assert.throws(()=>h.store.eventPage(h.session.id,{before:NaN}),/INVALID_HISTORY_CURSOR/);assert.throws(()=>h.store.authenticate(h.token,h.session.expires_at_ms),/SESSION_EXPIRED/);
  const snapshot=await h.coordinator.snapshot(h.session);assert.equal(snapshot.events.at(-1).reference,'new-after-page');assert.ok(snapshot.event_page.next_cursor);
 }finally{h.cleanup();}
});

test('SVG validation rejects active content, external resources and malformed attributes while keeping supported geometry',()=>{
 const safe=chartArtifact('A harmless workload chart',[{label:'requests',value:2}]);assert.equal(validateArtifact('chart',safe),true);
 assert.equal(isSafeSvg('<svg xmlns="http://www.w3.org/2000/svg"><line x1="0" y1="0" x2="1" y2="1" stroke="#123"/></svg>'),true);
 for(const attack of ['<svg><script>alert(1)</script></svg>','<svg onload="alert(1)"></svg>','<svg><foreignObject><div>attack</div></foreignObject></svg>','<svg><text style="fill:url(https://attacker.test)">x</text></svg>','<svg><path fill="url(https://attacker.test)"/></svg>','<svg><image href="https://attacker.test"/></svg>','<svg xmlns="https://attacker.test"></svg>','<svg><text id="one" id="two">x</text></svg>','<svg><text font-family="Arial"onload="alert(1)">x</text></svg>'])assert.equal(isSafeSvg(attack),false,attack);
});

test('deployment guards require revision 2 and a separate matching account namespace',()=>{
 assert.throws(()=>requireCurrentWorkflow({protocol_version:4}),/FRESH_WORKFLOW/);assert.throws(()=>requireFreshAccounts({workflow_revision:2,network:'testnet',root:'ach-v4-demo-650fb521.testnet',vault:'ach-vault-v4-650fb521.testnet',token:'ach-usdc-v4-650fb521.testnet'}),/FRESH_ACH/);
 const plan={workflow_revision:2,network:'testnet',root:'ach-v4r2-demo-1234abcd.testnet',vault:'ach-vault-v4r2-1234abcd.testnet',token:'ach-usdc-v4r2-1234abcd.testnet'};assert.equal(requireFreshAccounts(plan),plan);assert.throws(()=>requireFreshAccounts({...plan,token:'ach-usdc-v4r2-ffffffff.testnet'}),/FRESH_ACH/);
});
