# 0.17.0-alpha.150 – inkrementelle SQL-Lernhistorie

Der taegliche Lauf um 00:10 las bisher alle konfigurierten 84 Tage erneut. Ein Timeout bei einer Hintergrundaktualisierung erhielt zwar bestehende Profile, plante aber keine Wiederholung.

- Initiale Abfragen werden in Tagesabschnitte statt Wochenabschnitte geteilt.
- Ein prozesslokaler Cache behaelt erfolgreich geladene Abschnitte. Weitere Laeufe laden nur neue Daten plus zwei Viertelstunden Ueberlappung, ausgerichtet auf volle Viertelstunden. Das laufende unvollstaendige Intervall wird noch nicht verwendet.
- Ueberlappende Intervalle werden ersetzt, alte Daten ausserhalb des konfigurierten Zeitfensters entfernt. Auch bestaetigt leere Antworten ersetzen die alten Werte im abgefragten Intervall.
- Wiederholungen nach bestaetigtem Abfrageabschluss sind auch fuer Hintergrundaktualisierungen erlaubt: maximal drei Versuche mit mindestens 60 Sekunden Abstand. Unbekannter Backendabschluss blockiert weitere Historienlaeufe, bis eine spaete Antwort den Abschluss bestaetigt. Es gibt keine erzwungene Freigabe nach Zeitablauf.
- Abruffehler erhalten die letzten abgeschlossenen Profile. Beim Neustart wird der Cache neu aufgebaut. Nachtraegliche Korrekturen in aelteren SQL-Intervallen werden erst beim Neuaufbau uebernommen.

Die Ausgangsregelung und ihre Schutzgrenzen werden nicht veraendert. Tests decken inkrementelle Bereiche, Aufteilung, Wiederaufnahme, Duplikate, Profilbeibehaltung und Abfragesperren ab. Der reale naechtliche Betrieb nach Installation bleibt zu pruefen.
