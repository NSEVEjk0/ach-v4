import {navigateWorkspace}from './browser-fixtures.mjs';
import assert from 'node:assert/strict';
import {mkdirSync,readFileSync,writeFileSync,existsSync,mkdtempSync}from 'node:fs';
import {spawn,spawnSync}from 'node:child_process';
import {createHash}from 'node:crypto';
import {parseEnv}from 'node:util';
import path from 'node:path';
import {privateRoot,privatePath,manifestPath,repoRoot,loadPrivateEnvironment}from '../../services/lib/paths.mjs';

if(process.argv.includes('--sdk-only')){
 const isolated=mkdtempSync('/tmp/ach-sdk-install-');writeFileSync(path.join(isolated,'package.json'),JSON.stringify({private:true,type:'module'}),{mode:0o600});
 const install=spawnSync('npm',['install','--ignore-scripts','--no-audit','--no-fund',path.join(repoRoot,'web/public/sdk/ach-client-4.0.0.tgz'),path.join(repoRoot,'web/public/sdk/ach-intents-4.0.0.tgz')],{cwd:isolated,encoding:'utf8'});
 if(install.status!==0)throw new Error('ISOLATED_SDK_INSTALL_FAILED');
 const imported=spawnSync(process.execPath,['--input-type=module','-e','import {AchV4Client,V4NearTransport,V4RpcProvider} from "@ach/client/v4";import {OwnerIntentsRouter,NearTokenRouteSender,destinationReceiptVerifier} from "@ach/intents/owner";if(![AchV4Client,V4NearTransport,V4RpcProvider,OwnerIntentsRouter,NearTokenRouteSender,destinationReceiptVerifier].every(x=>typeof x==="function"))throw new Error("MISSING_EXPORT");'],{cwd:isolated,encoding:'utf8'});
 if(imported.status!==0)throw new Error('ISOLATED_SDK_IMPORT_FAILED');
 writeFileSync(path.join(isolated,'verification.json'),JSON.stringify({kind:'isolated-sdk-install',passed:true,node:process.version,exports:['AchV4Client','V4NearTransport','V4RpcProvider','OwnerIntentsRouter','NearTokenRouteSender','destinationReceiptVerifier']}),{mode:0o600});
 console.log(JSON.stringify({isolated_sdk_install:'passed',outside_repository:true,evidence:path.join(isolated,'verification.json')}));process.exit(0);
}

if(process.argv.includes('--prepare')){
 const result=spawnSync('npm',['install','--ignore-scripts'],{cwd:repoRoot,stdio:'inherit'});
 if(result.status!==0)throw new Error('BROWSER_DEPENDENCY_SETUP_FAILED');
 const {chromium}=await import('playwright');const browser=await chromium.launch({headless:true,args:['--no-sandbox','--disable-dev-shm-usage']});await browser.close();
 console.log(JSON.stringify({browser_dependencies:'ready',funds_spent:false}));process.exit(0);
}
const {chromium}=await import('playwright');
loadPrivateEnvironment();
const config=JSON.parse(readFileSync(manifestPath,'utf8'));
const argument=name=>{const index=process.argv.indexOf(name);return index<0?undefined:process.argv[index+1];};
const bypassFile=argument('--bypass-env-file');if(bypassFile)process.env.ACH_V4_PREVIEW_BYPASS=parseEnv(readFileSync(bypassFile,'utf8')).ACH_V4_PREVIEW_BYPASS;
const remote=argument('--url')??process.env.ACH_V4_BROWSER_URL;
const base=remote??'http://127.0.0.1:4310';
const smoke=process.argv.includes('--smoke'),reuse=process.argv.includes('--reuse-live'),fixturesOnly=process.argv.includes('--fixtures-only');
const output=argument('--output')??privatePath(fixturesOnly?'browser-ui-fixtures':remote?'browser-hosted':'browser-local');mkdirSync(output,{recursive:true,mode:0o700});
const report={kind:smoke?'browser-smoke':'browser-live-journeys',url:base,vault:config.vault,code_hash:config.code_hash,started_at:new Date().toISOString(),passed:false,checks:[],screenshots:[],errors:[]};
let server,browser,browserContext,page;
const check=(name,detail={})=>{report.checks.push({name,...detail});console.log(JSON.stringify({phase:name,state:'passed'}));};
async function until(read,predicate,name,timeout=240000){const start=Date.now();let last;while(Date.now()-start<timeout){try{last=await read();if(predicate(last))return last;if(last?.jobs?.some(j=>j.state==='FAILED'))throw new Error('BROWSER_JOB_FAILED:'+last.jobs.find(j=>j.state==='FAILED').error);}catch(e){if(e.message.startsWith('BROWSER_JOB_FAILED:')||!/UNAVAILABLE|ECONNREFUSED|fetch failed|503|Timeout/.test(e.message))throw e;}if(Math.floor((Date.now()-start)/2000)%10===0)console.log(JSON.stringify({phase:name,state:'waiting'}));await new Promise(resolve=>setTimeout(resolve,2000));}throw new Error('BROWSER_TIMEOUT:'+name);}
function launchWeb(){
 const env={...process.env,ACH_V4_COORDINATOR_URL:config.services.coordinator,ACH_V4_NETWORK:config.network,ACH_V4_VAULT:config.vault};delete env.ACH_V4_DISCOVERY_URL;delete env.ACH_V4_DISCOVERY_KEY;
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
 await page.getByRole('button',{name:'Show net payments',exact:true}).click();assert.match(await page.locator('.example-net-amount').innerText(),/40/);await page.getByRole('button',{name:'A and B only',exact:true}).click();assert.match(await page.locator('.example-net-amount').innerText(),/100/);check('interactive-clearing-example',{full_net:'40',subgroup_net:'100'});
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
 const requestFile=path.join(output,'private-browser-requests.json'),seen=existsSync(requestFile)?JSON.parse(readFileSync(requestFile,'utf8')):{};
 if(!Object.keys(seen).length){
  // Recover a previously submitted test brief from this browser's own session.
  // Public inputs or sealed private inputs stay in the private test namespace.
  const {StateStore}=await import('../../services/lib/store.mjs'),store=new StateStore(privatePath('coordinator.sqlite'));
  try{for(const job of store.jobs(initial.session.id).filter(j=>j.id.startsWith('run-'))){const privacy=job.payload.privacy==='encrypted'?'private':job.payload.privacy;seen[privacy]={...job.payload,privacy};}}finally{store.close();}
 }
 page.on('request',request=>{if(new URL(request.url()).pathname==='/api/v4/run'){const body=request.postDataJSON();seen[body.privacy]=body;writeFileSync(requestFile,JSON.stringify(seen),{mode:0o600});}});
 const run=async privacy=>{
  await navigateWorkspace(page,'Work');
  await page.locator('#brief').fill(privacy==='private'?'Private client workload 92713; create an audited chart.':'Create an audited chart of the supplied service workloads.');
  await page.locator('#dataset').fill('Research requests,120\nChart requests,85\nAudit requests,64');
  await page.getByRole('radio',{name:privacy==='private'?/^Private invoices/:/^Public/}).check();
  if(seen[privacy]){const response=await context.request.post(base+'/api/v4/run',{data:seen[privacy]});const body=await response.json();assert.ok(response.ok(),'BROWSER_RESUME_REJECTED:'+(body.error??response.status()));check('resumed-original-browser-request',{privacy});}
  else await page.getByRole('button',{name:'Run agents',exact:true}).click();
  await until(async()=>seen[privacy],Boolean,'browser-'+privacy+'-submission',30000);
  if(privacy==='private'){assert.equal(seen.private.brief,undefined);assert.equal(seen.private.data,undefined);assert.ok(seen.private.sealed_brief.ciphertext);check('browser-private-ingress');}
  const id=seen[privacy].request_id;
  let completed=await until(()=>snapshot(context),s=>s.jobs.some(j=>j.id==='run-'+id&&j.state==='COMPLETE'),'browser-'+privacy+'-service-work',360000);
  const job=completed.jobs.find(j=>j.id==='run-'+id);if(privacy==='public'){assert.equal(job.result.planner.kind,'llm');assert.equal(job.result.chart.audit.valid,true);assert.equal(job.result.chart.sha256,createHash('sha256').update(job.result.chart.svg).digest('hex'));}
  else{assert.equal(job.result,null);assert.equal(job.sealed_result.kind,'encrypted-result');assert.ok(!JSON.stringify(completed).includes('92713'));}
  await page.locator('.artifact-surface').waitFor({timeout:30000});
  await navigateWorkspace(page,'Clearing');const sheet=page.locator('.clearing-surface');await sheet.getByRole('button',{name:privacy==='private'?'Private':'Public',exact:true}).click();
  const clear=sheet.getByRole('button',{name:'Clear selected bills',exact:true});if(await clear.count()&&await clear.isEnabled())await clear.click();
  const publicIds=privacy==='public'?[...new Set(job.result.bills.map(bill=>bill.spec.id))]:null;
  if(publicIds)assert.equal(publicIds.length,3);
  const settled=await until(()=>snapshot(context),s=>publicIds
   ?publicIds.every(id=>s.invoices.some(invoice=>invoice.spec.id===id&&invoice.status==='SETTLED'))
   :s.rounds.some(r=>r.status==='SETTLED'&&r.input.private),'browser-'+privacy+'-settlement',360000);
  const rounds=settled.rounds.filter(r=>r.status==='SETTLED'&&r.input.private===(privacy==='private')&&(!publicIds||r.input.invoice_ids.some(id=>publicIds.includes(id))));
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
 await page.locator('.wallet-actions input').first().fill('0.01');await page.getByRole('button',{name:'Withdraw test funds',exact:true}).click();
 await until(()=>snapshot(context),s=>s.external_balances.find(b=>b.account_id===audit.account_id)?.amount==='10000','browser-withdrawal');check('live-browser-withdrawal');
 await page.getByRole('button',{name:'Deposit from agent account',exact:true}).waitFor({timeout:30000});await page.locator('.redeposit-form input').fill('0.01');await page.getByRole('button',{name:'Deposit from agent account',exact:true}).click();
 await until(()=>snapshot(context),s=>s.external_balances.find(b=>b.account_id===audit.account_id)?.amount==='0','browser-redeposit');check('live-browser-authenticated-redeposit');
 if(config.private?.enabled)await run('private');else throw new Error('LIVE_PRIVATE_MODE_REQUIRED');
 // Save browser keys and cookies only in the private working namespace.
 await context.storageState({path:path.join(output,'private-browser-state.json')});
 await navigateWorkspace(page,'Settings');await layout(page,'private-settings',1440);
 const state=await snapshot(context);assert.equal(state.invoices.length,3);assert.equal(state.private_invoices.length,3);
 // A separate browser has no decryption key and no access to this session.
 const isolated=await browser.newContext();const other=await isolated.request.get(base+'/api/v4/snapshot');assert.equal(other.status(),401);await isolated.close();check('browser-session-isolation');
}
try{
 if(!remote){launchWeb();await until(async()=>{try{return(await fetch(base)).ok;}catch{return false;}},Boolean,'production-web-start',30000);}
 browser=await chromium.launch({headless:true,args:['--no-sandbox','--disable-dev-shm-usage']});
 const headers=process.env.ACH_V4_PREVIEW_BYPASS?{'x-vercel-protection-bypass':process.env.ACH_V4_PREVIEW_BYPASS}:{};
 const saved=path.join(output,'private-browser-state.json');
 const context=await browser.newContext({viewport:{width:1440,height:1000},reducedMotion:'reduce',extraHTTPHeaders:headers,acceptDownloads:true,...(!reuse&&existsSync(saved)?{storageState:saved}:{})});browserContext=context;await configureCookie(context);
 if(process.env.ACH_V4_PREVIEW_BYPASS){const origin=new URL(base).origin;await context.route('**/*',route=>{if(new URL(route.request().url()).origin===origin)return route.continue();const publicHeaders={...route.request().headers()};delete publicHeaders['x-vercel-protection-bypass'];return route.continue({headers:publicHeaders});});}
 page=await context.newPage();page.on('pageerror',error=>report.errors.push({kind:'browser-runtime',name:error.name,message:error.message.slice(0,300)}));
 const failedRequests=[];page.on('requestfailed',request=>{const url=new URL(request.url());if(url.protocol.startsWith('http'))failedRequests.push({host:url.hostname,error:request.failure()?.errorText});});
 report.failed_requests=failedRequests;
 await visitAll(page);
 const runtime=await context.request.get(base+'/api/v4/config');assert.ok(runtime.ok());assert.equal((await runtime.json()).vault,config.vault);check('hosted-manifest-binding');
 const rejectedOrigin=await context.request.post(base+'/api/v4/session',{headers:{origin:'https://unrelated.example'},data:{}});assert.equal(rejectedOrigin.status(),403);assert.equal((await rejectedOrigin.json()).error,'ORIGIN_MISMATCH');check('cross-origin-session-rejected');
 if(fixturesOnly){const {uiFixtures}=await import('./browser-fixtures.mjs');await uiFixtures({browser,base,config,check,layout});}
 else{
 if(!smoke)await liveJourney(page,context);else if(!reuse)throw new Error('SMOKE_REQUIRES_EXISTING_SESSION');
 await inspectWorkspace(page);
 // A failed read retains the last confirmed amounts and disables writes.
 const before=await page.locator('.wallet-summary').innerText();await page.route('**/api/v4/snapshot',route=>route.fulfill({status:503,contentType:'application/json',body:JSON.stringify({error:'SERVICE_UNAVAILABLE'})}));
 await page.getByRole('button',{name:'Refresh confirmed state'}).click();await page.locator('.connection.stale').waitFor();assert.equal(await page.locator('.wallet-summary').innerText(),before);check('stale-data-retains-confirmed-balances');await page.unroute('**/api/v4/snapshot');
 }
 assert.equal(report.errors.length,0,JSON.stringify(report.errors));report.passed=true;
}catch(error){report.failure={name:error.name,message:error.message};if(page&&!page.isClosed()){report.failure.visible_errors=await page.getByRole('alert').allTextContents().catch(()=>[]);await page.screenshot({path:path.join(output,'failure.png'),fullPage:true}).catch(()=>{});}process.exitCode=1;console.error(JSON.stringify({phase:'browser-verification',state:'failed',error:error.message,visible_errors:report.failure.visible_errors,failed_requests:report.failed_requests}));}
finally{
 if(browserContext&&!smoke)await browserContext.storageState({path:path.join(output,'private-browser-state.json')}).catch(()=>{});
 if(browser)await browser.close();if(server)server.kill('SIGTERM');report.finished_at=new Date().toISOString();writeFileSync(path.join(output,'report.json'),JSON.stringify(report,null,2),{mode:0o600});
 console.log(JSON.stringify({browser_checks:report.passed?'passed':'failed',checks:report.checks.length,evidence:path.join(output,'report.json'),repository_pushed:false}));
}
