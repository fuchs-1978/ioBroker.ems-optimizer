![EMS Optimizer logo](admin/ems-optimizer.png)

# EMS Optimizer

[![Test and Release](https://github.com/fuchs-1978/ioBroker.ems-optimizer/actions/workflows/test-and-release.yml/badge.svg?branch=main)](https://github.com/fuchs-1978/ioBroker.ems-optimizer/actions/workflows/test-and-release.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

Forecast-based energy management for [ioBroker](https://www.iobroker.net/). Combines PV and grid measurements, load history, weather forecasts and electricity prices in a rolling 48-hour plan.

**Current GitHub build 0.17.0-alpha.279.** Install the tested build from GitHub and commission each enabled device against its actual feedback and protection limits.

[Deutsche Bedienungsanleitung](README.de.md) · [Release history](CHANGELOG_OLD.md) · [Issues](https://github.com/fuchs-1978/ioBroker.ems-optimizer/issues)

## Contents

- [Features](#features)
- [Current scope](#current-scope)
- [Live distribution and plan recovery](#live-distribution-and-plan-recovery)
- [Battery live regulation](#battery-live-regulation)
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

`Diagnostics.BatteryStrategy` previews the storage reserve, intermediate SoC target and combined overnight demand. The optional PV coordination uses the battery target in the current plan to share surplus and buffer wallbox current steps. [Strategy preview](docs/release-0.17.0-alpha.165.md) · [Battery and wallbox configuration](docs/admin-reference.de.md#speicher-feinregelung-und-eingangsprüfung)

## Current scope

| Available | Remaining work |
| --- | --- |
| Wallbox allocation, qualified handoff, measured SoC estimation and bounded current recovery | Live evidence for SoC after a trip, Mii taper transfer, one-amp recovery and phase/protection cases. [Vehicle operation #7](https://github.com/fuchs-1978/ioBroker.ems-optimizer/issues/7) · [Phase switching #8](https://github.com/fuchs-1978/ioBroker.ems-optimizer/issues/8) · [go-e feedback #216](https://github.com/fuchs-1978/ioBroker.ems-optimizer/issues/216) |
| Optional minimum-SoC planning with an immediate mobility reserve | Verify reserve charging, tariff selection and fallback on site. [Integration and commissioning #25](https://github.com/fuchs-1978/ioBroker.ems-optimizer/issues/25) |
| Four passive day-ahead load candidates, common-slot 7/14-day evaluation and weather/room-history retention | Longer validation against time-weighted actuals and confirmation of archive delivery. [Forecast comparison #284](https://github.com/fuchs-1978/ioBroker.ems-optimizer/issues/284) |
| Bounded recorder, exact SQL confirmation and qualified recovery | The SQL investigation documented a table-lock incident and recorder catch-up. External history coverage and the table-copy comparison are tracked separately. [SQL investigation #60](https://github.com/fuchs-1978/ioBroker.ems-optimizer/issues/60) · [External coverage #158](https://github.com/fuchs-1978/ioBroker.ems-optimizer/issues/158) · [Table-copy test #378](https://github.com/fuchs-1978/ioBroker.ems-optimizer/issues/378) |
| Battery live control, optional PV coordination and battery strategy preview | Complete storage reserve and overnight planning and verify the battery's live response. [Battery #25](https://github.com/fuchs-1978/ioBroker.ems-optimizer/issues/25) · [Small-power stops #410](https://github.com/fuchs-1978/ioBroker.ems-optimizer/issues/410) · [Step response #423](https://github.com/fuchs-1978/ioBroker.ems-optimizer/issues/423) |

The [issue review for Alpha.275](docs/issue-audit/2026-11-15/README.md) records the status of the open tasks and the dated reports. [Roadmap #36](https://github.com/fuchs-1978/ioBroker.ems-optimizer/issues/36) assigns the operational checks and integrations. Admin and runtime acceptance is tracked in [#26](https://github.com/fuchs-1978/ioBroker.ems-optimizer/issues/26), repository checker follow-up in [#316](https://github.com/fuchs-1978/ioBroker.ems-optimizer/issues/316). Earlier evidence is in the [November 3 issue review](docs/issue-audit/2026-11-03/README.md).

## Live distribution and plan recovery

A missing, incomplete or stale plan no longer blocks allocation from valid current measurements. `Control.PlanFallbackActive` and `Control.PlanFallbackStatus` identify this mode; `Plan.Valid` remains unchanged. Vehicle priorities, minimum-SoC/manual rules, EHZ thermal release, confirmed handoff and electrical limits still apply. Forecast-based price charging, cheap-grid heating and scheduled PV boost are disabled until the real plan returns. Empty historic days are provisional and re-read with paced retries. [Recovery and limits](docs/release-0.17.0-alpha.198.md).

A restart can use validated cached SQL quarter-hours while SQL refreshes them in the background. Check `History.Building` for the refresh and `Plan.Valid` for the usable plan. [History cache and startup behavior](docs/release-0.17.0-alpha.213.md)

An enabled optional heater may temporarily use the start budget of a waiting vehicle, including a lower-priority follower. The heater must release the required power before the car starts. This works with the fixed wallbox/heater split switched off. An ongoing mandatory 3P charge uses its running minimum. The startup reserve applies to a stopped charger. [Countdown buffer policy](docs/release-0.17.0-alpha.199.md)

## Battery live regulation

When the optional battery and wallbox coordination finishes a scheduled SoC stage, the EMS releases its reserved PV power. The battery's live controller can still absorb residual PV or CHP export within the available SoC, power and allocation limits.

The configured battery deadband applies to the new charge request. With a 10 W deadband, a 1 W import trims an active 11 W charge to 10 W. An eligible single SunEnergy head accepts a smaller charge request while feedback is pending. It can change direction directly when fresh grid measurements support the opposite demand after accounting for the previous power. [Setpoints, signs and diagnostics](docs/admin-reference.de.md#live-regelung-des-speichers)

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

### 0.17.0-alpha.279 (2026-11-15)

- After two minutes of measured near-limit charging at a single SunEnergy head, use real PV export to qualify a wallbox start and let the battery absorb the remaining surplus. [Release notes](docs/release-0.17.0-alpha.279.md)

### 0.17.0-alpha.278 (2026-11-15)

- Continue sending valid single-head setpoints during pending feedback. Ten consecutive independent head readings without a matching response trigger a stop. [Release notes](docs/release-0.17.0-alpha.278.md)

### 0.17.0-alpha.277 (2026-11-15)

- A fresh SunEnergy echo of a direct direction change ends the short switching wait once AC power has left the old direction. Normal AC feedback handling takes over. [Release notes](docs/release-0.17.0-alpha.277.md)

### 0.17.0-alpha.276 (2026-11-15)

- Reduce single-head SunEnergy charging without waiting for the previous setpoint echo and switch directly in either direction when the meter supports the opposite demand. [Release notes](docs/release-0.17.0-alpha.276.md)

### 0.17.0-alpha.275 (2026-11-15)

- A single battery head switches directly from charging to household discharge when the meter shows enough residual import. [Release notes](docs/release-0.17.0-alpha.275.md)

### 0.17.0-alpha.274 (2026-11-15)

- Subtract small grid imports from the active battery charge setpoint. A result at the configured minimum still charges. [Release notes](docs/release-0.17.0-alpha.274.md)

### 0.17.0-alpha.273 (2026-11-14)

- Keep live battery control active for leftover grid export after a scheduled charge stage is complete. A charge request at the configured deadband is eligible. [Release notes](docs/release-0.17.0-alpha.273.md)

[Earlier releases](CHANGELOG_OLD.md) and their linked release notes contain the historical changes and commissioning limits.

## Support

Report bugs and feature requests through [GitHub Issues](https://github.com/fuchs-1978/ioBroker.ems-optimizer/issues). See [SUPPORT.md](SUPPORT.md) for bounded diagnostic reporting and contact details.

## License

MIT License. Copyright (c) 2026 Carsten Reineke. See [LICENSE](LICENSE) for the full license text.
