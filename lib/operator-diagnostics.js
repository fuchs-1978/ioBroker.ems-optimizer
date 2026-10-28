'use strict';

// Presentation only: no SQL, source subscriptions, configuration or actuator writes.
const {validPeriod} = require('./daily-summary');
const {LatestStateWriter} = require('./latest-state-writer');
const MAX_BYTES = 48000;
const finite = n => typeof n === 'number' && Number.isFinite(n);
const num = n => finite(n) ? n : null;
const text = value => typeof value === 'string' ? value.slice(0, 350) : '';
const show = (n, unit = '') => finite(n) ? `${Math.round(n * 100) / 100}${unit}` : 'unbekannt';
const date = n => finite(n) && n > 0 && Number.isFinite(new Date(n).getTime())
    ? new Date(n).toLocaleString('de-DE', {timeZone: 'Europe/Berlin'}) : 'unbekannt';
const names = ['Mii', 'EQV', 'EQE'];
function cachedJSON(state, now, maximum = 120000, bytes = 262144) {
    if (!state || state.ack !== true || state.q || !finite(state.ts) || state.ts > now || now - state.ts > maximum
        || typeof state.val !== 'string' || Buffer.byteLength(state.val) > bytes) return null;
    try { const v = JSON.parse(state.val); return v && typeof v === 'object' && !Array.isArray(v) ? v : null; }
    catch { return null; }
}
function source(m) {
    return {valid: typeof m?.valid === 'boolean' ? m.valid : null, ts: num(m?.ts),
        ageMs: num(m?.ageMs), reason: text(m?.reason)};
}
function liveExplanation(s = {}) {
    const c = s.control || {}, system = s.system || {};
    const age = s.freshness?.control?.ageMs;
    const current = finite(age) && age >= 0 && age <= 30000;
    const released = system.RealOutputsEnabled === true && c.Enabled === true;
    const usable = current && c.Valid === true;
    const status = !current ? 'Regelzustand nicht frisch belegt' : !released ? 'Produktive Freigabe AUS'
        : c.Valid !== true ? 'Regelung aktuell nicht gültig' : text(c.Status) || 'Regelung gültig; Einzelgründe siehe Fahrzeuge';
    const vehicles = (s.wallboxes || []).filter(w => [0, 1, 2].includes(w.wb)).slice(0, 3).map(w => {
        let reason;
        if (!usable) reason = 'Aktuelle Entscheidung nicht bewertbar';
        else if (!released) reason = 'Produktive Freigabe AUS';
        else if (w.Present !== true || w.ControlEnabled !== true) reason = 'Nicht vorhanden oder Regelung deaktiviert';
        else if (w.OutputFault) reason = `Aktuelle Ausgangsstörung: ${text(w.OutputFault)}`;
        else if (w.StopPowerPending === true) reason = 'AUS wird abgeschlossen; elektrische Ruhe noch nicht bestätigt';
        else if (w.PhaseTransitionActive === true) reason = 'Phasenwechsel läuft; Bestätigung und elektrische Antwort abwarten';
        else if (w.ResponsePending === true || w.pending) reason = 'Befehl unterwegs; unabhängige Bestätigung oder elektrische Antwort abwarten';
        else if (w.StartDelayActive === true) reason = `Startqualifikation läuft: ${show(w.StartDelayRemaining_s, ' s')}`;
        else reason = text(w.OutputStatus) || text(w.Status) || 'Kein eindeutiger aktueller Grund vorhanden';
        return {wb: w.wb, name: names[w.wb], reason, release: w.Release ?? null, userRelease: w.UserRelease ?? null,
            connected: w.Connected ?? null, targetA: num(w.target_A), commandA: num(w.OutputCommand_A),
            actualW: num(w.actual_W), phases: num(w.ConfirmedPhases), response: text(w.ResponseState),
            soc: w.SoCValid === true ? num(w.SoC_pct) : null, targetSoc: num(w.TargetSoC_pct),
            timers: {startS: num(w.StartDelayRemaining_s), minimumRunS: num(w.MinimumRunTimeRemaining_s),
                stopS: num(w.StopDelayRemaining_s), responseS: num(w.ResponseRemaining_s)},
            budget: {availableW: num(w.allocation?.safetyBudgetW), pvW: num(w.allocation?.pvBudgetW),
                reason: text(w.allocation?.reason)},
            powerSource: source(w.measurements?.power),
            historicalStop: {at: num(w.LastStopAt), reason: text(w.LastStopReason)}};
    });
    const ehz = {actualW: num(s.ehz?.actual_W), commandW: num(s.ehz?.OutputCommand_W),
        release: s.ehz?.Release ?? null, reason: !released ? 'Produktive Freigabe AUS' : usable ? text(s.ehz?.OutputStatus) || text(s.ehz?.ControlReason)
            || 'Kein eindeutiger aktueller Grund vorhanden' : 'Aktuelle Entscheidung nicht bewertbar'};
    return {at: num(s.ts), current, released, valid: usable, reason: status, vehicles, ehz,
        gridW: num(s.power?.grid_W), targetGridW: num(c.TargetGridPower_W),
        gridSources: {import: source(s.measurements?.gridImport), export: source(s.measurements?.gridExport)},
        note: 'Cache-Beobachtung; Soll, Geräte-ACK und elektrische Wirkung sind unterschiedliche Nachweise.'};
}
function quality({journal: j, delivery: d, dropped, writeErrors, queue, backpressure, session, previous, now, oldestUnconfirmedAt}) {
    const same = previous?.session === session;
    const increased = (key, value) => same && finite(value) && finite(previous?.[key]) && value > previous[key];
    const newLoss = increased('dropped', dropped), newWriteError = increased('writeErrors', writeErrors);
    const fill = j && finite(j.bytes) && finite(j.maxBytes) && j.maxBytes > 0 ? j.bytes / j.maxBytes : null;
    const recording = !j || j.initialized !== true || j.closed === true || !finite(dropped) || !finite(writeErrors) ? 'ungeprüft'
        : j.integrityValid !== true || j.capacityVerified !== true ? 'gestört'
            : newLoss || newWriteError ? 'neuer Verlust/Schreibfehler'
                : backpressure === true || fill >= 0.8 ? 'Rückstau' : 'arbeitsfähig';
    const proofAt = num(d?.lastFreshSQLProof?.observedAt);
    const proofAgeMs = proofAt !== null && proofAt <= now && proofAt > 0 ? now - proofAt : null;
    const freshProof = proofAgeMs !== null && proofAgeMs <= (d?.limits?.freshProofMaxAgeMs || 60000);
    const sql = !d || d.stopped === true ? 'ungeprüft'
        : d.backendBlocked === true || d.persistentVerificationFence === true && d.activeSqlRequests === 0 || d.sqlBackoff?.paused === true
            ? 'blockiert' : d.sqlBackoff?.degraded === true || !freshProof ? 'verzögert / Nachweis fehlt'
                : 'frisch bestätigt';
    return {recorder: {status: recording, droppedSinceStart: num(dropped), writeErrorsSinceStart: num(writeErrors),
        newLoss, newWriteError, queue: num(queue), journalBytes: num(j?.bytes), journalMaxBytes: num(j?.maxBytes),
        fillPercent: fill === null ? null : Math.round(fill * 1000) / 10,
        unconfirmed: num(j?.unconfirmedRecords), oldestUnconfirmedAt: num(oldestUnconfirmedAt),
        historicalExpiredUnconfirmed: num(j?.expiredUnconfirmedRecords)},
    sql: {status: sql, proofAt, proofAgeMs, confirmed: num(d?.sqlConfirmed), checks: num(d?.queryCount),
        historicalErrorsSinceStart: num(d?.queryErrors), pending: num(d?.pendingEntries),
        activeRequests: num(d?.activeSqlRequests), transportMs: num(d?.lastQuery?.transportWaitMs),
        lastOutcome: text(d?.lastQuery?.outcome)},
    externalHistory: {status: 'nicht geprüft', lastSuccessfulReadAt: null, coveredMs: null,
        decoderGaps: null, sequenceGaps: null,
        reason: 'Kein angebundener externer Abrufprüfstand. Frische SQL-Bestätigung beweist keine vollständige externe Historienauswertung.'}};
}
function dailyPeriod(p, now, ongoing) {
    if (!validPeriod(p) || p.observedUntil > now) return null;
    const observedMs = p.observedUntil - p.from;
    if (Object.values(p.sources).some(x => x.coveredMs > observedMs || x.importWh < 0 || x.exportWh < 0)) return null;
    const sources = Object.fromEntries(['grid', 'pv', 'bhkw', 'wallbox0', 'wallbox1', 'wallbox2', 'ehz'].map(k => {
        const x = p.sources[k], coveredMs = x.coveredMs;
        return [k, {importKWh: coveredMs > 0 ? x.importWh / 1000 : null,
            exportKWh: coveredMs > 0 ? x.exportWh / 1000 : null, coveredMs,
            pastUnknownMs: Math.max(0, observedMs - coveredMs), futureMs: Math.max(0, p.to - p.observedUntil),
            coveragePercent: observedMs > 0 ? 100 * coveredMs / observedMs : null}];
    }));
    const events = p.events.filter(e => finite(e?.at) && e.at >= p.from && e.at <= p.observedUntil).slice(-6)
        .map(e => ({at: e.at, type: text(e.type), reason: text(e.detail?.reason)}));
    return {from: p.from, to: p.to, observedUntil: p.observedUntil, ongoing, sources,
        lossesObserved: p.recorder.droppedObserved, eventOverflow: p.eventOverflow, events,
        goals: 'Zielerreichung nicht durch vollständige historische SoC-/Freigabeketten bewertet.',
        costs: null, savings: null, costReason: 'Keine passende belegte Preis-/Vergleichsbasis in den Tagesaggregaten.',
        protection: 'Nicht abgenommen', energyMethod: 'Begrenzte Leistungsintegrale, keine Zählerdifferenzen; EHZ elektrisch, nicht thermisch.'};
}
function dailyText(p) {
    if (!p) return 'Keine gültige Tagesbilanz vorhanden; unbekannt, nicht null.';
    const labels = {grid: 'Netzbezug / Einspeisung', pv: 'PV', bhkw: 'BHKW', wallbox0: 'Mii', wallbox1: 'EQV', wallbox2: 'EQE', ehz: 'EHZ elektrisch'};
    const lines = [`${p.ongoing ? 'Laufende' : 'Vorherige'} Bilanz: ${date(p.from)} bis ${date(p.to)}. Beobachtet bis ${date(p.observedUntil)}.`,
        p.energyMethod];
    for (const [key, x] of Object.entries(p.sources)) lines.push(`${labels[key]}: ${show(x.importKWh, ' kWh')}${key === 'grid' ? ` / ${show(x.exportKWh, ' kWh')}` : ''}; Abdeckung ${show(x.coveragePercent, ' %')}, vergangen unbekannt ${show(x.pastUnknownMs / 1000, ' s')}, noch nicht beobachtet ${show(x.futureMs / 1000, ' s')}.`);
    lines.push(`Beobachtete Recorderverluste: ${p.lossesObserved}. Verdrängte Ereignisdetails: ${p.eventOverflow}.`, p.goals,
        `Kosten/Ersparnis: unbekannt. ${p.costReason}`, 'Schutzabnahme: nicht bewertet.');
    for (const e of p.events) lines.push(`Beobachtung ${date(e.at)}: ${e.type}${e.reason ? ` – ${e.reason}` : ''}`);
    return lines.join('\n');
}
function buildReport(s, q, daily, now) {
    const live = liveExplanation(s);
    const current = dailyPeriod(daily?.current, now, true), previous = dailyPeriod(daily?.previous, now, false);
    const liveText = [`Stand ${date(now)}: ${live.reason}. Netz ${show(live.gridW, ' W')}, Ziel ${show(live.targetGridW, ' W')}.`,
        ...live.vehicles.map(w => `${w.name}: ${w.reason}. Soll ${show(w.commandA, ' A')}, Ist ${show(w.actualW, ' W')}; Freigabe ${w.release === null ? 'unbekannt' : w.release ? 'EIN' : 'AUS'}; SoC ${show(w.soc, ' %')} / Ziel ${show(w.targetSoc, ' %')}; PV-Budget ${show(w.budget.pvW, ' W')}; Mindestlauf ${show(w.timers.minimumRunS, ' s')}, Stopp ${show(w.timers.stopS, ' s')}; Leistungsquelle ${w.powerSource.reason || 'unbekannt'}, Alter ${show(w.powerSource.ageMs === null ? null : w.powerSource.ageMs / 1000, ' s')}.`),
        `EHZ: ${live.ehz.reason}; Soll ${show(live.ehz.commandW, ' W')}, Ist ${show(live.ehz.actualW, ' W')}.`, live.note].join('\n');
    return {schema: 1, at: now, quality: q, live, daily: {current, previous},
        display: {Live: liveText, Recorder: `${q.recorder.status}; Verluste seit Start ${show(q.recorder.droppedSinceStart)}, Schreibfehler seit Start ${show(q.recorder.writeErrorsSinceStart)}; Journal ${show(q.recorder.fillPercent, ' %')}, unbestätigt ${show(q.recorder.unconfirmed)}. Historisch unbestätigt abgelaufen ${show(q.recorder.historicalExpiredUnconfirmed)}. Ältestes unbestätigtes Original: ${date(q.recorder.oldestUnconfirmedAt)}.`,
            SQL: `${q.sql.status}; letzter echter Nachweis ${date(q.sql.proofAt)}; Prüfungen ${show(q.sql.checks)}, Fehler seit Start ${show(q.sql.historicalErrorsSinceStart)}; wartend ${show(q.sql.pending)}, aktive Anfragen ${show(q.sql.activeRequests)}; letzte Transportzeit ${show(q.sql.transportMs, ' ms')}. Alte Fehler sind keine aktuelle Blockade.`,
            History: `${q.externalHistory.status}: ${q.externalHistory.reason}`, CurrentDay: dailyText(current), PreviousDay: dailyText(previous)}};
}
class OperatorDiagnostics {
    constructor(adapter) {
        this.adapter = adapter; this.stopped = false; this.ready = false; this.previous = null;
        this.writer = new LatestStateWriter((id, state) => this.stopped ? undefined : adapter.setStateAsync(id, state));
    }
    async initialize() {
        for (const name of ['Live', 'Recorder', 'SQL', 'History', 'CurrentDay', 'PreviousDay', 'Snapshot_JSON']) {
            if (this.stopped) return;
            await this.adapter.queueCompatState(`${this.adapter.namespace}.Diagnostics.${name}`, '',
                {type: 'string', role: name.endsWith('_JSON') ? 'json' : 'text', read: true, write: false, name: `EMS ${name}`});
        }
        this.ready = !this.stopped;
    }
    publish(snapshot, daily) {
        if (!this.ready || this.stopped) return;
        const now = snapshot.ts, state = key => this.adapter.getCachedState(`${this.adapter.namespace}.Debug.Shadow.${key}`);
        const journal = cachedJSON(state('RecordJournalStatus'), now), delivery = cachedJSON(state('RecordDeliveryStatus'), now);
        const diagnostic = {session: this.adapter.shadowController?.recordSession,
            dropped: this.adapter.shadowController?.recordDropped, writeErrors: this.adapter.shadowController?.recordWriteErrors,
            queue: state('RecordQueueDepth')?.val, backpressure: state('RecordBackpressure')?.val};
        const q = quality({...diagnostic, journal, delivery, previous: this.previous, now,
            oldestUnconfirmedAt: oldestUnconfirmed(this.adapter.decisionRecordJournal?.entries, journal?.unconfirmedRecords)});
        this.previous = diagnostic;
        const report = buildReport(snapshot, q, daily, now);
        const json = JSON.stringify(report);
        if (Buffer.byteLength(json) > MAX_BYTES) throw new Error('Operator diagnostics exceeded bounded state size');
        for (const [key, value] of Object.entries({...report.display, Snapshot_JSON: json}))
            void this.writer.enqueue(`Diagnostics.${key}`, {val: value, ack: true}).catch(e => this.adapter.warnDebug(e));
    }
    stop() { this.stopped = true; }
}
function oldestUnconfirmed(entries, expected) {
    if (!(entries instanceof Map) || !finite(expected) || expected <= 0 || entries.size > 65536) return null;
    let oldest = null, count = 0;
    for (const entry of entries.values()) if (!entry.confirmedStored) {
        count++;
        if (!finite(entry.eventTimestamp) || entry.eventTimestamp <= 0) return null;
        oldest = oldest === null ? entry.eventTimestamp : Math.min(oldest, entry.eventTimestamp);
    }
    // Cached health and live metadata may straddle an append/confirmation.
    return count === expected ? oldest : null;
}
module.exports = {OperatorDiagnostics, cachedJSON, liveExplanation, quality, dailyPeriod, dailyText, buildReport, oldestUnconfirmed, MAX_BYTES};
