import {randomBytes}from 'node:crypto';
import {mkdirSync,writeFileSync,readFileSync,existsSync}from 'node:fs';
import path from 'node:path';
import {Account,JsonRpcProvider,KeyPair,actions}from '../../packages/client/dist/near.js';
import {AchV4Client,V4NearTransport,v4Digest,V4RpcProvider}from '../../packages/client/dist/v4.js';
import {durableActions}from '../lib/transactions.mjs';
export const TRADING_METHODS=['propose_invoice','accept_invoice','cancel_invoice_by_agreement','authorize_private_purchase','cancel_pending_private_purchase','propose_round','authorize_round','cancel_round_authorization','settle_round','expire_round','release_stale_round'];
const INITIAL_TRADING_METHODS=['propose_invoice','accept_invoice','cancel_invoice_by_agreement','propose_round','authorize_round','cancel_round_authorization','settle_round','expire_round','release_stale_round'];
export class DemoSponsor{
 constructor({store,config,rootIdentity,identityRoot}){this.store=store;this.config=config;this.identityRoot=identityRoot;const provider=new V4RpcProvider(config.rpc_urls??config.rpc_url);this.root=new Account(rootIdentity.account_id,provider,rootIdentity.secret_key);this.rootTransport=new V4NearTransport(rootIdentity.account_id,config.rpc_urls??config.rpc_url,rootIdentity.secret_key,store);this.provisionQueue=Promise.resolve();this.provisioning=new Set();this.owners=new Map();}
 async createSession(ipHash){
  const id=randomBytes(16).toString('hex'),token=randomBytes(32).toString('hex');
  const session={id,created_at_ms:Date.now(),expires_at_ms:Date.now()+86_400_000,participants:[],round_ids:[],state:'PROVISIONING'};
  this.store.reserveSession(ipHash,this.config.sponsor_limits);session.sponsor_native_reserved=this.config.sponsor_limits.perSessionNative;this.store.putSession(session,token,ipHash);
  this.enqueue(session);return{session,token};
 }
 enqueue(session){
  if(this.provisioning.has(session.id))return;this.provisioning.add(session.id);
  this.provisionQueue=this.provisionQueue.then(()=>this.provision(session)).catch(()=>{const latest=this.store.session(session.id);latest.state='PROVISIONING';latest.provision_retry_at_ms=Date.now()+10000;this.store.updateSession(latest);this.store.event(session.id,'wallet-setup-waiting',session.id,{reason:'Sponsorship or chain confirmation is temporarily unavailable.'});}).finally(()=>this.provisioning.delete(session.id));
 }
 resume(){for(const s of this.store.pendingSessions())if(s.state!=='READY'&&(!s.provision_retry_at_ms||s.provision_retry_at_ms<=Date.now()))this.enqueue(s);}
 async provision(session){
  const id=session.id;
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
   const accountId=`${kind[0]}-${id.slice(0,12)}.${this.root.accountId}`;let keys;const filename=path.join(this.identityRoot,'owners',`${id}-${kind}.json`);
   if(existsSync(filename))keys=JSON.parse(readFileSync(filename,'utf8'));
   else{const owner=KeyPair.fromRandom('ed25519'),trader=KeyPair.fromRandom('ed25519');keys={account_id:accountId,owner_secret:owner.toString(),agent_secret:trader.toString()};mkdirSync(path.dirname(filename),{recursive:true,mode:0o700});writeFileSync(filename,JSON.stringify(keys),{mode:0o600,flag:'wx'});}
   const ownerKey=KeyPair.fromString(keys.owner_secret),agentKey=KeyPair.fromString(keys.agent_secret);
   await durableActions(this.root,this.store,`create:${id}:${kind}`,accountId,[actions.createAccount(),actions.transfer(100_000_000_000_000_000_000_000n),actions.addFullAccessKey(ownerKey.getPublicKey()),actions.addFunctionCallAccessKey(agentKey.getPublicKey(),this.config.vault,INITIAL_TRADING_METHODS,80_000_000_000_000_000_000_000n)]);
   // Keep account-creation bytes stable for an interrupted older session.
   // Native operating funds are separate from the vault's settlement tokens.
   await durableActions(this.root,this.store,`operating-budget:${id}:${kind}`,accountId,[actions.transfer(150_000_000_000_000_000_000_000n)]);
   await durableActions(new Account(accountId,this.root.provider,keys.owner_secret),this.store,`trading-permissions:${id}:${kind}:${v4Digest(TRADING_METHODS.join(','))}`,accountId,[actions.deleteKey(agentKey.getPublicKey()),actions.addFunctionCallAccessKey(agentKey.getPublicKey(),this.config.vault,TRADING_METHODS,200_000_000_000_000_000_000_000n)]);
   const agentDir=path.join(this.identityRoot,kind);mkdirSync(agentDir,{recursive:true,mode:0o700});const agentFile=path.join(agentDir,`${id}.json`);if(!existsSync(agentFile))writeFileSync(agentFile,JSON.stringify({account_id:accountId,role:'agent',secret_key:keys.agent_secret}),{mode:0o600,flag:'wx'});
   const ownerTransport=new V4NearTransport(accountId,this.config.rpc_urls??this.config.rpc_url,keys.owner_secret,this.store);const owner=new AchV4Client(this.config,ownerTransport,'owner');
   // Account registration itself is idempotent on chain. The pre-release
   // registration was rejected before inclusion; native/key repairs can use
   // its nonce, so this provisioning stage has its own durable operation ID.
   await owner.register(labels[kind],`sponsored-register:${id}:${kind}${storageBudget>0n?':storage-sponsored-v1':''}`);
   const key=Buffer.from(agentKey.getPublicKey().data).toString('hex');
   await owner.setPolicy({key,max_invoice:'100000',gross_budget:'1000000',max_net_commitment:'1000000',expires_at_ms:session.expires_at_ms,counterparties:[],services:['references','chart','audit']},`demo-policy:${id}:${kind}`);
   await this.rootTransport.call(this.config.token,'storage_deposit',{account_id:accountId},{operation_id:`token-register:${id}:${kind}`,deposit:0n});
   if(kind==='research'){await this.rootTransport.call(this.config.token,'mint',{account_id:accountId,amount:'1000000'},{operation_id:`mint:${id}`,deposit:1n});const result=await owner.deposit(id,'1000000');if(result.value!=='1000000')throw new Error('SPONSORED_DEPOSIT_NOT_CREDITED');}
   if(!session.participants.some(p=>p.kind===kind))session.participants.push({kind,name:labels[kind],account_id:accountId,public_key:key});this.store.updateSession(session);
  }
  if(this.config.private?.enabled){
   await durableActions(this.root,this.store,`private-sponsor:${id}`,this.config.coordinator_id,[actions.transfer(60_000_000_000_000_000_000_000n)]);
   await durableActions(this.root,this.store,`private-recovery-budget:${id}`,this.config.coordinator_id,[actions.transfer(60_000_000_000_000_000_000_000n)]);
   await durableActions(this.root,this.store,`private-execution-budget:${id}`,this.config.coordinator_id,[actions.transfer(250_000_000_000_000_000_000_000n)]);
  }
  session.state='READY';delete session.provision_retry_at_ms;this.store.updateSession(session);this.store.event(id,'session-ready',id,{testnet:true});return session;
 }
 ownerFor(session,accountId){const p=session.participants.find(p=>p.account_id===accountId);if(!p||!['research','visual','audit'].includes(p.kind))throw new Error('DEMO_OWNER_SCOPE_REQUIRED');const cacheKey=`${session.id}:${accountId}`;if(!this.owners.has(cacheKey)){const data=JSON.parse(readFileSync(path.join(this.identityRoot,'owners',`${session.id}-${p.kind}.json`),'utf8'));this.owners.set(cacheKey,new AchV4Client(this.config,new V4NearTransport(data.account_id,this.config.rpc_urls??this.config.rpc_url,data.owner_secret,this.store),'owner'));}return this.owners.get(cacheKey);}
 async withdraw(session,{request_id,account_id,amount}){if(!/^[a-f\d-]{16,40}$/.test(request_id)||!session.participants.some(p=>p.account_id===account_id))throw new Error('SESSION_OWNER_SCOPE_REQUIRED');const owner=this.ownerFor(session,account_id);const result=await owner.withdraw(`withdraw-${request_id}`,amount);const withdrawal=await owner.withdrawal(`withdraw-${request_id}`);return{withdrawal:withdrawal??result.value,tx_hash:result.tx_hash,evidence:result.evidence};}
 async revoke(session,{request_id,account_id}){const owner=this.ownerFor(session,account_id);return owner.revokeAgent(`revoke-${request_id}`);}
 async recover(session,{account_id,nonce,amount}){const owner=this.ownerFor(session,account_id);const result=await owner.recoveryWithdraw(nonce,amount);return{withdrawal:await owner.recoveryWithdrawal(),tx_hash:result.tx_hash,evidence:result.evidence};}
 async deposit(session,{request_id,account_id,amount}){if(!/^[a-f\d-]{16,40}$/.test(request_id))throw new Error('INVALID_REQUEST_ID');const owner=this.ownerFor(session,account_id),result=await owner.deposit(request_id,amount);if(result.value!==amount||!['near_final','local_wasm'].includes(result.evidence))throw new Error('DEPOSIT_NOT_CREDITED');return result;}
 async cancel(session,{id,account_id}){if(!session.round_ids?.includes(id))throw new Error('SESSION_ROUND_SCOPE_REQUIRED');const owner=this.ownerFor(session,account_id),round=await owner.round(id);return owner.cancelRound(round);}
}
