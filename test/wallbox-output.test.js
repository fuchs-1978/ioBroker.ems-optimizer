'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const WallboxOutput = require('../lib/wallbox-output');

function setup() {
    const states = new Map(), writes = [];
    let now = Date.now();
    const put = (id, val, extra = {}) => states.set(id, {val, ack: true, ts: now, ...extra});
    const mapping = {DP_WB0_CAR: 'car', DP_WB0_SOC: 'soc', DP_WB0_ALLOW: 'userAllow',
        DP_WB0_POWER: 'power', DP_WB0_L1_A: 'i1', DP_WB0_L2_A: 'i2', DP_WB0_L3_A: 'i3',
        DP_GRID_IMPORT: 'import', DP_GRID_EXPORT: 'export', DP_HA_CRITICAL: 'critical',
        DP_PAR14A: 'par14a', DP_LPC_STATE: 'lpc', DP_LPC_LIMIT: 'lpcLimit',
        DP_DHW_PARALLEL_RELEASE: 'split'};
    const config = {globalWriteEnabled: true, wb0Present: true, wb0ControlEnabled: true,
        wb0ProductionArmed: true, wb0CommissioningMaxA: 32, wb0MaxCurrent1pA: 32,
        wb0MaxPowerW: 7360, wb0AmpereOutputId: 'cmd', wb0AllowOutputId: 'allow',
        wb0AmpereFeedbackId: 'feedback', wb0ConnectionId: 'connection', wb0ErrorId: 'error',
        dhwHaL1CurrentId: 'h1', dhwHaL2CurrentId: 'h2', dhwHaL3CurrentId: 'h3', slowCycleS: 5,
        par14aActiveHigh: true, par14aLimitW: 4200, wallboxRestartHandoffSettleS: 0};
    const adapter = {namespace: 'ems.0', config, stateCache: states,
        getCachedState: id => states.get(id), readMapping: () => mapping,
        setCompatState: (id, val) => put(id, val),
        setStateAsync: async (id, val) => put(`ems.0.${id}`, val),
        setForeignStateAsync: async (id, val) => { writes.push({id, val}); put(id, val, {ack: false, ts: Date.now()}); },
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
    const output = new WallboxOutput(adapter);
    const ack = (id, value) => put(id, value, {ts: Date.now() + 1});
    const refresh = () => {
        now = Date.now();
        for (const [id, s] of states) if (s.ack) put(id, s.val);
        for (const key of ['System.LastUpdate', 'Control.LastUpdate', 'Plan.LastUpdate']) put(`ems.0.${key}`, now);
    };
    const start = async () => {
        await output.initialize();
        await output.tick(); ack('allow', 0);
        await output.tick(); ack('feedback', 6);
        await output.tick(); ack('allow', 1);
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
    return {adapter, config, mapping, states, writes, put, ack, refresh, start, output, enableWallbox};
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
test('lower target supersedes a pending current increase without stopping the wallbox', async () => {
    const h=setup();h.config.wallboxMinimumRunTimeS=600;await h.start();
    h.put('i1',6);h.put('power',1.38);h.output.devices[0].lastAt-=10000;h.writes.length=0;
    await h.output.tick();
    assert.deepEqual(h.writes,[{id:'cmd',val:12}]);
    h.put('ems.0.Control.Targets.Wallbox0_W',0);h.put('export',0);
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
test('combined wallbox also waits for residual DHW power at a zero target', async () => {
    const h=setup();h.config.combinedProductionArmed=true;h.put('split',1);
    h.put('ems.0.Config.DHWParallelDistributionEnabled',true);
    h.put('ems.0.Devices.MyPV_DHW.ControlEnabled',true);
    h.put('ems.0.Control.Targets.MyPV_DHW_W',0);
    h.put('ems.0.Actual.MyPV_DHW_W',1000);
    await h.output.initialize();await h.output.tick();
    assert.equal(h.writes.length,0);
    assert.match(h.states.get('ems.0.Devices.Wallbox0.OutputStatus').val,/EHZ-Feinregler/);
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
    h.ack('allow',0);await h.output.tick();
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
    h.ack('allow',0); await h.output.tick(); await h.output.tick();
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
    h.ack('allow',0);await h.output.tick();
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
    h.ack('allow',0);await h.output.tick();
    assert.equal(h.output.devices[0].owned,false);
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

module.exports={setup};
