# 0.17.0-alpha.177 – SQL-Zeitzuordnung im Lasso-Vergleich

Der erste produktive Trainingsversuch fand bei 5515 bereinigten Grundlastwerten nur 48 vollstaendige Merkmalszeilen auf 48 Tagen. Ein lesender SQL-Abruf bestaetigte die Ursache: Temperatur-Durchschnittswerte tragen den Zeitstempel der Intervallmitte, waehrend die Lastwerte bereits auf den Viertelstundenbeginn zusammengefuehrt sind. Die strikte bisherige Temperaturpruefung verwarf diese Mittelwerte.

Beobachtetes Beispiel: Der synthetische SQL-Randpunkt bei 1793142000000 meldete 11,73 °C mit i=true. Der echte Intervallmittelwert bei 1793142450000 meldete 11,66 °C. Jetzt wird der Mittelwert dem Lastintervall ab 1793142000000 zugeordnet; der synthetische Randpunkt wird ignoriert. Er darf keine zweite Messung oder einen falschen Konflikt fuer das erste Intervall erzeugen.

Akzeptiert werden exakt auf Viertelstundenbeginn oder -mitte liegende Temperaturwerte. Die Normalisierung betrifft nur die Vergleichseingabe, keine Rohdaten, SQL-Konfiguration oder produktive Last-/Wetterprognose. Ein Intervall gilt erst nach seinem Ende als abgeschlossen. Echte Luecken bleiben unbekannt, widerspruechliche Temperaturwerte derselben Viertelstunde werden verworfen und beliebige andere Zeitversatzwerte nicht passend gerundet. Die Quellensignatur des Vergleichs wird erneuert, damit bisherige Vergleichseintraege nicht mit der korrigierten Zuordnung vermischt werden.

Nach Installation bleibt ein bereits aktivierter Vergleich aktiviert. Der normale Historienaufbau beim Start liest die vorhandenen SQL-Reihen und trainiert erneut; zusaetzliche Wochen Wartezeit sind wegen dieses Zeitstempelfehlers nicht erforderlich. Ob die vorhandenen Daten danach alle Modellanforderungen erfuellen, zeigt Forecast.LoadComparison.Status. Dies ist noch kein Nachweis einer besseren Prognoseguete.

Regressionen pruefen die konkret beobachteten Zeitstempel und Werte, die Gleichheit der Modellgewichte und Vorhersagen bei entsprechend ausgerichteten SQL-Mittelpunktreihen, synthetische Tagesrandpunkte, Intervallende, fehlende Werte, echte Konflikte und ungueltige Zeitversatzwerte. Bestehende Regelung und Ausgangsfreigaben bleiben unveraendert.
