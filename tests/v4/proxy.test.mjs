import test from 'node:test';
import assert from 'node:assert/strict';
import {localWebModules}from './web-modules.mjs';

const modules=localWebModules();test.after(()=>modules.cleanup());
const {NextRequest}=await import(modules.nextServerUrl),{GET,POST}=await import(modules.url('proxy'));
const serviceSecret='a'.repeat(64),sessionToken='b'.repeat(64),session={id:'local-session'};
const names=['ACH_V4_SERVICE_TOKEN','ACH_V4_COORDINATOR_URL','ACH_V4_DISCOVERY_URL','ACH_V4_INTENTS_QUOTE_PREVIEWS','VERCEL'];
async function isolated(fetcher,work){
 const saved=new Map(names.map(name=>[name,process.env[name]])),oldFetch=globalThis.fetch;
 Object.assign(process.env,{ACH_V4_SERVICE_TOKEN:serviceSecret,ACH_V4_COORDINATOR_URL:'https://local-test-gateway.trycloudflare.com/',ACH_V4_DISCOVERY_URL:'',ACH_V4_INTENTS_QUOTE_PREVIEWS:'',VERCEL:''});globalThis.fetch=fetcher;
 try{return await work();}finally{globalThis.fetch=oldFetch;for(const [name,value]of saved)if(value===undefined)delete process.env[name];else process.env[name]=value;}
}
async function request(route,{method='POST',body={},headers={},url='https://workspace.test/api/v4/'+route}={}){
 const streamed=body instanceof ReadableStream;
 const req=new NextRequest(url,{method,headers:{host:'workspace.test','content-type':'application/json',...headers},...(method==='POST'?{body:streamed?body:typeof body==='string'?body:JSON.stringify(body),...(streamed?{duplex:'half'}:{})}:{})});
 return(method==='POST'?POST:GET)(req,{params:Promise.resolve({path:route.split('?')[0].split('/')})});
}

test('cross-site writes and unknown paths fail before any service request',async()=>{
 let calls=0;await isolated(async()=>{calls++;throw new Error('SHOULD_NOT_FORWARD');},async()=>{
  for(const headers of [{origin:'https://attacker.test'},{'sec-fetch-site':'cross-site'}]){const response=await request('withdraw',{headers});assert.equal(response.status,403);assert.deepEqual(await response.json(),{error:'ORIGIN_MISMATCH'});}
  assert.equal((await request('internal/deploy')).status,404);assert.equal(calls,0);
 });
});

test('proxy bounds JSON requests including streams and rejects malformed bodies before forwarding',async()=>{
 let calls=0;await isolated(async()=>{calls++;throw new Error('SHOULD_NOT_FORWARD');},async()=>{
  assert.equal((await request('run',{headers:{'content-length':'64001'}})).status,413);
  let cancelled=false,index=0;const stream=new ReadableStream({pull(controller){index++;controller.enqueue(new Uint8Array(40000));},cancel(){cancelled=true;}},{highWaterMark:0});
  assert.equal((await request('run',{body:stream})).status,413);assert.equal(cancelled,true);assert.equal(index,2);
  assert.equal((await request('clear',{body:'{"broken"'})).status,400);assert.equal(calls,0);
 });
});

test('session creation keeps tokens in secure HTTP-only cookies and does not expose service credentials',async()=>{
 await isolated(async(_url,options)=>{assert.equal(options.headers['x-ach-service-token'],serviceSecret);assert.equal(options.redirect,'error');return new Response(JSON.stringify({token:sessionToken,session}));},async()=>{
  const response=await request('session',{headers:{origin:'https://workspace.test'}});assert.equal(response.status,200);assert.deepEqual(await response.json(),{ok:true,session});
  const cookie=response.headers.get('set-cookie');assert.ok(cookie.includes('HttpOnly'));assert.ok(cookie.includes('Secure'));assert.ok(cookie.includes('SameSite=lax'));assert.ok(!cookie.includes(serviceSecret));
 });
});

test('reopening a workspace avoids financial RPC reads and never replaces its cookie during an outage',async()=>{
 const headers={cookie:'ach-v4-session='+sessionToken};
 for(const status of [200,503,429,'timeout']){
  let calls=0;await isolated(async(url,options)=>{
   calls++;assert.equal(new URL(url).pathname,'/session');assert.equal(options.method??'GET','GET');assert.equal(options.headers.Authorization,'Bearer '+sessionToken);
   if(status==='timeout')throw new Error('fetch failed');
   return new Response(JSON.stringify(status===200?{session}:{error:'RPC_UNAVAILABLE'}),{status});
  },async()=>{
   const reply=await request('session',{headers});assert.equal(reply.status,status==='timeout'?503:status);assert.equal(calls,1);assert.equal(reply.headers.get('set-cookie'),null);
   assert.deepEqual(await reply.json(),status===200?{ok:true}:{error:status==='timeout'?'SERVICE_UNAVAILABLE':'RPC_UNAVAILABLE'});
  });
 }
 let calls=0;await isolated(async(url,options)=>{
  calls++;assert.equal(new URL(url).pathname,'/session');
  if(calls===1){assert.equal(options.method??'GET','GET');return new Response(JSON.stringify({error:'SESSION_EXPIRED'}),{status:401});}
  assert.equal(options.method,'POST');return new Response(JSON.stringify({token:sessionToken,session}));
 },async()=>{const reply=await request('session',{headers});assert.equal(reply.status,200);assert.equal(calls,2);assert.ok(reply.headers.get('set-cookie')?.includes('HttpOnly'));});
});

test('local sponsorship ignores spoofed forwarding headers; platform requests require a valid normalized IP',async()=>{
 const identities=[];await isolated(async(_url,options)=>{identities.push(JSON.parse(options.body).ip_hash);return new Response(JSON.stringify({token:sessionToken,session}));},async()=>{
  await request('session',{headers:{'x-forwarded-for':'192.0.2.1'}});await request('session',{headers:{'x-forwarded-for':'198.51.100.2'}});assert.equal(identities[0],identities[1]);
  process.env.VERCEL='1';assert.equal((await request('session',{headers:{'x-forwarded-for':'forged-client'}})).status,503);assert.equal(identities.length,2);
  assert.equal((await request('session',{headers:{'x-forwarded-for':'192.0.2.1, 198.51.100.2'}})).status,200);assert.notEqual(identities[2],identities[0]);
 });
});

test('invalid session replies and oversized or malformed downstream JSON never create a session cookie',async()=>{
 for(const response of [()=>new Response(JSON.stringify({token:'invalid',session})),()=>new Response('{}',{headers:{'content-length':'1000001'}}),()=>new Response(new Uint8Array([0xc0]))]){
  await isolated(async()=>response(),async()=>{const reply=await request('session');assert.equal(reply.status,503);assert.equal(reply.headers.get('set-cookie'),null);assert.deepEqual(await reply.json(),{error:'SERVICE_UNAVAILABLE'});});
 }
});

test('history cursors and session authorization remain bound to their owning backend request',async()=>{
 await isolated(async(url,options)=>{assert.equal(new URL(url).pathname,'/history');assert.equal(new URL(url).search,'?before=105');assert.equal(options.headers.Authorization,'Bearer '+sessionToken);return new Response(JSON.stringify({items:[],next_cursor:null}));},async()=>{
  const response=await request('history?before=105',{method:'GET',headers:{cookie:'ach-v4-session='+sessionToken}});assert.equal(response.status,200);assert.equal(response.headers.get('cache-control'),'no-store');
 });
 await isolated(async(_url,options)=>{assert.equal(options.headers.Authorization,undefined);return new Response(JSON.stringify({error:'SESSION_REQUIRED'}),{status:401});},async()=>assert.equal((await request('snapshot',{method:'GET'})).status,401));
});

test('workspace listing and changes require a valid session before any backend request',async()=>{
 let calls=0;await isolated(async()=>{calls++;throw new Error('SHOULD_NOT_FORWARD');},async()=>{
  for(const [route,method]of [['sessions','GET'],['session-new','POST'],['session-switch','POST']])assert.equal((await request(route,{method})).status,401);
  assert.equal(calls,0);
 });
});

test('fresh workspaces retain trusted sponsorship identity and replace only the HTTP-only session cookie',async()=>{
 const child={id:'c'.repeat(32)};await isolated(async(url,options)=>{
  assert.equal(new URL(url).pathname,'/session-new');assert.equal(options.headers.Authorization,'Bearer '+sessionToken);assert.deepEqual(Object.keys(JSON.parse(options.body)),['ip_hash']);assert.notEqual(JSON.parse(options.body).ip_hash,'spoofed');
  return new Response(JSON.stringify({session:child,token:'d'.repeat(64)}));
 },async()=>{
  const reply=await request('session-new',{body:{ip_hash:'spoofed'},headers:{cookie:'ach-v4-session='+sessionToken}});assert.equal(reply.status,200);assert.deepEqual(await reply.json(),{ok:true,session:child});const cookie=reply.headers.get('set-cookie');assert.ok(cookie.includes('HttpOnly'));assert.ok(cookie.includes('Secure'));assert.ok(!cookie.includes(serviceSecret));
 });
});

test('workspace switching binds the requested workspace and cannot set a cookie from a substituted or malformed reply',async()=>{
 const id='c'.repeat(32),headers={cookie:'ach-v4-session='+sessionToken};
 for(const returned of [{id},{id:'d'.repeat(32)},{}])await isolated(async(url,options)=>{assert.equal(new URL(url).pathname,'/session-switch');assert.deepEqual(JSON.parse(options.body),{session_id:id});return new Response(JSON.stringify({session:returned,token:'d'.repeat(64)}));},async()=>{
  const reply=await request('session-switch',{body:{session_id:id},headers});assert.equal(reply.status,returned.id===id?200:503);if(returned.id!==id)assert.equal(reply.headers.get('set-cookie'),null);
 });
});

test('verified web quote previews preserve settlement network and mainnet execution limits',async()=>{
 for(const route of ['config','snapshot']){
  const intents=route==='config'?{dry_quotes_enabled:false,mainnet_routes_exercised:false}:{enabled:false,network:'mainnet',routes_exercised:false};
  const payload={network:'testnet',vault:'fixture.testnet',intents};
  await isolated(async()=>new Response(JSON.stringify(payload)),async()=>{
   for(const setting of ['', 'false', 'true']){
    process.env.ACH_V4_INTENTS_QUOTE_PREVIEWS=setting;
    const reply=await request(route,{method:'GET',headers:{cookie:'ach-v4-session='+sessionToken}}),data=await reply.json();
    assert.equal(reply.status,200);assert.equal(data.network,'testnet');assert.equal(data.vault,'fixture.testnet');
    assert.deepEqual(data.intents,setting==='true'?{...intents,[route==='config'?'dry_quotes_enabled':'enabled']:true}:intents);
   }
  });
 }
});

test('quote-preview publication cannot change backend errors or quote execution data',async()=>{
 for(const [route,method,status,payload]of [
  ['snapshot','GET',503,{error:'SERVICE_UNAVAILABLE',intents:{enabled:false}}],
  ['intents/quote','POST',200,{dry:true,state:'QUOTED',network:'mainnet',request:{dry:true},intents:{enabled:false}}],
 ])await isolated(async()=>new Response(JSON.stringify(payload),{status}),async()=>{
  process.env.ACH_V4_INTENTS_QUOTE_PREVIEWS='true';
  const reply=await request(route,{method,headers:{cookie:'ach-v4-session='+sessionToken}});
  assert.equal(reply.status,status);assert.deepEqual(await reply.json(),payload);
 });
});
