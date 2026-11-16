'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const {learnProfile, planProgram, programAnnouncement, startDevicePrograms} = require('../lib/device-programs');

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

test('announcement is stable per release and describes estimated savings', () => {
    const now = Date.parse('2026-11-16T19:00:00Z');
    const plan = {plannedStartAt: now + 3600000, estimatedSavings_EUR: 0.18};
    const first = programAnnouncement('Geschirrspüler', plan, 'release-1', 'eco', now);
    assert.match(first.text, /21:00 Uhr.*18 Cent/);
    assert.equal(first.id, programAnnouncement('Geschirrspüler', {...plan, plannedStartAt: now},
        'release-1', 'eco', now).id);
    assert.notEqual(first.id, programAnnouncement('Geschirrspüler', plan, 'release-2', 'eco', now).id);
    assert.doesNotMatch(programAnnouncement('Geschirrspüler', {...plan, estimatedSavings_EUR: null},
        'release-1', 'eco', now).text, /Cent/);
});
