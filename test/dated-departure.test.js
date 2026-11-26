'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {plant} = require('./control-plant');

const day = (date, time = '12:00') => new Date(date + 'T' + time).getTime();
const monday = day('2026-11-30', '06:00');
const booking = (extra = {}) => JSON.stringify({date: '2026-11-30', time: '06:00', soc: 100, allowGrid: true, ...extra});
async function tripPlant(extra = {}) {
    const h = await plant({initialTime: day('2026-11-26'), initialSurplusW: 0, startDelayS: 0, split: false,
        nativeConfig: {wallboxParallelChargingEnabled: true, dhwControlEnabled: false, wb2DeadlineEnabled: true,
            wb2MinimumSocByDepartureEnabled: true, wb2CommissioningMaxA: 20, ...extra}});
    h.own('Devices.MyPV_DHW.Present', false);
    h.own('Devices.Wallbox0.Present', false);
    h.own('Config.Wallbox2VehicleCapacity_kWh', 90.6);
    h.own('Vehicles.Wallbox2.MobilityReserve_pct', 20);
    h.put('DP_WB2_MIN_SOC', 45); h.put('DP_WB2_TARGET', 90); h.put('DP_WB2_SOC', 41);
    h.own('Vehicles.Wallbox2.DepartureTime', '06:00');
    h.own('Vehicles.Wallbox2.DepartureTrip_JSON', booking());
    await h.advance(4);
    return h;
}
const plan = h => JSON.parse(h.value('Vehicles.Wallbox2.DeparturePlan_JSON'));

test('Thursday to Monday at 06:00 uses PV now, reaches the one-off 100% with grid permission and expires', async () => {
    const h = await tripPlant();
    const first = plan(h);
    assert.equal(h.value('Vehicles.Wallbox2.DepartureTimestamp'), monday);
    assert.equal(first.clock, '2026-11-30T06:00');
    assert.equal(first.gridGoal, 100);
    assert.ok(first.latestStart > h.now() + 48 * 3600000 && first.latestStart < monday - 15 * 60000);
    assert.equal(h.value('Vehicles.Wallbox2.MinimumSoC_pct'), 45);
    assert.equal(h.value('Vehicles.Wallbox2.TargetSoC_pct'), 100);
    await h.advance(25);
    assert.equal(h.physical().wbPowerW, 0, 'no premature grid charge on Thursday');
    h.setSurplus(3700);
    await h.advance(30);
    assert.ok(h.physical().wbPowerW >= 1380, h.diagnostic());
    h.setSurplus(0);
    h.put('DP_WB2_SOC', 91);
    await h.advance(12);
    const later = plan(h).latestStart;
    assert.ok(later > first.latestStart, 'PV energy already received moves the required grid window later');
    await h.replayAt(later + 1000, [['DP_WB2_SOC',91]]);
    await h.advance(35);
    assert.equal(h.value('Vehicles.Wallbox2.MustCharge'), true);
    assert.ok(h.physical().wbPowerW >= 1380, h.diagnostic());
    h.put('DP_WB2_SOC', 96);
    await h.advance(6);
    assert.equal(plan(h).latestStart, later);
    h.put('DP_WB2_SOC', 100);
    await h.advance(10);
    assert.equal(h.physical().wbPowerW, 0);
    assert.equal(h.run('wallboxChargeTarget(2, ' + monday + ')'), 90, 'output restores the normal target at the exact deadline');
    await h.replayAt(monday + 1000, [['DP_WB2_SOC',95]]);
    assert.equal(h.value('Vehicles.Wallbox2.DepartureTimestamp'), 0);
    assert.equal(h.value('Vehicles.Wallbox2.TargetSoC_pct'), 90);
    assert.equal(h.value('Vehicles.Wallbox2.MinimumSoC_pct'), 45);
});

test('one-off PV-only goal, mobility reserve and edits respect the configured minimum and original limits', async () => {
    const h = await tripPlant();
    h.own('Vehicles.Wallbox2.DepartureTrip_JSON', booking({allowGrid:false}));
    h.put('DP_WB2_SOC', 15);
    await h.advance(30);
    assert.equal(plan(h).gridGoal,45);
    assert.ok(h.physical().wbPowerW >= 1380);
    h.put('DP_WB2_SOC', 91);
    await h.replayAt(monday - 240000, [['DP_WB2_SOC',91]]);
    await h.advance(20);
    assert.equal(h.physical().wbPowerW,0);
    assert.equal(h.value('Vehicles.Wallbox2.TargetSoC_pct'),100);
    h.own('Vehicles.Wallbox2.DepartureTrip_JSON', booking());
    await h.advance(25);
    assert.ok(h.physical().wbPowerW >= 1380);
    h.own('Vehicles.Wallbox2.DepartureTrip_JSON', booking({allowGrid:false}));
    assert.equal(h.run('liveDepartureMinimumW(2,91,100,1,230,Date.now(),4000)'),0);
    await h.advance(12);
    assert.equal(h.value('Vehicles.Wallbox2.MustCharge'),false);
    h.own('Vehicles.Wallbox2.DepartureTrip_JSON', booking({soc:null,allowGrid:null}));
    await h.advance(2);
    assert.equal(plan(h).target,90);
    assert.equal(plan(h).gridGoal,45);
    h.own('Vehicles.Wallbox2.DepartureTrip_JSON','');
    await h.advance(2);
    assert.equal(h.value('Vehicles.Wallbox2.DepartureTimestamp'),monday);
});

test('invalid calendar entries never fall through to the daily clock and a same-clock date edit moves the price session', async () => {
    const h = await tripPlant({wb2PriceChargingEnabled:true});
    h.own('Config.Wallbox2PriceChargingEnabled',true);
    await h.advance(6);
    const session=h.value('Vehicles.Wallbox2.PriceSessionId');
    assert.ok(session);
    assert.equal(h.value('Vehicles.Wallbox2.PriceDeadlineTimestamp'),monday);
    h.own('Vehicles.Wallbox2.DepartureTrip_JSON',booking({date:'2026-12-01'}));
    await h.advance(2);
    assert.equal(h.value('Vehicles.Wallbox2.PriceDeadlineTimestamp'),day('2026-12-01','06:00'));
    assert.equal(h.value('Vehicles.Wallbox2.PriceSessionId'),session);
    for (const invalid of [booking({date:'2026-11-31'}),booking({time:'24:00'}),booking({soc:125}),'{']) {
        h.own('Vehicles.Wallbox2.DepartureTrip_JSON',invalid);
        await h.advance(2);
        assert.equal(h.value('Vehicles.Wallbox2.DepartureTimestamp'),0);
        assert.equal(h.value('Vehicles.Wallbox2.TargetSoC_pct'),90);
    }
});

test('rolling 48-hour plan only purchases the missing trip energy when the backup enters the forecast', async () => {
    const h = await tripPlant();
    const forecast = () => {
        const first = Math.floor(h.now() / 900000) * 900000;
        const slots = Array.from({length:192}, (_, i) => ({timestamp:first+i*900000}));
        h.engineContext.weekend = {pv:slots.map(s=>({...s,valueW:0})),house:slots.map(s=>({...s,valueW:900})),
            prices:{total:slots.map(s=>({...s,value_ct_kWh:30}))}};
        h.run('historyReady = true; buildDevicePlan(weekend); updateVehicles()');
        return JSON.parse(h.value('Plan.Wallbox2_48h_JSON'));
    };
    assert.ok(forecast().every(slot => slot.valueW === 0), 'dark Thursday/Friday are available for higher-priority cars');
    await h.replayAt(monday-30*3600000,[['DP_WB2_SOC',75]]);
    const slots = forecast(), bound = plan(h).latestStart;
    assert.ok(slots.some(slot=>slot.valueW>0 && slot.timestamp>=bound && slot.timestamp<monday));
    assert.ok(slots.every(slot=>slot.valueW===0 || slot.timestamp>=bound && slot.timestamp<monday));
    const kWh = slots.reduce((sum,slot)=>sum+slot.valueW*0.25/1000,0);
    assert.ok(kWh >= 0.25*90.6/0.9-0.02 && kWh < 0.25*90.6/0.9+0.1, 'grid energy to 100 percent: '+kWh);
});

test('a cheap grid slot cannot charge beyond the configured minimum without the one-off permission', async () => {
    const h = await tripPlant({wb2PriceChargingEnabled: true});
    h.own('Config.Wallbox2PriceChargingEnabled', true);
    h.own('Config.Wallbox2PriceMax_ct_kWh', 40);
    h.own('Vehicles.Wallbox2.DepartureTrip_JSON', booking({allowGrid: false}));
    h.put('DP_WB2_SOC', 79);
    await h.advance(6);
    const first = Math.floor(h.now() / 900000) * 900000;
    const slots = Array.from({length: 192}, (_, i) => ({timestamp: first + i * 900000}));
    h.engineContext.cheapTrip = {
        pv: slots.map(s => ({...s, valueW: 0})),
        house: slots.map(s => ({...s, valueW: 900})),
        prices: {total: slots.map(s => ({...s, value_ct_kWh: 5}))}
    };
    const forecast = () => {
        h.run('historyReady = true; buildDevicePlan(cheapTrip); updateVehicles()');
        return JSON.parse(h.value('Plan.Wallbox2_48h_JSON'));
    };
    assert.ok(forecast().every(s => s.valueW === 0), 'no purchase above 45% for the PV-only trip');
    h.own('Vehicles.Wallbox2.DepartureTrip_JSON', booking());
    await h.advance(2);
    assert.ok(forecast().some(s => s.valueW > 0 && s.priceDepartureAt === monday && s.gridChargeW > 0),
        'a permitted purchase is bound to the Monday departure');
});
