import {NextRequest,NextResponse}from 'next/server';import {createHash}from 'node:crypto';
import {coordinatorUrl}from '../../../../lib/gateway';
export const dynamic='force-dynamic';export const maxDuration=60;
const GET_PATHS=new Set(['snapshot','config','services','private-key','intents/tokens']);const POST_PATHS=new Set(['session','run','clear','withdraw','revoke','settle','cancel','expire','recover','deposit','intents/quote','intents/status']);
async function proxy(req:NextRequest,context:{params:Promise<{path:string[]}>}){
 const route=(await context.params).path.join('/');const allowed=req.method==='GET'?GET_PATHS:POST_PATHS;
 if(!allowed.has(route))return NextResponse.json({error:'METHOD_NOT_FOUND'},{status:404});
 if(req.method==='POST'){
  // Next can normalize the URL host to localhost behind its local listener.
  // The browser's Host header identifies the origin it actually visited.
  const origin=req.headers.get('origin'),expected=new URL(req.url),host=req.headers.get('host');
  if(host)expected.host=host;
  if(origin&&origin!==expected.origin)return NextResponse.json({error:'ORIGIN_MISMATCH'},{status:403});
 }
 const token=process.env.ACH_V4_SERVICE_TOKEN;
 if(!token)return NextResponse.json({error:'V4_NOT_DEPLOYED'},{status:503});
 let body:unknown;try{if(req.method==='POST')body=await req.json();}catch{return NextResponse.json({error:'INVALID_JSON'},{status:400});}
 if(JSON.stringify(body??{}).length>64000)return NextResponse.json({error:'REQUEST_TOO_LARGE'},{status:413});
 const session=req.cookies.get('ach-v4-session')?.value;
 try{
  const base=await coordinatorUrl();
  if(route==='session'&&session){const existing=await fetch(new URL('/snapshot',base),{headers:{'x-ach-service-token':token,Authorization:`Bearer ${session}`},cache:'no-store',signal:AbortSignal.timeout(12000)});if(existing.ok)return NextResponse.json({ok:true});}
  if(route==='session'){const forwarded=req.headers.get('x-forwarded-for')?.split(',')[0].trim()??'unknown';body={ip_hash:createHash('sha256').update(`${token}:demo-ip:${forwarded}`).digest('hex')};}
  const response=await fetch(new URL(`/${route}`,base),{method:req.method,headers:{'Content-Type':'application/json','x-ach-service-token':token,...(session?{Authorization:`Bearer ${session}`}:{})},...(req.method==='POST'?{body:JSON.stringify(body)}:{}),cache:'no-store',signal:AbortSignal.timeout(55000)});
  const data=await response.json();
  if(route==='session'&&response.ok){const result=NextResponse.json({ok:true,session:data.session});result.cookies.set('ach-v4-session',data.token,{httpOnly:true,secure:new URL(req.url).protocol==='https:',sameSite:'lax',path:'/',maxAge:86400});return result;}
  return NextResponse.json(data,{status:response.status,headers:{'Cache-Control':'no-store'}});
 }catch{return NextResponse.json({error:'SERVICE_UNAVAILABLE'},{status:503});}
}
export function GET(req:NextRequest,context:{params:Promise<{path:string[]}>}){return proxy(req,context)}
export function POST(req:NextRequest,context:{params:Promise<{path:string[]}>}){return proxy(req,context)}
