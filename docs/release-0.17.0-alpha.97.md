# 0.17.0-alpha.97 – Zeitversetzte SMA-/Wallboxantwort

## Befund und Korrektur

Am 19.10.2026 um 10:31:30 MESZ wurde eine bereits laufende 1P-Ladung mit rund
1.370 W bei 785 W Einspeisung auf 9 A erhöht. Der ACK traf rechtzeitig ein.
Die SMA-Messung enthielt die Laständerung bereits (31 W Restexport), während
der go-e-Cache noch 1.350 W aus dem vorherigen Zustand enthielt. Um 10:31:36,094
folgte deshalb eine vorzeitige Rücknahme auf 6 A. Die 2.050-W-Wallboxmessung
traf erst etwa 400 ms später ein. Originalbezug: Sitzung 1792397455939,
Sequenzen 8462 und 8525. Der begrenzte SQL-Abruf enthält keine lückenlose
Tagesauswertung; frühe Deltas ohne Vollsnapshot sind nicht als vollständig
rekonstruierte Entscheidungen ausgewertet worden.

Der Ausgang hält jetzt ausschließlich eine zuvor zugelassene laufende Erhöhung,
wenn der ACK passt, die gültige Wallbox-Leistungsmessung hinter beiden gültigen
Netzquellen liegt und deren Messung keinen Bezug über der konfigurierten Toleranz
zeigt. Peer-, Heizungs- und Phasenreserven dürfen gegenüber der Zulassung nicht
wachsen. Die ursprüngliche Antwortfrist wird weder neu gestartet noch verlängert.

Keine neue Ladefreigabe, weitere Erhöhung oder virtuelle Bestätigung entsteht.
Abgelaufene Fristen, Quellenfehler, echte Bezugsüberschreitungen, Phasenwechsel,
Tarifwechsel und alle Geräte-/Hausanschluss-/Netzbetreibergrenzen bleiben wirksam.
Die nominalen Reservierungen bleiben erhalten. Diagnoseentscheidung:
`await-asynchronous-meter-response` unter `IncreaseBudget_JSON`.

## Abnahme

Regression mit den beobachteten Leistungswerten und relativen Zeitstempeln;
zusätzliche 3P-Prüfung und Gegenprüfungen für Defizit, harte Begrenzung,
Hausanschluss, alte Quellen, zusätzliche Peer-/Heizerreserven, fehlenden ACK,
fehlende Zulassung, abgelaufene Frist und zeitlich passende Messungen.
Softwareprüfungen sind keine reale Betriebsabnahme. Nach Installation sind
natürliche Stromerhöhungen und die originale Antwortfrist erneut zu beobachten.

Kein produktives System wurde durch die Entwicklung verändert. Kein belastbarer
Tageswert für zusätzlich nutzbare Energie wurde aus diesem Kurzausschnitt abgeleitet.
