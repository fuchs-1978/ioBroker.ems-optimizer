# Translation coverage

The Admin interface has complete catalogs for all 614 English keys in eleven
languages: English (`en`), German (`de`), Spanish (`es`), French (`fr`), Italian
(`it`), Dutch (`nl`), Polish (`pl`), Portuguese (`pt`), Russian (`ru`), Ukrainian
(`uk`) and Simplified Chinese (`zh-cn`). Field labels, choices, written-out units, tooltips and
extended guidance are translated; the nine additional catalogs no longer use
the English help-text fallback introduced in PR #261.

Alpha.162 adds eight translated overview labels. Dynamic operator explanations
and daily reviews are currently German; catalog coverage does not imply that
runtime diagnostic sentences are localized into every Admin language.

Shared units, phase names, product names, technical identifiers and interface
values intentionally remain literal. For example, `kWh`, `L1`, `EEBUS`,
`allow_charging`, `info.lastUpdate`, `Europe/Berlin` and
`@controlled-battery-ac` must not be translated into different API names.
Some ordinary words are also identical in two languages, such as Spanish
“General”, Italian “Standard” and French “3 phases”.

The nine additional translations were produced with local translation models
and reviewed for technical terms, literal identifiers, numerical values and
critical commissioning/protection instructions. The complete commissioning,
heating-buffer, forecast-reserve and SunEnergy safety paragraphs were explicitly edited.
Models are development tools, not adapter dependencies or shipped assets.

The manifest title and description cover all eleven languages. In Alpha.205,
all four release notices Alpha.202–.205 are translated. The retained notices
Alpha.199–.201 still use English fallback for nine locales. Admin catalog
coverage and translated release notices are checked separately.
[Checker follow-up #316](https://github.com/fuchs-1978/ioBroker.ems-optimizer/issues/316)

`test/admin-i18n.test.js` checks exact key parity, non-empty values and manifest
coverage for every retained news item. It also rejects copied English help
sentences and unexpected identical English field labels, checks numerical
values and literal technical identifiers, and rejects tokenizer artifacts.
The packed-artifact check verifies that all eleven catalogs are installed.

When adding a setting, update every catalog in the same change. A complete key
set alone is not sufficient: translate the explanatory text while preserving
interface names, physical quantities and the meaning of permission and safety
conditions. [Current checker follow-up #316](https://github.com/fuchs-1978/ioBroker.ems-optimizer/issues/316)
