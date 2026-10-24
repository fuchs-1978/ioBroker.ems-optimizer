# 0.17.0-alpha.133 – gezielte Untersuchungsfenster

`Debug.DailySummary_JSON` ergänzt `current`/`previous` um `investigation` und `investigationWindows`. Der bestehende Tagesrahmen, die Summen und die reine passive Diagnose bleiben erhalten. Keine SQL-Abfragen oder Aktor-/Regeländerungen im Adapter.

Diagnosekriterien (keine Schutzgrenzen):

| Typ | Kriterium | Mindestdauer |
| --- | --- | --- |
| `export` | NVP kleiner als −200 W | 60 s |
| `deviation` | Betrag der Abweichung zum damals gültigen `Control.TargetGridPower_W` größer als 500 W | 60 s |
| `source-gap` | benötigte Messquelle eines Intervalls ungültig/unbekannt | 30 s |
| `sampling-gap` | Beobachtungsunterbrechung über 10 s / fehlende Zeit nach Neustart | 10 s |

Die Bewertung nutzt gültige Intervallenden und maximal 10 s Intervalllänge. Nur konfigurierte Quellen werden auf Quellenlücken geprüft (NVP immer). Quellenlücken kennzeichnen unsichere Intervallränder, keinen bewiesenen vollständigen Geräteausfall oder SQL-Verlust. Kurze Ereignisse zwischen Proben bleiben möglich. Fehlender Sollwert verhindert die Abweichungsdiagnose; er wird nicht als null angenommen. Ein Sollwertwechsel unterbricht den Abweichungsabschnitt.

Jedes qualifizierte Fenster enthält Typ/Quelle, `from`, `to`, Dauer, Peak mit `peakAt`, mittlere Größenordnung, geschätzte Größenordnung in Wh (nur Leistungsabschnitte) und Betriebszustände an Beginn/Ende: Master, Auswahl, Betreiberlimitstatus, WB-Leistungen/Phasen/Phasenwechsel und EHZ-Leistung. `endReason` unterscheidet beendet, laufend, Quellen-/Beobachtungsunterbrechung, Neustart und Periodengrenze. Die Energie der Sollabweichung ist ein Diagnoseintegral, keine Einsparung. Einspeisung beweist keine freie Aufnahmefähigkeit und keine Vermeidbarkeit.

`investigateFrom/To` beschreibt den vollständigen Abschnitt mit maximal 60 s Kontext an beiden Seiten. **Nicht ungeprüft vollständig abrufen:** `suggestedFrom/To` begrenzt den ersten SQL-Abruf auf maximal zwei Minuten um den größten beobachteten Ausschlag, bei Lücken um deren Ende. Periodengrenzen und `observedUntil` begrenzen die Fenster; noch nicht beobachteter Nachlauf wird nicht erfunden. Der 20-Uhr-Lauf wählt höchstens zwei relevante, deduplizierte/überlappungsbereinigte kleine Fenster innerhalb seines bestehenden Zeit- und SQL-Budgets. Lange Abschnitte bleiben durch den Ausschnitt nur teilweise untersucht.

Maximal 24 abgeschlossene Abschnitte je Periode, bevorzugt größere Leistungsabweichungen, danach längere Lücken. `overflow` nennt verworfene Abschnitte; aktive Kandidaten sind separat begrenzt. Der bestehende 64-kB-Rahmen gilt weiterhin; bei Platzbedarf werden zuerst Ereignisdetails, dann schwächere abgeschlossene Abschnitte entfernt und gezählt. Die Tagesbilanz ist daher kein vollständiges Ereignisarchiv.

Aktive Abschnitte werden gespeichert, beim Neustart jedoch am letzten beobachteten Ende geschlossen. Unbeobachtete Zeit wird nicht angeschlossen. Alte alpha.132-Summen bleiben erhalten, aber `availableFrom` kennzeichnet den Beginn der neuen Abschnittserfassung; keine rückwirkenden Auffälligkeiten erfinden. Der erste leere Zustand beim Erststart wird ohne JSON-Fehlwarnung akzeptiert.

Tests prüfen kurze Spitzen, Diagnosegrenzen, Zeit-/Größenangaben, fehlenden Sollwert, Quellenlücken, unbekannte Unterbrechungen, Neustart, Tagesgrenze, Migration, begrenzte Spitzenfenster und Überlauf. Reale Betriebsabnahme folgt erst nach Installation.
