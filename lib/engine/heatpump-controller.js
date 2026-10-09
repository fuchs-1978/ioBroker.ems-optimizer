/* Slow supervisory heat-pump advice, not compressor or fast NVP control.
 * Legacy values 0/1/2/3 mean REDUCED/NORMAL/BOOST/MAX only. Nothing is written to an ISG,
 * SG-Ready input, compressor enable, or other external device in this version.
 * SG-Ready recommendations use logical states 2/3/4, never automatic blocking
 * state 1. An ISG register or contact encoding is deliberately not inferred.
 */
'use strict';

let heatPumpAdviceMode = 'NORMAL';
let heatPumpAdviceChangedAt = 0;
let heatPumpPvBoostLatched = false;
let heatPumpPriceBoostLatched = false;
let heatPumpMaxBoostLatched = false;
let heatPumpCoolingPvBoostLatched = false;
let heatPumpCoolingBoostActive = false;
let heatPumpCoolingBoostChangedAt = 0;

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
        'Devices.HeatPump.PowerValid': false,
        'Devices.HeatPump.PowerScope': 'total',
        'Devices.HeatPump.PowerStatus': 'WP-Leistungsquelle noch nicht geprueft',
        'Devices.HeatPump.ConnectionValid': false,
        'Devices.HeatPump.ConnectionStatus': 'Verbindungsquelle nicht zugeordnet',
        'Devices.HeatPump.SGReadyFeedbackValid': false,
        'Devices.HeatPump.SGReadyFeedbackStatus': 'SG-Ready-Rueckmeldung nicht zugeordnet',
        'Devices.HeatPump.SGReadyRequestedState': 2,
        'Devices.HeatPump.SGReadyRecommendationValid': false,
        'Devices.HeatPump.SGReadyRecommendationReason': 'Nur Empfehlung; keine externe Ausgabe',
        'Devices.HeatPump.HeatingBoostRequested': false,
        'Devices.HeatPump.CoolingBoostRequested': false,
        'Devices.HeatPump.CoolingBoostValid': false,
        'Devices.HeatPump.CoolingBoostReason': 'Kuehlanhebung nicht freigegeben',
        'Devices.HeatPump.OutputOwned': false,
        'Devices.HeatPump.OutputActive': false
    };
    for (const [key, value] of Object.entries(definitions))
        stateDef(`${r}.${key}`, value, typeof value,
            typeof value === 'boolean' ? 'indicator' : typeof value === 'number' ? 'value' : 'text', '', key);
    for (const [key, type, unit] of [['Power_W', 'number', 'W'], ['PowerSourceAge_s', 'number', 's'],
        ['Connected', 'boolean', ''], ['SGReadyFeedbackState', 'number', ''],
        ['CoolingRoomTarget_C', 'number', '°C'], ['CoolingFlowTarget_C', 'number', '°C']])
        stateDef(`${r}.Devices.HeatPump.${key}`, null, type,
            type === 'boolean' ? 'indicator' : 'value', unit, key);
}

function heatPumpConfig(suffix, nativeName, fallback) {
    const state = getState(`${CFG.root}.Config.${suffix}`);
    // A configured but unavailable value is unknown, not permission to replace
    // it with the default. Only an absent configuration uses that default.
    return state ? state.val : nativeConfig[nativeName] === undefined ? fallback : nativeConfig[nativeName];
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

function heatPumpSource(id, maximumAgeS, now = Date.now()) {
    const source = String(id || '').trim();
    const maximumAge = numericValue(maximumAgeS);
    if (!source) return {valid: false, state: null, ageS: null, reason: 'Quelle nicht zugeordnet'};
    if (!(maximumAge > 0)) return {valid: false, state: null, ageS: null, reason: 'Quellenaltergrenze ungueltig'};
    const state = existsState(source) ? getState(source) : null;
    const timestamp = numericValue(state?.ts);
    const ageS = timestamp !== null && timestamp > 0 && timestamp <= now + 1000
        ? Math.max(0, (now - timestamp) / 1000) : null;
    const valid = Boolean(state) && timestamp !== null && timestamp > 0 && timestamp <= now + 1000
        && now - timestamp <= maximumAge * 1000 && state.ack === true
        && (state.q === undefined || Number(state.q) === 0);
    const reason = !state ? 'Quelle fehlt' : timestamp === null || timestamp <= 0 || timestamp > now + 1000
        ? 'Quellenzeit ungueltig' : state.ack !== true ? 'Quelle nicht bestaetigt (ACK fehlt)'
            : state.q !== undefined && Number(state.q) !== 0 ? 'Quellenqualitaet ungueltig'
                : now - timestamp > maximumAge * 1000 ? `Quelle veraltet (${ageS.toFixed(1)} s)` : 'Quelle bestaetigt und frisch';
    return {valid, state, ageS, reason};
}

function heatPumpMeasuredPower(now = Date.now()) {
    if (typeof heatPumpPowerMeasurement === 'function') return heatPumpPowerMeasurement(now);
    const scope = String(nativeConfig.heatPumpPowerScope ?? 'total');
    const unit = String(nativeConfig.heatPumpPowerUnit ?? 'W');
    const id = String(nativeConfig.heatPumpPowerId || CFG.dp.heatPumpPower || '').trim();
    const maximumAgeS = numericValue(heatPumpConfig('HeatPumpPowerMaxAge_s', 'heatPumpPowerMaxAgeS', 30));
    if (typeof heatPumpTelemetryParser !== 'object'
        || typeof heatPumpTelemetryParser.evaluateHeatPumpPower !== 'function')
        return {valid: false, watts: null, scope, ageS: null, reason: 'WP-Leistungspruefung nicht verfuegbar'};
    return heatPumpTelemetryParser.evaluateHeatPumpPower({id, unit, scope, now,
        maxAgeMs: maximumAgeS === null ? NaN : maximumAgeS * 1000,
        state: id && existsState(id) ? getState(id) : null});
}

function readHeatPumpTelemetry(now = Date.now()) {
    const base = `${CFG.root}.Devices.HeatPump`;
    const power = heatPumpMeasuredPower(now);
    const ageS = heatPumpConfig('HeatPumpFeedbackMaxAge_s', 'heatPumpFeedbackMaxAgeS', 120);
    const connectionId = String(nativeConfig.heatPumpConnectionId || '').trim();
    const connection = heatPumpSource(connectionId, ageS, now);
    const boolean = [true, 1, '1'].includes(connection.state?.val) ? true
        : [false, 0, '0'].includes(connection.state?.val) ? false : null;
    const connectionValid = connection.valid && boolean !== null;
    const feedback = heatPumpSource(nativeConfig.heatPumpSgReadyStateId, ageS, now);
    const sgState = numericValue(feedback.state?.val);
    const feedbackValid = feedback.valid && Number.isInteger(sgState) && sgState >= 1 && sgState <= 4;
    const connectionReason = !connection.valid ? connection.reason
        : boolean === null ? 'Verbindungswert ungueltig' : boolean ? 'Verbindung bestaetigt' : 'WP-Verbindung unterbrochen';
    for (const [key, value] of Object.entries({Power_W: power.watts, PowerValid: power.valid,
        PowerScope: power.scope, PowerSourceAge_s: power.ageS, PowerStatus: power.reason,
        Connected: connectionValid ? boolean : null, ConnectionValid: connectionValid,
        ConnectionStatus: connectionReason, SGReadyFeedbackState: feedbackValid ? sgState : null,
        SGReadyFeedbackValid: feedbackValid,
        SGReadyFeedbackStatus: !feedback.valid ? feedback.reason
            : !feedbackValid ? 'Dekodierter SG-Ready-Zustand muss 1 bis 4 sein'
                : 'Frische SG-Ready-Rueckmeldung; kein Nachweis der Annahme einer EMS-Empfehlung'})) write(`${base}.${key}`, value);
    return {power, connectionAllowed: !connectionId || connectionValid && boolean === true,
        connectionReason, connectionValid, connected: connectionValid ? boolean : null, feedbackValid};
}

function evaluateThermalPricePolicy(now = Date.now()) {
    const context = readPriceContext(now);
    const price = evaluatePriceAt(now, context);
    const {energyDynamic, gridDynamic} = context;
    const {valid, totalCt} = price;
    const threshold = numericValue(heatPumpConfig('ThermalCheapPriceMax_ct_kWh', 'thermalCheapPriceMaxCt', 0));
    const enabled = heatPumpConfig('ThermalCheapPriceEnabled', 'thermalCheapPriceEnabled', false) === true;
    const fixedAllowed = heatPumpConfig('ThermalCheapFixedTariffAllowed', 'thermalCheapFixedTariffAllowed', false) === true;
    const hasDynamicComponent = energyDynamic === true || gridDynamic === true;
    const cheapAllowed = enabled && valid && threshold !== null
        && (hasDynamicComponent || fixedAllowed) && totalCt <= threshold;
    const source = !valid ? price.reason
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

function clearHeatPumpLatches() {
    heatPumpPvBoostLatched = false;
    heatPumpPriceBoostLatched = false;
    heatPumpMaxBoostLatched = false;
}

function clearHeatPumpCoolingBoost() {
    heatPumpCoolingPvBoostLatched = false;
    heatPumpCoolingBoostActive = false;
    heatPumpCoolingBoostChangedAt = 0;
}

function heatPumpCoolingAdvice(now, enabled, inputsValid, cooling, pvSurplusW, onW, offW, holdS) {
    const roomTarget = numericValue(heatPumpConfig('HeatPumpCoolingRoomTarget_C', 'heatPumpCoolingRoomTargetC', 23));
    const configuredFlowTarget = numericValue(heatPumpConfig('HeatPumpCoolingFlowTarget_C', 'heatPumpCoolingFlowTargetC', 20));
    const margin = numericValue(heatPumpConfig('HeatPumpCoolingDewPointMargin_K', 'heatPumpCoolingDewPointMarginK', 2));
    const result = {requested: false, valid: false, roomTarget: null, flowTarget: null, reason: ''};
    const allowed = heatPumpConfig('HeatPumpCoolingBoostEnabled', 'heatPumpCoolingBoostEnabled', false) === true;
    const fail = reason => { clearHeatPumpCoolingBoost(); return {...result, reason}; };
    if (!enabled || !allowed) return fail('Kuehlanhebung nicht freigegeben');
    if (!inputsValid || !cooling.valid) return fail('Kuehlanhebung: Eingangsdaten fehlen/ungueltig/veraltet');
    if (!cooling.active) return fail('Kein bestaetigter Kuehlbetrieb; keine Kuehlanforderung');
    if (roomTarget === null || roomTarget < 16 || roomTarget > 30
        || configuredFlowTarget === null || configuredFlowTarget < 15 || configuredFlowTarget > 30
        || margin === null || margin < 0.5 || margin > 10)
        return fail('Kuehlziel oder Taupunktabstand ungueltig');
    const temperatureAgeS = numericValue(heatPumpConfig('HeatPumpTemperatureMaxAge_s', 'heatPumpTemperatureMaxAgeS', 3600));
    const feedbackAgeS = numericValue(heatPumpConfig('HeatPumpFeedbackMaxAge_s', 'heatPumpFeedbackMaxAgeS', 120));
    if (!(temperatureAgeS > 0) || !(feedbackAgeS > 0)) return fail('Kuehltemperatur-Altersgrenze ungueltig');
    // Dew point and flow are part of the current cooling guard, not a slowly
    // changing thermal-store estimate. They also obey the feedback freshness.
    const ageS = Math.min(temperatureAgeS, feedbackAgeS);
    const room = heatPumpFreshNumber(nativeConfig.heatPumpCoolingRoomTemperatureId, ageS * 1000, now);
    const dew = heatPumpFreshNumber(nativeConfig.heatPumpCoolingDewPointId, ageS * 1000, now);
    const flow = heatPumpFreshNumber(nativeConfig.heatPumpCoolingFlowTemperatureId, ageS * 1000, now);
    if (room === null || room < -20 || room > 60 || dew === null || dew < -40 || dew > 60
        || flow === null || flow < -20 || flow > 100)
        return fail('Kuehl-Raumtemperatur, Taupunkt oder Vorlauf fehlt/ungueltig/veraltet');
    const flowTarget = Math.max(configuredFlowTarget, dew + margin);
    if (flowTarget > 30)
        return fail('Taupunktabstand erfordert einen Vorlauf oberhalb des unterstuetzten Kuehlbereichs');
    result.roomTarget = roomTarget;
    result.flowTarget = flowTarget;
    result.valid = true;
    if (room <= roomTarget || flowTarget >= flow) {
        clearHeatPumpCoolingBoost();
        return {...result, reason: room <= roomTarget ? 'Kuehl-Raumziel erreicht'
            : 'Kein kuehlerer Vorlauf innerhalb des Taupunktabstands erforderlich'};
    }
    if (pvSurplusW >= onW) heatPumpCoolingPvBoostLatched = true;
    else if (pvSurplusW < offW) heatPumpCoolingPvBoostLatched = false;
    let requested = heatPumpCoolingPvBoostLatched;
    let reason = requested ? 'Reales PV-Budget und Kuehlbedarf; Vorlaufziel durch Taupunktabstand begrenzt'
        : 'Kein reales PV-Boostfenster fuer Kuehlung';
    if (requested !== heatPumpCoolingBoostActive && heatPumpCoolingBoostChangedAt > 0
        && now - heatPumpCoolingBoostChangedAt < holdS * 1000) {
        requested = heatPumpCoolingBoostActive;
        reason = 'Langsame Kuehlempfehlung innerhalb ihrer Haltezeit stabil halten';
    }
    if (requested !== heatPumpCoolingBoostActive || heatPumpCoolingBoostChangedAt <= 0)
        heatPumpCoolingBoostChangedAt = now;
    heatPumpCoolingBoostActive = requested;
    return {...result, requested, reason};
}

function publishHeatPumpAdvice(mode, reason, now, {enabled = false, valid = false,
    heatingRoom = false, dhwRoom = false, cooling = {valid: false, active: false}, pvSurplusW = 0,
    holdRemainingS = 0, sgValid = valid, coolingAdvice = {requested: false, valid: false,
        reason: 'Kuehlanhebung nicht freigegeben', roomTarget: null, flowTarget: null}} = {}) {
    if (mode !== heatPumpAdviceMode || heatPumpAdviceChangedAt <= 0) {
        heatPumpAdviceMode = mode;
        heatPumpAdviceChangedAt = now;
    }
    const base = `${CFG.root}.Devices.HeatPump`;
    const requestedSgState = mode === 'MAX' ? 4 : mode === 'BOOST' ? 3 : 2;
    for (const [key, value] of Object.entries({RequestedMode: mode,
        RequestedModeValue: {REDUCED: 0, NORMAL: 1, BOOST: 2, MAX: 3}[mode], AdviceValid: valid,
        AdviceEnabled: enabled, HeatRoomAvailable: valid && (heatingRoom || dhwRoom),
        HeatingRoomAvailable: valid && heatingRoom, DHWRoomAvailable: valid && dhwRoom,
        CoolingActive: cooling.active, CoolingDataValid: cooling.valid, PVSurplus_W: pvSurplusW,
        HoldRemaining_s: holdRemainingS, LastModeChange: heatPumpAdviceChangedAt,
        AdviceLastUpdate: now, AdviceReason: `${reason}; nur Empfehlung, lokale WP-Regelung bleibt verantwortlich`,
        SGReadyRequestedState: requestedSgState, SGReadyRecommendationValid: sgValid,
        SGReadyRecommendationReason: `${reason}; logischer SG-Ready-Zustand ${requestedSgState}, keine Register-/Kontakt-Ausgabe; kein automatischer Sperrzustand 1`,
        HeatingBoostRequested: valid && heatingRoom && !cooling.active && requestedSgState >= 3,
        CoolingBoostRequested: coolingAdvice.requested, CoolingBoostValid: coolingAdvice.valid,
        CoolingBoostReason: `${coolingAdvice.reason}; nur Empfehlung, keine externe Ausgabe`,
        CoolingRoomTarget_C: coolingAdvice.roomTarget, CoolingFlowTarget_C: coolingAdvice.flowTarget,
        OutputOwned: false, OutputActive: false})) write(`${base}.${key}`, value);
    return getHeatPumpAdvice();
}

function updateHeatPumpAdvice(now = Date.now(), availablePvW = null) {
    const r = CFG.root;
    const price = evaluateThermalPricePolicy(now);
    const telemetry = readHeatPumpTelemetry(now);
    const enabled = heatPumpConfig('HeatPumpAdviceEnabled', 'heatPumpAdviceEnabled', false) === true
        && nativeConfig.globalWriteEnabled === true
        && getState(`${r}.System.RealOutputsEnabled`)?.val === true
        && getState(`${r}.Devices.HeatPump.Present`)?.val === true
        && getState(`${r}.Devices.HeatPump.ControlEnabled`)?.val === true
        && getState(`${r}.Control.Enabled`)?.val === true;
    const cooling = heatPumpCoolingState(now);
    const room = heatPumpThermalRoom(now);
    const importedW = heatPumpFreshNumber(CFG.dp.gridImport, SMA_GRID_MAX_AGE_MS, now);
    const exportedW = heatPumpFreshNumber(CFG.dp.gridExport, SMA_GRID_MAX_AGE_MS, now);
    const systemUpdated = numericValue(getState(`${r}.System.LastUpdate`)?.val);
    const controlUpdated = numericValue(getState(`${r}.Control.LastUpdate`)?.val);
    const controlValid = getState(`${r}.Control.Valid`)?.val === true && controlUpdated > 0
        && controlUpdated <= now + 1000 && now - controlUpdated <= 30000;
    const inputsValid = getState(`${r}.System.DataValid`)?.val === true && systemUpdated > 0
        && systemUpdated <= now + 1000 && now - systemUpdated <= 30000
        && controlValid && importedW !== null && exportedW !== null && importedW >= 0 && exportedW >= 0
        && telemetry.power.valid && telemetry.connectionAllowed;
    const limit = typeof currentConsumptionLimit === 'function' ? currentConsumptionLimit()
        : {valid: true, active: getState(`${r}.Control.GridOperatorLimitActive`)?.val === true};
    const limitBlocked = limit.valid !== true || limit.active === true;
    if (!enabled || !inputsValid || !cooling.valid || limitBlocked) {
        clearHeatPumpLatches();
        clearHeatPumpCoolingBoost();
        return publishHeatPumpAdvice('NORMAL', !enabled ? 'WP-EMS-Empfehlung nicht freigegeben'
            : limitBlocked ? 'Netzbetreiber-Limit aktiv/ungueltig; separate ISG-4259-Begrenzung noch kein EMS-Ausgang'
                : !telemetry.power.valid ? telemetry.power.reason
                    : !telemetry.connectionAllowed ? telemetry.connectionReason
                        : !cooling.valid ? cooling.reason : 'WP-EMS-Eingangsdaten fehlen/ungueltig/veraltet', now,
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
    const maximumEnabled = heatPumpConfig('HeatPumpMaxBoostEnabled', 'heatPumpMaxBoostEnabled', false) === true;
    const maximumOnW = numericValue(heatPumpConfig('HeatPumpMaxBoostOn_W', 'heatPumpMaxBoostOnW', 5000));
    const maximumOffW = numericValue(heatPumpConfig('HeatPumpMaxBoostOff_W', 'heatPumpMaxBoostOffW', 4000));
    const thresholdsValid = onW !== null && offW !== null && holdS !== null
        && onW > 0 && offW >= 0 && offW < onW && holdS >= 0
        && (!maximumEnabled || maximumOnW !== null && maximumOffW !== null
            && maximumOnW > onW && maximumOffW >= offW && maximumOffW < maximumOnW);
    if (!thresholdsValid) {
        clearHeatPumpLatches();
        clearHeatPumpCoolingBoost();
        return publishHeatPumpAdvice('NORMAL', 'WP-Hysterese/Haltezeit ungueltig', now, {enabled, cooling});
    }
    const coolingAdvice = heatPumpCoolingAdvice(now, enabled, inputsValid, cooling, pvSurplusW, onW, offW, holdS);
    if (cooling.active) {
        clearHeatPumpLatches();
        return publishHeatPumpAdvice('NORMAL', 'Kuehlung bestaetigt: kein Heiz-SG-Boost; Kuehlempfehlung separat', now,
            {enabled, valid: false, sgValid: true, cooling, pvSurplusW, coolingAdvice});
    }
    const valid = room.valid;
    if (!valid) {
        clearHeatPumpLatches();
        return publishHeatPumpAdvice('NORMAL', room.reason, now, {enabled, cooling, pvSurplusW, coolingAdvice});
    }
    if (!room.heatingRoom && !room.dhwRoom) {
        clearHeatPumpLatches();
        return publishHeatPumpAdvice('REDUCED', room.reason, now,
            {enabled, valid, cooling, pvSurplusW, coolingAdvice});
    }
    if (pvSurplusW >= onW) heatPumpPvBoostLatched = true;
    else if (pvSurplusW < offW) heatPumpPvBoostLatched = false;
    if (!maximumEnabled) heatPumpMaxBoostLatched = false;
    else if (pvSurplusW >= maximumOnW) heatPumpMaxBoostLatched = true;
    else if (pvSurplusW < maximumOffW) heatPumpMaxBoostLatched = false;
    const priceBoost = price.cheapAllowed && cheapGridMaxW > 0;
    const lostPriceAuthorization = heatPumpPriceBoostLatched && !priceBoost && !heatPumpPvBoostLatched;
    const maximumWithdrawn = heatPumpAdviceMode === 'MAX' && !maximumEnabled;
    let mode = heatPumpMaxBoostLatched ? 'MAX' : heatPumpPvBoostLatched || priceBoost ? 'BOOST' : 'NORMAL';
    let reason = heatPumpMaxBoostLatched ? 'Explizit freigegebener maximaler PV-Boost bei gueltigem thermischen Spielraum'
        : priceBoost ? 'Gueltiger guenstiger Gesamtpreis und begrenzte Netzwaerme freigegeben'
        : heatPumpPvBoostLatched ? 'Gemessener PV-Ueberschuss fuer thermischen Vorrat'
            : 'Kein WP-Boostfenster; normale lokale Regelung';
    let holdRemainingS = 0;
    if (!lostPriceAuthorization && !maximumWithdrawn && mode !== heatPumpAdviceMode && heatPumpAdviceChangedAt > 0
        && now - heatPumpAdviceChangedAt < holdS * 1000) {
        holdRemainingS = Math.ceil((holdS * 1000 - (now - heatPumpAdviceChangedAt)) / 1000);
        mode = heatPumpAdviceMode;
        reason = `Langsame WP-Empfehlung stabil halten: noch ${holdRemainingS} s`;
    }
    if (lostPriceAuthorization) reason = 'Preis-/Netzwaermefreigabe entfallen; keine preisbedingte Boost-Verlaengerung';
    heatPumpPriceBoostLatched = mode === 'BOOST' && priceBoost && !heatPumpPvBoostLatched;
    return publishHeatPumpAdvice(mode, reason, now, {enabled, valid, heatingRoom: room.heatingRoom,
        dhwRoom: room.dhwRoom, cooling, pvSurplusW, holdRemainingS, coolingAdvice});
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
        sgReadyRequestedState: getState(`${base}.SGReadyRequestedState`)?.val ?? 2,
        sgReadyRecommendationValid: getState(`${base}.SGReadyRecommendationValid`)?.val === true,
        heatingBoostRequested: getState(`${base}.HeatingBoostRequested`)?.val === true,
        coolingBoostRequested: getState(`${base}.CoolingBoostRequested`)?.val === true,
        coolingBoostValid: getState(`${base}.CoolingBoostValid`)?.val === true,
        reason: getState(`${base}.AdviceReason`)?.val || ''};
}

function hasOwnedHeatPumpOutput() { return false; }

function stopHeatPumpOutput(reason = 'EMS wird beendet') {
    clearHeatPumpLatches();
    clearHeatPumpCoolingBoost();
    return publishHeatPumpAdvice('NORMAL', reason, Date.now());
}
