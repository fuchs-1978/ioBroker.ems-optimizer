'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const page = fs.readFileSync(path.join(__dirname, '../examples/ems-energiefluss.html'), 'utf8');
function section(from, to) {
    const start = page.indexOf(from), end = page.indexOf(to, start + from.length);
    assert.ok(start >= 0 && end > start, from);
    return page.slice(start, end);
}
const dashboard = vm.runInNewContext([
    section('const isNumber =', 'function parseState('),
    section('function vehiclePath(', '\n'),
    section('function normalizedDeparture(', 'function wallboxDelayIds('),
    section('function wallboxDelayIds(', 'function fastIds('),
    section('function renderCountdown(', 'function renderCarStatus('),
    '({wallboxDelayIds, wallboxDelay, renderRunningCountdown, planGoalWrites, goalTripText, departureGoalFields})'
].join('\n'), {INSTANCE: 'ems-optimizer.0', SNAPSHOT_MAX_AGE: 30000});

test('vehicle timers use the correct controller channels for each wallbox', () => {
    for (const i of [0, 1, 2]) {
        const ids = dashboard.wallboxDelayIds(i);
        assert.equal(ids.start, `ems-optimizer.0.Vehicles.Wallbox${i}.StartDelayRemaining_s`);
        assert.equal(ids.minimum, `ems-optimizer.0.Vehicles.Wallbox${i}.MinimumRunTimeRemaining_s`);
        assert.equal(ids.stop, `ems-optimizer.0.Devices.Wallbox${i}.StopDelayRemaining_s`);
    }
});

test('the EQV stop countdown advances without new measurements and clears on cancellation or expiry', () => {
    const ts = Date.parse('2026-11-23T11:03:10Z');
    const sample = {val: 419, ts, ack: true, q: 0};
    const field = {}, row = {querySelector: () => field};
    const update = (reading, snapshotAt, now) => {
        const {until} = dashboard.wallboxDelay(true, reading, snapshotAt, now);
        dashboard.renderRunningCountdown(row, until, now);
    };
    update(sample, ts, ts);
    assert.equal(field.textContent, '06:59');
    update(sample, ts, ts + 1000);
    assert.equal(field.textContent, '06:58');
    update(sample, ts + 5000, ts + 5000);
    assert.equal(field.textContent, '06:54');
    update({...sample, val: 0, ts: ts + 6000}, ts + 5000, ts + 6000);
    assert.equal(row.hidden, true);
    assert.equal(field.textContent, '');
    update({...sample, val: 1}, ts, ts + 1000);
    assert.equal(row.hidden, true);
    for (const reading of [null, {...sample, ack: false}, {...sample, q: 64}, {...sample, ts: ts - 31000}]) {
        update(reading, ts, ts);
        assert.equal(row.hidden, true);
    }
    assert.equal(dashboard.wallboxDelay(false, sample, ts + 1, ts + 1).until, null);
});

test('one-off dashboard booking saves all settings in one write and can return to an empty or time-only departure', () => {
    const before = {min: 45, max: 90, time: '', date: '', tripSoc: null, editLimits: true};
    const after = {...before, date: '2096-11-30', time: '06:00', tripSoc: 100, allowGrid: true, plan: {zone: 'Europe/Berlin'}};
    const writes = (from, to) => Array.from(dashboard.planGoalWrites(from, to));
    assert.deepEqual(writes(before, after), ['trip']);
    assert.deepEqual(JSON.parse(dashboard.goalTripText(after)), {date: after.date, time: '06:00', soc: 100, allowGrid: true});
    assert.deepEqual(writes(after, after), []);
    assert.deepEqual(writes(after, before), ['time', 'trip']);
    assert.deepEqual(writes(before, {...before, time: '06:00'}), ['time']);
    assert.throws(() => writes(before, {...after, date: '2020-01-01'}), /Zukunft/);
    assert.throws(() => writes(before, {...after, date: '2096-02-30'}), /gültiges Abfahrtsdatum/);
    assert.throws(() => writes(before, {...after, time: ''}), /Uhrzeit/);
    assert.throws(() => writes(before, {...after, tripSoc: 44}), /Mindest-SoC/);
    assert.throws(() => writes(before, {...after, date: '2096-03-25', time: '02:30'}), /Zeitumstellung/);
});

test('each dashboard reserve is editable independently and maintains valid limits through multi-state writes', () => {
    const base = {reserve: 35, editReserve: true, morning:true, min: 50, max: 80, time:'', date:'', tripSoc:null, editLimits:true};
    const writes = (from, to) => Array.from(dashboard.planGoalWrites(from, to));
    assert.deepEqual(writes(base,{...base,reserve:0}), ['reserve']);
    assert.deepEqual(writes(base,{...base,editLimits:false,reserve:50}), ['reserve']);
    assert.deepEqual(writes(base,{...base,min:20,reserve:15}), ['reserve','min']);
    assert.deepEqual(writes(base,{...base,max:95,min:90,reserve:85}), ['max','min','reserve']);
    assert.throws(()=>writes(base,{...base,reserve:51}), /Mobilitätsreserve/);
    const booking = {...base,date:'2096-11-30',time:'05:10',tripSoc:40};
    assert.deepEqual(writes(base,booking), ['trip']);
    assert.throws(()=>writes(base,{...booking,tripSoc:null}), /Abfahrts-SoC/);
    assert.throws(()=>writes(base,{...base,time:'17:00'}), /Datum/);
    const old = {...booking,date:'2018-10-10',tripSoc:null};
    assert.deepEqual(writes(old,{...old,reserve:40}), ['reserve']);
    assert.deepEqual(writes(old,base), ['time','trip']);
});

test('the editor clears a past one-off at the booked instant and preserves the next car and recurring clock', () => {
    const fields = dashboard.departureGoalFields;
    const now = Date.parse('2026-11-28T10:30:00+01:00');
    const plan = {zone: 'Europe/Berlin', morning: {target: 50}, gridDefault: false, clock: '', at: 0};
    const eqe = {date: '2026-11-28', time: '10:30', soc: 60, allowGrid: true};
    const eqv = {date: '2026-11-30', time: '06:00', soc: 100, allowGrid: true};
    assert.equal(fields(eqe, plan, '', now - 1).tripSoc, 60);
    const cleared = fields(eqe, plan, '07:00', now);
    assert.deepEqual([cleared.date, cleared.time, cleared.tripSoc, cleared.allowGrid, cleared.bookingAt], ['', '', null, false, 0]);
    assert.equal(fields(eqv, plan, '', now).time, '06:00', 'a newly saved future trip can precede the next plan publication');
    assert.equal(fields(null, {zone: plan.zone}, '07:00', now).time, '07:00');
    assert.equal(fields(null, plan, '07:00', now).time, '');
    const before = {...cleared, min: 40, max: 90, editLimits: true};
    assert.deepEqual(Array.from(dashboard.planGoalWrites(before, {...before, max: 85})), ['max']);
    assert.deepEqual(Array.from(dashboard.planGoalWrites(before, {...before, time: '07:30'})), ['time', 'trip']);
    const repeatedHour = {date: '2026-10-25', time: '02:45', soc: 60};
    assert.equal(fields(repeatedHour, plan, '', Date.parse('2026-10-25T02:15:00+01:00')).date, '',
        'the old booking stays expired after clocks fall back in the EMS timezone');
});

test('an open EQE dialog expires only the saved trip while preserving unsubmitted edits', () => {
    const now = Date.parse('2026-11-28T10:30:00+01:00');
    const plan = {zone:'Europe/Berlin', morning:{target:50}, gridDefault:false};
    const trip = {date:'2026-11-28',time:'10:30',soc:60,allowGrid:true};
    const base = {...dashboard.departureGoalFields(trip,plan,'',now - 1), plan, gridDefault:false, reserve:20};
    for (const edited of [false, true]) {
        const ui = {goalDialog:{open:true}, savingVehicle:false, goalBaseline:{...base},
            tripDate:{value:edited ? '2026-11-30' : trip.date}, tripSoc:{value:edited ? '100' : '60',valueAsNumber:edited ? 100 : 60},
            tripGrid:{checked:true}, goalInputs:{time:{value:edited ? '06:00' : trip.time},reserve:{value:'25'}},
            departureGoalFields:dashboard.departureGoalFields, goalTripText:dashboard.goalTripText, syncGoalButtons() {}};
        vm.runInNewContext(section('function draftGoals()', 'function sameGoals(')
            + section('function expireVisibleDeparture(', 'function fillGoals(')
            + '\nexpireVisibleDeparture(' + now + ');', ui);
        assert.equal(ui.goalBaseline.expiredTrip, true);
        assert.equal(ui.goalInputs.reserve.value, '25');
        assert.deepEqual([ui.tripDate.value,ui.goalInputs.time.value,ui.tripSoc.value],
            edited ? ['2026-11-30','06:00','100'] : ['','','']);
    }
});
