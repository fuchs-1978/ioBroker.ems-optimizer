# 0.17.0-alpha.143 – Fahrzeugphasen auch bei Mindestladung vor dem Start waehlen

## Reproduzierbare Luecke

Carsten verlangt die fahrzeugbezogene1P-/3P-Wahl **vor** der Ladefreigabe anhand der aktuell belegten nutzbaren Leistung. Eine solche Vorpruefung existiert bereits, enthielt aber eine Ausnahme fuer `vehicle.mustCharge`: darunter fallen auch manuelle Mindeststromanforderungen. Im aktuellen echten Phasenregler mit stehender, bestaetigt1P konfigurierter EQE und7000W eigenem gueltigem Budget waehlt der normale PV-Start sofort3P; dieselbe Situation mit manueller Mindestladung behaelt1P und startet stattdessen die laufende300-s-Aufwaertsqualifikation. Das kann genau den unerwuenschten Ablauf1P-Start und baldigen erneuten Phasenwechsel erzeugen.

Dies ist ein reproduzierter Softwarebefund, **keine nachtraeglich vollstaendige Erklaerung jeder realen Umschaltung**. Die reale Folge25.10.2026 hatte zunaechst3P nach Update, dann6A-Mindestladung und erst danach einen3P→1P-Wechsel. Der genaue historische eigene Budget-/Entscheidungsgrund fehlt; die beiden Ablaufrichtungen nicht gleichsetzen. [Phasenfall #8](https://github.com/fuchs-1978/ioBroker.ems-optimizer/issues/8), [getrennte Stopp-/Updateanalyse #216](https://github.com/fuchs-1978/ioBroker.ems-optimizer/issues/216).

## Korrektur

Die vorhandene Vorstartwahl gilt nun auch fuer manuelle/Pflicht-Mindestladung. Die einzige produktive Logikaenderung entfernt deren Ausschluss aus dem bestehenden `preStartReady`-Pfad. Fuer die Phasenwahl zaehlt das eigene aktuell erlaubte Fahrzeugbudget nach anderen Verpflichtungen und wirksamen Grenzen, nicht die gesamte PV-Erzeugung oder alleiniger Haus-Netzexport.

- Bei geeigneter3P-Hardware und ausreichend eigenem Budget wird der3P-Wunsch vor dem Start gesetzt. Fahrzeuggrenzen bestimmen die Schwellen: z.B.EQE20A1P gegenueber EQV32A1P. Eine feste Mii-Topologie bleibt1P.
- Reicht das eigene Budget fuer3P nicht, bleibt der bereits vorhandene1P-Mindestladepfad wirksam. Manuelle6A bedeuten weder eine neue pauschale3P-Freigabe noch ein beliebiges zusaetzliches Netzbudget.
- Nur ein gueltiger bestaetigter Stillstand mit AUS/elektrischer Ruhe, passender Quellenqualitaet und fehlender laufender Ausgangseigentuemerschaft kann den Vorstartpfad nutzen. Bei ungueltigen Quellen oder bereits laufender/pending Umschaltung gibt es diese Abkuerzung nicht.
- Phasenwunsch bleibt vom unabhaengigen Modus-ACK und der elektrischen Antwort getrennt. Der bestehende Ausgang/Folger muss die passende Topologie bestaetigen, bevor normal gestartet wird. Keine1P-Zwischenfreigabe allein aus einer3P-Empfehlung.
- Fuer bereits laufende Fahrzeuge gelten weiterhin die konfigurierten Qualifikations-/Haltezeiten und alle ACK-/Antwort-/Schutzgrenzen. Aendert sich das reale Budget nach dem Start, kann ein spaeterer Phasenwechsel weiterhin sachlich erforderlich sein; keine Garantie eines unveraenderlichen Modus.

Die io-package-Kurznotizen fuer141/142 werden ihren richtigen Releases zugeordnet;142 trug dort versehentlich den141-Diagnosetext. Keine Aenderung an Phasenskript, Anlage, Konfiguration, Netzzielen, Reserven, SQL/Recorder, Korrekturbudget oder Widerspruchs-Stoppregeln. Keine automatische Installation oder kuenstlichen Anlagenversuche.

## Regression und reale Abnahme

Sechs neue Offline-Faelle: EQE-/EQV-Mindestladung mit ausreichendem eigenem Budget; feste1P-Hardware/fehlender Stillstand/ungueltige oder pending Quellen; produktiver Parallelregler mit7000W und manuellem6A-Wunsch sowie derselbe Fall mit wirksamer3000W-Hartgrenze und mit20A-Mindeststrom (7000W reichen dann nicht fuer3P). Drei Vorstart-Faelle scheitern mit unveraenderter142 (1 statt3Phasen); die drei Schutzkontrollen bestehen bereits vorher. Nach Korrektur bestehen alle sechs. Lokale Gesamtsuite3019/3019,151 gezielte Phasen-/Parallelreglertests, Paketmetadaten, isolierter installierter Tarball und beide historischen Vergleichswerkzeuge bestanden. Bestehende Output-/Folger-/Neustarttests pruefen weiterhin, dass ohne echte passende Modusbestaetigung keine Ladefreigabe erfolgt.

Nach separat vorgenommener Installation143 einen **natuerlichen** geeigneten Ladebeginn abnehmen: historische Freigaben/Fahrzeuggrenzen, eigenes Budget und Phasenentscheidungsgrund vor EIN, dann angeforderte/bestaetigte Phasen, Soll-/ACK und neue reale L1–L3-/Leistungsantwort. Ein unmittelbar vermeidbarer1P-Anlauf bei schon vorher ausreichend belegtem3P-Budget soll ausbleiben. Fuer Energiepotenzial fehlen belastbare gleichzeitige Kapazitaets-/Energienachweise; keine Einsparung oder Scorepunkte aus Tests behaupten.

Der Stopp25.10.um10:39:34 MEZ bleibt davon unabhaengig: Ausloeser Sollstromkonflikt bekannt, genauer gescheiterter Guard und Herkunft der Abweichung mangels damaliger Original-Command-/Feedbackwerte/Zeitstempel offen. Die Wallbox war vor dem Update10:40:08 bereits aus; keine gescheiterte laufende3P-Neustartuebernahme daraus ableiten. Kein spekulativer zweiter go-e-Fix; bestehender Upstream-PR366 bleibt der zu pruefende Antwortordnungspfad.
