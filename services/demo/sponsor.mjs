import {randomBytes}from 'node:crypto';
import {mkdirSync,writeFileSync,readFileSync,existsSync}from 'node:fs';
import path from 'node:path';
import {Account,JsonRpcProvider,KeyPair,actions}from '../../packages/client/dist/near.js';
import {AchV4Client,V4NearTransport,v4Digest,v4Units,V4RpcProvider}from '../../packages/client/dist/v4.js';
import {durableActions}from '../lib/transactions.mjs';
import {requireIdentityAccount,sessionAccountId,isSessionAgentKind,sessionAgentKinds}from '../lib/workflow.mjs';
export const TRADING_METHODS=['propose_invoice','accept_invoice','cancel_invoice_by_agreement','authorize_private_purchase','cancel_pending_private_purchase','propose_purchase_group','authorize_purchase_group','expire_purchase_group','propose_round','authorize_round','cancel_round_authorization','settle_round','expire_round','release_stale_round'];
const INITIAL_TRADING_METHODS=['propose_invoice','accept_invoice','cancel_invoice_by_agreement','propose_round','authorize_round','cancel_round_authorization','settle_round','expire_round','release_stale_round'];
const JUDGE_BALANCE='5000000',DEMO_GROSS_BUDGET='100000000';
export class DemoSponsor{
 constructor({store,config,rootIdentity,identityRoot}){requireIdentityAccount(config,'root',rootIdentity);this.store=store;this.config=config;this.identityRoot=identityRoot;const provider=new V4RpcProvider(config.rpc_urls??config.rpc_url);this.root=new Account(rootIdentity.account_id,provider,rootIdentity.secret_key);this.rootTransport=new V4NearTransport(rootIdentity.account_id,config.rpc_urls??config.rpc_url,rootIdentity.secret_key,store);this.provisionQueue=Promise.resolve();this.provisioning=new Set();this.owners=new Map();}
 async createSession(ipHash,parent,{agent_count=3}={}){
  if(this.config.network!=='testnet')throw new Error('TESTNET_SPONSOR_REQUIRED');
  if(!/^[a-f\d]{64}$/.test(ipHash))throw new Error('TRUSTED_RATE_LIMIT_ID_REQUIRED');
  if(!this.config.sponsor_limits||typeof this.config.sponsor_limits.perSessionNative!=='string')throw new Error('SPONSOR_CONFIGURATION_REQUIRED');
  sessionAgentKinds(agent_count);
  const previous=parent?this.store.session(parent.id):null;if(parent&&(!previous||previous.expires_at_ms<=Date.now()))throw new Error('SESSION_EXPIRED');
  const prepared=this.store.claimPreparedSession(ipHash,previous,agent_count,this.config.sponsor_limits);
  if(prepared){setImmediate(()=>this.maintainPreparedPool());return prepared;}
  const id=randomBytes(16).toString('hex'),token=randomBytes(32).toString('hex');
  const session={id,family_id:previous?(previous.family_id??previous.id):id,created_at_ms:Date.now(),expires_at_ms:Date.now()+86_400_000,participants:[],round_ids:[],state:'PROVISIONING',provisioning_version:3,agent_count,judge_testing:true,initial_balance:agent_count>3?(BigInt(JUDGE_BALANCE)*BigInt(agent_count)).toString():'1000000'};
  const limits=this.sessionLimits(session);
  this.store.reserveSession(ipHash,limits);session.sponsor_native_reserved=limits.perSessionNative;this.store.putSession(session,token,ipHash);
  this.enqueue(session);return{session,token};
 }
 enqueue(session){
  if(this.provisioning.has(session.id))return;this.provisioning.add(session.id);
  this.provisionQueue=this.provisionQueue.then(()=>this.provision(session)).catch(()=>{const latest=this.store.session(session.id);latest.state='PROVISIONING';latest.provision_retry_at_ms=Date.now()+10000;this.store.updateSession(latest);this.store.event(session.id,'wallet-setup-waiting',session.id,{reason:'Sponsorship or chain confirmation is temporarily unavailable.'});}).finally(()=>this.provisioning.delete(session.id));
 }
 resume(){for(const s of this.store.pendingSessions({includePrepared:true}))if(s.state!=='READY'&&(!s.provision_retry_at_ms||s.provision_retry_at_ms<=Date.now()))this.enqueue(s);this.maintainPreparedPool();}
 maintainPreparedPool(){
  const targets=this.config.sponsor_limits?.preparedWorkspaces;if(!targets)return;
  try{
   if(this.config.network!=='testnet'||!Array.isArray(targets)||targets.length>2||new Set(targets.map(t=>t.agent_count)).size!==targets.length||targets.some(t=>![3,12].includes(t.agent_count)||!Number.isSafeInteger(t.ready)||t.ready<0||t.ready>4))throw new Error('PREPARED_WALLET_POOL_CONFIGURATION_REQUIRED');
   const existing=this.store.pendingSessions({includePrepared:true}),now=Date.now();
   for(const target of targets){
    let count=existing.filter(s=>s.prepared_pool&&s.agent_count===target.agent_count&&s.expires_at_ms>now+3600000).length;
    while(count++<target.ready){
     const id=randomBytes(16).toString('hex'),session={id,family_id:id,created_at_ms:now,expires_at_ms:now+86400000,participants:[],round_ids:[],state:'PROVISIONING',provisioning_version:3,agent_count:target.agent_count,judge_testing:true,prepared_pool:true,initial_balance:target.agent_count>3?(BigInt(JUDGE_BALANCE)*BigInt(target.agent_count)).toString():'1000000'};
     const limits=this.sessionLimits(session),ipHash=v4Digest('prepared-wallet-pool:'+this.config.root+':'+target.agent_count);
     this.store.reserveSession(ipHash,{...limits,ipLimit:null,intervalMs:0});session.sponsor_native_reserved=limits.perSessionNative;
     this.store.putSession(session,randomBytes(32).toString('hex'),ipHash);this.enqueue(session);
    }
   }
  }catch{console.error('ACH_PREPARED_WALLET_POOL_WAITING');}
 }
 sessionLimits(session){
  const count=session.provisioning_version>=2?(session.agent_count??3):3;sessionAgentKinds(count);
  const extra=BigInt(count-3);
  return{...this.config.sponsor_limits,perSessionNative:(BigInt(this.config.sponsor_limits.perSessionNative)+extra*350_000_000_000_000_000_000_000n).toString(),vaultStorageNative:(BigInt(this.config.sponsor_limits.vaultStorageNative??'0')+extra*100_000_000_000_000_000_000_000n).toString()};
 }
 async provision(session){
  if(session.provisioning_version>=2)return this.provisionBatched(session);
  return this.provisionLegacy(session);
 }
 async provisionLegacy(session){
  const id=session.id;
  // Validate all saved wallet selectors before any sponsorship transaction.
  for(const kind of ['research','visual','audit']){const filename=path.join(this.identityRoot,'owners',`${id}-${kind}.json`);sessionAccountId(this.config,id,kind);if(existsSync(filename))this.ownerIdentity(session,kind);}
  this.store.ensureSessionReservation(session,this.config.sponsor_limits);
  const storageBudget=BigInt(this.config.sponsor_limits.vaultStorageNative??'0');
  if(storageBudget>0n){
   if(this.config.network!=='testnet'||storageBudget>1_000_000_000_000_000_000_000_000n)throw new Error('SPONSORED_STORAGE_BUDGET_OUTSIDE_LIMIT');
   // This native allocation is included in the session's sponsor reservation.
   // A restart reuses the same transfer; customer settlement tokens stay intact.
   await durableActions(this.root,this.store,`vault-storage-budget:${id}`,this.config.vault,[actions.transfer(storageBudget)]);
  }
  const labels={research:'Research Desk',visual:'Visual Studio',audit:'Audit Desk'};
  for(const kind of ['research','visual','audit']){
   session.setup_progress={agent:kind,stage:'Creating wallet'};this.store.updateSession(session);
   const accountId=sessionAccountId(this.config,id,kind);let keys;const filename=path.join(this.identityRoot,'owners',`${id}-${kind}.json`);
   if(existsSync(filename))keys=this.ownerIdentity(session,kind);
   else{const owner=KeyPair.fromRandom('ed25519'),trader=KeyPair.fromRandom('ed25519');keys={account_id:accountId,owner_secret:owner.toString(),agent_secret:trader.toString()};mkdirSync(path.dirname(filename),{recursive:true,mode:0o700});writeFileSync(filename,JSON.stringify(keys),{mode:0o600,flag:'wx'});}
   const ownerKey=KeyPair.fromString(keys.owner_secret),agentKey=KeyPair.fromString(keys.agent_secret);
   const oldCreation=await this.store.get(`create:${id}:${kind}`);
   if(oldCreation){
   await durableActions(this.root,this.store,`create:${id}:${kind}`,accountId,[actions.createAccount(),actions.transfer(100_000_000_000_000_000_000_000n),actions.addFullAccessKey(ownerKey.getPublicKey()),actions.addFunctionCallAccessKey(agentKey.getPublicKey(),this.config.vault,INITIAL_TRADING_METHODS,80_000_000_000_000_000_000_000n)]);
   // Keep account-creation bytes stable for an interrupted older session.
   // Native operating funds are separate from the vault's settlement tokens.
   await durableActions(this.root,this.store,`operating-budget:${id}:${kind}`,accountId,[actions.transfer(150_000_000_000_000_000_000_000n)]);
   await durableActions(new Account(accountId,this.root.provider,keys.owner_secret),this.store,`trading-permissions:${id}:${kind}:${v4Digest(TRADING_METHODS.join(','))}`,accountId,[actions.deleteKey(agentKey.getPublicKey()),actions.addFunctionCallAccessKey(agentKey.getPublicKey(),this.config.vault,TRADING_METHODS,200_000_000_000_000_000_000_000n)]);
   }else{
    await durableActions(this.root,this.store,`create-funded:${id}:${kind}`,accountId,[actions.createAccount(),actions.transfer(250_000_000_000_000_000_000_000n),actions.addFullAccessKey(ownerKey.getPublicKey()),actions.addFunctionCallAccessKey(agentKey.getPublicKey(),this.config.vault,TRADING_METHODS,200_000_000_000_000_000_000_000n)]);
   }
   const agentDir=path.join(this.identityRoot,kind);mkdirSync(agentDir,{recursive:true,mode:0o700});const agentFile=path.join(agentDir,`${id}.json`);if(!existsSync(agentFile))writeFileSync(agentFile,JSON.stringify({account_id:accountId,role:'agent',secret_key:keys.agent_secret}),{mode:0o600,flag:'wx'});
   const ownerTransport=new V4NearTransport(accountId,this.config.rpc_urls??this.config.rpc_url,keys.owner_secret,this.store);const owner=new AchV4Client(this.config,ownerTransport,'owner');
   // Account registration itself is idempotent on chain. The pre-release
   // registration was rejected before inclusion; native/key repairs can use
   // its nonce, so this provisioning stage has its own durable operation ID.
   session.setup_progress={agent:kind,stage:'Installing spending permissions'};this.store.updateSession(session);
   const key=Buffer.from(agentKey.getPublicKey().data).toString('hex');
   if(oldCreation){
    await this.rootTransport.call(this.config.vault,'authorize_account_registration',{account_id:accountId,name:labels[kind],expires_at_ms:session.expires_at_ms},{operation_id:`wallet-sponsorship:${id}:${kind}`,deposit:1n});
    await owner.register(labels[kind],`sponsored-register:${id}:${kind}${storageBudget>0n?':storage-sponsored-v1':''}`);
    await owner.setPolicy({key,max_invoice:'100000',gross_budget:'1000000',max_net_commitment:'1000000',expires_at_ms:session.expires_at_ms,counterparties:[],services:['references','chart','audit']},`demo-policy:${id}:${kind}`);
   }else{
    await this.rootTransport.call(this.config.vault,'authorize_account_registration',{account_id:accountId,name:labels[kind],expires_at_ms:session.expires_at_ms},{operation_id:`wallet-sponsorship:${id}:${kind}`,deposit:1n});
    await durableActions(new Account(accountId,this.root.provider,keys.owner_secret),this.store,`wallet-policy:${id}:${kind}`,this.config.vault,[actions.functionCall('register_account',{name:labels[kind]},35_000_000_000_000n,1n),actions.functionCall('set_agent_policy',{key,max_invoice:'100000',gross_budget:'1000000',max_net_commitment:'1000000',expires_at_ms:session.expires_at_ms,counterparties:[],services:['references','chart','audit']},35_000_000_000_000n,1n)]);
   }
   session.setup_progress={agent:kind,stage:'Preparing settlement balance'};this.store.updateSession(session);
   await this.rootTransport.call(this.config.token,'storage_deposit',{account_id:accountId},{operation_id:`token-register:${id}:${kind}`,deposit:0n});
   if(kind==='research'){await this.rootTransport.call(this.config.token,'mint',{account_id:accountId,amount:'1000000'},{operation_id:`mint:${id}`,deposit:1n});const result=await owner.deposit(id,'1000000');if(result.value!=='1000000')throw new Error('SPONSORED_DEPOSIT_NOT_CREDITED');this.store.eventOnce(id,'deposit-completed','deposit-'+id,{account_id:accountId,amount:'1000000',tx_hash:result.tx_hash,evidence:result.evidence,operation_id:'deposit:'+id,sponsored:true});}
   if(!session.participants.some(p=>p.kind===kind))session.participants.push({kind,name:labels[kind],account_id:accountId,public_key:key});this.store.updateSession(session);
  }
  if(this.config.private?.enabled){
   await durableActions(this.root,this.store,`private-sponsor:${id}`,this.config.coordinator_id,[actions.transfer(60_000_000_000_000_000_000_000n)]);
   await durableActions(this.root,this.store,`private-recovery-budget:${id}`,this.config.coordinator_id,[actions.transfer(60_000_000_000_000_000_000_000n)]);
   await durableActions(this.root,this.store,`private-execution-budget:${id}`,this.config.coordinator_id,[actions.transfer(250_000_000_000_000_000_000_000n)]);
  }
  session.state='READY';delete session.provision_retry_at_ms;session.setup_progress={stage:'Ready'};this.store.updateSession(session);this.store.event(id,'session-ready',id,{testnet:true});return session;
 }
 async executeActions(account,id,receiver,actionList){return durableActions(account,this.store,id,receiver,actionList);}
 async provisionBatched(session){
  const id=session.id,kinds=sessionAgentKinds(session.agent_count??3),limits=this.sessionLimits(session),modern=session.provisioning_version>=3;
  for(const kind of kinds){
   sessionAccountId(this.config,id,kind);const file=path.join(this.identityRoot,'owners',`${id}-${kind}.json`),agentFile=path.join(this.identityRoot,kind,`${id}.json`);
   if(existsSync(file)){
    const keys=this.ownerIdentity(session,kind);try{KeyPair.fromString(keys.owner_secret);KeyPair.fromString(keys.agent_secret);}catch{throw new Error('SESSION_IDENTITY_SCOPE_REQUIRED');}
    if(existsSync(agentFile)){const saved=JSON.parse(readFileSync(agentFile,'utf8'));if(saved.account_id!==keys.account_id||saved.secret_key!==keys.agent_secret)throw new Error('SESSION_IDENTITY_SCOPE_REQUIRED');}
   }else if(existsSync(agentFile))throw new Error('SESSION_IDENTITY_SCOPE_REQUIRED');
  }
  this.store.ensureSessionReservation(session,limits);
  const storageBudget=BigInt(limits.vaultStorageNative);
  if(this.config.network!=='testnet'||storageBudget>2_000_000_000_000_000_000_000_000n)throw new Error('SPONSORED_STORAGE_BUDGET_OUTSIDE_LIMIT');
  const progress=(stage,completed=0)=>{session.setup_progress={stage,completed,total:kinds.length};this.store.updateSession(session);};
  progress('Funding wallet storage');
  if(storageBudget>0n)await this.executeActions(this.root,`vault-storage-budget-v2:${id}`,this.config.vault,[actions.transfer(storageBudget)]);
  const labels={research:'Research Desk',visual:'Visual Studio',audit:'Audit Desk'},wallets=[];
  for(const kind of kinds){
   progress('Creating sponsored wallets',wallets.length);
   const accountId=sessionAccountId(this.config,id,kind),filename=path.join(this.identityRoot,'owners',`${id}-${kind}.json`);
   if(!existsSync(filename)){
    const owner=KeyPair.fromRandom('ed25519'),trader=KeyPair.fromRandom('ed25519');
    mkdirSync(path.dirname(filename),{recursive:true,mode:0o700});writeFileSync(filename,JSON.stringify({account_id:accountId,owner_secret:owner.toString(),agent_secret:trader.toString()}),{mode:0o600,flag:'wx'});
   }
   const keys=this.ownerIdentity(session,kind),ownerKey=KeyPair.fromString(keys.owner_secret),agentKey=KeyPair.fromString(keys.agent_secret),key=Buffer.from(agentKey.getPublicKey().data).toString('hex'),name=labels[kind]??'Test Agent '+kind.slice(5);
   await this.executeActions(this.root,`create-funded-v2:${id}:${kind}`,accountId,[actions.createAccount(),actions.transfer(250_000_000_000_000_000_000_000n),actions.addFullAccessKey(ownerKey.getPublicKey()),actions.addFunctionCallAccessKey(agentKey.getPublicKey(),this.config.vault,TRADING_METHODS,200_000_000_000_000_000_000_000n)]);
   const agentDir=path.join(this.identityRoot,kind),agentFile=path.join(agentDir,`${id}.json`);mkdirSync(agentDir,{recursive:true,mode:0o700});
   if(!existsSync(agentFile))writeFileSync(agentFile,JSON.stringify({account_id:accountId,role:'agent',secret_key:keys.agent_secret}),{mode:0o600,flag:'wx'});
   else{const saved=JSON.parse(readFileSync(agentFile,'utf8'));if(saved.account_id!==accountId||saved.secret_key!==keys.agent_secret)throw new Error('SESSION_IDENTITY_SCOPE_REQUIRED');}
   wallets.push({kind,name,account_id:accountId,public_key:key,owner_secret:keys.owner_secret});
  }
  progress('Authorizing wallet registration',kinds.length);
  await this.executeActions(this.root,`wallet-sponsorship-batch-v2:${id}`,this.config.vault,wallets.map(w=>actions.functionCall('authorize_account_registration',{account_id:w.account_id,name:w.name,expires_at_ms:session.expires_at_ms},12_000_000_000_000n,1n)));
  progress('Installing spending permissions',kinds.length);
  // Each owner has a distinct signer. Await every result before retrying, so
  // one RPC failure cannot leave unseen transactions running in the next pass.
  const policies=await Promise.allSettled(wallets.map(w=>this.executeActions(new Account(w.account_id,this.root.provider,w.owner_secret),`wallet-policy-v${modern?3:2}:${id}:${w.kind}`,this.config.vault,[actions.functionCall('register_account',{name:w.name},35_000_000_000_000n,1n),actions.functionCall('set_agent_policy',{key:w.public_key,max_invoice:'100000',gross_budget:modern?DEMO_GROSS_BUDGET:'1000000',max_net_commitment:modern&&wallets.length>3?JUDGE_BALANCE:'1000000',expires_at_ms:session.expires_at_ms,counterparties:[],services:['references','chart','audit','netting-test']},35_000_000_000_000n,1n)])));
  const failure=policies.find(r=>r.status==='rejected');if(failure)throw failure.reason;
  progress('Preparing test token balances',kinds.length);
  const funded=wallets.filter(w=>modern?(wallets.length>3||w.kind==='research'):(w.kind==='research'||w.kind.startsWith('test-'))),amount=modern&&wallets.length>3?JUDGE_BALANCE:'1000000';
  const registrations=wallets.map(w=>actions.functionCall('storage_deposit',{account_id:w.account_id},10_000_000_000_000n,0n)),mints=funded.map(w=>actions.functionCall('mint',{account_id:w.account_id,amount},15_000_000_000_000n,1n));
  // Preserve interrupted revision-2 bytes. Larger new workspaces use separate
  // batches to retain headroom below the 300 TGas transaction limit.
  if(modern&&wallets.length>3){
   await this.executeActions(this.root,`token-registration-batch-v3:${id}`,this.config.token,registrations);
   await this.executeActions(this.root,`token-mint-batch-v3:${id}`,this.config.token,mints);
  }else await this.executeActions(this.root,`token-setup-batch-v2:${id}`,this.config.token,[...registrations,...mints]);
  session.participants=wallets.map(({owner_secret,...participant})=>participant);this.store.updateSession(session);
  progress('Confirming the settlement deposit',kinds.length);
  const deposits=await Promise.allSettled(funded.map(async w=>{
   const depositId=w.kind==='research'?id:id+'-'+w.kind;
   const result=await this.ownerFor(session,w.account_id).deposit(depositId,amount);
   if(result.value!==amount||result.evidence!=='near_final')throw new Error('SPONSORED_DEPOSIT_NOT_CREDITED');
   this.store.eventOnce(id,'deposit-completed','deposit-'+depositId,{account_id:w.account_id,amount,tx_hash:result.tx_hash,evidence:result.evidence,operation_id:'deposit:'+depositId,sponsored:true});
  }));
  const depositFailure=deposits.find(r=>r.status==='rejected');if(depositFailure)throw depositFailure.reason;
  if(this.config.private?.enabled){progress('Funding private computation',kinds.length);await this.executeActions(this.root,`private-budget-batch-v2:${id}`,this.config.coordinator_id,[actions.transfer(370_000_000_000_000_000_000_000n)]);}
  session.state='READY';delete session.provision_retry_at_ms;session.setup_progress={stage:'Ready',completed:kinds.length,total:kinds.length};session.provisioned_at_ms=Date.now();this.store.updateSession(session);this.store.eventOnce(id,'session-ready',id,{testnet:true,agents:kinds.length,setup_ms:session.provisioned_at_ms-session.created_at_ms});return session;
 }
 ownerIdentity(session,kind){const expected=sessionAccountId(this.config,session.id,kind),data=JSON.parse(readFileSync(path.join(this.identityRoot,'owners',`${session.id}-${kind}.json`),'utf8'));if(data.account_id!==expected)throw new Error('SESSION_IDENTITY_SCOPE_REQUIRED');return data;}
 ownerFor(session,accountId){const p=session.participants.find(p=>p.account_id===accountId);if(!p||!isSessionAgentKind(p.kind))throw new Error('DEMO_OWNER_SCOPE_REQUIRED');if(accountId!==sessionAccountId(this.config,session.id,p.kind))throw new Error('SESSION_IDENTITY_SCOPE_REQUIRED');const cacheKey=`${session.id}:${accountId}`;if(!this.owners.has(cacheKey)){const data=this.ownerIdentity(session,p.kind);this.owners.set(cacheKey,new AchV4Client(this.config,new V4NearTransport(data.account_id,this.config.rpc_urls??this.config.rpc_url,data.owner_secret,this.store),'owner'));}return this.owners.get(cacheKey);}
 async recordOwnerAction(session,reference,data,work){
  this.store.eventOnce(session.id,data.action+'-requested',reference,data);
  try{const result=await work(),status=result.withdrawal?.status??'COMPLETED';this.store.eventOnce(session.id,data.action+'-'+status.toLowerCase(),reference,{...data,status,tx_hash:result.tx_hash,evidence:result.evidence});return result;}
  catch(error){if(!/UNKNOWN|UNAVAILABLE/.test(error.message))this.store.eventOnce(session.id,data.action+'-failed',reference,{...data,status:'FAILED'});throw error;}
 }
 async withdraw(session,{request_id,account_id,amount}){if(!/^[a-f\d-]{16,40}$/.test(request_id)||!session.participants.some(p=>p.account_id===account_id))throw new Error('SESSION_OWNER_SCOPE_REQUIRED');if(v4Units(amount)===0n)throw new Error('INVALID_AMOUNT');const owner=this.ownerFor(session,account_id),id=`withdraw-${request_id}`;return this.recordOwnerAction(session,id,{action:'withdrawal',account_id,amount,operation_id:'withdraw:'+id},async()=>{const result=await owner.withdraw(id,amount),withdrawal=await owner.withdrawal(id);return{withdrawal:withdrawal??result.value,tx_hash:result.tx_hash,evidence:result.evidence};});}
 async revoke(session,{request_id,account_id}){if(!/^[a-f\d-]{16,40}$/.test(request_id))throw new Error('INVALID_REQUEST_ID');const owner=this.ownerFor(session,account_id);return this.recordOwnerAction(session,`revoke-${request_id}`,{action:'agent-revoke',account_id,operation_id:`revoke-${request_id}`},()=>owner.revokeAgent(`revoke-${request_id}`));}
 async recover(session,{account_id,nonce,amount}){if(!Number.isSafeInteger(nonce)||nonce<1||v4Units(amount)===0n)throw new Error('INVALID_RECOVERY_REQUEST');const owner=this.ownerFor(session,account_id);return this.recordOwnerAction(session,`recovery-${nonce}-${account_id}`,{action:'withdrawal',account_id,amount,operation_id:`recovery:${account_id}:${nonce}`,recovery:true},async()=>{const result=await owner.recoveryWithdraw(nonce,amount);return{withdrawal:await owner.recoveryWithdrawal(),tx_hash:result.tx_hash,evidence:result.evidence};});}
 async deposit(session,{request_id,account_id,amount}){if(!/^[a-f\d-]{16,40}$/.test(request_id)||v4Units(amount)===0n)throw new Error('INVALID_REQUEST_ID');const owner=this.ownerFor(session,account_id);return this.recordOwnerAction(session,`deposit-${request_id}`,{action:'deposit',account_id,amount,operation_id:'deposit:'+request_id},async()=>{const result=await owner.deposit(request_id,amount);if(result.value!==amount||!['near_final','local_wasm'].includes(result.evidence))throw new Error('DEPOSIT_NOT_CREDITED');return result;});}
 async cancel(session,{id,account_id}){if(!session.round_ids?.includes(id))throw new Error('SESSION_ROUND_SCOPE_REQUIRED');const owner=this.ownerFor(session,account_id),round=await owner.round(id);return owner.cancelRound(round);}
}
