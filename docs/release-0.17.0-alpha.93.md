# 0.17.0-alpha.93

Neue ganzzahlige Fahrzeugmeldungen verwerfen die Nachkommastellen der Energie-Schaetzung nicht mehr, wenn Meldung und gerundete Schaetzung zum zugeordneten Messzeitpunkt uebereinstimmen. Die Basis wird mathematisch gleichwertig weitergefuehrt: 35,36 % plus neue Meldung 35 % bleiben 35,36 %. Das gilt auch, wenn der gemeldete ganze Prozentwert wechselt, beispielsweise Schaetzung 35,72 % und Meldung 36 %.

Bei Abweichung bleibt die Fahrzeugmeldung massgeblich. Ein nach einer Autobahnfahrt nachgereichter niedrigerer Ankunfts-SoC darf die Schaetzung trotz bereits laufender Ladung nach unten korrigieren. Ohne echten Messzeitpunkt wird weiterhin der Empfangszeitpunkt angenommen; diese Unsicherheit bleibt. Mit zugeordnetem Messzeitpunkt wird gegen die Schaetzung an diesem Zeitpunkt verglichen, nicht gegen den spaeteren Ladezustand.

Die Ausnahme gilt nur fuer Ganzzahlmeldungen und eine gueltige bestehende Basis. Reset, Abstecken, Quellwechsel, Plausibilitaet und Zwei-Stunden-Frische bleiben wirksam. Ein passender neuer Bericht fuehrt die Basis am neuen Berichtzeitpunkt fort; wiederholtes Lesen desselben Berichts allein verlaengert sie nicht. Keine neue Admin-Einstellung und keine Skriptaenderung erforderlich. Gilt fuer alle drei Fahrzeuge und den unabhaengig pruefenden Ausgangstreiber.

Validierung: gezielte Regressionen fuer Nachkommaerhalt, geaenderte Ganzzahlmeldungen, Wiederholung/Neustart, echte Abweichungen, zeitversetzte Meldungen, niedrigeren Ankunfts-SoC, Reset/Frische/Dezimalquellen und Rundungsgrenze.
