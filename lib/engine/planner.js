function percentile(values, fraction) {
    const sorted = values.filter(Number.isFinite).slice().sort((a, b) => a - b);
    if (!sorted.length) return 0;
    return sorted[Math.min(sorted.length - 1, Math.floor((sorted.length - 1) * fraction))];
}

function freshOptionalNumber(id, maxAgeMs) {
    try {
        if (!existsState(id)) return null;
        const s = getState(id);
        const n = Number(s?.val);
        return Number.isFinite(n) && Date.now() - Number(s?.ts || 0) <= maxAgeMs ? n : null;
    } catch (_) {
        return null;
    }
}

function buildBatteryTargetPlan(data, capacity, maxCharge, efficiency, targets, reserveMin) {
    const result = data.pv.map(x => ({
        timestamp: x.timestamp,
        targetPct: targets.morning,
        stage: 'MORNING_70',
        deadlineIndex: 0
    }));
    const byDay = new Map();
    data.pv.forEach((x, index) => {
        const key = localDateKey(new Date(x.timestamp));
        if (!byDay.has(key)) byDay.set(key, []);
        byDay.get(key).push(index);
    });
    const reserveSlots = Math.max(0, Math.ceil(reserveMin / 15));
    const lateEnergyKWh = Math.max(0, targets.late - targets.afternoon) / 100 * capacity;
    const lateSlots = maxCharge > 0
        ? Math.ceil(lateEnergyKWh / (maxCharge / 1000 * efficiency) * 4)
        : 0;

    byDay.forEach(indices => {
        const usable = indices.filter(i =>
            (Number(data.pv[i]?.valueW) || 0) - (Number(data.house[i]?.valueW) || 0) >= 200);
        if (!usable.length) return;
        const peakIndex = usable.reduce((best, i) =>
            Number(data.pv[i].valueW) > Number(data.pv[best].valueW) ? i : best, usable[0]);
        const lastPvIndex = usable[usable.length - 1];
        const lateStartIndex = Math.max(peakIndex, lastPvIndex - reserveSlots - lateSlots + 1);
        const lateDeadlineIndex = Math.max(lateStartIndex, lastPvIndex - reserveSlots);

        indices.forEach(i => {
            if (i >= lateStartIndex && i <= lastPvIndex) {
                result[i].targetPct = targets.late;
                result[i].stage = 'LATE_100';
                result[i].deadlineIndex = Math.max(i, lateDeadlineIndex);
            } else if (i >= peakIndex && i < lateStartIndex) {
                result[i].targetPct = targets.afternoon;
                result[i].stage = 'AFTERNOON_90';
                result[i].deadlineIndex = Math.max(i, lateStartIndex - 1);
            } else if (i < peakIndex) {
                result[i].deadlineIndex = peakIndex;
            } else {
                result[i].deadlineIndex = i;
            }
        });
    });
    return result;
}

function buildDevicePlan(data) {
    const r = CFG.root;
    if (!historyReady || !data.pv.length || !data.house.length) {
        write(`${r}.Plan.Valid`, false);
        write(`${r}.Plan.Status`, 'Wartet auf gueltige Historie und Prognose');
        return;
    }

    const capacity = Math.max(0.1, readNumber(`${r}.Config.BatteryCapacity_kWh`, 10));
    const maxCharge = Math.max(0, readNumber(`${r}.Config.BatteryMaxCharge_W`, 2400));
    const maxDischarge = Math.max(0, readNumber(`${r}.Config.BatteryMaxDischarge_W`, 2400));
    const minSoc = readNumber(`${r}.Config.BatteryMinSoC_pct`, 15);
    const morningTarget = Math.max(minSoc, Math.min(100,
        readNumber(`${r}.Config.BatteryMorningTargetSoC_pct`, 70)));
    const afternoonTarget = Math.max(morningTarget, Math.min(100,
        readNumber(`${r}.Config.BatteryAfternoonTargetSoC_pct`, 90)));
    const targets = {
        morning: morningTarget,
        afternoon: afternoonTarget,
        late: Math.max(afternoonTarget, Math.min(100,
            readNumber(`${r}.Config.BatteryLateTargetSoC_pct`, 100)))
    };
    const efficiency = Math.max(0.5, Math.min(1, readNumber(`${r}.Config.BatteryEfficiency_pct`, 92) / 100));
    const targetPlan = buildBatteryTargetPlan(data, capacity, maxCharge, efficiency, targets,
        readNumber(`${r}.Config.BatteryFinalChargeReserve_min`, 45));
    const liveSoc = freshOptionalNumber(CFG.dp.batterySoc, 5 * 60 * 1000);
    let soc = Math.max(0, Math.min(100, liveSoc === null
        ? readNumber(`${r}.Config.BatteryManualSoC_pct`, 50) : liveSoc));
    const socSource = liveSoc === null ? 'Config.BatteryManualSoC_pct (Livewert fehlt/veraltet)' : CFG.dp.batterySoc;

    const dhwValues = CFG.dp.dhwTemps.map(id => freshOptionalNumber(id, 10 * 60 * 1000)).filter(Number.isFinite);
    const dhwTemp = dhwValues.length
        ? dhwValues.reduce((a, b) => a + b, 0) / dhwValues.length
        : readNumber(`${r}.Actual.DHWTemperature_C`, 50);
    const dhwMin = readNumber(`${r}.Config.DHWMinTemperature_C`, 48);
    const dhwTarget = readNumber(`${r}.Config.DHWTargetTemperature_C`, 60);
    let dhwNeedKWh = Math.max(0, readNumber(`${r}.Config.DHWVolume_l`, 500) * 1.163 * (dhwTarget - dhwTemp) / 1000);
    const heatTemp = readNumber(`${r}.Config.HeatingBufferTemperature_C`, 40);
    const heatMin = readNumber(`${r}.Config.HeatingBufferMinTemperature_C`, 35);
    const heatTarget = readNumber(`${r}.Config.HeatingBufferTargetTemperature_C`, 50);
    let heatNeedKWh = Math.max(0, readNumber(`${r}.Config.HeatingBufferVolume_l`, 400) * 1.163 * (heatTarget - heatTemp) / 1000);

    updateVehicles();
    const wallboxStatus = [0, 1, 2].map(index => {
        const vehicle = vehicleState(index);
        return {...vehicle, eligible: vehicle.release, reason: vehicle.status};
    });
    const connected = wallboxStatus.filter(x => x.connected).map(x => x.index);
    const eligibleWallboxes = wallboxStatus.filter(x => x.eligible)
        .sort((a, b) => Number(b.mustCharge) - Number(a.mustCharge)
            || a.latestStartTimestamp - b.latestStartTimestamp
            || b.priority - a.priority)
        .map(x => x.index);
    const vehicleEfficiency = Math.max(0.5, Math.min(1,
        readNumber(`${r}.Config.VehicleChargingEfficiency_pct`, 90) / 100));
    const wallboxRemainingKWh = wallboxStatus.map(x => x.eligible
        ? (x.socValid ? x.energyRequiredKWh : Infinity) : 0);
    const parallelEnabled = Boolean(getState(`${r}.Config.DHWParallelDistributionEnabled`)?.val);
    const dhwParallelMinimumW = Math.max(0,
        readNumber(`${r}.Config.DHWParallelMinimum_W`, 2000));
    const prices = data.prices.total.map(x => Number(x.value_ct_kWh));
    const lowPrice = percentile(prices, 0.30);
    const highPrice = percentile(prices, 0.70);
    const spreadOk = highPrice - lowPrice >= readNumber(`${r}.Config.MinArbitrageSpread_ct_kWh`, 4);
    const selfConsumptionEnabled = Boolean(getState(`${r}.Config.BatterySelfConsumptionEnabled`)?.val);

    const battery = [], batterySoc = [], batteryTarget = [], batteryStage = [], dhw = [], heating = [], boost = [];
    const wallboxes = [[], [], []], grid = [];
    const flexPlan = [];
    let importWh = 0, exportWh = 0;

    // Pass 1: Alle verschiebbaren Verbraucher ausser der Batterie planen.
    // So kennt die Batterie anschliessend den wirklich noch freien PV-Rest.
    for (let i = 0; i < data.pv.length; i++) {
        const timestamp = data.pv[i].timestamp;
        const pvW = Math.max(0, Number(data.pv[i].valueW) || 0);
        const baseW = Math.max(0, Number(data.house[i].valueW) || 0);
        const price = prices[i] || 0;
        const activeWallbox = eligibleWallboxes.find(wb => wallboxRemainingKWh[wb] > 0
            && timestamp < wallboxStatus[wb].departureTimestamp) ?? null;
        const activeVehicle = activeWallbox === null ? null : wallboxStatus[activeWallbox];
        const deadlineCharge = activeVehicle !== null
            && (activeVehicle.mustCharge || timestamp >= activeVehicle.latestStartTimestamp)
            && timestamp < activeVehicle.departureTimestamp;
        let remainingPvW = Math.max(0, pvW - baseW);
        let dhwW = 0, heatW = 0;
        const wbW = [0, 0, 0];

        // Bei ladebeduerftigem Auto zunaechst eine Trinkwasser-Mindestleistung
        // reservieren. Eine zwingende Mindesttemperatur hat weiterhin Vorrang.
        const forcedDhw = dhwNeedKWh > 0 && dhwTemp < dhwMin && price <= lowPrice;
        if (dhwNeedKWh > 0 && (remainingPvW > 0 || forcedDhw)) {
            const needW = dhwNeedKWh * 4000;
            const parallelShare = parallelEnabled && activeWallbox !== null && !forcedDhw;
            dhwW = forcedDhw
                ? Math.min(CFG.limits.myPvDhwMaxW, needW)
                : Math.min(CFG.limits.myPvDhwMaxW, needW, remainingPvW,
                    parallelShare ? dhwParallelMinimumW : CFG.limits.myPvDhwMaxW);
            dhwNeedKWh = Math.max(0, dhwNeedKWh - dhwW / 4000);
            remainingPvW = Math.max(0, remainingPvW - dhwW);
        }

        // Nur ein Auto gleichzeitig; nur bei Anschluss, Ladebedarf und Freigabe.
        if (activeWallbox !== null && (remainingPvW >= activeVehicle.minimumPowerW || deadlineCharge)) {
            const energyLimitedW = Number.isFinite(wallboxRemainingKWh[activeWallbox])
                ? wallboxRemainingKWh[activeWallbox] / 0.25 / vehicleEfficiency * 1000
                : activeVehicle.maximumPowerW;
            wbW[activeWallbox] = Math.min(activeVehicle.maximumPowerW, energyLimitedW,
                deadlineCharge ? activeVehicle.maximumPowerW : remainingPvW);
            if (!deadlineCharge && wbW[activeWallbox] < activeVehicle.minimumPowerW) {
                wbW[activeWallbox] = 0;
            }
            remainingPvW = Math.max(0, remainingPvW - wbW[activeWallbox]);
            if (Number.isFinite(wallboxRemainingKWh[activeWallbox])) {
                wallboxRemainingKWh[activeWallbox] = Math.max(0,
                    wallboxRemainingKWh[activeWallbox] - wbW[activeWallbox] * 0.25 / 1000 * vehicleEfficiency);
            }
        }

        // Nach der parallelen Wallboxzuteilung darf Trinkwasser verbleibende
        // Leistung bis 9 kW aufnehmen.
        if (dhwNeedKWh > 0 && remainingPvW > 0) {
            const extraDhwW = Math.min(CFG.limits.myPvDhwMaxW - dhwW,
                dhwNeedKWh * 4000, remainingPvW);
            dhwW += extraDhwW;
            dhwNeedKWh = Math.max(0, dhwNeedKWh - extraDhwW / 4000);
            remainingPvW -= extraDhwW;
        }

        if (heatNeedKWh > 0 && (remainingPvW > 0 || (heatTemp < heatMin && price <= lowPrice))) {
            const needW = heatNeedKWh * 4000;
            heatW = Math.min(CFG.limits.myPvHeatingMaxW, needW,
                remainingPvW > 0 ? remainingPvW : CFG.limits.myPvHeatingMaxW);
            heatNeedKWh = Math.max(0, heatNeedKWh - heatW / 4000);
            remainingPvW = Math.max(0, remainingPvW - heatW);
        }

        flexPlan.push({timestamp, offsetMin: i * 15, pvW, baseW, price,
            residualPvW: Math.max(0, remainingPvW), dhwW, heatW, wbW});
        const meta = {timestamp, offsetMin: i * 15};
        dhw.push({...meta, valueW: Math.round(dhwW)});
        heating.push({...meta, valueW: Math.round(heatW)});
        wallboxes.forEach((series, wb) => series.push({...meta, valueW: Math.round(wbW[wb]),
            conditional: eligibleWallboxes.includes(wb)}));
    }

    // Pass 2: Die Batterie so spaet wie moeglich in den verbleibenden
    // PV-Rest legen. Nur wenn die spaeteren sicheren Ladefenster bis zum
    // Stufenziel nicht reichen, wird bereits im aktuellen Slot geladen.
    const forecastSafety = Math.max(0.3, Math.min(1,
        readNumber(`${r}.Config.BatteryForecastSafetyFactor_pct`, 80) / 100));
    for (let i = 0; i < flexPlan.length; i++) {
        const slot = flexPlan[i];
        const targetSoc = targetPlan[i].targetPct;
        const deadline = Math.min(flexPlan.length - 1,
            Math.max(i, Number(targetPlan[i].deadlineIndex) || i));
        const needStoredKWh = Math.max(0, (targetSoc - soc) / 100 * capacity);
        let safeFutureStoredKWh = 0;
        for (let j = i + 1; j <= deadline; j++) {
            safeFutureStoredKWh += Math.min(maxCharge,
                flexPlan[j].residualPvW * forecastSafety) * 0.25 / 1000 * efficiency;
        }

        let batteryW = 0;
        const shortfallStoredKWh = Math.max(0, needStoredKWh - safeFutureStoredKWh);
        if (shortfallStoredKWh > 0 && slot.residualPvW > 0) {
            const requiredNowW = shortfallStoredKWh / efficiency * 1000 / 0.25;
            batteryW = Math.min(maxCharge, slot.residualPvW, requiredNowW);
        } else if (shortfallStoredKWh > 0 && spreadOk && slot.price <= lowPrice) {
            // Netzladung nur fuer die trotz sicherer PV-Restfenster verbleibende
            // Luecke und nur in einem wirklich guenstigen Preisfenster.
            batteryW = Math.min(maxCharge,
                shortfallStoredKWh / efficiency * 1000 / 0.25);
        } else if (slot.baseW > slot.pvW && soc > minSoc && (
            (selfConsumptionEnabled && !spreadOk) || (spreadOk && slot.price >= highPrice)
        )) {
            const availableW = Math.max(0, (soc - minSoc) / 100 * capacity * 4000 * efficiency);
            batteryW = -Math.min(maxDischarge, slot.baseW - slot.pvW, availableW);
        }

        soc += batteryW >= 0
            ? batteryW * 0.25 / 1000 * efficiency / capacity * 100
            : batteryW * 0.25 / 1000 / efficiency / capacity * 100;
        soc = Math.max(minSoc, Math.min(100, soc));

        const boostBudgetW = Math.max(0, slot.residualPvW - Math.max(0, batteryW));
        const gridW = slot.baseW + slot.dhwW + slot.heatW
            + slot.wbW.reduce((a, b) => a + b, 0) + batteryW - slot.pvW;
        importWh += Math.max(0, gridW) * 0.25;
        exportWh += Math.max(0, -gridW) * 0.25;
        const meta = {timestamp: slot.timestamp, offsetMin: slot.offsetMin};
        battery.push({...meta, valueW: Math.round(batteryW)});
        batterySoc.push({...meta, value_pct: Math.round(soc * 10) / 10});
        batteryTarget.push({...meta, value_pct: targetSoc});
        batteryStage.push({...meta, stage: targetPlan[i].stage, target_pct: targetSoc});
        boost.push({...meta, release: boostBudgetW >= CFG.limits.pvBoostMinExpectedW,
            budgetW: Math.round(Math.max(0, boostBudgetW))});
        grid.push({...meta, valueW: Math.round(gridW)});
    }

    write(`${r}.Plan.BatteryPower_48h_JSON`, JSON.stringify(battery));
    write(`${r}.Plan.BatterySoC_48h_JSON`, JSON.stringify(batterySoc));
    write(`${r}.Plan.BatteryTargetSoC_48h_JSON`, JSON.stringify(batteryTarget));
    write(`${r}.Plan.BatteryStage_48h_JSON`, JSON.stringify(batteryStage));
    write(`${r}.Plan.MyPV_DHW_48h_JSON`, JSON.stringify(dhw));
    write(`${r}.Plan.MyPV_Heating_48h_JSON`, JSON.stringify(heating));
    write(`${r}.Plan.PVBoost_48h_JSON`, JSON.stringify(boost));
    wallboxes.forEach((series, wb) => write(`${r}.Plan.Wallbox${wb}_48h_JSON`, JSON.stringify(series)));
    write(`${r}.Plan.GridPower_48h_JSON`, JSON.stringify(grid));
    write(`${r}.Chart.BatteryPower_48h_json_chart`, chartJson(battery, x => x.valueW));
    write(`${r}.Chart.BatterySoC_48h_json_chart`, chartJson(batterySoc, x => x.value_pct));
    write(`${r}.Chart.BatteryTargetSoC_48h_json_chart`, chartJson(batteryTarget, x => x.value_pct));
    write(`${r}.Chart.MyPV_DHW_48h_json_chart`, chartJson(dhw, x => x.valueW));
    write(`${r}.Chart.MyPV_Heating_48h_json_chart`, chartJson(heating, x => x.valueW));
    write(`${r}.Chart.PVBoostBudget_48h_json_chart`, chartJson(boost, x => x.budgetW));
    wallboxes.forEach((series, wb) => write(`${r}.Chart.Wallbox${wb}_48h_json_chart`, chartJson(series, x => x.valueW)));
    write(`${r}.Chart.GridPower_48h_json_chart`, chartJson(grid, x => x.valueW));
    write(`${r}.Plan.ExpectedImport_kWh`, Math.round(importWh / 10) / 100);
    write(`${r}.Plan.ExpectedExport_kWh`, Math.round(exportWh / 10) / 100);
    write(`${r}.Plan.ConnectedWallboxes_JSON`, JSON.stringify(connected));
    write(`${r}.Plan.WallboxStatus_JSON`, JSON.stringify(wallboxStatus));
    write(`${r}.Plan.BatterySoCSource`, socSource);
    write(`${r}.Plan.Valid`, true);
    write(`${r}.Plan.Status`, `48 h berechnet; angeschlossen: ${connected.length ? connected.join(', ') : 'keine'}; Ladebedarf: ${eligibleWallboxes.length ? eligibleWallboxes.join(', ') : 'keiner'}`);
    write(`${r}.Plan.LastUpdate`, Date.now());

    const importKWh = importWh / 1000;
    const exportKWh = exportWh / 1000;
    const maxPlannedChargeW = battery.reduce((max, x) => Math.max(max, x.valueW), 0);
    const maxPlannedDischargeW = battery.reduce((max, x) => Math.max(max, -x.valueW), 0);
    const atMinHours = batterySoc.filter(x => x.value_pct <= minSoc + 0.1).length * 0.25;
    const atTargetHours = batterySoc.filter((x, i) => x.value_pct >= batteryTarget[i].value_pct - 0.1).length * 0.25;
    const additionalShiftKWh = Math.min(importKWh, exportKWh * efficiency);
    const capacityHint = atMinHours >= 1 && exportKWh > 0.5
        ? 'Kapazitaet koennte zu klein sein: Mindest-SoC erreicht und spaeter/zusätzlich PV-Export vorhanden.'
        : 'Im 48-h-Plan kein eindeutiger Hinweis auf zu geringe Kapazitaet.';
    const powerHint = maxPlannedChargeW >= maxCharge * 0.98 || maxPlannedDischargeW >= maxDischarge * 0.98
        ? ' Die Leistungsgrenze von 2,4 kW wird erreicht; hoehere Leistung separat pruefen.'
        : ' Die Leistungsgrenze wird im Plan nicht erreicht.';
    write(`${r}.Evaluation.BatteryMaxPlannedCharge_W`, maxPlannedChargeW);
    write(`${r}.Evaluation.BatteryMaxPlannedDischarge_W`, maxPlannedDischargeW);
    write(`${r}.Evaluation.BatteryAtMinSoC_h`, Math.round(atMinHours * 100) / 100);
    write(`${r}.Evaluation.BatteryAtTargetSoC_h`, Math.round(atTargetHours * 100) / 100);
    write(`${r}.Evaluation.RemainingGridImport_kWh`, Math.round(importKWh * 100) / 100);
    write(`${r}.Evaluation.RemainingPVExport_kWh`, Math.round(exportKWh * 100) / 100);
    write(`${r}.Evaluation.AdditionalShiftPotential_kWh`, Math.round(additionalShiftKWh * 100) / 100);
    write(`${r}.Evaluation.BatterySizingHint`, capacityHint + powerHint);
}
