/* Zweistufiger NVP-Regler, ausschliesslich Simulation.
 * Batterie alle 2 s; Wallboxen und Heizstaebe alle 10 s.
 */
'use strict';

function parsePlanSeries(id) {
    try {
        const raw = getState(id)?.val;
        const series = typeof raw === 'string' ? JSON.parse(raw) : raw;
        return Array.isArray(series) ? series : [];
    } catch (_) { return []; }
}

function currentPlanItem(name, now) {
    const series = parsePlanSeries(`${CFG.root}.Plan.${name}_48h_JSON`);
    if (!series.length) return null;
    let selected = series[0];
    for (const item of series) {
        if (Number(item.timestamp) <= now) selected = item;
        else break;
    }
    return selected;
}

function clamp(value, minimum, maximum) { return Math.max(minimum, Math.min(maximum, value)); }

let realtimeParallelActive = false;
let lastSlowUpdate = 0;
let slowTargets = {dhwW: 0, heatingW: 0, wallboxW: [0, 0, 0], wallboxA: [0, 0, 0]};

function splitRealtimePair(availableW, dhwCapW, wallboxCapW, sharePct) {
    const share = clamp(sharePct / 100, 0, 1);
    let dhwW = Math.min(dhwCapW, availableW * share);
    let wallboxW = Math.min(wallboxCapW, availableW - dhwW);
    let remainderW = Math.max(0, availableW - dhwW - wallboxW);
    const extraDhwW = Math.min(remainderW, Math.max(0, dhwCapW - dhwW));
    dhwW += extraDhwW;
    remainderW -= extraDhwW;
    wallboxW += Math.min(remainderW, Math.max(0, wallboxCapW - wallboxW));
    return {dhwW, wallboxW};
}

function quantizeWallbox(requestedW, vehicle, previousA) {
    const phases = Math.max(1, Math.min(3, Math.round(vehicle.detectedPhases || 1)));
    const voltage = Math.max(200, readNumber(`${CFG.root}.Config.WallboxNominalVoltage_V`, 230));
    const maximumA = Math.max(6, Math.floor(vehicle.maximumPowerW / (voltage * phases)));
    const rampA = Math.max(1, Math.round(readNumber(`${CFG.root}.Config.WallboxMaxStep_A`, 6)));
    let requestedA = Math.floor(Math.max(0, requestedW) / (voltage * phases));
    if (requestedA < 6) requestedA = 0;
    requestedA = Math.min(maximumA, requestedA);
    let targetA = clamp(requestedA, Math.max(0, previousA - rampA),
        Math.min(maximumA, previousA + rampA));
    if (targetA > 0 && targetA < 6) targetA = requestedA >= 6 ? 6 : 0;
    return {amps: targetA, powerW: Math.round(targetA * voltage * phases)};
}

function resetSlowTargets() {
    realtimeParallelActive = false;
    lastSlowUpdate = 0;
    slowTargets = {dhwW: 0, heatingW: 0, wallboxW: [0, 0, 0], wallboxA: [0, 0, 0]};
}

function zeroRealtimeTargets(status) {
    const r = CFG.root;
    resetSlowTargets();
    write(`${r}.Control.Valid`, false);
    write(`${r}.Control.Status`, status);
    write(`${r}.Control.Targets.Battery_W`, 0);
    write(`${r}.Control.Targets.MyPV_DHW_W`, 0);
    write(`${r}.Control.Targets.MyPV_Heating_W`, 0);
    [0, 1, 2].forEach(wb => {
        write(`${r}.Control.Targets.Wallbox${wb}_W`, 0);
        write(`${r}.Control.Targets.Wallbox${wb}_A`, 0);
    });
    write(`${r}.Control.Targets.PVBoostRelease`, false);
    write(`${r}.Control.ParallelDistributionActive`, false);
    write(`${r}.Control.LastUpdate`, Date.now());
}

function selectRealtimeWallbox(wallboxPlans) {
    const candidates = [0, 1, 2].map(wb => ({
        wb, vehicle: vehicleState(wb),
        plannedW: Math.max(0, Number(wallboxPlans[wb]?.valueW) || 0)
    })).filter(x => x.vehicle.release);
    candidates.sort((a, b) => Number(b.plannedW > 0) - Number(a.plannedW > 0)
        || b.vehicle.effectivePriorityScore - a.vehicle.effectivePriorityScore
        || Number(b.vehicle.mustCharge) - Number(a.vehicle.mustCharge)
        || a.vehicle.latestStartTimestamp - b.vehicle.latestStartTimestamp);
    return candidates[0] || null;
}

function updateSlowTargets(requiredControlledW, wallboxPlans, heatingPlan) {
    const r = CFG.root;
    const selected = selectRealtimeWallbox(wallboxPlans);
    const selectedWallbox = selected?.wb ?? null;
    const activeVehicle = selected?.vehicle || null;
    const dhwReleased = Boolean(getState(`${r}.Devices.MyPV_DHW.Release`)?.val);
    const dhwCapW = dhwReleased
        ? Math.max(0, readNumber(`${r}.Devices.MyPV_DHW.TemperaturePowerLimit_W`, 0)) : 0;
    const heatingCapW = Math.max(0, Number(heatingPlan.valueW) || 0);
    const wallboxCapW = activeVehicle ? activeVehicle.maximumPowerW : 0;
    const availableSlowW = clamp(requiredControlledW, 0, dhwCapW + heatingCapW + wallboxCapW);
    const heatingTargetW = Math.min(heatingCapW, availableSlowW);
    const pairAvailableW = Math.max(0, availableSlowW - heatingTargetW);
    const threePhase = activeVehicle?.detectedPhases >= 3;
    const startThresholdW = threePhase
        ? readNumber(`${r}.Config.DHWParallelStartPower3P_W`, 9000)
        : readNumber(`${r}.Config.DHWParallelStartPower1P_W`, 4000);
    const stopThresholdW = threePhase
        ? readNumber(`${r}.Config.DHWParallelStopPower3P_W`, 8000)
        : readNumber(`${r}.Config.DHWParallelStopPower1P_W`, 3000);
    const parallelEnabled = Boolean(getState(`${r}.Config.DHWParallelDistributionEnabled`)?.val)
        && dhwCapW > 0 && wallboxCapW > 0;
    if (!parallelEnabled) realtimeParallelActive = false;
    else if (realtimeParallelActive && pairAvailableW < stopThresholdW) realtimeParallelActive = false;
    else if (!realtimeParallelActive && pairAvailableW > startThresholdW) realtimeParallelActive = true;

    let requestedDhwW = 0;
    let requestedWallboxW = 0;
    const mustHeat = Boolean(getState(`${r}.Devices.MyPV_DHW.MustHeat`)?.val);
    if (mustHeat) {
        requestedDhwW = Math.min(dhwCapW, pairAvailableW);
        requestedWallboxW = Math.min(wallboxCapW, Math.max(0, pairAvailableW - requestedDhwW));
    } else if (activeVehicle?.mustCharge) {
        requestedWallboxW = Math.min(wallboxCapW, pairAvailableW);
        requestedDhwW = Math.min(dhwCapW, Math.max(0, pairAvailableW - requestedWallboxW));
    } else if (realtimeParallelActive) {
        const pair = splitRealtimePair(pairAvailableW, dhwCapW, wallboxCapW,
            readNumber(`${r}.Config.DHWParallelShare_pct`, 50));
        requestedDhwW = pair.dhwW;
        requestedWallboxW = pair.wallboxW;
    } else if (activeVehicle) {
        requestedWallboxW = Math.min(wallboxCapW, pairAvailableW);
        requestedDhwW = Math.min(dhwCapW, Math.max(0, pairAvailableW - requestedWallboxW));
    } else requestedDhwW = Math.min(dhwCapW, pairAvailableW);

    const nextWallboxW = [0, 0, 0];
    const nextWallboxA = [0, 0, 0];
    const previousOtherActive = slowTargets.wallboxA.some((amps, wb) =>
        wb !== selectedWallbox && amps > 0);
    // Beim Prioritaetswechsel erst die bisherige Wallbox herunterfahren.
    // Dadurch simuliert der Adapter niemals zwei gleichzeitig ladende Autos.
    if (previousOtherActive) {
        [0, 1, 2].forEach(wb => {
            if (slowTargets.wallboxA[wb] <= 0) return;
            const oldVehicle = vehicleState(wb);
            const quantized = quantizeWallbox(0, oldVehicle, slowTargets.wallboxA[wb]);
            nextWallboxW[wb] = quantized.powerW;
            nextWallboxA[wb] = quantized.amps;
        });
    } else if (selectedWallbox !== null && activeVehicle) {
        const quantized = quantizeWallbox(requestedWallboxW, activeVehicle,
            slowTargets.wallboxA[selectedWallbox] || 0);
        nextWallboxW[selectedWallbox] = quantized.powerW;
        nextWallboxA[selectedWallbox] = quantized.amps;
        requestedDhwW += Math.max(0, requestedWallboxW - quantized.powerW);
    }
    const assignedWallboxW = nextWallboxW.reduce((sumW, valueW) => sumW + valueW, 0);
    requestedDhwW = Math.min(requestedDhwW,
        Math.max(0, pairAvailableW - assignedWallboxW));
    slowTargets = {
        dhwW: simulateDhwTarget(Math.min(dhwCapW, Math.round(requestedDhwW))),
        heatingW: Math.round(heatingTargetW), wallboxW: nextWallboxW, wallboxA: nextWallboxA
    };
    write(`${r}.Control.ParallelDistributionActive`, realtimeParallelActive);
    write(`${r}.Control.ParallelDistributionThresholds`,
        `${threePhase ? '3-phasig' : '1-phasig'}: EIN > ${startThresholdW} W, AUS < ${stopThresholdW} W`);
    write(`${r}.Control.SelectedWallbox`, selectedWallbox === null ? -1 : selectedWallbox);
    write(`${r}.Control.SlowLastUpdate`, Date.now());
}

function realtimeControl() {
    const r = CFG.root;
    if (!Boolean(getState(`${r}.Control.Enabled`)?.val)) return zeroRealtimeTargets('Simulation deaktiviert');
    if (!Boolean(getState(`${r}.System.DataValid`)?.val)) return zeroRealtimeTargets('Eingangsdaten ungueltig oder veraltet');
    if (!Boolean(getState(`${r}.Plan.Valid`)?.val)) return zeroRealtimeTargets('Kein gueltiger 48-h-Fahrplan');
    if (CFG.dp.haCritical && Boolean(getState(CFG.dp.haCritical)?.val)) {
        return zeroRealtimeTargets('Hausanschluss-Schutz aktiv – Simulation auf null');
    }
    const now = Date.now();
    const gridW = readNumber(`${r}.Actual.GridPower_W`, 0);
    const targetGridW = readNumber(`${r}.Control.TargetGridPower_W`, -100);
    const deadbandW = Math.max(0, readNumber(`${r}.Control.Deadband_W`, 100));
    const errorW = gridW - targetGridW;
    const desiredChangeW = Math.abs(errorW) <= deadbandW ? 0 : -errorW;
    const batteryPlan = currentPlanItem('BatteryPower', now);
    const dhwPlan = currentPlanItem('MyPV_DHW', now);
    const heatingPlan = currentPlanItem('MyPV_Heating', now);
    const boostPlan = currentPlanItem('PVBoost', now);
    const wallboxPlans = [0, 1, 2].map(wb => currentPlanItem(`Wallbox${wb}`, now));
    if (!batteryPlan || !dhwPlan || !heatingPlan || wallboxPlans.some(item => !item)) {
        return zeroRealtimeTargets('Aktueller Fahrplan-Slot fehlt');
    }

    const actualBatteryW = readNumber(CFG.dp.batteryPower, 0);
    const actualDhwW = readNumber(`${r}.Actual.MyPV_DHW_W`, 0);
    const actualHeatingW = readNumber(`${r}.Actual.MyPV_Heating_W`, 0);
    const actualWallboxW = CFG.dp.wallboxesKW.map(id => Math.max(0, readNumber(id, 0) * 1000));
    const actualControlledW = actualBatteryW + actualDhwW + actualHeatingW
        + actualWallboxW.reduce((sumW, valueW) => sumW + valueW, 0);
    const uncontrolledGridW = gridW - actualControlledW;
    const requiredControlledW = desiredChangeW === 0 ? actualControlledW : targetGridW - uncontrolledGridW;

    const slowCycleMs = Math.max(2, readNumber(`${r}.Config.SlowControlCycle_s`, 10)) * 1000;
    write(`${r}.Control.SlowCycleSeconds`, slowCycleMs / 1000);
    if (lastSlowUpdate === 0 || now - lastSlowUpdate >= slowCycleMs) {
        updateSlowTargets(requiredControlledW, wallboxPlans, heatingPlan);
        lastSlowUpdate = now;
    }
    const allocatedSlowW = slowTargets.dhwW + slowTargets.heatingW
        + slowTargets.wallboxW.reduce((sumW, valueW) => sumW + valueW, 0);
    const soc = readNumber(CFG.dp.batterySoc, readNumber(`${r}.Config.BatteryManualSoC_pct`, 50));
    const minSoc = readNumber(`${r}.Config.BatteryMinSoC_pct`, 0);
    const maxSoc = readNumber(`${r}.Config.BatteryMaxSoC_pct`, 100);
    const maxChargeW = Math.max(0, readNumber(`${r}.Config.BatteryMaxCharge_W`, 2400));
    const maxDischargeW = Math.max(0, readNumber(`${r}.Config.BatteryMaxDischarge_W`, 2400));
    const batteryTargetW = Math.round(clamp(requiredControlledW - allocatedSlowW,
        soc > minSoc ? -maxDischargeW : 0, soc < maxSoc ? maxChargeW : 0));
    const predictedGridW = Math.round(uncontrolledGridW + allocatedSlowW + batteryTargetW);
    const remainingErrorW = predictedGridW - targetGridW;

    write(`${r}.Control.ActualGridPower_W`, Math.round(gridW));
    write(`${r}.Control.PredictedGridPower_W`, predictedGridW);
    write(`${r}.Control.Error_W`, Math.round(errorW));
    write(`${r}.Control.RemainingError_W`, Math.round(remainingErrorW));
    write(`${r}.Control.PlanSlotTimestamp`, Math.max(Number(batteryPlan.timestamp) || 0, Number(dhwPlan.timestamp) || 0));
    write(`${r}.Control.Targets.Battery_W`, batteryTargetW);
    write(`${r}.Control.Targets.MyPV_DHW_W`, slowTargets.dhwW);
    write(`${r}.Control.Targets.MyPV_Heating_W`, slowTargets.heatingW);
    [0, 1, 2].forEach(wb => {
        write(`${r}.Control.Targets.Wallbox${wb}_W`, slowTargets.wallboxW[wb]);
        write(`${r}.Control.Targets.Wallbox${wb}_A`, slowTargets.wallboxA[wb]);
    });
    write(`${r}.Control.Targets.PVBoostRelease`, Boolean(boostPlan?.release) && predictedGridW <= deadbandW);
    write(`${r}.Control.Valid`, true);
    write(`${r}.Control.Status`, Math.abs(remainingErrorW) <= deadbandW
        ? `SIMULATION: Batterie 2 s / langsame Verbraucher ${slowCycleMs / 1000} s; NVP-Ziel erreichbar`
        : `SIMULATION: Stellgrenzen erreicht, Restabweichung ${Math.round(remainingErrorW)} W`);
    write(`${r}.Control.LastUpdate`, now);
    if (desiredChangeW === 0) write(`${r}.Control.Status`, `SIMULATION: innerhalb Totband (${Math.round(gridW)} W)`);
}
