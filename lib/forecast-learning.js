'use strict';
const {quantile} = require('./transition-assessment');
const STEP = 900000, MAX = 192;
const finite = n => typeof n === 'number' && Number.isFinite(n);
class LoadAdjustment {
    constructor() {this.lastAt = null; this.coveredMs = 0; this.biasW = null;}
    observe(now, actualW, series, valid) {
        const slot = Array.isArray(series) && series.length <= 192
            ? series.find(x => finite(x.timestamp) && x.timestamp <= now && x.timestamp + STEP > now && finite(x.valueW)) : null;
        const dt = this.lastAt === null ? 0 : now - this.lastAt;
        if (!valid || !finite(actualW) || actualW < 0 || !slot || dt < 0 || dt > 10000) {this.coveredMs = 0; this.biasW = null;}
        else {
            const error = actualW - slot.valueW;
            this.biasW = this.biasW === null ? error : this.biasW + (1 - Math.exp(-dt / 900000)) * (error - this.biasW);
            this.coveredMs += dt;
        }
        this.lastAt = now;
        return {coveredMs: this.coveredMs, status: this.coveredMs >= 600000 ? 'preview' : 'insufficient-data',
            biasW: this.biasW, preview: this.coveredMs >= 600000 ? series.filter(x => x.timestamp > now).slice(0, 8).map(x => ({
                timestamp: x.timestamp, originalW: x.valueW,
                candidateW: Math.max(0, x.valueW + Math.max(-x.valueW * 0.25, Math.min(x.valueW * 0.25,
                    this.biasW * Math.exp(-(x.timestamp - now) / 3600000))))})) : [],
            note: 'Mindestens10Minuten aktuelle bereinigte Grundlast, gleitende Korrektur auf±25% begrenzt und zeitlich abklingend. Vorschau ohne Regleränderung.'};
    }
}
class ForecastLearning {
    constructor() {this.predictions = new Map(); this.errors = []; this.last = null; this.coverage = [];}
    band(value) {
        if (this.errors.length < 20 || !finite(value)) return {lowerW: null, upperW: null};
        return {lowerW: Math.max(0, value + quantile(this.errors, 0.1)), upperW: Math.max(0, value + quantile(this.errors, 0.9))};
    }
    observe(s, series, issuedAt) {
        const now = s.ts;
        // Only forecasts received before their target slot may become evidence.
        if (finite(issuedAt) && issuedAt > 0 && issuedAt <= now && now - issuedAt <= 21600000
            && Array.isArray(series) && series.length <= MAX) {
            for (const x of series) if (finite(x.timestamp) && x.timestamp > now && x.timestamp % STEP === 0
                && x.timestamp <= now + 48 * 3600000 && finite(x.valueW) && x.valueW >= 0) {
                const old = this.predictions.get(x.timestamp);
                if (!old || old.issuedAt < issuedAt)
                    this.predictions.set(x.timestamp, {issuedAt, valueW: x.valueW, ...this.band(x.valueW), coveredMs: 0, wattMs: 0});
            }
        }
        const good = x => x?.measurements?.pv?.valid === true && x.measurements.pv.ack === true
            && !x.measurements.pv.q && finite(x.power?.pv_W) && x.power.pv_W >= 0;
        const before = this.last;
        if (before && now > before.ts && now - before.ts <= 10000 && good(before) && good(s)) {
            for (let at = before.ts; at < now;) {
                const start = Math.floor(at / STEP) * STEP, end = Math.min(now, start + STEP);
                const p = this.predictions.get(start);
                if (p && p.issuedAt < start) {p.coveredMs += end - at; p.wattMs += before.power.pv_W * (end - at);}
                at = end;
            }
        }
        for (const [at, p] of this.predictions) if (at + STEP <= now) {
            if (p.coveredMs >= STEP * 0.9 && p.coveredMs <= STEP && p.valueW >= 200) {
                const actual = p.wattMs / p.coveredMs;
                this.errors.push(actual - p.valueW); if (this.errors.length > 192) this.errors.shift();
                if (finite(p.lowerW) && finite(p.upperW)) {
                    this.coverage.push(actual >= p.lowerW && actual <= p.upperW);
                    if (this.coverage.length > 192) this.coverage.shift();
                }
            }
            this.predictions.delete(at);
        }
        while (this.predictions.size > MAX) this.predictions.delete(this.predictions.keys().next().value);
        this.last = {ts: now, measurements: {pv: s.measurements?.pv}, power: {pv_W: s.power?.pv_W}};
        return this.report(now);
    }
    report(now) {
        return {samples: this.errors.length, minimumSamples: 20, method: 'session-daylight-residual-quantiles-10-90',
            status: this.errors.length >= 20 ? 'empirical' : 'insufficient-data',
            medianErrorW: quantile(this.errors, 0.5), evaluatedBands: this.coverage.length,
            observedCoverage: this.coverage.length ? this.coverage.filter(Boolean).length / this.coverage.length : null,
            preview: [...this.predictions].filter(([at]) => at > now).sort((a, b) => a[0] - b[0]).slice(0, 8)
                .map(([timestamp, p]) => ({timestamp, expectedW: p.valueW, ...this.band(p.valueW)})),
            note: 'Nur vorab bekannte Prognosen und mindestens90% beobachtete Viertelstunden; sitzungsbezogen, keine saisonale Sicherheit. Reine Vorschau, keine zusätzliche PV-Korrektur im Regler.'};
    }
}
module.exports = {ForecastLearning, LoadAdjustment};
