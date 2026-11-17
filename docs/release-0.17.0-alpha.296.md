# 0.17.0-alpha.296

Im Reiter **Batteriespeicher** gibt es für Kopf 1, 2 und 3 jeweils das Feld **Netzphase**. Die Auswahl **Unbekannt** ist die Vorgabe. Mit L1, L2 oder L3 verwendet das EMS die bestätigte Anschlussphase für das Ladebudget und offene Leistungsreserven. Köpfe auf derselben Phase teilen sich deren verfügbares Budget.

Bei jedem konfigurierten Kopf und bei allen drei Wallboxen steht **Phasenlage testen**. Speichere zunächst die Admin-Konfiguration. Aktiviere die üblichen globalen und gerätespezifischen Betriebsfreigaben. Für die Messung braucht das EMS frische Bezugs- und Einspeiseleistungen aller drei Netzphasen und die zugehörigen Phasenströme.

Eine Wallbox muss bereits einphasig mit mindestens 6 A und weniger als 16 A laden. Der Test fordert 16 A innerhalb der vorhandenen Geräte- und Netzgrenzen an. Ein Speicherkopf erhält einen Ladeauftrag von 1.000 W. Dafür muss ausreichend freier SoC- und Leistungsbereich vorhanden sein.

Der Adapter führt einen Test zur Zeit aus. Zunächst nimmt er Speicheraufträge zurück und bestätigt den tatsächlichen Stillstand. Während eines Wallboxtests bleibt die normale Speicherregelung pausiert. Auftretende Speicherleistung beendet die Messung. Der Test vergleicht die SMA-Phasenleistung mit der tatsächlichen Geräteänderung und prüft die Rückkehr zum Ausgangszustand. Das Messfenster umfasst zehn Sekunden nach beobachteter elektrischer Antwort. Anlauf und Rücknahme haben eigene begrenzte Wartezeiten.

Ein eindeutiges Ergebnis wird nach bestätigter Rücknahme automatisch in der Instanzkonfiguration gespeichert und im Admin angezeigt. Dabei kann ioBroker die Instanz neu starten. Störende Laständerungen, fehlende Messwerte oder eine unzureichende Geräteantwort liefern einen Status mit Begründung. Die vorherige Phasenauswahl bleibt bei einem erfolglosen Test erhalten.

**Phasentest abbrechen** fordert die Rücknahme an. Bei noch ausstehender elektrischer Rückmeldung zeigt das EMS diesen Zustand und prüft weiter. Der Ablauf wird im Adapter gesteuert und läuft auch bei geschlossener Admin-Seite bis zur Rücknahme weiter. Nach einem Neustart wird ein unterbrochener Test zurückgenommen. Ein Ausfall des gesamten Hosts kann weiterhin nur durch geräteseitige Schutzfunktionen abgesichert werden.

Der globale Status steht in `Control.PhaseTestStatus` und `Control.PhaseTest_JSON`. Den letzten gerätebezogenen Nachweis zeigen `Devices.Wallbox0.PhaseTest_JSON` bis `Devices.Wallbox2.PhaseTest_JSON` und `Devices.Battery.Heads.1.PhaseTest_JSON` bis `Devices.Battery.Heads.3.PhaseTest_JSON`.
