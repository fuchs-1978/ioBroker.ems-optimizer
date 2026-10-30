'use strict';

// Admission order is local evidence, never a replacement measurement time.
// Invalid samples invalidate consumers, but cannot poison the ts watermark.
class InputStateCache {
    constructor(cache, receipts, {now = Date.now, log = () => {}} = {}) {
        this.cache = cache;
        this.receipts = receipts;
        this.now = now;
        this.log = log;
        this.entries = new Map();
        this.revision = 0;
        this.rejected = 0;
        this.invalid = 0;
        this.lastRejection = null;
        this.lastLogAt = null;
    }
    beginRead() { return this.revision; }
    accept(id, state, via = 'stateChange', readRevision = null, command = false) {
        const now = this.now(), prior = this.entries.get(id);
        const ts = state?.ts;
        const validTs = typeof ts === 'number' && Number.isFinite(ts) && ts > 0 && ts <= now + 1000;
        const cachedTs = this.cache.get(id)?.ts;
        const watermark = prior ? prior.watermark : (
            typeof cachedTs === 'number' && Number.isFinite(cachedTs) && cachedTs > 0 && cachedTs <= now + 1000 ? cachedTs : 0);
        const reason = readRevision !== null && (prior?.revision || 0) > readRevision
            ? 'read-superseded-by-event' : !command && validTs && ts < watermark ? 'older-source-timestamp' : null;
        if (reason) {
            this.rejected++;
            this.lastRejection = {id: id.slice(0, 512), reason, sourceTs: Number.isFinite(ts) ? ts : null, watermark, observedAt: now, via};
            // One global rate limit, no unbounded per-ID logging map.
            if (this.lastLogAt === null || now - this.lastLogAt >= 60000) {
                this.lastLogAt = now;
                this.log(`Input cache: discarded ${reason} for ${id.slice(0, 512)}; ts=${ts}; watermark=${watermark}; discarded total=${this.rejected}`);
            }
            return false;
        }
        if (state && !validTs) this.invalid++;
        this.entries.set(id, {revision: ++this.revision, watermark: validTs ? Math.max(watermark, ts) : watermark});
        if (state) {
            this.cache.set(id, {...state});
            this.receipts.set(id, {receivedAt: now, via});
        } else {
            this.cache.delete(id);
            this.receipts.delete(id);
        }
        return true;
    }
    report() {
        return {rejected: this.rejected, invalidTimestamps: this.invalid, lastRejection: this.lastRejection};
    }
}
module.exports = {InputStateCache};
