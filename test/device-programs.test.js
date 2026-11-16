'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const {learnProfile, planProgram, startDevicePrograms} = require('../lib/device-programs');

test('disabled rows make no I/O', () => {
    startDevicePrograms({config: {devicePrograms: [{mode: 'off'}]}});
});

test('selects the cheapest covered slot and reports the marginal grid cost', () => {
    const grid = [{timestamp: 0, valueW: 0}, {timestamp: 900000, valueW: -500}];
    const prices = grid.map(({timestamp}) => ({timestamp, valid: true, value_ct_kWh: 40}));
    const result = planProgram([1000], grid, prices, 0, 1800000);
    assert.equal(result.plannedStartAt, 900000);
    assert.equal(result.estimatedGridCost_EUR, 0.05);
    assert.equal(result.estimatedSavings_EUR, 0.05);
    assert.equal(planProgram([], grid, prices, 0, 1800000), null);
    assert.equal(planProgram([1000], grid, prices, 0, 899999), null);
});

test('learns quarter-hour loads from a run starting off the grid and rejects gaps', () => {
    const start = 12345;
    const samples = Array.from({length: 20}, (_, i) => ({ts: start + i * 60000, val: 600}));
    const learned = learnProfile(samples, start, start + 1200000);
    assert.equal(learned.energyKWh, 0.2);
    assert.deepEqual(learned.watts, [600, 200]);
    assert.equal(learnProfile(samples.filter((_, i) => i !== 6), start, start + 1200000), null);
});
