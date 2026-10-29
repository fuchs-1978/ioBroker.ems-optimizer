'use strict';
const {decodeDecisionRecords} = require('./decision-record-codec');
const {createHash} = require('node:crypto');
const finite = n => typeof n === 'number' && Number.isFinite(n);
const MAX_RECORDS = 20000, MAX_EVENTS = 100000;
function timeline(input) {
    if (input?.schema !== 1 || !Array.isArray(input.records) || input.records.length > MAX_RECORDS
        || !Array.isArray(input.initialStates) || input.initialStates.length > 4096
        || !Array.isArray(input.inputStateIds) || input.inputStateIds.length > 4096
        || !finite(input.from) || !finite(input.to) || input.to <= input.from)
        throw new Error('Replaymanifest mit begrenzten Records, initialStates, inputStateIds und Zeitfenster erforderlich');
    if (new Set(input.initialStates.map(x => x.id)).size !== input.initialStates.length
        || input.initialStates.some(x => typeof x.id !== 'string' || x.id.length > 512
            || (x.state !== null && (!x.state || typeof x.state !== 'object' || Array.isArray(x.state)))
            || finite(x.state?.ts) && x.state.ts > input.from)) throw new Error('Initialzustand doppelt, ungültig oder aus der Zukunft');
    const allowed = new Set(input.inputStateIds);
    const events = [], issues = [], samples = new Map(), ticks = new Set();
    let session = null, sequence = null, lost = null;
    for (const row of decodeDecisionRecords(input.records)) {
        const r = row?.val && typeof row.val === 'object' ? row.val : row;
        if (r?.reconstruction?.valid === false || r?.reconstruction?.status === 'unknown' || r?.valid === false && !r.production) {
            issues.push({at: r?.timestamp ?? null, reason: 'Nicht rekonstruierbarer Record'}); continue;
        }
        if (!finite(r?.timestamp) || !Number.isSafeInteger(r.recordSequence)) {issues.push({at: null, reason: 'Recordmetadaten fehlen'}); continue;}
        if (session !== null && (session !== r.recordSession || r.recordSequence !== sequence + 1))
            issues.push({at: r.timestamp, reason: 'Sitzungs-/Sequenzlücke; keine kontinuierliche Originalkette'});
        session = r.recordSession; sequence = r.recordSequence;
        const event = r.event;
        if (finite(event?.bufferLost) && lost !== null && event.bufferLost > lost)
            issues.push({at: r.timestamp, reason: 'Quellpufferverluste im Replayfenster'});
        if (finite(event?.bufferLost)) lost = event.bufferLost;
        const raw = event?.type === 'source.update' ? [{id: event.id, state: event.state,
            receivedAt: event.receivedAt ?? event.at ?? r.timestamp, sampleSequence: event.sampleSequence}] : Array.isArray(event?.samples) ? event.samples : [];
        if (raw.length > MAX_EVENTS) throw new Error('Quellereignisgrenze überschritten');
        for (const sample of raw) {
            if (!allowed.has(sample.id) || !finite(sample.receivedAt)) continue;
            if (sample.receivedAt < input.from || sample.receivedAt > input.to) continue;
            const key = JSON.stringify([r.recordSession, sample.id, sample.sampleSequence ?? sample.receivedAt]);
            const value = JSON.stringify(sample.state);
            if (samples.has(key)) {
                if (samples.get(key) !== value) issues.push({at: sample.receivedAt, reason: 'Widersprüchliche Quellduplikate'});
                continue;
            }
            samples.set(key, value);
            events.push({at: sample.receivedAt, kind: 'source', id: sample.id, state: sample.state});
        }
        const at = r.production?.freshness?.control?.ts;
        if (finite(at) && at >= input.from && at <= input.to && at <= r.timestamp) ticks.add(at);
        if (events.length > MAX_EVENTS) throw new Error('Replay-Ereignisgrenze überschritten');
    }
    for (const at of ticks) events.push({at, kind: 'tick'});
    events.sort((a, b) => a.at - b.at || Number(a.kind === 'tick') - Number(b.kind === 'tick'));
    if (!ticks.size) issues.push({at: input.from, reason: 'Keine original belegten Regelzykluszeiten'});
    if (input.sourceCoverage !== 'complete-export') issues.push({at: input.from, reason: 'Vollständiger Quellenexport nicht zugesichert'});
    return {events, issues};
}
function compareRecorded(input, factories) {
    const data = timeline(input);
    if (factories.length !== 2) throw new Error('Genau zwei versionierte Auswerter erforderlich');
    const hash = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
    const inputHash = hash(input), reports = [], traces = [];
    // Never execute across an acknowledged original/source gap. A new export
    // may choose a narrower complete segment; no guessed bases or timestamps.
    if (data.issues.length) return {schema: 1, inputHash, status: 'unknown', issues: data.issues.slice(0, 100), comparedTicks: 0};
    for (const factory of factories) {
        const runner = factory.create(structuredClone(input)), trace = [];
        for (const event of data.events) {
            if (event.kind === 'source') runner.source(event.id, structuredClone(event.state), event.at);
            else trace.push({at: event.at, result: runner.tick(event.at)});
        }
        traces.push(trace); reports.push({version: factory.version, ticks: trace.length, sha256: hash(trace)});
    }
    const unknownTicks = traces[0].filter((x, i) => x.result?.status === 'unknown' || traces[1][i]?.result?.status === 'unknown').length;
    const differences = []; let differenceCount = 0;
    for (let i = 0; i < traces[0].length; i++) if (JSON.stringify(traces[0][i]) !== JSON.stringify(traces[1][i])) {
        differenceCount++;
        if (differences.length < 100) differences.push({at: traces[0][i].at, before: traces[0][i].result, after: traces[1][i].result});
    }
    return {schema: 1, inputHash, status: unknownTicks ? 'partial-open-loop-comparison' : 'open-loop-comparison', unknownTicks, comparedTicks: traces[0].length,
        versions: reports, differences, differenceCount, differenceDetailLimit: 100,
        scope: 'Identische Originaleingänge bei identischem explizitem Kaltstart. Historische Geräteantworten gehören nur zur Originalversion. Keine simulierten Gegenfaktik-Energien, kein geschlossener Anlagenlauf und keine produktiven Schreibrechte.'};
}
module.exports = {timeline, compareRecorded};
