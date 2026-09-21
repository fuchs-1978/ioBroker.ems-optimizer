/* Guarded production output for the my-PV DHW heater.
 * No write is possible unless global, device and data-valid gates are true.
 */
'use strict';

let dhwOutputWasActive = false;
let dhwLastCommandW = 0;
let dhwLastCommandAt = 0;
let dhwStage2LockUntil = 0;
let dhwStage3LockUntil = 0;
let dhwWriteGeneration = 0;
let dhwLastWriteFailure = '';
let dhwStopPending = false;
let dhwOwnershipInitialized = false;
let dhwOwnedSetpointId = '';
const heaterReservationRecords = new Map();

function heaterConfiguredSink(name) {
    return String(name === 'MyPV_DHW' ? CFG.dp.myPvDhwSetpoint || '' : nativeConfig.heatingSetpointId || '');
}

function heaterCommandPhases(commandW, stageW) {
    const watts = Math.max(0, Math.min(stageW * 3, Number(commandW) || 0));
    return watts <= stageW ? [watts, 0, 0] : watts <= stageW * 2
        ? [watts - stageW, stageW, 0] : [watts - stageW * 2, stageW, stageW];
}

function heaterReservationRecord(name, ids, stageW) {
    if (heaterReservationRecords.has(name)) return heaterReservationRecords.get(name);
    const base = `${CFG.root}.Devices.${name}`;
    let stored = null;
    try { stored = JSON.parse(getState(`${base}.OutputReservationState_JSON`)?.val || '{}'); } catch (_) {}
    const array = value => Array.isArray(value) && value.length === 3 && value.every(Number.isFinite);
    const validStored = stored && array(stored.highW) && array(stored.seenAt)
        && array(stored.commandW) && Number.isFinite(stored.commandAt)
        && Array.isArray(stored.ids) && stored.ids.length === 3 && stored.ids.every(id => typeof id === 'string');
    const owned = getState(`${base}.OutputOwned`)?.val === true || getState(`${base}.OutputActive`)?.val === true;
    const currentW = heaterCommandPhases(owned ? getState(`${base}.OutputCommand_W`)?.val : 0, stageW);
    const persistedPhases = [1, 2, 3].map(p => Math.max(0,
        Number(getState(`${base}.OutputReservedPhase${p}_W`)?.val) || 0));
    const record = validStored ? stored : {highW: currentW.map((watts, p) => Math.max(watts, persistedPhases[p])),
        seenAt: [0, 0, 0], commandW: currentW, commandAt: Number(getState(`${base}.OutputLastWrite`)?.val) || 0,
        ids: [...ids]};
    if (typeof record.sinkId !== 'string')
        record.sinkId = String(getState(`${base}.OutputSetpointId`)?.val || heaterConfiguredSink(name));
    // A partially persisted newer highwater cannot be discarded by an older
    // JSON proof record after an interrupted multi-state database write.
    for (const p of [0, 1, 2]) {
        const high = Math.min(stageW, Math.max(0, record.highW[p], persistedPhases[p], currentW[p]));
        if (high > record.highW[p]) record.seenAt[p] = 0;
        record.highW[p] = high;
    }
    heaterReservationRecords.set(name, record);
    return record;
}

function publishHeaterReservation(name, record, status = '') {
    const base = `${CFG.root}.Devices.${name}`;
    const totalW = record.highW.reduce((sum, value) => sum + value, 0);
    for (const p of [0, 1, 2]) write(`${base}.OutputReservedPhase${p + 1}_W`, record.highW[p]);
    write(`${base}.OutputReservedPower_W`, totalW);
    write(`${base}.OutputReservationPending`, totalW > 0);
    write(`${base}.OutputReservationState_JSON`, JSON.stringify(record));
    write(`${base}.OutputReservationStatus`, status || (totalW > 0
        ? 'Leistung bleibt reserviert bis volle Stellwirkung je Phase und spaetere Reduktion belegt sind; Messabweichungen erfordern ggf. bestaetigten physischen Stopp'
        : 'Kein unbestaetigter positiver Leistungsauftrag'));
}

function refreshHeaterReservation(name, ids, stageW) {
    const record = heaterReservationRecord(name, ids, stageW);
    const base = `${CFG.root}.Devices.${name}`;
    const sameMapping = record.ids.every((id, p) => id === ids[p]) && record.sinkId === heaterConfiguredSink(name);
    const samples = record.ids.map(id => ({state: getState(id), value: validDhwOutputNumber(id, 120000)}));
    const confirm = getState(`${base}.ConfirmPhysicalStop`);
    if (confirm?.val === true && confirm.ack === false) {
        const accepted = nativeConfig.globalWriteEnabled === false
            && getState(`${CFG.root}.System.RealOutputsEnabled`)?.val === false && sameMapping
            && Number(confirm.ts) > Number(record.zeroWriteAt) && Number(confirm.ts) <= Date.now() + 1000
            && (confirm.q === undefined || Number(confirm.q) === 0)
            && samples.every(sample => sample.value === 0 && Number(sample.state?.ts) > Number(record.zeroWriteAt))
            && record.commandW.every(watts => watts === 0) && Number(record.zeroWriteAt) >= record.commandAt;
        if (accepted) { record.highW = [0, 0, 0]; record.seenAt = [0, 0, 0]; }
        write(`${base}.ConfirmPhysicalStop`, false);
        publishHeaterReservation(name, record, accepted
            ? 'Physischer Stillstand durch Benutzer bestaetigt; frische Nullmessung geprueft'
            : 'Bestaetigung abgelehnt: Hauptfreigabe AUS, unveraenderte Zuordnung und frische echte Nullmessung erforderlich');
        return record;
    }
    if (!sameMapping && record.highW.some(watts => watts > 0)) {
        publishHeaterReservation(name, record, 'Alte Messwertzuordnung noch nicht physisch freigegeben');
        return record;
    }
    for (const p of [0, 1, 2]) {
        const value = samples[p].value, ts = Number(samples[p].state?.ts);
        if (value === null || value < 0 || !Number.isFinite(ts)) continue;
        const previouslySeenAt = record.seenAt[p];
        if (record.highW[p] > 0 && value >= record.highW[p]) record.seenAt[p] = Math.max(previouslySeenAt, ts);
        // A pre-effect zero is never proof that a previously queued rise was
        // cancelled. First witness that rise, then a later physical reduction.
        if (record.commandW[p] < record.highW[p] && previouslySeenAt > 0
            && ts > previouslySeenAt && ts >= record.commandAt && value <= record.commandW[p]
            && (record.commandW.some(watts => watts > 0)
                || (Number(record.zeroWriteAt) >= record.commandAt && ts > Number(record.zeroWriteAt)))) {
            record.highW[p] = record.commandW[p];
            record.seenAt[p] = record.highW[p] > 0 ? ts : 0;
        }
    }
    publishHeaterReservation(name, record);
    return record;
}

function reserveHeaterCommand(name, commandW, ids, stageW) {
    const record = refreshHeaterReservation(name, ids, stageW);
    if (commandW > 0 && record.highW.some(watts => watts > 0)
        && (!record.ids.every((id, p) => id === ids[p]) || record.sinkId !== heaterConfiguredSink(name))) return false;
    const phases = heaterCommandPhases(commandW, stageW);
    if (record.highW.every(watts => watts === 0)) {
        record.ids = [...ids]; record.sinkId = heaterConfiguredSink(name);
    }
    for (const p of [0, 1, 2]) {
        // A new rise after an intervening reduction needs its own physical
        // proof, even when it does not exceed the older phase highwater.
        if (phases[p] > record.commandW[p]) record.seenAt[p] = 0;
        record.highW[p] = Math.max(record.highW[p], phases[p]);
    }
    if (phases.some((watts, p) => watts !== record.commandW[p])) record.commandAt = Date.now();
    record.commandW = phases;
    publishHeaterReservation(name, record);
    return true;
}

function restoreHeaterReservation(name, previous) {
    const record = JSON.parse(previous);
    heaterReservationRecords.set(name, record);
    publishHeaterReservation(name, record);
}

function heaterZeroWriteCompleted(name, ids, stageW) {
    const record = heaterReservationRecord(name, ids, stageW);
    record.zeroWriteAt = Date.now();
    publishHeaterReservation(name, record);
}

function heaterReservationPending(name, ids, stageW) {
    return heaterReservationRecord(name, ids, stageW).highW.some(watts => watts > 0);
}

function initializeDhwOutputOwnership() {
    if (dhwOwnershipInitialized) return;
    dhwOwnershipInitialized = true;
    const base = `${CFG.root}.Devices.MyPV_DHW`;
    const previousCommandW = Number(getState(`${base}.OutputCommand_W`)?.val);
    const previousWriteAt = Number(getState(`${base}.OutputLastWrite`)?.val);
    const persistedOwnership = getState(`${base}.OutputOwned`)?.val === true;
    // Upgrade fallback for versions without OutputOwned. Actual heater power
    // alone is never proof of EMS ownership; it can belong to the old script.
    const legacyOwnership = getState(`${base}.OutputActive`)?.val === true
        && Number.isFinite(previousCommandW) && previousCommandW > 0 && previousWriteAt > 0;
    const reservation = heaterReservationRecord('MyPV_DHW', CFG.dp.myPvDhwOutputW || [], 3000);
    if (persistedOwnership || legacyOwnership || reservation.highW.some(watts => watts > 0)) {
        dhwOutputWasActive = true;
        dhwLastCommandW = Number.isFinite(previousCommandW)
            ? Math.max(0, Math.min(9000, previousCommandW)) : 0;
        dhwLastCommandAt = Number.isFinite(previousWriteAt) ? Math.max(0, previousWriteAt) : 0;
        dhwOwnedSetpointId = String(getState(`${base}.OutputSetpointId`)?.val || reservation.sinkId || CFG.dp.myPvDhwSetpoint || '');
    }
}

function writeDhwSetpoint(commandW) {
    const previous = JSON.stringify(heaterReservationRecord('MyPV_DHW', CFG.dp.myPvDhwOutputW || [], 3000));
    const wasActive = dhwOutputWasActive;
    const priorSink = dhwOwnedSetpointId;
    if (commandW > 0 && priorSink && priorSink !== CFG.dp.myPvDhwSetpoint && hasOwnedDhwOutput()) return false;
    if (!reserveHeaterCommand('MyPV_DHW', commandW, CFG.dp.myPvDhwOutputW || [], 3000)) return false;
    if (commandW > 0) {
        dhwOwnedSetpointId = CFG.dp.myPvDhwSetpoint;
        dhwOutputWasActive = true;
        write(`${CFG.root}.Devices.MyPV_DHW.OutputOwned`, true);
        write(`${CFG.root}.Devices.MyPV_DHW.OutputSetpointId`, dhwOwnedSetpointId);
    }
    const generation = ++dhwWriteGeneration;
    const accepted = writeForeignState(commandW === 0 ? dhwOwnedSetpointId || CFG.dp.myPvDhwSetpoint : CFG.dp.myPvDhwSetpoint, commandW, error => {
        if (generation !== dhwWriteGeneration) return;
        if (error) {
            // A failed transport does not prove that the actuator received
            // nothing. Retain ownership until a subsequent zero is confirmed.
            dhwLastWriteFailure = String(error.message || error);
            dhwOutputWasActive = true;
            dhwStopPending = false;
            dhwOutputStatus(false, dhwLastCommandW,
                `Ausgangsschreibfehler: ${dhwLastWriteFailure}; sicherer Stopp erforderlich`);
        } else {
            dhwLastWriteFailure = '';
            if (commandW === 0) {
                heaterZeroWriteCompleted('MyPV_DHW', CFG.dp.myPvDhwOutputW || [], 3000);
                dhwOutputWasActive = false;
                dhwStopPending = false;
                dhwOutputStatus(false, 0,
                    getState(`${CFG.root}.Devices.MyPV_DHW.OutputStatus`)?.val || 'Abschaltbefehl ausgefuehrt');
            }
        }
    });
    if (!accepted) {
        restoreHeaterReservation('MyPV_DHW', previous);
        dhwOutputWasActive = wasActive;
        dhwOwnedSetpointId = priorSink;
        write(`${CFG.root}.Devices.MyPV_DHW.OutputOwned`, hasOwnedDhwOutput());
    }
    return accepted;
}

function dhwCombinedProductionState() {
    const selected = [0, 1, 2].filter(wb =>
        Boolean(getState(`${CFG.root}.Devices.Wallbox${wb}.Present`)?.val)
        && Boolean(getState(`${CFG.root}.Devices.Wallbox${wb}.ControlEnabled`)?.val));
    if (!selected.length) return {requested: false, allowed: false, reason: ''};
    const alphaScope = nativeConfig.multiWallboxAlphaArmed === true && selected.length > 1;
    const scopeConfirmed = selected.length === 1 || alphaScope;
    const allWallboxesArmed = selected.every(wb => nativeConfig[`wb${wb}ProductionArmed`] === true);
    const allowed = scopeConfirmed && allWallboxesArmed
        && Boolean(getState(`${CFG.root}.Config.DHWParallelDistributionEnabled`)?.val)
        && nativeConfig.combinedProductionArmed === true;
    let reason = '';
    if (!scopeConfirmed) reason = 'mehrere Wallboxen erfordern die ALPHA-Mehrgeraetefreigabe';
    else if (!allWallboxesArmed) reason = 'nicht alle freigegebenen Wallboxen sind einzeln bestaetigt';
    else if (nativeConfig.combinedProductionArmed !== true) reason = 'Kombinationstest nicht bestaetigt';
    else if (!Boolean(getState(`${CFG.root}.Config.DHWParallelDistributionEnabled`)?.val))
        reason = 'gemeinsame Verteilung in Konfiguration deaktiviert';
    return {requested: true, allowed, reason};
}

function dhwOutputStatus(active, commandW, status, wrote = false) {
    const base = `${CFG.root}.Devices.MyPV_DHW`;
    write(`${base}.OutputActive`, active);
    write(`${base}.OutputOwned`, hasOwnedDhwOutput());
    write(`${base}.OutputCommand_W`, Math.round(commandW));
    write(`${base}.OutputStatus`, status);
    if (wrote) write(`${base}.OutputLastWrite`, Date.now());
    const wallboxOwned = [0, 1, 2].some(wb =>
        getState(`${CFG.root}.Devices.Wallbox${wb}.OutputOwned`)?.val === true);
    const extensions = ['Battery', 'MyPV_Heating'].some(name =>
        getState(`${CFG.root}.Devices.${name}.OutputOwned`)?.val === true
        || getState(`${CFG.root}.Devices.${name}.OutputActive`)?.val === true);
    write(`${CFG.root}.System.NoActuation`, !hasOwnedDhwOutput() && !wallboxOwned && !extensions);
    const alpha = nativeConfig.multiWallboxAlphaArmed === true;
    write(`${CFG.root}.Control.Mode`, extensions ? 'ALPHA_ENERGY_COORDINATED' : alpha
        ? active && wallboxOwned ? 'ALPHA_WALLBOX_DHW'
            : active ? 'ALPHA_DHW' : wallboxOwned ? 'ALPHA_WALLBOX' : 'ALPHA_READY'
        : active && wallboxOwned ? 'WALLBOX_DHW_COMBINED'
            : active ? 'DHW_PRODUCTION' : wallboxOwned ? 'WALLBOX_SINGLE_TEST' : 'SIMULATION');
}

function dhwSafeStop(reason) {
    initializeDhwOutputOwnership();
    if (dhwStopPending) {
        dhwOutputStatus(false, 0, `Abschaltung laeuft: ${reason}`);
        return;
    }
    if (dhwOutputWasActive && (dhwOwnedSetpointId || CFG.dp.myPvDhwSetpoint)) {
        const previousCommandW = dhwLastCommandW;
        dhwLastCommandW = 0;
        dhwOutputWasActive = false;
        dhwStopPending = true;
        if (!writeDhwSetpoint(0)) {
            dhwLastCommandW = previousCommandW;
            dhwOutputWasActive = true;
            dhwStopPending = false;
            dhwOutputStatus(false, dhwLastCommandW, `Abschaltbefehl blockiert: ${reason}`);
            return;
        }
        // Never invent a zero measured power: the heater can still be ramping
        // down, and a wallbox must wait for that real load to disappear.
        dhwLastCommandW = 0;
        dhwLastCommandAt = 0;
        dhwOutputWasActive = false;
        dhwOutputStatus(false, 0, `Abschaltbefehl gesendet: ${reason}`, true);
    } else dhwOutputStatus(false, 0, `Gesperrt: ${reason}`);
}

function hasOwnedDhwOutput() {
    initializeDhwOutputOwnership();
    return dhwOutputWasActive || dhwStopPending
        || heaterReservationPending('MyPV_DHW', CFG.dp.myPvDhwOutputW || [], 3000);
}

function stopDhwOutput(reason = 'Adapter wird beendet') {
    dhwSafeStop(reason);
}

function validDhwOutputNumber(id, maximumAgeMs = CFG.dataMaxAgeMs) {
    if (!id || !existsState(id)) return null;
    const state = getState(id);
    if (!state || state.val === null || state.val === undefined
        || !['number', 'string'].includes(typeof state.val)
        || (typeof state.val === 'string' && !state.val.trim())
        || state.ack === false || (state.q !== undefined && Number(state.q) !== 0)) return null;
    const value = Number(state?.val);
    const ageMs = Date.now() - Number(state.ts || 0);
    if (!Number.isFinite(value) || !(Number(state.ts) > 0) || ageMs < 0 || ageMs > maximumAgeMs) return null;
    return value;
}

function phaseLimitedDhwPower(requestedW) {
    let otherPendingW = [0, 0, 0];
    if (typeof coordinatedEnergyEnabled === 'function' && coordinatedEnergyEnabled()) {
        if (typeof coordinatedPhaseReservations !== 'function') return 0;
        const reservation = coordinatedPhaseReservations('MyPV_DHW');
        if (!reservation.valid || !Array.isArray(reservation.otherW) || reservation.otherW.length !== 3
            || reservation.otherW.some(value => !Number.isFinite(value) || value < 0)) return 0;
        otherPendingW = reservation.otherW;
    }
    const currentIds = CFG.dp.myPvDhwHaCurrentA || [];
    const outputIds = CFG.dp.myPvDhwOutputW || [];
    const importIds = CFG.dp.haPhaseImportW || [];
    const exportIds = CFG.dp.haPhaseExportW || [];
    const directionalIds = [...importIds, ...exportIds];
    const directionalConfigured = directionalIds.some(Boolean);
    const directionalComplete = importIds.length === 3 && exportIds.length === 3
        && directionalIds.every(Boolean);
    if (outputIds.length !== 3 || (directionalConfigured && !directionalComplete)
        || (!directionalConfigured && currentIds.length !== 3)) return 0;
    const legacyConnectionLimitA = readNumber(
        `${CFG.root}.Config.DHWHouseConnectionLimit_A`, 50);
    const connectionLimitA = Math.max(1, readNumber(
        `${CFG.root}.Config.HouseConnectionWorkingLimit_A`, legacyConnectionLimitA));
    const allowed = [0, 1, 2].map(index => {
        let measuredA;
        if (directionalConfigured) {
            const importW = validDhwOutputNumber(importIds[index]);
            const exportW = validDhwOutputNumber(exportIds[index]);
            measuredA = gridConstraints.netImportCurrentA(importW, exportW);
        } else measuredA = validDhwOutputNumber(currentIds[index]);
        const actualW = validDhwOutputNumber(outputIds[index]);
        if (measuredA === null || actualW === null) return null;
        // Negative headroom must reduce a running element, not merely inhibit
        // another increase while it continues contributing to the overload.
        const freeA = connectionLimitA - measuredA - otherPendingW[index] / 230;
        return Math.max(0, Math.min(3000, actualW + freeA * 230));
    });
    if (allowed.some(value => value === null)) return 0;

    const now = Date.now();
    if (requestedW > 3000 && allowed[1] < 3000) dhwStage2LockUntil = now + 30000;
    if (requestedW > 6000 && allowed[2] < 3000) dhwStage3LockUntil = now + 30000;
    let resultW = Math.min(requestedW, allowed[0]);
    if (requestedW > 3000 && allowed[1] >= 3000 && now >= dhwStage2LockUntil) {
        resultW = Math.max(resultW, Math.min(requestedW, 3000 + allowed[0]));
    }
    if (requestedW > 6000 && allowed[1] >= 3000 && allowed[2] >= 3000
        && now >= dhwStage2LockUntil && now >= dhwStage3LockUntil) {
        resultW = Math.max(resultW, Math.min(requestedW, 6000 + allowed[0]));
    }
    return Math.max(0, Math.floor(resultW));
}

function mirrorDhwActualPower() {
    const values = (CFG.dp.myPvDhwOutputW || []).map(id => validDhwOutputNumber(id));
    if (values.length !== 3 || values.some(value => value === null)) return null;
    const totalW = Math.max(0, values.reduce((sumW, valueW) => sumW + valueW, 0));
    write(`${CFG.root}.Actual.MyPV_DHW_W`, Math.round(totalW));
    if (CFG.dp.myPvDhwActualMirror) writeForeignState(CFG.dp.myPvDhwActualMirror, Math.round(totalW));
    return totalW;
}

function directGridPowerW() {
    const gridImportW = validDhwOutputNumber(CFG.dp.gridImport, 10000);
    const gridExportW = validDhwOutputNumber(CFG.dp.gridExport, 10000);
    if (gridImportW === null || gridExportW === null) return null;
    return Math.round(gridImportW - gridExportW);
}

function adaptiveDhwStepW(errorW, maximumStepW, deadbandW,
    fastIncreaseMaximumW = maximumStepW) {
    const deviationW = Math.abs(errorW);
    if (deviationW <= deadbandW) return 0;
    if (errorW < -deadbandW && fastIncreaseMaximumW > maximumStepW)
        return Math.min(fastIncreaseMaximumW, deviationW);
    if (deviationW <= 500) return Math.min(maximumStepW, 200);
    if (deviationW <= 1500) return Math.min(maximumStepW, 500);
    return maximumStepW;
}

function limitedDhwCommand(simulatedW, lastCommandW, allocationCapW, stepW, desiredW) {
    if (simulatedW <= 0) return 0;
    if (lastCommandW > allocationCapW) return Math.round(allocationCapW);
    // Import and reduced budgets must be relieved immediately. Only increases
    // are ramped; ramping a reduction lets the EHZ compete with the wallbox.
    if (desiredW < lastCommandW) return Math.max(0, Math.round(Math.min(allocationCapW, desiredW)));
    if (stepW === 0) return Math.round(lastCommandW);
    const upperW = Math.min(allocationCapW, lastCommandW + stepW);
    return Math.round(Math.max(0, Math.min(upperW, desiredW)));
}

function updateDhwProductionOutput() {
    initializeDhwOutputOwnership();
    refreshHeaterReservation('MyPV_DHW', CFG.dp.myPvDhwOutputW || [], 3000);
    const r = CFG.root;
    const globalEnabled = Boolean(getState(`${r}.System.RealOutputsEnabled`)?.val);
    const present = Boolean(getState(`${r}.Devices.MyPV_DHW.Present`)?.val);
    const controlEnabled = Boolean(getState(`${r}.Devices.MyPV_DHW.ControlEnabled`)?.val);
    if (!globalEnabled) return dhwSafeStop('globale Schreibfreigabe aus');
    if (!present) return dhwSafeStop('Trinkwasser-EHZ nicht vorhanden');
    if (!controlEnabled) return dhwSafeStop('EHZ-Steuerfreigabe aus');
    if (dhwLastWriteFailure) return dhwSafeStop(`Ausgangsschreibfehler: ${dhwLastWriteFailure}`);
    if (dhwStopPending) return dhwSafeStop('vorheriger Abschaltbefehl noch offen');
    const combined = dhwCombinedProductionState();
    if (combined.requested && !combined.allowed)
        return dhwSafeStop(`gemeinsame Produktion gesperrt: ${combined.reason}`);
    if (!CFG.dp.myPvDhwSetpoint) return dhwSafeStop('kein Sollwert-Datenpunkt konfiguriert');
    if (!Boolean(getState(`${r}.System.DataValid`)?.val)) return dhwSafeStop('EMS-Eingangsdaten ungueltig');
    if (!Boolean(getState(`${r}.Control.Valid`)?.val)) return dhwSafeStop('Echtzeitregler ungueltig');
    // Grid-operator limits can change between allocator runs. Recheck them at
    // the physical output, including a wallbox physically held at minimum
    // current even when its allocator target is temporarily zero.
    const consumptionLimit = currentConsumptionLimit();
    if (!consumptionLimit.valid) return dhwSafeStop(consumptionLimit.reason);
    let consumptionCapW = consumptionLimit.budgetW === null ? Infinity
        : Math.max(0, Number(consumptionLimit.budgetW));
    if (!Number.isFinite(consumptionCapW) && consumptionCapW !== Infinity)
        return dhwSafeStop('gemeinsames Netzbetreiberbudget ungueltig');
    if (consumptionCapW !== Infinity) {
        const coordinated = typeof coordinatedEnergyEnabled === 'function' && coordinatedEnergyEnabled();
        if (coordinated && typeof coordinatedConsumptionLoads === 'function') {
            const loads = coordinatedConsumptionLoads();
            if (!loads.valid) return dhwSafeStop('Gemeinsame Verbrauchermessung fuer Netzbetreiberbudget fehlt');
            consumptionCapW = Math.max(0, consumptionCapW - Math.max(0, loads.totalW - loads.dhwW));
        } else {
        const measurementAgeS = Number(nativeConfig.wallboxMeasurementMaxAgeS ?? 30);
        const wallboxMaxAgeMs = (Number.isFinite(measurementAgeS)
            ? Math.max(5, measurementAgeS) : 30) * 1000;
        for (const wb of [0, 1, 2]) {
            const prefix = `${r}.Devices.Wallbox${wb}`;
            if (![`${prefix}.Present`, `${prefix}.OutputOwned`, `${prefix}.OutputActive`]
                .some(id => getState(id)?.val === true)) continue;
            const wallboxKW = validDhwOutputNumber(CFG.dp.wallboxesKW?.[wb], wallboxMaxAgeMs);
            if (wallboxKW === null || wallboxKW < 0)
                return dhwSafeStop(`Wallbox ${wb}: Leistung fuer gemeinsames Netzbetreiberbudget fehlt/veraltet`);
            consumptionCapW = Math.max(0, consumptionCapW - wallboxKW * 1000);
        }
        }
    }
    const systemLastUpdate = Number(getState(`${r}.System.LastUpdate`)?.val) || 0;
    const controlLastUpdate = Number(getState(`${r}.Control.LastUpdate`)?.val) || 0;
    if (Date.now() - systemLastUpdate > 30000) return dhwSafeStop('EMS-Aktualisierung veraltet');
    if (Date.now() - controlLastUpdate > 10000) return dhwSafeStop('Regler-Aktualisierung veraltet');
    if (CFG.dp.haCritical && Boolean(getState(CFG.dp.haCritical)?.val)) {
        return dhwSafeStop('Hausanschlussschutz aktiv');
    }
    const connection = getState(CFG.dp.myPvDhwConnection);
    if (![true, 1, '1'].includes(connection?.val) || connection.ack === false
        || (connection.q !== undefined && Number(connection.q) !== 0)) return dhwSafeStop('AC THOR offline/Verbindungsstatus ungueltig');
    // Reevaluate the measured temperature protection on every productive tick,
    // not only when the slower simulation happens to refresh its derived cap.
    if (typeof evaluateDhwSimulation === 'function') evaluateDhwSimulation();
    if (!Boolean(getState(`${r}.Devices.MyPV_DHW.Release`)?.val)) return dhwSafeStop('Temperaturfreigabe aus');

    const actualW = mirrorDhwActualPower();
    if (actualW === null) return dhwSafeStop('Ausgangsleistung fehlt oder ist veraltet');
    const gridW = directGridPowerW();
    if (gridW === null) return dhwSafeStop('direkte NVP-Leistung fehlt oder ist veraltet');

    const tankMaxAgeMs = Math.max(5, readNumber(
        `${r}.Config.DHWTemperatureMaxAge_min`, 60)) * 60 * 1000;
    const temperatures = CFG.dp.dhwTemps.map(id => validDhwOutputNumber(id, tankMaxAgeMs));
    const outletC = validDhwOutputNumber(CFG.dp.myPvDhwOutletTemp);
    if (temperatures.length !== 4 || temperatures.some(value => value === null) || outletC === null) {
        return dhwSafeStop('Temperaturwert fehlt oder ist veraltet');
    }
    const topLimitC = readNumber(`${r}.Config.DHWControllerTopEmergencyStop_C`, 82);
    if (Math.max(...temperatures) >= topLimitC) return dhwSafeStop('obere Temperaturgrenze erreicht');

    const simulatedW = Math.max(0, readNumber(`${r}.Control.Targets.MyPV_DHW_W`, 0));
    const temperatureLimitW = Math.max(0,
        readNumber(`${r}.Devices.MyPV_DHW.TemperaturePowerLimit_W`, 0));
    const commissioningMaxW = Math.max(0, Math.min(9000,
        readNumber(`${r}.Config.DHWCommissioningMaxPower_W`, 1000)));
    const releaseCapW = phaseLimitedDhwPower(Math.min(temperatureLimitW, commissioningMaxW));
    const allocationCapW = Math.min(releaseCapW, simulatedW, consumptionCapW);
    const maxStepW = Math.max(100, readNumber(`${r}.Config.DHWMaxStep_W`, 1000));
    const fastIncreaseMaxStepW = Math.max(maxStepW,
        readNumber(`${r}.Config.DHWFastIncreaseMaxStep_W`, 3000));
    const targetGridW = readNumber(`${r}.Control.TargetGridPower_W`, -100);
    const deadbandW = Math.max(0, readNumber(`${r}.Control.Deadband_W`, 100));
    const gridErrorW = gridW - targetGridW;
    const fineRegulation = typeof heaterUsesGridFeedback !== 'function'
        || heaterUsesGridFeedback('MyPV_DHW');
    const actuatorDifferenceW = actualW - dhwLastCommandW;
    const settleToleranceW = Math.max(50,
        readNumber(`${r}.Config.DHWSettleTolerance_W`, 300));
    const settleTimeoutMs = Math.max(5,
        readNumber(`${r}.Config.DHWSettleTimeout_s`, 15)) * 1000;
    const commandAgeMs = dhwLastCommandAt > 0 ? Date.now() - dhwLastCommandAt : settleTimeoutMs;
    const actuatorSettled = Math.abs(actuatorDifferenceW) <= settleToleranceW;
    const timedOut = commandAgeMs >= settleTimeoutMs;
    // Once the AC THOR has reached its previous command, residual export can be
    // absorbed in one larger feedback-based step. An unsettled actuator keeps
    // the conservative normal ramp so commands cannot wind up.
    const stepW = adaptiveDhwStepW(gridErrorW, maxStepW, deadbandW,
        actuatorSettled ? fastIncreaseMaxStepW : maxStepW);
    let desiredW = dhwLastCommandW;
    let reason = `Totband: NVP ${gridW} W`;

    if (simulatedW <= 0) {
        desiredW = 0;
        reason = 'Fahrplan-/EMS-Freigabe ohne Leistungsbudget';
    } else if (!fineRegulation) {
        // With battery fine regulation, another EHZ fine leader or deliberate
        // cheap-energy import, this actuator follows only the central budget.
        // A second NVP loop would otherwise cancel the intentional allocation.
        desiredW = actuatorSettled || allocationCapW < dhwLastCommandW
            ? allocationCapW : dhwLastCommandW;
        reason = `Zentrales Leistungsbudget ${Math.round(allocationCapW)} W; kein eigener NVP-Regler`;
    } else if (gridErrorW > deadbandW) {
        // If a previous reduction is still pending, actual power can exceed
        // the last command. A positive grid error must never raise that command.
        desiredW = Math.min(dhwLastCommandW, Math.max(0, actualW - gridErrorW));
        reason = `Netzbezug: sofort reduzieren (${gridW} W am NVP)`;
    } else if (gridErrorW < -deadbandW) {
        if (actuatorSettled) {
            desiredW = Math.min(allocationCapW, actualW - gridErrorW);
            reason = `Ueberschuss: Aktor eingeregelt, erhoehen (${gridW} W am NVP)`;
        } else reason = `${timedOut ? 'AC THOR folgt Befehl nicht; keine weitere Erhoehung' : 'Warten auf AC THOR'}: Ist ${Math.round(actualW)} W / Befehl ${dhwLastCommandW} W`;
    }

    desiredW = Math.max(0, Math.min(allocationCapW, desiredW));
    // A reduced allocator/temperature/safety cap must win immediately. In
    // particular, the EHZ has to relinquish power before a wallbox step starts.
    const effectiveStepW = fineRegulation ? stepW : maxStepW;
    const rampedCommandW = limitedDhwCommand(
        simulatedW, dhwLastCommandW, allocationCapW, effectiveStepW, desiredW);
    // AC THOR staging is not monotonic per phase: e.g. a safe 6,030-W
    // endpoint does not make an intermediate 3,000-W L1-only step safe.
    // Check the actual ramp command's stage topology, not only its upper cap.
    const commandW = phaseLimitedDhwPower(rampedCommandW);
    if (commandW < rampedCommandW || releaseCapW < Math.min(temperatureLimitW, commissioningMaxW))
        reason += '; Hausanschluss-Phasengrenze begrenzt aktuelle Rampenstufe';
    if (!writeDhwSetpoint(commandW)) {
        return dhwSafeStop('Schreibzugriff vom Adapter blockiert');
    }
    if (commandW === 0 && dhwOutputWasActive) dhwStopPending = true;
    const commandChanged = commandW !== dhwLastCommandW;
    if (commandChanged || dhwLastCommandAt === 0) dhwLastCommandAt = Date.now();
    dhwLastCommandW = commandW;
    dhwOutputWasActive = commandW > 0;
    const predictedGridW = Math.round(gridW + commandW - actualW);
    write(`${r}.Devices.MyPV_DHW.DirectGridPower_W`, gridW);
    write(`${r}.Devices.MyPV_DHW.ActuatorSettled`, !commandChanged
        && Math.abs(actualW - commandW) <= settleToleranceW);
    write(`${r}.Devices.MyPV_DHW.ActuatorDifference_W`, Math.round(actualW - commandW));
    write(`${r}.Devices.MyPV_DHW.CommandAge_s`, commandChanged ? 0 : Math.round(commandAgeMs / 100) / 10);
    write(`${r}.Devices.MyPV_DHW.EffectiveStep_W`, effectiveStepW);
    write(`${r}.Devices.MyPV_DHW.ProductionRemainingError_W`, predictedGridW - targetGridW);
    write(`${r}.Devices.MyPV_DHW.ControlReason`, reason);
    dhwOutputStatus(commandW > 0, commandW,
        `PRODUKTIV${combined.allowed ? ' KOMBI/FEINREGLER' : ''}: ${commandW} W; ${reason}; Grenze ${commissioningMaxW} W`, true);
}
