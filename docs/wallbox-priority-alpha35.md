# Manuelle Fahrzeugauswahl ab 0.17.0-alpha.35

Carsten verwendet `javascript.0.ev.prio`, um die Ladung bei Bedarf gezielt zwischen den Fahrzeugen zu wechseln. Bisher konnte die Bindung an eine bereits aktive EMS-Wallbox eine gültige neue Priorität verdrängen. So blieb im Schatten der EQE ausgewählt, obwohl der Bestand bereits den Mii lud.

## Auswahl

| Wert der aktiven Prioritätsquelle | Bedeutung |
| --- | --- |
| `0` | Mii / WB0 bevorzugen |
| `1` | EQV / WB1 bevorzugen |
| `2` | EQE / WB2 bevorzugen |
| `-1` oder externer `-2` | Keine manuelle Fahrzeugwahl; automatische Auswahl |
| Fehlend, leer, boolesch, gebrochen, außerhalb des Bereichs oder fehlerhafte Quellenqualität | Keine gültige manuelle Fahrzeugwahl; niemals als WB0 interpretieren |

Die Quelle wird weiterhin mit der bestehenden Admin-Einstellung gewählt. Bei Quelle **automatisch** und internem Auswahlwert `-2` liest der Adapter das konfigurierte externe Prioritätsobjekt. Eine Benutzeranweisung darf `ack = false` haben; das ist keine fehlende Aktorbestätigung. Ein unveränderter alter Zeitstempel allein macht eine dauerhafte Benutzerpriorität nicht ungültig.

Eine gültige manuelle Wahl steht vor einem laufenden Ladeauftrag, dessen Mindestlaufzeit und der automatischen Mindest-SoC-/Abfahrtsreihenfolge. Das bevorzugte Fahrzeug muss vorhanden, angeschlossen und freigegeben sein und die bestehenden Fahrzeug-/Phasenprüfungen bestehen. Ziel-SoC, Benutzerfreigabe, gültige Quellen, verfügbare Leistung, Preisfreigabe und elektrische Sicherheitsgrenzen bleiben wirksam. Eine Priorität erzeugt weder Strom noch eine neue Erlaubnis zur Netzladung.

Ohne manuelle Wahl bleibt die automatische Auswahl ruhig. Eine einmal begonnene manuelle Übergabe bleibt innerhalb der laufenden Adapter-Sitzung für eine begrenzte Frist vorbereitet, wenn die Priorität zwischenzeitlich auf neutral gesetzt wird. Die Frist berücksichtigt Startverzögerung und Rückmeldezeiten und beträgt höchstens zehn Minuten. Eine neue gültige Wahl ersetzt das Übergabeziel; ist das neue Fahrzeug nicht ladeberechtigt, wird das alte Übergabeziel verworfen. Bei Entzug der Freigabe, Verlust der Eignung oder Fristende verfällt die Vorbereitung. Diese Bindung wird nicht über Adapterneustarts gespeichert.

## Bestätigte Übergabe

1. Die Auswahl wechselt auf das gültige bevorzugte Fahrzeug. Die bisherige Wallbox erhält AUS, auch während ihrer weichen Mindestlaufzeit.
2. Die bisherige Wallbox bleibt verriegelt und ihr Leistungsbedarf reserviert, bis frisches `allow_charging = 0` sowie Leistung bis 20 W und Phasenströme bis 0,5 A ihre elektrische Abschaltung bestätigen.
3. Die neue Wallbox durchläuft ihre normale Budgetqualifikation, Einschaltverzögerung und 6-A-Startsequenz. Ein noch offener AUS-Vorgang sperrt ihre Einschaltfreigabe.
4. Erst nach bestätigter Übernahme ist die Übergabe beendet. Bei unveränderter gültiger manueller Auswahl wird das alte Fahrzeug nicht automatisch wieder vorgeschoben.

Das ist weiterhin Betrieb mit einer aktiven Wallbox. Eine Pause zwischen den Fahrzeugen kann wegen der konfigurierten Einschaltverzögerung und der Modbus-/Fahrzeugreaktion entstehen. Gleichzeitiges Zuschalten beider Fahrzeuge wird nicht eingeführt.

## Nachweis und Grenzen

`Control.WallboxSelectionReason` zeigt, ob die manuelle Wahl, eine laufende manuelle Übergabe oder die automatische Auswahl maßgeblich war. Das Schatten-DecisionRecord speichert dieselbe Erklärung als `selectionReason`; Änderungen werden als Ereignis erfasst, auch wenn die ausgewählte Nummer gleich bleibt.

Die Regression prüft einen laufenden EQE mit noch aktiver Mindestlaufzeit, eine Benutzeranweisung `prio = 0`, verzögerte AUS-Rückmeldung und weiterlaufende Fahrzeugleistung. Der Mii darf seine Einschaltfreigabe erst nach bestätigter Lastfreiheit erhalten. Ungültige oder nicht geeignete bevorzugte Fahrzeuge dürfen keine unberechtigte Übergabe auslösen.

Softwaretests belegen die geprüften Abläufe. Der Schatten bestätigt elektrische Antworten weiterhin modelliert und simuliert keinen vollständigen Fahrzeug-SoC-Verlauf. Ein neuer Abnahmescore erfordert nachvollziehbare Betriebsdaten; diese Version aktiviert keine Geräte und ersetzt keine begleitete reale Abnahme.
