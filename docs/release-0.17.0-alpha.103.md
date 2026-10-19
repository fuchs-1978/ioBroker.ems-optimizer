# Alpha.103 — ausreichende Zeit fuer die Neustart-Uebernahme

## Belegter Ablauf am 19.10.2026 (MESZ)

13:54:53 Beginn der Uebergabe vor dem Prozesswechsel. 13:55:14 Start des Historienaufbaus. 13:57:41 Historie nach 147 Sekunden bereit, anschliessend Fahrplan/Regler gueltig. Die erforderliche stabile Datenphase von 10 Sekunden plus Verarbeitung/Prueftakt kollidierte mit der bisherigen Gesamtfrist von 180 Sekunden. Um 13:57:54 wurde deshalb trotz fertig aufgebauter Daten abgeschaltet und danach neu gestartet.

## Aenderung

Gemeinsame Zeitbudgetregel fuer Ausgang und Erkennung der neuen Uebernahmegeneration: mindestens 900 Sekunden Anlaufbudget (15 Minuten), maximal konfigurierbar 3600 Sekunden. Auch installierte Konfigurationen mit 180 Sekunden erhalten diese Mindestreserve intern automatisch; keine produktive Konfigurationsmutation und keine Admin-Aenderung erforderlich. Neuer Admin-/Native-Standard 900 Sekunden, Bereich 900–3600 Sekunden. Das wirksame Anlaufbudget wird bei Wiederuebernahme im Info-Log genannt.

Beginnt eine gueltige Stabilisierung innerhalb dieses urspruenglichen Anlaufbudgets, darf sie auch nach dessen Ende fertig werden. Dafuer gibt es die volle konfigurierte Stabilisierungszeit (fuer die Fristverlaengerung begrenzt auf 120 Sekunden) plus mindestens 30 Sekunden Prueftaktreserve (abhaengig vom Regeltakt bis 120 Sekunden). Der Zusatz bleibt am urspruenglichen Fristende verankert. Wiederholte ungueltige Daten oder neue Kandidaten setzen die Gesamtfrist nicht zurueck. Nach Datenverlust verschwindet die Qualifikation; Daten, die erstmals nach Ende des Anlaufbudgets gueltig werden, schaffen keine neue Verlaengerung.

Die laufende, bereits EMS-eigene Wallbox wird nur unter den bisherigen Wiederuebernahmebedingungen gehalten. Keine neue Ladung und keine Stromerhoehung aus der Wartefreigabe. Geraete-, Quellen-, Phasen-, Hausanschluss- und Betreibergrenzen bleiben aktiv. Der normale PV-Regler bleibt waehrend der Wartephase noch nicht vollstaendig verfuegbar; diese Aenderung ist keine neue Prognose oder Regeloptimierung. Bei dauerhaft fehlenden Daten bleibt die Wartezeit endlich.

## Validierung und Abnahme

Regressionen fuer Bereitschaft nach 175 Sekunden mit Abschluss nach der alten 180-s-Grenze; Bereitschaft kurz vor 900 Sekunden mit anschliessendem Abschluss; Geraetefehler, Datenverlust und erstmals zu spaete Bereitschaft. Bestehende Ablauf-/Grenztests fuer abgelaufene Uebergabe pruefen jetzt die neue endliche 900-s-Grenze. Die 600 Sekunden Mindestlauf-/Abschaltverzoegerung werden nicht veraendert. Kein produktiver Neustart oder Schaltversuch durchgefuehrt; reale Uebernahme nach Installation separat pruefen.
