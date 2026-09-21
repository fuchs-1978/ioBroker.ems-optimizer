/* Slow supervisory heat-pump advice, not compressor or fast NVP control.
 * Values 0/1/2 mean REDUCED/NORMAL/BOOST only. Nothing is written to an ISG,
 * SG-Ready input, compressor enable, or other external device in this version.
 */
'use strict';

let heatPumpAdviceMode = 'NORMAL';
let heatPumpAdviceChangedAt = 0;
let heatPumpPvBoostLatched = false;
let heatPumpPriceBoostLatched = false;

function createHeatPumpStates() {
    const r = CFG.root;
    const definitions = {
        'Control.CheapEnergyAllowed': false,
        'Control.ThermalPriceValid': false,
        'Control.CurrentTotalPrice_ct_kWh': 0,
        'Control.ThermalPriceSource': 'unbekannt',
        'Control.ThermalPricePolicyStatus': 'Noch nicht ausgewertet',
        'Devices.HeatPump.RequestedMode': 'NORMAL',
        'Devices.HeatPump.RequestedModeValue': 1,
        'Devices.HeatPump.AdviceValid': false,
        'Devices.HeatPump.AdviceEnabled': false,
        'Devices.HeatPump.HeatRoomAvailable': false,
        'Devices.HeatPump.HeatingRoomAvailable': false,
        'Devices.HeatPump.DHWRoomAvailable': false,
        'Devices.HeatPump.CoolingActive': false,
        'Devices.HeatPump.CoolingDataValid': false,
        'Devices.HeatPump.PVSurplus_W': 0,
        'Devices.HeatPump.HoldRemaining_s': 0,
        'Devices.HeatPump.LastModeChange': 0,
        'Devices.HeatPump.AdviceLastUpdate': 0,
        'Devices.HeatPump.AdviceReason': 'Lokale WP-Regelung; keine externe Ausgabe',
        'Devices.HeatPump.OutputOwned': false,
        'Devices.HeatPump.OutputActive': false
    };
    for (const [key, value] of Object.entries(definitions))
        stateDef(`${r}.${key}`, value, typeof value,
            typeof value === 'boolean' ? 'indicator' : typeof value === 'number' ? 'value' : 'text', '', key);
}

function heatPumpConfig(suffix, nativeName, fallback) {
    const state = getState(`${CFG.root}.Config.${suffix}`);
    return state && state.val !== undefined && state.val !== null
        ? state.val : nativeConfig[nativeName] ?? fallback;
}

function heatPumpFreshNumber(id, maxAgeMs, now = Date.now()) {
    if (!id || !existsState(id)) return null;
    const state = getState(id);
    const value = numericValue(state?.val);
    const timestamp = numericValue(state?.ts);
    if (value === null || timestamp === null || timestamp <= 0 || state.ack !== true
        || (state.q !== undefined && Number(state.q) !== 0)
        || timestamp > now + 1000 || now - timestamp > maxAgeMs) return null;
    return value;
}

function thermalPriceSwitch(externalId, internalSuffix) {
    if (externalId) {
        const state = getState(externalId);
        if (!state || (state.q !== undefined && Number(state.q) !== 0)) return null;
        return readBooleanInput(externalId);
    }
    const value = getState(`${CFG.root}.Config.${internalSuffix}`)?.val;
    return value === true ? true : value === false ? false : null;
}

function thermalRawPriceAt(id, now) {
    if (!id || !existsState(id)) return null;
    const state = getState(id);
    if (!state || state.ack !== true || (state.q !== undefined && Number(state.q) !== 0)) return null;
    const stateTimestamp = numericValue(state.ts);
    if (stateTimestamp === null || stateTimestamp <= 0 || stateTimestamp > now + 1000) return null;
    let series;
    try { series = typeof state.val === 'string' ? JSON.parse(state.val) : state.val; }
    catch (_) { return null; }
    if (!Array.isArray(series) || !series.length) return null;
    // Hourly and quarter-hourly price products both occur. A missing quarter
    // must not inherit that hour's first price when the source is quarter-hourly.
    const timestamps = series.map(item => numericValue(item?.ts)).filter(value => value !== null && value > 0);
    const durationMs = timestamps.some(ts => ts % 3600000 !== 0) ? 900000 : 3600000;
    let selected = null;
    for (const item of series) {
        const timestamp = numericValue(item?.ts);
        if (timestamp === null || timestamp <= 0 || timestamp > now || now >= timestamp + durationMs) continue;
        if (!selected || timestamp > Number(selected.ts)) selected = item;
    }
    return selected ? numericValue(selected.val) : null;
}

function evaluateThermalPricePolicy(now = Date.now()) {
    const energyDynamic = thermalPriceSwitch(CFG.dp.dynamicEnergyPriceEnabled, 'DynamicEnergyPriceEnabled');
    const gridDynamic = thermalPriceSwitch(CFG.dp.dynamicGridFeeEnabled, 'DynamicGridFeeEnabled');
    const fixedEnergy = numericValue(getState(`${CFG.root}.Config.FixedEnergyComponent_ct_kWh`)?.val);
    const fixedGrid = numericValue(getState(`${CFG.root}.Config.FixedGridFee_ct_kWh`)?.val);
    const adders = numericValue(getState(`${CFG.root}.Config.DynamicEnergyAdders_ct_kWh`)?.val);
    const energyRaw = energyDynamic === true ? thermalRawPriceAt(CFG.dp.energyPriceSeries, now) : fixedEnergy;
    const gridCt = gridDynamic === true ? thermalRawPriceAt(CFG.dp.gridFeeSeries, now) : fixedGrid;
    const energyCt = energyRaw === null || (energyDynamic === true && adders === null)
        ? null : energyRaw + (energyDynamic === true ? adders : 0);
    const calculatedTotal = energyCt === null || gridCt === null ? NaN : energyCt + gridCt;
    const valid = energyDynamic !== null && gridDynamic !== null
        && Number.isFinite(energyCt) && Number.isFinite(gridCt) && Number.isFinite(calculatedTotal);
    const totalCt = valid ? calculatedTotal : null;
    const threshold = numericValue(heatPumpConfig('ThermalCheapPriceMax_ct_kWh', 'thermalCheapPriceMaxCt', 0));
    const enabled = heatPumpConfig('ThermalCheapPriceEnabled', 'thermalCheapPriceEnabled', false) === true;
    const fixedAllowed = heatPumpConfig('ThermalCheapFixedTariffAllowed', 'thermalCheapFixedTariffAllowed', false) === true;
    const hasDynamicComponent = energyDynamic === true || gridDynamic === true;
    const cheapAllowed = enabled && valid && threshold !== null
        && (hasDynamicComponent || fixedAllowed) && totalCt <= threshold;
    const source = !valid ? 'ungueltig'
        : hasDynamicComponent ? `Gesamtpreis: Energie ${energyDynamic ? 'dynamisch + Aufschlaege' : 'fester Tarif'}, Netz ${gridDynamic ? 'dynamisch' : 'fest'}`
            : 'Fester Gesamtstromtarif; kein Boersenpreis';
    const reason = !valid ? 'Aktueller Gesamtpreis fehlt/ungueltig; keine preisbedingte Netzwaerme'
        : !enabled ? 'Preisbedingte Netzwaerme deaktiviert'
            : !hasDynamicComponent && !fixedAllowed ? 'Fester Tarif nicht fuer preisbedingte Netzwaerme freigegeben'
                : threshold === null ? 'Preisgrenze ungueltig'
                    : cheapAllowed ? `Gesamtpreis ${totalCt.toFixed(3)} ct/kWh <= ${threshold} ct/kWh; thermische und Leistungsgrenzen bleiben erforderlich`
                        : `Gesamtpreis ${totalCt.toFixed(3)} ct/kWh liegt ueber ${threshold} ct/kWh`;
    write(`${CFG.root}.Control.CheapEnergyAllowed`, Boolean(cheapAllowed));
    write(`${CFG.root}.Control.ThermalPriceValid`, valid);
    write(`${CFG.root}.Control.CurrentTotalPrice_ct_kWh`, valid ? Math.round(totalCt * 1000) / 1000 : 0);
    write(`${CFG.root}.Control.ThermalPriceSource`, source);
    write(`${CFG.root}.Control.ThermalPricePolicyStatus`, reason);
    return {valid, cheapAllowed: Boolean(cheapAllowed), totalCt, source, reason};
}

function heatPumpThermalRoom(now) {
    const maximumAgeS = numericValue(heatPumpConfig('HeatPumpTemperatureMaxAge_s', 'heatPumpTemperatureMaxAgeS', 3600));
    const bufferId = String(nativeConfig.heatPumpBufferTemperatureId || CFG.dp.heatPumpBufferTemp
        || nativeConfig.heatingTempId || CFG.dp.myPvHeatingTemp || '').trim();
    const dhwId = String(nativeConfig.heatPumpDhwTemperatureId || CFG.dp.heatPumpDhwTemp || '').trim();
    const heatingTarget = numericValue(heatPumpConfig('HeatPumpHeatingTarget_C', 'heatPumpHeatingTargetC', 45));
    const dhwTarget = numericValue(heatPumpConfig('HeatPumpDHWTarget_C', 'heatPumpDhwTargetC', 60));
    if (!(maximumAgeS > 0) || !bufferId && !dhwId)
        return {valid: false, heatingRoom: false, dhwRoom: false, reason: 'Keine gueltige WP-Speichertemperaturquelle'};
    let heatingRoom = false, dhwRoom = false;
    for (const [kind, id, target] of [['Heizpuffer', bufferId, heatingTarget], ['Trinkwasser', dhwId, dhwTarget]]) {
        if (!id) continue;
        const temperature = heatPumpFreshNumber(id, maximumAgeS * 1000, now);
        if (temperature === null || temperature < 0 || temperature > 100 || target === null || target < 5 || target > 80)
            return {valid: false, heatingRoom: false, dhwRoom: false, reason: `${kind}: WP-Temperatur oder Ziel fehlt/ungueltig/veraltet`};
        if (kind === 'Heizpuffer') heatingRoom = temperature < target;
        else dhwRoom = temperature < target;
    }
    return {valid: true, heatingRoom, dhwRoom,
        reason: heatingRoom || dhwRoom ? 'Thermische Reserve bis zum WP-Ziel vorhanden' : 'WP-Speicherziele erreicht'};
}

function heatPumpCoolingState(now) {
    if (typeof heatingCoolingState === 'function') return heatingCoolingState();
    // One authoritative cooling reader is shared with the heating-buffer
    // controller, including the optional source heartbeat for static states.
    return {valid: false, active: false, reason: 'Gemeinsame Kuehlzustandspruefung nicht verfuegbar'};
}

function publishHeatPumpAdvice(mode, reason, now, {enabled = false, valid = false,
    heatingRoom = false, dhwRoom = false, cooling = {valid: false, active: false}, pvSurplusW = 0,
    holdRemainingS = 0} = {}) {
    if (mode !== heatPumpAdviceMode || heatPumpAdviceChangedAt <= 0) {
        heatPumpAdviceMode = mode;
        heatPumpAdviceChangedAt = now;
    }
    const base = `${CFG.root}.Devices.HeatPump`;
    for (const [key, value] of Object.entries({RequestedMode: mode,
        RequestedModeValue: {REDUCED: 0, NORMAL: 1, BOOST: 2}[mode], AdviceValid: valid,
        AdviceEnabled: enabled, HeatRoomAvailable: valid && (heatingRoom || dhwRoom),
        HeatingRoomAvailable: valid && heatingRoom, DHWRoomAvailable: valid && dhwRoom,
        CoolingActive: cooling.active, CoolingDataValid: cooling.valid, PVSurplus_W: pvSurplusW,
        HoldRemaining_s: holdRemainingS, LastModeChange: heatPumpAdviceChangedAt,
        AdviceLastUpdate: now, AdviceReason: `${reason}; nur Empfehlung, lokale WP-Regelung bleibt verantwortlich`,
        OutputOwned: false, OutputActive: false})) write(`${base}.${key}`, value);
    return getHeatPumpAdvice();
}

function updateHeatPumpAdvice(now = Date.now(), availablePvW = null) {
    const r = CFG.root;
    const price = evaluateThermalPricePolicy(now);
    const enabled = heatPumpConfig('HeatPumpAdviceEnabled', 'heatPumpAdviceEnabled', false) === true
        && nativeConfig.globalWriteEnabled === true
        && getState(`${r}.System.RealOutputsEnabled`)?.val === true
        && getState(`${r}.Devices.HeatPump.Present`)?.val === true
        && getState(`${r}.Devices.HeatPump.ControlEnabled`)?.val === true
        && getState(`${r}.Control.Enabled`)?.val === true;
    const cooling = heatPumpCoolingState(now);
    const room = heatPumpThermalRoom(now);
    const importedW = heatPumpFreshNumber(CFG.dp.gridImport, 10000, now);
    const exportedW = heatPumpFreshNumber(CFG.dp.gridExport, 10000, now);
    const systemUpdated = numericValue(getState(`${r}.System.LastUpdate`)?.val);
    const valid = getState(`${r}.System.DataValid`)?.val === true && systemUpdated > 0
        && systemUpdated <= now + 1000 && now - systemUpdated <= 30000
        && importedW !== null && exportedW !== null && importedW >= 0 && exportedW >= 0 && room.valid;
    if (!enabled || !valid || !cooling.valid || cooling.active) {
        heatPumpPvBoostLatched = false;
        heatPumpPriceBoostLatched = false;
        return publishHeatPumpAdvice('NORMAL', !enabled ? 'WP-EMS-Empfehlung nicht freigegeben'
            : !cooling.valid ? cooling.reason : cooling.active ? 'Kuehlung aktiv: keine Heizanforderung'
                : !room.valid ? room.reason : 'WP-EMS-Eingangsdaten fehlen/ungueltig/veraltet', now,
        {enabled, valid: false, cooling});
    }
    // The central allocator may provide measured/reclaimable PV surplus. With
    // no such budget, use only directly verified net export, never a forecast.
    const suppliedPvW = numericValue(availablePvW);
    const pvSurplusW = Math.max(0, suppliedPvW !== null ? suppliedPvW : exportedW - importedW);
    const onW = numericValue(heatPumpConfig('HeatPumpPVBoostOn_W', 'heatPumpPvBoostOnW', 2500));
    const offW = numericValue(heatPumpConfig('HeatPumpPVBoostOff_W', 'heatPumpPvBoostOffW', 1200));
    const holdS = numericValue(heatPumpConfig('HeatPumpMinimumHold_s', 'heatPumpMinHoldS', 300));
    const cheapGridMaxW = numericValue(heatPumpConfig('ThermalCheapGridMax_W', 'thermalCheapGridMaxW', 0));
    if (!(onW > 0) || !(offW >= 0 && offW < onW) || !(holdS >= 0))
        return publishHeatPumpAdvice('NORMAL', 'WP-Hysterese/Haltezeit ungueltig', now, {enabled, cooling});
    if (!room.heatingRoom && !room.dhwRoom) {
        heatPumpPvBoostLatched = false;
        heatPumpPriceBoostLatched = false;
        return publishHeatPumpAdvice('REDUCED', room.reason, now,
            {enabled, valid, cooling, pvSurplusW});
    }
    if (pvSurplusW >= onW) heatPumpPvBoostLatched = true;
    else if (pvSurplusW < offW) heatPumpPvBoostLatched = false;
    const priceBoost = price.cheapAllowed && cheapGridMaxW > 0;
    const lostPriceAuthorization = heatPumpPriceBoostLatched && !priceBoost && !heatPumpPvBoostLatched;
    let mode = heatPumpPvBoostLatched || priceBoost ? 'BOOST' : 'NORMAL';
    let reason = priceBoost ? 'Gueltiger guenstiger Gesamtpreis und begrenzte Netzwaerme freigegeben'
        : heatPumpPvBoostLatched ? 'Gemessener PV-Ueberschuss fuer thermischen Vorrat'
            : 'Kein WP-Boostfenster; normale lokale Regelung';
    let holdRemainingS = 0;
    if (!lostPriceAuthorization && mode !== heatPumpAdviceMode && heatPumpAdviceChangedAt > 0
        && now - heatPumpAdviceChangedAt < holdS * 1000) {
        holdRemainingS = Math.ceil((holdS * 1000 - (now - heatPumpAdviceChangedAt)) / 1000);
        mode = heatPumpAdviceMode;
        reason = `Langsame WP-Empfehlung stabil halten: noch ${holdRemainingS} s`;
    }
    if (lostPriceAuthorization) reason = 'Preis-/Netzwaermefreigabe entfallen; keine preisbedingte Boost-Verlaengerung';
    heatPumpPriceBoostLatched = mode === 'BOOST' && priceBoost && !heatPumpPvBoostLatched;
    return publishHeatPumpAdvice(mode, reason, now, {enabled, valid, heatingRoom: room.heatingRoom,
        dhwRoom: room.dhwRoom, cooling, pvSurplusW, holdRemainingS});
}

function getHeatPumpAdvice() {
    const base = `${CFG.root}.Devices.HeatPump`;
    return {mode: getState(`${base}.RequestedMode`)?.val || 'NORMAL',
        value: getState(`${base}.RequestedModeValue`)?.val ?? 1,
        valid: getState(`${base}.AdviceValid`)?.val === true,
        enabled: getState(`${base}.AdviceEnabled`)?.val === true,
        heatRoomAvailable: getState(`${base}.HeatRoomAvailable`)?.val === true,
        heatingRoomAvailable: getState(`${base}.HeatingRoomAvailable`)?.val === true,
        dhwRoomAvailable: getState(`${base}.DHWRoomAvailable`)?.val === true,
        reason: getState(`${base}.AdviceReason`)?.val || ''};
}

function hasOwnedHeatPumpOutput() { return false; }

function stopHeatPumpOutput(reason = 'EMS wird beendet') {
    heatPumpPvBoostLatched = false;
    heatPumpPriceBoostLatched = false;
    return publishHeatPumpAdvice('NORMAL', reason, Date.now());
}
