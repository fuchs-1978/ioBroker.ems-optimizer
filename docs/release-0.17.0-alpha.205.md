# Alpha.205 – Kontrolle nach einem bestätigten 1-A-Rücksprung wieder übernehmen

Bei einer laufenden, vom EMS gesteuerten einphasigen Ladung kann nach einem bestätigten 1-A-Schritt wieder der vorherige niedrigere Stromwert erscheinen. Das EMS kann ihn einmalig zur Wiederübernahme verwenden, wenn beide go-e-Datenpunkte den niedrigeren Wert nach der ursprünglichen Bestätigung melden und eine neue elektrische Messung dazu passt.

Die Korrektur schreibt höchstens den gemeldeten niedrigeren Strom. Bei kleinerem aktuellem Budget schreibt sie entsprechend weniger. Sie prüft die Freigaben, Quellen und Grenzen unmittelbar vor dem Auftrag erneut. Beide Stromdatenpunkte müssen den neuen Auftrag innerhalb der bestehenden Frist bestätigen. Der Versuch zählt zum vorhandenen Korrekturbudget pro Ladung. Fehlt die Bestätigung oder scheitert eine Schutzprüfung, greift der bestehende Stopp.

Der Regressionstest bildet den EQV-Fall 18 → 19 → 18 A mit 17,7 A und 4,11 kW ab. Die Tests prüfen 18 A bei passendem Budget, die sofortige Absenkung auf 17 A bei kleinerem Budget sowie die anschließende normale Regelung. Die Herkunft des zurückgesprungenen Werts bleibt in [#216](https://github.com/fuchs-1978/ioBroker.ems-optimizer/issues/216) offen.
