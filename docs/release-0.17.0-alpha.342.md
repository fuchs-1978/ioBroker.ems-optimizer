# Alpha 342 – Speicherladung während der Wallbox-Startverzögerung

Wenn das Speicherziel für den Tagesabschnitt bereits erreicht ist, kann der Hausspeicher während der Startverzögerung einer PV-Ladung den gemessenen Überschuss aufnehmen. Der Countdown läuft weiter, solange die verfügbare PV-Leistung ausreicht. Bei Ablauf gibt der Speicher die für den Start benötigten Watt frei. Die Wallbox wartet auf die Bestätigung am Netzanschlusspunkt.

In der Anlagensimulation mit 1.800 W konstantem Überschuss und 300 Sekunden Startverzögerung speist Alpha 341 während der Wartezeit 150 Wh ein. Mit Alpha 342 sind es im selben Verlauf 1,5 Wh. Bei verzögerter Leistungsrücknahme des Speichers wartet der EQV. Fällt die PV-Leistung unter die Startschwelle, beginnt die Wartezeit nach der Erholung erneut.
