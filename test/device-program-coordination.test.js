'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {createHash} = require('node:crypto');
const {planProgram, startDevicePrograms} = require('../lib/device-programs');

const SLOT = 900000;
const BASE = new Date(2026, 10, 17, 12, 0).getTime();

function simulation(t, devices) {
    const own = new Map(), foreign = new Map(), writes = [], warnings = [];
    const rows = devices.map((options, i) => ({
        name: 'Gerät ' + (i + 1), mode: 'observe', statusObject: 'status.' + i, readyValue: 'Ready',
        runningValue: 'Running', finishedValue: 'Finished', remoteObject: 'remote.' + i, remoteValue: 'true',
        startObject: 'start.' + i, startValue: 'true', profileJson: '[1000]', ...options
    }));
    let now = BASE, timer, complete;
    t.mock.method(Date, 'now', () => now);
    function state(id, val, lc = now) { foreign.set(id, {val, ts: lc, lc, ack: true}); }
    for (const row of rows) {
        state(row.remoteObject, true, BASE - 60000);
        state(row.statusObject, 'Ready', BASE - 60000);
    }
    function forecast(grid, prices = grid.map(() => 40)) {
        own.set('Plan.Valid', true);
        own.set('Plan.LastUpdate', now);
        own.set('Plan.GridPower_48h_JSON', JSON.stringify(grid.map((valueW, i) => ({timestamp: BASE + i * SLOT, valueW}))));
        own.set('Forecast.TotalPrice_48h_JSON', JSON.stringify(prices.map((value_ct_kWh, i) => ({
            timestamp: BASE + i * SLOT, value_ct_kWh, valid: true
        }))));
    }
    const result = {own, rows, writes, state, forecast, afterPublish: null,
        status: i => JSON.parse(own.get('Devices.Programs.' + (i + 1))),
        at(value) { now = value; },
        restart() { timer = null; },
        profile(i, program, watts) {
            const key = createHash('sha256').update(JSON.stringify([result.status(i).identity, program])).digest('hex').slice(0, 32);
            own.set('Devices.ProgramProfiles.' + key, JSON.stringify({sampleCount: 2, watts}));
        },
        async tick() {
            const done = new Promise(resolve => { complete = resolve; });
            if (timer) timer();
            else startDevicePrograms(adapter);
            await done;
            assert.deepEqual(warnings, []);
        }
    };
    const adapter = {config: {devicePrograms: rows, globalWriteEnabled: true, controlEnabled: true},
        log: {warn: message => warnings.push(message)},
        setTimeout(callback, delay) { assert.equal(delay, 15000); timer = callback; complete(); },
        async getStateAsync(id) { return {val: own.get(id)}; },
        async getStatesAsync() {
            return Object.fromEntries([...own].map(([id, val]) => [id, {val, ts: now}]));
        },
        async getForeignStateAsync(id) { return foreign.get(id); },
        async getForeignObjectAsync() { return {common: {type: 'boolean', write: true}}; },
        async setObjectNotExistsAsync() {},
        async setStateAsync(id, val) { own.set(id, val); result.afterPublish?.(id, JSON.parse(val)); },
        async setForeignStateAsync(id, value, ack) { writes.push({id, value, ack}); }
    };
    result.config = adapter.config;
    return result;
}

test('all released list entries share their profiles in release order with a stable tie breaker', async t => {
    const h = simulation(t, [{}, {}, {}, {}]);
    h.state('remote.2', true, BASE - 120000);
    h.forecast([-1000, -1000, -1000, -1000, -1000]);
    await h.tick();
    assert.deepEqual(h.rows.map((_, i) => h.status(i).plan.plannedStartAt),
        [BASE + SLOT, BASE + 2 * SLOT, BASE, BASE + 3 * SLOT]);
    assert.deepEqual(h.writes, []);
    h.state('remote.0', false);
    await h.tick();
    assert.equal(h.status(0).plan, null);
    assert.equal(h.status(1).plan.plannedStartAt, BASE + SLOT);
    assert.equal(h.status(3).plan.plannedStartAt, BASE + 2 * SLOT);
});

test('enough surplus permits parallel starts and a low-power program stage permits a partial overlap', async t => {
    const h = simulation(t, [{profileJson: '[1500,100]'}, {profileJson: '[1500]'}, {profileJson: '[500]'}]);
    h.forecast([-2000, -1600, 0]);
    await h.tick();
    assert.deepEqual(h.rows.map((_, i) => h.status(i).plan.plannedStartAt), [BASE, BASE + SLOT, BASE]);
    assert.equal(h.status(1).plan.estimatedGridCost_EUR, 0);
    assert.equal(h.status(2).plan.estimatedGridCost_EUR, 0);
});

test('profile boundaries inside a grid quarter use their actual duration and combined watts', () => {
    const grid = [{timestamp: BASE, valueW: -1000}, {timestamp: BASE + SLOT, valueW: -1000}];
    const prices = grid.map(({timestamp}) => ({timestamp, value_ct_kWh: 40, valid: true}));
    const reservations = [{start: BASE - SLOT / 2, watts: [750]}, {start: BASE, watts: [250]}];
    const plan = planProgram([1000], grid, prices, BASE, BASE + SLOT, reservations);
    assert.equal(plan.estimatedGridCost_EUR, 0.0625);
    assert.equal(plan.plannedStartAt, BASE);
    const offGrid = planProgram([1000], grid, prices, BASE, BASE + 2 * SLOT, [reservations[0]]);
    assert.equal(offGrid.plannedStartAt, BASE + SLOT / 2);
});

test('new grid forecasts rebuild all waiting reservations; updated announcements retain the release ID', async t => {
    const h = simulation(t, [{mode: 'automatic'}, {mode: 'automatic'}, {mode: 'automatic'}]);
    h.forecast([0, -1000, -1000, -1000, 0]);
    await h.tick();
    const announced = () => JSON.parse(h.own.get('Devices.Programs.1.Announcement'));
    const first = announced();
    assert.deepEqual(h.rows.map((_, i) => h.status(i).plan.plannedStartAt), [1, 2, 3].map(n => BASE + n * SLOT));
    h.at(BASE + 15000);
    h.forecast([0, 0, 0, -2000, -1000]);
    await h.tick();
    assert.deepEqual(h.rows.map((_, i) => h.status(i).plan.plannedStartAt), [3, 3, 4].map(n => BASE + n * SLOT));
    assert.equal(h.status(2).plan.forecastUpdatedAt, BASE + 15000);
    assert.equal(announced().id, first.id);
    assert.notEqual(announced().text, first.text);
    assert.deepEqual(h.writes, []);
});

test('an actual run anywhere in the list counts before automatic starts; previews consume the remaining budget', async t => {
    const h = simulation(t, [{mode: 'observe'}, {mode: 'automatic'}, {mode: 'observe'}]);
    h.state('status.2', 'Running', BASE - SLOT / 2);
    h.state('remote.2', false);
    h.forecast([-1000, -1000, -1000, -1000]);
    await h.tick();
    assert.equal(h.status(1).plan.plannedStartAt, BASE + SLOT / 2);
    assert.equal(h.status(0).plan.plannedStartAt, BASE + SLOT * 1.5);
    assert.deepEqual(h.writes, []);
});

test('a sent start survives restart, follows actual start time, frees capacity on finish, and is never repeated', async t => {
    const h = simulation(t, [{mode: 'automatic'}, {mode: 'automatic'}]);
    h.forecast([-1000, -1000, -1000, -1000]);
    await h.tick();
    assert.equal(h.status(0).reservation.kind, 'sent');
    assert.deepEqual(h.writes, [{id: 'start.0', value: true, ack: false}]);
    h.restart();
    h.at(BASE + 30000);
    await h.tick();
    assert.equal(h.status(1).plan.plannedStartAt, BASE + SLOT);
    h.state('status.0', 'Running');
    h.state('remote.0', false);
    await h.tick();
    assert.equal(h.status(0).reservation.start, BASE + 30000);
    assert.equal(h.status(1).plan.plannedStartAt, BASE + SLOT + 30000);
    h.at(BASE + 60000);
    h.state('status.0', 'Finished');
    await h.tick();
    assert.equal(h.status(0).reservation, null);
    assert.deepEqual(h.writes.map(w => w.id), ['start.0', 'start.1']);
});

test('adding or reordering rows on restart preserves the issued physical start and its reserved load', async t => {
    const h = simulation(t, [{mode: 'automatic'}, {mode: 'automatic'}, {}]);
    h.forecast([-1000, -1000, -1000, -1000]);
    await h.tick();
    h.restart();
    h.rows.reverse();
    h.rows.push({...h.rows[0], name: 'Neu', statusObject: 'status.3', remoteObject: 'remote.3', startObject: 'start.3'});
    h.state('remote.3', true);
    h.state('status.3', 'Ready');
    h.at(BASE + 15000);
    await h.tick();
    assert.equal(h.status(2).reservation.kind, 'sent');
    assert.equal(h.status(1).plan.plannedStartAt, BASE + SLOT);
    assert.equal(h.status(3).plan.plannedStartAt, BASE + 3 * SLOT);
    assert.deepEqual(h.writes.map(w => w.id), ['start.0']);
});

test('an issued alpha.297 plan still awaiting feedback reserves load after an upgrade', async t => {
    const h = simulation(t, [{mode: 'automatic'}, {mode: 'automatic'}]);
    h.forecast([-1000, -1000, -1000]);
    await h.tick();
    const old = h.status(0);
    for (const key of ['reservation', 'release', 'finishByAt']) delete old[key];
    h.own.set('Devices.Programs.1', JSON.stringify(old));
    h.at(BASE + 15000);
    h.restart();
    await h.tick();
    assert.equal(h.status(0).reservation.kind, 'sent');
    assert.equal(h.status(1).plan.plannedStartAt, BASE + SLOT);
    assert.deepEqual(h.writes.map(w => w.id), ['start.0']);
});

test('running program uses its active learned profile; missing and overrun profiles defer other starts', async t => {
    const h = simulation(t, [{mode: 'automatic'}, {programObject: 'selected', activeProgramObject: 'active'}]);
    h.state('remote.0', false);
    h.state('selected', 'next');
    h.state('active', 'eco');
    h.state('status.1', 'Running');
    h.forecast([-1000, -1000, -1000, -1000]);
    await h.tick();
    h.state('remote.0', true);
    await h.tick();
    assert.equal(h.status(0).plan, null);
    assert.deepEqual(h.status(0).waitingForRunningProfile, ['Gerät 2']);
    h.profile(1, 'next', [200]);
    h.profile(1, 'eco', [1000]);
    await h.tick();
    assert.equal(h.status(0).plan.plannedStartAt, BASE + SLOT);
    assert.deepEqual(h.status(1).reservation.watts, [1000]);
    h.at(BASE + SLOT + 1000);
    h.forecast([-1000, -1000, -1000]);
    await h.tick();
    assert.equal(h.status(0).plan, null);
    assert.deepEqual(h.writes, []);
});

for (const change of ['grid', 'price', 'generation', 'valid', 'peer', 'permission']) {
    test('a change before dispatch preserves the release for replanning: ' + change, async t => {
        const h = simulation(t, [{mode: 'automatic'}, {}]);
        h.state('remote.1', false);
        h.forecast(change === 'peer' ? [-1000, -1000, 0] : [-1000, 0, 0]);
        h.afterPublish = (id, value) => {
            if (id !== 'Devices.Programs.1' || value?.reservation?.kind !== 'sent') return;
            h.afterPublish = null;
            if (change === 'grid') h.forecast([0, -1000, 0]);
            if (change === 'price') h.forecast([-1000, 0, 0], [40, -5, 40]);
            if (change === 'generation') h.own.set('Plan.LastUpdate', BASE - 1);
            if (change === 'valid') h.own.set('Plan.Valid', false);
            if (change === 'peer') h.state('status.1', 'Running');
            if (change === 'permission') h.config.globalWriteEnabled = false;
        };
        await h.tick();
        assert.deepEqual(h.writes, []);
        assert.equal(h.status(0).attemptedRelease, null);
        assert.equal(h.status(0).reservation, null);
        assert.equal(h.status(0).plan, null);
        if (change === 'grid' || change === 'price' || change === 'peer') {
            await h.tick();
            assert.equal(h.status(0).plan.plannedStartAt, BASE + SLOT);
            assert.deepEqual(h.writes, []);
        }
        h.at(BASE + SLOT);
        h.config.globalWriteEnabled = true;
        h.state('status.1', 'Finished');
        h.forecast([0, -1000, 0]);
        await h.tick();
        await h.tick();
        assert.deepEqual(h.writes.map(w => w.id), ['start.0']);
    });
}

test('stale forecasts and elapsed finish-by times cannot dispatch on a continuing release', async t => {
    const h = simulation(t, [{mode: 'automatic', finishBy: '12:30'}]);
    h.forecast([0, -1000, -1000, -1000]);
    await h.tick();
    assert.equal(h.status(0).plan.plannedStartAt, BASE + SLOT);
    h.at(BASE + 21 * 60000);
    await h.tick();
    assert.equal(h.status(0).plan, null);
    h.state('status.0', 'Unavailable');
    await h.tick();
    h.at(BASE + 2 * SLOT);
    h.state('status.0', 'Ready');
    h.forecast([0, 0, -1000, -1000]);
    await h.tick();
    assert.equal(h.status(0).finishByAt, BASE + 2 * SLOT);
    assert.equal(h.status(0).plan, null);
    assert.deepEqual(h.writes, []);
    h.state('remote.0', false);
    await h.tick();
    h.at(BASE + 2 * SLOT + 1000);
    h.state('remote.0', true);
    await h.tick();
    assert.equal(h.status(0).finishByAt, BASE + 2 * SLOT + 86400000);
    assert.deepEqual(h.writes.map(w => w.id), ['start.0']);
});
