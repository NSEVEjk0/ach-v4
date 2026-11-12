import {existsSync,readFileSync,writeFileSync,renameSync}from 'node:fs';

const kind='ach-browser-checkpoint';
function validate(value,binding){
 if(value?.kind!==kind||['url','vault','code_hash'].some(field=>value[field]!==binding[field]))throw new Error('BROWSER_CHECKPOINT_RUNTIME_MISMATCH');
 if(!/^[a-f\d]{32}$/.test(value.session_id??'')||!value.requests||typeof value.requests!=='object'||Array.isArray(value.requests)||!Array.isArray(value.storage_state?.cookies)||!Array.isArray(value.storage_state?.origins))throw new Error('BROWSER_CHECKPOINT_INVALID');
 const origin=new URL(binding.url).origin,host=new URL(binding.url).hostname;
 if(!value.storage_state.cookies.some(cookie=>cookie.name==='ach-v4-session'&&typeof cookie.domain==='string'&&cookie.domain.replace(/^\./,'')===host&&/^[a-f\d]{64}$/.test(cookie.value)))throw new Error('BROWSER_CHECKPOINT_SESSION_COOKIE_REQUIRED');
 if(Object.entries(value.requests).some(([name,request])=>!['public','private','withdraw','deposit'].includes(name)||!/^[a-f\d-]{16,40}$/.test(request?.request_id??'')))throw new Error('BROWSER_CHECKPOINT_REQUEST_INVALID');
 const privateRequest=value.requests.private;
 if(privateRequest){
  const key='ach-private-key:'+value.session_id+':'+privateRequest.request_id;
  if(privateRequest.privacy!=='private'||!privateRequest.sealed_brief?.ciphertext||!value.storage_state.origins.some(entry=>entry.origin===origin&&Array.isArray(entry.localStorage)&&entry.localStorage.some(item=>item.name===key&&item.value)))throw new Error('BROWSER_PRIVATE_CHECKPOINT_KEY_REQUIRED');
 }
 return value;
}

export function readBrowserCheckpoint(filename,binding){
 if(!existsSync(filename))return;
 let value;try{value=JSON.parse(readFileSync(filename,'utf8'));}catch{throw new Error('BROWSER_CHECKPOINT_INVALID');}
 return validate(value,binding);
}

// One atomic file keeps requests, the owning cookie and browser decryption
// keys together. The legacy files remain convenient private inspection copies.
export function writeBrowserCheckpoint(filename,binding,{session_id,requests,storage_state}){
 const value=validate({kind,...binding,session_id,requests,storage_state,saved_at:new Date().toISOString()},binding);
 const pending=filename+'.pending';
 writeFileSync(pending,JSON.stringify(value),{mode:0o600});renameSync(pending,filename);
 return value;
}

export function redactBrowserMessage(message){
 return String(message)
  .replace(/(\b(?:cookie|set-cookie|authorization|proxy-authorization|x-ach-service-token|x-vercel-protection-bypass)\s*:\s*)[^\r\n]*/gi,'$1[redacted]')
  .replace(/(ach-v4-session=)[^\s;"']+/gi,'$1[redacted]')
  .replace(/\bBearer\s+[A-Za-z0-9._~+\/-]+/gi,'Bearer [redacted]')
  .replace(/([?&](?:token|secret|api_key|key)=)[^\s&#"']+/gi,'$1[redacted]')
  .replace(/ed25519:[1-9A-HJ-NP-Za-km-z]{85,}|\bsk-(?:proj-)?[A-Za-z0-9_-]{35,}/g,'[redacted]');
}

export function retryableBrowserRead(error){
 return error?.name==='TimeoutError'||/UNAVAILABLE|UNKNOWN|ECONNREFUSED|ECONNRESET|ETIMEDOUT|EAI_AGAIN|fetch failed|\b(?:429|502|503|504)\b|Timeout|ERR_CONNECTION_(?:CLOSED|RESET)/.test(String(error?.message));
}
