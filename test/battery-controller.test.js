'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, '../lib/engine/battery-controller.js'), 'utf8');

function harness() {
    let now = 2000000;
    const ids = {GS: 'sunenergyxt500.0.heads.1.control.GS',
        soc: 'sunenergyxt500.0.total.soc', power: 'sunenergyxt500.0.total.gridPower',
        heartbeat: 'sunenergyxt500.0.info.lastUpdate', online: 'sunenergyxt500.0.heads.1.online',
        MM: 'sunenergyxt500.0.heads.1.control.MM', LM: 'sunenergyxt500.0.heads.1.control.LM'};
    const states = new Map();
    const writes = [];
    const pending = [];
    const put = (id, val, extra = {}) => {
        const state = {val, ts: now, ack: true, ...extra};
        states.set(id, state);
        if (ids[id]) states.set(ids[id], id === 'power' && typeof val === 'number'
            ? {...state, val: -val} : state);
    };
    const own = (suffix, val, extra) => put(`ems.0.${suffix}`, val, extra);
    for (const suffix of ['System.RealOutputsEnabled', 'System.DataValid', 'Control.Valid',
        'Devices.Battery.Present', 'Devices.Battery.ControlEnabled', 'Devices.Battery.DriverReady',
        'Devices.Battery.SingleHeadVerified']) own(suffix, true);
    own('Control.LastUpdate', now);
    own('Control.Targets.Battery_W', 1000);
    own('Config.BatteryMinSoC_pct', 15);
    own('Config.BatteryMaxSoC_pct', 100);
    own('Config.BatteryMaxCharge_W', 2400);
    own('Config.BatteryMaxDischarge_W', 2400);
    own('Config.BatterySelfConsumptionEnabled', true);
    put('soc', 50);
    put('power', 0);
    put('heartbeat', now);
    put('online', true);
    put('MM', false);
    put('LM', true);
    for (const id of ['ha1', 'ha2', 'ha3']) put(id, 0);
    const nativeConfig = {batterySetpointId: ids.GS, batteryAcPowerId: ids.power, batteryProductionArmed: true,
        globalWriteEnabled: true, batteryPresent: true, batteryControlEnabled: true,
        batteryHeartbeatId: ids.heartbeat, batteryOnlineId: ids.online,
        batteryManualModeId: ids.MM, batteryLocalModeId: ids.LM};
    const consumptionLimit = {valid: true, active: false, budgetW: null};
    const loads = {batteryW: 0, dhwW: 0, heatingW: 0, wallboxW: 0, totalW: 0};
    const reservations = {valid: true, otherW: [0, 0, 0]};
    let accepted = true;
    const ctx = vm.createContext({Math, Date: {now: () => now, parse: Date.parse}, nativeConfig,
        CFG: {root: 'ems.0', dp: {batterySoc: ids.soc, batteryAcPower: ids.power,
            batteryPower: 'sunenergyxt500.0.total.batteryPower',
            myPvDhwHaCurrentA: ['ha1', 'ha2', 'ha3']}},
        existsState: id => states.has(id), getState: id => states.get(id),
        stateDef: (id, value) => { if (!states.has(id)) put(id, value); },
        configDef: (id, value) => { if (!states.has(id)) put(id, value); },
        write: (id, value) => put(id, value),
        writeForeignState: (id, value, callback) => {
            if (accepted) { writes.push({id, val: value, at: now}); pending.push(callback); }
            return accepted;
        },
        currentConsumptionLimit: () => consumptionLimit,
        coordinatedConsumptionLoads: () => loads,
        coordinatedPhaseReservations: () => reservations});
    vm.runInContext(source, ctx);
    const run = code => vm.runInContext(code, ctx);
    run('createBatteryStates()');
    return {states, writes, pending, nativeConfig, consumptionLimit, loads, reservations, put, own, run, ids,
        tick: () => run('updateBatteryProductionOutput()'),
        advance: ms => { now += ms; },
        fresh: () => {
            for (const state of states.values()) state.ts = now;
            put('heartbeat', now);
            own('Control.LastUpdate', now);
        },
        complete: error => { for (const callback of pending.splice(0)) callback(error || null); },
        confirmZero: () => {
            now += 2000;
            put('power', 0); put('heartbeat', now); own('Control.LastUpdate', now);
            run('confirmBatteryZero()');
        },
        setAccepted: value => { accepted = value; },
        value: suffix => states.get(`ems.0.${suffix}`)?.val,
        commands: () => writes.map(write => write.val)};
}

test('battery uses SunEnergy GS sign and never sends the requested target into a grid-meter input', () => {
    const h = harness();
    h.tick();
    assert.deepEqual(h.commands(), [-100]);
    assert.equal(h.writes[0].id, h.ids.GS);
    assert.equal(h.value('Devices.Battery.RequestedPower_W'), -100);
    assert.equal(h.value('Devices.Battery.OutputCommandInternal_W'), 100);
    assert.equal(h.value('Devices.Battery.OutputOwned'), true);
    const discharge = harness();
    discharge.own('Control.Targets.Battery_W', -1000);
    discharge.tick();
    assert.deepEqual(discharge.commands(), [100]);
});

test('fine regulation waits for transport and real measured feedback before increasing', () => {
    const h = harness();
    h.tick();
    h.advance(2000); h.fresh(); h.tick();
    assert.deepEqual(h.commands(), [-100]);
    h.complete();
    h.tick();
    assert.deepEqual(h.commands(), [-100]);
    h.put('power', 100);
    h.tick();
    assert.deepEqual(h.commands(), [-100, -200]);
    h.complete(); h.put('power', 200);
    h.advance(1000); h.fresh(); h.tick();
    assert.deepEqual(h.commands(), [-100, -200]);
    h.advance(1000); h.fresh(); h.tick();
    assert.deepEqual(h.commands(), [-100, -200, -300]);
});

test('settled unchanged command does not produce repetitive GS writes', () => {
    const h = harness();
    h.own('Control.Targets.Battery_W', 100);
    h.tick(); h.complete(); h.put('power', 100);
    h.advance(2000); h.fresh(); h.tick();
    h.advance(2000); h.fresh(); h.tick();
    assert.deepEqual(h.commands(), [-100]);
});

test('battery ramp step, cycle and deadband are configurable independently', () => {
    const h = harness();
    h.own('Config.BatteryFineStep_W', 40);
    h.own('Config.BatteryDeadband_W', 10);
    h.own('Config.BatteryCycle_s', 3);
    h.tick(); h.complete(); h.put('power', 40);
    h.advance(2000); h.fresh(); h.tick();
    assert.deepEqual(h.commands(), [-40]);
    h.advance(1000); h.fresh(); h.tick();
    assert.deepEqual(h.commands(), [-40, -80]);
    h.own('Control.Targets.Battery_W', 9); h.tick();
    assert.deepEqual(h.commands(), [-40, -80, 0]);
});

test('charge/discharge power limits constrain commands before the fine ramp', () => {
    const h = harness();
    h.own('Config.BatteryMaxCharge_W', 80);
    h.tick();
    assert.deepEqual(h.commands(), [-80]);
    const discharge = harness();
    discharge.own('Config.BatteryMaxDischarge_W', 70);
    discharge.own('Control.Targets.Battery_W', -1000);
    discharge.tick();
    assert.deepEqual(discharge.commands(), [70]);
});

test('reduced same-direction allocation is immediate even while older command is pending', () => {
    const h = harness();
    h.own('Config.BatteryFineStep_W', 1000);
    h.tick();
    h.own('Control.Targets.Battery_W', 200);
    h.tick();
    assert.deepEqual(h.commands(), [-1000, -200]);
    h.complete(new Error('old or latest transmission failed'));
    assert.equal(h.value('Devices.Battery.RequestedPower_W'), 0);
    assert.equal(h.value('Devices.Battery.OutputOwned'), true);
});

test('direction reversal requires a zero command and confirmed physical zero first', () => {
    const h = harness();
    h.tick(); h.complete(); h.put('power', 100);
    h.own('Control.Targets.Battery_W', -1000);
    h.tick();
    assert.deepEqual(h.commands(), [-100, 0]);
    h.complete(); h.advance(2000); h.fresh(); h.tick();
    assert.deepEqual(h.commands(), [-100, 0]);
    h.put('power', 0); h.tick();
    assert.deepEqual(h.commands(), [-100, 0, 100]);
});

test('global disable zeroes BOTH output signs once and retains ownership until later physical zero', () => {
    for (const target of [1000, -1000]) {
        const h = harness();
        h.own('Control.Targets.Battery_W', target);
        h.tick(); h.complete();
        h.advance(2000); h.fresh(); h.put('power', Math.sign(target) * 100);
        h.run('observeBatteryOutstandingCommand()');
        h.own('System.RealOutputsEnabled', false);
        h.tick(); h.tick();
        assert.equal(h.commands().at(-1), 0);
        assert.equal(h.commands().length, 2);
        assert.equal(h.value('Devices.Battery.OutputOwned'), true);
        assert.equal(h.value('Devices.Battery.RequestedPower_W'), 0);
        h.complete(); h.confirmZero(); h.tick();
        assert.equal(h.value('Devices.Battery.OutputOwned'), false);
        assert.equal(h.commands().length, 2);
    }
});

test('zero DB acceptance alone retains ownership and NoActuation remains false while power persists', () => {
    const h = harness(); h.tick(); h.complete(); h.put('power', 100);
    h.own('System.RealOutputsEnabled', false); h.tick(); h.complete();
    assert.equal(h.value('Devices.Battery.OutputOwned'), true);
    assert.equal(h.value('System.NoActuation'), false);
    h.advance(2000); h.fresh(); h.tick();
    assert.equal(h.value('Devices.Battery.OutputOwned'), true);
    h.confirmZero(); h.tick();
    assert.equal(h.value('Devices.Battery.OutputOwned'), false);
    assert.equal(h.value('System.NoActuation'), true);
});

test('zero proof requires a subsequent fresh driver poll, not pre-command zero telemetry', () => {
    const h = harness(); h.tick(); h.complete();
    h.advance(2000); h.fresh(); h.put('power', 100);
    h.run('observeBatteryOutstandingCommand()');
    h.own('System.RealOutputsEnabled', false); h.tick(); h.complete();
    h.put('power', 0);
    h.tick();
    assert.equal(h.value('Devices.Battery.OutputOwned'), true);
    h.advance(16000); h.tick();
    assert.equal(h.value('Devices.Battery.OutputOwned'), true);
    assert.match(h.value('Devices.Battery.Fault'), /Nullleistung nicht bestaetigt/);
    h.confirmZero(); h.tick();
    assert.equal(h.value('Devices.Battery.OutputOwned'), false);
});

test('metadata mapping change cannot prove an old battery stopped using new-head zero telemetry', () => {
    const h = harness();
    h.own('Devices.Battery.OutputOwned', true);
    h.own('Devices.Battery.OutputSetpointId', 'sunenergyxt500.0.heads.2.control.GS');
    h.own('Devices.Battery.OutputCommandInternal_W', 300);
    h.tick(); h.complete(); h.confirmZero(); h.tick();
    assert.equal(h.value('Devices.Battery.OutputOwned'), true);
    assert.match(h.value('Devices.Battery.Fault'), /Messzuordnung/);
    assert.deepEqual(h.commands(), [0]);
});

test('disabled/unarmed/missing sink/driver rejection cannot select battery as fine regulator', () => {
    const changes = [
        h => h.own('Devices.Battery.Present', false),
        h => h.own('Devices.Battery.ControlEnabled', false),
        h => { h.nativeConfig.batteryProductionArmed = false; },
        h => { h.nativeConfig.batterySetpointId = ''; },
        h => h.own('Devices.Battery.DriverReady', false)
    ];
    for (const change of changes) {
        const h = harness(); change(h); h.tick();
        assert.deepEqual(h.commands(), []);
        assert.equal(h.run('batteryRegulationState().available'), false);
        assert.equal(h.value('Devices.Battery.RequestedPower_W'), 0);
    }
});

test('autonomous MM or disabled LM mode, offline and uncertain mode acknowledgements block GS', () => {
    for (const [id, value, extra] of [
        ['MM', true], ['LM', false], ['online', false],
        ['MM', false, {ack: false}], ['LM', true, {q: 1}], ['online', 'invalid']
    ]) {
        const h = harness(); h.put(id, value, extra); h.tick();
        assert.deepEqual(h.commands(), []);
        assert.equal(h.run('batteryRegulationState().eligible'), false);
    }
});

test('read-on-change mode booleans remain valid when unchanged but heartbeat is fresh', () => {
    const h = harness();
    h.put('MM', false, {ts: 100});
    h.put('LM', true, {ts: 100});
    h.put('online', true, {ts: 100});
    h.tick();
    assert.deepEqual(h.commands(), [-100]);
});

test('heartbeat value, not merely a recently written timestamp, must be fresh and acknowledged', () => {
    for (const [value, extra] of [[1, {}], [null, {}], ['', {}], [false, {}],
        [2000000, {ack: false}], [2100000, {}], [2000000, {q: 2}]]) {
        const h = harness(); h.put('heartbeat', value, extra); h.tick();
        assert.deepEqual(h.commands(), []);
    }
    const iso = harness(); iso.put('heartbeat', new Date(2000000).toISOString()); iso.tick();
    assert.deepEqual(iso.commands(), [-100]);
});

test('heartbeat timeout immediately requests zero instead of continuing the fine ramp', () => {
    const h = harness(); h.tick(); h.complete();
    h.advance(31000); h.own('Control.LastUpdate', 2031000); h.tick();
    assert.deepEqual(h.commands(), [-100, 0]);
    assert.equal(h.value('Devices.Battery.RegulationAvailable'), false);
});

test('empty, wrong-quality, unconfirmed and future-dated physical measurements are not zero', () => {
    for (const id of ['soc', 'power']) {
        for (const [value, extra] of [[null, {}], ['', {}], [false, {}], [0, {ack: false}],
            [0, {q: 1}], [0, {ts: 2100000}], [0, {ts: 0}]]) {
            const h = harness(); h.put(id, value, extra); h.tick();
            assert.deepEqual(h.commands(), [], `${id}: ${JSON.stringify({value, extra})}`);
        }
    }
});

test('minimum SoC reserve prevents discharge and is not silently replaced when configured zero', () => {
    const h = harness();
    h.put('soc', 15); h.own('Control.Targets.Battery_W', -1000); h.tick();
    assert.deepEqual(h.commands(), []);
    const zero = harness();
    zero.own('Config.BatteryMinSoC_pct', 0);
    assert.equal(zero.run('batteryRegulationState().canDischarge'), false);
    assert.match(zero.run('batteryRegulationState().reason'), /positive Mindest-SoC/);
    zero.tick();
    assert.deepEqual(zero.commands(), [-100]);
    assert.equal(zero.value('Config.BatteryMinSoC_pct'), 0);
});

test('maximum SoC blocks charging while discharge and own-consumption setting are respected', () => {
    const h = harness(); h.put('soc', 100); h.tick();
    assert.deepEqual(h.commands(), []);
    h.own('Control.Targets.Battery_W', -1000); h.tick();
    assert.deepEqual(h.commands(), [100]);
    h.own('Config.BatterySelfConsumptionEnabled', false); h.tick();
    assert.deepEqual(h.commands(), [100, 0]);
});

test('SoC crossing reserve or maximum stops a currently active output immediately', () => {
    for (const [target, soc] of [[1000, 100], [-1000, 15]]) {
        const h = harness(); h.own('Control.Targets.Battery_W', target); h.tick();
        h.put('soc', soc); h.tick();
        assert.equal(h.commands().at(-1), 0);
    }
});

test('optional temperature or device fault sources fail closed when explicitly configured', () => {
    const h = harness(); h.nativeConfig.batteryTemperatureId = 'temp'; h.tick();
    assert.deepEqual(h.commands(), []);
    h.put('temp', 49); h.tick();
    assert.deepEqual(h.commands(), [-100]);
    h.put('temp', 50); h.tick();
    assert.deepEqual(h.commands(), [-100, 0]);
    const fault = harness(); fault.nativeConfig.batteryFaultId = 'fault';
    fault.put('fault', false); fault.tick();
    fault.put('fault', true); fault.tick();
    assert.deepEqual(fault.commands(), [-100, 0]);
});

test('AC GP measurement is always inverted and legacy DC sign configuration cannot change it', () => {
    const h = harness(); h.nativeConfig.batteryPowerSign = -1;
    h.put('power', 700);
    assert.equal(h.run('batteryMeasuredPowerW()'), 700);
    h.nativeConfig.batteryPowerSign = 0;
    assert.equal(h.run('batteryMeasuredPowerW()'), 700);
    h.put(h.ids.power, 700);
    assert.equal(h.run('batteryMeasuredPowerW()'), -700);
});

test('stale realtime calculation or missing target never produces a positive or negative command', () => {
    for (const [suffix, value] of [['Control.Valid', false], ['System.DataValid', false],
        ['Control.LastUpdate', 1], ['Control.Targets.Battery_W', null]]) {
        const h = harness(); h.own(suffix, value); h.tick();
        assert.deepEqual(h.commands(), []);
    }
});

test('pending command timeout stops and latches a fault instead of repeated command wind-up', () => {
    const h = harness(); h.tick(); h.complete();
    h.advance(16000); h.fresh(); h.tick();
    assert.deepEqual(h.commands(), [-100, 0]);
    assert.match(h.value('Devices.Battery.Fault'), /Rueckmeldefrist/);
    h.complete(); h.confirmZero(); h.advance(2000); h.fresh(); h.tick();
    assert.deepEqual(h.commands(), [-100, 0]);
    h.own('Devices.Battery.ResetFault', true); h.tick();
    assert.deepEqual(h.commands(), [-100, 0]);
    assert.equal(h.value('Devices.Battery.OutputOwned'), true);
    h.nativeConfig.globalWriteEnabled = false;
    h.own('System.RealOutputsEnabled', false);
    h.own('Devices.Battery.ConfirmPhysicalStop', true, {ack: false}); h.tick();
    assert.equal(h.value('Devices.Battery.OutputOwned'), false);
    h.nativeConfig.globalWriteEnabled = true;
    h.own('System.RealOutputsEnabled', true); h.tick();
    assert.deepEqual(h.commands(), [-100, 0, -100]);
    assert.equal(h.value('Devices.Battery.ResetFault'), false);
});

test('write failure keeps responsibility, requests zero and does not restart without acknowledgement', () => {
    const h = harness(); h.tick(); h.complete(new Error('connection lost'));
    assert.equal(h.value('Devices.Battery.RequestedPower_W'), 0);
    assert.equal(h.value('Devices.Battery.OutputOwned'), true);
    h.tick();
    assert.deepEqual(h.commands(), [-100, 0]);
    h.complete(new Error('zero failed')); h.tick();
    assert.deepEqual(h.commands(), [-100, 0, 0]);
    h.complete(); h.confirmZero(); h.tick();
    assert.equal(h.value('Devices.Battery.OutputOwned'), true);
    h.nativeConfig.globalWriteEnabled = false;
    h.own('System.RealOutputsEnabled', false);
    h.own('Devices.Battery.ConfirmPhysicalStop', true, {ack: false}); h.tick();
    assert.equal(h.value('Devices.Battery.OutputOwned'), false);
    assert.deepEqual(h.commands(), [-100, 0, 0]);
});

test('guard rejection never leaves a nonzero public request published', () => {
    const h = harness(); h.setAccepted(false); h.tick();
    assert.deepEqual(h.commands(), []);
    assert.equal(h.value('Devices.Battery.RequestedPower_W'), 0);
    assert.equal(h.value('Devices.Battery.OutputOwned'), true);
    assert.match(h.value('Devices.Battery.Fault'), /Schreibschutz/);
});

test('persisted ownership stops the original sink and is not inferred from foreign measured load', () => {
    const h = harness();
    h.own('Devices.Battery.OutputOwned', true);
    h.own('Devices.Battery.OutputSetpointId', 'oldGS');
    h.own('Devices.Battery.OutputCommandInternal_W', -100);
    h.tick();
    assert.deepEqual(h.writes.map(item => ({id: item.id, val: item.val})), [{id: 'oldGS', val: 0}]);
    h.complete(); h.confirmZero(); h.tick();
    assert.equal(h.commands().length, 1);
    const foreign = harness(); foreign.put('power', 300); foreign.tick();
    assert.deepEqual(foreign.commands(), []);
    assert.equal(foreign.run('hasOwnedBatteryOutput()'), false);
});

test('a successful zero write never fabricates zero measured battery power', () => {
    const h = harness(); h.tick(); h.complete(); h.put('power', 100);
    h.own('Control.Targets.Battery_W', 0); h.tick(); h.complete();
    assert.equal(h.states.get('power').val, 100);
    assert.equal(h.value('Devices.Battery.ActualPower_W'), 100);
});

test('foreign residual power cannot reserve battery budget or become a fine regulator', () => {
    const h = harness(); h.put('power', 300);
    assert.equal(h.run('batteryRegulationState().available'), false);
    assert.equal(h.run('batteryRegulationState().actualW'), 300);
    h.tick();
    assert.deepEqual(h.commands(), []);
    assert.match(h.value('Devices.Battery.OutputStatus'), /Nullleistung/);
});

test('zero demand leaves an otherwise healthy idle battery available for the next fine step', () => {
    const h = harness(); h.own('Control.Targets.Battery_W', 0); h.tick();
    assert.deepEqual(h.commands(), []);
    assert.equal(h.value('Devices.Battery.RegulationAvailable'), true);
});

test('invalid tuning and SoC ranges fail closed instead of creating NaN or unlimited power', () => {
    for (const [suffix, value] of [['BatteryFineStep_W', null], ['BatteryCycle_s', 0],
        ['BatteryFeedbackTimeout_s', 1], ['BatteryMeasurementMaxAge_s', 0],
        ['BatteryMaxCharge_W', -1], ['BatteryMinSoC_pct', 101], ['BatteryMaxSoC_pct', 10]]) {
        const h = harness(); h.own(`Config.${suffix}`, value); h.tick();
        assert.deepEqual(h.commands(), [], suffix);
    }
});

test('native gates cannot be bypassed by manually true own runtime states', () => {
    for (const name of ['globalWriteEnabled', 'batteryPresent', 'batteryControlEnabled']) {
        const h = harness(); h.nativeConfig[name] = false; h.tick();
        assert.deepEqual(h.commands(), []);
        assert.equal(h.run('batteryRegulationState().available'), false);
    }
});

test('LPC budget is rechecked at physical battery output including retained and pending peer load', () => {
    const h = harness();
    h.own('Config.BatteryFineStep_W', 1000);
    h.own('Control.Targets.Battery_W', 2000);
    h.consumptionLimit.active = true;
    h.consumptionLimit.budgetW = 4200;
    Object.assign(h.loads, {dhwW: 1500, heatingW: 1000, wallboxW: 1500, totalW: 4000});
    h.tick();
    assert.deepEqual(h.commands(), [-200]);
    h.loads.wallboxW = 1800; h.tick();
    assert.deepEqual(h.commands(), [-200, 0]);
});

test('invalid or missing gross budget loads fail closed but LPC does not invert discharge sign', () => {
    const invalid = harness(); invalid.consumptionLimit.budgetW = 4200;
    invalid.loads.dhwW = null; invalid.tick();
    assert.deepEqual(invalid.commands(), []);
    const discharge = harness(); discharge.consumptionLimit.budgetW = 4200;
    discharge.loads.dhwW = 5000;
    discharge.own('Control.Targets.Battery_W', -1000); discharge.tick();
    assert.deepEqual(discharge.commands(), [100]);
    discharge.consumptionLimit.valid = false; discharge.tick();
    assert.deepEqual(discharge.commands(), [100, 0]);
});

test('stale raw measurements are not vouched for by an unrelated fresh heartbeat', () => {
    for (const id of ['soc', 'power']) {
        const h = harness();
        h.run(`CFG.dp.${id === 'soc' ? 'batterySoc' : 'batteryAcPower'} = 'unrelated.${id}';`);
        h.put(`unrelated.${id}`, id === 'soc' ? 50 : 0, {ts: 100}); h.tick();
        assert.deepEqual(h.commands(), []);
    }
});

test('verified same-instance heartbeat validates unchanged SunEnergy measurements, not aliases', () => {
    const h = harness();
    const instance = 'sunenergyxt500.0';
    h.nativeConfig.batterySetpointId = `${instance}.heads.1.control.GS`;
    h.nativeConfig.batteryHeartbeatId = `${instance}.info.lastUpdate`;
    h.nativeConfig.batteryOnlineId = `${instance}.heads.1.online`;
    h.nativeConfig.batteryManualModeId = `${instance}.heads.1.MM`;
    h.nativeConfig.batteryLocalModeId = `${instance}.heads.1.LM`;
    h.put(h.nativeConfig.batteryHeartbeatId, 2000000, {ts: 100});
    h.put(h.nativeConfig.batteryOnlineId, true, {ts: 100});
    h.put(h.nativeConfig.batteryManualModeId, false, {ts: 100});
    h.put(h.nativeConfig.batteryLocalModeId, true, {ts: 100});
    h.put(`${instance}.total.gridPower`, 0, {ts: 100});
    h.put(`${instance}.total.soc`, 50, {ts: 100});
    h.run(`CFG.dp.batteryAcPower = '${instance}.total.gridPower'; CFG.dp.batterySoc = '${instance}.total.soc';`);
    h.tick();
    assert.deepEqual(h.commands(), [-100]);
    h.complete();
    h.put(`${instance}.total.gridPower`, -100, {ts: 100});
    h.advance(2000); h.own('Control.LastUpdate', 2002000);
    h.put(h.nativeConfig.batteryHeartbeatId, 2002000);
    h.tick();
    assert.deepEqual(h.commands(), [-100, -200]);
    h.run("CFG.dp.batteryAcPower = 'alias.0.batteryPower';");
    h.put('alias.0.batteryPower', -200, {ts: 100}); h.tick();
    assert.deepEqual(h.commands(), [-100, -200, 0]);
});

test('cross-head mode/online mapping and unverified aggregate telemetry are rejected even when fresh', () => {
    for (const setting of ['batteryOnlineId', 'batteryManualModeId', 'batteryLocalModeId']) {
        const h = harness();
        const id = h.nativeConfig[setting].replace('.heads.1.', '.heads.2.');
        h.nativeConfig[setting] = id;
        h.put(id, setting === 'batteryManualModeId' ? false : true); h.tick();
        assert.deepEqual(h.commands(), []);
        assert.match(h.value('Devices.Battery.OutputStatus'), /GS-Kopf/);
    }
    const h = harness(); h.own('Devices.Battery.SingleHeadVerified', false); h.tick();
    assert.deepEqual(h.commands(), []);
    h.run("CFG.dp.batteryAcPower = 'sunenergyxt500.0.heads.1.grid.GP'; CFG.dp.batterySoc = 'sunenergyxt500.0.heads.1.battery.soc';");
    h.put('sunenergyxt500.0.heads.1.grid.GP', 0);
    h.put('sunenergyxt500.0.heads.1.battery.soc', 50); h.tick();
    assert.deepEqual(h.commands(), [-100]);
});

test('battery reserves every phase conservatively and respects pending positive peer increments', () => {
    const h = harness(); h.own('Config.BatteryFineStep_W', 1000);
    h.put('ha1', 44); h.put('ha2', 40); h.put('ha3', 0);
    h.reservations.otherW = [300, 0, 0]; h.tick();
    assert.deepEqual(h.commands(), [-160]);
    h.put('ha1', 45); h.tick();
    assert.deepEqual(h.commands(), [-160, 0]);
});

test('incomplete or invalid shared phase measurement/reservation fails closed', () => {
    for (const edit of [h => h.put('ha1', null), h => { h.reservations.valid = false; },
        h => { h.reservations.otherW = [0, null, 0]; },
        h => h.run("CFG.dp.haPhaseImportW = ['one'];")]) {
        const h = harness(); edit(h); h.tick();
        assert.deepEqual(h.commands(), []);
        assert.match(h.value('Devices.Battery.OutputStatus'), /Phasenreserve/);
    }
});

test('battery ownership publisher keeps NoActuation false for independently owned heater or wallbox', () => {
    const h = harness(); h.own('System.RealOutputsEnabled', false);
    for (const device of ['MyPV_DHW', 'MyPV_Heating', 'Wallbox0', 'Wallbox1', 'Wallbox2']) {
        h.own(`Devices.${device}.OutputOwned`, true); h.tick();
        assert.equal(h.value('System.NoActuation'), false);
        h.own(`Devices.${device}.OutputOwned`, false);
    }
});

test('synchronous write exceptions are latched with zero public request and retained ownership', () => {
    const h = harness();
    h.run("writeForeignState = () => { throw new Error('transport unavailable'); };");
    h.tick();
    assert.equal(h.value('Devices.Battery.OutputOwned'), true);
    assert.equal(h.value('Devices.Battery.OutputActive'), false);
    assert.equal(h.value('Devices.Battery.RequestedPower_W'), 0);
    assert.match(h.value('Devices.Battery.Fault'), /transport unavailable/);
});

test('unknown self-consumption permission cannot silently authorize battery discharge', () => {
    const h = harness(); h.own('Config.BatterySelfConsumptionEnabled', null);
    h.own('Control.Targets.Battery_W', -500); h.tick();
    assert.deepEqual(h.commands(), []);
    assert.equal(h.value('Devices.Battery.CanDischarge'), false);
});

test('offline head or newly mismapped zero measurement cannot release persisted stop ownership', () => {
    for (const edit of [h => h.put('online', false), h => {
        h.run("CFG.dp.batteryAcPower = 'sunenergyxt500.0.heads.2.grid.GP';");
        h.put('sunenergyxt500.0.heads.2.grid.GP', 0);
    }]) {
        const h = harness(); h.tick(); h.complete();
        h.own('System.RealOutputsEnabled', false); h.tick(); h.complete();
        edit(h); h.confirmZero(); h.tick();
        assert.equal(h.value('Devices.Battery.OutputOwned'), true);
        assert.equal(h.value('System.NoActuation'), false);
    }
});

test('a delayed earlier rise retains charge reserve through an intervening zero sample', () => {
    const h = harness(); h.tick(); h.complete();
    assert.equal(h.value('Devices.Battery.OutputReservedCharge_W'), 100);
    h.advance(2000); h.fresh(); h.own('Control.Targets.Battery_W', 0); h.tick(); h.complete();
    h.advance(2000); h.fresh(); h.tick();
    assert.equal(h.value('Devices.Battery.OutputOwned'), true);
    assert.equal(h.value('Devices.Battery.OutputReservedCharge_W'), 100);
    assert.equal(h.value('Devices.Battery.OutputUnobservedCommand_W'), 100);
    h.advance(4000); h.fresh(); h.put('power', 100); h.tick();
    assert.equal(h.value('Devices.Battery.OutputOwned'), true);
    assert.equal(h.value('Devices.Battery.OutputUnobservedCommand_W'), 0);
    h.advance(2000); h.fresh(); h.put('power', 0); h.tick();
    assert.equal(h.value('Devices.Battery.OutputOwned'), false);
    assert.equal(h.value('Devices.Battery.OutputReservedCharge_W'), 0);
    assert.deepEqual(h.commands(), [-100, 0]);
});

test('unobserved rise survives arbitrarily long fresh zero telemetry, timeout and ResetFault', () => {
    const h = harness(); h.tick(); h.complete();
    h.advance(2000); h.fresh(); h.own('Control.Targets.Battery_W', 0); h.tick(); h.complete();
    h.advance(3600000); h.fresh(); h.tick();
    h.own('Devices.Battery.ResetFault', true); h.tick();
    assert.equal(h.value('Devices.Battery.OutputOwned'), true);
    assert.equal(h.value('Devices.Battery.OutputReservedCharge_W'), 100);
    assert.match(h.value('Devices.Battery.OutputStatus'), /Reserve bleibt/);
});

test('manual independent stop confirmation requires global OFF, completed zero and fresh physical zero', () => {
    const h = harness(); h.tick();
    const obsolete = h.pending[0]; h.complete();
    h.advance(2000); h.fresh(); h.own('Control.Targets.Battery_W', 0); h.tick();
    h.nativeConfig.globalWriteEnabled = false; h.own('System.RealOutputsEnabled', false);
    h.own('Devices.Battery.ConfirmPhysicalStop', true, {ack: false}); h.tick();
    assert.equal(h.value('Devices.Battery.OutputOwned'), true, 'outstanding transport cannot be manually cleared');
    h.complete(); h.confirmZero();
    h.nativeConfig.globalWriteEnabled = true;
    h.own('Devices.Battery.ConfirmPhysicalStop', true, {ack: false}); h.tick();
    assert.equal(h.value('Devices.Battery.OutputOwned'), true, 'native global ON still blocks manual release');
    h.nativeConfig.globalWriteEnabled = false;
    h.put('power', 100); h.own('Devices.Battery.ConfirmPhysicalStop', true, {ack: false}); h.tick();
    assert.equal(h.value('Devices.Battery.OutputOwned'), true, 'real nonzero power cannot be manually overridden');
    h.confirmZero(); h.own('Devices.Battery.ConfirmPhysicalStop', true, {ack: false}); h.tick();
    assert.equal(h.value('Devices.Battery.OutputOwned'), false);
    assert.equal(h.value('Devices.Battery.OutputReservedCharge_W'), 0);
    assert.equal(h.value('Devices.Battery.ConfirmPhysicalStop'), false);
    obsolete(new Error('late obsolete callback'));
    assert.equal(h.value('Devices.Battery.Fault'), '');
});

test('restart restores an unresolved positive reservation even if the last written command was zero', () => {
    const h = harness();
    h.own('Devices.Battery.OutputOwned', true);
    h.own('Devices.Battery.OutputSetpointId', h.ids.GS);
    h.own('Devices.Battery.OutputCommandInternal_W', 0);
    h.own('Devices.Battery.OutputReservedCharge_W', 700);
    h.own('Devices.Battery.OutputUnobservedCommand_W', 700);
    h.own('Devices.Battery.OutputUnobservedCommandSince', 1999000);
    h.tick(); h.complete(); h.confirmZero(); h.tick();
    assert.equal(h.value('Devices.Battery.OutputOwned'), true);
    assert.equal(h.value('Devices.Battery.OutputReservedCharge_W'), 700);
    assert.deepEqual(h.commands(), [0]);
});

test('AC feedback uses grid GP independently of conversion losses and DC PV charging', () => {
    const h = harness();
    h.put('sunenergyxt500.0.total.batteryPower', 900);
    h.put('power', 1000);
    assert.equal(h.run('batteryMeasuredPowerW()'), 1000);
    h.put('power', 0);
    assert.equal(h.run('batteryMeasuredPowerW()'), 0);
    assert.equal(h.run('batteryRegulationState().available'), true);
    h.nativeConfig.batteryAcPowerId = '';
    h.run("CFG.dp.batteryAcPower = '';");
    assert.equal(h.run('batteryMeasuredPowerW()'), null);
    h.tick();
    assert.deepEqual(h.commands(), [], 'DC BP cannot substitute for missing AC GP');
});

test('residual highwater keeps explicit ownership even if the ownership boolean was lost during persistence', () => {
    const h = harness();
    h.own('Devices.Battery.OutputOwned', false);
    h.own('Devices.Battery.OutputSetpointId', h.ids.GS);
    h.own('Devices.Battery.OutputReservedCharge_W', 500);
    h.own('Devices.Battery.OutputUnobservedCommand_W', 500);
    h.own('Devices.Battery.OutputUnobservedCommandSince', 1999000);
    h.tick(); h.complete(); h.confirmZero(); h.tick();
    assert.equal(h.value('Devices.Battery.OutputOwned'), true);
    assert.equal(h.value('Devices.Battery.OutputReservedCharge_W'), 500);
});

test('an already acknowledged or pre-stop confirmation is never an independent manual stop statement', () => {
    for (const extra of [{ack: true}, {ack: false, ts: 100}]) {
        const h = harness(); h.tick(); h.complete();
        h.advance(2000); h.fresh(); h.own('Control.Targets.Battery_W', 0); h.tick(); h.complete();
        h.nativeConfig.globalWriteEnabled = false; h.own('System.RealOutputsEnabled', false);
        h.confirmZero();
        h.own('Devices.Battery.ConfirmPhysicalStop', true, extra); h.tick();
        assert.equal(h.value('Devices.Battery.OutputOwned'), true);
        assert.equal(h.value('Devices.Battery.OutputReservedCharge_W'), 100);
        assert.equal(h.value('Devices.Battery.ConfirmPhysicalStop'), false);
    }
});

test('observed partial previous rise keeps the full positive reserve until the stop settles', () => {
    const h = harness(); h.tick(); h.complete();
    h.advance(2000); h.fresh(); h.own('Control.Targets.Battery_W', 0); h.tick(); h.complete();
    h.advance(2000); h.fresh(); h.put('power', 80); h.tick();
    assert.equal(h.value('Devices.Battery.OutputReservedCharge_W'), 100);
    assert.equal(h.value('Devices.Battery.OutputOwned'), true);
});
