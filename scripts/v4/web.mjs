import assert from 'node:assert/strict';
import {readFileSync,writeFileSync,mkdirSync,existsSync,chmodSync,mkdtempSync,copyFileSync,unlinkSync}from 'node:fs';
import {spawn,execFileSync}from 'node:child_process';
import {createPublicKey,verify}from 'node:crypto';
import {parseEnv}from 'node:util';
import path from 'node:path';
import {repoRoot,privatePath,manifestPath,loadPrivateEnvironment}from '../../services/lib/paths.mjs';
import {requireServiceLayout}from '../../services/lib/workflow.mjs';
loadPrivateEnvironment();
const config=JSON.parse(readFileSync(manifestPath,'utf8')),web=path.join(repoRoot,'web'),output=privatePath('web-release');
requireServiceLayout(config);
mkdirSync(output,{recursive:true,mode:0o700});
const stateFile=path.join(output,'deployment.json'),state=existsSync(stateFile)?JSON.parse(readFileSync(stateFile,'utf8')):{vault:config.vault,started_at:new Date().toISOString()};
state.repository_pushed=config.source?.repository_pushed===true;
assert.equal(state.vault,config.vault,'WEB_RELEASE_NAMESPACE_MISMATCH');
const save=()=>writeFileSync(stateFile,JSON.stringify(state,null,2),{mode:0o600});
async function command(args,{input,env=process.env,label=args[0],cwd=web}={}){
 console.log(JSON.stringify({phase:'web-'+label,state:'working'}));
 const result=await new Promise((resolve,reject)=>{
  const child=spawn('vercel',args,{cwd,env,stdio:['pipe','pipe','pipe']});let stdout='',stderr='';
  child.stdout.on('data',b=>stdout+=b);child.stderr.on('data',b=>stderr+=b);child.on('error',reject);
  child.on('close',code=>resolve({code,stdout,stderr}));child.stdin.end(input??'');
 });
 // CLI output remains private: it can contain deployment metadata or env names.
 writeFileSync(path.join(output,label.replaceAll(/[^a-zA-Z0-9-]/g,'-')+'.log'),result.stdout+'\n'+result.stderr,{mode:0o600});
 if(result.code!==0)throw new Error('VERCEL_COMMAND_FAILED:'+label);
 return result;
}
function deploymentSource(){
 // The project builds from web/ and installs the sibling client package.
 // Archive committed source; runtime keys, databases and local env stay private.
 const source=mkdtempSync(path.join(output,'source-')),archive=path.join(source,'web.tar');
 const commit=execFileSync('git',['rev-parse','HEAD'],{cwd:repoRoot,encoding:'utf8'}).trim();
 assert.equal(execFileSync('git',['status','--porcelain','--untracked-files=no'],{cwd:repoRoot,encoding:'utf8'}).trim(),'','COMMITTED_WEB_SOURCE_REQUIRED');
 execFileSync('git',['archive','--format=tar','--output',archive,commit],{cwd:repoRoot});
 execFileSync('tar',['-xf',archive,'-C',source]);unlinkSync(archive);
 assert.ok(existsSync(path.join(source,'web','package-lock.json')),'WEB_DEPLOYMENT_ROOT_REQUIRED');
 const link=path.join(web,'.vercel','project.json'),project=JSON.parse(readFileSync(link,'utf8'));
 assert.equal(project.projectId,'prj_zrf0MeNBv2Cdj76I7HK09gaCBZVa','EXPECTED_ACH_PROJECT_REQUIRED');
 mkdirSync(path.join(source,'.vercel'),{mode:0o700});
 copyFileSync(link,path.join(source,'.vercel','project.json'));chmodSync(path.join(source,'.vercel','project.json'),0o600);
 state.source_commit=commit;save();return source;
}
async function discovery(){
 const r=await fetch(config.gateway.discovery_url,{signal:AbortSignal.timeout(20000),cache:'no-store'});assert.ok(r.ok,'GATEWAY_DISCOVERY_UNAVAILABLE');const d=await r.json();
 assert.equal(d.protocol_version,4);assert.equal(d.vault,config.vault);assert.equal(d.network,config.network);assert.ok(d.expires_at_ms>Date.now());
 const key=createPublicKey({key:Buffer.concat([Buffer.from('302a300506032b6570032100','hex'),Buffer.from(config.gateway.signing_key,'hex')]),format:'der',type:'spki'});
 assert.ok(verify(null,Buffer.from(['ACH gateway v4',d.network,d.vault,d.url,String(d.published_at_ms),String(d.expires_at_ms)].join('\n')),key,Buffer.from(d.signature,'base64')),'GATEWAY_SIGNATURE_INVALID');
 const c=await fetch(new URL('/config',d.url),{headers:{'x-ach-service-token':process.env.ACH_V4_SERVICE_TOKEN},signal:AbortSignal.timeout(25000)});assert.ok(c.ok,'PUBLIC_GATEWAY_UNAVAILABLE');const body=await c.json();assert.equal(body.vault,config.vault);assert.equal(body.code_hash,config.code_hash);return d;
}
async function backup(){
 for(const target of ['preview','production']){
  const file=path.join(output,'rollback-'+target+'.env');if(!existsSync(file)){await command(['env','pull',file,'--environment',target,'--project','ach','--yes'],{label:'backup-'+target});chmodSync(file,0o600);}
 }
 if(!state.previous_production){const listed=await command(['project','ls','--json'],{label:'previous-production'});const json=JSON.parse(listed.stdout);const project=json.projects.find(p=>p.id==='prj_zrf0MeNBv2Cdj76I7HK09gaCBZVa');assert.ok(project,'EXPECTED_VERCEL_PROJECT_REQUIRED');state.previous_production=project.latestProductionUrl;save();}
}
async function environment(target){
 const values={ACH_V4_SERVICE_TOKEN:process.env.ACH_V4_SERVICE_TOKEN,ACH_V4_DISCOVERY_URL:config.gateway.discovery_url,ACH_V4_DISCOVERY_KEY:config.gateway.signing_key,ACH_V4_NETWORK:config.network,ACH_V4_VAULT:config.vault,ACH_V4_COORDINATOR_URL:config.services.coordinator,ACH_V4_INTENTS_QUOTE_PREVIEWS:String(config.intents?.dry_quotes_enabled===true)};
 for(const[name,value]of Object.entries(values)){
  assert.ok(value,'MISSING_WEB_RUNTIME_CONFIGURATION');
  await command(['env','add',name,target,'--project','ach','--force','--yes',name==='ACH_V4_SERVICE_TOKEN'?'--sensitive':'--no-sensitive'],{input:value,label:'configure-'+target+'-'+name.toLowerCase()});
 }
}
function deployedUrl(result){
 let value;try{value=JSON.parse(result.stdout);}catch{}
 const raw=value?.url??value?.deployment?.url??value?.deploymentUrl;
 const url=raw?(raw.startsWith('https://')?raw:'https://'+raw):result.stdout.match(/https:\/\/ach-[a-z0-9-]+\.vercel\.app/g)?.at(-1);
 assert.ok(url&&new URL(url).hostname.endsWith('.vercel.app'),'VERCEL_DEPLOYMENT_URL_REQUIRED');return url;
}
async function verifyHosted(url,protectedPreview=false){
 let r=await fetch(new URL('/api/v4/config',url),{signal:AbortSignal.timeout(60000)});
 if(protectedPreview&&[401,403].includes(r.status)){
  const res=await command(['curl','/api/v4/config','--deployment',url,'--','--fail','--silent','--show-error'],{label:'preview-config-with-protection'});
  const actual=JSON.parse(res.stdout);assert.equal(actual.vault,config.vault);assert.equal(actual.code_hash,config.code_hash);return;
 }
 assert.ok(r.ok,'HOSTED_RUNTIME_UNAVAILABLE');const actual=await r.json();assert.equal(actual.vault,config.vault);assert.equal(actual.token,config.token);assert.equal(actual.network,config.network);assert.equal(actual.code_hash,config.code_hash);
 for(const page of ['/','/workspace','/developers','/proof','/sdk/ach-client-4.0.2.tgz','/sdk/ach-client-4.0.0.tgz','/sdk/ach-intents-4.1.0.tgz','/sdk/ach-intents-4.0.0.tgz']){r=await fetch(new URL(page,url),{signal:AbortSignal.timeout(60000)});assert.ok(r.ok,'HOSTED_PAGE_UNAVAILABLE:'+page);}
}
async function browser(url,smoke=true){
 const args=['scripts/v4/browser.mjs','--url',url,'--reuse-live',...(smoke?['--smoke']:[])];
 const code=await new Promise((resolve,reject)=>{const child=spawn(process.execPath,args,{cwd:repoRoot,env:process.env,stdio:'inherit'});child.on('error',reject);child.on('close',resolve);});
 assert.equal(code,0,'HOSTED_BROWSER_VERIFICATION_FAILED');
}
try{
 await discovery();await backup();state.gateway_verified_at=new Date().toISOString();save();
 if(process.argv.includes('--prepare')){console.log(JSON.stringify({web_preparation:'passed',public_cutover:false,repository_pushed:config.source?.repository_pushed===true}));process.exit(0);}
 const live=JSON.parse(readFileSync(path.join(path.dirname(manifestPath),'live.json'),'utf8'));
 assert.ok(live.public_flow&&live.private_flow&&live.code_hash===config.code_hash,'VERIFIED_LIVE_PUBLIC_AND_PRIVATE_FLOWS_REQUIRED');
 assert.ok(config.private.private_round_verified,'VERIFIED_PRIVATE_CAPABILITY_REQUIRED');
 const local=JSON.parse(readFileSync(privatePath('browser-local','report.json'),'utf8'));assert.ok(local.passed&&local.vault===config.vault,'COMPLETE_LOCAL_BROWSER_JOURNEY_REQUIRED');
 const source=deploymentSource();
 await environment('preview');
 const preview=deployedUrl(await command(['deploy','--yes','--project','ach','--json'],{label:'preview-deploy',cwd:source}));state.preview=preview;save();await verifyHosted(preview,true);state.preview_config_verified_at=new Date().toISOString();save();
 // vercel curl retrieves the project's existing automation-bypass entry through
 // its credential store. Pull it privately for the browser, never into args.
 const previewEnvironment=path.join(output,'preview-deployment.env');await command(['env','pull',previewEnvironment,'--environment','preview','--project','ach','--yes'],{label:'preview-environment'});chmodSync(previewEnvironment,0o600);
 const bypass=parseEnv(readFileSync(previewEnvironment,'utf8')).VERCEL_AUTOMATION_BYPASS_SECRET;
 if(bypass)process.env.ACH_V4_PREVIEW_BYPASS=bypass;
 await browser(preview);state.preview_browser_verified_at=new Date().toISOString();save();
 if(process.argv.includes('--preview-only')){console.log(JSON.stringify({preview,verification:'passed',public_cutover:false,repository_pushed:config.source?.repository_pushed===true}));process.exit(0);}
 await environment('production');
 const production=deployedUrl(await command(['deploy','--prod','--skip-domain','--yes','--project','ach','--json'],{label:'production-staged-deploy',cwd:source}));state.production=production;save();await verifyHosted(production);await browser(production);state.production_browser_verified_at=new Date().toISOString();save();
 await command(['promote',production,'--yes'],{label:'production-promote'});
 await verifyHosted('https://ach-rosy.vercel.app');await browser('https://ach-rosy.vercel.app');
 state.public_url='https://ach-rosy.vercel.app';state.promoted_at=new Date().toISOString();delete state.failure;save();
 console.log(JSON.stringify({web_deployed:state.public_url,preview,exact_vault_verified:config.vault,repository_pushed:config.source?.repository_pushed===true}));
}catch(error){state.failure={type:error.name,code:error.message};save();console.error(JSON.stringify({web_deployment:'failed',reason:error.message,repository_pushed:config.source?.repository_pushed===true}));process.exitCode=1;}
