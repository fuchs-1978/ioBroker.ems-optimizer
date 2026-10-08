'use strict';

// Shared freshness for configured net-meter and house-phase measurements.
// Device responses, control heartbeats and forecast sources have independent
// contracts; this is not a general extension of every deadline.
const SMA_GRID_MAX_AGE_MS = 30000;
const WALLBOX_GRID_MAX_AGE_MS = SMA_GRID_MAX_AGE_MS;

// Deliberately copy only measurement fields, never state/user configuration.
function sourceSnapshot(state, at) {
    const finite = value => typeof value === 'number' && Number.isFinite(value) ? value : null;
    const val = typeof state?.val === 'number' && Number.isFinite(state.val) ? state.val
        : typeof state?.val === 'string' ? state.val.slice(0, 120)
            : typeof state?.val === 'boolean' ? state.val : null;
    const ts = finite(state?.ts);
    return {present: Boolean(state), val, ts, lc: finite(state?.lc),
        ack: typeof state?.ack === 'boolean' ? state.ack : null,
        q: finite(state?.q), ageMs: ts === null ? null : at - ts};
}

async function probeSource(read, now, timeoutMs = 5000) {
    const requestedAt = now();
    let timer;
    try {
        const result = await Promise.race([
            Promise.resolve().then(read).then(state => ({status: state ? 'read' : 'missing', state})),
            new Promise(resolve => {
                timer = setTimeout(() => resolve({status: 'timeout'}), timeoutMs);
                timer.unref?.();
            })
        ]);
        const completedAt = now();
        return {requestedAt, completedAt, durationMs: completedAt - requestedAt,
            status: result.status,
            snapshot: result.status === 'read' ? sourceSnapshot(result.state, completedAt) : null};
    } catch (error) {
        const completedAt = now();
        return {requestedAt, completedAt, durationMs: completedAt - requestedAt,
            status: 'error', error: String(error?.message || error).slice(0, 200), snapshot: null};
    } finally {
        clearTimeout(timer);
    }
}

module.exports = {sourceSnapshot, probeSource, SMA_GRID_MAX_AGE_MS, WALLBOX_GRID_MAX_AGE_MS};

