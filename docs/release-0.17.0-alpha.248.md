# 0.17.0-alpha.248

Nach einem erfolgreich geschriebenen Nullbefehl beobachtet das EMS jeden betroffenen, weiterhin online gemeldeten SunEnergy-Kopf. Drei frische Rückmeldungen mit GS = 0 und AC-Leistung innerhalb der Nulltoleranz über mindestens zehn Sekunden erlauben die automatische Rückgabe des alten Lade- oder Entladeauftrags. Danach kann das EMS bei bestehender Freigabe und gültigem Leistungsbudget selbst weiterregeln.

Eine abweichende Rückmeldung unterbricht die Prüfung. Meldet der Kopf nach einer Nullrückmeldung erneut Leistung oder einen anderen Sollwert, sendet das EMS den Nullbefehl erneut. Offline- oder veraltete Werte unterbrechen die Prüfung ebenfalls.
