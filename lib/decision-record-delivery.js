'use strict';

const {createHash, randomUUID} = require('node:crypto');

const hash = value => createHash('sha256').update(value).digest('hex');
const identity = value => JSON.stringify([value.recordSession, value.recordSequence]);
const describe = error => `${error?.name || 'Error'}: ${error?.message || String(error)}`;

/** Diagnostic delivery only. Publication never proves SQL persistence.
 * The journal retains every original until a separate raw-history response
 * contains its exact payload hash and session/sequence. All transports are
 * injected; this module has no configuration or actuator capabilities.
 */
class DecisionRecordDelivery {
    constructor({journal, publish, readHistory, now = () => Date.now(),
        publishIntervalMs = 10000, checkIntervalMs = 30000, minQueryGapMs = 1000,
        windowMs = 2000, queryLimit = 32, maxQueriesPerTick = 8, maxPublishPerTick = 16,
        maxBatchBytes = 512 * 1024, maxTrackedEntries = 65536, maxQueuedWindows = 4096,
        maxResponseBytes = 2 * 1024 * 1024, queryTimeoutMs = 30000, publishTimeoutMs = 10000,
        publicationMarginMs = 1000, maxPublicationSpanMs = 120000,
        republishMinMs = 60000, minCompleteMisses = 2, maxRepublishAttempts = 3,
        freshProofMaxAgeMs = 60000, maxMissCoverageRanges = 64,
        wait = ms => new Promise(resolve => setTimeout(resolve, ms))} = {}) {
        if (!journal || typeof journal.readBatch !== 'function' || typeof journal.markPublished !== 'function'
            || typeof journal.confirmStored !== 'function') throw new Error('journal delivery API is required');
        if (typeof publish !== 'function' || typeof readHistory !== 'function' || typeof now !== 'function'
            || typeof wait !== 'function') throw new Error('publish, readHistory, now and wait must be functions');
        for (const [name, value] of Object.entries({publishIntervalMs, checkIntervalMs, minQueryGapMs,
            windowMs, queryLimit, maxQueriesPerTick, maxPublishPerTick, maxBatchBytes, maxTrackedEntries,
            maxQueuedWindows, maxResponseBytes, queryTimeoutMs, publishTimeoutMs, publicationMarginMs,
            maxPublicationSpanMs, republishMinMs, minCompleteMisses, maxRepublishAttempts,
            freshProofMaxAgeMs, maxMissCoverageRanges})) {
            if (!Number.isSafeInteger(value) || value < 1) throw new Error(`${name} must be a positive integer`);
        }
        if (windowMs > 2000 || queryLimit > 32 || maxPublishPerTick > 16
            || maxQueriesPerTick > 32 || queryTimeoutMs > 60000 || publishTimeoutMs > 60000
            || republishMinMs < 60000 || minCompleteMisses < 2 || maxRepublishAttempts > 3)
            throw new Error('delivery limits exceed the bounded transport contract');
        Object.assign(this, {journal, publish, readHistory, now, publishIntervalMs, checkIntervalMs,
            minQueryGapMs, windowMs, queryLimit, maxQueriesPerTick, maxPublishPerTick, maxBatchBytes,
            maxTrackedEntries, maxQueuedWindows, maxResponseBytes, queryTimeoutMs, publishTimeoutMs,
            publicationMarginMs, maxPublicationSpanMs, republishMinMs, minCompleteMisses,
            maxRepublishAttempts, freshProofMaxAgeMs, maxMissCoverageRanges, wait});
        this.entries = new Map(); this.identities = new Map(); this.windows = new Map();
        this.unqueuedProofs = new Set();
        this.cursor = null; this.publishBusy = false; this.verificationBusy = false; this.stopped = false;
        this.lastPublishAt = null; this.lastQueryAt = null;
        this.lastQueryMonotonic = null;
        this.backendBlocked = journal.health?.().sqlVerificationPending === true;
        this.backendToken = null; this.queryActive = false;
        this.publicationBlocked = false;
        this.sqlConfirmed = 0; this.publicationAttempts = 0; this.publicationErrors = 0;
        this.localCleanupErrors = 0;
        this.queryCount = 0; this.queryErrors = 0; this.saturatedWindows = 0;
        this.capacityErrors = 0; this.lastError = ''; this.lastQuery = null;
        this.recentQueries = [];
        this.replayIds = new Set(); this.replayGroups = new Map();
        this.republishAttempts = 0; this.replayRequests = 0;
        this.recoveryEpoch = 0; this.lastFreshSQLProof = null;
    }

    health() {
        const exhausted = [...this.entries.values()].filter(entry => {
            const group = this.replayGroups.get(entry.groupId);
            return group?.requests >= this.maxRepublishAttempts && !this.freshEpochAvailable(entry, group);
        }).length;
        return {schema: 1, busy: this.publishBusy || this.verificationBusy,
            publishBusy: this.publishBusy, verificationBusy: this.verificationBusy, stopped: this.stopped,
            backendBlocked: this.backendBlocked, activeSqlRequests: this.queryActive ? 1 : 0,
            persistentVerificationFence: this.journal.health?.().sqlVerificationPending === true,
            backendCompletion: this.backendBlocked
                ? this.lastQuery?.backendCompletionObserved === true ? 'observed_completed_verification_failed' : 'unknown'
                : 'no_unresolved_request',
            publicationBlocked: this.publicationBlocked, publicationAttempts: this.publicationAttempts,
            publicationErrors: this.publicationErrors, sqlConfirmed: this.sqlConfirmed,
            localCleanupErrors: this.localCleanupErrors,
            republishAttempts: this.republishAttempts, replayRequests: this.replayRequests,
            pendingReplayPublications: this.replayIds.size, retryExhausted: exhausted,
            recoveryEpoch: this.recoveryEpoch,
            lastFreshSQLProof: this.lastFreshSQLProof ? {...this.lastFreshSQLProof} : null,
            queryCount: this.queryCount, queryErrors: this.queryErrors, saturatedWindows: this.saturatedWindows,
            pendingEntries: this.entries.size, pendingWindows: this.windows.size, capacityErrors: this.capacityErrors,
            pendingUnscheduledProofs: this.unqueuedProofs.size,
            lastError: this.lastError, lastQuery: this.lastQuery ? {...this.lastQuery} : null,
            recentQueries: this.recentQueries.map(query => ({...query})),
            storageProof: 'only_independent_exact_raw_history_match',
            limits: {maxPublishPerTick: this.maxPublishPerTick, maxQueriesPerTick: this.maxQueriesPerTick,
                windowMs: this.windowMs, queryLimit: this.queryLimit, minQueryGapMs: this.minQueryGapMs,
                publishIntervalMs: this.publishIntervalMs, checkIntervalMs: this.checkIntervalMs,
                republishMinMs: this.republishMinMs, minCompleteMisses: this.minCompleteMisses,
                maxRepublishAttempts: this.maxRepublishAttempts, freshProofMaxAgeMs: this.freshProofMaxAgeMs}};
    }

    recoverBackend(proof) {
        if (proof?.kind !== 'observed-backend-completion')
            throw new Error('explicit observed backend completion is required; adapter health is insufficient');
        const clear = () => {this.backendBlocked = false; this.backendToken = null; this.queryActive = false;};
        const health = this.journal.health?.();
        if (health?.sqlVerificationPending === true) {
            if (proof.verificationId !== health.sqlVerificationQuery?.verificationId
                || typeof proof.evidence !== 'string' || !proof.evidence.trim())
                throw new Error('persistent SQL fence requires exact query identity and observed completion evidence');
            return this.journal.completeVerification(proof).then(clear);
        }
        clear();
    }

    stop() { this.stopped = true; }

    freshEpochAvailable(entry, group) {
        return group.epoch < this.recoveryEpoch && this.lastFreshSQLProof
            && entry.id < this.lastFreshSQLProof.id;
    }

    removeEntryWindows(id) {
        this.unqueuedProofs.delete(id);
        for (const [key, task] of this.windows) {
            task.ids.delete(id);
            if (!task.ids.size) this.windows.delete(key);
        }
    }

    async prepareEligibleReplay() {
        if (this.backendBlocked || this.publicationBlocked || this.verificationBusy || this.queryActive
            || this.replayIds.size) return;
        for (const entry of this.entries.values()) {
            if (entry.needsPublication || entry.completeMisses < this.minCompleteMisses
                || this.now() - entry.attemptedAt < this.republishMinMs) continue;
            let budget = this.replayGroups.get(entry.groupId);
            if (budget && this.freshEpochAvailable(entry, budget)) {
                budget.requests = 0; budget.epoch = this.recoveryEpoch;
            }
            if (budget?.requests >= this.maxRepublishAttempts) {
                this.lastError = 'bounded SQL replay budget exhausted; original chain retained'; continue;
            }
            if (typeof this.journal.prepareReplay !== 'function') {
                this.lastError = 'journal cannot prepare an original checkpoint chain for replay'; return;
            }
            this.replayPreparing = true;
            let replay;
            try {replay = await this.journal.prepareReplay(entry.id);}
            finally {this.replayPreparing = false;}
            if (!replay || typeof replay.groupId !== 'string' || !Array.isArray(replay.ids)
                || !replay.ids.length || replay.ids.length > this.maxTrackedEntries
                || new Set(replay.ids).size !== replay.ids.length || !replay.ids.includes(entry.id)
                || replay.ids.some(id => typeof id !== 'string' || !/^\d{16}$/.test(id)))
                throw new Error('invalid bounded journal checkpoint replay group');
            budget = this.replayGroups.get(replay.groupId) || {requests: 0, epoch: this.recoveryEpoch, pending: new Set()};
            if (this.freshEpochAvailable(entry, budget)) {budget.requests = 0; budget.epoch = this.recoveryEpoch;}
            budget.requests++; budget.pending = new Set(replay.ids);
            this.replayGroups.set(replay.groupId, budget); this.replayRequests++;
            for (const id of replay.ids) {
                this.removeEntryWindows(id); this.replayIds.add(id);
                const previous = this.entries.get(id);
                if (previous) {
                    previous.groupId = replay.groupId; previous.needsPublication = true;
                    previous.completeMisses = 0; previous.missCoverage = [];
                    previous.windowCursor = null; previous.proofStart = previous.proofEnd = null;
                }
            }
            this.cursor = null;
            return; // At most one original checkpoint group is prepared per publication batch.
        }
    }

    observeCompleteMiss(task, requestedIds) {
        for (const id of requestedIds) {
            const entry = this.entries.get(id);
            if (!entry || entry.needsPublication || !Number.isSafeInteger(entry.proofStart)
                || !Number.isSafeInteger(entry.proofEnd)) continue;
            const start = Math.max(task.start, entry.proofStart), end = Math.min(task.end, entry.proofEnd);
            if (start > end) continue;
            const ranges = [...entry.missCoverage, [start, end]].sort((a, b) => a[0] - b[0]);
            const merged = [];
            for (const range of ranges) {
                const previous = merged.at(-1);
                if (previous && range[0] - previous[1] <= 1) previous[1] = Math.max(previous[1], range[1]);
                else merged.push([...range]);
            }
            if (merged.length > this.maxMissCoverageRanges) {
                this.capacityErrors++; this.lastError = 'complete-miss coverage capacity reached; replay not admitted';
                continue;
            }
            entry.missCoverage = merged;
            if (merged.length === 1 && merged[0][0] <= entry.proofStart && merged[0][1] >= entry.proofEnd) {
                entry.completeMisses++; entry.missCoverage = [];
            }
        }
    }

    observeStorageProof(entry, row) {
        const at = this.now(), age = at - row.ts;
        if (age >= -1000 && age <= this.freshProofMaxAgeMs
            && (!this.lastFreshSQLProof || entry.id > this.lastFreshSQLProof.id)) {
            this.recoveryEpoch++;
            this.lastFreshSQLProof = {id: entry.id, sqlTs: row.ts, observedAt: at};
        }
        for (const [key, group] of this.replayGroups) {
            group.pending.delete(entry.id);
            if (!group.pending.size) this.replayGroups.delete(key);
        }
    }

    entryValid(entry) {
        if (!entry || typeof entry.id !== 'string' || typeof entry.payload !== 'string'
            || entry.sha256 !== hash(entry.payload)) return false;
        let frame;
        try { frame = JSON.parse(entry.payload); } catch { return false; }
        return frame && !Array.isArray(frame) && typeof frame === 'object'
            && identity(frame) === identity(entry)
            && ((typeof frame.recordSession === 'string' && frame.recordSession.length > 0)
                || (typeof frame.recordSession === 'number' && Number.isFinite(frame.recordSession)))
            && Number.isSafeInteger(frame.recordSequence) && frame.recordSequence >= 1;
    }

    addWindow(start, end, id, depth = 0) {
        const key = `${start}:${end}`;
        let task = this.windows.get(key);
        if (!task) {
            if (this.windows.size >= this.maxQueuedWindows) {
                this.capacityErrors++; this.lastError = 'verification window capacity reached; journal originals retained';
                return false;
            }
            task = {key, start, end, ids: new Set(), depth, checkedAt: null};
            this.windows.set(key, task);
        }
        task.ids.add(id);
        return true;
    }

    addPublicationWindows(entry, startedAt, publishedAt) {
        // publishedAt, when supplied, is the actual state-write timestamp,
        // not the later transport-completion clock. Quantized windows combine
        // a burst of up to sixteen publications into one bounded SQL read.
        const exact = Number.isSafeInteger(publishedAt) && publishedAt >= 0;
        if (!exact) publishedAt = this.now();
        if (exact) {
            const from = Math.floor(publishedAt / this.windowMs) * this.windowMs;
            entry.windowCursor = entry.proofStart = from;
            entry.windowEnd = entry.proofEnd = from + this.windowMs - 1;
            this.queueEntryWindows(entry);
            return;
        }
        const start = Math.max(0, Math.min(startedAt, publishedAt) - this.publicationMarginMs);
        const end = Math.max(startedAt, publishedAt) + this.publicationMarginMs;
        if (end - start > this.maxPublicationSpanMs) {
            this.capacityErrors++; this.lastError = 'publication span exceeded; SQL proof unknown and journal original retained';
            return;
        }
        entry.windowCursor = entry.proofStart = start; entry.windowEnd = entry.proofEnd = end;
        this.queueEntryWindows(entry);
    }

    queueEntryWindows(entry) {
        while (entry.windowCursor !== null && entry.windowCursor <= entry.windowEnd) {
            const from = entry.windowCursor, to = Math.min(entry.windowEnd, from + this.windowMs);
            if (!this.addWindow(from, to, entry.id)) {
                this.unqueuedProofs.add(entry.id);
                return;
            }
            entry.windowCursor = to === entry.windowEnd ? null : to;
        }
        this.unqueuedProofs.delete(entry.id);
    }

    repairWindows() {
        // Retain only the next span cursor per original when the bounded
        // window map is full. As earlier proof work completes, restore at
        // most one publication batch of missing tasks, without another write.
        let checked = 0;
        for (const id of this.unqueuedProofs) {
            if (this.stopped || this.windows.size >= this.maxQueuedWindows
                || checked++ >= this.maxPublishPerTick) break;
            const entry = this.entries.get(id);
            if (entry) this.queueEntryWindows(entry);
            else this.unqueuedProofs.delete(id);
        }
    }

    async publishEntry(entry) {
        const replaying = this.replayIds.has(entry.id);
        const frame = JSON.parse(entry.payload);
        const state = this.entries.get(entry.id) || {id: entry.id, recordSession: entry.recordSession,
            recordSequence: entry.recordSequence, sha256: entry.sha256,
            groupId: entry.groupId || (frame.schema === 3 ? JSON.stringify([frame.recordSession, frame.checkpointSequence]) : entry.id)};
        state.attemptedAt = this.now(); state.completeMisses = 0; state.missCoverage = [];
        state.needsPublication = false; state.proofStart = state.proofEnd = null;
        this.entries.set(entry.id, state); this.identities.set(identity(entry), entry.id);
        if (replaying) {this.republishAttempts++; this.replayIds.delete(entry.id);}
        this.publicationAttempts++;
        let expired = false, timer;
        const operation = Promise.resolve().then(() => this.publish(entry.payload));
        // A delayed write can finish after our local bound. This updates the
        // diagnostic publication window only; it still cannot remove a record.
        void operation.then(result => {
            if (expired && !this.stopped && this.entries.has(entry.id)) {
                this.publicationBlocked = false;
                this.journal.markPublished(entry.id);
                this.addPublicationWindows(state, state.attemptedAt, result?.publishedAt);
            }
        }, () => { if (expired) this.publicationBlocked = false; }).catch(error => {
            this.lastError = describe(error);
        });
        try {
            const result = await Promise.race([operation, new Promise((resolve, reject) => {
                timer = setTimeout(() => {
                    expired = true; this.publicationBlocked = true;
                    reject(new Error('local publication deadline; completion unknown; original retained'));
                }, this.publishTimeoutMs);
            })]);
            this.journal.markPublished(entry.id);
            this.addPublicationWindows(state, state.attemptedAt, result?.publishedAt);
        } catch (error) {
            this.publicationErrors++; this.lastError = describe(error);
            if (!expired) this.addPublicationWindows(state, state.attemptedAt, null);
        } finally { clearTimeout(timer); }
    }

    async publishBatch(force) {
        const at = this.now();
        if (this.publicationBlocked || !force && this.lastPublishAt !== null
            && at >= this.lastPublishAt && at - this.lastPublishAt < this.publishIntervalMs) return;
        this.lastPublishAt = at;
        await this.prepareEligibleReplay();
        let batch = await this.journal.readBatch({afterId: this.cursor,
            limit: this.maxPublishPerTick, maxBytes: this.maxBatchBytes});
        if (!Array.isArray(batch)) throw new Error('journal batch must be an array');
        if (!batch.length && this.cursor !== null) {
            this.cursor = null;
            batch = await this.journal.readBatch({afterId: null,
                limit: this.maxPublishPerTick, maxBytes: this.maxBatchBytes});
        }
        if (!Array.isArray(batch) || batch.length > this.maxPublishPerTick)
            throw new Error('journal batch exceeds bounded publication limit');
        const bytes = batch.reduce((sum, entry) => sum
            + (typeof entry?.payload === 'string' ? Buffer.byteLength(entry.payload) : 0), 0);
        if (bytes > this.maxBatchBytes) throw new Error('journal batch exceeds bounded publication bytes');
        if (batch.length) this.cursor = batch.at(-1).id;
        batch.sort((a, b) => a.recordSession === b.recordSession
            ? a.recordSequence - b.recordSequence : String(a.id).localeCompare(String(b.id)));
        for (const entry of batch) {
            if (this.stopped || this.publicationBlocked) break;
            if (entry.confirmedStored === true) continue;
            if (this.entries.has(entry.id) && !this.entries.get(entry.id).needsPublication) continue;
            if (!this.entryValid(entry)) {
                this.lastError = 'invalid journal identity or payload hash; original retained'; continue;
            }
            if (!this.entries.has(entry.id) && this.entries.size >= this.maxTrackedEntries) {
                this.capacityErrors++; this.lastError = 'delivery tracking capacity reached; original retained'; break;
            }
            await this.publishEntry(entry);
        }
    }

    async readWindow(task) {
        const requestedIds = new Set(task.ids);
        const token = {}, controller = new AbortController(), began = performance.now();
        const at = this.now(); this.lastQueryAt = at; this.queryCount++; this.queryActive = true;
        let timer, timedOut = false;
        const query = {verificationId: `decision-record:${randomUUID()}`, start: task.start, end: task.end,
            limit: this.queryLimit, beganAt: at, issued: false, backendCompletionObserved: false,
            parseStatus: 'pending', truncationStatus: 'unknown'};
        const operation = Promise.resolve().then(async () => {
            await this.journal.beginVerification?.({verificationId: query.verificationId,
                start: task.start, end: task.end, limit: this.queryLimit, beganAt: at});
            if (this.stopped || timedOut || controller.signal.aborted) {
                if (typeof this.journal.cancelUnissuedVerification === 'function') {
                    await this.journal.cancelUnissuedVerification({kind: 'locally-never-issued',
                        verificationId: query.verificationId,
                        evidence: 'delivery observed stop/deadline before invoking the SQL transport'});
                    query.localIssuanceCancelled = true;
                } else query.localIssuanceCancelled = typeof this.journal.beginVerification !== 'function';
                const error = new Error('SQL transport was never issued after stop/local deadline');
                error.code = 'EMS_QUERY_NOT_ISSUED'; throw error;
            }
            query.issued = true; this.lastQueryMonotonic = performance.now();
            const response = await this.readHistory({start: task.start,
                end: task.end, limit: this.queryLimit, aggregate: 'none', ignoreNull: false, signal: controller.signal});
            if (response?.backendRequestIssued === false && typeof response.localNotIssuedEvidence === 'string'
                && response.localNotIssuedEvidence.trim()) {
                if (typeof this.journal.cancelUnissuedVerification === 'function') {
                    await this.journal.cancelUnissuedVerification({kind: 'locally-never-issued',
                        verificationId: query.verificationId, evidence: response.localNotIssuedEvidence});
                    query.localIssuanceCancelled = true;
                } else query.localIssuanceCancelled = typeof this.journal.beginVerification !== 'function';
                query.issued = false;
                query.localNotIssuedEvidence = response.localNotIssuedEvidence;
            }
            if (response?.backendCompletionObserved === true && response.backendRequestIssued !== false) {
                query.backendCompletionObserved = true;
                query.backendCompletionEvidence = response.backendCompletionEvidence
                    || 'actual SQL callback marked observed by the injected read-only transport';
                await this.journal.completeVerification?.({kind: 'observed-backend-completion',
                    verificationId: query.verificationId, evidence: query.backendCompletionEvidence});
            }
            return response;
        });
        // A returned connector error/rejected Promise is not evidence that SQL
        // finished. Only an explicit independent completion observation clears
        // a timed-out request, even if the transport eventually settles.
        void operation.then(response => {
            if (this.backendToken === token && (query.localIssuanceCancelled === true
                || response?.backendCompletionObserved === true && response.backendRequestIssued !== false)) {
                this.backendBlocked = false; this.backendToken = null; this.queryActive = false;
            }
        }, error => {
            if (this.backendToken === token && error?.code === 'EMS_QUERY_NOT_ISSUED'
                && query.localIssuanceCancelled === true) {
                this.backendBlocked = false; this.backendToken = null; this.queryActive = false;
            }
        }).catch(() => {});
        try {
            const response = await Promise.race([operation, new Promise((resolve, reject) => {
                timer = setTimeout(() => {
                    timedOut = true; controller.abort();
                    reject(new Error('local query deadline; backend completion unknown; verification stopped'));
                }, this.queryTimeoutMs);
            })]);
            query.backendCompletionObserved = response?.backendCompletionObserved === true
                && response.backendRequestIssued !== false;
            if (response?.error) throw response.error instanceof Error ? response.error : new Error(String(response.error));
            const rows = Array.isArray(response) ? response : response?.result;
            if (!Array.isArray(rows)) throw new Error('history response contains no raw result array');
            query.rows = rows.length;
            if (rows.length > this.queryLimit) throw new Error('history response exceeds the requested row limit');
            query.rawPayloadBytes = rows.reduce((sum, row) => sum
                + (typeof row?.val === 'string' ? Buffer.byteLength(row.val) : 0), 0);
            query.rawPayloadCharacters = rows.reduce((sum, row) => sum
                + (typeof row?.val === 'string' ? row.val.length : 0), 0);
            query.transportBytes = null;
            if (query.rawPayloadBytes > this.maxResponseBytes) throw new Error('history payload byte limit exceeded');
            if (rows.some(row => !row || !Number.isSafeInteger(row.ts)
                || row.ts < task.start || row.ts > task.end || !Object.hasOwn(row, 'val')))
                throw new Error('history contains invalid or outside-window raw rows');
            query.parseStatus = 'raw_rows_valid';
            if (query.backendCompletionObserved !== true) {
                query.outcome = 'completion_unknown';
                task.checkedAt = this.now();
                this.backendBlocked = true; this.backendToken = token;
                this.lastError = 'SQL response has no observed backend completion; verification stopped';
                return false;
            }
            query.malformedPayloads = 0;
            query.nullPayloads = 0;
            query.localCleanupErrors = 0;
            const saturated = rows.length >= this.queryLimit || response?.truncated === true || response?.hasMore === true;
            query.truncationStatus = saturated ? 'limit_or_explicit_truncation' : 'no_limit_observed';
            task.checkedAt = this.now();
            for (const row of rows) {
                if (this.stopped) continue;
                if (row.val === null) { query.nullPayloads++; continue; }
                if (typeof row.val !== 'string') { query.malformedPayloads++; continue; }
                let frame;
                try { frame = JSON.parse(row.val); } catch { query.malformedPayloads++; continue; }
                if (!frame || typeof frame !== 'object' || Array.isArray(frame)) { query.malformedPayloads++; continue; }
                const id = this.identities.get(identity(frame)), entry = this.entries.get(id);
                if (!entry || !requestedIds.has(id) || hash(row.val) !== entry.sha256) continue;
                try {
                    const removed = await this.journal.confirmStored(id, {kind: 'independent-history-match',
                        recordSession: entry.recordSession, recordSequence: entry.recordSequence, sha256: entry.sha256});
                    if (removed !== true) throw new Error('journal did not confirm independently proved removal');
                } catch (error) {
                    // An fsync/health-write failure after successful unlink is
                    // a local cleanup-durability failure. The exact SQL proof
                    // still exists; never retry a now unknown journal ID or
                    // turn the local failure into an SQL completion claim.
                    if (error?.recordRemoved !== true || error?.sqlProofVerified !== true
                        || error?.journalId !== id) throw error;
                    this.localCleanupErrors++; query.localCleanupErrors++;
                    this.lastError = describe(error);
                }
                this.entries.delete(id); this.identities.delete(identity(entry)); this.sqlConfirmed++;
                this.unqueuedProofs.delete(id);
                this.observeStorageProof(entry, row);
                for (const pending of this.windows.values()) pending.ids.delete(id);
            }
            if (!saturated && query.backendCompletionObserved === true) this.observeCompleteMiss(task, requestedIds);
            if (saturated && task.ids.size) {
                this.saturatedWindows++;
                if (task.end - task.start > 1 && task.depth < 12
                    && this.windows.size + 1 <= this.maxQueuedWindows) {
                    const middle = Math.floor((task.start + task.end) / 2);
                    this.windows.delete(task.key);
                    for (const id of task.ids) {
                        this.addWindow(task.start, middle, id, task.depth + 1);
                        this.addWindow(middle, task.end, id, task.depth + 1);
                    }
                } else this.lastError = 'indivisible or capacity-limited saturated history window; SQL proof unknown';
            }
            query.outcome = saturated ? 'limit' : 'complete';
            return true;
        } catch (error) {
            query.outcome = 'error'; query.error = describe(error); query.parseStatus = 'not_confirmed';
            this.queryErrors++; this.lastError = query.error;
            this.backendBlocked = query.localIssuanceCancelled !== true
                && (query.backendCompletionObserved !== true || this.journal.health?.().sqlVerificationPending === true);
            this.backendToken = this.backendBlocked ? token : null;
            task.checkedAt = this.now();
            return false;
        } finally {
            clearTimeout(timer); query.elapsedMs = performance.now() - began;
            query.timedOut = timedOut; this.lastQuery = query;
            this.recentQueries.push({...query});
            if (this.recentQueries.length > 128) this.recentQueries.shift();
            if (!this.backendBlocked || query.backendCompletionObserved === true) this.queryActive = false;
            for (const [key, pending] of this.windows) if (!pending.ids.size) this.windows.delete(key);
        }
    }

    async verifyWindows(force) {
        const visited = new Set();
        try {
            for (let n = 0; n < this.maxQueriesPerTick && !this.stopped && !this.backendBlocked; n++) {
                const at = this.now();
                const task = [...this.windows.values()].find(w => w.ids.size && !visited.has(w.key)
                    && (w.checkedAt === null || force || at < w.checkedAt || at - w.checkedAt >= this.checkIntervalMs));
                if (!task) break;
                const gap = this.lastQueryMonotonic === null ? 0
                    : Math.max(0, this.minQueryGapMs - (performance.now() - this.lastQueryMonotonic));
                if (gap > 0) {
                    await this.wait(gap);
                    if (this.stopped || this.backendBlocked) break;
                }
                visited.add(task.key);
                if (!await this.readWindow(task)) break;
            }
        } catch (error) { this.lastError = describe(error); }
        finally { this.verificationBusy = false; }
    }

    async tick({force = false} = {}) {
        if (this.stopped) return this.health();
        if (!this.publishBusy) {
            this.publishBusy = true;
            try {this.repairWindows(); await this.publishBatch(force);}
            catch (error) {this.lastError = describe(error);}
            finally {this.publishBusy = false;}
        }
        if (!this.stopped && !this.verificationBusy && !this.replayPreparing) {
            this.verificationBusy = true;
            await this.verifyWindows(force);
        }
        return this.health();
    }
}

module.exports = DecisionRecordDelivery;
