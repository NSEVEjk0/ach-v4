import {readFileSync,writeFileSync,mkdirSync,existsSync,chmodSync,readlinkSync,copyFileSync}from 'node:fs';
import {spawnSync}from 'node:child_process';
import {randomBytes}from 'node:crypto';
import {homedir}from 'node:os';
import {parseEnv}from 'node:util';
import {Account,JsonRpcProvider,KeyPair,actions}from '../../packages/client/dist/near.js';
import {StateStore}from '../../services/lib/store.mjs';import {durableActions}from '../../services/lib/transactions.mjs';
import {v4UnknownTransaction,V4RpcProvider}from '../../packages/client/dist/v4.js';
import {repoRoot as root,privateRoot,manifestPath}from '../../services/lib/paths.mjs';
import {requireServiceLayout}from '../../services/lib/workflow.mjs';
import {isNamespaceSupervisor,requireAvailableServicePorts}from '../../services/lib/process.mjs';
mkdirSync(privateRoot,{recursive:true,mode:0o700});
const config=JSON.parse(readFileSync(manifestPath,'utf8'));
const layout=requireServiceLayout(config);
if(config.network!=='testnet'||config.status!=='deployed')throw new Error('VERIFIED_TESTNET_SERVICE_CONFIGURATION_REQUIRED');
if(process.argv.includes('--inspect')){
 const listeners=spawnSync('ss',['-ltnp'],{encoding:'utf8'}),manager=spawnSync('systemctl',['--user','is-system-running'],{encoding:'utf8'});
 if(listeners.error||listeners.status!==0||manager.error||!['running','degraded'].includes(manager.stdout?.trim()))throw new Error('SERVICE_INSPECTION_FAILED');
 console.log(JSON.stringify({unit:layout.unit,ports:layout.ports,listeners:listeners.stdout.split('\n').filter(l=>Object.values(layout.ports).some(port=>l.includes(':'+port+' '))),user_service_manager:manager.stdout.trim()}));process.exit(0);
}
const rootIdentity=JSON.parse(readFileSync(privateRoot+'/root.json','utf8'));
if(rootIdentity.account_id!==config.root)throw new Error('ROOT_IDENTITY_NAMESPACE_MISMATCH');
const unitDir=homedir()+'/.config/systemd/user',unitPath=unitDir+'/'+layout.unit,envFile=privateRoot+'/services.env',pidFile=privateRoot+'/supervisor.pid';
if(!parseEnv(readFileSync(envFile,'utf8')).NEAR_AI_API_KEY?.trim())throw new Error('PLANNER_API_KEY_REQUIRED');
const quote=value=>{if(/[\0\r\n]/.test(value))throw new Error('INVALID_SERVICE_PATH');return '"'+value.replaceAll('\\','\\\\').replaceAll('"','\\"').replaceAll('%','%%')+'"';};
const unit='[Unit]\nDescription=ACH v4 revision 2 candidate services\nAfter=network-online.target\n\n[Service]\nType=simple\nWorkingDirectory='+root.replaceAll('%','%%')+'\nEnvironmentFile='+envFile.replaceAll('%','%%')+'\nExecStart='+[process.execPath,root+'/services/supervisor.mjs','--private-root',privateRoot,'--manifest',manifestPath].map(quote).join(' ')+'\nRestart=always\nRestartSec=2\nKillMode=control-group\n\n[Install]\nWantedBy=default.target\n';
function verifiedSupervisor(pid){
 if(!Number.isSafeInteger(pid)||pid<=1)throw new Error('INVALID_SUPERVISOR_PID');
 try{process.kill(pid,0);}catch(error){if(error.code==='ESRCH')return false;throw new Error('SERVICE_PROCESS_INSPECTION_FAILED');}
 const inspected={cwd:readlinkSync('/proc/'+pid+'/cwd'),args:readFileSync('/proc/'+pid+'/cmdline','utf8').split('\0'),environment:Object.fromEntries(readFileSync('/proc/'+pid+'/environ','utf8').split('\0').filter(Boolean).map(line=>{const at=line.indexOf('=');return[line.slice(0,at),line.slice(at+1)];}))};
 if(!isNamespaceSupervisor(inspected,{repoRoot:root,privateRoot,manifestPath}))throw new Error('SERVICE_PROCESS_NAMESPACE_MISMATCH');
 return true;
}
// Validate the exact candidate unit and process before touching any writer.
// There is no checkout-wide process sweep or historical ach-v4.service stop.
if(existsSync(unitPath)&&readFileSync(unitPath,'utf8')!==unit)throw new Error('SERVICE_UNIT_NAMESPACE_MISMATCH');
const manager=spawnSync('systemctl',['--user','is-system-running'],{encoding:'utf8'});
if(manager.error||!['running','degraded'].includes(manager.stdout?.trim()))throw new Error('DURABLE_USER_SERVICE_MANAGER_UNAVAILABLE');
const inspectedUnit=spawnSync('systemctl',['--user','show',layout.unit,'--property=MainPID','--property=FragmentPath','--property=LoadState'],{encoding:'utf8'});
const properties=Object.fromEntries((inspectedUnit.stdout??'').trim().split('\n').filter(Boolean).map(line=>{const at=line.indexOf('=');return[line.slice(0,at),line.slice(at+1)];}));
if(inspectedUnit.error||inspectedUnit.status!==0&&properties.LoadState!=='not-found')throw new Error('SERVICE_UNIT_INSPECTION_FAILED');
if(properties.FragmentPath&&(properties.FragmentPath!==unitPath||!existsSync(unitPath)))throw new Error('SERVICE_UNIT_NAMESPACE_MISMATCH');
const recordedPid=existsSync(pidFile)?Number(readFileSync(pidFile,'utf8')):null,mainPid=Number(properties.MainPID??'0');
const runningPid=recordedPid&&verifiedSupervisor(recordedPid)?recordedPid:null;
if(mainPid){verifiedSupervisor(mainPid);if(runningPid&&runningPid!==mainPid)throw new Error('DUPLICATE_SUPERVISOR_PROCESS');}
const validationDir=privateRoot+'/service-unit-validation';
mkdirSync(validationDir,{recursive:true,mode:0o700});
const validationPath=validationDir+'/'+layout.unit;
writeFileSync(validationPath,unit,{mode:0o600});
const validation=spawnSync('systemd-analyze',['--user','verify',validationPath],{encoding:'utf8'});
writeFileSync(validationDir+'/verify.log',(validation.stdout??'')+(validation.stderr??''),{mode:0o600});
if(validation.error||validation.status!==0||/ignoring:|fatal error|bad unit file setting/i.test(validation.stderr??''))throw new Error('CANDIDATE_SERVICE_UNIT_INVALID');
if(properties.LoadState==='loaded'){
 if(properties.FragmentPath!==unitPath||!existsSync(unitPath))throw new Error('SERVICE_UNIT_NAMESPACE_MISMATCH');
 const stopped=spawnSync('systemctl',['--user','stop',layout.unit],{encoding:'utf8'});if(stopped.error||stopped.status!==0)throw new Error('CANDIDATE_SERVICE_STOP_FAILED');
}
if(runningPid&&verifiedSupervisor(runningPid))process.kill(runningPid,'SIGTERM');
for(let attempt=0;runningPid&&verifiedSupervisor(runningPid)&&attempt<30;attempt++)await new Promise(resolve=>setTimeout(resolve,100));
await requireAvailableServicePorts(config);
const publisherFile=privateRoot+'/gateway-publisher.json';
let publisher;
if(existsSync(publisherFile))publisher=JSON.parse(readFileSync(publisherFile,'utf8'));
else{const key=KeyPair.fromRandom('ed25519');publisher={account_id:'gate.'+config.coordinator_id.split('.').slice(1).join('.'),secret_key:key.toString(),public_key:key.getPublicKey().toString(),role:'gateway-publisher'};writeFileSync(publisherFile,JSON.stringify(publisher),{mode:0o600,flag:'wx'});}
if(publisher.account_id!==`gate.${config.root}`||publisher.role!=='gateway-publisher')throw new Error('PUBLISHER_IDENTITY_NAMESPACE_MISMATCH');
const journal=new StateStore(privateRoot+'/services-deployment.sqlite');
try{await durableActions(new Account(rootIdentity.account_id,new V4RpcProvider(config.rpc_urls??config.rpc_url),rootIdentity.secret_key),journal,'create-gateway-publisher',publisher.account_id,[actions.createAccount(),actions.transfer(100_000_000_000_000_000_000_000n),actions.addFunctionCallAccessKey(KeyPair.fromString(publisher.secret_key).getPublicKey(),'outlayer.testnet',['__fastdata_fastfs'],80_000_000_000_000_000_000_000n)]);}finally{journal.close();}
config.gateway={discovery_url:'https://test.fastfs.io/'+publisher.account_id+'/outlayer.testnet/ach-v4-gateway.json',signing_key:Buffer.from(KeyPair.fromString(publisher.secret_key).getPublicKey().data).toString('hex'),transport:'https',signature_required:true};
writeFileSync(manifestPath,JSON.stringify(config,null,2));
if(!existsSync(privateRoot+'/cloudflared')&&existsSync(root+'/.local/v4/cloudflared'))copyFileSync(root+'/.local/v4/cloudflared',privateRoot+'/cloudflared');
chmodSync(privateRoot+'/cloudflared',0o700);
for(const kind of ['research','visual','audit'])for(const purpose of ['storage','ingress']){
 const file=privateRoot+'/'+kind+'-'+purpose+'.key';if(!existsSync(file))writeFileSync(file,randomBytes(32).toString('hex'),{mode:0o600,flag:'wx'});
}
// The coordinator's scoped key must cover the prepaid gas ceiling, even
// though actual gas consumed by a round is much smaller. Stop all writers
// before replacing its allowance and reconcile pre-inclusion proposals.
const coordinatorIdentity=JSON.parse(readFileSync(privateRoot+'/coordinator.json','utf8'));
const coordinatorOwner=JSON.parse(readFileSync(privateRoot+'/coordinator-owner.json','utf8'));
if(coordinatorIdentity.account_id!==config.coordinator_id||coordinatorOwner.account_id!==config.coordinator_id||coordinatorIdentity.role!=='agent'||coordinatorOwner.role!=='sponsor')throw new Error('COORDINATOR_IDENTITY_NAMESPACE_MISMATCH');
const provider=new V4RpcProvider(config.rpc_urls??config.rpc_url);
const coordinatorKey=KeyPair.fromString(coordinatorIdentity.secret_key).getPublicKey();
const access=await provider.viewAccessKey({accountId:coordinatorIdentity.account_id,publicKey:coordinatorKey,finalityQuery:{finality:'final'}});
const coordinatorMethods=['propose_round','settle_round','expire_round','release_stale_round','expire_private_request','expire_purchase_group'];
if(BigInt(access.permission.FunctionCall?.allowance??'0')<200_000_000_000_000_000_000_000n||access.permission.FunctionCall?.receiver_id!==config.vault||coordinatorMethods.some(method=>!access.permission.FunctionCall?.method_names?.includes(method))){
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
  await durableActions(new Account(coordinatorOwner.account_id,provider,coordinatorOwner.secret_key),recoveryStore,'coordinator-operating-allowance-v4r2',coordinatorIdentity.account_id,[actions.deleteKey(coordinatorKey),actions.addFunctionCallAccessKey(coordinatorKey,config.vault,coordinatorMethods,1_000_000_000_000_000_000_000_000n)]);
 }finally{recoveryStore.close();}
}
mkdirSync(unitDir,{recursive:true});writeFileSync(unitPath,unit);
for(const args of [['--user','daemon-reload'],['--user','enable',layout.unit],['--user','restart',layout.unit]]){const r=spawnSync('systemctl',args,{encoding:'utf8'});if(r.error||r.status!==0)throw new Error('DURABLE_USER_SERVICE_INSTALLATION_FAILED');}
for(let attempt=0;attempt<30;attempt++){
 const health=await Promise.all(Object.values(config.services).map(async base=>{try{return(await fetch(new URL('/health',base),{signal:AbortSignal.timeout(2000)})).ok;}catch{return false;}}));
 if(health.every(Boolean)){console.log(JSON.stringify({services:'healthy',independent_signing_processes:3,durable_storage:true,sponsor_charges_visitor:false,repository_pushed:config.source?.repository_pushed===true}));break;}
 if(attempt===29)throw new Error('SERVICE_STARTUP_UNVERIFIED');await new Promise(resolve=>setTimeout(resolve,1000));
}
