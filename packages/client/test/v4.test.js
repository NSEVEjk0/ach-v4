import test from 'node:test';import assert from 'node:assert/strict';
import { generateKeyPairSync, sign } from 'node:crypto';
import { canonicalV4, parseTestUSD, formatTestUSD, validateV4Deployment, v4NetPlan, verifyV4InvoiceSignature, v4Digest, V4NearTransport, V4MemoryJournal, V4BroadcastUnknown, encryptV4Invoice, v4PrivateDisclosureHash } from '../dist/v4.js';
import {KeyPair,baseEncode}from '../dist/near.js';
test('strict six-decimal amounts preserve exact approvals',()=>{assert.equal(parseTestUSD('0.000001'),'1');assert.equal(formatTestUSD('100001'),'0.100001');for(const v of ['-1','NaN','1e4','01','0.0000001','1.',' .2'])assert.throws(()=>parseTestUSD(v));});
test('v4 refuses legacy and mismatched runtime configuration',()=>{assert.throws(()=>validateV4Deployment({protocol_version:4,network:'testnet',vault:'ach-clearing-v2.testnet',token:'usd.testnet',decimals:6,rpc_url:'https://test.rpc.fastnear.com'}),/LEGACY/);assert.throws(()=>validateV4Deployment({protocol_version:4,network:'mainnet',vault:'vault.testnet',token:'usd.near',decimals:6,rpc_url:'https://rpc.mainnet.near.org'}),/NETWORK/);});
test('canonical byte encoding has a fixed golden vector',()=>{assert.equal(Buffer.from(canonicalV4('x','testnet','vault.testnet',['a','10'])).toString('hex'),'000000034143480000000134000000017800000007746573746e65740000000d7661756c742e746573746e65740000000161000000023130');});
test('independent Ed25519 signatures bind invoice hashes, keys and domains',()=>{const {publicKey,privateKey}=generateKeyPairSync('ed25519');const keyHex=publicKey.export({type:'spki',format:'der'}).subarray(-32).toString('hex');const h=v4Digest('signed invoice');const signature=sign(null,Buffer.from(h,'hex'),privateKey).toString('base64');assert.equal(verifyV4InvoiceSignature(keyHex,h,signature),true);assert.equal(verifyV4InvoiceSignature(keyHex,v4Digest('different invoice'),signature),false);});
test('net result includes zero positions and rejects rebilled purchases',()=>{const bills=[{id:'1',purchase_id:'one',terms_version:1,buyer:'aa',seller:'bb',amount:'100'},{id:'2',purchase_id:'two',terms_version:1,buyer:'bb',seller:'cc',amount:'100'},{id:'3',purchase_id:'three',terms_version:1,buyer:'cc',seller:'aa',amount:'80'}];const r=v4NetPlan(bills);assert.equal(r.net_settlement_volume,'20');assert.deepEqual(r.positions,[{account_id:'aa',net:'-20'},{account_id:'bb',net:'0'},{account_id:'cc',net:'20'}]);assert.throws(()=>v4NetPlan([bills[0],{...bills[0],id:'other'}]),/DUPLICATE_PURCHASE/);});
test('private invoice size conceals price and string lengths; disclosure binds the group and domain',()=>{
 const c={protocol_version:4,network:'testnet',vault:'vault.testnet',token:'usd.testnet',decimals:6,rpc_url:'https://test.rpc.fastnear.com'},pair=generateKeyPairSync('x25519');
 const key={protocol_version:4,worker_hash:'c'.repeat(64),public_key:pair.publicKey.export({format:'der',type:'spki'}).subarray(-32).toString('hex'),algorithm:'X25519-HKDF-SHA256-AES-256-GCM'};
 const contribution={spec:{id:'one',purchase_id:'a'.repeat(32),terms_version:1,buyer:'aa.testnet',seller:'bb.testnet',asset:c.token,amount:'1',service:'chart',terms_hash:'b'.repeat(64),artifact_hash:'d'.repeat(64),ready_at_ms:1,expires_at_ms:2},salt:'e'.repeat(64),signatures:['aa.testnet','bb.testnet'].map(account_id=>({account_id,key_epoch:1,signature:'A'.repeat(88)}))};
 const small=encryptV4Invoice(c,key,contribution);contribution.spec.amount='999999';contribution.spec.id='long-id-'.repeat(10);const large=encryptV4Invoice(c,key,contribution);
 assert.equal(small.ciphertext.length,large.ciphertext.length);assert.equal(Buffer.from(large.ciphertext,'base64').length,2064);
 contribution.signatures[0].signature='A'.repeat(3000);assert.throws(()=>encryptV4Invoice(c,key,contribution),/TOO_LARGE/);
 const members=['aa.testnet','bb.testnet'],h=v4PrivateDisclosureHash(c,'f'.repeat(64),members);assert.equal(h,v4PrivateDisclosureHash(c,'f'.repeat(64),members.toReversed()));assert.notEqual(h,v4PrivateDisclosureHash({...c,network:'mainnet'},'f'.repeat(64),members));assert.notEqual(h,v4PrivateDisclosureHash(c,'f'.repeat(64),[...members,'cc.testnet']));
});
test('a pre-inclusion rejection recovers the same signed bytes after immediate missing-transaction reconciliation',async()=>{
 const journal=new V4MemoryJournal(),transport=new V4NearTransport('owner.testnet','https://test.rpc.fastnear.com',KeyPair.fromRandom('ed25519').toString(),journal);
 let keyReads=0;const sent=[];
 transport.provider.viewAccessKey=async()=>{keyReads++;return{nonce:1n,permission:'FullAccess'};};
 transport.provider.viewBlock=async()=>({header:{hash:baseEncode(new Uint8Array(32))}});
 transport.provider.sendTransactionUntil=async signed=>{sent.push(Buffer.from(signed.encode()).toString('hex'));if(sent.length===1)throw new Error('NotEnoughBalance');return{status:{SuccessValue:Buffer.from('"registered"').toString('base64')}};};
 transport.provider.viewTransactionStatus=async request=>{assert.equal(request.waitUntil,'NONE');throw new Error("Transaction doesn't exist");};
 const args={operation_id:'same-registration',deposit:1n};
 await assert.rejects(transport.call('vault.testnet','register_account',{name:'Owner'},args),V4BroadcastUnknown);
 const result=await transport.call('vault.testnet','register_account',{name:'Owner'},args);
 assert.equal(result.value,'registered');assert.equal(sent.length,2);assert.equal(sent[0],sent[1]);assert.equal(keyReads,1);assert.equal((await journal.get(args.operation_id)).state,'CONFIRMED');
 await assert.rejects(transport.call('vault.testnet','register_account',{name:'Changed'},args),/REQUEST_ID_CONFLICT/);
});
test('an included but incomplete operation is observed without broadcasting a second payment',async()=>{
 const journal=new V4MemoryJournal(),transport=new V4NearTransport('owner.testnet','https://test.rpc.fastnear.com',KeyPair.fromRandom('ed25519').toString(),journal);let broadcasts=0;
 transport.provider.viewAccessKey=async()=>({nonce:1n,permission:'FullAccess'});
 transport.provider.viewBlock=async()=>({header:{hash:baseEncode(new Uint8Array(32))}});
 transport.provider.sendTransactionUntil=async()=>{broadcasts++;throw new Error('Connection interrupted');};
 transport.provider.viewTransactionStatus=async request=>{assert.equal(request.waitUntil,'NONE');return{status:'Started'};};
 const args={operation_id:'uncertain-payment',deposit:1n};
 await assert.rejects(transport.call('token.testnet','ft_transfer',{receiver_id:'other.testnet',amount:'100'},args),V4BroadcastUnknown);
 await assert.rejects(transport.call('token.testnet','ft_transfer',{receiver_id:'other.testnet',amount:'100'},args),V4BroadcastUnknown);assert.equal(broadcasts,1);
});

test('read-only reconciliation never broadcasts after expiry and non-final outcomes remain uncertain',async()=>{
 const journal=new V4MemoryJournal(),transport=new V4NearTransport('owner.testnet','https://test.rpc.fastnear.com',KeyPair.fromRandom('ed25519').toString(),journal);let broadcasts=0;
 transport.provider.viewAccessKey=async()=>({nonce:1n,permission:'FullAccess'});transport.provider.viewBlock=async()=>({header:{hash:baseEncode(new Uint8Array(32))}});
 transport.provider.sendTransactionUntil=async()=>{broadcasts++;throw new Error('Connection interrupted');};
 const args={receiver_id:'other.testnet',amount:'100'},options={operation_id:'expired-payment',deposit:1n};
 await assert.rejects(transport.reconcile('token.testnet','ft_transfer',args,options),/TRANSACTION_NOT_RECORDED/);assert.equal(broadcasts,0);
 await assert.rejects(transport.call('token.testnet','ft_transfer',args,options),V4BroadcastUnknown);
 transport.provider.viewTransactionStatus=async()=>{throw new Error("Transaction doesn't exist");};
 await assert.rejects(transport.reconcile('token.testnet','ft_transfer',args,options),V4BroadcastUnknown);assert.equal(broadcasts,1);
 transport.provider.viewTransactionStatus=async()=>({status:{SuccessValue:'bnVsbA=='}});
 await assert.rejects(transport.reconcile('token.testnet','ft_transfer',args,options),V4BroadcastUnknown);assert.equal(broadcasts,1);
 transport.provider.viewTransactionStatus=async()=>({final_execution_status:'EXECUTED',status:{SuccessValue:'bnVsbA=='}});
 await assert.rejects(transport.reconcile('token.testnet','ft_transfer',args,options),V4BroadcastUnknown);assert.equal((await journal.get(options.operation_id)).state,'UNKNOWN');
 transport.provider.viewTransactionStatus=async()=>({final_execution_status:'FINAL',status:{SuccessValue:'bnVsbA=='}});
 assert.equal((await transport.reconcile('token.testnet','ft_transfer',args,options)).evidence,'near_final');assert.equal(broadcasts,1);
 await assert.rejects(transport.reconcile('token.testnet','ft_transfer',{...args,amount:'101'},options),/REQUEST_ID_CONFLICT/);
});
