# 0.17.0-alpha.73

## Problem und Verhalten

Ein voller lokaler 128-MiB-Diagnosepuffer konnte mit dauerhaft unbestätigten alten Originalsätzen blockiert bleiben. Alpha.72 begrenzt bereits die neuen Schreibversuche. Alpha.73 ergänzt eine lokale Aufbewahrungsfrist von 24 Stunden ab Speicherung (nach Neustart unveränderte Dateizeit). Es wird nicht behauptet, dass fehlende Daten in SQL stehen.

Die Wartung entfernt höchstens eine alte abgeschlossene beziehungsweise aus einem früheren Prozess wiederhergestellte Kette pro Minute. Alle Mitglieder müssen alt sein. Laufende Delta-Basen bleiben erhalten. Vor dem ersten Löschen werden ein geprüfter Wiederanlaufmarker und der Verlustnachweis dauerhaft geschrieben. Nach einem unterbrochenen Löschvorgang setzt der Neustart die vollständige Kettenbereinigung fort, ohne Verluste nochmals zu zählen. Beschädigte Originalsätze bleiben zur Diagnose erhalten.

## Diagnose und Grenzen

- `Debug.Shadow.RecordJournalOldestAge_s`: Alter des ältesten verbliebenen Originals, null bei leerem Puffer.
- `RecordJournalExpired`: kumulativ altersbedingt entfernte lokale Records, kein SQL-Erfolgszähler.
- `RecordJournalLastExpiry`: letzter Bereinigungsabschnitt mit Session, Sequenz-/Ereignisgrenzen und unbekanntem SQL-Anteil.
- `RecordJournalStatus`: zusätzlich Frist, bestätigter/unbestätigter Bestand, kumulativer unbestätigt entfernter Anteil.

Die letzte Abschnittsmarkierung ist begrenzt, kein vollständiger historischer Verlustexport. Frühere Abschnitte bleiben im kumulativen Zähler enthalten. Bei älteren Records ohne Ereigniszeit bleiben Zeitgrenzen null. Die 24 Stunden sind eine Zulässigkeitsfrist; ein großer Rückstand wird schrittweise abgebaut. Eine aktuelle große Kette oder beschädigte Dateien können weiterhin Platz blockieren. SQL-Aufbewahrung, SQL-Konfiguration, Gerätefreigaben und Reglerlogik werden nicht geändert. Eine unbekannt abgeschlossene SQL-Anfrage wird durch Bereinigung nicht entsperrt. Kein automatisches Installieren oder Aktivieren.

## Prüfung

Regressionen prüfen Fristgrenze, vollständige Ketten, aktuelle Basen, Neustart, SQL-Sperrerhalt, persistente Verlustmarkierung vor Löschung und Wiederanlauf nach Datei-/Metadatenfehlern. Softwaretests ersetzen keinen realen Nachweis sinkender Puffergröße/RAM-Nutzung oder vollständiger Tageshistorie.
