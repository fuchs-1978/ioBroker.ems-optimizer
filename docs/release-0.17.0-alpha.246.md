# 0.17.0-alpha.246

Bei einem regulären Neustart oder Update kann das EMS einen laufenden SunEnergy-Lade- oder Entladeauftrag übernehmen. Die Freigaben und die relevanten Einstellungen müssen gleich bleiben. Der alte Prozess speichert die bestätigte Übergabe. Der neue Prozess prüft frische GS- und AC-Rückmeldungen, die aktuelle Topologie und die Schutzgrenzen. Danach regelt er mit dem aktuellen Leistungsbudget weiter.

Bei einer abgelaufenen Übergabe, abweichender Rückmeldung oder entzogener Freigabe greift der Nullbefehl. Die Übergabe gilt für SunEnergy-Köpfe im Mehrkopfmodus, auch bei nur einem Kopf. Ein Update von einer älteren Version kann die Übergabe erstmals beim darauffolgenden Neustart nutzen.
