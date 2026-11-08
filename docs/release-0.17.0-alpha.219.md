# 0.17.0-alpha.219 – Weniger Rechenarbeit im Recorder

## Änderungen seit Alpha.213

| Version | Änderung |
| --- | --- |
| Alpha.213 | Geprüfte SQL-Viertelstunden können den Start beschleunigen. Ausgewählte Wallbox-Anzeigen werden bei Änderung veröffentlicht, und unverändertes Fahrplan-JSON wird wiederverwendet. [Historiencache und Grenzen](release-0.17.0-alpha.213.md) |
| Alpha.214–215 | Der Recorder verwendet bereits gemessene UTF‑8-Bytezahlen erneut und baut vollständige Snapshots erst für fällige Aufzeichnungen. Befehle und Schutzwechsel werden unmittelbar erfasst. |
| Alpha.216–218 | Der Recorder verwendet seinen Quellenindex und die Datenpunktzuordnung erneut. Indexierte Quellen nutzen ihre Aufzeichnungsregeln direkt. |
| Alpha.219 | Die Quellenprüfung verwendet unveränderte Zuordnungen erneut und vergleicht relevante Einstellungen direkt. Die Ersatzsuche verwendet die aus der Zuordnung gewonnenen IDs erneut. Änderungen an Geräte-IDs, Pumpenquellen und §14a-Zählern greifen bei der ersten Meldung. |

Der Vergleich in [PR #367](https://github.com/fuchs-1978/ioBroker.ems-optimizer/pull/367) enthält Regressionen für den Quellenwechsel sowie die Ersatzsuche. Aus 2.000 synthetischen Meldungen entstanden in beiden Versionen 369 bis auf die Versionskennung identische Datensätze. Bei jeweils 5.500 Meldungen pro Durchlauf sank die CPU-Zeit des getesteten Recorder-Pfads im Median von 692,4 auf 543,1 ms, rund 22 %. Der Test misst diesen Recorder-Pfad.

## Live-Stichprobe am 8. November 2026

Beide Fenster wurden nach dem Historienaufbau bei gültigem Fahrplan und ohne beobachtete Wallboxladung gemessen. CPU-Anteil eines Kerns ist die Zunahme der Prozess-CPU-Zeit geteilt durch die verstrichene Zeit.

| Laufende Version | Messdauer | Prozess-CPU-Zeit | Anteil eines Kerns |
| --- | ---: | ---: | ---: |
| Alpha.218 | 44,97 s | 15,41 s | 34,3 % |
| Alpha.219 | 45,03 s | 11,77 s | 26,1 % |

Bei Alpha.219 war der Historienaufbau um 22:50:52 Uhr MEZ abgeschlossen. Danach war der 48‑Stunden‑Fahrplan gültig und die Istwert-Ersatzregelung aus. Während der CPU-Messung bestätigte der Recorder 147 weitere Datensätze in SQL. Am Ende waren keine Bestätigungen offen. Diese Stichprobe belegt den Betrieb im gemessenen Zeitraum. Die CPU-Entlastung bei aktiver Ladung, ihre Dauerhaftigkeit und die historische SQL-Abdeckung bleiben offen.
