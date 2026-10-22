# 0.17.0-alpha.122

## Anlass

Erreicht ein beobachtet ladendes Fahrzeug seinen Ziel-SoC, waehrend der Ausgang noch den Phasen-Nachlauf meldet, wurde bisher keine automatische Uebergabe angelegt. Das Zielfahrzeug fiel danach in die regulaere Startverzoegerung. Zusaetzlich konnte die Phasen-Nachlaufmarkierung nach dem Stopp stehen bleiben.

## Aenderung

Die automatische Ziel-SoC-Uebergabe darf den bereits qualifizierten Ladevorgang auch bei noch beschaeftigtem Spender vormerken. Sie erteilt damit noch keine Startfreigabe: Eigentum, AUS-Rueckmeldung, frische elektrische Ruhe, Empfaengerphase, Budget, Datenqualitaet und das bestehende Ablaufdatum bleiben verbindlich. Eine unbewiesene Sitzung erhaelt keine Qualifikation.

Nach unabhaengig bestaetigtem AUS und frischen Nullmessungen beendet der Ausgang den lastbezogenen Phasen-Nachlauf. Eine offene Modusanforderung bleibt offen; es wird keine Phasenbestaetigung erfunden.

## Installation und Pruefung

Adapter auf alpha.122 aktualisieren. Das bereits installierte Phasen-Skript Revision 2 bleibt bestehen. Die Korrektur erzeugt keine rueckwirkende Uebergabe fuer einen vor dem Update abgeschlossenen Ladevorgang.

Regressionstests decken Zielerreichung waehrend des Phasen-Nachlaufs, blockierten Start bis zur Abschaltung, unveraenderte normale Startverzoegerung ohne beobachteten Spender sowie Erhalt offener Modusanforderungen ab. Der naechste reale Zielwechsel ist gesondert zu beobachten.
