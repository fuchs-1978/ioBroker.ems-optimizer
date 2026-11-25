# 0.17.0-alpha.332

Am 25. November lagen bei 64 % Speicherladung und 2,62 kW Netzbezug zwei Messzeiten des SunEnergy-Kopfs 4,4 und 4,7 Sekunden vor ihrer lokalen Empfangszeit. Der Regler berechnete 2,4 kW Entladung. Alpha 331 gab bei diesem Zeitversatz nur Aufträge bis 100 W frei.

Alpha 332 regelt in der koordinierten Einzelkopfregelung auch höhere Lade- und Entladeleistungen, wenn zwei frische Originalmeldungen zeitlich aufeinanderfolgen und ihr jeweiliger Vorlauf höchstens zehn Sekunden beträgt. Dazu muss ein frisches Messpaar für Netzbezug und Einspeisung vorliegen. Die Leistung folgt der eingestellten Schrittweite sowie den SoC- und Gerätegrenzen.

Das EMS prüft das Alter anhand der ersten lokalen Empfangszeit einer Geräteablesung. Eine erneute Veröffentlichung desselben Gerätezeitstempels verlängert ihre Gültigkeit nicht. Zur Bestätigung eines Auftrags müssen zwei unterschiedliche Messungen nach der Übertragung eingegangen sein. Der gemeldete Sollwert GS belegt die Übernahme, die gemessene AC-Leistung GP die elektrische Wirkung. Der Status unter `Devices.Battery.OutputStatus` nennt fehlende Messungen oder eine Überschreitung der Toleranz.
