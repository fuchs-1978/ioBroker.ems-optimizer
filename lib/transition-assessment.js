'use strict';
// Consumes existing five-second observations. Missed edges stay unknown.
const finite = n => typeof n === 'number' && Number.isFinite(n);
const valid = (m, since, now) => m?.valid === true && m.ack === true && !m.q
    && finite(m.ts) && m.ts > since && m.ts <= now;
const quantile = (values, q) => {
    const sorted = values.filter(finite).sort((a, b) => a - b);
    if (!sorted.length) return null;
    const i = (sorted.length - 1) * q, lo = Math.floor(i);
    return sorted[lo] + (sorted[Math.ceil(i)] - sorted[lo]) * (i - lo);
};
const quiet = (w, since, now) => valid(w.measurements?.power, since, now) && w.actual_W === 0
    && Array.isArray(w.measurements?.phaseCurrents) && w.measurements.phaseCurrents.length === 3
    && w.measurements.phaseCurrents.every(m => valid(m, since, now) && finite(m.val) && m.val >= 0 && m.val <= 0.5);
class TransitionAssessment {
    constructor() {this.previous = null; this.commands = new Map(); this.events = []; this.samples = new Map(); this.phases = new Map(); this.handovers = new Map();}
    add(e) {this.events.push(e); if (this.events.length > 24) this.events.shift();}
    sample(actor, kind, ackMs, electricalMs, transportMs = null) {
        const key = `${actor}:${kind}`, a = this.samples.get(key) || [];
        a.push({ackMs, electricalMs, transportMs}); if (a.length > 64) a.shift(); this.samples.set(key, a);
    }
    observe(s, evidence = {}) {
        if (!finite(s?.ts)) return this.report();
        const now = s.ts, previous = this.previous;
        const continuous = previous && now > previous.ts && now - previous.ts <= 10000;
        if (!continuous) {
            this.commands.clear(); this.phases.clear(); this.handovers.clear();
            if (previous) this.add({at: now, kind: 'coverage-gap', status: 'unknown', reason: 'Abtastlücke oder rückläufige Zeit; offene Ketten verworfen'});
        }
        for (const w of (s.wallboxes || []).slice(0, 3)) {
            const old = previous?.wallboxes?.find(x => x.wb === w.wb);
            const actor = `wallbox${w.wb}`, sent = w.ResponseSentAt, key = `${actor}:${sent}`;
            if (continuous && finite(sent) && sent > previous.ts && sent <= now && old?.ResponseSentAt !== sent) {
                const pending = this.commands.get(actor);
                if (pending) this.add({at: now, actor, kind: 'current', status: 'unknown', reason: 'Noch offene Antwort durch neuen Befehl überholt'});
                this.commands.set(actor, {key, sent, commandA: w.OutputCommand_A,
                    ambiguous: pending?.commandA === w.OutputCommand_A});
            }
            const c = this.commands.get(actor);
            if (c && (w.ResponseSentAt !== c.sent || w.OutputCommand_A !== c.commandA)) {
                this.add({at: now, actor, kind: 'current', status: 'unknown', reason: 'Neuer/überholter Befehl; keine eindeutige Zuordnung'});
                this.commands.delete(actor);
            } else if (c && (w.OutputFault || now - c.sent > 120000)) {
                this.add({at: now, actor, kind: 'current', status: 'aborted', reason: 'Ausgangsstörung oder keine vollständige Antwort innerhalb der Diagnosegrenze'});
                this.commands.delete(actor);
            } else if (c && w.ResponseState === 'confirmed' && w.ResponsePending === false) {
                const ack = w.ResponseAcknowledgedAt, response = w.ResponseConfirmedAt, f = w.measurements?.feedback;
                const proven = !c.ambiguous && finite(ack) && finite(response) && ack >= c.sent && response >= ack && response <= now
                    && valid(f, c.sent, now) && finite(f.val) && Math.abs(f.val - c.commandA) <= 1.5
                    && valid(w.measurements?.power, c.sent, now) && finite(w.actual_W) && w.actual_W > 0;
                this.add({at: now, actor, kind: 'current', status: proven ? 'observed-success' : 'unknown',
                    sentAt: c.sent, ackAt: proven ? ack : null, electricalObservedAt: proven ? response : null,
                    reason: proven ? 'Befehl, unabhängiges Strom-ACK und vom Ausgang bestätigte elektrische Antwort zugeordnet'
                        : 'Bestätigungsstatus ohne vollständige unabhängige Quellenkette'});
                if (proven) {
                    const transport = evidence.wallboxCommands?.[w.wb];
                    const transportMs = transport?.issuedAt === c.sent && transport.value === c.commandA
                        && transport.type === 'command.transport_complete' && finite(transport.at) && transport.at >= c.sent
                        ? transport.at - c.sent : null;
                    this.sample(actor, 'current', ack - c.sent, response - c.sent, transportMs);
                }
                this.commands.delete(actor);
            }
            if (continuous && old && old.PhaseTransitionActive === false && w.PhaseTransitionActive === true)
                this.phases.set(actor, {from: old.ConfirmedPhases, at: now, quiet: false});
            const phase = this.phases.get(actor);
            if (phase) {
                if (valid(w.measurements?.power, phase.at, now) && w.actual_W === 0) phase.quiet = true;
                if (w.PhaseTransitionActive === false) {
                    const currents = w.measurements?.phaseCurrents;
                    const actualPhases = Array.isArray(currents) && currents.length === 3
                        && currents.every(m => valid(m, phase.at, now) && finite(m.val))
                        ? currents.filter(m => m.val > 5).length : null;
                    const success = phase.quiet && [1, 3].includes(w.ConfirmedPhases)
                        && w.ConfirmedPhases !== phase.from && actualPhases === w.ConfirmedPhases
                        && valid(w.measurements?.phaseMode, phase.at, now)
                        && w.measurements.phaseMode.val === (w.ConfirmedPhases === 3 ? 2 : 1)
                        && finite(w.actual_W) && w.actual_W > 0;
                    this.add({at: now, actor, kind: 'phase-change', status: success ? 'observed-success' : 'unknown',
                        from: phase.from, to: w.ConfirmedPhases,
                        reason: success ? 'Beobachtete Umschaltpause, neuer nativer Modus und neue Phasenströme mit Wiederaufnahme'
                            : 'Umschaltmoment oder unabhängige Detailkette nicht vollständig abgetastet'});
                    this.phases.delete(actor);
                }
            }
            if (continuous && old?.OutputActive === true && w.OutputActive === false) {
                const stop = finite(w.StopConfirmedAt) && w.StopConfirmedAt > previous.ts && w.StopConfirmedAt <= now;
                const off = valid(w.measurements?.allow, previous.ts, now) && w.measurements.allow.val === 0;
                const electricallyQuiet = quiet(w, previous.ts, now);
                const reached = w.SoCValid === true && finite(w.SoC_pct) && finite(w.TargetSoC_pct) && w.SoC_pct >= w.TargetSoC_pct;
                this.add({at: now, actor, kind: reached ? 'target-stop' : 'stop', status: stop && off && electricallyQuiet ? 'observed-success' : 'unknown',
                    reason: stop && off && electricallyQuiet ? 'AUS-ACK und elektrische Null im beobachteten Stopp; Reservefreigabe separat'
                        : 'Stoppkante ohne vollständige unabhängige AUS-/Nullkette'});
            }
            if (continuous && old?.OutputActive === false && w.OutputActive === true) {
                const donor = previous.wallboxes?.find(d => d.wb !== w.wb && d.OutputActive === false && d.OutputOwned === false
                    && finite(d.StopConfirmedAt) && d.StopConfirmedAt > previous.ts - 120000 && d.StopConfirmedAt <= previous.ts
                    && valid(d.measurements?.allow, d.StopConfirmedAt - 1, previous.ts) && d.measurements.allow.val === 0
                    && quiet(d, d.StopConfirmedAt - 1, previous.ts));
                if (donor && donor.StopPowerPending === false && donor.OutputReservedPower_W === 0) {
                    this.handovers.set(actor, {donor: donor.wb, donorAt: previous.ts, startedAt: now});

                }
            }
        }
        for (const w of (s.wallboxes || []).slice(0, 3)) {
            const actor = `wallbox${w.wb}`, h = this.handovers.get(actor);
            if (!h) continue;
            const donor = s.wallboxes.find(d => d.wb === h.donor);
            const donorStillQuiet = donor?.OutputActive === false && donor.OutputOwned === false
                && donor.StopPowerPending === false && donor.OutputReservedPower_W === 0 && quiet(donor, h.donorAt - 1, now);
            const receiver = w.OutputOwned === true && w.ResponseState === 'confirmed'
                && valid(w.measurements?.allow, h.donorAt, now) && w.measurements.allow.val === 1
                && valid(w.measurements?.power, h.donorAt, now) && w.actual_W > 0;
            if (donorStillQuiet && receiver) {
                this.add({at: now, actor, donor: `wallbox${h.donor}`, kind: 'handover', status: 'observed-success',
                    reason: 'Empfänger-ACK/Aufnahme nach beobachteter Donor-Ruhe, Rückgabe und freier Reserve'});
                this.handovers.delete(actor);
            } else if (!donorStillQuiet || w.OutputActive === false || now - h.startedAt > 120000) {
                this.add({at: now, actor, kind: 'handover', status: 'unknown', reason: 'Übergabekette abgebrochen oder nicht vollständig zugeordnet'});
                this.handovers.delete(actor);
            }
        }
        const observedCommand = evidence.heaterCommand;
        if (continuous && observedCommand && finite(observedCommand.issuedAt) && observedCommand.issuedAt > previous.ts
            && observedCommand.issuedAt <= now && observedCommand.commandId !== this.heaterPending?.commandId) {
            if (this.heaterPending && this.heaterPending.value === observedCommand.value) this.heaterAmbiguous = observedCommand.value;
            else if (this.heaterAmbiguous !== observedCommand.value) this.heaterAmbiguous = null;
            this.heaterPending = {...observedCommand};
        }
        if (this.heaterPending && observedCommand?.commandId === this.heaterPending.commandId)
            this.heaterPending = {...observedCommand};
        if (!continuous) this.heaterPending = null;
        const command = this.heaterPending;
        if (continuous && command && finite(command.issuedAt) && command.issuedAt <= now
            && command.type === 'command.transport_complete' && finite(command.value) && command.value >= 0) {
            const ack = evidence.heaterAck, receipt = evidence.heaterReceipt;
            const numericAck = ack?.ack === true && !ack.q && finite(ack.ts) && ack.ts > command.issuedAt && ack.ts <= now
                && typeof evidence.heaterDriver === 'string' && ack.from === evidence.heaterDriver && ack.val === command.value;
            const resetAck = command.value === 0 && receipt?.status === 'ready' && finite(receipt.commandTs)
                && receipt.startedAt >= command.issuedAt && receipt.ackTs > receipt.commandTs && receipt.ackTs <= now;
            const ackAt = numericAck ? ack.ts : resetAck ? receipt.ackTs : null;
            const outputs = s.measurements?.ehzOutputs;
            const physical = Array.isArray(outputs) && outputs.length > 0
                && outputs.every(m => valid(m, command.issuedAt, now) && finite(m.val) && m.val >= 0)
                && finite(s.ehz?.actual_W) && Math.abs(s.ehz.actual_W - command.value) <= Math.max(100, command.value * 0.05);
            const success = ackAt !== null && physical && this.heaterAmbiguous !== command.value;
            if (success || now - command.issuedAt > 120000) {
            this.add({at: now, actor: 'ehz', kind: 'power', status: success ? 'observed-success' : 'unknown',
                sentAt: command.issuedAt, ackAt, electricalObservedAt: success ? now : null,
                reason: success ? 'Heizstab-Befehl mit unabhängigem ACK und neuer elektrischer Messung'
                    : 'Heizstab-ACK oder elektrische Antwort nicht vollständig zuordenbar'});
            if (success) this.sample('ehz', 'power', ackAt - command.issuedAt, now - command.issuedAt, command.at - command.issuedAt);
            this.heaterPending = null;
            }
        }
        this.previous = structuredClone({ts: now, wallboxes: (s.wallboxes || []).slice(0, 3)});
        return this.report();
    }
    report() {
        return {events: this.events.slice(), reactions: [...this.samples].map(([actor, a]) => ({actor, count: a.length,
            ackP50Ms: quantile(a.map(x => x.ackMs), 0.5), ackP90Ms: quantile(a.map(x => x.ackMs), 0.9),
            electricalP50Ms: quantile(a.map(x => x.electricalMs), 0.5), electricalP90Ms: quantile(a.map(x => x.electricalMs), 0.9),
            transportP50Ms: quantile(a.map(x => x.transportMs), 0.5)})),
        ehz: {status: this.events.some(e => e.actor === 'ehz' && e.status === 'observed-success') ? 'observed' : 'unknown'},
        scope: 'Begrenzte Stichprobe dieser Sitzung; Empfangs-/Quellenzeiten getrennt, keine Schutzabnahme oder automatische Timeränderung'};
    }
}
module.exports = {TransitionAssessment, quantile};
