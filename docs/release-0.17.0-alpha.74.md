# 0.17.0-alpha.74

## Problem und Änderung

Am 11.10.2026 gegen 05:57 Europe/Berlin meldete das installierte EMS alpha.73 eine offene Heizstabreserve von 3.000 W auf Phase 1 bei Nullauftrag. Die vorhandene positive Stellwirkung war unbekannt (`seenAt=[0,0,0]`); das konfigurierte my-PV-Sollregister lieferte NULL. Eine konkrete frühere Messabweichung ist mangels vollständiger Historie keine belegte Ursache dieses Altbestands. Im Code ist jedoch reproduzierbar, dass eine dauerhaft etwas geringere Widerstandsleistung niemals den bisherigen exakten Nominalleistungsnachweis erreicht.

Die gemeinsame WW-/Heizpuffer-Reservierungsprüfung akzeptiert nun eine stabile positive Unterantwort: mindestens drei unterschiedliche frische Phasenmessungen über mindestens 15 Sekunden oder die längere konfigurierte Rückmeldefrist. Der laufende Phasenauftrag muss unverändert der nominellen Reserve entsprechen. Die Abweichung ist auf den kleinsten Wert aus konfigurierter Toleranz, 300 W und 15 % der nominellen Reserve begrenzt; Stabilitätsabweichung höchstens 100 W bzw. die halbe zulässige Unterantwort. Datenlücken über 30 Sekunden, alte/future Messungen, NULL und ungültige ACK/q verwerfen den Nachweis. Die nominelle Reserve wird noch nicht durch den niedrigeren Messwert reduziert. Erst eine spätere physische Reduktion nach dem zugehörigen Befehl erlaubt Freigabe.

Zusätzlich kann eine alte unbekannte positive Stellwirkung durch eine neue unabhängige Null-Rücknahmeprüfung ersetzt werden: unveränderte Ausgangs-/Quellenzuordnung, abgeschlossener Nulltransport, frische bestätigte Null-Sollrückmeldung nach diesem Abschluss, verbundenes Gerät sowie mindestens drei auf allen Phasen neue echte Nullmessungen über dieselbe Mindestfrist. Ein einzelner Nullwert, ein NULL-Sollwert, ein Transportcallback oder bloßer Zeitablauf sind weiterhin kein Nachweis. Neustart/Neuauftrag/Zuordnungswechsel und Qualitätsprobleme verhindern Übernahme eines begonnenen Nachweises.

## Diagnose und Grenzen

`OutputReservationState_JSON` dokumentiert die Art und Zeit der akzeptierten Stellwirkung sowie bei alternativer Freigabe den Nulltransport, Soll-ACK und Anfang/Ende/Anzahl/Phasenzeiten des elektrischen Nachweises. Die Prüfung schreibt nur EMS-Diagnosen, keine eigenen Aktorbefehle. HA-/§14a-/Temperatur-/Gerätegrenzen, nominelle Reservierung und Nulltransport-Reihenfolge bleiben wirksam.

Der konkrete alte 3.000-W-Bestand wird nicht sofort oder pauschal gelöscht. Solange NULL-Sollrückmeldung und unbekannte frühere Stellwirkung bestehen, bleibt er ungeklärt. Eine später stabil belegte Heizphase mit anschließender Rücknahme oder die vollständige alternative Nullprüfung kann ihn freigeben. Softwaretests beweisen weder Ursache des alten Falls noch eine reale Rücknahme oder vollständigen Eigenverbrauch. Keine automatische Installation oder produktive Konfigurationsänderung.

## Nächste Betriebsprüfung

Nach manueller Installation Ausgangsreserve, `seenAt`, `effectEvidence`, `lastReleaseProof` und reale my-PV-Ausgangs-/Sollquellen mit ts/ACK/q gemeinsam auswerten. Prüfen, ob eine nominell niedrigere stabile Heizleistung erkannt wird und die spätere bestätigte Reduktion Reserve abbaut. Neue Nullnachweise von alten fehlenden Daten unterscheiden; keine historischen Erfolgswerte erfinden.
