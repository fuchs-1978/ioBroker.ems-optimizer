'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {buildDiagnosticSourceContract, parseDiagnosticPumpSources} = require('../lib/diagnostic-source-contract');

test('diagnostic inventory covers handoff inputs and heater witnesses without enumerating unrelated private mappings', () => {
    const mapping = {DP_WB_PRIORITY: 'manual.priority', DP_DHW_SETPOINT: 'heater.request',
        DP_DHW_OUTPUT1: 'heater.l1', DP_DHW_OUTPUT2: 'heater.l2', DP_DHW_OUTPUT3: 'heater.l3',
        DP_DHW_ACTUAL_MIRROR: 'heater.mirror', PRIVATE_PASSWORD: 'private.password',
        DP_PAR14A: 'protection.14a', DP_GRID_IMPORT: 'grid.import', DP_GRID_EXPORT: 'grid.export'};
    const expected = new Set(Object.values(mapping).filter(id => id !== 'private.password'));
    for (const wb of [0, 1, 2]) {
        for (const suffix of ['ALLOW', 'RELEASE', 'SOC', 'MIN_SOC', 'TARGET', 'AMIN', 'PHASES', 'CAR', 'POWER', 'L1_A', 'L2_A', 'L3_A']) {
            const id = `vehicle.${wb}.${suffix}`; mapping[`DP_WB${wb}_${suffix}`] = id; expected.add(id);
        }
        for (const key of ['Priority', 'MustCharge', 'StartDelayActive', 'MinimumRunTimeActive'])
            expected.add(`ems.0.Vehicles.Wallbox${wb}.${key}`);
    }
    for (const key of ['OutputReservationState_JSON', 'OutputLastWrite', 'OutputCommand_W'])
        expected.add(`ems.0.Devices.MyPV_DHW.${key}`);
    for (const key of ['System.Version', 'System.RealOutputsEnabled', 'Config.WallboxStartDelay_s',
        'Config.WallboxMinimumRunTime_s', 'Config.WallboxStopDelay_s']) expected.add(`ems.0.${key}`);
    const contract = buildDiagnosticSourceContract({namespace: 'ems.0', mapping});
    const observed = new Set(contract.map(source => source.id));
    for (const id of expected) assert.ok(observed.has(id), `missing diagnostic source ${id}`);
    assert.equal(observed.has('private.password'), false);
    assert.equal(observed.size, contract.length, 'one descriptor per original source');
    assert.ok(contract.length < 256, 'finite contract fits the bounded interval source inventory');
    assert.equal(contract.find(source => source.id === 'vehicle.0.POWER').powerScale, 1000);
    assert.equal(contract.find(source => source.id === 'heater.l1').powerScale, 1);
});

test('native IDs and active wallbox output IDs are used before migration fallback and aliases are deduplicated', () => {
    const config = {wb0SocId: 'native.soc', wb0AmpereOutputId: 'native.command',
        dataPointMapJson: JSON.stringify({DP_WB0_SOC: 'legacy.soc'}), diagnosticPumpSourcesJson: '["native.soc","pump.ack"]'};
    const contract = buildDiagnosticSourceContract({namespace: 'ems.0', config,
        mapping: {DP_WB0_SOC: 'passed.soc', DP_WB0_ALLOW: 'shared.allow'},
        wallboxes: [{wb: 0, ids: {allow: 'shared.allow', command: 'actual.command'}}]});
    assert.ok(contract.some(source => source.id === 'native.soc'));
    assert.ok(!contract.some(source => source.id === 'legacy.soc' || source.id === 'passed.soc'));
    assert.ok(contract.some(source => source.id === 'actual.command'));
    assert.ok(!contract.some(source => source.id === 'native.command'));
    const shared = contract.find(source => source.id === 'shared.allow');
    assert.deepEqual(shared.keys, ['DP_WB0_ALLOW', 'Wallbox0.allow']);
    assert.equal(contract.filter(source => source.id === 'native.soc').length, 1);
    assert.ok(contract.find(source => source.id === 'native.soc').keys.includes('pump.observation'));
});

test('optional pump inventory accepts bounded explicit existing IDs without reading states or inventing a pump', () => {
    assert.deepEqual(parseDiagnosticPumpSources(undefined), {ids: [], status: 'not-configured', errors: []});
    assert.deepEqual(parseDiagnosticPumpSources('["pump.command"," pump.bus ","pump.ack","pump.command"]'),
        {ids: ['pump.command', 'pump.bus', 'pump.ack'], status: 'configured', errors: []});
    const empty = buildDiagnosticSourceContract({namespace: 'ems.0'});
    assert.equal(empty.some(source => source.keys.includes('pump.observation')), false);
    const configured = buildDiagnosticSourceContract({namespace: 'ems.0',
        config: {diagnosticPumpSourcesJson: '["pump.command","pump.bus","pump.ack"]'}});
    assert.deepEqual(configured.filter(source => source.keys.includes('pump.observation')).map(source => source.id),
        ['pump.command', 'pump.bus', 'pump.ack']);
});

test('invalid pump lists expose a blocker and never partially expand wildcards, oversized lists or recorder loops', () => {
    for (const input of ['{', '{}', '[null]', '["pump.*"]', '["pump.?"]', '["pump.command","ems.0.Debug.Shadow.DecisionRecord"]',
        JSON.stringify(Array.from({length: 33}, (_, i) => `source.${i}`)), JSON.stringify(['a'.repeat(257)]), ' '.repeat(20001)]) {
        const result = parseDiagnosticPumpSources(input, 'ems.0');
        assert.equal(result.status, 'invalid', String(input).slice(0, 80));
        assert.deepEqual(result.ids, []);
        assert.ok(result.errors.length);
        const contract = buildDiagnosticSourceContract({namespace: 'ems.0', config: {diagnosticPumpSourcesJson: input}});
        assert.equal(contract.some(source => source.keys.includes('pump.observation')), false);
    }
});

test('building a contract does not mutate mappings, configuration or active device IDs', () => {
    const inputs = {namespace: 'ems.0', config: {wb0SocId: 'native.soc', diagnosticPumpSourcesJson: '[]'},
        mapping: {DP_WB0_SOC: 'old.soc'}, wallboxes: [{wb: 0, ids: {allow: 'allow'}}]};
    const before = structuredClone(inputs);
    buildDiagnosticSourceContract(inputs);
    assert.deepEqual(inputs, before);
});

test('cyclic write timestamps, measurement deviations and numeric reason details are not declared discrete decision changes', () => {
    const contract = buildDiagnosticSourceContract({namespace: 'ems.0'});
    const descriptor = key => contract.find(source => source.id === `ems.0.${key}`);
    assert.equal(descriptor('Devices.MyPV_DHW.OutputLastWrite').discrete, false);
    assert.equal(descriptor('Devices.MyPV_DHW.ActuatorDifference_W').discrete, false);
    for (const key of ['Devices.MyPV_DHW.ControlReason', 'Devices.MyPV_DHW.OutputStatus',
        'Devices.Wallbox0.LastStopReason', 'Devices.Wallbox1.LastStopReason', 'Devices.Wallbox2.LastStopReason']) {
        assert.equal(descriptor(key).edgeNormalization, 'stable-reason');
        assert.equal(descriptor(key).discrete, true, 'a changed cause category remains an event');
    }
    assert.equal(descriptor('Devices.MyPV_DHW.OutputCommand_W').discrete, true,
        'a changed actuator request remains an immediate decision');
});
