# Issue #161 – Feature: Historischer Versionsvergleich mit aufgezeichneten Eingangsdaten

Historischer Originalstand vor der Aufgabenbereinigung am 2026-11-03. Quelle: https://github.com/fuchs-1978/ioBroker.ems-optimizer/issues/161. Letzte Issue-Änderung: 2026-10-29T07:23:57Z. Dieser Snapshot ist ein Archiv, keine aktuelle Aufgabenliste. Aktueller Stand: [Roadmap #36](https://github.com/fuchs-1978/ioBroker.ems-optimizer/issues/36).

## Ursprünglicher Issue-Text

<!-- live-installation-audit-20261029 -->
## Aktueller Rest nach Installation – 29.10.2026

- [x] alpha.164 läuft (`System.Version`/`alive` direkt gelesen); Diagnose-States liefern aktuelle Werte. Installation ist nicht mehr offen.
- [ ] Erster realer geeigneter Quellenexport mit belegter Startkonfiguration bleibt offen. Der Offline-Codevergleich ist eingebaut und synthetisch geprüft, aber noch kein tatsächlicher historischer Eingangsfall vollständig durchgespielt.

Browserdarstellung und vollständige Anlagenabnahme werden nicht aus State-Texten abgeleitet. Softwarebelege in PR282; zentrale Restübersicht #36. Kein SQL-/Historienabruf oder Anlagenversuch. Frühere Installationsaussagen unten bleiben als datierter Entwicklungsstand erhalten.

---

<!-- operator-packages-164-20261029 -->
## Softwarefortschritt alpha.164 – 29.10.2026

Auf ausdrücklichen Nutzerauftrag mit [PR #282](https://github.com/fuchs-1978/ioBroker.ems-optimizer/pull/282) umgesetzt und nach acht grünen CI-Jobs nach main `b3aa288b14d6424b81e1af9bd9668e4c13c421ec` übernommen. Geprüfter/gemergter Baum `f7e38afb075dea6fd6e4743a0e245762e376dced`.

- [x] Allgemeines Offline-Werkzeug für zwei vertrauenswürdige lokale Engine-Versionen mit derselben dekodierten Originalquellenfolge und expliziten gemeinsamen Konfigurations-/Cache-/Plan-Eingängen.
- [x] Originale Empfangs-/Quellenzeiten, ACK/q/NULL, Sequenzen und Hashes erhalten. Lücken/fehlende Basen/widersprüchliche Duplikate verhindern geratenes Replay. Manifest-/Code-/Trace-Hashes und zeitliche Entscheidungsunterschiede ausgeben.
- [x] Engine-/Geräte-/SQL-/Timerzugriffe über den Auswertungssandbox-Vertrag getrennt; keine produktiven Schreibrechte. Synthetischer tatsächlicher Codevergleich163↔164 erfolgreich, kein neuer realer Historienabruf.
- [ ] Neuer realer Export mit belegter Startkonfiguration und vollständigem Quellenvertrag; Kaltstart-Grenzen beachten. Exakte laufende private Timerzustände und geschlossene Gegenfaktik-Anlagenmodelle werden ausdrücklich nicht rekonstruiert.

**Prüfung:**3314Unit-Tests,61offizielle Paket-/Schematests, installiertes Testtarball, historische Vergleiche und Node22/24/26 einschließlich frischem Controller-Integrationstest erfolgreich. [PR-CI](https://github.com/fuchs-1978/ioBroker.ems-optimizer/actions/runs/40828802101), [Branch-CI](https://github.com/fuchs-1978/ioBroker.ems-optimizer/actions/runs/40828796346).

[Umfang und Grenzen](https://github.com/fuchs-1978/ioBroker.ems-optimizer/blob/b3aa288b14d6424b81e1af9bd9668e4c13c421ec/docs/release-0.17.0-alpha.164.md). Keine neuen SQL-/Historienabrufe, Originalquellenprotokollierungen, Anlagenversuche oder produktiven Konfigurationsänderungen. GitHub-Release164 und tatsächliche Installation hier nicht durchgeführt. Das Issue bleibt wegen seiner genannten Restpunkte offen; ältere fehlende Implementierungsaussagen unten sind datierte Ausgangsstände.

---

<!-- issue-audit-20261028 -->
## Teilumsetzung und noch offener Featureumfang – 28.10.2026

Vorhanden: Decoder, begrenzter Originalreader und isolierte historische Vergleichswerkzeuge tools/compare-refactor.js sowie compare-wallbox-fixes.js. Offen: allgemeiner nachvollziehbarer Vergleich beliebiger vorgeschlagener Versionen gegen denselben validierten realen Ereignisdatensatz einschließlich Lücken-/Basis-/Konfigurations-/Gegenfaktikgrenzen. Bestehende Fixture-/Äquivalenztests erfüllen nicht automatisch den gesamten Featurewunsch.

Abgleich mit main95fdc1e/alpha.161. Vorhandene Funktionen wiederverwenden, keine Doppelentwicklung. Dieser Statusabgleich ist kein Auftrag für eine neue Version oder zusätzliche SQL-Abrufe; Issue bleibt offen.

---

Ich möchte vorgeschlagene Regeländerungen vor dem Liveversuch mit denselben historischen Eingangsereignissen gegen die bisherige Version vergleichen.

- Beide Versionen mit identischem validiertem Datensatz, Konfiguration und dokumentiertem Ausgangszustand ausführen; Version/Commit festhalten.
- Originale Quellenzeiten, Empfangszeiten, ACK/q, NULL, Sequenzlücken und Sitzungswechsel erhalten. Nicht rekonstruierbare Abschnitte unbekannt lassen.
- Entscheidungen, Budgets, Befehle, Timer und Grenzverhalten vergleichen; Unterschiede mit Ereigniszeit erklären.
- Tatsächliche historische Gerätereaktionen gelten nur für die damals ausgeführten Befehle. Gegenfaktische Reaktionen, Netzleistung und SoC ausdrücklich als Modellannahmen kennzeichnen; offener Replay und geschlossene Simulation getrennt bewerten.
- Ausschließlich isoliert ohne produktive Schreibrechte ausführen.

Abnahme: deterministische Wiederholung, erkennbare fehlende Basen/Lücken und nachvollziehbarer Versionsvergleich. Software-Replay ersetzt keine reale Abnahme. Vorhandene Replay-Werkzeuge zuerst prüfen und ergänzen, nicht doppelt entwickeln.

Bezug: #156, #157, #158.

Als Featurewunsch am 16.10.2026 aufgenommen. Keine sofortige Implementierung oder Installation beauftragt; alpha.83 unverändert weiter beobachten.

