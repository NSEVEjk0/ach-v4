import {createServer}from 'node:http';
import {timingSafeEqual}from 'node:crypto';
export function secretEqual(a,b){if(typeof a!=='string'||typeof b!=='string')return false;const x=Buffer.from(a),y=Buffer.from(b);return x.length===y.length&&timingSafeEqual(x,y);}
export async function readJson(req){const length=req.headers?.['content-length'];if(length&&/^\d+$/.test(length)&&Number(length)>64_000)throw new Error('REQUEST_TOO_LARGE');let size=0;const chunks=[];for await(const chunk of req){size+=chunk.length;if(size>64_000)throw new Error('REQUEST_TOO_LARGE');chunks.push(chunk);}try{return JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(Buffer.concat(chunks))||'{}');}catch{throw new Error('INVALID_JSON');}}
export function serve({port,token,handle}){
 if(!token||token.length<32)throw new Error('PRIVATE_SERVICE_TOKEN_REQUIRED');
 const server=createServer(async(req,res)=>{
  res.setHeader('Content-Type','application/json');res.setHeader('Cache-Control','no-store');res.setHeader('X-Content-Type-Options','nosniff');
  try{const url=new URL(req.url,'http://localhost');if(url.pathname==='/health'&&req.method==='GET'){res.end(JSON.stringify({ok:true,protocol_version:4}));return;}
   if(!secretEqual(req.headers['x-ach-service-token'],token)){res.statusCode=403;res.end(JSON.stringify({error:'SERVICE_AUTHENTICATION_REQUIRED'}));return;}
   const result=await handle(req,url);res.end(JSON.stringify(result));
  }catch(error){const code=/^[A-Z_\d]+$/.test(error.message)?error.message:'SERVICE_UNAVAILABLE';res.statusCode=/SESSION_REQUIRED|SESSION_EXPIRED/.test(code)?401:/QUOTA|BUDGET|RATE_LIMITED/.test(code)?429:/UNAVAILABLE|UNKNOWN/.test(code)?503:400;res.end(JSON.stringify({error:code}));}
 });server.requestTimeout=30_000;server.headersTimeout=10_000;server.maxRequestsPerSocket=100;server.listen(port,'127.0.0.1');return server;
}
export function serviceFetch(base,token){return async(path,body,sessionToken)=>{const r=await fetch(new URL(path,base),{method:body?'POST':'GET',headers:{'Content-Type':'application/json','x-ach-service-token':token,...(sessionToken?{Authorization:`Bearer ${sessionToken}`}:{})},...(body?{body:JSON.stringify(body)}:{}),redirect:'error',signal:AbortSignal.timeout(150_000)});const data=await r.json();if(!r.ok)throw new Error(data.error??'SERVICE_UNAVAILABLE');return data;};}
export function sessionBearer(req){const header=req.headers.authorization??'';if(!/^Bearer [a-f\d]{64}$/.test(header))throw new Error('SESSION_REQUIRED');return header.slice(7);}
