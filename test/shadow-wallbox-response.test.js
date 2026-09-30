'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {wallboxResponse} = require('../lib/shadow-wallbox-response');
const ShadowSampleBuffer = require('../lib/shadow-sample-buffer');

function fixture() {
    const now = 1000000, rawStates = new Map(), mapping = {}, config = {}, devices = [];
    const put = (id, val, extra = {}) => rawStates.set(id, {val, ts: now, ack: true, q: 0, ...extra});
    mapping.DP_GRID_IMPORT = 'import'; mapping.DP_GRID_EXPORT = 'export';
    // Independently generated nominal scenario: 230 V, 16 A legacy WB,
    // 6 A modeled WB and 1 A equivalent net import.
    put('import', 230); put('export', 0);
    for (const wb of [0, 1, 2]) {
        devices.push({wb, valid: true}); config[`wb${wb}ProductionArmed`] = true;
        put(`ems.0.Devices.Wallbox${wb}.Present`, true);
        put(`ems.0.Devices.Wallbox${wb}.ControlEnabled`, true);
        mapping[`DP_WB${wb}_POWER`] = `power${wb}`; put(`power${wb}`, wb === 1 ? 16 * 230 / 1000 : 0);
        for (const p of [1, 2, 3]) {
            mapping[`DP_WB${wb}_L${p}_A`] = `current${wb}.${p}`; put(`current${wb}.${p}`, p === 1 ? 16 : 0);
        }
    }
    const run = sampleBuffer => {
        const states = structuredClone(rawStates);
        return {states, ...wallboxResponse({states, rawStates, devices, mapping, config,
            now, namespace: 'ems.0', sampleBuffer, decision: wb => ({powerW: wb === 1 ? 1380 : 0,
                amps: wb === 1 ? 6 : 0, phases: 1})})};
    };
    return {rawStates, config, put, run};
}

test('private load substitution preserves exogenous balance for all three wallboxes and raw metadata', () => {
    const h = fixture();
    h.put('power0', 1); h.put('power2', 2);
    const before = structuredClone(h.rawStates), r = h.run();
    assert.equal(r.response.valid, true);
    assert.equal(r.response.gridW, 230 + 6 * 230 - 16 * 230 - 1000 - 2000);
    assert.equal(r.states.get('import').val, 0);
    assert.equal(r.states.get('export').val, -r.response.gridW);
    assert.deepEqual([0, 1, 2].map(wb => r.states.get(`power${wb}`).val), [0, 1.38, 0]);
    assert.equal(r.states.get('power1').ts, h.rawStates.get('power1').ts);
    assert.deepEqual(h.rawStates, before);
    assert.equal(r.states.get('current1.1').val, 16, 'real current safety and phase inputs stay untouched');
    assert.equal(r.currents.get(1), 6, 'only the separate vehicle-response hook assumes modeled current');
});

function bufferedFixture(spread = 0.02) {
    const h = fixture(), buffer = new ShadowSampleBuffer();
    const ids = ['import', 'export', 'power0', 'power1', 'power2'];
    for (const id of ids) h.put(id, id === 'import' ? 230 : id === 'power1' ? 3.68 : 0, {ts: 990000});
    buffer.capture(h.rawStates, ids, 990000);
    h.put('import', 230, {ts: 992000}); h.put('export', 0, {ts: 992000});
    buffer.capture(h.rawStates, ids, 992000);
    h.put('import', 300); h.put('export', 0);
    h.put('power1', 3.68 + spread, {ts: 997000});
    h.put('power0', 0); h.put('power2', 0);
    buffer.capture(h.rawStates, ids, 1000000);
    return {h, buffer, ids};
}

test('bounded common historical baseline repairs poll skew, not current protection inputs', () => {
    const {h, buffer} = bufferedFixture(), before = structuredClone(h.rawStates);
    const r = h.run(buffer);
    assert.equal(r.response.valid, true);
    assert.equal(r.response.basis, 'bracketed-historical-input');
    assert.equal(r.response.inputTimestamp, 992000);
    assert.equal(r.response.inputAgeMs, 8000);
    assert.equal(r.response.currentRealGridW, 300);
    assert.equal(r.response.maximumObservedPowerSpreadW, 300);
    assert.ok(Math.abs(r.response.gridW - (230 + 1380 - (3680 + 20 * 2 / 7))) < 0.001);
    assert.equal(r.response.wallboxes.Wallbox1.alignment.beforeTs, 990000);
    assert.equal(r.response.wallboxes.Wallbox1.alignment.afterTs, 997000);
    assert.equal(r.states.get('import').ts, 992000, 'historical input never claims current timestamp');
    assert.deepEqual(h.rawStates, before);
    assert.equal(r.states.get('current1.1').val, 16);
});

test('large load steps, missing brackets and expired baselines stay unknown', () => {
    for (const change of [
        ({h, buffer, ids}) => { h.put('power1', 0, {ts: 997000}); buffer.clear(); buffer.capture(h.rawStates, ids, 1000000); },
        ({buffer}) => buffer.clear(),
        ({buffer}) => { for (const id of ['import', 'export']) buffer.samples.set(id,
            buffer.samples.get(id).filter(s => s.ts < 990000)); }
    ]) {
        const f = bufferedFixture(); change(f);
        const r = f.h.run(f.buffer);
        assert.equal(r.response.valid, false);
        assert.equal(r.response.applied, false);
        assert.deepEqual(r.states, f.h.rawStates);
    }
    const f = bufferedFixture(1);
    assert.equal(f.h.run(f.buffer).response.valid, false, '1-kW bracket is not interpolated');
});

test('history cannot repair invalid latest WB telemetry; affected correction is separately marked', () => {
    for (const extra of [{ack: false}, {q: 64}, {ts: 1}]) {
        const {h, buffer} = bufferedFixture(); h.put('power1', 3.7, extra);
        const r = h.run(buffer);
        assert.equal(r.response.valid, false);
        assert.equal(r.response.wallboxes.Wallbox1.telemetryValid, false);
        assert.equal(r.response.applied, false);
    }
    const {h} = bufferedFixture(); const r = h.run();
    assert.equal(r.response.wallboxes.Wallbox1.telemetryValid, true);
    assert.equal(r.response.wallboxes.Wallbox1.correctionValid, false);
    assert.equal(r.response.wallboxes.Wallbox0.correctionValid, true);
});

test('quality gaps are not interpolated and buffer memory is bounded', () => {
    const b = new ShadowSampleBuffer(), states = new Map();
    for (let i = 0; i < 500; i++) {
        states.set('p', {val: 3.68, ts: 100000 + i, ack: true, q: 0});
        b.capture(states, ['p'], 100000 + i);
    }
    assert.ok(b.samples.get('p').length <= 128);
    states.set('p', {val: 3.68, ts: 101000, ack: true, q: 64}); b.capture(states, ['p'], 101000);
    assert.equal(b.at('p', 100900, true), null);
    b.capture(states, ['p'], 200000);
    assert.equal(b.samples.get('p').length, 0);
});

test('an invalid real power source disables the response instead of repairing safety data', () => {
    for (const [value, extra, reason] of [[-0.021, {}, 'negative'], [null, {}, 'numeric'],
        [16 * 230 / 1000, {ts: 1}, 'stale'], [16 * 230 / 1000, {ts: 1001001}, 'future'],
        [16 * 230 / 1000, {ack: false}, 'unacknowledged'], [16 * 230 / 1000, {q: 64}, 'quality']]) {
        const h = fixture(); h.put('power1', value, extra);
        const r = h.run();
        assert.equal(r.response.valid, false, reason);
        assert.equal(r.response.applied, false);
        assert.match(r.response.reason, new RegExp(reason));
        assert.deepEqual(r.states, h.rawStates, 'no partial load/grid substitution');
        assert.equal(r.currents.size, 0);
    }
});

test('small fresh negative meter noise is normalized, while disconnected WB loads remain exogenous', () => {
    const h = fixture(); h.put('power1', -0.01);
    h.put('power2', 2); h.put('ems.0.Devices.Wallbox2.ControlEnabled', false);
    const r = h.run();
    assert.equal(r.response.valid, true);
    assert.equal(r.response.wallboxes.Wallbox1.rawPowerW, -10);
    assert.equal(r.response.wallboxes.Wallbox1.realPowerW, 0);
    assert.equal(r.response.gridW, 230 + 6 * 230);
    assert.equal(r.states.get('power2').val, 2);
    assert.equal(r.response.wallboxes.Wallbox2, undefined);
});

test('a newer grid measurement cannot be combined with an old large WB correction', () => {
    const h = fixture();
    h.put('import', 0); h.put('export', 3541);
    h.put('power1', 5.11, {ts: 1000000 - 3661});
    const r = h.run();
    assert.equal(r.response.valid, false);
    assert.equal(r.response.applied, false);
    assert.match(r.response.reason, /grid-power-asynchronous \(3661 ms/);
    assert.equal(r.response.wallboxes.Wallbox1.gridPowerSkewMs, 3661);
    assert.deepEqual(r.states, h.rawStates);
    h.put('power1', 5.11, {ts: 1000000 - 500});
    assert.equal(h.run().response.valid, true);
});

test('small substitutions tolerate ordinary meter and wallbox poll skew', () => {
    const h = fixture();
    h.put('power1', 1.3, {ts: 1000000 - 3661});
    assert.equal(h.run().response.valid, true);
});
