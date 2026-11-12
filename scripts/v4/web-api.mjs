// Prepare Vercel's documented REST requests. Credentials and request bodies
// remain private; the caller executes the reviewed HTTPS requests separately.
import assert from 'node:assert/strict';
import {readFileSync,writeFileSync,readdirSync,mkdirSync,existsSync}from 'node:fs';
import {homedir}from 'node:os';
import {createHash}from 'node:crypto';
import path from 'node:path';
import {privatePath,manifestPath,repoRoot,loadPrivateEnvironment}from '../../services/lib/paths.mjs';
import {requireServiceLayout}from '../../services/lib/workflow.mjs';

const config=JSON.parse(readFileSync(manifestPath,'utf8')),directory=privatePath('web-redesign-release','api');
requireServiceLayout(config);
mkdirSync(directory,{recursive:true,mode:0o700});
const stateFile=path.join(directory,'state.json');
const state=existsSync(stateFile)?JSON.parse(readFileSync(stateFile,'utf8')):{vault:config.vault,code_hash:config.code_hash};
state.repository_pushed=config.source?.repository_pushed===true;
assert.equal(state.vault,config.vault,'WEB_RELEASE_NAMESPACE_MISMATCH');
const save=(name,value)=>writeFileSync(path.join(directory,name),typeof value==='string'?value:JSON.stringify(value,null,2),{mode:0o600});
const read=name=>JSON.parse(readFileSync(path.join(directory,name),'utf8'));
const record=()=>writeFileSync(stateFile,JSON.stringify(state,null,2),{mode:0o600});
const project=JSON.parse(readFileSync(path.join(repoRoot,'web/.vercel/project.json'),'utf8'));
assert.equal(project.projectId,'prj_zrf0MeNBv2Cdj76I7HK09gaCBZVa','EXPECTED_ACH_PROJECT_REQUIRED');
const scope='teamId='+encodeURIComponent(project.orgId);
const url=route=>'https://api.vercel.com'+route+(route.includes('?')?'&':'?')+scope;
const request=(name,method,route,body)=>({name,method,url:url(route),headers:path.join(directory,'request.headers'),...(body?{body:path.join(directory,body)}:{}),response:path.join(directory,name+'-response.json')});

if(process.argv.includes('--prepare')){
 loadPrivateEnvironment();
 for(const name of ['browser-local','browser-ui-fixtures']){
  const report=JSON.parse(readFileSync(privatePath(name,'report.json'),'utf8'));
  assert.ok(report.passed&&report.vault===config.vault&&report.code_hash===config.code_hash,'PASSED_CURRENT_BROWSER_JOURNEYS_REQUIRED');
 }
 const live=JSON.parse(readFileSync(path.join(path.dirname(manifestPath),'live.json'),'utf8'));
 assert.ok(live.public_flow&&live.private_flow&&live.code_hash===config.code_hash&&config.private?.private_round_verified,'LIVE_PUBLIC_AND_PRIVATE_CLEARING_REQUIRED');
 const credential=process.env.VERCEL_TOKEN??JSON.parse(readFileSync(path.join(homedir(),'.local/share/com.vercel.cli/auth.json'),'utf8')).token;
 assert.equal(typeof credential,'string','VERCEL_AUTHENTICATION_REQUIRED');
 save('request.headers','Authorization: Bearer '+credential+'\nContent-Type: application/json\n');
 const values={ACH_V4_SERVICE_TOKEN:process.env.ACH_V4_SERVICE_TOKEN,ACH_V4_DISCOVERY_URL:config.gateway.discovery_url,ACH_V4_DISCOVERY_KEY:config.gateway.signing_key,ACH_V4_NETWORK:config.network,ACH_V4_VAULT:config.vault,ACH_V4_COORDINATOR_URL:config.services.coordinator,ACH_V4_INTENTS_QUOTE_PREVIEWS:String(config.intents?.dry_quotes_enabled===true)};
 assert.ok(Object.values(values).every(Boolean),'COMPLETE_RUNTIME_CONFIGURATION_REQUIRED');
 save('environment-body.json',Object.entries(values).map(([key,value])=>({key,value,type:'encrypted',target:['preview','production'],comment:'ACH v4 verified runtime'})));
 const files=[],hashes=[],web=path.join(repoRoot,'web');
 function visit(relative){
  const full=path.join(web,relative);
  for(const entry of readdirSync(full,{withFileTypes:true})){
   if(['node_modules','.git','.local','.vercel','screenshots'].includes(entry.name)||entry.name.startsWith('.next')||entry.name.startsWith('.env')||entry.name.endsWith('.log')||entry.name==='tsconfig.tsbuildinfo')continue;
   const filename=path.join(relative,entry.name),absolute=path.join(web,filename);
   if(entry.isDirectory()){visit(filename);continue;}
   if(!entry.isFile())continue;
   const bytes=readFileSync(absolute);
   if(/\.(?:tsx?|mjs|json|css)$/.test(filename))assert.ok(!/ed25519:[1-9A-HJ-NP-Za-km-z]{85,}|\bsk-(?:proj-)?[A-Za-z0-9_-]{35,}/.test(bytes.toString()),'SOURCE_SECRET_SCAN_FAILED');
   files.push({file:'web/'+filename.split(path.sep).join('/'),data:bytes.toString('base64'),encoding:'base64'});
   hashes.push([filename,createHash('sha256').update(bytes).digest('hex')]);
  }
 }
 visit('');
 const fingerprint=createHash('sha256').update(JSON.stringify(hashes.sort(([a],[b])=>a.localeCompare(b)))).digest('hex');
 const body={name:'ach',project:project.projectId,files,projectSettings:{framework:'nextjs',rootDirectory:'web',nodeVersion:'22.x',buildCommand:'npm run build',installCommand:'npm ci',outputDirectory:null},meta:{achProtocol:'4',achVault:config.vault,achCodeHash:config.code_hash,achWebSourceSha256:fingerprint,repositoryPushed:String(state.repository_pushed)}};
 save('preview-body.json',body);save('production-body.json',{...body,target:'production'});
 state.bypass_note??='ACH v4 interface review '+new Date().toISOString();
 save('bypass-create-body.json',{generate:{note:state.bypass_note}});
 state.prepared_at=new Date().toISOString();state.web_source_sha256=fingerprint;state.source_files=files.length;record();
 textPlan();
}else if(process.argv.includes('--record-bypass')){
 const response=read('bypass-create-response.json');
 if(response.error)throw new Error('VERCEL_BYPASS_'+String(response.error.code));
 const entries=Object.entries(response.protectionBypass??{});
 const secret=entries.find(([,value])=>value.note===state.bypass_note)?.[0]??response.secret;
 assert.ok(typeof secret==='string'&&/^[A-Za-z0-9_-]{20,}$/.test(secret),'PROJECT_BYPASS_RESPONSE_REQUIRED');
 save('browser.env','ACH_V4_PREVIEW_BYPASS='+secret+'\n');
 save('bypass-revoke-body.json',{revoke:{secret,regenerate:false}});
 state.bypass_created=true;record();console.log(JSON.stringify({browser_env:path.join(directory,'browser.env'),bypass_secret_printed:false}));
}else if(process.argv.includes('--record-preview')||process.argv.includes('--record-production')){
 const phase=process.argv.includes('--record-preview')?'preview':'production',response=read(phase+'-response.json');
 if(response.error)throw new Error('VERCEL_DEPLOYMENT_'+String(response.error.code));
 const id=response.id??response.uid,host=response.url;
 assert.ok(typeof id==='string'&&typeof host==='string'&&host.endsWith('.vercel.app'),'VERCEL_DEPLOYMENT_IDENTITY_REQUIRED');
 if(state[phase]&&state[phase].id!==id){state.attempts??=[];state.attempts.push({phase,...state[phase]});}
 state[phase]={id,url:'https://'+host,created_at:new Date().toISOString()};record();textPlan();
}else if(process.argv.includes('--status')){
 const index=process.argv.indexOf('--status'),phase=process.argv[index+1]??'preview',response=read(phase+'-status-response.json');
 console.log(JSON.stringify({phase,id:response.id??response.uid,url:response.url,state:response.readyState??response.status,error_code:response.error?.code??response.errorCode??null}));
}else textPlan();

function textPlan(){
 const requests=[request('project-before','GET','/v9/projects/'+project.projectId),request('environment','POST','/v10/projects/'+project.projectId+'/env?upsert=true','environment-body.json'),request('preview','POST','/v13/deployments?forceNew=1','preview-body.json'),request('production','POST','/v13/deployments?forceNew=1','production-body.json'),request('bypass-create','PATCH','/v1/projects/'+project.projectId+'/protection-bypass','bypass-create-body.json'),request('bypass-revoke','PATCH','/v1/projects/'+project.projectId+'/protection-bypass','bypass-revoke-body.json')];
 for(const phase of ['preview','production'])if(state[phase]){
  requests.push(request(phase+'-status','GET','/v13/deployments/'+state[phase].id));
  requests.push(request(phase+'-events','GET','/v3/deployments/'+state[phase].id+'/events?direction=forward&limit=1000'));
 }
 console.log(JSON.stringify({state,requests,browser_env:state.bypass_created?path.join(directory,'browser.env'):null}));
}
