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

const {calculateEmsMinimum, binaryContactBudget, GZF_DEFAULTS} = require('../lib/grid-constraints');
const participants = n => Array.from({length: n}, (_, index) => ({name: `WB ${index}`, kind: 'wallbox', connectionPowerW: 11000}));

test('EMS minimum uses the fixed configured population and the complete GZF table including n>=9', () => {
    for (const [n, expected] of [[1,4200],[2,7560],[3,10500],[4,13020],[5,15120],
        [6,16800],[7,18060],[8,18900],[9,19320],[10,21210]]) {
        const result = calculateEmsMinimum({participants: participants(n)});
        assert.equal(result.valid, true); assert.equal(result.count, n); assert.equal(result.budgetW, expected);
    }
    assert.equal(binaryContactBudget({par14aBudgetMode:'ems', par14aParticipants:participants(3),
        wb0Connected:false, wb1Connected:false, wb2Connected:false}).budgetW, 10500);
});

test('WP/cooling are grouped electrically and only the larger >11 kW group determines the base', () => {
    const result = calculateEmsMinimum({participants: [...participants(2),
        {name:'WP1 incl heater', kind:'heatPump', connectionPowerW:9000},
        {name:'WP2 incl heater', kind:'heatPump', connectionPowerW:6000},
        {name:'Cooling1', kind:'cooling', connectionPowerW:12000},
        {name:'Cooling2', kind:'cooling', connectionPowerW:8000}]});
    assert.equal(result.count, 4); assert.equal(result.baseW, 8000);
    assert.equal(result.heatPumpConnectionW, 15000); assert.equal(result.coolingConnectionW, 20000);
    assert.equal(result.budgetW, 16820);
    assert.equal(calculateEmsMinimum({participants:[{name:'WP',kind:'heatPump',connectionPowerW:11000}]}).budgetW,4200);
    assert.equal(calculateEmsMinimum({participants:[{name:'WP',kind:'heatPump',connectionPowerW:12000}]}).budgetW,4800);
});

test('4.2 kW qualification is strict and small heat pumps group before counting; standalone heaters never count', () => {
    const result = calculateEmsMinimum({participants:[...participants(1),
        {name:'Small battery',kind:'storage',connectionPowerW:2500},
        {name:'Small WP1',kind:'heatPump',connectionPowerW:2500},
        {name:'Small WP2',kind:'heatPump',connectionPowerW:2500},
        {name:'4200',kind:'wallbox',connectionPowerW:4200}]});
    assert.equal(result.count,2); assert.equal(result.budgetW,7560); assert.equal(result.excluded.length,2);
    assert.equal(calculateEmsMinimum({participants:[{name:'EHZ',kind:'heater',connectionPowerW:9000}]}).valid,false);
});

test('malformed, duplicate and empty participant groups cannot create an active budget', () => {
    for(const rows of [[],null,[...participants(1),...participants(1)],
        [{name:'WP',kind:'heatPump',connectionPowerW:null}],
        [{name:'WP',kind:'heatPump',connectionPowerW:NaN}],
        [{name:'WP',kind:'heatPump',connectionPowerW:'12 kW'}]]) {
        const budget=binaryContactBudget({par14aBudgetMode:'ems',par14aParticipants:rows});
        assert.equal(budget.valid,false);
        assert.equal(evaluateConsumptionLimit({legacyConfigured:true,legacyActive:true,legacyBudget:budget}).budgetW,0);
    }
});

test('factor overrides require a complete bounded non-increasing table and are explicitly marked', () => {
    const table=GZF_DEFAULTS.map(row=>({...row})); table[1].factor=.74;
    const custom=calculateEmsMinimum({participants:participants(3),customFactors:table});
    assert.equal(custom.budgetW,10416); assert.equal(custom.factorSource,'custom-deviation');
    for(const invalid of [[],[...table.slice(0,7),table[0]],
        table.map(row=>({...row,factor:row.count===2?1.2:row.factor})),
        table.map(row=>({...row,factor:row.count===3?.9:row.factor}))]) {
        assert.equal(calculateEmsMinimum({participants:participants(3),customFactors:invalid}).valid,false);
    }
    assert.equal(binaryContactBudget({par14aBudgetMode:'ems',par14aParticipants:participants(3),
        par14aGzfFactors:table,par14aGzfOverrideEnabled:false}).budgetW,10500);
});

test('fixed migration and external budgets never receive an EMS GZF uplift; simultaneous LPC keeps the smaller value', () => {
    assert.equal(binaryContactBudget({}).budgetW,4200);
    assert.equal(binaryContactBudget({par14aLimitW:3500,par14aParticipants:participants(3)}).budgetW,3500);
    const ext=binaryContactBudget({par14aBudgetMode:'external',par14aLimitUnit:'kW'},7.56);
    assert.equal(ext.budgetW,7560);
    assert.equal(binaryContactBudget({par14aBudgetMode:'external'},null).valid,false);
    assert.equal(binaryContactBudget({par14aBudgetMode:'external',par14aLimitUnit:'A'},7).valid,false);
    const ems=binaryContactBudget({par14aBudgetMode:'ems',par14aParticipants:participants(3)});
    assert.equal(evaluateConsumptionLimit({legacyConfigured:true,legacyActive:true,legacyBudget:ems,
        lpcConfigured:true,lpcState:'limited',lpcLimitW:5000}).budgetW,5000);
    assert.equal(evaluateConsumptionLimit({legacyConfigured:true,legacyActive:false,legacyBudget:ems,
        lpcConfigured:true,lpcState:'limited',lpcLimitW:7000}).budgetW,7000);
    assert.equal(evaluateConsumptionLimit({legacyConfigured:true,legacyActive:false,
        legacyBudget:{valid:false,reason:'bad'},lpcConfigured:true,lpcState:'unlimitedControlled'}).active,false);
});

test('enabled but missing factor override fails closed instead of silently using standard values', () => {
    assert.equal(binaryContactBudget({par14aBudgetMode:'ems',par14aParticipants:participants(2),
        par14aGzfOverrideEnabled:true}).valid,false);
});
