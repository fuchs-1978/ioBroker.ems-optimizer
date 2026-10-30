function getHistory(id, start, end) {
    return new Promise((resolve, reject) => {
        let settled = false;
        let issued = false, backendDone = false;
        const timeout = engineTimers.setTimeout(() => {
            if (settled) return;
            settled = true;
            const error = new Error(`SQL-Historie: keine Antwort innerhalb 30 s (${id})`);
            error.backendCompletionObserved = !issued;
            reject(error);
        }, 30000);
        // Metadata read shares the query timeout. Never ask SQL for an
        // unrecorded source: that produces misleading id-not-found warnings.
        Promise.resolve().then(() => {
            if (typeof historySourceEnabled !== 'function')
                throw new Error('SQL-Aufzeichnung kann nicht geprueft werden');
            return historySourceEnabled(id, CFG.sqlInstance);
        }).then(enabled => {
            if (settled) return;
            if (enabled !== true) throw new Error(`SQL-Aufzeichnung nicht aktiviert (${id}, ${CFG.sqlInstance})`);
            issued = true; historyUnresolvedQueries++;
            sendTo(CFG.sqlInstance, 'getHistory', {
                id,
                options: {
                    start,
                    end,
                    aggregate: 'average',
                    step: 15 * 60 * 1000,
                    addId: false,
                    limit: 10000
                }
            }, result => {
                if (!backendDone) {backendDone = true; historyUnresolvedQueries--;}
                if (settled) {
                    if (historyRetryAttempts < 3 && historyRetryAt === null)
                        historyRetryAt = Date.now() + 60000;
                    return;
                }
                settled = true;
                engineTimers.clearTimeout(timeout);
                if (!result || result.error || !Array.isArray(result.result)) {
                    const error = new Error(`SQL-Historie ${id}: ${result?.error || 'ungueltige Antwort'}`);
                    error.backendCompletionObserved = true;
                    reject(error);
                    return;
                }
                resolve(result.result.filter(x => numericValue(x?.val) !== null
                    && numericValue(x?.ts) !== null));
            });
        }).catch(error => {
            if (settled) return;
            settled = true;
            engineTimers.clearTimeout(timeout);
            error.backendCompletionObserved = !issued || backendDone;
            reject(error);
        });
    });
}

function pause(ms) {
    return new Promise(resolve => engineTimers.setTimeout(resolve, ms));
}

// Process-local source cache: restart deliberately rebuilds from recorded SQL.
// Commit each completed chunk so a retry resumes rather than repeating old work.
const historySourceCache = new Map();
async function getHistoryChunked(id, start, end) {
    if (!id) return [];
    const step = 15 * 60 * 1000;
    const chunkMs = 86400000;
    start = Math.floor(start / step) * step;
    end = Math.floor(end / step) * step;
    const key = `${CFG.sqlInstance}:${id}`;
    let cache = historySourceCache.get(key);
    if (!cache || cache.start > start || cache.end > end || cache.end < start) {
        cache = {start, end: start, values: []};
        historySourceCache.set(key, cache);
    }
    cache.values = cache.values.filter(value => Number(value.ts) >= start && Number(value.ts) < end);
    cache.start = start;
    // Re-read two complete slots to replace provisional aggregation at the tail.
    const queryStart = Math.max(start, cache.end - 2 * step);
    for (let chunkStart = queryStart; chunkStart < end; chunkStart += chunkMs) {
        const chunkEnd = Math.min(end, chunkStart + chunkMs);
        const chunk = await getHistory(id, chunkStart, chunkEnd);
        const retained = cache.values.filter(value => Number(value.ts) < chunkStart
            || Number(value.ts) >= chunkEnd);
        cache.values = [...new Map([...retained, ...chunk.filter(value =>
            Number(value.ts) >= chunkStart && Number(value.ts) < chunkEnd)]
            .map(value => [Number(value.ts), value])).values()].sort((a, b) => a.ts - b.ts);
        cache.end = chunkEnd;
        await pause(100);
    }
    return cache.values.slice();
}

function slotOf(ts) {
    const d = new Date(Number(ts));
    return d.getHours() * 4 + Math.floor(d.getMinutes() / 15);
}

// Opt-in recency weighting, using already loaded rows; never another SQL query.
function recentProfile(values, filter, now = Date.now()) {
    const buckets = Array.from({length: 96}, () => []), days = new Map(), irregularDays = new Set();
    for (const x of values) {
        const value = numericValue(x?.val), ts = numericValue(x?.ts);
        if (value === null || ts === null || ts > now || value < 0 || (filter && !filter(new Date(ts)))) continue;
        const slot = slotOf(ts), weight = Math.pow(0.5, (now - ts) / (28 * 86400000));
        buckets[slot].push({value, weight});
        const date = new Date(ts), key = localDateKey(date);
        if (new Date(date.getFullYear(), date.getMonth(), date.getDate() + 1).getTime()
            - new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime() !== 86400000) irregularDays.add(key);
        if (!days.has(key)) days.set(key, new Map());
        days.get(key).set(slot, value);
    }
    const median = list => {
        if (!list.length) return null;
        list.sort((a, b) => a - b); const mid = Math.floor(list.length / 2);
        return list.length % 2 ? list[mid] : (list[mid - 1] + list[mid]) / 2;
    };
    const result = buckets.map(list => {
        if (!list.length) return null;
        list.sort((a, b) => a.value - b.value);
        const half = list.reduce((sum, x) => sum + x.weight, 0) / 2;
        let sum = 0;
        for (let i = 0; i < list.length; i++) {
            sum += list[i].weight;
            if (sum >= half) return sum === half && list[i + 1] ? (list[i].value + list[i + 1].value) / 2 : list[i].value;
        }
        return list.at(-1).value;
    });
    // Compare only complete local days. Missing slots never become zero and
    // a partial day cannot pull the daily energy target down.
    const dailyWh = [...days].filter(([key, day]) => day.size === 96 && !irregularDays.has(key)).map(([, day]) => day)
        .map(day => [...day.values()].reduce((sum, value) => sum + value * 0.25, 0));
    const sumWh = result.every(Number.isFinite) ? result.reduce((sum, value) => sum + value * 0.25, 0) : null;
    const targetWh = dailyWh.length >= 3 ? median(dailyWh) : null;
    const scale = targetWh !== null && sumWh > 0 ? Math.max(0.8, Math.min(1.25, targetWh / sumWh)) : 1;
    return result.map(value => value === null ? null : Math.round(value * scale));
}

function profile(values, filter) {
    if (typeof nativeConfig !== 'undefined' && nativeConfig.historyProfileMethod === 'recent-weighted' && filter)
        return recentProfile(values, filter);
    const buckets = Array.from({length: 96}, () => []);
    values.forEach(x => {
        const slot = slotOf(x.ts);
        if (numericValue(x?.val) !== null && Number.isInteger(slot)
            && (!filter || filter(new Date(Number(x.ts))))) {
            buckets[slot].push(Number(x.val));
        }
    });
    return buckets.map(list => {
        if (!list.length) return null;
        list.sort((a, b) => a - b);
        // Median ist robuster gegen einzelne Lade- und Heizspitzen.
        const m = Math.floor(list.length / 2);
        return Math.round(list.length % 2 ? list[m] : (list[m - 1] + list[m]) / 2);
    });
}

function mergeSubmeterProfile(meterSeries, flexibleSeries) {
    const byTs = new Map();
    const round = ts => Math.floor(Number(ts) / 900000) * 900000;
    meterSeries.forEach((series, index) => series.forEach(x => {
        if (numericValue(x?.ts) === null || numericValue(x?.val) === null) return;
        const k = round(x.ts);
        const o = byTs.get(k) || {meters: [], flexible: []};
        o.meters[index] = Number(x.val);
        byTs.set(k, o);
    }));
    flexibleSeries.forEach((item, index) => {
        const bySlot = new Map();
        item.series.forEach(x => {
            if (numericValue(x?.ts) !== null && numericValue(x?.val) !== null)
                bySlot.set(round(x.ts), Number(x.val));
        });
        bySlot.forEach((value, k) => {
            const o = byTs.get(k) || {meters: [], flexible: []};
            o.flexible[index] = value * item.multiplier;
            byTs.set(k, o);
        });
    });
    const totalValues = [];
    const baseloadValues = [];
    byTs.forEach((o, ts) => {
        // Array.every skips holes: a reading for meter 4 used to make a
        // sparse [missing, missing, missing, value] look complete.
        if (meterSeries.length > 0
            && meterSeries.every((_, index) => Number.isFinite(o.meters[index]))) {
            const meterTotalW = o.meters.reduce((sumValue, value) => sumValue + value, 0);
            totalValues.push({ts, val: Math.max(0, meterTotalW)});
            // A recorded zero is usable. A gap/NULL in even one included load
            // leaves subtraction unknown, without discarding valid total load.
            if (flexibleSeries.every((_, index) => Number.isFinite(o.flexible[index]))) {
                const flexibleW = o.flexible.reduce((sumValue, value) => sumValue + value, 0);
                baseloadValues.push({ts, val: Math.max(0, meterTotalW - flexibleW)});
            }
        }
    });
    return {totalValues, baseloadValues};
}

function easterSunday(year) {
    const a = year % 19;
    const b = Math.floor(year / 100);
    const c = year % 100;
    const d = Math.floor(b / 4);
    const e = b % 4;
    const f = Math.floor((b + 8) / 25);
    const g = Math.floor((b - f + 1) / 3);
    const h = (19 * a + b - d - g + 15) % 30;
    const i = Math.floor(c / 4);
    const k = c % 4;
    const l = (32 + 2 * e + 2 * i - h - k) % 7;
    const m = Math.floor((a + 11 * h + 22 * l) / 451);
    const month = Math.floor((h + l - 7 * m + 114) / 31) - 1;
    const day = ((h + l - 7 * m + 114) % 31) + 1;
    return new Date(year, month, day);
}

function isHolidayNI(date) {
    const key = `${date.getMonth() + 1}-${date.getDate()}`;
    if (['1-1', '5-1', '10-3', '10-31', '12-25', '12-26'].includes(key)) return true;
    const easter = easterSunday(date.getFullYear());
    const offset = calendarDayNumber(date) - calendarDayNumber(easter);
    return [-2, 1, 39, 50].includes(offset); // Karfreitag, Ostermontag, Himmelfahrt, Pfingstmontag
}

function historicDayType(date) {
    if (isHolidayNI(date)) return 'HOLIDAY';
    return ['SUNDAY', 'MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY', 'FRIDAY', 'SATURDAY'][date.getDay()];
}

function forecastDayType(date, dayOffset) {
    const holidayIds = [CFG.dp.holidayToday, CFG.dp.holidayTomorrow, CFG.dp.holidayAfterTomorrow];
    const holiday = dayOffset >= 0 && dayOffset < holidayIds.length
        ? Boolean(getState(holidayIds[dayOffset])?.val)
        : false;
    if (holiday || isHolidayNI(date)) return 'HOLIDAY';
    return ['SUNDAY', 'MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY', 'FRIDAY', 'SATURDAY'][date.getDay()];
}

function calendarDayNumber(date) {
    return Math.floor(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()) / 86400000);
}

function localDateKey(date) {
    const pad = value => String(value).padStart(2, '0');
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

async function buildHistory() {
    if (historyBuilding || historyUnresolvedQueries > 0) return;
    historyBuilding = true;
    write(`${CFG.root}.History.Building`, true);
    write(`${CFG.root}.History.Status`, 'SQL-Historie wird ausgewertet');

    const end = Date.now();
    const start = end - CFG.historyDays * 86400000;
    let progress = 'Quellenliste vorbereiten';
    const elapsedS = () => Math.max(0, (Date.now() - end) / 1000).toFixed(1);
    try {
        const historyIds = [
            CFG.dp.pvPower,
            ...CFG.dp.houseMetersW,
            ...CFG.dp.wallboxesKW,
            ...(CFG.dp.myPvDhwHistoryW ? [CFG.dp.myPvDhwHistoryW] : []),
            ...(CFG.dp.myPvHeatingHistoryW ? [CFG.dp.myPvHeatingHistoryW] : [])
        ];
        log(`SQL-Historie: Start; ${historyIds.length} Quellen, ${CFG.historyDays} Tage`, 'info');
        const result = [];
        for (let index = 0; index < historyIds.length; index++) {
            const id = historyIds[index];
            progress = `Quelle ${index + 1}/${historyIds.length}: ${id}`;
            write(`${CFG.root}.History.Status`,
                `SQL-Historie ${index + 1}/${historyIds.length}: ${id}`);
            log(`SQL-Historie: lese ${progress} (${elapsedS()} s seit Start)`, 'info');
            result.push(await getHistoryChunked(id, start, end));
            await pause(250);
        }
        let cursor = 0;
        const pv = result[cursor++];
        const meters = CFG.dp.houseMetersW.map(() => result[cursor++]);
        const wallboxes = CFG.dp.wallboxesKW.map(() => result[cursor++]);
        const myPvDhw = CFG.dp.myPvDhwHistoryW ? result[cursor++] : [];
        const myPvHeating = CFG.dp.myPvHeatingHistoryW ? result[cursor++] : [];
        const flexibleSeries = [];
        if (Boolean(getState(`${CFG.root}.Config.WallboxesIncludedInSubmeters`)?.val)) {
            wallboxes.forEach(series => flexibleSeries.push({series, multiplier: 1000}));
        }
        if (Boolean(getState(`${CFG.root}.Config.MyPV_DHW_IncludedInSubmeters`)?.val)) {
            flexibleSeries.push({series: myPvDhw, multiplier: 1});
        }
        if (Boolean(getState(`${CFG.root}.Config.MyPV_Heating_IncludedInSubmeters`)?.val)) {
            flexibleSeries.push({series: myPvHeating, multiplier: 1});
        }
        const house = mergeSubmeterProfile(meters, flexibleSeries);
        historyProfiles.pv = profile(pv);
        DAY_TYPES.forEach(type => {
            historyProfiles.houseTotal[type] = profile(house.totalValues, d => historicDayType(d) === type);
            historyProfiles.baseload[type] = profile(house.baseloadValues, d => historicDayType(d) === type);
        });
        const profileCounts = {
            houseTotal: Object.fromEntries(Object.entries(historyProfiles.houseTotal)
                .map(([type, values]) => [type, values.filter(Number.isFinite).length])),
            baseload: Object.fromEntries(Object.entries(historyProfiles.baseload)
                .map(([type, values]) => [type, values.filter(Number.isFinite).length]))
        };
        const weekdayProfilesReady = [
            'MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY',
            'FRIDAY', 'SATURDAY', 'SUNDAY'
        ].every(type => profileCounts.houseTotal[type] >= 90 && profileCounts.baseload[type] >= 90);
        historyReady = house.totalValues.length >= CFG.minHistorySamples
            && house.baseloadValues.length >= CFG.minHistorySamples && weekdayProfilesReady;

        write(`${CFG.root}.History.PVSamples`, pv.length);
        write(`${CFG.root}.History.SubmeterSamples`, Math.min(...meters.map(series => series.length)));
        write(`${CFG.root}.History.Ready`, historyReady);
        write(`${CFG.root}.History.Profiles_JSON`, JSON.stringify(profileCounts));
        write(`${CFG.root}.History.LastBuild`, Date.now());
        write(`${CFG.root}.History.Status`, historyReady
            ? `Bereit: ${house.totalValues.length} Hauslastwerte, ${house.baseloadValues.length} Grundlastwerte; ${pv.length} PV-Lernwerte`
            : `Unvollstaendige Hauslast-/Grundlast-Historie: ${house.totalValues.length} Hauslastwerte, ${house.baseloadValues.length} Grundlastwerte; vollstaendige Wochentagsprofile erforderlich`);
        log(`SQL-Historie: abgeschlossen nach ${elapsedS()} s; ${historyReady
            ? 'bereit' : 'unvollstaendig, Startfreigabe fehlt'}; ${house.totalValues.length} Hauslastwerte, ${house.baseloadValues.length} Grundlastwerte, ${pv.length} PV-Werte`,
            historyReady ? 'info' : 'warn');
        buildForecast();
        void updateLoadComparisonHistory(house.baseloadValues, end);
        historyRetryAt = null; historyRetryAttempts = 0;
    } catch (e) {
        // Keep an already completed profile on a failed background refresh.
        // Startup still has historyReady=false; missing SQL never creates a plan.
        write(`${CFG.root}.History.Ready`, historyReady);
        write(`${CFG.root}.History.Status`, `Fehler: ${e}`);
        log(`EMS Observer Historienfehler nach ${elapsedS()} s (${progress}): ${e}`, 'warn');
        if (e.backendCompletionObserved === true && historyRetryAttempts < 3)
            historyRetryAt = Date.now() + 60000;
    } finally {
        historyBuilding = false;
        write(`${CFG.root}.History.Building`, false);
    }
}

function retryStartupHistory() {
    if (historyBuilding || historyRetryAt === null || Date.now() < historyRetryAt
        || historyRetryAttempts >= 3 || historyUnresolvedQueries > 0
        || typeof historyRetryAllowed === 'function' && !historyRetryAllowed()) return;
    historyRetryAt = null; historyRetryAttempts++;
    log(`SQL-Historie: automatischer Historien-Wiederholungsversuch ${historyRetryAttempts}/3`, 'info');
    void buildHistory();
}

// Shadow load forecasts have their own inputs/model/ledger. They never replace
// historyProfiles, production readiness or buildDevicePlan input.
let loadComparisonTraining = false;
let loadComparisonModel = null;
let loadComparisonSignature = '';
function loadComparisonContract() {
    return JSON.stringify({version: 2, meters: CFG.dp.houseMetersW, wallboxes: CFG.dp.wallboxesKW,
        dhw: CFG.dp.myPvDhwHistoryW, heating: CFG.dp.myPvHeatingHistoryW,
        subtract: ['WallboxesIncludedInSubmeters', 'MyPV_DHW_IncludedInSubmeters', 'MyPV_Heating_IncludedInSubmeters']
            .map(key => getState(`${CFG.root}.Config.${key}`)?.val === true),
        temperature: nativeConfig.loadComparisonTemperature !== false ? nativeConfig.outsideTemperatureId : null,
        sql: CFG.sqlInstance, timezone: Intl.DateTimeFormat().resolvedOptions().timeZone});
}
function loadComparisonWrite(name, value) {write(`${CFG.root}.Forecast.LoadComparison.${name}`, value);}
function publishLoadComparison(now = Date.now()) {
    if (typeof nativeConfig === 'undefined' || nativeConfig.loadComparisonEnabled !== true
        || typeof loadComparisonAllowed === 'function' && !loadComparisonAllowed()) return;
    if (!loadComparisonModel?.ready) return;
    if (loadComparisonSignature !== loadComparisonContract()) {
        loadComparisonWrite('Ready', false); loadComparisonWrite('Forecast_JSON', '{}');
        loadComparisonWrite('Status', 'Quellen geaendert; warte auf neue SQL-Lernbasis'); return;
    }
    if (now - loadComparisonModel.diagnostics.trainedAt > 36 * 3600000) {
        loadComparisonWrite('Ready', false); loadComparisonWrite('Status', 'Lernbasis aelter als 36 Stunden; keine neue Vergleichsprognose'); return;
    }
    const raw = getState(`${CFG.root}.Forecast.LoadComparison.Ledger_JSON`)?.val;
    const entries = loadForecastComparison.restore(raw, loadComparisonSignature, now);
    const weather = weatherHours();
    const entry = loadForecastComparison.issue(loadComparisonModel, now,
        ts => nearestWeather(weather, ts)?.temperatureC ?? null);
    if (!entries.some(previous => previous.start === entry.start) && entry.slots.length === 96
        && entry.slots.every(row => Number.isFinite(row.medianW) && Number.isFinite(row.lassoW))) entries.push(entry);
    const current = entries.find(previous => previous.start === entry.start);
    loadComparisonWrite('Ready', Boolean(current));
    loadComparisonWrite('Forecast_JSON', JSON.stringify(current || {date: entry.date, slots: entry.slots, issuedAt: null}));
    loadComparisonWrite('Ledger_JSON', JSON.stringify({schema: 1, signature: loadComparisonSignature, entries: entries.slice(-16)}));
    loadComparisonWrite('Status', current
        ? `Vergleich fuer ${new Date(entry.start).toLocaleDateString('de-DE')}; Median / Lasso; reine Beobachtung`
        : 'Warte auf vollstaendige Tagesprognose: Luecken bei Lags, Median oder Wetter; keine Nullauffuellung');
}
async function updateLoadComparisonHistory(rows, now) {
    if (typeof nativeConfig === 'undefined' || nativeConfig.loadComparisonEnabled !== true
        || typeof loadForecastComparison === 'undefined' || loadComparisonTraining
        || typeof loadComparisonAllowed === 'function' && !loadComparisonAllowed()) return;
    loadComparisonTraining = true;
    loadComparisonWrite('Status', 'Lasso-Vergleich wird trainiert; Produktion bleibt unveraendert');
    try {
        const signature = loadComparisonContract();
        const useTemperature = nativeConfig.loadComparisonTemperature !== false;
        let temperatures = [];
        if (useTemperature) {
            const id = nativeConfig.outsideTemperatureId;
            if (!id || await historySourceEnabled(id, CFG.sqlInstance) !== true)
                throw new Error('Aussentemperatur nicht in SQL aktiviert');
            temperatures = await getHistoryChunked(id, now - Math.min(CFG.historyDays, 84) * 86400000, now);
        }
        const model = await loadForecastComparison.train(rows, now, historicDayType, temperatures, useTemperature,
            () => typeof loadComparisonAllowed !== 'function' || loadComparisonAllowed());
        if (signature !== loadComparisonContract() || typeof loadComparisonAllowed === 'function' && !loadComparisonAllowed()) return;
        loadComparisonModel = model; loadComparisonSignature = signature;
        loadComparisonWrite('Model_JSON', JSON.stringify(model.diagnostics || {reason: model.reason, samples: model.samples, days: model.days}));
        const entries = loadForecastComparison.restore(getState(`${CFG.root}.Forecast.LoadComparison.Ledger_JSON`)?.val, signature, now);
        const evaluation = loadForecastComparison.score(entries, rows, now);
        loadComparisonWrite('Evaluation_JSON', JSON.stringify(evaluation));
        const complete = evaluation.days.filter(day => day.complete);
        loadComparisonWrite('Result', complete.length
            ? complete.slice(-3).map(day => `${day.date}: Median MAE ${Math.round(day.median.maeW)} W; Lasso MAE ${Math.round(day.lasso.maeW)} W; Energieabweichung ${day.median.energyBiasKWh.toFixed(2)} / ${day.lasso.energyBiasKWh.toFixed(2)} kWh`).join('\n')
            : `Noch kein vollstaendiger vorab prognostizierter Tag bewertet; ${evaluation.days.length} abgeschlossene Tage mit Vergleichseintrag, Luecken bleiben unbekannt`);
        loadComparisonWrite('Ready', false);
        if (model.ready) publishLoadComparison();
        else loadComparisonWrite('Status', `Lasso noch nicht bereit: ${model.reason}; mindestens 28 Tage mit vollstaendigen Merkmalen erforderlich`);
    } catch (error) {
        if (typeof loadComparisonAllowed === 'function' && !loadComparisonAllowed()) return;
        loadComparisonModel = null;
        loadComparisonWrite('Ready', false);
        loadComparisonWrite('Status', `Vergleich nicht verfuegbar: ${error.message || error}`);
    } finally {loadComparisonTraining = false;}
}
