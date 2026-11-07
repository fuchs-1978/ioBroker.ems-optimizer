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
function midnight(ts) {
    const d = new Date(ts); return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
}
function regularDay(ts) {
    const d = new Date(ts), midnight = new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
    return shiftDay(midnight, 1) - midnight === DAY;
}
function cleanRows(rows, now) {
    const map = new Map(), duplicate = new Set();
    for (const row of rows) {
        if (!finite(row?.ts) || row.ts % SLOT || !finite(row.val) || row.val < 0 || row.val > 100000
            || row.ts + SLOT > now || row.ts < now - 84 * DAY) continue;
        if (map.has(row.ts) && map.get(row.ts) !== row.val) duplicate.add(row.ts);
        map.set(row.ts, row.val);
    }
    for (const ts of duplicate) map.delete(ts);
    return map;
}
// For a repeated clock slot require both measured intervals. A missing spring
// clock hour uses the two measured neighbors. Short SQL gap estimates are kept
// separately and are only consulted for ordinary days at forecast issuance.
function calendarLag(ts, days, values, estimatedLagDays, estimatedValues) {
    const target = new Date(ts), date = new Date(ts);
    date.setHours(12, 0, 0, 0); date.setDate(date.getDate() - days);
    const anchor = new Date(date.getFullYear(), date.getMonth(), date.getDate(),
        target.getHours(), target.getMinutes()).getTime();
    const matches = candidate => {
        const d = new Date(candidate);
        return d.getFullYear() === date.getFullYear() && d.getMonth() === date.getMonth()
            && d.getDate() === date.getDate() && d.getHours() === target.getHours()
            && d.getMinutes() === target.getMinutes();
    };
    if (!matches(anchor)) {
        // A one-hour forward clock jump normalizes 02:mm to 03:mm. Require
        // the same local date and the two real neighboring clock hours. This
        // does not fill absent SQL rows, other clock jumps or measured targets.
        const after = new Date(anchor), before = new Date(anchor - 3600000);
        const sameDate = d => d.getFullYear() === date.getFullYear()
            && d.getMonth() === date.getMonth() && d.getDate() === date.getDate();
        if (!sameDate(after) || !sameDate(before)
            || after.getHours() !== target.getHours() + 1 || before.getHours() !== target.getHours() - 1
            || after.getMinutes() !== target.getMinutes() || before.getMinutes() !== target.getMinutes()
            || before.getTimezoneOffset() - after.getTimezoneOffset() !== 60) return null;
        const a = values.get(anchor - 3600000), b = values.get(anchor);
        if (!finite(a) || !finite(b)) return null;
        estimatedLagDays.push(days);
        return (a + b) / 2;
    }
    if (regularDay(anchor)) {
        const measured = values.get(anchor);
        if (finite(measured)) return measured;
        const estimated = estimatedValues?.get(anchor);
        if (!finite(estimated)) return null;
        estimatedLagDays.push(days);
        return estimated;
    }
    const occurrences = [];
    for (let candidate = anchor - 3 * 3600000; candidate <= anchor + 3 * 3600000; candidate += SLOT) {
        if (matches(candidate)) occurrences.push(values.get(candidate));
    }
    return occurrences.length && occurrences.every(finite)
        ? occurrences.reduce((sum, value) => sum + value, 0) / occurrences.length : null;
}
function features(ts, values, dayType, temperature = null, useTemperature = false, estimatedLagDays = [], forecast) {
    if (!regularDay(ts) || useTemperature && !validTemperature(temperature)) return null;
    // Both lags are fully observable when tomorrow is issued today, even for
    // its final slot. No future measured lag or synthetic recursive load.
    const lag = (days, index) => forecast?.model.weights[index] === 0 ? 0
        : calendarLag(ts, days, values, estimatedLagDays, forecast?.estimatedValues);
    const a = lag(2, 0), b = lag(7, 1);
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
        // Keep the existing regular-day Median training policy; transition-day
        // measurements are retained specifically to resolve calendar-clock lags.
        if (!regularDay(ts)) continue;
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
    const samples = [...values].sort((a, b) => a[0] - b[0]).map(([ts, y]) => {
        const estimatedLagDays = [];
        return {ts, y, estimatedLagDays, x: features(ts, values, dayType, temperature.get(ts), useTemperature, estimatedLagDays)};
    }).filter(row => row.x);
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
            estimatedLagSamples: samples.filter(row => row.estimatedLagDays.length).length,
            estimatedLagValues: samples.reduce((sum, row) => sum + row.estimatedLagDays.length, 0),
            calendarLagPolicy: 'spring-missing-hour-neighbor-mean; fall-both-occurrences-mean; measured-gaps-unknown',
            iterations: model.iterations, weatherFeatures: useTemperature, brightnessFeature: false, lagDays: [2, 7]}};
}
function issue(trained, now, temperatureAt = () => null) {
    const d = new Date(now), start = new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1).getTime();
    const end = shiftDay(start, 1), slots = [];
    for (let ts = start; ts < end; ts += SLOT) {
        const estimatedLagDays = [];
        const x = features(ts, trained.values, trained.dayType, temperatureAt(ts), trained.useTemperature, estimatedLagDays, trained);
        slots.push({timestamp: ts, medianW: trained.medianAt(ts), lassoW: predict(trained.model, x),
            estimatedLagDays: x ? estimatedLagDays : []});
    }
    addEnsembles(slots);
    return {date: dateKey(new Date(start)), issuedAt: now, start, end, slots, ensembleVersion: 1};
}
function addEnsembles(slots) {
    // Fixed policies, calculated before delivery without measured target-day
    // values. Keep fractional watts so the hybrid preserves Lasso day energy.
    const valid = value => finite(value) && value >= 0 && value <= 100000;
    const complete = slots.length === 96 && slots.every(row => valid(row.medianW) && valid(row.lassoW));
    const medianSum = complete ? slots.reduce((sum, row) => sum + row.medianW, 0) : 0;
    const lassoSum = complete ? slots.reduce((sum, row) => sum + row.lassoW, 0) : 0;
    const scale = medianSum > 0 ? lassoSum / medianSum : null;
    const hybrid = complete && scale !== null ? slots.map(row => row.medianW * scale) : null;
    const hybridValid = hybrid?.every(valid) === true;
    slots.forEach((row, i) => {
        row.blendW = valid(row.medianW) && valid(row.lassoW) ? (row.medianW + row.lassoW) / 2 : null;
        row.hybridW = hybridValid ? hybrid[i] : null;
    });
}
function validEntry(entry, now) {
    return entry && finite(entry.start) && finite(entry.end) && finite(entry.issuedAt)
        && entry.issuedAt < entry.start && entry.issuedAt <= now && entry.end - entry.start === DAY
        && entry.start % SLOT === 0 && entry.end > shiftDay(midnight(now), -14) && entry.start <= now + 2 * DAY
        && Array.isArray(entry.slots) && entry.slots.length === 96
        && entry.slots.every((row, i) => row.timestamp === entry.start + i * SLOT
            && [row.medianW, row.lassoW].every(value => value === null || finite(value) && value >= 0 && value <= 100000)
            && (entry.ensembleVersion === undefined || entry.ensembleVersion === 1
                && [row.blendW, row.hybridW].every(value => value === null || finite(value) && value >= 0 && value <= 100000)));
}
function lassoInterpolation(slots) {
    if (!Array.isArray(slots) || slots.length !== 96) return null;
    const valid = value => finite(value) && value >= 0 && value <= 100000;
    const missing = slots.filter(row => row.lassoW === null);
    if (missing.length !== 1 || !slots.every(row => valid(row.medianW)
        && (row.lassoW === null || valid(row.lassoW)))) return null;
    const index = slots.indexOf(missing[0]), before = slots[index - 1], after = slots[index + 1];
    const timestamp = missing[0].timestamp;
    if (!before || !after || before.timestamp !== timestamp - SLOT || after.timestamp !== timestamp + SLOT) return null;
    return {timestamp, valueW: (before.lassoW + after.lassoW) / 2};
}

function validInterpolation(entry, now) {
    if (!validEntry(entry, now)) return false;
    const expected = lassoInterpolation(entry.slots);
    return expected !== null && entry.interpolation?.timestamp === expected.timestamp
        && entry.interpolation?.valueW === expected.valueW;
}

function restore(raw, signature, now, key = 'entries') {
    try {
        const ledger = JSON.parse(raw);
        if (ledger.schema !== 1 || ledger.signature !== signature || !Array.isArray(ledger[key])) return [];
        const seen = new Set();
        const valid = key === 'interpolations' ? validInterpolation : validEntry;
        return ledger[key].filter(entry => valid(entry, now)).filter(entry => {
            if (seen.has(entry.start)) return false; seen.add(entry.start); return true;
        }).slice(-16);
    } catch (_) {return [];}
}
function pairMetrics(errors) {
    return {pairedSlots: errors.length,
        maeW: errors.length ? errors.reduce((s, x) => s + Math.abs(x), 0) / errors.length : null,
        rmseW: errors.length ? Math.sqrt(errors.reduce((s, x) => s + x * x, 0) / errors.length) : null,
        energyBiasKWh: errors.length === 96 ? errors.reduce((s, x) => s + x, 0) / 4000 : null};
}

function scoreInterpolationDays(entries, actual, now) {
    return entries.filter(entry => validInterpolation(entry, now) && entry.end <= now).map(entry => {
        const {timestamp, valueW} = entry.interpolation;
        const pairs = entry.slots.filter(row => actual.has(row.timestamp));
        const gap = entry.slots.find(row => row.timestamp === timestamp);
        return {date: entry.date, issuedAt: entry.issuedAt,
            median: pairMetrics(pairs.map(row => row.medianW - actual.get(row.timestamp))),
            lassoInterpolated: pairMetrics(pairs.map(row => (row.lassoW ?? valueW) - actual.get(row.timestamp))),
            gap: {timestamp, medianW: gap.medianW, lassoInterpolatedW: valueW, actualW: actual.get(timestamp) ?? null}};
    });
}

function score(entries, rows, now, interpolations = []) {
    const actual = cleanRows(rows, now), daily = [];
    for (const entry of entries.filter(value => validEntry(value, now) && value.end <= now)) {
        const pairs = entry.slots.filter(row => finite(row.medianW) && finite(row.lassoW) && actual.has(row.timestamp));
        const metrics = field => pairMetrics(pairs.filter(row => finite(row[field]))
            .map(row => row[field] - actual.get(row.timestamp)));
        daily.push({date: entry.date, issuedAt: entry.issuedAt, pairedSlots: pairs.length, expectedSlots: 96,
            complete: pairs.length === 96, actualKWh: pairs.length === 96 ? pairs.reduce((s, row) => s + actual.get(row.timestamp), 0) / 4000 : null,
            median: metrics('medianW'), lasso: metrics('lassoW'),
            ensembleVersion: entry.ensembleVersion ?? null,
            blend: metrics(entry.ensembleVersion === 1 ? 'blendW' : 'unavailable'),
            hybrid: metrics(entry.ensembleVersion === 1 ? 'hybridW' : 'unavailable')});
    }
    return {schema: 1, evaluatedAt: now, target: 'cleaned-baseload', horizon: 'next-local-calendar-day',
        days: daily, completeDays: daily.filter(day => day.complete).length,
        lassoInterpolationDays: scoreInterpolationDays(interpolations, actual, now),
        windows: [7, 14].map(days => scoreWindow(entries, actual, now, days)),
        note: 'Paired slots only; energy requires a complete 96-slot day. Blend: fixed 50/50. Hybrid: Median shape scaled to Lasso day energy. Legacy entries have no ensemble forecast. No production control effect.'};
}
const MODELS = ['median', 'lasso', 'blend', 'hybrid'];
function scoreWindow(entries, actual, now, calendarDays) {
    const to = midnight(now), from = shiftDay(to, -calendarDays);
    const all = [], complete = [], dates = [], seen = new Map(), conflicts = new Set();
    for (const entry of entries.filter(e => validEntry(e, now) && e.start >= from && e.end <= to)) {
        if (seen.has(entry.start) && JSON.stringify(seen.get(entry.start)) !== JSON.stringify(entry)) conflicts.add(entry.start);
        seen.set(entry.start, entry);
    }
    let expectedDays = 0, forecastDays = 0;
    for (let ts = from; ts < to; ts = shiftDay(ts, 1)) {
        if (!regularDay(ts)) continue;
        expectedDays++;
        const entry = conflicts.has(ts) ? null : seen.get(ts);
        if (!entry || entry.ensembleVersion !== 1) continue;
        forecastDays++;
        const pairs = entry.slots.filter(row => MODELS.every(key => finite(row[`${key}W`])) && actual.has(row.timestamp));
        const errors = pairs.map(row => MODELS.map(key => row[`${key}W`] - actual.get(row.timestamp)));
        all.push(...errors);
        if (pairs.length === 96) {
            complete.push(errors); dates.push(dateKey(new Date(ts)));
        }
    }
    const models = Object.fromEntries(MODELS.map((key, i) => {
        const errors = all.map(row => row[i]);
        const dailyEnergy = complete.map(day => day.reduce((sum, row) => sum + row[i], 0) / 4000);
        return [key, {pairedSlots: errors.length,
            maeW: errors.length ? errors.reduce((sum, error) => sum + Math.abs(error), 0) / errors.length : null,
            rmseW: errors.length ? Math.sqrt(errors.reduce((sum, error) => sum + error * error, 0) / errors.length) : null,
            energyDays: dailyEnergy.length,
            energyBiasKWh: dailyEnergy.length ? dailyEnergy.reduce((sum, kWh) => sum + kWh, 0) : null,
            meanAbsDailyEnergyBiasKWh: dailyEnergy.length ? dailyEnergy.reduce((sum, kWh) => sum + Math.abs(kWh), 0) / dailyEnergy.length : null}];
    }));
    return {calendarDays, from, to, expectedDays, excludedDstDays: calendarDays - expectedDays,
        forecastDays, pairedSlots: all.length, expectedSlots: expectedDays * 96,
        completeDays: complete.length, energyDates: dates,
        complete: complete.length === expectedDays, provisional: complete.length !== expectedDays,
        models,
        note: 'Same four-model slot intersection; pooled MAE/RMSE, not daily averages. Signed energy sum and mean absolute daily energy error use only the same complete days. Missing forecasts, legacy ensembles and actual gaps stay unknown; DST target days excluded. No model switching.'};
}
function windowText(window) {
    const labels = {median: 'Median', lasso: 'Lasso', blend: '50/50', hybrid: 'Lasso-Energie/Median-Verlauf'};
    const value = (n, digits = 0) => finite(n) ? n.toFixed(digits) : 'unbekannt';
    return `${window.calendarDays} Kalendertage: ${window.provisional ? 'vorlaeufig' : 'vollstaendig'}; `
        + `${window.pairedSlots}/${window.expectedSlots} gemeinsame Viertelstunden, ${window.completeDays}/${window.expectedDays} vollstaendige Tage, ${window.excludedDstDays} Zeitumstellungstage ausgeschlossen.\n`
        + MODELS.map(key => {const m = window.models[key];
            return `${labels[key]}: MAE ${value(m.maeW)} W, RMSE ${value(m.rmseW)} W; Energieabweichung ${value(m.energyBiasKWh, 2)} kWh, mittlerer absoluter Tagesenergiefehler ${value(m.meanAbsDailyEnergyBiasKWh, 2)} kWh (${m.energyDays} Tage)`;
        }).join('\n');
}
module.exports = {train, issue, restore, score, cleanRows, features, fit, predict, SLOT, FEATURES, temperatureRows, windowText, lassoInterpolation};
