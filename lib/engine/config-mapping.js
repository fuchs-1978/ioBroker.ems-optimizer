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
CFG.dp.myPvDhwRelease = '__DP_DHW_RELEASE__';
CFG.dp.myPvDhwOutletTemp = '__DP_DHW_OUTLET_TEMP__';
CFG.dp.myPvDhwConnection = '__DP_DHW_CONNECTION__';
CFG.dp.myPvDhwHysteresis = '__DP_DHW_HYSTERESIS__';
CFG.dp.myPvHeatingTemp = '__DP_HEAT_TEMP__';
