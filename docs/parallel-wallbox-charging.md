# Parallele Wallboxladung

Die gemeinsame Wallboxzuteilung versorgt mehrere angeschlossene, freigegebene
Fahrzeuge gleichzeitig. Mindest-SoC und Priorität haben dabei unterschiedliche
Aufgaben: Der Mindest-SoC schützt die Grundversorgung; die Priorität bestimmt,
welches Fahrzeug die verbleibende Leistung zuerst erhält.

## Einstellung

Im Admin unter **Wallboxen allgemein → Wallboxen parallel laden** befindet sich
`wallboxParallelChargingEnabled`. Der zugehörige Konfigurationsdatenpunkt ist
`Config.WallboxParallelChargingEnabled`.

Die Option ist im Paketstandard aktiviert. Eine explizit deaktivierte Option
stellt den bisherigen sequenziellen Betrieb mit einer zugeteilten Wallbox wieder
her. Fehlt die Option in einer alten Laufzeitkonfiguration, bleibt der sequenzielle
Fallback erhalten. Die Option aktiviert weder Master Control noch produktive
Ausgänge und ersetzt keine Gerätefreigabe. Vor einem begleiteten Einsatz muss der
angezeigte Wert daher geprüft werden; die Veröffentlichung installiert nichts.

Die vorhandene Prioritätsquelle (`Automatisch / kompatibel`, Admin oder externer
Datenpunkt) bleibt bestehen. Eine gültige bevorzugte Wallbox steht bei der
Mehrleistungsverteilung an erster Stelle. Weitere Fahrzeuge folgen der bestehenden
automatischen Reihenfolge. Es gibt keine neue, unabhängige Priorität-1/2/3-Liste.

## Zuteilung

1. Ladeberechtigte Fahrzeuge unter ihrem **gültig gemeldeten Mindest-SoC** erhalten
   zuerst eine Mindestleistung für einphasiges Laden, grundsätzlich 6 A. Wirksame
   höhere konfigurierte oder manuelle Mindestströme sowie Gerätebegrenzungen werden
   berücksichtigt. Fehlender oder ungültiger SoC ist kein Nachweis einer
   Unterschreitung. Die alten automatischen Niedrig-SoC-Stufen (etwa 10, 16 oder
   25 A) bleiben als Konfigurationshinweis sichtbar, erhöhen im Parallelmodus aber
   nicht die Grundreservierung. Ein expliziter manueller Mindeststrom bleibt wirksam.
2. Das übrige Fahrzeugbudget erhält zunächst das bevorzugte Fahrzeug, bis zu
   seiner wirksamen Strom-, Leistungs-, Phasen- und SoC-Grenze.
3. Nutzbarer Rest geht an die folgenden Fahrzeuge. Auch oberhalb ihres Mindest-SoC
   dürfen mehrere Fahrzeuge bis zu ihrem jeweiligen **Ziel-SoC** laden.
4. Entfällt der Wärmebedarf, belegt der Heizstab hierfür kein neues Ladebudget.
   Verfügbarer Rest kann den Fahrzeugen nach derselben Reihenfolge zugute kommen.
   Noch nicht elektrisch bestätigte Heizstab-Befehle bleiben reserviert.

Zwei Grundladungen mit 6 A benötigen bei 230 V nominal 2,76 kW, drei 4,14 kW. Die
Mindest-SoC-Ladung kann erlaubten Netzbezug benötigen. Sie umgeht keine
Hausanschluss-, §14a-/Netzbetreiber- oder Gerätegrenze. Reicht das sichere Budget
nicht für alle Grundladungen, bestimmt die Reihenfolge, welches Fahrzeug warten
muss; ein nicht nutzbarer Teilbetrag erzeugt keine Ladung unter dem zulässigen
Mindeststrom.

### Beispiel ohne Heizstabbedarf

Bei 10 kW freiem Fahrzeugbudget und einem bevorzugten Mii mit wirksamer
Einphasengrenze von 32 A:

| Voraussetzung | Mii | Nächstes Fahrzeug |
|---|---:|---:|
| Beide Fahrzeuge dürfen laden, Mii kann 32 A nutzen | bis 7,36 kW | verbleibendes, in Stromstufen nutzbares Budget |
| Nächstes Fahrzeug liegt unter seinem Mindest-SoC | seine Grundladung wird zuerst reserviert; Mii erhält den Rest bis 32 A | mindestens 6 A, soweit sichere Grenzen es erlauben |
| Gemeinsame Grenze reicht nur für eine Grundladung | Zuteilung nach Reihenfolge | nachvollziehbarer Wartegrund |

32 A ist ein Beispiel, keine neu gesetzte Gerätegrenze. Fahrzeugaufnahme und
Kommunikationsrückmeldung bestimmen, ob ein angeforderter Strom tatsächlich
nutzbar ist. Laufende Befehle werden bis zu ihrer bestätigten Antwort reserviert;
sie dürfen nicht zugleich einem zweiten Fahrzeug als freies Budget dienen.

## Phasen und produktive Ausgänge

Die Zuteilung berücksichtigt die konfigurierte Netzphase bei einphasigen
Wallboxen sowie die Belastung aller drei Phasen bei dreiphasigem Laden. Eine
Anforderung von 1 P ersetzt keine reale Phasenbestätigung. Bestätigte
Stromvorgabe, Freigabe, Fahrzeugreaktion und tatsächlich gemessene Ströme bleiben
getrennte Nachweise.

Eine bloße Prioritätsänderung darf bei aktiviertem Parallelbetrieb die geschützte
Mindestladung eines anderen Fahrzeugs nicht verdrängen. Für Leistungsänderungen
und weitere Starts bleiben Kommunikationsfristen, Start-/Stopptimer,
Mindestlaufzeiten und Schutzgrenzen wirksam. Die bestehende koordinierte
Einzel-Wallbox-Übergabe gilt weiter bei deaktiviertem Parallelmodus. Ein zentraler
positiver Sollwert allein ist keine produktive Freigabe und kein Beleg, dass ein
Auto bereits lädt.

## Diagnose und SQL-Auswertung

| Datenpunkt | Bedeutung |
|---|---|
| `Control.SelectedWallbox` | Erstes bevorzugtes bzw. automatisch ausgewähltes Fahrzeug; nicht die vollständige Teilnehmerliste |
| `Control.ActiveWallboxes_JSON` | Zentral zugeteilte Teilnehmer mit positivem Stromsoll; **keine gemessene Aktivitätsliste** |
| `Control.ParallelWallboxStatus` | Erklärung der gemeinsamen Zuteilung bzw. ihrer Grenzen |
| `Control.ParallelWallboxAllocation_JSON` | Schema 1: Zeitpunkt, Gültigkeit, Reihenfolge, Stromzuteilung (`budgetW`), globales Schutzbudget (`hardBudgetW`), verbleibendes Budget nach Batterieanteil (`slowBudgetW`), Nennspannung, Zuteilungen und Wartegründe |
| `Control.Targets.WallboxN_A` / `_W` | Zentraler Strom-/Leistungssollwert je Fahrzeug |
| `Vehicles.WallboxN.*` | Gültiger SoC, Mindest-/Ziel-SoC, Ladeberechtigung, Timer und wirksame Stromgrenzen |
| `Devices.WallboxN.OutputActive` / `OutputOwned` | Zustand und Zuständigkeit des produktiven Ausgangs; getrennt von gemessener Ladeleistung |
| `Devices.WallboxN.Response*` | Befehl, ACK und Fahrzeugreaktion samt verbleibender Frist |

Die Aufzeichnungsdiagnose enthält die begrenzte gemeinsame Zuteilung und weiterhin
für jede Wallbox eigene Befehle, Status, SoC-Grenzen und gültige reale Messwerte.
Eine ungültige gemeinsame Zuteilung oder fehlende Messwerte bleiben unbekannt.
Weder ein Nullbudget noch ein positiver Planwert beweist einen realen Freigabewechsel.

In der nächsten Betriebsanalyse sind insbesondere zu prüfen:

- Zwei oder drei Fahrzeuge unter Mindest-SoC: Grundladungen, Summe der reservierten
  Leistung und tatsächliche Phasenbelastung sind zusammen nachvollziehbar.
- Prioritätswechsel: Grundladung bleibt erhalten; Mehrleistung wechselt innerhalb
  der eingestellten Kommunikations- und Fahrzeugreaktionsfristen.
- Erstes Fahrzeug am wirksamen Maximum, zweites unter Ziel-SoC: Rest wird nach
  bestätigter Budgetfreigabe nutzbar zugeteilt; unverarbeitete Befehle werden nicht
  doppelt gerechnet.
- Ziel-SoC, Abstecken, ungültige Quellen und engere §14a-/Hausanschlussgrenzen:
  Reduzierung oder Stopp erfolgt nachvollziehbar, mit unabhängiger Rückmeldung.
- Prognose und Schattenmodell zeigen mehrere Sollteilnehmer, ersetzen aber keine
  reale Mehrfahrzeugabnahme und simulieren Speicher/Wärmebedarf nicht vollständig.

Regressionstests belegen die implementierten Regeln. Ein höherer Score und eine
bestandene reale Abnahme entstehen erst durch ausreichend zusammenhängende
Betriebsdaten und bestätigte Geräteantworten.
