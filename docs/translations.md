# Admin translations

Alpha.298 ships eleven Admin catalogs covering English (`en`), German (`de`), Spanish (`es`), French (`fr`), Italian (`it`), Dutch (`nl`), Polish (`pl`), Portuguese (`pt`), Russian (`ru`), Ukrainian (`uk`) and Simplified Chinese (`zh-cn`). Each catalog contains the same 692 keys. The current Admin configuration references 672 of them for labels, choices, help, titles, text and localized units. [Admin configuration](../admin/jsonConfig.json) · [Catalogs](../admin/i18n)

The manifest includes a localized title and description for all eleven languages. Each of its seven retained release notices, Alpha.292 through Alpha.298, also has a translation in every supported language. Some dynamically generated operator explanations and daily reviews are still in German. [Adapter manifest](../io-package.json) · [Checker follow-up #316](https://github.com/fuchs-1978/ioBroker.ems-optimizer/issues/316)

When adding a setting, update every catalog in the same change. Translate field names and instructions while keeping physical quantities, unit symbols, phase identifiers and protocol values intact. For example, `mW` is milliwatts, `kW` is kilowatts, and the go-e phase-mode values are `1 = 1P` and `2 = 3P`. Product identifiers and ioBroker paths keep their original spelling.

Run `node --test test/admin-i18n.test.js` to check key parity, manifest coverage, English fallback, and selected numerical and technical literals. Run `npm run test:artifact` to check that the packed adapter includes every catalog.
