'use strict';

// Diagnostic day-ahead model only. No output permissions or production forecast
// references enter this module. CPU work yields between bounded solver sweeps.
const {setImmediate: yieldLoop} = require('node:timers/promises');
const SLOT = 900000, DAY = 86400000;
const TYPES = ['SUNDAY', 'MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY', 'FRIDAY', 'SATURDAY', 'HOLIDAY'];
const FEATURES = ['load_2_calendar_days_W', 'load_7_calendar_days_W', 'time_sin', 'time_cos',
    'time_sin2', 'time_cos2', ...TYPES.map(type => `day_${type}`), 'outside_temperature_C', 'heating_degree_C'];
const finite = value => typeof value === 'number' && Number.isFinite(value);
const dateKey = date => `${date.getFullYear()}-${date.getMonth() + 1}-${date.getDate()}`;
const slotOf = ts => {const d = new Date(ts); return d.getHours() * 4 + Math.floor(d.getMinutes() / 15);};
function shiftDay(ts, days) {
    const d = new Date(ts); d.setDate(d.getDate() + days); return d.getTime();
}
function regularDay(ts) {
    const d = new Date(ts), midnight = new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
    return shiftDay(midnight, 1) - midnight === DAY;
}
function cleanRows(rows, now) {
    const map = new Map(), duplicate = new Set();
    for (const row of rows) {
        if (!finite(row?.ts) || row.ts % SLOT || !finite(row.val) || row.val < 0 || row.val > 100000
            || row.ts + SLOT > now || row.ts < now - 84 * DAY || !regularDay(row.ts)) continue;
        if (map.has(row.ts) && map.get(row.ts) !== row.val) duplicate.add(row.ts);
        map.set(row.ts, row.val);
    }
    for (const ts of duplicate) map.delete(ts);
    return map;
}
function features(ts, values, dayType, temperature = null, useTemperature = false) {
    if (!regularDay(ts) || useTemperature && !validTemperature(temperature)) return null;
    // Both lags are fully observable when tomorrow is issued today, even for
    // its final slot. No future measured lag or synthetic recursive load.
    const a = values.get(shiftDay(ts, -2)), b = values.get(shiftDay(ts, -7));
    if (!finite(a) || !finite(b)) return null;
    const angle = 2 * Math.PI * slotOf(ts) / 96;
    const type = dayType(new Date(ts));
    return [a, b, Math.sin(angle), Math.cos(angle), Math.sin(2 * angle), Math.cos(2 * angle),
        ...TYPES.map(name => Number(name === type)), useTemperature ? temperature : 0,
        useTemperature ? Math.max(0, 18 - temperature) : 0];
}
function median(values) {
    if (!values.length) return null;
    const sorted = [...values].sort((a, b) => a - b), mid = Math.floor(sorted.length / 2);
    return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}
async function fit(samples, alpha, allowed = () => true) {
    const n = samples.length, p = FEATURES.length;
    const means = Array(p).fill(0), scales = Array(p).fill(0);
    const yMean = samples.reduce((sum, row) => sum + row.y, 0) / n;
    for (const row of samples) for (let j = 0; j < p; j++) means[j] += row.x[j] / n;
    for (const row of samples) for (let j = 0; j < p; j++) scales[j] += (row.x[j] - means[j]) ** 2 / n;
    for (let j = 0; j < p; j++) scales[j] = Math.sqrt(scales[j]) || 1;
    const columns = means.map((mean, j) => Float64Array.from(samples, row => (row.x[j] - mean) / scales[j]));
    const norms = columns.map(column => column.reduce((sum, x) => sum + x * x, 0) / n);
    const residual = Float64Array.from(samples, row => row.y - yMean), weights = Array(p).fill(0);
    let converged = false, iterations = 0;
    // min ||y-Xw||²/(2n) + alpha*||w||1; unpenalized intercept.
    for (; iterations < 300; iterations++) {
        if (!allowed()) throw new Error('comparison-cancelled');
        let largest = 0;
        for (let j = 0; j < p; j++) {
            if (norms[j] < 1e-12) continue;
            const column = columns[j], previous = weights[j];
            let rho = norms[j] * previous;
            for (let i = 0; i < n; i++) rho += column[i] * residual[i] / n;
            const next = Math.sign(rho) * Math.max(0, Math.abs(rho) - alpha) / norms[j];
            const delta = next - previous; weights[j] = next;
            for (let i = 0; i < n; i++) residual[i] -= delta * column[i];
            largest = Math.max(largest, Math.abs(delta));
        }
        // Yield every sweep: training cannot monopolize the live control loop.
        await yieldLoop();
        if (!allowed()) throw new Error('comparison-cancelled');
        if (largest < 0.05) {converged = true; break;}
    }
    return {alpha, means, scales, weights, yMean, converged, iterations: iterations + 1};
}
function predict(model, x) {
    if (!model?.converged || !x) return null;
    const value = model.yMean + model.weights.reduce((sum, weight, j) => sum + weight * (x[j] - model.means[j]) / model.scales[j], 0);
    return finite(value) ? Math.round(Math.max(0, Math.min(100000, value))) : null;
}
function baseline(values, dayType) {
    const buckets = new Map();
    for (const [ts, val] of values) {
        const key = `${dayType(new Date(ts))}:${slotOf(ts)}`;
        if (!buckets.has(key)) buckets.set(key, []);
        buckets.get(key).push(val);
    }
    return ts => {
        const type = dayType(new Date(ts)), slot = slotOf(ts);
        let rows = buckets.get(`${type}:${slot}`) || [];
        if (type === 'HOLIDAY' && rows.length < 2) rows = buckets.get(`SUNDAY:${slot}`) || [];
        return rows.length >= 2 ? Math.round(median(rows)) : null;
    };
}
function validTemperature(value) {return finite(value) && value >= -40 && value <= 55;}
function temperatureRows(rows, now) {
    const result = new Map(), duplicates = new Set();
    for (const row of rows) {
        // SQL average rows use interval centers; i=true rows are synthetic
        // boundary anchors, not another measurement of the first interval.
        if (!finite(row?.ts) || row.i === true || !validTemperature(row.val)) continue;
        const offset = row.ts % SLOT;
        if (offset !== 0 && offset !== SLOT / 2) continue;
        const ts = row.ts - offset;
        if (ts + SLOT > now) continue;
        if (result.has(ts) && result.get(ts) !== row.val) duplicates.add(ts);
        result.set(ts, row.val);
    }
    for (const ts of duplicates) result.delete(ts);
    return result;
}
async function train(rows, now, dayType, temperatures = [], useTemperature = true, allowed = () => true) {
    const values = cleanRows(rows, now), temperature = temperatureRows(temperatures, now);
    const samples = [...values].sort((a, b) => a[0] - b[0]).map(([ts, y]) => ({ts, y, x: features(ts, values, dayType, temperature.get(ts), useTemperature)})).filter(row => row.x);
    const days = new Set(samples.map(row => dateKey(new Date(row.ts))));
    if (days.size < 28 || samples.length < 28 * 72) return {ready: false, reason: 'insufficient-clean-history', samples: samples.length, days: days.size};
    const cutoff = samples.at(-1).ts - 7 * DAY;
    const training = samples.filter(row => row.ts < cutoff), validation = samples.filter(row => row.ts >= cutoff);
    if (training.length < 14 * 72 || validation.length < 5 * 72) return {ready: false, reason: 'insufficient-validation-history'};
    const candidates = [];
    for (const alpha of [5, 25, 100]) {
        const model = await fit(training, alpha, allowed);
        if (model.converged) candidates.push({alpha, maeW: validation.reduce((sum, row) => sum + Math.abs(predict(model, row.x) - row.y), 0) / validation.length});
    }
    candidates.sort((a, b) => a.maeW - b.maeW || b.alpha - a.alpha);
    if (!candidates.length) return {ready: false, reason: 'solver-not-converged'};
    const model = await fit(samples, candidates[0].alpha, allowed);
    if (!model.converged) return {ready: false, reason: 'solver-not-converged'};
    return {ready: true, model, values, medianAt: baseline(values, dayType), dayType, useTemperature,
        diagnostics: {samples: samples.length, days: days.size, trainedAt: now,
            trainingThrough: Math.max(...values.keys()) + SLOT, validationSamples: validation.length,
            candidates, selectedAlpha: model.alpha, features: FEATURES,
            coefficients: Object.fromEntries(FEATURES.map((name, j) => [name, model.weights[j] / model.scales[j]])),
            iterations: model.iterations, weatherFeatures: useTemperature, brightnessFeature: false, lagDays: [2, 7]}};
}
function issue(trained, now, temperatureAt = () => null) {
    const d = new Date(now), start = new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1).getTime();
    const end = shiftDay(start, 1), slots = [];
    for (let ts = start; ts < end; ts += SLOT) slots.push({timestamp: ts,
        medianW: trained.medianAt(ts), lassoW: predict(trained.model, features(ts, trained.values, trained.dayType, temperatureAt(ts), trained.useTemperature))});
    return {date: dateKey(new Date(start)), issuedAt: now, start, end, slots};
}
function validEntry(entry, now) {
    return entry && finite(entry.start) && finite(entry.end) && finite(entry.issuedAt)
        && entry.issuedAt < entry.start && entry.issuedAt <= now && entry.end - entry.start === DAY
        && entry.start % SLOT === 0 && entry.end >= now - 14 * DAY && entry.start <= now + 2 * DAY
        && Array.isArray(entry.slots) && entry.slots.length === 96
        && entry.slots.every((row, i) => row.timestamp === entry.start + i * SLOT
            && [row.medianW, row.lassoW].every(value => value === null || finite(value) && value >= 0 && value <= 100000));
}
function restore(raw, signature, now) {
    try {
        const ledger = JSON.parse(raw);
        if (ledger.schema !== 1 || ledger.signature !== signature || !Array.isArray(ledger.entries)) return [];
        const seen = new Set();
        return ledger.entries.filter(entry => validEntry(entry, now)).filter(entry => {
            if (seen.has(entry.start)) return false; seen.add(entry.start); return true;
        }).slice(-16);
    } catch (_) {return [];}
}
function score(entries, rows, now) {
    const actual = cleanRows(rows, now), daily = [];
    for (const entry of entries.filter(value => validEntry(value, now) && value.end <= now)) {
        const pairs = entry.slots.filter(row => finite(row.medianW) && finite(row.lassoW) && actual.has(row.timestamp));
        const metrics = field => {
            const errors = pairs.map(row => row[field] - actual.get(row.timestamp));
            return {maeW: errors.length ? errors.reduce((s, x) => s + Math.abs(x), 0) / errors.length : null,
                rmseW: errors.length ? Math.sqrt(errors.reduce((s, x) => s + x * x, 0) / errors.length) : null,
                energyBiasKWh: errors.length === 96 ? errors.reduce((s, x) => s + x, 0) / 4000 : null};
        };
        daily.push({date: entry.date, issuedAt: entry.issuedAt, pairedSlots: pairs.length, expectedSlots: 96,
            complete: pairs.length === 96, actualKWh: pairs.length === 96 ? pairs.reduce((s, row) => s + actual.get(row.timestamp), 0) / 4000 : null,
            median: metrics('medianW'), lasso: metrics('lassoW')});
    }
    return {schema: 1, evaluatedAt: now, target: 'cleaned-baseload', horizon: 'next-local-calendar-day',
        days: daily, completeDays: daily.filter(day => day.complete).length,
        note: 'Paired slots only; energy requires a complete 96-slot day. No production control effect.'};
}
module.exports = {train, issue, restore, score, cleanRows, features, fit, predict, SLOT, FEATURES, temperatureRows};
