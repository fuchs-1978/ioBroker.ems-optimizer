# 0.17.0-alpha.121

Beim beobachteten 3P-auf-1P-Wechsel wurde nach dem Phasenbefehl eine fehlende Ladefreigabe als externer Entzug gewertet. Der Ausgang sendete daraufhin zusätzlich AUS. In der Diagnose erschien eine neue Startverzögerung. Die reale Freigabe erfolgte etwa 90 Sekunden später; eine vollständig abgelaufene Fünf-Minuten-Verzögerung ist für diesen Vorfall nicht belegt.

## Änderung

Nur ein in derselben Ausgangssitzung beobachteter EMS-Phasenauftrag an eine bereits übernommene, aktive Wallbox mit bestätigter Ladefreigabe qualifiziert eine begrenzte native Pause. Ein frisches `allow=0` nach diesem Auftrag löst am Ende der ansonsten unveränderten Ausgangsprüfung zunächst keinen zusätzlichen AUS-Befehl aus. Der Ausgang wartet auf die selbstständige Wiederfreigabe der Wallbox. Es wird kein EIN-Befehl allein aus der Pausenerkennung erzeugt.

Der ursprüngliche Phasenauftrag begrenzt die Wartezeit; normale Fehler- und Antwortzeitprüfungen können früher abbrechen. Ändert sich das Phasenziel, endet die Frist oder greift eine Abschaltbedingung, verfällt die Erkennung. Sie wird nicht über einen Neustart wiederhergestellt. Gerätefehler, Nutzersperren, ungültige Daten sowie Netzbetreiber- und Hausanschlussgrenzen bleiben wirksam.

## Prüfung und Grenzen

Tests decken die native Pause, die selbstständige Wiederfreigabe ohne neue EIN/AUS-Sequenz, Nutzersperre, Ablauf und Netzbetreibergrenze ab. Die reale Ursache des ursprünglichen `allow=0` kann aus dem vorhandenen Ereignislog nicht abschließend der Wallbox-Firmware zugeordnet werden. Der Fix überschreibt deshalb keine fremde AUS-Anforderung mit EIN. Bei dauerhaft fehlender Freigabe greift weiterhin der normale Stopp.

Die Installation und Beobachtung eines erneuten realen Phasenwechsels stehen aus. Die vorhandene Mindeststartzeit für echte neue Ladevorgänge bleibt unverändert.
