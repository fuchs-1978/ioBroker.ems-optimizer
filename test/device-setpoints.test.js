'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const {chooseSetpoint} = require('../lib/device-setpoints');

const bounds = {min: 4, max: 5};

test('confirmed solar surplus cools within the configured bounds', () => {
    const state = {};
    const surplus = {gridW: 0, batteryW: 400, cheap: false};
    assert.equal(chooseSetpoint(bounds, state, surplus, 0), null);
    assert.equal(chooseSetpoint(bounds, state, surplus, 300000), 4);
});

test('battery discharge returns to max unless a cheap price window applies', () => {
    const state = {};
    const discharge = {gridW: -500, batteryW: -200, cheap: false};
    assert.equal(chooseSetpoint(bounds, state, discharge, 0), null);
    assert.equal(chooseSetpoint(bounds, state, discharge, 300000), 5);
    assert.equal(chooseSetpoint(bounds, state, {...discharge, cheap: true}, 300001), null);
    assert.equal(chooseSetpoint(bounds, state, {...discharge, cheap: true}, 600001), 4);
});
