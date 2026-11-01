# 0.17.0-alpha.187 – gezielte Korrekturen aus dem Regler-Audit

Diese Version korrigiert drei reproduzierbare Codepfade. Sie beweist nicht, dass die gesamte am 1. November gemessene Einspeisung von 5,93 kWh vermeidbar war. Insbesondere ist die erste Ursache des EHZ-Budgetfalls aus [#313](https://github.com/fuchs-1978/ioBroker.ems-optimizer/issues/313) damit nicht vollständig rekonstruiert.

## Verzögerter Write-only-Modbus-Reset

Der Heizstabregler frischt seinen Sollwert zyklisch auf. Der ioBroker-Schreibabschluss bestätigt dabei den Transport in die Zustandsdatenbank; erst der zugeordnete Reset des Modbus-Adapters ist ein separater Befehlsnachweis. Kam dieser Reset später als der nächste Regeltakt, erzeugte auch ein identischer Auffrischungsbefehl einen zweiten offenen Auftrag. Die Rückmeldungen wurden dadurch mehrdeutig und der Nullnachweis blieb für diesen EMS-Prozess gesperrt. Unbestätigte Leistungsreserven konnten folglich erhalten bleiben.

Ein unveränderter Auftrag wird jetzt kurzzeitig zusammengefasst, wenn sein Transport bereits erfolgreich abgeschlossen ist und genau der zugehörige eigene Befehlszustand noch vorliegt. Die Wartezeit ist auf 15 Sekunden ab dem ursprünglichen Schreibbeginn begrenzt. Eine Zusammenfassung ist kein weiterer physischer Schreibversuch und verschiebt dessen Diagnosezeitpunkt nicht. Der echte Modbus-Reset sowie spätere unabhängige elektrische Messungen bleiben erforderlich.

Geänderte Befehle, insbesondere ein erforderlicher Nullbefehl, werden weiter gesendet. Sie dürfen eine alte offene Rückmeldung nicht nachträglich eindeutig machen. Fehler, Fremdschreibzugriffe, ungültige Qualität, geänderte Metadaten und Fristüberschreitungen bleiben konservativ gesperrt. Die gemeinsame Transportkorrektur gilt für beide my-PV-Heizkreise; es gibt keine neue Gerätefreigabe und keine unbegrenzte Unterdrückung der Auffrischung.

## Mindestladung bei fester Einphasigkeit

Zwei Haltepfade der parallelen Wallbox-Zuteilung verlangten auch für fest einphasige Fahrzeuge eine optionale Phasenmodus-Rückmeldung. Ohne diesen Datenpunkt konnte eine bestehende Mindestladung verloren gehen, während eine andere Wallbox nach Erreichen ihres Mindest-SoC noch abschaltete. Im Regressionstest passen beide realen Reservierungen von je 1.380 W in das gemeinsame 4.200-W-Limit; trotzdem fiel die erste Zuteilung zuvor von 6 A auf 0 A.

Die feste 1P-Topologie benötigt dort jetzt frische bestätigte Ruheströme auf beiden unbenutzten lokalen Phasen. Umschaltbare Geräte benötigen weiterhin ihre unabhängige Modusbestätigung. Die Korrektur gilt für bereits laufende Mindestladungen und zeitlich begrenzte, vom Ausgangstreiber belegte Startreservierungen. Sie ermöglicht keinen neuen Start allein aus einer Besitzmarkierung. Reale Reservierungen, Phasenübergänge, Rückmeldefristen und gemeinsame Schutzbudgets bleiben bindend.

## Externe Speicherentladung im bisherigen WB-/EHZ-Regelpfad

Der koordinierte Energieregler entfernte externe Speicherentladung bereits aus dem verfügbaren Überschuss. Der bisherige WB-/EHZ-Pfad tat dies nicht. Im Anlagentest konnte deshalb eine gemessene Entladung von 2 kW ohne PV rund 1,9 kW EHZ-Verbrauch finanzieren und am Netzanschlusspunkt trotzdem scheinbar im Totband liegen.

Jetzt wird auch dort ausschließlich frisch und gültig gemessene externe AC-Entladung aus dem Zuteilungsbudget entfernt. Externe Speicherladung bleibt unverfügbar und wird nicht als zusätzliche Reserve zurückgeholt. Fehlende optionale Speichermessungen erzeugen keine neue generelle Ausgangssperre. Die tatsächliche Netzleistung und ihre Diagnose bleiben physische Messwerte; nur das verfügbare Leistungsbudget wird bereinigt.

## Prüfung und Installation

Regressionstests führen die Befehls-/Transport-/Reset-Reihenfolge, feste und umschaltbare Wallbox-Topologien sowie die externe Speicherentladung durch die vorhandenen Reglerpfade. Zusätzlich ist der zeitabhängige Test zur historischen Profilgewichtung auf einen festen Sommertermin gesetzt, damit eine Zeitumstellung zwischen Testdaten nicht zufällig einen zweiten lokalen Viertelstundenslot erzeugt.

Installation wie bisher aus dem versionierten GitHub-Stand; der Nutzer installiert selbst. Es ist keine zusätzliche Admin-Einstellung erforderlich. Bereits ungeklärte historische Schreibfolgen oder Aufzeichnungslücken werden nicht rückwirkend als geklärt markiert. Ein normaler EMS-Neustart beginnt einen neuen Befehlsnachweis; ein SQL-Neustart ist für diese Korrekturen nicht erforderlich. Der Lasso-/Median-Vergleich bleibt passiv.
