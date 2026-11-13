// Fully local end-to-end execution: actual vault/token Wasm, the actual native
// private worker, isolated stores and generated identities. No live manifests,
// saved owner credentials, public RPCs, funding or deployment are used.
import assert from 'node:assert/strict';
import {mkdirSync,readFileSync,writeFileSync}from 'node:fs';
import {spawn}from 'node:child_process';
import {createServer}from 'node:http';
import {once}from 'node:events';
import {randomBytes}from 'node:crypto';
import {fileURLToPath}from 'node:url';
import path from 'node:path';
import {chromium}from 'playwright';
import {setup}from '../../services/test/fixtures/commerce.mjs';
import {serve,readJson,sessionBearer,serviceFetch}from '../../services/lib/http.mjs';
import {StateStore}from '../../services/lib/store.mjs';
import {NettingTester}from '../../services/coordinator/netting-test.mjs';
import {DemoSponsor}from '../../services/demo/sponsor.mjs';
import {navigateWorkspace,uiFixtures}from './browser-fixtures.mjs';

const root=fileURLToPath(new URL('../../',import.meta.url)),directory=path.join(root,'.local/security-review-20261111/browser');mkdirSync(directory,{recursive:true,mode:0o700});
const report={kind:'fully-local-browser-and-wasm',started_at:new Date().toISOString(),passed:false,live_transactions:false,live_credentials_used:false,checks:[],screenshots:[],errors:[]};
const check=(name,details={})=>{report.checks.push({name,...details});console.log(JSON.stringify({check:name,state:'passed'}));};
const h=await setup({privateMode:true}),serviceToken=randomBytes(32).toString('hex');let coordinator=h.coordinator,service,web,webFailure,browser,page;
const sponsor=Object.assign(Object.create(DemoSponsor.prototype),{store:h.store,config:{...h.config,sponsor_limits:{maxNative:'26000000000000000000000000',perSessionNative:'2000000000000000000000000',dailyLimit:null,ipLimit:null,intervalMs:10000}},enqueue:session=>{void h.addWorkspace(session).catch(error=>console.error('LOCAL_WORKSPACE_FIXTURE_FAILED:'+error.message));},ownerFor:(session,id)=>{const party=session.participants.find(p=>p.account_id===id);if(!party)throw new Error('SESSION_OWNER_SCOPE_REQUIRED');return h.ownerGroups.get(session.id).get(party.kind);}});
const privateTestStore=new StateStore(path.join(h.temp,'netting.sqlite'),{sealingKey:'9'.repeat(64)});
const tester=new NettingTester({store:h.store,privateStore:privateTestStore,config:h.config,clock:()=>h.chain.now,getIdentity:async(s,p)=>h.identityGroups.get(s.id).get(p.kind),getClient:async()=>h.identities.get('coordinator').client,getPrivateClient:async()=>h.owners.get('coordinator'),onChange:id=>coordinator.invalidateSnapshot(id)});coordinator.tester=tester;
const requests=[];
async function until(read,predicate,label,timeout=30000){const started=Date.now();let last;while(Date.now()-started<timeout){last=await read();if(predicate(last))return last;await new Promise(resolve=>setTimeout(resolve,100));}throw new Error('LOCAL_BROWSER_TIMEOUT:'+label);}
const close=s=>new Promise(resolve=>{s.closeAllConnections();s.close(resolve);});
async function layout(current,name,width,height=900){await current.setViewportSize({width,height});await current.evaluate(()=>document.fonts.ready);await current.waitForTimeout(100);const dimensions=await current.evaluate(()=>({width:innerWidth,scroll:document.documentElement.scrollWidth}));assert.ok(dimensions.scroll<=dimensions.width+1,`${name}: horizontal overflow ${dimensions.scroll}/${dimensions.width}`);const filename=name+'-'+width+'.png';await current.screenshot({path:path.join(directory,filename),fullPage:true});report.screenshots.push(filename);check('responsive-'+name,{width});}

try{
 service=serve({port:0,token:serviceToken,handle:async(req,url)=>{
  h.chain.now=Math.max(h.chain.now,Date.now());
  if(url.pathname==='/config')return{...h.config,status:'local-test'};
  if(url.pathname==='/session'){await readJson(req);return{session:h.store.session(h.session.id),token:h.token};}
  const session=coordinator.authenticate(sessionBearer(req));
  if(url.pathname==='/sessions')return{sessions:h.store.workspaceSessions(session)};
  if(url.pathname==='/session-switch')return h.store.switchSession(session,(await readJson(req)).session_id);
  if(url.pathname==='/session-new'){const body=await readJson(req);return sponsor.createSession(body.ip_hash,session,{agent_count:body.agent_count??3});}
  if(url.pathname==='/snapshot')return coordinator.snapshot(session);
  if(url.pathname==='/history')return h.store.eventPage(session.id,{before:Number(url.searchParams.get('before'))});
  if(url.pathname==='/clearing-policy')return coordinator.setClearingPolicy(session,await readJson(req));
  if(url.pathname==='/private-key')return h.actors.get('research').encryptionKey(session);
  if(url.pathname==='/run'){const request=await readJson(req);coordinator.prepareRun(session,request);requests.push({kind:'run',privacy:request.privacy,plaintext:request.brief!==undefined||request.data!==undefined});void coordinator.run(session,request).catch(()=>{});return{state:'STARTED'};}
  if(url.pathname==='/clear'){const request=await readJson(req);coordinator.prepareClear(session,request);requests.push({kind:'clear',privacy:request.privacy,invoice_count:request.invoice_ids.length});void coordinator.clear(session,request).catch(()=>{});return{state:'STARTED'};}
  if(['/withdraw','/deposit','/recover','/revoke'].includes(url.pathname)){const result=await sponsor[{withdraw:'withdraw',deposit:'deposit',recover:'recover',revoke:'revoke'}[url.pathname.slice(1)]](session,await readJson(req));coordinator.invalidateSnapshot(session.id);return result;}
  if(url.pathname==='/netting-test'){const input=await readJson(req);tester.prepare(session,input);void tester.run(session,input).catch(()=>{});return{state:'STARTED'};}
  if(url.pathname==='/intents/tokens')return[];
  throw new Error('METHOD_NOT_FOUND');
 }});await once(service,'listening');
 const portServer=createServer();await new Promise(resolve=>portServer.listen(0,'127.0.0.1',resolve));const port=portServer.address().port;await close(portServer);const base='http://127.0.0.1:'+port;
 h.config.rpc_url=base+'/rpc';h.config.rpc_urls=[h.config.rpc_url];
 const env={PATH:process.env.PATH,HOME:process.env.HOME,NODE_ENV:'production',ACH_V4_SERVICE_TOKEN:serviceToken,ACH_V4_COORDINATOR_URL:'http://127.0.0.1:'+service.address().port,ACH_V4_DISCOVERY_URL:'',ACH_V4_DISCOVERY_KEY:'',ACH_V4_NETWORK:'testnet',ACH_V4_VAULT:h.config.vault,NEXT_TELEMETRY_DISABLED:'1'};
 web=spawn(process.execPath,['node_modules/next/dist/bin/next','start','-p',String(port),'-H','127.0.0.1'],{cwd:path.join(root,'web'),env,stdio:['ignore','pipe','pipe']});web.once('error',error=>{webFailure=error;});for(const pipe of [web.stdout,web.stderr])pipe.resume();
 await until(async()=>{if(webFailure)throw new Error('LOCAL_WEB_SERVER_START_FAILED');if(web.exitCode!==null||web.signalCode!==null)throw new Error('LOCAL_WEB_SERVER_STOPPED');try{return(await fetch(base)).ok;}catch{return false;}},Boolean,'web-start');
 browser=await chromium.launch({headless:true,args:['--no-sandbox','--disable-dev-shm-usage']});const context=await browser.newContext({viewport:{width:1440,height:1000},reducedMotion:'reduce',acceptDownloads:true});page=await context.newPage();page.on('pageerror',error=>report.errors.push(error.message));
 await context.route('**/*',async route=>{const url=new URL(route.request().url());if(url.pathname==='/rpc'&&url.origin===base){const params=route.request().postDataJSON().params,input=JSON.parse(Buffer.from(params.args_base64,'base64'));const value=(await h.chain.invoke(params.account_id,params.method_name,input)).value;return route.fulfill({json:{jsonrpc:'2.0',id:'verify-service-key',result:{result:[...Buffer.from(JSON.stringify(value))]}}});}if(url.protocol.startsWith('http')&&url.hostname!=='127.0.0.1')return route.abort();return route.continue();});
 const snapshot=async()=>{const response=await context.request.get(base+'/api/v4/snapshot');assert.ok(response.ok(),JSON.stringify(await response.json()));return response.json();};
 const post=async(route,data)=>{const response=await context.request.post(base+'/api/v4/'+route,{data});assert.ok(response.ok(),JSON.stringify(await response.json()));return response.json();};
 await page.goto(base);await layout(page,'landing',1440);await layout(page,'landing',390,844);
 let session=h.store.session(h.session.id);session.state='PROVISIONING';session.setup_progress={agent:'research',stage:'Installing spending permissions'};h.store.updateSession(session);
 await page.locator('.hero-actions').getByRole('button',{name:'Start a free session',exact:true}).click();await page.waitForURL('**/workspace');await page.getByText('Installing spending permissions',{exact:false}).waitFor();check('wallet-setup-progress');
 session=h.store.session(h.session.id);session.state='READY';session.setup_progress={stage:'Ready'};h.store.updateSession(session);await page.getByRole('button',{name:'Refresh confirmed state'}).click();await page.locator('.wallet-summary').waitFor();
 assert.ok(!(await page.evaluate(()=>document.cookie)).includes('ach-v4-session'));check('http-only-session-cookie');
 const run=async privacy=>{
  const completed=(await snapshot()).jobs.filter(job=>job.state==='COMPLETE').length;
  await page.waitForTimeout(5100);await page.getByRole('button',{name:'Refresh confirmed state'}).click();
  await navigateWorkspace(page,'Work');await page.locator('#brief').fill(privacy==='private'?'Create a private chart for workload 92713':'Create an audited chart of service workloads');await page.locator('#dataset').fill('Research requests,120\nChart requests,85\nAudit requests,64');await page.getByRole('radio',{name:privacy==='private'?/^Private invoices/:/^Public/}).check();await page.getByRole('button',{name:'Run agents',exact:true}).click();
  const state=await until(snapshot,s=>s.jobs.filter(j=>j.state==='COMPLETE').length===completed+1,privacy+'-work');assert.equal(state.rounds.filter(r=>r.status==='READY').length,1);await page.locator('.artifact-surface').waitFor();check(privacy+'-useful-work-requires-ready-group');return state;
 };
 let state=await run('public');const research=h.session.participants.find(p=>p.kind==='research').account_id;await post('withdraw',{request_id:'a'.repeat(32),account_id:research,amount:'980000'});await page.getByRole('button',{name:'Refresh confirmed state'}).click();
 await navigateWorkspace(page,'Clearing');await until(snapshot,s=>s.session.clearing_policy.mode==='manual','manual-policy');coordinator=h.restart();coordinator.tester=tester;check('manual-policy-survives-restart');
 let clear=page.getByRole('button',{name:'Clear selected bills',exact:true});await until(()=>clear.isEnabled(),Boolean,'already-reserved-funding');assert.equal((await snapshot()).balances.find(b=>b.account_id===research).available,'0');
 const box=page.locator('.clearing-surface tbody input[type=checkbox]').first();await box.uncheck();assert.equal(await clear.isEnabled(),false);await box.check();await until(()=>clear.isEnabled(),Boolean,'complete-group-selection');check('partial-funded-group-disabled');await layout(page,'funded-public',1440);await layout(page,'funded-public',390,844);await clear.click();
 state=await until(snapshot,s=>s.rounds[0].status==='SETTLED','public-settlement');assert.equal(state.rounds.length,1);assert.equal(state.rounds[0].net_settlement_volume,'20000');check('public-settlement-with-zero-available-cash');
 await post('deposit',{request_id:'b'.repeat(32),account_id:research,amount:'20000'});await page.getByRole('button',{name:'Refresh confirmed state'}).click();state=await run('private');assert.equal(requests.find(r=>r.kind==='run'&&r.privacy==='private').plaintext,false);assert.ok(!JSON.stringify(state).includes('92713'));check('private-ingress-and-snapshot-confidentiality');
 await navigateWorkspace(page,'Clearing');await page.locator('.clearing-surface').getByRole('button',{name:'Private',exact:true}).click();clear=page.getByRole('button',{name:'Clear selected bills',exact:true});await until(()=>clear.isEnabled(),Boolean,'private-reserved-funding');await layout(page,'funded-private',390,844);await clear.click();state=await until(snapshot,s=>s.rounds.some(r=>r.input.private&&r.status==='SETTLED'),'private-settlement');assert.equal(state.rounds.length,2);assert.equal(state.rounds.find(r=>r.input.private).net_settlement_volume,'20000');check('private-settlement-with-zero-available-cash');
 for(const[index,id]of ['c','d'].entries()){
  await post('deposit',{request_id:id.repeat(32),account_id:research,amount:'20000'});await page.getByRole('button',{name:'Refresh confirmed state'}).click();await run('public');await navigateWorkspace(page,'Clearing');clear=page.getByRole('button',{name:'Clear selected bills',exact:true});await until(()=>clear.isEnabled(),Boolean,'repeated-public-funding');await clear.click();state=await until(snapshot,s=>s.rounds.filter(round=>round.status==='SETTLED').length===index+3,'repeated-public-settlement');
 }
 assert.equal(state.jobs.filter(job=>job.state==='COMPLETE').length,4);check('third-and-fourth-briefs-including-an-identical-repeat');
 const originalId=state.session.id,privateJob=state.jobs.find(job=>job.sealed_result),originalSealed=privateJob.sealed_result;
 await navigateWorkspace(page,'Work');await page.getByRole('button',{name:'Start another test workspace',exact:true}).click();let fresh=await until(snapshot,s=>s.session.id!==originalId&&s.session.state==='READY','fresh-workspace');await page.getByRole('button',{name:'Refresh confirmed state'}).click();assert.equal(fresh.jobs.length,0);assert.equal(fresh.balances.find(balance=>balance.account_id===fresh.session.participants.find(participant=>participant.kind==='research').account_id).available,'1000000');
 await run('public');await navigateWorkspace(page,'Clearing');clear=page.getByRole('button',{name:'Clear selected bills',exact:true});await until(()=>clear.isEnabled(),Boolean,'fresh-workspace-funding');await clear.click();fresh=await until(snapshot,s=>s.rounds.some(round=>round.status==='SETTLED'),'fresh-workspace-settlement');assert.equal(fresh.invoices.length,3);check('fresh-workspace-runs-and-settles-with-independent-wallets');
 await navigateWorkspace(page,'Settings');await until(()=>page.getByRole('combobox',{name:'Test workspace'}).locator('option').count(),count=>count===2,'workspace-list');await page.getByRole('combobox',{name:'Test workspace'}).selectOption(originalId);state=await until(snapshot,s=>s.session.id===originalId,'return-to-original-workspace');await page.getByRole('button',{name:'Refresh confirmed state'}).click();assert.equal(state.jobs.filter(job=>job.state==='COMPLETE').length,4);assert.deepEqual(state.jobs.find(job=>job.id===privateJob.id).sealed_result,originalSealed);
 await navigateWorkspace(page,'History');await page.getByRole('combobox',{name:'History type'}).selectOption('work');const privateHistory=page.locator('.history-row[href*="'+privateJob.id+'"]');await privateHistory.waitFor();assert.equal(await privateHistory.count(),1);await privateHistory.click();await page.getByRole('dialog').locator('.artifact-surface').waitFor();assert.match(await page.getByRole('dialog').innerText(),/92713/);await page.getByRole('button',{name:'Close details',exact:true}).click();check('workspace-switch-preserves-original-history-and-browser-decryption');
 for(const label of ['Overview','Work','Wallets','Payments','Clearing','History','Settings']){await navigateWorkspace(page,label);await layout(page,label.toLowerCase(),1440);await layout(page,label.toLowerCase(),390,844);}await layout(page,'settings-small',320,844);
 for(let index=0;index<205;index++)h.store.event(h.session.id,'wallet-setup-waiting','history-fixture-'+index,{});await navigateWorkspace(page,'History');await page.getByRole('button',{name:'Refresh confirmed state'}).click();await page.getByRole('button',{name:'Load older activity',exact:true}).waitFor();
 while(await page.getByRole('button',{name:'Load older activity',exact:true}).count()){await page.getByRole('button',{name:'Load older activity',exact:true}).click();await page.waitForTimeout(150);}const count=Number((await page.locator('.history-surface .list-summary').innerText()).match(/\d+/)[0]);assert.ok(count>205);check('history-loads-beyond-one-hundred-events',{records:count});
 const [download]=await Promise.all([page.waitForEvent('download'),page.getByRole('link',{name:'Export history'}).click()]);const csv=readFileSync(await download.path(),'utf8');assert.ok(csv.includes('Wallet deposit'));assert.ok(csv.includes('Wallet withdrawal'));assert.ok(csv.includes('Clearing round'));check('history-export-includes-owner-transfers');
 await navigateWorkspace(page,'Wallets');await page.route('**/api/v4/snapshot',route=>route.fulfill({status:503,json:{error:'SERVICE_UNAVAILABLE'}}));const previous=await page.locator('.wallet-summary').innerText();await page.getByRole('button',{name:'Refresh confirmed state'}).click();await page.locator('.connection.stale').waitFor();assert.equal(await page.locator('.wallet-summary').innerText(),previous);assert.equal(await page.getByRole('button',{name:'Withdraw test funds',exact:true}).isEnabled(),false);check('stale-state-retains-balances-and-disables-money-actions');await page.unroute('**/api/v4/snapshot');
 const isolated=await browser.newContext();assert.equal((await isolated.request.get(base+'/api/v4/snapshot')).status(),401);await isolated.close();check('browser-session-isolation');
 assert.equal((await context.request.post(base+'/api/v4/session',{headers:{origin:'https://attacker.test'},data:{}})).status(),403);assert.equal((await context.request.post(base+'/api/v4/run',{data:'x'.repeat(65000)})).status(),413);for(const route of ['agent','agent-demo','contract'])assert.equal((await context.request.get(base+'/api/'+route)).status(),410);check('origin-size-and-retired-route-enforcement');
 let leaked=false;const destination=createServer((req,res)=>{if(req.headers['x-ach-service-token'])leaked=true;res.end('{}');});await new Promise(resolve=>destination.listen(0,'127.0.0.1',resolve));const redirect=createServer((req,res)=>{res.writeHead(302,{location:'http://127.0.0.1:'+destination.address().port});res.end();});await new Promise(resolve=>redirect.listen(0,'127.0.0.1',resolve));try{await assert.rejects(serviceFetch('http://127.0.0.1:'+redirect.address().port,serviceToken)('/','payload'));assert.equal(leaked,false);}finally{await close(redirect);await close(destination);}check('redirects-do-not-forward-service-credentials');
 await navigateWorkspace(page,'Clearing');
 await page.getByLabel('Agents in the test').selectOption('12');
 await page.getByRole('button',{name:'Prepare 12 judge wallets',exact:true}).click();
 const judge=await until(snapshot,s=>s.session.agent_count===12&&s.session.state==='READY','twelve-judge-wallets');assert.equal(judge.session.participants.length,12);
 await page.getByRole('button',{name:'Refresh confirmed state'}).click();
 await page.getByRole('button',{name:'Run signed netting test',exact:true}).click();
 let judgeState=await until(snapshot,s=>s.test_jobs?.some(j=>j.state==='COMPLETE'),'public-judge-test');assert.equal(judgeState.rounds.at(-1).net_settlement_volume,'20000');assert.equal(judgeState.rounds.at(-1).approvals.length,12);
 check('browser-twelve-judge-wallets-sign-and-settle-public-round');
 await page.getByRole('button',{name:'Refresh confirmed state'}).click();
 await page.getByLabel('Bill visibility').selectOption('private');
 const workerBefore=h.workerRuns.length;
 await page.getByRole('button',{name:'Run signed netting test',exact:true}).click();
 judgeState=await until(snapshot,s=>s.test_jobs?.filter(j=>j.state==='COMPLETE').length===2,'private-judge-test');const privateRound=judgeState.rounds.find(r=>r.input.private);assert.equal(privateRound.net_settlement_volume,'500000');assert.equal(privateRound.approvals.length,12);assert.equal(h.workerRuns.slice(workerBefore).filter(r=>r.input.operation==='net').length,1);
 await page.getByRole('button',{name:'Refresh confirmed state'}).click();await layout(page,'judge-twelve-private',390,844);await layout(page,'judge-twelve-private',320,844);
 check('browser-twelve-judge-agents-settle-six-encrypted-bills-in-one-worker-run');
 await uiFixtures({browser,base,config:h.config,check,layout});assert.equal(report.errors.length,0,JSON.stringify(report.errors));report.vault_wasm_sha256=JSON.parse(readFileSync(path.join(root,'target/ach-build.json'),'utf8')).artifacts.vault.sha256;report.worker_executions=h.workerRuns.length;report.requests=requests;report.passed=true;
}catch(error){report.failure={name:error.name,message:error.message};if(page&&!page.isClosed()){report.failure.alerts=await page.getByRole('alert').allTextContents().catch(()=>[]);await page.screenshot({path:path.join(directory,'failure.png'),fullPage:true}).catch(()=>{});}console.error(JSON.stringify({browser:'failed',...report.failure}));process.exitCode=1;}
finally{if(browser)await browser.close();if(web?.pid&&web.exitCode===null&&web.signalCode===null){const exited=once(web,'exit').catch(()=>{}),timer=setTimeout(()=>web.kill('SIGKILL'),5000);try{web.kill('SIGTERM');await exited;}finally{clearTimeout(timer);}}if(service)await close(service);privateTestStore.close();h.cleanup();report.finished_at=new Date().toISOString();writeFileSync(path.join(directory,'report.json'),JSON.stringify(report,null,2),{mode:0o600});console.log(JSON.stringify({local_browser:report.passed?'passed':'failed',checks:report.checks.length,report:path.join(directory,'report.json'),live_transactions:false}));}
