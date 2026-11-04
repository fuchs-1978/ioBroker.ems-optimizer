![EMS Optimizer logo](admin/ems-optimizer.png)

# EMS Optimizer

[![Test and Release](https://github.com/fuchs-1978/ioBroker.ems-optimizer/actions/workflows/test-and-release.yml/badge.svg?branch=main)](https://github.com/fuchs-1978/ioBroker.ems-optimizer/actions/workflows/test-and-release.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

Forecast-based energy management for [ioBroker](https://www.iobroker.net/). Combines PV and grid measurements, load history, weather forecasts and electricity prices in a rolling 48-hour plan.

**Current version: 0.17.0-alpha.199.** This adapter is in alpha testing. Passing software tests does not establish complete commissioning of a physical installation.

[Deutsche Bedienungsanleitung](README.de.md) · [Release history](CHANGELOG_OLD.md) · [Issues](https://github.com/fuchs-1978/ioBroker.ems-optimizer/issues)

## Contents

- [Features](#features)
- [Current scope](#current-scope)
- [Vehicle SoC and handoff](#vehicle-soc-and-handoff)
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
- Allocate available PV power between charging and a domestic-hot-water heater, respecting grid, phase and device limits.
- Plan optional battery charging using forecasts, electricity prices and time-dependent grid charges.
- Provide separate heating-buffer and battery outputs when explicitly configured and enabled.
- Observe heat-pump telemetry and publish passive recommendations. Heat-pump, SG-Ready and KNX actuator commands are not implemented.
- Compare day-ahead Median, Lasso and two fixed combinations without changing production planning.
- Preserve selected existing room-temperature histories and archive available weather forecasts for later analysis.
- Record bounded diagnostic episodes and daily summaries for targeted investigation instead of full-day SQL downloads.

The staged battery/vehicle strategy is **a read-only preview**, not a production control policy. `Diagnostics.BatteryStrategy` does not authorize battery-to-vehicle discharge or change vehicle night-charging targets. See the [release notes](docs/release-0.17.0-alpha.165.md) and [remaining battery integration work](https://github.com/fuchs-1978/ioBroker.ems-optimizer/issues/25).

## Current scope

| Available | Remaining work |
| --- | --- |
| Wallbox allocation, qualified handoff, heater coordination and SoC session handling | Real Mii taper-budget transfer, fast current changes and remaining device/protection cases: [#7](https://github.com/fuchs-1978/ioBroker.ems-optimizer/issues/7), [#8](https://github.com/fuchs-1978/ioBroker.ems-optimizer/issues/8). Current-feedback provenance: [#216](https://github.com/fuchs-1978/ioBroker.ems-optimizer/issues/216). |
| Four passive day-ahead load candidates and common-slot 7/14-day evaluation; weather/room-history retention | Two complete comparison days are documented; longer validation and actual archive delivery remain [#284](https://github.com/fuchs-1978/ioBroker.ems-optimizer/issues/284). Additional room/wind/heat features are not in Lasso. |
| Bounded recorder, exact SQL confirmation and qualified recovery | Long SQL transport delays and historical recording gaps remain under [recorder investigation](https://github.com/fuchs-1978/ioBroker.ems-optimizer/issues/60). A healthy current queue does not repair past losses. |
| Battery strategy preview and heat-pump telemetry | Productive [battery strategy](https://github.com/fuchs-1978/ioBroker.ems-optimizer/issues/25), [heat planning](https://github.com/fuchs-1978/ioBroker.ems-optimizer/issues/160) and [LPC group-net integration](https://github.com/fuchs-1978/ioBroker.ems-optimizer/issues/166) remain separate work. |

The [current roadmap](https://github.com/fuchs-1978/ioBroker.ems-optimizer/issues/36) assigns each remaining task. Implemented transition/reaction features are closed as software work; their natural operating checks remain in #7. General Admin/runtime acceptance stays in [#26](https://github.com/fuchs-1978/ioBroker.ems-optimizer/issues/26), the current checker report in [#316](https://github.com/fuchs-1978/ioBroker.ems-optimizer/issues/316). [Archived issue evidence](docs/issue-audit/2026-11-03/README.md) preserves previous reports and requirements.

## Live distribution and plan recovery

A missing, incomplete or stale plan no longer blocks allocation from valid current measurements. `Control.PlanFallbackActive` and `Control.PlanFallbackStatus` identify this mode; `Plan.Valid` remains unchanged. Vehicle priorities, minimum-SoC/manual rules, EHZ thermal release, confirmed handoff and electrical limits still apply. Forecast-based price charging, cheap-grid heating and scheduled PV boost are disabled until the real plan returns. Empty historic days are provisional and re-read with paced retries. [Recovery and limits](docs/release-0.17.0-alpha.198.md).

An enabled optional EHZ may temporarily use the start budget of a waiting vehicle, including a lower-priority follower. Vehicle priority and the full start delay remain; the heater must physically release the required power before the car starts. Disabling the fixed WB/EHZ split does not disable residual heating. [Countdown buffer policy](docs/release-0.17.0-alpha.199.md).

## Vehicle SoC and handoff

Confirmed unplug ends the calculated SoC session and clears the manual correction. The valid cloud/vehicle value then remains authoritative across reconnects and restarts until a new manual value is supplied. An old republished 100% must not hold a later correct 84% after a trip. In this mode `SocEstimateStatus` is `cloud-after-unplug` and `EstimatedSoC_pct` is null. A new `Vehicles.WallboxN.SoCCorrection_pct` value establishes a fresh energy anchor; only later measured charge is added. The foreign source is never overwritten. [Current SoC contract](README.de.md#fahrzeug-soc-und-sitzungswechsel).

A qualified charger-Finish observation can end charging and hand off after independent OFF/electrical-quiet proof; it does not set SoC to 100%. Sustained limited vehicle uptake can release budget for another vehicle through a confirmed lower command and the existing reserve/start checks. Real Mii taper transfer remains a separate acceptance case from the successful EQV-unplug/EQE handoff. [Finish](docs/release-0.17.0-alpha.194.md) · [Taper budget](docs/release-0.17.0-alpha.195.md).

## Forecast comparison

Enable the optional comparison in **History & forecast**. Production keeps its selected load profile. The four candidates are:

| Candidate | Calculation |
| --- | --- |
| Median | Typical quarter-hour load by weekday/holiday. |
| Lasso | Regularized model using cleaned load 2/7 calendar days earlier, time of day, weekday/holiday and optionally outside temperature/heating degree. |
| 50/50 blend | Arithmetic mean of the two predictions in each quarter-hour. |
| Lasso energy / Median shape | Scale the whole Median curve by Lasso daily energy divided by Median daily energy. This is a day-ahead scaling, not an adjustment to later actual consumption. |

Training runs on startup and with the daily history build at 00:10, using at most 84 days. Issued forecasts survive restart unchanged. `Forecast.LoadComparison.*` contains the model, forecast ledger and evaluation. Compare actuals and predictions over identical measured quarter-hours; a partial-day report must show its cutoff and slot coverage. The evaluation also reports the last 7/14 completed local calendar days: all four models share the same measured slot intersection, MAE/RMSE pool the individual errors, and energy comparisons use only identical complete days. Coverage, provisional windows and excluded DST days remain explicit. SQL interval-average energy is an estimate, not a billing-meter difference. A complete regular day requires 96 paired slots; 92/100-slot DST target days are currently excluded. For calendar lags, both measured repeated-hour occurrences are averaged; only the missing spring clock hour may use the marked neighboring-hour estimate. Ordinary measured gaps stay unknown.

Clean the household load according to the actual meter boundary: subtract flexible loads only if they are included in the house meters. Weather forecasts and selected original room-temperature histories can be retained for 90 days; their configuration status is not proof of complete SQL delivery. Additional archived weather and room values are not yet Lasso inputs. See [comparison issue](https://github.com/fuchs-1978/ioBroker.ems-optimizer/issues/284), [comparison setup](docs/release-0.17.0-alpha.176.md), [combinations](docs/release-0.17.0-alpha.179.md) and the German guide.

## Requirements

- Node.js 22 or newer; CI covers Node.js 22, 24 and 26.
- ioBroker js-controller 6.0.11 or newer and Admin 7.8.23 or newer.
- Valid source mappings and independent device feedback for each enabled output.
- A compatible, separately commissioned external phase-control script for physical wallbox phase switching.

## Installation and setup

The adapter is currently distributed for alpha testing through GitHub; npm and ioBroker beta/latest or stable publication are deferred. In ioBroker Admin, use **Adapters → Install from custom source → GitHub** and enter `https://github.com/fuchs-1978/ioBroker.ems-optimizer`. The exact labels depend on the Admin version. A moving `main` branch can include changes newer than a tagged release. Select **GitHub**, not npm, for this alpha source. After updating, verify `System.Version` against the installed version; restart the EMS instance if the old process is still running. Review the release notes before updating. Installation alone does not enable or commission real outputs.

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
| Battery | Actual device mappings, SoC and power limits, ownership and feedback. The new strategy preview remains separate from production control. |
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

Admin translation catalogs are stored in `admin/i18n/<language>/translations.json`. Keep their keys aligned with the English catalog and all visible Admin texts. Admin catalog coverage and release-message translation are separate: current news entries have eleven language keys but nine locales still use English fallback. That remaining work is tracked in [#316](https://github.com/fuchs-1978/ioBroker.ems-optimizer/issues/316). See [translation coverage and checks](docs/translations.md).

## Changelog

### 0.17.0-alpha.199 (2026-11-04)

- (fuchs-1978) Let the optional EHZ use the reserved countdown budget of additional waiting vehicles. Preserve physical heater reservations until measured reduction permits starting, along with priorities, phase-change safeguards and price provenance. [Details and limits](docs/release-0.17.0-alpha.199.md).

### 0.17.0-alpha.198 (2026-11-04)

- (fuchs-1978) Continue measured live vehicle/heater distribution when the plan is missing or stale, retaining all source and electrical protections. Re-read provisional empty history days and retry incomplete profiles after SQL recovery. Forecast-based price permissions remain disabled in fallback. [Details and limits](docs/release-0.17.0-alpha.198.md).

### 0.17.0-alpha.197 (2026-11-03)

- (fuchs-1978) Discard calculated SoC and manual correction on confirmed unplug; retain cloud authority across reconnects and restarts until a new manual basis is supplied. Recover old blocked-session ledgers without retaining a stale full-charge estimate. [Details and limits](docs/release-0.17.0-alpha.197.md).

### 0.17.0-alpha.196 (2026-11-03)

- (fuchs-1978) Attribute passive current-response diagnostics to the sent target instead of the previous ACK; distinguish superseded commands from pending evidence. Keep charging control and timing unchanged. [Details and limits](docs/release-0.17.0-alpha.196.md).

### 0.17.0-alpha.195 (2026-11-03)

- (fuchs-1978) Redistribute PV budget during sustained vehicle uptake limits using a confirmed lower current command, while retaining nominal reservations until ACK. Preserve measured SoC progress against delayed lower cloud reports and observed charge/Finish transitions. [Details and limits](docs/release-0.17.0-alpha.195.md).

### 0.17.0-alpha.194 (2026-11-03)

- (fuchs-1978) Recognize charger Finish after ten seconds of confirmed electrical quiet, yield to the next vehicle after confirmed OFF, and show a possible-full-charge warning without changing SoC. Keep witnessed handoff and all electrical and budget guards. [Details and limits](docs/release-0.17.0-alpha.194.md).

### 0.17.0-alpha.193 (2026-11-03)

- (fuchs-1978) Allow one bounded measured PV ampere retry after sustained export can fund the step plus 50 W. Coordinate allocator and output using an expiring command-bound nomination; retain the two-attempt limit and all electrical and hard capacity checks. [Details and limits](docs/release-0.17.0-alpha.193.md).

[Earlier releases](CHANGELOG_OLD.md) and their linked release notes contain the historical changes and commissioning limits.

## Support

Report bugs and feature requests through [GitHub Issues](https://github.com/fuchs-1978/ioBroker.ems-optimizer/issues). See [SUPPORT.md](SUPPORT.md) for bounded diagnostic reporting and contact details.

## License

MIT License. Copyright (c) 2026 Carsten Reineke. See [LICENSE](LICENSE) for the full license text.
