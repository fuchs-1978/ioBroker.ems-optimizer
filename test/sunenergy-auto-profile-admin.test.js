'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const fields = JSON.parse(fs.readFileSync('admin/jsonConfig.json', 'utf8')).items.batteryTab.items;
const native = JSON.parse(fs.readFileSync('io-package.json', 'utf8')).native;
const catalogs = Object.fromEntries(['en', 'de'].map(locale => [locale,
    JSON.parse(fs.readFileSync(`admin/i18n/${locale}/translations.json`, 'utf8'))]));
const hidden = (name, data) => new Function('data', `return (${fields[name].hidden});`)(data);

test('automatic capacity is explicit and never assumes a pack size or changes output gates', () => {
    assert.equal(native.batteryCapacitySource, 'manual');
    assert.equal(fields.batteryCapacitySource.default, native.batteryCapacitySource);
    assert.deepEqual(fields.batteryCapacitySource.options.map(item => item.value), ['manual', 'sunenergy-packs']);
    assert.equal(native.batteryPackCapacityKWh, 0);
    assert.equal(fields.batteryPackCapacityKWh.default, 0);
    assert.equal(fields.batteryPackCapacityKWh.unit, 'kWh');
    assert.equal(fields.batteryPackCapacityKWh.min, 0);
    for (const key of ['batteryPresent', 'batteryControlEnabled', 'batteryProductionArmed']) {
        assert.equal(native[key], false);
        assert.equal(fields[key].default, false);
    }
    assert.equal(native.batteryCapacityKWh, 10);
});

test('legacy mappings stay available in single-head mode while automatic head data hides duplicates', () => {
    for (const name of ['batterySocId', 'batteryPowerId', 'batteryPowerSign']) {
        assert.equal(hidden(name, {batteryDispatchMode: 'single-head'}), false);
        assert.equal(hidden(name, {batteryDispatchMode: 'sunenergy-heads'}), true);
    }
    for (const mode of ['single-head', undefined]) {
        assert.equal(hidden('batteryCapacitySource', {batteryDispatchMode: mode}), true);
        assert.equal(hidden('batteryPackCapacityKWh', {batteryDispatchMode: mode,
            batteryCapacitySource: 'sunenergy-packs'}), true);
        assert.equal(hidden('batteryCapacityKWh', {batteryDispatchMode: mode,
            batteryCapacitySource: 'sunenergy-packs'}), false);
    }
});

test('capacity source exposes only the applicable manual or confirmed pack-size input', () => {
    const base = {batteryDispatchMode: 'sunenergy-heads'};
    assert.equal(hidden('batteryCapacitySource', base), false);
    for (const source of ['manual', undefined]) {
        const data = {...base, batteryCapacitySource: source};
        assert.equal(hidden('batteryCapacityKWh', data), false);
        assert.equal(hidden('batteryPackCapacityKWh', data), true);
        assert.equal(hidden('_batterySunEnergyCapacityHelp', data), true);
    }
    const automatic = {...base, batteryCapacitySource: 'sunenergy-packs'};
    assert.equal(hidden('batteryCapacityKWh', automatic), true);
    assert.equal(hidden('batteryPackCapacityKWh', automatic), false);
    assert.equal(hidden('_batterySunEnergyCapacityHelp', automatic), false);
});

test('automatic profile guidance distinguishes online capacity, missing data and user policies', () => {
    assert.match(fields._batterySunEnergyProfileHelp.text, /coherent per-head responses/);
    assert.match(fields._batterySunEnergyProfileHelp.text, /User targets, permissions and additional power limits remain unchanged/);
    assert.match(fields._batterySunEnergyProfileHelp.text, /No dynamic BMS charge limit, efficiency or battery temperature is inferred/);
    assert.match(fields._batterySunEnergyCapacityHelp.text, /online pack count, not the nominal installed capacity/);
    assert.match(fields._batterySunEnergyCapacityHelp.text, /no default pack size is assumed/);
    assert.match(fields._batterySunEnergyCapacityHelp.text, /manual capacity is not used as a silent fallback/);
    for (const key of ['batteryMaxChargeW', 'batteryMaxDischargeW', 'batteryMinSocPct',
        'batteryMaxSocPct', 'batteryMorningTargetPct', 'batteryAfternoonTargetPct',
        'batteryLateTargetPct', 'batteryEfficiencyPct', 'batteryFaultId', 'batteryTemperatureId'])
        assert.equal(fields[key].hidden, undefined, `${key}: independent policy or guard must remain editable`);
});

test('all new auto-profile labels, choices and guidance resolve in both language catalogs', () => {
    for (const name of ['batteryCapacitySource', 'batteryPackCapacityKWh',
        '_batterySunEnergyCapacityHelp', '_batterySunEnergyProfileHelp']) {
        const field = fields[name];
        for (const key of [field.label, field.text, field.help,
            ...(field.options || []).map(option => option.label)].filter(Boolean)) {
            assert.equal(catalogs.en[key], key, `English: ${key}`);
            assert.ok(catalogs.de[key]?.trim(), `German: ${key}`);
        }
    }
});
