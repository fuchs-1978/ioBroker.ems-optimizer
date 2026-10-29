'use strict';
const {period} = require('./daily-summary');
const finite = n => typeof n === 'number' && Number.isFinite(n);
function admission(s) {
    if (s.system?.RealOutputsEnabled !== true || s.control?.Valid !== true || s.control?.Enabled !== true) return null;
    let headroom = 0;
    for (const w of s.wallboxes || []) {
        const b = w.increaseBudget;
        if (w.Present !== true || w.Release !== true || w.ControlEnabled !== true || w.OutputOwned !== true
            || w.ResponsePending !== false || w.OutputFault || w.PhaseTransitionActive !== false) continue;
        if (!b || b.modeled === true || b.decision !== 'target' || b.freshIncreaseBudget !== true || b.freshIncreaseResponse !== true
            || b.awaitingElectricalStep !== false || !finite(b.at) || b.at > s.ts || s.ts - b.at > 10000
            || !finite(b.nextA) || !finite(b.previousA) || b.nextA <= b.previousA
            || !finite(b.requiredW) || !finite(b.liveBudgetW) || b.requiredW > b.liveBudgetW) continue;
        if (w.measurements?.power?.valid !== true || !finite(w.actual_W) || !finite(b.hardMaximumA)
            || ![1, 3].includes(b.phases) || !finite(b.voltage)) continue;
        headroom += Math.max(0, Math.min(b.liveBudgetW, b.hardMaximumA * b.phases * b.voltage) - w.actual_W);
    }
    // A heater temperature cap alone is no admission proof: ramps, locks and
    // ownership also apply. Do not invent usable capacity from that cap.
    return headroom > 0 ? headroom : null;
}
class RegulationQuality {
    constructor() {this.last = null; this.current = null; this.previous = null;}
    sample(s) {
        const bounds = period(s.ts);
        if (!this.current || this.current.from !== bounds.from) {
            this.previous = this.current; this.current = {...bounds, coveredMs: 0, unknownMs: 0,
                importWh: 0, exportWh: 0, deviationWh: 0, exportWithAdmittedBudgetWh: 0,
                candidateAbsorbableWh: 0, classifiedMs: 0, peakDeviationW: 0, avoidableExportWh: null};
        }
        const before = this.last, c = this.current;
        if (before && s.ts > before.ts) {
            const elapsed = Math.min(s.ts, c.to) - Math.max(before.ts, c.from);
            const good = x => finite(x.power?.grid_W) && x.measurements?.gridImport?.valid === true
                && x.measurements?.gridExport?.valid === true && finite(x.control?.TargetGridPower_W);
            if (elapsed > 0 && s.ts - before.ts <= 10000 && good(before) && good(s)) {
                const w = before.power.grid_W, target = before.control.TargetGridPower_W, hours = elapsed / 3600000;
                c.coveredMs += elapsed; c.importWh += Math.max(0, w) * hours; c.exportWh += Math.max(0, -w) * hours;
                c.deviationWh += Math.abs(w - target) * hours; c.peakDeviationW = Math.max(c.peakDeviationW, Math.abs(w - target));
                const capacity = admission(before), afterCapacity = admission(s);
                if (capacity !== null && afterCapacity !== null && w < 0) {
                    c.classifiedMs += elapsed; c.exportWithAdmittedBudgetWh += -w * hours;
                    c.candidateAbsorbableWh += Math.min(-w, capacity, afterCapacity) * hours;
                }
            } else if (elapsed > 0) c.unknownMs += elapsed;
        }
        this.last = structuredClone(s);
        return {current: {...c}, previous: this.previous ? {...this.previous} : null,
            note: 'Begrenztes Leistungsintegral ab Sitzungsstart. Zugelassenes Stellbudget ist ein Kandidat, kein Beweis vermeidbarer Energie; EHZ-Kapazität ohne Ausgangsfreigaben unbekannt.'};
    }
}
module.exports = {RegulationQuality, admission};
