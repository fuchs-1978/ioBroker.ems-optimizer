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
        entry.blocked ||= Boolean(entry.pending);
        entry.enabled = false;
        entry.pending = null;
        entry.last = null;
    }

    begin(id, watts) {
        const entry = this.entries.get(id);
        if (!entry?.enabled) return null;
        // An ACK cannot identify which of two outstanding writes it belongs
        // to. Preserve this uncertainty for the rest of this EMS process.
        if (entry.pending) entry.blocked = true;
        const token = {sequence: ++this.sequence, watts, startedAt: this.now(), commandTs: null, ackTs: null};
        entry.pending = token;
        entry.last = token;
        return token;
    }

    transportFailed(id, token) {
        const entry = this.entries.get(id);
        if (entry && token) entry.blocked = true;
    }

    observe(id, state) {
        const entry = this.entries.get(id);
        if (!entry?.enabled) return;
        const token = entry.pending;
        const ts = Number(state?.ts);
        if (!state || !Number.isFinite(ts) || ts > this.now()
            || (state.q !== undefined && state.q !== 0)) {entry.blocked = true; return;}
        if (state.ack === false) {
            if (!token || state.from !== this.owner || state.val !== token.watts
                || ts < token.startedAt || token.commandTs !== null) {
                entry.blocked = true; return;
            }
            token.commandTs = ts;
        } else if (token && state.ack === true) {
            if (state.from !== entry.from || state.val !== null || token.commandTs === null
                || ts <= token.commandTs) {entry.blocked = true; return;}
            token.ackTs = ts;
            entry.pending = null;
        } else if (entry.last && state.ack === true
            && (state.from !== entry.from || state.val !== null || ts !== entry.last.ackTs)) {
            // A later unexplained reset cannot be borrowed as our receipt.
            entry.blocked = true;
        }
    }

    zeroProof(id, state) {
        const entry = this.entries.get(id), token = entry?.last;
        if (!entry?.enabled || entry.blocked || entry.pending || !token || token.watts !== 0
            || token.ackTs === null || state?.val !== null || state.ack !== true
            || state.from !== entry.from || Number(state.ts) !== token.ackTs
            || (state.q !== undefined && state.q !== 0)) return null;
        return {kind: 'write-only-modbus-reset', sequence: token.sequence,
            startedAt: token.startedAt, commandTs: token.commandTs, ackTs: token.ackTs};
    }
}

module.exports = {HeaterWriteProof};
