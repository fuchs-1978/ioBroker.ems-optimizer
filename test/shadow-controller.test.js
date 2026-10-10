'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ShadowController = require('../lib/shadow-controller');
const {DecisionRecordDecoder} = require('../lib/decision-record-codec');

function latestRecord(h) {
    const decoder = new DecisionRecordDecoder();
    return h.writes.filter(w => w.id.endsWith('.DecisionRecord'))
        .map(w => decoder.decode(JSON.parse(w.val))).at(-1);
}
const {createEngineContext, MODULES} = require('../lib/engine-loader');
const gridConstraints = require('../lib/grid-constraints');
const heatPumpTelemetryParser = require('../lib/heatpump-telemetry');

async function fixture({battery = false, heating = false, wallbox = true, heatPump = false,
    surplusW = 6000, delayS = 0, slowS = 2, nowMs = Date.now()} = {}) {
    let now = nowMs;
    const states = new Map(), writes = [], mapping = {};
    for (const name of MODULES) {
        const source = fs.readFileSync(path.join(__dirname, '../lib/engine', `${name}.js`), 'utf8');
        for (const token of source.match(/__DP_[A-Z0-9_]+__/g) || []) mapping[token.slice(2, -2)] = token.slice(2, -2);
    }
    for (const key of ['DP_PAR14A', 'DP_LPC_STATE', 'DP_LPC_LIMIT', 'DP_DYNAMIC_ENERGY_ENABLED', 'DP_DYNAMIC_GRID_ENABLED',
        ...[1, 2, 3].flatMap(p => [`DP_HA_L${p}_IMPORT_W`, `DP_HA_L${p}_EXPORT_W`])]) mapping[key] = '';
    const put = (id, val, extra = {}) => states.set(id, {val, ack: true, ts: now, q: 0, ...extra});
    const own = (key, value, extra) => put(`ems.0.${key}`, value, extra);
    const value = key => states.get(`ems.0.Debug.Shadow.${key}`)?.val;
    const config = {
        globalWriteEnabled: false, observerOnly: true, wallboxPrioritySource: 'internal', wallboxPriority: 0,
        wb0Present: wallbox, wb0ControlEnabled: wallbox, wb0ProductionArmed: wallbox,
        wb0MaxCurrent1pA: 32, wb0MinCurrent1pA: 6, wb0CommissioningMaxA: 32, wb0MaxPowerW: 7360,
        wb0PhaseSwitchEnabled: false, wb0ProductionPhases: 1,
        wb1Present: false, wb2Present: false, combinedProductionArmed: true,
        dhwPresent: true, dhwControlEnabled: true, dhwSetpointId: 'DP_DHW_SETPOINT',
        batteryPresent: battery, batteryControlEnabled: battery, batteryProductionArmed: battery,
        batterySetpointId: 'sunenergyxt500.0.heads.1.control.GS',
        batteryAcPowerId: 'sunenergyxt500.0.heads.1.grid.GP',
        batteryHeartbeatId: 'sunenergyxt500.0.info.lastUpdate', batteryOnlineId: 'sunenergyxt500.0.heads.1.online',
        batteryManualModeId: 'sunenergyxt500.0.heads.1.control.MM', batteryLocalModeId: 'sunenergyxt500.0.heads.1.control.LM',
        heatingPresent: heating, heatingControlEnabled: heating, heatingProductionArmed: heating,
        heatingSetpointId: 'hk.setpoint', heatingConnectionId: 'hk.connected', heatingTempId: 'hk.temp',
        heatingCoolingActiveId: 'hk.cooling', heatingOutput1Id: 'hk.power1', heatingOutput2Id: 'hk.power2', heatingOutput3Id: 'hk.power3',
        heatPumpAdviceEnabled: heatPump, heatPumpCoolingActiveId: 'wp.cooling',
        heatPumpCoolingMaxAgeS: 120
    };
    mapping.DP_BATTERY_SOC = 'sunenergyxt500.0.heads.1.battery.SC';
    mapping.DP_BATTERY_AC_POWER = config.batteryAcPowerId;
    class Clock extends Date {
        constructor(...args) { super(...(args.length ? args : [now])); }
        static now() { return now; }
    }
    const make = (target, nativeConfig = config) => createEngineContext('ems.0', mapping, {
        Date: Clock, nativeConfig, gridConstraints, heatPumpTelemetryParser,
        getState: id => target.get(id), existsState: id => target.has(id),
        setState: (id, val) => target.set(id, {val, ack: true, ts: now, q: 0}),
        createState: (id, val) => { if (!target.has(id)) target.set(id, {val, ack: true, ts: now, q: 0}); },
        log: () => {}, sendTo: () => assert.fail('unexpected SQL call'),
        writeForeignState: () => assert.fail('unexpected actuator call')
    });
    const defaults = make(states);
    vm.runInContext('createStates(); createBatteryStates(); createHeatingStates(); createHeatPumpStates(); createEnergyCoordinationStates()', defaults);
    for (const key of ['System.DataValid', 'Plan.Valid', 'Control.Enabled', 'Config.DHWParallelDistributionEnabled',
        'Devices.MyPV_DHW.Present', 'Devices.MyPV_DHW.ControlEnabled']) own(key, true);
    own('System.RealOutputsEnabled', false); own('System.LastUpdate', now); own('Plan.LastUpdate', now);
    own('Control.Valid', true); own('Control.LastUpdate', now);
    own('Config.DHWCommissioningMaxPower_W', 9000); own('Config.DHWControllerMaxPower_W', 9000);
    own('Config.SlowControlCycle_s', slowS); own('Config.WallboxStartDelay_s', delayS);
    own('Config.WallboxStartReserve_W', 300); own('Config.WallboxMaxStep_A', 6);
    own('Config.WallboxCombinedMaxStep_A', 1); own('Actual.GridPower_W', -surplusW);
    own('Actual.MyPV_DHW_W', 0); own('Actual.MyPV_Heating_W', 0);
    own('Devices.Battery.Present', battery); own('Devices.Battery.ControlEnabled', battery);
    own('Devices.Battery.DriverReady', battery); own('Devices.Battery.SingleHeadVerified', true);
    own('Config.BatteryMinSoC_pct', 20); own('Config.BatteryMaxSoC_pct', 95);
    own('Config.BatteryFineReserve_W', 200); own('Config.BatterySelfConsumptionEnabled', true);
    own('Devices.MyPV_Heating.Present', heating); own('Devices.MyPV_Heating.ControlEnabled', heating);
    own('Devices.MyPV_Heating.DriverReady', heating);
    own('Devices.HeatPump.Present', heatPump); own('Devices.HeatPump.ControlEnabled', heatPump);
    own('Config.HeatPumpAdviceEnabled', heatPump);
    for (const wb of [0, 1, 2]) {
        own(`Devices.Wallbox${wb}.Present`, wb === 0 && wallbox);
        own(`Devices.Wallbox${wb}.ControlEnabled`, wb === 0 && wallbox);
        own(`Vehicles.Wallbox${wb}.DepartureTime`, '');
        own(`Vehicles.Wallbox${wb}.PhaseSwitchEnabled`, false); own(`Vehicles.Wallbox${wb}.MaximumPhases`, 1);
        own(`Vehicles.Wallbox${wb}.MinCurrent1P_A`, 6); own(`Vehicles.Wallbox${wb}.MaxCurrent1P_A`, 32);
        own(`Config.Wallbox${wb}MaxPower_W`, 7360);
        put(`DP_WB${wb}_CAR`, 2); put(`DP_WB${wb}_SOC`, 50); put(`DP_WB${wb}_MIN_SOC`, 20);
        put(`DP_WB${wb}_TARGET`, 80); put(`DP_WB${wb}_ALLOW`, true); put(`DP_WB${wb}_RELEASE`, 1);
        put(`DP_WB${wb}_POWER`, 0);
        for (const p of [1, 2, 3]) put(`DP_WB${wb}_L${p}_A`, 0);
    }
    for (const id of ['DP_DHW_CONNECTION', 'DP_DHW_PARALLEL_RELEASE', 'goe.connection']) put(id, true);
    for (const id of ['DP_HA_CRITICAL', 'wp.cooling', 'hk.cooling']) put(id, false);
    for (const p of [1, 2, 3]) {
        put(`DP_DHW_OUTPUT${p}`, 0); put(`DP_DHW_HA_L${p}_CURRENT_A`, 0); put(`hk.power${p}`, 0);
    }
    for (const p of [1, 2, 3, 4]) put(`DP_DHW_TEMP${p}`, 50);
    put('DP_DHW_OUTLET_TEMP', 50); put('DP_GRID_IMPORT', 0); put('DP_GRID_EXPORT', surplusW);
    put('DP_PV_POWER', surplusW + 600); put('DP_HEAT_PUMP_POWER', 0);
    put('DP_HEAT_PUMP_BUFFER_TEMP', 35); put('DP_HEAT_PUMP_DHW_TEMP', 50);
    put('hk.connected', true); put('hk.temp', 35);
    put(config.batteryHeartbeatId, now); put(config.batteryOnlineId, true);
    put(config.batteryManualModeId, false); put(config.batteryLocalModeId, true);
    put(config.batteryAcPowerId, 0); put(mapping.DP_BATTERY_SOC, 50);
    put('goe.error', 0); put('goe.allow', 0); put('goe.current', 6); put('goe.phase', 1);
    for (const name of ['BatteryPower', 'MyPV_DHW', 'MyPV_Heating', 'Wallbox0', 'Wallbox1', 'Wallbox2'])
        own(`Plan.${name}_48h_JSON`, JSON.stringify([{timestamp: now - 1000, valueW: name === 'BatteryPower' ? 0 : 6000, phases: 1}]));
    const adapter = {namespace: 'ems.0', config, stateCache: states, getCachedState: id => states.get(id),
        readMapping: () => mapping, queueCompatState: async (id, val) => { if (!states.has(id)) put(id, val); },
        setCompatState: (id, val) => {
            assert.ok(id.startsWith('ems.0.Debug.Shadow.'), `shadow crossed write boundary: ${id}`);
            writes.push({id, val}); put(id, val);
        }, wallboxOutput: {devices: [{wb: 0, valid: true, owned: false, recovering: false,
            ids: {connection: 'goe.connection', error: 'goe.error', allow: 'goe.allow',
                command: 'goe.command', feedback: 'goe.current', phaseMode: 'goe.phase'}}]}};
    const shadow = new ShadowController(adapter, {now: () => now,
        createContext: sandbox => createEngineContext(adapter.namespace, mapping, sandbox, 'shadow-test')});
    await shadow.initialize();
    const flush = async () => { for (let i = 0; i < 12; i++) await Promise.resolve(); };
    await flush();
    const tick = async () => { await shadow.tick(); await flush(); };
    const advance = ms => {
        now += ms;
        for (const s of states.values()) s.ts = now;
        own('System.LastUpdate', now); own('Plan.LastUpdate', now); own('Control.LastUpdate', now);
        put(config.batteryHeartbeatId, now);
    };
    const direct = () => {
        const copied = structuredClone(states);
        copied.set('ems.0.System.RealOutputsEnabled', {val: true, ts: now, ack: true});
        const ctx = make(copied, {...structuredClone(config), globalWriteEnabled: true});
        vm.runInContext('updateVehicles(); updateDhwSimulation(); updateHeatingSimulation(); realtimeControl(); if (!coordinatedEnergyEnabled()) updateHeatPumpAdvice();', ctx);
        return copied;
    };
    return {shadow, adapter, states, writes, mapping, put, own, value, tick, advance, direct, flush};
}

test('shadow uses identical production modules and decisions while master remains off', async () => {
    const h = await fixture();
    const before = structuredClone([...h.states].filter(([id]) => !id.startsWith('ems.0.Debug.')));
    const config = structuredClone(h.adapter.config);
    const expected = h.direct();
    await h.tick();
    assert.equal(h.value('Valid'), true);
    assert.ok(h.value('Targets.Wallbox0_W') > 0);
    assert.ok(h.value('Targets.MyPV_DHW_W') > 0);
    for (const name of ['Battery', 'MyPV_DHW', 'MyPV_Heating', 'Wallbox0', 'Wallbox1', 'Wallbox2'])
        assert.equal(h.value(`Targets.${name}_W`), expected.get(`ems.0.Control.Targets.${name}_W`).val, name);
    assert.deepEqual([...h.states].filter(([id]) => !id.startsWith('ems.0.Debug.')), before);
    assert.deepEqual(h.adapter.config, config);
    assert.equal(h.adapter.config.globalWriteEnabled, false);
    assert.ok(h.writes.every(write => write.id.startsWith('ems.0.Debug.Shadow.')));
    assert.match(h.value('Snapshot_JSON'), /virtueller Befehlsbestaetigung/);
});

test('storage plus both heaters use real coordination and cooling blocks heating only', async () => {
    const h = await fixture({battery: true, heating: true, wallbox: false, surplusW: 9000});
    await h.tick();
    assert.equal(h.value('Valid'), true);
    assert.equal(h.value('FineRegulator'), 'Battery');
    assert.ok(h.value('Targets.Battery_W') > 0);
    assert.ok(h.value('Targets.MyPV_DHW_W') > 0);
    assert.ok(h.value('Targets.MyPV_Heating_W') > 0);
    const expected = h.direct();
    for (const name of ['Battery', 'MyPV_DHW', 'MyPV_Heating'])
        assert.equal(h.value(`Targets.${name}_W`), expected.get(`ems.0.Control.Targets.${name}_W`).val, name);
    h.put('hk.cooling', true); h.advance(2000); await h.tick();
    assert.equal(h.value('Targets.MyPV_Heating_W'), 0);
    assert.match(h.value('MyPV_Heating.Summary'), /Kuehl/);
    assert.ok(h.value('Targets.MyPV_DHW_W') > 0);
});

test('productive diagnostics never call an armed controller SIMULATION', async () => {
    const h = await fixture(); const direct = h.direct();
    assert.equal(direct.get('ems.0.Control.Mode').val, 'PRODUKTIVFREIGABE');
    assert.match(direct.get('ems.0.Control.Status').val, /^PRODUKTIVFREIGABE:/);
    assert.doesNotMatch(direct.get('ems.0.Devices.MyPV_DHW.Status').val, /nur Simulation/);
    await h.tick(); assert.match(h.value('Snapshot_JSON'), /virtueller/);
});

test('startup copies measured thermal hysteresis without changing live latches', async () => {
    const h = await fixture({heating: true, wallbox: false, surplusW: 9000});
    const live = vm.createContext({});
    vm.runInContext('let dhwTemperatureLock = true; const heatingOutput = {temperatureLock: true};', live);
    h.adapter.engineContext = live;
    h.put('hk.temp', 49); // target50, resume48: retain the established lock
    const liveSnapshot = () => vm.runInContext('JSON.stringify({dhw: dhwTemperatureLock, heating: heatingOutput.temperatureLock})', live);
    const before = liveSnapshot();
    await h.tick();
    assert.equal(h.value('Valid'), true);
    assert.equal(h.value('Targets.MyPV_Heating_W'), 0);
    assert.match(h.value('MyPV_Heating.Summary'), /Zieltemperatur erreicht/);
    assert.equal(liveSnapshot(), before, 'the shadow must not write or evaluate the live engine');
    h.put('hk.temp', 47); h.advance(2000); await h.tick();
    assert.ok(h.value('Targets.MyPV_Heating_W') > 0, 'real temperature below resume releases the private lock');
    assert.equal(liveSnapshot(), before, 'the private release must not change the live lock');
});

test('disabled storage hands fine regulation to heater without auto-arming storage', async () => {
    const h = await fixture({battery: true, heating: true, wallbox: false});
    h.adapter.config.batteryProductionArmed = false;
    await h.tick();
    assert.equal(h.value('Targets.Battery_W'), 0);
    assert.equal(h.value('FineRegulator'), 'MyPV_DHW');
    assert.match(h.value('Battery.Summary'), /nicht bestaetigt/);
    assert.equal(h.adapter.config.batteryProductionArmed, false);
});

test('latched real storage fault changes the fine regulator and clearing it restores storage', async () => {
    const h = await fixture({battery: true, heating: true, wallbox: false});
    await h.tick();
    assert.equal(h.value('FineRegulator'), 'Battery');
    h.own('Devices.Battery.Fault', 'Speicher folgt Sollwert nicht');
    h.advance(2000); await h.tick();
    assert.equal(h.value('Targets.Battery_W'), 0);
    assert.equal(h.value('FineRegulator'), 'MyPV_DHW');
    assert.match(h.value('Battery.Summary'), /folgt Sollwert nicht/);
    h.own('Devices.Battery.Fault', ''); h.advance(2000); await h.tick();
    assert.equal(h.value('FineRegulator'), 'Battery');
    assert.ok(h.value('Targets.Battery_W') > 0);
});

test('heat pump uses the same coordinated PV budget and cooling protection', async () => {
    const h = await fixture({battery: true, heating: true, wallbox: false, heatPump: true, surplusW: 6000});
    const expected = h.direct();
    await h.tick();
    assert.equal(h.value('HeatPump.Valid'), true, h.value('HeatPump.Summary'));
    assert.equal(h.value('Targets.HeatPumpMode'), 'BOOST', h.value('HeatPump.Summary'));
    assert.equal(h.value('Targets.HeatPumpMode'), expected.get('ems.0.Devices.HeatPump.RequestedMode').val);
    h.put('hk.cooling', true); h.advance(2000); await h.tick();
    assert.equal(h.value('HeatPump.Valid'), false);
    assert.equal(h.value('Targets.HeatPumpMode'), 'NORMAL');
    assert.match(h.value('HeatPump.Summary'), /Kuehlung/);
});

test('coordinated WP reclaimable PV is not overwritten by lower raw net export', async () => {
    const h = await fixture({battery: true, heating: true, wallbox: false, heatPump: true, surplusW: 500});
    h.put('DP_DHW_OUTPUT1', 2000); h.own('Actual.MyPV_DHW_W', 2000);
    h.put('hk.power1', 2000); h.own('Actual.MyPV_Heating_W', 2000);
    const expected = h.direct(); await h.tick();
    assert.equal(h.value('Targets.HeatPumpMode'), 'BOOST');
    assert.equal(h.value('Targets.HeatPumpMode'), expected.get('ems.0.Devices.HeatPump.RequestedMode').val);
    assert.equal(h.value('Actuals.Grid_W'), -500);
    h.states.delete('hk.cooling'); h.advance(2000); await h.tick();
    assert.equal(h.value('Targets.MyPV_Heating_W'), 0);
    assert.equal(h.value('HeatPump.Valid'), false);
    assert.equal(h.value('Targets.HeatPumpMode'), 'NORMAL');
});

test('shadow WP actuals normalize assigned kW and retain stale power as unknown', async () => {
    const h = await fixture({wallbox: false, heatPump: true, nowMs: 1000000});
    h.adapter.config.heatPumpPowerUnit = 'kW';
    h.adapter.config.heatPumpPowerScope = 'total';
    h.put('DP_HEAT_PUMP_POWER', 2);
    await h.tick();
    assert.equal(h.value('Actuals.HeatPump_W'), 2000);
    assert.equal(JSON.parse(h.value('Snapshot_JSON')).actuals.HeatPump, 2000);
    assert.equal(JSON.parse(h.value('Snapshot_JSON')).consumers.HeatPump.powerScope, 'total');
    assert.equal(JSON.parse(h.value('Snapshot_JSON')).consumers.HeatPump.powerValid, true);
    h.advance(31000);
    h.put('DP_HEAT_PUMP_POWER', 2, {ts: 1000000});
    await h.tick();
    assert.equal(h.value('Actuals.HeatPump_W'), null);
    assert.equal(JSON.parse(h.value('Snapshot_JSON')).actuals.HeatPump, null,
        'a fresh grid sample cannot refresh an old independent WP source');
    assert.equal(JSON.parse(h.value('Snapshot_JSON')).consumers.HeatPump.powerValid, false);
    h.put('DP_HEAT_PUMP_POWER', 0);
    await h.tick();
    assert.equal(h.value('Actuals.HeatPump_W'), 0);
    h.own('Devices.HeatPump.Present', false);
    await h.tick();
    assert.equal(h.value('Actuals.HeatPump_W'), null,
        'old source values of an absent future WP are not measured plant load');
});

test('fresh SoC, user release and device enable changes override previous shadow decisions', async () => {
    const h = await fixture(); await h.tick();
    assert.ok(h.value('Targets.Wallbox0_W') > 0);
    h.put('DP_WB0_SOC', 80); h.advance(2000); await h.tick();
    assert.equal(h.value('Targets.Wallbox0_W'), 0);
    h.put('DP_WB0_SOC', 50); h.put('DP_WB0_ALLOW', false); h.advance(2000); await h.tick();
    assert.equal(h.value('Targets.Wallbox0_W'), 0);
    h.put('DP_WB0_ALLOW', true); h.advance(2000); await h.tick();
    assert.ok(h.value('Targets.Wallbox0_W') > 0);
    h.own('Devices.Wallbox0.ControlEnabled', false); h.advance(2000); await h.tick();
    assert.equal(h.value('Targets.Wallbox0_W'), 0);
    assert.match(h.value('Wallbox0.Summary'), /Steuerfreigabe aus/);
    h.own('Devices.Wallbox0.ControlEnabled', true); h.advance(2000); await h.tick();
    assert.ok(h.value('Targets.Wallbox0_W') > 0);
});

test('device fault is a truthful output blocker beside unmodified production allocation', async () => {
    const h = await fixture();
    h.own('Devices.Wallbox0.OutputFault', 'Ladefreigabe nicht bestaetigt');
    const expected = h.direct(); await h.tick();
    assert.equal(h.value('Targets.Wallbox0_W'), expected.get('ems.0.Control.Targets.Wallbox0_W').val);
    assert.match(h.value('Wallbox0.OutputBlockReason'), /Ladefreigabe nicht bestaetigt/);
    assert.match(h.value('Summary'), /Ausgabe gesperrt fuer Wallbox0/);
    assert.equal(h.states.get('ems.0.Devices.Wallbox0.ControlEnabled').val, true);
});

test('slow-cycle selections and start timers remain isolated across 2-second ticks', async () => {
    const h = await fixture({delayS: 30, slowS: 5});
    h.own('Control.SelectedWallbox', 2);
    h.own('Control.WallboxSelectionReason', 'LIVE-Auswahl darf Schattenentscheidung nicht begruenden');
    h.own('Vehicles.Wallbox0.StartDelayRemaining_s', 999);
    await h.tick();
    assert.equal(h.value('SelectedWallbox'), 0);
    const selectionReason = JSON.parse(h.value('Snapshot_JSON')).selectionReason;
    assert.match(selectionReason, /Manuelle Prioritaet Wallbox 0/);
    assert.equal(latestRecord(h).selectionReason, selectionReason);
    assert.equal(h.value('Wallbox0.StartDelayRemaining_s'), 30);
    for (const elapsed of [2, 4, 6]) {
        h.advance(2000); await h.tick();
        assert.equal(h.value('SelectedWallbox'), 0, `selected after ${elapsed}s`);
        assert.equal(JSON.parse(h.value('Snapshot_JSON')).selectionReason, selectionReason,
            'private selection reason survives between slow cycles without borrowing live Control');
        assert.ok(h.value('Wallbox0.StartDelayRemaining_s') > 0 && h.value('Wallbox0.StartDelayRemaining_s') <= 30);
        assert.equal(h.value('Wallbox0.MinimumRunTimeRemaining_s'), 0);
    }
    h.advance(30000); await h.tick();
    assert.ok(h.value('Targets.Wallbox0_A') > 0);
    assert.equal(h.value('Wallbox0.MinimumRunTimeRemaining_s'), 0, 'a proposal cannot acknowledge a real start');
    assert.equal(h.states.get('ems.0.Vehicles.Wallbox0.StartDelayRemaining_s').val, 999);
});

test('master enabled, stale data, missing current slot and disable invalidate and clear proposals', async () => {
    for (const alter of [
        h => { h.adapter.config.globalWriteEnabled = true; },
        h => h.own('System.LastUpdate', 1),
        h => h.own('Plan.LastUpdate', 1),
        h => h.own('Plan.Wallbox0_48h_JSON', '[]'),
        h => h.shadow.handleCommand('ems.0.Debug.Shadow.Enabled', {val: false, ack: false})
    ]) {
        const h = await fixture(); await h.tick();
        assert.ok(h.value('Targets.MyPV_DHW_W') > 0);
        alter(h); await h.tick();
        assert.equal(h.value('Valid'), false);
        assert.equal(h.value('Targets.MyPV_DHW_W'), 0);
        assert.equal(h.value('Targets.Wallbox0_A'), 0);
        assert.equal(h.value('Actuals.Grid_W'), null);
    }
});

test('real ownership and pending power never become hypothetical acknowledgements', async () => {
    const h = await fixture({battery: true});
    h.own('Devices.Battery.OutputOwned', true);
    await h.tick();
    assert.equal(h.value('Valid'), false);
    assert.match(h.value('Summary'), /Ausgangsuebergabe/);
    assert.equal(h.states.get('ems.0.Devices.Battery.OutputOwned').val, true);
    h.own('Devices.Battery.OutputOwned', false); h.own('Devices.MyPV_DHW.OutputReservedPower_W', 1000);
    await h.tick(); assert.equal(h.value('Valid'), false);
});

test('forbidden actuator or SQL capability invalidates even when engine catches the exception', async () => {
    for (const source of ['try { writeForeignState("real.actuator", 1000) } catch (_) {}',
        'try { sendTo("sql.0", "query", {}) } catch (_) {}']) {
        const h = await fixture(); await h.tick();
        const original = h.shadow.createContext;
        h.shadow.context = null;
        h.shadow.createContext = sandbox => {
            const ctx = original(sandbox);
            vm.runInContext(`const oldRealtime = realtimeControl; realtimeControl = function () { oldRealtime(); ${source}; };`, ctx);
            return ctx;
        };
        await h.tick();
        assert.equal(h.value('Valid'), false);
        assert.equal(h.value('Targets.Wallbox0_W'), 0);
        assert.match(h.value('Summary'), /Nicht erlaubte/);
    }
});

test('absent measurements stay null and SQL list contains only bounded scalar own outputs', async () => {
    const h = await fixture();
    h.states.delete('DP_HEAT_PUMP_POWER');
    await h.tick();
    assert.equal(h.value('Actuals.HeatPump_W'), null);
    assert.ok(h.shadow.historyIds.includes('ems.0.Debug.Shadow.Targets.Wallbox0_W'));
    assert.ok(h.shadow.historyIds.includes('ems.0.Debug.Shadow.Actuals.Wallbox0_W'));
    assert.ok(h.shadow.historyIds.includes('ems.0.Debug.Shadow.Valid'));
    assert.ok(h.shadow.historyIds.every(id => id.startsWith('ems.0.Debug.Shadow.') && !id.endsWith('_JSON')));
    const count = h.writes.length;
    h.shadow.stop(); await h.tick(); assert.equal(h.writes.length, count);
});

// Inject only the allocator demand for deterministic disturbance scenarios.
// The full production output state machine, input gates, handshake, timing and
// protection still run unchanged in the isolated model.
function forceWallboxBudget(h, watts = 4000, phases = 1) {
    const original = h.shadow.createContext;
    h.shadow.createContext = sandbox => {
        const ctx = original(sandbox);
        ctx.testDemandW = watts;
        ctx.testPhases = phases;
        vm.runInContext(`const realControlForTest = realtimeControl;
            realtimeControl = function () {
                realControlForTest();
                write(CFG.root + '.Control.Targets.Wallbox0_W', testDemandW);
                write(CFG.root + '.Control.Targets.Wallbox0_A', Math.floor(testDemandW / (230 * testPhases)));
                write(CFG.root + '.Control.Targets.Wallbox0_Phases', testPhases);
            };`, ctx);
        return ctx;
    };
}

async function startModel(h) {
    for (let cycle = 0; cycle < 5; cycle++) { h.advance(2000); await h.tick(); }
    assert.ok(h.value('Modeled.Wallbox0_W') >= 1380, h.value('Wallbox0.ModelStatus'));
}

function addSecondWallbox(h) {
    Object.assign(h.adapter.config, {multiWallboxAlphaArmed: true, wb1Present: true,
        wb1ControlEnabled: true, wb1ProductionArmed: true, wb1MaxCurrent1pA: 32,
        wb1MinCurrent1pA: 6, wb1CommissioningMaxA: 32, wb1MaxPowerW: 7360,
        wb1PhaseSwitchEnabled: false, wb1ProductionPhases: 1});
    h.own('Devices.Wallbox1.Present', true); h.own('Devices.Wallbox1.ControlEnabled', true);
    h.put('goe1.connection', true); h.put('goe1.error', 0); h.put('goe1.allow', 0); h.put('goe1.current', 6);
    h.adapter.wallboxOutput.devices.push({wb: 1, valid: true, owned: false,
        ids: {connection: 'goe1.connection', error: 'goe1.error', allow: 'goe1.allow',
            feedback: 'goe1.current', command: 'goe1.command'}});
}

test('current private electrical response is available before allocation despite contrary published diagnostics', async () => {
    const h = await fixture();
    const create = h.shadow.createContext;
    h.shadow.createContext = sandbox => {
        const ctx = create(sandbox);
        ctx.testElectricalFrames = [];
        vm.runInContext(`const realControlForFrameTest = realtimeControl;
            realtimeControl = function () {
                testElectricalFrames.push(shadowElectricalResponseValid);
                return realControlForFrameTest();
            };`, ctx);
        return ctx;
    };
    h.own('Debug.Shadow.Response.Valid', false);
    await h.tick();
    assert.equal(h.shadow.model.response.valid, true);
    assert.equal(h.shadow.context.testElectricalFrames.at(-1), true,
        'the current valid private frame precedes allocation even when the last published marker is false');
    h.own('Debug.Shadow.Response.Valid', true);
    h.put('DP_WB0_POWER', 0, {q: 64});
    h.advance(2000); await h.tick();
    assert.equal(h.shadow.model.response.valid, false);
    assert.equal(h.shadow.context.testElectricalFrames.at(-1), false,
        'a previously published valid marker cannot repair this invalid electrical frame');
    h.own('Debug.Shadow.Response.Valid', false);
    h.put('DP_WB0_POWER', 0);
    h.advance(2000); await h.tick();
    assert.equal(h.shadow.context.testElectricalFrames.at(-1), true,
        'recovery is taken from the newly prepared response rather than a cached flag');
    assert.equal(h.states.get('goe.allow').val, 0);
    assert.ok(h.writes.every(write => write.id.startsWith('ems.0.Debug.Shadow.')));
});

async function startColdHandoffModel(h) {
    addSecondWallbox(h);
    h.adapter.config.wallboxPrioritySource = 'external';
    h.put('DP_WB_PRIORITY', 0);
    await h.tick();
    for (let elapsed = 2; elapsed < 120; elapsed += 2) {
        h.advance(2000); await h.tick();
        assert.equal(h.value('Modeled.Wallbox0_W'), 0, `cold start must wait at ${elapsed}s`);
    }
    for (let cycle = 0; cycle < 6 && !h.value('Modeled.Wallbox0_W'); cycle++) {
        h.advance(2000); await h.tick();
    }
    assert.ok(h.value('Modeled.Wallbox0_W') >= 1380, h.value('Wallbox0.ModelStatus'));
    h.advance(2000); await h.tick(); // Observe the owned active donor in this engine session.
}

test('valid private shadow handoff keeps the cold countdown but skips its repetition for manual priority', async () => {
    const h = await fixture({delayS: 120});
    await startColdHandoffModel(h);
    assert.equal(h.states.get('DP_WB0_L1_A').val, 0,
        'real zero current does not replace the explicitly valid private modeled donor response');
    h.put('goe1.allow', 1); h.put('DP_WB1_POWER', 2.76); h.put('DP_WB1_L1_A', 12);
    h.put('DP_WB_PRIORITY', 1);
    let newActive = false, handoffSeen = false;
    for (let cycle = 0; cycle < 15; cycle++) {
        h.advance(2000); await h.tick();
        const record = latestRecord(h);
        const modeled = record.modeled;
        assert.ok([modeled.Wallbox0, modeled.Wallbox1].filter(wb => wb.active).length <= 1,
            'the shortcut never overlaps modeled active electrical draw');
        const handoff = record.allocation?.Wallbox1?.start?.vehicleHandoff;
        handoffSeen ||= handoff?.qualified === true && handoff.from === 0 && handoff.to === 1;
        if (modeled.Wallbox1.active) { newActive = true; break; }
    }
    assert.ok(handoffSeen, 'the coherent record must show the qualified cross-vehicle handoff');
    assert.ok(newActive, h.value('Wallbox1.ModelStatus'));
    assert.equal(h.value('Modeled.Wallbox0_W'), 0);
    assert.equal(h.states.get('goe.allow').val, 0);
    assert.equal(h.states.get('goe1.allow').val, 1,
        'the independently selected actual car remains controlled by the real script');
    assert.equal(h.states.get('DP_WB1_POWER').val, 2.76);
    assert.ok(h.writes.every(write => write.id.startsWith('ems.0.Debug.Shadow.')));
});

test('valid shadow target-SoC finish hands off without repeating the cold start countdown', async () => {
    const h = await fixture({delayS: 120});
    await startColdHandoffModel(h);
    h.put('DP_WB0_SOC', 80);
    let newActive = false, naturalHandoffSeen = false;
    for (let cycle = 0; cycle < 15; cycle++) {
        h.advance(2000); await h.tick();
        const record = latestRecord(h);
        const handoff = record.allocation?.Wallbox1?.start?.vehicleHandoff;
        naturalHandoffSeen ||= handoff?.qualified === true && handoff.from === 0 && handoff.to === 1;
        assert.ok([record.modeled.Wallbox0, record.modeled.Wallbox1].filter(wb => wb.active).length <= 1);
        if (record.modeled.Wallbox1.active) { newActive = true; break; }
    }
    assert.ok(naturalHandoffSeen, 'the normal target-SoC finish must retain its qualified donor evidence');
    assert.equal(h.states.get('DP_WB_PRIORITY').val, 0,
        'the successor starts after target SoC despite retained priority for the completed donor');
    assert.ok(newActive, h.value('Wallbox1.ModelStatus'));
    assert.equal(h.states.get('goe.allow').val, 0);
    assert.equal(h.states.get('goe1.allow').val, 0);
});

test('unknown shadow response revokes a prepared handoff and cannot confirm a modeled electrical stop', async () => {
    const h = await fixture({delayS: 120});
    await startColdHandoffModel(h);
    h.put('DP_WB_PRIORITY', 1);
    h.advance(2000); await h.tick();
    let record = latestRecord(h);
    assert.equal(record.allocation.Wallbox1.start.vehicleHandoff.qualified, true);
    h.own('Debug.Shadow.Response.Valid', true);
    h.put('DP_WB0_POWER', 0, {q: 64});
    h.advance(2000); await h.tick();
    record = latestRecord(h);
    assert.equal(h.shadow.context.shadowElectricalResponseValid, false);
    assert.equal(record.response.valid, false);
    assert.equal(record.allocation.Wallbox1.start.vehicleHandoff.qualified, false);
    assert.equal(record.modeled.Wallbox1.active, false);
    assert.equal(record.modeled.Wallbox0.owned, true,
        'an OFF ACK alone cannot release the donor when its electrical model is unknown');
    assert.equal(record.modeled.Wallbox0.stopPowerPending, true);
    h.put('DP_WB0_POWER', 0);
    for (let cycle = 0; cycle < 15; cycle++) {
        h.advance(2000); await h.tick();
        record = latestRecord(h);
        assert.equal(record.modeled.Wallbox1.active, false,
            'restored data must use normal qualification, not resurrect the revoked shortcut');
        assert.equal(record.allocation.Wallbox1.start.vehicleHandoff.qualified, false);
    }
    assert.equal(h.states.get('goe.allow').val, 0);
    assert.equal(h.states.get('goe1.allow').val, 0);
    assert.ok(h.writes.every(write => write.id.startsWith('ems.0.Debug.Shadow.')));
});

test('a sixteen-second historical frame does not turn fresh real grid protection stale', async () => {
    const h = await fixture();
    forceWallboxBudget(h);
    await startModel(h);
    const model = h.shadow.model;
    const now = model.now();
    const ids = [h.mapping.DP_GRID_IMPORT, h.mapping.DP_GRID_EXPORT, h.mapping.DP_WB0_POWER];
    model.sampleBuffer.clear();
    const raw = new Map(model.rawStates);
    for (const [ts, power] of [[now - 25000, 3.68], [now - 16000, 3.68]]) {
        raw.set(ids[0], {val: 230, ts, ack: true, q: 0});
        raw.set(ids[1], {val: 0, ts, ack: true, q: 0});
        raw.set(ids[2], {val: power, ts, ack: true, q: 0});
        model.sampleBuffer.capture(raw, ids, ts);
    }
    raw.set(ids[0], {val: 300, ts: now, ack: true, q: 0});
    raw.set(ids[1], {val: 0, ts: now, ack: true, q: 0});
    raw.set(ids[2], {val: 3.7, ts: now - 3000, ack: true, q: 0});
    model.rawStates = raw;
    model.prepareResponse();
    assert.equal(model.response.basis, 'bracketed-historical-input');
    assert.equal(model.response.inputAgeMs, 16000);
    assert.equal(model.states.get(ids[0]).ts, now - 16000, 'never redate the historic modeled baseline');
    h.advance(100);
    await model.tick();
    assert.equal(model.decision(0).active, true, model.decision(0).status);
    assert.equal(h.states.get('goe.allow').val, 0, 'no real actuator write');
    for (const extra of [{ts: now - 10001}, {ack: false}, {q: 64}, {val: null}, {val: 'bad'},
        {val: -1}, {ts: model.now() + 1001}]) {
        model.rawStates.set(ids[0], {val: 300, ts: model.now(), ack: true, q: 0, ...extra});
        assert.equal(model.output.number(ids[0], 10000), null, 'real source problems remain hard gates');
    }
    await model.tick();
    assert.equal(model.decision(0).active, false, 'an actually invalid real grid source stops the output');
});

test('private production output models startup and ramps while actual measurements stay real', async () => {
    const h = await fixture();
    h.adapter.config.slowCycleS = 2;
    h.adapter.config.wallboxMinimumRunTimeS = 60;
    h.put('DP_WB0_L1_A', 16); h.put('DP_WB0_POWER', 3.68);
    const devicesBefore = structuredClone(h.adapter.wallboxOutput.devices);
    forceWallboxBudget(h, 6000);
    await startModel(h);
    const before = h.value('Modeled.Wallbox0_A');
    h.advance(2000); await h.tick();
    h.advance(2000); await h.tick();
    assert.ok(h.value('Modeled.Wallbox0_A') > before, 'acknowledged modeled output ramps beyond initial 6 A');
    assert.ok(h.value('Wallbox0.MinimumRunTimeRemaining_s') > 0);
    assert.equal(h.value('Actuals.Wallbox0_W'), 3680);
    assert.equal(h.states.get('goe.allow').val, 0, 'the real command feedback was never changed');
    assert.equal(h.states.get('goe.current').val, 6);
    assert.equal(h.shadow.states.get('goe.allow').val, 1, 'assumed acknowledgement lives only in isolated Map');
    assert.deepEqual(h.adapter.wallboxOutput.devices, devicesBefore);
    const snapshot = JSON.parse(h.value('Snapshot_JSON'));
    assert.equal(snapshot.realFeedback.Wallbox0.allow.value, 0);
    assert.equal(snapshot.modeled.Wallbox0.active, true);
    assert.ok(h.writes.every(write => write.id.startsWith('ems.0.Debug.Shadow.')));
});

test('short zero budgets are held and recovered; long deficits stop after configured delay', async () => {
    const h = await fixture();
    h.adapter.config.wallboxMinimumRunTimeS = 0;
    h.adapter.config.wallboxStopDelayS = 10;
    forceWallboxBudget(h);
    await startModel(h);
    h.shadow.context.testDemandW = 0;
    h.advance(2000); await h.tick();
    assert.equal(h.value('Targets.Wallbox0_W'), 0);
    assert.equal(h.value('Modeled.Wallbox0_W'), 1380);
    assert.equal(h.value('Wallbox0.StopDelayRemaining_s'), 10);
    h.advance(4000); await h.tick();
    assert.equal(h.value('Modeled.Wallbox0_W'), 1380);
    h.shadow.context.testDemandW = 4000;
    h.advance(2000); await h.tick();
    assert.equal(h.value('Wallbox0.StopDelayRemaining_s'), 0);
    h.shadow.context.testDemandW = 0;
    h.advance(2000); await h.tick();
    h.advance(10000); await h.tick();
    assert.equal(h.value('Modeled.Wallbox0_W'), 0);
    assert.match(h.value('Wallbox0.ModelStatus'), /unter Mindeststrom/);
    h.advance(2000); await h.tick();
    assert.equal(h.value('Wallbox0.ModelOwned'), false);
});

test('modeled minimum runtime outlasts stop delay but never overrides hard release', async () => {
    const h = await fixture();
    h.adapter.config.wallboxMinimumRunTimeS = 60;
    h.adapter.config.wallboxStopDelayS = 5;
    forceWallboxBudget(h);
    await startModel(h);
    h.shadow.context.testDemandW = 0;
    h.advance(2000); await h.tick();
    h.advance(10000); await h.tick();
    assert.equal(h.value('Modeled.Wallbox0_W'), 1380);
    assert.ok(h.value('Wallbox0.MinimumRunTimeRemaining_s') > 0);
    h.put('DP_WB0_ALLOW', false, {ack: false});
    h.advance(2000); await h.tick();
    assert.equal(h.value('Modeled.Wallbox0_W'), 0);
    assert.match(h.value('Wallbox0.ModelStatus'), /freigabe/i);
});

test('minimum runtime eventually expires and persistent modeled deficit stops', async () => {
    const h = await fixture();
    h.adapter.config.wallboxMinimumRunTimeS = 30;
    h.adapter.config.wallboxStopDelayS = 5;
    forceWallboxBudget(h);
    await startModel(h);
    h.shadow.context.testDemandW = 0;
    h.advance(2000); await h.tick();
    h.advance(10000); await h.tick();
    assert.equal(h.value('Modeled.Wallbox0_W'), 1380);
    h.advance(30000); await h.tick();
    assert.equal(h.value('Modeled.Wallbox0_W'), 0);
    assert.equal(h.value('Wallbox0.MinimumRunTimeRemaining_s'), 0);
});

test('priority handoff preserves the production single-wallbox interlock in the model', async () => {
    const h = await fixture();
    addSecondWallbox(h);
    await startModel(h);
    assert.equal(h.value('SelectedWallbox'), 0);
    h.put('DP_WB0_SOC', 80);
    for (let cycle = 0; cycle < 7; cycle++) {
        h.advance(2000); await h.tick();
        const modeled = JSON.parse(h.value('Snapshot_JSON')).modeled;
        assert.ok([modeled.Wallbox0, modeled.Wallbox1].filter(wb => wb.active).length <= 1);
    }
    assert.equal(h.value('SelectedWallbox'), 1);
    assert.equal(h.value('Modeled.Wallbox0_W'), 0);
    assert.ok(h.value('Modeled.Wallbox1_W') > 0, h.value('Wallbox1.ModelStatus'));
    assert.equal(h.states.get('goe.allow').val, 0);
    assert.equal(h.states.get('goe1.allow').val, 0);
});

test('phase request remains blocked until real confirmation and reaches the production timeout', async () => {
    const h = await fixture();
    h.adapter.config.wb0PhaseSwitchEnabled = true;
    h.adapter.config.wb0PhaseControlMode = 'ems';
    h.adapter.config.wallboxPhaseSwitchTimeoutS = 30;
    forceWallboxBudget(h, 5000, 3);
    await h.tick();
    assert.equal(h.value('Modeled.Wallbox0_W'), 0);
    assert.match(h.value('Wallbox0.OutputBlockReason'), /Phasen/);
    h.advance(31000); await h.tick();
    let snapshot = JSON.parse(h.value('Snapshot_JSON'));
    assert.equal(snapshot.modeled.Wallbox0.phaseSwitchTimedOut, true);
    assert.equal(h.states.get('goe.phase').val, 1, 'no virtual phase acknowledgement is invented');
    h.put('goe.phase', 2); h.advance(2000); await h.tick();
    snapshot = JSON.parse(h.value('Snapshot_JSON'));
    assert.equal(snapshot.modeled.Wallbox0.phaseSwitchTimedOut, false);
});

test('read-only PV accepts ack=false while actuator feedback stays strict', async () => {
    const h = await fixture();
    h.put('DP_PV_POWER', 4321, {ack: false});
    forceWallboxBudget(h);
    await startModel(h);
    assert.equal(h.value('Actuals.PV_W'), 4321);
    h.put('goe.current', 16, {ack: false});
    h.advance(2000); await h.tick();
    assert.equal(h.value('Modeled.Wallbox0_W'), 0);
    assert.match(h.value('Wallbox0.ModelStatus'), /Rueckmeldung/);
    h.put('DP_PV_POWER', 4321, {ack: false, q: 1});
    h.advance(2000); await h.tick();
    assert.equal(h.value('Actuals.PV_W'), null);
    h.put('DP_PV_POWER', 4321, {ack: false, ts: Date.now() - 200000});
    await h.tick();
    assert.equal(h.value('Actuals.PV_W'), null);
});

test('master switch resets virtual ownership while coherent real feedback remains recorded', async () => {
    const h = await fixture();
    forceWallboxBudget(h);
    await startModel(h);
    h.adapter.config.globalWriteEnabled = true;
    h.put('goe.allow', 1); h.put('DP_WB0_POWER', 2.5);
    h.advance(2000); await h.tick();
    let record = latestRecord(h);
    assert.equal(record.valid, false);
    assert.equal(record.masterEnabled, true);
    assert.equal(record.realFeedback.Wallbox0.allow.value, 1);
    assert.equal(record.realFeedback.Wallbox0.powerKW.value, 2.5);
    assert.equal(record.modeled, undefined);
    assert.equal(h.shadow.model, null);
    h.adapter.config.globalWriteEnabled = false;
    h.put('goe.allow', 0); h.advance(2000); await h.tick();
    record = latestRecord(h);
    assert.equal(record.valid, true);
    assert.equal(record.modeled.Wallbox0.active, false, 'restart begins a fresh modeled handshake');
    assert.equal(record.targets.Wallbox0, h.value('Targets.Wallbox0_W'));
    assert.equal(record.modeled.Wallbox0.powerW, h.value('Modeled.Wallbox0_W'));
});

test('productive DecisionRecord samples quiet ticks sparsely and retains discrete and quality changes', async () => {
    const h = await fixture();
    h.adapter.config.globalWriteEnabled = true;
    await h.tick();
    const records = () => h.writes.filter(write => write.id.endsWith('.DecisionRecord'));
    const count = records().length;
    for (let cycle = 0; cycle < 5; cycle++) { h.advance(2000); await h.tick(); }
    assert.equal(records().length, count, 'quiet ticks are not full-record heartbeats');
    h.put('DP_WB0_CAR', 1); h.advance(2000); await h.tick();
    assert.equal(records().length, count + 1);
    const edge = latestRecord(h);
    assert.equal(edge.realFeedback.Wallbox0.car.value, 1);
    assert.equal(edge.realFeedback.Wallbox0.car.ts, edge.timestamp);
    h.advance(60000); await h.tick();
    assert.equal(records().length, count + 2);
    h.put('goe.current', 9); h.advance(2000); await h.tick();
    assert.equal(records().length, count + 3, 'real current changes are captured even while shadow is paused');
    h.put('goe.current', 9, {ack: false}); h.advance(2000); await h.tick();
    assert.equal(records().length, count + 4, 'quality transitions remain explicit during productive sampling');
});

test('DecisionRecord keeps selection reasons and emits reason changes with the same selected wallbox', async () => {
    const h = await fixture();
    const record = {valid: false, masterEnabled: false, selectedWallbox: 0,
        selectionReason: 'Manuelle Prioritaet WB0', targets: {Wallbox0: 0},
        modeled: {}, realFeedback: {}, response: {valid: false, applied: false, reason: 'Quelle fehlt'}};
    const count = () => h.writes.filter(write => write.id.endsWith('.DecisionRecord')).length;
    h.shadow.publishRecord(record); await h.flush();
    const first = count();
    assert.equal(latestRecord(h).selectionReason, record.selectionReason);
    h.shadow.publishRecord(record); await h.flush();
    assert.equal(count(), first, 'unchanged diagnostics do not create duplicate events');
    record.selectionReason = 'Manuelle Uebergabe WB0 wird abgeschlossen';
    h.shadow.publishRecord(record); await h.flush();
    assert.equal(count(), first + 1, 'a new reason is retained even while the electrical model is invalid');
    const persisted = latestRecord(h);
    assert.equal(persisted.selectedWallbox, 0);
    assert.equal(persisted.selectionReason, record.selectionReason);
    assert.equal(persisted.valid, false);
});

test('invalid response records coalesce skew magnitudes but preserve model and real safety edges', async () => {
    const h = await fixture();
    const record = {valid: false, masterEnabled: false, targets: {Wallbox0: 0},
        selectedWallbox: 0, fineRegulator: 'none',
        response: {valid: false, applied: false, basis: 'previous-output',
            reason: 'Wallbox0:grid-power-asynchronous (3000 ms, 2000 W)'},
        modeled: {Wallbox0: {powerW: 0, phases: 1, owned: false, stage: 'off',
            status: 'Warten auf EHZ-Feinregler: Ist 2000 W / Ziel 0 W'}},
        realFeedback: {Wallbox0: {error: {value: 0, ack: true, q: 0, fresh: true, issue: ''},
            allow: {value: 1, ack: true, q: 0, fresh: true, issue: ''}}}};
    const count = () => h.writes.filter(w => w.id.endsWith('.DecisionRecord')).length;
    h.shadow.publishRecord(record); await h.flush(); const first = count();
    record.response.reason = 'Wallbox0:grid-power-asynchronous (4000 ms, 2500 W)';
    record.modeled.Wallbox0.status = 'Warten auf EHZ-Feinregler: Ist 2100 W / Ziel 0 W';
    h.shadow.publishRecord(record); await h.flush(); assert.equal(count(), first);
    record.realFeedback.Wallbox0.error.value = 5;
    h.shadow.publishRecord(record); await h.flush(); assert.equal(count(), first + 1);
    record.realFeedback.Wallbox0.allow.value = 0;
    h.shadow.publishRecord(record); await h.flush(); assert.equal(count(), first + 2);
    record.modeled.Wallbox0.stage = 'stopping';
    h.shadow.publishRecord(record); await h.flush(); assert.equal(count(), first + 3);
    h.advance(60000); h.shadow.publishRecord(record); await h.flush(); assert.equal(count(), first + 4);
    record.masterEnabled = true;
    h.shadow.publishRecord(record); await h.flush(); assert.equal(count(), first + 5);
    record.modeled.Wallbox0.responseState = 'vehicle_response';
    record.modeled.Wallbox0.responseCommandA = 6;
    record.modeled.Wallbox0.responseSentAt = 100;
    h.shadow.publishRecord(record); await h.flush(); assert.equal(count(), first + 6);
    record.modeled.Wallbox0.responseAcknowledgedAt = 115;
    h.shadow.publishRecord(record); await h.flush(); assert.equal(count(), first + 7);
    record.modeled.Wallbox0.responseState = 'modeled';
    record.modeled.Wallbox0.responseConfirmedAt = 130;
    h.shadow.publishRecord(record); await h.flush(); assert.equal(count(), first + 8);
    const persisted = latestRecord(h).modeled.Wallbox0;
    assert.equal(persisted.responseState, 'modeled');
    assert.equal(persisted.responseAcknowledgedAt, 115);
    assert.equal(persisted.responseConfirmedAt, 130);
});

test('response coverage counts elapsed state, marks long gaps unknown and remains session scoped', async () => {
    const h = await fixture(); await h.tick();
    const model = h.shadow.model;
    const firstAt = model.response.coverage.since;
    h.advance(2000); await h.tick();
    assert.equal(model.response.coverage.validMs + model.response.coverage.invalidMs, 2000);
    h.advance(70000); await h.tick();
    assert.equal(model.response.coverage.unknownMs, 70000);
    assert.equal(model.response.coverage.since, firstAt);
    assert.equal(model.response.coverage.scope, 'current-model-session');
});

test('isolated output facade rejects foreign targets and never exposes subscription/SQL capabilities', async () => {
    const h = await fixture();
    await h.tick();
    const facade = h.shadow.model.output.adapter;
    await assert.rejects(facade.setForeignStateAsync('real.unlisted.actuator', 10), /Nicht erlaubte/);
    assert.throws(() => facade.sendTo('sql.0'), /Nicht erlaubte/);
    assert.throws(() => facade.subscribeForeignStatesAsync('*'), /Nicht erlaubte/);
    assert.equal(h.adapter.stateCache.has('real.unlisted.actuator'), false);
    h.shadow.stop();
    await facade.setForeignStateAsync('goe.allow', 1);
    assert.equal(h.states.get('goe.allow').val, 0);
});

function delayDecisionWrites(h) {
    const original = h.adapter.setCompatState;
    const attempts = [];
    h.adapter.setCompatState = (id, value, ack) => {
        if (!id.endsWith('.DecisionRecord')) return original(id, value, ack);
        return new Promise((resolve, reject) => {
            attempts.push({record: JSON.parse(value),
                resolve: () => { original(id, value, ack); resolve(); }, reject});
        });
    };
    const enqueue = powerW => h.shadow.enqueueRecord({schema: 1, cycleId: powerW,
        timestamp: Date.now(), valid: true, targets: {Wallbox0: powerW}});
    return {attempts, enqueue};
}

test('slow SQL publication preserves positive-zero-positive decision transitions in FIFO order', async () => {
    const h = await fixture();
    const {attempts, enqueue} = delayDecisionWrites(h);
    enqueue(1380); enqueue(0); enqueue(1610);
    assert.equal(attempts.length, 1);
    assert.equal(h.shadow.recordQueue.length, 2);
    assert.ok(h.shadow.pending.has('DecisionRecord'));
    attempts[0].resolve(); await h.flush();
    assert.equal(attempts.length, 2);
    attempts[1].resolve(); await h.flush();
    assert.equal(attempts.length, 3);
    attempts[2].resolve(); await h.flush();
    assert.deepEqual(attempts.map(item => item.record.targets.Wallbox0), [1380, 0, 1610]);
    const sequence = attempts.map(item => item.record.recordSequence);
    assert.deepEqual(sequence, [sequence[0], sequence[0] + 1, sequence[0] + 2]);
    assert.ok(attempts.every(item => item.record.recording.dropped === 0));
    assert.equal(h.shadow.pending.has('DecisionRecord'), false);
    assert.equal(h.value('RecordQueueDepth'), 0);
    assert.ok(h.writes.every(write => write.id.startsWith('ems.0.Debug.Shadow.')));
});

test('failed record writes are nonblocking and the next coherent record exposes the failure', async () => {
    const h = await fixture();
    const {attempts, enqueue} = delayDecisionWrites(h);
    enqueue(1380); enqueue(0);
    attempts[0].reject(new Error('diagnostic persistence unavailable'));
    await h.flush();
    assert.equal(attempts.length, 2);
    assert.equal(attempts[1].record.recording.writeErrors, 1);
    assert.match(attempts[1].record.recording.lastError, /persistence unavailable/);
    assert.equal(h.value('RecordWriteErrors'), 1);
    assert.equal(h.shadow.recordDropped, 0, 'unconfirmed writes and definite queue drops are counted separately');
    attempts[1].resolve(); await h.flush();
    assert.equal(h.shadow.pending.has('DecisionRecord'), false);
    assert.equal(h.states.get('goe.allow').val, 0);
});

test('decision FIFO is bounded and overflow is visible through sequence gaps and cumulative counts', async () => {
    const h = await fixture();
    const {attempts, enqueue} = delayDecisionWrites(h);
    for (let value = 0; value < 140; value++) enqueue(value);
    await h.flush();
    assert.equal(attempts.length, 1);
    assert.equal(h.shadow.recordQueue.length, 128);
    assert.equal(h.shadow.recordDropped, 11);
    assert.equal(h.value('RecordQueueDepth'), 129);
    assert.equal(h.value('RecordDropped'), 11);
    attempts[0].resolve(); await h.flush();
    assert.equal(attempts[1].record.recording.dropped, 11);
    assert.equal(attempts[1].record.recordSequence - attempts[0].record.recordSequence, 12);
    assert.equal(attempts[1].record.targets.Wallbox0, 12, 'the oldest queued records were dropped, not the in-flight record');
    h.shadow.stop();
    attempts[1].resolve(); await h.flush();
    assert.equal(attempts.length, 2);
    assert.equal(h.shadow.recordQueue.length, 0);
    assert.equal(h.shadow.pending.has('DecisionRecord'), false);
});

test('unload discards waiting records without starting new writes or delaying actuator shutdown', async () => {
    const h = await fixture();
    const {attempts, enqueue} = delayDecisionWrites(h);
    enqueue(1380); enqueue(0); enqueue(1610);
    h.adapter.unloading = true;
    h.shadow.stop();
    assert.equal(h.shadow.recordQueue.length, 0);
    assert.equal(h.shadow.recordDropped, 2);
    enqueue(1840);
    attempts[0].resolve(); await h.flush();
    assert.equal(attempts.length, 1, 'only the already-running diagnostic write can finish');
    assert.equal(h.shadow.pending.size, 0);
    assert.equal(h.shadow.recordWriting, false);
    assert.equal(h.states.get('goe.allow').val, 0);
});

function syntheticWallboxInputs(h, {pv = 25 * 230, wallboxW = 16 * 230} = {}) {
    // Independent nominal electrical scenario: 230 V, 16 A legacy WB,
    // 6 A heater, 4 A base load and 25 A equivalent PV production.
    const heaterW = 6 * 230, baseW = 4 * 230;
    const gridW = baseW + heaterW + wallboxW - pv;
    h.put('DP_PV_POWER', pv);
    h.put('DP_GRID_IMPORT', Math.max(0, gridW)); h.put('DP_GRID_EXPORT', Math.max(0, -gridW));
    h.put('DP_WB0_POWER', wallboxW / 1000); h.put('DP_WB0_L1_A', wallboxW / 230);
    h.put('DP_DHW_OUTPUT1', heaterW); h.own('Actual.MyPV_DHW_W', heaterW);
}

test('mismatched virtual and legacy currents keep charging beyond 600 seconds without hybrid-response stops', async () => {
    const h = await fixture();
    h.adapter.config.wallboxMinimumRunTimeS = 600;
    h.adapter.config.wallboxStopDelayS = 120;
    h.adapter.config.wallboxCombinedMaxStepA = 3;
    h.own('Config.WallboxCombinedMaxStep_A', 3);
    syntheticWallboxInputs(h);
    await startModel(h);
    for (let elapsed = 0; elapsed <= 780; elapsed += 10) {
        h.advance(10000); syntheticWallboxInputs(h); await h.tick();
        const snapshot = JSON.parse(h.value('Snapshot_JSON'));
        assert.equal(snapshot.valid, true);
        assert.ok(snapshot.modeled.Wallbox0.active, `unexpected stop after ${elapsed}s: ${snapshot.modeled.Wallbox0.status}`);
        assert.ok(snapshot.targets.Wallbox0 >= 1380, `unjustified zero budget after ${elapsed}s`);
        assert.equal(snapshot.actuals.Wallbox0, 16 * 230);
        assert.equal(snapshot.actuals.Grid, 230);
        assert.equal(snapshot.response.wallboxes.Wallbox0.powerW,
            snapshot.allocation.Wallbox0.actualPowerW);
        assert.equal(snapshot.response.gridW,
            snapshot.actuals.Grid + snapshot.response.wallboxes.Wallbox0.powerW - 16 * 230);
    }
});

test('paired constant and variable PV replays do not depend on legacy-script WB draw', async () => {
    for (const varying of [false, true]) {
        const a = await fixture(), b = await fixture();
        for (let cycle = 0; cycle < 45; cycle++) {
            const pv = (varying ? [25, 22, 32, 27, 30][Math.floor(cycle / 9)] : 25) * 230;
            for (const [h, wallboxW] of [[a, 16 * 230], [b, (cycle % 2 ? 20 : 6) * 230]]) {
                h.advance(2000); syntheticWallboxInputs(h, {pv, wallboxW}); await h.tick();
            }
            assert.equal(a.value('Targets.Wallbox0_A'), b.value('Targets.Wallbox0_A'), `target cycle ${cycle}`);
            assert.equal(a.value('Modeled.Wallbox0_A'), b.value('Modeled.Wallbox0_A'), `model cycle ${cycle}`);
            assert.equal(a.value('Response.Grid_W'), b.value('Response.Grid_W'), `private NVP cycle ${cycle}`);
        }
    }
});

test('assumed response retains real source faults, error changes and phase protections in coherent records', async () => {
    for (const change of [
        h => h.put('DP_WB0_POWER', -0.021),
        h => h.put('DP_WB0_POWER', 16 * 230 / 1000, {q: 64}),
        h => h.put('DP_WB0_POWER', 16 * 230 / 1000, {ts: 1}),
        h => h.put('goe.error', 8),
        h => h.put('goe.connection', false),
        h => h.put('DP_WB0_L2_A', 5)
    ]) {
        const h = await fixture(); syntheticWallboxInputs(h); await startModel(h);
        h.advance(2000); change(h); await h.tick();
        const record = latestRecord(h);
        assert.equal(h.value('Modeled.Wallbox0_W'), 0, h.value('Wallbox0.ModelStatus'));
        assert.equal(record.modeled.Wallbox0.active, false);
        assert.equal(record.realFeedback.Wallbox0.error.value, h.states.get('goe.error').val);
        assert.equal(record.realFeedback.Wallbox0.connection.value, h.states.get('goe.connection').val);
        assert.ok(Number.isFinite(record.realFeedback.Wallbox0.powerKW.ageMs));
        if (!record.response.valid) {
            assert.equal(record.valid, false, 'invalid electrical sources cannot produce a valid hybrid replay');
            assert.equal(h.value('Valid'), false);
            assert.match(record.reason, /Schattenantwort ungueltig/);
        }
    }
});

test('private acknowledgements do not hide out-of-range real actuator feedback', async () => {
    for (const [id, value] of [['goe.allow', 2], ['goe.current', -1]]) {
        const h = await fixture(); forceWallboxBudget(h); await startModel(h);
        h.advance(2000); h.put(id, value); await h.tick();
        assert.equal(h.value('Modeled.Wallbox0_W'), 0, `invalid ${id} must stop`);
        const record = latestRecord(h);
        assert.equal(record.realFeedback.Wallbox0[id === 'goe.allow' ? 'allow' : 'currentA'].value, value);
    }
});

test('coherent feedback distinguishes stale/numeric/negative sources and keeps static connection fresh', async () => {
    const h = await fixture();
    h.put('goe.connection', true, {ts: 1});
    h.put('DP_WB0_POWER', '0.2');
    await h.tick();
    let feedback = JSON.parse(h.value('Snapshot_JSON')).realFeedback.Wallbox0;
    assert.equal(feedback.connection.fresh, true);
    assert.equal(feedback.connection.issue, '');
    assert.equal(feedback.powerKW.issue, '');
    for (const [value, extra, issue] of [[-0.021, {}, 'negative'], ['bad', {}, 'numeric'], [1, {ts: 1}, 'stale']]) {
        h.put('DP_WB0_POWER', value, extra); await h.tick();
        feedback = latestRecord(h).realFeedback.Wallbox0;
        assert.equal(feedback.powerKW.issue, issue);
        assert.equal(feedback.powerKW.value, value);
    }
});

test('retained user settings have valid quality despite old timestamps and ack=false', async () => {
    const h = await fixture();
    for (const key of ['ALLOW', 'TARGET', 'MIN_SOC'])
        h.put(`DP_WB0_${key}`, key === 'ALLOW' ? true : 80, {ts: 1, ack: false});
    const feedback = h.shadow.realWallboxFeedback(0);
    for (const key of ['userRelease', 'targetSoc', 'minimumSoc']) {
        assert.equal(feedback[key].fresh, true, key);
        assert.equal(feedback[key].issue, '', key);
        assert.equal(feedback[key].ack, false, key);
    }
    h.put('DP_WB0_CAR', 2, {ts: 1, ack: false});
    assert.equal(h.shadow.realWallboxFeedback(0).car.issue, 'unacknowledged');
});

test('synthetic long WB1 electrical trajectory runs without artificial zero-budget stops', async t => {
    // Entirely generated test inputs, independent of any private SQL history.
    const samples = Array.from({length: 263}, (_, index) => {
        const finished = index >= 260;
        const pvW = [5700, 6800, 8200, 6100, 7500][Math.floor(index / 7) % 5];
        const dhwW = 1600;
        const wallboxW = finished ? 0 : [2300, 3900, 5500, 3100][index % 4];
        return {elapsedS: index * 50, pvW, dhwW, wallboxW,
            gridW: 800 + dhwW + wallboxW - pvW,
            soc: finished ? 80 : 40 + Math.floor(index * 40 / 260),
            car: finished ? 4 : 2, userRelease: true, targetSoc: 80, minimumSoc: 20, phaseMode: 1};
    });
    const start = Date.parse('2025-01-01T10:00:00Z');
    const h = await fixture({nowMs: start, wallbox: false});
    Object.assign(h.adapter.config, {multiWallboxAlphaArmed: true, wb1Present: true,
        wb1ControlEnabled: true, wb1ProductionArmed: true, wb1MaxCurrent1pA: 32,
        wb1MinCurrent1pA: 6, wb1CommissioningMaxA: 32, wb1MaxPowerW: 7360,
        wb1PhaseSwitchEnabled: false, wb1ProductionPhases: 1,
        wallboxMinimumRunTimeS: 600, wallboxStopDelayS: 120, wallboxCombinedMaxStepA: 3});
    h.own('Devices.Wallbox1.Present', true); h.own('Devices.Wallbox1.ControlEnabled', true);
    h.own('Config.WallboxCombinedMaxStep_A', 3);
    h.adapter.wallboxOutput.devices = [{wb: 1, valid: true, owned: false,
        ids: {connection: 'goe1.connection', error: 'goe1.error', allow: 'goe1.allow',
            feedback: 'goe1.current', command: 'goe1.command', phaseMode: 'goe1.phase'}}];
    let cursor = 0, wasActive = false, unexpectedStops = 0, activeCycles = 0;
    // Hold each generated observation for 50 s while the controller runs every
    // 10 s. This harness assumes fresh sources, healthy error/connection and
    // one-phase currents. Temperatures and plan are fixed fixture conditions;
    // real vehicle response and thermodynamic behavior are outside its scope.
    for (let elapsedS = 0; elapsedS <= 13100; elapsedS += 10) {
        while (cursor + 1 < samples.length && samples[cursor + 1].elapsedS <= elapsedS) cursor++;
        const row = samples[cursor];
        if (elapsedS) h.advance(10000);
        h.put('DP_PV_POWER', row.pvW);
        h.put('DP_GRID_IMPORT', Math.max(0, row.gridW)); h.put('DP_GRID_EXPORT', Math.max(0, -row.gridW));
        h.put('DP_WB1_POWER', row.wallboxW / 1000); h.put('DP_WB1_L1_A', Math.max(0, row.wallboxW / 230));
        h.put('DP_DHW_OUTPUT1', row.dhwW); h.own('Actual.MyPV_DHW_W', row.dhwW);
        for (const [field, val] of [['SOC', row.soc], ['CAR', row.car], ['ALLOW', row.userRelease],
            ['TARGET', row.targetSoc], ['MIN_SOC', row.minimumSoc]]) h.put(`DP_WB1_${field}`, val);
        h.put('goe1.phase', row.phaseMode);
        h.put('goe1.connection', true); h.put('goe1.error', 0); h.put('goe1.allow', row.wallboxW > 0 ? 1 : 0);
        h.put('goe1.current', Math.max(6, Math.min(32, Math.round(row.wallboxW / 230))));
        for (const name of ['BatteryPower', 'MyPV_DHW', 'MyPV_Heating', 'Wallbox0', 'Wallbox1', 'Wallbox2'])
            h.own(`Plan.${name}_48h_JSON`, JSON.stringify([{timestamp: start + elapsedS * 1000 - 1,
                valueW: ['MyPV_DHW', 'Wallbox1'].includes(name) ? 6000 : 0, phases: 1}]));
        await h.tick();
        const snapshot = JSON.parse(h.value('Snapshot_JSON'));
        assert.equal(snapshot.valid, true, `${elapsedS}: ${snapshot.reason}`);
        const active = snapshot.modeled.Wallbox1.active;
        if (wasActive && !active && row.car === 2 && row.soc < row.targetSoc && row.wallboxW > 500)
            unexpectedStops++;
        if (active) activeCycles++;
        wasActive = active;
        const input = snapshot.response.wallboxes.Wallbox1;
        assert.ok(Math.abs(snapshot.response.gridW - input.powerW - (row.gridW - row.wallboxW)) < 1e-8,
            `exogenous balance changed at ${elapsedS}s`);
        assert.ok(Math.abs(snapshot.actuals.Wallbox1 - row.wallboxW) < 1e-8);
    }
    assert.ok(activeCycles > 1000, 'simulation must cover a long charging session');
    assert.equal(unexpectedStops, 0);
    assert.equal(h.value('Modeled.Wallbox1_W'), 0, 'generated 80% target SoC ends modeled charging');
    t.diagnostic(`${samples.length} synthetic observations, 1311 control cycles; ${activeCycles} active cycles; ${unexpectedStops} artificial in-session stops`);
});

test('shadow real-state reader bypasses modeled power and returns detached read-only snapshots', async () => {
    const h = await fixture();
    h.put('DP_WB0_POWER', 0);
    await h.tick();
    assert.equal(h.value('Valid'), true);
    // An idealized response belongs to the model's private state map only.
    h.shadow.states.set('DP_WB0_POWER', {val: 7.36, ack: true, q: 0, ts: Date.now()});
    assert.equal(h.shadow.run('getState("DP_WB0_POWER").val'), 7.36);
    assert.equal(h.shadow.run('getActualState("DP_WB0_POWER").val'), 0);
    h.shadow.run('const measuredPriceSample = getActualState("DP_WB0_POWER"); measuredPriceSample.val = 99;');
    assert.equal(h.states.get('DP_WB0_POWER').val, 0);
    h.put('DP_WB0_POWER', 1.38);
    assert.equal(h.shadow.run('getActualState("DP_WB0_POWER").val'), 1.38);
    assert.ok(h.writes.every(write => write.id.startsWith('ems.0.Debug.Shadow.')));
});

test('price-session ledger follows authoritative live progress instead of derived shadow writes', async () => {
    const h = await fixture();
    const remaining = 'ems.0.Vehicles.Wallbox0.PriceRemainingEnergy_kWh';
    const session = 'ems.0.Vehicles.Wallbox0.PriceSessionId';
    h.own('Vehicles.Wallbox0.PriceRemainingEnergy_kWh', 3);
    h.own('Vehicles.Wallbox0.PriceSessionId', 'real-session');
    h.shadow.prepareContext();
    h.shadow.run(`setState('${remaining}', 0, true); setState('${session}', 'invented-model-session', true);`);
    assert.equal(h.states.get(remaining).val, 3, 'private calculations cannot consume real kWh');
    assert.equal(h.states.get(session).val, 'real-session');
    assert.equal(h.shadow.derived.has(remaining), false);
    assert.equal(h.shadow.derived.has(session), false);
    // Even old derived entries from a previous context must not override live progress.
    h.shadow.derived.set(remaining, {val: 99, ack: true, ts: Date.now()});
    h.own('Vehicles.Wallbox0.PriceRemainingEnergy_kWh', 2.5);
    h.shadow.prepareContext();
    assert.equal(h.shadow.run(`getState('${remaining}').val`), 2.5);
    assert.equal(h.shadow.run(`getState('${session}').val`), 'real-session');
    assert.equal(h.shadow.derived.has(remaining), false);
    h.states.delete(session);
    h.shadow.prepareContext();
    assert.equal(h.shadow.run(`getState('${session}')`), undefined,
        'a removed physical session is not recreated from model history');
});

test('actual-state reader adds no write capability to the isolated shadow engine', async () => {
    const h = await fixture();
    await h.tick();
    const before = h.states.get('DP_WB0_POWER').val;
    assert.throws(() => h.shadow.run('setState("DP_WB0_POWER", 10, true)'), /Nicht erlaubte/);
    assert.throws(() => h.shadow.run('writeForeignState("real.actuator", 1000)'), /Nicht erlaubte/);
    assert.throws(() => h.shadow.run('sendTo("sql.0", "query", {})'), /Nicht erlaubte/);
    assert.equal(h.states.get('DP_WB0_POWER').val, before);
    assert.ok(h.writes.every(write => write.id.startsWith('ems.0.Debug.Shadow.')));
});

test('actual no-SoC price-session helper never spends physical kWh on virtual charging', async () => {
    const h = await fixture();
    const now = h.states.get('ems.0.System.LastUpdate').val;
    h.own('Config.Wallbox0PriceChargingEnabled', true);
    h.own('Config.Wallbox0PriceEnergy_kWh', 3);
    h.own('Config.Wallbox0PriceMax_ct_kWh', 25);
    const ledger = {PriceSessionId: `0:${now - 1000}`, PriceSessionStartedAt: now - 1000,
        PriceChargedEnergy_kWh: 0.5, PriceRemainingEnergy_kWh: 2.5,
        PriceDeadlineTimestamp: now + 24 * 3600000, PriceLastMeasurementAt: now,
        PriceLastPower_kW: 0, PriceEnergyTrackingValid: true, PriceSessionConnected: true};
    for (const [field, value] of Object.entries(ledger)) h.own(`Vehicles.Wallbox0.${field}`, value);
    const liveLedgerJson = JSON.stringify({version: 1, ...ledger});
    h.own('Vehicles.Wallbox0.PriceSessionLedger_JSON', liveLedgerJson);
    h.put('DP_WB0_SOC', null);
    h.put('DP_WB0_POWER', 0);
    h.own('Config.WallboxPlanWithoutSoC', true);
    const physicalLedger = () => Object.fromEntries(Object.keys(ledger).map(field =>
        [field, h.states.get(`ems.0.Vehicles.Wallbox0.${field}`).val]));
    // Establish and ramp a real shadow output while the physical car still
    // consumes zero. The helper must integrate the bridge's real samples.
    for (let i = 0; i < 6; i++) {
        h.advance(2000);
        await h.tick();
        assert.equal(h.value('Valid'), true);
        const result = h.shadow.run('updateVehiclePriceSession(0, {socValid:false, gridEnergyKWh:0})');
        assert.equal(result.priceSessionValid, true);
        assert.equal(result.priceChargedEnergyKWh, 0.5);
        assert.equal(result.priceRemainingKWh, 2.5);
        assert.deepEqual(physicalLedger(), ledger);
        assert.equal(h.states.get('ems.0.Vehicles.Wallbox0.PriceSessionLedger_JSON').val, liveLedgerJson);
    }
    assert.ok(h.value('Modeled.Wallbox0_W') > 0, JSON.stringify({model:h.value('Modeled.Wallbox0_W'), target:h.value('Targets.Wallbox0_W'), status:h.value('Wallbox0.Summary'), summary:h.value('Summary')}));
    assert.equal(h.value('Actuals.Wallbox0_W'), 0);
    assert.equal(h.shadow.run('getActualState("DP_WB0_POWER").val'), 0);
    assert.ok(h.writes.every(write => write.id.startsWith('ems.0.Debug.Shadow.')));
});

test('BHKW shadow record contains separate valid counter and source quality without extra budget', async () => {
    const h = await fixture();
    h.adapter.config.bhkwPresent = true; h.adapter.config.bhkwEnergyUnit = 'J';
    h.put('DP_BHKW_POWER', 920); h.put('DP_BHKW_ENERGY', 360000000);
    await h.tick(); await h.flush();
    const record = latestRecord(h);
    assert.equal(record.actuals.BHKW, 920); assert.equal(record.bhkw.energyKWh, 100);
    assert.equal(record.bhkw.power.ack, true); assert.equal(record.bhkw.valid, true);
    assert.equal(h.value('BHKW.Energy_kWh'), 100);
    assert.ok(h.shadow.historyIds.includes('ems.0.Debug.Shadow.BHKW.Energy_kWh'));
    assert.ok(!h.shadow.historyIds.includes('ems.0.Debug.Shadow.BHKW.Quality_JSON'));
    assert.ok(h.writes.every(write => write.id.startsWith('ems.0.Debug.Shadow.')));
});

test('price-enabled PV shadow run holds a dip without inventing price authorization', async () => {
    const h = await fixture();
    h.adapter.config.wallboxMinimumRunTimeS = 60;
    h.adapter.config.wallboxStopDelayS = 10;
    h.own('Config.Wallbox0PriceChargingEnabled', true);
    forceWallboxBudget(h);
    await startModel(h);
    assert.equal(h.value('Modeled.Wallbox0_W'), 1380);
    h.shadow.context.testDemandW = 0;
    h.put('DP_GRID_EXPORT', 0);
    h.advance(2000); await h.tick();
    assert.equal(h.value('Targets.Wallbox0_W'), 0);
    assert.equal(h.value('Modeled.Wallbox0_W'), 1380);
    assert.ok(h.value('Wallbox0.MinimumRunTimeRemaining_s') > 0);
    assert.doesNotMatch(h.value('Wallbox0.ModelStatus'), /Preisfenster beendet/);
    h.advance(61000); await h.tick();
    assert.equal(h.value('Modeled.Wallbox0_W'), 0);
});

test('real protection sources record ACK, quality, allowed age and stale transitions', async () => {
    const h = await fixture();
    h.mapping.DP_HA_L2_IMPORT_W = 'ha.l2.import';
    h.mapping.DP_HA_L2_EXPORT_W = 'ha.l2.export';
    h.put('ha.l2.import', 500, {q: 0x82});
    h.put('ha.l2.export', 0, {ts: Date.now() - 100000000000});
    const quality = h.shadow.realProtectionFeedback();
    assert.equal(quality.houseL2Import.issue, 'quality');
    assert.equal(quality.houseL2Import.q, 0x82);
    assert.equal(quality.houseL2Import.maxAgeMs, 30000);
    assert.equal(quality.houseL2Export.issue, 'stale');
    await h.tick();
    const r = latestRecord(h);
    assert.equal(r.adapterVersion, require('../package.json').version);
    assert.equal(r.protectionFeedback.houseL2Import.valid, false);
    assert.equal(r.masterEnabled, false);
});

test('slow scalar persistence coalesces complete frames and commits only after their scalars', async () => {
    const writes = [];
    let release;
    const adapter = {namespace: 'ems.0', setCompatState: (id, value) => {
        writes.push({id: id.split('.Debug.Shadow.')[1], value});
        if (id.endsWith('Targets.Wallbox2_W') && value === 1000)
            return new Promise(resolve => { release = resolve; });
        return Promise.resolve();
    }};
    const shadow = new ShadowController(adapter);
    const frame = (cycle, watts) => {
        shadow.beginScalarFrame();
        shadow.publish('Targets.Wallbox2_W', watts);
        shadow.publish('Targets.Wallbox2_W', watts + 1); // final value only
        shadow.publish('LastUpdate', cycle * 1000);
        shadow.publish('CycleId', cycle);
        shadow.finishScalarFrame();
    };
    // Hold a different final value to exercise a pending complete frame.
    shadow.beginScalarFrame();
    shadow.publish('Targets.Wallbox2_W', 1000);
    shadow.publish('LastUpdate', 1000); shadow.publish('CycleId', 1);
    shadow.finishScalarFrame();
    await Promise.resolve();
    frame(2, 2000); frame(3, 3000);
    assert.equal(writes.some(w => w.id === 'ScalarCycleId'), false);
    release();
    for (let i = 0; i < 80; i++) await Promise.resolve();
    assert.deepEqual(writes.filter(w => w.id === 'Targets.Wallbox2_W').map(w => w.value), [1000, 3001]);
    assert.deepEqual(writes.filter(w => w.id === 'ScalarCycleId').map(w => w.value), [1, 3]);
    assert.equal(shadow.scalarSkippedCycles, 1);
    assert.ok(writes.findIndex(w => w.id === 'ScalarCycleId' && w.value === 3)
        > writes.findIndex(w => w.id === 'Targets.Wallbox2_W' && w.value === 3001));
});

test('a partially failed scalar frame cannot commit while another write is outstanding', async () => {
    const writes = [];
    let release;
    const shadow = new ShadowController({namespace: 'ems.0', setCompatState: (id, value) => {
        writes.push({id, value});
        if (id.endsWith('Targets.Wallbox2_W')) return Promise.reject(new Error('storage failure'));
        if (id.endsWith('Targets.Wallbox1_W')) return new Promise(resolve => { release = resolve; });
        return Promise.resolve();
    }});
    shadow.beginScalarFrame();
    shadow.publish('Targets.Wallbox2_W', 0); shadow.publish('Targets.Wallbox1_W', 1380);
    shadow.publish('LastUpdate', 1000); shadow.publish('CycleId', 1);
    shadow.finishScalarFrame();
    for (let i = 0; i < 8; i++) await Promise.resolve();
    assert.equal(shadow.scalarWriting, true);
    release();
    for (let i = 0; i < 30; i++) await Promise.resolve();
    assert.equal(shadow.scalarPublishErrors, 1);
    assert.equal(writes.some(w => w.id.endsWith('.ScalarCycleId')), false);
});

test('decision publication records actual master enablement even if it changes after input validation', async () => {
    const h = await fixture();
    await h.tick();
    for (const [globalEnabled, realEnabled] of [[true, false], [false, true], [false, false]]) {
        h.adapter.config.globalWriteEnabled = globalEnabled;
        h.own('System.RealOutputsEnabled', realEnabled);
        // Publishing may finish after an awaited model update. The normal
        // next tick still pauses on master ON; the record must retain reality.
        h.shadow.publishDecision();
        for (let i = 0; i < 80; i++) await Promise.resolve();
        const record = latestRecord(h);
        assert.equal(record.valid, true);
        assert.equal(record.masterEnabled, globalEnabled || realEnabled);
        assert.equal(record.controlState.globalWriteEnabled, globalEnabled);
        assert.equal(record.controlState.realOutputsEnabled, realEnabled);
        assert.equal(JSON.parse(h.value('Snapshot_JSON')).masterAssumedEnabled, true);
    }
});

test('unload cancels queued scalar frames without committing an incomplete cycle', async () => {
    const writes = [];
    let release;
    const shadow = new ShadowController({namespace: 'ems.0', setCompatState: (id, value) => {
        writes.push({id, value});
        if (id.endsWith('Targets.Wallbox2_W')) return new Promise(resolve => { release = resolve; });
        return Promise.resolve();
    }});
    const frame = cycle => {
        shadow.beginScalarFrame(); shadow.publish('Targets.Wallbox2_W', cycle * 1000);
        shadow.publish('LastUpdate', cycle * 1000); shadow.publish('CycleId', cycle);
        shadow.finishScalarFrame();
    };
    frame(1); await Promise.resolve(); frame(2);
    shadow.stop(); release();
    for (let i = 0; i < 40; i++) await Promise.resolve();
    assert.equal(writes.some(w => w.value === 2000), false);
    assert.equal(writes.some(w => w.id.endsWith('.ScalarCycleId')), false);
});

test('parallel shadow starts two minimum-SoC cars with isolated virtual confirmations and full allocation diagnosis', async () => {
    const h = await fixture({surplusW: 0});
    addSecondWallbox(h);
    h.adapter.config.wallboxParallelChargingEnabled = true;
    h.own('Config.WallboxParallelChargingEnabled', true);
    for (const wb of [0, 1]) h.put(`DP_WB${wb}_MIN_SOC`, 70);
    h.own('Devices.MyPV_DHW.ControlEnabled', false);
    h.adapter.config.dhwControlEnabled = false;
    const devicesBefore = structuredClone(h.adapter.wallboxOutput.devices);
    for (let cycle = 0; cycle < 14; cycle++) { h.advance(2000); await h.tick(); }
    const snapshot = JSON.parse(h.value('Snapshot_JSON'));
    assert.equal(snapshot.valid, true, snapshot.reason);
    assert.equal(snapshot.parallelWallboxes.enabled, true);
    assert.deepEqual(snapshot.parallelWallboxes.active, [0, 1]);
    assert.equal(snapshot.parallelWallboxes.allocation.allocations.find(a => a.wb === 0).minimumW, 1380);
    assert.equal(snapshot.parallelWallboxes.allocation.allocations.find(a => a.wb === 1).minimumW, 1380);
    for (const wb of [0, 1]) {
        assert.equal(snapshot.targets[`Wallbox${wb}`], 1380);
        assert.equal(snapshot.modeled[`Wallbox${wb}`].amps, 6, snapshot.modeled[`Wallbox${wb}`].status);
        assert.equal(snapshot.modeled[`Wallbox${wb}`].active, true);
        assert.equal(snapshot.modeled[`Wallbox${wb}`].responseAssumed, true);
        assert.equal(snapshot.actuals[`Wallbox${wb}`], 0, 'model output is not an observed real charging watt');
        assert.equal(snapshot.realFeedback[`Wallbox${wb}`].allow.value, 0);
        assert.equal(snapshot.allocation[`Wallbox${wb}`].distributionReason, 'parallel-minimum-soc');
    }
    assert.match(h.value('Summary'), /WB0 1380 W, WB1 1380 W/);
    assert.deepEqual(JSON.parse(h.value('ActiveWallboxes_JSON')), [0, 1]);
    const record = latestRecord(h);
    assert.deepEqual(record.parallelWallboxes.active, [0, 1]);
    assert.equal(record.parallelWallboxes.allocation.minimumTotalW, 2760);
    assert.equal(record.masterEnabled, false);
    assert.equal(h.states.get('goe.allow').val, 0);
    assert.equal(h.states.get('goe1.allow').val, 0);
    assert.deepEqual(h.adapter.wallboxOutput.devices, devicesBefore, 'private output state cannot mutate live devices');
    assert.ok(h.writes.every(w => w.id.startsWith('ems.0.Debug.Shadow.')));
});

test('parallel shadow excludes borrowed live grants and does not record timestamp-only allocation changes', async () => {
    const h = await fixture({surplusW: 0});
    addSecondWallbox(h); h.adapter.config.wallboxParallelChargingEnabled = true;
    h.own('Config.WallboxParallelChargingEnabled', true);
    h.own('Control.ParallelWallboxAllocation_JSON', JSON.stringify({schema: 1, valid: true, order: [2],
        allocations: [{wb: 2, authorized: true, targetA: 32, phases: 3}], secret: 'FOREIGN-GRANT'}));
    h.own('Control.ActiveWallboxes_JSON', '[2]');
    for (const wb of [0, 1]) h.put(`DP_WB${wb}_MIN_SOC`, 70);
    h.adapter.config.dhwControlEnabled = false; h.own('Devices.MyPV_DHW.ControlEnabled', false);
    for (let cycle = 0; cycle < 14; cycle++) { h.advance(2000); await h.tick(); }
    const snapshot = JSON.parse(h.value('Snapshot_JSON'));
    assert.deepEqual(snapshot.parallelWallboxes.allocation.order, [0, 1]);
    assert.ok(!JSON.stringify(snapshot).includes('FOREIGN-GRANT'));
    const before = h.writes.filter(w => w.id.endsWith('.DecisionRecord')).length;
    const same = structuredClone(snapshot);
    same.parallelWallboxes.allocation.timestamp += 100;
    same.parallelWallboxes.status += ' ';
    h.shadow.publishRecord(same);
    await h.flush();
    assert.equal(h.writes.filter(w => w.id.endsWith('.DecisionRecord')).length, before,
        'a timestamp or formatted status alone cannot become a new SQL edge');
});

test('productive SQL record carries bounded central and complete per-vehicle allocation diagnostics while model is paused', async () => {
    const h = await fixture();
    h.adapter.config.globalWriteEnabled = true;
    h.own('System.RealOutputsEnabled', true);
    h.own('Config.WallboxParallelChargingEnabled', true);
    h.own('Control.ActiveWallboxes_JSON', '[0,1]');
    const allocation = {schema: 1, timestamp: Date.now(), valid: true, order: [0, 1], budgetW: 2760,
        hardBudgetW: 10000, minimumTotalW: 2760, mandatoryGridW: 2760,
        allocations: [0, 1].map(wb => ({wb, authorized: true, targetA: 6, phases: 1, reservedW: 1380, minimumW: 1380})),
        waiting: [], secret: 'UNEXPECTED-KEY'};
    h.own('Control.ParallelWallboxAllocation_JSON', JSON.stringify(allocation));
    h.own('Control.ParallelWallboxStatus', 'Mindestladung beider Fahrzeuge');
    h.own('Control.Wallbox1.AllocationDiagnostics_JSON', JSON.stringify({valid: true, minimumW: 1380,
        phasePreparationReason: 'awaiting-confirmed-1p', reason: 'x'.repeat(800)}));
    const DebugRecorder = require('../lib/debug-recorder');
    h.adapter.debugRecorder = new DebugRecorder(h.adapter);
    await h.tick();
    const record = latestRecord(h);
    assert.equal(record.mode, 'PRODUCTION');
    assert.equal(record.modelPaused, true);
    assert.equal(record.masterEnabled, true);
    assert.deepEqual(record.production.control.parallelWallboxes.active, [0, 1]);
    assert.equal(record.production.control.parallelWallboxes.allocation.minimumTotalW, 2760);
    assert.equal(record.production.wallboxes[1].allocation.reason.length, 800);
    assert.equal(record.production.wallboxes[1].allocation.phasePreparationReason, 'awaiting-confirmed-1p');
    assert.ok(!JSON.stringify(record.production.control.parallelWallboxes).includes('UNEXPECTED-KEY'));
});

