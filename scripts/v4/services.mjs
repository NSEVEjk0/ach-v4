import {readFileSync,writeFileSync,mkdirSync,existsSync,chmodSync,readdirSync,readlinkSync,copyFileSync}from 'node:fs';
import {spawn,spawnSync}from 'node:child_process';
import {randomBytes}from 'node:crypto';
import net from 'node:net';
import {Account,JsonRpcProvider,KeyPair,actions}from '../../packages/client/dist/near.js';
import {StateStore}from '../../services/lib/store.mjs';import {durableActions}from '../../services/lib/transactions.mjs';
import {v4UnknownTransaction,V4RpcProvider}from '../../packages/client/dist/v4.js';
import {repoRoot as root,privateRoot,manifestPath}from '../../services/lib/paths.mjs';
mkdirSync(privateRoot,{recursive:true,mode:0o700});
const config=JSON.parse(readFileSync(manifestPath,'utf8'));
if(config.network!=='testnet'||config.status!=='deployed')throw new Error('VERIFIED_TESTNET_SERVICE_CONFIGURATION_REQUIRED');
const available=port=>new Promise(resolve=>{const s=net.createServer();s.once('error',()=>resolve(false));s.listen(port,'0.0.0.0',()=>s.close(()=>resolve(true)));});
if(process.argv.includes('--inspect')){
 console.log(JSON.stringify({ports:{http:await available(80),https:await available(443)},listeners:spawnSync('ss',['-ltnp'],{encoding:'utf8'}).stdout.split('\n').filter(l=>/:418[01]|:419[123]/.test(l)),caddy:existsSync('/usr/bin/caddy'),cloudflared:existsSync('/usr/bin/cloudflared'),user_service_manager:spawnSync('systemctl',['--user','is-system-running'],{encoding:'utf8'}).stdout.trim()}));process.exit(0);
}
if(new URL(config.services.coordinator).port==='4180'){if(!await available(52180))throw new Error('ISOLATED_COORDINATOR_PORT_REQUIRED');config.services.coordinator='http://127.0.0.1:52180';}
const publisherFile=privateRoot+'/gateway-publisher.json';
let publisher;
if(existsSync(publisherFile))publisher=JSON.parse(readFileSync(publisherFile,'utf8'));
else{const key=KeyPair.fromRandom('ed25519');publisher={account_id:'gate.'+config.coordinator_id.split('.').slice(1).join('.'),secret_key:key.toString(),public_key:key.getPublicKey().toString(),role:'gateway-publisher'};writeFileSync(publisherFile,JSON.stringify(publisher),{mode:0o600,flag:'wx'});}
const rootIdentity=JSON.parse(readFileSync(privateRoot+'/root.json','utf8')),journal=new StateStore(privateRoot+'/services-deployment.sqlite');
try{await durableActions(new Account(rootIdentity.account_id,new V4RpcProvider(config.rpc_urls??config.rpc_url),rootIdentity.secret_key),journal,'create-gateway-publisher',publisher.account_id,[actions.createAccount(),actions.transfer(100_000_000_000_000_000_000_000n),actions.addFunctionCallAccessKey(KeyPair.fromString(publisher.secret_key).getPublicKey(),'outlayer.testnet',['__fastdata_fastfs'],80_000_000_000_000_000_000_000n)]);}finally{journal.close();}
config.gateway={discovery_url:'https://test.fastfs.io/'+publisher.account_id+'/outlayer.testnet/ach-v4-gateway.json',signing_key:Buffer.from(KeyPair.fromString(publisher.secret_key).getPublicKey().data).toString('hex'),transport:'https',signature_required:true};
writeFileSync(manifestPath,JSON.stringify(config,null,2));
if(!existsSync(privateRoot+'/cloudflared')&&existsSync(root+'/.local/v4/cloudflared'))copyFileSync(root+'/.local/v4/cloudflared',privateRoot+'/cloudflared');
chmodSync(privateRoot+'/cloudflared',0o700);
const envFile=privateRoot+'/services.env';let env=readFileSync(envFile,'utf8');
if(!/^NEAR_AI_API_KEY=/m.test(env)){
 const source=readFileSync('/root/sealwork-next/.env.local','utf8'),line=source.match(/^NEAR_AI_API_KEY=(.+)$/m);
 if(!line)throw new Error('SPONSORED_INFERENCE_KEY_UNAVAILABLE');
 env+='NEAR_AI_API_KEY='+line[1]+'\nACH_AI_MODEL=z-ai/glm-5.3-flash\n';writeFileSync(envFile,env,{mode:0o600});
}
for(const kind of ['research','visual','audit'])for(const purpose of ['storage','ingress']){
 const file=privateRoot+'/'+kind+'-'+purpose+'.key';if(!existsSync(file))writeFileSync(file,randomBytes(32).toString('hex'),{mode:0o600,flag:'wx'});
}
const pidFile=privateRoot+'/supervisor.pid';
spawnSync('systemctl',['--user','stop','ach-v4.service'],{encoding:'utf8'});
for(const name of readdirSync('/proc')){if(!/^\d+$/.test(name)||Number(name)===process.pid)continue;try{const cwd=readlinkSync('/proc/'+name+'/cwd'),cmd=readFileSync('/proc/'+name+'/cmdline','utf8');if(cwd===root&&/\bservices\/(?:supervisor|gateway|agents\/main|demo\/main|coordinator\/main)\.mjs/.test(cmd))process.kill(Number(name),'SIGTERM');}catch{}}
await new Promise(resolve=>setTimeout(resolve,1800));
// The coordinator's scoped key must cover the prepaid gas ceiling, even
// though actual gas consumed by a round is much smaller. Stop all writers
// before replacing its allowance and reconcile pre-inclusion proposals.
const coordinatorIdentity=JSON.parse(readFileSync(privateRoot+'/coordinator.json','utf8'));
const coordinatorOwner=JSON.parse(readFileSync(privateRoot+'/coordinator-owner.json','utf8'));
const provider=new V4RpcProvider(config.rpc_urls??config.rpc_url);
const coordinatorKey=KeyPair.fromString(coordinatorIdentity.secret_key).getPublicKey();
const access=await provider.viewAccessKey({accountId:coordinatorIdentity.account_id,publicKey:coordinatorKey,finalityQuery:{finality:'final'}});
if(BigInt(access.permission.FunctionCall?.allowance??'0')<200_000_000_000_000_000_000_000n){
 const recoveryStore=new StateStore(privateRoot+'/coordinator.sqlite');
 try{
  for(const session of recoveryStore.pendingSessions())for(const job of recoveryStore.jobs(session.id)){
   if(!job.id.startsWith('clear-')||!job.round_id||job.payload.privacy==='encrypted')continue;
   const op=await recoveryStore.get('round:'+job.round_id);if(!op||!['SIGNED','UNKNOWN'].includes(op.state))continue;
   let absent=false;
   try{await provider.viewTransactionStatus({txHash:op.tx_hash,accountId:op.signer_id,waitUntil:'NONE'});}catch(error){absent=v4UnknownTransaction(error);}
   if(!absent)continue;
   try{await provider.callFunction({contractId:config.vault,method:'get_round',args:{id:job.round_id},blockQuery:{finality:'final'}});continue;}catch(error){if(!String(error.message).includes('ROUND_NOT_FOUND'))throw error;}
   op.state='FAILED';op.error='PRE_INCLUSION_ALLOWANCE_REJECTION';await recoveryStore.put(op);
   job.attempt=(job.attempt??0)+1;delete job.round_id;delete job.error;job.state='WAITING';job.retry_at_ms=Date.now();recoveryStore.saveJob(job);
  }
  await durableActions(new Account(coordinatorOwner.account_id,provider,coordinatorOwner.secret_key),recoveryStore,'coordinator-operating-allowance-v4',coordinatorIdentity.account_id,[actions.deleteKey(coordinatorKey),actions.addFunctionCallAccessKey(coordinatorKey,config.vault,['propose_round','settle_round','expire_round','release_stale_round','expire_private_request'],1_000_000_000_000_000_000_000_000n)]);
 }finally{recoveryStore.close();}
}
if(existsSync(pidFile)){const pid=Number(readFileSync(pidFile,'utf8'));try{const cmd=readFileSync('/proc/'+pid+'/cmdline','utf8');if(cmd.includes('/services/supervisor.mjs'))process.kill(pid,'SIGTERM');}catch{}}
const unitDir='/root/.config/systemd/user';mkdirSync(unitDir,{recursive:true});
writeFileSync(unitDir+'/ach-v4.service','[Unit]\nDescription=ACH v4 clearing coordinator, sponsored demo and independent agents\nAfter=network-online.target\n\n[Service]\nType=simple\nWorkingDirectory='+root+'\nEnvironmentFile='+envFile+'\nExecStart='+process.execPath+' '+root+'/services/supervisor.mjs\nRestart=always\nRestartSec=2\nKillMode=control-group\n\n[Install]\nWantedBy=default.target\n');
for(const args of [['--user','daemon-reload'],['--user','enable','--now','ach-v4.service'],['--user','restart','ach-v4.service']]){const r=spawnSync('systemctl',args,{encoding:'utf8'});if(r.status!==0)throw new Error('DURABLE_USER_SERVICE_INSTALLATION_FAILED');}
for(let attempt=0;attempt<30;attempt++){
 const health=await Promise.all(Object.values(config.services).map(async base=>{try{return(await fetch(new URL('/health',base),{signal:AbortSignal.timeout(2000)})).ok;}catch{return false;}}));
 if(health.every(Boolean)){console.log(JSON.stringify({services:'healthy',independent_signing_processes:3,durable_storage:true,sponsor_charges_visitor:false,repository_pushed:false}));break;}
 if(attempt===29)throw new Error('SERVICE_STARTUP_UNVERIFIED');await new Promise(resolve=>setTimeout(resolve,1000));
}
