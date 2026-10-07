'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');

function phaseEngine(config = {}, initialPhase = 3) {
    const states = new Map();
    const root = 'ems.0';
    const put = (suffix, val) => states.set(`${root}.${suffix}`, {val, ack: true});
    put('Config.WallboxNominalVoltage_V', 230);
    put('Config.WallboxStartReserve_W', 300);
    put('Config.SlowControlCycle_s', 5);
    put('Control.Deadband_W', 100);
    const vehicle = {phaseSwitchEnabled: true, maximumPhases: 3,
        phaseControlMode: 'ems', phaseControlValid: true, phaseFeedbackValid: true,
        confirmedPhases: initialPhase, minCurrent1pA: 6, maxCurrent1pA: 20,
        minCurrent3pA: 6, maxCurrent3pA: 16, maximumPowerW: 11040,
        mustCharge: false, departureTimestamp: 0, gridEnergyRequiredKWh: 0};
    const ctx = vm.createContext({CFG: {root}, nativeConfig: {phaseSwitchMinHoldMin: 0, ...config},
        Date, console, vehicle,
        getState: id => states.get(id), write: (id, val) => states.set(id, {val, ack: true}),
        readNumber: (id, fallback) => Number.isFinite(Number(states.get(id)?.val))
            ? Number(states.get(id).val) : fallback,
        numericValue: val => typeof val === 'number' && Number.isFinite(val) ? val : null,
        clamp: (value, min, max) => Math.min(max, Math.max(min, value))});
    vm.runInContext(fs.readFileSync(path.join(__dirname, '../lib/engine/realtime.js'), 'utf8'), ctx);
    const start = 10000000;
    vm.runInContext(`stableWallboxPhases[1] = ${initialPhase}; lastPhaseChangeAt[1] = 0`, ctx);
    const run = (seconds, budgetW, context = {}) => {
        ctx.realContext = {budgetW, valid: true, pending: false, ...context};
        return vm.runInContext(`stabilizedPhaseTarget(1, vehicle, 3, ${start + seconds * 1000}, realContext)`, ctx);
    };
    const diagnostic = () => JSON.parse(states.get(`${root}.Control.Wallbox1.PhaseDecision_JSON`).val);
    const continuous = (from, to, budgetW, step = 5) => {
        let result;
        for (let second = from; second <= to; second += step) result = run(second, budgetW);
        return result;
    };
    return {run, diagnostic, continuous, ctx, start, vehicle, states};
}

test('persistent valid low real budget overrides a three-phase forecast after 120 seconds', () => {
    const h = phaseEngine();
    h.states.set('ems.0.Plan.Wallbox1_48h_JSON', {val: JSON.stringify(
        Array.from({length: 3}, (_, i) => ({timestamp: h.start + i * 900000,
            valueW: 6210, phases: 3, chargingMinutes: 15})))});
    assert.equal(h.continuous(0, 115, 3500), 3);
    assert.equal(h.diagnostic().remainingS, 5);
    assert.equal(h.run(120, 3500), 1);
    assert.equal(h.diagnostic().reason, 'real-budget-phase-request');
    assert.equal(h.run(125, 3500), 1, 'forecast cannot immediately undo the real decision');
    assert.equal(h.states.get('ems.0.Control.Wallbox1.PhaseDecisionRemaining_s').val, 0);
});

test('transient, invalid, gapped and pending frames never contribute to continuous qualification', () => {
    const h = phaseEngine();
    h.continuous(0, 60, 3500);
    assert.equal(h.run(65, 4300), 3, 'hysteresis clears a short deficit');
    h.continuous(70, 125, 3500);
    assert.equal(h.run(130, 3500, {valid: false}), 3);
    assert.equal(h.diagnostic().reason, 'real-budget-invalid');
    h.continuous(135, 190, 3500);
    assert.equal(h.run(200, 3500), 3, 'a missed slow cycle cancels rather than extrapolates');
    assert.equal(h.diagnostic().reason, 'observation-gap');
    h.continuous(205, 260, 3500);
    h.vehicle.phaseFeedbackValid = false;
    assert.equal(h.run(265, 3500, {pending: true, valid: false}), 3);
    assert.equal(h.diagnostic().reason, 'phase-transition-pending');
    h.vehicle.phaseFeedbackValid = true;
    assert.equal(h.continuous(270, 385, 3500), 3);
    assert.equal(h.run(390, 3500), 1);
});

test('real upshift needs 300 valid seconds above useful one-phase capacity and reserve', () => {
    const h = phaseEngine({}, 1);
    assert.equal(h.continuous(0, 350, 4800), 1, 'a near-capacity budget stays inside hysteresis');
    assert.equal(h.continuous(355, 650, 5500), 1);
    assert.equal(h.run(655, 5500), 3);
    assert.equal(h.diagnostic().upAboveW, 4900);
});

test('existing phase minimum hold survives the additional real-budget qualification', () => {
    const h = phaseEngine({phaseSwitchMinHoldMin: 15});
    vm.runInContext(`lastPhaseChangeAt[1] = ${h.start}; lastRealPhaseChangeAt[1] = ${h.start}`, h.ctx);
    assert.equal(h.continuous(0, 120, 3500), 3);
    assert.equal(h.diagnostic().reason, 'phase-minimum-hold');
    assert.equal(h.diagnostic().remainingS, 780);
    assert.equal(h.continuous(125, 895, 3500), 3);
    assert.equal(h.run(900, 3500), 1);
});

test('no one-phase operating budget and mandatory charging do not create speculative phase requests', () => {
    for (const budgetW of [0, 1500, null, Number.NaN]) {
        const h = phaseEngine();
        assert.equal(h.continuous(0, 150, budgetW), 3);
    }
    const h = phaseEngine();
    h.vehicle.mustCharge = true;
    assert.equal(h.continuous(0, 150, 3500), 3);
    assert.equal(h.diagnostic().reason, 'mandatory-charge-keeps-phase');
});

test('fixed and script phase authorities retain their confirmed behavior with real context', () => {
    const fixed = phaseEngine();
    fixed.vehicle.phaseSwitchEnabled = false;
    assert.equal(fixed.run(0, 6000), 1);
    assert.equal(fixed.diagnostic().reason, 'fixed-one-phase');
    const scripted = phaseEngine({}, 1);
    scripted.vehicle.phaseControlMode = 'script';
    assert.equal(scripted.continuous(0, 400, 9000), 1);
    assert.equal(scripted.diagnostic().reason, 'external-phase-authority');
    scripted.vehicle.phaseFeedbackValid = false;
    assert.equal(scripted.run(405, 9000), 0);
});

test('productive phase episode starts from confirmed hardware instead of an earlier observer choice', () => {
    const h = phaseEngine({}, 1);
    vm.runInContext('stableWallboxPhases[1] = 3', h.ctx);
    assert.equal(h.run(0, 4300), 1, 'a moderate real budget cannot inherit an unqualified observer 3P');
    assert.equal(h.continuous(5, 300, 5500), 1);
    assert.equal(h.run(305, 5500), 3);
    h.run(310, 5500, {active: false, valid: false});
    assert.equal(h.run(315, 4300), 1, 'a new selection reads confirmed physical mode again');
    assert.equal(h.diagnostic().reason, 'real-budget-hysteresis');
});

test('new episode respects an existing bounded follower destination during a command echo', () => {
    const h = phaseEngine({}, 3);
    h.states.set('ems.0.Control.Targets.Wallbox1_Phases', {val: 1, ack: true});
    h.vehicle.phaseFeedbackValid = false;
    assert.equal(h.run(0, 3500, {pending: true, valid: false}), 1);
    h.vehicle.phaseFeedbackValid = true;
    h.vehicle.confirmedPhases = 1;
    assert.equal(h.run(5, 3500), 1);
    assert.equal(h.diagnostic().reason, 'real-budget-matches-phase');
});

test('observer hold is not credited as a real switch while prior real hold survives reselection', () => {
    const h = phaseEngine({phaseSwitchMinHoldMin: 15}, 1);
    vm.runInContext(`stableWallboxPhases[1] = 3; lastPhaseChangeAt[1] = ${h.start}`, h.ctx);
    assert.equal(h.continuous(0, 295, 5500), 1);
    assert.equal(h.run(300, 5500), 3, 'an observer-only target does not delay real qualification');
    h.vehicle.confirmedPhases = 3;
    h.run(305, 3500, {active: false, valid: false});
    assert.equal(h.continuous(310, 430, 3500), 3);
    assert.equal(h.diagnostic().reason, 'phase-minimum-hold');
    assert.equal(h.diagnostic().remainingS, 770, 'real hold continues from request at300s');
});

test('phase budget rejects stale, unacknowledged or poor-quality reclaimed sources', () => {
    const h = phaseEngine();
    h.ctx.CFG.dp = {gridImport: 'grid.in', gridExport: 'grid.out',
        wallboxesKW: ['wb0.power', 'wb1.power', 'wb2.power'],
        myPvDhwOutputW: ['ehz.l1', 'ehz.l2', 'ehz.l3']};
    h.ctx.CFG.dataMaxAgeMs = 120000;
    for (const id of ['grid.in', 'grid.out', 'wb0.power', 'wb1.power', 'ehz.l1', 'ehz.l2', 'ehz.l3'])
        h.states.set(id, {val: id === 'wb1.power' ? 4.14 : 0, ack: true, q: 0, ts: h.start});
    const valid = now => vm.runInContext(
        `wallboxPhaseBudgetSourcesValid({wallboxes:[0,1],dhw:true},${now})`, h.ctx);
    assert.equal(valid(h.start), true);
    assert.equal(valid(h.start + 10001), false, 'NVP must meet the output guard 10-second source contract');
    assert.equal(valid(h.start + 10000), true);
    for (const id of ['grid.in', 'grid.out', 'wb0.power', 'ehz.l2']) {
        const original = h.states.get(id);
        for (const overrides of [{ack: false}, {q: 64}, {val: null}, {ts: h.start + 2000}]) {
            h.states.set(id, {...original, ...overrides});
            assert.equal(valid(h.start), false, `${id}: ${JSON.stringify(overrides)}`);
        }
        h.states.set(id, original);
    }
    assert.equal(valid(h.start), true);
});
