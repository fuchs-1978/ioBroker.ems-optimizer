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
    if (batteryHeadsMode())
        configDef(`${r}.Config.BatteryPvFeedbackObservationEnabled`, false, 'boolean', 'switch', '',
            'SunEnergy: ausstehende PV-Laderueckmeldung beobachten und bei PV-Schwankungen warnen');
    if (batteryHeadsMode()) {
        stateDef(`${base}.ReserveRecoveryActive`, false, 'boolean', 'indicator', '', 'Speicher-Nachladung unter Mindest-SoC');
        stateDef(`${r}.Control.BatteryReserveGridCharge_W`, 0, 'number', 'value.power', 'W', 'Freigegebene Speicher-Nachladung');
    }
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

function batteryTargetInDeadband(targetW, deadbandW) {
    return Math.abs(targetW) <= deadbandW && !(targetW < 0
        && (nativeConfig.batteryPvPriorityEnabled === true || nativeConfig.batteryWallboxHalfStepEnabled === true
            || nativeConfig.bhkwWallboxCycleEnabled === true)
        && batteryNumber(getState(`${CFG.root}.Control.BatteryWallboxBuffer_W`)?.val) > 0);
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

const BATTERY_REVERSE_TO_ZERO = 'Richtungswechsel: zuerst Nullbefehl';
const BATTERY_PV_PENDING_TARGET_DROP_W = 200;
const BATTERY_START_ECHO_GRACE_MS = 6000;
const BATTERY_PARTIAL_CHARGE_MIN_SPAN_MS = 3000;
const BATTERY_PARTIAL_CHARGE_MAX_CHANGE_W = 50;
const BATTERY_PARTIAL_CHARGE_RETRY_MS = 60000;
const BATTERY_PARTIAL_CHARGE_PROBE_W = 50;
const BATTERY_PV_OBSERVATION_LOG_INTERVAL_MS = 30000;
const BATTERY_HEADS_HANDOFF_MAX_AGE_MS = 30000;
const BATTERY_HEADS_ZERO_RETURN_SPAN_MS = 10000;
const BATTERY_HEADS_FEEDBACK_TIMEOUT = 'Kopf folgt GS/GP nicht innerhalb der Rueckmeldefrist';
const BATTERY_HEADS_RESTART_RETURN = 'Vorherige Kopf-Ausgangsverantwortung: zuerst bestaetigte Rueckgabe aller Koepfe';
const BATTERY_HEADS_REVERSE_TO_ZERO = 'Richtungswechsel: echte Nullantwort aller Koepfe zuerst';

function batteryWallboxReversing(pending, settings) {
    return pending?.wallboxReversal === true && pending.transportComplete === true
        && Date.now() >= pending.at && Date.now() - pending.at < settings.feedbackTimeoutMs;
}

function batteryRegulationState(forWallbox = false) {
    if (batteryHeadsMode()) return batteryHeadsRegulationState(forWallbox);
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
    const reversing = batteryStopPending && forWallbox && batteryWallboxReversing(batteryPendingCommand, settings);
    if (batteryStopPending && !reversing) return blocked('vorheriger Nullbefehl noch offen');
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
    result.reversing = reversing;
    result.canCharge = !reversing && result.soc < result.maxSoc && result.maxChargeW > 0;
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
    if (commandW > 0 && nativeConfig.par14aAccountingMode !== undefined
        && nativeConfig.par14aAccountingMode !== 'legacyGross') {
        const group = typeof gridGroupCommandCheck === 'function'
            ? gridGroupCommandCheck('Battery', commandW) : {allowed: false, reason: 'Gruppenbilanzpruefung fehlt'};
        if (!group.allowed) {
            write(`${base}.RequestedPower_W`, 0);
            publishBatteryStatus(group.reason);
            return false;
        }
    }
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
    batteryPendingCommand = {generation, commandW, at: batteryLastCommandAt, transportComplete: false,
        wallboxReversal: reason === BATTERY_REVERSE_TO_ZERO && nativeConfig.batteryWallboxHalfStepEnabled === true
            && getState(`${CFG.root}.Control.BatteryWallboxBuffer_W`)?.val > 0};
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
    if (consumption.groupNet) {
        const group = typeof gridGroupDeviceLimit === 'function'
            ? gridGroupDeviceLimit('Battery', consumption) : {valid: false, reason: 'Gruppenbilanzpruefung fehlt'};
        if (!group.valid) return stopBatteryOutput(group.reason);
        if (group.maximumW !== null) targetW = Math.min(targetW, Math.floor(group.maximumW));
    } else if (consumption.budgetW !== null) {
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
    if (batteryTargetInDeadband(targetW, state.deadbandW)) targetW = 0;
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
    if (reverse) return stopBatteryOutput(BATTERY_REVERSE_TO_ZERO);
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
                const echoAt = batteryNumber(saved.unobservedEchoAt);
                if (!parsed || parsed.index !== saved.index || ids.has(parsed.setpointId)
                    || typeof saved.owned !== 'boolean' || [commandW, commandAt, reserved, unobserved, since].some(v => v === null)
                    || Math.abs(commandW) > 2400 || reserved < 0 || reserved > 2400
                    || Math.abs(unobserved) > 2400 || commandAt < 0 || since < 0)
                    throw new Error('ungueltiger Kopfanspruch');
                ids.add(parsed.setpointId);
                if (saved.owned || reserved > 0 || unobserved !== 0 || commandW !== 0) batteryHeadOwners.push({...parsed,
                    owned: true, commandW, commandAt, reservedChargeW: Math.max(reserved, commandW, 0),
                    // An owned ledger with zero unseen debt already records the
                    // previous command as observed. A reserve alone is not debt.
                    unobservedCommandW: saved.owned ? unobserved : unobserved || commandW || reserved,
                    unobservedSince: since || commandAt, pending: null, requirePostWriteZero: true,
                    handoffAt: persisted.ack === true && !persisted.q && saved.owned && unobserved === 0
                        ? batteryNumber(saved.handoffAt) : null,
                    unobservedEchoAt: saved.owned && unobserved !== 0 && echoAt > since
                        && echoAt <= Date.now() ? echoAt : 0});
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
        batteryHeadsFault = BATTERY_HEADS_RESTART_RETURN;
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

function batteryHeadsRegulationState(forWallbox = false) {
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
    const restoring = batteryHeadsFault === BATTERY_HEADS_RESTART_RETURN
        && batteryHeadOwners.some(head => head.owned && head.handoffAt > 0);
    if (batteryHeadsOwnershipFault || batteryHeadsFault && !restoring)
        return blocked(batteryHeadsOwnershipFault || batteryHeadsFault);
    if (!snapshot.valid) return blocked(snapshot.reason);
    if (batteryHeadOwners.some(head => head.owned && !snapshot.topology.heads.some(h => h.setpointId === head.setpointId)))
        return blocked('Frueherer Kopf-Ausgang noch nicht zurueckgegeben');
    const pendingStops = batteryHeadOwners.filter(head => head.pending?.commandW === 0);
    const reversing = pendingStops.length > 0 && forWallbox
        && pendingStops.every(head => batteryWallboxReversing(head.pending, settings));
    if (pendingStops.length > 0 && !reversing) return blocked('Kopf-Nullbefehl noch offen');
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
    result.reversing = reversing;
    result.canCharge = !reversing && charge.valid && charge.acceptedW > 0;
    result.canDischarge = result.minSoc > 0 && discharge.valid && discharge.acceptedW < 0
        && getState(`${r}.Config.BatterySelfConsumptionEnabled`)?.val === true;
    result.available = result.canCharge || result.canDischarge;
    if (restoring) {
        const owned = batteryHeadOwners.filter(head => head.owned);
        const now = Date.now();
        if (!owned.every(head => head.handoffAt >= head.commandAt && head.handoffAt <= now
            && now - head.handoffAt <= BATTERY_HEADS_HANDOFF_MAX_AGE_MS
            && snapshot.heads.some(item => item.setpointId === head.setpointId && item.sourceTs > head.handoffAt))
            || !batteryHeadsHandoffMatches(result, owned))
            return {...result, available: false, canCharge: false, canDischarge: false, reason: BATTERY_HEADS_RESTART_RETURN};
        for (const head of owned) {
            head.handoffAt = null;
            head.settled = true;
            head.lastConfirmedAt = snapshot.heads.find(item => item.setpointId === head.setpointId).sourceTs;
        }
        batteryHeadsFault = '';
        publishBatteryHeadsStatus('SunEnergy-Stellauftrag nach Neustart uebernommen');
    }
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

const BATTERY_RESERVE_RECOVERY_W = 1000;

function batteryReserveRecoveryRequired(state) {
    if (!batteryHeadsMode() || !state.heads?.length || !Number.isFinite(state.minSoc)
        || !Number.isFinite(state.maxSoc)) return null;
    const recovering = getState(`${CFG.root}.Devices.Battery.ReserveRecoveryActive`);
    const margin = recovering?.ack === true && !recovering.q && recovering.val === true ? 2 : 0;
    if (state.heads.some(head => !head.valid || !Number.isFinite(head.minPackSoc))) return null;
    return state.heads.some(head => head.minPackSoc < batteryReserveRecoverySoC(state, head, margin));
}

function batteryReserveRecoverySoC(state, head, margin) {
    return Math.min(Math.max(state.minSoc, head.minSoc) + margin, state.maxSoc, head.maxSoc);
}

function publishBatteryHeadsStatus(reason) {
    const base = `${CFG.root}.Devices.Battery`;
    const owned = batteryHeadOwners.filter(head => head.owned);
    const sum = key => owned.reduce((value, head) => value + head[key], 0);
    const claim = {version: 1, heads: owned.map(head => ({index: head.index, setpointId: head.setpointId,
        owned: true, commandW: head.commandW, commandAt: head.commandAt,
        reservedChargeW: head.reservedChargeW, unobservedCommandW: head.unobservedCommandW,
        unobservedSince: head.unobservedSince,
        ...(head.handoffAt > 0 ? {handoffAt: head.handoffAt} : {}),
        ...(head.unobservedCommandW !== 0 && head.unobservedEchoAt
            ? {unobservedEchoAt: head.unobservedEchoAt} : {})}))};
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

function observeBatteryHeadZeroReturn(head, actual, settings) {
    const pending = head.pending;
    if (head.commandW !== 0 || head.unobservedCommandW === 0 || pending?.transportComplete !== true
        || !actual.valid || !settings.valid || actual.sourceTs <= pending.completedAt
        || actual.gsW !== 0 || Math.abs(actual.acPowerW) > settings.toleranceW) {
        if (head.zeroReturn && pending?.commandW === 0 && actual.valid && (actual.gsW !== 0 || Math.abs(actual.acPowerW) > settings.toleranceW))
            pending.retryZero = true;
        head.zeroReturn = null;
        return false;
    }
    const topology = batteryHeadsMode() ? sunEnergyHeads.readTopology(nativeConfig) : null;
    const online = getState(`${head.baseId}.info.online`);
    if (!topology?.valid || !topology.heads.some(item => item.setpointId === head.setpointId)
        || online?.ack !== true || online.q || online.val !== true) {
        head.zeroReturn = null;
        return false;
    }
    if (!head.zeroReturn || actual.sourceTs - head.zeroReturn.lastAt > settings.measurementAgeMs)
        head.zeroReturn = {firstAt: actual.sourceTs, lastAt: 0, samples: 0};
    const proof = head.zeroReturn;
    if (actual.sourceTs <= proof.lastAt) return false;
    proof.lastAt = actual.sourceTs;
    proof.samples++;
    return proof.samples >= 3 && proof.lastAt - proof.firstAt >= BATTERY_HEADS_ZERO_RETURN_SPAN_MS;
}

function observeBatteryHeadReversalStop(head, actual, settings) {
    const pending = head.pending;
    const reversal = pending?.reversalStop;
    if (!reversal || head.unobservedCommandW === 0 || !pending.transportComplete) return false;
    const online = getState(`${head.baseId}.info.online`);
    if (!actual.valid || !settings.valid || online?.ack !== true || online.q || online.val !== true
        || actual.sourceTs <= pending.completedAt) {
        reversal.rampAt = 0;
        return false;
    }
    const ack = getState(head.setpointId);
    if (actual.gsW !== 0 || ack?.ack !== true || ack.q || ack.val !== 0
        || ack.from !== `system.adapter.${head.baseId.split('.heads.')[0]}`
        || !(ack.ts > pending.completedAt && ack.ts <= actual.sourceTs)) {
        if (reversal.rampAt && actual.gsW !== 0) pending.retryZero = true;
        reversal.rampAt = 0;
        return false;
    }
    // A driver-confirmed zero followed by same-direction rundown shows the
    // zero reached the head even if the final nonzero GS echo was skipped.
    const powerW = Math.abs(actual.acPowerW);
    if (powerW > settings.toleranceW) {
        if (actual.sourceTs === reversal.rampAt) return false;
        if (Math.sign(actual.acPowerW) !== Math.sign(head.unobservedCommandW)
            || powerW >= reversal.powerW) {
            if (reversal.rampAt && powerW > reversal.powerW) pending.retryZero = true;
            reversal.rampAt = 0;
            return false;
        }
        reversal.rampAt = actual.sourceTs;
        reversal.powerW = powerW;
        return false;
    }
    return reversal.rampAt > pending.completedAt && actual.sourceTs > reversal.rampAt
        && actual.sourceTs - reversal.rampAt <= settings.measurementAgeMs;
}

function batteryHeadAtDischargeCeiling(head, actual) {
    // At the effective discharge ceiling, a confirmed GS can yield slightly
    // less AC power. Only allow a shortfall, never overshoot or wrong direction.
    const ceilingW = Math.floor(Math.min(actual.maxDischargeW, head.maxDischargeW,
        batterySetting('BatteryMaxDischarge_W', 2400)));
    const requestedW = -head.commandW;
    return requestedW > 0 && requestedW === ceilingW && actual.acPowerW < 0
        && actual.acPowerW > head.commandW && actual.acPowerW <= -requestedW * 0.98;
}

function observeBatteryHeads() {
    const settings = batteryTimingSettings();
    for (const head of batteryHeadOwners.filter(owner => owner.owned)) {
        const actual = batteryHeadOwnerSnapshot(head);
        const zeroReturn = observeBatteryHeadZeroReturn(head, actual, settings);
        const reversalReturn = observeBatteryHeadReversalStop(head, actual, settings);
        if (!actual.valid || !settings.valid) {
            head.partialCharge = null;
            continue;
        }
        if (!head.pending && !(head.handoffAt > 0) && actual.sourceTs > head.commandAt && actual.gsW !== -head.commandW)
            batteryHeadsFault = `Kopf ${head.index}: bestaetigter GS-Wert weicht ohne offenen EMS-Auftrag ab; Reglerzustaendigkeit pruefen`;
        const stoppedCommand = head.pending?.stoppedCommand;
        const lateEcho = stoppedCommand && stoppedCommand.generation === head.unobservedGeneration
            && actual.sourceTs > stoppedCommand.completedAt
            && actual.acPowerW * head.unobservedCommandW >= 0;
        // A matching GS proves delivery even while AC power is still ramping.
        // Retain the peak until the newer command's physical response settles.
        if (head.unobservedCommandW !== 0 && actual.sourceTs > head.unobservedSince
            && actual.gsW === -head.unobservedCommandW
            && (head.pending?.commandW === head.unobservedCommandW && head.pending.transportComplete === true
                && actual.sourceTs > head.pending.completedAt || lateEcho))
            head.unobservedEchoAt ||= actual.sourceTs;
        const pending = head.pending;
        const delivered = pending ? pending.transportComplete === true : head.lastConfirmedAt > 0;
        const freshAfterWrite = actual.sourceTs > (pending?.completedAt ?? head.commandAt);
        const matchingPower = Math.abs(actual.acPowerW - head.commandW) <= settings.toleranceW;
        const matchingCeiling = delivered && freshAfterWrite && batteryHeadAtDischargeCeiling(head, actual);
        const ceilingResponse = head.commandW < 0 && head.commandW === head.unobservedCommandW
            && matchingCeiling;
        const physicalResponse = Math.sign(actual.acPowerW) === Math.sign(head.unobservedCommandW)
            && (Math.abs(actual.acPowerW) >= Math.max(1, Math.abs(head.unobservedCommandW) - settings.toleranceW)
                || ceilingResponse);
        if (head.unobservedCommandW !== 0 && actual.sourceTs > head.unobservedSince
            && actual.gsW === -head.unobservedCommandW && (physicalResponse || lateEcho)) {
            if (lateEcho) head.requirePostWriteZero = true;
            head.unobservedCommandW = 0;
            head.unobservedSince = 0;
            head.unobservedGeneration = undefined;
            head.unobservedEchoAt = 0;
        }
        const echoed = actual.sourceTs > head.commandAt && actual.gsW === -head.commandW;
        const matching = echoed && (matchingPower || matchingCeiling);
        if (delivered && echoed && freshAfterWrite && head.commandW > 0 && !matching
            && actual.acPowerW > settings.deadbandW && actual.acPowerW < head.commandW) {
            const previous = head.partialCharge;
            if (!previous || actual.sourceTs > previous.at) {
                const stable = previous
                    && Math.abs(actual.acPowerW - previous.anchorW) <= BATTERY_PARTIAL_CHARGE_MAX_CHANGE_W;
                head.partialCharge = {at: actual.sourceTs, watts: actual.acPowerW,
                    since: stable ? previous.since : actual.sourceTs,
                    anchorW: stable ? previous.anchorW : actual.acPowerW};
            }
        } else head.partialCharge = null;
        const needsPostWriteZero = head.commandW === 0 && (head.requirePostWriteZero || head.unobservedEchoAt > 0);
        const settled = matching && delivered
            && (!needsPostWriteZero || actual.sourceTs > pending?.completedAt);
        if (settled && head.commandW === 0 && (reversalReturn || zeroReturn || head.unobservedEchoAt > head.unobservedSince
            && actual.sourceTs > head.unobservedEchoAt)) {
            if (reversalReturn && typeof log === 'function')
                log(`SunEnergy Kopf ${head.index}: Richtungswechsel nach bestaetigtem Nullbefehl und AC-Stillstand freigegeben`, 'info');
            else if (zeroReturn && typeof log === 'function')
                log(`SunEnergy Kopf ${head.index}: Altauftrag ${head.unobservedCommandW} W nach ${head.zeroReturn.samples} frischen Nullrueckmeldungen automatisch freigegeben`, 'info');
            head.zeroReturn = null;
            head.unobservedCommandW = 0;
            head.unobservedSince = 0;
            head.unobservedGeneration = undefined;
            head.unobservedEchoAt = 0;
        }
        head.settled = settled && head.unobservedCommandW === 0;
        head.responseLostSince = head.settled ? 0 : head.responseLostSince || Date.now();
        write(`${CFG.root}.Devices.Battery.Heads.${head.index}.ActuatorSettled`, Boolean(settled));
        if (settled && head.unobservedCommandW === 0) {
            if (head.pending) head.lastConfirmedAt = actual.sourceTs;
            if (head.chargeLimit && (head.pending?.limitedCharge || head.commandW > head.chargeLimit.watts)) {
                head.chargeLimit.watts = Math.max(head.chargeLimit.watts, head.commandW);
                head.chargeLimit.probeAt = Date.now() + BATTERY_PARTIAL_CHARGE_RETRY_MS;
            }
            head.reservedChargeW = Math.max(0, head.commandW);
            if (head.commandW === 0) {
                head.owned = false;
                head.requirePostWriteZero = false;
            }
            head.pending = null;
        }
    }
}

function confirmBatteryHeadsPhysicalStop() {
    const base = `${CFG.root}.Devices.Battery`, source = getState(`${base}.ConfirmPhysicalStop`);
    if (source?.val !== true) return false;
    write(`${base}.ConfirmPhysicalStop`, false);
    const owned = batteryHeadOwners.filter(head => head.owned), timing = batteryTimingSettings();
    const globalDisabled = nativeConfig.globalWriteEnabled === false
        && getState(`${CFG.root}.System.RealOutputsEnabled`)?.val === false;
    const batteryDisabled = nativeConfig.batteryControlEnabled === false
        && getState(`${base}.ControlEnabled`)?.val === false;
    const allowed = source.ack === false && Number(source.ts) <= Date.now() + 1000
        && (globalDisabled || batteryDisabled) && !batteryHeadsOwnershipFault
        && timing.valid && owned.length > 0 && owned.every(head => {
            const proof = batteryHeadOwnerSnapshot(head);
            return head.commandW === 0 && head.pending?.transportComplete === true
                && Number(source.ts) > head.pending.at && proof.valid && proof.sourceTs > head.pending.at
                && proof.gsW === 0 && Math.abs(proof.acPowerW) <= timing.toleranceW;
        });
    if (!allowed) {
        publishBatteryHeadsStatus('Manuelle Rueckgabe abgelehnt: Speichersteuerung oder globale Ausgabe AUS sowie Nullschreiben und frische GS/GP-Nullantwort jedes Kopfes erforderlich');
        return false;
    }
    for (const head of owned) {
        ++head.generation;
        head.owned = false; head.pending = null; head.reservedChargeW = 0;
        head.requirePostWriteZero = false;
        head.unobservedCommandW = 0; head.unobservedSince = 0; head.unobservedEchoAt = 0;
    }
    batteryHeadsFault = '';
    publishBatteryHeadsStatus('Benutzer bestaetigt unabhaengig Stillstand und Ausschluss alter Stellauftraege je Kopf');
    return true;
}

function batteryHeadCommandEchoed(head, snapshot = batteryHeadOwnerSnapshot(head)) {
    const pending = head.pending;
    return head.commandW !== 0 && pending?.commandW === head.commandW && pending.transportComplete
        && snapshot.valid && snapshot.sourceTs > Math.max(head.commandAt, pending.completedAt)
        && snapshot.gsW === -head.commandW && snapshot.acPowerW * head.commandW >= 0;
}

function sendBatteryHeadCommand(head, commandW, reason, {limitedCharge = false, orderedReduction = false} = {}) {
    if (commandW !== 0 && !limitedCharge && !orderedReduction && (head.pending || head.unobservedCommandW !== 0))
        return sendBatteryHeadCommand(head, 0, 'Unbestaetigter Nichtnullauftrag: weiterer Auftrag durch Null ersetzt');
    if (commandW > 0 && nativeConfig.par14aAccountingMode !== undefined
        && nativeConfig.par14aAccountingMode !== 'legacyGross') {
        // The new head must share the same whole-battery allowance with all
        // other heads. Existing per-head high waters remain in the snapshot.
        const groupChargeW = batteryHeadOwners.reduce((sum, peer) => sum
            + Math.max(0, peer === head ? commandW : peer.owned ? peer.commandW : 0), 0);
        const group = typeof gridGroupCommandCheck === 'function'
            ? gridGroupCommandCheck('Battery', groupChargeW) : {allowed: false, reason: 'Gruppenbilanzpruefung fehlt'};
        if (!group.allowed) {
            publishBatteryHeadsStatus(group.reason);
            return false;
        }
    }
    const generation = ++batteryHeadsGeneration;
    const previousCommandW = head.commandW;
    const previousWriteAt = Math.max(head.commandAt, head.pending?.completedAt || 0);
    const previousUnobserved = head.unobservedCommandW;
    const previousUnobservedSince = head.unobservedSince;
    const previousUnobservedGeneration = head.unobservedGeneration;
    const previousUnobservedEchoAt = head.unobservedEchoAt;
    // Preserve an in-memory delivery receipt while waiting for a late echo.
    const previousPending = head.pending;
    const stoppedCommand = commandW === 0 && (previousPending?.stoppedCommand
        || (previousCommandW !== 0 && previousPending?.transportComplete === true
            && previousPending.generation === previousUnobservedGeneration
            ? {generation: previousPending.generation, completedAt: previousPending.completedAt} : null));
    const reversalSnapshot = reason === BATTERY_HEADS_REVERSE_TO_ZERO && stoppedCommand
        ? batteryHeadOwnerSnapshot(head) : null;
    const reversalStop = reversalSnapshot?.valid
        && Math.sign(-reversalSnapshot.gsW) === Math.sign(previousCommandW)
        && Math.sign(reversalSnapshot.acPowerW) === Math.sign(previousCommandW)
        ? {rampAt: 0, powerW: Math.abs(reversalSnapshot.acPowerW)} : null;
    head.owned = true; head.commandW = commandW; head.commandAt = Date.now(); head.generation = generation;
    head.handoffAt = null;
    head.zeroReturn = null;
    if (commandW <= 0) head.chargeLimit = null;
    if (orderedReduction && commandW === 0) head.requirePostWriteZero = true;
    if (limitedCharge) head.chargeLimit = {watts: Math.floor(head.partialCharge.watts), probeAt: Infinity};
    head.partialCharge = null;
    if (limitedCharge || orderedReduction || commandW !== 0 && Math.abs(commandW) >= Math.abs(head.unobservedCommandW)) {
        head.unobservedCommandW = commandW;
        head.unobservedSince = commandW === 0 ? 0 : head.commandAt;
        head.unobservedGeneration = commandW === 0 ? undefined : generation;
        head.unobservedEchoAt = 0;
    }
    // The confirmed GS echo orders the reduction after the old command.
    // Its full reserve remains until GS and GP confirm the lower command.
    head.reservedChargeW = Math.max(head.reservedChargeW, commandW, 0);
    head.settled = false; head.responseLostSince = 0;
    head.pending = {generation, commandW, previousCommandW, at: head.commandAt, transportComplete: false,
        limitedCharge, orderedReduction, previousWriteAt, stoppedCommand, reversalStop,
        wallboxReversal: reason === BATTERY_HEADS_REVERSE_TO_ZERO && nativeConfig.batteryWallboxHalfStepEnabled === true
            && getState(`${CFG.root}.Control.BatteryWallboxBuffer_W`)?.val > 0};
    // Transport awaits these durable writes before accepting a nonzero GS.
    publishBatteryHeadsStatus(reason);
    const completed = (error, receipt) => {
        if (error && receipt?.notDispatched === true && head.owned && head.unobservedGeneration === generation) {
            // A queued zero can supersede this command before its callback.
            // Remove only its unsent claim; keep the peak through zero proof.
            head.unobservedCommandW = previousUnobserved;
            head.unobservedSince = previousUnobservedSince;
            head.unobservedGeneration = previousUnobservedGeneration;
            head.unobservedEchoAt = previousUnobservedEchoAt;
            head.requirePostWriteZero = true;
            if (head.generation !== generation) return;
            head.pending = null;
            stopBatteryHeadsOutput(`Kopf ${head.index}: Stellauftrag vor Ausgabe verworfen`);
            return;
        }
        if (head.generation !== generation || !head.pending) return;
        if (error) {
            head.pending = null;
            batteryHeadsFault = `Kopf ${head.index}: Ausgangsschreibfehler ${String(error.message || error)}`;
            publishBatteryHeadsStatus(`${batteryHeadsFault}; Nullbefehl erforderlich, Reserve bleibt`);
        } else {
            head.pending.transportComplete = true;
            head.pending.completedAt = Date.now();
        }
    };
    let accepted;
    try { accepted = writeForeignState(head.setpointId, commandW === 0 ? 0 : -commandW, completed); }
    catch (error) { completed(error); return false; }
    if (!accepted) completed(new Error('Schreibschutz blockiert Ausgang'), {notDispatched: true});
    return accepted;
}

function batteryHeadsHandoffMatches(state, owned) {
    const direction = Math.sign(owned[0]?.commandW);
    if (direction === 0 || (direction > 0 ? !state.canCharge : !state.canDischarge)) return false;
    const totalW = owned.reduce((sum, head) => sum + head.commandW, 0);
    if (Math.abs(totalW) > (direction > 0 ? state.maxChargeW : state.maxDischargeW)) return false;
    const snapshots = batteryHeadsLimitedSnapshots(state);
    const options = batteryHeadsAllocationOptions(state);
    return owned.every(head => {
        if (Math.sign(head.commandW) !== direction || head.unobservedCommandW !== 0) return false;
        const snapshot = snapshots.find(item => item.setpointId === head.setpointId);
        if (!snapshot || snapshot.sourceTs <= head.commandAt || snapshot.gsW !== -head.commandW
            || (Math.abs(snapshot.acPowerW - head.commandW) > state.toleranceW
                && !batteryHeadAtDischargeCeiling(head, snapshot))) return false;
        const allocation = sunEnergyHeads.allocate(head.commandW, [snapshot], options);
        return allocation.valid && allocation.acceptedW === head.commandW;
    });
}

function prepareBatteryHeadsRestartHandoff() {
    initializeBatteryHeadsOwnership();
    if (!batteryHeadsMode() || batteryHeadsOwnershipFault || batteryHeadsFault) return false;
    observeBatteryHeads();
    const owned = batteryHeadOwners.filter(head => head.owned);
    if (!owned.length || owned.some(head => head.pending || !head.settled)) return false;
    const state = batteryHeadsRegulationState();
    if (!state.eligible || !batteryHeadsHandoffMatches(state, owned)) return false;
    const budget = batteryHeadsBudget(state);
    const totalW = owned.reduce((sum, head) => sum + head.commandW, 0);
    if (!budget.valid || Math.sign(totalW) !== Math.sign(budget.targetW)
        || Math.abs(totalW) > Math.abs(budget.targetW)) return false;
    const now = Date.now();
    for (const head of owned) head.handoffAt = now;
    publishBatteryHeadsStatus('SunEnergy-Stellauftrag fuer Neustart gespeichert');
    return true;
}

function canWaitForBatteryDischargeEcho(state, budget, head) {
    if (!budget.valid || !state.canDischarge || !head?.pending?.transportComplete || head.commandW >= 0
        || head.unobservedCommandW !== head.commandW || head.unobservedEchoAt
        || Date.now() - head.pending.completedAt >= BATTERY_START_ECHO_GRACE_MS
        || Date.now() - head.pending.at >= state.feedbackTimeoutMs) return false;
    const headSnapshot = state.heads[0];
    if (state.heads.length !== 1 || headSnapshot.gsW === -head.commandW
        || state.actualW > state.toleranceW) return false;
    const grid = realtimeGridMeasurement();
    if (!grid.valid || grid.held || grid.gridW < -state.deadbandW) return false;
    const allocation = sunEnergyHeads.allocate(head.commandW, batteryHeadsLimitedSnapshots(state),
        batteryHeadsAllocationOptions(state));
    return allocation.valid && allocation.acceptedW === head.commandW;
}

function batteryDischargeReduction(state, budget, snapshot, previousWriteAt) {
    const grid = realtimeGridMeasurement();
    if (state.heads.length !== 1 || !grid.valid || grid.held) return {watts: 0};
    if (!budget.householdDischarge) return {watts: grid.gridW >= -state.deadbandW ? -budget.targetW : 0};
    if (!grid.sourceTs?.every(ts => ts > previousWriteAt)) return {watts: 0};
    // Remove the measured battery discharge from the net reading. Even during
    // export, some household deficit may remain after reducing the battery.
    const deficitW = Math.floor(grid.gridW - snapshot.acPowerW);
    const watts = Math.min(-budget.targetW, deficitW);
    if (watts <= state.deadbandW) return {watts: 0};
    // An earlier net reading may still describe a different AC output.
    return grid.sourceTs.some(ts => ts < snapshot.sourceTs) ? {watts: 0, awaitingGrid: true} : {watts};
}

function batteryHasUnconfirmedWriteOnRestart() {
    if (!batteryHeadsMode() || batteryHeadsOwnershipFault || batteryHeadsFault
        || getState(`${CFG.root}.System.RealOutputsEnabled`)?.val !== true
        || getState(`${CFG.root}.Devices.Battery.ControlEnabled`)?.val !== true) return false;
    observeBatteryHeads();
    const owned = batteryHeadOwners.filter(head => head.owned);
    if (!owned.length || !owned.some(head => head.commandW !== 0 && head.pending?.commandW === head.commandW
        && head.unobservedCommandW !== 0 && !head.unobservedEchoAt)) return false;
    const state = batteryHeadsRegulationState();
    if (!state.eligible) return false;
    const budget = batteryHeadsBudget(state);
    if (owned.length === 1 && owned[0].commandW < 0)
        return canWaitForBatteryDischargeEcho(state, budget, owned[0]);
    if (!state.canCharge || owned.some(head => head.commandW <= 0)) return false;
    const reservedW = owned.reduce((sum, head) => sum + head.reservedChargeW, 0);
    const allocation = sunEnergyHeads.allocate(reservedW, batteryHeadsLimitedSnapshots(state),
        batteryHeadsAllocationOptions(state));
    return budget.valid && reservedW <= budget.hardChargeLimitW && allocation.valid
        && allocation.acceptedW === reservedW;
}

function stopBatteryHeadsOutput(reason = 'Mehrkopfregelung wird beendet') {
    initializeBatteryHeadsOwnership();
    observeBatteryHeads();
    const base = `${CFG.root}.Devices.Battery`, timing = batteryTimingSettings();
    write(`${base}.RegulationAvailable`, false); write(`${base}.CanCharge`, false); write(`${base}.CanDischarge`, false);
    if (batteryHeadsOwnershipFault) return publishBatteryHeadsStatus(batteryHeadsOwnershipFault);
    for (const head of batteryHeadOwners.filter(owner => owner.owned)) {
        if (head.pending?.commandW === 0 && !head.pending.retryZero
            && (Date.now() - head.pending.at < timing.feedbackTimeoutMs
                || head.zeroReturn && Date.now() - head.zeroReturn.lastAt <= timing.measurementAgeMs)) continue;
        // Zero can retire an older command only if its GS was already observed.
        const orderedReduction = batteryHeadCommandEchoed(head);
        sendBatteryHeadCommand(head, 0, reason, {orderedReduction});
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
    const reserve = getState(`${r}.Control.BatteryReserveGridCharge_W`);
    const recovery = reserve?.val > 0;
    if (recovery) {
        const grid = realtimeGridMeasurement();
        if (reserve.ack !== true || reserve.q || raw <= 0 || !grid.valid || grid.held
            || batteryReserveRecoveryRequired(state) !== true)
            return fail('Speicher-Nachladefreigabe entfallen');
    }
    const priceSafe = typeof batteryPriceSafeTarget === 'function' ? batteryPriceSafeTarget(raw) : raw;
    const chargeLimitW = state.canCharge ? state.maxChargeW : 0;
    let targetW = Math.round(Math.max(state.canDischarge ? -state.maxDischargeW : 0,
        Math.min(chargeLimitW, recovery ? Math.min(priceSafe, reserve.val, BATTERY_RESERVE_RECOVERY_W) : priceSafe)));
    const houseCap = batteryHouseConnectionCapW(state.actualW);
    if (houseCap === null) return fail('Hausanschlussmessung oder gemeinsame Phasenreserve ungueltig');
    let hardChargeLimitW = Math.min(chargeLimitW, houseCap);
    if (typeof currentConsumptionLimit !== 'function') return fail('gemeinsame Netzbetreibergrenze nicht verfuegbar');
    const limit = currentConsumptionLimit();
    if (!limit.valid) return fail(limit.reason || 'Netzbetreibergrenze ungueltig');
    if (targetW < 0 && typeof bhkwWallboxCycle === 'object' && bhkwWallboxCycle?.granted) {
        const cycle = bhkwWallboxCycleBacking(bhkwWallboxCycle.at, state, limit);
        targetW = cycle ? Math.max(targetW, -cycle.dischargeW) : 0;
    }
    if (limit.groupNet) {
        const group = typeof gridGroupDeviceLimit === 'function'
            ? gridGroupDeviceLimit('Battery', limit) : {valid: false, reason: 'Gruppenbilanzpruefung fehlt'};
        if (!group.valid) return fail(group.reason);
        if (group.maximumW !== null) hardChargeLimitW = Math.min(hardChargeLimitW, Math.floor(group.maximumW));
    } else if (limit.budgetW !== null) {
        const budgetW = batteryNumber(limit.budgetW);
        const loads = typeof coordinatedConsumptionLoads === 'function' ? coordinatedConsumptionLoads() : null;
        const peers = loads ? [loads.dhwW, loads.heatingW, loads.wallboxW] : [];
        if (budgetW === null || budgetW < 0 || !loads || loads.valid === false
            || peers.some(value => batteryNumber(value) === null || Number(value) < 0))
            return fail('gemeinsames Verbraucherbudget oder Restlasten ungueltig');
        hardChargeLimitW = Math.min(hardChargeLimitW,
            Math.floor(Math.max(0, budgetW - peers.reduce((sum, value) => sum + Number(value), 0))));
    }
    targetW = Math.min(targetW, hardChargeLimitW);
    return {valid: true, targetW: batteryTargetInDeadband(targetW, state.deadbandW) ? 0 : targetW,
        rawTargetW: raw, hardChargeLimitW, recovery,
        householdDischarge: targetW < 0 && !(Number(getState(`${r}.Control.BatteryWallboxBuffer_W`)?.val) > 0),
        pvChargeTarget: !recovery && priceSafe === raw && !(Number(getState(`${r}.Control.BatteryPriceGridCharge_W`)?.val) > 0),
        ...(limit.groupNet ? {groupNet: true} : {})};
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
    if (budget.groupNet && commandW > 0) {
        const groupChargeW = all.reduce((total, head) => total + Math.max(0, head.commandW), 0);
        const group = typeof gridGroupCommandCheck === 'function'
            ? gridGroupCommandCheck('Battery', groupChargeW) : {allowed: false, reason: 'Gruppenbilanzpruefung fehlt'};
        if (!group.allowed) return fail(group.reason);
    }
    const snapshot = batteryHeadsLimitedSnapshots(state).find(head => head.setpointId === id);
    if (budget.recovery && snapshot?.minPackSoc >= batteryReserveRecoverySoC(state, snapshot, 2))
        return fail('Kopf hat Nachladeziel erreicht');
    if ((owner.pending.limitedCharge || owner.pending.orderedReduction)
        && (!snapshot?.valid || snapshot.gsW !== -owner.pending.previousCommandW
            || snapshot.sourceTs <= owner.pending.previousWriteAt
            || snapshot.acPowerW * commandW < 0 || owner.pending.limitedCharge && snapshot.acPowerW <= state.deadbandW
            || !(commandW > 0 ? budget.pvChargeTarget : reduction && -commandW <= batteryDischargeReduction(
                state, budget, snapshot, owner.pending.previousWriteAt).watts)))
        return fail('Rueckmeldung oder Freigabe des vorherigen Kopfauftrags hat sich vor der Korrektur geaendert');
    const capacity = sunEnergyHeads.allocate(commandW, [snapshot], batteryHeadsAllocationOptions(state));
    if (!capacity.valid || capacity.acceptedW !== commandW) return fail('Kopfgrenze oder SoC-Reserve geaendert');
    return {allowed: true, reason: 'Frischer Kopfauftrag innerhalb Gesamtbudget und Schutzgrenzen'};
}

function observePendingSunEnergyPvCharge(state, budget, owned, reason) {
    if (getState(`${CFG.root}.Config.BatteryPvFeedbackObservationEnabled`)?.val !== true
        || state.heads.length !== 1 || owned.length !== 1 || !budget.pvChargeTarget
        || budget.rawTargetW < 0 || !state.canCharge) return false;
    const head = owned[0];
    if (head.commandW <= 0 || head.settled || head.pending && !head.pending.transportComplete
        || Math.max(head.reservedChargeW, state.actualW) > budget.hardChargeLimitW) return false;
    const allocation = sunEnergyHeads.allocate(head.reservedChargeW,
        batteryHeadsLimitedSnapshots(state), batteryHeadsAllocationOptions(state));
    if (!allocation.valid || allocation.acceptedW !== head.reservedChargeW) return false;
    const grid = realtimeGridMeasurement();
    // A changing PV budget is an observation during this test. Keep only
    // the existing charge and its reservation; never send another unseen GS.
    if (!grid.valid || grid.held || state.actualW < 0) return false;
    const now = Date.now();
    if (head.observationLoggedAt === undefined || now - head.observationLoggedAt >= BATTERY_PV_OBSERVATION_LOG_INTERVAL_MS) {
        head.observationLoggedAt = now;
        const ageS = Math.round((now - head.commandAt) / 1000);
        log(`SunEnergy Beobachtung Kopf ${head.index}: ${reason}; Auftrag ${head.commandW} W seit ${ageS} s; GS ${state.heads[0].gsW} W; AC-Ladung ${state.actualW} W; PV-Ziel ${budget.targetW} W; Netz ${Math.round(grid.gridW)} W (+Bezug); Reserve ${head.reservedChargeW} W`, 'warn');
    }
    publishBatteryHeadsStatus(`SunEnergy Beobachtung: ${reason}; laufender PV-Ladeauftrag bleibt aktiv`);
    return true;
}

function updateBatteryHeadsOutput() {
    initializeBatteryHeadsOwnership();
    observeBatteryHeads();
    confirmBatteryHeadsPhysicalStop();
    const base = `${CFG.root}.Devices.Battery`;
    const owned = batteryHeadOwners.filter(head => head.owned);
    if (!owned.length && [BATTERY_HEADS_RESTART_RETURN, BATTERY_HEADS_FEEDBACK_TIMEOUT].includes(batteryHeadsFault)) {
        batteryHeadsFault = '';
        publishBatteryHeadsStatus('Kopf-Rueckgabe bestaetigt; Regler wieder bereit');
    }
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
    const head = owned[0], pending = head?.pending;
    const snapshot = state.heads[0];
    const canAwaitStartEcho = state.heads.length === 1 && owned.length === 1
        && budget.pvChargeTarget && budget.rawTargetW >= 0
        && pending?.previousCommandW === 0 && pending.commandW > 0
        && pending.commandW > budget.targetW && pending.transportComplete === true
        && Date.now() - pending.completedAt < BATTERY_START_ECHO_GRACE_MS
        && Date.now() - pending.at < state.feedbackTimeoutMs
        && snapshot.gsW === 0 && Math.abs(snapshot.acPowerW) <= state.toleranceW;
    // A command from idle may have reached the head between polls. Leave it
    // time to echo before following a lower PV target, only inside hard limits.
    if (canAwaitStartEcho) {
        const safeStart = sunEnergyHeads.allocate(pending.commandW,
            batteryHeadsLimitedSnapshots(state), batteryHeadsAllocationOptions(state));
        if (safeStart.valid && safeStart.acceptedW === pending.commandW
            && head.reservedChargeW <= budget.hardChargeLimitW)
            return publishBatteryHeadsStatus('PV-Sollwert gesunken: warte kurz auf GS-Bestaetigung des Ladestarts');
    }
    if (owned.length === 1 && head.commandW < budget.targetW && canWaitForBatteryDischargeEcho(state, budget, head))
        return publishBatteryHeadsStatus('Entlade-Sollwert gesunken: warte kurz auf GS-Bestaetigung');
    if (budget.targetW === 0) {
        if (observePendingSunEnergyPvCharge(state, budget, owned, 'PV-Ziel null bei offener Rueckmeldung')) return;
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
        return stopBatteryHeadsOutput(BATTERY_HEADS_REVERSE_TO_ZERO);
    const reduction = Math.abs(budget.targetW) < Math.abs(current);
    const singlePvCharge = state.heads.length === 1 && budget.pvChargeTarget && budget.targetW > 0;
    const rampBaseW = singlePvCharge && current > 0 ? Math.min(current, Math.max(0, state.actualW)) : Math.abs(current);
    const ramp = reduction ? Math.abs(budget.targetW)
        : Math.min(Math.abs(budget.targetW), Math.max(Math.abs(current), rampBaseW + state.stepW));
    const chargeLimit = singlePvCharge ? owned[0]?.chargeLimit : null;
    const probeW = chargeLimit && Date.now() >= chargeLimit.probeAt ? BATTERY_PARTIAL_CHARGE_PROBE_W : 0;
    let correctedChargeW = null;
    if (singlePvCharge && head?.settled && state.actualW > 0
        && getState(`${CFG.root}.Config.BatteryPvFeedbackObservationEnabled`)?.val === true) {
        const grid = realtimeGridMeasurement();
        const lastFeedbackAt = head.lastConfirmedAt;
        // A reading from before the last confirmed response can contain the
        // error that the previous step already corrected.
        if (grid.valid && !grid.held && grid.sourceTs?.every(ts => ts >= lastFeedbackAt)) {
            const targetGridW = batteryNumber(getState(`${CFG.root}.Control.TargetGridPower_W`)?.val) ?? 0;
            const errorW = Math.round(targetGridW - grid.gridW);
            const correctionW = Math.max(-state.stepW, Math.min(state.stepW, errorW));
            const measuredBudgetW = errorW > 0 ? Math.floor(state.actualW + Math.min(state.stepW, errorW)) : Infinity;
            correctedChargeW = Math.min(budget.targetW, measuredBudgetW, Math.max(1, current + correctionW));
        } else {
            correctedChargeW = Math.min(current, budget.targetW);
        }
    }
    // The learned ceiling limits increases. It must not undo a probe that
    // has already been sent and is still within the current power budget.
    const requestedW = correctedChargeW ?? (chargeLimit ? Math.min(ramp, Math.max(current, chargeLimit.watts + probeW))
        : Math.sign(budget.targetW) * ramp);
    const snapshots = batteryHeadsLimitedSnapshots(state);
    if (budget.recovery) {
        for (const item of snapshots)
            if (item.minPackSoc >= batteryReserveRecoverySoC(state, item, 2)) item.maxChargeW = 0;
    }
    const allocation = sunEnergyHeads.allocate(requestedW, snapshots, batteryHeadsAllocationOptions(state));
    write(`${base}.HeadAllocation_JSON`, JSON.stringify(allocation));
    if (!allocation.valid) return stopBatteryHeadsOutput(allocation.reason);
    const pvDropW = current - budget.targetW;
    if (correctedChargeW === null && state.heads.length === 1 && budget.pvChargeTarget && budget.targetW > 0
        && pvDropW > 0 && pvDropW <= state.toleranceW && owned[0]?.settled
        && state.actualW <= budget.targetW + state.toleranceW
        && current <= Math.min(budget.hardChargeLimitW, allocation.commands[0].limitW))
        return publishBatteryHeadsStatus('PV-Sollwert innerhalb der Messtoleranz; Ladeauftrag gehalten');
    const needsReduction = allocation.commands.some(desired => {
        const descriptor = state.topology.heads.find(head => head.index === desired.index);
        const owner = owned.find(head => head.setpointId === descriptor.setpointId);
        return owner && Math.abs(desired.internalW) < Math.abs(owner.commandW);
    });
    // Standard /write calls can overlap after ioBroker accepts their States.
    // An unseen nonzero request needs a zero before any correction. A fresh
    // GS echo orders a smaller same-direction command even while GP ramps.
    const partial = head?.partialCharge;
    const now = Date.now();
    const timedOut = pending ? now - pending.at >= state.feedbackTimeoutMs
        : head?.responseLostSince > 0 && now - head.responseLostSince >= state.feedbackTimeoutMs;
    const pendingReduction = needsReduction && owned.some(head => head.pending || head.unobservedCommandW !== 0);
    // A fresh matching GS echo orders the correction after the old request.
    // Retain the old peak until the new GS and physical GP both confirm it.
    if (state.heads.length === 1 && budget.pvChargeTarget && (timedOut || pendingReduction)
        && partial && partial.at - partial.since >= BATTERY_PARTIAL_CHARGE_MIN_SPAN_MS
        && now - partial.at <= Math.min(state.measurementAgeMs, state.feedbackTimeoutMs)
        && current <= Math.min(budget.hardChargeLimitW, allocation.commands[0].limitW)) {
        const lowerW = Math.min(Math.floor(partial.watts), allocation.commands[0].internalW);
        if (lowerW > state.deadbandW && lowerW < current
            && sendBatteryHeadCommand(head, lowerW, 'Kopf nimmt weniger Leistung auf: Ladeauftrag reduziert', {limitedCharge: true}))
            return;
    }
    if (pendingReduction) {
        const waiting = owned[0]?.pending;
        // A fluctuation in the PV budget can wait while an already charging
        // head follows the last command. Physical confirmation and hard limits
        // still use their own thresholds.
        const targetDropW = current - budget.targetW;
        const awaitFeedback = state.heads.length === 1 && budget.pvChargeTarget
            && budget.targetW > 0 && targetDropW > 0 && targetDropW <= BATTERY_PV_PENDING_TARGET_DROP_W
            && state.actualW > 0 && state.actualW <= budget.targetW + state.toleranceW
            && current <= Math.min(budget.hardChargeLimitW, allocation.commands[0].limitW)
            && waiting?.transportComplete === true && Date.now() - waiting.at < state.feedbackTimeoutMs;
        if (awaitFeedback)
            return publishBatteryHeadsStatus('PV-Sollwert gesunken: warte auf GS und echte GP-Antwort');
        const lowerW = allocation.commands[0].internalW;
        if (singlePvCharge && lowerW > state.deadbandW && lowerW < current
            && batteryHeadCommandEchoed(head, state.heads[0])) {
            sendBatteryHeadCommand(head, lowerW, 'PV-Ueberschuss gesunken: bestaetigten Ladeauftrag reduziert',
                {orderedReduction: true});
            return;
        }
        if (current < lowerW && lowerW < 0 && !timedOut && batteryHeadCommandEchoed(head, snapshot)) {
            const correction = batteryDischargeReduction(state, budget, snapshot, waiting.completedAt);
            if (correction.awaitingGrid && now - waiting.completedAt < BATTERY_START_ECHO_GRACE_MS
                && -current <= Math.min(state.maxDischargeW, allocation.commands[0].limitW))
                return publishBatteryHeadsStatus('Entladeauftrag: warte auf Netzmessung nach AC-Rueckmeldung');
            if (correction.watts > 0) {
                sendBatteryHeadCommand(head, Math.max(lowerW, -correction.watts),
                    'Bestaetigten Entladeauftrag reduziert; AC-Rueckmeldung folgt', {orderedReduction: true});
                return;
            }
        }
        if (observePendingSunEnergyPvCharge(state, budget, owned, 'PV-Ziel gesunken bei offener Rueckmeldung')) return;
        return stopBatteryHeadsOutput('Reduktion bei unbeobachtetem Kopfauftrag: Null statt weiterem Nichtnullauftrag');
    }
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
            if (observePendingSunEnergyPvCharge(state, budget, owned, 'Rueckmeldefrist fuer GS/GP abgelaufen')) return;
            batteryHeadsFault = BATTERY_HEADS_FEEDBACK_TIMEOUT;
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
