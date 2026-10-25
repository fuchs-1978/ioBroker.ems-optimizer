# 0.17.0-alpha.145 – qualifizierte Absteck-Übergabe im Parallelbetrieb

## Beobachtung und reproduzierbare Lücke

Am 25.10.2026 zeigte der laufende Stand alpha.143 nach Abstecken des EQE keinen vorbereiteten Übergang zum Mii. Die Diagnose meldete `no-vehicle-handoff` und begann eine neue 300-s-Startqualifikation. Kleine SQL-DecisionRecord-Ausschnitte um 11:39 Uhr Europe/Berlin enthalten direkte Quellenereignisse: EQE zunächst 16 A / 3,39 kW, danach Fahrzeugzustand 4, reale Leistung 0, Abstecken (`car=1`), AUS-/Eigentumsübergänge und Auswahl des Mii. Ohne vollständige Deltabasis werden die ersten direkten Ereignisse nicht als vollständige Entscheidung interpretiert.

Der erste rekonstruierte Produktionssnapshot um 11:39:35.053 zeigt ein Mii-Startbudget von 3115 W bei gerade neu begonnenen 300 s; die Übergabediagnose bleibt leer. Er enthält außerdem einen früheren Timerreset bei nur 1075 W um 11:39:27.012. Dieser Leistungsabfall ist eine eigenständige berechtigte Startsperre, kein Beleg einer vollständig verfügbaren Übergabeleistung über den ganzen Zeitraum. Die zeitweise wiederholte AUS-Bestätigung und Eigentumsrücknahme des EQE wird durch die bestehenden Stoppsperren abgedeckt; die genaue externe Quellenreihenfolge wird hier nicht als Gerätefehler erklärt.

Im Code war die begrenzte Übernahme eines zuletzt wirklich beobachteten, abgesteckten Spenders nur im sequenziellen Pfad eingebunden. Der Parallelpfad beobachtete anschließend bereits die verschwundene Ladefreigabe, ohne vorher diesen Spender zu sichern. Seine kontrollierten Transfers kannten nur manuelle Priorität und Ziel-SoC. Der reale Integrationstest reproduziert auf dem bisherigen main das Ausbleiben eines Mii-Starts vor Ablauf weiterer 300 s; mit der Änderung startet er nach Spender-AUS und elektrischer Ruhe ohne diese erneute Kaltstartzeit.

## Änderung

- Dieselbe vorhandene, ausschließlich sitzungslokale und zeitbegrenzte Spenderbeobachtung wird vor der Auswahl in beiden Pfaden ausgewertet. Ein bloß gespeicherter `car=1`-Wert oder ein ohne reale Startbeobachtung übernommener Ausgang reicht nicht.
- Der Parallelpfad führt den eigenen Transfergrund `disconnected`. Die hypothetische Ersatzleistung darf den abgesteckten Spender wie einen SoC-fertigen Spender herausrechnen; in der tatsächlichen Zuteilung bleibt seine reale/pending Reserve vollständig gebunden.
- Der Empfänger wartet auf zurückgegebenen Ausgangsbesitz, frisches echtes AUS, elektrische Ruhe aller Phasen und abgeschlossene Phasenübergänge des Spenders. Nur dieser eindeutig abgesteckte Spender darf dafür `car=1` haben; die Empfänger- und allgemeinen Vorstartprüfungen ändern sich nicht.
- Der vorhandene begrenzte Spender kann kurz auf einen geeigneten Empfänger bzw. ausreichendes Startbudget warten. Fehlendes Budget erlaubt niemals einen Start. Nach Ablauf, Quellen-/Kontrollverlust oder widerrufenem bereits vorbereitetem Transfer gibt es keine unendliche Verlängerung und keinen neuen Shortcut aus alten Beobachtungen.
- Mindeststrom, Startreserve bei erstmaliger Vorbereitung, Empfängerfreigabe/SoC, passende Phasen, Preis-/Prioritätsbasis und harte Leistungsgrenzen bleiben wirksam. Die normale 300-s-Kaltstartzeit bleibt eingestellt.

Regressionen prüfen den vollständigen produktiven EQE→Mii-Ablauf ohne überlappende Fahrzeugleistung und mit verzögerter realer Stoppwirkung; fehlende vorherige Beobachtung, fehlerhafte Quellen, AUS-/Ruhe-/Eigentumssperren, Budgetmangel und kurze Erholung, spätere Budgetrücknahme, Ablauf, Prioritätswechsel und entzogene Empfänger-/Masterfreigabe. Bestehende sequenzielle Absteck- und Parallel-SoC-/Prioritätsübergaben bleiben Teil der gesamten Testmatrix. Softwaretests beweisen keine nachträgliche reale Übergabe unter der neuen Version.
