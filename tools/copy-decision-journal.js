'use strict';
// Explicit offline maintenance only; no ioBroker connection and no credentials.
const fs = require('node:fs/promises');
const path = require('node:path');
const {createHash} = require('node:crypto');
const Journal = require('../lib/decision-record-journal');
const hash = value => createHash('sha256').update(value).digest('hex');
const allowed = /^(?:\d{16}\.(?:json|tmp|retired|retire-tmp)|\d{16}-\d{16}\.(?:segment|segment-tmp)|health\.json|verification\.json|\.health\.tmp|\.verification\.tmp|\.ems-journal-copy-ready)$/;
const MAX_FILE = 8 * 1024 * 1024 + 8192, MAX_TOTAL = 256 * 1024 * 1024;
async function syncDirectory(directory) {const h = await fs.open(directory, 'r'); try {await h.sync();} finally {await h.close();}}
async function bounded(file) {
    const stat = await fs.lstat(file);
    if (!stat.isFile() || stat.size > MAX_FILE) throw new Error('Not a bounded regular journal file');
    const h = await fs.open(file, 'r');
    try {const data = Buffer.alloc(stat.size + 1); let count = 0;
        while (count < data.length) {const r = await h.read(data, count, data.length - count, count); if (!r.bytesRead) break; count += r.bytesRead;}
        if (count !== stat.size) throw new Error('Journal changed during offline copy');
        return {data: data.subarray(0, count), mtime: stat.mtime, size: stat.size};
    } finally {await h.close();}
}
async function copyJournal({source, destination, namespace = 'ems-optimizer.0', legacy = false, stopped = false}) {
    if (!stopped) throw new Error('Stop the adapter first; --stopped-adapter explicitly acknowledges offline maintenance');
    if (!path.isAbsolute(source || '') || !path.isAbsolute(destination || '') || source === destination
        || !/^ems-optimizer\.\d+$/.test(namespace)) throw new Error('Absolute distinct paths and exact instance are required');
    const realSource = await fs.realpath(source), parent = await fs.realpath(path.dirname(destination));
    destination = path.join(parent, path.basename(destination));
    if (destination === realSource || destination.startsWith(realSource + path.sep)) throw new Error('Destination must be outside source');
    const names = (await fs.readdir(realSource)).sort();
    if (names.length > 2 * 65536 + 512 || names.some(name => !allowed.test(name)))
        throw new Error('Unknown files or journal capacity exceeded; source retained for inspection');
    await fs.mkdir(destination, {mode: 0o700}); // Never overwrite or chmod an existing destination.
    await syncDirectory(parent);
    const snapshot = new Map(); let totalBytes = 0, exportedRecords = 0;
    const parser = new Journal({directory: realSource});
    const write = async (name, data, mtime) => {
        const file = path.join(destination, name); let h;
        try {h = await fs.open(file, 'wx', 0o600);}
        catch (error) {if (error.code !== 'EEXIST' || !(await bounded(file)).data.equals(data)) throw error; return;}
        try {await h.writeFile(data); await h.sync();} finally {await h.close();}
        await fs.utimes(file, mtime, mtime);
        // Preserve age metadata durably too, before making the copy eligible.
        h = await fs.open(file, 'r'); try {await h.sync();} finally {await h.close();}
        if (!(await bounded(file)).data.equals(data)) throw new Error('Copied bytes failed verification');
    };
    for (const name of names) {
        const original = await bounded(path.join(realSource, name)); totalBytes += original.size;
        if (totalBytes > MAX_TOTAL) throw new Error('Journal exceeds bounded copy capacity');
        snapshot.set(name, hash(original.data));
        if (name === '.ems-journal-copy-ready') continue;
        const segment = /^(\d{16})-(\d{16})\.(segment|segment-tmp)$/.exec(name);
        if (legacy && segment) {
            const records = parser._parseSegment(original.data.toString('utf8'), segment[1], segment[2]);
            for (const record of records) {
                const envelope = {schema: 1, id: record.id, recordSession: record.recordSession,
                    recordSequence: record.recordSequence, sha256: record.sha256,
                    payloadBytes: record.payloadBytes, payload: record.payload};
                await write(`${record.id}.${segment[3] === 'segment' ? 'json' : 'tmp'}`,
                    Buffer.from(JSON.stringify(envelope)), original.mtime); exportedRecords++;
            }
        } else await write(name, original.data, original.mtime);
    }
    await syncDirectory(destination);
    if (JSON.stringify((await fs.readdir(realSource)).sort()) !== JSON.stringify(names)) throw new Error('Source journal changed during copy');
    for (const [name, digest] of snapshot)
        if (hash((await bounded(path.join(realSource, name))).data) !== digest) throw new Error('Source journal changed during copy');
    // Recovery, dependency/identity/hash validation and pending SQL fences are
    // exercised on the COPY only. The original directory is never mutated.
    const check = new Journal({directory: destination}); await check.initialize();
    try {if (!check.health().integrityValid || !check.health().capacityVerified
        || [...check.groups.values()].some(group => group.missingBasis))
        throw new Error('Copied journal requires inspection; relocation marker not created');
    } finally {await check.close();}
    const ready = Buffer.from(JSON.stringify({schema: 1, namespace, kind: 'verified-offline-journal-copy'}));
    await write('.ems-journal-copy-ready', ready, new Date()); await syncDirectory(destination);
    return {filesCopied: names.length, bytesRead: totalBytes, exportedRecords, recordsRetained: check.health().records,
        pendingSqlFence: check.health().sqlVerificationPending, format: legacy ? 'legacy' : 'preserved', sourceUnchanged: true};
}
if (require.main === module) {
    const args = process.argv.slice(2), opts = {};
    for (let i = 0; i < args.length; i++) {
        if (args[i] === '--stopped-adapter') opts.stopped = true;
        else if (args[i] === '--legacy') opts.legacy = true;
        else if (['--source', '--destination', '--namespace'].includes(args[i])) opts[args[i].slice(2)] = args[++i];
        else throw new Error('Unknown journal-copy option');
    }
    copyJournal(opts).then(result => console.log(JSON.stringify(result))).catch(error => {console.error(error.message); process.exitCode = 1;});
}
module.exports = {copyJournal};
