'use strict';

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

module.exports = {sourceSnapshot, probeSource};
