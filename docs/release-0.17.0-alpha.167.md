# 0.17.0-alpha.167 — mobility reserve input preparation

Add a persistent writable `Vehicles.WallboxN.MobilityReserve_pct` for each of the three vehicles. New states start at 0% (off); create-if-missing preserves later user settings. The read-only battery strategy preview accepts finite numeric 0..100 values, caps the reserve target at the vehicle minimum and reports the reserve AC deficit as a subset of that minimum deficit. It is never added again to the shared night energy balance. Missing/invalid values stay unknown; zero cannot request reserve charging. Device, connection and user-release conditions remain explicit. User configuration writes may have ack=false; that is accepted for this setting, not mistaken for device telemetry.

Reuse the existing DepartureTime/DepartureTimestamp and deadline-enabled settings. No new departure configuration is introduced and no live departure time is changed. The site inspection found all three departure time inputs empty, with flexible price deadlines.

This release prepares the requested input and diagnostic explanation only. Production price sessions, low-SoC immediate charging, tariffs, actuator outputs, allocation and SQL/history access remain unchanged. Automatic reserve charging and minimum-by-departure price scheduling remain open in #25. Battery strategy stays previewOnly=true and productionReady=false. No installation or real charging acceptance is implied.

Checks cover zero/positive/invalid reserve, maximum bounded by minimum, blocked vehicles, existing departure gating, no energy double-counting, writable persisted inputs and unchanged rules. Full tests, lint, package/schema, installed tarball and historical comparisons are required. Admin layout and 590-key translation catalogs remain unchanged.
