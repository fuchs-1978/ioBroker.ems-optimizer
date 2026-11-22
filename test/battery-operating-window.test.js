'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {calibrationWindow, comparable, completeForecast, month} = require('../lib/battery-operating-window');
const quarter = 900000;
const now = Date.parse('2026-07-20T17:03:00+02:00');
const slot = (timestamp, pvW) => ({timestamp, pvW, baseW: 400, dhwW: 0, heatingW: 0, wallboxW: 0, mandatoryThermalW: 0});

test('an active calibration can finish in its last PV quarter after a restart, rain or an already recorded full charge cancels it', () => {
    const start = Math.floor(now / quarter) * quarter;
    const active = {start: start - quarter * 4, end: start + quarter, day: '2026-07-20'};
    const options = {now, lastFull: now - month, initialSoc: 99, capacity: 15.06, maxCharge: 2400,
        efficiency: 0.94, safety: 0.8, active};
    const slots = [slot(start, 2800), slot(start + quarter, 0)];
    assert.deepEqual(calibrationWindow(slots, [{soc: 99}, {soc: 99}], options), active);
    assert.equal(calibrationWindow(slots, [{soc: 99}, {soc: 99}], {...options, lastFull: now - 1000}), null);
    assert.equal(calibrationWindow([slot(start, 0), slots[1]], [{soc: 99}, {soc: 99}], options), null);
});

test('a March PV window ending at 14:00 Berlin time qualifies and one ending at 13:45 does not', () => {
    const start = Date.parse('2026-03-03T13:00:00+01:00');
    const options = {now: start, lastFull: start - month, initialSoc: 95, capacity: 15,
        maxCharge: 2400, efficiency: 0.94, safety: 0.8};
    const slots = [4000, 4000, 4000, 4000, 0].map((pv, i) => slot(start + i * quarter, pv));
    const trajectory = slots.map(() => ({soc: 95}));
    assert.equal(calibrationWindow(slots, trajectory, options).end, start + 4 * quarter);
    slots[3].pvW = 0;
    assert.equal(calibrationWindow(slots, trajectory, options), null);
});

test('a lower profile cannot strand a car at departure or buy extra energy hidden by a lower final inventory', () => {
    const ref = {endSoc: 80, importWh: 300, exportWh: 5000, service: [3000, 1800, 1500]};
    const lower = {...ref, endSoc: 60, exportWh: 8100};
    assert.equal(comparable(ref, lower, 15, 0.94), true);
    assert.equal(comparable(ref, {...lower, service: [3000, 1600, 1500]}, 15, 0.94), false);
    assert.equal(comparable(ref, {...lower, importWh: 450}, 15, 0.94), false);
    assert.equal(comparable(ref, {...lower, exportWh: 8400}, 15, 0.94), false);
});

test('the operating window accepts a missing PV reading as zero and rejects a missing load or a gap in the time grid', () => {
    const start = Math.floor(now / quarter) * quarter;
    const series = Array.from({length: 192}, (_, i) => ({timestamp: start + quarter * i, valueW: 500}));
    const data = {pv: structuredClone(series), house: structuredClone(series)};
    data.pv[88] = {...data.pv[88], source: 'unavailable', valueW: 0};
    assert.equal(completeForecast(data, now), true);
    data.house[88].valueW = null;
    assert.equal(completeForecast(data, now), false);
    data.house[88].valueW = 500;
    data.pv[114].timestamp += quarter;
    assert.equal(completeForecast(data, now), false);
});
