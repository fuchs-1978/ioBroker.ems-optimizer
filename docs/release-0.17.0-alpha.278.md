# 0.17.0-alpha.278

Im Liveverlauf um 08:27 Uhr meldete der SunEnergy-Kopf den 10-W-Ladeauftrag zurück und lieferte 0 W AC-Leistung. Trotz etwa 545 W Einspeisung hielt das EMS die höhere Ladevorgabe bis zum Ablauf der Rückmeldefrist zurück. Danach löste ein Nullbefehl einen neuen Anlauf aus.

In der normalen Netzregelung eines einzelnen SunEnergy-Kopfs ersetzt ein gültiger neuer Lade- oder Entladeauftrag den bisherigen GS auch bei offener Rückmeldung. Im nachgestellten Fall folgt auf `GS = −10 W` direkt `GS = −545 W`. Die Regelung verwendet den letzten Auftrag als erwartete Leistung und begrenzt den korrigierten Sollwert anhand der Netzmessung und der verfügbaren Istleistung. Gleichbleibende Einspeisung während des Anlaufs löst dadurch keine gestapelten Erhöhungen aus.

Zehn unterschiedliche Gerätemessungen in Folge ohne passende GS/GP-Antwort lösen bei diesem Rückmeldefehler einen Nullbefehl aus. Eine passende Antwort setzt den Zähler zurück. Die zuletzt beanspruchte Ladeleistung bleibt bis zur physischen Antwort für die Budgetprüfung reserviert. Die Schutzgrenzen und die sichere Rückgabe prüfen weiterhin die gemessene Leistung.
