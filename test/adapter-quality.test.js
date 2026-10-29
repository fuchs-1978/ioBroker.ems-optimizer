'use strict';
const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {adapterTimers} = require('../lib/adapter-timers');
const {checkLayout} = require('../tools/check-admin-layout');

test('ordinary timers use the real adapter owner and preserve arguments and cancellation', () => {
    const calls = [], handle = {};
    const owner = {
        setTimeout(callback, delay, ...args) {assert.equal(this, owner); calls.push({callback, delay, args}); return handle;},
        clearTimeout(timer) {assert.equal(this, owner); assert.equal(timer, handle); calls.push('clear');}
    };
    const timers = adapterTimers(owner), callback = () => {};
    assert.equal(timers.setTimeout(callback, 250, 'a', 2), handle);
    assert.deepEqual(calls[0], {callback, delay: 250, args: ['a', 2]});
    timers.clearTimeout(handle); assert.equal(calls[1], 'clear');
});
test('isolated timer fallback supports completion and cancellation without adapter I/O', async () => {
    const timers = adapterTimers({});
    let ran = false;
    const cancelled = timers.setTimeout(() => {ran = true;}, 1); timers.clearTimeout(cancelled);
    assert.equal(await new Promise(resolve => timers.setTimeout(resolve, 5, 'finished')), 'finished');
    assert.equal(ran, false);
});
test('complete Admin grid audit rejects missing, increasing and invalid widths but accepts table columns', () => {
    const field = {type: 'number', xs: 12, sm: 6, md: 4, lg: 4, xl: 4};
    assert.equal(checkLayout({items: {field}}).checked, 1);
    for (const bad of [{...field, sm: undefined}, {...field, md: 8}, {...field, xl: 0}, {...field, xs: 6}])
        assert.throws(() => checkLayout({items: {field: bad}}));
    assert.equal(checkLayout({items: {table: {...field, type: 'table', items: [{type: 'text', width: 100}]}}}).checked, 1);
    assert.equal(checkLayout(JSON.parse(fs.readFileSync(path.join(__dirname, '../admin/jsonConfig.json')))).checked, 540);
});
test('shared ioBroker lint configuration catches real errors, VM typos and unowned runtime timers', async () => {
    const {ESLint} = await import('eslint'); const lint = new ESLint();
    const codes = async (code, file) => (await lint.lintText(code, {filePath: file}))[0].messages.map(m => m.ruleId);
    assert.ok((await codes('missingDiagnosticFunction();', 'lib/lint-probe.js')).includes('no-undef'));
    assert.ok((await codes('module.exports = {same: 1, same: 2};', 'lib/lint-probe.js')).includes('no-dupe-keys'));
    assert.ok((await codes('setTimeout(() => {}, 1);', 'lib/lint-probe.js')).includes('no-restricted-syntax'));
    assert.deepEqual(await codes('log(CFG.root);', 'lib/engine/lint-probe.js'), []);
    assert.ok((await codes('log(MisspelledCFG.root);', 'lib/engine/lint-probe.js')).includes('no-undef'));
});
