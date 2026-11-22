'use strict';
const path = require('node:path');
const assert = require('node:assert/strict');
// The disposable test controller must never send diagnostic telemetry.
// @iobroker/testing also sets system.config.common.diag to 'none' before startup.
process.env.CI = 'true';
// The test controller sends its stop request as system.host.testing. Recent
// controllers accept that request only from their own configured host.
process.env.IOB_HOSTNAME = 'testing';
const {tests} = require('@iobroker/testing');

// Fresh isolated controller only. Shipped native defaults keep production
// releases and actuator mappings disabled; never connect to the real plant.
tests.integration(path.join(__dirname, '..'), {
    defineAdditionalTests({suite, it}) {
        suite('EMS shutdown', getHarness => {
            it('finishes a controller-requested stop after initialization', async function () {
                this.timeout(30000);
                const harness = getHarness();
                await harness.startAdapterAndWait(true);
                await harness.stopAdapter();
                assert.equal(harness.adapterExit, 11, 'js-controller exit code for a requested termination');
            });
        });
    }
});
