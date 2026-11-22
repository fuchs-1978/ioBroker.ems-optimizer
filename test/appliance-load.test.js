'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {historyCorrections, programIdentity, programProfileId, programHistoryId} = require('../lib/appliance-load');
const {learnProfile} = require('../lib/device-programs');

const SLOT = 900000;
const BASE = Date.parse('2026-11-22T12:00:00Z');

test('a complete metered run retains both program-relative and exact clock-quarter energy', () => {
    const start = BASE + 600000, end = start + SLOT;
    const samples = Array.from({length: 15}, (_, i) => ({ts: start + i * 60000, val: i < 5 ? 1800000 : 300000}));
    const learned = learnProfile(samples, start, end, 'mW');
    assert.deepEqual(learned.watts, [800]);
    assert.deepEqual(learned.gridWatts, [600, 200]);
    assert.equal(learned.energyKWh, 0.2);
    assert.equal(learnProfile(samples.filter((_, i) => i !== 4), start, end, 'mW'), null);
});

test('history corrects simultaneous measured runs once, skips uncertain intervals and isolates individual appliances', () => {
    const rows = ['dryer', 'dishwasher'].map(name => ({mode: 'observe', statusObject: name,
        powerObject: name + '.power', includedInSubmeters: true}));
    const [dryer, dish] = rows.map(programIdentity);
    const states = new Map();
    const put = (id, val) => states.set('ems.0.' + id, {val: JSON.stringify(val), ts: BASE + 9 * SLOT, ack: true});
    put(programProfileId(dryer, 'Cottons'), {program: 'Cottons', runs: [
        {start: BASE + 600000, end: BASE + 1500000, watts: [800]}, // Archive supersedes relative data.
        {start: BASE + 4 * SLOT + 60000, end: BASE + 5 * SLOT, watts: [400]}]});
    put(programHistoryId(dryer), [{start: BASE + 600000, end: BASE + 1500000, gridWatts: [600, 200]}]);
    put(programHistoryId(dish), [{start: BASE, end: BASE + SLOT, gridWatts: [1200]},
        {start: BASE + 3 * SLOT, end: BASE + 4 * SLOT}]);
    put(programProfileId('other', 'Auto'), {program: 'Auto', runs: [{start: BASE, end: BASE + SLOT, watts: [9000]}]});
    put('Devices.Programs.2', {identity: dish, run: {start: BASE + 8 * SLOT}});
    const cuts = () => historyCorrections(rows, states, 'ems.0', BASE + 11 * SLOT);
    assert.deepEqual(cuts(), new Map([[BASE, 1800], [BASE + SLOT, 200], [BASE + 3 * SLOT, null],
        [BASE + 4 * SLOT, null], [BASE + 8 * SLOT, null]]));
    rows[1].includedInSubmeters = false;
    assert.equal(cuts().get(BASE), null);
    assert.equal(cuts().get(BASE + SLOT), 200);
    rows[1].mode = 'off';
    assert.equal(cuts().get(BASE), 600);
    assert.equal(cuts().has(BASE + 3 * SLOT), false);
});
