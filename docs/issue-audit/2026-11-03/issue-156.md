# Issue #156 – Feature: Automatische ereignisbezogene Bewertung von Ladeende und Übergängen

Historischer Originalstand vor der Aufgabenbereinigung am 2026-11-03. Quelle: https://github.com/fuchs-1978/ioBroker.ems-optimizer/issues/156. Letzte Issue-Änderung: 2026-10-29T07:23:49Z. Dieser Snapshot ist ein Archiv, keine aktuelle Aufgabenliste. Aktueller Stand: [Roadmap #36](https://github.com/fuchs-1978/ioBroker.ems-optimizer/issues/36).

## Ursprünglicher Issue-Text

<!-- live-installation-audit-20261029 -->
## Aktueller Rest nach Installation – 29.10.2026

- [x] alpha.164 läuft (`System.Version`/`alive` direkt gelesen); Diagnose-States liefern aktuelle Werte. Installation ist nicht mehr offen.
- [ ] Natürliche vollständige Übergangs- und Fehlerketten unter164 bleiben offen; aktueller Datenfluss ersetzt diese Abnahme nicht.

Browserdarstellung und vollständige Anlagenabnahme werden nicht aus State-Texten abgeleitet. Softwarebelege in PR282; zentrale Restübersicht #36. Kein SQL-/Historienabruf oder Anlagenversuch. Frühere Installationsaussagen unten bleiben als datierter Entwicklungsstand erhalten.

---

<!-- operator-packages-164-20261029 -->
## Softwarefortschritt alpha.164 – 29.10.2026

Auf ausdrücklichen Nutzerauftrag mit [PR #282](https://github.com/fuchs-1978/ioBroker.ems-optimizer/pull/282) umgesetzt und nach acht grünen CI-Jobs nach main `b3aa288b14d6424b81e1af9bd9668e4c13c421ec` übernommen. Geprüfter/gemergter Baum `f7e38afb075dea6fd6e4743a0e245762e376dced`.

- [x] Automatische begrenzte Auswertung bestehender5-s-Snapshots für Stromantwort, Phasenwechsel, Ziel-/sonstige Stopps und Übergaben implementiert.
- [x] Unabhängige ACK-/elektrische Quellen, beobachtete Umschaltpause, Donor-Ruhe/Reservefreigabe und spätere Empfängeraufnahme unterscheiden. Lücken, überschreibende Befehle und unvollständige Ketten bleiben unbekannt.
- [ ] Natürliche positive und fehlerhafte/lückenhafte Fälle unter dieser Version abnehmen. Stichprobenauswertung ist kein lückenloser Originalereignisprüfstand und keine automatische Anlagenfreigabe.

**Prüfung:**3314Unit-Tests,61offizielle Paket-/Schematests, installiertes Testtarball, historische Vergleiche und Node22/24/26 einschließlich frischem Controller-Integrationstest erfolgreich. [PR-CI](https://github.com/fuchs-1978/ioBroker.ems-optimizer/actions/runs/40828802101), [Branch-CI](https://github.com/fuchs-1978/ioBroker.ems-optimizer/actions/runs/40828796346).

[Umfang und Grenzen](https://github.com/fuchs-1978/ioBroker.ems-optimizer/blob/b3aa288b14d6424b81e1af9bd9668e4c13c421ec/docs/release-0.17.0-alpha.164.md). Keine neuen SQL-/Historienabrufe, Originalquellenprotokollierungen, Anlagenversuche oder produktiven Konfigurationsänderungen. GitHub-Release164 und tatsächliche Installation hier nicht durchgeführt. Das Issue bleibt wegen seiner genannten Restpunkte offen; ältere fehlende Implementierungsaussagen unten sind datierte Ausgangsstände.

---

Ich möchte nach Ziel-SoC-Ende, Fahrzeugübergabe und Phasenwechsel eine automatische Bewertung der beobachteten Ereigniskette erhalten: erfolgreich, auffällig oder nicht ausreichend belegt.

- Entscheidung, Befehl, unabhängige ACKs und elektrische Antwort mit tatsächlichen Fristen zusammenführen.
- Normales Ladeende von interner Unterbrechung unterscheiden.
- Fehlende Daten, Neustarts und unzureichende Auflösung als unbekannt behandeln.
- Ergebnisse mit Ereigniszeiten und Begründung bereitstellen; keine automatische Abnahmefreigabe oder Stellaktion.

Abnahme: positive, fehlerhafte und lückenhafte Ketten korrekt klassifizieren, ohne fehlende Reaktion als Erfolg zu werten. Ergänzung zu #7, #8 und #57.

Als Featurewunsch am 16.10.2026 aufgenommen. Kein Auftrag zur sofortigen Implementierung oder Installation; aktuelle alpha.83 unverändert weiter beobachten.

