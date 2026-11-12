import {v4Digest,v4FundedInvoiceId,v4PurchaseGroupId,v4NetPlan}from '../../packages/client/dist/v4.js';

export function privateNegativeFixture(config,{seed,buyer,seller,now}){
 const deadline=now+900000,order_commitment=v4Digest('explicit-private-negative-test:'+seed);
 const spec={id:v4FundedInvoiceId(config,{buyer,purchase_id:seed,terms_version:1}),purchase_id:seed,terms_version:1,buyer,seller,asset:config.token,amount:'1',service:'chart',terms_hash:v4Digest('negative-test-no-service-invoice'),artifact_hash:v4Digest('negative-test-no-delivery'),ready_at_ms:now,expires_at_ms:deadline};
 const input={id:v4PurchaseGroupId(config,buyer,'negative-'+seed),private:true,deadline_ms:deadline,positions:v4NetPlan([spec]).positions,orders:[{purchase_id:seed,terms_version:1,buyer,seller,order_commitment,public_terms:null}]};
 return{input,spec,salt:v4Digest(seed+':salt')};
}
