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
