"use strict";

const fs = require("fs");
const path = require("path");
const vm = require("vm");
const schedule = require("node-schedule");
const utils = require("@iobroker/adapter-core");

class EmsOptimizer extends utils.Adapter {
    constructor(options = {}) {
        super({...options, name: "ems-optimizer"});
        this.stateCache = new Map();
        this.knownObjects = new Set();
        this.objectPromises = new Map();
        this.listeners = [];
        this.jobs = [];
        this.timers = new Set();
        this.engineContext = null;
        this.on("ready", this.onReady.bind(this));
        this.on("stateChange", this.onStateChange.bind(this));
        this.on("unload", this.onUnload.bind(this));
    }

    async onReady() {
        await this.setStateAsync("info.connection", false, true);
        await this.preloadStates();
        await this.startEngine();
        await this.setStateAsync("info.connection", true, true);
        this.log.info("EMS Optimizer 0.8.0 started with dynamic two-speed simulation controllers");
    }

    async preloadStates() {
        const mapping = this.readMapping();
        const configured = Object.values(mapping).filter(value => typeof value === "string" && value);
        const patterns = [...new Set([
            `${this.namespace}.*`,
            ...configured,
            ...configured.map(id => `${id}.*`)
        ])];
        for (const pattern of patterns) {
            try {
                const states = await this.getForeignStatesAsync(pattern);
                for (const [id, state] of Object.entries(states || {})) {
                    this.stateCache.set(id, state);
                    this.knownObjects.add(id);
                }
                await this.subscribeForeignStatesAsync(pattern);
            } catch (error) {
                this.log.debug(`Preload skipped for ${pattern}: ${error.message}`);
            }
        }
    }

    readMapping() {
        try {
            const value = JSON.parse(String(this.config.dataPointMapJson || "{}"));
            const mapping = value && typeof value === "object" && !Array.isArray(value) ? value : {};
            const defaults = {
                DP_WB0_MIN_SOC: "javascript.0.ev.socmin0",
                DP_WB1_MIN_SOC: "javascript.0.ev.socmin1",
                DP_WB2_MIN_SOC: "javascript.0.ev.socmin2",
                DP_WB0_ALLOW: "javascript.0.ev.alw0",
                DP_WB1_ALLOW: "javascript.0.ev.alw1",
                DP_WB2_ALLOW: "javascript.0.ev.alw2",
                DP_WB0_PHASES: "javascript.0.ev.pha0",
                DP_WB1_PHASES: "javascript.0.ev.pha1",
                DP_WB2_PHASES: "javascript.0.ev.pha2",
                DP_DHW_RELEASE: "javascript.0.ehz.freigabe",
                DP_DHW_OUTLET_TEMP: "modbus.4.holdingRegisters.1001_Temp1",
                DP_DHW_CONNECTION: "modbus.4.info.connection",
                DP_WB_PRIORITY: "javascript.0.ev.prio"
            };
            for (let wb = 0; wb < 3; wb++) {
                for (let phase = 1; phase <= 3; phase++) {
                    defaults[`DP_WB${wb}_L${phase}_A`] = `go-e.${wb}.energy.phase${phase}.ampere`;
                }
            }
            for (const [key, fallback] of Object.entries(defaults)) {
                if (!mapping[key]) mapping[key] = fallback;
            }
            return mapping;
        } catch (error) {
            this.log.error(`Invalid dataPointMapJson: ${error.message}`);
            return {};
        }
    }

    ownRelative(id) {
        return id === this.namespace ? "" : id.startsWith(`${this.namespace}.`)
            ? id.slice(this.namespace.length + 1) : null;
    }

    getCachedState(id) {
        return this.stateCache.get(id) || null;
    }

    async createCompatState(id, initialValue, common = {}) {
        const relative = this.ownRelative(id);
        if (relative === null) return;
        try {
            await this.setObjectNotExistsAsync(relative, {
                type: "state",
                common: {
                    name: common.name || relative,
                    type: common.type || typeof initialValue,
                    role: common.role || "state",
                    read: common.read !== false,
                    write: common.write === true,
                    ...(common.unit ? {unit: common.unit} : {})
                },
                native: {}
            });
            this.knownObjects.add(id);
            const existing = await this.getStateAsync(relative);
            if (!existing) {
                await this.setStateAsync(relative, initialValue, true);
                this.stateCache.set(id, {val: initialValue, ack: true, ts: Date.now()});
            } else {
                this.stateCache.set(id, existing);
            }
        } catch (error) {
            this.log.warn(`Cannot create ${id}: ${error.message}`);
        }
    }

    queueCompatState(id, initialValue, common = {}) {
        if (!this.objectPromises.has(id)) {
            const pending = this.createCompatState(id, initialValue, common)
                .finally(() => this.objectPromises.delete(id));
            this.objectPromises.set(id, pending);
        }
        return this.objectPromises.get(id);
    }

    setCompatState(id, value, ack = true) {
        const now = Date.now();
        this.stateCache.set(id, {val: value, ack: Boolean(ack), ts: now, lc: now});
        const relative = this.ownRelative(id);
        const ready = this.objectPromises.get(id) || Promise.resolve();
        const promise = relative === null ? Promise.resolve() : ready.then(() =>
            this.setStateAsync(relative, value, Boolean(ack)));
        void promise.catch(error => this.log.warn(`Cannot write ${id}: ${error.message}`));
    }

    registerListener(options, callback) {
        const ids = Array.isArray(options?.id) ? options.id : [options?.id].filter(Boolean);
        this.listeners.push({ids: new Set(ids), change: options?.change || "any", callback});
        for (const id of ids) void this.subscribeForeignStatesAsync(id);
        return {ids};
    }

    registerSchedule(expression, callback) {
        const job = schedule.scheduleJob(expression, callback);
        if (job) this.jobs.push(job);
        return job;
    }

    compatSendTo(instance, command, message, callback) {
        const send = () => this.sendTo(instance, command, message, response => {
            if (typeof callback === "function") callback(response);
        });
        const pending = command === "enableHistory" && message?.id
            ? this.objectPromises.get(message.id) : null;
        if (pending) {
            void pending.then(send).catch(error =>
                this.log.warn(`Cannot enable history for ${message.id}: ${error.message}`));
        } else {
            send();
        }
    }

    async startEngine() {
        const enginePaths = [
            "core.js",
            "history.js",
            "forecast.js",
            "vehicles.js",
            "dhw-controller.js",
            "planner.js",
            "observer.js",
            "realtime.js",
            "bootstrap.js"
        ].map(file => path.join(__dirname, "lib", "engine", file));
        const mapping = this.readMapping();
        const adapter = this;
        const sandbox = {
            console,
            Date,
            JSON,
            Math,
            Number,
            String,
            Boolean,
            Array,
            Object,
            Map,
            Set,
            Promise,
            Infinity,
            NaN,
            parseInt,
            parseFloat,
            isNaN,
            getState(id) { return adapter.getCachedState(id); },
            existsState(id) { return adapter.knownObjects.has(id) || adapter.stateCache.has(id); },
            createState(id, value, common) { void adapter.queueCompatState(id, value, common); },
            setState(id, value, ack) { adapter.setCompatState(id, value, ack); },
            sendTo(instance, command, message, callback) {
                adapter.compatSendTo(instance, command, message, callback);
            },
            schedule(expression, callback) { return adapter.registerSchedule(expression, callback); },
            on(options, callback) { return adapter.registerListener(options, callback); },
            log(message, level = "info") {
                const fn = typeof adapter.log[level] === "function" ? level : "info";
                adapter.log[fn](String(message));
            },
            setTimeout(callback, delay, ...args) {
                const timer = setTimeout(() => {
                    adapter.timers.delete(timer);
                    callback(...args);
                }, delay);
                adapter.timers.add(timer);
                return timer;
            },
            clearTimeout(timer) {
                clearTimeout(timer);
                adapter.timers.delete(timer);
            }
        };
        this.engineContext = vm.createContext(sandbox, {name: "ems-observer-engine"});
        for (const enginePath of enginePaths) {
            let source = fs.readFileSync(enginePath, "utf8")
                .replaceAll("__ADAPTER_ROOT__", this.namespace);
            for (const token of source.match(/__[A-Z0-9_]+__/g) || []) {
                const key = token.slice(2, -2);
                const raw = mapping[key] ?? "";
                const escaped = String(raw).replaceAll("\\", "\\\\").replaceAll("'", "\\'");
                source = source.replaceAll(token, escaped);
            }
            new vm.Script(source, {filename: enginePath}).runInContext(this.engineContext);
        }
    }

    onStateChange(id, state) {
        const previous = this.stateCache.get(id);
        if (state) this.stateCache.set(id, state);
        else this.stateCache.delete(id);
        for (const listener of this.listeners) {
            if (!listener.ids.has(id) || !state) continue;
            const changed = !previous || previous.val !== state.val;
            if (listener.change === "ne" && !changed) continue;
            try {
                listener.callback({id, state, oldState: previous});
            } catch (error) {
                this.log.warn(`Observer listener failed for ${id}: ${error.message}`);
            }
        }
    }

    onUnload(callback) {
        try {
            for (const job of this.jobs) job.cancel();
            for (const timer of this.timers) clearTimeout(timer);
            this.jobs = [];
            this.timers.clear();
            callback();
        } catch {
            callback();
        }
    }
}

if (require.main !== module) module.exports = options => new EmsOptimizer(options);
else new EmsOptimizer();
