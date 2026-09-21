'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const {createRequire} = require('node:module');

// Shared, deterministic plant: real allocator + real output state machines,
// delayed ioBroker ack and delayed AC THOR power, no device/network writes.
async function plant({startDelayS = 120, minimumRuntimeS = 120, split = true, diagnostics,
    battery = false, heating = false, wallbox = true, cheap = false,
    initialSurplusW = 6000, batteryPlanW = 0, lpcLimitW = null, phaseBiasW = [0, 0, 0],
    batteryDelayMs = 2000, heatingDelayMs = 4000, dhwDelayMs = 4000,
    batteryDcFactor = 1, batteryDcPvW = 0} = {}) {
    let now = Date.UTC(2026, 8, 21, 12), surplusW = 6000;
    let heaterW = 0, heaterCommandW = 0, physicalAllow = 0, physicalA = 6;
    let heatingW = 0, heatingCommandW = 0, batteryW = 0, batteryCommandW = 0;
    let batteryResponds = true, batteryHeartbeat = true;
    surplusW = initialSurplusW;
    const states = new Map(), writes = [], events = [], trace = [], diagnosticWrites = [];
    let recorder = null;
    class Clock extends Date {
        constructor(...args) { super(...(args.length ? args : [now])); }
        static now() { return now; }
    }
    const put = (id, val, extra = {}) => {
        const previous = states.get(id);
        const state = {val, ack: true, ts: now, ...extra};
        states.set(id, state);
        if (!id.startsWith('ems.0.Debug.')) recorder?.capture(id, state, previous);
    };
    const own = (id, val) => put(`ems.0.${id}`, val);
    const value = id => states.get(`ems.0.${id}`)?.val;
    const mapping = {};
    const substitute = source => source.replaceAll('__ADAPTER_ROOT__', 'ems.0')
        .replace(/__([A-Z0-9_]+)__/g, (_, key) => {
            mapping[key] = key;
            return key;
        });
    const config = {globalWriteEnabled: true, wb0Present: true, wb0ControlEnabled: false,
        wb1Present: false, wb2Present: true, wb2ControlEnabled: true, wb2ProductionArmed: true,
        wb2CommissioningMaxA: 32, wb2MaxCurrent1pA: 32, wb2MinCurrent1pA: 6,
        wb2MaxPowerW: 7360, wb2PhaseSwitchEnabled: false, wb2ProductionPhases: 1,
        wb2AmpereOutputId: 'goe.cmd', wb2AmpereFeedbackId: 'goe.feedback',
        wb2AllowOutputId: 'goe.allow', wb2ConnectionId: 'goe.connection', wb2ErrorId: 'goe.error',
        wb2FeedbackTimeoutS: 20, wallboxMeasurementMaxAgeS: 30, wallboxPrioritySource: 'internal',
        wallboxPriority: 0, wallboxStartDelayS: startDelayS, wallboxMinimumRunTimeS: minimumRuntimeS,
        wallboxStopDelayS: 120, wallboxRestartHandoffSettleS: 10, slowCycleS: 2,
        dhwControlEnabled: true, combinedProductionArmed: true, dhwSetpointId: 'DP_DHW_SETPOINT',
        dhwHaL1CurrentId: 'DP_DHW_HA_L1_CURRENT_A', dhwHaL2CurrentId: 'DP_DHW_HA_L2_CURRENT_A',
        dhwHaL3CurrentId: 'DP_DHW_HA_L3_CURRENT_A',
        batteryControlEnabled: battery, batteryPresent: battery, batteryProductionArmed: battery,
        batterySetpointId: 'sunenergyxt500.0.heads.1.control.GS',
        batteryHeartbeatId: 'sunenergyxt500.0.info.lastUpdate',
        batteryOnlineId: 'sunenergyxt500.0.heads.1.online',
        batteryManualModeId: 'sunenergyxt500.0.heads.1.control.MM',
        batteryLocalModeId: 'sunenergyxt500.0.heads.1.control.LM', batteryPowerSign: 1,
        batteryAcPowerId: 'sunenergyxt500.0.heads.1.grid.GP',
        heatingPresent: heating, heatingControlEnabled: heating, heatingProductionArmed: heating,
        heatingSetpointId: 'hk.setpoint', heatingConnectionId: 'hk.connected', heatingTempId: 'hk.temp',
        heatingCoolingActiveId: 'hk.cooling', heatingOutput1Id: 'hk.power1',
        heatingOutput2Id: 'hk.power2', heatingOutput3Id: 'hk.power3'};
    if (!wallbox) config.wb2ControlEnabled = false;
    const writeForeign = (id, val, callback) => {
        writes.push({id, val, at: now});
        if (id === 'DP_DHW_SETPOINT') {
            if (val !== heaterCommandW) {
                heaterCommandW = val;
                events.push({at: now + dhwDelayMs, run: () => { heaterW = val; put(id, val); }});
            }
            put(id, val, {ack: false});
        } else if (id === 'hk.setpoint') {
            if (val !== heatingCommandW) {
                heatingCommandW = val;
                events.push({at: now + heatingDelayMs, run: () => { heatingW = val; put(id, val); }});
            }
            put(id, val, {ack: false});
        } else if (id === config.batterySetpointId) {
            if (val !== batteryCommandW) {
                batteryCommandW = val;
                events.push({at: now + batteryDelayMs, run: () => {
                    if (batteryResponds) batteryW = -val || 0;
                    put(id, val);
                }});
            }
            put(id, val, {ack: false});
        } else if (id === 'goe.cmd') {
            put(id, val, {ack: false});
            events.push({at: now + 4000, run: () => {
                physicalA = val; put(id, val); put('goe.feedback', val);
            }});
        } else if (id === 'goe.allow') {
            put(id, val, {ack: false});
            events.push({at: now + 4000, run: () => {physicalAllow = val; put(id, val);}});
        } else put(id, val);
        callback?.(null);
        return true;
    };
    const ctx = vm.createContext({Date: Clock, console, nativeConfig: config,
        gridConstraints: require('../lib/grid-constraints'),
        getState: id => states.get(id), existsState: id => states.has(id),
        createState: (id, val) => { if (!states.has(id)) put(id, val); }, setState: put,
        writeForeignState: writeForeign, log: () => {}, sendTo: () => {}});
    for (const file of ['core', 'history', 'forecast', 'vehicles', 'dhw-controller',
        'battery-controller', 'heating-controller', 'heatpump-controller',
        'planner', 'energy-coordination', 'realtime', 'dhw-output'])
        vm.runInContext(substitute(fs.readFileSync(path.join(__dirname, '../lib/engine', `${file}.js`), 'utf8')), ctx);
    vm.runInContext('createStates()', ctx);
    vm.runInContext('createBatteryStates();createHeatingStates();createHeatPumpStates();createEnergyCoordinationStates()', ctx);
    vm.runInContext(substitute(fs.readFileSync(path.join(__dirname, '../lib/engine/config-mapping.js'), 'utf8')), ctx);
    for (const key of ['DP_PAR14A', 'DP_LPC_STATE', 'DP_LPC_LIMIT', 'DP_HEAT_PUMP_POWER']) mapping[key] = '';
    for (const phase of [1, 2, 3]) {
        mapping[`DP_HA_L${phase}_IMPORT_W`] = '';
        mapping[`DP_HA_L${phase}_EXPORT_W`] = '';
    }
    vm.runInContext("CFG.dp.par14a='';CFG.dp.lpcState='';CFG.dp.lpcLimit='';CFG.dp.haPhaseImportW=[];CFG.dp.haPhaseExportW=[]", ctx);
    vm.runInContext("CFG.dp.batteryPower='sunenergyxt500.0.total.batteryPower';CFG.dp.batterySoc='sunenergyxt500.0.heads.1.battery.SC'", ctx);
    vm.runInContext("CFG.dp.batteryAcPower='sunenergyxt500.0.heads.1.grid.GP'", ctx);
    if (lpcLimitW !== null) {
        vm.runInContext("CFG.dp.lpcState='lpc.state';CFG.dp.lpcLimit='lpc.limit'", ctx);
        mapping.DP_LPC_STATE = 'lpc.state'; mapping.DP_LPC_LIMIT = 'lpc.limit';
        put('lpc.state', 'limited'); put('lpc.limit', lpcLimitW);
    }
    for (const id of ['System.RealOutputsEnabled', 'System.EngineReady', 'System.DataValid', 'Plan.Valid',
        'Control.Enabled', 'Config.DHWParallelDistributionEnabled', 'Devices.MyPV_DHW.Present',
        'Devices.MyPV_DHW.ControlEnabled']) own(id, true);
    own('Config.DHWCommissioningMaxPower_W', 9000);
    own('Config.SlowControlCycle_s', 2);
    own('Config.WallboxStartDelay_s', startDelayS);
    own('Config.WallboxStartReserve_W', 300);
    own('Config.WallboxMinimumRunTime_s', minimumRuntimeS);
    own('Config.WallboxStopDelay_s', 120);
    own('Config.WallboxMaxStep_A', 6);
    own('Config.WallboxCombinedMaxStep_A', 1);
    own('Devices.Battery.Present', battery); own('Devices.Battery.ControlEnabled', battery);
    own('Devices.Battery.DriverReady', battery); own('Config.BatteryFineReserve_W', 200);
    own('Devices.Battery.SingleHeadVerified', battery);
    own('Config.BatteryMinSoC_pct', 20); own('Config.BatteryMaxSoC_pct', 95);
    own('Config.BatteryMaxCharge_W', 2400); own('Config.BatteryMaxDischarge_W', 2400);
    own('Config.BatterySelfConsumptionEnabled', true);
    own('Devices.MyPV_Heating.Present', heating); own('Devices.MyPV_Heating.ControlEnabled', heating);
    own('Devices.MyPV_Heating.DriverReady', heating);
    own('Devices.HeatPump.Present', false);
    put(config.batteryHeartbeatId, now); put(config.batteryOnlineId, true);
    put(config.batteryManualModeId, false); put(config.batteryLocalModeId, true);
    put(config.batterySetpointId, 0); put('hk.connected', true); put('hk.temp', 35); put('hk.cooling', false);
    for (const id of vm.runInContext('[CFG.dp.batterySoc]', ctx)) put(id, 50);
    if (cheap) {
        vm.runInContext("CFG.dp.dynamicEnergyPriceEnabled='';CFG.dp.dynamicGridFeeEnabled=''", ctx);
        own('Config.DynamicEnergyPriceEnabled', false); own('Config.DynamicGridFeeEnabled', false);
        own('Config.FixedEnergyComponent_ct_kWh', 10); own('Config.FixedGridFee_ct_kWh', 5);
        own('Config.ThermalCheapPriceEnabled', true); own('Config.ThermalCheapFixedTariffAllowed', true);
        own('Config.ThermalCheapPriceMax_ct_kWh', 20); own('Config.ThermalCheapGridMax_W', 2000);
    }
    for (const wb of [0, 1, 2]) {
        own(`Devices.Wallbox${wb}.Present`, wb !== 1);
        own(`Devices.Wallbox${wb}.ControlEnabled`, wb === 2 && wallbox);
        own(`Vehicles.Wallbox${wb}.PhaseSwitchEnabled`, false);
        own(`Vehicles.Wallbox${wb}.MaximumPhases`, 1);
        own(`Vehicles.Wallbox${wb}.MinCurrent1P_A`, 6);
        own(`Vehicles.Wallbox${wb}.MaxCurrent1P_A`, 32);
        own(`Config.Wallbox${wb}MaxPower_W`, 7360);
        own(`Config.Wallbox${wb}VehicleCapacity_kWh`, 50);
        put(`DP_WB${wb}_CAR`, wb === 1 ? 1 : 2);
        put(`DP_WB${wb}_SOC`, 50); put(`DP_WB${wb}_MIN_SOC`, 20);
        put(`DP_WB${wb}_TARGET`, 80); put(`DP_WB${wb}_ALLOW`, true);
        put(`DP_WB${wb}_RELEASE`, 1);
    }
    put('DP_DHW_PARALLEL_RELEASE', split);
    put('DP_DHW_CONNECTION', true);
    put('DP_HA_CRITICAL', false);
    put('goe.connection', true); put('goe.error', 0);
    put('goe.allow', 0); put('goe.feedback', 6);
    for (const id of vm.runInContext('CFG.dp.dhwTemps', ctx)) put(id, 50);
    put('DP_DHW_OUTLET_TEMP', 50);
    const slot = JSON.stringify([{timestamp: now - 1000, valueW: 6000, phases: 1}]);
    for (const name of ['BatteryPower', 'MyPV_DHW', 'MyPV_Heating', 'Wallbox0', 'Wallbox1', 'Wallbox2'])
        own(`Plan.${name}_48h_JSON`, slot);
    if (battery || heating) own('Plan.BatteryPower_48h_JSON', JSON.stringify([
        {timestamp: now - 1000, valueW: batteryPlanW}]));

    const adapter = {namespace: 'ems.0', config, stateCache: states, readMapping: () => mapping,
        getCachedState: id => states.get(id), setCompatState: put,
        setStateAsync: async (id, val) => own(id, val),
        setForeignStateAsync: async (id, val) => { writeForeign(id, val); },
        getForeignStateAsync: async id => states.get(id), subscribeForeignStatesAsync: async () => {},
        getForeignObjectAsync: async () => ({type: 'state', common: {write: true, type: 'number'}}),
        queueCompatState: async (id, val) => { if (!states.has(id)) put(id, val); },
        log: {warn: () => {}, info: () => {}, error: () => {}}};
    const wallboxFile = path.join(__dirname, '../lib/wallbox-output.js');
    const module = {exports: {}};
    vm.runInNewContext(`(function(require,module,exports){${fs.readFileSync(wallboxFile, 'utf8')}\n})`,
        {Date: Clock})(createRequire(wallboxFile), module, module.exports);
    const output = new module.exports(adapter);
    adapter.wallboxOutput = output;
    adapter.engineContext = ctx;
    if (diagnostics !== undefined) {
        own('Debug.Enabled', diagnostics);
        const debugFile = path.join(__dirname, '../lib/debug-recorder.js');
        const debugModule = {exports: {}};
        vm.runInNewContext(`(function(require,module,exports){${fs.readFileSync(debugFile, 'utf8')}\n})`,
            {Date: Clock, Buffer})(createRequire(debugFile), debugModule, debugModule.exports);
        const debugAdapter = {...adapter,
            setCompatState: (id, val) => {
                assert.ok(id.startsWith('ems.0.Debug.'), `diagnostics wrote a non-debug state: ${id}`);
                diagnosticWrites.push({id, val, at: now});
                put(id, val);
            },
            setStateAsync: async (id, val) => {
                assert.ok(id.startsWith('Debug.'), `diagnostics wrote a non-debug state: ${id}`);
                diagnosticWrites.push({id: `ems.0.${id}`, val, at: now});
                own(id, val);
            },
            setForeignStateAsync: async id => assert.fail(`diagnostics attempted an actuator write: ${id}`)};
        recorder = new debugModule.exports(debugAdapter);
        await recorder.initialize();
    }
    const refresh = () => {
        const wbW = physicalAllow ? physicalA * 230 : 0;
        const gridW = heaterW + heatingW + batteryW + wbW - surplusW;
        for (const [id, state] of states) if (state.ack && !id.startsWith('ems.0.')) put(id, state.val);
        put('DP_GRID_IMPORT', Math.max(0, gridW)); put('DP_GRID_EXPORT', Math.max(0, -gridW));
        own('Actual.GridPower_W', gridW); own('Actual.MyPV_DHW_W', heaterW);
        own('Actual.MyPV_Heating_W', heatingW);
        put(vm.runInContext('CFG.dp.batteryPower', ctx), batteryW * batteryDcFactor + batteryDcPvW);
        put(config.batteryAcPowerId, -batteryW || 0);
        if (batteryHeartbeat) put(config.batteryHeartbeatId, now);
        for (const wb of [0, 1, 2]) {
            put(`DP_WB${wb}_POWER`, wb === 2 ? wbW / 1000 : 0);
            put(`DP_WB${wb}_L1_A`, wb === 2 && physicalAllow ? physicalA : 0);
            put(`DP_WB${wb}_L2_A`, 0); put(`DP_WB${wb}_L3_A`, 0);
        }
        const stagedPhases = (watts, stage) => watts <= stage ? [watts, 0, 0]
            : watts <= stage * 2 ? [watts - stage, stage, 0] : [watts - stage * 2, stage, stage];
        const wwPhases = stagedPhases(heaterW, 3000), hkPhases = stagedPhases(heatingW, 2000);
        for (let phase = 0; phase < 3; phase++) {
            put(`DP_DHW_OUTPUT${phase + 1}`, wwPhases[phase]);
            put(`hk.power${phase + 1}`, hkPhases[phase]);
            const phasePowerW = -surplusW / 3 + phaseBiasW[phase]
                + wwPhases[phase] + hkPhases[phase] + (phase === 0 ? wbW + batteryW : 0);
            put(`DP_DHW_HA_L${phase + 1}_CURRENT_A`, Math.max(0, phasePowerW / 230));
        }
        for (const key of ['System.LastUpdate', 'Plan.LastUpdate']) own(key, now);
    };
    refresh();
    await output.initialize();
    const tick = async () => {
        now += 1000;
        for (const event of events.filter(event => event.at <= now)) event.run();
        for (let index = events.length - 1; index >= 0; index--)
            if (events[index].at <= now) events.splice(index, 1);
        refresh();
        if (now % 2000 === 0) {
            vm.runInContext('updateVehicles();updateDhwSimulation();realtimeControl();updateBatteryProductionOutput()', ctx);
            await output.tick();
        }
        if (now % 5000 === 0) {
            vm.runInContext('updateDhwProductionOutput();updateHeatingProductionOutput()', ctx);
            recorder?.sample();
        }
        trace.push({at: now, wbW: physicalAllow ? physicalA * 230 : 0, heaterW, heatingW, batteryW,
            gridW: heaterW + heatingW + batteryW + (physicalAllow ? physicalA * 230 : 0) - surplusW,
            fine: value('Control.FineRegulator'), physicalAllow,
            phaseImportW: [1, 2, 3].map(p => Number(states.get(`DP_DHW_HA_L${p}_CURRENT_A`)?.val || 0) * 230),
            targetW: value('Control.Targets.Wallbox2_W'), heaterTargetW: value('Control.Targets.MyPV_DHW_W'),
            heatingTargetW: value('Control.Targets.MyPV_Heating_W'), batteryTargetW: value('Control.Targets.Battery_W'),
            batteryStatus: value('Devices.Battery.OutputStatus'), heatingStatus: value('Devices.MyPV_Heating.OutputStatus'),
            status: value('Devices.Wallbox2.OutputStatus'), heaterStatus: value('Devices.MyPV_DHW.OutputStatus')});
    };
    return {states, writes, trace, put, own, value, output, diagnosticWrites, config,
        now: () => now,
        run: code => vm.runInContext(code, ctx),
        setSurplus: watts => { surplusW = watts; },
        setBatteryResponse: value => { batteryResponds = value; },
        setBatteryHeartbeat: value => { batteryHeartbeat = value; },
        setBatteryPower: value => { batteryW = value; },
        advance: async seconds => { for (let second = 0; second < seconds; second++) await tick(); },
        physical: () => ({allow: physicalAllow, amps: physicalA, heaterW, heatingW, batteryW}),
        diagnostic: () => JSON.stringify(trace.slice(-12), null, 2)};
}

test('integrated delayed plant absorbs PV during 120s countdown then starts only WB2 without dropouts', async () => {
    const h = await plant();
    await h.advance(110);
    assert.equal(h.physical().allow, 0, h.diagnostic());
    assert.ok(h.physical().heaterW >= 5500, h.diagnostic());
    assert.equal(h.value('Control.SelectedWallbox'), 2, 'unarmed priority WB0 cannot reserve productive budget');
    assert.equal(h.value('Control.Targets.Wallbox0_W'), 0);
    await h.advance(130);
    assert.equal(h.physical().allow, 1, h.diagnostic());
    assert.ok(h.physical().amps >= 6, h.diagnostic());
    const start = h.writes.find(write => write.id === 'goe.allow' && write.val === 1);
    assert.ok(start, h.diagnostic());
    assert.equal(h.writes.filter(write => write.id === 'goe.allow' && write.val === 0 && write.at > start.at).length, 0,
        h.diagnostic());
    assert.ok(h.physical().heaterW + h.physical().amps * 230 <= 6300, h.diagnostic());
});

test('coordinated battery fine + two heaters + coarse WB converge through startup and a cloud step', async () => {
    const h = await plant({battery: true, heating: true});
    await h.advance(110);
    assert.equal(h.physical().allow, 0, h.diagnostic());
    assert.ok(h.physical().heaterW > 0 && h.physical().heatingW > 0, h.diagnostic());
    assert.ok(h.physical().batteryW > 0, h.diagnostic());
    assert.equal(h.value('Control.FineRegulator'), 'Battery', h.diagnostic());
    await h.advance(130);
    assert.equal(h.physical().allow, 1, h.diagnostic());
    assert.equal(h.value('Control.SelectedWallbox'), 2);
    assert.equal(h.value('Control.Targets.Wallbox0_W'), 0);
    assert.equal(h.value('Control.Targets.Wallbox2_A') % 1, 0);
    h.setSurplus(300);
    await h.advance(30);
    assert.equal(h.physical().allow, 1, h.diagnostic());
    assert.equal(h.physical().heaterW, 0, h.diagnostic());
    assert.equal(h.physical().heatingW, 0, h.diagnostic());
    assert.equal(h.physical().batteryW, 0, 'storage must not discharge into a held discretionary EV');
    h.setSurplus(6000);
    await h.advance(100);
    assert.equal(h.physical().allow, 1, h.diagnostic());
    assert.ok(h.physical().heaterW > 0 && h.physical().heatingW > 0, h.diagnostic());
    assert.ok(Math.abs(h.trace.at(-1).gridW + 100) <= 300, h.diagnostic());
});

test('battery full, minimum SoC and off hand fine regulation back to EHZ without phantom allocation', async () => {
    const h = await plant({battery: true, heating: true, wallbox: false});
    await h.advance(90);
    h.put(h.run('CFG.dp.batterySoc'), 95);
    await h.advance(40);
    assert.equal(h.value('Control.Targets.Battery_W'), 0, h.diagnostic());
    assert.equal(h.value('Control.FineRegulator'), 'MyPV_DHW');
    assert.ok(h.physical().heaterW + h.physical().heatingW >= 5600, h.diagnostic());
    h.put(h.run('CFG.dp.batterySoc'), 20);
    h.setSurplus(-800);
    await h.advance(30);
    assert.equal(h.value('Control.Targets.Battery_W'), 0, h.diagnostic());
    assert.equal(h.physical().batteryW, 0);
    h.own('Devices.Battery.ControlEnabled', false);
    h.setSurplus(6000);
    await h.advance(60);
    assert.equal(h.value('Control.FineRegulator'), 'MyPV_DHW');
    assert.equal(h.value('Control.BatteryPVReserve_W'), 0);
    assert.ok(h.physical().heaterW + h.physical().heatingW >= 5600, h.diagnostic());
});

test('battery heartbeat failure zeroes GS then EHZ accepts the released surplus', async () => {
    const h = await plant({battery: true, heating: true, wallbox: false, batteryPlanW: 1500});
    await h.advance(100);
    assert.ok(h.physical().batteryW >= 1000, h.diagnostic());
    h.setBatteryHeartbeat(false);
    await h.advance(70);
    assert.equal(h.physical().batteryW, 0, h.diagnostic());
    assert.equal(h.value('Control.FineRegulator'), 'MyPV_DHW');
    assert.ok(h.writes.some(write => write.id === h.config.batterySetpointId && write.val === 0));
    assert.ok(h.physical().heaterW + h.physical().heatingW >= 5600, h.diagnostic());
});

test('cheap import heats both independent tanks without being canceled or supplied by the battery', async () => {
    const h = await plant({battery: true, heating: true, wallbox: false, cheap: true, initialSurplusW: 0});
    await h.advance(90);
    assert.ok(h.physical().heaterW > 0 && h.physical().heatingW > 0, h.diagnostic());
    assert.equal(h.physical().heaterW + h.physical().heatingW, 2000, h.diagnostic());
    assert.equal(h.physical().batteryW, 0);
    assert.equal(h.value('Control.HeaterCheapGridAllocation_W'), 2000);
    assert.equal(h.value('Control.AllowHeaterGridImport'), true);
    assert.equal(h.value('Control.HeaterBudgetMode'), 'BUDGET');
    h.put('hk.cooling', true);
    await h.advance(20);
    assert.equal(h.physical().heatingW, 0, h.diagnostic());
    assert.equal(h.physical().heaterW, 2000, 'cooling inhibits HK, never the independent hot-water tank');
    assert.equal(h.physical().batteryW, 0);
    h.own('Config.ThermalCheapPriceEnabled', false);
    await h.advance(15);
    assert.equal(h.physical().heaterW, 0, h.diagnostic());
});

test('mandatory EV import is protected while battery discharges only the separate house baseline', async () => {
    const h = await plant({battery: true, heating: true, startDelayS: 0, initialSurplusW: -800});
    h.put('DP_WB2_SOC', 10);
    await h.advance(110);
    assert.equal(h.physical().allow, 1, h.diagnostic());
    assert.ok(h.physical().batteryW >= -800 && h.physical().batteryW <= -700, h.diagnostic());
    assert.equal(h.physical().heaterW + h.physical().heatingW, 0);
    assert.ok(h.trace.filter(point => point.batteryW < 0).every(point => point.batteryW >= -800));
    h.put(h.run('CFG.dp.batterySoc'), 20);
    await h.advance(15);
    assert.equal(h.physical().batteryW, 0, h.diagnostic());
    assert.equal(h.physical().allow, 1, 'mandatory charging continues but cannot consume the battery reserve');
});

test('LPC constrains gross battery charging + both heaters + WB during delayed handoffs and cooling', async () => {
    const h = await plant({battery: true, heating: true, lpcLimitW: 4200, initialSurplusW: 10000,
        batteryPlanW: 600, startDelayS: 30});
    await h.advance(200);
    h.put('hk.cooling', true);
    await h.advance(30);
    assert.ok(h.trace.every(point => Math.max(0, point.batteryW) + point.heaterW
        + point.heatingW + point.wbW <= 4200), h.diagnostic());
    assert.ok(h.value('Control.GrossConsumptionTarget_W') <= 4200);
    assert.equal(h.physical().heatingW, 0);
    assert.equal(h.value('Control.Targets.Wallbox0_W'), 0);
});

test('unavailable external battery charging cannot be reclaimed and its discharge cannot masquerade as PV', async () => {
    const h = await plant({battery: false, heating: true, wallbox: false, initialSurplusW: 4000});
    h.setBatteryPower(2000);
    await h.advance(90);
    assert.ok(h.physical().heaterW + h.physical().heatingW <= 2000, h.diagnostic());
    assert.ok(h.value('Control.AvailablePVPower_W') <= 2000);
    h.setSurplus(0);
    h.setBatteryPower(-2000);
    await h.advance(30);
    assert.equal(h.physical().heaterW + h.physical().heatingW, 0, h.diagnostic());
    assert.equal(h.value('Control.AvailablePVPower_W'), 0);
});

test('shared LPC reservation rejects missing live peers and never credits a battery discharge', async () => {
    const h = await plant({battery: true, heating: true, wallbox: false, lpcLimitW: 4200});
    await h.advance(30);
    const before = h.run('coordinatedConsumptionLoads()');
    assert.equal(before.valid, true);
    h.put('hk.power1', 0, {ts: h.now() - 130000});
    assert.equal(h.run('coordinatedConsumptionLoads().valid'), false);
    h.put('hk.power1', 0);
    h.put(h.config.batteryAcPowerId, 2400);
    h.own('Devices.Battery.OutputOwned', true);
    h.own('Devices.Battery.OutputCommandInternal_W', -2400);
    assert.ok(h.run('coordinatedConsumptionLoads().batteryW') >= 200,
        'an older positive reservation survives a newer discharge command');
    h.own('Devices.Battery.OutputReservedCharge_W', 0);
    assert.equal(h.run('coordinatedConsumptionLoads().batteryW'), 0);
    h.own('Devices.Battery.OutputCommandInternal_W', 1200);
    assert.equal(h.run('coordinatedConsumptionLoads().batteryW'), 1200, 'pending charge counts before real response');
});

test('battery actuator without real response never winds up and relinquishes fine regulation', async () => {
    const h = await plant({battery: true, heating: true, wallbox: false, batteryPlanW: 1800});
    h.setBatteryResponse(false);
    await h.advance(100);
    const commands = h.writes.filter(write => write.id === h.config.batterySetpointId && write.val !== 0);
    assert.ok(commands.length >= 1);
    assert.ok(commands.every(write => Math.abs(write.val) <= 100), JSON.stringify(commands));
    assert.equal(h.physical().batteryW, 0);
    assert.equal(h.value('Control.FineRegulator'), 'MyPV_DHW');
    assert.equal(h.value('Control.BatteryPVReserve_W'), 0);
    assert.ok(h.physical().heaterW + h.physical().heatingW >= 5500, h.diagnostic());
});

test('PV plus cheap import remains bounded and no thermal permission leaks into EV or battery grid charging', async () => {
    const h = await plant({battery: true, heating: true, cheap: true, initialSurplusW: 500,
        startDelayS: 0});
    await h.advance(150);
    assert.equal(h.physical().allow, 0, 'cheap heat is never an EV start allowance');
    assert.ok(h.physical().batteryW >= 0 && h.physical().batteryW <= 500, h.diagnostic());
    assert.ok(h.physical().heaterW > 0 && h.physical().heatingW > 0, h.diagnostic());
    assert.ok(h.trace.at(-1).gridW <= 2000, h.diagnostic());
    h.setSurplus(0);
    await h.advance(25);
    assert.equal(h.physical().batteryW, 0, 'zero PV cannot charge battery using thermal cheap-import permission');
    assert.equal(h.physical().heaterW + h.physical().heatingW, 2000, h.diagnostic());
});

test('unknown cooling status stops HK while independent hot water remains available', async () => {
    const h = await plant({heating: true, wallbox: false});
    await h.advance(50);
    assert.ok(h.physical().heatingW > 0, h.diagnostic());
    h.put('hk.cooling', null);
    await h.advance(25);
    assert.equal(h.physical().heatingW, 0);
    assert.ok(h.physical().heaterW >= 5600, h.diagnostic());
    assert.equal(h.value('Devices.MyPV_Heating.CoolingBlocked'), true);
});

test('joint phase protection reserves concurrent actuator increases on an almost full house phase', async () => {
    const h = await plant({battery: true, heating: true, wallbox: true, batteryPlanW: 800,
        startDelayS: 20, phaseBiasW: [10000, -5000, -5000]});
    await h.advance(180);
    assert.ok(h.trace.every(point => point.phaseImportW.every(watts => watts <= 46 * 230 + 1)),
        JSON.stringify(h.trace.filter(point => point.phaseImportW.some(watts => watts > 46 * 230 + 1)).slice(0, 8), null, 2));
    assert.ok(h.writes.some(write => write.id === 'DP_DHW_SETPOINT' && write.val > 0)
        || h.writes.some(write => write.id === 'hk.setpoint' && write.val > 0), 'safe available phase room remains usable');
});

test('phase reservations include staged EHZ relocation and battery sign reversal, never pending reductions', async () => {
    const h = await plant({battery: true, heating: true, wallbox: false});
    await h.advance(2);
    h.own('Devices.MyPV_DHW.OutputOwned', true);
    h.own('Devices.MyPV_DHW.OutputCommand_W', 3001);
    h.put('DP_DHW_OUTPUT1', 3000); h.put('DP_DHW_OUTPUT2', 0); h.put('DP_DHW_OUTPUT3', 0);
    h.own('Devices.Battery.OutputOwned', true);
    h.own('Devices.Battery.OutputCommandInternal_W', 100);
    h.put(h.config.batteryAcPowerId, 500);
    let phases = h.run('coordinatedPhaseReservations("MyPV_Heating")');
    assert.deepEqual(Array.from(phases.dhwW), [0, 3000, 0], 'one watt across a stage boundary is not a one-watt phase change');
    assert.deepEqual(Array.from(phases.batteryW), [600, 600, 600], 'unknown battery grid phase is never guessed');
    h.own('Devices.MyPV_DHW.OutputCommand_W', 0);
    phases = h.run('coordinatedPhaseReservations("Battery")');
    assert.deepEqual(Array.from(phases.dhwW), [0, 0, 0]);
    assert.ok(phases.otherW.every(watts => watts >= 0));
});

test('coordinated plant baseline uses fresh physical powers, never stale optimistic mirrors', async () => {
    const h = await plant({battery: true, heating: true, wallbox: false});
    await h.advance(2);
    h.own('Actual.MyPV_DHW_W', 50000);
    h.own('Actual.MyPV_Heating_W', 50000);
    h.run('realtimeControl()');
    assert.equal(h.value('Control.AvailablePVPower_W'), 5900);
    assert.ok(h.value('Control.HeaterPVAllocation_W') <= 5900);
    h.put('DP_DHW_OUTPUT1', 3000, {ts: h.now() - 130000});
    h.run('realtimeControl()');
    assert.equal(h.value('Control.Valid'), false, 'missing physical peer data is not zero watts even without an LPC cap');
    assert.equal(h.value('Control.Targets.MyPV_DHW_W'), 0);
    assert.equal(h.value('Control.Targets.MyPV_Heating_W'), 0);
    assert.equal(h.value('Control.Targets.Battery_W'), 0);
    assert.equal(h.value('Control.FineRegulator'), 'none');
});

test('battery at its HA charge bound hands fine control back rather than reserving unreachable PV', async () => {
    const h = await plant({battery: true, heating: true, wallbox: false});
    await h.advance(2);
    for (const p of [1, 2, 3]) h.put(`DP_DHW_HA_L${p}_CURRENT_A`, 46);
    h.run('realtimeControl()');
    assert.equal(h.value('Control.BatteryPVReserve_W'), 0);
    assert.equal(h.value('Control.Targets.Battery_W'), 0);
    assert.equal(h.value('Control.FineRegulator'), 'MyPV_DHW');
});

test('late first battery charging response remains reserved after an earlier zero request', async () => {
    const h = await plant({battery: true, wallbox: false, lpcLimitW: 4200,
        initialSurplusW: 10000, batteryDelayMs: 8000});
    h.own('Config.DHWFastIncreaseMaxStep_W', 9000);
    await h.advance(2);
    assert.ok(h.writes.some(write => write.id === h.config.batterySetpointId && write.val === -100));
    h.put(h.run('CFG.dp.batterySoc'), 95);
    await h.advance(6);
    assert.equal(h.physical().batteryW, 0, 'old positive command has not taken effect yet');
    assert.equal(h.value('Devices.Battery.OutputOwned'), true, 'pre-effect zero cannot prove cancellation');
    assert.ok(h.run('coordinatedConsumptionLoads().batteryW') >= 100,
        'pending positive command is not spendable when a newer zero was accepted');
    await h.advance(30);
    assert.ok(h.trace.every(point => Math.max(0, point.batteryW) + point.heaterW + point.heatingW
        + point.wbW <= 4200), JSON.stringify(h.trace.slice(0, 18), null, 2));
    assert.equal(h.physical().batteryW, 0);
    assert.equal(h.value('Devices.Battery.OutputOwned'), false, 'observed rise and subsequent real zero complete shutdown');
});

test('cooling cancellation keeps the delayed first HK increase reserved until its real rise and stop', async () => {
    const h = await plant({heating: true, wallbox: false, lpcLimitW: 4200,
        initialSurplusW: 10000, heatingDelayMs: 8000});
    await h.advance(6);
    assert.ok(h.writes.some(write => write.id === 'hk.setpoint' && write.val > 0));
    h.put('hk.cooling', true);
    await h.advance(4);
    assert.equal(h.physical().heatingW, 0, 'the old nonzero command is still in flight');
    assert.ok(h.run('coordinatedConsumptionLoads().heatingW') >= 1000,
        'cooling stop acknowledgement cannot free a still-unseen positive command');
    await h.advance(35);
    assert.ok(h.trace.every(point => point.heaterW + point.heatingW <= 4200),
        JSON.stringify(h.trace.slice(4, 22), null, 2));
    assert.equal(h.physical().heatingW, 0);
    assert.ok(h.physical().heaterW >= 4000, h.diagnostic());
});

test('DC-only battery charging from local PV is never treated as controllable AC grid consumption', async () => {
    const h = await plant({battery: true, heating: true, wallbox: false,
        initialSurplusW: 0, batteryDcPvW: 800});
    await h.advance(30);
    assert.equal(h.run('readNumber(CFG.dp.batteryPower, 0)'), 800);
    assert.equal(h.run('batteryMeasuredPowerW()'), 0);
    assert.equal(h.run('batteryRegulationState().available'), true,
        'DC charging is not a foreign AC actuator command');
    assert.equal(h.value('Control.AvailablePVPower_W'), 0);
    assert.equal(h.physical().heaterW + h.physical().heatingW + h.physical().batteryW, 0);
    assert.ok(!h.writes.some(write => write.id === h.config.batterySetpointId && write.val !== 0));
});

test('battery GS feedback follows AC port power despite DC conversion loss', async () => {
    const h = await plant({battery: true, heating: true, wallbox: false,
        batteryPlanW: 1000, batteryDcFactor: 0.9});
    await h.advance(100);
    assert.ok(h.physical().batteryW >= 900, h.diagnostic());
    assert.equal(h.value('Devices.Battery.Fault'), '');
    assert.equal(h.run('batteryMeasuredPowerW()'), h.physical().batteryW);
    assert.ok(Math.abs(h.run('readNumber(CFG.dp.batteryPower, 0)') - h.physical().batteryW * 0.9) < 0.01);
    assert.ok(h.writes.some(write => write.id === h.config.batterySetpointId && write.val <= -900),
        'normal conversion losses cannot look like a stuck actuator at 300 W');
});

test('queued electrical recheck uses current LPC, thermal cooling and latest target after persistence waits', async () => {
    const h = await plant({battery: true, heating: true, wallbox: false, lpcLimitW: 4200});
    await h.advance(2);
    h.own('Control.Targets.MyPV_DHW_W', 3000);
    h.own('Control.Targets.MyPV_Heating_W', 2000);
    h.put('lpc.limit', 500);
    assert.equal(h.run('checkQueuedElectricalOutput("MyPV_DHW", 3000).allowed'), false);
    assert.equal(h.run('checkQueuedElectricalOutput("MyPV_Heating", 2000).allowed'), false);
    h.put('lpc.limit', 4200);
    h.put('hk.cooling', true);
    assert.equal(h.run('checkQueuedElectricalOutput("MyPV_Heating", 500).allowed'), false);
    assert.equal(h.run('checkQueuedElectricalOutput("MyPV_DHW", 500).allowed'), true);
    h.own('Control.Targets.MyPV_DHW_W', 100);
    assert.equal(h.run('checkQueuedElectricalOutput("MyPV_DHW", 500).allowed'), false);
    h.own('Control.Targets.Battery_W', 0);
    assert.equal(h.run('checkQueuedElectricalOutput("Battery", -100).allowed'), false);
    assert.equal(h.run('checkQueuedElectricalOutput("Battery", 100).allowed'), false);
    h.put('lpc.state', 'failsafe');
    for (const device of ['Battery', 'MyPV_DHW', 'MyPV_Heating'])
        assert.equal(h.run(`checkQueuedElectricalOutput(${JSON.stringify(device)}, 0).allowed`), true,
            'safety zero cannot be blocked by a stale or failsafe limit');
});

test('passive diagnostics preserve all four actuator sequences in coordinated operation', async () => {
    const scenario = async diagnostics => {
        const h = await plant({battery: true, heating: true, cheap: true,
            diagnostics, startDelayS: 30});
        await h.advance(140);
        h.setSurplus(300);
        await h.advance(30);
        h.put('hk.cooling', true);
        await h.advance(25);
        h.setSurplus(6000);
        await h.advance(60);
        return h;
    };
    const disabled = await scenario(false), enabled = await scenario(true);
    assert.deepEqual(enabled.writes, disabled.writes);
    assert.deepEqual(enabled.trace, disabled.trace);
    assert.ok(enabled.diagnosticWrites.length > disabled.diagnosticWrites.length);
});

test('integrated 30s cloud dip holds charging; recovered surplus cancels delayed stop; 50/50 off does not stop', async () => {
    const h = await plant({startDelayS: 0});
    await h.advance(180);
    assert.equal(h.physical().allow, 1, h.diagnostic());
    const beforeDip = h.now();
    h.setSurplus(300);
    await h.advance(30);
    assert.equal(h.physical().allow, 1, h.diagnostic());
    assert.equal(h.physical().amps, 6, h.diagnostic());
    assert.equal(h.physical().heaterW, 0, h.diagnostic());
    h.setSurplus(6000);
    await h.advance(150);
    h.put('DP_DHW_PARALLEL_RELEASE', false);
    await h.advance(40);
    assert.equal(h.physical().allow, 1, h.diagnostic());
    assert.equal(h.value('Control.ParallelDistributionActive'), false);
    assert.equal(h.writes.filter(write => write.id === 'goe.allow' && write.val === 0 && write.at >= beforeDip).length, 0,
        h.diagnostic());
});

test('integrated continuous deficit stops after the configured 120s delay, then EHZ takes small residual', async () => {
    const h = await plant({startDelayS: 0});
    await h.advance(180);
    assert.equal(h.physical().allow, 1, h.diagnostic());
    const beforeDip = h.now();
    h.setSurplus(800);
    await h.advance(110);
    assert.equal(h.physical().allow, 1, h.diagnostic());
    assert.equal(h.physical().heaterW, 0, h.diagnostic());
    await h.advance(30);
    assert.equal(h.physical().allow, 0, h.diagnostic());
    const stop = h.writes.find(write => write.id === 'goe.allow' && write.val === 0 && write.at >= beforeDip);
    assert.ok(stop && stop.at - beforeDip >= 120000, h.diagnostic());
    assert.ok(stop.at - beforeDip <= 126000, h.diagnostic());
    assert.ok(h.physical().heaterW >= 500 && h.physical().heaterW <= 800, h.diagnostic());
});

test('passive diagnostics preserve every WB/EHZ command through delayed startup and a cloud dip', async () => {
    const disabled = await plant({diagnostics: false});
    const enabled = await plant({diagnostics: true});
    for (const h of [disabled, enabled]) {
        await h.advance(240);
        assert.equal(h.physical().allow, 1, h.diagnostic());
        h.setSurplus(300);
        await h.advance(30);
        assert.equal(h.physical().allow, 1, h.diagnostic());
        assert.equal(h.physical().amps, 6, h.diagnostic());
        h.setSurplus(6000);
        await h.advance(150);
        h.put('DP_DHW_PARALLEL_RELEASE', false);
        await h.advance(40);
    }
    assert.deepEqual(enabled.writes, disabled.writes,
        'diagnostics must not change any external command, mirror value, ordering or timestamp');
    assert.deepEqual(enabled.trace, disabled.trace,
        'physical response, allocator targets and control statuses remain identical');
    const snapshots = enabled.diagnosticWrites.filter(write => write.id === 'ems.0.Debug.Snapshot_JSON');
    assert.ok(snapshots.length > 0, 'enabled recorder actually persisted diagnostic snapshots');
    assert.ok(snapshots.length <= 460 / 5 + 1, 'snapshots are bounded by the diagnostic sampling cadence');
    assert.ok(enabled.diagnosticWrites.length <= 20 + (460 / 5) * 20,
        'diagnostic persistence remains bounded independently of high-frequency state changes');
    assert.equal(disabled.diagnosticWrites.filter(write => write.id === 'ems.0.Debug.Snapshot_JSON').length, 0,
        'disabled recorder does not collect snapshots');
    const events = JSON.parse(enabled.value('Debug.Events_JSON'));
    const power = JSON.parse(enabled.value('Debug.PowerTrace_JSON'));
    assert.ok(events.length > 0 && events.length <= 100, 'bounded meaningful event ring');
    assert.ok(power.length > 0 && power.length <= 120, 'bounded power trace ring');
});
