'use strict';
const {test} = require('node:test');
const assert = require('node:assert/strict');
const {quality, cachedJSON, liveExplanation, dailyPeriod, dailyText, buildReport, oldestUnconfirmed,
    OperatorDiagnostics, MAX_BYTES} = require('../lib/operator-diagnostics');
const {DailySummary, period} = require('../lib/daily-summary');
const now = Date.parse('2026-10-28T16:22:16Z');
function healthy(extra = {}) {
    return {now, session: 2, dropped: 0, writeErrors: 0, queue: 1, backpressure: false,
        journal: {initialized: true, closed: false, integrityValid: true, capacityVerified: true,
            bytes: 349367, maxBytes: 134217728, unconfirmedRecords: 0, expiredUnconfirmedRecords: 8537},
        delivery: {queryCount: 2516, queryErrors: 1, sqlConfirmed: 43774, activeSqlRequests: 0,
            lastFreshSQLProof: {observedAt: now - 1000}, lastQuery: {transportWaitMs: 89.557, outcome: 'complete'},
            sqlBackoff: {paused: false, degraded: false}}, ...extra};
}
function snapshot(at = now) {
    return {ts: at, system: {RealOutputsEnabled: true}, control: {Enabled: true, Valid: true},
        freshness: {control: {ageMs: 1000}}, power: {grid_W: 0, pv_W: 1000},
        measurements: {gridImport: {valid: true, ts: at}, gridExport: {valid: true, ts: at}},
        ehz: {actual_W: 0}, wallboxes: [0, 1, 2].map(wb => ({wb, Present: true, ControlEnabled: true,
            actual_W: 0, SoCValid: true, SoC_pct: 75, TargetSoC_pct: 90,
            OutputStatus: 'Wartet auf nutzbares Budget', LastStopReason: 'alter Fehler', LastStopAt: at - 100000}))};
}
function daily() {
    const d = new DailySummary({setStateAsync: async () => {}, log: {warn() {}}});
    d.sample(snapshot(now - 5000)); d.sample(snapshot()); return d.report();
}
test('actual recovered SQL case: historical deadline and expired originals never become a current outage', () => {
    const q = quality(healthy());
    assert.equal(q.sql.status, 'frisch bestätigt');
    assert.equal(q.sql.historicalErrorsSinceStart, 1);
    assert.equal(q.recorder.status, 'arbeitsfähig');
    assert.equal(q.recorder.historicalExpiredUnconfirmed, 8537);
    assert.equal(q.externalHistory.status, 'nicht geprüft');
    assert.equal(q.externalHistory.coveredMs, null);
});
test('a normal live request with its durable fence is not falsely classified as blocked', () => {
    const h = healthy(); h.delivery.persistentVerificationFence = true; h.delivery.activeSqlRequests = 1;
    assert.equal(quality(h).sql.status, 'frisch bestätigt');
    h.delivery.backendBlocked = true;
    assert.equal(quality(h).sql.status, 'blockiert');
    h.delivery.backendBlocked = false; h.delivery.activeSqlRequests = 0;
    assert.equal(quality(h).sql.status, 'blockiert');
});
test('old/future/missing proofs, backoff and missing status stay distinct from success', () => {
    for (const stamp of [null, now + 1, now - 60001]) {
        const h = healthy(); h.delivery.lastFreshSQLProof.observedAt = stamp;
        assert.equal(quality(h).sql.status, 'verzögert / Nachweis fehlt');
    }
    const h = healthy(); h.delivery.sqlBackoff.paused = true;
    assert.equal(quality(h).sql.status, 'blockiert');
    assert.equal(quality(healthy({delivery: null, journal: null})).sql.status, 'ungeprüft');
    assert.equal(quality(healthy({delivery: null, journal: null})).recorder.status, 'ungeprüft');
});
test('loss deltas are session-scoped; resets and historical counters are not new losses', () => {
    const h = healthy({dropped: 3, writeErrors: 3, previous: {session: 2, dropped: 0, writeErrors: 0}});
    assert.equal(quality(h).recorder.status, 'neuer Verlust/Schreibfehler');
    h.previous = {session: 1, dropped: 0, writeErrors: 0};
    assert.equal(quality(h).recorder.newLoss, false);
    h.previous = {session: 2, dropped: 5, writeErrors: 5};
    assert.equal(quality(h).recorder.newLoss, false);
});
test('storage integrity, pressure and small fresh queues are evaluated independently', () => {
    const h = healthy(); assert.equal(quality(h).recorder.status, 'arbeitsfähig');
    h.journal.bytes = h.journal.maxBytes * 0.9; assert.equal(quality(h).recorder.status, 'Rückstau');
    h.journal.integrityValid = false; assert.equal(quality(h).recorder.status, 'gestört');
});
test('cached status has a byte/age/ACK/quality boundary and never accepts null or arrays', () => {
    const s = {val: '{}', ts: now, ack: true, q: 0}; assert.deepEqual(cachedJSON(s, now), {});
    for (const bad of [{...s, ts: now + 1}, {...s, ts: now - 120001}, {...s, ack: false},
        {...s, q: 64}, {...s, val: 'null'}, {...s, val: '[]'}, {...s, val: 'x'.repeat(262145)}, {...s, val: '{'}])
        assert.equal(cachedJSON(bad, now), null);
});
test('oldest unconfirmed is the original event time, never the oldest confirmed dependency', () => {
    const entries = new Map([[1, {confirmedStored: true, eventTimestamp: 100}],
        [2, {confirmedStored: false, eventTimestamp: 300}], [3, {confirmedStored: false, eventTimestamp: 200}]]);
    assert.equal(oldestUnconfirmed(entries, 2), 200);
    assert.equal(oldestUnconfirmed(entries, 1), null, 'straddling cached count is unknown');
    entries.get(3).eventTimestamp = null; assert.equal(oldestUnconfirmed(entries, 2), null);
    assert.equal(oldestUnconfirmed(entries, 0), null);
});
test('handover explanation does not equate AUS ACK with electrical stop or invent a new start reason', () => {
    const s = snapshot(); s.wallboxes[1].StopPowerPending = true; s.wallboxes[1].actual_W = 2270;
    s.wallboxes[2].ResponsePending = true; s.wallboxes[2].actual_W = 0;
    const r = liveExplanation(s);
    assert.match(r.vehicles[1].reason, /elektrische Ruhe noch nicht/);
    assert.match(r.vehicles[2].reason, /elektrische Antwort abwarten/);
    assert.equal(r.vehicles[2].actualW, 0);
    assert.equal(r.vehicles[2].historicalStop.reason, 'alter Fehler');
    assert.doesNotMatch(r.vehicles[2].reason, /alter Fehler/);
});
test('freshness/master/invalid gates override retained reasons for every actuator', () => {
    const s = snapshot(); s.ehz.OutputStatus = 'Heizen'; s.freshness.control.ageMs = 31000;
    assert.match(liveExplanation(s).vehicles[0].reason, /nicht bewertbar/);
    s.freshness.control.ageMs = 0; s.system.RealOutputsEnabled = false;
    assert.equal(liveExplanation(s).ehz.reason, 'Produktive Freigabe AUS');
    s.system.RealOutputsEnabled = true; s.control.Valid = false;
    assert.equal(liveExplanation(s).valid, false);
});
test('unknown SoC, power and budget remain null; current output faults remain explicit', () => {
    const s = snapshot(), w = s.wallboxes[0];
    w.SoCValid = false; w.actual_W = null; w.OutputFault = 'echter Fehler';
    const r = liveExplanation(s).vehicles[0];
    assert.equal(r.soc, null); assert.equal(r.actualW, null); assert.equal(r.budget.availableW, null);
    assert.match(r.reason, /echter Fehler/);
});
test('daily report uses the existing 20h period and preserves unknown sources and future separately', () => {
    const d = daily(), r = dailyPeriod(d.current, now, true);
    assert.equal(r.from, period(now).from); assert.equal(r.sources.grid.coveredMs, 5000);
    assert.ok(r.sources.grid.pastUnknownMs > 0); assert.ok(r.sources.grid.futureMs > 0);
    assert.equal(r.sources.ehz.importKWh, 0); assert.equal(r.sources.bhkw.importKWh, null);
    assert.equal(r.costs, null); assert.equal(r.savings, null); assert.match(r.goals, /nicht.*bewertet/);
    assert.match(dailyText(r), /EHZ elektrisch/); assert.match(dailyText(r), /unbekannt/);
});
test('malformed/future/overcovered/negative daily data cannot produce a successful balance', () => {
    const d = daily().current;
    assert.equal(dailyPeriod(null, now, true), null);
    d.observedUntil = now + 1; assert.equal(dailyPeriod(d, now, true), null); d.observedUntil = now;
    d.sources.grid.coveredMs = d.to - d.from; assert.equal(dailyPeriod(d, now, true), null);
    d.sources.grid.coveredMs = 5000; d.sources.grid.importWh = -1; assert.equal(dailyPeriod(d, now, true), null);
});
test('read-only publisher bounds stalled writes and sends only its own twelve display states', async () => {
    const writes = [], objects = []; let unblock;
    const a = {namespace: 'ems.0', shadowController: {recordSession: 1, recordDropped: 0, recordWriteErrors: 0},
        queueCompatState: async (id, value, common) => objects.push({id, common}), getCachedState: () => null,
        setStateAsync: async (id, state) => {writes.push({id, state}); if (writes.length === 1) await new Promise(r => {unblock = r;});},
        warnDebug(e) {throw e;}};
    const p = new OperatorDiagnostics(a); await p.initialize();
    assert.ok(objects.every(o => o.common.write === false));
    p.publish(snapshot(), daily()); await new Promise(r => setImmediate(r));
    for (let i = 0; i < 100; i++) p.publish(snapshot(now + i), daily());
    assert.equal(p.writer.entries.size, 12);
    assert.ok(writes.every(w => /^Diagnostics\./.test(w.id)));
    unblock(); await Promise.all([...p.writer.entries.values()].map(e => e.promise));
    assert.ok(writes.length <= 24); assert.ok(writes.every(w => Buffer.byteLength(w.state.val) < MAX_BYTES));
    p.stop(); const count = writes.length; p.publish(snapshot(), daily()); assert.equal(writes.length, count);
});
test('full display stays bounded and cannot manufacture a day, cost saving or external audit', () => {
    const q = quality(healthy()), r = buildReport(snapshot(), q, daily(), now);
    assert.ok(Buffer.byteLength(JSON.stringify(r)) < MAX_BYTES);
    assert.match(r.display.SQL, /Fehler seit Start 1/); assert.match(r.display.History, /nicht geprüft/);
    assert.match(r.display.PreviousDay, /Keine gültige Tagesbilanz/);
    assert.match(r.display.CurrentDay, /Kosten\/Ersparnis: unbekannt/);
});
