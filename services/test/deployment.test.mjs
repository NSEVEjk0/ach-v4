import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,readFileSync,readdirSync,rmSync,statSync,writeFileSync,existsSync}from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {once}from 'node:events';
import {serviceLayout,requireServiceLayout,requireIdentityAccount,sessionAccountId,deploymentStorageShortfall,storageFundedDeploymentId}from '../lib/workflow.mjs';
import {isNamespaceSupervisor,requireAvailableServicePorts,spawnLogged}from '../lib/process.mjs';
import {requireCorrectionEvidence,requireCorrectedBrowserEvidence}from '../lib/release.mjs';
import {sourceFingerprint}from '../../scripts/v4/source.mjs';

function candidate(suffix='1234abcd'){
 const plan={workflow_revision:2,network:'testnet',root:`ach-v4r2-demo-${suffix}.testnet`,vault:`ach-vault-v4r2-${suffix}.testnet`,token:`ach-usdc-v4r2-${suffix}.testnet`};
 const layout=serviceLayout(plan);
 return{...plan,coordinator_id:`desk.${plan.root}`,service_layout:{unit:layout.unit,ports:layout.ports},services:layout.services};
}

test('deployment funding includes code, initial state and gas at the current protocol storage price',()=>{
 const native=10n**24n,price=10n**19n,account={amount:10n*native,storage_usage:182};
 const required=1013274n*price+native/10n;
 assert.equal(deploymentStorageShortfall(account,1003092,price),required-account.amount);
 assert.equal(deploymentStorageShortfall({...account,amount:11n*native},1003092,price),0n);
 assert.equal(deploymentStorageShortfall({...account,amount:0n},1003092,2n*price),1013274n*2n*price+native/10n);
 for(const [chain,size,cost]of [[{...account,amount:-1n},1003092,price],[{...account,storage_usage:NaN},1003092,price],[account,Infinity,price],[account,1003092,undefined],[account,1003092,0n]])assert.throws(()=>deploymentStorageShortfall(chain,size,cost),/DEPLOYMENT_STORAGE_DATA_REQUIRED/);
});

test('a deployment retry preserves the failed operation and requires its final account-specific storage failure',()=>{
 const accountId=candidate().vault,operation={id:'deploy:vault:hash',tx_hash:'original-hash',state:'FAILED'};
 const status={final_execution_status:'FINAL',status:{Failure:{ActionError:{kind:{LackBalanceForState:{account_id:accountId,amount:'98518117797138800000000'}}}}}};
 assert.equal(storageFundedDeploymentId(operation,status,accountId),operation.id+':storage-funded');
 assert.equal(operation.state,'FAILED');assert.equal(operation.tx_hash,'original-hash');
 for(const altered of [{...status,final_execution_status:'EXECUTED'}, {...status,status:{SuccessValue:''}}, {...status,status:{Failure:{ActionError:{kind:{AccountAlreadyExists:{account_id:accountId}}}}}}, {...status,status:{Failure:{ActionError:{kind:{LackBalanceForState:{account_id:'other.testnet',amount:'1'}}}}}}])assert.throws(()=>storageFundedDeploymentId(operation,altered,accountId),/FINAL_DEPLOYMENT_STORAGE_FAILURE_REQUIRED/);
 assert.throws(()=>storageFundedDeploymentId({...operation,state:'UNKNOWN'},status,accountId),/FINAL_DEPLOYMENT_STORAGE_FAILURE_REQUIRED/);
});

test('candidate ports, units and runtime endpoints are tied to the exact fresh account namespace',()=>{
 const config=candidate(),other=candidate('1234abce'),layout=requireServiceLayout(config);
 assert.equal(layout.unit,'ach-v4r2-1234abcd.service');
 assert.equal(new Set(Object.values(layout.ports)).size,5);
 assert.ok(Object.values(layout.ports).every(port=>Number.isInteger(port)&&port>=30000&&port<=49999&&![4180,4181,4191,4192,4193,52180].includes(port)));
 assert.notEqual(layout.unit,other.service_layout.unit);
 assert.ok(Object.values(other.service_layout.ports).every(port=>!Object.values(layout.ports).includes(port)));
 for(const altered of [{...config,root:'ach-v4-demo-650fb521.testnet'},{...config,service_layout:other.service_layout},{...config,services:{...config.services,demo:'http://127.0.0.1:4181'}},{...config,services:{...config.services,audit:'https://attacker.test'}},{...config,services:{...config.services,extra:'http://127.0.0.1:1'}},{...config,coordinator_id:'desk.ach-v4r2-demo-ffffffff.testnet'}])assert.throws(()=>requireServiceLayout(altered),/FRESH_ACH_TESTNET|ISOLATED_SERVICE_NAMESPACE/);
 for(const[role,account_id]of Object.entries({root:config.root,vault:config.vault,token:config.token,coordinator:config.coordinator_id,publisher:`gate.${config.root}`})){const identity={account_id};assert.equal(requireIdentityAccount(config,role,identity),identity);assert.throws(()=>requireIdentityAccount(config,role,{account_id:role+'.ach-v4-demo-650fb521.testnet'}),/IDENTITY_ACCOUNT_NAMESPACE_MISMATCH/);}
 for(const kind of ['research','visual','audit'])assert.equal(sessionAccountId(config,'a'.repeat(32),kind),`${kind[0]}-${'a'.repeat(12)}.${config.root}`);
 for(const[id,kind]of [['../other','research'],['a'.repeat(32),'coordinator'],['A'.repeat(32),'audit']])assert.throws(()=>sessionAccountId(config,id,kind),/SESSION_IDENTITY_SCOPE_REQUIRED/);
});

test('candidate startup rejects occupied ports and unavailable listener permission before continuing',async()=>{
 const config=candidate(),occupied=config.service_layout.ports.visual;
 let reachedStart=false;
 await assert.rejects(async()=>{await requireAvailableServicePorts(config,async port=>port!==occupied);reachedStart=true;},/ISOLATED_SERVICE_PORT_IN_USE:visual/);
 assert.equal(reachedStart,false);
 await assert.rejects(requireAvailableServicePorts(config,async()=>{throw new Error('SERVICE_PORT_PREFLIGHT_FAILED');}),/SERVICE_PORT_PREFLIGHT_FAILED/);
 assert.deepEqual(await requireAvailableServicePorts(config,async()=>true),serviceLayout(config));
});

test('a supervisor PID from another namespace or a partial command match cannot authorize termination',()=>{
 const namespace={repoRoot:'/root/ach-v4',privateRoot:'/root/ach-v4/.local/candidate-a',manifestPath:'/root/ach-v4/.local/candidate-a/deployment.json'};
 const inspected={cwd:namespace.repoRoot,args:[process.execPath,namespace.repoRoot+'/services/supervisor.mjs'],environment:{ACH_V4_PRIVATE_ROOT:namespace.privateRoot,ACH_V4_MANIFEST:namespace.manifestPath}};
 assert.equal(isNamespaceSupervisor(inspected,namespace),true);
 for(const altered of [{...inspected,cwd:'/root/ach'},{...inspected,args:[process.execPath,namespace.repoRoot+'/services/supervisor.mjs.backup']},{...inspected,environment:{...inspected.environment,ACH_V4_PRIVATE_ROOT:'/root/ach-v4/.local/candidate-b'}},{...inspected,environment:{...inspected.environment,ACH_V4_MANIFEST:'/root/ach-v4/.local/other-deployment/deployment.json'}},{...inspected,environment:{}}])assert.equal(isNamespaceSupervisor(altered,namespace),false);
});

test('loading a service environment cannot redirect children to another deployment namespace',async()=>{
 const directory=mkdtempSync(path.join(os.tmpdir(),'ach-environment-scope-')),manifest=path.join(directory,'deployment.json');
 const source=`import {writeFileSync}from 'node:fs';const paths=await import(${JSON.stringify(new URL('../lib/paths.mjs',import.meta.url).href)});paths.loadPrivateEnvironment();writeFileSync(process.env.ACH_TEST_NAMESPACE_RESULT,JSON.stringify({root:paths.privateRoot,manifest:paths.manifestPath,child_root:process.env.ACH_V4_PRIVATE_ROOT,child_manifest:process.env.ACH_V4_MANIFEST}),{mode:0o600,flag:'wx'});`;
 const env={...process.env};delete env.ACH_V4_PRIVATE_ROOT;delete env.ACH_V4_MANIFEST;
 let attempt=0;
 const run=async(root,selectedManifest)=>{const index=attempt++,resultFile=path.join(directory,'result-'+index+'.json'),logPath=path.join(directory,'child-'+index+'.log');writeFileSync(path.join(directory,'services.env'),`ACH_V4_PRIVATE_ROOT=${root}\nACH_V4_MANIFEST=${selectedManifest}\n`,{mode:0o600});const child=spawnLogged(process.execPath,['--input-type=module','-e',source,'--','--private-root',directory],{env:{...env,ACH_TEST_NAMESPACE_RESULT:resultFile},logPath});const[status,signal]=await once(child,'close');assert.equal(signal,null);return{status,evidence:existsSync(resultFile)?JSON.parse(readFileSync(resultFile,'utf8')):null,log:readFileSync(logPath,'utf8')};};
 try{
  const valid=await run(directory,manifest);assert.equal(valid.status,0,valid.log);assert.deepEqual(valid.evidence,{root:directory,manifest,child_root:directory,child_manifest:manifest});
  for(const[root,selectedManifest]of [[directory+'-other',manifest],[directory,manifest+'.other']]){const rejected=await run(root,selectedManifest);assert.notEqual(rejected.status,0);assert.match(rejected.log,/SERVICE_ENVIRONMENT_NAMESPACE_MISMATCH/);assert.equal(rejected.evidence,null);}
 }finally{rmSync(directory,{recursive:true,force:true});}
});

test('repeated subprocess restarts preserve append logs and close every parent log descriptor',async()=>{
 const directory=mkdtempSync(path.join(os.tmpdir(),'ach-supervisor-')),logPath=path.join(directory,'agent.log');
 try{
  const before=readdirSync('/proc/self/fd').length;
  for(let index=0;index<12;index++){
   const child=spawnLogged(process.execPath,['-e',`process.stdout.write('out-${index}\\n');process.stderr.write('err-${index}\\n')`],{logPath});
   const[code]=await once(child,'close');assert.equal(code,0);
  }
  const lines=readFileSync(logPath,'utf8').trim().split('\n');assert.equal(lines.length,24);
  for(let index=0;index<12;index++){assert.ok(lines.includes(`out-${index}`));assert.ok(lines.includes(`err-${index}`));}
  assert.equal(statSync(logPath).mode&0o777,0o600);
  assert.equal(readdirSync('/proc/self/fd').length,before);
  assert.throws(()=>spawnLogged(42,[],{logPath}),/type string/);
  assert.equal(readdirSync('/proc/self/fd').length,before);
 }finally{rmSync(directory,{recursive:true,force:true});}
});

test('a corrected release cannot reuse historical flaw-reproduction evidence, failed checks or changed source',()=>{
 const sources=Object.fromEntries(['contracts/ach-v4/src/lib.rs','contracts/ach-v4/src/purchases.rs','services/agents/runtime.mjs','services/agents/planner.mjs','services/agents/main.mjs','services/lib/store.mjs','services/lib/workflow.mjs','services/lib/process.mjs','services/lib/paths.mjs','services/demo/sponsor.mjs','services/coordinator/coordinator.mjs','services/coordinator/main.mjs','services/gateway.mjs','scripts/v4/browser.mjs','scripts/v4/build.mjs','scripts/v4/services.mjs','scripts/v4/source.mjs','web/components/v4/AgentWorkspace.tsx','web/app/api/v4/[...path]/route.ts'].map(filename=>[filename,'a'.repeat(64)]));
 const suites=['rust-workspace','services','actual-wasm','client','intents','security-ui-proxy','core','agent-test-file'].map(suite=>({suite,passed:1,failed:0,exit_code:0}));
 const manifest={artifacts:{vault:{sha256:'b'.repeat(64)}}},review={workflow_revision:2,workflow_fixes_implemented:true,live_attacks_executed:false,automated_tests_passed:8,suites,source_sha256:sources,artifacts:[{name:'vault',sha256:'b'.repeat(64)}]};
 assert.equal(requireCorrectionEvidence(review,manifest,sources),review);
 for(const filename of ['scripts/v4/source.mjs','services/coordinator/main.mjs']){
  assert.throws(()=>requireCorrectionEvidence(review,manifest,{...sources,[filename]:'c'.repeat(64)}),/CURRENT_CORRECTED_WORKFLOW_EVIDENCE_REQUIRED/);
  const missing={...sources};delete missing[filename];
  assert.throws(()=>requireCorrectionEvidence(review,manifest,missing),/CURRENT_CORRECTED_WORKFLOW_EVIDENCE_REQUIRED/);
 }
 for(const altered of [{...review,workflow_fixes_implemented:false,financial_fixes_implemented:false},{...review,workflow_revision:1},{...review,automated_tests_passed:9},{...review,suites:suites.map((suite,index)=>index===1?{...suite,failed:1,exit_code:1}:suite)},{...review,source_sha256:{...sources,'services/agents/planner.mjs':'c'.repeat(64)}},{...review,source_sha256:{}},{...review,artifacts:[{name:'vault',sha256:'c'.repeat(64)}]}])assert.throws(()=>requireCorrectionEvidence(altered,manifest,sources),/CURRENT_CORRECTED_WORKFLOW_EVIDENCE_REQUIRED/);
 const browser={passed:true,checks:['live-third-identical-brief','live-fresh-workspace-work-and-clearing','live-workspace-switch-preserves-history-and-private-results'].map(name=>({name}))};
 assert.equal(requireCorrectedBrowserEvidence(browser,{hostedJourney:true}),browser);
 for(const altered of [{...browser,passed:false},{...browser,checks:browser.checks.slice(1)},{...browser,workflow_findings:[{id:'W06'}]},{...browser,workflow_findings:'invalid'}])assert.throws(()=>requireCorrectedBrowserEvidence(altered,{hostedJourney:true}),/CURRENT_CORRECTED_BROWSER_EVIDENCE_REQUIRED/);
 const context={commit:'a'.repeat(40),dirty:false},fingerprint=sourceFingerprint(context);
 assert.equal(fingerprint.repository_pushed,false);
 const publication={verified:true,repository:'NSEVEjk0/ach-v4',commit:context.commit,fingerprint_sha256:fingerprint.fingerprint_sha256,verified_at:new Date().toISOString()};
 assert.equal(sourceFingerprint({...context,publication}).repository_pushed,true);
 for(const altered of [{...publication,commit:'b'.repeat(40)},{...publication,fingerprint_sha256:'c'.repeat(64)},{...publication,verified:false},{...publication,repository:'another/project'}])assert.throws(()=>sourceFingerprint({...context,publication:altered}),/PUBLISHED_SOURCE_CONTEXT_MISMATCH/);
 assert.throws(()=>sourceFingerprint({...context,dirty:true,publication}),/PUBLISHED_SOURCE_CONTEXT_MISMATCH/);
});
