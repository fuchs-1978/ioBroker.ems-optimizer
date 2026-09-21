'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const {buildNativeMapping, houseConnectionSettings} = require('../lib/native-mapping');

test('explicit AP2 fields override legacy JSON while untouched keys survive migration', () => {
    const mapping = buildNativeMapping({
        dataPointMapJson: JSON.stringify({DP_PV_POWER: 'legacy.pv', DP_CUSTOM: 'keep.me',
            DP_WB0_TARGET: 'legacy.target'}),
        pvPowerId: 'admin.pv', wb0TargetSocId: 'admin.target', outsideTemperatureId: 'admin.outside'
    });
    assert.equal(mapping.DP_PV_POWER, 'admin.pv');
    assert.equal(mapping.DP_WB0_TARGET, 'admin.target');
    assert.equal(mapping.DP_OUTSIDE_TEMP, 'admin.outside');
    assert.equal(mapping.DP_CUSTOM, 'keep.me');
});

test('blank explicit AP2 fields keep legacy mappings', () => {
    const mapping = buildNativeMapping({
        dataPointMapJson: JSON.stringify({DP_GRID_IMPORT: 'legacy.import'}), gridImportId: '   '
    });
    assert.equal(mapping.DP_GRID_IMPORT, 'legacy.import');
});

test('invalid legacy JSON is diagnosed but explicit fields still work', () => {
    const errors = [];
    const mapping = buildNativeMapping({dataPointMapJson: '{', pvPowerId: 'admin.pv'},
        message => errors.push(message));
    assert.equal(mapping.DP_PV_POWER, 'admin.pv');
    assert.equal(errors.length, 1);
});

test('central house-connection settings derive one working limit', () => {
    assert.deepEqual(houseConnectionSettings({houseConnectionFuseA: 50,
        houseConnectionReserveA: 4}), {fuseA: 50, reserveA: 4, increaseLimitA: 46});
    assert.deepEqual(houseConnectionSettings({wallboxHaLimitA: 63,
        wallboxHaIncreaseLimitA: 58}), {fuseA: 63, reserveA: 5, increaseLimitA: 58});
});
