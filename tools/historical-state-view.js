'use strict';

// The immutable pre-155 traces cannot contain these newly introduced states
// or private observation fields. Compare every pre-existing publication,
// command and reservation without changing any production input. Dedicated
// SoC and 15-minute plant tests assert the new states and changed contracts.
const newState = id => typeof id === 'string' && /^ems\.0\.(?:Vehicles\.Wallbox[012]\.(?:SoCStale|SoCAge_s|SoCReportedAt|SoCStatus)|Devices\.Wallbox[012]\.(?:NoDrawPause_JSON|NoDrawPaused|NoDrawElapsed_s|NoDrawRemaining_s|NoDrawRetryAfter))$/.test(id);
const privateFields = new Set(['noDrawPauseLoaded', 'noDrawPause', 'noDrawObservation']);

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
