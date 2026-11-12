import test from 'node:test';
import assert from 'node:assert/strict';
import {generateKeyPairSync,sign,randomBytes}from 'node:crypto';
import {Account,KeyPair,actions,baseEncode,SignedTransaction}from '../../packages/client/dist/near.js';
import {AchV4Client,V4NearTransport,V4MemoryJournal,V4BroadcastUnknown}from '../../packages/client/dist/v4.js';
import {durableActions}from '../../services/lib/transactions.mjs';
import {secretEqual,serviceFetch,readJson}from '../../services/lib/http.mjs';
import {localWebModules}from './web-modules.mjs';

const modules=localWebModules();test.after(()=>modules.cleanup());
const {boundedJson}=await import(modules.url('request')),{buildHistory,historyCsv}=await import(modules.url('history'));
const config={protocol_version:4,workflow_revision:2,network:'testnet',vault:'vault.testnet',token:'usd.testnet',decimals:6,rpc_url:'https://test.rpc.fastnear.com',code_hash:'pinned-build'};
const skeleton=()=>({session:{id:'session',participants:[{account_id:'aa.testnet',name:'Agent A'}]},jobs:[],rounds:[],events:[],private_invoices:[],owner_operations:[],account_activity:[]});

test('JSON limits stop oversized declared and chunked bodies before complete buffering',async()=>{
 let reads=0;const early={headers:new Headers({'content-length':'64001'}),body:new ReadableStream({pull(){reads++;}},{highWaterMark:0})};
 await assert.rejects(boundedJson(early),/REQUEST_TOO_LARGE/);assert.equal(reads,0);
 let cancelled=false,index=0;const chunks=[new Uint8Array(40000),new Uint8Array(30000),new Uint8Array(40000)];
 const stream=new ReadableStream({pull(controller){if(index<chunks.length)controller.enqueue(chunks[index++]);else controller.close();},cancel(){cancelled=true;}},{highWaterMark:0});
 await assert.rejects(boundedJson({headers:new Headers(),body:stream}),/REQUEST_TOO_LARGE/);assert.equal(cancelled,true);assert.equal(index,2);
 const valid=new Response(JSON.stringify({label:'€',amount:'1'}));assert.deepEqual(await boundedJson(valid),{label:'€',amount:'1'});
 await assert.rejects(boundedJson(new Response(new Uint8Array([123,34,120,34,58,34,0xc0,34,125]))),/INVALID_JSON/);
});

test('History reconciles transfer states and never relabels a confirmed token refund as credit',()=>{
 const data=skeleton();data.events=[{sequence:1,at_ms:1,kind:'deposit-requested',reference:'deposit-one',data:{account_id:'aa.testnet',amount:'10',operation_id:'deposit:one'}},{sequence:2,at_ms:2,kind:'deposit-failed',reference:'deposit-one',data:{account_id:'aa.testnet',amount:'10',operation_id:'deposit:one'}}];
 data.owner_operations=[{id:'deposit:one',account_id:'aa.testnet',state:'CONFIRMED',tx_hash:'refunded',evidence:'near_final',value:'0',amount:'10'}];
 let entries=buildHistory(data,[],{});assert.equal(entries.length,1);assert.equal(entries[0].status,'FAILED');assert.equal(entries[0].state,'failed');
 data.events=[];data.owner_operations[0].value='10';entries=buildHistory(data,[],{});assert.equal(entries[0].status,'COMPLETED');assert.equal(entries[0].tx,'refunded');
 data.owner_operations=[];data.account_activity=[{account_id:'aa.testnet',sequence:1,at_ms:2,kind:'withdrawal-restored',reference:'withdraw-one',amount:'10'}];entries=buildHistory(data,[],{});assert.equal(entries[0].status,'RESTORED');assert.match(entries[0].description,/funds returned/);
 data.account_activity[0].kind='withdrawal-completed';entries=buildHistory(data,[],{});assert.equal(entries[0].status,'COMPLETED');
});

test('CSV cells neutralize formulas including whitespace and Unicode-prefixed payloads',()=>{
 const entries=['=HYPERLINK("https://attacker.test")',' +SUM(1,2)','\uFEFF@SUM(1,2)','\t-SUM(1,2)','plain text'].map((title,index)=>({timestamp:1,kind:'work',title,description:'safe',status:'COMPLETED',amountLabel:'',amount:null,reference:String(index)}));
 const csv=historyCsv(entries);assert.match(csv,/"'=HYPERLINK/);assert.match(csv,/"' \+SUM/);assert.match(csv,/"'\uFEFF@SUM/);assert.match(csv,/"'\t-SUM/);assert.match(csv,/"plain text"/);
});

test('signed gateway discovery rejects expiry, substitutions and unsafe destinations; cache obeys signed expiry',async()=>{
 const pair=generateKeyPairSync('ed25519'),key=pair.publicKey.export({format:'der',type:'spki'}).subarray(-32).toString('hex');
 const names=['ACH_V4_DISCOVERY_URL','ACH_V4_DISCOVERY_KEY','ACH_V4_NETWORK','ACH_V4_VAULT'],saved=new Map(names.map(name=>[name,process.env[name]])),oldFetch=globalThis.fetch,oldNow=Date.now;let now=1800000000000;
 Object.assign(process.env,{ACH_V4_DISCOVERY_URL:'https://discovery.test/record',ACH_V4_DISCOVERY_KEY:key,ACH_V4_NETWORK:'testnet',ACH_V4_VAULT:'vault.testnet'});Date.now=()=>now;
 const signed=overrides=>{const record={protocol_version:4,network:'testnet',vault:'vault.testnet',url:'https://bounded-gateway.trycloudflare.com/',published_at_ms:now,expires_at_ms:now+5000,...overrides};record.signature=sign(null,Buffer.from(['ACH gateway v4',record.network,record.vault,record.url,String(record.published_at_ms),String(record.expires_at_ms)].join('\n')),pair.privateKey).toString('base64');return record;};
 let record=signed({}),reads=0;globalThis.fetch=async()=>{reads++;return new Response(JSON.stringify(record));};
 try{
  const {coordinatorUrl}=await import(modules.url('gateway')+'?cache-case');assert.equal(await coordinatorUrl(),record.url);now+=4000;await coordinatorUrl();assert.equal(reads,1);now+=1000;await assert.rejects(coordinatorUrl(),/GATEWAY_RECORD_INVALID/);assert.equal(reads,2);
  for(const [index,overrides]of [{url:'https://attacker.test/'},{url:'https://trusted.trycloudflare.com@attacker.test/'},{url:'https://bounded-gateway.trycloudflare.com/private'},{network:'mainnet'},{vault:'other.testnet'},{expires_at_ms:now},{published_at_ms:now+31000}].entries()){
   record=signed(overrides);const reader=(await import(modules.url('gateway')+'?invalid-'+index)).coordinatorUrl;await assert.rejects(reader(),/GATEWAY_(?:RECORD|URL)_INVALID/);
  }
  record=signed({});record.signature=randomBytes(64).toString('base64');await assert.rejects((await import(modules.url('gateway')+'?signature')).coordinatorUrl(),/GATEWAY_SIGNATURE_INVALID/);
 }finally{Date.now=oldNow;globalThis.fetch=oldFetch;for(const [name,value]of saved)if(value===undefined)delete process.env[name];else process.env[name]=value;}
});

function stubRpc(transport,nonce){
 transport.provider.viewAccessKey=async()=>({nonce:nonce.value,permission:'FullAccess'});transport.provider.viewBlock=async()=>({header:{hash:baseEncode(new Uint8Array(32))}});
 transport.provider.sendTransactionUntil=async signed=>{const current=BigInt(signed.transaction.nonce);assert.equal(current,nonce.value+1n,'two wrappers reused a nonce');await new Promise(resolve=>setTimeout(resolve,5));nonce.value=current;return{status:{SuccessValue:Buffer.from('"done"').toString('base64')}};};
}
test('transport instances and action batches sharing one signer serialize fresh nonces',async()=>{
 const journal=new V4MemoryJournal(),secret=KeyPair.fromRandom('ed25519').toString(),a=new V4NearTransport('aa.testnet',config.rpc_url,secret,journal),b=new V4NearTransport('aa.testnet',config.rpc_url,secret,journal),nonce={value:0n};stubRpc(a,nonce);stubRpc(b,nonce);
 const result=await Promise.all([a.call(config.vault,'noop',{}, {operation_id:'one'}),b.call(config.vault,'noop',{}, {operation_id:'two'}),durableActions(a.account,journal,'three',config.vault,[actions.functionCall('noop',{},1000000000000n,0n)])]);assert.equal(result.length,3);assert.equal(nonce.value,3n);
});

test('durable action journals bind the signer and do not mark incomplete publication as final',async()=>{
 const journal=new V4MemoryJournal(),a=new V4NearTransport('aa.testnet',config.rpc_url,KeyPair.fromRandom('ed25519').toString(),journal),b=new V4NearTransport('bb.testnet',config.rpc_url,KeyPair.fromRandom('ed25519').toString(),journal),nonce={value:0n};stubRpc(a,nonce);
 const action=[actions.transfer(1n)];await durableActions(a.account,journal,'same-id',config.vault,action);await assert.rejects(durableActions(b.account,journal,'same-id',config.vault,action),/REQUEST_ID_CONFLICT/);
 const publication=[actions.functionCall('__fastdata_fastfs',Buffer.from('public data'),1n,0n)];a.provider.sendTransactionUntil=async()=>({status:'Started'});await assert.rejects(durableActions(a.account,journal,'publication','outlayer.testnet',publication,{recordedFastFS:true}),V4BroadcastUnknown);assert.equal((await journal.get('publication')).state,'UNKNOWN');
 a.provider.viewTransactionStatus=async()=>({final_execution_status:'EXECUTED',status:{Failure:{ExecutionError:'reverts by design'}}});await assert.rejects(durableActions(a.account,journal,'publication','outlayer.testnet',publication,{recordedFastFS:true}),V4BroadcastUnknown);assert.equal((await journal.get('publication')).state,'UNKNOWN');
 a.provider.viewTransactionStatus=async()=>({final_execution_status:'FINAL',status:{Failure:{ExecutionError:'reverts by design'}}});assert.equal((await durableActions(a.account,journal,'publication','outlayer.testnet',publication,{recordedFastFS:true})).evidence,'near_final');
});

test('a client rechecks the pinned vault and workflow revision before a write',async()=>{
 let current={...config,vault:config.vault},code='pinned-build',writes=0;const transport={account_id:'aa.testnet',view:async()=>current,codeHash:async()=>code,call:async()=>{writes++;return{value:{},evidence:'local_wasm'};}},client=new AchV4Client(config,transport,'owner');
 await client.assertDeployment();code='changed-build';await assert.rejects(client.revokeAgent('one'),/DEPLOYED_CODE_HASH_MISMATCH/);assert.equal(writes,0);
 code='pinned-build';current={...current,workflow_revision:1};await assert.rejects(client.revokeAgent('two'),/WORKFLOW_REVISION_MISMATCH/);assert.equal(writes,0);
 current={...config};const unverified=new AchV4Client(config,{...transport,codeHash:undefined},'owner');await assert.rejects(unverified.revokeAgent('three'),/CODE_HASH_VERIFICATION_REQUIRED/);assert.equal(writes,0);
});

test('service requests require exact secrets, disallow redirects and reject invalid UTF-8',async()=>{
 assert.equal(secretEqual('a'.repeat(64),'b'.repeat(64)),false);assert.equal(secretEqual('a'.repeat(64),'a'.repeat(64)),true);assert.equal(secretEqual(undefined,'a'.repeat(64)),false);
 const oldFetch=globalThis.fetch;globalThis.fetch=async(url,options)=>{assert.equal(options.redirect,'error');return new Response('{}');};
 try{await serviceFetch('http://127.0.0.1','a'.repeat(64))('/','payload');}finally{globalThis.fetch=oldFetch;}
 const req={headers:{},async *[Symbol.asyncIterator](){yield Buffer.from([123,34,120,34,58,34,0xc0,34,125]);}};await assert.rejects(readJson(req),/INVALID_JSON/);
});
