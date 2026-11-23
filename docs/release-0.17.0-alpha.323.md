# Alpha.323 — appliance forecast curves for ECharts

Each configured program-device row now publishes `Chart.DeviceProgramN_48h_json_chart`, with N being the 1-based row number used by `Devices.Programs.N`. A string state with role `json` contains a flat array of `{ "ts": <Unix milliseconds>, "val": <mean W> }`, directly compatible with the ioBroker ECharts JSON source. No history adapter or conversion script is needed.

Add a line in the ECharts preset editor, select **JSON** as its data source, and choose this state as its object ID. Select a line or stepped line, unit **W**, factor 1. Existing presets need no changes beyond adding this line. The JSON uses the same 192 quarter-hour points and overlap integration as the detailed `Plan.Appliances_48h_JSON` payload. Running manual loads and committed automatic plans are included. Observation-only previews are omitted. A known inactive row publishes zero points across the horizon; invalid plans without a running profile, disabled/removed rows and unresolved running loads publish `[]` to remove stale curves. Changes publish on the normal appliance scheduler cycle.

Row numbers follow the Admin device table. For Carsten's mapping: GS = `ems-optimizer.0.Chart.DeviceProgram1_48h_json_chart`; dryer = `ems-optimizer.0.Chart.DeviceProgram2_48h_json_chart`. A row reorder changes this mapping. The detailed payload continues to expose stable physical device keys.

Reference format: https://github.com/ioBroker/ioBroker.echarts#data-from-json
