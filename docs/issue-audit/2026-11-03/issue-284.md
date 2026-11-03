# Issue #284 – [Vergleich läuft] Median, Lasso und Kombinationen: Ist-Auswertung und 90-Tage-Datenbasis

Historischer Originalstand vor der Aufgabenbereinigung am 2026-11-03. Quelle: https://github.com/fuchs-1978/ioBroker.ems-optimizer/issues/284. Letzte Issue-Änderung: 2026-11-01T22:21:45Z. Dieser Snapshot ist ein Archiv, keine aktuelle Aufgabenliste. Aktueller Stand: [Roadmap #36](https://github.com/fuchs-1978/ioBroker.ems-optimizer/issues/36).

## Ursprünglicher Issue-Text

## Aktueller Stand – 01.11.2026 / Alpha 186

**Vergleichsbetrieb läuft. Produktive Lastplanung bleibt beim ausgewählten Profil; noch kein abgeschlossener regulärer Vorab-Ist-Tag und kein dauerhafter Sieger.**

### Implementiert und eingerichtet

- [x] Median und Lasso als vorab gespeicherte Folgetagsprognosen, Neustarts ändern bereits ausgegebene Werte nicht: #299/#300.
- [x] Feste 50/50-Mischung und Lasso-Tagesenergie mit skaliertem Median-Verlauf: #302 / alpha.179.
- [x] Meteorologische Prognosestände zur späteren Analyse archivieren: #301 / alpha.178; bei aktivem Vergleich standardmäßig 90 Tage. Anbieter-current bleibt Schätzung.
- [x] Bereits aktivierte Original-Raumtemperaturhistorien länger erhalten statt Daten zu kopieren: #303 / alpha.180. Sechs zugeordnete Räume / zwölf Ist-/Sollquellen, Kind 3 elektrisch. Quellen-/Retentionprüfung ist kein lückenloser Zustellnachweis.
- [x] Korrigierte Messgrenze: Wallboxen außerhalb der vier Hauszähler, daher kein Wallboxabzug; EHZ in Haus 2 wird abgezogen. Überholte Metriken aus #305 nicht zur neuen Modellbewertung heranziehen.
- [x] Kalender-Lags an Zeitumstellungstagen: #307/#308 / alpha.181/.182. Herbst nur mit beiden gemessenen Vorkommen mitteln; Frühlingslücke nur als gekennzeichnetes Merkmal aus beiden Nachbarstunden schätzen. Normale Messlücken/Istwerte bleiben unbekannt. 92-/100-Slot-Zieltage derzeit ausgeschlossen.
- [x] Alpha 186 als laufend gelesen; Modell zuletzt 4.905 Trainingswerte aus 52 Tagen. 16 Merkmale: 2-/7-Tage-Lags, Tageszeit, Wochentag/Feiertag, optional Außentemperatur/Heizgrad. Zusätzliche Wind-/Raum-/Wärmemerkmale noch nicht integriert.

### Was noch offen bleibt

- [ ] Vollständige reguläre Vorab-Ist-Tage mit 96 identischen gemessenen Viertelstunden, MAE/RMSE und Energiemengenabweichung bewerten.
- [ ] Mehrere Tage und unterschiedliche Verbrauchs-/Wetterlagen vergleichen; keine Auswahl oder produktive Umstellung aus nur einem Zwischenstand.
- [ ] Für jede Zwischenrechnung Schlusszeit, gemeinsame Slotzahl, Abdeckung und bereinigten Ist-Verbrauch nennen. Energie aus SQL-Viertelstundenmitteln ist eine Näherung, keine Zählerdifferenz.
- [ ] 90-Tage-Datenbasis weiter aufbauen und reale Zustellung prüfen. Zusätzliche Merkmale erst separat anhand geeigneter Messungen bewerten.
- [ ] Wärme-/WP-Modell gesondert in #160/#306 behandeln; Haushaltsstrom allein liefert keinen gemessenen Wärmebedarf oder COP.

### Letzte manuelle Zwischenrechnung: 01.11.2026, 00:00–22:45

91/91 abgeschlossene gemeinsame Slots, vier SQL-Zählermittel minus enthaltenem EHZ, keine Wallboxsubtraktion. Unveränderte Prognose aus dem Vorab-Ledger vom 31.10.; nicht rückwirkend neu trainiert.

| Kandidat | Energie bis 22:45 | Abweichung zur Ist-Näherung | Viertelstunden-MAE |
| --- | ---: | ---: | ---: |
| Ist-Näherung | 23,24843 kWh | — | — |
| Median | 20,41575 kWh | −12,18 % | 285,26 W |
| Lasso | 25,13400 kWh | +8,11 % | 308,37 W |
| 50/50 | 22,774875 kWh | −2,04 % | 277,63 W |
| Lasso-Energie / Median-Verlauf | 25,215524 kWh | +8,46 % | 340,08 W |

Die 50/50-Mischung führt in diesem Zwischenstand bei Energie und MAE. Das ersetzt keinen vollständigen Tagesabschluss; der Zwischenfavorit um 19 Uhr war ein anderer. Die offizielle Evaluation hatte beim letzten Lesen `completeDays=0`.

Für 02.11. liegen 96/96 Prognosen vor: Median 24,19875 / Lasso 26,86075 / 50:50 25,52975 / Hybrid 26,86075 kWh. Vorhersagen, kein Gütenachweis. Wetter-/Raumarchiv und Produktionsfreigaben werden durch diese Issuepflege nicht verändert. Aktueller Tagesbericht: #313.

<details>
<summary>Datierte Entwicklung und frühere Prüfstände (historisch)</summary>

## Betriebsnachtrag – 31.10.2026: Raumhistorie eingerichtet

Alpha.180 wurde nach Betreiberinstallation lesend als laufend bestätigt. Die sechs ausgewählten Räume wurden über die vorgesehene Laufzeitzuordnung eingetragen; Kind 3 ist elektrisch gekennzeichnet. Der Adapter meldet 12/12 Quellen `verified-extended`. Anschließend wurden die Originalobjekte unabhängig erneut gelesen: SQL für alle zwölf numerischen Ist-/Sollquellen aktiviert, Aufbewahrung jeweils **7.776.000 s = 90 Tage**, bisheriges 60-s-Wiederholintervall und Entprellung erhalten. Keine zweite Temperaturhistorie oder neuen Lasso-Eingänge angelegt. Die Metadatenprüfung belegt weiterhin keine lückenlose Zustellung aller Messwerte.

---

## Ergänzung – 31.10.2026: vorhandene Raumhistorien erhalten

Beauftragt und als **PR #303 / alpha.180** umgesetzt: https://github.com/fuchs-1978/ioBroker.ems-optimizer/pull/303. Nach acht grünen GitHub-Prüfungen auf main übernommen. Installation und konkrete Quellenzuordnung sind weiterhin offen.

Auf Betreiberhinweis werden keine doppelten Temperaturdaten archiviert. Für die ausgewählten sechs Räume sind zwölf numerische Soll-/Istquellen in SQL aktiviert; die gelesenen Metadaten nennen derzeit 14 Tage Aufbewahrung. Diese Aktivierung ist noch kein unabhängiger Nachweis vollständiger Datenbankzustellung.

- Nur die Aufbewahrung zugeordneter, bereits aktiver Originalreihen auf mindestens 90 Tage verlängern. Abtastrate, Filter, Entprellung und sonstige Einstellungen erhalten; längere/unbegrenzte Fristen nicht verkürzen.
- Küche/Wohnzimmer, Bad, Kind 1/2 wassergeführt; Kind 3 gemäß Betreiber elektrisch und separat gekennzeichnet. Wirksamen Sollwert verwenden, nicht eine teilweise leere Temperaturvorgabe. Keine gemessene Heizleistung aus der Zuordnung ableiten.
- Raumzuordnung über Admin-Tabelle oder explizite Laufzeitliste Config.RoomHistory.Rooms_JSON; Standardliste leer, keine installationsspezifischen Quellen-IDs im Code. Installation und konkrete Quellenzuordnung bleiben noch auszuführen.
- Debug.RoomHistory.Status/Status_JSON beschreiben ausschließlich Quellen- und Metadatenprüfung. Keine kopierten Temperaturreihen, neuen Lasso-Merkmale oder Steuerungsänderungen. Gelöschte alte Werte nicht wiederherstellen.

Validierung: 3.448 lokale Tests sowie gezielte Statuswechselregression, Lint, Admin-/Metadatenprüfung, Paketartefakt und historischer Verhaltensvergleich grün. Die bisherige Lasso-/Median-/Kombinationsauswertung bleibt unverändert.

---

## Ergänzung – 31.10.2026: Kombinationen beauftragt

Der Betreiber hat den zusätzlichen passiven Vergleich zweier fester Kombinationen beauftragt. Umsetzung: **PR #302 / 0.17.0-alpha.179** (https://github.com/fuchs-1978/ioBroker.ems-optimizer/pull/302), nach **acht grünen GitHub-Prüfungen auf main übernommen** (Merge `3e2b6ecfe4f69e5fbf9b2757a4b456df7ae63ec1`). Installation weiterhin durch den Betreiber.

- Feste 50/50-Mischung je Viertelstunde.
- Median-Tagesverlauf skaliert auf die Lasso-Tagesenergie; keine nachträgliche Anpassung an gemessene Zielwerte.
- Neue Kombiprognosen werden vor Tagesbeginn gespeichert und auf denselben Messpaaren bewertet. Alte Ledger-Einträge bleiben unverändert und bekommen keine rückwirkenden Kombimetriken. Fehlende Werte bleiben unbekannt.
- Tagesauswertung und Tagesissue berücksichtigen die beiden Kandidaten, sobald die laufende Version sie tatsächlich liefert. Bestehende Grenzen und produktives Prognoseverfahren bleiben erhalten.

Lokale Validierung: 3.440 Tests, Lint, Adminlayout, Paketmetadaten, installiertes Paketartefakt und historischer Verhaltensvergleich grün. Installation erfolgt durch den Betreiber; kein realer Gütenachweis aus Softwaretests.

Bekannter separater Blocker: Die vollständige Lasso-Prognose für 1.11. fehlt wegen des ausgeschlossenen Zeitumstellungstags 25.10. im Wochenlag. Diese Erweiterung korrigiert die Zeitumstellung nicht und füllt keine Lücken.

---

## Aktueller Stand – 30.10.2026

Der Betreiber hat die Umsetzung als zuschaltbaren Vergleich inzwischen ausdrücklich beauftragt. **Der Median-/Lasso-Vergleich ist implementiert und aktiviert; die produktive Übernahme bleibt offen.** Die ältere Zurückstellung weiter unten dokumentiert den Planungsstand vom 29.10. und ist für die inzwischen freigegebene Vergleichsphase überholt. Die Batteriepriorität #25 wird dadurch nicht als abgeschlossen erklärt.

### Umgesetzt und auf main

- **PR #299 / 0.17.0-alpha.176:** passiver Folgetagsvergleich auf bereinigter Grundlast, Tageszeit, Wochentag/Feiertag, Rückblicken von zwei und sieben Kalendertagen sowie optional SQL-Außentemperatur und Heizgrad. Zwei Tage Rückblick sichern die Eingangsverfügbarkeit für den gesamten Folgetag. Chronologische Strafstärkenwahl; keine Vermischung des Trainingsfehlers mit realer Prognosegüte. Das bestehende produktive Prognoseverfahren und alle Steuerungsfreigaben bleiben unverändert.
- **PR #300 / 0.17.0-alpha.177:** beobachtete SQL-Temperaturmittelpunkte korrekt den Lastviertelstunden zuordnen; synthetische Randpunkte ignorieren. Zuvor nur 48 nutzbare Merkmalszeilen trotz 5.515 Grundlastwerten. Nach Korrektur bestätigte der lesende Erstcheck **4.647 Trainingszeilen aus 49 Tagen** und eine vollständige Prognose mit 96 Viertelstunden für **31.10.2026**. Prognosesummen beim Erstcheck: Median **18,390 kWh**, Lasso **18,877 kWh**. Dies sind Vorhersagen, kein Gütenachweis.
- **PR #301 / 0.17.0-alpha.178:** Wetterstände mit Erfassungszeit, Zielstunde, Quellzeitstempeln, Originaleinheiten und expliziten Lücken für 90 Tage in einem eigenen SQL-Archiv sammeln. Lesend wurden nach Installation ein erster Stand um **22:35:36 Uhr** mit **24 verfügbaren Wetterstunden** sowie Historieneinträge bestätigt; das belegt keine durchgehend vollständige oder verlustfreie SQL-Zustellung. Sonnenscheindauer wird hier in **h** gemeldet; direkte Strahlungswerte fehlen und werden nicht aus PV-Leistung erfunden.

Alle drei PRs wurden nach jeweils acht grünen GitHub-Prüfungen gemergt. Alpha.178 wurde anschließend lesend als laufende Version bestätigt. Tests, Merge und Installation sind getrennt von realer Prognosegüte zu bewerten.

### Vergleich und Speicherung

Vorabprognosen bleiben unter gleichem Quellenvertrag über Neustarts unverändert. Modellgewichte werden diagnostisch gespeichert; das aktive Modell wird beim Start und beim täglichen Historienaufbau aus höchstens 84 Tagen neu trainiert. Modellanforderungen, Datenbereinigung, Fehlwerte und Zeitumstellung sind in den verlinkten Versionshinweisen dokumentiert. MAE/RMSE werden auf denselben gemessenen Viertelstunden bewertet; Tagesenergie und Energieabweichung erfordern einen vollständig abgedeckten 96-Slot-Tag.

Beim Erstcheck war **noch kein vollständiger Ist-Vergleich verfügbar**. Der erste mögliche vollständige Vergleich für 31.10. entsteht nach dessen Ablauf und einem erfolgreichen Historienlauf am 01.11.; Ergebnis und Datenabdeckung müssen dann tatsächlich gelesen werden. Es wird weder eine Überlegenheit von Lasso noch ein Nutzen für Batterie-/Fahrzeugplanung behauptet.

### Weitere Beobachtung, vorerst kein zusätzlicher Umbau

Die tägliche EMS-Auswertung wurde um den festen Absatz **„Prognosevergleich und Wetterhistorie“** ergänzt, einschließlich Tagesissue: Vergleichszeitraum, Datenabdeckung, verfügbare Fehler-/Energiemetriken und Archivstatus; fehlende vollständige Messtage werden ausdrücklich genannt. Der Betreiber möchte den aktuellen Stand zunächst unverändert laufen lassen.

Wind, Bewölkung, Sonnenscheindauer, Feuchte und Niederschlag werden für spätere Merkmale gesammelt, sind aber **noch keine zusätzlichen aktiven Lasso-Eingänge**. Meteo-current-Werte sind Anbieter-Schätzungen, keine lokalen Messungen. Wind-/Temperaturwechselwirkungen und verzögerte Temperatur können später gezielt verglichen werden. Heizlast oder WP-Verhalten nicht aus Haushaltsstrom allein ableiten: hierfür passende gemessene Heizleistung/Wärmemenge und die Abgrenzung aus #160 berücksichtigen; keine doppelte Energiezuordnung.

Offen bleiben insbesondere ein ausreichend langer Vergleich auf ungesehenen Tagen, Robustheit/Fehlerbias, belastbarer Planungsnutzen und eine gesondert freizugebende produktive Übernahme. Die bestehenden Abnahmekriterien bleiben hierfür offen.

Versionshinweise: [alpha.176](https://github.com/fuchs-1978/ioBroker.ems-optimizer/blob/main/docs/release-0.17.0-alpha.176.md), [alpha.177](https://github.com/fuchs-1978/ioBroker.ems-optimizer/blob/main/docs/release-0.17.0-alpha.177.md), [alpha.178](https://github.com/fuchs-1978/ioBroker.ems-optimizer/blob/main/docs/release-0.17.0-alpha.178.md).

---

## Historischer Planungsstand vom 29.10.2026

## Ziel und Priorität

Idee aus einem fachlichen Austausch: eine autoregressive Hauslastprognose mit Lasso-Regularisierung (LEAR-artiger Ansatz) als optionale Erweiterung evaluieren.

**Zurückgestellt. Zunächst produktive Batteriekoordination in #25 fertigstellen.** Dieses Issue beauftragt keine sofortige Implementierung, neue Version, zusätzliche SQL-Abfragen oder Anlagenversuche. Bezug: Roadmap #36 und Prognosekalibrierung #163.

Aktuell ist kein belastbarer Vorteil gegenüber der bestehenden Prognose für diese Anlage nachgewiesen. Komplexität nur übernehmen, wenn sie messbaren Nutzen bringt.

## Bestehende Vergleichsbasis

15-min-Hauslastprofil mit Median nach Wochentag/Viertelstunde; optional jüngere Daten gewichten. Vor Umsetzung aktuellen main und tatsächlich vorhandene Prognosepfade erneut prüfen.

## Möglicher Ansatz

- Bestehendes Medianprofil als robuste Basis und Rückfalloption erhalten.
- Optional zunächst die Abweichung vom Medianprofil modellieren.
- Kandidaten: verfügbare Lastwerte der letzten 15–60 Minuten, Vortag und Vorwoche, Uhrzeit, Wochentag und Feiertag.
- Temperaturabhängigkeit perspektivisch für den WP-Bedarf berücksichtigen; historische Daten ohne WP belegen kein gelerntes WP-Verhalten.
- Lasso wählt eine sparsame Kombination aus angebotenen Merkmalen; Auswahl und Stärke der Regularisierung ausschließlich mit vergangenen Trainings-/Validierungsdaten bestimmen.
- Bereinigte unkontrollierte Hauslast als Lernziel verwenden. Konfigurierte enthaltene Wallbox-/EHZ-Verbräuche und später gesteuerte WP-Anteile konsistent abgrenzen; eigene Stellentscheidungen nicht als unabhängigen Grundbedarf lernen.

## Methodische Anforderungen

- Prognosehorizonte unterscheiden: kurzfristig, Resttag und Folgetag/Nacht.
- Für jeden historischen Prognosezeitpunkt nur damals tatsächlich verfügbare Eingänge verwenden. Insbesondere ist der 15-min-Lag eines zukünftigen Zielzeitpunkts bei einer Folgetagsprognose noch unbekannt.
- Direkte horizontabhängige Modelle oder rekursive Vorhersage ausdrücklich festlegen und deren Fehler bewerten.
- Chronologischen, rollierenden Vergleich auf identischen Zeiträumen gegen den bestehenden Median und gegebenenfalls recent-weighted durchführen; keine zufällige Durchmischung zukünftiger Daten.
- Fehlende Quellen, Datenlücken, Zeitumstellung, Feiertage, Ausreißer und veränderte Nutzung behandeln. Fehlende Werte nicht als echte Null-Last ausgeben.
- Zunächst offline bzw. als lesende Vergleichsprognose, ohne Einfluss auf Zuteilung oder Gerätesteuerung. Vorhandene zulässige Daten wiederverwenden; keinen pauschalen erneuten Abruf alter SQL-/Recorder-Untersuchungsfenster veranlassen.

## Abnahmekriterien

- [ ] Zunächst Fehler der bestehenden Resttages-/Nachtenergieprognose und ihre praktische Bedeutung für die Planung belegen.
- [ ] Datenbasis, Bereinigung, Eingangsverfügbarkeit und Prognosehorizonte dokumentieren.
- [ ] Chronologische Vergleichsauswertung auf bislang ungesehenen Tagen durchführen; Trainings- und Testzeiträume klar ausweisen.
- [ ] Leistungsfehler (z. B. MAE in W), Fehler der Resttages-/Nachtenergie in kWh und systematische Über-/Unterschätzung vergleichen.
- [ ] Nutzen für Batterie-/Fahrzeugplanung gesondert prüfen; kleinerer Prognosefehler ist kein automatischer Nachweis eingesparter Energie oder Kosten.
- [ ] Robustheit und Rechen-/Betriebsaufwand bewerten; bei unzureichenden Daten sichere Rückfalloption auf das bestehende Profil.
- [ ] Produktive Übernahme erst bei nachvollziehbarem, ausreichend stabilem Vorteil. Ohne Vorteil bestehendes Verfahren beibehalten.

Keine Verbesserung, saisonale Kalibrierung oder reale Anlagenabnahme wird durch das Anlegen dieses Issues behauptet.

## Feature-Ergänzung: temperaturabhängige normale Hauslast — 29.10.2026

Wochentag und Viertelstunde bleiben die Basis. Eine Außentemperaturkorrektur soll zusätzlich geprüft werden, auch für den normalen Hausverbrauch ohne Wärmepumpe. Zunächst eine einfache kontinuierliche Korrektur der Abweichung vom Medianprofil gegen Median/recent-weighted vergleichen; Lasso ist eine mögliche spätere Erweiterung, keine Voraussetzung.

- Keine starre Aufteilung in Wochentag × Temperaturklassen als Standard: bei begrenzter Historie können zu kleine Vergleichsgruppen entstehen.
- Aktuelle/vergangene Temperatur und sinnvoll geglättete beziehungsweise verzögerte Temperaturwerte als Kandidaten betrachten. Zusammenhänge lernen, nicht pauschal einen Verbrauchsanstieg je Grad voraussetzen.
- Zukunftsprognosen mit den zum Prognosezeitpunkt verfügbaren Wettervorhersagen prüfen; später tatsächlich gemessene Zukunftstemperatur nicht als damals bekannte Eingabe verwenden. Fehlende archivierte Vorhersagen begrenzen den Nachweis ausdrücklich.
- Unkontrollierte Hauslast, Fahrzeuge/EHZ und separate WP-Prognose konsistent abgrenzen. Bereits separat geplanten Verbrauch nicht ein zweites Mal im Hauslastmodell berücksichtigen.
- Optional Tageslänge/Sonnenstand und Bewölkungs-/Strahlungsprognose als weitere Kandidaten vergleichen; kein Nutzen ohne Messvergleich behaupten.

### Zusätzliche Abnahmekriterien

- [ ] Ausreichende Datenabdeckung über Temperaturbereiche und stabile Zusammenhänge auf späteren, nicht zum Training verwendeten Tagen belegen.
- [ ] Einfache Temperaturkorrektur gegen bestehende Profile vergleichen, insbesondere Resttages-/Nachtenergiefehler und Über-/Unterschätzung.
- [ ] Bei fehlenden/ungültigen Wetterdaten oder unzureichendem Nutzen auf das bestehende Profil zurückfallen; keine unbelegte Korrektur.
- [ ] Separate WP-Modellierung aus #160 ohne doppelte Energiezuordnung berücksichtigen.

Weiterhin **zurückgestellt hinter #25**. Feature-Erfassung, kein unmittelbarer Code-/Installations-/SQL-/Anlagenauftrag.


## Zeitumstellungs-Rückblicke korrigiert – 31.10.2026

PR #307, **0.17.0-alpha.181**, nach grünen Checks unter Node 22/24/26 auf main übernommen (Merge `f4f277df198e7eb11d7b9e1eb0e127ce3b30077b`). Ganze Übergangstage werden nicht mehr aus der Lag-Datenbasis entfernt. Eindeutige lokale Viertelstunden bleiben nutzbar. Doppelte Herbst-Viertelstunden verwenden den Mittelwert beider gültiger, tatsächlich gemessener Intervalle; fehlt ein Vorkommen oder ist es widersprüchlich, bleibt der Lag unbekannt. Nicht existente Frühlingszeiten bleiben unbekannt und werden nicht nach 03 Uhr verschoben. Regressionstest liefert für 1.11. alle 96 Slots aus vollständigen Testdaten.

Bestehende Vorabprognosen bleiben unverändert. Umstellungstage selbst bleiben als 92-/100-Slot-Zieltage außerhalb der bisherigen 96-Slot-Ausgabe/-Bewertung; bestehende Median-/Lasso-Zieltagspolitik erhalten. Keine Produktionssteuerungsänderung. Installation erfolgt durch Betreiber; vollständige morgige Live-Prognose nach Installation und Historienaufbau noch zu bestätigen. Unabhängige Zählerkorrektur siehe #305: Wallboxen nicht in Hauszählern, deshalb kein Abzug; EHZ in Haus 2 bleibt abzuziehen.

## Betreiberwunsch: Frühlingslücke als gekennzeichnetes Lasso-Merkmal – 31.10.2026

PR #308 / **alpha.182** nach sämtlichen grünen Checks (Node 22/24/26) auf main übernommen, Merge `2aa6c94e18cc63b8be462e2a9aafbe615cfc3f3f`. Für die vier tatsächlich nicht existenten lokalen Viertelstunden der einstündigen Frühjahrsumstellung wird der Mittelwert der beiden gemessenen Nachbarstunden verwendet, z.B. 02:15=(01:15+03:15)/2. Beide gültigen Messungen und bestätigter einstündiger Offset-Sprung sind erforderlich. Normale Messlücken bleiben unbekannt. Ausschließlich Lasso-Eingangsmerkmale; keine synthetischen Ist-/Ziel-/Medianwerte. Prognoseslots markieren `estimatedLagDays`; Model_JSON zählt `estimatedLagSamples`/`estimatedLagValues` und dokumentiert die Politik. Persistierte Prognosen unverändert, Installation durch Betreiber.

Aktueller echter Vergleich nach Alpha.181-Installation inzwischen vollständig: für 1.11.96/96 Werte aller vier Varianten; Median21,45775/Lasso26,50250/50:50 23,980125/Hybrid26,50250 kWh. Noch kein abgeschlossener Ist-Nachweis. Details #305. Alpha.182 wirkt auf diese Herbstprognose nicht rückwirkend.

</details>


