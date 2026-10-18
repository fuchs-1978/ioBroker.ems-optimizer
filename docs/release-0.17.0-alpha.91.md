# 0.17.0-alpha.91

Die Mindest-SoC-Ladung schloss bisher sowohl in der zentralen Zuteilung als auch im Ausgangstreiber das Halten eines bestaetigten, real gedeckten Ladestroms aus. Dadurch konnte ein Auto trotz ausreichender gemessener PV-Leistung an der nominellen Amperegrenze abwechselnd herunter- und wieder heraufgeregelt werden.

Der bestehende Nachweis fuer gemessenen Ladestrom gilt jetzt auch unterhalb des Mindest-SoC: aktuelle elektrische Messwerte nach dem Befehl, bestaetigter Strom, unveraenderte Phasen und ausreichendes reales Budget bleiben erforderlich. Die Ausnahme haelt nur den bestehenden Strom innerhalb der bisherigen Ein-Ampere-Grenze. Sie gibt keine neue Erhoehung oder zusaetzliche Bezugstoleranz frei. Bei echtem Defizit wird oberhalb des berechtigten Mindeststroms weiterhin reduziert; harte Netzbetreiber-, Hausanschluss-, Geraete- und Fremdlastgrenzen verwenden weiterhin nominelle Reserven.

Gilt fuer alle drei Wallboxen. Keine neue Admin-Einstellung erforderlich.

Validierung: Zwei neue Regressionstests scheitern auf alpha.90 und bestehen mit der Korrektur. Geprueft werden alle drei zentralen Zuteilungen, reale Defizite, ausfallende PV, harte Grenzen und fehlende Bestaetigung im Ausgangstreiber. Die reale Wirkung muss nach Installation im Zeitverlauf bestaetigt werden.
