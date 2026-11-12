import assert from 'node:assert/strict';
import {readFileSync,writeFileSync,existsSync}from 'node:fs';
import {randomBytes}from 'node:crypto';
import {spawnSync}from 'node:child_process';
import {JsonRpcProvider}from '../../packages/client/dist/near.js';
import {v4Digest,V4RpcProvider}from '../../packages/client/dist/v4.js';
import path from 'node:path';
import {privatePath,manifestPath,loadPrivateEnvironment}from '../../services/lib/paths.mjs';
import {requireServiceLayout}from '../../services/lib/workflow.mjs';
loadPrivateEnvironment();
if(process.argv.includes('--gas')){await import('./gas.mjs');process.exit(0);}
if(process.argv.includes('--restart-services')){
 const restart=spawnSync(process.execPath,['scripts/v4/services.mjs'],{stdio:'inherit',env:process.env});
 if(restart.error||restart.status!==0)throw new Error('LIVE_RECOVERY_RESTART_FAILED');
}
const config=JSON.parse(readFileSync(manifestPath,'utf8')),base=config.services.coordinator,serviceToken=process.env.ACH_V4_SERVICE_TOKEN,provider=new V4RpcProvider(config.rpc_urls??config.rpc_url);
const save=(p,v)=>writeFileSync(p,JSON.stringify(v,null,2),{mode:0o600});
if(process.argv.includes('--rpc-diagnose')){
 for(const method of ['account','config','backing'])try{
  const value=method==='account'?await provider.viewAccount({accountId:config.vault,blockQuery:{finality:'final'}}):await provider.callFunction({contractId:config.vault,method:method==='config'?'get_config':'get_backing_status',args:{},blockQuery:{finality:'final'}});
  console.log(JSON.stringify({phase:'rpc-diagnostic',method,rpc:config.rpc_url,passed:true,code_hash:value.code_hash??null}));
 }catch(e){console.log(JSON.stringify({phase:'rpc-diagnostic',method,rpc:config.rpc_url,passed:false,cause:e.cause,message:String(e.message).slice(0,350)}));}
 process.exit(0);
}
const evidenceFile=path.join(path.dirname(manifestPath),'live.json'),evidence=existsSync(evidenceFile)?JSON.parse(readFileSync(evidenceFile,'utf8')):{};
async function request(path,body,token){const r=await fetch(new URL(path,base),{method:body===undefined?'GET':'POST',headers:{'Content-Type':'application/json','x-ach-service-token':serviceToken,...(token?{Authorization:'Bearer '+token}:{})},...(body===undefined?{}:{body:JSON.stringify(body)}),signal:AbortSignal.timeout(30000)});const value=await r.json();if(!r.ok)throw new Error(value.error??'LIVE_SERVICE_UNAVAILABLE');return value;}
async function until(read,ready,phase,limit=180){for(let n=0;n<limit;n++){try{const value=await read();if(ready(value))return value;if(value.jobs?.some(j=>j.state==='FAILED'))throw new Error('LIVE_JOB_FAILED:'+value.jobs.find(j=>j.state==='FAILED').error);}catch(error){if(error.message.startsWith('LIVE_JOB_FAILED:')||!/UNAVAILABLE|fetch failed|TIMEOUT|rate limit|429/i.test(error.message))throw error;const delay=Number(error.message.match(/retry after (\d+) seconds/i)?.[1]??0);if(delay)await new Promise(resolve=>setTimeout(resolve,Math.min(30000,delay*1000)));if(n%20===0)console.log(JSON.stringify({phase,state:'read-retry'}));}if(n%20===0)console.log(JSON.stringify({phase,state:'waiting'}));await new Promise(resolve=>setTimeout(resolve,1000));}throw new Error('LIVE_TIMEOUT:'+phase);}
async function session(filename,tag){
 let owned;if(existsSync(filename))owned=JSON.parse(readFileSync(filename,'utf8'));else{owned=await request('/session',{ip_hash:v4Digest('ach-release:'+tag+':'+new Date().toISOString().slice(0,10))});owned.seed=randomBytes(16).toString('hex');save(filename,owned);}
 await until(()=>request('/snapshot',undefined,owned.token),s=>s.session.state==='READY','sponsored-wallets',480);
 return owned;
}
async function backing(){const[ledger,actual,account]=await Promise.all([provider.callFunction({contractId:config.vault,method:'get_backing_status',args:{},blockQuery:{finality:'final'}}),provider.callFunction({contractId:config.token,method:'ft_balance_of',args:{account_id:config.vault},blockQuery:{finality:'final'}}),provider.viewAccount({accountId:config.vault,blockQuery:{finality:'final'}})]);assert.equal(account.code_hash,config.code_hash);assert.equal(ledger.tracked_token_custody,actual);assert.equal(ledger.claims_equal_tracked_custody,true);return{actual_token_custody:actual,total_balances:ledger.total_balances,pending_withdrawals:ledger.pending_withdrawals,code_hash:account.code_hash};}
async function publicFlow(){
 const owned=await session(privatePath('live-public-session.json'),'public'),token=owned.token,id=owned.seed;
 await request('/run',{request_id:id,brief:'Create an audited, sourced chart of these agent service workloads.',mode:'report',budget:'300000',privacy:'public',data:[{label:'Research calls',value:120},{label:'Visual tasks',value:85},{label:'Audit tasks',value:64}]},token);
 const delivered=await until(()=>request('/snapshot',undefined,token),s=>s.jobs.some(j=>j.id==='run-'+id&&j.state==='COMPLETE'),'actual-ai-services');
 const artifact=delivered.jobs.find(j=>j.id==='run-'+id).result;assert.equal(artifact.planner.kind,'llm');assert.equal(artifact.chart.audit.valid,true);assert.ok(artifact.planner.response_id);
 const billIds=artifact.bills.map(i=>i.spec.id),roundId=v4Digest(id+':clear').slice(0,32);
 if(!delivered.rounds.some(r=>r.status==='SETTLED'&&billIds.every(i=>r.input.invoice_ids.includes(i))))await request('/clear',{request_id:roundId,selected_accounts:delivered.session.participants.map(p=>p.account_id),invoice_ids:billIds},token);
 const settled=await until(()=>request('/snapshot',undefined,token),s=>s.rounds.some(r=>r.status==='SETTLED'&&billIds.every(i=>r.input.invoice_ids.includes(i))),'atomic-public-clearing');
 const round=settled.rounds.find(r=>r.status==='SETTLED'&&billIds.every(i=>r.input.invoice_ids.includes(i)));assert.equal(round.gross_invoice_volume,'280000');assert.equal(round.net_settlement_volume,'20000');
 const audit=settled.session.participants.find(p=>p.kind==='audit'),withdrawId=v4Digest(id+':withdraw').slice(0,32),withdrawal=await request('/withdraw',{request_id:withdrawId,account_id:audit.account_id,amount:'20000'},token);
 assert.equal(withdrawal.withdrawal.status,'COMPLETED');const receipt=await provider.callFunction({contractId:config.token,method:'ft_balance_of',args:{account_id:audit.account_id},blockQuery:{finality:'final'}});assert.equal(receipt,'20000');
 const oneId=v4Digest(id+':oneway').slice(0,32);
 await request('/run',{request_id:oneId,brief:'Create a simple chart only, without purchasing an audit.',mode:'chart',budget:'100000',privacy:'public',data:[{label:'Agent calls',value:42},{label:'Agent reviews',value:31}]},token);
 const one=await until(()=>request('/snapshot',undefined,token),s=>s.jobs.some(j=>j.id==='run-'+oneId&&j.state==='COMPLETE'),'one-way-service');
 const oneBills=one.jobs.find(j=>j.id==='run-'+oneId).result.bills.map(i=>i.spec.id);
 await request('/clearing-policy',{mode:'automatic'},token);
 const oneSettled=await until(()=>request('/snapshot',undefined,token),s=>s.rounds.some(r=>r.status==='SETTLED'&&oneBills.every(i=>r.input.invoice_ids.includes(i))),'bounded-one-way-clearing');
 const oneRound=oneSettled.rounds.find(r=>r.status==='SETTLED'&&oneBills.every(i=>r.input.invoice_ids.includes(i)));assert.equal(oneRound.gross_invoice_volume,'100000');assert.equal(oneRound.net_settlement_volume,'100000');
 return{session_id:owned.session.id,actual_llm:{provider:artifact.planner.provider,model:artifact.planner.model,response_id:artifact.planner.response_id,response_hash:artifact.planner.response_hash},artifact_sha256:artifact.chart.sha256,public_round:round,withdrawal,one_way_round:oneRound,backing:await backing()};
}
if(process.argv.includes('--diagnose')){
 const[{Coordinator},{StateStore},{loadIdentity},{serviceFetch}]=await Promise.all([import('../../services/coordinator/coordinator.mjs'),import('../../services/lib/store.mjs'),import('../../services/lib/config.mjs'),import('../../services/lib/http.mjs')]);
 const store=new StateStore(privatePath('coordinator.sqlite')),identity=loadIdentity(privatePath('coordinator.json'),config,store);
 const coordinator=new Coordinator({store,config,getClient:async()=>identity.client,agents:{privateSummary:(kind,s)=>serviceFetch(config.services[kind],serviceToken)('/private-summary',{session_id:s.id})},sponsor:{}});
 try{const own=JSON.parse(readFileSync(privatePath('live-public-session.json'),'utf8'));const current=store.session(own.session.id);console.log(JSON.stringify({phase:'snapshot-rpc-binding',url:identity.transport.provider.connection.url}));
 for(const id of current.round_ids??[]){try{const r=await identity.client.round(id);console.log(JSON.stringify({phase:'round-diagnostic',id,state:r.status}));}catch(e){console.log(JSON.stringify({phase:'round-diagnostic',id,error_type:e.name,cause:e.cause,message:String(e.message).slice(0,160),codes:e.message.match(/\b[A-Z][A-Z_\d]{5,}\b/g)}));}}
 const snapshot=await coordinator.snapshot(current);console.log(JSON.stringify({phase:'snapshot-diagnostic',encoded_bytes:Buffer.byteLength(JSON.stringify(snapshot)),balances:snapshot.balances.length,invoices:snapshot.invoices.length,rounds:snapshot.rounds.map(r=>({id:r.input.id,state:r.status})),private_invoices:snapshot.private_invoices.length}));}
 catch(error){console.log(JSON.stringify({phase:'snapshot-diagnostic',error_type:error.name,cause:error.cause,message:String(error.message).slice(0,160),codes:error.message.match(/\b[A-Z][A-Z_\d]{5,}\b/g),stack:error.stack.split('\n').filter(l=>/^\s+at /.test(l)).slice(0,3)}));process.exitCode=1;}
 finally{store.close();}process.exit();
}
if(process.argv.includes('--verify-only')){
 const verified={kind:'independent-final-backing',vault:config.vault,token:config.token,network:config.network,...await backing(),passed:true,finished_at:new Date().toISOString(),repository_pushed:false};
 const outputIndex=process.argv.indexOf('--verification-output');
 if(outputIndex>=0){const filename=process.argv[outputIndex+1];assert.ok(filename&&!filename.startsWith('--'),'VERIFICATION_OUTPUT_REQUIRED');save(filename,verified);}
 console.log(JSON.stringify({phase:'independent-final-backing',...verified}));process.exit(0);
}
requireServiceLayout(config);
if(!evidence.public_flow||evidence.code_hash!==config.code_hash){console.log(JSON.stringify({phase:'live-public-workflow',vault:config.vault}));evidence.public_flow=await publicFlow();evidence.code_hash=config.code_hash;save(evidenceFile,evidence);}
if(!process.argv.includes('--public-only')&&(!evidence.private_flow||evidence.private_flow.backing.code_hash!==config.code_hash)){
 const{runPrivateLive}=await import('./private-live.mjs');console.log(JSON.stringify({phase:'live-private-workflow',vault:config.vault}));evidence.private_flow=await runPrivateLive({config,request,session,until,provider,backing});save(evidenceFile,evidence);
}
console.log(JSON.stringify({public_flow:'passed',real_ai:true,gross_units:'280000',net_units:'20000',withdrawal_verified:true,one_way_verified:true,repository_pushed:false}));
if(evidence.private_flow)console.log(JSON.stringify({private_flow:'passed',real_outlayer:true,receipt_amounts_opaque:true,padded_ciphertext:true,exact_group_disclosure:true,private_round_net_units:'20000',unauthorized_and_tampered_rejected:true,timeout_recovery_verified:true}));
