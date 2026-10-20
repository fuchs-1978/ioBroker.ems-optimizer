# 0.17.0-alpha.113 — Zeitnachweis der 3P-Vorbereitung

## Belegter Fehler

Gezielter lesender SQL-Abruf um den Reset am 20.10.2026: 32 Transportwerte aus zwei angrenzenden begrenzten Fenstern. Die Schema4-Transportbündel und Originale wurden mit den Repository-Decodern expandiert/dekodiert; der erste Abschnitt vor dem benötigten Snapshot bleibt ohne vollständige Deltabasis unbekannt. Maßgeblich sind die danach zusammenhängend rekonstruierten Originale der Sitzung 1792483635342, alpha.112.

- 10:31:32.017 Europe/Berlin: Qualifikation noch 6 s, Budget 7.046 W.
- 10:31:38.038 (seq7253): `shared-budget-before-phase-upshift`, Vorbereitung von 20 A auf 10 A. Das ist die notwendige Begrenzung vor einer möglichen Verdreifachung der Phasenleistung.
- 10:31:44.017 (seq7308): `observation-gap` trotz gültiger Quellen und 7.217 W Budget.
- 10:31:50.012 (seq7375): neuer Qualifikationsbeginn/300 s bei 6.499 W Budget, die einphasige Stromvorgabe steigt wieder.

Der Phasenregler hatte vor der Vorbereitung den alten Qualifikationsnachweis kopiert. Beim anschließenden Zurückstellen der noch nicht ausgegebenen Phasenanforderung wurde auch der alte `lastObservationAt`-Wert zurückkopiert. Zwei normale Reglerabstände von rund 6 s wurden dadurch gegenüber dem alten Zeitpunkt zu rund 12 s. Die bestehende Lückenprüfung erlaubt bei konfigurierten 5 s maximal 7 s und verwirft dann die Qualifikation. In diesem belegten Fall ist die Lücke künstlich; eine allgemeine Aussage über alle anderen Tagesresets oder NAS-/SQL-Lastursachen folgt daraus nicht.

## Korrektur

Beim Wiederherstellen des ursprünglichen Qualifikationsbeginns und Phasen-Haltezeitpunkts die aktuelle gültige Beobachtung mit `lastObservationAt: now` fortschreiben. Keine Verlängerung des Lückenlimits, keine Verkürzung der 300-s-Qualifikation und keine Erzeugung einer Hardwarebestätigung. Die Vorabsenkung wartet weiterhin auf echten gemessenen Stromrückgang und hält alle harten Budget-, Geräte- und Hausphasengrenzen ein.

## Tests und Folgeabnahme

Neue Regression mit echtem Allocator, kontrollierter Uhr und 6-s-Abständen: abgeschlossene 300-s-Qualifikation, Vorabsenkung 20→10 A, ACK ohne elektrische Absenkung bleibt 1P, später sichere elektrische Antwort erlaubt 3P ohne neue 300 s. Der Test scheitert auf alpha.112 und besteht mit der Korrektur. Ursprünglicher Qualifikationsbeginn bleibt unverändert, der Phasen-Haltezeitpunkt beginnt erst bei echter Zielausgabe. Negativfälle prüfen eine echte Lücke >7 s, Budget unter Umschaltschwelle, ungültige Phasenrückmeldung und harte Wattgrenze unter 3P-Minimum.

Nach Installation natürliche Umschaltfolge beobachten: Qualifikationsende → Stromabsenkung → ACK und tatsächliche Aufnahme → 3P-Ziel → externe Modusbestätigung → elektrischer Wiederanlauf. Kein künstlicher Liveversuch durch die Entwicklung; keine Aussage über erfolgreiche reale Umschaltung allein aufgrund der Softwaretests. SQL, Polling, Bestands-Phasenfolger und 600-s-Stoppverzögerung bleiben unverändert. Kein garantierter Score- oder Energiegewinn.
