'use strict';

const nodeTimers = require('node:timers');

// Ordinary adapter work uses ioBroker-owned timers. Native fallback supports
// isolated test adapters only; durable shutdown deadlines use node:timers
// explicitly at their call sites and must not be cancelled with ordinary work.
function adapterTimers(adapter) {
    return {
        setTimeout(callback, delay, ...args) {
            return typeof adapter?.setTimeout === 'function'
                ? adapter.setTimeout(callback, delay, ...args)
                : nodeTimers.setTimeout(callback, delay, ...args);
        },
        clearTimeout(timer) {
            if (typeof adapter?.clearTimeout === 'function') adapter.clearTimeout(timer);
            else nodeTimers.clearTimeout(timer);
        }
    };
}

module.exports = {adapterTimers};
