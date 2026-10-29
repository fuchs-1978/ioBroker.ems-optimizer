'use strict';
const {test} = require('node:test');
const assert = require('node:assert/strict');
const {ForecastLearning} = require('../lib/forecast-learning');
const {RegulationQuality, admission} = require('../lib/regulation-quality');
const fs = require('node:fs'), vm = require('node:vm');
const start = Math.floor(1800000000000 / 900000) * 900000;
const frame = (ts, pv = 1000) => ({ts, measurements: {pv: {valid: true, ack: true, q: 0}}, power: {pv_W: pv}});
test('forecast residuals use predictions issued before delivery and complete observed slots only', () => {
    const a = new ForecastLearning(); const at = start + 900000;
    a.observe(frame(start), [{timestamp: at, valueW: 900}], start);
    for (let ts = at; ts <= at + 900000; ts += 5000) a.observe(frame(ts));
    assert.equal(a.report(at + 900000).samples, 1); assert.equal(a.errors[0], 100);
    assert.equal(a.band(1000).lowerW, null);
    const b = new ForecastLearning();
    b.observe(frame(at), [{timestamp: at, valueW: 100}], at);
    for (let ts = at; ts <= at + 900000; ts += 5000) b.observe(frame(ts));
    assert.equal(b.errors.length, 0, 'late target is never retrospective forecast evidence');
});
test('future and malformed forecasts or gaps cannot calibrate confidence; session bounds remain explicit', () => {
    const a = new ForecastLearning(); a.observe(frame(start), [{timestamp: start + 900000, valueW: 1000}], start + 1);
    assert.equal(a.predictions.size, 0);
    a.errors = Array.from({length: 20}, (_, i) => i - 10);
    const b = a.band(100); assert.ok(b.lowerW <= b.upperW); assert.equal(a.report(start).observedCoverage, null);
});
test('load profile opts in explicitly, favors recent weeks and never fills absent slots with zero', () => {
    const source = fs.readFileSync(require.resolve('../lib/engine/history'), 'utf8');
    const ctx = vm.createContext({nativeConfig: {}, numericValue: n => typeof n === 'number' && Number.isFinite(n) ? n : null});
    vm.runInContext(source, ctx);
    const now = Date.now(), dates = [84, 77, 7].map(days => ({ts: now - days * 86400000, val: days < 10 ? 1000 : 100}));
    const old = vm.runInContext('profile', ctx)(dates, () => true);
    const recent = vm.runInContext('recentProfile', ctx)(dates, () => true, now);
    assert.ok(old.includes(100)); assert.ok(recent.includes(1000)); assert.equal(recent.filter(x => x === null).length, 95);
});
test('regulation energy is covered only across fresh bounded intervals and cannot invent avoidability', () => {
    const a = new RegulationQuality();
    const s = ts => ({ts, measurements: {gridImport: {valid: true}, gridExport: {valid: true}},
        control: {TargetGridPower_W: 0}, power: {grid_W: -1000}, wallboxes: []});
    a.sample(s(start)); const r = a.sample(s(start + 5000));
    assert.equal(r.current.exportWh, 1000 * 5000 / 3600000); assert.equal(r.current.avoidableExportWh, null);
    assert.equal(admission(s(start)), null); assert.equal(a.sample(s(start + 30000)).current.unknownMs, 25000);
});
test('load correction warms up, is bounded and expires on a gap instead of adopting one spike', () => {
    const {LoadAdjustment} = require('../lib/forecast-learning'); const a = new LoadAdjustment();
    const series = [{timestamp: start, valueW: 1000}, {timestamp: start + 900000, valueW: 1000}];
    for (let t = start; t <= start + 600000; t += 5000) a.observe(t, 2000, series, true);
    const r = a.observe(start + 605000, 2000, series, true);
    assert.equal(r.status, 'preview'); assert.ok(r.preview.every(x => x.candidateW <= 1250));
    assert.equal(a.observe(start + 630000, 2000, series, true).status, 'insufficient-data');
});
test('qualified wallbox admission is distinguished from temperature capacity and never proves avoidable energy', () => {
    const s = {ts: start, system: {RealOutputsEnabled: true}, control: {Valid: true, Enabled: true},
        wallboxes: [{Present: true, Release: true, ControlEnabled: true, OutputOwned: true,
            ResponsePending: false, PhaseTransitionActive: false, actual_W: 1380,
            measurements: {power: {valid: true}}, increaseBudget: {at: start, modeled: false,
                decision: 'target', freshIncreaseBudget: true, freshIncreaseResponse: true,
                awaitingElectricalStep: false, nextA: 7, previousA: 6, requiredW: 1610,
                liveBudgetW: 1700, hardMaximumA: 16, phases: 1, voltage: 230}}]};
    assert.equal(admission(s), 320);
    s.wallboxes[0].increaseBudget.freshIncreaseResponse = false; assert.equal(admission(s), null);
    s.wallboxes = []; s.ehz = {TemperaturePowerLimit_W: 9000, actual_W: 0}; assert.equal(admission(s), null);
});
