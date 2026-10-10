'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {readTopology, parseHeadSnapshot, deviceProfile} = require('../lib/sunenergy-heads');

const now = 2000000;
const payload = extra => ({GP: 0, GS: 0, SC: 50, MM: 0, LM: 1, ON: 1,
    MG: 2400, IS: 2400, LP: 0, SI: 10, SA: 100, SI1: 5, SA1: 3, PK: 2, ...extra});
function head(index, extra = {}, feedback = {}, options = {}) {
    return parseHeadSnapshot({val: JSON.stringify({state: {reported: payload(extra)}}),
        ts: now, ack: true, q: 0, ...feedback}, {now, maxAgeMs: 30000, index, ...options});
}
const numericAggregates = ['soc', 'actualW', 'packs', 'deviceMinSoc', 'deviceMaxSoc',
    'minSoc', 'maxSoc', 'deviceMaxChargeW', 'deviceMaxDischargeW', 'maxChargeW',
    'maxDischargeW', 'sourceTs', 'oldestSourceTs', 'newestSourceTs', 'sourceTsMin',
    'sourceTsMax', 'sourceAgeMsMax', 'sourceSkewMs', 'capacityKWh'];
function assertUnknown(profile) {
    assert.equal(profile.valid, false);
    for (const key of numericAggregates) assert.equal(profile[key], null, key);
    assert.equal(profile.capacityValid, false);
    assert.deepEqual(profile.headLimits, []);
}

test('one, two or three complete heads supply weighted SOC and real AC power', () => {
    for (const count of [1, 2, 3]) {
        const heads = Array.from({length: count}, (_, i) => head(i + 1,
            {SC: 20 + 20 * i, ON: i + 1, GP: (i + 1) * -100}));
        const profile = deviceProfile(heads, {topology: readTopology({batteryHeadCount: count}),
            manualCapacityKWh: 12});
        assert.equal(profile.valid, true);
        assert.equal(profile.packs, count * (count + 1) / 2);
        assert.equal(profile.soc, heads.reduce((sum, item) => sum + item.packs * item.soc, 0) / profile.packs);
        assert.equal(profile.actualW, 100 * count * (count + 1) / 2);
        assert.equal(profile.capacityKWh, 12);
        assert.equal(profile.capacityReason, 'manual-system-capacity');
    }
    assert.equal(deviceProfile([head(1, {GP: 800})], {manualCapacityKWh: 2}).actualW, -800);
});

test('auto capacity requires explicit pack size and describes online capacity', () => {
    const heads = [head(1, {ON: 2, SC: 20}), head(2, {ON: 3, SC: 80})];
    const profile = deviceProfile(heads, {capacitySource: 'sunenergy-packs',
        packCapacityKWh: 2.56, manualCapacityKWh: 99});
    assert.equal(profile.valid, true);
    assert.equal(profile.capacityValid, true);
    assert.equal(profile.packs, 5);
    assert.equal(profile.soc, 56);
    assert.equal(profile.capacityKWh, 12.8);
    assert.equal(profile.capacityReason, 'online-packs-times-explicit-pack-capacity');
    // ON reports packs currently online; a smaller count is not evidence that
    // the installed nominal pack capacity physically disappeared.
    const fewerOnline = deviceProfile([head(1, {ON: 1}), head(2, {ON: 3})],
        {capacitySource: 'sunenergy-packs', packCapacityKWh: 2.56});
    assert.equal(fewerOnline.capacityKWh, 10.24);
    assert.equal(fewerOnline.capacityReason, 'online-packs-times-explicit-pack-capacity');
    for (const packCapacityKWh of [undefined, null, 0, -1, '', ' ', false, NaN, Infinity]) {
        const unknown = deviceProfile(heads, {capacitySource: 'sunenergy-packs',
            packCapacityKWh, manualCapacityKWh: 99});
        assert.equal(unknown.valid, true);
        assert.equal(unknown.capacityValid, false);
        assert.equal(unknown.capacityKWh, null);
        assert.equal(unknown.capacityReason, 'online-pack-capacity-unknown');
    }
    assert.equal(deviceProfile(heads, {capacitySource: 'sunenergy-packs',
        packCapacityKWh: '2.56'}).capacityKWh, 12.8);
});

test('manual capacity is explicit and is not inferred from unknown adapter fields', () => {
    const heads = [head(1)];
    for (const manualCapacityKWh of [undefined, null, 0, -1, '', false, Infinity]) {
        const unknown = deviceProfile(heads, {manualCapacityKWh});
        assert.equal(unknown.valid, true);
        assert.equal(unknown.capacityValid, false);
        assert.equal(unknown.capacityKWh, null);
        assert.equal(unknown.capacityReason, 'manual-system-capacity-unknown');
    }
    assert.equal(deviceProfile(heads, {capacitySource: 'unknown', manualCapacityKWh: 10})
        .capacityReason, 'head-profile-capacity-source-invalid');
    assert.equal(deviceProfile(heads, {manualCapacityKWh: '10'}).capacityKWh, 10);
});

test('missing, offline, stale or unacknowledged configured heads invalidate every aggregate', () => {
    const topology = readTopology({batteryHeadCount: 2});
    const options = {topology, capacitySource: 'sunenergy-packs', packCapacityKWh: 2.56};
    const valid = head(1);
    for (const invalid of [head(2, {}, {ts: now - 30001}), head(2, {}, {ack: false}),
        head(2, {}, {q: 0x20}), head(2, {ON: 0}),
        head(2, {}, {}, {onlineState: {val: false, ack: true}}), null])
        assertUnknown(deviceProfile([valid, invalid], options));
    assertUnknown(deviceProfile([valid], options));
    assertUnknown(deviceProfile([valid, valid], options));
    assertUnknown(deviceProfile([valid, head(3)], options));
    assertUnknown(deviceProfile([], options));
    assertUnknown(deviceProfile([valid], {topology: {...topology, valid: false}}));
});

test('a valid flag cannot make incomplete or malformed parsed data known', () => {
    const valid = head(1);
    for (const key of ['soc', 'packs', 'acPowerW', 'minSoc', 'maxSoc',
        'hysteresisCharge', 'hysteresisDischarge', 'maxChargeW', 'maxDischargeW',
        'sourceTs', 'sourceAgeMs', 'online']) {
        const incomplete = {...valid}; delete incomplete[key];
        assertUnknown(deviceProfile([incomplete], {manualCapacityKWh: 10}));
    }
    for (const value of [null, '', '100', NaN, Infinity])
        assertUnknown(deviceProfile([{...valid, acPowerW: value}], {manualCapacityKWh: 10}));
    assertUnknown(deviceProfile([{...valid, online: false}], {manualCapacityKWh: 10}));
});

test('device, per-head and operator global power caps all remain binding', () => {
    const topology = readTopology({batteryHeadCount: 3,
        batteryHead1MaxChargeW: 1500, batteryHead1MaxDischargeW: 700,
        batteryHead2MaxChargeW: 0, batteryHead2MaxDischargeW: 600,
        batteryHead3MaxChargeW: 1000, batteryHead3MaxDischargeW: 2000});
    const profile = deviceProfile([head(1, {PK: 1}), head(2, {MG: 400}),
        head(3, {IS: 2400, LP: 1000})], {topology, maxChargeW: 2000,
        maxDischargeW: 1800, manualCapacityKWh: 10});
    assert.equal(profile.deviceMaxChargeW, 2500);
    assert.equal(profile.deviceMaxDischargeW, 2500);
    assert.equal(profile.maxChargeW, 2000);
    assert.equal(profile.maxDischargeW, 1800);
    assert.deepEqual(profile.headLimits.map(item => [item.maxChargeW, item.maxDischargeW]),
        [[1500, 700], [0, 400], [1000, 1400]]);
    const zero = deviceProfile([head(1)], {maxChargeW: 0, maxDischargeW: 0, manualCapacityKWh: 10});
    assert.equal(zero.maxChargeW, 0);
    assert.equal(zero.maxDischargeW, 0);
    assert.equal(deviceProfile([head(1, {LP: undefined})], {manualCapacityKWh: 10}).maxDischargeW, 0);
    assertUnknown(deviceProfile([head(1)], {maxChargeW: null, manualCapacityKWh: 10}));
    assertUnknown(deviceProfile([head(1)], {maxDischargeW: -1, manualCapacityKWh: 10}));
});

test('shared SOC interval uses restrictive device bounds and keeps per-head hysteresis', () => {
    const profile = deviceProfile([head(1, {SI: 10, SA: 90, SI1: 2, SA1: 3}),
        head(2, {SI: 20, SA: 95, SI1: 5, SA1: 7})],
    {minSoc: 30, maxSoc: 85, manualCapacityKWh: 10});
    assert.equal(profile.deviceMinSoc, 20);
    assert.equal(profile.deviceMaxSoc, 90);
    assert.equal(profile.minSoc, 30);
    assert.equal(profile.maxSoc, 85);
    assert.deepEqual(profile.headLimits.map(item => [item.hysteresisDischarge, item.hysteresisCharge]),
        [[2, 3], [5, 7]]);
    assertUnknown(deviceProfile([head(1, {SI: 85, SA: 95}), head(2, {SI: 10, SA: 80})],
        {manualCapacityKWh: 10}));
    assertUnknown(deviceProfile([head(1)], {minSoc: 95, maxSoc: 90, manualCapacityKWh: 10}));
});

test('source range stays tied to actual head timestamps and never a shared heartbeat', () => {
    const heads = [head(1, {}, {ts: now - 1000}), head(2, {}, {ts: now - 3000})];
    const profile = deviceProfile(heads, {manualCapacityKWh: 10, maxSourceSkewMs: 2000});
    assert.equal(profile.sourceTs, now - 3000);
    assert.equal(profile.oldestSourceTs, now - 3000);
    assert.equal(profile.newestSourceTs, now - 1000);
    assert.equal(profile.sourceAgeMsMax, 3000);
    assert.equal(profile.sourceSkewMs, 2000);
    assertUnknown(deviceProfile(heads, {manualCapacityKWh: 10, maxSourceSkewMs: 1999}));
});

test('profile is pure and source snapshots and topology caps are not mutated', () => {
    const heads = [Object.freeze(head(2, {SC: 80, ON: 2})), Object.freeze(head(1, {SC: 20}))];
    const topology = readTopology({batteryHeadCount: 2});
    for (const descriptor of topology.heads) Object.freeze(descriptor);
    Object.freeze(topology.heads); Object.freeze(topology); Object.freeze(heads);
    const profile = deviceProfile(heads, {topology, manualCapacityKWh: 10});
    assert.equal(profile.valid, true);
    assert.deepEqual(profile.headLimits.map(item => item.index), [1, 2]);
    assert.deepEqual(heads.map(item => item.index), [2, 1]);
    assert.equal(heads[0].maxDischargeW, 2400);
    assert.equal(topology.heads[0].maxDischargeW, 800);
});
