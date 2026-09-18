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

function zeroRealtimeTargets(status) {
    const r = CFG.root;
    write(`${r}.Control.Valid`, false);
    write(`${r}.Control.Status`, status);
    write(`${r}.Control.Targets.Battery_W`, 0);
    write(`${r}.Control.Targets.MyPV_DHW_W`, 0);
    write(`${r}.Control.Targets.MyPV_Heating_W`, 0);
    [0, 1, 2].forEach(wb => write(`${r}.Control.Targets.Wallbox${wb}_W`, 0));
    write(`${r}.Control.Targets.PVBoostRelease`, false);
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

    // Langsame Verbraucher duerfen nur innerhalb des aktuellen Fahrplans
    // laufen. Sind mehrere freigegeben, werden sie proportional parallel
    // reduziert statt nacheinander hart abgeschaltet.
    const slowCaps = [
        Math.max(0, Number(dhwPlan.valueW) || 0),
        Math.max(0, Number(heatingPlan.valueW) || 0),
        ...wallboxPlans.map(item => Math.max(0, Number(item.valueW) || 0))
    ];
    const slowCapTotal = slowCaps.reduce((sumW, valueW) => sumW + valueW, 0);
    const slowRequiredW = clamp(requiredControlledW, 0, slowCapTotal);
    const factor = slowCapTotal > 0 ? slowRequiredW / slowCapTotal : 0;
    const slowTargets = slowCaps.map(capW => Math.round(capW * factor));
    slowTargets[0] = simulateDhwTarget(slowTargets[0]);
    const allocatedSlowW = slowTargets.reduce((sumW, valueW) => sumW + valueW, 0);

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
    write(`${r}.Control.Targets.MyPV_DHW_W`, slowTargets[0]);
    write(`${r}.Control.Targets.MyPV_Heating_W`, slowTargets[1]);
    [0, 1, 2].forEach(wb => write(`${r}.Control.Targets.Wallbox${wb}_W`, slowTargets[wb + 2]));
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
