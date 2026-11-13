# 0.17.0-alpha.237

Für einen vorübergehenden Test mit einem SunEnergy-Kopf `ems-optimizer.0.Config.BatteryPvFeedbackObservationEnabled` in den ioBroker-Objekten auf `true` setzen. Der Standardwert ist `false`. Den Test mit `false` beenden.

Bei ausstehender GS-/GP-Rückmeldung kann der letzte Ladeauftrag aktiv bleiben, wenn der frisch gemessene Überschuss seine mögliche Leistungsaufnahme deckt. Das EMS protokolliert Sollwert, gemeldeten GS-Wert, Istleistung, Netzleistung und Reserve als Warnung. Nach bestätigter Rückmeldung regelt es wieder mit der eingestellten Schrittweite.

Schutzgrenzen, Freigaben, Messwertprüfung und die Reserve für offene Aufträge bleiben wirksam. Eine bereits offene Nullrückgabe nach einem früheren Stopp folgt dem bestehenden Rückgabeverfahren.
