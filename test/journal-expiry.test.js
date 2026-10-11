'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const Journal = require('../lib/decision-record-journal');
const {DecisionRecordEncoder, decodeDecisionRecords} = require('../lib/decision-record-codec');
const AGE = 86400000;
const legacy = seq => JSON.stringify({schema: 2, recordSession: 'legacy', recordSequence: seq, timestamp: 1000 + seq});
async function dir(t) {const d = await fs.mkdtemp(path.join(os.tmpdir(), 'ems-expiry-')); t.after(() => fs.rm(d, {recursive:true, force:true})); return d;}
function frames() {const encoder = new DecisionRecordEncoder();return [1000,2000,31000].map((timestamp,i) => JSON.stringify(encoder.encode({schema:2,recordSession:'chain',recordSequence:i+1,timestamp,production:{long:'context'.repeat(100),value:i}})));}

test('expiry keeps recent records and records exact loss identity before deleting old legacy originals', async t => {
 const d=await dir(t);let at=1000;const j=new Journal({directory:d,now:()=>at});await j.initialize();await j.append(legacy(1));
 at=1000+AGE-1;assert.deepEqual(await j.expireOldGroups(),[]);assert.equal(j.health().records,1);
 at++;assert.equal((await j.expireOldGroups()).length,1);assert.equal(j.health().records,0);
 assert.equal(j.health().sqlConfirmedRecords,0);assert.equal(j.health().expiredUnconfirmedRecords,1);
 assert.equal(j.health().oldestRetainedAt,null);assert.equal(j.health().lastExpiry.firstSequence,1);
 assert.equal(j.health().lastExpiry.reason,'local-retention-expired-sql-coverage-unknown');
 await j.close();const r=new Journal({directory:d});await r.initialize();assert.equal(r.health().expiredRecords,1);assert.equal(r.health().lastExpiry.firstEventAt,1001);await r.close();
});

test('expiry is whole-chain only, preserves a live delta basis and takes the newest member age',async t=>{
 const d=await dir(t);let at=1000;const j=new Journal({directory:d,now:()=>at});await j.initialize();const f=frames();
 const a=await j.append(f[0]);at=2000;await j.append(f[1]);at=1000+AGE;assert.deepEqual(await j.expireOldGroups(),[]);
 await j.append(f[2]);assert.deepEqual(await j.expireOldGroups(),[],'closed chain contains a newer delta');
 at=2000+AGE;assert.equal((await j.expireOldGroups()).length,2);assert.equal(j.health().expiredUnconfirmedRecords,2);
 const remain=await j.readBatch();assert.equal(remain.length,1);assert.equal(JSON.parse(remain[0].payload).frameType,'snapshot');
 assert.equal(j.health().lastExpiry.firstSequence,1);assert.equal(j.health().lastExpiry.lastSequence,2);
 assert.equal(decodeDecisionRecords(remain.map(x=>x.payload)).length,1);await j.close();
});

test('recovered stale open chain can expire while SQL verification fence remains unresolved',async t=>{
 const d=await dir(t);const j=new Journal({directory:d});await j.initialize();await j.append(frames()[0]);
 await j.beginVerification({verificationId:'old-query',start:1,end:2,limit:1,beganAt:1});await j.close();
 for(const f of await fs.readdir(d))if(f.endsWith('.json')&&/^\d/.test(f))await fs.utimes(path.join(d,f),new Date(1000),new Date(1000));
 const r=new Journal({directory:d,now:()=>1000+AGE});await r.initialize();assert.equal((await r.expireOldGroups()).length,1);
 assert.equal(r.health().sqlVerificationPending,true);assert.equal(r.health().sqlVerificationQuery.verificationId,'old-query');await r.close();
 const again=new Journal({directory:d});await again.initialize();assert.equal(again.health().expiredRecords,1);assert.equal(again.health().sqlVerificationPending,true);await again.close();
});

test('crash during expiry unlink recovers durable loss marker once before completing legacy deletion',async t=>{
 const d=await dir(t);let fail=true;let at=1000;
 const j=new Journal({directory:d,now:()=>at,fileSystem:{...fs,unlink:async f=>{if(f.endsWith('.json')&&/^\d/.test(path.basename(f))&&fail){fail=false;throw new Error('simulated expiry crash');}return fs.unlink(f);}}});
 await j.initialize();await j.append(legacy(1));at+=AGE;await assert.rejects(j.expireOldGroups(),/simulated expiry crash/);
 assert.equal(j.health().records,1);assert.equal(j.health().expiredRecords,1);await j.close();
 const r=new Journal({directory:d});await r.initialize();assert.equal(r.health().records,0);assert.equal(r.health().expiredRecords,1);assert.equal(r.health().expiredUnconfirmedRecords,1);
 assert.equal((await fs.readdir(d)).some(f=>f.endsWith('.retired')),false);await r.close();
});

test('failure to durably write expiry metadata retains every original',async t=>{
 const d=await dir(t);let at=1000;let fail=false;
 const j=new Journal({directory:d,now:()=>at,fileSystem:{...fs,link:async(a,b)=>{if(fail&&b.endsWith('.retired'))throw new Error('marker failure');return fs.link(a,b);}}});
 await j.initialize();await j.append(legacy(1));at+=AGE;fail=true;await assert.rejects(j.expireOldGroups(),/marker failure/);
 assert.equal(j.health().records,1);assert.equal(j.health().expiredRecords,0);await j.close();
});

test('expiry marker survives health persistence failure and recovery removes a complete compact chain once',async t=>{
 const d=await dir(t);let at=1000;let fail=false;
 const j=new Journal({directory:d,now:()=>at,fileSystem:{...fs,rename:async(a,b)=>{if(fail&&b.endsWith('health.json'))throw new Error('health persistence failure');return fs.rename(a,b);}}});
 await j.initialize();const f=frames();await j.append(f[0]);await j.append(f[1]);await j.append(f[2]);at+=AGE;fail=true;
 await assert.rejects(j.expireOldGroups(),/health persistence failure/);assert.equal(j.health().records,3);
 fail=false;await j.close();const r=new Journal({directory:d});await r.initialize();assert.equal(r.health().records,1);
 assert.equal(r.health().expiredRecords,2);assert.equal(r.health().sqlConfirmedRecords,0);
 const remains=await r.readBatch();assert.equal(JSON.parse(remains[0].payload).frameType,'snapshot');await r.close();
 const again=new Journal({directory:d});await again.initialize();assert.equal(again.health().expiredRecords,2);await again.close();
});

test('backward clock and malformed retained originals are never aged out',async t=>{
 const d=await dir(t);let at=1000;const j=new Journal({directory:d,now:()=>at});await j.initialize();const item=await j.append(legacy(1));
 at=500;assert.deepEqual(await j.expireOldGroups(),[]);await j.close();
 await fs.writeFile(path.join(d,item.id+'.json'),'broken');const r=new Journal({directory:d,now:()=>AGE*2});await r.initialize();
 assert.equal(r.health().integrityValid,false);assert.deepEqual(await r.expireOldGroups(),[]);assert.ok((await fs.readdir(d)).includes(item.id+'.json'));await r.close();
});
