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
        ...((nativeConfig.batteryPvPriorityEnabled === true || nativeConfig.batteryWallboxHalfStepEnabled === true
            || nativeConfig.bhkwWallboxCycleEnabled === true)
            ? {BatteryWallboxBuffer_W: 0} : {}),
        ...(nativeConfig.bhkwWallboxCycleEnabled === true
            ? {BhkwWallboxCycleStatus: 'Wartet', BhkwWallboxCycleOwned: false} : {}),
        HeaterPVAllocation_W: 0, HeaterCheapGridAllocation_W: 0,
        ProtectedGridImport_W: 0, GrossConsumptionTarget_W: 0,
        BatteryPriceGridCharge_W: 0, Wallbox0PriceGridCharge_W: 0,
        Wallbox1PriceGridCharge_W: 0, Wallbox2PriceGridCharge_W: 0,
        PriceChargingStatus: 'Keine Preisladung'
    };
    for (const [name, value] of Object.entries(values))
        stateDef(`${CFG.root}.Control.${name}`, value, typeof value,
            typeof value === 'boolean' ? 'indicator' : typeof value === 'number' ? 'value' : 'text', '', name);
    if (nativeConfig.batteryWallboxHalfStepEnabled === true)
        stateDef(`${CFG.root}.Control.BatteryPVReachedTarget_JSON`, '{}', 'string', 'json', '', 'Erreichtes PV-Speicherziel am lokalen Kalendertag');
}

function coordinatedEnergyEnabled() {
    return getState(`${CFG.root}.System.RealOutputsEnabled`)?.val === true
        && (nativeConfig.batteryControlEnabled === true || nativeConfig.heatingControlEnabled === true);
}

function batteryWallboxOptionalPvHeatSuppressed(canCharge, wallboxReleased) {
    return nativeConfig.batteryWallboxHalfStepEnabled === true && nativeConfig.batteryPvPriorityEnabled === true
        && nativeConfig.batteryDispatchMode === 'sunenergy-heads' && nativeConfig.batteryPresent === true
        && (canCharge || wallboxReleased);
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
        || nativeConfig.bhkwWallboxCycleEnabled === true || getState(id)?.val > 0) write(id, watts);
}

function resetEnergyCoordination(reason) {
    if (bhkwWallboxCycle?.granted) bhkwWallboxCycle = {stopping: true};
    batteryPvStartObservation = null;
    wallboxReductionUntil = 0;
    wallboxTransitionGrant = null;
    if (nativeConfig.bhkwWallboxCycleEnabled === true)
        write(`${CFG.root}.Control.BhkwWallboxCycleStatus`, reason);
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
    if (getState(`${r}.BatteryReserveGridCharge_W`)?.val > 0)
        write(`${r}.BatteryReserveGridCharge_W`, 0);
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
        if (typeof batteryRegulationState !== 'function') return fail('Batteriemodul fehlt');
        const state = batteryRegulationState();
        const now = Date.now();
        const pvPaused = batteryPvChargeStage(now, state)?.paused === true;
        if (typeof batteryPriceSafeTarget === 'function' && internalW > batteryPriceSafeTarget(targetW, now, pvPaused))
            return fail(pvPaused ? 'PV-Ladepause: SoC-Fahrplanziel erreicht'
                : 'Preisfreigabe fuer wartenden Speichernetzbefehl entzogen');
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

const BATTERY_WALLBOX_REDUCTION_MS = 10000;
const BATTERY_WALLBOX_TRANSITION_MIN_SOC = 70;
let wallboxReductionUntil = 0;
let wallboxTransitionGrant = null;

function wallboxTransitionImportW(now, grid, battery) {
    if (!grid?.valid || grid.held || !grid.sourceTs?.length || !Number.isFinite(battery.actualW)) return null;
    const oldest = Math.min(...grid.sourceTs);
    const latest = Math.max(...grid.sourceTs);
    if (now - oldest > BATTERY_WALLBOX_REDUCTION_MS) return null;
    // Subtract only proved discharge. A frame predating the latest AC
    // sample can still justify its observed import, but not extra watts.
    const matched = battery.heads?.every(head => head.acPowerW >= 0 || head.sourceTs <= latest);
    return grid.gridW - (matched ? Math.min(0, battery.actualW) : 0);
}

function wallboxTransitionLoadW(wb, now, grid) {
    const power = getState(CFG.dp.wallboxesKW[wb]);
    const value = numericValue(power?.val);
    // Both readings must still describe the current draw.
    return power?.ack === true && !power.q && value !== null && value >= 0
        && Number.isFinite(power.ts) && now >= power.ts && now - power.ts <= BATTERY_WALLBOX_REDUCTION_MS
        && Math.abs(power.ts - Math.max(...grid.sourceTs)) <= (grid.maxSkewMs ?? 0) + 5000
        ? value * 1000 : null;
}

function wallboxTransitionEligible(wb, phases, now) {
    const r = CFG.root, base = `${r}.Devices.Wallbox${wb}`;
    return [1, 3].includes(phases) && getState(`${base}.ConfirmedPhases`)?.val === phases
        && getState(`${base}.PhaseSwitchPending`)?.val !== true
        && getState(`${base}.PhaseTransitionActive`)?.val !== true
        && getState(`${base}.StopPowerPending`)?.val !== true && getState(`${base}.NoDrawPaused`)?.val !== true
        && getState(`${r}.Vehicles.Wallbox${wb}.Release`)?.val === true
        && getState(`${r}.Vehicles.Wallbox${wb}.MustCharge`)?.val === false
        && !(getState(`${r}.Control.Wallbox${wb}PriceGridCharge_W`)?.val > 0)
        && priceChargingAuthorization(`Wallbox${wb}`, null, now).gridW === 0
        && wallboxHandoffSourceValid(wb, now, true);
}

function wallboxTransitionSupportW(battery, now) {
    // End this support when a pack reaches the buffer reserve.
    // Household discharge uses its own floor and the driver's hysteresis.
    if (!battery.canDischarge || battery.soc <= BATTERY_WALLBOX_TRANSITION_MIN_SOC
        || battery.soc <= batteryPriceDischargeFloor(now)
        || !battery.heads?.length || battery.heads.some(head => {
            const acquiredAt = head.deviceTs ?? head.sourceTs;
            return head.minPackSoc <= BATTERY_WALLBOX_TRANSITION_MIN_SOC
                || !(acquiredAt > 0 && acquiredAt <= now + 1000 && now - acquiredAt <= BATTERY_WALLBOX_REDUCTION_MS);
        })) return 0;
    return battery.availableDischargeW ?? 0;
}

function wallboxStopDelayUntil(wb, now) {
    const base = `${CFG.root}.Devices.Wallbox${wb}`;
    const remaining = getState(`${base}.StopDelayRemaining_s`);
    const until = remaining?.ts + remaining?.val * 1000;
    return getState(`${base}.StopDelayActive`)?.val === true && remaining?.ack === true && !remaining.q
        && remaining.val > 0 && remaining.ts <= now && until > now ? until : 0;
}

function wallboxTransitionBudgetW(importW, supportW, liveW, targetW) {
    return Math.floor(Math.max(0, Math.min(importW, supportW, liveW - targetW)));
}

function coordinatedWallboxTransitionBufferW(now, grid, battery, candidate, supportW, ordinaryW, gridDeadbandW) {
    wallboxTransitionGrant = null;
    if (nativeConfig.batteryPvPriorityEnabled !== true || nativeConfig.batteryDispatchMode !== 'sunenergy-heads') return 0;
    const importW = wallboxTransitionImportW(now, grid, battery);
    if (importW !== null && battery.actualW >= 0 && importW <= Math.max(0, battery.deadbandW || 0))
        wallboxReductionUntil = 0;
    if (importW === null || !candidate) return 0;
    const {wb, phases, targetW} = candidate;
    if (supportW === 0 || !wallboxTransitionEligible(wb, phases, now)) return 0;
    const liveW = wallboxTransitionLoadW(wb, now, grid);
    if (liveW === null) return 0;
    const delayUntil = wallboxStopDelayUntil(wb, now);
    if (!delayUntil && targetW <= 0) return 0;
    const watts = wallboxTransitionBudgetW(importW, supportW, liveW, delayUntil ? 0 : targetW);
    // During the stop delay even a small deficit can be covered. Open a new
    // fast-reduction window only for a material drop and after real recovery.
    const deadbandW = delayUntil ? 0 : Math.max(battery.deadbandW, gridDeadbandW);
    if (watts <= Math.max(ordinaryW, deadbandW)) return 0;
    if (!delayUntil && wallboxReductionUntil === 0) wallboxReductionUntil = now + BATTERY_WALLBOX_REDUCTION_MS;
    const until = delayUntil || wallboxReductionUntil;
    if (now >= until) return 0;
    wallboxTransitionGrant = {wb, phases, at: now, targetW: delayUntil ? 0 : targetW, until, delay: delayUntil > 0,
        ordinaryW, deadbandW, householdW: Math.max(0, importW - liveW)};
    return watts;
}

// The queued GS gets no extra watts from an obsolete timer or meter reading.
function batteryWallboxTransitionLimitW(state, limit, now) {
    const grant = wallboxTransitionGrant;
    if (!grant) return Infinity;
    const {wb, phases, targetW, at, until, delay, ordinaryW, deadbandW, householdW} = grant;
    const r = CFG.root;
    const grid = realtimeGridMeasurement();
    const importW = wallboxTransitionImportW(now, grid, state);
    if (importW === null) return 0;
    const loads = coordinatedConsumptionLoads();
    if (!loads.valid || loads.dhwW + loads.heatingW > 0
        || loads.wallboxesW.some((watts, peer) => peer !== wb && watts > 20)) return 0;
    const liveW = wallboxTransitionLoadW(wb, now, grid);
    if (liveW === null) return 0;
    const houseW = Math.max(0, Math.min(householdW, importW - liveW));
    if (limit.active || !realtimeProductionScope().wallboxes.includes(wb) || !wallboxTransitionEligible(wb, phases, now)
        || getState(`${r}.Devices.MyPV_DHW.MustHeat`)?.val === true
        || priceChargingAuthorization('Battery', null, now).gridW > 0) return houseW;
    const ordinaryLimitW = Math.max(houseW, Math.min(houseW + ordinaryW, importW));
    if (now >= until || now - at > 4000 || delay && wallboxStopDelayUntil(wb, now) === 0) return ordinaryLimitW;
    const watts = wallboxTransitionBudgetW(importW, wallboxTransitionSupportW(state, now), liveW, targetW);
    return watts > deadbandW ? Math.max(ordinaryLimitW, Math.min(importW, houseW + watts)) : ordinaryLimitW;
}

function scheduledBatteryPvTarget(now) {
    if (measurementFallbackActive) return null;
    const r = CFG.root;
    const source = getState(`${r}.Plan.BatteryTargetSoC_48h_JSON`);
    const updated = numericValue(getState(`${r}.Plan.LastUpdate`)?.val);
    if (getState(`${r}.Plan.Valid`)?.val !== true || source?.ack !== true || source.q
        || !(updated > 0 && now - updated >= 0 && now - updated <= 20 * 60000)) return null;
    const target = numericValue(currentPlanItem('BatteryTargetSoC', now, 'value_pct')?.value_pct);
    return target !== null && target >= 0 && target <= 100 ? target : null;
}

function reachedBatteryPvTarget(day) {
    const reached = getState(`${CFG.root}.Control.BatteryPVReachedTarget_JSON`);
    if (reached?.ack !== true || reached.q) return -1;
    try {
        const saved = JSON.parse(reached.val);
        if (saved?.day === day && Number.isFinite(saved.target) && saved.target >= 0 && saved.target <= 100)
            return saved.target;
    } catch { /* Wait for a measured target. */ }
    return -1;
}

function batteryPvChargeStage(now, battery) {
    if (nativeConfig.batteryWallboxHalfStepEnabled !== true || !parallelWallboxChargingEnabled()) return null;
    const day = localDateKey(new Date(now));
    const target = scheduledBatteryPvTarget(now);
    const heldTarget = reachedBatteryPvTarget(day);
    const reachedNow = target !== null && Number.isFinite(battery.soc) && battery.soc >= target;
    // A dip in SoC or a temporary forecast outage does not reopen a completed stage.
    const paused = reachedNow || heldTarget >= (target ?? 0);
    return {day, target, heldTarget, reachedNow, paused};
}

function batteryWallboxStepPolicy(now, battery, stage = batteryPvChargeStage(now, battery)) {
    const target = stage?.target;
    if (!battery.available || target == null) return null;
    const floor = Math.max(target + 1, battery.minSoc, batteryPriceDischargeFloor(now));
    let supportW = battery.canDischarge && battery.soc > floor ? battery.maxDischargeW : 0;
    if (supportW > 0 && battery.heads) {
        const options = batteryHeadsAllocationOptions(battery);
        const result = sunEnergyHeads.allocate(-supportW, batteryHeadsLimitedSnapshots(battery),
            {...options, priceFloor: floor});
        supportW = result.valid ? Math.max(0, -result.acceptedW) : 0;
    }
    return {preferBattery: !stage.paused, supportW};
}

let batteryPvStartObservation = null;

function observeBatteryPvStartBudget(now, battery, grid, eligible) {
    const reset = () => { batteryPvStartObservation = null; return null; };
    if (!eligible || battery.heads?.length !== 1 || !Number.isFinite(battery.actualW) || battery.actualW < 0
        || !grid?.valid || grid.held || !grid.sourceTs?.length) return reset();
    const head = battery.heads[0];
    const minimumW = battery.maxChargeW;
    const meterAt = Math.max(...grid.sourceTs);
    const maxGapMs = Math.min(battery.measurementAgeMs, wallboxHandoffMaximumGapMs());
    // Only count physically consumed battery power and residual grid export.
    // Reclaimable heater budgets and pending setpoints never age this proof.
    const availableW = battery.actualW - grid.gridW;
    if (!batteryHeadDriverAcquisition(head, head, 0, battery) || !(meterAt > 0)
        || Math.abs(meterAt - head.sourceTs) > maxGapMs
        || now - Math.min(meterAt, head.deviceTs) > maxGapMs
        || Math.round(availableW) < minimumW - Math.min(25, battery.deadbandW)) return reset();
    const {setpointId, deviceTs: deviceAt} = head;
    let proof = batteryPvStartObservation;
    if (!proof || proof.setpointId !== setpointId || proof.minimumW !== minimumW
        || now - proof.observedAt > maxGapMs || deviceAt < proof.deviceAt || meterAt < proof.meterAt)
        proof = batteryPvStartObservation = {setpointId, minimumW, since: now, observedAt: now, deviceAt: 0, meterAt: 0};
    if (deviceAt > proof.deviceAt && meterAt > proof.meterAt)
        Object.assign(proof, {deviceAt, meterAt, observedAt: now});
    const delayMs = Math.max(0, readNumber(`${CFG.root}.Config.WallboxStartDelay_s`, 30)) * 1000;
    return Math.min(proof.deviceAt, proof.meterAt) - proof.since >= delayMs ? proof.since : null;
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
    const transitionSupportW = nativeConfig.batteryDispatchMode === 'sunenergy-heads'
        ? wallboxTransitionSupportW(battery, now) : Infinity;
    const supportW = Math.min(voltage * phases / 2, policy?.supportW ?? 0, transitionSupportW);
    return supportW > 0 && Number.isFinite(battery.actualW) ? {supportW, actualW: battery.actualW, reversing: battery.reversing} : null;
}

let bhkwWallboxCycle = null;

function bhkwWallboxCycleBudget(now, battery, scope, limit, loads, wallboxPlans) {
    if (nativeConfig.bhkwWallboxCycleEnabled !== true || nativeConfig.batteryDispatchMode !== 'sunenergy-heads'
        || !scope.production || !scope.wallboxes.includes(0) || !parallelWallboxChargingEnabled()
        || !limit.valid || limit.active || !loads.valid || !battery.canDischarge || battery.heads?.length !== 1
        || loads.dhwW + loads.heatingW > 0 || loads.wallboxesW.slice(1).some(watts => watts > 20)) return null;
    const r = CFG.root;
    if (getState(`${r}.Devices.MyPV_DHW.MustHeat`)?.val === true
        || priceChargingAuthorization('Battery', null, now).gridW > 0
        || [0, 1, 2].some(wb => getState(`${r}.Vehicles.Wallbox${wb}.MustCharge`)?.val === true
            || priceChargingAuthorization(`Wallbox${wb}`, wallboxPlans?.[wb], now).gridW > 0)) return null;
    const hour = Number(tariffClock.formatToParts(now).find(part => part.type === 'hour')?.value);
    const pv = getState(CFG.dp.pvPower);
    const pvW = numericValue(pv?.val);
    const bhkw = bhkwTelemetry(now);
    const grid = realtimeGridMeasurement();
    if (!(hour >= 20 || hour < 6) || !pv || pv.q || !(pv.ts > 0 && pv.ts <= now && now - pv.ts <= CFG.dataMaxAgeMs)
        || pvW === null || pvW < 0 || pvW > 50
        || !bhkw.valid || !(bhkw.powerW > 50) || !grid.valid || grid.held
        || !wallboxHandoffSourceValid(0, now)) return null;
    const vehicle = vehicleState(0);
    if (!vehicle.release || vehicle.mustCharge || !vehicle.socValid || vehicle.phaseSwitchEnabled
        || vehicle.maximumPhases !== 1 || vehicle.minCurrent1pA !== 6 || vehicle.maxCurrent1pA < 6) return null;
    const voltage = readNumber(`${r}.Config.WallboxNominalVoltage_V`, 230);
    const minimumW = 6 * voltage;
    if (!(voltage >= 200 && voltage <= 250) || vehicle.maximumPowerW < minimumW) return null;
    const head = battery.heads[0];
    const ceiling = Math.min(battery.maxSoc, head.maxSoc);
    const floor = Math.max(ceiling - 10, battery.minSoc, head.minSoc, batteryPriceDischargeFloor(now));
    if (!(ceiling > floor && head.minPackSoc > floor)) return null;
    const wallboxW = freshDhwNumber(CFG.dp.wallboxesKW[0],
        Math.max(5, Number(nativeConfig.wallboxMeasurementMaxAgeS) || 30) * 1000);
    if (wallboxW === null || wallboxW < 0) return null;
    // The grid meter already includes the BHKW. Reconstruct only the surplus
    // without the Mii and without the battery's present charge/discharge.
    const surplusW = Math.min(bhkw.powerW, wallboxW * 1000 + battery.actualW - grid.gridW);
    if (!(surplusW > 50 && surplusW < minimumW)) return null;
    const supportW = Math.ceil(minimumW - surplusW);
    const options = batteryHeadsAllocationOptions(battery);
    const backing = sunEnergyHeads.allocate(-battery.maxDischargeW, batteryHeadsLimitedSnapshots(battery),
        {...options, priceFloor: floor});
    if (!backing.valid || -backing.acceptedW < supportW) return null;
    const capacity = numericValue(getState(`${r}.Devices.Battery.Profile.Capacity_kWh`)?.val);
    const minimumRunS = Math.max(0, readNumber(`${r}.Config.WallboxMinimumRunTime_s`, 120));
    const full = head.minPackSoc >= ceiling && getState(`${r}.Devices.Battery.Profile.CapacityValid`)?.val === true
        && capacity > 0 && capacity * 1000 * (head.minPackSoc - floor) / 100
            * batteryPlanningEfficiency() >= supportW * minimumRunS / 3600;
    return {minimumW, supportW, dischargeW: Math.max(0, Math.round(wallboxW * 1000 - surplusW)),
        availableW: -backing.acceptedW + surplusW, full, ceiling, floor};
}

function bhkwWallboxCycleBacking(timestamp, battery = batteryRegulationState(), limit = currentConsumptionLimit()) {
    const now = Date.now();
    if (!bhkwWallboxCycle?.granted || bhkwWallboxCycle.at !== timestamp || now - timestamp > 4000
        || getState(`${CFG.root}.Control.Valid`)?.val !== true) return null;
    const budget = bhkwWallboxCycleBudget(now, battery, realtimeProductionScope(), limit, coordinatedConsumptionLoads());
    return budget && (bhkwWallboxCycle.started || budget.full) ? budget : null;
}

function bhkwWallboxCycleStopping() {
    const r = CFG.root;
    return bhkwWallboxCycle?.stopping === true
        || !bhkwWallboxCycle && getState(`${r}.Control.BhkwWallboxCycleOwned`)?.val === true;
}

function coordinatedRealtimeControl(input) {
    const {now, gridW, gridSample, targetGridW, deadbandW, errorW, batteryPlan, dhwPlan,
        heatingPlan, boostPlan, wallboxPlans, consumptionLimit} = input;
    const r = CFG.root;
    const scope = realtimeProductionScope();
    const battery = typeof batteryRegulationState === 'function' ? {...batteryRegulationState(nativeConfig.batteryWallboxHalfStepEnabled === true)}
        : {available: false, reason: 'Batteriemodul nicht verfuegbar', actualW: 0,
            canCharge: false, canDischarge: false, maxChargeW: 0, maxDischargeW: 0};
    battery.maxChargeW = battery.availableChargeW ?? battery.maxChargeW;
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
    const optionalHeatSuppressed = batteryWallboxOptionalPvHeatSuppressed(battery.canCharge,
        scope.wallboxes.some(wb => getState(`${r}.Vehicles.Wallbox${wb}.Release`)?.val === true));
    const requiredDhw = getState(`${r}.Devices.MyPV_DHW.MustHeat`)?.val === true;
    const dhwPvCapW = !optionalHeatSuppressed || requiredDhw ? dhwCapW : 0;
    const heatingPvCapW = optionalHeatSuppressed ? 0 : heatingCapW;
    const heaterCapW = dhwPvCapW + heatingPvCapW;
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
    const wasBhkwCycle = bhkwWallboxCycle?.granted === true;
    const cycleBudget = bhkwWallboxCycleBudget(now, battery, scope, consumptionLimit, liveLoads, wallboxPlans);
    const cycleOwned = getState(`${r}.Devices.Wallbox0.OutputOwned`)?.val === true;
    const cycleStarted = wasBhkwCycle && cycleOwned;
    const cycleStopping = cycleOwned && (bhkwWallboxCycleStopping() || wasBhkwCycle && !cycleBudget);
    const cycle = !cycleStopping && cycleBudget && (cycleStarted || cycleBudget.full && !cycleOwned
        && wallboxPreStartPhaseReady(0, now))
        ? {...cycleBudget, started: cycleStarted, at: now} : null;
    const consumptionBudgetW = consumptionLimit.budgetW === null ? Infinity
        : Math.max(0, consumptionLimit.budgetW);
    const stage = batteryPvChargeStage(now, battery);
    if (battery.eligible && stage?.reachedNow && stage.target > stage.heldTarget)
        write(`${r}.Control.BatteryPVReachedTarget_JSON`, JSON.stringify({day: stage.day, target: stage.target}));
    const pvChargePaused = stage?.paused === true;
    const canAbsorbPv = battery.canCharge && !pvChargePaused;
    const stepPolicy = batteryWallboxStepPolicy(now, battery, stage);
    const batteryFirst = !pvChargePaused && (stepPolicy?.preferBattery ?? (nativeConfig.batteryPvPriorityEnabled === true));
    const plannedChargeW = Math.max(0, Number(batteryPlan.valueW) || 0);
    const requiredPvChargeW = Math.max(0, numericValue(batteryPlan.requiredPvChargeW) ?? plannedChargeW);
    const batteryPrice = priceChargingAuthorization('Battery', batteryPlan, now);
    const reserveRecovery = typeof batteryReserveRecoveryRequired === 'function'
        ? batteryReserveRecoveryRequired(battery) : null;
    if (reserveRecovery !== null)
        write(`${r}.Devices.Battery.ReserveRecoveryActive`, reserveRecovery);
    const recoveryGrid = reserveRecovery === true ? realtimeGridMeasurement() : null;
    const reserveGridW = recoveryGrid?.valid && !recoveryGrid.held && battery.canCharge
        ? Math.min(BATTERY_RESERVE_RECOVERY_W, battery.maxChargeW, consumptionBudgetW) : 0;
    const batteryGridW = reserveRecovery === true ? reserveGridW : battery.available && battery.canCharge
        ? Math.min(batteryPrice.gridW, battery.maxChargeW, consumptionBudgetW) : 0;
    const fineReserveW = Math.max(0, readNumber(`${r}.Config.BatteryFineReserve_W`, 200));
    let batteryReserveW = battery.available && canAbsorbPv
        ? Math.min(pvAvailableW, batteryFirst ? Math.max(0, consumptionBudgetW - batteryGridW) : consumptionBudgetW,
            Math.max(0, battery.maxChargeW - batteryGridW),
            batteryFirst ? Infinity : stepPolicy && stepPolicy.supportW > 0
                ? 0 : Math.max(plannedChargeW - batteryGridW, fineReserveW)) : 0;
    // A forecast's opportunistic full charge is not a binding PV requirement.
    const canShareBatteryPv = stepPolicy?.preferBattery && battery.canCharge
        && battery.soc > battery.minSoc && requiredPvChargeW < Math.round(battery.maxChargeW)
        && batteryGridW === 0 && !consumptionLimit.active;
    const batteryPriorityW = canShareBatteryPv && pvAvailableW > battery.maxChargeW ? batteryReserveW : 0;
    const batteryPvStartSince = observeBatteryPvStartBudget(now, battery, gridSample,
        canShareBatteryPv && !requiredDhw && liveLoads.wallboxesW.every(watts => watts <= 20));
    const stepWb = liveLoads.wallboxesW.findIndex(watts => watts > 20);
    const singlePvWallbox = !consumptionLimit.active && batteryGridW === 0
        && liveLoads.dhwW + liveLoads.heatingW === 0
        && scope.wallboxes.includes(stepWb) && actualWallboxesW[stepWb] > 20
        && liveLoads.wallboxesW.every((watts, wb) => wb === stepWb || watts <= 20);
    const stepPhases = singlePvWallbox ? getState(`${r}.Devices.Wallbox${stepWb}.ConfirmedPhases`)?.val : null;
    const stepVoltage = Math.max(200, readNumber(`${r}.Config.WallboxNominalVoltage_V`, 230));
    const transitionSupportW = nativeConfig.batteryDispatchMode === 'sunenergy-heads'
        ? wallboxTransitionSupportW(battery, now) : Infinity;
    const stepSupportW = Math.min(stepPolicy?.supportW ?? 0, transitionSupportW);
    const batteryStep = baseGridW < 0 && stepSupportW > 0
        && [1, 3].includes(stepPhases) && Number.isFinite(stepVoltage)
        ? {wb: stepWb, phases: stepPhases, canCharge: canAbsorbPv, reversing: battery.reversing,
            supportW: Math.min(stepPhases * stepVoltage / 2, stepSupportW)} : null;
    const slowBudgetW = Math.max(0, consumptionBudgetW - batteryReserveW - batteryGridW);
    // Reuse the physical WB ownership, start-delay and quantization logic.
    // Recompute caps each fast tick so a cooling lock/cloud cannot wait for a
    // slower device cycle. Actuator ramps, not budgets, implement the cadence.
    updateSlowTargets(Math.max(0, pvAvailableW - batteryReserveW), wallboxPlans,
        heatingPlan, slowBudgetW, {heaterCapW, consumptionBudgetW, batteryStep, batteryPriorityW, batteryPvStartSince,
            batteryPvAvailableW: Math.max(0, battery.actualW) - gridW,
            batteryPvStartToleranceW: Math.min(25, battery.deadbandW), requiredPvChargeW, bhkwCycle: cycle});
    let cycleGranted = Boolean(cycle && slowTargets.bhkwCycleGranted === true);
    bhkwWallboxCycle = cycleGranted ? {...cycle, granted: true}
        : cycleOwned && (cycleStopping || wasBhkwCycle) ? {stopping: true} : null;
    batteryReserveW -= slowTargets.batteryPriorityYieldW ?? 0;
    let wallboxAllocationW = slowTargets.wallboxExpectedW.reduce((sum, watts) => sum + watts, 0);
    const yieldingForWallbox = slowTargets.batteryPriorityStartCapW !== undefined;
    const pvHeatW = yieldingForWallbox ? 0 : Math.min(heaterCapW, Math.max(0, slowTargets.dhwW));
    const price = typeof evaluateThermalPricePolicy === 'function'
        ? evaluateThermalPricePolicy(now) : {cheapAllowed: false};
    const cheapLimitW = !measurementFallbackActive && price.valid && price.cheapAllowed
        ? Math.max(0, readNumber(`${r}.Config.ThermalCheapGridMax_W`, 0)) : 0;
    const cheapHeatW = yieldingForWallbox ? 0 : Math.min(cheapLimitW, Math.max(0, dhwCapW + heatingCapW - pvHeatW),
        Math.max(0, consumptionBudgetW - batteryReserveW - batteryGridW - wallboxAllocationW - pvHeatW));
    const heaters = splitCoordinatedHeaters(pvHeatW + cheapHeatW, dhwPvCapW + Math.min(cheapHeatW, dhwCapW - dhwPvCapW),
        heatingPvCapW + Math.min(cheapHeatW, heatingCapW - heatingPvCapW));
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
    const desiredBatteryW = reserveRecovery === true ? reserveGridW
        : batteryGridW > 0 ? batteryGridW + Math.max(0, residualBatteryW) : residualBatteryW;
    // Match the independently measured EV shortfall against physical zero.
    // A residual heater load or intentional grid charging may not use it.
    const pvDeficitW = controlledWallboxesW + baseGridW;
    const halfStepSupportW = slowTargets.batteryStepSupportW ?? 0;
    const ordinaryWallboxBufferW = cycleGranted ? cycle.dischargeW : bhkwWallboxCycle?.stopping ? 0
        : batteryGridW === 0 && baseGridW < 0
        && controlledDhwW + controlledHeatingW === 0 && allocatedHeatW === 0
        ? stepPolicy ? (pvDeficitW > 0 && pvDeficitW <= halfStepSupportW ? Math.floor(pvDeficitW) : 0)
            : batteryFirst ? coordinatedWallboxBufferW(scope, wallboxPlans, actualWallboxesW, pvDeficitW, now) : 0
        : 0;
    const transitionCandidate = singlePvWallbox && !cycleGranted && !bhkwWallboxCycle?.stopping
        && !requiredDhw && allocatedHeatW === 0
        ? {wb: stepWb, phases: stepPhases, targetW: baseGridW < 0 ? slowTargets.wallboxW[stepWb] : 0} : null;
    const transitionBufferW = coordinatedWallboxTransitionBufferW(now, gridSample, battery,
        transitionCandidate, transitionSupportW, ordinaryWallboxBufferW, deadbandW);
    const wallboxBufferW = Math.max(ordinaryWallboxBufferW, transitionBufferW);
    const houseDischargeW = Math.max(0, baseGridW);
    const dischargeLimitW = battery.available && battery.canDischarge
        && battery.soc > Math.max(battery.minSoc, batteryPriceDischargeFloor(now))
        ? Math.min(battery.maxDischargeW, houseDischargeW + wallboxBufferW) : 0;
    const reservations = coordinatedConsumptionLoads();
    if (consumptionBudgetW !== Infinity && !reservations.valid)
        return zeroRealtimeTargets('Gemeinsame Verbrauchermessung fuer LPC-Budget fehlt/ungueltig');
    const chargeLimitW = battery.available && battery.canCharge
        && (consumptionBudgetW === Infinity || reservations.valid)
        ? Math.min(pvChargePaused ? batteryGridW : battery.maxChargeW,
            Math.max(0, consumptionBudgetW - Math.max(reservations.dhwW, heaters.dhwW)
                - Math.max(reservations.heatingW, heaters.heatingW)
                - Math.max(reservations.wallboxW, wallboxAllocationW))) : 0;
    // A cold wallbox must see its watts at the meter before enabling the car.
    // Yield only while it has an actual start grant and has not begun drawing.
    let batteryTargetW = cycleGranted ? -cycle.dischargeW : battery.available
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
        if (cycleGranted && slowTargets.wallboxA[0] !== 6) {
            bhkwWallboxCycle = cycleOwned ? {stopping: true} : null;
            batteryTargetW = 0;
            cycleGranted = false;
        }
    }
    if (cycleGranted || bhkwWallboxCycle?.stopping || getState(`${r}.Control.BhkwWallboxCycleOwned`)?.val === true)
        write(`${r}.Control.BhkwWallboxCycleOwned`, Boolean(cycleGranted || bhkwWallboxCycle?.stopping));
    if (nativeConfig.bhkwWallboxCycleEnabled === true)
        write(`${r}.Control.BhkwWallboxCycleStatus`, cycleGranted
            ? `Mii 6 A: BHKW-Puffer ${cycle.dischargeW} W, Stopp bei ${cycle.floor} %`
            : bhkwWallboxCycle?.stopping ? 'Ladeabschnitt endet' : 'Wartet auf BHKW-Ueberschuss und vollen Speicher');
    const activeWallboxBufferW = Math.max(0, Math.min(wallboxBufferW, -batteryTargetW - houseDischargeW));
    const fineRegulator = activeWallboxBufferW > 0 ? 'Battery' : coordinatedFineRegulator({...battery, canCharge: canAbsorbPv},
        actualBatteryW, batteryTargetW, gridW - targetGridW - actualCheapHeatW - protectedEvW - batteryGridW,
        dischargeLimitW, dhwPvCapW, heatingPvCapW, deadbandW);
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
    const grantedGridChargeW = Math.round(Math.min(batteryGridW, Math.max(0, batteryTargetW)));
    if (reserveRecovery !== null || getState(`${r}.Control.BatteryReserveGridCharge_W`)?.val > 0)
        write(`${r}.Control.BatteryReserveGridCharge_W`, reserveRecovery === true ? grantedGridChargeW : 0);
    write(`${r}.Control.BatteryPriceGridCharge_W`, reserveRecovery === true ? 0 : grantedGridChargeW);
    const batteryReason = reserveRecovery === true ? 'Nachladung unter Mindest-SoC' : batteryPrice.reason;
    write(`${r}.Control.PriceChargingStatus`, `Speicher: ${batteryReason}; EV Netzfreigabe ${Math.round(protectedEvW)} W tatsaechlich`);
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
    const pauseStatus = pvChargePaused ? `; PV-Ladepause nach Speicherziel ${Math.max(stage.heldTarget, stage.target ?? 0)} %` : '';
    write(`${r}.Control.CoordinationStatus`, `Feinregler ${fineRegulator}; WW ${heaters.dhwW} W / HK ${heaters.heatingW} W; Batterie ${batteryTargetW} W (+Laden); erlaubter Waermenetzbezug ${Math.round(protectedHeatW)} W${pauseStatus}`);
    write(`${r}.Control.Status`, `KOORDINIERT: ${fineRegulator} fein / EHZ mittel / Wallbox grob`);
    write(`${r}.Control.Valid`, true);
    write(`${r}.Control.LastUpdate`, now);
    // The recommendation uses this freshly validated decision, including in
    // the isolated shadow engine which intentionally clears Control.Valid.
    if (typeof updateHeatPumpAdvice === 'function') updateHeatPumpAdvice(now, pvAvailableW);
}
