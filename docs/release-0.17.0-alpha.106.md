# 0.17.0-alpha.106 – Gemessenen PV-Schritt ausregeln lassen

## Befund

Alpha.105 lief am 19.10.2026 um 15:16 Uhr (Europe/Berlin). Die Live-Diagnose um 15:16:20 zeigte eine Rücknahme von 13 auf 11 A trotz 68 W Rückspeisung. Die Zuteilung erlaubte noch 13 A. Die Stromvorgabe war bestätigt, ihre elektrische Antwort noch offen; die Wallbox meldete 2650 W / 11,9 A vor dem neueren Netzsample. Die begrenzte Einzelabfrage der Recorder-Historie für 15:14:15–15:15:35 lieferte zu diesem Zeitpunkt keine Daten. Die Diagnose stützt sich deshalb auf Live-Zustände, normale Ampere-/Leistungshistorie und die reproduzierte Entscheidung, nicht auf eine behauptete vollständige Recorder-Rekonstruktion.

Der bestehende asynchrone Halteschutz schloss gemessene Ein-Ampere-Schritte explizit aus. Deren weiterhin reservierter voller Schritt konnte nach bereits einsetzender Aufnahme erneut als ungedeckte Leistung erscheinen.

## Änderung

Der Halteschutz umfasst nun genau den ursprünglich zugelassenen gemessenen Ein-Ampere-Schritt. Sein privater Zulassungsnachweis muss zu Strom, Phasen, Zeitpunkt und Aufnahmebasis passen. Erforderlich bleiben rechtzeitiges ACK, aktuelle Netzbeobachtung nach dem ACK, ursprüngliche unverlängerte Antwortfrist, kein Tarif-/Phasenwechsel, keine Schattenannahme und keine wachsenden Fremd-/Heiz-/Phasenreserven. Ein neuer Wallbox-Poll am alten Niveau darf die begrenzte Wartephase ebenfalls nicht sofort abbrechen.

Weder der Schritt-Nachweis noch seine Nennleistungsreserve werden dabei freigegeben. Eine weitere Erhöhung bleibt bis zur nachgewiesenen elektrischen Antwort gesperrt. Tatsächlicher Netzbezug oberhalb der bestehenden Toleranz sowie harte Grenzen wirken weiterhin. Keine Änderung an Admin-Werten, Polling, 600-s-Abschaltverzögerung oder Produktivkonfiguration.

## Prüfung und offene Betriebsabnahme

Regression: 12 → 13 A bei 2660 W / 197 W Überschuss, danach 2650 W / 68 W Überschuss mit nachlaufender Wallboxmessung. Alpha.105 nimmt zurück; alpha.106 wartet begrenzt, ohne einen zweiten Schritt zuzulassen oder die Frist zu erneuern. Eine echte Antwort gibt anschließend den Nachweis frei. Gegenproben prüfen Defizit, harte Grenzen, Ablauf, fehlendes ACK, falschen/fehlenden Zulassungsnachweis und wachsende Heizreserve.

Erwarteter Nutzen: weniger unnötige Rücknahmen und Wiedererhöhungen. Ein kWh-Gewinn ist aus diesen kurzen asynchronen Daten noch nicht belastbar quantifizierbar. Erst natürliche Ereignisse nach Nutzerinstallation können reale Regelruhe und Energiegewinn belegen; Softwaretests sind keine Anlagenabnahme.
