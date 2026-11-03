# Issue #158 – Feature: Getrennte Qualitätsanzeigen für Recorder, SQL-Speicherung und Historienabruf

Historischer Originalstand vor der Aufgabenbereinigung am 2026-11-03. Quelle: https://github.com/fuchs-1978/ioBroker.ems-optimizer/issues/158. Letzte Issue-Änderung: 2026-10-29T07:23:53Z. Dieser Snapshot ist ein Archiv, keine aktuelle Aufgabenliste. Aktueller Stand: [Roadmap #36](https://github.com/fuchs-1978/ioBroker.ems-optimizer/issues/36).

## Ursprünglicher Issue-Text

<!-- live-installation-audit-20261029 -->
## Aktueller Rest nach Installation – 29.10.2026

- [x] alpha.164 läuft (`System.Version`/`alive` direkt gelesen); Diagnose-States liefern aktuelle Werte. Installation ist nicht mehr offen.
- [ ] Externer Berichtseingang und tatsächliche historische Abruf-/Decoder-/Sequenzabdeckung sind weiterhin nicht implementiert bzw. nicht nachgewiesen. Die korrekte Anzeige „nicht geprüft“ ist vorhanden.

Browserdarstellung und vollständige Anlagenabnahme werden nicht aus State-Texten abgeleitet. Softwarebelege in PR282; zentrale Restübersicht #36. Kein SQL-/Historienabruf oder Anlagenversuch. Frühere Installationsaussagen unten bleiben als datierter Entwicklungsstand erhalten.

---

<!-- alpha162-software-20261028 -->
## Software-Teilabschluss alpha.162 – 28.10.2026

- [x] Getrennte Recorder-/SQL-/externe Historienanzeige; Laufzeitverluste, Journalfüllung, unbestätigte Originale und deren älteste belegbare Originalzeit sichtbar.
- [x] Normaler in-flight Fence versus Blockade, frischer Originalnachweis und historische Fehler getrennt; Recovery-/Frische-/Zählergrenzen getestet.
- [x] Externe Historie ohne angebundenen Abrufprüfstand ausdrücklich nicht geprüft; Datum/Abdeckung/Decoder-/Sequenzlücken null statt erfunden.
- [x] Installation und aktuelle State-Datenlieferung bestätigt.
- [ ] Visuelle Anzeigeabnahme und externer Berichtseingang/tatsächliche Abrufabdeckung bleiben offen.

[PR280](https://github.com/fuchs-1978/ioBroker.ems-optimizer/pull/280) nach sechs grünen Node22/24/26-CI-Jobs in main784aa0e72651b8809f6c03863f889af358963a05 übernommen. Exakter getesteter/gemergter Baum ecc8d3fc9dc79c492a2bf3bab28ddfe0cf277aff;3290/3290 lokale Tests, Paket-/isoliert installiertes Tarball und historische Verhaltensvergleiche bestanden. [Verhalten und Grenzen](https://github.com/fuchs-1978/ioBroker.ems-optimizer/blob/784aa0e72651b8809f6c03863f889af358963a05/docs/release-0.17.0-alpha.162.md).

Neue Ansicht unter EMS-Übersicht / Diagnostics.* nutzt vorhandene5-s-Snapshots und Tagesaggregate. Keine zusätzlichen SQL-/Historienabfragen, Quellenabonnements oder Aktor-/Regeländerungen. Sieben lesende States, begrenzte Schreibpuffer/48000Byte Bericht; UI-Initialisierung hält die vorhandene Tagesabtastung nicht auf.

Keine Installation/visuelle reale Abnahme oder Scorepunkte durch diesen Softwareabschluss. Nach ausdrücklicher Nutzerfreigabe am28.10.2026 um20:58:12 MEZ als [GitHub-Prerelease v0.17.0-alpha.162](https://github.com/fuchs-1978/ioBroker.ems-optimizer/releases/tag/v0.17.0-alpha.162) veröffentlicht. Tag zeigt auf den geprüften main784aa0e72651b8809f6c03863f889af358963a05; [Releaseworkflow40758697795](https://github.com/fuchs-1978/ioBroker.ems-optimizer/actions/runs/40758697795) einschließlich Node22/24/26 und Publish erfolgreich. Die vorherige automatische Ablehnung ist damit nach neuer Freigabe erledigt. Keine Anlageninstallation oder npm-/Latest-/Stable-Veröffentlichung daraus. Bestehende ursprüngliche Anforderungen und Nachweisgrenzen bleiben erhalten; Issue bleibt offen.

---

<!-- issue-audit-20261028 -->
## Teilumsetzung und noch offener Featureumfang – 28.10.2026

Vorhanden: getrennte Recorder-, Journal-, SQL-Delivery-/Recoveryzustände einschließlich echter Speichernachweise und aktueller Rückstände. Offen: zusammengeführte verständliche Admin-Qualitätsanzeige und externe Abruf-/Decoder-/Ereigniszeitabdeckung mit ausdrücklich ungeprüftem Zustand. Laufzeitgesundheit allein bestätigt keine externe Tagesvollständigkeit.

Abgleich mit main95fdc1e/alpha.161. Vorhandene Funktionen wiederverwenden, keine Doppelentwicklung. Dieser Statusabgleich ist kein Auftrag für eine neue Version oder zusätzliche SQL-Abrufe; Issue bleibt offen.

---

Ich möchte im Admin sofort erkennen, ob Daten aufgezeichnet, unabhängig in SQL bestätigt und extern historisch vollständig abrufbar sind.

- Recorder: neue Verluste/Schreibfehler, Journalfüllung und ältestes unbestätigtes Ereignis.
- SQL: frischer exakter Speichernachweis, offene Bestätigungen, Blockade und Recovery.
- Auswertung: tatsächliche Ereigniszeitabdeckung, Decoder-/Sequenzlücken und letzter erfolgreicher Abruf. Ohne entsprechenden Prüflauf „nicht geprüft“ anzeigen.
- Kumulative Altfehler von aktuellen Störungen trennen; kleine laufende Warteschlangen nicht als Ausfall darstellen.
- Vorhandene Statusdaten verwenden, keine zusätzlichen belastenden Vollabrufe.

Abnahme: gesund, verzögert, blockiert, lückenhaft und ungeprüft unabhängig korrekt anzeigen. Ergänzung zu #26 und #154.

Als Featurewunsch am 16.10.2026 aufgenommen. Kein Auftrag zur sofortigen Implementierung oder Installation; aktuelle alpha.83 unverändert weiter beobachten.

