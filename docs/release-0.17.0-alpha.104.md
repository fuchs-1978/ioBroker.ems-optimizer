# Alpha.104 — begrenztes Nachregeln bei abweichender Fahrzeugaufnahme

## Betriebsbefund

19.10.2026, gegen 14:44 MESZ: EQE mit bestaetigter Vorgabe 10 A seit 14:38:46; gemessene Aufnahme 7,8–7,9 A / 1,75 kW. Die zentrale Zuteilung erlaubte 16 A, am NVP wurden etwa 2,02 kW eingespeist. Nach der Erhoehung von 9 auf 10 A fehlte der geforderte messbare Fortschritt; die bisherige Anti-Windup-Sperre wartete unbegrenzt auf diesen Fortschritt. Ob der physische Grund Fahrzeug, Wallbox oder eine andere Begrenzung ist, ist weiterhin nicht bewiesen.

## Aenderung

Im produktiven parallelen PV-Betrieb darf eine nach Ablauf der elektrischen Antwortzeit nachweislich bestaetigte, aber nicht ausreichend angenommene Stromerhoehung einen zusaetzlichen 1-A-Nachregelversuch erhalten. Maximal zwei Versuche ohne nachgewiesenen elektrischen Fortschritt. Kein Anheben innerhalb der urspruenglichen Antwortfrist; jeder tatsaechlich gesendete Versuch hat wieder seinen eigenen ACK- und elektrischen Antwortnachweis. Fehlendes ACK oder fehlende/ungueltige elektrische Messung erlaubt keinen Versuch.

Die Quellen muessen frisch sein und mindestens den Zeitpunkt des Antwortfristendes erreichen. Reale positive Aufnahme auf allen benutzten Phasen ist erforderlich. Der volle nominelle neue Strom muss im aktuellen NVP-Budget liegen; keine Nutzung der Bezugstoleranz als Ersatzbudget. Aktuelle zentrale Freigabe, Geraete-, Hausanschluss-, Peer-/Heizlast- und Betreibergrenzen bleiben erhalten. Kein Versuch bei Tarifladung, modellierter Antwort, Start oder Phasenuebergang. Eine alte offene gemessene 1-A-Schrittreserve darf nur durch den vollstaendig nominell gedeckten Versuch ersetzt werden; sie wird vorher nicht blind freigegeben.

Messbarer Strom- UND Leistungsfortschritt nach dem Versuch setzt den Zaehler zurueck und gibt die gewoehnliche Nachregelung frei. Ein dauerhaft auf 7,8 A begrenztes Fahrzeug fuehrt daher nicht zu beliebig steigenden Vorgaben: nach zwei Versuchen bleibt weiteres Hochregeln blockiert, bis echte Aufnahme belegt ist. Der Zaehler wird bei Stopp zurueckgesetzt. Bestehendes Antwortfenster nicht verlaengert, Schutzabsenkungen bleiben unmittelbar. Versuch und Zaehler erscheinen in IncreaseBudget_JSON und im Info-Log.

## Nutzen und Abnahme

Im beobachteten Fall wird zunaechst ein Schritt von 10 auf 11 A moeglich, statt bei grossem PV-Budget dauerhaft auf 10 A zu verharren. Die zusaetzliche reale Aufnahme ist erst belegt, wenn Leistung und Stroeme tatsaechlich steigen; keine zugesagte kWh-Einsparung. Die etwa 2 kW Einspeisung sind kein Nachweis vollstaendig nutzbarer Fahrzeugleistung. Der reale Fahrzeug-/Wallbox-Grund und die Restnutzung durch andere Verbraucher bleiben bei ausbleibender Antwort zu untersuchen.

Regressionen pruefen 7,8 A bei 10 A mit 11-A-Versuch, Wiederaufnahme der normalen Regelung nach echter Antwort, Begrenzung auf zwei erfolglose Versuche, die alte gemessene Schrittreserve sowie Negativfaelle fuer Frist, Budget, fehlende Aufnahme/Messung/ACK, harte Grenze und entzogene Freigabe. Die bisherigen Tests vor Ablauf der Antwortzeit bleiben erhalten. Keine produktiven Stellversuche, keine Aenderung der 5-s-Abfragen oder der gewuenschten 600-s-Abschalttimer; keine neuen Admin-Einstellungen.
