import test from 'node:test';import assert from 'node:assert/strict';
import {DemoSponsor}from '../demo/sponsor.mjs';
test('a rejected or unconfirmed deposit cannot be reported as credited',async()=>{
 const input={request_id:'a'.repeat(32),account_id:'owner.testnet',amount:'100'};
 let result={value:'0',evidence:'near_final',tx_hash:'refund'};
 const sponsor={ownerFor:()=>({deposit:async()=>result})};
 await assert.rejects(DemoSponsor.prototype.deposit.call(sponsor,{},input),/DEPOSIT_NOT_CREDITED/);
 result={value:'100',evidence:'unknown',tx_hash:'unconfirmed'};
 await assert.rejects(DemoSponsor.prototype.deposit.call(sponsor,{},input),/DEPOSIT_NOT_CREDITED/);
 result={value:'100',evidence:'near_final',tx_hash:'confirmed'};
 assert.deepEqual(await DemoSponsor.prototype.deposit.call(sponsor,{},input),result);
});
