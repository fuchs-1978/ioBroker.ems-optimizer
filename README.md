# ioBroker EMS Optimizer

Forecast-based energy management for ioBroker. Combines PV and grid measurements, load history, weather forecasts and electricity prices in a rolling 48-hour plan.

**Current version: 0.17.0-alpha.162.** This adapter is in alpha testing. Passing software tests does not establish complete commissioning of a physical installation.

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

### 0.17.0-alpha.162 (2026-10-28)

Add an EMS overview with read-only live explanations, independent recorder/SQL/history quality and current/previous daily reviews. Reuse existing observations without extra SQL queries or control changes; unknown historical goals, costs and external audit coverage remain explicit. [Details and acceptance limits](docs/release-0.17.0-alpha.162.md).

### 0.17.0-alpha.161 (2026-10-28)

Resolve the SQL datapoint ID once per bounded metadata-cache period and verify originals with a literal numeric ID and inclusive time range. Retain an exact name/type guard against ID reassignment; preserve durable query fences and late results. Operator EXPLAIN changed from `ref` / 4 key bytes / 4,587 estimated rows with the ID subquery to `range` / 12 bytes / 2 estimated rows with a literal ID. The existing `(id,ts)` primary key needs no new index. The operator enabled a 32-thread cache and observed 4,969 connections with only 173 new threads (approximately 96.5% reuse); this is separate database tuning, not an adapter setting or a measured cure of the SQL delay. [Full SQL findings and release details](docs/release-0.17.0-alpha.161.md).

### 0.17.0-alpha.160 (2026-10-28)

Store compact journal batches in dependency-aligned immutable segments, preserving original hashes and independent SQL proofs. Verified offline storage relocation, legacy export and bounded host SQL/storage inspection are available. Older binaries require offline legacy export before downgrade. [Release and maintenance instructions](docs/release-0.17.0-alpha.160.md).

### 0.17.0-alpha.159 (2026-10-27)

Distinguish record writes, file sync, links and directory commit/cleanup barriers in bounded journal loss diagnostics. This identifies future stalls; it is not a proven fix of the storage or SQL latency cause. [Release details](docs/release-0.17.0-alpha.159.md).

### 0.17.0-alpha.158 (2026-10-27)

Count observed recorder loss-counter increases across sampling gaps in the same reporting period. Energy gaps and unknown restart/boundary attribution stay unchanged. This corrects reporting, not the underlying recorder loss. [Release details](docs/release-0.17.0-alpha.158.md).

### 0.17.0-alpha.157 (2026-10-27)

Keep established charging through age-only device telemetry gaps under fresh SMA protection, including immediate current ACKs, simultaneous peer gaps and idle phase fallback. [Release details](docs/release-0.17.0-alpha.157.md).

### 0.17.0-alpha.156 (2026-10-26)

Keep the optional EHZ heating during the preferred vehicle’s start delay. After qualification, reduce the heater and wait for real capacity before charging; preserve the completed countdown. [Release details](docs/release-0.17.0-alpha.156.md).

### 0.17.0-alpha.155 (2026-10-26)

Keep an aged valid vehicle SoC with explicit age diagnostics. Stop an unresponsive charging session after 15 minutes, release power only after physical OFF, and serve other vehicles before retrying. [Release details](docs/release-0.17.0-alpha.155.md).

### 0.17.0-alpha.154 (2026-10-26)

Keep a continuous cold-start topology and budget through delayed phase acknowledgements. Release optional restart donors on fresh controller withdrawal and reserve ramp demand before allocating heater residuals. [Release details](docs/release-0.17.0-alpha.154.md).

### 0.17.0-alpha.153 (2026-10-26)

Reclaim a blocked preferred start from optional running followers and the heater; require physical stop/reduction proof and ordinary start qualification. [Release details](docs/release-0.17.0-alpha.153.md).

### 0.17.0-alpha.152 (2026-10-26)

Keep a waiting priority car's minimum start budget while passing only the remainder to followers and the heater. This prevents repeated start resets and EQV target collapses. Alpha.151 electrical retry behavior is unchanged. [Release details](docs/release-0.17.0-alpha.152.md).

### 0.17.0-alpha.151 (2026-10-26)

Use the existing early one-amp retry with measured PV funding when a vehicle retains a current offset. Electrical response, bounded retries and hard limits remain required. [Release details](docs/release-0.17.0-alpha.151.md).

[Earlier changes](CHANGELOG_OLD.md). Keep only the latest release summary here; detailed commissioning evidence belongs in the linked release documents and issues.

## License

MIT. See [LICENSE](LICENSE).
