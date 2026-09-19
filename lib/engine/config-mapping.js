/* Runtime mapping overlay.
 * All external object IDs come exclusively from the adapter configuration.
 */
'use strict';

CFG.sqlInstance = '__DP_SQL_INSTANCE__';
CFG.dp.wallboxMinSoc = ['__DP_WB0_MIN_SOC__', '__DP_WB1_MIN_SOC__', '__DP_WB2_MIN_SOC__'];
CFG.dp.wallboxAllow = ['__DP_WB0_ALLOW__', '__DP_WB1_ALLOW__', '__DP_WB2_ALLOW__'];
CFG.dp.wallboxPhases = ['__DP_WB0_PHASES__', '__DP_WB1_PHASES__', '__DP_WB2_PHASES__'];
CFG.dp.wallboxPhaseCurrents = [
    ['__DP_WB0_L1_A__', '__DP_WB0_L2_A__', '__DP_WB0_L3_A__'],
    ['__DP_WB1_L1_A__', '__DP_WB1_L2_A__', '__DP_WB1_L3_A__'],
    ['__DP_WB2_L1_A__', '__DP_WB2_L2_A__', '__DP_WB2_L3_A__']
];
CFG.dp.wallboxPriority = '__DP_WB_PRIORITY__';
CFG.dp.wallboxManualMinCurrent = ['__DP_WB0_AMIN__', '__DP_WB1_AMIN__', '__DP_WB2_AMIN__'];
CFG.dp.dhwParallelRelease = '__DP_DHW_PARALLEL_RELEASE__';
CFG.dp.myPvDhwRelease = '__DP_DHW_RELEASE__';
CFG.dp.myPvDhwOutletTemp = '__DP_DHW_OUTLET_TEMP__';
CFG.dp.myPvDhwConnection = '__DP_DHW_CONNECTION__';
CFG.dp.myPvDhwHysteresis = '__DP_DHW_HYSTERESIS__';
CFG.dp.myPvDhwSetpoint = '__DP_DHW_SETPOINT__';
CFG.dp.myPvDhwActualMirror = '__DP_DHW_ACTUAL_MIRROR__';
CFG.dp.myPvDhwOutputW = ['__DP_DHW_OUTPUT1__', '__DP_DHW_OUTPUT2__', '__DP_DHW_OUTPUT3__'];
CFG.dp.myPvDhwHaFreeCurrentA = ['__DP_DHW_HA_L1_FREE_A__', '__DP_DHW_HA_L2_FREE_A__', '__DP_DHW_HA_L3_FREE_A__'];
CFG.dp.myPvDhwHaCurrentA = ['__DP_DHW_HA_L1_CURRENT_A__', '__DP_DHW_HA_L2_CURRENT_A__', '__DP_DHW_HA_L3_CURRENT_A__'];
CFG.dp.myPvHeatingTemp = '__DP_HEAT_TEMP__';
