'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {plant} = require('./control-plant');
const sunEnergyHeads = require('../lib/sunenergy-heads');
const {BATTERY_SUM} = require('../lib/grid-operator-runtime');

// Use the production loader and real output/reservation state machines. Only
// the accounting boundary is controlled here; source/coherence accounting is
// exercised independently by the group-net end-to-end tests.
async function outputPlant({mode = 'groupNet', maximumW = 600, allowed = true} = {}) {
    const h = await plant({battery: true, heating: true, wallbox: false});
    h.config.par14aAccountingMode = mode;
    const calls = [], authority = {maximumW, allowed, valid: true};
    const globals = h.run('globalThis');
    globals.currentConsumptionLimit = () => ({valid: true, active: true,
        budgetW: null, groupNet: mode === 'groupNet'});
    globals.gridGroupDeviceLimit = device => {
        calls.push({stage: 'cap', device});
        return {valid: authority.valid, maximumW: authority.maximumW, reason: 'controlled group proof'};
    };
    globals.gridGroupCommandCheck = (device, watts) => {
        calls.push({stage: 'command', device, watts});
        return {allowed: authority.allowed, reason: 'controlled fresh group proof'};
    };
    h.own('Control.Valid', true);
    h.own('Control.LastUpdate', h.now());
    h.own('Control.Targets.MyPV_DHW_W', 6000);
    h.own('Control.Targets.MyPV_Heating_W', 6000);
    h.own('Control.Targets.Battery_W', 2400);
    h.run('updateDhwSimulation()');
    return {h, globals, authority, calls};
}

for (const output of [
    {device: 'MyPV_DHW', positive: 'writeDhwSetpoint(900)', zero: 'writeDhwSetpoint(0)',
        reserved: 'OutputReservedPower_W', sink: 'DP_DHW_SETPOINT'},
    {device: 'MyPV_Heating', positive: 'sendHeatingSetpoint(900)', zero: 'sendHeatingSetpoint(0)',
        reserved: 'OutputReservedPower_W', sink: 'hk.setpoint'},
    {device: 'Battery', positive: 'sendBatteryCommand(900, "test")', zero: 'sendBatteryCommand(0, "test")',
        reserved: 'OutputReservedCharge_W', sink: 'sunenergyxt500.0.heads.1.control.GS'}
]) {
    test(`group ${output.device} rejects a withdrawn positive grant before ownership/reservation and retains safe zero`, async () => {
        const {h, calls} = await outputPlant({allowed: false});
        const before = h.writes.length;
        const reserve = h.value(`Devices.${output.device}.${output.reserved}`);
        const owned = h.value(`Devices.${output.device}.OutputOwned`);
        assert.equal(h.run(output.positive), false);
        assert.equal(h.writes.length, before, 'no positive write after the shared proof was withdrawn');
        assert.equal(h.value(`Devices.${output.device}.${output.reserved}`), reserve,
            'rejected admission does not invent or release a reserve');
        assert.equal(h.value(`Devices.${output.device}.OutputOwned`), owned,
            'rejected admission cannot claim a new output');
        assert.deepEqual(calls, [{stage: 'command', device: output.device, watts: 900}]);
        assert.equal(h.run(output.zero), true);
        assert.deepEqual(h.writes.slice(before).map(write => ({id: write.id, val: write.val})),
            [{id: output.sink, val: 0}], 'a failed group proof never suppresses a safety zero');
        assert.equal(calls.length, 1, 'zero needs no positive group allowance');
    });
}

for (const output of [
    {device: 'MyPV_DHW', update: 'updateDhwProductionOutput()', sink: 'DP_DHW_SETPOINT', cap: 600, sign: 1},
    {device: 'MyPV_Heating', update: 'updateHeatingProductionOutput()', sink: 'hk.setpoint', cap: 600, sign: 1},
    {device: 'Battery', update: 'updateBatteryProductionOutput()',
        sink: 'sunenergyxt500.0.heads.1.control.GS', cap: 75, sign: -1}
]) {
    test(`group ${output.device} enforces its device ceiling when no scalar gross budget exists`, async () => {
        const {h, calls} = await outputPlant({maximumW: output.cap});
        const before = h.writes.length;
        h.run(output.update);
        const commands = h.writes.slice(before).filter(write => write.id === output.sink)
            .map(write => write.val * output.sign);
        assert.deepEqual(commands, [output.cap], h.value(`Devices.${output.device}.OutputStatus`));
        assert.ok(calls.some(call => call.stage === 'cap' && call.device === output.device));
        assert.ok(calls.some(call => call.stage === 'command'
            && call.device === output.device && call.watts === output.cap));
    });
}

test('group head admission checks all positive head commands against one battery allowance', async () => {
    const {h, calls} = await outputPlant({allowed: false});
    h.run(`batteryHeadOwners = [
        {index:1,setpointId:'sunenergyxt500.0.heads.1.control.GS',owned:true,commandW:400,
            commandAt:Date.now(),reservedChargeW:400,unobservedCommandW:0,unobservedSince:0,pending:null},
        {index:2,setpointId:'sunenergyxt500.0.heads.2.control.GS',owned:false,commandW:0,
            commandAt:0,reservedChargeW:0,unobservedCommandW:0,unobservedSince:0,pending:null}
    ]`);
    const before = h.writes.length;
    assert.equal(h.run('sendBatteryHeadCommand(batteryHeadOwners[1],200,"test")'), false);
    assert.deepEqual(calls, [{stage: 'command', device: 'Battery', watts: 600}],
        'a second head cannot receive a separate allowance');
    assert.equal(h.writes.length, before);
    assert.equal(h.run('batteryHeadOwners[1].owned'), false);
    assert.equal(h.run('batteryHeadOwners[0].reservedChargeW'), 400);
    assert.equal(h.run('sendBatteryHeadCommand(batteryHeadOwners[1],0,"test")'), true);
    assert.equal(h.writes.at(-1).val, 0);
});

test('a queued head command rechecks the whole battery after its ownership has been persisted', async () => {
    const {h, globals, calls, authority} = await outputPlant();
    h.config.batteryDispatchMode = 'sunenergy-heads';
    const ids = [1, 2].map(index => `sunenergyxt500.0.heads.${index}.control.GS`);
    globals.initializeBatteryHeadsOwnership = () => {};
    globals.batteryHeadsRegulationState = () => ({eligible: true, canCharge: true,
        canDischarge: false, heads: ids.map(setpointId => ({setpointId, acPowerW: 0}))});
    globals.batteryHeadsBudget = () => ({valid: true, groupNet: true, targetW: 1000});
    globals.batteryHeadsLimitedSnapshots = state => state.heads;
    globals.batteryHeadsAllocationOptions = () => ({});
    globals.sunEnergyHeads = {allocate: commandW => ({valid: true, acceptedW: commandW})};
    const owners = ids.map((setpointId, index) => ({index: index + 1, setpointId, owned: true,
        commandW: (index + 1) * 100, commandAt: h.now(), reservedChargeW: (index + 1) * 100,
        pending: {commandW: (index + 1) * 100, previousCommandW: 0}}));
    h.run(`batteryHeadOwners=${JSON.stringify(owners)}`);
    h.own('Devices.Battery.HeadOwnership_JSON', JSON.stringify({version: 1, heads: owners}));
    for (const owner of owners) {
        h.own(`Devices.Battery.Heads.${owner.index}.OutputOwned`, true);
        h.own(`Devices.Battery.Heads.${owner.index}.OutputSetpointId`, owner.setpointId);
        h.own(`Devices.Battery.Heads.${owner.index}.OutputCommandInternal_W`, owner.commandW);
    }
    assert.equal(h.run(`batteryHeadsQueuedCheck(${JSON.stringify(ids[0])},-100).allowed`), true);
    authority.allowed = false;
    const rejected = h.run(`batteryHeadsQueuedCheck(${JSON.stringify(ids[0])},-100)`);
    assert.equal(rejected.allowed, false, 'persisted ownership is not a permanent group grant');
    assert.equal(rejected.reason, 'controlled fresh group proof');
    assert.deepEqual(calls, [
        {stage: 'command', device: 'Battery', watts: 300},
        {stage: 'command', device: 'Battery', watts: 300}
    ]);
});

test('an explicitly selected group mode cannot send positive auxiliary commands without its guard', async () => {
    const {h, globals} = await outputPlant();
    globals.gridGroupCommandCheck = undefined;
    const before = h.writes.length;
    for (const code of ['writeDhwSetpoint(500)', 'sendHeatingSetpoint(500)', 'sendBatteryCommand(100,"test")'])
        assert.equal(h.run(code), false);
    assert.equal(h.writes.length, before);
});

test('legacy auxiliary send paths do not acquire the new group dependency', async () => {
    for (const mode of [undefined, 'legacyGross']) {
        const {h, globals, calls} = await outputPlant({mode: 'legacyGross', allowed: false});
        if (mode === undefined) delete h.config.par14aAccountingMode;
        globals.gridGroupCommandCheck = () => assert.fail('legacy output must preserve its original admission path');
        assert.equal(h.run('writeDhwSetpoint(500)'), true);
        assert.equal(h.run('sendHeatingSetpoint(500)'), true);
        assert.equal(h.run('sendBatteryCommand(100,"test")'), true);
        assert.deepEqual(calls, []);
    }
});

async function accountingHeadsPlant() {
    const source = index => `sunenergyxt500.0.heads.${index}`;
    const config = {
        par14aAccountingMode: 'groupNet', par14aGroupId: 'battery-group', par14aBoundaryId: 'site',
        par14aSiteScope: 'whole-site-ac', par14aAccountingMaxAgeS: 30, par14aAccountingMaxSkewMs: 0,
        par14aBudgetMode: 'fixed', par14aLimitW: 500, par14aActiveHigh: true,
        par14aParticipants: [{name: 'battery', kind: 'storage', connectionPowerW: 4800,
            deviceId: 'Battery', powerId: BATTERY_SUM, powerUnit: 'W', powerScope: 'total-ac'}],
        par14aStorageCoverage: 'complete-ac', par14aStorageMeters: [1, 2].map(index => ({
            powerId: `${source(index)}.grid.GP`, powerUnit: 'W', powerScope: 'total-ac', direction: 'discharge-positive'})),
        batteryDispatchMode: 'sunenergy-heads', batterySunEnergyInstance: 'sunenergyxt500.0', batteryHeadCount: 2,
        dhwControlEnabled: false
    };
    const h = await plant({battery: true, wallbox: false, initialSurplusW: 0,
        sourceQuality: 0, nativeConfig: config});
    // The production loader supplies controller functions; use the actual
    // head parser/allocator rather than a substitute device model.
    h.run('globalThis').sunEnergyHeads = sunEnergyHeads;
    h.mapping.DP_PAR14A = 'network.contact';
    h.mapping.DP_LPC_STATE = ''; h.mapping.DP_LPC_LIMIT = '';
    h.run("CFG.dp.par14a='network.contact';CFG.dp.lpcState='';CFG.dp.lpcLimit=''");
    h.put('network.contact', true);
    h.own('Devices.MyPV_DHW.Present', false);
    h.own('Devices.MyPV_DHW.ControlEnabled', false);
    h.own('Devices.Battery.HeadsVerified', true);
    h.own('Config.BatteryFineStep_W', 400);
    h.own('Control.Valid', true);
    h.own('Control.LastUpdate', h.now());
    h.own('Control.Targets.Battery_W', 1000);
    const snapshots = new Map();
    const head = (index, delta = {}, sourceExtra = {}) => {
        const body = {...(snapshots.get(index) || {SC: 50, ON: 1, GS: 0, GP: 0, MM: 0, LM: 1,
            SI: 10, SA: 100, MG: 800, IS: 800, LP: 0, PK: 1}), ...delta};
        snapshots.set(index, body);
        h.put(`${source(index)}.info.rawResponse`, JSON.stringify(body), sourceExtra);
        h.put(`${source(index)}.info.online`, true);
        h.put(`${source(index)}.grid.GP`, body.GP, sourceExtra);
    };
    for (const index of [1, 2]) head(index);
    return {h, head};
}

test('real group accounting admits head GS commands once and rejects them after a source failure behind the queue', async () => {
    const {h} = await accountingHeadsPlant();
    const limit = h.run('currentConsumptionLimit()');
    assert.equal(limit.valid, true, limit.reason);
    assert.equal(limit.snapshot.grossBudgetW, 500);
    const before = h.writes.length;
    h.run('updateBatteryProductionOutput()');
    const commands = h.writes.slice(before).filter(write => /\.control\.GS$/.test(write.id));
    assert.deepEqual(commands.map(write => write.val), [-200, -200], h.value('Devices.Battery.OutputStatus'));
    assert.equal(h.value('Devices.Battery.OutputReservedCharge_W'), 400);
    for (const command of commands)
        assert.equal(h.run(`batteryHeadsQueuedCheck(${JSON.stringify(command.id)},${command.val}).allowed`), true);
    h.put('sunenergyxt500.0.heads.2.grid.GP', null);
    for (const command of commands)
        assert.equal(h.run(`batteryHeadsQueuedCheck(${JSON.stringify(command.id)},${command.val}).allowed`), false,
            'a persisted head command cannot reuse accounting from before a source failure');
    assert.equal(h.value('Devices.Battery.OutputReservedCharge_W'), 400,
        'rejected dispatch cannot prove the old positive head effects were cancelled');
    assert.equal(h.run('sendBatteryHeadCommand(batteryHeadOwners[0],0,"source failed")'), true);
    assert.equal(h.writes.at(-1).val, 0);
    assert.equal(h.value('Devices.Battery.OutputReservedCharge_W'), 400,
        'a zero transport is not electrical proof of released head reservations');
});

test('real multihead accounting retains separate charging and discharging AC contributions', async () => {
    const {h, head} = await accountingHeadsPlant();
    head(1, {GP: -200}); head(2, {GP: 200});
    const limit = h.run('currentConsumptionLimit()');
    assert.equal(limit.valid, true, limit.reason);
    assert.equal(limit.snapshot.actualGroupGrossW, 200);
    assert.equal(limit.snapshot.storageChargeW, 200);
    assert.equal(limit.snapshot.storageDischargeW, 200);
    assert.equal(limit.snapshot.ownAvailableW, 0, 'opposing head powers create no discretionary supply');
    assert.equal(limit.snapshot.grossBudgetW, 500);
    assert.equal(limit.snapshot.devices.Battery.actualW, 200, 'charging must not disappear in an algebraic zero');
});
