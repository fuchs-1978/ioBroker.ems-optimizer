# Issue #157 – Feature: Tageskennzahlen zur Netzregelgüte bei nutzbarem Stellbudget

Historischer Originalstand vor der Aufgabenbereinigung am 2026-11-03. Quelle: https://github.com/fuchs-1978/ioBroker.ems-optimizer/issues/157. Letzte Issue-Änderung: 2026-10-29T07:23:51Z. Dieser Snapshot ist ein Archiv, keine aktuelle Aufgabenliste. Aktueller Stand: [Roadmap #36](https://github.com/fuchs-1978/ioBroker.ems-optimizer/issues/36).

## Ursprünglicher Issue-Text

<!-- live-installation-audit-20261029 -->
## Aktueller Rest nach Installation – 29.10.2026

- [x] alpha.164 läuft (`System.Version`/`alive` direkt gelesen); Diagnose-States liefern aktuelle Werte. Installation ist nicht mehr offen.
- [ ] Vermeidbare Energie bleibt ohne kausalen Nachweis unbekannt; reale Tages-/Lückenabnahme bleibt offen.

Browserdarstellung und vollständige Anlagenabnahme werden nicht aus State-Texten abgeleitet. Softwarebelege in PR282; zentrale Restübersicht #36. Kein SQL-/Historienabruf oder Anlagenversuch. Frühere Installationsaussagen unten bleiben als datierter Entwicklungsstand erhalten.

---

<!-- operator-packages-164-20261029 -->
## Softwarefortschritt alpha.164 – 29.10.2026

Auf ausdrücklichen Nutzerauftrag mit [PR #282](https://github.com/fuchs-1978/ioBroker.ems-optimizer/pull/282) umgesetzt und nach acht grünen CI-Jobs nach main `b3aa288b14d6424b81e1af9bd9668e4c13c421ec` übernommen. Geprüfter/gemergter Baum `f7e38afb075dea6fd6e4743a0e245762e376dced`.

- [x] Zusätzliche begrenzte Regelgüte-Kennzahlen mit Zeitabdeckung, Bezug/Export, Zielabweichung und getrennt beobachtet zugelassenem Wallbox-Stellbudget.
- [x] Potenziell aufnehmbare Energie ausdrücklich Kandidat; Temperaturkapazität des EHZ allein ist kein vollständiger Stellfreigabenachweis. avoidableExportWh bleibt ohne stärkeren Nachweis null. Keine erfundene Einsparung.
- [ ] Kausale reale Vermeidbarkeitsbelege und Tages-/Lückenabnahme bleiben offen. Diese Zusatzkennzahlen beginnen pro Sitzung; bestehende persistente Tagesbilanz bleibt Grundlage.

**Prüfung:**3314Unit-Tests,61offizielle Paket-/Schematests, installiertes Testtarball, historische Vergleiche und Node22/24/26 einschließlich frischem Controller-Integrationstest erfolgreich. [PR-CI](https://github.com/fuchs-1978/ioBroker.ems-optimizer/actions/runs/40828802101), [Branch-CI](https://github.com/fuchs-1978/ioBroker.ems-optimizer/actions/runs/40828796346).

[Umfang und Grenzen](https://github.com/fuchs-1978/ioBroker.ems-optimizer/blob/b3aa288b14d6424b81e1af9bd9668e4c13c421ec/docs/release-0.17.0-alpha.164.md). Keine neuen SQL-/Historienabrufe, Originalquellenprotokollierungen, Anlagenversuche oder produktiven Konfigurationsänderungen. GitHub-Release164 und tatsächliche Installation hier nicht durchgeführt. Das Issue bleibt wegen seiner genannten Restpunkte offen; ältere fehlende Implementierungsaussagen unten sind datierte Ausgangsstände.

---

<!-- issue-audit-20261028 -->
## Teilumsetzung und noch offener Featureumfang – 28.10.2026

Vorhanden: begrenzte Tages-Leistungsintegrale, Quellenabdeckung, Bezug/Export und Untersuchungsepisoden in Debug.DailySummary_JSON (lib/daily-summary.js/daily-episodes.js). Offen: belastbare Trennung nach tatsächlich nutzbarem Stellbudget und belegter Vermeidbarkeit; avoidableExportWh bleibt bewusst null ohne Nachweis. Keine pauschale vollständige Feature-Abnahme.

Abgleich mit main95fdc1e/alpha.161. Vorhandene Funktionen wiederverwenden, keine Doppelentwicklung. Dieser Statusabgleich ist kein Auftrag für eine neue Version oder zusätzliche SQL-Abrufe; Issue bleibt offen.

---

Ich möchte Netzabweichungen nach Dauer und Energie statt nur nach Spitzenhöhe bewerten können.

- Bezug/Einspeisung, Zielabweichung, Dauer, Spitzen und ausreichend belegte Energie ausweisen.
- Phasen mit tatsächlich verfügbarem Stellbudget getrennt von thermischen Grenzen, SoC-Enden, Schutzbegrenzungen und Gerätewartezeiten ausweisen.
- „Vermeidbar“ nur bei belegtem nutzbarem Budget; sonst Kandidat/unklar, keine erfundene Gegenfaktik.
- Datenabdeckung, Quellenversatz und Integrationsgrenzen nennen; keine präzisen Energien aus dünnen Änderungsreihen.

Anlass: beobachtete Rückspeisespitzen bis etwa 2 kW am 16.10.2026, Ursache noch offen. Abnahme: bekannte synthetische Verläufe und reale SQL-Ereignisse nachvollziehbar auswerten. Bezug #7, #154.

Als Featurewunsch am 16.10.2026 aufgenommen. Kein Auftrag zur sofortigen Implementierung oder Installation; aktuelle alpha.83 unverändert weiter beobachten.

