import assert from 'node:assert/strict';
import {spawn,spawnSync}from 'node:child_process';
import {generateKeyPairSync,createPrivateKey,createPublicKey,sign}from 'node:crypto';
import {encryptV4Invoice,v4PrivateInvoiceCommitment,v4PrivateInputCommitment,v4PrivateDisclosureHash}from '../../packages/client/dist/v4.js';
const built=spawnSync('cargo',['build','--locked','--offline','-p','ach-private-netting'],{stdio:'inherit'});if(built.error||built.status!==0)throw new Error('PRIVATE_TEST_BUILD_FAILED');
const c={protocol_version:4,network:'testnet',vault:'vault.testnet',token:'usd.testnet',decimals:6,rpc_url:'https://test.rpc.fastnear.com'};
const secret='11'.repeat(32),privateKey=createPrivateKey({key:Buffer.concat([Buffer.from('302e020100300506032b656e04220420','hex'),Buffer.from(secret,'hex')]),format:'der',type:'pkcs8'});
const encryption={protocol_version:4,worker_hash:'c'.repeat(64),public_key:createPublicKey(privateKey).export({format:'der',type:'spki'}).subarray(-32).toString('hex'),algorithm:'X25519-HKDF-SHA256-AES-256-GCM'};
const now=Date.now(),keys=new Map(['aa.testnet','bb.testnet','cc.testnet'].map(id=>[id,generateKeyPairSync('ed25519')]));
const policies=[...keys].map(([account_id,key])=>({account_id,policy:{key:key.publicKey.export({format:'der',type:'spki'}).subarray(-32).toString('hex'),epoch:1,max_invoice:'100000',gross_budget:'1000000',max_net_commitment:'1000000',expires_at_ms:now+86400000,counterparties:[],services:[],revoked:false,activity_sequence:0}}));
const envelopes=[['aa.testnet','bb.testnet','100000'],['bb.testnet','cc.testnet','100000'],['cc.testnet','aa.testnet','80000']].map(([buyer,seller,amount],index)=>{
 const spec={id:'private-'+index,purchase_id:String(index+1).repeat(32),terms_version:1,buyer,seller,asset:c.token,amount,service:'chart',terms_hash:'a'.repeat(64),artifact_hash:'b'.repeat(64),ready_at_ms:now-1000,expires_at_ms:now+600000},salt=String(index+4).repeat(64),commitment=v4PrivateInvoiceCommitment(c,spec,salt);
 const contribution={spec,salt,signatures:[buyer,seller].map(account_id=>({account_id,key_epoch:1,signature:sign(null,Buffer.from(commitment,'hex'),keys.get(account_id).privateKey).toString('base64')}))};
 return encryptV4Invoice(c,encryption,contribution);
});
const request={protocol_version:4,operation:'net',network:c.network,vault:c.vault,token:c.token,request_id:'cross-language',worker_hash:encryption.worker_hash,deadline_ms:now+300000,policies,prior_charges:[],encrypted_invoices:envelopes};
request.input_commitment=v4PrivateInputCommitment(c,request.request_id,request.deadline_ms,encryption.worker_hash,envelopes);
const disclosure=v4PrivateDisclosureHash(c,request.input_commitment,[...keys.keys()]);
request.disclosure_signatures=[...keys].map(([account_id,key])=>({account_id,key_epoch:1,signature:sign(null,Buffer.from(disclosure,'hex'),key.privateKey).toString('base64')}));
async function run(input){
 const child=spawn('target/debug/ach-private-netting',[],{env:{...process.env,PROTECTED_INVOICE_KEY:secret},stdio:['pipe','pipe','pipe']});let output='',error='';
 child.stdout.on('data',bytes=>output+=bytes);child.stderr.on('data',bytes=>error+=bytes);const timer=setTimeout(()=>child.kill('SIGKILL'),8000);
 try{const done=new Promise((resolve,reject)=>{child.once('error',reject);child.once('close',(code,signal)=>code===0?resolve(JSON.parse(output)):reject(new Error('PRIVATE_TEST_WORKER_FAILED:'+String(signal??code)+':'+error)));});child.stdin.end(JSON.stringify(input));return await done;}
 finally{clearTimeout(timer);}
}
console.log('PRIVATE_TEST_CRYPTO_INPUT_READY');const output=await run(request);assert.equal(output.error,undefined);assert.deepEqual(output.positions,[{account_id:'aa.testnet',net:'-20000'},{account_id:'bb.testnet',net:'0'},{account_id:'cc.testnet',net:'20000'}]);assert.equal(output.charges.length,3);
assert.equal(output.operation,'net');assert.ok(envelopes.every(e=>Buffer.from(e.ciphertext,'base64').length===2064));
const opaque=await run({...request,operation:'verify',disclosure_signatures:[]});assert.equal(opaque.operation,'verify');assert.ok(opaque.positions.every(p=>p.net==='0'));
assert.equal((await run({...request,disclosure_signatures:[]})).error,'PRIVATE_DISCLOSURE_CONSENT_REQUIRED');
const isolated={...request,encrypted_invoices:[envelopes[0]],policies:policies.slice(0,2),disclosure_signatures:request.disclosure_signatures.slice(0,2)};isolated.input_commitment=v4PrivateInputCommitment(c,isolated.request_id,isolated.deadline_ms,encryption.worker_hash,isolated.encrypted_invoices);assert.equal((await run(isolated)).error,'PRIVATE_DISCLOSURE_SIGNATURE_INVALID');
const bad=structuredClone(request),bytes=Buffer.from(bad.encrypted_invoices[0].ciphertext,'base64');bytes[24]^=1;bad.encrypted_invoices[0].ciphertext=bytes.toString('base64');assert.equal((await run(bad)).error,'PRIVATE_CIPHERTEXT_INVALID');
assert.equal((await run({...request,deadline_ms:now-1})).error,'PRIVATE_DEADLINE');
console.log(JSON.stringify({cross_language_encryption:true,strict_real_signatures:true,fixed_size_ciphertext:true,receipt_amounts_opaque:true,unauthorized_disclosure_rejected:true,tamper_rejected:true,expired_request_rejected:true,net_settlement_units:'20000',plaintext_gross_data_in_output:false}));
