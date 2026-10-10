'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');
const {createHash} = require('node:crypto');

const FILE = /^(\d{16})\.(json|tmp)$/;
const RETIRED = /^(\d{16})\.retired$/;
const COUNTERS = ['rejectedRecords', 'writeErrors', 'readErrors', 'sqlConfirmedRecords'];
const digest = value => createHash('sha256').update(value).digest('hex');
const identity = record => JSON.stringify([record.recordSession, record.recordSequence]);
const integer = (value, name) => {
    if (!Number.isSafeInteger(value) || value < 1) throw new Error(`${name} must be a positive safe integer`);
    return value;
};

/** A bounded local durability journal, NOT an acknowledgement of SQL storage.
 * Records are immutable. Publication never deletes one; only an independently
 * verified exact history match can do so. Compact checkpoint chains retire as
 * whole closed groups after every member is verified; the latest basis stays.
 * The caller controls bounded replay. SQL queries carry a durable outstanding
 * fence so an unknown backend completion cannot disappear on restart.
 * Accepted appends are serialized and close() drains them. A finite/full or
 * unavailable disk rejects explicitly; it cannot promise infinite retention.
 */
class DecisionRecordJournal {
    constructor({directory, maxBytes = 128 * 1024 * 1024, maxRecords = 65536,
        maxPendingRecords = 128, maxPendingBytes = 8 * 1024 * 1024,
        maxRecordBytes = 4 * 1024 * 1024, fileSystem = fs} = {}) {
        if (typeof directory !== 'string' || !path.isAbsolute(directory))
            throw new Error('journal directory must be an absolute instance-data path');
        for (const [name, value] of Object.entries({maxBytes, maxRecords, maxPendingRecords, maxPendingBytes, maxRecordBytes}))
            integer(value, name);
        Object.assign(this, {directory, maxBytes, maxRecords, maxPendingRecords, maxPendingBytes, maxRecordBytes});
        this.fs = fileSystem;
        this.entries = new Map(); this.identities = new Map();
        this.groups = new Map(); this.currentGroupId = null;
        this.confirmedRetainedRecords = 0;
        this.bytes = 0; this.fileCount = 0; this.nextOrdinal = 1;
        this.pendingRecords = 0; this.pendingBytes = 0;
        this.publishedRecords = 0;
        this.initialized = false; this.closed = false; this.closing = null;
        this.tail = Promise.resolve(); this.healthPending = false; this.healthRevision = 0;
        this.rejectedRecords = 0; this.writeErrors = 0; this.readErrors = 0;
        this.sqlConfirmedRecords = 0; this.recoveredRecords = 0; this.invalidFiles = 0;
        this.lastError = ''; this.capacityUncertain = false;
        this.sqlVerificationPending = false; this.sqlVerificationQuery = null;
        this.sqlVerificationUnknown = false;
    }

    health() {
        return {initialized: this.initialized, closed: this.closed, records: this.entries.size,
            bytes: this.bytes, maxBytes: this.maxBytes, maxRecords: this.maxRecords,
            pendingRecords: this.pendingRecords, pendingBytes: this.pendingBytes,
            publishedRecords: this.publishedRecords,
            confirmedRetainedRecords: this.confirmedRetainedRecords,
            unconfirmedRecords: this.entries.size - this.confirmedRetainedRecords,
            rejectedRecords: this.rejectedRecords, writeErrors: this.writeErrors, readErrors: this.readErrors,
            sqlConfirmedRecords: this.sqlConfirmedRecords, recoveredRecords: this.recoveredRecords,
            invalidFiles: this.invalidFiles, integrityValid: this.invalidFiles === 0 && !this.capacityUncertain,
            capacityVerified: !this.capacityUncertain,
            sqlVerificationPending: this.sqlVerificationPending,
            sqlVerificationQuery: this.sqlVerificationQuery ? {...this.sqlVerificationQuery} : null,
            sqlVerificationUnknown: this.sqlVerificationUnknown,
            lastError: this.lastError, storageStatus: 'local_durable_sql_unconfirmed'};
    }

    _enqueue(operation) {
        const result = this.tail.then(operation);
        this.tail = result.catch(() => {});
        return result;
    }

    async _syncDirectory() {
        const handle = await this.fs.open(this.directory, 'r');
        try { await handle.sync(); } finally { await handle.close(); }
    }

    async _syncFile(file) {
        const handle = await this.fs.open(file, 'r');
        try { await handle.sync(); } finally { await handle.close(); }
    }

    async _readBoundedFile(file, expectedBytes) {
        const handle = await this.fs.open(file, 'r');
        try {
            const stat = await handle.stat();
            if (!stat.isFile() || stat.size !== expectedBytes || stat.size > this.maxRecordBytes * 2 + 8192)
                throw new Error('journal original is not an unchanged bounded regular file');
            // readFile can follow concurrent growth to an unbounded allocation.
            // Read at most the known envelope plus one byte instead; that extra
            // byte detects growth without admitting its remainder into memory.
            const buffer = Buffer.alloc(expectedBytes + 1);
            let received = 0;
            while (received < buffer.length) {
                const {bytesRead} = await handle.read(buffer, received, buffer.length - received, received);
                if (!bytesRead) break;
                received += bytesRead;
            }
            if (received !== expectedBytes || (await handle.stat()).size !== expectedBytes)
                throw new Error('journal original changed length during bounded read');
            return buffer.subarray(0, received).toString('utf8');
        } finally { await handle.close(); }
    }

    async _writeFile(file, content, flags = 'wx') {
        const handle = await this.fs.open(file, flags, 0o600);
        try { await handle.writeFile(content, 'utf8'); await handle.sync(); }
        finally { await handle.close(); }
    }

    async _persistHealth() {
        // One reusable metadata temporary bounds crash leftovers as well as
        // normal operation. Records themselves always use exclusive creation.
        const temporary = path.join(this.directory, '.health.tmp');
        const content = JSON.stringify({schema: 1, ...Object.fromEntries(COUNTERS.map(key => [key, this[key]])),
            lastError: String(this.lastError).slice(0, 1000)});
        try {
            await this._writeFile(temporary, content, 'w');
            await this.fs.rename(temporary, path.join(this.directory, 'health.json'));
            await this._syncDirectory();
        } catch (error) {
            // Error reporting must not recursively schedule itself. The caller
            // still receives the original error; unavailable disks stay unknown.
            this.lastError = `journal health persistence failed: ${error.message}`.slice(0, 1000);
            try { await this.fs.unlink(temporary); } catch { /* Missing/unavailable file stays a diagnostic boundary. */ }
        }
    }

    _verificationQuery(query) {
        if (!query || typeof query.verificationId !== 'string' || !query.verificationId.trim()
            || query.verificationId.length > 256
            || !Number.isSafeInteger(query.start) || query.start < 0
            || !Number.isSafeInteger(query.end) || query.end < query.start
            || !Number.isSafeInteger(query.limit) || query.limit < 1
            || !Number.isSafeInteger(query.beganAt) || query.beganAt < 0)
            throw new Error('verification requires a bounded identity and valid original query limits/times');
        return {verificationId: query.verificationId, start: query.start, end: query.end,
            limit: query.limit, beganAt: query.beganAt};
    }

    _parseVerification(content) {
        const envelope = JSON.parse(content), data = envelope?.data;
        if (data?.schema !== 1 || typeof data.pending !== 'boolean'
            || envelope.sha256 !== digest(JSON.stringify(data))) throw new Error('invalid SQL verification fence');
        if (!data.pending && data.query !== null) throw new Error('cleared SQL verification fence has a query');
        return {pending: data.pending, query: data.pending ? this._verificationQuery(data.query) : null};
    }

    async _persistVerification(pending, query) {
        const data = {schema: 1, pending, query: pending ? query : null};
        const content = JSON.stringify({data, sha256: digest(JSON.stringify(data))});
        const temporary = path.join(this.directory, '.verification.tmp');
        try {
            await this._writeFile(temporary, content, 'w');
            await this.fs.rename(temporary, path.join(this.directory, 'verification.json'));
            await this._syncDirectory();
        } catch (error) {
            // An attempted clear that was not durably completed cannot make a
            // subsequent query safe. Preserve the previous committed fence and
            // the temporary; startup interprets either pending copy as blocked.
            this.writeErrors++; this.lastError = `SQL verification fence persistence failed: ${error.message}`;
            this._scheduleHealth(); throw error;
        }
    }

    async _recoverVerification() {
        let recovered = null;
        for (const name of ['verification.json', '.verification.tmp']) {
            try {
                const file = path.join(this.directory, name), stat = await this.fs.lstat(file);
                if (!stat.isFile() || stat.size > 8192) throw new Error('SQL verification fence is not bounded regular metadata');
                const value = this._parseVerification(await this._readBoundedFile(file, stat.size));
                if (value.pending) {
                    if (recovered && JSON.stringify(recovered) !== JSON.stringify(value.query))
                        throw new Error('conflicting outstanding SQL verification identities');
                    recovered = value.query;
                }
            } catch (error) {
                if (error.code === 'ENOENT') continue;
                this.readErrors++; this.sqlVerificationUnknown = true;
                this.lastError = `SQL verification fence retained as unknown: ${error.message}`;
            }
        }
        this.sqlVerificationQuery = recovered;
        this.sqlVerificationPending = !!recovered || this.sqlVerificationUnknown;
    }

    beginVerification(query) {
        let original;
        try {this._requireOpen(); original = this._verificationQuery(query);}
        catch (error) {return Promise.reject(error);}
        return this._enqueue(async () => {
            if (this.sqlVerificationPending) throw new Error('SQL verification is already pending; backend completion remains unknown');
            // Set in-memory state first: a failed disk operation prevents the
            // caller from sending SQL and conservatively blocks any later try.
            this.sqlVerificationPending = true; this.sqlVerificationQuery = original;
            await this._persistVerification(true, original);
            return {...original};
        });
    }

    completeVerification(proof = {}) {
        try {
            this._requireOpen();
            if (proof.kind !== 'observed-backend-completion' || typeof proof.evidence !== 'string'
                || !proof.evidence.trim() || proof.evidence.length > 1000)
                throw new Error('verification clear requires observed backend completion evidence');
        } catch (error) {return Promise.reject(error);}
        return this._clearVerification(proof.verificationId);
    }

    cancelUnissuedVerification(proof = {}) {
        try {
            this._requireOpen();
            // Trusted caller evidence that its transport was NEVER invoked is
            // distinct from an observation that an issued backend job ended.
            if (proof.kind !== 'locally-never-issued' || typeof proof.evidence !== 'string'
                || !proof.evidence.trim() || proof.evidence.length > 1000)
                throw new Error('verification cancellation requires locally never-issued evidence');
        } catch (error) {return Promise.reject(error);}
        return this._clearVerification(proof.verificationId);
    }

    _clearVerification(verificationId) {
        return this._enqueue(async () => {
            if (!this.sqlVerificationPending || this.sqlVerificationUnknown
                || verificationId !== this.sqlVerificationQuery?.verificationId)
                throw new Error('observed completion does not match the outstanding verification fence');
            await this._persistVerification(false, null);
            this.sqlVerificationPending = false; this.sqlVerificationQuery = null;
            return true;
        });
    }

    _scheduleHealth() {
        this.healthRevision++;
        if (!this.initialized || this.healthPending) return;
        this.healthPending = true;
        void this._enqueue(async () => {
            const revision = this.healthRevision;
            try { await this._persistHealth(); }
            finally {
                this.healthPending = false;
                // A loss received while the checkpoint was being written must
                // not depend on a later unrelated event or shutdown to persist.
                if (revision !== this.healthRevision) this._scheduleHealth();
            }
        });
    }

    _reject(message) {
        this.reportLoss(message);
        const error = new Error(message); error.code = 'EMS_JOURNAL_REJECTED';
        return Promise.reject(error);
    }

    // The caller's bounded pre-append queue can reject a raw frame before an
    // append reaches this module. Preserve that loss in the same durable health
    // accounting rather than claiming that the local spool covered the frame.
    reportLoss(message) {
        this.rejectedRecords++;
        this.lastError = String(message || 'record rejected before durable append').slice(0, 1000);
        this._scheduleHealth();
        return this.health();
    }

    _requireOpen() {
        if (!this.initialized) throw new Error('journal is not initialized');
        if (this.closed) throw new Error('journal is closed');
    }

    _payloadMetadata(payload) {
        if (typeof payload !== 'string') throw new Error('journal payload must be an original serialized record string');
        const record = JSON.parse(payload);
        if (!record || typeof record !== 'object' || Array.isArray(record)
            || !((typeof record.recordSession === 'string' && record.recordSession.length > 0)
                || (typeof record.recordSession === 'number' && Number.isFinite(record.recordSession)))
            || !Number.isSafeInteger(record.recordSequence) || record.recordSequence < 1)
            throw new Error('journal record lacks a valid session/sequence identity');
        if (record.schema === 3 && (!['snapshot', 'delta'].includes(record.frameType)
            || !Number.isSafeInteger(record.checkpointSequence) || record.checkpointSequence < 1
            || (record.frameType === 'snapshot' && (record.checkpointSequence !== record.recordSequence
                || !record.data || typeof record.data !== 'object' || Array.isArray(record.data)))
            || (record.frameType === 'delta' && (!Number.isSafeInteger(record.baseSequence)
                || record.baseSequence !== record.recordSequence - 1 || record.checkpointSequence > record.baseSequence
                || !Array.isArray(record.ops)))))
            throw new Error('journal compact checkpoint identity/format is invalid');
        const payloadBytes = Buffer.byteLength(payload);
        if (payloadBytes > this.maxRecordBytes) throw new Error('journal record exceeds per-record capacity');
        return {recordSession: record.recordSession, recordSequence: record.recordSequence,
            sha256: digest(payload), payloadBytes, identity: identity(record), schema: record.schema,
            frameType: record.frameType, checkpointSequence: record.checkpointSequence, baseSequence: record.baseSequence};
    }

    _parseFile(content, id) {
        const value = JSON.parse(content);
        if (value?.schema !== 1 || value.id !== id) throw new Error('invalid journal envelope');
        const metadata = this._payloadMetadata(value.payload);
        if (value.sha256 !== metadata.sha256 || value.payloadBytes !== metadata.payloadBytes
            || value.recordSession !== metadata.recordSession || value.recordSequence !== metadata.recordSequence)
            throw new Error('journal checksum or original identity mismatch');
        return {...metadata, id, payload: value.payload};
    }

    _register(entry, fileBytes) {
        const existing = this.identities.get(entry.identity);
        if (existing) throw new Error(existing.sha256 === entry.sha256
            ? 'duplicate durable journal identity' : 'conflicting durable journal identity');
        const metadata = {...entry, fileBytes, published: false, confirmedStored: false};
        delete metadata.payload;
        this.entries.set(entry.id, metadata);
        this.identities.set(entry.identity, metadata);
        const previous = this.groups.get(this.currentGroupId);
        const compact = entry.schema === 3 && ['snapshot', 'delta'].includes(entry.frameType);
        const follows = compact && entry.frameType === 'delta' && previous && !previous.closed
            && previous.recordSession === entry.recordSession && previous.checkpointSequence === entry.checkpointSequence
            && previous.lastSequence === entry.baseSequence && entry.recordSequence === previous.lastSequence + 1;
        if (!follows) {
            if (previous) previous.closed = true;
            const group = {id: entry.id, recordSession: entry.recordSession, checkpointSequence: entry.checkpointSequence,
                compact, missingBasis: compact && entry.frameType !== 'snapshot', closed: !compact,
                firstId: entry.id, lastId: entry.id, lastSequence: entry.recordSequence, ids: new Set()};
            this.groups.set(group.id, group);
            this.currentGroupId = compact ? group.id : null;
            metadata.groupId = group.id;
        } else metadata.groupId = previous.id;
        const group = this.groups.get(metadata.groupId);
        group.ids.add(entry.id); group.lastId = entry.id; group.lastSequence = entry.recordSequence;
        return metadata;
    }

    _retirementContent(group) {
        const data = {schema: 1, kind: 'independently-confirmed-closed-group', groupId: group.id,
            recordSession: group.recordSession, checkpointSequence: group.checkpointSequence,
            firstId: group.firstId, lastId: group.lastId};
        return JSON.stringify({data, sha256: digest(JSON.stringify(data))});
    }

    _parseRetirement(content, id) {
        const marker = JSON.parse(content), data = marker?.data;
        if (data?.schema !== 1 || data.kind !== 'independently-confirmed-closed-group'
            || data.groupId !== id || !/^\d{16}$/.test(data.firstId) || !/^\d{16}$/.test(data.lastId)
            || data.firstId !== id || data.lastId < data.firstId
            || !Number.isSafeInteger(data.checkpointSequence) || data.checkpointSequence < 1
            || !((typeof data.recordSession === 'string' && data.recordSession)
                || (typeof data.recordSession === 'number' && Number.isFinite(data.recordSession)))
            || marker.sha256 !== digest(JSON.stringify(data))) throw new Error('invalid checkpoint retirement marker');
        return data;
    }

    _belongsToRetirement(entry, marker) {
        return entry.schema === 3 && entry.id >= marker.firstId && entry.id <= marker.lastId
            && entry.recordSession === marker.recordSession && entry.checkpointSequence === marker.checkpointSequence;
    }

    _forget(entry) {
        this.entries.delete(entry.id); this.identities.delete(entry.identity);
        if (entry.published) this.publishedRecords--;
        if (entry.confirmedStored) this.confirmedRetainedRecords--;
        this.bytes -= entry.fileBytes; this.fileCount--;
        this.groups.get(entry.groupId)?.ids.delete(entry.id);
    }

    async _retireGroup(group) {
        if (!group.closed || group.missingBasis || !group.ids.size
            || [...group.ids].some(id => !this.entries.get(id)?.confirmedStored)) return;
        // A durable small retirement marker commits the WHOLE closed group
        // before any member is unlinked. A crash during cleanup can therefore
        // finish that committed removal instead of replaying a broken prefix.
        let committed = !group.compact;
        try {
            if (group.compact) {
                const marker = path.join(this.directory, `${group.id}.retired`);
                const temporary = path.join(this.directory, `${group.id}.retire-tmp`);
                const content = this._retirementContent(group);
                await this._writeFile(temporary, content, 'w');
                try { await this.fs.link(temporary, marker); }
                catch (error) {
                    if (error.code !== 'EEXIST') throw error;
                    const stat = await this.fs.lstat(marker);
                    const previous = this._parseRetirement(await this._readBoundedFile(marker, stat.size), group.id);
                    if (JSON.stringify(previous) !== JSON.stringify(JSON.parse(content).data))
                        throw new Error('conflicting checkpoint retirement marker');
                    await this._syncFile(marker);
                }
                await this._syncDirectory(); committed = true;
                await this.fs.unlink(temporary); await this._syncDirectory();
            }
            for (const id of [...group.ids]) {
                const entry = this.entries.get(id);
                await this.fs.unlink(path.join(this.directory, `${id}.json`));
                this._forget(entry);
            }
            await this._syncDirectory();
            if (group.compact) {
                await this.fs.unlink(path.join(this.directory, `${group.id}.retired`));
                await this._syncDirectory();
            }
            this.groups.delete(group.id);
        } catch (error) {
            this.writeErrors++; this.lastError = `journal confirmed-group cleanup failed: ${error.message}`;
            error.retirementCommitted = committed;
            this.capacityUncertain = true;
            this._scheduleHealth(); throw error;
        }
    }

    async _retireConfirmedGroups() {
        for (const group of [...this.groups.values()]) await this._retireGroup(group);
    }

    async initialize() {
        if (this.initialized) return this.health();
        if (this.closed) throw new Error('journal is closed');
        await this.fs.mkdir(this.directory, {recursive: true, mode: 0o700});
        // mkdir's mode does not protect an already existing directory. This
        // must be a dedicated per-instance spool, not the shared data root.
        await this.fs.chmod(this.directory, 0o700);
        await this._recoverVerification();
        for (const name of ['health.json', '.health.tmp']) {
            try {
                const healthFile = path.join(this.directory, name);
                const stat = await this.fs.lstat(healthFile);
                if (!stat.isFile() || stat.size > 8192) throw new Error('journal health is not a bounded regular file');
                const content = await this.fs.readFile(healthFile, 'utf8');
                const old = JSON.parse(content);
                if (old?.schema !== 1) throw new Error('invalid journal health envelope');
                for (const key of COUNTERS) if (Number.isSafeInteger(old[key]) && old[key] >= 0)
                    this[key] = Math.max(this[key], old[key]);
                if (typeof old.lastError === 'string') this.lastError = old.lastError.slice(0, 1000);
            } catch (error) {
                if (error.code !== 'ENOENT') { this.readErrors++; this.lastError = `journal health unreadable: ${error.message}`; }
            }
        }
        const names = [], retirements = [], retirementTemporaries = [];
        const directory = await this.fs.opendir(this.directory);
        for await (const entry of directory) {
            const match = FILE.exec(entry.name);
            if (!match) {
                const retired = RETIRED.exec(entry.name);
                if (retired) retirements.push({id: retired[1], name: entry.name});
                else if (/^\d{16}\.retire-tmp$/.test(entry.name)) retirementTemporaries.push(entry.name);
                if (retirements.length + retirementTemporaries.length > this.maxRecords + this.maxPendingRecords)
                    throw new Error('existing retirement metadata capacity exceeded');
                continue;
            }
            // Bound metadata memory even if an externally changed directory is
            // larger than configured. No existing record is removed on failure.
            if (names.length >= this.maxRecords + this.maxPendingRecords)
                throw new Error('existing journal file capacity exceeded; retained originals require inspection');
            names.push({name: entry.name, id: match[1], temporary: match[2] === 'tmp'});
            this.nextOrdinal = Math.max(this.nextOrdinal, Number(match[1]) + 1);
        }
        names.sort((a, b) => a.id.localeCompare(b.id) || Number(a.temporary) - Number(b.temporary));
        for (const retired of retirements) {
            try {
                const file = path.join(this.directory, retired.name), stat = await this.fs.lstat(file);
                if (!stat.isFile() || stat.size > 8192) throw new Error('retirement marker is not bounded regular metadata');
                retired.marker = this._parseRetirement(await this._readBoundedFile(file, stat.size), retired.id);
                await this._syncFile(file); await this._syncDirectory();
            } catch (error) {
                retired.failed = true; this.invalidFiles++; this.readErrors++;
                this.lastError = `journal retirement marker retained as invalid: ${error.message}`;
            }
        }
        // Small filesystem batches avoid a long chain of serial startup reads.
        // They are local I/O only; no SQL/history requests are made here.
        for (let index = 0; index < names.length; index += 8) {
            const parsed = await Promise.all(names.slice(index, index + 8).map(async entry => {
                const file = path.join(this.directory, entry.name);
                let fileBytes = 0;
                try {
                    const stat = await this.fs.lstat(file); fileBytes = stat.size;
                    if (!stat.isFile() || stat.size > this.maxRecordBytes * 2 + 8192)
                        throw new Error('journal file is not a bounded regular file');
                    return {...entry, file, fileBytes, record: this._parseFile(await this._readBoundedFile(file, fileBytes), entry.id)};
                } catch (error) { return {...entry, file, fileBytes, error}; }
            }));
            for (const entry of parsed) {
                this.bytes += entry.fileBytes; this.fileCount++;
                if (entry.error) {
                    this.invalidFiles++; this.readErrors++;
                    this.lastError = `journal file ${entry.name} retained as invalid: ${entry.error.message}`;
                    for (const retired of retirements) if (retired.marker && entry.id >= retired.marker.firstId
                        && entry.id <= retired.marker.lastId) retired.failed = true;
                    continue;
                }
                let retired;
                try {
                    retired = retirements.find(candidate => candidate.marker && this._belongsToRetirement(entry.record, candidate.marker));
                    if (retired) {
                        await this.fs.unlink(entry.file); await this._syncDirectory();
                        this.bytes -= entry.fileBytes; this.fileCount--;
                        continue;
                    }
                    if (entry.temporary) {
                        const existing = this.entries.get(entry.id);
                        if (existing) {
                            if (existing.sha256 !== entry.record.sha256) throw new Error('conflicting interrupted append');
                            await this.fs.unlink(entry.file);
                            await this._syncDirectory();
                            this.bytes -= entry.fileBytes; this.fileCount--;
                            continue;
                        }
                        // Exclusive hard-link publication never overwrites an
                        // existing immutable final file, even after a crash.
                        // A complete temporary may come from writeFile followed
                        // by a failed file fsync. Directory fsync alone does not
                        // establish durability of those original record bytes.
                        await this._syncFile(entry.file);
                        await this.fs.link(entry.file, path.join(this.directory, `${entry.id}.json`));
                        await this._syncDirectory();
                        await this.fs.unlink(entry.file);
                        await this._syncDirectory();
                        this.recoveredRecords++;
                    }
                    this._register(entry.record, entry.fileBytes);
                } catch (error) {
                    if (retired) retired.failed = true;
                    this.invalidFiles++; this.readErrors++;
                    this.lastError = `journal recovery retained ${entry.name}: ${error.message}`;
                }
            }
        }
        for (const retired of retirements) if (retired.marker && !retired.failed) {
            await this.fs.unlink(path.join(this.directory, retired.name)); await this._syncDirectory();
        }
        for (const temporary of retirementTemporaries) {
            // Uncommitted retirement metadata is not an original observation.
            // Original record files survive and all proofs must be renewed.
            await this.fs.unlink(path.join(this.directory, temporary)); await this._syncDirectory();
        }
        this.initialized = true;
        if (this.readErrors || this.recoveredRecords || this.rejectedRecords) await this._persistHealth();
        return this.health();
    }

    append(payload) {
        let metadata;
        try { this._requireOpen(); metadata = this._payloadMetadata(payload); }
        catch (error) { return this._reject(error.message); }
        if (this.pendingRecords >= this.maxPendingRecords || this.pendingBytes + metadata.payloadBytes > this.maxPendingBytes)
            return this._reject('journal pending-memory capacity exceeded; record was not accepted');
        this.pendingRecords++; this.pendingBytes += metadata.payloadBytes;
        return this._enqueue(async () => {
            try {
                if (this.capacityUncertain) return await this._reject('journal capacity is unknown after an I/O failure; restart/inspection required');
                const previous = this.identities.get(metadata.identity);
                if (previous) {
                    if (previous.sha256 !== metadata.sha256) return await this._reject('conflicting journal record identity');
                    return this._public(previous, true);
                }
                const id = String(this.nextOrdinal++).padStart(16, '0');
                if (!/^\d{16}$/.test(id)) return await this._reject('journal ordinal capacity exceeded');
                const content = JSON.stringify({schema: 1, id, recordSession: metadata.recordSession,
                    recordSequence: metadata.recordSequence, sha256: metadata.sha256,
                    payloadBytes: metadata.payloadBytes, payload});
                const fileBytes = Buffer.byteLength(content);
                if (this.fileCount >= this.maxRecords || this.bytes + fileBytes > this.maxBytes)
                    return await this._reject('journal disk/record capacity exceeded; retained originals were not evicted');
                const temporary = path.join(this.directory, `${id}.tmp`);
                try {
                    await this._writeFile(temporary, content);
                    await this.fs.link(temporary, path.join(this.directory, `${id}.json`));
                    await this._syncDirectory();
                    await this.fs.unlink(temporary);
                    await this._syncDirectory();
                    const entry = this._register({...metadata, id}, fileBytes);
                    this.bytes += fileBytes; this.fileCount++;
                    // The new immutable original is already durably registered.
                    // Maintenance of an OLDER independently confirmed group may
                    // fail, but must not turn this append into an uncertain one
                    // or count its file for a second time in the append catch.
                    try {await this._retireConfirmedGroups();}
                    catch { /* Cleanup records its own error/capacity boundary. */ }
                    return this._public(entry, false);
                } catch (error) {
                    this.writeErrors++;
                    this.lastError = `journal append not confirmed durable: ${error.message}`;
                    // Preserve any complete/incomplete file for startup recovery;
                    // never publish/delete a record after a failed durability step.
                    // Account retained failure artifacts immediately, so repeated
                    // failed appends cannot bypass the disk/file bounds in memory.
                    for (const file of [temporary, path.join(this.directory, `${id}.json`)]) {
                        try {
                            const stat = await this.fs.lstat(file);
                            this.bytes += stat.size; this.fileCount++; this.invalidFiles++;
                        } catch (inspection) {
                            if (inspection.code !== 'ENOENT') {
                                this.capacityUncertain = true;
                                this.lastError += `; artifact inspection failed: ${inspection.message}`;
                            }
                        }
                    }
                    this._scheduleHealth();
                    throw error;
                }
            } finally { this.pendingRecords--; this.pendingBytes -= metadata.payloadBytes; }
        });
    }

    _public(entry, duplicate = false) {
        return {id: entry.id, recordSession: entry.recordSession, recordSequence: entry.recordSequence,
            sha256: entry.sha256, payloadBytes: entry.payloadBytes, duplicate,
            groupId: entry.groupId, confirmedStored: entry.confirmedStored,
            published: entry.published, status: entry.confirmedStored
                ? 'local_durable_sql_confirmed_dependency_retained' : 'local_durable_sql_unconfirmed'};
    }

    readBatch({afterId = null, limit = 16, maxBytes = 512 * 1024} = {}) {
        try {
            this._requireOpen(); integer(limit, 'batch limit'); integer(maxBytes, 'batch maxBytes');
            if (afterId !== null && !/^\d{16}$/.test(afterId)) throw new Error('invalid journal cursor');
        } catch (error) { return Promise.reject(error); }
        return this._enqueue(async () => {
            const result = []; let bytes = 0;
            for (const entry of this.entries.values()) {
                if (entry.confirmedStored) continue;
                if (afterId !== null && entry.id <= afterId) continue;
                if (result.length >= limit) break;
                if (bytes + entry.payloadBytes > maxBytes) {
                    if (!result.length) throw new Error('journal batch byte capacity is smaller than the next original record');
                    break;
                }
                try {
                    if (entry.invalid) throw new Error('journal original is known invalid; restart/inspection required');
                    const original = this._parseFile(await this._readBoundedFile(path.join(this.directory, `${entry.id}.json`),
                        entry.fileBytes), entry.id);
                    if (original.sha256 !== entry.sha256) throw new Error('journal record changed after initialization');
                    result.push({...this._public(entry), payload: original.payload});
                    bytes += entry.payloadBytes;
                } catch (error) {
                    if (!entry.invalid) {entry.invalid = true; this.invalidFiles++;}
                    this.readErrors++; this.lastError = `journal read failed: ${error.message}`;
                    this._scheduleHealth(); throw error;
                }
            }
            return result;
        });
    }

    markPublished(id) {
        this._requireOpen();
        const entry = this.entries.get(id);
        if (!entry) throw new Error('journal publication references an unknown record');
        if (!entry.published) this.publishedRecords++;
        entry.published = true;
        return this._public(entry);
    }

    confirmStored(id, proof = {}) {
        try {
            this._requireOpen();
            if (proof.kind !== 'independent-history-match')
                throw new Error('journal deletion requires an independent exact history match');
        } catch (error) { return Promise.reject(error); }
        return this._enqueue(async () => {
            const entry = this.entries.get(id);
            if (!entry || proof.recordSession !== entry.recordSession || proof.recordSequence !== entry.recordSequence
                || proof.sha256 !== entry.sha256) throw new Error('independent history proof does not match journal identity/hash');
            let removed = false;
            try {
                if (!entry.confirmedStored) {
                    entry.confirmedStored = true; this.confirmedRetainedRecords++; this.sqlConfirmedRecords++;
                }
                await this._retireConfirmedGroups();
                removed = !this.entries.has(id);
                await this._persistHealth();
                return true;
            } catch (error) {
                error.journalId = id;
                error.sqlProofVerified = true;
                error.recordRemoved = removed || !this.entries.has(id);
                this._scheduleHealth(); throw error;
            }
        });
    }

    prepareReplay(id) {
        try { this._requireOpen(); } catch (error) { return Promise.reject(error); }
        return this._enqueue(async () => {
            const entry = this.entries.get(id), group = this.groups.get(entry?.groupId);
            if (!group || group.missingBasis) throw new Error('journal replay requires a retained complete checkpoint basis');
            const ids = [...group.ids];
            for (const memberId of ids) {
                const member = this.entries.get(memberId);
                if (member.confirmedStored) {member.confirmedStored = false; this.confirmedRetainedRecords--;}
                member.published = false;
            }
            this.publishedRecords = [...this.entries.values()].filter(member => member.published).length;
            return {ids, groupId: group.id};
        });
    }

    close() {
        if (this.closing) return this.closing;
        this.closed = true;
        this.closing = (async () => {
            // Every already accepted append runs before this barrier. Shutdown
            // may be bounded externally; an aborted wait is not a durability ACK.
            let previous;
            do { previous = this.tail; await previous; } while (previous !== this.tail);
            if (this.initialized) await this._persistHealth();
            return this.health();
        })();
        return this.closing;
    }
}

module.exports = DecisionRecordJournal;
