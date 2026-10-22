'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const {createPhaseFollower} = require('../examples/ems-phase-follow');

function fixture() {
    let now = 1000000;
    const states = new Map(), timers = new Set(), writes = [], logs = [];
    const box = {wb: 1, name: 'EQV', mode: 'mode', connection: 'connection'};
    const put = (id, val, extra = {}) => states.set(id, {val, ts: now, ack: true, q: 0, ...extra});
    const own = (id, value, extra) => put(`ems-optimizer.0.${id}`, value, extra);
    const fresh = () => {
        own('Control.Valid', true); own('Control.LastUpdate', now);
        own('Control.Targets.Wallbox1_Phases', 3);
    };
    own('System.RealOutputsEnabled', true); own('Vehicles.Wallbox1.PhaseControlMode', 'ems');
    put('connection', true); put('mode', 1); fresh();
    const follower = createPhaseFollower({getState: id => states.get(id),
        setState: (id, val) => {writes.push({id, val}); put(id, val, {ack: false});},
        setTimeout: fn => {timers.add(fn); return fn;}, clearTimeout: fn => timers.delete(fn),
        log: (text, level) => logs.push({text, level})}, [box], {now: () => now});
    const advance = (ms = 20000, refresh = true) => {now += ms; if (refresh) fresh();};
    const fire = () => {for (const fn of [...timers]) {timers.delete(fn); fn();}};
    return {follower, box, put, own, fresh, advance, fire, timers, writes, logs, now: () => now};
}

test('master OFF prevents new phase commands and cancels outstanding callback across OFF/ON', () => {
    const h = fixture(); h.own('System.RealOutputsEnabled', false); h.follower.check(h.box);
    assert.equal(h.writes.length, 0);
    h.own('System.RealOutputsEnabled', true); h.follower.check(h.box);
    const late = [...h.timers][0];
    h.own('System.RealOutputsEnabled', false); h.follower.cancel();
    h.advance(); h.own('System.RealOutputsEnabled', true); h.put('mode', 2); late();
    assert.equal(h.logs.length, 0); assert.equal(h.follower.pending.size, 0);
    assert.equal(h.writes.length, 1);
});

test('phase value alone, old ACK, bad quality, NULL and missing ACK cannot confirm a command', async t => {
    for (const extra of [{ack: false}, {ts: 1000000}, {q: 64}, {val: null}, {val: 1}, {ts: 0}])
        await t.test(JSON.stringify(extra), () => {
            const h = fixture(); h.follower.check(h.box); h.advance();
            h.put('mode', 2, extra); h.fire();
            assert.equal(h.logs.at(-1).level, 'error');
            assert.match(h.logs.at(-1).text, /Timeout/);
        });
});

test('fresh post-command ACK confirms configured mode and explicitly leaves electrical evidence open', () => {
    const h = fixture(); h.follower.check(h.box); h.advance(); h.put('mode', 2); h.fire();
    assert.equal(h.logs.at(-1).level, 'info');
    assert.match(h.logs.at(-1).text, /elektrische Antwort separat/);
});

test('callback rechecks master, source validity and target; disconnect/restart provides no success', async t => {
    for (const change of [h => h.own('System.RealOutputsEnabled', false),
        h => h.own('Control.Valid', true, {ack: false}), h => h.put('connection', false),
        h => h.own('Control.Targets.Wallbox1_Phases', 1), h => h.own('Control.LastUpdate', 1)])
        await t.test('permission lost', () => {
            const h = fixture(); h.follower.check(h.box); h.advance(); h.put('mode', 2); change(h); h.fire();
            assert.equal(h.logs.some(log => log.level === 'info'), false);
            assert.equal(h.follower.pending.size, 0);
        });
    const h = fixture(); h.follower.check(h.box); const callback = [...h.timers][0];
    h.follower.cancel(); callback(); assert.equal(h.logs.length, 0);
});


test('retained target survives startup delay and ACK timeout without target refresh', () => {
    const h = fixture();
    h.own('Control.Valid', false);
    h.follower.check(h.box);
    assert.equal(h.writes.length, 0);
    h.advance(30000, false);
    h.own('Control.Valid', true); h.own('Control.LastUpdate', h.now());
    h.follower.check(h.box);
    assert.equal(h.writes.length, 1);
    h.advance(20000, false); h.own('Control.LastUpdate', h.now());
    h.put('mode', 2); h.fire();
    assert.equal(h.logs.at(-1).level, 'info');
    h.follower.check(h.box);
    assert.equal(h.writes.length, 1);
});

test('unacknowledged retained target retries only after 60 seconds', () => {
    const h = fixture(); h.follower.check(h.box);
    h.advance(20000, false); h.own('Control.LastUpdate', h.now()); h.fire();
    assert.equal(h.logs.at(-1).level, 'error');
    h.follower.check(h.box); assert.equal(h.writes.length, 1);
    h.advance(39999, false); h.own('Control.LastUpdate', h.now());
    h.follower.check(h.box); assert.equal(h.writes.length, 1);
    h.advance(1, false); h.own('Control.LastUpdate', h.now());
    h.follower.check(h.box); assert.equal(h.writes.length, 2);
});

test('retained targets cannot bypass stale heartbeat or invalid target metadata', async t => {
    for (const change of [
        h => {},
        h => h.own('Control.LastUpdate', h.now(), {ts: 1}),
        h => h.own('Control.LastUpdate', 1),
        ...[{ack: false}, {q: 64}, {val: null}, {val: 2}, {ts: 0}, {ts: 2000000}].map(extra =>
            h => {h.own('Control.LastUpdate', h.now());
                h.own('Control.Targets.Wallbox1_Phases', 3, extra);})
    ]) await t.test('invalid control or target', () => {
        const h = fixture(); h.advance(30000, false); change(h);
        h.follower.check(h.box); assert.equal(h.writes.length, 0);
    });
});

test('invalid or changed retained target cannot confirm pending command', async t => {
    for (const value of [null, 2, 1]) await t.test(String(value), () => {
        const h = fixture(); h.follower.check(h.box);
        h.advance(20000, false); h.own('Control.LastUpdate', h.now());
        h.own('Control.Targets.Wallbox1_Phases', value); h.put('mode', 2); h.fire();
        assert.equal(h.logs.length, 0);
        assert.equal(h.follower.pending.size, 0);
    });
});
