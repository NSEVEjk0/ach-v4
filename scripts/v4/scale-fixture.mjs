import {v4Digest,v4FundedInvoiceId,v4PurchaseGroupId,v4NetPlan,v4FundingGroupHash}from '../../packages/client/dist/v4.js';

export function scaleFixture(config,fixture,roundIndex,deadline){
 if(fixture.identities.length!==12||!Number.isInteger(roundIndex)||roundIndex<0||roundIndex>1||!Number.isSafeInteger(fixture.created_at_ms)||!Number.isSafeInteger(deadline)||deadline<=fixture.created_at_ms)throw new Error('INVALID_SCALE_FIXTURE');
 const amount=((1n<<100n)-1n)/96n;
 const specs=Array.from({length:48},(_,index)=>{
  const buyer=fixture.identities[index%12].account_id,seller=fixture.identities[(index+1)%12].account_id,purchase_id=`scale-fixture-${fixture.seed}-${roundIndex}-${index}`.padEnd(96,'p');
  const terms_hash=v4Digest('maximum-record-financial-fixture'),artifact_hash=v4Digest('no-delivery-scale-fixture');
  return{id:v4FundedInvoiceId(config,{buyer,purchase_id,terms_version:1}),purchase_id,terms_version:1,buyer,seller,asset:config.token,amount:amount.toString(),service:'explicit-no-service-scale-fixture'.padEnd(96,'s'),terms_hash,artifact_hash,ready_at_ms:fixture.created_at_ms,expires_at_ms:deadline};
 });
 const input={id:v4PurchaseGroupId(config,fixture.identities[0].account_id,`scale-${fixture.seed}-${roundIndex}`.padEnd(60,'g')),private:false,deadline_ms:deadline,positions:v4NetPlan(specs).positions,orders:specs.map(spec=>({purchase_id:spec.purchase_id,terms_version:1,buyer:spec.buyer,seller:spec.seller,order_commitment:spec.terms_hash,public_terms:{amount:spec.amount,service:spec.service,terms_hash:spec.terms_hash,artifact_hash:spec.artifact_hash}}))};
 v4FundingGroupHash(config,input);
 return{input,specs,amount};
}
