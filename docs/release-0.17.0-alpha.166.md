# 0.17.0-alpha.166 — structured EMS overview

The first Admin tab now starts with compact operating status, current notices and a device summary. Detailed command budgets, timers and source ages remain in the existing live explanation under technical diagnostics.

Native jsonConfig panels group planning/battery preview, current/previous daily balances and technical diagnostics. They are initially collapsed; ioBroker Admin remembers expansion in browser-local storage. All twelve former read-only displays are retained. No editable configuration field is moved or introduced.

Three new read-only display states (`Diagnostics.Overview`, `Diagnostics.Attention`, `Diagnostics.Devices`) reuse the same cached report and bounded latest-state writer. Current source/decision uncertainty, configuration and vehicle-output findings, recorder loss/write counters since start, recording pressure and missing/blocked SQL proof remain visible above the collapsed details. Historical SQL deadline counts and expired originals remain in diagnostics; they are not automatically presented as a current outage. This is a scoped summary, not complete device-fault or protection supervision. Stale control snapshots do not display cached power/commands as current. Battery setup is only a configuration indication, not evidence of activation or readiness.

No allocation, device commands, release settings, SQL/history queries, recorder collection, tariff sessions or battery policy changes. The alpha.165 strategy remains preview-only. No claim of complete visual or plant acceptance follows from unit/schema checks. Install/update the adapter and reload the Admin configuration to see the new layout; this change has not installed itself on a running plant.

Verification covers historical-vs-current notices, output faults above folded details, stale powers, preservation of all read-only details and bounded publishing. The existing full suite, lint, responsive layout audit, package/schema checks, packed adapter and historical comparisons are required. Eleven catalogs contain 590 keys; 543 responsive leaf fields are audited.
