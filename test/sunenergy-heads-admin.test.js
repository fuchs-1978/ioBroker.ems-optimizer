'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const admin = JSON.parse(fs.readFileSync('admin/jsonConfig.json', 'utf8'));
const fields = admin.items.batteryTab.items;
const native = JSON.parse(fs.readFileSync('io-package.json', 'utf8')).native;
const catalogs = ['en', 'de'].map(locale =>
    JSON.parse(fs.readFileSync(`admin/i18n/${locale}/translations.json`, 'utf8')));
const hidden = (field, data) => new Function('data', `return (${field.hidden});`)(data);

test('multi-head dispatch remains opt-in and never enables a battery output on update', () => {
    assert.equal(fields.batteryDispatchMode.default, 'single-head');
    assert.equal(native.batteryDispatchMode, 'single-head');
    assert.deepEqual(fields.batteryDispatchMode.options.map(option => option.value),
        ['single-head', 'sunenergy-heads']);
    assert.equal(native.batterySunEnergyInstance, 'sunenergyxt500.0');
    assert.equal(native.batteryHeadCount, 1);
    for (const gate of ['batteryPresent', 'batteryControlEnabled', 'batteryProductionArmed'])
        assert.equal(native[gate], false);
});

test('one, two or three heads show only the corresponding limits and preserve total limits', () => {
    assert.equal(fields.batteryHeadCount.min, 1);
    assert.equal(fields.batteryHeadCount.max, 3);
    assert.equal(fields.batteryHeadCount.step, 1);
    for (let count = 1; count <= 3; count++) {
        const data = {batteryDispatchMode: 'sunenergy-heads', batteryHeadCount: count};
        for (let head = 1; head <= 3; head++) {
            assert.equal(hidden(fields[`_batteryHead${head}Header`], data), head > count);
            for (const [suffix, defaultW] of [['Charge', 2400], ['Discharge', 800]]) {
                const name = `batteryHead${head}Max${suffix}W`;
                assert.equal(fields[name].default, native[name]);
                assert.equal(native[name], defaultW);
                assert.equal(fields[name].min, 0);
                assert.equal(hidden(fields[name], data), head > count);
                assert.equal(hidden(fields[name], {batteryDispatchMode: 'single-head', batteryHeadCount: 3}), true);
            }
        }
    }
    for (const name of ['batteryMaxChargeW', 'batteryMaxDischargeW'])
        assert.equal(fields[name].hidden, undefined);
    assert.equal(hidden(fields.batteryCapacityKWh, {batteryDispatchMode: 'sunenergy-heads',
        batteryCapacitySource: 'manual'}), false);
});

test('automatic head telemetry hides conflicting legacy actuator mappings only in the new mode', () => {
    for (const name of ['batterySetpointId', 'batteryAcPowerId', 'batteryHeartbeatId',
        'batteryOnlineId', 'batteryManualModeId', 'batteryLocalModeId',
        'batterySocId', 'batteryPowerId', 'batteryPowerSign']) {
        assert.equal(hidden(fields[name], {batteryDispatchMode: 'sunenergy-heads'}), true);
        assert.equal(hidden(fields[name], {batteryDispatchMode: 'single-head'}), false);
    }
    for (const name of ['batteryFaultId', 'batteryTemperatureId'])
        assert.equal(fields[name].hidden, undefined, `${name}: applied optional guard must remain configurable`);
    assert.match(fields._batterySunEnergyHeadsHelp.text, /control mode to Off/);
    assert.match(fields._batterySunEnergyHeadsHelp.text, /LM=1.*MM=0/);
    assert.match(fields._batterySunEnergyHeadsHelp.text, /Acknowledged GS alone is not physical power feedback/);
    assert.match(fields._batterySunEnergyBalanceHelp.text, /reported ON pack count/);
});

test('multi-head visible labels and guidance have English keys and full German translations', () => {
    for (const [name, field] of Object.entries(fields)) {
        if (!name.startsWith('batteryHead') && !name.startsWith('_batteryHead') &&
            !name.startsWith('_batterySunEnergy') && !['batteryDispatchMode', 'batterySunEnergyInstance'].includes(name)) continue;
        for (const key of [field.label, field.text, field.help,
            ...(field.options || []).map(option => option.label)].filter(Boolean)) {
            assert.equal(catalogs[0][key], key, `English key: ${key}`);
            assert.ok(catalogs[1][key]?.trim(), `German translation: ${key}`);
        }
    }
});
