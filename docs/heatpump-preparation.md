# Wärmepumpe vorbereiten: Messung und Empfehlungen

Stand: 0.17.0-alpha.57. Der Adapter erzeugt ausschließlich eigene Diagnose-
und Anforderungsobjekte. Er schreibt weder Modbus-/ISG-Register noch KNX-
Objekte, SG-Ready-Eingänge, Verdichterfreigaben oder Temperatursollwerte.
Die lokale WP-Regelung und ihre Geräteschutzfunktionen bleiben verantwortlich.
Ein Update aktiviert keine Wärmepumpe oder zusätzliche Geräteausgänge.

## Admin: Wärmepumpe

Der Reiter trennt Messung/Rückmeldung, SG-Ready-Empfehlungen, getrennte
Heiz-/Kühlwünsche und den noch offenen Ausführungsvertrag. Quellen können
vorbereitet werden, während Anwesenheit und Empfehlungen ausgeschaltet sind.

- **Leistung:** Ein Originalobjekt mit bestätigter, frischer elektrischer
  Leistungsaufnahme auswählen; Einheit ausdrücklich W oder kW einstellen.
  kWh-/MWh-Zähler sind Energie und gehören nicht in dieses Feld.
- **Messumfang:** Gesamt-WP einschließlich relevanter Zusatzverbraucher oder
  ausschließlich Inverter. Eine Invertermessung ist keine vollständige
  WP-Messung für das gemeinsame §14a-/LPC-Budget.
- **Verbindung:** Optionale bestätigte boolesche Rückmeldung. Wenn eine Quelle
  eingetragen ist, sind unbekannt, veraltet oder AUS kein Verbindungsnachweis.
- **SG-Ready-Rückmeldung:** Optional ein bereits dekodierter Zustand 1–4;
  keine zwei Rohbits und kein allgemeines Betriebsstatus-Bitfeld. Die
  Rückmeldung bestätigt einen Zustand, noch keinen ausgeführten EMS-Befehl.
- **Temperaturen:** Frische Heizpuffer-/Warmwasserquellen und begrenzte
  Speicherziele. Mindesthaltezeit und PV-Hysterese stabilisieren Empfehlungen.
- **Maximalanforderung:** Eigene, standardmäßig ausgeschaltete Freigabe mit
  höheren Ein-/Ausschaltschwellen. Eine Anforderung ist kein genauer Watt-Sollwert.
- **Kühlwunsch:** Eigene, standardmäßig ausgeschaltete Freigabe mit Raum-,
  Taupunkt- und Vorlauftemperatur sowie Raum-/Vorlaufziel und Taupunktabstand.
  Der gemeinsame bestätigte Kühlstatus kommt aus der thermischen Strategie.

Sämtliche WP-Teilnahme- und Boostfreigaben bleiben im Paketstandard AUS;
Quellen sind leer. Leistung verfällt standardmäßig nach 30 s,
Verbindungs-/SG-Rückmeldungen nach 120 s, Heizpuffer-/Warmwassertemperaturen
nach 3600 s. Die Kühl-Raum-/Taupunkt-/Vorlaufdaten verwenden die kürzere
der Temperatur- und Rückmeldungsfristen, standardmäßig höchstens 120 s.
Vorhandene ungültige oder `null`-Einstellungen bleiben unbekannt; sie
werden nicht durch freigebende Standardwerte ersetzt.
Für einen späteren Livebetrieb müssen die tatsächlichen Abtast- und
Reaktionsfristen passend zur Anlage geprüft werden.

## Eigene Diagnoseobjekte

Unter `Devices.HeatPump.*` werden Leistung, Messumfang, Quellenalter und
Gültigkeit getrennt veröffentlicht. Unbekannte numerische Werte sind `null`;
nur eine gültige bestätigte Nullmessung ist 0 W. `Actual.HeatPump_W` verwendet
dieselbe normierte Quelle. Fehlende Werte einer nicht vorhandenen WP machen
die übrige Anlage nicht ungültig.

`SGReadyRequestedState` ist eine semantische Empfehlung:

| Zustand | Bedeutung in klassischem SG Ready | Umsetzung in alpha.57 |
|---|---|---|
| 1 | Sperrbetrieb, nur Frostschutz | Keine automatische Anforderung |
| 2 | Normalbetrieb | NORMAL und die ältere REDUCED-Empfehlung |
| 3 | Erhöhte Heiz-/Warmwasser-Ziele | BOOST bei gültiger Freigabe und Wärmebedarf |
| 4 | Maximalbetrieb für Heizung/Warmwasser | MAX nur mit eigener Freigabe und ausreichend hohem belegtem PV-Budget |

Die bestehende interne `RequestedModeValue`-Skala bleibt erhalten:
REDUCED=0, NORMAL=1, BOOST=2; MAX=3 ergänzt sie. Diese Zahlen sind keine
SG-Ready-Zustände und dürfen nicht unmittelbar an Herstellerregister
geschrieben werden. REDUCED=0 bedeutet insbesondere keinen Verdichterstopp.

`HeatingBoostRequested` und `CoolingBoostRequested` sind ausschließlich
interne Wünsche für eine zukünftige, separat abgenommene KNX-Anbindung.
Der Heizwunsch benötigt freie Heizpufferkapazität; reiner Warmwasserbedarf
erzeugt keinen KNX-Heizwunsch.
`OutputOwned` und `OutputActive` bleiben immer false. Die Empfehlungen
begründen keine bestätigte Stellwirkung.

## Kühlen ist ein eigener Vertrag

Die Stiebel-ISG-Anleitung, Kapitel 7.8.1, erklärt ausdrücklich, dass ihr
SG-Ready-Energiemanagement den Kühlbetrieb nicht beeinflusst. Deshalb
erzeugt aktives Kühlen keine Heiz-SG-Ready-3/4-Anforderung.

Ein separater PV-Kühlwunsch benötigt bestätigten Kühlbetrieb, gültige
elektrische/Netz-/Raum-/Taupunkt-/Vorlaufdaten und zum Start tatsächlich
verfügbaren PV-Überschuss. Die PV-Hysterese und Mindesthaltezeit können
einen bereits begonnenen Wunsch bei weiterhin gültigen Quellen vorübergehend
auch unterhalb der PV-AUS-Schwelle halten. Das ist keine Bestätigung eines
weiterhin ausreichenden momentanen PV-Angebots. Der vorgeschlagene
Vorlaufsollwert liegt mindestens bei Taupunkt plus eingestelltem Abstand.
Raumziel 16–30 °C, Vorlaufziel 15–30 °C und Abstand 0,5–10 K entsprechen
den Admin-Grenzen; ein taupunktbedingt nötiger Vorlauf über 30 °C ist
für diesen Vertrag ungültig und erzeugt keinen Kühlwunsch. Ohne tatsächlichen Kühlbedarf oder
ohne mögliche weitere Vorlaufabsenkung entsteht kein Boostwunsch.
Ein Ende der Freigabe, ungültige Daten oder eine Schutzbegrenzung verwirft
den Wunsch sofort. Diese Softwaregrenze ersetzt nicht die lokale
Taupunkt-/Feuchteüberwachung und deren Herstelleranforderungen.

## Netzbilanz und §14a

Der WP-Verbrauch wirkt bereits auf den gemessenen SMA-Netzfluss. In der
gewöhnlichen PV-Verteilung wird er nicht nochmals abgezogen oder als
flexibel zurückgewinnbare Leistung gutgeschrieben.

Bei aktivem gemeinsamem §14a-/LPC-Budget wird eine gültige vollständige
WP-Messung zuerst abgezogen, beispielsweise 4200 W minus 2000 W = 2200 W
Rest für die anderen begrenzten Verbraucher. Fehlende oder nur teilweise
erfasste WP-Leistung ergibt ein unbekanntes/sicher gesperrtes Restbudget,
keinen angeblichen 0-W-WP-Verbrauch. Das ist noch keine Drosselung der WP.

Eine aktive oder ungültige Netzbetreiberbegrenzung verwirft Boostwünsche
sofort. Der Adapter hat weiterhin keinen WP-Leistungsbegrenzungsausgang.

## Stiebel-Register und offene Ausführung

Herstelleradressen sind 1-basiert; ioBroker-Importadressen können um 1
kleiner sein. Geräte- und Firmwareverfügbarkeit sind vor Nutzung zu lesen.

- Input **3680**: Inverteraufnahme IWS 1, kW; gemäß WPMsystem-Tabelle
  Rohwert × 0,1. Das ioBroker-Objekt muss bereits richtig skaliert sein;
  im EMS wird nur die ausgewählte Einheit W/kW normiert.
- Holding **4002/4003**: Eingänge 1/2. Ihre Wirkung hängt vom Eingabemodus ab.
- **4257**: verfügbare Leistungsaufnahmesteuerung prüfen.
- Holding **4258**: Eingabemodus. Klassisches SG Ready und
  Power Limitation / Load Up interpretieren dieselben Bits verschieden.
  Beide Eingänge EIN bedeutet bei PL/LU eine Begrenzung, nicht SG-Ready-Maximalbetrieb.
- Holding **4259**: Leistungsbegrenzung. Einheit, Skalierung und Wertebereich
  sind in der vorliegenden Modbus-Tabelle nicht vollständig beschrieben.
  Deshalb wird kein Schreibwert geraten oder Ausgang eingerichtet.
- Holding **1604–1608 / 1704–1708**: Raum-/Vorlaufsollwerte der Kühlkreise;
  Input **2520**: Kühlbetriebsstatus. Das Vorhandensein dieser Register ist
  noch kein bestätigter Kühlfreigabe- oder Boostvertrag.

Quellen, geprüft am 09.10.2026:

- [Stiebel Modbus-Anleitung](https://www.stiebel-eltron.com/content/dam/ste/cdbassets/current/commissioning_manual/commissioning_manual_doc-00081716.pdf), WPMsystem- und Energiemanagementtabellen.
- [ISG Connect Bedienung und Installation](https://www.stiebel-eltron.com/static/ste/docportal/manual/DM0000117548-gxg.pdf), Kapitel 7.7–7.8.

Offen bleiben der konkrete WP-/ISG-Firmwarestand, vollständige elektrische
Messung, sichere Registerkodierung/Schreibreihenfolge, Rückmeldung und
Reaktionsfrist, Verhalten bei Kommunikationsausfall, Übergabe und Rückgabe.
Eine automatische Preissperre in Zustand 1 benötigt zusätzlich geprüfte
Komfort-Untergrenzen und eine maximale Sperrdauer. Diese Vorbereitung
enthält weder eine vollständige WP-Prognose noch eine reale Abnahme.

## Nächste Betriebsprüfung

Nach einer späteren, bewusst konfigurierten Messanbindung zuerst lesend
prüfen: richtige Einheit, tatsächlicher Messumfang, Quellenalter/ACK/q,
Nullmessung gegenüber unbekannt und §14a-Restbudget. SG-Rückmeldung und
Empfehlung bleiben getrennt. PV-Hysterese, MAX-Freigabe, Kühlstatus und
Taupunktgrenze mit Originalquellen vergleichen. Keine positive Empfehlung
als beobachteten Verdichterstart, Wärmeertrag oder Kühlleistung darstellen.
Bestehende SQL-Einstellungen werden nicht verändert; fehlende historische
WP-Aufzeichnung bleibt unbekannt.

Softwaretests prüfen die Rechen- und Freigabeverträge. Sie ersetzen keinen
begleiteten Geräteversuch und erzeugen keine vorweggenommenen Scorepunkte.
