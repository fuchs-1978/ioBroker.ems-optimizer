# Gemessenes Restbudget ab alpha.44

## Belegter Anlass

Am 07.10.2026 gegen 13:22 Europe/Berlin war alpha.43 installiert. Beim Mii lagen 15 A Vorgabe, etwa 13,9 A gemessene Stromaufnahme und 3.150 W Leistung vor. Das Netz speiste 573 W ein; das Ziel war −100 W. Der Verteiler verlangte 17 A. Der Ausgang wartete auf das vollständige nominale Budget (16 A: 3.680 W; 17 A: 3.910 W). Das rekonstruierte Budget betrug etwa 3.623 W, beim nächsten Ausgangssnapshot 3.633 W. Diese Snapshots sind keine vollständige Tageshistorie.

## Änderung

Für eine bereits aktive, vom EMS gesteuerte PV-Ladung darf ein einzelner zusätzlicher Ampere-Schritt aus gemessener laufender Leistung plus 230 W je bestätigter Phase gedeckt werden. Die Ausnahme greift nur, wenn das vollständige nominale Ziel nicht gedeckt ist. Eine mögliche konservative normale Rampe bleibt erhalten. Im beobachteten Mii-Fall sind für 15→16 A zunächst 3.380 W erforderlich. Der Verteiler reserviert den nächsten gemessenen Schritt vor dem EHZ-Restbudget; eine rechnerische EHZ-Reduktion allein ist kein freies Netzbudget.

Eine weitere Erhöhung verlangt eine neue passende Strom-ACK sowie danach erfasste gültige Leistungs- und Phasenstromwerte. Leistung muss um mindestens einen halben Ampere-Schritt und jeder verwendete Phasenstrom um mindestens 0,5 A steigen. Ein unverändertes Fahrzeug, ein altes Messbild oder ein Schreibecho reichen nicht. Bis dahin wird die Vorgabe gehalten; notwendige Reduktionen und Schutzstopps bleiben wirksam. Vorhandene Kommunikations- und Fahrzeugreaktionsfristen gelten zusätzlich. Die neue Bestätigung soll Nachregeln ohne physische Reaktion verhindern, sie beweist keine exakte elektrische Leistungskennlinie des Autos.

Die Ausnahme gilt nicht für einen Kaltstart, autorisierte Preis-/Pflichtladung, offene Phasenwechsel oder idealisierte Schattenantworten. Geräte-, Phasen-/Hausanschluss- und gemeinsame §14a-/LPC-Grenzen werden weiterhin mit nominaler Befehlsleistung geprüft. Für 3P ist der zusätzliche Schritt 690 W, für 1P 230 W. Die bestehende Netzvorgabe und Regelauflösung bleiben erhalten. Wechselnde PV und Fahrzeugreaktion können vorübergehende Netzabweichungen verursachen; keine Garantie auf 0 W Rückspeisung oder Bezug.

## Diagnose und Abnahme nach manueller Installation

`Devices.WallboxN.IncreaseBudget_JSON` enthält Rechenbasis, verfügbares und erforderliches Budget, bisherige und nächste Stromvorgabe sowie eine offene elektrische Schrittantwort. Der bestehende produktive DecisionRecord enthält diese Diagnose; vorhandene SQL-Aufzeichnung und Datenabdeckung müssen erneut geprüft werden. Keine SQL-Einstellungen werden verändert.

1. Version, Master, alleinige Reglerzuständigkeit und Grenzwerte erneut lesen.
2. Für einen vergleichbaren laufenden Mii-Fall Netz-, Leistungs- und Strommessung zeitlich zusammenführen: ein zusätzlicher Schritt ohne Freigabeentzug, passende ACK, anschließende reale elektrische Zunahme. Erst dann darf ein weiterer Messwertschritt stattfinden.
3. Bei unveränderter Aufnahme muss eine weitere Erhöhung warten. Fehlende/ungültige Quellen bleiben unbekannt und führen nicht zu einer erfundenen erfolgreichen Reaktion. Reduktionen bei Budgetmangel und harte Schutzgrenzen separat prüfen.
4. Einen 3P-Fall getrennt beobachten. Modus-ACK und wirkliche drei elektrische Phasen müssen vorliegen; kein Mehrphasennachweis aus dem Wunschwert.
5. Im Kombibetrieb prüfen, dass EHZ-Rückgang und gemessenes Netzbudget vor einer Erhöhung wirksam sind. Alte Lasten dürfen während einer Übergabe nicht zweimal verteilt werden.

Regressionstests reproduzieren den Mii-Befund, unveränderte ACK-/Messbilder, nachfolgende Zunahme, 3P-Schrittgröße, ungültige Quellen und harte Grenzen. Sie erteilen keine Livefreigabe und begründen allein keine neuen Scorepunkte.
