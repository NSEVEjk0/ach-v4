import {describe,it,expect} from 'vitest';
import {createRequire} from 'node:module';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';

const require=createRequire(import.meta.url);
const merge=require('deepmerge');

describe('legacy dependency protections',()=>{
 it('rejects prototype poisoning even when either merge input has a null prototype',()=>{
  const malicious=JSON.parse('{"__proto__":{"forged":true},"constructor":{"prototype":{"forged":true}},"prototype":{"forged":true},"safe":1}');
  for(const result of [merge(Object.create(null),malicious),merge(malicious,Object.create(null))]){
   expect(Object.getPrototypeOf(result)).toBe(Object.prototype);
   expect(result.forged).toBeUndefined();
   expect(result.safe).toBe(1);
   for(const key of ['__proto__','constructor','prototype'])expect(Object.hasOwn(result,key)).toBe(false);
  }
 });
 it('preserves legitimate resolver options and array merging',()=>{
  expect(merge({extensions:['.js'],resolve:{browser:false}},{extensions:['.ts'],resolve:{preferBuiltins:true}})).toEqual({extensions:['.js','.ts'],resolve:{browser:false,preferBuiltins:true}});
 });
 it('uses native ECDSA and rejects a missing native backend instead of loading Elliptic',()=>{
  const secp=require('secp256k1');
  expect(secp).toBe(require('secp256k1/bindings'));
  const key=new Uint8Array(32);key[31]=1;
  const message=new Uint8Array(32);message[31]=42;
  expect(secp.ecdsaVerify(secp.ecdsaSign(message,key).signature,message,secp.publicKeyCreate(key))).toBe(true);
  const entry=readFileSync(require.resolve('secp256k1'),'utf8');
  const requested:string[]=[];
  expect(()=>runInNewContext(entry,{module:{exports:{}},require:(name:string)=>{requested.push(name);throw new Error('NATIVE_BACKEND_UNAVAILABLE');}})).toThrow('NATIVE_BACKEND_UNAVAILABLE');
  expect(requested).toEqual(['./bindings']);
 });
});
