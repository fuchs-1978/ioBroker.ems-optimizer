'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const {chooseSetpoint} = require('../lib/device-setpoints');

const config = {
    normal: 7, optimized: 5, enterW: -500, exitW: 0, enterMinutes: 10,
    exitMinutes: 10, priceObject: 'price', priceLimit: -40
};
const initial = () => ({coldSince: null, normalSince: null});

test('cheap price takes priority and ends immediately at nonnegative virtual grid power', () => {
    const state = initial();
    assert.equal(chooseSetpoint(config, state, 100, -40, 0), 5);
    assert.equal(chooseSetpoint(config, state, 100, -39, 1), 7);
});

test('PV-only transitions require uninterrupted threshold crossings', () => {
    const row = {...config, priceObject: ''};
    const state = initial();
    assert.equal(chooseSetpoint(row, state, -501, undefined, 0), null);
    assert.equal(chooseSetpoint(row, state, -500, undefined, 599999), null);
    assert.equal(chooseSetpoint(row, state, -501, undefined, 600000), null);
    assert.equal(chooseSetpoint(row, state, -501, undefined, 1200000), 5);
    assert.equal(chooseSetpoint(row, state, 0, undefined, 1200001), null);
    assert.equal(chooseSetpoint(row, state, 0, undefined, 1800001), 7);
});
