# 0.17.0-alpha.164 — five operator feature packages

The five requested development packages are implemented in sequence. This release adds read-only operator features, an optional history-profile method and offline tooling. It does not install itself, change plant settings, add SQL/history calls, add raw source subscriptions, or expand the original recorder stream. Default allocation, heat planning and actuator protection remain unchanged. npm/Latest admission stays excluded; heat-pump planning stays deferred.

## 1. Departure feasibility and configuration explanations

`Diagnostics.Planning` and the JSON report show battery demand, AC demand including efficiency losses, energy already assigned by the existing shared plan before the actual departure, and any remaining plan shortfall. No deadline is invented when deadline planning is off. Reached, blocked, nominally impossible, unknown and expected-reachable goals are separate states. A forecast is not a guarantee. AC demand is not described as grid import; unavailable PV/grid attribution remains unknown. Partial planning slots are clipped at now/departure; overlapping or invalid slots are rejected. Existing allocation is reused without distributing its energy twice.

`Diagnostics.Configuration` explains raw Admin conflicts (SoC/current limits, capacity, mapping and thermal hysteresis), intentional release withdrawal, unknown external SoC and output faults. Disabled devices are skipped. This supplements existing validators; it never changes configuration or replaces protective validation.

## 2. Observed transition and reaction assessment

`Diagnostics.Transitions` evaluates the existing five-second observations and existing command metadata. Current responses require independent current ACK and fresh power; phase changes require an observed quiet phase, native mode and new phase-current chain. Stop and handover observations distinguish ACK, electrical zero, ownership/reserve release and receiver uptake. Incomplete/missed chains remain unknown. Multiple unresolved same-value heater commands cannot be attributed to one ACK. No new command, source logging or original-record fields are introduced.

Per actuator/kind the report keeps at most64 reaction samples, reports ACK/electrical P50/P90 and separately available transport time. At most24 event details are retained. EHZ samples require a correlated numeric driver ACK or the existing qualified zero-write receipt, plus independent electrical observations. Unsupported/missing receipts remain unknown. Electrical observation time is distinct from source timestamp and may be bounded by sampling resolution. Counters are session-local descriptive statistics, not protection/commissioning approval or an automatic timer tuner. Sampling gaps reset pending chains.

## 3. Regulation quality and forecast learning

`Diagnostics.RegulationQuality` integrates covered grid samples, deviations, export and observed qualified wallbox admission budgets. Potentially absorbable energy is a candidate, never automatically proven avoidable export. Heater temperature capacity alone is not a full output-admission proof. Gaps are explicit and `avoidableExportWh` remains null without stronger evidence. The existing persistent daily summary is reused in the main daily view; these extra regulation metrics start afresh each session.

`Diagnostics.ForecastInsights` and `Diagnostics.Snapshot_JSON` expose empirical PV residual bands and the short-term load preview. Calibration requires forecasts received before their target quarter-hour and at least90% valid observed coverage. At least20 daylight slots are needed before empirical bands are shown. Their observed hit rate uses only bands fixed before delivery; no retrospective replacement or guaranteed probability is claimed. Residuals are bounded to192 observations and predictions to192 slots. This is session-local, not seasonally established uncertainty.

The load correction preview uses at least10minutes of current valid cleaned baseload, a15-minute exponential residual smoother, a±25% cap and one-hour decay into the future. It does not modify regulator predictions. Load and PV preview/quality are separate; no double PV correction is applied.

The historical profile selector offers `recent-weighted`: a28-day half-life weighted median by weekday/quarter-hour, plus a daily-energy scale capped at0.8–1.25 when at least3 complete ordinary-length local days exist. Missing slots remain unknown; DST-short/long days do not calibrate the daily-energy scale. It uses already loaded rows, with no extra query. **The compatible default remains `median`.** Selecting the alternative is a separate operator setting; no automatic improvement or saving is promised without comparison.

## 4. General offline version comparison

`npm run compare:recorded -- manifest.json BEFORE_CHECKOUT AFTER_CHECKOUT` runs two trusted local engine versions against the same decoded original source tape, original timestamps and explicitly supplied common configuration/cache/plan inputs. It reports content/input hashes, available commit identities and decision differences. Missing bases, sequence/session gaps, conflicting duplicates and source-loss evidence stop the comparison rather than supply guessed inputs. Unknown engine ticks are explicit.

This compares cold-start, open-loop realtime decisions. It does not rebuild SQL history/forecast, restore undocumented warm private timers, simulate alternative physical responses, or prove counterfactual energy savings. Details and manifest requirements: [recorded-replay.md](recorded-replay.md).

## 5. Repository support metadata

The package now declares the actual GitHub issue tracker in `bugs`; README and SUPPORT.md link the existing public maintainer identity and support channel. No receiving public email address has been specified; a commit no-reply address is not substituted for one. Email/copyright contact checker findings remain open. Topics are repository settings and remain separate; no npm/Latest publication or auto-merge policy change is made.

## Validation and remaining acceptance

Meaningful positive/negative cases cover deadlines/competition, invalid and overlapping plans, disabled configuration, stale/missing ACK/power, missed phase pause, delayed handover, supersession/gaps, bounded quantiles, forecast hindsight/gaps, load-correction limits and original-source replay differences. The full existing suite, lint, responsive grid/schema checks, real installed tarball and historical comparisons are required. Node22/24/26 CI must pass before merge. UI appearance, natural successful sequences, long-term forecast calibration and actual plant acceptance remain distinct from software tests. These additions do not award score points or close all associated feature/acceptance issues wholesale.

Local validation: 3,314 unit tests, all539 responsive grid fields, ESLint, metadata/news limits,61 official package/schema tests (schema-download retry succeeded), installed tarball285files/747engine states, and both immutable historical comparisons passed. The five new display states are created by the optional operator diagnostics setup, separate from the747engine states. All11 catalogs contain583keys. Late review changes to overlap/ACK/handover attribution passed the focused negative and positive cases; the PR CI will rerun the complete final tree.
