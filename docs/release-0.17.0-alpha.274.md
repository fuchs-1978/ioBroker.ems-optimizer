# 0.17.0-alpha.274

Bei kleinem Restbezug im Bereich des Speicher-Totbands reduziert der Live-Regler den laufenden Ladeauftrag um die gemessene Abweichung. Bei 10 W Totband ergeben 11 W Ladeauftrag und 1 W Netzbezug einen neuen Sollwert von 10 W. Liegt das Ergebnis unter dem Totband, setzt der Regler den Speicher auf 0 W.

Der Ausgang sendet die kleinere Ladeleistung auch bei ausstehender Geräteantwort. Eine bereits berücksichtigte Netzmessung löst keine weitere Reduktion aus.
