'use strict';

const nodeTimers = require('node:timers');

// Ordinary adapter work uses ioBroker-owned timers. Native fallback supports
// isolated test adapters only; durable shutdown deadlines use node:timers
// explicitly at their call sites and must not be cancelled with ordinary work.
function adapterTimers(adapter) {
    return {
        setTimeout: typeof adapter?.setTimeout === 'function' ? adapter.setTimeout.bind(adapter) : nodeTimers.setTimeout,
        clearTimeout: typeof adapter?.clearTimeout === 'function' ? adapter.clearTimeout.bind(adapter) : nodeTimers.clearTimeout
    };
}

module.exports = {adapterTimers};
