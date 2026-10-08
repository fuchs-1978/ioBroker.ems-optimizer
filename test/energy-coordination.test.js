'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function engine(parallel = true) {
    const now = 1000000;
    class Clock extends Date { static now() { return now; } }
    const states = new Map();
    const put = (id, val, extra = {}) => states.set(id, {val, ack: true, q: 0, ts: now, ...extra});
    const nativeConfig = {wallboxParallelChargingEnabled: parallel,
        wb0AllowOutputId: 'raw.allow0', wb1AllowOutputId: 'raw.allow1', wb2AllowOutputId: 'raw.allow2'};
    const context = vm.createContext({nativeConfig, Date: Clock,
        clamp: (value, low, high) => Math.max(low, Math.min(high, value)),
        getState: id => states.get(id), existsState: id => states.has(id),
        setState: put, createState: () => {}, log: () => {}});
    const run = expression => vm.runInContext(expression, context);
    for (const file of ['core', 'config-mapping', 'vehicles', 'dhw-controller', 'energy-coordination'])
        run(fs.readFileSync(path.join(__dirname, '../lib/engine', `${file}.js`), 'utf8')
            .replaceAll('__ADAPTER_ROOT__', 'ems.0').replace(/__([A-Z0-9_]+)__/g, (_, key) => key));
    put('ems.0.Config.WallboxParallelChargingEnabled', parallel);
    put('ems.0.Config.WallboxNominalVoltage_V', 230);
    for (let p = 1; p <= 3; p++) put(`DP_DHW_OUTPUT${p}`, 0);
    for (let wb = 0; wb < 3; wb++) {
        const base = `ems.0.Devices.Wallbox${wb}`;
        put(`${base}.Present`, wb === 0 || wb === 1);
        put(`${base}.OutputOwned`, wb === 0); put(`${base}.OutputActive`, wb === 0);
        put(`${base}.OutputCommand_A`, wb === 0 ? 6 : 0);
        put(`${base}.OutputReservedPower_W`, wb === 0 ? 1380 : 0); put(`${base}.OutputPhases`, 1);
        put(`raw.allow${wb}`, wb === 0 ? 1 : 0); put(`DP_WB${wb}_CAR`, wb === 0 ? 2 : 1);
        put(`DP_WB${wb}_POWER`, wb === 0 ? 1.380 : 0);
        for (let p = 1; p <= 3; p++) put(`DP_WB${wb}_L${p}_A`, wb === 0 && p === 1 ? 6 : 0);
    }
    return {states, nativeConfig, put, run,
        reserve: () => run('coordinatedPhaseReservations("Wallbox0")')};
}

test('parallel phase coordination ignores stale unused current only for a freshly confirmed OFF/Standby/zero-power peer', () => {
    const h = engine(); h.put('DP_WB1_L2_A', 0, {ts: 960000});
    const reserve = h.reserve();
    assert.equal(reserve.valid, true);
    assert.deepEqual(Array.from(reserve.wallboxesW[1]), [0, 0, 0]);
    assert.deepEqual(Array.from(reserve.otherW), [0, 0, 0]);
});

test('legacy coordinated phase policy is unchanged for an idle peer with stale current', () => {
    const h = engine(false); h.put('DP_WB1_L2_A', 0, {ts: 960000});
    assert.equal(h.reserve().valid, false);
});

test('inactive-current exception never bypasses unknown OFF/power, reserved draw or fresh contradictory current', async t => {
    for (const fault of ['allow_unknown', 'allow_ack_false', 'power_unknown', 'car_unknown', 'reserved', 'current_draw']) {
        await t.test(fault, () => {
            const h = engine(); h.put('DP_WB1_L2_A', 0, {ts: 960000});
            if (fault === 'allow_unknown') h.put('raw.allow1', null);
            if (fault === 'allow_ack_false') h.put('raw.allow1', 0, {ack: false});
            if (fault === 'power_unknown') h.put('DP_WB1_POWER', null);
            if (fault === 'car_unknown') h.put('DP_WB1_CAR', null);
            if (fault === 'reserved') h.put('ems.0.Devices.Wallbox1.OutputReservedPower_W', 1380);
            if (fault === 'current_draw') h.put('DP_WB1_L1_A', 10);
            assert.equal(h.reserve().valid, false);
        });
    }
});

test('parallel pending phase increments use configured 240 V while legacy reservations retain 230 V', () => {
    for (const parallel of [true, false]) {
        const h = engine(parallel); h.put('ems.0.Config.WallboxNominalVoltage_V', 240);
        h.put('ems.0.Devices.Wallbox0.OutputCommand_A', 10);
        h.put('ems.0.Devices.Wallbox0.OutputReservedPower_W', 0);
        const reserve = h.reserve();
        assert.equal(reserve.valid, true);
        assert.equal(reserve.wallboxesW[0][0], parallel ? 960 : 920);
    }
});
