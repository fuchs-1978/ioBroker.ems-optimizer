'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const {createEngineContext, MODULES} = require('../lib/engine-loader');
const {createRequire} = require('node:module');

// Shared, deterministic plant: real allocator + real output state machines,
// delayed ioBroker ack and delayed AC THOR power, no device/network writes.
async function plant({startDelayS = 120, minimumRuntimeS = 120, split = true, diagnostics,
    battery = false, heating = false, wallbox = true, cheap = false,
    mii = false, adoptRunningMii = false, wallboxStopResponseDelayMs = 0,
    initialSurplusW = 6000, batteryPlanW = 0, lpcLimitW = null, phaseBiasW = [0, 0, 0],
    batteryDelayMs = 2000, heatingDelayMs = 4000, dhwDelayMs = 4000,
    batteryDcFactor = 1, batteryDcPvW = 0, wb2InitialPhaseMode = null,
    nativeConfig: configOverrides = {}, sourceQuality,
    initialTime = Date.UTC(2026, 8, 21, 12)} = {}) {
    let now = initialTime, surplusW = 6000, idleWallboxNoiseKW = 0;
    let heaterW = 0, heaterCommandW = 0, physicalAllow = 0, physicalA = 6;
    let wallboxWriteDelayMs = 0;
    let physicalPowerAllow = 0, miiAllow = 0, miiPowerAllow = 0, miiA = 6;
    const wallboxStopAck = [true, true, true];
    const wallboxCurrentQuality = [0, 0, 0];
    let physicalStopResponseSequence = 0, miiStopResponseSequence = 0;
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
        const state = {val, ack: true, ts: now,
            ...(sourceQuality === undefined ? {} : {q: sourceQuality}), ...extra};
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
    if (wb2InitialPhaseMode !== null) Object.assign(config, {wb2PhaseSwitchEnabled: true,
        wb2PhaseControlMode: 'ems', wb2PhaseModeId: 'goe.phase', phaseSwitchMinHoldMin: 0});
    if (mii) Object.assign(config, {multiWallboxAlphaArmed: true,
        wallboxPrioritySource: 'external', wallboxPriorityId: 'DP_WB_PRIORITY',
        wb0ControlEnabled: true, wb0ProductionArmed: true,
        wb0CommissioningMaxA: 16, wb0MinCurrent1pA: 6, wb0MaxCurrent1pA: 16,
        wb0MaxPowerW: 3680, wb0ProductionPhases: 1, wb0PhaseSwitchEnabled: false,
        wb0AmpereOutputId: 'goe0.cmd', wb0AmpereFeedbackId: 'goe0.feedback',
        wb0AllowOutputId: 'goe0.allow', wb0ConnectionId: 'goe0.connection', wb0ErrorId: 'goe0.error'});
    if (adoptRunningMii) config.wallboxParallelChargingEnabled = true;
    if (!wallbox) config.wb2ControlEnabled = false;
    Object.assign(config, configOverrides);
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
            events.push({at: now + 4000, run: () => {
                if (val === 0 && !wallboxStopAck[2]) return;
                physicalAllow = val; put(id, val);
                const responseSequence = ++physicalStopResponseSequence;
                if (val || wallboxStopResponseDelayMs === 0 || !physicalPowerAllow) physicalPowerAllow = val;
                else events.push({at: now + wallboxStopResponseDelayMs,
                    run: () => {
                        if (responseSequence === physicalStopResponseSequence) physicalPowerAllow = 0;
                    }});
            }});
        } else if (id === 'goe0.cmd') {
            put(id, val, {ack: false});
            events.push({at: now + 4000, run: () => {
                miiA = val; put(id, val); put('goe0.feedback', val);
            }});
        } else if (id === 'goe0.allow') {
            put(id, val, {ack: false});
            events.push({at: now + 4000, run: () => {
                if (val === 0 && !wallboxStopAck[0]) return;
                miiAllow = val; put(id, val);
                const responseSequence = ++miiStopResponseSequence;
                if (val || wallboxStopResponseDelayMs === 0 || !miiPowerAllow) miiPowerAllow = val;
                else events.push({at: now + wallboxStopResponseDelayMs,
                    run: () => {
                        if (responseSequence === miiStopResponseSequence) miiPowerAllow = 0;
                    }});
            }});
        } else put(id, val);
        callback?.(null);
        return true;
    };
    // Discover synthetic IDs without maintaining a second engine module list.
    for (const name of MODULES)
        substitute(fs.readFileSync(path.join(__dirname, '../lib/engine', `${name}.js`), 'utf8'));
    const ctx = createEngineContext('ems.0', mapping, {Date: Clock, console, nativeConfig: config,
        gridConstraints: require('../lib/grid-constraints'),
        normalizeWallboxPowerKW: require('../lib/wallbox-measurement').normalizeWallboxPowerKW,
        getState: id => states.get(id), existsState: id => states.has(id),
        createState: (id, val) => { if (!states.has(id)) put(id, val); }, setState: put,
        writeForeignState: writeForeign, log: () => {}, sendTo: () => {}});
    vm.runInContext('createStates()', ctx);
    vm.runInContext('createBatteryStates();createHeatingStates();createHeatPumpStates();createEnergyCoordinationStates()', ctx);
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
        own(`Devices.Wallbox${wb}.ControlEnabled`, wb === 2 && wallbox || wb === 0 && mii);
        own(`Vehicles.Wallbox${wb}.PhaseSwitchEnabled`, wb === 2 && wb2InitialPhaseMode !== null);
        own(`Vehicles.Wallbox${wb}.MaximumPhases`, wb === 2 && wb2InitialPhaseMode !== null ? 3 : 1);
        own(`Vehicles.Wallbox${wb}.MinCurrent1P_A`, 6);
        own(`Vehicles.Wallbox${wb}.MaxCurrent1P_A`, wb === 0 && mii ? 16 : 32);
        own(`Config.Wallbox${wb}MaxPower_W`, wb === 0 && mii ? 3680 : 7360);
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
    if (wb2InitialPhaseMode !== null) put('goe.phase', wb2InitialPhaseMode);
    if (mii) {
        put('goe0.connection', true); put('goe0.error', 0);
        put('goe0.allow', 0); put('goe0.feedback', 6); put('DP_WB_PRIORITY', 2);
    }
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
        setForeignStateAsync: async (id, val) => {
            writeForeign(id, val);
            if ([0, 1, 2].some(wb => id === config[`wb${wb}AmpereOutputId`]
                || id === config[`wb${wb}AllowOutputId`])) now += wallboxWriteDelayMs;
        },
        getForeignStateAsync: async id => states.get(id), subscribeForeignStatesAsync: async () => {},
        getForeignObjectAsync: async () => ({type: 'state', common: {write: true, type: 'number'}}),
        queueCompatState: async (id, val) => { if (!states.has(id)) put(id, val); },
        log: {warn: () => {}, info: () => {}, error: () => {}}};
    const wallboxFile = path.join(__dirname, '../lib/wallbox-output.js');
    const module = {exports: {}};
    vm.runInNewContext(`(function(require,module,exports){${fs.readFileSync(wallboxFile, 'utf8')}\n})`,
        {Date: Clock})(createRequire(wallboxFile), module, module.exports);
    let output = new module.exports(adapter);
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
        const wbW = physicalPowerAllow ? physicalA * 230 : 0;
        const miiW = miiPowerAllow ? miiA * 230 : 0;
        const gridW = heaterW + heatingW + batteryW + wbW + miiW - surplusW;
        for (const [id, state] of states) if (state.ack && !id.startsWith('ems.0.')) put(id, state.val);
        put('DP_GRID_IMPORT', Math.max(0, gridW)); put('DP_GRID_EXPORT', Math.max(0, -gridW));
        own('Actual.GridPower_W', gridW); own('Actual.MyPV_DHW_W', heaterW);
        own('Actual.MyPV_Heating_W', heatingW);
        put(vm.runInContext('CFG.dp.batteryPower', ctx), batteryW * batteryDcFactor + batteryDcPvW);
        put(config.batteryAcPowerId, -batteryW || 0);
        if (batteryHeartbeat) put(config.batteryHeartbeatId, now);
        for (const wb of [0, 1, 2]) {
            const powerW = wb === 2 ? wbW : wb === 0 ? miiW : 0;
            put(`DP_WB${wb}_POWER`, powerW === 0 ? idleWallboxNoiseKW : powerW / 1000);
            const currentQuality = wallboxCurrentQuality[wb] ? {q: wallboxCurrentQuality[wb]} : {};
            put(`DP_WB${wb}_L1_A`, wb === 2 && physicalPowerAllow ? physicalA : wb === 0 && miiPowerAllow ? miiA : 0,
                currentQuality);
            put(`DP_WB${wb}_L2_A`, 0, currentQuality); put(`DP_WB${wb}_L3_A`, 0, currentQuality);
        }
        const stagedPhases = (watts, stage) => watts <= stage ? [watts, 0, 0]
            : watts <= stage * 2 ? [watts - stage, stage, 0] : [watts - stage * 2, stage, stage];
        const wwPhases = stagedPhases(heaterW, 3000), hkPhases = stagedPhases(heatingW, 2000);
        for (let phase = 0; phase < 3; phase++) {
            put(`DP_DHW_OUTPUT${phase + 1}`, wwPhases[phase]);
            put(`hk.power${phase + 1}`, hkPhases[phase]);
            const phasePowerW = -surplusW / 3 + phaseBiasW[phase]
                + wwPhases[phase] + hkPhases[phase] + (phase === 0 ? wbW + miiW + batteryW : 0);
            put(`DP_DHW_HA_L${phase + 1}_CURRENT_A`, Math.max(0, phasePowerW / 230));
        }
        for (const key of ['System.LastUpdate', 'Plan.LastUpdate']) own(key, now);
    };
    if (adoptRunningMii) {
        assert.ok(mii, 'the synthetic adopted running device must be configured');
        miiAllow = miiPowerAllow = 1; miiA = 6;
        put('goe0.allow', 1); put('goe0.feedback', 6); put('DP_WB_PRIORITY', 0);
        put('DP_WB0_PHASE_MODE', 1);
        own('Devices.Wallbox0.OutputOwned', true); own('Devices.Wallbox0.OutputActive', true);
        own('Devices.Wallbox0.OutputCommand_A', 6); own('Devices.Wallbox0.OutputPhases', 1);
        own('Control.RestartHandoffActive', true); own('Control.RestartHandoffSince', now);
    }
    refresh();
    await output.initialize();
    const tick = async () => {
        now += 1000;
        for (const event of events.filter(event => event.at <= now)) event.run();
        for (let index = events.length - 1; index >= 0; index--)
            if (events[index].at <= now) events.splice(index, 1);
        refresh();
        if (now % 2000 === 0) {
            vm.runInContext('updateVehicles();updateDhwSimulation()', ctx);
        }
        vm.runInContext('realtimeControl();updateBatteryProductionOutput()', ctx);
        if (now % 2000 === 0) await output.tick();
        if (now % 5000 === 0) {
            vm.runInContext('updateDhwProductionOutput();updateHeatingProductionOutput()', ctx);
            recorder?.sample();
        }
        trace.push({at: now, wbW: physicalPowerAllow ? physicalA * 230 : 0,
            miiW: miiPowerAllow ? miiA * 230 : 0, heaterW, heatingW, batteryW,
            gridW: heaterW + heatingW + batteryW + (physicalPowerAllow ? physicalA * 230 : 0)
                + (miiPowerAllow ? miiA * 230 : 0) - surplusW,
            fine: value('Control.FineRegulator'), physicalAllow, miiAllow,
            selectedWallbox: value('Control.SelectedWallbox'),
            phaseImportW: [1, 2, 3].map(p => Number(states.get(`DP_DHW_HA_L${p}_CURRENT_A`)?.val || 0) * 230),
            targetW: value('Control.Targets.Wallbox2_W'), heaterTargetW: value('Control.Targets.MyPV_DHW_W'),
            heatingTargetW: value('Control.Targets.MyPV_Heating_W'), batteryTargetW: value('Control.Targets.Battery_W'),
            batteryStatus: value('Devices.Battery.OutputStatus'), heatingStatus: value('Devices.MyPV_Heating.OutputStatus'),
            status: value('Devices.Wallbox2.OutputStatus'), heaterStatus: value('Devices.MyPV_DHW.OutputStatus')});
    };
    return {states, writes, trace, put, own, value, get output() {return output;}, diagnosticWrites,
        config, mapping, engineContext: ctx,
        now: () => now,
        run: code => vm.runInContext(code, ctx),
        // A manual input frame uses the real allocator/output path while
        // keeping source and ACK timestamps independent of the clock. It
        // deliberately does not dispatch the plant's automatic responses:
        // the caller supplies those observations in the recorded order.
        replayAt: async (timestamp, samples = [], {allocate = true, output: runOutput = true} = {}) => {
            assert.ok(Number.isFinite(timestamp) && timestamp >= now, 'replay time must be monotonic');
            now = timestamp;
            refresh();
            for (const [id, val, extra = {}] of samples) put(id, val, extra);
            if (allocate) {
                vm.runInContext('updateVehicles();updateDhwSimulation()', ctx);
                vm.runInContext('realtimeControl();updateBatteryProductionOutput()', ctx);
            }
            if (runOutput) {
                await output.tick();
                vm.runInContext('updateDhwProductionOutput();updateHeatingProductionOutput()', ctx);
            }
        },
        restartOutput: async () => {
            output = new module.exports(adapter);
            adapter.wallboxOutput = output;
            await output.initialize();
        },
        setWallboxWriteDelay: milliseconds => {
            assert.ok(Number.isFinite(milliseconds) && milliseconds >= 0);
            wallboxWriteDelayMs = milliseconds;
        },
        setSurplus: watts => { surplusW = watts; },
        setBatteryResponse: value => { batteryResponds = value; },
        setBatteryHeartbeat: value => { batteryHeartbeat = value; },
        setBatteryPower: value => { batteryW = value; },
        setWallboxStopAck: (wb, enabled) => { wallboxStopAck[wb] = enabled; },
        setWallboxCurrentQuality: (wb, quality) => { wallboxCurrentQuality[wb] = quality; },
        setIdleWallboxNoise: kw => { idleWallboxNoiseKW = kw; },
        setWallboxPhysical: (wb, {allow = 1, amps = 6} = {}) => {
            if (wb === 0) {
                miiAllow = miiPowerAllow = allow; miiA = amps; ++miiStopResponseSequence;
                put('goe0.allow', allow); put('goe0.feedback', amps);
            } else if (wb === 2) {
                physicalAllow = physicalPowerAllow = allow; physicalA = amps; ++physicalStopResponseSequence;
                put('goe.allow', allow); put('goe.feedback', amps);
            } else assert.fail(`unknown synthetic wallbox ${wb}`);
        },
        advance: async seconds => { for (let second = 0; second < seconds; second++) await tick(); },
        physical: () => ({allow: physicalAllow, amps: physicalA, miiAllow, miiAmps: miiA,
            wbPowerW: physicalPowerAllow ? physicalA * 230 : 0, miiPowerW: miiPowerAllow ? miiA * 230 : 0,
            heaterW, heatingW, batteryW}),
        diagnostic: () => JSON.stringify(trace.slice(-12), null, 2)};
}

module.exports = {plant};
