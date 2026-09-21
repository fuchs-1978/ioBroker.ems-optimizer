# Fahrplanbilanz ab 0.17.0-alpha.18

Issue [#54](https://github.com/fuchs-1978/ioBroker.ems-optimizer/issues/54)
betrifft den 48-Stunden-Planer: Eine Wallbox kann wegen Mindest-SoC oder Abfahrt
mehr als den PV-Rest anfordern. Bei anschließender Begrenzung auf ihre zulässige
Phasen-/Ampereleistung wurde bisher die gesamte Differenz als freie PV gebucht.
Damit konnte zuvor angeforderte Netzleistung einen überhöhten Heizstabfahrplan
und weitere falsche PV-Zuweisungen auslösen.

Der Planer berechnet den Rest jetzt neu:

`PV-Rest = max(0, PV − Grundlast − bereits geplantes Warmwasser − endgültige Wallboxleistung)`

Die weitere Verteilung an Warmwasser, Heizpuffer, Batterie und PV-Boost verwendet
diesen korrigierten Rest. Absichtlich angefordertes Netzladen oder
Mindesttemperatur-Nachheizen bleibt möglich.

## Reproduzierbarer Fehlerfall

WB2 hat genügend Ladebedarf unter Mindest-SoC, eine Fahrzeuggrenze von 22 kW,
erlaubte Phasenumschaltung und einphasig maximal 20 A. Das Warmwasser liegt über
40 °C Mindesttemperatur, aber unter 76 °C Zieltemperatur; Speicher und Heizpuffer
sind im Test nicht vorhanden. Die genaue frühere SoC-Situation ist nicht belegt;
der Test setzt den auslösenden Pflichtladebedarf ausdrücklich.

| Größe | Korrigierter erster 15-Minuten-Slot |
| --- | ---: |
| PV | 2.954 W |
| Grundlast | 615 W |
| Verfügbare PV nach Grundlast | 2.339 W |
| WB2, 1 Phase / 20 A | 4.600 W |
| Davon Wallbox-PV | 2.339 W |
| Davon Wallbox-Netzbezug | 2.261 W |
| Warmwasser-EHZ | 0 W |
| Gesamter Netzbezug | 2.261 W |

Die Bilanz lautet `615 + 4.600 − 2.954 = 2.261 W`. Der frühere zusätzliche
EHZ-Bedarf ist damit beseitigt. Die historischen Hauslastwerte sind hierfür
ungeeignet: `Forecast.HouseLoad_48h_JSON` enthält auch flexible Verbraucher.
Der Planer erhält ausdrücklich `Forecast.Baseload_48h_JSON`, also die bereinigte
Grundlast. PV-Prognose und Temperaturziele müssen für diese Korrektur nicht
verändert werden.

## Eigene Diagnoseobjekte

Alle folgenden Objekte liegen unter `ems-optimizer.0.Plan` und sind lesbar.
`AllocationSource` nennt die verwendete Grundlastreihe; im regulären Forecast ist
das `Forecast.Baseload_48h_JSON`. `Allocation_48h_JSON` enthält je Viertelstunde:

| Felder | Bedeutung |
| --- | --- |
| `timestamp`, `offsetMin` | Zeitpunkt und Abstand zum Planbeginn |
| `pvW`, `baseW`, `pvAfterBaseW` | Eingangsleistung und PV nach Grundlast |
| `activeWallbox` | Ausgewählte Wallbox 0/1/2 oder `null` |
| `wallboxRequestedW`, `wallboxW` | Wallbox-Anforderung vor und Leistung nach Begrenzung |
| `wallboxPvW`, `wallboxGridW` | PV- und Netzanteil der endgültigen Wallboxleistung |
| `pvBeforeQuantizationW`, `pvAfterQuantizationW` | Freie PV nach vorläufiger Verteilung, vor bzw. nach Wallboxbegrenzung |
| `releasedPvW`, `discardedGridRequestW` | Tatsächlich freigegebene PV bzw. verworfene Netzanforderung |
| `dhwBeforeQuantizationW` | Bereits vor Wallboxbegrenzung belegte Warmwasserleistung |
| `dhwW`, `dhwPvW`, `dhwGridW` | Endgültige Warmwasserleistung mit Quellenanteilen |
| `dhwReason` | `off`: aus; `minimum-temperature`: Mindesttemperatur; `parallel-pv`: parallele PV-Verteilung; `pv-surplus`: verbleibender PV-Überschuss |
| `heatingW`, `heatingPvW`, `heatingGridW` | Heizpufferleistung mit Quellenanteilen |
| `pvBeforeBatteryW` | Verbleibende PV nach den flexiblen Verbrauchern |
| `batteryW`, `batteryPvW`, `batteryGridChargeW` | Batterieplanung: positiv Laden, negativ Entladen; die Quellenanteile beziehen sich nur auf Laden |
| `remainingPvW` | Nach Batterieladung verbleibende PV; Grundlage des PV-Boost-Budgets |
| `rawGridW`, `gridW` | Ungerundete Bilanz bzw. veröffentlichter Netzplan; positiv Bezug, negativ Einspeisung |

PV wird entsprechend der tatsächlichen Planungsreihenfolge zugeordnet:
vorab reserviertes Warmwasser, Wallbox, zusätzliches Warmwasser, Heizpuffer,
Batterie. Quellenanteile sind Planwerte, keine separaten Zählermessungen.
`minimum-temperature` kann neben Netzleistung auch PV enthalten.

Leistungen sind Mittelwerte über den gesamten 15-Minuten-Slot. Ein kurzer letzter
Ladevorgang kann deshalb im Mittel unter 6 A liegen; `currentA` und
`chargingMinutes` im Wallboxplan beschreiben Strom und Einschaltdauer.
Die interne Geräteenergie- und Diagnoseberechnung bleibt ungerundet. Gerätepläne
verwenden ganze Watt; `gridW`, Netzdiagramm und Import-/Export-Summen verwenden
deren gemeinsame Bilanz. Sehr kleine Gleitkommareste in der Rohdiagnose sind
keine tatsächliche zusätzliche Netzanforderung.

## Prüfung

Die Regressionstests verwenden den tatsächlichen Planer mit Vehicle-Manager.
Sie decken den Fehlerfall, ein- und dreiphasige Pflicht-/Abfahrtsbegrenzung,
echte Ampere-Reste, Parallelbetrieb mit bereits belegtem Warmwasser, kurze letzte
Ladeintervalle, thermische und Fahrzeug-Energiegrenzen sowie erlaubtes
Mindesttemperatur-Nachheizen ab. Die Prüfungen kontrollieren Quellenbilanz,
Folgeverbraucher und Übereinstimmung von Plan und Diagrammen.

Die lesende Bestandsprüfung vor dieser Änderung fand alpha.17 installiert;
alle 14 untersuchten Forecast-/Plan-Diagrammpaare stimmten über 192 Slots überein.
Der aktuelle Mindest-SoC war bereits erreicht, deshalb trat der auslösende
Pflichtladefall dort nicht mehr auf. Diese Bestandsprüfung ist kein Live-Nachweis
für alpha.18. Nach Installation von GitHub muss `System.Version` alpha.18 zeigen
und `Plan.LastUpdate` einen neu berechneten Plan. Dessen Diagnose lässt sich dann
mit denselben Zeitpunkten in PV-, Grundlast-, Geräte- und Netzreihen vergleichen.
