# 0.17.0-alpha.165 — staged battery strategy preparation

This release prepares the agreed battery policy as a **read-only calculation and operator preview** in `Diagnostics.BatteryStrategy` and `Diagnostics.Snapshot_JSON.batteryStrategy`. It does not activate a battery, change the production allocator, enable EV discharge, or alter the existing price-charging sessions. `productionReady` is always false. Hardware commissioning and the subsequent guarded production integration remain open in #25/#75's consolidated acceptance.

## Agreed policy expressed by the preview

- An active battery should remain the fine regulator around the planned stage SoC, rather than be disabled when the stage is reached. A one-percentage-point working band is proposed, bounded by the device and operational minima/maxima.
- Connected/released vehicles below minimum SoC have priority. Battery energy charging then has priority over discretionary vehicle charging until the current stage target; unknown vehicle demand never creates support permission.
- Above the stage target, optional battery-to-EV assistance is limited to500W, actual device power capability and the energy above the target. Proposed EV increases are at most1A per step, not maximum charging. These are conservative preview assumptions, not changes to wallbox or battery output ramps.
- Fine charge/discharge room remains visible around the stage, but hard device limits always win. A device maximum below100% caps the preview; it is never relabelled as100%.
- Current stage target and staged evening timing are reused from the existing plan. The existing final-charge reserve (normally45minutes) is read rather than replaced with a fixed evening clock time.
- Vehicle night targets are minimum SoC, not the higher discretionary target. Their AC deficits are shown with charging losses. `nightGridKWh` remains null: an AC deficit is not itself proven required night import.

## Inputs and unknowns

The preview requires a fresh verified SunEnergy head profile (one or multiple heads), including original device Min/Max SoC, real SoC, capacity and charge/discharge capabilities. Existing SI/SO/SA parsing and device-profile contracts are reused. Missing/stale/invalid profile, limits or stage plan produce unknown, with no positive numerical support claim. A legacy single-head setup without a verified head profile stays unknown rather than assume static configured limits are device readbacks.

Operational reserve and configured maximum remain stricter bounds where applicable. Missing operational limits do not silently authorize power. Production ownership, heartbeat, independent acknowledgements, real electrical response, current/phase limits, §14a and safe handback still require the existing guarded paths and real commissioning.

## Night-energy estimate

The preview uses the first remaining forecast PV day within24hours and its existing final-charge time reserve. Complete quarter-hour PV/baseload coverage is required. Remaining battery replenishment to the allowed maximum, eligible vehicle minima, expected house load and usable PV produce a shared AC energy-gap estimate, capped by physical battery energy room. Charging efficiency follows the existing planner convention (square root of configured round-trip efficiency, or existing per-direction efficiency).

A factor0.9 on forecast PV is an explicit conservative preview assumption, **not measured forecast accuracy**. The energy sum does not prove temporal feasibility, suitable cheap tariff blocks or per-vehicle grid import; it is not fed into the current Modul3 purchase planner. Those time/price/priority allocations and cyclic battery/EV interactions must be integrated and validated before this strategy becomes production policy.

No additional SQL/history calls, source subscriptions, raw recorder logging or plant tests are introduced. The optional diagnostic setup adds one read-only display field; all11 translation catalogs have584keys. The current plant settings and existing vehicle price-session semantics remain unchanged.

## Verification

Positive/negative tests cover holding a reached stage while preserving fine-regulation room, bounded excess-energy support, below-minimum vehicle priority, true device maximum below100%, unknown/stale/conflicting bounds, absent/future plans, invalid efficiency, night deficit/PV coverage, overlap rejection and unknown/release-withdrawn vehicles. Existing full suite, lint, package/schema/admin checks, installed tarball and historical comparisons must remain green; tests do not constitute battery commissioning or a measured energy-saving claim.
