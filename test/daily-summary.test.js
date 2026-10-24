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
