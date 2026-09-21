'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const {shouldPreserveWallboxOnUnload} = require('../lib/unload-policy');

test('active owned wallbox is preserved for enabled-instance restart/update', () => {
    assert.equal(shouldPreserveWallboxOnUnload(
        {wallboxRestartHandoffEnabled: true}, {common: {enabled: true}}, true), true);
});

test('disabled, deleted or inactive instance never keeps a wallbox running', () => {
    assert.equal(shouldPreserveWallboxOnUnload({}, {common: {enabled: false}}, true), false);
    assert.equal(shouldPreserveWallboxOnUnload({}, null, true), false);
    assert.equal(shouldPreserveWallboxOnUnload({}, {common: {enabled: true}}, false), false);
    assert.equal(shouldPreserveWallboxOnUnload(
        {wallboxRestartHandoffEnabled: false}, {common: {enabled: true}}, true), false);
});
