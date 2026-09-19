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
    const result = evaluateConsumptionLimit({legacyConfigured: true, legacyActive: true,
        lpcConfigured: true, lpcState: 'limited', lpcLimitW: 4200});
    assert.deepEqual(result, {valid: true, active: true, budgetW: 4200,
        reason: 'LPC begrenzt auf 4200 W'});
});

test('missing, invalid and conflicting grid-operator signals fail closed', () => {
    assert.equal(evaluateConsumptionLimit({lpcConfigured: true, lpcState: 'limited'}).valid, false);
    assert.equal(evaluateConsumptionLimit({lpcConfigured: true, lpcState: 'failsafe'}).budgetW, 0);
    assert.equal(evaluateConsumptionLimit({legacyConfigured: true, legacyActive: true}).valid, false);
    assert.equal(evaluateConsumptionLimit({legacyConfigured: true, legacyActive: true,
        lpcConfigured: true, lpcState: 'unlimitedAutonomous'}).valid, false);
});

test('phase current keeps import and export direction', () => {
    assert.equal(netImportCurrentA(4600, 0), 20);
    assert.equal(netImportCurrentA(0, 4600), -20);
    assert.equal(netImportCurrentA(null, 0), null);
});
