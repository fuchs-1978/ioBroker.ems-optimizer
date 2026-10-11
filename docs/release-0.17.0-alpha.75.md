# 0.17.0-alpha.75 – SQL-Diagnoseverkehr bei Datenbankfehlern begrenzen

Am 11.10.2026 um 06:48 MESZ meldete der SQL-Adapter bei EMS-, KNX- und PV-Historien Betriebssystemfehler 24 (zu viele offene Dateien). Die Installation meldete alpha.74; der lokale Recorder-Puffer war nahezu 128 MiB voll. Das ist kein Nachweis einer fehlerhaften Gerätesteuerung und kein durch diese Version behobenes QNAP-Dateilimit.

## Änderung

- Frische Warn-/Fehlerlogs ausschließlich der konfigurierten sql.N-Instanz erkennen Schreib-/Bereinigungsfehler. Nur eine begrenzte Fehlerkategorie wird gehalten, keine SQL-Rohdaten oder Logarchive. Log-Empfang wird beim Beenden abgemeldet.
- Diagnose-Nachlieferung und unabhängige SQL-Prüfung warten nach Fehlern zunächst 60 Sekunden, bei erneuten Fehlern 120, 240 und höchstens 300 Sekunden. Eine laufende Fehlerflut verlängert eine bereits aktive Pause nicht. Ungeklärte Backend-Abschlüsse bleiben unabhängig davon gesperrt.
- Reguläre Nachlieferung maximal vier Records/512 KiB pro fünf Sekunden, höchstens eine sequenzielle SQL-Prüfung pro Durchlauf. Im gestörten Wiederanlauf maximal ein Record pro 30 Sekunden und eine begrenzte Prüfung; keine erhöhte Abfrageparallelität.
- Schatten-Skalarzyklen und direkte Schatten-Diagnosewerte im Fehlerzustand höchstens alle 30 Sekunden veröffentlichen. Übersprungene Skalarzyklen werden gezählt. Modellberechnung, rohe Ereignisaufzeichnung soweit lokaler Platz vorhanden und produktive Stellregler bleiben unverändert. Die Drosselung betrifft nicht sämtliche produktiven Debug-/Control-States oder fremde SQL-Quellen.
- Wiederherstellung erst durch unabhängigen exakten SQL-Historiennachweis eines seit dem Fehler neu gespeicherten Records (höchstens 60 Sekunden alt), nicht allein durch Verbindung, Transportcallback oder alte gespeicherte Daten. Wartephase sichtbar in RecordSQLLastError als JSON mit error/backoff.

## Grenzen und nächste Prüfung

Keine SQL-Konfiguration, Retention, QNAP-Limits oder Aktoren ändern. Keine Installation. Lokale 24-h-Gruppenalterung und explizite Datenverluste bleiben erhalten. Eine bereits volle Aufzeichnung kann weiterhin Lücken haben. Die globale Datenbankstörung und SQL-Verkehr anderer Adapter werden hierdurch nicht behoben. Prüfen: Fehlererkennung/retryAt, deutlich begrenzte eigene Nachlieferung, Originalerhalt, frische unabhängige Speicherbestätigung, RecordDropped und reale SQL-Schreibfehler. Tests ersetzen keine reale SQL- oder Wochenabnahme.
