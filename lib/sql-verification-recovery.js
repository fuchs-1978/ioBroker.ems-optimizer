'use strict';

const {randomUUID} = require('node:crypto');
const GRANTS = 'SHOW GRANTS';
const QUIET = "SELECT ID, COMMAND FROM INFORMATION_SCHEMA.PROCESSLIST WHERE ID <> CONNECTION_ID() AND COMMAND <> 'Sleep' LIMIT 129";

function restarted(states, query, now) {
    const {alive, kill, connection, uptime} = states;
    const good = state => state?.ack === true && (state.q === undefined || state.q === 0);
    return good(alive) && alive.val === true && Number.isFinite(alive.ts) && now - alive.ts >= 0
        && now - alive.ts <= 30000 && Number.isFinite(alive.lc) && alive.lc > query.beganAt
        && good(kill) && Number.isInteger(kill.val) && kill.val > 0
        && kill.ts > query.beganAt && kill.ts < alive.lc
        && good(uptime) && Number.isFinite(uptime.val) && uptime.val >= 60
        && Number.isFinite(uptime.ts) && now - uptime.ts >= 0 && now - uptime.ts <= 30000
        && Math.abs(uptime.ts - uptime.val * 1000 - alive.lc) <= 30000
        && good(connection) && connection.val === true && connection.ts >= alive.lc;
}

class SqlVerificationRecovery {
    constructor({journal, delivery, query, states, now = () => Date.now(), timeoutMs = 10000} = {}) {
        Object.assign(this, {journal, delivery, query, states, now, timeoutMs});
        this.busy = false; this.lastAt = null; this.attempts = new Map();
        this.status = {state: 'idle', reason: 'No recovery inspection issued'};
    }

    async inspect(original, sql) {
        const id = `recovery-inspection:${randomUUID()}`, at = this.now();
        await this.journal.beginRecoveryInspection(original.verificationId,
            {verificationId: id, start: at, end: at, limit: 129, beganAt: at});
        let timer;
        const operation = Promise.resolve().then(() => this.query(sql)).then(async response => {
            if (response?.backendRequestIssued === false && response.localNotIssuedEvidence) {
                await this.journal.completeRecoveryInspection(id);
                throw new Error('Recovery inspection was locally never issued');
            }
            if (response?.backendCompletionObserved !== true)
                throw new Error('Recovery inspection backend completion unknown');
            await this.journal.completeRecoveryInspection(id);
            if (response.error) throw new Error('Recovery inspection returned a database error');
            if (!Array.isArray(response.result) || response.result.length > 129
                || Buffer.byteLength(JSON.stringify(response.result)) > 65536)
                throw new Error('Recovery inspection response is not bounded valid rows');
            return response.result;
        });
        // A late actual callback clears only its own inspection fence. It does
        // not free the original history fence or certify any stored record.
        try {
            return await Promise.race([operation, new Promise((resolve, reject) => {
                timer = setTimeout(() => reject(new Error('Recovery inspection deadline; original and inspection remain unknown')), this.timeoutMs);
            })]);
        } finally {clearTimeout(timer);}
    }

    async tick() {
        if (this.busy || this.lastAt !== null && this.now() - this.lastAt < 60000) return this.status;
        const health = this.journal.health(), original = health.sqlVerificationQuery;
        if (!health.sqlVerificationPending) return this.status = {state: 'idle', reason: 'No unresolved history request'};
        if (!original || health.sqlVerificationUnknown || health.sqlRecoveryInspection)
            return this.status = {state: 'blocked', reason: 'Original or recovery inspection completion unknown'};
        this.busy = true;
        try {
            const before = await this.states();
            if (!restarted(before, original, this.now()) || this.now() - before.alive.lc < 60000)
                return this.status = {state: 'blocked', reason: 'No observed later SQL process termination/restart and stable connection'};
            const attempts = this.attempts.get(original.verificationId) || 0;
            if (attempts >= 3) return this.status = {state: 'blocked', reason: 'Bounded recovery inspection attempts exhausted'};
            this.lastAt = this.now(); this.attempts.set(original.verificationId, attempts + 1);
            if (this.attempts.size > 16) this.attempts.delete(this.attempts.keys().next().value);
            const grants = await this.inspect(original, GRANTS);
            const globalProcess = grants.some(row => Object.values(row).some(value => typeof value === 'string'
                && /GRANT\s+(?:ALL PRIVILEGES|[^;]*\bPROCESS\b[^;]*)\s+ON\s+\*\.\*\s+TO\b/i.test(value.replaceAll('`', ''))));
            if (!globalProcess) return this.status = {state: 'blocked', reason: 'Global PROCESS visibility not proved; no privileges changed'};
            const active = await this.inspect(original, QUIET);
            if (active.length) return this.status = {state: 'blocked', reason: 'Other active database work observed; no history retry'};
            const after = await this.states();
            if (!restarted(after, original, this.now()) || after.alive.lc !== before.alive.lc
                || this.journal.health().sqlVerificationQuery?.verificationId !== original.verificationId)
                return this.status = {state: 'blocked', reason: 'SQL generation or original identity changed during inspection'};
            await this.delivery.recoverBackend({kind: 'observed-backend-completion',
                verificationId: original.verificationId,
                evidence: 'Observed old SQL adapter termination and newer live generation; fresh globally visible processlist has no other active database work'});
            return this.status = {state: 'recovered', at: this.now(), reason: 'Orphan request ended; storage coverage still unknown, ordinary bounded verification resumes'};
        } catch (error) {
            return this.status = {state: 'blocked', reason: String(error.message).slice(0, 300)};
        } finally {this.busy = false;}
    }
}

module.exports = {SqlVerificationRecovery, restarted, GRANTS, QUIET};
