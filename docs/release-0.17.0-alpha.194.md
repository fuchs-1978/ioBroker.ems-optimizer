# 0.17.0-alpha.194 – Ladeende erkennen und an das nächste Fahrzeug übergeben

Beim Mii zeigte die Fahrzeug-App 100 %, während der EMS-SoC noch 80 % betrug. Die Wallbox meldete `car=4` (Finish, Fahrzeug angeschlossen) und nahm keine Ladeleistung mehr auf. Der bisherige Regler wartete auf den Ziel-SoC oder die allgemeine 15-Minuten-Pause für ausbleibende Leistungsaufnahme. Erst die manuelle SoC-Korrektur löste die Übergabe aus.

## Erkennung und Übergabe

- Eine frische, bestätigte und qualitätsgültige `car=4`-Meldung kann jetzt nach zehn Sekunden durchgehend bestätigter elektrischer Ruhe eine Ladeende-Pause auslösen. Erforderlich bleiben eine bestehende eigene Ladefreigabe, bestätigter Strombefehl, höchstens 20 W gemessene Ladeleistung und höchstens 0,5 A auf jeder Phase. Alle beteiligten Quellen müssen frisch und nach dem laufenden Befehl gemessen sein. Offene Befehle, Fehler, Phasenwechsel und angenommene Schattenantworten qualifizieren nicht.
- Die Pause nutzt `Devices.WallboxN.NoDrawPause_JSON` mit `kind: "charger-finished"` und die vorhandenen NoDraw-Zustände. Andere Fahrzeuge werden bei der Zuteilung bevorzugt. Der normale AUS-Ablauf hält Eigentum und Leistungsreserve bis zur unabhängigen AUS-Bestätigung und elektrischen Ruhe fest.
- Eine zuvor in dieser laufenden Sitzung tatsächlich beobachtete Ladung kann ihre Startqualifikation einmal an das nächste geeignete Fahrzeug übertragen. Die vorhandene Übergabe prüft weiterhin SoC und Freigabe des Empfängers, Phasen, Quellen, Mindestleistung, Budget und harte Grenzen. Die ursprüngliche Ladebeobachtung bleibt nur für die zehn Sekunden Ladeende-Bestätigung plus zwei Kontrolllücken gültig, höchstens 30 Sekunden; ihre Zeit wird durch Nullleistung nicht erneuert. Eine alte gespeicherte Pause oder eine von Anfang an leistungslose Freigabe erzeugt keinen verkürzten Start.
- Die Übergabe funktioniert sowohl bei einzelnem als auch bei parallelem Laden. Eine kurze Auswahllücke während der noch laufenden AUS-Bestätigung verliert die beobachtete Ladung nicht. Reservierte Watt bleiben währenddessen gebunden.
- Eine weiterhin frische Finish-Meldung verhindert einen periodischen neuen Ladeversuch. Abstecken, bewusste Fahrzeugfreigabe AUS oder eine neue manuelle Mindeststromanforderung können die Pause über die bisherigen Wege zurücksetzen. Sobald Finish nicht mehr anliegt, bleibt der normale 15-Minuten-Wiederholungsweg verfügbar, ohne ein arbeitendes anderes Fahrzeug zu verdrängen. Die Pause übersteht einen Adapterneustart.

## Hinweis statt erfundenem SoC

Die Übersicht und Hinweise zeigen für das betroffene Fahrzeug zum Beispiel:

> Mii: Ladeende gemeldet – möglicherweise voll geladen. Bitte SoC und Fahrzeug-Ladelimit prüfen; EMS-SoC 80 %.

Der Hinweis bleibt sichtbar, solange die Ladeende-Pause besteht und kein gültiger EMS-SoC bereits den Zielwert erreicht. Ein Fahrzeug-Ladelimit kann ebenfalls Ladeende verursachen; die Wallbox-Meldung beweist keine 100 %. Fahrzeug-SoC, SoC-Schätzung, manuelle Korrekturen und die vorhandene Plausibilitätswarnung werden durch diesen Hinweis nicht verändert.

Die allgemeine 15-Minuten-Erkennung für sonstige bestätigte Nichtaufnahme bleibt bestehen. Diese Änderung führt keine neue Stromtoleranz und keine zusätzliche Netzbezugsfreigabe ein.

## Validierung

Deterministische Anlagentests verbinden echte Zuteilung und echten Ausgang mit verzögerten unabhängigen Bestätigungen. Ein zuvor ladendes Fahrzeug mit veraltetem SoC und Finish übergibt nach der Ladeende-Erkennung an sein wartendes Gegenüber, ohne die konfigurierte 300-Sekunden-Startverzögerung zu wiederholen. Ohne AUS-Bestätigung bleiben Eigentum und Watt reserviert und das andere Fahrzeug startet nicht. Eine von Beginn an leistungslose Freigabe erhält keinen Übergabevorteil. Diese Fälle werden jeweils mit und ohne paralleles Laden geprüft.

Weitere Regressionen prüfen die Zehn-Sekunden-Frist, unterbrochene Finish-Meldungen, echte Restleistung, schlechte oder alte Quellen, Phasenwechsel, Neustart und ausbleibenden Wiederstart bei weiterhin gemeldetem Finish sowie den fahrzeugbezogenen Hinweis und sein Verschwinden nach Korrektur oder Rücksetzen. Das sind Software- und Simulationstests; die reale Installation erfolgt durch den Betreiber.
