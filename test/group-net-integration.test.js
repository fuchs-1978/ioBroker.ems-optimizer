'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {plant} = require('./control-plant');
const {reserveGroupCommands} = require('../lib/grid-operator-accounting');

const SOURCE_AGE_MS = 30000;
const WB2_METER = 'DP_WB2_POWER';
const STORAGE_AC = 'sunenergyxt500.0.heads.1.grid.GP';

function participant(wb) {
    return {name: `EV${wb}`, kind: 'wallbox', connectionPowerW: wb === 0 ? 7360 : 22080,
        deviceId: `Wallbox${wb}`, powerId: `DP_WB${wb}_POWER`, powerUnit: 'kW', powerScope: 'total-ac'};
}

function groupConfig({mode = 'groupNet', members = [2], participants = [], storage = []} = {}) {
    return {par14aAccountingMode: mode, par14aGroupId: 'controlled-loads', par14aBoundaryId: 'whole-site',
        par14aSiteScope: 'whole-site-ac', par14aAccountingMaxAgeS: 30,
        par14aAccountingMaxSkewMs: 0, par14aStorageCoverage: storage.length ? 'complete-ac' : 'none',
        par14aStorageMeters: storage, par14aParticipants: [...members.map(participant), ...participants],
        par14aBudgetMode: 'fixed', par14aLimitW: 4200, par14aActiveHigh: true,
        dhwControlEnabled: false, wallboxPVImportToleranceW: 0};
}

async function groupedPlant({mode = 'groupNet', members = [2], participants = [], storage = [],
    surplusW = 6000, config = {}, ...options} = {}) {
    const h = await plant({startDelayS: 0, minimumRuntimeS: 0, split: false,
        initialSurplusW: surplusW, mii: members.includes(0), sourceQuality: 0,
        nativeConfig: {...groupConfig({mode, members, participants, storage}), ...config}, ...options});
    // The shared plant normally removes all network-operator inputs. Bind the
    // same binary source in the real engine and independent output mapping.
    h.mapping.DP_PAR14A = 'network.contact';
    h.mapping.DP_LPC_STATE = ''; h.mapping.DP_LPC_LIMIT = '';
    h.mapping.DP_BATTERY_AC_POWER = h.config.batteryAcPowerId;
    for (const phase of [1, 2, 3]) h.mapping[`DP_HEAT_OUTPUT${phase}`] = h.config[`heatingOutput${phase}Id`];
    h.run("CFG.dp.par14a='network.contact';CFG.dp.lpcState='';CFG.dp.lpcLimit=''");
    h.put('network.contact', true);
    for (const member of members) h.put(`DP_WB${member}_SOC`, 10);
    h.own('Devices.MyPV_DHW.Present', false);
    h.own('Devices.MyPV_DHW.ControlEnabled', false);
    h.own('Devices.MyPV_DHW.Release', false);
    h.own('Config.WallboxPVImportTolerance_W', 0);
    h.own('Config.WallboxStartReserve_W', 0);
    if (members.length > 1) {
        h.config.wallboxParallelChargingEnabled = true;
        h.own('Config.WallboxParallelChargingEnabled', true);
    }
    return h;
}

const limit = h => h.run('currentConsumptionLimit()');
const snapshot = h => {
    const value = limit(h);
    assert.equal(value.groupNet, true, JSON.stringify(value));
    assert.ok(value.snapshot, JSON.stringify(value));
    return value.snapshot;
};
const grossPhysical = h => {
    const p = h.physical();
    return p.wbPowerW + p.miiPowerW;
};
const increases = (writes, previousA) => writes.filter(row =>
    row.id === 'goe.cmd' && row.val > previousA || row.id === 'goe.allow' && row.val === 1);

test('real allocator and output withdraw uplift on asynchronous 5-second wallbox readings', async () => {
    const h = await groupedPlant();
    await h.advance(100);
    const previousA = h.physical().amps;
    assert.ok(previousA * 230 > 4200, h.diagnostic());
    h.writes.length = 0;
    for (let tick = 0; tick < 12; tick++) {
        const at = h.now() + 1000;
        await h.replayAt(at, [[WB2_METER, h.physical().wbPowerW / 1000, {ts: at - 5000}]]);
        const s = snapshot(h);
        assert.equal(s.accountingBasis, 'gross-only-asynchronous');
        assert.equal(s.ownAvailableW, 0);
        assert.equal(s.actualGroupNetW, null);
        assert.ok(h.value('Control.Targets.Wallbox2_W') <= 4200, h.diagnostic());
    }
    assert.ok(h.writes.some(row => row.id === 'goe.cmd' && row.val < previousA
        || row.id === 'goe.allow' && row.val === 0), h.diagnostic());
    assert.equal(increases(h.writes, previousA).length, 0);
    const diag = JSON.parse(h.value('Control.GridOperatorCalculation_JSON'));
    assert.equal(diag.accountingBasis, 'gross-only-asynchronous');
    assert.equal(diag.observation.coherent, false);
    assert.equal(diag.observation.spanMs, 5000);
});

test('group-net opt-in changes actual allocator grants and commands; omitted legacy accounting stays gross-limited', async () => {
    const legacy = await groupedPlant({mode: 'legacyGross'});
    delete legacy.config.par14aAccountingMode;
    const group = await groupedPlant();
    await legacy.advance(100); await group.advance(100);
    assert.ok(legacy.physical().wbPowerW > 0, legacy.diagnostic());
    assert.ok(legacy.physical().wbPowerW <= 4200, legacy.diagnostic());
    assert.ok(group.physical().wbPowerW > 4200, group.diagnostic());
    assert.ok(group.value('Control.Targets.Wallbox2_W') > 4200, group.diagnostic());
    assert.ok(group.writes.some(row => row.id === 'goe.cmd' && row.val * 230 > 4200),
        'the new accounting must affect a real current command, not only a diagnostic');
    const s = snapshot(group);
    assert.equal(s.valid, true);
    assert.equal(s.netBudgetW, 4200);
    assert.equal(s.rawOwnAvailableW, 6000);
    assert.ok(s.actualGroupNetW <= 4200);
    assert.equal(s.grossBudgetW, 10200);
});

for (const [name, surplusW] of [['no local generation', 0], ['generation below household consumption', -1000]]) {
    test(`group-net ${name} does not invent extra gross budget`, async () => {
        const h = await groupedPlant({surplusW}); await h.advance(90);
        const s = snapshot(h);
        assert.equal(s.valid, true, JSON.stringify(s));
        assert.equal(s.rawOwnAvailableW, 0);
        assert.equal(s.grossBudgetW, 4200);
        assert.ok(grossPhysical(h) > 0, 'qualified mandatory charging remains available without an own-supply uplift');
        assert.ok(grossPhysical(h) <= 4200, h.diagnostic());
        assert.ok(!h.writes.some(row => row.id === 'goe.cmd' && row.val * 230 > 4200));
    });
}

test('a fast generation loss withdraws active uplift and orders reduction without waiting for the PV stop timer', async () => {
    const h = await groupedPlant(); await h.advance(100);
    const previousA = h.physical().amps;
    assert.ok(previousA * 230 > 4200, h.diagnostic());
    h.writes.length = 0; h.setSurplus(0);
    await h.advance(12);
    assert.equal(snapshot(h).rawOwnAvailableW, 0);
    assert.ok(h.writes.some(row => row.id === 'goe.cmd' && row.val < previousA
        || row.id === 'goe.allow' && row.val === 0), h.diagnostic());
    assert.equal(increases(h.writes, previousA).length, 0);
    assert.ok(h.physical().wbPowerW <= 4200, h.diagnostic());
});

test('parallel wallboxes spend a single allowance, including unobserved commands', async () => {
    const h = await groupedPlant({members: [0, 2], surplusW: 6000});
    await h.advance(130);
    assert.ok(h.physical().miiPowerW > 0 && h.physical().wbPowerW > 0, h.diagnostic());
    assert.ok(h.trace.every(row => row.wbW + row.miiW <= 10200), h.diagnostic());
    assert.ok(grossPhysical(h) > 4200, h.diagnostic());
    const s = snapshot(h);
    assert.equal(s.rawOwnAvailableW, 6000);
    assert.ok(s.committedGroupW <= s.grossBudgetW, JSON.stringify(s));
    // A command not yet reflected in its electrical meter is still charged to
    // the same pool when a different output attempts another increase.
    h.own('Devices.Wallbox0.OutputReservedPower_W', 3500);
    assert.equal(h.run('gridGroupCommandCheck("Wallbox2", 7360).allowed'), false,
        'independent output checks must not each spend the full 10200-W allowance');
    const publication = JSON.parse(h.value('Control.ParallelWallboxAllocation_JSON'));
    for (const entry of publication.allocations) {
        assert.equal(entry.targetA, h.value(`Control.Targets.Wallbox${entry.wb}_A`),
            'output authorization and final post-clipping target must be identical');
        assert.equal(entry.targetA * 230, h.value(`Control.Targets.Wallbox${entry.wb}_W`));
    }
});

test('one quantized whole-target fit prevents simultaneous member and nonparticipant proposals spending the same own supply', async () => {
    const h = await groupedPlant({surplusW: 1000});
    h.config.dhwPresent = true; h.config.dhwControlEnabled = true;
    h.own('Devices.MyPV_DHW.Present', true);
    h.own('Devices.MyPV_DHW.ControlEnabled', true);
    h.put('DP_WB2_SOC', 50); // This vector has no separate low-SoC current floor.
    h.run('updateVehicles();updateDhwSimulation()');
    const before = snapshot(h);
    assert.equal(before.grossBudgetW, 5200);
    assert.equal(h.run('gridGroupCommandCheck("Wallbox2", 4600).allowed'), true);
    assert.equal(h.run('gridGroupCommandCheck("MyPV_DHW", 1000).allowed'), true);
    assert.equal(reserveGroupCommands(before, {Wallbox2: 4600, MyPV_DHW: 1000}).allowed, false,
        'two independently plausible proposals are not a joint supply proof');
    const fit = h.run(`globalThis.proposedGroupTargets={dhwW:1000,heatingW:0,
        wallboxW:[0,0,4600],wallboxA:[0,0,20],wallboxExpectedW:[0,0,4600],wallboxPhases:[1,1,1]};
        gridGroupConstrainTargets(proposedGroupTargets,0,['Wallbox2','MyPV_DHW'])`);
    assert.equal(fit.valid, true, JSON.stringify(fit));
    assert.equal(fit.proposals.Wallbox2, 4600);
    assert.equal(fit.proposals.MyPV_DHW, 600);
    assert.equal(fit.withinBudget, true, JSON.stringify(fit));
    const joint = reserveGroupCommands(before, fit.proposals);
    assert.equal(joint.allowed, true, JSON.stringify(joint));
    assert.equal(joint.withinBudget, true);
    assert.equal(h.run('proposedGroupTargets.wallboxA[2]'), 20);
    assert.equal(h.run('proposedGroupTargets.dhwW'), 600);
});

test('mandatory floor reductions survive a second fitting pass while old overcommitted draw stays reserved', async () => {
    const h = await groupedPlant({members: [0, 2], surplusW: 0});
    for (const wb of [0, 2]) h.setWallboxPhysical(wb, {allow: 1, amps: 10});
    await h.replayAt(h.now() + 1, [], {allocate: false, output: false});
    for (const wb of [0, 2]) {
        h.own(`Devices.Wallbox${wb}.OutputOwned`, true);
        h.own(`Devices.Wallbox${wb}.OutputActive`, true);
        h.own(`Devices.Wallbox${wb}.OutputCommand_A`, 10);
        h.own(`Devices.Wallbox${wb}.OutputReservedPower_W`, 2300);
    }
    h.run('updateVehicles()');
    const before = snapshot(h);
    assert.equal(before.grossBudgetW, 4200);
    assert.equal(before.committedGroupW, 4600);
    for (const wb of [0, 2]) {
        assert.equal(h.run(`vehicleState(${wb}).mustCharge`), true);
        assert.equal(h.run(`vehicleState(${wb}).minCurrent1pA`), 6);
    }
    const fit = h.run(`globalThis.overcommittedGroupTargets={dhwW:0,heatingW:0,
        wallboxW:[1380,0,1380],wallboxA:[6,0,6],wallboxExpectedW:[2300,0,2300],wallboxPhases:[1,1,1]};
        gridGroupConstrainTargets(overcommittedGroupTargets,0,['Wallbox0','Wallbox2'])`);
    assert.equal(fit.valid, true, JSON.stringify(fit));
    assert.deepEqual(Array.from(h.run('overcommittedGroupTargets.wallboxA')), [6, 0, 6],
        'a second pass cannot erase an already accepted safe mandatory reduction');
    assert.deepEqual(Array.from(h.run('overcommittedGroupTargets.wallboxExpectedW')), [2300, 0, 2300]);
    assert.equal(fit.withinBudget, false, 'old electrical demand is still above the new ceiling');
    const joint = reserveGroupCommands(before, fit.proposals);
    assert.equal(joint.allowed, true);
    assert.equal(joint.safeReduction, true);
    assert.equal(joint.withinBudget, false);
    assert.equal(joint.next.committedGroupW, 4600);
    assert.equal(joint.next.devices.Wallbox0.reservedW, 2300);
    assert.equal(joint.next.devices.Wallbox2.reservedW, 2300);
});

test('EHZ stage relocation is checked before publishing its larger phase high-water reservation', async () => {
    const h = await groupedPlant({surplusW: 5300});
    h.config.dhwPresent = true; h.config.dhwControlEnabled = true;
    h.setWallboxPhysical(2, {allow: 1, amps: 20});
    await h.replayAt(h.now() + 1, [['DP_DHW_OUTPUT1', 2800], ['DP_DHW_OUTPUT2', 0], ['DP_DHW_OUTPUT3', 0],
        ['DP_GRID_IMPORT', 2100], ['DP_GRID_EXPORT', 0]], {allocate: false, output: false});
    h.own('Devices.Wallbox2.OutputOwned', true); h.own('Devices.Wallbox2.OutputActive', true);
    h.own('Devices.Wallbox2.OutputCommand_A', 20); h.own('Devices.Wallbox2.OutputReservedPower_W', 4600);
    h.own('Devices.MyPV_DHW.Present', true); h.own('Devices.MyPV_DHW.OutputOwned', true);
    h.own('Devices.MyPV_DHW.OutputCommand_W', 2800); h.own('Devices.MyPV_DHW.OutputReservedPower_W', 2800);
    h.own('Devices.MyPV_DHW.OutputReservedPhase1_W', 2800);
    h.own('Devices.MyPV_DHW.OutputReservedPhase2_W', 0);
    h.own('Devices.MyPV_DHW.OutputReservedPhase3_W', 0);
    const s = snapshot(h);
    assert.equal(s.rawOwnAvailableW, 2500);
    assert.equal(s.committedGroupW, 4600);
    // The plain watt command only adds600W. The physical stage transfer from
    // [2800,0,0] to [400,3000,0] must reserve [2800,3000,0] until response.
    assert.equal(reserveGroupCommands(s, {MyPV_DHW: 3400}).allowed, true);
    assert.equal(h.run('gridGroupCommandCheck("MyPV_DHW", 2800).allowed'), true);
    assert.equal(h.run('gridGroupCommandCheck("MyPV_DHW", 3400).allowed'), false,
        'the projected5800W phase envelope cannot be funded by2500W own supply beside4600W committed members');
    h.writes.length = 0;
    assert.equal(h.run('writeDhwSetpoint(3400)'), false);
    assert.equal(h.writes.length, 0, 'rejection must precede actual dispatch');
    assert.equal(h.value('Devices.MyPV_DHW.OutputReservedPower_W'), 2800,
        'the rejected candidate cannot first publish its own5800W authorization');
    assert.equal(h.value('Devices.MyPV_DHW.OutputReservedPhase2_W'), 0);
});

test('an external total group budget is reused without a second GZF uplift', async () => {
    const h = await groupedPlant({members: [0, 2], surplusW: 6000,
        config: {par14aBudgetMode: 'external', par14aLimitUnit: 'kW'}});
    h.mapping.DP_PAR14A_LIMIT = 'network.totalBudget';
    h.run("CFG.dp.par14aLimit='network.totalBudget'");
    h.put('network.totalBudget', 4.2);
    await h.advance(100);
    const s = snapshot(h);
    assert.equal(s.netBudgetW, 4200);
    assert.equal(s.grossBudgetW, 10200);
    assert.ok(h.trace.every(row => row.wbW + row.miiW <= 10200), h.diagnostic());
    assert.ok(grossPhysical(h) > 4200, 'declared export remains usable beside the unscaled external limit');
});

test('a larger group ceiling does not authorize discretionary grid uptake beyond mandatory low-PV floors', async () => {
    const h = await groupedPlant({members: [0, 2], surplusW: 1000});
    await h.advance(100);
    assert.equal(snapshot(h).grossBudgetW, 5200);
    assert.equal(h.physical().miiPowerW, 1380, h.diagnostic());
    assert.equal(h.physical().wbPowerW, 1380, h.diagnostic());
    assert.ok(h.writes.filter(row => row.id === 'goe.cmd' || row.id === 'goe0.cmd')
        .every(row => row.val <= 6), 'a network ceiling is not a new price/import permission');
});

const invalidSources = [
    ['missing NVP import', ['DP_GRID_IMPORT', null]],
    ['unacknowledged NVP export', ['DP_GRID_EXPORT', 6000, {ack: false}]],
    ['bad NVP quality', ['DP_GRID_EXPORT', 6000, {q: 64}]],
    ['missing explicit NVP quality', ['DP_GRID_EXPORT', 6000, {q: undefined}]],
    ['NULL participant power', [WB2_METER, null]],
    ['unacknowledged participant power', [WB2_METER, 6, {ack: false}]],
    ['bad participant quality', [WB2_METER, 6, {q: 64}]]
];
for (const [name, sample] of invalidSources) {
    test(`the physical output independently rejects a previously allocated uplift after ${name}`, async () => {
        const h = await groupedPlant(); await h.advance(100);
        const previousA = h.physical().amps;
        assert.ok(previousA * 230 > 4200, h.diagnostic());
        h.writes.length = 0;
        await h.replayAt(h.now() + 1, [sample], {allocate: false});
        assert.equal(limit(h).valid, false, name);
        assert.equal(increases(h.writes, previousA).length, 0, h.diagnostic());
        assert.ok(h.writes.some(row => row.id === 'goe.allow' && row.val === 0
            || row.id === 'goe.cmd' && row.val < previousA), h.diagnostic());
        assert.equal(h.run('gridGroupCommandCheck("Wallbox2", 0).allowed'), true);
    });
}

for (const [name, id, offsetMs] of [
    ['old NVP with new participant', 'DP_GRID_EXPORT', -1],
    ['old participant with new NVP', WB2_METER, -1],
    ['expired NVP', 'DP_GRID_IMPORT', -SOURCE_AGE_MS - 1],
    ['future NVP', 'DP_GRID_EXPORT', 1]
]) {
    test(`group-net source timing rejects ${name} before another physical increase`, async () => {
        const h = await groupedPlant(); await h.advance(90);
        const previousA = h.physical().amps, at = h.now() + 1;
        const oldValue = h.states.get(id).val;
        h.writes.length = 0;
        await h.replayAt(at, [[id, oldValue, {ts: at + offsetMs}]], {allocate: false});
        const result = limit(h);
        if (offsetMs === -1) {
            assert.equal(result.valid, true, JSON.stringify(result));
            assert.equal(result.snapshot.accountingBasis, 'gross-only-asynchronous');
            assert.equal(result.snapshot.ownAvailableW, 0);
            assert.equal(h.run('gridGroupCommandCheck("Wallbox2", 4201).allowed'), false);
        } else assert.equal(result.valid, false, JSON.stringify(result));
        assert.equal(increases(h.writes, previousA).length, 0);
    });
}

test('a passive complete WP meter contributes once; inverter-only declaration invalidates active accounting', async () => {
    const wp = {name: 'HeatPumpIncludingAux', kind: 'heatPump', connectionPowerW: 8000,
        deviceId: '', powerId: 'wp.totalAC', powerUnit: 'W', powerScope: 'total-ac'};
    const h = await groupedPlant({participants: [wp]});
    h.put('wp.totalAC', 500); await h.advance(90);
    const s = snapshot(h);
    assert.equal(s.valid, true, JSON.stringify(s));
    assert.equal(s.actualGroupGrossW, h.physical().wbPowerW + 500);
    assert.equal(s.rawOwnAvailableW, 6500);
    assert.equal(s.grossBudgetW, 10700);
    h.config.par14aParticipants[1].powerScope = 'inverter';
    h.writes.length = 0; await h.replayAt(h.now() + 1, [], {allocate: false});
    assert.equal(limit(h).valid, false);
    assert.ok(!h.writes.some(row => row.id === 'goe.allow' && row.val === 1));
});

for (const [name, actualW, field] of [['charge', 2000, 'storageChargeW'], ['discharge', -2000, 'storageDischargeW']]) {
    test(`complete AC storage ${name} is observed without discretionary discharge credit`, async () => {
        const storage = [{powerId: STORAGE_AC, powerUnit: 'W', powerScope: 'total-ac', direction: 'discharge-positive'}];
        const h = await groupedPlant({surplusW: 0, storage});
        h.setBatteryPower(actualW); await h.advance(80);
        const s = snapshot(h);
        assert.equal(s.valid, true, JSON.stringify(s));
        assert.equal(s[field], 2000);
        assert.equal(s.eligibleOwnAvailableW, 0);
        assert.equal(s.grossBudgetW, 4200);
        assert.ok(grossPhysical(h) <= 4200, h.diagnostic());
    });
}

test('a controlled AC storage participant shares the live allowance and loses charging authority with bad AC quality', async () => {
    const storage = [{powerId: STORAGE_AC, powerUnit: 'W', powerScope: 'total-ac', direction: 'discharge-positive'}];
    const member = {name: 'StorageCharging', kind: 'storage', connectionPowerW: 5000,
        deviceId: 'Battery', powerId: STORAGE_AC, powerUnit: 'W', powerScope: 'total-ac'};
    const h = await groupedPlant({participants: [member], storage, battery: true, batteryPlanW: 1000});
    await h.advance(100);
    assert.ok(h.physical().batteryW > 0, h.diagnostic());
    const s = snapshot(h);
    assert.equal(s.valid, true, JSON.stringify(s));
    assert.equal(s.devices.Battery.member, true);
    assert.ok(s.committedGroupW <= s.grossBudgetW, JSON.stringify(s));
    assert.ok(h.trace.every(row => Math.max(0, row.batteryW) + row.wbW <= 10200), h.diagnostic());
    h.writes.length = 0;
    await h.replayAt(h.now() + 1, [[STORAGE_AC, h.states.get(STORAGE_AC).val, {q: 64}]], {allocate: false});
    // replayAt's allocation branch normally dispatches the battery output.
    // Invoke just that independent output here without refreshing allocation.
    h.run('updateBatteryProductionOutput()');
    assert.equal(limit(h).valid, false);
    assert.ok(!h.writes.some(row => row.id === h.config.batterySetpointId && row.val < 0),
        'a previous charging allocation cannot outlive its AC quality proof');
    assert.ok(h.writes.some(row => row.id === h.config.batterySetpointId && row.val === 0),
        'real storage output must request a safe zero');
});

test('parallel cars, AC storage and both nonparticipant heaters keep one joint pool through natural SoC handoff', async () => {
    const storage = [{powerId: STORAGE_AC, powerUnit: 'W', powerScope: 'total-ac', direction: 'discharge-positive'}];
    const member = {name: 'StorageCharging', kind: 'storage', connectionPowerW: 5000,
        deviceId: 'Battery', powerId: STORAGE_AC, powerUnit: 'W', powerScope: 'total-ac'};
    const h = await groupedPlant({members: [0, 2], participants: [member], storage,
        battery: true, heating: true, batteryPlanW: 1000, surplusW: 10000, split: true});
    h.config.dhwPresent = true; h.config.dhwControlEnabled = true;
    h.own('Devices.MyPV_DHW.Present', true); h.own('Devices.MyPV_DHW.ControlEnabled', true);
    const inspect = () => {
        const s = snapshot(h);
        assert.equal(s.valid, true, JSON.stringify(s));
        assert.ok(s.actualGroupNetW <= s.netBudgetW, JSON.stringify(s));
        assert.ok(s.committedGroupW <= s.grossBudgetW, JSON.stringify(s));
        const proposals = Object.fromEntries(['MyPV_DHW', 'MyPV_Heating', 'Battery', 'Wallbox0', 'Wallbox1', 'Wallbox2']
            .map(device => [device, Math.max(0, h.value(`Control.Targets.${device}_W`))]));
        const joint = reserveGroupCommands(s, proposals);
        assert.equal(joint.allowed, true, JSON.stringify({joint, proposals}));
        assert.equal(joint.withinBudget, true, JSON.stringify({joint, proposals}));
        const publication = JSON.parse(h.value('Control.ParallelWallboxAllocation_JSON'));
        for (const entry of publication.allocations)
            assert.equal(entry.targetA, h.value(`Control.Targets.Wallbox${entry.wb}_A`));
        const p = h.physical();
        for (const [wb, actualW] of [[0, p.miiPowerW], [2, p.wbPowerW]])
            if (actualW > 0) assert.ok(h.value(`Devices.Wallbox${wb}.OutputReservedPower_W`) >= actualW,
                'a smaller target cannot release the previous car response before it physically falls');
    };
    for (let frame = 0; frame < 75; frame++) {await h.advance(2); inspect();}
    const active = h.physical();
    assert.ok(active.wbPowerW > 0 && active.miiPowerW > 0 && active.batteryW > 0,
        'both cars and the storage must actually take power');
    assert.ok(active.heaterW > 0 && active.heatingW > 0, 'both independent thermal outputs must actually take power');
    assert.ok(h.writes.some(row => row.id === h.config.batterySetpointId && row.val < 0));
    assert.ok(h.writes.some(row => row.id === 'DP_DHW_SETPOINT' && row.val > 0));
    assert.ok(h.writes.some(row => row.id === 'hk.setpoint' && row.val > 0));
    h.put('DP_WB0_SOC', 100); h.put('DP_WB2_SOC', 100);
    for (let frame = 0; frame < 40; frame++) {await h.advance(2); inspect();}
    const after = h.physical();
    assert.equal(after.miiPowerW + after.wbPowerW, 0);
    assert.ok(after.heaterW > 0 && after.heatingW > 0 && after.batteryW > 0);
    assert.equal(h.value('Devices.Wallbox0.OutputReservedPower_W'), 0);
    assert.equal(h.value('Devices.Wallbox2.OutputReservedPower_W'), 0);
});

test('unobserved nonparticipant heater demand reduces own allowance without rewriting observed group net', async () => {
    const h = await groupedPlant({surplusW: 1000}); await h.advance(70);
    const before = snapshot(h);
    h.own('Devices.MyPV_DHW.OutputOwned', true);
    h.own('Devices.MyPV_DHW.OutputCommand_W', 600);
    h.own('Devices.MyPV_DHW.OutputReservedPower_W', 600);
    const after = snapshot(h);
    assert.equal(after.valid, true, JSON.stringify(after));
    assert.equal(after.actualGroupNetW, before.actualGroupNetW);
    assert.equal(after.rawOwnAvailableW, before.rawOwnAvailableW);
    assert.equal(after.nonparticipantPendingW, before.nonparticipantPendingW + 600);
    assert.equal(after.ownAvailableW, Math.max(0, before.ownAvailableW - 600));
});

test('measured nonparticipant heat does not consume the participant net allowance twice', async () => {
    const h = await groupedPlant({surplusW: 0}); await h.advance(80);
    const actualW = h.physical().wbPowerW;
    assert.ok(actualW > 0 && actualW <= 4200, h.diagnostic());
    h.own('Devices.MyPV_DHW.Present', true);
    h.own('Devices.MyPV_DHW.OutputOwned', true);
    h.own('Devices.MyPV_DHW.OutputCommand_W', 600);
    h.own('Devices.MyPV_DHW.OutputReservedPower_W', 600);
    await h.replayAt(h.now() + 1, [['DP_DHW_OUTPUT1', 600], ['DP_DHW_OUTPUT2', 0], ['DP_DHW_OUTPUT3', 0],
        ['DP_GRID_IMPORT', actualW + 600], ['DP_GRID_EXPORT', 0]], {allocate: false, output: false});
    const s = snapshot(h);
    assert.equal(s.valid, true, JSON.stringify(s));
    assert.equal(s.actualGroupNetW, actualW);
    assert.equal(s.rawOwnAvailableW, 0);
    assert.equal(s.nonparticipantPendingW, 0);
    assert.equal(h.run('gridGroupCommandCheck("Wallbox2", 4200).allowed'), true,
        '600 W outside the group are already represented in NVP; they cannot shrink the group limit again');
});

test('queued electrical output rechecks group quality and still permits an unconditional safe zero', async () => {
    const h = await groupedPlant(); await h.advance(10);
    h.config.dhwPresent = true; h.config.dhwControlEnabled = true;
    h.own('Devices.MyPV_DHW.Present', true);
    h.own('Devices.MyPV_DHW.ControlEnabled', true);
    h.own('Devices.MyPV_DHW.DriverReady', true);
    h.run('updateDhwSimulation()');
    h.own('Control.Targets.MyPV_DHW_W', 500);
    assert.equal(h.run('checkQueuedElectricalOutput("MyPV_DHW", 500).allowed'), true,
        'a valid positive proposal must pass before source quality is withdrawn');
    h.put('DP_GRID_IMPORT', 0, {q: 64});
    assert.equal(h.run('checkQueuedElectricalOutput("MyPV_DHW", 500).allowed'), false);
    assert.equal(h.run('checkQueuedElectricalOutput("MyPV_DHW", 0).allowed'), true);
    assert.equal(h.run('checkQueuedElectricalOutput("Battery", 0).allowed'), true);
});

test('a restart cannot turn retained high-water demand into a new own-supply source', async () => {
    const h = await groupedPlant({surplusW: 1000}); await h.advance(90);
    const actual = h.physical().wbPowerW;
    h.own('Devices.Wallbox2.OutputReservedPower_W', actual + 1000);
    const before = snapshot(h);
    assert.ok(before.participantPendingW >= 1000);
    h.own('Control.RestartHandoffActive', true);
    h.own('Control.RestartHandoffSince', h.now());
    await h.restartOutput();
    const after = snapshot(h);
    assert.equal(after.rawOwnAvailableW, before.rawOwnAvailableW);
    assert.ok(after.participantPendingW >= before.participantPendingW,
        'initialization cannot release an unproved positive reservation');
});

test('unknown LPC scope blocks explicit group-net mode while the existing legacy LPC contract remains available', async () => {
    for (const mode of ['groupNet', 'legacyGross']) {
        const h = await groupedPlant({mode});
        h.mapping.DP_LPC_STATE = 'lpc.state'; h.mapping.DP_LPC_LIMIT = 'lpc.limit';
        h.run("CFG.dp.lpcState='lpc.state';CFG.dp.lpcLimit='lpc.limit'");
        h.put('lpc.state', 'limited'); h.put('lpc.limit', 3000);
        const value = limit(h);
        assert.equal(value.valid, mode === 'legacyGross', JSON.stringify(value));
        assert.equal(value.budgetW, mode === 'legacyGross' ? 3000 : 0);
    }
});

for (const [name, change] of [
    ['missing group identity', h => {h.config.par14aGroupId = '';}],
    ['partial site boundary', h => {h.config.par14aSiteScope = 'partial-ac';}],
    ['unbound controlled meter', h => {
        h.config.par14aParticipants[0].powerId = 'unrelated.power'; h.put('unrelated.power', 6);
    }],
    ['unknown storage coverage', h => {h.config.par14aStorageCoverage = 'unknown';}]
]) {
    test(`explicit group-net does not fall back to a positive legacy allowance for ${name}`, async () => {
        const h = await groupedPlant(); change(h);
        const result = limit(h);
        assert.equal(result.valid, false, JSON.stringify(result));
        assert.equal(result.budgetW, 0);
        await h.advance(5);
        assert.ok(!h.writes.some(row => row.id === 'goe.allow' && row.val === 1));
    });
}
