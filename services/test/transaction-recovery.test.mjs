import test from 'node:test';
import assert from 'node:assert/strict';
import {V4NearTransport,V4MemoryJournal,V4BroadcastUnknown} from '../../packages/client/dist/v4.js';
import {KeyPair,baseEncode} from '../../packages/client/dist/near.js';
import {withSignerRecovery} from '../lib/transactions.mjs';

function setup(){
 const journal=new V4MemoryJournal();
 const transport=withSignerRecovery(new V4NearTransport('recovery.testnet','https://recovery.example',KeyPair.fromRandom('ed25519').toString(),journal),journal);
 transport.provider.viewAccessKey=async()=>({nonce:100n,permission:'FullAccess'});
 transport.provider.viewBlock=async()=>({header:{hash:baseEncode(new Uint8Array(32))}});
 return{journal,transport};
}
const final=value=>({final_execution_status:'FINAL',status:{SuccessValue:Buffer.from(JSON.stringify(value)).toString('base64')}});

test('a lost confirmation is recovered before the next workflow step without paying again',async()=>{
 const {journal,transport}=setup(),sent=[];let statusReads=0;
 transport.provider.sendTransactionUntil=async signed=>{
  sent.push(BigInt(signed.transaction.nonce));
  if(sent.length===1)throw new Error('fetch failed');
  return final('accepted');
 };
 await assert.rejects(transport.call('vault.testnet','propose_purchase_group',{id:'group'},{operation_id:'group'}),V4BroadcastUnknown);
 transport.provider.viewTransactionStatus=async request=>{statusReads++;assert.equal(request.waitUntil,'NONE');return final('proposed');};
 const accepted=await transport.call('vault.testnet','authorize_purchase_group',{id:'group'},{operation_id:'approval'});
 assert.equal(accepted.value,'accepted');assert.deepEqual(sent,[101n,102n]);assert.equal(statusReads,1);
 assert.equal((await journal.get('group')).state,'CONFIRMED');assert.equal((await journal.get('group')).result.value,'proposed');
});
test('missing and non-final receipts still block later steps and preserve exact-byte retries',async()=>{
 const {journal,transport}=setup(),sent=[];
 transport.provider.sendTransactionUntil=async signed=>{sent.push(Buffer.from(signed.encode()).toString('hex'));throw new Error('fetch failed');};
 const args={id:'group'},options={operation_id:'group'};
 await assert.rejects(transport.call('vault.testnet','propose_purchase_group',args,options),V4BroadcastUnknown);
 for(const response of [async()=>{throw new Error("Transaction doesn't exist");},async()=>({final_execution_status:'EXECUTED',status:{SuccessValue:'bnVsbA=='}})]){
  transport.provider.viewTransactionStatus=response;
  await assert.rejects(transport.call('vault.testnet','authorize_purchase_group',args,{operation_id:'later'}),error=>error instanceof V4BroadcastUnknown&&error.operation_id==='group');
  assert.equal(sent.length,1);assert.equal(await journal.get('later'),undefined);assert.equal((await journal.get('group')).state,'UNKNOWN');
 }
 transport.provider.viewTransactionStatus=async()=>{throw new Error("Transaction doesn't exist");};
 transport.provider.sendTransactionUntil=async signed=>{sent.push(Buffer.from(signed.encode()).toString('hex'));return final('proposed');};
 await transport.call('vault.testnet','propose_purchase_group',args,options);
 assert.equal(sent.length,2);assert.equal(sent[0],sent[1]);assert.equal((await journal.get('group')).state,'CONFIRMED');
});
