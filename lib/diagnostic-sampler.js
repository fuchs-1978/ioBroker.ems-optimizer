'use strict';

// Diagnostic only: no actuator access, timers or regulator decisions.
class DiagnosticSampler {
    constructor({intervalMs = 30000, preMs = 60000, postMs = 120000,
        maxSamples = 4096, maxBytes = 1024 * 1024} = {}) {
        Object.assign(this, {intervalMs, preMs, postMs, maxSamples, maxBytes});
        this.ring = []; this.bytes = 0; this.lost = 0; this.sequence = 0;
        this.stats = new Map(); this.denseUntil = 0; this.startedAt = null;
        this.lastSummary = null; this.lastTrigger = null;
        this.lastTriggerSequence = 0;
    }

    observe(id, state, previous, at, {discrete = false, powerScale = 0} = {}) {
        const sample = {sampleSequence: ++this.sequence, receivedAt: at, id,
            state: state == null ? null : structuredClone(state)};
        const size = Buffer.byteLength(JSON.stringify(sample));
        if (this.startedAt === null) this.startedAt = at;
        if (this.lastSummary === null) this.lastSummary = at;
        while (this.ring.length && at - this.ring[0].sample.receivedAt > this.preMs)
            this.bytes -= this.ring.shift().size;
        if (size > this.maxBytes) this.lost++;
        else {
            while (this.ring.length && (this.ring.length >= this.maxSamples || this.bytes + size > this.maxBytes)) {
                this.bytes -= this.ring.shift().size; this.lost++;
            }
            this.ring.push({sample, size}); this.bytes += size;
        }
        let s = this.stats.get(id);
        if (!s) {
            if (this.stats.size >= 256) {this.lost++; return {sample, important: true, reason: 'source-limit'};}
            s = {id, count: 0, validCount: 0, invalidCount: 0, numericCount: 0,
                min: null, max: null, sum: 0, firstReceivedAt: at, lastReceivedAt: at,
                firstSourceTs: null, lastSourceTs: null, maxReceiptGapMs: 0, maxSourceGapMs: 0};
            this.stats.set(id, s);
        }
        const receiptRegression = at < s.lastReceivedAt;
        s.count++;
        const valid = state != null && state.val != null && state.ack === true
            && (state.q === undefined || state.q === 0) && Number.isFinite(state.ts) && state.ts > 0;
        if (valid) s.validCount++; else s.invalidCount++;
        s.maxReceiptGapMs = Math.max(s.maxReceiptGapMs, at - s.lastReceivedAt);
        s.lastReceivedAt = at;
        if (Number.isFinite(state?.ts)) {
            if (s.firstSourceTs === null) s.firstSourceTs = state.ts;
            if (s.lastSourceTs !== null) s.maxSourceGapMs = Math.max(s.maxSourceGapMs, state.ts - s.lastSourceTs);
            s.lastSourceTs = state.ts;
        }
        if (valid && typeof state.val === 'number' && Number.isFinite(state.val)) {
            s.numericCount++; s.sum += state.val;
            s.min = s.min === null ? state.val : Math.min(s.min, state.val);
            s.max = s.max === null ? state.val : Math.max(s.max, state.val);
        }
        const qualityEdge = !previous || !state || (state.val == null) !== (previous.val == null)
            || state.ack !== previous.ack || state.q !== previous.q
            || state.ts < previous.ts || receiptRegression;
        const gap = Number.isFinite(previous?.ts) && Number.isFinite(state?.ts) && state.ts - previous.ts > 10000;
        const valueEdge = discrete && JSON.stringify(state?.val) !== JSON.stringify(previous?.val);
        const dip = powerScale > 0 && typeof previous?.val === 'number' && typeof state?.val === 'number'
            && previous.val * powerScale > 200
            && (previous.val - state.val) * powerScale > Math.max(200, previous.val * powerScale * 0.2);
        return {sample, important: qualityEdge || gap || valueEdge || dip,
            reason: qualityEdge ? 'quality-edge' : gap ? 'source-gap' : valueEdge ? 'discrete-edge' : dip ? 'power-dip' : '',
            dense: at <= this.denseUntil};
    }

    trigger(at) {
        this.denseUntil = Math.max(this.denseUntil, at + this.postMs);
        // Emit only samples not already delivered by an earlier overlapping trigger.
        const samples = this.ring.filter(x => x.sample.sampleSequence > this.lastTriggerSequence)
            .map(x => structuredClone(x.sample));
        this.lastTrigger = at;
        this.lastTriggerSequence = this.sequence;
        return {schema: 1, kind: 'event-window', at, preMs: this.preMs, postMs: this.postMs,
            actualStart: samples[0]?.receivedAt ?? null, actualEnd: samples.at(-1)?.receivedAt ?? null,
            samples, bufferLost: this.lost, denseUntil: this.denseUntil};
    }

    summary(at, force = false) {
        if (this.lastSummary === null) this.lastSummary = at;
        if (!force && at - this.lastSummary >= 0 && at - this.lastSummary < this.intervalMs) return null;
        const result = {schema: 1, kind: 'interval-summary', from: this.lastSummary, to: at,
            resolutionMs: this.intervalMs, bufferLost: this.lost,
            coverage: 'observed samples only; no interpolation or assertion of continuous validity',
            validity: 'validCount checks value, ACK, q and timestamp format only; freshness is not inferred',
            sources: [...this.stats.values()].map(({sum, ...s}) => ({...s,
                mean: s.numericCount ? sum / s.numericCount : null,
                leadingReceiptGapMs: Math.max(0, s.firstReceivedAt - this.lastSummary),
                trailingReceiptGapMs: Math.max(0, at - s.lastReceivedAt)}))};
        this.stats.clear(); this.lastSummary = at;
        return result;
    }
}

module.exports = DiagnosticSampler;
