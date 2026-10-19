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
        'phaseSwitchLookAheadMin', 'phaseSwitchMinHoldMin', 'phaseSwitchTransitionS', 'wallboxStopDelayS', 'wallboxPrioritySource',
        'wallboxPriorityId']) assert.ok(allFields[field], `missing Admin field ${field}`);
});

test('dynamic production phase feedback is configurable for every wallbox', () => {
    for (let wb = 0; wb < 3; wb++) {
        assert.ok(allFields[`wb${wb}PhaseModeId`], `missing wb${wb}PhaseModeId`);
        assert.equal(ioPackage.native[`wb${wb}PhaseModeId`], '');
        assert.equal(ioPackage.native[`wb${wb}PhaseControlMode`], 'script');
        assert.deepEqual(allFields[`wb${wb}PhaseControlMode`].options.map(option => option.value), ['script', 'ems']);
    }
    assert.equal(allFields.wallboxPhaseSwitchTimeoutS.default, ioPackage.native.wallboxPhaseSwitchTimeoutS);
});

test('measured phase decision delays expose bounded defaults and translated guidance', () => {
    const translations = ['de', 'en'].map(locale =>
        JSON.parse(fs.readFileSync(`admin/i18n/${locale}/translations.json`, 'utf8')));
    for (const [name, defaultS, minS, maxS] of [
        ['phaseSwitchRealDownDelayS', 120, 15, 900],
        ['phaseSwitchRealUpDelayS', 300, 30, 1800],
    ]) {
        const field = allFields[name];
        assert.equal(ioPackage.native[name], defaultS);
        assert.equal(field.type, 'number');
        assert.equal(field.unit, 's');
        assert.equal(field.default, defaultS);
        assert.equal(field.min, minS);
        assert.equal(field.max, maxS);
        for (const text of [field.label, field.help]) {
            assert.ok(text);
            for (const locale of translations) assert.ok(locale[text], `missing translation: ${text}`);
        }
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
    assert.equal(native.batteryControlEnabled, false);
    assert.equal(native.batteryProductionArmed, false);
    assert.equal(native.heatingControlEnabled, false);
    assert.equal(native.heatingProductionArmed, false);
    assert.equal(native.heatPumpAdviceEnabled, false);
    for (let wb = 0; wb < 3; wb++) {
        assert.equal(native[`wb${wb}ControlEnabled`], false);
        assert.equal(native[`wb${wb}ProductionArmed`], false);
    }
});

test('package manifests publish the same alpha version', () => {
    assert.equal(packageJson.version, '0.17.0-alpha.99');
    assert.equal(ioPackage.common.version, packageJson.version);
    const core = fs.readFileSync('lib/engine/core.js', 'utf8');
    const bootstrap = fs.readFileSync('lib/engine/bootstrap.js', 'utf8');
    assert.ok(core.includes("stateDef(`${r}.System.Version`, '" + packageJson.version + "'"));
    assert.ok(bootstrap.includes("write(`${CFG.root}.System.Version`, '" + packageJson.version + "'"));
});

test('optional BHKW inputs default disabled and expose explicit energy units', () => {
    for (const field of ['bhkwPresent', 'bhkwPowerId', 'bhkwEnergyId', 'bhkwEnergyUnit',
        'bhkwPowerMaxAgeS', 'bhkwEnergyMaxAgeS']) {
        assert.ok(allFields[field]); assert.equal(allFields[field].default, ioPackage.native[field]);
    }
    assert.equal(ioPackage.native.bhkwPresent, false);
    assert.deepEqual(allFields.bhkwEnergyUnit.options.map(option => option.value), ['kWh', 'Wh', 'J']);
});


// Parallel mode changes allocation, never the independent production gates.
test('parallel wallbox mode exposes translated native default and mode-dependent priority', () => {
    const field = allFields.wallboxParallelChargingEnabled;
    assert.equal(field.type, 'checkbox');
    assert.equal(field.default, true);
    assert.equal(ioPackage.native.wallboxParallelChargingEnabled, true);
    for (const lang of ['de', 'en']) {
        const translations = JSON.parse(fs.readFileSync(`admin/i18n/${lang}/translations.json`, 'utf8'));
        for (const key of [field.label, field.help, allFields.wallboxPriority.help])
            assert.ok(translations[key], `${lang}: missing translation ${key}`);
    }
    assert.match(allFields.wallboxPriority.help, /after the minimum-SoC reservations/);
    assert.match(allFields.wallboxPriority.help, /In sequential mode/);
    assert.match(field.help, /does not enable Master Control or arm outputs/);
});




test('shared PV step tolerance has bounded matching defaults and translated hysteresis guidance', () => {
    const field = allFields.wallboxPVImportToleranceW;
    assert.equal(field.default, 50);
    assert.equal(ioPackage.native.wallboxPVImportToleranceW, 50);
    assert.equal(field.min, 0); assert.equal(field.max, 200); assert.equal(field.unit, 'W');
    for (const locale of ['de', 'en']) {
        const texts = JSON.parse(fs.readFileSync(`admin/i18n/${locale}/translations.json`, 'utf8'));
        assert.ok(texts[field.label]); assert.ok(texts[field.help]);
    }
});

test('grid tab exposes opt-in EMS GZF sources and preserves existing keys and fixed migration', () => {
    const fields=tabs.gridConnectionTab.items;
    assert.ok(fields.par14aId && fields.lpcStateId && fields.lpcLimitId && fields.houseConnectionFuseA);
    assert.equal(ioPackage.native.par14aBudgetMode,'fixed');
    assert.deepEqual(ioPackage.native.par14aParticipants,[]);
    assert.equal(ioPackage.native.par14aGzfOverrideEnabled,false);
    assert.equal(ioPackage.native.par14aLimitW,4200);
    assert.deepEqual(fields.par14aBudgetMode.options.map(row=>row.value),['fixed','ems','external']);
    assert.deepEqual(ioPackage.native.par14aGzfFactors.map(row=>row.count),[2,3,4,5,6,7,8,9]);
    for(const locale of ['de','en']) {
        const texts=JSON.parse(fs.readFileSync(`admin/i18n/${locale}/translations.json`,'utf8'));
        assert.ok(texts[tabs.gridConnectionTab.label]);
        for(const key of ['par14aBudgetMode','par14aParticipants','par14aLimitId','par14aGzfFactors'])
            assert.ok(texts[fields[key].label]);
    }
});


test('each vehicle exposes opt-in energy estimation with safe defaults and translated fields', () => {
    const fs=require('node:fs'),path=require('node:path');
    const config=JSON.parse(fs.readFileSync(path.join(__dirname,'../admin/jsonConfig.json')));
    const native=JSON.parse(fs.readFileSync(path.join(__dirname,'../io-package.json'))).native;
    for(const wb of [0,1,2]) {
        const items=config.items[`wallbox${wb}Tab`].items;
        assert.equal(native[`wb${wb}SocEstimationEnabled`],false);
        assert.equal(native[`wb${wb}SocEnergyId`],'');
        assert.equal(native[`wb${wb}SocEfficiencyPct`],90);
        for(const suffix of ['SocEstimationEnabled','SocEnergyId','SocEfficiencyPct','SocMeasurementTimeId']) {
            assert.ok(items[`wb${wb}${suffix}`]);
            for(const lang of ['de','en']) {
                const translations=JSON.parse(fs.readFileSync(path.join(__dirname,`../admin/i18n/${lang}/translations.json`)));
                assert.ok(translations[items[`wb${wb}${suffix}`].label]);
            }
        }
    }
});
