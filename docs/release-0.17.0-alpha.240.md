# 0.17.0-alpha.240

Nach Neustart oder Update übernimmt das EMS einen gespeicherten SunEnergy-Ausgang automatisch wieder, wenn für den vorherigen Auftrag keine offene Befehlsrückmeldung gespeichert ist. Es wartet zuerst auf frisches GS = 0 und AC-Leistung innerhalb der Nulltoleranz nach Abschluss des neuen Nullschreibens. Danach gibt es die Leistungsreserve frei und nimmt die Regelung bei aktiver Freigabe wieder auf.

Bereits gespeicherte unbeobachtete Aufträge behalten ihre Reserve. Für einen solchen Auftrag bleibt die bestehende Rückgabe erforderlich, falls die Gerätebestätigung ausbleibt.
