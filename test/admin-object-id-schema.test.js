'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const config = JSON.parse(fs.readFileSync(path.join(__dirname, '../admin/jsonConfig.json'), 'utf8'));
const official = require('./fixtures/admin-object-id-schema.json');

function collectFields(value, type = 'objectId', result = []) {
    if (!value || typeof value !== 'object') return result;
    if (value.type === type) result.push(value);
    for (const child of Object.values(value)) collectFields(child, type, result);
    return result;
}

// Check the exact property contracts from Admin, including nested customFilter
// objects and state displays. Common UI layout/label properties are delegated to the full schema;
// this targeted regression has no validator dependency or network access.
function checkProperties(value, schema, location) {
    if (schema === true) return;
    if (schema.$ref) return checkProperties(value,
        official.definitions[schema.$ref.split('/').pop()], location);
    if (schema.oneOf) {
        const matches = schema.oneOf.filter(candidate => {
            try { checkProperties(value, candidate, location); return true; }
            catch { return false; }
        });
        assert.equal(matches.length, 1, `${location}: no unique supported schema branch`);
        return;
    }
    if (schema.anyOf) {
        assert.ok(schema.anyOf.some(candidate => {
            try { checkProperties(value, candidate, location); return true; }
            catch { return false; }
        }), `${location}: no supported schema branch`);
        return;
    }
    if (schema.type) {
        const type = Array.isArray(value) ? 'array' : value === null ? 'null' : typeof value;
        assert.equal(type, schema.type, `${location}: expected ${schema.type}`);
    }
    if (schema.enum) assert.ok(schema.enum.includes(value), `${location}: unsupported value ${value}`);
    if (Object.hasOwn(schema, 'const')) assert.equal(value, schema.const, location);
    if (Array.isArray(value)) {
        if (schema.minItems) assert.ok(value.length >= schema.minItems, location);
        if (schema.maxItems) assert.ok(value.length <= schema.maxItems, location);
        if (schema.items) value.forEach((item, i) => checkProperties(item, schema.items, `${location}[${i}]`));
        return;
    }
    if (!value || typeof value !== 'object') return;
    for (const required of schema.required || []) assert.ok(Object.hasOwn(value, required), `${location}.${required}: required`);
    for (const [key, child] of Object.entries(value)) {
        const childSchema = schema.properties?.[key]
            ?? Object.entries(schema.patternProperties || {}).find(([pattern]) => new RegExp(pattern).test(key))?.[1];
        if (childSchema === undefined) {
            assert.notEqual(schema.additionalProperties, false, `${location}.${key}: unsupported Admin property`);
        } else checkProperties(child, childSchema, `${location}.${key}`);
    }
}

test('all object selectors follow the pinned official Admin objectId property contract', () => {
    const fields = collectFields(config);
    assert.ok(fields.length > 0);
    for (const [i, field] of fields.entries()) {
        checkProperties(field, official.definitions.objectIdProps, `objectId[${i}]`);
        if (field.filterFunc || field.customFilter)
            assert.ok(!Object.hasOwn(field, 'types'), 'Admin forbids types together with customFilter/filterFunc');
    }
});

test('all state displays follow the pinned official Admin state property contract', () => {
    const fields = collectFields(config, 'state');
    assert.ok(fields.length > 0);
    for (const [i, field] of fields.entries())
        checkProperties(field, official.definitions.stateProps, `state[${i}]`);
});

test('heat-pump status widgets only display internal states without write or save controls', () => {
    const fields = collectFields(config.items.heatPumpTab, 'state');
    const expected = [
        'PowerStatus', 'Power_W', 'SGReadyFeedbackState', 'SGReadyFeedbackStatus',
        'SGReadyRequestedState', 'SGReadyRecommendationValid', 'SGReadyRecommendationReason',
        'HeatingBoostRequested', 'CoolingBoostRequested', 'CoolingBoostReason', 'CoolingBoostValid',
    ].map(suffix => `Devices.HeatPump.${suffix}`);
    assert.deepEqual(fields.map(field => field.oid).sort(), expected.sort(),
        'all expected WP displays must reference the existing internal state contract');
    for (const field of fields) {
        assert.equal(field.control, 'text', field.oid);
        assert.equal(field.controlled, false, field.oid);
        assert.equal(field.doNotSave, true, field.oid);
        assert.equal(field.foreign ?? false, false, field.oid);
        assert.equal(field.system ?? false, false, field.oid);
        assert.ok(!Object.hasOwn(field, 'default') && !Object.hasOwn(field, 'defaultFunc'),
            `${field.oid}: unknown telemetry must not be replaced by an Admin default`);
    }
});

test('the official state schema rejects unsupported controls, missing IDs and unknown properties', () => {
    for (const invalid of [
        {type: 'state', control: 'text'},
        {type: 'state', oid: 'Devices.HeatPump.Power_W', control: 'readOnlyText'},
        {type: 'state', oid: 'Devices.HeatPump.Power_W', controlled: 'false'},
        {type: 'state', oid: 'Devices.HeatPump.Power_W', writable: false},
    ]) assert.throws(() => checkProperties(invalid, official.definitions.stateProps, 'state'));
});

test('the official schema rejects the former customFilter.common.write configuration', () => {
    assert.throws(() => checkProperties({type: 'state', common: {type: 'number', write: true}},
        official.definitions.customFilter, 'customFilter'), /common.write: unsupported Admin property/);
});

test('heating and battery selectors accept only writable numeric states', () => {
    const fields = Object.assign({}, ...Object.values(config.items).map(tab => tab.items || {}));
    for (const id of ['heatingSetpointId', 'batterySetpointId']) {
        const filter = new Function('obj', `return (${fields[id].filterFunc});`);
        assert.equal(filter({type: 'state', common: {type: 'number', write: true, unit: 'W'}}), true, id);
        for (const invalid of [
            {type: 'state', common: {type: 'number', write: false}},
            {type: 'state', common: {type: 'number'}},
            {type: 'state', common: {type: 'string', write: true}},
            {type: 'channel', common: {type: 'number', write: true}},
            {type: 'state'},
        ]) assert.equal(filter(invalid), false, `${id}: ${JSON.stringify(invalid)}`);
    }
});

test('temperature reserve selector accepts numeric telemetry without requiring a writable actuator', () => {
    const field = config.items.batteryTab.items.batteryTemperatureForecastId;
    assert.equal(field.default, '');
    assert.equal(field.type, 'objectId');
    assert.ok(!Object.hasOwn(field, 'types'));
    const filter = new Function('obj', `return (${field.filterFunc});`);
    assert.equal(filter({type: 'state', common: {type: 'number', read: true, write: false, unit: '°C'}}), true);
    for (const invalid of [
        {type: 'state', common: {type: 'boolean'}},
        {type: 'state', common: {type: 'string'}},
        {type: 'channel', common: {type: 'number'}},
        {type: 'state'},
    ]) assert.equal(filter(invalid), false);
});

test('temperature reserve displays are read-only and never substitute defaults for missing diagnosis', () => {
    const fields = collectFields(config.items.batteryTab, 'state');
    const expected = ['EffectiveMinimumSoC_pct', 'TemperatureReserveStatus', 'TemperatureReserveValid',
        'TemperatureReserveHeld', 'TemperatureForecast_C', 'TemperatureForecastAge_h',
        'TemperatureReservePeriod'].map(suffix => `Devices.Battery.${suffix}`);
    assert.deepEqual(fields.map(field => field.oid).sort(), expected.sort());
    for (const field of fields) {
        assert.equal(field.control, 'text', field.oid);
        assert.equal(field.controlled, false, field.oid);
        assert.equal(field.doNotSave, true, field.oid);
        assert.equal(field.foreign ?? false, false, field.oid);
        assert.equal(field.system ?? false, false, field.oid);
        assert.ok(!Object.hasOwn(field, 'default') && !Object.hasOwn(field, 'defaultFunc'), field.oid);
    }
});
