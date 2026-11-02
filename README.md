![EMS Optimizer logo](admin/ems-optimizer.png)

# EMS Optimizer

[![Test and Release](https://github.com/fuchs-1978/ioBroker.ems-optimizer/actions/workflows/test-and-release.yml/badge.svg?branch=main)](https://github.com/fuchs-1978/ioBroker.ems-optimizer/actions/workflows/test-and-release.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

Forecast-based energy management for [ioBroker](https://www.iobroker.net/). Combines PV and grid measurements, load history, weather forecasts and electricity prices in a rolling 48-hour plan.

**Current version: 0.17.0-alpha.191.** This adapter is in alpha testing. Passing software tests does not establish complete commissioning of a physical installation.

[Deutsche Bedienungsanleitung](README.de.md) · [Release history](CHANGELOG_OLD.md) · [Issues](https://github.com/fuchs-1978/ioBroker.ems-optimizer/issues)

## Contents

- [Features](#features)
- [Current scope](#current-scope)
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
| Implemented alpha functions for wallbox allocation, priority handoff, heater coordination and qualified SoC interpolation | Natural device, phase, protection and recovery cases remain part of the [installation acceptance](https://github.com/fuchs-1978/ioBroker.ems-optimizer/issues/7). |
| Passive load-model comparison and 90-day weather/selected room-history retention | Multi-day forecast validation; room/wind/heat features are not yet in Lasso. |
| Bounded recorder, exact SQL confirmation and qualified recovery | Long SQL transport delays and historical recording gaps remain under [recorder investigation](https://github.com/fuchs-1978/ioBroker.ems-optimizer/issues/60). A healthy current queue does not repair past losses. |
| Battery strategy preview and heat-pump telemetry | Productive [battery strategy](https://github.com/fuchs-1978/ioBroker.ems-optimizer/issues/25), [heat planning](https://github.com/fuchs-1978/ioBroker.ems-optimizer/issues/160) and [LPC group-net integration](https://github.com/fuchs-1978/ioBroker.ems-optimizer/issues/166) remain separate work. |

The [current roadmap](https://github.com/fuchs-1978/ioBroker.ems-optimizer/issues/36) tracks these boundaries. Release notes describe software changes; issue-specific operating evidence describes their practical validation.

## Forecast comparison

Enable the optional comparison in **History & forecast**. Production keeps its selected load profile. The four candidates are:

| Candidate | Calculation |
| --- | --- |
| Median | Typical quarter-hour load by weekday/holiday. |
| Lasso | Regularized model using cleaned load 2/7 calendar days earlier, time of day, weekday/holiday and optionally outside temperature/heating degree. |
| 50/50 blend | Arithmetic mean of the two predictions in each quarter-hour. |
| Lasso energy / Median shape | Scale the whole Median curve by Lasso daily energy divided by Median daily energy. This is a day-ahead scaling, not an adjustment to later actual consumption. |

Training runs on startup and with the daily history build at 00:10, using at most 84 days. Issued forecasts survive restart unchanged. `Forecast.LoadComparison.*` contains the model, forecast ledger and evaluation. Compare actuals and predictions over identical measured quarter-hours; a partial-day report must show its cutoff and slot coverage. SQL interval-average energy is an estimate, not a billing-meter difference. A complete regular day requires 96 paired slots; 92/100-slot DST target days are currently excluded. For calendar lags, both measured repeated-hour occurrences are averaged; only the missing spring clock hour may use the marked neighboring-hour estimate. Ordinary measured gaps stay unknown.

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

The [German Admin guide](README.de.md) documents every configuration tab, default values, device mappings and troubleshooting. Defaults are not recommendations for every installation; existing configuration may differ.

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

Start with outputs disabled, check source validity and the plan, then commission each intended output separately. Missing devices should be disabled, not represented by artificial zero measurements. Detailed field descriptions, defaults and troubleshooting are in the [German Admin guide](README.de.md).

## Integrations

EMS Optimizer combines ioBroker states supplied by other adapters or scripts. A manufacturer link describes the equipment; it does not establish compatibility with every model or firmware.

- [go-e chargers](https://go-e.com/): mapped charger commands and independent feedback; physical phase switching follows the external script contract.
- [SMA](https://www.sma.de/): mapped generation and grid measurements, including the configured protection sources.
- [my-PV](https://www.my-pv.com/): mapped electric-heater power commands and feedback where supported by the configured device interface.
- SunEnergy battery heads: see the [battery configuration and device-profile requirements](README.de.md#admin-batteriespeicher) and [strategy limits](docs/release-0.17.0-alpha.165.md).
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

State names above are relative to the instance, for example `ems-optimizer.0.System.Version`.

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

Admin translation catalogs are stored in `admin/i18n/<language>/translations.json`. Keep their keys aligned with the English catalog and all visible Admin texts. Package metadata and every retained release message must cover the supported languages. See [translation coverage and checks](docs/translations.md).

## Changelog

### 0.17.0-alpha.191 (2026-11-02)

- (fuchs-1978) Show active vehicle SoC plausibility warnings in the overview, attention, device and live diagnostics; mark affected SoC estimates as uncertain without changing charging control or the calculation. [Details and limits](docs/release-0.17.0-alpha.191.md).

### 0.17.0-alpha.190 (2026-11-02)

- (fuchs-1978) Recognize SQL host blocks and connect timeouts/refusals, pause recorder traffic with bounded retries, and retain canonical query failure codes and clear diagnostics. Keep pure read timeouts independent of publication and require exact storage proof for recovery. [Recovery policy](docs/release-0.17.0-alpha.190.md).

### 0.17.0-alpha.189 (2026-11-02)

- (fuchs-1978) Transfer a witnessed running charge to the manually preferred vehicle without a repeated start delay or reserve; retain the bounded qualification through short PV dips while preserving confirmed stop, minimum power and safety gates. [Policy and limits](docs/release-0.17.0-alpha.189.md).

### 0.17.0-alpha.188 (2026-11-02)

- (fuchs-1978) Separate bounded recorder publication from SQL verification timeouts with independent writer/reader diagnostics and backoffs. Retain unconfirmed local originals without age expiry; only exact SQL proof permits cleanup. [Diagnosis and limits](docs/release-0.17.0-alpha.188.md).

### 0.17.0-alpha.187 (2026-11-01)

- (fuchs-1978) Avoid overlapping identical heater refreshes during a bounded pending Modbus reset; retain fixed-one-phase charging minima without optional phase-mode feedback; exclude verified external battery discharge from legacy surplus budgets. [Details and limits](docs/release-0.17.0-alpha.187.md).

### 0.17.0-alpha.186 (2026-11-01)

- (fuchs-1978) Preserve metered SoC progress across unchanged cloud publications; hold witnessed follow-up charging through link loss before the ACK deadline. Bound MariaDB recorder history statements and allow paced recovery after transient database activity. [Details and recovery](docs/release-0.17.0-alpha.186.md).

### 0.17.0-alpha.185 (2026-11-01)

- (fuchs-1978) Fix false feedback faults while confirmed OFF waits for start budget. Resume a proven charging episode after cleared device error 5 without a repeated start delay, retaining fresh electrical, budget and safety checks. [Details](docs/release-0.17.0-alpha.185.md).

### 0.17.0-alpha.184 (2026-11-01)

- (fuchs-1978) Fix optional-follower budget cycling when a preferred fixed-one-phase car waits for its start budget without phase-mode feedback. Preserve electrical reservations and safety limits. [Details](docs/release-0.17.0-alpha.184.md).

[Earlier releases](CHANGELOG_OLD.md) and their linked release notes contain the historical changes and commissioning limits.

## Support

Report bugs and feature requests through [GitHub Issues](https://github.com/fuchs-1978/ioBroker.ems-optimizer/issues). See [SUPPORT.md](SUPPORT.md) for bounded diagnostic reporting and contact details.

## License

MIT License. Copyright (c) 2026 Carsten Reineke. See [LICENSE](LICENSE) for the full license text.
