"use strict";

const fs = require("fs");
const path = require("path");
const vm = require("vm");
const schedule = require("node-schedule");
const utils = require("@iobroker/adapter-core");
const WallboxOutput = require("./lib/wallbox-output");
const DebugRecorder = require("./lib/debug-recorder");
const gridConstraints = require("./lib/grid-constraints");
const {buildNativeMapping, houseConnectionSettings, FIELD_TO_MAPPING,
    WALLBOX_FIELDS} = require("./lib/native-mapping");
const {shouldPreserveWallboxOnUnload} = require("./lib/unload-policy");
const {EXTENSION_SETTINGS} = require("./lib/extension-settings");
const {OutputMetadata} = require("./lib/output-metadata");

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
        this.zeroOnlyForeignWriteIds = new Set();
        this.pendingForeignWrites = new Set();
        this.foreignWriteQueues = new Map();
        this.foreignWriteGeneration = new Map();
        this.pendingOwnWrites = new Map();
        this.failedOwnWrites = new Set();
        this.unloading = false;
        this.outputInitialization = null;
        this.wallboxOutput = new WallboxOutput(this);
        this.outputMetadata = new OutputMetadata(this);
        this.debugRecorder = new DebugRecorder(this);
        this.debugInitialization = null;
        this.debugWarningAt = null;
        this.on("ready", this.onReady.bind(this));
        this.on("stateChange", this.onStateChange.bind(this));
        this.on("objectChange", id => this.outputMetadata.changed(id));
        this.on("unload", this.onUnload.bind(this));
    }

    async onReady() {
        try {
            await this.initializeAdapter();
        } catch (error) {
            this.log.error(`EMS startup failed; stopping owned outputs: ${error.message}`);
            if (!this.outputInitialization) this.log.error(
                'Output ownership could not yet be validated. Check physical outputs and stop them manually if necessary; do not enable parallel script control.');
            try {
                await this.prepareUnload({allowHandoff: false});
            } catch (cleanupError) {
                this.log.error(`Startup cleanup incomplete; check physical outputs manually: ${cleanupError.message}`);
            }
            try {
                await this.setStateAsync('info.connection', false, true);
            } catch (connectionError) {
                this.log.error(`Cannot publish failed connection: ${connectionError.message}`);
            }
        }
    }

    async initializeAdapter() {
        await this.setStateAsync("info.connection", false, true);
        await this.preloadStates();
        if (this.unloading) return;
        const dhwActualMirrorId = String(this.config.dhwActualMirrorId || "").trim();
        if (dhwActualMirrorId) this.allowedForeignWriteIds.add(dhwActualMirrorId);
        await this.startEngine();
        this.runEngine('createStates(); createBatteryStates(); createHeatingStates(); createHeatPumpStates(); createEnergyCoordinationStates();');
        await Promise.all([...this.objectPromises.values()]);
        await this.applyNativeVehicleSettings();
        await this.applyNativeEmsSettings();
        // Persisted booleans are not evidence of a completed current startup.
        for (const id of ['Plan.Valid', 'Control.Valid', 'System.DataValid'])
            this.setCompatState(`${this.namespace}.${id}`, false, true);
        for (const id of ['Plan.LastUpdate', 'Control.LastUpdate', 'System.LastUpdate'])
            this.setCompatState(`${this.namespace}.${id}`, 0, true);
        await this.flushOwnWrites();
        if (this.unloading) return;
        await this.outputMetadata.refresh();
        if (this.unloading) return;
        this.runEngine('updateVehicles(); updateDhwSimulation(); updateHeatingSimulation(); observe();');
        this.publishMappingStatus();
        this.outputInitialization = this.wallboxOutput.initialize();
        await this.outputInitialization;
        if (this.unloading) return;
        this.runEngine(fs.readFileSync(path.join(__dirname, 'lib/engine/bootstrap.js'), 'utf8'));
        await this.setStateAsync("info.connection", true, true);
        this.log.info("EMS Optimizer 0.17.0-alpha.17 started; alpha outputs require explicit release");
        // Diagnostics must never hold up actuator initialization or scheduling.
        this.debugInitialization = this.startDebug();
    }

    warnDebug(error) {
        const now = Date.now();
        if (this.debugWarningAt === null || now - this.debugWarningAt >= 60000) {
            this.debugWarningAt = now;
            try {
                this.log.warn(`EMS debug recording unavailable (control unchanged): ${error.message || error}`);
            } catch { /* Optional diagnostics must not propagate logger failures. */ }
        }
    }

    runDebug(method, ...args) {
        try {
            return this.debugRecorder?.[method]?.(...args);
        } catch (error) {
            this.warnDebug(error);
            return false;
        }
    }

    async startDebug() {
        try {
            await this.debugRecorder.initialize();
            if (this.unloading) return;
            this.runDebug('sample');
            this.registerSchedule('*/5 * * * * *', () => this.runDebug('sample'));
        } catch (error) {
            this.warnDebug(error);
        }
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
            ...EXTENSION_SETTINGS,
            BatteryCapacity_kWh: ["batteryCapacityKWh", 10],
            BatteryMaxCharge_W: ["batteryMaxChargeW", 2400],
            BatteryMaxDischarge_W: ["batteryMaxDischargeW", 2400],
            BatteryMinSoC_pct: ["batteryMinSocPct", 15],
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
            WallboxStopDelay_s: ["wallboxStopDelayS", 120],
            WallboxRestartHandoffSettle_s: ["wallboxRestartHandoffSettleS", 10],
            WallboxMeasurementMaxAge_s: ["wallboxMeasurementMaxAgeS", 30],
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
        const cachedBeforeCreate = this.stateCache.get(id);
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
                if (this.stateCache.get(id) === cachedBeforeCreate)
                    this.stateCache.set(id, {val: initialValue, ack: true, ts: Date.now()});
            } else {
                // Do not overwrite a newer initialization/configuration write
                // with a persisted value returned by the asynchronous read.
                if (this.stateCache.get(id) === cachedBeforeCreate)
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
        const previous = this.stateCache.get(id);
        const now = Math.max(Date.now(), Number(previous?.ts || 0) + 1);
        const published = {val: value, ack: Boolean(ack), ts: now,
            lc: previous?.val === value ? previous.lc ?? previous.ts ?? now : now};
        this.stateCache.set(id, published);
        const relative = this.ownRelative(id);
        const ready = this.objectPromises.get(id) || Promise.resolve();
        const previousWrite = this.pendingOwnWrites.get(id) || Promise.resolve();
        const promise = relative === null ? Promise.resolve()
            : Promise.all([ready, previousWrite.catch(() => {})]).then(() =>
                // Keep the decision timestamp on the database echo, which can
                // arrive AFTER the write promise resolves and a newer decision.
                this.setStateAsync(relative, published));
        this.pendingOwnWrites.set(id, promise);
        void promise.then(() => this.failedOwnWrites.delete(id), () => this.failedOwnWrites.add(id));
        void promise.finally(() => {
            if (this.pendingOwnWrites.get(id) === promise) this.pendingOwnWrites.delete(id);
        }).catch(() => {});
        void promise.catch(error => {
            if (relative !== null && relative.startsWith('Debug.')) this.warnDebug(error);
            else this.log.warn(`Cannot write ${id}: ${error.message}`);
        });
        if (relative !== null && !relative.startsWith('Debug.'))
            this.runDebug('capture', id, published, previous);
        return promise;
    }

    async flushOwnWrites() {
        // Optional diagnostic persistence must not fail a startup, handoff or
        // safety stop. Debug writes still use the normal per-state echo ordering.
        await Promise.all([...this.pendingOwnWrites.entries()]
            .filter(([id]) => !id.startsWith(`${this.namespace}.Debug.`))
            .map(([, promise]) => promise));
    }

    async flushDebugWrites() {
        const pendingWrites = () => [
            ...[...this.pendingOwnWrites.entries()]
                .filter(([id]) => id.startsWith(`${this.namespace}.Debug.`))
                .map(([, promise]) => promise),
            ...(this.debugRecorder?.writing?.values() || [])
        ];
        if (!pendingWrites().length) return;
        let timeout;
        let expired = false;
        const drain = async () => {
            while (!expired) {
                // A completed recorder write can schedule its one coalesced
                // replacement. Include that final snapshot in the same bound.
                const pending = pendingWrites();
                if (!pending.length) return;
                await Promise.allSettled(pending);
                await Promise.resolve();
            }
        };
        try {
            await Promise.race([drain(),
                new Promise(resolve => { timeout = setTimeout(resolve, 250); })]);
        } finally {
            expired = true;
            clearTimeout(timeout);
        }
    }

    writeForeignStateGuarded(id, value, onComplete) {
        if (!id || !this.allowedForeignWriteIds.has(id)) {
            this.log.error(`Blocked unconfigured foreign write to ${id || '<empty>'}`);
            return false;
        }
        if (typeof value !== 'number' || !Number.isFinite(value)) return false;
        const nonzero = value !== 0;
        const device = id === String(this.config.batterySetpointId || '').trim() ? 'Battery'
            : id === String(this.config.heatingSetpointId || '').trim() ? 'MyPV_Heating'
                : id === String(this.config.dhwSetpointId || '').trim() ? 'MyPV_DHW' : null;
        if (value < 0 && device !== 'Battery') return false;
        if (nonzero && this.zeroOnlyForeignWriteIds.has(id)) return false;
        if (nonzero && (this.unloading || this.config.globalWriteEnabled !== true
            || this.getCachedState(`${this.namespace}.System.RealOutputsEnabled`)?.val !== true))
            return false;
        const ownershipIds = device ? ['OutputOwned', 'OutputSetpointId']
            .map(key => `${this.namespace}.Devices.${device}.${key}`) : [];
        const reservationKeys = device === 'Battery'
            ? ['OutputReservedCharge_W', 'OutputUnobservedCommand_W', 'OutputUnobservedCommandSince']
            : ['OutputReservedPower_W', 'OutputReservedPhase1_W', 'OutputReservedPhase2_W',
                'OutputReservedPhase3_W', 'OutputReservationState_JSON', 'OutputReservationPending'];
        const durableIds = device ? [...ownershipIds, ...reservationKeys.map(key =>
            `${this.namespace}.Devices.${device}.${key}`)] : [];
        // Capture these promises now: a rejected durable ownership claim must
        // not disappear from pendingOwnWrites before a queued GS write runs.
        const ownershipWrites = nonzero ? durableIds.map(key => this.pendingOwnWrites.get(key)).filter(Boolean) : [];
        const generation = (this.foreignWriteGeneration.get(id) || 0) + 1;
        this.foreignWriteGeneration.set(id, generation);
        const previousWrite = this.foreignWriteQueues.get(id) || Promise.resolve();
        const promise = previousWrite.catch(() => {}).then(async () => {
            if (nonzero && device) {
                await Promise.all(ownershipWrites);
                if (durableIds.some(key => this.failedOwnWrites.has(key)))
                    throw new Error('Ausgangsbesitz/Leistungsreserve nach Datenbankfehler noch nicht dauerhaft bestaetigt');
                if (this.getCachedState(ownershipIds[0])?.val !== true
                    || this.getCachedState(ownershipIds[1])?.val !== id)
                    throw new Error('Ausgangsbesitz und Ziel muessen vor dem Stellbefehl dokumentiert sein');
            }
            // Recheck after queued work, immediately before the actual write.
            if (nonzero && (this.unloading || this.config.globalWriteEnabled !== true
                || this.getCachedState(`${this.namespace}.System.RealOutputsEnabled`)?.val !== true))
                throw new Error('Schreibfreigabe vor Ausgabe entzogen');
            // A lower safety budget supersedes an old queued increase just as
            // a stop does. Already in-flight writes cannot be withdrawn, but
            // obsolete queued positive commands must never reach the actuator.
            // Zero commands always retain their place, even before a new start.
            if (nonzero && generation < this.foreignWriteGeneration.get(id))
                throw new Error('Stellbefehl durch neueren Sollwert ueberholt');
            if (nonzero && this.zeroOnlyForeignWriteIds.has(id))
                throw new Error('Frueherer Ausgang nur fuer sichere Null freigegeben');
            if (nonzero && id === String(this.config.dhwSetpointId || '').trim()
                && (this.config.dhwControlEnabled !== true || this.config.dhwPresent === false
                    || ['Present', 'ControlEnabled', 'Release'].some(key =>
                        this.getCachedState(`${this.namespace}.Devices.MyPV_DHW.${key}`)?.val !== true)))
                throw new Error('EHZ-Freigabe vor Ausgabe entzogen');
            if (nonzero && device) {
                const nativePrefix = device === 'Battery' ? 'battery' : device === 'MyPV_DHW' ? 'dhw' : 'heating';
                const base = `${this.namespace}.Devices.${device}`;
                if (this.config[`${nativePrefix}Present`] !== true
                    || this.config[`${nativePrefix}ControlEnabled`] !== true
                    || (device !== 'MyPV_DHW' && this.config[`${nativePrefix}ProductionArmed`] !== true)
                    || ['Present', 'ControlEnabled', 'DriverReady'].some(key => this.getCachedState(`${base}.${key}`)?.val !== true))
                    throw new Error(`${device}: Ausgabefreigabe vor Stellbefehl entzogen`);
                if (this.engineContext && device === 'Battery') {
                    const state = this.runEngine('batteryRegulationState()');
                    if (!state.eligible || (value < 0 ? !state.canCharge : !state.canDischarge))
                        throw new Error(`Speicher vor Ausgabe gesperrt: ${state.reason}`);
                    // GS uses the opposite sign to the internal allocation.
                    // A limit can shrink while a previously valid command is
                    // queued, without changing its release or direction.
                    const maximumW = value < 0 ? state.maxChargeW : state.maxDischargeW;
                    if (!Number.isFinite(maximumW) || maximumW < 0 || Math.abs(value) > maximumW)
                        throw new Error('Speicher-Leistungsgrenze vor Ausgabe reduziert/ungueltig');
                }
                if (device === 'MyPV_Heating') {
                    const thermal = this.engineContext ? this.runEngine('evaluateHeatingSimulation()') : null;
                    if (this.getCachedState(`${this.namespace}.Config.HeatingInhibit`)?.val === true
                        || this.getCachedState(`${base}.Release`)?.val !== true
                        || (thermal && !thermal.release))
                        throw new Error('Heizpuffer-Freigabe/Kuehlsperre vor Ausgabe geaendert');
                    if (thermal && (!Number.isFinite(thermal.thermalCapW)
                        || thermal.thermalCapW < 0 || value > thermal.thermalCapW))
                        throw new Error('Heizpuffer-Leistungsgrenze vor Ausgabe reduziert/ungueltig');
                }
                if (this.engineContext) {
                    const electrical = this.runEngine(`checkQueuedElectricalOutput(${JSON.stringify(device)}, ${value})`);
                    if (!electrical?.allowed)
                        throw new Error(electrical?.reason || 'Elektrische Grenze vor Ausgabe nicht bestaetigt');
                }
            }
            return this.setForeignStateAsync(id, value, false);
        });
        this.foreignWriteQueues.set(id, promise);
        this.pendingForeignWrites.add(promise);
        void promise.then(() => onComplete?.(null), error => {
            this.log.error(`Cannot write production output ${id}: ${error.message}`);
            onComplete?.(error);
        }).catch(error => this.log.warn(`Output callback failed: ${error.message}`))
            .finally(() => {
                this.pendingForeignWrites.delete(promise);
                if (this.foreignWriteQueues.get(id) === promise) this.foreignWriteQueues.delete(id);
            });
        return true;
    }

    registerListener(options, callback) {
        const ids = Array.isArray(options?.id) ? options.id : [options?.id].filter(Boolean);
        this.listeners.push({ids: new Set(ids), change: options?.change || "any", callback});
        for (const id of ids) void this.subscribeForeignStatesAsync(id);
        return {ids};
    }

    registerSchedule(expression, callback) {
        const job = schedule.scheduleJob(expression, () => {
            if (!this.unloading) callback();
        });
        if (job) this.jobs.push(job);
        return job;
    }

    compatSendTo(instance, command, message, callback) {
        const send = () => this.sendTo(instance, command, message, response => {
            if (!this.unloading && typeof callback === "function") callback(response);
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
            "battery-controller.js",
            "heating-controller.js",
            "heatpump-controller.js",
            "energy-coordination.js",
            "planner.js",
            "observer.js",
            "realtime.js",
            "dhw-output.js"
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
            writeForeignState(id, value, onComplete) {
                return adapter.writeForeignStateGuarded(id, value, onComplete);
            },
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
                    if (!adapter.unloading) callback(...args);
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

    runEngine(source) {
        return vm.runInContext(source, this.engineContext);
    }

    onStateChange(id, state) {
        const previous = this.stateCache.get(id);
        if (this.ownRelative(id) !== null && state && previous && state.ack === true
            && (Number(state.ts) < Number(previous.ts)
                || (this.pendingOwnWrites.has(id) && state.val !== previous.val))) return;
        if (state) this.stateCache.set(id, state);
        else this.stateCache.delete(id);
        if (this.unloading) return;
        if (this.runDebug('handleCommand', id, state)) return;
        this.runDebug('capture', id, state, previous);
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

    async prepareUnload({allowHandoff = true} = {}) {
        this.unloading = true;
        this.wallboxOutput.stopping = true;
        for (const job of this.jobs) job.cancel();
        for (const timer of this.timers) clearTimeout(timer);
        this.jobs = [];
        this.timers.clear();
        // Issue independent stops before waiting for any foreign channel.
        // Each actuator queue already orders its own final zero; a stalled
        // storage write must not defer a different heater's stop request.
        if (this.engineContext) {
            for (const stop of ['stopDhwOutput', 'stopBatteryOutput', 'stopHeatingOutput', 'stopHeatPumpOutput']) {
                try {
                    this.runEngine(`if (typeof ${stop} === 'function') ${stop}('Adapter wird beendet');`);
                } catch (error) {
                    this.log.error(`Cannot stop ${stop} on unload: ${error.message}`);
                }
            }
        }
        if (this.outputInitialization) await this.outputInitialization.catch(error =>
            this.log.warn(`Output initialization interrupted: ${error.message}`));
        await this.wallboxOutput.waitForIdle();
        let instanceObject = null;
        try {
            instanceObject = await this.getForeignObjectAsync(`system.adapter.${this.namespace}`);
        } catch (error) {
            this.log.warn(`Cannot determine restart handoff: ${error.message}`);
        }
        const preserveWallbox = allowHandoff && shouldPreserveWallboxOnUnload(this.config, instanceObject,
            this.wallboxOutput.hasActiveOwnedOutput(), this.wallboxOutput.devices
                .filter(d => d.owned).map(d => d.wb));
        const stops = [];
        let handoffPrepared = false;
        if (preserveWallbox) {
            try {
                const now = Date.now();
                await this.setCompatState(`${this.namespace}.Control.RestartHandoffSince`, now, true);
                await this.setCompatState(`${this.namespace}.Control.RestartHandoffActive`, true, true);
                handoffPrepared = true;
                this.log.info("Adapter restart/update: active EMS-owned wallbox remains on for checked takeover");
            } catch (error) {
                this.log.warn(`Restart handoff cannot be persisted; wallbox will stop: ${error.message}`);
            }
        }
        if (!handoffPrepared) {
            stops.push(this.wallboxOutput.stopAll());
            this.setCompatState(`${this.namespace}.Control.RestartHandoffActive`, false, true);
        }
        stops.push(...this.pendingForeignWrites);
        const results = await Promise.allSettled(stops);
        for (const result of results) if (result.status === "rejected")
            this.log.error(`Cannot stop output on unload: ${result.reason}`);
        await this.flushOwnWrites();
        this.runDebug('stop', handoffPrepared ? 'Adapter-Neustart mit gepruefter Wallbox-Uebergabe'
            : 'Adapter beendet; Ausgangsbereinigung abgeschlossen, Rueckmeldungen siehe Snapshot');
        await this.flushDebugWrites();
    }
}

if (require.main !== module) module.exports = options => new EmsOptimizer(options);
else new EmsOptimizer();
