# ioBroker EMS Optimizer

Forecast-based energy management for ioBroker. Combines PV and grid measurements, load history, weather forecasts and electricity prices in a rolling 48-hour plan.

**Current version: 0.17.0-alpha.150.** This adapter is in alpha testing. Passing software tests does not establish complete commissioning of a physical installation.

[Deutsche Bedienungsanleitung](README.de.md) · [Release history](CHANGELOG_OLD.md) · [Issues](https://github.com/fuchs-1978/ioBroker.ems-optimizer/issues)

## Features

- Coordinate up to three wallboxes, including vehicle priorities, minimum/target state of charge, manual minimum current and optional parallel charging.
- Allocate available PV power between charging and a domestic-hot-water heater, respecting grid, phase and device limits.
- Plan optional battery charging using forecasts, electricity prices and time-dependent grid charges.
- Provide separate heating-buffer and battery outputs when explicitly configured and enabled.
- Observe heat-pump telemetry and publish passive recommendations. Heat-pump, SG-Ready and KNX actuator commands are not implemented.
- Record bounded diagnostic episodes and daily summaries for targeted investigation instead of full-day SQL downloads.

## Requirements

- Node.js 22 or newer; CI covers Node.js 22, 24 and 26.
- ioBroker js-controller 6.0.11 or newer and Admin 7.8.23 or newer.
- Valid source mappings and independent device feedback for each enabled output.
- A compatible, separately commissioned external phase-control script for physical wallbox phase switching.

## Installation and setup

For alpha testing, install this repository through the ioBroker Admin custom GitHub installation option. Review the release notes before updating. Installation alone does not enable or commission real outputs.

1. Map grid and generation measurements in the Admin configuration.
2. Configure only the devices present at your installation, including their feedback, current limits and temperature or state-of-charge sources.
3. Configure history, forecasts and prices if required for planning. Review the generated plan and diagnostic states.
4. Before enabling real outputs, stop competing actuator scripts and verify the master and device releases under supervision.

There must be one responsible controller per actuator register. Measurement, protection, state-of-charge and required external phase/pump scripts may still be needed. When returning control to another controller, disable the external EMS phase follower as specified by its contract, withdraw the master release, verify OFF feedback and electrical standstill, then enable the replacement controller. `OutputOwned=false` alone is not a complete physical stop proof. Independent device protection remains necessary after a host failure.

The [German Admin guide](README.de.md) documents every configuration tab, default values, device mappings and troubleshooting. Defaults are not recommendations for every installation; existing configuration may differ.

## Diagnostics

| State group | Purpose |
| --- | --- |
| `System.Version` | Running adapter version; compare with installation and startup logs. |
| `Plan.*`, `Forecast.*`, `Chart.*` | Planned or predicted values, rather than proof of actuator response. |
| `Control.*` | Current budgets, allocation, phase decisions and control validity. |
| `Devices.*` | Device feedback, output ownership, command response and fault diagnostics. |
| `Debug.DailySummary_JSON` | Compact passive energy and coverage estimates with bounded investigation episodes. |
| `Debug.Shadow.DecisionRecord` | Recorded original samples and decision context for targeted historical analysis. |
| `Debug.Shadow.RecordDeliveryStatus` | Recorder backlog, transport and independent persistence evidence. |

A current state does not prove historical coverage. Missing, stale, invalid or unacknowledged measurements remain unknown. A successful state write or history-cache response does not prove database persistence. The recorder uses bounded database-only SELECT queries for its independent persistence check; see the [recorder access contract](docs/issue123-recorder-access.md).

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

### 0.17.0-alpha.150 (2026-10-26)

Load SQL learning history incrementally in daily chunks, resume completed work after errors and retry background refreshes without overlapping unresolved queries. [Release details](docs/release-0.17.0-alpha.150.md).

[Earlier changes](CHANGELOG_OLD.md). Keep only the latest release summary here; detailed commissioning evidence belongs in the linked release documents and issues.

## License

MIT. See [LICENSE](LICENSE).
