'use strict';
const {SMA_GRID_MAX_AGE_MS} = require('./source-diagnostics');
const {houseConnectionSettings} = require('./native-mapping');
const grid = require('./grid-constraints');

// No cached timestamps are changed. This is a no-write continuation of a
// witnessed session, never a source of fresh device feedback or start proof.
const MAX_AGE_MS = 60000;
function telemetryBridge(output, d, mapping, proofs) {
    const o = output, wb = d.wb, now = o.now(), age = o.measurementMaxAgeMs();
    const base = `Devices.Wallbox${wb}`;
    const priority = JSON.stringify([o.state(mapping.DP_WB_PRIORITY)?.val,
        o.adapter.config.wallboxPriority]);
    const phase = d.confirmedPhases;
    const mode = o.phaseControlMode(d);
    const stable = d.owned && !d.recovering && !d.pending && !d.stopRequest && !d.fault
        && d.activeSince > 0 && o.own(`${base}.OutputActive`) === true
        && o.own(`${base}.ResponseState`) === 'confirmed'
        && !d.phaseRequest && !d.response?.phaseChange
        && o.own(`${base}.PhaseTransitionActive`) !== true
        && [1, 3].includes(phase) && Number.isInteger(d.lastA) && d.lastA >= 6 && d.lastA <= 32
        && Number(o.own(`Control.Targets.Wallbox${wb}_Phases`)) === phase;
    if (!stable || o.value(wb, 'TaperEnabled', false) || o.measurementSource || o.responseEvidence) { proofs.delete(d); return false; }
    const ids = [d.ids.error, mapping[`DP_WB${wb}_CAR`], d.ids.allow, d.ids.feedback,
        mapping[`DP_WB${wb}_POWER`], ...[1, 2, 3].map(p => mapping[`DP_WB${wb}_L${p}_A`])];
    const values = ids.map(id => o.number(id, MAX_AGE_MS));
    if (values.some(v => v === null || v < 0) || values[0] !== 0 || values[1] !== 2
        || values[2] !== 1 || values[3] !== d.lastA || values[4] <= 0.02
        || (phase === 1 ? values[5] <= 0.5 || values[6] > 1 || values[7] > 1
            : values.slice(5).some(v => v <= 0.5))
        || values.slice(5).some(v => v > d.lastA + 1)) { proofs.delete(d); return false; }
    if (mode !== 'fixed' && o.staticValue(d.ids.phaseMode) !== (phase === 3 ? 2 : 1)) {
        proofs.delete(d); return false;
    }
    const limit = o.gridOperatorLimit(mapping);
    const fresh = ids.every(id => o.number(id, age) !== null);
    if (fresh) {
        if (!o.gate(d, mapping, limit)) proofs.set(d, {amps: d.lastA, phase, priority, at: now});
        else proofs.delete(d);
        return false;
    }
    const proof = proofs.get(d);
    if (!proof || proof.amps !== d.lastA || proof.phase !== phase || proof.priority !== priority
        || now < proof.at || now - proof.at > MAX_AGE_MS || age >= MAX_AGE_MS) return false;
    // Recheck every normal release/SoC/control gate. Only the stale device
    // samples and the allocator's missing-telemetry exclusion are exceptional.
    if (o.gate(d, mapping, limit, {telemetryBridge: true, deviceMaxAgeMs: MAX_AGE_MS})
        || !limit.valid || limit.groupNet) return false;
    const voltage = o.nominalVoltage(), phaseIndex = Number(o.value(wb, 'SinglePhaseGridPhase', 1)) - 1;
    const maximum = Math.min(32, Number(o.value(wb, phase === 3 ? 'MaxCurrent3pA' : 'MaxCurrent1pA', 16)),
        Number(o.value(wb, 'CommissioningMaxA', 6)), Number(o.value(wb, 'MaxPowerW', 11000)) / (voltage * phase));
    if (!Number.isFinite(voltage) || !Number.isFinite(maximum) || d.lastA > maximum
        || ![0, 1, 2].includes(phaseIndex)) return false;
    if (d.ids.available && (o.number(d.ids.available, MAX_AGE_MS) === null
        || o.number(d.ids.available, MAX_AGE_MS) < d.lastA)) return false;
    const imported = o.number(mapping.DP_GRID_IMPORT, SMA_GRID_MAX_AGE_MS);
    const exported = o.number(mapping.DP_GRID_EXPORT, SMA_GRID_MAX_AGE_MS);
    if (imported === null || exported === null || imported < 0 || exported < 0) return false;
    // Optional PV charging may not turn an outage into unbounded grid use.
    const minimumSoc = Number(o.own(`Vehicles.Wallbox${wb}.MinimumSoC_pct`));
    const soc = o.vehicleSoc(wb, mapping);
    if (!(Number.isFinite(minimumSoc) && soc !== null && soc < minimumSoc)
        && imported - exported > Math.max(0, Number(o.own('Control.TargetGridPower_W')) || 0) + 100) return false;
    const directional = [1, 2, 3].some(p => mapping[`DP_HA_L${p}_IMPORT_W`] || mapping[`DP_HA_L${p}_EXPORT_W`]);
    const house = [1, 2, 3].map(p => directional
        ? grid.netImportCurrentA(o.number(mapping[`DP_HA_L${p}_IMPORT_W`], SMA_GRID_MAX_AGE_MS),
            o.number(mapping[`DP_HA_L${p}_EXPORT_W`], SMA_GRID_MAX_AGE_MS))
        : o.number(o.adapter.config[`dhwHaL${p}CurrentId`] || mapping[`DP_DHW_HA_L${p}_CURRENT_A`], SMA_GRID_MAX_AGE_MS));
    const fuse = houseConnectionSettings(o.adapter.config).fuseA;
    if (!Number.isFinite(fuse) || house.some(a => a === null || !Number.isFinite(a))) return false;
    let reservedW = Math.max(d.lastA * phase * voltage, values[4] * 1000,
        Number(o.own(`${base}.OutputReservedPower_W`)) || 0);
    // Reserve all possible peer and heater draw without subtracting old own
    // current from SMA. Deliberate double counting is conservative headroom.
    let peerW = 0;
    for (const peer of o.devices.filter(p => p.wb !== wb && (p.valid || p.owned))) {
        const kw = o.number(mapping[`DP_WB${peer.wb}_POWER`], age);
        if (kw === null || kw < 0 || peer.pending || peer.stopRequest || peer.phaseRequest) return false;
        peerW += Math.max(kw * 1000, Number(o.own(`Devices.Wallbox${peer.wb}.OutputReservedPower_W`)) || 0,
            peer.owned ? peer.lastA * Math.max(1, peer.confirmedPhases) * voltage : 0);
    }
    if (o.own('Devices.MyPV_DHW.Present') === true || o.own('Devices.MyPV_DHW.OutputOwned') === true) {
        const watts = o.dhwActualPower(mapping);
        if (!Number.isFinite(watts) || watts < 0) return false;
        peerW += Math.max(watts, Number(o.own('Devices.MyPV_DHW.OutputReservedPower_W')) || 0,
            Number(o.own('Devices.MyPV_DHW.OutputCommand_W')) || 0);
    }
    // Other coordinated actuators must expose a fresh independent reserve.
    const context = o.adapter.engineContext;
    let pending = [0, 0, 0];
    if (context?.coordinatedEnergyEnabled?.()) {
        const reservation = context.coordinatedPhaseReservations?.(`Wallbox${wb}`);
        if (!reservation?.valid || !Array.isArray(reservation.otherW) || reservation.otherW.length !== 3
            || reservation.otherW.some(w => !Number.isFinite(w) || w < 0)) return false;
        pending = reservation.otherW;
    }
    if (limit.active && ['MyPV_Heating', 'Battery'].some(name =>
        o.own(`Devices.${name}.OutputActive`) === true || o.own(`Devices.${name}.OutputOwned`) === true)) return false;
    if (limit.active && (!Number.isFinite(limit.budgetW) || reservedW + peerW > limit.budgetW)) return false;
    for (let p = 0; p < 3; p++) {
        const ownA = phase === 3 || p === phaseIndex ? Math.max(d.lastA, reservedW / (phase * voltage)) : 0;
        if (house[p] + ownA + Math.max(peerW, pending[p]) / Math.min(230, voltage) > fuse) return false;
    }
    reservedW = Math.max(reservedW, Number(o.own(`${base}.OutputReservedPower_W`)) || 0);
    o.publish(wb, 'OutputReservedPower_W', Math.ceil(reservedW));
    o.publish(wb, 'OutputStatus', `TELEMETRIE-UEBERBRUECKUNG: ${d.lastA} A / ${phase}P gehalten; SMA aktuell; keine Erhoehung; maximal 60 s Messwertalter`);
    return true;
}
module.exports = {telemetryBridge, MAX_AGE_MS};
