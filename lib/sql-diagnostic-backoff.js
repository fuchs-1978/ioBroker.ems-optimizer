"use strict";

// Diagnostic traffic only: never owns a device, changes SQL settings, or
// interprets a transport callback as persistence. No raw SQL/log payload retained.
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
        const tail = typeof entry.message === 'string' ? entry.message.slice(-2048) : '';
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
        return {degraded: this.degraded, paused: this.paused(), retryAt: this.degraded ? this.until : null,
            failures: this.failures, reason: this.reason, lastFailureAt: this.lastFailureAt,
            lastProofAt: this.lastProofAt, recoveryProof: 'independent-exact-history-match'};
    }
}
module.exports = SqlDiagnosticBackoff;
