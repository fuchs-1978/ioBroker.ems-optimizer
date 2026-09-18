/*
 * Schneller NVP-Regler – V0.4.0 nur als Simulation.
 *
 * Positive Netzleistung bedeutet Bezug, negative Einspeisung.
 * Positive Batterieleistung bedeutet Laden, negative Entladen.
 * Der Regler schreibt ausschliesslich unter Control.Targets und niemals
 * auf reale Geraetedatenpunkte.
 */

'use strict';

function parsePlanSeries(id) {
    try {
        const raw = getState(id)?.val;
        const series = typeof raw === 'string' ? JSON.parse(raw) : raw;
        return Array.isArray(series) ? series : [];
    } catch (_) {
        return [];
    }
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

function clamp(value, minimum, maximum) {
    return Math.max(minimum, Math.min(maximum, value));
}

let realtimeParallelActive = false;

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

function zeroRealtimeTargets(status) {
    const r = CFG.root;
    realtimeParallelActive = false;
    write(`${r}.Control.Valid`, false);
    write(`${r}.Control.Status`, status);
    write(`${r}.Control.Targets.Battery_W`, 0);
    write(`${r}.Control.Targets.MyPV_DHW_W`, 0);
    write(`${r}.Control.Targets.MyPV_Heating_W`, 0);
    [0, 1, 2].forEach(wb => write(`${r}.Control.Targets.Wallbox${wb}_W`, 0));
    write(`${r}.Control.Targets.PVBoostRelease`, false);
    write(`${r}.Control.ParallelDistributionActive`, false);
    write(`${r}.Control.LastUpdate`, Date.now());
}

function realtimeControl() {
    const r = CFG.root;
    if (!Boolean(getState(`${r}.Control.Enabled`)?.val)) {
        zeroRealtimeTargets('Simulation deaktiviert');
        return;
    }
    if (!Boolean(getState(`${r}.System.DataValid`)?.val)) {
        zeroRealtimeTargets('Eingangsdaten ungueltig oder veraltet');
        return;
    }
    if (!Boolean(getState(`${r}.Plan.Valid`)?.val)) {
        zeroRealtimeTargets('Kein gueltiger 48-h-Fahrplan');
        return;
    }
    if (CFG.dp.haCritical && Boolean(getState(CFG.dp.haCritical)?.val)) {
        zeroRealtimeTargets('Hausanschluss-Schutz aktiv – Simulation auf null');
        return;
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
        zeroRealtimeTargets('Aktueller Fahrplan-Slot fehlt');
        return;
    }

    // Reale derzeitige flexible Leistung. Damit ist die Simulation auch dann
    // nachvollziehbar, wenn der Fahrplan noch keine Aktoren steuert.
    const actualBatteryW = readNumber(CFG.dp.batteryPower, 0);
    const actualDhwW = readNumber(`${r}.Actual.MyPV_DHW_W`, 0);
    const actualHeatingW = readNumber(`${r}.Actual.MyPV_Heating_W`, 0);
    const actualWallboxW = CFG.dp.wallboxesKW.map(id => Math.max(0, readNumber(id, 0) * 1000));
    const actualControlledW = actualBatteryW + actualDhwW + actualHeatingW
        + actualWallboxW.reduce((sumW, valueW) => sumW + valueW, 0);
    const uncontrolledGridW = gridW - actualControlledW;
    const requiredControlledW = desiredChangeW === 0
        ? actualControlledW
        : targetGridW - uncontrolledGridW;

    const dhwCapW = Math.max(0, Number(dhwPlan.valueW) || 0);
    const heatingCapW = Math.max(0, Number(heatingPlan.valueW) || 0);
    const wallboxCapsW = wallboxPlans.map(item => Math.max(0, Number(item.valueW) || 0));
    const selectedWallbox = wallboxCapsW.reduce((best, capW, wb) =>
        capW > wallboxCapsW[best] ? wb : best, 0);
    const activeVehicle = vehicleState(selectedWallbox);
    const wallboxCapW = wallboxCapsW[selectedWallbox];
    const availableSlowW = clamp(requiredControlledW, 0,
        dhwCapW + heatingCapW + wallboxCapsW.reduce((sumW, valueW) => sumW + valueW, 0));
    const heatingTargetW = Math.min(heatingCapW, availableSlowW);
    let pairAvailableW = Math.max(0, availableSlowW - heatingTargetW);
    const startThresholdW = activeVehicle.detectedPhases >= 3
        ? readNumber(`${r}.Config.DHWParallelStartPower3P_W`, 9000)
        : readNumber(`${r}.Config.DHWParallelStartPower1P_W`, 4000);
    const stopThresholdW = activeVehicle.detectedPhases >= 3
        ? readNumber(`${r}.Config.DHWParallelStopPower3P_W`, 8000)
        : readNumber(`${r}.Config.DHWParallelStopPower1P_W`, 3000);
    const parallelEnabled = Boolean(getState(`${r}.Config.DHWParallelDistributionEnabled`)?.val)
        && dhwCapW > 0 && wallboxCapW > 0;
    if (!parallelEnabled) realtimeParallelActive = false;
    else if (realtimeParallelActive && pairAvailableW < stopThresholdW) realtimeParallelActive = false;
    else if (!realtimeParallelActive && pairAvailableW > startThresholdW) realtimeParallelActive = true;

    let dhwTargetW = 0;
    let wallboxTargetW = 0;
    const mustHeat = Boolean(getState(`${r}.Devices.MyPV_DHW.MustHeat`)?.val);
    if (mustHeat) {
        dhwTargetW = Math.min(dhwCapW, pairAvailableW);
        wallboxTargetW = Math.min(wallboxCapW, Math.max(0, pairAvailableW - dhwTargetW));
    } else if (activeVehicle.mustCharge) {
        wallboxTargetW = Math.min(wallboxCapW, pairAvailableW);
        dhwTargetW = Math.min(dhwCapW, Math.max(0, pairAvailableW - wallboxTargetW));
    } else if (realtimeParallelActive) {
        const pair = splitRealtimePair(pairAvailableW, dhwCapW, wallboxCapW,
            readNumber(`${r}.Config.DHWParallelShare_pct`, 50));
        dhwTargetW = pair.dhwW;
        wallboxTargetW = pair.wallboxW;
    } else if (wallboxCapW > 0) {
        wallboxTargetW = Math.min(wallboxCapW, pairAvailableW);
        dhwTargetW = Math.min(dhwCapW, Math.max(0, pairAvailableW - wallboxTargetW));
    } else {
        dhwTargetW = Math.min(dhwCapW, pairAvailableW);
    }

    const safeDhwTargetW = simulateDhwTarget(Math.round(dhwTargetW));
    // Wird der Heizstab temperaturbedingt begrenzt, bekommt die aktive Wallbox
    // den frei werdenden Anteil innerhalb ihres Fahrplandeckels.
    wallboxTargetW = Math.min(wallboxCapW,
        wallboxTargetW + Math.max(0, dhwTargetW - safeDhwTargetW));
    const wallboxTargetsW = [0, 0, 0];
    wallboxTargetsW[selectedWallbox] = Math.round(wallboxTargetW);
    const allocatedSlowW = safeDhwTargetW + heatingTargetW
        + wallboxTargetsW.reduce((sumW, valueW) => sumW + valueW, 0);

    // Die Batterie schliesst als schnelles Stellglied die verbleibende Luecke.
    // SoC- und Leistungsgrenzen kommen aus derselben Konfiguration wie der Plan.
    const soc = readNumber(CFG.dp.batterySoc,
        readNumber(`${r}.Config.BatteryManualSoC_pct`, 50));
    const minSoc = readNumber(`${r}.Config.BatteryMinSoC_pct`, 0);
    const maxChargeW = Math.max(0, readNumber(`${r}.Config.BatteryMaxCharge_W`, 2400));
    const maxDischargeW = Math.max(0, readNumber(`${r}.Config.BatteryMaxDischarge_W`, 2400));
    const allowedDischargeW = soc > minSoc ? maxDischargeW : 0;
    const batteryTargetW = Math.round(clamp(requiredControlledW - allocatedSlowW,
        -allowedDischargeW, maxChargeW));

    const targetTotalW = allocatedSlowW + batteryTargetW;
    const predictedGridW = Math.round(uncontrolledGridW + targetTotalW);
    const remainingErrorW = predictedGridW - targetGridW;
    const planTimestamp = Math.max(Number(batteryPlan.timestamp) || 0,
        Number(dhwPlan.timestamp) || 0);

    write(`${r}.Control.ActualGridPower_W`, Math.round(gridW));
    write(`${r}.Control.PredictedGridPower_W`, predictedGridW);
    write(`${r}.Control.Error_W`, Math.round(errorW));
    write(`${r}.Control.RemainingError_W`, Math.round(remainingErrorW));
    write(`${r}.Control.PlanSlotTimestamp`, planTimestamp);
    write(`${r}.Control.Targets.Battery_W`, batteryTargetW);
    write(`${r}.Control.Targets.MyPV_DHW_W`, safeDhwTargetW);
    write(`${r}.Control.Targets.MyPV_Heating_W`, Math.round(heatingTargetW));
    [0, 1, 2].forEach(wb => write(`${r}.Control.Targets.Wallbox${wb}_W`, wallboxTargetsW[wb]));
    write(`${r}.Control.ParallelDistributionActive`, realtimeParallelActive);
    write(`${r}.Control.ParallelDistributionThresholds`,
        `${activeVehicle.detectedPhases >= 3 ? '3-phasig' : '1-phasig'}: EIN > ${startThresholdW} W, AUS < ${stopThresholdW} W`);
    write(`${r}.Control.Targets.PVBoostRelease`, Boolean(boostPlan?.release) && predictedGridW <= deadbandW);
    write(`${r}.Control.Valid`, true);
    write(`${r}.Control.Status`, Math.abs(remainingErrorW) <= deadbandW
        ? `SIMULATION: NVP-Ziel ${targetGridW} W erreichbar`
        : `SIMULATION: Stellgrenzen erreicht, Restabweichung ${Math.round(remainingErrorW)} W`);
    write(`${r}.Control.LastUpdate`, now);

    // desiredChangeW wird bewusst ausgewiesen, obwohl die statische Simulation
    // aus den Istleistungen neu rechnet. Das Totband verhindert kleine Korrekturen.
    if (desiredChangeW === 0) {
        write(`${r}.Control.Status`, `SIMULATION: innerhalb Totband (${Math.round(gridW)} W)`);
    }
}
