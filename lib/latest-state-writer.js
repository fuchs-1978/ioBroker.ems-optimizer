'use strict';

// Only derived display series may discard an intermediate persisted value.
// Actuators, configuration, reservations, validity and event records stay FIFO.
function isDisplaySeries(relative, ack) {
    return ack === true && /^(?:Forecast|Chart|Plan)\.[^.]+(?:_JSON|_json_chart)$/.test(relative || '');
}

// The wallbox controller uses separate command, ownership, response and
// heartbeat states. These fields only describe the result to the operator.
function isWallboxDisplayStatus(relative) {
    return /^Devices\.Wallbox[0-2]\.(?:OutputStatus|PhaseControlMode|PhaseSwitchStatus|PhaseSwitchElapsed_s|StopDelayRemaining_s|ResponseStatus|ResponseRemaining_s|AvailableCurrent_A)$/
        .test(relative || '');
}

class LatestStateWriter {
    constructor(write) {
        this.write = write;
        this.entries = new Map();
    }

    enqueue(id, state) {
        const existing = this.entries.get(id);
        if (existing) {
            existing.latest = state;
            return existing.promise;
        }
        const entry = {latest: state, promise: null};
        this.entries.set(id, entry);
        entry.promise = Promise.resolve().then(async () => {
            let firstError;
            try {
                while (entry.latest) {
                    const value = entry.latest;
                    entry.latest = null;
                    try { await this.write(id, value); }
                    catch (error) { firstError ||= error; }
                }
                if (firstError) throw firstError;
            } finally {
                this.entries.delete(id);
            }
        });
        return entry.promise;
    }
}

module.exports = {LatestStateWriter, isDisplaySeries, isWallboxDisplayStatus};
