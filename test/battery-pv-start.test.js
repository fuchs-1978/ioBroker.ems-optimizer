'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {createEngineContext} = require('../lib/engine-loader');

const origin = 1000000;
const driver = 'system.adapter.sunenergyxt500.0';

function observer() {
    let now = origin;
    class Clock extends Date { static now() { return now; } }
    const cycleId = 'ems.0.Config.SlowControlCycle_s';
    const context = createEngineContext('ems.0', {}, {Date: Clock, nativeConfig: {},
        existsState: id => id === cycleId, getState: id => id === cycleId ? {val: 2, ts: now, ack: true} : null});
    return (elapsed, {deviceAt = elapsed - elapsed % 5000, sourceAt = deviceAt, meterAt = elapsed,
        gridW = -1200, batteryW = 2399, maxAgeMs = 30000, held = false, valid = true, from = driver,
        eligible = true, setpointId = 'sunenergyxt500.0.heads.1.control.GS'} = {}) => {
        now = origin + elapsed;
        const head = {baseId: 'sunenergyxt500.0.heads.1', setpointId, sourceFrom: from,
            deviceTs: origin + deviceAt, sourceTs: origin + sourceAt};
        return context.observeBatteryPvStartBudget(now,
            {heads: [head], maxChargeW: 2400, actualW: batteryW, measurementAgeMs: maxAgeMs},
            {valid, held, gridW, sourceTs: [origin + meterAt, origin + meterAt]}, eligible);
    };
}

test('independent grid samples cannot complete two minutes before the next genuine SunEnergy report', () => {
    const observe = observer();
    // Intervals seen with the five-second driver, including a late report.
    const intervals = [5100, 5090, 5220, 5080, 6580, 5110, 4980];
    let deviceAt = 0, next = intervals[0], count = 0, first = null;
    for (let elapsed = 0; elapsed <= 130000; elapsed += 250) {
        if (elapsed >= next) {
            deviceAt = next;
            next += intervals[++count % intervals.length];
        }
        const since = observe(elapsed, {deviceAt});
        if (deviceAt < 120000) assert.equal(since, null);
        else {
            assert.equal(since, origin);
            first ??= elapsed;
        }
    }
    assert.ok(first > 120000 && first < 127000);
});

test('a missed head report during qualification requires a new two-minute interval', () => {
    const observe = observer();
    for (let t = 0; t < 125000; t += 1000) {
        const deviceAt = Math.min(t - t % 5000, 115000);
        // Re-publication of the same device timestamp must not renew the observation.
        assert.equal(observe(t, {deviceAt, sourceAt: t}), null);
    }
    for (let t = 125000; t < 245000; t += 1000) assert.equal(observe(t), null);
    assert.equal(observe(245000), origin + 125000);
});

test('configured head freshness and the ten-second ceiling bound any learned cadence', () => {
    for (const [period, maxAgeMs] of [[5000, 3500], [11000, 30000]]) {
        const observe = observer();
        for (let t = 0; t <= 180000; t += 1000)
            assert.equal(observe(t, {deviceAt: t - t % period, maxAgeMs}), null);
    }
});

for (const [scenario, change] of Object.entries({
    'a held grid pair': {held: true},
    'a stale grid sample': {meterAt: 119000},
    'an invalid grid sample': {valid: false},
    'grid import funding the charge between head reports': {gridW: 200},
    'battery power below the threshold': {batteryW: 2340},
    'a foreign head source': {from: 'system.adapter.other.0'},
    'withdrawn start eligibility': {eligible: false},
    'a change of head': {setpointId: 'sunenergyxt500.0.heads.2.control.GS'},
    'a backwards device timestamp': {deviceAt: 119000}
})) test(`the shortened PV start loses its qualification on ${scenario}`, () => {
    const observe = observer();
    for (let t = 0; t < 124000; t += 1000) observe(t);
    assert.equal(observe(124000), origin);
    assert.equal(observe(125000, change), null);
    assert.equal(observe(126000), null);
});
