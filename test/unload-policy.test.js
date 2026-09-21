'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const {shouldPreserveWallboxOnUnload} = require('../lib/unload-policy');

const active = {wallboxRestartHandoffEnabled: true, globalWriteEnabled: true,
    controlEnabled: true, wb2Present: true, wb2ControlEnabled: true,
    wb2ProductionArmed: true, wb2AllowOutputId: 'allow', wb2AmpereOutputId: 'amp'};
const instance = native => ({common: {enabled: true}, native});

test('active owned wallbox is preserved for enabled-instance restart/update', () => {
    assert.equal(shouldPreserveWallboxOnUnload(
        active, instance({...active}), true, [2]), true);
});

for (const [name, change] of [
    ['master disabled', {globalWriteEnabled: false}],
    ['controller disabled', {controlEnabled: false}],
    ['device disabled', {wb2ControlEnabled: false}],
    ['production disarmed', {wb2ProductionArmed: false}],
    ['device removed', {wb2Present: false}],
    ['handoff disabled', {wallboxRestartHandoffEnabled: false}],
    ['allow mapping changed', {wb2AllowOutputId: 'another-allow'}],
    ['phase mode changed', {wb2PhaseSwitchEnabled: true}],
    ['multiple outputs without alpha permission', {wb0Present: true, wb0ControlEnabled: true}]
]) test(`Admin save ${name} stops instead of preserving old ownership`, () => {
    assert.equal(shouldPreserveWallboxOnUnload(active,
        instance({...active, ...change}), true, [2]), false);
});

test('missing new native configuration never preserves a charge', () => {
    assert.equal(shouldPreserveWallboxOnUnload(active, {common: {enabled: true}}, true, [2]), false);
});

test('disabled, deleted or inactive instance never keeps a wallbox running', () => {
    assert.equal(shouldPreserveWallboxOnUnload({}, {common: {enabled: false}}, true), false);
    assert.equal(shouldPreserveWallboxOnUnload({}, null, true), false);
    assert.equal(shouldPreserveWallboxOnUnload({}, {common: {enabled: true}}, false), false);
    assert.equal(shouldPreserveWallboxOnUnload(
        {wallboxRestartHandoffEnabled: false}, {common: {enabled: true}}, true), false);
});
