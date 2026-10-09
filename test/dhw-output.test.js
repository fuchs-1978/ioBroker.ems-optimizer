'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const {SMA_GRID_MAX_AGE_MS} = require('../lib/source-diagnostics');

const context = vm.createContext({Math, SMA_GRID_MAX_AGE_MS, gridConstraints: require('../lib/grid-constraints')});
vm.runInContext(fs.readFileSync(
    path.join(__dirname, '../lib/engine/dhw-output.js'), 'utf8'), context);
const command = expression => vm.runInContext(expression, context);

test('stable positive AC THOR offset resumes only a normal ramp after fresh evidence', () => {
    const h = outputHarness();
    h.run('dhwLastCommandW=3394; dhwLastCommandAt=1999000; dhwOutputWasActive=true');
    for (let i = 0; i < 4; i++) {
        h.put('o1', 428); h.put('o2', 3316); h.put('o3', 0);
        h.tick(); h.complete();
        if (i < 3) assert.equal(h.commands().at(-1), 3394);
        h.advance(5000); h.fresh();
    }
    assert.equal(h.commands().at(-1), 4394);
    assert.match(h.states.get('ems.0.Devices.MyPV_DHW.ControlReason').val, /stabile positive/);
    assert.equal(h.states.get('ems.0.Devices.MyPV_DHW.ActuatorSettled').val, false);
    h.put('o1', 428); h.put('o2', 3316); h.tick();
    assert.equal(h.commands().at(-1), 4394, 'old lower response cannot authorize another increase');
});

for (const scenario of ['unchanged timestamps', 'oscillation', 'large overshoot', 'underresponse', 'bad quality', 'budget cap', 'net import', 'master off']) {
    test(`stable-offset recovery retains guards: ${scenario}`, () => {
        const h = outputHarness();
        h.run('dhwLastCommandW=3394; dhwLastCommandAt=1999000; dhwOutputWasActive=true');
        for (let i = 0; i < 4; i++) {
            if (scenario !== 'unchanged timestamps' || i === 0) {
                h.put('o1', scenario === 'large overshoot' ? 1000
                    : scenario === 'underresponse' ? 0
                        : scenario === 'oscillation' && i % 2 ? 580 : 428);
                h.put('o2', scenario === 'underresponse' ? 3000 : 3316);
                h.put('o3', 0);
            }
            if (scenario === 'bad quality') h.put('o2', 3316, {q: 64});
            if (scenario === 'budget cap') h.own('Control.Targets.MyPV_DHW_W', 3200);
            if (scenario === 'net import') { h.put('gridOut', 0); h.put('gridIn', 1000); }
            if (scenario === 'master off') h.own('System.RealOutputsEnabled', false);
            h.tick(); h.complete(); h.advance(5000);
            if (scenario !== 'unchanged timestamps') h.fresh();
            else { h.own('System.LastUpdate', 2000000 + (i + 1) * 5000); h.own('Control.LastUpdate', 2000000 + (i + 1) * 5000); }
        }
        assert.ok(h.commands().every(w => w <= 3394));
    });
}

function phaseLimit(direction) {
    const now = Date.now();
    const states = new Map();
    const put = (id, val) => states.set(id, {val, ts: now, ack: true});
    ['o1', 'o2', 'o3'].forEach(id => put(id, 0));
    ['h1', 'h2', 'h3'].forEach(id => put(id, 49));
    if (direction) {
        ['pi1', 'pi2', 'pi3'].forEach(id => put(id, direction === 'import' ? 11270 : 0));
        ['pe1', 'pe2', 'pe3'].forEach(id => put(id, direction === 'export' ? 11270 : 0));
    }
    const ctx = vm.createContext({Math, Date, SMA_GRID_MAX_AGE_MS, gridConstraints: require('../lib/grid-constraints'),
        CFG: {root: 'ems.0', dataMaxAgeMs: 120000, dp: {
            myPvDhwHaCurrentA: ['h1','h2','h3'], myPvDhwOutputW: ['o1','o2','o3'],
            haPhaseImportW: direction ? ['pi1','pi2','pi3'] : [],
            haPhaseExportW: direction ? ['pe1','pe2','pe3'] : []}},
        existsState: id => states.has(id), getState: id => states.get(id),
        readNumber: (id, fallback) => id === 'ems.0.Config.HouseConnectionWorkingLimit_A' ? 46
            : id === 'ems.0.Config.DHWHouseConnectionLimit_A' ? 50 : fallback});
    vm.runInContext(fs.readFileSync(path.join(__dirname, '../lib/engine/dhw-output.js'), 'utf8'), ctx);
    return vm.runInContext('phaseLimitedDhwPower(3000)', ctx);
}

test('combined EHZ relinquishes a reduced allocation immediately', () => {
    assert.equal(command('limitedDhwCommand(3000, 5000, 3000, 0, 5000)'), 3000);
    assert.equal(command('limitedDhwCommand(3000, 5000, 3000, 200, 4800)'), 3000);
});

test('EHZ increases are ramped but import reductions are immediate', () => {
    assert.equal(command('limitedDhwCommand(6000, 3000, 6000, 500, 5000)'), 3500);
    assert.equal(command('limitedDhwCommand(6000, 3000, 6000, 500, 1000)'), 1000);
});

function outputHarness({combined = false, simulate = false, directional = false} = {}) {
    let now = 2000000;
    const states = new Map();
    const writes = [];
    const pending = [];
    const put = (id, val, extra = {}) => states.set(id, {val, ts: now, ack: true, ...extra});
    const own = (id, val, extra) => put(`ems.0.${id}`, val, extra);
    for (const id of ['System.RealOutputsEnabled', 'System.DataValid', 'Control.Valid',
        'Devices.MyPV_DHW.Present', 'Devices.MyPV_DHW.ControlEnabled', 'Devices.MyPV_DHW.Release']) own(id, true);
    own('System.LastUpdate', now);
    own('Control.LastUpdate', now);
    own('Control.Targets.MyPV_DHW_W', 9000);
    own('Devices.MyPV_DHW.TemperaturePowerLimit_W', 9000);
    own('Config.DHWCommissioningMaxPower_W', 9000);
    own('Config.DHWParallelDistributionEnabled', true);
    own('Devices.Wallbox0.ControlEnabled', combined);
    own('Devices.Wallbox0.Present', combined);
    for (const id of ['o1', 'o2', 'o3', 'h1', 'h2', 'h3', 'gridIn']) put(id, 0);
    if (directional) for (const phase of [1, 2, 3]) {
        put(`pi${phase}`, 0); put(`pe${phase}`, 0);
    }
    ['t1', 't2', 't3', 't4', 'outlet'].forEach(id => put(id, 50));
    put('connection', true);
    put('gridOut', 6100);
    put('split', true);
    const nativeConfig = {combinedProductionArmed: true, wb0ProductionArmed: true};
    const consumptionLimit = {valid: true, active: false, budgetW: null};
    const ctx = vm.createContext({Math, Date: {now: () => now}, SMA_GRID_MAX_AGE_MS,
        gridConstraints: require('../lib/grid-constraints'), nativeConfig,
        CFG: {root: 'ems.0', dataMaxAgeMs: 120000, limits: {myPvDhwMaxW: 9000}, dp: {
            myPvDhwHaCurrentA: ['h1', 'h2', 'h3'], myPvDhwOutputW: ['o1', 'o2', 'o3'],
            haPhaseImportW: directional ? ['pi1', 'pi2', 'pi3'] : [],
            haPhaseExportW: directional ? ['pe1', 'pe2', 'pe3'] : [],
            dhwTemps: ['t1', 't2', 't3', 't4'], myPvDhwOutletTemp: 'outlet',
            myPvDhwConnection: 'connection', myPvDhwSetpoint: 'setpoint',
            myPvDhwActualMirror: 'mirror', gridImport: 'gridIn', gridExport: 'gridOut',
            dhwParallelRelease: 'split', wallboxesKW: ['wb0power', 'wb1power', 'wb2power']}},
        currentConsumptionLimit: () => consumptionLimit,
        existsState: id => states.has(id), getState: id => states.get(id),
        readNumber: (id, fallback) => states.has(id) ? Number(states.get(id).val) : fallback,
        readBooleanInput: id => states.has(id) ? states.get(id).val : null,
        write: (id, val) => put(id, val),
        writeForeignState: (id, val, callback) => {
            writes.push({id, val, at: now});
            if (callback) pending.push(callback);
            return true;
        }});
    if (simulate) vm.runInContext(fs.readFileSync(
        path.join(__dirname, '../lib/engine/dhw-controller.js'), 'utf8'), ctx);
    vm.runInContext(fs.readFileSync(path.join(__dirname, '../lib/engine/dhw-output.js'), 'utf8'), ctx);
    return {states, writes, pending, put, own, nativeConfig, consumptionLimit,
        run: code => vm.runInContext(code, ctx),
        tick: () => vm.runInContext('updateDhwProductionOutput()', ctx),
        advance: ms => {now += ms;},
        fresh: () => {
            for (const value of states.values()) value.ts = now;
            own('System.LastUpdate', now);
            own('Control.LastUpdate', now);
        },
        complete: error => { for (const callback of pending.splice(0)) callback(error || null); },
        commands: () => writes.filter(item => item.id === 'setpoint').map(item => item.val)
    };
}

test('DHW direct-grid contract accepts SMA samples through thirty seconds and retains invalid-feedback gates', () => {
    for (const id of ['gridIn', 'gridOut']) for (const ageMs of [10000, 16000, 29999, 30000, 30001]) {
        const h = outputHarness();
        h.put(id, 0, {ts: 2000000 - ageMs});
        assert.equal(h.run('directGridPowerW()') !== null, ageMs <= 30000, `${id}: ${ageMs}`);
    }
    for (const id of ['gridIn', 'gridOut']) for (const invalid of ['missing', {val: null}, {ack: false}, {q: 64}]) {
        const h = outputHarness();
        h.put(id, 0, invalid === 'missing' ? {} : invalid);
        if (invalid === 'missing') h.states.delete(id);
        assert.equal(h.run('directGridPowerW()'), null);
    }
});

test('DHW house-phase import, export and fallback current share the thirty-second SMA boundary', () => {
    for (const directional of [true, false]) {
        const ids = directional ? ['pi1', 'pe1', 'pi2', 'pe2', 'pi3', 'pe3'] : ['h1', 'h2', 'h3'];
        for (const id of ids) for (const ageMs of [16000, 29999, 30000, 30001]) {
            const h = outputHarness({directional});
            h.put(id, 0, {ts: 2000000 - ageMs, ack: true, q: 0});
            assert.equal(h.run('phaseLimitedDhwPower(3000)'), ageMs <= 30000 ? 3000 : 0, `${id}: ${ageMs}`);
        }
        const invalidValues = [{val: null}, {ack: false}, {q: 64}, ...(directional ? [{val: -1}] : [])];
        for (const id of ids) for (const invalid of invalidValues) {
            const h = outputHarness({directional});
            h.put(id, 0, {ts: 1984000, ack: true, q: 0, ...invalid});
            assert.equal(h.run('phaseLimitedDhwPower(3000)'), 0, `${id}: ${JSON.stringify(invalid)}`);
        }
    }
});

test('a running DHW heater accepts older valid SMA telemetry but relinquishes output beyond thirty seconds', () => {
    for (const directional of [true, false]) {
        const phaseIds = directional ? ['pi1', 'pe1', 'pi2', 'pe2', 'pi3', 'pe3'] : ['h1', 'h2', 'h3'];
        for (const id of ['gridIn', 'gridOut', ...phaseIds]) for (const ageMs of [16000, 30000, 30001]) {
            const h = outputHarness({directional});
            h.run('dhwLastCommandW=3000; dhwLastCommandAt=1999000; dhwOutputWasActive=true');
            h.put('o1', 3000);
            h.put(id, id === 'gridOut' ? 6100 : 0, {ts: 2000000 - ageMs, ack: true, q: 0});
            h.tick(); h.complete();
            assert.equal(h.commands().at(-1) > 0, ageMs <= 30000, `${id}: ${ageMs}`);
            if (ageMs > 30000) assert.equal(h.commands().at(-1), 0, 'stale SMA data cannot continue a heater output');
        }
    }
});

test('issue110 fresh zero outputs and NULL setpoint cannot erase an unseen rise, including after restart', () => {
    const first = outputHarness(); first.tick(); first.complete();
    first.own('Control.Targets.MyPV_DHW_W', 0);
    first.put('setpoint', null); first.tick(); first.complete();
    first.advance(1000); first.fresh(); first.put('setpoint', null); first.tick(); first.complete();
    const assertPending = h => {
        const r = JSON.parse(h.states.get('ems.0.Devices.MyPV_DHW.OutputReservationState_JSON').val);
        assert.deepEqual(r.highW, [3000, 0, 0]);
        assert.deepEqual(r.seenAt, [0, 0, 0]);
        assert.deepEqual(r.commandW, [0, 0, 0]);
        assert.equal(h.states.get('ems.0.Devices.MyPV_DHW.OutputReservationPending').val, true);
        assert.equal(h.states.get('setpoint').val, null);
        for (const id of ['o1', 'o2', 'o3']) assert.equal(h.states.get(id).val, 0);
    };
    assertPending(first);
    const restarted = outputHarness();
    for (const [id, state] of first.states) restarted.states.set(id, {...state});
    restarted.advance(2000); restarted.fresh(); restarted.tick(); restarted.complete();
    assertPending(restarted);
});

test('DHW reservation witnesses each phase fully, rejects NULL proof and retains a renewed rise', () => {
    const h = outputHarness();
    h.run("reserveHeaterCommand('MyPV_DHW', 6000, ['o1','o2','o3'], 3000)");
    h.advance(10); h.put('o1', 1500); h.put('o2', 3000);
    h.run("refreshHeaterReservation('MyPV_DHW', ['o1','o2','o3'], 3000)");
    h.run("reserveHeaterCommand('MyPV_DHW', 0, ['o1','o2','o3'], 3000); heaterZeroWriteCompleted('MyPV_DHW', ['o1','o2','o3'], 3000)");
    h.advance(10); h.put('o1', 0); h.put('o2', null);
    h.run("refreshHeaterReservation('MyPV_DHW', ['o1','o2','o3'], 3000)");
    const record = () => JSON.parse(h.states.get('ems.0.Devices.MyPV_DHW.OutputReservationState_JSON').val);
    assert.deepEqual(record().highW, [3000, 3000, 0]);
    h.advance(10); h.put('o2', 0);
    h.run("refreshHeaterReservation('MyPV_DHW', ['o1','o2','o3'], 3000)");
    assert.deepEqual(record().highW, [3000, 0, 0]);
    h.run("reserveHeaterCommand('MyPV_DHW', 3000, ['o1','o2','o3'], 3000)");
    assert.equal(record().seenAt[0], 0, 'new load needs its own electrical proof');
    h.advance(10); h.put('o1', 3000);
    h.run("refreshHeaterReservation('MyPV_DHW', ['o1','o2','o3'], 3000); reserveHeaterCommand('MyPV_DHW', 0, ['o1','o2','o3'], 3000); heaterZeroWriteCompleted('MyPV_DHW', ['o1','o2','o3'], 3000)");
    h.advance(10); h.put('o1', 0);
    h.run("refreshHeaterReservation('MyPV_DHW', ['o1','o2','o3'], 3000)");
    assert.deepEqual(record().highW, [0, 0, 0]);
});

test('issue123 identical zero completions cannot move the physical reduction proof boundary', () => {
    const h = outputHarness();
    h.run("reserveHeaterCommand('MyPV_DHW', 3000, ['o1','o2','o3'], 3000)");
    h.advance(1000); h.put('o1', 3000);
    h.run("refreshHeaterReservation('MyPV_DHW', ['o1','o2','o3'], 3000)");
    h.advance(1000);
    h.run("reserveHeaterCommand('MyPV_DHW', 0, ['o1','o2','o3'], 3000); heaterZeroWriteCompleted('MyPV_DHW', ['o1','o2','o3'], 3000)");
    const record = () => JSON.parse(h.states.get('ems.0.Devices.MyPV_DHW.OutputReservationState_JSON').val);
    const firstZeroCompletion = record().zeroWriteAt;
    h.advance(5000);
    h.run("reserveHeaterCommand('MyPV_DHW', 0, ['o1','o2','o3'], 3000); heaterZeroWriteCompleted('MyPV_DHW', ['o1','o2','o3'], 3000)");
    assert.equal(record().zeroWriteAt, firstZeroCompletion);
    for (const id of ['o1', 'o2', 'o3']) h.put(id, 0, {ts: firstZeroCompletion + 4500});
    h.put('setpoint', null);
    h.run("refreshHeaterReservation('MyPV_DHW', ['o1','o2','o3'], 3000)");
    assert.deepEqual(record().highW, [0, 0, 0], 'confirmed later physical reduction settles despite NULL setpoint');
});

test('issue123 a stale peak cannot witness a newly reserved positive command', () => {
    const h = outputHarness();
    h.put('o1', 3000, {ts: 1999999});
    h.run("reserveHeaterCommand('MyPV_DHW', 3000, ['o1','o2','o3'], 3000); refreshHeaterReservation('MyPV_DHW', ['o1','o2','o3'], 3000)");
    const record = () => JSON.parse(h.states.get('ems.0.Devices.MyPV_DHW.OutputReservationState_JSON').val);
    assert.equal(record().seenAt[0], 0);
    h.advance(1000);
    h.run("reserveHeaterCommand('MyPV_DHW', 0, ['o1','o2','o3'], 3000); heaterZeroWriteCompleted('MyPV_DHW', ['o1','o2','o3'], 3000)");
    h.advance(30000); h.fresh();
    for (const id of ['o1', 'o2', 'o3']) h.put(id, 0);
    h.run("refreshHeaterReservation('MyPV_DHW', ['o1','o2','o3'], 3000)");
    assert.deepEqual(record().highW, [3000, 0, 0], 'timeout plus fresh zero cannot cancel an unseen rise');
});

test('issue123 positive dispatch invalidates zero proof even within the same millisecond', () => {
    const h = outputHarness();
    h.run("reserveHeaterCommand('MyPV_DHW', 3000, ['o1','o2','o3'], 3000); reserveHeaterCommand('MyPV_DHW', 0, ['o1','o2','o3'], 3000); heaterZeroWriteCompleted('MyPV_DHW', ['o1','o2','o3'], 3000)");
    const record = () => JSON.parse(h.states.get('ems.0.Devices.MyPV_DHW.OutputReservationState_JSON').val);
    assert.equal(record().zeroWriteAt, 2000000);
    h.run("reserveHeaterCommand('MyPV_DHW', 3000, ['o1','o2','o3'], 3000); reserveHeaterCommand('MyPV_DHW', 0, ['o1','o2','o3'], 3000)");
    h.advance(1000); h.put('o1', 3000);
    h.run("refreshHeaterReservation('MyPV_DHW', ['o1','o2','o3'], 3000)");
    h.advance(1000); h.put('o1', 0);
    h.run("refreshHeaterReservation('MyPV_DHW', ['o1','o2','o3'], 3000)");
    assert.deepEqual(record().highW, [3000, 0, 0], 'second stop needs its own successful completion');
    h.run("heaterZeroWriteCompleted('MyPV_DHW', ['o1','o2','o3'], 3000)");
    h.advance(1000); h.put('o1', 0);
    h.run("refreshHeaterReservation('MyPV_DHW', ['o1','o2','o3'], 3000)");
    assert.deepEqual(record().highW, [0, 0, 0]);
});

test('issue123 restart cannot reuse persisted zero completion to release a reservation', () => {
    const first = outputHarness();
    first.run("reserveHeaterCommand('MyPV_DHW', 3000, ['o1','o2','o3'], 3000)");
    first.advance(1000); first.put('o1', 3000);
    first.run("refreshHeaterReservation('MyPV_DHW', ['o1','o2','o3'], 3000); reserveHeaterCommand('MyPV_DHW', 0, ['o1','o2','o3'], 3000); heaterZeroWriteCompleted('MyPV_DHW', ['o1','o2','o3'], 3000)");
    const h = outputHarness();
    for (const [id, state] of first.states) h.states.set(id, {...state});
    h.advance(3000); h.fresh();
    for (const id of ['o1', 'o2', 'o3']) h.put(id, 0);
    h.run("refreshHeaterReservation('MyPV_DHW', ['o1','o2','o3'], 3000)");
    const record = () => JSON.parse(h.states.get('ems.0.Devices.MyPV_DHW.OutputReservationState_JSON').val);
    assert.deepEqual(record().highW, [3000, 0, 0]);
    h.run("heaterZeroWriteCompleted('MyPV_DHW', ['o1','o2','o3'], 3000)");
    h.advance(1000); h.fresh();
    h.run("refreshHeaterReservation('MyPV_DHW', ['o1','o2','o3'], 3000)");
    assert.deepEqual(record().highW, [0, 0, 0]);
});

for (const invalid of [{ack: false}, {ack: undefined}, {q: 64}, {val: null}, {ts: 3000000}]) {
    test(`issue123 invalid peak is not physical proof: ${JSON.stringify(invalid)}`, () => {
        const h = outputHarness();
        h.run("reserveHeaterCommand('MyPV_DHW', 3000, ['o1','o2','o3'], 3000)");
        h.advance(1000); h.put('o1', 3000, invalid);
        h.run("refreshHeaterReservation('MyPV_DHW', ['o1','o2','o3'], 3000)");
        const record = JSON.parse(h.states.get('ems.0.Devices.MyPV_DHW.OutputReservationState_JSON').val);
        assert.equal(record.seenAt[0], 0);
    });
    test(`issue123 invalid zero is not physical reduction proof: ${JSON.stringify(invalid)}`, () => {
        const h = outputHarness();
        h.run("reserveHeaterCommand('MyPV_DHW', 3000, ['o1','o2','o3'], 3000)");
        h.advance(1000); h.put('o1', 3000);
        h.run("refreshHeaterReservation('MyPV_DHW', ['o1','o2','o3'], 3000); reserveHeaterCommand('MyPV_DHW', 0, ['o1','o2','o3'], 3000); heaterZeroWriteCompleted('MyPV_DHW', ['o1','o2','o3'], 3000)");
        h.advance(1000); h.put('o1', 0, invalid);
        h.run("refreshHeaterReservation('MyPV_DHW', ['o1','o2','o3'], 3000)");
        const record = JSON.parse(h.states.get('ems.0.Devices.MyPV_DHW.OutputReservationState_JSON').val);
        assert.deepEqual(record.highW, [3000, 0, 0]);
    });
}

test('issue123 recovered zero-time record requires a real zero completion even for manual confirmation', () => {
    const h = outputHarness();
    h.own('Devices.MyPV_DHW.OutputReservedPhase1_W', 3000);
    h.own('Devices.MyPV_DHW.OutputReservationState_JSON', JSON.stringify({
        highW: [3000, 0, 0], seenAt: [1999000, 0, 0], commandW: [0, 0, 0], commandAt: 0,
        ids: ['o1', 'o2', 'o3'], sinkId: 'setpoint'}));
    h.nativeConfig.globalWriteEnabled = false;
    h.own('System.RealOutputsEnabled', false);
    h.own('Devices.MyPV_DHW.ConfirmPhysicalStop', true, {ack: false});
    h.run("refreshHeaterReservation('MyPV_DHW', ['o1','o2','o3'], 3000)");
    const record = () => JSON.parse(h.states.get('ems.0.Devices.MyPV_DHW.OutputReservationState_JSON').val);
    assert.deepEqual(record().highW, [3000, 0, 0]);
    h.run("refreshHeaterReservation('MyPV_DHW', ['o1','o2','o3'], 3000)");
    assert.deepEqual(record().highW, [3000, 0, 0], 'automatic zero release also rejects the sentinel timestamp');
});

test('issue123 shared heating reservation retains identical zero completion and rejects an unseen rise', () => {
    const h = outputHarness();
    h.nativeConfig.heatingSetpointId = 'hk-setpoint';
    h.run("reserveHeaterCommand('MyPV_Heating', 2000, ['o1','o2','o3'], 2000)");
    h.advance(1000); h.put('o1', 2000);
    h.run("refreshHeaterReservation('MyPV_Heating', ['o1','o2','o3'], 2000); reserveHeaterCommand('MyPV_Heating', 0, ['o1','o2','o3'], 2000); heaterZeroWriteCompleted('MyPV_Heating', ['o1','o2','o3'], 2000)");
    const record = () => JSON.parse(h.states.get('ems.0.Devices.MyPV_Heating.OutputReservationState_JSON').val);
    const firstZero = record().zeroWriteAt;
    h.advance(5000);
    h.run("heaterZeroWriteCompleted('MyPV_Heating', ['o1','o2','o3'], 2000)");
    h.put('o1', 0, {ts: firstZero + 4500});
    h.run("refreshHeaterReservation('MyPV_Heating', ['o1','o2','o3'], 2000)");
    assert.deepEqual(record().highW, [0, 0, 0]);
    h.run("reserveHeaterCommand('MyPV_Heating', 2000, ['o1','o2','o3'], 2000); reserveHeaterCommand('MyPV_Heating', 0, ['o1','o2','o3'], 2000); heaterZeroWriteCompleted('MyPV_Heating', ['o1','o2','o3'], 2000)");
    h.advance(30000); h.fresh();
    h.run("refreshHeaterReservation('MyPV_Heating', ['o1','o2','o3'], 2000)");
    assert.deepEqual(record().highW, [2000, 0, 0]);
});

test('issue123 obsolete zero callback cannot restore proof after a new positive command', () => {
    const h = outputHarness(); h.tick(); h.complete();
    h.own('Control.Targets.MyPV_DHW_W', 0); h.advance(1000); h.fresh(); h.tick();
    h.complete(); h.advance(1000); h.fresh(); h.tick();
    const obsoleteZero = h.pending.shift();
    h.own('Control.Targets.MyPV_DHW_W', 9000); h.advance(1000); h.fresh(); h.tick();
    obsoleteZero(null);
    const record = JSON.parse(h.states.get('ems.0.Devices.MyPV_DHW.OutputReservationState_JSON').val);
    assert.deepEqual(record.commandW, [3000, 0, 0]);
    assert.equal(record.zeroWriteAt, 0);
});

test('issue123 reservation status identifies missing full effect and unknown setpoint without unlocking', () => {
    const h = outputHarness(); h.tick(); h.complete();
    h.own('Control.Targets.MyPV_DHW_W', 0); h.put('setpoint', null); h.tick(); h.complete();
    const status = h.states.get('ems.0.Devices.MyPV_DHW.OutputReservationStatus').val;
    assert.match(status, /transportseitig abgeschlossen/);
    assert.match(status, /volle fruehere Stellwirkung auf Phase 1 fehlt/);
    assert.match(status, /Sollrueckmeldung fehlt\/NULL/);
    assert.equal(h.states.get('ems.0.Devices.MyPV_DHW.OutputReservationPending').val, true);
});

test('issue123 delayed full-effect sample between rise and zero can complete its chronological reduction', () => {
    const h = outputHarness();
    h.run("reserveHeaterCommand('MyPV_DHW', 3000, ['o1','o2','o3'], 3000)");
    h.advance(1000);
    h.run("reserveHeaterCommand('MyPV_DHW', 0, ['o1','o2','o3'], 3000); heaterZeroWriteCompleted('MyPV_DHW', ['o1','o2','o3'], 3000)");
    h.advance(1000); h.put('o1', 3000, {ts: 2000500});
    h.run("refreshHeaterReservation('MyPV_DHW', ['o1','o2','o3'], 3000)");
    const record = () => JSON.parse(h.states.get('ems.0.Devices.MyPV_DHW.OutputReservationState_JSON').val);
    assert.equal(record().seenAt[0], 2000500);
    assert.deepEqual(record().riseAt, [2000000, 0, 0]);
    h.advance(1000);
    for (const id of ['o1', 'o2', 'o3']) h.put(id, 0);
    h.run("refreshHeaterReservation('MyPV_DHW', ['o1','o2','o3'], 3000)");
    assert.deepEqual(record().highW, [0, 0, 0]);
});

test('issue123 zero completion from a different written sink cannot prove the reserved output stopped', () => {
    const h = outputHarness();
    h.run("reserveHeaterCommand('MyPV_DHW', 3000, ['o1','o2','o3'], 3000)");
    h.advance(1000); h.put('o1', 3000);
    h.run("refreshHeaterReservation('MyPV_DHW', ['o1','o2','o3'], 3000); reserveHeaterCommand('MyPV_DHW', 0, ['o1','o2','o3'], 3000); heaterZeroWriteCompleted('MyPV_DHW', ['o1','o2','o3'], 3000, 'other-setpoint')");
    h.advance(1000); h.put('o1', 0);
    h.run("refreshHeaterReservation('MyPV_DHW', ['o1','o2','o3'], 3000)");
    const record = JSON.parse(h.states.get('ems.0.Devices.MyPV_DHW.OutputReservationState_JSON').val);
    assert.equal(record.zeroWriteAt, 0);
    assert.deepEqual(record.highW, [3000, 0, 0]);
});

test('issue123 a mapping change discards old zero completion even with an already free reservation', () => {
    const h = outputHarness();
    h.run("reserveHeaterCommand('MyPV_DHW', 0, ['o1','o2','o3'], 3000); heaterZeroWriteCompleted('MyPV_DHW', ['o1','o2','o3'], 3000)");
    h.run("CFG.dp.myPvDhwSetpoint='newSet'; reserveHeaterCommand('MyPV_DHW', 0, ['new1','new2','new3'], 3000)");
    const record = JSON.parse(h.states.get('ems.0.Devices.MyPV_DHW.OutputReservationState_JSON').val);
    assert.equal(record.zeroWriteAt, 0);
    assert.equal(record.sinkId, 'newSet');
    assert.deepEqual(record.ids, ['new1', 'new2', 'new3']);
});

for (const sensor of ['t1', 't2', 't3', 't4', 'outlet']) {
    for (const invalid of [-127, -0.1, 100.1, 65535]) {
        test(`DHW blocks implausible ${sensor}=${invalid} in simulation and productive output`, () => {
            for (const simulate of [true, false]) {
                const h = outputHarness({simulate});
                h.put(sensor, invalid);
                if (simulate) {
                    assert.equal(h.run('evaluateDhwSimulation().valid'), false);
                    assert.equal(h.run('evaluateDhwSimulation().release'), false);
                }
                h.tick();
                assert.ok(h.commands().every(value => value === 0));
            }
        });
    }
}

test('DHW accepts plausible temperature boundaries and stops an already owned heater on sensor failure', () => {
    const h = outputHarness({simulate: true});
    for (const value of [0, 100]) {
        h.put('outlet', value);
        assert.equal(h.run('evaluateDhwSimulation().valid'), true);
    }
    h.put('outlet', 50);
    h.tick();
    assert.deepEqual(h.commands(), [3000]);
    h.put('t2', -127);
    h.tick();
    assert.deepEqual(h.commands(), [3000, 0]);
});

for (const [stop, resume] of [[76, 80], [76, 76], [101, 75.5], [76, -1], [NaN, 75.5]]) {
    test(`DHW rejects invalid hysteresis stop=${stop}, resume=${resume}`, () => {
        const h = outputHarness({simulate: true});
        h.own('Config.DHWControllerStopTemperature_C', stop);
        h.own('Config.DHWControllerResumeTemperature_C', resume);
        ['t1', 't2', 't3', 't4'].forEach(id => h.put(id, 77));
        const status = h.run('evaluateDhwSimulation()');
        assert.equal(status.release, false);
        assert.equal(status.temperaturePowerLimitW, 0);
        assert.match(status.reason, /konfiguration ungueltig/);
        h.tick();
        assert.ok(h.commands().every(value => value === 0));
    });
}

test('DHW hysteresis retains shutdown until valid resume, including after configuration repair', () => {
    const h = outputHarness({simulate: true});
    h.put('t1', 76);
    assert.equal(h.run('evaluateDhwSimulation().release'), false);
    h.put('t1', 75.7);
    assert.equal(h.run('evaluateDhwSimulation().release'), false);
    h.put('t1', 75.5);
    assert.equal(h.run('evaluateDhwSimulation().release'), true);
    h.own('Config.DHWControllerResumeTemperature_C', 80);
    assert.equal(h.run('evaluateDhwSimulation().release'), false);
    h.own('Config.DHWControllerResumeTemperature_C', 75.5);
    assert.equal(h.run('evaluateDhwSimulation().release'), true);
});

for (const [label, value, extra] of [
    ['missing', undefined, {}], ['NULL', null, {}], ['active', true, {}],
    ['unknown string', 'unknown', {}], ['unacknowledged', false, {ack: false}],
    ['missing ack', false, {ack: undefined}], ['bad quality', false, {q: 128}]
]) {
    test(`DHW fails closed on configured protection signal: ${label}`, () => {
        const h = outputHarness({simulate: true});
        h.run("CFG.dp.haCritical='ha-critical'");
        if (value !== undefined) h.put('ha-critical', value, extra);
        h.tick();
        assert.ok(h.commands().every(watts => watts === 0));
        assert.match(h.states.get('ems.0.Devices.MyPV_DHW.OutputStatus').val, /Hausanschlussschutz/);
    });
}

test('DHW accepts retained acknowledged inactive protection and stops when it becomes unknown', () => {
    for (const value of [false, 0, '0']) {
        const h = outputHarness({simulate: true});
        h.run("CFG.dp.haCritical='ha-critical'");
        h.put('ha-critical', value, {ts: 1, q: 0});
        h.tick();
        assert.deepEqual(h.commands(), [3000]);
        h.states.delete('ha-critical');
        h.tick();
        assert.deepEqual(h.commands(), [3000, 0]);
    }
});

test('turning the external 50/50 switch off preserves combined EHZ residual regulation', () => {
    const h = outputHarness({combined: true});
    h.put('split', false);
    h.tick();
    assert.deepEqual(h.commands(), [3000]);
    assert.equal(h.run('dhwCombinedProductionState().allowed'), true);
    h.nativeConfig.combinedProductionArmed = false;
    h.tick();
    assert.deepEqual(h.commands(), [3000, 0]);
});

test('productive allocation has one physical ramp, reduces immediately and obeys stratification', () => {
    const h = outputHarness({simulate: true});
    assert.equal(h.run('simulateDhwTarget(8000)'), 8000);
    assert.equal(h.run('simulateDhwTarget(1200)'), 1200);
    assert.equal(h.run('simulateDhwTarget(0)'), 0);
    h.put('t4', 72);
    assert.equal(h.run('simulateDhwTarget(800)'), 0);
    h.own('System.RealOutputsEnabled', false);
    assert.equal(h.run('simulateDhwTarget(8000)'), 3000);
    assert.equal(h.run('simulateDhwTarget(1000)'), 1000);
});

test('standalone EHZ cannot exceed its allocator budget even under larger export', () => {
    const h = outputHarness();
    h.own('Control.Targets.MyPV_DHW_W', 1500);
    h.tick();
    assert.deepEqual(h.commands(), [1500]);
});

test('DHW follows central budget when battery owns fine regulation or grid import is intentional', () => {
    const h = outputHarness();
    h.run('heaterUsesGridFeedback = () => false');
    h.put('gridOut', 0); h.put('gridIn', 3000);
    h.own('Control.Targets.MyPV_DHW_W', 4000);
    h.tick(); h.complete();
    assert.deepEqual(h.commands(), [1000]);
    h.put('o1', 1000); h.tick(); h.complete();
    assert.deepEqual(h.commands(), [1000, 2000]);
    h.run('heaterUsesGridFeedback = () => true');
    h.tick(); h.complete();
    assert.equal(h.commands().at(-1), 0, 'single EHZ fallback reacquires its NVP loop');
});

test('DHW coordinated LPC cap reserves pending HK, battery and wallbox commands', () => {
    const h = outputHarness();
    h.consumptionLimit.active = true; h.consumptionLimit.budgetW = 4200;
    h.run(`coordinatedEnergyEnabled = () => true;
        coordinatedPhaseReservations = () => ({valid:true,otherW:[0,0,0]});
        coordinatedConsumptionLoads = () => ({valid: true,totalW:3700,dhwW:0,
            heatingW:2000,batteryW:320,wallboxW:1380,wallboxesW:[1380,0,0]});
        heaterUsesGridFeedback = () => false;`);
    h.tick(); h.complete();
    assert.deepEqual(h.commands(), [500]);
    h.run('coordinatedConsumptionLoads = () => ({valid:false})');
    h.tick(); h.complete();
    assert.deepEqual(h.commands(), [500, 0]);
});

test('DHW cannot report NoActuation while the independent heating or battery output is owned', () => {
    const h = outputHarness();
    h.own('System.RealOutputsEnabled', false);
    h.own('Devices.MyPV_Heating.OutputOwned', true);
    h.tick();
    assert.equal(h.states.get('ems.0.System.NoActuation').val, false);
    assert.equal(h.states.get('ems.0.Control.Mode').val, 'ALPHA_ENERGY_COORDINATED');
});

test('DHW actively reduces an existing load when its house phase exceeds the working limit', () => {
    const h = outputHarness();
    h.run('dhwLastCommandW=2000;dhwOutputWasActive=true;');
    h.own('Control.Targets.MyPV_DHW_W', 2000);
    h.put('o1', 2000); h.put('h1', 52);
    h.own('Config.HouseConnectionWorkingLimit_A', 46);
    h.tick(); h.complete();
    assert.deepEqual(h.commands(), [620]);
});

test('DHW does not reuse phase headroom already reserved by a pending HK command', () => {
    const h = outputHarness();
    h.put('h1', 45); h.own('Config.HouseConnectionWorkingLimit_A', 46);
    h.run(`coordinatedEnergyEnabled=()=>true;
        coordinatedPhaseReservations=()=>({valid:true,otherW:[200,0,0]});`);
    h.tick(); h.complete();
    assert.deepEqual(h.commands(), [30]);
});

test('EHZ starts promptly and cannot wind up on unchanged actuator feedback after timeout', () => {
    const h = outputHarness();
    h.tick();
    h.complete();
    assert.deepEqual(h.commands(), [3000]);
    h.advance(16000);
    h.fresh();
    h.tick();
    h.complete();
    assert.deepEqual(h.commands(), [3000, 3000]);
    assert.match(h.states.get('ems.0.Devices.MyPV_DHW.ControlReason').val, /keine weitere Erhoehung/);
    h.put('o1', 3000);
    h.put('gridOut', 3100);
    h.advance(5000);
    h.fresh();
    h.tick();
    assert.deepEqual(h.commands(), [3000, 3000, 6000]);
});

test('net import never reverses an EHZ reduction while the old measured load is still high', () => {
    const h = outputHarness();
    h.run('dhwLastCommandW = 3000; dhwOutputWasActive = true;');
    h.put('o1', 3000);
    h.put('o2', 3000);
    h.put('gridOut', 0);
    h.put('gridIn', 1000);
    h.tick();
    assert.deepEqual(h.commands(), [3000]);
    h.complete();
    h.put('gridIn', 5000);
    h.tick();
    assert.deepEqual(h.commands(), [3000, 900]);
});

test('master disable sends zero once but retains physical reservations without falsifying measured output', () => {
    const h = outputHarness();
    h.tick();
    h.complete();
    h.put('o1', 3000);
    h.put('gridOut', 3100);
    h.tick();
    h.complete();
    assert.equal(h.writes.filter(item => item.id === 'mirror').at(-1).val, 3000);
    h.own('System.RealOutputsEnabled', false);
    h.tick();
    h.tick();
    assert.equal(h.run('hasOwnedDhwOutput()'), true, 'zero write is still pending');
    const stoppedWrites = h.writes.length;
    assert.deepEqual(h.commands(), [3000, 6000, 0]);
    h.complete();
    h.tick();
    h.run('stopDhwOutput("Adapter wird beendet")');
    assert.equal(h.run('hasOwnedDhwOutput()'), true, 'database zero acknowledgement is not physical stop proof');
    h.advance(8000); h.put('o1', 3000); h.put('o2', 3000); h.tick();
    h.advance(1000); h.put('o1', 0); h.put('o2', 0); h.tick();
    assert.equal(h.run('hasOwnedDhwOutput()'), false, 'delayed peak and subsequent real zero settle the reservation');
    assert.equal(h.writes.length, stoppedWrites);
    assert.equal(h.writes.filter(item => item.id === 'mirror').at(-1).val, 3000);
});

test('unclean restart with disabled master stops only the previously EMS-owned heater once', () => {
    for (const legacy of [false, true]) {
        const h = outputHarness();
        h.own('Devices.MyPV_DHW.OutputOwned', !legacy);
        h.own('Devices.MyPV_DHW.OutputActive', true);
        h.own('Devices.MyPV_DHW.OutputCommand_W', 6000);
        h.own('Devices.MyPV_DHW.OutputLastWrite', 1900000);
        h.own('System.RealOutputsEnabled', false);
        h.tick();
        h.tick();
        assert.deepEqual(h.commands(), [0]);
        h.complete();
        h.run('stopDhwOutput("Startup failure")');
        assert.deepEqual(h.commands(), [0]);
        assert.equal(h.states.get('ems.0.Devices.MyPV_DHW.OutputOwned').val, true);
        h.advance(8000); h.put('o1', 3000); h.put('o2', 3000); h.tick();
        h.advance(1000); h.put('o1', 0); h.put('o2', 0); h.tick();
        assert.equal(h.states.get('ems.0.Devices.MyPV_DHW.OutputOwned').val, false);
    }
    const foreign = outputHarness();
    foreign.put('o1', 3000);
    foreign.own('System.RealOutputsEnabled', false);
    foreign.tick();
    assert.deepEqual(foreign.commands(), []);
});

test('startup failure stops persisted EHZ but retains unconfirmed physical highwater', () => {
    const h = outputHarness();
    h.own('Devices.MyPV_DHW.OutputOwned', true);
    h.own('Devices.MyPV_DHW.OutputCommand_W', 3000);
    h.own('Devices.MyPV_DHW.OutputLastWrite', 1900000);
    h.run('stopDhwOutput("Startup failure")');
    assert.deepEqual(h.commands(), [0]);
    h.complete();
    assert.equal(h.run('hasOwnedDhwOutput()'), true);
    assert.equal(h.states.get('ems.0.Devices.MyPV_DHW.OutputReservedPower_W').val, 3000);
});

test('asynchronous output errors trigger safe zero and do not report successful active control', () => {
    const h = outputHarness();
    h.tick();
    h.complete(new Error('transport down'));
    assert.equal(h.states.get('ems.0.Devices.MyPV_DHW.OutputActive').val, false);
    assert.match(h.states.get('ems.0.Devices.MyPV_DHW.OutputStatus').val, /transport down/);
    h.tick();
    assert.deepEqual(h.commands(), [3000, 0]);
    h.complete();
    assert.equal(h.run('hasOwnedDhwOutput()'), true, 'failed transport cannot prove the old positive never reached hardware');
});

test('DHW retains every delayed phase highwater across zero and an unclean restart', () => {
    const first = outputHarness(); first.tick(); first.complete();
    first.own('System.RealOutputsEnabled', false); first.tick(); first.complete();
    const h = outputHarness();
    for (const [id, state] of first.states) h.states.set(id, {...state});
    h.tick(); h.complete();
    h.advance(30000); h.fresh(); h.tick();
    assert.equal(h.states.get('ems.0.Devices.MyPV_DHW.OutputReservedPower_W').val, 3000);
    assert.equal(h.states.get('ems.0.System.NoActuation').val, false);
    h.advance(1000); h.put('o1', 3000); h.tick();
    h.advance(1000); h.put('o1', 0); h.tick();
    assert.equal(h.states.get('ems.0.Devices.MyPV_DHW.OutputReservedPower_W').val, 0);
    assert.equal(h.run('hasOwnedDhwOutput()'), false);
    assert.deepEqual(h.commands(), [0], 'restart sends one protective zero, not recurring script-interfering writes');
});

test('DHW old sink is stopped after remapping and new telemetry never releases its reservation', () => {
    const h = outputHarness(); h.tick(); h.complete();
    h.run("CFG.dp.myPvDhwSetpoint='newSet'; CFG.dp.myPvDhwOutputW=['new1','new2','new3'];");
    for (const id of ['new1', 'new2', 'new3']) h.put(id, 0);
    h.tick(); h.complete();
    assert.equal(h.writes.filter(w => w.id === 'setpoint').at(-1).val, 0);
    h.advance(1000); h.fresh(); h.tick();
    assert.equal(h.writes.some(w => w.id === 'newSet'), false);
    assert.equal(h.states.get('ems.0.Devices.MyPV_DHW.OutputSetpointId').val, 'setpoint');
    assert.equal(h.states.get('ems.0.Devices.MyPV_DHW.OutputReservedPower_W').val, 3000);
    h.nativeConfig.globalWriteEnabled = false; h.own('System.RealOutputsEnabled', false);
    h.own('Devices.MyPV_DHW.ConfirmPhysicalStop', true, {ack: false}); h.tick();
    assert.equal(h.run('hasOwnedDhwOutput()'), true, 'new zero meter cannot acknowledge the old output');
});

test('DHW manual stop acknowledgement requires both masters off, completed zero and a new physical sample', () => {
    const h = outputHarness(); h.tick(); h.complete();
    h.own('System.RealOutputsEnabled', false); h.tick(); h.complete();
    h.advance(1); h.fresh();
    h.nativeConfig.globalWriteEnabled = true;
    h.own('Devices.MyPV_DHW.ConfirmPhysicalStop', true, {ack: false}); h.tick();
    assert.equal(h.run('hasOwnedDhwOutput()'), true);
    h.nativeConfig.globalWriteEnabled = false;
    h.own('Devices.MyPV_DHW.ConfirmPhysicalStop', true, {ack: false, ts: 1999999}); h.tick();
    assert.equal(h.run('hasOwnedDhwOutput()'), true, 'old acknowledgement predating the zero is rejected');
    h.put('o1', 0, {q: 64});
    h.own('Devices.MyPV_DHW.ConfirmPhysicalStop', true, {ack: false}); h.tick();
    assert.equal(h.run('hasOwnedDhwOutput()'), true);
    h.put('o1', 0); const before = h.writes.length;
    h.own('Devices.MyPV_DHW.ConfirmPhysicalStop', true, {ack: false}); h.tick();
    assert.equal(h.run('hasOwnedDhwOutput()'), false);
    assert.equal(h.states.get('ems.0.Devices.MyPV_DHW.ConfirmPhysicalStop').val, false);
    assert.equal(h.writes.length, before, 'physical confirmation is passive and issues no actuator write');
});

test('DHW does not invent physical proof from its ordinary settling tolerance', () => {
    const h = outputHarness(); h.own('Control.Targets.MyPV_DHW_W', 1000); h.tick(); h.complete();
    h.advance(1000); h.put('o1', 997); h.own('System.RealOutputsEnabled', false); h.tick(); h.complete();
    h.advance(1000); h.put('o1', 0); h.tick();
    assert.equal(h.states.get('ems.0.Devices.MyPV_DHW.OutputReservedPower_W').val, 1000);
    assert.match(h.states.get('ems.0.Devices.MyPV_DHW.OutputReservationStatus').val, /Messabweichungen/);
});

test('DHW synchronous rejected positive dispatch does not leave invented highwater', () => {
    const h = outputHarness(); h.run('writeForeignState=()=>false'); h.tick();
    assert.equal(h.run('hasOwnedDhwOutput()'), false);
    assert.equal(h.states.get('ems.0.Devices.MyPV_DHW.OutputReservedPower_W').val, 0);
});

test('DHW restores protective zero ownership from phase highwater when its ownership boolean was lost', () => {
    const h = outputHarness();
    h.own('Devices.MyPV_DHW.OutputOwned', false);
    h.own('Devices.MyPV_DHW.OutputReservedPhase2_W', 3000);
    h.own('Devices.MyPV_DHW.OutputSetpointId', 'oldSet');
    h.own('System.RealOutputsEnabled', false); h.tick(); h.complete();
    assert.deepEqual(h.writes, [{id: 'oldSet', val: 0, at: 2000000}]);
    assert.equal(h.run('hasOwnedDhwOutput()'), true);
    assert.equal(h.states.get('ems.0.Devices.MyPV_DHW.OutputReservedPhase2_W').val, 3000);
});

test('DHW telemetry rejects null, blanks, pending commands, bad quality and future timestamps', () => {
    const h = outputHarness({simulate: true});
    for (const [val, extra] of [[null, {}], ['', {}], [false, {}], [[], {}], [[50], {}], [50, {ack: false}],
        [50, {q: 64}], [50, {ts: 3000000}]]) {
        h.put('t1', val, extra);
        assert.equal(h.run('freshDhwNumber("t1")'), null);
        assert.equal(h.run('validDhwOutputNumber("t1")'), null);
        assert.equal(h.run('evaluateDhwSimulation().release'), false);
    }
});

test('DHW never treats a malformed or unconfirmed connection flag as online', () => {
    for (const [val, extra] of [['false', {}], [true, {q: 64}], [true, {ack: false}]]) {
        const h = outputHarness({simulate: true});
        h.put('connection', val, extra);
        h.tick();
        assert.deepEqual(h.commands(), []);
        assert.equal(h.run('evaluateDhwSimulation().available'), false);
    }
});

test('DHW protects any overheated tank sensor and refreshes outlet derating on output ticks', () => {
    const h = outputHarness({simulate: true});
    h.put('t2', 83);
    h.tick();
    assert.deepEqual(h.commands(), []);
    assert.equal(h.states.get('ems.0.Devices.MyPV_DHW.Release').val, false);
    h.put('t2', 50);
    h.put('outlet', 77);
    h.run('dhwLastCommandW = 6000; dhwOutputWasActive = true;');
    h.put('o1', 3000);
    h.put('o2', 3000);
    h.tick();
    assert.deepEqual(h.commands(), [3000]);
});

test('EHZ independently applies a changed grid-operator budget against real wallbox minimum load', () => {
    const h = outputHarness({combined: true});
    h.own('Control.Targets.MyPV_DHW_W', 9000);
    h.own('Control.Targets.Wallbox0_W', 0);
    h.own('Devices.Wallbox0.OutputActive', true);
    h.put('wb0power', 1.38);
    h.run('dhwLastCommandW = 6000; dhwOutputWasActive = true;');
    // currentConsumptionLimit already deducted the heat pump from the shared
    // upstream budget; do not deduct it a second time here.
    h.consumptionLimit.active = true;
    h.consumptionLimit.budgetW = 3200;
    h.tick();
    assert.deepEqual(h.commands(), [1820]);
    h.complete();
    h.put('wb0power', null);
    h.tick();
    assert.deepEqual(h.commands(), [1820, 0]);
});

test('an absent unarmed wallbox cannot block EHZ operation through its leftover control switch', () => {
    const h = outputHarness();
    h.own('Devices.Wallbox1.ControlEnabled', true);
    h.tick();
    assert.deepEqual(h.commands(), [3000]);
});

test('settled EHZ absorbs a two-kilowatt export in one feedback step', () => {
    assert.equal(command('adaptiveDhwStepW(-1900, 1000, 100, 3000)'), 1900);
    assert.equal(command('limitedDhwCommand(9000, 6500, 9000, 1900, 8400)'), 8400);
    assert.equal(command('adaptiveDhwStepW(-1900, 1000, 100, 1000)'), 1000);
});

test('EHZ uses the central working limit and distinguishes phase export from import', () => {
    assert.equal(phaseLimit(null), 0);
    assert.equal(phaseLimit('import'), 0);
    assert.equal(phaseLimit('export'), 3000);
});

test('combined EHZ accepts three armed wallboxes only in alpha mode', () => {
    const states = new Map();
    for (let wb=0;wb<3;wb++) {
        states.set(`ems.0.Devices.Wallbox${wb}.Present`,{val:true});
        states.set(`ems.0.Devices.Wallbox${wb}.ControlEnabled`,{val:true});
    }
    states.set('ems.0.Config.DHWParallelDistributionEnabled',{val:true});
    const ctx = vm.createContext({Math, gridConstraints: require('../lib/grid-constraints'),
        CFG:{root:'ems.0',dp:{dhwParallelRelease:'split'}},
        nativeConfig:{multiWallboxAlphaArmed:true,combinedProductionArmed:true,
            wb0ProductionArmed:true,wb1ProductionArmed:true,wb2ProductionArmed:true},
        getState:id=>states.get(id),readBooleanInput:id=>id==='split'?true:null});
    vm.runInContext(fs.readFileSync(path.join(__dirname, '../lib/engine/dhw-output.js'), 'utf8'), ctx);
    assert.equal(vm.runInContext('dhwCombinedProductionState().allowed',ctx),true);
    vm.runInContext('nativeConfig.multiWallboxAlphaArmed=false',ctx);
    assert.equal(vm.runInContext('dhwCombinedProductionState().allowed',ctx),false);
});

