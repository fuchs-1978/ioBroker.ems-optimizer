'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const WallboxOutput = require('../lib/wallbox-output');

function setup({now: readNow = () => Date.now(), responseCurrentA = null, responseEvidence = null} = {}) {
    const states = new Map(), writes = [];
    let now = readNow();
    // A test publication follows the previous command within the logical
    // millisecond. Explicit old timestamps remain available for stale-input
    // and pre-command response regressions below.
    const put = (id, val, extra = {}) => states.set(id, {val, ack: true, ts: readNow() + 1, ...extra});
    const mapping = {DP_WB0_CAR: 'car', DP_WB0_SOC: 'soc', DP_WB0_ALLOW: 'userAllow',
        DP_WB0_POWER: 'power', DP_WB0_L1_A: 'i1', DP_WB0_L2_A: 'i2', DP_WB0_L3_A: 'i3',
        DP_GRID_IMPORT: 'import', DP_GRID_EXPORT: 'export', DP_HA_CRITICAL: 'critical',
        DP_PAR14A: 'par14a', DP_LPC_STATE: 'lpc', DP_LPC_LIMIT: 'lpcLimit',
        DP_DHW_PARALLEL_RELEASE: 'split'};
    const config = {globalWriteEnabled: true, wb0Present: true, wb0ControlEnabled: true,
        wb0ProductionArmed: true, wb0PhaseControlMode: 'ems', wb0CommissioningMaxA: 32, wb0MaxCurrent1pA: 32,
        wb0MaxPowerW: 7360, wb0AmpereOutputId: 'cmd', wb0AllowOutputId: 'allow',
        wb0AmpereFeedbackId: 'feedback', wb0ConnectionId: 'connection', wb0ErrorId: 'error',
        dhwHaL1CurrentId: 'h1', dhwHaL2CurrentId: 'h2', dhwHaL3CurrentId: 'h3', slowCycleS: 5,
        par14aActiveHigh: true, par14aLimitW: 4200, wallboxRestartHandoffSettleS: 0};
    const adapter = {namespace: 'ems.0', config, stateCache: states,
        getCachedState: id => states.get(id), readMapping: () => mapping,
        setCompatState: (id, val) => put(id, val),
        setStateAsync: async (id, val) => put(`ems.0.${id}`, val),
        setForeignStateAsync: async (id, val) => { writes.push({id, val}); put(id, val, {ack: false, ts: readNow()}); },
        getForeignStateAsync: async id => states.get(id), subscribeForeignStatesAsync: async () => {},
        getForeignObjectAsync: async () => ({type: 'state', common: {write: true, type: 'number'}}),
        queueCompatState: async (id, val) => { if (!states.has(id)) put(id, val); },
        log: {error: () => {}}};
    for (const key of ['System.RealOutputsEnabled', 'System.DataValid', 'Control.Valid', 'Control.Enabled',
        'Devices.Wallbox0.Present', 'Devices.Wallbox0.ControlEnabled', 'Vehicles.Wallbox0.SoCValid',
        'Vehicles.Wallbox0.Release']) put(`ems.0.${key}`, true);
    put('ems.0.Plan.Valid',true);
    for (const key of ['System.LastUpdate', 'Control.LastUpdate', 'Plan.LastUpdate']) put(`ems.0.${key}`, now);
    put('ems.0.Control.TargetGridPower_W', -100);
    put('ems.0.Actual.MyPV_DHW_W', 0);
    put('ems.0.Control.SelectedWallbox', 0);
    put('ems.0.Control.Targets.Wallbox0_W', 7000);
    put('ems.0.Control.Targets.Wallbox0_Phases', 1);
    put('ems.0.Vehicles.Wallbox0.TargetSoC_pct', 80);
    put('ems.0.Vehicles.Wallbox0.MinimumSoC_pct', 20);
    for (const [id, val] of Object.entries({car: 2, soc: 50, userAllow: true, power: 0,
        i1: 0, i2: 0, i3: 0, h1: 10, h2: 10, h3: 10, import: 0, export: 8000,
        critical: false, par14a: false, lpc: 'unlimitedAutonomous', lpcLimit: 0, connection: true,
        error: 0, allow: 0, feedback: 6, split: 0})) put(id, val);
    const output = new WallboxOutput(adapter, {now: readNow, responseCurrentA, responseEvidence});
    const ack = (id, value) => put(id, value, {ts: readNow() + 1});
    const electricalOff = (wb = 0) => {
        const ids = wb === 0 ? ['power', 'i1', 'i2', 'i3']
            : [`power${wb}`, `i${wb}1`, `i${wb}2`, `i${wb}3`];
        for (const id of ids) put(id, 0, {ts: readNow() + 2});
    };
    const refresh = () => {
        now = readNow();
        for (const [id, s] of states) if (s.ack) put(id, s.val);
        for (const key of ['System.LastUpdate', 'Control.LastUpdate', 'Plan.LastUpdate']) put(`ems.0.${key}`, now);
    };
    const start = async (wb = 0) => {
        const allowId = wb === 0 ? 'allow' : `allow${wb}`;
        const feedbackId = wb === 0 ? 'feedback' : `feedback${wb}`;
        await output.initialize();
        await output.tick(); ack(allowId, 0);
        await output.tick(); ack(feedbackId, 6);
        await output.tick(); ack(allowId, 1);
        await output.tick();
    };
    const enableWallbox = wb => {
        Object.assign(mapping, {
            [`DP_WB${wb}_CAR`]: `car${wb}`, [`DP_WB${wb}_SOC`]: `soc${wb}`,
            [`DP_WB${wb}_ALLOW`]: `userAllow${wb}`, [`DP_WB${wb}_POWER`]: `power${wb}`,
            [`DP_WB${wb}_L1_A`]: `i${wb}1`, [`DP_WB${wb}_L2_A`]: `i${wb}2`,
            [`DP_WB${wb}_L3_A`]: `i${wb}3`
        });
        Object.assign(config, {
            [`wb${wb}Present`]: true, [`wb${wb}ControlEnabled`]: true,
            [`wb${wb}ProductionArmed`]: true, [`wb${wb}ProductionPhases`]: 1,
            [`wb${wb}SinglePhaseGridPhase`]: wb + 1,
            [`wb${wb}CommissioningMaxA`]: 32, [`wb${wb}MaxCurrent1pA`]: 32,
            [`wb${wb}MaxPowerW`]: 7360, [`wb${wb}AmpereOutputId`]: `cmd${wb}`,
            [`wb${wb}AllowOutputId`]: `allow${wb}`, [`wb${wb}AmpereFeedbackId`]: `feedback${wb}`,
            [`wb${wb}ConnectionId`]: `connection${wb}`, [`wb${wb}ErrorId`]: `error${wb}`
        });
        for (const key of [`Devices.Wallbox${wb}.Present`, `Devices.Wallbox${wb}.ControlEnabled`,
            `Vehicles.Wallbox${wb}.SoCValid`, `Vehicles.Wallbox${wb}.Release`]) put(`ems.0.${key}`, true);
        put(`ems.0.Control.Targets.Wallbox${wb}_W`, 0);
        put(`ems.0.Vehicles.Wallbox${wb}.TargetSoC_pct`, 80);
        put(`ems.0.Vehicles.Wallbox${wb}.MinimumSoC_pct`, 20);
        for (const [id, val] of Object.entries({[`car${wb}`]:2,[`soc${wb}`]:50,[`userAllow${wb}`]:true,
            [`power${wb}`]:0,[`i${wb}1`]:0,[`i${wb}2`]:0,[`i${wb}3`]:0,
            [`connection${wb}`]:true,[`error${wb}`]:0,[`allow${wb}`]:0,[`feedback${wb}`]:6})) put(id,val);
    };
    return {adapter, config, mapping, states, writes, put, ack, electricalOff, refresh, start, output, enableWallbox};
}

test('default/unarmed wallbox never writes, even with global release', async () => {
    const h = setup(); h.config.wb0ProductionArmed = false;
    await h.output.initialize(); await h.output.tick(); assert.equal(h.writes.length, 0);
});
test('confirmed stop, current, then release are separate steps', async () => {
    const h = setup(); await h.start();
    assert.deepEqual(h.writes, [{id:'allow', val:0}, {id:'cmd', val:6}, {id:'allow', val:1}]);
    assert.equal(h.states.get('ems.0.Devices.Wallbox0.OutputActive').val, true);
});
test('previously owned active wallbox is safely adopted after an unclean restart', async () => {
    const h = setup();
    h.put('ems.0.Control.RestartHandoffActive', true);
    h.put('ems.0.Control.RestartHandoffSince', Date.now());
    h.put('ems.0.Devices.Wallbox0.OutputOwned', true);
    h.put('ems.0.Devices.Wallbox0.OutputActive', true);
    h.put('allow', 1); h.put('feedback', 10); h.put('i1', 10); h.put('power', 2.3);
    h.refresh();
    await h.output.initialize(); await h.output.tick();
    assert.deepEqual(h.writes, []);
    assert.equal(h.output.devices[0].owned, true);
    assert.equal(h.output.devices[0].lastA, 10);
    assert.ok(Date.now() - h.output.devices[0].activeSince < 1000);
    assert.equal(h.states.get('ems.0.Devices.Wallbox0.OutputActive').val, true);
    assert.equal(h.states.get('ems.0.Control.RestartHandoffActive').val, false);
    assert.match(h.states.get('ems.0.Devices.Wallbox0.OutputStatus').val,
        /PRODUKTIV: 10 A.*nach Neustart uebernommen/);
});
test('restart handoff recognizes only an active EMS-owned wallbox', async () => {
    const h=setup();await h.output.initialize();
    assert.equal(h.output.hasActiveOwnedOutput(),false);
    h.output.devices[0].owned=true;h.put('ems.0.Devices.Wallbox0.OutputActive',true);
    assert.equal(h.output.hasActiveOwnedOutput(),true);
});
test('restart handoff waits for fresh internal control data without stopping', async () => {
    const h=setup();const old=Date.now()-60000;
    h.put('ems.0.Control.RestartHandoffActive',true);
    h.put('ems.0.Control.RestartHandoffSince',Date.now());
    h.put('ems.0.System.LastUpdate',old);h.put('ems.0.Control.LastUpdate',old);
    h.put('ems.0.Devices.Wallbox0.OutputOwned',true);
    h.put('ems.0.Devices.Wallbox0.OutputActive',true);
    h.put('allow',1);h.put('feedback',10);h.put('i1',10);h.put('power',2.3);
    await h.output.initialize();await h.output.tick();
    assert.deepEqual(h.writes,[]);
    assert.equal(h.output.devices[0].recovering,true);
    assert.match(h.states.get('ems.0.Devices.Wallbox0.OutputStatus').val,/warte auf frisch/);
    h.refresh();await h.output.tick();
    assert.equal(h.output.devices[0].recovering,false);
    assert.equal(h.states.get('ems.0.Control.RestartHandoffActive').val,false);
});
test('restart handoff requires continuously stable EMS data before adoption', async () => {
    const h=setup();h.config.wallboxRestartHandoffSettleS=10;
    h.put('ems.0.Control.RestartHandoffActive',true);
    h.put('ems.0.Control.RestartHandoffSince',Date.now());
    h.put('ems.0.Devices.Wallbox0.OutputOwned',true);
    h.put('ems.0.Devices.Wallbox0.OutputActive',true);
    h.put('allow',1);h.put('feedback',6);h.put('i1',6);h.put('power',1.38);
    h.refresh();
    await h.output.initialize();await h.output.tick();
    assert.equal(h.output.devices[0].recovering,true);
    assert.deepEqual(h.writes,[]);
    assert.match(h.states.get('ems.0.Devices.Wallbox0.OutputStatus').val,/noch 10 s stabilisieren/);
    h.put('ems.0.Control.Valid',false);await h.output.tick();
    assert.equal(h.output.devices[0].handoffReadySince,0);
    h.put('ems.0.Control.Valid',true);await h.output.tick();
    h.output.devices[0].handoffReadySince-=11000;await h.output.tick();
    assert.equal(h.output.devices[0].recovering,false);
    assert.equal(h.states.get('ems.0.Control.RestartHandoffActive').val,false);
    assert.equal(h.states.get('ems.0.Devices.Wallbox0.OutputActive').val,true);
});
test('restart handoff rejects a persisted plan until it was rebuilt after this restart', async () => {
    const h=setup();const handoffSince=Date.now();
    h.put('ems.0.Control.RestartHandoffActive',true);
    h.put('ems.0.Control.RestartHandoffSince',handoffSince);
    h.put('ems.0.Plan.Valid',true,{ts:handoffSince-60000});
    h.put('ems.0.Plan.LastUpdate',handoffSince-60000);
    h.put('ems.0.Devices.Wallbox0.OutputOwned',true);
    h.put('ems.0.Devices.Wallbox0.OutputActive',true);
    h.put('allow',1);h.put('feedback',6);h.put('i1',6);h.put('power',1.38);
    await h.output.initialize();await h.output.tick();
    assert.equal(h.output.devices[0].recovering,true);
    assert.deepEqual(h.writes,[]);
    assert.match(h.states.get('ems.0.Devices.Wallbox0.OutputStatus').val,/frisch berechneten Fahrplan/);
    h.put('ems.0.Plan.Valid',true,{ts:handoffSince+1});h.refresh();await h.output.tick();
    assert.equal(h.output.devices[0].recovering,false);
    assert.equal(h.states.get('ems.0.Devices.Wallbox0.OutputActive').val,true);
});
test('recovered wallbox survives a transient zero target until realtime settles', async () => {
    const h=setup();h.config.wallboxRestartHandoffGraceS=30;
    h.put('ems.0.Control.RestartHandoffActive',true);
    h.put('ems.0.Control.RestartHandoffSince',Date.now());
    h.put('ems.0.Devices.Wallbox0.OutputOwned',true);
    h.put('ems.0.Devices.Wallbox0.OutputActive',true);
    h.put('allow',1);h.put('feedback',9);h.put('i1',9);h.put('power',2.07);
    h.refresh();
    await h.output.initialize();await h.output.tick();
    h.output.devices[0].activeSince-=601000;
    h.put('ems.0.Control.Targets.Wallbox0_W',0);h.writes.length=0;
    await h.output.tick();
    assert.deepEqual(h.writes,[{id:'cmd',val:6}]);
    assert.equal(h.states.get('ems.0.Devices.Wallbox0.OutputActive').val,true);
});
test('restart recovery stops a previously owned wallbox when a safety gate fails', async () => {
    const h = setup();
    h.put('ems.0.Devices.Wallbox0.OutputOwned', true);
    h.put('ems.0.Devices.Wallbox0.OutputActive', true);
    h.put('allow', 1); h.put('feedback', 10); h.put('i1', 10); h.put('power', 2.3);
    h.put('error', 8);
    await h.output.initialize(); await h.output.tick();
    assert.deepEqual(h.writes, [{id: 'allow', val: 0}]);
    assert.equal(h.states.get('ems.0.Devices.Wallbox0.OutputActive').val, false);
});
test('dynamic phase mode waits for external script confirmation before starting', async () => {
    const h=setup();
    Object.assign(h.config,{wb0PhaseSwitchEnabled:true,wb0PhaseModeId:'phaseMode',
        wb0MinCurrent3pA:6,wb0MaxCurrent3pA:16});
    h.put('phaseMode',1);h.put('ems.0.Control.Targets.Wallbox0_Phases',3);
    h.put('ems.0.Control.Targets.Wallbox0_W',4140);
    await h.output.initialize();await h.output.tick();
    assert.deepEqual(h.writes,[]);
    assert.match(h.states.get('ems.0.Devices.Wallbox0.OutputStatus').val,/Soll 3P.*bestaetigt 1P/);
    h.put('phaseMode',2);await h.output.tick();h.ack('allow',0);await h.output.tick();
    h.ack('feedback',6);await h.output.tick();h.ack('allow',1);await h.output.tick();
    assert.deepEqual(h.writes,[{id:'allow',val:0},{id:'cmd',val:6},{id:'allow',val:1}]);
    assert.equal(h.states.get('ems.0.Devices.Wallbox0.OutputPhases').val,3);
    assert.equal(h.states.get('ems.0.Devices.Wallbox0.ConfirmedPhases').val,3);
});
test('confirmed 1-to-3 phase change keeps an owned wallbox active during go-e restart', async () => {
    const h=setup();
    Object.assign(h.config,{wb0PhaseSwitchEnabled:true,wb0PhaseModeId:'phaseMode',
        wb0MinCurrent3pA:6,wb0MaxCurrent3pA:16});
    h.put('phaseMode',1);await h.start();h.writes.length=0;
    h.put('ems.0.Control.Targets.Wallbox0_Phases',3);
    await h.output.tick();
    assert.match(h.states.get('ems.0.Devices.Wallbox0.OutputStatus').val,/warte auf 3P/);
    h.put('phaseMode',2);h.put('ems.0.Control.Targets.Wallbox0_W',4140);
    h.put('i1',0);h.put('i2',0);h.put('i3',0);h.put('power',0);
    await h.output.tick();
    assert.equal(h.states.get('ems.0.Devices.Wallbox0.OutputActive').val,true);
    assert.equal(h.states.get('ems.0.Devices.Wallbox0.OutputPhases').val,3);
    assert.equal(h.states.get('ems.0.Devices.Wallbox0.PhaseTransitionActive').val,true);
    assert.deepEqual(h.writes,[]);
});
test('unconfirmed EMS phase request times out, stays blocked, and accepts late real confirmation', async () => {
    let now=Date.now();const h=setup({now:()=>now});
    Object.assign(h.config,{wb0PhaseSwitchEnabled:true,wb0PhaseModeId:'phaseMode',
        wallboxPhaseSwitchTimeoutS:180});
    h.put('phaseMode',1);h.put('ems.0.Control.Targets.Wallbox0_Phases',3);
    h.put('ems.0.Control.Targets.Wallbox0_W',4140);
    await h.output.initialize();await h.output.tick();
    assert.equal(h.states.get('ems.0.Devices.Wallbox0.PhaseSwitchRemaining_s').val,180);
    now+=179000;h.refresh();await h.output.tick();
    assert.equal(h.states.get('ems.0.Devices.Wallbox0.PhaseSwitchTimedOut').val,false);
    now+=1000;h.refresh();await h.output.tick();
    assert.equal(h.states.get('ems.0.Devices.Wallbox0.PhaseSwitchTimedOut').val,true);
    assert.match(h.states.get('ems.0.Devices.Wallbox0.OutputStatus').val,/Zeitlimit erreicht/);
    assert.deepEqual(h.writes,[]);
    h.put('ems.0.Control.Targets.Wallbox0_W',0);await h.output.tick();
    h.put('ems.0.Control.Targets.Wallbox0_W',4140);await h.output.tick();
    assert.equal(h.states.get('ems.0.Devices.Wallbox0.PhaseSwitchTimedOut').val,true);
    assert.deepEqual(h.writes,[]);
    h.put('phaseMode',2,{ack:false});await h.output.tick();
    assert.deepEqual(h.writes,[]);
    h.put('phaseMode',2);await h.output.tick();
    assert.equal(h.states.get('ems.0.Devices.Wallbox0.PhaseSwitchTimedOut').val,false);
    assert.deepEqual(h.writes,[{id:'allow',val:0}]);
});
test('owned phase request timeout sends one stop and waits for confirmed OFF', async () => {
    let now=Date.now();const h=setup({now:()=>now});
    Object.assign(h.config,{wb0PhaseSwitchEnabled:true,wb0PhaseModeId:'phaseMode',
        wallboxPhaseSwitchTimeoutS:180});
    h.put('phaseMode',1);await h.start();h.writes.length=0;
    h.put('ems.0.Control.Targets.Wallbox0_Phases',3);await h.output.tick();
    now+=180000;h.refresh();await h.output.tick();
    assert.deepEqual(h.writes,[{id:'allow',val:0}]);
    assert.equal(h.output.devices[0].owned,true);
    assert.match(h.states.get('ems.0.Devices.Wallbox0.LastStopReason').val,/Zeitlimit erreicht/);
    await h.output.tick();assert.equal(h.writes.length,1);
    h.ack('allow',0);await h.output.tick();await h.output.tick();
    assert.equal(h.output.devices[0].owned,false);
    assert.equal(h.writes.length,1);
    assert.equal(h.states.get('ems.0.Devices.Wallbox0.PhaseSwitchTimedOut').val,true);
    h.put('ems.0.Control.Targets.Wallbox0_Phases',1);await h.output.tick();
    assert.equal(h.states.get('ems.0.Devices.Wallbox0.PhaseSwitchTimedOut').val,false);
    assert.deepEqual(h.writes,[{id:'allow',val:0},{id:'allow',val:0}]);
});
test('phase mismatch never masks the configured soft shortfall stop delay', async () => {
    let now=Date.now();const h=setup({now:()=>now});
    Object.assign(h.config,{wb0PhaseSwitchEnabled:true,wb0PhaseModeId:'phaseMode',
        wallboxMinimumRunTimeS:600,wallboxStopDelayS:120,wallboxPhaseSwitchTimeoutS:900});
    h.put('phaseMode',1);await h.start();h.writes.length=0;
    now+=601000;h.refresh();
    h.put('ems.0.Control.Targets.Wallbox0_Phases',3);
    h.put('ems.0.Control.Targets.Wallbox0_W',0);h.put('export',0);
    await h.output.tick();
    assert.deepEqual(h.writes,[]);
    assert.equal(h.states.get('ems.0.Devices.Wallbox0.StopDelayActive').val,true);
    now+=119000;h.refresh();await h.output.tick();assert.deepEqual(h.writes,[]);
    now+=1000;h.refresh();await h.output.tick();
    assert.deepEqual(h.writes,[{id:'allow',val:0}]);
    assert.match(h.states.get('ems.0.Devices.Wallbox0.LastStopReason').val,/Budget/);
    assert.equal(h.states.get('ems.0.Devices.Wallbox0.PhaseSwitchTimedOut').val,false);
});
test('phase mismatch preserves minimum runtime but never hard limits', async () => {
    let now=Date.now();const h=setup({now:()=>now});
    Object.assign(h.config,{wb0PhaseSwitchEnabled:true,wb0PhaseModeId:'phaseMode',
        wallboxMinimumRunTimeS:600,wallboxStopDelayS:120,wallboxPhaseSwitchTimeoutS:900});
    h.put('phaseMode',1);await h.start();h.writes.length=0;
    h.put('ems.0.Control.Targets.Wallbox0_Phases',3);
    h.put('ems.0.Control.Targets.Wallbox0_W',0);h.put('export',0);
    await h.output.tick();now+=121000;h.refresh();await h.output.tick();
    assert.deepEqual(h.writes,[]);
    assert.equal(h.states.get('ems.0.Devices.Wallbox0.OutputActive').val,true);
    h.put('lpc','limited');h.put('lpcLimit',1000);await h.output.tick();
    assert.deepEqual(h.writes,[{id:'allow',val:0}]);
    assert.match(h.states.get('ems.0.Devices.Wallbox0.LastStopReason').val,/Sicherheitsgrenze/);
});
test('pending phases permit a current reduction while preventing an increase', async () => {
    const h=setup();Object.assign(h.config,{wb0PhaseSwitchEnabled:true,wb0PhaseModeId:'phaseMode',
        wb0AvailableCurrentId:'available'});
    h.put('phaseMode',1);h.put('available',32);await h.start();h.writes.length=0;
    h.output.devices[0].lastAt-=10000;h.put('i1',6);h.put('power',1.38);
    h.put('ems.0.Control.Targets.Wallbox0_Phases',3);await h.output.tick();
    assert.deepEqual(h.writes,[]);
    h.output.devices[0].lastA=16;h.put('feedback',16);h.put('i1',16);h.put('power',3.68);
    h.put('available',8);await h.output.tick();
    assert.deepEqual(h.writes,[{id:'cmd',val:8}]);
    assert.ok(!h.writes.some(write=>write.id==='allow'&&write.val===0));
});
test('selected wallbox handoff overrides phase waiting and retains the OFF interlock', async () => {
    const h=setup();h.config.multiWallboxAlphaArmed=true;h.enableWallbox(1);
    Object.assign(h.config,{wb0PhaseSwitchEnabled:true,wb0PhaseModeId:'phaseMode'});
    h.put('phaseMode',1);await h.start();h.writes.length=0;
    h.put('ems.0.Control.Targets.Wallbox0_Phases',3);await h.output.tick();
    h.put('ems.0.Control.SelectedWallbox',1);h.put('ems.0.Control.Targets.Wallbox1_W',4140);
    await h.output.tick();assert.deepEqual(h.writes,[{id:'allow',val:0}]);
    assert.equal(h.output.devices[0].owned,true);
    assert.equal(h.output.devices[1].owned,false);
    h.ack('allow',0);h.electricalOff();await h.output.tick();
    assert.deepEqual(h.writes,[{id:'allow',val:0},{id:'allow1',val:0}]);
});
test('script phase mode uses the real confirmation independently of EMS phase proposals', async () => {
    const h=setup();Object.assign(h.config,{wb0PhaseSwitchEnabled:true,
        wb0PhaseControlMode:'script',wb0PhaseModeId:'phaseMode'});
    h.put('phaseMode',1);h.put('ems.0.Control.Targets.Wallbox0_Phases',3);
    await h.start();
    assert.deepEqual(h.writes,[{id:'allow',val:0},{id:'cmd',val:6},{id:'allow',val:1}]);
    assert.equal(h.states.get('ems.0.Devices.Wallbox0.OutputPhases').val,1);
    assert.equal(h.states.get('ems.0.Devices.Wallbox0.PhaseControlMode').val,'script');
    assert.equal(h.states.get('ems.0.Devices.Wallbox0.PhaseSwitchPending').val,false);
    h.writes.length=0;h.put('phaseMode',2);h.put('ems.0.Control.Targets.Wallbox0_W',4140);
    await h.output.tick();assert.deepEqual(h.writes,[]);
    assert.equal(h.states.get('ems.0.Devices.Wallbox0.OutputPhases').val,3);
    assert.equal(h.states.get('ems.0.Devices.Wallbox0.OutputReservedPower_W').val,4140);
});
test('upgraded configurations default to independent script phase control', async () => {
    const h=setup();delete h.config.wb0PhaseControlMode;
    Object.assign(h.config,{wb0PhaseSwitchEnabled:true,wb0PhaseModeId:'phaseMode'});
    h.put('phaseMode',1);h.put('ems.0.Control.Targets.Wallbox0_Phases',3);
    await h.start();
    assert.equal(h.states.get('ems.0.Devices.Wallbox0.OutputActive').val,true);
    assert.equal(h.states.get('ems.0.Devices.Wallbox0.PhaseControlMode').val,'script');
    assert.equal(h.states.get('ems.0.Devices.Wallbox0.PhaseSwitchPending').val,false);
});
test('script mode still rejects missing phase feedback and invalid control modes', async () => {
    const h=setup();Object.assign(h.config,{wb0PhaseSwitchEnabled:true,
        wb0PhaseControlMode:'script',wb0PhaseModeId:'phaseMode'});
    await h.output.initialize();await h.output.tick();
    assert.deepEqual(h.writes,[]);
    assert.match(h.states.get('ems.0.Devices.Wallbox0.OutputStatus').val,/Phasenmodus/);
    h.config.wb0PhaseControlMode='typo';h.put('phaseMode',1);await h.output.tick();
    assert.deepEqual(h.writes,[]);
    assert.match(h.states.get('ems.0.Devices.Wallbox0.OutputStatus').val,/Phasenfuehrung ungueltig/);
});
test('phase feedback mapping fallback keeps acknowledged static modes and rejects malformed data', async () => {
    const h=setup();Object.assign(h.config,{wb0PhaseSwitchEnabled:true,wb0PhaseControlMode:'script'});
    h.mapping.DP_WB0_PHASE_MODE='mappedMode';
    h.put('mappedMode',true);await h.output.initialize();await h.output.tick();
    assert.equal(h.output.devices[0].ids.phaseMode,'mappedMode');
    assert.deepEqual(h.writes,[]);
    assert.match(h.states.get('ems.0.Devices.Wallbox0.OutputStatus').val,/Phasenmodus/);
    h.put('mappedMode',1,{ts:0});await h.output.tick();assert.deepEqual(h.writes,[]);
    h.put('mappedMode','1',{ts:Date.now()-86400000});await h.output.tick();
    assert.deepEqual(h.writes,[{id:'allow',val:0}]);
});
test('running wallbox without persisted EMS ownership is never adopted', async () => {
    const h = setup();
    h.put('ems.0.Devices.Wallbox0.OutputOwned', false);
    h.put('ems.0.Devices.Wallbox0.OutputActive', false);
    h.put('allow', 1); h.put('feedback', 10); h.put('i1', 10); h.put('power', 2.3);
    await h.output.initialize(); await h.output.tick();
    assert.deepEqual(h.writes, [{id: 'allow', val: 0}]);
    assert.equal(h.states.get('ems.0.Devices.Wallbox0.OutputActive').val, false);
});
test('current write is never treated as device acknowledgement', async () => {
    const h = setup(); await h.output.initialize(); await h.output.tick(); h.ack('allow', 0);
    await h.output.tick(); h.put('feedback', 6, {ack:false}); await h.output.tick();
    assert.ok(!h.writes.some(w => w.id === 'allow' && w.val === 1));
});
test('feedback timeout latches fault and never enables charging', async () => {
    const h = setup(); await h.output.initialize(); await h.output.tick(); h.ack('allow', 0);
    await h.output.tick(); h.output.devices[0].pending.at -= 30000;
    await h.output.tick(); assert.match(h.output.devices[0].fault, /Rueckmeldung/);
    assert.ok(!h.writes.some(w => w.id === 'allow' && w.val === 1));
});
test('soft target change waits for the pending command and a fresh vehicle response before reversing', async () => {
    const h=setup();h.config.wallboxMinimumRunTimeS=600;await h.start();
    h.put('i1',6);h.put('power',1.38);h.output.devices[0].lastAt-=10000;h.writes.length=0;
    await h.output.tick();
    assert.deepEqual(h.writes,[{id:'cmd',val:12}]);
    h.put('ems.0.Control.Targets.Wallbox0_W',0);h.put('export',0);
    await h.output.tick();
    assert.deepEqual(h.writes,[{id:'cmd',val:12}]);
    h.ack('feedback',12);h.put('i1',12);h.put('power',2.76);
    await h.output.tick();
    assert.deepEqual(h.writes,[{id:'cmd',val:12},{id:'cmd',val:6}]);
    assert.ok(!h.writes.some(write=>write.id==='allow'&&write.val===0));
    assert.equal(h.states.get('ems.0.Devices.Wallbox0.OutputActive').val,true);
    assert.match(h.states.get('ems.0.Devices.Wallbox0.OutputStatus').val,/durch 6 A ersetzt/);
});
for (const [name, change] of [
    ['global off', h => h.put('ems.0.System.RealOutputsEnabled', false)],
    ['device off', h => h.put('ems.0.Devices.Wallbox0.ControlEnabled', false)],
    ['absent', h => {h.config.wb0Present = false;}],
    ['offline', h => h.put('connection', false)],
    ['error/overtemperature', h => h.put('error', 8)],
    ['SoC target', h => h.put('soc', 80)],
    ['null SoC', h => h.put('soc', null)],
    ['HA trip', h => h.put('critical', true)],
    ['stale meter', h => h.put('import', 0, {ts:Date.now()-60000})],
    ['invalid quality', h => h.put('export', 8000, {q:0x40})],
    ['unknown curtailment', h => h.put('lpc', 'unexpected')],
    ['limited without budget', h => {h.put('lpc', 'limited'); h.put('lpcLimit', null);}],
    ['user release off', h => h.put('userAllow', false)],
    ['unexpected phases', h => h.put('i2', 6)],
    ['second wallbox enabled', h => {h.config.wb1ControlEnabled = true;
        h.put('ems.0.Devices.Wallbox1.ControlEnabled', true); h.put('ems.0.Devices.Wallbox1.Present', true);}],
    ['DHW production enabled', h => h.put('ems.0.Devices.MyPV_DHW.ControlEnabled', true)]
]) test(`${name}: active charger gets stop, no positive write`, async () => {
    const h = setup(); await h.start(); h.writes.length = 0; change(h);
    await h.output.tick(); assert.deepEqual(h.writes, [{id:'allow', val:0}]);
});
test('600 s minimum runtime and 120 s stop delay expire in parallel without adding another stop timer', async () => {
    let now = Date.now(); const h = setup({now: () => now});
    h.config.wallboxMinimumRunTimeS = 600; h.config.wallboxStopDelayS = 120;
    await h.start(); h.writes.length = 0;
    h.put('ems.0.Control.Targets.Wallbox0_W', 0); h.put('export', 0);
    await h.output.tick();
    now += 120000; h.refresh(); await h.output.tick();
    assert.deepEqual(h.writes, []);
    assert.equal(h.states.get('ems.0.Devices.Wallbox0.StopDelayRemaining_s').val, 0);
    assert.ok(now - h.output.devices[0].activeSince < 600000);
    now += 480000; h.refresh(); await h.output.tick();
    assert.deepEqual(h.writes, [{id: 'allow', val: 0}], 'no additional 120 s after minimum runtime');
});

test('productive output keeps six amps during minimum runtime on a soft surplus drop', async () => {
    const h=setup();h.config.wallboxMinimumRunTimeS=600;await h.start();h.writes.length=0;
    h.put('ems.0.Control.Targets.Wallbox0_W',0);h.put('export',0);
    await h.output.tick();
    assert.deepEqual(h.writes,[]);
    assert.equal(h.states.get('ems.0.Devices.Wallbox0.OutputActive').val,true);
    assert.match(h.states.get('ems.0.Devices.Wallbox0.OutputStatus').val,/Mindestlaufzeit/);
    h.output.devices[0].activeSince-=601000;
    h.output.devices[0].shortfallSince-=121000;
    await h.output.tick();
    assert.deepEqual(h.writes,[{id:'allow',val:0}]);
});
test('brief grid import after minimum runtime holds six amps for the stop delay', async () => {
    const h=setup();h.config.wallboxMinimumRunTimeS=120;h.config.wallboxStopDelayS=120;
    await h.start();h.writes.length=0;h.output.devices[0].activeSince-=121000;
    h.put('ems.0.Control.Targets.Wallbox0_W',0);h.put('import',500);h.put('export',0);
    await h.output.tick();
    assert.deepEqual(h.writes,[]);
    assert.equal(h.states.get('ems.0.Devices.Wallbox0.OutputActive').val,true);
    assert.match(h.states.get('ems.0.Devices.Wallbox0.OutputStatus').val,/Leistungsdelle: 6 A/);
    h.put('ems.0.Control.Targets.Wallbox0_W',7000);h.put('import',0);h.put('export',8000);
    await h.output.tick();
    assert.equal(h.output.devices[0].shortfallSince,0);
    h.put('ems.0.Control.Targets.Wallbox0_W',0);h.put('import',500);h.put('export',0);
    await h.output.tick();
    assert.ok(h.output.devices[0].shortfallSince>0);
    assert.ok(!h.writes.some(write=>write.id==='allow'&&write.val===0));
});
test('productive stop reason remains available after later idle ticks', async () => {
    const h=setup();await h.start();h.writes.length=0;
    h.put('ems.0.Vehicles.Wallbox0.Release',false);await h.output.tick();
    const reason=h.states.get('ems.0.Devices.Wallbox0.LastStopReason').val;
    const stoppedAt=h.states.get('ems.0.Devices.Wallbox0.LastStopAt').val;
    h.ack('allow',0);await h.output.tick();
    assert.match(reason,/Fahrzeugfreigabe/);
    assert.equal(h.states.get('ems.0.Devices.Wallbox0.LastStopReason').val,reason);
    assert.equal(h.states.get('ems.0.Devices.Wallbox0.LastStopAt').val,stoppedAt);
});
test('one productive stop emits only one persistent diagnostic while allow=0 is pending', async () => {
    const h=setup();await h.start();h.writes.length=0;
    h.put('power',null);await h.output.tick();
    const stoppedAt=h.states.get('ems.0.Devices.Wallbox0.LastStopAt').val;
    assert.match(h.states.get('ems.0.Devices.Wallbox0.LastStopReason').val,/Wallbox-Leistung/);
    await h.output.tick();
    assert.equal(h.states.get('ems.0.Devices.Wallbox0.LastStopAt').val,stoppedAt);
});
test('normal go-e polling jitter above fifteen seconds does not stop an active wallbox', async () => {
    const h=setup();h.config.wallboxMeasurementMaxAgeS=30;await h.start();h.writes.length=0;
    const old=Date.now()-20000;
    for(const id of ['power','i1','i2','i3','feedback','allow','car','error'])
        h.put(id,h.states.get(id).val,{ts:old});
    await h.output.tick();
    assert.deepEqual(h.writes,[]);
    assert.equal(h.states.get('ems.0.Devices.Wallbox0.OutputActive').val,true);
});
test('confirmed start survives a zero target before the allow acknowledgement is adopted', async () => {
    const h=setup();await h.output.initialize();
    await h.output.tick();h.ack('allow',0);
    await h.output.tick();h.ack('feedback',6);
    await h.output.tick();
    h.put('ems.0.Control.Targets.Wallbox0_W',0);h.put('export',0);h.ack('allow',1);
    h.writes.length=0;await h.output.tick();
    assert.deepEqual(h.writes,[]);
    assert.equal(h.states.get('ems.0.Devices.Wallbox0.OutputActive').val,true);
    assert.ok(h.output.devices[0].activeSince>0);
});
test('minimum SoC and a higher target SoC do not stop an active charger', async () => {
    const h=setup();await h.start();h.writes.length=0;
    h.put('ems.0.Vehicles.Wallbox0.MinimumSoC_pct',40);
    await h.output.tick();
    h.put('ems.0.Vehicles.Wallbox0.MinimumSoC_pct',60);
    await h.output.tick();
    h.put('ems.0.Vehicles.Wallbox0.TargetSoC_pct',90);
    await h.output.tick();
    assert.deepEqual(h.writes,[]);
    assert.equal(h.states.get('ems.0.Devices.Wallbox0.OutputActive').val,true);
});
test('below minimum SoC can start without solar power', async () => {
    const h = setup(); h.put('soc',10); h.put('export',0); await h.start();
    assert.equal(h.states.get('ems.0.Devices.Wallbox0.OutputActive').val, true);
});

// An ended minimum-SoC obligation is a completed demand, not a passing PV
// dip. Exercise it with real ON/current ACKs and electrical load before
// changing SoC; then require the ordinary OFF and zero-power evidence.
async function runningMinimumGridCharge() {
    let now = 1000000000000;
    const h = setup({now: () => now});
    h.advance = ms => { now += ms; h.refresh(); };
    h.config.wallboxMinimumRunTimeS = 600;
    h.config.wallboxStopDelayS = 600;
    h.put('soc', 19); h.put('export', 0);
    h.put('ems.0.Control.Targets.Wallbox0_W', 1380);
    await h.start();
    h.advance(1000); h.put('i1', 6); h.put('power', 1.38); h.put('import', 1380);
    await h.output.tick(); h.writes.length = 0;
    return h;
}

test('completed grid-backed minimum charge sends OFF immediately and still awaits real OFF evidence', async t => {
    for (const oldPlanW of [0, 1380]) await t.test(`remaining plan ${oldPlanW} W`, async () => {
        const h = await runningMinimumGridCharge();
        h.advance(1000); h.put('soc', 20);
        h.put('ems.0.Control.Targets.Wallbox0_W', oldPlanW);
        await h.output.tick();
        assert.deepEqual(h.writes, [{id: 'allow', val: 0}],
            'completion must not wait for either the 600 s minimum runtime or the stop delay');
        assert.match(h.states.get('ems.0.Devices.Wallbox0.LastStopReason').val, /Mindest-SoC/);
        assert.equal(h.states.get('ems.0.Devices.Wallbox0.StopDelayActive').val, false);
        assert.equal(h.states.get('ems.0.Devices.Wallbox0.StopDelayRemaining_s').val, 0);
        assert.equal(h.states.get('ems.0.Devices.Wallbox0.StopConfirmedAt').val, 0);
        assert.equal(h.states.get('ems.0.Devices.Wallbox0.OutputOwned').val, true);
        assert.equal(h.states.get('ems.0.Devices.Wallbox0.OutputReservedPower_W').val, 1380);
        h.advance(1000); h.ack('allow', 0); await h.output.tick();
        assert.equal(h.states.get('ems.0.Devices.Wallbox0.StopPowerPending').val, true);
        assert.equal(h.states.get('ems.0.Devices.Wallbox0.OutputOwned').val, true,
            'the OFF transport ACK is not proof of electrical quiet');
        assert.equal(h.states.get('ems.0.Devices.Wallbox0.OutputReservedPower_W').val, 1380);
        h.advance(1000); h.electricalOff(); h.put('import', 0); await h.output.tick();
        assert.equal(h.states.get('ems.0.Devices.Wallbox0.OutputOwned').val, false);
        assert.equal(h.states.get('ems.0.Devices.Wallbox0.OutputReservedPower_W').val, 0);
        assert.deepEqual(h.writes, [{id: 'allow', val: 0}]);
    });
});

test('grid-backed minimum charge remains active while the confirmed SoC is still below minimum', async () => {
    const h = await runningMinimumGridCharge();
    h.advance(30000); h.put('ems.0.Control.Targets.Wallbox0_W', 0);
    await h.output.tick();
    assert.deepEqual(h.writes, []);
    assert.equal(h.states.get('ems.0.Devices.Wallbox0.OutputActive').val, true);
});

test('minimum completion continues on real PV and a later PV dip retains the full configured stop delay', async () => {
    const h = await runningMinimumGridCharge();
    h.advance(1000); h.put('soc', 20); h.put('import', 0); h.put('export', 200);
    await h.output.tick();
    assert.deepEqual(h.writes, []);
    assert.equal(h.states.get('ems.0.Devices.Wallbox0.OutputActive').val, true);
    h.advance(1000); h.put('ems.0.Control.Targets.Wallbox0_W', 0);
    h.put('import', 1380); h.put('export', 0); await h.output.tick();
    assert.deepEqual(h.writes, [], 'a later PV shortfall is not minimum-demand completion');
    assert.equal(h.states.get('ems.0.Devices.Wallbox0.StopDelayRemaining_s').val, 600);
    h.advance(599000); await h.output.tick();
    assert.deepEqual(h.writes, []);
    assert.equal(h.states.get('ems.0.Devices.Wallbox0.StopDelayRemaining_s').val, 1);
    h.advance(1000); await h.output.tick();
    assert.deepEqual(h.writes, [{id: 'allow', val: 0}]);
    assert.doesNotMatch(h.states.get('ems.0.Devices.Wallbox0.LastStopReason').val, /Mindest-SoC/);
});

test('minimum completion does not revoke a currently authorized grid-price session', async () => {
    const h = await runningMinimumGridCharge();
    h.put('ems.0.Config.Wallbox0PriceChargingEnabled', true);
    h.adapter.engineContext = {
        vehicleState: () => ({release: true}),
        priceChargingAuthorization: () => ({enabled: true, allowed: true, gridW: 1480})
    };
    h.advance(1000); h.put('soc', 20);
    h.put('ems.0.Control.Targets.Wallbox0_W', 1480);
    h.put('ems.0.Control.Wallbox0PriceGridCharge_W', 1480);
    await h.output.tick();
    assert.deepEqual(h.writes, []);
    assert.equal(h.states.get('ems.0.Devices.Wallbox0.OutputActive').val, true);
});

test('minimum completion preserves separate manual-minimum and deadline obligations', async t => {
    for (const obligation of ['manual', 'deadline']) await t.test(obligation, async () => {
        const h = await runningMinimumGridCharge();
        if (obligation === 'manual') h.put('ems.0.Vehicles.Wallbox0.ManualMinimumCurrent_A', 6);
        else {
            h.config.wb0DeadlineEnabled = true;
            h.put('ems.0.Vehicles.Wallbox0.MustCharge', true);
        }
        h.advance(1000); h.put('soc', 20); h.put('ems.0.Control.Targets.Wallbox0_W', 0);
        await h.output.tick();
        assert.deepEqual(h.writes, []);
        assert.equal(h.states.get('ems.0.Devices.Wallbox0.OutputActive').val, true);
    });
});

test('missing or unacknowledged SoC cannot be reported as successful minimum completion', async t => {
    for (const mode of ['missing', 'unacknowledged']) await t.test(mode, async () => {
        const h = await runningMinimumGridCharge();
        h.advance(1000); h.put('ems.0.Control.Targets.Wallbox0_W', 0);
        h.put('soc', mode === 'missing' ? null : 20, {ack: mode !== 'unacknowledged'});
        await h.output.tick();
        assert.deepEqual(h.writes, [{id: 'allow', val: 0}]);
        assert.match(h.states.get('ems.0.Devices.Wallbox0.LastStopReason').val, /SoC/);
        assert.doesNotMatch(h.states.get('ems.0.Devices.Wallbox0.LastStopReason').val, /Mindest-SoC erreicht/);
        assert.equal(h.states.get('ems.0.Devices.Wallbox0.StopConfirmedAt').val, 0);
        assert.equal(h.states.get('ems.0.Devices.Wallbox0.OutputOwned').val, true);
    });
});

test('a simultaneous physical protection trip remains the reason when minimum SoC is reached', async () => {
    const h = await runningMinimumGridCharge();
    h.advance(1000); h.put('soc', 20); h.put('critical', true);
    await h.output.tick();
    assert.deepEqual(h.writes, [{id: 'allow', val: 0}]);
    assert.match(h.states.get('ems.0.Devices.Wallbox0.LastStopReason').val, /Hausanschlussschutz/);
});

test('restart adoption above minimum cannot manufacture a past minimum-completion edge', async () => {
    let now = 1000000000000;
    const h = setup({now: () => now});
    h.config.wallboxMinimumRunTimeS = 600; h.config.wallboxStopDelayS = 600;
    h.put('ems.0.Control.RestartHandoffActive', true);
    h.put('ems.0.Control.RestartHandoffSince', now);
    h.put('ems.0.Devices.Wallbox0.OutputOwned', true);
    h.put('ems.0.Devices.Wallbox0.OutputActive', true);
    h.put('allow', 1); h.put('feedback', 6); h.put('i1', 6); h.put('power', 1.38);
    h.put('import', 1380); h.put('export', 0); h.put('ems.0.Control.Targets.Wallbox0_W', 0);
    await h.output.initialize(); await h.output.tick();
    assert.deepEqual(h.writes, [], 'current SoC above minimum is not a previously observed grid-charge completion');
    assert.equal(h.states.get('ems.0.Devices.Wallbox0.OutputActive').val, true);
    assert.equal(h.states.get('ems.0.Devices.Wallbox0.StopDelayRemaining_s').val, 600);
    now += 600000; h.refresh(); await h.output.tick();
    assert.deepEqual(h.writes, [{id: 'allow', val: 0}]);
    assert.doesNotMatch(h.states.get('ems.0.Devices.Wallbox0.LastStopReason').val, /Mindest-SoC/);
});

test('unplugging ends the observed minimum obligation before a new above-minimum PV start', async () => {
    const h = await runningMinimumGridCharge();
    h.advance(1000); h.put('car', 1); await h.output.tick();
    assert.deepEqual(h.writes, [{id: 'allow', val: 0}]);
    h.advance(1000); h.ack('allow', 0); h.electricalOff(); h.put('import', 0);
    await h.output.tick();
    assert.equal(h.states.get('ems.0.Devices.Wallbox0.OutputOwned').val, false);
    // Reuse this controller and device: initializing a fresh object here would
    // conceal a marker that incorrectly survived the completed physical stop.
    h.advance(1000); h.put('car', 2); h.put('soc', 50);
    h.put('export', 1600); h.put('ems.0.Control.Targets.Wallbox0_W', 1380);
    await h.output.tick(); h.ack('allow', 0);
    await h.output.tick(); h.ack('feedback', 6);
    await h.output.tick();
    assert.equal(h.writes.at(-1).id, 'allow');
    assert.equal(h.writes.at(-1).val, 1);
    // Clouds arrive between ON command and its physical response. This new
    // PV session receives its normal timers; it never crossed minimum SoC.
    h.advance(1000); h.ack('allow', 1); h.put('i1', 6); h.put('power', 1.38);
    h.put('import', 1380); h.put('export', 0); h.put('ems.0.Control.Targets.Wallbox0_W', 0);
    h.writes.length = 0; await h.output.tick();
    assert.deepEqual(h.writes, []);
    assert.equal(h.states.get('ems.0.Devices.Wallbox0.OutputActive').val, true);
    assert.equal(h.states.get('ems.0.Devices.Wallbox0.StopDelayRemaining_s').val, 600);
    h.advance(600000); await h.output.tick();
    assert.deepEqual(h.writes, [{id: 'allow', val: 0}]);
    assert.doesNotMatch(h.states.get('ems.0.Devices.Wallbox0.LastStopReason').val, /Mindest-SoC/);
});

test('minimum-SoC configuration requires a qualified source but retained values do not expire like telemetry', async t => {
    for (const mode of ['missing', 'null', 'unacknowledged', 'bad_quality', 'retained']) await t.test(mode, async () => {
        const h = await runningMinimumGridCharge();
        h.advance(1000); h.put('soc', 20); h.put('ems.0.Control.Targets.Wallbox0_W', 0);
        if (mode === 'missing') h.states.delete('ems.0.Vehicles.Wallbox0.MinimumSoC_pct');
        else if (mode === 'null') h.put('ems.0.Vehicles.Wallbox0.MinimumSoC_pct', null);
        else h.put('ems.0.Vehicles.Wallbox0.MinimumSoC_pct', 20,
            mode === 'unacknowledged' ? {ack: false} : mode === 'bad_quality' ? {q: 0x40}
                : {ts: 1000000000000 - 86400000});
        await h.output.tick();
        if (mode !== 'retained') {
            assert.deepEqual(h.writes, [], 'unknown threshold does not prove a successfully completed obligation');
            assert.equal(h.states.get('ems.0.Devices.Wallbox0.StopDelayRemaining_s').val, 600);
            h.advance(1000); h.put('ems.0.Vehicles.Wallbox0.MinimumSoC_pct', 20);
            await h.output.tick();
        }
        assert.deepEqual(h.writes, [{id: 'allow', val: 0}]);
        assert.match(h.states.get('ems.0.Devices.Wallbox0.LastStopReason').val, /Mindest-SoC/);
        assert.equal(h.states.get('ems.0.Devices.Wallbox0.StopConfirmedAt').val, 0);
    });
});
test('HA cap cannot be defeated by minimum-SoC charging', async () => {
    const h = setup(); h.put('soc',10); h.put('h1',49); await h.output.initialize(); await h.output.tick();
    assert.equal(h.writes.length, 0);
});
test('valid LPC limit permits charging but caps current to its power budget', async () => {
    const h = setup(); h.put('par14a', true); h.put('lpc', 'limited'); h.put('lpcLimit', 3220);
    await h.start(); h.output.devices[0].lastAt -= 10000;
    h.put('i1',6); h.put('power',1.38); h.writes.length=0;
    await h.output.tick();
    assert.deepEqual(h.writes,[{id:'cmd',val:12}]);
});
test('old but valid binary contact uses fixed budget and does not time out', async () => {
    const h = setup(); h.put('par14a', true, {ts: Date.now() - 86400000});
    h.put('lpc', 'unlimitedAutonomous');
    await h.start(); h.output.devices[0].lastAt -= 10000;
    h.put('i1',6); h.put('power',1.38); h.writes.length=0;
    await h.output.tick();
    assert.deepEqual(h.writes,[{id:'cmd',val:12}]);
    assert.equal(h.output.gridOperatorLimit(h.mapping).budgetW, 4200);
});
test('simultaneous binary and LPC limitations use the lower budget', () => {
    const h = setup(); h.put('par14a', true); h.put('lpc', 'limited'); h.put('lpcLimit', 3000);
    assert.equal(h.output.gridOperatorLimit(h.mapping).budgetW, 3000);
});
test('heat-pump consumption is deducted from the shared LPC budget', async () => {
    const h = setup(); h.mapping.DP_HEAT_PUMP_POWER='heatPump';
    h.put('ems.0.Devices.HeatPump.Present',true); h.put('heatPump',2000);
    h.put('par14a',true); h.put('lpc','limited'); h.put('lpcLimit',4000);
    await h.start(); h.output.devices[0].lastAt -= 10000;
    h.put('i1',6); h.put('power',1.38); h.writes.length=0;
    await h.output.tick();
    assert.deepEqual(h.writes,[{id:'cmd',val:8}]);
});
test('wallbox shared budget normalizes WP kW and requires fresh total consumption', () => {
    const h = setup(); h.mapping.DP_HEAT_PUMP_POWER = 'heatPump';
    h.config.heatPumpPowerUnit = 'kW'; h.config.heatPumpPowerScope = 'total';
    h.put('ems.0.Devices.HeatPump.Present', true); h.put('heatPump', 2);
    h.put('par14a', true); h.put('lpc', 'limited'); h.put('lpcLimit', 4000);
    assert.equal(h.output.gridOperatorLimit(h.mapping).budgetW, 2000);
    for (const extra of [{val: null}, {ack: false}, {q: 2}, {ts: Date.now() - 31000}]) {
        h.put('heatPump', 2, extra);
        const limit = h.output.gridOperatorLimit(h.mapping);
        assert.equal(limit.valid, false); assert.equal(limit.budgetW, 0);
    }
    h.put('heatPump', 2); h.config.heatPumpPowerScope = 'inverter';
    assert.equal(h.output.gridOperatorLimit(h.mapping).valid, false);
    h.put('ems.0.Devices.HeatPump.Present', false);
    assert.equal(h.output.gridOperatorLimit(h.mapping).budgetW, 4000);
    h.put('ems.0.Devices.HeatPump.Present', true); h.put('par14a', false);
    h.put('lpc', 'unlimitedAutonomous');
    assert.equal(h.output.gridOperatorLimit(h.mapping).valid, true);
});
test('directional phase power prevents export current from being mistaken for import', async () => {
    const h = setup();
    Object.assign(h.mapping, {DP_HA_L1_IMPORT_W:'pi1',DP_HA_L2_IMPORT_W:'pi2',DP_HA_L3_IMPORT_W:'pi3',
        DP_HA_L1_EXPORT_W:'pe1',DP_HA_L2_EXPORT_W:'pe2',DP_HA_L3_EXPORT_W:'pe3'});
    for (const id of ['pi1','pi2','pi3']) h.put(id,0);
    for (const id of ['pe1','pe2','pe3']) h.put(id,11270);
    h.put('h1',49);
    await h.start();
    assert.equal(h.states.get('ems.0.Devices.Wallbox0.OutputActive').val,true);
});
test('no current ramp-up while device takes less than commanded', async () => {
    const h = setup(); await h.start(); h.output.devices[0].lastAt -= 10000;
    h.writes.length = 0; await h.output.tick(); assert.equal(h.writes.length,0);
});
test('slightly reduced vehicle current still permits controlled current increase', async () => {
    const h = setup(); await h.start(); h.output.devices[0].lastAt -= 10000;
    h.put('ems.0.Control.Targets.Wallbox0_W',1840); h.put('i1',3.5); h.put('power',0.8);
    h.writes.length=0; await h.output.tick(); assert.deepEqual(h.writes,[{id:'cmd',val:8}]);
});
test('current increase uses whole amps and configured ramp', async () => {
    const h = setup(); await h.start(); h.output.devices[0].lastAt -= 10000;
    h.put('i1',6); h.put('power',1.38); h.writes.length=0;
    await h.output.tick(); assert.deepEqual(h.writes,[{id:'cmd',val:12}]);
});
test('combined production limits a confirmed wallbox increase to one ampere', async () => {
    const h=setup();h.config.combinedProductionArmed=true;h.config.wallboxCombinedMaxStepA=1;
    h.put('split',1);h.put('ems.0.Config.DHWParallelDistributionEnabled',true);
    h.put('ems.0.Devices.MyPV_DHW.ControlEnabled',true);
    h.put('ems.0.Control.Targets.MyPV_DHW_W',0);h.put('ems.0.Actual.MyPV_DHW_W',0);
    await h.start();h.output.devices[0].lastAt-=10000;
    h.put('i1',6);h.put('power',1.38);h.writes.length=0;
    await h.output.tick();assert.deepEqual(h.writes,[{id:'cmd',val:7}]);
});
test('taper and available-current limits apply to production', async () => {
    const h = setup(); h.config.wb0TaperEnabled=true; h.config.wb0AvailableCurrentId='available';
    h.put('soc',79); h.put('available',7); await h.start();
    h.output.devices[0].lastAt -= 10000; h.put('i1',6); h.put('power',1.38); h.writes.length=0;
    await h.output.tick(); assert.deepEqual(h.writes,[{id:'cmd',val:7}]);
});
test('configured missing available-current signal fails closed', async () => {
    const h = setup(); h.config.wb0AvailableCurrentId='available'; h.put('available',null);
    await h.output.initialize(); await h.output.tick(); assert.equal(h.writes.length,0);
});
test('unload sends stop only to owned charger', async () => {
    const h=setup(); await h.start(); h.writes.length=0;
    h.output.stopping=true; await h.output.stopAll(); assert.deepEqual(h.writes,[{id:'allow',val:0}]);
});
test('failed current write cannot be followed by enable', async () => {
    const h=setup(); const send=h.adapter.setForeignStateAsync;
    h.adapter.setForeignStateAsync=async(id,val)=>{if(id==='cmd')throw new Error('network');return send(id,val);};
    await h.output.initialize(); await h.output.tick(); h.ack('allow',0); await h.output.tick();
    assert.ok(h.output.devices[0].fault); assert.ok(!h.writes.some(w=>w.id==='allow'&&w.val===1));
});
test('duplicate output mappings are rejected', async () => {
    const h=setup(); h.config.wb1AmpereOutputId='cmd'; await h.output.initialize(); await h.output.tick();
    assert.equal(h.writes.length,0); assert.equal(h.output.devices[0].valid,false);
});
test('confirmed combined mode permits one wallbox beside DHW', async () => {
    const h=setup();h.config.combinedProductionArmed=true;h.put('split',1);
    h.put('ems.0.Config.DHWParallelDistributionEnabled',true);
    h.put('ems.0.Devices.MyPV_DHW.ControlEnabled',true);
    h.put('ems.0.Control.Targets.MyPV_DHW_W',0);
    await h.start();
    assert.equal(h.states.get('ems.0.Devices.Wallbox0.OutputActive').val,true);
});
test('turning off 50/50 keeps the running wallbox active with wallbox priority', async () => {
    const h=setup();h.config.combinedProductionArmed=true;h.put('split',1);
    h.put('ems.0.Config.DHWParallelDistributionEnabled',true);
    h.put('ems.0.Devices.MyPV_DHW.ControlEnabled',true);
    h.put('ems.0.Control.Targets.MyPV_DHW_W',0);h.put('ems.0.Actual.MyPV_DHW_W',0);
    await h.start();h.writes.length=0;
    h.put('split',0);await h.output.tick();
    assert.deepEqual(h.writes,[]);
    assert.equal(h.states.get('ems.0.Devices.Wallbox0.OutputActive').val,true);
    assert.equal(h.states.get('ems.0.Devices.Wallbox0.OutputOwned').val,true);
});
test('combined wallbox need not wait for a heater ramp-up or disabled thermal output', async () => {
    const h=setup();h.config.combinedProductionArmed=true;h.put('split',1);
    h.put('ems.0.Config.DHWParallelDistributionEnabled',true);
    h.put('ems.0.Devices.MyPV_DHW.ControlEnabled',true);
    h.put('ems.0.Control.Targets.MyPV_DHW_W',3000);
    h.put('ems.0.Actual.MyPV_DHW_W',0);
    await h.output.initialize();await h.output.tick();
    assert.deepEqual(h.writes,[{id:'allow',val:0}]);
    assert.match(h.states.get('ems.0.Devices.Wallbox0.OutputStatus').val,/Start/);
});
test('combined wallbox starts despite residual DHW power when measured net budget is sufficient', async () => {
    const h=setup();h.config.combinedProductionArmed=true;h.put('split',1);
    h.put('ems.0.Config.DHWParallelDistributionEnabled',true);
    h.put('ems.0.Devices.MyPV_DHW.ControlEnabled',true);
    h.put('ems.0.Control.Targets.MyPV_DHW_W',0);
    h.put('ems.0.Actual.MyPV_DHW_W',1000);
    await h.output.initialize();await h.output.tick();
    assert.deepEqual(h.writes,[{id:'allow',val:0}]);
    assert.match(h.states.get('ems.0.Devices.Wallbox0.OutputStatus').val,/Start/);
});

test('alpha mode arms all wallboxes but starts only the selected one', async () => {
    const h=setup();h.enableWallbox(1);h.enableWallbox(2);h.config.multiWallboxAlphaArmed=true;
    await h.start();
    assert.equal(h.states.get('ems.0.Devices.Wallbox0.OutputActive').val,true);
    assert.equal(h.states.get('ems.0.Devices.Wallbox1.OutputActive').val,false);
    assert.equal(h.states.get('ems.0.Devices.Wallbox2.OutputActive').val,false);
    assert.equal(h.writes.filter(write=>write.val===1).length,1);
    assert.deepEqual(h.writes.find(write=>write.val===1),{id:'allow',val:1});
});

test('alpha takeover first stops an externally running unowned wallbox', async () => {
    const h=setup();h.enableWallbox(2);h.config.multiWallboxAlphaArmed=true;
    h.put('ems.0.Control.Targets.Wallbox0_W',0);h.put('allow2',1);
    await h.output.initialize();await h.output.tick();
    assert.deepEqual(h.writes,[{id:'allow2',val:0}]);
    assert.equal(h.states.get('ems.0.Devices.Wallbox2.OutputActive').val,false);
    assert.match(h.states.get('ems.0.Devices.Wallbox2.OutputStatus').val,/ALPHA-Uebernahme/);
});

test('alpha handover waits for confirmed stop before enabling the next wallbox', async () => {
    const h=setup();h.enableWallbox(1);h.config.multiWallboxAlphaArmed=true;
    await h.start();h.writes.length=0;
    h.put('ems.0.Control.SelectedWallbox',1);
    h.put('ems.0.Control.Targets.Wallbox0_W',0);
    h.put('ems.0.Control.Targets.Wallbox1_W',7000);
    await h.output.tick();
    assert.deepEqual(h.writes,[{id:'allow',val:0}]);
    h.ack('allow',0);h.electricalOff();await h.output.tick();
    assert.deepEqual(h.writes,[{id:'allow',val:0},{id:'allow1',val:0}]);
    h.ack('allow1',0);await h.output.tick();h.ack('feedback1',6);await h.output.tick();
    h.ack('allow1',1);await h.output.tick();
    assert.equal(h.states.get('ems.0.Devices.Wallbox0.OutputOwned').val,false);
    assert.equal(h.states.get('ems.0.Devices.Wallbox1.OutputActive').val,true);
    assert.deepEqual(h.writes.slice(-2),[{id:'cmd1',val:6},{id:'allow1',val:1}]);
});

for (const [name, change] of [
    ['master off', h => { h.config.globalWriteEnabled = false; }],
    ['runtime master off', h => h.put('ems.0.System.RealOutputsEnabled', false)],
    ['controller off', h => h.put('ems.0.Control.Enabled', false)],
    ['wallbox disabled', h => h.put('ems.0.Devices.Wallbox0.ControlEnabled', false)],
    ['HA trip', h => h.put('critical', true)],
    ['invalid HA acknowledgement', h => h.put('critical', false, {ack:false})],
    ['car unplugged', h => h.put('car', 1)],
    ['device error', h => h.put('error', 8)],
    ['stale device error', h => h.put('error', 0, {ts:Date.now()-60000})],
    ['stale physical meter', h => h.put('import', 0, {ts:Date.now()-60000})],
    ['HA overload', h => h.put('h1', 70)],
    ['invalid LPC', h => h.put('lpc', 'failsafe')],
    ['zero LPC budget', h => { h.put('lpc','limited'); h.put('lpcLimit',0); }],
    ['vehicle release withdrawn', h => h.put('userAllow', false)]
]) test(`restart wait never masks ${name}`, async () => {
    const h=setup();
    h.put('ems.0.Control.RestartHandoffActive', true);
    h.put('ems.0.Control.RestartHandoffSince', Date.now());
    h.put('ems.0.Devices.Wallbox0.OutputOwned', true);
    h.put('ems.0.Devices.Wallbox0.OutputActive', true);
    h.put('allow',1); h.put('feedback',6); h.put('i1',6); h.put('power',1.38);
    h.put('ems.0.Plan.LastUpdate', 0); h.put('ems.0.Control.Valid',false);
    change(h);
    await h.output.initialize(); await h.output.tick();
    assert.deepEqual(h.writes,[{id:'allow',val:0}]);
    assert.equal(h.output.devices[0].recovering,false);
    assert.equal(h.states.get('ems.0.Control.RestartHandoffActive').val,false);
    h.ack('allow',0);h.electricalOff(); await h.output.tick(); await h.output.tick();
    assert.equal(h.output.devices[0].owned,false);
    assert.deepEqual(h.writes,[{id:'allow',val:0}]);
});

test('restart plan wait has a hard timeout even when control booleans remain valid', async () => {
    const h=setup();
    h.put('ems.0.Control.RestartHandoffActive',true);
    h.put('ems.0.Control.RestartHandoffSince',Date.now()-181000);
    h.put('ems.0.Plan.LastUpdate',0);
    h.put('ems.0.Devices.Wallbox0.OutputOwned',true);
    h.put('ems.0.Devices.Wallbox0.OutputActive',true);
    h.put('allow',1);h.put('feedback',6);h.put('i1',6);h.put('power',1.38);
    await h.output.initialize();await h.output.tick();
    assert.deepEqual(h.writes,[{id:'allow',val:0}]);
    assert.match(h.states.get('ems.0.Devices.Wallbox0.LastStopReason').val,/abgelaufen/);
});

test('restart adoption starts physical runtime protection before handling a zero target', async () => {
    const h=setup();
    h.put('ems.0.Control.RestartHandoffActive',true);
    h.put('ems.0.Control.RestartHandoffSince',Date.now());
    h.put('ems.0.Devices.Wallbox0.OutputOwned',true);
    h.put('ems.0.Devices.Wallbox0.OutputActive',true);
    h.put('allow',1);h.put('feedback',9);h.put('i1',9);h.put('power',2.07);
    h.put('ems.0.Control.Targets.Wallbox0_W',0);h.put('export',0);h.refresh();
    await h.output.initialize();await h.output.tick();
    assert.deepEqual(h.writes,[{id:'cmd',val:6}]);
    assert.equal(h.states.get('ems.0.Devices.Wallbox0.OutputActive').val,true);
    assert.equal(h.output.devices[0].recovering,false);
});

test('asynchronous allow acknowledgements can span several controller ticks without aborting start', async () => {
    const h=setup();h.put('feedback',6,{ts:Date.now()-1000});
    await h.output.initialize();await h.output.tick();
    for(let tick=0;tick<4;tick++) await h.output.tick();
    assert.deepEqual(h.writes,[{id:'allow',val:0}]);
    assert.equal(h.output.devices[0].pending.stage,'stop');
    h.ack('allow',0);await h.output.tick();
    for(let tick=0;tick<4;tick++) await h.output.tick();
    assert.equal(h.output.devices[0].pending.stage,'current');
    assert.ok(!h.writes.some(write=>write.id==='allow'&&write.val===1));
    h.ack('feedback',6);await h.output.tick();
    h.put('ems.0.Control.Targets.Wallbox0_W',0);h.put('export',0);
    for(let tick=0;tick<4;tick++) await h.output.tick();
    assert.equal(h.output.devices[0].pending.stage,'allow');
    assert.deepEqual(h.writes,[{id:'allow',val:0},{id:'cmd',val:6},{id:'allow',val:1}]);
    h.ack('allow',1);await h.output.tick();
    assert.equal(h.states.get('ems.0.Devices.Wallbox0.OutputActive').val,true);
    assert.equal(h.output.devices[0].fault,'');
});

test('same command/feedback state tolerates only its own pending ack=false current', async () => {
    const h=setup();h.config.wb0AmpereFeedbackId='cmd';h.put('cmd',6);
    await h.output.initialize();await h.output.tick();h.ack('allow',0);await h.output.tick();
    for(let tick=0;tick<4;tick++) await h.output.tick();
    assert.equal(h.output.devices[0].pending.stage,'current');
    assert.deepEqual(h.writes,[{id:'allow',val:0},{id:'cmd',val:6}]);
    h.ack('cmd',6);await h.output.tick();h.ack('allow',1);await h.output.tick();
    assert.equal(h.states.get('ems.0.Devices.Wallbox0.OutputActive').val,true);
    h.put('cmd',10,{ack:false});h.writes.length=0;await h.output.tick();
    assert.deepEqual(h.writes,[{id:'allow',val:0}]);
});

test('self-write feedback fallback cannot extend an expired physical confirmation', async () => {
    const h=setup();await h.output.initialize();await h.output.tick();
    h.output.devices[0].confirmedFeedback.allow.ts=Date.now()-31000;
    await h.output.tick();
    assert.equal(h.output.devices[0].pending,null);
    assert.ok(h.output.devices[0].stopRequest);
    assert.ok(!h.writes.some(write=>write.val===1));
});

test('stop awaits a device acknowledgement without writing OFF every controller tick', async () => {
    const h=setup();await h.start();h.writes.length=0;
    h.put('ems.0.Vehicles.Wallbox0.Release',false);await h.output.tick();
    const stoppedAt=h.states.get('ems.0.Devices.Wallbox0.LastStopAt').val;
    h.put('ems.0.Vehicles.Wallbox0.Release',true);
    for(let tick=0;tick<5;tick++) await h.output.tick();
    assert.deepEqual(h.writes,[{id:'allow',val:0}]);
    assert.equal(h.output.devices[0].owned,true);
    assert.equal(h.states.get('ems.0.Devices.Wallbox0.LastStopAt').val,stoppedAt);
    h.ack('allow',0);h.electricalOff();await h.output.tick();
    assert.equal(h.output.devices[0].owned,false);
    assert.equal(h.output.devices[0].stopRequest,null);
    assert.deepEqual(h.writes,[{id:'allow',val:0}]);
});

test('failed stop confirmation retries after timeout and never releases the interlock early', async () => {
    const h=setup();await h.start();h.writes.length=0;
    h.put('ems.0.System.RealOutputsEnabled',false);await h.output.tick();
    h.output.devices[0].stopRequest.lastAttempt-=21000;await h.output.tick();
    assert.deepEqual(h.writes,[{id:'allow',val:0},{id:'allow',val:0}]);
    assert.equal(h.output.devices[0].owned,true);
    assert.match(h.output.devices[0].fault,/AUS-Rueckmeldung/);
    h.ack('allow',0);h.electricalOff();await h.output.tick();
    assert.equal(h.output.devices[0].owned,false);
});

test('OFF acknowledgement retains residual load reservation until fresh electrical zero', async () => {
    let now = 1000000;
    const h = setup({now: () => now}); await h.start(); h.writes.length = 0;
    h.put('power', 3.68); h.put('i1', 16);
    h.put('ems.0.Vehicles.Wallbox0.Release', false); await h.output.tick();
    now += 1000; h.refresh(); h.ack('allow', 0); await h.output.tick();
    assert.equal(h.output.devices[0].owned, true);
    assert.equal(h.states.get('ems.0.Devices.Wallbox0.StopPowerPending').val, true);
    assert.equal(h.states.get('ems.0.Devices.Wallbox0.OutputReservedPower_W').val, 3680);
    for (let i = 0; i < 3; i++) { now += 1000; h.refresh(); await h.output.tick(); }
    assert.deepEqual(h.writes, [{id: 'allow', val: 0}]);
    h.electricalOff(); await h.output.tick();
    assert.equal(h.output.devices[0].owned, false);
    assert.equal(h.states.get('ems.0.Devices.Wallbox0.OutputReservedPower_W').val, 0);
    assert.equal(h.states.get('ems.0.Devices.Wallbox0.StopPowerPending').val, false);
});

test('an OFF sample older than the stop command cannot complete its acknowledgement', async () => {
    let now = 1000000;
    const h = setup({now: () => now}); await h.start();
    h.put('ems.0.Vehicles.Wallbox0.Release', false); await h.output.tick();
    h.put('allow', 0, {ts: now - 1}); h.electricalOff(); await h.output.tick();
    assert.equal(h.output.devices[0].owned, true);
    assert.equal(h.states.get('ems.0.Devices.Wallbox0.StopConfirmedAt').val, 0);
    now += 1000; h.refresh(); h.ack('allow', 0); h.electricalOff(); await h.output.tick();
    assert.equal(h.output.devices[0].owned, false);
});

test('external OFF on a previously active charger still requires post-OFF electrical samples', async () => {
    let now = 1000000;
    const h = setup({now: () => now}); await h.start(); h.writes.length = 0;
    now += 1000; h.ack('allow', 0); h.put('ems.0.Vehicles.Wallbox0.Release', false);
    await h.output.tick();
    assert.deepEqual(h.writes, []);
    assert.equal(h.output.devices[0].owned, true);
    assert.equal(h.states.get('ems.0.Devices.Wallbox0.StopPowerPending').val, true);
    assert.equal(h.states.get('ems.0.Devices.Wallbox0.OutputReservedPower_W').val, 1380);
    h.electricalOff(); await h.output.tick();
    assert.equal(h.output.devices[0].owned, false);
});

for (const [name, change] of [
    ['positive power', h => h.put('power1', 1.38)],
    ['positive phase current', h => h.put('i11', 6)],
    ['missing power', h => h.states.delete('power1')],
    ['null phase current', h => h.put('i12', null)],
    ['stale power', h => h.put('power1', 0, {ts: Date.now() - 31000})],
    ['bad current quality', h => h.put('i13', 0, {q: 0x40})]
]) test(`peer OFF alone cannot start a new charger: ${name}`, async () => {
    const h = setup(); h.enableWallbox(1); h.config.multiWallboxAlphaArmed = true;
    change(h); await h.output.initialize(); await h.output.tick();
    assert.deepEqual(h.writes, []);
    assert.equal(h.states.get('ems.0.Devices.Wallbox0.OutputStatus').val,
        'Sequenzbetrieb: elektrische AUS-Bestaetigung Wallbox 1 fehlt');
    h.electricalOff(1); await h.output.tick();
    assert.deepEqual(h.writes, [{id: 'allow', val: 0}]);
});

test('unknown assumed peer response blocks startup despite real zero until valid modeled zero', async () => {
    let peerEvidence = {valid: false, assumed: true, currentA: 0};
    const h = setup({responseEvidence: wb => wb === 0 ? peerEvidence
        : {valid: true, assumed: true, currentA: 6}});
    h.enableWallbox(1);
    h.config.multiWallboxAlphaArmed = true;
    h.put('ems.0.Control.SelectedWallbox', 1);
    h.put('ems.0.Control.Targets.Wallbox1_W', 4140);
    await h.output.initialize();
    await h.output.tick();
    await h.output.tick();
    assert.deepEqual(h.writes, [], 'unknown modeled OFF must not invoke an actuator');
    assert.equal(h.states.get('ems.0.Devices.Wallbox1.OutputStatus').val,
        'Sequenzbetrieb: elektrische Schattenantwort Wallbox 0 unbekannt; Modell-AUS-Bestaetigung fehlt');
    assert.equal(h.states.get('ems.0.Devices.Wallbox1.OutputActive').val, false);
    assert.equal(h.states.get('power').val, 0, 'the real idle Mii is not treated as virtual OFF proof');

    peerEvidence = {valid: true, assumed: true, currentA: 0};
    await h.output.tick(); h.ack('allow1', 0);
    await h.output.tick(); h.ack('feedback1', 6);
    await h.output.tick(); h.ack('allow1', 1);
    await h.output.tick();
    assert.deepEqual(h.writes, [{id: 'allow1', val: 0}, {id: 'cmd1', val: 6}, {id: 'allow1', val: 1}]);
    assert.equal(h.states.get('ems.0.Devices.Wallbox1.OutputActive').val, true);
    assert.ok(!h.writes.some(write => ['allow', 'cmd'].includes(write.id)), 'idle peer remains untouched');
});

test('valid assumed peer draw is identified as missing modeled OFF proof', async () => {
    const h = setup({responseEvidence: wb => ({valid: true, assumed: true, currentA: wb === 1 ? 6 : 0})});
    h.enableWallbox(1);
    h.config.multiWallboxAlphaArmed = true;
    await h.output.initialize(); await h.output.tick();
    assert.deepEqual(h.writes, []);
    assert.equal(h.states.get('ems.0.Devices.Wallbox0.OutputStatus').val,
        'Sequenzbetrieb: elektrische Modell-AUS-Bestaetigung Wallbox 1 fehlt');
});

for (const currentA of [undefined, null, NaN, Infinity, -1])
    test(`unusable assumed peer current stays unknown and blocks startup: ${String(currentA)}`, async () => {
        const h = setup({responseEvidence: wb => ({valid: true, assumed: true, currentA: wb === 1 ? currentA : 0})});
        h.enableWallbox(1);
        h.config.multiWallboxAlphaArmed = true;
        await h.output.initialize(); await h.output.tick();
        assert.deepEqual(h.writes, []);
        assert.equal(h.states.get('ems.0.Devices.Wallbox0.OutputStatus').val,
            'Sequenzbetrieb: elektrische Schattenantwort Wallbox 1 unbekannt; Modell-AUS-Bestaetigung fehlt');
    });

test('peer interlock grants only a bounded same-selected-vehicle resume token', async () => {
    let now = 1000000;
    const h = setup({now: () => now}); h.enableWallbox(1); h.config.multiWallboxAlphaArmed = true;
    await h.start(); h.put('allow1', 1); await h.output.tick();
    assert.equal(h.states.get('ems.0.Devices.Wallbox0.SequenceResumePending').val, true);
    const until = h.states.get('ems.0.Devices.Wallbox0.SequenceResumeUntil').val;
    assert.equal(until, now + 65000);
    now += 1000; h.refresh(); await h.output.tick();
    assert.equal(h.states.get('ems.0.Devices.Wallbox0.SequenceResumeUntil').val, until);
    h.put('ems.0.Control.SelectedWallbox', 1); await h.output.tick();
    assert.equal(h.states.get('ems.0.Devices.Wallbox0.SequenceResumePending').val, false);
});

test('stop timer is visible, reset on recovered budget, and cleared on hard stop', async () => {
    const h=setup();await h.start();h.output.devices[0].activeSince-=601000;
    h.put('ems.0.Control.Targets.Wallbox0_W',0);h.put('export',0);await h.output.tick();
    assert.equal(h.states.get('ems.0.Devices.Wallbox0.StopDelayActive').val,true);
    assert.equal(h.states.get('ems.0.Devices.Wallbox0.StopDelayRemaining_s').val,120);
    h.put('ems.0.Control.Targets.Wallbox0_W',7000);h.put('export',8000);await h.output.tick();
    assert.equal(h.states.get('ems.0.Devices.Wallbox0.StopDelayActive').val,false);
    h.put('ems.0.Control.Targets.Wallbox0_W',0);h.put('export',0);await h.output.tick();
    h.put('critical',true);await h.output.tick();
    assert.equal(h.states.get('ems.0.Devices.Wallbox0.StopDelayActive').val,false);
    assert.equal(h.states.get('ems.0.Devices.Wallbox0.StopDelayRemaining_s').val,0);
});

test('fractional physical caps are rounded down before a mandatory start command', async () => {
    const h=setup();h.config.wb0AvailableCurrentId='available';h.put('available',6.5);
    h.put('soc',10);h.put('ems.0.Vehicles.Wallbox0.RequestedMinimumCurrent_A',16);
    await h.start();
    assert.deepEqual(h.writes,[{id:'allow',val:0},{id:'cmd',val:6},{id:'allow',val:1}]);
    assert.equal(h.output.devices[0].fault,'');
});

test('unbalanced three-phase currents cannot borrow headroom from another phase', async () => {
    const h=setup();Object.assign(h.config,{wb0PhaseSwitchEnabled:true,wb0PhaseModeId:'phaseMode',
        wb0MaxCurrent3pA:32,wb0MaxPowerW:22080});
    h.put('phaseMode',2);h.put('ems.0.Control.Targets.Wallbox0_Phases',3);
    h.put('ems.0.Control.Targets.Wallbox0_W',22080);await h.start();
    h.output.devices[0].lastAt-=10000;
    h.put('i1',16);h.put('i2',6);h.put('i3',6);h.put('h2',49);h.put('power',6.44);
    h.writes.length=0;await h.output.tick();
    assert.deepEqual(h.writes,[]);
    assert.equal(h.states.get('ems.0.Devices.Wallbox0.OutputCommand_A').val,6);
});

test('shared LPC cap deducts physically active heater power from wallbox headroom', async () => {
    const h=setup();h.config.combinedProductionArmed=true;h.config.wallboxCombinedMaxStepA=6;
    h.put('ems.0.Config.DHWParallelDistributionEnabled',true);
    h.put('ems.0.Devices.MyPV_DHW.ControlEnabled',true);
    h.put('ems.0.Control.Targets.MyPV_DHW_W',2500);h.put('ems.0.Actual.MyPV_DHW_W',2500);
    h.put('lpc','limited');h.put('lpcLimit',4200);
    await h.start();h.output.devices[0].lastAt-=10000;
    h.put('i1',6);h.put('power',1.38);h.writes.length=0;await h.output.tick();
    assert.deepEqual(h.writes,[{id:'cmd',val:7}]);
});

test('configured missing EHZ feedback never allows a wallbox increase based on a stale mirror', async () => {
    const h=setup();h.config.combinedProductionArmed=true;
    h.put('ems.0.Config.DHWParallelDistributionEnabled',true);
    h.put('ems.0.Devices.MyPV_DHW.ControlEnabled',true);
    Object.assign(h.config,{dhwOutput1Id:'ehz1',dhwOutput2Id:'ehz2',dhwOutput3Id:'ehz3'});
    h.put('ehz1',0);h.put('ehz2',0);h.put('ehz3',0,{ts:Date.now()-121000});
    h.put('ems.0.Actual.MyPV_DHW_W',0);
    await h.output.initialize();await h.output.tick();
    assert.deepEqual(h.writes,[]);
    assert.match(h.states.get('ems.0.Devices.Wallbox0.OutputStatus').val,/EHZ/);
});

test('waitForIdle drains an in-flight ownership persist before shutdown', async () => {
    const h=setup();await h.output.initialize();
    let resume;const persisted=new Promise(resolve=>{resume=resolve;});
    const write=h.adapter.setCompatState;
    h.adapter.setCompatState=(id,val)=>{
        if(id==='ems.0.Devices.Wallbox0.OutputOwned'&&val===true)
            return persisted.then(()=>write(id,val));
        return write(id,val);
    };
    const tick=h.output.tick();await Promise.resolve();await Promise.resolve();
    assert.equal(h.output.busy,true);
    h.output.stopping=true;
    let drained=false;const idle=h.output.waitForIdle().then(()=>{drained=true;});
    await Promise.resolve();assert.equal(drained,false);
    resume();await tick;await idle;await h.output.stopAll();
    assert.equal(drained,true);
    assert.ok(!h.writes.some(write=>write.val===1||write.id==='cmd'));
});

test('initialization failure retains other verified owners for best-effort shutdown', async () => {
    const h=setup();h.enableWallbox(2);
    h.put('ems.0.Devices.Wallbox2.OutputOwned',true);h.put('ems.0.Devices.Wallbox2.OutputActive',true);
    h.put('allow2',1);
    h.adapter.getForeignStateAsync=async()=>{throw new Error('read failed');};
    await assert.rejects(h.output.initialize(),/read failed/);
    assert.equal(h.output.devices[2].owned,true);
    h.output.stopping=true;await h.output.stopAll();
    assert.deepEqual(h.writes,[{id:'allow2',val:0}]);
    assert.equal(h.states.get('ems.0.Devices.Wallbox2.OutputActive').val,false);
});

test('failure stopping one owned wallbox does not skip the other owned wallboxes', async () => {
    const h=setup();h.enableWallbox(1);await h.output.initialize();
    h.output.devices[0].owned=true;h.output.devices[1].owned=true;h.put('allow',1);h.put('allow1',1);
    const write=h.adapter.setForeignStateAsync;
    h.adapter.setForeignStateAsync=async(id,val)=>{if(id==='allow')throw new Error('offline');return write(id,val);};
    await assert.rejects(h.output.stopAll(),/Nicht alle/);
    assert.deepEqual(h.writes,[{id:'allow1',val:0}]);
});

for(const stage of ['stop','current','allow']) test(`hard safety remains immediate during pending ${stage}`,async()=>{
    const h=setup();await h.output.initialize();await h.output.tick();
    if(stage!=='stop'){h.ack('allow',0);await h.output.tick();}
    if(stage==='allow'){h.ack('feedback',6);await h.output.tick();}
    assert.equal(h.output.devices[0].pending.stage,stage);
    h.put('critical',true);h.writes.length=0;await h.output.tick();
    assert.equal(h.output.devices[0].pending,null);
    assert.equal(h.states.get('ems.0.Devices.Wallbox0.OutputActive').val,false);
    assert.ok(!h.writes.some(write=>write.val!==0));
    if(stage==='allow')assert.deepEqual(h.writes,[{id:'allow',val:0}]);
});

test('waitForIdle also drains unfinished initialization with persisted ownership',async()=>{
    const h=setup();
    h.put('ems.0.Devices.Wallbox0.OutputOwned',true);h.put('ems.0.Devices.Wallbox0.OutputActive',true);
    h.put('allow',1);
    let resume,readStarted;
    const paused=new Promise(resolve=>{resume=resolve;});
    const started=new Promise(resolve=>{readStarted=resolve;});
    const get=h.adapter.getForeignStateAsync;let first=true;
    h.adapter.getForeignStateAsync=async id=>{
        if(first){first=false;readStarted();await paused;}
        return get(id);
    };
    const initializing=h.output.initialize();await started;
    assert.equal(h.output.devices[0].owned,true);
    h.output.stopping=true;let drained=false;
    const idle=h.output.waitForIdle().then(()=>{drained=true;});
    await Promise.resolve();assert.equal(drained,false);
    resume();await initializing;await idle;await h.output.stopAll();
    assert.equal(drained,true);
    assert.deepEqual(h.writes,[{id:'allow',val:0}]);
    assert.equal(h.states.get('ems.0.Devices.Wallbox0.OutputActive').val,false);
});

test('invalid timestamps and boolean physical measurements fail closed',()=>{
    const h=setup();
    for(const timestamp of [undefined,NaN,Infinity,Date.now()+5000]){
        h.put('power',1,{ts:timestamp});assert.equal(h.output.number('power'),null);
    }
    for(const value of [false,[],{},' ']){
        h.put('power',value);assert.equal(h.output.number('power'),null);
    }
});

test('user release switches deliberately written ack=false remain valid commands',async()=>{
    const h=setup();h.put('userAllow',true,{ack:false});await h.start();
    assert.equal(h.states.get('ems.0.Devices.Wallbox0.OutputActive').val,true);
    h.writes.length=0;h.put('userAllow',false,{ack:false});await h.output.tick();
    assert.deepEqual(h.writes,[{id:'allow',val:0}]);
});

test('multi-wallbox restart keeps the prior owned charger while initial selection is -1',async()=>{
    const h=setup();h.enableWallbox(1);h.enableWallbox(2);h.config.multiWallboxAlphaArmed=true;
    h.put('ems.0.Control.RestartHandoffActive',true);
    h.put('ems.0.Control.RestartHandoffSince',Date.now());
    h.put('ems.0.Devices.Wallbox2.OutputOwned',true);h.put('ems.0.Devices.Wallbox2.OutputActive',true);
    h.put('allow2',1);h.put('feedback2',9);h.put('i21',9);h.put('power2',2.07);
    h.put('ems.0.Control.SelectedWallbox',-1);h.put('ems.0.Plan.Valid',false);
    h.put('ems.0.Plan.LastUpdate',0);h.put('ems.0.Control.Valid',false);
    h.put('ems.0.Control.Targets.Wallbox2_W',0);
    await h.output.initialize();await h.output.tick();
    assert.deepEqual(h.writes,[]);
    assert.equal(h.output.devices[2].recovering,true);
    assert.match(h.states.get('ems.0.Devices.Wallbox2.OutputStatus').val,/frisch berechneten Fahrplan/);
    h.put('ems.0.System.RealOutputsEnabled',false);await h.output.tick();
    assert.deepEqual(h.writes,[{id:'allow2',val:0}]);
    assert.equal(h.output.devices[2].recovering,false);
});

for(const [name,change] of [
    ['unacknowledged ON',h=>h.put('allow1',1,{ack:false})],
    ['unacknowledged OFF',h=>h.put('allow1',0,{ack:false})],
    ['missing',h=>h.states.delete('allow1')],
    ['null',h=>h.put('allow1',null)],
    ['stale OFF',h=>h.put('allow1',0,{ts:Date.now()-31000})],
    ['invalid quality',h=>h.put('allow1',0,{q:0x40})],
    ['future timestamp',h=>h.put('allow1',0,{ts:Date.now()+60000})]
]) test(`multi-wallbox start requires peer confirmed OFF: ${name}`,async()=>{
    const h=setup();h.enableWallbox(1);h.config.multiWallboxAlphaArmed=true;change(h);
    await h.output.initialize();await h.output.tick();await h.output.tick();
    assert.deepEqual(h.writes,[]);
    assert.equal(h.states.get('ems.0.Devices.Wallbox0.OutputActive').val,false);
    assert.match(h.states.get('ems.0.Devices.Wallbox0.OutputStatus').val,/bestaetigte AUS-Rueckmeldung Wallbox 1 fehlt/);
    h.ack('allow1',0);await h.output.tick();h.ack('allow',0);await h.output.tick();
    h.ack('feedback',6);await h.output.tick();h.ack('allow',1);await h.output.tick();
    assert.equal(h.states.get('ems.0.Devices.Wallbox0.OutputActive').val,true);
    assert.ok(!h.writes.some(write=>write.id==='allow1'));
});

test('unknown peer during pending current cannot slip through the final enable step',async()=>{
    const h=setup();h.enableWallbox(1);h.config.multiWallboxAlphaArmed=true;
    await h.output.initialize();await h.output.tick();h.ack('allow',0);await h.output.tick();
    h.ack('feedback',6);h.put('allow1',1,{ack:false});h.writes.length=0;await h.output.tick();
    assert.deepEqual(h.writes,[]);
    assert.equal(h.output.devices[0].owned,false);
    assert.equal(h.states.get('ems.0.Devices.Wallbox0.OutputActive').val,false);
    assert.match(h.states.get('ems.0.Devices.Wallbox0.OutputStatus').val,/bestaetigte AUS-Rueckmeldung/);
});

test('an established selected charger survives an idle peer telemetry gap',async()=>{
    const h=setup();h.enableWallbox(1);h.config.multiWallboxAlphaArmed=true;await h.start();
    h.writes.length=0;h.put('allow1',0,{ts:Date.now()-31000});await h.output.tick();
    assert.deepEqual(h.writes,[]);
    assert.equal(h.states.get('ems.0.Devices.Wallbox0.OutputActive').val,true);
});

// Reproduce the observed EQV interruption with the selected WB1 already
// charging. A disconnected peer's allow=1 is only benign when every source
// independently proves it is idle after the release edge. Exercise both
// device orders: WB0 is processed before the EQV, WB2 afterwards.
async function establishedEqvWithIdleRelease(peer = 2) {
    let now = 1000000;
    const h = setup({now: () => now});
    h.enableWallbox(1);
    if (peer === 2) h.enableWallbox(2);
    h.config.multiWallboxAlphaArmed = true;
    h.put('ems.0.Control.SelectedWallbox', 1);
    h.put('ems.0.Control.Targets.Wallbox1_W', 1380);
    await h.start(1);
    now += 1000; h.refresh();
    h.put('power1', 1.38); h.put('i11', 6);
    await h.output.tick();
    const activeSince = h.output.devices[1].activeSince;
    assert.equal(h.states.get('ems.0.Devices.Wallbox1.OutputActive').val, true);
    const id = kind => peer === 0 ? ({car: 'car', allow: 'allow', power: 'power',
        L1: 'i1', L2: 'i2', L3: 'i3', connection: 'connection', error: 'error'})[kind]
        : ({car: `car${peer}`, allow: `allow${peer}`, power: `power${peer}`,
            L1: `i${peer}1`, L2: `i${peer}2`, L3: `i${peer}3`, connection: `connection${peer}`,
            error: `error${peer}`})[kind];
    now += 1000; h.refresh();
    const edge = now;
    h.put(id('allow'), 1, {lc: edge, ts: edge + 1, q: 0});
    h.put(id('car'), 1, {ts: edge + 1, q: 0});
    h.put(id('connection'), true, {ts: edge + 1, q: 0});
    for (const kind of ['power', 'L1', 'L2', 'L3'])
        h.put(id(kind), 0, {ts: edge + 2, q: 0});
    h.writes.length = 0;
    const advance = (ms = 1000) => { now += ms; h.refresh(); };
    return {h, peer, id, edge, activeSince, advance};
}

async function parallelEqvWithIdleRelease(peer = 2) {
    const fixture = await establishedEqvWithIdleRelease(peer);
    const {h} = fixture;
    h.config.wallboxParallelChargingEnabled = true;
    h.put('ems.0.Config.WallboxParallelChargingEnabled', true);
    const publishAllocation = () => {
        const allocations = h.output.enabledDevices().map(d => {
            const targetA = d.wb === 1 ? 6 : 0;
            h.put(`ems.0.Control.Targets.Wallbox${d.wb}_W`, targetA * 230);
            h.put(`ems.0.Control.Targets.Wallbox${d.wb}_A`, targetA);
            h.put(`ems.0.Control.Targets.Wallbox${d.wb}_Phases`, 1);
            return {wb: d.wb, authorized: d.wb === 1, targetA, phases: 1,
                reservedW: targetA * 230, minimumW: 0, pvBudgetW: targetA * 230};
        });
        h.put('ems.0.Control.ParallelWallboxAllocation_JSON', JSON.stringify({schema: 1, valid: true,
            timestamp: h.states.get('ems.0.Control.LastUpdate').val, voltage: 230,
            order: [1], budgetW: 1380, hardBudgetW: 8000, allocations}));
    };
    publishAllocation();
    return {...fixture, publishAllocation, advance: (ms = 1000) => {
        fixture.advance(ms); publishAllocation();
    }};
}

for (const peer of [0, 2]) test(`parallel EQV charging actively clears idle WB${peer} release before replug`, async () => {
    const {h, id, activeSince, advance} = await parallelEqvWithIdleRelease(peer);
    assert.equal(h.output.parallelAllocation(1).valid, true,
        'exercise the full productive update with a valid shared allocation');
    await h.output.tick();
    assert.deepEqual(h.writes.filter(write => write.id === id('allow')), [{id: id('allow'), val: 0}],
        'a zero-budget empty peer must receive OFF even while an established selected charger runs');
    assert.equal(h.output.devices[peer].owned, true,
        'an OFF operation remains owned until the physical ACK');
    assert.ok(h.output.devices[peer].stopRequest);
    for (let tick = 0; tick < 3; tick++) {
        advance(); await h.output.tick();
        assert.equal(h.output.devices[peer].owned, true);
        assert.ok(h.output.devices[peer].stopRequest);
        assert.equal(h.output.devices[1].activeSince, activeSince);
        assert.equal(h.states.get('ems.0.Devices.Wallbox1.OutputActive').val, true);
        assert.equal(h.states.get('ems.0.Devices.Wallbox1.SequenceResumePending').val, false);
    }
    assert.equal(h.writes.filter(write => write.id === id('allow')).length, 1,
        'normal Modbus latency must not rewrite OFF every controller tick');
    assert.ok(!h.writes.some(write => write.id === 'allow1' && write.val === 0),
        'cleaning an empty parallel peer must retain the established EQV session');

    // A replug can happen while the OFF acknowledgement is still in flight.
    // The zero shared allocation and explicit user release stay withdrawn.
    h.put(id('car'), 2); h.put(peer === 0 ? 'userAllow' : `userAllow${peer}`, false);
    h.put(`ems.0.Vehicles.Wallbox${peer}.Release`, false);
    advance(); await h.output.tick();
    assert.ok(!h.writes.some(write => write.id === id('allow') && write.val === 1));
    assert.equal(h.output.devices[peer].owned, true);

    h.ack(id('allow'), 0);
    const offAckAt = h.states.get(id('allow')).ts;
    for (const kind of ['power', 'L1', 'L2', 'L3'])
        h.put(id(kind), 0, {ts: offAckAt - 1});
    await h.output.tick();
    assert.equal(h.output.devices[peer].owned, true,
        'pre-ACK electrical zero samples cannot complete the stop');
    assert.equal(h.states.get(`ems.0.Devices.Wallbox${peer}.StopPowerPending`).val, true);
    for (const kind of ['power', 'L1', 'L2', 'L3'])
        h.put(id(kind), 0, {ts: offAckAt + 1});
    await h.output.tick();
    assert.equal(h.output.devices[peer].owned, false);
    assert.equal(h.output.devices[peer].stopRequest, null);
    assert.equal(h.states.get(`ems.0.Devices.Wallbox${peer}.OutputReservedPower_W`).val, 0);
    advance(); await h.output.tick();
    assert.ok(!h.writes.some(write => write.id === id('allow') && write.val === 1),
        'replug must not resurrect an ON command without a positive grant and user release');
    assert.equal(h.output.devices[1].activeSince, activeSince);
});

test('parallel idle-peer OFF retains electrical draw reservation until fresh OFF and rest', async () => {
    const {h, id, activeSince, advance} = await parallelEqvWithIdleRelease(2);
    await h.output.tick();
    assert.ok(h.writes.some(write => write.id === id('allow') && write.val === 0));
    advance(); h.put(id('car'), 2); h.put(id('power'), 0.2); h.put(id('L1'), 1);
    await h.output.tick();
    const reservedW = h.output.parallelLoadReservations(h.mapping, 1).wallboxesW[2];
    assert.ok(reservedW >= 230,
        'unexpected draw during OFF response remains reserved in the common load budget');
    assert.equal(h.output.devices[2].owned, true);
    h.ack(id('allow'), 0); await h.output.tick();
    assert.equal(h.output.devices[2].owned, true);
    assert.equal(h.states.get('ems.0.Devices.Wallbox2.StopPowerPending').val, true);
    assert.ok(h.output.parallelLoadReservations(h.mapping, 1).wallboxesW[2] >= reservedW);
    advance(); h.electricalOff(2); await h.output.tick();
    assert.equal(h.output.devices[2].owned, false);
    assert.equal(h.states.get('ems.0.Devices.Wallbox2.OutputReservedPower_W').val, 0);
    assert.ok(!h.writes.some(write => write.id === 'allow1' && write.val === 0));
    assert.equal(h.output.devices[1].activeSince, activeSince);
});

test('parallel idle-peer missing OFF ACK retries only at its deadline and never releases the peer', async () => {
    const {h, id, activeSince, advance} = await parallelEqvWithIdleRelease(2);
    await h.output.tick();
    assert.ok(h.writes.some(write => write.id === id('allow') && write.val === 0));
    const firstAttempt = h.output.devices[2].stopRequest.lastAttempt;
    advance(19000); await h.output.tick();
    assert.equal(h.output.devices[2].stopRequest.lastAttempt, firstAttempt);
    assert.equal(h.writes.filter(write => write.id === id('allow')).length, 1);
    advance(1000); await h.output.tick();
    assert.equal(h.writes.filter(write => write.id === id('allow')).length, 2,
        'the actual configured feedback timeout permits one bounded OFF retry');
    assert.match(h.output.devices[2].fault, /AUS-Rueckmeldung fehlt/);
    const retryAttempt = h.output.devices[2].stopRequest.lastAttempt;
    for (let tick = 0; tick < 3; tick++) {
        advance(); await h.output.tick();
        assert.equal(h.output.devices[2].stopRequest.lastAttempt, retryAttempt);
        assert.equal(h.output.devices[2].owned, true);
        assert.equal(h.output.devices[1].activeSince, activeSince);
    }
    h.ack(id('allow'), 0); h.electricalOff(2); await h.output.tick();
    assert.equal(h.output.devices[2].owned, false);
    assert.match(h.output.devices[2].fault, /AUS-Rueckmeldung fehlt/,
        'a delayed stop ACK must not reset the existing fault lock');
    h.put(id('car'), 2); advance(); await h.output.tick();
    assert.ok(!h.writes.some(write => write.id === id('allow') && write.val === 1));
    assert.ok(!h.writes.some(write => write.id === 'allow1' && write.val === 0));
    assert.equal(h.output.devices[1].activeSince, activeSince);
});

for (const [name, change] of [
    ['Master/output release OFF', ({h}) => h.put('ems.0.System.RealOutputsEnabled', false)],
    ['global writing disabled', ({h}) => { h.config.globalWriteEnabled = false; }],
    ['alpha authority not confirmed', ({h}) => { h.config.multiWallboxAlphaArmed = false; }],
    ['peer not armed', ({h, peer}) => { h.config[`wb${peer}ProductionArmed`] = false; }],
    ['peer control disabled', ({h, peer}) => { h.config[`wb${peer}ControlEnabled`] = false; }],
    ['peer not present', ({h, peer}) => { h.config[`wb${peer}Present`] = false; }],
    ['peer output configuration unconfirmed', ({h, peer}) => { h.output.devices[peer].valid = false; }]
]) test(`parallel idle-peer cleanup makes no peer writes when ${name}`, async () => {
    const fixture = await parallelEqvWithIdleRelease(2);
    change(fixture);
    await fixture.h.output.tick();
    assert.ok(!fixture.h.writes.some(write => write.id === fixture.id('allow')),
        'unowned peer cleanup must respect productive write authority');
    assert.equal(fixture.h.output.devices[fixture.peer].owned, false);
});

for (const peer of [0, 2]) test(`established EQV survives confirmed no-car idle release from WB${peer}`, async () => {
    const {h, id, edge, activeSince, advance} = await establishedEqvWithIdleRelease(peer);
    for (let tick = 0; tick < 4; tick++) {
        if (tick > 0) {
            advance();
            h.put(id('allow'), 1, {lc: edge, q: 0});
        }
        await h.output.tick();
        assert.ok(!h.writes.some(write => write.id === 'allow1' && write.val === 0),
            'idle peer cleanup must not revoke the selected EQV release');
        assert.equal(h.states.get('ems.0.Devices.Wallbox1.OutputActive').val, true);
        assert.equal(h.output.devices[1].activeSince, activeSince,
            'running EQV must retain its original minimum-runtime clock');
        assert.equal(h.states.get('ems.0.Devices.Wallbox1.SequenceResumePending').val, false);
        assert.equal(h.output.devices[peer].owned, false,
            'an idle peer must not become an owned takeover stop on the next tick');
    }
});

test('no-car idle exception uses release ts when lc is absent and requires electrical samples after it', async () => {
    const {h, id, edge, activeSince} = await establishedEqvWithIdleRelease();
    h.put(id('allow'), 1, {ts: edge + 1, q: 0});
    await h.output.tick();
    assert.ok(!h.writes.some(write => write.id === 'allow1' && write.val === 0));
    assert.equal(h.output.devices[1].activeSince, activeSince);
    assert.equal(h.states.get('ems.0.Devices.Wallbox1.OutputActive').val, true);
});

test('unchanged release polling does not demand electrical samples after the newer allow ts', async () => {
    const {h, id, edge, activeSince} = await establishedEqvWithIdleRelease();
    h.put(id('allow'), 1, {lc: edge - 1000, ts: edge + 1, q: 0});
    for (const kind of ['power', 'L1', 'L2', 'L3'])
        h.put(id(kind), 0, {ts: edge - 500, q: 0});
    await h.output.tick();
    assert.ok(!h.writes.some(write => write.id === 'allow1' && write.val === 0));
    assert.equal(h.output.devices[1].activeSince, activeSince);
    assert.equal(h.states.get('ems.0.Devices.Wallbox1.OutputActive').val, true);
});

test('small signed power noise and bounded nonnegative currents remain idle', async () => {
    const {h, id, activeSince} = await establishedEqvWithIdleRelease();
    h.put(id('power'), -0.02, {q: 0});
    h.put(id('L1'), 0, {q: 0}); h.put(id('L2'), 0.5, {q: 0});
    await h.output.tick();
    assert.ok(!h.writes.some(write => write.id === 'allow1' && write.val === 0));
    assert.equal(h.output.devices[1].activeSince, activeSince);
    assert.equal(h.states.get('ems.0.Devices.Wallbox1.OutputActive').val, true);
});

for (const car of [2, 3, 4]) test(`EQV still stops for an ON peer reporting connected car state ${car}`, async () => {
    const {h, id} = await establishedEqvWithIdleRelease();
    h.put(id('car'), car, {q: 0});
    await h.output.tick();
    assert.ok(h.writes.some(write => write.id === 'allow1' && write.val === 0));
    assert.equal(h.states.get('ems.0.Devices.Wallbox1.OutputActive').val, false);
});

for (const [name, change] of [
    ['missing car', ({h, id}) => h.states.delete(id('car'))],
    ['null car', ({h, id}) => h.put(id('car'), null, {q: 0})],
    ['stale car', ({h, id, edge}) => h.put(id('car'), 1, {ts: edge - 31000, q: 0})],
    ['car sample before allow edge', ({h, id, edge}) => h.put(id('car'), 1, {ts: edge - 1, q: 0})],
    ['unacknowledged car', ({h, id}) => h.put(id('car'), 1, {ack: false, q: 0})],
    ['bad car quality', ({h, id}) => h.put(id('car'), 1, {q: 0x40})],
    ['device reports an error', ({h, id}) => h.put(id('error'), 5, {q: 0})],
    ['missing device error status', ({h, id}) => h.states.delete(id('error'))],
    ['stale device error status', ({h, id, edge}) => h.put(id('error'), 0, {ts: edge - 31000, q: 0})],
    ['unacknowledged device error status', ({h, id}) => h.put(id('error'), 0, {ack: false, q: 0})],
    ['bad device error status quality', ({h, id}) => h.put(id('error'), 0, {q: 0x40})],
    ['future car sample', ({h, id, edge}) => h.put(id('car'), 1, {ts: edge + 2000, q: 0})],
    ['null power', ({h, id}) => h.put(id('power'), null, {q: 0})],
    ['bad power quality', ({h, id}) => h.put(id('power'), 0, {q: 0x40})],
    ['future power sample', ({h, id, edge}) => h.put(id('power'), 0, {ts: edge + 2000, q: 0})],
    ['missing L1 current', ({h, id}) => h.states.delete(id('L1'))],
    ['unacknowledged L2 current', ({h, id}) => h.put(id('L2'), 0, {ack: false, q: 0})],
    ['stale L3 current', ({h, id, edge}) => h.put(id('L3'), 0, {ts: edge - 31000, q: 0})],
    ['bad L3 current quality', ({h, id}) => h.put(id('L3'), 0, {q: 0x40})],
    ['missing connection', ({h, id}) => h.states.delete(id('connection'))],
    ['null connection', ({h, id}) => h.put(id('connection'), null, {q: 0})],
    ['offline connection', ({h, id}) => h.put(id('connection'), false, {q: 0})],
    ['unacknowledged connection', ({h, id}) => h.put(id('connection'), true, {ack: false, q: 0})],
    ['bad connection quality', ({h, id}) => h.put(id('connection'), true, {q: 0x40})],
    ['stale connection', ({h, id, edge}) => h.put(id('connection'), true, {ts: edge - 31000, q: 0})],
    ['future connection sample', ({h, id, edge}) => h.put(id('connection'), true, {ts: edge + 2000, q: 0})],
    ['electrical sample before allow edge', ({h, id, edge}) => h.put(id('L2'), 0, {ts: edge - 1, q: 0})],
    ['power despite no-car status', ({h, id}) => h.put(id('power'), 0.2, {q: 0})],
    ['invalid negative power', ({h, id}) => h.put(id('power'), -0.03, {q: 0})],
    ['phase current despite no-car status', ({h, id}) => h.put(id('L3'), 0.6, {q: 0})],
    ['invalid negative phase current', ({h, id}) => h.put(id('L1'), -0.1, {q: 0})],
    ['invalid release edge', ({h, id, edge}) => h.put(id('allow'), 1, {lc: edge + 60000, q: 0})],
    ['release edge newer than release sample', ({h, id, edge}) => h.put(id('allow'), 1, {lc: edge + 2, q: 0})],
    ['nonfinite release edge', ({h, id}) => h.put(id('allow'), 1, {lc: NaN, q: 0})],
    ['null release edge', ({h, id}) => h.put(id('allow'), 1, {lc: null, q: 0})],
    ['zero release edge', ({h, id}) => h.put(id('allow'), 1, {lc: 0, q: 0})],
    ['string release edge', ({h, id, edge}) => h.put(id('allow'), 1, {lc: String(edge), q: 0})]
]) test(`idle peer exception fails closed: ${name}`, async () => {
    const fixture = await establishedEqvWithIdleRelease();
    change(fixture);
    await fixture.h.output.tick();
    assert.ok(fixture.h.writes.some(write => write.id === 'allow1' && write.val === 0),
        'unproven no-car electrical rest must retain the release interlock');
    assert.equal(fixture.h.states.get('ems.0.Devices.Wallbox1.OutputActive').val, false);
});

test('replugging an idle peer immediately restores the active-release interlock', async () => {
    const {h, id} = await establishedEqvWithIdleRelease();
    // Check the previously ignored peer again without letting the cleanup
    // command replace its observed allow=1 first.
    assert.equal(h.output.gate(h.output.devices[1], h.mapping,
        h.output.gridOperatorLimit(h.mapping)), '');
    h.put(id('car'), 2, {q: 0});
    await h.output.tick();
    assert.ok(h.writes.some(write => write.id === 'allow1' && write.val === 0));
    assert.equal(h.states.get('ems.0.Devices.Wallbox1.OutputActive').val, false);
});

for (const peer of [0, 2]) for (const [name, change] of [
    ['a vehicle reconnects', ({h, id}) => h.put(id('car'), 2, {q: 0})],
    ['power appears despite no-car', ({h, id}) => h.put(id('power'), 0.2, {q: 0})]
]) test(`previously idle WB${peer} restores takeover and stops EQV when ${name}`, async () => {
    const fixture = await establishedEqvWithIdleRelease(peer);
    const {h, id} = fixture;
    await h.output.tick();
    assert.equal(h.states.get('ems.0.Devices.Wallbox1.OutputActive').val, true);
    assert.equal(h.output.devices[peer].owned, false);
    h.writes.length = 0;
    change(fixture);
    await h.output.tick();
    assert.ok(h.writes.some(write => write.id === 'allow1' && write.val === 0),
        'evidence must be rechecked on the next regulation tick');
    assert.ok(h.writes.some(write => write.id === id('allow') && write.val === 0),
        'the non-idle unknown peer returns to the normal confirmed-OFF takeover');
    assert.equal(h.states.get('ems.0.Devices.Wallbox1.OutputActive').val, false);
    assert.equal(h.output.devices[peer].owned, true,
        'peer OFF operation retains ownership until its real ACK');
});

test('a new EQV start remains blocked by an idle no-car ON peer', async () => {
    const {h, id} = await establishedEqvWithIdleRelease();
    const eqv = h.output.devices[1];
    eqv.owned = false; eqv.activeSince = 0; eqv.pending = null;
    h.put('ems.0.Devices.Wallbox1.OutputOwned', false);
    h.put('ems.0.Devices.Wallbox1.OutputActive', false);
    h.put('allow1', 0, {q: 0});
    h.writes.length = 0;
    await h.output.tick();
    assert.ok(!h.writes.some(write => ['cmd1', 'allow1'].includes(write.id)),
        'new start must first obtain genuine peer OFF confirmation');
    assert.equal(h.states.get('ems.0.Devices.Wallbox1.OutputActive').val, false);
    assert.equal(h.states.get(id('car')).val, 1);
});

for (const [name, change] of [
    ['owned peer', d => { d.owned = true; }],
    ['pending peer start', d => { d.pending = {stage: 'allow', amps: 6, start: true, at: 1000000}; }],
    ['peer restart recovery', d => { d.recovering = true; }],
    ['pending peer stop', d => { d.stopRequest = {reason: 'stop pending', lastAttempt: 1000000}; }],
    ['pending peer electrical response', d => { d.response = {at: 1000000, amps: 6, ackAt: 0}; }],
    ['pending peer phase request', d => { d.phaseRequest = {at: 1000000, desired: 3}; }],
    ['active peer phase transition', d => { d.phaseTransitionUntil = 1030000; }]
]) test(`no-car exception cannot bypass ${name}`, async () => {
    const {h, peer} = await establishedEqvWithIdleRelease();
    change(h.output.devices[peer]);
    const reason = h.output.gate(h.output.devices[1], h.mapping,
        h.output.gridOperatorLimit(h.mapping));
    assert.match(reason, /^Sequenzbetrieb:/);
});

for (const state of ['OutputActive', 'OutputOwned', 'StopPowerPending', 'ResponsePending', 'PhaseSwitchPending'])
    test(`no-car exception cannot override published peer ${state}`, async () => {
        const {h, peer} = await establishedEqvWithIdleRelease();
        h.put(`ems.0.Devices.Wallbox${peer}.${state}`, true);
        assert.match(h.output.gate(h.output.devices[1], h.mapping,
            h.output.gridOperatorLimit(h.mapping)), /^Sequenzbetrieb:/);
    });

test('assumed shadow zero cannot authorize the physical idle-peer exception', async () => {
    const {h, peer} = await establishedEqvWithIdleRelease();
    h.output.responseEvidence = wb => wb === peer
        ? {valid: true, assumed: true, currentA: 0} : null;
    await h.output.tick();
    assert.ok(h.writes.some(write => write.id === 'allow1' && write.val === 0));
    assert.equal(h.states.get('ems.0.Devices.Wallbox1.OutputActive').val, false);
});

test('an assumed active owner cannot authorize the physical idle-peer exception', async () => {
    const {h} = await establishedEqvWithIdleRelease();
    h.output.responseEvidence = wb => wb === 1
        ? {valid: true, assumed: true, currentA: 6} : null;
    await h.output.tick();
    assert.ok(h.writes.some(write => write.id === 'allow1' && write.val === 0));
    assert.equal(h.states.get('ems.0.Devices.Wallbox1.OutputActive').val, false);
});

for (const [name, change, reason] of [
    ['external EQV release withdrawn', h => h.ack('allow1', 0), /Ladefreigabe extern entzogen/],
    ['external EQV current changed', h => h.ack('feedback1', 9), /Ladestrom extern veraendert/]
]) test(`idle peer exception cannot mask ${name}`, async () => {
    const {h} = await establishedEqvWithIdleRelease();
    change(h);
    await h.output.tick();
    assert.equal(h.states.get('ems.0.Devices.Wallbox1.OutputActive').val, false);
    assert.match(h.states.get('ems.0.Devices.Wallbox1.LastStopReason').val, reason);
});

for (const [name, change] of [
    ['not selected', h => h.put('ems.0.Control.SelectedWallbox', 0)],
    ['restart recovery', h => { h.output.devices[1].recovering = true; }],
    ['not EMS-owned', h => { h.output.devices[1].owned = false; }],
    ['still in a start transaction', h => {
        h.output.devices[1].pending = {stage: 'allow', amps: 6, start: true, at: 1002000};
    }],
    ['not established active', h => h.put('ems.0.Devices.Wallbox1.OutputActive', false)]
]) test(`idle peer exception applies only to an established selected EQV: ${name}`, async () => {
    const {h} = await establishedEqvWithIdleRelease();
    change(h);
    assert.match(h.output.gate(h.output.devices[1], h.mapping,
        h.output.gridOperatorLimit(h.mapping)), /^Sequenzbetrieb:/);
});

test('peer OFF polling jitter uses the configured thirty-second go-e window',async()=>{
    const h=setup();h.enableWallbox(1);h.config.multiWallboxAlphaArmed=true;
    h.put('allow1',0,{ts:Date.now()-20000});await h.start();
    assert.equal(h.states.get('ems.0.Devices.Wallbox0.OutputActive').val,true);
});

test('coordinated wallbox cap includes pending HK and battery consumption without discharge credit',async()=>{
    const h=setup();await h.start();
    h.adapter.engineContext={coordinatedEnergyEnabled:()=>true,
        coordinatedPhaseReservations:()=>({valid:true,otherW:[0,0,0]}),
        coordinatedConsumptionLoads:()=>({valid:true,totalW:4100,wallboxesW:[1380,0,0]})};
    h.put('lpc','limited');h.put('lpcLimit',4200);
    h.put('power',1.38);h.put('i1',6);h.writes.length=0;
    await h.output.tick();
    assert.ok(!h.writes.some(w=>w.id==='cmd'&&w.val>6));
    assert.equal(h.states.get('ems.0.Devices.Wallbox0.OutputActive').val,true);
    h.adapter.engineContext.coordinatedConsumptionLoads=()=>({valid:false});
    await h.output.tick();
    assert.ok(h.writes.some(w=>w.id==='allow'&&w.val===0));
});

test('wallbox publishes a pending ampere reservation before physical acknowledgement',async()=>{
    const h=setup();await h.output.initialize();await h.output.tick();h.ack('allow',0);
    await h.output.tick();
    assert.equal(h.states.get('ems.0.Devices.Wallbox0.OutputCommand_A').val,0);
    assert.equal(h.states.get('ems.0.Devices.Wallbox0.OutputReservedPower_W').val,1380);
    h.put('ems.0.System.RealOutputsEnabled',false);await h.output.tick();
    h.ack('allow',0);await h.output.tick();
    assert.equal(h.states.get('ems.0.Devices.Wallbox0.OutputReservedPower_W').val,0);
});

test('wallbox idle status cannot overwrite active HK or battery NoActuation',async()=>{
    const h=setup();h.put('ems.0.System.RealOutputsEnabled',false);
    h.put('ems.0.Devices.Battery.OutputOwned',true);
    await h.output.initialize();await h.output.tick();
    assert.equal(h.states.get('ems.0.System.NoActuation').val,false);
    assert.equal(h.states.get('ems.0.Control.Mode').val,'ALPHA_ENERGY_COORDINATED');
});

test('fresh -10 W and zero readings do not hard-stop an active wallbox or modify its raw state', async () => {
    let now = 1000000000000;
    const h = setup({now: () => now});
    await h.start(); h.writes.length = 0;
    h.put('export', 0); h.put('import', 500);
    // Independent two-second test steps cover the normalization bounds and
    // nominal minimum power. A budget shortfall still uses the normal timers.
    for (const power of [-0.01, -0.02, 0, 6 * 230 / 1000]) {
        now += 2000; h.refresh(); h.put('power', power);
        const raw = h.states.get('power');
        await h.output.tick();
        assert.equal(h.states.get('power'), raw);
        assert.equal(h.states.get('power').val, power);
        assert.equal(h.states.get('ems.0.Devices.Wallbox0.OutputActive').val, true);
        assert.equal(h.states.get('ems.0.Devices.Wallbox0.LastStopAt').val, 0);
    }
    assert.ok(!h.writes.some(write => write.id === 'allow' && write.val === 0));
});

test('zero-noise tolerance never bypasses missing, stale, unacknowledged or bad-quality measurements', async t => {
    const now = 1000000000000;
    const cases = [
        {name: 'outside negative band', value: -0.020001, reason: /negativer Messwert.*ausserhalb der Nulltoleranz/},
        {name: 'large negative', value: -1, reason: /negativer Messwert -1000 W/},
        {name: 'null', value: null, reason: /Messwert fehlt/},
        {name: 'undefined', value: undefined, reason: /Messwert fehlt/},
        {name: 'blank', value: ' ', reason: /Messwert fehlt/},
        {name: 'non-number', value: true, reason: /nicht numerisch/},
        {name: 'NaN', value: NaN, reason: /nicht endlich/},
        {name: 'Infinity', value: Infinity, reason: /nicht endlich/},
        {name: 'unacknowledged', value: -0.01, extra: {ack: false}, reason: /ack=false/},
        {name: 'quality', value: -0.01, extra: {q: 128}, reason: /q=128/},
        {name: 'stale', value: -0.01, extra: {ts: now - 31000}, reason: /veraltet.*31 s.*30 s/},
        {name: 'timestamp missing', value: -0.01, extra: {ts: undefined}, reason: /Zeitstempel fehlt/},
        {name: 'future', value: -0.01, extra: {ts: now + 2000}, reason: /Zukunft/}
    ];
    for (const item of cases) await t.test(item.name, async () => {
        const h = setup({now: () => now}); await h.start(); h.writes.length = 0;
        h.put('power', item.value, item.extra);
        await h.output.tick();
        assert.deepEqual(h.writes, [{id: 'allow', val: 0}]);
        assert.equal(h.states.get('ems.0.Devices.Wallbox0.OutputActive').val, false);
        const reason = h.states.get('ems.0.Devices.Wallbox0.LastStopReason').val;
        assert.match(reason, /Wallbox-Leistung/);
        assert.match(reason, item.reason);
    });
});

test('measurement fault recovery still requires a confirmed stop and full start sequence', async () => {
    const h = setup(); await h.start(); h.writes.length = 0;
    h.put('power', -0.03); await h.output.tick();
    h.put('power', -0.01); await h.output.tick();
    assert.deepEqual(h.writes, [{id: 'allow', val: 0}]);
    assert.equal(h.states.get('ems.0.Devices.Wallbox0.OutputActive').val, false);
    h.ack('allow', 0);h.electricalOff(); await h.output.tick();
    assert.equal(h.output.devices[0].owned, false);
    await h.output.tick(); h.ack('allow', 0);
    await h.output.tick(); h.ack('feedback', 6);
    await h.output.tick(); h.ack('allow', 1);
    await h.output.tick();
    assert.deepEqual(h.writes, [{id: 'allow', val: 0}, {id: 'allow', val: 0},
        {id: 'cmd', val: 6}, {id: 'allow', val: 1}]);
    assert.equal(h.states.get('ems.0.Devices.Wallbox0.OutputActive').val, true);
});

test('wallbox faults identify error codes, source freshness, quality and connection separately', async t => {
    const now = 1000000000000;
    const cases = [
        {name: 'device error', id: 'error', value: 8, reason: /Geraetefehler \(Code 8\)/},
        {name: 'error missing', id: 'error', value: null, reason: /Fehlerstatus: Messwert fehlt/},
        {name: 'error stale', id: 'error', value: 0, extra: {ts: now - 31000}, reason: /Fehlerstatus: veraltet/},
        {name: 'error ack', id: 'error', value: 0, extra: {ack: false}, reason: /Fehlerstatus: unbestaetigt.*ack=false/},
        {name: 'error quality', id: 'error', value: 0, extra: {q: 64}, reason: /Fehlerstatus:.*q=64/},
        {name: 'error value', id: 'error', value: -1, reason: /Fehlerstatus ungueltig.*Code -1/},
        {name: 'connection off', id: 'connection', value: false, reason: /offline.*Verbindungsstatus=false/},
        {name: 'connection missing', id: 'connection', value: null, reason: /Verbindungsstatus: Messwert fehlt/},
        {name: 'connection ack', id: 'connection', value: true, extra: {ack: false}, reason: /Verbindungsstatus: unbestaetigt/},
        {name: 'connection quality', id: 'connection', value: true, extra: {q: 16}, reason: /Verbindungsstatus:.*q=16/},
        {name: 'connection invalid', id: 'connection', value: 1, reason: /Verbindungsstatus ungueltig/}
    ];
    for (const item of cases) await t.test(item.name, async () => {
        const h = setup({now: () => now}); await h.start(); h.writes.length = 0;
        h.put('power', -0.01); // The power tolerance must not mask hard gates.
        h.put(item.id, item.value, item.extra);
        await h.output.tick();
        assert.deepEqual(h.writes, [{id: 'allow', val: 0}]);
        assert.match(h.states.get('ems.0.Devices.Wallbox0.LastStopReason').val, item.reason);
    });
});

test('optional modeled current affects only vehicle-response ramp feedback', async t => {
    for (const value of [null, NaN, Infinity, -1, 6]) await t.test(String(value), async () => {
        let now = 1000000000000;
        const h = setup({now: () => now, responseCurrentA: value === null ? null : () => value,
            responseEvidence: () => ({valid: value === 6, assumed: true, currentA: value})});
        await h.start(); h.writes.length = 0;
        now += 6000; h.refresh();
        // Physical current remains zero; production/default must not wind up.
        await h.output.tick();
        assert.equal(h.writes.some(write => write.id === 'cmd' && write.val > 6), value === 6);
    });
    for (const violation of ['wrong phases', 'house overload']) await t.test(violation, async () => {
        const h = setup({responseCurrentA: () => 32}); await h.start(); h.writes.length = 0;
        if (violation === 'wrong phases') h.put('i2', 2);
        else h.put('h1', 70);
        await h.output.tick();
        assert.deepEqual(h.writes, [{id: 'allow', val: 0}]);
        assert.equal(h.states.get('ems.0.Devices.Wallbox0.OutputActive').val, false);
    });
});

module.exports={setup};

test('current ACK alone cannot confirm electrical uptake or permit another current increase', async () => {
    let now = 1000000000000;
    const h = setup({now: () => now});
    await h.start();
    h.writes.length = 0;
    assert.equal(h.states.get('ems.0.Devices.Wallbox0.ResponseState').val, 'vehicle_response');
    now += 15000; h.refresh();
    // First new poll confirms the command, but the car has not yet reacted.
    await h.output.tick();
    assert.deepEqual(h.writes, []);
    assert.equal(h.states.get('ems.0.Devices.Wallbox0.ResponsePending').val, true);
    assert.match(h.states.get('ems.0.Devices.Wallbox0.ResponseStatus').val, /Ist 0 A.*Soll 6 A/);
    now += 15000; h.refresh(); h.put('i1', 6); h.put('power', 1.38);
    await h.output.tick();
    assert.deepEqual(h.writes, [{id: 'cmd', val: 12}]);
    assert.equal(h.states.get('ems.0.Devices.Wallbox0.ResponseConfirmedAt').val, now);
});

test('a fresh command ACK cannot turn a pre-command power/current sample into a vehicle response', async () => {
    let now = 1000000000000;
    const h = setup({now: () => now});
    await h.start(); h.writes.length = 0;
    const commandAt = h.output.devices[0].response.at;
    now += 5000; h.refresh();
    h.put('i1', 6, {ts: commandAt - 1});
    h.put('power', 1.38, {ts: commandAt - 1});
    await h.output.tick();
    assert.deepEqual(h.writes, []);
    assert.equal(h.states.get('ems.0.Devices.Wallbox0.ResponseState').val, 'vehicle_response');
    assert.match(h.states.get('ems.0.Devices.Wallbox0.ResponseStatus').val, /keine neue Leistung/);
});

test('a newer current ACK does not reuse electrical measurements from an earlier poll', async () => {
    let now = 1000000000000;
    const h = setup({now: () => now}); await h.start();
    now += 6000; h.refresh(); h.put('i1', 6); h.put('power', 1.38);
    await h.output.tick(); assert.equal(h.writes.at(-1).val, 12);
    now += 10000; h.refresh(); h.put('i1', 12); h.put('power', 2.76);
    const earlierPollAt = now + 1;
    await h.output.tick();
    now += 5000; h.refresh(); h.ack('feedback', 12);
    h.put('i1', 12, {ts: earlierPollAt}); h.put('power', 2.76, {ts: earlierPollAt});
    h.writes.length = 0; await h.output.tick();
    assert.equal(h.states.get('ems.0.Devices.Wallbox0.ResponseState').val, 'vehicle_response');
    assert.deepEqual(h.writes, []);
    now += 1000; h.refresh(); await h.output.tick();
    assert.equal(h.states.get('ems.0.Devices.Wallbox0.ResponseState').val, 'confirmed');
    assert.deepEqual(h.writes, []); // The normal ramp cycle still applies.
});

test('persistent vehicle under-response reaches a bounded diagnosis without winding up or claiming success', async () => {
    let now = 1000000000000;
    const h = setup({now: () => now});
    await h.start(); h.writes.length = 0;
    now += 45002; h.refresh(); await h.output.tick();
    assert.equal(h.states.get('ems.0.Devices.Wallbox0.ResponseState').val, 'limited');
    assert.equal(h.states.get('ems.0.Devices.Wallbox0.ResponsePending').val, false);
    assert.equal(h.states.get('ems.0.Devices.Wallbox0.ResponseConfirmedAt').val, 0);
    assert.equal(h.states.get('ems.0.Devices.Wallbox0.OutputActive').val, true);
    assert.deepEqual(h.writes, []);
    assert.match(h.states.get('ems.0.Devices.Wallbox0.ResponseStatus').val, /Antwortzeit abgelaufen.*keine weitere Erhoehung/);
});

test('reduced command waits for vehicle response and stops safely if current remains above its confirmed cap', async () => {
    let now = 1000000000000;
    const h = setup({now: () => now});
    await h.start();
    now += 6000; h.refresh(); h.put('i1', 6); h.put('power', 1.38);
    await h.output.tick(); h.ack('feedback', 12);
    now += 15000; h.refresh(); h.put('i1', 12); h.put('power', 2.76);
    h.put('ems.0.Control.Targets.Wallbox0_W', 1380);
    await h.output.tick();
    assert.equal(h.writes.at(-1).val, 6); h.ack('feedback', 6);
    now += 15000; h.refresh(); h.writes.length = 0;
    await h.output.tick();
    assert.deepEqual(h.writes, []);
    assert.equal(h.states.get('ems.0.Devices.Wallbox0.ResponseState').val, 'vehicle_response');
    now += 45001; h.refresh(); await h.output.tick();
    assert.deepEqual(h.writes, [{id: 'allow', val: 0}]);
    assert.equal(h.states.get('ems.0.Devices.Wallbox0.ResponseState').val, 'timeout');
    assert.match(h.states.get('ems.0.Devices.Wallbox0.OutputFault').val, /12 A.*Vorgabe 6 A/);
});

for (const [name, change] of [
    ['go-e Overamp error 5', h => h.put('error', 5)],
    ['user release removed', h => h.put('userAllow', false)],
    ['house protection', h => h.put('critical', true)],
    ['unknown power quality', h => h.put('power', 0, {q: 0x40})]
]) test(`vehicle settling never masks ${name}`, async () => {
    const h = setup(); await h.start(); h.writes.length = 0;
    assert.equal(h.states.get('ems.0.Devices.Wallbox0.ResponsePending').val, true);
    change(h); await h.output.tick();
    assert.deepEqual(h.writes, [{id: 'allow', val: 0}]);
    assert.equal(h.states.get('ems.0.Devices.Wallbox0.OutputActive').val, false);
    if (name.includes('Overamp')) assert.match(h.states.get('ems.0.Devices.Wallbox0.LastStopReason').val, /Code 5/);
});

test('a new hard current cap supersedes a pending increase while its vehicle response is unknown', async () => {
    let now = 1000000000000;
    const h = setup({now: () => now});
    await h.start(); now += 6000; h.refresh(); h.put('i1', 6); h.put('power', 1.38);
    await h.output.tick(); assert.equal(h.writes.at(-1).val, 12);
    h.config.wb0CommissioningMaxA = 7; h.writes.length = 0;
    await h.output.tick();
    assert.deepEqual(h.writes, [{id: 'cmd', val: 7}]);
    assert.equal(h.states.get('ems.0.Devices.Wallbox0.OutputActive').val, true);
});

test('modeled electrical proof requires valid explicit assumption provenance and retains real error gates', async () => {
    for (const evidence of [{valid: true, currentA: 6}, {assumed: true, currentA: 6},
        {valid: true, assumed: false, currentA: 6}]) {
        const h = setup({responseCurrentA: () => 6, responseEvidence: () => evidence});
        await h.start(); h.writes.length = 0; h.output.devices[0].lastAt -= 10000;
        await h.output.tick(); assert.deepEqual(h.writes, []);
        assert.notEqual(h.states.get('ems.0.Devices.Wallbox0.ResponseState').val, 'modeled');
    }
    const h = setup({responseEvidence: () => ({valid: true, assumed: true, currentA: 6})});
    await h.start();
    assert.equal(h.states.get('ems.0.Devices.Wallbox0.ResponseState').val, 'modeled');
    assert.equal(h.states.get('ems.0.Devices.Wallbox0.ResponseMeasuredCurrent_A').val, null);
    assert.equal(h.states.get('ems.0.Devices.Wallbox0.ResponseMeasuredPower_W').val, null);
    assert.match(h.states.get('ems.0.Devices.Wallbox0.ResponseStatus').val, /keine reale Fahrzeugbestaetigung/);
    h.writes.length = 0; h.put('error', 5); await h.output.tick();
    assert.deepEqual(h.writes, [{id: 'allow', val: 0}]);
});

test('an invalid assumed response never interprets the real controller load as virtual uptake or over-current', async () => {
    let now = 1000000000000, valid = true;
    const h = setup({now: () => now,
        responseEvidence: () => ({valid, assumed: true, currentA: valid ? 6 : undefined})});
    await h.start(); valid = false;
    now += 60000; h.refresh(); h.put('i1', 16); h.put('power', 3.68); h.writes.length = 0;
    await h.output.tick();
    assert.equal(h.states.get('ems.0.Devices.Wallbox0.ResponseState').val, 'unavailable');
    assert.equal(h.states.get('ems.0.Devices.Wallbox0.ResponsePending').val, true);
    assert.equal(h.states.get('ems.0.Devices.Wallbox0.OutputFault').val, '');
    assert.equal(h.states.get('ems.0.Devices.Wallbox0.OutputActive').val, true);
    assert.deepEqual(h.writes, []);
    h.put('error', 5); await h.output.tick();
    assert.deepEqual(h.writes, [{id: 'allow', val: 0}]);
    assert.match(h.states.get('ems.0.Devices.Wallbox0.LastStopReason').val, /Code 5/);
});

test('command timeline publishes sent target and ACK separately from electrical confirmation', async () => {
    let now = 1000000000000;
    const h = setup({now: () => now}); await h.start();
    now += 6000; h.refresh(); h.put('i1', 6); h.put('power', 1.38);
    await h.output.tick();
    assert.equal(h.states.get('ems.0.Devices.Wallbox0.ResponseState').val, 'command_ack');
    assert.equal(h.states.get('ems.0.Devices.Wallbox0.ResponsePreviousCommand_A').val, 6);
    assert.equal(h.states.get('ems.0.Devices.Wallbox0.ResponseCommand_A').val, 12);
    assert.equal(h.states.get('ems.0.Devices.Wallbox0.ResponseSentAt').val, now);
    assert.equal(h.states.get('ems.0.Devices.Wallbox0.ResponseAcknowledgedAt').val, 0);
    now += 15000; h.refresh(); h.ack('feedback', 12); await h.output.tick();
    assert.equal(h.states.get('ems.0.Devices.Wallbox0.ResponseState').val, 'vehicle_response');
    assert.equal(h.states.get('ems.0.Devices.Wallbox0.ResponseAcknowledgedAt').val, now + 1);
    assert.equal(h.states.get('ems.0.Devices.Wallbox0.ResponseMeasuredCurrent_A').val, 6);
    assert.equal(h.states.get('ems.0.Devices.Wallbox0.ResponseMeasuredPower_W').val, 1380);
});

test('lost ACK remains bounded after a pending start has already been cleared', async () => {
    let now = 1000000000000;
    const h = setup({now: () => now});
    await h.output.initialize(); await h.output.tick(); h.ack('allow', 0);
    await h.output.tick(); h.put('feedback', 6, {ts: now});
    await h.output.tick(); h.put('allow', 1, {ts: now});
    await h.output.tick(); assert.equal(h.output.devices[0].pending, null);
    assert.equal(h.output.devices[0].response.ackAt, 0);
    const originalTs = now;
    now += 20000; h.refresh(); h.put('feedback', 6, {ts: originalTs});
    h.put('allow', 1, {ts: originalTs}); h.writes.length = 0;
    await h.output.tick();
    assert.deepEqual(h.writes, [{id: 'allow', val: 0}]);
    assert.equal(h.states.get('ems.0.Devices.Wallbox0.ResponseState').val, 'timeout');
    assert.match(h.states.get('ems.0.Devices.Wallbox0.OutputFault').val, /Befehlsbestaetigung.*fehlt/);
});

test('a current poll cannot replace the outstanding start-release acknowledgement', async () => {
    let now = 1000000000000;
    const h = setup({now: () => now}); await h.start();
    const d = h.output.devices[0], at = d.response.at;
    d.response.ackAt = 0;
    h.put('allow', 1, {ts: at});
    now += 15000; h.refresh();
    h.put('allow', 1, {ts: at}); h.ack('feedback', 6);
    h.put('i1', 6); h.put('power', 1.38);
    h.writes.length = 0; await h.output.tick();
    assert.equal(h.states.get('ems.0.Devices.Wallbox0.ResponseState').val, 'command_ack');
    assert.equal(h.states.get('ems.0.Devices.Wallbox0.ResponseAcknowledgedAt').val, at + 1,
        'the earlier recorded ACK is retained as history, not replaced by a different source');
    assert.deepEqual(h.writes, []);
    now += 6000; h.refresh(); h.put('allow', 1, {ts: at});
    await h.output.tick();
    assert.equal(h.states.get('ems.0.Devices.Wallbox0.ResponseState').val, 'timeout');
    assert.match(h.states.get('ems.0.Devices.Wallbox0.OutputFault').val, /Befehlsbestaetigung/);
    assert.deepEqual(h.writes, [{id: 'allow', val: 0}]);
});

test('enabled price option without a price session preserves PV minimum runtime and stop delay', async () => {
    const h = setup();
    h.config.wallboxMinimumRunTimeS = 600;
    h.config.wallboxStopDelayS = 120;
    h.put('ems.0.Config.Wallbox0PriceChargingEnabled', true);
    h.adapter.engineContext = {vehicleState: () => ({release: true})};
    await h.start(); h.writes.length = 0;
    h.put('ems.0.Control.Targets.Wallbox0_W', 0); h.put('export', 0);
    await h.output.tick();
    assert.deepEqual(h.writes, []);
    assert.equal(h.states.get('ems.0.Devices.Wallbox0.OutputActive').val, true);
    assert.match(h.states.get('ems.0.Devices.Wallbox0.OutputStatus').val, /Mindestlaufzeit/);
    h.output.devices[0].activeSince -= 601000;
    await h.output.tick();
    assert.deepEqual(h.writes, [], 'stop delay survives minimum-runtime expiry');
    h.output.devices[0].shortfallSince -= 121000;
    await h.output.tick();
    assert.deepEqual(h.writes, [{id: 'allow', val: 0}]);
    assert.doesNotMatch(h.states.get('ems.0.Devices.Wallbox0.LastStopReason').val, /Preisfenster/);
});

for (const residualW of [5424, 9000]) {
    test(`heater command deviation ${residualW} W does not block minimum-current start`, async () => {
        const h=setup();h.config.combinedProductionArmed=true;h.put('split',1);
        h.put('ems.0.Config.DHWParallelDistributionEnabled',true);
        h.put('ems.0.Devices.MyPV_DHW.ControlEnabled',true);
        h.put('ems.0.Control.Targets.MyPV_DHW_W',5000);
        h.put('ems.0.Actual.MyPV_DHW_W',residualW);
        h.put('ems.0.Control.Targets.Wallbox0_W',1380);h.put('export',1800);
        await h.start();
        assert.equal(h.states.get('ems.0.Devices.Wallbox0.OutputActive').val,true);
        assert.ok(h.writes.some(w=>w.id==='allow'&&w.val===1));
    });
}
test('combined start waits for real net budget even if planned allocation is positive', async () => {
    const h=setup();h.config.combinedProductionArmed=true;h.put('split',1);
    h.put('ems.0.Config.DHWParallelDistributionEnabled',true);
    h.put('ems.0.Devices.MyPV_DHW.ControlEnabled',true);
    h.put('ems.0.Control.Targets.MyPV_DHW_W',5000);
    h.put('ems.0.Actual.MyPV_DHW_W',5424);h.put('export',1143);
    h.put('ems.0.Control.Targets.Wallbox0_W',1380);
    await h.output.initialize();await h.output.tick();
    assert.deepEqual(h.writes,[]);
    assert.match(h.states.get('ems.0.Devices.Wallbox0.OutputStatus').val,/Netzbudget/);
});
test('combined start rechecks real budget before enabling charging', async () => {
    const h=setup();h.config.combinedProductionArmed=true;h.put('split',1);
    h.put('ems.0.Config.DHWParallelDistributionEnabled',true);
    h.put('ems.0.Devices.MyPV_DHW.ControlEnabled',true);
    h.put('ems.0.Control.Targets.MyPV_DHW_W',0);h.put('ems.0.Actual.MyPV_DHW_W',1000);
    await h.output.initialize();await h.output.tick();h.ack('allow',0);
    await h.output.tick();h.ack('feedback',6);h.put('export',500);
    await h.output.tick();
    assert.ok(!h.writes.some(w=>w.id==='allow'&&w.val===1));
});

for (const [from, to] of [[1,3],[3,1]]) {
    test(`expected ${from}P-to-${to}P unacknowledged phase write and zero-power pause keep the charging session`, async () => {
        let now=Date.now();const h=setup({now:()=>now});
        Object.assign(h.config,{wb0PhaseSwitchEnabled:true,wb0PhaseModeId:'phaseMode',
            wb0MinCurrent3pA:6,wb0MaxCurrent3pA:11,wallboxStartDelayS:600,
            wallboxPhaseSwitchTimeoutS:180});
        h.put('phaseMode',from===3?2:1);h.put('ems.0.Control.Targets.Wallbox0_Phases',from);
        h.put('ems.0.Control.Targets.Wallbox0_W',6*230*from);
        await h.start();h.writes.length=0;
        const d=h.output.devices[0], originalSince=d.activeSince;
        now+=1000;h.refresh();
        h.put('ems.0.Control.Targets.Wallbox0_Phases',to);
        h.put('ems.0.Control.Targets.Wallbox0_W',6*230*to);
        // Request and its write echo can precede the first output tick.
        h.put('phaseMode',to===3?2:1,{ack:false});
        h.put('power',0);h.put('i1',0);h.put('i2',0);h.put('i3',0);
        await h.output.tick();
        assert.equal(h.states.get('ems.0.Devices.Wallbox0.ConfirmedPhases').val,from);
        assert.equal(h.states.get('ems.0.Devices.Wallbox0.OutputActive').val,true);
        assert.equal(h.states.get('ems.0.Devices.Wallbox0.PhaseSwitchPending').val,true);
        assert.deepEqual(h.writes,[]);
        now+=50000;h.refresh();await h.output.tick();
        assert.equal(d.activeSince,originalSince);
        assert.deepEqual(h.writes,[]);
        now+=1000;h.refresh();h.put('phaseMode',to===3?2:1);await h.output.tick();
        assert.equal(h.states.get('ems.0.Devices.Wallbox0.ConfirmedPhases').val,to);
        assert.equal(h.states.get('ems.0.Devices.Wallbox0.ResponseConfirmedAt').val,0);
        now+=1000;h.refresh();h.put('i1',6);h.put('i2',to===3?6:0);h.put('i3',to===3?6:0);
        h.put('power',6*230*to/1000);await h.output.tick();
        assert.equal(h.states.get('ems.0.Devices.Wallbox0.ResponseState').val,'confirmed');
        assert.equal(d.activeSince,originalSince);
        assert.equal(h.states.get('ems.0.Devices.Wallbox0.LastStopAt').val,0);
        assert.ok(!h.writes.some(w=>w.id==='allow'&&w.val===0));
    });
}
test('repeated unacknowledged matching mode echoes do not renew the phase deadline', async () => {
    let now=Date.now();const h=setup({now:()=>now});
    Object.assign(h.config,{wb0PhaseSwitchEnabled:true,wb0PhaseModeId:'phaseMode',wallboxPhaseSwitchTimeoutS:180});
    h.put('phaseMode',1);await h.start();h.writes.length=0;
    now+=1000;h.refresh();h.put('ems.0.Control.Targets.Wallbox0_Phases',3);
    h.put('phaseMode',2,{ack:false});await h.output.tick();
    now+=179000;h.refresh();h.put('phaseMode',2,{ack:false});await h.output.tick();
    assert.deepEqual(h.writes,[]);
    now+=1000;h.refresh();h.put('phaseMode',2,{ack:false});await h.output.tick();
    assert.deepEqual(h.writes,[{id:'allow',val:0}]);
    assert.match(h.states.get('ems.0.Devices.Wallbox0.LastStopReason').val,/Zeitlimit/);
});
for (const invalid of [{val:1,ack:false},{val:2,ack:false,q:64},{val:null,ack:false}]) {
    test(`an unexpected or invalid phase write is not repaired: ${JSON.stringify(invalid)}`, async () => {
        const h=setup();Object.assign(h.config,{wb0PhaseSwitchEnabled:true,wb0PhaseModeId:'phaseMode'});
        h.put('phaseMode',1);await h.start();h.writes.length=0;
        h.put('ems.0.Control.Targets.Wallbox0_Phases',3);
        h.put('phaseMode',invalid.val,invalid);await h.output.tick();
        assert.deepEqual(h.writes,[{id:'allow',val:0}]);
    });
}
test('an expected phase echo cannot bypass a hard grid-operator cap', async () => {
    const h=setup();Object.assign(h.config,{wb0PhaseSwitchEnabled:true,wb0PhaseModeId:'phaseMode'});
    h.put('phaseMode',1);await h.start();h.writes.length=0;
    h.put('ems.0.Control.Targets.Wallbox0_Phases',3);h.put('phaseMode',2,{ack:false});
    h.put('lpc','limited');h.put('lpcLimit',1000);await h.output.tick();
    assert.deepEqual(h.writes,[{id:'allow',val:0}]);
});

test('phase waiting cannot defer sustained electrical overdraw past its independent response deadline', async () => {
    let now=Date.now();const h=setup({now:()=>now});
    Object.assign(h.config,{wb0PhaseSwitchEnabled:true,wb0PhaseModeId:'phaseMode',wb0MaxCurrent3pA:11});
    h.put('phaseMode',1);await h.start();h.writes.length=0;
    now+=1000;h.refresh();h.put('ems.0.Control.Targets.Wallbox0_Phases',3);
    h.put('phaseMode',2,{ack:false});h.put('i1',16);h.put('i2',16);h.put('i3',16);h.put('power',11.04);
    await h.output.tick();now+=46000;h.refresh();await h.output.tick();
    assert.deepEqual(h.writes,[{id:'allow',val:0}]);
    assert.match(h.states.get('ems.0.Devices.Wallbox0.LastStopReason').val,/Fahrzeugstrom/);
});

test('an old mode ACK cannot complete a newer EMS phase request', async () => {
    let now=Date.now();const h=setup({now:()=>now});
    Object.assign(h.config,{wb0PhaseSwitchEnabled:true,wb0PhaseModeId:'phaseMode'});
    h.put('phaseMode',1);await h.start();h.writes.length=0;
    now+=1000;h.refresh();h.put('ems.0.Control.Targets.Wallbox0_Phases',3);
    await h.output.tick();h.put('phaseMode',2,{ts:now-100});await h.output.tick();
    assert.equal(h.states.get('ems.0.Devices.Wallbox0.ConfirmedPhases').val,1);
    assert.equal(h.states.get('ems.0.Devices.Wallbox0.PhaseSwitchPending').val,true);
    assert.deepEqual(h.writes,[]);
});
test('a configured 3P ACK with only one electrically active phase earns no electrical confirmation or increase', async () => {
    let now=Date.now();const h=setup({now:()=>now});
    Object.assign(h.config,{wb0PhaseSwitchEnabled:true,wb0PhaseModeId:'phaseMode'});
    h.put('phaseMode',1);await h.start();h.writes.length=0;
    now+=1000;h.refresh();h.put('ems.0.Control.Targets.Wallbox0_Phases',3);
    await h.output.tick();now+=1000;h.refresh();h.put('phaseMode',2);await h.output.tick();
    now+=1000;h.refresh();h.put('i1',6);h.put('i2',0);h.put('i3',0);h.put('power',1.38);await h.output.tick();
    now+=46000;h.refresh();await h.output.tick();
    assert.equal(h.states.get('ems.0.Devices.Wallbox0.ResponseState').val,'limited');
    assert.ok(!h.writes.some(w=>w.id==='cmd'&&w.val>6));
    assert.ok(!h.writes.some(w=>w.id==='allow'&&w.val===0));
});

test('current reductions retain the outstanding electrical phase proof across command replacement', async () => {
    let now=Date.now();const h=setup({now:()=>now});
    Object.assign(h.config,{wb0PhaseSwitchEnabled:true,wb0PhaseModeId:'phaseMode',wb0AvailableCurrentId:'available'});
    h.put('available',32);h.put('phaseMode',1);await h.start();h.writes.length=0;
    const d=h.output.devices[0];d.lastA=14;d.response=null;d.lastAt=now-10000;
    h.put('feedback',14);h.put('i1',14);h.put('power',3.22);
    now+=1000;h.refresh();h.put('ems.0.Control.Targets.Wallbox0_Phases',3);await h.output.tick();
    now+=1000;h.refresh();h.put('phaseMode',2);h.put('available',6);await h.output.tick();
    assert.ok(h.writes.some(w=>w.id==='cmd'&&w.val===6));
    assert.equal(d.response.phaseChange,true);
    now+=1000;h.refresh();h.put('feedback',6);h.put('i1',6);h.put('i2',0);h.put('i3',0);h.put('power',1.38);
    await h.output.tick();h.writes.length=0;
    now+=46000;h.refresh();h.put('available',32);await h.output.tick();
    assert.equal(d.response.phaseChange,true);
    assert.equal(h.states.get('ems.0.Devices.Wallbox0.ResponseState').val,'limited');
    assert.ok(!h.writes.some(w=>w.id==='cmd'&&w.val>6));
});

async function measuredRunningMii() {
    let now = 1000000;
    const h = setup({now: () => now});
    h.config.combinedProductionArmed = true;
    h.put('split', 1);
    h.put('ems.0.Config.DHWParallelDistributionEnabled', true);
    h.put('ems.0.Devices.MyPV_DHW.ControlEnabled', true);
    await h.start();
    const d = h.output.devices[0];
    d.lastA = 15; d.lastAt = now - 10000; d.pending = null; d.response = null;
    d.owned = true; d.activeSince = now - 10000;
    h.ack('allow', 1); h.ack('feedback', 15);
    h.put('power', 3.15); h.put('i1', 13.9);
    h.put('ems.0.Control.Targets.Wallbox0_W', 3910);
    h.put('export', 573); h.put('import', 0);
    h.writes.length = 0;
    return {h, d, advance: () => { now += 6000; h.refresh(); }};
}

test('running measured Mii budget advances one amp despite insufficient whole nominal target', async () => {
    const {h, d} = await measuredRunningMii();
    await h.output.tick();
    assert.deepEqual(h.writes, [{id: 'cmd', val: 16}]);
    assert.equal(d.measuredBudgetStep.amps, 16);
    const budget = JSON.parse(h.states.get('ems.0.Devices.Wallbox0.IncreaseBudget_JSON').val);
    assert.equal(budget.basis, 'measured-one-amp-step');
    assert.equal(budget.requiredW, 3380);
    assert.equal(budget.availableW, 3623);
    assert.ok(!h.writes.some(x => x.id === 'allow'), 'keep the running charge block');
});

test('a command ACK or unchanged fresh car poll cannot replenish measured-step permission', async () => {
    const {h, d, advance} = await measuredRunningMii();
    await h.output.tick();
    advance(); h.ack('feedback', 16);
    h.put('power', 3.15); h.put('i1', 13.9);
    await h.output.tick();
    advance(); await h.output.tick();
    assert.equal(h.writes.filter(x => x.id === 'cmd' && x.val > 16).length, 0);
    assert.ok(d.measuredBudgetStep, 'unchanged uptake remains unknown, even with ACK');
    h.put('power', 3.38); h.put('i1', 14.9);
    await h.output.tick();
    assert.equal(h.writes.at(-1).val, 17, 'new electrical uptake qualifies only the next step');
    assert.equal(h.writes.filter(x => x.id === 'allow').length, 0);
});

test('measured step remains bounded by actual surplus, phase limits and operator limits', async () => {
    for (const mutate of [
        h => h.put('export', 300),
        h => {h.config.wb0CommissioningMaxA = 15;},
        h => {h.put('lpc', 'limited'); h.put('lpcLimit', 3400);}
    ]) {
        const {h} = await measuredRunningMii();
        mutate(h);
        await h.output.tick();
        assert.ok(!h.writes.some(x => x.id === 'cmd' && x.val > 15), JSON.stringify(h.writes));
    }
});

test('a pending measured step never blocks a necessary downward command', async () => {
    const {h, advance} = await measuredRunningMii();
    await h.output.tick();
    advance(); h.ack('feedback', 16); h.put('power', 3.15); h.put('i1', 13.9);
    await h.output.tick();
    advance(); h.put('ems.0.Control.Targets.Wallbox0_W', 3220);
    h.put('export', 0); h.put('import', 500);
    await h.output.tick();
    assert.ok(h.writes.some(x => x.id === 'cmd' && x.val < 16));
});


test('measured three-phase increase reserves a full 690 W step and retains nominal hard caps', async () => {
    const {h, d} = await measuredRunningMii();
    Object.assign(h.config, {wb0PhaseControlMode: 'fixed', wb0PhaseSwitchEnabled: true, wb0ProductionPhases: 3,
        wb0MaxPowerW: 22080, wb0MaxCurrent3pA: 32});
    h.put('ems.0.Control.Targets.Wallbox0_Phases', 3);
    d.confirmedPhases = 3; d.phaseTransitionUntil = 0;
    d.lastA = 7; h.ack('feedback', 7);
    for (const id of ['i1', 'i2', 'i3']) h.put(id, 6.4);
    h.put('power', 4.39); h.put('ems.0.Control.Targets.Wallbox0_W', 6210);
    h.put('export', 789);
    await h.output.tick();
    assert.ok(!h.writes.some(x => x.id === 'cmd' && x.val > 7));
    h.put('export', 857);
    await h.output.tick();
    assert.deepEqual(h.writes, [{id: 'cmd', val: 8}]);
    assert.equal(d.measuredBudgetStep.phases, 3);
    assert.equal(JSON.parse(h.states.get('ems.0.Devices.Wallbox0.IncreaseBudget_JSON').val).requiredW, 5080);
});

test('invalid real power cannot qualify a measured budget step', async () => {
    for (const invalid of [{ack: false}, {q: 64}, {val: null}, {ts: 1}]) {
        const {h} = await measuredRunningMii();
        h.put('power', 3.15, invalid);
        await h.output.tick();
        assert.ok(!h.writes.some(x => x.id === 'cmd' && x.val > 15), JSON.stringify(invalid));
    }
});

test('superseding a pending measured increase discards its old proof and permits a fresh budget step', async () => {
    const {h, d, advance} = await measuredRunningMii();
    d.lastA = 9; h.ack('feedback', 9);
    h.put('power', 1.79); h.put('i1', 7.9);
    h.put('ems.0.Control.Targets.Wallbox0_W', 2300); h.put('export', 400);
    await h.output.tick();
    assert.equal(d.pending.amps, 10);
    assert.equal(d.measuredBudgetStep.amps, 10);
    // A falling allocation supersedes 10 A while its ACK is processed.
    // Runtime lastA is still 9 A until the pending branch completes.
    advance(); h.ack('feedback', 10); h.put('power', 1.89); h.put('i1', 8.3);
    h.put('ems.0.Control.Targets.Wallbox0_W', 2070);
    await h.output.tick();
    assert.equal(d.pending.amps, 9);
    assert.equal(d.measuredBudgetStep, null, 'withdrawn 10 A must not keep a permanent proof lock');
    advance(); h.ack('feedback', 9); h.put('power', 1.91); h.put('i1', 8.4);
    await h.output.tick();
    advance(); h.put('ems.0.Control.Targets.Wallbox0_W', 2530); h.put('export', 448);
    await h.output.tick();
    assert.equal(h.writes.at(-1).val, 10);
    assert.equal(d.measuredBudgetStep.amps, 10);
    assert.equal(d.measuredBudgetStep.powerW, 1910, 'fresh step uses the current real response');
    advance(); h.ack('feedback', 10); await h.output.tick();
    advance(); await h.output.tick();
    assert.ok(!h.writes.some(x => x.id === 'cmd' && x.val > 10),
        'new ACK with unchanged car uptake does not grant repeated increases');
    assert.ok(!h.writes.some(x => x.id === 'allow'), 'the replacement keeps the charge block');
});

test('a hard cap replacing an unacknowledged measured increase clears only the obsolete step proof', async () => {
    const {h, d, advance} = await measuredRunningMii();
    await h.output.tick();
    assert.equal(d.pending.amps, 16);
    assert.equal(d.measuredBudgetStep.amps, 16);
    h.config.wb0CommissioningMaxA = 15;
    await h.output.tick();
    assert.equal(d.pending.amps, 15);
    assert.equal(d.measuredBudgetStep, null);
    assert.ok(d.response, 'replacement still needs its own current ACK and electrical response');
    h.config.wb0CommissioningMaxA = 32;
    const count = h.writes.length;
    await h.output.tick();
    assert.equal(h.writes.length, count, 'clearing proof cannot bypass an outstanding replacement response');
    advance(); h.ack('feedback', 15); h.put('power', 3.15); h.put('i1', 13.9);
    await h.output.tick();
    advance(); await h.output.tick();
    assert.equal(h.writes.at(-1).val, 16);
    assert.equal(d.measuredBudgetStep.amps, 16);
    assert.ok(!h.writes.some(x => x.id === 'allow'));
});


test('SMA total import and export remain usable through 30 seconds then trigger the stale-source stop', async () => {
    for (const id of ['import', 'export']) for (const ageMs of [16000, 29999, 30000, 30001, 31000]) {
        let now = 1000000; const h = setup({now: () => now});
        await h.start(); h.writes.length = 0;
        h.put(id, id === 'export' ? 8000 : 0, {ts: now - ageMs});
        await h.output.tick();
        const stopped = h.writes.some(x => x.id === 'allow' && x.val === 0);
        assert.equal(stopped, ageMs > 30000, `${id}: ${ageMs}`);
        if (stopped) assert.match(h.states.get('ems.0.Devices.Wallbox0.LastStopReason').val,
            /veraltet.*maximal 30 s/);
    }
});

function configureSmaHouseSources(h, directional) {
    if (!directional) return ['h1', 'h2', 'h3'];
    const ids = [];
    for (const phase of [1, 2, 3]) for (const direction of ['IMPORT', 'EXPORT']) {
        const id = `house.${phase}.${direction.toLowerCase()}`;
        h.mapping[`DP_HA_L${phase}_${direction}_W`] = id;
        h.put(id, 0);
        ids.push(id);
    }
    return ids;
}

test('every SMA house phase and current fallback keeps a running charge through thirty seconds', async t => {
    for (const directional of [true, false]) {
        const ids = directional
            ? [1, 2, 3].flatMap(phase => ['import', 'export'].map(direction => `house.${phase}.${direction}`))
            : ['h1', 'h2', 'h3'];
        for (const id of ids) for (const ageMs of [16000, 29999, 30000, 30001, 31000])
            await t.test(`${id}: ${ageMs} ms`, async () => {
                const now = 1000000;
                const h = setup({now: () => now});
                configureSmaHouseSources(h, directional);
                await h.start(); h.writes.length = 0;
                const activeSince = h.output.devices[0].activeSince;
                h.put(id, 0, {ts: now - ageMs, ack: true, q: 0});
                await h.output.tick();
                const stopped = h.writes.some(x => x.id === 'allow' && x.val === 0);
                assert.equal(stopped, ageMs > 30000);
                if (stopped) assert.match(h.states.get('ems.0.Devices.Wallbox0.LastStopReason').val,
                    /Hausanschluss L[123]:.*veraltet.*maximal 30 s/);
                else {
                    assert.equal(h.states.get('ems.0.Devices.Wallbox0.OutputActive').val, true);
                    assert.equal(h.output.devices[0].activeSince, activeSince, 'a valid older SMA poll does not reset the charge block');
                }
            });
    }
});

test('the SMA age extension retains phase value, ACK, quality and timestamp safeguards', async t => {
    const cases = [
        ['NULL', {val: null}], ['unacknowledged', {ack: false}], ['bad quality', {q: 64}],
        ['negative', {val: -1}], ['missing timestamp', {ts: undefined}], ['future timestamp', {ts: 1001001}]
    ];
    for (const directional of [true, false]) for (const [name, extra] of cases)
        await t.test(`${directional ? 'L3 export' : 'L3 current'}: ${name}`, async () => {
            const now = 1000000;
            const h = setup({now: () => now});
            const ids = configureSmaHouseSources(h, directional);
            await h.start(); h.writes.length = 0;
            h.put(ids.at(-1), 0, {ts: now - 16000, ack: true, q: 0, ...extra});
            await h.output.tick();
            assert.ok(h.writes.some(x => x.id === 'allow' && x.val === 0));
            assert.match(h.states.get('ems.0.Devices.Wallbox0.LastStopReason').val, /Hausanschluss L3/);
        });
});

test('a sixteen-second SMA phase sample still enforces the configured house limit and separate device-age limit', async () => {
    const now = 1000000;
    const h = setup({now: () => now});
    configureSmaHouseSources(h, true);
    await h.start(); h.writes.length = 0;
    h.put('house.1.import', 49 * 230, {ts: now - 16000, ack: true, q: 0});
    await h.output.tick();
    assert.ok(h.writes.some(x => x.id === 'allow' && x.val === 0), 'an accepted older SMA sample cannot defeat house protection');
    const device = setup({now: () => now});
    device.config.wallboxMeasurementMaxAgeS = 15;
    await device.start(); device.writes.length = 0;
    device.put('power', 0, {ts: now - 16000, ack: true, q: 0});
    await device.output.tick();
    assert.ok(device.writes.some(x => x.id === 'allow' && x.val === 0), 'the configured device age remains independent');
    assert.match(device.states.get('ems.0.Devices.Wallbox0.LastStopReason').val,
        /Wallbox-Leistung: veraltet.*maximal 15 s/);
});

test('an L3-only stale SMA phase launches a bounded direct diagnostic without delaying stop or refreshing the cache', async () => {
    const now = 1000000;
    const h = setup({now: () => now});
    configureSmaHouseSources(h, true);
    await h.start(); h.writes.length = 0;
    const id = 'house.3.export';
    const cached = {val: 0, ts: now - 31000, lc: now - 40000, ack: true, q: 0};
    h.put(id, cached.val, cached);
    h.adapter.getCachedStateReceipt = sourceId => sourceId === id
        ? {receivedAt: now - 31000, via: 'stateChange'} : null;
    let resolveRead;
    const reads = [];
    h.adapter.getForeignStateAsync = async sourceId => {
        reads.push(sourceId);
        return new Promise(resolve => {resolveRead = resolve;});
    };
    await h.output.tick();
    assert.ok(h.writes.some(x => x.id === 'allow' && x.val === 0), 'protection does not await diagnostic IO');
    let diag = JSON.parse(h.states.get('ems.0.Devices.Wallbox0.LastStopSourceDiagnostics_JSON').val);
    assert.deepEqual(diag.sources.map(s => s.id), [id], 'fresh total-grid sources need no direct diagnostic');
    assert.equal(diag.sources[0].maxAgeMs, 30000);
    assert.equal(diag.sources[0].cached.ageMs, 31000);
    assert.equal(diag.sources[0].receipt.via, 'stateChange');
    assert.equal(diag.sources[0].direct.status, 'pending');
    await h.output.tick(); assert.deepEqual(reads, [id], 'one direct read per continuous phase fault');
    resolveRead({val: 100, ts: now, lc: now - 20, ack: true, q: 0});
    for (let i = 0; i < 15; i++) await Promise.resolve();
    diag = JSON.parse(h.states.get('ems.0.Devices.Wallbox0.LastStopSourceDiagnostics_JSON').val);
    assert.equal(diag.sources[0].direct.status, 'read');
    assert.equal(diag.sources[0].direct.snapshot.val, 100);
    assert.equal(diag.sources[0].cacheAtCompletion.ageMs, 31000);
    assert.equal(h.states.get(id).ts, cached.ts, 'read-only diagnostic is not operative source freshness');
    assert.match(h.states.get('ems.0.Devices.Wallbox0.LastStopReason').val, /house\.3\.export:.*Direktlesung=read/);
    assert.ok(!h.writes.some(x => x.id === 'allow' && x.val === 1));
});

test('stale SMA diagnostic stops without waiting for direct read and never writes the read into control cache', async () => {
    let now = 1000000; const h = setup({now: () => now});
    await h.start(); h.writes.length = 0;
    const old = {val: 8000, ts: now - 31000, lc: now - 40000, ack: true, q: 0};
    h.put('export', old.val, old);
    h.adapter.getCachedStateReceipt = () => ({receivedAt: now - 31000, via: 'stateChange'});
    let resolveRead; let reads = 0;
    h.adapter.getForeignStateAsync = async () => {reads++; return new Promise(resolve => {resolveRead = resolve;});};
    await h.output.tick();
    assert.ok(h.writes.some(x => x.id === 'allow' && x.val === 0), 'protection must not await diagnostic IO');
    let diag = JSON.parse(h.states.get('ems.0.Devices.Wallbox0.LastStopSourceDiagnostics_JSON').val);
    assert.equal(diag.sources[0].cached.ageMs, 31000);
    assert.equal(diag.sources[0].receipt.via, 'stateChange');
    assert.equal(diag.sources[0].direct.status, 'pending');
    await h.output.tick(); assert.equal(reads, 1, 'one read per continuous source-fault episode');
    resolveRead({val: 700, ts: now, lc: now - 20, ack: true, q: 0});
    for (let i = 0; i < 15; i++) await Promise.resolve();
    diag = JSON.parse(h.states.get('ems.0.Devices.Wallbox0.LastStopSourceDiagnostics_JSON').val);
    assert.equal(diag.sources[0].direct.status, 'read');
    assert.equal(diag.sources[0].direct.snapshot.val, 700);
    assert.equal(diag.sources[0].cacheAtCompletion.ageMs, 31000);
    assert.equal(h.states.get('export').ts, old.ts, 'diagnostic cannot grant operative freshness');
    assert.match(h.states.get('ems.0.Devices.Wallbox0.LastStopReason').val, /export: Wert=8000.*Direktlesung=read/);
    assert.ok(!h.writes.some(x => x.id === 'allow' && x.val === 1));
});

const flushDiagnostics = async () => {for (let i = 0; i < 40; i++) await Promise.resolve();};
const readStopDiag = h => JSON.parse(h.states.get('ems.0.Devices.Wallbox0.LastStopSourceDiagnostics_JSON').val);

test('issue116 old go-e source time remains stale despite fresh EMS receipt and independent delayed read', async () => {
    let now = 1000000;
    const h = setup({now: () => now}); await h.start(); h.writes.length = 0;
    const events = [];
    h.adapter.shadowController = {recordSession: 123, recordSequence: 77,
        productionRecord: event => events.push(JSON.parse(JSON.stringify(event)))};
    h.adapter.getCachedStateReceipt = () => ({receivedAt: now, via: 'stateChange'});
    h.put('error', 0, {ts: now - 32000, lc: now - 100000, ack: true, q: 0});
    let finish;
    const reads = [];
    h.adapter.getForeignStateAsync = id => {
        reads.push(id);
        return id === 'error' ? new Promise(resolve => {finish = resolve;}) : Promise.resolve(h.states.get(id));
    };
    await h.output.tick();
    assert.ok(h.writes.some(w => w.id === 'allow' && w.val === 0));
    assert.equal(h.states.get('allow').ack, false, 'write echo is not OFF proof');
    assert.equal(h.output.devices[0].owned, true);
    let diag = readStopDiag(h);
    assert.equal(diag.sources[0].cached.ageMs, 32000);
    assert.equal(diag.sources[0].receipt.receivedAt, now);
    assert.equal(diag.recordSession, 123);
    assert.equal(diag.recordSequenceAtCheck, 77);
    assert.equal(diag.sources[0].direct.status, 'pending');
    await h.output.tick();
    assert.equal(reads.filter(id => id === 'error').length, 1);
    now += 1000;
    finish({val: 0, ts: now, lc: now - 100000, ack: true, q: 0});
    await flushDiagnostics();
    diag = readStopDiag(h);
    assert.equal(diag.sources[0].direct.requestedAt, 1000000);
    assert.equal(diag.sources[0].direct.completedAt, now);
    assert.equal(diag.sources[0].direct.snapshot.ts, now);
    assert.equal(h.states.get('error').ts, 968000, 'independent IO cannot refresh operative telemetry');
    assert.ok(events.some(e => e.type === 'source_diagnostic.complete' && e.episode.key === diag.key));
    assert.ok(!h.writes.some(w => w.id === 'allow' && w.val === 1));
});

test('issue116 stalled go-e diagnostic times out without blocking OFF and survives late electrical recovery', async t => {
    t.mock.timers.enable({apis: ['setTimeout']});
    let now = 1000000;
    const h = setup({now: () => now}); await h.start(); h.writes.length = 0;
    h.put('error', 0, {ts: now - 32000});
    let finish;
    h.adapter.getForeignStateAsync = id => id === 'error'
        ? new Promise(resolve => {finish = resolve;}) : Promise.resolve(h.states.get(id));
    await h.output.tick();
    assert.equal(h.writes[0].val, 0);
    now += 5001; t.mock.timers.tick(5001); await flushDiagnostics();
    const key = readStopDiag(h).key;
    assert.equal(readStopDiag(h).sources[0].direct.status, 'timeout');
    finish({val: 0, ts: now, ack: true, q: 0}); await flushDiagnostics();
    assert.equal(readStopDiag(h).sources[0].direct.status, 'timeout');
    now += 16000; h.refresh(); await h.output.tick();
    const fault = h.output.devices[0].fault;
    assert.match(fault, /AUS-Rueckmeldung/);
    await flushDiagnostics();
    assert.equal(readStopDiag(h).offTimeout.cached.ack, false);
    assert.equal(readStopDiag(h).offTimeout.direct.snapshot.ack, false);
    assert.equal(h.output.devices[0].owned, true);
    assert.doesNotMatch(h.states.get('ems.0.Devices.Wallbox0.OutputStatus').val, /elektrisch ruhig/);
    now += 8000; h.refresh(); h.ack('allow', 0); h.electricalOff();
    h.put('car', 1); await h.output.tick();
    assert.equal(h.output.devices[0].owned, false);
    assert.equal(h.output.devices[0].fault, fault, 'late OFF must not unlock');
    await h.output.tick();
    assert.match(h.states.get('ems.0.Devices.Wallbox0.OutputStatus').val, /AUS inzwischen bestaetigt, elektrisch ruhig, Wiederfreigabe gesperrt/);
    assert.equal(readStopDiag(h).key, key);
    assert.equal(readStopDiag(h).sources[0].direct.status, 'timeout');
    assert.equal(h.states.get('ems.0.Devices.Wallbox0.OutputReservedPower_W').val, 0);
    assert.ok(!h.writes.some(w => w.id === 'allow' && w.val === 1));
    h.put('i3', null); await h.output.tick();
    assert.doesNotMatch(h.states.get('ems.0.Devices.Wallbox0.OutputStatus').val, /elektrisch ruhig/);
});

test('issue116 missing independent answer stays unknown and cannot prove OFF', async () => {
    const h = setup({now: () => 1000000}); await h.start();
    h.adapter.getForeignStateAsync = async () => null;
    h.put('error', 0, {ack: false});
    await h.output.tick(); await flushDiagnostics();
    const diag = readStopDiag(h);
    assert.equal(diag.sources[0].cached.ack, false);
    assert.equal(diag.sources[0].direct.status, 'missing');
    assert.equal(diag.sources[0].direct.snapshot, null);
    assert.equal(h.output.devices[0].owned, true);
});

test('issue116 completion is attributed to original stop and cannot replace a later stop at same clock time', async () => {
    const h = setup({now: () => 1000000}); await h.start();
    const events = [];
    h.adapter.shadowController = {productionRecord: e => events.push(JSON.parse(JSON.stringify(e)))};
    let finish;
    h.adapter.getForeignStateAsync = id => id === 'error'
        ? new Promise(resolve => {finish = resolve;}) : Promise.resolve(h.states.get(id));
    h.put('error', 0, {ts: 968000}); await h.output.tick();
    const first = readStopDiag(h);
    h.refresh(); h.ack('allow', 0); h.electricalOff(); await h.output.tick();
    // Isolate the new productive stop from the separate restart-delay contract.
    h.output.devices[0].owned = true;
    h.output.devices[0].pending = null;
    h.put('ems.0.Devices.Wallbox0.OutputActive', true);
    h.ack('allow', 1);
    h.put('connection', false); await h.output.tick();
    const nextReason = h.states.get('ems.0.Devices.Wallbox0.LastStopReason').val;
    assert.match(nextReason, /offline/);
    finish({val: 0, ts: 1000000, ack: true, q: 0}); await flushDiagnostics();
    assert.equal(h.states.get('ems.0.Devices.Wallbox0.LastStopReason').val, nextReason);
    assert.equal(readStopDiag(h).key, first.key, 'retained evidence belongs to the original stop');
    assert.equal(readStopDiag(h).sources[0].direct.status, 'read', 'original result can finish without replacing new stop reason');
    assert.ok(events.some(e => e.type === 'source_diagnostic.complete' && e.episode.key === first.key
        && e.episode.sources[0].direct.status === 'read'), 'old completion remains in the existing recorder');
});

for (const [name, change] of [
    ['residual L1 current', h => h.put('i1', 1)],
    ['unknown L2', h => h.put('i2', null)],
    ['bad L3 quality', h => h.put('i3', 0, {q: 64})],
    ['old electrical sample', h => h.put('power', 0, {ts: 999999})]
]) test('issue116 late OFF retains lock and ownership with ' + name, async () => {
    let now = 1000000;
    const h = setup({now: () => now}); await h.start();
    h.put('ems.0.Vehicles.Wallbox0.Release', false); await h.output.tick();
    now += 21000; h.refresh(); await h.output.tick();
    const fault = h.output.devices[0].fault;
    h.ack('allow', 0); h.electricalOff(); change(h); await h.output.tick();
    assert.equal(h.output.devices[0].owned, true);
    assert.equal(h.output.devices[0].fault, fault);
    assert.equal(h.states.get('ems.0.Devices.Wallbox0.StopPowerPending').val, true);
    assert.doesNotMatch(h.states.get('ems.0.Devices.Wallbox0.OutputStatus').val, /elektrisch ruhig/);
});

for (const [name, change] of [
    ['unplugging', h => h.put('car', 1)],
    ['device error', h => h.put('error', 5)],
    ['unclear phases', h => {h.config.wb0PhaseControlMode = 'ems'; h.output.devices[0].ids.phaseMode = 'phase'; h.put('phase', 0);}]
]) test('issue116 quiet late OFF never re-arms after ' + name, async () => {
    let now = 1000000;
    const h = setup({now: () => now}); await h.start(); h.writes.length = 0;
    h.put('ems.0.Vehicles.Wallbox0.Release', false); await h.output.tick();
    now += 21000; h.refresh(); await h.output.tick();
    const fault = h.output.devices[0].fault;
    h.ack('allow', 0); h.electricalOff(); change(h);
    h.put('ems.0.Vehicles.Wallbox0.Release', true);
    await h.output.tick(); await h.output.tick();
    assert.equal(h.output.devices[0].owned, false);
    assert.equal(h.output.devices[0].fault, fault);
    assert.match(h.states.get('ems.0.Devices.Wallbox0.OutputStatus').val, /Wiederfreigabe gesperrt/);
    assert.ok(!h.writes.some(w => w.id === 'allow' && w.val === 1));
});

test('issue116 diagnostic recorder and logger failures cannot block the protection OFF command', async () => {
    const h = setup({now: () => 1000000}); await h.start(); h.writes.length = 0;
    h.adapter.shadowController = {productionRecord() {throw new Error('recorder unavailable');}};
    h.adapter.log.error = () => {throw new Error('logger unavailable');};
    h.put('error', 0, {ts: 968000}); await h.output.tick(); await flushDiagnostics();
    assert.ok(h.writes.some(w => w.id === 'allow' && w.val === 0));
    assert.equal(h.output.devices[0].owned, true);
    assert.equal(readStopDiag(h).sources[0].direct.status, 'read');
});

test('issue116 a new telemetry stop at the same time retains its own diagnostic against late older completion', async () => {
    const h = setup({now: () => 1000000}); await h.start();
    let finish;
    h.adapter.getForeignStateAsync = id => id === 'error'
        ? new Promise(resolve => {finish = resolve;}) : Promise.resolve(h.states.get(id));
    h.put('error', 0, {ts: 968000}); await h.output.tick();
    const oldKey = readStopDiag(h).key;
    h.refresh(); h.ack('allow', 0); h.electricalOff(); await h.output.tick();
    h.output.devices[0].owned = true; h.put('ems.0.Devices.Wallbox0.OutputActive', true); h.ack('allow', 1);
    h.put('connection', true, {ack: false}); await h.output.tick();
    const next = readStopDiag(h);
    assert.notEqual(next.key, oldKey);
    assert.match(next.reason, /Verbindungsstatus/);
    finish({val: 0, ts: 1000000, ack: true, q: 0}); await flushDiagnostics();
    assert.equal(readStopDiag(h).key, next.key);
    assert.equal(readStopDiag(h).sources[0].id, 'connection');
    assert.match(h.states.get('ems.0.Devices.Wallbox0.LastStopReason').val, /Verbindungsstatus/);
});

test('completed diagnostic survives recovery but cannot overwrite a newer source-fault event', async () => {
    const h = setup(); await h.start();
    const d = h.output.devices[0];
    const pending = [];
    h.adapter.getForeignStateAsync = () => new Promise(resolve => pending.push(resolve));
    h.output.measurementFaultDiagnostic(d, [{id: 'export', maxAgeMs: 30000}], 'old fault');
    for (let i = 0; i < 4; i++) await Promise.resolve();
    d.sourceFaultEpisode = null; // valid current sources ended the active fault.
    pending.shift()({val: 20, ts: Date.now(), ack: true, q: 0});
    for (let i = 0; i < 15; i++) await Promise.resolve();
    let diag = JSON.parse(h.states.get('ems.0.Devices.Wallbox0.LastStopSourceDiagnostics_JSON').val);
    assert.equal(diag.sources[0].direct.status, 'read', 'retain outcome even after the source recovered');
    h.output.measurementFaultDiagnostic(d, [{id: 'export', maxAgeMs: 30000}], 'another fault');
    for (let i = 0; i < 4; i++) await Promise.resolve();
    h.put('ems.0.Devices.Wallbox0.LastStopSourceDiagnostics_JSON', JSON.stringify({key: 'newer-event'}));
    d.sourceFaultEpisode = null;
    pending.shift()({val: 30, ts: Date.now(), ack: true, q: 0});
    for (let i = 0; i < 15; i++) await Promise.resolve();
    diag = JSON.parse(h.states.get('ems.0.Devices.Wallbox0.LastStopSourceDiagnostics_JSON').val);
    assert.equal(diag.key, 'newer-event', 'late read must not overwrite a subsequent diagnostic');
});


