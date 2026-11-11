const encoder=new TextEncoder();
const base64=(bytes:Uint8Array)=>btoa(Array.from(bytes,b=>String.fromCharCode(b)).join(''));
const unbase64=(value:string)=>Uint8Array.from(atob(value),c=>c.charCodeAt(0));
const hex=(bytes:Uint8Array)=>Array.from(bytes,b=>b.toString(16).padStart(2,'0')).join('');
const unhex=(value:string)=>{if(!/^[a-f\d]+$/.test(value)||value.length%2)throw new Error('PRIVATE_KEY_INVALID');return Uint8Array.from(value.match(/../g)!,b=>parseInt(b,16));};
export interface ServiceEncryptionKey {public_key:string;account_id:string;session_id:string;algorithm:string;signature:string}
function canonical(purpose:string,network:string,vault:string,fields:string[]){const parts=['ACH','4',purpose,network,vault,...fields].map(s=>{const bytes=encoder.encode(s),part=new Uint8Array(bytes.length+4);new DataView(part.buffer).setUint32(0,bytes.length);part.set(bytes,4);return part;});const all=new Uint8Array(parts.reduce((n,p)=>n+p.length,0));let cursor=0;for(const p of parts){all.set(p,cursor);cursor+=p.length;}return all;}
async function sharedKey(privateKey:CryptoKey,peerHex:string){const peer=await crypto.subtle.importKey('raw',unhex(peerHex),{name:'X25519'},false,[]);const shared=await crypto.subtle.deriveBits({name:'X25519',public:peer},privateKey,256);const hkdf=await crypto.subtle.importKey('raw',shared,'HKDF',false,['deriveKey']);return crypto.subtle.deriveKey({name:'HKDF',hash:'SHA-256',salt:new Uint8Array(),info:encoder.encode('ach-private-brief-v4')},hkdf,{name:'AES-GCM',length:256},false,['encrypt','decrypt']);}
export async function verifyServiceKey(config:{network:string;vault:string;rpc_url:string;rpc_urls?:string[]},sessionId:string,accountId:string,key:ServiceEncryptionKey){
 if(key.account_id!==accountId||key.session_id!==sessionId||key.algorithm!=='X25519-HKDF-SHA256-AES-256-GCM'||!/^[a-f\d]{64}$/.test(key.public_key))throw new Error('PRIVATE_KEY_INVALID');
 // The browser independently verifies the signer on the public chain. A
 // failed browser RPC must not force it to trust a relay-supplied policy.
 const endpoints=[...new Set([config.rpc_url,...(config.rpc_urls??[]),...(config.network==='testnet'?['https://test.rpc.fastnear.com']:[])])].slice(0,3);
 const body=JSON.stringify({jsonrpc:'2.0',id:'verify-service-key',method:'query',params:{request_type:'call_function',finality:'final',account_id:config.vault,method_name:'get_balance',args_base64:base64(encoder.encode(JSON.stringify({account_id:accountId})))}});
 let account;
 for(const endpoint of endpoints){try{
  const response=await fetch(endpoint,{method:'POST',headers:{'Content-Type':'application/json'},body,signal:AbortSignal.timeout(6000)}),rpc=await response.json();
  if(!response.ok||!Array.isArray(rpc.result?.result))continue;
  account=JSON.parse(new TextDecoder().decode(Uint8Array.from(rpc.result.result)));break;
 }catch{}}
 if(!account)throw new Error('PRIVATE_KEY_VERIFICATION_UNAVAILABLE');
 const policy=account.policy;
 if(!policy||policy.revoked||policy.expires_at_ms<=Date.now())throw new Error('PRIVATE_KEY_INVALID');
 const signer=await crypto.subtle.importKey('raw',unhex(policy.key),{name:'Ed25519'},false,['verify']),binding=await crypto.subtle.digest('SHA-256',canonical('service-encryption-key',config.network,config.vault,[sessionId,accountId,key.public_key]));
 if(!await crypto.subtle.verify('Ed25519',signer,unbase64(key.signature),binding))throw new Error('PRIVATE_KEY_INVALID');
}
export async function sealBrief(network:string,vault:string,sessionId:string,requestId:string,publicKey:string,brief:string,data:{label:string;value:number}[]){
 const pair=await crypto.subtle.generateKey({name:'X25519'},true,['deriveBits'])as CryptoKeyPair,key=await sharedKey(pair.privateKey,publicKey),nonce=crypto.getRandomValues(new Uint8Array(12));
 const ciphertext=await crypto.subtle.encrypt({name:'AES-GCM',iv:nonce,additionalData:canonical('private-brief',network,vault,[sessionId,requestId])},key,encoder.encode(JSON.stringify({brief,data})));
 localStorage.setItem('ach-private-key:'+sessionId+':'+requestId,JSON.stringify({private_key:await crypto.subtle.exportKey('jwk',pair.privateKey),peer:publicKey}));
 return{ephemeral_public_key:hex(new Uint8Array(await crypto.subtle.exportKey('raw',pair.publicKey))),nonce:hex(nonce),ciphertext:base64(new Uint8Array(ciphertext))};
}
export async function openResult<T>(network:string,vault:string,sessionId:string,response:{request_id:string;nonce:string;ciphertext:string}):Promise<T>{
 const saved=localStorage.getItem('ach-private-key:'+sessionId+':'+response.request_id);if(!saved)throw new Error('PRIVATE_BROWSER_KEY_REQUIRED');const entry=JSON.parse(saved),privateKey=await crypto.subtle.importKey('jwk',entry.private_key,{name:'X25519'},false,['deriveBits']),key=await sharedKey(privateKey,entry.peer);
 const clear=await crypto.subtle.decrypt({name:'AES-GCM',iv:unhex(response.nonce),additionalData:canonical('private-result',network,vault,[sessionId,response.request_id])},key,unbase64(response.ciphertext));return JSON.parse(new TextDecoder().decode(clear));
}
