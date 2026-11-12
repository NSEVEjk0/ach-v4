// The maintained decoder is ESM. The legacy source-map resolver expects its
// CommonJS import to be callable; Node 22 exposes the function as `default`.
import assert from 'node:assert/strict';
import {readFileSync,writeFileSync} from 'node:fs';
import {createRequire} from 'node:module';

const require=createRequire(import.meta.url);
const filename=require.resolve('source-map-resolve');
const original='var decodeUriComponentLib = require("decode-uri-component")';
const replacement='var decodeUriComponentModule = require("decode-uri-component")\nvar decodeUriComponentLib = decodeUriComponentModule.default || decodeUriComponentModule';
const source=readFileSync(filename,'utf8');
if(!source.includes(replacement)){
 assert.equal(source.split(original).length,2,'EXPECTED_SOURCE_MAP_DECODER_IMPORT_REQUIRED');
 writeFileSync(filename,source.replace(original,replacement));
}
const decoder=require('decode-uri-component');
assert.equal(typeof(decoder.default??decoder),'function','CALLABLE_URI_DECODER_REQUIRED');
assert.equal((decoder.default??decoder)('A%20B'),'A B');

// GHSA-gcqx-w48m-w2h4 has no maintained release. Filter prototype keys
// from both merge inputs, including objects with a null prototype.
const mergeFile=require.resolve('deepmerge');
const mergeOriginal='return Object.keys(target).concat(getEnumerableOwnPropertySymbols(target))';
const mergeReplacement=mergeOriginal+".filter(function(key) { return key !== '__proto__' && key !== 'constructor' && key !== 'prototype' })";
const mergeSource=readFileSync(mergeFile,'utf8');
if(!mergeSource.includes(mergeReplacement)){
 assert.equal(mergeSource.split(mergeOriginal).length,2,'EXPECTED_DEEPMERGE_KEYS_REQUIRED');
 writeFileSync(mergeFile,mergeSource.replace(mergeOriginal,mergeReplacement));
}
const merge=require('deepmerge');
const attacked=merge(Object.create(null),JSON.parse('{"__proto__":{"poisoned":true},"constructor":{"prototype":{"poisoned":true}},"safe":1}'));
assert.equal(Object.getPrototypeOf(attacked),Object.prototype,'UNPOISONED_MERGE_RESULT_REQUIRED');
assert.equal(attacked.poisoned,undefined,'PROTOTYPE_POISONING_REJECTED');
assert.equal(attacked.safe,1);

// GHSA-848j-6mx2-7j84 affects the JavaScript Elliptic fallback. This
// Node-only legacy toolchain requires the native secp256k1 implementation.
const secpFile=require.resolve('secp256k1');
const secpOriginal="try {\n  module.exports = require('./bindings')\n} catch (err) {\n  module.exports = require('./elliptic')\n}\n";
const secpReplacement="// ACH legacy build tools require native ECDSA; no Elliptic fallback.\nmodule.exports = require('./bindings')\n";
const secpSource=readFileSync(secpFile,'utf8');
if(secpSource!==secpReplacement){
 assert.equal(secpSource,secpOriginal,'EXPECTED_SECP256K1_ENTRY_REQUIRED');
 writeFileSync(secpFile,secpReplacement);
}
assert.equal(require('secp256k1'),require('secp256k1/bindings'),'NATIVE_ECDSA_REQUIRED');
