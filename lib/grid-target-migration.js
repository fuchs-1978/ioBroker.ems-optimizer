'use strict';

// One-time upgrade of the neutral target. Explicit nonzero targets and later
// deliberate returns to zero remain untouched.
function migratedGridTarget(previousVersion, configuredTarget) {
    const previous = /^0\.17\.0-alpha\.(\d+)$/.exec(String(previousVersion || ''));
    return previous && Number(previous[1]) <= 129 && configuredTarget === 0 ? 50 : null;
}

module.exports = {migratedGridTarget};
