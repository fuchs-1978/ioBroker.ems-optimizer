# ioBroker EMS Optimizer

Aktuelle Adapterversion: **0.17.0-alpha.134**. Diese deutsche Bedienungsanleitung beschreibt die Admin-Oberfläche dieses Stands. Der Adapter ist noch im Alpha-Stadium; GitHub-Veröffentlichung und Softwaretests sind keine vollständige reale Betriebsabnahme.

EMS Optimizer verbindet aktuelle PV-/Netzmessungen, historische Lastprofile, Wetter-/PV-Prognosen und Strompreise zu einem rollierenden 48-Stunden-Fahrplan. Der Echtzeitregler kann nach ausdrücklicher Freigabe bis zu drei Wallboxen, einen Warmwasser-Heizstab sowie getrennte vorbereitete Heizpuffer-/Speicherausgänge koordinieren. Die Wärmepumpe wird aktuell gemessen und erhält **passive Empfehlungen**; der Adapter sendet keine WP-/SG-Ready-/KNX-Stellbefehle. Die reale Wallbox-Phasenumschaltung übernimmt ein passend geprüftes externes Skript.

## 0.17.0-alpha.134

Bestaetigte Ladung beim Wiederkehren frischer Wallboxdaten vor dem naechsten Parallelverteiler-Takt nicht unnoetig unterbrechen. [Versionshinweise](docs/release-0.17.0-alpha.134.md).

## 0.17.0-alpha.133

Zeitlich markierte Auffaelligkeiten mit begrenzten SQL-Untersuchungsfenstern in der Tagesbilanz. [Datenvertrag und Grenzen](docs/release-0.17.0-alpha.133.md).

## 0.17.0-alpha.132

Kompakte passive Tagesbilanz unter `Debug.DailySummary_JSON`, ohne SQL-Vollabruf. [Datenvertrag und Grenzen](docs/release-0.17.0-alpha.132.md).

## 0.17.0-alpha.131

Verspaetete zusammenpassende go-e-Sollstrommeldungen erhalten bis zu 10 Sekunden Beruhigungszeit bei weiterhin gueltigen Schutzmessungen. [Versionshinweise](docs/release-0.17.0-alpha.131.md).

## Inhaltsverzeichnis

- [Betriebsarten und sichere Zuständigkeit](#betriebsarten-und-sichere-zuständigkeit)
- [So liest man die Admin-Anleitung](#so-liest-man-die-admin-anleitung)
- [Admin: Allgemein](#admin-allgemein)
- [Admin: Messwerte](#admin-messwerte)
- [Admin: Historie und Prognose](#admin-historie-und-prognose)
- [Admin: Preise und Tarife](#admin-preise-und-tarife)
- [Admin: Wallboxen allgemein](#admin-wallboxen-allgemein)
- [Admin: Wallbox 0, 1 und 2](#admin-wallbox-0-1-und-2)
- [Admin: Warmwasser-Heizstab](#admin-warmwasser-heizstab)
- [Admin: Heizpuffer](#admin-heizpuffer)
- [Admin: Batteriespeicher](#admin-batteriespeicher)
- [Admin: Wärmepumpe](#admin-wärmepumpe)
- [Admin: Wärmestrategie](#admin-wärmestrategie)
- [Admin: Echtzeitregelung](#admin-echtzeitregelung)
- [Admin: Erweiterte Datenpunkte](#admin-erweiterte-datenpunkte)
- [Typische Einrichtung und Fehlersuche](#typische-einrichtung-und-fehlersuche)
- [Diagnose, SQL und Datenqualität](#diagnose-sql-und-datenqualität)
- [Changelog und historische Detaildokumentation](#changelog)

## Betriebsarten und sichere Zuständigkeit

| Bereich | Was er bedeutet |
| --- | --- |
| Planung/Beobachtung | Empfehlungen und geplante Energiemengen, keine Bestätigung tatsächlicher Schaltvorgänge. |
| Schattenbetrieb | Isolierte modellierte Wallbox-Ausgangsantwort bei Master AUS. Keine vollständige Simulation von Speicher, WP, Heizstab und Fahrzeug-SoC. |
| Livebetrieb | Reale Befehle nur bei passender Master-, Geräte- und Ausgangsfreigabe sowie gültigen Quellen und Schutzgrenzen. Bei Master EIN ist die vorgesehene Schattenpause kein Telemetriefehler. |
| Externe Phasenführung | Passendes Skript führt den internen go-e-Moduswechsel aus; EMS-Ziel, Modus-ACK und elektrische Antwort bleiben getrennte Nachweise. |

Pro Stellregister darf genau ein zuständiger Regler arbeiten. Vor Livefreigabe müssen konkurrierende Leistungs-/Freigabeschreiber beendet sein; Mess-, SoC-, Schutz- und benötigte Phasen-/Pumpenskripte sind gesondert zu beurteilen. Ein Update ist keine neue Anlagenfreigabe. Bei Rückgabe zuerst den externen EMS-Phasenfolger deaktivieren bzw. seinen geprüften Mastervertrag beachten, dann Master zurücknehmen, AUS-Rückmeldungen und elektrische Ruhe abwarten und erst danach den Bestandsregler übernehmen lassen. `OutputOwned=false` allein ersetzt nicht jede physische Rückmeldung. Ein Hostausfall erlaubt dem EMS keinen garantierten letzten AUS-Befehl; unabhängige Geräte-/Anlagenschutzfunktionen bleiben erforderlich.

## So liest man die Admin-Anleitung

Die folgenden Kapitel folgen den **Reitern im ioBroker-Admin**. Der technische Schlüssel hilft bei Suche und Fehlersuche; im Admin steht die deutsche Bezeichnung. Die angegebenen Vorgaben sind **Auslieferungswerte des Admin-Schemas**, keine Empfehlung für jede Anlage und keine Aussage über bereits installierte Einstellungen. Bestehende Konfiguration und Migration können andere Werte haben.

Ein Feld „Datenpunkt“ benötigt die **vollständige Objekt-ID eines vorhandenen ioBroker-States**, nicht dessen Anzeigename, aktuellen Zahlenwert oder Browseradresse. Beispielsweise `meter.0.pregard` ist eine ID, `738` ist ein Messwert. Ein Basisdatenpunkt ist dagegen der gemeinsame Baumpräfix der unterstützten Unterstruktur. Beispiel-IDs in dieser Anleitung sind generisch und müssen ersetzt werden.

Lesende Quellen und beschreibbare Stellregister sind verschieden. Ein ACK bestätigt einen Treiber-/Gerätewert; `ack=false` kann ein Auftrag/Echo sein. Qualität `q`, Quellenzeit `ts` und Änderungszeit `lc` sind getrennt: konstante Temperatur mit neuer Bestätigung kann frisch sein, ein unverändertes altes Objekt nicht. Ein zyklisches Aggregationsskript darf nur bei tatsächlich gültigen Originalquellen eine neue gültige Bestätigung ausgeben.

Ein leeres optionales Feld bedeutet nur dann „nicht verwendet“, wenn keine alte JSON-Zuordnung greift. Für nicht vorhandene Geräte „vorhanden“ deaktivieren, statt künstliche Nullquellen zu hinterlegen. Änderungen an Admin-Feldern speichern; anschließend Diagnose und tatsächlich wirksame Zuordnung prüfen. Die Anleitung aktiviert oder installiert nichts.

## Admin: Allgemein

Hier stehen die übergeordneten Freigaben. Die gemeinsamen elektrischen Grenzen befinden sich im folgenden Reiter „Netzanschluss / §14a / EEBUS“. Geräte besitzen zusätzliche eigene Freigaben. Die physische Sicherung und Netzbetreiberbegrenzung können durch keine Priorität oder Mindestladung aufgehoben werden.

### Allgemeine Freigaben

| Feld / technischer Schlüssel | Auslieferung | Zweck und erwartete Eingabe |
| --- | --- | --- |
| Master-Freigabe für konfigurierte reale Ausgänge<br>`globalWriteEnabled` | AUS | Übergeordnete Freigabe für reale Stellbefehle. AUS bedeutet keine normale produktive Freigabe; EIN allein startet kein Gerät. Zusätzlich müssen Geräte-Regelfreigabe, jeweilige Ausgangsfreigabe, gültige Messwerte und Schutzbedingungen passen. Schattenmodell und Live-Regler getrennt betrachten. |
| ALPHA-Regelung für freigegebene Wallboxen und Warmwasser aktivieren (konkurrierende Stellskripte gestoppt)<br>`multiWallboxAlphaArmed` | AUS | Bewusste Freigabe der Alpha-Regelung für die freigegebenen Wallboxen und Warmwasser. Vorher konkurrierende Leistungs-/Freigabeschreiber stoppen. Ersetzt weder Master noch die Freigabe des einzelnen Ausgangs. |

## Admin: Netzanschluss / §14a / EEBUS

Die bisherigen Hausanschluss-, Kontakt- und EEBUS-Felder wurden mit unveraenderten technischen Schluesseln aus „Allgemein“ in diesen Reiter verschoben. Das Update aktiviert keine Quelle und erhoeht kein bisheriges Limit.

### Zentraler Hausanschlussschutz

| Feld / technischer Schlüssel | Auslieferung | Zweck und erwartete Eingabe |
| --- | --- | --- |
| Physische Hausanschlusssicherung je Phase<br>`houseConnectionFuseA` | 50 A | Nennstrom der tatsächlich eingebauten Hausanschlusssicherung je Phase, in A. Kein gewünschter Ladestrom. Muss zur elektrischen Anlage passen; nicht erhöhen, um mehr Ladeleistung zu erzwingen. |
| Regelreserve unterhalb des Sicherungsnennstroms<br>`houseConnectionReserveA` | 4 A | Abstand unter dem Sicherungsnennstrom. Beispiel: 50 A Sicherung minus 4 A Reserve ergibt 46 A Arbeitsgrenze je Phase. Die gemeinsame Grenze gilt für die beteiligten Verbraucher; Phasenmessung und Anschlusszuordnung bleiben wichtig. |

### §14a / EEBUS LPC

| Feld / technischer Schlüssel | Auslieferung | Zweck und erwartete Eingabe |
| --- | --- | --- |
| Optionaler Datenpunkt für den §14a-Binärkontakt<br>`par14aId` | leer | Objekt-ID eines vorhandenen booleschen/numerischen Begrenzungskontakts. Liefert die Aktivität der Netzbetreiberbegrenzung, nicht die Leistung. Leer nur, wenn diese Quelle nicht verwendet wird. Kein frei erfundener Ersatz für ein reales Begrenzungssignal. |
| Binärkontakt: true/1 bedeutet aktive Begrenzung<br>`par14aActiveHigh` | EIN | Legt die Polarität des Kontakts fest: aktiviert = true/1 begrenzt; deaktiviert = umgekehrte Logik. An der tatsächlichen Kontaktverdrahtung und deren ioBroker-Abbildung prüfen. |
| Feste Leistungsgrenze des Binärkontakts<br>`par14aLimitW` | 4200 W | Gesamtes vom Binärkontakt vorgegebenes Leistungsbudget in W für die berücksichtigten steuerbaren Verbraucher, nicht automatisch je Wallbox. Default 4200 W ist ein Software-Ausgangswert; die korrekte Anlagenvorgabe prüfen. |
| Budgetquelle des §14a-Binaerkontakts<br>`par14aBudgetMode` | fixed | `fixed`: bisheriges Festbudget; `ems`: Mindestleistung anhand der unten konfigurierten, dauerhaft zugeordneten Gruppe; `external`: frisches externes Gesamtbudget. Die Auswahl betrifft den Binärkontakt. LPC wird unabhängig mit seiner bisherigen Status-/Limitzuordnung ausgewertet. |
| EMS-Teilnehmergruppe<br>`par14aParticipants` | leer | Je Einrichtung einen eindeutigen Namen, Typ und elektrische Netzanschlussleistung in W erfassen. Ladepunkte und Speicher einzeln; WP bzw. Klima werden je Fallgruppe zusammengefasst. WP-Leistung einschließlich relevanter Zusatzheizung genau einmal angeben. Nicht thermische WP-Leistung, Akkukapazität oder momentane Autoladeleistung eintragen. Es zählt die vereinbarte feste Gruppe, niemals die Anzahl gerade ladender Autos. Eigenständige Heizstäbe sind keine zusätzliche SteuVE. |
| Externes Binärkontakt-Gesamtbudget<br>`par14aLimitId`, `par14aLimitUnit` | leer / W | Getrennt vom Aktivkontakt konfigurieren; Quelle in W oder ausdrücklich kW. Nur bestätigte, qualitätsgültige Werte mit Zeitstempel innerhalb 15 s werden akzeptiert. Bei unverändertem Wert muss die Quelle ihre Gültigkeit entsprechend aktualisieren. Bei aktivem Kontakt und fehlendem/ungültigem Budget keine positive Freigabe. Kein GZF-Zuschlag auf das externe Gesamtbudget. |
| Erweiterte abweichende GZF-Tabelle<br>`par14aGzfOverrideEnabled`, `par14aGzfFactors` | AUS / Standardwerte | Ohne ausdrückliche Aktivierung gelten die offiziellen Standardwerte. Abweichungen benötigen vollständig n=2 bis n>=9, Faktoren >0 bis 1 und eine nicht ansteigende Folge. Aktive Abweichungen werden als `custom-deviation` und im Status gekennzeichnet; das ist keine Bestätigung ihrer Zulässigkeit für den jeweiligen Netzanschluss. |
| Datenpunkt EEBUS LPC.state<br>`lpcStateId` | leer | Objekt-ID des Zustands der EEBUS-Begrenzung aus dem EEBUS-Adapter. Zustand und zugehöriges Leistungsbudget zusammen zuordnen; kein manuelles Dauer-OK erzeugen. LPC betrifft Leistungsbezug, LPP die Erzeugungsseite. LPP ist optional und keine zusätzliche Ladestromfreigabe. |
| Datenpunkt EEBUS LPC.limit<br>`lpcLimitId` | leer | Objekt-ID des zugehörigen EEBUS-Leistungslimits in W. Nicht mit Status, Dauer oder Zähler verwechseln. Bei gleichzeitig aktivem §14a-Kontakt und LPC gilt das engere wirksame Budget; unbekannte relevante LPC-Rückmeldungen sind kein unbegrenztes Budget. |
| Optionaler Datenpunkt EEBUS LPP.state<br>`lppStateId` | leer | Objekt-ID des Zustands der EEBUS-Begrenzung aus dem EEBUS-Adapter. Zustand und zugehöriges Leistungsbudget zusammen zuordnen; kein manuelles Dauer-OK erzeugen. LPC betrifft Leistungsbezug, LPP die Erzeugungsseite. LPP ist optional und keine zusätzliche Ladestromfreigabe. |
| Optionaler Datenpunkt EEBUS LPP.limit<br>`lppLimitId` | leer | Objekt-ID des zugehörigen EEBUS-Leistungslimits in W. Nicht mit Status, Dauer oder Zähler verwechseln. Bei gleichzeitig aktivem §14a-Kontakt und LPC gilt das engere wirksame Budget; unbekannte relevante LPC-Rückmeldungen sind kein unbegrenztes Budget. |

### EMS-Berechnung und Diagnose

| Zahl der SteuVE n | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | ab 9 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| GZF | entfällt | 0,80 | 0,75 | 0,70 | 0,65 | 0,60 | 0,55 | 0,50 | 0,45 |

Standardformel: `4200 W + (n−1) × GZF × 4200 W`. Drei zugeordnete Ladepunkte ergeben rechnerisch 10.500 W; zwei 7.560 W. WP und Klima werden zuerst je Fallgruppe elektrisch zusammengefasst. Nur Einrichtungen/Gruppen mit mehr als 4.200 W Netzanschlussleistung zählen. Bei einer WP-/Klimagruppe über 11.000 W ersetzt `max(0,4 × P_WP; 0,4 × P_Klima)` den 4.200-W-Sockel. Die Zusatzheizung gehört zur elektrischen WP-Anschlussleistung, nicht nochmals zur Teilnehmerzahl.

Quelle: [BNetzA Anlage 1 zu BK6-22-300, Ziffer 4.5.2](https://www.bundesnetzagentur.de/DE/Beschlusskammern/1_GZ/BK6-GZ/2022/BK6-22-300/Beschluss/BK6-22-300_Beschluss_Anlage1.pdf?__blob=publicationFile&v=1). [VDE-FNN-Empfehlung April 2025](https://www.vde.com/resource/blob/2384602/0cb47de901b1129acad8510257ecc582/vde-fnn-hinweis-mindestleistung-data.pdf) bestätigt die bestehenden Faktoren und Formeln. Die Gruppe muss der mit dem Netzbetreiber vereinbarten Zuordnung entsprechen; die Tabelle ersetzt keine Anmeldung.

Nach Speichern zeigt `Control.GridOperatorCalculation_JSON` Quelle, Zahl, Faktor, Sockel, Formel, gezählte/ausgeschlossene Einrichtungen und Ergebnis. Die GZF-Herkunft gelangt auch in den produktiven DecisionRecord. `Control.GridOperatorStatus` zeigt die wirksame Begrenzung; im bisherigen Bruttomodus wird ein zusätzlich begrenzendes LPC-Gesamtbudget direkt übernommen und nicht nochmals hochgerechnet.

### Optionale Gruppen-Netzbilanz und Eigenstrom

`par14aAccountingMode` bleibt nach einem Update auf `legacyGross`: vorhandene Limits, Quellen und Freigaben behalten ihre bisherige konservative Wirkung. Der ausdrücklich gewählte Modus `groupNet` verbindet die Bilanz mit Regler, gemeinsamer Zuteilung und unabhängigen Ausgangsprüfungen. Er gilt für eine deklarierte Binärkontakt-Gruppe. **Sobald LPC-Eingänge konfiguriert sind, ist dieser neue Modus gesperrt**, bis der konkrete Schnittstellenvertrag verifiziert ist; die bisherige LPC-Auswertung im Bruttomodus bleibt erhalten.

| Neue Einstellung | Auslieferung | Erforderlicher Vertrag für `groupNet` |
| --- | --- | --- |
| `par14aGroupId`, `par14aBoundaryId` | leer | Stabile Kennungen der tatsächlich vereinbarten Teilnehmergruppe und vollständigen gemeinsamen AC-Messgrenze. |
| `par14aSiteScope` | `unconfigured` | `whole-site-ac` bestätigt, dass die vorhandenen getrennten Netzbezugs-/Rückspeisequellen den gesamten deklarierten Anschluss in W messen. |
| `par14aParticipants` | leer | `budgetIncluded`: Haken zählt zur lokalen Budgetberechnung (fehlendes Feld = true); alle Zeilen bleiben in Messung und gemeinsamer Begrenzung. Zusätzliche Spalten: `deviceId`, `powerId`, `powerUnit`, `powerScope`. `deviceId` ist leer für rein gemessene Teilnehmer oder exakt `Wallbox0`, `Wallbox1`, `Wallbox2`, `Battery`. AC-Gesamtmessung einschließlich WP-Zusatzverbrauchern ausdrücklich als `total-ac` deklarieren; keine überlappenden Teilzähler. |
| `par14aStorageCoverage`, `par14aStorageMeters` | `unconfigured` / leer | Explizit kein Speicher (`none`) oder vollständige vorzeichenbehaftete AC-Abdeckung (`complete-ac`) mit Datenpunkt, Einheit, `total-ac` und Vorzeichen je Zähler. |
| `par14aAccountingMaxAgeS`, `par14aAccountingMaxSkewMs` | 30 s / 0 ms | Gemeinsame Quellenalter- und Versatzgrenze; höchstens 30 s bzw. 1000 ms. Standard 0 ms verlangt für den Eigenstromzuschlag identische Originalzeitstempel. Bei frischen gültigen, aber zeitversetzten Quellen gilt ausschließlich das gemeinsame Bruttobudget in Höhe des Netzbudgets; die Netz-/Eigenstromzuordnung bleibt unbekannt. |

Eine gesteuerte Wallbox muss ihre bereits konfigurierte kW-Istquelle verwenden. Ein SunEnergy-Mehrkopfspeicher wird über `Battery` und den besonderen Teilnehmer-Leistungswert `@controlled-battery-ac` in W gebunden. Das ist eine interne Ladesumme, kein zusätzlicher ioBroker-Datenpunkt. Die Speicherliste muss dafür jeden ausgewählten Kopf mit vollständiger AC-Quelle `heads.N.grid.GP`, Einheit W und positivem Entladevorzeichen abdecken. DC-Leistung oder ein unvollständiger Adaptergesamtwert sind kein Ersatz.

Nur endliche originale Zahlen mit `ack=true`, `q=0`, gültigem Quellenzeitpunkt und gemeinsam eingehaltenen Alters-/Versatzgrenzen können Eigenstrom belegen. Das Gruppenbudget berücksichtigt offene Wirkungen und Reserven gemeinsam; PV/BHKW/Speicher werden nicht erneut zum NVP addiert. Speicherentladung finanziert keine zusätzliche optionale Lade-/Heizaufnahme. Ungültige oder unbekannte Abdeckung erlaubt keine positive Gruppenfreigabe. Master, Produktionsgates, Hausanschluss-, Phasen-, Geräte- und ACK-Grenzen bleiben zusätzlich erforderlich.

Die konkrete Konfiguration, Bilanzfelder und Grenzen beschreibt [die Integrationsdokumentation zu #166](docs/issue166-runtime-integration.md). Die Auswahl erteilt keine Anlagenfreigabe und installiert oder aktiviert nichts automatisch. Reale Abnahme bei natürlichen Ereignissen bleibt erforderlich.

## Admin: Messwerte

Aktuelle Leistung ist die Echtzeitbasis, Energiezähler sind die Basis für belastbare Energieunterschiede. Gesamt-/Teil-/Phasenmessung nicht verwechseln. SMA-Gesamt- und Phasen-Netzquellen werden derzeit mit einer operativen 30-s-Frist geprüft; Diagnose-Gap-Schwellen ändern diese Frist nicht.

### Erforderliche aktuelle Messwerte

| Feld / technischer Schlüssel | Auslieferung | Zweck und erwartete Eingabe |
| --- | --- | --- |
| PV-Erzeugungsleistung (erforderlich)<br>`pvPowerId` | leer | Aktuelle gesamte PV-Erzeugungsleistung in W, also Summe der passenden Wechselrichter. Kein Energiezähler und kein Einspeisewert. Andere Erzeuger wie BHKW getrennt halten. Die aktuelle Leistung ergänzt die Prognose, ersetzt sie aber nicht. |

### Optionale BHKW-Erzeugung (nur Messung)

| Feld / technischer Schlüssel | Auslieferung | Zweck und erwartete Eingabe |
| --- | --- | --- |
| BHKW vorhanden – nach Außerbetriebnahme deaktivieren<br>`bhkwPresent` | AUS | Kennzeichnet einen tatsächlich vorhandenen zusätzlichen Erzeuger. Nach tatsächlicher Außerbetriebnahme deaktivieren. Erzeugt keine zukünftige BHKW-Prognose und keinen zusätzlichen Stellleistungsbonus. |
| Elektrische BHKW-Erzeugungsleistung (W)<br>`bhkwPowerId` | leer | Aktuelle elektrische BHKW-Erzeugungsleistung in W, positiv für Erzeugung. Separate Diagnose neben PV; bereits im Netzzähler enthaltene Leistung wird nicht noch einmal auf das Netzbudget addiert. |
| Kumulierter elektrischer BHKW-Energiezähler<br>`bhkwEnergyId` | leer | Kumulativer elektrischer Erzeugungszähler des BHKW. Geeignet für Energie aus gültigen Zählerdifferenzen. Kein Tagesleistungswert. Einheit im nächsten Feld passend wählen; Reset/Lücke nicht als Verbrauch oder 0 interpretieren. |
| Energieeinheit der BHKW-Quelle<br>`bhkwEnergyUnit` | kWh | Tatsächliche Einheit des Quellzählers: kWh, Wh oder J. Nur den richtigen Quellmaßstab wählen, keine zusätzliche Umrechnung im vorgeschalteten Skript und danach nochmals im EMS. Auswahl: `kWh` = kWh, `Wh` = Wh, `J` = J. |
| Maximales Alter der BHKW-Leistungsmessung (s)<br>`bhkwPowerMaxAgeS` | 120 | Maximal zulässiges Quellenalter in Sekunden für die jeweilige BHKW-Messung. Leistung muss zeitnah sein, ein kumulativer Zähler kann langsamer kommen. Fehlend/veraltet bleibt unbekannt; die Frist erzeugt keine fehlende Historie. |
| Maximales Alter des BHKW-Zählerstands (s)<br>`bhkwEnergyMaxAgeS` | 86400 | Maximal zulässiges Quellenalter in Sekunden für die jeweilige BHKW-Messung. Leistung muss zeitnah sein, ein kumulativer Zähler kann langsamer kommen. Fehlend/veraltet bleibt unbekannt; die Frist erzeugt keine fehlende Historie. |
| Netzbezugsleistung (erforderlich)<br>`gridImportId` | leer | Aktuelle gesamte Bezugsleistung am Netzanschlusspunkt in W, als nichtnegative getrennte Bezugsgröße. Beispiel einer Adapterstruktur: meter.0.pregard. Kein Bezugsenergiezähler. Zusammen mit Einspeisung ergibt sich Netzleistung = Bezug − Einspeisung. |
| Netzeinspeiseleistung (erforderlich)<br>`gridExportId` | leer | Aktuelle gesamte Einspeiseleistung am selben Netzanschlusspunkt in W, als nichtnegative getrennte Einspeisegröße. Beispiel: meter.0.psurplus. Nicht einen bereits vorzeichenbehafteten Nettoleistungswert unverändert in beide Felder eintragen. |
| Außentemperatur (optional, °C)<br>`outsideTemperatureId` | leer | Aktuelle Außentemperatur in °C. Unterstützt thermische Planung; kein Sollwert. Bei fehlendem/ungültigem Wert arbeitet die Planung mit ihrem konservativen Ersatz, nicht mit einer behaupteten 0 °C-Messung. |

### Optionale Haus- und Unterzähler

| Feld / technischer Schlüssel | Auslieferung | Zweck und erwartete Eingabe |
| --- | --- | --- |
| Zähler Haus 1<br>`house1PowerId` | leer | Optionale aktuelle elektrische Bereichsleistung in W für getrennte Lastprofile und Diagnose. Je Feld den betreffenden Bereich zuordnen, keine kWh-Zähler. Überlappende Zähler nicht als zusätzliche unabhängige Hauslast zählen; der NVP-Zähler bleibt die Bilanzbasis. |
| Zähler Haus 2<br>`house2PowerId` | leer | Optionale aktuelle elektrische Bereichsleistung in W für getrennte Lastprofile und Diagnose. Je Feld den betreffenden Bereich zuordnen, keine kWh-Zähler. Überlappende Zähler nicht als zusätzliche unabhängige Hauslast zählen; der NVP-Zähler bleibt die Bilanzbasis. |
| Zähler Diele<br>`hallPowerId` | leer | Optionale aktuelle elektrische Bereichsleistung in W für getrennte Lastprofile und Diagnose. Je Feld den betreffenden Bereich zuordnen, keine kWh-Zähler. Überlappende Zähler nicht als zusätzliche unabhängige Hauslast zählen; der NVP-Zähler bleibt die Bilanzbasis. |
| Zähler Wohnung<br>`apartmentPowerId` | leer | Optionale aktuelle elektrische Bereichsleistung in W für getrennte Lastprofile und Diagnose. Je Feld den betreffenden Bereich zuordnen, keine kWh-Zähler. Überlappende Zähler nicht als zusätzliche unabhängige Hauslast zählen; der NVP-Zähler bleibt die Bilanzbasis. |
| Optionale zusammengefasste Warmwassertemperatur<br>`dhwTemperatureId` | leer | Optionaler zusammengefasster Warmwasser-Temperaturwert in °C für die allgemeine Datenbasis. Ersetzt nicht automatisch die vier produktiven Speicherfühler im Reiter Warmwasser-Heizstab. |

### Optionale Phasenmesswerte für den Hausanschlussschutz

| Feld / technischer Schlüssel | Auslieferung | Zweck und erwartete Eingabe |
| --- | --- | --- |
| Hausanschlussstrom L1 (A)<br>`dhwHaL1CurrentId` | leer | Gemessener Strom der jeweiligen Netzphase L1/L2/L3 am Hausanschluss in A. Kein Wallboxstrom und keine noch freie Stromreserve. Für richtungsrichtige Schutzbewertung sind getrennte Bezugs-/Einspeiseleistungen besonders hilfreich. |
| Hausanschlussstrom L2 (A)<br>`dhwHaL2CurrentId` | leer | Gemessener Strom der jeweiligen Netzphase L1/L2/L3 am Hausanschluss in A. Kein Wallboxstrom und keine noch freie Stromreserve. Für richtungsrichtige Schutzbewertung sind getrennte Bezugs-/Einspeiseleistungen besonders hilfreich. |
| Hausanschlussstrom L3 (A)<br>`dhwHaL3CurrentId` | leer | Gemessener Strom der jeweiligen Netzphase L1/L2/L3 am Hausanschluss in A. Kein Wallboxstrom und keine noch freie Stromreserve. Für richtungsrichtige Schutzbewertung sind getrennte Bezugs-/Einspeiseleistungen besonders hilfreich. |
| Bezugsleistung L1 (W)<br>`haL1ImportPowerId` | leer | Gemessene Bezugsleistung der jeweiligen Netzphase in W. Zusammen mit deren Einspeisung erlaubt sie die richtungsrichtige Anschlussprüfung. Nicht die Gesamtleistung dreimal eintragen. Frische, ACK und Qualität jeder einzelnen Quelle werden geprüft. |
| Bezugsleistung L2 (W)<br>`haL2ImportPowerId` | leer | Gemessene Bezugsleistung der jeweiligen Netzphase in W. Zusammen mit deren Einspeisung erlaubt sie die richtungsrichtige Anschlussprüfung. Nicht die Gesamtleistung dreimal eintragen. Frische, ACK und Qualität jeder einzelnen Quelle werden geprüft. |
| Bezugsleistung L3 (W)<br>`haL3ImportPowerId` | leer | Gemessene Bezugsleistung der jeweiligen Netzphase in W. Zusammen mit deren Einspeisung erlaubt sie die richtungsrichtige Anschlussprüfung. Nicht die Gesamtleistung dreimal eintragen. Frische, ACK und Qualität jeder einzelnen Quelle werden geprüft. |
| Einspeiseleistung L1 (W)<br>`haL1ExportPowerId` | leer | Gemessene Einspeiseleistung der jeweiligen Netzphase in W. Positive Einspeisegröße, kein negativer Netzbezug. Zur passenden L1/L2/L3-Bezugsquelle am selben Zähler zuordnen. |
| Einspeiseleistung L2 (W)<br>`haL2ExportPowerId` | leer | Gemessene Einspeiseleistung der jeweiligen Netzphase in W. Positive Einspeisegröße, kein negativer Netzbezug. Zur passenden L1/L2/L3-Bezugsquelle am selben Zähler zuordnen. |
| Einspeiseleistung L3 (W)<br>`haL3ExportPowerId` | leer | Gemessene Einspeiseleistung der jeweiligen Netzphase in W. Positive Einspeisegröße, kein negativer Netzbezug. Zur passenden L1/L2/L3-Bezugsquelle am selben Zähler zuordnen. |
| Bisherige verfügbare Hausanschlussleistung (optional)<br>`haFreePowerId` | leer | Optionaler bisheriger Datenpunkt für freie Anschlussleistung in W. Für Migration/Altintegration; ersetzt keine korrekt eingetragene physische Sicherung und phasenweise Messung. |
| Hausanschluss-Kritisch-Signal (optional)<br>`haCriticalId` | leer | Optionales boolesches/numerisches Kritisch-Signal einer vorhandenen Hausanschlussüberwachung. Meldet Schutzbedarf, keine zusätzliche Leistung. Eine aktive Schutzmeldung darf nicht durch Priorität oder Pflichtladen ausgehebelt werden. |

## Admin: Historie und Prognose

Die Historie lernt typische Lastprofile; der Fahrplan beschreibt erwartete künftige Viertelstunden. Längere gewünschte Lernhistorie erzeugt keine fehlenden Daten. Fehlende Wetter-/PV-Intervalle bleiben Lücken. Die PV-Flächen-/Baumzuordnung ist spezifisch: ein beliebiger Forecast-JSON-Wert ist nicht automatisch kompatibel.

### Historienquellen

| Feld / technischer Schlüssel | Auslieferung | Zweck und erwartete Eingabe |
| --- | --- | --- |
| Instanz des Historien-/SQL-Adapters<br>`historyInstance` | leer | Name der vorhandenen Historieninstanz, z. B. sql.0 oder history.0. Hier kommt eine Adapterinstanz hinein, kein Messdatenpunkt. Das EMS liest dort tatsächlich historisierte Quellen; eine Auswahl legt keine fehlende Vergangenheit an. |
| Unveränderte PV-/Wallbox-SQL-Leistung nur alle 10 Minuten wiederholen<br>`sourcePowerHistoryEnabled` | EIN | Beim Start werden ausschließlich bereits aktivierte numerische SQL-Historien der konfigurierten PV-/WB0-/WB1-/WB2-Leistungsquellen auf Änderungen plus 600-s-Wiederholung gestellt. Nullwechsel und kleine Änderungen werden nicht durch Delta-, Block- oder Entprellfilter unterdrückt. Aufbewahrung, Speicherformat und andere Quellen bleiben bestehen. AUS beendet künftige Verwaltung, macht vorhandene Einstellungen aber nicht rückgängig. |
| Rückblick der Historienauswertung<br>`historyDays` | 84 Tage | Gewünschter Rückblick für das Lernen typischer Lastprofile, in Tagen (7–365). Default 84 Tage. Unterscheidet sich von der 24-h-Diagnoseaufbewahrung. Nur tatsächlich vorhandene Historie ist nutzbar. |
| Historisierte Warmwasser-Heizleistung<br>`dhwHistoryId` | leer | Historisierte elektrische Gesamtleistung des Warmwasser-Heizstabs in W, für die Lernbasis. Nicht Speicherfühler, Sollleistung oder kWh-Zähler. Quelle muss in der gewählten Historieninstanz aufgezeichnet sein. |
| Optionale Pumpenquellen für passive Aufzeichnung (JSON)<br>`diagnosticPumpSourcesJson` | `[]` | Optionales JSON-Array mit höchstens 32 vollständigen IDs bestehender Zustände für Pumpenanforderung, Befehl und unabhängige Rückmeldung. Nur lesende Diagnose, keine Pumpensteuerung. Leere Liste ergänzt keine Zuordnung; unbekannte Quellen bestätigen weder Pumpenantwort noch Nachlauf. IDs werden nicht automatisch aus Skript- oder Gerätenamen abgeleitet. |

### Prognosequellen

| Feld / technischer Schlüssel | Auslieferung | Zweck und erwartete Eingabe |
| --- | --- | --- |
| Basisdatenpunkt der stündlichen Wetterprognose<br>`weatherHourlyBaseId` | leer | Basis des unterstützten stündlichen Wetterbaums, nicht einzelner Temperaturwert. Erwartete Unterstruktur: hour0 bis hour47 mit date, temperature_2m und wind_speed_10m, optional cloud_cover. Zeit-/Quellenformat mit dem verwendeten Wetteradapter abgleichen. |
| Basisdatenpunkt der PV-Prognose<br>`pvForecastBaseId` | leer | Basis des unterstützten PV-Prognosebaums. Die konfigurierten PV-Flächen werden unter <Basis>.<Fläche>.hourly-forecast.hour0…hour47 gelesen, mit unix_time_stamp und global_tilted_irradiance. Der hier unterstützte Datenvertrag erwartet letzteren bereits als auf die Fläche umgerechnete W-Leistung; rohe W/m² nicht ungeprüft eintragen. Die Flächennamen müssen zur Engine-Zuordnung passen. |
| Feiertag heute<br>`holidayTodayId` | leer | Boolesches/numerisches Feiertagssignal für genau den genannten Tag. Dient der Zuordnung typischer Tagesprofile. Kein Kalendertext oder Liste mehrerer Termine; optional, wenn keine solche Quelle vorhanden ist. |
| Feiertag morgen<br>`holidayTomorrowId` | leer | Boolesches/numerisches Feiertagssignal für genau den genannten Tag. Dient der Zuordnung typischer Tagesprofile. Kein Kalendertext oder Liste mehrerer Termine; optional, wenn keine solche Quelle vorhanden ist. |
| Feiertag übermorgen<br>`holidayAfterTomorrowId` | leer | Boolesches/numerisches Feiertagssignal für genau den genannten Tag. Dient der Zuordnung typischer Tagesprofile. Kein Kalendertext oder Liste mehrerer Termine; optional, wenn keine solche Quelle vorhanden ist. |

## Admin: Preise und Tarife

Verglichen wird der vollständige Bruttopreis in ct/kWh: Energie plus erforderliche Aufschläge plus Netzentgelt. Preisplanung nutzt 15-min-Intervalle; der Echtzeitregler weiter Sekundenzyklen. Dynamische Preise bedeuten nicht automatisch erlaubte Nachtladung.

### Preise und Tarife

| Feld / technischer Schlüssel | Auslieferung | Zweck und erwartete Eingabe |
| --- | --- | --- |
| Mehrwertsteuer<br>`priceVatPct` | 19 % | Mehrwertsteuersatz in %. Wird dort aufgeschlagen, wo die zugehörige Preisbasis netto eingestellt ist. Bereits brutto eingegebene Preise nicht nochmals versteuern. |
| Preisart der bisherigen Preisbestandteile<br>`priceInputBasis` | gross | Brutto/netto für bisherige Preisbestandteile: festen Energieanteil, festes Netzentgelt, Energieaufschläge und externe Netzentgeltreihe. Börsenreihe und Jahrestarif haben eigene Basisfelder; Gesamtvertragspreis-Modus ist ausdrücklich brutto. Auswahl: `gross` = Brutto (inklusive MwSt.), `net` = Netto (ohne MwSt.). |

### Preisabhängiges Laden

| Feld / technischer Schlüssel | Auslieferung | Zweck und erwartete Eingabe |
| --- | --- | --- |
| Preisfenster für Netzladung<br>`priceChargingHorizonH` | 24 h | Zeitraum in Stunden, in dem günstige Netzladefenster gesucht werden. Keine verbindliche Zeit bis Fahrzeug voll. Ohne Abfahrtsfrist berücksichtigt die Fahrzeugplanung nutzbare PV im 48-h-Horizont; dieses Feld begrenzt die Einkaufsfenster. |
| Mindestdauer eines Preis-Ladeblocks<br>`priceChargingMinBlockMin` | 30 min | Mindestdauer eines zusammenhängenden Preis-Ladeblocks in Minuten, in 15-min-Schritten. Vermeidet unnötiges Wechseln mit jedem Viertelstundenpreis. Keine Wallbox-Mindestlaufzeit; die steht im Wallbox-Reiter. |

### Fester Stromtarif

| Feld / technischer Schlüssel | Auslieferung | Zweck und erwartete Eingabe |
| --- | --- | --- |
| Eingabe des festen Stromtarifs<br>`fixedTariffMode` | components | Wahl der Eingabe: Energieanteil plus Netzentgelt oder kompletter Vertragspreis mit enthaltenem Referenznetzentgelt. Verhindert Doppelzählung des Netzentgelts. Nur die zum gewählten Modus sichtbaren Werte sind die entsprechenden Eingaben. Auswahl: `components` = Energieanteil plus Netzentgelt, `total` = Vertragspreis gesamt mit Referenz-Netzentgelt. |
| Fester Energieanteil (ohne Netzentgelt)<br>`fixedEnergyCt` | 22.85 ct/kWh | Fester Energiepreisanteil ohne Netzentgelt in ct/kWh. Nicht den kompletten Arbeitspreis hier eintragen und anschließend nochmals Netzentgelt addieren. Preisbasis über priceInputBasis. |
| Gesamter Arbeitspreis laut Vertrag (brutto)<br>`fixedTotalPriceCt` | 0 ct/kWh | Kompletter Arbeitspreis des Vertrags in brutto ct/kWh im Gesamtpreis-Modus. 0 bedeutet nicht konfiguriert. Grundpreis ist kein kWh-Arbeitspreis. |
| Im Vertragspreis enthaltenes Netzentgelt (brutto)<br>`referenceGridFeeCt` | 7.19 ct/kWh | Brutto-Netzentgelt, das bereits im angegebenen Vertragspreis enthalten ist. Rechnung: Vertragspreis − Referenznetzentgelt + im jeweiligen Intervall gültiges Netzentgelt. Referenz und dynamischen Tarif nicht doppelt addieren. |
| Festes Netzentgelt (zeitabhängiges Netzentgelt aus)<br>`fixedGridFeeCt` | 6.04 ct/kWh | Konstantes Netzentgelt in ct/kWh, wenn zeitabhängige Netzentgelte deaktiviert sind. Basis über priceInputBasis. Aus tatsächlichem Vertrag/Netzgebiet übernehmen; Softwaredefaults sind keine Tarifauskunft. |

### Dynamische Energiepreise

| Feld / technischer Schlüssel | Auslieferung | Zweck und erwartete Eingabe |
| --- | --- | --- |
| Dynamischen Energiepreis verwenden<br>`dynamicEnergyPrice` | AUS | Schaltet die Verwendung dynamischer Energiepreise ein. Bedeutet noch keine Erlaubnis für Netzladung eines Geräts. Bei aktiviertem dynamischen Bezug müssen passende gültige Zeitintervalle verfügbar sein. |
| Externer Freigabeschalter (optional)<br>`dynamicEnergyPriceEnabledId` | leer | Optionaler externer boolescher/numerischer Schalter zur Auswahl dynamischer Energiepreise bzw. Netzentgelte. Dient etwa einem Webinterface. Leer = Admin-Konfiguration maßgeblich; eine zugeordnete Quelle muss zur erwarteten Schaltersemantik passen. |
| Quelle der Börsenpreise<br>`energyPriceSource` | external | Externe Datenpunktreihe oder integrierter Energy-Charts-Abruf für DE-LU day-ahead. Börsenpreis allein ist nicht der gesamte Haushaltsarbeitspreis; Aufschläge, Steuerbasis und Netzentgelt ergänzen. Auswahl: `external` = Externer Datenpunkt, `energy-charts` = Energy-Charts: DE-LU Day-Ahead. |
| Datenpunkt der externen Energiepreisreihe<br>`energyPriceSeriesId` | leer | Objekt-ID einer externen zeitbezogenen Preisreihe, nicht nur aktueller Preis. Das unterstützte Reihenformat wird unter Preiseingaben beschrieben. Abdeckung der geplanten Intervalle prüfen; fehlende Zukunftspreise nicht als 0 behandeln. |
| Preisart der externen Börsenpreise<br>`energyPriceSeriesBasis` | gross | Eigene Brutto-/Nettobasis der externen Börsenreihe. Passend zum Lieferantenformat wählen, unabhängig vom Basisfeld für andere Preisbestandteile. Auswahl: `gross` = Brutto (inklusive MwSt.), `net` = Netto (ohne MwSt.). |
| Energieaufschläge ohne Netzentgelt<br>`dynamicEnergyAddersCt` | 9.301 ct/kWh | Energiebezogene Aufschläge in ct/kWh bei dynamischem Energiepreis, ohne Netzentgelt. Nur tatsächlich zusätzlich notwendige Bestandteile eingeben; bereits im Quellpreis enthaltene Aufschläge nicht doppelt zählen. |

### Netzentgelte

| Feld / technischer Schlüssel | Auslieferung | Zweck und erwartete Eingabe |
| --- | --- | --- |
| Zeitabhängiges Netzentgelt verwenden<br>`dynamicGridFee` | AUS | Aktiviert zeitabhängiges Netzentgelt. Funktioniert auch bei konstantem Energiepreis, z. B. Modul 3. Dies allein aktiviert weder Batterie- noch Fahrzeug-Netzladung. |
| Externer Netzentgelt-Freigabeschalter (optional)<br>`dynamicGridFeeEnabledId` | leer | Optionaler externer boolescher/numerischer Schalter zur Auswahl dynamischer Energiepreise bzw. Netzentgelte. Dient etwa einem Webinterface. Leer = Admin-Konfiguration maßgeblich; eine zugeordnete Quelle muss zur erwarteten Schaltersemantik passen. |
| Quelle der Netzentgelte<br>`gridFeeSource` | external | Externe Zeitreihe oder Jahrestarif mit Quartals-Zeitfenstern. Im Jahrestarif-Modus gelten die darunter eingegebenen ST/HT/NT-Werte und Regeln. Auswahl: `external` = Externer Datenpunkt, `schedule` = Jahrestarif mit Zeitfenstern. |
| Datenpunkt der externen Netzentgeltreihe<br>`gridFeeSeriesId` | leer | Objekt-ID der externen Netzentgelt-Zeitreihe. Einheit ct/kWh; Brutto-/Nettobasis über priceInputBasis. Kein Leistungsbegrenzungssignal und kein EEBUS-Limit. |

### Jahrestarif Netzentgelte

| Feld / technischer Schlüssel | Auslieferung | Zweck und erwartete Eingabe |
| --- | --- | --- |
| Tarifjahr<br>`gridTariffYear` | 2026 | Jahr, für das die eingetragenen Netzentgelt-Zeitfenster gelten. Zum tatsächlichen Tarifjahr passend halten; nicht annehmen, dass Preise/Zeiten jedes Jahr unverändert bleiben. |
| Preisart des Jahrestarifs<br>`gridTariffBasis` | gross | Brutto-/Nettobasis ausschließlich des eingetragenen Jahrestarifs. Der resultierende Vergleich erfolgt mit brutto ct/kWh. Auswahl: `gross` = Brutto (inklusive MwSt.), `net` = Netto (ohne MwSt.). |
| Standardtarif<br>`gridTariffStandardCt` | 7.19 ct/kWh | Standard-, Hoch- bzw. Niedrigtarif des Netzentgelts in ct/kWh; kein kompletter Strompreis. Vom eigenen Netzbetreiber/Vertrag übernehmen. Defaultbeträge sind Beispiele, keine allgemeingültigen Tarife. |
| Hochtarif<br>`gridTariffHighCt` | 10.01 ct/kWh | Standard-, Hoch- bzw. Niedrigtarif des Netzentgelts in ct/kWh; kein kompletter Strompreis. Vom eigenen Netzbetreiber/Vertrag übernehmen. Defaultbeträge sind Beispiele, keine allgemeingültigen Tarife. |
| Niedrigtarif<br>`gridTariffLowCt` | 0.71 ct/kWh | Standard-, Hoch- bzw. Niedrigtarif des Netzentgelts in ct/kWh; kein kompletter Strompreis. Vom eigenen Netzbetreiber/Vertrag übernehmen. Defaultbeträge sind Beispiele, keine allgemeingültigen Tarife. |
| Tägliche Zeitfenster je Quartal<br>`gridTariffRules` | siehe Zeitfenster | Je Zeile Quartal, Beginn, Ende und ST/HT/NT-Stufe angeben. Uhrzeiten HH:mm im 15-min-Raster, Tagesende bis 24:00. Zeitzone Europe/Berlin. Alle vier Quartale müssen lückenlos und ohne Überlappung abgedeckt sein. Tage im gewählten Quartal verwenden dieselben Tagesfenster; vollständig und widerspruchsfrei eintragen. Details und Beispiele im Abschnitt darunter. |

## Admin: Wallboxen allgemein

Gemeinsame Prioritäts-, Start-/Stopptimer-, Antwort- und Phasenregeln. 600 s sind 10 min. Drei verschiedene Zeiten nicht gleichsetzen: normales Startbudget, Mindestlaufzeit, Ausschaltverzögerung; hinzu kommen Kommunikation und Fahrzeugreaktion.

### Gemeinsame Wallboxregelung

| Feld / technischer Schlüssel | Auslieferung | Zweck und erwartete Eingabe |
| --- | --- | --- |
| Wallboxen parallel laden<br>`wallboxParallelChargingEnabled` | EIN | Erlaubt parallele Ladung berechtigter Fahrzeuge. Unter Mindest-SoC werden einphasige Mindestladungen reserviert, soweit reale gemeinsame Grenzen dies zulassen; Restleistung folgt Priorität. AUS verwendet die sequenzielle Auswahl. Kein Freibrief zum Überschreiten des Anschlussbudgets. |
| Quelle der Priorität<br>`wallboxPrioritySource` | auto | Admin-Auswahl, externer Prioritätsdatenpunkt oder automatische/kompatible Quellenwahl. „Automatisch/kompatibel“ wählt nicht selbst ein beliebiges Webinterface: normalerweise Admin-Wert; der ältere interne Wert −2 bedeutet externe Quelle. Für ein Webinterface ausdrücklich extern wählen und dessen Objekt zuordnen. Auswahl: `auto` = Automatisch / kompatibel, `internal` = Auswahl im Admin, `external` = Externer Datenpunkt. |
| Bevorzugte Wallbox (manuelle Auswahl hat Vorrang)<br>`wallboxPriority` | -1 | Automatisch (−1) oder bevorzugtes Fahrzeug 0/1/2. Im Parallelbetrieb erhält dieses nach den geschützten Mindestbedarfen zuerst Mehrleistung. Reicht das aktuelle Budget nicht für beide Fahrzeuge, kann eine gültige manuelle Auswahl die optionale Ladung des bisherigen Fahrzeugs kontrolliert an das bevorzugte Fahrzeug übergeben; im sequenziellen Betrieb hat das berechtigte bevorzugte Fahrzeug Vorrang. Ziel-SoC, Freigabe und Schutz bleiben wirksam. −2 ist kein Fahrzeug. Auswahl: `-1` = Automatisch, `0` = Wallbox 0, `1` = Wallbox 1, `2` = Wallbox 2. |
| Externer Prioritätsdatenpunkt<br>`wallboxPriorityId` | leer | Vorhandenes numerisches Prioritätsobjekt, z. B. eines eigenen Webinterfaces: 0/1/2 bevorzugen WB0/WB1/WB2, −1 keine manuelle Bevorzugung. Wird bei Quellenwahl extern bzw. dem kompatiblen −2-Fall gelesen. EMS-Anzeigen nicht mit der Eingabequelle verwechseln. |
| Maximale Stromänderung (einzelner Verbraucher)<br>`wallboxMaxStepA` | 6 A | Maximale Stromänderung je Stellschritt in A; zweites Feld gilt bei aktivem Warmwasser-Heizstab. Größer bedeutet gröbere/schnellere Schritte, nicht mehr zulässigen Maximalstrom. Befehl-/Fahrzeugantwort und reale Budgets können den Schritt weiter begrenzen. |
| Maximale Stromänderung bei aktivem Warmwasser-Heizstab<br>`wallboxCombinedMaxStepA` | 1 A | Maximale Stromänderung je Stellschritt in A; zweites Feld gilt bei aktivem Warmwasser-Heizstab. Größer bedeutet gröbere/schnellere Schritte, nicht mehr zulässigen Maximalstrom. Befehl-/Fahrzeugantwort und reale Budgets können den Schritt weiter begrenzen. |
| Zusätzlicher Überschuss vor dem Start<br>`wallboxStartReserveW` | 300 W | Zusätzlicher Überschuss über der elektrischen Mindestleistung vor einem gewöhnlichen PV-Start, in W. Bei 6 A/1P und nominal 230 V: 1380 W + 300 W Reserve = 1680 W. Pflicht-/Preis-/qualifizierte Übergabefälle werden separat bewertet. |
| Dauer des stabilen Überschusses vor dem Start<br>`wallboxStartDelayS` | 30 s | Zeit, während der ein normales Startbudget stabil verfügbar sein muss, in s. Kein pauschaler neuer Countdown für jede Fahrzeugübergabe: qualifizierte Übergabe-/Wiederanlauffälle können ihn umgehen, nicht die AUS-/Schutzprüfung. |
| Mindestlaufzeit<br>`wallboxMinimumRunTimeS` | 120 s | Mindestlaufzeit eines bestätigten Ladeausgangs bei weichem PV-Budgetmangel. Verlängert keine harte Schutzverletzung, Benutzersperre, Ziel-SoC, erledigte Netz-Mindestladung ohne Folgebedarf oder ausdrücklich angeforderte Prioritätsübergabe einer optionalen Ladung. Nicht gleich Fahrzeug-Reaktionsfrist. |
| Ausschaltverzögerung bei zu wenig Überschuss<br>`wallboxStopDelayS` | 120 s | Verzögert einen normalen Stopp bei zu wenig nutzbarem PV-Budget. Nicht wirksam als Aufschub für ungültige sicherheitsrelevante Quellen, harte Grenzen oder eine gültige direkte Prioritätsübergabe einer optionalen Ladung. Timerstatus im jeweiligen Devices.WallboxX-Bereich prüfen. |
| Eine vom EMS gesteuerte aktive Wallbox bei Neustart oder Update weiterbetreiben<br>`wallboxRestartHandoffEnabled` | EIN | Übernimmt nach Neustart/Update einen nachweislich zuvor EMS-eigenen aktiven Ausgang, wenn sichere Rückmeldungen vorliegen. Keine Übernahme beliebiger unbekannter Bestandsbefehle; kein Versprechen unter Host-/Treiberabsturz. |
| Maximale Wartezeit auf frische Reglerdaten nach Neustart<br>`wallboxRestartHandoffTimeoutS` | 900 s | Anlaufbudget 900–3600 s für Neustart und Historienaufbau. Ältere kleinere Werte werden intern mindestens als 900 s behandelt. Rechtzeitig begonnene Stabilisierung bekommt ihre volle Zeit plus Prüftaktreserve; kein unbegrenztes Weiterhalten bei dauerhaft fehlenden Daten. |
| Übernommene Wallbox vor kurzzeitigem Null-Soll schützen<br>`wallboxRestartHandoffGraceS` | 30 s | Kurzer Schutz einer erfolgreich übernommenen Ladung gegen vorübergehendes weiches Null-Soll während der Initialisierung. Harte Schutz- und Rückmeldeprüfungen bleiben wirksam. |
| Erforderliche Dauer stabiler EMS-Daten vor Ende der Neustartübergabe<br>`wallboxRestartHandoffSettleS` | 10 s | Dauer stabiler EMS-Daten, bevor die Neustartübergabe regulär endet. Stabilisierung, nicht zusätzliche Einschaltverzögerung eines neuen Fahrzeugs. |
| Maximales Alter der go-e-Messwerte<br>`wallboxMeasurementMaxAgeS` | 30 s | Maximales Quellenalter der relevanten go-e-Messwerte in s. Nutzt echte Quellenaktualisierung, nicht allein Wertänderung. Eine unveränderte, frisch bestätigte Messung ist frisch; ein alter Cachewert wird durch Lesen nicht automatisch erneuert. |
| Fahrzeug-Reaktionsfrist nach Befehlsbestätigung<br>`wallboxResponseSettleTimeoutS` | 45 s | Frist für die elektrische Fahrzeugreaktion nach bestätigtem Stellbefehl. Trennt Modbus-/Treiber-ACK von tatsächlicher Strom-/Leistungsantwort. Wiederholte Echos dürfen die ursprüngliche Frist nicht beliebig verlängern. |
| Stromtoleranz für die Fahrzeug-Rückmeldung<br>`wallboxResponseCurrentToleranceA` | 1.5 A | Zulässige Stromabweichung in A bei der Beurteilung der Fahrzeugantwort. Kein Zuschlag zur Gerätegrenze und keine Erlaubnis für dauerhafte Überlast. |
| Vorausschau der Phasenempfehlung<br>`phaseSwitchLookAheadMin` | 30 min | Prognose-Vorausschau in Minuten für die Phasenempfehlung. Die produktive Phasenwahl berücksichtigt zusätzlich reale Budgets und Grenzen; Prognose allein darf fehlende reale Leistung nicht ersetzen. |
| Messwertverzögerung vor Wechsel auf 1 Phase<br>`phaseSwitchRealDownDelayS` | 120 s | Dauer eines geeigneten realen Niedrigbudget-Zustands vor der Empfehlung zum Wechsel auf 1P. Verhindert Umschalten wegen jeder kurzen Wolke; Halte-/Rückmeldebedingungen wirken zusätzlich. |
| Messwertverzögerung vor Wechsel auf 3 Phasen<br>`phaseSwitchRealUpDelayS` | 300 s | Dauer ausreichend hohen realen Budgets vor dem Wechsel auf 3P. Nicht identisch mit der Wallbox-Startverzögerung. |
| Mindestzeit zwischen Phasenwechseln<br>`phaseSwitchMinHoldMin` | 30 min | Mindesthaltezeit der Phasenwahl in Minuten zur Vermeidung wiederholter Wechsel. Keine Garantie, dass eine neue Ladung unnötig lange in einer unpassenden Phase starten muss; Startwahl und laufende Umschaltung sind getrennt. |
| Maximale Wartezeit auf externe Phasenbestätigung<br>`wallboxPhaseSwitchTimeoutS` | 180 s | Maximales Warten auf den extern ausgeführten und bestätigten Phasenwechsel. Fehlende Bestätigung bleibt ungeklärt; Frist ist keine künstliche elektrische Bestätigung. |
| Toleranzzeit nach bestätigtem go-e-Phasenwechsel<br>`phaseSwitchTransitionS` | 90 s | Begrenzte Toleranz der erwarteten go-e-Umschaltpause nach bestätigtem Moduswechsel. Auto kann kurz stoppen und wieder anlaufen. Hebt unabhängige Fehler-/Strom-/Schutzprüfungen nicht auf. |

## Admin: Wallbox 0, 1 und 2

Die drei Fahrzeugreiter besitzen dieselben Feldtypen. In den Tabellen steht `wb0…`; im zweiten bzw. dritten Reiter heißen dieselben Felder `wb1…` bzw. `wb2…`. Jeder Reiter muss vollständig auf seine eigene Box zeigen. **WB0 = Mii/e-Up, WB1 = EQV, WB2 = EQE** sind die Bezeichnungen der aktuellen Oberfläche; die tatsächlichen Fahrzeugnamen können geändert werden. Ein Mii bleibt physisch einphasig, auch wenn ein generisches 3P-Feld sichtbar ist.

### Wallbox 0 / Fahrzeug

| Feld / technischer Schlüssel | Auslieferung | Zweck und erwartete Eingabe |
| --- | --- | --- |
| Wallbox 0 vorhanden / in Planung berücksichtigen<br>`wb0Present` | EIN | Kennzeichnet vorhandenes Gerät für Planung und Diagnose. Nicht angeschlossene Fahrzeuge werden trotzdem anhand des Fahrzeugstatus separat erkannt; vorhanden bedeutet nicht ladebereit. |
| Regelfreigabe Wallbox 0<br>`wb0ControlEnabled` | AUS | Gerätespezifische Teilnahme an der Regelung. Für reale Befehle sind zusätzlich Master, Alpha- und Ausgangsfreigabe nötig. |
| Fahrzeugname<br>`wb0Name` | Vehicle 0 | Frei wählbarer Anzeigename des Fahrzeugs. Ändert nicht die Zuordnung WB0/WB1/WB2 zu den jeweiligen Objekt-IDs. |
| SoC-Datenpunkt<br>`wb0SocId` | leer | Aktueller Fahrzeug-Ladezustand in %. Kein Reichweitenwert. Frischer echter SoC ist Grundlage für Mindest-/Zielentscheidungen; ohne SoC gilt der gesonderte Ohne-SoC-/Energievertrag, nicht automatisch 0 %. |

### Optionale SoC-Schätzung aus Ladeenergie (alle drei Fahrzeuge)

Im jeweiligen Fahrzeugreiter kann **„SoC aus gemessener Ladeenergie schätzen“** aktiviert werden. Standard ist **aus**, bestehende Zuordnungen bleiben erhalten. Die Quelle `wbNSocId` muss dann ein **echter Fahrzeug-SoC** sein, kein vorgeschätzter Skriptwert. Insbesondere beim Mii nicht gleichzeitig die bisherige Skriptschätzung als Eingang verwenden.

| Einstellung | Bedeutung |
|---|---|
| `wbNSocEnergyId` | AC-Ladeenergiezähler in **kWh**, beispielsweise `go-e.N.loaded_energy_kwh`. Ein Sitzungszähler oder kumulativer Zähler ist möglich; ein Rücksprung verwirft die Schätzbasis. |
| `wbNCapacityKWh` (vorhandenes Kapazitätsfeld) | **Nutzbare** Akkukapazität des zugeordneten Fahrzeugs. Keine automatische Übernahme aus Fahrzeugnamen oder alten Skripten. |
| `wbNSocEfficiencyPct` | Ladewirkungsgrad, Standard **90 %**, zulässig **50–99 %**. Individuell prüfen; kein automatisches Lernen. |
| `wbNSocMeasurementTimeId` | Optionaler tatsächlicher Messzeitpunkt der Fahrzeugmeldung als **Unix-Millisekunden**, der genau zu dieser SoC-Meldung gehört. Leer: ioBroker-Zeitstempel der SoC-Meldung wird angenommen. Kein beliebiger Adapter-Heartbeat. |

Berechnung: `Basis-SoC + AC-kWh seit Basis × Wirkungsgrad / nutzbare kWh × 100`. Gezählt wird nur Energie ab einem zeitlich zugeordneten Zählerstand, nicht erneut die Energie vor dem Fahrzeugbericht. Mindest-/Ziel-SoC und Abregelung verwenden den wirksamen Wert; der Ausgangstreiber berechnet ihn vor seinen Entscheidungen unabhängig aus den Quellen und der Basis erneut. Die Preisladung behält ihren eigenen echten SoC-/Energienachweis, damit Ladeenergie nicht doppelt abgezogen wird.

Unter `Vehicles.WallboxN` stehen `ReportedSoC_pct`, `EstimatedSoC_pct`, `SocEstimateStatus` und die zusammengehörige persistente `SocEstimateLedger_JSON`. `SoC_pct` bleibt der wirksame Regelwert. Eine ungültige Schätzung liefert `EstimatedSoC_pct = null` und fällt auf einen gültigen gemeldeten SoC zurück; fehlt auch dieser, gelten die bisherigen Ohne-SoC-Schutzregeln. Die Originalquelle wird niemals überschrieben.

Zählerwerte müssen bestätigt, plausibel und höchstens 60 Sekunden alt sein. Eine neue Basis benötigt einen Zählerwert höchstens 60 Sekunden nach dem Messzeitpunkt; bis dahin gilt der gemeldete SoC. Rücksprünge, unplausible Energiesprünge, beobachtetes Abstecken, geänderte Quellen/Parameter oder eine unklare Verbindung über einen Neustart verwerfen die Basis. Nach Reset ist eine neue zugeordnete Fahrzeugmeldung erforderlich. Ein zusammengehöriger persistierter Datensatz ermöglicht Neustarts ohne erneutes Aufaddieren; maximal 256 Zählerbeobachtungen helfen bei verspäteten Meldungen. Fahrzeugmeldung und Schätzbasis bleiben auf zwei Stunden begrenzt. Die Schätzung ersetzt keine Verbrauchsmessung beim Fahren.

**Genauigkeitsgrenze:** Ladeverluste ändern sich mit Leistung und Temperatur. Eine verspätete Cloud-Meldung ohne tatsächlichen Messzeitpunkt lässt sich nicht exakt zurückdatieren; eine neue ganzzahlige Meldung erhält den Nachkommafortschritt, wenn sie zur auf ganze Prozent gerundeten Schätzung zum zugeordneten Messzeitpunkt passt. Beispiel: 35,36 % und Meldung 35 % ergeben weiterhin 35,36 %. Eine abweichende Meldung korrigiert die Basis weiterhin, auch nach unten nach einer Fahrt. Dezimalmeldungen werden nicht durch diese Ganzzahlregel ersetzt. Diese Funktion ist eine Energiebilanz, keine zusätzliche Fahrzeugmessung.

### Eingangsdatenpunkte für Fahrzeug und Wallbox

| Feld / technischer Schlüssel | Auslieferung | Zweck und erwartete Eingabe |
| --- | --- | --- |
| Externer Mindest-SoC<br>`wb0MinSocId` | leer | Numerisches externes Mindest-SoC-Objekt in %, wenn SoC-Grenzen extern gewählt sind. Unter dieser Grenze besteht Ladebedarf auch mit Netzstrom, soweit Freigaben und Schutz passen. |
| Externer Ziel-SoC<br>`wb0TargetSocId` | leer | Numerisches externes Ziel-SoC-Objekt in %. Obere Ladegrenze. Priorität erzwingt kein Laden darüber hinaus; Ziel wird mindestens auf Mindest-SoC begrenzt. |
| Historischer socfrei-Vergleichswert (optional)<br>`wb0ReleaseId` | leer | Nur Vergleichsanzeige, ohne Einfluss auf Ladefreigabe, manuelle Mindestladung oder Fahrplan. Das EMS verwendet dafür ausschließlich seinen gültigen SoC einschließlich optionaler Energie-Fortschreibung sowie die eingestellten Mindest-/Zielwerte. Nach Installation von alpha.126 kann PV_Ueberschuss_SOCmin für den EMS-Betrieb ausgeschaltet werden; Min-/Max-Bedienung und Phasenrückmeldung bleiben separat erforderlich. |
| Ladefreigabe durch Benutzer<br>`wb0UserAllowId` | leer | Benutzerfreigabe, boolesch/numerisch. Sperre verhindert Ladung trotz Priorität oder Mindestbedarf. Nicht mit dem vom EMS geschriebenen go-e-Ausgang verwechseln, sonst wäre eigener AUS-Befehl eine Benutzersperre. |
| Fahrzeug-Verbindungsstatus<br>`wb0CarStateId` | leer | Numerischer go-e-Fahrzeugstatus; im unterstützten Vertrag gelten 2/3/4 als angeschlossen und 1 als kein Fahrzeug. Keine Freigabe oder Fehlerquelle eintragen. Ändert die Berechtigung und den Energie-Ladeblock. |
| Aktuelle Phasenanzahl<br>`wb0PhaseStateId` | leer | Anzahl der Phasen als 1/3 für die Fahrzeug-/Planungsbasis. Nicht die go-e-Moduskodierung 1/2 ungeändert verwenden; bestätigten Modus separat unten zuordnen. |
| Gemessene Ladeleistung<br>`wb0PowerId` | leer | Tatsächlich gemessene go-e-Ladeleistung; der Wallboxvertrag erwartet kW (energy.power), intern Umrechnung in W. Kein Stromsollwert oder kWh-Zähler. Leistungseinbruch allein beweist keinen Freigabeentzug. |
| Gemessener Strom L1<br>`wb0L1CurrentId` | leer | Gemessener Strom des Wallboxkanals L1 in A. Bei einphasiger Ladung Anschlusszuordnung zur Netzphase beachten. |
| Gemessener Strom L2<br>`wb0L2CurrentId` | leer | Gemessener Wallboxstrom L2 in A. Bei 1P kann 0 richtig sein; fehlend/ungültig ist dagegen kein gemessener Nullstrom. |
| Gemessener Strom L3<br>`wb0L3CurrentId` | leer | Gemessener Wallboxstrom L3 in A; zusammen mit L1/L2 dient er der elektrischen Rückmeldung und Phasenplausibilität. |
| Fahrzeug-Akkukapazität<br>`wb0CapacityKWh` | 50 kWh | Fahrzeug-Batteriekapazität in kWh für Energiebedarf aus SoC-Differenzen. Nicht Leistung der Wallbox; tatsächlichen nutzbaren Wert passend wählen. |
| Maximale Ladeleistung<br>`wb0MaxPowerW` | 11000 W | Obere AC-Ladeleistung in W für Planung und Begrenzung. Zusätzlich wirken Stromgrenzen je Phasenzahl, Inbetriebnahmegrenze und aktuelle harte Budgets; der kleinste wirksame Rahmen begrenzt. |
| Dynamischen 1-/3-Phasenbetrieb aktivieren (externes Skript schaltet)<br>`wb0PhaseSwitchEnabled` | AUS | Erlaubt dynamische 1P/3P-Empfehlung. Die physische Umschaltung führt weiterhin ein externes geeignetes Skript/Treiber aus. Bei fest einphasigem Fahrzeug deaktiviert lassen. |
| Phasensteuerung bei aktivierter Umschaltung<br>`wb0PhaseControlMode` | script | script: bestätigte Phasenwahl des unabhängigen Bestandsskripts verwenden; ems: externes Skript folgt stabilisiertem EMS-Ziel. Zwei gleichzeitig entscheidende Phasenschreiber vermeiden. Das Feld installiert kein Skript. Auswahl: `script` = Skript: EMS folgt bestätigten go-e-Phasen, `ems` = EMS-Vorgabe: externes Skript folgt EMS-Phasen. |

### Strom- und Phasengrenzen

| Feld / technischer Schlüssel | Auslieferung | Zweck und erwartete Eingabe |
| --- | --- | --- |
| Mindeststrom einphasig<br>`wb0MinCurrent1pA` | 6 A | Elektrischer Mindestladestrom für 1P in A. Typisch 6 A, aber passend zur Box/Fahrzeugkombination prüfen. Unter Mindeststrom kann kein normaler Ladestart eingeplant werden. |
| Maximalstrom einphasig<br>`wb0MaxCurrent1pA` | 16 A | Zulässiger Maximalstrom bei 1P in A. Fahrzeug, Wallbox, Leitung und Netzanschluss beachten; nicht den 3P-Wert unüberlegt übernehmen. |
| Mindeststrom dreiphasig<br>`wb0MinCurrent3pA` | 6 A | Mindestladestrom je Phase bei 3P in A. Nominal 6 A × 3 × 230 V ≈ 4140 W; deutlich mehr Startbudget als 1P erforderlich. |
| Maximalstrom dreiphasig<br>`wb0MaxCurrent3pA` | 16 A | Maximalstrom je Phase bei 3P in A. Nicht Summenstrom über alle drei Phasen. Fahrzeug kann 3P anders begrenzt sein als 1P. |

### SoC und Ladestrategie

| Feld / technischer Schlüssel | Auslieferung | Zweck und erwartete Eingabe |
| --- | --- | --- |
| Quelle der SoC-Grenzen<br>`wb0SocLimitsSource` | external | external liest externe Mindest-/Ziel-SoC-Objekte; admin verwendet die beiden Prozentfelder darunter. Quelle bewusst wählen, damit eine Änderung an der falschen Stelle nicht wirkungslos bleibt. Auswahl: `external` = Vorhandene zugeordnete Datenpunkte, `admin` = Hier eingetragene Werte. |
| Mindest-SoC: sofort laden<br>`wb0MinSocPct` | 20 % | Mindest-SoC in % bei Admin-Grenzen: darunter besteht unmittelbarer Mindestbedarf. Kein allgemeiner Ziel-SoC für PV-Laden. |
| Ziel-SoC: PV-Laden oberhalb des Mindestwerts<br>`wb0TargetSocPct` | 80 % | Ziel-SoC in % bei Admin-Grenzen: PV-/Preisladung oberhalb Mindest-SoC bis zu dieser Grenze. Erreichtes Ziel beendet die Berechtigung. |
| Netzladen bis zum Ziel vor der Abfahrt erlauben<br>`wb0DeadlineEnabled` | AUS | Erlaubt Netzladung zur Zielerreichung vor einer gültigen Abfahrt. Abfahrtszeit selbst steht im Objekt Vehicles.WallboxX.DepartureTime, nicht als weiteres Admin-Feld. AUS deaktiviert diesen Anlass, aber nicht Mindest-SoC-, manuelle oder Preisladung. |
| Strom nahe dem Ziel-SoC reduzieren<br>`wb0TaperEnabled` | AUS | Reduziert den zulässigen Strom nahe dem Ziel-SoC anhand der zwei folgenden Stufen. Optional; der vom Auto selbst begrenzte Strom bleibt tatsächliche Antwort, nicht automatisch Reglerfehler. |
| Stufe 1: Abstand unter dem Ziel<br>`wb0Taper1DeltaPct` | 5 Prozentpunkte | Abstand in Prozentpunkten unter dem Ziel, ab dem Strombegrenzung Stufe 1 greift. Beispiel Ziel 80 %, Abstand 5 → Nähe ab 75 %. |
| Stufe 1: Maximalstrom je Phase<br>`wb0Taper1MaxA` | 13 A | Maximalstrom je Phase für Stufe 1 in A; ersetzt keine Schutzgrenze und kann den verfügbaren Restüberschuss bewusst ungenutzt lassen. |
| Stufe 2: Abstand unter dem Ziel<br>`wb0Taper2DeltaPct` | 2 Prozentpunkte | Engerer Abstand in Prozentpunkten unter Ziel für Stufe 2. Passend unterhalb des Stufe-1-Abstands wählen. |
| Stufe 2: Maximalstrom je Phase<br>`wb0Taper2MaxA` | 8 A | Maximalstrom je Phase für Stufe 2 in A. Nicht unter physischem Mindeststrom konfigurieren, wenn reguläre Ladung fortgesetzt werden soll. |

### Kommunikationsausfall einer laufenden Wallbox

Ab alpha.127 darf eine im laufenden EMS-Prozess elektrisch bestaetigte, unveraenderte Ladung bei Nichterreichbarkeit der Wallbox oder ausbleibenden Poll-Rueckmeldungen bestehen bleiben. Das EMS zeigt `TELEMETRIE-WARNUNG` mit Quellenalter und reservierter Leistung; einmal pro Ausfall wird gewarnt. Es sendet weder neue Strom-/Freigabebefehle noch Phasenwechsel und erzeugt keinen AUS-Auftrag allein wegen 30/60 Sekunden Wallbox-Messwertalter. Frische SMA-Gesamt-/Phasenwerte, gueltige EMS-/Fahrzeugfreigaben und konservativ eingehaltene Leistungs-/Schutzgrenzen bleiben Voraussetzung. Die bisher bestaetigte beziehungsweise noch moegliche Leistung bleibt voll reserviert, auch wenn der letzte Messwert darunter lag. Alte Quellenzeitstempel und ACK/Qualitaet werden nicht veraendert.

Nach Wiederverbindung geht die Ladung mit frischen Rueckmeldungen in die normale Regelung zurueck. Benutzer-AUS, Zielerreichung, echte Geraetefehler, unbekannte/ueberschrittene Schutzgrenzen oder fehlende SMA-Ueberwachung bleiben Abschaltgruende. Bei einem solchen AUS bleibt die Reserve bis zu bestaetigtem AUS und frischer elektrischer Ruhe bestehen. Ein aktiver oder unklarer groupNet-Vertrag erhaelt keine Ausnahme von seinen eigenstaendigen Messnachweisen. Unbestaetigte Starts, offene Stell-/Phasenwechsel, unbekannte Sitzungen nach Neustart und Schattenmodelle erhalten keine Kommunikationsausnahme. Eine aktivierte SoC-Stromreduzierung allein verhindert den Warnzustand nicht; ihre aktuelle Stromgrenze gilt weiter.

### Preisabhängiges Fahrzeugladen

| Feld / technischer Schlüssel | Auslieferung | Zweck und erwartete Eingabe |
| --- | --- | --- |
| Fahrzeug-Netzladen in ausgewählten günstigen Zeiten erlauben<br>`wb0PriceChargingEnabled` | AUS | Explizite Erlaubnis, passende günstige Netzladefenster für dieses Fahrzeug zu nutzen. Ein gezeichneter Prognosebalken oder dynamisches Netzentgelt allein ist keine solche Erlaubnis. |
| Maximaler Gesamtpreis brutto (0 = keine Grenze)<br>`wb0PriceMaxCt` | 0 ct/kWh | Höchster erlaubter Gesamtarbeitspreis brutto ct/kWh für Preisladung; 0 = keine zusätzliche absolute Preisgrenze. Günstiges ausgewähltes Fenster, Bedarf, Freigaben und Schutz müssen dennoch passen. |
| AC-Ladeenergie je Anstecken bei fehlendem SoC<br>`wb0PriceEnergyKWh` | 0 kWh | Gewünschte gemessene AC-Ladeenergie pro Ansteckvorgang in kWh bei fehlendem SoC. 0 bietet keinen positiven Ersatzenergiebedarf. Session, Leistungsmessung und tatsächliche Energie verbleiben entscheidend. |

### Manueller Mindeststrom und Mindeststrom bei niedrigem SoC

| Feld / technischer Schlüssel | Auslieferung | Zweck und erwartete Eingabe |
| --- | --- | --- |
| Vorhandener Datenpunkt für den manuellen Mindeststrom<br>`wb0ManualMinCurrentId` | javascript.0.ev.amin0 | Vorhandenes numerisches Objekt für manuell gewünschten Mindeststrom in A. 0 = kein zusätzlicher manueller Mindeststrom. Nicht mit go-e-Stellregister verwechseln. Aktiver manueller Bedarf kann Netzbezug erlauben; harte Grenzen bleiben vorrangig. |
| Mindeststromstufen unterhalb des EMS-Mindest-SoC verwenden<br>`wb0LowSocStepsEnabled` | EIN | Aktiviert zusätzliche Mindeststromstufen für den niedrigen SoC/Pflichtladefall. Im parallelen Mindestbetrieb verwendet der EMS geschützte einphasige Mindestreservierungen; alte höhere Booststufen werden nicht zusätzlich als konkurrierende Reservierung gezählt. |
| Niedriger SoC, Stufe 1: bis einschließlich<br>`wb0LowSoc1ThresholdPct` | 30 % | SoC-Schwelle in %, bis einschließlich der zugehörige niedrige-SoC-Strom gilt. Stufen konsistent von höherem zu niedrigerem SoC anordnen; kein Ziel-SoC. |
| Niedriger SoC, Stufe 1: Mindeststrom<br>`wb0LowSoc1MinA` | 10 A | Gewünschter Mindeststrom dieser niedrigen-SoC-Stufe in A. 0 deaktiviert die Stufe; phasenabhängige Maximalströme und harte Budgets bleiben wirksam. |
| Niedriger SoC, Stufe 2: bis einschließlich<br>`wb0LowSoc2ThresholdPct` | 10 % | SoC-Schwelle in %, bis einschließlich der zugehörige niedrige-SoC-Strom gilt. Stufen konsistent von höherem zu niedrigerem SoC anordnen; kein Ziel-SoC. |
| Niedriger SoC, Stufe 2: Mindeststrom<br>`wb0LowSoc2MinA` | 16 A | Gewünschter Mindeststrom dieser niedrigen-SoC-Stufe in A. 0 deaktiviert die Stufe; phasenabhängige Maximalströme und harte Budgets bleiben wirksam. |
| Niedriger SoC, Stufe 3: bis einschließlich<br>`wb0LowSoc3ThresholdPct` | 0 % | SoC-Schwelle in %, bis einschließlich der zugehörige niedrige-SoC-Strom gilt. Stufen konsistent von höherem zu niedrigerem SoC anordnen; kein Ziel-SoC. |
| Niedriger SoC, Stufe 3: Mindeststrom (0 = deaktiviert)<br>`wb0LowSoc3MinA` | 0 A | Gewünschter Mindeststrom dieser niedrigen-SoC-Stufe in A. 0 deaktiviert die Stufe; phasenabhängige Maximalströme und harte Budgets bleiben wirksam. |

### Produktiver Wallboxausgang

| Feld / technischer Schlüssel | Auslieferung | Zweck und erwartete Eingabe |
| --- | --- | --- |
| Wallboxausgang freigeben: konkurrierende Strom-/Freigabeschreiber gestoppt<br>`wb0ProductionArmed` | AUS | Explizite Freigabe dieses realen Wallboxausgangs nach Prüfung von Mapping und exklusiver Reglerzuständigkeit. Keine reine Anzeige; getrennt von „vorhanden“ und Regelfreigabe. |
| Feste Phasen im Produktivbetrieb (Ersatz bei deaktivierter Phasenumschaltung)<br>`wb0ProductionPhases` | 1 | Feste 1P/3P-Ersatzkonfiguration bei deaktivierter dynamischer Umschaltung. Darf tatsächlicher Verdrahtung/Boxstellung nicht widersprechen. Feld schaltet keine Hardware. Auswahl: `1` = 1 Phase, `3` = 3 Phasen. |
| Von Wallbox L1 verwendete Netzphase<br>`wb0SinglePhaseGridPhase` | 1 | Netzphase L1/L2/L3, auf der der Wallboxkanal L1 bei 1P tatsächlich liegt. Wichtig bei gedrehter Phasenbelegung und mehreren einphasigen Fahrzeugen für Hausanschlussschutz. Auswahl: `1` = L1, `2` = L2, `3` = L3. |
| Stromgrenze für die produktive Inbetriebnahme<br>`wb0CommissioningMaxA` | 6 A | Zusätzliche obere Stromgrenze für den begleiteten Produktivtest in A. Default 6 A begrenzt auch bei höherer konfigurierter Fahrzeugleistung; für normalen höheren Teststrom bewusst passend festlegen. |
| Zeitlimit für die Befehlsbestätigung<br>`wb0FeedbackTimeoutS` | 20 s | Frist in s für unabhängige Bestätigung eines Befehls. Schreibtransport oder ack=false-Echo ist noch kein Geräte-ACK; Fahrzeugreaktion wird danach separat geprüft. |
| Beschreibbarer go-e-Strom (amperePV)<br>`wb0AmpereOutputId` | leer | Beschreibbares go-e-Stromvorgaberegister amperePV in A. Echter Stellausgang; nicht das reine Mess-/Rückmelderegister verwenden. Ein konkurrierender Schreiber muss ausgeschaltet sein. |
| Beschreibbare go-e-Freigabe (allow_charging, numerisch 0/1)<br>`wb0AllowOutputId` | leer | Beschreibbares go-e-Freigaberegister allow_charging, numerisch 0/1. Gleiche Quelle liefert echte bestätigte Freigabe; Schreibecho nicht mit ACK verwechseln. |
| Bestätigter go-e-Strom (ampere)<br>`wb0AmpereFeedbackId` | leer | Bestätigter go-e-Stromsollwert ampere in A. Unabhängig von der Vorgabe zur Befehlskontrolle; tatsächliche elektrische Ströme kommen aus den L1–L3-Feldern. |
| go-e-Verbindungsstatus<br>`wb0ConnectionId` | leer | Bestätigter Verbindungsstatus des betreffenden go-e-Treibers, true = verbunden. Kein Fahrzeug-Ansteckstatus. |
| go-e-Fehlercode (0 = OK)<br>`wb0ErrorId` | leer | Numerischer Gerätefehlercode, 0 = OK. Auch ein Wert 0 muss frisch und gültig sein. Gerätestörung, Resetlogik und Messwertalter getrennt untersuchen. |
| Optionaler verfügbarer Strom (leer lassen, wenn go-e keinen Wert liefert)<br>`wb0AvailableCurrentId` | leer | Optionales numerisches verfügbares Stromlimit in A, nur wenn der Treiber es tatsächlich sinnvoll liefert. Sonst leer lassen; kein permanent 0-W- oder falscher Maximalwert als Ersatz. |
| Bestätigter go-e-Phasenmodus (1 = 1P, 2 = 3P)<br>`wb0PhaseModeId` | leer | Bestätigter go-e-Phasenmodus: 1 = einphasig, 2 = dreiphasig. Nicht 3 für dreiphasig eintragen. Numerischer Modus-ACK ist noch kein Beweis neuer elektrischer L1–L3-Antwort. |

### Abweichende Auslieferungswerte der drei Fahrzeugreiter

| Einstellung | WB0 | WB1 | WB2 |
| --- | --- | --- | --- |
| `Name` | Vehicle 0 | Vehicle 1 | Vehicle 2 |
| `ManualMinCurrentId` | javascript.0.ev.amin0 | javascript.0.ev.amin1 | javascript.0.ev.amin2 |
| `LowSoc1ThresholdPct` | 30 | 50 | 50 |
| `LowSoc1MinA` | 10 | 10 | 10 |
| `LowSoc2ThresholdPct` | 10 | 30 | 30 |
| `LowSoc2MinA` | 16 | 16 | 16 |
| `LowSoc3ThresholdPct` | 0 | 10 | 10 |
| `LowSoc3MinA` | 0 | 25 | 25 |

Diese Defaults beschreiben keine allgemeingültigen Mercedes-/Mii-Stromgrenzen. Akkukapazität, Leistungsgrenzen, tatsächliche Netzphase und Inbetriebnahmestrom je Fahrzeug prüfen.

## Admin: Warmwasser-Heizstab

Separater elektrischer Warmwasserheizer, z. B. AC THOR 9s. Bedarf, thermische Schutzkennlinie und reale Leistungsrückmeldung wirken zusammen. Ein echter Heizstab liefert wegen Spannung und Widerstand nicht immer exakt seine Nennleistung. Diese Abweichung ist nicht automatisch ein Fehler; unbestätigte Stellwirkung darf dennoch nicht als freies Budget behandelt werden.

### my-PV Warmwasser

| Feld / technischer Schlüssel | Auslieferung | Zweck und erwartete Eingabe |
| --- | --- | --- |
| Warmwasser-Heizstab vorhanden / in Planung berücksichtigen<br>`dhwPresent` | EIN | Kennzeichnet tatsächlich vorhandene Ressource für Planung/Diagnose. Bedeutet keine reale Regelfreigabe. Noch nicht eingebaute Geräte deaktiviert lassen; deren Nullplanung ist kein bestandener Gerätetest. |
| Regelfreigabe Warmwasser-Heizstab<br>`dhwControlEnabled` | AUS | Gerätespezifische Teilnahme an der Regelung; für reale Ausgangsbefehle sind Master, Ausgangsfreigabe, gültige Quellen und Grenzen zusätzlich nötig. Planung/Anzeige und reale Aktorsteuerung unterscheiden. |

### Gerätedatenpunkte und Rückmeldungen

| Feld / technischer Schlüssel | Auslieferung | Zweck und erwartete Eingabe |
| --- | --- | --- |
| Beschreibbarer Leistungssollwert des Warmwasser-Heizstabs<br>`dhwSetpointId` | leer | Beschreibbarer my-PV-Gesamtleistungssollwert in W, 0 = AUS. Keine Istleistung oder Temperatur. Nur ein Leistungsregler darf darauf schreiben; an das tatsächlich verwendete AC THOR-Treiberregister anbinden. |
| Optionaler bisheriger Istleistungs-Spiegel (für Pumpenskript)<br>`dhwActualMirrorId` | leer | Optionaler bisheriger Istleistungsspiegel für ein vorhandenes Pumpenskript. Wird zur Integration der gemessenen Gesamtleistung verwendet; kein zweiter Leistungsauftrag und keine direkte Pumpen-Schaltquelle. |
| Istleistung AC THOR Ausgang 1<br>`dhwOutput1Id` | leer | Originale elektrische Istleistung des jeweiligen AC THOR-Ausgangs in W. Die drei Quellen dienen der tatsächlichen Stellwirkung und Null-/Reservierungsprüfung. Nicht die Gesamtleistung dreimal eintragen; fehlende Rückmeldung ist keine 0 W-Bestätigung. |
| Istleistung AC THOR Ausgang 2<br>`dhwOutput2Id` | leer | Originale elektrische Istleistung des jeweiligen AC THOR-Ausgangs in W. Die drei Quellen dienen der tatsächlichen Stellwirkung und Null-/Reservierungsprüfung. Nicht die Gesamtleistung dreimal eintragen; fehlende Rückmeldung ist keine 0 W-Bestätigung. |
| Istleistung AC THOR Ausgang 3<br>`dhwOutput3Id` | leer | Originale elektrische Istleistung des jeweiligen AC THOR-Ausgangs in W. Die drei Quellen dienen der tatsächlichen Stellwirkung und Null-/Reservierungsprüfung. Nicht die Gesamtleistung dreimal eintragen; fehlende Rückmeldung ist keine 0 W-Bestätigung. |
| Datenpunkt der Gesamtleistung<br>`dhwPowerId` | leer | Gemessene Warmwasser-Heizstab-Gesamtleistung in W für aktuelle Bilanz/Planung. Soll/Ist dürfen wegen realem Heizwiderstand abweichen; Leistungssollwert bleibt gesondert. |
| Verbindungsdatenpunkt<br>`dhwConnectionId` | leer | Bestätigter Verbindungsstatus des Warmwasser-Leistungstreibers. Verbindung sagt nichts über erreichte Temperatur oder reale Stellwirkung. |
| Temperatur 1 / unten<br>`dhwTemp1Id` | leer | Speicherfühler in °C in Höhenreihenfolge: 1 unten, 4 oben. Alle real zuordnen; Schichtung und oberer Schutz hängen davon ab. Keine Solltemperatur oder vier Kopien eines Fühlers als vier echte Messungen eintragen. |
| Temperatur 2<br>`dhwTemp2Id` | leer | Speicherfühler in °C in Höhenreihenfolge: 1 unten, 4 oben. Alle real zuordnen; Schichtung und oberer Schutz hängen davon ab. Keine Solltemperatur oder vier Kopien eines Fühlers als vier echte Messungen eintragen. |
| Temperatur 3<br>`dhwTemp3Id` | leer | Speicherfühler in °C in Höhenreihenfolge: 1 unten, 4 oben. Alle real zuordnen; Schichtung und oberer Schutz hängen davon ab. Keine Solltemperatur oder vier Kopien eines Fühlers als vier echte Messungen eintragen. |
| Temperatur 4 / oben<br>`dhwTemp4Id` | leer | Speicherfühler in °C in Höhenreihenfolge: 1 unten, 4 oben. Alle real zuordnen; Schichtung und oberer Schutz hängen davon ab. Keine Solltemperatur oder vier Kopien eines Fühlers als vier echte Messungen eintragen. |
| Freigabedatenpunkt<br>`dhwReleaseId` | leer | Vorhandener boolescher/numerischer Warmwasser-Freigabedatenpunkt. Aktiviert den Bedarf nicht allein: Temperatur, Produktionsfreigabe und Budget gelten weiter. |
| Hysteresedatenpunkt<br>`dhwHysteresisId` | leer | Boolescher/numerischer bisheriger Temperatur-Sperrstatus der Warmwasserintegration: true setzt beim Initialisieren die Temperatursperre. Kein Temperaturabstand in K. Die eigenen Fühler-/Stopp-/Wiederaufnahmebedingungen bleiben zusätzlich maßgeblich. |

### Verteilung Wallbox / Warmwasser

| Feld / technischer Schlüssel | Auslieferung | Zweck und erwartete Eingabe |
| --- | --- | --- |
| Vorhandener Datenpunkt des Verteilungsschalters<br>`dhwParallelReleaseId` | javascript.0.ehz.aufteilen | Vorhandener boolescher/numerischer Verteilungsschalter, z. B. aus einem Webinterface. Steuert die Freigabe der gemeinsamen WB-/EHZ-Verteilung; ist nicht die reale AC THOR-Ausgangsleistung. |
| Gemeinsamen Verteiler für Wallbox und Warmwasser verwenden<br>`dhwParallelDistributionEnabled` | EIN | Aktiviert den gemeinsamen Verteiler für Wallbox und Warmwasser. Gemeinsamer Verteiler vermeidet gegeneinander arbeitende NVP-Regler; Betriebsfreigaben bleiben separat. |
| Gemeinsamen Produktivbetrieb von Wallbox und Warmwasser freigeben<br>`combinedProductionArmed` | AUS | Explizite Freigabe für gemeinsamen realen Wallbox-/Warmwasserbetrieb nach Prüfung beider Aktoren und ausgeschalteter konkurrierender Leistungssteller. |
| Warmwasseranteil bei paralleler Verteilung<br>`dhwParallelSharePct` | 50 % | Gewünschter Warmwasseranteil des nutzbaren Verteilungsbudgets in %. 50 ist eine Zielaufteilung, keine Garantie gleicher gemessener Leistungen: Ampere-Raster, Mindeststrom, Pflichtladung, thermischer Bedarf und Gerätegrenzen verändern die reale Verteilung. |
| Einphasige Verteilung EIN oberhalb<br>`dhwParallelStartPower1PW` | 4000 W | Einschaltschwelle der gemeinsamen Verteilung bei 1P bzw. 3P in W. Nicht die allgemeine Mindestleistung eines Wallboxstarts. Warmwasser kann darunter noch nutzbare Rundungsreste erhalten. |
| Einphasige Verteilung AUS unterhalb<br>`dhwParallelStopPower1PW` | 3000 W | Niedrigere Ausschaltschwelle der gemeinsamen Verteilung bei 1P bzw. 3P in W. Abstand zur EIN-Schwelle bildet Hysterese; beendet nicht pauschal jede Wallboxladung. |
| Dreiphasige Verteilung EIN oberhalb<br>`dhwParallelStartPower3PW` | 9000 W | Einschaltschwelle der gemeinsamen Verteilung bei 1P bzw. 3P in W. Nicht die allgemeine Mindestleistung eines Wallboxstarts. Warmwasser kann darunter noch nutzbare Rundungsreste erhalten. |
| Dreiphasige Verteilung AUS unterhalb<br>`dhwParallelStopPower3PW` | 8000 W | Niedrigere Ausschaltschwelle der gemeinsamen Verteilung bei 1P bzw. 3P in W. Abstand zur EIN-Schwelle bildet Hysterese; beendet nicht pauschal jede Wallboxladung. |

### Speicher- und Temperaturregelung

| Feld / technischer Schlüssel | Auslieferung | Zweck und erwartete Eingabe |
| --- | --- | --- |
| AC THOR Ausgangstemperatur<br>`dhwOutletTempId` | leer | Gemessene AC THOR-/Heizstab-Ausgangstemperatur in °C für Leistungskennlinie und Schutz. Nicht mit oberem Speicherfühler verwechseln. |
| Angenommener Warmwasserbedarf pro 24 h (keine Messung)<br>`dhwDailyDemandKWh` | 20 kWh | Angenommener thermischer Warmwasserbedarf pro 24 h in kWh. Bedarfsschätzung für die Prognose, keine gemessene Tagesenergie. Bei fehlender dichter Lernbasis kann dieser Wert verhindern, dass voller aktueller Speicher fälschlich den ganzen Folgetag ohne Bedarf erscheinen lässt. |
| Angenommene Speicherverluste pro 24 h<br>`dhwStandingLossKWhDay` | 2 kWh/d | Geschätzte thermische Speicherverluste in kWh pro Tag; zusätzlich zum Nutzbedarf. Realistisch einstellen, nicht unbegründet als präzise Messung ansehen. |
| Warmwasser-Prognosereserve oberhalb Mindesttemperatur<br>`dhwForecastReserveKWh` | 0.5 kWh | Thermische Prognosereserve oberhalb Mindesttemperatur in kWh. Kleine Sicherheitsenergie für Planung; kein elektrischer Mindestleistungsauftrag. |
| Speichervolumen<br>`dhwVolumeL` | 500 l | Tatsächliches Speicher-/Puffervolumen in Litern. Dient der thermischen Energieabschätzung aus Temperaturdifferenzen; nicht das Warmwasser-Tagesverbrauchsvolumen. |
| Mindesttemperatur<br>`dhwMinTempC` | 48 °C | Untere Temperaturgrenze in °C für die Bedarfsermittlung. Heizen aus dem Netz erfordert zusätzlich den ausdrücklich erlaubten Bedarf-/Preis-/Budgetvertrag; eine Prognose ist kein Stellbefehl. |
| Zieltemperatur<br>`dhwTargetTempC` | 60 °C | Gewünschte Speicher-/Puffertemperatur in °C für Planung/Regelung. Keine Aufhebung der getrennten Sicherheits-Stopp-/Notgrenzen oder eines Kühlverbots. |
| Maximale Leistung<br>`dhwMaxPowerW` | 9000 W | Physikalisch/geräteseitig erlaubte maximale Heizstableistung in W. Tatsächliche Leistung kann wegen Spannung/Heizwiderstand abweichen. Sollwertgrenze und gemessene elektrische Antwort sind verschiedene Größen. |
| Leistungsgrenze für die produktive Inbetriebnahme<br>`dhwCommissioningMaxW` | 1000 W | Zusätzliche obere Warmwasser-Stellgrenze für den begleiteten Test in W. Default 1000 W kann höhere Planung begrenzen; nicht mit 9000-W-Gerätegrenze verwechseln. |
| Wiederaufnahme unterhalb<br>`dhwResumeTempC` | 75.5 °C | Temperatur in °C, unterhalb der die thermisch gestoppte Warmwasser-Regelung wieder freigegeben werden kann. Zusammen mit Stoppwert Hysterese; nicht das Planungsziel. |
| Stopp bei<br>`dhwStopTempC` | 76 °C | Thermische Stoppgrenze in °C. Passend über Wiederaufnahmewert und zur Anlage wählen. Sicherheitsfunktionen des Geräts bleiben unabhängig erforderlich. |
| Notabschaltung bei oberer Temperatur<br>`dhwTopEmergencyC` | 82 °C | Notabschaltgrenze des oberen Speicherfühlers in °C. Schutzgrenze, kein reguläres Warmwasserziel. |
| Maximales Alter unveränderter Speichertemperaturen<br>`dhwTemperatureMaxAgeMin` | 60 min | Maximales Alter unveränderter Speicher-Temperaturquellen in Minuten. Maßgeblich echte ts-Aktualisierung/Bestätigung, nicht nur lc-Wertänderung. Quelle zyklisch senden lassen; nicht bloß einen alten Wert künstlich neu datieren. |
| Kennlinie aktiv oberhalb der Ausgangstemperatur<br>`dhwOutletDeratingC` | 60 °C | Ausgangstemperatur in °C, ab der die temperaturabhängige Leistungskurve berücksichtigt wird. Ausgangssensor und Speicherfühler erfüllen unterschiedliche Aufgaben. |
| Kennlinienpunkt 1: Temperatur<br>`dhwCurve1TempC` | 70 °C | Temperatur des Kennlinienpunkts 1 in °C. Punkte aufsteigend konfigurieren; begrenzen thermisch die zulässige Leistung, nicht den Netzanschluss. |
| Kennlinienpunkt 1: Maximalleistung<br>`dhwCurve70PowerW` | 7500 W | Maximale Leistung in W am Kennlinienpunkt 1; der technische Schlüssel enthält den ursprünglichen Temperaturwert, die Temperatur ist jedoch separat einstellbar. Keine starre Bindung an 70 °C nach Änderung des Punktes. |
| Kennlinienpunkt 2: Temperatur<br>`dhwCurve2TempC` | 71 °C | Temperatur des Kennlinienpunkts 2 in °C. Punkte aufsteigend konfigurieren; begrenzen thermisch die zulässige Leistung, nicht den Netzanschluss. |
| Kennlinienpunkt 2: Maximalleistung<br>`dhwCurve71PowerW` | 6000 W | Maximale Leistung in W am Kennlinienpunkt 2; der technische Schlüssel enthält den ursprünglichen Temperaturwert, die Temperatur ist jedoch separat einstellbar. Keine starre Bindung an 71 °C nach Änderung des Punktes. |
| Kennlinienpunkt 3: Temperatur<br>`dhwCurve3TempC` | 73 °C | Temperatur des Kennlinienpunkts 3 in °C. Punkte aufsteigend konfigurieren; begrenzen thermisch die zulässige Leistung, nicht den Netzanschluss. |
| Kennlinienpunkt 3: Maximalleistung<br>`dhwCurve73PowerW` | 4000 W | Maximale Leistung in W am Kennlinienpunkt 3; der technische Schlüssel enthält den ursprünglichen Temperaturwert, die Temperatur ist jedoch separat einstellbar. Keine starre Bindung an 73 °C nach Änderung des Punktes. |
| Kennlinienpunkt 4: Temperatur<br>`dhwCurve4TempC` | 74 °C | Temperatur des Kennlinienpunkts 4 in °C. Punkte aufsteigend konfigurieren; begrenzen thermisch die zulässige Leistung, nicht den Netzanschluss. |
| Kennlinienpunkt 4: Maximalleistung<br>`dhwCurve74PowerW` | 3000 W | Maximale Leistung in W am Kennlinienpunkt 4; der technische Schlüssel enthält den ursprünglichen Temperaturwert, die Temperatur ist jedoch separat einstellbar. Keine starre Bindung an 74 °C nach Änderung des Punktes. |
| Schutztemperatur am Ausgang<br>`dhwOutletProtectionC` | 76 °C | Schutztemperatur am Ausgang in °C. Oberhalb keine gewöhnliche Leistungserhöhung; unabhängig von gewünschtem Netzsoll. |

### Ausgangsreaktion

| Feld / technischer Schlüssel | Auslieferung | Zweck und erwartete Eingabe |
| --- | --- | --- |
| Maximale Änderung je Zyklus<br>`dhwMaxStepW` | 1000 W | Normaler maximaler Sollwertschritt je Zyklus in W. Die reale Leistung folgt mit Verzögerung; größere Schritte ersetzen keine Rückmeldung. |
| Schnelle Leistungserhöhung bei bestätigter Netzeinspeisung<br>`dhwFastIncreaseMaxStepW` | 3000 W | Zusätzlich erlaubter schneller Aufwärtsschritt in W bei bestätigter Netzeinspeisung und passenden Rückmeldungen. Keine pauschale sofortige Vollleistung. |
| Toleranz für das Einschwingen der Istleistung<br>`dhwSettleToleranceW` | 300 W | Toleranz in W für die Beurteilung einer eingeschwungenen Istantwort. Keine Hausanschlussreserve. Reale stabile Abweichung wird von fehlender/alter Antwort unterschieden; positive Leistungsreservierungen brauchen gültige Nachweise. |
| Maximale Wartezeit auf AC THOR-Rückmeldung<br>`dhwSettleTimeoutS` | 15 s | Maximale Wartezeit in s auf elektrische AC THOR-Antwort nach einer Änderung. Ein Transportabschluss ist noch keine volle Stellwirkung; unbekannte Wirkung bleibt konservativ reserviert. |

## Admin: Heizpuffer

Eigener Aktor mit eigener Messung und Freigabe, getrennt vom Warmwasser. Der manuelle Temperatur-Ersatz ist nur Planung. Kühlstatus und thermische Schutzgrenzen können Heizbetrieb sperren; nicht denselben my-PV-Ausgang für beide Ressourcen zuordnen.

### my-PV Heizpuffer

| Feld / technischer Schlüssel | Auslieferung | Zweck und erwartete Eingabe |
| --- | --- | --- |
| Heizpuffer-Heizstab vorhanden / in Planung berücksichtigen<br>`heatingPresent` | AUS | Kennzeichnet tatsächlich vorhandene Ressource für Planung/Diagnose. Bedeutet keine reale Regelfreigabe. Noch nicht eingebaute Geräte deaktiviert lassen; deren Nullplanung ist kein bestandener Gerätetest. |
| Regelfreigabe Heizpuffer<br>`heatingControlEnabled` | AUS | Gerätespezifische Teilnahme an der Regelung; für reale Ausgangsbefehle sind Master, Ausgangsfreigabe, gültige Quellen und Grenzen zusätzlich nötig. Planung/Anzeige und reale Aktorsteuerung unterscheiden. |
| Heizpufferausgang freigeben: eigener Aktor geprüft, konkurrierender Schreiber gestoppt<br>`heatingProductionArmed` | AUS | Separate bewusste Freigabe des Heizpuffer-Aktors. Eigenen my-PV-Soll-/Istpfad prüfen; nicht dieselben Stellregister wie Warmwasser verwenden. |
| Heizpuffer manuell sperren (immer AUS)<br>`heatingInhibit` | AUS | Manuelle Sperre des Heizpuffer-Heizstabs. Hat Vorrang vor normalem Heizbedarf. Nicht die Wärmepumpe oder gesamten Heizkreis damit gleichsetzen. |
| Beschreibbarer my-PV-Sollwert des Heizpuffers (W, 0 = AUS)<br>`heatingSetpointId` | leer | Eigener beschreibbarer my-PV-Sollwert des Heizpuffers in W, 0 = AUS. Kein Warmwasser-Sollwert, keine reine Anzeige. |
| Verbindung des Heizpufferreglers (bestätigtes true = verbunden)<br>`heatingConnectionId` | leer | Bestätigtes true des Heizpuffer-Treibers. Bei Zuordnung muss die Quelle gültig sein; Verbindung allein bestätigt keine Leistung. |
| Gemessene Heizpuffer-Ausgangsleistung L1 (W)<br>`heatingOutput1Id` | leer | Originale Heizpuffer-Ausgangsleistung der jeweiligen Phase in W. Für positive Stellwirkung und sichere Nullantwort; nicht Warmwasserwerte oder Gesamtleistung mehrfach verwenden. |
| Gemessene Heizpuffer-Ausgangsleistung L2 (W)<br>`heatingOutput2Id` | leer | Originale Heizpuffer-Ausgangsleistung der jeweiligen Phase in W. Für positive Stellwirkung und sichere Nullantwort; nicht Warmwasserwerte oder Gesamtleistung mehrfach verwenden. |
| Gemessene Heizpuffer-Ausgangsleistung L3 (W)<br>`heatingOutput3Id` | leer | Originale Heizpuffer-Ausgangsleistung der jeweiligen Phase in W. Für positive Stellwirkung und sichere Nullantwort; nicht Warmwasserwerte oder Gesamtleistung mehrfach verwenden. |
| Optionale Ausgangstemperatur des Heizpufferreglers (°C; konfigurierte Quelle muss gültig sein)<br>`heatingOutletTempId` | leer | Optionaler echter Ausgangsfühler in °C. Wenn zugeordnet, muss er gültig sein; fehlende konfigurierte Quelle ist kein erlaubter Ersatzwert. |
| Datenpunkt der aktuellen Leistung<br>`heatingPowerId` | leer | Aktuelle Heizpuffer-Gesamtleistung in W, getrennt von Warmwasser. Unterstützt Bilanz und Planung. |
| Historisierter Datenpunkt der Gesamtleistung<br>`heatingHistoryId` | leer | Historisierte Gesamtleistung des Heizpuffer-Heizstabs in W für die Lernbasis. Erfordert tatsächliche Aufzeichnung in der gewählten Historieninstanz. |
| Datenpunkt der Puffertemperatur<br>`heatingTempId` | leer | Aktueller echter Pufferfühler in °C. Für produktive Temperaturprüfung erforderlich; ein manueller Planungswert ersetzt ihn nicht. |
| Puffervolumen<br>`heatingVolumeL` | 400 l | Tatsächliches Speicher-/Puffervolumen in Litern. Dient der thermischen Energieabschätzung aus Temperaturdifferenzen; nicht das Warmwasser-Tagesverbrauchsvolumen. |
| Manueller Temperatur-Ersatzwert nur für Planung; kein produktiver Sensor<br>`heatingTempC` | 40 °C | Manueller Temperatur-Ersatzwert in °C ausschließlich für Planung. Keine Sensorbestätigung und keine produktive Freigabe bei fehlendem Messfühler. |
| Mindesttemperatur<br>`heatingMinTempC` | 35 °C | Untere Temperaturgrenze in °C für die Bedarfsermittlung. Heizen aus dem Netz erfordert zusätzlich den ausdrücklich erlaubten Bedarf-/Preis-/Budgetvertrag; eine Prognose ist kein Stellbefehl. |
| Zieltemperatur<br>`heatingTargetTempC` | 50 °C | Gewünschte Speicher-/Puffertemperatur in °C für Planung/Regelung. Keine Aufhebung der getrennten Sicherheits-Stopp-/Notgrenzen oder eines Kühlverbots. |
| Maximale Heizstableistung<br>`heatingMaxPowerW` | 6000 W | Physikalisch/geräteseitig erlaubte maximale Heizstableistung in W. Tatsächliche Leistung kann wegen Spannung/Heizwiderstand abweichen. Sollwertgrenze und gemessene elektrische Antwort sind verschiedene Größen. |
| Sicherheits-Stopp-Temperatur des Heizpuffers<br>`heatingStopTempC` | 60 °C | Sicherheits-Stoppgrenze der Puffertemperatur in °C. Über dem Ziel sinnvoll anordnen; tatsächliche Anlage/Materialgrenzen beachten. |
| Wiederaufnahme mit Abstand unter Zieltemperatur<br>`heatingResumeDeltaC` | 2 K | Abstand in Kelvin unter Zieltemperatur zur Wiederaufnahme. Beispielsweise Ziel 50 °C und Abstand 2 K → Wiederaufnahme unter 48 °C im betreffenden Regelvertrag. |
| Optionale Notabschaltung am Ausgangssensor<br>`heatingOutletEmergencyC` | 80 °C | Notgrenze des optionalen Ausgangssensors in °C; nur mit tatsächlicher, gültiger Quelle bewertbar. |
| Maximaler Aufwärtsschritt des Sollwerts<br>`heatingMaxStepW` | 1000 W | Maximaler Aufwärtsschritt des Puffersollwerts in W. Schutzreduktionen werden dadurch nicht verzögert. |
| Toleranz für das Einschwingen des Aktors<br>`heatingSettleToleranceW` | 300 W | Toleranz in W für die Beurteilung einer eingeschwungenen Istantwort. Keine Hausanschlussreserve. Reale stabile Abweichung wird von fehlender/alter Antwort unterschieden; positive Leistungsreservierungen brauchen gültige Nachweise. |
| Maximales Alter der Puffer-/Ausgangssensoren<br>`heatingTemperatureMaxAgeS` | 3600 s | Maximales Alter der Puffer-/Ausgangstemperatur in s. Zyklische Quellenaktualisierung sicherstellen, auch bei unverändertem Temperaturwert. |
| Maximales Alter der gemessenen Heizstableistung<br>`heatingOutputMaxAgeS` | 120 s | Maximales Alter der gemessenen elektrischen Ausgangsleistungen in s. Fehlende oder alte Werte sind keine bestätigte AUS-Antwort. |

## Admin: Batteriespeicher

Planung und realen Speichervertrag unterscheiden. Das EMS unterstützt die bisherige Einzelkopf-Zuordnung sowie **einen, zwei oder drei Köpfe über den unveränderten SunEnergy-Standardadapter**. Der SunEnergy-Adapter übernimmt weiterhin Gerätekommunikation und Messwerte; im neuen Modus verteilt das EMS seinen Gesamtauftrag auf die Köpfe. Die Existenz eines beliebigen Batterieadapters reicht nicht. DC-Planungsleistung ist keine AC-Stellbestätigung.

### Hausbatteriespeicher

| Feld / technischer Schlüssel | Auslieferung | Zweck und erwartete Eingabe |
| --- | --- | --- |
| Batteriespeicher vorhanden / in Planung berücksichtigen<br>`batteryPresent` | AUS | Kennzeichnet tatsächlich vorhandene Ressource für Planung/Diagnose. Bedeutet keine reale Regelfreigabe. Noch nicht eingebaute Geräte deaktiviert lassen; deren Nullplanung ist kein bestandener Gerätetest. |
| Regelfreigabe Batteriespeicher<br>`batteryControlEnabled` | AUS | Gerätespezifische Teilnahme an der Regelung; für reale Ausgangsbefehle sind Master, Ausgangsfreigabe, gültige Quellen und Grenzen zusätzlich nötig. Planung/Anzeige und reale Aktorsteuerung unterscheiden. |
| Verteilung des Speicherausgangs<br>`batteryDispatchMode` | `single-head` | `single-head` erhält die bisherige konsistente Einzelkopf-Zuordnung. `sunenergy-heads` steuert 1–3 Köpfe der ausgewählten Standardadapterinstanz; zugehörige Kopfgrenzen erscheinen darunter. Der Moduswechsel aktiviert keine Steuerung. |
| Begleiteten Speicherausgang freigeben: GS-Zuordnung, Vorzeichen, Treibermodi und konkurrierende Schreiber geprüft<br>`batteryProductionArmed` | AUS | Begleitete reale Speicherfreigabe erst nach Prüfung der Kopfzuordnung, GS-Vorzeichen, Treibermodi, Rückmeldungen und konkurrierenden Schreiber. Existierende Planung beweist keine reale Speicherabnahme. |
| Beschreibbarer sunenergyxt500.N.heads.H.control.GS (W: positiv = Entladung / negativ = Ladung)<br>`batterySetpointId` | leer | Beschreibbarer GS-Leistungsauftrag des gewählten sunenergyxt500-Kopfs in W: positiv entladen, negativ laden. Genau einen Kopf konsistent zuordnen; keine Gesamtanzeige als Stellregister. Unterstützter Treibervertrag ist spezifisch, nicht beliebiger Speicher. |
| Erforderliche AC-Leistungsrückmeldung: grid.GP des gewählten Kopfs oder total.gridPower bei einem Kopf (W, positiv = Entladung)<br>`batteryAcPowerId` | leer | Echte AC-Netzleistungsrückmeldung des zugeordneten Kopfs in W: positiv Entladung. grid.GP oder bei nur einem Kopf total.gridPower. Bei mehreren Köpfen nicht Gesamtleistung als Antwort eines einzelnen Auftrags verwenden. |
| Frischer Treiber-Zeitstempel / letzte erfolgreiche Aktualisierung<br>`batteryHeartbeatId` | leer | Frischer Treiber-Zeitstempel der letzten erfolgreichen Aktualisierung. Keine EMS-interne Jetzt-Uhr als vermeintlicher Treiberheartbeat eintragen. |
| Treiber-Verbindungsstatus (bestätigtes true erforderlich)<br>`batteryOnlineId` | leer | Bestätigter Treiber-Verbindungsstatus true. Muss zusammen mit Datenfrische und Betriebsmodus passen. |
| control.MM des gewählten Kopfs (bestätigtes false erforderlich)<br>`batteryManualModeId` | leer | control.MM desselben Kopfs. Unterstützter Vertrag verlangt bestätigt false; keine automatische Modusänderung durch diese Zuordnung. |
| control.LM des gewählten Kopfs (bestätigtes true erforderlich)<br>`batteryLocalModeId` | leer | control.LM desselben Kopfs. Unterstützter Vertrag verlangt bestätigt true. Lesen des Modus ist nicht dessen Aktivierung. |
| Optionaler Treiberfehler (0 / false = kein Fehler)<br>`batteryFaultId` | leer | Optionaler echter Treiber-/Gerätefehler: 0/false = kein Fehler. Zugeordnete Quelle muss gültig sein; fehlende Werte nicht als fehlerfrei umdeuten. |
| Optionale Batterietemperatur (°C; konfigurierte Quelle muss gültig sein)<br>`batteryTemperatureId` | leer | Optionaler Batterietemperaturfühler in °C für die zusätzliche Abschaltgrenze. Bei Konfiguration gültige Quelle erforderlich. |
| SoC-Datenpunkt<br>`batterySocId` | leer | Nur für die bisherige Einzelkopf-Zuordnung: gemessener Speicher-SoC in % für Grenzen und Planung. Im Modus `sunenergy-heads` ausgeblendet; dort wird der SoC automatisch aus zusammengehörigen Kopfantworten übernommen. |
| DC-Batterieleistung für Historie/Planung (BP / total.batteryPower, W; keine GS-Rückmeldung)<br>`batteryPowerId` | leer | Nur für die bisherige Einzelkopf-Zuordnung: DC-Leistung BP/total.batteryPower in W. Im Modus `sunenergy-heads` ausgeblendet; dessen Planung und realer Budgetabgleich verwenden die geprüfte AC-Leistung GP aller ausgewählten Köpfe. DC und AC sind wegen Verlusten und eigenen PV-Eingängen nicht identisch. |
| Bisherige DC-Leistungskonvention (nie für GS-/AC-Rückmeldung verwendet)<br>`batteryPowerSign` | 1 | Vorzeichenkonvention ausschließlich der bisherigen DC-Planungsquelle gemäß angebotener Option; im Modus `sunenergy-heads` ausgeblendet. Beeinflusst niemals die feste GS-/AC-Konvention des realen Ausgangs. Auswahl: `1` = DC-Quelle positiv = Ladung (SunEnergy BP / total.batteryPower), `-1` = DC-Quelle positiv = Entladung. |
| Kapazität<br>`batteryCapacityKWh` | 10 kWh | Manuell bestätigte Gesamtkapazität aller ausgewählten Köpfe in kWh für Energie-/SoC-Planung. Bei automatischer Kapazitätsquelle ausgeblendet und kein stiller Ersatz für fehlende Kopfdaten. Das SoC-Nutzfenster reduziert die nutzbare Energiemenge. |
| Maximale Ladeleistung<br>`batteryMaxChargeW` | 2400 W | Getrennte maximale Gesamt-Lade-/Entladeleistung in W. Im Einzelkopfmodus gilt die Grenze für den gewählten Kopf; im Mehrkopfmodus zusätzlich zu allen Kopfgrenzen für die gesamte ausgewählte Gruppe. |
| Maximale Entladeleistung<br>`batteryMaxDischargeW` | 2400 W | Getrennte maximale Gesamt-Lade-/Entladeleistung in W. Im Einzelkopfmodus gilt die Grenze für den gewählten Kopf; im Mehrkopfmodus zusätzlich zu allen Kopfgrenzen für die gesamte ausgewählte Gruppe. |
| Bisheriger Wirkungsgrad je Richtung<br>`batteryEfficiencyPct` | 92 % | Bisheriger Wirkungsgrad je Richtung in %. Wenn kein eigener Round-Trip-Wert gesetzt ist, wird daraus der Zykluswirkungsgrad abgeleitet (z. B. 92 % × 92 % ≈ 84,6 %). Nicht mit Round-Trip-Prozent verwechseln. |
| Mindest-SoC<br>`batteryMinSocPct` | 15 % | Untere SoC-Grenze in % bei ausgeschalteter Temperaturreserve. Bei aktivierter Temperaturreserve ist dies der sichtbare Ersatzwert, solange noch keine gültige Prognoseauswahl vorliegt. Eine gültige temperaturabhängige Auswahl ersetzt diese operative Untergrenze; zusätzliche Planungsreserven können darüber liegen. |
| Maximaler SoC<br>`batteryMaxSocPct` | 100 % | Harte obere SoC-Grenze in %. Für normale Ladung maßgeblich; separates Netzlade-Maximum kann enger sein. |
| Morgendliches Ziel<br>`batteryMorningTargetPct` | 70 % | Planungsziel-SoC in % für morgens/nachmittags/späte Ladung. Ziele berücksichtigen erwartete PV und verfügbare Ladeleistung; keine garantierte tatsächliche Zielerreichung oder pauschale sofortige Netzladung. |
| Nachmittägliches Ziel<br>`batteryAfternoonTargetPct` | 90 % | Planungsziel-SoC in % für morgens/nachmittags/späte Ladung. Ziele berücksichtigen erwartete PV und verfügbare Ladeleistung; keine garantierte tatsächliche Zielerreichung oder pauschale sofortige Netzladung. |
| Spätes Ziel<br>`batteryLateTargetPct` | 100 % | Planungsziel-SoC in % für morgens/nachmittags/späte Ladung. Ziele berücksichtigen erwartete PV und verfügbare Ladeleistung; keine garantierte tatsächliche Zielerreichung oder pauschale sofortige Netzladung. |
| Reservezeit für die abschließende Ladung<br>`batteryReserveMin` | 45 min | Zeitreserve in Minuten für abschließende Ladung. Unterstützt die vorausschauende zeitliche Planung, nicht Mindest-SoC in Prozent. |
| Prognose-Sicherheitsfaktor<br>`batterySafetyPct` | 80 % | Sicher nutzbarer Anteil des prognostizierten restlichen PV-Überschusses in %. 80 % rechnet vorsichtiger als 100 %; nicht ein pauschaler Wirkungsgrad oder Score. |
| Für Eigenverbrauch entladen<br>`batterySelfConsumption` | EIN | Erlaubt geplante Entladung für Eigenverbrauch innerhalb SoC-/Leistungs-/Schutzgrenzen. Ohne real freigegebenen Ausgang bleibt dies Planung. |

### SunEnergy-Standardadapter mit 1–3 Köpfen

Im Reiter **Batteriespeicher → Verteilung des Speicherausgangs** die Auswahl **SunEnergy-Standardadapter: 1–3 Köpfe mit SoC-Ausgleich** wählen. Die bisherige Einzelkopf-Zuordnung bleibt der Auslieferungswert, damit ein Update keine bestehende Anlage automatisch auf mehrere Köpfe umstellt. Die Konfiguration muss den **vollständigen** aktiven Kopfbestand derselben SunEnergy-Instanz beschreiben: bei einem Kopf `heads.1`, bei zwei Köpfen `heads.1` und `heads.2`, bei drei Köpfen alle drei. Zusätzliche im Treiber konfigurierte, hier ausgelassene Köpfe sind nicht zulässig.

| Feld / technischer Schlüssel | Auslieferung | Zweck und erwartete Eingabe |
| --- | --- | --- |
| SunEnergy-Adapterinstanz (ohne heads-Endung)<br>`batterySunEnergyInstance` | `sunenergyxt500.0` | Genau die Instanz des installierten Standardadapters, ohne `.heads.N` oder Objektendung. Das EMS leitet Kopfobjekte daraus ab. |
| Anzahl der konfigurierten SunEnergy-Köpfe<br>`batteryHeadCount` | 1 | Ganzzahl 1, 2 oder 3; muss zu den tatsächlich im Standardadapter konfigurierten Köpfen passen. Keine Schätzung anhand vorhandener alter States. |
| Quelle der Speicherkapazität<br>`batteryCapacitySource` | `manual` | `manual`: bestätigte Gesamtkapazität selbst eintragen. `sunenergy-packs`: Gesamtkapazität aus der Summe der gültigen ON-Werte aller ausgewählten Köpfe und der ausdrücklich angegebenen Packgröße ableiten. Die Auswahl erscheint nur im Modus `sunenergy-heads`. Sie aktiviert keine Steuerung. |
| Bestätigte Kapazität je gleich großem Batteriepack<br>`batteryPackCapacityKWh` | 0 kWh = unbekannt | Nur bei `sunenergy-packs`: positiven kWh-Wert aus der Packdokumentation eintragen. Gleiche Packgröße für alle ausgewählten Köpfe erforderlich. Bei verschiedenen Packgrößen die Gesamtkapazität manuell bestätigen. Es wird keine Standard-Packgröße angenommen. |
| Kopf N: maximale Ladeleistung<br>`batteryHeadNMaxChargeW` | je 2400 W | Individuelle obere Ladegrenze für N = 1, 2 oder 3. Das EMS begrenzt zusätzlich auf die tatsächlich gemeldeten Modell-/Gerätegrenzen und das gemeinsame Gesamtbudget. 0 sperrt diese Richtung für den Kopf. |
| Kopf N: maximale Entladeleistung<br>`batteryHeadNMaxDischargeW` | je 800 W | Individuelle obere Entladegrenze. Die konservative Auslieferung ist keine Aussage über eine Zulassung oder die mögliche Nennleistung des konkreten Geräts. Nur passend zum realen Aufbau einstellen. |

Die Felder `batteryMaxChargeW` und `batteryMaxDischargeW` bleiben **Gesamtgrenzen**, keine Werte je Kopf. Beispiel: Zwei Köpfe mit jeweils 2400 W Ladegrenze ergeben erst dann einen Auftrag bis 4800 W, wenn auch die Gesamt-Ladegrenze mindestens 4800 W beträgt und das reale Budget sowie beide Geräte dies erlauben. Für die Kapazität entweder den bestätigten Gesamtwert in `batteryCapacityKWh` eintragen oder ausdrücklich `sunenergy-packs` mit einer bestätigten Packgröße wählen. Die automatische Datenübernahme erhöht keine selbst eingestellte Gesamt- oder Kopfgrenze.

Der SunEnergy-Standardadapter benötigt **Steuermodus Aus**, damit sein eigener Regler und seine Geräte-Eigenregelung nicht gleichzeitig mit dem EMS schreiben. „Aus“ bedeutet hier: kein eigener automatischer Regler; bewusste Schreibbefehle auf `control.*` werden im Standardadapter weiterhin an das Gerät weitergegeben. Jeder ausgewählte Kopf muss **LM=1** (lokaler Modus) und **MM=0** bestätigen. Das EMS stellt diese Modi nicht eigenständig um. Der Quell-State Netzleistung des SunEnergy-Reglers wird für diese Anbindung nicht verwendet; es wird kein künstlicher NVP-/Delta-Wert erzeugt. Ein Fork oder ein zusätzlicher SunEnergy-Adapter ist nicht erforderlich.

| Objekt je ausgewähltem Kopf N | Verwendung und Vorzeichen |
| --- | --- |
| `sunenergyxt500.0.heads.N.control.GS` | Direkter individueller Sollwert in W, Schreibbefehl mit `ack=false`: **negativ laden, positiv entladen**. Kein Gesamtleistungsobjekt beschreiben. |
| `sunenergyxt500.0.heads.N.info.rawResponse` | Zusammengehörige Rückmeldung mit echten Daten des letzten erfolgreichen Kopfabrufs. Daraus werden SoC, AC-Leistung, Modus, Paketanzahl und Gerätegrenzen geprüft; ein frischer Aggregatwert ersetzt keinen fehlenden Kopf. |
| `sunenergyxt500.0.heads.N.info.online` | Jeder ausgewählte Kopf muss bestätigt erreichbar sein. Frühere oder fehlende Verbindungswerte sind kein aktueller Verbindungsnachweis. |
| `sunenergyxt500.0.heads.N.grid.GP` | Tatsächliche AC-Kopfleistung: **negativ laden, positiv entladen**. GS-Bestätigung und reale GP-Antwort getrennt betrachten. Intern rechnet das EMS Ladung positiv. |
| `sunenergyxt500.0.total.soc` | Nur bei der bisherigen Einzelkopf-Zuordnung mögliche SoC-Quelle. Im Modus `sunenergy-heads` wird kein Aggregatwert als Ersatz für fehlende Kopfantworten verwendet. |
| `sunenergyxt500.0.total.batteryPower` | Nur bei der bisherigen Einzelkopf-Zuordnung mögliche DC-Leistungsquelle für Historie/Planung. DC-Leistung ist wegen eigener PV-Eingänge und Verlusten nicht die AC-Netzantwort. |

### Automatische Gerätedaten und weiterhin eigene Vorgaben

Im Modus `sunenergy-heads` liest das EMS die Gerätedaten direkt aus frischen, bestätigten `heads.N.info.rawResponse`-Antworten aller ausgewählten Köpfe. Die eigene Instanz und Kopfanzahl müssen weiterhin eindeutig gewählt werden. Zusätzliche SoC-/Leistungszuordnungen sind in diesem Modus nicht nötig. Die Quellzeitstempel bleiben erhalten; eine aktuelle Summe oder ein Treiberheartbeat ersetzt keine fehlende Antwort eines Kopfs.

| Wert | Herkunft und Verwendung | Eigene Eingabe nötig? |
| --- | --- | --- |
| Kopf-SoC, gewichteter Gruppen-SoC | SC je Kopf; Gewichtung über gültige ON-Online-Packanzahl. Gemeinsame Grundlage für Planung und Regelung. | Nein. |
| Tatsächliche Speicherleistung | GP je Kopf; Summe mit EMS-Vorzeichen positiv = Laden. AC-Leistung wird für Netzbudget und Planung verwendet; BP ist DC-Telemetrie. | Nein. |
| Relative Kapazität / SoC-Ausgleich | ON je Kopf. ON zählt **online verfügbare** Packs und ist weder ein Verbindungsflag noch die nominal installierte Kapazität in kWh. | Nein. |
| Gesamtkapazität in kWh | Wahlweise bestätigter manueller Wert oder Summe ON × ausdrücklich bestätigte gleich große Packkapazität. | Manuelle Gesamtkapazität **oder** Packgröße; kein automatisch angenommener kWh-Wert. |
| Geräte-SoC-Grenzen und Wiederanlaufhysterese | SI/SA sowie verfügbare Wiederanlaufgrenzen aus den Kopfantworten. Sie begrenzen die Regelung zusätzlich zu den EMS-Zielen. | Nein; EMS-Reserve und Ziele bleiben eigene Vorgaben. |
| Modell-/Geräteleistungsgrenzen | Modell sowie MG/IS und verfügbare Lastportleistung; keine Gleichsetzung von Entladegrenze und Ladegrenze. | Keine erneute Gerätezuordnung; selbst gesetzte Gesamt-/Kopfgrenzen bleiben zusätzliche Obergrenzen. |
| Online-/Lokal-/Manuellstatus und Rückmeldung | Unabhängig geprüfte Onlinequelle sowie MM/LM und GS/GP je Kopf. | Keine zusätzliche Objektzuordnung; tatsächliche Modi im Standardadapter prüfen. |
| EMS-Ziele, Mindestreserve, Netzladeerlaubnis, Freigaben | Eigene EMS-Strategie. Diese Werte werden nicht aus Geräteanzeigen überschrieben. | Ja, passend zur gewünschten Strategie. |
| Wirkungsgrad, optionale Batterietemperatur, dynamische BMS-Ladeleistung | Der geprüfte SunEnergy-Standardadapter 0.3.4 stellt hierfür keine vollständigen eigenständigen Messquellen bereit. | Wirkungsgrad bestätigen, ggf. echten Temperaturfühler zuordnen; keine erfundene dynamische BMS-Grenze. |

**Kapazitätsqualität:** In `sunenergy-packs` gilt nur eine positive ausdrücklich bestätigte Packgröße mit gültigen ON-Werten aller ausgewählten Köpfe. Da ON die Online-Packs zählt, kann diese abgeleitete Kapazität bei ausfallenden Packs kleiner als die installierte Nennkapazität sein. Fehlen Kopfdaten oder die Packgröße, bleibt die automatische Kapazität unbekannt; die versteckte manuelle Kapazität wird nicht als Ersatz verwendet. Eine unvollständige Datenbasis darf weder einen fiktiven SoC noch eine gültige Speicherprognose erzeugen. Die Option `manual` erhält die bisherige ausdrücklich bestätigte Gesamtkapazität.

Die Prüfung ist sichtbar unter `Devices.Battery.Profile.*`: `Valid`/`Status`, `SoC_pct`, `ActualPower_W`, `OnlinePacks`, `Capacity_kWh`/`CapacityValid`, `MaxCharge_W`/`MaxDischarge_W`, `DeviceMinSoC_pct`/`DeviceMaxSoC_pct` und `SourceAt`/`OldestSourceAt`. `Plan.BatteryForecastValid` und `Plan.BatteryForecastStatus` unterscheiden eine belastbare Speicherprognose von einer fehlenden Datenbasis. Diese Anzeigen sind Diagnosen; sie erteilen keine Ausgangsfreigabe und überschreiben keine externen SunEnergy-Einstellungen. Gerätegrenzen und zusätzliche EMS-Grenzen sind von einer gemessenen dynamischen BMS-Leistungsfähigkeit zu unterscheiden.

**SoC-Ausgleich:** Beim Laden bevorzugt die Verteilung den niedrigeren, beim Entladen den höheren Kopf-SoC. Die gemeldete **ON-Paketanzahl** gewichtet die relative Kapazität; ON ist kein Verbindungsstatus. Damit sollen sich die Kopf-SoCs annähern, statt bei gleicher Wattverteilung dauerhaft auseinanderzulaufen. Kopfgrenzen, individuelle SoC-Grenzen und das gemeinsame Budget gelten weiter. Alle Kopfsollwerte haben dieselbe Richtung; das EMS lädt keinen Kopf durch gleichzeitige Entladung eines anderen. Exakt gleiche SoCs sind bei unterschiedlichen Kapazitäten, Lasten, Verfügbarkeit oder begrenzter Leistung nicht garantiert.

Der optionale zugeordnete Treiberfehler `batteryFaultId` bleibt als **gemeinsame zusätzliche Fehlerprüfung** auch im Mehrkopfmodus verwendbar und im Admin sichtbar. Wird er gesetzt, muss die Quelle gültig sein und 0 beziehungsweise false bestätigen; dies ersetzt weder die Prüfung aller Kopfantworten noch den Verbindungsstatus. Ein vorhandener optionaler Batterietemperaturfühler bleibt ebenfalls wirksam.

Bei fehlenden, alten, NULL-, unbestätigten oder qualitativ ungültigen Daten eines ausgewählten Kopfs wird kein vollständiger Gruppenbetrieb behauptet. Unbestätigte Leistung bleibt im gemeinsamen Budget reserviert; ein Summenwert von 0 W beweist nicht, dass jeder Kopf elektrisch ruhig ist. Die begleiteten Freigaben, Quellfristen, Rückmeldeprüfung und Gesamtgrenzen gelten auch für einen einzelnen Kopf im neuen Modus. Ein Update installiert oder aktiviert keinen Speicher und ändert keine SunEnergy-Konfiguration. Direkte GS-Befehle bieten weiterhin **keine garantierte abschließende Abschaltung nach einem Hostabsturz**; ein unbeaufsichtigter Betrieb benötigt unabhängigen geräteseitigen Schutz.

### Temperaturabhängige Mindestreserve

Ab alpha.68 kann der **operative Mindest-SoC** anhand einer zugeordneten Temperaturprognose gewählt werden. Die Funktion ist bei Auslieferung **AUS**. Sie ist eine einfache einstellbare Reservepolitik; sie berechnet weder den tatsächlichen Wärmeverbrauch noch einen garantierten Energiebedarf. Die Temperatur des Wetters und der getrennte Batterietemperaturfühler für Geräteschutz haben unterschiedliche Aufgaben.

| Feld / technischer Schlüssel | Auslieferung | Zweck und erwartete Eingabe |
| --- | --- | --- |
| Temperaturabhängigen Mindest-SoC verwenden<br>`batteryTemperatureMinSocEnabled` | AUS | Aktiviert die folgende Dreistufenauswahl statt des statischen operativen Mindest-SoC. Aktiviert keine Speichersteuerung oder Netzladung. |
| Temperaturprognose für die Mindestreserve<br>`batteryTemperatureForecastId` | leer | Bestätigter numerischer Prognosewert in °C, dessen Qualitätskennzeichen und echten Quellenzeitstempel das EMS prüft. Kein Batterietemperaturfühler, JSON-Prognosebaum oder vom EMS neu datierter Altwert. |
| Maximales Alter der Temperaturprognose<br>`batteryTemperatureForecastMaxAgeH` | 24 h | Zulässiges Alter der Quelle in Stunden; im Admin 1–48 h. Die täglich verwendete Auswahl darf nicht durch künstliche Zeitstempel frisch erscheinen. |
| Untere Temperaturschwelle<br>`batteryTemperatureLowerThresholdC` | 0 °C | Unterhalb dieser Schwelle gilt die kalte Stufe. Die Schwellen sind im Admin zwischen −50 und +50 °C einstellbar; die untere muss kleiner als die obere sein. |
| Mindest-SoC unterhalb der unteren Schwelle<br>`batteryTemperatureColdMinSocPct` | 30 % | Operativer Mindest-SoC für die kalte Stufe, 0–100 %. Keine neue obere Ladegrenze. |
| Obere Temperaturschwelle<br>`batteryTemperatureUpperThresholdC` | 5 °C | Oberhalb dieser Schwelle gilt die warme Stufe. Zwischen den Schwellen einschließlich ihrer Grenzwerte gilt die mittlere Stufe. |
| Mindest-SoC zwischen den Schwellen<br>`batteryTemperatureCoolMinSocPct` | 20 % | Operativer Mindest-SoC für die mittlere Stufe, 0–100 %. |
| Mindest-SoC oberhalb der oberen Schwelle<br>`batteryTemperatureWarmMinSocPct` | 10 % | Operativer Mindest-SoC für die warme Stufe, 0–100 %. |

Mit den Standardwerten gilt **unter 0 °C → 30 %**, **0 bis einschließlich 5 °C → 20 %**, **über 5 °C → 10 %**. Diese Prozentwerte und beide Schwellen sind frei konfigurierbar. Der maximale SoC und die vorhandenen Morgen-/Nachmittags-/Spätziele werden nicht verändert; die bestehenden Ziele werden weiterhin innerhalb des gültigen SoC-Fensters geplant. Die späte Abschlussladung bleibt bestehen.

Die drei SoC-Werte müssen nicht absteigend angeordnet sein; ihre gewünschte Bedeutung bewusst festlegen. Der bestehende produktive Speichervertrag verlangt für eine normale Entladung eine positive wirksame Reserve: **Ein Mindestwert von 0 % ist keine Erlaubnis zur Entladung bis 0 %, sondern lässt die normale Live-Entladung gesperrt.**

Eine neue Auswahlperiode beginnt täglich um **20:00 Uhr Europe/Berlin**, unabhängig von der Zeitzone des Hosts und unter Berücksichtigung der Sommer-/Winterzeit. Je Periode und unverändertem Auswahlvertrag gibt es höchstens eine erfolgreiche Auswahl. Bei erster Aktivierung oder einem Start ohne passenden gültigen Auswahlbeleg wird die aktuelle gültige Quelle verwendet. Ein Neustart mit einem geprüften Auswahlbeleg der laufenden Periode behält diese Auswahl stabil bei; spätere Forecaständerungen derselben Periode ersetzen sie nicht laufend.

Ist am Beginn einer Periode keine gültige Quelle verfügbar, bleibt die vorige Reserve gehalten bzw. der statische Ersatz wirksam. Eine später erstmals gültige Quelle kann die Auswahl für diese Periode nachholen; dokumentiert wird der **tatsächliche spätere Auswahlzeitpunkt**. Ausgelassene Termine während eines Adapterstillstands und verspätete Auswahlen werden nicht rückwirkend als erfolgreiche 20:00-Uhr-Auswertungen behauptet. Die Auswahl verwendet ausschließlich die beim tatsächlichen Auswählen verfügbare Quelle. Eine Änderung der zugeordneten Quelle oder Auswahlparameter wird als neuer Auswahlvertrag erneut geprüft.

Die Quelle bestimmt den Prognosehorizont. Bei einem Wetteradapter bezeichnet `day0` üblicherweise den aktuellen Tag und `day1` den Folgetag: Für eine Auswahl am Abend mit Blick auf die kommende Nacht ist **eine dafür passende Folgetags-Minimumprognose** sinnvoll. Das konkrete Zeitintervall im verwendeten Wetteradapter kontrollieren, besonders über Mitternacht. Das EMS liest den zugeordneten Wert und verschiebt dessen Wetterhorizont nicht selbst.

Fehlt eine gültige Quelle, bleibt die bisher gültig ausgewählte Reserve ausdrücklich als **gehaltene Auswahl** bestehen. Solange es noch keine solche Auswahl gibt, gilt der statische Mindest-SoC als klar ausgewiesener Ersatz. Fehlend, NULL, unbestätigt, qualitativ ungültig oder veraltet ist keine 0-°C-Prognose. Jede Temperaturstufe muss kleiner als der konfigurierte maximale SoC sein. Ist eine Stufe gleich dem Maximum oder größer, oder sind die Einstellungen anderweitig ungültig, bleiben Batterieplanung und produktiver Speicherausgang gesperrt. Die Planung anderer Geräte wird dadurch nicht pauschal abgeschaltet. Das EMS erhöht das Maximum nicht stillschweigend.

Die wirksame Untergrenze gilt gleich für Fahrplan und Live-Entladung. Eine höhere Reserve erlaubt keine automatische Netzladung und setzt einen tatsächlich niedrigeren Speicher-SoC nicht rechnerisch auf den Mindestwert hoch. Die vorhandene Preis-Netzladefreigabe, Gerätefreigaben und Schutzgrenzen bleiben erforderlich. Dieses Feature schreibt **kein zusätzliches `control.SI`-Register** beim Speicheradapter; konkurrierende Skriptschreiber sind vor einer realen Freigabe weiterhin zu prüfen.

Unter `Devices.Battery` und im Speicher-Reiter anzeigen:

| Diagnose | Bedeutung |
| --- | --- |
| `EffectiveMinimumSoC_pct` | Tatsächlich für Planung und Entladung verwendete Untergrenze in %. |
| `TemperatureReserveStatus` | Herkunft der Reserve, Ersatz-/Haltezustand oder konkreter ungültiger Zustand. |
| `TemperatureReserveValid` | Gültige gewählte Reservepolitik, auch beim Halten einer früheren Auswahl. Bei ausgeschalteter Funktion oder reinem statischem Ersatz false; dies allein belegt keine allgemeine Speicherstörung. |
| `TemperatureReserveHeld` | Die vorige gültige Prognoseauswahl wird gehalten; dies bestätigt keine neue frische Quelle. |
| `TemperatureForecast_C` | Aktuell gelesener Prognosewert; unbekannt bleibt unbekannt. Bei gehaltenem Minimum ist dies keine neue Auswahlbestätigung. |
| `TemperatureForecastAge_h` | Alter der aktuell gelesenen Prognosequelle in Stunden; von einem neuen EMS-Regeltakt nicht erneuert. |
| `TemperatureReserveLastSelectionAt` | Zeitpunkt der letzten gültigen Auswahl in Epoch-Millisekunden; 0 bei fehlender Auswahl. Beim Halten bleibt der ursprüngliche Zeitpunkt erhalten. |
| `TemperatureReservePeriod` | Zuordnung der gültigen Auswahl zum täglichen Auswahltermin; beim Halten bleibt die ursprüngliche Zuordnung erhalten. |
| `TemperatureReserveSelection_JSON` | Zusammengehöriger Auswahlbeleg für die Reservepolitik; keine tatsächliche Speicher-Lade-/Entlademessung. |

Die produktiven Diagnoseaufzeichnungen führen wirksames und statisches Minimum, die Auswahl mit ihrem echten Zeitpunkt sowie die Prognose-Originalquelle samt ACK/q und Quellenzeit mit. Für einen SQL-Nachweis zusammengehörige Records verwenden; aktuelle Admin-Anzeigen ersetzen keine fehlende Historie.

Dies ist eine temperaturgestufte Mindestreserve. Eine umfassende Bedarfsplanung aus Hausverbrauch, zukünftigem WP-Verbrauch, PV-Prognosefehlern und Ladegelegenheiten ist damit nicht vollständig umgesetzt oder real abgenommen.

### Preisabhängiges Speicherladen

| Feld / technischer Schlüssel | Auslieferung | Zweck und erwartete Eingabe |
| --- | --- | --- |
| Speicher-Netzladen in ausgewählten günstigen Zeiten erlauben<br>`batteryPriceChargingEnabled` | AUS | Explizite Erlaubnis wirtschaftlich ausgewählter Netzladung. Modul-3-/Preisfenster, Wirkungsgrad, PV-Freiraum, Bedarf und Freigaben gelten zusätzlich; NT bedeutet nicht automatisch voll laden. |
| Maximaler SoC durch Netzladung (PV darf höher laden)<br>`batteryPriceMaxSocPct` | 100 % | Obere SoC-Grenze allein für Netzladung in %. PV-Ladung darf bis zur normalen oberen Grenze weitergehen; Reserve für kommende PV beachten. |
| Round-Trip-Wirkungsgrad (0 = bisheriger Wert je Richtung)<br>`batteryRoundTripEfficiencyPct` | 0 % | Gesamter Lade-/Entlade-Zykluswirkungsgrad in %. 0 verwendet die bisherige Richtungswirkungsgrad-Ableitung. Wichtig für wirtschaftlichen Preisvergleich nach Verlusten. |
| Maximaler Gesamtpreis brutto (0 = keine Grenze)<br>`batteryPriceMaxCt` | 0 ct/kWh | Absolute Obergrenze des gesamten Bruttopreises in ct/kWh für Netzladung; 0 ohne zusätzliche absolute Grenze. Wirtschaftlichkeit muss dennoch passen. |
| Mindestersparnis nach Speicherverlusten<br>`batteryPriceMinSavingsCt` | 2 ct/kWh | Erforderliche Mindestersparnis in ct/kWh nach Speicherverlusten. Verhindert Netzladung für zu kleine Preisunterschiede; keine garantierte Ersparnis im realen Betrieb. |
| Zusätzliche Reserve über Mindest-SoC<br>`batteryPriceReservePct` | 10 % | Zusätzliche Planungsreserve in Prozentpunkten über Mindest-SoC bei Preisplanung. Keine Erhöhung physischer Kapazität und kein eigener aktueller Messwert. |

### Speicher-Feinregelung und Eingangsprüfung

| Feld / technischer Schlüssel | Auslieferung | Zweck und erwartete Eingabe |
| --- | --- | --- |
| Maximale Änderung des Speicher-Sollwerts<br>`batteryFineStepW` | 100 W | Maximaler Sollwertschritt der Speicher-Feinregelung in W. Muss zur Reaktionsgeschwindigkeit und Rückmeldefrist des Treibers passen. |
| PV-Leistungsreserve für die Speicher-Feinregelung vor der Heizstabverteilung<br>`batteryFineReserveW` | 200 W | PV-Leistungsreserve in W für die Speicher-Feinregelung vor Heizstabverteilung. Keine zusätzliche Erzeugung; schützt nutzbaren Regelspielraum. |
| Totband der Speicher-Netzregelung<br>`batteryDeadbandW` | 50 W | Totband der Speicher-Netzregelung in W gegen unnötige kleine Befehle. Eigenes Speicherfeld, nicht die allgemeine NVP-Toleranz. |
| Regelzyklus des Speichers<br>`batteryCycleS` | 1 s | Regelzyklus des Speichers in s. Schnellerer Zyklus bewirkt keine schnellere physische Antwort als Treiber/Gerät; Antwortfristen bleiben erforderlich. |
| Zeitlimit für Befehl / physische Rückmeldung<br>`batteryFeedbackTimeoutS` | 15 s | Maximale Frist in s für Befehl und physische Antwort. Transport, Modus und tatsächliche AC-Leistung zusammen prüfen. |
| Maximales Alter der Speichermesswerte / Treiberaktualisierung<br>`batteryMeasurementMaxAgeS` | 30 s | Maximales Alter von Speichermesswerten und Treiberaktualisierung in s. Nicht durch künstliche EMS-Zeitstempel erneuern. |
| Maximales Alter des Speicher-SoC<br>`batterySoCMaxAgeS` | 300 s | Eigene maximale SoC-Altersfrist in s, weil SoC langsamer als Leistung aktualisiert werden kann. Alte SoC-Werte dürfen keine uneingeschränkte Entladung erlauben. |
| Optionale Abschaltgrenze der Batterietemperatur<br>`batteryTemperatureMaxC` | 50 °C | Optionale Abschaltgrenze in °C bei zugeordnetem gültigem Temperaturfühler. Nicht mit der Betriebsfreigabe gleichsetzen. |

## Admin: Wärmepumpe

Dieser Reiter ist eine Mess- und Empfehlungsintegration. NORMAL/BOOST/MAX sind interne Empfehlungen; SG Ready 2/3/4 kein direktes elektrisches Leistungs-Soll. Teuerpreis-Sperrbetrieb/SG Ready 1 ist nicht automatisch implementiert. Herstellerspezifische Register wie 4259 dürfen ohne geprüften Wertevertrag nicht als Schaltregister verwendet werden.

### 1. Messwerte und tatsächliche Rückmeldung

| Feld / technischer Schlüssel | Auslieferung | Zweck und erwartete Eingabe |
| --- | --- | --- |
| Wärmepumpe vorhanden<br>`heatPumpPresent` | AUS | Kennzeichnet tatsächlich vorhandene Ressource für Planung/Diagnose. Bedeutet keine reale Regelfreigabe. Noch nicht eingebaute Geräte deaktiviert lassen; deren Nullplanung ist kein bestandener Gerätetest. |
| Gemessene elektrische Wärmepumpenleistung<br>`heatPumpPowerId` | leer | Echte aktuelle elektrische WP-Leistung. Kein thermischer kW-Wert, Verdichterfrequenz oder Leistungsprozent. Einheit und Messumfang in den nächsten Feldern zwingend passend wählen. |
| Einheit des Wärmepumpen-Leistungsdatenpunkts<br>`heatPumpPowerUnit` | W | W oder kW der Quelle; das EMS normiert auf W. Nicht bereits umgerechnete Werte nochmals als kW deklarieren. Auswahl: `W` = W, `kW` = kW. |
| Umfang der elektrischen Leistungsmessung<br>`heatPumpPowerScope` | total | Gesamte WP-Leistung oder nur Inverter/Verdichter. Ein Teilwert belegt nicht vollständige WP-Leistung einschließlich Zusatzheizer/Pumpen und ist kein vollständiger §14a-Messnachweis. Auswahl: `total` = Elektrische Gesamtleistung der Wärmepumpe, `inverter` = Nur Inverter (keine vollständige §14a-Messung). |
| Maximales Alter der elektrischen Leistungsmessung<br>`heatPumpPowerMaxAgeS` | 30 s | Maximales Alter der WP-Leistungsmessung in s. Fehlend/ungültig bleibt unbekannt, nicht 0 W. |
| Optionaler Wärmepumpen-Verbindungsstatus (bei Zuordnung bestätigtes true erforderlich)<br>`heatPumpConnectionId` | leer | Optionaler bestätigter WP-/Treiber-Verbindungsstatus true. Wenn eingetragen, muss die Quelle gültig und frisch sein. |
| Tatsächliche SG-Ready-Rückmeldung (dekodierte Ganzzahl 1–4)<br>`heatPumpSgReadyStateId` | leer | Tatsächlich dekodierte SG-Ready-Rückmeldung als Ganzzahl 1–4. Hersteller-Rohregister erst korrekt dekodieren; kein ungeprüftes Modbus-Register oder EMS-Empfehlungsobjekt als Istzustand. |
| Puffertemperatur für die Wärmepumpe (leer = konfigurierte Heizpuffer-Temperaturquelle)<br>`heatPumpBufferTemperatureId` | leer | Echter Heizpufferfühler in °C für thermischen Spielraum der WP-Empfehlung. Leer nutzt die konfigurierte Heizpuffer-Temperaturquelle, falls vorhanden. |
| Warmwassertemperatur für die Wärmepumpe (explizite Quelle; keine automatische Sensorwahl)<br>`heatPumpDhwTemperatureId` | leer | Explizite echte Warmwassertemperaturquelle in °C. Keine automatische Auswahl irgendeines der vier Sensoren; die für die WP relevante Temperatur bewusst zuordnen. |
| Maximales Alter von Verbindung und SG-Ready-Rückmeldung<br>`heatPumpFeedbackMaxAgeS` | 120 s | Maximales Quellenalter von optionaler Verbindung und SG-Ready-Rückmeldung in s. Nicht gleich Mindesthaltezeit einer Empfehlung. |
| Maximales Alter der Wärmepumpentemperaturen<br>`heatPumpTemperatureMaxAgeS` | 3600 s | Maximales Alter der WP-Temperaturquellen in s. Kühlboost prüft seine Eingänge zusätzlich passend zum Rückmeldevertrag; eine große Temperaturfrist ist kein Freibrief für alte Kühlwerte. |
| Gemessene Leistung und Quellenqualität<br>`_heatPumpPowerStatus` | Anzeige | Nur Anzeige eines aktuellen EMS-Diagnoseobjekts, kein einzutragender Datenpunkt und kein Schalter. Gemessene Leistung und Quellenqualität. Empfehlung, Istwert und Quellenqualität getrennt lesen. |
| Geprüfte elektrische Leistung (W; unbekannt bleibt leer)<br>`_heatPumpPowerValue` | Anzeige | Nur Anzeige eines aktuellen EMS-Diagnoseobjekts, kein einzutragender Datenpunkt und kein Schalter. Geprüfte elektrische Leistung (W; unbekannt bleibt leer). Empfehlung, Istwert und Quellenqualität getrennt lesen. |
| Tatsächlicher dekodierter SG-Ready-Zustand<br>`_heatPumpActualSgFeedback` | Anzeige | Nur Anzeige eines aktuellen EMS-Diagnoseobjekts, kein einzutragender Datenpunkt und kein Schalter. Tatsächlicher dekodierter SG-Ready-Zustand. Empfehlung, Istwert und Quellenqualität getrennt lesen. |
| Qualität der SG-Ready-Rückmeldung<br>`_heatPumpActualSgStatus` | Anzeige | Nur Anzeige eines aktuellen EMS-Diagnoseobjekts, kein einzutragender Datenpunkt und kein Schalter. Qualität der SG-Ready-Rückmeldung. Empfehlung, Istwert und Quellenqualität getrennt lesen. |

### 2. Passive SG-Ready-Empfehlungen

| Feld / technischer Schlüssel | Auslieferung | Zweck und erwartete Eingabe |
| --- | --- | --- |
| An EMS-Empfehlungen teilnehmen (kein externer Stellbefehl)<br>`heatPumpControlEnabled` | AUS | Teilnahme an internen EMS-Empfehlungen, ausdrücklich kein externer WP-Stellbefehl. Aktueller Adapter schreibt keine SG-Ready-/Modbus-/KNX-Ausgänge der WP. |
| Passive SG-Ready-Empfehlungen aktivieren<br>`heatPumpAdviceEnabled` | AUS | Aktiviert passive SG-Ready-Empfehlungen. Mit vorhandenem Gerät, Master-/Regelfreigabe und gültigen Eingängen zusammen betrachten. Angezeigte Empfehlung ist keine tatsächliche Betriebsbestätigung. |
| Heizpuffer-Zieltemperatur für die Wärmepumpenempfehlung<br>`heatPumpHeatingTargetC` | 45 °C | Zieltemperatur in °C für Heizpuffer bzw. Warmwasser beim Prüfen des thermischen Spielraums. Keine direkte Temperaturvorgabe an die WP. |
| Warmwasser-Zieltemperatur für die Wärmepumpenempfehlung<br>`heatPumpDhwTargetC` | 60 °C | Zieltemperatur in °C für Heizpuffer bzw. Warmwasser beim Prüfen des thermischen Spielraums. Keine direkte Temperaturvorgabe an die WP. |
| Mindesthaltezeit einer Empfehlung<br>`heatPumpMinHoldS` | 300 s | Mindesthaltezeit einer Empfehlung in s gegen häufiges Wechseln. Ungültige/sperrende Schutzbedingungen ziehen Wünsche dennoch zurück. |
| PV-Überschuss für den Beginn einer SG-Ready-3-Empfehlung<br>`heatPumpPvBoostOnW` | 2500 W | EIN-/AUS-Schwelle des gemessenen PV-Überschusses in W für SG-Ready-3-Empfehlung. EIN höher als AUS wählen; thermischer Bedarf und gültige Quellen erforderlich. |
| PV-Überschuss für das Ende einer SG-Ready-3-Empfehlung<br>`heatPumpPvBoostOffW` | 1200 W | EIN-/AUS-Schwelle des gemessenen PV-Überschusses in W für SG-Ready-3-Empfehlung. EIN höher als AUS wählen; thermischer Bedarf und gültige Quellen erforderlich. |
| SG-Ready-4-Maximalanforderung empfehlen dürfen (nur Heizung/Warmwasser)<br>`heatPumpMaxBoostEnabled` | AUS | Erlaubt separate SG-Ready-4-Maximalempfehlung für Heizen/Warmwasser. Default AUS. SG Ready 4 startet keinen Kühlboost und ist kein direkt vorgebbarer elektrischer kW-Sollwert. |
| PV-Überschuss für den Beginn einer SG-Ready-4-Empfehlung<br>`heatPumpMaxBoostOnW` | 5000 W | Höhere EIN-/AUS-PV-Schwellen in W für ausdrücklich freigegebene SG-Ready-4-Empfehlung. Keine reale WP-Leistungsgarantie. |
| PV-Überschuss für das Ende einer SG-Ready-4-Empfehlung<br>`heatPumpMaxBoostOffW` | 4000 W | Höhere EIN-/AUS-PV-Schwellen in W für ausdrücklich freigegebene SG-Ready-4-Empfehlung. Keine reale WP-Leistungsgarantie. |
| Empfohlener SG-Ready-Zustand (nur intern)<br>`_heatPumpRecommendedSgState` | Anzeige | Nur Anzeige eines aktuellen EMS-Diagnoseobjekts, kein einzutragender Datenpunkt und kein Schalter. Empfohlener SG-Ready-Zustand (nur intern). Empfehlung, Istwert und Quellenqualität getrennt lesen. |
| SG-Ready-Empfehlung gültig<br>`_heatPumpSgAdviceValidity` | Anzeige | Nur Anzeige eines aktuellen EMS-Diagnoseobjekts, kein einzutragender Datenpunkt und kein Schalter. SG-Ready-Empfehlung gültig. Empfehlung, Istwert und Quellenqualität getrennt lesen. |
| Grund der SG-Ready-Empfehlung<br>`_heatPumpSgAdviceReason` | Anzeige | Nur Anzeige eines aktuellen EMS-Diagnoseobjekts, kein einzutragender Datenpunkt und kein Schalter. Grund der SG-Ready-Empfehlung. Empfehlung, Istwert und Quellenqualität getrennt lesen. |

### 3. Getrennte KNX-Boostwünsche für Heizen und Kühlen

| Feld / technischer Schlüssel | Auslieferung | Zweck und erwartete Eingabe |
| --- | --- | --- |
| Separate Kühlboost-Empfehlung aktivieren (nur intern)<br>`heatPumpCoolingBoostEnabled` | AUS | Separate interne Kühlboost-Empfehlung erlauben. Nur bei tatsächlichem Kühlstatus, Bedarf, frischen Raum-/Taupunkt-/Vorlaufquellen und Sicherheitsabstand. Schreibt keinen KNX-Boost. |
| Raumtemperatur für den Kühlboost (°C)<br>`heatPumpCoolingRoomTemperatureId` | leer | Echte Raumtemperatur in °C oder nachgewiesen passende Aggregation mehrerer Räume. Kein Sollwert. Aggregationsskript muss vollständige/frische Quellen prüfen; EMS kann fehlende Einzelräume hinter einem scheinbar frischen Sammelwert nicht erkennen. |
| Taupunkttemperatur für den Kühlboost (°C)<br>`heatPumpCoolingDewPointId` | leer | Taupunkttemperatur in °C, für mehrere relevante Räume vorzugsweise konservativer maximaler gültiger Taupunkt. Kein Feuchteprozentwert. Aus realer Temperatur/Feuchte berechnen; alte/fehlende Quellen nicht durch periodischen Jetzt-Stempel legitimieren. |
| Gemessene Kühl-Vorlauftemperatur (°C)<br>`heatPumpCoolingFlowTemperatureId` | leer | Gemessene Kühl-Vorlauftemperatur in °C. Nicht WP-Sollregister. Ohne gültige Messung kein belegter Abstand zum Taupunkt. |
| Gewünschte Raumtemperatur beim Kühlen<br>`heatPumpCoolingRoomTargetC` | 23 °C | Gewünschte Raumtemperatur in °C zum Ermitteln des Kühlbedarfs. Nur Empfehlung, kein Raumregler-Stellbefehl. |
| Gewünschte Kühl-Vorlauftemperatur<br>`heatPumpCoolingFlowTargetC` | 20 °C | Gewünschte Vorlauftemperatur in °C; tatsächlicher empfehlbarer Wert muss mindestens Taupunkt plus Sicherheitsabstand berücksichtigen. Keine Aufforderung zur Unterschreitung des Taupunkts. |
| Sicherheitsabstand zum Taupunkt beim Kühlen<br>`heatPumpCoolingDewPointMarginK` | 2 K | Sicherheitsabstand in Kelvin über Taupunkt. Beispiel 17 °C Taupunkt + 2 K → mindestens 19 °C Vorlauf im Empfehlungsvertrag. Kein alleiniger Kondensationsschutz für jede Fläche. |
| Interner KNX-Heizboostwunsch<br>`_heatPumpKnxHeatingStatus` | Anzeige | Nur Anzeige eines aktuellen EMS-Diagnoseobjekts, kein einzutragender Datenpunkt und kein Schalter. Interner KNX-Heizboostwunsch. Empfehlung, Istwert und Quellenqualität getrennt lesen. |
| Interner KNX-Kühlboostwunsch<br>`_heatPumpKnxCoolingStatus` | Anzeige | Nur Anzeige eines aktuellen EMS-Diagnoseobjekts, kein einzutragender Datenpunkt und kein Schalter. Interner KNX-Kühlboostwunsch. Empfehlung, Istwert und Quellenqualität getrennt lesen. |
| Grund des Kühlboosts<br>`_heatPumpCoolingStatus` | Anzeige | Nur Anzeige eines aktuellen EMS-Diagnoseobjekts, kein einzutragender Datenpunkt und kein Schalter. Grund des Kühlboosts. Empfehlung, Istwert und Quellenqualität getrennt lesen. |
| Kühlboost-Empfehlung gültig<br>`_heatPumpCoolingValidity` | Anzeige | Nur Anzeige eines aktuellen EMS-Diagnoseobjekts, kein einzutragender Datenpunkt und kein Schalter. Kühlboost-Empfehlung gültig. Empfehlung, Istwert und Quellenqualität getrennt lesen. |

### 4. ISG-Schnittstelle und §14a-Grenzen (nur Hinweise)

## Admin: Wärmestrategie

Gemeinsamer Kühlzustand und ausdrückliche Erlaubnis für budgetiertes Günstigpreisheizen. Diese Felder ersetzen weder thermischen Bedarf noch Gerätefreigaben. Fahrzeug- und Speicher-Preisladung werden separat eingestellt.

| Feld / technischer Schlüssel | Auslieferung | Zweck und erwartete Eingabe |
| --- | --- | --- |
| Gemeinsamer Kühlstatus (bestätigtes true/1 = Kühlung; false/0 = keine Kühlung)<br>`heatingCoolingActiveId` | leer | Gemeinsamer echter Kühlzustand: bestätigt true/1 = Kühlung, false/0 = kein Kühlen. Sperrt unpassende Heizpuffer-Aufträge und ist Grundlage für getrennte WP-Heiz-/Kühlwünsche. |
| Optionaler Zeitstempel der Kühlquelle (frischer Epoch-ms-Wert; erlaubt unverändertes Kühlsignal)<br>`heatingCoolingHeartbeatId` | leer | Optionaler frischer Epoch-ms-Zeitstempel der Kühlquelle, damit unverändertes Kühlsignal trotzdem nachweislich aktuell sein kann. Muss erfolgreiche Quellenprüfung bestätigen, nicht nur die Ausführung eines Timers. |
| Maximales Alter des Kühlstatus / Zeitstempels<br>`heatingCoolingMaxAgeS` | 120 s | Maximales Alter des Kühlzustands bzw. seines gültigen Heartbeats in s. Unbekannter Kühlstatus ist keine bestätigte Heizfreigabe. |
| Ausdrücklich budgetiertes Heizen bei günstigen Strom-Gesamtpreisen erlauben<br>`thermalCheapPriceEnabled` | AUS | Explizite Erlaubnis budgetierten elektrischen Heizens bei günstigen Gesamtpreisen. Getrennt von Fahrzeug-/Batterie-Preisladung. Ohne positive Preis-/Netzgrenze entsteht daraus keine unbegrenzte Nachtwärme. |
| Maximaler Strom-Gesamtpreis für Günstigpreisheizen<br>`thermalCheapPriceMaxCt` | 0 ct/kWh | Höchster zulässiger Strom-Gesamtpreis brutto ct/kWh für Günstigpreiswärme. Energie und Netzentgelt zusammen, nicht nur Börsenpreis. 0 ist keine sinnvoll positive Freigabeschwelle für gewöhnliches Netzheizen. |
| Maximales gemeinsames Netzleistungsbudget für Günstigpreisheizen (0 = kein Netzheizen)<br>`thermalCheapGridMaxW` | 0 W | Gemeinsames maximal autorisiertes Netzleistungsbudget für Günstigpreiswärme in W; 0 = kein Netzheizen. Keine Grenze je Heizstab. Hausanschluss und Netzbetreiberlimit wirken zusätzlich. |
| Günstigpreisheizen auch mit ausdrücklich konfiguriertem Festtarif erlauben<br>`thermalCheapFixedTariffAllowed` | AUS | Erlaubt diese Preiswärme ausdrücklich auch bei passend konfiguriertem Festtarif. Verhindert, dass ein unerwarteter Festpreis-Ersatz automatisch Netzheizen freigibt. |

## Admin: Echtzeitregelung

Netzanschlusspunkt-Regelziel und allgemeiner Berechnungszyklus. Negative Netzleistung bedeutet Einspeisung. Normale Hauslast kann ohne aktiven Stellspielraum nicht auf den Sollwert gebracht werden; „Stellgrenzen erreicht“ ist daher nicht automatisch eine Störung.

### Echtzeitsimulation am Netzverknüpfungspunkt

| Feld / technischer Schlüssel | Auslieferung | Zweck und erwartete Eingabe |
| --- | --- | --- |
| Simulation aktivieren<br>`controlEnabled` | EIN | Aktiviert die Berechnung der Echtzeitregelung/Simulation. Trotz Admin-Bezeichnung „Simulation“ sind bei zusätzlich freigegebenen realen Ausgängen produktive Befehle möglich; dieses Feld allein ist weder Master noch Schatten-Live-Schalter. |
| Netzsollwert (+ Bezug / − Einspeisung)<br>`targetGridPowerW` | -100 W | Netzsollwert in W: positiv Bezug, negativ Einspeisung. −100 W zielt auf kleine Einspeisereserve; 0 W auf rechnerische Null. Nur steuerbare Lasten/aktiver Speicher können Abweichung beeinflussen; normale Hauslast ohne Stellspielraum bleibt. |
| Gemeinsame Netzbezugstoleranz fuer PV-Wallboxen<br>`wallboxPVImportToleranceW` | 50 W | Maximale zusaetzliche Toleranz oberhalb des Netzsollwerts fuer genau eine bereits laufende Wallbox, auch unter Mindest-SoC. Einstellbar 0–200 W; 0 deaktiviert die Erweiterung. Ein neuer gemessener 1-A-Schritt haelt 20 W Abstand zur Grenze: bei Einstellung 100 W Zuschalten bis rechnerisch 80 W und Halten bis 100 W (Standard 50 W: 30/50 W). Gemeinsamer Zuschlag, nicht je Auto; keine neue Start-, Preis- oder Schutzbudgetfreigabe. Erzwungene Mindestladungen und andere Hausverbraucher bleiben eigenstaendige Lasten; die Einstellung ist keine harte Obergrenze fuer den gesamten Haus-Netzbezug. Bei Netzsollwert 0 W kann 220 W Einspeisung durch einen 230-W-Schritt zu rechnerisch 10 W Bezug werden. Dreiphasig benoetigt ein Schritt etwa 690 W. Momentanwerte koennen bei PV-/Lastwechseln und Messverzoegerung abweichen. |
| Totband<br>`deadbandW` | 100 W | Totband in W um den Netzsollwert. Innerhalb keine unnötige feine Korrektur; außerhalb können Ampere-Raster, Mindestlast und Antwortfristen dennoch Restabweichung verursachen. |
| Langsamer Regelzyklus<br>`slowCycleS` | 5 s | Langsamer Ziel-/Verteilungszyklus in s. Unterscheidet sich von schnelleren Ausgangs-/Speicherzyklen, Modbus-Pollzeit und Historienauflösung. |

Bei produktiver Mehrfahrzeugregelung kann ein bereits elektrisch bestaetigter Ladestrom gehalten werden, wenn seine frische reale Aufnahme im PV-Budget liegt und die nominelle Softgrenze um hoechstens ein Ampere unterschritten wird. Beispiel: 8 A Vorgabe, 1730 W Aufnahme und 1800 W Budget bleiben 8 A statt unnoetig 7 A. Mit der gemeinsamen Netzbezugstoleranz kann ein bestaetigter laufender Ladepunkt ausserdem genau einen gemessenen 1-A-Schritt erhalten; die halbe Toleranz muss die erwartete Abweichung decken. Nominelle Schutzreserven bleiben voll erhalten. Alle drei Wallboxen nutzen dieses Verhalten bei 1P/3P; eigene Geraetegrenzen, Schutzbudgets und volle Reserven fuer andere Verbraucher bleiben bindend. `AllocationDiagnostics_JSON` zeigt `measured-current-held`, die Ausgangsdiagnose `IncreaseBudget_JSON` zeigt `measured-current-hold`.

## Admin: Erweiterte Datenpunkte

Nur Migration/Altintegration. Für normale Zuordnung die fachlichen Reiter verwenden. Ein geleertes sichtbares Feld kann auf eine noch vorhandene alte JSON-Zuordnung zurückfallen; wirksame Quelle kontrollieren.

### Erweiterte Datenpunktzuordnung

| Feld / technischer Schlüssel | Auslieferung | Zweck und erwartete Eingabe |
| --- | --- | --- |
| Bisherige Datenpunktzuordnung als JSON (Migrations-Ersatz)<br>`dataPointMapJson` | — | Alte Schlüssel→Objekt-ID-Zuordnung als JSON nur für Migration/Sonderfälle. Explizite ausgefüllte Admin-ID-Felder haben Vorrang; leere Felder können weiter auf alte Zuordnung zurückfallen. Wirksame Quelle unter System.MappingStatus_JSON kontrollieren. |
| Bisheriger freier Strom L1 (A)<br>`dhwHaL1FreeCurrentId` | leer | Optionaler bisheriger freier Strom der jeweiligen Netzphase in A für Altintegration. Kein gemessener Gesamt-/Wallboxstrom. Physische gemeinsame Anschlussgrenze bleibt maßgeblich. |
| Bisheriger freier Strom L2 (A)<br>`dhwHaL2FreeCurrentId` | leer | Optionaler bisheriger freier Strom der jeweiligen Netzphase in A für Altintegration. Kein gemessener Gesamt-/Wallboxstrom. Physische gemeinsame Anschlussgrenze bleibt maßgeblich. |
| Bisheriger freier Strom L3 (A)<br>`dhwHaL3FreeCurrentId` | leer | Optionaler bisheriger freier Strom der jeweiligen Netzphase in A für Altintegration. Kein gemessener Gesamt-/Wallboxstrom. Physische gemeinsame Anschlussgrenze bleibt maßgeblich. |

## Typische Einrichtung und Fehlersuche

### Welche Objekte muss ich zuerst suchen?

| Aufgabe | Objektart / Beispielstruktur | Nicht verwenden |
| --- | --- | --- |
| Netzbilanz | aktuelle Gesamt-Bezugs-/Einspeiseleistung in W, z. B. `sma-em.0.<Gerät>.pregard` / `.psurplus` | kWh-Zähler, ein negatives Nettosignal doppelt in getrennte Felder |
| Phasenschutz | jeweilige `.L1/.L2/.L3.pregard`, `.psurplus`, `.amperage` am Hausanschluss | dreimal denselben Gesamtwert |
| Wallboxleistung | `go-e.N.energy.power` in kW | kumulative Energie oder Ampere-Vorgabe |
| Wallboxstellwert | `go-e.N.amperePV` in A und `.allow_charging` als 0/1 | bloße Anzeige oder Benutzerfreigabeobjekt |
| Wallboxrückmeldung | bestätigter Strom `.ampere`, Fehler, Verbindung, bestätigter Modus und L1–L3-Ströme | eigenes Schreibecho als Beweis |
| Heizstab | eigener W-Sollwert plus drei W-Istleistungen und echte °C-Fühler | Sollleistung als Istleistung |
| Speicher | konsistente GS-/GP-/MM-/LM-/Heartbeat-/SoC-Objekte desselben unterstützten Kopfs | DC-Leistung als AC-ACK oder Mehrkopf-Gesamtwert als Einzelkopfantwort |
| WP | elektrische W/kW-Messung und korrekt dekodiertes SG-Ready-Istsignal | thermische Leistung oder unbelegtes Rohregister |

Adapterversionen können andere Objektpfade liefern. Im Objektbaum Metadaten (`common.type`, Einheit, Schreibbarkeit), aktuelle Rohwerte, ACK/q und Zeitstempel prüfen. Die Beispiele sind keine private Anlagenkonfiguration.

### Preiseingaben und Zeitfenster

Im Gesamtpreis-Modus beispielsweise 30 ct/kWh Vertragspreis mit darin 7 ct/kWh Referenznetzentgelt: Energieanteil 23 ct/kWh; bei einem Intervall-Netzentgelt von 1 ct/kWh ergibt sich 24 ct/kWh Gesamtpreis. Zahlen sind reine Rechenbeispiele. Keine automatische Tarifzuordnung aus der Postleitzahl voraussetzen.

Externe Preisreihen müssen echte Zeitintervalle enthalten, kein einzelner aktueller Preis. Das aktuelle externe Format ist ein JSON-Array mit `ts` (Epoch-Millisekunden), `endTs` (exklusives Intervallende in Epoch-ms) und `val` (ct/kWh), etwa `[{"ts":1791583200000,"endTs":1791584100000,"val":23.5}]`. Das Beispiel deckt nur eine Viertelstunde ab und ist kein aktueller Tarif. Negative Börsenpreise sind möglich; NULL bleibt unbekannt. Historische Reihen ohne `endTs` werden als Stunden-/Viertelstundenreihen erkannt; für neue Zuordnung eindeutige Endzeiten bevorzugen. Die Quelle muss bestätigt und qualitativ gültig sein. Parser: `lib/engine/prices.js`; der integrierte Energy-Charts-Abruf hat einen anderen Anbieter-Datenvertrag. Vor Produktivverwendung `Forecast.*`-Preisstatus und vollständige Viertelstunden prüfen. Bei Jahrestarifen je Quartal vollständige Tagesfenster eintragen. Beispielsweise `00:00–05:00 NT`, `05:00–16:30 ST`, `16:30–21:00 HT`, `21:00–24:00 ST`; nicht ungeprüft als eigenen Netzbetreibertarif übernehmen. Über Mitternacht besser zwei eindeutig zum Tag gehörige Zeilen verwenden.

### Keine unbeabsichtigte Nachtladung

Für Fahrzeuge jeweils Preis-Netzladung und Abfahrts-Netzladung prüfen; Mindest-SoC und manueller Mindeststrom können trotzdem Netzbedarf erzeugen. Für Batterie eigene Netzladefreigabe prüfen. Für Wärme „Günstigpreisheizen“ und gemeinsames Netzbudget prüfen. „Preisladung AUS“ allein bedeutet nicht, dass jeder andere ausdrücklich konfigurierte Pflichtbedarf ebenfalls AUS ist. Prognosebalken sind erwartete Planung, keine tatsächlich erteilte Freigabe.

### Priorität aus dem Webinterface

Unter **Wallboxen allgemein** Quelle **Externer Datenpunkt** wählen und das tatsächlich vom Webinterface geschriebene Prioritätsobjekt zuordnen. 0/1/2 wählen WB0/WB1/WB2, −1 bedeutet automatische Auswahl. Unter `Control.WallboxPrioritySource` und `Control.WallboxSelectionReason` die wirksame Quelle/Entscheidung prüfen. Eine bevorzugte Box oberhalb Ziel-SoC oder ohne Fahrzeug wird dadurch nicht ladeberechtigt. Automatische Rangfolge verwendet Pflicht-/Mindestbedarf und Berechtigung, nicht nur die Fahrzeugnummer. Im Parallelmodus werden zuerst geschützte Mindestbedarfe berücksichtigt, dann Mehrleistung bevorzugt verteilt. Ab alpha.65 wartet ein bewusst angeforderter Wechsel einer optionalen Ladung bei knappem Budget nicht erst auf den gewöhnlichen PV-Mangel-Nachlauf. Das bisherige Fahrzeug erhält kontrolliert AUS; seine Leistung bleibt bis zum frischen AUS-ACK und zur bestätigten elektrischen Ruhe reserviert. Unter Mindest-SoC, bei bestehendem Abfahrts- oder manuellem Mindestbedarf wird die benötigte Grundladung nicht für diese Übergabe entzogen. Reicht das reale gemeinsame Budget für beide Fahrzeuge, ist kein erzwungener Stopp erforderlich.

Ab alpha.66 schaltet der freigegebene produktive Wallbox-Ausgang im Parallelmodus eine ungenutzte, physisch freigegebene Wallbox kontrolliert AUS, auch wenn noch kein Fahrzeug angeschlossen ist. Dadurch bleibt keine alte Ladefreigabe für das nächste Anstecken stehen. Ein bereits laufendes anderes Fahrzeug wird durch diesen Abschaltauftrag nicht allein wegen der vorübergehenden Ausgangseigentümerschaft unterbrochen. AUS-ACK und elektrische Ruhe bleiben für den Abschluss erforderlich. Die enge historische Leerlaufausnahme aus alpha.51 gilt weiter ausschließlich für den sequenziellen Betrieb; neue Starts bleiben auch dort verriegelt.

### Warum sind 50/50 nicht exakt 50/50?

Wallboxen arbeiten mit ganzen Ampere-Schritten: nominal 1 A ≈ 230 W bei 1P bzw. ≈ 690 W bei 3P. Mindeststrom, vorhandene Mindest-SoC-Ladungen, phasenabhängige Stromgrenzen, thermischer Bedarf und echte Fahrzeugantwort begrenzen die Aufteilung. Heizstab kann feinere Reste aufnehmen; ohne thermischen Bedarf bekommt er nicht allein wegen eines 50-%-Werts die Hälfte. Die Verteilungsschwellen sind keine Aussage „unter 9000 W darf kein Auto laden“.

### Start, Stopp, Übergabe und Phasenwechsel

Ein gewöhnlicher PV-Neustart benötigt Mindestleistung plus Reserve über die Startverzögerung. Ein laufender Ausgang kann weichen Budgetmangel nach seinen Timern überbrücken. Harte Schutzverletzung, Benutzersperre, Abstecken oder erreichte Ladegrenzen sind andere Ereignisse. Eine qualifizierte Übergabe kann ohne zweiten vollständigen Starttimer erfolgen, benötigt aber belegte sichere Zustände des abgebenden Ausgangs. Bewusste parallele Mindestladung ist kein solcher Einzel-Fahrzeugwechsel. Ab alpha.67 kann auch ein reguläres Ziel-SoC-Ende im Parallelbetrieb eine solche Übergabe an das nächste berechtigte Fahrzeug vorbereiten. Die Leistung des bisherigen Fahrzeugs bleibt bis zum unabhängigen AUS-ACK und zur danach bestätigten elektrischen Ruhe reserviert.

Für den Entfall des zweiten Starttimers muss die abgebende EMS-Ladung in dieser Sitzung vom inaktiven zum aktiven Zustand mit gültiger realer Antwort beobachtet worden sein. Alternativ kann ab alpha.67 eine tatsächlich abgeschlossene Übernahme nach Neustart im aktuellen Prozess qualifizieren: Der Ausgangstreiber stellt dazu `Devices.WallboxX.OutputAdoptionProof_JSON` bereit; der Regler prüft Generation, Eigentum, Befehlsrückmeldung und elektrische Antwort unabhängig erneut. Gespeicherte Aktiv-/Eigentumsflags oder eine bloße laufende Momentaufnahme genügen weiterhin nicht. Geänderte Priorität, ungültige oder veraltete Quellen, fehlende Bestätigungen oder verlorenes Budget widerrufen die Vorbereitung; ein gewöhnlicher Neustart behält seine Startverzögerung. Phasen-, Preis-, Geräte-, Hausanschluss- und §14a-Grenzen gelten auch während der Übergabe.

Ein Modbus-Schreibecho ist noch keine unabhängige Befehlsbestätigung. Nach ACK benötigt das Fahrzeug weitere Reaktionszeit. Beim internen go-e-Phasenwechsel ist eine begrenzte Ladepause erwartbar; Erfolg erst mit bestätigter neuer Stellung, realer elektrischer Phasenantwort und Wiederanlauf belegen. Ein angestecktes Fahrzeug ist noch kein erfolgreich gestartetes Fahrzeug.

### Warum fehlt Wärme im Fahrplan oder bleibt Leistung begrenzt?

Vorhanden/Regelfreigabe, Fühlergültigkeit, aktuell gespeicherte Wärme, angenommener 24-h-Bedarf/Verlust, Zieltemperatur, Kühlstatus und verfügbare PV-/Preisenergie prüfen. Danach Inbetriebnahmegrenze, Ausgangskennlinie, Anschlussbudget und tatsächliche Stellantwort prüfen. Eine temperaturbedingt begrenzte Leistung ist kein Verteilerfehler. Eine konservative offene Reservierung ist ebenfalls nicht durch späteren beliebigen Nullwert erledigt: Ursprung, positive Stellwirkung und gültige Nullfolge müssen zusammenpassen.

### Wärmepumpe und Kühlung vorbereiten

Elektrische Leistung mit richtiger W/kW-Einheit und Gesamt-/Invertermessumfang zuerst lesend prüfen. SG-Ready-Rückmeldung nur nach dokumentierter Dekodierung eintragen. Ein empfohlener Zustand 4 beweist keinen maximalen Verbrauch und aktiviert keinen Kühlbetrieb. Für Kühlboost getrennte reale Raum-, Taupunkt- und Vorlauftemperaturen mit zyklischer Bestätigung einrichten. Beispiel bei mehreren Räumen: konservativer maximaler gültiger Taupunkt; Vollständigkeit und Quellenalter im vorgeschalteten Skript prüfen. Keine Aktorfreigabe aus einer bloß periodisch neu geschriebenen alten Aggregation ableiten.

## Diagnose, SQL und Datenqualität

Wichtige Bereiche unter `ems-optimizer.0`:

| Objektbereich | Aussage |
| --- | --- |
| `System.Version`, `System.MappingStatus_JSON` | Laufzeitversion bzw. wirksame Herkunft der Quellenzuordnung. Installations-/Startlog zusätzlich abgleichen, alte Anzeige nicht blind vertrauen. |
| `Forecast.*`, `Plan.*`, `Charts.*` | Erwartete Zeitreihen/Fahrplan/Anzeige; kein Nachweis realer Aktorwirkung. |
| `Control.Valid`, `Control.Status`, `Control.ActualGridPower_W`, `Control.RemainingError_W` | Aktuelle Regelgültigkeit, Grund und verbleibende Netzabweichung; Snapshot ersetzt keine Tageshistorie. |
| `Control.WallboxX.AllocationDiagnostics_JSON`, `Control.WallboxX.PhaseDecision_JSON` | Budget, Reservierung, Start-/Übergabebedingungen und Phasenentscheidung. |
| `Devices.WallboxX.*` | Eigentum/ausgangsbezogene Zustände, Rückmeldungen, Fehler, Stop-/Antwort- und Timerdiagnosen. Tatsächlich existierende Unterobjekte im Objektbaum ansehen. |
| `Devices.WallboxX.OutputAdoptionProof_JSON` | Begrenzter Nachweis einer tatsächlich abgeschlossenen Ausgangsübernahme im aktuellen Prozess; kein Ersatz für frische unabhängige Rückmeldungen und keine alleinige Startfreigabe. |
| `Devices.MyPV_DHW.*`, `Devices.MyPV_Heating.*`, `Devices.Battery.*`, `Devices.HeatPump.*` | Geräte-/Quellenqualität, gemessene Antwort und Status; WP-Empfehlung getrennt vom Istzustand. |
| `Devices.MyPV_DHW.OutputReservationState_JSON`, `Devices.MyPV_Heating.OutputReservationState_JSON` | EHZ-Reserve, `zeroProofStatus` mit Sperr-/Wartegrund, `restartReason`, Probenzahl und Plateauzeit sowie `lastReleaseProof` mit letztem Befehlsreset und Beginn der ununterbrochenen Nullbefehlsfolge. |
| `Debug.Shadow.DecisionRecord` und Record-Fehler-/Verlustzähler | Historische zusammengehörige Diagnose mit Ereigniszeit, Sitzung und Sequenz; Live-/Schattenphase anhand gespeicherter Flags trennen. |
| `Debug.Shadow.RecordJournalStatus`, `RecordJournalBytes`, `RecordJournalRecords`, `RecordSQLConfirmed`, `RecordSQLPending`, `RecordSQLLastError` | Lokale Haltbarkeit, Kapazität, Verluste und unabhängiger SQL-Nachweis getrennt beurteilen. Ein bestätigter State-Schreibaufruf ist kein SQL-Speichernachweis. |
| `Debug.Shadow.RecordDeliveryStatus` | Seit alpha.77: Originalrecordversuche und tatsächliche Transport-Schreibaufrufe getrennt; außerdem Bestätigungen, Rückstau, Prüffenster, letzte Abfrage und Transportgrenzen. SQL-Pakete enthalten unveränderte Originale, keine simultane Entscheidung. |

Vollständige ruhige **Live-Cacheframes** bleiben in 30-s-Intervallen zusammengefasst; Stellbefehle und relevante Zustands-/Qualitätswechsel bleiben unmittelbar. Ab alpha.71 werden empfangene Originalproben der ausgewählten Quellen auch außerhalb der Ereignisfenster in begrenzten Batches aufgezeichnet. Dazu gehören konfigurierte Fahrzeugfreigaben, Priorität, SoC-/Timer-/Phasen- und Stromquellen, Schutzwerte sowie EHZ-Auftrag, Reserve und physische Leistung. Der gespeicherte Quellenvertrag zeigt die konkrete Auswahl; fehlende oder nicht zugeordnete Quellen bleiben unbekannt. Ereignisse behalten bis 60 s Vorlauf und 120 s Nachlauf. Die Vorlaufgrenzen von 4096 Proben und 1 MiB sowie alle Verlustzähler bleiben sichtbar.

`recording.interval` enthält beobachtete Anzahl, Min/Max/Mittel und Lücken, keine vollständige sekundengenaue Historie. `recording.pre_event`, `recording.sources` und einzelne `source.update`-Ereignisse enthalten originale Quellenproben einschließlich NULL, `ts`, `lc`, ACK/q und Empfangszeit. Ein Cacheframe ist keine simultane historische Entscheidung jeder Probe. Bei Replay Vollbasis suchen, Deltas rekonstruieren, Records nach Sitzung/Sequenz und Proben zusätzlich nach Sitzung/Sample-Sequenz deduplizieren. Widersprüche und fehlende Bereiche ausdrücklich ausweisen. Eine reguläre 30-s-Quiet-Auflösung ist nicht automatisch eine 1-s-Sequenzlücke; echte Verluste müssen weiterhin geprüft werden.

Ab alpha.71 erhält ein privates lokales Journal die exakten serialisierten Records vor ihrer State-Veröffentlichung und über Neustarts. Kompakte Checkpointketten werden erst als abgeschlossene vollständige Gruppe entfernt, nachdem jedes Mitglied durch eine getrennte rohe SQL-Antwort mit passender Sitzung, Sequenz und identischem Inhalts-Hash bestätigt ist; der jüngste Checkpoint bleibt als Basis künftiger Deltas erhalten. Ab alpha.73 hält fehlender SQL-Nachweis die Originalkette nur bis zur lokalen Altersbereinigung: sobald alle Mitglieder mindestens 24 Stunden lokal gespeichert sind, darf die vollständige alte Kette mit dauerhaftem Verlustnachweis schrittweise entfernt werden (höchstens eine Kette pro Minute). Aktuelle Delta-Basen und beschädigte Dateien werden nicht altersbedingt gelöscht. Das Alter zählt ab lokaler Speicherung, nicht ab dem Ereigniszeitpunkt oder der SQL-Veröffentlichung; Neustarts verlängern es nicht. Die letzte Verlustmarkierung enthält Session-/Sequenz-/Ereignisgrenzen, kumulative Zähler erhalten den Gesamtumfang. Bis dahin bleibt die Originalkette lokal; begrenzte Wiederveröffentlichung beginnt am benötigten Snapshot und kann identische historische Dubletten erzeugen. Der Spool ist endlich: 128 MiB, 65.536 Recorddateien, höchstens 512 KiB je Record sowie eine begrenzte Schreibqueue. Voller oder defekter Datenträger und nicht abgeschlossene Schreibvorgänge erlauben keine Vollständigkeitsbehauptung; Ablehnungen und Fehler werden ausgewiesen. Geordneter Recorderabschluss folgt der Aktorrücknahme, beweist aber keinen späteren elektrischen Nachlauf. Ein Journal- oder SQL-Fehler ist keine Aktorfreigabe.

Der unabhängige Speichernachweis verwendet begrenzte sequenzielle SQL-Fenster. Jede Anfrage erhält vorher eine dauerhafte Sperre; nur der beobachtete Abschluss derselben Anfrage hebt sie auf. Ein unbekannter Backendabschluss sperrt weitere Anfragen auch über einen Neustart. Das separate Abrufwerkzeug startet mit 2-s-Fenstern/Limit 32, begrenzt Anzahl und Dauer eines Laufs und erhält Originalfehler, Grenzen, Laufzeiten, beobachtete Antwortmengen, Parse-/Truncationstatus und offene Fenster. Gemessene Recordbytes und gegebenenfalls beobachtete Transportmengen bleiben getrennt. Details: [Abrufvertrag](docs/issue123-recorder-access.md) und [Releasehinweise](docs/release-0.17.0-alpha.71.md).

Die Recorderdiagnose selbst passt SQL-Skalarhistorien nicht an. Ab alpha.125 verwaltet die gesonderte Option `sourcePowerHistoryEnabled` ausschließlich die bereits aktivierten PV-/Wallbox-Leistungshistorien wie oben beschrieben; Retention und Anlagensteuerung bleiben bestehen. Ein lokaler Record oder erfolgreicher kleiner SQL-Abruf beweist keine vollständige Tageshistorie und behebt nicht nachweislich jede sporadische SQL-/Connector-Zeitüberschreitung. Energie bevorzugt aus gültigen Zählerdifferenzen bestimmen; grobe Intervallmittel nicht als genaue Tagesenergie ausgeben. Fehlend, NULL, veraltet oder unbestätigt bedeutet unbekannt, nicht AUS/0 W. Optionale Pumpenquellen bleiben mit `[]` unkonfiguriert; Pumpenzuständigkeit, unabhängige Rückmeldung und tatsächlicher Nachlauf benötigen weiterhin reale Nachweise.

Ab alpha.114 akzeptieren Wallbox-Ausgang und zentrale Phasenbudgetprüfung bestätigte, frische, qualitativ gültige Leistungswerte zwischen −0,03 und 0 kW intern als 0 W, mit höchstens einer Warnung je Minute und Wallbox. Die positive Leerlaufgrenze bleibt bei 20 W. Die originale negative Rohmessung bleibt in der Diagnose erhalten. Größere negative Werte, fehlende/ungültige Werte, schlechtes q, fehlendes ACK und veraltete Quellen bleiben gesperrt. Diese Toleranz gilt für Wallboxleistung; die Verträge anderer Quellen werden dadurch nicht geändert.

Der Status `Debug.SourcePowerHistory` nennt je konfigurierter Quelle `configured`, `already-configured`, `skipped` oder einen Fehler. Die Bestätigung betrifft persistierte SQL-Einstellungen, keinen erfolgreichen SQL-Datensatz oder durchgehende Gerätefrische. Unveränderte Leistung benötigt nach der Umstellung bis zu 600 s bis zur nächsten SQL-Wiederholung. Für Quellenfrische und kurze Unterbrechungen weiterhin reale Quellenzeiten/Qualität und ereignisorientierte DecisionRecords auswerten; längere Historienabstände nicht als Geräteausfall interpretieren. Tagesenergie und Ereigniserhalt müssen nach manueller Installation real nachgewiesen werden.

## Changelog

### 0.17.0-alpha.130 (2026-10-23)

Einmalige Umstellung bisheriger 0-W-NVP-Ziele auf 50 W Bezug. Messtechnisch gedeckte PV-Stromschritte werden nicht mehr allein durch die nominale Watt/Ampere-Umrechnung blockiert. [Details](docs/release-0.17.0-alpha.130.md).


### 0.17.0-alpha.129 (2026-10-23)

Test- und Releaseprüfung umfassen Node.js 22, 24 und 26. Mindestversionen von adapter-core/testing wurden aktualisiert. Die letzten sieben Versionsnachrichten bleiben im Manifest; die Paketprüfung verhindert ein erneutes Überschreiten der Grenze. Ältere Änderungen bleiben im Changelog erhalten. [Details](docs/release-0.17.0-alpha.129.md).

[Alle älteren Änderungen und historischen Detailbeschreibungen](CHANGELOG_OLD.md).

Bei einer neuen Version bleibt hier nur der neueste Versionseintrag; der bisherige Eintrag wird nach [CHANGELOG_OLD.md](CHANGELOG_OLD.md) verschoben.

## License

MIT


