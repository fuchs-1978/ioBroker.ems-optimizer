# 0.17.0-alpha.131 — go-e-Rueckmeldungen beruhigen lassen

Nach einem bestaetigten Stromwechsel kann go-e sowohl Befehls- als auch Rueckmeldedatenpunkt nochmals mit dem vorherigen Wert melden. Eine Abweichung um 1 A beendet eine bestehende Ladung deshalb nicht sofort: maximal 10 Sekunden ohne weitere Erhoehung beobachten und jede Runde erneut pruefen.

Frische SMA- und Wallboxmessungen, Freigabe, bestaetigte Phasen sowie Hausanschluss- und Betreibergrenzen bleiben Voraussetzung. Der hoehere Strom bleibt reserviert. Notwendige Absenkungen werden nicht durch die Wartefrist blockiert. Wiederholte oder zwischenzeitlich passende Abfragen erneuern die Frist desselben Befehls nicht. Bei anhaltendem Widerspruch greift die bestehende Fehlerbehandlung.

Regressionen pruefen 1P/3P, Rueckkehr zur passenden Meldung, feste Frist sowie SMA-Ausfall, Anschlussueberlast, hartes Gruppenlimit, Geraetefehler und entzogene Freigabe.
