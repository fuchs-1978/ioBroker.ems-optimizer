# 0.17.0-alpha.201 — Pflichtwärme und kurze Ladeunterbrechungen

## Beobachtung

Am 4. November stoppte der EQV um 14:12:26 und erneut um 14:56:36 Uhr Europe/Berlin. Beide Male war die reale Warmwasser-Pflichtwärme aktiv; der Fühler Mitte unten lag unter der konfigurierten Mindesttemperatur von 40 °C. Der gültige Fahrplan und die Historie blockierten nicht. Beim zweiten Stopp waren trotz laufender 6-A-Ladung rund 802 W Einspeisung sichtbar. Pflichtwärme beanspruchte das Budget, die reguläre 600-Sekunden-Abschaltverzögerung endete und anschließend war wieder eine volle 300-Sekunden-Startqualifikation nötig.

Der Wärmevorrang endete beim zweiten Ereignis bereits um 14:57:23; der Starttimer begann um 14:57:24 und die reale Freigabe folgte erst um 15:02:34. [Ausgewählte zusammengehörige Diagnosewerte](evidence/thermal-pauses-2026-11-04.json) dokumentieren beide Ereignisse. Die erste Unterbrechung hatte beim Abschaltmoment zusätzlich echten Netzbezug; diese Freigabe hebt keine reale Unterdeckung auf.

## Gemeinsames Budget

Die bevorzugte, bereits elektrisch bestätigte einphasige Ladung kann im parallelen Allokator ihren Mindeststrom behalten, wenn danach die tatsächlich nutzbare EHZ-Mindestleistung ins reale gemeinsame Budget passt. Manuelle/Mindest-SoC-Verpflichtungen anderer Fahrzeuge bleiben geschützt. Die obere mittlere Speichertemperatur und die Austrittstemperatur müssen mindestens die konfigurierte Warmwasser-Mindesttemperatur erreichen. Ohne diese warme Reserve bleibt der volle Wärmevorrang erhalten. Die feste WB/EHZ-Aufteilung, kalte Starts und unbestätigte/mehrphasige laufende Fahrzeuge erhalten keinen zusätzlichen Mindestanspruch.

Zusätzliche Fahrzeugleistung wird für Wärme zurückgenommen. Ein ausdrücklich validierter `thermalCurrentCapA` im gemeinsamen Auftrag sorgt dafür, dass der Ausgang eine angeforderte Absenkung nicht durch seine normale Halteregel für einen bestätigten höheren Strom aufhebt. Der Allokator verwendet dabei die nominelle Stromgrenze: ein zwischen Befehl und ACK schon geänderter Messwert darf die gewünschte Absenkung nicht unter den Fahrzeug-Mindeststrom rechnen. Frühere höhere Fahrzeug- und Heizreserven gelten weiterhin bis zu ihrer physischen Freigabe. Es entsteht keine neue Erlaubnis für Netzheizung oder Netznachladung.

## Wiederanlauf nach Wärmeunterbrechung

Ein nur im laufenden Prozess geführter Nachweis beobachtet den elektrisch bestätigten, bevorzugten Ladeauftrag samt gültigen Fahrzeug-, SoC-, Phasen-, Preis- und Quellendaten. Er wird nur für einen tatsächlich während des Wärmevorrangs budgetbedingt gestoppten Auftrag übernommen. Ein normales PV-Ende, Fehlerstopp oder eine bloße alte Zielvorgabe erzeugt diesen Nachweis nicht.

Der Nachweis läuft unverlängerbar 15 Minuten nach dem tatsächlichen Stopp ab. Nach Ende des Wärmevorrangs müssen das reale Mindestbudget plus die konfigurierte Startreserve 15 Sekunden zusammenhängend und frisch verfügbar sein. Erneuter Wärmevorrang beginnt diese kurze Prüfung neu. Anschließend kann dasselbe Fahrzeug seine Ladung fortsetzen, ohne erneut den vollen normalen Starttimer zu durchlaufen. Unbekannte/verlorene Quellen, Temperaturfehler, AUS, Freigabe-/Prioritätswechsel, Zielerreichung, Phasen-/Preis-/Grenzänderungen, eine Beobachtungslücke oder unzureichendes Wiederanlaufbudget verwerfen den Nachweis. Er wird nicht aus SQL/States wiederhergestellt und überlebt keinen EMS-Neustart. Eine danach neu elektrisch geprüfte Übernahme eines tatsächlich weiter ladenden Autos darf einen neuen Nachweis aufbauen; alte Übernahmemarker allein reichen nicht.

Diese Qualifikation ersetzt ausschließlich den doppelten Starttimer. Bestätigtes AUS, elektrische Ruhe, bestätigte Topologie, sichere Strom-/Hausanschluss-/Netzbetreibergrenzen sowie die reale Rücknahme sämtlicher EHZ-/Peer-Reservierungen bleiben erforderlich. Deshalb ist die tatsächliche Wiederanlaufzeit nicht pauschal 15 Sekunden. Eine neue Unterbrechung benötigt eine neu beobachtete reale Ladung. Neue Ladevorgänge behalten den konfigurierten normalen Starttimer.

## Diagnose und Prüfung

`AllocationDiagnostics_JSON` enthält `thermalRunningMinimumW` und `start.thermalResume` mit Grund, Gültigkeitsende und kurzer Qualifikationsrestzeit. Die bestehende Anzeige der Startwartezeit zeigt diese kurze Prüfung ebenfalls. Es kommen keine neuen States oder Admin-Parameter hinzu.

Anlagensimulationen verwenden den echten Allokator und die echten Ausgangszustandsmaschinen mit verzögerten ACKs und Heizantworten. Sie prüfen gemeinsam versorgte Pflichtwärme, echten Wärme-Stopp, normalen PV-Stopp, kalten oberen Speicher, harte gemeinsame Grenzen, Fehler-/Freigabe-/Quellen-/Preis-/Phasenwechsel, Datenlücken, Temperaturpendeln, Ablauf, wiederholte reale Ladeepisoden und verspätete physische Heizreduktion. Gesamt-, Lint-, Admin-/Metadaten-, Paket-, installierte Artefakt- und historische Vergleichsprüfungen gehören zur Freigabe. Der natürliche Wiederanlauf muss nach manueller Installation gesondert bestätigt werden; Live-Anlagenparameter oder Geräte wurden für die Umsetzung nicht geändert.
