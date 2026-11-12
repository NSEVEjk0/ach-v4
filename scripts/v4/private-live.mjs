import assert from 'node:assert/strict';
import {readFileSync,writeFileSync,existsSync}from 'node:fs';
import {generateKeyPairSync,createPublicKey,createPrivateKey,diffieHellman,hkdfSync,createCipheriv,createDecipheriv,randomBytes}from 'node:crypto';
import {AchV4Client,V4NearTransport,canonicalV4,v4Digest,v4ChargeId,v4PrivateInvoiceCommitment,v4PrivateInputCommitment,encryptV4Invoice,verifyV4InvoiceSignature}from '../../packages/client/dist/v4.js';
import {KeyPair,SignedTransaction}from '../../packages/client/dist/near.js';
import {StateStore}from '../../services/lib/store.mjs';
import {privatePath,manifestPath,outlayerPath}from '../../services/lib/paths.mjs';
import {requireServiceLayout}from '../../services/lib/workflow.mjs';
import {privateNegativeFixture}from './private-negative-fixture.mjs';

const read=filename=>JSON.parse(readFileSync(filename,'utf8'));
const save=(filename,value)=>writeFileSync(filename,JSON.stringify(value,null,2),{mode:0o600});
function decodeOutput(encoded){try{let value=JSON.parse(Buffer.from(encoded,'base64').toString());if(typeof value==='string')value=JSON.parse(value);return value;}catch{return null;}}
async function workerEvidence(provider,hash,workerHash,expectedOperation){
 const tx=await provider.viewTransactionStatus({txHash:hash.tx_hash,accountId:hash.signer_id,waitUntil:'FINAL'}),outputs=[],requestIds=new Set();
 for(const receipt of tx.receipts_outcome??[]){
  if(receipt.outcome.executor_id!=='outlayer.testnet')continue;
  const result=decodeOutput(receipt.outcome.status?.SuccessValue??'');if(result?.protocol_version===4&&result.operation)outputs.push(result);
  for(const log of receipt.outcome.logs??[]){try{const event=JSON.parse(log.replace(/^EVENT_JSON:/,''));for(const entry of [event,...(Array.isArray(event.data)?event.data:[])])if(entry.request_id!==undefined)requestIds.add(String(entry.request_id));}catch{const id=log.match(/request(?:_id| id)?[\s:=#]+(\d+)/i);if(id)requestIds.add(id[1]);}}
 }
 assert.ok(outputs.some(o=>o.operation===expectedOperation&&o.worker_hash===workerHash),'Live OutLayer output is missing or bound to another operation/build.');
 const computed=outputs.find(o=>o.operation===expectedOperation&&o.worker_hash===workerHash);
 assert.equal(computed.spec,undefined);assert.equal(computed.salt,undefined);assert.equal(computed.encrypted_invoices,undefined);
 if(expectedOperation==='verify')assert.ok(computed.positions.every(p=>p.net==='0'),'Receipt verification disclosed a bilateral amount.');
 return{tx_hash:hash.tx_hash,request_ids:[...requestIds],worker_hash:workerHash,operation:expectedOperation,input_commitment:computed.input_commitment,positions:computed.positions};
}
function seal(config,session,key,id){
 const pair=generateKeyPairSync('x25519'),peer=createPublicKey({key:Buffer.concat([Buffer.from('302a300506032b656e032100','hex'),Buffer.from(key.public_key,'hex')]),format:'der',type:'spki'});
 const aes=Buffer.from(hkdfSync('sha256',diffieHellman({privateKey:pair.privateKey,publicKey:peer}),Buffer.alloc(0),Buffer.from('ach-private-brief-v4'),32)),nonce=randomBytes(12),cipher=createCipheriv('aes-256-gcm',aes,nonce);
 cipher.setAAD(canonicalV4('private-brief',config.network,config.vault,[session.id,id]));
 const clear={brief:'Private workload 92713. Create an audited chart from these confidential rows.',data:[{label:'Private cohort 92713',value:91},{label:'Private requests 64281',value:64}]};
 const bytes=Buffer.concat([cipher.update(JSON.stringify(clear)),cipher.final(),cipher.getAuthTag()]);
 return{request_id:id,private_key:pair.privateKey.export({type:'pkcs8',format:'der'}).toString('base64'),peer_key:key.public_key,sealed_brief:{ephemeral_public_key:pair.publicKey.export({type:'spki',format:'der'}).subarray(-32).toString('hex'),nonce:nonce.toString('hex'),ciphertext:bytes.toString('base64')}};
}
function open(config,session,record,response){
 const peer=createPublicKey({key:Buffer.concat([Buffer.from('302a300506032b656e032100','hex'),Buffer.from(record.peer_key,'hex')]),format:'der',type:'spki'}),privateKey=createPrivateKey({key:Buffer.from(record.private_key,'base64'),format:'der',type:'pkcs8'});
 const aes=Buffer.from(hkdfSync('sha256',diffieHellman({privateKey,publicKey:peer}),Buffer.alloc(0),Buffer.from('ach-private-brief-v4'),32)),bytes=Buffer.from(response.ciphertext,'base64'),decipher=createDecipheriv('aes-256-gcm',aes,Buffer.from(response.nonce,'hex'));
 decipher.setAAD(canonicalV4('private-result',config.network,config.vault,[session.id,record.request_id]));decipher.setAuthTag(bytes.subarray(-16));return JSON.parse(Buffer.concat([decipher.update(bytes.subarray(0,-16)),decipher.final()]).toString());
}
async function adversarial(config,owned,provider,until){
 const journal=new StateStore(privatePath('private-adversarial.sqlite'));
 try{
  const owners=new Map(),traders=new Map();
  for(const kind of ['research','visual']){const data=read(privatePath('identities','owners',`${owned.session.id}-${kind}.json`));owners.set(kind,new AchV4Client(config,new V4NearTransport(data.account_id,config.rpc_urls??config.rpc_url,data.owner_secret,journal),'owner'));traders.set(kind,{key:KeyPair.fromString(data.agent_secret),client:new AchV4Client(config,new V4NearTransport(data.account_id,config.rpc_urls??config.rpc_url,data.agent_secret,journal),'agent')});}
  const c=read(privatePath('coordinator-owner.json')),coordinator=new AchV4Client(config,new V4NearTransport(c.account_id,config.rpc_urls??config.rpc_url,c.secret_key,journal),'owner');
  const seed=v4Digest(owned.seed+':negative-private-fixture').slice(0,32),buyer=traders.get('research'),seller=traders.get('visual'),buyerId=buyer.client.transport.account_id,sellerId=seller.client.transport.account_id;
  const stateFile=privatePath('private-negative-state.json'),state=existsSync(stateFile)?read(stateFile):{};
  if(state.before&&state.workflow_revision!==2)throw new Error('FRESH_PRIVATE_NEGATIVE_FIXTURE_REQUIRED');
  state.workflow_revision=2;
  const before=state.before??await buyer.client.balance();
  state.before=before;save(stateFile,state);
  state.fixture??=privateNegativeFixture(config,{seed,buyer:buyerId,seller:sellerId,now:Date.now()});save(stateFile,state);
  const{input,spec,salt}=state.fixture;let group=(await buyer.client.proposePurchaseGroup(input)).value;
  for(const trader of [buyer,seller])if(group.status==='COLLECTING'&&!group.approvals.some(approval=>approval.account_id===trader.client.transport.account_id))group=(await trader.client.authorizePurchaseGroup(group,input.positions.find(position=>position.account_id===trader.client.transport.account_id).net)).value;
  const auth=(await buyer.client.authorizePrivatePurchase({purchase_id:seed,terms_version:1,seller:sellerId,order_commitment:input.orders[0].order_commitment,deadline_ms:input.deadline_ms})).value;
  const commitment=v4PrivateInvoiceCommitment(config,spec,salt);
  const wallets=await Promise.all([buyer.client.balance(),seller.client.balance()]);
  const contribution={spec,salt,signatures:[buyer,seller].map((trader,index)=>({account_id:trader.client.transport.account_id,key_epoch:wallets[index].policy.epoch,signature:Buffer.from(trader.key.sign(Buffer.from(commitment,'hex')).signature).toString('base64')}))};
  const encrypted=encryptV4Invoice(config,await coordinator.privateEncryptionKey(),contribution),tampered=structuredClone(encrypted),bytes=Buffer.from(tampered.ciphertext,'base64');bytes[40]^=1;tampered.ciphertext=bytes.toString('base64');
  const prepare=(id,deadline)=>({id,profile:config.private.profile,members:[buyerId,sellerId],deadline_ms:deadline,encrypted_invoices:[tampered],verification_only:true,input_commitment:v4PrivateInputCommitment(config,id,deadline,config.private.hash,[tampered])});
  const recordedArgs=op=>JSON.parse(Buffer.from(SignedTransaction.decode(Buffer.from(op.signed_transaction,'base64')).transaction.actions[0].functionCall.args).toString());
  const deniedPrior=await journal.get('negative-unauthorized:'+seed);
  const unauthorized=deniedPrior?recordedArgs(deniedPrior):prepare('unauthorized-'+seed,Date.now()+300000);
  await assert.rejects(owners.get('research').transport.call(config.vault,'request_private_round',unauthorized,{operation_id:'negative-unauthorized:'+seed,deposit:1n,gas:120000000000000n}),/CHAIN_EXECUTION_FAILED/);
  const prior=await journal.get('private:tampered-'+seed);
  const request=state.tampered_request??(prior?recordedArgs(prior):prepare('tampered-'+seed,Date.now()+300000));state.tampered_request=request;save(stateFile,state);
  if(!await coordinator.privateRequest(request.id))await coordinator.requestPrivateRound(request);
  const failed=await until(()=>coordinator.privateRequest(request.id),r=>r&&r.status!=='PROCESSING','private-tamper-rejection');assert.ok(['INVALID_OUTPUT','FAILED'].includes(failed.status));assert.equal(await coordinator.privateInvoice(auth.charge_id),null);
  const timeout=state.timeout_request??prepare('timeout-'+seed,Date.now()+8000);state.timeout_request=timeout;save(stateFile,state);
  if(!await coordinator.privateRequest(timeout.id))await coordinator.transport.call(config.vault,'request_private_round',timeout,{operation_id:'negative-timeout:'+seed,deposit:20000000000000000000000n,gas:280000000000000n});
  let expired=await until(()=>coordinator.privateRequest(timeout.id),r=>r&&(r.status!=='PROCESSING'||Date.now()>=timeout.deadline_ms),'private-request-timeout');
  if(expired.status==='PROCESSING')expired=(await coordinator.expirePrivateRequest(timeout.id)).value;
  assert.equal(expired.status,'EXPIRED','The live short-deadline request did not exercise expiry.');
  const cancellation={...auth};await owners.get('research').cancelPendingPrivatePurchase(cancellation);await owners.get('visual').cancelPendingPrivatePurchase(cancellation);await owners.get('visual').cancelPendingPrivatePurchase(cancellation);
  // A funded group's cancellation flags preserve the commitment until expiry.
  // Check the final block time before submitting its durable expiration call.
  await until(async()=>Number(BigInt((await provider.viewBlock({finality:'final'})).header.timestamp_nanosec)/1000000n),time=>time>=input.deadline_ms,'negative-funded-group-expiry',910);
  await owners.get('research').expirePurchaseGroup(input.id);
  assert.equal((await buyer.client.privatePurchase(auth.charge_id)).status,'CANCELLED');
  const after=await buyer.client.balance();assert.equal(after.gross_purchase_budget_used,before.gross_purchase_budget_used);assert.equal(after.balance,before.balance);assert.equal(after.reserved,before.reserved);assert.equal((await coordinator.balance()).active_proposals,0);
  const denied=await journal.get('negative-unauthorized:'+seed),bad=await journal.get('private:'+request.id),timed=await journal.get('negative-timeout:'+seed);
  return{kind:'explicit-negative-fixtures',workflow_revision:2,funding_group_id:input.id,unauthorized_request_tx:denied.tx_hash,tampered_request_tx:bad.tx_hash,tampered_state:failed.status,expired_request_tx:timed.tx_hash,expired_state:expired.status,pending_purchase_cancelled:true,funded_group_expired:true,permission_released_once:true,balances_unchanged:true};
 }finally{journal.close();}
}

export async function runPrivateLive({config,request,session,until,provider,backing}){
 requireServiceLayout(config);
 assert.ok(config.private?.enabled,'The pinned private capability must be deployed first.');
 const owned=await session(privatePath('live-private-session.json'),'private'),token=owned.token,id=owned.seed,key=await request('/private-key',undefined,token);
 const participant=owned.session.participants.find(p=>p.kind==='research')??(await request('/snapshot',undefined,token)).session.participants.find(p=>p.kind==='research');
 const binding=v4Digest(canonicalV4('service-encryption-key',config.network,config.vault,[owned.session.id,participant.account_id,key.public_key]));assert.equal(verifyV4InvoiceSignature(participant.public_key,binding,key.signature),true);
 const filename=privatePath('private-live-brief.json');let sealed;if(existsSync(filename)){sealed=read(filename);assert.equal(sealed.request_id,id);}else{sealed=seal(config,owned.session,key,id);save(filename,sealed);}
 await request('/run',{request_id:id,mode:'report',budget:'300000',privacy:'private',sealed_brief:sealed.sealed_brief},token);
 const delivered=await until(()=>request('/snapshot',undefined,token),s=>s.jobs.some(j=>j.id==='run-'+id&&j.state==='COMPLETE'),'real-private-agent-services',360);
 const job=delivered.jobs.find(j=>j.id==='run-'+id);assert.equal(job.result,null);assert.ok(!JSON.stringify(delivered).includes('92713'));const artifact=open(config,owned.session,sealed,job.sealed_result);assert.equal(artifact.planner.kind,'llm');assert.equal(artifact.chart.audit.valid,true);assert.equal(artifact.bills.length,3);
 const nullifiers=artifact.bills.map(i=>i.charge_id),coordinatorStore=new StateStore(privatePath('coordinator.sqlite')),verifications=[];let net;
 try{
  for(const nullifier of nullifiers){const verification=coordinatorStore.job('receipt-'+nullifier),op=await coordinatorStore.get('private:'+verification.request.id);assert.ok(op?.tx_hash);verifications.push(await workerEvidence(provider,op,config.private.hash,'verify'));}
  if(!delivered.rounds.some(r=>r.status==='SETTLED'&&nullifiers.every(i=>r.input.invoice_ids.includes(i))))await request('/clear',{request_id:v4Digest(id+':private-clear').slice(0,32),privacy:'private',selected_accounts:delivered.session.participants.map(p=>p.account_id),invoice_ids:nullifiers},token);
  const settled=await until(()=>request('/snapshot',undefined,token),s=>s.rounds.some(r=>r.status==='SETTLED'&&nullifiers.every(i=>r.input.invoice_ids.includes(i))),'real-private-clearing',360);
  const round=settled.rounds.find(r=>r.status==='SETTLED'&&nullifiers.every(i=>r.input.invoice_ids.includes(i)));assert.equal(round.gross_invoice_volume,null);assert.equal(round.net_settlement_volume,'20000');assert.equal(round.approvals.length,3);
  const op=await coordinatorStore.get('private:'+round.input.id);net=await workerEvidence(provider,op,config.private.hash,'net');assert.deepEqual(net.positions,round.input.positions);
  const audit=settled.session.participants.find(p=>p.kind==='audit'),withdrawal=await request('/withdraw',{request_id:v4Digest(id+':private-withdraw').slice(0,32),account_id:audit.account_id,amount:'20000'},token);assert.equal(withdrawal.withdrawal.status,'COMPLETED');
  const amount=await provider.callFunction({contractId:config.token,method:'ft_balance_of',args:{account_id:audit.account_id},blockQuery:{finality:'final'}});assert.equal(amount,'20000');
  const negative=await adversarial(config,owned,provider,until);
  const result={session_id:owned.session.id,private_ingress_signed:true,plaintext_private_input_in_snapshot:false,padded_ciphertext_bytes:2064,receipt_checks:verifications,net_execution:net,actual_llm:{provider:artifact.planner.provider,model:artifact.planner.model,response_id:artifact.planner.response_id},private_artifact_sha256:artifact.chart.sha256,private_round:round,withdrawal,adversarial:negative,backing:await backing()};
  const manifest=read(manifestPath),capability=read(outlayerPath);capability.private_round_verified=true;capability.state='live-private-round-verified';capability.private_round_verified_at=new Date().toISOString();capability.verification_evidence={round_id:round.input.id,net_execution_tx:net.tx_hash,receipt_verification_txs:verifications.map(v=>v.tx_hash)};manifest.private=capability;save(outlayerPath,capability);save(manifestPath,manifest);
  return result;
 }finally{coordinatorStore.close();}
}
