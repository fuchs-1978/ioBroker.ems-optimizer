# Mindestladung beenden, PV-Fortsetzung erhalten

## Anlass und Auftrag vom 09.10.2026

In der SQL-Nachtauswertung unter alpha.54 erreichte der Mii gegen 02:51 Uhr
seinen Mindest-SoC von 70 %. Der AUS-Befehl folgte erst um 03:01:06 Uhr,
elektrische Ruhe um 03:01:17,632 Uhr. Das waren rund zehn Minuten zusätzlicher
Netzbezug durch die normale Ausschaltverzögerung. Beim EQV lag zwischen
Mindest-SoC 80 % um 03:27:24 Uhr und AUS um 03:37:32 Uhr ebenfalls ein
Nachlauf. Dies sind beobachtete alte Ereignisse, keine Abnahme von alpha.56.

Carstens Vorgabe: Zwangladen bis Mindest-SoC endet bei fehlendem weiterem
PV-Budget ohne Nachlauf. Bei PV-Fortsetzung über Mindest-SoC gilt die normale
Regelung einschließlich späterer Ausschaltverzögerung. Tagesbericht:
[#116](https://github.com/fuchs-1978/ioBroker.ems-optimizer/issues/116);
laufende Betriebsabnahme: [#7](https://github.com/fuchs-1978/ioBroker.ems-optimizer/issues/7).
Die separate Peer-Mindestladungskorrektur in alpha.55 bleibt erhalten.

## Verhalten in alpha.56

Der Produktivausgang merkt innerhalb seines aktuellen Ladeauftrags einen
gültigen Original-SoC unter einem gültigen Mindestwert. Sobald der SoC diesen
Wert erreicht, prüft er den verbleibenden Bedarf:

| Situation | Reaktion |
| --- | --- |
| Keine ausreichende PV-/aktuelle Preisfreigabe, keine weitere Pflicht | AUS ohne Warten auf Mindestlaufzeit, Restart-Grace oder Stopptimer |
| Ausreichende PV für Weiterladen | Ohne AUS weiter; spätere PV-Dellen behalten die normalen Timer |
| Aktuelle Preisfreigabe, manuelle Mindestladung oder fällige Abfahrtspflicht | Weiterhin die bestehende Bedarfs- und Schutzprüfung |
| Anderes Fahrzeug noch unter Mindest-SoC | Dessen sichere Grundladung bleibt erhalten |
| SoC oder Mindestwert unbekannt/unbestätigt/ungültig | Kein behaupteter erfolgreicher Mindestabschluss; bestehende Schutzprüfungen bleiben wirksam |
| Neustart schon oberhalb Mindest-SoC | Keine erfundene historische Abschlusskante |

Die Grenze ist eine gespeicherte Konfiguration und verfällt nicht durch ihr
Alter. Der originale SoC behält seine vorhandene Quellenfrist, ACK- und
Qualitätsprüfung. Ein Stop beendet den beobachteten Ladeauftrag.

Der sequenzielle Ausgang verwendet das frisch geprüfte reale Netzbudget.
Im Parallelbetrieb enthält jede zentrale Zuteilung zusätzlich `pvBudgetW`:
der Anteil stammt aus dem realen Überschuss-Verbraucherbudget nach Heizlast und
Reservierungen, wird mit tatsächlicher 1P-/3P-Kapazität und ohne erzwungene
Netzwatt verteilt und ist durch den finalen Sollwert begrenzt. Die regulären
Sollwerte und harten Obergrenzen werden dadurch nicht verändert. Eine noch
gültige Zuteilung von vor der beobachteten SoC-Kante bleibt für diesen
Abschluss unbekannt, bis der nächste normale Budgettakt vorliegt. Das ist
kein neuer 600-s-Nachlauf. Der Name `pvBudgetW` bezeichnet diese elektrische
Budgetzuordnung, keine PV-Ertragsmessung: BHKW-Erzeugung wirkt bereits auf
die gemessene Netzbilanz und wird nicht nochmals hinzuaddiert.

AUS bedeutet zunächst einen Stellbefehl. `OutputOwned` und die reservierte
Leistung bleiben bis zur bestätigten Freigabe AUS und anschließend gültiger
elektrischer Ruhe erhalten. Modbus-Pollzeit und Fahrzeugreaktion verschwinden
durch die Änderung nicht. Der Soll-/Maximal-SoC-Stopp bleibt unverändert.

## Regressionen und nächste reale Prüfung

Regressionen prüfen sofortigen Mindestabschluss auch bei altem positiven
Soll, einen weiter benötigten Mindestlader, echte Preis-/manuelle-/Deadline-
Pflicht, PV-Fortsetzung mit späteren 600 s, parallele Reservierungen bis
AUS-ACK und elektrischer Ruhe, alte gültige Konfiguration, ungültige Quellen,
Neustart/Abstecken sowie PV-Erholung nach einer älteren Zuteilung. Die
Engine-Prüfung trennt reine Pflichtnetzladung von PV und berücksichtigt
bestätigte 3P-Kapazität trotz kleinerer 1P-Grenze.

Nach manueller Installation in SQL zusammenhängend prüfen:

1. Version, Master-/Reglerzuständigkeit und gültigen Original-SoC unter/ab
   Mindestwert zusammen mit Budgetzeit und `pvBudgetW` festhalten.
2. Ohne weiteren Bedarf: `LastStopReason` enthält `Mindest-SoC erreicht`,
   `StopDelayActive=false`, `StopDelayRemaining_s=0`; AUS-Befehl, ACK und
   gemessene Leistung/L1–L3-Antwort zeitlich getrennt auswerten.
3. Mit PV-Fortsetzung: keine Freigabekante am Mindestwert; bei späterer
   PV-Delle den tatsächlich eingestellten Stopptimer nachweisen. Andere
   unterminimale Fahrzeuge bleiben innerhalb der gemeinsamen Schutzgrenzen
   eingeschaltet.

Softwaretests ersetzen keine reale Betriebsabnahme. Keine automatische
Installation, Konfigurationsänderung oder zugesagten Scorepunkte.
