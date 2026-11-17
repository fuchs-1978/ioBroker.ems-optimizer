'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {AppliancePhases, PhaseLearner, appliancePowerSourceIds, evaluateTransition, numericState} = require('../lib/appliance-phases');

const BASE = Date.parse('2026-11-17T12:00:00Z');
function frame(at, deviceW, phase = 1, extra = {}) {
    const phasesW = [-300, 400, 600];
    phasesW[phase - 1] += deviceW;
    return {at, gridAt: at, deviceAt: at, deviceW, phasesW, aligned: true,
        guards: [{id: 'PV', watts: 2000, at}], ...extra};
}

function drive(learner, phase, levels, {interval = 5000, count = 8, mutate = r => r, start = BASE} = {}) {
    let at = start;
    for (const watts of levels) for (let i = 0; i < count; i++) {
        learner.observe(mutate(frame(at, watts, phase)));
        at += interval;
    }
    return at;
}

for (const phase of [1, 2, 3]) test(`infers L${phase} from three independent measured changes including a stop`, () => {
    const learner = new PhaseLearner({}, BASE);
    drive(learner, phase, [0, 1900, 0]);
    assert.equal(learner.phase, 0, 'two changes are still provisional');
    const learned = new PhaseLearner({}, BASE);
    drive(learned, phase, [0, 1900, 0, 1900]);
    assert.equal(learned.phase, phase);
    assert.equal(learned.votes.length, 3);
    assert.deepEqual(learned.votes.map(v => Math.sign(v.deviceDeltaW)), [1, -1, 1]);
    assert.equal(new PhaseLearner(learned.result(), BASE + 200000).phase, phase);
});

test('fast meter publications still retain a sufficiently long measurement window', () => {
    const learner = new PhaseLearner({}, BASE);
    drive(learner, 2, [0, 170, 0, 170], {interval: 1000, count: 30});
    assert.equal(learner.phase, 2);
});

test('held Tapo values and repeatedly polled grid packets never multiply the evidence', () => {
    const learner = new PhaseLearner({}, BASE);
    drive(learner, 1, [0], {mutate: r => ({...r, deviceAt: BASE})});
    drive(learner, 1, [1900, 0, 1900], {start: BASE + 50000,
        mutate: r => ({...r, deviceAt: BASE})});
    assert.equal(learner.votes.length, 0);
    const frozen = new PhaseLearner({}, BASE);
    drive(frozen, 1, [0, 1900, 0, 1900], {mutate: r => ({...r, gridAt: BASE})});
    assert.equal(frozen.votes.length, 0);
});

test('unidirectional steps and small compressor changes stay unassigned', () => {
    const rising = new PhaseLearner({}, BASE);
    drive(rising, 1, [0, 300, 600, 900]);
    assert.equal(rising.votes.length, 3);
    assert.equal(rising.phase, 0);
    const small = new PhaseLearner({}, BASE);
    drive(small, 1, [0, 80, 0, 80]);
    assert.equal(small.votes.length, 0);
});

test('battery compensation, cloud edges and another appliance invalidate observations', () => {
    for (const id of ['PV', 'Speicher 1', 'Geschirrspüler', 'Wallbox 2']) {
        const learner = new PhaseLearner({}, BASE);
        drive(learner, 1, [0, 1900, 0, 1900], {mutate: r => ({...r,
            guards: [{id, watts: 2000 - r.deviceW, at: r.at}]})});
        assert.equal(learner.votes.length, 0, id);
        assert.equal(learner.phase, 0);
    }
});

test('ambiguous, distributed, noisy or wrong-sign phase changes remain unknown', () => {
    const alterations = [
        r => ({...r, phasesW: [r.deviceW / 2, r.deviceW / 2, 0]}),
        r => ({...r, phasesW: [-r.deviceW, 0, 0]}),
        r => ({...r, phasesW: [r.deviceW, r.deviceW, 0]}),
        r => ({...r, phasesW: [r.deviceW + (r.at / 5000 % 2) * 600, 0, 0]}),
    ];
    for (const mutate of alterations) {
        const learner = new PhaseLearner({}, BASE);
        drive(learner, 1, [0, 1900, 0, 1900], {mutate});
        assert.equal(learner.votes.length, 0);
    }
});

test('a contradictory accepted event revokes a previously learned phase', () => {
    const learned = new PhaseLearner({}, BASE);
    drive(learned, 1, [0, 1900, 0, 1900]);
    const moved = new PhaseLearner(learned.result(), BASE + 200000);
    drive(moved, 3, [0, 1900], {start: BASE + 210000});
    assert.equal(moved.phase, 0);
    assert.match(moved.status, /Widersprüchlicher/);
});

test('a missing reading interrupts an event without clearing established evidence', () => {
    const learner = new PhaseLearner({}, BASE);
    const end = drive(learner, 1, [0, 1900]);
    const count = learner.votes.length;
    learner.observe(frame(end, 0));
    learner.interrupt('Messwert fehlt');
    drive(learner, 1, [0], {start: end + 5000});
    assert.equal(learner.votes.length, count);
});

test('short interfering pulses and guards which did not update across the event are rejected', () => {
    const before = [0, 5, 10].map(s => frame(BASE + s * 1000, 0));
    const after = [20, 25, 30].map(s => frame(BASE + s * 1000, 1900));
    const trace = [frame(BASE + 15000, 1900), frame(BASE + 16000, 1900)];
    assert.equal(evaluateTransition(before, after, trace).phase, 1);
    trace[1].phasesW[2] += 700;
    assert.match(evaluateTransition(before, after, trace).reason, /Zusätzlicher/);
    trace[1].phasesW[2] -= 700;
    for (const row of [...before, ...after, ...trace]) row.guards[0].at = BASE;
    assert.match(evaluateTransition(before, after, trace).reason, /nicht erneuert/);
});

test('source validation rejects unconfirmed, stale, future, bad-quality and nonnumeric values and uses SI units', () => {
    const good = {val: 1900000, ack: true, ts: BASE, q: 0};
    assert.equal(numericState(good, BASE + 1000, 5000, 'mW').watts, 1900);
    assert.equal(numericState({...good, val: 1.9}, BASE, 5000, 'kW').watts, 1900);
    for (const changes of [{ack: false}, {q: 64}, {ts: BASE - 5001}, {ts: BASE + 1}, {val: '1900'}, {val: null}, {val: NaN}])
        assert.equal(numericState({...good, ...changes}, BASE, 5000), null);
    assert.equal(numericState(good, BASE, 5000, 'MW'), null);
});

function adapterFixture({config = {}, saved = new Map()} = {}) {
    const states = new Map(), objects = new Map(), timers = [];
    const mapping = Object.fromEntries([1, 2, 3].flatMap(p => [
        [`DP_HA_L${p}_IMPORT_W`, `grid.L${p}.import`], [`DP_HA_L${p}_EXPORT_W`, `grid.L${p}.export`]]));
    const adapter = {namespace: 'ems-optimizer.0', unloading: false,
        config: {devicePrograms: [{name: 'Trockner', powerObject: 'tapo.power', powerUnit: 'mW'}], ...config},
        readMapping: () => mapping,
        getCachedState: id => states.get(id), getStateAsync: async id => saved.get(id),
        setObjectNotExistsAsync: async (id, object) => objects.set(id, object),
        setStateAsync: async (id, val, ack) => saved.set(id, {val, ack}),
        setTimeout: (callback, delay) => timers.push({callback, delay}),
        log: {warn: message => assert.fail(message)}};
    return {adapter, mapping, states, objects, saved, timers};
}

function headResponse(watts, at) {
    return {val: JSON.stringify({PK: 2, SC: 60, ON: 3, GS: 0, GP: -watts, MM: 0, LM: 1,
        SI: 10, SA: 100, MG: 2400, IS: 2400, LP: 0}), ts: at, ack: true};
}

test('adapter persists per-meter evidence across restart and row reordering, and invalidates a changed boundary', async () => {
    const h = adapterFixture();
    const service = new AppliancePhases(h.adapter);
    await service.initialize();
    drive(service.devices[0].learner, 2, [0, 1900, 0, 1900]);
    await service.tick();
    assert.equal(service.resultFor('tapo.power', 'mW').gridPhase, 2);
    const resultId = service.resultFor('tapo.power', 'mW').phaseEvidenceId;
    assert.equal(JSON.parse(h.saved.get(resultId).val).phase, 2);
    assert.ok([...h.objects.values()].filter(o => o.type === 'state').every(o => o.common.write === false));
    h.adapter.config.devicePrograms.unshift({name: 'unmetered'});
    const restarted = new AppliancePhases(h.adapter);
    await restarted.initialize();
    assert.equal(restarted.resultFor('tapo.power', 'mW').gridPhase, 2);
    assert.match(h.saved.get('Devices.Phases.Summary').val, /unmetered.*Leistungsmesspunkt fehlt/);
    h.mapping.DP_HA_L1_IMPORT_W = 'different.meter';
    const remapped = new AppliancePhases(h.adapter);
    await remapped.initialize();
    assert.equal(remapped.resultFor('tapo.power', 'mW').gridPhase, 0);
});

test('passive service reads signed phases, guards each battery head and pauses during an active test', async () => {
    const h = adapterFixture({config: {batteryPresent: true, batteryDispatchMode: 'sunenergy-heads', batteryHeadCount: 2}});
    const now = Date.now();
    for (const [key, id] of Object.entries(h.mapping)) h.states.set(id, {val: key.includes('EXPORT') ? 900 : 0, ts: now, ack: true});
    h.states.set('tapo.power', {val: 1900000, ts: now, ack: true});
    for (const head of [1, 2]) {
        h.states.set(`sunenergyxt500.0.heads.${head}.info.rawResponse`, headResponse(200, now));
        h.states.set(`sunenergyxt500.0.heads.${head}.info.online`, {val: true, ts: now - 3600000, ack: true});
        h.states.set(`sunenergyxt500.0.heads.${head}.grid.GP`, {val: -200, ts: now - 3600000, ack: true});
    }
    const service = new AppliancePhases(h.adapter);
    await service.initialize();
    const reading = service.readFrame(service.devices[0], now);
    assert.equal(reading.deviceW, 1900);
    assert.deepEqual(reading.phasesW, [-900, -900, -900]);
    assert.equal(reading.guards.length, 2);
    h.states.delete('sunenergyxt500.0.heads.2.info.rawResponse');
    assert.match(service.readFrame(service.devices[0], now).reason, /Speicher 2/);
    h.states.set('sunenergyxt500.0.heads.2.info.rawResponse', headResponse(0, now));
    h.states.set('ems-optimizer.0.Control.PhaseTest_JSON', {val: JSON.stringify({stage: 'measure'})});
    assert.match(service.readFrame(service.devices[0], now).reason, /Aktiver Phasentest/);
    assert.equal(h.timers[0].delay, 1000);
    h.adapter.unloading = true;
    await service.tick();
    assert.equal(h.timers.length, 1, 'unload does not reschedule');
});

test('refrigerators can use a meter, duplicate rows share evidence and inconsistent units are blocked', async () => {
    const h = adapterFixture({config: {deviceSetpoints: [{name: 'Kühlschrank', powerObject: 'fridge.power', powerUnit: 'W'}]}});
    h.adapter.config.devicePrograms.push({name: 'dryer alias', powerObject: 'tapo.power', powerUnit: 'mW'});
    assert.deepEqual(appliancePowerSourceIds(h.adapter.config), ['tapo.power', 'fridge.power']);
    const service = new AppliancePhases(h.adapter);
    await service.initialize();
    assert.equal(service.devices.length, 2);
    assert.equal(service.devices[0].names.length, 2);
    h.adapter.config.devicePrograms.push({powerObject: 'tapo.power', powerUnit: 'W'});
    const conflict = new AppliancePhases(h.adapter);
    await conflict.initialize();
    assert.match(conflict.resultFor('tapo.power', 'mW').phaseStatus, /Widersprüchliche Einheiten/);
    assert.equal(conflict.resultFor('tapo.power', 'mW').gridPhase, 0);
    assert.deepEqual(appliancePowerSourceIds({...h.adapter.config, appliancePhaseLearningEnabled: false}), []);
});

test('live service learns from 10-second Tapo readings and 1-second grid readings without foreign writes or history queries', async () => {
    const h = adapterFixture();
    let now = BASE;
    h.adapter.getForeignStateAsync = () => assert.fail('no polling of foreign states');
    h.adapter.setForeignStateAsync = () => assert.fail('passive observation must not command an appliance');
    h.adapter.runEngine = () => assert.fail('no history query or control invocation');
    const service = new AppliancePhases(h.adapter, {now: () => now});
    await service.initialize();
    for (let second = 0; second < 160; second++) {
        now = BASE + second * 1000;
        const watts = Math.floor(second / 40) % 2 ? 1900 : 0;
        for (const p of [1, 2, 3]) {
            h.states.set(`grid.L${p}.import`, {val: 200 + (p === 3 ? watts : 0), ack: true, ts: now});
            h.states.set(`grid.L${p}.export`, {val: 0, ack: true, ts: now});
        }
        if (second % 10 === 0) h.states.set('tapo.power', {val: watts * 1000, ack: true, ts: now});
        await service.tick();
    }
    assert.equal(service.resultFor('tapo.power', 'mW').gridPhase, 3);
    assert.match(h.saved.get('Devices.Phases.Summary').val, /Trockner: L3/);
    assert.equal(service.devices[0].learner.votes.length, 3);
});

test('the initialization-time setting disables background learning even when configuration loaded after construction', async () => {
    const h = adapterFixture();
    const service = new AppliancePhases(h.adapter);
    h.adapter.config.appliancePhaseLearningEnabled = false;
    await service.initialize();
    assert.equal(h.timers.length, 0);
    assert.match(h.saved.get('Devices.Phases.Summary').val, /ausgeschaltet/);
});

test('fresh read-only calculated PV may guard learning with ack=false but cannot serve as device proof', async () => {
    const h = adapterFixture(), now = Date.now();
    h.mapping.DP_PV_POWER = 'javascript.0.pv';
    h.adapter.getForeignObjectAsync = async () => ({type: 'state', common: {type: 'number', role: 'value', unit: 'W'}});
    for (const id of Object.values(h.mapping)) h.states.set(id, {val: 0, ts: now, ack: true});
    h.states.set('tapo.power', {val: 0, ts: now, ack: true});
    h.states.set('javascript.0.pv', {val: 0, ts: now, ack: false});
    const service = new AppliancePhases(h.adapter);
    await service.initialize();
    assert.equal(service.readFrame(service.devices[0], now).guards[0].watts, 0);
    h.states.set('tapo.power', {val: 0, ts: now, ack: false});
    assert.match(service.readFrame(service.devices[0], now).reason, /Geräteleistung/);
    h.states.set('tapo.power', {val: 0, ts: now, ack: true});
    h.adapter.getForeignObjectAsync = async () => ({type: 'state', common: {type: 'number', role: 'value', unit: 'W', write: true}});
    const writable = new AppliancePhases(h.adapter);
    await writable.initialize();
    assert.match(writable.readFrame(writable.devices[0], now).reason, /PV/);
});
