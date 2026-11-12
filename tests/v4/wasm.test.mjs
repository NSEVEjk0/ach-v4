import test from 'node:test';
import assert from 'node:assert/strict';
import { WasmChain, artifacts } from './wasm-chain.mjs';
import { AchV4Client, v4InvoiceHash, v4RoundHash, v4ChargeId,v4FundingGroupHash,v4PurchaseGroupId,v4FundedInvoiceId,v4NetPlan } from '../../packages/client/dist/v4.js';
import {scaleFixture}from '../../scripts/v4/scale-fixture.mjs';

const vault = 'vault.ach-v4.testnet', token = 'usd.ach-v4.testnet', coordinator = 'desk.ach-v4.testnet';
const deployment = { protocol_version: 4, network: 'testnet', vault, token, decimals: 6, rpc_url: 'https://test.rpc.fastnear.com' };
const members = ['research.ach-v4.testnet', 'visual.ach-v4.testnet', 'audit.ach-v4.testnet'];
const methods = ['propose_invoice','accept_invoice','propose_purchase_group','authorize_purchase_group','expire_purchase_group','propose_round','authorize_round','cancel_round_authorization','settle_round','expire_round','release_stale_round','cancel_invoice_by_agreement'];
async function setup(memberList=members) {
  const chain = new WasmChain(); await chain.deploy(vault, artifacts.vault); await chain.deploy(token, artifacts.token);
  await chain.invoke(vault, 'init', { network:'testnet', token, owner_id:coordinator, coordinator_id:coordinator, private_worker:null });
  await chain.invoke(token, 'init', { owner_id:coordinator });
  await chain.invoke(token, 'storage_deposit', { account_id:vault });
  const clients = [], owners = [];
  for (const [index, account] of [...memberList, coordinator].entries()) {
    const key = (index+1).toString(16).repeat(64); const ownerKey = 'f'.repeat(64);
    chain.addKey(account,key,{methods,receiver:vault});chain.addKey(account,ownerKey,{owner:true});
    const owner = new AchV4Client(deployment,chain.transport(account,ownerKey,{owner:true}),'owner');
    await chain.invoke(vault,'authorize_account_registration',{account_id:account,name:account,expires_at_ms:chain.now+86_400_000},{account:coordinator,deposit:1n});
    await owner.register(account);await owner.setPolicy({key,max_invoice:'100000',gross_budget:'1000000',max_net_commitment:'1000000',expires_at_ms:chain.now+86_400_000,counterparties:[],services:[]},`policy:${account}`);
    clients.push(new AchV4Client(deployment,chain.transport(account,key)));owners.push(owner);
    await chain.invoke(token,'storage_deposit',{account_id:account});
  }
  return {chain,clients,owners};
}
test('actual Wasm exports and TypeScript agree on all hashes; token callbacks settle a real service-price cycle', async () => {
  const {chain,clients,owners}=await setup();
  await chain.invoke(token,'mint',{account_id:members[0],amount:'20000'},{account:coordinator,deposit:1n});
  const deposit=await owners[0].deposit('minimal','20000');assert.equal(deposit.value,'20000');
  const bills=[],specs=[[0,1,'100000'],[1,2,'100000'],[2,0,'80000']].map(([buyer,seller,amount],index)=>{const spec={purchase_id:`purchase-${index}`,terms_version:1,buyer:members[buyer],seller:members[seller],asset:token,amount,service:'research',terms_hash:'a'.repeat(64),artifact_hash:'b'.repeat(64),ready_at_ms:chain.now,expires_at_ms:chain.now+100_000};return{...spec,id:v4FundedInvoiceId(deployment,spec)};});
  const input={id:v4PurchaseGroupId(deployment,members[0],'actual-wasm'),private:false,deadline_ms:chain.now+100_000,positions:v4NetPlan(specs).positions,orders:specs.map(s=>({purchase_id:s.purchase_id,terms_version:1,buyer:s.buyer,seller:s.seller,order_commitment:s.terms_hash,public_terms:{amount:s.amount,service:s.service,terms_hash:s.terms_hash,artifact_hash:s.artifact_hash}}))};
  let group=(await clients[0].proposePurchaseGroup(input)).value;assert.equal(group.hash,v4FundingGroupHash(deployment,input));
  for(let i=0;i<3;i++)group=(await clients[i].authorizePurchaseGroup(group,input.positions.find(p=>p.account_id===members[i]).net)).value;
  assert.equal(group.status,'FUNDED');assert.equal((await clients[0].balance()).reserved,'20000');
  for(const spec of specs){const buyer=members.indexOf(spec.buyer),seller=members.indexOf(spec.seller);
    let invoice=(await clients[seller].proposeInvoice(spec)).value;
    assert.equal(invoice.hash,v4InvoiceHash(deployment,spec));assert.equal(invoice.charge_id,v4ChargeId(deployment,spec));
    await clients[buyer].acceptInvoice(invoice);await clients[seller].acceptInvoice(invoice);bills.push(invoice);
  }
  let round=await clients[0].round(input.id);
  assert.equal(round.hash,v4RoundHash(deployment,round.input));
  assert.equal(round.status,'READY');await assert.rejects(clients[0].cancelRound(round),/IRREVOCABLE/);
  await clients[2].settleRound(round);await clients[0].settleRound(round);
  assert.equal((await clients[0].balance()).balance,'0');assert.equal((await clients[1].balance()).balance,'0');assert.equal((await clients[2].balance()).balance,'20000');
  const backing=await chain.invoke(vault,'get_backing_status',{});const custody=await chain.invoke(token,'ft_balance_of',{account_id:vault});assert.equal(backing.value.tracked_token_custody,custody.value);
  await owners[2].withdraw('take-receipt','20000');assert.equal((await owners[2].withdrawal('take-receipt')).status,'COMPLETED');assert.equal((await owners[2].balance()).balance,'0');
  assert.equal((await chain.invoke(token,'ft_balance_of',{account_id:members[2]})).value,'20000');
});
test('authenticated token transfer failure refunds; forged credit and trading-key administration fail',async()=>{
 const {chain,clients,owners}=await setup();
 await assert.rejects(chain.invoke(vault,'ft_on_transfer',{sender_id:members[0],amount:'100',msg:'deposit'},{account:members[0]}),/TOKEN_CALLBACK_ONLY/);
 await assert.rejects(clients[0].withdraw('bad-owner','1'),/OWNER_SIGNER_REQUIRED/);
 await chain.invoke(token,'mint',{account_id:members[0],amount:'100000'},{account:coordinator,deposit:1n});await owners[0].deposit('cash','100000');chain.failTransfer=true;
 await owners[0].withdraw('fails','100000');assert.equal((await owners[0].withdrawal('fails')).status,'RESTORED');assert.equal((await owners[0].balance()).balance,'100000');
 chain.failTransfer=false;await owners[0].withdraw('works','100000');assert.equal((await owners[0].withdrawal('works')).status,'COMPLETED');
 assert.equal((await chain.invoke(token,'ft_balance_of',{account_id:members[0]})).value,'100000');
});

test('funding hashes use the same byte ordering as actual Wasm for account punctuation and reordered inputs',async()=>{
 const accounts=['aa-1.testnet','aa.1.testnet','aa_1.testnet'],{chain,clients}=await setup(accounts);
 const specs=accounts.map((buyer,index)=>({id:'punctuation-bill-'+index,purchase_id:'punctuation-'+index,terms_version:1,buyer,seller:accounts[(index+1)%3],amount:'1'}));
 const input={id:v4PurchaseGroupId(deployment,accounts[0],'punctuation'),private:false,deadline_ms:chain.now+100000,positions:v4NetPlan(specs).positions,orders:specs.map(spec=>({purchase_id:spec.purchase_id,terms_version:spec.terms_version,buyer:spec.buyer,seller:spec.seller,order_commitment:'a'.repeat(64),public_terms:{amount:spec.amount,service:'chart',terms_hash:'a'.repeat(64),artifact_hash:'b'.repeat(64)}}))};
 let group=(await clients[0].proposePurchaseGroup(input)).value;
 assert.equal(group.hash,v4FundingGroupHash(deployment,input));assert.equal(group.hash,v4FundingGroupHash(deployment,{...input,positions:input.positions.toReversed(),orders:input.orders.toReversed()}));
 for(const client of clients.slice(0,accounts.length))group=(await client.authorizePurchaseGroup(group,'0')).value;assert.equal(group.status,'FUNDED');
});
export {setup, deployment,members};

test('the release scale fixture funds and settles two 48-order groups with maximum identifiers against actual Wasm',async()=>{
 const accounts=Array.from({length:12},(_,index)=>`g${index}-`.padEnd(56,'x')+'.testnet'),{chain,owners}=await setup(accounts),fixture={seed:'0123456789abcdef',created_at_ms:chain.now,identities:accounts.map(account_id=>({account_id}))};
 for(let index=0;index<2;index++){
  const{input,specs}=scaleFixture(deployment,fixture,index,chain.now+600000);assert.equal(input.id.length,96);assert.ok(specs.every(spec=>spec.purchase_id.length===96&&spec.service.length===96&&spec.id.length===69));
  assert.ok(Buffer.byteLength(JSON.stringify({input}))>32768);assert.ok(Buffer.byteLength(JSON.stringify({input}))<64000);
  await assert.rejects(chain.invoke(vault,'propose_purchase_group',{input,padding:'x'.repeat(64000)},{account:accounts[0],deposit:1n}),/INPUT_TOO_LARGE/);
  let group=(await owners[0].proposePurchaseGroup(input)).value;
  for(const owner of owners.slice(0,12))group=(await owner.authorizePurchaseGroup(group,'0')).value;assert.equal(group.status,'FUNDED');
  for(const spec of specs){const buyer=accounts.indexOf(spec.buyer),seller=accounts.indexOf(spec.seller),invoice=(await owners[buyer].proposeInvoice(spec)).value;await owners[buyer].acceptInvoice(invoice);await owners[seller].acceptInvoice(invoice);}
  const ready=await owners[0].round(input.id);assert.equal(ready.status,'READY');assert.equal(ready.input.invoice_ids.length,48);assert.equal(ready.input.positions.length,12);assert.equal(ready.net_settlement_volume,'0');await owners[0].settleRound(ready);
 }
 assert.equal((await chain.invoke(vault,'get_config',{})).value.invoices,96);assert.ok((await chain.invoke(vault,'get_backing_status',{})).value.claims_equal_tracked_custody);
 for(const owner of owners.slice(0,12)){const balance=await owner.balance();assert.equal(balance.balance,'0');assert.equal(balance.reserved,'0');}
});
