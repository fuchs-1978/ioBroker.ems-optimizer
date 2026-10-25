# Translation coverage

The Admin catalogs cover all 565 English keys in these eleven languages:
`en`, `de`, `es`, `fr`, `it`, `nl`, `pl`, `pt`, `ru`, `uk`, `zh-cn`.

Key completeness is a structural check, not a claim of complete translation.
English and German retain their existing complete catalogs. The nine newly
added catalogs translate the main navigation and use explicit English fallback
text for most field labels and technical help. Full linguistic translation and
review of these entries is still outstanding. Technical IDs and product names
must remain unchanged.

The manifest title, description and all seven retained version messages cover
all eleven languages. The product name remains EMS Optimizer in most locales.

`test/admin-i18n.test.js` checks exact catalog key parity, non-empty string
values and manifest coverage, including every retained news item. It also
checks that visible Admin strings resolve in the English and German source
catalogs. Do not remove the structural checks when adding new settings.

When adding a key, update every catalog in the same change. If an English
fallback is needed, record it honestly; do not label key parity as completed
translation. Issue #197 can mark missing-file findings E5010/W5603 as fixed,
but the remaining linguistic work must stay explicit.
