/* Guarded production output for the my-PV DHW heater.
 * No write is possible unless global, device and data-valid gates are true.
 */
'use strict';

let dhwOutputWasActive = false;
let dhwLastCommandW = 0;
let dhwLastCommandAt = 0;
let dhwStage2LockUntil = 0;
let dhwStage3LockUntil = 0;

function dhwCombinedProductionState() {
    const selected = [0, 1, 2].filter(wb =>
        Boolean(getState(`${CFG.root}.Devices.Wallbox${wb}.ControlEnabled`)?.val));
    if (!selected.length) return {requested: false, allowed: false, reason: ''};
    const release = readBooleanInput(CFG.dp.dhwParallelRelease);
    const alphaScope = nativeConfig.multiWallboxAlphaArmed === true && selected.length > 1;
    const scopeConfirmed = selected.length === 1 || alphaScope;
    const allWallboxesArmed = selected.every(wb => nativeConfig[`wb${wb}ProductionArmed`] === true);
    const allowed = scopeConfirmed && allWallboxesArmed
        && Boolean(getState(`${CFG.root}.Config.DHWParallelDistributionEnabled`)?.val)
        && nativeConfig.combinedProductionArmed === true
        && release === true;
    let reason = '';
    if (!scopeConfirmed) reason = 'mehrere Wallboxen erfordern die ALPHA-Mehrgeraetefreigabe';
    else if (!allWallboxesArmed) reason = 'nicht alle freigegebenen Wallboxen sind einzeln bestaetigt';
    else if (nativeConfig.combinedProductionArmed !== true) reason = 'Kombinationstest nicht bestaetigt';
    else if (release !== true) reason = 'externes Aufteilungsobjekt aus/ungueltig';
    else if (!Boolean(getState(`${CFG.root}.Config.DHWParallelDistributionEnabled`)?.val))
        reason = 'gemeinsame Verteilung in Konfiguration deaktiviert';
    return {requested: true, allowed, reason};
}

function dhwOutputStatus(active, commandW, status, wrote = false) {
    const base = `${CFG.root}.Devices.MyPV_DHW`;
    write(`${base}.OutputActive`, active);
    write(`${base}.OutputCommand_W`, Math.round(commandW));
    write(`${base}.OutputStatus`, status);
    if (wrote) write(`${base}.OutputLastWrite`, Date.now());
    const wallboxOwned = [0, 1, 2].some(wb =>
        getState(`${CFG.root}.Devices.Wallbox${wb}.OutputOwned`)?.val === true);
    write(`${CFG.root}.System.NoActuation`, !active && !wallboxOwned);
    const alpha = nativeConfig.multiWallboxAlphaArmed === true;
    write(`${CFG.root}.Control.Mode`, alpha
        ? active && wallboxOwned ? 'ALPHA_WALLBOX_DHW'
            : active ? 'ALPHA_DHW' : wallboxOwned ? 'ALPHA_WALLBOX' : 'ALPHA_READY'
        : active && wallboxOwned ? 'WALLBOX_DHW_COMBINED'
            : active ? 'DHW_PRODUCTION' : wallboxOwned ? 'WALLBOX_SINGLE_TEST' : 'SIMULATION');
}

function dhwSafeStop(reason) {
    if (dhwOutputWasActive && CFG.dp.myPvDhwSetpoint) {
        writeForeignState(CFG.dp.myPvDhwSetpoint, 0);
        if (CFG.dp.myPvDhwActualMirror) writeForeignState(CFG.dp.myPvDhwActualMirror, 0);
        dhwLastCommandW = 0;
        dhwOutputWasActive = false;
        dhwOutputStatus(false, 0, `Sicher abgeschaltet: ${reason}`, true);
    } else dhwOutputStatus(false, 0, `Gesperrt: ${reason}`);
}

function validDhwOutputNumber(id, maximumAgeMs = CFG.dataMaxAgeMs) {
    if (!id || !existsState(id)) return null;
    const state = getState(id);
    const value = Number(state?.val);
    if (!Number.isFinite(value) || Date.now() - Number(state?.ts || 0) > maximumAgeMs) return null;
    return value;
}

function phaseLimitedDhwPower(requestedW) {
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
    const connectionLimitA = Math.max(1,
        readNumber(`${CFG.root}.Config.DHWHouseConnectionLimit_A`, 50));
    const allowed = [0, 1, 2].map(index => {
        let measuredA;
        if (directionalConfigured) {
            const importW = validDhwOutputNumber(importIds[index]);
            const exportW = validDhwOutputNumber(exportIds[index]);
            measuredA = gridConstraints.netImportCurrentA(importW, exportW);
        } else measuredA = validDhwOutputNumber(currentIds[index]);
        const actualW = validDhwOutputNumber(outputIds[index]);
        if (measuredA === null || actualW === null) return null;
        const freeA = Math.max(0, connectionLimitA - measuredA);
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

function adaptiveDhwStepW(errorW, maximumStepW, deadbandW) {
    const deviationW = Math.abs(errorW);
    if (deviationW <= deadbandW) return 0;
    if (deviationW <= 500) return Math.min(maximumStepW, 200);
    if (deviationW <= 1500) return Math.min(maximumStepW, 500);
    return maximumStepW;
}

function limitedDhwCommand(simulatedW, lastCommandW, allocationCapW, stepW, desiredW) {
    if (simulatedW <= 0) return 0;
    if (lastCommandW > allocationCapW) return Math.round(allocationCapW);
    if (stepW === 0) return Math.round(lastCommandW);
    const lowerW = Math.max(0, lastCommandW - stepW);
    const upperW = Math.min(allocationCapW, lastCommandW + stepW);
    return Math.round(Math.max(lowerW, Math.min(upperW, desiredW)));
}

function updateDhwProductionOutput() {
    const r = CFG.root;
    const globalEnabled = Boolean(getState(`${r}.System.RealOutputsEnabled`)?.val);
    const present = Boolean(getState(`${r}.Devices.MyPV_DHW.Present`)?.val);
    const controlEnabled = Boolean(getState(`${r}.Devices.MyPV_DHW.ControlEnabled`)?.val);
    if (!globalEnabled) return dhwSafeStop('globale Schreibfreigabe aus');
    if (!present) return dhwSafeStop('Trinkwasser-EHZ nicht vorhanden');
    if (!controlEnabled) return dhwSafeStop('EHZ-Steuerfreigabe aus');
    const combined = dhwCombinedProductionState();
    if (combined.requested && !combined.allowed)
        return dhwSafeStop(`gemeinsame Produktion gesperrt: ${combined.reason}`);
    if (!CFG.dp.myPvDhwSetpoint) return dhwSafeStop('kein Sollwert-Datenpunkt konfiguriert');
    if (!Boolean(getState(`${r}.System.DataValid`)?.val)) return dhwSafeStop('EMS-Eingangsdaten ungueltig');
    if (!Boolean(getState(`${r}.Control.Valid`)?.val)) return dhwSafeStop('Echtzeitregler ungueltig');
    const systemLastUpdate = Number(getState(`${r}.System.LastUpdate`)?.val) || 0;
    const controlLastUpdate = Number(getState(`${r}.Control.LastUpdate`)?.val) || 0;
    if (Date.now() - systemLastUpdate > 30000) return dhwSafeStop('EMS-Aktualisierung veraltet');
    if (Date.now() - controlLastUpdate > 10000) return dhwSafeStop('Regler-Aktualisierung veraltet');
    if (CFG.dp.haCritical && Boolean(getState(CFG.dp.haCritical)?.val)) {
        return dhwSafeStop('Hausanschlussschutz aktiv');
    }
    if (!Boolean(getState(CFG.dp.myPvDhwConnection)?.val)) return dhwSafeStop('AC THOR offline');
    if (!Boolean(getState(`${r}.Devices.MyPV_DHW.Release`)?.val)) return dhwSafeStop('Temperaturfreigabe aus');

    const actualW = mirrorDhwActualPower();
    if (actualW === null) return dhwSafeStop('Ausgangsleistung fehlt oder ist veraltet');
    const gridW = directGridPowerW();
    if (gridW === null) return dhwSafeStop('direkte NVP-Leistung fehlt oder ist veraltet');

    const tankMaxAgeMs = Math.max(5, readNumber(
        `${r}.Config.DHWTemperatureMaxAge_min`, 60)) * 60 * 1000;
    const temperatures = CFG.dp.dhwTemps.map(id => validDhwOutputNumber(id, tankMaxAgeMs));
    const outletC = validDhwOutputNumber(CFG.dp.myPvDhwOutletTemp);
    if (temperatures.some(value => value === null) || outletC === null) {
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
    const allocationCapW = combined.allowed ? Math.min(releaseCapW, simulatedW) : releaseCapW;
    const maxStepW = Math.max(100, readNumber(`${r}.Config.DHWMaxStep_W`, 1000));
    const targetGridW = readNumber(`${r}.Control.TargetGridPower_W`, -100);
    const deadbandW = Math.max(0, readNumber(`${r}.Control.Deadband_W`, 100));
    const gridErrorW = gridW - targetGridW;
    const actuatorDifferenceW = actualW - dhwLastCommandW;
    const settleToleranceW = Math.max(50,
        readNumber(`${r}.Config.DHWSettleTolerance_W`, 300));
    const settleTimeoutMs = Math.max(5,
        readNumber(`${r}.Config.DHWSettleTimeout_s`, 15)) * 1000;
    const commandAgeMs = dhwLastCommandAt > 0 ? Date.now() - dhwLastCommandAt : settleTimeoutMs;
    const actuatorSettled = Math.abs(actuatorDifferenceW) <= settleToleranceW;
    const timedOut = commandAgeMs >= settleTimeoutMs;
    const stepW = adaptiveDhwStepW(gridErrorW, maxStepW, deadbandW);
    let desiredW = dhwLastCommandW;
    let reason = `Totband: NVP ${gridW} W`;

    if (simulatedW <= 0) {
        desiredW = 0;
        reason = 'Fahrplan-/EMS-Freigabe ohne Leistungsbudget';
    } else if (gridErrorW > deadbandW) {
        desiredW = Math.max(0, actualW - gridErrorW);
        reason = `Netzbezug: sofort reduzieren (${gridW} W am NVP)`;
    } else if (gridErrorW < -deadbandW) {
        if (actuatorSettled || timedOut) {
            desiredW = Math.min(allocationCapW, actualW - gridErrorW);
            reason = actuatorSettled
                ? `Ueberschuss: Aktor eingeregelt, erhoehen (${gridW} W am NVP)`
                : `Ueberschuss: Wartezeit abgelaufen, vorsichtig erhoehen (${gridW} W am NVP)`;
        } else reason = `Warten auf AC THOR: Ist ${Math.round(actualW)} W / Befehl ${dhwLastCommandW} W`;
    }

    desiredW = Math.max(0, Math.min(allocationCapW, desiredW));
    // A reduced allocator/temperature/safety cap must win immediately. In
    // particular, the EHZ has to relinquish power before a wallbox step starts.
    const commandW = limitedDhwCommand(
        simulatedW, dhwLastCommandW, allocationCapW, stepW, desiredW);
    if (!writeForeignState(CFG.dp.myPvDhwSetpoint, commandW)) {
        return dhwSafeStop('Schreibzugriff vom Adapter blockiert');
    }
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
    write(`${r}.Devices.MyPV_DHW.EffectiveStep_W`, stepW);
    write(`${r}.Devices.MyPV_DHW.ProductionRemainingError_W`, predictedGridW - targetGridW);
    write(`${r}.Devices.MyPV_DHW.ControlReason`, reason);
    dhwOutputStatus(commandW > 0, commandW,
        `PRODUKTIV${combined.allowed ? ' KOMBI/FEINREGLER' : ''}: ${commandW} W; ${reason}; Grenze ${commissioningMaxW} W`, true);
}
