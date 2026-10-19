# Alpha.102 — sichtbarer Historienfortschritt im Log

Der Neustart nach Alpha.101 wartete nach einem SQL-Timeout auf den erneuten Historienaufbau. Der Fortschritt war bisher nur im Datenpunkt History.Status zu sehen. Jetzt gibt es begrenzte Logmeldungen je Historienabruf:

```text
info: SQL-Historie: Start; 9 Quellen, 45 Tage
info: SQL-Historie: lese Quelle 1/9: javascript.0.PV.Eigenerzeugung (0.0 s seit Start)
info: SQL-Historie: lese Quelle 2/9: <Datenpunkt-ID> (8.2 s seit Start)
...
info: SQL-Historie: abgeschlossen nach 72.5 s; bereit; ... Hauslastwerte, ... Grundlastwerte, ... PV-Werte
```

Die Zahlen und Quellen im Beispiel sind illustrativ; tatsächlich werden konfigurierte Anzahl, Zeitraum, Datenpunkt-ID, gemessene Laufzeit und Ergebnis ausgegeben. Pro Quelle eine Fortschrittsmeldung, nicht pro SQL-Teilabfrage oder Regeltakt. Die Meldungen gelten auch für reguläre Hintergrundaktualisierungen.

Bei unvollständigen Profilen lautet die Abschlussmeldung unvollstaendig, Startfreigabe fehlt (warn). Bei einem Fehler enthält die vorhandene Warnung zusätzlich die Laufzeit und zuletzt gelesene Quelle. Ein tatsächlich beginnender automatischer Start-Wiederholungsversuch wird mit Versuch X/3 auf info gemeldet; dies verspricht keinen erfolgreichen Abschluss. Die Historienbereitschaft ist weiterhin von gültigem Fahrplan und tatsächlichem Anlagenbetrieb zu unterscheiden.

Keine Änderung an Timeout, Wiederholungsbedingungen, Abfragen, Parallelität, Aktorlogik oder produktiver Konfiguration. Bestehende Historienprüfungen kontrollieren zusätzlich die Anzahl der Fortschrittsmeldungen und unterscheiden erfolgreichen von unvollständigem Abschluss.
