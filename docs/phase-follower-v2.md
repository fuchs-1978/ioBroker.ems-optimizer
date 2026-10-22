# Phasenfolger Revision 2

Diese Korrektur betrifft `examples/ems-phase-follow.js`. Ein Adapter-Update ersetzt das separat installierte JavaScript nicht; alpha.121 kann weiterverwendet werden.

Unveränderte Phasenziele werden vom EMS nicht laufend neu geschrieben. Revision 1 verwarf sie nach zehn Sekunden und konnte deshalb nach einem verzögerten EMS-Start sowie bei Wiederholungen hängen bleiben. Revision 2 akzeptiert weiterhin gültige, bestätigte Ziele unabhängig von ihrem Alter. Die Steuerfreigabe benötigt unverändert einen höchstens zehn Sekunden alten EMS-Heartbeat (Zeitstempel und Wert), gültige Steuerung, reale Ausgangsfreigabe, EMS-Phasenmodus und Wallbox-Verbindung.

## Bestehendes Skript aktualisieren

1. Das bestehende Skript `script.js.EMS.Phasenumschaltung_V1` stoppen.
2. Inhalt durch `examples/ems-phase-follow.js` ersetzen. Zuordnung `go-e.1`/`go-e.2` und EMS-Instanz beibehalten bzw. prüfen.
3. Im übernommenen Skript `ENABLED_AFTER_LOCAL_REVIEW = true` setzen.
4. Speichern und dasselbe Skript starten. Keine zweite Kopie parallel aktivieren.

Das Skript prüft alle fünf Sekunden. Bei abweichendem konfiguriertem Modus sendet es den Phasenbefehl; Wiederholungen erfolgen frühestens nach 60 Sekunden. Ein bereits bestätigter passender Modus erzeugt keinen weiteren Befehl. Nach 20 Sekunden wird die frische Modusbestätigung geprüft. Die elektrische Phasenbestätigung bleibt Aufgabe der EMS-Auswertung.

## Prüfung

`node --test test/phase-follow.test.js`: einschließlich verzögerter Startfreigabe bei unverändertem Ziel, ACK nach 20 Sekunden, Wiederholung nach 60 Sekunden, veraltetem Heartbeat, ungültigem Ziel, Master AUS und Verbindungsverlust.
