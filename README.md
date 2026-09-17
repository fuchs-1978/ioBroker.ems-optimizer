# ioBroker.ems-optimizer

Forecast-based energy management observer and 48-hour planner for ioBroker.

> Development status: early observer release. The adapter never writes to device actuators.

## Features

- SQL history and 15-minute profiles
- weekday and holiday load profiles
- 48-hour PV, weather, house-load and base-load forecasts
- independent energy-price and dynamic-grid-fee signals
- battery planning with delayed 70/90/100 percent target stages
- three conditional wallboxes
- domestic-hot-water and heating-buffer planning
- parallel flexible-load allocation
- PV-boost recommendation
- ECharts-compatible JSON series
- battery-sizing indicators

## Privacy

The repository contains no installation-specific ioBroker IDs. Data-point mappings are stored only in the local adapter configuration. Start with `config.example.json`.

## Safety

Version 0.2.7 is observer-only. It does not write to batteries, wallboxes, heaters, heat pumps, relays, §14a or EEBUS control points.

## Installation

In ioBroker Admin select **Adapters → Install from custom URL** and enter:

```text
https://github.com/fuchs-1978/ioBroker.ems-optimizer
```

Keep the existing JavaScript observer active for an initial parallel comparison. Adapter results are written below `ems-optimizer.0`.

## License

MIT
