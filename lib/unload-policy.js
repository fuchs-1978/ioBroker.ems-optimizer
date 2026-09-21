'use strict';

function shouldPreserveWallboxOnUnload(config = {}, instanceObject = null,
    activeOwnedOutput = false, ownedWallboxes = []) {
    const next = instanceObject?.native;
    if (config.wallboxRestartHandoffEnabled === false || activeOwnedOutput !== true
        || instanceObject?.common?.enabled !== true || !next
        || next.wallboxRestartHandoffEnabled === false
        || config.globalWriteEnabled !== true || next.globalWriteEnabled !== true
        || config.controlEnabled === false || next.controlEnabled === false
        || !ownedWallboxes.length) return false;
    // Admin saves restart the old process with its OLD config. The freshly
    // saved native values must decide whether continuing the charge is allowed.
    // Changes to actuator mapping/topology require a confirmed stop, not a
    // persisted ownership claim for different outputs in the next process.
    return ownedWallboxes.every(wb => {
        const key = suffix => `wb${wb}${suffix}`;
        if (config[key('Present')] === false || next[key('Present')] === false
            || config[key('ControlEnabled')] !== true || next[key('ControlEnabled')] !== true
            || config[key('ProductionArmed')] !== true || next[key('ProductionArmed')] !== true)
            return false;
        return ['AmpereOutputId', 'AllowOutputId', 'AmpereFeedbackId', 'PhaseModeId',
            'ProductionPhases', 'SinglePhaseGridPhase', 'PhaseSwitchEnabled']
            .every(suffix => config[key(suffix)] === next[key(suffix)]);
    }) && (next.multiWallboxAlphaArmed === true
        || [0, 1, 2].filter(wb => next[`wb${wb}Present`] !== false
            && next[`wb${wb}ControlEnabled`] === true).length === 1);
}

module.exports = {shouldPreserveWallboxOnUnload};
