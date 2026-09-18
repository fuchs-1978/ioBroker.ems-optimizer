/* Guarded production output for the my-PV DHW heater.
 * No write is possible unless global, device and data-valid gates are true.
 */
'use strict';

let dhwOutputWasActive = false;
let dhwLastCommandW = 0;
let dhwStage2LockUntil = 0;
let dhwStage3LockUntil = 0;

function dhwOutputStatus(active, commandW, status, wrote = false) {
    const base = `${CFG.root}.Devices.MyPV_DHW`;
    write(`${base}.OutputActive`, active);
    write(`${base}.OutputCommand_W`, Math.round(commandW));
    write(`${base}.OutputStatus`, status);
    if (wrote) write(`${base}.OutputLastWrite`, Date.now());
    write(`${CFG.root}.System.NoActuation`, !active);
    write(`${CFG.root}.Control.Mode`, active ? 'DHW_PRODUCTION' : 'SIMULATION');
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
    if (currentIds.length !== 3 || outputIds.length !== 3) return 0;
    const connectionLimitA = Math.max(1,
        readNumber(`${CFG.root}.Config.DHWHouseConnectionLimit_A`, 50));
    const allowed = [0, 1, 2].map(index => {
        const measuredA = validDhwOutputNumber(currentIds[index]);
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

function updateDhwProductionOutput() {
    const r = CFG.root;
    const globalEnabled = Boolean(getState(`${r}.System.RealOutputsEnabled`)?.val);
    const present = Boolean(getState(`${r}.Devices.MyPV_DHW.Present`)?.val);
    const controlEnabled = Boolean(getState(`${r}.Devices.MyPV_DHW.ControlEnabled`)?.val);
    if (!globalEnabled) return dhwSafeStop('globale Schreibfreigabe aus');
    if (!present) return dhwSafeStop('Trinkwasser-EHZ nicht vorhanden');
    if (!controlEnabled) return dhwSafeStop('EHZ-Steuerfreigabe aus');
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

    if (mirrorDhwActualPower() === null) return dhwSafeStop('Ausgangsleistung fehlt oder ist veraltet');

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
    let requestedW = Math.min(simulatedW, temperatureLimitW, commissioningMaxW);
    requestedW = phaseLimitedDhwPower(requestedW);

    const maxStepW = Math.max(100, readNumber(`${r}.Config.DHWMaxStep_W`, 1000));
    const lowerW = Math.max(0, dhwLastCommandW - maxStepW);
    const upperW = Math.min(commissioningMaxW, dhwLastCommandW + maxStepW);
    const commandW = Math.round(Math.max(lowerW, Math.min(upperW, requestedW)));
    if (!writeForeignState(CFG.dp.myPvDhwSetpoint, commandW)) {
        return dhwSafeStop('Schreibzugriff vom Adapter blockiert');
    }
    dhwLastCommandW = commandW;
    dhwOutputWasActive = true;
    dhwOutputStatus(true, commandW,
        `PRODUKTIV: ${commandW} W; Inbetriebnahmegrenze ${commissioningMaxW} W`, true);
}
