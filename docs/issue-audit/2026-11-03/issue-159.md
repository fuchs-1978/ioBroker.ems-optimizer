# Issue #159 – Feature: Gemessene Befehls- und Gerätereaktionszeiten je Aktor

Historischer Originalstand vor der Aufgabenbereinigung am 2026-11-03. Quelle: https://github.com/fuchs-1978/ioBroker.ems-optimizer/issues/159. Letzte Issue-Änderung: 2026-10-29T07:23:55Z. Dieser Snapshot ist ein Archiv, keine aktuelle Aufgabenliste. Aktueller Stand: [Roadmap #36](https://github.com/fuchs-1978/ioBroker.ems-optimizer/issues/36).

## Ursprünglicher Issue-Text

<!-- live-installation-audit-20261029 -->
## Aktueller Rest nach Installation – 29.10.2026

- [x] alpha.164 läuft (`System.Version`/`alive` direkt gelesen); Diagnose-States liefern aktuelle Werte. Installation ist nicht mehr offen.
- [ ] Natürliche Reaktionsmessreihen und belastbarer Stichprobenumfang bleiben offen; Testquantile sind keine Langzeitmessung.

Browserdarstellung und vollständige Anlagenabnahme werden nicht aus State-Texten abgeleitet. Softwarebelege in PR282; zentrale Restübersicht #36. Kein SQL-/Historienabruf oder Anlagenversuch. Frühere Installationsaussagen unten bleiben als datierter Entwicklungsstand erhalten.

---

<!-- operator-packages-164-20261029 -->
## Softwarefortschritt alpha.164 – 29.10.2026

Auf ausdrücklichen Nutzerauftrag mit [PR #282](https://github.com/fuchs-1978/ioBroker.ems-optimizer/pull/282) umgesetzt und nach acht grünen CI-Jobs nach main `b3aa288b14d6424b81e1af9bd9668e4c13c421ec` übernommen. Geprüfter/gemergter Baum `f7e38afb075dea6fd6e4743a0e245762e376dced`.

- [x] Bounded Reaktionsstatistik je Aktor/Art: bis64zuordenbare Werte, ACK und elektrische Beobachtung alsP50/P90, getrennt verfügbare Transportzeiten.
- [x] Wallboxen mit vorhandenem Response-Vertrag; Heizstab nur bei eindeutigem numerischem Treiber-ACK bzw. bestehendem qualifiziertem Nullschreibnachweis und unabhängiger Leistung. Überlappende gleiche Heizstabbefehle bleiben mehrdeutig. Fehlende Nachweise bleiben unbekannt.
- [ ] Natürliche Messreihen und Stichprobenumfang bewerten; Sitzungslokale Werte sind keine statistische Langzeitabsicherung. Keine Änderung von Schutz-/Timerfristen.

**Prüfung:**3314Unit-Tests,61offizielle Paket-/Schematests, installiertes Testtarball, historische Vergleiche und Node22/24/26 einschließlich frischem Controller-Integrationstest erfolgreich. [PR-CI](https://github.com/fuchs-1978/ioBroker.ems-optimizer/actions/runs/40828802101), [Branch-CI](https://github.com/fuchs-1978/ioBroker.ems-optimizer/actions/runs/40828796346).

[Umfang und Grenzen](https://github.com/fuchs-1978/ioBroker.ems-optimizer/blob/b3aa288b14d6424b81e1af9bd9668e4c13c421ec/docs/release-0.17.0-alpha.164.md). Keine neuen SQL-/Historienabrufe, Originalquellenprotokollierungen, Anlagenversuche oder produktiven Konfigurationsänderungen. GitHub-Release164 und tatsächliche Installation hier nicht durchgeführt. Das Issue bleibt wegen seiner genannten Restpunkte offen; ältere fehlende Implementierungsaussagen unten sind datierte Ausgangsstände.

---

Ich möchte typische und auffällige Zeiten zwischen Stellbefehl, Bestätigung und tatsächlicher elektrischer Reaktion pro Wallbox/Heizstab sehen.

- Transport-/ACK-Zeit und elektrische Reaktionszeit getrennt messen.
- Quellenzeit versus Empfangszeit, Pollauflösung, überholte Befehle und fehlende Reaktionen berücksichtigen.
- Stichprobenumfang, Quantile und Unsicherheit anzeigen; keine Messung aus bloßer Korrelation erfinden.
- Zunächst rein diagnostisch. Keine automatische Veränderung von Timern, Schutzfristen oder Toleranzen.

Abnahme: zuordenbare Befehlsfolgen korrekt messen, überlappende/unklare Fälle kennzeichnen. Vor späterem Reglertuning separaten Auftrag verlangen. Bezug #7, #8.

Als Featurewunsch am 16.10.2026 aufgenommen. Kein Auftrag zur sofortigen Implementierung oder Installation; aktuelle alpha.83 unverändert weiter beobachten.

