'use strict';

const WallboxOutput = require('./wallbox-output');
const {wallboxResponse, ASSUMPTION} = require('./shadow-wallbox-response');
const ShadowSampleBuffer = require('./shadow-sample-buffer');

// Command acknowledgements and an ideal electrical WB response are private
// assumptions. Real protection inputs, phase mode, car and SoC remain binding.
// In particular a phase change is NEVER acknowledged by this facade.
class ShadowWallboxModel {
    constructor({namespace, config, devices, mapping, states, context, now, violation}) {
        this.now = now;
        this.states = states;
        this.rawStates = new Map(states);
        this.mapping = mapping;
        this.config = config;
        this.response = null;
        this.sampleBuffer = new ShadowSampleBuffer();
        this.responseCoverage = {validMs: 0, invalidMs: 0, unknownMs: 0};
        this.responseCoverageAt = null;
        this.responseCurrents = new Map();
        this.local = new Map();
        this.feedback = new Map();
        this.active = true;
        this.root = `${namespace}.`;
        this.violation = violation;
        const reject = capability => {
            violation(`Nicht erlaubte Schattenfunktion: ${capability}`);
            throw new Error(`Nicht erlaubte Schattenfunktion: ${capability}`);
        };
        const put = (id, value) => {
            if (!this.active) return;
            const state = {val: structuredClone(value), ack: true, ts: now(), q: 0};
            this.local.set(id, state);
            this.states.set(id, structuredClone(state));
        };
        const facade = {
            namespace, config: {...structuredClone(config), globalWriteEnabled: true}, engineContext: context,
            readMapping: () => structuredClone(mapping),
            getCachedState: id => structuredClone(this.states.get(id)),
            setCompatState: async (id, value) => {
                if (!/^Devices\.Wallbox[012]\.[A-Za-z0-9_]+$/.test(id.slice(this.root.length))
                    && !['System.NoActuation', 'Control.Mode', 'Control.RestartHandoffActive'].includes(id.slice(this.root.length)))
                    return reject('unbekannter Modell-State');
                if (!id.startsWith(this.root)) return reject('fremder Modell-State');
                put(id, value);
            },
            setForeignStateAsync: async (id, value) => {
                if (!this.active) return;
                const d = this.output.devices.find(item => [item.ids.command, item.ids.allow].includes(id));
                if (!d || !d.valid || !Number.isFinite(value)) return reject('unbekannter Modell-Aktor');
                const target = id === d.ids.allow ? d.ids.allow : d.ids.feedback;
                if (!target) return reject('fehlende Modell-Rueckmeldung');
                this.feedback.set(target, {val: value, ack: true, ts: now(), q: 0});
                // This Map belongs exclusively to the isolated model. Neither
                // adapter.stateCache nor any real setter is reachable here.
                this.states.set(target, structuredClone(this.feedback.get(target)));
            },
            log: {info() {}, warn() {}, error() {}},
            sendTo: () => reject('Adapterkommando/SQL'),
            getForeignObjectAsync: () => reject('Metadatenzugriff'),
            subscribeForeignStatesAsync: () => reject('Ereignisabo')
        };
        this.output = new WallboxOutput(facade, {now,
            responseCurrentA: wb => this.responseCurrents.get(wb),
            responseEvidence: wb => ({valid: this.response?.valid === true && this.responseCurrents.has(wb),
                assumed: true, currentA: this.responseCurrents.get(wb)}),
            // Grid VALUES remain the counterfactual balance. Its historical
            // timestamps never replace current real protection freshness.
            measurementSource: id => [mapping.DP_GRID_IMPORT, mapping.DP_GRID_EXPORT].includes(id)
                ? this.rawStates.get(id) ?? null : undefined});
        this.output.devices = (devices || []).map(source => ({
            wb: source.wb, ids: structuredClone(source.ids), valid: source.valid === true,
            owned: false, recovering: false, wasOwned: false, wasActive: false,
            recoveredAt: 0, handoffReadySince: 0, activeSince: 0, pending: null,
            lastA: 0, lastAt: 0, shortfallSince: 0, stopRequest: null,
            confirmedFeedback: {}, expectedFeedback: {}, confirmedPhases: 0,
            phaseTransitionUntil: 0, phaseRequest: null, fault: String(source.fault
                || states.get(`${this.root}Devices.Wallbox${source.wb}.OutputFault`)?.val || '')
        }));
        this.output.ready = true;
        for (const d of this.output.devices) {
            for (const [key, value] of Object.entries({OutputOwned: false, OutputActive: false,
                OutputCommand_A: 0, OutputReservedPower_W: 0, StopDelayRemaining_s: 0,
                SequenceResumePending: false, SequenceResumeUntil: 0,
                StopConfirmedAt: 0, StopPowerPending: false,
                ResponseState: 'idle', ResponsePending: false, ResponseRemaining_s: 0,
                ResponseStatus: '', ResponseConfirmedAt: 0, ResponseCommand_A: 0,
                ResponsePreviousCommand_A: 0, ResponseSentAt: 0, ResponseAcknowledgedAt: 0,
                ResponseMeasuredCurrent_A: null, ResponseMeasuredPower_W: null,
                OutputStatus: 'Modell wartet auf ersten Zyklus'})) put(`${this.root}Devices.Wallbox${d.wb}.${key}`, value);
        }
    }

    prepare(states, context) {
        this.states = states;
        this.rawStates = new Map(states);
        this.output.adapter.engineContext = context;
        for (const d of this.output.devices) {
            const fault = states.get(`${this.root}Devices.Wallbox${d.wb}.OutputFault`)?.val;
            if (fault) d.fault = String(fault);
        }
        for (const [id, state] of this.local) this.states.set(id, structuredClone(state));
        const age = this.output.measurementMaxAgeMs();
        for (const [id, state] of this.feedback) {
            const real = states.get(id);
            // An assumed acknowledgement never repairs missing, stale,
            // unacknowledged or bad-quality real actuator telemetry.
            const number = ['number', 'string'].includes(typeof real?.val)
                && String(real.val).trim() !== '' ? Number(real.val) : NaN;
            const device = this.output.devices.find(d => [d.ids.allow, d.ids.feedback].includes(id));
            const validRange = device && (id === device.ids.allow ? [0, 1].includes(number)
                : Number.isInteger(number) && number >= 0 && number <= 32);
            if (real?.ack === true && !real.q && Number.isFinite(number) && Number.isFinite(real.ts)
                && real.ts > 0 && real.ts <= this.now() + 1000 && this.now() - real.ts <= age && validRange)
                this.states.set(id, {...structuredClone(state), ts: this.now()});
        }
    }

    prepareResponse() {
        const at = this.now();
        if (this.responseCoverageAt !== null) {
            const elapsed = Math.max(0, at - this.responseCoverageAt);
            const key = elapsed > 65000 ? 'unknownMs' : this.response?.valid === true ? 'validMs' : 'invalidMs';
            this.responseCoverage[key] += elapsed;
        }
        this.responseCoverageAt = at;
        this.sampleBuffer.capture(this.rawStates, [this.mapping.DP_GRID_IMPORT, this.mapping.DP_GRID_EXPORT,
            ...this.output.devices.map(d => this.mapping[`DP_WB${d.wb}_POWER`])], this.now());
        const prepared = wallboxResponse({states: this.states, rawStates: this.rawStates,
            devices: this.output.devices, mapping: this.mapping,
            namespace: this.output.adapter.namespace, config: this.config, now: this.now(),
            decision: wb => this.decision(wb), sampleBuffer: this.sampleBuffer});
        this.response = prepared.response;
        this.response.coverage = {...this.responseCoverage, since: this.coverageSince ??= at,
            until: at, scope: 'current-model-session'};
        this.responseCurrents = prepared.currents;
    }

    async tick() {
        // A single production cycle per input snapshot preserves the genuine
        // startup stages, ramp timing and stop/minimum-runtime behavior.
        if (this.active) await this.output.tick();
    }

    decision(wb) {
        const d = this.output.devices.find(item => item.wb === wb);
        const read = key => this.states.get(`${this.root}Devices.Wallbox${wb}.${key}`)?.val;
        const active = read('OutputActive') === true;
        const amps = active ? Number(read('OutputCommand_A')) || 0 : 0;
        const phases = Number(read('OutputPhases')) === 3 ? 3 : 1;
        const seconds = Number(this.output.adapter.config.wallboxMinimumRunTimeS ?? 120);
        const runMs = (Number.isFinite(seconds) ? Math.max(0, seconds) : 120) * 1000;
        return {powerW: amps * phases * 230, amps, phases, active, owned: d?.owned === true,
            minimumRunRemainingS: active && d?.activeSince > 0
                ? Math.max(0, Math.ceil((runMs - (this.now() - d.activeSince)) / 1000)) : 0,
            stopDelayRemainingS: Number(read('StopDelayRemaining_s')) || 0,
            phaseSwitchPending: read('PhaseSwitchPending') === true,
            phaseSwitchTimedOut: read('PhaseSwitchTimedOut') === true,
            phaseSwitchRemainingS: Number(read('PhaseSwitchRemaining_s')) || 0,
            responseState: String(read('ResponseState') || 'idle'),
            responsePending: read('ResponsePending') === true,
            responseRemainingS: Number(read('ResponseRemaining_s')) || 0,
            responseStatus: String(read('ResponseStatus') || ''),
            responseConfirmedAt: Number(read('ResponseConfirmedAt')) || 0,
            responseAssumed: true,
            responseCommandA: Number(read('ResponseCommand_A')) || 0,
            responsePreviousCommandA: Number(read('ResponsePreviousCommand_A')) || 0,
            responseSentAt: Number(read('ResponseSentAt')) || 0,
            responseAcknowledgedAt: Number(read('ResponseAcknowledgedAt')) || 0,
            responseMeasuredCurrentA: Number.isFinite(read('ResponseMeasuredCurrent_A'))
                ? read('ResponseMeasuredCurrent_A') : null,
            responseMeasuredPowerW: Number.isFinite(read('ResponseMeasuredPower_W'))
                ? read('ResponseMeasuredPower_W') : null,
            sequenceResumePending: read('SequenceResumePending') === true,
            sequenceResumeUntil: Number(read('SequenceResumeUntil')) || 0,
            stopConfirmedAt: Number(read('StopConfirmedAt')) || 0,
            stopPowerPending: read('StopPowerPending') === true,
            stage: d?.pending?.stage || (active ? 'running' : d?.owned ? 'stopping' : 'off'),
            status: String(read('OutputStatus') || 'Ausgangsmetadaten fehlen').replace(/^PRODUKTIV:/, 'Virtuell aktiv:'),
            assumption: ASSUMPTION};
    }

    stop() { this.active = false; this.local.clear(); this.feedback.clear(); this.responseCurrents.clear(); this.sampleBuffer.clear(); }
}

module.exports = ShadowWallboxModel;
