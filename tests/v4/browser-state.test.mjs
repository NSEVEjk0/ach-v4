import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,readFileSync,statSync,writeFileSync}from 'node:fs';
import path from 'node:path';
import {tmpdir}from 'node:os';
import {readBrowserCheckpoint,writeBrowserCheckpoint,redactBrowserMessage,retryableBrowserRead}from '../../scripts/v4/browser-state.mjs';

const binding={url:'https://ach.example',vault:'vault.testnet',code_hash:'expected-code'};
const session='a'.repeat(32),request='b'.repeat(32);
const state=()=>({cookies:[{name:'ach-v4-session',domain:'ach.example',value:'c'.repeat(64)}],origins:[{origin:binding.url,localStorage:[{name:'ach-private-key:'+session+':'+request,value:'test-browser-key'}]}]});
const privateRequest=()=>({private:{request_id:request,privacy:'private',sealed_brief:{ciphertext:'test-encrypted-input'}}});
const filename=()=>path.join(mkdtempSync(path.join(tmpdir(),'ach-browser-checkpoint-')),'checkpoint.json');

test('an interrupted private journey restores its owning cookie, original request and browser key together',()=>{
 const file=filename();writeBrowserCheckpoint(file,binding,{session_id:session,requests:privateRequest(),storage_state:state()});
 const restored=readBrowserCheckpoint(file,binding);
 assert.equal(restored.requests.private.request_id,request);assert.deepEqual(restored.storage_state,state());assert.equal(restored.session_id,session);
 assert.equal(statSync(file).mode&0o777,0o600);
});

test('a mismatched session or missing private key cannot replace the last valid checkpoint',()=>{
 const file=filename();writeBrowserCheckpoint(file,binding,{session_id:session,requests:privateRequest(),storage_state:state()});const original=readFileSync(file);
 assert.throws(()=>writeBrowserCheckpoint(file,binding,{session_id:'d'.repeat(32),requests:privateRequest(),storage_state:state()}),/BROWSER_PRIVATE_CHECKPOINT_KEY_REQUIRED/);
 const missing=state();missing.origins[0].localStorage=[];
 assert.throws(()=>writeBrowserCheckpoint(file,binding,{session_id:session,requests:privateRequest(),storage_state:missing}),/BROWSER_PRIVATE_CHECKPOINT_KEY_REQUIRED/);
 assert.ok(original.equals(readFileSync(file)));
});

test('checkpoints reject another deployment or browser origin before request reuse',()=>{
 const file=filename();writeBrowserCheckpoint(file,binding,{session_id:session,requests:{},storage_state:state()});
 for(const field of ['url','vault','code_hash'])assert.throws(()=>readBrowserCheckpoint(file,{...binding,[field]:'substituted'}),/BROWSER_CHECKPOINT_RUNTIME_MISMATCH/);
 const foreign=state();foreign.cookies[0].domain='another.example';
 assert.throws(()=>writeBrowserCheckpoint(file,binding,{session_id:session,requests:{},storage_state:foreign}),/BROWSER_CHECKPOINT_SESSION_COOKIE_REQUIRED/);
});

test('a damaged checkpoint fails without echoing any private file contents',()=>{
 const file=filename();writeFileSync(file,'{"cookie":"test-private-cookie",broken');
 assert.throws(()=>readBrowserCheckpoint(file,binding),{message:'BROWSER_CHECKPOINT_INVALID'});
});

test('browser timeout failures redact credentials while retaining the actionable network error',()=>{
 const secret='test-session-secret';
 const message='apiRequestContext.get: read ETIMEDOUT\n - cookie: ach-v4-session='+secret+'\n - authorization: Bearer test-access-secret\n - x-vercel-protection-bypass: test-bypass-secret\nURL https://ach.example?token=test-query-secret';
 const redacted=redactBrowserMessage(message);
 for(const value of [secret,'test-access-secret','test-bypass-secret','test-query-secret'])assert.ok(!redacted.includes(value));
 assert.ok(redacted.includes('ETIMEDOUT'));assert.ok(redacted.includes('[redacted]'));
});

test('transient RPC and browser read failures retry without retrying rejected financial operations',()=>{
 for(const message of ['read ETIMEDOUT','read ECONNRESET','SERVICE_UNAVAILABLE','502 Bad Gateway'])assert.equal(retryableBrowserRead(new Error(message)),true);
 for(const message of ['BROWSER_JOB_FAILED:INVALID_SIGNATURE','INSUFFICIENT_AVAILABLE_BALANCE','REQUEST_ID_CONFLICT'])assert.equal(retryableBrowserRead(new Error(message)),false);
});
