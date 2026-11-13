import {SignedTransaction}from '../../packages/client/dist/near.js';
import {v4Digest,V4BroadcastUnknown,v4UnknownTransaction,withV4SignerLock,v4SignOperation}from '../../packages/client/dist/v4.js';
// A confirmed contract view can make a workflow skip the call whose RPC reply
// was lost. Recover its final receipt before the signer starts the next step.
// Missing or non-final receipts retain the SDK's block on later transactions.
export function withSignerRecovery(transport,journal){
 const call=transport.call.bind(transport);
 transport.call=async(...args)=>{await recoverConfirmedSignerHead(transport,journal);return call(...args);};
 return transport;
}
async function recoverConfirmedSignerHead(transport,journal){
 if(!journal.latestSignerOperation)return;
 const signer=transport.account.getSigner();if(!signer)throw new Error('SIGNER_REQUIRED');
 const op=await journal.latestSignerOperation(transport.account.accountId,String(await signer.getPublicKey()));
 if(!op||!['SIGNED','UNKNOWN'].includes(op.state))return;
 const tx=SignedTransaction.decode(Buffer.from(op.signed_transaction,'base64')).transaction;
 if(tx.actions.length!==1||!tx.actions[0].functionCall)throw new Error('SIGNER_HEAD_RECONCILIATION_REQUIRED');
 const action=tx.actions[0].functionCall;
 try{await transport.reconcile(tx.receiverId,action.methodName,JSON.parse(Buffer.from(action.args).toString()),{operation_id:op.id,gas:BigInt(action.gas),deposit:BigInt(action.deposit)});}
 catch(error){if(!(error instanceof V4BroadcastUnknown))throw error;}
}
// Account creation/deployment has the same durable-before-broadcast rule as
// financial calls. Persist only signed public transactions, never secret keys.
export async function durableActions(account,journal,id,receiver,actions,{recordedFastFS=false}={}){
 return withV4SignerLock(account,()=>submitActions(account,journal,id,receiver,actions,{recordedFastFS}));
}
async function submitActions(account,journal,id,receiver,actions,{recordedFastFS}){
 if(recordedFastFS&&(actions.length!==1||actions[0].functionCall?.methodName!=='__fastdata_fastfs'||BigInt(actions[0].functionCall.gas)!==1n||BigInt(actions[0].functionCall.deposit)!==0n))throw new Error('INVALID_FASTFS_PUBLICATION');
 const payload=v4Digest(JSON.stringify({receiver,actions},(_,v)=>typeof v==='bigint'?v.toString():v));let op=await journal.get(id);
 if(op){if(op.payload_hash!==payload||op.signer_id!==account.accountId)throw new Error('REQUEST_ID_CONFLICT');if(op.state==='CONFIRMED')return op.result;if(op.state==='FAILED')throw new Error(op.error??'CHAIN_EXECUTION_FAILED');
  try{const status=await account.provider.viewTransactionStatus({txHash:op.tx_hash,accountId:account.accountId,waitUntil:'NONE'});return await confirm(status,true);}catch(e){if(op.state==='FAILED')throw e;if(!v4UnknownTransaction(e))throw new V4BroadcastUnknown(id,op.tx_hash);try{return await confirm(await account.provider.sendTransactionUntil(SignedTransaction.decode(Buffer.from(op.signed_transaction,'base64')),'FINAL'));}catch(error){if(op.state==='FAILED')throw error;throw new V4BroadcastUnknown(id,op.tx_hash);}}
 }
 op=await v4SignOperation(account,journal,id,payload,{receiverId:receiver,actions});
 try{return await confirm(await account.provider.sendTransactionUntil(SignedTransaction.decode(Buffer.from(op.signed_transaction,'base64')),'FINAL'));}catch(e){if(op.state==='FAILED')throw e;op.state='UNKNOWN';await journal.put(op);throw new V4BroadcastUnknown(id,op.tx_hash);}
 async function confirm(status,requireFinal=false){if(requireFinal&&status.final_execution_status!=='FINAL'||status.final_execution_status&&status.final_execution_status!=='FINAL')throw new V4BroadcastUnknown(id,op.tx_hash);if(status.status?.Failure&&!recordedFastFS){op.state='FAILED';op.error='CHAIN_EXECUTION_FAILED';await journal.put(op);throw new Error(op.error);}if(status.status?.SuccessValue===undefined&&!(recordedFastFS&&status.status?.Failure))throw new V4BroadcastUnknown(id,op.tx_hash);op.state='CONFIRMED';op.result={tx_hash:op.tx_hash,evidence:'near_final',...(recordedFastFS?{purpose:'published-data',execution_reverts_by_design:true}:{})};await journal.put(op);return op.result;}
}
