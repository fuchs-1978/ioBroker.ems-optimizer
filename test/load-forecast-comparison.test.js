'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const vm = require('node:vm'), fs = require('node:fs');
const comparison = require('../lib/load-forecast-comparison');
process.env.TZ = 'Europe/Berlin';
const SLOT = comparison.SLOT, DAY = 86400000;
const types = ['SUNDAY', 'MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY', 'FRIDAY', 'SATURDAY'];
const dayType = date => types[date.getDay()];
const start = new Date(2026, 0, 5).getTime(), now = start + 70 * DAY + 12 * 3600000;
function fixture() {
    const rows = [], temperatures = [];
    for (let ts = start; ts < now - 12 * 3600000; ts += SLOT) {
        const day = Math.floor((ts - start) / DAY), slot = (ts - start) / SLOT % 96;
        const temperature = 10 + 6 * Math.sin(day / 5) + 2 * Math.cos(slot / 96 * Math.PI * 2);
        temperatures.push({ts, val: temperature});
        rows.push({ts, val: 1000 + 40 * Math.max(0, 18 - temperature) + 250 * Math.sin(slot / 96 * 2 * Math.PI)
            + (dayType(new Date(ts)) === 'SUNDAY' ? 500 : 0)});
    }
    return {rows, temperatures};
}
let cached;
async function trained() {return cached ||= comparison.train(fixture().rows, now, dayType, fixture().temperatures);}
test('L1 solver matches soft threshold on a standardized orthogonal design and yields to control', async () => {
    const rows = [-1, 1, -1, 1].map(x => ({x: [x, ...Array(comparison.FEATURES.length - 1).fill(0)], y: 1000 + 100 * x}));
    let yielded = false;
    const fitting = comparison.fit(rows, 25); setImmediate(() => {yielded = true;});
    const model = await fitting;
    assert.equal(yielded, true); assert.equal(model.converged, true);
    assert.ok(Math.abs(model.weights[0] - 75) < 1e-8);
    assert.ok(model.weights.slice(1).every(x => x === 0));
    assert.equal(comparison.predict(model, rows[0].x), 925);
});
test('training uses calendar lags, measured temperature, chronological validation and bounded samples', async () => {
    const model = await trained();
    assert.equal(model.ready, true, model.reason);
    assert.equal(model.diagnostics.weatherFeatures, true);
    assert.ok(model.diagnostics.validationSamples >= 5 * 96);
    assert.ok(model.diagnostics.trainingThrough <= now);
    assert.ok(Math.abs(model.diagnostics.coefficients.outside_temperature_C)
        + Math.abs(model.diagnostics.coefficients.heating_degree_C) > 1);
    const issue = comparison.issue(model, now, () => 8);
    assert.equal(issue.slots.length, 96);
    assert.ok(issue.issuedAt < issue.start);
    assert.ok(issue.slots.every(row => Number.isFinite(row.lassoW) && Number.isFinite(row.medianW)));
    const cold = comparison.issue(model, now, () => -5), warm = comparison.issue(model, now, () => 15);
    assert.ok(cold.slots[0].lassoW > warm.slots[0].lassoW + 100);
    assert.ok(comparison.issue(model, now, () => 100).slots.every(row => row.lassoW === null));
});
test('missing temperature, missing lags and insufficient history stay unknown', async () => {
    const f = fixture();
    const missing = await comparison.train(f.rows, now, dayType);
    assert.equal(missing.ready, false);
    const model = await trained(), issue = comparison.issue(model, now);
    assert.ok(issue.slots.every(row => row.lassoW === null));
    assert.equal(comparison.features(now, new Map(), dayType, 8, true), null);
    const short = await comparison.train(f.rows.slice(-96 * 15), now, dayType, f.temperatures);
    assert.equal(short.ready, false);
});
test('disabled temperature path is explicit and allows calendar/load-only comparison', async () => {
    const model = await comparison.train(fixture().rows, now, dayType, [], false);
    assert.equal(model.ready, true, model.reason);
    assert.equal(model.diagnostics.weatherFeatures, false);
    assert.ok(comparison.issue(model, now).slots.every(row => row.lassoW !== null));
});
test('future/partial samples, nonnumeric/negative loads and conflicting duplicates never enter training', () => {
    const ts = Math.floor(now / SLOT) * SLOT - SLOT;
    const rows = [{ts, val: 100}, {ts, val: 200}, {ts: ts - SLOT, val: null},
        {ts: ts - 2 * SLOT, val: -1}, {ts: now, val: 900}, {ts: ts + SLOT, val: 500}];
    assert.equal(comparison.cleanRows(rows, now).size, 0);
});
test('future labels cannot change an already issued forecast or model', async () => {
    const f = fixture(), base = await trained();
    const altered = await comparison.train([...f.rows, {ts: now + DAY, val: 99999}], now, dayType,
        [...f.temperatures, {ts: now + DAY, val: -30}]);
    assert.deepEqual(comparison.issue(altered, now, () => 8), comparison.issue(base, now, () => 8));
});
test('persisted predictions require same source contract, pre-delivery issuance and bounded unique days', async () => {
    const entry = comparison.issue(await trained(), now, () => 8);
    const raw = JSON.stringify({schema: 1, signature: 'sources-A', entries: [entry, entry, {...entry, issuedAt: entry.start}]});
    assert.equal(comparison.restore(raw, 'sources-A', now).length, 1);
    assert.equal(comparison.restore(raw, 'sources-B', now).length, 0);
    assert.equal(comparison.restore('{', 'sources-A', now).length, 0);
    assert.equal(comparison.restore(raw, 'sources-A', now + 20 * DAY).length, 0);
});
test('paired scoring uses only complete measured slots and reports daily energy only for full days', async () => {
    const entry = comparison.issue(await trained(), now, () => 8);
    entry.slots = entry.slots.map(row => ({...row, medianW: 1000, lassoW: 1100}));
    const actual = entry.slots.map(row => ({ts: row.timestamp, val: 1200}));
    assert.equal(comparison.score([entry], actual, entry.end - SLOT).days.length, 0);
    const report = comparison.score([entry], actual, entry.end + SLOT);
    assert.equal(report.completeDays, 1); assert.equal(report.days[0].median.maeW, 200);
    assert.equal(report.days[0].lasso.maeW, 100); assert.equal(report.days[0].lasso.energyBiasKWh, -2.4);
    const gap = comparison.score([entry], actual.slice(1), entry.end + SLOT);
    assert.equal(gap.completeDays, 0); assert.equal(gap.days[0].actualKWh, null);
    assert.equal(gap.days[0].lasso.energyBiasKWh, null);
    entry.slots[0].lassoW = null;
    assert.equal(comparison.score([entry], actual, entry.end + SLOT).days[0].pairedSlots, 95);
});
test('DST transition days remain unknown rather than shifting calendar lags or inventing 96 slots', () => {
    const spring = new Date(2026, 2, 29, 12).getTime(), fall = new Date(2026, 9, 25, 12).getTime();
    for (const ts of [spring, fall]) {
        assert.equal(comparison.cleanRows([{ts, val: 100}], ts + SLOT).size, 0);
        assert.equal(comparison.features(ts, new Map(), dayType, 10, true), null);
    }
});
test('ensembles are fixed before delivery: blend is 50/50 and hybrid preserves Lasso energy and Median shape', async () => {
    const entry = comparison.issue(await trained(), now, () => 8);
    assert.equal(entry.ensembleVersion, 1);
    const sum = field => entry.slots.reduce((total, row) => total + row[field], 0);
    assert.ok(Math.abs(sum('hybridW') - sum('lassoW')) < 1e-6);
    const scale = sum('lassoW') / sum('medianW');
    for (const row of entry.slots) {
        assert.equal(row.blendW, (row.medianW + row.lassoW) / 2);
        assert.equal(row.hybridW, row.medianW * scale);
    }
    const saved = JSON.stringify({schema: 1, signature: 'same', entries: [entry]});
    assert.deepEqual(comparison.restore(saved, 'same', now), [entry]);
    const actual = entry.slots.map(row => ({ts: row.timestamp, val: row.hybridW}));
    const day = comparison.score([entry], actual, entry.end).days[0];
    assert.equal(day.hybrid.maeW, 0);
    assert.equal(day.hybrid.pairedSlots, 96);
    assert.ok(Math.abs(day.hybrid.energyBiasKWh) < 1e-8);
    const gap = comparison.score([entry], actual.slice(1), entry.end).days[0];
    for (const key of ['median', 'lasso', 'blend', 'hybrid']) {
        assert.equal(gap[key].pairedSlots, 95);
        assert.equal(gap[key].energyBiasKWh, null);
    }
});
test('legacy forecasts remain unchanged and never receive a retrospective ensemble score', async () => {
    const entry = comparison.issue(await trained(), now, () => 8);
    delete entry.ensembleVersion;
    entry.slots = entry.slots.map(({timestamp, medianW, lassoW}) => ({timestamp, medianW, lassoW}));
    const saved = JSON.stringify(entry);
    const actual = entry.slots.map(row => ({ts: row.timestamp, val: 1000}));
    const day = comparison.score([entry], actual, entry.end).days[0];
    assert.equal(JSON.stringify(entry), saved);
    assert.equal(day.median.pairedSlots, 96);
    for (const key of ['blend', 'hybrid']) {
        assert.equal(day[key].pairedSlots, 0);
        assert.equal(day[key].maeW, null);
        assert.equal(day[key].energyBiasKWh, null);
    }
});
test('ensemble gaps, zero Median totals and extreme hybrid scaling are not filled or clipped', async () => {
    const base = await trained();
    const missing = comparison.issue(base, now, () => null);
    assert.ok(missing.slots.every(row => row.blendW === null && row.hybridW === null));
    const zero = comparison.issue({...base, medianAt: () => 0}, now, () => 8);
    assert.ok(zero.slots.every(row => row.blendW === row.lassoW / 2 && row.hybridW === null));
    const extreme = comparison.issue({...base, medianAt: ts => ts % DAY === 0 ? 100000 : 0,
        model: {...base.model, weights: base.model.weights.map(() => 0), yMean: 100000}}, now, () => 8);
    assert.ok(extreme.slots.every(row => row.hybridW === null));
    assert.ok(extreme.slots.every(row => Number.isFinite(row.blendW)));
});
test('corrupt ensemble forecasts are rejected on restore', async () => {
    const entry = comparison.issue(await trained(), now, () => 8);
    entry.slots[0].blendW = -1;
    assert.equal(comparison.restore(JSON.stringify({schema: 1, signature: 'same', entries: [entry]}), 'same', now).length, 0);
});
test('training cancellation is bounded and cannot leave a solver running after unload', async () => {
    const rows = Array.from({length: 100}, (_, i) => ({x: Array(comparison.FEATURES.length).fill(i % 2), y: i * 10}));
    let allowed = true;
    const fitting = comparison.fit(rows, 5, () => allowed); allowed = false;
    await assert.rejects(fitting, /cancelled/);
});
function wrapper(config = {}, allowed = true) {
    const states = new Map(), writes = [];
    const context = vm.createContext({nativeConfig: config, loadForecastComparison: comparison,
        loadComparisonAllowed: () => allowed, Date, Intl, CFG: {root: 'ems.0', dp: {houseMetersW: ['house'], wallboxesKW: ['car']}, sqlInstance: 'sql.0'},
        getState: id => ({val: states.get(id)}), write: (id, value) => {states.set(id, value); writes.push(id);},
        weatherHours: () => [], nearestWeather: () => null});
    vm.runInContext(fs.readFileSync(require.resolve('../lib/engine/history'), 'utf8'), context);
    return {context, states, writes, run: source => vm.runInContext(source, context)};
}
test('disabled comparison and isolated shadow context do not query SQL, train or publish anything', async () => {
    for (const [config, allowed] of [[{}, true], [{loadComparisonEnabled: true}, false]]) {
        const h = wrapper(config, allowed);
        await h.run('updateLoadComparisonHistory([], Date.now())'); h.run('publishLoadComparison()');
        assert.equal(h.writes.length, 0);
    }
});
test('rebuild cannot revise a persisted day-ahead prediction, and contract changes invalidate readiness', async () => {
    const h = wrapper({loadComparisonEnabled: true}), model = await trained();
    h.context.model = model; h.context.issueTime = now;
    h.run('loadComparisonModel=model; loadComparisonSignature=loadComparisonContract();');
    const entry = comparison.issue(model, now, () => 8);
    h.states.set('ems.0.Forecast.LoadComparison.Ledger_JSON', JSON.stringify({schema: 1,
        signature: h.run('loadComparisonContract()'), entries: [entry]}));
    h.run('publishLoadComparison(issueTime)');
    assert.deepEqual(JSON.parse(h.states.get('ems.0.Forecast.LoadComparison.Forecast_JSON')), entry);
    h.run("CFG.dp.houseMetersW=['changed']; publishLoadComparison(issueTime)");
    assert.equal(h.run('loadComparisonSignature === loadComparisonContract()'), false);
    assert.equal(h.states.get('ems.0.Forecast.LoadComparison.Ready'), false);
});

test('an enabled ready comparison leaves every production forecast and planner input identical', async () => {
    const {createEngineContext} = require('../lib/engine-loader');
    const model = await trained();
    function run(enabled, failComparison = false) {
        const output = new Map(), cache = new Map(); let plan;
        class Clock extends Date {constructor(...args) {super(...(args.length ? args : [now]));} static now() {return now;}}
        const ctx = createEngineContext('ems.0', {}, {nativeConfig: {loadComparisonEnabled: enabled}, Date: Clock,
            getState: id => cache.get(id), existsState: () => false,
            setState: (id, val) => {cache.set(id, {val}); output.set(id, val);}});
        ctx.model = model; ctx.failComparison = failComparison;
        ctx.capturePlan = value => {plan = JSON.parse(JSON.stringify(value));};
        vm.runInContext(`historyReady=true;
            for (const type of DAY_TYPES) {historyProfiles.houseTotal[type]=Array(96).fill(2000); historyProfiles.baseload[type]=Array(96).fill(1000);}
            weatherHours=()=>[];
            buildPriceForecast=()=>({energy:[], grid:[], total:[], valid:true, status:'ok', mode:'test'});
            buildDevicePlan=capturePlan;
            loadComparisonModel=model; loadComparisonSignature=loadComparisonContract();
            if (failComparison) publishLoadComparison=()=>{throw new Error('diagnostic fault');};
            buildForecast();`, ctx);
        return {production: [...output].filter(([id]) => !id.includes('.LoadComparison.')), plan,
            comparison: output.get('ems.0.Forecast.LoadComparison.Status')};
    }
    const off = run(false), on = run(true);
    assert.equal(off.comparison, undefined); assert.ok(on.comparison);
    assert.deepEqual(on.production, off.production); assert.deepEqual(on.plan, off.plan);
    const failed = run(true, true);
    assert.match(failed.comparison, /diagnostic fault/);
    assert.deepEqual(failed.production, off.production); assert.deepEqual(failed.plan, off.plan);
});

test('unrecorded temperature disables only the diagnostic comparison with an explicit reason', async () => {
    const h = wrapper({loadComparisonEnabled: true, outsideTemperatureId: 'temperature'});
    h.context.historySourceEnabled = async () => false;
    await h.run('updateLoadComparisonHistory([], Date.now())');
    assert.equal(h.states.get('ems.0.Forecast.LoadComparison.Ready'), false);
    assert.match(h.states.get('ems.0.Forecast.LoadComparison.Status'), /nicht in SQL aktiviert/);
    assert.ok(h.writes.every(id => id.startsWith('ems.0.Forecast.LoadComparison.')));
});


test('SQL midpoint averages align with load bucket starts and synthetic boundary anchors are ignored', async () => {
    const observed = comparison.temperatureRows([
        {ts: 1793142000000, val: 11.73, i: true},
        {ts: 1793142450000, val: 11.66},
        {ts: 1793143350000, val: 11.57}
    ], 1793143800000);
    assert.equal(observed.get(1793142000000), 11.66);
    assert.equal(observed.get(1793142900000), 11.57);
    const f = fixture();
    const sql = f.temperatures.map(row => ({ts: row.ts + SLOT / 2, val: row.val}));
    // Reproduce SQL's first interpolated point, which can differ from the
    // average in the same quarter-hour. It must not conflict with that average.
    for (let ts = start; ts < now - 12 * 3600000; ts += DAY) sql.push({ts, val: -30, i: true});
    const model = await comparison.train(f.rows, now, dayType, sql);
    const aligned = await trained();
    assert.equal(model.ready, true, model.reason);
    assert.equal(model.diagnostics.samples, aligned.diagnostics.samples);
    assert.deepEqual(model.diagnostics.coefficients, aligned.diagnostics.coefficients);
    assert.deepEqual(comparison.issue(model, now, () => 8), comparison.issue(aligned, now, () => 8));
});
test('temperature interval completion uses bucket end and preserves gaps, conflicts and malformed times', () => {
    const ts = Math.floor(now / SLOT) * SLOT;
    const rows = [{ts: ts + SLOT / 2, val: 10}, {ts: ts + SLOT, val: 20, i: true}];
    assert.equal(comparison.temperatureRows(rows, ts + SLOT - 1).size, 0);
    assert.equal(comparison.temperatureRows(rows, ts + SLOT).get(ts), 10);
    assert.equal(comparison.temperatureRows(rows, ts + SLOT).size, 1);
    const conflicting = [...rows, {ts, val: 11}, {ts: ts - SLOT + 1000, val: 9}, {ts: ts - 2 * SLOT, val: null}];
    assert.equal(comparison.temperatureRows(conflicting, ts + SLOT).size, 0);
    const equal = [...rows, {ts, val: 10}];
    assert.equal(comparison.temperatureRows(equal, ts + SLOT).get(ts), 10);
});
