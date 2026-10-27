# 0.17.0-alpha.159 – Journal-Appendphasen unterscheiden

Die gesicherten Verlustgruppen vom 27.10.2026 in #274 belegen 53 Rohqueue-Abweisungen
bei Erreichen der unveränderten 8-MiB-Bytegrenze. Vorausgehende Append-Batches
benötigten bis 10,805 Sekunden; das Queuealter stieg auf über 21 Sekunden.
Die alte Diagnose unterscheidet nur `append-batch` und dessen Gesamtdauer.
Welcher Dateisystemschritt innerhalb dieses Auftrags wartete, ist damit offen.

Die neue passive Diagnose zeigt während eines aktiven Einzel-/Batch-Appends:

- `phase`: `write-files`, `link-files`, `commit-directory-sync`,
  `unlink-temporaries` oder `cleanup-directory-sync`;
- Startzeit und verstrichene Phasenzeit;
- während `write-files` getrennte Anzahlen aktuell wartender `open`-, `write`-,
  `sync`- und `close`-Operationen. Dies sind gleichzeitig laufende Operationen,
  keine isolierten CPU- oder Geräteausführungszeiten.

Abgeschlossene Batches enthalten dieselben fünf Phasenzeiten. Die begrenzten
Verlustgruppen erhalten die aktive Phase/Dateioperationen sowie die vorherigen
Batchzeiten. Alte Diagnosen bleiben ohne diese Felder lesbar; alte Ursachen
werden nicht nachträglich rekonstruiert. Es werden keine Dateipfade, Inhalte,
Quellenkennungen oder beliebige Eigenschaften in die Verlustmetadaten übernommen.
Die bestehende Vier-Gruppen-/8-KiB-Aufbewahrung und ihre expliziten
Verdrängungszähler bleiben unverändert.

Keine Dateioperation entfällt: pro Original bleiben File-Sync und sichere
Verlinkung erhalten, beide Directory-Sync-Barrieren stehen unverändert vor
der Registrierung als haltbarer Record. Datei-/SQL-Formate, Parallelität,
Rohqueue-, Batch- und Journalgrenzen, Retention und SQL-Originalnachweise werden
nicht erweitert. Es gibt keine zusätzlichen SQL-Abfragen oder Testwrites.

Sechs neue Offline-Gegenproben unterscheiden absichtlich verzögerte File-Syncs
für Einzel-/Batch-Appends sowie Link-, Commit-Sync-, Temp-Unlink- und
Cleanup-Sync-Phasen. Sie prüfen, dass zuvor kein Record als haltbar erscheint,
Snapshots den Zustand nicht verändern und Verlustmetadaten nach Neustart
erhalten bleiben. Alle sechs Diagnosekriterien fehlen vor der Änderung.

Die eigenständige SQL-Verzögerung aus #274 (später tatsächlicher Callback nach
bis 1.643,166 Sekunden Transportwartezeit) ist damit nicht behoben. Die gelesene
SQL-Adapterkonfiguration 4.2.1 verwendet `multiRequests=true`; die geprüfte
Primärquelle dispatcht dabei benutzerdefinierte SELECTs ohne die serielle
Taskqueue. Wartezeit im Verbindungspool, Treiber, Datenbank oder Rücktransport
ist damit nicht getrennt bewiesen. Es fehlen DB-Prozess-/Sperr-/Indexbelege.
Vier gelesene fremde `id not found`-Warnungen beweisen diese Ursache ebenfalls
nicht. Keine Änderung an SQL-Konfiguration, Verbindungen oder Timeouts.

Dies ist eine gezielte Diagnoseverbesserung, kein nachgewiesener Performancefix.
Nach manueller Installation ausschließlich neue natürliche Staus/Verluste prüfen;
keine Altfenster erneut laden, keine künstlichen Last-/Absturz-/Anlagenversuche.
