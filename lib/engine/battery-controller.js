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

function createBatteryStates() {
    const r = CFG.root;
    const base = `${r}.Devices.Battery`;
    const settings = [
        ['BatteryFineStep_W', 100, 'W', 'Speicher: maximale Erhoehung je Feinschritt'],
        ['BatteryDeadband_W', 50, 'W', 'Speicher: Totband des Feinreglers'],
        ['BatteryCycle_s', 2, 's', 'Speicher: kleinster Abstand der Regelschritte'],
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
    const cycleS = batterySetting('BatteryCycle_s', 2);
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
    return batteryOutputOwned || batteryStopPending;
}

function batteryRegulationState() {
    initializeBatteryOwnership();
    const r = CFG.root;
    const settings = batteryTimingSettings();
    const result = {configured: Boolean(nativeConfig.batterySetpointId), available: false,
        eligible: false, active: hasOwnedBatteryOutput(), reason: '', actualW: null,
        soc: null, minSoc: batterySetting('BatteryMinSoC_pct', 15),
        maxSoc: batterySetting('BatteryMaxSoC_pct', 100),
        maxChargeW: batterySetting('BatteryMaxCharge_W', 2400),
        maxDischargeW: batterySetting('BatteryMaxDischarge_W', 2400),
        canCharge: false, canDischarge: false, ...settings};
    const blocked = reason => ({...result, reason});
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
    const maximumAgeMs = batteryTimingSettings().measurementAgeMs;
    const measuredNumber = id => {
        const state = batteryInput(id, maximumAgeMs);
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
    let targetW = Math.round(Math.max(state.canDischarge ? -state.maxDischargeW : 0,
        Math.min(state.canCharge ? state.maxChargeW : 0, rawTarget)));
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
    if (targetW === batteryLastCommandW && hasOwnedBatteryOutput())
        return publishBatteryStatus('Speicher-Sollwert erreicht; kein erneuter Schreibzugriff');
    const maximumMagnitudeW = reduction ? Math.abs(targetW) : Math.abs(batteryLastCommandW) + state.stepW;
    const commandW = Math.sign(targetW) * Math.round(Math.min(Math.abs(targetW), maximumMagnitudeW));
    write(`${base}.EffectiveStep_W`, Math.abs(commandW - batteryLastCommandW));
    sendBatteryCommand(commandW, reduction ? 'Speicher-Budget sofort reduziert'
        : `Speicher-Feinschritt ${Math.round(state.stepW)} W; GS ${-commandW} W`);
}
