'use strict';

// A write-only Modbus reset is a command-processing receipt, never a power
// readback. Keep it separate from both the database callback and physical proof.
class HeaterWriteProof {
    constructor(namespace, now = Date.now) {
        this.owner = `system.adapter.${namespace}`;
        this.now = now;
        this.entries = new Map();
        this.sequence = 0;
    }

    configure(id, object) {
        const match = /^(modbus\.\d+)\.holdingRegisters\./.exec(id);
        const eligible = match && object?.type === 'state'
            && object.common?.type === 'number' && object.common.write === true
            && object.common.read === false && object.native?.poll === false
            && object.native.regType === 'holdingRegs';
        if (!eligible) {this.invalidate(id); return;}
        if (!this.entries.has(id)) this.entries.set(id, {from: `system.adapter.${match[1]}`, blocked: false});
        this.entries.get(id).enabled = true;
    }

    invalidate(id) {
        const entry = this.entries.get(id);
        if (!entry) return;
        // Metadata refresh must not erase an unresolved in-flight command.
        if (entry.pending) this.block(entry, 'metadata-invalidated-with-open-write');
        entry.enabled = false;
        entry.pending = null;
        entry.last = null;
        entry.episode = null;
        entry.receipt = null;
    }

    begin(id, watts) {
        const entry = this.entries.get(id);
        if (!entry?.enabled) return null;
        // An ACK cannot identify which of two outstanding writes it belongs
        // to. Preserve this uncertainty for the rest of this EMS process.
        if (entry.pending) this.block(entry, 'overlapping-write');
        if (watts !== 0) {entry.episode = null; entry.receipt = null;}
        const token = {sequence: ++this.sequence, watts, startedAt: this.now(), commandTs: null,
            ackTs: null, transportCompletedAt: null};
        entry.pending = token;
        entry.last = token;
        return token;
    }

    transportFailed(id, token) {
        const entry = this.entries.get(id);
        if (entry && token) this.block(entry, 'transport-error');
    }

    transportCompleted(id, token) {
        const entry = this.entries.get(id);
        if (!entry?.enabled || !token || entry.last !== token) return;
        token.transportCompletedAt = this.now();
        this.completeReceipt(entry, token);
    }

    block(entry, reason) {
        entry.blocked = true;
        entry.reason ||= reason;
        entry.episode = null;
        entry.receipt = null;
    }

    completeReceipt(entry, token) {
        if (token.ackTs === null || token.transportCompletedAt === null) return;
        entry.pending = null;
        if (entry.blocked || token.watts !== 0) return;
        entry.receipt = {kind: 'write-only-modbus-reset', sequence: token.sequence,
            startedAt: token.startedAt, commandTs: token.commandTs, ackTs: token.ackTs,
            transportCompletedAt: token.transportCompletedAt};
        // This identity belongs to the uninterrupted zero-command episode,
        // not to its periodic refresh writes. Every refresh still needs its
        // own transport completion and independently correlated Modbus reset.
        entry.episode ||= {...entry.receipt};
    }

    observe(id, state) {
        const entry = this.entries.get(id);
        if (!entry?.enabled) return;
        const token = entry.pending;
        const ts = Number(state?.ts);
        if (!state || !Number.isFinite(ts) || ts > this.now()
            || (state.q !== undefined && state.q !== 0)) {this.block(entry, 'invalid-state'); return;}
        if (state.ack === false) {
            if (!token || state.from !== this.owner || state.val !== token.watts
                || ts < token.startedAt || token.commandTs !== null) {
                this.block(entry, 'unmatched-command'); return;
            }
            token.commandTs = ts;
        } else if (token && state.ack === true) {
            if (state.from !== entry.from || state.val !== null || token.commandTs === null
                || ts <= token.commandTs || (token.ackTs !== null && ts !== token.ackTs)) {
                this.block(entry, 'unmatched-reset'); return;
            }
            token.ackTs = ts;
            this.completeReceipt(entry, token);
        } else if (entry.last && state.ack === true
            && (state.from !== entry.from || state.val !== null || ts !== entry.last.ackTs)) {
            // A later unexplained reset cannot be borrowed as our receipt.
            this.block(entry, 'unexplained-reset');
        }
    }

    zeroStatus(id, state) {
        const entry = this.entries.get(id), token = entry?.last;
        const context = {episode: entry?.episode ? {...entry.episode} : null,
            receipt: entry?.receipt ? {...entry.receipt} : null,
            transportCompletedAt: token?.transportCompletedAt ?? null};
        if (!entry?.enabled) return {status: 'unavailable', reason: 'write-only-metadata-unavailable', ...context};
        if (entry.blocked) return {status: 'blocked', reason: entry.reason || 'ambiguous-write', ...context};
        if (!token || token.watts !== 0)
            return {status: 'unavailable', reason: 'no-zero-command', ...context};
        if (entry.pending) return {status: 'pending', reason: token.transportCompletedAt === null
            ? 'transport-pending' : 'reset-pending', ...context};
        if (state?.val !== null || state.ack !== true
            || state.from !== entry.from || Number(state.ts) !== token.ackTs
            || (state.q !== undefined && state.q !== 0))
            return {status: 'blocked', reason: 'current-reset-mismatch', ...context};
        return {status: 'ready', reason: 'correlated-zero-complete', ...context};
    }

    zeroProof(id, state) {
        const status = this.zeroStatus(id, state);
        return status.status === 'ready' ? status.receipt : null;
    }
}

module.exports = {HeaterWriteProof};
