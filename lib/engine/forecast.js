function safeJson(id, fallback) {
    try {
        const s = getState(id);
        const parsed = JSON.parse(s && s.val);
        return Array.isArray(parsed) ? parsed : fallback;
    } catch (_) {
        return fallback;
    }
}

function buildPriceForecast(startTs) {
    const context = readPriceContext();
    const energy = [], grid = [], total = [];
    const rounded = value => value === null ? null : Math.round(value * 1000) / 1000;
    for (let i = 0; i < CFG.forecastSlots; i++) {
        const timestamp = startTs + i * PRICE_SLOT_MS;
        const price = evaluatePriceAt(timestamp, context, PRICE_SLOT_MS);
        const meta = {timestamp, endTimestamp: timestamp + PRICE_SLOT_MS, offsetMin: i * 15};
        energy.push({...meta, value_ct_kWh: rounded(price.energyCt), valid: price.energyCt !== null,
            source: price.energySource, reason: price.energyReason});
        grid.push({...meta, value_ct_kWh: rounded(price.gridCt), valid: price.gridCt !== null,
            source: price.gridSource, level: price.gridLevel, reason: price.gridReason});
        total.push({...meta, value_ct_kWh: rounded(price.totalCt), valid: price.valid, reason: price.reason});
    }
    const missing = total.filter(slot => !slot.valid);
    const invalidMode = value => value === null ? 'ungueltig' : value ? 'dynamisch' : 'fest';
    return {energy, grid, total, valid: missing.length === 0,
        status: missing.length ? `${missing.length}/${total.length} Preisintervalle fehlen/ungueltig; ${missing[0].reason}`
            : `${total.length} Viertelstunden vollstaendig; Bruttopreise`,
        mode: `Energie=${invalidMode(context.energyDynamic)}, Netz=${invalidMode(context.gridDynamic)}; brutto`};
}

// Keep explicit gaps in price charts; omitting a row draws an apparently
// continuous price across unavailable intervals in common chart consumers.
function priceChartJson(series) {
    return JSON.stringify(series.map(item => ({ts: item.timestamp, val: item.value_ct_kWh})));
}

// Forecast providers publish less often than live meters. Publication time
// (state.ts) is distinct from the delivery time stored in date/unix_time_stamp.
const FORECAST_SOURCE_MAX_AGE_MS = 6 * 60 * 60 * 1000;
const NEAR_TERM_FORECAST_SLOTS = 16;

function readForecastNumber(id, now) {
    if (!existsState(id)) return null;
    const state = getState(id);
    const publishedAt = numericValue(state?.ts);
    if (state?.ack !== true || (state.q !== undefined && Number(state.q) !== 0)
        || publishedAt === null || publishedAt <= 0 || publishedAt > now + 1000
        || now - publishedAt > FORECAST_SOURCE_MAX_AGE_MS) return null;
    const value = numericValue(state?.val);
    return value === null ? null : {value, publishedAt};
}

function readOptionalNumber(id, now = Date.now()) {
    return readForecastNumber(id, now)?.value ?? null;
}

function weatherHours() {
    const now = Date.now();
    const read = id => readOptionalNumber(id, now);
    const hourlyRows = (base, timestampKey) => {
        const rows = new Map();
        for (let hour = 0; hour < 48; hour++) {
            const prefix = `${base}.hour${hour}`;
            const timestamp = read(`${prefix}.${timestampKey}`);
            if (timestamp === null || timestamp <= 0) continue;
            // Conflicting/duplicated delivery times cannot stand in for two
            // distinct hours or choose an arbitrary PV estimate.
            rows.set(timestamp, rows.has(timestamp) ? null : {
                temperatureC: read(`${prefix}.temperature_2m`),
                windKmh: read(`${prefix}.wind_speed_10m`),
                cloudPct: read(`${prefix}.cloud_cover`),
                pvW: read(`${prefix}.global_tilted_irradiance`)
            });
        }
        return rows;
    };
    const weatherRows = hourlyRows(CFG.dp.weatherHourlyBase, 'date');
    const areaRows = new Map(CFG.pvAreas.map(area => [area.name,
        hourlyRows(`${CFG.dp.pvForecastBase}.${area.name}.hourly-forecast`, 'unix_time_stamp')]));
    const fallbackRows = areaRows.get('Carport')
        || hourlyRows(`${CFG.dp.pvForecastBase}.Carport.hourly-forecast`, 'unix_time_stamp');
    const result = [];
    const timestamps = [...new Set([...weatherRows.keys(), ...fallbackRows.keys()])].sort((a, b) => a - b);
    for (const timestamp of timestamps) {
        const wx = weatherRows.get(timestamp);
        const fallback = fallbackRows.get(timestamp);
        const temperatureC = wx?.temperatureC ?? fallback?.temperatureC ?? null;
        const windKmh = wx?.windKmh ?? fallback?.windKmh ?? null;
        const cloudPct = wx?.cloudPct ?? null;
        let pvW = 0;
        let irradianceValid = true;
        CFG.pvAreas.forEach(area => {
            const gti = areaRows.get(area.name)?.get(timestamp)?.pvW;
            if (!Number.isFinite(gti) || gti < 0) irradianceValid = false;
            // Der Adapterwert ist bei dieser Instanz bereits die auf die
            // konfigurierte PV-Flaeche umgerechnete Leistung in Watt.
            else pvW += gti;
        });
        if (timestamp !== null && temperatureC !== null && windKmh !== null && irradianceValid) {
            result.push({timestamp, temperatureC, windKmh, cloudPct, pvW: Math.round(pvW)});
        }
    }
    return result;
}

function nearestWeather(hours, timestamp) {
    if (!hours.length) return null;
    let best = hours[0];
    let distance = Math.abs(hours[0].timestamp - timestamp);
    for (let i = 1; i < hours.length; i++) {
        const currentDistance = Math.abs(hours[i].timestamp - timestamp);
        if (currentDistance < distance) {
            best = hours[i];
            distance = currentDistance;
        }
    }
    return distance <= 45 * 60 * 1000 ? best : null;
}

function nearTermForecast(startTs, now) {
    function readRows(base, timestampKey, count, fields, offsetMs = 0) {
        const rows = new Map();
        if (!base) return rows;
        const endTs = startTs + NEAR_TERM_FORECAST_SLOTS * PRICE_SLOT_MS;
        for (let i = 0; i < count; i++) {
            const prefix = `${base}.${i}`;
            const date = readForecastNumber(`${prefix}.${timestampKey}`, now);
            if (!date) continue;
            const timestamp = date.value - offsetMs;
            if (timestamp < startTs || timestamp >= endTs || timestamp % PRICE_SLOT_MS) continue;
            const values = {};
            for (const field of fields) {
                const state = readForecastNumber(`${prefix}.${field}`, now);
                values[field] = state && Math.abs(state.publishedAt - date.publishedAt) <= 120000 ? state.value : null;
            }
            rows.set(timestamp, rows.has(timestamp) ? null : values);
        }
        return rows;
    }
    const weather = readRows(CFG.dp.weatherQuarterHourBase, 'date', NEAR_TERM_FORECAST_SLOTS,
        ['temperature_2m', 'wind_speed_10m', 'cloud_cover']);
    const pv = new Map();
    // Open-Meteo Weather publishes the quarter-hour mean power in W after
    // scaling the irradiance by area capacity, despite the Wh object label.
    // Its timestamp ends the irradiance interval. The EMS labels its start.
    if (/^open-meteo-weather\.\d+\.pv-forecast$/.test(CFG.dp.pvForecastBase) && CFG.pvAreas.length) {
        const areas = CFG.pvAreas.map(area => readRows(`${CFG.dp.pvForecastBase}.${area.name}.15-min-forecast`,
            'unix_time_stamp', 96, ['global_tilted_irradiance'], PRICE_SLOT_MS));
        for (const [ts] of areas[0]) {
            const watts = areas.map(rows => rows.get(ts)?.global_tilted_irradiance);
            if (watts.every(value => Number.isFinite(value) && value >= 0))
                pv.set(ts, watts.reduce((total, value) => total + value, 0));
        }
    }
    return {weather, pv};
}

function buildForecast() {
    const now = new Date();
    const startTs = Math.floor(now.getTime() / 900000) * 900000;
    const pv = [];
    const house = [];
    const baseload = [];
    const weather = [];
    const heatDemand = [];
    const dayTypes = [];
    const minimumBaseloadW = Math.max(0,
        readNumber(`${CFG.root}.Config.MinimumBaseload_W`, 500));
    const hourlyWeather = weatherHours();
    const nearTerm = nearTermForecast(startTs, now.getTime());
    const hasNearTerm = nearTerm.weather.size > 0 || nearTerm.pv.size > 0;
    for (let i = 0; i < CFG.forecastSlots; i++) {
        const timestamp = startTs + i * 900000;
        const date = new Date(timestamp);
        const slot = slotOf(timestamp);
        const dayOffset = calendarDayNumber(date) - calendarDayNumber(now);
        const dayType = forecastDayType(date, dayOffset);
        const wx = nearestWeather(hourlyWeather, timestamp);
        const quarter = nearTerm.weather.get(timestamp);
        const quarterPvW = nearTerm.pv.get(timestamp);
        const pvW = quarterPvW ?? wx?.pvW ?? 0;
        const houseW = historyProfiles.houseTotal[dayType][slot];
        const fallbackHouseW = dayType === 'HOLIDAY'
            ? (historyProfiles.houseTotal.SUNDAY[slot] || 0)
            : 0;
        const baseloadW = historyProfiles.baseload[dayType][slot];
        const fallbackBaseloadW = dayType === 'HOLIDAY'
            ? (historyProfiles.baseload.SUNDAY[slot] || 0)
            : 0;
        const quarterTemp = quarter?.temperature_2m;
        const quarterWind = quarter?.wind_speed_10m;
        const quarterCloud = quarter?.cloud_cover;
        const validQuarterTemp = Number.isFinite(quarterTemp) && quarterTemp >= -60 && quarterTemp <= 70;
        const validQuarterWind = Number.isFinite(quarterWind) && quarterWind >= 0 && quarterWind <= 400;
        const validQuarterCloud = Number.isFinite(quarterCloud) && quarterCloud >= 0 && quarterCloud <= 100;
        const temp = validQuarterTemp ? quarterTemp : wx?.temperatureC ?? null;
        const wind = validQuarterWind ? quarterWind : wx?.windKmh ?? null;
        const heatIndex = temp === null ? null : Math.round(Math.max(0, 20 - temp) * (1 + Math.max(0, (wind || 0) - 10) * 0.01) * 10) / 10;

        const pvSlot = {timestamp, offsetMin: i * 15, valueW: Math.max(0, Math.round(pvW))};
        if (hasNearTerm) pvSlot.source = quarterPvW !== undefined ? '15min' : wx ? 'hourly' : 'unavailable';
        pv.push(pvSlot);
        house.push({timestamp, offsetMin: i * 15, dayType, valueW: houseW ?? fallbackHouseW});
        baseload.push({timestamp, offsetMin: i * 15, dayType,
            valueW: Math.max(minimumBaseloadW, baseloadW ?? fallbackBaseloadW)});
        const weatherSlot = {timestamp, offsetMin: i * 15, temperatureC: temp, windKmh: wind,
            cloudPct: validQuarterCloud ? quarterCloud : wx?.cloudPct ?? null};
        if (hasNearTerm) {
            weatherSlot.temperatureSource = validQuarterTemp ? '15min' : wx ? 'hourly' : 'unavailable';
            weatherSlot.windSource = validQuarterWind ? '15min' : wx ? 'hourly' : 'unavailable';
        }
        weather.push(weatherSlot);
        heatDemand.push({timestamp, offsetMin: i * 15, value: heatIndex});
        const dateKey = localDateKey(date);
        if (!dayTypes.some(x => x.date === dateKey)) {
            dayTypes.push({date: dateKey, type: dayType});
        }
    }
    try {
        if (typeof publishLoadComparison === 'function') publishLoadComparison();
    } catch (error) {
        // A diagnostic-model failure must never invalidate the production plan.
        loadComparisonWrite('Ready', false);
        loadComparisonWrite('Status', `Vergleichsausgabe fehlgeschlagen: ${error.message || error}`);
    }
    const prices = buildPriceForecast(startTs);
    const pvNext2hWh = Math.round(pv.slice(0, CFG.limits.pvBoostLeadSlots)
        .reduce((sumValue, x) => sumValue + x.valueW * 0.25, 0));
    // Count usable slots in the current horizon, not old rows or duplicate
    // hour labels. At least 36 of the rolling 48 hours must be covered.
    const weatherValid = weather.filter(slot => slot.temperatureC !== null).length
        >= Math.ceil(CFG.forecastSlots * 0.75);
    const confidence = historyReady
        ? (weatherValid ? 85 : 55)
        : 0;

    write(`${CFG.root}.Forecast.PV_48h_JSON`, JSON.stringify(pv));
    write(`${CFG.root}.Forecast.HouseLoad_48h_JSON`, JSON.stringify(house));
    write(`${CFG.root}.Forecast.Baseload_48h_JSON`, JSON.stringify(baseload));
    write(`${CFG.root}.Forecast.Weather_48h_JSON`, JSON.stringify(weather));
    write(`${CFG.root}.Forecast.EnergyPrice_48h_JSON`, JSON.stringify(prices.energy));
    write(`${CFG.root}.Forecast.GridFee_48h_JSON`, JSON.stringify(prices.grid));
    write(`${CFG.root}.Forecast.TotalPrice_48h_JSON`, JSON.stringify(prices.total));
    write(`${CFG.root}.Forecast.PriceMode`, prices.mode);
    write(`${CFG.root}.Forecast.PriceValid`, prices.valid);
    write(`${CFG.root}.Forecast.PriceStatus`, prices.status);
    write(`${CFG.root}.Forecast.HeatDemandIndex_48h_JSON`, JSON.stringify(heatDemand));
    write(`${CFG.root}.Forecast.PVNext2h_Wh`, pvNext2hWh);
    write(`${CFG.root}.Forecast.Confidence_pct`, confidence);
    write(`${CFG.root}.Forecast.WeatherValid`, weatherValid);
    write(`${CFG.root}.Forecast.DayTypes_JSON`, JSON.stringify(dayTypes));
    write(`${CFG.root}.Forecast.LastUpdate`, Date.now());
    write(`${CFG.root}.Chart.PV_48h_json_chart`, chartJson(pv, x => x.valueW));
    write(`${CFG.root}.Chart.HouseLoad_48h_json_chart`, chartJson(house, x => x.valueW));
    write(`${CFG.root}.Chart.Baseload_48h_json_chart`, chartJson(baseload, x => x.valueW));
    write(`${CFG.root}.Chart.OutsideTemperature_48h_json_chart`, chartJson(weather, x => x.temperatureC));
    write(`${CFG.root}.Chart.HeatDemandIndex_48h_json_chart`, chartJson(heatDemand, x => x.value));
    write(`${CFG.root}.Chart.EnergyPrice_48h_json_chart`, priceChartJson(prices.energy));
    write(`${CFG.root}.Chart.GridFee_48h_json_chart`, priceChartJson(prices.grid));
    write(`${CFG.root}.Chart.TotalPrice_48h_json_chart`, priceChartJson(prices.total));
    // Der Geraeteplan nutzt die Grundlast; sonst wuerden historisch enthaltene
    // Heizstaebe und Wallboxen beim erneuten Planen doppelt gezaehlt.
    buildDevicePlan({pv, house: baseload, houseSource: 'Forecast.Baseload_48h_JSON', prices, heatDemand});
}

function requestForecastRebuild() {
    if (forecastRebuildTimer) return;
    forecastRebuildTimer = engineTimers.setTimeout(() => {
        forecastRebuildTimer = null;
        buildForecast();
    }, 5000);
}
