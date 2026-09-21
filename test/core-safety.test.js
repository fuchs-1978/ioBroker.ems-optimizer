'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');

function engine() {
    const states = new Map();
    const context = vm.createContext({nativeConfig: {}, Date,
        getState: id => states.get(id), existsState: id => states.has(id)});
    for (const file of ['core', 'forecast', 'planner']) {
        vm.runInContext(fs.readFileSync(path.join(__dirname, '../lib/engine', `${file}.js`), 'utf8'), context);
    }
    return {states, run: source => vm.runInContext(source, context)};
}

test('required live measurements reject null, empty, boolean and non-numeric values', () => {
    const h = engine();
    for (const value of [null, undefined, '', '   ', true, false, {}, [], NaN, Infinity]) {
        h.states.set('sensor', {val: value, ts: Date.now(), q: 0});
        const result = h.run('(() => { const invalid = []; const value = readFreshNumber("sensor", invalid); return {invalid, value}; })()');
        assert.equal(result.invalid.length, 1, `accepted ${String(value)}`);
        assert.equal(result.value, 0);
        assert.equal(h.run('freshOptionalNumber("sensor", 30000)'), null);
        assert.equal(h.run('readOptionalNumber("sensor")'), null);
    }
});

test('real zero and numeric strings remain valid live measurements', () => {
    const h = engine();
    for (const [value, expected] of [[0, 0], ['0', 0], [' 230.5 ', 230.5], [-10, -10]]) {
        h.states.set('sensor', {val: value, ts: Date.now(), q: 0});
        const result = h.run('(() => { const invalid = []; const value = readFreshNumber("sensor", invalid); return {invalid, value}; })()');
        assert.equal(result.invalid.length, 0);
        assert.equal(result.value, expected);
        assert.equal(h.run('freshOptionalNumber("sensor", 30000)'), expected);
    }
});

test('unavailable-quality and invalid-clock sensor samples cannot be considered fresh', () => {
    const h = engine();
    for (const overrides of [{q: 0x82}, {ts: null}, {ts: 'invalid'}, {ts: 0},
        {ts: Date.now() + 60000}, {ts: Date.now() - 180000}]) {
        h.states.set('sensor', {val: 1000, ts: Date.now(), q: 0, ...overrides});
        const result = h.run('(() => { const invalid = []; readFreshNumber("sensor", invalid); return invalid; })()');
        assert.equal(result.length, 1);
        assert.equal(h.run('freshOptionalNumber("sensor", 30000)'), null);
    }
});

test('numeric fallback rejects missing values without changing legacy boolean releases', () => {
    const h = engine();
    for (const value of [null, undefined, '', ' ', {}, []]) {
        h.states.set('sensor', {val: value});
        assert.equal(h.run('readNumber("sensor", 46)'), 46);
    }
    h.states.set('sensor', {val: false});
    assert.equal(h.run('readNumber("sensor", 1)'), 0);
    h.states.set('sensor', {val: true});
    assert.equal(h.run('readNumber("sensor", 0)'), 1);
});

test('missing dynamic prices are not mistaken for free electricity', () => {
    const h = engine();
    for (const value of [null, undefined, '', false]) {
        h.states.set('price', {val: value});
        assert.equal(h.run('seriesValueAt([{ts: 3600000, val: getState("price").val}], 3600000)'), null);
    }
    assert.equal(h.run('seriesValueAt([{ts: 3600000, val: 0}], 3600000)'), 0);
});
