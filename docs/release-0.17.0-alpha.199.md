# 0.17.0-alpha.199 — EHZ-Zwischenpuffer und korrekte 3P-Startreserve

## Problem und Änderung

Am 4. November lud der EQV einphasig an seiner Stromgrenze, während der EQE auf seine normale Startverzögerung wartete. Ein Beispiel aus der Diagnose: rund 2,18 kW Restbudget, davon 1,38 kW für den EQE vorgemerkt. Die verbleibenden rund 800 W lagen unter der EHZ-Mindestleistung von 900 W. Deshalb blieb das Heizbudget null, obwohl ausreichend Energie eingespeist wurde. Ein späterer Abruf bestätigte ausdrücklich: EHZ-Freigabe und Temperaturfreigabe EIN, feste Aufteilung AUS. „Aufteilung AUS“ ist somit keine ausgeschaltete EHZ-Gerätefreigabe.

Der vorhandene Zwischenpuffer funktionierte nur für das erste bevorzugte, noch nicht ladende Fahrzeug. Die gleiche Regel gilt jetzt auch für weitere wartende Fahrzeuge im parallelen Allokator. Während ihrer normalen Startwartezeit darf ein optionaler freigegebener EHZ deren noch ungenutztes Startbudget nutzen. Die Vormerkung bleibt gegenüber weiteren Autos geschützt.

Die Countdown-Korrektur entfernt die Beschränkung auf den ersten Kandidaten aus der vorhandenen geschützten Regel. Es gibt keinen neuen Ausgang, keine geänderten Wartezeiten und keine automatische Freigabe eines ausgeschalteten EHZ.

## Budget und Übergabe

- Für die Startqualifikation darf nur das zurücknehmbare eigene EHZ-Budget hypothetisch hinzugerechnet werden. Leistung bereits ladender Autos, weitere Mindestansprüche und andere Heizgeräte bleiben reserviert.
- Während der Countdown läuft, bleibt dieses Heizbudget nutzbar. Es entsteht dadurch kein vorzeitiger Fahrzeugstart.
- Nach Ablauf wird der geliehene Anteil dem EHZ entzogen. Bis die reale Heizleistung unabhängig bestätigt reduziert ist, bleibt ihre physische Reservierung bestehen; ein Nullsoll oder abgeschlossener Schreibauftrag reicht nicht.
- Ein echter Rückgang des verfügbaren Budgets setzt die normale Startwartezeit weiterhin zurück. Das vorübergehende Heizen selbst soll keine neue volle Wartezeit erzwingen.
- Manuelle/Mindest-SoC-Ladung, Preisfreigaben, Wärmebedarf und feste WB/EHZ-Aufteilung behalten ihre bestehenden Regeln. Netzladefreigaben werden nicht zu Heizbudget.
- Temperatur, Mindestheizleistung, Gerätefreigaben, Hausanschluss, Phasen und Netzbetreibergrenzen bleiben verbindlich. Ein nicht freigegebener EHZ wird nicht eingeschaltet.
- Die separate 3P-Qualifikation und die gesicherte Stromabsenkung vor dem Phasenwechsel bleiben unverändert. Ein gemeinsamer Plant-Test prüft, dass der EHZ den Rest während der 1P-Qualifikation nutzt und rechtzeitig für 3P zurückregelt.

`Control.WallboxN.AllocationDiagnostics_JSON` zeigt den geliehenen Anspruch als `heaterCountdownUseW`. Bei bereits belegtem Heizbudget erscheinen zusätzlich `start.reclaimableHeaterW`, das hypothetische `qualificationSafetyW` und gegebenenfalls `await-heater-reduction`. Diese Diagnose ersetzt keine physische Leistungsbestätigung.

## Vorzeitiger Rückwechsel von 3P auf 1P

Während der Prüfung wechselte der EQV um 11:24:30 Uhr erneut auf 1P. Ein begrenzter SQL-Abruf der DecisionRecords bestätigt die Produktionsentscheidung: `parallel-minimum-one-phase`, 4.302,1 W Budget, 3P noch bestätigt, SoC 38 % unter 40 % Mindestziel und noch 593 Sekunden Phasenhaltezeit. Das reicht für nominal 6 A × 3 × 230 V = 4.140 W. Der Sonderpfad hatte trotzdem feste 300 W Startreserve verlangt und sofort 1P angefordert. Die konfigurierte Reserve betrug 150 W. [Ausgewählte Diagnosefelder](evidence/phase-reserve-2026-11-04.json) bewahren diesen Nachweis ohne den vollständigen Quelldatenexport.

Die Reserveprüfung unterscheidet jetzt laufende und gestoppte Mindestladung: Ein laufender 3P-Auftrag benötigt keine erneute Startreserve. Ein gestopptes Fahrzeug berücksichtigt den konfigurierten Wert statt fest codierter 300 W. Bei ausreichender elektrischer Mindestleistung greifen damit wieder die vorhandenen Phasenregeln. Bei echter Unterdeckung unterhalb der elektrischen 3P-Mindestleistung bleibt der bisherige 1P-Mindestlade-Rückfall erhalten. Harte Grenzen und tatsächliche Leistungsreservierungen werden nicht erweitert.

Acht zusätzliche Regressionen prüfen vier laufende Grenzbudgets einschließlich des beobachteten 4.302,1-W-Falls, drei konfigurierte Reserven beim gestoppten Fahrzeug und einen echten Mangel unter 4.140 W. Sechs dieser Fälle scheitern vor der Reservekorrektur.

## Nachweis und Grenzen

Die erweiterten Plant-Regressionen verwenden den echten Allokator und echte Ausgangszustandsmaschinen, eine neun Sekunden verzögerte Heizantwort und einen weiter ladenden bevorzugten Wagen. Sie prüfen das zweite wartende Fahrzeug mit/ohne gültigen Fahrplan und mit/ohne harte Gesamtgrenze, einen echten Budgetverlust, entzogene Fahrzeugfreigabe, einen nach Nullbefehl physisch weiter heizenden EHZ sowie die 1P/3P-Übergabe. Es werden keine Geräte beschrieben oder Anlagenparameter geändert.

Zwölf gezielte Plant-Prüfungen und die zusätzlichen Phasengrenzfälle sowie die Gesamtsuite, Paket-/Metadaten-, Admin-, Lint-, installierte Artefakt- und historischen Vergleichsprüfungen gehören zur Freigabe. Die natürliche Anlage muss den zusätzlichen Wartefall anschließend bestätigen. Kurze Einspeisung durch Mess-/Geräteverzögerungen, Mindestleistungen und reale Schutzgrenzen bleibt möglich; es gibt keine Zusage eines stets exakt verschwindenden Netzflusses.
