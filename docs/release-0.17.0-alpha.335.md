# 0.17.0-alpha.335

Gerätestarts werden anhand der konfigurierten Betriebsrückmeldung bestätigt. Die Bestätigung des Schreibbefehls allein gilt nicht als Gerätestart.

- Erster Startversuch zum geplanten Zeitpunkt.
- Ohne bestätigten Lauf zweiter Versuch nach 15 Minuten.
- Ohne bestätigten Lauf dritter Versuch nach weiteren 15 Minuten.
- Ohne bestätigten Lauf nach weiteren fünf Minuten: Fehlermeldung, keine weiteren Versuche für diese Freigabe.

Bei einem ersten Versuch um 23:00 Uhr folgen die weiteren Versuche um 23:15 und 23:30 Uhr, die Fehlermeldung um 23:35 Uhr. Die Prüfung läuft im vorhandenen 15-Sekunden-Takt. Nach Ausfall des EMS werden verstrichene Versuche nicht unmittelbar nachgeholt: Zwischen tatsächlich erfassten Versuchen bleiben mindestens 15 Minuten; nach dem dritten Versuch mindestens fünf Minuten.

Vor einem erneuten Versuch müssen Automatik, globale Schreibfreigabe, Fernstartfreigabe, ausgewähltes Programm, Startbefehl, Bereit-Rückmeldung und Startfenster passen. Ein erkannter Lauf beendet die Wiederholungen. Programmwechsel, entzogene Freigabe oder Beobachtungsmodus brechen die Folge ab. Bei unbekanntem Betriebszustand wird ein Fehler gemeldet und kein weiterer Start gesendet. Ein abgelaufenes Startfenster führt ebenfalls zum Fehler.

`Devices.Programs.N` enthält `startAttempt` mit `status` (`waiting`, `confirmed`, `cancelled`, `failed`), `attempts`, `firstSentAt`, `lastSentAt`, Programm, Freigabe und gegebenenfalls `error`. Diese Daten bleiben bei Neustarts und einer Umsortierung der Geräte erhalten. Der Fehler wird einmal protokolliert und als Text mit stabiler ID über `Devices.Programs.N.Announcement` bereitgestellt. Das bestehende Sprachausgabe-Skript kann ihn ausgeben. Eine später erkannte laufende Maschine bestätigt den Start auch nach einem Fehler.

Die Kontrolle prüft die Rückmeldung des Geräteadapters; bei fehlenden oder falschen Rückmeldungen kann das EMS einen physischen Start nicht sicher bestätigen. Bereits vor diesem Update gesendete Starts erhalten rückwirkend keine neue Versuchsfolge.
