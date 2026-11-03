# Issue #163 – Feature: PV-Prognose mit nachvollziehbarem Vertrauensbereich

Historischer Originalstand vor der Aufgabenbereinigung am 2026-11-03. Quelle: https://github.com/fuchs-1978/ioBroker.ems-optimizer/issues/163. Letzte Issue-Änderung: 2026-10-29T07:24:00Z. Dieser Snapshot ist ein Archiv, keine aktuelle Aufgabenliste. Aktueller Stand: [Roadmap #36](https://github.com/fuchs-1978/ioBroker.ems-optimizer/issues/36).

## Ursprünglicher Issue-Text

<!-- live-installation-audit-20261029 -->
## Aktueller Rest nach Installation – 29.10.2026

- [x] alpha.164 läuft (`System.Version`/`alive` direkt gelesen); Diagnose-States liefern aktuelle Werte. Installation ist nicht mehr offen.
- [ ] Ausreichende reale/saisonale Daten und echte Intervalltrefferquote bleiben offen. Sitzungslokale Softwarefunktion ist vorhanden, keine behauptete saisonale Genauigkeit.

Browserdarstellung und vollständige Anlagenabnahme werden nicht aus State-Texten abgeleitet. Softwarebelege in PR282; zentrale Restübersicht #36. Kein SQL-/Historienabruf oder Anlagenversuch. Frühere Installationsaussagen unten bleiben als datierter Entwicklungsstand erhalten.

---

<!-- operator-packages-164-20261029 -->
## Softwarefortschritt alpha.164 – 29.10.2026

Auf ausdrücklichen Nutzerauftrag mit [PR #282](https://github.com/fuchs-1978/ioBroker.ems-optimizer/pull/282) umgesetzt und nach acht grünen CI-Jobs nach main `b3aa288b14d6424b81e1af9bd9668e4c13c421ec` übernommen. Geprüfter/gemergter Baum `f7e38afb075dea6fd6e4743a0e245762e376dced`.

- [x] Lesende sitzungsbezogene empirische PV-Fehlerbereiche aus Prognosen VOR dem Zielslot und mindestens90% tatsächlich beobachteten Viertelstunden. Ab20Tageslicht-Slots empirische10/90%-Residuen; vorab festgelegte Intervalle separat auf Trefferquote prüfen.
- [x] Begrenzte Vorschau und sichtbare Datenmenge/Unbekannt-Zustände. Keine garantierte Wahrscheinlichkeit, zusätzliche PV-Reglerkorrektur oder SQL-Abfrage.
- [x] Ergänzend optionale aktuell gewichtete Hauslastprofile (28Tage Halbwertszeit, begrenzte Tagesenergieanpassung) und geglättete begrenzte kurzfristige Lastkorrektur-Vorschau. Alter Median bleibt Voreinstellung; keine produktive Einstellung geändert.
- [ ] Langfristige/saisonale Kalibrierung, echte Abdeckung und reale Anzeige prüfen; eine Sitzung ist kein vollständiger Prognosegütenachweis.

**Prüfung:**3314Unit-Tests,61offizielle Paket-/Schematests, installiertes Testtarball, historische Vergleiche und Node22/24/26 einschließlich frischem Controller-Integrationstest erfolgreich. [PR-CI](https://github.com/fuchs-1978/ioBroker.ems-optimizer/actions/runs/40828802101), [Branch-CI](https://github.com/fuchs-1978/ioBroker.ems-optimizer/actions/runs/40828796346).

[Umfang und Grenzen](https://github.com/fuchs-1978/ioBroker.ems-optimizer/blob/b3aa288b14d6424b81e1af9bd9668e4c13c421ec/docs/release-0.17.0-alpha.164.md). Keine neuen SQL-/Historienabrufe, Originalquellenprotokollierungen, Anlagenversuche oder produktiven Konfigurationsänderungen. GitHub-Release164 und tatsächliche Installation hier nicht durchgeführt. Das Issue bleibt wegen seiner genannten Restpunkte offen; ältere fehlende Implementierungsaussagen unten sind datierte Ausgangsstände.

---

Ich möchte neben dem PV-Erwartungswert einen vorsichtigen und optimistischen Verlauf sehen, damit Lade- und Wärmeziele robuster geplant werden können.

- Unsicherheitsbereiche anhand vorhandener Prognose-/Ist-Vergleiche kalibrieren; Datenmenge, saisonale Gültigkeit und tatsächliche Abdeckung ausweisen.
- Bei unzureichender Historie keine statistische Sicherheit behaupten; konservative Annahmen ausdrücklich benennen.
- Prognosealter, Ausfälle und Änderungen pro Lieferzeitpunkt berücksichtigen.
- Zunächst Anzeige und Planungsvorschau; spätere Nutzung im Regler separat prüfen. Reale Schutzgrenzen und aktuelle Netz-/PV-Messungen behalten Vorrang.
- Vorhandene Prognosekorrekturen und PV-Vergleichsskripte zuerst prüfen; keine doppelte Korrektur.

Abnahme: zeitlich saubere Auswertung ohne Zukunftswissen; gemessene Trefferquote der Intervalle mit Abdeckung darstellen, keine unbegründete Genauigkeitswerbung.

Bezug: #160 und bestehende Prognose-/Historienplanung.

Als Featurewunsch am 16.10.2026 aufgenommen. Keine sofortige Implementierung oder Installation beauftragt; alpha.83 unverändert weiter beobachten.

