import test from 'node:test';import assert from 'node:assert/strict';
import {localWebModules} from './web-modules.mjs';
test('route inputs and receipts preserve atomic units across token decimal precisions',async()=>{
 const modules=localWebModules();try{
  const{parseTokenAmount,tokenAmount}=await import(modules.url('intents'));
  for(const decimals of [0,6,7,8,9,12,18,24,36]){
   const one=decimals?'0.'+'0'.repeat(decimals-1)+'1':'1';assert.equal(parseTokenAmount(one,decimals),'1');assert.equal(parseTokenAmount(tokenAmount('1234567890123456789',decimals),decimals),'1234567890123456789');
  }
  assert.equal(parseTokenAmount('0.123456789012345678',18),'123456789012345678');assert.equal(tokenAmount('10000',8),'0.0001');
  for(const value of ['0','-1','1e6','0.0000001','1.1234567'])assert.throws(()=>parseTokenAmount(value,6),/INVALID_ROUTE_AMOUNT/);
 }finally{modules.cleanup();}
});
