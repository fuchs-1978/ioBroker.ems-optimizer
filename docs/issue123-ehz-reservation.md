# Issue #123: EHZ-Ausgangsreservierung

Ausgangsbasis ist main `28e1b8f3b7d68d2881fa04400b3ed67f50bae6d4`
(0.17.0-alpha.59). Main, offene Issues/PRs und Releases wurden vor jeder
Änderungsgruppe erneut gelesen. Die Änderungen aus #118/#119/#121/#122 bleiben
bestehende Vergleichsbasis. Die Prüfung verändert keine ioBroker-/SQL-Zustände,
Konfiguration, Freigaben, Skripte oder Aktoren.

## Belegter Livezustand und verbleibender Blocker

Die lesend gewonnene, deduplizierte Folge umfasst 266 DecisionRecords mit
Sequenzen 18618–18883 ohne interne Sequenzlücke, vom 09.10.2026 15:17:15.009
bis 15:18:09.009 Europe/Berlin. Sie belegt den 900-W-Auftrag um 15:17:15.032
und den Nullauftrag um 15:17:20.040. Anschließend werden Nullaufträge etwa
alle fünf Sekunden wiederholt. Die drei Ausgangsquellen liefern zuletzt
0 W, ACK=true, q=0 und eigene frische Rohzeitstempel. Zwischenzeitlich liegen
auf Ausgang 1 noch 916, 5 und 1 W an; diese Werte sind keine bestätigte Null.
Die Reserve bleibt 3.000 W, pending=true. Der zusätzlich gelesene persistierte
Nachweis enthält `highW=[3000,0,0]`, `seenAt=[0,0,0]`, `commandW=[0,0,0]`;
der Sollregisterwert bleibt null.

Damit ist die Stell- und Nullantwort in diesem Ausschnitt wesentlich besser
belegt als im Tages-Issue. Die vollständige Entstehung der älteren
3.000-W-Hochwassermarke ist weiterhin unbekannt. Der aktuelle Lock wird durch
die fehlende volle Stellwirkung (`seenAt=0`) erklärt. Eine reale 3.000-W-Last
oder eine dadurch verursachte Ladeblockade wird daraus nicht abgeleitet.

`transport_complete` in `main.js` bestätigt das Schreiben in ioBroker mit
`ack=false`, keinen Geräte-ACK. Das Null-Sollregister liefert ebenfalls keinen
Geräte-ACK. Es liegt kein verifizierter Treiber-/Gerätevertrag vor, der eine
späte Wirkung des früheren positiven Auftrags durch diesen Nulltransport
sicher ausschließt. Daher bleibt die unbeobachtete Hochwassermarke reserviert,
auch bei Zeitablauf, wiederholter dreiphasiger Null und Neustart. **Die sichere
automatische Rücknahme dieser konkreten alten Reserve ist weiterhin blockiert.**
Die vorhandene manuelle Stillstandsbestätigung wird nicht ausgelöst.

## Reproduzierte Softwarefehler und begrenzte Korrektur

Ein zusätzlicher, unabhängig reproduzierter Fehler betrifft bereits vollständig
beobachtete Stellwirkung: Ein voller 3.000-W-Peak bei t=2001000, Nullauftrag
und erfolgreicher Transport bei t=2002000, identischer Nulltransport bei
t=2007000 und frische dreiphasige Nullproben bei t=2006500 lassen die Reserve
fälschlich bestehen. Jeder identische Nullabschluss verschiebt `zeroWriteAt`
erneut hinter die physische Antwort. Dieser Softwarefehler ist keine belegte
Ursache der oben beobachteten Reserve mit `seenAt=0`.

Der erste erfolgreiche Nulltransport derselben unveränderten Befehlsfolge
bleibt jetzt als Zeitgrenze erhalten. Positive Ausgabe, geänderte Befehlsfolge,
Mappingwechsel und Neustart verwerfen diesen Nullnachweis. Der Abschluss ist
an die tatsächlich beschriebene Sollquelle und die erfassten Messquellen
gebunden; veraltete Callback-Generationen bleiben wirkungslos. Derselbe Helfer
wird vom Heizpuffer verwendet, dessen Callback seinen tatsächlich beschriebenen
Sink ebenfalls weitergibt.

Zusätzlich konnte eine alte Leistungsmessung vor dem neuen positiven Auftrag
fälschlich dessen volle Wirkung markieren. `riseAt` hält jetzt die letzte
positive Erhöhung je Phase fest. Nur bestätigte gültige Messungen mit
Quellzeit nach dieser Erhöhung bilden einen neuen Vollwirkungsnachweis.
Die Zeit eines späteren Nullauftrags ersetzt diese Grenze nicht: Ein verspätet
empfangener Peak, dessen Rohzeit zwischen positiver Ausgabe und Nullauftrag
liegt, bleibt als chronologischer Nachweis nutzbar. Alte JSON-Nachweise ohne
`riseAt` erhalten eine konservative Grenze; unbekannte frühere Erhöhungszeiten
werden nicht erfunden. Eine unvollständig persistierte höhere Phase setzt
ihren Vollwirkungsnachweis zurück.

Die bisherige Freigabebedingung bleibt bestehen: volle Wirkung je reservierter
Phase, anschließend echte spätere Reduktion nach erfolgreichem Nulltransport.
Fehlende/null Werte, fehlender oder falscher ACK, schlechte Qualität, alte oder
zukünftige Quellenzeiten und die normale Stellabweichungstoleranz liefern
keinen Ersatznachweis. `zeroWriteAt=0` ist ausdrücklich kein Abschluss; dies
gilt auch für die manuelle Stillstandsbestätigung. Fehlende/null Sollwerte
werden weiterhin als unbekannt behandelt. Der Status nennt nun getrennt den
Nulltransportabschluss, fehlende volle Wirkung und unbekannte Sollrückmeldung.

## Regressionen und nächste lesende Prüfung

Die Tests umfassen positive und teilweise Wirkung je Phase, Nullauftrag,
frische dreiphasige Null, null/fehlendes Sollregister, unveränderte Nullwiederholung,
Neustart, veraltete Peaks, fehlenden ACK, schlechte Qualität, null und zukünftige
Proben, verspätete Quellenantwort, neue Ausgabe in derselben Millisekunde,
fehlenden Nullabschluss bei rekonstruiertem Zeitstempel 0 sowie verspätete
Callbacks und abweichende oder geänderte Sinks. Sie sichern außerdem den
gemeinsam verwendeten Heizpuffer-Helfer ab. Bestehende Schutz-/Budget- und
Phasenreserve-Regressionen bleiben relevant.

Bei der nächsten SQL-Auswertung jede Reservephase mit `riseAt`, `seenAt`,
`commandAt`, dem ersten gültigen `zeroWriteAt`, tatsächlichem Sink und
Roh-Ausgangsproben (Wert, ts, ACK, q) abgleichen. Die sichere Freigabe nach
voller Wirkung und späterer Null darf bei identischen Wiederholungen nicht
mehr verhungern. Die ältere unbeobachtete 3.000-W-Reserve darf dadurch nicht
automatisch verschwinden. Ihre Auflösung erfordert weiter einen belegten
Geräte-/Abbruchvertrag oder eine ausdrücklich veranlasste sichere physische
Stillstandsbestätigung. Softwaretests ersetzen keine reale Betriebsabnahme
und erzeugen keine Scorepunkte.
