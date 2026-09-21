'use strict';

function shouldPreserveWallboxOnUnload(config = {}, instanceObject = null,
    activeOwnedOutput = false) {
    return config.wallboxRestartHandoffEnabled !== false
        && activeOwnedOutput === true
        && instanceObject?.common?.enabled === true;
}

module.exports = {shouldPreserveWallboxOnUnload};
