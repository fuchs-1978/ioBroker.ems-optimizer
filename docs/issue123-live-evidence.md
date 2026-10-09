# Issue #123: lesend belegte Ereignisse

Grundlage: [#123](https://github.com/fuchs-1978/ioBroker.ems-optimizer/issues/123) und [#116](https://github.com/fuchs-1978/ioBroker.ems-optimizer/issues/116). Angefordert waren 08.10.2026 19:56:49–09.10.2026 19:56:49 Europe/Berlin, entsprechend 17:56:49Z–17:56:49Z des Folgetags. Die Untersuchung schrieb weder ioBroker-Zustände noch SQL-Konfiguration, Skripte oder Aktoren. Installiert war alpha.59; die hier rekonstruierten Ereignisse stammen aus alpha.58, Sitzung `1791548168417`.

## EQE: 117 Befehle mit Messgrund

[Die kompakte CSV](evidence/issue123-eqe-commands.csv) enthält alle 117 EMS-Schreibversuche mit vorherigem tatsächlich gesendetem Strom, neuem Strom, älterer Allokation und deren Rohzeit, unmittelbar dokumentiertem frischem Budget, Original-Netz-/Fahrzeugwerten samt Quellenzeiten und vorherigem Antwortzustand. [Der Kontext](evidence/issue123-eqe-context.json) erklärt Einheiten, Quelle, Zeitbasis und leere Zellen. Ein Schreibversuch ist kein Aktor-ACK; die CSV ist eine Diagnoseprojektion, kein Ersatz für vollständige rohe Replayframes.

Der 6-A-Start am 09.10.15:27:28.025 MESZ, Sequenz 21690, wurde separat aus Vollbasis 21642 und anschließenden Deltas rekonstruiert. Das durchgängig gelesene Regelfenster 15:42:48–16:10:09 enthält 10.310 eindeutige Records, Sequenzen 26408–36717, 88 identische Grenzduplikate, keinen Identitätskonflikt und keine interne Sequenzlücke. Die zehn führenden Deltas 26408–26417 bleiben ohne frühere Vollbasis unbekannt. Ab Vollbasis 26418 um 15:42:51.597 sind sämtliche 116 Regelbefehle vollständig replaybar. Zwischen getrenntem Startabschnitt und Regelfenster wird keine durchgehende Sequenz behauptet.

Die 116 Nachregelungen enthalten 56 Erhöhungen und 60 Reduktionen. 14 Reduktionen lagen in einer offenen Fahrzeugantwort; keine tatsächliche Erhöhung lag in einem `ResponsePending=true`-Snapshot. Sämtliche 116 Allokationen verwendeten nominale Antwortbasis und `actualPowerW=null`, obwohl frische reale Messungen vorlagen. Netzquellen waren ACK=true/q=0 und maximal 511 ms alt. Bei 23 Erhöhungen war das unmittelbar dokumentierte nominale Budget kleiner als die benötigte Leistung, bei 16 um mehr als das 100-W-Totband. Das belegt weder eine Hausanschlussverletzung noch einen realen Ladestopp.

| Zeit am 09.10., MESZ | Befehl | Frisches Budget | Antwort vorher |
|---|---:|---:|---|
| 15:43:08 | 6→9 A | 1.290 + 907,8 − 100 = 2.097,8 W | 6 A bestätigt |
| 15:43:14 | 9→7 A | 1.290 + 471,4 − 100 = 1.661,4 W | 9 A offen, Ist 5,8 A |
| 15:43:22 | 7→10 A | 1.750 + 799,1 − 100 = 2.449,1 W | 7 A anhand 7,9 A bestätigt |
| 15:43:26 | 10→8 A | 1.470 + 518,6 − 100 = 1.888,6 W | 10 A offen, Ist 6,6 A |
| 15:43:34 | 8→9 A | 1.750 + 485,9 − 100 = 2.135,9 W | 8 A anhand 7,8 A bestätigt |

Der Exportwechsel und die Allokations-/Antwortpfade sind belegt. Die dünnere PV-Reihe allein beweist keine stark schwankende PV als Ursache. Regressionen reproduzieren außerdem die Erhöhungen 7→9 bei frischen 2.036,1 W, 7→10 bei 2.065,3 W und 6→9 bei 1.780,6 W; der neue Stellpfad begrenzt diese Fälle auf 8, 8 und 7 A. Eine spätere echte Regelruhe muss real beobachtet werden.

Die originale `amperePV`-SQL-Reihe enthält 261 Werte, darunter Echos und Relogging. Nach Ausschluss des Start-Echos 6→0→6 bleiben dieselben 117 Befehlswerte: Median 7,989 s, 91 Abstände unter 10 s. Die genaueren `command.attempt`-Zeiten ergeben Median etwa 7,996 s und 90 Abstände unter 10 s. Genau das Paar 16:00:08→16:00:18 liegt bei 10,003 s Ereignisabstand, aber 9,999 s SQL-Stateabstand. Die Zahlen werden nicht durch Rundung gleichgesetzt.

## EHZ und SQL-Grenzen

Die EHZ-Folge umfasst 266 Records 18618–18883 ohne interne Lücke: 900-W-Auftrag um 15:17:15, Nullauftrag um 15:17:20 und anschließend ausschließlich etwa fünfsekündliche Nullwiederholungen. Restleistung fällt auf 1 W und dann auf frische dreiphasige Null ab 15:17:56.534/.578/.579, weitere frische Null um 15:18:08.197. Die alte Reserve bleibt 3.000 W mit `seenAt=[0,0,0]`; ihr Entstehungs-/Abbruchvertrag ist dadurch nicht geklärt. Das Sollregister ist nicht gepollt und liefert NULL; ACK=true bei NULL ist keine gültige numerische Stellbestätigung. [Sicherheitsvertrag und begrenzte Softwarekorrektur](issue123-ehz-reservation.md).

Das Regelfenster erforderte 133 protokollierte Abfragen, drei davon scheiterten zunächst nach 25,737/25,751/26,040 s. Begrenzte Wiederholungen am selben Cursor schlossen später die Abschnitte. Kleine Zahlenhistorie im selben Timeoutfenster war in etwa 0,82 s lesbar. Die eindeutigen Rohrecords umfassen 128.448.505 UTF-8-Bytes, Median 11.452 Bytes, Maximum 41.742; 55 Vollbasen und 10.255 Deltas. Die Recordzeitspanne beträgt 27 min 20,380 s, Rate etwa 6,285/s. Das ist kein Tagesmittel und keine gemessene Tagesdatenmenge.

Eine erneute 2-s-Probe am angeforderten Tagesanfang lieferte acht alpha.53-Deltas; Retentionsverlust wird nicht aus der 86.400-s-Einstellung abgeleitet. Vollständige 24-h-Lesbarkeit und genaue Timeoutursache bleiben offen. Aktuelle `dropped=0`/`writeErrors=0` belegen keine früheren Sitzungen. Umfangreiche Rohpages und Replaydetails bleiben im lokalen Diagnosearchiv; [Abrufvertrag und nächste 24-h-Prüfung](issue123-recorder-access.md) nennen alle Vollständigkeitsgrenzen.

Software und reale Abnahme bleiben getrennt: keine automatische Installation, Livefreigabe oder Scoreänderung; 69/100 bleibt der letzte belegte Stand.
