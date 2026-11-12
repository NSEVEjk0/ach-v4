import test from 'node:test';import assert from 'node:assert/strict';
import {DemoSponsor}from '../demo/sponsor.mjs';
import {StateStore}from '../lib/store.mjs';
import {mkdtempSync,mkdirSync,writeFileSync,rmSync}from 'node:fs';import {tmpdir}from 'node:os';import path from 'node:path';
import {KeyPair}from '../../packages/client/dist/near.js';
test('a rejected or unconfirmed deposit cannot be reported as credited',async()=>{
 const input={request_id:'a'.repeat(32),account_id:'owner.testnet',amount:'100'};
 let result={value:'0',evidence:'near_final',tx_hash:'refund'};
 const temporary=mkdtempSync(path.join(tmpdir(),'ach-sponsor-test-')),store=new StateStore(path.join(temporary,'store.sqlite'));
 const sponsor=Object.assign(Object.create(DemoSponsor.prototype),{store,ownerFor:()=>({deposit:async()=>result})});
 const session={id:'test-session'};try{
 await assert.rejects(sponsor.deposit(session,input),/DEPOSIT_NOT_CREDITED/);
 result={value:'100',evidence:'unknown',tx_hash:'unconfirmed'};
 await assert.rejects(sponsor.deposit(session,input),/DEPOSIT_NOT_CREDITED/);
 result={value:'100',evidence:'near_final',tx_hash:'confirmed'};
 assert.deepEqual(await sponsor.deposit(session,input),result);
 assert.equal(store.eventPage(session.id).items.filter(e=>e.kind==='deposit-completed').length,1);
 }finally{store.close();rmSync(temporary,{recursive:true,force:true});}
});

test('hosted owner identity files cannot select another wallet or deployment namespace',async()=>{
 const directory=mkdtempSync(path.join(tmpdir(),'ach-owner-scope-')),id='a'.repeat(32),root='ach-v4r2-demo-1234abcd.testnet',account_id=`r-${id.slice(0,12)}.${root}`;
 const config={protocol_version:4,workflow_revision:2,network:'testnet',root,vault:'ach-vault-v4r2-1234abcd.testnet',token:'ach-usdc-v4r2-1234abcd.testnet',decimals:6,rpc_url:'https://rpc.invalid'};
 const session={id,participants:[{kind:'research',account_id}]},filename=path.join(directory,'owners',id+'-research.json'),owner_secret=KeyPair.fromRandom('ed25519').toString();
 const sponsor=Object.assign(Object.create(DemoSponsor.prototype),{config,identityRoot:directory,owners:new Map()});
 mkdirSync(path.dirname(filename),{mode:0o700});
 try{
  writeFileSync(filename,JSON.stringify({account_id:'legacy-owner.testnet',owner_secret}),{mode:0o600});
  assert.throws(()=>sponsor.ownerFor(session,account_id),/SESSION_IDENTITY_SCOPE_REQUIRED/);
  assert.equal(sponsor.owners.size,0);
  sponsor.store={ensureSessionReservation(){throw new Error('SPONSOR_RESERVATION_ATTEMPTED');}};
  await assert.rejects(sponsor.provision(session),/SESSION_IDENTITY_SCOPE_REQUIRED/);
  writeFileSync(filename,JSON.stringify({account_id,owner_secret}));
  assert.equal(sponsor.ownerFor(session,account_id).transport.account_id,account_id);
  const foreign='r-'+id.slice(0,12)+'.historical-demo.testnet';
  writeFileSync(filename,JSON.stringify({account_id:foreign,owner_secret}));
  assert.throws(()=>sponsor.ownerFor({...session,participants:[{kind:'research',account_id:foreign}]},foreign),/SESSION_IDENTITY_SCOPE_REQUIRED/);
 }finally{rmSync(directory,{recursive:true,force:true});}
});
