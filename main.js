"use strict";

const fs = require("fs");
const path = require("path");
const vm = require("vm");
const schedule = require("node-schedule");
const utils = require("@iobroker/adapter-core");
const WallboxOutput = require("./lib/wallbox-output");
const gridConstraints = require("./lib/grid-constraints");
const {buildNativeMapping, houseConnectionSettings, FIELD_TO_MAPPING,
    WALLBOX_FIELDS} = require("./lib/native-mapping");
const {shouldPreserveWallboxOnUnload} = require("./lib/unload-policy");

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
        this.allowedForeignWriteIds = new Set();
        this.wallboxOutput = new WallboxOutput(this);
        this.on("ready", this.onReady.bind(this));
        this.on("stateChange", this.onStateChange.bind(this));
        this.on("unload", this.onUnload.bind(this));
    }

    async onReady() {
        await this.setStateAsync("info.connection", false, true);
        await this.preloadStates();
        const dhwSetpointId = String(this.config.dhwSetpointId || "").trim();
        if (dhwSetpointId) this.allowedForeignWriteIds.add(dhwSetpointId);
        const dhwActualMirrorId = String(this.config.dhwActualMirrorId || "").trim();
        if (dhwActualMirrorId) this.allowedForeignWriteIds.add(dhwActualMirrorId);
        await this.startEngine();
        await this.applyNativeVehicleSettings();
        await this.applyNativeEmsSettings();
        this.publishMappingStatus();
        await this.wallboxOutput.initialize();
        await this.setStateAsync("info.connection", true, true);
        this.log.info("EMS Optimizer 0.17.0-alpha.10 started; alpha outputs require explicit release");
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
        return buildNativeMapping(this.config,
            message => this.log.error(`Invalid dataPointMapJson: ${message}`));
    }

    publishMappingStatus() {
        const mapping = this.readMapping();
        const explicitKeys = new Set();
        for (const [field, key] of Object.entries(FIELD_TO_MAPPING)) {
            if (String(this.config[field] || "").trim()) explicitKeys.add(key);
        }
        for (let wb = 0; wb < 3; wb++) {
            for (const [suffix, keySuffix] of Object.entries(WALLBOX_FIELDS)) {
                if (String(this.config[`wb${wb}${suffix}`] || "").trim())
                    explicitKeys.add(`DP_WB${wb}_${keySuffix}`);
            }
        }
        const required = ["DP_PV_POWER", "DP_GRID_IMPORT", "DP_GRID_EXPORT"];
        const recommended = ["DP_OUTSIDE_TEMP", "DP_SQL_INSTANCE"];
        const missingRequired = required.filter(key => !String(mapping[key] || "").trim());
        const missingRecommended = recommended.filter(key => !String(mapping[key] || "").trim());
        const status = {
            schema: "AP2-0.17",
            precedence: "explicit admin field > legacy JSON",
            explicit: [...explicitKeys].sort(),
            legacyFallback: Object.keys(mapping).filter(key => !explicitKeys.has(key)).sort(),
            missingRequired,
            missingRecommended,
            valid: missingRequired.length === 0
        };
        this.setCompatState(`${this.namespace}.System.MappingStatus_JSON`,
            JSON.stringify(status), true);
    }

    async applyNativeVehicleSettings() {
        await Promise.all([...this.objectPromises.values()]);
        const defaults = [0, 1, 2].map(wb => ({
            name: `Vehicle ${wb}`, capacity: 50, maxPower: 11000,
            switchPhases: false, min1p: 6, max1p: 16, min3p: 6, max3p: 16
        }));
        for (let wb = 0; wb < 3; wb++) {
            const name = String(this.config[`wb${wb}Name`] || defaults[wb].name);
            const capacity = Number(this.config[`wb${wb}CapacityKWh`] ?? defaults[wb].capacity);
            const maxPower = Number(this.config[`wb${wb}MaxPowerW`] ?? defaults[wb].maxPower);
            const phaseSwitchEnabled = Boolean(this.config[`wb${wb}PhaseSwitchEnabled`] ?? defaults[wb].switchPhases);
            const minCurrent1p = Number(this.config[`wb${wb}MinCurrent1pA`] ?? defaults[wb].min1p);
            const maxCurrent1p = Number(this.config[`wb${wb}MaxCurrent1pA`] ?? defaults[wb].max1p);
            const minCurrent3p = Number(this.config[`wb${wb}MinCurrent3pA`] ?? defaults[wb].min3p);
            const maxCurrent3p = Number(this.config[`wb${wb}MaxCurrent3pA`] ?? defaults[wb].max3p);
            const definitions = [
                [`Vehicles.Wallbox${wb}.VehicleName`, name, {type: "string", role: "text"}],
                [`Vehicles.Wallbox${wb}.MaximumPhases`, phaseSwitchEnabled ? 3 : 1, {type: "number", role: "value"}],
                [`Vehicles.Wallbox${wb}.PhaseSwitchEnabled`, phaseSwitchEnabled, {type: "boolean", role: "indicator"}],
                [`Vehicles.Wallbox${wb}.MinCurrent1P_A`, minCurrent1p, {type: "number", role: "value.current", unit: "A"}],
                [`Vehicles.Wallbox${wb}.MaxCurrent1P_A`, maxCurrent1p, {type: "number", role: "value.current", unit: "A"}],
                [`Vehicles.Wallbox${wb}.MinCurrent3P_A`, minCurrent3p, {type: "number", role: "value.current", unit: "A"}],
                [`Vehicles.Wallbox${wb}.MaxCurrent3P_A`, maxCurrent3p, {type: "number", role: "value.current", unit: "A"}],
                [`Vehicles.Wallbox${wb}.RecommendedPhases`, 1, {type: "number", role: "value"}],
                [`Control.Targets.Wallbox${wb}_Phases`, 1, {type: "number", role: "value"}]
            ];
            definitions.push(
                [`Devices.Wallbox${wb}.Present`, Boolean(this.config[`wb${wb}Present`] ?? true), {type: "boolean", role: "indicator"}],
                [`Devices.Wallbox${wb}.ControlEnabled`, Boolean(this.config[`wb${wb}ControlEnabled`] ?? false), {type: "boolean", role: "indicator"}]
            );
            await Promise.all(definitions.map(([id, value, common]) =>
                this.queueCompatState(`${this.namespace}.${id}`, value, common)));
            this.setCompatState(`${this.namespace}.Vehicles.Wallbox${wb}.VehicleName`, name, true);
            this.setCompatState(`${this.namespace}.Config.Wallbox${wb}VehicleCapacity_kWh`, capacity, true);
            this.setCompatState(`${this.namespace}.Config.Wallbox${wb}MaxPower_W`, maxPower, true);
            this.setCompatState(`${this.namespace}.Vehicles.Wallbox${wb}.MaximumPhases`, phaseSwitchEnabled ? 3 : 1, true);
            this.setCompatState(`${this.namespace}.Vehicles.Wallbox${wb}.PhaseSwitchEnabled`, phaseSwitchEnabled, true);
            this.setCompatState(`${this.namespace}.Vehicles.Wallbox${wb}.MinCurrent1P_A`, minCurrent1p, true);
            this.setCompatState(`${this.namespace}.Vehicles.Wallbox${wb}.MaxCurrent1P_A`, maxCurrent1p, true);
            this.setCompatState(`${this.namespace}.Vehicles.Wallbox${wb}.MinCurrent3P_A`, minCurrent3p, true);
            this.setCompatState(`${this.namespace}.Vehicles.Wallbox${wb}.MaxCurrent3P_A`, maxCurrent3p, true);
            this.setCompatState(`${this.namespace}.Devices.Wallbox${wb}.Present`, Boolean(this.config[`wb${wb}Present`] ?? true), true);
            this.setCompatState(`${this.namespace}.Devices.Wallbox${wb}.ControlEnabled`, Boolean(this.config[`wb${wb}ControlEnabled`] ?? false), true);
        }
    }

    async applyNativeEmsSettings() {
        await Promise.all([...this.objectPromises.values()]);
        const houseConnection = houseConnectionSettings(this.config);
        const settings = {
            BatteryCapacity_kWh: ["batteryCapacityKWh", 10],
            BatteryMaxCharge_W: ["batteryMaxChargeW", 2400],
            BatteryMaxDischarge_W: ["batteryMaxDischargeW", 2400],
            BatteryMinSoC_pct: ["batteryMinSocPct", 0],
            BatteryMaxSoC_pct: ["batteryMaxSocPct", 100],
            BatteryMorningTargetSoC_pct: ["batteryMorningTargetPct", 70],
            BatteryAfternoonTargetSoC_pct: ["batteryAfternoonTargetPct", 90],
            BatteryLateTargetSoC_pct: ["batteryLateTargetPct", 100],
            BatteryFinalChargeReserve_min: ["batteryReserveMin", 45],
            BatteryForecastSafetyFactor_pct: ["batterySafetyPct", 80],
            BatteryEfficiency_pct: ["batteryEfficiencyPct", 92],
            BatterySelfConsumptionEnabled: ["batterySelfConsumption", true],
            DHWVolume_l: ["dhwVolumeL", 500],
            DHWMinTemperature_C: ["dhwMinTempC", 48],
            DHWTargetTemperature_C: ["dhwTargetTempC", 60],
            DHWControllerMaxPower_W: ["dhwMaxPowerW", 9000],
            DHWControllerStopTemperature_C: ["dhwStopTempC", 76],
            DHWControllerResumeTemperature_C: ["dhwResumeTempC", 75.5],
            DHWControllerOutletDerating_C: ["dhwOutletDeratingC", 60],
            DHWControllerOutletProtection_C: ["dhwOutletProtectionC", 76],
            DHWControllerTopEmergencyStop_C: ["dhwTopEmergencyC", 82],
            DHWCurve1Temperature_C: ["dhwCurve1TempC", 70],
            DHWCurve70Power_W: ["dhwCurve70PowerW", 7500],
            DHWCurve2Temperature_C: ["dhwCurve2TempC", 71],
            DHWCurve71Power_W: ["dhwCurve71PowerW", 6000],
            DHWCurve3Temperature_C: ["dhwCurve3TempC", 73],
            DHWCurve73Power_W: ["dhwCurve73PowerW", 4000],
            DHWCurve4Temperature_C: ["dhwCurve4TempC", 74],
            DHWCurve74Power_W: ["dhwCurve74PowerW", 3000],
            DHWMaxStep_W: ["dhwMaxStepW", 1000],
            DHWFastIncreaseMaxStep_W: ["dhwFastIncreaseMaxStepW", 3000],
            DHWSettleTolerance_W: ["dhwSettleToleranceW", 300],
            DHWSettleTimeout_s: ["dhwSettleTimeoutS", 15],
            DHWCommissioningMaxPower_W: ["dhwCommissioningMaxW", 1000],
            HouseConnectionFuse_A: ["houseConnectionFuseA", houseConnection.fuseA],
            HouseConnectionReserve_A: ["houseConnectionReserveA", houseConnection.reserveA],
            HouseConnectionWorkingLimit_A: ["__derivedHouseConnectionWorkingLimitA", houseConnection.increaseLimitA],
            DHWHouseConnectionLimit_A: ["__legacyDhwHouseConnectionLimitA", houseConnection.increaseLimitA],
            DHWTemperatureMaxAge_min: ["dhwTemperatureMaxAgeMin", 60],
            DHWParallelDistributionEnabled: ["dhwParallelDistributionEnabled", true],
            DHWParallelStartPower1P_W: ["dhwParallelStartPower1PW", 4000],
            DHWParallelStopPower1P_W: ["dhwParallelStopPower1PW", 3000],
            DHWParallelStartPower3P_W: ["dhwParallelStartPower3PW", 9000],
            DHWParallelStopPower3P_W: ["dhwParallelStopPower3PW", 8000],
            DHWParallelShare_pct: ["dhwParallelSharePct", 50],
            HeatingBufferVolume_l: ["heatingVolumeL", 400],
            HeatingBufferTemperature_C: ["heatingTempC", 40],
            HeatingBufferMinTemperature_C: ["heatingMinTempC", 35],
            HeatingBufferTargetTemperature_C: ["heatingTargetTempC", 50],
            HeatingControllerMaxPower_W: ["heatingMaxPowerW", 6000],
            SlowControlCycle_s: ["slowCycleS", 5],
            WallboxMaxStep_A: ["wallboxMaxStepA", 6],
            WallboxCombinedMaxStep_A: ["wallboxCombinedMaxStepA", 1],
            WallboxStartReserve_W: ["wallboxStartReserveW", 300],
            WallboxStartDelay_s: ["wallboxStartDelayS", 30],
            WallboxMinimumRunTime_s: ["wallboxMinimumRunTimeS", 120],
            WallboxRestartHandoffSettle_s: ["wallboxRestartHandoffSettleS", 10],
            PhaseSwitchTransition_s: ["phaseSwitchTransitionS", 90],
            DynamicEnergyPriceEnabled: ["dynamicEnergyPrice", false],
            DynamicGridFeeEnabled: ["dynamicGridFee", false],
            FixedEnergyComponent_ct_kWh: ["fixedEnergyCt", 22.85],
            FixedGridFee_ct_kWh: ["fixedGridFeeCt", 6.04],
            DynamicEnergyAdders_ct_kWh: ["dynamicEnergyAddersCt", 9.301]
        };
        for (const [stateName, [nativeName, fallback]] of Object.entries(settings)) {
            const configured = this.config[nativeName];
            const value = configured === undefined || configured === null ? fallback : configured;
            await this.queueCompatState(`${this.namespace}.Config.${stateName}`, fallback, {
                type: typeof fallback, role: typeof fallback === "boolean" ? "switch.enable" : "value",
                write: true
            });
            this.setCompatState(`${this.namespace}.Config.${stateName}`, value, true);
        }
        const controls = {
            Enabled: ["controlEnabled", true],
            TargetGridPower_W: ["targetGridPowerW", -100],
            Deadband_W: ["deadbandW", 100]
        };
        for (const [stateName, [nativeName, fallback]] of Object.entries(controls)) {
            const configured = this.config[nativeName];
            this.setCompatState(`${this.namespace}.Control.${stateName}`,
                configured === undefined || configured === null ? fallback : configured, true);
        }
        const gates = {
            "System.RealOutputsEnabled": ["globalWriteEnabled", false],
            "Control.MultiWallboxAlphaArmed": ["multiWallboxAlphaArmed", false],
            "Control.CombinedProductionArmed": ["combinedProductionArmed", false],
            "Devices.MyPV_DHW.Present": ["dhwPresent", true],
            "Devices.MyPV_DHW.ControlEnabled": ["dhwControlEnabled", false],
            "Devices.MyPV_Heating.Present": ["heatingPresent", false],
            "Devices.MyPV_Heating.ControlEnabled": ["heatingControlEnabled", false],
            "Devices.Battery.Present": ["batteryPresent", false],
            "Devices.Battery.ControlEnabled": ["batteryControlEnabled", false],
            "Devices.HeatPump.Present": ["heatPumpPresent", false],
            "Devices.HeatPump.ControlEnabled": ["heatPumpControlEnabled", false]
        };
        for (const [relativeId, [nativeName, fallback]] of Object.entries(gates)) {
            const value = Boolean(this.config[nativeName] ?? fallback);
            await this.queueCompatState(`${this.namespace}.${relativeId}`, fallback,
                {type: "boolean", role: "indicator"});
            this.setCompatState(`${this.namespace}.${relativeId}`, value, true);
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

    writeForeignStateGuarded(id, value) {
        if (!id || !this.allowedForeignWriteIds.has(id)) {
            this.log.error(`Blocked unconfigured foreign write to ${id || '<empty>'}`);
            return false;
        }
        void this.setForeignStateAsync(id, value, false).catch(error =>
            this.log.error(`Cannot write production output ${id}: ${error.message}`));
        return true;
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
            "config-mapping.js",
            "history.js",
            "forecast.js",
            "vehicles.js",
            "dhw-controller.js",
            "planner.js",
            "observer.js",
            "realtime.js",
            "dhw-output.js",
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
            nativeConfig: Object.freeze({...this.config}),
            Array,
            Object,
            Map,
            Set,
            Promise,
            gridConstraints,
            Infinity,
            NaN,
            parseInt,
            parseFloat,
            isNaN,
            getState(id) { return adapter.getCachedState(id); },
            existsState(id) { return adapter.knownObjects.has(id) || adapter.stateCache.has(id); },
            createState(id, value, common) { void adapter.queueCompatState(id, value, common); },
            setState(id, value, ack) { adapter.setCompatState(id, value, ack); },
            writeForeignState(id, value) { return adapter.writeForeignStateGuarded(id, value); },
            updateWallboxProductionOutput() { void adapter.wallboxOutput.tick(); },
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
        void this.prepareUnload().catch(error =>
            this.log.error(`Cannot prepare safe unload: ${error.message}`)).finally(callback);
    }

    async prepareUnload() {
        this.wallboxOutput.stopping = true;
        for (const job of this.jobs) job.cancel();
        for (const timer of this.timers) clearTimeout(timer);
        this.jobs = [];
        this.timers.clear();
        let instanceObject = null;
        try {
            instanceObject = await this.getForeignObjectAsync(`system.adapter.${this.namespace}`);
        } catch (error) {
            this.log.warn(`Cannot determine restart handoff: ${error.message}`);
        }
        const preserveWallbox = shouldPreserveWallboxOnUnload(this.config, instanceObject,
            this.wallboxOutput.hasActiveOwnedOutput());
        const stops = [];
        let handoffPrepared = false;
        if (preserveWallbox) {
            try {
                const now = Date.now();
                await this.setStateAsync("Control.RestartHandoffActive", true, true);
                await this.setStateAsync("Control.RestartHandoffSince", now, true);
                handoffPrepared = true;
                this.log.info("Adapter restart/update: active EMS-owned wallbox remains on for checked takeover");
            } catch (error) {
                this.log.warn(`Restart handoff cannot be persisted; wallbox will stop: ${error.message}`);
            }
        }
        if (!handoffPrepared) stops.push(this.wallboxOutput.stopAll());
        const globalEnabled = Boolean(
            this.stateCache.get(`${this.namespace}.System.RealOutputsEnabled`)?.val);
        const dhwEnabled = Boolean(
            this.stateCache.get(`${this.namespace}.Devices.MyPV_DHW.ControlEnabled`)?.val);
        const setpointId = String(this.config.dhwSetpointId || "").trim();
        if (globalEnabled && dhwEnabled && setpointId
            && this.allowedForeignWriteIds.has(setpointId)) {
            stops.push(this.setForeignStateAsync(setpointId, 0, false));
        }
        const results = await Promise.allSettled(stops);
        for (const result of results) if (result.status === "rejected")
            this.log.error(`Cannot stop output on unload: ${result.reason}`);
    }
}

if (require.main !== module) module.exports = options => new EmsOptimizer(options);
else new EmsOptimizer();
