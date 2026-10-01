/* Shared gross-price calculation for forecast and live thermal authorization.
 * A missing interval is unknown, never a free/fixed replacement price.
 */
'use strict';

const PRICE_SLOT_MS = 15 * 60 * 1000;
const tariffClock = new Intl.DateTimeFormat('en-GB', {timeZone: 'Europe/Berlin',
    year: 'numeric', month: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23'});

function priceSetting(suffix, nativeName, fallback) {
    const state = getState(`${CFG.root}.Config.${suffix}`);
    return state ? numericValue(state.val) : numericValue(nativeConfig[nativeName] ?? fallback);
}

function priceGross(amount, basis, vatPct) {
    if (amount === null || !['net', 'gross'].includes(basis) || vatPct === null
        || vatPct < 0 || vatPct > 100) return null;
    const value = amount * (basis === 'net' ? 1 + vatPct / 100 : 1);
    return Number.isFinite(value) ? value : null;
}

function priceSwitch(externalId, internalSuffix, statusSuffix) {
    const id = externalId || `${CFG.root}.Config.${internalSuffix}`;
    const state = getState(id);
    const value = state && (state.q === undefined || Number(state.q) === 0)
        ? readBooleanInput(id) : null;
    if (statusSuffix) write(`${CFG.root}.Config.${statusSuffix}`,
        value === null ? `${externalId ? 'extern' : 'intern'} ungueltig: ${id}; keine Preisfreigabe`
            : externalId ? `extern: ${id}` : 'intern');
    return value;
}

function priceSeriesIntervals(series) {
    if (!Array.isArray(series)) return [];
    // Old hourly chart arrays have no end timestamp. Sub-hourly timestamps or
    // explicit quarter-hour intervals make the *whole* legacy series 15 min.
    // Thus a missing quarter cannot inherit the first value of that hour.
    const quarterHourly = series.some(item => {
        const ts = numericValue(item?.ts), end = numericValue(item?.endTs);
        return ts !== null && (ts % 3600000 !== 0 || end !== null && end - ts <= PRICE_SLOT_MS);
    });
    const duration = quarterHourly ? PRICE_SLOT_MS : 3600000;
    return series.map(item => {
        const ts = numericValue(item?.ts), value = numericValue(item?.val);
        const endTs = Object.prototype.hasOwnProperty.call(item || {}, 'endTs')
            ? numericValue(item.endTs) : ts === null ? null : ts + duration;
        return {ts, endTs, value};
    }).filter(item => item.ts !== null && item.ts > 0 && item.endTs !== null && item.endTs > item.ts);
}

function intervalPriceAt(intervals, timestamp, durationMs = 0) {
    const candidates = intervals.filter(item => item.ts <= timestamp && timestamp < item.endTs);
    if (candidates.length !== 1) return {value: null,
        reason: candidates.length ? 'Preisintervalle ueberlappen' : 'Preisintervall fehlt/abgelaufen'};
    const interval = candidates[0];
    if (durationMs > 0 && intervals.some(item => item !== interval && item.ts < timestamp + durationMs && item.endTs > timestamp))
        return {value: null, reason: 'Preisintervalle ueberlappen in der Viertelstunde'};
    if (interval.endTs < timestamp + durationMs)
        return {value: null, reason: 'Preisintervall deckt die Viertelstunde nicht vollstaendig ab'};
    if (interval.value === null) return {value: null, reason: 'Preiswert ungueltig'};
    return {value: interval.value, reason: 'gueltig', endTs: interval.endTs};
}

function seriesValueAt(series, timestamp) {
    return intervalPriceAt(priceSeriesIntervals(series), timestamp).value;
}

function readPriceSeries(id, now = Date.now()) {
    if (!id || !existsState(id)) return {intervals: [], reason: 'Preisquelle fehlt'};
    const state = getState(id), ts = numericValue(state?.ts);
    if (!state || state.ack !== true || state.q !== undefined && Number(state.q) !== 0
        || ts === null || ts <= 0 || ts > now + 1000)
        return {intervals: [], reason: 'Preisquelle: Bestaetigung, Qualitaet oder Zeitstempel ungueltig'};
    try {
        const series = typeof state.val === 'string' ? JSON.parse(state.val) : state.val;
        const intervals = priceSeriesIntervals(series);
        return {intervals, reason: intervals.length ? '' : 'Preisquelle enthaelt keine gueltigen Intervalle'};
    } catch (_) { return {intervals: [], reason: 'Preisquelle ist kein gueltiges JSON'}; }
}

function tariffMinute(value, allow24 = false) {
    if (typeof value !== 'string' || !/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(value))
        return allow24 && value === '24:00' ? 1440 : null;
    const [hours, minutes] = value.split(':').map(Number);
    return minutes % 15 === 0 ? hours * 60 + minutes : null;
}

function validateGridTariff(config = nativeConfig) {
    const year = numericValue(config.gridTariffYear);
    if (!Number.isInteger(year) || year < 2000 || year > 9999)
        return {valid: false, reason: 'Netztarif: Tarifjahr ungueltig'};
    if (!['net', 'gross'].includes(config.gridTariffBasis ?? 'gross'))
        return {valid: false, reason: 'Netztarif: Netto/Brutto ungueltig'};
    const values = {standard: numericValue(config.gridTariffStandardCt),
        high: numericValue(config.gridTariffHighCt), low: numericValue(config.gridTariffLowCt)};
    if (Object.values(values).some(value => value === null || value < 0 || value > 1000))
        return {valid: false, reason: 'Netztarif: Tarifbetrag fehlt/ungueltig'};
    if (!Array.isArray(config.gridTariffRules) || !config.gridTariffRules.length)
        return {valid: false, reason: 'Netztarif: Zeitfenster fehlen'};
    const quarters = Array.from({length: 4}, () => Array(96).fill(null));
    for (const rule of config.gridTariffRules) {
        const quarter = numericValue(rule?.quarter), from = tariffMinute(rule?.from),
            to = tariffMinute(rule?.to, true);
        if (!Number.isInteger(quarter) || quarter < 1 || quarter > 4 || from === null || to === null
            || from === to || !Object.prototype.hasOwnProperty.call(values, rule?.level))
            return {valid: false, reason: 'Netztarif: Quartal, Zeitfenster oder Tarifstufe ungueltig'};
        for (let slot = 0; slot < 96; slot++) {
            const minute = slot * 15;
            const included = from < to ? minute >= from && minute < to : minute >= from || minute < to;
            if (!included) continue;
            if (quarters[quarter - 1][slot] !== null)
                return {valid: false, reason: `Netztarif: ueberlappende Zeitfenster in Quartal ${quarter}`};
            quarters[quarter - 1][slot] = rule.level;
        }
    }
    const gap = quarters.findIndex(slots => slots.some(value => value === null));
    if (gap !== -1) return {valid: false, reason: `Netztarif: Zeitluecke in Quartal ${gap + 1}`};
    return {valid: true, year, values, quarters, basis: config.gridTariffBasis ?? 'gross', reason: 'gueltig'};
}

function scheduledGridFeeAt(tariff, timestamp) {
    if (!tariff.valid) return {value: null, reason: tariff.reason};
    const parts = Object.fromEntries(tariffClock.formatToParts(timestamp)
        .filter(part => part.type !== 'literal').map(part => [part.type, Number(part.value)]));
    if (parts.year !== tariff.year)
        return {value: null, reason: `Netztarif ${tariff.year}: fuer Jahr ${parts.year} nicht gueltig`};
    const quarter = Math.floor((parts.month - 1) / 3);
    const slot = Math.floor((parts.hour * 60 + parts.minute) / 15);
    const level = tariff.quarters[quarter][slot];
    return {value: tariff.values[level], level, reason: `Jahrestarif ${tariff.year}, ${level}`};
}

function readPriceContext(now = Date.now()) {
    const inputBasis = nativeConfig.priceInputBasis ?? 'gross';
    const vatPct = numericValue(nativeConfig.priceVatPct ?? 19);
    const energyDynamic = priceSwitch(CFG.dp.dynamicEnergyPriceEnabled, 'DynamicEnergyPriceEnabled',
        'DynamicEnergyPriceSourceStatus');
    const gridDynamic = priceSwitch(CFG.dp.dynamicGridFeeEnabled, 'DynamicGridFeeEnabled',
        'DynamicGridFeeSourceStatus');
    const energySource = nativeConfig.energyPriceSource ?? 'external';
    const gridSource = nativeConfig.gridFeeSource ?? 'external';
    const fixedMode = nativeConfig.fixedTariffMode ?? 'components';
    let fixedEnergy = priceGross(priceSetting('FixedEnergyComponent_ct_kWh', 'fixedEnergyCt', 22.85), inputBasis, vatPct);
    if (fixedMode === 'total') {
        // Both total and reference are explicitly gross, independent of the
        // basis selected for legacy component fields. Subtract the reference
        // exactly once; the time-varying network fee is added only at evaluation.
        const total = priceSetting('FixedTotalPrice_ct_kWh', 'fixedTotalPriceCt', null);
        const reference = priceSetting('ReferenceGridFee_ct_kWh', 'referenceGridFeeCt', null);
        fixedEnergy = total !== null && total > 0 && reference !== null && total >= reference && reference >= 0
            ? total - reference : null;
    } else if (fixedMode !== 'components') fixedEnergy = null;
    return {energyDynamic, gridDynamic, inputBasis, vatPct, energySource, gridSource, fixedEnergy,
        fixedGrid: priceGross(priceSetting('FixedGridFee_ct_kWh', 'fixedGridFeeCt', 6.04), inputBasis, vatPct),
        adders: priceGross(priceSetting('DynamicEnergyAdders_ct_kWh', 'dynamicEnergyAddersCt', 9.301), inputBasis, vatPct),
        energyBasis: energySource === 'energy-charts' ? 'net' : nativeConfig.energyPriceSeriesBasis ?? 'gross',
        energySeries: energyDynamic === true ? readPriceSeries(energySource === 'energy-charts'
            ? `${CFG.root}.Market.EnergyPrice_JSON` : CFG.dp.energyPriceSeries, now) : null,
        gridSeries: gridDynamic === true && gridSource === 'external' ? readPriceSeries(CFG.dp.gridFeeSeries, now) : null,
        tariff: gridDynamic === true && gridSource === 'schedule' ? validateGridTariff() : null};
}

function evaluatePriceAt(timestamp, context = readPriceContext(), durationMs = 0) {
    let energyCt = context.fixedEnergy, gridCt = context.fixedGrid;
    let energyReason = 'Fester Energieanteil', gridReason = 'Festes Netzentgelt';
    if (context.energyDynamic === null) { energyCt = null; energyReason = 'Energiepreisschalter fehlt/ungueltig'; }
    else if (context.energyDynamic) {
        const point = !['external', 'energy-charts'].includes(context.energySource)
            ? {value: null, reason: 'Energiepreisquelle ungueltig'} : context.energySeries?.reason ? {value: null, reason: context.energySeries.reason}
            : intervalPriceAt(context.energySeries?.intervals || [], timestamp, durationMs);
        const gross = priceGross(point.value, context.energyBasis, context.vatPct);
        energyCt = gross === null || context.adders === null ? null : gross + context.adders;
        energyReason = energyCt === null ? `Energie: ${point.reason}; Quelle/Basis/Aufschlaege pruefen`
            : `${context.energySource}: dynamisch + Aufschlaege`;
    }
    if (context.gridDynamic === null) { gridCt = null; gridReason = 'Netzentgeltschalter fehlt/ungueltig'; }
    else if (context.gridDynamic) {
        const point = context.gridSource === 'schedule' ? scheduledGridFeeAt(context.tariff, timestamp)
            : context.gridSource !== 'external' ? {value: null, reason: 'Netzentgeltquelle ungueltig'}
                : context.gridSeries?.reason ? {value: null, reason: context.gridSeries.reason}
                    : intervalPriceAt(context.gridSeries?.intervals || [], timestamp, durationMs);
        gridCt = priceGross(point.value, context.gridSource === 'schedule' ? context.tariff.basis : context.inputBasis, context.vatPct);
        gridReason = point.reason;
    }
    // Guard overflow as well as absent components; Infinity is not a bargain.
    if (!Number.isFinite(energyCt)) energyCt = null;
    if (!Number.isFinite(gridCt)) gridCt = null;
    const sum = energyCt === null || gridCt === null ? null : energyCt + gridCt;
    const totalCt = Number.isFinite(sum) ? sum : null;
    const valid = totalCt !== null;
    return {energyCt, gridCt, totalCt, valid, energyReason, gridReason,
        energySource: context.energyDynamic ? context.energySource : 'fixed',
        gridSource: context.gridDynamic ? context.gridSource : 'fixed',
        reason: valid ? 'Gesamtpreis gueltig (brutto)' : `${energyReason}; ${gridReason}; Gesamtpreis fehlt/ungueltig`};
}
