'use strict';

// Operational energy reserve, not a battery-cell temperature protection.
// The host timezone never decides when the daily Berlin selection changes.
const berlin = new Intl.DateTimeFormat('en-CA', {timeZone: 'Europe/Berlin',
    year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', hourCycle: 'h23'});

function number(value) {
    if (!['number', 'string'].includes(typeof value)
        || typeof value === 'string' && !value.trim()) return null;
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
}

function period(now) {
    const parts = Object.fromEntries(berlin.formatToParts(new Date(now))
        .filter(part => part.type !== 'literal').map(part => [part.type, Number(part.value)]));
    const date = new Date(Date.UTC(parts.year, parts.month - 1, parts.day));
    if (parts.hour < 20) date.setUTCDate(date.getUTCDate() - 1);
    const utcTwenty = date.getTime() + 20 * 3600000;
    const berlinHour = Number(berlin.formatToParts(new Date(utcTwenty))
        .find(part => part.type === 'hour').value);
    return {key: date.toISOString().slice(0, 10), at: utcTwenty - (berlinHour - 20) * 3600000};
}

function settings(config = {}) {
    const enabled = config.batteryTemperatureMinSocEnabled === true;
    const sourceId = typeof config.batteryTemperatureForecastId === 'string'
        ? config.batteryTemperatureForecastId.trim() : '';
    const value = (key, fallback) => number(config[key] === undefined ? fallback : config[key]);
    const lower = value('batteryTemperatureLowerThresholdC', 0);
    const upper = value('batteryTemperatureUpperThresholdC', 5);
    const cold = value('batteryTemperatureColdMinSocPct', 30);
    const cool = value('batteryTemperatureCoolMinSocPct', 20);
    const warm = value('batteryTemperatureWarmMinSocPct', 10);
    const maximumAgeH = value('batteryTemperatureForecastMaxAgeH', 24);
    const staticMin = value('batteryMinSocPct', 15);
    const maxSoc = value('batteryMaxSocPct', 100);
    const boundsValid = staticMin !== null && staticMin >= 0 && staticMin < 100
        && maxSoc !== null && maxSoc > staticMin && maxSoc <= 100;
    const valid = boundsValid && sourceId.length > 0 && sourceId.length <= 1024
        && lower !== null && upper !== null && lower >= -50 && upper <= 50 && lower < upper
        && [cold, cool, warm].every(pct => pct !== null && pct >= 0 && pct < maxSoc)
        && maximumAgeH !== null && maximumAgeH >= 1 && maximumAgeH <= 48;
    const signature = JSON.stringify({sourceId, lower, upper, cold, cool, warm, maximumAgeH, maxSoc});
    return {enabled, sourceId, lower, upper, cold, cool, warm, maximumAgeH,
        staticMin, maxSoc, boundsValid, valid, signature};
}

function select(temperature, config) {
    return temperature < config.lower ? config.cold
        : temperature <= config.upper ? config.cool : config.warm;
}

function previousSelection(previous, config, now) {
    if (!previous || previous.schema !== 1 || previous.signature !== config.signature
        || previous.sourceId !== config.sourceId || previous.sourceAck !== true
        || ![0, null].includes(previous.sourceQ) || !config.valid) return null;
    const temperature = number(previous.temperatureC);
    const sourceTs = number(previous.sourceTs);
    const selectedAt = number(previous.selectedAt);
    if (temperature === null || temperature < -80 || temperature > 60
        || sourceTs === null || selectedAt === null || sourceTs <= 0 || selectedAt < sourceTs
        || selectedAt > now || selectedAt - sourceTs > config.maximumAgeH * 3600000
        || previous.minSoc !== select(temperature, config)
        || previous.periodKey !== period(selectedAt).key) return null;
    return {...previous};
}

function evaluate({now, config, source, previous} = {}) {
    const options = settings(config);
    const validNow = number(now);
    const temperature = source ? number(source.val) : null;
    const sourceTs = source ? number(source.ts) : null;
    const sourceAgeMs = sourceTs === null || validNow === null ? null : validNow - sourceTs;
    const sourceValid = Boolean(validNow !== null && source && source.ack === true
        && (source.q === undefined || number(source.q) === 0)
        && temperature !== null && temperature >= -80 && temperature <= 60
        && sourceTs !== null && sourceTs > 0 && sourceTs <= validNow
        && sourceAgeMs <= options.maximumAgeH * 3600000);
    const result = {enabled: options.enabled, configValid: options.valid,
        sourceValid, sourceId: options.sourceId, sourceTs, sourceAgeMs,
        temperatureC: temperature, valid: false, held: false, usable: options.boundsValid,
        effectiveMinSoc: options.boundsValid ? options.staticMin : null,
        reason: 'disabled-static-minimum', selection: null};
    if (!options.enabled) return result;
    if (!options.valid || validNow === null || validNow <= 0) return {...result,
        usable: false, effectiveMinSoc: null, reason: 'invalid-temperature-reserve-settings'};
    const retained = previousSelection(previous, options, validNow);
    if (retained && retained.periodKey === period(validNow).key) return {...result,
        effectiveMinSoc: retained.minSoc, usable: true, valid: true, held: !sourceValid,
        selection: retained, reason: sourceValid ? 'daily-selection-retained' : 'source-unknown-held-selection'};
    if (!sourceValid) return {...result,
        effectiveMinSoc: retained ? retained.minSoc : options.staticMin,
        valid: Boolean(retained), held: Boolean(retained), usable: true,
        selection: retained, reason: retained ? 'source-unknown-held-selection' : 'source-unknown-static-fallback'};
    const selection = {schema: 1, sourceId: options.sourceId,
        minSoc: select(temperature, options), temperatureC: temperature, sourceTs,
        sourceAck: true, sourceQ: source.q === undefined ? null : number(source.q),
        selectedAt: validNow, periodKey: period(validNow).key, signature: options.signature};
    return {...result, usable: true, valid: true, effectiveMinSoc: selection.minSoc,
        selection, reason: 'temperature-selection-applied'};
}

module.exports = {number, settings, period, evaluate};
