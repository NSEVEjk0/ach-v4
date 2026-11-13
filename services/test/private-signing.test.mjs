import test from 'node:test';
import assert from 'node:assert/strict';
import {v4PrivateInvoiceCommitment} from '../../packages/client/dist/v4.js';
import {setup} from './fixtures/commerce.mjs';

test('a private provider cannot obtain a buyer signature for terms different from its reviewed invoice',async()=>{
 const h=await setup({privateMode:true});
 try{
  const buyer=h.actors.get('research'),seller=h.identities.get('visual');
  const id='4'.repeat(32),brief='Check private invoice consent',data=[{label:'Requests',value:42}];
  await buyer.prepareFundingGroup(h.session,{request_id:id,privacy:'private'},{title:brief,needs_audit:false},brief,data);
  const dispatch=buyer.dispatch;
  let signedContribution;
  buyer.dispatch=async(kind,session,request)=>{
   if(request.accept_private){signedContribution=request.accept_private;throw new Error('ADVERSARIAL_PROVIDER_RECEIVED_SIGNATURE');}
   const delivered=await dispatch(kind,session,request);
   const spec={...delivered.contribution.spec,amount:'99999'};
   const commitment=v4PrivateInvoiceCommitment(h.config,spec,delivered.contribution.salt);
   return {...delivered,invoice:{...delivered.invoice,hash:commitment},contribution:{...delivered.contribution,spec,signatures:[{account_id:seller.account_id,key_epoch:(await seller.client.balance()).policy.epoch,signature:Buffer.from(seller.key.sign(Buffer.from(commitment,'hex')).signature).toString('base64')}]}};
  };
  await assert.rejects(buyer.purchase(h.session,'chart',{brief,data,verified:false},id,'private'),/PRIVATE_INVOICE_MISMATCH/);
  assert.equal(signedContribution,undefined,'the provider must never receive a buyer signature for the substituted terms');
  assert.equal(h.actorStores.get('research').jobs(h.session.id).find(j=>j.id.startsWith('buy-'))?.contribution,undefined);
 }finally{h.cleanup();}
});

test('private receipts must retain the funded order service, charge and deadline before signing',async t=>{
 for(const [field,value] of [['service','audit'],['terms_version',2],['id','another-invoice'],['expires_at_ms',Date.now()+1000]]){
  await t.test(field,async()=>{
   const h=await setup({privateMode:true});
   try{
    const buyer=h.actors.get('research'),seller=h.identities.get('visual');
    const id='5'.repeat(32),brief='Validate the exact funded receipt',data=[{label:'Requests',value:42}];
    await buyer.prepareFundingGroup(h.session,{request_id:id,privacy:'private'},{title:brief,needs_audit:false},brief,data);
    const dispatch=buyer.dispatch;let signedContribution;
    buyer.dispatch=async(kind,session,request)=>{
     if(request.accept_private){signedContribution=request.accept_private;throw new Error('ADVERSARIAL_PROVIDER_RECEIVED_SIGNATURE');}
     const delivered=await dispatch(kind,session,request),spec={...delivered.invoice.spec,[field]:value};
     const commitment=v4PrivateInvoiceCommitment(h.config,spec,delivered.contribution.salt);
     return {...delivered,invoice:{...delivered.invoice,spec,hash:commitment},contribution:{...delivered.contribution,spec,signatures:[{account_id:seller.account_id,key_epoch:(await seller.client.balance()).policy.epoch,signature:Buffer.from(seller.key.sign(Buffer.from(commitment,'hex')).signature).toString('base64')}]}};
    };
    await assert.rejects(buyer.purchase(h.session,'chart',{brief,data,verified:false},id,'private'),/DELIVERY_OR_INVOICE_MISMATCH/);
    assert.equal(signedContribution,undefined);
   }finally{h.cleanup();}
  });
 }
});
