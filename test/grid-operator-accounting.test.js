'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {evaluateGroupAccounting, commandBudget, reserveGroupCommands} = require('../lib/grid-operator-accounting');

const NOW = 2000000;
function source(id, val, extra = {}) {
    return {id, boundaryId: 'site', unit: 'W', scope: 'total-ac',
        state: {val, ts: NOW, ack: true, q: 0}, ...extra};
}

function fixture({participantW = 3000, importW = 1000, exportW = 0} = {}) {
    const meter = {...source('ev0-power', participantW), participantIds: ['ev0']};
    return {mode: 'groupNet', now: NOW,
        limit: {valid: true, active: true, budgetW: 4200, groupId: 'g', boundaryId: 'site'},
        group: {id: 'g', boundaryId: 'site', participants: [{id: 'ev0', deviceId: 'Wallbox0'}]},
        site: {import: source('grid-import', importW), export: source('grid-export', exportW)},
        participantMeters: [meter], storage: {coverage: 'none', meters: []},
        devices: [{id: 'Wallbox0', participantId: 'ev0', measurement: meter,
            commandW: participantW, reservedW: participantW}]};
}

function addPassive(input, id, watts, sourceId = `${id}-power`) {
    input.group.participants.push({id, deviceId: null});
    const meter = {...source(sourceId, watts), participantIds: [id]};
    input.participantMeters.push(meter);
    return meter;
}

function addDevice(input, id, participantId, watts, commandW = watts, reservedW = commandW) {
    const meter = source(`${id}-power`, watts);
    if (participantId !== null) {
        input.group.participants.push({id: participantId, deviceId: id});
        meter.participantIds = [participantId];
        input.participantMeters.push(meter);
    }
    input.devices.push({id, participantId, measurement: meter, commandW, reservedW});
    return input.devices.at(-1);
}

function closed(input) {
    const result = evaluateGroupAccounting(input);
    assert.equal(result.valid, false, JSON.stringify(result));
    assert.equal(result.active, true);
    assert.equal(result.grossBudgetW, 0);
    assert.equal(commandBudget(result, 'Wallbox0', 0).allowed, true, 'OFF remains available');
    assert.equal(commandBudget(result, 'Wallbox0', 1).allowed, false);
    return result;
}

for (const [name, draw, imported, exported, own, used, groupNet, cap] of [
    ['no generation: ordinary household import is not participant import', 3000, 5000, 0, 0, 0, 3000, 4200],
    ['generation below ordinary household demand creates no uplift', 3000, 3500, 0, 0, 0, 3000, 4200],
    ['generation after household consumption partly supplies participants', 3000, 1000, 0, 2000, 2000, 1000, 6200],
    ['export remains available in addition to generation already used', 3000, 0, 1000, 4000, 3000, 0, 8200],
    ['idle participants do not erase measured export', 0, 0, 3000, 3000, 0, 0, 7200]
]) {
    test(`accounting: ${name}`, () => {
        const result = evaluateGroupAccounting(fixture({participantW: draw, importW: imported, exportW: exported}));
        assert.equal(result.valid, true, JSON.stringify(result));
        assert.equal(result.active, true);
        assert.equal(result.mode, 'groupNet');
        assert.equal(result.netBudgetW, 4200);
        assert.equal(result.actualGroupGrossW, draw);
        assert.equal(result.actualGroupNetW, groupNet);
        assert.equal(result.rawOwnAvailableW, own);
        assert.equal(result.ownAvailableW, own);
        assert.equal(result.ownUsedW, used);
        assert.equal(result.grossBudgetW, cap);
        assert.equal(result.participantPendingW, 0);
        assert.equal(result.nonparticipantPendingW, 0);
    });
}

test('a fresh PV loss withdraws the preceding uplift immediately without retaining a previous result', () => {
    const input = fixture({importW: 0, exportW: 1000});
    const before = evaluateGroupAccounting(input);
    assert.equal(before.grossBudgetW, 8200);
    input.site.export.state.val = 0;
    input.site.import.state.val = 5000;
    const after = evaluateGroupAccounting(input);
    assert.equal(after.valid, true);
    assert.equal(after.ownAvailableW, 0);
    assert.equal(after.grossBudgetW, 4200);
    assert.equal(before.grossBudgetW, 8200, 'evaluation must not mutate an earlier observation');
});

for (const path of ['import', 'export', 'participant']) {
    for (const [name, stateChange] of [
        ['NULL', state => {state.val = null;}],
        ['undefined', state => {delete state.val;}],
        ['numeric string', state => {state.val = '1000';}],
        ['boolean', state => {state.val = false;}],
        ['NaN', state => {state.val = NaN;}],
        ['infinity', state => {state.val = Infinity;}],
        ['unacknowledged', state => {state.ack = false;}],
        ['missing ACK', state => {delete state.ack;}],
        ['bad quality', state => {state.q = 64;}],
        ['missing quality', state => {delete state.q;}],
        ['string quality', state => {state.q = '0';}],
        ['future', state => {state.ts = NOW + 1;}],
        ['stale', state => {state.ts = NOW - 30001;}],
        ['missing timestamp', state => {delete state.ts;}],
        ['zero timestamp', state => {state.ts = 0;}],
        ['nonfinite timestamp', state => {state.ts = NaN;}]
    ]) {
        test(`${path} ${name} cannot manufacture a generation credit`, () => {
            const input = fixture();
            const meter = path === 'participant' ? input.participantMeters[0] : input.site[path];
            stateChange(meter.state);
            closed(input);
        });
    }
}

for (const [name, modify] of [
    ['new participant load with an older NVP', input => {input.site.import.state.ts--;}],
    ['new NVP after a participant load drop with an older participant sample', input => {
        input.participantMeters[0].state.ts--;
    }],
    ['directional grid samples from different instants', input => {input.site.export.state.ts--;}]
]) {
    test(`default temporal coherence rejects ${name}`, () => {
        const input = fixture();
        modify(input);
        closed(input);
    });
}

test('an explicit small coherence window accepts its boundary and rejects the next millisecond', () => {
    const input = fixture();
    input.maxSkewMs = 100;
    input.participantMeters[0].state.ts = NOW - 100;
    assert.equal(evaluateGroupAccounting(input).valid, true);
    input.participantMeters[0].state.ts--;
    closed(input);
});

test('coherent samples at the exact age limit remain valid and the next millisecond fails closed', () => {
    const input = fixture();
    for (const meter of [input.site.import, input.site.export, ...input.participantMeters])
        meter.state.ts = NOW - 30000;
    assert.equal(evaluateGroupAccounting(input).valid, true);
    for (const meter of [input.site.import, input.site.export, ...input.participantMeters])
        meter.state.ts--;
    closed(input);
});

for (const [name, modify] of [
    ['wrong group', input => {input.limit.groupId = 'other';}],
    ['wrong boundary', input => {input.site.import.boundaryId = 'other';}],
    ['wrong participant meter boundary', input => {input.participantMeters[0].boundaryId = 'other';}],
    ['unknown power unit', input => {input.site.import.unit = 'A';}],
    ['inverter-only participant scope', input => {input.participantMeters[0].scope = 'inverter';}],
    ['negative directional import', input => {input.site.import.state.val = -1;}],
    ['negative directional export', input => {input.site.export.state.val = -1;}],
    ['undeclared signed participant draw', input => {input.participantMeters[0].state.val = -1000;}],
    ['missing participant meter', input => {input.participantMeters = [];}],
    ['unknown participant in meter', input => {input.participantMeters[0].participantIds.push('unknown');}],
    ['duplicate participant', input => {input.group.participants.push({...input.group.participants[0]});}],
    ['overlapping participant meter coverage', input => {
        input.participantMeters.push({...source('second-ev0-meter', 3000), participantIds: ['ev0']});
    }],
    ['duplicate physical meter identity', input => {input.site.export.id = input.site.import.id;}],
    ['controlled participant without device entry', input => {input.devices = [];}],
    ['device linked to another meter', input => {input.devices[0].measurement = source('unrelated-meter', 3000);}],
    ['negative command high-water mark', input => {input.devices[0].commandW = -1;}],
    ['unknown reserved power', input => {input.devices[0].reservedW = NaN;}],
    ['negative reservation', input => {input.devices[0].reservedW = -1;}],
    ['unknown storage coverage', input => {delete input.storage;}],
    ['unsupported storage coverage', input => {input.storage.coverage = 'probably-none';}],
    ['invalid active upstream limit', input => {input.limit.valid = false;}],
    ['missing active numeric limit', input => {input.limit.budgetW = null;}],
    ['negative limit', input => {input.limit.budgetW = -1;}],
    ['nonfinite limit', input => {input.limit.budgetW = Infinity;}],
    ['invalid clock', input => {input.now = NaN;}],
    ['zero maximum age', input => {input.maxAgeMs = 0;}],
    ['excessive maximum age', input => {input.maxAgeMs = 30001;}],
    ['negative coherence window', input => {input.maxSkewMs = -1;}],
    ['excessive coherence window', input => {input.maxSkewMs = 1001;}],
    ['coherence window exceeds source age bound', input => {input.maxSkewMs = 100; input.maxAgeMs = 50;}]
]) {
    test(`ambiguous accounting fails closed: ${name}`, () => {
        const input = fixture();
        modify(input);
        closed(input);
    });
}

test('explicit kW sources normalize to the same group balance without multiplying the operator limit', () => {
    const input = fixture();
    for (const meter of [input.site.import, input.site.export, ...input.participantMeters]) {
        meter.unit = 'kW'; meter.state.val /= 1000;
    }
    const result = evaluateGroupAccounting(input);
    assert.equal(result.valid, true, JSON.stringify(result));
    assert.equal(result.actualGroupGrossW, 3000);
    assert.equal(result.netBudgetW, 4200);
    assert.equal(result.grossBudgetW, 6200);
});

test('one complete passive heat-pump meter and disjoint inverter/auxiliary meters give the same balance', () => {
    const components = fixture();
    addPassive(components, 'wp-inverter', 700);
    addPassive(components, 'wp-auxiliary', 300);
    const total = structuredClone(components);
    total.participantMeters = [total.participantMeters[0],
        {...source('wp-total', 1000), participantIds: ['wp-inverter', 'wp-auxiliary']}];
    const a = evaluateGroupAccounting(components), b = evaluateGroupAccounting(total);
    assert.equal(a.valid, true, JSON.stringify(a));
    assert.equal(b.valid, true, JSON.stringify(b));
    assert.equal(a.actualGroupGrossW, 4000);
    for (const key of ['actualGroupGrossW', 'actualGroupNetW', 'ownAvailableW', 'grossBudgetW'])
        assert.equal(a[key], b[key], key);
    total.participantMeters.push({...source('wp-inverter-duplicated', 700), participantIds: ['wp-inverter']});
    closed(total);
});

test('a total heat-pump source cannot omit its auxiliary participant', () => {
    const input = fixture();
    addPassive(input, 'wp-inverter', 700);
    input.group.participants.push({id: 'wp-auxiliary', deviceId: null});
    closed(input);
});

test('an aggregate across independently controlled wallboxes cannot hide opposite pending changes', () => {
    const input = fixture();
    addDevice(input, 'Wallbox1', 'ev1', 2000, 3000, 3000);
    const aggregate = {...source('wallboxes-total', 5000), participantIds: ['ev0', 'ev1']};
    input.participantMeters = [aggregate];
    for (const device of input.devices) device.measurement = aggregate;
    input.devices[0].commandW = 2000;
    closed(input);
});

test('a pending participant increase consumes the group pool once without becoming measured generation', () => {
    const input = fixture();
    input.devices[0].commandW = 4000;
    input.devices[0].reservedW = 4000;
    const result = evaluateGroupAccounting(input);
    assert.equal(result.valid, true, JSON.stringify(result));
    assert.equal(result.actualGroupGrossW, 3000);
    assert.equal(result.rawOwnAvailableW, 2000);
    assert.equal(result.participantPendingW, 1000);
    assert.equal(result.committedGroupW, 4000);
    assert.equal(result.grossBudgetW, 6200);
});

test('a pending reduction does not release observed load and the reservation high-water is counted once', () => {
    const input = fixture();
    input.devices[0].commandW = 1000;
    input.devices[0].reservedW = 4000;
    const result = evaluateGroupAccounting(input);
    assert.equal(result.valid, true, JSON.stringify(result));
    assert.equal(result.actualGroupGrossW, 3000);
    assert.equal(result.participantPendingW, 1000);
    assert.equal(result.committedGroupW, 4000);
    assert.equal(result.rawOwnAvailableW, 2000);
});

test('a pending nonparticipant increase reduces future own energy instead of entering participant consumption', () => {
    const input = fixture();
    addDevice(input, 'MyPV_DHW', null, 0, 1000, 1000);
    const result = evaluateGroupAccounting(input);
    assert.equal(result.valid, true, JSON.stringify(result));
    assert.equal(result.actualGroupGrossW, 3000);
    assert.equal(result.rawOwnAvailableW, 2000);
    assert.equal(result.nonparticipantPendingW, 1000);
    assert.equal(result.ownAvailableW, 1000);
    assert.equal(result.grossBudgetW, 5200);
    assert.equal(result.committedGroupW, 3000);
});

test('a participant command preview includes its own existing reservation only once', () => {
    const input = fixture();
    input.devices[0].commandW = 4000;
    input.devices[0].reservedW = 4000;
    const result = evaluateGroupAccounting(input);
    const exact = commandBudget(result, 'Wallbox0', 6200);
    assert.equal(exact.valid, true);
    assert.equal(exact.member, true);
    assert.equal(exact.maximumW, 6200);
    assert.equal(exact.allowed, true);
    assert.equal(commandBudget(result, 'Wallbox0', 6201).allowed, false);
});

test('measured nonparticipant consumption is already in the NVP and is not deducted again', () => {
    const input = fixture();
    addDevice(input, 'MyPV_DHW', null, 1000);
    const result = evaluateGroupAccounting(input);
    assert.equal(result.valid, true, JSON.stringify(result));
    assert.equal(result.actualGroupGrossW, 3000);
    assert.equal(result.rawOwnAvailableW, 2000);
    assert.equal(result.nonparticipantPendingW, 0);
    assert.equal(result.grossBudgetW, 6200);
    assert.equal(commandBudget(result, 'MyPV_DHW', 9000).allowed, true,
        'this group limit must not turn into an unrelated whole-house limit when group draw is below its net allowance');
});

test('nonparticipant command and reservation describe one pending load rather than two', () => {
    const input = fixture();
    addDevice(input, 'MyPV_DHW', null, 1000, 2000, 2500);
    const result = evaluateGroupAccounting(input);
    assert.equal(result.valid, true, JSON.stringify(result));
    assert.equal(result.nonparticipantPendingW, 1500);
    assert.equal(result.ownAvailableW, 500);
    assert.equal(result.grossBudgetW, 4700);
    assert.equal(result.actualGroupGrossW, 3000);
});

function twoWallboxes() {
    const input = fixture({participantW: 2000, importW: 1000});
    addDevice(input, 'Wallbox1', 'ev1', 2000);
    return input;
}

test('two wallbox previews share one joint reservation pool and cannot each spend the full headroom', () => {
    const state = evaluateGroupAccounting(twoWallboxes());
    assert.equal(state.valid, true);
    assert.equal(state.actualGroupGrossW, 4000);
    assert.equal(state.grossBudgetW, 7200);
    assert.equal(commandBudget(state, 'Wallbox0', 5000).allowed, true);
    assert.equal(commandBudget(state, 'Wallbox1', 5000).allowed, true,
        'independent previews deliberately do not allocate a pool');
    const before = JSON.stringify(state);
    const combined = reserveGroupCommands(state, {Wallbox0: 5000, Wallbox1: 5000});
    assert.equal(combined.allowed, false);
    assert.equal(combined.withinBudget, false);
    assert.equal(combined.next, null);
    assert.equal(JSON.stringify(state), before);
    const first = reserveGroupCommands(state, {Wallbox0: 5000});
    assert.equal(first.allowed, true);
    assert.equal(first.withinBudget, true);
    assert.notEqual(first.next, state);
    assert.equal(first.next.committedGroupW, 7000);
    assert.equal(commandBudget(first.next, 'Wallbox1', 2200).allowed, true);
    assert.equal(commandBudget(first.next, 'Wallbox1', 2201).allowed, false);
    assert.equal(reserveGroupCommands(first.next, {Wallbox1: 5000}).allowed, false);
    assert.equal(JSON.stringify(state), before, 'committing returns a new snapshot instead of mutating the preview');
});

test('a joint participant and EHZ vector cannot spend generation on both sides of the group boundary', () => {
    const input = fixture({participantW: 4000, importW: 1000});
    addDevice(input, 'MyPV_DHW', null, 0);
    const state = evaluateGroupAccounting(input);
    assert.equal(state.rawOwnAvailableW, 3000);
    assert.equal(state.grossBudgetW, 7200);
    assert.equal(commandBudget(state, 'Wallbox0', 5000).allowed, true);
    assert.equal(commandBudget(state, 'MyPV_DHW', 3000).allowed, true);
    const joint = reserveGroupCommands(state, {Wallbox0: 5000, MyPV_DHW: 3000});
    assert.equal(joint.allowed, false);
    assert.equal(joint.withinBudget, false);
    assert.equal(joint.next, null);
    const participantFirst = reserveGroupCommands(state, {Wallbox0: 5000});
    assert.equal(participantFirst.allowed, true);
    assert.equal(reserveGroupCommands(participantFirst.next, {MyPV_DHW: 3000}).allowed, false);
    const heaterFirst = reserveGroupCommands(state, {MyPV_DHW: 3000});
    assert.equal(heaterFirst.allowed, true);
    assert.equal(heaterFirst.next.ownAvailableW, 0);
    assert.equal(heaterFirst.next.grossBudgetW, 4200);
    assert.equal(reserveGroupCommands(heaterFirst.next, {Wallbox0: 5000}).allowed, false);
});

test('confirmed electrical uptake replaces its pending reservation without creating another allowance', () => {
    const pending = fixture();
    pending.devices[0].commandW = 4000;
    pending.devices[0].reservedW = 4000;
    const before = evaluateGroupAccounting(pending);
    const afterInput = fixture({participantW: 4000, importW: 2000});
    const after = evaluateGroupAccounting(afterInput);
    assert.equal(before.rawOwnAvailableW, 2000);
    assert.equal(after.rawOwnAvailableW, 2000, 'higher participant consumption and its NVP effect offset');
    assert.equal(before.participantPendingW, 1000);
    assert.equal(after.participantPendingW, 0);
    assert.equal(before.committedGroupW, 4000);
    assert.equal(after.committedGroupW, 4000);
    assert.equal(commandBudget(before, 'Wallbox0', 6200).maximumW,
        commandBudget(after, 'Wallbox0', 6200).maximumW);
});

test('a safe current reduction remains distinct from full budget compliance', () => {
    const input = fixture({participantW: 6000, importW: 6000});
    const state = evaluateGroupAccounting(input);
    assert.equal(state.grossBudgetW, 4200);
    const reduction = commandBudget(state, 'Wallbox0', 5000);
    assert.equal(reduction.allowed, true);
    assert.equal(reduction.safeReduction, true);
    assert.equal(reduction.withinBudget, false);
    assert.equal(reduction.maximumW, 4200);
    const committed = reserveGroupCommands(state, {Wallbox0: 5000});
    assert.equal(committed.allowed, true);
    assert.equal(committed.safeReduction, true);
    assert.equal(committed.withinBudget, false);
    assert.equal(committed.next.committedGroupW, 6000, 'an outstanding reduction does not invent electrical release');
    assert.equal(commandBudget(state, 'Wallbox0', 6000).allowed, false);
});

function withStorage({watts = 1000, direction = 'charge-positive', participant = false} = {}) {
    const input = fixture();
    const meter = {...source('storage-ac', watts), direction};
    input.storage = {coverage: 'complete-ac', meters: [meter]};
    if (participant) {
        input.group.participants.push({id: 'storage', kind: 'storage', deviceId: null});
        input.participantMeters.push({...meter, participantIds: ['storage']});
    }
    return input;
}

test('a participating storage charge is positive participant load once, not an extra generation credit', () => {
    const input = withStorage({watts: 1000, participant: true});
    input.site.import.state.val = 2000;
    const result = evaluateGroupAccounting(input);
    assert.equal(result.valid, true, JSON.stringify(result));
    assert.equal(result.actualGroupGrossW, 4000);
    assert.equal(result.actualGroupNetW, 2000);
    assert.equal(result.storageChargeW, 1000);
    assert.equal(result.storageDischargeW, 0);
    assert.equal(result.rawOwnAvailableW, 2000);
    assert.equal(result.eligibleOwnAvailableW, 2000);
    assert.equal(result.grossBudgetW, 6200);
});

for (const [direction, watts] of [['charge-positive', -1000], ['discharge-positive', 1000]]) {
    test(`actual storage discharge remains observed while conservative spendable credit excludes it: ${direction}`, () => {
        const input = withStorage({watts, direction, participant: true});
        input.participantMeters[0].state.val = 5000;
        input.devices[0].commandW = input.devices[0].reservedW = 5000;
        input.site.import.state.val = 4000;
        const result = evaluateGroupAccounting(input);
        assert.equal(result.valid, true, JSON.stringify(result));
        assert.equal(result.actualGroupGrossW, 5000);
        assert.equal(result.actualGroupNetW, 4000, 'policy attribution must not overwrite the measured group net diagnostic');
        assert.equal(result.rawOwnAvailableW, 1000);
        assert.equal(result.ownUsedW, 1000);
        assert.equal(result.storageChargeW, 0);
        assert.equal(result.storageDischargeW, 1000);
        assert.equal(result.eligibleOwnAvailableW, 0);
        assert.equal(result.ownAvailableW, 0);
        assert.equal(result.grossBudgetW, 4200);
    });
}

test('storage can cover all observed participant draw without turning policy exclusion into fictional grid import', () => {
    const input = withStorage({watts: -4000});
    input.participantMeters[0].state.val = 4000;
    input.devices[0].commandW = input.devices[0].reservedW = 4000;
    input.site.import.state.val = 0;
    const result = evaluateGroupAccounting(input);
    assert.equal(result.valid, true, JSON.stringify(result));
    assert.equal(result.actualGroupNetW, 0);
    assert.equal(result.rawOwnAvailableW, 4000);
    assert.equal(result.ownUsedW, 4000);
    assert.equal(result.eligibleOwnAvailableW, 0);
    assert.equal(result.grossBudgetW, 4200);
});

test('loss of storage discharge cannot withdraw a discretionary allowance that was never granted', () => {
    const input = withStorage({watts: -1000});
    input.site.import.state.val = 0;
    input.site.export.state.val = 1000;
    const before = evaluateGroupAccounting(input);
    assert.equal(before.rawOwnAvailableW, 4000);
    assert.equal(before.eligibleOwnAvailableW, 3000);
    input.storage.meters[0].state.val = 0;
    input.site.export.state.val = 0;
    const after = evaluateGroupAccounting(input);
    assert.equal(after.rawOwnAvailableW, 3000);
    assert.equal(after.eligibleOwnAvailableW, 3000);
    assert.equal(after.grossBudgetW, before.grossBudgetW);
});

test('unrelated storage charge is not added to participant load or counted twice through the NVP', () => {
    const input = withStorage({watts: 1000});
    input.site.import.state.val = 2000;
    const result = evaluateGroupAccounting(input);
    assert.equal(result.valid, true, JSON.stringify(result));
    assert.equal(result.actualGroupGrossW, 3000);
    assert.equal(result.storageChargeW, 1000);
    assert.equal(result.rawOwnAvailableW, 1000);
    assert.equal(result.grossBudgetW, 5200);
});

test('separate charging and discharging storage units do not net away their positive load or discharge exclusion', () => {
    const input = withStorage({watts: 1000, participant: true});
    input.group.participants.push({id: 'storage2', kind: 'storage', deviceId: null});
    const second = {...source('storage2-ac', -2000), direction: 'charge-positive'};
    input.storage.meters.push(second);
    input.participantMeters.push({...second, participantIds: ['storage2']});
    input.site.import.state.val = 0;
    const result = evaluateGroupAccounting(input);
    assert.equal(result.valid, true, JSON.stringify(result));
    assert.equal(result.actualGroupGrossW, 4000);
    assert.equal(result.actualGroupNetW, 0);
    assert.equal(result.storageChargeW, 1000);
    assert.equal(result.storageDischargeW, 2000);
    assert.equal(result.rawOwnAvailableW, 4000);
    assert.equal(result.eligibleOwnAvailableW, 2000);
    assert.equal(result.grossBudgetW, 6200);
});

test('a declared storage participant cannot silently select no-storage coverage', () => {
    const input = withStorage({participant: true});
    input.storage = {coverage: 'none', meters: []};
    closed(input);
});

for (const [name, modify] of [
    ['missing storage direction', input => {delete input.storage.meters[0].direction;}],
    ['DC-only storage scope', input => {input.storage.meters[0].scope = 'dc';}],
    ['duplicate storage meter', input => {input.storage.meters.push({...input.storage.meters[0]});}],
    ['stale storage sample', input => {input.storage.meters[0].state.ts = NOW - 30001;}],
    ['unacknowledged storage sample', input => {input.storage.meters[0].state.ack = false;}],
    ['unknown storage value', input => {input.storage.meters[0].state.val = null;}],
    ['bad storage quality', input => {input.storage.meters[0].state.q = 64;}],
    ['future storage sample', input => {input.storage.meters[0].state.ts = NOW + 1;}],
    ['incoherent storage sample', input => {input.storage.meters[0].state.ts--;}],
    ['none with an actual storage meter', input => {input.storage.coverage = 'none';}],
    ['complete AC coverage without meters', input => {input.storage.meters = [];}]
]) {
    test(`storage ambiguity fails closed: ${name}`, () => {
        const input = withStorage();
        modify(input);
        closed(input);
    });
}

test('a mixed storage and load aggregate cannot net away positive participant consumption', () => {
    const input = withStorage({watts: -1000});
    input.group.participants.push({id: 'storage', kind: 'storage', deviceId: null});
    const aggregate = {...source('mixed-ac', 4000), participantIds: ['ev0', 'storage']};
    input.participantMeters = [aggregate];
    input.devices[0].measurement = aggregate;
    closed(input);
});

for (const mode of ['legacyGross', 'groupNet']) {
    test(`inactive ${mode} leaves legacy allocation untouched without requiring invented measurements`, () => {
        const input = {mode, now: NOW, limit: {valid: true, active: false, budgetW: null}};
        const result = evaluateGroupAccounting(input);
        assert.equal(result.valid, true, JSON.stringify(result));
        assert.equal(result.active, false);
        assert.equal(result.grossBudgetW, null);
    });
}

test('explicit legacy gross mode is a no-op even for an active externally resolved limit', () => {
    const result = evaluateGroupAccounting({mode: 'legacyGross', now: NOW,
        limit: {valid: true, active: true, budgetW: 4200}});
    assert.equal(result.valid, true, JSON.stringify(result));
    assert.equal(result.active, false);
    assert.equal(result.grossBudgetW, null);
});

test('omitted accounting mode preserves migration behavior instead of activating the new group policy', () => {
    const result = evaluateGroupAccounting();
    assert.equal(result.valid, true);
    assert.equal(result.active, false);
    assert.equal(result.mode, 'legacyGross');
    assert.equal(result.grossBudgetW, null);
});

for (const requested of [null, undefined, NaN, Infinity, -1, '1000', true]) {
    test(`a malformed positive command request cannot acquire a group allowance: ${String(requested)}`, () => {
        const state = evaluateGroupAccounting(fixture());
        assert.equal(commandBudget(state, 'Wallbox0', requested).allowed, false);
    });
}

test('an unknown actuator cannot spend a participant budget while its OFF remains available', () => {
    const state = evaluateGroupAccounting(fixture());
    assert.equal(commandBudget(state, 'unknown', 100).allowed, false);
    assert.equal(commandBudget(state, 'unknown', 0).allowed, true);
    assert.equal(reserveGroupCommands(state, {unknown: 100}).allowed, false);
});

for (const [name, snapshot] of [
    ['missing snapshot', undefined], ['NULL snapshot', null], ['array snapshot', []],
    ['empty snapshot', {}], ['missing active flag', {schema: 1, valid: true}],
    ['nonboolean active flag', {schema: 1, valid: true, active: 'false'}],
    ['missing active devices', {schema: 1, valid: true, active: true}],
    ['NULL active devices', {schema: 1, valid: true, active: true, devices: null}],
    ['missing active numeric proof', {schema: 1, valid: true, active: true, devices: {}}],
    ['invalid inactive flag combination', {schema: 1, valid: false, active: false}]
]) {
    test(`a malformed accounting snapshot fails closed without throwing: ${name}`, () => {
        assert.doesNotThrow(() => {
            assert.equal(commandBudget(snapshot, 'Wallbox0', 100).allowed, false);
            assert.equal(commandBudget(snapshot, 'Wallbox0', 0).allowed, true);
            assert.equal(reserveGroupCommands(snapshot, {Wallbox0: 100}).allowed, false);
            assert.equal(reserveGroupCommands(snapshot, {Wallbox0: 0}).allowed, true);
        });
    });
}

for (const deviceId of [null, undefined, false, 0, 1, Symbol('Wallbox0'), {}, ['Wallbox0']]) {
    test(`device identities are strings before any property-key coercion: ${String(deviceId)}`, () => {
        const snapshot = evaluateGroupAccounting(fixture());
        assert.doesNotThrow(() => {
            assert.equal(commandBudget(snapshot, deviceId, 100).allowed, false);
            assert.equal(commandBudget(snapshot, deviceId, 0).allowed, true);
        });
    });
}

test('a device object cannot execute a coercion hook while acquiring a command allowance', () => {
    const snapshot = evaluateGroupAccounting(fixture());
    let coerced = false;
    const deviceId = {[Symbol.toPrimitive]() {coerced = true; throw new Error('unexpected device coercion');}};
    assert.equal(commandBudget(snapshot, deviceId, 100).allowed, false);
    assert.equal(coerced, false);
});

test('an empty joint vector is only a no-op and preserves every outstanding reservation', () => {
    const snapshot = evaluateGroupAccounting(fixture());
    const before = JSON.stringify(snapshot);
    const result = reserveGroupCommands(snapshot, {});
    assert.equal(result.allowed, true);
    assert.equal(JSON.stringify(result.next), before);
    assert.equal(JSON.stringify(snapshot), before);
});

test('symbol and hidden joint proposal keys cannot silently become an empty successful grant', () => {
    const snapshot = evaluateGroupAccounting(fixture());
    const symbolic = {[Symbol('Wallbox0')]: 5000};
    const hidden = Object.defineProperty({}, 'Wallbox0', {value: 5000, enumerable: false});
    for (const proposal of [symbolic, hidden]) {
        const result = reserveGroupCommands(snapshot, proposal);
        assert.equal(result.allowed, false);
        assert.equal(result.next, null);
    }
});

for (const [deviceId, inherited] of [['__proto__', Object.prototype], ['constructor', Object],
    ['toString', Object.prototype.toString]]) {
    test(`an unknown zero command cannot mutate an inherited ${deviceId} object`, () => {
        const snapshot = evaluateGroupAccounting(fixture());
        const before = ['commandW', 'reservedW'].map(key => Object.getOwnPropertyDescriptor(inherited, key));
        let result, error, after;
        try {
            result = reserveGroupCommands(snapshot, Object.fromEntries([[deviceId, 0]]));
        } catch (caught) {
            error = caught;
        } finally {
            after = ['commandW', 'reservedW'].map(key => Object.getOwnPropertyDescriptor(inherited, key));
            // Keep a deliberately failing regression from contaminating other
            // tests through a built-in prototype before reporting the failure.
            for (const [index, key] of ['commandW', 'reservedW'].entries()) {
                if (before[index]) Object.defineProperty(inherited, key, before[index]);
                else delete inherited[key];
            }
        }
        assert.deepEqual(after, before, 'safe OFF must not alter built-in objects');
        assert.ifError(error);
        assert.equal(result.allowed, true);
        assert.equal(result.next.committedGroupW, snapshot.committedGroupW);
    });
}

