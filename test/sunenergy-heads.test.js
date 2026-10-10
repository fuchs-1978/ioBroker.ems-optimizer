'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {readTopology, parseHeadSnapshot, allocate} = require('../lib/sunenergy-heads');

const now = 2000000;
const payload = extra => ({GP: 0, GS: 0, SC: 50, MM: 0, LM: 1, ON: 1,
    MG: 2400, IS: 2400, LP: 0, SI: 10, SA: 100, SI1: 5, SA1: 3, PK: 2, ...extra});
const state = (extra = {}, feedback = {}) => ({val: JSON.stringify({state: {reported: payload(extra)}}),
    ts: now, ack: true, q: 0, ...feedback});
const parse = (extra = {}, feedback = {}, opts = {}) => parseHeadSnapshot(state(extra, feedback),
    {now, maxAgeMs: 30000, index: 1, ...opts});
const head = (index, extra = {}) => ({...parse(extra), index});
const powers = result => result.commands.map(command => command.internalW);

test('standard adapter topology supports exactly one, two or three heads', () => {
    for (const count of [1, 2, 3]) {
        const topology = readTopology({batteryHeadCount: count, batterySunEnergyInstance: 'sunenergyxt500.3'});
        assert.equal(topology.valid, true);
        assert.equal(topology.heads.length, count);
        assert.equal(topology.heads[count - 1].setpointId, `sunenergyxt500.3.heads.${count}.control.GS`);
        assert.equal(topology.heads[count - 1].maxChargeW, 2400);
        assert.equal(topology.heads[count - 1].maxDischargeW, 800);
    }
    assert.equal(readTopology().count, 1);
    for (const count of [null, '', false, 0, 4, 1.5, 'wrong'])
        assert.equal(readTopology({batteryHeadCount: count}).valid, false);
    for (const instance of ['', 'other.0', 'sunenergyxt500.0.heads.1', 'sunenergyxt500.0;danger'])
        assert.equal(readTopology({batterySunEnergyInstance: instance}).valid, false);
    assert.equal(readTopology({batteryHead1MaxChargeW: -1}).valid, false);
    assert.equal(readTopology({batteryHead1MaxDischargeW: 2401}).valid, false);
    assert.equal(readTopology({batteryHead1MaxChargeW: 0}).valid, true);
});

test('snapshot reads coherent standard body with separate AC and command sign', () => {
    const snapshot = parse({GP: -600, GS: -800, SC: 42, ON: 2, SC0: 40, SC1: 44});
    assert.equal(snapshot.valid, true);
    assert.equal(snapshot.acPowerW, 600);
    assert.equal(snapshot.gsW, -800);
    assert.equal(snapshot.soc, 42);
    assert.equal(snapshot.minPackSoc, 40);
    assert.equal(snapshot.maxPackSoc, 44);
    assert.equal(snapshot.maxChargeW, 2400);
    assert.equal(snapshot.maxDischargeW, 2400);
    assert.equal(snapshot.sourceTs, now);
    assert.equal(parse({}, {val: JSON.stringify(payload())}).valid, true);
});

test('missing or invalid data is never a zero-watt/off proof', () => {
    for (const key of ['GP', 'GS', 'SC', 'MM', 'LM', 'ON', 'MG', 'IS', 'SI', 'SA', 'PK']) {
        const data = payload(); delete data[key];
        const result = parse({}, {val: JSON.stringify(data)});
        assert.equal(result.valid, false, key);
        assert.equal(result.acPowerW, undefined, key);
    }
    for (const value of [null, '', ' ', true, false, {}, [], 'NaN', 'Infinity']) {
        assert.equal(parse({GP: value}).valid, false, String(value));
        assert.equal(parse({SC: value}).valid, false, String(value));
    }
    for (const val of ['null', '[]', 'false', '{', JSON.stringify({state: {}}),
        JSON.stringify({reported: payload()}), ' '.repeat(524289)])
        assert.equal(parse({}, {val}).valid, false);
    assert.equal(parse({SC0: null}).valid, false);
    assert.equal(parse({SC0: 101}).valid, false);
});

test('raw freshness cannot be replaced by a global heartbeat or old constant states', () => {
    for (const feedback of [{ack: false}, {q: 0x20}, {q: null}, {ts: 0}, {ts: now + 1},
        {ts: now - 30001}, {ts: null}]) assert.equal(parse({}, feedback).valid, false);
    assert.equal(parse({}, {ts: now - 30000}).valid, true);
    assert.equal(parse({}, {}, {maxAgeMs: 0}).valid, false);
    for (const onlineState of [null, {val: false, ack: true}, {val: true, ack: false},
        {val: true, ack: true, q: 0x20}, {val: 1, ack: true}])
        assert.equal(parse({}, {}, {onlineState}).valid, false);
    // A changed-only online=true can be old; the fresh raw response is the proof.
    assert.equal(parse({}, {}, {onlineState: {val: true, ack: true, ts: 1}}).valid, true);
});

test('individual mode and model limits are proved rather than inferred from total', () => {
    assert.equal(parse({MM: 1}).valid, false);
    assert.equal(parse({LM: 0}).valid, false);
    assert.equal(parse({PK: 1, MG: 2400}).maxDischargeW, 800);
    assert.equal(parse({PK: 1, MG: 100}).maxChargeW, 2400);
    assert.equal(parse({MG: 800, IS: 600}).maxDischargeW, 600);
    assert.equal(parse({MG: 0}).maxDischargeW, 0);
    assert.equal(parse({PK: null, DevType: 'SunEnergyXT 500 PRO'}).maxDischargeW, 2400);
    assert.equal(parse({PK: null, DevType: 'SunEnergyXT 500'}).maxDischargeW, 800);
    assert.equal(parse({PK: null, DevType: 'unknown PRO'}).valid, false);
    assert.equal(parse({SI: null, SO: 20}).minSoc, 20);
    for (const data of [{ON: 0}, {ON: 7}, {ON: 1.5}, {SI: 100}, {SA: 9},
        {MG: -1}, {IS: null}, {SI1: null}, {SA1: -1}]) assert.equal(parse(data).valid, false);
});

test('one, two and three heads obey total sign and exact integer budget', () => {
    for (const count of [1, 2, 3]) {
        const heads = Array.from({length: count}, (_, i) => head(i + 1));
        for (const total of [0, 1, -1, 1000, -1000, 2000, -2000]) {
            const result = allocate(total, heads);
            assert.equal(result.valid, true);
            assert.equal(result.acceptedW, total);
            assert.equal(result.unallocatedW, 0);
            for (const command of result.commands) {
                assert.ok(Number.isInteger(command.internalW));
                assert.ok(Number.isInteger(command.gsW));
                assert.equal(command.gsW, command.internalW === 0 ? 0 : -command.internalW);
                assert.ok(total >= 0 ? command.internalW >= 0 : command.internalW <= 0);
            }
        }
    }
    assert.deepEqual(powers(allocate(1000, [head(1), head(2), head(3)])), [334, 333, 333]);
    assert.deepEqual(powers(allocate(0, [head(1), head(2)])), [0, 0]);
    assert.equal(allocate(1000.9, [head(1)]).acceptedW, 1000);
});

test('load port and grid discharge share the proved inverter output limit', () => {
    const withLoad = parse({LP: 1000, IS: 2400, MG: 2400});
    assert.equal(withLoad.valid, true);
    assert.equal(withLoad.loadPowerW, 1000);
    assert.equal(withLoad.maxDischargeW, 1400);
    assert.equal(allocate(-2000, [withLoad]).acceptedW, -1400);
    assert.equal(parse({LP: 1000, IS: 600}).maxDischargeW, 0);
    assert.equal(parse({PK: 1, LP: 1000, IS: 2400}).maxDischargeW, 800);
    for (const LP of [undefined, null, '', false, -1, 'Infinity', 3001]) {
        const unknown = parse({LP});
        assert.equal(unknown.valid, true);
        assert.equal(unknown.loadPowerW, null);
        assert.equal(unknown.dischargeReason, 'load-port-power-unknown');
        assert.equal(allocate(-1000, [unknown]).acceptedW, 0);
        assert.equal(allocate(1000, [unknown]).acceptedW, 1000);
    }
});

test('SOC weighting charges emptier heads and discharges fuller heads', () => {
    const heads = [head(1, {SC: 20}), head(2, {SC: 80})];
    assert.deepEqual(powers(allocate(1000, heads)), [800, 200]);
    assert.deepEqual(powers(allocate(-800, heads)), [-100, -700]);
    assert.equal(allocate(1000, heads).capacitySoc, 50);
    const capacities = [head(1, {SC: 50, ON: 1}), head(2, {SC: 50, ON: 2})];
    assert.deepEqual(powers(allocate(900, capacities)), [300, 600]);
    assert.deepEqual(powers(allocate(-900, capacities)), [-300, -600]);
    const mixed = [head(1, {SC: 20, ON: 1}), head(2, {SC: 80, ON: 2})];
    assert.equal(allocate(1, mixed).capacitySoc, 60);
});

test('SoC distances plus pack capacity converge different tower sizes', () => {
    let soc = [20, 80];
    const packs = [1, 2];
    for (let step = 0; step < 20; step++) {
        const heads = soc.map((SC, i) => head(i + 1, {SC, ON: packs[i]}));
        const distribution = allocate(1500, heads);
        const before = soc[1] - soc[0];
        soc = soc.map((value, i) => value + distribution.commands[i].internalW / (packs[i] * 10000));
        assert.ok(soc[1] - soc[0] < before);
    }
    assert.ok(soc[1] - soc[0] < 60);
});

test('saturated individual power redistributes while shared ceilings remain binding', () => {
    const heads = [{...head(1, {SC: 20}), maxChargeW: 200}, head(2, {SC: 80})];
    assert.deepEqual(powers(allocate(1200, heads)), [200, 1000]);
    assert.deepEqual(powers(allocate(1200, heads, {maxChargeW: 700})), [200, 500]);
    const discharge = [{...head(1), maxDischargeW: 100}, head(2)];
    assert.deepEqual(powers(allocate(-1000, discharge, {maxDischargeW: 600})), [-100, -500]);
    const bounded = allocate(10000, [head(1), head(2), head(3)]);
    assert.equal(bounded.acceptedW, 7200);
    assert.equal(bounded.unallocatedW, 2800);
});

test('each head obeys EMS, device and optional price/pack SoC bounds', () => {
    assert.deepEqual(powers(allocate(1000, [head(1, {SC: 100}), head(2)])), [0, 1000]);
    assert.deepEqual(powers(allocate(-1000, [head(1, {SC: 10}), head(2)])), [0, -1000]);
    assert.deepEqual(powers(allocate(-1000, [head(1, {SC: 20}), head(2)], {minSoc: 25})), [0, -1000]);
    assert.deepEqual(powers(allocate(-1000, [head(1, {SC: 30}), head(2)], {priceFloor: 35})), [0, -1000]);
    assert.equal(allocate(1000, [head(1, {SC: 85})], {maxSoc: 80}).acceptedW, 0);
    assert.equal(allocate(-1000, [head(1, {SC: 50, SC0: 10})]).acceptedW, 0);
    assert.equal(allocate(1000, [head(1, {SC: 50, SC0: 100})]).acceptedW, 0);
    assert.equal(allocate(-1000, [head(1, {SC: 14})], {resumingDischarge: new Set([1])}).acceptedW, 0);
    assert.equal(allocate(1000, [head(1, {SC: 98})], {resumingCharge: [1]}).acceptedW, 0);
});

test('an unknown configured head cannot be omitted and silently redistribute its retained power', () => {
    for (const heads of [[head(1), {index: 2, valid: false}], [head(1), head(1)], [],
        [head(1), head(2), head(3), head(4)], [{...head(1), maxChargeW: null}],
        [{...head(1), soc: null}], [{...head(1), packs: 0}]]) {
        const result = allocate(1000, heads);
        assert.equal(result.valid, false);
        assert.deepEqual(result.commands, []);
    }
    for (const value of [null, '', false, 'NaN', Infinity])
        assert.equal(allocate(value, [head(1)]).valid, false);
});

test('bounded enumeration keeps aggregate watt and direction invariants under saturation', () => {
    for (const count of [1, 2, 3]) for (const total of [-7201, -1501, -2, 0, 2, 1501, 7201]) {
        const heads = Array.from({length: count}, (_, i) => ({...head(i + 1, {SC: 15 + i * 40, ON: i + 1}),
            maxChargeW: 200 + i * 900, maxDischargeW: 100 + i * 500}));
        const result = allocate(total, heads, {maxChargeW: 2300, maxDischargeW: 1300});
        assert.equal(result.valid, true);
        assert.ok(Math.abs(result.acceptedW) <= Math.min(Math.abs(total), total >= 0 ? 2300 : 1300));
        assert.equal(result.acceptedW, result.commands.reduce((sum, command) => sum + command.internalW, 0));
        for (const command of result.commands) {
            assert.ok(Math.abs(command.internalW) <= command.limitW);
            assert.ok(total >= 0 ? command.internalW >= 0 : command.internalW <= 0);
        }
    }
});
