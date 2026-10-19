# 0.17.0-alpha.107 – Kleine Defizite vor erster Messung nach ACK

## Beobachtung und Evidenzgrenze

Am 19.10.2026 um 15:32:38 Uhr Europe/Berlin wurde unter alpha.106 eine Vorgabe von 9 auf 6 A zurückgenommen. Um 15:32:37,305 wurden 156,5 W Bezug erfasst. Die normalen Strom-/Leistungshistorien belegen den Sprung und die kurze Bezugsspitze. Die begrenzte Recorder-Abfrage für 15:31:30–15:32:50 lieferte keine Datensätze; die genaue historische interne Entscheidung ist deshalb nicht vollständig rekonstruiert.

Ein dazu passender Grenzfall wurde reproduziert: Die vorhandene Leistungs-/Strommessung stammt nach dem Befehl, aber vor dessen bereits vorliegendem ACK. Der bisherige Schutz der relativen Rücknahme verlangte eine Messung nach dem ACK und fiel deshalb trotz bekannter bestehender Vorgabe auf die nominelle Softgrenze zurück. Auch der Zwischenzyklus mit noch nicht übernommenem ACK war betroffen.

## Korrektur

Für Rücknahmen darf eine frische Messung nach dem Befehl, aber vor dessen ACK verwendet werden, wenn die vorhandene Vorgabe rechtzeitig bestätigt ist und sich noch in der ursprünglichen Antwortfrist befindet. Zuteilung und Ausgang behandeln auch den bestätigten, noch nicht übernommenen einzelnen Ampere-Schritt als bestehende Reservierung. Die relative Reduktion muss ausdrücklich zugeteilt sein und innerhalb der vollen bisherigen nominalen Schutzreserve liegen.

Der Ausgang verlangt zusätzlich den privaten ursprünglichen Zulassungsnachweis und unveränderte Fremd-/Heiz-/Phasenreserven. Alte Messungen von vor dem Befehl, fehlende Bestätigung/Reservierung, Ablauf der Antwortfrist und engere harte oder explizite Fahrzeuggrenzen erhalten keine Ausnahme. Dies bestätigt keine elektrische Aufnahme und erlaubt keine zusätzliche Stromerhöhung. Start-, Phasen-, Tarif-, Polling- und 600-s-Abschaltpolitik bleiben unverändert. Keine neuen Admin-Felder.

## Prüfung und Betriebsabnahme

Regression in Zuteilung und Ausgang: vorhandene 9-A-Vorgabe, 1730 W alter Aufnahme, 156,5 W Bezug, Leistungssample vor ACK. Die passende relative Rücknahme lautet 8 A; alpha.106 fiel auf 6 A. Beide ACK-Verarbeitungsreihenfolgen werden geprüft. Gegenproben prüfen engere Freigaben, harte Strom-/Gesamtgrenzen, Messung vor Befehl, fehlendes ACK, fehlende Reservierung, neue Heizreserve und Ablauf.

Tests und Paketprüfung ersetzen keine reale Abnahme. Nach Nutzerinstallation sind natürliche Lastwechsel, Größen und Häufigkeit der Rücknahmen sowie ausstehende elektrische Antworten zu beobachten. Aus dem kurzen asynchronen Abschnitt wird kein belastbarer kWh-Gewinn behauptet; die genaue Zuordnung des historischen Sprungs bleibt ohne Recorderdaten begrenzt.
