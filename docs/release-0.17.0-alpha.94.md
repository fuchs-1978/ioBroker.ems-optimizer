# 0.17.0-alpha.94

## Problem und Korrektur

Bei Pflichtwaermebedarf reservierte die parallele Zuteilung den Rest nach den Fahrzeug-Mindestladungen fuer Warmwasser. Der nachgelagerte Heizstabregler verwarf diesen Anteil jedoch bei starker Pufferschichtung unter 900 W beziehungsweise bei warmem Pufferkopf unter 500 W. Der Heizstab blieb aus, waehrend der EQV keinen zusaetzlichen Strom bekam.

Die bestehende Schichtungsregel wird jetzt vor der Leistungsverteilung und der Uebergabepruefung angewendet. Unbrauchbare Heizanteile bleiben im gemeinsamen Fahrzeugbudget. Der abschliessende Heizstabregler prueft weiterhin dieselbe gemeinsame Regel; nutzbare Pflichtwaerme behaelt ihre bisherige Prioritaet. Der separate koordinierte Batterie-/Heizpufferpfad bleibt unveraendert. Keine neue Admin-Einstellung und keine Skriptaenderung.

Beispiel: EQV aktuell 1270 W, Einspeisung 622,5 W, Gesamtbudget 1892,5 W. Bisher 1380 W Fahrzeugbudget plus verworfene 512,5 W Heizreserve, daher 6 A. Jetzt steht das Gesamtbudget dem Fahrzeug zur Verfuegung: 8 A nominell 1840 W. Der Ausgangstreiber prueft den aktuellen Netz- und Geraetezustand unabhaengig vor jedem Schreiben.

## Diagnose und Validierung

Control.ParallelWallboxAllocation_JSON zeigt zusaetzlich inputBudgetW, heaterShareRequestedW, heaterShareUsableW und heaterTargetW. Angeforderte oder nutzbare Heizanteile sind Zuteilungswerte, kein Nachweis tatsaechlich aufgenommener Leistung.

Regressionen pruefen den beobachteten Fall, die 500-W-Grenze, nutzbare Pflichtwaerme, einen weiteren Pflichtlader, aktive Aufteilung und harte gemeinsame Grenzen. Lokaler Replay mit ausgelesener Konfiguration und Messwerten bestaetigt die Verteilungskorrektur fuer das nachgestellte Einspeisebudget; dabei erfolgten keine Geraeteschreibzugriffe. Livewirkung nach Installation pruefen.
