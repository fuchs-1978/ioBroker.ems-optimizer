'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {createHash} = require('node:crypto');
const vm = require('node:vm');
const {planProgram, startDevicePrograms} = require('../lib/device-programs');
const {createEngineContext} = require('../lib/engine-loader');

const SLOT = 900000;
const BASE = new Date(2026, 10, 17, 12, 0).getTime();

function simulation(t, devices) {
    const own = new Map(), published = new Map(), foreign = new Map(), writes = [], warnings = [];
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
    const result = {own, rows, writes, warnings, state, forecast, afterPublish: null, history: [], historyReads: [],
        status: i => JSON.parse(own.get('Devices.Programs.' + (i + 1))),
        at(value) { now = value; },
        restart() { timer = null; },
        profileId(i, program) {
            const key = createHash('sha256').update(JSON.stringify([result.status(i).identity, program])).digest('hex').slice(0, 32);
            return 'Devices.ProgramProfiles.' + key;
        },
        profile(i, program, watts, sampleCount = 2) {
            own.set(result.profileId(i, program), JSON.stringify({program, sampleCount, watts}));
        },
        async tick() {
            const done = new Promise(resolve => { complete = resolve; });
            if (timer) timer();
            else startDevicePrograms(adapter, (runs, at) => {
                result.forecastRuns = runs;
                result.onForecast?.(runs, at);
            });
            await done;
            if (!result.allowWarnings) assert.deepEqual(warnings, []);
        }
    };
    const namespace = 'ems-optimizer.0';
    const adapter = {namespace, config: {devicePrograms: rows, globalWriteEnabled: true, controlEnabled: true},
        log: {warn: message => warnings.push(message)},
        setTimeout(callback, delay) { assert.equal(delay, 15000); timer = callback; complete(); },
        async getStateAsync(id) { return {val: own.get(id), ts: published.get(id)}; },
        async getStatesAsync(pattern) {
            return Object.fromEntries([...own].filter(([id]) => id.startsWith(pattern.slice(0, -1)))
                .map(([id, val]) => [namespace + '.' + id, {val, ts: now}]));
        },
        async runEngine(expression) { result.historyReads.push(expression); return result.history; },
        async getForeignStateAsync(id) { return foreign.get(id); },
        async getForeignObjectAsync(id) {
            const row = rows.find(device => device.startObject === id);
            return {common: {type: row?.startFromSelection ? 'string' : 'boolean', write: true}};
        },
        async setObjectNotExistsAsync() {},
        async setStateAsync(id, val) { own.set(id, val); published.set(id, now); result.afterPublish?.(id, JSON.parse(val)); },
        async setForeignStateAsync(id, value, ack) {
            writes.push({id, value, ack});
            if (result.writeError) throw new Error(result.writeError);
        }
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

test('a sixth program starts with its appliance average, then uses its own measured run', async t => {
    const h = simulation(t, [
        {name: 'Gerät', mode: 'automatic', programObject: 'selected', activeProgramObject: 'active',
            startFromSelection: true, powerObject: 'plug.power', powerUnit: 'mW'},
        {name: 'Gerät', programObject: 'other.selected'}
    ]);
    h.forecast([-1300, -1300, -1300, -1300]);
    await h.tick();
    h.profile(0, 'Eco', [2000, 200], 9);
    h.profile(0, 'Kurz', [1000, 300], 1);
    h.profile(0, 'Auto', [500]);
    h.profile(0, 'Glas', [1500, 500]);
    h.profile(0, 'Leise', [1000]);
    h.profile(1, 'Intensiv', [5500, 5500, 5500]);
    h.profile(1, 'Normal', [1100]);
    const originalProfiles = [...h.own].filter(([id]) => id.startsWith('Devices.ProgramProfiles.'));
    const newProfile = h.profileId(0, 'Intensiv');
    h.state('selected', 'Intensiv');
    h.state('other.selected', 'Normal');
    await h.tick();
    assert.deepEqual(h.writes, [{id: 'start.0', value: 'Intensiv', ack: false}]);
    assert.equal(h.status(0).profileSource, 'deviceAverage');
    assert.equal(h.status(0).profileSamples, 0);
    assert.equal(h.status(0).fallbackProgramCount, 5);
    assert.deepEqual(h.status(0).reservation.watts, [1200, 200]);
    assert.equal(h.status(1).plan.plannedStartAt, BASE + SLOT);
    assert.equal(h.own.has(newProfile), false);

    const start = BASE + 15000, end = start + SLOT;
    h.at(start);
    h.state('status.0', 'Running');
    h.state('remote.0', false);
    h.state('active', 'Intensiv');
    h.state('selected', 'Kurz');
    h.restart();
    await h.tick();
    assert.deepEqual(h.status(0).run, {program: 'Intensiv', start});
    assert.deepEqual(h.status(0).reservation, {kind: 'running', program: 'Intensiv', start, watts: [1200, 200]});
    assert.equal(h.writes.length, 1);
    h.history = Array.from({length: 15}, (_, i) => ({ts: start + i * 60000, val: 1800000}));
    h.at(end + 30000);
    h.state('status.0', 'Finished', end);
    await h.tick();
    await h.tick();
    assert.deepEqual(h.historyReads, [`getHistory("plug.power", ${start}, ${end}, true)`]);
    const measured = JSON.parse(h.own.get(newProfile));
    assert.equal(measured.program, 'Intensiv');
    assert.equal(measured.sampleCount, 1);
    assert.deepEqual(measured.runs, [{watts: [1800], durationMs: SLOT, energyKWh: 0.45, start, end}]);
    for (const [id, value] of originalProfiles) assert.equal(h.own.get(id), value);

    h.at(BASE + 2 * SLOT);
    h.state('status.0', 'Ready');
    h.state('remote.0', true);
    h.state('selected', 'Schnell');
    h.config.globalWriteEnabled = false;
    h.forecast([-3000, -3000, -3000, -3000]);
    await h.tick();
    assert.equal(h.status(0).fallbackProgramCount, 6);
    assert.equal(h.writes.length, 1);
    h.state('selected', 'Intensiv');
    h.config.globalWriteEnabled = true;
    await h.tick();
    assert.equal(h.status(0).profileSource, 'program');
    assert.equal(h.status(0).profileSamples, 1);
    assert.deepEqual(h.status(0).reservation.watts, [1800]);
    assert.deepEqual(h.writes.map(write => write.value), ['Intensiv', 'Intensiv']);
});

test('one valid profile suffices and incomplete measurements leave the program eligible for an estimate', async t => {
    const h = simulation(t, [{mode: 'automatic', programObject: 'selected', powerObject: 'meter'}]);
    h.forecast([-2000, -2000, -2000]);
    await h.tick();
    h.profile(0, 'Defekt', [-100]);
    h.profile(0, 'Leer', [0]);
    h.profile(0, 'Ohne Messung', [2000], 0);
    h.profile(0, 'Eco', [900]);
    await h.tick();
    assert.deepEqual(h.writes, []); // A boolean start command still requires a reported selection.
    h.state('selected', 'Neu');
    await h.tick();
    assert.equal(h.status(0).fallbackProgramCount, 1);
    assert.deepEqual(h.status(0).reservation.watts, [900]);
    h.state('status.0', 'Running');
    h.state('selected', '');
    await h.tick();
    assert.deepEqual(h.status(0).run, {program: 'Neu', start: BASE});
    h.at(BASE + SLOT + 30000);
    h.state('status.0', 'Finished', BASE + SLOT);
    await h.tick();
    assert.equal(h.status(0).learning, 'incomplete power history');
    assert.equal(h.own.has(h.profileId(0, 'Neu')), false);
    h.state('selected', 'Neu');
    h.state('remote.0', true);
    h.state('status.0', 'Ready');
    await h.tick();
    assert.equal(h.status(0).profileSource, 'deviceAverage');
    assert.equal(h.status(0).profileSamples, 0);
    assert.equal(h.writes.length, 2);
});

test('a different appliance cannot supply the only estimate, and a changed selection cancels a pending start', async t => {
    const h = simulation(t, [
        {mode: 'automatic', name: 'Gerät', programObject: 'selected', startFromSelection: true},
        {name: 'Gerät', programObject: 'other.selected'}
    ]);
    h.forecast([-2000, -2000, -2000]);
    await h.tick();
    h.profile(1, 'Eco', [1100]);
    h.state('selected', 'Neu');
    await h.tick();
    assert.equal(h.status(0).plan, null);
    assert.deepEqual(h.writes, []);

    h.profile(0, 'Eco', [900]);
    h.restart();
    h.afterPublish = (id, value) => {
        if (id === 'Devices.Programs.1' && value?.reservation?.kind === 'sent') h.state('selected', 'Anderes');
    };
    await h.tick();
    assert.equal(h.status(0).reservation, null);
    assert.deepEqual(h.writes, []);
    h.afterPublish = null;
    await h.tick();
    assert.deepEqual(h.writes, [{id: 'start.0', value: 'Anderes', ack: false}]);
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

test('relative start deadline anchors to release across replanning, unavailable state and restart', async t => {
    const h = simulation(t, [{mode: 'automatic', finishBy: '+4', profileJson: '[1000,1000,1000,1000]'}]);
    h.forecast(Array(24).fill(0), Array.from({length: 24}, (_, i) => i < 16 ? 40 : 5));
    await h.tick();
    const limit = BASE - 60000 + 4 * 3600000;
    assert.equal(h.status(0).startByAt, limit);
    assert.equal(h.status(0).plan.plannedStartAt, limit - 15000);
    assert.ok(h.status(0).plan.expectedEndAt > limit);
    h.at(BASE + 3600000);
    h.forecast(Array(32).fill(0));
    h.state('status.0', 'Unavailable');
    await h.tick();
    h.state('status.0', 'Ready');
    h.restart();
    h.at(BASE + 2 * 3600000);
    h.forecast(Array(32).fill(0), Array.from({length: 32}, (_, i) => i < 18 ? 40 : 5));
    await h.tick();
    assert.equal(h.status(0).startByAt, limit);
    assert.ok(h.status(0).plan.plannedStartAt <= limit);
    assert.deepEqual(h.writes, []);
    h.at(limit + 15000);
    h.forecast(Array(40).fill(0));
    await h.tick();
    assert.equal(h.status(0).plan, null);
    assert.equal(h.status(0).schedulingStatus, 'start window expired');
    assert.deepEqual(h.writes, []);
    h.state('remote.0', false);
    await h.tick();
    h.state('remote.0', true);
    await h.tick();
    assert.equal(h.status(0).startByAt, limit + 15000 + 4 * 3600000);
    assert.equal(h.writes.length, 1);
});

test('dispatch rechecks relative deadline after persisting the intent', async t => {
    const h = simulation(t, [{mode: 'automatic', finishBy: '+4'}]);
    h.forecast([-1000, -1000]);
    h.afterPublish = (id, value) => {
        if (id === 'Devices.Programs.1' && value?.reservation?.kind === 'sent') h.at(BASE + 4 * 3600000);
    };
    await h.tick();
    assert.deepEqual(h.writes, []);
    assert.equal(h.status(0).reservation, null);
});

test('appliance JSON integrates overlapping partial quarters, previews and running manual loads', async t => {
    const h = simulation(t, [{mode: 'automatic'}, {mode: 'observe'}]);
    h.forecast([-1000, -1000, -1000]);
    h.state('status.1', 'Running', BASE - SLOT / 2);
    await h.tick();
    const data = JSON.parse(h.own.get('Plan.Appliances_48h_JSON'));
    assert.equal(data.valid, true);
    assert.equal(data.series.length, 192);
    assert.deepEqual(data.series.slice(0, 2).map(slot => slot.valueW), [1000, 500]);
    assert.equal(data.devices.find(d => d.id === 'Devices.Programs.2').status, 'running');
    assert.ok(data.devices.every(d => d.scheduled));
    assert.equal(data.series.reduce((sum, slot) => sum + slot.energy_kWh, 0), 0.375);
    h.state('status.1', 'Ready');
    h.config.globalWriteEnabled = false;
    await h.tick();
    const preview = JSON.parse(h.own.get('Plan.Appliances_48h_JSON'));
    assert.ok(preview.devices.every(d => !d.scheduled));
    assert.ok(preview.series.every(slot => slot.valueW === 0));
    h.at(BASE + 21 * 60000);
    await h.tick();
    const stale = JSON.parse(h.own.get('Plan.Appliances_48h_JSON'));
    assert.equal(stale.valid, false);
    assert.deepEqual(stale.devices, []);
});

for (const setting of ['+0', '+-4', '+49', '+four', '25:00']) {
    test('invalid start window never dispatches: ' + setting, async t => {
        const h = simulation(t, [{mode: 'automatic', finishBy: setting}]);
        h.forecast([-1000, -1000]);
        await h.tick();
        assert.equal(h.status(0).plan, null);
        assert.deepEqual(h.writes, []);
    });
}

test('a manual early start replaces the future dryer plan and runs alongside a dishwasher with remote start off', async t => {
    const h = simulation(t, [{mode: 'automatic', programObject: 'dryerProgram'},
        {mode: 'observe', programObject: 'selectedDish', activeProgramObject: 'activeDish'}]);
    h.state('dryerProgram', 'Cottons');
    h.state('selectedDish', 'Auto2');
    h.state('remote.1', false);
    h.forecast([0, -2000, -2000, 0]);
    await h.tick();
    h.profile(0, 'Cottons', [500, 300]);
    h.profile(1, 'Auto2', [1800, 80]);
    await h.tick();
    assert.deepEqual(h.forecastRuns, [{start: BASE + SLOT, watts: [500, 300]}]);
    // The last ready poll precedes a local start that clears the selected-program field.
    h.at(BASE + 15000);
    h.state('status.0', 'Running');
    h.state('dryerProgram', '');
    h.state('status.1', 'Running');
    h.state('activeDish', 'Auto2');
    h.state('selectedDish', 'nextSelection');
    await h.tick();
    const start = BASE + 15000;
    assert.equal(h.status(0).plan, null);
    assert.equal(h.status(0).reservation.program, 'Cottons');
    assert.equal(h.status(1).reservation.program, 'Auto2');
    assert.deepEqual(h.forecastRuns, [{start, watts: [500, 300]}, {start, watts: [1800, 80]}]);
    assert.equal(JSON.parse(h.own.get('Devices.Programs.1.Announcement')), null);
    h.restart();
    h.config.globalWriteEnabled = false;
    h.at(BASE + 30000);
    await h.tick();
    assert.deepEqual(h.forecastRuns.map(run => run.start), [start, start]);
    h.state('status.1', 'Aborted');
    await h.tick();
    assert.deepEqual(h.forecastRuns, [{start, watts: [500, 300]}]);
    h.at(BASE + 45000);
    h.state('status.0', 'Finished');
    await h.tick();
    assert.deepEqual(h.forecastRuns, []);
    h.config.globalWriteEnabled = true;
    h.state('dryerProgram', 'Cottons');
    h.state('status.0', 'Ready');
    await h.tick();
    assert.equal(h.status(0).plan, null, 'the same remote release was satisfied by the manual start');
    assert.deepEqual(h.writes, []);
});

test('the next appliance replaces the exact embedded grid allowance when pricing its candidates', () => {
    const grid = [0, -1000, 0].map((valueW, i) => ({timestamp: BASE + i * SLOT, valueW}));
    const prices = grid.map(({timestamp}) => ({timestamp, value_ct_kWh: 40, valid: true}));
    const run = {start: BASE + SLOT, watts: [600]};
    const reference = planProgram([400], grid, prices, BASE, BASE + 3 * SLOT, [run]);
    assert.equal(reference.plannedStartAt, BASE + SLOT);
    assert.equal(reference.estimatedGridCost_EUR, 0);
    const withRun = grid.map((point, i) => i === 1 ? {...point, valueW: -400, applianceW: 600} : point);
    assert.deepEqual(planProgram([400], withRun, prices, BASE, BASE + 3 * SLOT, [run]), reference);
    assert.deepEqual(planProgram([400], withRun, prices, BASE, BASE + 3 * SLOT, []),
        planProgram([400], grid, prices, BASE, BASE + 3 * SLOT, []), 'feedback after cancellation');
});

test('a local run supplies load with a missing grid plan; observation previews and exhausted profiles do not reserve watts', async t => {
    const h = simulation(t, [{mode: 'observe', programObject: 'selected'}, {mode: 'observe'}]);
    h.state('remote.0', false);
    h.state('selected', 'MixDry');
    h.forecast([-2000, -2000, -2000]);
    await h.tick();
    assert.deepEqual(h.forecastRuns, [], 'only an observation preview is ready');
    h.profile(0, 'Cottons', [300]);
    h.own.set('Plan.Valid', false);
    h.config.globalWriteEnabled = false;
    h.state('status.0', 'Running');
    await h.tick();
    assert.deepEqual(h.forecastRuns, [{start: BASE, watts: [300]}]);
    assert.equal(h.status(0).profileSource, 'deviceAverage');
    h.at(BASE + SLOT + 1);
    await h.tick();
    assert.deepEqual(h.forecastRuns, []);
    assert.equal(JSON.parse(h.own.get('Plan.Appliances_48h_JSON')).unresolvedDevices.length, 1);
    assert.deepEqual(h.writes, []);
});

test('a manual run triggers the live engine rebuild once, then its physical end restores the grid forecast', async t => {
    const h = simulation(t, [{profileJson: '[900,300]'}]);
    const start = BASE + 5 * 60000;
    h.at(BASE + 10 * 60000);
    h.state('remote.0', false);
    h.state('status.0', 'Running', start);
    const local = id => id.slice('ems.0.'.length);
    let rebuild;
    const context = createEngineContext('ems.0', {}, {
        Date: class extends Date { constructor(...args) { super(...(args.length ? args : [Date.now()])); } },
        nativeConfig: h.config, gridConstraints: require('../lib/grid-constraints'), existsState: id => h.own.has(local(id)),
        getState: id => h.own.has(local(id)) ? {val: h.own.get(local(id)), ts: Date.now(), ack: true} : null,
        setState: (id, val) => h.own.set(local(id), val),
        createState: (id, val) => { if (!h.own.has(local(id))) h.own.set(local(id), val); },
        setTimeout(fn, delay) { assert.equal(delay, 5000); rebuild = fn; return 1; }, log() {}
    });
    vm.runInContext('createStates(); historyReady = true;', context);
    h.onForecast = (runs, at) => context.updateApplianceRuns(runs, at);
    const grid = () => JSON.parse(h.own.get('Plan.GridPower_48h_JSON'));
    async function pollAndRebuild() {
        await h.tick();
        assert.equal(typeof rebuild, 'function');
        rebuild(); rebuild = null;
    }
    await pollAndRebuild();
    assert.equal(grid()[0].applianceW, 900);
    assert.equal(grid()[1].applianceW, 500);
    assert.equal(JSON.parse(h.own.get('Forecast.HouseLoad_48h_JSON'))[0].applianceW, 600);
    await h.tick();
    assert.equal(rebuild, null);
    h.state('status.0', 'Finished');
    await pollAndRebuild();
    assert.ok(grid().every(point => !point.applianceW));
    assert.deepEqual(h.writes, []);
});

test('individual ECharts JSON mirrors scheduled quarter-hour curves and clears cancelled plans', async t => {
    const h = simulation(t, [{mode: 'automatic'}, {mode: 'observe'}]);
    h.forecast([0, -1000, -1000]);
    await h.tick();
    const read = n => JSON.parse(h.own.get(`Chart.DeviceProgram${n}_48h_json_chart`));
    const payload = JSON.parse(h.own.get('Plan.Appliances_48h_JSON'));
    assert.deepEqual(read(1), payload.devices.find(d => d.id === 'Devices.Programs.1').series
        .map(slot => ({ts: slot.timestamp, val: slot.valueW})));
    assert.equal(read(1).length, 192);
    assert.deepEqual(read(2), []); // Observation preview is not a committed plan.
    h.state('remote.0', false);
    await h.tick();
    assert.equal(read(1).length, 192);
    assert.ok(read(1).every(slot => slot.val === 0));
    h.at(BASE + 21 * 60000);
    await h.tick();
    assert.deepEqual(read(1), []);
});

test('individual ECharts JSON includes manual running loads and omits unresolved loads', async t => {
    const h = simulation(t, [{mode: 'observe'}]);
    h.state('status.0', 'Running', BASE - SLOT / 2);
    h.forecast([0, 0, 0]);
    await h.tick();
    const read = () => JSON.parse(h.own.get('Chart.DeviceProgram1_48h_json_chart'));
    assert.equal(read()[0].val, 500);
    h.at(BASE + SLOT);
    h.forecast([0, 0, 0]);
    await h.tick();
    assert.deepEqual(read(), []);
});


test('three starts at 0/15/30 minutes, final failure at 35 minutes, persisted across restarts', async t => {
    const h = simulation(t, [{mode: 'automatic', profileJson: '[1000,1000,1000,1000]'}]);
    h.forecast(Array(12).fill(-1000));
    await h.tick();
    assert.equal(h.status(0).startAttempt.attempts, 1);
    for (const [minutes, attempts] of [[14.99, 1], [15, 2], [29.99, 2], [30, 3], [34.99, 3]]) {
        h.restart();
        h.at(BASE + minutes * 60000);
        await h.tick();
        assert.equal(h.writes.length, attempts);
        assert.equal(h.status(0).startAttempt.status, 'waiting');
        assert.equal(h.status(0).startAttempt.firstSentAt, BASE);
    }
    h.allowWarnings = true;
    h.at(BASE + 35 * 60000);
    await h.tick();
    assert.equal(h.writes.length, 3);
    assert.equal(h.status(0).startAttempt.status, 'failed');
    assert.equal(h.status(0).reservation, null);
    assert.equal(h.warnings.length, 1);
    const announcement = JSON.parse(h.own.get('Devices.Programs.1.Announcement'));
    assert.match(announcement.text, /drei Startversuchen/);
    h.restart();
    h.at(BASE + 60 * 60000);
    await h.tick();
    assert.equal(h.writes.length, 3);
    assert.equal(h.warnings.length, 1);
    assert.equal(JSON.parse(h.own.get('Devices.Programs.1.Announcement')).id, announcement.id);
});

for (const minutes of [1, 16, 31, 36]) {
    test(`actual running confirmation at minute ${minutes} prevents all further starts`, async t => {
        const h = simulation(t, [{mode: 'automatic'}]);
        h.forecast(Array(12).fill(-1000));
        await h.tick();
        h.at(BASE + minutes * 60000);
        h.state('status.0', 'Running');
        await h.tick();
        assert.equal(h.status(0).startAttempt.status, 'confirmed');
        h.at(BASE + 70 * 60000);
        await h.tick();
        assert.equal(h.writes.length, 1);
    });
}

for (const change of ['program', 'remote', 'mode', 'permission', 'command']) {
    test(`pending retry is cancelled when ${change} changes`, async t => {
        const h = simulation(t, [{mode: 'automatic', programObject: 'selected.0'}]);
        h.state('selected.0', 'Cotton');
        h.forecast(Array(12).fill(-1000));
        await h.tick();
        h.profile(0, 'Cotton', [1000]);
        await h.tick();
        if (change === 'program') h.state('selected.0', 'Eco');
        if (change === 'remote') h.state('remote.0', false);
        if (change === 'mode') h.rows[0].mode = 'observe';
        if (change === 'permission') h.config.globalWriteEnabled = false;
        if (change === 'command') h.rows[0].startValue = 'false';
        h.at(BASE + 15 * 60000);
        await h.tick();
        assert.equal(h.writes.length, 1);
        assert.equal(h.status(0).startAttempt.status, 'cancelled');
    });
}

test('retry uses the persisted selected program and keeps a short profile reserved', async t => {
    const h = simulation(t, [{mode: 'automatic', startFromSelection: true, programObject: 'selected.0'}]);
    h.state('selected.0', 'Cotton');
    h.forecast(Array(12).fill(-1000));
    await h.tick();
    h.profile(0, 'Cotton', [1000]);
    await h.tick();
    h.at(BASE + 15 * 60000);
    await h.tick();
    assert.deepEqual(h.writes.map(w => w.value), ['Cotton', 'Cotton']);
    assert.equal(h.status(0).reservation.start, BASE + 15 * 60000);
});

test('an elapsed start window fails clearly', async t => {
    const h = simulation(t, [{mode: 'automatic', finishBy: '+1'}]);
    h.forecast(Array(12).fill(-1000));
    await h.tick();
    h.allowWarnings = true;
    h.at(BASE + 61 * 60000);
    await h.tick();
    assert.equal(h.writes.length, 1);
    assert.equal(h.status(0).startAttempt.status, 'failed');
    assert.match(h.status(0).startAttempt.error, /Startfenster/);
});


test('missing or unknown operating feedback never triggers an unsafe retry', async t => {
    const h = simulation(t, [{mode: 'automatic'}]);
    h.forecast(Array(12).fill(-1000));
    await h.tick();
    h.state('status.0', 'Unknown');
    h.allowWarnings = true;
    h.at(BASE + 15 * 60000);
    await h.tick();
    assert.equal(h.writes.length, 1);
    assert.equal(h.status(0).startAttempt.status, 'failed');
});


test('a manual start during retry persistence prevents the duplicate command', async t => {
    const h = simulation(t, [{mode: 'automatic'}]);
    h.forecast(Array(12).fill(-1000));
    await h.tick();
    h.at(BASE + 15 * 60000);
    h.afterPublish = (id, status) => {
        if (id === 'Devices.Programs.1' && status.startAttempt?.attempts === 2) h.state('status.0', 'Running');
    };
    await h.tick();
    assert.equal(h.writes.length, 1);
    await h.tick();
    assert.equal(h.status(0).startAttempt.status, 'confirmed');
});


test('a transport exception retains the attempt and retries only after fifteen minutes', async t => {
    const h = simulation(t, [{mode: 'automatic'}]);
    h.forecast(Array(12).fill(-1000));
    h.writeError = 'device offline';
    await h.tick();
    assert.equal(h.status(0).startAttempt.writeError, 'device offline');
    h.restart();
    h.at(BASE + 14 * 60000);
    await h.tick();
    assert.equal(h.writes.length, 1);
    h.writeError = null;
    h.at(BASE + 15 * 60000);
    await h.tick();
    assert.equal(h.writes.length, 2);
    h.at(BASE + 16 * 60000);
    h.state('status.0', 'Running');
    await h.tick();
    h.at(BASE + 35 * 60000);
    await h.tick();
    assert.equal(h.status(0).startAttempt.status, 'confirmed');
    assert.equal(h.writes.length, 2);
});
