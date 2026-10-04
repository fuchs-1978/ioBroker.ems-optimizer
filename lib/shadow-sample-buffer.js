'use strict';

// Read-only, bounded history for the isolated electrical response. Never
// supplies protection, ACK, phase, car or actuator feedback to the output.
const WINDOW_MS = 30000;
// A 15 s wallbox poll plus one 5 s controller cycle. This bound applies
// exclusively to a complete historical frame, never to current protection.
const BASELINE_AGE_MS = 20000;
const MAX_SKEW_MS = 2000;
const MAX_BRACKET_MS = 20000;
const MAX_POWER_SPREAD_KW = 0.1;

class ShadowSampleBuffer {
    constructor() { this.samples = new Map(); }

    capture(states, ids, now) {
        for (const id of ids.filter(Boolean)) {
            const state = states.get(id);
            let samples = this.samples.get(id) || [];
            samples = samples.filter(s => s.ts >= now - WINDOW_MS);
            // Keep bad samples too: a quality gap must not be interpolated away.
            if (state && Number.isFinite(state.ts) && state.ts > 0 && state.ts <= now
                && state.ts >= now - WINDOW_MS) {
                samples = samples.filter(s => s.ts !== state.ts);
                samples.push(structuredClone(state));
            }
            samples.sort((a, b) => a.ts - b.ts);
            this.samples.set(id, samples.slice(-128));
        }
    }

    good(state) {
        return state?.ack === true && !state.q && ['number', 'string'].includes(typeof state.val)
            && String(state.val).trim() !== '' && Number.isFinite(Number(state.val));
    }

    at(id, timestamp, power = false) {
        const samples = this.samples.get(id) || [];
        const before = samples.filter(s => s.ts <= timestamp).at(-1);
        const after = samples.find(s => s.ts >= timestamp);
        if (!before || !after || !this.good(before) || !this.good(after)) return null;
        if (power && (Number(before.val) < -0.02 || Number(after.val) < -0.02)) return null;
        if (before.ts === after.ts) return {...before};
        if (after.ts - before.ts > MAX_BRACKET_MS) return null;
        const spread = Math.abs(Number(after.val) - Number(before.val));
        if (power && spread > MAX_POWER_SPREAD_KW) return null;
        // No extrapolation: only bracketed, nearly constant WB measurements.
        const value = Number(before.val) + (Number(after.val) - Number(before.val))
            * (timestamp - before.ts) / (after.ts - before.ts);
        return {...before, val: value, ts: timestamp,
            alignment: {beforeTs: before.ts, afterTs: after.ts, spreadW: power ? spread * 1000 : null}};
    }

    align(rawStates, mapping, powerIds, now, maxAgeMs = BASELINE_AGE_MS) {
        const ageLimitMs = Math.min(BASELINE_AGE_MS, Math.max(0, maxAgeMs));
        const rejected = new Set();
        this.lastAlignment = {status: 'waiting', maxAgeMs: ageLimitMs, reasons: []};
        const importId = mapping.DP_GRID_IMPORT, exportId = mapping.DP_GRID_EXPORT;
        const candidates = (this.samples.get(importId) || []).slice().reverse();
        for (const imported of candidates) {
            if (!this.good(imported) || Number(imported.val) < 0 || now - imported.ts > ageLimitMs) continue;
            const exported = (this.samples.get(exportId) || []).filter(s => this.good(s)
                && Number(s.val) >= 0 && now - s.ts <= ageLimitMs
                && Math.abs(s.ts - imported.ts) <= MAX_SKEW_MS)
                .sort((a, b) => Math.abs(a.ts - imported.ts) - Math.abs(b.ts - imported.ts))[0];
            if (!exported) { rejected.add('grid-pair-missing'); continue; }
            const currentGrid = Number(rawStates.get(importId)?.val) - Number(rawStates.get(exportId)?.val);
            const baselineGrid = Number(imported.val) - Number(exported.val);
            if (!Number.isFinite(currentGrid) || Math.abs(currentGrid - baselineGrid) > 500) {
                rejected.add('grid-drift-exceeds-500W'); continue;
            }
            const matched = powerIds.map(id => [id, this.at(id, imported.ts, true)]);
            if (matched.some(([, sample]) => !sample)) { rejected.add('power-bracket-missing-or-unstable'); continue; }
            if (matched.some(([id, sample]) => Math.abs(Number(rawStates.get(id)?.val) - Number(sample.val))
                > MAX_POWER_SPREAD_KW)) { rejected.add('latest-power-differs'); continue; }
            const states = new Map(rawStates);
            states.set(importId, {...imported}); states.set(exportId, {...exported});
            for (const [id, sample] of matched) states.set(id, sample);
            this.lastAlignment = {status: 'aligned', maxAgeMs: ageLimitMs, reasons: [],
                inputTimestamp: imported.ts, inputAgeMs: now - imported.ts};
            return {states, timestamp: imported.ts, ageMs: now - imported.ts, maxAgeMs: ageLimitMs,
                observedPowerSpreadW: matched.reduce((sum, [id, sample]) => sum + Math.max(
                    sample.alignment?.spreadW || 0,
                    Math.abs(Number(rawStates.get(id)?.val) - Number(sample.val)) * 1000), 0),
                maximumObservedPowerSpreadW: powerIds.length * 100,
                gridDriftW: currentGrid - baselineGrid};
        }
        this.lastAlignment.reasons = rejected.size ? [...rejected] : ['no-grid-frame-within-age-limit'];
        return null;
    }

    clear() { this.samples.clear(); }
}

module.exports = ShadowSampleBuffer;
