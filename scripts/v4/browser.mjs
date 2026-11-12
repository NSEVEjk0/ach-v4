import {navigateWorkspace}from './browser-fixtures.mjs';
import assert from 'node:assert/strict';
import {mkdirSync,readFileSync,writeFileSync,existsSync,mkdtempSync}from 'node:fs';
import {spawn,spawnSync}from 'node:child_process';
import {createHash}from 'node:crypto';
import {parseEnv}from 'node:util';
import path from 'node:path';
import {privateRoot,privatePath,manifestPath,repoRoot,loadPrivateEnvironment}from '../../services/lib/paths.mjs';
import {spawnLogged}from '../../services/lib/process.mjs';
import {readBrowserCheckpoint,writeBrowserCheckpoint,redactBrowserMessage,retryableBrowserRead}from './browser-state.mjs';

if(process.argv.includes('--local')){await import('./browser-local.mjs');process.exit(process.exitCode??0);}

if(process.argv.includes('--sdk-only')){
 const isolated=mkdtempSync('/tmp/ach-sdk-install-');writeFileSync(path.join(isolated,'package.json'),JSON.stringify({private:true,type:'module'}),{mode:0o600});
 const execute=(command,args,stage,filename)=>new Promise((resolve,reject)=>{
  const child=spawnLogged(command,args,{cwd:isolated,logPath:path.join(isolated,filename)});
  const timer=setTimeout(()=>{child.kill('SIGKILL');reject(new Error(stage+'_TIMEOUT'));},60000);
  child.once('error',()=>{clearTimeout(timer);reject(new Error(stage));});
  child.once('close',(code,signal)=>{clearTimeout(timer);if(code!==0||signal)reject(new Error(stage));else resolve({exit_code:code});});
 });
 const install=await execute('npm',['install','--ignore-scripts','--no-audit','--no-fund',...(process.argv.includes('--offline')?['--offline']:[]),path.join(repoRoot,'web/public/sdk/ach-client-4.0.0.tgz'),path.join(repoRoot,'web/public/sdk/ach-intents-4.0.0.tgz')],'ISOLATED_SDK_INSTALL_FAILED','install.log');
 const source='import {writeFileSync}from "node:fs";import {AchV4Client,V4NearTransport,V4RpcProvider,v4PurchaseGroupId,v4FundedInvoiceId,v4FundingGroupHash} from "@ach/client/v4";import {OwnerIntentsRouter,NearTokenRouteSender,destinationReceiptVerifier} from "@ach/intents/owner";if(![AchV4Client,V4NearTransport,V4RpcProvider,OwnerIntentsRouter,NearTokenRouteSender,destinationReceiptVerifier,v4PurchaseGroupId,v4FundedInvoiceId,v4FundingGroupHash,AchV4Client.prototype.authorizePurchaseGroup,V4NearTransport.prototype.reconcile,NearTokenRouteSender.prototype.reconcileExactQuote].every(x=>typeof x==="function"))throw new Error("MISSING_EXPORT");writeFileSync(new URL("./import-verification.json",import.meta.url),JSON.stringify({kind:"isolated-sdk-install",passed:true,node:process.version,exports:["AchV4Client","V4NearTransport","V4RpcProvider","OwnerIntentsRouter","NearTokenRouteSender","destinationReceiptVerifier","v4PurchaseGroupId","v4FundedInvoiceId","v4FundingGroupHash"],methods:["authorizePurchaseGroup","reconcile","reconcileExactQuote"],resolved_modules:{client:import.meta.resolve("@ach/client/v4"),intents:import.meta.resolve("@ach/intents/owner")}}),{mode:0o600,flag:"wx"});';
 const script=path.join(isolated,'verify.mjs');writeFileSync(script,source,{mode:0o600});
 const imported=await execute(process.execPath,[script],'ISOLATED_SDK_IMPORT_FAILED','import.log'),proof=path.join(isolated,'import-verification.json');
 if(!existsSync(proof))throw new Error('ISOLATED_SDK_IMPORT_EVIDENCE_REQUIRED');
 const verification=JSON.parse(readFileSync(proof,'utf8'));
 if(verification.kind!=='isolated-sdk-install'||verification.passed!==true||Object.values(verification.resolved_modules??{}).length!==2||!Object.values(verification.resolved_modules).every(url=>url.startsWith(new URL('node_modules/',new URL('file://'+isolated+'/')).href)))throw new Error('ISOLATED_SDK_IMPORT_EVIDENCE_REQUIRED');
 writeFileSync(path.join(isolated,'verification.json'),JSON.stringify({...verification,install_exit_code:install.exit_code,import_exit_code:imported.exit_code,verification_script_sha256:createHash('sha256').update(source).digest('hex')}),{mode:0o600});
 console.log(JSON.stringify({isolated_sdk_install:'passed',outside_repository:true,evidence:path.join(isolated,'verification.json')}));process.exit(0);
}

if(process.argv.includes('--prepare')){
 const result=spawnSync('npm',['install','--ignore-scripts'],{cwd:repoRoot,stdio:'inherit'});
 if(result.error||result.status!==0)throw new Error('BROWSER_DEPENDENCY_SETUP_FAILED');
 const {chromium}=await import('playwright');const browser=await chromium.launch({headless:true,args:['--no-sandbox','--disable-dev-shm-usage']});await browser.close();
 console.log(JSON.stringify({browser_dependencies:'ready',funds_spent:false}));process.exit(0);
}
const {chromium}=await import('playwright');
const {v4PurchaseGroupId}=await import('../../packages/client/dist/v4.js');
loadPrivateEnvironment();
const config=JSON.parse(readFileSync(manifestPath,'utf8'));
const argument=name=>{const index=process.argv.indexOf(name);return index<0?undefined:process.argv[index+1];};
const bypassFile=argument('--bypass-env-file');if(bypassFile)process.env.ACH_V4_PREVIEW_BYPASS=parseEnv(readFileSync(bypassFile,'utf8')).ACH_V4_PREVIEW_BYPASS;
const remote=argument('--url')??process.env.ACH_V4_BROWSER_URL;
const base=remote??'http://127.0.0.1:4310';
const smoke=process.argv.includes('--smoke'),reuse=process.argv.includes('--reuse-live'),fixturesOnly=process.argv.includes('--fixtures-only');
const output=argument('--output')??privatePath(fixturesOnly?'browser-ui-fixtures':remote?'browser-hosted':'browser-local');mkdirSync(output,{recursive:true,mode:0o700});
const checkpointFile=path.join(output,'private-browser-checkpoint.json'),checkpointBinding={url:base,vault:config.vault,code_hash:config.code_hash};
const resumedCheckpoint=readBrowserCheckpoint(checkpointFile,checkpointBinding);
const report={kind:smoke?'browser-smoke':'browser-live-journeys',url:base,vault:config.vault,code_hash:config.code_hash,started_at:new Date().toISOString(),passed:false,checks:[],screenshots:[],errors:[]};
let server,browser,browserContext,page;
const check=(name,detail={})=>{report.checks.push({name,...detail});console.log(JSON.stringify({phase:name,state:'passed'}));};
async function until(read,predicate,name,timeout=240000){const start=Date.now();let last;while(Date.now()-start<timeout){try{last=await read();if(predicate(last))return last;if(last?.jobs?.some(j=>j.state==='FAILED'))throw new Error('BROWSER_JOB_FAILED:'+last.jobs.find(j=>j.state==='FAILED').error);}catch(e){if(e.message.startsWith('BROWSER_JOB_FAILED:')||!retryableBrowserRead(e))throw e;}if(Math.floor((Date.now()-start)/2000)%10===0)console.log(JSON.stringify({phase:name,state:'waiting'}));await new Promise(resolve=>setTimeout(resolve,2000));}throw new Error('BROWSER_TIMEOUT:'+name);}
function launchWeb(){
 const env={...process.env,ACH_V4_COORDINATOR_URL:config.services.coordinator,ACH_V4_NETWORK:config.network,ACH_V4_VAULT:config.vault,ACH_V4_INTENTS_QUOTE_PREVIEWS:String(config.intents?.dry_quotes_enabled===true)};delete env.ACH_V4_DISCOVERY_URL;delete env.ACH_V4_DISCOVERY_KEY;
 server=spawn(process.execPath,['node_modules/next/dist/bin/next','start','-p','4310','-H','127.0.0.1'],{cwd:path.join(repoRoot,'web'),env,stdio:['ignore','pipe','pipe']});
 let logs='';for(const pipe of [server.stdout,server.stderr])pipe.on('data',b=>{logs=(logs+b.toString()).slice(-6000);});
 server.on('exit',code=>{if(code)report.errors.push({kind:'web-server-exit',code});});
}
async function layout(page,name,width,height=1000){
 await page.setViewportSize({width,height});await page.evaluate(()=>{window.scrollTo(0,0);return document.fonts.ready;});await page.waitForTimeout(200);
 const readability=await page.evaluate(()=>{
  const rgb=value=>{const n=value.match(/[\d.]+/g)?.map(Number);return n?.length>=3?[n[0],n[1],n[2],n[3]??1]:[0,0,0,0];};
  const blend=(front,back)=>front.slice(0,3).map((v,i)=>v*front[3]+back[i]*(1-front[3]));
  const luminance=values=>values.map(v=>{const x=v/255;return x<=.04045?x/12.92:((x+.055)/1.055)**2.4;}).reduce((sum,v,i)=>sum+v*[.2126,.7152,.0722][i],0);
  const found=new Map();
  for(const el of document.querySelectorAll('body *')){
   if(!(el instanceof HTMLElement)||!el.getClientRects().length||el.closest('.sr-only,button:disabled,input:disabled,select:disabled')||![...el.childNodes].some(n=>n.nodeType===3&&n.textContent.trim()))continue;
   const ancestors=[];for(let node=el;node;node=node.parentElement)ancestors.unshift(node);
   if(ancestors.some(node=>Number(getComputedStyle(node).opacity)<1))continue;
   let background=[255,255,255];for(const node of ancestors)background=blend(rgb(getComputedStyle(node).backgroundColor),background);
   const style=getComputedStyle(el),foreground=blend(rgb(style.color),background),a=luminance(foreground),b=luminance(background),ratio=(Math.max(a,b)+.05)/(Math.min(a,b)+.05);
   const size=parseFloat(style.fontSize),large=size>=24||size>=18.667&&Number(style.fontWeight)>=700;
   if(ratio<(large?3:4.5)){
    const entry={tag:el.tagName,class:el.className,color:style.color,background:background.map(Math.round),font_size:size,ratio:Math.round(ratio*100)/100};
    found.set(JSON.stringify(entry),entry);
   }
  }
  return [...found.values()];
 });
 report.text_contrast??=[];report.text_contrast.push({page:name,width,issues:readability});
 if(readability.length)console.log(JSON.stringify({phase:'text-contrast-review',page:name,width,issues:readability.slice(0,12)}));
 if(process.argv.includes('--check-text-contrast'))assert.equal(readability.length,0,name+': text contrast below the reviewed threshold');
 const dimensions=await page.evaluate(()=>({viewport:innerWidth,document:document.documentElement.scrollWidth}));
 const filename=`${name}-${width}.png`;await page.screenshot({path:path.join(output,filename),fullPage:true});report.screenshots.push({name,width,height,file:filename});
 if(dimensions.document>dimensions.viewport+1){const elements=await page.evaluate(()=>[...document.querySelectorAll('body *')].filter(e=>!e.closest('.table-region, .desk-rail nav, .sr-only')).map(e=>{const r=e.getBoundingClientRect();return{tag:e.tagName,class:typeof e.className==='string'?e.className:'svg',width:Math.round(r.width),right:Math.round(r.right)};}).filter(e=>e.right>innerWidth+1).slice(0,15));console.log(JSON.stringify({phase:'layout-overflow',width,elements}));}
 assert.ok(dimensions.document<=dimensions.viewport+1,`${name}: horizontal overflow ${dimensions.document}/${dimensions.viewport}`);
 check('responsive-layout',{page:name,width});
}
async function snapshot(context){const r=await context.request.get(base+'/api/v4/snapshot',{timeout:60000});const s=await r.json();if(!r.ok())throw new Error(s.error??String(r.status()));return s;}
async function configureCookie(context){
 if(!reuse)return;const owned=JSON.parse(readFileSync(privatePath('live-public-session.json'),'utf8'));
 await context.addCookies([{name:'ach-v4-session',value:owned.token,url:base,httpOnly:true,secure:new URL(base).protocol==='https:',sameSite:'Lax'}]);
}
async function visitAll(page){
 for(const[name,width,height]of [['landing',1440,1000],['landing',834,1000],['landing',390,844],['landing',320,844]]){await page.goto(base,{waitUntil:'networkidle'});await layout(page,name,width,height);}
  await page.getByRole('button',{name:'Show net payments',exact:true}).click();assert.equal((await page.locator('.example-net-amount').innerText()).trim(),'20 USDC');await page.getByRole('button',{name:'A and B only',exact:true}).click();assert.equal((await page.locator('.example-net-amount').innerText()).trim(),'100 USDC');check('interactive-clearing-example',{full_net:'20',subgroup_net:'100'});
 await page.goto(base+'/developers',{waitUntil:'networkidle'});assert.ok(await page.locator('#funding').count());
 for(const filename of ['ach-client-4.0.0.tgz','ach-intents-4.0.0.tgz']){const r=await page.context().request.get(base+'/sdk/'+filename);assert.ok(r.ok(),filename+' missing');assert.ok((await r.body()).length>1000);}check('downloadable-sdk');
 await layout(page,'developers',390,844);
 await page.goto(base+'/proof',{waitUntil:'networkidle'});assert.ok((await page.locator('main').innerText()).includes(config.vault));check('proof-runtime-configuration');await layout(page,'proof',390,844);
}
async function inspectWorkspace(page){
 await page.goto(base+'/workspace',{waitUntil:'domcontentloaded'});
 await page.locator('.wallet-summary').waitFor({timeout:60000});
 for(const[view,label]of [['overview','Overview'],['work','Work'],['wallets','Wallets'],['payments','Payments'],['clearing','Clearing'],['history','History'],['settings','Settings']]){
  await navigateWorkspace(page,label);
  await page.getByRole('heading',{name:label,exact:true}).waitFor();
  await layout(page,view,1440,1000);await layout(page,view,390,844);
 }
 await layout(page,'settings',320,844);check('workspace-navigation');
}
async function liveJourney(page,context){
 await page.goto(base,{waitUntil:'domcontentloaded'});
 const [created]=await Promise.all([page.waitForResponse(r=>new URL(r.url()).pathname==='/api/v4/session'),page.locator('.hero-actions').getByRole('button',{name:'Start a free session',exact:true}).click()]);const sessionResult=await created.json();assert.ok(created.ok(),'BROWSER_SESSION_REJECTED:'+created.status()+':'+(sessionResult.error??'UNAVAILABLE'));await page.waitForURL('**/workspace');
 await context.storageState({path:path.join(output,'private-browser-state.json')});
 let initial=await until(()=>snapshot(context),s=>s.session.state==='READY','sponsored-wallets',480000);assert.equal(initial.session.participants.length,3);if(sessionResult.session)assert.equal(initial.balances.find(b=>b.account_id===initial.session.participants[0].account_id).available,'1000000');
 await navigateWorkspace(page,'Work');await page.locator('#brief').waitFor({timeout:60000});check('free-browser-onboarding',{session_id:initial.session.id,resumed:!sessionResult.session});
 assert.equal(await page.locator('#wallet-scope').count(),0,'Work is commissioned by Research Desk');
 if(resumedCheckpoint)assert.equal(resumedCheckpoint.session_id,initial.session.id,'BROWSER_CHECKPOINT_SESSION_MISMATCH');
 const requestFile=path.join(output,'private-browser-requests.json'),seen=resumedCheckpoint?structuredClone(resumedCheckpoint.requests):existsSync(requestFile)?JSON.parse(readFileSync(requestFile,'utf8')):{};
 let activeSessionId=initial.session.id,checkpointFailure;
 const checkpoint=async()=>{
  const storage_state=await context.storageState();
  writeBrowserCheckpoint(checkpointFile,checkpointBinding,{session_id:activeSessionId,requests:structuredClone(seen),storage_state});
  writeFileSync(requestFile,JSON.stringify(seen),{mode:0o600});
  writeFileSync(path.join(output,'private-browser-state.json'),JSON.stringify(storage_state),{mode:0o600});
 };
 if(!Object.keys(seen).length){
  // Recover a previously submitted test brief from this browser's own session.
  // Public inputs or sealed private inputs stay in the private test namespace.
  const {StateStore}=await import('../../services/lib/store.mjs'),store=new StateStore(privatePath('coordinator.sqlite'));
  try{for(const job of store.jobs(initial.session.id).filter(j=>j.id.startsWith('run-'))){const privacy=job.payload.privacy==='encrypted'?'private':job.payload.privacy;seen[privacy]={...job.payload,privacy};}}finally{store.close();}
 }
 await checkpoint();
 // Persist the original request and its browser key before it reaches the
 // service. A killed verifier can then resume without repeating a purchase.
 await page.route(/\/api\/v4\/(?:run|withdraw|deposit)(?:\?.*)?$/,async route=>{
  const request=route.request();if(request.method()!=='POST'||new URL(request.url()).origin!==new URL(base).origin)return route.continue();
  const pathname=new URL(request.url()).pathname,body=request.postDataJSON();
  seen[pathname==='/api/v4/run'?body.privacy:pathname.split('/').at(-1)]=body;
  try{await checkpoint();await route.continue();}catch(error){checkpointFailure=error;await route.abort('failed');}
 });
 const run=async privacy=>{
  await navigateWorkspace(page,'Work');
  await page.locator('#brief').fill(privacy==='private'?'Private client workload 92713; create an audited chart.':'Create an audited chart of the supplied service workloads.');
  await page.locator('#dataset').fill('Research requests,120\nChart requests,85\nAudit requests,64');
  await page.getByRole('radio',{name:privacy==='private'?/^Private invoices/:/^Public/}).check();
  if(seen[privacy]){const response=await context.request.post(base+'/api/v4/run',{data:seen[privacy]});const body=await response.json();assert.ok(response.ok(),'BROWSER_RESUME_REJECTED:'+(body.error??response.status()));check('resumed-original-browser-request',{privacy});}
  else await page.getByRole('button',{name:'Run agents',exact:true}).click();
  await until(async()=>{if(checkpointFailure)throw checkpointFailure;return seen[privacy];},Boolean,'browser-'+privacy+'-submission',30000);
  if(privacy==='private'){assert.equal(seen.private.brief,undefined);assert.equal(seen.private.data,undefined);assert.ok(seen.private.sealed_brief.ciphertext);check('browser-private-ingress');}
  const id=seen[privacy].request_id;
  let completed=await until(()=>snapshot(context),s=>s.jobs.some(j=>j.id==='run-'+id&&j.state==='COMPLETE'),'browser-'+privacy+'-service-work',900000);
  const job=completed.jobs.find(j=>j.id==='run-'+id);if(privacy==='public'){assert.equal(job.result.planner.kind,'llm');assert.equal(job.result.chart.audit.valid,true);assert.equal(job.result.chart.sha256,createHash('sha256').update(job.result.chart.svg).digest('hex'));}
  else{assert.equal(job.result,null);assert.equal(job.sealed_result.kind,'encrypted-result');assert.ok(!JSON.stringify(completed).includes('92713'));}
  await page.locator('.artifact-surface').waitFor({timeout:30000});
  if(privacy==='private'){await openPrivateHistory(page,job,completed.session.id);check('live-private-artifact-and-exact-download');}
  await checkpoint();
  await navigateWorkspace(page,'Clearing');const sheet=page.locator('.clearing-surface');await sheet.getByRole('button',{name:privacy==='private'?'Private':'Public',exact:true}).click();
  const publicIds=privacy==='public'?[...new Set(job.result.bills.map(bill=>bill.spec.id))]:null;
  if(publicIds)assert.equal(publicIds.length,3);
  const research=completed.session.participants.find(participant=>participant.kind==='research');
  const fundingGroup=completed.funding_groups?.find(group=>group.input.id===v4PurchaseGroupId(config,research.account_id,id));
  const roundId=job.result?.round_id??fundingGroup?.round_id;
  if(config.workflow_revision===2)assert.equal(typeof roundId,'string','completed work must retain its original committed round');
  const isSettled=s=>publicIds
   ?publicIds.every(id=>s.invoices.some(invoice=>invoice.spec.id===id&&invoice.status==='SETTLED'))
   :s.rounds.some(r=>r.status==='SETTLED'&&r.input.private&&(!roundId||r.input.id===roundId));
  const clear=sheet.getByRole('button',{name:'Clear selected bills',exact:true});
  let clearingSubmitted=false,clearingAttempts=0,nextClearingAttempt=0;
  // Entering Clearing saves manual mode asynchronously. Wait for that action
  // and the current ledger before clicking; a disabled control is temporary.
  // Automatic settlement may finish first, in which case no click is needed.
  const settled=await until(async()=>{
   const state=await snapshot(context);if(isSettled(state))return state;
   if(!clearingSubmitted&&clearingAttempts<3&&Date.now()>=nextClearingAttempt&&await clear.count()&&await clear.isEnabled()){
    clearingAttempts++;nextClearingAttempt=Date.now()+15000;
    const reply=page.waitForResponse(response=>new URL(response.url()).pathname==='/api/v4/clear'&&response.request().method()==='POST',{timeout:30000});
    await clear.click();const response=await reply,body=await response.json();
    if(response.ok()){clearingSubmitted=true;check('live-'+privacy+'-clearing-request',{job_id:body.job_id??null,attempts:clearingAttempts});}
    else assert.ok([429,503].includes(response.status())&&/UNAVAILABLE|UNKNOWN|SYNCHRONIZATION/.test(body.error??''),'BROWSER_CLEARING_REJECTED:'+response.status()+':'+(body.error??'UNKNOWN_ERROR'));
   }
   return null;
  },Boolean,'browser-'+privacy+'-settlement',360000);
  const rounds=settled.rounds.filter(r=>r.status==='SETTLED'&&r.input.private===(privacy==='private')&&(!roundId||r.input.id===roundId)&&(!publicIds||r.input.invoice_ids.some(id=>publicIds.includes(id))));
  assert.ok(rounds.length);
  const totalMovement=rounds.reduce((sum,round)=>sum+BigInt(round.net_settlement_volume),0n);
  if(publicIds){
   // Verify actual bills and exact settlement effects even when the standing
   // coordinator policy races a manual request. Report the lost offset as a
   // workflow finding; never relabel a split round as the promised full group.
   const consumed=[];
   for(const round of rounds){
    assert.ok(round.input.invoice_ids.every(id=>publicIds.includes(id)));
    const positions=new Map();let gross=0n;
    for(const id of round.input.invoice_ids){
     const spec=settled.invoices.find(invoice=>invoice.spec.id===id).spec,amount=BigInt(spec.amount);
     gross+=amount;positions.set(spec.buyer,(positions.get(spec.buyer)??0n)-amount);positions.set(spec.seller,(positions.get(spec.seller)??0n)+amount);consumed.push(id);
    }
    const expected=[...positions].sort(([a],[b])=>a.localeCompare(b)).map(([account_id,net])=>({account_id,net:net.toString()}));
    assert.deepEqual(round.input.positions,expected);
    assert.equal(round.gross_invoice_volume,gross.toString());
    assert.equal(round.net_settlement_volume,[...positions.values()].reduce((sum,net)=>sum+(net<0n?-net:0n),0n).toString());
   }
   assert.deepEqual(consumed.sort(),publicIds.slice().sort(),'all three bills must settle exactly once');
   assert.ok(totalMovement>=20000n&&totalMovement<=280000n);
   if(config.workflow_revision===2){assert.equal(rounds.length,1,'corrected funded purchases must clear as one group');assert.equal(totalMovement,20000n,'corrected three-bill net movement');}
   if(rounds.length!==1||totalMovement!==20000n){
    const finding={id:'W06',kind:'full-group-proposals-lost-to-separate-rounds',expected_full_group_net_units:'20000',actual_net_units:totalMovement.toString(),settled_rounds:rounds.length,invoice_count:publicIds.length,financial_effects_verified:true};
    report.workflow_findings??=[];report.workflow_findings.push(finding);console.log(JSON.stringify({phase:'observed-workflow-finding',...finding}));
   }
  }else{assert.equal(rounds.length,1);assert.equal(totalMovement,20000n);assert.equal(rounds[0].input.invoice_ids.length,3);}
  const display=value=>{const digits=String(value).padStart(7,'0'),fraction=digits.slice(-6).replace(/0+$/,'').padEnd(2,'0');return digits.slice(0,-6)+'.'+fraction;};
  for(const round of rounds){
   assert.equal(round.approvals.length,round.input.positions.length);
   const card=page.locator('[id="round-'+round.input.id+'"]'),roundButton=card.locator('.round-list-item');await roundButton.waitFor({timeout:30000});
   if(await roundButton.getAttribute('aria-expanded')!=='true')await roundButton.click();
   const expanded=card.locator('.round-details'),totals=expanded.locator('.round-totals');
   const gross=BigInt(round.gross_invoice_volume??'280000'),net=BigInt(round.net_settlement_volume);
   const values=await totals.locator('strong').allTextContents();assert.equal(values.length,3);
   for(const[index,value]of [gross,gross-net,net].entries())assert.ok(values[index].includes(display(value)));
   assert.equal(await expanded.locator('.approval-row').count(),round.input.positions.length);
   const [recordDownload]=await Promise.all([page.waitForEvent('download'),expanded.getByRole('link',{name:'Download round record'}).click()]);
   const exported=JSON.parse(readFileSync(await recordDownload.path(),'utf8'));
   assert.equal(exported.round.hash,round.hash);assert.equal(exported.round.net_settlement_volume,round.net_settlement_volume);assert.deepEqual(exported.round.input.invoice_ids,round.input.invoice_ids);
   check('live-'+privacy+'-expanded-round-and-exact-export',{round_id:round.input.id});
  }
  check('live-'+privacy+'-work-and-clearing',{round_ids:rounds.map(round=>round.input.id),net_units:totalMovement.toString(),full_group_cleared:rounds.length===1&&totalMovement===20000n});
  return settled;
 };
 let settled=await run('public');await navigateWorkspace(page,'Work');await layout(page,'public-delivery',1440);await layout(page,'public-delivery',390,844);
 const[download]=await Promise.all([page.waitForEvent('download'),page.getByRole('link',{name:'Download SVG',exact:true}).click()]);assert.equal(download.suggestedFilename(),'ach-chart.svg');check('artifact-download');
 const audit=settled.session.participants.find(p=>p.kind==='audit');await navigateWorkspace(page,'Wallets');await page.locator('#wallet-scope').selectOption(audit.account_id);
 const ownerId=(route,request)=>route==='withdraw'?'withdraw:withdraw-'+request.request_id:'deposit:'+request.request_id;
 const ownerTransfer=async(route,click,phase)=>{
  const resumed=Boolean(seen[route]);if(!resumed)await click();
  await until(async()=>seen[route],Boolean,phase+'-submission',30000);
  const request=structuredClone(seen[route]);assert.equal(request.account_id,audit.account_id);assert.equal(request.amount,'10000');
  let retries=0,nextRetry=Date.now()+(resumed?0:15000);
  const confirmed=await until(async()=>{
   const state=await snapshot(context),operation=state.owner_operations?.find(op=>op.id===ownerId(route,request));
   if(operation?.state==='CONFIRMED'){assert.equal(operation.account_id,audit.account_id);assert.equal(operation.amount,'10000');assert.equal(operation.evidence,'near_final');return state;}
   if(retries<3&&Date.now()>=nextRetry){
    retries++;nextRetry=Date.now()+15000;
    const response=await context.request.post(base+'/api/v4/'+route,{data:request,timeout:30000}),body=await response.json();
    assert.ok(response.ok()||[429,503].includes(response.status())&&['RPC_UNAVAILABLE','SERVICE_UNAVAILABLE','SERVICE_OR_CHAIN_UNAVAILABLE','TRANSACTION_BROADCAST_UNKNOWN','SERVICE_CONFIRMATION_UNKNOWN'].includes(body.error),'BROWSER_OWNER_RETRY_REJECTED:'+response.status()+':'+(body.error??'UNKNOWN_ERROR'));
   }
   return null;
  },Boolean,phase);
  return{state:confirmed,request,resumed,retries};
 };
 const withdrawn=await ownerTransfer('withdraw',async()=>{await page.locator('.wallet-actions input').first().fill('0.01');await page.getByRole('button',{name:'Withdraw test funds',exact:true}).click();},'browser-withdrawal');
 const redeposited=seen.deposit&&withdrawn.state.owner_operations?.some(op=>op.id===ownerId('deposit',seen.deposit)&&op.state==='CONFIRMED');
 if(!redeposited)assert.equal(withdrawn.state.external_balances.find(b=>b.account_id===audit.account_id)?.amount,'10000');
 check('live-browser-withdrawal',{request_id:withdrawn.request.request_id,resumed:withdrawn.resumed,exact_request_retries:withdrawn.retries});
 const deposited=await ownerTransfer('deposit',async()=>{await page.getByRole('button',{name:'Deposit from agent account',exact:true}).waitFor({timeout:30000});await page.locator('.redeposit-form input').fill('0.01');await page.getByRole('button',{name:'Deposit from agent account',exact:true}).click();},'browser-redeposit');
 assert.equal(deposited.state.external_balances.find(b=>b.account_id===audit.account_id)?.amount,'0');
 check('live-browser-authenticated-redeposit',{request_id:deposited.request.request_id,resumed:deposited.resumed,exact_request_retries:deposited.retries});
 if(config.private?.enabled)settled=await run('private');else throw new Error('LIVE_PRIVATE_MODE_REQUIRED');
 if(config.workflow_revision===2){
  const previousPublic=seen.public.request_id,completed=settled.jobs.filter(job=>job.state==='COMPLETE').length;
  delete seen.public;await checkpoint();
  await page.waitForTimeout(5100);settled=await run('public');
  assert.notEqual(seen.public.request_id,previousPublic);assert.ok(settled.jobs.filter(job=>job.state==='COMPLETE').length>=3);assert.equal(settled.jobs.filter(job=>job.state==='COMPLETE').length,completed+1);check('live-third-identical-brief');
  const original=settled,originalId=settled.session.id,originalRequests=structuredClone(seen),privateJob=original.jobs.find(job=>job.id==='run-'+seen.private.request_id);
  assert.ok(privateJob?.sealed_result);const originalAccounts=new Set(original.session.participants.map(participant=>participant.account_id));
  await navigateWorkspace(page,'Work');await page.getByRole('button',{name:'Start another test workspace',exact:true}).click();
  let fresh=await until(()=>snapshot(context),state=>state.session.id!==originalId&&state.session.state==='READY','fresh-judge-workspace',480000);
  assert.equal(fresh.jobs.length,0);assert.ok(fresh.session.participants.every(participant=>!originalAccounts.has(participant.account_id)));
  activeSessionId=fresh.session.id;for(const key of Object.keys(seen))delete seen[key];await checkpoint();
  await page.waitForTimeout(5100);fresh=await run('public');assert.equal(fresh.jobs.filter(job=>job.state==='COMPLETE').length,1);assert.equal(fresh.invoices.length,3);check('live-fresh-workspace-work-and-clearing');
  await navigateWorkspace(page,'Settings');await page.getByRole('combobox',{name:'Test workspace'}).locator(`option[value="${originalId}"]`).waitFor({state:'attached',timeout:30000});await page.getByRole('combobox',{name:'Test workspace'}).selectOption(originalId);
  settled=await until(()=>snapshot(context),state=>state.session.id===originalId&&state.session.state==='READY','reopen-original-judge-workspace');
  activeSessionId=originalId;Object.assign(seen,originalRequests);await checkpoint();
  assert.equal(settled.jobs.filter(job=>job.state==='COMPLETE').length,original.jobs.filter(job=>job.state==='COMPLETE').length);assert.deepEqual(settled.jobs.find(job=>job.id===privateJob.id).sealed_result,privateJob.sealed_result);
  await openPrivateHistory(page,privateJob,originalId);check('live-workspace-switch-preserves-history-and-private-results');
 }
 // Save browser keys and cookies only in the private working namespace.
 await context.storageState({path:path.join(output,'private-browser-state.json')});
 await navigateWorkspace(page,'Settings');await layout(page,'private-settings',1440);
 const state=await snapshot(context);if(config.workflow_revision===2){assert.ok(state.invoices.length>=6);assert.ok(state.private_invoices.length>=3);}else{assert.equal(state.invoices.length,3);assert.equal(state.private_invoices.length,3);}
 // A separate browser has no decryption key and no access to this session.
 const isolated=await browser.newContext();const other=await isolated.request.get(base+'/api/v4/snapshot');assert.equal(other.status(),401);await isolated.close();check('browser-session-isolation');
}
async function openPrivateHistory(page,job,sessionId){
 const id=job.id;assert.ok(job.sealed_result,'ORIGINAL_PRIVATE_RESULT_REQUIRED');
 const {default:typescript}=await import('typescript');
 const code=typescript.transpileModule(readFileSync(path.join(repoRoot,'web/lib/privacy.ts'),'utf8'),{compilerOptions:{module:typescript.ModuleKind.CommonJS,target:typescript.ScriptTarget.ES2022}}).outputText;
 const expected=await page.evaluate(async({code,network,vault,sessionId,response})=>{
  const exported={};new Function('exports',code)(exported);
  const artifact=await exported.openResult(network,vault,sessionId,response);
  return{svg:artifact.chart.svg,sha256:artifact.chart.sha256,title:artifact.chart.title};
 },{code,network:config.network,vault:config.vault,sessionId,response:job.sealed_result});
 assert.equal(createHash('sha256').update(expected.svg).digest('hex'),expected.sha256,'ORIGINAL_PRIVATE_ARTIFACT_HASH_MISMATCH');
 await navigateWorkspace(page,'History');await page.getByLabel('Search history',{exact:true}).fill(id);
 // CSV exports contain every record ID too. Select the actual work row.
 await page.locator(`.history-surface a.history-row[href*="${id}"]`).click();
 assert.equal(new URL(page.url()).searchParams.get('item'),'work');assert.equal(new URL(page.url()).searchParams.get('id'),id);
 const dialog=page.getByRole('dialog');await dialog.locator('.artifact-surface').waitFor({timeout:30000});
 assert.ok((await dialog.innerText()).includes(expected.title),'ORIGINAL_PRIVATE_ARTIFACT_TITLE_REQUIRED');
 await dialog.getByText('Private deliverable · opened in this browser',{exact:true}).waitFor();
 const[download]=await Promise.all([page.waitForEvent('download'),dialog.getByRole('link',{name:'Download SVG',exact:true}).click()]);
 const bytes=readFileSync(await download.path());assert.ok(bytes.equals(Buffer.from(expected.svg)),'PRIVATE_HISTORY_ARTIFACT_CHANGED');
 assert.equal(createHash('sha256').update(bytes).digest('hex'),expected.sha256,'PRIVATE_HISTORY_ARTIFACT_HASH_MISMATCH');
 await page.getByRole('button',{name:'Close details',exact:true}).click();
}

async function resumeJudgeJourney(page,context){
 const previousPath=argument('--resume-report'),checkpointPath=argument('--resume-judge-workspaces');
 assert.ok(previousPath&&checkpointPath,'EXPLICIT_JUDGE_CONTINUATION_REQUIRED');
 const bytes=readFileSync(previousPath),previous=JSON.parse(bytes),checkpoint=JSON.parse(readFileSync(checkpointPath,'utf8'));
 assert.notEqual(path.resolve(previousPath),path.resolve(output,'report.json'),'PRESERVE_PREVIOUS_BROWSER_REPORT');
 for(const field of ['vault','code_hash','url'])assert.equal(previous[field],report[field],'JUDGE_CONTINUATION_RUNTIME_MISMATCH:'+field);
 assert.equal(previous.passed,false);assert.deepEqual(previous.errors,[]);assert.equal((previous.workflow_findings??[]).length,0);
 for(const name of ['free-browser-onboarding','live-public-work-and-clearing','live-browser-withdrawal','live-browser-authenticated-redeposit','browser-private-ingress','live-private-work-and-clearing','live-third-identical-brief','live-fresh-workspace-work-and-clearing'])assert.ok(previous.checks.some(check=>check.name===name),'COMPLETED_JUDGE_STAGE_REQUIRED:'+name);
 assert.ok(!previous.checks.some(check=>check.name==='live-workspace-switch-preserves-history-and-private-results'),'UNFINISHED_JUDGE_STAGE_REQUIRED');
 assert.equal(checkpoint.previous_report_sha256,createHash('sha256').update(bytes).digest('hex'));
 report.continuation={previous_report:previousPath,previous_report_sha256:checkpoint.previous_report_sha256,previous_started_at:previous.started_at,previous_finished_at:previous.finished_at,previous_failure:previous.failure,completed_checks_retained:previous.checks.length};
 report.checks.unshift(...previous.checks);
 await page.goto(base+'/workspace',{waitUntil:'domcontentloaded'});await page.locator('.wallet-summary').waitFor({timeout:60000});
 let original=await until(()=>snapshot(context),state=>state.session.id===checkpoint.original_session_id&&state.session.state==='READY','resume-original-judge-workspace');
 const privateJob=original.jobs.find(job=>job.id===checkpoint.private_job_id);assert.equal(privateJob?.state,'COMPLETE');assert.ok(privateJob.sealed_result);
 assert.equal(createHash('sha256').update(JSON.stringify(privateJob.sealed_result)).digest('hex'),checkpoint.private_result_sha256);
 const verifiedIds=previous.checks.filter(check=>check.name==='live-public-work-and-clearing'||check.name==='live-private-work-and-clearing').flatMap(check=>check.round_ids);
 const verifyRounds=state=>state.rounds.filter(round=>verifiedIds.includes(round.input.id)).forEach(round=>{assert.equal(round.status,'SETTLED');assert.equal(round.net_settlement_volume,'20000');assert.equal(round.input.invoice_ids.length,3);assert.equal(round.approvals.length,3);});
 verifyRounds(original);
 const selectWorkspace=async id=>{
  await navigateWorkspace(page,'Settings');const selector=page.getByRole('combobox',{name:'Test workspace'});
  await selector.locator(`option[value="${id}"]`).waitFor({state:'attached',timeout:60000});
  await until(()=>selector.isEnabled(),Boolean,'workspace-switch-control',60000);await selector.selectOption(id);
  const state=await until(()=>snapshot(context),state=>state.session.id===id&&state.session.state==='READY','resume-judge-workspace-switch');
  await page.getByRole('heading',{name:'Overview',exact:true,level:1}).waitFor({timeout:60000});return state;
 };
 const fresh=await selectWorkspace(checkpoint.fresh_session_id);assert.equal(fresh.jobs.filter(job=>job.state==='COMPLETE').length,1);assert.equal(fresh.invoices.length,3);assert.ok(fresh.invoices.every(invoice=>invoice.status==='SETTLED'));
 assert.ok(fresh.rounds.some(round=>round.input.id===checkpoint.fresh_round_id&&round.status==='SETTLED'));verifyRounds(fresh);
 assert.ok(verifiedIds.every(id=>[...original.rounds,...fresh.rounds].some(round=>round.input.id===id)),'EVERY_PREVIOUSLY_VERIFIED_ROUND_REQUIRED');
 assert.ok(fresh.session.participants.every(participant=>!original.session.participants.some(other=>other.account_id===participant.account_id)));check('resumed-fresh-workspace-state-reverified');
 const reopened=await selectWorkspace(original.session.id);assert.equal(reopened.jobs.filter(job=>job.state==='COMPLETE').length,original.jobs.filter(job=>job.state==='COMPLETE').length);assert.deepEqual(reopened.jobs.find(job=>job.id===privateJob.id).sealed_result,privateJob.sealed_result);
 await openPrivateHistory(page,privateJob,original.session.id);check('live-workspace-switch-preserves-history-and-private-results');
 await context.storageState({path:path.join(output,'private-browser-state.json')});await navigateWorkspace(page,'Settings');await layout(page,'private-settings',1440);
 assert.ok(reopened.invoices.length>=6);assert.ok(reopened.private_invoices.length>=3);
 const isolated=await browser.newContext();assert.equal((await isolated.request.get(base+'/api/v4/snapshot')).status(),401);await isolated.close();check('browser-session-isolation');
}
try{
 if(!remote){launchWeb();await until(async()=>{try{return(await fetch(base)).ok;}catch{return false;}},Boolean,'production-web-start',30000);}
 browser=await chromium.launch({headless:true,args:['--no-sandbox','--disable-dev-shm-usage']});
 const headers=process.env.ACH_V4_PREVIEW_BYPASS?{'x-vercel-protection-bypass':process.env.ACH_V4_PREVIEW_BYPASS}:{};
 const saved=path.join(output,'private-browser-state.json');
 const context=await browser.newContext({viewport:{width:1440,height:1000},reducedMotion:'reduce',extraHTTPHeaders:headers,acceptDownloads:true,...(!reuse&&(resumedCheckpoint||existsSync(saved))?{storageState:resumedCheckpoint?.storage_state??saved}:{})});browserContext=context;await configureCookie(context);
 if(process.env.ACH_V4_PREVIEW_BYPASS){const origin=new URL(base).origin;await context.route('**/*',route=>{if(new URL(route.request().url()).origin===origin)return route.continue();const publicHeaders={...route.request().headers()};delete publicHeaders['x-vercel-protection-bypass'];return route.continue({headers:publicHeaders});});}
 page=await context.newPage();page.on('pageerror',error=>report.errors.push({kind:'browser-runtime',name:error.name,message:redactBrowserMessage(error.message).slice(0,300)}));
 const failedRequests=[];page.on('requestfailed',request=>{const url=new URL(request.url());if(url.protocol.startsWith('http'))failedRequests.push({host:url.hostname,error:request.failure()?.errorText});});
 report.failed_requests=failedRequests;
 await visitAll(page);
 const runtime=await context.request.get(base+'/api/v4/config');assert.ok(runtime.ok());const runtimeConfig=await runtime.json();assert.equal(runtimeConfig.vault,config.vault);assert.equal(runtimeConfig.intents?.dry_quotes_enabled,config.intents?.dry_quotes_enabled);check('hosted-manifest-binding');
 const rejectedOrigin=await context.request.post(base+'/api/v4/session',{headers:{origin:'https://unrelated.example'},data:{}});assert.equal(rejectedOrigin.status(),403);assert.equal((await rejectedOrigin.json()).error,'ORIGIN_MISMATCH');check('cross-origin-session-rejected');
 if(fixturesOnly){const {uiFixtures}=await import('./browser-fixtures.mjs');await uiFixtures({browser,base,config,check,layout});}
 else{
 if(!smoke){if(argument('--resume-report'))await resumeJudgeJourney(page,context);else await liveJourney(page,context);}else if(!reuse)throw new Error('SMOKE_REQUIRES_EXISTING_SESSION');
 await inspectWorkspace(page);
 // A failed read retains the last confirmed amounts and disables writes.
 const before=await page.locator('.wallet-summary').innerText();await page.route('**/api/v4/snapshot',route=>route.fulfill({status:503,contentType:'application/json',body:JSON.stringify({error:'SERVICE_UNAVAILABLE'})}));
 await page.getByRole('button',{name:'Refresh confirmed state'}).click();await page.locator('.connection.stale').waitFor();assert.equal(await page.locator('.wallet-summary').innerText(),before);check('stale-data-retains-confirmed-balances');await page.unroute('**/api/v4/snapshot');
 }
 assert.equal(report.errors.length,0,JSON.stringify(report.errors));report.passed=true;
}catch(error){report.failure={name:error.name,message:redactBrowserMessage(error.message)};if(page&&!page.isClosed()){report.failure.visible_errors=(await page.getByRole('alert').allTextContents().catch(()=>[])).map(redactBrowserMessage);await page.screenshot({path:path.join(output,'failure.png'),fullPage:true}).catch(()=>{});}process.exitCode=1;console.error(JSON.stringify({phase:'browser-verification',state:'failed',error:report.failure.message,visible_errors:report.failure.visible_errors,failed_requests:report.failed_requests}));}
finally{
 if(browserContext&&!smoke)await browserContext.storageState({path:path.join(output,'private-browser-state.json')}).catch(()=>{});
 if(browser)await browser.close();if(server)server.kill('SIGTERM');report.finished_at=new Date().toISOString();writeFileSync(path.join(output,'report.json'),JSON.stringify(report,null,2),{mode:0o600});
 console.log(JSON.stringify({browser_checks:report.passed?'passed':'failed',checks:report.checks.length,evidence:path.join(output,'report.json'),repository_pushed:config.source?.repository_pushed===true}));
}
