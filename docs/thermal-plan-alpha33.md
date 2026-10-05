# Wärmeplanung ab 0.17.0-alpha.33

## Anlass und Verhalten

Bei einer Warmwasserreserve nahe ihrer Untergrenze konnte alpha.32 bereits wegen eines kleinen Wärmefehlbetrags die gesamte verfügbare PV dem Heizstab zuordnen. Die Wallbox erhielt in diesem Prognosefenster null, im nächsten Fenster wieder PV. Das konnte sich bei gleichmäßiger Erzeugung wiederholen. Solche zukünftigen Viertelstundenwerte sind geplante Leistungen und kein Nachweis einer realen Wallbox-Abschaltung.

Alpha.33 reserviert zuerst den benötigten Wärmeanteil. Dazu gehören die kalte obere Schicht, der angenommene Verbrauch einschließlich Speicherverlusten und die Sicherheitsreserve. Bestehende Preisbrücken bis zur nächsten geeigneten Wärmegelegenheit bleiben berücksichtigt. Nach dieser Zuteilung kann die ausgewählte Wallbox im selben Fenster die verbleibende PV nutzen.

Zusätzlich wird eine PV-Reserve für höchstens 60 Minuten modellierten Wärmeverbrauch einschließlich des aktuellen Restfensters angestrebt, begrenzt durch das verbleibende Prognoseende. Dieser Horizont ist Teil des Prognosealgorithmus und kein neues Admin-Feld. Der zusätzliche Aufbau verwendet ausschließlich verfügbare PV. Wenn die notwendige Wärme und die Mindestladeleistung zusammen gedeckt sind, erhält die Wallbox mindestens ihr zur Phasenzahl passendes Startbudget. Der zusätzliche Reserveaufbau allein darf dann keinen Nullslot erzeugen. Reale Fahrzeugreaktion, Startreserve und Ausgangsverzögerungen werden dadurch nicht simuliert oder verändert.

Nach der Ampere-Abstufung kann der Heizstab wie bisher zusätzlich verbleibende PV bis zu seiner Leistungs- und Speichergrenze aufnehmen. Die zusätzliche Prognosereserve ist deshalb kein neues maximales Wärmeziel. Ein erreichtes Fahrzeug-Ziel beendet seine Ladeplanung weiterhin; ein kurzer letzter Ladeanteil wird mit zulässigem Mindeststrom für eine kürzere Dauer dargestellt.

## Grenzen und unbekannte Daten

- Eine tatsächlich kalte obere Schicht oder zu geringe Mindestreserve kann bei knappem PV-Budget weiterhin eine flexible Ladepause begründen.
- Bei externer Phasensteuerung zählt die bestätigte Phasenstellung. 6 A benötigen bei 230 V einphasig 1.380 W und dreiphasig 4.140 W. Das Modell darf eine bestätigte dreiphasige Stellung nicht allein wegen knapper PV als einphasig behandeln.
- Bei EMS-Phasensteuerung wird der Phasenwunsch anhand der PV nach benötigter Wärme neu berechnet. Ein aktivierter Abfahrtstermin kann weiterhin eine höhere Phasenzahl erfordern. Auch besonders niedrig eingestellte Parallel-Verteilungsgrenzen ersetzen keinen Mindeststrom.
- Ungültige, fehlende, veraltete oder unbestätigte Speicherquellen machen die Wärmeprognose weiterhin nicht bewertbar. Eine fehlende Preisquelle verhindert Netz-Nachheizung; sie hebt einen durch gültige Temperatursensoren belegten PV-Wärmevorrang nicht auf.
- Bedarf, Verluste und gleich gewichtete Speicherschichten sind konfigurierte Modellannahmen. Zukünftige Kessel-, BHKW- oder WP-Wärme wird nicht als sichere Versorgung angenommen.
- Ein Netz-Wärmevorschlag im Fahrplan autorisiert keinen Geräteausgang. Dieses Update ändert keine Master-, Preisheiz-, SQL-, Skript- oder Aktorfreigabe.

## Diagnose

`Plan.Allocation_48h_JSON` ergänzt je Fenster:

| Feld | Bedeutung |
| --- | --- |
| `mandatoryThermalW` | Zuerst reservierte Wärmeleistung, einschließlich eines benötigten Preisbrückenanteils |
| `mandatoryThermalRequestedW` | Angeforderte Wärmeleistung vor Prüfung des verfügbaren PV-/Netzanteils, begrenzt durch die Heizleistungsgrenze |
| `mandatoryThermalPvW` / `mandatoryThermalGridW` | Quellenaufteilung dieser reservierten Wärmeleistung |
| `reserveRefillPvW` | Zusätzlicher, ausschließlich aus PV finanzierter Reserveaufbau |
| `thermalReserveTargetKWh` | Modelliertes Ziel der nutzbaren Wärme vor Verbrauch im betrachteten Fenster |
| `thermalReserveHorizonMin` | Obergrenze des vorausschauenden Reservehorizonts: 60 Minuten |
| `thermalReserveCoveredMin` | Tatsächlich im verbleibenden Plan abgedeckte Minuten des Reservehorizonts |
| `wallboxPvAvailableW` | Verfügbare PV nach benötigter Wärme und zusätzlichem Reserveaufbau, vor Wallbox-Zuteilung |

`Plan.DHWThermalDiagnostics_JSON` nennt den Horizont als `pvReserveRefillHorizonMin` und hält die thermischen Zuteilungsanteile je Fenster fest. Ein Fenster kann notwendige Wärme, Reserveaufbau und weiteren PV-Überschuss gleichzeitig enthalten; die Anteile erklären mehr als ein einzelnes zusammenfassendes Grundfeld.

## Prüfung nach dem Update

Die Regressionstests reproduzieren den Morgen mit niedriger Speicherreserve und ausreichender PV. Sie prüfen fortlaufende WB2-Zuteilung vor Zielerreichung, gedeckte Mindestreserve, Phasen-/Mindeststromgrenzen, fehlende Preise, echten Kaltbedarf und eine kurze letzte Ladung. Die veröffentlichte Netzbilanz und die thermische Energierechnung müssen dieselbe PV genau einmal zuordnen.

Für eine Abnahme sind danach echte Tagesbelege erforderlich: bleiben verbleibende Nullslots durch Wärmebedarf, Leistungsmangel, Zielerreichung oder Freigaben erklärbar, stimmen die Quellen und Zeitstempel, und sind Schattenausgang sowie reale Rückmeldungen eindeutig getrennt? Der Prognosefix allein bestätigt keine Live-Regelruhe und vergibt keine zusätzlichen Scorepunkte. Ein begleiteter Live-Test setzt weiterhin die vereinbarten Sicherheits-, Übergabe- und Phasenbestätigungen voraus.
