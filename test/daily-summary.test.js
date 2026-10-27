'use strict';
const {test} = require('node:test');
const assert = require('node:assert/strict');
const {DailySummary, period, MAX_BYTES} = require('../lib/daily-summary');
function adapter(saved) {
    return {namespace: 'ems-optimizer.0', writes: [], log: {warn() {}},
        async queueCompatState() {}, async getStateAsync() { return {val: saved}; },
        async setStateAsync(id, s) { this.writes.push({id, ...s}); }};
}
function snapshot(ts, watts = 1000) {
    return {ts, power: {grid_W: watts, pv_W: 2000},
        system: {RealOutputsEnabled: true}, control: {SelectedWallbox: 0},
        measurements: {gridImport: {valid: true, ts}, gridExport: {valid: true, ts},
            bhkw: {power: {valid: true, val: 500}}}, ehz: {actual_W: 0},
        wallboxes: [0, 1, 2].map(wb => ({wb, actual_W: 1000, LastStopAt: 0, ConfirmedPhases: 1}))};
}
const at = Date.parse('2026-10-24T10:00:00Z');
test('recorder counter increases across a same-period sampling gap remain counted without energy coverage', async () => {
    const d = new DailySummary(adapter()); await d.initialize();
    d.sample(snapshot(at), {dropped: 0, writeErrors: 0});
    d.sample(snapshot(at + 12343), {dropped: 32, writeErrors: 32});
    d.sample(snapshot(at + 17343), {dropped: 53, writeErrors: 53});
    assert.equal(d.data.current.recorder.droppedObserved, 53);
    assert.equal(d.data.current.recorder.writeErrorsObserved, 53);
    assert.equal(d.data.current.sources.grid.coveredMs, 5000);
    assert.equal(d.data.current.sources.grid.importWh, 1000 * 5 / 3600);
    assert.deepEqual(d.data.current.events.filter(e => e.type === 'recorder.dropped').map(e => e.detail.delta), [32, 21]);
});
test('recorder reset across a sampling gap establishes a baseline instead of negative losses', async () => {
    const d = new DailySummary(adapter()); await d.initialize();
    d.sample(snapshot(at), {dropped: 53, writeErrors: 53});
    d.sample(snapshot(at + 20000), {dropped: 0, writeErrors: 0});
    d.sample(snapshot(at + 25000), {dropped: 2, writeErrors: 2});
    assert.equal(d.data.current.recorder.droppedObserved, 2);
    assert.equal(d.data.current.recorder.writeErrorsObserved, 2);
    assert.equal(d.data.current.recorder.counterResets, 2);
});
test('restart does not attribute the unknown counter baseline to the restored day', async () => {
    const a = adapter(), d = new DailySummary(a); await d.initialize();
    d.sample(snapshot(at), {dropped: 0, writeErrors: 0});
    d.sample(snapshot(at + 5000), {dropped: 3, writeErrors: 3}); await d.stop();
    const r = new DailySummary(adapter(a.writes.at(-1).val)); await r.initialize();
    r.sample(snapshot(at + 60000), {dropped: 50, writeErrors: 50});
    r.sample(snapshot(at + 80000), {dropped: 52, writeErrors: 52});
    assert.equal(r.data.current.recorder.droppedObserved, 5);
    assert.equal(r.data.current.sources.grid.coveredMs, 5000);
});
test('counter increments across a long period boundary remain unassigned', async () => {
    const d = new DailySummary(adapter()); await d.initialize(); const b = period(at).to;
    d.sample(snapshot(b - 15000), {dropped: 10, writeErrors: 10});
    d.sample(snapshot(b + 5000), {dropped: 20, writeErrors: 20});
    d.sample(snapshot(b + 10000), {dropped: 21, writeErrors: 21});
    assert.equal(d.data.previous.recorder.droppedObserved, 0);
    assert.equal(d.data.current.recorder.droppedObserved, 1);
    assert.equal(d.data.previous.sources.grid.coveredMs, 0);
    assert.equal(d.data.current.sources.grid.coveredMs, 5000);
});
test('Berlin 20h periods handle both DST changes independently of host timezone', () => {
    assert.equal(period(Date.parse('2026-10-25T12:00Z')).to - period(Date.parse('2026-10-25T12:00Z')).from, 25 * 3600000);
    assert.equal(period(Date.parse('2026-03-29T12:00Z')).to - period(Date.parse('2026-03-29T12:00Z')).from, 23 * 3600000);
    assert.equal(new Date(period(at).from).toISOString(), '2026-10-23T18:00:00.000Z');
});
test('bounded energy, invalid data and outages do not become zero or fabricated coverage', async () => {
    const d = new DailySummary(adapter()); await d.initialize();
    d.sample(snapshot(at)); d.sample(snapshot(at + 5000));
    const invalid = snapshot(at + 10000); invalid.power.grid_W = null; d.sample(invalid);
    d.sample(snapshot(at + 15000)); d.sample(snapshot(at + 100000));
    assert.equal(d.data.current.sources.grid.coveredMs, 5000);
    assert.equal(d.data.current.sources.grid.importWh, 1000 * 5 / 3600);
    assert.equal(d.data.current.sources.grid.exportWh, 0);
    assert.equal(d.data.current.avoidableExportWh, null);
    await d.stop();
});
test('restart restores totals but never integrates downtime or invents events', async () => {
    const a = adapter(), d = new DailySummary(a); await d.initialize();
    d.sample(snapshot(at)); d.sample(snapshot(at + 5000)); await d.stop();
    const r = new DailySummary(adapter(a.writes.at(-1).val)); await r.initialize();
    r.sample(snapshot(at + 60000)); r.sample(snapshot(at + 65000));
    assert.equal(r.data.current.sources.grid.coveredMs, 10000);
    assert.equal(r.data.current.starts, 2); assert.equal(r.data.current.eventCount, 0);
});
test('period rollover splits a valid interval exactly once and preserves previous report', async () => {
    const d = new DailySummary(adapter()); await d.initialize(); const boundary = period(at).to;
    d.sample(snapshot(boundary - 2000)); d.sample(snapshot(boundary + 3000));
    assert.equal(d.data.previous.sources.grid.coveredMs, 2000);
    assert.equal(d.data.current.sources.grid.coveredMs, 3000);
});
test('event storage and checkpoint remain bounded; sampled stops retain reason', async () => {
    const a = adapter(), d = new DailySummary(a); await d.initialize();
    for (let n = 0; n < 500; n++) {
        const s = snapshot(at + n * 5000); s.wallboxes[0].LastStopAt = n;
        s.wallboxes[0].LastStopReason = 'SoC end'; d.sample(s);
    }
    await d.stop();
    assert.equal(d.data.current.events.length, 100); assert.equal(d.data.current.eventOverflow, 399);
    assert.equal(d.data.current.events[0].detail.reason, 'SoC end');
    assert.ok(Buffer.byteLength(a.writes.at(-1).val) < MAX_BYTES);
});
test('bad checkpoint and incoherent net meter are rejected', async () => {
    const d = new DailySummary(adapter('{"schema":1,"current":{}}')); await d.initialize();
    const s = snapshot(at); s.measurements.gridExport.ts -= 6000;
    d.sample(s); s.ts += 5000; d.sample(s);
    assert.equal(d.data.current.sources.grid.coveredMs, 0);
});
test('two periods of multibyte reasons are trimmed to the hard byte budget', async () => {
    const a = adapter(), d = new DailySummary(a); await d.initialize();
    d.sample(snapshot(at));
    for (let n = 1; n <= 100; n++) {
        const s = snapshot(at + n * 5000); s.wallboxes[0].LastStopAt = n;
        s.wallboxes[0].LastStopReason = '漢'.repeat(200); d.sample(s);
    }
    const boundary = period(at).to;
    for (let n = 0; n < 101; n++) {
        const s = snapshot(boundary + n * 5000); s.wallboxes[0].LastStopAt = n;
        s.wallboxes[0].LastStopReason = '漢'.repeat(200); d.sample(s);
    }
    await d.stop();
    assert.ok(Buffer.byteLength(a.writes.at(-1).val) <= MAX_BYTES);
    assert.ok(d.data.previous.eventOverflow > 0);
});
test('qualified episodes survive checkpoint and restart without covering downtime', async () => {
    const a=adapter(), d=new DailySummary(a); await d.initialize();
    for(let i=0;i<14;i++) {const s=snapshot(at+i*5000,-800);s.control.TargetGridPower_W=50;d.sample(s);}
    await d.stop(); const r=new DailySummary(adapter(a.writes.at(-1).val)); await r.initialize();
    const s=snapshot(at+120000,-800);s.control.TargetGridPower_W=50;r.sample(s);
    const windows=r.report().current.investigationWindows;
    assert.equal(windows.find(w=>w.type==='export').endReason,'restart');
    assert.equal(windows.find(w=>w.type==='export').durationMs,65000);
    assert.equal(windows.find(w=>w.type==='sampling-gap').durationMs,55000);
});
test('period rollover clips episode boundaries and accepts old alpha.132 checkpoint totals', async () => {
    const a=adapter(), d=new DailySummary(a); await d.initialize();const b=period(at).to;
    for(let i=0;i<16;i++) {const s=snapshot(b-70000+i*5000,-800);s.control.TargetGridPower_W=50;d.sample(s);}
    const w=d.report().previous.investigationWindows.find(x=>x.type==='export');
    assert.equal(w.to,b); assert.equal(w.endReason,'period-end');
    assert.ok(w.investigateTo<=b);
    const old=d.report();delete old.current.investigation;delete old.current.investigationWindows;
    const r=new DailySummary(adapter(JSON.stringify(old))); await r.initialize();
    assert.equal(r.data.current.sources.grid.coveredMs,d.data.current.sources.grid.coveredMs);
});

test('critical admission survives a full event list and keeps separate newest stop/error reserves', async () => {
    const d = new DailySummary(adapter()); await d.initialize(); d.sample(snapshot(at));
    const p = d.data.current;
    for (let n=0;n<100;n++) d.event(p, at+n, 'selectedWallbox', {before:0,after:1});
    for (let n=0;n<9;n++) d.event(p, at+100+n, 'wb2.stopAt', {stopAt:at+100+n,reason:'normal SoC end'});
    for (let n=0;n<110;n++) d.event(p, at+200+n, 'recorder.writeErrors', {delta:1});
    assert.equal(p.events.length,100);
    assert.deepEqual(p.events.filter(e=>e.type==='wb2.stopAt').map(e=>e.at),
        Array.from({length:6},(_,n)=>at+103+n));
    assert.deepEqual(p.events.slice(-2).map(e=>e.at),[at+308,at+309]);
    assert.equal(p.eventOverflow,p.eventCount-p.events.length);
    const r=d.report().current.eventRetention;
    assert.deepEqual(r.protectedLimits,{wallboxStop:6,recorderError:2});
    assert.deepEqual(r.retainedProtected,{wallboxStop:6,recorderError:2});
    assert.equal(r.protectedOverflow,0);
});

async function crowdedPeriods() {
    const a=adapter(),d=new DailySummary(a);await d.initialize();
    for (const base of [at,period(at).to]) {
        for(let block=0;block<16;block++) for(let sample=0;sample<16;sample++) {
            const t=base+(block*16+sample)*5000;
            const s=snapshot(t,sample===15?0:-1500-block*100);
            s.control.TargetGridPower_W=0;
            s.wallboxes[0].LastStopAt=base+block*80000;
            s.wallboxes[0].LastStopReason='sampled stop '+block+' 漢'.repeat(35);
            s.wallboxes[0].currentConflict={at:t,gate:'command-before-write',expectedA:10,observedA:11};
            d.sample(s,{dropped:block,writeErrors:Math.floor(block/2)});
        }
    }
    await d.stop();return {a,d};
}

test('64 kB pressure prunes episodes before reserved stops/errors across both periods; restore preserves evidence', async () => {
    const {a,d}=await crowdedPeriods(), report=d.report();
    assert.ok(Buffer.byteLength(a.writes.at(-1).val)<=MAX_BYTES);
    let episodeLoss=0;
    for(const p of [report.previous,report.current]) {
        assert.deepEqual(p.eventRetention.retainedProtected,{wallboxStop:6,recorderError:2});
        assert.equal(p.eventRetention.protectedOverflow,0);
        assert.ok(p.events.some(e=>e.detail.currentConflict?.gate==='command-before-write'));
        assert.equal(p.eventCount,p.eventOverflow+p.events.length);
        episodeLoss+=p.investigation.overflow;
    }
    assert.ok(episodeLoss>0,'size/retention losses remain visible, not hidden');
    const totals=JSON.stringify([report.previous.sources,report.current.sources]);
    await d.save();assert.equal(JSON.stringify([d.report().previous.sources,d.report().current.sources]),totals);
    const restored=new DailySummary(adapter(a.writes.at(-1).val));await restored.initialize();
    for(const name of ['previous','current']) {
        assert.deepEqual(restored.report()[name].events,report[name].events);
        assert.equal(restored.report()[name].eventOverflow,report[name].eventOverflow);
    }
});

test('legacy overflow and empty event list are retained without inventing recovered events', async () => {
    const a=adapter(),d=new DailySummary(a);await d.initialize();d.sample(snapshot(at));
    d.data.current.eventCount=35;d.data.current.eventOverflow=35;
    delete d.data.current.protectedEventOverflow;
    await d.stop();const saved=JSON.parse(a.writes.at(-1).val);
    delete saved.current.eventRetention;
    const r=new DailySummary(adapter(JSON.stringify(saved)));await r.initialize();
    assert.deepEqual(r.data.current.events,[]);assert.equal(r.data.current.eventCount,35);
    assert.equal(r.data.current.eventOverflow,35);assert.equal(r.report().current.eventRetention.protectedOverflow,0);
});

test('recorder increases stay observed across gaps while resets never create negative losses', async () => {
    const d=new DailySummary(adapter());await d.initialize();
    d.sample(snapshot(at),{dropped:10,writeErrors:5});
    d.sample(snapshot(at+5000),{dropped:12,writeErrors:6});
    assert.deepEqual(d.data.current.events.map(e=>[e.type,e.detail.delta]),[['recorder.dropped',2],['recorder.writeErrors',1]]);
    d.sample(snapshot(at+10000),{dropped:0,writeErrors:0});
    d.sample(snapshot(at+100000),{dropped:50,writeErrors:50});
    assert.equal(d.data.current.events.length,4);
    assert.deepEqual(d.data.current.recorder,{droppedObserved:52,writeErrorsObserved:51,counterResets:2});
});

test('irreducible base still respects 64 kB and explicitly counts forced protected event losses', async () => {
    const a=adapter(),d=new DailySummary(a);await d.initialize();d.sample(snapshot(at));
    const p=d.data.current;
    p.syntheticPadding='x'.repeat(MAX_BYTES-Buffer.byteLength(JSON.stringify(d.report()))-220);
    for(let n=0;n<6;n++) d.event(p,at+n,'wb0.stopAt',{reason:'漢'.repeat(200),stopAt:at+n});
    await d.stop();
    assert.ok(Buffer.byteLength(a.writes.at(-1).val)<=MAX_BYTES);
    assert.ok(d.report().current.eventRetention.protectedOverflow>0);
    assert.equal(p.eventCount,p.events.length+p.eventOverflow);
});
