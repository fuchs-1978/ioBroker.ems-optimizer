'use strict';
const {SMA_GRID_MAX_AGE_MS} = require('./source-diagnostics');
const {houseConnectionSettings} = require('./native-mapping');
const grid = require('./grid-constraints');

// A fresh device poll may arrive between allocator and output ticks. Only an
// explicitly witnessed own-power age rejection can bridge that recovery edge;
// arbitrary invalid/expired grants remain stop conditions.
function recoveringOwnPowerAllocation(o, d, mapping, now) {
    if (!o.parallelEnabled()) return false;
    const state = o.state(`${o.adapter.namespace}.Control.ParallelWallboxAllocation_JSON`);
    const ttl = Math.max(10000, Number(o.adapter.config.slowCycleS || 5) * 2000);
    if (!state || state.ack !== true || state.q || !(state.ts > 0)
        || state.ts > now || now - state.ts > ttl || typeof state.val !== 'string'
        || state.val.length > 50000) return false;
    try {
        const a = JSON.parse(state.val);
        return a.schema === 1 && a.valid === false && Number.isFinite(a.timestamp)
            && a.timestamp > 0 && a.timestamp <= now && now - a.timestamp <= ttl
            && Array.isArray(a.sourceDiagnostics) && a.sourceDiagnostics.length > 0
            && a.sourceDiagnostics.every(s => s.id === mapping[`DP_WB${d.wb}_POWER`]
                && s.reason === 'source-stale' && s.ack === true && !s.q
                && Number.isFinite(s.ts) && s.ts > 0 && s.ts <= a.timestamp
                && Number.isFinite(s.maximumAgeMs) && s.maximumAgeMs > 0
                && a.timestamp - s.ts > s.maximumAgeMs);
    } catch { return false; }
}

// No cached timestamps are changed. A witnessed, established session may be
// held through lost communication while independent live protection remains
// valid. Old device values are historical evidence, never fresh measurements.
function telemetryBridge(output, d, mapping, proofs, {captureOnly = false} = {}) {
    const o = output, wb = d.wb, now = o.now(), age = o.measurementMaxAgeMs();
    const base = `Devices.Wallbox${wb}`;
    const priority = JSON.stringify([o.state(mapping.DP_WB_PRIORITY)?.val,
        o.adapter.config.wallboxPriority]);
    const phase = d.confirmedPhases;
    const mode = o.phaseControlMode(d);
    const response = d.response;
    const ageRejectedAllocation = recoveringOwnPowerAllocation(o, d, mapping, now);
    // An established charger can lose communication after the current ACK,
    // before the car has electrically followed that step. Keep the exact
    // acknowledged command reserved, without declaring uptake or resetting
    // its response clock. Starts and phase changes still need full evidence.
    const awaitingUptake = ['vehicle_response', 'limited'].includes(o.own(`${base}.ResponseState`))
        && response?.start === false && !response.phaseChange
        && response.amps === d.lastA && response.ackId === d.ids.feedback
        && response.ackValue === d.lastA && Number.isFinite(response.at) && response.at > 0
        && Number.isFinite(response.ackAt) && response.ackAt > response.at
        && response.ackAt <= response.at + o.feedbackTimeoutMs(d)
        && response.ackAt <= now + 1000
        && o.state(d.ids.feedback)?.ts >= response.ackAt;
    const responseAt = awaitingUptake ? response.at : null;
    const stable = d.owned && !d.recovering && !d.pending && !d.stopRequest && !d.fault
        && d.activeSince > 0 && o.own(`${base}.OutputActive`) === true
        && (o.own(`${base}.ResponseState`) === 'confirmed' || awaitingUptake)
        && !d.phaseRequest && !d.response?.phaseChange
        && o.own(`${base}.PhaseTransitionActive`) !== true
        && [1, 3].includes(phase) && Number.isInteger(d.lastA) && d.lastA >= 6 && d.lastA <= 32
        // A telemetry-rejected allocator may publish an idle 1P fallback.
        // That is not a physical phase request; retain the witnessed topology
        // until device data and allocation recover. Real requests still stop.
        && (Number(o.own(`Control.Targets.Wallbox${wb}_Phases`)) === phase || ageRejectedAllocation);
    if (!stable || o.measurementSource || o.responseEvidence) { proofs.delete(d); return false; }
    const ids = [d.ids.error, mapping[`DP_WB${wb}_CAR`], d.ids.allow, d.ids.feedback,
        mapping[`DP_WB${wb}_POWER`], ...[1, 2, 3].map(p => mapping[`DP_WB${wb}_L${p}_A`])];
    // Infinity relaxes only age. NULL, missing values, ACK=false, bad quality,
    // future timestamps, explicit OFF/fault and changed electrical state fail.
    const values = ids.map(id => o.number(id, Infinity));
    if (ids.some(id => !(o.state(id)?.ts > 0))
        || values.some(v => v === null || v < 0) || values[0] !== 0 || ![2, 3, 4].includes(values[1])
        || values[2] !== 1 || values[3] !== d.lastA || values[4] <= 0.02
        || (phase === 1 ? values[5] <= 0.5 || values[6] > 1 || values[7] > 1
            : values.slice(5).some(v => v <= 0.5))
        || values.slice(5).some(v => v > d.lastA + 1)) { proofs.delete(d); return false; }
    if (mode !== 'fixed' && o.staticValue(d.ids.phaseMode) !== (phase === 3 ? 2 : 1)) {
        proofs.delete(d); return false;
    }
    const limit = o.gridOperatorLimit(mapping);
    const connection = o.staticValue(d.ids.connection);
    if (connection !== true && connection !== false) { proofs.delete(d); return false; }
    const fresh = ids.every(id => o.number(id, age) !== null);
    const allocatorRecovery = fresh && connection === true
        && ageRejectedAllocation;
    if (fresh && connection === true && !allocatorRecovery) {
        const previous = proofs.get(d);
        if (!o.gate(d, mapping, limit)) {
            proofs.set(d, {amps: d.lastA, phase, priority, ids: ids.join('|'), responseAt, at: now});
            if (previous?.warningAt) o.adapter.log.info?.(`Wallbox ${wb}: Kommunikation wieder aktuell; normale Regelung`);
        }
        else proofs.delete(d);
        return false;
    }
    if (captureOnly) return false;
    const proof = proofs.get(d);
    if (!proof || proof.amps !== d.lastA || proof.phase !== phase || proof.priority !== priority
        || proof.ids !== ids.join('|') || proof.responseAt !== responseAt || now < proof.at) return false;
    // Recheck every normal release/SoC/control gate. Only the stale device
    // samples and the allocator's missing-telemetry exclusion are exceptional.
    // An explicitly inactive, valid group constraint needs no own-supply
    // credit. Active or unknown group caps still require fresh group/device
    // observations and are never bypassed by this no-write continuation.
    if (o.gate(d, mapping, limit, {telemetryBridge: true, allowOffline: true, deviceMaxAgeMs: Infinity})
        || !limit.valid || (limit.groupNet && limit.active !== false)) return false;
    const voltage = o.nominalVoltage(), phaseIndex = Number(o.value(wb, 'SinglePhaseGridPhase', 1)) - 1;
    const maximum = Math.min(32, Number(o.value(wb, phase === 3 ? 'MaxCurrent3pA' : 'MaxCurrent1pA', 16)),
        Number(o.value(wb, 'CommissioningMaxA', 6)), Number(o.value(wb, 'MaxPowerW', 11000)) / (voltage * phase));
    if (!Number.isFinite(voltage) || !Number.isFinite(maximum) || d.lastA > maximum
        || ![0, 1, 2].includes(phaseIndex)) return false;
    const taper = o.own(`Vehicles.Wallbox${wb}.TaperCurrentLimit_A`);
    if (o.value(wb, 'TaperEnabled', false) && Number.isFinite(taper) && d.lastA > taper) return false;
    if (d.ids.available && (o.number(d.ids.available, Infinity) === null
        || o.number(d.ids.available, Infinity) < d.lastA)) return false;
    const imported = o.number(mapping.DP_GRID_IMPORT, SMA_GRID_MAX_AGE_MS);
    const exported = o.number(mapping.DP_GRID_EXPORT, SMA_GRID_MAX_AGE_MS);
    if (imported === null || exported === null || imported < 0 || exported < 0) return false;
    // Household import is not a protection violation. During this no-write
    // hold, fresh SMA phase limits and active operator caps below decide
    // whether continued draw is safe. Normal budget control resumes on poll.
    const directional = [1, 2, 3].some(p => mapping[`DP_HA_L${p}_IMPORT_W`] || mapping[`DP_HA_L${p}_EXPORT_W`]);
    const house = [1, 2, 3].map(p => directional
        ? grid.netImportCurrentA(o.number(mapping[`DP_HA_L${p}_IMPORT_W`], SMA_GRID_MAX_AGE_MS),
            o.number(mapping[`DP_HA_L${p}_EXPORT_W`], SMA_GRID_MAX_AGE_MS))
        : o.number(o.adapter.config[`dhwHaL${p}CurrentId`] || mapping[`DP_DHW_HA_L${p}_CURRENT_A`], SMA_GRID_MAX_AGE_MS));
    const fuse = houseConnectionSettings(o.adapter.config).fuseA;
    if (!Number.isFinite(fuse) || house.some(a => a === null || !Number.isFinite(a))) return false;
    let reservedW = Math.max(d.lastA * phase * voltage, values[4] * 1000,
        values.slice(5).reduce((sum, amps) => sum + amps, 0) * voltage,
        Number(o.own(`${base}.OutputReservedPower_W`)) || 0);
    // Reserve all possible peer and heater draw without subtracting old own
    // current from SMA. Deliberate double counting is conservative headroom.
    let peerW = 0;
    for (const peer of o.devices.filter(p => p.wb !== wb && (p.valid || p.owned))) {
        const powerId = mapping[`DP_WB${peer.wb}_POWER`];
        const freshKW = o.number(powerId, age);
        const kw = freshKW ?? o.number(powerId, Infinity);
        if (kw === null || kw < 0 || peer.pending || peer.stopRequest || peer.phaseRequest || peer.fault) return false;
        if (freshKW === null) {
            // A shared poll outage must not make established peers stop each
            // other. Retain the peer's witnessed command/reserve, not an
            // invented fresh zero. Unknown or changing sessions still block.
            const peerProof = proofs.get(peer);
            if (peer.owned) {
                if (!peerProof || peerProof.amps !== peer.lastA
                    || peerProof.phase !== peer.confirmedPhases
                    || o.number(peer.ids.allow, Infinity) !== 1
                    || o.number(peer.ids.feedback, Infinity) !== peer.lastA
                    || o.number(peer.ids.error, Infinity) !== 0) return false;
            } else if (kw > 0.02 || o.number(peer.ids.allow, Infinity) !== 0) return false;
        }
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
    if (!proof.warningAt) {
        proof.warningAt = now;
        o.adapter.log.warn?.(`Wallbox ${wb}: Kommunikation fehlt/veraltet; bestaetigte ${d.lastA} A / ${phase}P bleiben reserviert; SMA ueberwacht; keine Erhoehung oder Phasenumschaltung`);
    }
    const sourceAgeS = Math.max(...ids.map(id => Math.ceil((now - o.state(id).ts) / 1000)));
    o.publish(wb, 'OutputStatus', `TELEMETRIE-WARNUNG${allocatorRecovery ? ' (Quellen wieder aktuell; gemeinsame Zuteilung erneuern)' : ''}: ${d.lastA} A / ${phase}P gehalten; ${Math.ceil(reservedW)} W reserviert; SMA aktuell; keine Erhoehung/Phasenumschaltung; Quellenalter ${sourceAgeS} s; kein altersbedingter AUS-Auftrag`);
    return true;
}
module.exports = {telemetryBridge, recoveringOwnPowerAllocation};
