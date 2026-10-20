# 0.17.0-alpha.111 — begrenzte Nachregelung bei teilweiser Fahrzeugaufnahme

## Anlass und Änderung

Am 20.10.2026 gegen 08:58 Europe/Berlin war beim EQE die Vorgabe 19 A, die gemessene Aufnahme 18,3 A / 4.100 W und der Export rund 410 W. Die zentrale Zuteilung forderte rechnerisch 20 A, begrenzte aber auf 19 A: das weiche PV-Budget von rund 4.510 W lag unter 20 × 230 V = 4.600 W. Gleichzeitig war der letzte elektrische Fortschritt als `limited` klassifiziert. Das ist ein spezifischer nicht zugelassener Nachregelversuch, kein Nachweis eines generellen Reglerstillstands.

Die Zuteilung kann nach Ablauf der bestehenden Antwortfrist bei rechtzeitigem ACK und frischen elektrischen Proben einen gemessenen 1-A-Schritt nominieren. Der Ausgang prüft unabhängig seine private Befehls-/ACK-Kette, reale Quellen, bestehende Reservierungen und das aktuelle Netzbudget. Er darf bei teilweiser Aufnahme die gemessene Leistung plus eine volle nominale Ampere-Stufe ansetzen. Im Beispiel sind das 4.330 W statt 4.600 W weiches PV-Budget.

Harte Netzbetreiber-/Geräte-/Haus-/Phasengrenzen und die gemeinsame Reservierung bleiben nominal: 20 A reservieren weiterhin 4.600 W. Ein neuer Peer- oder EHZ-Zuwachs wird nicht gleichzeitig aus dieser gemessenen Freigabe finanziert. Keine Freigabe aus unbestätigten oder veralteten Messungen, kein Kaltstart über diesen Pfad, keine Preis-/Phasenwechsel-Ausnahme. Eine unbeantwortete gemessene Schrittfreigabe finanziert keinen weiteren gemessenen Versuch. Der bestehende vollständig nominal finanzierte Ausweichpfad bleibt insgesamt auf zwei Versuche ohne elektrischen Fortschritt begrenzt; keine verlängerte Antwortfrist. Die gemessene Schrittfreigabe bleibt während der Antwortphase erhalten und darf nicht allein durch ACK wieder aufgefüllt werden.

## Verifikation

Drei neue gezielte Regressionen scheitern mit unverändertem alpha.110 und bestehen mit der Korrektur: zentrale 19→20-A-Zuteilung mit 4.600-W-Reservierung, gemessen finanzierter Ausgangsversuch und konkreter 4.100-W-/410-W-EQE-Fall einschließlich unmittelbar folgender Antwortphase. Zusätzliche Negativfälle prüfen harte Watt-/Stromgrenzen, zu wenig Überschuss, fehlende/verspätete ACKs, Frist und Quellenalter, Phasenwechsel, entzogenes Budget, neue Heizreserve sowie die Grenze von zwei erfolglosen Versuchen. Bestehende nominal finanzierte Versuche bleiben abgedeckt; ihr bisheriger Negativfall „keine nominale Finanzierung“ prüft jetzt bewusst „auch keine gemessene Finanzierung“.

Keine Änderung an produktiver Konfiguration oder Aktoren durch die Entwicklung. 600-s-Stoppverzögerung, Polling und SQL bleiben unverändert. Tests sind keine Anlagenabnahme; kein zugesagter Scoregewinn oder hochgerechnetes Energiepotenzial.

## Nach Installation

Bei natürlichem PV-Laden Vorgabe, ACK, Strom-/Leistungsantwort, Quellenzeiten und NVP gemeinsam prüfen: der begrenzte Schritt soll ausbleibende Aufnahme nicht endlos hochregeln und bei echtem Defizit oder harter Grenze sofort dem vorhandenen Schutzpfad weichen. Die Zahl unbeantworteter Versuche darf zwei nicht überschreiten. Noch keine Aussage über vollständige Pendelfreiheit des Tages.
