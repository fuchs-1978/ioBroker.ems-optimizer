# Issue #164 – Feature: Machbarkeitsanzeige für Fahrzeug-SoC zum Abfahrtszeitpunkt

Historischer Originalstand vor der Aufgabenbereinigung am 2026-11-03. Quelle: https://github.com/fuchs-1978/ioBroker.ems-optimizer/issues/164. Letzte Issue-Änderung: 2026-10-29T07:24:02Z. Dieser Snapshot ist ein Archiv, keine aktuelle Aufgabenliste. Aktueller Stand: [Roadmap #36](https://github.com/fuchs-1978/ioBroker.ems-optimizer/issues/36).

## Ursprünglicher Issue-Text

<!-- live-installation-audit-20261029 -->
## Aktueller Rest nach Installation – 29.10.2026

- [x] alpha.164 läuft (`System.Version`/`alive` direkt gelesen); Diagnose-States liefern aktuelle Werte. Installation ist nicht mehr offen.
- [ ] Der reale Fall ohne aktive Abfahrtsfrist wird korrekt dargestellt. Aktive Abfahrts-/Mehrfahrzeugfälle und die verbleibende PV-/Netzanteilszuordnung sind noch nicht vollständig abgenommen.

Browserdarstellung und vollständige Anlagenabnahme werden nicht aus State-Texten abgeleitet. Softwarebelege in PR282; zentrale Restübersicht #36. Kein SQL-/Historienabruf oder Anlagenversuch. Frühere Installationsaussagen unten bleiben als datierter Entwicklungsstand erhalten.

---

<!-- operator-packages-164-20261029 -->
## Softwarefortschritt alpha.164 – 29.10.2026

Auf ausdrücklichen Nutzerauftrag mit [PR #282](https://github.com/fuchs-1978/ioBroker.ems-optimizer/pull/282) umgesetzt und nach acht grünen CI-Jobs nach main `b3aa288b14d6424b81e1af9bd9668e4c13c421ec` übernommen. Geprüfter/gemergter Baum `f7e38afb075dea6fd6e4743a0e245762e376dced`.

- [x] Lesende Machbarkeitsanzeige aus dem vorhandenen gemeinsamen Fahrplan: tatsächliche Abfahrtsfrist, SoC, Kapazität, AC-Verluste und bis Abfahrt zugeteilte Energie.
- [x] Erreicht / keine Frist / gesperrt / unbekannt / nominal unmöglich / im Plan gedeckt / Planlücke getrennt. Teilintervalle begrenzt, Überlappungen ungültig, keine doppelte Budgetvergabe und keine automatische Netzladefreigabe.
- [ ] Reale visuelle Anzeige und natürliche Ziel-/Mehrfahrzeugfälle abnehmen; Prognose ist keine Garantie.

**Prüfung:**3314Unit-Tests,61offizielle Paket-/Schematests, installiertes Testtarball, historische Vergleiche und Node22/24/26 einschließlich frischem Controller-Integrationstest erfolgreich. [PR-CI](https://github.com/fuchs-1978/ioBroker.ems-optimizer/actions/runs/40828802101), [Branch-CI](https://github.com/fuchs-1978/ioBroker.ems-optimizer/actions/runs/40828796346).

[Umfang und Grenzen](https://github.com/fuchs-1978/ioBroker.ems-optimizer/blob/b3aa288b14d6424b81e1af9bd9668e4c13c421ec/docs/release-0.17.0-alpha.164.md). Keine neuen SQL-/Historienabrufe, Originalquellenprotokollierungen, Anlagenversuche oder produktiven Konfigurationsänderungen. GitHub-Release164 und tatsächliche Installation hier nicht durchgeführt. Das Issue bleibt wegen seiner genannten Restpunkte offen; ältere fehlende Implementierungsaussagen unten sind datierte Ausgangsstände.

---

Ich möchte je Fahrzeug erkennen, ob mein Ziel-SoC bis zur eingestellten Abfahrt voraussichtlich erreichbar ist und wie viel Energie beziehungsweise Netzladung dafür noch benötigt wird.

- SoC-Quelle und Qualität, nutzbare Kapazität, Ladeverluste, Fahrzeug-/Phasengrenzen, Freigaben und konkurrierende Ladeziele berücksichtigen.
- Erwartete PV, Unsicherheit und gegebenenfalls Preisfenster einbeziehen; Prognose von garantiertem Ergebnis trennen.
- Zielkonflikte verständlich erklären, z. B. fehlende Freigabe oder zu wenig verbleibende Ladezeit.
- Ohne Abfahrtszeit keine fiktive Frist annehmen. Keine Netzladung allein durch Anzeige aktivieren.
- Bestehende Abfahrts-/Mehrfahrzeugplanung um Erklärung und Machbarkeit ergänzen, nicht doppelt implementieren.

Abnahme: erreichbare, unerreichbare und wegen fehlender Daten unbekannte Ziele korrekt unterscheiden; Mehrfahrzeugbudgets nicht mehrfach vergeben.

Bezug: #155, #59 und vorhandene Ladeplanung.

Als Featurewunsch am 16.10.2026 aufgenommen. Keine sofortige Implementierung oder Installation beauftragt; alpha.83 unverändert weiter beobachten.

