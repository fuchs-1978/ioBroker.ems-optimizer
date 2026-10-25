'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const os=require('node:os');
const path=require('node:path');
const Journal=require('../lib/decision-record-journal');
const payload=(n)=>JSON.stringify({schema:2,recordSession:'read-lane',recordSequence:n,timestamp:1792939229000+n,data:{value:n}});
const proof=e=>({kind:'independent-history-match',recordSession:e.recordSession,recordSequence:e.recordSequence,sha256:e.sha256});
const deferred=()=>{let resolve;const promise=new Promise(r=>{resolve=r;});return {promise,resolve};};
async function fixture(t,options={}) {
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'ems-read-lane-'));
 const journal=new Journal({directory:dir,...options});await journal.initialize();
 const entry=await journal.append(payload(1));
 const releases=[];
 const entered=deferred(),gate=deferred(),read=journal._readBoundedFile.bind(journal);
 journal._readBoundedFile=async (...args)=>{if(args[0].endsWith(`${entry.id}.json`)){entered.resolve();await gate.promise;}return read(...args);};
 t.after(async()=>{gate.resolve();for(const release of releases)release();await journal.close();await fs.rm(dir,{recursive:true,force:true});});
 return {dir,journal,entry,entered,gate,releases};
}
async function beforeRelease(promise,label) {
 let timer;try{return await Promise.race([promise,new Promise((_,reject)=>{timer=setTimeout(()=>reject(new Error(label)),2000);})]);}
 finally{clearTimeout(timer);}
}

test('a stalled immutable journal read does not block a durable append',async t=>{
 const h=await fixture(t),reading=h.journal.readBatch({limit:1});await h.entered.promise;
 const saved=await beforeRelease(h.journal.append(payload(2)),'append blocked behind read');
 assert.equal(saved.recordSequence,2);
 assert.equal(h.journal.health().records,2);
 assert.equal(h.journal.health().pendingRecords,0);
 h.gate.resolve();assert.deepEqual((await reading).map(e=>e.payload),[payload(1)]);
 assert.deepEqual((await h.journal.readBatch()).map(e=>e.payload),[payload(1),payload(2)]);
});

test('independent SQL proof cannot delete an original pinned by an unfinished read',async t=>{
 const h=await fixture(t),reading=h.journal.readBatch({limit:1});await h.entered.promise;
 await beforeRelease(h.journal.confirmStored(h.entry.id,proof(h.entry)),'proof blocked behind read');
 assert.equal(h.journal.health().sqlConfirmedRecords,1);
 assert.ok(h.journal.entries.has(h.entry.id));
 await fs.stat(path.join(h.dir,`${h.entry.id}.json`));
 h.gate.resolve();const result=await reading;
 assert.equal(result[0].payload,payload(1));assert.equal(result[0].confirmedStored,true);
 await h.journal.tail;assert.equal(h.journal.health().records,0);
});

test('expiry defers a pinned group without advancing loss counters',async t=>{
 let now=1000;const h=await fixture(t,{now:()=>now,maxAgeMs:50});
 const reading=h.journal.readBatch({limit:1});await h.entered.promise;now=1100;
 assert.deepEqual(await beforeRelease(h.journal.expireOldGroups(),'expiry blocked behind read'),[]);
 assert.equal(h.journal.health().expiredRecords,0);assert.ok(h.journal.entries.has(h.entry.id));
 h.gate.resolve();await reading;
 assert.deepEqual(await h.journal.expireOldGroups(),[h.entry.id]);
 assert.equal(h.journal.health().expiredUnconfirmedRecords,1);
});

test('close drains accepted read batches and their pin releases while durable writes progress',async t=>{
 const h=await fixture(t),reading=h.journal.readBatch({limit:1});await h.entered.promise;
 const queued=h.journal.readBatch({limit:2});
 await beforeRelease(h.journal.append(payload(2)),'append blocked during read');
 let closed=false;const closing=h.journal.close().then(()=>{closed=true;});
 await new Promise(setImmediate);assert.equal(closed,false);
 await assert.rejects(h.journal.readBatch(),/closed/);
 h.gate.resolve();assert.equal((await reading).length,1);assert.equal((await queued).length,2);
 await closing;assert.equal(h.journal.readPins.size,0);assert.equal(h.journal.activeRead,null);
 assert.equal(h.journal.health().records,2);assert.equal(h.journal.health().pendingRecords,0);
});

test('queued read batches share at most four readers and observe their own cursor and byte bound',async t=>{
 const h=await fixture(t);for(let n=2;n<=6;n++)await h.journal.append(payload(n));
 const original=h.journal._readBoundedFile.bind(h.journal);let active=0,peak=0,readCount=0;
 h.journal._readBoundedFile=async(...args)=>{active++;peak=Math.max(peak,active);readCount++;try{return await original(...args);}finally{active--;}};
 const one=h.journal.readBatch({limit:6,maxBytes:4096});await h.entered.promise;
 const two=h.journal.readBatch({afterId:h.entry.id,limit:1,maxBytes:Buffer.byteLength(payload(2))});
 await new Promise(setImmediate);assert.equal(readCount,4);assert.ok(peak<=4);
 await beforeRelease(h.journal.append(payload(7)),'append blocked by queued reads');
 h.gate.resolve();assert.deepEqual((await one).map(e=>e.recordSequence),[1,2,3,4,5,6]);
 assert.deepEqual((await two).map(e=>e.recordSequence),[2]);assert.ok(peak<=4);assert.equal(active,0);
});

test('a corrupt sibling yields no partial batch and releases pins only after all readers finish',async t=>{
 const h=await fixture(t),second=await h.journal.append(payload(2));
 const file=path.join(h.dir,`${second.id}.json`),text=await fs.readFile(file,'utf8');
 await fs.writeFile(file,text.replace(second.sha256,(second.sha256[0]==='0'?'1':'0')+second.sha256.slice(1)));
 let settled=false;const reading=h.journal.readBatch({limit:2}).then(()=>{settled=true;assert.fail('corrupt batch accepted');},error=>{settled=true;assert.match(error.message,/checksum|hash|mismatch/);});
 await h.entered.promise;await new Promise(setImmediate);assert.equal(settled,false);
 assert.equal(h.journal.readPins.size,2);
 await beforeRelease(h.journal.append(payload(3)),'append blocked by corrupt read');
 h.gate.resolve();await reading;assert.equal(h.journal.readPins.size,0);
 assert.equal(h.journal.health().readErrors,1);assert.equal(h.journal.health().invalidFiles,1);
 assert.equal(h.journal.health().records,3);
});

test('pinning one delta retains its entire confirmed checkpoint group until read completion',async t=>{
 const h=await fixture(t);h.gate.resolve();
 const {DecisionRecordEncoder}=require('../lib/decision-record-codec');const encoder=new DecisionRecordEncoder();
 const originals=[1000,2000,3000,31000].map((timestamp,index)=>JSON.stringify(encoder.encode({schema:2,
  recordSession:'compact-read',recordSequence:index+1,timestamp,data:{fixed:'x'.repeat(400),value:index}})));
 const entries=await h.journal.appendBatch(originals);assert.equal(entries[0].groupId,entries[2].groupId);
 assert.notEqual(entries[2].groupId,entries[3].groupId);
 const entered=deferred(),gate=deferred(),original=h.journal._readBoundedFile.bind(h.journal);
 h.releases.push(gate.resolve);
 h.journal._readBoundedFile=async(...args)=>{if(args[0].endsWith(`${entries[1].id}.json`)){entered.resolve();await gate.promise;}return original(...args);};
 const reading=h.journal.readBatch({afterId:entries[0].id,limit:1});await entered.promise;
 await beforeRelease(h.journal.confirmStoredBatch(entries.slice(0,3).map(e=>({id:e.id,proof:proof(e)}))),'group proof blocked behind reader');
 assert.ok(entries.slice(0,3).every(e=>h.journal.entries.has(e.id)),'no partial dependency retirement');
 gate.resolve();assert.equal((await reading)[0].payload,originals[1]);await h.journal.tail;
 assert.ok(entries.slice(0,3).every(e=>!h.journal.entries.has(e.id)));
 assert.ok(h.journal.entries.has(entries[3].id));
});
