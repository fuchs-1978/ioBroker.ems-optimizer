'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const context = vm.createContext({Math, gridConstraints: require('../lib/grid-constraints')});
vm.runInContext(fs.readFileSync(
    path.join(__dirname, '../lib/engine/dhw-output.js'), 'utf8'), context);
const command = expression => vm.runInContext(expression, context);

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
    const ctx = vm.createContext({Math, Date, gridConstraints: require('../lib/grid-constraints'),
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

function outputHarness({combined = false, simulate = false} = {}) {
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
    ['t1', 't2', 't3', 't4', 'outlet'].forEach(id => put(id, 50));
    put('connection', true);
    put('gridOut', 6100);
    put('split', true);
    const nativeConfig = {combinedProductionArmed: true, wb0ProductionArmed: true};
    const consumptionLimit = {valid: true, active: false, budgetW: null};
    const ctx = vm.createContext({Math, Date: {now: () => now},
        gridConstraints: require('../lib/grid-constraints'), nativeConfig,
        CFG: {root: 'ems.0', dataMaxAgeMs: 120000, limits: {myPvDhwMaxW: 9000}, dp: {
            myPvDhwHaCurrentA: ['h1', 'h2', 'h3'], myPvDhwOutputW: ['o1', 'o2', 'o3'],
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
