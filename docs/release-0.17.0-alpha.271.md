# 0.17.0-alpha.271

Bei laufender Haushaltsentladung mit einem einzelnen SunEnergy-Kopf kann ein bestätigter Sollwert (GS) schon vor dem nächsten SMA-Telegramm eintreffen. Liegt die gemessene AC-Leistung höchstens 100 W daneben und besteht weiter Haushaltsbedarf, hält das EMS den laufenden Auftrag bei einem kleinen weiteren Rückgang bis zur nächsten passenden Netzmessung. Die Wartezeit ist auf drei Sekunden nach der Schreibbestätigung begrenzt. Für einen neuen Stellbefehl braucht das EMS die nächste passende Netzmessung.

Ein Sollwertschritt innerhalb des Netztotbands kann bei bereits bestätigter Entladung entfallen. Das gilt auch für zeitversetzte, frische SMA-Werte, wenn Netzleistung und gemessene Speicherleistung zum Totband passen. Damit bleibt der Kopf für den nächsten deutlichen Lastwechsel regelbar.

Die Leistungs- und SoC-Grenzen sowie der Schutz bei wegfallendem Bedarf und ungültigen Messungen greifen auch während der Wartezeit. Die zehn aufeinanderfolgenden abweichenden Messpaare aus Alpha 270 zählen weiterhin nur mit neuen Messungen.
