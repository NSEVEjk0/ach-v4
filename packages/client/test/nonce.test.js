import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {V4NearTransport,V4MemoryJournal,V4BroadcastUnknown} from '../dist/v4.js';
import {KeyPair,baseEncode,actions} from '../dist/near.js';
import {durableActions} from '../../../services/lib/transactions.mjs';
import {StateStore} from '../../../services/lib/store.mjs';

function staleRpc(transport,seen){
 transport.provider.viewAccessKey=async()=>({nonce:100n,permission:'FullAccess'});
 transport.provider.viewBlock=async()=>({header:{hash:baseEncode(new Uint8Array(32))}});
 transport.provider.sendTransactionUntil=async signed=>{
  const nonce=BigInt(signed.transaction.nonce);assert.ok(!seen.length||nonce>seen.at(-1),'transaction nonce was reused');seen.push(nonce);
  return{status:{SuccessValue:Buffer.from('"ok"').toString('base64')}};
 };
}
test('stale access-key reads cannot reuse a nonce across clients and action batches',async()=>{
 const journal=new V4MemoryJournal(),secret=KeyPair.fromRandom('ed25519').toString(),seen=[];
 const a=new V4NearTransport('nonce.testnet','https://nonce.example',secret,journal),b=new V4NearTransport('nonce.testnet','https://nonce.example',secret,journal);
 staleRpc(a,seen);staleRpc(b,seen);
 await Promise.all([a.call('vault.testnet','accept_invoice',{id:'one'},{operation_id:'one'}),b.call('vault.testnet','accept_invoice',{id:'two'},{operation_id:'two'}),durableActions(a.account,journal,'three','vault.testnet',[actions.functionCall('noop',{},1n,0n)])]);
 assert.deepEqual(seen,[101n,102n,103n]);
});
test('an uncertain broadcast blocks later transactions on the same signer until reconciled',async()=>{
 const journal=new V4MemoryJournal(),transport=new V4NearTransport('pending.testnet','https://pending.example',KeyPair.fromRandom('ed25519').toString(),journal),seen=[];
 staleRpc(transport,seen);
 transport.provider.sendTransactionUntil=async signed=>{seen.push(Buffer.from(signed.encode()).toString('hex'));throw new Error('fetch failed');};
 await assert.rejects(transport.call('vault.testnet','accept_invoice',{id:'first'},{operation_id:'pending-first'}),V4BroadcastUnknown);
 await assert.rejects(transport.call('vault.testnet','accept_invoice',{id:'later'},{operation_id:'pending-later'}),error=>error instanceof V4BroadcastUnknown&&error.operation_id==='pending-first');
 assert.equal(seen.length,1);assert.equal(await journal.get('pending-later'),undefined);
 transport.provider.viewTransactionStatus=async()=>({final_execution_status:'FINAL',status:{SuccessValue:Buffer.from('"ok"').toString('base64')}});
 await transport.reconcile('vault.testnet','accept_invoice',{id:'first'},{operation_id:'pending-first'});
 const nonces=[];staleRpc(transport,nonces);
 await transport.call('vault.testnet','accept_invoice',{id:'later'},{operation_id:'pending-later'});
 assert.deepEqual(nonces,[102n]);
});
test('a process restart restores the signed nonce floor from its durable journal',async()=>{
 const directory=mkdtempSync(path.join(tmpdir(),'ach-nonce-restart-')),filename=path.join(directory,'journal.sqlite'),secret=KeyPair.fromRandom('ed25519').toString(),seen=[];
 let journal=new StateStore(filename);
 try{
  const first=new V4NearTransport('restart.testnet','https://restart.example',secret,journal);staleRpc(first,seen);
  await first.call('vault.testnet','accept_invoice',{id:'one'},{operation_id:'restart-one'});journal.close();
  journal=new StateStore(filename);
  const {V4NearTransport:Restarted}=await import('../dist/v4.js?nonce-restart');
  const second=new Restarted('restart.testnet','https://restart.example',secret,journal);staleRpc(second,seen);
  await second.call('vault.testnet','accept_invoice',{id:'two'},{operation_id:'restart-two'});
  assert.deepEqual(seen,[101n,102n]);
 }finally{journal.close();rmSync(directory,{recursive:true,force:true});}
});
