'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
    groupAccountingEnabled, accountingSources, evaluateRuntimeGroup,
    deviceGroupLimit, checkGroupCommand, BATTERY_SUM
} = require('../lib/grid-operator-runtime');

const NOW = 2000000;
const NS = 'ems.0';

function fixture({importW = 1000, exportW = 0, actualW = 3000} = {}) {
    const mapping = {
        DP_GRID_IMPORT: 'meter.import', DP_GRID_EXPORT: 'meter.export',
        DP_PAR14A: 'dso.contact', DP_WB0_POWER: 'wb0.power'
    };
    const config = {
        par14aAccountingMode: 'groupNet', par14aGroupId: 'agreed-group',
        par14aBoundaryId: 'whole-site', par14aSiteScope: 'whole-site-ac',
        par14aAccountingMaxAgeS: 30, par14aAccountingMaxSkewMs: 0,
        par14aStorageCoverage: 'none', par14aStorageMeters: [],
        par14aId: mapping.DP_PAR14A, par14aActiveHigh: true,
        par14aLimitW: 4200, par14aBudgetMode: 'fixed',
        gridImportId: mapping.DP_GRID_IMPORT, gridExportId: mapping.DP_GRID_EXPORT,
        wb0Present: true, wb0ControlEnabled: true, wb0PowerId: mapping.DP_WB0_POWER,
        wallboxNominalVoltageV: 230,
        par14aParticipants: [{name: 'EV0', kind: 'wallbox', connectionPowerW: 7360,
            deviceId: 'Wallbox0', powerId: mapping.DP_WB0_POWER,
            powerUnit: 'kW', powerScope: 'total-ac'}]
    };
    const states = new Map();
    const put = (id, val, extra = {}) => states.set(id, {val, ack: true, q: 0, ts: NOW, ...extra});
    const own = (id, val, extra) => put(`${NS}.${id}`, val, extra);
    put(mapping.DP_GRID_IMPORT, importW); put(mapping.DP_GRID_EXPORT, exportW);
    put(mapping.DP_PAR14A, true); put(mapping.DP_WB0_POWER, actualW / 1000);
    own('Devices.Wallbox0.Present', true);
    own('Devices.Wallbox0.ControlEnabled', true);
    own('Devices.Wallbox0.OutputOwned', true);
    own('Devices.Wallbox0.OutputActive', true);
    own('Devices.Wallbox0.OutputCommand_A', Math.floor(actualW / 230));
    own('Devices.Wallbox0.OutputPhases', 1);
    own('Devices.Wallbox0.OutputReservedPower_W', actualW);
    own('Config.WallboxNominalVoltage_V', 230);
    const evaluate = () => evaluateRuntimeGroup({config, mapping, namespace: NS,
        getState: id => states.get(id), now: NOW});
    return {config, mapping, states, put, own, evaluate};
}

function denied(f) {
    const result = f.evaluate();
    assert.equal(result.groupNet, true);
    assert.equal(result.valid, false, result.reason);
    assert.equal(checkGroupCommand(result, 'Wallbox0', 1).allowed, false);
    assert.equal(checkGroupCommand(result, 'Wallbox0', 0).allowed, true,
        'an unavailable accounting proof must not prevent a safe OFF command');
    return result;
}

test('runtime accounting mode is opt-in and unknown modes cannot silently select legacy protection', () => {
    assert.equal(groupAccountingEnabled({}), false);
    assert.equal(groupAccountingEnabled({par14aAccountingMode: 'legacyGross'}), false);
    assert.equal(groupAccountingEnabled({par14aAccountingMode: 'groupNet'}), true);
    assert.equal(groupAccountingEnabled({par14aAccountingMode: 'groupNte'}), true);
    const f = fixture();
    f.config.par14aAccountingMode = 'groupNte';
    denied(f);
});

test('runtime connects original AC observations to the shared group budget', () => {
    const f = fixture();
    const result = f.evaluate();
    assert.equal(result.groupNet, true);
    assert.equal(result.valid, true, JSON.stringify(result));
    assert.equal(result.active, true);
    assert.equal(result.budgetW, null, 'a member-only budget must not replace the all-consumer legacy scalar');
    assert.equal(result.snapshot.netBudgetW, 4200);
    assert.equal(result.snapshot.actualGroupGrossW, 3000);
    assert.equal(result.snapshot.actualGroupNetW, 1000);
    assert.equal(result.snapshot.ownAvailableW, 2000);
    assert.equal(result.snapshot.grossBudgetW, 6200);
    assert.equal(deviceGroupLimit(result, 'Wallbox0').maximumW, 6200);
    assert.equal(checkGroupCommand(result, 'Wallbox0', 6200).allowed, true);
    assert.equal(checkGroupCommand(result, 'Wallbox0', 6201).allowed, false);
});

for (const [name, imported, exported, gross, own] of [
    ['no generation', 5000, 0, 4200, 0],
    ['PV remains below the ordinary household demand', 3500, 0, 4200, 0],
    ['measured export after household consumption', 0, 1000, 8200, 4000]
]) {
    test(`runtime measured balance: ${name}`, () => {
        const f = fixture({importW: imported, exportW: exported});
        const result = f.evaluate();
        assert.equal(result.valid, true, JSON.stringify(result));
        assert.equal(result.snapshot.grossBudgetW, gross);
        assert.equal(result.snapshot.ownAvailableW, own);
    });
}

test('runtime rereads a generation loss instead of retaining a preceding positive credit', () => {
    const f = fixture({importW: 0, exportW: 1000});
    const before = f.evaluate();
    assert.equal(before.snapshot.grossBudgetW, 8200);
    f.put('meter.export', 0); f.put('meter.import', 5000);
    const after = f.evaluate();
    assert.equal(after.valid, true);
    assert.equal(after.snapshot.grossBudgetW, 4200);
    assert.equal(checkGroupCommand(after, 'Wallbox0', 6000).allowed, false);
    assert.equal(before.snapshot.grossBudgetW, 8200, 'a fresh evaluation must not rewrite the previous evidence');
});

test('commands and retained high-water reserves never become observed own generation', () => {
    const f = fixture();
    f.own('Devices.Wallbox0.OutputCommand_A', 30);
    f.own('Devices.Wallbox0.OutputReservedPower_W', 7000);
    const result = f.evaluate();
    assert.equal(result.valid, true, JSON.stringify(result));
    assert.equal(result.snapshot.actualGroupGrossW, 3000);
    assert.equal(result.snapshot.ownAvailableW, 2000);
    assert.equal(result.snapshot.grossBudgetW, 6200);
    assert.equal(result.snapshot.committedGroupW, 7000);
    assert.equal(checkGroupCommand(result, 'Wallbox0', 6201).allowed, false);
    assert.equal(checkGroupCommand(result, 'Wallbox0', 4000).allowed, true,
        'a reduction below the independent device ceiling remains deliverable while old power is reserved');
});

for (const sourceId of ['meter.import', 'meter.export', 'wb0.power']) {
    for (const [name, modify] of [
        ['NULL', state => {state.val = null;}],
        ['numeric string', state => {state.val = '1';}],
        ['bad quality', state => {state.q = 64;}],
        ['missing quality', state => {delete state.q;}],
        ['string quality', state => {state.q = '0';}],
        ['unacknowledged', state => {state.ack = false;}],
        ['missing ACK', state => {delete state.ack;}],
        ['future', state => {state.ts = NOW + 1;}],
        ['stale', state => {state.ts = NOW - 30001;}],
        ['missing original time', state => {delete state.ts;}]
    ]) {
        test(`runtime ${sourceId} ${name} cannot create a positive allowance`, () => {
            const f = fixture();
            modify(f.states.get(sourceId));
            denied(f);
        });
    }
}

test('runtime original measurement times withdraw solar credit in both skew directions', () => {
    for (const sourceId of ['meter.import', 'wb0.power']) {
        const f = fixture();
        f.states.get(sourceId).ts--;
        const result = f.evaluate();
        assert.equal(result.valid, true, result.reason);
        assert.equal(result.snapshot.accountingBasis, 'gross-only-asynchronous');
        assert.equal(result.snapshot.ownAvailableW, 0);
        assert.equal(checkGroupCommand(result, 'Wallbox0', 4200).allowed, true);
        assert.equal(checkGroupCommand(result, 'Wallbox0', 4201).allowed, false);
    }
});

test('runtime 5-second polling mismatch keeps valid mandatory-sized charging possible without solar credit', () => {
    const f = fixture({actualW: 1380, importW: 0, exportW: 9000});
    f.states.get('wb0.power').ts -= 5000;
    const result = f.evaluate();
    assert.equal(result.valid, true, result.reason);
    assert.equal(result.snapshot.accountingBasis, 'gross-only-asynchronous');
    assert.equal(result.snapshot.rawSources.find(s => s.id === 'wb0.power').ts, NOW - 5000);
    assert.equal(result.snapshot.observation.spanMs, 5000);
    assert.match(result.reason, /ohne Eigenstromzuschlag/);
    assert.equal(checkGroupCommand(result, 'Wallbox0', 4140).allowed, true);
    assert.equal(checkGroupCommand(result, 'Wallbox0', 5000).allowed, false);
    f.states.get('wb0.power').ts = NOW - 30001;
    denied(f);
});

test('runtime only accepts a bounded explicitly declared source-time span', () => {
    const f = fixture();
    f.config.par14aAccountingMaxSkewMs = 500;
    f.states.get('wb0.power').ts -= 500;
    assert.equal(f.evaluate().valid, true);
    f.states.get('meter.import').ts -= 1001;
    assert.equal(f.evaluate().snapshot.accountingBasis, 'gross-only-asynchronous');
    f.config.par14aAccountingMaxSkewMs = 1001;
    denied(f);
});

for (const [name, change] of [
    ['undeclared whole-site AC boundary', f => {f.config.par14aSiteScope = 'unconfigured';}],
    ['missing group identity', f => {f.config.par14aGroupId = '';}],
    ['missing measurement-boundary identity', f => {f.config.par14aBoundaryId = '';}],
    ['unconfigured storage coverage', f => {f.config.par14aStorageCoverage = 'unconfigured';}],
    ['storage-none declaration with an unexplained meter', f => {
        f.config.par14aStorageMeters = [{powerId: 'storage.ac', powerUnit: 'W',
            powerScope: 'total-ac', direction: 'discharge-positive'}];
        f.put('storage.ac', 0);
    }],
    ['participant without a complete AC scope', f => {f.config.par14aParticipants[0].powerScope = 'inverter';}],
    ['controlled participant with another measurement source', f => {
        f.config.par14aParticipants[0].powerId = 'unrelated.power'; f.put('unrelated.power', 3);
    }],
    ['duplicated controlled binding', f => {
        f.config.par14aParticipants.push({...f.config.par14aParticipants[0], name: 'duplicate'});
    }],
    ['controlled and passive coverage sharing one source', f => {
        f.config.par14aParticipants.push({...f.config.par14aParticipants[0], name: 'WP',
            kind: 'heatPump', connectionPowerW: 6000, deviceId: ''});
    }]
]) {
    test(`runtime requires a complete explicit contract: ${name}`, () => {
        const f = fixture(); change(f); denied(f);
    });
}

test('a static confirmed binary contact need not invent a new timestamp to remain active', () => {
    const f = fixture();
    f.states.get('dso.contact').ts = 1000;
    assert.equal(f.evaluate().valid, true);
    assert.equal(f.evaluate().active, true);
    f.states.get('dso.contact').ack = false;
    denied(f);
});

test('binary inactivity withdraws only the network constraint rather than manufacturing own supply', () => {
    const f = fixture();
    f.put('dso.contact', false);
    const result = f.evaluate();
    assert.equal(result.valid, true, JSON.stringify(result));
    assert.equal(result.active, false);
    assert.equal(deviceGroupLimit(result, 'Wallbox0').maximumW, null);
});

test('external binary total budget is fresh, unit-checked and not multiplied by GZF', () => {
    const f = fixture();
    Object.assign(f.config, {par14aBudgetMode: 'external', par14aLimitId: 'dso.limit',
        par14aLimitUnit: 'kW'});
    f.mapping.DP_PAR14A_LIMIT = 'dso.limit';
    f.put('dso.limit', 4.2);
    const result = f.evaluate();
    assert.equal(result.valid, true, JSON.stringify(result));
    assert.equal(result.snapshot.netBudgetW, 4200);
    assert.equal(result.snapshot.grossBudgetW, 6200);
    f.states.get('dso.limit').ts = NOW - 15001;
    denied(f);
});

for (const lpcState of ['limited', 'unlimitedControlled', 'unlimitedAutonomous']) {
    test(`unverified configured LPC ${lpcState} cannot authorize new group accounting`, () => {
        const f = fixture();
        Object.assign(f.config, {lpcStateId: 'lpc.state', lpcLimitId: 'lpc.limit'});
        Object.assign(f.mapping, {DP_LPC_STATE: 'lpc.state', DP_LPC_LIMIT: 'lpc.limit'});
        f.put('lpc.state', lpcState); f.put('lpc.limit', 4200);
        denied(f);
    });
}

test('a passive complete WP meter includes its load once without a second legacy WP subtraction', () => {
    const f = fixture();
    f.config.par14aParticipants.push({name: 'WP including auxiliary heater', kind: 'heatPump',
        connectionPowerW: 9000, deviceId: '', powerId: 'wp.total', powerUnit: 'W', powerScope: 'total-ac'});
    f.own('Devices.HeatPump.Present', true);
    f.put('wp.total', 1000);
    const result = f.evaluate();
    assert.equal(result.valid, true, JSON.stringify(result));
    assert.equal(result.snapshot.actualGroupGrossW, 4000);
    assert.equal(result.snapshot.actualGroupNetW, 1000);
    assert.equal(result.snapshot.grossBudgetW, 7200);
    assert.equal(deviceGroupLimit(result, 'Wallbox0').maximumW, 6200);
});

test('a shared complete passive WP aggregate is measured once for its declared auxiliary coverage', () => {
    const f = fixture();
    for (const [name, connectionPowerW] of [['WP compressor', 6000], ['WP auxiliary', 3000]])
        f.config.par14aParticipants.push({name, kind: 'heatPump', connectionPowerW,
            deviceId: '', powerId: 'wp.total', powerUnit: 'W', powerScope: 'total-ac'});
    f.put('wp.total', 1000);
    const result = f.evaluate();
    assert.equal(result.valid, true, JSON.stringify(result));
    assert.equal(result.snapshot.actualGroupGrossW, 4000);
    assert.equal(deviceGroupLimit(result, 'Wallbox0').maximumW, 6200);
});

test('a retained peer reservation is reread before a second wallbox can spend the same own-supply pool', () => {
    const f = fixture();
    Object.assign(f.config, {wb1Present: true, wb1ControlEnabled: true, wb1PowerId: 'wb1.power'});
    f.mapping.DP_WB1_POWER = 'wb1.power';
    f.config.par14aParticipants.push({name: 'EV1', kind: 'wallbox', connectionPowerW: 7360,
        deviceId: 'Wallbox1', powerId: 'wb1.power', powerUnit: 'kW', powerScope: 'total-ac'});
    f.put('wb1.power', 3);
    f.own('Devices.Wallbox1.Present', true); f.own('Devices.Wallbox1.OutputOwned', true);
    f.own('Devices.Wallbox1.OutputActive', true); f.own('Devices.Wallbox1.OutputCommand_A', 13);
    f.own('Devices.Wallbox1.OutputPhases', 1); f.own('Devices.Wallbox1.OutputReservedPower_W', 3000);
    const initial = f.evaluate();
    assert.equal(initial.valid, true, JSON.stringify(initial));
    assert.equal(initial.snapshot.grossBudgetW, 9200);
    assert.equal(checkGroupCommand(initial, 'Wallbox0', 6200).allowed, true);
    f.own('Devices.Wallbox0.OutputReservedPower_W', 6200);
    const reserved = f.evaluate();
    assert.equal(deviceGroupLimit(reserved, 'Wallbox1').maximumW, 3000);
    assert.equal(checkGroupCommand(reserved, 'Wallbox1', 3200).allowed, false);
    f.own('Devices.Wallbox0.OutputCommand_A', 6);
    assert.equal(deviceGroupLimit(f.evaluate(), 'Wallbox1').maximumW, 3000,
        'a reduction command is not proof that the old electrical reservation has disappeared');
});

function addNonmemberHeater(f) {
    f.own('Devices.MyPV_DHW.Present', true);
    f.own('Devices.MyPV_DHW.OutputOwned', true);
    f.own('Devices.MyPV_DHW.OutputCommand_W', 1000);
    f.own('Devices.MyPV_DHW.OutputReservedPower_W', 1000);
    for (const [phase, watts] of [[1, 300], [2, 300], [3, 400]]) {
        const id = `heater.ac${phase}`;
        f.mapping[`DP_DHW_OUTPUT${phase}`] = id;
        f.config[`dhwOutput${phase}Id`] = id;
        f.put(id, watts);
    }
}

test('nonmember actual heater load is already in the NVP; only its pending increase consumes credit again', () => {
    const f = fixture(); addNonmemberHeater(f);
    const actual = f.evaluate();
    assert.equal(actual.valid, true, JSON.stringify(actual));
    assert.equal(actual.snapshot.nonparticipantPendingW, 0);
    assert.equal(actual.snapshot.ownAvailableW, 2000);
    assert.equal(deviceGroupLimit(actual, 'Wallbox0').maximumW, 6200);
    f.own('Devices.MyPV_DHW.OutputCommand_W', 2000);
    f.own('Devices.MyPV_DHW.OutputReservedPower_W', 2000);
    const pending = f.evaluate();
    assert.equal(pending.valid, true, JSON.stringify(pending));
    assert.equal(pending.snapshot.nonparticipantPendingW, 1000);
    assert.equal(pending.snapshot.ownAvailableW, 1000);
    assert.equal(deviceGroupLimit(pending, 'Wallbox0').maximumW, 5200);
});

test('summing heater phases cannot conceal a mismatched original source timestamp', () => {
    const f = fixture(); addNonmemberHeater(f);
    f.states.get('heater.ac3').ts--;
    const result = f.evaluate();
    assert.equal(result.valid, true, result.reason);
    assert.equal(result.snapshot.accountingBasis, 'gross-only-asynchronous');
    assert.equal(result.snapshot.observation.spanMs, 1);
    assert.equal(result.snapshot.ownAvailableW, 0);
});

test('newer heater component cannot hide behind the oldest timestamp of its sum', () => {
    const f = fixture(); addNonmemberHeater(f);
    for (const [id, state] of f.states)
        if (!id.startsWith(`${NS}.`)) state.ts = NOW - 5000;
    f.states.get('heater.ac3').ts = NOW;
    const result = f.evaluate();
    assert.equal(result.valid, true, result.reason);
    assert.equal(result.snapshot.accountingBasis, 'gross-only-asynchronous');
    assert.equal(result.snapshot.observation.spanMs, 5000);
    assert.equal(result.snapshot.ownAvailableW, 0);
});

test('a synthesized heater total cannot conceal reuse of a site-meter source', () => {
    const f = fixture(); addNonmemberHeater(f);
    f.mapping.DP_DHW_OUTPUT1 = 'meter.import';
    f.config.dhwOutput1Id = 'meter.import';
    denied(f);
});

test('a synthesized heater total cannot count the same raw phase source twice', () => {
    const f = fixture(); addNonmemberHeater(f);
    f.mapping.DP_DHW_OUTPUT2 = 'heater.ac1';
    f.config.dhwOutput2Id = 'heater.ac1';
    denied(f);
});

test('a positive heater sum cannot hide an invalid negative consumption-only phase', () => {
    const f = fixture(); addNonmemberHeater(f);
    f.put('heater.ac1', -10);
    denied(f);
});

test('existing qualified wallbox signed-zero noise is normalized after original source validation', () => {
    const f = fixture();
    f.put('wb0.power', -0.01);
    const result = f.evaluate();
    assert.equal(result.valid, true, JSON.stringify(result));
    assert.equal(result.snapshot.actualGroupGrossW, 0);
    assert.equal(result.snapshot.rawOwnAvailableW, 0);
    f.put('wb0.power', -0.031);
    denied(f);
});

for (const [signedW, chargeW, dischargeW, eligibleW] of [
    [500, 0, 500, 1500], [-500, 500, 0, 2000]
]) {
    test(`complete AC storage ${signedW} W remains signed and cannot be credited twice`, () => {
        const f = fixture();
        f.config.par14aStorageCoverage = 'complete-ac';
        f.config.par14aStorageMeters = [{powerId: 'storage.ac', powerUnit: 'W',
            powerScope: 'total-ac', direction: 'discharge-positive'}];
        f.put('storage.ac', signedW);
        const result = f.evaluate();
        assert.equal(result.valid, true, JSON.stringify(result));
        assert.equal(result.snapshot.storageChargeW, chargeW);
        assert.equal(result.snapshot.storageDischargeW, dischargeW);
        assert.equal(result.snapshot.rawOwnAvailableW, 2000);
        assert.equal(result.snapshot.eligibleOwnAvailableW, eligibleW);
    });
}

for (const [signedW, chargeW, dischargeW, grossW] of [[-500, 500, 0, 6700], [500, 0, 500, 5700]]) {
    test(`a controlled storage participant is bound to its actual signed AC source (${signedW} W)`, () => {
        const f = fixture();
        f.config.par14aStorageCoverage = 'complete-ac';
        f.config.par14aStorageMeters = [{powerId: 'storage.ac', powerUnit: 'W',
            powerScope: 'total-ac', direction: 'discharge-positive'}];
        f.config.par14aParticipants.push({name: 'storage charging', kind: 'storage', connectionPowerW: 5000,
            deviceId: 'Battery', powerId: 'storage.ac', powerUnit: 'W', powerScope: 'total-ac'});
        f.config.batteryPresent = true;
        f.config.batteryAcPowerId = 'storage.ac';
        f.mapping.DP_BATTERY_AC_POWER = 'storage.ac';
        f.put('storage.ac', signedW);
        const result = f.evaluate();
        assert.equal(result.valid, true, result.reason);
        assert.equal(result.snapshot.actualGroupGrossW, 3000 + chargeW);
        assert.equal(result.snapshot.storageChargeW, chargeW);
        assert.equal(result.snapshot.storageDischargeW, dischargeW);
        assert.equal(result.snapshot.grossBudgetW, grossW);
        assert.equal(result.snapshot.devices.Battery.actualW, chargeW);
    });
}

function addControlledStorageSum(f, powers, heads) {
    f.config.batteryPresent = true;
    f.config.par14aStorageCoverage = 'complete-ac';
    f.config.par14aParticipants.push({name: 'all controlled AC storage charging', kind: 'storage',
        connectionPowerW: 5000, deviceId: 'Battery', powerId: BATTERY_SUM,
        powerUnit: 'W', powerScope: 'total-ac'});
    if (heads) Object.assign(f.config, {batteryDispatchMode: 'sunenergy-heads',
        batterySunEnergyInstance: 'sunenergyxt500.0', batteryHeadCount: powers.length});
    else {
        f.config.batteryAcPowerId = 'storage.ac';
        f.mapping.DP_BATTERY_AC_POWER = 'storage.ac';
    }
    const ids = powers.map((watts, index) => {
        const powerId = heads ? `sunenergyxt500.0.heads.${index + 1}.grid.GP` : 'storage.ac';
        f.config.par14aStorageMeters.push({powerId, powerUnit: 'W',
            powerScope: 'total-ac', direction: 'discharge-positive'});
        f.put(powerId, watts);
        return powerId;
    });
    return ids;
}

for (const [name, heads, powers, chargeW, dischargeW, grossW] of [
    ['single charging', false, [-500], 500, 0, 6700],
    ['single discharging', false, [500], 0, 500, 5700],
    ['heads both charging', true, [-500, -400], 900, 0, 7100],
    ['heads both discharging', true, [500, 400], 0, 900, 5300],
    ['heads in different directions', true, [-500, 400], 500, 400, 6300]
]) {
    test(`declared controlled AC storage sum: ${name}`, () => {
        const f = fixture();
        const ids = addControlledStorageSum(f, powers, heads);
        const result = f.evaluate();
        assert.equal(result.valid, true, result.reason);
        assert.equal(result.snapshot.actualGroupGrossW, 3000 + chargeW);
        assert.equal(result.snapshot.storageChargeW, chargeW);
        assert.equal(result.snapshot.storageDischargeW, dischargeW);
        assert.equal(result.snapshot.devices.Battery.actualW, chargeW,
            'participant charging is the sum of positive charging heads, never a net of opposite directions');
        assert.equal(result.snapshot.grossBudgetW, grossW);
        assert.deepEqual(result.snapshot.rawSources.filter(source => ids.includes(source.id))
            .map(source => ({id: source.id, val: source.val, ts: source.ts})),
        ids.map((id, index) => ({id, val: powers[index], ts: NOW})),
        'the aggregate preserves each signed original once in the evidence');
    });
}

test('a controlled multihead sum cannot omit one configured AC head', () => {
    const f = fixture();
    addControlledStorageSum(f, [-500, -400], true);
    f.config.par14aStorageMeters.pop();
    denied(f);
});

test('accounting source inventory is inactive for legacy configuration', () => {
    const f = fixture();
    f.config.par14aAccountingMode = 'legacyGross';
    assert.deepEqual(accountingSources(f.config, NS), []);
});

test('accounting source inventory preserves exact units, deduplicates IDs and rejects subscription patterns', () => {
    const f = fixture();
    f.config.par14aParticipants.push({...f.config.par14aParticipants[0], name: 'same physical source'});
    f.config.par14aStorageMeters = [{powerId: 'storage.ac', powerUnit: 'W',
        powerScope: 'total-ac', direction: 'discharge-positive'}];
    const list = accountingSources(f.config, NS);
    assert.deepEqual(list, [{id: 'wb0.power', unit: 'kW'}, {id: 'storage.ac', unit: 'W'}]);
    for (const id of ['', 'some.*', 'some.?', 'some.\nstate', `${NS}.Debug.Source`, `${NS}.Actual.Power_W`]) {
        f.config.par14aParticipants[0].powerId = id;
        f.config.par14aParticipants.pop();
        assert.ok(!accountingSources(f.config, NS).some(source => source.id === id), id);
        f.config.par14aParticipants.push({...f.config.par14aParticipants[0], name: 'duplicate'});
    }
});

test('an over-limit source inventory cannot become a valid but unsubscribed runtime proof', () => {
    const f = fixture();
    for (let index = 0; index < 63; index++) {
        const powerId = `passive.${index}.power`;
        f.config.par14aParticipants.push({name: `passive${index}`, kind: 'cooling',
            connectionPowerW: 6000, deviceId: '', powerId, powerUnit: 'W', powerScope: 'total-ac'});
        f.put(powerId, 0);
    }
    f.config.par14aStorageCoverage = 'complete-ac';
    for (let index = 0; index < 65; index++) {
        const powerId = `storage.${index}.ac`;
        f.config.par14aStorageMeters.push({powerId, powerUnit: 'W',
            powerScope: 'total-ac', direction: 'discharge-positive'});
        f.put(powerId, 0);
    }
    assert.deepEqual(accountingSources(f.config, NS), [], 'malformed inventory must not expand subscriptions');
    denied(f);
});

test('runtime observation and command previews do not write or mutate their cached input states', () => {
    const f = fixture();
    const before = JSON.stringify([...f.states]);
    const originalConfig = JSON.stringify(f.config);
    const result = f.evaluate();
    deviceGroupLimit(result, 'Wallbox0');
    checkGroupCommand(result, 'Wallbox0', 6200);
    assert.equal(JSON.stringify([...f.states]), before);
    assert.equal(JSON.stringify(f.config), originalConfig);
    assert.equal(Object.isFrozen(f.config.par14aParticipants[0]), false,
        'freezing a result must not freeze the caller configuration');
    for (const state of f.states.values()) assert.equal(Object.isFrozen(state), false,
        'freezing diagnostic proof must not freeze cached observations owned by the caller');
});

test('explicit native source bindings keep precedence over an older mapping snapshot', () => {
    const f = fixture();
    f.mapping.DP_GRID_IMPORT = 'old.import';
    f.put('old.import', 0);
    assert.equal(f.evaluate().snapshot.siteNetW, 1000);
});

test('known DC battery telemetry cannot be declared as a complete AC storage meter', () => {
    const f = fixture();
    f.config.par14aStorageCoverage = 'complete-ac';
    const powerId = 'sunenergyxt500.0.total.batteryPower';
    f.config.par14aStorageMeters.push({powerId, powerUnit: 'W', powerScope: 'total-ac', direction: 'discharge-positive'});
    f.put(powerId, 500);
    denied(f);
});

test('known external SunEnergy AC meters retain their driver sign contract', () => {
    const f = fixture();
    f.config.par14aStorageCoverage = 'complete-ac';
    const powerId = 'sunenergyxt500.0.heads.3.grid.GP';
    f.config.par14aStorageMeters.push({powerId, powerUnit: 'W', powerScope: 'total-ac', direction: 'charge-positive'});
    f.put(powerId, 500);
    denied(f);
});

test('a SunEnergy total and its contained head are not independent AC storage meters', () => {
    const f = fixture();
    f.config.par14aStorageCoverage = 'complete-ac';
    for (const powerId of ['sunenergyxt500.0.total.gridPower', 'sunenergyxt500.0.heads.1.grid.GP']) {
        f.config.par14aStorageMeters.push({powerId, powerUnit: 'W', powerScope: 'total-ac', direction: 'discharge-positive'});
        f.put(powerId, -500);
    }
    denied(f);
});

test('a controlled single-head GS cannot borrow another AC meter as its actual response', () => {
    const f = fixture();
    Object.assign(f.config, {batteryPresent: true, batteryControlEnabled: true,
        batterySetpointId: 'sunenergyxt500.0.heads.1.control.GS', batteryAcPowerId: 'storage.ac',
        par14aStorageCoverage: 'complete-ac'});
    f.config.par14aStorageMeters.push({powerId: 'storage.ac', powerUnit: 'W', powerScope: 'total-ac', direction: 'discharge-positive'});
    f.put('storage.ac', 0);
    denied(f);
});

test('the verified single-head total is one alias for its retained current GS claim', () => {
    const f = fixture();
    const target = 'sunenergyxt500.0.heads.1.control.GS', powerId = 'sunenergyxt500.0.total.gridPower';
    Object.assign(f.config, {batteryPresent: true, batteryControlEnabled: true,
        batterySetpointId: target, batteryAcPowerId: powerId, par14aStorageCoverage: 'complete-ac'});
    f.config.par14aStorageMeters.push({powerId, powerUnit: 'W', powerScope: 'total-ac', direction: 'discharge-positive'});
    f.put(powerId, 500);
    f.own('Devices.Battery.SingleHeadVerified', true);
    f.own('Devices.Battery.OutputOwned', true);
    f.own('Devices.Battery.OutputSetpointId', target);
    f.own('Devices.Battery.OutputCommandInternal_W', -500);
    f.own('Devices.Battery.OutputUnobservedCommand_W', -500);
    const result = f.evaluate();
    assert.equal(result.valid, true, result.reason);
    assert.equal(result.snapshot.storageDischargeW, 500);
    assert.equal(result.snapshot.eligibleOwnAvailableW, 1500);
    assert.equal(result.snapshot.rawSources.filter(source => source.id === powerId).length, 1);
});

test('uncounted participant remains measured and shares the selected population budget', () => {
    const f=fixture({actualW:0,importW:3000});
    f.config.par14aBudgetMode='ems';
    f.config.par14aParticipants[0].budgetIncluded=false;
    f.config.par14aParticipants.push({name:'WP',kind:'heatPump',connectionPowerW:10000,
        budgetIncluded:true,deviceId:'',powerId:'wp.ac',powerUnit:'W',powerScope:'total-ac'});
    f.put('wp.ac',3000);
    const result=f.evaluate();
    assert.equal(result.valid,true,result.reason);
    assert.equal(result.calculation.count,1);
    assert.equal(result.snapshot.netBudgetW,4200);
    assert.equal(checkGroupCommand(result,'Wallbox0',4200).allowed,false);
    assert.equal(checkGroupCommand(result,'Wallbox0',1200).allowed,true);
    f.states.get('wb0.power').ts=NOW-30001;
    denied(f);
});
