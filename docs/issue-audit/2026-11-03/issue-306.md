# Issue #306 – Idee: Hydraulikdiagnose und messwertgestützte Bewertung thermischer Speicherflexibilität

Historischer Originalstand vor der Aufgabenbereinigung am 2026-11-03. Quelle: https://github.com/fuchs-1978/ioBroker.ems-optimizer/issues/306. Letzte Issue-Änderung: 2026-10-31T15:11:24Z. Dieser Snapshot ist ein Archiv, keine aktuelle Aufgabenliste. Aktueller Stand: [Roadmap #36](https://github.com/fuchs-1978/ioBroker.ems-optimizer/issues/36).

## Ursprünglicher Issue-Text

## Auftrag und Einordnung

Auf Betreiberwunsch Erkenntnisse aus der Diskussion mit Martin Fierz für die spätere Wärmepumpenintegration festhalten. Planungs-/Diagnoseissue, kein Auftrag zur sofortigen Implementierung oder Anlagensteuerung. Ergänzt #160 (vorausschauende Wärmeplanung), #304 (KONNEX-Schnittstelle) und #284 (Lastprognose). Bestehende Funktionen und Datenquellen vor Umsetzung prüfen und wiederverwenden.

## Motivation

Temperaturüberhöhung durch Pufferdurchmischung, ungünstige Anschlusspositionen oder unpassende Erzeuger-/Verbrauchervolumenströme kann die WP-Effizienz verschlechtern. Auch unnötiges Aufheizen mit anschließendem Heruntermischen ist zu vermeiden. Bei unterschiedlichen Heizkreistemperaturen können Mischer jedoch erforderlich sein.

Die Artikel sind Anlagenbeispiele, kein Nachweis eines Fehlers der Betreiberanlage. Prozentuale Einsparungen und pauschale Empfehlungen gegen Puffer/Mischer nicht ungeprüft übernehmen.

## Geplanter Umfang

### 1. Gemeinsame Messbasis und passive Diagnose
- Konfigurierbare Zuordnung im Admin für WP-Vorlauf/-Rücklauf, Heizkreis-Vorlauf/-Rücklauf und Pufferfühler oben/unten; soweit verfügbar Volumenströme, Pumpenzustände/-leistung, Mischerventilstellung und Wärme-/Stromzähler.
- Vorhandene Historien nutzen, keine doppelte Archivierung. Einheiten, Zeitstempel, Messalter, Sensorabweichungen und fehlende Messwerte berücksichtigen.
- Betriebsphasen unterscheiden: Raumheizung, Trinkwarmwasser, Abtauung, Stillstand, Anlauf und bewusstes Vorheizen.
- Während geeigneter stabiler Heizphasen Temperaturdifferenz zwischen WP-Ausgang und erforderlichem/ankommendem Heizkreisvorlauf auswerten.
- Auffälligkeiten als Diagnosehinweis mit Zeitraum und Messbelegen darstellen; aus einer Temperaturdifferenz allein weder hydraulischen Fehler noch Energieverlust oder Einsparquote ableiten.
- Erzeuger- und Verbrauchervolumenströme gemeinsam bewerten, sofern tatsächlich messbar. Keine automatische Pumpen-/Mischeroptimierung.

### 2. Wirtschaftlichkeit des Vorheizens
- Für #160 Vorheizen gegenüber späterer Wärmeerzeugung vergleichen: erforderliche Vorlauf-/Speichertemperatur, COP/Leistungskennfeld, Speicher-/Gebäudeverluste, PV-Opportunitätskosten, Strompreis und Netzentgelte sowie Prognoseunsicherheit.
- Elektrische Zwischenspeicherung mit Roundtrip-Verlusten und Leistungs-/SoC-Grenzen als Alternative konsistent bilanzieren.
- Raumwärme, Heizpuffer und Trinkwarmwasser getrennte Nutzungs- und Temperaturgrenzen zuordnen; Trinkwarmwasser nicht als frei nutzbaren Raumheizungsspeicher behandeln.
- Nutzbare Wärme zum Bedarfszeitpunkt und verbleibenden Netzbezug bewerten; keine pauschale maximale Temperatur bei billigem Strom.

### 3. Gebäudedynamik und Überbrückungsdauer
- Zunächst normale Heizpausen/Temperaturverläufe passiv beobachten; Raum-Ist/Soll, Außentemperatur, Wärmezufuhr sowie nach Datenlage Sonne, Wind, Lüftung/Fenster und interne Gewinne berücksichtigen.
- Abkühlverläufe können Zeitkonstanten/Überbrückungsdauer abschätzbar machen. Eine absolute Speicherkapazität in kWh erfordert zusätzlich belastbare Wärmezufuhr-/Verlustinformationen.
- Raum- und Bodentemperaturen unterscheiden. Aus einer Raumtemperaturänderung keine gleichmäßige Temperaturänderung des gesamten Estrichs oder Gebäudes ableiten.
- Ein Lastprognosemodell (Median/Lasso, #284) ist noch kein dynamisches Modell der Reaktion auf geänderte Heizfahrpläne. Für diese Fragestellung gesonderte Modellierung/Validierung vorsehen.
- Elektrisch beheizte Räume getrennt von wassergeführten Heizkreisen behandeln.
- Aktive Identifikationsversuche nur separat geplant/freigegeben und innerhalb festgelegter Komfort-, Frost-, Boden- und Geräteschutzgrenzen; kein automatisches Abschalten zum Experimentieren.

## Abnahmekriterien für eine spätere Umsetzung
- [ ] Verfügbare Messquellen und Lücken dokumentiert, bestehende Historien wiederverwendet.
- [ ] Diagnose unterscheidet Betriebsphasen und zeigt Unsicherheit; keine Fehlermeldung allein aus ungeprüfter Temperaturdifferenz.
- [ ] Prognostizierte Überbrückungsdauer an späteren, beim Modellaufbau unbekannten Zeiträumen geprüft.
- [ ] Vergleich Vorheizen/Batterie/später heizen mit nachvollziehbarer Gesamtenergiebilanz ohne Doppelzählung.
- [ ] Herstellerregelung, Schutzfunktionen und eindeutige Aktorzuständigkeit bleiben erhalten.

## Quellen
Gelesene Praxisberichte von Martin Fierz:
- https://www.linkedin.com/pulse/tatort-heizkeller-4-die-hydraulik-1-martin-fierz
- https://www.linkedin.com/pulse/tatort-heizkeller-5-die-hydraulik-2-martin-fierz
- https://www.linkedin.com/pulse/tatort-heizkeller-3-der-mischer-martin-fierz/

Erfasst am 31.10.2026. Die Zurückstellung der thermischen Umsetzung bis zur kommenden Wärmepumpe aus #160 bleibt bestehen.

## Zugehörige Kommentare zum Archivzeitpunkt

### Kommentar 6545200138 – 2026-10-31T15:11:24Z

[Original](https://github.com/fuchs-1978/ioBroker.ems-optimizer/issues/306#issuecomment-6545200138)

Ergänzung nach Auswertung von Martin Fierz' Artikelreihe „Tatort Heizkeller“: Beiträge 1–9 inhaltlich zugänglich; der zehnte Kurzlink („Ganz abschalten“) war nicht erreichbar. Keine Behauptung einer vollständigen Zehner-Auswertung. Planung/Diagnose, keine Änderung der laufenden Anlage.

Zusätzlich zu den bereits erfassten Hydraulikpunkten für #160 prüfen:

1. Wärmebereitstellung nach Kosten je nutzbarer kWh Wärme planen, nicht nur nach Strompreis: p_el / COP als erste Näherung. COP abhängig von Außen-/Quellentemperatur, erforderlichem Vorlauf und Betriebspunkt; zusätzlich Speicherverluste, höherer Vorlauf beim Vorheizen, Hilfsstrom, PV-Opportunitätskosten und Batterie-Roundtrip berücksichtigen. Billige Nachtstunden sind nicht automatisch günstiger als wärmere Tagesstunden. Für die konkrete Stiebel Kennfelder und später Messdaten verwenden.
2. Mindestleistung und Taktverhalten als Planungsgrenzen: Wärmebedarf unter Mindestleistung von ungünstigem Regelverhalten unterscheiden. Verdichterstarts, Laufzeiten und Wärmebedarf gemeinsam auswerten; Warmwasser, Abtauung und Anfahrphasen kennzeichnen. Mindestlauf-/Stillstandszeiten und Herstellergrenzen berücksichtigen. Keine Steuerung jeder kurzfristigen PV-Schwankung hinterher.
3. Heizkurve und begrenzenden Raum/Heizkreis identifizieren: Raum-Soll/Ist, Außentemperatur, Vorlauf, Rücklauf und verfügbare Ventil-/Volumenstromdaten gemeinsam untersuchen. Geschlossene Thermostate können eine zu hohe Heizkurve verdecken, beweisen sie aber nicht. Komfort und unterschiedliche Heizkreise respektieren; keine pauschale Ventilöffnung oder automatische Heizkurvenabsenkung.
4. Heizgrenze als eigenes Thema: gefilterte Außentemperatur, Raumtemperaturen, solare/interne Gewinne und Prognose für bedarfsabhängiges Heizen prüfen, mit Hysterese. Warmwasserbedarf separat; Frostschutz und WP-interne Schutzfunktionen erhalten. Keine harte Netzabschaltung.
5. Warmwasser und Raumheizung getrennt bewerten: höhere Warmwassertemperaturen sollen nicht unnötig das Temperaturniveau der gesamten Raumheizung bestimmen. Tatsächliche Hydraulik und Betriebsarten zuerst dokumentieren.
6. Systemwirkungsgrad statt nur Verdichter-COP: Messgrenzen für erzeugte/gelieferte Wärme und Strom einschließlich Zusatzheizung und Hilfsantrieben festlegen. Temperaturdifferenzen allein ergeben keine kWh-Verluste.

Lasso/mehrdimensionale Auswertung: #284 betrifft bisher die elektrische Lastprognose. Ein thermisches Modell wäre eine eigene, zu validierende Erweiterung: vergangene Raum-/Außentemperaturen, Wetter/solare Gewinne und zugeführte Wärme könnten den Wärmebedarf bzw. die Gebäudereaktion prognostizieren. Das WP-Kennfeld übersetzt den Wärmebedarf in Strombedarf; Mindestleistung und Komfort bleiben Randbedingungen. Zeitlich getrennte Validierung und Vergleich mit einfacher Heizkurven-/Temperatur-Baseline erforderlich. Raumtemperatur ist Mess-/Regelgröße, nicht selbst der Regler. KONNEX-Anbindung bleibt separat in #304.

Nicht pauschal übernehmen: genannte Einsparquoten, Prozent-COP-Verbesserung pro Kelvin, optimaler Teillastpunkt seiner Oertli, pauschale Entfernung von Puffern/Mischern oder Komfortabsenkung bei Extremkälte. Alles an eigener Anlage prüfen.

Quellen:
- https://de.linkedin.com/pulse/tatort-heizkeller-1-martin-fierz
- https://de.linkedin.com/pulse/tatort-heizkeller-2-die-heizkurve-martin-fierz
- https://www.linkedin.com/pulse/tatort-heizkeller-3-der-mischer-martin-fierz/
- https://www.linkedin.com/pulse/tatort-heizkeller-4-die-hydraulik-1-martin-fierz
- https://www.linkedin.com/pulse/tatort-heizkeller-5-die-hydraulik-2-martin-fierz
- https://de.linkedin.com/pulse/tatort-heizkeller-6-modulation-regeltechnik-und-martin-fierz
- https://de.linkedin.com/pulse/tatort-heizkeller-7-die-heizgrenze-martin-fierz
- https://de.linkedin.com/pulse/tatort-heizkeller-8-luftw%C3%A4rmepumpen-martin-fierz
- https://de.linkedin.com/pulse/tatort-heizkeller-9-vors%C3%A4tzliche-schwerverbrechen-martin-fierz

