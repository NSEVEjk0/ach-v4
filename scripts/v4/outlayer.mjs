// Deploy only the testnet private capability. Protected plaintext never leaves TEE.
import {readFileSync,writeFileSync,existsSync}from 'node:fs';
import {createHash}from 'node:crypto';
import {Account,JsonRpcProvider,actions}from '../../packages/client/dist/near.js';
import {V4NearTransport,AchV4Client}from '../../packages/client/dist/v4.js';
import {StateStore}from '../../services/lib/store.mjs';
import {durableActions}from '../../services/lib/transactions.mjs';
import {privatePath,manifestPath,outlayerPath}from '../../services/lib/paths.mjs';
const read=p=>JSON.parse(readFileSync(p,'utf8')),save=(p,v)=>writeFileSync(p,JSON.stringify(v,null,2),{mode:0o600});
const accounts=read(privatePath('accounts.json')),build=read('docs/v4/build.json'),manifest=read(manifestPath);
if(accounts.network!=='testnet'||manifest.network!=='testnet'||manifest.vault!==accounts.vault)throw new Error('TESTNET_PRIVATE_DEPLOYMENT_REQUIRED');
const worker=readFileSync(build.artifacts.worker.path),hash=createHash('sha256').update(worker).digest('hex');
if(hash!==build.artifacts.worker.sha256)throw new Error('PRIVATE_BUILD_HASH_MISMATCH');
const journal=new StateStore(privatePath('outlayer.sqlite')),provider=new JsonRpcProvider({url:accounts.rpc_url},{retries:2});
const root=read(privatePath('root.json')),vault=read(privatePath('vault.json')),owner=read(privatePath('coordinator-owner.json'));
const rootAccount=new Account(root.account_id,provider,root.secret_key),vaultTransport=new V4NearTransport(vault.account_id,accounts.rpc_url,vault.secret_key,journal),ownerTransport=new V4NearTransport(owner.account_id,accounts.rpc_url,owner.secret_key,journal),ownerClient=new AchV4Client(manifest,ownerTransport,'owner');
const url='https://test.fastfs.io/'+root.account_id+'/outlayer.testnet/'+hash+'.wasm',profile='ach-private-v4';
const string=s=>{const b=Buffer.from(s),n=Buffer.alloc(4);n.writeUInt32LE(b.length);return Buffer.concat([n,b]);};
const size=Buffer.alloc(4);size.writeUInt32LE(worker.length);
try{
 const upload=await durableActions(rootAccount,journal,'worker-upload:'+hash,'outlayer.testnet',[actions.functionCall('__fastdata_fastfs',Buffer.concat([Buffer.from([0]),string(hash+'.wasm'),Buffer.from([1]),string('application/wasm'),size,worker]),1n,0n)],{recordedFastFS:true});
 let downloaded=false;
 for(let i=0;i<30;i++){try{const r=await fetch(url,{signal:AbortSignal.timeout(10000)});if(r.ok&&createHash('sha256').update(Buffer.from(await r.arrayBuffer())).digest('hex')===hash){downloaded=true;break;}}catch{}await new Promise(resolve=>setTimeout(resolve,1000));}
 if(!downloaded)throw new Error('FASTFS_EXACT_ARTIFACT_UNAVAILABLE');
 console.log(JSON.stringify({phase:'exact-worker-published',hash,url}));
 const secretFile=privatePath('outlayer-generated-secret.json');let encrypted;
 if(existsSync(secretFile)){const stored=read(secretFile);if(stored.hash!==hash||stored.owner!==vault.account_id)throw new Error('PRIVATE_SECRET_REFERENCE_CONFLICT');encrypted=stored.encrypted_data_base64;}
 else{
  const response=await fetch('https://testnet-api.outlayer.ai/secrets/add_generated_secret',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({accessor:{type:'WasmHash',hash},owner:vault.account_id,profile,encrypted_secrets_base64:null,new_secrets:[{name:'PROTECTED_INVOICE_KEY',generation_type:'hex32'}]}),signal:AbortSignal.timeout(45000)});
  if(!response.ok)throw new Error('OUTLAYER_PROTECTED_KEY_GENERATION_FAILED');const generated=await response.json();encrypted=generated.encrypted_data_base64;
  if(typeof encrypted!=='string'||encrypted.length<100)throw new Error('OUTLAYER_GENERATED_RESPONSE_INVALID');save(secretFile,{hash,owner:vault.account_id,encrypted_data_base64:encrypted});
 }
 const access={Logic:{operator:'And',conditions:[{Whitelist:{accounts:[owner.account_id]}},{Predecessor:{condition:{Whitelist:{accounts:[vault.account_id]}}}},{WasmHash:{hash}}]}};
 const stored=await vaultTransport.call('outlayer.testnet','store_secrets',{accessor:{WasmHash:{hash}},profile,encrypted_secrets_base64:encrypted,access,vault_id:null},{operation_id:'private-secrets:'+hash,deposit:100_000_000_000_000_000_000_000n,gas:60000000000000n});
 const current=await vaultTransport.view(manifest.vault,'get_config',{}),workerRef={outlayer_account:'outlayer.testnet',url,hash,profile};
 if(!current.private_worker)await vaultTransport.call(manifest.vault,'pin_private_worker',{worker:workerRef},{operation_id:'pin-private-worker:'+hash,deposit:1n});
 else if(JSON.stringify(current.private_worker)!==JSON.stringify(workerRef))throw new Error('PINNED_WORKER_REFERENCE_CONFLICT');
 const keyRun=await ownerTransport.call(manifest.vault,'request_private_encryption_key',{profile},{operation_id:'private-key-bootstrap:'+hash,deposit:20_000_000_000_000_000_000_000n,gas:240000000000000n});
 let encryption;
 for(let i=0;i<60;i++){encryption=await ownerClient.privateEncryptionKey();if(encryption)break;await new Promise(resolve=>setTimeout(resolve,1000));}
 if(!encryption||encryption.worker_hash!==hash)throw new Error('LIVE_ENCRYPTION_KEY_VERIFICATION_FAILED');
 const capability={enabled:true,state:'live-key-verified',outlayer_account:'outlayer.testnet',url,hash,profile,encryption_key:encryption,protected_key_plaintext_received:false,secrets_owner:manifest.vault,access,upload_tx:upload.tx_hash,secret_storage_tx:stored.tx_hash,key_bootstrap_tx:keyRun.tx_hash,private_round_verified:false,verified_at:new Date().toISOString()};
 writeFileSync(outlayerPath,JSON.stringify(capability,null,2));manifest.private=capability;writeFileSync(manifestPath,JSON.stringify(manifest,null,2));
 console.log(JSON.stringify({phase:'private-key-verified',public_key:encryption.public_key,hash,repository_pushed:false}));
}finally{journal.close();}
