'use strict';

// Shared VM boundary. Allocation and the independent output/queue checks use
// the same original source inventory and existing high-water reservations.
function groupAccountingEnabledNow() {
    return nativeConfig.par14aAccountingMode !== undefined
        && nativeConfig.par14aAccountingMode !== 'legacyGross';
}

function gridGroupMapping() {
    const mapping = {DP_GRID_IMPORT: CFG.dp.gridImport, DP_GRID_EXPORT: CFG.dp.gridExport,
        DP_PAR14A: CFG.dp.par14a, DP_PAR14A_LIMIT: CFG.dp.par14aLimit,
        DP_LPC_STATE: CFG.dp.lpcState, DP_LPC_LIMIT: CFG.dp.lpcLimit,
        DP_BATTERY_AC_POWER: CFG.dp.batteryAcPower};
    for (const wb of [0, 1, 2]) mapping[`DP_WB${wb}_POWER`] = CFG.dp.wallboxesKW[wb];
    for (const phase of [1, 2, 3]) {
        mapping[`DP_DHW_OUTPUT${phase}`] = CFG.dp.myPvDhwOutputW[phase - 1];
        mapping[`DP_HEAT_OUTPUT${phase}`] = nativeConfig[`heatingOutput${phase}Id`] || '';
    }
    return mapping;
}

function currentGridGroupLimit() {
    if (typeof gridOperatorRuntime !== 'object') return {groupNet: true, valid: false,
        active: true, budgetW: 0, snapshot: null, reason: 'Gruppen-Netzbilanzmodul fehlt'};
    const result = gridOperatorRuntime.evaluateRuntimeGroup({config: nativeConfig,
        mapping: gridGroupMapping(), namespace: CFG.root, now: Date.now(),
        getState: id => !id.startsWith(`${CFG.root}.`) && typeof getActualState === 'function'
            ? getActualState(id) : getState(id)});
    const diagnostic = {...(result.snapshot || {})};
    if (diagnostic.observation) {
        const {firstAt, lastAt, maxAgeMs, maxSkewMs} = diagnostic.observation;
        // Evaluation still uses the exact current clock. Do not turn repeated
        // read-only output checks of the same observations into recorder writes
        // merely because their evaluation times differ by a millisecond.
        diagnostic.observation = {firstAt, lastAt, maxAgeMs, maxSkewMs};
    }
    write(`${CFG.root}.Control.GridOperatorCalculation_JSON`, JSON.stringify({
        ...result.calculation, budgetCalculation: result.calculation,
        constraintSources: result.constraintSources,
        accounting: 'explicit-group-net; shared-own-supply',
        lpcRecalculated: false, valid: result.valid, active: result.active,
        reason: result.reason, ...diagnostic}));
    return result;
}

function gridGroupDeviceLimit(device, result = null) {
    if (!groupAccountingEnabledNow()) return {valid: true, maximumW: null, reason: 'Bisheriger Bruttomodus'};
    if (typeof gridOperatorRuntime !== 'object') return {valid: false, maximumW: 0, reason: 'Gruppen-Netzbilanzmodul fehlt'};
    return gridOperatorRuntime.deviceGroupLimit(result || currentConsumptionLimit(), device);
}

function gridGroupCommandCheck(device, grossW, result = null) {
    if (!groupAccountingEnabledNow()) return {allowed: true, reason: 'Bisheriger Bruttomodus'};
    if (grossW === 0) return {allowed: true, reason: 'Sicherer Nullbefehl'};
    if (typeof gridOperatorRuntime !== 'object') return {allowed: false, reason: 'Gruppen-Netzbilanzmodul fehlt'};
    return gridOperatorRuntime.checkGroupCommand(result || currentConsumptionLimit(), device, grossW);
}

function gridGroupCapW(device, requestedW, result = null) {
    if (!groupAccountingEnabledNow()) return requestedW;
    const limit = gridGroupDeviceLimit(device, result);
    return limit.valid ? Math.min(requestedW, limit.maximumW === null ? Infinity : limit.maximumW) : 0;
}

function gridGroupVehicle(wb, vehicle, result = null) {
    if (!groupAccountingEnabledNow()) return vehicle;
    return {...vehicle, maximumPowerW: gridGroupCapW(`Wallbox${wb}`, vehicle.maximumPowerW, result)};
}

function gridGroupWallboxPhases(wb, requestedPhases) {
    const base = `${CFG.root}.Devices.Wallbox${wb}`;
    return Math.max(requestedPhases >= 3 ? 3 : 1,
        getState(`${base}.OutputOwned`)?.val === true
            ? readNumber(`${base}.OutputPhases`, 1) >= 3 ? 3 : 1 : 1,
        getState(`${base}.PhaseTransitionActive`)?.val === true
            && readNumber(`${base}.ConfirmedPhases`, 1) >= 3 ? 3 : 1);
}

// Fit one entire quantized proposal vector to one immutable group snapshot.
// Existing command/high-water reservations remain in every next state: a
// proposed reduction never finances the following consumer before response.
function gridGroupConstrainTargets(targets, batteryTargetW = 0, order = [], result = null) {
    if (!groupAccountingEnabledNow()) return {valid: true, batteryTargetW};
    result = result || currentConsumptionLimit();
    const deny = reason => {
        targets.dhwW = 0; targets.heatingW = 0;
        targets.wallboxW.fill(0); targets.wallboxA.fill(0);
        return {valid: false, batteryTargetW: Number.isFinite(batteryTargetW) ? Math.min(0, batteryTargetW) : 0, reason};
    };
    if (!result.valid || !result.snapshot || typeof gridOperatorRuntime !== 'object')
        return deny(result.reason || 'Gemeinsame Gruppenbilanz fehlt');
    if (!result.active) return {valid: true, batteryTargetW};
    const voltage = Math.max(200, readNumber(`${CFG.root}.Config.WallboxNominalVoltage_V`, 230));
    const desired = {MyPV_DHW: Math.max(0, targets.dhwW), MyPV_Heating: Math.max(0, targets.heatingW),
        Battery: Math.max(0, batteryTargetW)};
    for (const wb of [0, 1, 2]) desired[`Wallbox${wb}`] = Math.max(0, targets.wallboxA[wb])
        * voltage * gridGroupWallboxPhases(wb, targets.wallboxPhases[wb]);
    if (!Number.isFinite(batteryTargetW) || Object.values(desired).some(watts => !Number.isFinite(watts)))
        return deny('Gemeinsamer Leistungsvorschlag ist keine endliche Zahl');
    const explicitOrder = [...new Set([...order, 'MyPV_DHW', 'MyPV_Heating', 'Wallbox0', 'Wallbox1', 'Wallbox2', 'Battery'])];
    const proposals = Object.fromEntries(Object.keys(desired).map(device => [device, 0]));
    let snapshot = result.snapshot;
    const quantize = (device, watts, maximumW = watts) => {
        if (device.startsWith('Wallbox')) {
            const wb = Number(device.slice(-1));
            const phaseCount = gridGroupWallboxPhases(wb, targets.wallboxPhases[wb]);
            const vehicle = vehicleState(wb), minimumA = targets.wallboxPhases[wb] >= 3
                ? vehicle.minCurrent3pA : vehicle.minCurrent1pA;
            const requestedA = Math.max(0, Math.floor(targets.wallboxA[wb]));
            let amps = Math.min(requestedA, Math.floor(watts / (voltage * phaseCount)));
            // Recover only an exactly affordable whole-ampere step. Dividing
            // 6*221.06 may lie one ULP either side of six; no watt tolerance is
            // introduced, and the exact nominal product remains authoritative.
            while (amps < requestedA && (amps + 1) * voltage * phaseCount <= watts) amps++;
            while (amps > 0 && amps * voltage * phaseCount > watts) amps--;
            return amps >= minimumA ? amps * voltage * phaseCount : 0;
        }
        if (device.startsWith('MyPV_')) {
            const old = snapshot.devices[device];
            const oldCommittedW = old ? Math.max(old.actualW, old.commandW, old.reservedW) : 0;
            const peakCeilingW = Math.max(oldCommittedW, maximumW);
            // The staged topology is not monotonic in total command watts:
            // reducing 2800 to 2000 W can turn up a different phase before
            // the old stage falls. Search real 100-W commands and require
            // both their total and prospective phase high-water to fit.
            for (let candidateW = Math.floor(watts / 100) * 100; candidateW > 0; candidateW -= 100) {
                const peakW = gridOperatorRuntime.commandReservationW(snapshot, device, candidateW);
                if (Number.isFinite(peakW) && peakW >= 0 && peakW <= peakCeilingW) return candidateW;
            }
            return 0;
        }
        return Math.floor(watts);
    };
    const parallel = typeof parallelWallboxChargingEnabled === 'function' && parallelWallboxChargingEnabled();
    for (const device of explicitOrder.filter(device => /^Wallbox[012]$/.test(device))) {
        const wb = Number(device.slice(-1)), vehicle = vehicleState(wb);
        if (!(parallel ? vehicle.mustCharge : vehicle.belowMinimum) || !(desired[device] > 0)) continue;
        const minimumA = targets.wallboxPhases[wb] >= 3 ? vehicle.minCurrent3pA : vehicle.minCurrent1pA;
        const minimumW = minimumA * voltage * gridGroupWallboxPhases(wb, targets.wallboxPhases[wb]);
        const preview = gridOperatorRuntime.commandBudget(snapshot, device, 0);
        const maximumW = preview.valid && preview.maximumW === null ? Infinity : preview.maximumW || 0;
        const watts = quantize(device, Math.min(desired[device], minimumW, maximumW));
        const step = gridOperatorRuntime.reserveRuntimeGroupCommands(snapshot, {[device]: watts});
        if (step.allowed && step.next) {
            proposals[device] = watts;
            snapshot = step.next;
        }
    }
    for (const device of explicitOrder) {
        const preview = gridOperatorRuntime.commandBudget(snapshot, device, 0);
        const maximumW = preview.valid && preview.maximumW === null ? Infinity : preview.maximumW || 0;
        let watts = quantize(device, Math.min(desired[device] || 0, Math.max(0, maximumW)), maximumW);
        let step = gridOperatorRuntime.reserveRuntimeGroupCommands(snapshot, {[device]: watts});
        if (!step.allowed) {
            watts = proposals[device];
            // A floor already accepted as a safe reduction may still have an
            // older, higher electrical reserve. Repeating that exact accepted
            // command is a no-op, not a new grant. Keep its immutable state;
            // the final joint proof below still checks the original commands.
            step = watts > 0 && snapshot.devices[device]?.commandW === watts
                ? {allowed: true, next: snapshot}
                : gridOperatorRuntime.reserveRuntimeGroupCommands(snapshot, {[device]: watts});
        }
        proposals[device] = watts;
        if (step.next) snapshot = step.next;
    }
    let joint = gridOperatorRuntime.reserveRuntimeGroupCommands(result.snapshot, proposals);
    if (!joint.allowed) {
        // An already overcommitted old electrical response can make holds
        // coexist with a rejected increase. Preserve reductions, never grant
        // an increase merely because another command proposes less power.
        for (const [device, watts] of Object.entries(proposals))
            if (watts > (result.snapshot.devices[device]?.commandW || 0)) proposals[device] = 0;
        joint = gridOperatorRuntime.reserveRuntimeGroupCommands(result.snapshot, proposals);
    }
    if (!joint.allowed) return deny(joint.reason);
    targets.dhwW = proposals.MyPV_DHW;
    targets.heatingW = proposals.MyPV_Heating;
    for (const wb of [0, 1, 2]) {
        const phaseCount = gridGroupWallboxPhases(wb, targets.wallboxPhases[wb]);
        const amps = Math.round(proposals[`Wallbox${wb}`] / (voltage * phaseCount));
        const previousW = targets.wallboxW[wb];
        targets.wallboxA[wb] = amps;
        targets.wallboxW[wb] = Math.round(amps * voltage * targets.wallboxPhases[wb]);
        // Preserve an older physical/high-water draw; the smaller target is
        // not evidence that those watts have already disappeared.
        const old = result.snapshot.devices[`Wallbox${wb}`];
        targets.wallboxExpectedW[wb] = Math.max(Math.ceil(proposals[`Wallbox${wb}`]), targets.wallboxW[wb],
            old ? Math.max(old.actualW, old.commandW, old.reservedW) : 0,
            targets.wallboxW[wb] >= previousW ? targets.wallboxExpectedW[wb] : 0);
        if (amps === 0 && previousW > 0) resetWallboxStartCandidate(wb, 'group-net-budget', Date.now(), 0);
        const priceId = `${CFG.root}.Control.Wallbox${wb}PriceGridCharge_W`;
        write(priceId, Math.min(readNumber(priceId, 0), targets.wallboxW[wb]));
        const diagnosticId = `${CFG.root}.Control.Wallbox${wb}.AllocationDiagnostics_JSON`;
        try {
            const diagnostic = JSON.parse(getState(diagnosticId)?.val);
            if (diagnostic && typeof diagnostic === 'object') write(diagnosticId, JSON.stringify({...diagnostic,
                targetA: amps, groupNetTargetW: targets.wallboxW[wb], groupNetReservedW: targets.wallboxExpectedW[wb],
                groupNetWithinBudget: joint.withinBudget}));
        } catch { /* Diagnostics are not authority for a positive command. */ }
    }
    return {valid: true, batteryTargetW: batteryTargetW < 0 ? batteryTargetW : proposals.Battery,
        proposals, withinBudget: joint.withinBudget, snapshot: joint.next, reason: joint.reason};
}

function gridGroupAllocationOrder(wallboxOrder = []) {
    const boxes = Array.isArray(wallboxOrder) ? [...new Set(wallboxOrder.filter(wb => [0, 1, 2].includes(wb)))] : [];
    const parallel = typeof parallelWallboxChargingEnabled === 'function' && parallelWallboxChargingEnabled();
    const mandatory = parallel ? [] : boxes.filter(wb => vehicleState(wb).belowMinimum).map(wb => `Wallbox${wb}`);
    const heatFirst = getState(`${CFG.root}.Devices.MyPV_DHW.MustHeat`)?.val === true;
    return [...mandatory, ...(heatFirst ? ['MyPV_DHW'] : []),
        ...boxes.map(wb => `Wallbox${wb}`), 'MyPV_DHW', 'MyPV_Heating', 'Battery'];
}

function gridGroupUpdateParallelPublication(targets, allocation = null) {
    if (!groupAccountingEnabledNow() || typeof parallelWallboxChargingEnabled !== 'function'
        || !parallelWallboxChargingEnabled()) return;
    if (!allocation) {
        try {allocation = JSON.parse(getState(`${CFG.root}.Control.ParallelWallboxAllocation_JSON`)?.val);} catch {return;}
    }
    if (!allocation || allocation.schema !== 1 || !Array.isArray(allocation.allocations)) return;
    for (const entry of allocation.allocations) {
        if (![0, 1, 2].includes(entry.wb)) continue;
        entry.targetA = targets.wallboxA[entry.wb];
        entry.reservedW = targets.wallboxExpectedW[entry.wb];
        entry.pvBudgetW = Math.min(entry.pvBudgetW || 0, targets.wallboxW[entry.wb]);
    }
    allocation.budgetW = targets.wallboxW.reduce((sum, watts) => sum + watts, 0);
    allocation.heaterTargetW = targets.dhwW;
    allocation.accounting = 'explicit-group-net';
    write(`${CFG.root}.Control.ParallelWallboxAllocation_JSON`, JSON.stringify(allocation));
    write(`${CFG.root}.Control.ActiveWallboxes_JSON`, JSON.stringify(
        (Array.isArray(allocation.order) ? allocation.order : []).filter(wb => [0, 1, 2].includes(wb) && targets.wallboxA[wb] > 0)));
}
