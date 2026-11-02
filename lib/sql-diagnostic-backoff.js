"use strict";

// Diagnostic traffic only: never owns a device, changes SQL settings, or
// interprets a transport callback as persistence. No raw SQL/log payload retained.
const CONNECTION_ERRORS = Object.freeze({
    ER_HOST_IS_BLOCKED: {reason: 'sql-host-blocked', message: 'Datenbank hat den ioBroker-Host gesperrt'},
    ETIMEDOUT: {reason: 'sql-connect-timeout', message: 'Zeitueberschreitung beim Datenbank-Verbindungsaufbau'},
    ECONNREFUSED: {reason: 'sql-connect-refused', message: 'Datenbank-Verbindung wurde abgelehnt'}
});

function classifyConnectionError(error) {
    const object = error && typeof error === 'object' ? error : null;
    const raw = typeof error === 'string' ? error : typeof object?.message === 'string' ? object.message : '';
    const message = raw.slice(-2048).replace(/^(?:sql\.\d+\s*(?:\(\d+\))?\s*)?(?:Error:\s*)?/i, '').trim();
    let code = null;
    if (object?.code === 'ER_HOST_IS_BLOCKED' || object?.errno === 1129
        || /^ER_HOST_IS_BLOCKED\b/.test(message)
        || /\bcode:\s*ER_HOST_IS_BLOCKED\b/.test(message)
        || /(?:^|\()errno:\s*1129(?:\)|$)/i.test(message)
        || /^Host\s+['"][^\r\n]{1,256}['"]\s+is blocked because of many connection errors/i.test(message))
        code = 'ER_HOST_IS_BLOCKED';
    else for (const candidate of ['ETIMEDOUT', 'ECONNREFUSED']) {
        // A query/transport deadline with this code alone is not evidence of
        // failed database connection setup. Require the connect syscall.
        if (object?.code === candidate && object?.syscall === 'connect'
            || new RegExp(`^connect\\s+${candidate}\\b`, 'i').test(message)) {code = candidate; break;}
    }
    return code ? {code, ...CONNECTION_ERRORS[code]} : null;
}

class SqlDiagnosticBackoff {
    constructor({now = () => Date.now()} = {}) {
        this.now = now; this.failures = 0; this.until = 0; this.lastFailureAt = null;
        this.reason = ''; this.degraded = false; this.lastProofAt = null;
    }
    paused() { return this.degraded && this.now() < this.until; }
    fail(reason = 'sql-query-error') {
        // An error storm must not extend a pause forever or grow retained logs.
        const alreadyPaused = this.paused();
        this.lastFailureAt = this.now();
        if (alreadyPaused) return false;
        this.failures = Math.min(4, this.failures + 1);
        this.until = this.lastFailureAt + Math.min(300000, 60000 * 2 ** (this.failures - 1));
        this.reason = reason; this.degraded = true;
        return true;
    }
    observeLog(entry, instance) {
        if (!/^sql\.\d+$/.test(instance || '') || entry?.from !== instance
            || !['warn', 'error'].includes(entry.severity)) return false;
        const at = Number(entry.ts), age = this.now() - at;
        if (!Number.isFinite(at) || age < -5000 || age > 30000) return false;
        return this.observeError(entry.message);
    }
    observeError(message) {
        const connection = classifyConnectionError(message);
        if (connection) {
            const changed = this.fail(connection.reason);
            // Promote a host block arriving after a timeout in the same error
            // burst, without extending the pause or growing retained payload.
            if (this.reason !== 'sql-host-blocked' || connection.reason === 'sql-host-blocked')
                this.reason = connection.reason;
            return changed;
        }
        const tail = typeof message === 'string' ? message.slice(-2048)
            : typeof message?.message === 'string' ? message.message.slice(-2048) : '';
        if (!/(Cannot insert|Cannot delete|Can't open file|Out of resources|Too many open files)/i.test(tail)) return false;
        return this.fail(/(?:Errcode|errno):?\s*24\b/i.test(tail)
            ? 'sql-open-files-error-24' : 'sql-write-or-retention-error');
    }
    proveStored(sqlTs) {
        // Reading an old stored row does not prove that writing recovered.
        if (this.degraded && (!Number.isSafeInteger(sqlTs) || sqlTs <= this.lastFailureAt
            || sqlTs > this.now() || this.now() - sqlTs > 60000)) return false;
        this.degraded = false; this.until = 0; this.failures = 0;
        this.reason = ''; this.lastProofAt = this.now();
        return true;
    }
    health() {
        const connection = Object.entries(CONNECTION_ERRORS).find(([, value]) => value.reason === this.reason);
        return {degraded: this.degraded, paused: this.paused(), retryAt: this.degraded ? this.until : null,
            failures: this.failures, reason: this.reason, lastFailureAt: this.lastFailureAt,
            ...(connection ? {errorCode: connection[0], message: connection[1].message} : {}),
            lastProofAt: this.lastProofAt, recoveryProof: 'independent-exact-history-match'};
    }
}
SqlDiagnosticBackoff.classifyConnectionError = classifyConnectionError;
SqlDiagnosticBackoff.CONNECTION_ERROR_CODES = Object.freeze(Object.keys(CONNECTION_ERRORS));
module.exports = SqlDiagnosticBackoff;
