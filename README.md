![EMS Optimizer logo](admin/ems-optimizer.png)

# EMS Optimizer

[![Test and Release](https://github.com/fuchs-1978/ioBroker.ems-optimizer/actions/workflows/test-and-release.yml/badge.svg?branch=main)](https://github.com/fuchs-1978/ioBroker.ems-optimizer/actions/workflows/test-and-release.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

Forecast-based energy management for [ioBroker](https://www.iobroker.net/). Combines PV and grid measurements, load history, weather forecasts and electricity prices in a rolling 48-hour plan.

**Current GitHub build 0.17.0-alpha.266.** Install the tested build from GitHub and commission each enabled device against its actual feedback and protection limits.

[Deutsche Bedienungsanleitung](README.de.md) · [Release history](CHANGELOG_OLD.md) · [Issues](https://github.com/fuchs-1978/ioBroker.ems-optimizer/issues)

## Contents

- [Features](#features)
- [Current scope](#current-scope)
- [Live distribution and plan recovery](#live-distribution-and-plan-recovery)
- [Hot-water planning](#hot-water-planning)
- [Vehicle SoC and handoff](#vehicle-soc-and-handoff)
- [Minimum SoC by departure](#minimum-soc-by-departure)
- [Forecast comparison](#forecast-comparison)
- [Requirements](#requirements)
- [Installation and setup](#installation-and-setup)
- [Configuration](#configuration)
- [Integrations](#integrations)
- [Diagnostics](#diagnostics)
- [Development](#development)
- [Changelog](#changelog)
- [Support](#support)
- [License](#license)

## Features

- Coordinate up to three wallboxes, including vehicle priorities, minimum/target state of charge, manual minimum current and optional parallel charging.
- Optionally plan a vehicle's minimum SoC by departure using PV and total electricity prices, with an immediate mobility reserve.
- Allocate available PV power between charging and a domestic-hot-water heater, respecting grid, phase and device limits.
- Plan optional battery charging using forecasts, electricity prices and time-dependent grid charges.
- Provide separate heating-buffer and battery outputs when explicitly configured and enabled.
- Observe heat-pump telemetry and publish passive recommendations. Heat-pump, SG-Ready and KNX actuator commands are not implemented.
- Compare day-ahead Median, Lasso and two fixed combinations without changing production planning.
- Preserve selected existing room-temperature histories and archive available weather forecasts for later analysis.
- Record bounded diagnostic episodes and daily summaries for targeted investigation instead of full-day SQL downloads.

`Diagnostics.BatteryStrategy` provides a read-only preview of the storage reserve, intermediate SoC target and combined overnight demand. The optional PV coordination in Alpha.220 uses the battery target in the current plan to share surplus and buffer wallbox current steps. [Strategy preview](docs/release-0.17.0-alpha.165.md) · [PV coordination in Alpha.220](#0170-alpha220-2026-11-09)

## Current scope

| Available | Remaining work |
| --- | --- |
| Wallbox allocation, qualified handoff, measured SoC estimation and bounded current recovery | Live evidence for SoC after a trip, Mii taper transfer, and phase/protection cases. The source of contradictory go-e reports and the live Alpha.205 recovery remain open. [Vehicle operation #7](https://github.com/fuchs-1978/ioBroker.ems-optimizer/issues/7) · [Phase switching #8](https://github.com/fuchs-1978/ioBroker.ems-optimizer/issues/8) · [go-e #216](https://github.com/fuchs-1978/ioBroker.ems-optimizer/issues/216) |
| Optional minimum-SoC planning with an immediate mobility reserve | Verify reserve charging, tariff selection and fallback on site. [Integration and commissioning #25](https://github.com/fuchs-1978/ioBroker.ems-optimizer/issues/25) |
| Four passive day-ahead load candidates, common-slot 7/14-day evaluation and weather/room-history retention | Longer validation against time-weighted actuals and confirmation of archive delivery. [Forecast comparison #284](https://github.com/fuchs-1978/ioBroker.ems-optimizer/issues/284) |
| Bounded recorder, exact SQL confirmation and qualified recovery | Long SQL transport delays and historical recording gaps remain under [recorder investigation](https://github.com/fuchs-1978/ioBroker.ems-optimizer/issues/60). A healthy current queue does not repair past losses. |
| Battery strategy preview, optional PV coordination and heat-pump telemetry | Integrate the remaining storage reserve and overnight planning and commission the battery on site. Track heat planning and group-net control separately. [Battery #25](https://github.com/fuchs-1978/ioBroker.ems-optimizer/issues/25) · [Heat planning #160](https://github.com/fuchs-1978/ioBroker.ems-optimizer/issues/160) · [LPC group-net #166](https://github.com/fuchs-1978/ioBroker.ems-optimizer/issues/166) |

The [current roadmap](https://github.com/fuchs-1978/ioBroker.ems-optimizer/issues/36) assigns each remaining task. Implemented transition/reaction features are closed as software work; their natural operating checks remain in #7. General Admin/runtime acceptance stays in [#26](https://github.com/fuchs-1978/ioBroker.ems-optimizer/issues/26), the current checker report in [#316](https://github.com/fuchs-1978/ioBroker.ems-optimizer/issues/316). [Archived issue evidence](docs/issue-audit/2026-11-03/README.md) preserves previous reports and requirements.

## Live distribution and plan recovery

A missing, incomplete or stale plan no longer blocks allocation from valid current measurements. `Control.PlanFallbackActive` and `Control.PlanFallbackStatus` identify this mode; `Plan.Valid` remains unchanged. Vehicle priorities, minimum-SoC/manual rules, EHZ thermal release, confirmed handoff and electrical limits still apply. Forecast-based price charging, cheap-grid heating and scheduled PV boost are disabled until the real plan returns. Empty historic days are provisional and re-read with paced retries. [Recovery and limits](docs/release-0.17.0-alpha.198.md).

A restart can use validated cached SQL quarter-hours while SQL refreshes them in the background. Check `History.Building` for the refresh and `Plan.Valid` for the usable plan. [History cache and startup behavior](docs/release-0.17.0-alpha.213.md)

An enabled optional heater may temporarily use the start budget of a waiting vehicle, including a lower-priority follower. The heater must release the required power before the car starts. This works with the fixed wallbox/heater split switched off. An ongoing mandatory 3P charge uses its running minimum. The startup reserve applies to a stopped charger. [Countdown buffer policy](docs/release-0.17.0-alpha.199.md)

## Hot-water planning

The forecast builds the required hot-water reserve in the latest feasible cheaper slots before a price increase. It accounts for available PV, heater capacity, storage headroom and the remaining time. When the reserve and heater limits permit, it spreads the heat needed before a cheaper window at constant power across the equally priced slots. Actual heater output requires a separate live release. [Reserve planning and limits](docs/release-0.17.0-alpha.202.md)

Mandatory hot water can share PV with the preferred, already confirmed 1P charge at its minimum current when both loads fit and the upper-middle/outlet water remain at least at the configured minimum. The output explicitly reduces current before releasing heater budget. Otherwise heat keeps priority. A witnessed charge stopped for thermal priority may resume after 15 seconds of fresh budget qualification within a fixed 15-minute process-local window; current reserve, confirmed OFF, physical heater reduction and all electrical/source checks remain required. Ordinary starts retain their configured delay. [Thermal interruption policy](docs/release-0.17.0-alpha.201.md).

## Vehicle SoC and handoff

Confirmed unplug ends the calculated SoC session and clears the manual correction. The valid cloud/vehicle value applies while waiting for measured charge in the new session. During this wait, `SocEstimateStatus` is `cloud-after-unplug` and `EstimatedSoC_pct` is null. On the new charge, the estimator adds energy from a fresh counter anchor to the latest valid app value. If that value predates the observed unplug, the estimate is provisional for up to 30 minutes of the new charge and can accept one lower app reading. An entry in `Vehicles.WallboxN.SoCCorrection_pct` can also establish a fresh anchor. [Current SoC contract](README.de.md#fahrzeug-soc-und-sitzungswechsel).

A qualified charger-Finish observation can end charging and hand off after independent OFF/electrical-quiet proof; it does not set SoC to 100%. Sustained limited vehicle uptake can release budget for another vehicle through a confirmed lower command and the existing reserve/start checks. Real Mii taper transfer remains a separate acceptance case from the successful EQV-unplug/EQE handoff. [Finish](docs/release-0.17.0-alpha.194.md) · [Taper budget](docs/release-0.17.0-alpha.195.md).

During an EMS-controlled single-phase charge, a confirmed 1 A increase can roll back to the previous lower current on both go-e channels. With a fresh matching electrical measurement, the EMS can recover once by commanding the lower current or a further reduction within the current budget. Both channels must acknowledge the new command within the existing deadline. The stop path applies if a protection check fails or acknowledgement is missing. [Alpha.205 recovery and limits](docs/release-0.17.0-alpha.205.md)

### Minimum SoC by departure

**Plan minimum vehicle SoC by departure** is off by default for each wallbox. The default is to charge immediately to the minimum SoC when charging is authorized. To schedule that minimum by departure, enable both departure and price charging and provide a valid departure time, price-charging session and mobility reserve above 0% and below the minimum SoC.

The EMS charges the mobility reserve immediately. It credits usable PV before departure and schedules the remaining minimum demand in the lowest-priced available 15-minute slots, including grid fees in the total price. With a fixed energy price and time-dependent grid fees, it uses the low tariff first, followed by the standard and high tariffs as needed. The configured price cap applies to optional grid charging up to the target SoC. If the schedule is missing or cannot cover the minimum by departure, immediate charging to the minimum applies. [Release notes](docs/release-0.17.0-alpha.222.md) · [Admin reference](docs/admin-reference.de.md#mobilitätsreserve-und-vorhandene-abfahrtszeit)

## Forecast comparison

Enable the optional comparison in **History & forecast**. Production keeps its selected load profile. The four candidates are:

| Candidate | Calculation |
| --- | --- |
| Median | Typical quarter-hour load by weekday/holiday. |
| Lasso | Regularized model using cleaned load 2/7 calendar days earlier, time of day, weekday/holiday and optionally outside temperature/heating degree. |
| 50/50 blend | Arithmetic mean of the two predictions in each quarter-hour. |
| Lasso energy / Median shape | Scale the whole Median curve by Lasso daily energy divided by Median daily energy. This is a day-ahead scaling, not an adjustment to later actual consumption. |

Training runs on startup and with the daily history build at 00:10, using at most 84 days. Issued forecasts survive restart unchanged. `Forecast.LoadComparison.*` contains the model, forecast ledger and evaluation. Compare actuals and predictions over identical measured quarter-hours; a partial-day report must show its cutoff and slot coverage. The evaluation also reports the last 7/14 completed local calendar days: all four models share the same measured slot intersection, MAE/RMSE pool the individual errors, and energy comparisons use only identical complete days. Coverage, provisional windows and excluded DST days remain explicit. Power actuals and production/Lasso training use time-weighted raw SQL values on common quarter-hour boundaries. Unknown gaps stay missing. Derived energy remains an estimate, not a billing-meter difference. Legacy frozen forecasts retain their original training method; corrected actuals are used for evaluation. A complete regular day requires 96 paired slots; 92/100-slot DST target days are currently excluded. For calendar lags, both measured repeated-hour occurrences are averaged, and the missing spring clock hour may use a marked neighboring-hour estimate. At forecast issuance, Lasso can also use marked linear interpolation for bounded SQL gaps of up to 30 seconds per lag quarter-hour. Only lags with a nonzero fitted coefficient are required. Training targets, production profiles and actuals use measured coverage.

Clean the household load according to the actual meter boundary: subtract flexible loads only if they are included in the house meters. Weather forecasts and selected original room-temperature histories can be retained for 90 days; their configuration status is not proof of complete SQL delivery. Additional archived weather and room values are not yet Lasso inputs. See [comparison issue](https://github.com/fuchs-1978/ioBroker.ems-optimizer/issues/284), [comparison setup](docs/release-0.17.0-alpha.176.md), [combinations](docs/release-0.17.0-alpha.179.md) and the German guide.

## Requirements

- Node.js 22 or newer; CI covers Node.js 22, 24 and 26.
- ioBroker js-controller 6.0.11 or newer and Admin 7.8.23 or newer.
- Valid source mappings and independent device feedback for each enabled output.
- A compatible, separately commissioned external phase-control script for physical wallbox phase switching.

## Installation and setup

In ioBroker Admin, open **Adapters → Install from custom source → GitHub** and enter `https://github.com/fuchs-1978/ioBroker.ems-optimizer`. Select the commit of the tested build you want to reproduce. After updating, compare `System.Version` with the installed version. Restart the EMS instance if it still reports the previous version. [CI runs for `main`](https://github.com/fuchs-1978/ioBroker.ems-optimizer/actions/workflows/test-and-release.yml?query=branch%3Amain)

1. Map grid and generation measurements in the Admin configuration.
2. Configure only the devices present at your installation, including their feedback, current limits and temperature or state-of-charge sources.
3. Configure history, forecasts and prices if required for planning. Review the generated plan and diagnostic states.
4. Before enabling real outputs, stop competing actuator scripts and verify the master and device releases under supervision.

There must be one responsible controller per actuator register. Measurement, protection, state-of-charge and required external phase/pump scripts may still be needed. When returning control to another controller, disable the external EMS phase follower as specified by its contract, withdraw the master release, verify OFF feedback and electrical standstill, then enable the replacement controller. `OutputOwned=false` alone is not a complete physical stop proof. Independent device protection remains necessary after a host failure.

The [German quick guide](README.de.md) explains operation; the [complete Admin reference](docs/admin-reference.de.md) retains every configuration tab, default value, device mapping and troubleshooting detail. Defaults are not recommendations for every installation; existing configuration may differ.

## Configuration

Open the instance settings in ioBroker Admin. Source fields require full existing state IDs, not display names or measured values. Use only the tabs needed for the devices installed at your site.

| Area | What to configure |
| --- | --- |
| General and grid connection | Master/device releases, grid measurements, connection and phase limits, and any configured grid-operator restrictions. |
| Measurements | PV generation and house consumption, with consistent signs, units and source timestamps. |
| History and forecasts | History source, load-profile period, PV/weather inputs and holiday calendar. The default house-load profile uses the median by weekday and quarter-hour; recent weighting is optional. |
| Prices and tariffs | Applicable energy prices and time-dependent grid charges, if price-based planning is used. |
| Wallboxes | Each charger's command and feedback mapping, vehicle SoC, minimum/target SoC, priority and electrical limits. Phase switching additionally requires the external phase follower. |
| Hot water and heating buffer | Available temperatures, permitted power, output mapping and explicit releases. EHZ means the electric heater. |
| Battery | Actual device mappings, SoC and power limits, ownership, feedback and optional PV coordination. |
| Heat pump | Telemetry and passive recommendations; no heat-pump actuator commands. |

Start with outputs disabled, check source validity and the plan, then commission each intended output separately. Missing devices should be disabled, not represented by artificial zero measurements. Detailed field descriptions, defaults and troubleshooting are in the [Admin reference](docs/admin-reference.de.md).

## Integrations

EMS Optimizer combines ioBroker states supplied by other adapters or scripts. A manufacturer link describes the equipment; it does not establish compatibility with every model or firmware.

- [go-e chargers](https://go-e.com/): mapped charger commands and independent feedback; physical phase switching follows the external script contract.
- [SMA](https://www.sma.de/): mapped generation and grid measurements, including the configured protection sources.
- [my-PV](https://www.my-pv.com/): mapped electric-heater power commands and feedback where supported by the configured device interface.
- SunEnergy battery heads: see the [battery configuration and device-profile requirements](docs/admin-reference.de.md#admin-batteriespeicher) and [strategy limits](docs/release-0.17.0-alpha.165.md).
- [STIEBEL ELTRON](https://www.stiebel-eltron.com/): heat-pump telemetry supplied through the configured ioBroker interface; passive recommendations only.

## Diagnostics

| State group | Purpose |
| --- | --- |
| `Diagnostics.*` | Compact overview, current notices and devices; collapsable planning, daily balances and technical details in Admin. All displays are read-only. |
| `System.Version` | Running adapter version; compare with installation and startup logs. |
| `Plan.*`, `Forecast.*`, `Chart.*` | Planned or predicted values, rather than proof of actuator response. |
| `Control.*` | Current budgets, allocation, phase decisions and control validity. |
| `Devices.*` | Device feedback, output ownership, command response and fault diagnostics. |
| `Debug.DailySummary_JSON` | Compact passive energy and coverage estimates with bounded investigation episodes. |
| `Debug.Shadow.DecisionRecord` | Recorded original samples and decision context for targeted historical analysis. |
| `Debug.Shadow.RecordDeliveryStatus` | Recorder backlog, separate writer/reader timing and independent persistence evidence. |
| `Debug.Shadow.RecordWriterStatus`, `RecordReaderStatus` | Independent publication and SQL-read diagnostics; excluded from automatic SQL history. |
| `Debug.Shadow.RecordSQLRecoveryStatus` | Qualified recovery of an unresolved SQL request; an EMS restart alone does not prove completion. |
| `Forecast.LoadComparison.*` | Passive day-ahead comparison, model, immutable issued forecasts and paired actual evaluation. |
| `Debug.WeatherArchive.*`, `Debug.RoomHistory.*` | Weather collection and retention of configured original room histories. |

State names above are relative to the instance, for example `ems-optimizer.0.System.Version`. Transition status `superseded` means a new command replaced an incompletely observed response; pending evidence can complete within its original deadline. Neither status alone proves a device fault. External history coverage remains unverified until an actual report input exists ([#158](https://github.com/fuchs-1978/ioBroker.ems-optimizer/issues/158)).

A current state does not prove historical coverage. Missing, stale, invalid or unacknowledged measurements remain unknown. A successful state write or history-cache response does not prove database persistence. The recorder uses bounded database-only SELECT queries for its independent persistence check; see the [recorder access contract](docs/issue123-recorder-access.md).

Since alpha.188, a stalled verification read cannot pause bounded new publications. Writer failures and observed SQL resource errors retain their own retry brake. Unconfirmed originals no longer expire after 24 hours; exact SQL proof is required for normal cleanup. Finite capacity still rejects new records visibly when full. Writer completion means handoff to the ioBroker state database, not an SQL commit. See [writer/reader diagnosis](docs/release-0.17.0-alpha.188.md).

For an existing orphan SQL request, follow the [alpha.186 recovery instructions](docs/release-0.17.0-alpha.186.md). A SQL-adapter restart can provide process-generation evidence, but successful read-only checks and exact original matches are still required. No automatic SQL restart, forced fence clearing or silent deletion of unconfirmed originals is performed.

## Development

```sh
npm install
npm test
npm run test:package
npm run test:artifact
npm run test:equivalence
```

Admin translation catalogs are stored in `admin/i18n/<language>/translations.json`. Keep their keys aligned with the English catalog and all visible Admin text. Release notices in the package are translated into all eleven languages. [Translation coverage and checks](docs/translations.md) · [Checker follow-up #316](https://github.com/fuchs-1978/ioBroker.ems-optimizer/issues/316)

## Changelog

### 0.17.0-alpha.266 (2026-11-14)

- Pause optional vehicle charging at the scheduled handover if the battery can absorb PV and the remaining measured surplus cannot sustain the wallbox minimum. [Release notes](docs/release-0.17.0-alpha.266.md)

### 0.17.0-alpha.265 (2026-11-14)

- Apply the existing go-e zero-power tolerance to the shared consumption and phase budgets so a small signed reading during startup keeps the charging allocation valid. [Release notes](docs/release-0.17.0-alpha.265.md)

### 0.17.0-alpha.264 (2026-11-14)

- Reduce the current of a running single-phase wallbox after a measured 1 A PV step rolls back, when fresh go-e feedback and electrical measurements agree. [Release notes](docs/release-0.17.0-alpha.264.md)

### 0.17.0-alpha.263 (2026-11-14)

- Let SunEnergy reduce grid import while an active solar wallbox reduces current or its stop delay runs, down to a 70% battery reserve. [Release notes](docs/release-0.17.0-alpha.263.md)

### 0.17.0-alpha.262 (2026-11-14)

- Pause PV battery charging at the measured SoC target and make surplus available to the wallboxes until a higher target is due. [Release notes](docs/release-0.17.0-alpha.262.md)

### 0.17.0-alpha.261 (2026-11-14)

- Apply battery SoC targets and wallbox handoff to the 48-hour plan. Configure monthly PV forecast factors per area. [Release notes](docs/release-0.17.0-alpha.261.md)

### 0.17.0-alpha.260 (2026-11-14)

- Reuse measured SunEnergy charging and grid power to qualify a wallbox start. Give battery and EV charging priority over optional PV heating. [Release notes](docs/release-0.17.0-alpha.260.md)

### 0.17.0-alpha.259 (2026-11-14)

- Suppress verified SunEnergy discharge trims within the grid deadband, and follow measured AC power at a single head's discharge ceiling. Share PV with a wallbox sooner under the SoC-based priority rule. [Release notes](docs/release-0.17.0-alpha.259.md)

### 0.17.0-alpha.258 (2026-11-14)

- Record SunEnergy setpoint echo and measured AC response delays per head, with original device and ioBroker timestamps. [Release notes](docs/release-0.17.0-alpha.258.md)

### 0.17.0-alpha.257 (2026-11-13)

- Resume SunEnergy regulation after an attributable delayed response and confirmed AC standstill. Renew an ineffective small charge in single-head PV observation mode when measured surplus rises. [Release notes](docs/release-0.17.0-alpha.257.md)

### 0.17.0-alpha.256 (2026-11-13)

- Handle staggered SunEnergy household discharge feedback and recalculate corrections superseded before dispatch. [Release notes](docs/release-0.17.0-alpha.256.md)

### 0.17.0-alpha.255 (2026-11-13)

- Reduce acknowledged SunEnergy household discharge through brief export when measured demand still supports a lower output. [Release notes](docs/release-0.17.0-alpha.255.md)

### 0.17.0-alpha.254 (2026-11-13)

- Hold acknowledged SunEnergy discharge at its ceiling when AC power falls slightly short. [Release notes](docs/release-0.17.0-alpha.254.md)

### 0.17.0-alpha.253 (2026-11-13)

- Restore the SunEnergy reserve at up to 1,000 W when SoC drops below the effective minimum. [Release notes](docs/release-0.17.0-alpha.253.md)

### 0.17.0-alpha.252 (2026-11-13)

- Optionally use CHP surplus and a battery SoC band to charge the Mii at night. [Release notes](docs/release-0.17.0-alpha.252.md)

### 0.17.0-alpha.251 (2026-11-13)

- Resume a SunEnergy direction change after a driver-confirmed zero command and measured AC rundown to standstill. [Release notes](docs/release-0.17.0-alpha.251.md)

### 0.17.0-alpha.250 (2026-11-13)

- Reduce an acknowledged SunEnergy household discharge while AC power is still settling. [Release notes](docs/release-0.17.0-alpha.250.md)

### 0.17.0-alpha.249 (2026-11-13)

- Reduce an acknowledged SunEnergy discharge while buffering a wallbox, even while AC power is still settling. [Release notes](docs/release-0.17.0-alpha.249.md)

### 0.17.0-alpha.248 (2026-11-13)

- Release stale SunEnergy commands automatically after a successful zero write and sustained fresh zero feedback. [Release notes](docs/release-0.17.0-alpha.248.md)

### 0.17.0-alpha.247 (2026-11-13)

- Let SunEnergy bridge a PV shortfall during an active wallbox stop delay while the timer continues to use the PV-only budget. [Release notes](docs/release-0.17.0-alpha.247.md)

### 0.17.0-alpha.246 (2026-11-13)

- Preserve confirmed SunEnergy charging or discharging during a routine restart when the current configuration and device feedback allow takeover. [Release notes](docs/release-0.17.0-alpha.246.md)

### 0.17.0-alpha.245 (2026-11-13)

- Give an outstanding SunEnergy discharge time to confirm before applying a reduced target or stopping during a restart. [Release notes](docs/release-0.17.0-alpha.245.md)

### 0.17.0-alpha.244 (2026-11-13)

- Automatically return a stopped SunEnergy discharge when the device echoes the previous command and subsequently confirms zero. [Release notes](docs/release-0.17.0-alpha.244.md)

### 0.17.0-alpha.243 (2026-11-13)

- Correct the SunEnergy charge against the measured grid error after confirmed feedback in observation mode. [Release notes](docs/release-0.17.0-alpha.243.md)

### 0.17.0-alpha.242 (2026-11-13)

- Give pending SunEnergy feedback up to 2.5 seconds before issuing the stop during a normal restart. [Release notes](docs/release-0.17.0-alpha.242.md)

### 0.17.0-alpha.241 (2026-11-13)

- Hold the issued charging step while waiting for feedback and retain SunEnergy setpoint confirmation across restart. [Release notes](docs/release-0.17.0-alpha.241.md)

### 0.17.0-alpha.240 (2026-11-13)

- Automatically resume SunEnergy control after a verified zero response when the persisted output has no unresolved command. [Release notes](docs/release-0.17.0-alpha.240.md)

### 0.17.0-alpha.239 (2026-11-13)

- In SunEnergy observation mode, use the configured charging step above the learned limit when the previous command is confirmed and fresh grid export covers the increase. [Release notes](docs/release-0.17.0-alpha.239.md)

### 0.17.0-alpha.238 (2026-11-13)

- In SunEnergy observation mode, a drop in grid export is logged while an outstanding charging request is held. [Release notes](docs/release-0.17.0-alpha.238.md)

### 0.17.0-alpha.237 (2026-11-13)

- Add optional warning-only observation of pending SunEnergy PV charge feedback with verified export and protection limits. [Release notes](docs/release-0.17.0-alpha.237.md)

### 0.17.0-alpha.236 (2026-11-13)

- Allow a brief wait for the SunEnergy charge-start echo when PV surplus drops. [Release notes](docs/release-0.17.0-alpha.236.md)

### 0.17.0-alpha.235 (2026-11-13)

- Reduce single-head SunEnergy PV charging once the previous setpoint is echoed, even if measured power still lags. Ramp up from measured charging power and retain the prior reservation through confirmation. [Release notes](docs/release-0.17.0-alpha.235.md)

### 0.17.0-alpha.234 (2026-11-13)

- Preserve the learned SunEnergy charging ceiling when PV surplus temporarily falls, so a recovery can use the previously confirmed charging range. [Release notes](docs/release-0.17.0-alpha.234.md)

### 0.17.0-alpha.233 (2026-11-13)

- Release the SunEnergy reservation for a command canceled before dispatch after a fresh zero confirmation. [Release notes](docs/release-0.17.0-alpha.233.md)

### 0.17.0-alpha.232 (2026-11-13)

- For a single SunEnergy head with an echoed PV charging setpoint and stable lower measured power, reduce the setpoint and hold the previous power reservation until the reduction is confirmed. Probe again in steps of up to 50 W after 60 seconds when PV surplus allows. [Release notes](docs/release-0.17.0-alpha.232.md)

### 0.17.0-alpha.231 (2026-11-13)

- Allow a PV charge target drop of up to 200 W while a single SunEnergy head is already charging and its command is still being confirmed. The existing electrical limits and feedback deadline still apply. [Release notes](docs/release-0.17.0-alpha.231.md)

### 0.17.0-alpha.230 (2026-11-13)

- For a single SunEnergy head, wait for outstanding charging feedback when the PV target drops within the existing power tolerance and all limits still allow the previous request. [Release notes](docs/release-0.17.0-alpha.230.md)

### 0.17.0-alpha.229 (2026-11-13)

- Recover a blocked SunEnergy head by disabling only battery control and confirming that each head is stopped and the old command cannot execute. Other EMS outputs can remain enabled. [Release notes](docs/release-0.17.0-alpha.229.md)

### 0.17.0-alpha.228 (2026-11-12)

- Include a running wallbox's stop-delay draw in the shared budget when PV and electrical limits cover it alongside the other targets. Another vehicle can then use the available PV surplus during the delay. [Release notes](docs/release-0.17.0-alpha.228.md)

### 0.17.0-alpha.227 (2026-11-11)

- Apply the configured Mii/e-Up SoC current steps in parallel charging when grid capacity remains after the other vehicles' minimum currents. [Release notes](docs/release-0.17.0-alpha.227.md)

### 0.17.0-alpha.226 (2026-11-10)

- Log a minimum-SoC stop as information. Log confirmation after the wallbox acknowledges OFF and fresh measurements confirm that charging has stopped. Warn if either confirmation misses its deadline. [Release notes](docs/release-0.17.0-alpha.226.md)

### 0.17.0-alpha.225 (2026-11-09)

- Keep validated history available on successive restarts when the rolling SQL window drops the oldest part of an empty interval. [Release notes](docs/release-0.17.0-alpha.225.md)

### 0.17.0-alpha.224 (2026-11-09)

- Count metered energy toward the minimum SoC, replan explicit departure changes within the active plug session, and allocate shared price windows to earlier departures first unless a vehicle has explicit priority. [Release notes](docs/release-0.17.0-alpha.224.md)

### 0.17.0-alpha.223 (2026-11-09)

- Spread forecast hot-water heating across an equal-price block before a tariff increase when no later supply window is visible. The forecast still checks the tank reserve, available capacity and heater power. [Release notes](docs/release-0.17.0-alpha.223.md)

### 0.17.0-alpha.222 (2026-11-09)

- Optional vehicle readiness planning keeps an immediate mobility reserve and schedules the minimum SoC by departure using total energy prices. Disabled by default for every vehicle. [Release notes](docs/release-0.17.0-alpha.222.md)

### 0.17.0-alpha.221 (2026-11-09)

- Remember a manual vehicle SoC correction entered while unplugged for the next connection within 30 minutes. The value applies to the first charging decision. Energy tracking begins with the new session's first fresh meter reading. [Release notes](docs/release-0.17.0-alpha.221.md)

### 0.17.0-alpha.220 (2026-11-09)

- Optional battery coordination uses the live SoC and the battery target in the current plan. Above the target, the battery can support half of the running wallbox's next current step, with separate limits for single- and three-phase charging. In the battery-first band, surplus above the battery charge ceiling can start the preferred wallbox at its minimum, while retaining at least half of that ceiling for storage. The battery then gets priority up to its full charge power before the wallbox increases its current.

### 0.17.0-alpha.219 (2026-11-08)

- Compare recorder source settings directly and reuse mapped IDs for unindexed source lookup. Changed device IDs, meter units and command observations are picked up on the next notification. [Verification and live measurements](docs/release-0.17.0-alpha.219.md)

### 0.17.0-alpha.218 (2026-11-08)

- Reuse recorder data point mappings and pick up configuration changes on the next notification.

### 0.17.0-alpha.217 (2026-11-08)

- Apply indexed recorder sampling rules directly and retain the fallback for unindexed notifications.

### 0.17.0-alpha.215 (2026-11-08)

- Build full recorder snapshots only for recorded frames. Command and protection events and raw observations keep their existing capture rules.

### 0.17.0-alpha.214 (2026-11-08)

- Reuse measured UTF-8 sample sizes in routine and pre-event recorder batches. Samples, batch limits and electrical control logic are unchanged.

### 0.17.0-alpha.213 (2026-11-08)

- Restore validated SQL quarter-hours after a restart, avoid unchanged wallbox display writes, and reuse decoded schedules. [Release notes](docs/release-0.17.0-alpha.213.md).

### 0.17.0-alpha.212 (2026-11-08)

- Add independent emergency grid heating for both heating rods. [Release notes](docs/release-0.17.0-alpha.212.md).

### 0.17.0-alpha.211 (2026-11-08)

- When the manually preferred vehicle is unplugged, rank replacement vehicles by the gap to their target charge level and keep the active choice until charging stops. [Release notes](docs/release-0.17.0-alpha.211.md).

### 0.17.0-alpha.210 (2026-11-08)

- Publish numeric timestamps for eCharts forecast and schedule updates. [Release notes](docs/release-0.17.0-alpha.210.md).

### 0.17.0-alpha.209 (2026-11-07)

- Freeze a separate Lasso forecast when a single missing quarter-hour can be interpolated between its neighbors. [Scoring and limits](docs/release-0.17.0-alpha.209.md).

### 0.17.0-alpha.208 (2026-11-07)

- Prefer valid Open-Meteo quarter-hour weather and PV values for the first four hours of the plan. Archive the available quarter-hour weather series alongside the hourly series. [Sources and coverage](docs/release-0.17.0-alpha.208.md).

### 0.17.0-alpha.207 (2026-11-06)

- Spread the combined forecast hot-water reserve for the next PV supply and the dearer tariff block when the modeled reserve, heater power and storage limits permit. [Scope and model assumptions](docs/release-0.17.0-alpha.207.md).

### 0.17.0-alpha.206 (2026-11-05)

- Spread forecast hot-water heating within the equal-price night block before a tariff rise when the thermal reserve and heater limits permit. [Scope and model assumptions](docs/release-0.17.0-alpha.206.md).

### 0.17.0-alpha.205 (2026-11-05)

- Take back control once after a physically confirmed one-amp rollback in an active single-phase charge, subject to the current budget and fresh acknowledgements. [Policy and limits](docs/release-0.17.0-alpha.205.md).

### 0.17.0-alpha.204 (2026-11-05)

- Accept one early lower arrival report after an observed unplug when the current estimate still starts from the pre-trip value. Continue counting at the first aligned charge-counter sample. [Policy and limits](docs/release-0.17.0-alpha.204.md).

### 0.17.0-alpha.203 (2026-11-05)

- Spread necessary hot-water heating at constant power across a contiguous equal-price window ahead of a cheaper tariff. The forecast retains the minimum reserve, heater and storage limits, and priority for acute demand.
- Resume vehicle SoC estimation from the latest app value and new measured charge after reconnect. Flag app reports that disagree with the estimate when their measurement time is unknown.

### 0.17.0-alpha.202 (2026-11-04)

- (fuchs-1978) Build the required hot-water reserve before a dearer price block using the latest feasible cheaper slots. Account for bounded future PV, heater power, storage capacity and partial slots; preserve live permissions. [Method and limits](docs/release-0.17.0-alpha.202.md).

### 0.17.0-alpha.201 (2026-11-04)

- (fuchs-1978) Share usable mandatory hot-water power with a confirmed preferred 1P minimum; enforce explicit current reduction. Retain a bounded thermal-pause qualification for the same charge with 15 seconds of fresh budget evidence and all physical safety gates. [Policy and limits](docs/release-0.17.0-alpha.201.md).

### 0.17.0-alpha.200 (2026-11-04)

- (fuchs-1978) Build quarter-hour power histories from time-weighted raw values instead of sample-count means. Keep missing/invalid intervals unknown, bound dense SQL queries, and preserve issued forecasts while correcting training and actual evaluation. [Method and limits](docs/release-0.17.0-alpha.200.md).

### 0.17.0-alpha.199 (2026-11-04)

- (fuchs-1978) Let the optional EHZ use the reserved countdown budget of additional waiting vehicles. Preserve physical heater reservations until measured reduction permits starting. Keep a running mandatory 3P charge when its electrical minimum is funded; apply the configured reserve only to stopped starts. [Details and limits](docs/release-0.17.0-alpha.199.md).

### 0.17.0-alpha.196 (2026-11-03)

- (fuchs-1978) Attribute passive current-response diagnostics to the sent target instead of the previous ACK; distinguish superseded commands from pending evidence. Keep charging control and timing unchanged. [Details and limits](docs/release-0.17.0-alpha.196.md).

### 0.17.0-alpha.195 (2026-11-03)

- (fuchs-1978) Redistribute PV budget during sustained vehicle uptake limits using a confirmed lower current command, while retaining nominal reservations until ACK. Preserve measured SoC progress against delayed lower cloud reports and observed charge/Finish transitions. [Details and limits](docs/release-0.17.0-alpha.195.md).

[Earlier releases](CHANGELOG_OLD.md) and their linked release notes contain the historical changes and commissioning limits.

## Support

Report bugs and feature requests through [GitHub Issues](https://github.com/fuchs-1978/ioBroker.ems-optimizer/issues). See [SUPPORT.md](SUPPORT.md) for bounded diagnostic reporting and contact details.

## License

MIT License. Copyright (c) 2026 Carsten Reineke. See [LICENSE](LICENSE) for the full license text.
