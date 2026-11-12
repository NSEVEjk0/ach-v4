import {NextRequest,NextResponse}from 'next/server';import {createHash}from 'node:crypto';import {isIP}from 'node:net';
import {coordinatorUrl}from '../../../../lib/gateway';
import {boundedJson}from '../../../../lib/request';
export const dynamic='force-dynamic';export const maxDuration=60;
const GET_PATHS=new Set(['snapshot','history','config','services','private-key','sessions','intents/tokens']);const POST_PATHS=new Set(['session','session-new','session-switch','run','clear','clearing-policy','withdraw','revoke','settle','cancel','expire','recover','deposit','intents/quote','intents/status']);
async function proxy(req:NextRequest,context:{params:Promise<{path:string[]}>}){
 const route=(await context.params).path.join('/');const allowed=req.method==='GET'?GET_PATHS:POST_PATHS;
 if(!allowed.has(route))return NextResponse.json({error:'METHOD_NOT_FOUND'},{status:404});
 if(req.method==='POST'){
  // Next can normalize the URL host to localhost behind its local listener.
  // The browser's Host header identifies the origin it actually visited.
  const origin=req.headers.get('origin'),expected=new URL(req.url),host=req.headers.get('host');
  if(host)expected.host=host;
  if(origin&&origin!==expected.origin||req.headers.get('sec-fetch-site')==='cross-site')return NextResponse.json({error:'ORIGIN_MISMATCH'},{status:403});
 }
 const token=process.env.ACH_V4_SERVICE_TOKEN;
 if(!token)return NextResponse.json({error:'V4_NOT_DEPLOYED'},{status:503});
 let body:unknown;try{if(req.method==='POST')body=await boundedJson(req);}catch(error){const code=error instanceof Error&&error.message==='REQUEST_TOO_LARGE'?'REQUEST_TOO_LARGE':'INVALID_JSON';return NextResponse.json({error:code},{status:code==='REQUEST_TOO_LARGE'?413:400});}
 const session=req.cookies.get('ach-v4-session')?.value;
 if(['sessions','session-new','session-switch'].includes(route)&&!/^[a-f\d]{64}$/.test(session??''))return NextResponse.json({error:'SESSION_REQUIRED'},{status:401});
 try{
  const base=await coordinatorUrl();
  if(route==='session'&&session){const existing=await fetch(new URL('/snapshot',base),{headers:{'x-ach-service-token':token,Authorization:`Bearer ${session}`},cache:'no-store',redirect:'error',signal:AbortSignal.timeout(12000)});if(existing.ok)return NextResponse.json({ok:true});}
  if(route==='session'||route==='session-new'){
   // Trust the platform's normalized proxy header only in that platform.
   // A direct/local server shares a conservative bucket instead of accepting
   // arbitrary client-supplied forwarding headers as a sponsorship identity.
   const forwarded=process.env.VERCEL==='1'?req.headers.get('x-forwarded-for')?.split(',')[0].trim():undefined;
   if(process.env.VERCEL==='1'&&(!forwarded||!isIP(forwarded)))throw new Error('TRUSTED_CLIENT_IP_REQUIRED');
   body={ip_hash:createHash('sha256').update(`${token}:demo-ip:${forwarded??'local-proxy'}`).digest('hex')};
  }
  const target=new URL(`/${route}`,base);if(route==='history')target.search=req.nextUrl.search;
  const response=await fetch(target,{method:req.method,headers:{'Content-Type':'application/json','x-ach-service-token':token,...(session?{Authorization:`Bearer ${session}`}:{})},...(req.method==='POST'?{body:JSON.stringify(body)}:{}),cache:'no-store',redirect:'error',signal:AbortSignal.timeout(55000)});
  const data=await boundedJson(response,1_000_000) as Record<string,any>;
  if(['session','session-new','session-switch'].includes(route)&&response.ok){if(!/^[a-f\d]{64}$/.test(data.token)||route!=='session'&&!/^[a-f\d]{32}$/.test(data.session?.id)||route==='session-switch'&&data.session.id!==(body as Record<string,unknown>)?.session_id)throw new Error('SESSION_RESPONSE_INVALID');const result=NextResponse.json({ok:true,session:data.session});result.cookies.set('ach-v4-session',data.token,{httpOnly:true,secure:new URL(req.url).protocol==='https:'||process.env.VERCEL==='1',sameSite:'lax',path:'/',maxAge:86400});return result;}
  return NextResponse.json(data,{status:response.status,headers:{'Cache-Control':'no-store'}});
 }catch{return NextResponse.json({error:'SERVICE_UNAVAILABLE'},{status:503});}
}
export function GET(req:NextRequest,context:{params:Promise<{path:string[]}>}){return proxy(req,context)}
export function POST(req:NextRequest,context:{params:Promise<{path:string[]}>}){return proxy(req,context)}
