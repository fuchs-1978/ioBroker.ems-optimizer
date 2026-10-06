'use strict';

/* Repository proposal only. No installation or activation by the adapter.
 * Copy/review locally before use. The example starts disabled.
 * go-e performs its own phase transition; mode ACK is not electrical proof.
 */
function createPhaseFollower(api, wallboxes, {root = 'ems-optimizer.0', timeoutMs = 20000,
    now = () => Date.now()} = {}) {
    let generation = 0;
    const pending = new Map();
    const lastCommand = new Map();
    const good = (s, maxAge = Infinity) => s && s.ack === true
        && Number(s.q ?? 0) === 0 && Number.isFinite(s.ts) && s.ts > 0
        && s.ts <= now() && now() - s.ts <= maxAge;
    const read = key => api.getState(`${root}.${key}`);
    function permitted(wb) {
        const master = read('System.RealOutputsEnabled');
        const valid = read('Control.Valid');
        const update = read('Control.LastUpdate');
        const mode = read(`Vehicles.Wallbox${wb.wb}.PhaseControlMode`);
        const connection = api.getState(wb.connection);
        return good(master) && master.val === true && good(valid) && valid.val === true
            && good(update, 10000) && Number.isFinite(update.val)
            && update.val > 0 && update.val <= now() && now() - update.val <= 10000
            && good(mode) && mode.val === 'ems' && good(connection) && connection.val === true;
    }
    function cancel() {
        generation++;
        for (const request of pending.values()) api.clearTimeout(request.timer);
        pending.clear();
    }
    function check(wb) {
        if (!permitted(wb)) { cancel(); return; }
        const target = read(`Control.Targets.Wallbox${wb.wb}_Phases`);
        if (!good(target, 10000) || ![1, 3].includes(target.val)) return;
        const mode = target.val === 3 ? 2 : 1;
        const old = pending.get(wb.wb);
        if (old) {
            if (old.mode === mode) return;
            api.clearTimeout(old.timer);
            pending.delete(wb.wb);
        }
        const feedback = api.getState(wb.mode);
        if (good(feedback) && feedback.val === mode) return; // configured position only
        if (lastCommand.has(wb.wb) && now() - lastCommand.get(wb.wb) < 60000) return;
        // Recheck permission immediately before dispatch. Master OFF cancels
        // timers/queued requests; it cannot recall a write already at go-e.
        if (!permitted(wb)) { cancel(); return; }
        const request = {mode, at: now(), generation, timer: null};
        pending.set(wb.wb, request);
        lastCommand.set(wb.wb, request.at);
        try { api.setState(wb.mode, mode, false); }
        catch (error) {
            pending.delete(wb.wb);
            api.log(`${wb.name}: Phasenbefehl nicht geschrieben: ${error.message}`, 'error');
            return;
        }
        request.timer = api.setTimeout(() => {
            if (request.generation !== generation || pending.get(wb.wb) !== request) return;
            pending.delete(wb.wb);
            if (!permitted(wb)) { cancel(); return; }
            const currentTarget = read(`Control.Targets.Wallbox${wb.wb}_Phases`);
            if (!good(currentTarget, 10000) || (currentTarget.val === 3 ? 2 : 1) !== mode) return;
            const source = api.getState(wb.mode);
            const confirmed = good(source, timeoutMs) && source.ts > request.at && source.val === mode;
            api.log(`${wb.name}: ${confirmed ? 'frische go-e-Modus-ACK' : 'Phasen-Timeout/ungueltige ACK'}; `
                + `Befehl=${request.at}, Quelle=${source?.ts ?? 'unbekannt'}; elektrische Antwort separat pruefen`,
            confirmed ? 'info' : 'error');
        }, timeoutMs);
    }
    return {check, cancel, pending};
}

if (typeof module !== 'undefined' && module.exports) module.exports = {createPhaseFollower};
else {
    const ENABLED_AFTER_LOCAL_REVIEW = false;
    if (ENABLED_AFTER_LOCAL_REVIEW) {
        const boxes = [1, 2].map(wb => ({wb, name: `Wallbox ${wb}`,
            mode: `go-e.${wb}.phaseSwitchMode`, connection: `go-e.${wb}.info.connection`}));
        const follower = createPhaseFollower({getState, setState, setTimeout, clearTimeout, log}, boxes);
        on({id: 'ems-optimizer.0.System.RealOutputsEnabled', change: 'any'}, () => follower.cancel());
        for (const box of boxes)
            on({id: `ems-optimizer.0.Control.Targets.Wallbox${box.wb}_Phases`, change: 'any'}, () => follower.check(box));
        schedule('*/5 * * * * *', () => boxes.forEach(box => follower.check(box)));
        onStop(() => follower.cancel());
    }
}
