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
    assert.equal(h.vehicle().priceDeadlineTimestamp, first.priceDeadlineTimestamp);
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

test('fixed horizon and optional departure deadline do not roll forward after repeated forecasts or restart', () => {
    const h = fixture(); h.put('DP_WB0_SOC', 40); h.own('Config.PriceChargingHorizon_h', 6);
    const start = h.update();
    assert.equal(start.priceDeadlineTimestamp, h.now() + 6 * 3600000);
    h.advance(6 * 3600 + 1); h.put('DP_WB0_SOC', 40);
    assert.equal(h.update().priceSessionValid, false);
    assert.equal(h.vehicle().priceDeadlineTimestamp, start.priceDeadlineTimestamp);
    assert.match(h.value('PriceSessionStatus'), /abgelaufen/);
    h.boot(); assert.equal(h.update().priceSessionId, start.priceSessionId);
    const departure = fixture({wb0DeadlineEnabled: true});
    departure.own('Vehicles.Wallbox0.DepartureTime', '06:00'); departure.put('DP_WB0_SOC', 40);
    const first = departure.update();
    assert.equal(first.priceDeadlineTimestamp, departure.value('DepartureTimestamp'));
    departure.advance(86400); departure.put('DP_WB0_SOC', 40);
    assert.equal(departure.update().priceDeadlineTimestamp, first.priceDeadlineTimestamp);
    assert.equal(departure.vehicle().priceSessionValid, false);
});

test('corrupt persisted session accounting fails closed instead of silently assigning another quota', () => {
    const h = fixture(); h.update();
    h.own('Vehicles.Wallbox0.PriceSessionLedger_JSON', '{broken');
    assert.equal(h.update().priceSessionValid, false);
    assert.equal(h.vehicle().priceRemainingKWh, 0);
});
