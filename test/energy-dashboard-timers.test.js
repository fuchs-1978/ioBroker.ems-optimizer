'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const page = fs.readFileSync(path.join(__dirname, '../examples/ems-energiefluss.html'), 'utf8');
function section(from, to) {
    const start = page.indexOf(from), end = page.indexOf(to, start + from.length);
    assert.ok(start >= 0 && end > start, from);
    return page.slice(start, end);
}
const dashboard = vm.runInNewContext([
    section('const isNumber =', 'function parseState('),
    section('function vehiclePath(', '\n'),
    section('function normalizedDeparture(', 'function wallboxDelayIds('),
    section('function wallboxDelayIds(', 'function fastIds('),
    section('function renderCountdown(', 'function renderCarStatus('),
    '({wallboxDelayIds, wallboxDelay, renderRunningCountdown, planGoalWrites, goalTripText})'
].join('\n'), {INSTANCE: 'ems-optimizer.0', SNAPSHOT_MAX_AGE: 30000});

test('vehicle timers use the correct controller channels for each wallbox', () => {
    for (const i of [0, 1, 2]) {
        const ids = dashboard.wallboxDelayIds(i);
        assert.equal(ids.start, `ems-optimizer.0.Vehicles.Wallbox${i}.StartDelayRemaining_s`);
        assert.equal(ids.minimum, `ems-optimizer.0.Vehicles.Wallbox${i}.MinimumRunTimeRemaining_s`);
        assert.equal(ids.stop, `ems-optimizer.0.Devices.Wallbox${i}.StopDelayRemaining_s`);
    }
});

test('the EQV stop countdown advances without new measurements and clears on cancellation or expiry', () => {
    const ts = Date.parse('2026-11-23T11:03:10Z');
    const sample = {val: 419, ts, ack: true, q: 0};
    const field = {}, row = {querySelector: () => field};
    const update = (reading, snapshotAt, now) => {
        const {until} = dashboard.wallboxDelay(true, reading, snapshotAt, now);
        dashboard.renderRunningCountdown(row, until, now);
    };
    update(sample, ts, ts);
    assert.equal(field.textContent, '06:59');
    update(sample, ts, ts + 1000);
    assert.equal(field.textContent, '06:58');
    update(sample, ts + 5000, ts + 5000);
    assert.equal(field.textContent, '06:54');
    update({...sample, val: 0, ts: ts + 6000}, ts + 5000, ts + 6000);
    assert.equal(row.hidden, true);
    assert.equal(field.textContent, '');
    update({...sample, val: 1}, ts, ts + 1000);
    assert.equal(row.hidden, true);
    for (const reading of [null, {...sample, ack: false}, {...sample, q: 64}, {...sample, ts: ts - 31000}]) {
        update(reading, ts, ts);
        assert.equal(row.hidden, true);
    }
    assert.equal(dashboard.wallboxDelay(false, sample, ts + 1, ts + 1).until, null);
});

test('one-off dashboard booking saves all settings in one write and can return to an empty or time-only departure', () => {
    const before = {min: 45, max: 90, time: '', date: '', tripSoc: null, editLimits: true};
    const after = {...before, date: '2096-11-30', time: '06:00', tripSoc: 100, allowGrid: true, plan: {zone: 'Europe/Berlin'}};
    const writes = (from, to) => Array.from(dashboard.planGoalWrites(from, to));
    assert.deepEqual(writes(before, after), ['trip']);
    assert.deepEqual(JSON.parse(dashboard.goalTripText(after)), {date: after.date, time: '06:00', soc: 100, allowGrid: true});
    assert.deepEqual(writes(after, after), []);
    assert.deepEqual(writes(after, before), ['time', 'trip']);
    assert.deepEqual(writes(before, {...before, time: '06:00'}), ['time']);
    assert.throws(() => writes(before, {...after, date: '2020-01-01'}), /Zukunft/);
    assert.throws(() => writes(before, {...after, date: '2096-02-30'}), /gültiges Abfahrtsdatum/);
    assert.throws(() => writes(before, {...after, time: ''}), /Uhrzeit/);
    assert.throws(() => writes(before, {...after, tripSoc: 44}), /Mindest-SoC/);
    assert.throws(() => writes(before, {...after, date: '2096-03-25', time: '02:30'}), /Zeitumstellung/);
});
