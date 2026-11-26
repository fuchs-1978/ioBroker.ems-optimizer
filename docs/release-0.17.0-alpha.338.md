# 0.17.0-alpha.338

## Eine Abfahrt für Montag eintragen

Öffne im Energiefluss-Dashboard die Kachel des gewünschten Fahrzeugs. Trage beispielsweise **30.11.2026** als Abfahrtsdatum, **06:00** als Abfahrtszeit und **100 %** als Abfahrts-SoC ein. Aktiviere **Netzladung für diesen Termin bis zum Abfahrts-SoC erlauben** und wähle **Speichern**. Prüfe auch das Ladelimit im Fahrzeug. Die Uhrzeit gilt in der Zeitzone des EMS.

Der Abfahrts-SoC ist optional. Ein Fahrzeug mit 45 % Mindest-SoC und 90 % Maximal-SoC kann für eine einzelne Fahrt auf 100 % laden. Ohne die Netzfreigabe darf das EMS für diesen Termin bis 45 % aus dem Netz laden und darüber PV-Überschuss nutzen. Nach der Abfahrt gilt wieder das normale Ziel von 90 %. Die Kachel zeigt den aktiven Termin und das Ladeziel.

## Vom Eintragen bis zur Abfahrt

Der Termin kann mehrere Tage in der Zukunft liegen. Das EMS aktualisiert seine rollierende 48-Stunden-Prognose, berücksichtigt nutzbaren PV-Überschuss und berechnet aus der fehlenden Energie den spätesten Ladebeginn. Dabei berücksichtigt es unter anderem Ladeverluste, Stromgrenzen, Ladestromreduzierung in der Nähe des Ziels, weitere Fahrzeuge mit anstehender Abfahrt sowie 15 Minuten Zeitreserve. Die Nachladung beginnt früher, wenn weniger Leistung verfügbar ist. Bei aktivierter Preisladung kann der Preisfahrplan geeignete Stunden innerhalb seines Einkaufsfensters nutzen.

Bei aktivierter Mindestladung zur Abfahrt und gültiger Mobilitätsreserve darf das Fahrzeug oberhalb dieser Reserve auf PV warten. Unterhalb der Reserve fordert es sofort Ladeleistung an. Bei zu wenig verfügbarer Zeit oder Leistung kann das Fahrzeug sein Ziel verfehlen.

## Datenpunkte pro Wallbox

| Datenpunkt unter `Vehicles.WallboxN` | Bedeutung |
| --- | --- |
| `DepartureTrip_JSON` | Schreibbarer JSON-Text für den einzelnen Termin. Datum und Uhrzeit werden gemeinsam mit Ziel und Netzfreigabe übernommen. |
| `DeparturePlan_JSON` | Gelesene Ortszeit und Zeitzone, normale SoC-Grenzen, Fahrtziel, Netzladeziel und Zeitpunkt der Nachladung als Unix-Zeit in Millisekunden. |
| `DepartureTimestamp` | Wirksamer Abfahrtstermin als Unix-Zeit in Millisekunden. Bei abgelaufenem Termin ist der Wert 0. |

Beispieleingabe für `DepartureTrip_JSON`:

```json
{"date":"2026-11-30","time":"06:00","soc":100,"allowGrid":true}
```

Bei `soc: null` gilt der normale Maximal-SoC. Ein explizites `allowGrid` steuert die Zusatzladung für diesen Termin. Fehlt die Angabe oder ist sie `null`, gilt die Wallbox-Einstellung für Zusatzladung bis zum Ziel. Die Abfahrtsregel der Wallbox muss aktiv sein. Eine abgelaufene Buchung wiederholt sich nicht. **Abfahrt löschen** und **Speichern** entfernt die Buchung und die Uhrzeit. Trägst du anschließend nur eine Uhrzeit ein, verwendet das EMS wieder das nächste Vorkommen dieser Uhrzeit. Ohne Uhrzeit gilt die Sofortladung bis zum Mindest-SoC.
