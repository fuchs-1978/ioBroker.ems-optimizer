'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const {createRequire} = require('node:module');

// Shared, deterministic plant: real allocator + real output state machines,
// delayed ioBroker ack and delayed AC THOR power, no device/network writes.
async function plant({startDelayS = 120, minimumRuntimeS = 120, split = true} = {}) {
    let now = Date.UTC(2026, 8, 21, 12), surplusW = 6000;
    let heaterW = 0, heaterCommandW = 0, physicalAllow = 0, physicalA = 6;
    const states = new Map(), writes = [], events = [], trace = [];
    class Clock extends Date {
        constructor(...args) { super(...(args.length ? args : [now])); }
        static now() { return now; }
    }
    const put = (id, val, extra = {}) => states.set(id, {val, ack: true, ts: now, ...extra});
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
        dhwHaL3CurrentId: 'DP_DHW_HA_L3_CURRENT_A'};
    const writeForeign = (id, val, callback) => {
        writes.push({id, val, at: now});
        if (id === 'DP_DHW_SETPOINT') {
            if (val !== heaterCommandW) {
                heaterCommandW = val;
                events.push({at: now + 4000, run: () => { heaterW = val; put(id, val); }});
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
    for (const file of ['core', 'history', 'forecast', 'vehicles', 'dhw-controller', 'planner', 'realtime', 'dhw-output'])
        vm.runInContext(substitute(fs.readFileSync(path.join(__dirname, '../lib/engine', `${file}.js`), 'utf8')), ctx);
    vm.runInContext('createStates()', ctx);
    vm.runInContext(substitute(fs.readFileSync(path.join(__dirname, '../lib/engine/config-mapping.js'), 'utf8')), ctx);
    for (const key of ['DP_PAR14A', 'DP_LPC_STATE', 'DP_LPC_LIMIT', 'DP_HEAT_PUMP_POWER']) mapping[key] = '';
    for (const phase of [1, 2, 3]) {
        mapping[`DP_HA_L${phase}_IMPORT_W`] = '';
        mapping[`DP_HA_L${phase}_EXPORT_W`] = '';
    }
    vm.runInContext("CFG.dp.par14a='';CFG.dp.lpcState='';CFG.dp.lpcLimit='';CFG.dp.haPhaseImportW=[];CFG.dp.haPhaseExportW=[]", ctx);
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
    for (const wb of [0, 1, 2]) {
        own(`Devices.Wallbox${wb}.Present`, wb !== 1);
        own(`Devices.Wallbox${wb}.ControlEnabled`, wb === 2);
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
    const refresh = () => {
        const wbW = physicalAllow ? physicalA * 230 : 0;
        const gridW = heaterW + wbW - surplusW;
        for (const [id, state] of states) if (state.ack && !id.startsWith('ems.0.')) put(id, state.val);
        put('DP_GRID_IMPORT', Math.max(0, gridW)); put('DP_GRID_EXPORT', Math.max(0, -gridW));
        own('Actual.GridPower_W', gridW); own('Actual.MyPV_DHW_W', heaterW);
        for (const wb of [0, 1, 2]) {
            put(`DP_WB${wb}_POWER`, wb === 2 ? wbW / 1000 : 0);
            put(`DP_WB${wb}_L1_A`, wb === 2 && physicalAllow ? physicalA : 0);
            put(`DP_WB${wb}_L2_A`, 0); put(`DP_WB${wb}_L3_A`, 0);
        }
        for (let phase = 0; phase < 3; phase++) {
            put(`DP_DHW_OUTPUT${phase + 1}`, Math.max(0, Math.min(3000, heaterW - phase * 3000)));
            put(`DP_DHW_HA_L${phase + 1}_CURRENT_A`, Math.max(0, gridW / (3 * 230)));
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
            vm.runInContext('updateVehicles();updateDhwSimulation();realtimeControl()', ctx);
            await output.tick();
        }
        if (now % 5000 === 0) vm.runInContext('updateDhwProductionOutput()', ctx);
        trace.push({at: now, wbW: physicalAllow ? physicalA * 230 : 0, heaterW, physicalAllow,
            targetW: value('Control.Targets.Wallbox2_W'), heaterTargetW: value('Control.Targets.MyPV_DHW_W'),
            status: value('Devices.Wallbox2.OutputStatus'), heaterStatus: value('Devices.MyPV_DHW.OutputStatus')});
    };
    return {states, writes, trace, put, value, output,
        now: () => now,
        run: code => vm.runInContext(code, ctx),
        setSurplus: watts => { surplusW = watts; },
        advance: async seconds => { for (let second = 0; second < seconds; second++) await tick(); },
        physical: () => ({allow: physicalAllow, amps: physicalA, heaterW}),
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
