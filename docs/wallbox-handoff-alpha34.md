# Wallbox-Abschaltung und Wiederaufnahme in alpha.34

## Anlass

Am 05.10.2026 meldete die abgesteckte WB0/Mii bei 0 W kurz eine reale Ladefreigabe. Der isolierte Schattenausgang beanspruchte deshalb einen Abschaltauftrag. Obwohl sein privater AUS-Befehl sofort bestätigt wurde, blieb die Eigentümerschaft bis zum nächsten Zyklus bestehen. Der ausgewählte EQE wurde virtuell gestoppt und begann anschließend die konfigurierte Einschaltverzögerung erneut. Die erfassten realen EQE-Werte zeigten weiter Ladeleistung und Freigabe. Der Verursacher des WB0-Freigabeimpulses ist nicht bekannt.

## Bestätigte Abschaltung

Der Ausgang verarbeitet eine passende AUS-Bestätigung vor und unmittelbar nach dem Schreibaufruf. Ein versendeter Befehl oder ein alter, unbestätigter Nullwert reicht nicht. Eine Rückmeldung nach einem eigenen Abschaltversuch muss mindestens dessen Zeitstempel besitzen und die konfigurierte Quellenqualität und Altersgrenze erfüllen.

Bei einem realen Ausgang muss danach zusätzlich eine frische Leistungsmessung bis 20 W und jeder Phasenstrom bis 0,5 A vorliegen. Bei einer zuvor aktiven Ladung oder einem eigenen AUS-Befehl müssen diese Messungen mindestens so neu wie die erste passende AUS-Bestätigung sein. Eigentümerschaft, Verriegelung und bisherige Lastreserve bleiben bis dahin erhalten. Nach bestätigtem AUS wird während des Leistungsabfalls nicht wiederholt AUS geschrieben. Fehlt die elektrische Bestätigung über die Fahrzeugantwortfrist hinaus, bleibt der Ausgang gesperrt und erhält eine Diagnose.

Eine noch nie gestartete, bereits bestätigte AUS-Wallbox braucht für den Abbruch ihrer Vorbereitung keinen künstlichen neuen Abschaltzyklus. Ihre elektrischen Werte müssen trotzdem gültig und nahe null sein. Auch vor einer neuen Freigabe werden die anderen steuerbaren Wallboxen auf bestätigtes AUS und elektrische Ruhe geprüft.

Das Schattenmodell akzeptiert ausschließlich seine ausdrücklich gültige, angenommene elektrische Nullantwort. Die physische Ladung des weiterhin aktiven Bestandsskripts ist keine Bestätigung eines virtuellen Befehls. Eine fehlende Modellantwort hält die Verriegelung und bleibt unbekannt; sie erzeugt für sich keinen erfundenen physischen Fahrzeugfehler.

## Begrenzte Wiederaufnahme

Nur eine zuvor aktive EMS-eigene Ladung derselben ausgewählten Wallbox kann nach einer Peer-Sequenzsperre einen Wiederaufnahmehinweis erhalten. Seine maximale Frist ist die Summe aus konfigurierter Befehlsbestätigung und Fahrzeugantwortfrist. Der Echtzeitverteiler muss die vorherige aktive Ausgabe in seiner aktuellen Sitzung selbst beobachtet haben und die Bereitschaft durchgehend prüfen.

Budget, Schutzgrenzen, Fahrzeug-/SoC-/Benutzerfreigabe, Auswahl, Phasen und Preisberechtigung müssen weiterhin passen. Eine Daten- oder Beobachtungslücke, unzureichendes Budget, Wechsel der Auswahl oder Berechtigungsbasis sowie das Fristende verwerfen die Bereitschaft. Ein gespeicherter Hinweis nach Neustart genügt nicht. Erst eine neue aktive Ladung kann erneut qualifizieren.

Eine zulässige Wiederaufnahme vermeidet lediglich einen zweiten vollen allgemeinen Starttimer. AUS-Bestätigung, elektrische Ruhe, Phasenbestätigung, Stromvorgabe, Freigabe-ACK und Fahrzeugreaktion werden weiterhin geprüft. In alpha.34 behalten neue Fahrzeugwechsel und normale Erststarts die gewöhnliche Startverzögerung. Ab alpha.36 ergänzt eine [qualifizierte Fahrzeugübergabe](wallbox-handoff-alpha36.md) eine eigene begrenzte Ausnahme; normale Erststarts behalten die Verzögerung. Zwei Fahrzeuge werden nicht gleichzeitig freigegeben.

## Diagnose und Abnahme

Die Geräteobjekte `SequenceResumePending`, `SequenceResumeUntil`, `StopConfirmedAt` und `StopPowerPending` sowie die modellierten DecisionRecord-Felder erklären den Zustand. Die Startdiagnose zeigt die Qualifikation bzw. deren Ablehnungsgrund. Virtuelle ACKs und elektrische Antworten bleiben Modellannahmen.

Die Regressionen prüfen den Mii-Impuls mit weiterlaufendem EQE, ausstehende oder alte AUS-Bestätigung, positive/fehlende Restlast, Leistungsreservierung, Datenqualität, begrenzte Wiederaufnahme und harte Sicherheitsstopps. Ein erfolgreicher Softwaretest ist kein Nachweis realer Fahrzeugreaktion. Ein Score-Anstieg setzt neue ausreichende Betriebsbelege voraus; die Version schaltet nichts automatisch ein.
