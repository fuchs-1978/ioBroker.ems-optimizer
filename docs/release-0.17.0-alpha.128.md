# 0.17.0-alpha.128 – Gemessene PV-Stromschritte beim festen 1P-Mii

## Beobachteter Anlass und Ursache

Am 23.10.2026 gegen 11:44:38 MESZ lief der Mii auf alpha.127 mit bestätigten 6 A, gemessenen 1.310 W und etwa 258,5 W Einspeisung. Das verfügbare Budget betrug 1.568,5 W, gerundet 1.569 W. Die zentrale Zuteilung verwarf die vorhandene elektrische Antwort (`actualPowerW:null`, `responseBasis:nominal`) und blieb bei 6 A. Der nächste nominelle Stromschritt benötigt 1.610 W; von der gemessenen Antwort aus sind 1.310 + 230 = 1.540 W zu erwarten. Diese Aufnahme ist eine Regelannahme, kein garantierter Fahrzeugverbrauch. Die Einspeisung war eine Momentaufnahme, kein belegter dauerhafter Überschuss oder quantifizierter Energieverlust.

Der Mii ist fest einphasig konfiguriert, Phasenumschaltung deaktiviert und ohne psm-Quelle. Der bisherige Vergleich `confirmedPhases !== targetPhases` behandelte die dabei fehlende Modusbestätigung wie einen laufenden Phasenwechsel. Dadurch war die vorhandene gemessene Antwort trotz gültiger sonstiger Nachweise für die PV-Quantisierung gesperrt.

## Änderung und Reservierung

Nur umschaltbare Wallboxen benötigen für diesen Vergleich eine gültige passende Phasenmodus-Rückmeldung. Tatsächlich abweichende Ausgangstopologie, offene Phasenaufträge und laufende Phasenübergänge sperren leistungsbasierte Schritte weiterhin. Feste 1P-Wallboxen dürfen bei bestätigtem Stromauftrag, frischer qualifizierter elektrischer Rückmeldung und ausreichendem PV-Budget den bestehenden begrenzten 1-A-Schritt nutzen. Quellenalter, ACK, Qualität, Antwortzustand, Stromgrenzen und gemeinsame Budgets bleiben maßgeblich.

Die gemessene Leistung wird für die weiche PV-Regelung verwendet. Sie ersetzt nicht die harte Schutzreserve: Ein neuer 7-A-Auftrag reserviert mindestens 1.610 W bei 230 V/1P. Eine ältere höhere Reserve sinkt weiterhin erst nach passendem Strom-ACK und frischen elektrischen Proben nach diesem ACK. Eine niedrigere Momentanleistung allein gibt keine noch mögliche Last frei. Offene AUS-/Stellaufträge und Phasenwechsel behalten ihre konservative Reserve. Die vorhandene Reservefreigabe wurde durch Regressionen abgesichert, nicht durch eine neue pauschale Reduktion ersetzt.

## Prüfung und reale Nachweise

Regressionen prüfen den beobachteten Fall für WB0–WB2, volle nominale harte Budgets, schlechte/veraltete/unbestätigte Leistung, offene Antworten, fehlendes Modus-ACK bei umschaltbaren Geräten sowie echte Phasenübergänge. Ein deterministischer Integrationstest führt den festen Mii über den realen Allocator und Ausgang durch 6→7 A, verzögertes ACK und nachfolgende elektrische Rückmeldung; unveränderte Proben finanzieren keinen weiteren Schritt. Ein eigener Ausgangstest hält die alte höhere Reserve bei vor dem ACK liegenden elektrischen Proben und gibt sie erst nach dem ACK bis zur nominalen bestätigten Last frei.

Vor Veröffentlichung werden vollständige Testsuite, Paket-/Installationsartefakt und bestehende Äquivalenzverträge geprüft; GitHub prüft Node.js 22 und 24. Softwaretests sind keine reale Betriebsabnahme. Nach manueller Installation bei natürlich vorhandenem Überschuss prüfen: kein falscher Phasenübergang beim festen Mii, gültige gemessene Zuteilungsbasis, höchstens ein neu zugelassener Amperschritt je qualifizierter Antwort, passendes ACK und reale L1–L3-/Leistungsantwort, erhaltene nominale Reserve und ruhiges Halten danach. Andere Regelbedingungen können eine Erhöhung weiterhin begründet verhindern.

Die SoC-Korrektur aus alpha.126 und Kommunikationswarnung mit voller Reserve aus alpha.127 bleiben enthalten. Dieser Auftrag installiert nichts in ioBroker und ändert keine produktive Konfiguration, Freigabe, Skripte oder Aktoren. Keine künstlichen Schaltversuche und keine Aussage über realisierte Energieeinsparungen.
