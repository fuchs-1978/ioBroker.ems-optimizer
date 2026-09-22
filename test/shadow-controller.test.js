'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ShadowController = require('../lib/shadow-controller');
const {createEngineContext, MODULES} = require('../lib/engine-loader');
const gridConstraints = require('../lib/grid-constraints');

async function fixture({battery = false, heating = false, wallbox = true, heatPump = false,
    surplusW = 6000, delayS = 0, slowS = 2} = {}) {
    let now = Date.now();
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
        Date: Clock, nativeConfig, gridConstraints,
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
    put('goe.error', 0); put('goe.allow', 0);
    for (const name of ['BatteryPower', 'MyPV_DHW', 'MyPV_Heating', 'Wallbox0', 'Wallbox1', 'Wallbox2'])
        own(`Plan.${name}_48h_JSON`, JSON.stringify([{timestamp: now - 1000, valueW: name === 'BatteryPower' ? 0 : 6000, phases: 1}]));
    const adapter = {namespace: 'ems.0', config, stateCache: states, getCachedState: id => states.get(id),
        readMapping: () => mapping, queueCompatState: async (id, val) => { if (!states.has(id)) put(id, val); },
        setCompatState: (id, val) => {
            assert.ok(id.startsWith('ems.0.Debug.Shadow.'), `shadow crossed write boundary: ${id}`);
            writes.push({id, val}); put(id, val);
        }, wallboxOutput: {devices: [{wb: 0, valid: true, owned: false, recovering: false,
            ids: {connection: 'goe.connection', error: 'goe.error', allow: 'goe.allow'}}]}};
    const shadow = new ShadowController(adapter, {now: () => now,
        createContext: sandbox => createEngineContext(adapter.namespace, mapping, sandbox, 'shadow-test')});
    await shadow.initialize();
    const flush = async () => { for (let i = 0; i < 12; i++) await Promise.resolve(); };
    await flush();
    const tick = async () => { shadow.tick(); await flush(); };
    const advance = ms => {
        now += ms;
        for (const s of states.values()) s.ts = now;
        own('System.LastUpdate', now); own('Plan.LastUpdate', now); put(config.batteryHeartbeatId, now);
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
    assert.match(h.value('Snapshot_JSON'), /keine simulierte Geraetereaktion/);
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
    assert.equal(h.value('HeatPump.Valid'), true);
    assert.equal(h.value('Targets.HeatPumpMode'), 'BOOST');
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
    h.own('Vehicles.Wallbox0.StartDelayRemaining_s', 999);
    await h.tick();
    assert.equal(h.value('SelectedWallbox'), 0);
    assert.equal(h.value('Wallbox0.StartDelayRemaining_s'), 30);
    for (const elapsed of [2, 4, 6]) {
        h.advance(2000); await h.tick();
        assert.equal(h.value('SelectedWallbox'), 0, `selected after ${elapsed}s`);
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
