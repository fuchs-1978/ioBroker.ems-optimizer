'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const {planProgram, startDevicePrograms} = require('../lib/device-programs');

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
