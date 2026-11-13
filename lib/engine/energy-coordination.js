/* One allocator, one fine regulator. Internal battery watts are +charge/-discharge.
 * The physical controllers follow these budgets; only the nominated EHZ may
 * additionally correct the grid meter. This module performs no foreign writes.
 */
'use strict';

function createEnergyCoordinationStates() {
    const values = {
        FineRegulator: 'none', HeaterBudgetMode: 'FINE', AllowHeaterGridImport: false,
        CoordinationActive: false, CoordinationStatus: 'Nicht aktiv',
        UncontrolledGridPower_W: 0, AvailablePVPower_W: 0, BatteryPVReserve_W: 0,
        ...((nativeConfig.batteryPvPriorityEnabled === true || nativeConfig.batteryWallboxHalfStepEnabled === true)
            ? {BatteryWallboxBuffer_W: 0} : {}),
        HeaterPVAllocation_W: 0, HeaterCheapGridAllocation_W: 0,
        ProtectedGridImport_W: 0, GrossConsumptionTarget_W: 0,
        BatteryPriceGridCharge_W: 0, Wallbox0PriceGridCharge_W: 0,
        Wallbox1PriceGridCharge_W: 0, Wallbox2PriceGridCharge_W: 0,
        PriceChargingStatus: 'Keine Preisladung'
    };
    for (const [name, value] of Object.entries(values))
        stateDef(`${CFG.root}.Control.${name}`, value, typeof value,
            typeof value === 'boolean' ? 'indicator' : typeof value === 'number' ? 'value' : 'text', '', name);
}

function coordinatedEnergyEnabled() {
    return getState(`${CFG.root}.System.RealOutputsEnabled`)?.val === true
        && (nativeConfig.batteryControlEnabled === true || nativeConfig.heatingControlEnabled === true);
}

function heaterUsesGridFeedback(deviceName) {
    if (!coordinatedEnergyEnabled()) return deviceName === 'MyPV_DHW';
    return getState(`${CFG.root}.Control.FineRegulator`)?.val === deviceName
        && getState(`${CFG.root}.Control.AllowHeaterGridImport`)?.val !== true;
}

// Only a current allocator grant can turn a temperature request into
// deliberate import. Recheck the requesting sensor at dispatch and dequeue.
let heaterEmergencyDispatch = null;
function heaterEmergencyOutputMode(device) {
    const prefix = device === 'MyPV_DHW' ? 'dhw' : 'heating';
    if (heaterEmergencyDispatch !== null) {
        const r = CFG.root;
        const now = Date.now();
        const controlAt = numericValue(getState(`${r}.Control.LastUpdate`)?.val);
        const observerAt = numericValue(getState(`${r}.System.LastUpdate`)?.val);
        const controlValid = getState(`${r}.Control.Enabled`)?.val === true
            && getState(`${r}.Control.Valid`)?.val === true
            && controlAt > 0 && now - controlAt >= 0 && now - controlAt <= 10000
            && observerAt > 0 && now - observerAt >= 0 && now - observerAt <= 30000;
        if (!controlValid || !(heaterEmergencyDispatch[device] > 0)
            || !heaterEmergencyRequested(prefix) || dhwHouseConnectionProtectionReason()) return 'blocked';
        const grid = realtimeGridMeasurement();
        return grid.valid && !grid.held ? 'emergency' : 'blocked';
    }
    return nativeConfig[`${prefix}EmergencyOnly`] === true ? 'blocked' : 'normal';
}

function emergencyHeatingAllocation(now, gridW, consumptionLimit) {
    const r = CFG.root;
    const scope = realtimeProductionScope();
    if (!scope.production || nativeConfig.globalWriteEnabled !== true || dhwHouseConnectionProtectionReason())
        return false;
    const dhw = scope.dhw && getState(`${r}.Devices.MyPV_DHW.DriverReady`)?.val === true
        && heaterEmergencyRequested('dhw') ? evaluateDhwSimulation() : null;
    const heating = nativeConfig.heatingPresent === true && nativeConfig.heatingControlEnabled === true
        && nativeConfig.heatingProductionArmed === true && getState(`${r}.Devices.MyPV_Heating.ControlEnabled`)?.val === true
        && getState(`${r}.Devices.MyPV_Heating.Present`)?.val === true
        && getState(`${r}.Devices.MyPV_Heating.DriverReady`)?.val === true
        && heaterEmergencyRequested('heating') ? evaluateHeatingSimulation() : null;
    const dhwW = dhw?.release ? Math.max(0, Math.min(dhw.temperaturePowerLimitW, 9000,
        readNumber(`${r}.Config.DHWCommissioningMaxPower_W`, 1000))) : 0;
    const heatingW = heating?.release ? heating.thermalCapW : 0;
    if (!(dhwW > 0 || heatingW > 0)) return false;

    const status = 'Notbetrieb Heizstab';
    if (heaterEmergencyDispatch === null) {
        resetSlowTargets();
        resetEnergyCoordination(status);
    }
    // Reserve one shared budget. With both requests active, give DHW the
    // first share. Output controllers still check real peer reservations.
    const budgetW = consumptionLimit.budgetW === null || consumptionLimit.groupNet
        ? Infinity : Math.max(0, consumptionLimit.budgetW);
    slowTargets.dhwW = dhwW > 0 ? dhwLayeringTarget(Math.min(dhwW, budgetW), dhw) : 0;
    slowTargets.heatingW = Math.min(heatingW, budgetW - slowTargets.dhwW);
    if (consumptionLimit.groupNet) {
        const fitted = gridGroupConstrainTargets(slowTargets, 0, ['MyPV_DHW', 'MyPV_Heating'], consumptionLimit);
        if (!fitted.valid) {
            zeroRealtimeTargets(fitted.reason);
            return true;
        }
        if (dhwW > 0) slowTargets.dhwW = dhwLayeringTarget(slowTargets.dhwW, dhw);
    }
    heaterEmergencyDispatch = {MyPV_DHW: slowTargets.dhwW, MyPV_Heating: slowTargets.heatingW};
    for (const [name, watts] of Object.entries(heaterEmergencyDispatch))
        write(`${r}.Control.Targets.${name}_W`, watts);
    write(`${r}.Control.Targets.Battery_W`, 0);
    write(`${r}.Control.Targets.PVBoostRelease`, false);
    for (const wb of [0, 1, 2]) {
        write(`${r}.Control.Targets.Wallbox${wb}_W`, 0);
        write(`${r}.Control.Targets.Wallbox${wb}_A`, 0);
    }
    write(`${r}.Control.ParallelWallboxAllocation_JSON`, JSON.stringify({schema: 1, timestamp: now,
        valid: true, order: [], budgetW: 0, hardBudgetW: 0, allocations: [], waiting: []}));
    write(`${r}.Control.ActiveWallboxes_JSON`, '[]');
    write(`${r}.Control.ParallelWallboxStatus`, status);
    write(`${r}.Control.ParallelDistributionActive`, false);
    write(`${r}.Control.ParallelDistributionReleased`, false);
    write(`${r}.Control.SelectedWallbox`, -1);
    write(`${r}.Control.WallboxSelectionReason`, status);
    write(`${r}.Control.ActualGridPower_W`, Math.round(gridW));
    write(`${r}.Control.AllowHeaterGridImport`, slowTargets.dhwW > 0 || slowTargets.heatingW > 0);
    write(`${r}.Control.Status`, `${status}: Trinkwasser ${slowTargets.dhwW} W, Heizpuffer ${slowTargets.heatingW} W`);
    write(`${r}.Control.Valid`, true);
    write(`${r}.Control.LastUpdate`, now);
    return true;
}

function leaveEmergencyHeating() {
    if (heaterEmergencyDispatch === null) return;
    heaterEmergencyDispatch = null;
    lastSlowUpdate = 0;
    write(`${CFG.root}.Control.AllowHeaterGridImport`, false);
}

function publishBatteryWallboxBuffer(watts) {
    const id = `${CFG.root}.Control.BatteryWallboxBuffer_W`;
    if (nativeConfig.batteryPvPriorityEnabled === true || nativeConfig.batteryWallboxHalfStepEnabled === true
        || getState(id)?.val > 0) write(id, watts);
}

function resetEnergyCoordination(reason) {
    const r = `${CFG.root}.Control`;
    write(`${r}.CoordinationActive`, false);
    write(`${r}.CoordinationStatus`, reason);
    write(`${r}.FineRegulator`, 'none');
    write(`${r}.HeaterBudgetMode`, 'BUDGET');
    write(`${r}.AllowHeaterGridImport`, false);
    for (const name of ['BatteryPVReserve_W', 'HeaterPVAllocation_W',
        'HeaterCheapGridAllocation_W', 'ProtectedGridImport_W', 'GrossConsumptionTarget_W',
        'BatteryPriceGridCharge_W', 'Wallbox0PriceGridCharge_W',
        'Wallbox1PriceGridCharge_W', 'Wallbox2PriceGridCharge_W'])
        write(`${r}.${name}`, 0);
    publishBatteryWallboxBuffer(0);
    write(`${r}.PriceChargingStatus`, reason);
}

function coordinatedPositiveNumber(value) {
    return Number.isFinite(Number(value)) ? Math.max(0, Number(value)) : 0;
}

// Positive power remains reserved until the actuator has actually reduced it.
// A discharge is never credited against the gross §14a/LPC consumption budget.
function coordinatedConsumptionLoads() {
    const r = CFG.root;
    let valid = true;
    const reservedW = name => coordinatedPositiveNumber(getState(`${r}.Devices.${name}.${name === 'Battery'
        ? 'OutputReservedCharge_W' : 'OutputReservedPower_W'}`)?.val);
    const phaseHighWaterW = name => [1, 2, 3].map(p => coordinatedPositiveNumber(
        getState(`${r}.Devices.${name}.OutputReservedPhase${p}_W`)?.val));
    const relevant = name => getState(`${r}.Devices.${name}.Present`)?.val === true
        || getState(`${r}.Devices.${name}.OutputOwned`)?.val === true || reservedW(name) > 0
        || phaseHighWaterW(name).some(watts => watts > 0);
    const commandW = name => getState(`${r}.Devices.${name}.OutputOwned`)?.val === true
        ? coordinatedPositiveNumber(getState(`${r}.Devices.${name}.${name === 'Battery'
            ? 'OutputCommandInternal_W' : 'OutputCommand_W'}`)?.val) : 0;
    const measuredBattery = typeof batteryMeasuredPowerW === 'function'
        ? batteryMeasuredPowerW() : readNumber(CFG.dp.batteryPower, 0);
    if (relevant('Battery') && !Number.isFinite(measuredBattery)) valid = false;
    const batteryW = Math.max(coordinatedPositiveNumber(measuredBattery), commandW('Battery'), reservedW('Battery'));
    const dhwPhases = (CFG.dp.myPvDhwOutputW || []).map(id => freshDhwNumber(id, 120000));
    const dhwValid = dhwPhases.length === 3 && dhwPhases.every(value => value !== null && value >= 0);
    if (relevant('MyPV_DHW') && !dhwValid) valid = false;
    const dhwW = Math.max(dhwValid ? dhwPhases.reduce((sum, watts) => sum + watts, 0) : 0,
        commandW('MyPV_DHW'), reservedW('MyPV_DHW'), phaseHighWaterW('MyPV_DHW').reduce((sum, watts) => sum + watts, 0));
    const measuredHeating = typeof heatingActualPower === 'function' ? heatingActualPower() : null;
    if (relevant('MyPV_Heating') && !measuredHeating?.valid) valid = false;
    const heatingW = Math.max(coordinatedPositiveNumber(measuredHeating?.valid
        ? measuredHeating.totalW : 0),
        commandW('MyPV_Heating'), reservedW('MyPV_Heating'),
        phaseHighWaterW('MyPV_Heating').reduce((sum, watts) => sum + watts, 0));
    const voltage = Math.max(200, readNumber(`${r}.Config.WallboxNominalVoltage_V`, 230));
    const wallboxesW = CFG.dp.wallboxesKW.map((id, wb) => {
        const base = `${r}.Devices.Wallbox${wb}`;
        const actualKW = freshDhwNumber(id,
            Math.max(5, Number(nativeConfig.wallboxMeasurementMaxAgeS) || 30) * 1000);
        if (relevant(`Wallbox${wb}`) && (actualKW === null || actualKW < 0)) valid = false;
        const phases = readNumber(`${base}.OutputPhases`, 1) >= 3 ? 3 : 1;
        const committedW = getState(`${base}.OutputOwned`)?.val === true
            && getState(`${base}.OutputActive`)?.val === true
            ? coordinatedPositiveNumber(readNumber(`${base}.OutputCommand_A`, 0)) * voltage * phases : 0;
        const pendingW = coordinatedPositiveNumber(getState(`${base}.OutputReservedPower_W`)?.val);
        return Math.max(coordinatedPositiveNumber(actualKW) * 1000, committedW, pendingW);
    });
    const wallboxW = wallboxesW.reduce((sum, watts) => sum + watts, 0);
    return {valid, batteryW, dhwW, heatingW, wallboxW, wallboxesW,
        totalW: batteryW + dhwW + heatingW + wallboxW};
}

function coordinatedStagedPhases(powerW, stageW) {
    const watts = Math.max(0, Math.min(stageW * 3, powerW));
    if (watts <= stageW) return [watts, 0, 0];
    if (watts <= stageW * 2) return [watts - stageW, stageW, 0];
    return [watts - stageW * 2, stageW, stageW];
}

// Recheck the exact electrical value after the adapter's durable-write queue
// has drained. Allocation and output checks made before an await are not proof
// that a newly binding limit, cooling lock, or smaller budget still allows it.
// This function never issues a foreign write; zero always remains a safe stop.
function checkQueuedElectricalOutput(device, rawCommandW) {
    const fail = reason => ({allowed: false, reason});
    if (typeof rawCommandW !== 'number' || !Number.isFinite(rawCommandW))
        return fail('Elektrischer Stellwert ist keine endliche Zahl');
    if (!['Battery', 'MyPV_DHW', 'MyPV_Heating'].includes(device))
        return fail('Unbekannter elektrischer Ausgang');
    if (rawCommandW === 0) return {allowed: true, reason: 'Sicherer Nullbefehl'};
    if (device !== 'Battery' && rawCommandW < 0) return fail('Heizleistung darf nicht negativ sein');
    if (device !== 'Battery' && heaterEmergencyOutputMode(device) === 'blocked')
        return fail('Notbetriebsfreigabe fuer wartenden Heizstabbefehl entzogen');
    const r = CFG.root;
    const limit = currentConsumptionLimit();
    if (!limit.valid) return fail(limit.reason);
    const internalW = device === 'Battery' ? -rawCommandW : rawCommandW;
    const grossCommandW = Math.max(0, internalW);
    const targetState = getState(`${r}.Control.Targets.${device === 'Battery' ? 'Battery' : device}_W`);
    const targetW = typeof targetState?.val === 'number' ? targetState.val : NaN;
    if (!Number.isFinite(targetW) || (internalW > 0 && targetW < internalW)
        || (internalW < 0 && targetW > internalW)) {
        const result = fail('Aktuelles EMS-Leistungsbudget erlaubt den wartenden Stellwert nicht mehr');
        // Only propose a smaller positive DHW command. The caller must run
        // this entire guard again for its actual (non-monotonic) phase topology.
        if (device === 'MyPV_DHW' && Number.isFinite(targetW) && targetW >= 100
            && targetW < rawCommandW) {
            result.code = 'DHW_BUDGET_SUPERSEDED';
            result.replacementW = Math.floor(targetW / 100) * 100;
        }
        return result;
    }
    const pair = gridMeasurement.read(getState, CFG.dp.gridImport, CFG.dp.gridExport, Date.now(),
        nativeConfig.gridPairTimestampMode || 'publication');
    if (!pair.valid || pair.held) return fail('Netzbezug/Einspeisung ohne frischen gemeinsamen Zeitbezug');
    if (limit.groupNet) {
        if (typeof gridGroupCommandCheck !== 'function') return fail('Gruppen-Netzpruefung fehlt');
        const checked = gridGroupCommandCheck(device, grossCommandW, limit);
        if (!checked.allowed) return fail(checked.reason);
    } else if (limit.budgetW !== null) {
        let otherW = 0;
        if (coordinatedEnergyEnabled()) {
            const loads = coordinatedConsumptionLoads();
            if (!loads.valid) return fail('Gemeinsame Verbrauchermessung fehlt/veraltet');
            const ownW = device === 'Battery' ? loads.batteryW : device === 'MyPV_DHW' ? loads.dhwW : loads.heatingW;
            otherW = Math.max(0, loads.totalW - ownW);
        } else {
            // Keep the legacy DHW-only/WB contract; inactive observer battery
            // and heating sensors cannot make an alpha16 output dependent on
            // new optional AC telemetry that has not been configured.
            for (const wb of realtimeProductionScope().wallboxes) {
                const actualKW = freshDhwNumber(CFG.dp.wallboxesKW[wb], 120000);
                if (actualKW === null || actualKW < 0) return fail('Wallbox-Leistung fuer LPC fehlt/veraltet');
                otherW += actualKW * 1000;
            }
        }
        if (grossCommandW > Math.max(0, limit.budgetW - otherW))
            return fail('Zwischenzeitlich bindendes gemeinsames LPC-Verbrauchsbudget');
    }
    if (device === 'Battery') {
        if (typeof batteryPriceSafeTarget === 'function' && internalW > batteryPriceSafeTarget(targetW))
            return fail('Preisfreigabe fuer wartenden Speichernetzbefehl entzogen');
        if (typeof batteryRegulationState !== 'function') return fail('Batteriemodul fehlt');
        const state = batteryRegulationState();
        if (!state.available || (internalW > 0 && !state.canCharge) || (internalW < 0 && !state.canDischarge))
            return fail(state.reason || 'Batterie-/SoC-Freigabe entzogen');
        if (internalW > state.maxChargeW || internalW < -state.maxDischargeW)
            return fail('Batterie-Leistungsgrenze unterschritten/ueberschritten');
        const capW = batteryHouseConnectionCapW(state.actualW);
        if (capW === null || internalW > capW) return fail('Hausanschluss begrenzt wartenden Batteriebefehl');
    } else if (device === 'MyPV_Heating') {
        const thermal = evaluateHeatingSimulation();
        const actual = heatingActualPower();
        if (!thermal.release || rawCommandW > thermal.thermalCapW)
            return fail(thermal.reason || 'Heizpuffer thermisch/Kuehlbetrieb gesperrt');
        if (!actual.valid || heatingPhaseLimitW(rawCommandW, actual.phases) < rawCommandW)
            return fail('Hausanschluss begrenzt wartenden Heizpufferbefehl');
    } else {
        const protectionReason = dhwHouseConnectionProtectionReason();
        if (protectionReason) return fail(protectionReason);
        const thermal = evaluateDhwSimulation();
        const capW = Math.min(thermal.temperaturePowerLimitW || 0,
            readNumber(`${r}.Config.DHWCommissioningMaxPower_W`, 1000));
        if (!thermal.release || rawCommandW > capW)
            return fail(thermal.reason || 'Trinkwasser thermisch gesperrt');
        if (phaseLimitedDhwPower(rawCommandW) < rawCommandW)
            return fail('Hausanschluss begrenzt wartenden Trinkwasserbefehl');
    }
    return {allowed: true, reason: 'Stellwert gegen aktuelle elektrische und thermische Grenzen geprueft'};
}

// Reserve positive per-phase changes already sent to another actuator. A
// reduction is not spendable until its real phase power has fallen. This also
// covers an EHZ stage crossing: +1 W total may switch a whole 3 kW stage on.
// The battery's grid phase is not verified, so reserve its whole positive
// increment conservatively on EACH phase instead of guessing a topology.
function coordinatedPhaseReservations(excludeDevice = '') {
    const r = CFG.root;
    const gross = coordinatedConsumptionLoads();
    let valid = gross.valid;
    const parallel = typeof parallelWallboxChargingEnabled === 'function'
        && parallelWallboxChargingEnabled();
    const voltage = parallel ? Math.max(200,
        readNumber(`${r}.Config.WallboxNominalVoltage_V`, 230)) : 230;
    const ownedCommand = name => getState(`${r}.Devices.${name}.OutputOwned`)?.val === true
        ? Math.max(0, readNumber(`${r}.Devices.${name}.OutputCommand_W`, 0)) : 0;
    const positiveDelta = (command, actual) => command.map((watts, p) => Math.max(0, watts - (actual[p] || 0)));
    const dhwActual = (CFG.dp.myPvDhwOutputW || []).map(id => freshDhwNumber(id, 120000));
    const heatingActual = typeof heatingActualPower === 'function' ? heatingActualPower() : null;
    const phaseHighWater = (name, phases) => phases.map((watts, p) => Math.max(watts,
        readNumber(`${r}.Devices.${name}.OutputReservedPhase${p + 1}_W`, 0)));
    const dhwW = positiveDelta(phaseHighWater('MyPV_DHW',
        coordinatedStagedPhases(ownedCommand('MyPV_DHW'), 3000)), dhwActual);
    const heatingW = positiveDelta(phaseHighWater('MyPV_Heating',
        coordinatedStagedPhases(ownedCommand('MyPV_Heating'), 2000)),
        heatingActual?.phases || [0, 0, 0]);
    const batteryActual = typeof batteryMeasuredPowerW === 'function' ? batteryMeasuredPowerW() : null;
    const batteryCommand = getState(`${r}.Devices.Battery.OutputOwned`)?.val === true
        ? readNumber(`${r}.Devices.Battery.OutputCommandInternal_W`, 0) : 0;
    const batteryIncrementW = Math.max(0, Math.max(batteryCommand,
        readNumber(`${r}.Devices.Battery.OutputReservedCharge_W`, 0)) - (batteryActual || 0));
    const batteryW = [batteryIncrementW, batteryIncrementW, batteryIncrementW];
    const wallboxesW = [0, 1, 2].map(wb => {
        const base = `${r}.Devices.Wallbox${wb}`;
        const present = getState(`${base}.Present`)?.val === true
            || getState(`${base}.OutputOwned`)?.val === true;
        if (!present) return [0, 0, 0];
        const currents = (CFG.dp.wallboxPhaseCurrents[wb] || []).map(id => freshDhwNumber(id,
            Math.max(5, Number(nativeConfig.wallboxMeasurementMaxAgeS) || 30) * 1000));
        const maxAgeMs = Math.max(5, Number(nativeConfig.wallboxMeasurementMaxAgeS) || 30) * 1000;
        const acknowledged = id => getState(id)?.ack === true ? freshDhwNumber(id, maxAgeMs) : null;
        const powerKW = acknowledged(CFG.dp.wallboxesKW[wb]);
        const allowId = nativeConfig[`wb${wb}AllowOutputId`];
        // A fresh confirmed empty/OFF peer has no commanded future draw.
        // Ignore its stale unused phase-current polls only in parallel mode;
        // unknown OFF/power and fresh contrary current still fail closed.
        const confirmedIdle = parallel && powerKW !== null && powerKW >= 0 && powerKW * 1000 <= 20
            && acknowledged(allowId) === 0 && acknowledged(CFG.dp.wallboxCar[wb]) === 1
            && getState(`${base}.OutputOwned`)?.val !== true
            && getState(`${base}.OutputActive`)?.val !== true
            && readNumber(`${base}.OutputReservedPower_W`, 0) === 0
            && readNumber(`${base}.OutputCommand_A`, 0) === 0
            && getState(`${base}.StopPowerPending`)?.val !== true
            && getState(`${base}.ResponsePending`)?.val !== true
            && getState(`${base}.PhaseSwitchPending`)?.val !== true
            && currents.length === 3
            && currents.every(amps => amps === null || (amps >= 0 && amps <= 0.5));
        if (confirmedIdle) return [0, 0, 0];
        if (currents.length !== 3 || currents.some(amps => amps === null || amps < 0)) valid = false;
        const phases = readNumber(`${base}.OutputPhases`, 1) >= 3 ? 3 : 1;
        const configuredPhase = Number(nativeConfig[`wb${wb}SinglePhaseGridPhase`] ?? 1);
        if (![1, 2, 3].includes(configuredPhase)) valid = false;
        const phase = clamp(configuredPhase - 1, 0, 2);
        const pendingW = Math.max(readNumber(`${base}.OutputReservedPower_W`, 0),
            getState(`${base}.OutputOwned`)?.val === true
                ? readNumber(`${base}.OutputCommand_A`, 0) * voltage * phases : 0);
        const actualPhases = phases === 3 ? currents.map(amps => (amps || 0) * voltage)
            : [0, 1, 2].map(p => p === phase ? Math.max(...currents.map(amps => amps || 0)) * voltage : 0);
        const commandedPhases = [0, 1, 2].map(p => phases === 3 ? pendingW / 3 : p === phase ? pendingW : 0);
        return positiveDelta(commandedPhases, actualPhases);
    });
    const totalsW = [0, 1, 2].map(p => dhwW[p] + heatingW[p] + batteryW[p]
        + wallboxesW.reduce((sum, watts) => sum + watts[p], 0));
    const excludedW = excludeDevice === 'Battery' ? batteryW : excludeDevice === 'MyPV_DHW' ? dhwW
        : excludeDevice === 'MyPV_Heating' ? heatingW
            : /^Wallbox[012]$/.test(excludeDevice) ? wallboxesW[Number(excludeDevice.slice(-1))] : [0, 0, 0];
    return {valid, totalsW, batteryW, dhwW, heatingW, wallboxesW,
        otherW: totalsW.map((watts, p) => Math.max(0, watts - excludedW[p]))};
}

function splitCoordinatedHeaters(totalW, dhwCapW, heatingCapW) {
    const availableW = Math.max(0, Math.min(totalW, dhwCapW + heatingCapW));
    // A cold DHW tank retains its established priority. Otherwise independent
    // tanks with headroom run together, proportional to their usable powers.
    const mustHeat = getState(`${CFG.root}.Devices.MyPV_DHW.MustHeat`)?.val === true;
    let dhwW = mustHeat ? Math.min(dhwCapW, availableW)
        : dhwCapW + heatingCapW > 0 ? availableW * dhwCapW / (dhwCapW + heatingCapW) : 0;
    let heatingW = Math.min(heatingCapW, availableW - dhwW);
    // DHW's stratification and minimum-power rules are authoritative. Reassign
    // unusable small remainders to HK, not to a phantom DHW target.
    dhwW = dhwCapW > 0 ? simulateDhwTarget(Math.min(dhwCapW, Math.floor(dhwW))) : 0;
    heatingW = Math.min(heatingCapW, Math.max(0, availableW - dhwW));
    return {dhwW, heatingW: Math.floor(heatingW)};
}

function coordinatedFineRegulator(battery, actualBatteryW, batteryTargetW,
    gridErrorW, dischargeLimitW, dhwCapW, heatingCapW, deadbandW) {
    const toleranceW = Math.max(20, deadbandW);
    let batteryHasRoom = false;
    if (battery.available) {
        if (gridErrorW < -toleranceW) batteryHasRoom = battery.canCharge
            && actualBatteryW < battery.maxChargeW - toleranceW;
        else if (gridErrorW > toleranceW) batteryHasRoom = actualBatteryW > toleranceW
            || (battery.canDischarge && dischargeLimitW > toleranceW
                && actualBatteryW > -dischargeLimitW + toleranceW);
        else batteryHasRoom = (battery.canCharge && batteryTargetW >= 0
            && batteryTargetW < battery.maxChargeW - toleranceW)
            || (battery.canDischarge && batteryTargetW < 0
                && batteryTargetW > -dischargeLimitW + toleranceW);
    }
    if (batteryHasRoom) return 'Battery';
    return dhwCapW > 0 ? 'MyPV_DHW' : heatingCapW > 0 ? 'MyPV_Heating' : 'none';
}

function wallboxStopDelayBatteryPowerW() {
    if (nativeConfig.batteryDispatchMode !== 'sunenergy-heads' || nativeConfig.batteryPvPriorityEnabled !== true)
        return 0;
    return Math.max(0, -(batteryMeasuredPowerW() ?? 0));
}

function coordinatedWallboxStopDelayBufferW(scope, wallboxPlans, actualWallboxesW, baseGridW, now) {
    if (nativeConfig.batteryDispatchMode !== 'sunenergy-heads' || nativeConfig.batteryPvPriorityEnabled !== true)
        return 0;
    const active = scope.wallboxes.filter(wb => actualWallboxesW[wb] > 20);
    if (active.length !== 1) return 0;
    const wb = active[0], r = CFG.root;
    const device = `${r}.Devices.Wallbox${wb}`;
    const remaining = getState(`${device}.StopDelayRemaining_s`);
    if (!(remaining?.ack === true && !remaining.q && remaining.val > 0
        && remaining.ts <= now && now - remaining.ts < remaining.val * 1000)) return 0;
    if (getState(`${device}.OutputOwned`)?.val !== true || getState(`${device}.OutputActive`)?.val !== true
        || getState(`${device}.StopDelayActive`)?.val !== true
        || getState(`${device}.PhaseSwitchPending`)?.val === true
        || getState(`${device}.PhaseTransitionActive`)?.val === true
        || getState(`${r}.Vehicles.Wallbox${wb}.MustCharge`)?.val !== false
        || getState(`${r}.Control.Wallbox${wb}PriceGridCharge_W`)?.val > 0
        || priceChargingAuthorization(`Wallbox${wb}`, wallboxPlans[wb], now).gridW > 0) return 0;
    return Math.floor(Math.max(0, actualWallboxesW[wb] + Math.min(0, baseGridW)));
}

function coordinatedWallboxBufferW(scope, wallboxPlans, actualWallboxesW, pvDeficitW, now) {
    const toleranceW = Number(nativeConfig.wallboxPVImportToleranceW ?? 50);
    if (!Number.isFinite(toleranceW) || toleranceW > 200 || pvDeficitW <= 0 || pvDeficitW > toleranceW)
        return 0;
    const active = scope.wallboxes.filter(wb => actualWallboxesW[wb] > 0);
    const r = CFG.root;
    const pvOnly = active.length > 0 && active.every(wb =>
        getState(`${r}.Devices.Wallbox${wb}.OutputOwned`)?.val === true
        && getState(`${r}.Devices.Wallbox${wb}.OutputActive`)?.val === true
        && getState(`${r}.Vehicles.Wallbox${wb}.MustCharge`)?.val === false
        && priceChargingAuthorization(`Wallbox${wb}`, wallboxPlans[wb], now).gridW === 0);
    return pvOnly ? Math.floor(pvDeficitW) : 0;
}

// The slot target is the storage trajectory, distinct from its static
// maximum SoC and from a tariff's independently binding discharge floor.
function batteryWallboxStepPolicy(now, battery) {
    if (nativeConfig.batteryWallboxHalfStepEnabled !== true || !parallelWallboxChargingEnabled()
        || !battery.available || measurementFallbackActive) return null;
    const r = CFG.root;
    const source = getState(`${r}.Plan.BatteryTargetSoC_48h_JSON`);
    const updated = numericValue(getState(`${r}.Plan.LastUpdate`)?.val);
    if (getState(`${r}.Plan.Valid`)?.val !== true || source?.ack !== true || source.q
        || !(updated > 0 && now - updated >= 0 && now - updated <= 20 * 60000)) return null;
    const target = numericValue(currentPlanItem('BatteryTargetSoC', now, 'value_pct')?.value_pct);
    if (target === null || target < 0 || target > 100) return null;
    const floor = Math.max(target + 1, battery.minSoc, batteryPriceDischargeFloor(now));
    let supportW = battery.canDischarge && battery.soc > floor ? battery.maxDischargeW : 0;
    if (supportW > 0 && battery.heads) {
        const options = batteryHeadsAllocationOptions(battery);
        const result = sunEnergyHeads.allocate(-supportW, batteryHeadsLimitedSnapshots(battery),
            {...options, priceFloor: floor});
        supportW = result.valid ? Math.max(0, -result.acceptedW) : 0;
    }
    return {preferBattery: battery.soc <= target, supportW};
}

// The output and its queued write both revalidate storage readiness. The
// signed physical AC power removes the current battery action from the NVP
// balance before granting any additional support, so it cannot count twice.
function wallboxBatteryStepBacking(wb, phases, voltage) {
    if (nativeConfig.batteryWallboxHalfStepEnabled !== true || ![1, 3].includes(phases)
        || !Number.isFinite(voltage) || voltage < 200) return null;
    const r = CFG.root, now = Date.now(), base = `${r}.Devices.Wallbox${wb}`;
    const limit = currentConsumptionLimit();
    if (!limit.valid || limit.active || getState(`${r}.Control.Valid`)?.val !== true
        || getState(`${base}.OutputOwned`)?.val !== true || getState(`${base}.OutputActive`)?.val !== true
        || getState(`${base}.ConfirmedPhases`)?.val !== phases
        || getState(`${base}.PhaseSwitchPending`)?.val === true
        || getState(`${base}.PhaseTransitionActive`)?.val === true
        || getState(`${r}.Vehicles.Wallbox${wb}.MustCharge`)?.val !== false
        || getState(`${r}.Devices.MyPV_DHW.MustHeat`)?.val === true
        || priceChargingAuthorization(`Wallbox${wb}`, null, now).gridW > 0
        || priceChargingAuthorization('Battery', null, now).gridW > 0) return null;
    const loads = coordinatedConsumptionLoads();
    if (!loads.valid || loads.dhwW + loads.heatingW > 0
        || loads.wallboxesW.some((watts, peer) => peer !== wb && watts > 20)
        || readNumber(`${r}.Control.Targets.MyPV_DHW_W`, 0) > 0
        || readNumber(`${r}.Control.Targets.MyPV_Heating_W`, 0) > 0) return null;
    const battery = batteryRegulationState(true);
    const policy = batteryWallboxStepPolicy(now, battery);
    const supportW = Math.min(voltage * phases / 2, policy?.supportW ?? 0);
    return supportW > 0 && Number.isFinite(battery.actualW) ? {supportW, actualW: battery.actualW, reversing: battery.reversing} : null;
}

function coordinatedRealtimeControl(input) {
    const {now, gridW, targetGridW, deadbandW, errorW, batteryPlan, dhwPlan,
        heatingPlan, boostPlan, wallboxPlans, consumptionLimit} = input;
    const r = CFG.root;
    const scope = realtimeProductionScope();
    const battery = typeof batteryRegulationState === 'function' ? {...batteryRegulationState(nativeConfig.batteryWallboxHalfStepEnabled === true)}
        : {available: false, reason: 'Batteriemodul nicht verfuegbar', actualW: 0,
            canCharge: false, canDischarge: false, maxChargeW: 0, maxDischargeW: 0};
    const heating = typeof evaluateHeatingSimulation === 'function' ? evaluateHeatingSimulation()
        : {available: false, release: false, thermalCapW: 0, actualW: 0};
    const liveLoads = coordinatedConsumptionLoads();
    if (!liveLoads.valid)
        return zeroRealtimeTargets('Gemeinsame Verbrauchermessung fehlt/veraltet; keine belastbare Leistungsverteilung');
    // Do not nominate the storage for absorption when its physical phase
    // headroom is already exhausted. The EHZ must get the fast fallback then.
    if (battery.available && typeof batteryHouseConnectionCapW === 'function') {
        const houseCapW = batteryHouseConnectionCapW(battery.actualW);
        if (houseCapW === null) {
            battery.available = false;
            battery.canCharge = false;
            battery.canDischarge = false;
        } else {
            battery.maxChargeW = Math.max(0, Math.min(battery.maxChargeW, houseCapW));
            battery.canCharge = battery.canCharge && battery.maxChargeW > Math.max(0, battery.deadbandW || 0);
        }
    }
    if (consumptionLimit.groupNet && battery.available) {
        battery.maxChargeW = Math.max(0, gridGroupCapW('Battery', battery.maxChargeW, consumptionLimit));
        battery.canCharge = battery.canCharge && battery.maxChargeW > Math.max(0, battery.deadbandW || 0);
    }
    const heatingArmed = nativeConfig.globalWriteEnabled === true
        && nativeConfig.heatingPresent === true && nativeConfig.heatingControlEnabled === true
        && nativeConfig.heatingProductionArmed === true
        && getState(`${r}.Devices.MyPV_Heating.DriverReady`)?.val === true
        && getState(`${r}.Devices.MyPV_Heating.ControlEnabled`)?.val === true
        && getState(`${r}.Devices.MyPV_Heating.Present`)?.val === true;
    const rawHeatingCapW = heatingArmed && heating.available && heating.release
        ? Math.max(0, Number(heating.thermalCapW) || 0) : 0;
    const heatingCapW = consumptionLimit.groupNet ? gridGroupCapW('MyPV_Heating', rawHeatingCapW, consumptionLimit) : rawHeatingCapW;
    const rawDhwCapW = scope.dhw && getState(`${r}.Devices.MyPV_DHW.Release`)?.val === true
        ? Math.max(0, Math.min(readNumber(`${r}.Devices.MyPV_DHW.TemperaturePowerLimit_W`, 0),
            readNumber(`${r}.Config.DHWCommissioningMaxPower_W`, 1000))) : 0;
    const dhwCapW = consumptionLimit.groupNet ? gridGroupCapW('MyPV_DHW', rawDhwCapW, consumptionLimit) : rawDhwCapW;
    const heaterCapW = dhwCapW + heatingCapW;
    const dhwMeasurements = (CFG.dp.myPvDhwOutputW || []).map(id => freshDhwNumber(id, 120000));
    const actualDhwW = dhwMeasurements.length === 3 && dhwMeasurements.every(Number.isFinite)
        ? Math.max(0, dhwMeasurements.reduce((sum, watts) => sum + watts, 0)) : 0;
    const actualHeatingW = Number.isFinite(heating.actualW) ? Math.max(0, heating.actualW) : 0;
    const measuredBattery = typeof batteryMeasuredPowerW === 'function' ? batteryMeasuredPowerW()
        : readNumber(CFG.dp.batteryPower, 0);
    const actualBatteryW = Number.isFinite(measuredBattery) ? measuredBattery : 0;
    const actualWallboxesW = CFG.dp.wallboxesKW.map(id => Math.max(0,
        (freshDhwNumber(id, Math.max(5, Number(nativeConfig.wallboxMeasurementMaxAgeS) || 30) * 1000) || 0) * 1000));
    const controlledWallboxesW = actualWallboxesW.reduce((sumW, watts, wb) => sumW
        + (scope.wallboxes.includes(wb) ? watts : 0), 0);
    // Remove the REAL battery measurement as well as the real flexible loads.
    // Otherwise its previous charge is mistaken for house load and its previous
    // discharge can create fictitious surplus for EVs/heaters.
    const controlledDhwW = scope.dhw ? actualDhwW : 0;
    const controlledHeatingW = heatingArmed ? actualHeatingW : 0;
    const actualFlexibleW = controlledDhwW + controlledHeatingW + controlledWallboxesW;
    // External/disabled battery charging is not ours to reclaim. Conversely
    // external discharge must always be removed, or it would look like PV.
    const reclaimableBatteryW = actualBatteryW < 0 || battery.available
        || getState(`${r}.Devices.Battery.OutputOwned`)?.val === true ? actualBatteryW : 0;
    const baseGridW = gridW - actualFlexibleW - reclaimableBatteryW;
    const pvAvailableW = Math.max(0, targetGridW - baseGridW);
    const consumptionBudgetW = consumptionLimit.budgetW === null ? Infinity
        : Math.max(0, consumptionLimit.budgetW);
    const stepPolicy = batteryWallboxStepPolicy(now, battery);
    const batteryFirst = stepPolicy?.preferBattery ?? (nativeConfig.batteryPvPriorityEnabled === true);
    const plannedChargeW = Math.max(0, Number(batteryPlan.valueW) || 0);
    const batteryPrice = priceChargingAuthorization('Battery', batteryPlan, now);
    const batteryGridW = battery.available && battery.canCharge
        ? Math.min(batteryPrice.gridW, battery.maxChargeW, consumptionBudgetW) : 0;
    const fineReserveW = Math.max(0, readNumber(`${r}.Config.BatteryFineReserve_W`, 200));
    let batteryReserveW = battery.available && battery.canCharge
        ? Math.min(pvAvailableW, batteryFirst ? Math.max(0, consumptionBudgetW - batteryGridW) : consumptionBudgetW,
            Math.max(0, battery.maxChargeW - batteryGridW),
            batteryFirst ? Infinity : stepPolicy && stepPolicy.supportW > 0
                ? 0 : Math.max(plannedChargeW - batteryGridW, fineReserveW)) : 0;
    // Split the battery-first band only when the present plan can afford it.
    const batteryPriorityW = stepPolicy?.preferBattery && battery.canCharge
        && battery.soc > battery.minSoc && plannedChargeW < Math.round(battery.maxChargeW)
        && batteryGridW === 0 && !consumptionLimit.active && pvAvailableW > battery.maxChargeW
        ? batteryReserveW : 0;
    const stepWb = liveLoads.wallboxesW.findIndex(watts => watts > 20);
    const stepAvailable = stepPolicy?.supportW > 0 && !consumptionLimit.active && batteryGridW === 0
        && baseGridW < 0 && liveLoads.dhwW + liveLoads.heatingW === 0
        && scope.wallboxes.includes(stepWb) && actualWallboxesW[stepWb] > 20
        && liveLoads.wallboxesW.every((watts, wb) => wb === stepWb || watts <= 20);
    const stepPhases = stepAvailable ? getState(`${r}.Devices.Wallbox${stepWb}.ConfirmedPhases`)?.val : null;
    const stepVoltage = Math.max(200, readNumber(`${r}.Config.WallboxNominalVoltage_V`, 230));
    const batteryStep = [1, 3].includes(stepPhases) && Number.isFinite(stepVoltage)
        ? {wb: stepWb, phases: stepPhases, canCharge: battery.canCharge, reversing: battery.reversing,
            supportW: Math.min(stepPhases * stepVoltage / 2, stepPolicy.supportW)} : null;
    const slowBudgetW = Math.max(0, consumptionBudgetW - batteryReserveW - batteryGridW);
    // Reuse the physical WB ownership, start-delay and quantization logic.
    // Recompute caps each fast tick so a cooling lock/cloud cannot wait for a
    // slower device cycle. Actuator ramps, not budgets, implement the cadence.
    updateSlowTargets(Math.max(0, pvAvailableW - batteryReserveW), wallboxPlans,
        heatingPlan, slowBudgetW, {heaterCapW, consumptionBudgetW, batteryStep, batteryPriorityW});
    batteryReserveW -= slowTargets.batteryPriorityYieldW ?? 0;
    let wallboxAllocationW = slowTargets.wallboxExpectedW.reduce((sum, watts) => sum + watts, 0);
    const pvHeatW = Math.min(heaterCapW, Math.max(0, slowTargets.dhwW));
    const price = typeof evaluateThermalPricePolicy === 'function'
        ? evaluateThermalPricePolicy(now) : {cheapAllowed: false};
    const cheapLimitW = !measurementFallbackActive && price.valid && price.cheapAllowed
        ? Math.max(0, readNumber(`${r}.Config.ThermalCheapGridMax_W`, 0)) : 0;
    const cheapHeatW = Math.min(cheapLimitW, Math.max(0, heaterCapW - pvHeatW),
        Math.max(0, consumptionBudgetW - batteryReserveW - batteryGridW - wallboxAllocationW - pvHeatW));
    const heaters = splitCoordinatedHeaters(pvHeatW + cheapHeatW, dhwCapW, heatingCapW);
    slowTargets.dhwW = heaters.dhwW;
    slowTargets.heatingW = heaters.heatingW;
    let allocatedHeatW = heaters.dhwW + heaters.heatingW;
    let protectedHeatW = Math.min(cheapHeatW, allocatedHeatW);
    let pvHeatAllocatedW = Math.max(0, allocatedHeatW - protectedHeatW);
    // Only actually present cheap heat is protected. A pending heat command
    // must not make the battery start charging from the grid while it ramps.
    let actualCheapHeatW = Math.min(protectedHeatW,
        Math.max(0, controlledDhwW + controlledHeatingW - pvHeatAllocatedW));
    let protectedEvW = [0, 1, 2].reduce((sum, wb) => {
        const importedW = Math.max(0, readNumber(`${r}.Control.Wallbox${wb}PriceGridCharge_W`, 0));
        const evPvW = Math.max(0, slowTargets.wallboxExpectedW[wb] - importedW);
        return sum + Math.min(importedW, Math.max(0, actualWallboxesW[wb] - evPvW));
    }, 0);
    const residualBatteryW = targetGridW - baseGridW - actualFlexibleW + actualCheapHeatW + protectedEvW;
    const desiredBatteryW = batteryGridW > 0 ? batteryGridW + Math.max(0, residualBatteryW) : residualBatteryW;
    // Match the independently measured EV shortfall against physical zero.
    // A residual heater load or intentional grid charging may not use it.
    const pvDeficitW = controlledWallboxesW + baseGridW;
    const halfStepSupportW = slowTargets.batteryStepSupportW ?? 0;
    const stopDelayBufferW = batteryGridW === 0
        ? coordinatedWallboxStopDelayBufferW(scope, wallboxPlans, actualWallboxesW, baseGridW, now) : 0;
    const wallboxBufferW = stopDelayBufferW || (batteryGridW === 0 && baseGridW < 0
        && controlledDhwW + controlledHeatingW === 0 && allocatedHeatW === 0
        ? stepPolicy ? (pvDeficitW > 0 && pvDeficitW <= halfStepSupportW ? Math.floor(pvDeficitW) : 0)
            : batteryFirst ? coordinatedWallboxBufferW(scope, wallboxPlans, actualWallboxesW, pvDeficitW, now) : 0
        : 0);
    const houseDischargeW = Math.max(0, baseGridW);
    const dischargeLimitW = battery.available && battery.canDischarge
        && battery.soc > Math.max(battery.minSoc, batteryPriceDischargeFloor(now))
        ? Math.min(battery.maxDischargeW, houseDischargeW + wallboxBufferW) : 0;
    const reservations = coordinatedConsumptionLoads();
    if (consumptionBudgetW !== Infinity && !reservations.valid)
        return zeroRealtimeTargets('Gemeinsame Verbrauchermessung fuer LPC-Budget fehlt/ungueltig');
    const chargeLimitW = battery.available && battery.canCharge
        && (consumptionBudgetW === Infinity || reservations.valid)
        ? Math.min(battery.maxChargeW,
            Math.max(0, consumptionBudgetW - Math.max(reservations.dhwW, heaters.dhwW)
                - Math.max(reservations.heatingW, heaters.heatingW)
                - Math.max(reservations.wallboxW, wallboxAllocationW))) : 0;
    // A cold wallbox must see its watts at the meter before enabling the car.
    // Yield only while it has an actual start grant and has not begun drawing.
    let batteryTargetW = battery.available
        ? Math.round(clamp(desiredBatteryW, -dischargeLimitW,
            Math.min(chargeLimitW, slowTargets.batteryPriorityStartCapW ?? Infinity))) : 0;
    if (consumptionLimit.groupNet) {
        const selected = readNumber(`${r}.Control.SelectedWallbox`, -1);
        let order = [selected].filter(wb => [0, 1, 2].includes(wb));
        if (typeof parallelWallboxChargingEnabled === 'function' && parallelWallboxChargingEnabled()) {
            try {
                const publication = JSON.parse(getState(`${r}.Control.ParallelWallboxAllocation_JSON`)?.val);
                if (Array.isArray(publication?.order)) order = publication.order;
            } catch { /* The final output still rejects a malformed allocation. */ }
        }
        const fitted = gridGroupConstrainTargets(slowTargets, batteryTargetW,
            gridGroupAllocationOrder(order), consumptionLimit);
        if (!fitted.valid) return zeroRealtimeTargets(fitted.reason);
        batteryTargetW = fitted.batteryTargetW;
        heaters.dhwW = slowTargets.dhwW; heaters.heatingW = slowTargets.heatingW;
        wallboxAllocationW = slowTargets.wallboxExpectedW.reduce((sum, watts) => sum + watts, 0);
        allocatedHeatW = heaters.dhwW + heaters.heatingW;
        protectedHeatW = Math.min(cheapHeatW, allocatedHeatW);
        pvHeatAllocatedW = Math.max(0, allocatedHeatW - protectedHeatW);
        actualCheapHeatW = Math.min(protectedHeatW,
            Math.max(0, controlledDhwW + controlledHeatingW - pvHeatAllocatedW));
        protectedEvW = [0, 1, 2].reduce((sum, wb) => {
            const importedW = Math.max(0, readNumber(`${r}.Control.Wallbox${wb}PriceGridCharge_W`, 0));
            const evPvW = Math.max(0, slowTargets.wallboxExpectedW[wb] - importedW);
            return sum + Math.min(importedW, Math.max(0, actualWallboxesW[wb] - evPvW));
        }, 0);
        gridGroupUpdateParallelPublication(slowTargets);
    }
    const activeWallboxBufferW = Math.max(0, Math.min(wallboxBufferW, -batteryTargetW - houseDischargeW));
    const fineRegulator = activeWallboxBufferW > 0 ? 'Battery' : coordinatedFineRegulator(battery, actualBatteryW, batteryTargetW,
        gridW - targetGridW - actualCheapHeatW - protectedEvW - batteryGridW,
        dischargeLimitW, dhwCapW, heatingCapW, deadbandW);
    const heaterBudgetMode = fineRegulator === 'Battery' || protectedHeatW > 0
        || protectedEvW > 0 || batteryGridW > 0 ? 'BUDGET' : 'FINE';
    const predictedGridW = Math.round(baseGridW + wallboxAllocationW + allocatedHeatW + batteryTargetW);
    const protectedMandatoryW = Math.max(0, wallboxAllocationW - pvAvailableW);
    write(`${r}.Control.CoordinationActive`, true);
    write(`${r}.Control.FineRegulator`, fineRegulator);
    write(`${r}.Control.HeaterBudgetMode`, heaterBudgetMode);
    write(`${r}.Control.AllowHeaterGridImport`, protectedHeatW > 0);
    write(`${r}.Control.UncontrolledGridPower_W`, Math.round(baseGridW));
    write(`${r}.Control.AvailablePVPower_W`, Math.round(pvAvailableW));
    write(`${r}.Control.BatteryPVReserve_W`, Math.round(batteryReserveW));
    publishBatteryWallboxBuffer(activeWallboxBufferW);
    write(`${r}.Control.BatteryPriceGridCharge_W`, Math.round(Math.min(batteryGridW, Math.max(0, batteryTargetW))));
    write(`${r}.Control.PriceChargingStatus`, `Speicher: ${batteryPrice.reason}; EV Netzfreigabe ${Math.round(protectedEvW)} W tatsaechlich`);
    write(`${r}.Control.HeaterPVAllocation_W`, Math.round(pvHeatAllocatedW));
    write(`${r}.Control.HeaterCheapGridAllocation_W`, Math.round(protectedHeatW));
    write(`${r}.Control.ProtectedGridImport_W`, Math.round(protectedHeatW + protectedMandatoryW + batteryGridW));
    write(`${r}.Control.GrossConsumptionTarget_W`, Math.round(Math.max(0, batteryTargetW)
        + allocatedHeatW + wallboxAllocationW));
    write(`${r}.Control.ActualGridPower_W`, Math.round(gridW));
    write(`${r}.Control.PredictedGridPower_W`, predictedGridW);
    write(`${r}.Control.Error_W`, Math.round(errorW));
    write(`${r}.Control.RemainingError_W`, predictedGridW - targetGridW - Math.round(protectedHeatW));
    write(`${r}.Control.PlanSlotTimestamp`, Math.max(Number(batteryPlan.timestamp), Number(dhwPlan.timestamp)));
    write(`${r}.Control.Targets.Battery_W`, batteryTargetW);
    write(`${r}.Control.Targets.MyPV_DHW_W`, slowTargets.dhwW);
    write(`${r}.Control.Targets.MyPV_Heating_W`, slowTargets.heatingW);
    for (const wb of [0, 1, 2]) {
        write(`${r}.Control.Targets.Wallbox${wb}_W`, slowTargets.wallboxW[wb]);
        write(`${r}.Control.Targets.Wallbox${wb}_A`, slowTargets.wallboxA[wb]);
        write(`${r}.Control.Targets.Wallbox${wb}_Phases`, slowTargets.wallboxPhases[wb]);
        write(`${r}.Vehicles.Wallbox${wb}.RecommendedPhases`, slowTargets.wallboxRecommendedPhases[wb]);
    }
    write(`${r}.Control.Targets.PVBoostRelease`, Boolean(boostPlan?.release) && predictedGridW <= deadbandW);
    write(`${r}.Control.SlowCycleSeconds`, Math.max(2, readNumber(`${r}.Config.SlowControlCycle_s`, 5)));
    write(`${r}.Control.CoordinationStatus`, `Feinregler ${fineRegulator}; WW ${heaters.dhwW} W / HK ${heaters.heatingW} W; Batterie ${batteryTargetW} W (+Laden); erlaubter Waermenetzbezug ${Math.round(protectedHeatW)} W`);
    write(`${r}.Control.Status`, `KOORDINIERT: ${fineRegulator} fein / EHZ mittel / Wallbox grob`);
    write(`${r}.Control.Valid`, true);
    write(`${r}.Control.LastUpdate`, now);
    // The recommendation uses this freshly validated decision, including in
    // the isolated shadow engine which intentionally clears Control.Valid.
    if (typeof updateHeatPumpAdvice === 'function') updateHeatPumpAdvice(now, pvAvailableW);
}
