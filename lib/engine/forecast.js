function safeJson(id, fallback) {
    try {
        const s = getState(id);
        const parsed = JSON.parse(s && s.val);
        return Array.isArray(parsed) ? parsed : fallback;
    } catch (_) {
        return fallback;
    }
}

function seriesValueAt(series, timestamp) {
    if (!Array.isArray(series) || !series.length) return null;
    const hourTs = Math.floor(timestamp / 3600000) * 3600000;
    const exact = series.find(item => Number(item.ts) === hourTs);
    if (exact && Number.isFinite(Number(exact.val))) return Number(exact.val);
    return null;
}

function buildPriceForecast(startTs) {
    const dynamicEnergyEnabled = Boolean(getState(`${CFG.root}.Config.DynamicEnergyPriceEnabled`)?.val);
    const dynamicGridEnabled = Boolean(getState(`${CFG.root}.Config.DynamicGridFeeEnabled`)?.val);
    const fixedEnergy = readNumber(`${CFG.root}.Config.FixedEnergyComponent_ct_kWh`, 22.85);
    const fixedGrid = readNumber(`${CFG.root}.Config.FixedGridFee_ct_kWh`, 6.04);
    const dynamicAdders = readNumber(`${CFG.root}.Config.DynamicEnergyAdders_ct_kWh`, 9.301);
    const energySeries = safeJson(CFG.dp.energyPriceSeries, []);
    const gridSeries = safeJson(CFG.dp.gridFeeSeries, []);
    const energy = [];
    const grid = [];
    const total = [];
    for (let i = 0; i < CFG.forecastSlots; i++) {
        const timestamp = startTs + i * 900000;
        const dynamicEnergy = seriesValueAt(energySeries, timestamp);
        const dynamicGrid = seriesValueAt(gridSeries, timestamp);
        const energyCt = dynamicEnergyEnabled && dynamicEnergy !== null
            ? dynamicEnergy + dynamicAdders
            : fixedEnergy;
        const gridCt = dynamicGridEnabled && dynamicGrid !== null
            ? dynamicGrid
            : fixedGrid;
        energy.push({timestamp, offsetMin: i * 15, value_ct_kWh: Math.round(energyCt * 1000) / 1000,
            source: dynamicEnergyEnabled && dynamicEnergy !== null ? 'dynamic' : 'fixed'});
        grid.push({timestamp, offsetMin: i * 15, value_ct_kWh: Math.round(gridCt * 1000) / 1000,
            source: dynamicGridEnabled && dynamicGrid !== null ? 'dynamic' : 'fixed'});
        total.push({timestamp, offsetMin: i * 15,
            value_ct_kWh: Math.round((energyCt + gridCt) * 1000) / 1000});
    }
    return {
        energy,
        grid,
        total,
        mode: `Energie=${dynamicEnergyEnabled ? 'dynamisch' : 'fest'}, Netz=${dynamicGridEnabled ? 'dynamisch' : 'fest'}`
    };
}

function readOptionalNumber(id) {
    if (!existsState(id)) return null;
    const n = Number(getState(id)?.val);
    return Number.isFinite(n) ? n : null;
}

function weatherHours() {
    const result = [];
    for (let hour = 0; hour < 48; hour++) {
        const weatherBase = `${CFG.dp.weatherHourlyBase}.hour${hour}`;
        const pvWeatherBase = `${CFG.dp.pvForecastBase}.Carport.hourly-forecast.hour${hour}`;
        const timestamp = readOptionalNumber(`${weatherBase}.date`)
            ?? readOptionalNumber(`${pvWeatherBase}.unix_time_stamp`);
        const temperatureC = readOptionalNumber(`${weatherBase}.temperature_2m`)
            ?? readOptionalNumber(`${pvWeatherBase}.temperature_2m`);
        const windKmh = readOptionalNumber(`${weatherBase}.wind_speed_10m`)
            ?? readOptionalNumber(`${pvWeatherBase}.wind_speed_10m`);
        const cloudPct = readOptionalNumber(`${weatherBase}.cloud_cover`);
        let pvW = 0;
        let irradianceValid = true;
        CFG.pvAreas.forEach(area => {
            const base = `${CFG.dp.pvForecastBase}.${area.name}.hourly-forecast.hour${hour}`;
            const gti = readOptionalNumber(`${base}.global_tilted_irradiance`);
            if (gti === null) irradianceValid = false;
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
    for (let i = 0; i < CFG.forecastSlots; i++) {
        const timestamp = startTs + i * 900000;
        const date = new Date(timestamp);
        const slot = slotOf(timestamp);
        const dayOffset = calendarDayNumber(date) - calendarDayNumber(now);
        const dayType = forecastDayType(date, dayOffset);
        const wx = nearestWeather(hourlyWeather, timestamp);
        const weatherPvW = wx ? wx.pvW : null;
        const pvW = weatherPvW === null ? 0 : Math.round(weatherPvW);
        const houseW = historyProfiles.houseTotal[dayType][slot];
        const fallbackHouseW = dayType === 'HOLIDAY'
            ? (historyProfiles.houseTotal.SUNDAY[slot] || 0)
            : 0;
        const baseloadW = historyProfiles.baseload[dayType][slot];
        const fallbackBaseloadW = dayType === 'HOLIDAY'
            ? (historyProfiles.baseload.SUNDAY[slot] || 0)
            : 0;
        const temp = wx ? wx.temperatureC : null;
        const wind = wx ? wx.windKmh : null;
        const heatIndex = temp === null ? null : Math.round(Math.max(0, 20 - temp) * (1 + Math.max(0, (wind || 0) - 10) * 0.01) * 10) / 10;

        pv.push({timestamp, offsetMin: i * 15, valueW: Math.max(0, pvW)});
        house.push({timestamp, offsetMin: i * 15, dayType, valueW: houseW ?? fallbackHouseW});
        baseload.push({timestamp, offsetMin: i * 15, dayType,
            valueW: Math.max(minimumBaseloadW, baseloadW ?? fallbackBaseloadW)});
        weather.push({timestamp, offsetMin: i * 15, temperatureC: temp, windKmh: wind, cloudPct: wx ? wx.cloudPct : null});
        heatDemand.push({timestamp, offsetMin: i * 15, value: heatIndex});
        const dateKey = localDateKey(date);
        if (!dayTypes.some(x => x.date === dateKey)) {
            dayTypes.push({date: dateKey, type: dayType});
        }
    }
    const prices = buildPriceForecast(startTs);
    const pvNext2hWh = Math.round(pv.slice(0, CFG.limits.pvBoostLeadSlots)
        .reduce((sumValue, x) => sumValue + x.valueW * 0.25, 0));
    const weatherValid = hourlyWeather.length >= 36;
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
    write(`${CFG.root}.Chart.EnergyPrice_48h_json_chart`, chartJson(prices.energy, x => x.value_ct_kWh));
    write(`${CFG.root}.Chart.GridFee_48h_json_chart`, chartJson(prices.grid, x => x.value_ct_kWh));
    write(`${CFG.root}.Chart.TotalPrice_48h_json_chart`, chartJson(prices.total, x => x.value_ct_kWh));
    // Der Geraeteplan nutzt die Grundlast; sonst wuerden historisch enthaltene
    // Heizstaebe und Wallboxen beim erneuten Planen doppelt gezaehlt.
    buildDevicePlan({pv, house: baseload, prices, heatDemand});
}

function requestForecastRebuild() {
    if (forecastRebuildTimer) return;
    forecastRebuildTimer = setTimeout(() => {
        forecastRebuildTimer = null;
        buildForecast();
    }, 5000);
}

