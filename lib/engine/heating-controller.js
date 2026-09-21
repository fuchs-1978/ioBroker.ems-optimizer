/* Independent, fail-closed my-PV heating-buffer controller. */
'use strict';

const heatingOutput = {initialized: false, owned: false, active: false,
    commandW: 0, commandAt: 0, pendingStop: false, generation: 0, fault: '',
    temperatureLock: false, targetId: ''};

function heatingConfig(key, nativeKey, fallback) {
    const value = Number(getState(`${CFG.root}.Config.${key}`)?.val ?? nativeConfig[nativeKey] ?? fallback);
    return Number.isFinite(value) ? value : fallback;
}

function heatingFreshNumber(id, maxAgeMs = 120000) {
    if (!id || !existsState(id)) return null;
    const s = getState(id);
    if (!s || !['number', 'string'].includes(typeof s.val)
        || (typeof s.val === 'string' && !s.val.trim()) || s.ack !== true
        || (s.q !== undefined && Number(s.q) !== 0)) return null;
    const value = Number(s.val), timestamp = Number(s.ts), age = Date.now() - timestamp;
    return Number.isFinite(value) && timestamp > 0 && age >= -1000 && age <= maxAgeMs ? value : null;
}

function heatingBooleanState(id, maximumAgeMs = Infinity) {
    if (!id || !existsState(id)) return null;
    const s = getState(id), age = Date.now() - Number(s?.ts);
    if (!s || s.ack !== true || (s.q !== undefined && Number(s.q) !== 0)
        || !(Number(s.ts) > 0) || !Number.isFinite(age) || age < -1000 || age > maximumAgeMs) return null;
    if ([true, 1, '1'].includes(s.val)) return true;
    if ([false, 0, '0'].includes(s.val)) return false;
    return null;
}

function heatingCoolingState() {
    const maxAgeMs = Math.max(5, heatingConfig('HeatingCoolingMaxAge_s', 'heatingCoolingMaxAgeS', 120)) * 1000;
    const heartbeatId = String(nativeConfig.heatingCoolingHeartbeatId || '').trim();
    if (heartbeatId) {
        const heartbeat = heatingFreshNumber(heartbeatId, maxAgeMs);
        if (heartbeat === null || heartbeat <= 0 || heartbeat > Date.now() + 1000
            || Date.now() - heartbeat > maxAgeMs)
            return {valid: false, active: false, reason: 'Kuehlstatus-Heartbeat fehlt/veraltet'};
    }
    const active = heatingBooleanState(nativeConfig.heatingCoolingActiveId, heartbeatId ? Infinity : maxAgeMs);
    return active === null ? {valid: false, active: false, reason: 'Kuehlstatus fehlt/ungueltig/veraltet'}
        : {valid: true, active, reason: active ? 'Kuehlbetrieb aktiv' : 'Heizbetrieb bestaetigt'};
}

function heatingActualPower() {
    const maxAgeMs = Math.max(5, heatingConfig('HeatingOutputMaxAge_s', 'heatingOutputMaxAgeS', 120)) * 1000;
    const values = [1, 2, 3].map(p => heatingFreshNumber(nativeConfig[`heatingOutput${p}Id`], maxAgeMs));
    return values.every(value => value !== null && value >= 0)
        ? {valid: true, phases: values, totalW: values.reduce((sum, value) => sum + value, 0)}
        : {valid: false, phases: values, totalW: null};
}

function heatingSafetyConfigurationValid() {
    const ranges = [
        ['HeatingBufferTargetTemperature_C', 'heatingTargetTempC', 50, 1, 90],
        ['HeatingStopTemperature_C', 'heatingStopTempC', 60, 1, 90],
        ['HeatingOutletEmergency_C', 'heatingOutletEmergencyC', 80, 1, 95],
        ['HeatingControllerMaxPower_W', 'heatingMaxPowerW', 6000, 0, 6000],
        ['HeatingResumeDelta_C', 'heatingResumeDeltaC', 2, 0.1, 20],
        ['HeatingMaxStep_W', 'heatingMaxStepW', 1000, 100, 3000]
    ];
    for (const [key, nativeKey, fallback, low, high] of ranges) {
        const state = getState(`${CFG.root}.Config.${key}`);
        const raw = state ? state.val : nativeConfig[nativeKey] ?? fallback;
        if (!['number', 'string'].includes(typeof raw) || (typeof raw === 'string' && !raw.trim())
            || !Number.isFinite(Number(raw)) || Number(raw) < low || Number(raw) > high) return false;
    }
    return heatingConfig('HeatingBufferTargetTemperature_C', 'heatingTargetTempC', 50)
        <= heatingConfig('HeatingStopTemperature_C', 'heatingStopTempC', 60);
}

function evaluateHeatingSimulation() {
    const base = `${CFG.root}.Devices.MyPV_Heating`;
    const present = getState(`${base}.Present`)?.val === true;
    const connected = heatingBooleanState(nativeConfig.heatingConnectionId) === true;
    const actual = heatingActualPower();
    const maxAgeMs = Math.max(5, heatingConfig('HeatingTemperatureMaxAge_s', 'heatingTemperatureMaxAgeS', 3600)) * 1000;
    const temperature = heatingFreshNumber(nativeConfig.heatingTempId || CFG.dp.myPvHeatingTemp, maxAgeMs);
    const outletId = String(nativeConfig.heatingOutletTempId || '').trim();
    const outlet = outletId ? heatingFreshNumber(outletId, maxAgeMs) : null;
    const cooling = heatingCoolingState();
    const inhibited = getState(`${CFG.root}.Config.HeatingInhibit`)?.val === true
        || nativeConfig.heatingInhibit === true;
    const stopC = heatingConfig('HeatingStopTemperature_C', 'heatingStopTempC', 60);
    const targetC = Math.min(stopC, heatingConfig('HeatingBufferTargetTemperature_C', 'heatingTargetTempC', 50));
    const resumeDelta = Math.max(0.1, heatingConfig('HeatingResumeDelta_C', 'heatingResumeDeltaC', 2));
    const temperatureValid = temperature !== null && temperature >= -20 && temperature <= 120
        && (!outletId || (outlet !== null && outlet >= -20 && outlet <= 150));
    if (temperatureValid && temperature >= targetC) heatingOutput.temperatureLock = true;
    else if (temperatureValid && temperature <= targetC - resumeDelta) heatingOutput.temperatureLock = false;
    const available = present && connected;
    const configValid = heatingSafetyConfigurationValid();
    const valid = temperatureValid && actual.valid && cooling.valid && configValid;
    const outletStop = heatingConfig('HeatingOutletEmergency_C', 'heatingOutletEmergencyC', 80);
    let reason = !present ? 'Heizpuffer-EHZ nicht vorhanden' : !connected ? 'Heizpuffer-EHZ offline'
        : inhibited ? 'Heizpuffer manuell gesperrt' : !configValid ? 'Heizpuffer-Sicherheitskonfiguration ungueltig'
            : !cooling.valid || cooling.active ? cooling.reason
            : !temperatureValid ? 'Heizpuffer-Temperatur fehlt/ungueltig/veraltet'
                : !actual.valid ? 'Heizpuffer-Ausgangsleistung fehlt/veraltet'
                    : temperature >= stopC || (outletId && outlet >= outletStop) ? 'Heizpuffer-Temperaturschutz'
                        : heatingOutput.temperatureLock ? 'Heizpuffer-Zieltemperatur erreicht' : 'Heizpuffer aufnahmebereit';
    const release = available && valid && !inhibited && !cooling.active
        && !heatingOutput.temperatureLock && temperature < stopC && (!outletId || outlet < outletStop);
    const thermalCapW = release ? Math.max(0, Math.min(6000,
        heatingConfig('HeatingControllerMaxPower_W', 'heatingMaxPowerW', 6000))) : 0;
    const remainingCapacityKWh = temperatureValid ? Math.max(0,
        heatingConfig('HeatingBufferVolume_l', 'heatingVolumeL', 400) * 1.163 * (targetC - temperature) / 1000) : 0;
    const fields = {Available: available, Release: release, TemperaturePowerLimit_W: thermalCapW,
        Temperature_C: temperature ?? 0, TemperatureValid: temperatureValid,
        CoolingDataValid: cooling.valid, CoolingActive: cooling.active,
        CoolingBlocked: !cooling.valid || cooling.active, Inhibited: inhibited,
        RemainingCapacity_kWh: remainingCapacityKWh, ActualPower_W: actual.totalW ?? 0, Status: reason};
    for (const [key, value] of Object.entries(fields)) write(`${base}.${key}`, value);
    if (actual.valid) write(`${CFG.root}.Actual.MyPV_Heating_W`, Math.round(actual.totalW));
    return {available, valid, release, thermalCapW, actualW: actual.totalW,
        coolingBlocked: !cooling.valid || cooling.active, remainingCapacityKWh, temperature, reason};
}

function updateHeatingSimulation() { return evaluateHeatingSimulation(); }

function createHeatingStates() {
    const base = `${CFG.root}.Devices.MyPV_Heating`;
    const fields = {Available: false, Release: false, DriverReady: false, DriverStatus: 'Nicht konfiguriert', TemperaturePowerLimit_W: 0,
        Temperature_C: 0, TemperatureValid: false, CoolingDataValid: false, CoolingActive: false,
        CoolingBlocked: true, Inhibited: false, RemainingCapacity_kWh: 0, ActualPower_W: 0,
        Status: 'Noch nicht geprueft', OutputOwned: false, OutputActive: false,
        OutputCommand_W: 0, OutputSetpointId: '', OutputLastWrite: 0, OutputStatus: 'Ausgang gesperrt',
        OutputFault: '', LastStopReason: '', LastStopAt: 0, ActuatorSettled: false};
    Object.assign(fields, {OutputReservedPower_W: 0, OutputReservedPhase1_W: 0,
        OutputReservedPhase2_W: 0, OutputReservedPhase3_W: 0, OutputReservationPending: false,
        OutputReservationState_JSON: '{}', OutputReservationStatus: ''});
    for (const [key, value] of Object.entries(fields))
        stateDef(`${base}.${key}`, value, typeof value,
            typeof value === 'boolean' ? 'indicator' : typeof value === 'number' ? 'value' : 'text', '', key);
    if (typeof configDef === 'function') configDef(`${base}.ConfirmPhysicalStop`, false, 'boolean',
        'button', '', 'Nur bei beiden Hauptfreigaben AUS: physisch geprueften Stillstand bestaetigen');
}

function initializeHeatingOutput() {
    if (heatingOutput.initialized) return;
    heatingOutput.initialized = true;
    const base = `${CFG.root}.Devices.MyPV_Heating`;
    const reservation = heaterReservationRecord('MyPV_Heating',
        [1, 2, 3].map(p => nativeConfig[`heatingOutput${p}Id`] || ''), 2000);
    if (getState(`${base}.OutputOwned`)?.val === true || reservation.highW.some(watts => watts > 0)) {
        heatingOutput.owned = true;
        heatingOutput.active = getState(`${base}.OutputActive`)?.val === true;
        heatingOutput.commandW = Math.max(0, Math.min(6000, Number(getState(`${base}.OutputCommand_W`)?.val) || 0));
        heatingOutput.commandAt = Number(getState(`${base}.OutputLastWrite`)?.val) || 0;
        heatingOutput.targetId = String(getState(`${base}.OutputSetpointId`)?.val || reservation.sinkId || '');
    }
}

function hasOwnedHeatingOutput() {
    initializeHeatingOutput();
    return heatingOutput.owned || heatingOutput.pendingStop || heaterReservationPending('MyPV_Heating',
        [1, 2, 3].map(p => nativeConfig[`heatingOutput${p}Id`] || ''), 2000);
}

function publishHeatingOutput(status, wrote = false) {
    const base = `${CFG.root}.Devices.MyPV_Heating`;
    for (const [key, value] of Object.entries({OutputOwned: hasOwnedHeatingOutput(),
        OutputActive: heatingOutput.active, OutputCommand_W: heatingOutput.commandW,
        OutputSetpointId: heatingOutput.targetId,
        OutputStatus: status, OutputFault: heatingOutput.fault})) write(`${base}.${key}`, value);
    if (wrote) write(`${base}.OutputLastWrite`, Date.now());
    const otherOwned = ['Battery', 'MyPV_DHW', 'Wallbox0', 'Wallbox1', 'Wallbox2'].some(name =>
        getState(`${CFG.root}.Devices.${name}.OutputOwned`)?.val === true
        || getState(`${CFG.root}.Devices.${name}.OutputActive`)?.val === true);
    write(`${CFG.root}.System.NoActuation`, !hasOwnedHeatingOutput() && !otherOwned);
    if (hasOwnedHeatingOutput() || getState(`${CFG.root}.Devices.Battery.OutputOwned`)?.val === true)
        write(`${CFG.root}.Control.Mode`, 'ALPHA_ENERGY_COORDINATED');
}

function sendHeatingSetpoint(value) {
    const ids = [1, 2, 3].map(p => nativeConfig[`heatingOutput${p}Id`] || '');
    const previous = JSON.stringify(heaterReservationRecord('MyPV_Heating', ids, 2000));
    const previousOwned = heatingOutput.owned, previousTarget = heatingOutput.targetId;
    if (value > 0 && previousTarget && previousTarget !== nativeConfig.heatingSetpointId && hasOwnedHeatingOutput())
        return false;
    if (!reserveHeaterCommand('MyPV_Heating', value, ids, 2000)) return false;
    if (value > 0) {
        heatingOutput.owned = true;
        heatingOutput.targetId = nativeConfig.heatingSetpointId;
        // Durable sink, ownership and phase reserves all precede dispatch.
        write(`${CFG.root}.Devices.MyPV_Heating.OutputOwned`, true);
        write(`${CFG.root}.Devices.MyPV_Heating.OutputSetpointId`, heatingOutput.targetId);
    }
    const generation = ++heatingOutput.generation;
    const id = value === 0 ? heatingOutput.targetId || nativeConfig.heatingSetpointId : nativeConfig.heatingSetpointId;
    const accepted = writeForeignState(id, value, error => {
        if (generation !== heatingOutput.generation) return;
        if (error) {
            heatingOutput.owned = true;
            heatingOutput.active = false;
            heatingOutput.pendingStop = false;
            heatingOutput.fault = String(error.message || error);
            publishHeatingOutput(`Heizpuffer-Schreibfehler: ${heatingOutput.fault}`);
        } else if (value === 0) {
            heaterZeroWriteCompleted('MyPV_Heating', ids, 2000);
            heatingOutput.owned = false;
            heatingOutput.active = false;
            heatingOutput.pendingStop = false;
            heatingOutput.fault = '';
            publishHeatingOutput('Heizpuffer-Abschaltbefehl abgeschlossen');
        }
    });
    if (!accepted) {
        restoreHeaterReservation('MyPV_Heating', previous);
        heatingOutput.owned = previousOwned;
        heatingOutput.targetId = previousTarget;
    }
    return accepted;
}

function stopHeatingOutput(reason = 'Adapter wird beendet') {
    initializeHeatingOutput();
    if (heatingOutput.pendingStop) return publishHeatingOutput(`Abschaltung laeuft: ${reason}`);
    if (!heatingOutput.owned) return publishHeatingOutput(`Gesperrt: ${reason}`);
    write(`${CFG.root}.Devices.MyPV_Heating.LastStopReason`, reason);
    write(`${CFG.root}.Devices.MyPV_Heating.LastStopAt`, Date.now());
    heatingOutput.active = false;
    heatingOutput.pendingStop = true;
    heatingOutput.commandW = 0;
    if (!sendHeatingSetpoint(0)) {
        heatingOutput.pendingStop = false;
        return publishHeatingOutput(`Abschaltbefehl blockiert: ${reason}`);
    }
    heatingOutput.commandAt = Date.now();
    publishHeatingOutput(`Abschaltbefehl gesendet: ${reason}`, true);
}

// Gross shared-budget reservation. Never use battery discharge as permission
// to exceed a binding import-device cap, and reserve pending positive commands
// while a slower actuator has not yet reached them.
function heaterOtherControlledLoadW(excluded) {
    let totalW = 0;
    for (const name of ['MyPV_DHW', 'MyPV_Heating']) {
        if (name === excluded) continue;
        const base = `${CFG.root}.Devices.${name}`;
        if (getState(`${base}.Present`)?.val !== true && getState(`${base}.OutputOwned`)?.val !== true) continue;
        let actualW;
        if (name === 'MyPV_Heating') actualW = heatingActualPower().totalW;
        else {
            const phaseW = (CFG.dp.myPvDhwOutputW || []).map(id => heatingFreshNumber(id));
            actualW = phaseW.length === 3 && phaseW.every(value => value !== null && value >= 0)
                ? phaseW.reduce((sum, value) => sum + value, 0) : null;
        }
        if (actualW === null) return null;
        const commandW = getState(`${base}.OutputOwned`)?.val === true
            ? Math.max(0, Number(getState(`${base}.OutputCommand_W`)?.val) || 0) : 0;
        totalW += Math.max(actualW, commandW);
    }
    const wbAgeMs = Math.max(5, Number(nativeConfig.wallboxMeasurementMaxAgeS) || 30) * 1000;
    for (const wb of [0, 1, 2]) {
        const base = `${CFG.root}.Devices.Wallbox${wb}`;
        if (getState(`${base}.Present`)?.val !== true && getState(`${base}.OutputOwned`)?.val !== true) continue;
        const actualKW = heatingFreshNumber(CFG.dp.wallboxesKW?.[wb], wbAgeMs);
        if (actualKW === null || actualKW < 0) return null;
        const commandW = getState(`${base}.OutputOwned`)?.val === true
            ? Math.max(0, Number(getState(`${base}.OutputCommand_A`)?.val) || 0)
                * (Number(getState(`${base}.OutputPhases`)?.val) === 3 ? 3 : 1) * 230 : 0;
        const pendingW = getState(`${base}.OutputOwned`)?.val === true
            ? Math.max(0, Number(getState(`${base}.OutputReservedPower_W`)?.val) || 0) : 0;
        totalW += Math.max(actualKW * 1000, commandW, pendingW);
    }
    const batteryBase = `${CFG.root}.Devices.Battery`;
    if (getState(`${batteryBase}.Present`)?.val === true) {
        const actualW = typeof batteryMeasuredPowerW === 'function' ? batteryMeasuredPowerW() : null;
        if (actualW === null) return null;
        const commandW = getState(`${batteryBase}.OutputOwned`)?.val === true
            ? Math.max(0, Number(getState(`${batteryBase}.OutputCommandInternal_W`)?.val) || 0) : 0;
        totalW += Math.max(0, actualW, commandW);
    }
    return totalW;
}

function heatingPhaseLimitW(requestedW, phasesW) {
    let otherPendingW = [0, 0, 0];
    if (typeof coordinatedEnergyEnabled === 'function' && coordinatedEnergyEnabled()) {
        if (typeof coordinatedPhaseReservations !== 'function') return 0;
        const reservation = coordinatedPhaseReservations('MyPV_Heating');
        if (!reservation.valid || !Array.isArray(reservation.otherW) || reservation.otherW.length !== 3
            || reservation.otherW.some(value => !Number.isFinite(value) || value < 0)) return 0;
        otherPendingW = reservation.otherW;
    }
    const imported = CFG.dp.haPhaseImportW || [], exported = CFG.dp.haPhaseExportW || [];
    const directional = [...imported, ...exported].some(Boolean);
    if (directional && (imported.length !== 3 || exported.length !== 3
        || ![...imported, ...exported].every(Boolean))) return 0;
    const rawMaxA = getState(`${CFG.root}.Config.HouseConnectionWorkingLimit_A`)?.val;
    const maxA = rawMaxA === undefined ? 46 : Number(rawMaxA);
    const fuseA = Number(getState(`${CFG.root}.Config.HouseConnectionFuse_A`)?.val ?? 50);
    if (!['number', 'string'].includes(typeof (rawMaxA ?? 46))
        || (typeof rawMaxA === 'string' && !rawMaxA.trim())
        || !Number.isFinite(maxA) || !Number.isFinite(fuseA) || maxA < 1 || maxA > fuseA) return 0;
    // Installed 6-kW element: three 2-kW stages. A lower configured *total*
    // power limit does not change the electrical size of an individual stage.
    const stageW = 2000;
    const allowed = [0, 1, 2].map(p => {
        const measuredA = directional ? gridConstraints.netImportCurrentA(
            heatingFreshNumber(imported[p]), heatingFreshNumber(exported[p]))
            : heatingFreshNumber(CFG.dp.myPvDhwHaCurrentA?.[p]);
        return measuredA === null ? null : Math.max(0, Math.min(stageW,
            phasesW[p] + (maxA - measuredA) * 230 - otherPendingW[p]));
    });
    if (allowed.some(value => value === null)) return 0;
    let resultW = Math.min(requestedW, allowed[0]);
    if (requestedW > stageW && allowed[1] >= stageW) resultW = Math.min(requestedW, stageW + allowed[0]);
    if (requestedW > stageW * 2 && allowed[1] >= stageW && allowed[2] >= stageW)
        resultW = Math.min(requestedW, stageW * 2 + allowed[0]);
    return Math.max(0, Math.floor(resultW));
}

function updateHeatingProductionOutput() {
    initializeHeatingOutput();
    refreshHeaterReservation('MyPV_Heating', [1, 2, 3].map(p => nativeConfig[`heatingOutput${p}Id`] || ''), 2000);
    const base = `${CFG.root}.Devices.MyPV_Heating`;
    if (nativeConfig.globalWriteEnabled !== true || getState(`${CFG.root}.System.RealOutputsEnabled`)?.val !== true)
        return stopHeatingOutput('Globale Schreibfreigabe aus');
    if (nativeConfig.heatingPresent !== true || nativeConfig.heatingControlEnabled !== true
        || nativeConfig.heatingProductionArmed !== true || getState(`${base}.ControlEnabled`)?.val !== true
        || getState(`${base}.DriverReady`)?.val !== true || !nativeConfig.heatingSetpointId)
        return stopHeatingOutput('Heizpuffer-Ausgang nicht vollstaendig freigegeben');
    if (heatingOutput.fault || heatingOutput.pendingStop)
        return stopHeatingOutput(heatingOutput.fault || 'Abschaltbefehl noch offen');
    if (hasOwnedHeatingOutput() && heatingOutput.targetId && heatingOutput.targetId !== nativeConfig.heatingSetpointId)
        return stopHeatingOutput('Heizpuffer-Sollwertadresse geaendert; bisherigen Ausgang zuerst stoppen');
    const thermal = evaluateHeatingSimulation();
    if (!thermal.release) return stopHeatingOutput(thermal.reason);
    const now = Date.now();
    if (getState(`${CFG.root}.System.DataValid`)?.val !== true || getState(`${CFG.root}.Control.Valid`)?.val !== true
        || heatingFreshNumber(`${CFG.root}.System.LastUpdate`, 30000) === null
        || heatingFreshNumber(`${CFG.root}.Control.LastUpdate`, 10000) === null
        || now - Number(getState(`${CFG.root}.System.LastUpdate`)?.val) > 30000
        || now - Number(getState(`${CFG.root}.Control.LastUpdate`)?.val) > 10000
        || Number(getState(`${CFG.root}.System.LastUpdate`)?.val) > now + 1000
        || Number(getState(`${CFG.root}.Control.LastUpdate`)?.val) > now + 1000)
        return stopHeatingOutput('EMS-/Reglerdaten fehlen/veraltet');
    if (CFG.dp.haCritical && heatingBooleanState(CFG.dp.haCritical) !== false)
        return stopHeatingOutput('Hausanschlussschutz aktiv/ungueltig');
    const actual = heatingActualPower();
    // Derived targets are written only when their value changes. Their freshness
    // is the validated Control.LastUpdate heartbeat above, not the target's ts.
    const targetW = heatingFreshNumber(`${CFG.root}.Control.Targets.MyPV_Heating_W`, Infinity);
    if (!actual.valid || targetW === null || targetW < 0) return stopHeatingOutput('Heizpuffer-Budget/Messung ungueltig');
    const limit = currentConsumptionLimit();
    if (!limit.valid) return stopHeatingOutput(limit.reason);
    let capW = Math.min(thermal.thermalCapW, targetW);
    if (limit.budgetW !== null) {
        const loads = typeof coordinatedConsumptionLoads === 'function' ? coordinatedConsumptionLoads() : null;
        const otherW = loads ? loads.valid ? Math.max(0, loads.totalW - loads.heatingW) : null
            : heaterOtherControlledLoadW('MyPV_Heating');
        if (otherW === null) return stopHeatingOutput('Gemeinsame Verbrauchermessung fuer Netzbetreiberbudget fehlt');
        capW = Math.min(capW, Math.max(0, limit.budgetW - otherW));
    }
    const unphasedCapW = capW;
    capW = heatingPhaseLimitW(capW, actual.phases);
    const toleranceW = Math.max(50, heatingConfig('HeatingSettleTolerance_W', 'heatingSettleToleranceW', 300));
    const settled = Math.abs(actual.totalW - heatingOutput.commandW) <= toleranceW;
    let desiredW = capW;
    let stepW = Math.max(100, heatingConfig('HeatingMaxStep_W', 'heatingMaxStepW', 1000));
    const fine = typeof heaterUsesGridFeedback === 'function' && heaterUsesGridFeedback('MyPV_Heating');
    if (fine) {
        const gridW = directGridPowerW();
        if (gridW === null) return stopHeatingOutput('NVP-Messung fehlt/veraltet');
        const targetGridW = Number(getState(`${CFG.root}.Control.TargetGridPower_W`)?.val ?? -100);
        const errorW = gridW - targetGridW;
        const deadbandW = Math.max(0, Number(getState(`${CFG.root}.Control.Deadband_W`)?.val) || 100);
        desiredW = Math.abs(errorW) <= deadbandW ? heatingOutput.commandW
            : Math.min(capW, Math.max(0, actual.totalW - errorW));
        if (errorW > deadbandW) desiredW = Math.min(heatingOutput.commandW, desiredW);
        if (errorW < -deadbandW && settled) stepW = Math.min(3000, Math.abs(errorW));
    }
    if (!settled && desiredW > heatingOutput.commandW) desiredW = heatingOutput.commandW;
    const rampedCommandW = Math.floor(Math.max(0, Math.min(capW, desiredW, heatingOutput.commandW + stepW)));
    const commandW = heatingPhaseLimitW(rampedCommandW, actual.phases);
    if (commandW <= 0) return stopHeatingOutput(unphasedCapW > 0 && (capW === 0 || rampedCommandW > 0)
        ? 'Hausanschluss-Phasengrenze laesst aktuelle Rampenstufe nicht zu' : 'Kein Heizpuffer-Leistungsbudget');
    if (!sendHeatingSetpoint(commandW)) return stopHeatingOutput('Heizpuffer-Schreibzugriff blockiert');
    if (commandW !== heatingOutput.commandW) heatingOutput.commandAt = now;
    heatingOutput.commandW = commandW;
    heatingOutput.active = true;
    write(`${base}.ActuatorSettled`, settled);
    publishHeatingOutput(`PRODUKTIV: ${commandW} W; ${fine ? 'NVP-Feinregler' : 'zentrales Leistungsbudget'}${commandW < rampedCommandW || capW < unphasedCapW ? '; Hausanschluss-Phasengrenze begrenzt Rampenstufe' : ''}`, true);
}
