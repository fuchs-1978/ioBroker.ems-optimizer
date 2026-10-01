'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

const admin = JSON.parse(fs.readFileSync('admin/jsonConfig.json', 'utf8'));
const native = JSON.parse(fs.readFileSync('io-package.json', 'utf8')).native;
const fields = admin.items.pricesTab.items;
const values = field => fields[field].options.map(option => option.value);
const hidden = (field, data) => fields[field].hidden
    ? Function('data', `return Boolean(${fields[field].hidden});`)(data)
    : false;

test('tariff controls have native defaults, explicit price basis and compatible external sources', () => {
    for (const [name, field] of Object.entries(fields)) {
        if (!Object.hasOwn(field, 'default')) continue;
        assert.ok(Object.hasOwn(native, name), `${name} must persist in native settings`);
        assert.deepEqual(field.default, native[name], `${name} default differs between Admin and adapter`);
        if (field.type === 'select') assert.ok(values(name).includes(native[name]), `${name} default is not selectable`);
    }
    assert.equal(native.gridFeeSource, 'external');
    assert.equal(native.energyPriceSource, 'external');
    assert.equal(native.priceInputBasis, 'gross');
    assert.equal(native.energyPriceSeriesBasis, 'gross');
    assert.equal(native.fixedTariffMode, 'components');
    assert.equal(native.dynamicEnergyPrice, false);
    assert.equal(native.dynamicGridFee, false);
    assert.deepEqual(values('gridFeeSource'), ['external', 'schedule']);
    assert.deepEqual(values('energyPriceSource'), ['external', 'energy-charts']);
    for (const name of ['priceInputBasis', 'energyPriceSeriesBasis', 'gridTariffBasis']) {
        assert.deepEqual(values(name), ['gross', 'net']);
    }
    assert.equal(fields.gridTariffRules.type, 'table');
    assert.deepEqual(fields.gridTariffRules.items.map(column => column.attr), ['quarter', 'from', 'to', 'level']);
    assert.equal(native.gridTariffBasis, 'gross');
    assert.equal(native.gridTariffStandardCt, 7.19);
    assert.equal(native.gridTariffHighCt, 10.01);
    assert.equal(native.gridTariffLowCt, 0.71);
    assert.equal(native.referenceGridFeeCt, native.gridTariffStandardCt);
});

test('preloaded annual example covers every quarter-hour exactly once, including 16:30 and midnight', () => {
    const minutes = value => {
        assert.match(value, /^(?:[01]\d|2[0-3]):(?:00|15|30|45)$|^24:00$/);
        const [hour, minute] = value.split(':').map(Number);
        return hour * 60 + minute;
    };
    const tariffAt = (quarter, minute) => {
        const matches = native.gridTariffRules.filter(row => row.quarter === quarter &&
            minutes(row.from) <= minute && minute < minutes(row.to));
        assert.equal(matches.length, 1, `Q${quarter} minute ${minute} must have one tariff`);
        return matches[0].level;
    };
    for (const row of native.gridTariffRules) {
        assert.ok([1, 2, 3, 4].includes(row.quarter));
        assert.ok(['low', 'standard', 'high'].includes(row.level));
        assert.ok(minutes(row.from) < minutes(row.to));
    }
    for (let quarter = 1; quarter <= 4; quarter++) {
        for (let minute = 0; minute < 1440; minute += 15) tariffAt(quarter, minute);
        if (quarter === 2 || quarter === 3) {
            assert.equal(tariffAt(quarter, 0), 'standard');
            assert.equal(tariffAt(quarter, 990), 'standard');
            assert.equal(tariffAt(quarter, 1425), 'standard');
        } else {
            for (const [minute, expected] of [[0, 'low'], [285, 'low'], [300, 'standard'],
                [975, 'standard'], [990, 'high'], [1245, 'high'], [1260, 'standard'],
                [1365, 'standard'], [1380, 'low'], [1425, 'low']]) {
                assert.equal(tariffAt(quarter, minute), expected);
            }
        }
    }
});

test('source selection shows annual input fields or external mappings, with independent exchange basis', () => {
    const legacy = { ...native };
    assert.equal(hidden('gridFeeSeriesId', legacy), false);
    assert.equal(hidden('energyPriceSeriesId', legacy), false);
    assert.equal(hidden('energyPriceSeriesBasis', legacy), false);
    assert.equal(hidden('_directExchangeHelp', legacy), true);
    const schedule = { ...legacy, gridFeeSource: 'schedule', energyPriceSource: 'energy-charts' };
    assert.equal(hidden('gridFeeSeriesId', schedule), true);
    for (const name of ['gridTariffYear', 'gridTariffBasis', 'gridTariffStandardCt',
        'gridTariffHighCt', 'gridTariffLowCt', 'gridTariffRules']) {
        assert.equal(hidden(name, legacy), true, `${name} irrelevant for external mode`);
        assert.equal(hidden(name, schedule), false, `${name} required for annual tariff`);
    }
    assert.equal(hidden('energyPriceSeriesId', schedule), true);
    assert.equal(hidden('energyPriceSeriesBasis', schedule), true);
    assert.equal(hidden('_directExchangeHelp', schedule), false);
    // Source configuration must remain accessible with an external enable switch.
    assert.equal(hidden('gridTariffRules', { ...schedule, dynamicGridFee: false,
        dynamicGridFeeEnabledId: 'test.0.enabled' }), false);
});

test('total contract price requires deliberate entry and hides only the component it replaces', () => {
    assert.equal(native.fixedTotalPriceCt, 0);
    const components = { ...native };
    const total = { ...native, fixedTariffMode: 'total' };
    assert.equal(hidden('fixedEnergyCt', components), false);
    assert.equal(hidden('fixedTotalPriceCt', components), true);
    assert.equal(hidden('referenceGridFeeCt', components), true);
    assert.equal(hidden('fixedEnergyCt', total), true);
    assert.equal(hidden('fixedTotalPriceCt', total), false);
    assert.equal(hidden('referenceGridFeeCt', total), false);
    assert.equal(hidden('fixedGridFeeCt', total), false);
    const valid = data => Function('data', `return ${fields.fixedTotalPriceCt.validator};`)(data);
    assert.equal(valid(total), false);
    assert.equal(valid({ ...total, fixedTotalPriceCt: 30 }), true);
    assert.equal(valid(components), true);
});
