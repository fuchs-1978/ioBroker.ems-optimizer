'use strict';
const {test} = require('node:test');
const assert = require('node:assert/strict');
const {feasibility, configuration, plannedEnergy} = require('../lib/planning-explanation');
const now = 1800000000000;
const w = {wb: 0, Present: true, SoCValid: true, SoC_pct: 50, TargetSoC_pct: 60,
    Connected: true, UserRelease: true, Release: true, ControlEnabled: true, MaximumPower_W: 11000};
const input = {capacityKWh: 50, efficiencyPct: 90, deadlineEnabled: true,
    departureAt: now + 3600000, planValid: true,
    series: Array.from({length: 4}, (_, i) => ({timestamp: now + i * 900000, valueW: 6000}))};
test('shared allocated plan determines reachability with AC losses and a real deadline', () => {
    const g = feasibility(w, input, now, true);
    assert.equal(g.status, 'expected-reachable'); assert.equal(g.batteryRequiredKWh, 5);
    assert.equal(g.plannedAcKWh, 6); assert.equal(g.gridRequiredKWh, null); assert.equal(g.guaranteed, false);
    assert.equal(feasibility(w, {...input, series: input.series.map(s => ({...s, valueW: 1000}))}, now, true).status, 'plan-shortfall');
    assert.equal(feasibility(w, {...input, departureAt: now + 60000}, now, true).status, 'unreachable');
});
test('missing evidence, inactive deadlines, withdrawal and reached goals stay distinct', () => {
    for (const [vehicle, data, current, expected] of [
        [{...w, SoCValid: false}, input, true, 'unknown'], [w, input, false, 'unknown'],
        [w, {...input, planValid: false}, true, 'unknown'], [w, {...input, deadlineEnabled: false}, true, 'no-deadline'],
        [{...w, UserRelease: false}, input, true, 'blocked'], [{...w, SoC_pct: 65}, input, true, 'reached'],
        [w, {...input, efficiencyPct: 0}, true, 'unknown']])
        assert.equal(feasibility(vehicle, data, now, current).status, expected);
});
test('partial slots, overlaps and malformed series cannot double-spend planning energy', () => {
    assert.equal(plannedEnergy([{timestamp: now - 450000, valueW: 4000}], now, now + 3600000), 0.5);
    assert.equal(plannedEnergy([input.series[0], input.series[0]], now, input.departureAt), null);
    assert.equal(plannedEnergy([input.series[0], {...input.series[0], timestamp: now + 1000}], now, input.departureAt), null);
    assert.equal(plannedEnergy([{timestamp: now, valueW: null}], now, input.departureAt), null);
});
test('configuration conflicts preserve disabled devices and distinguish unknown external SoC from error', () => {
    assert.equal(configuration({wb0Present: false, wb0MinSocPct: 90, wb0TargetSocPct: 20}, {wallboxes: []}).findings.length, 0);
    const r = configuration({wb0Present: true, wb0SocLimitsSource: 'admin', wb0MinSocPct: 90, wb0TargetSocPct: 20,
        wb0CapacityKWh: 50, wb0MinCurrent1pA: 6, wb0MaxCurrent1pA: 16, wb0MinCurrent3pA: 0, wb0MaxCurrent3pA: 0},
    {wallboxes: [{wb: 0, Present: true, SoCValid: false, UserRelease: false}]});
    assert.equal(r.status, 'conflict'); assert.ok(r.findings.some(f => f.code === 'wb0.soc.order'));
    assert.ok(r.findings.some(f => f.severity === 'unknown')); assert.ok(r.findings.some(f => f.severity === 'hint'));
});
