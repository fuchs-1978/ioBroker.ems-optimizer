'use strict';

const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const {SMA_GRID_MAX_AGE_MS} = require('./source-diagnostics');

// Both production and the isolated decision preview load these exact modules.
// Bootstrap is deliberately separate: it installs live schedules and listeners.
const MODULES = Object.freeze([
    'core', 'config-mapping', 'history', 'prices', 'forecast', 'vehicles', 'dhw-controller',
    'battery-controller', 'heating-controller', 'heatpump-controller',
    'energy-coordination', 'planner', 'observer', 'realtime', 'dhw-output'
]);

function createEngineContext(namespace, mapping, sandbox, name = 'ems-observer-engine') {
    const context = vm.createContext(sandbox, {name});
    Object.defineProperty(context, 'SMA_GRID_MAX_AGE_MS', {
        value: SMA_GRID_MAX_AGE_MS, enumerable: true, writable: false, configurable: false
    });
    for (const moduleName of MODULES) {
        const filename = path.join(__dirname, 'engine', `${moduleName}.js`);
        let source = fs.readFileSync(filename, 'utf8').replaceAll('__ADAPTER_ROOT__', namespace);
        for (const token of source.match(/__[A-Z0-9_]+__/g) || []) {
            const raw = mapping[token.slice(2, -2)] ?? '';
            const escaped = String(raw).replaceAll('\\', '\\\\').replaceAll("'", "\\'");
            source = source.replaceAll(token, escaped);
        }
        new vm.Script(source, {filename}).runInContext(context, {timeout: 1000});
    }
    return context;
}

module.exports = {createEngineContext, MODULES};
