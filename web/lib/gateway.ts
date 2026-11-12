import {createPublicKey,verify}from 'node:crypto';
import {boundedJson}from './request';
let cached:{url:string;expires:number}|null=null;
export async function coordinatorUrl():Promise<string>{
 if(!process.env.ACH_V4_DISCOVERY_URL){const base=process.env.ACH_V4_COORDINATOR_URL;if(!base)throw new Error('V4_NOT_DEPLOYED');const url=new URL(base);if(url.protocol!=='https:'&&!(url.protocol==='http:'&&['localhost','127.0.0.1','[::1]'].includes(url.hostname))||url.username||url.password||url.search||url.hash)throw new Error('GATEWAY_URL_INVALID');return base;}
 if(cached&&cached.expires>Date.now())return cached.url;
 const response=await fetch(process.env.ACH_V4_DISCOVERY_URL,{cache:'no-store',signal:AbortSignal.timeout(12000)});if(!response.ok)throw new Error('GATEWAY_DISCOVERY_UNAVAILABLE');const record=await boundedJson(response,4096) as Record<string,any>;
 if(record.protocol_version!==4||record.network!==process.env.ACH_V4_NETWORK||record.vault!==process.env.ACH_V4_VAULT||!Number.isSafeInteger(record.published_at_ms)||!Number.isSafeInteger(record.expires_at_ms)||record.expires_at_ms<=Date.now()||record.expires_at_ms<=record.published_at_ms||record.published_at_ms>Date.now()+30000||record.expires_at_ms-record.published_at_ms>7*86400000)throw new Error('GATEWAY_RECORD_INVALID');
 const url=new URL(record.url);if(url.protocol!=='https:'||!url.hostname.endsWith('.trycloudflare.com')||url.pathname!=='/'||url.search||url.hash||url.port||url.username||url.password)throw new Error('GATEWAY_URL_INVALID');
 const keyHex=process.env.ACH_V4_DISCOVERY_KEY;if(!keyHex||!/^[a-f\d]{64}$/.test(keyHex))throw new Error('GATEWAY_SIGNER_INVALID');
 const key=createPublicKey({key:Buffer.concat([Buffer.from('302a300506032b6570032100','hex'),Buffer.from(keyHex,'hex')]),format:'der',type:'spki'});
 const message=Buffer.from(['ACH gateway v4',record.network,record.vault,record.url,String(record.published_at_ms),String(record.expires_at_ms)].join('\n'));
 if(!verify(null,message,key,Buffer.from(record.signature,'base64')))throw new Error('GATEWAY_SIGNATURE_INVALID');cached={url:record.url,expires:Math.min(Date.now()+15000,record.expires_at_ms)};return record.url;
}
