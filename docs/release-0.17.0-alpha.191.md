# 0.17.0-alpha.191 – Fahrzeug-SoC-Warnungen in der Übersicht

Eine aktive Mii-Plausibilitätswarnung war unter `Vehicles.Wallbox0.SoCWarning` sichtbar, während `Diagnostics.Attention` weiterhin „Keine aktuellen Hinweise“ meldete. Die Diagnose übernahm die gespeicherten Warnzustände bisher nicht.

## Änderung

- Die rein lesende Diagnose übernimmt `SoCWarning` und `SoCWarningText` für alle drei Fahrzeuge aus dem vorhandenen Cache. Nur bestätigte Zustände ohne Qualitätsfehler mit positivem, nicht zukünftigem Zeitstempel werden berücksichtigt. Eine gültige gespeicherte Warnung bleibt auch dann sichtbar, wenn ihr Wert seit längerer Zeit unverändert ist.
- `Diagnostics.Overview` nennt die betroffenen Fahrzeuge. `Diagnostics.Attention` zeigt den Hinweis mit Fahrzeugname und begrenztem Warntext; bei fehlendem Text erscheint eine Aufforderung zur Prüfung am Fahrzeug oder in der App.
- In `Diagnostics.Devices` und `Diagnostics.Live` steht beim betroffenen SoC zusätzlich „(unsicher)“. Der Wert wird weiterhin als Schätzung angezeigt; die Warnung beweist keinen tatsächlichen Fahrzeug-SoC.
- `Diagnostics.Snapshot_JSON` enthält je Fahrzeug `socWarning` und `socWarningText`. Fehlende oder nicht boolesche Warnwerte bleiben unbekannt. Bei zurückgesetzter Warnung wird alter Warntext nicht weiter angezeigt.
- Die Ergänzung erfolgt ausschließlich in einer Diagnosekopie. Kein Warnzustand, SoC-Anker, Energiezähler, Fahrplan, Ladebefehl oder Regler-Gültigkeitswert wird dadurch geändert. Die bestehende Größenbegrenzung und die 16 Diagnoseausgaben bleiben erhalten.

## Prüfung

Regressionen decken den beobachteten Fall mit 55,9 % Schätzung und aktiver Warnung ab, alle drei Fahrzeuge, begrenzte und fehlende Warntexte, das Löschen einer Warnung sowie bestätigte gespeicherte Warnungen, fehlerhafte Qualität, Befehls-Echos, ungültige Zeitstempel und nicht boolesche Werte. Der Herausgeber schreibt dabei weiterhin ausschließlich seine eigenen Diagnosezustände. Die vorhandenen SoC-Schätzungs- und Korrekturtests bleiben unverändert.

## Grenzen

Die Änderung macht eine bestehende Unsicherheit sichtbar; sie korrigiert keinen möglicherweise verspäteten VW-Ausgangswert. Die Fortschreibung ab echtem VW-Quellzeitpunkt bleibt in [Issue #320](https://github.com/fuchs-1978/ioBroker.ems-optimizer/issues/320) abhängig von [vw-connect #467](https://github.com/TA2k/ioBroker.vw-connect/issues/467) zurückgestellt.

Lange SQL-Lesezeiten bleiben Gegenstand der bestehenden Recorder-Diagnose; diese Anzeigeänderung verändert keine SQL-Fristen oder Datenbankparameter. Lasso/Median und die produktive Steuerung bleiben unverändert. Die Installation erfolgt separat durch den Betreiber; eine erfolgreiche Softwareprüfung ersetzt keine reale Sichtprüfung der neuen Anzeige.
