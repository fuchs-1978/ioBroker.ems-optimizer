# Issue #162 – Feature: Verständlicher persönlicher EMS-Tagesrückblick

Historischer Originalstand vor der Aufgabenbereinigung am 2026-11-03. Quelle: https://github.com/fuchs-1978/ioBroker.ems-optimizer/issues/162. Letzte Issue-Änderung: 2026-10-29T07:23:58Z. Dieser Snapshot ist ein Archiv, keine aktuelle Aufgabenliste. Aktueller Stand: [Roadmap #36](https://github.com/fuchs-1978/ioBroker.ems-optimizer/issues/36).

## Ursprünglicher Issue-Text

<!-- live-installation-audit-20261029 -->
## Aktueller Rest nach Installation – 29.10.2026

- [x] alpha.164 läuft (`System.Version`/`alive` direkt gelesen); Diagnose-States liefern aktuelle Werte. Installation ist nicht mehr offen.
- [ ] Laufende und vorherige Tages-State-Texte wurden real gelesen; historische Zielerreichung und Kosten bleiben dort ausdrücklich unbekannt. Vollständige historische Ziel-/Engpassbelege und visuelle Darstellung bleiben offen.

Browserdarstellung und vollständige Anlagenabnahme werden nicht aus State-Texten abgeleitet. Softwarebelege in PR282; zentrale Restübersicht #36. Kein SQL-/Historienabruf oder Anlagenversuch. Frühere Installationsaussagen unten bleiben als datierter Entwicklungsstand erhalten.

---

<!-- alpha162-software-20261028 -->
## Software-Teilabschluss alpha.162 – 28.10.2026

- [x] Verständlicher deutscher laufender/vorheriger Tagesrückblick aus bestehenden Aggregaten in Admin und lesenden States.
- [x] Berlin20-Uhr-Perioden, begrenzte Leistungsintegrale, elektrische EHZ-Energie, Quellenabdeckung und vergangene unbekannte versus künftige Zeit getrennt; Beobachtungen/Verdrängung sichtbar.
- [x] Historische Zielerreichung und Kosten/Ersparnis ohne passende Belegketten ausdrücklich unbekannt, keine erfundene Erfolgs-/Einsparbilanz.
- [x] Installation und laufende/vorherige Tages-State-Texte real bestätigt.
- [ ] Visuelle Anzeige und vollständige historische Ziel-/Engpass-/Kostenbelege bleiben ohne Datengrundlage offen.

[PR280](https://github.com/fuchs-1978/ioBroker.ems-optimizer/pull/280) nach sechs grünen Node22/24/26-CI-Jobs in main784aa0e72651b8809f6c03863f889af358963a05 übernommen. Exakter getesteter/gemergter Baum ecc8d3fc9dc79c492a2bf3bab28ddfe0cf277aff;3290/3290 lokale Tests, Paket-/isoliert installiertes Tarball und historische Verhaltensvergleiche bestanden. [Verhalten und Grenzen](https://github.com/fuchs-1978/ioBroker.ems-optimizer/blob/784aa0e72651b8809f6c03863f889af358963a05/docs/release-0.17.0-alpha.162.md).

Neue Ansicht unter EMS-Übersicht / Diagnostics.* nutzt vorhandene5-s-Snapshots und Tagesaggregate. Keine zusätzlichen SQL-/Historienabfragen, Quellenabonnements oder Aktor-/Regeländerungen. Sieben lesende States, begrenzte Schreibpuffer/48000Byte Bericht; UI-Initialisierung hält die vorhandene Tagesabtastung nicht auf.

Keine Installation/visuelle reale Abnahme oder Scorepunkte durch diesen Softwareabschluss. Nach ausdrücklicher Nutzerfreigabe am28.10.2026 um20:58:12 MEZ als [GitHub-Prerelease v0.17.0-alpha.162](https://github.com/fuchs-1978/ioBroker.ems-optimizer/releases/tag/v0.17.0-alpha.162) veröffentlicht. Tag zeigt auf den geprüften main784aa0e72651b8809f6c03863f889af358963a05; [Releaseworkflow40758697795](https://github.com/fuchs-1978/ioBroker.ems-optimizer/actions/runs/40758697795) einschließlich Node22/24/26 und Publish erfolgreich. Die vorherige automatische Ablehnung ist damit nach neuer Freigabe erledigt. Keine Anlageninstallation oder npm-/Latest-/Stable-Veröffentlichung daraus. Bestehende ursprüngliche Anforderungen und Nachweisgrenzen bleiben erhalten; Issue bleibt offen.

---

<!-- issue-audit-20261028 -->
## Teilumsetzung und noch offener Featureumfang – 28.10.2026

Vorhanden: passive Tagesaggregate in Debug.DailySummary_JSON und externe SQL-Tagesberichte, zuletzt #278. Offen: integrierter verständlicher deutschsprachiger Rückblick mit belegter Zielerreichung/Engpässen und gegebenenfalls belastbarer Kostenvergleichsbasis. Die Datenbasis ist teilweise umgesetzt, die gewünschte Nutzerfunktion nicht vollständig abgenommen.

Abgleich mit main95fdc1e/alpha.161. Vorhandene Funktionen wiederverwenden, keine Doppelentwicklung. Dieser Statusabgleich ist kein Auftrag für eine neue Version oder zusätzliche SQL-Abrufe; Issue bleibt offen.

---

Ich möchte einen kompakten deutschsprachigen Tagesrückblick mit belegtem Nutzen und relevanten Auffälligkeiten sehen: geladene Fahrzeuge, bereitgestellte elektrische Heizenergie, Zielerreichung und Engpässe.

- Belegte Energie, Ladeziele und Ereignisse verständlich zusammenfassen; elektrische Energie von thermischer Energie unterscheiden.
- Datenzeitraum, Abdeckung und Unsicherheit nennen; fehlende Daten nicht als Null oder Erfolg behandeln.
- Kosten und Ersparnisse nur mit passenden Preis-/Energiedaten und offengelegter Vergleichsbasis berechnen. Keine erfundene Ersparnis gegenüber einem unbekannten Alternativbetrieb.
- Im Admin/als States bereitstellen; optionale Benachrichtigung nur konfiguriert und mit vorhandenen Schnittstellen.
- Vorhandenen SQL-Tagesbericht und vorhandene Summen ergänzen, nicht widersprüchlich duplizieren.

Abnahme: nachvollziehbare Zuordnung jeder Kennzahl und korrekte Darstellung unvollständiger Tage.

Bezug: #156, #157, #158.

Als Featurewunsch am 16.10.2026 aufgenommen. Keine sofortige Implementierung oder Installation beauftragt; alpha.83 unverändert weiter beobachten.

