/*
 * Simulierter Controller fuer my-PV Trinkwasser.
 * Die Grenzwerte entsprechen dem aktiven EHZ-Leistung-V2-Skript.
 * Es werden ausschliesslich EMS-Ziel- und Diagnosestates beschrieben.
 */

'use strict';

let dhwTemperatureLock = null;
let dhwLastSimulatedTargetW = 0;

function freshDhwNumber(id, maxAgeMs = 5 * 60 * 1000) {
    if (!id || !existsState(id)) return null;
    const state = getState(id);
    const value = Number(state?.val);
    return Number.isFinite(value) && Date.now() - Number(state?.ts || 0) <= maxAgeMs
        ? value : null;
}

function evaluateDhwSimulation() {
    const r = `${CFG.root}.Devices.MyPV_DHW`;
    const temperatures = CFG.dp.dhwTemps.map(id => freshDhwNumber(id));
    const outletTemperature = freshDhwNumber(CFG.dp.myPvDhwOutletTemp);
    const connectionState = CFG.dp.myPvDhwConnection && existsState(CFG.dp.myPvDhwConnection)
        ? getState(CFG.dp.myPvDhwConnection) : null;
    const available = Boolean(getState(`${CFG.root}.Devices.MyPV_DHW.Present`)?.val)
        && Boolean(connectionState?.val);
    const existingRelease = Boolean(getState(CFG.dp.myPvDhwRelease)?.val);
    const valid = temperatures.every(Number.isFinite) && Number.isFinite(outletTemperature);
    const bottom = temperatures[0] || 0;
    const middleLower = temperatures[1] || 0;
    const middleUpper = temperatures[2] || 0;
    const top = temperatures[3] || 0;
    const average = valid ? temperatures.reduce((sumC, valueC) => sumC + valueC, 0) / 4 : 0;
    const maxPower = Math.max(0, Math.min(CFG.limits.myPvDhwMaxW,
        readNumber(`${CFG.root}.Config.DHWControllerMaxPower_W`, 9000)));
    const stopTemperature = readNumber(`${CFG.root}.Config.DHWControllerStopTemperature_C`, 76);
    const resumeTemperature = readNumber(`${CFG.root}.Config.DHWControllerResumeTemperature_C`, 75.5);
    const topEmergencyStop = readNumber(`${CFG.root}.Config.DHWControllerTopEmergencyStop_C`, 82);
    const outletDerating = readNumber(`${CFG.root}.Config.DHWControllerOutletDerating_C`, 60);
    const outletProtection = readNumber(`${CFG.root}.Config.DHWControllerOutletProtection_C`, 76);
    const minimumTemperature = readNumber(`${CFG.root}.Config.DHWMinTemperature_C`, 48);

    if (dhwTemperatureLock === null) {
        dhwTemperatureLock = Boolean(getState(CFG.dp.myPvDhwHysteresis)?.val);
    }
    if (valid && (bottom >= stopTemperature || top >= topEmergencyStop)) dhwTemperatureLock = true;
    if (valid && bottom <= resumeTemperature && top < topEmergencyStop) dhwTemperatureLock = false;

    let temperaturePowerLimitW = maxPower;
    let reason = 'Bis 9 kW temperaturseitig verfuegbar';
    if (!available) {
        temperaturePowerLimitW = 0;
        reason = 'my-PV-Verbindung nicht verfuegbar';
    } else if (!valid) {
        temperaturePowerLimitW = 0;
        reason = 'Temperaturwert fehlt oder ist veraltet';
    } else if (dhwTemperatureLock) {
        temperaturePowerLimitW = 0;
        reason = `Temperatur-Hysterese aktiv (unten ${bottom.toFixed(1)} °C, oben ${top.toFixed(1)} °C)`;
    } else if (outletTemperature >= outletProtection) {
        temperaturePowerLimitW = Math.min(3000, maxPower);
        reason = `Leitungsschutz: Ausgang ${outletTemperature.toFixed(1)} °C`;
    } else if (outletTemperature > outletDerating) {
        const t1 = readNumber(`${CFG.root}.Config.DHWCurve1Temperature_C`, 70);
        const t2 = readNumber(`${CFG.root}.Config.DHWCurve2Temperature_C`, 71);
        const t3 = readNumber(`${CFG.root}.Config.DHWCurve3Temperature_C`, 73);
        const t4 = readNumber(`${CFG.root}.Config.DHWCurve4Temperature_C`, 74);
        if (bottom >= t4) temperaturePowerLimitW = Math.min(
            readNumber(`${CFG.root}.Config.DHWCurve74Power_W`, 3000), maxPower);
        else if (bottom >= t3) temperaturePowerLimitW = Math.min(
            readNumber(`${CFG.root}.Config.DHWCurve73Power_W`, 4000), maxPower);
        else if (bottom >= t2) temperaturePowerLimitW = Math.min(
            readNumber(`${CFG.root}.Config.DHWCurve71Power_W`, 6000), maxPower);
        else if (bottom >= t1) temperaturePowerLimitW = Math.min(
            readNumber(`${CFG.root}.Config.DHWCurve70Power_W`, 7500), maxPower);
        if (temperaturePowerLimitW < maxPower) {
            reason = `Temperaturkennlinie: unten ${bottom.toFixed(1)} °C, Ausgang ${outletTemperature.toFixed(1)} °C`;
        }
    }

    const mustHeat = valid && middleLower < minimumTemperature;
    const release = available && valid && temperaturePowerLimitW > 0;
    const remainingCapacityKWh = valid
        ? Math.max(0, readNumber(`${CFG.root}.Config.DHWVolume_l`, 500)
            * 1.163 * (stopTemperature - average) / 1000)
        : 0;
    const actualPowerW = readNumber(`${CFG.root}.Actual.MyPV_DHW_W`, 0);
    const planItem = typeof currentPlanItem === 'function'
        ? currentPlanItem('MyPV_DHW', Date.now()) : null;
    const plannedPowerW = Math.max(0, Number(planItem?.valueW) || 0);

    write(`${r}.Available`, available);
    write(`${r}.ExistingRelease`, existingRelease);
    write(`${r}.Release`, release);
    write(`${r}.MustHeat`, mustHeat);
    write(`${r}.BottomTemperature_C`, Math.round(bottom * 10) / 10);
    write(`${r}.MiddleLowerTemperature_C`, Math.round(middleLower * 10) / 10);
    write(`${r}.MiddleUpperTemperature_C`, Math.round(middleUpper * 10) / 10);
    write(`${r}.TopTemperature_C`, Math.round(top * 10) / 10);
    write(`${r}.AverageTemperature_C`, Math.round(average * 10) / 10);
    write(`${r}.OutletTemperature_C`, Math.round((outletTemperature || 0) * 10) / 10);
    write(`${r}.RemainingCapacity_kWh`, Math.round(remainingCapacityKWh * 100) / 100);
    write(`${r}.ActualPower_W`, Math.round(actualPowerW));
    write(`${r}.PlannedPower_W`, Math.round(plannedPowerW));
    write(`${r}.TemperaturePowerLimit_W`, Math.round(temperaturePowerLimitW));
    write(`${r}.TemperatureLock`, Boolean(dhwTemperatureLock));
    write(`${r}.Status`, `${mustHeat ? 'Pflichtwaermebedarf; ' : ''}${reason}; nur Simulation`);

    return {available, valid, release, mustHeat, bottom, top, outletTemperature,
        temperaturePowerLimitW, remainingCapacityKWh, reason};
}

function simulateDhwTarget(requestedPowerW) {
    const r = `${CFG.root}.Devices.MyPV_DHW`;
    const status = evaluateDhwSimulation();
    let targetW = status.release
        ? Math.max(0, Math.min(Number(requestedPowerW) || 0, status.temperaturePowerLimitW))
        : 0;

    // Schichtungslogik aus dem Bestandsskript: sehr kleine Leistung bei stark
    // geschichtetem Speicher vermeiden.
    if (status.valid && status.top - status.bottom > 15 && targetW < 900) targetW = 0;
    else if (status.valid && status.top > 35 && targetW < 500) targetW = 0;

    // Aufruf durch den langsamen Regler alle 10 s, wie im Bestandsskript.
    const maximumStepW = Math.max(100,
        readNumber(`${CFG.root}.Config.DHWMaxStep_W`, 1000));
    targetW = Math.max(dhwLastSimulatedTargetW - maximumStepW,
        Math.min(dhwLastSimulatedTargetW + maximumStepW, targetW));
    targetW = Math.max(0, Math.min(status.temperaturePowerLimitW,
        Math.floor(targetW / 100) * 100));
    dhwLastSimulatedTargetW = targetW;
    write(`${r}.SimulatedTargetPower_W`, targetW);
    return targetW;
}

function updateDhwSimulation() {
    evaluateDhwSimulation();
}
