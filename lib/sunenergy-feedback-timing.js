'use strict';

const {parseHeadSnapshot} = require('./sunenergy-heads');

// Source resolution for a visible GP change. This is independent of the
// regulation deadband and is reduced for movements smaller than 5 W.
const GP_NOISE_W = 5;

function check(state, reason = null) {
    return {state, reason, latency_ms: null, deviceTs: null, sourceTs: null, receivedAt: null};
}

function waiting(value) {
    return value.state === 'waiting' || value.state === 'transport-pending';
}

function unknownPending(timing, reason) {
    return {...timing, gsEcho: waiting(timing.gsEcho) ? check('unknown', reason) : timing.gsEcho,
        gpResponse: waiting(timing.gpResponse) ? check('unknown', reason) : timing.gpResponse};
}

function hasAcquisition(head, feedback, now, maxAgeMs) {
    const driver = `system.adapter.${head.baseId.split('.heads.')[0]}`;
    return feedback.valid && feedback.sourceFrom === driver && feedback.deviceTs > 0
        && feedback.deviceTs <= now && feedback.deviceTs <= feedback.sourceTs
        && now - feedback.deviceTs <= maxAgeMs;
}

// One latest command per configured head. Exported timings are copied into the
// existing DecisionRecord; the driver reply itself stays in the input cache.
class SunEnergyFeedbackTiming {
    constructor() { this.commands = new Map(); }

    start(head, event, raw, onlineState, {maxAgeMs, timeoutMs}) {
        const {at, commandId, value} = event;
        const prior = this.commands.get(head.setpointId);
        const previous = prior?.timing;
        const baseline = parseHeadSnapshot(raw, {now: at, maxAgeMs, index: head.index, onlineState});
        // A later DB publication can reuse the previous device timestamp.
        // A contradictory copy or an older acquisition cannot be a baseline.
        const last = prior?.latestFeedback;
        const repeatsLast = last && baseline.deviceTs === last.deviceTs;
        const usable = hasAcquisition(head, baseline, at, maxAgeMs) && (!last || baseline.deviceTs > last.deviceTs
            || repeatsLast && baseline.gsW === last.gsW && baseline.acPowerW === last.acPowerW);
        const movementW = usable ? -value - baseline.acPowerW : null;
        // An earlier unconfirmed write can still apply. If only its power is
        // outstanding, a new GS echo remains attributable but a GP step can
        // still belong to the previous request.
        const previousEchoUnresolved = previous && (baseline.deviceTs <= previous.issuedAt
            || baseline.gsW !== previous.requestedGS_W || previous.transportCompletedAt === null);
        const previousPowerUnsettled = previous && (previousEchoUnresolved
            || Math.abs(baseline.acPowerW + previous.requestedGS_W) > GP_NOISE_W);
        const before = usable ? {deviceTs: baseline.deviceTs, sourceTs: baseline.sourceTs,
            gs_W: baseline.gsW, gpInternal_W: baseline.acPowerW} : null;
        const gsEcho = !usable ? check('unknown', 'missing-baseline')
            : baseline.gsW === value ? check('unknown', 'already-reported')
                : previousEchoUnresolved ? check('unknown', 'overlapping-command') : check('transport-pending');
        let gpResponse = gsEcho;
        if (usable && movementW === 0) gpResponse = check('unknown', 'already-at-power');
        else if (waiting(gsEcho) && previousPowerUnsettled) gpResponse = check('unknown', 'overlapping-command');
        else if (waiting(gsEcho) && Math.sign(movementW) !== Math.sign(baseline.gsW - value))
            gpResponse = check('unknown', 'power-past-target');
        const timing = {head: head.index, commandId, issuedAt: at, requestedGS_W: value,
            transportCompletedAt: null, deadlineAt: at + timeoutMs, baseline: before, gsEcho, gpResponse};
        const superseded = previous && unknownPending(previous, at > previous.deadlineAt ? 'feedback-timeout' : 'superseded');
        this.commands.set(head.setpointId, {timing, movementW,
            latestFeedback: usable ? {deviceTs: baseline.deviceTs, gsW: baseline.gsW, acPowerW: baseline.acPowerW} : last,
            echo: null, response: null, superseded: superseded && (superseded.gsEcho !== previous.gsEcho
                || superseded.gpResponse !== previous.gpResponse) ? superseded : null});
        if (this.commands.size > 3) this.commands.delete(this.commands.keys().next().value);
    }

    finish(id, token, stage, at) {
        const command = this.commands.get(id);
        if (!command || command.timing.commandId !== token) return;
        if (stage === 'transport_error') {
            command.timing.gsEcho = check('unknown', 'transport-error');
            command.timing.gpResponse = check('unknown', 'transport-error');
            command.echo = null;
            command.response = null;
        } else if (stage === 'transport_complete') {
            command.timing.transportCompletedAt = at;
            for (const key of ['gsEcho', 'gpResponse'])
                if (command.timing[key].state === 'transport-pending') command.timing[key] = check('waiting');
            this.applyFeedback(command);
        }
        const superseded = command.superseded;
        command.superseded = null;
        return superseded;
    }

    applyFeedback(command) {
        const {timing, echo, response} = command;
        if (echo && timing.gsEcho.state === 'waiting') timing.gsEcho = echo;
        if (response && timing.gpResponse.state === 'waiting' && timing.gsEcho.state === 'observed')
            timing.gpResponse = response;
        if (command.latestFeedback?.deviceTs > timing.deadlineAt)
            command.timing = unknownPending(timing, 'feedback-timeout');
    }

    observe(head, feedback, receivedAt, maxAgeMs) {
        const command = this.commands.get(head.setpointId);
        if (!command) return null;
        const {timing, movementW} = command;
        if (!hasAcquisition(head, feedback, receivedAt, maxAgeMs)
            || feedback.deviceTs <= timing.issuedAt || feedback.deviceTs <= command.latestFeedback?.deviceTs)
            return this.latest(head.setpointId, receivedAt);
        command.latestFeedback = {deviceTs: feedback.deviceTs, gsW: feedback.gsW, acPowerW: feedback.acPowerW};
        if (feedback.deviceTs <= timing.deadlineAt) {
            const matchingGS = feedback.gsW === timing.requestedGS_W;
            // The driver can publish both observations before the DB callback.
            // Store their original times and commit only on transport success.
            const observed = {state: 'observed', reason: null, latency_ms: feedback.deviceTs - timing.issuedAt,
                deviceTs: feedback.deviceTs, sourceTs: feedback.sourceTs, receivedAt};
            if (matchingGS && waiting(timing.gsEcho)) command.echo ??= observed;
            if (waiting(timing.gpResponse)) {
                if (!matchingGS && (command.echo || feedback.gsW !== timing.baseline.gs_W)) {
                    timing.gpResponse = check('unknown', 'unexpected-gs');
                    command.response = null;
                } else if ((feedback.acPowerW - timing.baseline.gpInternal_W) * Math.sign(movementW)
                    >= Math.min(GP_NOISE_W, Math.abs(movementW))) {
                    command.response ??= {...observed, powerInternal_W: feedback.acPowerW};
                }
            }
        }
        if (timing.transportCompletedAt !== null) this.applyFeedback(command);
        return this.latest(head.setpointId, receivedAt);
    }

    foreignWrite(id) {
        const command = this.commands.get(id);
        if (!command) return null;
        const {timing} = command;
        command.echo = null;
        command.response = null;
        command.timing = unknownPending(timing, 'foreign-write');
        return command.timing.gsEcho !== timing.gsEcho || command.timing.gpResponse !== timing.gpResponse
            ? command.timing : null;
    }

    latest(id, now) {
        const timing = this.commands.get(id)?.timing;
        return timing && (now > timing.deadlineAt && (waiting(timing.gsEcho) || waiting(timing.gpResponse))
            ? unknownPending(timing, 'feedback-timeout') : timing);
    }
}

module.exports = SunEnergyFeedbackTiming;
