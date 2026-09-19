'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const context = vm.createContext({Math});
vm.runInContext(fs.readFileSync(
    path.join(__dirname, '../lib/engine/dhw-output.js'), 'utf8'), context);
const command = expression => vm.runInContext(expression, context);

test('combined EHZ relinquishes a reduced allocation immediately', () => {
    assert.equal(command('limitedDhwCommand(3000, 5000, 3000, 0, 5000)'), 3000);
    assert.equal(command('limitedDhwCommand(3000, 5000, 3000, 200, 4800)'), 3000);
});

test('normal EHZ fine regulation still respects its configured ramp', () => {
    assert.equal(command('limitedDhwCommand(6000, 3000, 6000, 500, 5000)'), 3500);
    assert.equal(command('limitedDhwCommand(6000, 3000, 6000, 500, 1000)'), 2500);
});
