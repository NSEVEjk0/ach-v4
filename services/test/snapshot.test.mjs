import test from 'node:test';
import assert from 'node:assert/strict';
import {Coordinator} from '../coordinator/coordinator.mjs';

function pendingRead() {
 let resolve;
 const promise=new Promise(done=>{resolve=done;});
 return {promise,resolve};
}

test('a read invalidated by completed work cannot restore a failed job to the cache',async()=>{
 const coordinator=new Coordinator({snapshotTtlMs:10000,clock:()=>1000});
 const reads=[];
 coordinator.readSnapshot=()=>{const read=pendingRead();reads.push(read);return read.promise;};
 const session={id:'first-session'},before=coordinator.snapshot(session);
 coordinator.invalidateSnapshot(session.id);
 const after=coordinator.snapshot(session);
 assert.equal(reads.length,2,'a refresh after completion must start a fresh read');
 reads[1].resolve({jobs:[{state:'COMPLETE'}]});
 assert.deepEqual(await after,{jobs:[{state:'COMPLETE'}]});
 reads[0].resolve({jobs:[{state:'FAILED',error:'AI_PLAN_INVALID'}]});
 await before;
 assert.deepEqual(await coordinator.snapshot(session),{jobs:[{state:'COMPLETE'}]});
 assert.equal(reads.length,2,'late stale work must not replace the confirmed cached result');
});

test('an invalidated read cannot remove a newer pending read or affect another session',async()=>{
 const coordinator=new Coordinator({snapshotTtlMs:10000,clock:()=>1000});
 const reads=[];
 coordinator.readSnapshot=session=>{const read=pendingRead();reads.push({id:session.id,...read});return read.promise;};
 const first={id:'first-session'},other={id:'other-session'};
 const stale=coordinator.snapshot(first),isolated=coordinator.snapshot(other);
 coordinator.invalidateSnapshot(first.id);
 const current=coordinator.snapshot(first);
 reads[0].resolve({balance:'old'});await stale;
 const joined=coordinator.snapshot(first),otherJoined=coordinator.snapshot(other);
 assert.equal(reads.length,3,'overlapping fresh reads should still be shared');
 reads[2].resolve({balance:'confirmed'});
 reads[1].resolve({balance:'other-confirmed'});
 assert.deepEqual(await current,{balance:'confirmed'});
 assert.deepEqual(await joined,{balance:'confirmed'});
 assert.deepEqual(await isolated,{balance:'other-confirmed'});
 assert.deepEqual(await otherJoined,{balance:'other-confirmed'});
});
