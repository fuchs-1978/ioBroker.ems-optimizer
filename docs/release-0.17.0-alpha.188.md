# 0.17.0-alpha.188 – getrennte Recorder-Schreibübergabe und SQL-Leseprüfung

Der Recorder veröffentlicht begrenzte Pakete über seinen bestehenden ioBroker-Datenpunkt. Der SQL-Adapter historisiert diese Werte. Eine eigene direkte SQL-Lesung weist anschließend anhand von Sitzung, Sequenz und exaktem Inhalts-Hash nach, welche Originale tatsächlich gespeichert wurden. Das sind zwei unterschiedliche Abschlüsse.

Bis alpha.187 hielt ein ungeklärter Lese-Timeout auch neue Veröffentlichungen an. Alpha.188 trennt diese Fehlerbremsen. Ein hängender Leser verhindert weitere Recorder-Prüfqueries; der Schreiber kann neue Originale im bisherigen begrenzten Takt weiter übergeben. Auch umgekehrt kann der Leser ältere Daten bestätigen, während eine neue Schreibübergabe wartet. Es werden keine zweite SQL-Instanz, neue Datenbankverbindung oder zusätzlichen Datenpunkte für dieselben Originale angelegt.

## Grenzen und Fehlerbehandlung

- Höchstens vier Paketübergaben je fünf Sekunden, 64 Originale und 512 KiB Transportdaten je Runde; die bestehenden kleineren Paketgrenzen gelten zusätzlich. Es entsteht keine unbegrenzte parallele Schreibqueue.
- Ein tatsächlicher Übergabefehler hat eine eigene begrenzte Wiederholungspause. Ist der Ausgang einer Schreibübergabe unbekannt, wird kein zweiter Auftrag darübergelegt. Eine verspätete erfolgreiche Übergabe ist weiterhin kein SQL-Nachweis.
- Beobachtete SQL-Schreib-/Ressourcenfehler bremsen weiterhin auch den Schreiber. Nach der Pause gilt der bisherige gedrosselte Betrieb bis zu einem frischen exakten SQL-Nachweis. Ein reiner Lese-Timeout versetzt den Schreiber nicht in diesen Fehlerbetrieb.
- Es bleibt höchstens eine offene Recorder-Prüfquery. Deren dauerhafte Sperre bleibt auch über Neustarts erhalten, bis der Backend-Abschluss unabhängig beobachtet wurde. Eine späte Antwort bestätigt ausschließlich ihre tatsächlich passenden Originale; sie beweist keine lückenlose neue Speicherung.
- Erst exakte unabhängige SQL-Treffer erlauben die normale lokale Bereinigung. Kompakte Checkpointketten bleiben bis zum Nachweis jedes Mitglieds zusammen; die jüngste laufende Basis bleibt erhalten.

## Keine Alterslöschung unbestätigter Originale

Unbestätigte lokale Originale bleiben seit alpha.188 auch nach 24 Stunden und über Neustarts erhalten. Die frühere Altersbereinigung wird nicht mehr ausgeführt. Ältere bereits begonnene Altersbereinigungsmarker dürfen noch vorhandene Originale bei einem Upgrade ebenfalls nicht löschen. Historische Verlustzähler bleiben sichtbar; schon früher entfernte Daten werden nicht rekonstruiert oder rückwirkend als gespeichert ausgegeben.

Die Kapazität bleibt endlich: 128 MiB und 65.536 Originale sowie begrenzte Aufnahmequeues. Bei vollem oder fehlerhaftem Speicher werden neue Aufzeichnungen sichtbar abgewiesen. Alte unbestätigte Originale werden dafür nicht verdrängt. Eine lange ausgefallene Leseprüfung kann den Puffer somit weiterhin füllen, auch wenn der Schreiber arbeitet.

## Diagnose

Alle folgenden Datenpunkte liegen unter `ems-optimizer.0.Debug.Shadow`:

| Datenpunkt | Bedeutung |
| --- | --- |
| `RecordWriterStatus` | Eigener Status (`ready`, `working`, `blocked`, `paused`, `throttled`, `capacity-limited`, `stopped`), Übergabe-/Fehler-/Timeoutzähler, letzte Operation mit Start, Abschluss und Dauer; eigene Fehlerbremse. |
| `RecordReaderStatus` | Eigener Status, Query-/Fehlerzahlen, aktive Anfrage, dauerhafte Sperre sowie letzte oder noch laufende Prüfung mit Zeitbezug und eigener Fehlerbremse. |
| `RecordDeliveryStatus` | Gemeinsamer begrenzter Überblick einschließlich beider Arbeitswege, offener Prüfzeitfenster und exakter SQL-Bestätigungen. |
| `RecordJournalStatus` | Unbestätigte lokale Originale, belegte Kapazität, Alter und historische Verlustnachweise; `maxAgeMs=null` und `retentionPolicy=confirmed-only; finite-capacity`. |
| `RecordSQLFailures_JSON` | Weiterhin begrenzter neustartfester Verlauf fehlgeschlagener Leseprüfungen und ihrer späteren Antworten. |

Die beiden neuen Statusobjekte werden höchstens einmal je Sekunde aktualisiert und erhalten keine automatische SQL-Historie. Eine Leser-Fehlerpause verbirgt die getrennte Schreiberdiagnose nicht. Die dauerhafte Query-Sperre und der bestehende Fehlerverlauf bleiben die Neustartnachweise; laufzeitbezogene Zähler beginnen mit dem EMS-Prozess neu.

`writer.completedWrites` zählt erfolgreiche Übergaben an die ioBroker-Zustandsdatenbank. Es misst weder einen MariaDB-Commit noch die interne Wartezeit des SQL-Adapters. Steigt dieser Zähler bei `reader.state=blocked`, arbeitet die Übergabe weiter, während der Speichernachweis wartet. Ob im SQL-Adapter intern eine Verbindung, Sperre oder Rücktransport wartet, muss weiterhin separat gemessen werden. Die bekannte Ursache in [#60](https://github.com/fuchs-1978/ioBroker.ems-optimizer/issues/60) ist mit dieser Entkopplung nicht als behoben erklärt.

## Prüfung und Nutzung

Regressionen prüfen beide Blockierungsrichtungen, verzögerte echte Antworten, unveränderte Query-/Paketgrenzen, unabhängige Ressourcenbremsen und exakte spätere Bereinigung. Reale Dateitests prüfen mehrtägige Aufbewahrung, Neustarts mit offener SQL-Sperre, volle Kapazität, Checkpointabhängigkeiten, beschädigte Dateien und die Übernahme älterer Altersbereinigungsmarker.

Der Nutzer installiert die versionierte GitHub-Fassung wie bisher selbst. Keine neue Admin-Einstellung erforderlich. Diese Änderung verlangt keinen SQL-Neustart; eine bereits verwaiste Anfrage behält ihren bestehenden gesonderten Wiederherstellungsvertrag. Steuerung, Aktorbefehle und Lasso-/Median-Vergleich bleiben unverändert.
