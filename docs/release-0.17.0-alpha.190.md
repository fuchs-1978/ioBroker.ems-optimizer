# 0.17.0-alpha.190 – SQL-Hostsperren und Verbindungsaufbaufehler

Die beobachtete Meldung `Host 'io.lan' is blocked ... ER_HOST_IS_BLOCKED ... 1129` und reine Meldungen `connect ETIMEDOUT` wurden von der bisherigen Ressourcenbremse nicht erkannt. Bereits vorhandene Meldungen wie `Cannot insert` lösten dagegen eine Pause aus. Eine fehlgeschlagene SQL-Metadatenabfrage ersetzte außerdem den konkreten Fehler durch eine allgemeine Meldung.

## Änderung

- Erkennung von Hostsperre (`ER_HOST_IS_BLOCKED`/1129), ausdrücklich fehlgeschlagenem Verbindungsaufbau (`connect ETIMEDOUT`) und abgelehntem Verbindungsaufbau (`connect ECONNREFUSED`). Strukturierte Timeout-/Refused-Fehler benötigen zusätzlich `syscall=connect`; ein beliebiger Query-Timeout mit `ETIMEDOUT` allein reicht nicht.
- Nur frische Warnungen/Fehler der konfigurierten SQL-Instanz oder tatsächlich beobachtete Fehler der Recorder-Abfrage aktivieren die jeweilige Bremse. Andere Instanzen, alte Meldungen und normale Statusmeldungen lösen sie nicht aus.
- Bei einem erkannten Datenbank-Verbindungsfehler pausieren die getrennten Lese- und Schreibabläufe ihren eigenen Recorderverkehr. Die bestehende Wiederholungspause beträgt 60, 120, 240 und höchstens 300 Sekunden. Fehlermeldungen innerhalb einer laufenden Pause verlängern diese nicht. Eine nachfolgende Hostsperre wird gegenüber dem früheren Timeout als genauerer Grund angezeigt.
- Nach der Pause gelten zunächst die vorhandenen gedrosselten Grenzen: höchstens ein Original pro Veröffentlichungsrunde, mindestens 30 Sekunden zwischen gedrosselten Veröffentlichungen beziehungsweise Prüfungen. Erst ein unabhängiger exakter SQL-Nachweis einer ausreichend frischen Veröffentlichung nach dem jüngsten beobachteten Fehler beendet den Fehlerbetrieb. Eine Übergabe an die ioBroker-Zustandsdatenbank ist kein MariaDB-Commit.
- Die Metadatenabfrage reicht ausschließlich eine erlaubte Fehlerkategorie weiter. `RecordSQLFailures_JSON` erhält bei entsprechenden Abfragefehlern optional `sqlErrorCode`. Diese Kategorie überlebt die bestehenden Checkpoints; Rohfehlermeldungen, SQL-Texte, Hostnamen und Zugangsdaten werden diesem Fehlerverlauf nicht hinzugefügt. Die Begrenzung auf 16 Einträge und 16 KiB bleibt bestehen, ältere Checkpoints ohne das Feld bleiben lesbar.
- `RecordWriterStatus`, `RecordReaderStatus`, die SQL-Diagnose und aktuelle Hinweise zeigen den kanonischen Grund und die Wiederholungspause. Ein historischer Fehlercode allein erzeugt nach erfolgreicher Wiederherstellung keine aktuelle Störung.

## Unveränderte Nachweise und Grenzen

Ein reiner lokaler Lese-Timeout hält neue begrenzte Schreibübergaben weiterhin nicht an. Er sperrt weitere Leseprüfungen, solange der Backend-Abschluss unbekannt ist. Auch ein abgelehntes Transport-Promise mit Verbindungsfehlercode darf eine offene, neustartfeste Prüfsperre nicht ohne tatsächlichen Abschlussnachweis freigeben. Eine echte späte SQL-Antwort kann dagegen den Abschluss belegen und ihren konkreten Fehlercode in der bisherigen Abfragehistorie ergänzen.

Die lokale Aufnahme läuft während einer Pause innerhalb der bestehenden endlichen Kapazität weiter. Unbestätigte Originale werden weder wegen ihres Alters noch durch eine bloße erfolgreiche Veröffentlichung gelöscht. Eine lange Störung kann den Speicher weiterhin füllen; alte Aufzeichnungsverluste werden nicht repariert.

Die Änderung betrifft den eigenen EMS-Recorderverkehr. Sie begrenzt nicht alle Verbindungen oder Historisierungsschreibvorgänge des SQL-Adapters und behebt keine QNAP-, Netzwerk- oder Datenbankursache. Sie entsperrt keinen Host automatisch und verändert weder Datenbankparameter noch den SQL-Adapter. Steuerung, Fahrzeugübergabe, Recordergrenzen und Prognosevergleich bleiben unverändert. Keine neue Einstellung oder automatische Installation erforderlich.

## Prüfung

Gezielte Tests prüfen reine und strukturierte Verbindungsfehler, numerischen Fehler 1129, Instanz-/Alters-/Schweregradfilter, Fehlerstürme ohne Fristverlängerung, Metadatenfehler ohne Folgeabfrage, begrenzte Wiederaufnahme, exakte Bereinigung und klare aktuelle Diagnose. Weitere Regressionen prüfen lokale Lese-Timeouts mit weiterarbeitendem Schreiber, unbekannte Backend-Abschlüsse, echte späte Antworten, spät abgelehnte Transportanfragen sowie kanonische Fehlercodes über Checkpoints. Rohdaten und beliebige Fehlercodes werden nicht als neue Diagnosemetadaten übernommen.

Die reale QNAP-Ursache bleibt in Issue #60 offen. Die ausführlichere Datenbankprotokollierung muss den nächsten natürlichen Ausfall erst erfassen; Softwaretests ersetzen diesen Anlagenbeleg nicht.
