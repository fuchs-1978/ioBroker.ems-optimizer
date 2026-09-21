'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

const admin = JSON.parse(fs.readFileSync('admin/jsonConfig.json', 'utf8'));
const ioPackage = JSON.parse(fs.readFileSync('io-package.json', 'utf8'));
const packageJson = JSON.parse(fs.readFileSync('package.json', 'utf8'));
const tabs = admin.items;
const allFields = Object.assign({}, ...Object.values(tabs).map(tab => tab.items || {}));

test('AP2 admin exposes the shared source and house-connection fields', () => {
    for (const field of ['houseConnectionFuseA', 'houseConnectionReserveA', 'pvPowerId',
        'gridImportId', 'gridExportId', 'outsideTemperatureId', 'historyInstance', 'historyDays',
        'energyPriceSeriesId', 'gridFeeSeriesId', 'dynamicEnergyPriceEnabledId',
        'dynamicGridFeeEnabledId', 'wallboxMaxStepA', 'wallboxCombinedMaxStepA',
        'phaseSwitchLookAheadMin', 'phaseSwitchMinHoldMin', 'phaseSwitchTransitionS', 'wallboxPrioritySource',
        'wallboxPriorityId']) assert.ok(allFields[field], `missing Admin field ${field}`);
});

test('dynamic production phase feedback is configurable for every wallbox', () => {
    for (let wb = 0; wb < 3; wb++) {
        assert.ok(allFields[`wb${wb}PhaseModeId`], `missing wb${wb}PhaseModeId`);
        assert.equal(ioPackage.native[`wb${wb}PhaseModeId`], '');
    }
});

test('AP2 admin exposes all vehicle input mappings', () => {
    for (let wb = 0; wb < 3; wb++) for (const suffix of ['SocId', 'MinSocId', 'TargetSocId',
        'ReleaseId', 'UserAllowId', 'CarStateId', 'PhaseStateId', 'PowerId', 'L1CurrentId',
        'L2CurrentId', 'L3CurrentId', 'ManualMinCurrentId']) {
        assert.ok(allFields[`wb${wb}${suffix}`], `missing wb${wb}${suffix}`);
    }
});

test('update defaults never arm a productive output', () => {
    const native = ioPackage.native;
    assert.equal(native.globalWriteEnabled, false);
    assert.equal(native.multiWallboxAlphaArmed, false);
    assert.equal(native.combinedProductionArmed, false);
    assert.equal(native.dhwControlEnabled, false);
    for (let wb = 0; wb < 3; wb++) {
        assert.equal(native[`wb${wb}ControlEnabled`], false);
        assert.equal(native[`wb${wb}ProductionArmed`], false);
    }
});

test('package manifests publish the same alpha version', () => {
    assert.equal(packageJson.version, '0.17.0-alpha.13');
    assert.equal(ioPackage.common.version, packageJson.version);
});
