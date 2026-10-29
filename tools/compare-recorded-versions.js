#!/usr/bin/env node
'use strict';
// Trusted local repository checkouts only. No git/network access or live adapter.
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const {createHash} = require('node:crypto');
const {execFileSync} = require('node:child_process');
const {createRequire} = require('node:module');
const {compareRecorded} = require('../lib/recorded-replay');
function engineFactory(directory) {
    const tree = fs.realpathSync(directory), requireTree = createRequire(path.join(tree, 'package.json'));
    const code = createHash('sha256');
    const files = directory => fs.readdirSync(directory, {withFileTypes: true}).sort((a, b) => a.name.localeCompare(b.name))
        .flatMap(entry => entry.isDirectory() ? files(path.join(directory, entry.name))
            : entry.isFile() && entry.name.endsWith('.js') ? [path.join(directory, entry.name)] : []);
    for (const file of files(path.join(tree, 'lib'))) {code.update(path.relative(tree, file)); code.update(fs.readFileSync(file));}
    let commit = null;
    try {commit = execFileSync('git', ['-C', tree, 'rev-parse', 'HEAD'], {encoding: 'utf8', timeout: 2000, stdio: ['ignore', 'pipe', 'ignore']}).trim();}
    catch { /* Exported checkouts still have an exact content fingerprint. */ }
    const version = {package: requireTree('./package.json').version, commit, codeSha256: code.digest('hex')};
    const {createEngineContext} = requireTree('./lib/engine-loader');
    return {version: {...version, tree}, create(input) {
        if (!/^[a-z][\w-]*\.\d+$/.test(input.namespace || '') || !input.config || !input.mapping
            || input.initialStateMode !== 'cold-start') throw new Error('Expliziter Kaltstart, Namespace, Konfiguration und Mapping erforderlich');
        let now = input.from;
        const states = new Map(input.initialStates.map(x => {
            if (typeof x.id !== 'string' || x.id.length > 512 || x.state?.ts > now) throw new Error('Ungültiger initialer State');
            return [x.id, structuredClone(x.state)];
        }));
        const root = `${input.namespace}.`, output = new Map();
        const forbidden = () => {throw new Error('Replay verbietet Geräteausgänge, SQL, Timer und Abonnements');};
        class Clock extends Date {constructor(...args) {super(...(args.length ? args : [now]));} static now() {return now;}}
        const sandbox = {Date: Clock, Math, JSON, Number, String, Boolean, Array, Object, Set, Map,
            Infinity, NaN, parseInt, parseFloat, isNaN, console: {log() {}, warn() {}, error() {}},
            nativeConfig: Object.freeze(structuredClone(input.config)),
            gridConstraints: requireTree('./lib/grid-constraints'), heatPumpTelemetryParser: requireTree('./lib/heatpump-telemetry'),
            batteryTemperatureReserve: requireTree('./lib/battery-temperature-reserve'), sunEnergyHeads: requireTree('./lib/sunenergy-heads'),
            normalizeWallboxPowerKW: requireTree('./lib/wallbox-measurement').normalizeWallboxPowerKW,
            getState: id => structuredClone(states.get(id)), getActualState: id => structuredClone(states.get(id)),
            existsState: id => states.has(id), getSourceUnit: id => input.sourceUnits?.[id] || null,
            historySourceEnabled: () => false, historyQueryAllowed: () => false, historyRetryAllowed: () => false,
            getHeaterWriteOnlyZeroStatus: () => ({status: 'unavailable'}), readHeaterWriteProof: () => null,
            readHeaterWriteStatus: () => ({status: 'unavailable'}),
            setState(id, value, ack) {
                if (!id.startsWith(root)) return forbidden();
                const state = value && typeof value === 'object' && Object.hasOwn(value, 'val')
                    ? structuredClone(value) : {val: structuredClone(value), ack: ack === true};
                states.set(id, {...state, ts: now, q: 0});
                if (/\.(Control|Vehicles|Devices)\./.test(id)) output.set(id, state.val);
            },
            createState: forbidden, writeForeignState: forbidden, updateWallboxProductionOutput: forbidden,
            sendTo: forbidden, schedule: forbidden, on: forbidden, setTimeout: forbidden, clearTimeout: forbidden, log() {}};
        const context = createEngineContext(input.namespace, input.mapping, sandbox, 'recorded-open-loop');
        return {source(id, state, at) {now = at; if (state === null) states.delete(id); else states.set(id, structuredClone(state));},
            tick(at) {
                now = at; output.clear();
                try {
                    vm.runInContext('updateVehicles(); observe(); realtimeControl();', context, {timeout: 1000});
                    return {status: 'evaluated', outputs: Object.fromEntries([...output].sort(([a], [b]) => a.localeCompare(b)))};
                } catch (error) {return {status: 'unknown', reason: error.message};}
            }};
    }};
}
function main(args = process.argv.slice(2)) {
    if (args.length === 1 && args[0] === '--help') {
        process.stdout.write('Usage: node tools/compare-recorded-versions.js manifest.json before-checkout after-checkout\nTrusted offline checkouts only; no git fetch, SQL or plant access. See docs/recorded-replay.md.\n'); return;
    }
    if (args.length !== 3) throw new Error('Manifest und zwei lokale Checkouts erforderlich');
    if (fs.statSync(args[0]).size > 32 * 1024 * 1024) throw new Error('Manifest überschreitet 32 MiB');
    const input = JSON.parse(fs.readFileSync(args[0], 'utf8'));
    process.stdout.write(`${JSON.stringify(compareRecorded(input, [engineFactory(args[1]), engineFactory(args[2])]), null, 2)}\n`);
}
if (require.main === module) {try {main();} catch (error) {process.stderr.write(`${error.message}\n`); process.exitCode = 1;}}
module.exports = {engineFactory, main};
