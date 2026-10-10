/* SunEnergy XT500 external power output.
 * EMS calculations and measured AC-port power: + charging, - discharging.
 * RequestedPower_W / GS: + discharging, - charging. No grid-meter emulation.
 * SunEnergy GP is AC export-positive and is inverted here. BP/DC battery
 * power is intentionally NOT interchangeable with GP (PV and losses differ).
 * A successful write is not a hardware watchdog: production remains an
 * explicitly armed, attended integration until the device supplies one.
 */
'use strict';

let batteryOwnershipInitialized = false;
let batteryOutputOwned = false;
let batteryOwnedSetpointId = '';
let batteryLastCommandW = 0;
let batteryLastCommandAt = 0;
let batteryWriteGeneration = 0;
let batteryPendingCommand = null;
let batteryStopPending = false;
let batteryOutputFault = '';
let batteryUnobservedCommandW = 0;
let batteryUnobservedCommandSince = 0;
let batteryReservedChargeW = 0;
let batteryTemperatureSelection = null;
let batteryTemperatureSelectionInitialized = false;
let batteryTemperatureLastEffectiveMinimum;
let batteryPlanningLastSignature;

function batteryTemperatureConfig() {
    const read = (name, nativeName, fallback) => {
        const state = getState(`${CFG.root}.Config.${name}`);
        if (state) return state.val;
        return typeof nativeConfig === 'object' && nativeConfig[nativeName] !== undefined
            ? nativeConfig[nativeName] : fallback;
    };
    return {
        batteryTemperatureMinSocEnabled: read('BatteryTemperatureMinSoCEnabled', 'batteryTemperatureMinSocEnabled', false),
        batteryTemperatureForecastId: read('BatteryTemperatureForecastId', 'batteryTemperatureForecastId', ''),
        batteryTemperatureLowerThresholdC: read('BatteryTemperatureLowerThreshold_C', 'batteryTemperatureLowerThresholdC', 0),
        batteryTemperatureUpperThresholdC: read('BatteryTemperatureUpperThreshold_C', 'batteryTemperatureUpperThresholdC', 5),
        batteryTemperatureColdMinSocPct: read('BatteryTemperatureColdMinSoC_pct', 'batteryTemperatureColdMinSocPct', 30),
        batteryTemperatureCoolMinSocPct: read('BatteryTemperatureCoolMinSoC_pct', 'batteryTemperatureCoolMinSocPct', 20),
        batteryTemperatureWarmMinSocPct: read('BatteryTemperatureWarmMinSoC_pct', 'batteryTemperatureWarmMinSocPct', 10),
        batteryTemperatureForecastMaxAgeH: read('BatteryTemperatureForecastMaxAge_h', 'batteryTemperatureForecastMaxAgeH', 24),
        batteryMinSocPct: read('BatteryMinSoC_pct', 'batteryMinSocPct', 15),
        batteryMaxSocPct: read('BatteryMaxSoC_pct', 'batteryMaxSocPct', 100)
    };
}

function batteryEffectiveMinimumSoc(now = Date.now()) {
    const config = batteryTemperatureConfig();
    // Isolated legacy test contexts may not import the optional helper. An
    // enabled feature may never silently bypass its checked reserve contract.
    if (typeof batteryTemperatureReserve === 'undefined')
        return config.batteryTemperatureMinSocEnabled === true ? null : batteryNumber(config.batteryMinSocPct);
    const base = `${CFG.root}.Devices.Battery`;
    if (!batteryTemperatureSelectionInitialized) {
        batteryTemperatureSelectionInitialized = true;
        const persisted = getState(`${base}.TemperatureReserveSelection_JSON`);
        if (persisted && persisted.ack === true
            && (persisted.q === undefined || batteryNumber(persisted.q) === 0)
            && batteryNumber(persisted.ts) > 0 && persisted.ts <= now) {
            try { batteryTemperatureSelection = JSON.parse(persisted.val); } catch { /* No reconstructed success. */ }
        }
    }
    const sourceId = typeof config.batteryTemperatureForecastId === 'string'
        ? config.batteryTemperatureForecastId.trim() : '';
    const result = batteryTemperatureReserve.evaluate({now, config,
        source: sourceId ? getState(sourceId) : null, previous: batteryTemperatureSelection});
    // Disabling clears the retained claim. Re-enabling starts a fresh checked
    // selection, while an unknown source during normal operation holds proof.
    batteryTemperatureSelection = result.enabled ? result.selection : null;
    const labels = {
        'disabled-static-minimum': 'Aus: fester Mindest-SoC',
        'invalid-temperature-reserve-settings': 'Gesperrt: Temperaturreserve-Einstellungen oder SoC-Grenzen ungueltig',
        'daily-selection-retained': 'Gueltige Tagesauswahl bis zum naechsten 20-Uhr-Slot (Europe/Berlin)',
        'source-unknown-held-selection': 'Prognose unbekannt/ungueltig/veraltet: letzte gueltige Temperaturreserve gehalten',
        'source-unknown-static-fallback': 'Prognose unbekannt/ungueltig/veraltet: fester Mindest-SoC als Fallback; keine Temperaturauswahl belegt',
        'temperature-selection-applied': 'Temperaturreserve aus gueltiger Prognose angewendet'
    };
    write(`${base}.EffectiveMinimumSoC_pct`, result.effectiveMinSoc);
    write(`${base}.TemperatureReserveStatus`, labels[result.reason] || result.reason);
    write(`${base}.TemperatureReserveValid`, result.valid);
    write(`${base}.TemperatureReserveHeld`, result.held);
    write(`${base}.TemperatureForecast_C`, result.temperatureC);
    write(`${base}.TemperatureForecastAge_h`, result.sourceAgeMs === null ? null
        : Math.round(result.sourceAgeMs / 3600) / 1000);
    write(`${base}.TemperatureReserveLastSelectionAt`, result.selection?.selectedAt || 0);
    write(`${base}.TemperatureReservePeriod`, result.selection?.periodKey || '');
    write(`${base}.TemperatureReserveSelection_JSON`, JSON.stringify(batteryTemperatureSelection || {}));
    if (batteryTemperatureLastEffectiveMinimum !== undefined
        && batteryTemperatureLastEffectiveMinimum !== result.effectiveMinSoc
        && typeof getActualState !== 'function' // Shadow context must never schedule a live forecast.
        && typeof requestForecastRebuild === 'function' && typeof setTimeout === 'function')
        requestForecastRebuild();
    batteryTemperatureLastEffectiveMinimum = result.effectiveMinSoc;
    return result.effectiveMinSoc;
}

function createBatteryStates() {
    const r = CFG.root;
    const base = `${r}.Devices.Battery`;
    const settings = [
        ['BatteryFineStep_W', 100, 'W', 'Speicher: maximale Erhoehung je Feinschritt'],
        ['BatteryDeadband_W', 50, 'W', 'Speicher: Totband des Feinreglers'],
        ['BatteryCycle_s', 1, 's', 'Speicher: Abstand der Feinschritte und bestaetigten Sollwertauffrischung'],
        ['BatteryFeedbackTimeout_s', 15, 's', 'Speicher: Frist fuer echte Leistungsrueckmeldung'],
        ['BatteryMeasurementMaxAge_s', 30, 's', 'Speicher: maximale Messwert-/Heartbeat-Alterung'],
        ['BatterySoCMaxAge_s', 300, 's', 'Speicher: maximales Alter des SoC'],
        ['BatteryTemperatureMax_C', 50, '°C', 'Speicher: Abschaltgrenze optionaler Temperaturquelle']
    ];
    settings.forEach(([name, value, unit, label]) =>
        configDef(`${r}.Config.${name}`, value, 'number', 'value', unit, label));
    const definitions = [
        ['DriverReady', false, 'boolean', 'indicator', '', 'Ausgang und externer Treibermodus geprueft'],
        ['DriverStatus', 'Nicht geprueft', 'string', 'text', '', 'Validierung des Speicher-Treibers'],
        ['SingleHeadVerified', false, 'boolean', 'indicator', '', 'Genau ein konfigurierter SunEnergy-Kopf fuer total-Messwerte geprueft'],
        ['RegulationAvailable', false, 'boolean', 'indicator', '', 'Speicher kann aktiv fein regeln'],
        ['CanCharge', false, 'boolean', 'indicator', '', 'Speicherladung derzeit zulaessig'],
        ['CanDischarge', false, 'boolean', 'indicator', '', 'Speicherentladung derzeit zulaessig'],
        ['RequestedPower_W', 0, 'number', 'value.power', 'W', 'SunEnergy-Anforderung: positiv Entladen, negativ Laden'],
        ['OutputCommand_W', 0, 'number', 'value.power', 'W', 'Letzter GS-Befehl: positiv Entladen, negativ Laden'],
        ['OutputCommandInternal_W', 0, 'number', 'value.power', 'W', 'Interner Befehl: positiv Laden, negativ Entladen'],
        ['OutputReservedCharge_W', 0, 'number', 'value.power', 'W', 'Reservierte Ladeleistung einschliesslich noch nicht beobachteter hoeherer Befehle'],
        ['OutputUnobservedCommand_W', 0, 'number', 'value.power', 'W', 'Noch nicht physisch beobachteter Befehl: positiv Laden, negativ Entladen'],
        ['OutputUnobservedCommandSince', 0, 'number', 'value.time', '', 'Zeitpunkt des noch nicht physisch beobachteten Befehls'],
        ['ActualPower_W', 0, 'number', 'value.power', 'W', 'Echte AC-Netzportleistung GP: positiv Laden, negativ Entladen'],
        ['OutputOwned', false, 'boolean', 'indicator', '', 'EMS traegt Verantwortung bis zum erfolgreichen Nullbefehl'],
        ['OutputActive', false, 'boolean', 'indicator', '', 'Nichtnull-Befehl vom EMS angefordert'],
        ['OutputSetpointId', '', 'string', 'text', '', 'Datenpunkt des tatsaechlich uebernommenen Ausgangs'],
        ['OutputLastWrite', 0, 'number', 'value.time', '', 'Letzter gesendeter Speicherbefehl'],
        ['OutputStatus', 'Gesperrt', 'string', 'text', '', 'Begruendung des Speicherausgangs'],
        ['Fault', '', 'string', 'text', '', 'Verriegelter Speicherfehler: Freigabe aus oder ResetFault zum Quittieren'],
        ['ActuatorSettled', false, 'boolean', 'indicator', '', 'Echte Leistung folgt dem letzten Befehl'],
        ['ActuatorDifference_W', 0, 'number', 'value.power', 'W', 'Istleistung minus interner Befehl'],
        ['CommandAge_s', 0, 'number', 'value.interval', 's', 'Alter des letzten Befehls'],
        ['EffectiveStep_W', 0, 'number', 'value.power', 'W', 'Aktuelle Speicher-Schrittweite']
    ];
    definitions.forEach(([name, value, type, role, unit, label]) =>
        stateDef(`${base}.${name}`, value, type, role, unit, label));
    const temperatureDiagnostics = [
        ['EffectiveMinimumSoC_pct', null, 'number', 'value', '%', 'Wirksamer operativer Mindest-SoC; null bei ungueltigen Grenzen'],
        ['TemperatureReserveStatus', 'Noch nicht geprueft', 'string', 'text', '', 'Auswahl/Halten/Fallback der Temperaturreserve'],
        ['TemperatureReserveValid', false, 'boolean', 'indicator', '', 'Gueltige Temperaturauswahl belegt; AUS/Fallback ist kein Temperaturnachweis'],
        ['TemperatureReserveHeld', false, 'boolean', 'indicator', '', 'Letzte gueltige Auswahl trotz unbekannter Prognose gehalten'],
        ['TemperatureForecast_C', null, 'number', 'value.temperature', '°C', 'Originaltemperatur der aktuell gelesenen Prognose; null bei unbekanntem Wert'],
        ['TemperatureForecastAge_h', null, 'number', 'value.interval', 'h', 'Alter des originalen Prognosezeitstempels'],
        ['TemperatureReserveLastSelectionAt', 0, 'number', 'value.time', '', 'Tatsaechlicher Zeitpunkt der letzten gueltigen Auswahl'],
        ['TemperatureReservePeriod', '', 'string', 'text', '', 'Berlin-Datum des letzten 20-Uhr-Slots der Auswahl'],
        ['TemperatureReserveSelection_JSON', '{}', 'string', 'json', '', 'Validierbarer Originalnachweis fuer Neustart und Tagesauswahl']
    ];
    temperatureDiagnostics.forEach(([name, value, type, role, unit, label]) =>
        stateDef(`${base}.${name}`, value, type, role, unit, label));
    createBatteryHeadsStates(base);
    configDef(`${base}.ResetFault`, false, 'boolean', 'button', '',
        'Speicherfehler nach erfolgreichem Nullbefehl quittieren');
    configDef(`${base}.ConfirmPhysicalStop`, false, 'boolean', 'button', '',
        'NUR bei globaler Freigabe AUS: unabhaengig bestaetigter Geraetestopp UND alter Stellauftrag sicher ausgeschlossen; keine automatische Softwarebestaetigung');
}

function batteryNumber(value) {
    if (!['number', 'string'].includes(typeof value)
        || (typeof value === 'string' && !value.trim())) return null;
    const result = Number(value);
    return Number.isFinite(result) ? result : null;
}

function batteryInput(id, maximumAgeMs = null) {
    if (!id || !existsState(id)) return null;
    const state = getState(id);
    if (!state || state.val === null || state.val === undefined || state.ack !== true
        || (state.q !== undefined && Number(state.q) !== 0)) return null;
    const timestamp = batteryNumber(state.ts);
    if (timestamp === null || timestamp <= 0 || timestamp > Date.now() + 1000) return null;
    if (maximumAgeMs !== null && Date.now() - timestamp > maximumAgeMs) return null;
    return state;
}

function batteryBoolean(id) {
    const state = batteryInput(id);
    if (!state) return null;
    if ([true, 1, '1'].includes(state.val)) return true;
    if ([false, 0, '0'].includes(state.val)) return false;
    return null;
}

function batterySetting(name, fallback) {
    const state = getState(`${CFG.root}.Config.${name}`);
    return state ? batteryNumber(state.val) : fallback;
}

function batteryTimingSettings() {
    const measurementAgeS = batterySetting('BatteryMeasurementMaxAge_s', 30);
    const socAgeS = batterySetting('BatterySoCMaxAge_s', 300);
    const cycleS = batterySetting('BatteryCycle_s', 1);
    const feedbackS = batterySetting('BatteryFeedbackTimeout_s', 15);
    const stepW = batterySetting('BatteryFineStep_W', 100);
    const deadbandW = batterySetting('BatteryDeadband_W', 50);
    const valid = measurementAgeS !== null && measurementAgeS >= 1 && measurementAgeS <= 300
        && socAgeS !== null && socAgeS >= 1 && socAgeS <= 3600
        && cycleS !== null && cycleS >= 1 && cycleS <= 60
        && feedbackS !== null && feedbackS >= cycleS && feedbackS <= 300
        && stepW !== null && stepW >= 1 && stepW <= 1000
        && deadbandW !== null && deadbandW >= 0 && deadbandW <= 1000;
    return {valid, measurementAgeMs: measurementAgeS * 1000, socAgeMs: socAgeS * 1000,
        cycleMs: cycleS * 1000, feedbackTimeoutMs: feedbackS * 1000,
        stepW, deadbandW, toleranceW: Math.max(1, Math.min(25, stepW / 4))};
}

function batteryMeasuredPowerW() {
    if (batteryHeadsMode()) return batteryHeadsSnapshot().actualW;
    const settings = batteryTimingSettings();
    if (!settings.valid) return null;
    const id = batteryAcMeasurementId();
    const selected = String(nativeConfig.batterySetpointId || '')
        .match(/^(sunenergyxt500\.\d+)\.(heads\.\d+)\.control\.GS$/);
    if (!selected || ![`${selected[1]}.${selected[2]}.grid.GP`, `${selected[1]}.total.gridPower`].includes(id))
        return null;
    const state = batteryCoherentMeasurement(id, settings.measurementAgeMs);
    const powerW = state ? batteryNumber(state.val) : null;
    return powerW === null ? null : powerW === 0 ? 0 : -powerW;
}

function batteryAcMeasurementId() {
    return String(CFG.dp.batteryAcPower || nativeConfig.batteryAcPowerId || '').trim();
}

function batteryCoherentSources(id) {
    // SunEnergy publishes unchanged readings with setStateChanged. Its fresh
    // completed-poll heartbeat can therefore validate unchanged measurements,
    // but only inside the same identified driver instance, never an alias or
    // unrelated adapter whose stale data the heartbeat cannot vouch for.
    const match = String(nativeConfig.batterySetpointId || '')
        .match(/^(sunenergyxt500\.\d+)\.(heads\.\d+)\.control\.GS$/);
    if (!match) return false;
    const head = `${match[1]}.${match[2]}.`;
    const ownHead = source => typeof source === 'string' && source.startsWith(head);
    const correctTelemetry = ownHead(id)
        || typeof id === 'string' && id.startsWith(`${match[1]}.total.`)
            && getState(`${CFG.root}.Devices.Battery.SingleHeadVerified`)?.val === true;
    return correctTelemetry && nativeConfig.batteryHeartbeatId === `${match[1]}.info.lastUpdate`
        && [nativeConfig.batteryOnlineId, nativeConfig.batteryManualModeId,
            nativeConfig.batteryLocalModeId].every(ownHead);
}

function batteryCoherentMeasurement(id, maximumAgeMs) {
    if (batteryCoherentSources(id) && batteryHeartbeatFresh(batteryTimingSettings().measurementAgeMs))
        return batteryInput(id);
    return batteryInput(id, maximumAgeMs);
}

function batteryHeartbeatFresh(maximumAgeMs) {
    const state = batteryInput(nativeConfig.batteryHeartbeatId);
    if (!state) return false;
    const numeric = batteryNumber(state.val);
    const timestamp = numeric === null && typeof state.val === 'string'
        ? Date.parse(state.val) : numeric;
    return Number.isFinite(timestamp) && timestamp > 0
        && timestamp <= Date.now() + 1000 && Date.now() - timestamp <= maximumAgeMs;
}

function initializeBatteryOwnership() {
    initializeBatteryHeadsOwnership();
    if (batteryHeadOwners.some(head => head.owned)) return;
    if (batteryOwnershipInitialized) return;
    batteryOwnershipInitialized = true;
    const base = `${CFG.root}.Devices.Battery`;
    const persistedReserve = batteryNumber(getState(`${base}.OutputReservedCharge_W`)?.val) ?? 0;
    const persistedUnobserved = batteryNumber(getState(`${base}.OutputUnobservedCommand_W`)?.val) ?? 0;
    if (getState(`${base}.OutputOwned`)?.val !== true && persistedReserve <= 0 && persistedUnobserved === 0) return;
    batteryOutputOwned = true;
    batteryOwnedSetpointId = String(getState(`${base}.OutputSetpointId`)?.val || '').trim();
    batteryLastCommandW = batteryNumber(getState(`${base}.OutputCommandInternal_W`)?.val) ?? 0;
    batteryLastCommandAt = batteryNumber(getState(`${base}.OutputLastWrite`)?.val) ?? 0;
    batteryReservedChargeW = Math.max(0, batteryNumber(getState(`${base}.OutputReservedCharge_W`)?.val) ?? 0);
    batteryUnobservedCommandW = batteryNumber(getState(`${base}.OutputUnobservedCommand_W`)?.val) ?? 0;
    batteryUnobservedCommandSince = batteryNumber(getState(`${base}.OutputUnobservedCommandSince`)?.val)
        ?? batteryLastCommandAt;
    if (batteryUnobservedCommandW === 0 && batteryReservedChargeW > 0)
        batteryUnobservedCommandW = batteryReservedChargeW;
    // Upgrade/crash without a durable observation marker cannot prove that an
    // earlier nonzero request already took effect or was discarded.
    if (batteryUnobservedCommandW === 0 && batteryLastCommandW !== 0)
        batteryUnobservedCommandW = batteryLastCommandW;
    batteryReservedChargeW = Math.max(batteryReservedChargeW, batteryUnobservedCommandW, 0);
    // Unlike the wallbox, GS has no restart handoff or device watchdog. A
    // previous owner must be driven to zero before this process can re-arm.
    batteryOutputFault = 'Vorherige Speicher-Ausgangsverantwortung: zuerst sicherer Nullbefehl';
}

function hasOwnedBatteryOutput() {
    initializeBatteryOwnership();
    return batteryOutputOwned || batteryStopPending || batteryHeadOwners.some(head => head.owned);
}

function batteryRegulationState() {
    if (batteryHeadsMode()) return batteryHeadsRegulationState();
    initializeBatteryOwnership();
    const r = CFG.root;
    const settings = batteryTimingSettings();
    const result = {configured: Boolean(nativeConfig.batterySetpointId), available: false,
        eligible: false, active: hasOwnedBatteryOutput(), reason: '', actualW: null,
        soc: null, minSoc: batteryEffectiveMinimumSoc(),
        maxSoc: batterySetting('BatteryMaxSoC_pct', 100),
        maxChargeW: batterySetting('BatteryMaxCharge_W', 2400),
        maxDischargeW: batterySetting('BatteryMaxDischarge_W', 2400),
        canCharge: false, canDischarge: false, ...settings};
    const blocked = reason => ({...result, reason});
    if (batteryHeadOwners.some(head => head.owned) || batteryHeadsOwnershipFault)
        return blocked('Fruehere Mehrkopf-Ausgaenge zuerst bestaetigt zurueckgeben');
    if (nativeConfig.globalWriteEnabled !== true
        || getState(`${r}.System.RealOutputsEnabled`)?.val !== true)
        return blocked('globale Schreibfreigabe aus');
    if (nativeConfig.batteryPresent !== true
        || getState(`${r}.Devices.Battery.Present`)?.val !== true)
        return blocked('Speicher nicht vorhanden');
    if (nativeConfig.batteryControlEnabled !== true
        || getState(`${r}.Devices.Battery.ControlEnabled`)?.val !== true)
        return blocked('Speicher-Steuerfreigabe aus');
    if (nativeConfig.batteryProductionArmed !== true)
        return blocked('Speicher-Produktionstest nicht bestaetigt');
    if (!result.configured) return blocked('kein Speicher-Sollwertdatenpunkt konfiguriert');
    if (getState(`${r}.Devices.Battery.DriverReady`)?.val !== true)
        return blocked('Speichertreiber/Ausgang nicht fuer externe Sollwerte freigegeben');
    if (!batteryCoherentSources(CFG.dp.batterySoc) || !batteryCoherentSources(batteryAcMeasurementId()))
        return blocked('Speichermessung/MM/LM/Online passen nicht zum GS-Kopf; total.* erfordert genau einen geprueften Kopf');
    if (batteryOutputFault) return blocked(batteryOutputFault);
    if (batteryStopPending) return blocked('vorheriger Nullbefehl noch offen');
    if (!settings.valid) return blocked('Speicher-Regelparameter ungueltig');
    if (!batteryHeartbeatFresh(settings.measurementAgeMs))
        return blocked('Speicher-Heartbeat fehlt oder ist veraltet');
    if (batteryBoolean(nativeConfig.batteryOnlineId) !== true)
        return blocked('Speicher nicht bestaetigt online');
    if (batteryBoolean(nativeConfig.batteryManualModeId) !== false
        || batteryBoolean(nativeConfig.batteryLocalModeId) !== true)
        return blocked('Speicher muss MM=false und LM=true bestaetigen (externe GS-Steuerung)');
    if (nativeConfig.batteryFaultId && batteryBoolean(nativeConfig.batteryFaultId) !== false)
        return blocked('Speicherstoerung oder ungueltige Stoerungsrueckmeldung');
    if (nativeConfig.batteryTemperatureId) {
        const state = batteryInput(nativeConfig.batteryTemperatureId, settings.measurementAgeMs);
        const temperature = state ? batteryNumber(state.val) : null;
        const limit = batterySetting('BatteryTemperatureMax_C', 50);
        if (temperature === null || temperature < -50 || temperature > 120
            || limit === null || limit < 0 || limit > 100 || temperature >= limit)
            return blocked('Speichertemperatur ungueltig oder Abschaltgrenze erreicht');
    }
    const socState = batteryCoherentMeasurement(CFG.dp.batterySoc, settings.socAgeMs);
    result.soc = socState ? batteryNumber(socState.val) : null;
    result.actualW = batteryMeasuredPowerW();
    if (result.soc === null || result.soc < 0 || result.soc > 100)
        return blocked('Speicher-SoC fehlt, ist veraltet oder ungueltig');
    if (result.actualW === null) return blocked('echte AC-Netzportleistung GP fehlt oder ist ungueltig; DC-BP ist keine GS-Rueckmeldung');
    if (!hasOwnedBatteryOutput() && Math.abs(result.actualW) > settings.toleranceW)
        return blocked('Warte auf echte Nullleistung vor Uebernahme/Richtungswechsel');
    if (result.minSoc === null || result.minSoc < 0 || result.minSoc >= 100
        || result.maxSoc === null || result.maxSoc <= result.minSoc || result.maxSoc > 100
        || result.maxChargeW === null || result.maxChargeW < 0 || result.maxChargeW > 100000
        || result.maxDischargeW === null || result.maxDischargeW < 0 || result.maxDischargeW > 100000)
        return blocked('Speicher-Leistungs- oder SoC-Grenzen ungueltig');
    result.canCharge = result.soc < result.maxSoc && result.maxChargeW > 0;
    result.canDischarge = result.minSoc > 0 && result.soc > result.minSoc
        && (typeof batteryPriceDischargeFloor !== 'function' || result.soc > batteryPriceDischargeFloor())
        && result.maxDischargeW > 0
        && getState(`${r}.Config.BatterySelfConsumptionEnabled`)?.val === true;
    result.available = result.canCharge || result.canDischarge;
    result.eligible = true;
    result.reason = result.minSoc <= 0
        ? 'Laden moeglich; Entladen gesperrt: positive Mindest-SoC-Reserve erforderlich'
        : result.available ? 'Speicher fuer feine Restleistungsregelung bereit' : 'SoC-/Leistungsgrenzen erreicht';
    return result;
}

function publishBatteryStatus(status) {
    const base = `${CFG.root}.Devices.Battery`;
    write(`${base}.OutputOwned`, hasOwnedBatteryOutput());
    write(`${base}.OutputActive`, batteryOutputOwned && !batteryStopPending
        && !batteryOutputFault && batteryLastCommandW !== 0);
    write(`${base}.OutputStatus`, status);
    write(`${base}.Fault`, batteryOutputFault);
    write(`${base}.OutputReservedCharge_W`, batteryReservedChargeW);
    write(`${base}.OutputUnobservedCommand_W`, batteryUnobservedCommandW);
    write(`${base}.OutputUnobservedCommandSince`, batteryUnobservedCommandSince);
    write(`${base}.CommandAge_s`, batteryLastCommandAt ? Math.max(0, (Date.now() - batteryLastCommandAt) / 1000) : 0);
    const otherOwned = ['MyPV_DHW', 'MyPV_Heating', 'Wallbox0', 'Wallbox1', 'Wallbox2']
        .some(device => getState(`${CFG.root}.Devices.${device}.OutputOwned`)?.val === true);
    write(`${CFG.root}.System.NoActuation`, !hasOwnedBatteryOutput() && !otherOwned);
    if (hasOwnedBatteryOutput() || getState(`${CFG.root}.Devices.MyPV_Heating.OutputOwned`)?.val === true)
        write(`${CFG.root}.Control.Mode`, 'ALPHA_ENERGY_COORDINATED');
}

function observeBatteryOutstandingCommand() {
    if (batteryUnobservedCommandW === 0) return true;
    const settings = batteryTimingSettings();
    const heartbeat = getState(nativeConfig.batteryHeartbeatId)?.val;
    const heartbeatAt = batteryNumber(heartbeat) ?? (typeof heartbeat === 'string' ? Date.parse(heartbeat) : NaN);
    const actualW = batteryMeasuredPowerW();
    const thresholdW = Math.max(1, Math.abs(batteryUnobservedCommandW) - settings.toleranceW);
    const reached = actualW !== null && Math.sign(actualW) === Math.sign(batteryUnobservedCommandW)
        && Math.abs(actualW) >= thresholdW;
    if (settings.valid && batteryCoherentSources(batteryAcMeasurementId())
        && batteryBoolean(nativeConfig.batteryOnlineId) === true
        && batteryHeartbeatFresh(settings.measurementAgeMs)
        && Number.isFinite(heartbeatAt) && heartbeatAt > batteryUnobservedCommandSince && reached) {
        batteryUnobservedCommandW = 0;
        batteryUnobservedCommandSince = 0;
        // Seeing a rise does not make a commanded reduction instantaneous.
        // Keep its high-water reserve until the latest lower command itself
        // settles (or the later zero is confirmed), including response ramps.
        publishBatteryStatus('Zuvor ausstehender Speicherbefehl physisch beobachtet');
        return true;
    }
    return false;
}

function confirmBatteryZero() {
    if (!batteryStopPending || !batteryPendingCommand
        || batteryPendingCommand.commandW !== 0 || !batteryPendingCommand.transportComplete) return false;
    if (batteryOwnedSetpointId !== String(nativeConfig.batterySetpointId || '').trim()) {
        batteryOutputFault = 'Frueherer Speicher-Ausgang genullt, aber geaenderte Messzuordnung beweist dessen Stillstand nicht; manuell pruefen';
        return false;
    }
    observeBatteryOutstandingCommand();
    if (batteryUnobservedCommandW !== 0) {
        publishBatteryStatus(`Frueherer Speicherbefehl ${batteryUnobservedCommandW} W noch nicht physisch beobachtet; Nullmessung beweist keinen verworfenen Stellauftrag; Reserve bleibt bestehen`);
        return false;
    }
    const settings = batteryTimingSettings();
    const heartbeat = getState(nativeConfig.batteryHeartbeatId)?.val;
    const heartbeatAt = batteryNumber(heartbeat) ?? (typeof heartbeat === 'string' ? Date.parse(heartbeat) : NaN);
    const actualW = batteryMeasuredPowerW();
    if (settings.valid && batteryCoherentSources(batteryAcMeasurementId())
        && batteryBoolean(nativeConfig.batteryOnlineId) === true
        && batteryHeartbeatFresh(settings.measurementAgeMs)
        && Number.isFinite(heartbeatAt) && heartbeatAt > batteryPendingCommand.at
        && actualW !== null && Math.abs(actualW) <= settings.toleranceW) {
        batteryOutputOwned = false;
        batteryStopPending = false;
        batteryPendingCommand = null;
        batteryOwnedSetpointId = '';
        batteryReservedChargeW = 0;
        publishBatteryStatus('Nullbefehl und anschliessende echte Nullleistung bestaetigt');
        return true;
    }
    if (settings.valid && Date.now() - batteryPendingCommand.at >= settings.feedbackTimeoutMs)
        batteryOutputFault = 'Speicher-Nullleistung nicht bestaetigt; Ausgangsverantwortung bleibt, Anlage manuell pruefen';
    return false;
}

function confirmBatteryPhysicalStop() {
    const base = `${CFG.root}.Devices.Battery`;
    const confirmation = getState(`${base}.ConfirmPhysicalStop`);
    if (confirmation?.val !== true) return false;
    write(`${base}.ConfirmPhysicalStop`, false);
    if (confirmation.ack !== false) return false;
    const settings = batteryTimingSettings();
    const heartbeat = getState(nativeConfig.batteryHeartbeatId)?.val;
    const heartbeatAt = batteryNumber(heartbeat) ?? (typeof heartbeat === 'string' ? Date.parse(heartbeat) : NaN);
    const actualW = batteryMeasuredPowerW();
    const allowed = nativeConfig.globalWriteEnabled === false
        && getState(`${CFG.root}.System.RealOutputsEnabled`)?.val === false
        && batteryStopPending && batteryPendingCommand?.commandW === 0
        && batteryPendingCommand.transportComplete === true
        && Number(confirmation.ts) > batteryPendingCommand.at
        && Number(confirmation.ts) <= Date.now() + 1000
        && batteryOwnedSetpointId === String(nativeConfig.batterySetpointId || '').trim()
        && settings.valid && batteryCoherentSources(batteryAcMeasurementId())
        && batteryBoolean(nativeConfig.batteryOnlineId) === true
        && batteryHeartbeatFresh(settings.measurementAgeMs)
        && Number.isFinite(heartbeatAt) && heartbeatAt > batteryPendingCommand.at
        && actualW !== null && Math.abs(actualW) <= settings.toleranceW;
    if (!allowed) {
        publishBatteryStatus('Manuelle Stoppbestaetigung abgelehnt: beide globalen Freigaben muessen AUS sein, Nullschreiben beendet und zugeordnete frische Nullleistung online bestaetigt');
        return false;
    }
    // This is an explicit operator statement based on independent evidence,
    // not a conclusion derived from a timeout or one zero sample. Invalidate
    // all old callbacks before clearing its durable outstanding reservation.
    ++batteryWriteGeneration;
    batteryUnobservedCommandW = 0;
    batteryUnobservedCommandSince = 0;
    batteryReservedChargeW = 0;
    batteryOutputOwned = false;
    batteryStopPending = false;
    batteryPendingCommand = null;
    batteryOwnedSetpointId = '';
    batteryOutputFault = '';
    write(`${base}.RequestedPower_W`, 0);
    publishBatteryStatus('Benutzer hat unabhaengig Geraetestopp und Ausschluss alter Stellauftraege bestaetigt; keine automatische Softwaregarantie');
    return true;
}

function sendBatteryCommand(commandW, reason) {
    const base = `${CFG.root}.Devices.Battery`;
    const setpointId = batteryOwnedSetpointId || String(nativeConfig.batterySetpointId || '').trim();
    if (!setpointId) {
        batteryOutputFault = 'Kein verifizierbarer Speicher-Ausgang fuer Nullbefehl';
        write(`${base}.RequestedPower_W`, 0);
        publishBatteryStatus(batteryOutputFault);
        return false;
    }
    const generation = ++batteryWriteGeneration;
    batteryOutputOwned = true;
    batteryOwnedSetpointId = setpointId;
    batteryStopPending = commandW === 0;
    batteryLastCommandW = commandW;
    batteryLastCommandAt = Date.now();
    if (commandW !== 0 && Math.abs(commandW) >= Math.abs(batteryUnobservedCommandW)) {
        batteryUnobservedCommandW = commandW;
        batteryUnobservedCommandSince = batteryLastCommandAt;
    }
    batteryReservedChargeW = Math.max(batteryReservedChargeW, commandW, 0);
    batteryPendingCommand = {generation, commandW, at: batteryLastCommandAt, transportComplete: false};
    write(`${base}.OutputSetpointId`, setpointId);
    write(`${base}.RequestedPower_W`, commandW === 0 ? 0 : -commandW);
    write(`${base}.OutputCommand_W`, commandW === 0 ? 0 : -commandW);
    write(`${base}.OutputCommandInternal_W`, commandW);
    write(`${base}.OutputLastWrite`, batteryLastCommandAt);
    publishBatteryStatus(reason);
    const completed = error => {
        if (generation !== batteryWriteGeneration) return;
        if (error) {
            batteryOutputFault = `Speicher-Ausgangsschreibfehler: ${String(error.message || error)}`;
            batteryPendingCommand = null;
            batteryStopPending = false;
            batteryOutputOwned = true;
            write(`${base}.RequestedPower_W`, 0);
            publishBatteryStatus(`${batteryOutputFault}; Nullbefehl erforderlich`);
        } else if (commandW === 0 && batteryPendingCommand) {
            batteryPendingCommand.transportComplete = true;
            // DB acceptance alone does not prove that the inverter stopped.
            // Keep this ownership persisted across unload/crash until a later
            // successful poll confirms the measured physical zero.
            if (!confirmBatteryZero()) publishBatteryStatus(`Nullbefehl geschrieben; warte auf echte Nullleistung: ${reason}`);
        } else if (batteryPendingCommand) {
            batteryPendingCommand.transportComplete = true;
        }
    };
    let accepted;
    try {
        accepted = writeForeignState(setpointId, commandW === 0 ? 0 : -commandW, completed);
    } catch (error) {
        completed(error);
        return false;
    }
    if (!accepted) {
        batteryOutputFault = 'Speicher-Ausgang vom Schreibschutz blockiert';
        batteryPendingCommand = null;
        batteryStopPending = false;
        write(`${base}.RequestedPower_W`, 0);
        publishBatteryStatus(`${batteryOutputFault}; Ausgangsverantwortung bleibt bestehen`);
    }
    return accepted;
}

function stopBatteryOutput(reason = 'Adapter wird beendet') {
    initializeBatteryHeadsOwnership();
    if (batteryHeadsMode() || batteryHeadOwners.some(head => head.owned)) return stopBatteryHeadsOutput(reason);
    return stopBatteryLegacyOutput(reason);
}

function stopBatteryLegacyOutput(reason) {
    initializeBatteryOwnership();
    confirmBatteryZero();
    const base = `${CFG.root}.Devices.Battery`;
    write(`${base}.RequestedPower_W`, 0);
    write(`${base}.RegulationAvailable`, false);
    write(`${base}.CanCharge`, false);
    write(`${base}.CanDischarge`, false);
    if (batteryStopPending) return publishBatteryStatus(batteryUnobservedCommandW !== 0
        ? `Nullbefehl noch offen: frueherer Befehl ${batteryUnobservedCommandW} W noch nicht physisch beobachtet; Reserve bleibt bestehen`
        : `Nullbefehl noch offen: ${reason}`);
    if (hasOwnedBatteryOutput()) return sendBatteryCommand(0, reason);
    publishBatteryStatus(`Gesperrt: ${reason}`);
}

function batteryHouseConnectionCapW(actualW) {
    const imports = CFG.dp.haPhaseImportW || [];
    const exports = CFG.dp.haPhaseExportW || [];
    const currents = CFG.dp.myPvDhwHaCurrentA || [];
    const directional = [...imports, ...exports].some(Boolean);
    if (directional && (imports.length !== 3 || exports.length !== 3
        || [...imports, ...exports].some(id => !id))) return null;
    if (!directional && (currents.length !== 3 || currents.some(id => !id))) return null;
    const maximumA = batterySetting('HouseConnectionWorkingLimit_A', 46);
    const reservations = typeof coordinatedPhaseReservations === 'function'
        ? coordinatedPhaseReservations('Battery') : null;
    if (maximumA === null || maximumA <= 0 || maximumA > 1000 || !reservations?.valid
        || !Array.isArray(reservations.otherW) || reservations.otherW.length !== 3) return null;
    const measuredNumber = id => {
        // The shared SMA phase measurements have their own source contract;
        // SunEnergy's device/heartbeat age setting must not widen this gate.
        const state = batteryInput(id, SMA_GRID_MAX_AGE_MS);
        return state ? batteryNumber(state.val) : null;
    };
    const headroom = [0, 1, 2].map(p => {
        let measuredA;
        if (directional) {
            const importW = measuredNumber(imports[p]);
            const exportW = measuredNumber(exports[p]);
            if (importW === null || importW < 0 || exportW === null || exportW < 0) return null;
            measuredA = (importW - exportW) / 230;
        } else measuredA = measuredNumber(currents[p]);
        const pendingW = batteryNumber(reservations.otherW[p]);
        if (measuredA === null || pendingW === null || pendingW < 0) return null;
        // The battery's physical grid phase is not assumed. Reserve each
        // positive power change conservatively against EVERY grid phase.
        return actualW + (maximumA - measuredA) * 230 - pendingW;
    });
    return headroom.some(value => value === null) ? null : Math.max(0, Math.floor(Math.min(...headroom)));
}

function updateBatteryProductionOutput() {
    if (!batteryHeadsMode()) batteryPlanningProfile();
    initializeBatteryHeadsOwnership();
    if (batteryHeadsMode() || batteryHeadOwners.some(head => head.owned) || batteryHeadsOwnershipFault)
        return updateBatteryHeadsOutput();
    initializeBatteryOwnership();
    observeBatteryOutstandingCommand();
    confirmBatteryPhysicalStop();
    confirmBatteryZero();
    const r = CFG.root;
    const base = `${r}.Devices.Battery`;
    const released = nativeConfig.globalWriteEnabled === true
        && nativeConfig.batteryPresent === true && nativeConfig.batteryControlEnabled === true
        && getState(`${r}.System.RealOutputsEnabled`)?.val === true
        && getState(`${base}.Present`)?.val === true
        && getState(`${base}.ControlEnabled`)?.val === true
        && nativeConfig.batteryProductionArmed === true;
    if (!hasOwnedBatteryOutput() && (!released || getState(`${base}.ResetFault`)?.val === true)) {
        batteryOutputFault = '';
        write(`${base}.ResetFault`, false);
    }
    const state = batteryRegulationState();
    write(`${base}.RegulationAvailable`, state.available);
    write(`${base}.CanCharge`, state.canCharge);
    write(`${base}.CanDischarge`, state.canDischarge);
    if (state.actualW !== null) write(`${base}.ActualPower_W`, Math.round(state.actualW));
    if (!state.eligible) return stopBatteryOutput(state.reason);
    if (getState(`${r}.System.DataValid`)?.val !== true
        || getState(`${r}.Control.Valid`)?.val !== true)
        return stopBatteryOutput('EMS-Eingangsdaten oder Echtzeitregler ungueltig');
    if (CFG.dp.haCritical && batteryBoolean(CFG.dp.haCritical) !== false)
        return stopBatteryOutput('Hausanschlussschutz aktiv oder ungueltig');
    const controlUpdate = batteryNumber(getState(`${r}.Control.LastUpdate`)?.val);
    if (controlUpdate === null || controlUpdate <= 0 || controlUpdate > Date.now() + 1000
        || Date.now() - controlUpdate > state.measurementAgeMs)
        return stopBatteryOutput('EMS-Echtzeitregler ist veraltet');
    const rawTarget = batteryNumber(getState(`${r}.Control.Targets.Battery_W`)?.val);
    if (rawTarget === null) return stopBatteryOutput('ungueltiger Speicher-Sollwert');
    const priceSafeTarget = typeof batteryPriceSafeTarget === 'function' ? batteryPriceSafeTarget(rawTarget) : rawTarget;
    let targetW = Math.round(Math.max(state.canDischarge ? -state.maxDischargeW : 0,
        Math.min(state.canCharge ? state.maxChargeW : 0, priceSafeTarget)));
    const houseCapW = batteryHouseConnectionCapW(state.actualW);
    if (houseCapW === null) return stopBatteryOutput('Hausanschlussmessung oder gemeinsame Phasenreserve ungueltig');
    targetW = Math.min(targetW, houseCapW);
    // The allocator's limit can change between its calculation and this
    // output. Charge competes with heaters and wallboxes for the same gross
    // consumption budget; real/pending peer load must not be counted as zero.
    if (typeof currentConsumptionLimit !== 'function')
        return stopBatteryOutput('gemeinsame Netzbetreibergrenze nicht verfuegbar');
    const consumption = currentConsumptionLimit();
    if (!consumption.valid) return stopBatteryOutput(consumption.reason || 'Netzbetreibergrenze ungueltig');
    if (consumption.budgetW !== null) {
        const budgetW = batteryNumber(consumption.budgetW);
        const loads = typeof coordinatedConsumptionLoads === 'function'
            ? coordinatedConsumptionLoads() : null;
        const values = loads ? [loads.dhwW, loads.heatingW, loads.wallboxW] : [];
        if (budgetW === null || budgetW < 0 || !loads || loads.valid === false
            || values.some(value => batteryNumber(value) === null || Number(value) < 0))
            return stopBatteryOutput('gemeinsames Verbraucherbudget oder Restlasten ungueltig');
        const remainingW = Math.max(0, budgetW - values.reduce((sumW, valueW) => sumW + Number(valueW), 0));
        targetW = Math.min(targetW, Math.floor(remainingW));
    }
    if (Math.abs(targetW) <= state.deadbandW) targetW = 0;
    // An explicit zero or a smaller magnitude is always immediate. For a
    // reversal, confirm physical zero before requesting the opposite sign.
    if (targetW === 0) {
        const reason = rawTarget > 0 && !state.canCharge ? 'Laden gesperrt: maximaler SoC oder Ladeleistungsgrenze'
            : rawTarget < 0 && !state.canDischarge ? state.minSoc <= 0
                ? 'Entladen gesperrt: positive Mindest-SoC-Reserve erforderlich'
                : 'Entladen gesperrt: Mindest-SoC, Entladegrenze oder Eigenverbrauchsfreigabe'
                : rawTarget > 0 && houseCapW <= 0 ? 'Laden gesperrt: gemeinsame Hausanschluss-Phasenreserve ausgeschoepft'
                    : 'Speicher-Sollwert null, im Totband oder gemeinsames Verbraucherbudget ausgeschoepft';
        stopBatteryOutput(reason);
        // Zero demand is not a broken controller. Keep availability visible
        // for allocator/debug users while no previous stop remains pending.
        if (!batteryStopPending) {
            write(`${base}.RegulationAvailable`, state.available);
            write(`${base}.CanCharge`, state.canCharge);
            write(`${base}.CanDischarge`, state.canDischarge);
        }
        return;
    }
    const differenceW = state.actualW - batteryLastCommandW;
    const settled = Math.abs(differenceW) <= state.toleranceW;
    write(`${base}.ActuatorDifference_W`, Math.round(differenceW));
    write(`${base}.ActuatorSettled`, settled);
    const reverse = batteryLastCommandW !== 0 && Math.sign(targetW) !== Math.sign(batteryLastCommandW);
    if (reverse) return stopBatteryOutput('Richtungswechsel: zuerst Nullbefehl');
    // A previous stop being delivered successfully does not mean the physical
    // inverter has already stopped. Do not ramp into an unowned residual load.
    if (!hasOwnedBatteryOutput() && Math.abs(state.actualW) > state.toleranceW) {
        write(`${base}.RequestedPower_W`, 0);
        return publishBatteryStatus('Warte auf echte Nullleistung vor Uebernahme/Richtungswechsel');
    }
    const reduction = batteryLastCommandW !== 0 && Math.abs(targetW) < Math.abs(batteryLastCommandW);
    if (!reduction && batteryPendingCommand) {
        const heartbeat = getState(nativeConfig.batteryHeartbeatId)?.val;
        const heartbeatAt = batteryNumber(heartbeat) ?? (typeof heartbeat === 'string' ? Date.parse(heartbeat) : NaN);
        if (batteryPendingCommand.transportComplete && settled
            && (Number(getState(batteryAcMeasurementId())?.ts) >= batteryPendingCommand.at
                || batteryCoherentSources(batteryAcMeasurementId())
                    && Number.isFinite(heartbeatAt) && heartbeatAt >= batteryPendingCommand.at)) {
            batteryPendingCommand = null;
            if (batteryUnobservedCommandW === 0) {
                batteryReservedChargeW = Math.max(0, batteryLastCommandW);
                publishBatteryStatus('Aktueller Speicherbefehl physisch bestaetigt; vorherige Mehrleistungsreserve reduziert');
            }
        } else {
            if (Date.now() - batteryPendingCommand.at >= state.feedbackTimeoutMs) {
                batteryOutputFault = 'Speicher folgt Sollwert nicht innerhalb der Rueckmeldefrist';
                return stopBatteryOutput(batteryOutputFault);
            }
            return publishBatteryStatus('Warte auf bestaetigte echte Speicherleistung; keine weitere Erhoehung');
        }
    }
    if (!reduction && batteryLastCommandAt && Date.now() - batteryLastCommandAt < state.cycleMs)
        return publishBatteryStatus('Speicher-Regelschritt wartet auf Mindestabstand');
    // Keep the external GS demand fresh at the configured cadence, even at a
    // constant target. The completed transport AND real feedback check above
    // must pass first: refreshing an unobserved request would reset its timeout
    // forever and could accumulate writes to an unresponsive actuator.
    if (targetW === batteryLastCommandW && hasOwnedBatteryOutput()) {
        write(`${base}.EffectiveStep_W`, 0);
        return sendBatteryCommand(targetW, 'Speicher-Sollwert physisch bestaetigt; zyklische Auffrischung');
    }
    const maximumMagnitudeW = reduction ? Math.abs(targetW) : Math.abs(batteryLastCommandW) + state.stepW;
    const commandW = Math.sign(targetW) * Math.round(Math.min(Math.abs(targetW), maximumMagnitudeW));
    write(`${base}.EffectiveStep_W`, Math.abs(commandW - batteryLastCommandW));
    sendBatteryCommand(commandW, reduction ? 'Speicher-Budget sofort reduziert'
        : `Speicher-Feinschritt ${Math.round(state.stepW)} W; GS ${-commandW} W`);
}

/* Multi-head standard-adapter transport. Each head has its own durable claim,
 * original /read snapshot and electrical confirmation. Aggregate cancellation
 * is never evidence that individual inverters have stopped. */
let batteryHeadOwners = [];
let batteryHeadsOwnershipInitialized = false;
let batteryHeadsOwnershipFault = '';
let batteryHeadsFault = '';
let batteryHeadsGeneration = 0;

function batteryHeadsMode() { return nativeConfig.batteryDispatchMode === 'sunenergy-heads'; }

function createBatteryHeadsStates(base) {
    stateDef(`${base}.HeadsVerified`, false, 'boolean', 'indicator', '', 'Konfigurierte SunEnergy-Koepfe und exklusive Treiberzustaendigkeit geprueft');
    stateDef(`${base}.HeadOwnership_JSON`, '{"version":1,"heads":[]}', 'string', 'json', '', 'Dauerhafte Ausgangsverantwortung je Kopf, auch nach Zuordnungswechsel');
    stateDef(`${base}.HeadAllocation_JSON`, '{}', 'string', 'json', '', 'SoC- und kapazitaetsgewichtete begrenzte Kopfverteilung');
    for (let index = 1; index <= 3; index++) {
        const headBase = `${base}.Heads.${index}`;
        const definitions = [
            ['Valid', false, 'boolean', 'indicator', '', 'Frischer vollstaendiger Original-Snapshot dieses Kopfes'],
            ['Status', 'Nicht geprueft', 'string', 'text', '', 'Rueckmeldung und Ausgangsstatus dieses Kopfes'],
            ['SoC_pct', null, 'number', 'value', '%', 'SoC aus dem Original-Snapshot'],
            ['Packs', null, 'number', 'value', '', 'Kapazitaetsgewicht ON'],
            ['ActualPower_W', null, 'number', 'value.power', 'W', 'AC GP: positiv Laden, negativ Entladen'],
            ['ReportedSetpoint_W', null, 'number', 'value.power', 'W', 'GS-Rueckmeldung: positiv Entladen, negativ Laden'],
            ['SnapshotAt', 0, 'number', 'value.time', '', 'Originalzeitstempel des vollstaendigen /read-Snapshots'],
            ['OutputOwned', false, 'boolean', 'indicator', '', 'Verantwortung fuer diesen Ausgang'],
            ['OutputSetpointId', '', 'string', 'text', '', 'Tatsaechlich uebernommener GS-Ausgang'],
            ['OutputCommandInternal_W', 0, 'number', 'value.power', 'W', 'Befehl: positiv Laden, negativ Entladen'],
            ['OutputReservedCharge_W', 0, 'number', 'value.power', 'W', 'Ladeleistungsreserve einschliesslich ungeklaerter Altbefehle'],
            ['OutputUnobservedCommand_W', 0, 'number', 'value.power', 'W', 'Noch nicht physisch beobachteter Altbefehl'],
            ['OutputUnobservedCommandSince', 0, 'number', 'value.time', '', 'Originalzeitpunkt des unbeobachteten Befehls'],
            ['OutputLastWrite', 0, 'number', 'value.time', '', 'Letzter GS-Schreibauftrag'],
            ['ActuatorSettled', false, 'boolean', 'indicator', '', 'GS und elektrische GP-Antwort nach Schreibauftrag bestaetigt']
        ];
        definitions.forEach(([name, value, type, role, unit, label]) =>
            stateDef(`${headBase}.${name}`, value, type, role, unit, label));
    }
}

function batteryHeadId(id) {
    const match = typeof id === 'string' && id.match(/^(sunenergyxt500\.\d+)\.heads\.([1-3])\.control\.GS$/);
    return match ? {index: Number(match[2]), setpointId: id,
        baseId: `${match[1]}.heads.${match[2]}`} : null;
}

function initializeBatteryHeadsOwnership() {
    if (batteryHeadsOwnershipInitialized) return;
    batteryHeadsOwnershipInitialized = true;
    const base = `${CFG.root}.Devices.Battery`;
    const persisted = getState(`${base}.HeadOwnership_JSON`);
    if (persisted && persisted.val) {
        try {
            const body = JSON.parse(persisted.val);
            if (body.version !== 1 || !Array.isArray(body.heads) || body.heads.length > 6)
                throw new Error('ungueltiges Format');
            const ids = new Set();
            for (const saved of body.heads) {
                const parsed = batteryHeadId(saved.setpointId);
                const commandW = batteryNumber(saved.commandW), commandAt = batteryNumber(saved.commandAt);
                const reserved = batteryNumber(saved.reservedChargeW), unobserved = batteryNumber(saved.unobservedCommandW);
                const since = batteryNumber(saved.unobservedSince);
                if (!parsed || parsed.index !== saved.index || ids.has(parsed.setpointId)
                    || typeof saved.owned !== 'boolean' || [commandW, commandAt, reserved, unobserved, since].some(v => v === null)
                    || Math.abs(commandW) > 2400 || reserved < 0 || reserved > 2400
                    || Math.abs(unobserved) > 2400 || commandAt < 0 || since < 0)
                    throw new Error('ungueltiger Kopfanspruch');
                ids.add(parsed.setpointId);
                if (saved.owned || reserved > 0 || unobserved !== 0 || commandW !== 0) batteryHeadOwners.push({...parsed,
                    owned: true, commandW, commandAt, reservedChargeW: Math.max(reserved, commandW, 0),
                    unobservedCommandW: unobserved || (commandW !== 0 ? commandW : reserved),
                    unobservedSince: since || commandAt, pending: null});
            }
        } catch {
            batteryHeadsOwnershipFault = 'Dauerhafte Kopf-Ausgangsverantwortung ungueltig; keine freie Zuordnung rekonstruieren, manuell pruefen';
            return;
        }
    }
    // A legacy owned single-head actuator is a former output, even when its ID
    // is also part of the newly selected topology. Return it before re-arming.
    if (batteryHeadsMode() && !batteryHeadOwners.length
        && (getState(`${base}.OutputOwned`)?.val === true
            || (batteryNumber(getState(`${base}.OutputReservedCharge_W`)?.val) || 0) > 0
            || (batteryNumber(getState(`${base}.OutputUnobservedCommand_W`)?.val) || 0) !== 0)) {
        const parsed = batteryHeadId(String(getState(`${base}.OutputSetpointId`)?.val || ''));
        if (!parsed) {
            batteryHeadsOwnershipFault = 'Alter Speicher-Ausgangsanspruch ohne gueltige GS-Zuordnung; manuelle Rueckgabe erforderlich';
            return;
        }
        const commandW = batteryNumber(getState(`${base}.OutputCommandInternal_W`)?.val) || 0;
        const commandAt = batteryNumber(getState(`${base}.OutputLastWrite`)?.val) || 0;
        const reserved = batteryNumber(getState(`${base}.OutputReservedCharge_W`)?.val) || 0;
        batteryHeadOwners.push({...parsed, owned: true, commandW, commandAt,
            reservedChargeW: Math.max(reserved, commandW, 0),
            unobservedCommandW: batteryNumber(getState(`${base}.OutputUnobservedCommand_W`)?.val) || commandW || reserved,
            unobservedSince: batteryNumber(getState(`${base}.OutputUnobservedCommandSince`)?.val) || commandAt,
            pending: null});
    }
    if (batteryHeadOwners.length) {
        batteryHeadsFault = 'Vorherige Kopf-Ausgangsverantwortung: zuerst bestaetigte Rueckgabe aller Koepfe';
        publishBatteryHeadsStatus(batteryHeadsFault);
    }
}

function batteryHeadsSnapshot() {
    const topology = sunEnergyHeads.readTopology(nativeConfig);
    const settings = batteryTimingSettings();
    if (!topology.valid || !settings.valid) return {valid: false, reason: topology.reason || 'ungueltige Regelfristen',
        topology, heads: [], actualW: null, soc: null};
    const heads = topology.heads.map(head => ({...head,
        ...sunEnergyHeads.parseHeadSnapshot(getState(head.rawResponseId), {now: Date.now(),
            maxAgeMs: settings.measurementAgeMs, index: head.index, onlineState: getState(head.onlineId)})}));
    const valid = heads.every(head => head.valid);
    const packs = valid ? heads.reduce((sum, head) => sum + head.packs, 0) : 0;
    return {valid, reason: valid ? 'Alle Kopf-Snapshots frisch' : heads.filter(head => !head.valid)
        .map(head => `Kopf ${head.index}: ${head.reason}`).join('; '), topology, heads,
        actualW: valid ? heads.reduce((sum, head) => sum + head.acPowerW, 0) : null,
        soc: valid ? heads.reduce((sum, head) => sum + head.soc * head.packs, 0) / packs : null};
}

// Device telemetry and operator policy remain separate. Never overwrite the
// configured manual capacity or power caps with a transient online profile.
function batteryPlanningProfile(snapshot = null) {
    if (!batteryHeadsMode()) {
        const base = `${CFG.root}.Devices.Battery.Profile`;
        if (getState(`${base}.Valid`)?.val === true || getState(`${base}.CapacityValid`)?.val === true) {
            write(`${base}.Valid`, false); write(`${base}.CapacityValid`, false);
            write(`${base}.Status`, 'Nicht aktiv: SunEnergy-Kopfprofil im gewaehlten Betriebsmodus nicht verwendet');
            for (const field of ['SoC_pct', 'ActualPower_W', 'OnlinePacks', 'Capacity_kWh',
                'MaxCharge_W', 'MaxDischarge_W', 'DeviceMinSoC_pct', 'DeviceMaxSoC_pct'])
                write(`${base}.${field}`, null);
            write(`${base}.SourceAt`, 0); write(`${base}.OldestSourceAt`, 0);
        }
        batteryPlanningLastSignature = undefined;
        return null;
    }
    snapshot = snapshot || batteryHeadsSnapshot();
    const configuredSource = getState(`${CFG.root}.Config.BatteryCapacitySource`);
    const profile = sunEnergyHeads.deviceProfile(snapshot.heads, {
        topology: snapshot.topology,
        capacitySource: configuredSource ? configuredSource.val : nativeConfig.batteryCapacitySource || 'manual',
        manualCapacityKWh: batterySetting('BatteryCapacity_kWh', 10),
        packCapacityKWh: batterySetting('BatteryPackCapacity_kWh', 0),
        maxChargeW: batterySetting('BatteryMaxCharge_W', 2400),
        maxDischargeW: batterySetting('BatteryMaxDischarge_W', 2400)
    });
    if (!snapshot.valid) {
        profile.valid = false;
        profile.reason = snapshot.reason;
    }
    const base = `${CFG.root}.Devices.Battery.Profile`;
    const number = value => profile.valid && Number.isFinite(value) ? value : null;
    write(`${base}.Valid`, profile.valid);
    write(`${base}.Status`, !profile.valid ? `Nicht bewertbar: ${profile.reason}`
        : !profile.capacityValid ? `Geraetedaten gueltig; Kapazitaet unbekannt: ${profile.capacityReason}`
        : profile.capacitySource === 'sunenergy-packs'
            ? 'Aus frischen Kopf-Snapshots; kWh aus Online-Packs und bestaetigter Packgroesse'
            : 'Aus frischen Kopf-Snapshots; Gesamtkapazitaet manuell');
    write(`${base}.SoC_pct`, number(profile.soc));
    write(`${base}.ActualPower_W`, number(profile.actualW));
    write(`${base}.OnlinePacks`, number(profile.packs));
    write(`${base}.Capacity_kWh`, profile.valid && profile.capacityValid ? profile.capacityKWh : null);
    write(`${base}.CapacityValid`, profile.valid && profile.capacityValid);
    write(`${base}.MaxCharge_W`, number(profile.maxChargeW));
    write(`${base}.MaxDischarge_W`, number(profile.maxDischargeW));
    write(`${base}.DeviceMinSoC_pct`, number(profile.deviceMinSoc));
    write(`${base}.DeviceMaxSoC_pct`, number(profile.deviceMaxSoc));
    write(`${base}.SourceAt`, profile.valid ? profile.sourceTsMax : 0);
    write(`${base}.OldestSourceAt`, profile.valid ? profile.sourceTsMin : 0);
    // SOC/power updates do not start a new 48-hour calculation every poll.
    // Topology/capacity/operator limits and loss/recovery of proof invalidate its
    // basis. Dynamic LP use affects the next scheduled forecast, not a rebuild
    // on every power poll; actual dispatch always rechecks current limits.
    const signature = JSON.stringify([profile.valid, profile.capacityValid,
        profile.capacitySource, profile.capacityKWh, profile.packs,
        batterySetting('BatteryMaxCharge_W', 2400), batterySetting('BatteryMaxDischarge_W', 2400),
        profile.deviceMinSoc, profile.deviceMaxSoc,
        snapshot.heads.map(head => [head.index, head.modelMaxDischargeW,
            snapshot.topology?.heads.find(item => item.index === head.index)?.maxChargeW,
            snapshot.topology?.heads.find(item => item.index === head.index)?.maxDischargeW])]);
    if (batteryPlanningLastSignature !== undefined && signature !== batteryPlanningLastSignature
        && typeof getActualState !== 'function'
        && typeof requestForecastRebuild === 'function' && typeof setTimeout === 'function')
        requestForecastRebuild();
    batteryPlanningLastSignature = signature;
    return profile;
}

function batteryHeadsRegulationState() {
    initializeBatteryHeadsOwnership();
    const r = CFG.root, base = `${r}.Devices.Battery`;
    const snapshot = batteryHeadsSnapshot(), settings = batteryTimingSettings();
    batteryPlanningProfile(snapshot);
    const result = {configured: snapshot.topology?.valid === true, available: false, eligible: false,
        active: batteryHeadOwners.some(head => head.owned), reason: '', actualW: snapshot.actualW,
        soc: snapshot.soc, heads: snapshot.heads, topology: snapshot.topology,
        minSoc: batteryEffectiveMinimumSoc(), maxSoc: batterySetting('BatteryMaxSoC_pct', 100),
        maxChargeW: batterySetting('BatteryMaxCharge_W', 2400),
        maxDischargeW: batterySetting('BatteryMaxDischarge_W', 2400),
        canCharge: false, canDischarge: false, ...settings};
    const blocked = reason => ({...result, reason});
    if (nativeConfig.globalWriteEnabled !== true || getState(`${r}.System.RealOutputsEnabled`)?.val !== true)
        return blocked('globale Schreibfreigabe aus');
    if (nativeConfig.batteryPresent !== true || getState(`${base}.Present`)?.val !== true)
        return blocked('Speicher nicht vorhanden');
    if (nativeConfig.batteryControlEnabled !== true || getState(`${base}.ControlEnabled`)?.val !== true)
        return blocked('Speicher-Steuerfreigabe aus');
    if (nativeConfig.batteryProductionArmed !== true) return blocked('Speicher-Produktionstest nicht bestaetigt');
    if (getState(`${base}.DriverReady`)?.val !== true || getState(`${base}.HeadsVerified`)?.val !== true)
        return blocked('Mehrkopf-Treiber und exklusive Zustaendigkeit nicht geprueft');
    if (batteryHeadsOwnershipFault || batteryHeadsFault) return blocked(batteryHeadsOwnershipFault || batteryHeadsFault);
    if (!snapshot.valid) return blocked(snapshot.reason);
    if (batteryHeadOwners.some(head => head.owned && !snapshot.topology.heads.some(h => h.setpointId === head.setpointId)))
        return blocked('Frueherer Kopf-Ausgang noch nicht zurueckgegeben');
    if (batteryHeadOwners.some(head => head.pending?.commandW === 0)) return blocked('Kopf-Nullbefehl noch offen');
    if (nativeConfig.batteryFaultId && batteryBoolean(nativeConfig.batteryFaultId) !== false)
        return blocked('Speicherstoerung oder ungueltige Stoerungsrueckmeldung');
    if (nativeConfig.batteryTemperatureId) {
        const source = batteryInput(nativeConfig.batteryTemperatureId, settings.measurementAgeMs);
        const temperature = source ? batteryNumber(source.val) : null;
        const limit = batterySetting('BatteryTemperatureMax_C', 50);
        if (temperature === null || temperature < -50 || temperature > 120
            || limit === null || limit < 0 || limit > 100 || temperature >= limit)
            return blocked('Speichertemperatur ungueltig oder Abschaltgrenze erreicht');
    }
    if (result.minSoc === null || result.minSoc < 0 || result.minSoc >= 100
        || result.maxSoc === null || result.maxSoc <= result.minSoc || result.maxSoc > 100
        || result.maxChargeW === null || result.maxChargeW < 0 || result.maxChargeW > 100000
        || result.maxDischargeW === null || result.maxDischargeW < 0 || result.maxDischargeW > 100000)
        return blocked('Speicher-Leistungs- oder SoC-Grenzen ungueltig');
    if (snapshot.heads.some(head => !batteryHeadOwners.some(owner => owner.owned && owner.setpointId === head.setpointId)
        && (head.gsW !== 0 || Math.abs(head.acPowerW) > settings.toleranceW)))
        return blocked('Uebernahme erfordert GS=0 und echte Nullleistung je Kopf');
    const options = batteryHeadsAllocationOptions(result);
    const charge = sunEnergyHeads.allocate(result.maxChargeW, batteryHeadsLimitedSnapshots(result), options);
    const discharge = sunEnergyHeads.allocate(-result.maxDischargeW, batteryHeadsLimitedSnapshots(result), options);
    result.canCharge = charge.valid && charge.acceptedW > 0;
    result.canDischarge = result.minSoc > 0 && discharge.valid && discharge.acceptedW < 0
        && getState(`${r}.Config.BatterySelfConsumptionEnabled`)?.val === true;
    result.available = result.canCharge || result.canDischarge;
    result.eligible = true;
    result.reason = result.available ? 'SoC- und kapazitaetsgewichtete Mehrkopfregelung bereit' : 'SoC-/Leistungsgrenzen erreicht';
    return result;
}

function batteryHeadsAllocationOptions(state) {
    return {minSoc: state.minSoc, maxSoc: state.maxSoc,
        priceFloor: Math.max(state.minSoc, typeof batteryPriceDischargeFloor === 'function' ? batteryPriceDischargeFloor() : state.minSoc),
        maxChargeW: state.maxChargeW, maxDischargeW: state.maxDischargeW,
        resumingCharge: state.heads.filter(head => !batteryHeadOwners.some(owner => owner.setpointId === head.setpointId
            && owner.commandW > 0)).map(head => head.index),
        resumingDischarge: state.heads.filter(head => !batteryHeadOwners.some(owner => owner.setpointId === head.setpointId
            && owner.commandW < 0)).map(head => head.index)};
}

function batteryHeadsLimitedSnapshots(state) {
    return state.heads.map(head => ({...head,
        maxChargeW: Math.min(head.maxChargeW, state.topology.heads.find(h => h.index === head.index).maxChargeW),
        maxDischargeW: Math.min(head.maxDischargeW, state.topology.heads.find(h => h.index === head.index).maxDischargeW)}));
}

function publishBatteryHeadsStatus(reason) {
    const base = `${CFG.root}.Devices.Battery`;
    const owned = batteryHeadOwners.filter(head => head.owned);
    const sum = key => owned.reduce((value, head) => value + head[key], 0);
    const claim = {version: 1, heads: owned.map(head => ({index: head.index, setpointId: head.setpointId,
        owned: true, commandW: head.commandW, commandAt: head.commandAt,
        reservedChargeW: head.reservedChargeW, unobservedCommandW: head.unobservedCommandW,
        unobservedSince: head.unobservedSince}))};
    if (batteryHeadsOwnershipFault) {
        // Invalid durable proof is retained verbatim for diagnosis; clearing
        // it or its prior reserve would fabricate a returned actuator.
        write(`${base}.OutputOwned`, true); write(`${base}.OutputActive`, false);
        write(`${base}.RequestedPower_W`, 0); write(`${base}.OutputStatus`, reason);
        write(`${base}.Fault`, batteryHeadsOwnershipFault);
        write(`${CFG.root}.System.NoActuation`, false);
        return;
    }
    write(`${base}.HeadOwnership_JSON`, JSON.stringify(claim));
    write(`${base}.OutputOwned`, owned.length > 0 || Boolean(batteryHeadsOwnershipFault));
    write(`${base}.OutputActive`, owned.some(head => head.commandW !== 0) && !batteryHeadsFault);
    write(`${base}.OutputSetpointId`, '');
    write(`${base}.OutputCommandInternal_W`, sum('commandW'));
    write(`${base}.OutputCommand_W`, -sum('commandW') || 0);
    write(`${base}.RequestedPower_W`, batteryHeadsFault ? 0 : -sum('commandW') || 0);
    write(`${base}.OutputReservedCharge_W`, sum('reservedChargeW'));
    write(`${base}.OutputUnobservedCommand_W`, sum('unobservedCommandW'));
    write(`${base}.OutputUnobservedCommandSince`, owned.filter(head => head.unobservedCommandW !== 0)
        .reduce((earliest, head) => Math.min(earliest, head.unobservedSince), Infinity) === Infinity ? 0
        : Math.min(...owned.filter(head => head.unobservedCommandW !== 0).map(head => head.unobservedSince)));
    write(`${base}.OutputLastWrite`, Math.max(0, ...owned.map(head => head.commandAt)));
    write(`${base}.OutputStatus`, reason);
    write(`${base}.Fault`, batteryHeadsOwnershipFault || batteryHeadsFault);
    for (let index = 1; index <= 3; index++) {
        const head = owned.find(owner => owner.index === index);
        const hb = `${base}.Heads.${index}`;
        write(`${hb}.OutputOwned`, Boolean(head));
        write(`${hb}.OutputSetpointId`, head?.setpointId || '');
        write(`${hb}.OutputCommandInternal_W`, head?.commandW || 0);
        write(`${hb}.OutputReservedCharge_W`, head?.reservedChargeW || 0);
        write(`${hb}.OutputUnobservedCommand_W`, head?.unobservedCommandW || 0);
        write(`${hb}.OutputUnobservedCommandSince`, head?.unobservedSince || 0);
        write(`${hb}.OutputLastWrite`, head?.commandAt || 0);
    }
    const otherOwned = ['MyPV_DHW', 'MyPV_Heating', 'Wallbox0', 'Wallbox1', 'Wallbox2']
        .some(device => getState(`${CFG.root}.Devices.${device}.OutputOwned`)?.val === true);
    write(`${CFG.root}.System.NoActuation`, !owned.length && !batteryHeadsOwnershipFault && !otherOwned);
    if (owned.length || getState(`${CFG.root}.Devices.MyPV_Heating.OutputOwned`)?.val === true)
        write(`${CFG.root}.Control.Mode`, 'ALPHA_ENERGY_COORDINATED');
    const latestAt = Math.max(0, ...owned.map(head => head.commandAt));
    write(`${base}.CommandAge_s`, latestAt ? Math.max(0, (Date.now() - latestAt) / 1000) : 0);
}

function batteryHeadOwnerSnapshot(head) {
    const settings = batteryTimingSettings();
    return sunEnergyHeads.parseHeadSnapshot(getState(`${head.baseId}.info.rawResponse`),
        {now: Date.now(), maxAgeMs: settings.measurementAgeMs, index: head.index,
            onlineState: getState(`${head.baseId}.info.online`)});
}

function observeBatteryHeads() {
    const settings = batteryTimingSettings();
    for (const head of batteryHeadOwners.filter(owner => owner.owned)) {
        const actual = batteryHeadOwnerSnapshot(head);
        if (!actual.valid || !settings.valid) continue;
        if (!head.pending && actual.sourceTs > head.commandAt && actual.gsW !== -head.commandW)
            batteryHeadsFault = `Kopf ${head.index}: bestaetigter GS-Wert weicht ohne offenen EMS-Auftrag ab; Reglerzustaendigkeit pruefen`;
        if (head.unobservedCommandW !== 0 && actual.sourceTs > head.unobservedSince
            && actual.gsW === -head.unobservedCommandW
            && Math.sign(actual.acPowerW) === Math.sign(head.unobservedCommandW)
            && Math.abs(actual.acPowerW) >= Math.max(1, Math.abs(head.unobservedCommandW) - settings.toleranceW)) {
            head.unobservedCommandW = 0;
            head.unobservedSince = 0;
        }
        const matching = actual.sourceTs > head.commandAt && actual.gsW === -head.commandW
            && Math.abs(actual.acPowerW - head.commandW) <= settings.toleranceW;
        const settled = matching && (head.pending ? head.pending.transportComplete === true : head.lastConfirmedAt > 0);
        head.settled = settled && head.unobservedCommandW === 0;
        head.responseLostSince = head.settled ? 0 : head.responseLostSince || Date.now();
        write(`${CFG.root}.Devices.Battery.Heads.${head.index}.ActuatorSettled`, Boolean(settled));
        if (settled && head.unobservedCommandW === 0) {
            head.lastConfirmedAt = actual.sourceTs;
            head.reservedChargeW = Math.max(0, head.commandW);
            if (head.commandW === 0) head.owned = false;
            head.pending = null;
        }
    }
}

function confirmBatteryHeadsPhysicalStop() {
    const base = `${CFG.root}.Devices.Battery`, source = getState(`${base}.ConfirmPhysicalStop`);
    if (source?.val !== true) return false;
    write(`${base}.ConfirmPhysicalStop`, false);
    const owned = batteryHeadOwners.filter(head => head.owned), timing = batteryTimingSettings();
    const allowed = source.ack === false && Number(source.ts) <= Date.now() + 1000
        && nativeConfig.globalWriteEnabled === false && getState(`${CFG.root}.System.RealOutputsEnabled`)?.val === false
        && timing.valid && owned.length > 0 && owned.every(head => {
            const proof = batteryHeadOwnerSnapshot(head);
            return head.commandW === 0 && head.pending?.transportComplete === true
                && Number(source.ts) > head.pending.at && proof.valid && proof.sourceTs > head.pending.at
                && proof.gsW === 0 && Math.abs(proof.acPowerW) <= timing.toleranceW;
        });
    if (!allowed) {
        publishBatteryHeadsStatus('Manuelle Rueckgabe abgelehnt: globale Freigaben AUS, Nullschreiben und frische GS/GP-Nullantwort jedes Kopfes erforderlich');
        return false;
    }
    for (const head of owned) {
        ++head.generation;
        head.owned = false; head.pending = null; head.reservedChargeW = 0;
        head.unobservedCommandW = 0; head.unobservedSince = 0;
    }
    batteryHeadsFault = '';
    publishBatteryHeadsStatus('Benutzer bestaetigt unabhaengig Stillstand und Ausschluss alter Stellauftraege je Kopf');
    return true;
}

function sendBatteryHeadCommand(head, commandW, reason) {
    if (commandW !== 0 && (head.pending || head.unobservedCommandW !== 0))
        return sendBatteryHeadCommand(head, 0, 'Unbestaetigter Nichtnullauftrag: weiterer Auftrag durch Null ersetzt');
    const generation = ++batteryHeadsGeneration;
    const previousCommandW = head.commandW;
    head.owned = true; head.commandW = commandW; head.commandAt = Date.now(); head.generation = generation;
    if (commandW !== 0 && Math.abs(commandW) >= Math.abs(head.unobservedCommandW)) {
        head.unobservedCommandW = commandW; head.unobservedSince = head.commandAt;
    }
    head.reservedChargeW = Math.max(head.reservedChargeW, commandW, 0);
    head.settled = false; head.responseLostSince = 0;
    head.pending = {generation, commandW, previousCommandW, at: head.commandAt, transportComplete: false};
    // Transport awaits these durable writes before accepting a nonzero GS.
    publishBatteryHeadsStatus(reason);
    const completed = error => {
        if (head.generation !== generation || !head.pending) return;
        if (error) {
            head.pending = null;
            batteryHeadsFault = `Kopf ${head.index}: Ausgangsschreibfehler ${String(error.message || error)}`;
            publishBatteryHeadsStatus(`${batteryHeadsFault}; Nullbefehl erforderlich, Reserve bleibt`);
        } else head.pending.transportComplete = true;
    };
    let accepted;
    try { accepted = writeForeignState(head.setpointId, commandW === 0 ? 0 : -commandW, completed); }
    catch (error) { completed(error); return false; }
    if (!accepted) completed(new Error('Schreibschutz blockiert Ausgang'));
    return accepted;
}

function stopBatteryHeadsOutput(reason = 'Mehrkopfregelung wird beendet') {
    initializeBatteryHeadsOwnership();
    observeBatteryHeads();
    const base = `${CFG.root}.Devices.Battery`, timing = batteryTimingSettings();
    write(`${base}.RegulationAvailable`, false); write(`${base}.CanCharge`, false); write(`${base}.CanDischarge`, false);
    if (batteryHeadsOwnershipFault) return publishBatteryHeadsStatus(batteryHeadsOwnershipFault);
    for (const head of batteryHeadOwners.filter(owner => owner.owned)) {
        if (head.pending?.commandW === 0 && Date.now() - head.pending.at < timing.feedbackTimeoutMs) continue;
        sendBatteryHeadCommand(head, 0, reason);
    }
    publishBatteryHeadsStatus(batteryHeadOwners.some(head => head.owned)
        ? `Nullbefehl/Rueckgabe je Kopf offen: ${reason}; unbeobachtete Altbefehle bleiben reserviert` : `Gesperrt: ${reason}`);
}

function batteryHeadsBudget(state) {
    const r = CFG.root;
    const fail = reason => ({valid: false, reason, targetW: 0});
    if (getState(`${r}.System.DataValid`)?.val !== true || getState(`${r}.Control.Valid`)?.val !== true)
        return fail('EMS-Eingangsdaten oder Echtzeitregler ungueltig');
    if (CFG.dp.haCritical && batteryBoolean(CFG.dp.haCritical) !== false)
        return fail('Hausanschlussschutz aktiv oder ungueltig');
    const at = batteryNumber(getState(`${r}.Control.LastUpdate`)?.val);
    if (at === null || at <= 0 || at > Date.now() + 1000 || Date.now() - at > state.measurementAgeMs)
        return fail('EMS-Echtzeitregler ist veraltet');
    const raw = batteryNumber(getState(`${r}.Control.Targets.Battery_W`)?.val);
    if (raw === null) return fail('ungueltiger Speicher-Sollwert');
    const priceSafe = typeof batteryPriceSafeTarget === 'function' ? batteryPriceSafeTarget(raw) : raw;
    let targetW = Math.round(Math.max(state.canDischarge ? -state.maxDischargeW : 0,
        Math.min(state.canCharge ? state.maxChargeW : 0, priceSafe)));
    const houseCap = batteryHouseConnectionCapW(state.actualW);
    if (houseCap === null) return fail('Hausanschlussmessung oder gemeinsame Phasenreserve ungueltig');
    targetW = Math.min(targetW, houseCap);
    if (typeof currentConsumptionLimit !== 'function') return fail('gemeinsame Netzbetreibergrenze nicht verfuegbar');
    const limit = currentConsumptionLimit();
    if (!limit.valid) return fail(limit.reason || 'Netzbetreibergrenze ungueltig');
    if (limit.budgetW !== null) {
        const budgetW = batteryNumber(limit.budgetW);
        const loads = typeof coordinatedConsumptionLoads === 'function' ? coordinatedConsumptionLoads() : null;
        const peers = loads ? [loads.dhwW, loads.heatingW, loads.wallboxW] : [];
        if (budgetW === null || budgetW < 0 || !loads || loads.valid === false
            || peers.some(value => batteryNumber(value) === null || Number(value) < 0))
            return fail('gemeinsames Verbraucherbudget oder Restlasten ungueltig');
        targetW = Math.min(targetW, Math.floor(Math.max(0, budgetW - peers.reduce((sum, value) => sum + Number(value), 0))));
    }
    return {valid: true, targetW: Math.abs(targetW) <= state.deadbandW ? 0 : targetW, rawTargetW: raw};
}

function batteryHeadsQueuedCheck(id, value) {
    initializeBatteryHeadsOwnership();
    const fail = reason => ({allowed: false, reason});
    if (!batteryHeadsMode()) return fail('Mehrkopfmodus nicht mehr aktiv');
    const commandW = batteryNumber(value) === null ? null : -Number(value);
    const owner = batteryHeadOwners.find(head => head.owned && head.setpointId === id);
    if (commandW === null || commandW === 0 || !owner || owner.commandW !== commandW
        || owner.pending?.commandW !== commandW) return fail('Kopfauftrag nicht mehr aktuell');
    let persisted;
    const persistedState = getState(`${CFG.root}.Devices.Battery.HeadOwnership_JSON`);
    if (!persistedState || persistedState.ack !== true || persistedState.q !== undefined && batteryNumber(persistedState.q) !== 0)
        return fail('Dauerhafter Kopfauftrag nicht bestaetigt');
    try { persisted = JSON.parse(persistedState.val); } catch { /* denied below */ }
    const claim = persisted?.version === 1 && persisted.heads?.find(head => head.setpointId === id && head.owned === true);
    const hb = `${CFG.root}.Devices.Battery.Heads.${owner.index}`;
    if (!claim || claim.commandW !== commandW || claim.commandAt !== owner.commandAt
        || getState(`${hb}.OutputOwned`)?.val !== true || getState(`${hb}.OutputSetpointId`)?.val !== id
        || getState(`${hb}.OutputCommandInternal_W`)?.val !== commandW)
        return fail('Dauerhafter Kopfauftrag stimmt nicht ueberein');
    const state = batteryHeadsRegulationState();
    if (!state.eligible) return fail(state.reason);
    const budget = batteryHeadsBudget(state);
    if (!budget.valid) return fail(budget.reason);
    if (commandW > 0 && !state.canCharge || commandW < 0 && !state.canDischarge)
        return fail('Lade-/Entladerichtung nicht freigegeben');
    const all = batteryHeadOwners.filter(head => head.owned);
    const sum = all.reduce((total, head) => total + Math.abs(head.commandW), 0);
    if (Math.sign(commandW) !== Math.sign(budget.targetW) || sum > Math.abs(budget.targetW))
        return fail('Aktuelles Gesamtbudget oder Richtung geaendert');
    const peerPeak = state.heads.filter(head => head.setpointId !== id).reduce((total, head) => {
        const peer = all.find(owned => owned.setpointId === head.setpointId);
        const direction = Math.sign(commandW);
        const directional = value => Math.max(0, direction * value);
        return total + Math.max(directional(head.acPowerW), directional(peer?.commandW || 0),
            directional(peer?.unobservedCommandW || 0), commandW > 0 ? peer?.reservedChargeW || 0 : 0);
    }, 0);
    const reduction = owner.pending.previousCommandW !== 0
        && Math.sign(owner.pending.previousCommandW) === Math.sign(commandW)
        && Math.abs(commandW) < Math.abs(owner.pending.previousCommandW);
    // Reductions improve a pending violation immediately; a peer increase may
    // not reuse budget that another head has not yet physically relinquished.
    if (!reduction && Math.abs(commandW) + peerPeak > Math.abs(budget.targetW))
        return fail('Physische oder unbeobachtete Kopfreserve beansprucht Gesamtbudget');
    const snapshot = batteryHeadsLimitedSnapshots(state).find(head => head.setpointId === id);
    const capacity = sunEnergyHeads.allocate(commandW, [snapshot], batteryHeadsAllocationOptions(state));
    if (!capacity.valid || capacity.acceptedW !== commandW) return fail('Kopfgrenze oder SoC-Reserve geaendert');
    return {allowed: true, reason: 'Frischer Kopfauftrag innerhalb Gesamtbudget und Schutzgrenzen'};
}

function updateBatteryHeadsOutput() {
    initializeBatteryHeadsOwnership();
    observeBatteryHeads();
    confirmBatteryHeadsPhysicalStop();
    const base = `${CFG.root}.Devices.Battery`;
    const owned = batteryHeadOwners.filter(head => head.owned);
    const released = nativeConfig.globalWriteEnabled === true && getState(`${CFG.root}.System.RealOutputsEnabled`)?.val === true;
    if (!owned.length && !batteryHeadsOwnershipFault && (!released || getState(`${base}.ResetFault`)?.val === true)) {
        batteryHeadsFault = ''; write(`${base}.ResetFault`, false);
    }
    if (!batteryHeadsMode()) return owned.length ? stopBatteryHeadsOutput('Betriebsmodus geaendert: alte Koepfe zuerst zurueckgeben')
        : undefined;
    const state = batteryHeadsRegulationState();
    for (const head of state.heads || []) {
        const hb = `${base}.Heads.${head.index}`;
        write(`${hb}.Valid`, head.valid); write(`${hb}.Status`, head.reason);
        write(`${hb}.SoC_pct`, head.valid ? head.soc : null); write(`${hb}.Packs`, head.valid ? head.packs : null);
        write(`${hb}.ActualPower_W`, head.valid ? head.acPowerW : null);
        write(`${hb}.ReportedSetpoint_W`, head.valid ? head.gsW : null);
        write(`${hb}.SnapshotAt`, head.sourceTs || 0);
    }
    write(`${base}.RegulationAvailable`, state.available);
    write(`${base}.CanCharge`, state.canCharge); write(`${base}.CanDischarge`, state.canDischarge);
    write(`${base}.ActualPower_W`, state.actualW);
    if (!state.eligible) return stopBatteryHeadsOutput(state.reason);
    const budget = batteryHeadsBudget(state);
    if (!budget.valid) return stopBatteryHeadsOutput(budget.reason);
    if (budget.targetW === 0) {
        stopBatteryHeadsOutput('Speicher-Sollwert null, SoC-Grenze oder gemeinsames Budget');
        if (!batteryHeadOwners.some(head => head.owned)) {
            write(`${base}.RegulationAvailable`, state.available);
            write(`${base}.CanCharge`, state.canCharge); write(`${base}.CanDischarge`, state.canDischarge);
        }
        return;
    }
    const current = owned.reduce((total, head) => total + head.commandW, 0);
    write(`${base}.ActuatorDifference_W`, state.actualW - current);
    write(`${base}.ActuatorSettled`, owned.every(head => head.settled === true));
    if (owned.some(head => head.commandW !== 0 && Math.sign(head.commandW) !== Math.sign(budget.targetW)))
        return stopBatteryHeadsOutput('Richtungswechsel: echte Nullantwort aller Koepfe zuerst');
    const reduction = Math.abs(budget.targetW) < Math.abs(current);
    const ramp = reduction ? Math.abs(budget.targetW) : Math.min(Math.abs(budget.targetW), Math.abs(current) + state.stepW);
    const allocation = sunEnergyHeads.allocate(Math.sign(budget.targetW) * ramp,
        batteryHeadsLimitedSnapshots(state), batteryHeadsAllocationOptions(state));
    write(`${base}.HeadAllocation_JSON`, JSON.stringify(allocation));
    if (!allocation.valid) return stopBatteryHeadsOutput(allocation.reason);
    const needsReduction = allocation.commands.some(desired => {
        const descriptor = state.topology.heads.find(head => head.index === desired.index);
        const owner = owned.find(head => head.setpointId === descriptor.setpointId);
        return owner && Math.abs(desired.internalW) < Math.abs(owner.commandW);
    });
    // Standard /write calls can overlap after ioBroker accepts their States.
    // Keep at most one unseen nonzero request per head: a necessary reduction
    // while any prior request is unconfirmed goes straight to zero. Sending a
    // second smaller nonzero value would create another independently delayed
    // request that a single high-water observation cannot safely discharge.
    if (needsReduction && owned.some(head => head.pending || head.unobservedCommandW !== 0))
        return stopBatteryHeadsOutput('Reduktion bei unbeobachtetem Kopfauftrag: Null statt weiterem Nichtnullauftrag');
    let reduced = false;
    for (const desired of allocation.commands) {
        const descriptor = state.topology.heads.find(head => head.index === desired.index);
        const owner = batteryHeadOwners.find(head => head.owned && head.setpointId === descriptor.setpointId);
        if (owner && Math.abs(desired.internalW) < Math.abs(owner.commandW)) {
            sendBatteryHeadCommand(owner, desired.internalW, 'Kopfverteilung: zuerst Leistungsreduzierung');
            reduced = true;
        }
    }
    // A redistribution cannot increase another inverter until each reduction
    // has a later GS echo AND physical GP response; otherwise budget overlaps.
    if (reduced) return;
    if (owned.some(head => head.pending || head.unobservedCommandW !== 0 || head.settled !== true)) {
        if (owned.some(head => head.pending && Date.now() - head.pending.at >= state.feedbackTimeoutMs
            || !head.pending && head.responseLostSince && Date.now() - head.responseLostSince >= state.feedbackTimeoutMs)) {
            batteryHeadsFault = 'Kopf folgt GS/GP nicht innerhalb der Rueckmeldefrist';
            return stopBatteryHeadsOutput(batteryHeadsFault);
        }
        return publishBatteryHeadsStatus('Warte auf GS und echte GP-Antwort jedes Kopfes; keine Erhoehung');
    }
    const latestAt = Math.max(0, ...owned.map(head => head.commandAt));
    if (latestAt && Date.now() - latestAt < state.cycleMs)
        return publishBatteryHeadsStatus('Mehrkopf-Regelschritt wartet auf Mindestabstand');
    for (const desired of allocation.commands) {
        if (desired.internalW === 0) continue;
        const descriptor = state.topology.heads.find(head => head.index === desired.index);
        let owner = batteryHeadOwners.find(head => head.setpointId === descriptor.setpointId);
        // Standard mode OFF has no renewable command lease. A confirmed
        // unchanged GS needs no rewrite; this avoids uncorrelatable identical
        // HTTP requests accumulating in the downstream driver.
        if (owner?.owned && owner.commandW === desired.internalW) continue;
        if (!owner) {
            owner = {...descriptor, owned: false, commandW: 0, commandAt: 0,
                reservedChargeW: 0, unobservedCommandW: 0, unobservedSince: 0, pending: null};
            batteryHeadOwners.push(owner);
        }
        sendBatteryHeadCommand(owner, desired.internalW, 'SoC- und kapazitaetsgewichteter Speicher-Feinschritt');
    }
    write(`${base}.EffectiveStep_W`, Math.abs(allocation.acceptedW - current));
    publishBatteryHeadsStatus(allocation.acceptedW === current
        ? 'Bestaetigte Kopf-Sollwerte gehalten; unveraenderte GS werden nicht erneut geschrieben'
        : 'SoC- und kapazitaetsgewichtete Kopfverteilung angefordert');
}
