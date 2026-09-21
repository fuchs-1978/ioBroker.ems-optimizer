function getHistory(id, start, end) {
    return new Promise((resolve, reject) => {
        let settled = false;
        const timeout = setTimeout(() => {
            if (settled) return;
            settled = true;
            reject(new Error(`SQL-Historie: keine Antwort innerhalb 30 s (${id})`));
        }, 30000);
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
            if (settled) return;
            settled = true;
            clearTimeout(timeout);
            if (!result || result.error || !Array.isArray(result.result)) {
                reject(new Error(`SQL-Historie ${id}: ${result?.error || 'ungueltige Antwort'}`));
                return;
            }
            resolve(result.result.filter(x => numericValue(x?.val) !== null
                && numericValue(x?.ts) !== null));
        });
    });
}

function pause(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

async function getHistoryChunked(id, start, end) {
    if (!id) return [];
    const chunkMs = 7 * 86400000;
    const values = [];
    for (let chunkStart = start; chunkStart < end; chunkStart += chunkMs) {
        const chunkEnd = Math.min(end, chunkStart + chunkMs);
        const chunk = await getHistory(id, chunkStart, chunkEnd);
        values.push(...chunk);
        // sql.0 erhaelt zwischen den Teilabfragen Zeit fuer GC und andere Clients.
        await pause(100);
    }
    // Adjacent SQL ranges can both include the boundary sample. Preserve one
    // sample per timestamp so flexible loads are never subtracted twice.
    return [...new Map(values.map(value => [Number(value.ts), value])).values()];
}

function slotOf(ts) {
    const d = new Date(Number(ts));
    return d.getHours() * 4 + Math.floor(d.getMinutes() / 15);
}

function profile(values, filter) {
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
        const o = byTs.get(k) || {meters: [], flexibleW: 0};
        o.meters[index] = Number(x.val);
        byTs.set(k, o);
    }));
    flexibleSeries.forEach(item => {
        const bySlot = new Map();
        item.series.forEach(x => {
            if (numericValue(x?.ts) !== null && numericValue(x?.val) !== null)
                bySlot.set(round(x.ts), Number(x.val));
        });
        bySlot.forEach((value, k) => {
            const o = byTs.get(k) || {meters: [], flexibleW: 0};
            o.flexibleW += value * item.multiplier;
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
            baseloadValues.push({ts, val: Math.max(0, meterTotalW - o.flexibleW)});
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
    if (historyBuilding) return;
    historyBuilding = true;
    write(`${CFG.root}.History.Building`, true);
    write(`${CFG.root}.History.Status`, 'SQL-Historie wird ausgewertet');

    const end = Date.now();
    const start = end - CFG.historyDays * 86400000;
    try {
        const historyIds = [
            CFG.dp.pvPower,
            ...CFG.dp.houseMetersW,
            ...CFG.dp.wallboxesKW,
            ...(CFG.dp.myPvDhwHistoryW ? [CFG.dp.myPvDhwHistoryW] : []),
            ...(CFG.dp.myPvHeatingHistoryW ? [CFG.dp.myPvHeatingHistoryW] : [])
        ];
        const result = [];
        for (let index = 0; index < historyIds.length; index++) {
            const id = historyIds[index];
            write(`${CFG.root}.History.Status`,
                `SQL-Historie ${index + 1}/${historyIds.length}: ${id}`);
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
            if (myPvHeating.length) flexibleSeries.push({series: myPvHeating, multiplier: 1});
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
        historyReady = house.totalValues.length >= CFG.minHistorySamples && weekdayProfilesReady;

        write(`${CFG.root}.History.PVSamples`, pv.length);
        write(`${CFG.root}.History.SubmeterSamples`, Math.min(...meters.map(series => series.length)));
        write(`${CFG.root}.History.Ready`, historyReady);
        write(`${CFG.root}.History.Profiles_JSON`, JSON.stringify(profileCounts));
        write(`${CFG.root}.History.LastBuild`, Date.now());
        write(`${CFG.root}.History.Status`, historyReady
            ? `Bereit: ${house.totalValues.length} Hauslast-/Grundlastwerte; ${pv.length} PV-Lernwerte`
            : `Zu wenig Unterzaehler-Historie: ${house.totalValues.length} gemeinsame Werte`);
        buildForecast();
    } catch (e) {
        // Keep an already completed profile on a failed background refresh.
        // Startup still has historyReady=false; missing SQL never creates a plan.
        write(`${CFG.root}.History.Ready`, historyReady);
        write(`${CFG.root}.History.Status`, `Fehler: ${e}`);
        log(`EMS Observer Historienfehler: ${e}`, 'warn');
    } finally {
        historyBuilding = false;
        write(`${CFG.root}.History.Building`, false);
    }
}
