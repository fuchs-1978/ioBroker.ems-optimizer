'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const {WeatherForecastHistory, buildSnapshot, FIELDS, SQL_OPTIONS} = require('../lib/weather-forecast-history');
const HOUR = 3600000, now = Date.UTC(2026, 9, 30, 20, 10), base = 'meteo.0.site.weather.forecast.hourly.next_hours';
const currentBase = 'meteo.0.site.weather.current';
function fixture(config = {}) {
    let at = now;
    const states = {}, objects = new Map(), cache = new Map(), calls = [], writes = [], timers = new Map(); let timerId = 0;
    const units = {};
    for (const [field, spec] of Object.entries(FIELDS)) {
        const unit = field === 'sunshine_duration' ? 'h' : spec.units[0];
        units[field] = {forecast: field === 'shortwave_radiation' ? null : unit, current: unit};
        if (units[field].forecast) objects.set(`${base}.hour0.${field}`, {common: {unit}});
        objects.set(`${currentBase}.${field}`, {common: {unit}});
    }
    const values = {temperature_2m: 7, wind_speed_10m: 1.5, cloud_cover: 50, relative_humidity_2m: 80,
        precipitation: 0, sunshine_duration: 0.5, shortwave_radiation: 100};
    const state = val => ({val, ts: now - 60000, ack: true, q: 0});
    for (let i = 0; i < 48; i++) {
        states[`${base}.hour${i}.date`] = state(Math.floor(now / HOUR) * HOUR + i * HOUR);
        for (const field of Object.keys(FIELDS)) if (field !== 'shortwave_radiation') states[`${base}.hour${i}.${field}`] = state(values[field]);
    }
    for (const field of Object.keys(FIELDS)) states[`${currentBase}.${field}`] = state(values[field]);
    states[`${currentBase}.time`] = state('30.10.2026, 21:00');
    const adapter = {namespace: 'ems.0', config: {loadComparisonEnabled: true, weatherHourlyBaseId: base, historyInstance: 'sql.0', ...config},
        setTimeout(callback, delay) {const id = ++timerId; timers.set(id, {callback, delay}); return id;},
        clearTimeout(id) {timers.delete(id);},
        getCachedState: id => cache.get(id),
        getForeignObjectAsync: async id => {calls.push({readObject: id}); return structuredClone(objects.get(id));},
        getForeignStatesAsync: async pattern => {calls.push({readStates: pattern}); const prefix = pattern.slice(0, -1);
            return structuredClone(Object.fromEntries(Object.entries(states).filter(([id]) => id.startsWith(prefix))));},
        queueCompatState: async (id, val, common) => {objects.set(id, {type: 'state', common: {...common}});
            if (!cache.has(id)) cache.set(id, {val});},
        setCompatState: async (id, val) => {writes.push({id, val}); cache.set(id, {val});},
        compatSendTo(instance, command, message, callback) {calls.push({instance, command, message});
            objects.get(message.id).common.custom = {[instance]: {...message.options}}; callback({success: true});},
        warnDebug: () => {}};
    const archive = new WeatherForecastHistory(adapter, {now: () => at, timeoutMs: 10});
    return {adapter, archive, states, units, objects, calls, writes, timers, cache,
        setNow: value => {at = value;}, snapshot: () => JSON.parse(cache.get(archive.id)?.val || 'null')};
}
test('snapshot preserves source time, target hour, actual units and explicitly missing irradiation', () => {
    const h = fixture(), snapshot = buildSnapshot({base, currentBase, states: h.states, units: h.units, now});
    assert.equal(snapshot.hours.length, 48); assert.equal(snapshot.capturedAt, now);
    assert.equal(snapshot.hours[1].validAt - snapshot.hours[0].validAt, HOUR);
    assert.equal(snapshot.hours[0].values.temperature_2m.sourceTs, now - 60000);
    assert.equal(snapshot.units.sunshine_duration.forecast, 'h');
    assert.equal(snapshot.hours[0].values.sunshine_duration.value, 0.5);
    assert.equal(snapshot.hours[0].values.shortwave_radiation.value, null);
    assert.equal(snapshot.current.kind, 'provider-current-estimate-not-local-measurement');
    assert.equal(snapshot.current.reportedTime, '30.10.2026, 21:00');
});
test('unacknowledged, old, future, bad-quality, implausible or skewed cells remain unknown', () => {
    for (const changes of [{ack: false}, {q: 64}, {ts: now - 7 * HOUR}, {ts: now + 2000}, {val: null}, {val: -100}, {ts: now - 181000}]) {
        const h = fixture(); Object.assign(h.states[`${base}.hour0.temperature_2m`], changes);
        const snapshot = buildSnapshot({base, currentBase, states: h.states, units: h.units, now});
        assert.equal(snapshot.hours[0].values.temperature_2m.value, null);
        assert.ok(snapshot.hours[0].values.temperature_2m.reason);
    }
    const h = fixture(); h.units.wind_speed_10m.forecast = 'knots';
    assert.equal(buildSnapshot({base, currentBase, states: h.states, units: h.units, now}).hours[0].values.wind_speed_10m.value, null);
});
test('archive enables and verifies SQL only for its own immutable JSON sample', async () => {
    const h = fixture(); await h.archive.initialize();
    const enables = h.calls.filter(x => x.command === 'enableHistory');
    assert.equal(enables.length, 1); assert.equal(enables[0].message.id, 'ems.0.Debug.WeatherArchive.Snapshot_JSON');
    assert.deepEqual(enables[0].message.options, SQL_OPTIONS);
    assert.equal(h.snapshot().hours.length, 48);
    assert.ok(h.writes.every(x => x.id.startsWith('ems.0.Debug.WeatherArchive.')));
    assert.ok([...h.timers.values()].some(x => x.delay === 60000)); h.archive.stop(); assert.equal(h.timers.size, 0);
});
test('polls and restarts cannot republish the same old snapshot with a new capture time', async () => {
    const h = fixture(); await h.archive.initialize(); const first = h.cache.get(h.archive.id).val;
    h.setNow(now + 60000); await h.archive.tick();
    assert.equal(h.cache.get(h.archive.id).val, first);
    assert.equal(h.writes.filter(x => x.id === h.archive.id).length, 1);
    h.archive.stop();
    const restarted = new WeatherForecastHistory(h.adapter, {now: () => now + 120000, timeoutMs: 10});
    await restarted.initialize(); assert.equal(h.cache.get(restarted.id).val, first);
    assert.equal(h.writes.filter(x => x.id === restarted.id).length, 1); restarted.stop();
});
test('a new settled provider publication appends a new sample while the forecast horizon keeps its true target times', async () => {
    const h = fixture(); await h.archive.initialize(); const first = h.snapshot();
    for (const value of Object.values(h.states)) value.ts += 60000;
    h.setNow(now + 60000); await h.archive.tick();
    assert.notEqual(h.snapshot().fingerprint, first.fingerprint);
    assert.equal(h.snapshot().hours[0].validAt, first.hours[0].validAt);
    assert.equal(h.writes.filter(x => x.id === h.archive.id).length, 2); h.archive.stop();
});
test('mid-update publications wait for settlement and rolled-back source time is rejected', async () => {
    const h = fixture(); await h.archive.initialize();
    for (const value of Object.values(h.states)) value.ts = now + 20000;
    h.setNow(now + 20000); await h.archive.tick();
    assert.equal(h.writes.filter(x => x.id === h.archive.id).length, 1);
    assert.match(h.writes.at(-1).val, /Abschluss/);
    for (const value of Object.values(h.states)) value.ts = now - 90000;
    h.setNow(now + 60000); await h.archive.tick();
    assert.equal(h.writes.filter(x => x.id === h.archive.id).length, 1);
    assert.match(h.writes.at(-1).val, /Aelterer/); h.archive.stop();
});
test('disabled comparison/archive performs no history setup or source reads', async () => {
    for (const config of [{loadComparisonEnabled: false}, {weatherArchiveEnabled: false}]) {
        const h = fixture(config); await h.archive.initialize(); assert.equal(h.calls.length, 0);
        assert.equal(h.writes.length, 0); assert.equal(h.timers.size, 0);
    }
});
test('SQL failure or mismatched verified settings never claims collection or writes a snapshot', async () => {
    for (const mode of ['error', 'mismatch']) {
        const h = fixture(); h.adapter.compatSendTo = (instance, command, message, callback) => {
            if (mode === 'mismatch') h.objects.get(message.id).common.custom = {[instance]: {...message.options, changesRelogInterval: 60}};
            callback({success: mode !== 'error'});
        };
        await h.archive.initialize(); assert.equal(h.archive.configured, false);
        assert.equal(h.snapshot(), null); assert.equal(h.timers.size, 0);
    }
});
test('stopping an outstanding SQL request resolves it and never resumes archive writes', async () => {
    const h = fixture(); let entered;
    const started = new Promise(resolve => {entered = resolve;});
    h.adapter.compatSendTo = () => entered();
    const initializing = h.archive.initialize(); await started; h.archive.stop(); await initializing;
    assert.equal(h.archive.configured, false); assert.equal(h.snapshot(), null); assert.equal(h.timers.size, 0);
});
test('invalid delivery times and absent weather cannot create a fabricated valid horizon', async () => {
    const h = fixture();
    for (const [id, state] of Object.entries(h.states)) if (id.endsWith('.date')) state.val = now + 1000;
    await h.archive.initialize(); assert.equal(h.snapshot(), null);
    assert.match(h.writes.at(-1).val, /Warte auf frische/); h.archive.stop();
});


test('ambiguous duplicate delivery hours are discarded instead of choosing an arbitrary forecast', () => {
    const h = fixture(), first = h.states[`${base}.hour0.date`].val;
    h.states[`${base}.hour1.date`].val = first;
    const snapshot = buildSnapshot({base, currentBase, states: h.states, units: h.units, now});
    assert.equal(snapshot.hours.length, 46);
    assert.ok(snapshot.hours.every(row => row.validAt !== first));
});


test('unit metadata is refreshed and values published before a unit change stay unknown', async () => {
    const h = fixture(); await h.archive.initialize();
    h.objects.get(`${base}.hour0.wind_speed_10m`).common.unit = 'm/s';
    h.objects.get(`${base}.hour0.wind_speed_10m`).ts = now;
    h.setNow(now + 60000); await h.archive.tick();
    assert.equal(h.snapshot().units.wind_speed_10m.forecast, 'm/s');
    assert.equal(h.snapshot().hours[0].values.wind_speed_10m.value, null);
    assert.equal(h.snapshot().hours[0].values.wind_speed_10m.reason, 'unit-metadata-newer-than-value');
    h.archive.stop();
});
