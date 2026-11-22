# EMS Optimizer for ioBroker

![EMS Optimizer logo](admin/ems-optimizer.png)

[![Test and Release](https://github.com/fuchs-1978/ioBroker.ems-optimizer/actions/workflows/test-and-release.yml/badge.svg?branch=main)](https://github.com/fuchs-1978/ioBroker.ems-optimizer/actions/workflows/test-and-release.yml) [![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

**[Deutsche Anleitung und Einrichtung](README.de.md)** · [Admin field reference (German)](docs/admin-reference.de.md) · [Changelog](#changelog) · [Roadmap](https://github.com/fuchs-1978/ioBroker.ems-optimizer/issues/36)

This ioBroker adapter uses PV forecasts, household demand and electricity prices to plan when to charge a battery or car, heat water, or start an appliance. During operation it allocates power from measurements at the grid connection and each participating device.

## How it works

| Question | What the adapter uses |
| --- | --- |
| When should a device run? | A rolling 48-hour plan in 15-minute slots. It considers PV, household load, vehicle departures, stored energy and the gross electricity price including applicable grid charges. |
| How much power is available now? | Grid import and export, per-phase limits, operator limits, device feedback, temperatures and state of charge (SoC). With fresh measurements, ordinary live allocation can continue through a forecast outage. Price-based charging and heating require a valid plan. |
| What did the device actually do? | **EMS overview** shows requests and reasons. Compare the device acknowledgement with measured current or AC power to confirm a start, power change or stop. |

## Requirements

Node.js 22 or newer, ioBroker js-controller 6.0.11 or newer and Admin 7.8.23 or newer. The adapter needs PV and grid measurements in watts. Connect history, forecast and tariff sources for the planning features you use. [Runtime requirements](docs/runtime-requirements.md) · [Measurement inputs](README.de.md#admin-messwerte)

## Installation and setup

This repository contains the development alpha. Choose a revision with successful checks and follow the installation steps in the German guide. After an update, read `ems-optimizer.0.System.Version` for the version running on your instance. [Installation and updates](README.de.md#installation-und-aktualisierung) · [Checks on main](https://github.com/fuchs-1978/ioBroker.ems-optimizer/actions/workflows/test-and-release.yml?query=branch%3Amain)

1. Leave the master output release off while mapping measurements. At the grid connection, a running load should increase import or reduce export.
2. Configure the devices present, their limits and feedback. Check the readings and plan in **EMS overview**.
3. Commission one output at a time with a low limit and one controller per actuator. Verify the command, acknowledgement, measured power and stop. Each wallbox and configured battery head has a guided grid-phase test. After a conclusive measurement and confirmed return to normal output, the EMS automatically saves the detected phase, even if it differs from the configured one. An inconclusive test keeps the current assignment. [Output commissioning](README.de.md#admin-allgemein) · [Guided phase test](https://github.com/fuchs-1978/ioBroker.ems-optimizer/issues/468)

## Integrations

| Device | What you can configure and verify |
| --- | --- |
| Grid and generation | Map import, export and phase measurements from a meter such as the SMA Energy Meter. Map PV inverter output and optional CHP generation separately. Monthly PV correction factors apply per array. [Grid and operator limits](README.de.md#admin-netzanschluss--14a--eebus) · [PV correction](README.de.md#admin-pv-korrektur) |
| Up to three go-e wallboxes | PV charging, immediate minimum charge, departure targets, price charging and parallel operation. Map go-e charging power in **kW** and phase currents in **A**. Dynamic phase switching requires a separately installed phase script. [Wallbox setup](README.de.md#admin-wallboxen-allgemein) · [Phase follower](docs/phase-follower-v2.md) |
| SunEnergy XT500 | Charge and discharge control with one to three heads. Each head reports its setpoint (`GS`) and measured AC power (`GP`). At the grid connection you can check the resulting change. [Battery setup and limits](README.de.md#admin-batteriespeicher) |
| my-PV heaters | Domestic hot water and a separate heating buffer each use their own power command and feedback. Tank temperatures, available power and releases determine whether a planned heating slot can run. [Hot water](README.de.md#admin-warmwasser-heizstab) · [Heating buffer](README.de.md#admin-heizpuffer) |
| Heat pump | Map electrical power, temperatures and actual SG Ready status from a compatible integration, for example Stiebel Eltron WPM/ISG. The EMS publishes recommendations for comparison with the heat pump's own controller. [Heat-pump setup](README.de.md#admin-wärmepumpe) |
| Household appliances | Siemens dishwasher and AEG dryer runs have supplied measured program profiles. Remote start requires a suitable device interface and release. A refrigerator with a writable temperature setpoint and feedback can use a PV or low-price window. [Device setup](README.de.md#admin-geräte) · [Measured runs](https://github.com/fuchs-1978/ioBroker.ems-optimizer/issues/445) |

## Household appliances

Start in **Observe** with a metered program run. The EMS learns the quarter-hour profile from a complete run. A new program can use the average of known profiles from the same appliance until it has its own measurements. In **Automatic**, running and dispatched programs reserve their remaining load before waiting devices are scheduled. The EMS checks remote-start permission, readiness and the selected program again before sending a start command.

Use `06:00` for a **finish time** or `+4` to **start within four hours** of enabling remote start. Look in `Devices.Programs.N` for the scheduled start and in `Plan.Appliances_48h_JSON` for the individual appliance curves. [Setup and profile fields](README.de.md#programmplanung-für-haushaltsgeräte)

## Configuration

The German guide follows all 19 Admin tabs in screen order. The reference lists object IDs, units and defaults. [Admin tabs](README.de.md#die-admin-reiter-in-bildschirmreihenfolge) · [Field reference](docs/admin-reference.de.md)

For the household load forecast, choose the historical median or enable the forecast comparison and select the 50/50 median–Lasso blend. With the blend selected, each quarter-hour uses a matching stored forecast pair when available and the median otherwise. [History and forecast](README.de.md#admin-historie-und-prognose) · [Prices and tariffs](README.de.md#admin-preise-und-tarife)

## Diagnostics

State names below are relative to the instance, for example `ems-optimizer.0`.

| When you see this | Where to look |
| --- | --- |
| A device is planned but idle | `Plan.Valid`, `Control.Valid`, **EMS overview** and the relevant `Devices.*` status show plan validity, live allocation and release conditions. |
| A car charges before the expected PV window | Check minimum SoC, manual current, low-SoC steps and departure. In `Plan.WallboxN_48h_JSON`, `departurePv` records an accepted deferral and the PV window. [Departure charging](README.de.md#mobilitätsreserve-und-vorhandene-abfahrtszeit) |
| A battery stops after a setpoint conflict | Compare the sent command, each head's fresh `GS` and `GP`, and `Devices.Battery.OutputStatus`. [Battery feedback and restart](docs/admin-reference.de.md#live-regelung-des-speichers) |
| A daily total looks incomplete | Check the covered time and gaps. Recorder capture, exact SQL confirmation and external retrieval have separate diagnostic states. [Data quality](docs/admin-reference.de.md#diagnose-sql-und-datenqualität) |

## Development

```sh
npm ci
npm run lint
npm run check:admin
npm run test:metadata
npm test
npm run test:package
npm run test:artifact
npm run test:equivalence
```

[Admin translations](docs/translations.md) · [Repository checker follow-up](https://github.com/fuchs-1978/ioBroker.ems-optimizer/issues/316)

## Changelog

### 0.17.0-alpha.315 (2026-11-22)

- Keep an earned departure charging pause through gaps in the PV forecast. Recalculate the latest grid slot that can still deliver the minimum before departure. [Release notes](docs/release-0.17.0-alpha.315.md)

### 0.17.0-alpha.314 (2026-11-22)

- Resume normal battery dispatch after a GS conflict on the first fresh SunEnergy report confirming zero setpoint and AC power per head. Recheck current demand and limits before the next command. [Release notes](docs/release-0.17.0-alpha.314.md)

### 0.17.0-alpha.313 (2026-11-21)

- Move remaining planned hot-water grid imports to cheaper heater slots while retaining direct PV, the battery reserve and the existing connection limits. [Release notes](docs/release-0.17.0-alpha.313.md)

### 0.17.0-alpha.312 (2026-11-21)

- Select vehicle SoC by the measurement timestamp, retaining newer manual corrections and observations across delayed imports and restarts. Share that observation with price planning. [Release notes](docs/release-0.17.0-alpha.312.md)

### 0.17.0-alpha.311 (2026-11-21)

- Include already planned minimum-reserve grid heat in the bounded price-bridge reconciliation, retaining PV allocation, battery reserve and heater limits. [Release notes](docs/release-0.17.0-alpha.311.md)

### 0.17.0-alpha.310 (2026-11-21)

- Leave room for direct PV charging before departure when the finished plan also covers a zero-PV fallback. [Release notes](docs/release-0.17.0-alpha.310.md)

### 0.17.0-alpha.309 (2026-11-21)

- Settle the battery on the surplus left by a running PV wallbox when SunEnergy and grid readings arrive at different rates. Retain a confirmed one-amp vehicle increase when the meter covers the full step within the configured tolerance. [Release notes](docs/release-0.17.0-alpha.309.md)

[Earlier releases](CHANGELOG_OLD.md) and their linked release notes contain the historical changes and commissioning limits.

## Support

Report bugs and feature requests through [GitHub Issues](https://github.com/fuchs-1978/ioBroker.ems-optimizer/issues). See [SUPPORT.md](SUPPORT.md) for bounded diagnostic reporting and contact details.

## License

Copyright (c) 2026 Carsten Reineke

[MIT License](LICENSE)
