'use strict';

const vm = require('node:vm');
const gridConstraints = require('./grid-constraints');
const heatPumpTelemetryParser = require('./heatpump-telemetry');
const ShadowWallboxModel = require('./shadow-wallbox-model');
const {normalizeWallboxPowerKW} = require('./wallbox-measurement');
const {SMA_GRID_MAX_AGE_MS} = require('./source-diagnostics');
const {DecisionRecordEncoder} = require('./decision-record-codec');
const DiagnosticSampler = require('./diagnostic-sampler');
const {stableReason} = require('./debug-recorder');

const POWER_TARGETS = ['Battery', 'MyPV_DHW', 'MyPV_Heating', 'Wallbox0', 'Wallbox1', 'Wallbox2'];
const CONSUMERS = [...POWER_TARGETS, 'HeatPump'];
const NOTE = 'Isoliertes Ausgangsmodell mit virtueller Befehlsbestaetigung und idealer elektrischer WB-Antwort bei 230 V. Private Netzleistung folgt der modellierten WB-Last; echte Messwerte bleiben separat sichtbar. Reale Schutzwerte, Phasen und SoC bleiben bindend. Keine realen Stellbefehle; EHZ, Speicher und thermische Anlage werden nicht simuliert.';
const ADAPTER_VERSION = require('../package.json').version;
const MAX_SYSTEM_AGE_MS = 30000;
const MAX_PLAN_AGE_MS = 20 * 60000;
const RECORD_QUEUE_LIMIT = 128;
const SOURCE_BATCH_SAMPLES = 128;
const SOURCE_BATCH_BYTES = 32 * 1024;
const SOURCE_BATCH_INTERVAL_MS = 1000;
const RECORD_DIAGNOSTICS = ['RecordSequence', 'RecordDropped', 'RecordWriteErrors',
    'RecordQueueDepth', 'RecordLastError'];

function clone(value) { return value === undefined ? undefined : structuredClone(value); }
function finite(value) {
    return ['number', 'string'].includes(typeof value) && String(value).trim() !== ''
        && Number.isFinite(Number(value)) ? Number(value) : null;
}

function boundedAllocation(value) {
    try {
        if (typeof value === 'string' && value.length > 20000) return null;
        const parsed = typeof value === 'string' ? JSON.parse(value) : value;
        if (!parsed || parsed.schema !== 1 || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
        return {schema: 1, timestamp: finite(parsed.timestamp), valid: typeof parsed.valid === 'boolean' ? parsed.valid : null,
            order: Array.isArray(parsed.order) ? [...new Set(parsed.order.filter(wb => [0, 1, 2].includes(wb)))].slice(0, 3) : null,
            budgetW: finite(parsed.budgetW), hardBudgetW: finite(parsed.hardBudgetW),
            slowBudgetW: finite(parsed.slowBudgetW), voltage: finite(parsed.voltage),
            minimumTotalW: finite(parsed.minimumTotalW), mandatoryGridW: finite(parsed.mandatoryGridW),
            allocations: Array.isArray(parsed.allocations) ? parsed.allocations.filter(a => [0, 1, 2].includes(a?.wb)).slice(0, 3)
                .map(a => ({wb: a.wb, authorized: typeof a.authorized === 'boolean' ? a.authorized : null,
                    targetA: finite(a.targetA), phases: [1, 3].includes(a.phases) ? a.phases : null,
                    reservedW: finite(a.reservedW), minimumW: finite(a.minimumW)})) : null,
            waiting: Array.isArray(parsed.waiting) ? parsed.waiting.filter(w => [0, 1, 2].includes(w?.wb)).slice(0, 3)
                .map(w => ({wb: w.wb, reason: typeof w.reason === 'string' ? w.reason.slice(0, 600) : null})) : null};
    } catch { return null; }
}
function parallelStable(value) {
    if (!value) return null;
    return {enabled: value.enabled, valid: value.allocation?.valid ?? null, active: value.active,
        order: value.allocation?.order ?? null,
        allocations: value.allocation?.allocations?.map(({wb, authorized, targetA, phases, minimumW}) =>
            ({wb, authorized, targetA, phases, minimumW})) ?? null,
        waiting: value.allocation?.waiting ?? null};
}

/** Production decisions plus a private instance of the production WB output
 * state machine. Electrical WB response and acknowledgements are assumed;
 * raw measurements, availability, protection and phases stay separately visible.
 */
class ShadowController {
    constructor(adapter, {createContext, now = () => Date.now()} = {}) {
        this.adapter = adapter;
        this.createContext = createContext;
        this.now = now;
        this.enabled = true;
        this.initialized = false;
        this.stopped = false;
        this.context = null;
        this.contextKey = '';
        this.states = new Map();
        this.derived = new Map();
        this.violation = '';
        this.pending = new Map();
        this.replacements = new Map();
        this.historyIds = [];
        this.model = null;
        this.busy = false;
        this.generation = 0;
        this.cycleId = 0;
        this.lastRecordKey = '';
        this.lastRecordAt = 0;
        this.recordQueue = [];
        this.recordWriting = false;
        this.recordSequence = 0;
        this.recordDropped = 0;
        this.recordWriteErrors = 0;
        this.recordLastError = '';
        this.recordSession = this.now();
        this.recordEncoder = new DecisionRecordEncoder();
        this.diagnosticSampler = new DiagnosticSampler();
        this.sourceBatch = [];
        this.sourceBatchBytes = 0;
        this.lastProductionSafetyKey = '';
        this.commandSequence = 0;
        this.productionCommands = new Map();
        this.lastProductionKey = '';
        this.lastProductionAt = 0;
        this.wasProductive = false;
        this.scalarFrame = null;
        this.scalarNextFrame = null;
        this.scalarWriting = false;
        this.scalarSkippedCycles = 0;
        this.scalarPublishErrors = 0;
    }

    id(key) { return `${this.adapter.namespace}.Debug.Shadow.${key}`; }
    own(key) { return this.states.get(`${this.adapter.namespace}.${key}`)?.val; }
    live(key) { return this.adapter.getCachedState(`${this.adapter.namespace}.${key}`); }

    masterEnabled() {
        return this.adapter.config.globalWriteEnabled === true || this.live('System.RealOutputsEnabled')?.val === true;
    }

    trackingProduction() {
        return this.masterEnabled() || this.wasProductive
            || (this.adapter.wallboxOutput?.devices || []).some(d => d.owned || d.stopRequest || d.pending || d.response)
            || POWER_TARGETS.some(name => this.live(`Devices.${name}.OutputOwned`)?.val === true
                || this.live(`Devices.${name}.OutputActive`)?.val === true);
    }

    // Reuse the existing serialized DecisionRecord queue and SQL source. This
    // is a cache frame, not an assertion of simultaneous electrical sources.
    productionRecord(event = null) {
        if (!this.initialized || this.stopped || this.adapter.unloading) return;
        if (!['recording.sources', 'recording.pre_event'].includes(event?.type))
            this.flushSourceBatch(Boolean(event));
        const master = this.masterEnabled();
        const armed = this.adapter.config.globalWriteEnabled === true && this.live('System.RealOutputsEnabled')?.val === true;
        if (!this.trackingProduction() && !event) return;
        const snapshot = this.adapter.debugRecorder?.snapshot();
        const production = snapshot ? {...snapshot,
            commands: Object.fromEntries([...this.productionCommands].map(([id, command]) => [id,
                {...command, source: clone(this.adapter.getCachedState(id) ?? null)}])),
            timers: Object.fromEntries(['WallboxStartDelay_s', 'WallboxMinimumRunTime_s', 'WallboxStopDelay_s']
                .map(key => [key, this.live(`Config.${key}`)?.val ?? null])),
            responseDeadlines: (this.adapter.wallboxOutput?.devices || []).map(d => ({wb: d.wb,
                ackMs: this.adapter.wallboxOutput.feedbackTimeoutMs?.(d) ?? null,
                electricalMs: this.adapter.wallboxOutput.responseSettleTimeoutMs?.() ?? null,
                phaseMs: this.adapter.wallboxOutput.phaseSwitchTimeoutMs?.() ?? null})),
            deviceRuntime: (this.adapter.wallboxOutput?.devices || []).map(d => ({wb: d.wb,
                pending: clone(d.pending ?? null), response: clone(d.response ?? null),
                measuredBudgetStep: clone(d.measuredBudgetStep ?? null),
                stopRequest: clone(d.stopRequest ?? null), phaseRequest: clone(d.phaseRequest ?? null)}))}
            : {available: false, reason: 'Produktivsnapshot nicht verfuegbar'};
        // Quiet snapshots are sparse; event windows retain original source
        // updates. Each emitted frame still contains its actual cache times.
        // Dispatch encodes lossless deltas between EMITTED full decisions,
        // not an assertion that omitted quiet ticks were reconstructed.
        const protectionFeedback = this.realProtectionFeedback();
        const realFeedback = Object.fromEntries([0, 1, 2].map(wb => [`Wallbox${wb}`, this.realWallboxFeedback(wb)]));
        const elapsedMs = this.now() - this.lastProductionAt;
        // Protection validity and output/response transitions are never held
        // for a quiet interval. Numeric readings and countdown ticks are not
        // themselves new decisions; commands have their own immediate hooks.
        const safetyKey = JSON.stringify({master, armed, controlValid: this.live('Control.Valid')?.val,
            feedback: Object.fromEntries(Object.entries(realFeedback).map(([wb, feedback]) => [wb,
                Object.fromEntries(Object.entries(feedback).map(([field, s]) => [field,
                    {value: ['powerKW', 'soc'].includes(field) ? undefined
                        : /reason/i.test(field) ? stableReason(s.value) : s.value,
                        fresh: s.fresh, issue: s.issue, ack: s.ack, q: s.q}]))])),
            protection: Object.fromEntries(Object.entries(protectionFeedback).map(([id, s]) =>
                [id, {id: s?.id, valid: s?.valid, issue: s?.issue, ack: s?.ack, q: s?.q}])),
            wallboxes: production.wallboxes?.map(w => Object.fromEntries(Object.entries(w)
                .filter(([k]) => /Reason|State|Fault|Pending|Owned|Active|Valid|ConfirmedAt|AcknowledgedAt/.test(k))
                .map(([k, v]) => [k, /Reason/.test(k) ? stableReason(v) : v]))),
            timerBoundaries: production.wallboxes?.map(w => Object.fromEntries(Object.entries(w)
                .filter(([k]) => /Remaining_s$/.test(k)).map(([k, v]) => [k, v == null ? null : v <= 0])))});
        const safetyEdge = safetyKey !== this.lastProductionSafetyKey;
        if (safetyEdge && this.lastProductionSafetyKey
            && (!event || event.type === 'recording.sources')) this.recordEventWindow();
        const summary = !event ? this.diagnosticSampler.summary(this.now()) : null;
        if (!event && !safetyEdge && !summary && elapsedMs >= 0
            && elapsedMs < (this.now() <= this.diagnosticSampler.denseUntil ? 1000 : 30000)) return;
        if (summary) event = {type: 'recording.interval', at: this.now(), summary};
        this.enqueueRecord({schema: 2, adapterVersion: ADAPTER_VERSION, timestamp: this.now(),
            cycleId: ++this.cycleId, mode: armed ? 'PRODUCTION' : master ? 'PRODUCTION_GATE_INCOMPLETE' : 'MASTER_OFF',
            masterEnabled: master, valid: false, modelPaused: true,
            reason: 'Schattenmodell pausiert; Produktivfreigabe und Realtelemetrie separat bewertet',
            controlState: {globalWriteEnabled: this.adapter.config.globalWriteEnabled === true,
                realOutputsEnabled: this.live('System.RealOutputsEnabled')?.val ?? null,
                observerOnly: this.adapter.config.observerOnly ?? null},
            protectionFeedback, realFeedback,
            production, event, sampling: {schema: 1, quietIntervalMs: 30000,
                preEventMs: 60000, postEventMs: 120000,
                sourceBatchIntervalMs: SOURCE_BATCH_INTERVAL_MS,
                sourceBatchMaxSamples: SOURCE_BATCH_SAMPLES,
                sourceBatchTargetBytes: SOURCE_BATCH_BYTES,
                denseUntil: this.diagnosticSampler.denseUntil,
                bufferLost: this.diagnosticSampler.lost,
                note: 'Quiet intervals are sampled; pre-event samples are raw source observations, not historical full decisions'}});
        this.lastProductionKey = safetyKey;
        this.lastProductionAt = this.now();
        this.lastProductionSafetyKey = safetyKey;
        this.wasProductive = master;
    }

    commandEvent(stage, id, value, commandId = null, error = '') {
        const token = commandId || `${this.recordSession}:command:${++this.commandSequence}`;
        const event = {type: `command.${stage}`, commandId: token, id, value,
            at: this.now(), error: String(error).slice(0, 200)};
        const previous = this.productionCommands.get(id);
        this.productionCommands.set(id, {...event,
            issuedAt: previous?.commandId === token ? previous.issuedAt : event.at,
            sourceObservedAt: previous?.commandId === token ? previous.sourceObservedAt ?? null : null});
        // Only configured output paths call this hook; bound even a faulty caller.
        if (this.productionCommands.size > 16) this.productionCommands.delete(this.productionCommands.keys().next().value);
        if ((stage === 'attempt' && (!previous || previous.value !== value)) || error)
            this.recordEventWindow();
        this.productionRecord(event);
        return token;
    }

    captureProduction(id, state, previous) {
        if (!this.initialized || this.stopped || this.adapter.unloading) return;
        const outputEdge = id.startsWith(`${this.adapter.namespace}.Devices.`)
            && /\.(OutputOwned|OutputActive|ResponseState|ResponseAcknowledgedAt|ResponseConfirmedAt|StopConfirmedAt|StopPowerPending|OutputFault)$/.test(id);
        if (!this.trackingProduction() && !(outputEdge && previous?.val === true)) return;
        if (outputEdge) {
            if (state?.val !== previous?.val) {
                this.recordEventWindow();
                this.productionRecord({type: 'output.state', id, state: clone(state ?? null)});
            }
            return;
        }
        if (id === `${this.adapter.namespace}.System.RealOutputsEnabled`) {
            if (state?.val !== previous?.val || state?.ack !== previous?.ack)
                { this.recordEventWindow(); this.productionRecord({type: 'master.change', id, state: clone(state ?? null)}); }
            return;
        }
        // Preserve actual ACK/source edges before another poll overwrites them,
        // including NULL. Other scalar publications remain cache frames only.
        const mapping = this.adapter.readMapping();
        const ids = new Set((this.adapter.wallboxOutput?.devices || []).flatMap(d => [
            ...Object.values(d.ids), mapping[`DP_WB${d.wb}_CAR`], mapping[`DP_WB${d.wb}_POWER`],
            ...[1, 2, 3].map(p => mapping[`DP_WB${d.wb}_L${p}_A`])]));
        for (const source of this.productionCommands.keys()) ids.add(source);
        const powerIds = new Set([mapping.DP_GRID_IMPORT, mapping.DP_GRID_EXPORT, mapping.DP_PV_POWER,
            ...[0, 1, 2].map(wb => mapping[`DP_WB${wb}_POWER`])].filter(Boolean));
        for (const [key, source] of Object.entries(mapping))
            if (/DHW_OUTPUT[123]|HEATING_OUTPUT[123]|BATTERY_AC_POWER/.test(key) && source) powerIds.add(source);
        for (const [key, source] of Object.entries(mapping))
            if (/GRID_|PV_POWER|HA_L[123]|BATTERY|DHW|HEATING|HEATPUMP/.test(key) && typeof source === 'string') ids.add(source);
        if (ids.has(id) && JSON.stringify(state) !== JSON.stringify(previous)) {
            const analog = powerIds.has(id) || [0, 1, 2].some(wb => [1, 2, 3]
                .some(p => mapping[`DP_WB${wb}_L${p}_A`] === id)) || ![...(this.adapter.wallboxOutput?.devices || [])
                .flatMap(d => Object.values(d.ids)), ...this.productionCommands.keys(),
                ...[0, 1, 2].map(wb => mapping[`DP_WB${wb}_CAR`])].includes(id);
            const result = this.diagnosticSampler.observe(id, state, previous, this.now(),
                {discrete: !analog, maxGapMs: powerIds.has(id) || !analog
                    || /HA_L[123]/.test(Object.keys(mapping).find(key => mapping[key] === id) || '')
                    || [0, 1, 2].some(wb => [1, 2, 3].some(p => mapping[`DP_WB${wb}_L${p}_A`] === id))
                    ? 10000 : 120000,
                    powerScale: powerIds.has(id)
                    ? [0, 1, 2].some(wb => mapping[`DP_WB${wb}_POWER`] === id) ? 1000 : 1 : 0});
            const command = this.productionCommands.get(id);
            // Repeated polls of an unchanged acknowledged output are routine,
            // but the first matching source observation AFTER each command
            // must remain immediate, including a shutdown's same-value zero.
            // This records the observation, not an electrical/ACK acceptance.
            const commandObservation = command && command.sourceObservedAt == null
                && state?.ack === true && (state.q === undefined || state.q === 0)
                && state.ts > command.issuedAt && state.val === command.value;
            if (commandObservation) command.sourceObservedAt = result.sample.receivedAt;
            if (result.important || commandObservation) this.recordEventWindow();
            if (result.important || commandObservation)
                this.productionRecord({type: 'source.update', id, state: clone(state ?? null),
                    receivedAt: result.sample.receivedAt, sampleSequence: result.sample.sampleSequence,
                    triggerReason: result.reason || 'post-command-observation'});
            else if (result.dense) this.addSourceSample(result.sample);
        }
    }

    addSourceSample(sample) {
        const bytes = Buffer.byteLength(JSON.stringify(sample));
        if (this.sourceBatch.length && (this.sourceBatch.length >= SOURCE_BATCH_SAMPLES
            || this.sourceBatchBytes + bytes > SOURCE_BATCH_BYTES)) this.flushSourceBatch(true);
        this.sourceBatch.push(sample);
        this.sourceBatchBytes += bytes;
        this.flushSourceBatch();
    }

    flushSourceBatch(force = false) {
        if (!this.sourceBatch.length || this.stopped || this.adapter.unloading) return;
        const at = this.now();
        if (!force && at >= this.sourceBatch[0].receivedAt
            && at - this.sourceBatch[0].receivedAt < SOURCE_BATCH_INTERVAL_MS
            && at <= this.diagnosticSampler.denseUntil) return;
        const samples = this.sourceBatch;
        this.sourceBatch = [];
        this.sourceBatchBytes = 0;
        this.diagnosticSampler.markDelivered(samples.at(-1).sampleSequence);
        this.productionRecord({type: 'recording.sources', schema: 1, at,
            actualStart: samples[0].receivedAt, actualEnd: samples.at(-1).receivedAt,
            samples, bufferLost: this.diagnosticSampler.lost});
    }

    recordEventWindow() {
        // A delayed tick must not let expiry of the pre-ring silently discard
        // still-pending dense observations. Deliver them before pruning it.
        this.flushSourceBatch(true);
        const window = this.diagnosticSampler.trigger(this.now());
        // Pending dense observations are part of the trigger's raw ring. Do
        // not send them a second time; earlier emitted batches are excluded.
        this.sourceBatch = [];
        this.sourceBatchBytes = 0;
        // Bounded batches avoid placing an entire ring in one SQL value.
        const samples = window.samples;
        let batch = [], bytes = 0;
        const emit = () => this.productionRecord({type: 'recording.pre_event',
            ...window, samples: batch});
        for (const sample of samples) {
            const size = Buffer.byteLength(JSON.stringify(sample));
            if (batch.length && (batch.length >= SOURCE_BATCH_SAMPLES || bytes + size > SOURCE_BATCH_BYTES)) {
                emit(); batch = []; bytes = 0;
            }
            batch.push(sample); bytes += size;
        }
        if (batch.length) emit();
    }

    publish(key, value) {
        if (this.stopped || this.adapter.unloading) return;
        if (this.scalarFrame) { this.scalarFrame.set(key, clone(value)); return; }
        // Bounded asynchronous writes: one in flight and one latest replacement.
        if (this.pending.has(key)) { this.replacements.set(key, value); return; }
        let promise;
        try { promise = Promise.resolve(this.adapter.setCompatState(this.id(key), value, true)); }
        catch { return; }
        this.pending.set(key, promise);
        void promise.catch(() => {}).then(() => {
            this.pending.delete(key);
            if (this.replacements.has(key)) {
                const latest = this.replacements.get(key);
                this.replacements.delete(key);
                this.publish(key, latest);
            }
        });
    }

    beginScalarFrame() { this.scalarFrame = new Map(); }

    finishScalarFrame() {
        const frame = this.scalarFrame;
        this.scalarFrame = null;
        if (!frame || this.stopped || this.adapter.unloading) return;
        if (this.scalarNextFrame) this.scalarSkippedCycles++;
        this.scalarNextFrame = frame;
        this.drainScalarFrames();
    }

    drainScalarFrames() {
        if (this.scalarWriting || !this.scalarNextFrame || this.stopped || this.adapter.unloading) return;
        const frame = this.scalarNextFrame;
        this.scalarNextFrame = null;
        this.scalarWriting = true;
        const write = (key, value) => Promise.resolve().then(() => {
            if (!this.stopped && !this.adapter.unloading)
                return this.adapter.setCompatState(this.id(key), value, true);
        });
        // One completed decision at a time. The completion marker is written
        // only after all its scalars; a failed/partial frame cannot commit.
        // Slow scalar storage coalesces whole frames, never individual fields.
        const commitKeys = ['CycleId', 'LastUpdate'];
        const pending = Promise.allSettled([...frame].filter(([key]) => !commitKeys.includes(key))
            .map(([key, value]) => write(key, value))).then(async results => {
            if (results.some(result => result.status === 'rejected'))
                throw new Error('Skalarer Entscheidungszyklus unvollstaendig');
            await write('ScalarSkippedCycles', this.scalarSkippedCycles);
            await write('ScalarPublishErrors', this.scalarPublishErrors);
            await write('LastUpdate', frame.get('LastUpdate'));
            await write('CycleId', frame.get('CycleId'));
            await write('ScalarCycleId', frame.get('CycleId'));
        }).catch(() => {
            this.scalarPublishErrors++;
            this.publish('ScalarPublishErrors', this.scalarPublishErrors);
        }).finally(() => {
            this.scalarWriting = false;
            if (this.pending.get('ScalarFrame') === pending) this.pending.delete('ScalarFrame');
            this.drainScalarFrames();
        });
        this.pending.set('ScalarFrame', pending);
    }

    publishRecordHealth() {
        this.publish('RecordSequence', this.recordSequence);
        this.publish('RecordDropped', this.recordDropped);
        this.publish('RecordWriteErrors', this.recordWriteErrors);
        this.publish('RecordQueueDepth', this.recordQueue.length + (this.recordWriting ? 1 : 0));
        this.publish('RecordLastError', this.recordLastError);
    }

    enqueueRecord(record) {
        if (this.stopped || this.adapter.unloading) return;
        const entry = {...clone(record), recordSession: this.recordSession,
            recordSequence: ++this.recordSequence};
        if (this.recordQueue.length >= RECORD_QUEUE_LIMIT) {
            // Keep the newest bounded history but never replace the in-flight
            // record. A sequence gap and cumulative counter make loss explicit.
            this.recordQueue.shift();
            this.recordDropped++;
            this.recordLastError = 'Entscheidungswarteschlange voll; aeltester wartender Datensatz verworfen';
        }
        this.recordQueue.push(entry);
        this.drainRecords();
        this.publishRecordHealth();
    }

    discardRecords() {
        this.recordDropped += this.recordQueue.length;
        this.recordQueue.length = 0;
    }

    drainRecords() {
        if (this.recordWriting) return;
        if (this.stopped || this.adapter.unloading) { this.discardRecords(); return; }
        const record = this.recordQueue.shift();
        if (!record) return;
        this.recordWriting = true;
        // Attach health at dispatch, so the very next surviving SQL record
        // already identifies overflows or a failed earlier persistence attempt.
        // Encode only at dispatch, after queue losses are known. Full frames
        // stay immutable in the FIFO; a discarded predecessor can never leave
        // the next published delta pointing at a frame we did not publish.
        let write;
        try {
            const value = JSON.stringify(this.recordEncoder.encode({...record,
                recording: {dropped: this.recordDropped,
                    writeErrors: this.recordWriteErrors, lastError: this.recordLastError}}));
            write = Promise.resolve(this.adapter.setCompatState(this.id('DecisionRecord'), value, true));
        }
        catch (error) { write = Promise.reject(error); }
        const completion = write.catch(error => {
            this.recordEncoder.reset();
            this.recordWriteErrors++;
            this.recordLastError = `Entscheidungsdatensatz konnte nicht bestaetigt werden: ${String(error?.message || error).slice(0, 200)}`;
        }).then(() => {
            this.pending.delete('DecisionRecord');
            this.recordWriting = false;
            this.drainRecords();
            this.publishRecordHealth();
        });
        this.pending.set('DecisionRecord', completion);
    }

    async initialize() {
        const definitions = {
            Enabled: [true, 'boolean', 'switch.enable', 'Schattenregler aktivieren', true],
            Valid: [false, 'boolean', 'indicator', 'Schattenentscheidung gueltig'],
            LastUpdate: [0, 'number', 'value.time', 'Zeitpunkt der Schattenentscheidung'],
            Summary: ['', 'string', 'text', 'Was der EMS-Regler jetzt entscheiden wuerde'],
            Snapshot_JSON: ['{}', 'string', 'json', 'Schattenentscheidung mit Gruenden und Messwerten'],
            DecisionRecord: ['{}', 'string', 'text', 'Sitzung/Sequenz: Schattenmodell oder produktive Entscheidung, Befehle und echte Rueckmeldungen'],
            RecordSequence: [0, 'number', 'value', 'Letzte Datensatznummer innerhalb dieser Adapterlaufzeit'],
            RecordDropped: [0, 'number', 'value', 'Verworfene Entscheidungsdatensaetze dieser Adapterlaufzeit'],
            RecordWriteErrors: [0, 'number', 'value', 'Nicht bestaetigte Schreibversuche fuer Entscheidungsdatensaetze'],
            RecordQueueDepth: [0, 'number', 'value', 'Wartende und laufende Entscheidungsdatensatz-Schreibvorgaenge, maximal 129'],
            RecordLastError: ['', 'string', 'text', 'Letzte Stoerung beim Aufzeichnen von Entscheidungsdatensaetzen'],
            ScalarCycleId: [0, 'number', 'value', 'Abgeschlossener skalarer Entscheidungszyklus; kein atomarer SQL-Datensatz'],
            ScalarSkippedCycles: [0, 'number', 'value', 'Bei langsamer Speicherung uebersprungene skalare Zyklen'],
            ScalarPublishErrors: [0, 'number', 'value', 'Fehlgeschlagene skalare Entscheidungszyklen'],
            CycleId: [0, 'number', 'value', 'Schattenzyklus; Zuordnung erfolgt ueber DecisionRecord'],
            SelectedWallbox: [-1, 'number', 'value', 'Ausgewaehlte Wallbox, -1 = keine'],
            ActiveWallboxes_JSON: ['[]', 'string', 'json', 'Geplante Schatten-Teilnehmer; keine reale Aktivitaetsliste'],
            ParallelWallboxAllocation_JSON: ['{}', 'string', 'json', 'Gemeinsame hypothetische Wallboxzuteilung'],
            ParallelWallboxStatus: ['', 'string', 'text', 'Begruendung der gemeinsamen hypothetischen Wallboxzuteilung'],
            FineRegulator: ['none', 'string', 'text', 'Verbraucher fuer die Feinregelung'],
            'Response.Valid': [false, 'boolean', 'indicator', 'Quellen fuer angenommene elektrische WB-Antwort gueltig'],
            'Response.Grid_W': [null, 'number', 'value.power', 'Netzleistung mit angenommener WB-Antwort; keine Messung', false, 'W'],
            'Response.Reason': ['', 'string', 'text', 'Grund fuer unbekannte oder ungueltige Schattenantwort'],
            'Response.TimingState': ['invalid-source', 'string', 'text', 'Aktuelle, historisch zugeordnete oder ausstehende gemeinsame Messbasis'],
            'Response.InputTimestamp': [null, 'number', 'value.time', 'Zeitpunkt der gemeinsamen historischen Messbasis; null bei aktueller oder fehlender Basis'],
            'Response.InputAge_ms': [null, 'number', 'value.interval', 'Alter der historischen Messbasis; keine aktuelle Messung', false, 'ms'],
            'Targets.HeatPumpMode': ['NORMAL', 'string', 'text', 'Hypothetische WP-Empfehlung'],
            'Targets.HeatPumpModeValue': [1, 'number', 'value', 'WP: 0 reduziert, 1 normal, 2 Boost'],
            'HeatPump.Valid': [false, 'boolean', 'indicator', 'WP-Empfehlung gueltig'],
            'BHKW.Energy_kWh': [null, 'number', 'value.energy', 'BHKW-Erzeugungszaehler; null = unbekannt', false, 'kWh'],
            'BHKW.Valid': [false, 'boolean', 'indicator', 'BHKW-Leistungsmessung gueltig'],
            'BHKW.Quality_JSON': ['{}', 'string', 'json', 'BHKW-Quellenalter, ACK und Qualitaet']
        };
        for (const name of POWER_TARGETS) definitions[`Targets.${name}_W`] = [0, 'number', 'value.power',
            `${name}: hypothetisches Leistungsbudget; Batterie positiv = Laden`, false, 'W'];
        for (const name of ['Grid', 'PV', 'BHKW', ...CONSUMERS]) definitions[`Actuals.${name}_W`] = [null, 'number',
            'value.power', `${name}: gemessene Leistung; null = fehlt/veraltet`, false, 'W'];
        for (const name of CONSUMERS) definitions[`${name}.Summary`] = ['', 'string', 'text', `${name}: Entscheidungsgrund`];
        for (const name of POWER_TARGETS) definitions[`${name}.OutputBlockReason`] = ['', 'string', 'text',
            `${name}: bekannte Sperre vor einer echten Ausgabe; Budget ist kein Stellbefehl`];
        for (const wb of [0, 1, 2]) {
            definitions[`Targets.Wallbox${wb}_A`] = [0, 'number', 'value.current', `WB${wb}: hypothetischer Ladestrom`, false, 'A'];
            definitions[`Targets.Wallbox${wb}_Phases`] = [1, 'number', 'value', `WB${wb}: hypothetische Phasenanzahl`];
            definitions[`Wallbox${wb}.StartDelayRemaining_s`] = [0, 'number', 'value.interval', `WB${wb}: eigene Schatten-Startverzoegerung`, false, 's'];
            definitions[`Wallbox${wb}.MinimumRunTimeRemaining_s`] = [0, 'number', 'value.interval', `WB${wb}: modellierte Mindestlaufzeit, keine reale Bestaetigung`, false, 's'];
            definitions[`Wallbox${wb}.StopDelayRemaining_s`] = [0, 'number', 'value.interval', `WB${wb}: modellierte Abschaltverzoegerung`, false, 's'];
            definitions[`Wallbox${wb}.ModelOwned`] = [false, 'boolean', 'indicator', `WB${wb}: nur virtuell uebernommen`];
            definitions[`Wallbox${wb}.ModelStatus`] = ['', 'string', 'text', `WB${wb}: Status des isolierten Ausgangsmodells`];
            definitions[`Wallbox${wb}.ResponseState`] = ['idle', 'string', 'text', `WB${wb}: modellierte Befehls-/Fahrzeugantwort; keine reale Bestaetigung`];
            definitions[`Wallbox${wb}.ResponsePending`] = [false, 'boolean', 'indicator', `WB${wb}: ausstehende Modellantwort`];
            definitions[`Wallbox${wb}.ResponseRemaining_s`] = [0, 'number', 'value.interval', `WB${wb}: Restfrist fuer die Modellantwort`, false, 's'];
            definitions[`Modeled.Wallbox${wb}_W`] = [0, 'number', 'value.power', `WB${wb}: modellierte Ausgabe, keine Messung`, false, 'W'];
            definitions[`Modeled.Wallbox${wb}_A`] = [0, 'number', 'value.current', `WB${wb}: modellierter Ladestrom`, false, 'A'];
            definitions[`Modeled.Wallbox${wb}_Phases`] = [1, 'number', 'value', `WB${wb}: reale bestaetigte Phasen im Ausgangsmodell`];
        }
        this.historyIds = Object.keys(definitions).filter(key => !['Enabled', 'LastUpdate', 'Snapshot_JSON', 'BHKW.Quality_JSON',
            'ActiveWallboxes_JSON', 'ParallelWallboxAllocation_JSON', 'CycleId', 'ScalarCycleId', 'ScalarSkippedCycles', 'ScalarPublishErrors', ...RECORD_DIAGNOSTICS].includes(key))
            .map(key => this.id(key));
        for (const [key, [value, type, role, name, write, unit]] of Object.entries(definitions)) {
            await this.adapter.queueCompatState(this.id(key), value,
                {type, role, name, read: true, write: write === true, ...(unit ? {unit} : {})});
            if (this.stopped || this.adapter.unloading) return;
        }
        this.enabled = this.adapter.getCachedState(this.id('Enabled'))?.val !== false;
        this.initialized = true;
        this.invalidate('Schattenregler wartet auf frische Messwerte und Fahrplan');
    }

    handleCommand(id, state) {
        if (id !== this.id('Enabled') || !state || state.ack !== false) return false;
        if (typeof state.val === 'boolean') this.enabled = state.val;
        this.publish('Enabled', this.enabled);
        this.context = null;
        this.invalidate(this.enabled ? 'Schattenregler neu aktiviert; naechster Messzyklus folgt' : 'Schattenregler deaktiviert');
        return true;
    }

    invalidate(reason) {
        this.beginScalarFrame();
        this.generation++;
        this.model?.stop();
        this.model = null;
        this.context = null;
        this.derived.clear();
        this.publish('Valid', false);
        this.publish('SelectedWallbox', -1);
        this.publish('ActiveWallboxes_JSON', '[]');
        this.publish('ParallelWallboxAllocation_JSON', '{}');
        this.publish('ParallelWallboxStatus', reason);
        this.publish('FineRegulator', 'none');
        this.publish('Response.Valid', false);
        this.publish('Response.Grid_W', null);
        this.publish('Response.Reason', reason);
        this.publish('Response.TimingState', 'invalid-source');
        this.publish('Response.InputTimestamp', null);
        this.publish('Response.InputAge_ms', null);
        this.publish('HeatPump.Valid', false);
        this.publish('Targets.HeatPumpMode', 'NORMAL');
        this.publish('Targets.HeatPumpModeValue', 1);
        for (const name of POWER_TARGETS) this.publish(`Targets.${name}_W`, 0);
        for (const name of CONSUMERS) this.publish(`${name}.Summary`, reason);
        for (const name of POWER_TARGETS) this.publish(`${name}.OutputBlockReason`, reason);
        for (const wb of [0, 1, 2]) {
            this.publish(`Targets.Wallbox${wb}_A`, 0);
            this.publish(`Targets.Wallbox${wb}_Phases`, 1);
            this.publish(`Wallbox${wb}.StartDelayRemaining_s`, 0);
            this.publish(`Wallbox${wb}.MinimumRunTimeRemaining_s`, 0);
            this.publish(`Wallbox${wb}.StopDelayRemaining_s`, 0);
            this.publish(`Wallbox${wb}.ModelOwned`, false);
            this.publish(`Wallbox${wb}.ModelStatus`, reason);
            this.publish(`Wallbox${wb}.ResponseState`, 'idle');
            this.publish(`Wallbox${wb}.ResponsePending`, false);
            this.publish(`Wallbox${wb}.ResponseRemaining_s`, 0);
            this.publish(`Modeled.Wallbox${wb}_W`, 0);
            this.publish(`Modeled.Wallbox${wb}_A`, 0);
            this.publish(`Modeled.Wallbox${wb}_Phases`, 1);
        }
        for (const name of ['Grid', 'PV', 'BHKW', ...CONSUMERS]) this.publish(`Actuals.${name}_W`, null);
        this.publish('BHKW.Energy_kWh', null);
        this.publish('BHKW.Valid', false);
        this.publish('BHKW.Quality_JSON', JSON.stringify({status: reason}));
        this.publish('Summary', reason);
        const record = {adapterVersion: ADAPTER_VERSION, cycleId: ++this.cycleId, timestamp: this.now(), valid: false, reason, note: NOTE,
            protectionFeedback: this.realProtectionFeedback(),
            masterEnabled: this.adapter.config.globalWriteEnabled === true || this.live('System.RealOutputsEnabled')?.val === true,
            realFeedback: Object.fromEntries([0, 1, 2].map(wb => [`Wallbox${wb}`, this.realWallboxFeedback(wb)]))};
        this.publish('Snapshot_JSON', JSON.stringify(record));
        if (record.masterEnabled) this.productionRecord();
        else this.publishRecord(record);
        this.publish('CycleId', this.cycleId);
        this.publish('LastUpdate', this.now());
        this.finishScalarFrame();
    }

    fresh(state, maxAgeMs, requireAck = true) {
        const age = this.now() - Number(state?.ts);
        return Boolean(state && (!requireAck || state.ack === true) && (!state.q || Number(state.q) === 0)
            && Number(state.ts) > 0 && age >= -1000 && age <= maxAgeMs);
    }

    checkInputs() {
        if (this.adapter.config.globalWriteEnabled === true || this.live('System.RealOutputsEnabled')?.val === true)
            return 'Schattenregler pausiert: Master EIN; echte Reglerentscheidung unter Debug/Control';
        for (const [prefix, maxAge] of [['System', MAX_SYSTEM_AGE_MS], ['Plan', MAX_PLAN_AGE_MS]]) {
            const state = this.live(`${prefix}.${prefix === 'System' ? 'DataValid' : 'Valid'}`);
            const update = this.live(`${prefix}.LastUpdate`);
            const stamp = finite(update?.val);
            if (state?.val !== true || state.ack !== true || (state.q && Number(state.q) !== 0)
                || !this.fresh(update, maxAge) || stamp === null || stamp <= 0
                || stamp > this.now() + 1000 || this.now() - stamp > maxAge)
                return `${prefix === 'System' ? 'Messwerte' : 'Fahrplan'} fehlen, sind ungueltig oder veraltet`;
        }
        // An unfinished real output handoff must not become shadow ownership.
        // Wait until the actual output controllers have safely relinquished it.
        for (const name of POWER_TARGETS) {
            const base = `Devices.${name}.`;
            if (this.live(`${base}OutputOwned`)?.val === true
                || this.live(`${base}OutputActive`)?.val === true
                || ['OutputReservedPower_W', 'OutputReservedCharge_W', 'OutputUnobservedCommand_W',
                    'OutputReservedPhase1_W', 'OutputReservedPhase2_W', 'OutputReservedPhase3_W']
                    .some(key => Math.abs(finite(this.live(base + key)?.val) || 0) > 0)
                || this.live(`${base}OutputReservationPending`)?.val === true)
                return `${name}: reale Ausgangsuebergabe/Reservierung noch offen; Schattenregler pausiert`;
        }
        return '';
    }

    prepareContext() {
        const key = JSON.stringify([this.adapter.config, this.adapter.readMapping()]);
        if (!this.context || this.contextKey !== key) {
            this.derived.clear();
            this.model?.stop();
            this.model = null;
        }
        this.states = new Map();
        for (const [id, state] of this.adapter.stateCache) {
            if (!id.startsWith(`${this.adapter.namespace}.Debug.`)) this.states.set(id, clone(state));
        }
        const root = `${this.adapter.namespace}.`;
        const local = (key, value) => this.states.set(root + key, {val: value, ack: true, ts: this.now(), q: 0});
        // Reset all generated targets/selection; no live controller targets or
        // countdown diagnostics can seed a new shadow decision.
        for (const key of [...this.states.keys()]) {
            if (key.startsWith(root + 'Control.Targets.') || key === root + 'Control.Valid'
                || key === root + 'Control.LastUpdate' || key === root + 'Control.SelectedWallbox'
                || ['Control.ActiveWallboxes_JSON', 'Control.ParallelWallboxAllocation_JSON',
                    'Control.ParallelWallboxStatus'].some(name => key === root + name)
                || key === root + 'Control.WallboxSelectionReason'
                || key === root + 'Control.FineRegulator'
                || /\.Vehicles\.Wallbox[012]\.(StartDelay|MinimumRunTime)/.test(key)) this.states.delete(key);
        }
        // Slow-cycle results belong to this VM, including countdowns and
        // selection between slow updates; none are borrowed from live Control.
        for (const [id, state] of this.derived) {
            // Price-session energy is a ledger of physical charging. A model
            // may inspect it, but cannot carry its private copy across ticks
            // over newer live budget/progress or invent a renewed session.
            if (/^Vehicles\.Wallbox[012]\.Price/.test(id.slice(root.length))) {
                this.derived.delete(id);
                continue;
            }
            this.states.set(id, clone(state));
        }
        this.states.delete(root + 'Control.Valid');
        local('System.RealOutputsEnabled', true);
        this.blocked = {};
        for (const name of POWER_TARGETS) {
            const fault = this.own(`Devices.${name}.OutputFault`) || this.own(`Devices.${name}.Fault`);
            const metadataRequired = ['Battery', 'MyPV_Heating'].includes(name);
            const driverInvalid = metadataRequired && this.own(`Devices.${name}.DriverReady`) !== true;
            if (fault || driverInvalid) {
                this.blocked[name] = fault ? `Ausgangsstoerung: ${String(fault)}` : 'Ausgangsmetadaten/Treiber nicht freigegeben';
            }
        }
        if (this.context && this.contextKey === key) {
            this.model?.prepare(this.states, this.context);
            return;
        }
        const self = this;
        const forbidden = capability => () => {
            self.violation = `Nicht erlaubte Schattenfunktion: ${capability}`;
            throw new Error(self.violation);
        };
        const VirtualDate = class extends Date {
            constructor(...args) { super(...(args.length ? args : [self.now()])); }
            static now() { return self.now(); }
        };
        const sandbox = {
            Date: VirtualDate, JSON, Math, Number, String, Boolean, Array, Object, Map, Set, Promise,
            Infinity, NaN, parseInt, parseFloat, isNaN, gridConstraints, heatPumpTelemetryParser, normalizeWallboxPowerKW,
            nativeConfig: Object.freeze({...clone(this.adapter.config), globalWriteEnabled: true}),
            getState: id => clone(this.states.get(id)),
            // Real session accounting must never integrate the idealized
            // wallbox response injected into this.states by the model.
            getActualState: id => clone(this.adapter.getCachedState(id)),
            existsState: id => this.states.has(id),
            getSourceUnit: id => this.adapter.bhkwSourceUnits?.get(id) ?? null,
            setState: (id, value, ack) => {
                if (!id.startsWith(root)) return forbidden('Fremd-State-Schreiben')();
                const state = typeof value === 'object' && value !== null && 'val' in value
                    ? clone(value) : {val: clone(value), ack: ack === true};
                const written = {...state, ts: this.now(), q: 0};
                this.states.set(id, written);
                const physicalPriceLedger = /^Vehicles\.Wallbox[012]\.Price/.test(id.slice(root.length));
                if (!physicalPriceLedger && (id.startsWith(root + 'Control.') || id.startsWith(root + 'Vehicles.')
                    || id.startsWith(root + 'Devices.') && !/\.(Output|Driver|Fault|Present|ControlEnabled)/.test(id)))
                    this.derived.set(id, clone(written));
            },
            createState: forbidden('Objektanlage'), writeForeignState: forbidden('Aktorausgang'),
            updateWallboxProductionOutput: forbidden('Wallboxausgang'), sendTo: forbidden('Adapterkommando/SQL'),
            schedule: forbidden('Zeitplan'), on: forbidden('Ereignisabo'), setTimeout: forbidden('Timer'),
            clearTimeout: forbidden('Timer'), log: () => {}
        };
        this.context = this.createContext(sandbox);
        this.contextKey = key;
        this.model = new ShadowWallboxModel({namespace: this.adapter.namespace,
            config: this.adapter.config, devices: clone(this.adapter.wallboxOutput?.devices),
            mapping: clone(this.adapter.readMapping()), states: this.states, context: this.context,
            now: this.now, violation: reason => { this.violation = reason; }});
    }

    run(source) { return vm.runInContext(source, this.context, {timeout: 1000}); }

    copyThermalLatches() {
        // These latches describe measured thermal history, not actuator
        // ownership or an imagined device response. Copying the live lock
        // avoids releasing a tank when shadow starts inside its hysteresis
        // band. Never call a live controller or write into its context.
        if (!this.adapter.engineContext || !vm.isContext(this.adapter.engineContext)) return;
        const thermal = vm.runInContext(
            '({dhw: dhwTemperatureLock, heating: heatingOutput.temperatureLock})',
            this.adapter.engineContext, {timeout: 100});
        const snapshot = {};
        if (typeof thermal.dhw === 'boolean') snapshot.dhw = thermal.dhw;
        if (typeof thermal.heating === 'boolean') snapshot.heating = thermal.heating;
        this.context.shadowThermalSnapshot = snapshot;
        this.run('if (typeof shadowThermalSnapshot.dhw === "boolean") dhwTemperatureLock = shadowThermalSnapshot.dhw; if (typeof shadowThermalSnapshot.heating === "boolean") heatingOutput.temperatureLock = shadowThermalSnapshot.heating;');
        delete this.context.shadowThermalSnapshot;
    }

    async tick() {
        if (!this.initialized || this.stopped || this.adapter.unloading || this.busy) return;
        if (!this.enabled && !this.trackingProduction()) return;
        this.busy = true;
        const generation = this.generation;
        try {
            if (!this.masterEnabled() && this.trackingProduction()) this.productionRecord();
            const problem = this.checkInputs();
            if (problem) return this.invalidate(problem);
            this.violation = '';
            this.prepareContext();
            this.model.prepareResponse();
            // This frame is private to the current model cycle. Published
            // Debug states can lag and must not qualify a vehicle handoff.
            // Unknown response never supplies a virtual electrical proof.
            this.context.shadowElectricalResponseValid = this.model.response?.valid === true;
            this.copyThermalLatches();
            // Existing latched faults are real constraints, not hypothetical
            // output state. In particular the allocator queries the battery's
            // private fault latch to decide whether the EHZ must take over.
            this.run('batteryOutputFault = String(getState(`${CFG.root}.Devices.Battery.Fault`)?.val || ""); heatingOutput.fault = String(getState(`${CFG.root}.Devices.MyPV_Heating.OutputFault`)?.val || ""); updateVehicles(); updateDhwSimulation(); updateHeatingSimulation(); realtimeControl(); if (!coordinatedEnergyEnabled()) updateHeatPumpAdvice();');
            if (this.violation) throw new Error(this.violation);
            if (this.own('Control.Valid') !== true) return this.invalidate(
                String(this.own('Control.Status') || 'Keine gueltige Schattenentscheidung'));
            await this.model.tick();
            if (generation !== this.generation || this.stopped || this.adapter.unloading) return;
            if (this.violation) throw new Error(this.violation);
            this.publishDecision();
        } catch (error) {
            this.invalidate(`Schattenregler ungueltig: ${String(error?.message || error).slice(0, 300)}`);
        } finally {
            this.busy = false;
        }
    }

    publishDecision() {
        this.beginScalarFrame();
        const measured = (id, multiplier = 1, age = 120000, requireAck = true) => {
            const state = this.adapter.getCachedState(id), value = finite(state?.val);
            return value !== null && this.fresh(state, age, requireAck) ? value * multiplier : null;
        };
        const sumMeasured = ids => {
            const values = ids.map(id => measured(id));
            return values.length && values.every(value => value !== null) ? values.reduce((a, b) => a + b, 0) : null;
        };
        const dp = this.run('CFG.dp');
        const imported = measured(dp.gridImport, 1, SMA_GRID_MAX_AGE_MS);
        const exported = measured(dp.gridExport, 1, SMA_GRID_MAX_AGE_MS);
        const bhkw = this.run('bhkwTelemetry()');
        const heatPump = this.own('Devices.HeatPump.Present') === true
            ? this.run('heatPumpPowerMeasurement()') : null;
        const actuals = {
            Grid: imported === null || exported === null ? null : imported - exported,
            PV: measured(dp.pvPower, 1, 120000, false), BHKW: bhkw.powerW,
            Battery: this.run('batteryMeasuredPowerW()'),
            MyPV_DHW: sumMeasured(dp.myPvDhwOutputW || []),
            MyPV_Heating: sumMeasured([1, 2, 3].map(p => this.adapter.config[`heatingOutput${p}Id`])),
            HeatPump: heatPump?.valid ? heatPump.watts : null
        };
        this.publish('BHKW.Energy_kWh', bhkw.energyKWh);
        this.publish('BHKW.Valid', bhkw.valid);
        this.publish('BHKW.Quality_JSON', JSON.stringify(bhkw));
        const targets = {}, consumers = {}, modeled = {}, realFeedback = {}, allocation = {};
        for (const name of POWER_TARGETS) targets[name] = finite(this.own(`Control.Targets.${name}_W`)) ?? 0;
        const selectedWallbox = finite(this.own('Control.SelectedWallbox')) ?? -1;
        const centralAllocation = boundedAllocation(this.own('Control.ParallelWallboxAllocation_JSON'));
        const parallelWallboxes = {enabled: this.run('parallelWallboxChargingEnabled()'),
            active: [0, 1, 2].filter(wb => (finite(this.own(`Control.Targets.Wallbox${wb}_A`)) ?? 0) > 0),
            status: String(this.own('Control.ParallelWallboxStatus') || '').slice(0, 600),
            allocation: centralAllocation};
        this.publish('ActiveWallboxes_JSON', JSON.stringify(parallelWallboxes.active));
        this.publish('ParallelWallboxAllocation_JSON', JSON.stringify(centralAllocation || {}));
        this.publish('ParallelWallboxStatus', parallelWallboxes.status);
        const fineRegulator = this.run('coordinatedEnergyEnabled()')
            ? this.own('Control.FineRegulator') || 'none' : targets.MyPV_DHW > 0 ? 'MyPV_DHW' : 'none';
        for (const wb of [0, 1, 2]) {
            const name = `Wallbox${wb}`;
            actuals[name] = measured(dp.wallboxesKW[wb], 1000,
                Math.max(5, Number(this.adapter.config.wallboxMeasurementMaxAgeS) || 30) * 1000);
            const amps = finite(this.own(`Control.Targets.${name}_A`)) ?? 0;
            const phases = finite(this.own(`Control.Targets.${name}_Phases`)) === 3 ? 3 : 1;
            const startDelay = finite(this.own(`Vehicles.${name}.StartDelayRemaining_s`)) ?? 0;
            const model = this.model.decision(wb);
            modeled[name] = model;
            const minimumRun = model.minimumRunRemainingS;
            const outputBlockReason = this.wallboxOutputBlockReason(wb);
            const reason = (startDelay > 0 ? `Startverzoegerung noch ${startDelay} s`
                    : targets[name] > 0 ? `Budget ${amps} A / ${phases} Phase(n)`
                        : parallelWallboxes.enabled ? (centralAllocation?.waiting?.find(w => w.wb === wb)?.reason
                            || 'kein nutzbares gemeinsames Ladebudget/freigegeben')
                            : selectedWallbox !== wb ? 'nicht ausgewaehlt/freigegeben' : 'kein nutzbares Ladebudget')
                + `; Ausgangsmodell ${model.powerW} W: ${model.status}; ${this.own(`Vehicles.${name}.Status`) || ''}`;
            consumers[name] = {powerW: targets[name], amps, phases, startDelayRemainingS: startDelay,
                minimumRunRemainingS: minimumRun, reason, outputBlockReason};
            this.publish(`Targets.${name}_A`, amps);
            this.publish(`Targets.${name}_Phases`, phases);
            this.publish(`${name}.StartDelayRemaining_s`, startDelay);
            this.publish(`${name}.MinimumRunTimeRemaining_s`, minimumRun);
            this.publish(`${name}.StopDelayRemaining_s`, model.stopDelayRemainingS);
            this.publish(`${name}.ModelOwned`, model.owned);
            this.publish(`${name}.ModelStatus`, model.status);
            this.publish(`${name}.ResponseState`, model.responseState);
            this.publish(`${name}.ResponsePending`, model.responsePending);
            this.publish(`${name}.ResponseRemaining_s`, model.responseRemainingS);
            this.publish(`Modeled.${name}_W`, model.powerW);
            this.publish(`Modeled.${name}_A`, model.amps);
            this.publish(`Modeled.${name}_Phases`, model.phases);
            realFeedback[name] = this.realWallboxFeedback(wb, dp);
            try { const raw = this.own(`Control.${name}.AllocationDiagnostics_JSON`);
                allocation[name] = typeof raw === 'string' && raw.length <= 20000 ? JSON.parse(raw) : null; }
            catch { allocation[name] = {valid: false, reason: 'Diagnosedatensatz ungueltig'}; }
        }
        const battery = this.run('batteryRegulationState()');
        consumers.Battery = {powerW: targets.Battery, reason: this.deviceRestriction('Battery') || this.blocked.Battery || battery.reason,
            outputBlockReason: this.deviceRestriction('Battery') || this.blocked.Battery || (!battery.available ? battery.reason : '')};
        for (const name of ['MyPV_DHW', 'MyPV_Heating']) consumers[name] = {powerW: targets[name],
            reason: this.own(`Devices.${name}.Status`) || 'kein Heizbudget',
            outputBlockReason: this.deviceRestriction(name) || this.blocked[name]
                || (this.own(`Devices.${name}.Release`) !== true ? this.own(`Devices.${name}.Status`) || 'Temperaturfreigabe aus' : '')};
        const advice = this.run('getHeatPumpAdvice()');
        consumers.HeatPump = {mode: advice.mode, valid: advice.valid, reason: advice.reason,
            powerScope: heatPump?.scope ?? null, powerValid: heatPump?.valid === true};
        this.publish('Targets.HeatPumpMode', advice.mode);
        this.publish('Targets.HeatPumpModeValue', advice.value);
        this.publish('HeatPump.Valid', advice.valid);
        for (const [name, watts] of Object.entries(actuals)) this.publish(`Actuals.${name}_W`, finite(watts));
        for (const [name, watts] of Object.entries(targets)) this.publish(`Targets.${name}_W`, watts);
        for (const [name, decision] of Object.entries(consumers)) {
            this.publish(`${name}.Summary`, `${name}: ${name === 'HeatPump' ? decision.mode : `${decision.powerW} W Budget`}; ${decision.reason}${decision.outputBlockReason ? `; Ausgabe gesperrt: ${decision.outputBlockReason}` : ''}`);
            if (name !== 'HeatPump') this.publish(`${name}.OutputBlockReason`, decision.outputBlockReason || '');
        }
        const blockedBudgets = POWER_TARGETS.filter(name => targets[name] !== 0 && consumers[name].outputBlockReason);
        const wallboxSummary = [0, 1, 2].filter(wb => targets[`Wallbox${wb}`] > 0)
            .map(wb => `WB${wb} ${targets[`Wallbox${wb}`]} W`).join(', ') || 'keine Wallbox';
        const summary = `SCHATTEN-BUDGET: ${wallboxSummary}; WW ${targets.MyPV_DHW} W; HK ${targets.MyPV_Heating} W; Speicher ${targets.Battery} W (+Laden); Feinregler ${fineRegulator}; WP ${advice.mode}${blockedBudgets.length ? `; Ausgabe gesperrt fuer ${blockedBudgets.join(', ')} (Details siehe Summary)` : ''}`;
        this.publish('SelectedWallbox', selectedWallbox);
        this.publish('FineRegulator', fineRegulator);
        const response = clone(this.model.response);
        const responseValid = response?.valid === true;
        const responseReason = responseValid ? '' : `Elektrische Schattenantwort ungueltig: ${response?.reason || 'Quelle fehlt'}; Ausgangsstatus zeigt nur reale Schutzreaktion`;
        this.publish('Summary', responseValid ? summary : responseReason);
        this.publish('Response.Valid', response?.valid === true);
        this.publish('Response.Grid_W', response?.applied ? response.gridW : null);
        this.publish('Response.Reason', response?.reason || '');
        this.publish('Response.TimingState', response?.timingState || 'invalid-source');
        this.publish('Response.InputTimestamp', response?.inputTimestamp ?? null);
        this.publish('Response.InputAge_ms', response?.inputAgeMs ?? null);
        const record = {adapterVersion: ADAPTER_VERSION, cycleId: ++this.cycleId, timestamp: this.now(), valid: responseValid, note: NOTE,
            protectionFeedback: this.realProtectionFeedback(),
            ...(responseReason ? {reason: responseReason} : {}),
            masterEnabled: this.adapter.config.globalWriteEnabled === true || this.live('System.RealOutputsEnabled')?.val === true,
            masterAssumedEnabled: true, selectedWallbox,
            selectionReason: this.own('Control.WallboxSelectionReason') || '',
            fineRegulator, targets, actuals, consumers, modeled, realFeedback,
            response, allocation, parallelWallboxes, bhkw,
            controlReason: this.own('Control.Status'), coordinationReason: this.run('coordinatedEnergyEnabled()')
                ? this.own('Control.CoordinationStatus') || '' : 'WB/WW-Regelung; keine Speicher-/Heizpufferkoordination'};
        this.publish('Snapshot_JSON', JSON.stringify(record));
        this.publishRecord(record);
        this.publish('CycleId', this.cycleId);
        this.publish('LastUpdate', this.now());
        this.publish('Valid', responseValid);
        this.finishScalarFrame();
    }

    deviceRestriction(name) {
        if (this.own(`Devices.${name}.Present`) !== true) return 'Geraet nicht vorhanden';
        if (this.own(`Devices.${name}.ControlEnabled`) !== true) return 'Steuerfreigabe aus';
        const nativeKey = /^Wallbox/.test(name) ? `wb${name.slice(-1)}ProductionArmed`
            : name === 'MyPV_Heating' ? 'heatingProductionArmed' : null;
        return nativeKey && this.adapter.config[nativeKey] !== true ? 'Produktionsfreigabe nicht bestaetigt' : '';
    }

    wallboxOutputBlockReason(wb) {
        const reason = this.deviceRestriction(`Wallbox${wb}`) || this.blocked[`Wallbox${wb}`];
        if (reason) return reason;
        const model = this.model?.decision(wb);
        return !model || model.stage === 'off' || model.phaseSwitchPending || model.phaseSwitchTimedOut
            ? model?.status || 'Wallbox-Ausgangsmetadaten fehlen' : '';
    }

    realProtectionFeedback() {
        const mapping = this.adapter.readMapping();
        const fields = {gridImport: mapping.DP_GRID_IMPORT, gridExport: mapping.DP_GRID_EXPORT,
            dhwGridImport: mapping.DP_GRID_IMPORT, dhwGridExport: mapping.DP_GRID_EXPORT};
        for (const p of [1, 2, 3]) {
            fields[`houseL${p}Import`] = mapping[`DP_HA_L${p}_IMPORT_W`];
            fields[`houseL${p}Export`] = mapping[`DP_HA_L${p}_EXPORT_W`];
            fields[`houseL${p}Current`] = this.adapter.config[`dhwHaL${p}CurrentId`]
                || mapping[`DP_DHW_HA_L${p}_CURRENT_A`];
        }
        return Object.fromEntries(Object.entries(fields).filter(([key, id]) => id || /^(grid|dhwGrid)/.test(key)).map(([key, id]) => {
            const state = this.adapter.getCachedState(id);
            const dhw = key.startsWith('dhwGrid');
            const maxAgeMs = SMA_GRID_MAX_AGE_MS;
            const ageMs = Number.isFinite(state?.ts) ? this.now() - state.ts : null;
            // Match the independent contracts, including DHW's legacy
            // acceptance of an absent ACK flag (explicit false still fails).
            const unacknowledged = dhw ? state?.ack === false : state?.ack !== true;
            const badQuality = dhw ? state?.q !== undefined && Number(state.q) !== 0 : state?.q && state.q !== 0;
            const issue = !state ? 'missing' : unacknowledged ? 'unacknowledged'
                : badQuality ? 'quality' : finite(state.val) === null ? 'numeric'
                    : !Number.isFinite(state.ts) || state.ts <= 0 ? 'timestamp'
                        : ageMs < (dhw ? 0 : -1000) ? 'future' : ageMs > maxAgeMs ? 'stale' : '';
            return [key, {id: id ?? null, value: state?.val ?? null,
                ts: state?.ts ?? null, lc: state?.lc ?? null, ageMs, maxAgeMs,
                contract: dhw ? 'dhw-direct-grid: invalid source stops heater output'
                    : key.startsWith('grid') ? 'wallbox-total-grid: invalid source stops wallbox output'
                        : 'wallbox-house-phase: shared SMA 30 s protection gate',
                ack: state?.ack ?? null, q: state?.q ?? null, valid: !issue, issue}];
        }));
    }

    realWallboxFeedback(wb) {
        const source = this.adapter.wallboxOutput?.devices?.find(item => item.wb === wb);
        const mapping = this.adapter.readMapping();
        const fields = {car: mapping[`DP_WB${wb}_CAR`], userRelease: mapping[`DP_WB${wb}_ALLOW`],
            allow: source?.ids.allow, currentA: source?.ids.feedback, commandA: source?.ids.command,
            phaseMode: source?.ids.phaseMode,
            error: source?.ids.error, connection: source?.ids.connection,
            powerKW: mapping[`DP_WB${wb}_POWER`], soc: mapping[`DP_WB${wb}_SOC`],
            lastStopReason: `${this.adapter.namespace}.Devices.Wallbox${wb}.LastStopReason`,
            lastStopAt: `${this.adapter.namespace}.Devices.Wallbox${wb}.LastStopAt`,
            targetSoc: mapping[`DP_WB${wb}_TARGET`], minimumSoc: mapping[`DP_WB${wb}_MIN_SOC`]};
        return Object.fromEntries(Object.entries(fields).map(([key, id]) => {
            const state = id ? this.adapter.getCachedState(id) : null;
            const retainedSetting = ['userRelease', 'targetSoc', 'minimumSoc'].includes(key);
            const maxAge = key === 'soc' ? 7200000
                : retainedSetting || ['lastStopAt', 'lastStopReason', 'phaseMode', 'connection'].includes(key) ? Infinity
                    : Math.max(5, Number(this.adapter.config.wallboxMeasurementMaxAgeS) || 30) * 1000;
            const ageMs = Number.isFinite(state?.ts) ? this.now() - state.ts : null;
            const fresh = this.fresh(state, maxAge, !retainedSetting);
            const issue = !state ? 'missing' : !retainedSetting && state.ack !== true ? 'unacknowledged'
                : state.q && Number(state.q) !== 0 ? 'quality'
                    : !Number.isFinite(state.ts) || state.ts <= 0 ? 'timestamp'
                        : ageMs < -1000 ? 'future' : ageMs > maxAge ? 'stale'
                            : key === 'powerKW' && finite(state.val) === null ? 'numeric'
                                : key === 'powerKW' && normalizeWallboxPowerKW(Number(state.val)) === null ? 'negative' : '';
            return [key, {id: id || '', value: state?.val ?? null, ts: state?.ts ?? null,
                ack: state?.ack ?? null, q: state?.q ?? null,
                ageMs, maxAgeMs: Number.isFinite(maxAge) ? maxAge : null, fresh, issue}];
        }));
    }

    publishRecord(record) {
        // One serialized value is the SQL source of truth for a cycle. Scalar
        // states remain useful UI diagnostics but are not a transactional row.
        const feedbackEdges = Object.fromEntries(Object.entries(record.realFeedback || {}).map(([wb, feedback]) => [wb,
            {car: feedback.car?.value, allow: feedback.allow?.value,
                currentA: feedback.currentA?.value, commandA: feedback.commandA?.value,
                phaseMode: feedback.phaseMode?.value,
                error: feedback.error?.value, connection: feedback.connection?.value,
                userRelease: feedback.userRelease?.value, lastStopAt: feedback.lastStopAt?.value,
                targetSoc: feedback.targetSoc?.value, minimumSoc: feedback.minimumSoc?.value,
                drawing: !feedback.powerKW?.fresh || finite(feedback.powerKW?.value) === null
                    ? null : Number(feedback.powerKW.value) > 0.1,
                quality: Object.fromEntries(Object.entries(feedback).map(([name, state]) => [name,
                    {ack: state.ack, q: state.q, fresh: state.fresh, issue: state.issue}]))}]));
        // Timing magnitudes change each cycle; their diagnostic category does
        // not. Keep exact values in the record, but do not make them SQL edges.
        const category = reason => String(reason || '').replace(/ \(\d+ ms, -?\d+ W\)/g, '');
        const stable = record.modeled && record.targets ? {valid: record.valid,
            targets: Object.fromEntries(Object.entries(record.targets).filter(([name]) => name.startsWith('Wallbox'))),
            selectedWallbox: record.selectedWallbox, selectionReason: record.selectionReason || '',
            fineRegulator: record.fineRegulator, parallelWallboxes: parallelStable(record.parallelWallboxes),
            response: record.response && {valid: record.response.valid, applied: record.response.applied,
                reason: category(record.response.reason), basis: record.response.basis},
            modeled: Object.fromEntries(Object.entries(record.modeled).map(([key, model]) => [key,
                {powerW: model.powerW, phases: model.phases, owned: model.owned, stage: model.stage,
                    responseState: model.responseState, responseCommandA: model.responseCommandA,
                    responseSentAt: model.responseSentAt, responseAcknowledgedAt: model.responseAcknowledgedAt,
                    responseConfirmedAt: model.responseConfirmedAt,
                    phaseSwitchPending: model.phaseSwitchPending, phaseSwitchTimedOut: model.phaseSwitchTimedOut,
                    status: model.status.replace(/\d+ s/g, '# s')
                        .replace(/-?\d+(?:\.\d+)? W/g, '# W')}]))}
            : {valid: false, reason: category(record.reason)};
        stable.protectionQuality = Object.fromEntries(Object.entries(record.protectionFeedback || {})
            .map(([key, sample]) => [key, {valid: sample.valid, issue: sample.issue}]));
        const controlState = {globalWriteEnabled: this.adapter.config.globalWriteEnabled === true,
            realOutputsEnabled: this.live('System.RealOutputsEnabled')?.val ?? null,
            observerOnly: this.adapter.config.observerOnly ?? null};
        stable.controlState = controlState;
        stable.masterEnabled = record.masterEnabled === true;
        stable.realFeedbackEdges = feedbackEdges;
        const key = JSON.stringify(stable);
        if (key !== this.lastRecordKey || this.now() - this.lastRecordAt >= 60000) {
            // Bounded record omits repeated long descriptions and duplicate
            // summaries. Snapshot_JSON retains the full UI explanation.
            const compact = {schema: 1, adapterVersion: ADAPTER_VERSION, cycleId: record.cycleId, timestamp: record.timestamp,
                valid: record.valid, masterEnabled: record.masterEnabled === true,
                reason: record.reason, selectedWallbox: record.selectedWallbox,
                selectionReason: record.selectionReason || '',
                fineRegulator: record.fineRegulator, parallelWallboxes: parallelStable(record.parallelWallboxes), targets: record.targets, actuals: record.actuals,
                response: record.response, allocation: record.allocation, parallelWallboxes: record.parallelWallboxes, bhkw: record.bhkw,
                protectionFeedback: record.protectionFeedback,
                modeled: record.modeled && Object.fromEntries(Object.entries(record.modeled).map(([name, value]) => {
                    const {assumption, ...model} = value;
                    return [name, model];
                })),
                realFeedback: Object.fromEntries(Object.entries(record.realFeedback || {}).map(([wb, feedback]) => [wb,
                    Object.fromEntries(Object.entries(feedback).map(([name, value]) => {
                        const {id, ...state} = value;
                        return [name, state];
                    }))]))};
            compact.controlState = controlState;
            this.enqueueRecord(compact);
            this.lastRecordKey = key;
            this.lastRecordAt = this.now();
        }
    }

    stop() {
        // No write is promised after shutdown. Unsent dense samples are an
        // explicit diagnostic loss, not reconstructed observations.
        this.diagnosticSampler.lost += this.sourceBatch.length;
        this.sourceBatch = [];
        this.sourceBatchBytes = 0;
        this.stopped = true;
        this.diagnosticSampler.ring.length = 0;
        this.diagnosticSampler.bytes = 0;
        this.diagnosticSampler.stats.clear();
        this.discardRecords();
        this.generation++;
        this.model?.stop();
        this.context = null;
        this.states.clear();
        this.derived.clear();
        this.replacements.clear();
        this.scalarFrame = null;
        this.scalarNextFrame = null;
    }
}

module.exports = ShadowController;
