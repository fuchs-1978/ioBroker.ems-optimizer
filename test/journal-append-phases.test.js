'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const Journal = require('../lib/decision-record-journal');
const payload = n => JSON.stringify({schema: 2, recordSession: 'phase-test', recordSequence: n, timestamp: 1000+n});
const deferred = () => {let resolve; const promise = new Promise(r => {resolve=r;}); return {promise,resolve};};

for (const batch of [false, true]) test(`pending file sync is identified and retained with exact loss metadata; batch=${batch}`, async t => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'ems-phases-'));
    t.after(() => fs.rm(dir,{recursive:true,force:true}));
    let now=1000;const entered=deferred(), gate=deferred();let waiting=0;
    const fileSystem={...fs,async open(file,...args) {
        const h=await fs.open(file,...args);
        if (!/\d{16}\.tmp$/.test(file)) return h;
        return {writeFile:(...a)=>h.writeFile(...a),close:()=>h.close(),async sync() {
            if (++waiting===(batch?2:1)) entered.resolve();
            await gate.promise;return h.sync();
        }};
    }};
    const j=new Journal({directory:dir,fileSystem,now:()=>now});await j.initialize();
    const originals=batch?[payload(1),payload(2)]:[payload(1)];
    const writing=batch?j.appendBatch(originals):j.append(originals[0]);await entered.promise;now=9000;
    try {
    const h=j.health();assert.equal(h.records,0);assert.equal(h.activeOperation.phase,'write-files');
    assert.equal(h.activeOperation.phaseElapsedMs,8000);
    assert.deepEqual(h.activeOperation.fileIO,{open:0,write:0,sync:originals.length,close:0});
    h.activeOperation.fileIO.sync=999;
    assert.equal(j.health().activeOperation.fileIO.sync,originals.length,'snapshots cannot mutate live diagnostics');
    j.reportLoss('queue full',1,{kind:'recorder-queue-full',recordSession:'phase-test',recordSequence:3,
        eventAt:now,observedAt:now,rawBytes:100,limitsHit:{bytes:true,records:false},
        queue:{records:92,bytes:8300000,maxRecords:128,maxBytes:8388608,oldestQueuedAt:1000,oldestWaitMs:8000}});
    const retained=j.health().lossEpisodes.episodes[0].firstContext.journal.activeOperation;
    assert.equal(retained.phase,'write-files');assert.equal(retained.phaseStartedAt,1000);
    assert.equal(retained.phaseElapsedMs,8000);assert.equal(retained.fileIO.sync,originals.length);
    gate.resolve();await writing;
    assert.equal(j.health().lastAppendBatch.phases['write-files'],8000);
    assert.equal(j.health().activeOperation?.phase,undefined);
    assert.deepEqual((await j.readBatch()).map(e=>e.payload),originals);
    await j.close();
    const restored=new Journal({directory:dir,now:()=>now});await restored.initialize();
    assert.deepEqual(restored.health().lossEpisodes.episodes[0].firstContext.journal.activeOperation,retained);
    await restored.close();
    } finally {gate.resolve();await writing.catch(()=>{});if(!j.closed)await j.close();}
});

for (const phase of ['link-files','commit-directory-sync','unlink-temporaries','cleanup-directory-sync'])
test(`slow ${phase} remains distinct and no durable record is published early`, async t => {
    const dir=await fs.mkdtemp(path.join(os.tmpdir(),'ems-phases-'));t.after(()=>fs.rm(dir,{recursive:true,force:true}));
    let now=1000,j,armed=false;const entered=deferred(),gate=deferred(),calls=[];
    const pause=async key=>{calls.push(key);if(armed&&key===phase){entered.resolve();await gate.promise;}};
    const fileSystem={...fs,async link(...a){await pause('link-files');return fs.link(...a);},
        async unlink(...a){await pause('unlink-temporaries');return fs.unlink(...a);}};
    j=new Journal({directory:dir,fileSystem,now:()=>now});await j.initialize();
    const sync=j._syncDirectory.bind(j);let barriers=0;
    j._syncDirectory=async()=>{await pause(++barriers===1?'commit-directory-sync':'cleanup-directory-sync');return sync();};
    armed=true;
    const writing=j.appendBatch([payload(1),payload(2)]);await entered.promise;now=7000;
    try {
    const h=j.health();assert.equal(h.records,0);assert.equal(h.activeOperation.phase,phase);
    assert.equal(h.activeOperation.phaseElapsedMs,6000);assert.equal(h.activeOperation.fileIO,undefined);
    gate.resolve();await writing;assert.equal(j.health().lastAppendBatch.phases[phase],6000);
    assert.equal(j.health().records,2);
    assert.equal(calls.filter(x=>x==='commit-directory-sync').length,1);
    assert.equal(calls.filter(x=>x==='cleanup-directory-sync').length,1);
    assert.ok(calls.indexOf('commit-directory-sync')>calls.indexOf('link-files'));
    assert.ok(calls.indexOf('unlink-temporaries')>calls.indexOf('commit-directory-sync'));
    await j.close();
    } finally {gate.resolve();await writing.catch(()=>{});if(!j.closed)await j.close();}
});
