# 0.17.0-alpha.108 – Bestätigungsübergang ohne 1-A-Rücknahme

## Beobachtung und Reproduktion

Unter alpha.107 wechselte die EQE-Vorgabe am 19.10.2026 unter anderem um 15:46:08 von 11 auf 10 A, um 15:46:16 zurück auf 11 A und um 15:46:24 wieder auf 10 A. Vor den Rücknahmen wurden rund 106 beziehungsweise 97 W Rückspeisung erfasst. Das ist eine beobachtete Messfolge; eine vollständige historische interne Entscheidungsrekonstruktion liegt dafür nicht vor.

Der dazu passende Bestätigungsübergang wurde reproduziert: Der zentrale Verteiler verarbeitet bereits den später bestätigten 2430-W-Messwert, sieht aber noch eine ausstehende Fahrzeugantwort und teilt 10 A zu. Der Ausgang bestätigt kurz danach 10,8 A bei Vorgabe 11 A anhand desselben Messwerts. Sein bisheriger Halteschutz verlangte jedoch eine gegenüber der Zuteilung neuere Leistungsmessung; die identische Messung schloss ihn aus. Nach Rücknahme entstand wieder Überschuss zum Erhöhen.

## Korrektur

Eine identische Leistungsmessung genügt jetzt ausschließlich bei ausdrücklicher Herkunft des Übergangs: Die zeitlich passende Zuteilungsdiagnose sah noch vehicle_response; die elektrische Bestätigung erfolgte erst nach dieser Zuteilung. Die aktuelle Vorgabe muss übereinstimmen, ihr Strom muss frisch tatsächlich erreicht sein, die volle nominelle Reservierung weiter bestehen und das aktuelle Netzbudget die Aufnahme decken. Neue Fremd-/Heizlastzusagen, fehlende Reserven oder engere harte Grenzen verhindern das Halten.

Zusätzlich wird die noch nicht übernommene Strombestätigung eines einzelnen Ampere-Schritts korrekt bis zur regulären ACK-Verarbeitung gehalten. Es wird dabei kein neuer Stellbefehl und keine zusätzliche Erhöhung erzeugt. Die nächste normale Zuteilung verarbeitet die nun veröffentlichte Bestätigung. Wusste sie die Bestätigung bereits oder liegt eine neuere widersprechende Zuteilungsmessung vor, gilt die Ausnahme nicht.

Keine Änderungen an Admin-Feldern, Polling, Reaktionsfristen oder 600-s-Abschaltverzögerung. Keine Installation oder produktive Konfigurationsänderung durch die Entwicklung.

## Prüfung und Abnahme

Regressionen prüfen beide ACK-Reihenfolgen, reale Antwortverarbeitung 10→11 A bei 2430 W/10,8 A und 97 W Export sowie die nächste normale Verteilerentscheidung mit unverändertem Messwert. Gegenproben prüfen bereits bekannte/vorherige Bestätigung, neuere Zuteilungsquelle, echtes Defizit, harte Stromgrenze, entzogene Reservierung, neue Heizlast und unzureichenden Stromnachweis. Die neuen Ausgangsregressionen scheitern am unveränderten alpha.107.

Erwartet werden weniger unnötige Rücknahmen und Wiedererhöhungen. Eine belastbare Energiemenge ist aus dem kurzen asynchronen Abschnitt nicht ableitbar. Reale Regelruhe und Energiegewinn bleiben nach Nutzerinstallation an natürlichen Ereignissen zu belegen. Softwaretests sind keine Anlagenabnahme.
