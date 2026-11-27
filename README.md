# EMS Optimizer for ioBroker

![EMS Optimizer logo](admin/ems-optimizer.png)

[![Test and Release](https://github.com/fuchs-1978/ioBroker.ems-optimizer/actions/workflows/test-and-release.yml/badge.svg?branch=main)](https://github.com/fuchs-1978/ioBroker.ems-optimizer/actions/workflows/test-and-release.yml) [![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

**[Deutsche Anleitung und Einrichtung](README.de.md)** · [Admin field reference (German)](docs/admin-reference.de.md) · [Changelog](#changelog) · [Roadmap](https://github.com/fuchs-1978/ioBroker.ems-optimizer/issues/36)

**Development alpha for test installations.** Start with actuator outputs disabled and check the live measurements before commissioning a device. [Published versions on npm](https://www.npmjs.com/package/iobroker.ems-optimizer?activeTab=versions)

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

The published test channel is `iobroker.ems-optimizer@alpha`. In ioBroker Admin, open the custom installation dialog under **Adapters** and enter that package specifier. For a reproducible installation, use the full version, for example `iobroker.ems-optimizer@0.17.0-alpha.344`. Read `ems-optimizer.0.System.Version` to verify the running version. [German setup guide](README.de.md#installation-und-aktualisierung) · [GitHub releases](https://github.com/fuchs-1978/ioBroker.ems-optimizer/releases)

1. Leave the master output release off while mapping measurements. At the grid connection, a running load should increase import or reduce export.
2. Configure the devices present, their limits and feedback. Check the readings and plan in **EMS overview**.
3. Commission one output at a time with a low limit and one controller per actuator. Verify the command, acknowledgement, measured power and stop. Each wallbox and configured battery head has a guided grid-phase test. After a conclusive measurement and confirmed return to normal output, the EMS automatically saves the detected phase, even if it differs from the configured one. An inconclusive test keeps the current assignment. [Output commissioning](README.de.md#admin-allgemein) · [Guided phase test](https://github.com/fuchs-1978/ioBroker.ems-optimizer/issues/468)

## Integrations

| Device | What you can configure and verify |
| --- | --- |
| Grid and generation | Map import, export and phase measurements from a meter such as the SMA Energy Meter. Map PV inverter output and optional CHP generation separately. Monthly PV correction factors apply per array. [Grid and operator limits](README.de.md#admin-netzanschluss--14a--eebus) · [PV correction](README.de.md#admin-pv-korrektur) |
| Up to three go-e wallboxes | Immediate mobility reserve, a scheduled morning minimum, flexible PV charging and one-off departure targets. Several cars can charge in parallel within the available power. Map go-e charging power in **kW** and phase currents in **A**. Dynamic phase switching requires a separately installed phase script. [Wallbox setup](README.de.md#admin-wallboxen-allgemein) · [Phase follower](docs/phase-follower-v2.md) |
| SunEnergy XT500 | Charge and discharge control with one to three heads. Each head reports its setpoint (`GS`) and measured AC power (`GP`). At the grid connection you can check the resulting change. [Battery setup and limits](README.de.md#admin-batteriespeicher) |
| my-PV heaters | Domestic hot water and a separate heating buffer each use their own power command and feedback. Tank temperatures, available power and releases determine whether a planned heating slot can run. [Hot water](README.de.md#admin-warmwasser-heizstab) · [Heating buffer](README.de.md#admin-heizpuffer) |
| Heat pump | Map electrical power, temperatures and actual SG Ready status from a compatible integration, for example Stiebel Eltron WPM/ISG. The EMS publishes recommendations for comparison with the heat pump's own controller. [Heat-pump setup](README.de.md#admin-wärmepumpe) |
| Household appliances | Siemens dishwasher and AEG dryer runs have supplied measured program profiles. Remote start requires a suitable device interface and release. A refrigerator with a writable temperature setpoint and feedback can use a PV or low-price window. [Device setup](README.de.md#admin-geräte) · [Measured runs](https://github.com/fuchs-1978/ioBroker.ems-optimizer/issues/445) |

## Energy dashboard and vehicle charging

The standalone dashboard shows live power flows and opens each vehicle’s settings from its card. Set the next trip at the top and keep everyday charge limits below it. Opening the HTML file locally shows sample data. For live use, serve it from the ioBroker web adapter and check its instance and object mappings. [Dashboard file](examples/ems-energiefluss.html) · [Setup and data access](README.de.md#energiefluss-dashboard)

| Vehicle setting | When it charges |
| --- | --- |
| Mobility reserve | A connected, enabled car below its reserve requests power immediately. |
| Minimum SoC | With morning scheduling enabled for that wallbox, the EMS aims for 06:00 local time. It can use PV or cheaper tariff intervals, including time-dependent grid charges. |
| Maximum SoC | The normal upper limit for flexible charging, for example from surplus PV. |
| Departure SoC | A one-off target for the booked date and time. The booking survives unplugging. Its grid-charging option allows a top-up to the trip target, which can exceed the everyday maximum. |

A car arriving at 25% with a 30% reserve, 50% minimum and 80% maximum requests the first five percentage points immediately. It can schedule the next twenty before morning. Equal reserve and minimum make the whole minimum immediate. [Schedule settings and example](docs/release-0.17.0-alpha.344.md)

## Household appliances

Start in **Observe** with a metered program run. The EMS learns the quarter-hour profile from a complete run. A new program can use the average of known profiles from the same appliance until it has its own measurements. In **Automatic**, running and dispatched programs reserve their remaining load before waiting devices are scheduled. The EMS checks remote-start permission, readiness and program selection before dispatch. The configured running status confirms the start. If the appliance still reports ready and the window remains open, the EMS can retry after 15 and 30 minutes. Five minutes after an unconfirmed third attempt it records an error in the `startAttempt` field of the `Devices.Programs.N` JSON. [Start confirmation](docs/release-0.17.0-alpha.335.md)

A manual start reserves the remaining program profile at the actual start time. The central plan includes this demand when allocating PV, storage and flexible loads.

Use `06:00` for a **finish time** or `+4` to **start within four hours** of enabling remote start. The `Devices.Programs.N` JSON contains the scheduled start. For ECharts, use `Chart.DeviceProgramN_48h_json_chart`, where N is the one-based device row. The shared plan is in `Plan.Appliances_48h_JSON`. [Setup](README.de.md#programmplanung-für-haushaltsgeräte) · [ECharts settings](README.de.md#geräteprognosen-in-echarts)

## Configuration

The German guide follows all 19 Admin tabs in screen order. The reference lists object IDs, units and defaults. [Admin tabs](README.de.md#die-admin-reiter-in-bildschirmreihenfolge) · [Field reference](docs/admin-reference.de.md)

For the household load forecast, choose the historical median or enable the forecast comparison and select the 50/50 median–Lasso blend. With the blend selected, each quarter-hour uses a matching stored forecast pair when available and the median otherwise. [History and forecast](README.de.md#admin-historie-und-prognose) · [Prices and tariffs](README.de.md#admin-preise-und-tarife)

## Diagnostics

State names below are relative to the instance, for example `ems-optimizer.0`.

| When you see this | Where to look |
| --- | --- |
| A device is planned but idle | `Plan.Valid`, `Control.Valid`, **EMS overview** and the relevant `Devices.*` status show plan validity, live allocation and release conditions. |
| A car charges before the expected PV window | Compare the current SoC with the immediate reserve, the morning deadline and the booked trip’s grid permission. Also check manual current and low-SoC steps. The effective trip is in `Vehicles.WallboxN.DeparturePlan_JSON`. [Vehicle charge settings](README.de.md#mobilitätsreserve-morgenminimum-und-abfahrts-soc) |
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

### 0.17.0-alpha.344 (2026-11-27)

- Edit each vehicle’s immediate reserve in the dashboard. Schedule the minimum by 06:00 in cheaper tariff windows and set a separate SoC for a booked departure. [Release notes](docs/release-0.17.0-alpha.344.md)

### 0.17.0-alpha.343 (2026-11-27)

- Keep an established EV charging current through a SunEnergy telemetry outage while current grid measurements and phase limits permit it. [Release notes](docs/release-0.17.0-alpha.343.md)

### 0.17.0-alpha.342 (2026-11-27)

- Let the home battery absorb surplus PV during the wallbox start delay. The car starts when the meter confirms sufficient power. [Release notes](docs/release-0.17.0-alpha.342.md)

### 0.17.0-alpha.341 (2026-11-27)

- Keep a running EQV at 6 A through a forecast PV dip with up to 0.5 kWh of battery support per gap. [Release notes](docs/release-0.17.0-alpha.341.md)

### 0.17.0-alpha.340 (2026-11-27)

- Forecast battery charging from surplus PV left by the house and car after a daily charge target has been reached, including after a later discharge. [Release notes](docs/release-0.17.0-alpha.340.md)

### 0.17.0-alpha.339 (2026-11-26)

- Use less memory to aggregate dense SQL measurements, build multi-day history and record diagnostics. [Release notes](docs/release-0.17.0-alpha.339.md)

### 0.17.0-alpha.338 (2026-11-26)

- Set a one-off departure date, local time and optional charge target in the web dashboard. Allow grid charging to that target for the individual trip. [Release notes](docs/release-0.17.0-alpha.338.md)

### 0.17.0-alpha.337 (2026-11-26)

- When one car is charging to its minimum, qualify multi-amp PV current swings against 45 seconds of sustained surplus. [Release notes](docs/release-0.17.0-alpha.337.md)

Versions between these entries are listed in the [changelog archive](CHANGELOG_OLD.md).

### 0.17.0-alpha.331 (2026-11-25)

- The regular departure charge ends at the vehicle’s minimum SoC. PV can continue charging to the normal target. Charging to that upper target from the grid requires the wallbox’s separate permission. [Release notes](docs/release-0.17.0-alpha.331.md)

[Earlier releases](CHANGELOG_OLD.md) cover the full version history and commissioning limits.

## Support

Report bugs and feature requests through [GitHub Issues](https://github.com/fuchs-1978/ioBroker.ems-optimizer/issues). See [SUPPORT.md](SUPPORT.md) for bounded diagnostic reporting and contact details.

## License

Copyright (c) 2026 Carsten Reineke <ems-optimizer@proton.me>

[MIT License](LICENSE)
