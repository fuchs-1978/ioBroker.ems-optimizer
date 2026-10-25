'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const {createHash} = require('node:crypto');
const DecisionRecordJournal = require('../lib/decision-record-journal');
const {DecisionRecordEncoder, decodeDecisionRecords} = require('../lib/decision-record-codec');

const payload = (sequence, session = 'session') => JSON.stringify({schema: 2, recordSession: session,
    recordSequence: sequence, timestamp: 1791560181283 + sequence,
    data: {source: {val: null, ts: 1791560181200, lc: 1791550000000, ack: false, q: 64}, label: 'Äußere Quelle'}});
const sha256 = value => createHash('sha256').update(value).digest('hex');
function checkpointChain() {
    const encoder = new DecisionRecordEncoder();
    return [1000, 2000, 3000, 31000].map((timestamp, index) => JSON.stringify(encoder.encode({schema: 2,
        recordSession: 'compact', recordSequence: index + 1, timestamp, mode: 'PRODUCTION', masterEnabled: true,
        production: {stable: 'original context '.repeat(100), measured: index,
            source: {val: null, ts: 1791560181200, lc: 1791550000000, ack: false, q: 64}}})));
}
async function directory(t) {
    const result = await fs.mkdtemp(path.join(os.tmpdir(), 'ems-record-journal-'));
    t.after(() => fs.rm(result, {recursive: true, force: true}));
    return result;
}

test('accepted records survive shutdown and restart byte-exactly with original sessions, sequences and unknown sources', async t => {
    const dir = await directory(t);
    const first = new DecisionRecordJournal({directory: dir});
    await first.initialize();
    const originals = [payload(1), payload(2), payload(1, 'restart')];
    const accepted = originals.map(record => first.append(record));
    await first.close();
    const entries = await Promise.all(accepted);
    assert.equal(first.health().pendingRecords, 0);
    const restarted = new DecisionRecordJournal({directory: dir});
    await restarted.initialize();
    const recovered = await restarted.readBatch({limit: 3});
    assert.deepEqual(recovered.map(entry => entry.payload), originals);
    assert.deepEqual(recovered.map(entry => entry.id), entries.map(entry => entry.id));
    assert.deepEqual(recovered.map(entry => [entry.recordSession, entry.recordSequence]),
        [['session', 1], ['session', 2], ['restart', 1]]);
    assert.ok(recovered.every(entry => entry.status === 'local_durable_sql_unconfirmed'));
    await restarted.close();
});

test('state publication and identical replay never delete an unconfirmed SQL record', async t => {
    const dir = await directory(t), first = new DecisionRecordJournal({directory: dir});
    await first.initialize();
    const record = payload(1), saved = await first.append(record);
    first.markPublished(saved.id);
    assert.equal(first.health().publishedRecords, 1);
    assert.equal(first.health().sqlConfirmedRecords, 0);
    const duplicate = await first.append(record);
    assert.equal(duplicate.id, saved.id);
    assert.equal(duplicate.duplicate, true);
    assert.equal(first.health().records, 1);
    await assert.rejects(first.append(record.replace('Äußere', 'Andere')), /conflicting.*identity/i);
    await first.close();
    const restarted = new DecisionRecordJournal({directory: dir});
    await restarted.initialize();
    const entries = await restarted.readBatch();
    assert.equal(entries.length, 1);
    assert.equal(entries[0].payload, record);
    assert.equal(entries[0].published, false, 'a former state ACK is no independent SQL-storage proof');
    await restarted.close();
});

test('disk and pending-memory limits reject explicitly and never evict older originals', async t => {
    const dir = await directory(t), journal = new DecisionRecordJournal({directory: dir, maxRecords: 2});
    await journal.initialize();
    await journal.append(payload(1)); await journal.append(payload(2));
    await assert.rejects(journal.append(payload(3)), /capacity/i);
    assert.equal(journal.health().rejectedRecords, 1);
    assert.deepEqual((await journal.readBatch()).map(entry => entry.payload), [payload(1), payload(2)]);
    await journal.close();
    const tiny = new DecisionRecordJournal({directory: path.join(dir, 'tiny'), maxBytes: 16});
    await tiny.initialize();
    await assert.rejects(tiny.append(payload(1)), /capacity/i);
    assert.equal(tiny.health().records, 0);
    assert.equal(tiny.health().rejectedRecords, 1);
    await tiny.close();
    const memory = new DecisionRecordJournal({directory: path.join(dir, 'memory'), maxPendingBytes: 16});
    await memory.initialize();
    await assert.rejects(memory.append(payload(1)), /pending.*capacity/i);
    assert.equal(memory.health().rejectedRecords, 1);
    await memory.close();
});

test('restart completes an intact interrupted atomic append; incomplete or corrupt data stay explicit', async t => {
    const dir = await directory(t), first = new DecisionRecordJournal({directory: dir});
    await first.initialize();
    const saved = await first.append(payload(1));
    await first.close();
    await fs.rename(path.join(dir, `${saved.id}.json`), path.join(dir, `${saved.id}.tmp`));
    await fs.writeFile(path.join(dir, '0000000000000002.tmp'), '{incomplete');
    const restarted = new DecisionRecordJournal({directory: dir});
    await restarted.initialize();
    assert.equal(restarted.health().recoveredRecords, 1);
    assert.equal(restarted.health().invalidFiles, 1);
    assert.deepEqual((await restarted.readBatch()).map(entry => entry.payload), [payload(1)]);
    assert.equal(await fs.readFile(path.join(dir, '0000000000000002.tmp'), 'utf8'), '{incomplete');
    const next = await restarted.append(payload(2));
    assert.equal(next.id, '0000000000000003', 'an incomplete ordinal is never overwritten');
    await restarted.close();
    await fs.writeFile(path.join(dir, `${saved.id}.json`), '{corrupt');
    const corrupt = new DecisionRecordJournal({directory: dir});
    await corrupt.initialize();
    assert.equal(corrupt.health().invalidFiles, 2);
    assert.equal(corrupt.health().integrityValid, false);
    assert.deepEqual((await corrupt.readBatch()).map(entry => entry.payload), [payload(2)]);
    assert.equal(await fs.readFile(path.join(dir, `${saved.id}.json`), 'utf8'), '{corrupt');
    await corrupt.close();
});

test('only exact independent history confirmation permits removal; read batches remain bounded', async t => {
    const dir = await directory(t), journal = new DecisionRecordJournal({directory: dir});
    await journal.initialize();
    const first = await journal.append(payload(1)), second = await journal.append(payload(2));
    await assert.rejects(journal.confirmStored(first.id, {kind: 'state-publication'}), /independent/i);
    await assert.rejects(journal.confirmStored(first.id, {kind: 'independent-history-match',
        recordSession: 'session', recordSequence: 1, sha256: 'wrong'}), /match/i);
    assert.equal(journal.health().records, 2);
    const initial = await journal.readBatch({limit: 1});
    assert.equal(initial.length, 1); assert.equal(initial[0].id, first.id);
    const following = await journal.readBatch({afterId: first.id, limit: 1});
    assert.equal(following.length, 1); assert.equal(following[0].id, second.id);
    await assert.rejects(journal.readBatch({maxBytes: 1}), /batch.*capacity/i);
    await journal.confirmStored(first.id, {kind: 'independent-history-match',
        recordSession: 'session', recordSequence: 1, sha256: sha256(payload(1))});
    assert.equal(journal.health().sqlConfirmedRecords, 1);
    assert.equal(journal.health().records, 1);
    assert.deepEqual((await journal.readBatch()).map(entry => entry.payload), [payload(2)]);
    await journal.close();
    await assert.rejects(journal.append(payload(3)), /closed/i);
});

test('failed durability is explicit, bounded on disk, and recoverable without claiming publication', async t => {
    const dir = await directory(t);
    let failDirectorySync = true;
    const fileSystem = {...fs, open: async (file, flags, mode) => {
        const handle = await fs.open(file, flags, mode);
        if (file !== dir || flags !== 'r') return handle;
        return {sync: async () => {
            if (failDirectorySync) {failDirectorySync = false; throw new Error('simulated directory sync failure');}
            await handle.sync();
        }, close: () => handle.close()};
    }};
    const first = new DecisionRecordJournal({directory: dir, fileSystem, maxRecords: 2});
    await first.initialize();
    await assert.rejects(first.append(payload(1)), /simulated directory sync failure/);
    assert.equal(first.health().records, 0, 'unconfirmed durability is never available for publication');
    assert.equal(first.health().writeErrors, 1);
    assert.ok(first.health().bytes > 0);
    await assert.rejects(first.append(payload(2)), /capacity/);
    await first.close();
    const restarted = new DecisionRecordJournal({directory: dir});
    await restarted.initialize();
    assert.equal(restarted.health().writeErrors, 1, 'error accounting survives restart when the disk can write again');
    assert.equal(restarted.health().rejectedRecords, 1);
    assert.equal(restarted.health().invalidFiles, 0, 'matching final/temp originals recover without conflict');
    assert.deepEqual((await restarted.readBatch()).map(entry => entry.payload), [payload(1)]);
    await restarted.close();
});

test('pre-append queue losses survive restart and an existing spool is private', async t => {
    const dir = await directory(t);
    await fs.chmod(dir, 0o777);
    const first = new DecisionRecordJournal({directory: dir});
    await first.initialize();
    assert.equal((await fs.stat(dir)).mode & 0o777, 0o700);
    first.reportLoss('bounded raw-frame queue full before append');
    first.reportLoss('bounded raw-frame byte capacity exceeded');
    await first.close();
    const restarted = new DecisionRecordJournal({directory: dir});
    await restarted.initialize();
    assert.equal(restarted.health().rejectedRecords, 2);
    assert.match(restarted.health().lastError, /byte capacity/);
    assert.equal(restarted.health().records, 0);
    await restarted.close();
});

test('a complete temporary after failed file fsync needs successful file fsync before recovery publication', async t => {
    const dir = await directory(t);
    const syncs = [], links = [];
    let failTemporarySync = true;
    const fileSystem = {...fs, open: async (file, flags, mode) => {
        const handle = await fs.open(file, flags, mode);
        if (!/\d{16}\.tmp$/.test(file)) return handle;
        return {writeFile: (...args) => handle.writeFile(...args),
            stat: () => handle.stat(), read: (...args) => handle.read(...args), sync: async () => {
            syncs.push({file, flags});
            if (failTemporarySync) throw new Error('simulated original file fsync failure');
            await handle.sync();
        }, close: () => handle.close()};
    }, link: async (...args) => {links.push(args); await fs.link(...args);}};
    const first = new DecisionRecordJournal({directory: dir, fileSystem});
    await first.initialize();
    await assert.rejects(first.append(payload(1)), /original file fsync failure/);
    assert.equal(links.length, 0, 'failed original fsync never publishes a final record');
    await first.close();
    const failedRecovery = new DecisionRecordJournal({directory: dir, fileSystem});
    await failedRecovery.initialize();
    assert.equal(failedRecovery.health().records, 0);
    assert.equal(failedRecovery.health().invalidFiles, 1);
    assert.equal(links.length, 0, 'a still failing file sync cannot be replaced by directory sync');
    await failedRecovery.close();
    failTemporarySync = false;
    const recovered = new DecisionRecordJournal({directory: dir, fileSystem});
    await recovered.initialize();
    assert.equal(syncs.at(-1).flags, 'r', 'recovery fsyncs the existing original file');
    assert.equal(links.length, 1);
    assert.equal(recovered.health().recoveredRecords, 1);
    assert.deepEqual((await recovered.readBatch()).map(entry => entry.payload), [payload(1)]);
    await recovered.close();
});

test('confirmed SQL proof remains explicit if directory durability fails after a successful cleanup unlink', async t => {
    const dir = await directory(t);
    let failDirectorySync = false;
    const fileSystem = {...fs, open: async (file, flags, mode) => {
        const handle = await fs.open(file, flags, mode);
        if (file !== dir || flags !== 'r') return handle;
        return {sync: async () => {
            if (failDirectorySync) {failDirectorySync = false; throw new Error('cleanup directory sync failed');}
            await handle.sync();
        }, close: () => handle.close()};
    }};
    const journal = new DecisionRecordJournal({directory: dir, fileSystem});
    await journal.initialize();
    const entry = await journal.append(payload(1));
    failDirectorySync = true;
    await assert.rejects(journal.confirmStored(entry.id, {kind: 'independent-history-match',
        recordSession: entry.recordSession, recordSequence: entry.recordSequence, sha256: entry.sha256}), error => {
        assert.equal(error.journalId, entry.id);
        assert.equal(error.sqlProofVerified, true);
        assert.equal(error.recordRemoved, true);
        return /cleanup directory sync failed/.test(error.message);
    });
    assert.equal(journal.health().records, 0);
    assert.equal(journal.health().sqlConfirmedRecords, 1);
    assert.equal(journal.health().writeErrors, 1);
    await journal.close();
});

test('post-initialization growth and same-length corruption cannot bypass bounded reads or integrity status', async t => {
    const dir = await directory(t);
    let recordReadCalls = 0, maximumReadLength = 0;
    const fileSystem = {...fs, open: async (file, flags, mode) => {
        const handle = await fs.open(file, flags, mode);
        if (!/\d{16}\.json$/.test(file) || flags !== 'r') return handle;
        return {stat: () => handle.stat(), read: async (...args) => {
            recordReadCalls++; maximumReadLength = Math.max(maximumReadLength, args[2]);
            return handle.read(...args);
        }, close: () => handle.close()};
    }};
    const journal = new DecisionRecordJournal({directory: dir, fileSystem});
    await journal.initialize();
    const first = await journal.append(payload(1));
    await fs.appendFile(path.join(dir, `${first.id}.json`), 'x'.repeat(1024 * 1024));
    await assert.rejects(journal.readBatch(), /unchanged bounded/);
    assert.equal(recordReadCalls, 0, 'growth is rejected from metadata before allocating/reading its content');
    assert.equal(journal.health().integrityValid, false);
    assert.equal(journal.health().invalidFiles, 1);
    await journal.close();
    const other = new DecisionRecordJournal({directory: path.join(dir, 'other'), fileSystem});
    await other.initialize();
    const second = await other.append(payload(1));
    const file = path.join(dir, 'other', `${second.id}.json`);
    const original = await fs.readFile(file, 'utf8');
    await fs.writeFile(file, original.replace('Äußere', 'Öußere'));
    await assert.rejects(other.readBatch(), /checksum/);
    assert.ok(maximumReadLength <= Buffer.byteLength(original) + 1);
    assert.equal(other.health().integrityValid, false);
    assert.equal(other.health().invalidFiles, 1);
    await other.close();
});

test('independently confirmed snapshot and deltas remain as an exact restart basis while any group member is unconfirmed', async t => {
    const dir = await directory(t), journal = new DecisionRecordJournal({directory: dir});
    await journal.initialize();
    const originals = checkpointChain().slice(0, 3);
    assert.deepEqual(originals.map(record => JSON.parse(record).frameType), ['snapshot', 'delta', 'delta']);
    const entries = [];
    for (const record of originals) entries.push(await journal.append(record));
    await journal.confirmStored(entries[0].id, {kind: 'independent-history-match',
        recordSession: entries[0].recordSession, recordSequence: entries[0].recordSequence, sha256: entries[0].sha256});
    assert.equal(journal.health().records, 3, 'SQL proof must not remove the basis of a still-local dependent delta');
    assert.equal(journal.health().confirmedRetainedRecords, 1);
    assert.equal(journal.health().unconfirmedRecords, 2);
    await journal.close();
    const restarted = new DecisionRecordJournal({directory: dir});
    await restarted.initialize();
    const replay = await restarted.readBatch({limit: 3});
    assert.deepEqual(replay.map(entry => entry.payload), originals);
    assert.ok(decodeDecisionRecords(replay.map(entry => entry.payload)).every(record => !record.reconstruction));
    assert.equal(restarted.health().confirmedRetainedRecords, 0, 'SQL proofs from an earlier process are not trusted on restart');
    await restarted.close();
});

test('a checkpoint group retires only when closed and every snapshot/delta has independent proof', async t => {
    const dir = await directory(t), journal = new DecisionRecordJournal({directory: dir});
    await journal.initialize();
    const entries = [];
    for (const record of checkpointChain()) entries.push(await journal.append(record));
    for (const entry of entries.slice(0, 2)) await journal.confirmStored(entry.id, {kind: 'independent-history-match',
        recordSession: entry.recordSession, recordSequence: entry.recordSequence, sha256: entry.sha256});
    assert.equal(journal.health().records, 4);
    assert.equal(journal.health().confirmedRetainedRecords, 2);
    assert.deepEqual((await journal.readBatch()).map(entry => entry.id), entries.slice(2).map(entry => entry.id));
    const lastDelta = entries[2];
    await journal.confirmStored(lastDelta.id, {kind: 'independent-history-match',
        recordSession: lastDelta.recordSession, recordSequence: lastDelta.recordSequence, sha256: lastDelta.sha256});
    assert.equal(journal.health().records, 1);
    assert.equal(journal.health().confirmedRetainedRecords, 0);
    assert.deepEqual((await journal.readBatch()).map(entry => entry.id), [entries[3].id]);
    await journal.confirmStored(entries[3].id, {kind: 'independent-history-match',
        recordSession: entries[3].recordSession, recordSequence: entries[3].recordSequence, sha256: entries[3].sha256});
    assert.equal(journal.health().records, 1, 'latest confirmed checkpoint remains available for future deltas');
    assert.equal(journal.health().confirmedRetainedRecords, 1);
    await journal.close();
});

test('same-process bounded retry restores an entire retained checkpoint chain before its dependent delta', async t => {
    const dir = await directory(t), journal = new DecisionRecordJournal({directory: dir});
    await journal.initialize();
    const originals = checkpointChain().slice(0, 3), entries = [];
    for (const record of originals) entries.push(await journal.append(record));
    for (const entry of entries.slice(0, 2)) await journal.confirmStored(entry.id, {kind: 'independent-history-match',
        recordSession: entry.recordSession, recordSequence: entry.recordSequence, sha256: entry.sha256});
    assert.deepEqual((await journal.readBatch()).map(entry => entry.id), [entries[2].id]);
    const prepared = await journal.prepareReplay(entries[2].id);
    assert.deepEqual(prepared.ids, entries.map(entry => entry.id));
    assert.equal(journal.health().confirmedRetainedRecords, 0);
    const replay = await journal.readBatch();
    assert.deepEqual(replay.map(entry => entry.payload), originals);
    assert.ok(decodeDecisionRecords(replay.map(entry => entry.payload)).every(record => !record.reconstruction));
    await journal.close();
});

test('cleanup failure in an older confirmed group never invalidates or double-counts an already durable new snapshot', async t => {
    const dir = await directory(t);
    let failRetirement = false;
    const fileSystem = {...fs, link: async (source, target) => {
        if (failRetirement && target.endsWith('.retired')) throw new Error('simulated prior-group retirement failure');
        return fs.link(source, target);
    }};
    const journal = new DecisionRecordJournal({directory: dir, fileSystem});
    await journal.initialize();
    const originals = checkpointChain(), entries = [];
    for (const original of originals.slice(0, 3)) entries.push(await journal.append(original));
    for (const entry of entries) await journal.confirmStored(entry.id, {kind: 'independent-history-match',
        recordSession: entry.recordSession, recordSequence: entry.recordSequence, sha256: entry.sha256});
    failRetirement = true;
    const next = await journal.append(originals[3]);
    assert.equal(next.status, 'local_durable_sql_unconfirmed');
    assert.equal(journal.health().records, 4);
    assert.equal(journal.health().invalidFiles, 0, 'a cleanup error is not corruption of the new durable original');
    const files = (await fs.readdir(dir)).filter(name => /^\d{16}\.json$/.test(name));
    const bytes = await Promise.all(files.map(async name => (await fs.stat(path.join(dir, name))).size));
    assert.equal(journal.health().bytes, bytes.reduce((sum, size) => sum + size, 0));
    assert.equal(journal.health().writeErrors, 1);
    assert.deepEqual((await journal.readBatch()).map(entry => entry.payload), [originals[3]]);
    await journal.close();
});

test('a durable outstanding SQL verification survives restart and only its observed completion clears the fence', async t => {
    const dir = await directory(t), first = new DecisionRecordJournal({directory: dir});
    await first.initialize();
    const query = {verificationId: 'query-1', start: 1000, end: 3000, limit: 32, beganAt: 5000};
    await first.beginVerification(query);
    assert.equal(first.health().sqlVerificationPending, true);
    await assert.rejects(first.beginVerification({...query, verificationId: 'overlap'}), /pending|outstanding/i);
    await first.close();
    const restarted = new DecisionRecordJournal({directory: dir});
    await restarted.initialize();
    assert.equal(restarted.health().sqlVerificationPending, true, 'process shutdown is no proof of backend completion');
    assert.deepEqual(restarted.health().sqlVerificationQuery, query);
    await assert.rejects(restarted.completeVerification({kind: 'timeout', verificationId: query.verificationId}), /observed/i);
    await assert.rejects(restarted.completeVerification({kind: 'observed-backend-completion',
        verificationId: 'different', evidence: 'callback'}), /match/i);
    await restarted.completeVerification({kind: 'observed-backend-completion',
        verificationId: query.verificationId, evidence: 'actual SQL callback returned'});
    assert.equal(restarted.health().sqlVerificationPending, false);
    await restarted.close();
    const cleared = new DecisionRecordJournal({directory: dir});
    await cleared.initialize();
    assert.equal(cleared.health().sqlVerificationPending, false);
    await cleared.close();
});

test('a failed fence clear cannot authorize another SQL request after restart', async t => {
    const dir = await directory(t);
    let failClearRename = false;
    const fileSystem = {...fs, rename: async (source, target) => {
        if (failClearRename && target.endsWith('verification.json')) throw new Error('fence clear rename failed');
        return fs.rename(source, target);
    }};
    const first = new DecisionRecordJournal({directory: dir, fileSystem});
    await first.initialize();
    const query = {verificationId: 'query-2', start: 2000, end: 4000, limit: 32, beganAt: 6000};
    await first.beginVerification(query);
    failClearRename = true;
    await assert.rejects(first.completeVerification({kind: 'observed-backend-completion',
        verificationId: query.verificationId, evidence: 'actual callback'}), /fence clear rename failed/);
    assert.equal(first.health().sqlVerificationPending, true);
    await first.close();
    const restarted = new DecisionRecordJournal({directory: dir});
    await restarted.initialize();
    assert.equal(restarted.health().sqlVerificationPending, true);
    await assert.rejects(restarted.beginVerification({...query, verificationId: 'unsafe-retry'}), /pending|outstanding/i);
    await restarted.close();
});

test('schema-3 records with invalid checkpoint identities cannot become replayable journal groups', async t => {
    const dir = await directory(t), journal = new DecisionRecordJournal({directory: dir});
    await journal.initialize();
    const originals = checkpointChain(), snapshot = JSON.parse(originals[0]), delta = JSON.parse(originals[1]);
    await assert.rejects(journal.append(JSON.stringify({...snapshot, checkpointSequence: 99})), /checkpoint/i);
    await assert.rejects(journal.append(JSON.stringify({...snapshot, checkpointSequence: undefined})), /checkpoint/i);
    await assert.rejects(journal.append(JSON.stringify({...delta, baseSequence: 99})), /checkpoint/i);
    assert.equal(journal.health().records, 0);
    assert.equal(journal.health().rejectedRecords, 3);
    await journal.close();
});

test('a committed whole-group retirement finishes after a crash without replaying an orphan delta suffix', async t => {
    const dir = await directory(t);
    let failSecondUnlink = false, removedOriginals = 0;
    const fileSystem = {...fs, unlink: async file => {
        if (failSecondUnlink && /^\d{16}\.json$/.test(path.basename(file)) && ++removedOriginals === 2)
            throw new Error('crash during committed group removal');
        return fs.unlink(file);
    }};
    const first = new DecisionRecordJournal({directory: dir, fileSystem});
    await first.initialize();
    const originals = checkpointChain(), entries = [];
    for (const original of originals) entries.push(await first.append(original));
    for (const entry of entries.slice(0, 2)) await first.confirmStored(entry.id, {kind: 'independent-history-match',
        recordSession: entry.recordSession, recordSequence: entry.recordSequence, sha256: entry.sha256});
    failSecondUnlink = true;
    const lastDelta = entries[2];
    await assert.rejects(first.confirmStored(lastDelta.id, {kind: 'independent-history-match',
        recordSession: lastDelta.recordSession, recordSequence: lastDelta.recordSequence, sha256: lastDelta.sha256}),
    /crash during committed group removal/);
    assert.ok((await fs.readdir(dir)).some(name => name.endsWith('.retired')));
    await first.close();
    let failRecoveryUnlink = true;
    const recoveryFileSystem = {...fs, unlink: async file => {
        if (failRecoveryUnlink && /^\d{16}\.json$/.test(path.basename(file))) {
            failRecoveryUnlink = false; throw new Error('recovery group unlink failed');
        }
        return fs.unlink(file);
    }};
    const interruptedRecovery = new DecisionRecordJournal({directory: dir, fileSystem: recoveryFileSystem});
    await interruptedRecovery.initialize();
    assert.equal(interruptedRecovery.health().integrityValid, false);
    assert.ok((await fs.readdir(dir)).some(name => name.endsWith('.retired')),
        'failed cleanup must retain the committed marker for another recovery');
    await interruptedRecovery.close();
    const restarted = new DecisionRecordJournal({directory: dir});
    await restarted.initialize();
    assert.equal(restarted.health().integrityValid, true);
    assert.equal(restarted.health().records, 1);
    const replay = await restarted.readBatch();
    assert.deepEqual(replay.map(entry => entry.payload), [originals[3]]);
    assert.ok(decodeDecisionRecords(replay.map(entry => entry.payload)).every(record => !record.reconstruction));
    assert.equal((await fs.readdir(dir)).some(name => name.endsWith('.retired')), false);
    await restarted.close();
});

test('a shutdown before any SQL call can durably cancel only the matching locally unissued intent', async t => {
    const dir = await directory(t), first = new DecisionRecordJournal({directory: dir});
    await first.initialize();
    const query = {verificationId: 'not-issued', start: 1000, end: 3000, limit: 32, beganAt: 5000};
    await first.beginVerification(query);
    await assert.rejects(first.cancelUnissuedVerification({kind: 'timeout', verificationId: query.verificationId,
        evidence: 'deadline'}), /never.issued/i);
    await first.cancelUnissuedVerification({kind: 'locally-never-issued', verificationId: query.verificationId,
        evidence: 'stop was observed before invoking the SQL transport'});
    assert.equal(first.health().sqlVerificationPending, false);
    await first.close();
    const restarted = new DecisionRecordJournal({directory: dir});
    await restarted.initialize();
    assert.equal(restarted.health().sqlVerificationPending, false);
    await restarted.close();
});

test('unreadable or conflicting verification metadata remains a restart blocker, not an idle-backend assertion', async t => {
    const dir = await directory(t), first = new DecisionRecordJournal({directory: dir});
    await first.initialize();
    const query = {verificationId: 'known', start: 1000, end: 3000, limit: 32, beganAt: 5000};
    await first.beginVerification(query); await first.close();
    await fs.writeFile(path.join(dir, '.verification.tmp'), '{incomplete');
    const restarted = new DecisionRecordJournal({directory: dir});
    await restarted.initialize();
    assert.equal(restarted.health().sqlVerificationPending, true);
    assert.equal(restarted.health().sqlVerificationUnknown, true);
    await assert.rejects(restarted.beginVerification({...query, verificationId: 'unsafe'}), /pending/i);
    await assert.rejects(restarted.completeVerification({kind: 'observed-backend-completion',
        verificationId: query.verificationId, evidence: 'known callback'}), /match/i);
    await restarted.close();
});



test('batched backpressure losses survive restart without inventing stored records', async t => {
    const dir = await directory(t), first = new DecisionRecordJournal({directory: dir});
    await first.initialize(); first.reportLoss('capacity pause', 500); await first.close();
    const next = new DecisionRecordJournal({directory: dir}); await next.initialize();
    assert.equal(next.health().rejectedRecords, 500);
    assert.equal(next.health().records, 0);
    assert.throws(() => next.reportLoss('bad count', 0), /positive/);
    await next.close();
});

test('historical queue-loss episodes coalesce only adjacent identities, bound overflow and persist without an original', async t => {
    const dir = await directory(t);
    let now = 100000;
    const journal = new DecisionRecordJournal({directory: dir, now: () => now});
    await journal.initialize();
    const episodeBytes = [];
    function loss(episode, offset) {
        const rawBytes = (offset + 1) * 1000 + episode;
        const diagnostic = {kind: 'recorder-queue-full', recordSession: `session-${episode % 2}`,
            recordSequence: episode * 10 + offset + 1, eventAt: now - 20, observedAt: now,
            rawBytes, limitsHit: {records: offset === 0, bytes: offset === 1},
            queue: {records: 128, bytes: 7000000, maxRecords: 128, maxBytes: 8 * 1024 * 1024,
                oldestQueuedAt: now - 1000, oldestWaitMs: 1000,
                active: {queuedAt: now - 1000, startedAt: now - 900, waitMs: 100,
                    records: 16, rawBytes: 240000, firstSequence: 1, lastSequence: 16}},
            // A caller cannot smuggle another private full frame into health.
            rawFrame: {privateValue: 'must not appear in diagnostics'}};
        journal.reportLoss('recorder queue full', 1, diagnostic);
        now += 10;
        return rawBytes;
    }
    for (let episode = 0; episode < 6; episode++) episodeBytes.push(loss(episode, 0) + loss(episode, 1));
    const history = journal.health().lossEpisodes;
    assert.equal(history.schema, 1);
    assert.equal(history.maxEpisodes, 4);
    assert.equal(history.episodes.length, 4);
    assert.equal(history.evictedEpisodes, 2);
    assert.equal(history.evictedRecords, 4);
    assert.equal(history.evictedRawBytes, episodeBytes[0] + episodeBytes[1]);
    assert.equal(journal.health().rejectedRecords, 12);
    assert.equal(journal.health().records, 0, 'diagnostic loss persistence never invents a stored original');
    for (let index = 0; index < 4; index++) {
        const episodeIndex = index + 2;
        const episode = history.episodes[index];
        assert.equal(episode.recordSession, `session-${episodeIndex % 2}`);
        assert.equal(episode.firstSequence, episodeIndex * 10 + 1);
        assert.equal(episode.lastSequence, episodeIndex * 10 + 2);
        assert.equal(episode.rejectedRecords, 2);
        assert.equal(episode.rejectedRawBytes, episodeBytes[episodeIndex]);
        assert.deepEqual(episode.limitsHit, {records: true, bytes: true});
        assert.equal(episode.firstEventAt, 100000 + episodeIndex * 20 - 20);
        assert.equal(episode.lastEventAt, 100000 + episodeIndex * 20 - 10);
        assert.equal(episode.firstObservedAt, 100000 + episodeIndex * 20);
        assert.equal(episode.lastObservedAt, 100000 + episodeIndex * 20 + 10);
    }
    assert.equal(JSON.stringify(history).includes('privateValue'), false);
    const expected = structuredClone(history);
    history.episodes[0].firstContext.queue.records = 9999;
    history.episodes.pop();
    assert.deepEqual(journal.health().lossEpisodes, expected, 'health callers cannot mutate retained episode evidence');
    await journal.close();
    const restarted = new DecisionRecordJournal({directory: dir, now: () => now});
    await restarted.initialize();
    assert.deepEqual(restarted.health().lossEpisodes, expected);
    assert.equal(restarted.health().rejectedRecords, 12);
    assert.deepEqual(await restarted.readBatch(), []);
    await restarted.close();
});

test('escaped error text and maximum-width episode metadata stay within the health reader byte bound', async t => {
    const dir = await directory(t), widest = Number.MAX_SAFE_INTEGER;
    const journal = new DecisionRecordJournal({directory: dir, now: () => widest});
    await journal.initialize();
    const maximum = keys => Object.fromEntries(keys.map(key => [key, widest]));
    journal.lastAppendBatch = maximum(['records', 'bytes', 'elapsedMs', 'parallelFiles',
        'queuedAt', 'startedAt', 'completedAt', 'waitMs', 'appendMs']);
    for (let index = 0; index < 4; index++) journal.reportLoss('\u0000'.repeat(1000), 1, {
        kind: 'recorder-queue-full', recordSession: 'A'.repeat(79) + index,
        recordSequence: index + 1, eventAt: widest, observedAt: widest, rawBytes: 100000 + index,
        limitsHit: {records: true, bytes: true},
        queue: {...maximum(['records', 'bytes', 'maxRecords', 'maxBytes', 'oldestQueuedAt', 'oldestWaitMs']),
            active: maximum(['queuedAt', 'startedAt', 'waitMs', 'elapsedMs', 'records', 'rawBytes',
                'firstSequence', 'lastSequence'])}
    });
    await journal.tail;
    const counterKeys = ['rejectedRecords', 'writeErrors', 'readErrors', 'sqlConfirmedRecords',
        'expiredRecords', 'expiredUnconfirmedRecords'];
    for (const key of counterKeys) journal[key] = widest;
    const lastExpiry = {at: widest, reason: 'local-retention-expired-sql-coverage-unknown',
        recordSession: 'A'.repeat(80), ...maximum(['firstSequence', 'lastSequence', 'firstEventAt', 'lastEventAt',
            'oldestRetainedAt', 'newestRetainedAt', 'records', 'unconfirmedRecords'])};
    journal.lastExpiry = lastExpiry;
    await journal.close();
    const expected = journal.health().lossEpisodes;
    const healthBytes = await fs.readFile(path.join(dir, 'health.json'));
    assert.ok(healthBytes.length <= 8192, 'the writer accounts for JSON escaping before the bounded reader does');
    const persisted = JSON.parse(healthBytes.toString('utf8'));
    for (const key of counterKeys) assert.equal(persisted[key], widest);
    assert.deepEqual(persisted.lastExpiry, lastExpiry);
    assert.equal(expected.episodes.length + expected.evictedEpisodes, 4);
    assert.equal(expected.episodes.reduce((sum, episode) => sum + episode.rejectedRecords, expected.evictedRecords), 4);
    assert.equal(expected.episodes.reduce((sum, episode) => sum + episode.rejectedRawBytes, expected.evictedRawBytes), 400006);
    assert.deepEqual(persisted.lossEpisodes, expected);
    const restarted = new DecisionRecordJournal({directory: dir, now: () => widest});
    await restarted.initialize();
    for (const key of counterKeys) assert.equal(restarted.health()[key], widest);
    assert.deepEqual(restarted.health().lastExpiry, lastExpiry);
    assert.deepEqual(restarted.health().lossEpisodes, expected,
        'bounded health can be read after restart with counters and any evictions intact');
    await restarted.close();
});

test('an older valid health temporary never rolls back newer loss episodes across sessions', async t => {
    const dir = await directory(t), journal = new DecisionRecordJournal({directory: dir});
    await journal.initialize();
    const diagnostic = recordSession => ({kind: 'recorder-queue-full', recordSession, recordSequence: 1,
        eventAt: 1000, observedAt: 1000, rawBytes: 10000, limitsHit: {records: true, bytes: false},
        queue: {records: 128, bytes: 1000000, maxRecords: 128, maxBytes: 8 * 1024 * 1024,
            oldestQueuedAt: 900, oldestWaitMs: 100, active: null}});
    journal.reportLoss('queue full', 1, diagnostic('old-session'));
    await journal.tail;
    const older = await fs.readFile(path.join(dir, 'health.json'));
    journal.reportLoss('queue full', 1, diagnostic('new-session'));
    await journal.close();
    const latest = journal.health().lossEpisodes;
    assert.equal(latest.episodes.length, 2);
    await fs.writeFile(path.join(dir, '.health.tmp'), older);
    const restarted = new DecisionRecordJournal({directory: dir});
    await restarted.initialize();
    assert.equal(restarted.health().rejectedRecords, 2);
    assert.equal(restarted.health().readErrors, 0, 'a valid stale temporary is not corruption');
    assert.deepEqual(restarted.health().lossEpisodes, latest,
        'recovery preserves the newer completed health evidence despite a valid older temporary');
    await restarted.close();
});

const batchProofs = entries => entries.map(e => ({id: e.id, proof: {kind: 'independent-history-match',
    recordSession: e.recordSession, recordSequence: e.recordSequence, sha256: e.sha256}}));

test('a whole exact batch retires a closed checkpoint group with one health persistence', async t => {
    const journal = new DecisionRecordJournal({directory: await directory(t)});
    await journal.initialize();
    const entries = [];
    for (const value of checkpointChain()) entries.push(await journal.append(value));
    let healthWrites = 0;
    const persist = journal._persistHealth.bind(journal);
    journal._persistHealth = (...args) => {healthWrites++; return persist(...args);};
    const result = await journal.confirmStoredBatch(batchProofs(entries.slice(0, 3)));
    assert.deepEqual(result.confirmedIds, entries.slice(0, 3).map(e => e.id));
    assert.equal(result.cleanupError, ''); assert.equal(healthWrites, 1);
    assert.equal(journal.health().records, 1);
    assert.equal(journal.health().sqlConfirmedRecords, 3);
    assert.equal(journal.health().expiredRecords, 0);
    await journal.close();
});

test('bad final proof or duplicate batch identity cannot confirm a valid prefix', async t => {
    const journal = new DecisionRecordJournal({directory: await directory(t)});
    await journal.initialize();
    const entries = [await journal.append(payload(1)), await journal.append(payload(2))];
    const proofs = batchProofs(entries); proofs[1].proof.sha256 = 'wrong';
    await assert.rejects(journal.confirmStoredBatch(proofs), /identity\/hash/);
    await assert.rejects(journal.confirmStoredBatch([batchProofs(entries)[0], batchProofs(entries)[0]]), /bounded/);
    assert.equal(journal.health().sqlConfirmedRecords, 0);
    assert.equal(journal.health().records, 2);
    assert.equal((await journal.readBatch()).length, 2);
    await journal.close();
});

test('batch cleanup failure keeps a durable retirement fence and recovers only the proved closed group', async t => {
    const dir = await directory(t);
    let fail = false;
    const fileSystem = {...fs, unlink: async file => {
        if (fail && String(file).endsWith('.json') && !String(file).endsWith('health.json')) {
            fail = false; throw new Error('controlled cleanup interruption');
        }
        return fs.unlink(file);
    }};
    const journal = new DecisionRecordJournal({directory: dir, fileSystem}); await journal.initialize();
    const entries = [];
    for (const value of checkpointChain()) entries.push(await journal.append(value));
    fail = true;
    const result = await journal.confirmStoredBatch(batchProofs(entries.slice(0, 3)));
    assert.match(result.cleanupError, /controlled cleanup/);
    assert.equal(journal.health().capacityVerified, false);
    assert.equal(journal.health().sqlConfirmedRecords, 3);
    await journal.close();
    const restarted = new DecisionRecordJournal({directory: dir}); await restarted.initialize();
    const remaining = await restarted.readBatch();
    assert.equal(remaining.length, 1);
    assert.equal(remaining[0].id, entries[3].id, 'unconfirmed next snapshot survives intact');
    assert.equal(restarted.health().expiredRecords, 0);
    await restarted.close();
});

test('group commit shares directory barriers, bounds file concurrency and survives restart exactly', async t => {
    const dir = await directory(t), journal = new DecisionRecordJournal({directory: dir});
    await journal.initialize();
    let barriers = 0, active = 0, highWater = 0;
    const sync = journal._syncDirectory.bind(journal), write = journal._writeFile.bind(journal);
    journal._syncDirectory = async () => { barriers++; await sync(); };
    journal._writeFile = async (...args) => {
        highWater = Math.max(highWater, ++active);
        try { await new Promise(resolve => setImmediate(resolve)); return await write(...args); }
        finally { active--; }
    };
    const originals = Array.from({length: 16}, (_, index) => payload(index + 1));
    const saved = await journal.appendBatch(originals);
    assert.equal(barriers, 2);
    assert.equal(highWater, 4);
    assert.equal(journal.health().pendingRecords, 0);
    assert.equal(journal.health().lastAppendBatch.records, 16);
    assert.deepEqual((await journal.readBatch()).map(entry => entry.payload), originals);
    assert.equal(journal.health().sqlConfirmedRecords, 0);
    await journal.close();
    const restarted = new DecisionRecordJournal({directory: dir});
    await restarted.initialize();
    assert.deepEqual((await restarted.readBatch()).map(entry => entry.id), saved.map(entry => entry.id));
    assert.deepEqual((await restarted.readBatch()).map(entry => entry.payload), originals);
    await restarted.close();
});

test('append batch timing excludes an independent stalled immutable read', async t => {
    let now = 1000, enteredRead, releaseRead, enteredAppend, releaseAppend;
    const reading = new Promise(resolve => {enteredRead = resolve;});
    const readGate = new Promise(resolve => {releaseRead = resolve;});
    const appending = new Promise(resolve => {enteredAppend = resolve;});
    const appendGate = new Promise(resolve => {releaseAppend = resolve;});
    const journal = new DecisionRecordJournal({directory: await directory(t), now: () => now});
    t.after(async () => {releaseRead(); releaseAppend(); await journal.close();});
    await journal.initialize();
    await journal.append(payload(1));
    const read = journal._readBoundedFile.bind(journal), write = journal._writeFile.bind(journal);
    journal._readBoundedFile = async (...args) => {enteredRead(); await readGate; return read(...args);};
    journal._writeFile = async (...args) => {
        if (/\d{16}\.tmp$/.test(args[0])) {enteredAppend(); await appendGate;}
        return write(...args);
    };
    const localRead = journal.readBatch({limit: 1});
    await reading;
    now += 200;
    const originals = [payload(2), payload(3)];
    const writing = journal.appendBatch(originals);
    await appending;
    assert.equal(journal.health().activeRead.records, 1);
    now += 300;
    assert.equal(journal.health().activeOperation.kind, 'append-batch');
    assert.equal(journal.health().activeOperation.waitMs, 0);
    assert.equal(journal.health().records, 1, 'the running append is not yet a durable original');
    now += 700;
    releaseAppend();
    await writing;
    releaseRead();
    await localRead;
    assert.deepEqual(journal.health().lastAppendBatch, {records: 2,
        bytes: originals.reduce((sum, original) => sum + Buffer.byteLength(original), 0),
        elapsedMs: 1000, parallelFiles: 4, queuedAt: 1200, startedAt: 1200,
        completedAt: 2200, waitMs: 0, appendMs: 1000});
    assert.deepEqual((await journal.readBatch()).map(entry => entry.payload), [payload(1), ...originals]);
    await journal.close();
});

test('failed group commit waits for all writers and publishes no apparently good prefix', async t => {
    const dir = await directory(t), journal = new DecisionRecordJournal({directory: dir});
    await journal.initialize();
    const write = journal._writeFile.bind(journal);
    let completed = 0;
    journal._writeFile = async (file, content) => {
        if (file.endsWith('0000000000000002.tmp')) throw new Error('injected disk error');
        await new Promise(resolve => setImmediate(resolve));
        await write(file, content); completed++;
    };
    await assert.rejects(journal.appendBatch(checkpointChain()), /injected disk error/);
    assert.equal(completed, 3);
    assert.equal(journal.health().records, 0);
    assert.equal(journal.health().pendingRecords, 0);
    assert.equal(journal.health().capacityVerified, false);
    assert.deepEqual(await journal.readBatch(), []);
    await assert.rejects(journal.append(payload(100)), /capacity is unknown/);
    await journal.close();
    const restarted = new DecisionRecordJournal({directory: dir});
    await restarted.initialize();
    // Recovery must detect the missing predecessor; no silent repair or SQL proof.
    assert.equal(restarted.health().sqlConfirmedRecords, 0);
    const recovered = decodeDecisionRecords((await restarted.readBatch()).map(entry => entry.payload));
    assert.ok(recovered.some(record => record.reconstruction?.valid === false));
    await restarted.close();
});

test('parallel reads retain order and bounds and reject the whole result on corruption', async t => {
    const dir = await directory(t), journal = new DecisionRecordJournal({directory: dir});
    await journal.initialize();
    const originals = Array.from({length: 8}, (_, index) => payload(index + 1));
    const saved = await journal.appendBatch(originals);
    const read = journal._readBoundedFile.bind(journal);
    let active = 0, highWater = 0;
    journal._readBoundedFile = async (...args) => {
        highWater = Math.max(highWater, ++active);
        try { await new Promise(resolve => setImmediate(resolve)); return await read(...args); }
        finally { active--; }
    };
    assert.deepEqual((await journal.readBatch({limit: 8})).map(entry => entry.payload), originals);
    assert.equal(highWater, 4);
    assert.equal((await journal.readBatch({limit: 8, maxBytes: Buffer.byteLength(originals[0])})).length, 1);
    const file = path.join(dir, `${saved[5].id}.json`);
    const content = await fs.readFile(file, 'utf8');
    await fs.writeFile(file, content.replace('Äußere', 'Andere'));
    await assert.rejects(journal.readBatch({limit: 8}), /hash|changed|checksum|mismatch/i);
    assert.equal(active, 0);
    assert.equal(journal.health().sqlConfirmedRecords, 0);
    assert.ok(journal.health().readErrors > 0);
    await journal.close();
});

test('group rejection keeps existing capacity limits and counts every refused original', async t => {
    const journal = new DecisionRecordJournal({directory: await directory(t), maxRecords: 2});
    await journal.initialize();
    await assert.rejects(journal.appendBatch([payload(1), payload(2), payload(3)]), /disk\/record capacity/);
    assert.equal(journal.health().records, 0);
    assert.equal(journal.health().rejectedRecords, 3);
    assert.equal(journal.health().pendingRecords, 0);
    await journal.appendBatch([payload(4), payload(5)]);
    assert.equal(journal.health().records, 2);
    await journal.close();
});

test('no batch original becomes visible before the final durability barrier', async t => {
    const journal = new DecisionRecordJournal({directory: await directory(t)});
    await journal.initialize();
    const sync = journal._syncDirectory.bind(journal);
    let entered, release, count = 0;
    const atBarrier = new Promise(resolve => { entered = resolve; });
    const gate = new Promise(resolve => { release = resolve; });
    journal._syncDirectory = async () => {
        if (++count === 2) { entered(); await gate; }
        await sync();
    };
    const writing = journal.appendBatch(checkpointChain());
    await atBarrier;
    assert.equal(journal.health().records, 0);
    assert.equal(journal.health().pendingRecords, 4);
    release();
    await writing;
    const records = decodeDecisionRecords((await journal.readBatch()).map(entry => entry.payload));
    assert.equal(records.length, 4);
    assert.ok(records.every(record => !record.reconstruction));
    assert.equal(journal.health().sqlConfirmedRecords, 0);
    await journal.close();
});

test('completed journal shutdown keeps late rejection diagnostics in memory without filesystem work', async t => {
    const dir = await directory(t), calls = [];
    let closed = false;
    const fileSystem = {...fs};
    for (const method of ['open', 'rename', 'unlink']) fileSystem[method] = async (...args) => {
        if (closed) calls.push({method, file: path.basename(args[0])});
        return fs[method](...args);
    };
    const journal = new DecisionRecordJournal({directory: dir, fileSystem});
    const settleHealth = async () => {
        let previous;
        do {previous = journal.tail; await previous;} while (previous !== journal.tail);
    };
    await journal.initialize();
    journal.reportLoss('loss before shutdown', 2);
    await journal.close();
    assert.equal(JSON.parse(await fs.readFile(path.join(dir, 'health.json'), 'utf8')).rejectedRecords, 2);
    closed = true;
    await assert.rejects(journal.append(payload(1)), /closed/i);
    await assert.rejects(journal.appendBatch([payload(2)]), /closed/i);
    journal.reportLoss('late callback after shutdown');
    await settleHealth();
    await fs.rm(dir, {recursive: true, force: true});
    journal.reportLoss('late callback after directory removal');
    await settleHealth();
    assert.equal(journal.health().rejectedRecords, 6, 'late losses remain explicit in memory');
    assert.deepEqual(calls, [], 'completed shutdown cannot enqueue another health checkpoint');
});

test('journal shutdown persists losses from work accepted before its close barrier', async t => {
    const dir = await directory(t), journal = new DecisionRecordJournal({directory: dir, maxRecords: 1});
    await journal.initialize();
    const accepted = journal.append(payload(1));
    const refused = assert.rejects(journal.appendBatch([payload(2), payload(3)]), /disk\/record capacity/);
    await journal.close();
    await accepted; await refused;
    const restarted = new DecisionRecordJournal({directory: dir, maxRecords: 1});
    await restarted.initialize();
    assert.equal(restarted.health().rejectedRecords, 2, 'the final close checkpoint includes queued rejection losses');
    assert.deepEqual((await restarted.readBatch()).map(entry => entry.payload), [payload(1)]);
    await restarted.close();
});
