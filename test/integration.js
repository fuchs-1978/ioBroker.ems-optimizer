'use strict';
const path = require('node:path');
// The disposable test controller must never send diagnostic telemetry.
// @iobroker/testing also sets system.config.common.diag to 'none' before startup.
process.env.CI = 'true';
const {tests} = require('@iobroker/testing');

// Fresh isolated controller only. Shipped native defaults keep production
// releases and actuator mappings disabled; never connect to the real plant.
tests.integration(path.join(__dirname, '..'));
