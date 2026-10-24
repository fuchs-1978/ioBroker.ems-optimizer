'use strict';

// Passive, bounded aggregates. Never queries SQL or issues device commands.
const MAX_GAP_MS = 10000;
const MAX_BYTES = 64000;
const SOURCES = ['grid', 'pv', 'bhkw', 'wallbox0', 'wallbox1', 'wallbox2', 'ehz'];
const dateFormat = new Intl.DateTimeFormat('sv-SE', {timeZone: 'Europe/Berlin',
    year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', hourCycle: 'h23'});
function period(at) {
    const parts = Object.fromEntries(dateFormat.formatToParts(at).map(p => [p.type, p.value]));
    const day = new Date(`${parts.year}-${parts.month}-${parts.day}T12:00:00Z`);
    if (Number(parts.hour) < 20) day.setUTCDate(day.getUTCDate() - 1);
    const boundary = date => {
        const key = date.toISOString().slice(0, 10);
        let t = Date.parse(`${key}T20:00:00Z`);
        for (let i = 0; i < 3; i++) {
            const local = Object.fromEntries(dateFormat.formatToParts(t).map(p => [p.type, p.value]));
            const localHour = Date.parse(`${local.year}-${local.month}-${local.day}T${local.hour}:00:00Z`);
            t += Date.parse(`${key}T20:00:00Z`) - localHour;
        }
        return t;
    };
    const from = boundary(day); day.setUTCDate(day.getUTCDate() + 1);
    return {from, to: boundary(day)};
}
const finite = n => typeof n === 'number' && Number.isFinite(n);
function fresh(from, to) {
    return {from, to, observedUntil: from, starts: 0, samples: 0,
        sources: Object.fromEntries(SOURCES.map(k => [k, {coveredMs: 0, importWh: 0, exportWh: 0,
            signedWms: 0, absoluteWms: 0, exportAbove200Ms: 0}])),
        events: [], eventCount: 0, eventOverflow: 0,
        protectionAssessment: 'not-assessed: sampled states do not prove absence of short violations',
        avoidableExportWh: null, potentialStatus: 'requires simultaneous proven available load capacity',
        recorder: {droppedObserved: 0, writeErrorsObserved: 0, counterResets: 0}};
}
function validPeriod(p) {
    return p && finite(p.from) && finite(p.to) && p.to > p.from && p.to - p.from <= 25 * 3600000
        && finite(p.observedUntil) && p.observedUntil >= p.from && p.observedUntil <= p.to
        && ['starts', 'samples', 'eventCount', 'eventOverflow'].every(k => finite(p[k]) && p[k] >= 0)
        && Array.isArray(p.events) && p.events.length <= 100
        && SOURCES.every(k => p.sources?.[k] && ['coveredMs', 'importWh', 'exportWh', 'signedWms',
            'absoluteWms', 'exportAbove200Ms'].every(f => finite(p.sources[k][f]))
            && p.sources[k].coveredMs >= 0 && p.sources[k].coveredMs <= p.to - p.from)
        && p.recorder && ['droppedObserved', 'writeErrorsObserved', 'counterResets']
            .every(k => finite(p.recorder[k]) && p.recorder[k] >= 0);
}
class DailySummary {
    constructor(adapter) {
        this.adapter = adapter; this.data = {schema: 1, current: null, previous: null};
        this.last = null; this.lastSavedAt = 0; this.pending = null; this.latest = null;
        this.stopped = false; this.started = false;
    }
    async initialize() {
        const id = `${this.adapter.namespace}.Debug.DailySummary_JSON`;
        await this.adapter.queueCompatState(id, '', {type: 'string', role: 'json', read: true,
            write: false, name: 'Passive 20:00 Europe/Berlin daily aggregates; current and previous period'});
        const saved = await this.adapter.getStateAsync('Debug.DailySummary_JSON');
        if (typeof saved?.val === 'string' && Buffer.byteLength(saved.val) <= MAX_BYTES) {
            try {
                const d = JSON.parse(saved.val);
                if (d.schema === 1 && validPeriod(d.current) && (!d.previous || validPeriod(d.previous))) this.data = d;
                else this.adapter.log.warn('Daily summary: invalid checkpoint; starting with unknown coverage');
            } catch { this.adapter.log.warn('Daily summary: invalid JSON; starting with unknown coverage'); }
        }
        // Never restore interpolation/event baselines across an adapter restart.
    }
    values(s) {
        const m = s.measurements;
        const values = {grid: null, pv: s.power.pv_W, bhkw: m.bhkw?.power?.valid ? Number(m.bhkw.power.val) : null,
            ehz: s.ehz.actual_W};
        // Net power requires coherent import/export timestamps, not merely two fresh caches.
        if (m.gridImport.valid && m.gridExport.valid && Math.abs(m.gridImport.ts - m.gridExport.ts) <= 5000)
            values.grid = s.power.grid_W;
        for (const w of s.wallboxes) values[`wallbox${w.wb}`] = w.actual_W;
        return Object.fromEntries(SOURCES.map(k => [k, finite(values[k]) ? values[k] : null]));
    }
    event(p, at, type, detail) {
        p.eventCount++;
        if (p.events.length < 100) p.events.push({at, type, detail}); else p.eventOverflow++;
    }
    sample(s, diagnostics = {}) {
        if (this.stopped || !finite(s.ts)) return;
        const at = s.ts, bounds = period(at);
        if (this.data.current && at < this.data.current.from) { this.last = null; return; }
        const values = this.values(s);
        const interval = this.last && at > this.last.at && at - this.last.at <= MAX_GAP_MS ? this.last : null;
        const integrate = (p, from, to) => {
            if (!interval || to <= from) return;
            const ms = to - from;
            for (const k of SOURCES) {
                const a = interval.values[k], b = values[k];
                if (!finite(a) || !finite(b)) continue;
                // Conservative left hold, bounded to 10 s, valid at both endpoints.
                const x = p.sources[k]; x.coveredMs += ms;
                x.importWh += Math.max(0, a) * ms / 3600000;
                x.exportWh += Math.max(0, -a) * ms / 3600000;
                x.signedWms += a * ms; x.absoluteWms += Math.abs(a) * ms;
                if (k === 'grid' && a < -200) x.exportAbove200Ms += ms;
            }
        };
        let rolled = false;
        if (!this.data.current || this.data.current.from !== bounds.from) {
            if (this.data.current) {
                integrate(this.data.current, Math.max(this.last?.at ?? at, this.data.current.from), Math.min(at, this.data.current.to));
                this.data.current.observedUntil = this.data.current.to;
                this.data.previous = this.data.current;
            }
            this.data.current = fresh(bounds.from, bounds.to); rolled = true;
        }
        const p = this.data.current;
        integrate(p, Math.max(interval?.at ?? at, p.from), at);
        p.observedUntil = at; p.samples++;
        if (!this.started) { p.starts++; this.started = true; }
        const discrete = {master: s.system.RealOutputsEnabled, selectedWallbox: s.control.SelectedWallbox,
            gridLimitActive: s.control.GridOperatorLimitActive};
        for (const w of s.wallboxes) {
            discrete[`wb${w.wb}.stopAt`] = w.LastStopAt;
            discrete[`wb${w.wb}.phases`] = w.ConfirmedPhases;
            discrete[`wb${w.wb}.phaseTransition`] = w.PhaseTransitionActive;
        }
        if (interval) {
            for (const [key, val] of Object.entries(discrete)) {
                const before = interval.discrete[key];
                if (val != null && before != null && val !== before) {
                    const wb = /^wb(\d).stopAt$/.exec(key);
                    this.event(p, at, key, wb ? {stopAt: val,
                        reason: String(s.wallboxes.find(w => w.wb === Number(wb[1]))?.LastStopReason || 'unknown').slice(0, 200)}
                        : {before, after: val});
                }
            }
            for (const [key, target] of [['dropped', 'droppedObserved'], ['writeErrors', 'writeErrorsObserved']]) {
                const a = interval.diagnostics[key], b = diagnostics[key];
                if (finite(a) && finite(b) && b >= a) p.recorder[target] += b - a;
                else if (finite(a) && finite(b) && b < a) p.recorder.counterResets++;
            }
        }
        this.last = {at, values, discrete, diagnostics};
        if (rolled || at - this.lastSavedAt >= 60000 || !this.lastSavedAt) { this.lastSavedAt = at; this.save(); }
    }
    report() {
        const describe = p => p && ({...p, durationMs: p.to - p.from,
            sources: Object.fromEntries(SOURCES.map(k => {
                const x = p.sources[k];
                return [k, {...x, unassessedMs: p.to - p.from - x.coveredMs,
                    meanW: x.coveredMs ? x.signedWms / x.coveredMs : null,
                    meanAbsoluteW: x.coveredMs ? x.absoluteWms / x.coveredMs : null}];
            }))});
        return {...this.data, current: describe(this.data.current), previous: describe(this.data.previous), method: {energy: 'bounded-left-hold-power-estimate', maxGapMs: MAX_GAP_MS,
            timezone: 'Europe/Berlin', boundaryHour: 20, exportThresholdW: 200,
            note: 'Missing coverage is unknown, never zero. Sampled events are observations, not complete electrical proofs.'}};
    }
    save() {
        this.latest = JSON.stringify(this.report());
        while (Buffer.byteLength(this.latest) > MAX_BYTES) {
            const p = [this.data.previous, this.data.current].find(item => item?.events.length);
            if (!p) throw new Error('Daily summary exceeds bounded state size');
            p.events.shift(); p.eventOverflow++;
            this.latest = JSON.stringify(this.report());
        }
        if (this.pending) return this.pending;
        this.pending = (async () => {
            while (this.latest !== null) {
                const value = this.latest; this.latest = null;
                try { await this.adapter.setStateAsync('Debug.DailySummary_JSON', {val: value, ack: true}); }
                catch (error) { this.adapter.log.warn(`Daily summary checkpoint failed: ${error.message}`); }
            }
        })().finally(() => { this.pending = null; });
        return this.pending;
    }
    async stop() { this.stopped = true; await this.save(); }
}
module.exports = {DailySummary, period, validPeriod, MAX_BYTES};
