import {Account,SignedTransaction,baseEncode}from '../../packages/client/dist/near.js';
import {v4Digest,V4BroadcastUnknown,v4UnknownTransaction}from '../../packages/client/dist/v4.js';
// Account creation/deployment has the same durable-before-broadcast rule as
// financial calls. Persist only signed public transactions, never secret keys.
export async function durableActions(account,journal,id,receiver,actions,{recordedFastFS=false}={}){
 if(recordedFastFS&&(actions.length!==1||actions[0].functionCall?.methodName!=='__fastdata_fastfs'||BigInt(actions[0].functionCall.gas)!==1n||BigInt(actions[0].functionCall.deposit)!==0n))throw new Error('INVALID_FASTFS_PUBLICATION');
 const payload=v4Digest(JSON.stringify({receiver,actions},(_,v)=>typeof v==='bigint'?v.toString():v));let op=await journal.get(id);
 if(op){if(op.payload_hash!==payload)throw new Error('REQUEST_ID_CONFLICT');if(op.state==='CONFIRMED')return op.result;if(op.state==='FAILED')throw new Error(op.error??'CHAIN_EXECUTION_FAILED');
  try{const status=await account.provider.viewTransactionStatus({txHash:op.tx_hash,accountId:account.accountId,waitUntil:'NONE'});return await confirm(status);}catch(e){if(op.state==='FAILED')throw e;if(!v4UnknownTransaction(e))throw new V4BroadcastUnknown(id,op.tx_hash);try{return await confirm(await account.provider.sendTransactionUntil(SignedTransaction.decode(Buffer.from(op.signed_transaction,'base64')),'FINAL'));}catch(error){if(op.state==='FAILED')throw error;throw new V4BroadcastUnknown(id,op.tx_hash);}}
 }
 const signer=account.getSigner();if(!signer)throw new Error('SIGNER_REQUIRED');const fresh=new Account(account.accountId,account.provider,signer);const tx=await fresh.createTransaction({receiverId:receiver,actions,publicKey:await signer.getPublicKey()});const signed=await signer.signTransaction(tx);
 op={id,payload_hash:payload,signer_id:account.accountId,tx_hash:baseEncode(signed.txHash),signed_transaction:Buffer.from(signed.signedTransaction.encode()).toString('base64'),state:'SIGNED'};await journal.put(op);
 try{return await confirm(await account.provider.sendTransactionUntil(SignedTransaction.decode(Buffer.from(op.signed_transaction,'base64')),'FINAL'));}catch(e){if(op.state==='FAILED')throw e;op.state='UNKNOWN';await journal.put(op);throw new V4BroadcastUnknown(id,op.tx_hash);}
 async function confirm(status){if(status.status?.Failure&&!recordedFastFS){op.state='FAILED';op.error='CHAIN_EXECUTION_FAILED';await journal.put(op);throw new Error(op.error);}if(status.status?.SuccessValue===undefined&&!recordedFastFS)throw new V4BroadcastUnknown(id,op.tx_hash);op.state='CONFIRMED';op.result={tx_hash:op.tx_hash,evidence:'near_final',...(recordedFastFS?{purpose:'published-data',execution_reverts_by_design:true}:{})};await journal.put(op);return op.result;}
}
