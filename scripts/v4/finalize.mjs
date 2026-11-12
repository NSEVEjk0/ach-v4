// Export verified release metadata. Browser keys, service credentials and
// private documents remain in the private deployment namespace.
import assert from 'node:assert/strict';
import {readFileSync,writeFileSync,mkdirSync,copyFileSync,existsSync} from 'node:fs';
import {createHash} from 'node:crypto';
import path from 'node:path';
import {baseEncode} from '../../packages/client/dist/near.js';
import {privatePath,manifestPath,outlayerPath,repoRoot,loadPrivateEnvironment} from '../../services/lib/paths.mjs';
import {sourceFingerprint} from './source.mjs';
import {requireServiceLayout}from '../../services/lib/workflow.mjs';
import {requireCorrectionEvidence,requireCorrectedBrowserEvidence}from '../../services/lib/release.mjs';

loadPrivateEnvironment();
const read=filename=>JSON.parse(readFileSync(filename,'utf8'));
const argument=name=>{const index=process.argv.indexOf(name);return index<0?undefined:process.argv[index+1];};
const releaseDirectory=argument('--release-directory')??'web-release';
assert.match(releaseDirectory,/^[a-z][a-z0-9-]*$/,'SAFE_RELEASE_DIRECTORY_REQUIRED');
const releasePath=(...parts)=>privatePath(releaseDirectory,...parts);
const manifest=read(manifestPath),state=read(releasePath('api','state.json'));
const digest=bytes=>createHash('sha256').update(bytes).digest('hex');
const publicUrl='https://ach-rosy.vercel.app';
assert.equal(state.vault,manifest.vault);
assert.equal(state.code_hash,manifest.code_hash);
assert.equal(state.repository_pushed,manifest.source?.repository_pushed===true,'REPOSITORY_PUBLICATION_STATE_MISMATCH');
assert.ok(state.bypass_revoked_at,'TEMPORARY_BYPASS_MUST_BE_REVOKED');

const browser=[];
const hostedDirectory=name=>releaseDirectory==='web-release'?name:releaseDirectory+'/'+name;
const browserReports=[
 ['browser-local',null],['browser-ui-fixtures',null],
 ...(releaseDirectory==='web-release'?[['browser-local-release',null]]:[]),
 [hostedDirectory('browser-preview'),state.preview.url],[hostedDirectory('browser-production'),state.production.url],
 [hostedDirectory('browser-public'),publicUrl],[hostedDirectory('browser-public-live'),publicUrl],
];
for(const [directory,expectedUrl] of browserReports){
 const filename=privatePath(directory,'report.json'),report=read(filename);
 assert.equal(report.passed,true,'PASSED_BROWSER_REPORT_REQUIRED:'+directory);
 assert.equal(report.vault,manifest.vault);assert.equal(report.code_hash,manifest.code_hash);
 if(expectedUrl)assert.equal(report.url,expectedUrl);
 if(directory===hostedDirectory('browser-public-live')){
  for(const check of ['free-browser-onboarding','live-public-work-and-clearing','browser-private-ingress','live-private-work-and-clearing','live-browser-withdrawal','live-browser-authenticated-redeposit','browser-session-isolation'])assert.ok(report.checks.some(c=>c.name===check),'HOSTED_JOURNEY_REQUIRED:'+check);
 }
 if(releaseDirectory!=='web-release'){
  assert.ok(report.text_contrast?.length,'CURRENT_TEXT_CONTRAST_REVIEW_REQUIRED:'+directory);
  assert.ok(report.text_contrast.every(scan=>scan.issues.length===0),'TEXT_CONTRAST_FAILURE:'+directory);
  assert.ok(report.started_at>=state.prepared_at||!expectedUrl,'CURRENT_HOSTED_REPORT_REQUIRED:'+directory);
 }
 assert.ok(report.workflow_findings===undefined||Array.isArray(report.workflow_findings),'VALID_BROWSER_WORKFLOW_FINDINGS_REQUIRED:'+directory);
 if(manifest.workflow_revision===2)requireCorrectedBrowserEvidence(report,{judgeJourney:directory===hostedDirectory('browser-public-live')});
 browser.push({kind:report.kind,url:report.url,checks:report.checks.length,finished_at:report.finished_at,report_sha256:digest(readFileSync(filename)),evidence_directory:directory,workflow_findings:report.workflow_findings??[]});
}
const workflowObservations=[];
const observationFile=releasePath('fresh-workflow-observation.json');
if(existsSync(observationFile)){
 const observed=read(observationFile),hosted=browser.at(-1);
 assert.equal(observed.vault,manifest.vault);
 assert.equal(observed.workflow_fixes_implemented,false);
 assert.equal(observed.net_positions_unchanged,true);
 assert.equal(digest(readFileSync(releasePath('browser-public-live','private-observed-snapshot.json'))),observed.snapshot_sha256,'HOSTED_OBSERVATION_SNAPSHOT_CHANGED');
 const finding=hosted.workflow_findings.find(f=>f.id==='W06');
 assert.ok(finding,'HOSTED_SPLIT_ROUND_FINDING_MUST_BE_DISCLOSED');
 assert.equal(finding.expected_full_group_net_units,observed.expected_full_group_net_units);
 assert.equal(finding.actual_net_units,observed.actual_settled_net_units);
 assert.equal(finding.settled_rounds,observed.settled_round_ids.length);
 assert.equal(finding.financial_effects_verified,true);
 assert.equal(observed.ready_at_ms-observed.created_at_ms,observed.wallet_setup_ms);
 workflowObservations.push({
  id:'W06',kind:observed.kind,vault:observed.vault,
  expected_full_group_net_units:observed.expected_full_group_net_units,
  actual_settled_net_units:observed.actual_settled_net_units,
  settled_rounds:observed.settled_round_ids.length,stale_full_group_rounds:observed.stale_full_round_ids.length,
  net_positions_unchanged:observed.net_positions_unchanged,
  wallet_setup_ms:observed.wallet_setup_ms,setup_waiting_events:observed.setup_waiting_events,observed_sessions:1,
  workflow_fixes_implemented:false,snapshot_sha256:observed.snapshot_sha256,browser_report_sha256:hosted.report_sha256,
 });
}
const runtime=read(releasePath('public-config.json'));
for(const name of ['vault','token','network','code_hash'])assert.equal(runtime[name],manifest[name],'HOSTED_RUNTIME_MISMATCH:'+name);
if(manifest.workflow_revision===2)assert.equal(runtime.source_pushed,manifest.source?.repository_pushed===true,'HOSTED_SOURCE_PUBLICATION_MISMATCH');
const production=read(releasePath('api','production-status-response.json'));
assert.equal(production.readyState,'READY');assert.equal(production.id,state.production.id);
assert.equal(production.meta.achWebSourceSha256,state.web_source_sha256);
if(manifest.workflow_revision===2)assert.equal(production.meta.repositoryPushed,String(state.repository_pushed),'DEPLOYMENT_SOURCE_PUBLICATION_MISMATCH');
assert.ok(production.alias?.includes(new URL(publicUrl).hostname),'PUBLIC_DOMAIN_ASSIGNMENT_REQUIRED');
const backing=read(releaseDirectory==='web-release'?privatePath('backing-final.json'):releasePath('backing-final.json'));
assert.equal(backing.passed,true);assert.equal(backing.vault,manifest.vault);assert.equal(backing.code_hash,manifest.code_hash);
assert.equal(BigInt(backing.actual_token_custody),BigInt(backing.total_balances)+BigInt(backing.pending_withdrawals));
if(releaseDirectory!=='web-release')assert.ok(backing.finished_at>=browser.at(-1).finished_at,'BACKING_CHECK_MUST_FOLLOW_HOSTED_MONEY_ACTIONS');
const services=read(privatePath('services-final.json'));
assert.equal(services.exit_code,0);assert.equal(services.failed,0);assert.equal(services.tests,services.passed);
const live=read(privatePath('live.json')),gas=read(privatePath('gas.json'));
assert.equal(live.code_hash,manifest.code_hash);assert.ok(live.public_flow&&live.private_flow);
assert.equal(gas.passed,true);assert.equal(gas.vault,manifest.vault);assert.equal(gas.code_hash,manifest.code_hash);
assert.equal(manifest.private.private_round_verified,true);
const workflowReview=read(argument('--workflow-review')??privatePath('workflow-audit','evidence.json'));
const workflowReport=argument('--workflow-report')??(manifest.workflow_revision===2?'docs/v4/security-review-20261111.md':'docs/v4/workflow-audit.md');
assert.match(workflowReport,/^docs\/v4\/[a-z0-9-]+\.md$/,'LOCAL_WORKFLOW_REPORT_REQUIRED');
assert.ok(existsSync(path.join(repoRoot,workflowReport)),'EXISTING_WORKFLOW_REPORT_REQUIRED');
if(manifest.workflow_revision===2){
 requireServiceLayout(manifest);
 const currentHashes=Object.fromEntries(Object.keys(workflowReview.source_sha256??{}).map(filename=>[filename,digest(readFileSync(path.join(repoRoot,filename)))]));
 requireCorrectionEvidence(workflowReview,manifest,currentHashes);
}else{
 assert.equal(workflowReview.live_attacks_executed,false);
 assert.equal(workflowReview.financial_fixes_implemented,false);
 assert.equal(workflowReview.tests_passed,workflowReview.additional_cases+workflowReview.commerce_regressions);
 assert.equal(workflowReview.vault_wasm_sha256,manifest.artifacts.vault.sha256);
}
for(const[filename,hash]of Object.entries(workflowReview.source_sha256))assert.equal(digest(readFileSync(path.join(repoRoot,filename))),hash,'WORKFLOW_REVIEW_SOURCE_CHANGED:'+filename);
for(const [role,artifact] of Object.entries(manifest.artifacts)){
 const bytes=readFileSync(path.resolve(repoRoot,artifact.path));assert.equal(digest(bytes),artifact.sha256,'DEPLOYED_ARTIFACT_MISMATCH:'+role);assert.equal(bytes.length,artifact.bytes);
 if(role==='vault')assert.equal(baseEncode(createHash('sha256').update(bytes).digest()),manifest.code_hash);
 if(role==='worker')assert.equal(artifact.sha256,manifest.private.hash);
}

manifest.source_at_deployment??=manifest.source;
const gitIndex=process.argv.indexOf('--git-context');
const gitContext=gitIndex<0?undefined:read(process.argv[gitIndex+1]);
const verifiedSource=sourceFingerprint(gitContext);
assert.equal(verifiedSource.repository_pushed,state.repository_pushed,'CURRENT_SOURCE_PUBLICATION_MISMATCH');
manifest.source={...verifiedSource,captured_at:new Date().toISOString()};
manifest.web={public_url:publicUrl,preview:state.preview,production:state.production,source_sha256:state.web_source_sha256,verified_at:browser.at(-1).finished_at};
manifest.verification={...manifest.verification,hosted_runtime_verified:true,hosted_public_and_private_journeys_verified:true,hosted_workflow_findings:browser.flatMap(b=>b.workflow_findings),final_backing_verified_at:backing.finished_at};
const exported=new Map([
 ['deployment.json',manifest],['outlayer.json',read(outlayerPath)],['live.json',live],['gas.json',gas],
 ['release.json',{protocol_version:4,public_url:publicUrl,vault:manifest.vault,token:manifest.token,code_hash:manifest.code_hash,source:manifest.source,web:manifest.web,browser,backing,services,workflow_review:{...workflowReview,report:workflowReport,hosted_observations:workflowObservations},limitations:{mainnet_intents_transfers_exercised:Boolean(manifest.intents.mainnet_routes_exercised),hosted_test_identities:true,upgrade_authority_remaining:manifest.custody.upgrade_authority_remaining,private_disclosure:['participant identities','net movements','timing']},repository_pushed:manifest.source.repository_pushed}],
]);
const secrets=Object.entries(process.env).filter(([name,value])=>value?.length>=16&&(name==='VERCEL_TOKEN'||/^(?:ACH_|NEAR_AI_).*(?:TOKEN|SECRET|API_KEY)$/.test(name))).map(([,value])=>value);
for(const [name,value] of exported){
 const text=JSON.stringify(value,null,2)+'\n';
 assert.ok(!/ed25519:[1-9A-HJ-NP-Za-km-z]{85,}|\bsk-(?:proj-)?[A-Za-z0-9_-]{35,}/.test(text),'PUBLIC_EVIDENCE_SECRET_SCAN_FAILED:'+name);
 assert.ok(secrets.every(secret=>!text.includes(secret)),'PUBLIC_EVIDENCE_CREDENTIAL_FOUND:'+name);
}
const destination=path.join(repoRoot,'docs','v4'),backup=releasePath('prior-public-evidence');
mkdirSync(destination,{recursive:true});mkdirSync(backup,{recursive:true,mode:0o700});
for(const [name,value] of exported){
 const target=path.join(destination,name),old=path.join(backup,name);
 if(existsSync(target)&&!existsSync(old))copyFileSync(target,old);
 writeFileSync(target,JSON.stringify(value,null,2)+'\n');
}
writeFileSync(manifestPath,JSON.stringify(manifest,null,2)+'\n');
console.log(JSON.stringify({release:'verified',public_url:publicUrl,vault:manifest.vault,hosted_journey_checks:browser.at(-1).checks,hosted_workflow_findings:browser.flatMap(b=>b.workflow_findings).length,source_files:manifest.source.file_count,mainnet_transfers_exercised:Boolean(manifest.intents.mainnet_routes_exercised),repository_pushed:manifest.source.repository_pushed}));
