'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function fixture(config = {}) {
    let now = Date.parse('2026-10-01T00:00:00Z');
    const states = new Map();
    const nativeConfig = {wb0PhaseControlMode: 'ems', wb0SocLimitsSource: 'admin',
        wb0MinSocPct: 0, wb0TargetSocPct: 80, ...config};
    const put = (id, val, extra = {}) => states.set(id, {val, ts: now, ack: true, q: 0, ...extra});
    const own = (suffix, value) => put(`ems.0.${suffix}`, value);
    let context;
    const boot = () => {
        class Clock extends Date {
            constructor(...args) { super(...(args.length ? args : [now])); }
            static now() { return now; }
        }
        context = vm.createContext({nativeConfig, Date: Clock,
            getState: id => states.get(id), existsState: id => states.has(id),
            setState: put, createState: (id, value) => { if (!states.has(id)) put(id, value); }, log() {}});
        for (const file of ['core', 'vehicles', 'config-mapping']) {
            const source = fs.readFileSync(path.join(__dirname, '../lib/engine', `${file}.js`), 'utf8')
                .replaceAll('__ADAPTER_ROOT__', 'ems.0').replace(/__([A-Z0-9_]+)__/g, (_, name) => name);
            vm.runInContext(source, context);
        }
        vm.runInContext('createStates()', context);
    };
    boot();
    own('Devices.Wallbox0.Present', true);
    own('Config.WallboxPlanWithoutSoC', false);
    own('Config.PriceChargingHorizon_h', 24);
    own('Config.Wallbox0PriceChargingEnabled', true);
    own('Config.Wallbox0PriceEnergy_kWh', 0.12);
    own('Config.Wallbox0PriceMax_ct_kWh', 0);
    own('Config.Wallbox0VehicleCapacity_kWh', 50);
    own('Config.VehicleChargingEfficiency_pct', 80);
    own('Vehicles.Wallbox0.DepartureTime', '');
    put('DP_WB0_CAR', 2); put('DP_WB0_SOC', null); put('DP_WB0_ALLOW', true);
    put('DP_WB0_RELEASE', 1); put('DP_WB0_POWER', 3.6);
    const run = source => vm.runInContext(source, context);
    return {states, own, put, run, boot, now: () => now,
        advance: seconds => { now += seconds * 1000; },
        update: () => run('updateVehicles(); vehicleState(0)'),
        vehicle: () => run('vehicleState(0)'),
        value: suffix => states.get(`ems.0.Vehicles.Wallbox0.${suffix}`)?.val,
        sample: (seconds, power = 3.6) => { now += seconds * 1000; put('DP_WB0_POWER', power); }};
}

test('manual no-SoC AC quota is consumed by real charging including PV, never by repeated evaluations', () => {
    const h = fixture();
    const initial = h.update();
    assert.equal(initial.priceSessionValid, true);
    assert.equal(initial.release, true, 'explicit manual price quota works without unlimited no-SoC PV planning');
    assert.equal(initial.priceRemainingKWh, 0.12);
    for (let i = 1; i <= 4; i++) {
        h.sample(30);
        const vehicle = h.vehicle();
        assert.ok(Math.abs(vehicle.priceChargedEnergyKWh - i * 0.03) < 1e-12);
        for (let repeat = 0; repeat < 8; repeat++) h.update();
        assert.ok(Math.abs(h.value('PriceChargedEnergy_kWh') - i * 0.03) < 1e-12);
    }
    assert.equal(h.vehicle().priceRemainingKWh, 0);
    assert.equal(h.vehicle().release, false);
    assert.match(h.value('PriceSessionStatus'), /verbraucht/);
    h.own('Config.WallboxPlanWithoutSoC', true);
    assert.equal(h.update().release, true, 'existing PV-only permission is independent of spent grid quota');
    assert.equal(h.vehicle().priceRemainingKWh, 0);
});

test('restart and inconsistent diagnostic mirrors cannot renew an already consumed energy budget', () => {
    const h = fixture(); h.update(); h.sample(30); h.vehicle();
    const id = h.value('PriceSessionId'), deadline = h.value('PriceDeadlineTimestamp');
    // A crash may persist diagnostic mirrors at a different time. The atomic
    // record, not this stale mirror combination, is authoritative on restart.
    h.own('Vehicles.Wallbox0.PriceChargedEnergy_kWh', 0);
    h.own('Vehicles.Wallbox0.PriceLastMeasurementAt', 0);
    h.boot();
    assert.ok(Math.abs(h.update().priceRemainingKWh - 0.09) < 1e-12);
    assert.equal(h.value('PriceSessionId'), id);
    assert.equal(h.value('PriceDeadlineTimestamp'), deadline);
    h.sample(30); h.update();
    assert.ok(Math.abs(h.vehicle().priceRemainingKWh - 0.06) < 1e-12);
});

test('only an observed disconnect/reconnect creates a new plug quota; invalid car status does not', () => {
    const h = fixture(); h.update(); h.sample(30); h.vehicle();
    const id = h.value('PriceSessionId');
    h.put('DP_WB0_CAR', 1, {ack: false});
    assert.equal(h.update().priceSessionValid, false);
    h.put('DP_WB0_CAR', 2);
    assert.equal(h.update().priceSessionId, id);
    assert.ok(Math.abs(h.vehicle().priceRemainingKWh - 0.09) < 1e-12);
    h.put('DP_WB0_CAR', 1);
    assert.equal(h.update().priceRemainingKWh, 0);
    h.sample(1, 0); h.put('DP_WB0_CAR', 2);
    const reconnected = h.update();
    assert.notEqual(reconnected.priceSessionId, id);
    assert.equal(reconnected.priceRemainingKWh, 0.12);
    assert.equal(reconnected.priceChargedEnergyKWh, 0);
});

test('first opt-in starts a fresh measurement baseline; toggling enabled later cannot refill it', () => {
    const h = fixture(); h.own('Config.Wallbox0PriceChargingEnabled', false);
    h.update(); assert.equal(h.value('PriceSessionId'), '');
    h.sample(7200, 0); h.update();
    h.own('Config.Wallbox0PriceChargingEnabled', true);
    const first = h.update();
    assert.equal(first.priceSessionValid, true);
    assert.equal(first.priceRemainingKWh, 0.12);
    h.sample(30, 3.6); h.update();
    const before = h.value('PriceRemainingEnergy_kWh');
    h.own('Config.Wallbox0PriceChargingEnabled', false);
    assert.equal(h.update().priceRemainingKWh, 0);
    h.own('Config.Wallbox0PriceChargingEnabled', true);
    assert.equal(h.update().priceSessionId, first.priceSessionId);
    assert.equal(h.vehicle().priceRemainingKWh, before);
    assert.equal(h.vehicle().priceDeadlineTimestamp, h.now() + 48 * 3600000);
});

test('missing, stale and bad-quality real power cannot authorize unbounded no-SoC grid charging', () => {
    for (const extra of [{val: null}, {ack: false}, {q: 64}, {ts: 0}, {ts: Date.parse('2026-09-30T23:50:00Z')}]) {
        const h = fixture(); h.put('DP_WB0_POWER', 3.6, extra);
        assert.equal(h.update().priceSessionValid, false, JSON.stringify(extra));
        assert.equal(h.vehicle().priceRemainingKWh, 0);
        assert.equal(h.vehicle().release, false);
    }
    const noQuota = fixture(); noQuota.own('Config.Wallbox0PriceEnergy_kWh', 0);
    assert.equal(noQuota.update().priceSessionValid, false);
    assert.equal(noQuota.vehicle().priceRemainingKWh, 0);
});

test('long unmeasured gaps latch a no-SoC accounting fault across restart until a new plug session', () => {
    const h = fixture(); h.update();
    h.sample(61, 0);
    assert.equal(h.update().priceSessionValid, false);
    assert.match(h.value('PriceSessionStatus'), /Luecke/);
    h.boot(); h.sample(1, 0);
    assert.equal(h.update().priceSessionValid, false);
    h.put('DP_WB0_CAR', 1); h.update();
    h.sample(1, 0); h.put('DP_WB0_CAR', 2);
    assert.equal(h.update().priceSessionValid, true);
});

test('fresh SoC derives AC remaining energy from the live target and efficiency independently of manual quota', () => {
    const h = fixture(); h.put('DP_WB0_SOC', 40);
    assert.equal(h.update().priceRemainingKWh, 25);
    h.put('DP_WB0_SOC', 64);
    assert.equal(h.vehicle().priceRemainingKWh, 10, 'fast reads use the new actual SoC before the next vehicle update');
    h.put('DP_WB0_SOC', 80);
    assert.equal(h.vehicle().priceRemainingKWh, 0);
    h.put('DP_WB0_SOC', null);
    assert.equal(h.vehicle().priceSessionValid, false, 'a known-SoC session cannot fall back to a manual allowance');
    assert.match(h.value('PriceSessionStatus'), /kein Wechsel/);
});

test('unchanged SoC cannot refill measured energy on repeated replanning or restart, and estimated target stops PV too', () => {
    const h = fixture(); h.put('DP_WB0_SOC', 79);
    assert.equal(h.update().priceRemainingKWh, 0.625);
    const session = h.value('PriceSessionId');
    for (let i = 0; i < 11; i++) { h.sample(30); h.update(); }
    assert.ok(Math.abs(h.vehicle().priceRemainingKWh - 0.295) < 1e-10);
    h.boot(); h.update(); h.update();
    assert.equal(h.value('PriceSessionId'), session);
    assert.ok(Math.abs(h.vehicle().priceRemainingKWh - 0.295) < 1e-10);
    for (let i = 0; i < 10; i++) { h.sample(30); h.update(); }
    assert.equal(h.vehicle().priceRemainingKWh, 0);
    assert.equal(h.vehicle().release, false, 'estimated target also stops discretionary PV charging');
    h.put('DP_WB0_SOC', 79.5);
    assert.equal(h.update().priceRemainingKWh, 0.3125, 'new actual SoC accounts for consumed energy and rebases remaining');
    assert.equal(h.vehicle().release, true);
});

test('a known-SoC session requires fresh measured power and recovers an accounting gap only from a new actual SoC sample', () => {
    const h = fixture(); h.put('DP_WB0_SOC', 40); h.update();
    h.sample(61);
    assert.equal(h.update().priceSessionValid, false, 'old retained SoC cannot conceal an energy gap');
    h.put('DP_WB0_SOC', 41);
    assert.equal(h.update().priceSessionValid, true);
    assert.ok(Math.abs(h.vehicle().priceRemainingKWh - 24.375) < 1e-10);
    h.states.delete('DP_WB0_POWER');
    assert.equal(h.vehicle().priceSessionValid, false);
    assert.equal(h.vehicle().priceRemainingKWh, 0);
});

test('flexible PV planning rolls across 24 hours independently of the configured price purchase horizon', () => {
    const h = fixture(); h.put('DP_WB0_SOC', 40); h.own('Config.PriceChargingHorizon_h', 6);
    const start = h.update();
    assert.equal(start.priceDeadlineMode, 'flexible');
    assert.equal(start.priceDeadlineTimestamp, h.now() + 48 * 3600000);
    h.sample(25 * 3600, 0); h.put('DP_WB0_SOC', 40);
    const next = h.update();
    assert.equal(next.priceSessionValid, true);
    assert.equal(next.priceDeadlineTimestamp, h.now() + 48 * 3600000);
    assert.equal(next.priceSessionId, start.priceSessionId);
    assert.equal(h.value('PriceSessionStartedAt'), Number(start.priceSessionId.split(':')[1]));
    h.boot();
    assert.equal(h.update().priceSessionId, start.priceSessionId);
    assert.equal(h.vehicle().priceDeadlineTimestamp, next.priceDeadlineTimestamp);
});

test('real departure remains fixed after expiry, repeated forecasts and restart', () => {
    const departure = fixture({wb0DeadlineEnabled: true});
    departure.own('Vehicles.Wallbox0.DepartureTime', '06:00'); departure.put('DP_WB0_SOC', 40);
    const first = departure.update();
    assert.equal(first.priceDeadlineMode, 'departure');
    assert.equal(first.priceDeadlineTimestamp, departure.value('DepartureTimestamp'));
    departure.sample(86400, 0); departure.put('DP_WB0_SOC', 40);
    assert.equal(departure.update().priceDeadlineTimestamp, first.priceDeadlineTimestamp);
    assert.equal(departure.vehicle().priceSessionValid, false);
    assert.match(departure.value('PriceSessionStatus'), /abgelaufen/);
    departure.boot();
    assert.equal(departure.update().priceDeadlineTimestamp, first.priceDeadlineTimestamp);
    assert.equal(departure.vehicle().priceSessionId, first.priceSessionId);
    assert.equal(departure.vehicle().priceSessionValid, false);
});

test('alpha.25 implicit deadline migrates after restart while retaining measured energy and the SoC anchor', () => {
    const h = fixture(); h.put('DP_WB0_SOC', 79); h.update(); h.sample(30); h.update();
    const legacy = JSON.parse(h.value('PriceSessionLedger_JSON'));
    delete legacy.PriceDeadlineMode;
    legacy.PriceDeadlineTimestamp = legacy.PriceSessionStartedAt + 24 * 3600000;
    h.own('Vehicles.Wallbox0.PriceSessionLedger_JSON', JSON.stringify(legacy));
    h.boot();
    const migrated = h.update();
    assert.equal(migrated.priceSessionId, legacy.PriceSessionId);
    assert.equal(migrated.priceDeadlineMode, 'flexible');
    assert.equal(migrated.priceDeadlineTimestamp, h.now() + 48 * 3600000);
    assert.ok(Math.abs(migrated.priceRemainingKWh - 0.595) < 1e-12);
    for (const key of ['PriceSessionStartedAt', 'PriceChargedEnergy_kWh', 'PriceLastMeasurementAt',
        'PriceSoCSampleAt', 'PriceSoCSample_pct', 'PriceEnergyAtSoCSample_kWh', 'PriceEnergyTrackingValid'])
        assert.equal(h.value(key), legacy[key], key);
});

test('flexible migration does not refill a spent manual quota or heal its tracking fault', () => {
    const h = fixture(); h.update();
    for (let i = 0; i < 4; i++) { h.sample(30); h.update(); }
    const legacy = JSON.parse(h.value('PriceSessionLedger_JSON'));
    delete legacy.PriceDeadlineMode;
    legacy.PriceDeadlineTimestamp = legacy.PriceSessionStartedAt + 24 * 3600000;
    h.own('Vehicles.Wallbox0.PriceSessionLedger_JSON', JSON.stringify(legacy));
    h.boot();
    assert.equal(h.update().priceRemainingKWh, 0);
    assert.equal(h.vehicle().priceSessionId, legacy.PriceSessionId);
    assert.equal(h.vehicle().priceChargedEnergyKWh, legacy.PriceChargedEnergy_kWh);
    h.sample(25 * 3600, 0);
    assert.equal(h.update().priceSessionValid, false);
    assert.match(h.value('PriceSessionStatus'), /Luecke/);
    assert.equal(h.vehicle().priceDeadlineTimestamp, h.now() + 48 * 3600000);
    const failedLegacy = JSON.parse(h.value('PriceSessionLedger_JSON'));
    delete failedLegacy.PriceDeadlineMode;
    failedLegacy.PriceDeadlineTimestamp = failedLegacy.PriceSessionStartedAt + 24 * 3600000;
    h.own('Vehicles.Wallbox0.PriceSessionLedger_JSON', JSON.stringify(failedLegacy));
    h.boot(); h.sample(1, 0);
    assert.equal(h.update().priceSessionValid, false);
    assert.equal(h.value('PriceEnergyTrackingValid'), false);
    assert.equal(h.vehicle().priceDeadlineMode, 'flexible');
    assert.equal(h.vehicle().priceSessionId, legacy.PriceSessionId);
    assert.equal(h.vehicle().priceChargedEnergyKWh, legacy.PriceChargedEnergy_kWh);
    assert.equal(h.vehicle().priceRemainingKWh, 0);
});

test('enabling or disabling a real departure changes only the planning boundary, not the plug energy budget', () => {
    const h = fixture(); h.update(); h.sample(30); h.update();
    const before = h.vehicle();
    h.own('Vehicles.Wallbox0.DepartureTime', '06:00');
    h.run('nativeConfig.wb0DeadlineEnabled = true');
    const fixed = h.update();
    assert.equal(fixed.priceDeadlineMode, 'departure');
    assert.equal(fixed.priceDeadlineTimestamp, h.value('DepartureTimestamp'));
    assert.equal(fixed.priceSessionId, before.priceSessionId);
    assert.equal(fixed.priceRemainingKWh, before.priceRemainingKWh);
    assert.equal(fixed.priceChargedEnergyKWh, before.priceChargedEnergyKWh);
    h.run('nativeConfig.wb0DeadlineEnabled = false');
    const flexible = h.update();
    assert.equal(flexible.priceDeadlineMode, 'flexible');
    assert.equal(flexible.priceDeadlineTimestamp, h.now() + 48 * 3600000);
    assert.equal(flexible.priceSessionId, before.priceSessionId);
    assert.equal(flexible.priceRemainingKWh, before.priceRemainingKWh);
    assert.equal(flexible.priceChargedEnergyKWh, before.priceChargedEnergyKWh);
});

test('legacy enabled departure keeps its original fixed deadline during migration', () => {
    const h = fixture({wb0DeadlineEnabled: true});
    h.own('Vehicles.Wallbox0.DepartureTime', '06:00'); h.put('DP_WB0_SOC', 40); h.update();
    const legacy = JSON.parse(h.value('PriceSessionLedger_JSON'));
    delete legacy.PriceDeadlineMode;
    h.own('Vehicles.Wallbox0.PriceSessionLedger_JSON', JSON.stringify(legacy));
    h.sample(25 * 3600, 0); h.put('DP_WB0_SOC', 40); h.boot();
    assert.equal(h.update().priceDeadlineTimestamp, legacy.PriceDeadlineTimestamp);
    assert.equal(h.vehicle().priceSessionId, legacy.PriceSessionId);
    assert.equal(h.vehicle().priceDeadlineMode, 'departure');
    assert.equal(h.vehicle().priceSessionValid, false);
});

test('an enabled departure with missing or malformed time cannot silently use a flexible deadline', () => {
    for (const time of ['', 'invalid', '24:00', '12:60']) {
        const h = fixture({wb0DeadlineEnabled: true});
        h.own('Vehicles.Wallbox0.DepartureTime', time);
        assert.equal(h.update().priceSessionValid, false, time);
        assert.equal(h.vehicle().priceDeadlineTimestamp, 0, time);
        assert.match(h.value('PriceSessionStatus'), /Abfahrt fehlt\/ungueltig/, time);
    }
    const h = fixture(); h.update(); h.sample(30); h.update();
    const before = h.vehicle();
    h.run('nativeConfig.wb0DeadlineEnabled = true');
    assert.equal(h.update().priceSessionValid, false);
    assert.equal(h.vehicle().priceSessionId, before.priceSessionId);
    assert.equal(h.vehicle().priceChargedEnergyKWh, before.priceChargedEnergyKWh);
    h.own('Vehicles.Wallbox0.DepartureTime', '06:00');
    assert.equal(h.update().priceSessionValid, true);
    assert.equal(h.vehicle().priceRemainingKWh, before.priceRemainingKWh);
});

test('corrupt persisted session accounting fails closed instead of silently assigning another quota', () => {
    const h = fixture(); h.update();
    h.own('Vehicles.Wallbox0.PriceSessionLedger_JSON', '{broken');
    assert.equal(h.update().priceSessionValid, false);
    assert.equal(h.vehicle().priceRemainingKWh, 0);
});
