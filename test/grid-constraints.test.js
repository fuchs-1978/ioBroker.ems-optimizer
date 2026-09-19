'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {evaluateConsumptionLimit, netImportCurrentA} = require('../lib/grid-constraints');

test('unlimited LPC states do not impose a budget', () => {
    for (const lpcState of ['unlimitedAutonomous', 'unlimitedControlled']) {
        const result = evaluateConsumptionLimit({lpcConfigured: true, lpcState});
        assert.equal(result.valid, true);
        assert.equal(result.active, false);
        assert.equal(result.budgetW, null);
    }
});

test('limited LPC state supplies the binding shared consumption budget', () => {
    const result = evaluateConsumptionLimit({lpcConfigured: true, lpcState: 'limited', lpcLimitW: 4200});
    assert.deepEqual(result, {valid: true, active: true, budgetW: 4200,
        reason: 'LPC 4200 W begrenzt'});
});

test('binary contact supplies its configured fixed budget without LPC', () => {
    const result = evaluateConsumptionLimit({legacyConfigured: true, legacyActive: true,
        legacyLimitW: 4200});
    assert.deepEqual(result, {valid: true, active: true, budgetW: 4200,
        reason: '§14a-Binaerkontakt 4200 W begrenzt'});
    assert.equal(evaluateConsumptionLimit({legacyConfigured: true, legacyActive: false}).active, false);
});

test('binary contact and LPC automatically use the stricter active limit', () => {
    assert.equal(evaluateConsumptionLimit({legacyConfigured: true, legacyActive: true,
        legacyLimitW: 4200, lpcConfigured: true, lpcState: 'unlimitedAutonomous'}).budgetW, 4200);
    assert.equal(evaluateConsumptionLimit({legacyConfigured: true, legacyActive: false,
        lpcConfigured: true, lpcState: 'limited', lpcLimitW: 3500}).budgetW, 3500);
    const both = evaluateConsumptionLimit({legacyConfigured: true, legacyActive: true,
        legacyLimitW: 4200, lpcConfigured: true, lpcState: 'limited', lpcLimitW: 3000});
    assert.equal(both.budgetW, 3000);
    assert.match(both.reason, /wirksam 3000 W/);
});

test('missing and invalid grid-operator signals fail closed', () => {
    assert.equal(evaluateConsumptionLimit({lpcConfigured: true, lpcState: 'limited'}).valid, false);
    assert.equal(evaluateConsumptionLimit({lpcConfigured: true, lpcState: 'failsafe'}).budgetW, 0);
    assert.equal(evaluateConsumptionLimit({legacyConfigured: true, legacyActive: null}).valid, false);
    assert.equal(evaluateConsumptionLimit({legacyConfigured: true, legacyActive: true,
        legacyLimitW: -1}).valid, false);
});

test('phase current keeps import and export direction', () => {
    assert.equal(netImportCurrentA(4600, 0), 20);
    assert.equal(netImportCurrentA(0, 4600), -20);
    assert.equal(netImportCurrentA(null, 0), null);
});
