# Echtzeitbudget und Phasenentscheidung ab alpha.43

## Beobachtung und Umfang

Am 07.10.2026 um 12:38 Europe/Berlin lief alpha.41. Der EQE hatte 9 A / 3P vorgegeben, die reale Leistung betrug 5.890 W, das gemessene Netz zeigte rund 507 W Bezug bei einem Ziel von −100 W. Das Verteilerbudget lag bei 5.283 W. Die bisherige Rundung eines negativen Leistungsunterschieds kleiner als 690 W ergab keinen Stromschritt. Die neue Rundung reduziert außerhalb des konfigurierten Totbands; innerhalb des Totbands bleibt die Stromvorgabe bestehen.

Dieses Budget rechtfertigt eine kleinere 3P-Stromvorgabe, keinen Wechsel auf 1P. Der zusätzliche Nutzerauftrag verlangt, auch bei künftig länger anhaltendem realem Budgetmangel unter der 3P-Mindestleistung eine verzögerte 1P-Entscheidung zu ermöglichen. Die Prognose kann von der realen PV-, Hauslast- und Geräteantwort abweichen.

## Entscheidungsregeln

- Nur die ausgewählte, freigegebene EMS-Wallbox erhält eine Live-Budgetentscheidung. Feste Topologie und bestätigte externe Skriptführung bleiben getrennt.
- Das rekonstruierte Budget enthält die bereits laufende kontrollierte Last und das gemessene Netzdefizit bzw. den Überschuss. Ausschließlich autorisierter Netzladestrom darf ergänzt werden. Geräte- und gemeinsames Leistungsbudget begrenzen die Entscheidung; Pflichtwärme und Pflichtladung behalten ihre Regeln.
- 3P → 1P: unter der 3P-Mindestleistung minus Totband, zugleich mindestens 1P-Mindestleistung plus Startreserve. Standardmäßig 120 s durchgehend gültiges Budget.
- 1P → 3P: über der nutzbaren 1P-Maximalleistung plus Reserve und mindestens der 3P-Mindestleistung plus Reserve. Standardmäßig 300 s durchgehend gültiges Budget.
- Die bestehende Mindesthaltezeit zwischen Phasenentscheidungen gilt zusätzlich. Carstens am 07.10.2026 gelesene Einstellung betrug 15 min; sie wird nicht automatisch geändert.
- Im Livebetrieb erzwingt eine Prognose- oder Abfahrtsdringlichkeit allein keinen Wechsel auf 3P. Der Fahrplan bleibt bestehen; die Phasenqualifikation braucht ein reales bzw. ausdrücklich autorisiertes Budget. Die bestehende Pflichtladung bis zum Mindest-SoC oder nach manueller Mindeststromvorgabe bleibt erhalten, stellt jedoch keine neue Netzfreigabe aus der Prognose her.
- Ungültige ACK-/Qualitäts-/Alterswerte, Beobachtungslücken oder ein offener Phasenübergang setzen die Qualifikation zurück. Unbekannte Leistung wird nicht als 0 W gewertet. Budgethysterese hält die aktuelle Stellung.
- Während der Übergabe wird die alte elektrische Last weiter reserviert. Die gemessene 3P-Antwort darf nicht mit dem Watt-pro-Ampere-Wert der angeforderten 1P-Stellung verrechnet werden. Die bestehende sichere Ausgangssequenz prüft Modus-ACK, Strom-/Freigabe-ACK und elektrische Antwort weiterhin selbst.

## Nachvollziehbare Diagnose

`Control.WallboxN.PhaseDecision_JSON` zeigt Grund, Budget, Schwellen, bestätigte Phasen, Kandidatenbeginn, Qualifikations- und Haltezeit. `PhaseDecisionStatus` und `PhaseDecisionRemaining_s` sind separat lesbar. `AllocationDiagnostics_JSON.phaseDecision` macht dieselbe Entscheidung im vorhandenen produktiven DecisionRecord verfügbar. Eine angeforderte Stellung ist keine reale elektrische Bestätigung.

## Nächste Betriebsanalyse

1. Nach manueller Installation die reale Version und Einstellungen erneut lesen. Keine neue Ausgangsfreigabe wird durch das Update erteilt.
2. Bei längerem schwachem Budget prüfen: 3P-Stromreduktion, durchgängige gültige Quellen, Ablauf beider Timer, 1P-Anforderung, Modusschreibecho, unabhängige Modus-ACK, Fahrzeugpause und frische elektrische 1P-Antwort. Ziel ist ein erhaltener Ladeblock ohne zusätzliche allgemeine Startzeit.
3. Eine kurze PV-Delle, Quellenlücke und ein ACK-false-Echo müssen getrennt erkennbar sein. Ein neuer Timer darf nicht rückwirkend über eine Datenlücke weiterlaufen.
4. Bei wieder ausreichend hohem Budget analog den verzögerten 1P→3P-Wechsel prüfen. Bis zur realen Laständerung darf der Heizstab keine nur rechnerisch freigewordene Leistung erhalten.
5. Stopptimer und Phasenreaktionsfristen gemeinsam prüfen. Bei 120 s Stoppverzögerung und 120 s Abwärtsqualifikation kann der reale Stopp vor vollständigem Phasenwechsel anstehen. Die am 07.10.2026 gelesenen 600 s vermeiden diese unmittelbare Gleichzeitigkeit, beweisen aber keinen erfolgreichen Wechsel. Schutzstopps und Fristen werden nicht abgeschwächt.

Softwaretests prüfen Qualifikation, Datenfehler, Mindesthaltezeit, Topologiereserve und Regressionen. Ein synthetisch bestätigter Ausgang beweist weder Hardwareverhalten noch einen bestandenen Live-Lasttest. Neue Scorepunkte ergeben sich ausschließlich aus neuen Betriebsnachweisen.

## Separater Befund: Nennleistungsgrenze

Der Diagnoseverlauf zeigte am 07.10.2026 um 12:44:25 857 W Rückspeisung, 4.390 W reale EQE-Leistung und 7 A Befehl bei einem 8-A-Verteilerziel. Das gemessene Budget von rund 5.147 W deckte die konservative Ausgangsanforderung von 5.520 W für 8 A / 3P nicht. Ab 12:44:40 nahm der EHZ etwa 611 W auf. Dieser kurze Cache-Verlauf ersetzt keine vollständige SQL-Historie. Die Nennleistungsprüfung bleibt unverändert; eine Optimierung benötigt eine separate Reproduktion und Nachweise zur sicheren Stromerhöhung, keine spekulative Lockerung der Ausgangsgrenzen.
