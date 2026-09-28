'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {wallboxResponse} = require('../lib/shadow-wallbox-response');

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
    const run = () => {
        const states = structuredClone(rawStates);
        return {states, ...wallboxResponse({states, rawStates, devices, mapping, config,
            now, namespace: 'ems.0', decision: wb => ({powerW: wb === 1 ? 1380 : 0,
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
