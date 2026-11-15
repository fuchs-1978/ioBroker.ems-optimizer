# 0.17.0-alpha.276

Alpha.275 konnte eine zulässige Ladesenkung bei ausstehender Geräterückmeldung mit 0 W unterbrechen. Zudem konnte eine frische SMA-Messung bereits die laufende Ladung enthalten, während `GP` noch den Zustand davor meldete. In diesem Fall entstand rechnerisch ein Entladesoll, obwohl eine kleine Ladesenkung genügte.

| Ausgangslage bei 0 W Netzsollwert und 10 W Speichertotband | Neuer Befehl am einzelnen Kopf |
| --- | --- |
| Ladeziel sinkt von 211 W auf 198 W bei offener Rückmeldung | `GS = −198 W` |
| 210 W Ladeauftrag, 15 W frischer Netzbezug, verzögertes `GP` | `GS = −195 W` |
| 25 W Laden und 107 W Netzbezug | `GS = +82 W` |
| 705 W Entladen und 806 W Netzeinspeisung | `GS = −101 W` |

Der Einzelkopf erhält zulässige Senkungen am selben GS-Ausgang in Reihenfolge. Sinkt das Budget während ein Auftrag wartet, kann der Regler den nächsten Sollwert aus dem neueren Budget berechnen. Beim direkten Richtungswechsel zählt der nach Abzug der bisherigen Speicherwirkung gemessene Bezug oder Überschuss. Die Warteschlange prüft das aktuelle Budget vor dem Schreiben erneut. Bis zur physischen Rückmeldung bleibt die bisher beanspruchte Ladeleistung reserviert.
