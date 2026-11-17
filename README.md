![EMS Optimizer logo](admin/ems-optimizer.png)

# EMS Optimizer

[![Test and Release](https://github.com/fuchs-1978/ioBroker.ems-optimizer/actions/workflows/test-and-release.yml/badge.svg?branch=main)](https://github.com/fuchs-1978/ioBroker.ems-optimizer/actions/workflows/test-and-release.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

**[Deutsche Schritt-für-Schritt-Anleitung für alle Admin-Reiter](README.de.md)** · [Admin field reference (German)](docs/admin-reference.de.md) · [Changelog](#changelog) · [Issue tracker](https://github.com/fuchs-1978/ioBroker.ems-optimizer/issues)

EMS Optimizer is an energy management adapter for [ioBroker](https://www.iobroker.net/). It coordinates PV surplus, a home battery, up to three wallboxes and available electric heaters. It can also schedule compatible household appliances. The source build on GitHub is **0.17.0-alpha.297**. Check `System.Version` on your instance for the running build.

## How it works

- **The plan** estimates the next 48 hours in 15-minute slots from generation, household consumption, device needs and available electricity prices. The price comparison uses the gross energy price including applicable grid charges.
- **The live controller** allocates power from current measurements. It considers user and device releases, current per-phase and grid-operator limits, the battery and vehicle state of charge, and heater temperatures. When the plan is unavailable, valid live measurements can still support ordinary allocation. Planned price charging and price-based heating resume with a valid plan.
- **Device control** requires the relevant releases and a supported, commissioned device interface. Heat-pump telemetry and SG Ready recommendations are read-only. Phase changes on a go-e charger require a separate supported phase script. [Device setup](README.de.md#die-admin-reiter-in-bildschirmreihenfolge) · [Phase follower](docs/phase-follower-v2.md)

## Requirements

- Node.js 22 or newer, ioBroker js-controller 6.0.11 or newer and Admin 7.8.23 or newer. Automated checks cover Node.js 22, 24 and 26.
- Confirmed PV and grid measurements in watts. Use the actual device status, limits and feedback for each output you enable.

## Installation and setup

1. In ioBroker Admin open **Adapters → Install from custom source → GitHub**. Enter `https://github.com/fuchs-1978/ioBroker.ems-optimizer`. Select a tested commit for a reproducible installation. [Checks for main](https://github.com/fuchs-1978/ioBroker.ems-optimizer/actions/workflows/test-and-release.yml?query=branch%3Amain)
2. Open the instance settings under **Instances → ems-optimizer.0**. Leave the master output release off while mapping measurements and limits. Disable any device that is absent.
3. Add the forecast, history and price sources you intend to use. Check the measured grid balance, device status and plan on **EMS overview**.
4. Commission one output at a time with a low commissioning limit and one controller per actuator. Check command, device acknowledgement and actual current or power. Confirm the stop before giving that actuator to another controller. [Commissioning steps](README.de.md#admin-allgemein)

## Configuration

The German guide follows the actual Admin tab order and shows how to enter and verify each setting. The field reference adds object IDs, units, defaults and advanced options. State fields take full ioBroker object IDs. Use the settings and protection limits of the actual installation.

| Task | Where to start |
| --- | --- |
| Connect measurements and protection limits | [Grid connection / §14a / EEBUS](README.de.md#admin-netzanschluss--14a--eebus) · [Measurements](README.de.md#admin-messwerte) |
| Build a plan or correct a PV forecast | [History and forecast](README.de.md#admin-historie-und-prognose) · [PV correction](README.de.md#admin-pv-korrektur) · [Prices and tariffs](README.de.md#admin-preise-und-tarife) |
| Configure EV charging | [Shared wallbox settings](README.de.md#admin-wallboxen-allgemein) · [Individual vehicle and charger settings](README.de.md#admin-wallbox-0--miie-up) |
| Configure home storage | [Battery capacity, head allocation, SoC reserves and setpoints](README.de.md#admin-batteriespeicher) |
| Configure thermal functions | [Domestic hot water](README.de.md#admin-warmwasser-heizstab) · [Heating buffer](README.de.md#admin-heizpuffer) · [Heat-pump advice](README.de.md#admin-wärmepumpe) · [Heating strategy](README.de.md#admin-wärmestrategie) |
| Schedule appliances and optimize device temperatures | [Devices](README.de.md#admin-geräte) |
| Investigate a missing or unexpected command | [EMS overview](README.de.md#admin-ems-übersicht) · [Troubleshooting](README.de.md#typische-einrichtung-und-fehlersuche) |

## Integrations

- **Grid and PV readings** come from the configured ioBroker objects, for example an SMA meter and inverter integration. Check the meter boundary and the signs of import and export.
- **Wallboxes** use the mapped go-e current and release outputs with independent feedback. [Wallbox contract](docs/admin-reference.de.md#produktiver-wallboxausgang)
- **Electric heaters** use dedicated my-PV power commands and measured output for each heating circuit. [Hot-water heater](docs/admin-reference.de.md#admin-warmwasser-heizstab) · [Heating buffer](docs/admin-reference.de.md#admin-heizpuffer)
- **SunEnergy XT500 batteries** use the standard driver. The head distribution mode reads each configured head and supports one to three heads. [Driver modes, limits and signs](docs/admin-reference.de.md#sunenergy-standardadapter-mit-13-köpfen)
- **Heat pumps and appliances** use the objects exposed by the configured ioBroker adapters. Check actual device support and feedback before commissioning. [Heat-pump inputs](docs/admin-reference.de.md#admin-wärmepumpe) · [Appliance inputs](docs/admin-reference.de.md#admin-geräte)

## Diagnostics

Open **EMS overview** for current reasons, plan feasibility and estimated daily energy. Under **Objects**, start with `ems-optimizer.0.System.Version`, `Plan.Valid`, `Control.Valid` and the relevant `Devices.*` states. For a command, compare the time and value of the request, the acknowledgement and an independent measurement. Recorder capture, exact SQL delivery and external historical availability describe three different stages. [Diagnostic fields and SQL](docs/admin-reference.de.md#diagnose-sql-und-datenqualität)

The [roadmap](https://github.com/fuchs-1978/ioBroker.ems-optimizer/issues/36) points to work still in progress and the dated operational evidence. Use [Support](SUPPORT.md) when reporting an issue.

## Development

```sh
npm ci
npm run check:admin
npm run test:metadata
npm test
npm run test:package
npm run test:artifact
npm run test:equivalence
```

[Admin translations](docs/translations.md) · [Repository checks #316](https://github.com/fuchs-1978/ioBroker.ems-optimizer/issues/316)

## Changelog

### 0.17.0-alpha.297 (2026-11-17)

- Passively learn household appliance grid phases from repeated measured on/off changes. Persist per-meter evidence and display the phase and rejection reasons in Admin. Includes the battery and wallbox phase tests from alpha.296. [Release notes](docs/release-0.17.0-alpha.297.md)

### 0.17.0-alpha.296 (2026-11-17)

- Configure the grid phase of each SunEnergy head. Test all three heads and wallboxes from Admin and save a clearly detected phase after confirmed electrical return. [Release notes](docs/release-0.17.0-alpha.296.md)

### 0.17.0-alpha.295 (2026-11-17)

- Optionally reserve stored energy for the next configured high tariff period. At equal prices, the plan assigns scarce energy to quarters with higher expected household demand after PV. [Release notes](docs/release-0.17.0-alpha.295.md)

### 0.17.0-alpha.293 (2026-11-16)

- Add an optional 50/50 Median and Lasso load forecast for planning. Each slot falls back to Median when the saved forecast pair is unavailable. [Release notes](docs/release-0.17.0-alpha.293.md)

### 0.17.0-alpha.292 (2026-11-16)

- Use free PV up to the battery charge limit when restoring the 20% reserve. When grid charging is authorized, buy only the power needed to reach a total of 1,000 W. [Release notes](docs/release-0.17.0-alpha.292.md)

### 0.17.0-alpha.288 (2026-11-16)

- Prioritize minimum-SoC charging on all wallboxes. Protect the storage reserve during forecast periods longer than six hours below 20%, with price-aware recovery within the available grid budget. [Release notes](docs/release-0.17.0-alpha.288.md)

### 0.17.0-alpha.285 (2026-11-15)

- Use one SunEnergy head at low combined power and rotate new starts among similarly charged heads. The Admin defaults are 500 W and a five-percentage-point SoC band. [Release notes](docs/release-0.17.0-alpha.285.md)

### 0.17.0-alpha.284 (2026-11-15)

- Spread forecast hot-water demand across a recurring cheap overnight tariff block while preserving the modeled heat reserve. [Release notes](docs/release-0.17.0-alpha.284.md)

### 0.17.0-alpha.283 (2026-11-15)

- Replan a queued battery direction change when the current grid measurement no longer calls for it. Keep observing the last issued setpoint while it fits the current protection limits. [Release notes](docs/release-0.17.0-alpha.283.md)

### 0.17.0-alpha.282 (2026-11-15)

- Start single-phase WB1 charging at 6 A from at least 800 W of measured daytime surplus, with up to 600 W from a nearly full SunEnergy store. Use later surplus for storage charging. [Release notes](docs/release-0.17.0-alpha.282.md)

### 0.17.0-alpha.281 (2026-11-15)

- Roll back battery setpoints rejected before dispatch. The controller replans from the last issued setpoint or confirmed idle state. [Release notes](docs/release-0.17.0-alpha.281.md)

### 0.17.0-alpha.280 (2026-11-15)

- Use fresh GS echoes to count consecutive unacknowledged single-head setpoints. GP continues to verify electrical response and reserved power. [Release notes](docs/release-0.17.0-alpha.280.md)

### 0.17.0-alpha.279 (2026-11-15)

- After two minutes of measured near-limit charging at a single SunEnergy head, use real PV export to qualify a wallbox start and let the battery absorb the remaining surplus. [Release notes](docs/release-0.17.0-alpha.279.md)

[Earlier releases](CHANGELOG_OLD.md) and their linked release notes contain the historical changes and commissioning limits.

## Support

Report bugs and feature requests through [GitHub Issues](https://github.com/fuchs-1978/ioBroker.ems-optimizer/issues). See [SUPPORT.md](SUPPORT.md) for bounded diagnostic reporting and contact details.

## License

MIT License. Copyright (c) 2026 Carsten Reineke. See [LICENSE](LICENSE) for the full license text.
