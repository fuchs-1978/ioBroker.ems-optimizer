# 0.17.0-alpha.139 – bestätigte Fahrzeugantwort gegen ältere Zuteilung halten

## Fall 1: Export bei laufendem EQE

Die Markierung vom 24.10.2026, 14:18:05–14:22:40 Uhr Berlin, wurde im begrenzten DecisionRecord-Fenster 14:20:25–14:22:25 untersucht. Tatsächlich geladene SQL-Seiten reichen bis 14:21:45; vollständige Produktionssnapshots beginnen ab 14:20:40. Vorlauf ohne Deltabasis bleibt unbekannt.

Um 14:21:30.121 waren 9 A vorgegeben, etwa 7,9 A / 1730 W gemessen und die elektrische Antwort bereits bestätigt. Der NVP zeigte etwa 439 W Export. Die ältere Parallelzuteilung von 14:21:28.024 hatte noch mit 1450 W gerechnet und ein 8-A-Ziel ermittelt, reservierte aber weiter die vollen 2070 W der 9-A-Vorgabe. Der neuere Leistungspoll lag nach dem Eingang dieser Zuteilung. Trotzdem wurde 9→8 A gesendet. Um 14:21:38 folgte wieder ein 9-A-Auftrag. Das ist ein konkreter unnötiger Rücknahmeschritt; die weitere Gesamtrückspeisung ist dadurch nicht vollständig erklärt oder als vermeidbar quantifiziert.

Ursache: Der vorhandene Schutz gegen die Rücknahme durch eine ältere Zuteilung verlangte maximal 0,5 A Abweichung von der Vorgabe. Die elektrische Antwortprüfung akzeptiert bei belegtem Anstieg dagegen bereits einen Fahrzeugversatz bis 3 A. So wurde eine gültig bestätigte Teilaufnahme gleich wieder verworfen. Dies ist eine eng begrenzte Ergänzung des bestehenden Zuteilungs-Haltens, nicht die 45-Sekunden-Prüfschrittänderung aus PR246/alpha.137.

Bei einer **neueren** Leistungsmessung wird für diesen reinen Haltepfad dieselbe begrenzte 3-A-Abweichung verwendet, zusätzlich mindestens der wirksame Mindeststrom auf jeder benutzten Phase. Es wird kein weiterer Ampere-Schritt freigegeben. Das Halten verlangt weiterhin bestätigte Antwort/ACK, frische elektrische und Netzquellen, vollständige nominelle Reservierung des bestehenden Befehls und keine neue Peer-/Heizstabverpflichtung. Bei einer zeitgleichen Probe bleibt die strengere 0,5-A-Prüfung bestehen. Frische Zuteilung, echter Netzfehlbetrag, entzogene Reservierung, zu kleiner Strom oder harte Grenzen wirken weiterhin.

Der neue Regressionstest reproduziert auf main vor der Änderung genau den 8-A-Rücknahmeauftrag; mit der Korrektur bleibt 9 A ohne neuen Schreibbefehl erhalten. Negative Fälle prüfen frische Zuteilung, unbestätigte Antwort, entzogene Reserve, Stromgrenze, Netzbezug, zu geringen Strom und alte Leistung. Bestehende Gleichproben-/ACK-/Phasen-Zuordnungstests bleiben unverändert aktiv.

## Fall 2: Netzbezug bei 6-A-Ladung am Nachmittag

Die Markierung 16:27:20–16:35:50 wurde im ausgewählten SQL-Fenster 16:32:30–16:34:30 untersucht; geladene Seiten reichen bis 16:34:00. Die damalige Konfiguration enthält 600 s Mindestlaufzeit und gesondert 600 s Abschaltverzögerung. Vollständige Produktionssnapshots zeigen ab 16:32:53 ein 0-A-Ziel bei noch realen 6 A / etwa 1280 W. Der Stopptimer läuft nachvollziehbar von 171 s auf 115 s herunter, während der Hausanschluss insgesamt etwa 3,0–3,1 kW bezieht. Der gesamte Bezug ist nicht allein Fahrzeugladung.

Das getrennt gelesene EMS-Log bestätigt den Budgetstopp um 16:35:44.092; die gespeicherte Episodenendbeobachtung zeigt anschließend 0 W am EQE. Dies ist kein belegter hängender Timer oder übersehener Nullauftrag, sondern die konfigurierte Verzögerung bei weichem Leistungsdefizit. Harte Schutzgrenzen bleiben davon unabhängig. Keine ungefragte Änderung der 600-s-Einstellung und keine zweite Codekorrektur für diesen normalen Ablauf.

Beide Fälle werden für die weitere Auswertung getrennt geführt: Zuteilungs-/Bestätigungs-Rücknahme als Codekorrektur, normaler verzögerter Budgetstopp als erklärter Fall. Alte Episoden vor Installation sind kein Beleg einer Regression; Softwaretests sind keine reale Folgeabnahme.
