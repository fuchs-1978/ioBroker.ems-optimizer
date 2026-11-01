'use strict';

// The immutable pre-155 traces cannot contain these newly introduced states
// or private observation fields. Compare every pre-existing publication,
// command and reservation without changing any production input. Dedicated
// SoC, error-5 continuation and 15-minute plant tests assert the new states
// and changed contracts. Error-5 bookkeeping is absent from the old trace;
// every pre-existing command, reservation and diagnostic remains compared.
const newState = id => typeof id === 'string' && /^ems\.0\.(?:Vehicles\.Wallbox[012]\.(?:SoCStale|SoCAge_s|SoCReportedAt|SoCStatus)|Devices\.Wallbox[012]\.(?:Error5Resume_JSON|NoDrawPause_JSON|NoDrawPaused|NoDrawElapsed_s|NoDrawRemaining_s|NoDrawRetryAfter))$/.test(id);
const privateFields = new Set(['noDrawPauseLoaded', 'noDrawPause', 'noDrawObservation',
    'error5Resume', 'error5ResumeSourceValid', 'error5LastDrawAt', 'error5LastDrawPhases']);

function historicalStateView(value) {
    if (Array.isArray(value)) return value.filter(item => !(Array.isArray(item) && newState(item[0]))
        && !(item?.kind === 'state' && newState(item.id))).map(historicalStateView);
    if (value && Object.prototype.toString.call(value) === '[object Object]') {
        if (value.kind === 'state' && newState(value.id)) return undefined;
        return Object.fromEntries(Object.entries(value).filter(([key]) => !privateFields.has(key))
            .map(([key, item]) => [key, historicalStateView(item)]));
    }
    return value;
}
module.exports = {historicalStateView};
