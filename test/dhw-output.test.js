'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const context = vm.createContext({Math, gridConstraints: require('../lib/grid-constraints')});
vm.runInContext(fs.readFileSync(
    path.join(__dirname, '../lib/engine/dhw-output.js'), 'utf8'), context);
const command = expression => vm.runInContext(expression, context);

function phaseLimit(direction) {
    const now = Date.now();
    const states = new Map();
    const put = (id, val) => states.set(id, {val, ts: now, ack: true});
    ['o1', 'o2', 'o3'].forEach(id => put(id, 0));
    ['h1', 'h2', 'h3'].forEach(id => put(id, 49));
    if (direction) {
        ['pi1', 'pi2', 'pi3'].forEach(id => put(id, direction === 'import' ? 11270 : 0));
        ['pe1', 'pe2', 'pe3'].forEach(id => put(id, direction === 'export' ? 11270 : 0));
    }
    const ctx = vm.createContext({Math, Date, gridConstraints: require('../lib/grid-constraints'),
        CFG: {root: 'ems.0', dataMaxAgeMs: 120000, dp: {
            myPvDhwHaCurrentA: ['h1','h2','h3'], myPvDhwOutputW: ['o1','o2','o3'],
            haPhaseImportW: direction ? ['pi1','pi2','pi3'] : [],
            haPhaseExportW: direction ? ['pe1','pe2','pe3'] : []}},
        existsState: id => states.has(id), getState: id => states.get(id),
        readNumber: (id, fallback) => id === 'ems.0.Config.DHWHouseConnectionLimit_A' ? 50 : fallback});
    vm.runInContext(fs.readFileSync(path.join(__dirname, '../lib/engine/dhw-output.js'), 'utf8'), ctx);
    return vm.runInContext('phaseLimitedDhwPower(3000)', ctx);
}

test('combined EHZ relinquishes a reduced allocation immediately', () => {
    assert.equal(command('limitedDhwCommand(3000, 5000, 3000, 0, 5000)'), 3000);
    assert.equal(command('limitedDhwCommand(3000, 5000, 3000, 200, 4800)'), 3000);
});

test('normal EHZ fine regulation still respects its configured ramp', () => {
    assert.equal(command('limitedDhwCommand(6000, 3000, 6000, 500, 5000)'), 3500);
    assert.equal(command('limitedDhwCommand(6000, 3000, 6000, 500, 1000)'), 2500);
});

test('EHZ house-connection limit distinguishes phase export from import', () => {
    assert.equal(phaseLimit(null), 230);
    assert.equal(phaseLimit('import'), 230);
    assert.equal(phaseLimit('export'), 3000);
});
