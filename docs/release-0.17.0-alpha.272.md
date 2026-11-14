# 0.17.0-alpha.272

Bei laufender Haushaltsentladung mit einem SunEnergy-Kopf kann das EMS den vorherigen Sollwert direkt durch einen neuen ersetzen. Dafür muss der vorherige GS-Schreibauftrag an ioBroker übergeben sein. Das EMS kann mit dem nächsten Sollwert fortfahren, während die Bestätigung des Speichers noch aussteht.

Für eine Senkung nutzt das EMS den aktuellen Sollwert, die gemessene AC-Leistung und den Netzfluss. Eine Erhöhung stützt es auf neue Speicher- und SMA-Messwerte nach der vorherigen Ausgabe. Wenn sich das verfügbare Budget vor dem Schreiben ändert, verwirft das EMS den überholten Auftrag und berechnet den nächsten Stellschritt.

Ein belegter Wegfall des Haushaltsbedarfs, ein Richtungswechsel oder eine Schutzsperre löst einen Stopp aus. Die Rückmeldediagnose zeigt, wann der neue Auftrag am Kopf und in der AC-Leistung angekommen ist.
