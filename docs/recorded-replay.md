# General recorded-version comparison

`node tools/compare-recorded-versions.js manifest.json BEFORE_CHECKOUT AFTER_CHECKOUT`

This offline command uses trusted local checkouts. It performs no git fetch, SQL access or live ioBroker connection. Both versions use their own production engine loader, libraries and fixed event clock. State writes remain inside an in-memory namespace. Device writes, SQL, schedules, subscriptions and timers throw. It is not a security sandbox for malicious repository code: only use trusted versions.

The manifest contains:

- `schema: 1`, `namespace`, exact recorded `config` and `mapping`, and optional `sourceUnits`.
- `from` and `to` as epoch milliseconds; `initialStateMode: "cold-start"`.
- `initialStates: [{id, state}]`: the explicitly captured initial cache. Preserve ACK, q, original source timestamps, NULL and source identity. This must include the configuration/plan inputs needed by the selected engine versions. No future state is allowed in the initial cache. Private running-controller timers are not reconstructed.
- `inputStateIds`: the exact recorded input contract. Do not mix derived target/decision output states into the input tape. Supply an independently captured configuration, not a later/current plant configuration.
- `records`: existing raw original DecisionRecords or SQL transport rows accepted by the existing decoder. No new history reads are triggered by this tool.
- `sourceCoverage: "complete-export"`: an assertion by the exporter, not independently proven completeness. The tool additionally rejects unknown decoded frames, session/sequence gaps, conflicting source duplicates and observed buffer-loss increases.

Original `recording.sources`, `recording.pre_event` samples and `source.update` events supply the tape. The existing production control-update timestamps supply evaluated cycle times; no missing periodic ticks are invented. Received times order observations; source timestamps are never refreshed. Two observations at the same receipt time preserve input order, and source delivery precedes an evaluation at that time.

Each engine executes vehicle refresh, observation and realtime decision calculation. It consumes the supplied common plan inputs; it does not rerun SQL history building, forecasting, actuator drivers or physical response simulation. Internal state starts identically cold in each version; a running historical controller may therefore behave differently. Incomplete manifests or forbidden operations return unknown, not successful acceptance.

Output includes the exact manifest SHA256, package version, available git commit, content hash of each checkout's JS libraries, per-version trace hash and timestamped decision differences (at most100 detailed differences). Unknown evaluated ticks are explicitly counted. Repeating a comparison over the same input and checkouts should produce the same hashes.

This is open-loop decision comparison. Historical physical responses occurred only for the original commands. It cannot prove counterfactual energy savings, closed-loop safety, exact warm-state equivalence, or that an alternative command would have produced the historical next measurement. Do not apply replay outputs to devices.
