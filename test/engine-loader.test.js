'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const {createEngineContext} = require('../lib/engine-loader');
const {buildNativeMapping} = require('../lib/native-mapping');

const now = 2000000;

function gridSource(id) {
    const states = new Map([[id, {val: 1250, ack: true, ts: now}],
        ['mqtt.0.export', {val: 50, ack: true, ts: now}]]);
    const config = {gridImportId: id, gridExportId: 'mqtt.0.export'};
    const context = createEngineContext('ems.0', buildNativeMapping(config), {
        Date: class extends Date {static now() {return now;}}, nativeConfig: config,
        getState: key => states.get(key), existsState: key => states.has(key)
    });
    return {context, states, measurement: () => vm.runInContext('realtimeGridMeasurement()', context)};
}

// The loader serializes mapping values into single-quoted engine source. Its
// boundary must also preserve quote/backslash values, independent of ID validation.
for (const [name, id] of [
    ['ordinary ID', 'mqtt.0.grid'],
    ['matched-token replacement sequence', 'mqtt.0.grid.$&'],
    ['dollar replacement sequence', 'mqtt.0.grid.$$'],
    ['source-prefix replacement sequence', 'mqtt.0.grid.$`'],
    ['source-suffix replacement sequence', "mqtt.0.grid.$'"],
    ['quote and backslash escaping', "mqtt.0.grid.'quoted\\path"],
    ['combined replacement sequences and escaping', "mqtt.0.grid.$&$$$`$'\\tail"]
]) {
    test(`production loader preserves literal grid source: ${name}`, () => {
        const h = gridSource(id);
        assert.equal(vm.runInContext('CFG.dp.gridImport', h.context), id);
        const result = h.measurement();
        assert.equal(result.valid, true);
        assert.equal(result.gridW, 1200);
        assert.deepEqual(Array.from(result.invalid), []);
    });
}

test('literal source mapping retains measurement quality and age validation', () => {
    const id = 'mqtt.0.grid.$&';
    const h = gridSource(id);
    assert.equal(h.measurement().valid, true);
    h.states.set(id, {val: 1250, ack: true, ts: now, q: 64});
    assert.equal(h.measurement().valid, false);
    assert.deepEqual(Array.from(h.measurement().invalid), [`${id}: ungültig`]);
    h.states.set(id, {val: 1250, ack: true, ts: now - 3600000});
    assert.equal(h.measurement().valid, false);
    assert.deepEqual(Array.from(h.measurement().invalid), [`${id}: veraltet`]);
});
