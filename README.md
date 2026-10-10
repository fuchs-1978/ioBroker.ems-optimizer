# ioBroker EMS Optimizer

Aktuelle Adapterversion: **0.17.0-alpha.68**. Diese deutsche Bedienungsanleitung beschreibt die Admin-Oberfläche dieses Stands. Der Adapter ist noch im Alpha-Stadium; GitHub-Veröffentlichung und Softwaretests sind keine vollständige reale Betriebsabnahme.

EMS Optimizer verbindet aktuelle PV-/Netzmessungen, historische Lastprofile, Wetter-/PV-Prognosen und Strompreise zu einem rollierenden 48-Stunden-Fahrplan. Der Echtzeitregler kann nach ausdrücklicher Freigabe bis zu drei Wallboxen, einen Warmwasser-Heizstab sowie getrennte vorbereitete Heizpuffer-/Speicherausgänge koordinieren. Die Wärmepumpe wird aktuell gemessen und erhält **passive Empfehlungen**; der Adapter sendet keine WP-/SG-Ready-/KNX-Stellbefehle. Die reale Wallbox-Phasenumschaltung übernimmt ein passend geprüftes externes Skript.

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
- [Changelog und historische Detaildokumentation](#changelog-und-historische-detaildokumentation)

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

Hier stehen die übergeordneten Freigaben und gemeinsamen elektrischen Grenzen. Geräte besitzen zusätzliche eigene Freigaben. Die physische Sicherung und Netzbetreiberbegrenzung können durch keine Priorität oder Mindestladung aufgehoben werden.

### Allgemeine Freigaben

| Feld / technischer Schlüssel | Auslieferung | Zweck und erwartete Eingabe |
| --- | --- | --- |
| Master-Freigabe für konfigurierte reale Ausgänge<br>`globalWriteEnabled` | AUS | Übergeordnete Freigabe für reale Stellbefehle. AUS bedeutet keine normale produktive Freigabe; EIN allein startet kein Gerät. Zusätzlich müssen Geräte-Regelfreigabe, jeweilige Ausgangsfreigabe, gültige Messwerte und Schutzbedingungen passen. Schattenmodell und Live-Regler getrennt betrachten. |
| ALPHA-Regelung für freigegebene Wallboxen und Warmwasser aktivieren (konkurrierende Stellskripte gestoppt)<br>`multiWallboxAlphaArmed` | AUS | Bewusste Freigabe der Alpha-Regelung für die freigegebenen Wallboxen und Warmwasser. Vorher konkurrierende Leistungs-/Freigabeschreiber stoppen. Ersetzt weder Master noch die Freigabe des einzelnen Ausgangs. |

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
| Datenpunkt EEBUS LPC.state<br>`lpcStateId` | leer | Objekt-ID des Zustands der EEBUS-Begrenzung aus dem EEBUS-Adapter. Zustand und zugehöriges Leistungsbudget zusammen zuordnen; kein manuelles Dauer-OK erzeugen. LPC betrifft Leistungsbezug, LPP die Erzeugungsseite. LPP ist optional und keine zusätzliche Ladestromfreigabe. |
| Datenpunkt EEBUS LPC.limit<br>`lpcLimitId` | leer | Objekt-ID des zugehörigen EEBUS-Leistungslimits in W. Nicht mit Status, Dauer oder Zähler verwechseln. Bei gleichzeitig aktivem §14a-Kontakt und LPC gilt das engere wirksame Budget; unbekannte relevante LPC-Rückmeldungen sind kein unbegrenztes Budget. |
| Optionaler Datenpunkt EEBUS LPP.state<br>`lppStateId` | leer | Objekt-ID des Zustands der EEBUS-Begrenzung aus dem EEBUS-Adapter. Zustand und zugehöriges Leistungsbudget zusammen zuordnen; kein manuelles Dauer-OK erzeugen. LPC betrifft Leistungsbezug, LPP die Erzeugungsseite. LPP ist optional und keine zusätzliche Ladestromfreigabe. |
| Optionaler Datenpunkt EEBUS LPP.limit<br>`lppLimitId` | leer | Objekt-ID des zugehörigen EEBUS-Leistungslimits in W. Nicht mit Status, Dauer oder Zähler verwechseln. Bei gleichzeitig aktivem §14a-Kontakt und LPC gilt das engere wirksame Budget; unbekannte relevante LPC-Rückmeldungen sind kein unbegrenztes Budget. |

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
| Rückblick der Historienauswertung<br>`historyDays` | 84 Tage | Gewünschter Rückblick für das Lernen typischer Lastprofile, in Tagen (7–365). Default 84 Tage. Unterscheidet sich von der 24-h-Diagnoseaufbewahrung. Nur tatsächlich vorhandene Historie ist nutzbar. |
| Historisierte Warmwasser-Heizleistung<br>`dhwHistoryId` | leer | Historisierte elektrische Gesamtleistung des Warmwasser-Heizstabs in W, für die Lernbasis. Nicht Speicherfühler, Sollleistung oder kWh-Zähler. Quelle muss in der gewählten Historieninstanz aufgezeichnet sein. |

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
| Maximale Wartezeit auf frische Reglerdaten nach Neustart<br>`wallboxRestartHandoffTimeoutS` | 180 s | Maximale Initialisierungswartezeit auf frische sichere Reglerdaten nach Neustart. Nach Ablauf ist kein unbegrenztes Weiterhalten erlaubt. |
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

### Eingangsdatenpunkte für Fahrzeug und Wallbox

| Feld / technischer Schlüssel | Auslieferung | Zweck und erwartete Eingabe |
| --- | --- | --- |
| Externer Mindest-SoC<br>`wb0MinSocId` | leer | Numerisches externes Mindest-SoC-Objekt in %, wenn SoC-Grenzen extern gewählt sind. Unter dieser Grenze besteht Ladebedarf auch mit Netzstrom, soweit Freigaben und Schutz passen. |
| Externer Ziel-SoC<br>`wb0TargetSocId` | leer | Numerisches externes Ziel-SoC-Objekt in %. Obere Ladegrenze. Priorität erzwingt kein Laden darüber hinaus; Ziel wird mindestens auf Mindest-SoC begrenzt. |
| EMS-Freigabe / socfrei<br>`wb0ReleaseId` | leer | Vorhandener Vergleichs-/Bedienwert socfrei: 0 gesperrt, 1 PV-flexibel, 2 historisch Pflichtladefall. Der EMS berechnet aktuelle SoC-Pflicht aus den gemappten SoC-Grenzen neu; ein stehengebliebenes 2 erzwingt nicht Netzladung bis Ziel. Bei manuellem Mindeststrom ist die Quelle weiter relevant. |
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
| Mindeststromstufen bei socfrei = 2 verwenden<br>`wb0LowSocStepsEnabled` | EIN | Aktiviert zusätzliche Mindeststromstufen für den niedrigen SoC/Pflichtladefall. Im parallelen Mindestbetrieb verwendet der EMS geschützte einphasige Mindestreservierungen; alte höhere Booststufen werden nicht zusätzlich als konkurrierende Reservierung gezählt. |
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

Planung und realer Speichervertrag unterscheiden. Der vorbereitete Produktivausgang erwartet den unten beschriebenen sunenergyxt500-Kopfvertrag; die Existenz eines beliebigen Batterieadapters reicht nicht. Alle Kopffelder konsistent zuordnen. DC-Planungsleistung ist keine AC-Stellbestätigung.

### Hausbatteriespeicher

| Feld / technischer Schlüssel | Auslieferung | Zweck und erwartete Eingabe |
| --- | --- | --- |
| Batteriespeicher vorhanden / in Planung berücksichtigen<br>`batteryPresent` | AUS | Kennzeichnet tatsächlich vorhandene Ressource für Planung/Diagnose. Bedeutet keine reale Regelfreigabe. Noch nicht eingebaute Geräte deaktiviert lassen; deren Nullplanung ist kein bestandener Gerätetest. |
| Regelfreigabe Batteriespeicher<br>`batteryControlEnabled` | AUS | Gerätespezifische Teilnahme an der Regelung; für reale Ausgangsbefehle sind Master, Ausgangsfreigabe, gültige Quellen und Grenzen zusätzlich nötig. Planung/Anzeige und reale Aktorsteuerung unterscheiden. |
| Begleiteten Speicherausgang freigeben: GS-Zuordnung, Vorzeichen, Treibermodi und konkurrierende Schreiber geprüft<br>`batteryProductionArmed` | AUS | Begleitete reale Speicherfreigabe erst nach Prüfung der Kopfzuordnung, GS-Vorzeichen, Treibermodi, Rückmeldungen und konkurrierenden Schreiber. Existierende Planung beweist keine reale Speicherabnahme. |
| Beschreibbarer sunenergyxt500.N.heads.H.control.GS (W: positiv = Entladung / negativ = Ladung)<br>`batterySetpointId` | leer | Beschreibbarer GS-Leistungsauftrag des gewählten sunenergyxt500-Kopfs in W: positiv entladen, negativ laden. Genau einen Kopf konsistent zuordnen; keine Gesamtanzeige als Stellregister. Unterstützter Treibervertrag ist spezifisch, nicht beliebiger Speicher. |
| Erforderliche AC-Leistungsrückmeldung: grid.GP des gewählten Kopfs oder total.gridPower bei einem Kopf (W, positiv = Entladung)<br>`batteryAcPowerId` | leer | Echte AC-Netzleistungsrückmeldung des zugeordneten Kopfs in W: positiv Entladung. grid.GP oder bei nur einem Kopf total.gridPower. Bei mehreren Köpfen nicht Gesamtleistung als Antwort eines einzelnen Auftrags verwenden. |
| Frischer Treiber-Zeitstempel / letzte erfolgreiche Aktualisierung<br>`batteryHeartbeatId` | leer | Frischer Treiber-Zeitstempel der letzten erfolgreichen Aktualisierung. Keine EMS-interne Jetzt-Uhr als vermeintlicher Treiberheartbeat eintragen. |
| Treiber-Verbindungsstatus (bestätigtes true erforderlich)<br>`batteryOnlineId` | leer | Bestätigter Treiber-Verbindungsstatus true. Muss zusammen mit Datenfrische und Betriebsmodus passen. |
| control.MM des gewählten Kopfs (bestätigtes false erforderlich)<br>`batteryManualModeId` | leer | control.MM desselben Kopfs. Unterstützter Vertrag verlangt bestätigt false; keine automatische Modusänderung durch diese Zuordnung. |
| control.LM des gewählten Kopfs (bestätigtes true erforderlich)<br>`batteryLocalModeId` | leer | control.LM desselben Kopfs. Unterstützter Vertrag verlangt bestätigt true. Lesen des Modus ist nicht dessen Aktivierung. |
| Optionaler Treiberfehler (0 / false = kein Fehler)<br>`batteryFaultId` | leer | Optionaler echter Treiber-/Gerätefehler: 0/false = kein Fehler. Zugeordnete Quelle muss gültig sein; fehlende Werte nicht als fehlerfrei umdeuten. |
| Optionale Batterietemperatur (°C; konfigurierte Quelle muss gültig sein)<br>`batteryTemperatureId` | leer | Optionaler Batterietemperaturfühler in °C für die zusätzliche Abschaltgrenze. Bei Konfiguration gültige Quelle erforderlich. |
| SoC-Datenpunkt<br>`batterySocId` | leer | Gemessener Speicher-SoC in % für Grenzen und Planung. Keine Fahrzeugquelle; Alter über eigenes SoC-Fristfeld. |
| DC-Batterieleistung für Historie/Planung (BP / total.batteryPower, W; keine GS-Rückmeldung)<br>`batteryPowerId` | leer | DC-Batterieleistung BP/total.batteryPower in W für Historie/Planung. Nicht mit AC-GS-Rückmeldung verwechseln; Verluste bedeuten, dass DC und AC nicht identisch sind. |
| Bisherige DC-Leistungskonvention (nie für GS-/AC-Rückmeldung verwendet)<br>`batteryPowerSign` | 1 | Vorzeichenkonvention ausschließlich der bisherigen DC-Planungsquelle gemäß angebotener Option. Beeinflusst niemals die feste GS-/AC-Konvention des realen Ausgangs. Auswahl: `1` = DC-Quelle positiv = Ladung (SunEnergy BP / total.batteryPower), `-1` = DC-Quelle positiv = Entladung. |
| Kapazität<br>`batteryCapacityKWh` | 10 kWh | Tatsächliche Speicherkapazität in kWh für Energie-/SoC-Planung. SoC-Nutzfenster reduziert die nutzbare Energiemenge. |
| Maximale Ladeleistung<br>`batteryMaxChargeW` | 2400 W | Getrennte maximale Lade-/Entladeleistung in W. Grenzen des tatsächlich angesteuerten Systems/Kopfs verwenden; keine Gesamtleistung mehrerer Köpfe einem einzelnen Ausgang zuschreiben. |
| Maximale Entladeleistung<br>`batteryMaxDischargeW` | 2400 W | Getrennte maximale Lade-/Entladeleistung in W. Grenzen des tatsächlich angesteuerten Systems/Kopfs verwenden; keine Gesamtleistung mehrerer Köpfe einem einzelnen Ausgang zuschreiben. |
| Bisheriger Wirkungsgrad je Richtung<br>`batteryEfficiencyPct` | 92 % | Bisheriger Wirkungsgrad je Richtung in %. Wenn kein eigener Round-Trip-Wert gesetzt ist, wird daraus der Zykluswirkungsgrad abgeleitet (z. B. 92 % × 92 % ≈ 84,6 %). Nicht mit Round-Trip-Prozent verwechseln. |
| Mindest-SoC<br>`batteryMinSocPct` | 15 % | Untere SoC-Grenze in % bei ausgeschalteter Temperaturreserve. Bei aktivierter Temperaturreserve ist dies der sichtbare Ersatzwert, solange noch keine gültige Prognoseauswahl vorliegt. Eine gültige temperaturabhängige Auswahl ersetzt diese operative Untergrenze; zusätzliche Planungsreserven können darüber liegen. |
| Maximaler SoC<br>`batteryMaxSocPct` | 100 % | Harte obere SoC-Grenze in %. Für normale Ladung maßgeblich; separates Netzlade-Maximum kann enger sein. |
| Morgendliches Ziel<br>`batteryMorningTargetPct` | 70 % | Planungsziel-SoC in % für morgens/nachmittags/späte Ladung. Ziele berücksichtigen erwartete PV und verfügbare Ladeleistung; keine garantierte tatsächliche Zielerreichung oder pauschale sofortige Netzladung. |
| Nachmittägliches Ziel<br>`batteryAfternoonTargetPct` | 90 % | Planungsziel-SoC in % für morgens/nachmittags/späte Ladung. Ziele berücksichtigen erwartete PV und verfügbare Ladeleistung; keine garantierte tatsächliche Zielerreichung oder pauschale sofortige Netzladung. |
| Spätes Ziel<br>`batteryLateTargetPct` | 100 % | Planungsziel-SoC in % für morgens/nachmittags/späte Ladung. Ziele berücksichtigen erwartete PV und verfügbare Ladeleistung; keine garantierte tatsächliche Zielerreichung oder pauschale sofortige Netzladung. |
| Reservezeit für die abschließende Ladung<br>`batteryReserveMin` | 45 min | Zeitreserve in Minuten für abschließende Ladung. Unterstützt die vorausschauende zeitliche Planung, nicht Mindest-SoC in Prozent. |
| Prognose-Sicherheitsfaktor<br>`batterySafetyPct` | 80 % | Sicher nutzbarer Anteil des prognostizierten restlichen PV-Überschusses in %. 80 % rechnet vorsichtiger als 100 %; nicht ein pauschaler Wirkungsgrad oder Score. |
| Für Eigenverbrauch entladen<br>`batterySelfConsumption` | EIN | Erlaubt geplante Entladung für Eigenverbrauch innerhalb SoC-/Leistungs-/Schutzgrenzen. Ohne real freigegebenen Ausgang bleibt dies Planung. |

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
| Totband<br>`deadbandW` | 100 W | Totband in W um den Netzsollwert. Innerhalb keine unnötige feine Korrektur; außerhalb können Ampere-Raster, Mindestlast und Antwortfristen dennoch Restabweichung verursachen. |
| Langsamer Regelzyklus<br>`slowCycleS` | 5 s | Langsamer Ziel-/Verteilungszyklus in s. Unterscheidet sich von schnelleren Ausgangs-/Speicherzyklen, Modbus-Pollzeit und Historienauflösung. |

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
| `Debug.Shadow.DecisionRecord` und Record-Fehler-/Verlustzähler | Historische zusammengehörige Diagnose mit Ereigniszeit, Sitzung und Sequenz; Live-/Schattenphase anhand gespeicherter Flags trennen. |

Ab alpha.62/.63 wird ruhige **Live-Diagnose** in 30-s-Intervallen zusammengefasst. Stellbefehle und relevante Zustands-/Qualitätswechsel bleiben unmittelbar. Ereignisse können bis 60 s Rohquellen-Vorlauf und 120 s dichteren Nachlauf erhalten. Puffergrenzen: 4096 Proben und 1 MiB. Überlauf und Schreib-/Queueverluste nicht als störungsfreien Abschnitt interpretieren. Ein Neustart kann unveröffentlichte Intervalle und Vorlauf verlieren.

`recording.interval` enthält beobachtete Anzahl, Min/Max/Mittel und Lücken, keine vollständige sekundengenaue Historie. `recording.pre_event` und ab alpha.64 `recording.sources` enthalten originale Quellenproben mit Quellenzeit, ACK/q und Empfangszeit, keine nachträglich erzeugten vollständigen historischen Reglerentscheidungen. Bei Replay Vollbasis suchen, Deltas rekonstruieren, Sitzungen/Sequenzen und Sample-Sequenzen deduplizieren. Eine reguläre 30-s-Quiet-Auflösung ist nicht automatisch eine 1-s-Sequenzlücke; echte Verluste müssen weiterhin geprüft werden.

Schattenaufzeichnung und bereits vorhandene SQL-Skalarhistorien sind durch diese Verdichtung nicht automatisch umgestellt oder gelöscht. Die Historieninstanz, tatsächliche Aufzeichnung und Aufbewahrung kontrollieren. Die Diagnoseänderung garantiert keine Behebung sporadischer SQL-/Connector-Timeouts und keine bestimmte RAM-/Datenmengenersparnis. Energie bevorzugt aus gültigen Zählerdifferenzen bestimmen; grobe Intervallmittel nicht als genaue Tagesenergie ausgeben. Fehlend, NULL, veraltet oder unbestätigt bedeutet unbekannt, nicht AUS/0 W.

Ab alpha.67 akzeptiert die zentrale Wallbox-Phasenbudgetprüfung dieselbe bestehende Leerlauftoleranz wie der Wallbox-Ausgang: bestätigte, frische, qualitativ gültige Leistungswerte zwischen −0,02 und 0 kW werden intern als 0 W behandelt. Die originale negative Rohmessung bleibt in der Diagnose erhalten. Größere negative Werte, fehlende/ungültige Werte, schlechtes q, fehlendes ACK und veraltete Quellen bleiben gesperrt. Diese Toleranz gilt für Wallboxleistung; die Verträge anderer Quellen werden dadurch nicht geändert.

## Changelog und historische Detaildokumentation

Die folgenden Abschnitte bleiben als Entwicklungsgeschichte erhalten. Angaben wie „ausschließlich nacheinander“, alte Timer, damalige Defaultwerte oder „nur Simulation“ beschreiben **den jeweiligen Versionsstand**, nicht pauschal alpha.67. Für aktuelle Bedienung gilt die Admin-Anleitung oben. Historische Detailbeispiele sind vor Verwendung mit aktuellem Code und eigenen Objekten abzugleichen.

## Neu in 0.17.0-alpha.67 – Ziel-SoC-Übergabe und Wallbox-Leerlauftoleranz

Ein reguläres Ladeende durch Ziel-SoC kann im Parallelbetrieb die qualifizierte Übergabe an das nächste berechtigte Fahrzeug vorbereiten. Ein zweiter vollständiger Starttimer entfällt nur nach unabhängig bestätigtem AUS und danach bestätigter elektrischer Ruhe des bisherigen Fahrzeugs sowie gültigem realem Startbudget und bestätigter Phase des Empfängers. Die tatsächliche Leistungsreserve wird nicht vorzeitig freigegeben. Gewöhnliche Starts behalten ihre eingestellte Verzögerung.

Eine abgeschlossene Ausgangsübernahme nach Neustart erhält einen begrenzten Nachweis für den aktuellen Prozess. Der Regler revalidiert diesen anhand der frischen Befehls- und elektrischen Antwort; gespeicherte Aktivflags allein qualifizieren keine verkürzte Übergabe. Der Nachweis wird in der produktiven Diagnose mitgeführt.

Beim EQE führte am 10.10.2026 ein gültiger Leerlaufwert von −0,01 kW um 10:46:29.623 zur ungültigen zentralen Zuteilung und zum EMS-AUS um 10:46:32.034 (Europe/Berlin). Der Wallbox-Ausgang akzeptierte die bereits bestehende −20-W-Toleranz, die zentrale Phasenbudgetprüfung dagegen nicht. Diese Prüfung verwendet jetzt dieselbe Wallbox-Normierung; Rohwert, Quellenqualität und Altersgrenzen bleiben erhalten, größere negative Werte bleiben ungültig. Die qualifizierte Übergabe hält ihr notwendiges logisches Mindestbudget auch während einer begrenzten Phasenvorbereitung. Ein passendes Modbus-Schreibecho ist keine Phasenbestätigung; EIN setzt weiterhin einen unabhängigen Phasen-ACK voraus. [Releasehinweise und Prüfpunkte](docs/releases/0.17.0-alpha.67.md).

## Neu in 0.17.0-alpha.66 – Ungenutzte Wallbox im Parallelbetrieb bestätigt AUS

Eine alte Leerlaufausnahme für den sequenziellen Betrieb war auch im Parallelmodus wirksam: Während ein ausgewähltes Fahrzeug bereits lud, konnte eine nachweislich abgesteckte andere Wallbox ihre physische Freigabe behalten. Beim späteren Anstecken konnte das Auto dadurch vor der nächsten Rückmeldung kurz laden, obwohl Benutzerfreigabe und EMS-Ziel AUS waren. Im Parallelbetrieb erhält diese ungenutzte Wallbox jetzt den vorhandenen bestätigten AUS-Ablauf; die laufende Ladung wird durch dessen vorübergehenden Besitz allein nicht gestoppt. Leistungsreserven bleiben bis zum frischen unabhängigen AUS-ACK und zur danach bestätigten elektrischen Ruhe erhalten.

Anlass war der Mii am 10.10.2026: erste positive Messung um 09:39:40 mit 1,32 kW, EMS-AUS um 09:39:42.145, unabhängiger AUS-ACK um 09:39:42.302 und erste aufgezeichnete elektrische Ruhe um 09:39:55.389/411 (Europe/Berlin). Die etwa 15-s-Pollauflösung belegt keine exakte physische Ladedauer. Der Ursprung der älteren physischen EIN-Freigabe ist weiterhin unbekannt; im untersuchten Ereignisfenster wurde kein EMS-EIN-Befehl gefunden.

Die Regressionen prüfen den vollständigen Parallel-Tick mit der ungenutzten Wallbox vor und nach dem aktiven Fahrzeug in der Geräteliste, verzögerte Bestätigung/Ruhe, erneutes Anstecken sowie Schreib- und Betriebsgrenzen. Die sequenzielle Ausnahme bleibt unverändert. Reale Abnahme erst nach manueller Installation anhand der Befehls-, ACK- und Leistungskette; keine zugesagten Scorepunkte. [Releasehinweise und Prüfpunkte](docs/releases/0.17.0-alpha.66.md).

## Neu in 0.17.0-alpha.65 – Direkte Prioritätsübergabe im Parallelbetrieb

Eine gültige manuelle Priorität kann bei knappem realem Budget eine optionale laufende Ladung kontrolliert an das bevorzugte berechtigte Fahrzeug übergeben. Der bisherige Ausgang erhält AUS, ohne erst Mindestlaufzeit oder PV-Mangel-Ausschaltverzögerung abzuwarten; seine gemessene bzw. reservierte Leistung bleibt jedoch bis zum frischen AUS-ACK und zur bestätigten elektrischen Ruhe gebunden. Bestehende Mindest-SoC-, Abfahrts- und manuelle Mindestbedarfe bleiben geschützt. Wenn das aktuelle gemeinsame Budget beide Fahrzeuge versorgen kann, wird keine zusätzliche Abschaltung allein für die Prioritätsänderung erzwungen.

Eine in dieser Sitzung mit realer Antwort vom inaktiven zum aktiven Zustand beobachtete EMS-Ladung kann ihre Startqualifikation für diesen begrenzten Wechsel übertragen. Das nächste Fahrzeug benötigt dann keinen zweiten vollständigen Start-Countdown; tatsächliches Budget, Startreserve, Quellenqualität, Freigabe und bestätigte Phase bleiben Voraussetzung. Ein laufender Cachewert nach Neustart liefert keine solche Qualifikation. Eine bereits gesetzte manuelle Priorität darf nach sicherer Übernahme des bisherigen Ausgangs trotzdem einen kontrollierten Wechsel anfordern; ohne beobachtete Startfolge gilt danach die volle Startverzögerung. Die Anforderung ist auf höchstens fünf Minuten begrenzt und wird bei unverändert gescheiterter Auswahl nicht ständig erneuert. Geänderte Priorität, fehlende oder veraltete Belege und verlorenes Budget widerrufen die Vorbereitung. Nach bestätigtem AUS wird die nächste Startphase mit dem freien realen Budget gewählt; ein erforderlicher 3P-/1P-Wechsel benötigt vor EIN seinen Modus-ACK. Die vorhandene Abschalt-/Fehlerverriegelung bleibt wirksam.

Diese Änderung bedeutet keine reale Übergabe-Abnahme und keine zugesagten Scorepunkte. Softwaretests prüfen den Ablauf mit verzögerten Rückmeldungen in der vorhandenen WB2-Testanlage; die reale EQV-Übergabe mit dieser Version bleibt offen. Nach manueller Installation muss die reale Befehls-, ACK-, Leistungs- und Phasenfolge erneut geprüft werden. [Releasehinweise und Prüfpunkte](docs/releases/0.17.0-alpha.65.md).

## Neu in 0.17.0-alpha.64 – Rohquellen bündeln, Recorder-Warteschlange entlasten

Dichte Live-Diagnose erstellt nicht mehr für jedes einzelne SMA-/go-e-Pollsignal einen vollständigen Cache-Datensatz. `recording.sources` bündelt originale Quellenproben bis etwa eine Sekunde oder eine Puffergrenze erreicht ist. Zeitstempel (`ts`, `lc`), Empfangszeit, ACK/q, NULL und Sample-Sequenz bleiben erhalten. Stellbefehle, wichtige Quellen-/Qualitätswechsel und Ausgangsbestätigungen bleiben unmittelbar. Vorereignisse verwenden ebenfalls größere begrenzte Gruppen, damit ein gültiger voller 4096-Proben-/1-MiB-Vorpuffer nicht bereits durch seine Aufteilung die 128er-Record-Warteschlange überfüllt. Zielgröße je Gruppe: 128 Proben oder 32 KiB Rohproben; eine einzelne größere Probe kann darüber liegen, der Vorpuffer bleibt insgesamt begrenzt.

Bereits als Rohgruppe abgegebene Proben werden bei überlappenden Ereignisfenstern nicht erneut als Vorlauf kopiert. Für den Vergleich von Stoppgründen werden veränderliche Zahlen ausgeblendet; die vollständigen Originalgründe bleiben in den Datensätzen erhalten. Semantische Gründe, Zustände, Frische-/Schutzwechsel und Timergrenzen bleiben erkennbar. Unversendete Rohgruppen werden beim Beenden als diagnostischer Pufferverlust gezählt; ein Neustart garantiert keinen gespeicherten Restpuffer. Persistierungs-/Queueverluste bleiben explizit. Diese Korrektur ändert keine Regelung, Schutzfristen, Stellbefehle oder SQL-Einstellungen. Reale RAM-Ersparnis und SQL-Abdeckung müssen nach Installation neu gemessen werden.

## Neu in 0.17.0-alpha.63 – langsame Diagnosequellen

Normale minuetliche Temperaturupdates loesen kein dauerhaftes dichtes Fenster aus. Reine Diagnose-Gap-Trigger unterscheiden schnelle Leistung-/Stellsignale (10 s) von sonstigen analogen Quellen (120 s); dies aendert keine operative Frist, Quellenvalidierung oder Schutzregel. ACK/q-/NULL-Wechsel und operative Frischegrenzen bleiben sofort sichtbar.

## Neu in 0.17.0-alpha.62 – ereignisorientierte Live-Diagnose

Produktive DecisionRecords werden im ruhigen Betrieb alle 30 Sekunden statt bei jedem Messupdate geschrieben. Befehle, Freigaben, ACK-/Qualitaetswechsel, Schutz- und Timergrenzen bleiben sofort sichtbar. Ein diagnostischer Ringpuffer (maximal 1 MiB / 4096 Samples) sichert bei Ereignissen bis zu 60 Sekunden vorherige rohe Quellenupdates; danach wird fuer 120 Sekunden dicht aufgezeichnet. Ueberlappende Vorlaeufe werden nach Sample-Sequenz dedupliziert. Neustarts erfinden keinen Vorlauf; Kapazitaetsverluste sind explizit markiert.

`recording.interval` enthaelt pro beobachteter Quelle Anzahl, ACK-/q-/Wert-gueltige und ungueltige Samples, numerisches Minimum/Maximum/Mittel, Originalzeitgrenzen und interne sowie Rand-Messluecken. Diese Stichprobenstatistik ist keine kontinuierliche Gueltigkeitsquote und keine Energieintegration. `recording.pre_event` enthaelt rohe Quellenbeobachtungen mit originalem `state.ts`, `lc`, ACK/q und Empfangszeit; es sind keine nachtraeglich beobachteten vollstaendigen Reglerentscheidungen. `sampling` beschreibt Aufloesung, Zeitfenster und Pufferverluste im Record. Alte Recordformate bleiben dekodierbar.

Regelung, Aktorbefehle, Schattenmodell und SQL-Einstellungen bleiben unveraendert. Aktive Regelvorgaenge mit vielen Befehlen koennen weiterhin dicht sein. Die Aenderung reduziert neue ruhige Aufzeichnungen; sie entfernt keine alten Daten und beweist weder die Ursache der Connector-Abbrueche noch eine reale Betriebsabnahme. Die bisherigen SQL-Skalarhistorien werden nicht umkonfiguriert.

## Neu in 0.17.0-alpha.61 – begrenzte Anzeige-Schreiblast

Grosse abgeleitete Forecast-/Plan-/Chart-JSONs behalten bei langsamer Persistierung nur einen laufenden Schreibvorgang und den neuesten wartenden Wert. Stellbefehle, Schutz-/Freigabewechsel, Reservierungen und DecisionRecords bleiben geordnet. Unveraenderte Diagnoseverlaeufe werden nicht erneut vollstaendig serialisiert; neue Ereignisse, ergaenzte Stoppgruende und Leistungspunkte bleiben erhalten. Die reale RSS-Ersparnis muss nach Installation gemessen werden; kein Nachweis eines behobenen Speicherlecks oder vollstaendigen 24-h-SQL-Abrufs.

## Neu in 0.17.0-alpha.60 – Stromantwort und sichere Ausgangsreservierung

Auch bei paralleler Mindestladung verwendet die laufende PV-Zuteilung die gemessene Fahrzeugleistung. Im Parallelbetrieb benötigen neue Stromerhöhungen ein frisches, ausreichendes Netzbudget und eine neue elektrische Antwort beziehungsweise einen ausdrücklich abgelaufenen Antwortzustand. Während einer offenen parallelen Antwort bleibt ein bereits gesendeter Befehl nur innerhalb der gemessenen Budget- und Schutzgrenzen erhalten. Echte Leistungsdefizite im Parallelbetrieb und sämtliche Hausanschluss-/§14a-/Gerätegrenzen reduzieren sofort. Quellenzeiten, Budgetbetrag und feste Antwortfrist stehen in der bestehenden Stromdiagnose und den DecisionRecords.

Die EHZ erhält den ersten Transportabschluss einer unveränderten Nullfolge; zyklische Nullbefehle verschieben ihn nicht. Eine Ausgangsreserve sinkt weiterhin erst nach unabhängig belegter voller Stellwirkung und späterer physischer Reduktion. Die historische, nie voll bestätigte 3-kW-Reserve wird durch einen NULL-Sollwert oder bloße Nullmessungen nicht automatisch freigegeben. Der Status nennt den fehlenden Nachweis. Das lesende Abrufwerkzeug archiviert begrenzte SQL-Fenster und prüft Sitzung, Sequenz, Vollbasis und Duplikate; unbekannte Daten bleiben unbekannt.

Die 117 historischen EQE-Befehle aus alpha.58 sind einzeln aufgearbeitet; der betroffene alpha.59-Codepfad wurde unverändert reproduziert. Vollständige Tageslesbarkeit, echte Regelruhe nach Installation und die reale alpha.59-Peer-Wechselabnahme bleiben offen. [Stromregelung](docs/issue123-current-response.md), [EHZ-Sicherheitsvertrag](docs/issue123-ehz-reservation.md), [SQL-Abrufgrenzen](docs/issue123-recorder-access.md). Keine automatische Installation oder Livefreigabe; Score unverändert 69/100.

## Neu in 0.17.0-alpha.59 – Begonnene Mindestladung erhalten

Eine bereits autorisierte, begonnene einphasige Mindest-SoC-Ladung behält ihr eigenes Mindestbudget, wenn ein anderes Fahrzeug seinen Mindest-SoC erreicht und noch Leistung während der Abschaltung reserviert. Die Reservierung gilt nur innerhalb der festen Befehls- und Fahrzeugreaktionsfristen. Sie verhindert den zusätzlichen Startabbruch durch diese weiche Budgetänderung. Ein neuer ON-Befehl oder eine Erhöhung wartet weiterhin auf die erforderlichen unabhängigen AUS- und elektrischen Rückmeldungen; Hausanschluss-, §14a-/Geräte- und Quellenprüfungen bleiben wirksam.

`Devices.Wallbox0/1/2.OutputStartReservation_JSON` und die produktiven DecisionRecords zeigen Startstufe und ursprüngliche Frist. Eine Reservierung beweist keine reale Ladeleistung. [Belegtes Ereignis, Regressionen und nächste SQL-Prüfung](docs/pending-minimum-start.md). Installation und reale Abnahme erfolgen getrennt.

## Neu in 0.17.0-alpha.58 – Temperaturquellen nachvollziehbar bewerten

Fehlende, veraltete, unbestätigte oder unplausible EHZ-Temperaturen werden als `null` statt als scheinbare 0 °C angezeigt. Ein bestätigter gültiger 0-°C-Wert bleibt 0. `Devices.MyPV_DHW.TemperatureValid` und `TemperatureSources_JSON` nennen die betroffene Quelle, Rohwert, Quellen- und Änderungszeit (`ts`/`lc`), Alter, ACK, Qualität und Fehlergrund. Die produktiven DecisionRecords erhalten die vollständige strukturierte Diagnose und unbekannte Werte auch im kompakten Replay. Reine Altersfortschreibung wird höchstens minütlich veröffentlicht; echte Quellen- und Qualitätswechsel sofort.

Ein unveränderter Sensorwert mit echter neuer Quellenbestätigung bleibt gültig. Der Adapter erneuert keine fremden Zeitstempel. Die vorhandenen Temperatur-, Verbindungs-, Hausanschluss- und §14a-Grenzen sowie Wallboxtimer bleiben maßgeblich. [Diagnosevertrag, Regressionen und nächste Betriebsprüfung](docs/temperature-source-diagnostics.md).

## Neu in 0.17.0-alpha.57 – Wärmepumpe und Admin vorbereiten

Der Reiter **Wärmepumpe** trennt normierte W-/kW-Leistungsmessung mit Messumfang, optionale Verbindungs-/dekodierte SG-Ready-Rückmeldung, passive SG-Ready-2/3/4-Empfehlungen und getrennte Heiz-/Kühlboostwünsche. MAX benötigt eine eigene Freigabe und höhere PV-Hysterese. REDUCED ist weiterhin keine Abschaltung; eine automatische Preissperre in Zustand 1 ist noch nicht implementiert. Unbekannte Messwerte bleiben null, nur bestätigte gültige Nullmessungen sind 0 W.

SG Ready 4 beeinflusst den Stiebel-Kühlbetrieb nicht. Ein eigener Kühlwunsch benötigt bestätigten Kühlbetrieb, frische Raum-/Taupunkt-/Vorlaufdaten, tatsächlichen PV-Spielraum und eine Taupunktgrenze. Boostwünsche verfallen bei ungültigen Daten, Master AUS oder aktiver/ungültiger Netzbetreiberbegrenzung. Für das gemeinsame §14a-/LPC-Restbudget ist eine gültige vollständige WP-Messung erforderlich; eine reine Invertermessung reicht nicht. Der gewöhnliche SMA-Netzfluss enthält den WP-Verbrauch bereits.

Alle WP-Ausgaben bleiben **interne Empfehlungen**; es wird kein ISG-/Modbus-/KNX-Ausgang geschrieben. Alle neuen Freigaben sind standardmäßig AUS. Ungeklärte Einheit und Kodierung von Register 4259 werden nicht geraten. [Admin, Diagnoseobjekte, Registergrenzen und nächste Betriebsprüfung](docs/heatpump-preparation.md). Softwaretests ersetzen keine reale WP-Abnahme.

## Neu in 0.17.0-alpha.56 – Netz-Mindestladung ohne Nachlauf beenden

Erreicht eine beobachtete Mindest-SoC-Ladung ihren Mindestwert und besteht kein weiteres nutzbares PV-/Preisbudget oder anderer Pflichtladebedarf, sendet der Produktivausgang AUS ohne die eingestellte Mindestlaufzeit oder Ausschaltverzögerung abzuwarten. Im Parallelbetrieb wird dafür der unabhängig ausgewiesene PV-Anteil verwendet; Pflichtnetzladung anderer Fahrzeuge ist kein PV-Nachweis. Eine vor der SoC-Kante berechnete Zuteilung wird erst nach dem nächsten normalen Budgettakt beurteilt.

Bei genügend PV oder einer anderen gültigen Ladepflicht wird weitergeladen. Nach belegter PV-Fortsetzung oberhalb Mindest-SoC behalten spätere Leistungsdellen die normalen Timer, beispielsweise 600 s. Ziel-SoC, Schutzgrenzen, AUS-Rückmeldung und elektrische Ruhe bleiben maßgeblich. Ein Neustart oberhalb Mindest-SoC erfindet keinen früheren Mindestabschluss. [Verhalten, Regressionen und nächste SQL-Prüfung](docs/minimum-grid-charge-end.md).

## Neu in 0.17.0-alpha.55 – Mindestladung während des Peer-Nachlaufs

Eine bereits bestätigte, laufende einphasige Mindest-SoC-Ladung behält ihr Mindestbudget, wenn ein anderes Fahrzeug seinen Mindest-SoC erreicht und während der Ausschaltverzögerung noch Leistung reserviert. Die auslaufende Wallbox darf ihre eingestellte Verzögerung durchlaufen; die weiterhin benötigte Mindestladung wird dadurch nicht ebenfalls zum Stopp gezwungen. Reale Hausanschluss-/§14a-/Gerätegrenzen und sämtliche offenen Leistungsreservierungen bleiben maßgeblich. Die Ausnahme gilt weder für neue Starts noch für unbestätigte Rückmeldungen oder Phasenwechsel. [Belegtes Nacht-Ereignis, Regressionen und nächste Betriebsprüfung](docs/parallel-minimum-retention.md). Keine automatische Installation oder zugesagten Scorepunkte.

## Neu in 0.17.0-alpha.54 – go-e-Stoppdiagnose und bleibende Sperre

Unabhängige, auf fünf Sekunden begrenzte Direktlesungen ergänzen go-e-Telemetriestopps und AUS-Timeouts im bestehenden Diagnosezustand und DecisionRecord. Quellenzeit, EMS-Empfang und Direktleseuhr bleiben getrennt; der Schutzstopp wartet nicht und der operative Cache wird nicht aufgefrischt. Spät bestätigtes AUS mit elektrischer Ruhe wird ausdrücklich als weiterhin gesperrt angezeigt. Keine automatische Entriegelung oder Fristverlängerung. [Prüfbericht und SQL-Abnahme](docs/issue116-goe-stop-diagnostics.md).

## Neu in 0.17.0-alpha.53 – Parallele Mindestladung und Prioritätsverteilung

Mehrere angeschlossene, freigegebene Fahrzeuge unter ihrem gültigen Mindest-SoC erhalten gemeinsam eine Grundladung, grundsätzlich 6 A einphasig. Danach bekommt das bevorzugte Fahrzeug die verfügbare Mehrleistung bis zu seiner wirksamen Grenze; nutzbarer Rest geht an die nächsten Fahrzeuge. Auch oberhalb des Mindest-SoC sind parallele PV-Ladungen bis zum jeweiligen Ziel-SoC möglich. Ohne Wärmebedarf kann das Fahrzeugbudget vollständig für die Autos verwendet werden. Explizite manuelle Mindestströme bleiben wirksam; die alten automatischen 10-/16-/25-A-SoC-Stufen werden in dieser Parallelpolitik nicht als gemeinsame Grundladung erzwungen.

Die neue Admin-Option **Wallboxen allgemein → Wallboxen parallel laden** ist im Paketstandard aktiviert. Bei ausgeschalteter Option gilt weiterhin der sequenzielle Betrieb. Eine alte Konfiguration ohne den neuen Wert verwendet den sequenziellen Fallback; den tatsächlich angezeigten Wert nach einer manuellen Installation prüfen. Master Control und Gerätefreigaben werden dadurch nicht aktiviert.

Gemeinsame Hausanschluss-/§14a-/Gerätegrenzen, offene Befehlsreserven und reale Phasen-/Fahrzeugantworten begrenzen jede Zuteilung. Eine Stromreduzierung gibt Leistung erst nach bestätigter elektrischer Antwort frei. Vor 1P→3P wird erforderlichenfalls zuerst der Strom gesenkt; eine noch zurückgehaltene Phasenanforderung startet keine neue Phasenhaltezeit. Heizstab-Eigenreserven und koordinierte Batterieanteile werden nicht doppelt vom gemeinsamen Budget abgezogen.

Prognose, isoliertes Schattenmodell und kompakte produktive DecisionRecords enthalten die gemeinsame Teilnehmerliste und Zuteilung. Positive Ziele sind kein Nachweis realer Ladung. [Einstellung, Beispiele, Diagnose und nächste Betriebsprüfung](docs/parallel-wallbox-charging.md). Keine automatische Installation; Softwaretests ersetzen keine reale Mehrfahrzeugabnahme und begründen keine Scorepunkte.

## Neu in 0.17.0-alpha.52 – Einheitlich 30 s für SMA-Netzquellen

Gesamtbezug/-einspeisung, die getrennten Bezugs-/Einspeiseleistungen von L1–L3 und der Hausanschluss-Stromfallback verwenden jetzt durchgehend höchstens 30 s Quellenalter. Wallbox-, EHZ- und Echtzeitregelung sowie die entsprechenden Produktiv-, Schutz- und Schattendiagnosen verwenden denselben Vertrag. Die optionale Speicher-/Heizpufferregelung und passive Wärmepumpenempfehlung verwenden für diese Netzquellen ebenfalls 30 s. Bisher galten für den Wallbox-Gesamtnetzwert bereits 30 s, für dessen Hausphasen jedoch 15 s und für den direkten EHZ-Netzregler 10 s; andere Verbraucher hatten wiederum eigene Grenzen. [Der Vertragsvergleich](docs/sma-source-freshness.md) weist diese getrennt aus.

Anlass war der belegte EQV-Stopp unter alpha.51 am 08.10.2026 um 10:21:04: L3-Bezug und -einspeisung waren laut EMS etwa 16 s alt und überschritten deren bisherige 15-s-Grenze. Die neue Grenze vermeidet ausschließlich diesen widersprüchlichen Frischevertrag. Fehlende, nichtnumerische, unbestätigte, qualitätsungültige, unplausible oder mehr als 30 s alte Netzquellen bleiben gesperrt; Quellenzeiten und bestehende Uhrtoleranzen werden nicht verändert. Geräte-, Phasen-ACK-, Fahrzeugreaktions- und Regeltaktfristen bleiben separat.

Bei Hausphasen-Quellenfehlern ergänzt der Wallboxausgang jetzt ebenfalls die vorhandene asynchrone ioBroker-Direktlesung. Sie dokumentiert Quellenzeit, ACK, Qualität und EMS-Empfang, ohne den operativen Cache zu erneuern oder eine Schutzentscheidung zu verzögern. Der Ursprung ausbleibender Updates bleibt offen; weder SMA-Sendestopp noch tatsächliche Überlast sind durch das Ereignis belegt. [Frischevertrag, Ereignis und nächste reale Prüfung](docs/sma-source-freshness.md). Keine automatische Installation oder Anlagenänderung; Softwaretests ersetzen keine Betriebsabnahme.

## Neu in 0.17.0-alpha.51 – Keine Ladepause durch eine belegbar abgesteckte Wallbox

Eine fremde Ladefreigabe einer abgesteckten Wallbox beendet eine bereits aktive, ausgewählte EMS-eigene Ladung nicht mehr, wenn frische reale Rückmeldungen eindeutig „kein Fahrzeug“ und elektrische Ruhe bestätigen. Die Ausnahme erfordert ACK und gültige Qualität, eine gültige Verbindung, Gerätefehlerstatus 0, höchstens 20 W Leistung und auf jeder Phase höchstens 0,5 A. Fahrzeugstatus, Leistung und alle Phasenströme müssen nach der tatsächlichen ON-Kante der fremden Freigabe beobachtet worden sein. Eine bloß modellierte Nullantwort genügt nicht.

Die abgesteckte Wallbox erhält in diesem eng begrenzten Fall auch keinen administrativen Abschaltauftrag, der die laufende Ladung anschließend über eine vorübergehende Eigentümerschaft sperren würde. Bei weiterhin bestätigter Freigabe und Anstecken, gemessener Last, veralteten oder unbekannten Ruhebelegen sowie offenen Peeraktionen gilt wieder die normale Sequenzverriegelung. Neue Starts benötigen weiterhin bestätigtes AUS und elektrische Ruhe der anderen Wallboxen. Start-, Stopp- und Mindestlaufzeiten sowie Schutzgrenzen bleiben erhalten.

Anlass war der reale EQV-Stopp am 08.10.2026 um 08:50:32 nach einer EQE-Freigabemeldung bei bereits bestätigtem „kein Fahrzeug“ und 0 W. Der Ursprung dieser Freigabemeldung ist weiterhin ungeklärt. [Ereignis, Prüfkriterien und Grenzen](docs/wallbox-idle-peer-release.md). Softwaretests ersetzen keine Betriebsabnahme; kein zugesagter Score-Anstieg und keine automatische Installation.

## Neu in 0.17.0-alpha.50 – Rekonstruierbare kompakte SQL-Diagnose

Der produktive DecisionRecord verwendet Schema 3: Ein vollständiger Snapshot eröffnet jede Aufzeichnungssitzung; während laufender Aufzeichnung liefert der nächste Record nach Ablauf des 30-s-Intervalls wieder eine vollständige Basis. Dazwischen tragen kompakte Deltas die Änderungen. Befehlsversuche, Transportabschlüsse und Quellenereignisse werden weiterhin einzeln aufgezeichnet; der 1-s-Heartbeat bleibt erhalten. Quellenzeitstempel, ACK, Qualität, NULL-Werte, Timer und Masterwechsel bleiben rekonstruierbar. Die Zahl der Records wird dadurch nicht pauschal reduziert; das Ziel sind kleinere Nutzdaten pro Zwischenrecord.

Die Auswertung muss die Records in Sitzungs- und Sequenzfolge rekonstruieren. Eine Sequenzlücke oder fehlende Basis macht die betroffenen Deltas unbekannt, bis der nächste vollständige Snapshot eine neue Basis liefert. Nach Queueverlust oder Schreibfehler erzwingt der Recorder einen neuen vollständigen Snapshot. Das Schattenformat Schema 1 bleibt unverändert; bestehende volle Schema-2-Records bleiben lesbar.

Das lesende Werkzeug `npm run decode:records -- <export.json>` rekonstruiert einen vorhandenen JSON-Export in vollständige Schema-2-Records und kennzeichnet nicht rekonstruierbare Stellen. Es öffnet keine Datenbank und verändert keine SQL-Einstellungen. [Format, Replay und nächste SQL-Prüfung](docs/compact-decision-records.md). Die Ursache der bisherigen SQL-Zugriffsfehler ist damit nicht bewiesen oder behoben; Softwaretests ersetzen keine reale Abnahme und begründen keine Scorepunkte. Keine automatische Installation oder Änderung der Anlagensteuerung.

## Neu in 0.17.0-alpha.49 – Quellenverträge und produktive Aufzeichnung

`protectionFeedback.gridImport/gridExport` verwendet jetzt denselben 30-s-Vertrag wie der operative Wallboxausgang und die produktive Messwertdiagnose. Die unabhängigen Felder `dhwGridImport/dhwGridExport` benennen den weiterhin geltenden 10-s-Vertrag des direkten EHZ-Netzreglers samt seiner Abschaltfolge. Hausphasen-, Geräte- und Anschlussgrenzen bleiben erhalten. Aus der alten Schutzdiagnose folgt keine reale 10-s-Wallboxabschaltung unter alpha.48.

Der Vergleich unveränderter Produktivsnapshots ignoriert nur die Snapshotuhr und aus Quellenzeitstempeln ableitbare Alter. Der vollständige Record enthält diese Felder weiterhin. Quellenzeitstempel, Timeränderungen, Gültigkeitswechsel und alle Befehls-/Rückmeldeereignisse bleiben erhalten; unveränderte Frames werden weiterhin mindestens einmal pro Sekunde aufgezeichnet. Keine neue Delta-Datenstruktur und keine Unterdrückung zyklischer Nullbefehle.

Die lesende Diagnose zu [#110](https://github.com/fuchs-1978/ioBroker.ems-optimizer/issues/110) hat 15 Records von zusammen 512.990 UTF-8-Bytes mit begrenzter Pagination erneut gelesen. Die Ursache der früheren SQL-Zugriffsfehler bleibt offen. Die EHZ-Restreserve mit unbeobachteter Stellwirkung wurde reproduziert und nicht spekulativ gelöscht. [Belege, Regressionen, Grenzen und nächste Tagesprüfung](docs/issue110-recorder-source-contracts.md). Keine Installation oder Änderung produktiver Einstellungen; Softwaretests ersetzen keine reale Abnahme.

## Neu in 0.17.0-alpha.48 – SMA-Quellendiagnose beim Messwertfehler

Beim Verwerfen von Gesamt-Netzbezug/-einspeisung ergänzt der reale Wallboxausgang die Fehlermeldung um Objekt-ID, Wert, Quellenzeit `ts`, letzte Wertänderung `lc`, ACK, Qualität, Alter und den im EMS beobachteten Empfangszeitpunkt. Pro zusammenhängendem Fehlerereignis wird jede betroffene Quelle einmal zusätzlich direkt aus ioBroker gelesen, mit maximal 5 s Wartezeit außerhalb der Steuerungssequenz. Ergebnis und Dauer erscheinen anschließend in einer ergänzenden Logmeldung und dem zugehörigen Abschaltgrund. Eine verspätete Antwort überschreibt kein späteres Ereignis.

`Devices.WallboxN.LastStopSourceDiagnostics_JSON` enthält den ursprünglichen Cache-Snapshot, Empfangsart (`stateChange` oder initiales Einlesen), Prüfuhrzeit, direkte Antwort sowie den Cache-Stand bei Abschluss. Die Diagnose steht auch im produktiven DecisionRecord. Die Zusatzlesung fragt ioBroker ab, nicht den SMA-Sender, und erneuert keine operative Cache-Frische. Schutzabschaltung und 30-s-Altersgrenze bleiben erhalten. [Datenweg, Interpretation und reale Prüfpunkte](docs/sma-source-diagnostics.md). Keine automatische Installation oder Änderung produktiver Einstellungen.

## Neu in 0.17.0-alpha.47 – SMA-Netzwerte mit 30-s-Altersgrenze

Der reale Wallboxausgang akzeptiert Gesamt-Netzbezug und -einspeisung bis einschließlich 30 s Quellenalter statt 10 s. Phasenbudgetprüfung und produktive Diagnose verwenden dieselbe Grenze. Anlass war am 07.10.2026 um 15:14:22 ein EQV-Schutzstopp wegen 12 s altem SMA-Einspeisewert. Auf ausdrücklichen Nutzerauftrag wird eine solche kurze Aktualisierungslücke toleriert; die Ursache des ausgebliebenen Updates ist damit nicht behoben. Nach mehr als 30 s bleiben die Werte ungültig. ACK-false, schlechte Qualität, fehlende/nichtnumerische oder zukünftige Werte erhalten keine neue Freigabe.

Geändert wird ausschließlich die Altersgrenze der zwei Gesamtnetzquellen. Die unabhängigen Hausanschluss-Phasenprüfungen, Wallboxmessungen, Regelzyklus- und Kommunikationsfristen bleiben erhalten. Kein nachträgliches Erfinden von Daten und keine Änderung der SQL-Historie. Mit einem älteren Wert kann das Momentanbudget inzwischen abweichen; nächste reale Prüfung: Aktualisierungslücken, Quellenalter und zugehörige Befehls-/Netzantwort zeitlich vergleichen. Keine automatische Installation.

## Neu in 0.17.0-alpha.46 – Startphase vor der Leistungsübergabe wählen

Eine ausgewählte, angeschlossene und freigegebene EMS-Wallbox mit bestätigtem AUS, elektrischer Ruhe und abgeschlossenem Ausgangsbesitz wählt vor dem Start die nutzbare Phase nach gültigem Echtzeitbudget. Reicht es für 1P samt Startreserve, aber nicht für die 3P-Mindestleistung samt Reserve, wird unmittelbar 1P angefordert. Die 120-s-Abwärtsqualifikation und die Mindesthaltezeit für laufende Phasenwechsel verzögern diesen vorbereiteten Start nicht. Die reale Modus-ACK bleibt erforderlich; ein Schreibecho startet kein Auto. Bei hohem Budget über der nutzbaren 1P-Kapazität plus Reserve darf 3P vorbereitet werden.

Eine qualifizierte Fahrzeugübergabe kann weiterhin die allgemeine Startverzögerung umgehen, braucht aber bestätigtes AUS und elektrische Ruhe des bisherigen Fahrzeugs. Ein Kaltstart behält seine normale Einschaltverzögerung. Pflicht-/Preisfreigaben, feste bzw. externe Phasenführung und laufende Wechsel behalten ihre bisherigen Regeln. [Grenzen und reale Prüfpunkte](docs/wallbox-start-phase-preparation.md). Keine automatische Installation oder Aktorschaltung.

## Neu in 0.17.0-alpha.45 – Zurückgenommene Stromschritte blockieren nicht dauerhaft

Wird eine noch offene Stromerhöhung durch einen niedrigeren Befehl ersetzt, wird ihr alter elektrischer Schrittnachweis jetzt sofort verworfen. In alpha.44 konnte beispielsweise ein zurückgenommener 10-A-Schritt weitere Erhöhungen bei bestätigten 9 A blockieren. Nach ACK und frischer elektrischer Antwort des Ersatzbefehls darf der EMS bei ausreichendem gemessenem Budget wieder einen einzelnen Schritt versuchen. Eine unveränderte Aufnahme nach diesem neuen Schritt erlaubt weiterhin keine wiederholten Erhöhungen; Schutzgrenzen und Antwortfristen bleiben erhalten.

Regressionen reproduzieren die Befehlsersetzung während der ACK-Verarbeitung und eine harte Begrenzung vor der ACK. [Reale Prüfpunkte](docs/wallbox-measured-current-step.md#korrektur-in-alpha45). Keine automatische Installation oder Änderung produktiver Einstellungen.

## Neu in 0.17.0-alpha.44 – Gemessener Überschuss für laufende Wallboxen

Eine laufende PV-Ladung kann bei gültigen realen Rückmeldungen einen zusätzlichen Ampere-Schritt erhalten, wenn das gemessene Restbudget diesen Schritt deckt, aber die bisherige vollständige Nennleistungsprüfung ihn blockiert. Bei 1P werden 230 W, bei 3P 690 W zusätzlich zur gemessenen laufenden Leistung reserviert. Der Verteiler berücksichtigt diese Reserve auch beim EHZ-Restbudget. Weitere Erhöhungen brauchen eine frische Strom-ACK und eine danach gemessene elektrische Zunahme; eine unveränderte Fahrzeugaufnahme erlaubt kein wiederholtes Hochregeln. Normale Rampen bei ausreichend nominal gedecktem Budget bleiben erhalten.

Hausanschluss-, Geräte- und gemeinsame §14a-/LPC-Grenzen bleiben nominal abgesichert. Starts, Preis-/Pflichtladung, unbestätigte Phasenwechsel und idealisierte Schattenantworten erhalten keine neue Messwertausnahme. `Devices.WallboxN.IncreaseBudget_JSON` und der produktive DecisionRecord zeigen Rechenbasis und offene Schrittantwort. [Befund, Grenzen und nächste reale Prüfung](docs/wallbox-measured-current-step.md). Keine automatische Installation; Softwaretests ersetzen keine reale Abnahme.

## Neu in 0.17.0-alpha.43 – Phasenwahl mit Echtzeitbudget

Im EMS-Phasenmodus berücksichtigt die ausgewählte Wallbox das gültige reale Leistungsbudget einschließlich der bereits laufenden Ladung. Ein ausreichend nutzbares 1P-Budget unter der 3P-Mindestleistung muss durchgehend bestehen, bevor 1P angefordert wird. Für 3P muss das Budget über der nutzbaren 1P-Kapazität plus Reserve liegen. Die getrennten Admin-Verzögerungen betragen standardmäßig 120 s abwärts und 300 s aufwärts; die vorhandene Mindesthaltezeit bleibt zusätzlich wirksam. Datenlücken und offene Phasenübergänge setzen den Nachweis zurück. Eine qualifizierte Echtzeitentscheidung hat im Livebetrieb Vorrang vor der Prognose; feste Phasen und externe Skriptführung behalten ihre Zuständigkeit.

`Control.WallboxN.PhaseDecision_JSON`, `PhaseDecisionStatus` und `PhaseDecisionRemaining_s` erklären Budget, Schwellen und Wartezeiten. Die Entscheidung steht außerdem im bestehenden `AllocationDiagnostics_JSON` für den DecisionRecord. Während eines Topologiewechsels wird die alte gemessene Last weiter reserviert; ein 3P-Messwert wird nicht als Antwort auf einen noch unbestätigten 1P-Befehl gerechnet. Negative Stromschritte außerhalb des Totbands führen nun bereits bei weniger als einem ganzen Ampere Leistungsdefizit zu einer passenden Reduktion.

[Reproduktion und reale Prüfpunkte](docs/wallbox-real-phase-budget.md). Keine automatische Installation oder produktive Einstellungsänderung. Die konservative Nennleistungsprüfung des realen Wallboxausgangs bleibt bestehen; verfügbare Nettoeinspeisung allein garantiert deshalb keinen zusätzlichen Ampere-Schritt.

## Neu in 0.17.0-alpha.42 – Leistungsübergabe und Abstecken

Im 50/50-Kombibetrieb reserviert der Verteiler die nächste erlaubte Wallbox-Ampere-Stufe vor der Erhöhung. Der EHZ erhält ein entsprechend kleineres Restbudget und reduziert zuerst; die Wallbox erhöht erst nach ausreichend gemessenem Netzbudget. Eine geplante Reduktion ersetzt keine gemessene Stellwirkung. Bei Rücknahme eines Wallboxbefehls bleibt ihre reale Last weiter reserviert. `Control.WallboxN.AllocationDiagnostics_JSON` enthält `increaseReserveW` und `increaseNextA`.

Ein frisch bestätigtes Abstecken eines in derselben Sitzung qualifiziert beobachteten Ladeauftrags kann die Startbereitschaft an die nächste zulässige Wallbox weitergeben, auch über die kurze leere Auswahl während der Abschaltung. Bestätigtes AUS, elektrische Ruhe, gültige Quellen und ausreichendes Budget bleiben erforderlich. Die Bereitschaft hat eine feste, aus ACK-/Reaktionsfristen begrenzte Laufzeit; Lücken, ungültige Quellen, erneutes Anstecken oder Neustart verwerfen sie. Normale Erststarts behalten ihren Timer. Die letzte Phasenstellung wird beim Abstecken nicht automatisch zurückgesetzt.

Softwaretests ersetzen keine reale Abnahme. Keine produktive Konfiguration oder Installation wird automatisch geändert.

## Neu in 0.17.0-alpha.41 – Erwartete go-e-Phasenpause

Während eines angeforderten EMS-Phasenwechsels gilt das passende `ack=false`-Schreibecho innerhalb der bestehenden Bestätigungsfrist als Übergang. Die letzte bestätigte Phasenstellung bleibt getrennt von der angeforderten Stellung. Der bestehende Ladeblock und seine Laufzeit bleiben während der normalen Nullleistungspause erhalten; ein zusätzlicher Fehlerstopp und eine dadurch neu gestartete Einschaltverzögerung entfallen.

Die Berechnung schützt konservativ beide möglichen Phasenstellungen und deren kleinere Stromgrenze. Nach einer echten Modus-ACK werden frische Strom-/Leistungsmessungen separat geprüft. Fehlende unabhängige Strombefehls-ACKs, Gerätefehler, Freigabeentzug, Zeitüberschreitungen und harte Grenzen bleiben wirksam. Ein Modus-ACK beweist keinen abgeschlossenen elektrischen Phasenwechsel. Details: [Phasenübergang](docs/wallbox-phase-transition.md).

## Neu in 0.17.0-alpha.40 – Wallboxstart anhand gemessenen Netzbudgets

Eine EHZ-Soll-Ist-Abweichung allein sperrt Wallboxstart und Stromerhöhung nicht mehr. Im Kombibetrieb werden gültige reale Heizstabmessungen und das gemessene verbleibende Netzbudget geprüft; explizite Pflicht-/Preisfreigaben sowie Hausanschluss-, Phasenreserve- und Netzbetreibergrenzen bleiben wirksam. Das Budget wird auch während der Startsequenz vor der Ladefreigabe erneut geprüft. Die Änderung bestätigt weder einen Heizstab-Stellbefehl noch dessen Abschaltung.

## Neu in 0.17.0-alpha.39 – EHZ-Wiederaufnahme bei stabiler Leistungsabweichung

Am 07.10.2026 blieb der EHZ trotz Einspeisung bei 3.394 W Befehl stehen: Die gültige Ausgangssumme lag stabil rund 335–351 W darüber und überschritt die normale 300-W-Toleranz. Nach dem Timeout hielt der Regler bisher unbegrenzt denselben Befehl.

Die Wiederaufnahme verlangt mindestens drei neue gültige Messsätze über mindestens 15 Sekunden (oder die längere konfigurierte Rückmeldefrist). Nur positive Abweichungen bis 15 % des Befehls, maximal 600 W, kommen infrage; die normale Toleranz bleibt unverändert. Messwerte müssen innerhalb 100 W des ersten Werts bleiben, Messlücken über 30 Sekunden setzen den Nachweis zurück. Jede Änderung des Befehls verlangt neue Evidenz. Die Erhöhung bleibt auf die normale Rampe begrenzt und ist keine Stell- oder Stillstandsbestätigung. Budget, Temperatur, Hausanschluss, §14a und Rückgabeprüfungen gelten weiterhin.

[Reproduktion und reale Abnahmepunkte](docs/ehz-stable-deviation.md). Die Ursache der Geräteabweichung ist weiterhin offen. Keine automatische Installation und keine zugesagten Scorepunkte.

## Neu in 0.17.0-alpha.38 – Produktive Diagnose und prüfbarer Phasenvertrag

Diese Alpha übernimmt [PR #99](https://github.com/fuchs-1978/ioBroker.ems-optimizer/pull/99) zu Tages-Issue #98:

- Der vorhandene DecisionRecord erfasst bei produktiver Freigabe Sitzung/Sequenz, Budget und Timer, Befehls-ID/-zeit, Transportergebnis, ACK/q/Quellenzeit sowie Fahrzeug- und elektrische Rückmeldungen. Die beabsichtigte Schattenmodellpause bleibt von fehlender Realtelemetrie getrennt; unbekannte Werte bleiben unbekannt.
- Die Diagnose der skriptgenerierten PV-Summe folgt deren Quellenvertrag und zeigt ACK=false ausdrücklich. Andere Quellenprüfungen bleiben wirksam. Statusmeldungen benennen eine aktive Produktivfreigabe.
- Ein standardmäßig deaktiviertes Phasenfolge-Beispiel prüft den Master und verlangt frische ACK=true/q=0-Rückmeldung nach dem Befehl. Es ersetzt oder aktiviert kein laufendes Skript. Bis zur geprüften lokalen Umsetzung gilt: zuerst Phasenskript AUS, danach Master AUS.
- Regressionen reproduzieren die alpha.37-Zeitprüfung und parallel laufende Mindestlauf-/Stoppzeit. Reglerstrategie, Timer und Schutzgrenzen bleiben unverändert.

[Belege, Reproduktion, Aufnahmegrenzen und SQL-Prüfpunkte](docs/issue98-live-diagnostics.md) beschreiben die nächste Tagesanalyse. Mehr Records verursachen zusätzliche SQL-Last; dauerhafte Speicherung und reale Lade-, Heiz-, Übergabe- und Phasenabnahme sind noch nachzuweisen. Softwaretests versprechen keine Scorepunkte. Ein Update aktiviert keine Freigaben.

## Neu in 0.17.0-alpha.37 – Schutzprüfungen und nachvollziehbare Schatten-Zeitzuordnung

Diese Alpha bündelt die Korrekturen aus [PR #93](https://github.com/fuchs-1978/ioBroker.ems-optimizer/pull/93)
und [PR #96](https://github.com/fuchs-1978/ioBroker.ems-optimizer/pull/96):

- Warmwasser benötigt plausible Temperaturen, eine gültige Hysterese und einen bestätigten inaktiven Hausanschlussschutz. Die Prüfungen greifen auch vor wartenden positiven Stellbefehlen.
- Wetter-/PV-Quellen werden auf Bestätigung, Qualität und Veröffentlichungsalter geprüft. PV-Flächen werden nach Lieferzeit zugeordnet. Fehlende SQL-Subtraktionswerte bleiben unbekannt; Hauslast und bereinigte Grundlast werden getrennt auf ausreichende Daten geprüft.
- Die Schatten-Netzzeit folgt der positiven Netzrichtung. Mehrere zeitversetzte Wallbox-Korrekturen werden gemeinsam geprüft; Quellenzeitpunkte und Korrekturbeträge stehen im DecisionRecord.

Für den nächsten täglichen Probelauf sind die Vergleichskriterien in
[Schatten-Zeitzuordnung und Tagesauswertung](docs/shadow-timing-daily-review.md)
beschrieben. Die Versionsanzeige wird beim Start auf alpha.37 aktualisiert.
Die praktische Fahrzeugübergabe, Phasenprüfung und Liveabnahme bleiben offen;
Softwaretests erhöhen den Tages-Score nicht automatisch. Produktive Freigaben
werden durch das Update nicht aktiviert.

## Neu in 0.17.0-alpha.36 – Qualifizierte Fahrzeugübergabe ohne zweiten Starttimer

Wechselt eine in dieser Adapter-Sitzung bestätigte EMS-Ladung durch eine gültige manuelle Priorität oder das erreichte Ziel-SoC auf das nächste geeignete Fahrzeug, kann dessen erneuter allgemeiner Einschalt-Countdown entfallen. Bei der Vorbereitung muss das Budget Mindestleistung plus Startreserve decken; anschließend müssen Mindestleistung, gültige Quellen und unveränderte Phasen-/Preisberechtigung durchgehend bestehen. Die Vorbereitung läuft nach höchstens fünf Minuten ab und verfällt bei Daten-, Budget- oder Auswahlverlust. Ein Neustart oder eine fremde Bestandsladung liefert keine solche Startqualifikation. Normale Erststarts behalten die eingestellte Verzögerung.

Die neue Wallbox startet weiterhin erst nach bestätigtem AUS und frischer elektrischer Ruhe der alten, mit bestätigter Phasenstellung und der regulären 6-A-/Freigabe-/Fahrzeugantwort-Sequenz. Die Totzeit der Rückmeldungen und die Reaktion des Autos wird dadurch nicht übersprungen. Das Schattenmodell verwendet für die Qualifikation ausschließlich seine ausdrücklich gültige private Antwort des aktuellen Zyklus. Eine unbekannte Modellantwort wird in der Ausgangsdiagnose als solche benannt und nicht als reale Restlast ausgegeben.

`allocation.WallboxN.start.vehicleHandoff` im DecisionRecord erklärt Vorbereitung, Ablehnung, Ziel und feste Frist. Softwaretests und modellierte Antworten ersetzen keine Liveabnahme oder neue SQL-Betriebsbelege für den Score. Details: [Fahrzeugübergabe in alpha.36](docs/wallbox-handoff-alpha36.md).

## Neu in 0.17.0-alpha.35 – Manuelle Priorität wechselt das Fahrzeug

Eine gültige manuelle Auswahl `prio = 0 / 1 / 2` wählt das freigegebene Fahrzeug Mii / EQV / EQE auch dann aus, wenn eine andere Wallbox bereits vom EMS geladen wird. Sie steht vor der automatischen Mindest-SoC-/Abfahrtsreihenfolge und der Mindestlaufzeit der bisherigen Ladung. Ohne gültige manuelle Auswahl bleibt die automatische Auswahl mit ihrem Schutz gegen unnötige Wechsel erhalten.

Die Übergabe bleibt sequenziell: Die alte Wallbox erhält AUS; die neue startet erst nach frischer AUS-Rückmeldung und bestätigter elektrischer Abschaltung. Alle Budget-, Quellen-, Phasen-, Preis- und Sicherheitsprüfungen gelten weiterhin. Ab alpha.36 entfällt die erneute allgemeine Einschaltverzögerung ausschließlich bei einer gültig qualifizierten Fahrzeugübergabe. Eine abgesteckte, nicht freigegebene oder fertige bevorzugte Wallbox verdrängt keinen gültigen Ladeauftrag. Leere, fehlerhafte oder ungültige Prioritätswerte wählen nicht versehentlich WB0.

`Control.WallboxSelectionReason` und `selectionReason` im Schatten-DecisionRecord erklären die Auswahl und einen laufenden Wechsel. Eine bewusst angeforderte Übergabe ist damit von einer internen Budgetpause unterscheidbar. Details: [Manuelle Priorität und Übergabe](docs/wallbox-priority-alpha35.md).

## Neu in 0.17.0-alpha.34 – Bestätigte Wallbox-Abschaltung und kurze Sequenzsperren

- Eine bereits bestätigte virtuelle Abschaltung wird noch im selben Zyklus abgeschlossen. Eine kurze Freigabe der abgesteckten Mii löst dadurch bei gültiger Nullantwort keine unnötige EQE-Unterbrechung mehr aus.
- Im realen Ausgang sind AUS-Bestätigung und elektrische Abschaltung getrennt: Erst frische Leistung bis 20 W und Phasenströme bis 0,5 A bestätigen das Ende der Last. Bis dahin bleiben Verriegelung und Leistungsreserve bestehen; ein bestätigter AUS-Befehl wird nicht ständig wiederholt.
- Nach einer kurzen Peer-Sequenzsperre kann dieselbe zuvor aktive, durchgehend budgetbereite Ladung ohne erneute vollständige Einschaltverzögerung fortgesetzt werden. Die Bereitschaft ist zeitlich begrenzt und verfällt bei Daten-/Budgetlücken, anderer Auswahl, Phasen- oder Preisänderung und Fehlern. Normale Erststarts behalten ihre Startbedingungen; alpha.36 ergänzt eine begrenzte Ausnahme vom allgemeinen Starttimer für qualifizierte Fahrzeugwechsel.
- `SequenceResumePending`, `SequenceResumeUntil`, `StopConfirmedAt` und `StopPowerPending` erklären die Übergabe in den Diagnoseobjekten; das DecisionRecord enthält die entsprechenden modellierten Felder. Modellbestätigungen bleiben ausdrücklich angenommen, ungültige Schattenantworten bleiben unbekannt.
- Eine explizite `.npmignore` beseitigt `gitignore-fallback` und schließt Entwicklungstests sowie lokale private Dateien aus dem Installationspaket aus. Andere npm-Warnungen zu Git-Integrität oder Installationsskripten werden dadurch nicht behoben.

Es bleibt bei einer aktiven Wallbox im Sequenzbetrieb. Diese Version ergänzt keine überlappende Zwei-Fahrzeug-Ladung, aktiviert keine Freigaben und ersetzt keine begleitete reale Abnahme. Details: [Übergabe und Wiederaufnahme](docs/wallbox-handoff-alpha34.md).

## Neu in 0.17.0-alpha.33 – Wärmebedarf und Wallbox gemeinsam planen

Eine notwendige Nachheizung reserviert im 48-Stunden-Fahrplan jetzt den tatsächlich benötigten Wärmeanteil. Verbleibende PV kann im selben Viertelstundenfenster eine freigegebene Wallbox versorgen. Bisher konnte ein kleiner Fehlbetrag an der Warmwasserreserve den gesamten PV-Anteil dem Heizstab zuordnen und die Wallbox im Plan auf null setzen.

Der Plan baut zusätzlich aus PV eine begrenzte Reserve für den angenommenen Wärmeverbrauch der nächsten Stunde auf. Dieser zusätzliche Anteil erhält bei ausreichender Leistung die Mindestladeleistung der ausgewählten Wallbox und verursacht keinen zusätzlichen Netzbezug. Eine wirklich kalte obere Speicherschicht und die benötigte Mindestreserve bleiben vorrangig. Reicht die verbleibende PV nicht für die bestätigte Phasenzahl und den Mindeststrom, bleibt eine Ladepause weiterhin möglich und erklärbar.

Die Zuteilungsdiagnose unterscheidet benötigte Wärme, deren PV-/Netzanteile, zusätzlichen PV-Reserveaufbau und das danach verfügbare Wallboxbudget. Fehlende Strompreise erlauben keine Netz-Nachheizung; gültige Speicherwerte können trotzdem den notwendigen PV-Wärmevorrang begründen. Speichergrenzen, Ampere-Stufen, Ziel-SoC und Preisfenster bleiben berücksichtigt.

Die Änderung betrifft die Prognose. Einstellungen, Gerätefreigaben und Echtzeit-Start-/Stoppzeiten werden nicht geändert. Die thermischen Annahmen bleiben ein vereinfachtes Modell; ein höherer Abnahmescore setzt neue nachvollziehbare Betriebsdaten voraus. Details: [Wärmeplanung und Prüfkriterien](docs/thermal-plan-alpha33.md).

## Neu in 0.17.0-alpha.32 – Wallbox-Rückmeldung und erklärbare Schattenläufe

Ein bestätigter Ampere- oder Startbefehl ist noch keine bestätigte Fahrzeugreaktion. Nach der vorhandenen Befehlsbestätigungsfrist wartet der Ausgang auf neue, gültige Leistungs- und Stromwerte ab der Bestätigung, bevor er weiter erhöht oder eine normale PV-Regelung umkehrt. Die zusätzliche Fahrzeug-Reaktionsfrist ist im Reiter **Wallboxen allgemein** einstellbar: `wallboxResponseSettleTimeoutS` (Standard 45 s, 5–120 s) und `wallboxResponseCurrentToleranceA` (Standard 1,5 A, 0,5–3 A). Ein Fahrzeug, das wenig abnimmt, erhält eine begrenzte Diagnose ohne weitere Aufregelung. Bleibt die gemessene Stromaufnahme nach der Frist oberhalb der bestätigten Vorgabe, wird gestoppt und ein Fehler gemeldet. Echte go-e-Fehler einschließlich Fehler 5, ungültige Schutzquellen, Benutzerfreigaben und harte Leistungsgrenzen wirken weiterhin sofort; es gibt keine automatische Fehlerquittierung.

Die Schattenantwort kann bei versetzten Polls eine vollständig zugeordnete historische Messbasis bis höchstens 20 s verwenden, begrenzt durch das konfigurierte Quellenalter. Es werden nur belegte, nahezu konstante Wallbox-Messpaare interpoliert: maximal 20 s Abstand, maximal 100 W Änderung je Wallbox und maximal 500 W Netzänderung zur aktuellen Messung. Fehlende Messpaare, Lastsprünge und schlechte Quellen bleiben unbekannt. Die aktuelle Netz-Schutzprüfung bleibt bei 10 s. `Response.TimingState`, `Reason`, `InputTimestamp` und `InputAge_ms` erklären die Bewertbarkeit; Zeitstempel werden nicht künstlich verjüngt.

Die zusammengehörigen DecisionRecords unterscheiden jetzt Befehlsbestätigung, Fahrzeug-Wartephase und ausdrücklich angenommene Modellantwort mit Befehl, Zeitpunkten und elektrischer Rückmeldung. Reale Leistung aus dem Bestandsskript ist keine Bestätigung eines virtuellen Befehls. Das Schattenmodell bleibt eine ideale elektrische Wallboxantwort; Fahrzeugdynamik, Speicher, EHZ und thermische Anlage sind damit nicht real abgenommen.

Außerdem verwenden die Heizpuffer-/Speicher-Sollwertauswahlen einen vom Admin-Schema unterstützten Filter für schreibbare numerische Zustände. Die bisherige `customFilter.common.write`-Warnung wird behoben; die strenge Ausgangsprüfung bleibt erhalten.

Die Version dient nachvollziehbaren Schattenläufen und einem späteren begleiteten Test. Sie aktiviert keine Ausgänge und ändert keine vorhandenen Start-, Stopp- oder Mindestlaufzeiten. Ein Score-Anstieg setzt neue Betriebsbelege voraus. Details: [Wallbox-Zeitverhalten und Prüfkriterien](docs/wallbox-timing-alpha32.md).

## Neu in 0.17.0-alpha.31 – Admin-Übersetzungen

Alle Admin-Beschriftungen, Auswahleinträge und Hilfetexte verwenden zentrale Übersetzungsdateien unter `admin/i18n/en/translations.json` und `admin/i18n/de/translations.json`. Die Admin-Sprache bestimmt die Anzeige. Der Warmwasser-Reiter heißt auf Deutsch **Warmwasser-Heizstab**. Konfigurationsschlüssel, Optionswerte und Datenpunkt-IDs bleiben erhalten.

## Neu in 0.17.0-alpha.30 – Warmwasserbedarf und günstige Wärmefenster

Der Warmwasserplan berücksichtigt vier gültige Speichersensoren mit der konfigurierten Quellenaltersgrenze statt eines einzelnen Temperatur-Ersatzwerts. Eine kalte untere Schicht löst bei ausreichender warmer Reserve keine sofortige Vollaufheizung aus. Fehlende, unbestätigte, veraltete oder ungültige Sensorwerte machen die thermische Prognose ausdrücklich nicht bewertbar.

Drei neue Annahmen sind im Warmwasser-Tab einstellbar: täglicher Wärmebedarf (Standard **20 kWh**), Speicherverluste (Standard **2 kWh/Tag**) und zusätzliche Prognosereserve (Standard **0,5 kWh**). Dies sind konfigurierbare Schätzwerte, keine aus SQL gemessenen Größen. Der Plan verteilt Bedarf und Verluste gleichmäßig über die tatsächlichen Stunden des Prognosezeitraums und führt den Wärmebedarf am Folgetag weiter.

Bei ausreichender Reserve wartet Netz-Nachheizen auf einen günstigeren erreichbaren Viertelstundenpreis. Geplant wird eine Wärmebrücke bis zur nächsten günstigeren oder ausreichend starken PV-Gelegenheit, höchstens 24 Stunden voraus, statt pauschal bis zum maximalen Ziel aufzuheizen. Eine notwendige sofortige Nachheizung stellt zunächst die Mindestreserve her. Verfügbare PV wird weiterhin vorrangig zur Aufnahme nutzbarer Wärme eingeplant.

`Plan.DHWForecastValid` und `Plan.DHWForecastStatus` zeigen die thermische Bewertbarkeit unabhängig vom übrigen Fahrplan. `Plan.DHWThermalDiagnostics_JSON` zeigt Sensorqualität und Quellenalter, anfängliche Reserve und Speicherkapazität, angenommene Verbräuche und Verluste, geplante Netz-/PV-Wärme sowie nicht gedeckte Mengen. Das Modell gewichtet vier Schichten gleich und ersetzt keine Schichtenspeicher-Simulation; BHKW-, Kessel- und WP-Wärme werden nicht als gesicherter zukünftiger Ertrag angerechnet. Die verfügbaren PV-Fenster sind Prognosen und können durch andere Verbraucher eingeschränkt werden.

Dies ist eine Fahrplanverbesserung. Preisheiz-, Geräte-, Master- und Produktivfreigaben werden nicht automatisch aktiviert. Der Fahrplan allein autorisiert keinen realen Netzladevorgang; vorhandene Sicherheits- und Übergabekriterien bleiben erforderlich.

## Neu in 0.17.0-alpha.29 – Schatten-Quellenalter und Speicherplanung nach Modul 3

- Historische Netzwerte bleiben die Grundlage der modellierten Antwort. Für die Schutzprüfung der Schatten-Wallboxausgänge werden dagegen Qualität, ACK und Alter der aktuellen Original-Netzquelle verwendet. So verursacht eine gültige historische Basis am Alterslimit keinen künstlichen Stopp im nächsten Ausgangszyklus. Ungültige oder tatsächlich veraltete Originalquellen sperren weiterhin.
- Issue #75: Bei knappen günstigen Ladefenstern bekommt späterer HT-Verbrauch Vorrang vor weniger wertvollem ST-Verbrauch. Gleich teure Netzladungen werden bis zum letzten noch geeigneten Fenster verschoben; bereits geplante PV-Aufnahme wird durch einen neuen Netzladevorschlag nicht reduziert.
- `BatteryRoundTripEfficiency_pct` beschreibt optional den gesamten Lade-/Entladezyklus (z. B. 85 %). Der Wert 0 übernimmt unverändert die bisherige Effizienz pro Richtung; 92 % pro Richtung entsprechen 84,64 % für den Gesamtzyklus.
- `BatteryPriceMaxSoC_pct` begrenzt separat den SoC für preisoptimiertes Netzladen. PV-Laden darf darüber hinaus bis zur allgemeinen Speichergrenze erfolgen. Eine abgesenkte Netzladegrenze wird auch vor der Ausführung eines bereits bestehenden Preisplans geprüft.
- Neue Plan-Diagnosen: Netzladeenergie, Netzladeziel-SoC, Ladefenster, prognostizierte Kosteneinsparung und für die nächste PV-Phase eingeplante freie Speicherkapazität. Die Einsparung vergleicht Prognose-Netzbezugskosten mit derselben PV- und Ausgangsreserve ohne zusätzliche Netzladung; sie ist keine gemessene Abrechnung und berücksichtigt weder Verschleiß noch Einspeisevergütung.

Bestehende Installationen erhalten keine automatische Preisladefreigabe: Gesamtzyklus-Effizienz startet mit 0 (bisheriges Verhalten), die zusätzliche Netzlade-SoC-Grenze mit 100 %. Die Änderungen sind durch reproduzierbare Tests geprüft, ersetzen aber keine begleitete Liveabnahme. Details und Diagnosefelder: [Issue #75](https://github.com/fuchs-1978/ioBroker.ems-optimizer/issues/75).

## Neu in 0.17.0-alpha.28 – nachvollziehbare Schattenstopps und SQL-Diagnose

- Der Masterstatus gültiger DecisionRecords wird jetzt aus den echten Freigaben gelesen.
  Alpha.27 ließ das Feld bei gültigen Entscheidungen weg und speicherte dadurch im kompakten
  Record immer false. Der Schattenregler pausiert schon vor der Berechnung bei Master EIN;
  diese Schutzprüfung bleibt bestehen. Das neue Feld erfasst auch Änderungen während eines
  laufenden Berechnungsschritts. Frühere false-Werte sind keine unabhängige Statusmessung;
  separate damalige Statusquellen beachten. `controlState` trennt globale und reale Freigabe.
- DecisionRecord enthält jetzt die Adapterversion und die echten Netz-/Hausanschlussquellen
  mit Wert, Zeitstempel, Alter, maximal zulässigem Alter, ACK, Qualität und Fehlerkategorie.
  Hausanschluss-Stopps erklären getrennt Bezug/Einspeisung beziehungsweise Stromquelle.
  Ein global gültiger Schattenrecord ersetzt keine gültige Sicherheitsquelle.
- Startdiagnosen zeigen Mindest- und Reservefehlbetrag, Countdownbeginn, Anzahl der
  Startversuche und Budget-/Auswahl-/Steuerungsresets mit Zeitpunkt und Ursache.
  Mindestlaufzeit, Startreserve, Stoppverzögerung und harte Schutzgrenzen bleiben erhalten.
  Lange budgetbedingte Wartezeiten werden damit nachvollziehbarer; ein pauschaler
  Regelungsfix oder bestandener Livebetrieb wird daraus nicht behauptet.
- Skalare Schattenwerte werden aus einem vollständigen finalen Zyklus veröffentlicht.
  `Debug.Shadow.ScalarCycleId` bestätigt erst nach allen skalaren Schreibbestätigungen
  dessen Abschluss. Bei langsamer Speicherung werden ganze skalare Zyklen zusammengefasst,
  gezählt in `ScalarSkippedCycles`; Fehler stehen in `ScalarPublishErrors`.
  Es gibt keine atomare Mehr-State-SQL-Transaktion: für Ereignisse bleibt der separat
  serialisierte DecisionRecord mit Sitzung/Sequenz maßgeblich. Während einer Veröffentlichung
  können einzelne UI-Werte noch unterschiedlichen Zyklen angehören.
- SQL-Historienabfragen prüfen die aktive Aufzeichnung in der tatsächlich konfigurierten
  SQL-Instanz, bevor `getHistory` gesendet wird. Fehlende Aufzeichnung, Metadatenfehler und
  Timeout werden offen gemeldet; sie sind keine leere oder erfolgreiche Historie.
- BHKW-Quelleneinheiten werden beim Adapterstart gelesen und mit der Konfiguration
  verglichen. Einheitenwiderspruch und winzige positive unplausible Zählerstände
  (kleiner 1e-12 Quelleinheiten) bleiben unbekannt; ein echter Zählerstand 0 ist zulässig.
  Rohwert und Fehlergrund bleiben in der Qualitätsdiagnose sichtbar. Nicht gelieferte
  Einheitenmetadaten bleiben unbekannt; die konfigurierte Einheit wird nicht umgeschrieben.
  Nach einer Änderung der Quelleneinheit den Adapter neu starten.

Die Tagesauswertung #73 bleibt Referenz. Der beobachtete KNX-BHKW-Zähler muss außerhalb
dieser Adapterversion auf Datentyp/Decodierung geprüft werden; das vorhandene Reset-Skript
für go-e-Fehler 5 und externe SQL-Schreibfehler werden nicht automatisch verändert.
Keine Aktivierung von Master, Skripten oder Aktoren; BHKW-Quellen nur nach bewusster
Zuordnung. Kein BHKW-Prognoseertrag und keine doppelte Addition zum Netzbudget.

## Neu in 0.17.0-alpha.27 – PV-Regelruhe, Startdiagnose und BHKW

- Eine eingeschaltete Preisoption ohne laufendes Netzladefenster löst bei einer
  PV-Delle keinen sofortigen Wallbox-Stopp mehr aus. Mindestlaufzeit und
  Stoppverzögerung gelten weiter. Eine tatsächlich genutzte Netzladefreigabe
  wird bei Ablauf oder ungültigen Preisdaten weiterhin sofort entzogen.
- `Control.WallboxN.AllocationDiagnostics_JSON` erklärt Startschwelle,
  Mindestleistung, Reserve, Countdown, Budget und EHZ-Priorität. Ein real
  ladendes Auto beweist kein ausreichendes EMS-Startbudget; die Reserve bleibt erhalten.
- Optionale BHKW-Leistung und kumulierter Erzeugungszähler stehen unter
  `Actual.BHKW*` und `Debug.Shadow.BHKW.*` beziehungsweise `Actuals.BHKW_W`.
  Der Zähler unterstützt kWh, Wh und Joule (1 kWh = 3.600.000 J).
  ACK, Qualität und Quellenalter werden geprüft; unbekannte Werte bleiben null.
- In **Messwerte** BHKW vorhanden, Leistungs-/Zählerquelle und deren tatsächliche
  Einheit einstellen. BHKW bleibt getrennt von PV und wird nicht nochmals zum
  Netzbudget oder als Prognose addiert. Es gibt keinen BHKW-Stellausgang.
  Nach Stilllegung (hier vorgesehen Ende 2026) „BHKW vorhanden“ deaktivieren.
- Updates aktivieren keine Ausgänge. Softwaretests ersetzen keine begleitete Liveabnahme.

## Neu in 0.17.0-alpha.26 – Morgen-PV vor unnötiger Nachtladung

- Fahrzeuge ohne feste Abfahrt berücksichtigen die nutzbare PV der kommenden
  48 Stunden. Reicht sie für das Ladeziel, entfällt zusätzliche Preis-Netzladung;
  bei einer Lücke wird nur die fehlende Energie günstig nachgeladen.
- Das Preisfenster (Vorgabe 24 Stunden) begrenzt mögliche Netzladeblöcke und
  erzeugt keine künstliche Fertigstellungsfrist mehr. Mindest-SoC und echte
  Abfahrtszeiten bleiben verbindlich.
- Bereits angeschlossene Autos übernehmen die Änderung automatisch. Sitzung,
  gemessene Lademengen und Messwertprüfungen bleiben über Updates und Neustarts
  erhalten; auch manuelle kWh-Budgets werden nicht erneuert.
- Admin-Texte und Diagnosen unterscheiden PV-Vorschau und Netzladefenster.

Details: [Preisoptimiertes Netzladen](docs/price-charging.md).

## Neu in 0.17.0-alpha.25 – Preisoptimiertes Laden von Speicher und Autos

- Separate Netzladefreigaben für Speicher und jede Wallbox. Grundlage ist der
  Brutto-Gesamtpreis einschließlich zeitabhängiger Netzentgelte; ein fester
  Energiepreis bleibt nutzbar.
- Viertelstundenplanung berücksichtigt PV, verbleibenden Energiebedarf,
  verfügbare Ladefenster und Fahrzeugprioritäten. Die Autos laden nacheinander.
- Speicherplanung berücksichtigt Hausverbrauch, Reserven und Verluste. Nur
  wirtschaftlich nutzbare fehlende Energie wird aus günstigen Fenstern nachgeladen.
- Fahrzeuge ohne SoC können eine gemessene AC-Energiemenge je Steckvorgang nutzen.
  Adapterneustarts und Neuplanungen erneuern dieses Budget nicht.
- Preisaufträge erreichen die tatsächliche Regelung. Aktuelle Preise,
  Freigaben, SoC, Hausanschluss und §14a/LPC werden weiterhin geprüft.
  Absichtliche Netzladung wird nicht als freier PV-Überschuss verteilt.
- Neue Freigaben sind zunächst aus. Bestehende Ausgangsfreigaben bleiben erhalten.

Einrichtung und Verhalten: [Preisoptimiertes Netzladen](docs/price-charging.md).

## Neu in 0.17.0-alpha.24 – Tarife und Viertelstundenpreise

- Eigener Admin-Reiter **Preise & Tarife** mit Jahresgültigkeit, drei
  Netzentgeltstufen und einer editierbaren Tabelle der Zeitfenster je Quartal.
  Der Netzfahrplan entsteht unabhängig vom Veröffentlichungszeitraum der Börse.
- Optionale direkte Viertelstundenpreise für DE-LU von **Energy-Charts.info**.
  Externe Preis-Datenpunkte bleiben als alternative Quelle verwendbar.
- Gemeinsame Preisberechnung für Prognose und thermische Preisfreigabe;
  explizite Netto-/Bruttobasis und ein Festtarifmodus mit Gesamtarbeitspreis
  und darin enthaltenem Referenz-Netzentgelt.
- Fehlende Preise erscheinen als Lücken und berechtigen nicht zu
  preisbedingtem Netzladen. Tarifwechsel um 16:30, Mitternacht, Quartalswechsel
  und die Zeitumstellung werden anhand gültiger Intervalle ausgewertet.
- Der Fahrplan bleibt viertelstündlich, die Leistungsregelung im Sekundenbereich.
  Bestehende Quellen und Ausgangsfreigaben werden beim Update beibehalten.

Einrichtung, Einheiten und Datenquellen: [Tarife und Preisquellen](docs/prices-and-tariffs.md).

## Neu in 0.17.0-alpha.23 – begrenzte Messwertpaarung aus #66

- Ausschließlich das isolierte Schattenmodell puffert 30 s reale Netz-/WB-Messungen.
  Bei Zeitversatz wird eine gemeinsame Netzaufnahme von höchstens 10 s Alter
  gesucht. WB-Leistung darf nur zwischen zwei gültigen Messungen interpoliert
  werden: höchstens 20 s Abstand und 100 W Differenz je Wallbox. Keine
  Extrapolation, keine pauschale Lockerung der 2-s-Prüfung bei Lastsprüngen.
- Historische Paarung ist ausdrücklich als `bracketed-historical-input` mit
  Zeitgrenze, Alter, Quellzeitpunkten und begrenzter beobachteter WB-Streuung ausgewiesen.
  Aktuelle WB-Werte dürfen höchstens 100 W vom gepaarten Wert abweichen;
  aktuelle Netzleistung höchstens 500 W von der gepaarten Netzaufnahme.
  Unbeobachtete Zwischenereignisse bleiben möglich, diese Grenzen sind kein
  garantierter physischer Fehlerbereich.
  Die Netzbilanz ist eine begrenzte Näherung, keine synchrone Live-Messung.
- Fehlende, veraltete, unbestätigte oder qualitativ ungültige aktuelle Quellen
  bleiben Sperrgründe. Reale Schutz-, Fahrzeug-, Phasen- und ACK-Daten werden
  nicht ersetzt. Eine unvollständige Gesamtbilanz bleibt ungültig; unabhängige
  WB-Telemetrie und Korrekturgültigkeit werden separat dokumentiert.
- `response.coverage` zählt gültige/ungültige Zeit der aktuellen Modellsitzung;
  Zykluslücken über 65 s werden unbekannt. Keine rückwirkende Rohdatenrekonstruktion.
- SQL-Entscheidungsrecords behalten auch bei ungültiger Antwort Modell-, Fehler-,
  Freigabe- und Phasenwechsel. Nur wechselnde Zeitversatzbeträge und numerische
  Countdown-/Watt-Details erzeugen keine eigenen Ereignisse; 60-s-Heartbeat bleibt.
- Produktive Regelung, Schutzgrenzen, Konfiguration und Aktoren unverändert.
  Fehlercode 5 an WB0 bleibt ein Untersuchungsauftrag, keine automatische Reparatur.

## Neu in 0.17.0-alpha.22 – Messzeitpunkte und Diagnose aus #64

- Große virtuelle Wallboxkorrekturen werden bei mehr als zwei Sekunden Abstand
  zwischen Netz- und Wallboxmessung nicht auf die Schattenbilanz angewendet.
  `Response.Valid` und der Entscheidungsdatensatz nennen die Abweichung; kleine
  Korrekturen tolerieren übliches Abfragejitter. Der produktive Regler bleibt
  davon unberührt.
- `System.Version` und die Startmeldung zeigen die neue Version. Dauerhafte
  Benutzerfreigabe und SoC-Grenzen werden bei gültiger Qualität nicht allein
  wegen altem Zeitstempel oder `ack=false` als gestört markiert.
- Die Ursache der realen WB1-Delle, die Übergabe zwischen WB1 und WB2 sowie
  ein praktischer 1P/3P-Test bleiben gesondert zu prüfen. Dieses Update
  aktiviert weder Master noch Ausgänge.

## Neu in 0.17.0-alpha.21 – SQL-Befunde aus #62

- **Toleranz für kleine negative Messwerte:** Frische gültige Wallbox-Leistungswerte
  zwischen −20 W und 0 W gelten für die Regelung als 0 W. Der Rohwert bleibt
  sichtbar; größere negative Werte, ungültige Qualität und veraltete Rückmeldungen
  lösen weiterhin die Schutzprüfung aus.
- **Zusammenpassende Schattenwerte:** Eine ausdrücklich angenommene elektrische
  Wallbox-Antwort verbindet den virtuellen Strom mit virtueller Leistung und
  entsprechend korrigierter Netzleistung. Reale Messungen bleiben getrennt
  erhalten. Phasenbestätigungen, Gerätefehler, SoC und Schutzwerte bleiben real.
- **Nachvollziehbare Ladeentscheidungen:** Budget vor der Stromberechnung,
  verwendeter vorheriger Strom, Leistungsantwort und Rechenschritt stehen als
  Diagnose bereit. Der Entscheidungsdatensatz enthält außerdem Fehlercode und
  Verbindungsstatus einschließlich Quellenqualität.
- **Verlässlichere Auswertung:** Ein nur lesendes Werkzeug wertet exportierte
  Entscheidungsdatensätze aus, trennt Modellpausen von gemessenen Leistungseinbrüchen
  und kennzeichnet Datenlücken. Netzenergie stammt bevorzugt aus vollständigen
  Zählerdifferenzen, ersatzweise aus einer ausreichend dichten Nettoleistungsreihe.

Details und Aussagegrenzen: [Änderungen aus Issue #62](docs/issue62-alpha21.md).
Ein Update schaltet keine zusätzliche Geräte- oder Masterfreigabe ein.

## Neu in 0.17.0-alpha.20 – Verbesserungen aus #57 bis #60

- **Mehrere Fahrzeuge im 48-h-Plan:** Kleine Restladebedarfe blockieren die
  nachfolgenden Fahrzeuge nicht mehr. Die Schlussladung darf einen Teil des
  Viertelstunden-Slots belegen; Prioritäten und Mindest-SoC werden fortlaufend
  berücksichtigt. Plan und Diagramm verwenden dieselbe Energiezuweisung.
- **Speicher jede Sekunde:** Ein gemeinsamer Takt liest die frische Netzleistung,
  berechnet den Bedarf und aktualisiert den Speicherauftrag. Offene Befehle
  warten weiterhin auf echte Rückmeldung. Der bisherige Standard von 2 s wird
  beim Update einmalig auf 1 s übernommen; andere eigene Intervalle bleiben.
- **Phasenführung ausdrücklich wählbar:** Standard ist jetzt `script`: Das EMS
  rechnet mit der vom go-e bestätigten Phase des vorhandenen Skripts. `ems`
  setzt ein externes Skript voraus, das dem EMS-Phasensoll folgt. Fehlende
  Bestätigung führt nach konfigurierbarer Frist zu einer klaren Sperre.
- **Aussagekräftiger Schattenbetrieb:** Angefordertes Budget, modellierter
  Wallbox-Ausgang und echte Messung sind getrennt. Das Ausgangsmodell verwendet
  die produktive Start-, Rampen-, Mindestlaufzeit- und Abschaltlogik mit rein
  privaten Befehlsbestätigungen. Reale Phasenwechsel werden nicht erfunden.
- **Bessere SQL-Diagnose:** Frische PV-Skriptwerte mit `ack=false` sind sichtbar.
  Sollwertwechsel erhalten keine Zehn-Sekunden-Sperre mehr. `DecisionRecord`
  speichert zusammengehörige Zustände einschließlich realer Rückmeldungen und
  Quellzeitpunkten. Die Aufbewahrung bleibt auf 24 h eingestellt.

Änderungen, Betriebsarten und verbleibende Live-Prüfungen stehen in der
[Auswertung und Testgrundlage für alpha.20](docs/issues57-60-alpha20.md).

## Neu in 0.17.0-alpha.19 – Schattenbetrieb und 24 Stunden SQL

`Debug.Shadow` zeigt bei ausgeschaltetem Master die Entscheidungen der gemeinsamen
Produktivregellogik: Wallboxauswahl und Strom, beide Heizkreise, Speicher und
WP-Empfehlung. Eine getrennte Rechenumgebung verwendet die aktuellen Messwerte
und Gerätefreigaben; sie erhält keinen Zugriff auf reale Ausgänge. So lässt sich
der Vorschlag des EMS mit den Leistungen der laufenden Skripte vergleichen.

Die neue Version richtet ihre eigenen skalaren Schatten-Sollwerte, Istwerte und
Gründe automatisch in der konfigurierten SQL-Instanz mit **24 Stunden
Aufbewahrung** ein. `Debug.Shadow.SQL.Status` meldet die bestätigte Einrichtung
oder einen Fehler. Bestehende Verbrauchshistorien behalten ihre Einstellungen.
Die SQL-Version kann intern einen zusätzlichen Löschpuffer verwenden.

Bedienung, Datenpunkte und Grenzen stehen in der
[Anleitung zum Schattenbetrieb](docs/shadow-mode.md).

## Neu in 0.17.0-alpha.18 – PV-Bilanz im Fahrplan (Issue #54)

- Nach Begrenzung der Wallbox wird der PV-Rest aus PV, Grundlast und tatsächlich
  geplanter Wallbox-/Warmwasserleistung neu berechnet. Verworfene Netzladeleistung
  kann keinen zusätzlichen Heizstab-, Speicher- oder PV-Boost-Bedarf mehr speisen.
- Mindest-SoC-/Abfahrtsladen, Mindesttemperatur-Nachheizen und echte PV-Reste durch
  Ampere-Rundung bleiben erhalten. Bereits zugewiesenes Warmwasser im
  Parallelbetrieb wird genau einmal berücksichtigt.
- `Plan.Allocation_48h_JSON` erklärt die Leistungszuweisung je Viertelstunde;
  `Plan.AllocationSource` benennt die Grundlastquelle. Netzplan und Diagramme
  bilanzieren dieselben veröffentlichten Wattwerte.

Fehlerfall, Diagnosefelder und Prüfung stehen in der
[Anleitung zur Fahrplanbilanz](docs/issue54-plan-budget.md).

## Neu in 0.17.0-alpha.17 – Speicher und zwei getrennte Heizkreise

- **Ein Feinregler:** Der Sun-Energy-Speicher regelt in kleinen Schritten,
  Heizstäbe übernehmen größere Leistungsanteile und die Wallbox ganze Ampere.
  Ist der Speicher aus, gesperrt oder an seiner wirksamen Grenze, übernimmt ein
  verfügbarer EHZ wieder die schnelle Netznachführung. Kein paralleles Aufaddieren
  unabhängiger Netzregler.
- **Sun Energy 500XT:** Direkter, im Admin wählbarer GS-Leistungsdatenpunkt;
  eigene Lade-/Entladegrenzen, SoC-Reserve, Schrittweite, Totband und Rückmeldefrist.
  Bestätigter externer Betriebsmodus und frische zusammengehörige Telemetrie sind
  Voraussetzung. Positive GS-Watt bedeuten Entladen, negative Laden.
- **Zwei my-PV:** Trinkwasser und Heizpuffer besitzen getrennte Ziele, Messungen
  und Freigaben. Beide dürfen bei ausreichendem Budget und Temperaturspielraum
  heizen. Aktive oder unbekannte WP-Kühlung sperrt den Heizpuffer-EHZ.
- **Preisheizen:** Optionaler, ausdrücklich begrenzter Netzbezug berücksichtigt
  den Gesamtpreis einschließlich Zuschlägen und Netzentgelt. Die Batterie darf
  diesen absichtlichen Bezug nicht durch Entladen ausgleichen.
- **WP-Vorbereitung:** `Devices.HeatPump.RequestedMode` liefert `REDUCED`,
  `NORMAL` oder `BOOST` mit Hysterese und Haltezeit. Keine direkte Ansteuerung
  eines Verdichters oder unbekannter Herstellerregister.
- **Gemeinsame Schutzgrenzen und Diagnose:** Auch noch nicht vollständig
  ausgeführte Leistungsbefehle werden reserviert. Debug ergänzt Speicher,
  Heizpuffer, WP und den aktuell zuständigen Feinregler.

Konfiguration, Grenzen und begleitete Tests stehen in der
[Speicher-/Wärme-Anleitung](docs/alpha17-storage-thermal.md).
Die Softwaretests sind keine Freigabe für unbeaufsichtigten Betrieb:
insbesondere ein Strom-/Prozessausfall lässt sich ohne geräteseitigen Watchdog
nicht durch einen ioBroker-Nullbefehl absichern. Bestehende Geräteschutzfunktionen
und lokale WP-Regelung bleiben zwingend aktiv.

## Neu in 0.17.0-alpha.16 – eigene Debug-Aufzeichnung

Unter `ems-optimizer.0.Debug` stehen verständliche Zustände für WB0, WB1, WB2
und den Trinkwasser-EHZ, ein aktueller Diagnose-Snapshot, die letzten 100
Ereignisse und ein begrenzter Leistungsverlauf zur Verfügung. Die Aufzeichnung
ist standardmäßig aktiv, bleibt vom produktiven Hauptschalter unabhängig und
ändert keine Stellbefehle oder Schutzgrenzen. Kein globaler Debug-Loglevel und
keine zusätzliche SQL-Aufzeichnung sind notwendig.

`Debug.Enabled=false` pausiert die Aufzeichnung. `Debug.Clear=true` leert die
Diagnosehistorie, ohne Regler, Timer oder Freigaben zurückzusetzen. Details und
die für einen Fehlerbericht hilfreichen Objekte stehen in der
[Debug-Anleitung](docs/debug-diagnostics.md). Der begleitete
[Regelungstestplan](docs/alpha15-testplan.md) gilt weiterhin.

## Neu in 0.17.0-alpha.15 – umfassende Regelungs- und Übergabeprüfung

- **Start und Rückgabe:** Native Einstellungen werden vollständig übernommen,
  bevor Regelzyklen starten. Alte Gültigkeitswerte gelten nicht als neuer
  Fahrplan. Hauptfreigabe AUS und harte Schutzbedingungen haben Vorrang vor der
  Neustart-Wartephase; ein fehlgeschlagener Start löst die Abschaltung erkannter
  eigener Ausgänge aus. Ausstehende Schreibvorgänge werden geordnet abgeschlossen.
- **Wallbox-Rückmeldungen:** Eigene noch unbestätigte go-e-Befehle lösen keinen
  falschen Messwert-Stopp aus. Stopps warten auf bestätigtes AUS und behalten
  eine begrenzte Wiederholungs-/Fehlerdiagnose. Verzögerte Befehle und Antworten
  dürfen eine neuere Abschaltung nicht rückgängig machen.
- **Produktive Verteilung:** Nur tatsächlich freigegebene und bestätigte
  Ausgänge erhalten reales Budget. Simulierte Wallboxen, Batterie und Heizpuffer
  blockieren weder die aktive Wallbox noch den EHZ. Reale Restleistung während
  des Starts oder Stopps wird weiterhin berücksichtigt.
- **EHZ:** Die doppelte Hochlaufbegrenzung entfällt; Einspeisung kann im Rahmen
  der eingestellten Schrittgrenze schneller aufgenommen werden. Reduzierte
  Budgets und Netzbezug senken das Soll sofort. Ein nicht folgender Aktor wird
  nicht durch immer höhere Befehle überfahren. Der externe 50/50-Schalter
  ändert nur die Verteilung und sperrt den EHZ nicht mehr.
- **Wallbox-Haltezeiten:** Mindestlaufzeit und Ausschaltverzögerung werden nicht
  versehentlich hintereinandergeschaltet. Der produktive Ausgang entscheidet
  über das Halten am wirksamen Mindeststrom. `Devices.WallboxX.StopDelayActive`
  und `StopDelayRemaining_s` machen die separate Ausschaltverzögerung sichtbar.
  Ein abgelaufener Starttimer bleibt während der nötigen EHZ-Abregelung bereit,
  statt erneut 120 Sekunden zu beginnen.
- **SoC und Planung:** Eine alte externe `socfrei=2`-Meldung erzwingt oberhalb
  des aktuellen Mindest-SoC keine weitere Pflichtladung. Manuelle Mindestströme
  bleiben wirksam. Historienlücken, doppelte SQL-Grenzwerte, fehlende Preise,
  Restwärmekapazität und ausdrücklich aktivierte Abfahrtsfristen sind korrigiert.
- **Gemeinsame Grenzen:** EHZ und Wallbox berücksichtigen bei einer aktiven
  Netzbetreiberbegrenzung auch die tatsächliche Leistung des jeweils anderen
  Verbrauchers; Schutzgrenzen werden nicht durch Haltezeiten aufgehoben.

Die Tests ersetzen keine reale Inbetriebnahme. Für den nächsten begleiteten
Test gilt der [Prüfplan](docs/alpha15-testplan.md). Beim Kaltstart wartet die
Regelung weiterhin auf eine vollständige Historie und einen gültigen Fahrplan;
eine einzelne SQL-Abfrage bricht nach 30 Sekunden ohne Antwort mit Diagnose ab.
Bei frühen Datenbank-/Konfigurationsfehlern können zuvor eigene Ausgänge noch
nicht sicher erkannt werden: Diagnose beachten und den realen Zustand prüfen.

## Neu in 0.17.0-alpha.14 – Ausschaltverzögerung bei Leistungsdellen

- Eine laufende Wallbox bleibt bei kurzem Netzbezug oder vorübergehend zu wenig
  Überschuss für standardmäßig 120 Sekunden mit 6 A aktiv.
- `wallboxStopDelayS` ist im Admin einstellbar. Sobald wieder genügend Leistung
  vorhanden ist, wird der Ausschalt-Timer zurückgesetzt.
- Harte Sicherheitsgründe bleiben von der Verzögerung ausgenommen.

## Neu in 0.17.0-alpha.13 – robuste go-e-Messwertfrist

- go-e-Leistung, Phasenströme, Ladefreigabe, Ampere-Rückmeldung,
  Fahrzeugstatus und Fehlercode dürfen standardmäßig 30 statt 15 Sekunden alt
  sein. Normales Polling-Jitter führt damit nicht mehr zur Abschaltung.
- Die Frist ist über `wallboxMeasurementMaxAgeS` von 5 bis 120 Sekunden
  einstellbar; empfohlen und voreingestellt sind 30 Sekunden.
- Netz- und Hausanschlussmessungen sowie echte Sicherheitsgrenzen bleiben von
  dieser Anpassung unberührt.

## Neu in 0.17.0-alpha.12 – eindeutige Abschaltmeldung

- Ein produktiver Stopp wird nur einmal protokolliert, auch wenn die
  `allow=0`-Rückmeldung erst im folgenden Reglerzyklus eintrifft.
- Bei fehlenden oder veralteten Rückmeldungen nennt `LastStopReason` jetzt den
  konkreten Eingang, etwa `Wallbox-Leistung`, `L1-Strom` oder `Netzbezug`.

## Neu in 0.17.0-alpha.11 – frischer Fahrplan vor Restart-Übergabe

- Eine gespeicherte alte `Plan.Valid=true`-Rückmeldung reicht nicht mehr für die
  Übernahme einer laufenden Wallbox.
- Systemupdate, Reglerupdate und gültiger Fahrplan müssen nach Beginn des
  aktuellen Neustarts neu erzeugt worden sein.
- Erst danach startet die zehnsekündige Stabilitätszeit; die Wallbox bleibt bis
  dahin unverändert aktiv, sofern keine externe harte Sicherheitsgrenze fällt.

## Neu in 0.17.0-alpha.10 – dauerhafte Abschaltdiagnose

- `Devices.WallboxX.LastStopReason` speichert den letzten Grund, aus dem ein
  besessener oder aktiver Wallboxausgang abgeschaltet wurde.
- `Devices.WallboxX.LastStopAt` speichert den zugehörigen Zeitpunkt.
- Normale Wartestatus überschreiben diese Diagnose nicht; zusätzlich wird der
  Abschaltgrund als Warnung protokolliert.

## Neu in 0.17.0-alpha.9 – geschützte Wallbox-Startsequenz

- Eine bereits begonnene Startsequenz bleibt bis zur bestätigten
  `allow=1`-Rückmeldung gegen kurzzeitige weiche Sollwertsprünge geschützt.
- Der EHZ kann die Wallbox dadurch beim Übergang nicht mehr unmittelbar nach
  der Freigabe wieder ausschalten und den Starttimer erneut auslösen.
- Harte Sicherheitsgrenzen und echte Freigabeentzüge stoppen weiterhin sofort.

## Neu in 0.17.0-alpha.8 – 50/50-Schalter ohne Wallbox-Abschaltung

- Der externe 50/50-Schalter steuert nur noch die Leistungsverteilung.
- Wird er ausgeschaltet, bleibt eine laufende Wallbox aktiv und erhaelt Vorrang;
  der EHZ uebernimmt nur die verbleibende Leistung.
- Die produktiven Sicherheitsfreigaben fuer Wallbox, EHZ und gemeinsamen Betrieb
  bleiben davon unabhaengig wirksam.

## Neu in 0.17.0-alpha.7 – stabilisierte Restart-Übergabe

- Eine laufende Wallbox bleibt nach dem Neustart zunächst im geschützten
  Übergabestatus.
- Die Übernahme wird erst abgeschlossen, wenn EMS-Regler und Messwerte
  standardmäßig zehn Sekunden durchgehend gültig waren.
- Wird der Regler während der Initialisierung nochmals ungültig oder schreibt
  Null-Sollwerte, beginnt die Stabilitätszeit neu und die Wallbox bleibt aktiv.

## Neu in 0.17.0-alpha.6 – synchronisierte Restart-Mindestlaufzeit

- Eine erfolgreiche Restart-Übergabe startet die Mindestlaufzeit jetzt sowohl
  im Produktivausgang als auch im vorgeschalteten Echtzeitverteiler neu.
- Dafür wird die neue Übergabegeneration `RestartHandoffSince` ausgewertet;
  eine Zustandsflanke von `OutputActive` ist nicht mehr erforderlich.
- Damit kann der Echtzeitverteiler nicht zwei Sekunden nach der Übernahme ein
  Null-Soll erzeugen und die Wallbox erneut in den Starttimer schicken.

## Neu in 0.17.0-alpha.5 – stabile WB/EHZ-Stromübergabe

- Sinkt das Wallbox-Soll, während eine vorherige Ampereerhöhung noch auf die
  go-e-Rückmeldung wartet, wird der offene Befehl durch den niedrigeren sicheren
  Amperewert ersetzt.
- Die Ladefreigabe bleibt dabei aktiv; die Wallbox fällt nicht auf 0 und startet
  keinen neuen 120-s-Countdown.
- Harte Sicherheitsgrenzen stoppen weiterhin unmittelbar.

## Neu in 0.17.0-alpha.4 – produktive 1-/3-Phasenregelung

- Das vorhandene externe Script schaltet weiterhin `go-e.*.phaseSwitchMode`.
- Der Adapter wartet auf den bestätigten Modus (`1 = 1P`, `2 = 3P`) und verwendet
  erst danach die zugehörigen Strom-, Leistungs- und Hausanschlussgrenzen.
- Der go-e-eigene Ladestopp während der Umschaltung wird für standardmäßig
  90 Sekunden toleriert; harte Sicherheitsbedingungen bleiben wirksam.
- Nach einer sicheren Restart-Übergabe beginnt die konfigurierte Mindestlaufzeit
  neu, statt einen alten persistenten Zeitstempel zu übernehmen.

## Neu in 0.17.0-alpha.3 – geschützte Restart-Übergabe

- Nach einer bestätigten Wiederübernahme bleibt die Wallbox standardmäßig für
  30 Sekunden gegen ein vorübergehendes Null-Soll des noch anlaufenden Reglers
  geschützt. Sie fällt dadurch nicht erneut in die Einschaltverzögerung.
- Fehler, fehlende Freigaben, Hausanschlussgrenzen und §14a/LPC bleiben während
  dieser Schutzzeit uneingeschränkt wirksam.
- Die Schutzzeit ist unter **Wallbox general** zwischen 10 und 120 Sekunden
  einstellbar (`wallboxRestartHandoffGraceS`, Standard 30 Sekunden).

## Neu in 0.17.0-alpha.2 – stabile 50/50- und SoC-Übergabe

- Die 50/50-Hysterese schaltet jetzt exakt **ab 4.000 W** ein und erst
  **unter 3.000 W** aus.
- Nach dem Ausschalten der 50/50-Verteilung bleibt die Wallbox vorrangig aktiv.
  Der EHZ gleicht nur den Rest unterhalb einer ganzen Wallbox-Ampere-Stufe aus.
- Eine Änderung des Mindest-SoC oder eine Erhöhung des Ziel-SoC unterbricht eine
  laufende Ladung nicht. Ein bereits erreichtes Ziel-SoC beendet sie weiterhin.
- Nach einem Admin-Speichern werden die abgeleiteten SoC- und Freigabewerte vor
  der geprüften Übernahme einer laufenden Wallbox aktualisiert.

## Neu in 0.17.0-alpha.1 – AP2 Admin/Konfiguration

- Eigene Reiter strukturieren Messwerte, Historie/Prognose und allgemeine
  Wallbox-Einstellungen. PV, Netzbezug/-einspeisung, Außentemperatur,
  Teilzähler, Fahrzeug-/SoC-Werte, Preisreihen und externe Freigaben können ohne
  JSON direkt eingetragen werden.
- Explizite Felder haben Vorrang. `dataPointMapJson` bleibt als kompatibler
  Migrations-Fallback erhalten; leere neue Felder löschen daher keine bestehende
  Zuordnung. `System.MappingStatus_JSON` zeigt explizite, übernommene und fehlende
  Zuordnungen.
- Für Wallboxen und EHZ gilt eine zentrale Hausanschlusssicherung mit gemeinsamer
  Reserve. Die Arbeitsgrenze ist Sicherung minus Reserve. Alte getrennte Grenzen
  bleiben ausschließlich zur Migration lesbar.
- Wallbox-Priorität kann automatisch, im Admin oder über ein externes Objekt
  bezogen werden. Dynamische Energiepreis- und Netzentgelt-Freigaben können
  ebenfalls aus externen Bool-Objekten kommen; ungültige externe Werte schalten
  die jeweilige Dynamik sicher aus und erzeugen einen Diagnosestatus.
- Die Außentemperatur erwartet °C. Ungültige oder fehlende Werte werden verworfen;
  die Prognose arbeitet dann mit ihrem konservativen Rückfall weiter. Der
  Historienzeitraum ist zwischen 7 und 365 Tagen konfigurierbar.
- Im gemeinsamen Betrieb steigt eine Wallbox standardmäßig nur noch um 1 A pro
  langsamem Zyklus. Der EHZ bekommt den Rest zur **gemessenen** Wallboxleistung,
  nicht zu einer vorweggenommenen Sollleistung. So wird die Einspeisung während
  einer trägen Fahrzeugreaktion unmittelbar nachgeregelt und die 50/50-Verteilung
  nähert sich kontrolliert an.
- Ein bereits EMS-eigener, bestätigter Wallbox-Ausgang bleibt bei einem normalen
  Adapterneustart oder GitHub-Update eingeschaltet. Die neue Instanz prüft alle
  Schutzbedingungen erneut und übernimmt den Auftrag ohne AUS/EIN-Unterbrechung.
  Beim Deaktivieren oder Entfernen der Instanz sowie bei ungültiger Übergabe wird
  weiterhin sicher abgeschaltet. Status: `Control.RestartHandoffActive`.
- Der EHZ darf bei bestätigter Rückmeldung Einspeisung mit einem größeren
  Aufwärtsschritt aufnehmen (Standard maximal 3.000 W). Bei −2.000 W NVP und
  6.500 W Istleistung ergibt sich beim Ziel −100 W direkt etwa 8.400 W statt nur
  der bisherigen 1-kW-Stufe. Temperatur-, Zuweisungs- und Hausanschlussgrenzen
  bleiben bindend.

Ein Update übernimmt bestehende Freigaben unverändert, setzt aber keinen bisher
deaktivierten produktiven Ausgang selbsttätig auf aktiv.

Hinweis für den ersten Wechsel von 0.16: Dessen bereits laufender Prozess kennt
die neue Restart-Übergabe noch nicht und kann die Wallbox bei genau diesem einen
Upgrade weiterhin kurz stoppen. Sobald 0.17.0-alpha.1 läuft, verwenden folgende
Restarts und GitHub-Updates die unterbrechungsfreie Übergabe.

## Neu in 0.16.0-alpha.2 – konsistente Wallbox-Timer

- Eine bereits produktiv laufende Wallbox wird unabhängig von einem kurzzeitig
  auf null fallenden internen Sollwert als laufend behandelt.
- Während ihrer Mindestlaufzeit startet deshalb kein neuer Einschalt-Countdown.
- `MinimumRunTimeActive` und `MinimumRunTimeRemaining_s` folgen dem bestätigten
  produktiven Ausgang und stimmen mit dem Countdown im Ausgangsstatus überein.

## Neu in 0.16.0-alpha.1 – Alpha-Gesamtsteuerung

- WB0, WB1 und WB2 dürfen gleichzeitig zur Adaptersteuerung freigegeben werden.
  Der neue Schalter **Arm ALPHA control for all released wallboxes + DHW** muss
  dafür zusätzlich ausdrücklich gesetzt sein.
- Produktiv lädt immer nur **eine** Wallbox. Seit alpha35 steht eine gültige
  manuelle Fahrzeugwahl vor dem laufenden EMS-Auftrag und der automatischen
  SoC-/Fahrplanreihenfolge. Die nächste Wallbox erhält erst nach bestätigtem
  `allow_charging = 0` und elektrischer Abschaltung der vorherigen eine Startfreigabe.
- Fahrplan und Echtzeitregler erzeugen ebenfalls nie parallele Wallbox-Sollwerte.
  Der EHZ bleibt parallel zulässig und regelt den nach der Ganzampere-Stufe
  verbleibenden Überschuss stufenlos aus.
- Erkennt der Alpha-Modus beim Übergang eine laufende, noch nicht dem EMS gehörende
  Wallbox, übernimmt er deren unbekannten Auftrag nicht. Er setzt sie zuerst
  kontrolliert auf AUS und startet sie bei vorhandenem Budget über die bestätigte
  Sequenz AUS → Mindeststrom → EIN neu.
- Eigentümerschaft, sichere Wiederübernahme nach ungeplantem Neustart,
  Startverzögerung, Mindestlaufzeit, Hausanschlussgrenzen, §14a/LPC sowie alle
  Geräte-, Messwert- und SoC-Sperren bleiben wirksam.
- Reale Phasenumschaltung ist weiterhin nicht Bestandteil dieses Alpha-Tests.
  Jede Wallbox arbeitet mit der im Admin bestätigten festen Phasenzahl.

Für den Alpha-Test werden alle drei Wallbox-Schreiber
`Werte_schreiben_0_V2`, `Werte_schreiben_1_V2`, `Werte_schreiben_2_V2` sowie die
konkurrierenden EHZ-Leistungsschreiber deaktiviert. Mess-, SoC-, Benutzer-/RFID-,
Hausanschluss-, §14a-/EEBUS-, Pumpen-, Temperatur- und Geräteschutzfunktionen
bleiben aktiv. Danach werden je Wallbox **Control release** und **Arm wallbox
output**, für den EHZ dessen Steuerfreigabe und die Kombinationsfreigabe sowie
zuletzt Alpha- und globale Schreibfreigabe gesetzt.

Die Rückkehr zum Skriptbetrieb erfolgt umgekehrt: zuerst die Gerätefreigaben
entziehen, auf `OutputOwned=false`, alle `OutputActive=false`, alle go-e-
Freigaben `0` und EHZ-Sollwert `0 W` warten, dann Alpha-/globale Freigabe aus
und erst anschließend die alten Ausgangsschreiber wieder starten.

## Neu in 0.15.5 – sichere Wiederübernahme nach Neustart

- War eine Wallbox vor einem ungeplanten Adapterneustart nachweislich im Besitz des
  EMS (`OutputOwned=true`) und produktiv aktiv (`OutputActive=true`), kann der neue
  Prozess den laufenden Auftrag ohne Abschaltimpuls wieder übernehmen.
- Vor der Übernahme werden erneut alle Freigaben und Sicherheitsbedingungen geprüft,
  darunter Verbindung, Gerätefehler, Fahrzeug/SoC, Hausanschlussschutz, §14a/LPC,
  feste Phasentopologie sowie bestätigter Ladestrom.
- Ist eine Bedingung ungültig oder fehlt die frühere EMS-Eigentümerschaft, erfolgt
  keine Übernahme. Ein noch eigener Ausgang wird dann wie bisher sicher gestoppt.
- Dies war in 0.15.5 auf ungeplante Prozessabbrüche begrenzt. Ab 0.17.0-alpha.1
  nutzt auch ein normaler Restart oder GitHub-Update die geprüfte Übergabe;
  Deaktivieren oder Entfernen der Instanz sendet weiterhin einen Stoppbefehl.

Version 0.15.5 ergänzt keine Objekte, entfernt keine Objekte und aktiviert keine
zusätzlichen produktiven Ausgänge.

## Neu in 0.15.4 – reale Mindestlaufzeit und Countdown-Diagnose

- Bei einer produktiv gesteuerten Wallbox beginnt die Mindestlaufzeit erst, wenn
  `Devices.WallboxX.OutputActive` den realen Start bestätigt. Ein bereits länger
  vorhandener Simulationssollwert kann die Mindestlaufzeit nicht mehr vorzeitig
  ablaufen lassen.
- Je Wallbox zeigen vier neue Diagnoseobjekte die aktive Einschaltverzögerung und
  Mindestlaufzeit sowie die jeweils verbleibenden Sekunden an:
  `StartDelayActive`, `StartDelayRemaining_s`, `MinimumRunTimeActive` und
  `MinimumRunTimeRemaining_s` unter `Vehicles.WallboxX`.
- Sicherheitsgrenzen, Gerätefehler, ungültige Daten, Hausanschlussschutz und §14a
  dürfen die Mindestlaufzeit weiterhin sofort übersteuern.

Version 0.15.4 ergänzt zwölf Diagnoseobjekte, entfernt keine Objekte und aktiviert
keine zusätzlichen produktiven Ausgänge.

## Neu in 0.15.3 – stabiler Wallbox-/EHZ-Betrieb

- Eine PV-geführte Wallbox startet erst, wenn ihre Mindestleistung zuzüglich
  **300 W Startreserve** mindestens **30 Sekunden** stabil verfügbar ist.
- Nach dem Start hält der Regler die Wallbox standardmäßig mindestens
  **120 Sekunden** auf ihrem Mindeststrom. Harte Sicherheitsgrenzen,
  Gerätefehler, ungültige Daten, Hausanschlussschutz und §14a bleiben vorrangig.
- Reicht ein Überschuss nicht für den Wallbox-Mindeststrom oder bleibt wegen der
  Ganzampere-Stufen Leistung übrig, übernimmt der EHZ diesen Rest als stufenloser
  Feinregler.
- Während einer laufenden Ladung berücksichtigt die Nachregelung die tatsächlich
  aufgenommene Wallboxleistung. Zieht ein Fahrzeug weniger Strom als der go-e-
  Sollwert erwarten lässt, können verbleibende 1-A-Stufen kontrolliert nachgeführt
  werden, ohne den Sollwert bei einem nicht ladenden Fahrzeug hochzuschrauben.
- Unter 4.000 W startet keine neue 50/50-Aufteilung. Wurde sie zuvor oberhalb
  von 4.000 W aktiviert, bleibt sie entsprechend der vorhandenen Hysterese bis
  unter 3.000 W aktiv.
- Meldungen unterscheiden jetzt unter anderem ein nicht angeschlossenes Fahrzeug,
  einen veralteten Fahrzeugstatus, einen unbestätigten SoC-Datenpunkt und einen
  erreichten Ziel-SoC.

Die drei Parameter liegen ab 0.17 unter **Wallbox general**:

- `Additional surplus before wallbox start`: 300 W
- `Stable surplus time before wallbox start`: 30 s
- `Wallbox minimum run time`: 120 s

Version 0.15.3 ergänzt drei Konfigurationsobjekte, entfernt keine Objekte und
aktiviert keine zusätzlichen produktiven Ausgänge. Die reale Phasenumschaltung
bleibt weiterhin extern.

## Neu in 0.15.2 – optionale Abfahrtszeit

- Ein leerer Wert in `ems-optimizer.0.Vehicles.WallboxX.DepartureTime` bedeutet
  jetzt **keine hinterlegte Abfahrt**.
- Das Fahrzeug bleibt dann im gesamten 48-Stunden-Horizont für die PV-geführte
  Planung verfügbar.
- Ohne Abfahrtszeit wird keine Deadline-Ladung ausgelöst, auch wenn deren
  Admin-Schalter aktiviert ist.
- Eine gesetzte Uhrzeit bleibt unverändert die harte Planungsgrenze.

**In Version 0.15.2 werden keine Objekte angelegt oder entfernt.** Die
Admin-Oberfläche und sämtliche produktiven Ausgänge bleiben unverändert.

## Neu in 0.15.1 – Issue #8

### Automatische Auswahl der §14a-Quelle

- Ist nur der optionale Binärkontakt konfiguriert, bedeutet der aktive Zustand
  ein festes gemeinsames Leistungsbudget. Standard sind **4.200 W**.
- Ist nur EEBUS-LPC konfiguriert, bestimmt weiterhin `LPC.state` zusammen mit
  `LPC.limit` das Budget.
- Sind beide Quellen konfiguriert, werden sie unabhängig ausgewertet. Begrenzen
  beide gleichzeitig, gilt automatisch das kleinere und damit strengere Limit.
- Ein unveränderter Binärkontakt bleibt gültig und wird nicht allein aufgrund
  seines alten Zeitstempels verworfen. Wert, Bestätigung und Qualität müssen
  weiterhin gültig sein. Dynamische EEBUS-Werte bleiben zeitüberwacht.
- Die Wirkrichtung des Kontakts und das feste Limit sind im Reiter **General**
  unter **§14a / EEBUS LPC** einstellbar. Voreinstellung: `true/1` ist aktiv,
  festes Limit 4.200 W.
- Mindeststrom und Pflichtladung können auch das feste Binärlimit nicht übersteuern.

**In Version 0.15.1 werden keine Objekte angelegt oder entfernt.** Produktive
Ausgänge bleiben nach dem Update ausgeschaltet; vorhandene Skripte werden nicht verändert.

## Neu in 0.15.0 – Issues #8 und #27

### §14a / EEBUS LPC

- `LPC.state = limited` aktiviert `LPC.limit` als gemeinsames Leistungsbudget der
  §14a-Verbraucher. Die aktuell gemessene elektrische Wärmepumpenleistung wird
  zuerst abgezogen; nur der Rest steht den Wallboxen zur Verfügung.
- `unlimitedAutonomous` und `unlimitedControlled` bedeuten kein aktives Limit.
  Fehlende, veraltete oder unbekannte dynamische LPC-Signale sowie `failsafe`
  sperren die Wallboxleistung sicher auf null.
- Solange die Wärmepumpe als nicht vorhanden konfiguriert ist, wird nichts für sie
  abgezogen. Wird sie als vorhanden markiert, ist ihr Leistungsdatenpunkt für ein
  aktives LPC-Limit verpflichtend.
- Mindeststrom und Pflichtladung dürfen das Budget nicht übersteuern.

Die Datenpunkte werden im Reiter **General** unter **§14a / EEBUS LPC** eingetragen.
Der optionale §14a-Binärkontakt darf leer bleiben, wenn allein `LPC.state` und
`LPC.limit` verwendet werden. Umgekehrt dürfen die LPC-Felder leer bleiben,
wenn nur der Binärkontakt mit festem Limit verwendet wird.

Neue Diagnoseobjekte:

- `ems-optimizer.0.Control.GridOperatorLimitActive`
- `ems-optimizer.0.Control.GridOperatorBudget_W` (`-1` bedeutet unbegrenzt)
- `ems-optimizer.0.Control.GridOperatorStatus`
- `ems-optimizer.0.Actual.HeatPump_W`

### Hausanschluss und Admin-Struktur

Die vollständige Konfiguration **House-connection protection** liegt nun im Reiter
**General**. Für eine richtungsrichtige Prüfung können Bezug und Einspeisung je
Phase als sechs SMA-Leistungsdatenpunkte angegeben werden. Nur ein vollständiger
Satz wird akzeptiert. Bleiben alle sechs Felder leer, verwendet der Adapter weiter
die drei Strombeträge als konservativen Rückfall. Dadurch ändert ein Update keine
bisherige Schutzkonfiguration; mit den Richtungswerten wird hohe Einspeisung aber
nicht mehr fälschlich als Bezug begrenzt.

### Phasenumschaltung

Der Adapter beschreibt weiterhin keinen Phasenumschalter. Er liefert
`Vehicles.WallboxX.RecommendedPhases` und das stabilisierte Ziel
`Control.Targets.WallboxX_Phases`. Die reale Umschaltung bleibt beim externen
Skript. Ab 0.17.0-alpha.4 liest der Produktivausgang zusätzlich den bestätigten
go-e-Modus und rechnet erst danach mit der neuen Phasenzahl.

**In Version 0.15.0 entfallen keine Objekte.** Produktive Ausgänge und
Phasenumschaltung bleiben nach dem Update unverändert bzw. ausgeschaltet.

## Neu in 0.14.0 – Issues #6 und #7

### Mindestströme aus den aktiven Wallboxskripten

- Die vorhandenen Objekte `javascript.0.ev.amin0`, `javascript.0.ev.amin1` und
  `javascript.0.ev.amin2` werden als manuelle Mindestströme gelesen. Ihre IDs sind
  pro Wallbox in der Admin-Oberfläche einstellbar; der Adapter beschreibt sie nicht.
- Nur bei `socfrei == 2` gelten zusätzlich die konfigurierbaren niedrigen SoC-Stufen:
  Mii standardmäßig bis 30 % mindestens 10 A und bis 10 % mindestens 16 A;
  EQV/EQE bis 50 % mindestens 10 A, bis 30 % mindestens 16 A und bis 10 %
  mindestens 25 A.
- Fahrzeug-, Phasen-, Leistungs-, Taper-, Hausanschluss- und
  Inbetriebnahmegrenzen bleiben vorrangig. Eine Forderung von 25 A wird zum Beispiel
  bei einer dreiphasig auf 16 A begrenzten EQV-Ladung sicher auf 16 A begrenzt.
- Die Regeln wirken konsistent in 48-h-Fahrplan, Echtzeitverteilung und
  Produktivausgang. Reale Befehle bleiben ganzzahlig und niemals zwischen 1 und 5 A.

### Ein zentraler NVP-Regler für Wallbox und EHZ

Zwei unabhängige Nullregler sind ausdrücklich ausgeschlossen. Der Echtzeitregler
berechnet zuerst die gesamte flexible Leistung und verteilt sie anschließend:

- Wallbox: grobe Leistungsstufe in ganzen Ampere
- Trinkwasser-EHZ: stufenloser Feinregler auf den NVP-Sollwert
- Standardverteilung: 50 % EHZ / 50 % Wallbox
- einphasig EIN oberhalb 4.000 W, AUS unterhalb 3.000 W
- dreiphasig EIN oberhalb 9.000 W, AUS unterhalb 8.000 W
- nicht nutzbare oder durch Ampere-Rundung verbleibende Leistung geht an das andere Gerät

Vor einer Erhöhung der Wallbox wartet der Produktivausgang, bis der EHZ seinen
neuen niedrigeren Anteil erreicht hat. Dadurch entsteht beim Umschichten kein
zusätzlicher Netzbezug; eine kurze zusätzliche Einspeisung ist sicherer und zulässig.
Bei einer notwendigen Reduzierung wird die Wallbox sofort zurückgenommen, der EHZ
füllt den verbleibenden Überschuss anschließend stufenlos auf.

Als Laufzeitschalter dient ausschließlich das vorhandene Objekt
`javascript.0.ehz.aufteilen`. Das Admin-Feld **Existing distribution switch data
point** ist mit dieser ID vorbelegt und kann auf eine andere ID gelegt werden.
Akzeptiert werden `true`/`false` sowie `1`/`0`; fehlende oder ungültige Werte
deaktivieren die gemeinsame Verteilung. Der Adapter beschreibt dieses Objekt nicht.

Für einen gemeinsamen Produktivtest müssen zusätzlich alle folgenden Sperren
bewusst freigegeben sein:

1. globale Schreibfreigabe,
2. eine oder mehrere Wallbox-Steuerfreigaben,
3. **Arm wallbox output** jeder freigegebenen Wallbox,
4. bei mehreren Wallboxen die **ALPHA-Mehrgerätefreigabe**,
5. EHZ-Steuerfreigabe,
6. **Arm combined wallbox + DHW production**,
7. gültiges und eingeschaltetes Aufteilungsobjekt.

Der zusätzliche Kombinationsschalter ist nach jedem Update standardmäßig aus.
Für den ersten Wallbox-Einzeltest bleibt die EHZ-Steuerfreigabe aus; dann arbeitet
die Wallbox wie in 0.13.0 allein gegen den NVP. Der Kombinationsbetrieb ist
softwareseitig vorbereitet, aber noch nicht an der realen Anlage abgenommen.

### Vorbereitung des Wallbox-Einzeltests

Vor dem ersten Test wird genau eine Wallbox ausgewählt. Für diese Wallbox sind
in der Admin-Oberfläche mindestens feste Phasenzahl, tatsächlich belegte
Netzphase bei einphasigem Laden, Strom-/Freigabeausgang sowie bestätigter Strom,
Verbindung und Fehlerstatus zu prüfen. Die sichere Startkonfiguration ist:

- globale Schreibfreigabe zunächst aus,
- nur die ausgewählte Wallbox vorhanden und zur Steuerung freigegeben,
- **Arm SINGLE wallbox test** nur für diese Wallbox an,
- Inbetriebnahmegrenze 6 A,
- EHZ-Steuerfreigabe und **Arm COMBINED wallbox + DHW production test** aus,
- automatische Phasenumschaltung aus und feste Phasenzahl am Gerät verifiziert.

Unmittelbar vor der Übernahme wird nur der vollständige aktive Schreiber der
ausgewählten Wallbox ausgeschaltet:

| Wallbox | Fahrzeug | auszuschaltender Schreiber |
|---|---|---|
| 0 | Mii/e-Up | `script.js.EV-Charge.Werte_schreiben_0_V2` |
| 1 | EQV | `script.js.EV-Charge.Werte_schreiben_1_V2` |
| 2 | EQE | `script.js.EV-Charge.Werte_schreiben_2_V2` |

Eine zugehörige automatische Phasenumschaltung muss ebenfalls aus sein.
Messwert-, SoC-, RFID-/Benutzerfreigabe-, `PV_Sicherung`-, §14a-/EEBUS- und
Geräteschutzskripte bleiben eingeschaltet. Erst danach wird die globale
Schreibfreigabe als letzter Schritt gesetzt.

Für die Rückkehr zum Skriptbetrieb zuerst die Wallbox-Steuerfreigabe entziehen
und auf bestätigte Ladefreigabe 0 sowie `OutputOwned=false` warten. Danach
**Arm SINGLE wallbox test** und die globale Schreibfreigabe ausschalten und erst
dann den oben genannten Schreiber wieder aktivieren. Der Adapter schaltet bei
Installation oder Update weder Skripte noch Produktivausgänge selbst um.

Der gemeinsame Test mit EHZ ist eine eigene zweite Inbetriebnahmestufe. Dann
müssen neben dem ausgewählten Wallbox-Schreiber auch die aktiven konkurrierenden
EHZ-Leistungsschreiber, insbesondere `script.js.E-Heizer.EHZ-Leistung_V2` und
`script.js.E-Heizer.EHZ-Aufteilen_V5`, anhand ihrer tatsächlichen vollständigen
IDs geprüft und ausgeschaltet sein. Schutz-, Pumpen-, Temperatur- und
Messskripte bleiben aktiv. Diese Umschaltung darf erst nach erfolgreichem
Wallbox-Einzeltest erfolgen.

### Neue Diagnoseobjekte in 0.14.0

Für die Wallboxen werden ergänzt:

- `ems-optimizer.0.Vehicles.Wallbox0.ManualMinimumCurrent_A`
- `ems-optimizer.0.Vehicles.Wallbox0.LowSocMinimumCurrent_A`
- `ems-optimizer.0.Vehicles.Wallbox0.RequestedMinimumCurrent_A`
- `ems-optimizer.0.Vehicles.Wallbox0.CurrentConstraintStatus`
- `ems-optimizer.0.Vehicles.Wallbox1.ManualMinimumCurrent_A`
- `ems-optimizer.0.Vehicles.Wallbox1.LowSocMinimumCurrent_A`
- `ems-optimizer.0.Vehicles.Wallbox1.RequestedMinimumCurrent_A`
- `ems-optimizer.0.Vehicles.Wallbox1.CurrentConstraintStatus`
- `ems-optimizer.0.Vehicles.Wallbox2.ManualMinimumCurrent_A`
- `ems-optimizer.0.Vehicles.Wallbox2.LowSocMinimumCurrent_A`
- `ems-optimizer.0.Vehicles.Wallbox2.RequestedMinimumCurrent_A`
- `ems-optimizer.0.Vehicles.Wallbox2.CurrentConstraintStatus`

Für die gemeinsame Verteilung werden ergänzt:

- `ems-optimizer.0.Control.ParallelDistributionReleased`
- `ems-optimizer.0.Control.ParallelDistributionReleaseStatus`
- `ems-optimizer.0.Control.CombinedProductionArmed`

**In Version 0.14.0 entfallen keine Objekte.** Bestehende Diagramme und die
bisherigen Freigabeobjekte bleiben erhalten.

## Neu in 0.13.0 – Issue #4

### Fahrzeugbedarf und Admin-Konfiguration

- Jede Wallbox lässt sich mit **Wallbox … present / include in planning** abwählen.
  Ihr Fahrplan und ihre Freigabe bleiben dann null; die bisherigen Objekte bleiben erhalten.
- **SoC limits source** legt pro Fahrzeug fest, ob die bisherigen gemappten
  Min-/Max-Datenpunkte oder die neuen Admin-Felder gelten. Standard bleibt
  **Existing mapped data points**; das vorhandene JSON kann unverändert bleiben.
- **Minimum SoC**: sofortiger Ladebedarf, auch ohne PV. **Target SoC**: darüber
  nur PV-Laden bis zum Ziel. Netzladung bis zum Ziel aufgrund einer Abfahrtszeit
  erfordert jetzt ausdrücklich **Allow grid charging to target before departure**
  (standardmäßig aus). Diese Änderung betrifft auch die Simulation.
- **Preferred wallbox**: externes Prioritätsobjekt, automatisch oder Wallbox 0/1/2.
  Seit alpha35 hat eine gültige manuelle Auswahl Vorrang vor laufenden Ladeaufträgen
  und der automatischen SoC-/Abfahrtsreihenfolge. Ohne manuelle Auswahl gelten
  weiterhin die automatischen Laderegeln. Sicherheitsgrenzen, Ziel-SoC und
  Geräte-/Benutzerfreigaben gelten bei jeder Auswahl.
- **Reduce current near target SoC** aktiviert zwei Stufen je Fahrzeug.
  Abstand zum Ziel wird in Prozentpunkten, die Stromgrenze in A je Phase eingegeben.
  Beispiel aus dem aktiven Mii-Skript: Ziel minus 5 Punkte → höchstens 13 A;
  Ziel minus 2 Punkte → höchstens 8 A. Für EQV/EQE separat einstellbar;
  standardmäßig bei allen aus, damit keine Fahrzeuggrenze ungefragt geändert wird.
  Beide Stufen wirken in Prognose, Echtzeitsimulation und Produktivausgang.
  Der Fahrplan berechnet sie aus dem fortgeschriebenen Fahrzeug-SoC.

Bei einer kurzen Restladung ist `valueW` im Fahrplan die mittlere Leistung des
15-Minuten-Fensters. `currentA` und `chargingMinutes` beschreiben den dazugehörigen
Ladestrom und die Dauer; real werden niemals 1–5 A angefordert.
Eine nicht vorhandene Hausbatterie gleicht in der Echtzeitsimulation keine Last mehr aus.

### Gesicherter Wallbox-Einzeltest

Die neue Ausgangsstufe benötigt **globale Schreibfreigabe**, **Wallbox vorhanden**,
**Wallbox control release** und die zusätzliche Bestätigung **Arm SINGLE wallbox test**.
Die zusätzliche Bestätigung ist standardmäßig aus, auch bei bestehenden Installationen.
Das anfängliche Produktionslimit beträgt **6 A**. Alle Ausgangs- und Rückmelde-IDs
werden pro Wallbox in der Admin-Oberfläche eingegeben; es gibt keine fest verdrahteten Geräte-IDs.

| Admin-Feld | Wallbox 0 / Mii | Wallbox 1 / EQV | Wallbox 2 / EQE |
|---|---|---|---|
| Writable go-e current | `go-e.0.amperePV` | `go-e.1.amperePV` | `go-e.2.amperePV` |
| Writable go-e release | `go-e.0.allow_charging` | `go-e.1.allow_charging` | `go-e.2.allow_charging` |
| Confirmed go-e current | `go-e.0.ampere` | `go-e.1.ampere` | `go-e.2.ampere` |
| go-e connection state | `go-e.0.info.connection` | `go-e.1.info.connection` | `go-e.2.info.connection` |
| go-e error code | `go-e.0.error` | `go-e.1.error` | `go-e.2.error` |

**Optional available current** bleibt leer, solange `go-e.0.avail_ampere`,
`go-e.1.avail_ampere` beziehungsweise `go-e.2.avail_ampere` keine gültigen Werte
liefern. Wird das Feld belegt, ist der Wert verpflichtend und begrenzt den Strom;
fehlende/veraltete Werte sperren dann den Ausgang. Die Fehlercodes werden gelesen,
aber niemals automatisch quittiert. Eine Stromreduktion lässt sich nicht allein
aus geringer Stromaufnahme eindeutig als Temperaturproblem erkennen.

Die Schreibfolge lautet: Ladefreigabe 0 bestätigen lassen, Mindeststrom schreiben,
bestätigte Ampere-Rückmeldung abwarten, erst dann Ladefreigabe 1. Ein eigener
Schreibauftrag (`ack=false`) zählt nicht als Rückmeldung. Bei Schreibfehler oder
Rückmelde-Timeout wird abgeschaltet und bis zum Adapter-Neustart gesperrt.
Der Regler erhöht nicht weiter, wenn das Auto den angeforderten Strom noch nicht
abnimmt. Er nutzt direkte NVP-Werte und ganze Ampere; normale Erhöhungen beachten
Regelintervall und Rampe, Abschaltungen und kleinere Schutzgrenzen wirken sofort
beim nächsten 2-Sekunden-Prüflauf.

Die Hausanschlussprüfung verwendet bevorzugt die phasenweisen SMA-Leistungen für
Bezug und Einspeisung. Ohne diese optionalen Richtungswerte werden die drei
konfigurierten SMA-Phasenströme weiterhin konservativ ausgewertet. Wallbox-Grenze:
standardmäßig 50 A, keine Erhöhung oberhalb 46 A. Die Zuordnung **Grid phase used
by wallbox L1** muss der tatsächlichen Verdrahtung entsprechen. Ein gültiges
begrenztes LPC-Signal reduziert die Wallbox auf das verbleibende §14a-Budget;
ungültige oder veraltete Signale stoppen sie.

**Bewusste Grenze der damaligen Version 0.13.0:** genau eine Wallbox produktiv und die
EHZ-Steuerfreigabe im Adapter aus. Die Phasenzahl wird für den Test physisch fest
eingestellt und unter **Verified fixed phases** bestätigt. Der Adapter schaltet
keine Phasenschütze. Seine 1-/3-Phasen-Prognose bleibt eine Empfehlung; der Ausgang
rechnet das Wattbudget auf die feste Test-Phasenzahl um. Der kombinierte Test
mit EHZ folgt nach erfolgreichem Einzeltest. Reale Phasenwechsel verbleiben
dauerhaft beim externen Skript und nutzen nur die EMS-Empfehlungen.

Vor dem Test müssen die aktiven Ampere-/Freigabe-Schreibskripte **der ausgewählten
Wallbox** und deren automatische Phasenumschaltung aus sein. Für den Mii ist der
geprüfte Schreiber `script.js.EV-Charge.Werte_schreiben_0_V2`; für die anderen
Wallboxen vor dem Umschalten die tatsächlichen aktiven Schreiber prüfen.
RFID-/Benutzerfreigabe, SoC-Zulieferung, `PV_Sicherung` und Netzbetreibersignale
bleiben erforderlich. Der EHZ bleibt während des isolierten Tests ebenfalls
aus bzw. ohne Leistungsanforderung, damit die NVP-Reaktion eindeutig messbar ist.
Das Update selbst schaltet kein Skript ab.

Zur Rückgabe an das alte Skript zuerst die Wallbox-Steuerfreigabe entziehen und
auf bestätigte Ladefreigabe 0 sowie `OutputOwned=false` warten. Erst danach den
alten Schreiber einschalten. Bei Kommunikationsverlust kann der Adapter eine
Abschaltung anfordern, aber deren physische Ausführung nicht garantieren;
Geräteschutz und lokale Schutzfunktionen bleiben notwendig.

### Neue Diagnoseobjekte (vollständige IDs)

| Zweck | Wallbox 0 | Wallbox 1 | Wallbox 2 |
|---|---|---|---|
| Bestätigter Produktionsstrom | `ems-optimizer.0.Devices.Wallbox0.OutputCommand_A` | `ems-optimizer.0.Devices.Wallbox1.OutputCommand_A` | `ems-optimizer.0.Devices.Wallbox2.OutputCommand_A` |
| Begründung / Wartezustand | `ems-optimizer.0.Devices.Wallbox0.OutputStatus` | `ems-optimizer.0.Devices.Wallbox1.OutputStatus` | `ems-optimizer.0.Devices.Wallbox2.OutputStatus` |
| Ausgang aktiv | `ems-optimizer.0.Devices.Wallbox0.OutputActive` | `ems-optimizer.0.Devices.Wallbox1.OutputActive` | `ems-optimizer.0.Devices.Wallbox2.OutputActive` |
| Steuerung noch übernommen | `ems-optimizer.0.Devices.Wallbox0.OutputOwned` | `ems-optimizer.0.Devices.Wallbox1.OutputOwned` | `ems-optimizer.0.Devices.Wallbox2.OutputOwned` |
| Schreib-/Rückmeldefehler | `ems-optimizer.0.Devices.Wallbox0.OutputFault` | `ems-optimizer.0.Devices.Wallbox1.OutputFault` | `ems-optimizer.0.Devices.Wallbox2.OutputFault` |
| Unter Mindest-SoC | `ems-optimizer.0.Vehicles.Wallbox0.BelowMinimum` | `ems-optimizer.0.Vehicles.Wallbox1.BelowMinimum` | `ems-optimizer.0.Vehicles.Wallbox2.BelowMinimum` |
| SoC-bedingte Stromgrenze | `ems-optimizer.0.Vehicles.Wallbox0.TaperCurrentLimit_A` | `ems-optimizer.0.Vehicles.Wallbox1.TaperCurrentLimit_A` | `ems-optimizer.0.Vehicles.Wallbox2.TaperCurrentLimit_A` |

Weitere neue Diagnosefelder je Wallbox: `OutputPhases`, `OutputLastWrite`,
`FeedbackCurrent_A`, `AvailableCurrent_A` sowie beim Fahrzeug `SocLimitsSource`.
**Keine Objekte entfallen in 0.13.0. Bestehende Diagramme funktionieren weiter.**

## Funktionen

### Simulierter my-PV-Trinkwasser-Controller (ab 0.6.0)

Der Trinkwasser-Heizstab wird als erstes Geraet mit seiner realen
Leistungskennlinie simuliert. Im Beobachtermodus schreibt der Adapter weder
`modbus.4.holdingRegisters.1000_Power` noch `javascript.0.ehz.power_vorgabe`
oder einen anderen Aktorwert.

Aus dem vorhandenen Skript wurden folgende Grenzen uebernommen:

- maximal 9.000 W
- Abschaltung ab 76,0 °C am unteren Speichersensor
- Wiedereinschaltung unterhalb 75,5 °C
- maximal 7.500 W von 70 bis 71 °C
- maximal 6.000 W von 71 bis 73 °C
- maximal 4.000 W von 73 bis 74 °C
- maximal 3.000 W von 74 bis 76 °C
- die temperaturabhaengigen Stufen greifen wie bisher bei mehr als 60 °C
  AC-THOR-Ausgangstemperatur
- maximal 3.000 W ab 76 °C AC-THOR-Ausgangstemperatur
- Sicherheitsabschaltung bei 82 °C am oberen Speichersensor
- Schichtungsgrenzen von 900 beziehungsweise 500 W
- simulierte Aenderungsbegrenzung von 1.000 W je zehn Sekunden

Die wichtigsten vollstaendigen Diagnoseobjekte sind:

- `ems-optimizer.0.Devices.MyPV_DHW.Available`
- `ems-optimizer.0.Devices.MyPV_DHW.Release`
- `ems-optimizer.0.Devices.MyPV_DHW.MustHeat`
- `ems-optimizer.0.Devices.MyPV_DHW.BottomTemperature_C`
- `ems-optimizer.0.Devices.MyPV_DHW.MiddleLowerTemperature_C`
- `ems-optimizer.0.Devices.MyPV_DHW.MiddleUpperTemperature_C`
- `ems-optimizer.0.Devices.MyPV_DHW.TopTemperature_C`
- `ems-optimizer.0.Devices.MyPV_DHW.OutletTemperature_C`
- `ems-optimizer.0.Devices.MyPV_DHW.RemainingCapacity_kWh`
- `ems-optimizer.0.Devices.MyPV_DHW.ActualPower_W`
- `ems-optimizer.0.Devices.MyPV_DHW.PlannedPower_W`
- `ems-optimizer.0.Devices.MyPV_DHW.TemperaturePowerLimit_W`
- `ems-optimizer.0.Devices.MyPV_DHW.SimulatedTargetPower_W`
- `ems-optimizer.0.Devices.MyPV_DHW.Status`

### SoC-, Phasen- und Fahrzeugverwaltung (ab 0.5.0)

Der `vehicle-manager` verwaltet alle drei Wallboxen getrennt. Er uebernimmt die
Semantik der vorhandenen EV-Skripte: Ziel-SoC erreicht bedeutet Sperre,
zwischen Mindest- und Ziel-SoC ist das Fahrzeug PV-flexibel und unterhalb des
Mindest-SoC besteht Pflichtladebedarf. Zusaetzlich werden `alw0…2`,
`socmin0…2`, `socmax0…2`, die
go-e-Anschlusszustaende und die konfigurierten SoC-Quellen ausgewertet. Beim Mii
kann damit der vorhandene geschaetzte SoC verwendet werden. `socfrei0…2` wird
als Vergleichswert angezeigt, die EMS-Freigabe jedoch aus den korrekt gemappten
SoC-Quellen neu berechnet. Damit wird die alte, teilweise nicht mehr passende
Fahrzeugzuordnung nicht ungeprueft uebernommen.

Pro Wallbox werden fehlende Fahrzeugenergie, Ladeenergie inklusive Verlusten,
naechste Abfahrt und spaetester sicherer Ladebeginn berechnet. Vor diesem
Zeitpunkt bleibt das Fahrzeug PV-flexibel. Danach plant der Adapter bei Bedarf
eine Pflichtladung bis zum Ziel-SoC. Pflichtladung, frueheste Deadline und
Prioritaet bestimmen die Reihenfolge. Seit Version 0.9.0 kann verbleibender
PV-Ueberschuss danach an weitere angeschlossene Fahrzeuge verteilt werden.
Damit bleibt die Prioritaet erhalten, ohne ungenutzte Leistung nur wegen einer
bereits ausgereizten ersten Wallbox einzuspeisen.

Die Fahrzeugdaten werden direkt auf der Konfigurationsseite eingestellt. Pro
Wallbox stehen Fahrzeugname, SoC-Datenpunkt, Batteriekapazitaet, maximale
Ladeleistung sowie die Stromgrenzen fuer ein- und dreiphasiges Laden bereit.
Der Haken **1-/3-phasige Umschaltung erlauben** entscheidet, ob der Planer
ueberhaupt dreiphasiges Laden empfehlen darf. Ohne Haken werden die
dreiphasigen Felder ignoriert.

Beispiel einer moeglichen Zuordnung:

| Wallbox | Fahrzeug | Phasenumschaltung | 1-phasig | 3-phasig |
|---|---|---:|---:|---:|
| 0 | Vehicle 0 | nein | 6–16 A | wird ignoriert |
| 1 | Vehicle 1 | ja | 6–16 A | 6–16 A |
| 2 | Vehicle 2 | ja | 6–16 A | 6–16 A |

Der Planer bevorzugt einphasiges Laden, wenn die benoetigte Energie bis zur
Abfahrt damit sicher erreicht werden kann. Bei grossem PV-Fenster oder wenn die
einphasige Leistung zeitlich nicht ausreicht, empfiehlt er fuer freigegebene
Fahrzeuge dreiphasiges Laden. Die eigentliche Umschaltung bleibt in dieser
Version simuliert.

Die Abfahrtszeit wird hier eingestellt:

- `ems-optimizer.0.Vehicles.Wallbox0.DepartureTime`
- `ems-optimizer.0.Vehicles.Wallbox1.DepartureTime`
- `ems-optimizer.0.Vehicles.Wallbox2.DepartureTime`

Format: `HH:MM`, Standard `06:00`. Die Prioritaet steht in:

- `ems-optimizer.0.Vehicles.Wallbox0.Priority`
- `ems-optimizer.0.Vehicles.Wallbox1.Priority`
- `ems-optimizer.0.Vehicles.Wallbox2.Priority`

Je Fahrzeug sind unter anderem folgende vollstaendige Objekte vorhanden
(entsprechend auch fuer `Wallbox1` und `Wallbox2`):

- `ems-optimizer.0.Vehicles.Wallbox0.Connected`
- `ems-optimizer.0.Vehicles.Wallbox0.SoC_pct`
- `ems-optimizer.0.Vehicles.Wallbox0.MinimumSoC_pct`
- `ems-optimizer.0.Vehicles.Wallbox0.TargetSoC_pct`
- `ems-optimizer.0.Vehicles.Wallbox0.Release`
- `ems-optimizer.0.Vehicles.Wallbox0.MustCharge`
- `ems-optimizer.0.Vehicles.Wallbox0.EnergyRequired_kWh`
- `ems-optimizer.0.Vehicles.Wallbox0.GridEnergyRequired_kWh`
- `ems-optimizer.0.Vehicles.Wallbox0.DepartureTimestamp`
- `ems-optimizer.0.Vehicles.Wallbox0.LatestStartTimestamp`
- `ems-optimizer.0.Vehicles.Wallbox0.PhaseSwitchEnabled`
- `ems-optimizer.0.Vehicles.Wallbox0.RecommendedPhases`
- `ems-optimizer.0.Vehicles.Wallbox0.Status`

### Simulierte NVP-Echtzeitregelung (ab 0.4.0)

Zusätzlich zum rollierenden 15-Minuten-Fahrplan berechnet der Adapter alle zwei
Sekunden eine schnelle Ausregelung am Netzverknüpfungspunkt (NVP). Der Fahrplan
entscheidet, welche Verbraucher im aktuellen Zeitfenster freigegeben sind und
welche Leistung sie höchstens erhalten. Die Echtzeitebene reduziert diese
Sollwerte bei einer Wolke und verteilt realen Überschuss innerhalb der
Fahrplangrenzen. Mehrere freigegebene Verbraucher bleiben dabei parallel aktiv;
die Batterie übernimmt die schnelle verbleibende Differenz.

Version 0.4.0 arbeitet ausschließlich als Simulation. Alle Ergebnisse werden
nur unter `ems-optimizer.0.Control` ausgegeben. Es wird kein Datenpunkt einer
Batterie, Wallbox, eines my-PV oder einer Wärmepumpe beschrieben.

Wichtige vollständige Objekte:

- `ems-optimizer.0.Control.Enabled`
- `ems-optimizer.0.Control.TargetGridPower_W`
- `ems-optimizer.0.Control.Deadband_W`
- `ems-optimizer.0.Control.ActualGridPower_W`
- `ems-optimizer.0.Control.PredictedGridPower_W`
- `ems-optimizer.0.Control.RemainingError_W`
- `ems-optimizer.0.Control.Targets.Battery_W`
- `ems-optimizer.0.Control.Targets.MyPV_DHW_W`
- `ems-optimizer.0.Control.Targets.MyPV_Heating_W`
- `ems-optimizer.0.Control.Targets.Wallbox0_W`
- `ems-optimizer.0.Control.Targets.Wallbox1_W`
- `ems-optimizer.0.Control.Targets.Wallbox2_W`
- `ems-optimizer.0.Control.Targets.Wallbox0_A`
- `ems-optimizer.0.Control.Targets.Wallbox1_A`
- `ems-optimizer.0.Control.Targets.Wallbox2_A`
- `ems-optimizer.0.Control.Targets.Wallbox0_Phases`
- `ems-optimizer.0.Control.Targets.Wallbox1_Phases`
- `ems-optimizer.0.Control.Targets.Wallbox2_Phases`
- `ems-optimizer.0.Control.Targets.PVBoostRelease`

Vorzeichen: `ems-optimizer.0.Control.TargetGridPower_W` ist bei Netzbezug
positiv und bei Einspeisung negativ. Der Standardwert `-100 W` hält eine kleine
Einspeisereserve. Für `ems-optimizer.0.Control.Targets.Battery_W` bedeutet ein
positiver Wert Laden und ein negativer Wert Entladen.

- rollierende 48-Stunden-Prognose in 15-Minuten-Schritten
- PV-Prognose für bis zu fünf getrennte PV-Flächen
- Hauslast- und bereinigte Grundlastprognose
- Lernprofile aus SQL-Historie nach Wochentag und Feiertag
- Energiepreis und dynamisches Netzentgelt getrennt aktivierbar
- Fahrpläne für Batterie, drei Wallboxen und zwei my-PV-Heizstäbe
- reine Freigabe- und Budgetplanung für Wärmepumpen-PV-Boost
- Trinkwassertemperatur und thermische Speicherkapazität in der Planung
- dreistufige Batterieladung mit Morgen-, Nachmittags- und Spätziel
- zeitlich möglichst späte, aber sichere Batterieladung
- Batterieentladung für Eigenverbrauch oder Preisverschiebung
- ECharts-kompatible `json_chart`-Datenpunkte
- Datenqualitäts-, Alters- und Plausibilitätskontrolle
- keinerlei Schreibzugriff auf reale Geräteausgänge

Wetter- und PV-Prognosen benötigen bestätigte Quellenwerte (`ack=true`), gültige
Qualität und einen Veröffentlichungszeitstempel, der höchstens sechs Stunden
alt ist. Der zukünftige Lieferzeitpunkt ist davon unabhängig. Wetter und alle
PV-Flächen werden über diesen Lieferzeitpunkt zusammengeführt; verschobene
`hourN`-Indizes werden nicht gleichgesetzt. `Forecast.WeatherValid` erfordert
Abdeckung von mindestens 36 Stunden im aktuellen 48-Stunden-Horizont.

Bei der Grundlastbereinigung muss für jeden eingeschlossenen flexiblen
Verbraucher ein gültiger SQL-Wert derselben Viertelstunde vorliegen. Fehlende
Werte bleiben unbekannt; ein aufgezeichneter Nullwert ist gültig. Die Hauslast
bleibt bei fehlenden Subtraktionswerten erhalten, die Grundlast nicht.
`History.Ready` benötigt ausreichende Hauslast- und Grundlastdaten sowie
vollständige Wochentagsprofile.

## Grundprinzip

> Historie vor Prognose vor Empfehlung.

1. Historische Messwerte bilden typische 15-Minuten-Profile.
2. Wetter, PV-Erwartung, Preise und bekannte Gerätezustände erzeugen eine
   rollierende Prognose.
3. Der Planer verteilt die erwartete Energie auf flexible Verbraucher.
4. Ein schneller Beobachter berechnet alle zehn Sekunden Empfehlungen aus den
   aktuellen Messwerten.
5. Sicherheitsfunktionen und reale Gerätecontroller verbleiben außerhalb des
   Adapters.

## Berücksichtigte Ressourcen

- PV-Erzeugung und Netzanschlusspunkt
- vier getrennte Gebäude- beziehungsweise Bereichszähler
- AC-gekoppelter Batteriespeicher
- bis zu drei Wallboxen
- my-PV Trinkwasser-Heizstab
- my-PV Heizpuffer-Heizstab
- Wärmepumpen-PV-Boost als Freigabeempfehlung
- Hausanschlussreserve
- §14a-, LPC- und LPP-Signale
- dynamische oder feste Energiepreise
- dynamische oder feste Netzentgelte

## Installation

In ioBroker unter **Adapter aus eigener URL installieren** folgende URL
verwenden:

```text
https://github.com/fuchs-1978/ioBroker.ems-optimizer
```

Danach eine Instanz `ems-optimizer.0` anlegen beziehungsweise die vorhandene
Instanz neu starten.

## Konfiguration

### Strukturierte AP2-Konfiguration ab 0.17.0-alpha.1

Die wichtigsten Einstellungen werden nicht mehr nur ueber EMS-Objekte oder das
erweiterte JSON gepflegt. Die Adapterseite ist in folgende Bereiche gegliedert:

- Allgemeine Freigaben, zentrale Hausanschlussgrenze und §14a/LPC
- Messwerte und optionale Teil-/Phasenmessungen
- Historie und Wetter-/PV-Prognose
- Preise & Tarife: Preisquellen, Steuerbasis und jährliche Netzentgelt-Zeitfenster
- allgemeine Wallbox-Regelung und Prioritätsquelle
- Wallbox 0, Wallbox 1 und Wallbox 2
- my-PV Trinkwasser
- my-PV Heizpuffer
- Hausspeicher
- NVP-Echtzeitsimulation
- erweiterte Migrationszuordnung

Je Fahrzeug werden Name, SoC-Datenpunkt, Kapazitaet, maximale Ladeleistung,
Freigabe der 1-/3-phasigen Umschaltung und die getrennten Stromgrenzen
eingestellt. Beim Trinkwasser-Heizstab sind die Temperaturdatenpunkte,
Speichergrenzen, Leistungskennlinie und Leistungsrampe sichtbar. Fuer Batterie
und Heizpuffer stehen Kapazitaet, Leistung und relevante Zielwerte bereit.

Sichtbare Datenpunktfelder überschreiben den entsprechenden Eintrag aus dem
Legacy-JSON. Bleibt ein sichtbares Datenpunktfeld leer, wird die vorhandene
JSON-Zuordnung weiterverwendet. Alle externen Objekt-IDs werden aus der
Adapterkonfiguration gelesen; die Auslieferung enthaelt keine anlagenspezifischen
Zuordnungen.

`dataPointMapJson` ist ab AP2 nicht mehr der normale Konfigurationsweg. Es bleibt
im Reiter **Advanced data points** nur erhalten, damit bestehende Installationen
ohne Datenverlust migrieren. Die wirksame Herkunft ist unter
`ems-optimizer.0.System.MappingStatus_JSON` nachvollziehbar.

Beispiel:

```json
{
  "DP_PV_POWER": "javascript.0.energy.pvPower",
  "DP_GRID_IMPORT": "meter.0.grid.importPower",
  "DP_GRID_EXPORT": "meter.0.grid.exportPower",
  "DP_HOUSE1": "meter.0.house1.power",
  "DP_HOUSE2": "meter.0.house2.power",
  "DP_HALL": "meter.0.hall.power",
  "DP_APARTMENT": "meter.0.apartment.power",
  "DP_BATTERY_SOC": "battery.0.soc",
  "DP_BATTERY_POWER": "battery.0.power"
}
```

Die Beispiel-IDs müssen vollständig durch die Datenpunkte der eigenen Anlage
ersetzt werden. Persönliche Anlagen- und Gerätekennungen sind nicht Bestandteil
dieses öffentlichen Repositorys.

## Historische Lernbasis

Der Adapter verwendet standardmäßig die letzten **84 Tage**; der Wert ist im
Reiter **History & forecast** zwischen 7 und 365 Tagen einstellbar. Die
SQL-Aufbewahrung sollte den gewählten Zeitraum mit Reserve abdecken. Für den
Standardwert werden mindestens 90 Tage empfohlen:

```text
Nur Änderungen speichern:     aktiviert
Entprellzeit:                  5 Sekunden
Minimales Speicherintervall:  60 Sekunden
Relog-Intervall:              900 Sekunden
Aufbewahrung:                 90 Tage
```

Benötigt werden insbesondere Historien für:

- PV-Gesamtleistung
- alle vier Bereichs- beziehungsweise Gebäudezähler
- Gesamtleistung jeder Wallbox
- Gesamtleistung des Trinkwasser-Heizstabs
- später die Gesamtleistung des Heizpuffer-Heizstabs

Die Abfragen erfolgen seit Version 0.2.9 speicherschonend nacheinander und in
Sieben-Tage-Blöcken. Die EMS-eigenen Ergebniswerte werden seit Version 0.2.10
maximal 90 Tage aufbewahrt.

Der Zustand der Lernbasis ist unter folgenden Objekten sichtbar:

```text
ems-optimizer.0.History.Building
ems-optimizer.0.History.Ready
ems-optimizer.0.History.Status
ems-optimizer.0.History.PVSamples
ems-optimizer.0.History.SubmeterSamples
ems-optimizer.0.History.LastBuild
```

## Zentrale Ergebnisobjekte

Seit alpha.52 gilt für die zugeordneten SMA-Gesamt-/Phasen-Netzquellen und den
Hausanschluss-Stromfallback eine einheitliche Frischegrenze von 30 s. Produktive
Steuerung, Schutz- und Messwertdiagnose zeigen denselben Vertrag. Andere
Quellentypen und Kommunikationsfristen behalten ihre eigenen Grenzen.
[Gültigkeitsregeln und Quellenfehlerdiagnose](docs/sma-source-freshness.md).

Aktuelle, normierte Messwerte:

```text
ems-optimizer.0.Actual.PV_W
ems-optimizer.0.Actual.GridPower_W
ems-optimizer.0.Actual.HouseLoad_W
ems-optimizer.0.Actual.Baseload_W
ems-optimizer.0.Actual.Wallboxes_W
ems-optimizer.0.Actual.MyPV_DHW_W
ems-optimizer.0.Actual.MyPV_Heating_W
```

Fahrplan und Status:

```text
ems-optimizer.0.Plan.Valid
ems-optimizer.0.Plan.Status
ems-optimizer.0.Plan.BatteryPower_48h_JSON
ems-optimizer.0.Plan.BatterySoC_48h_JSON
ems-optimizer.0.Plan.MyPV_DHW_48h_JSON
ems-optimizer.0.Plan.MyPV_Heating_48h_JSON
ems-optimizer.0.Plan.Wallbox0_48h_JSON
ems-optimizer.0.Plan.Wallbox1_48h_JSON
ems-optimizer.0.Plan.Wallbox2_48h_JSON
```

Kurzfristige Empfehlungen:

```text
ems-optimizer.0.Recommendation.Valid
ems-optimizer.0.Recommendation.PVBoostRelease
ems-optimizer.0.Recommendation.PVBoostAvailable_W
ems-optimizer.0.Recommendation.MyPV_DHW_W
ems-optimizer.0.Recommendation.MyPV_Heating_W
ems-optimizer.0.Recommendation.Reason
```

## ECharts

Die `json_chart`-Objekte entsprechen dem von ECharts und Open-Meteo
verwendbaren Format `[{"ts":"...","val":...}]`.

Leistungsdiagramm:

```text
ems-optimizer.0.Chart.PV_48h_json_chart
ems-optimizer.0.Chart.HouseLoad_48h_json_chart
ems-optimizer.0.Chart.Baseload_48h_json_chart
ems-optimizer.0.Chart.BatteryPower_48h_json_chart
ems-optimizer.0.Chart.MyPV_DHW_48h_json_chart
ems-optimizer.0.Chart.MyPV_Heating_48h_json_chart
ems-optimizer.0.Chart.PVBoostBudget_48h_json_chart
ems-optimizer.0.Chart.Wallbox0_48h_json_chart
ems-optimizer.0.Chart.Wallbox1_48h_json_chart
ems-optimizer.0.Chart.Wallbox2_48h_json_chart
ems-optimizer.0.Chart.GridPower_48h_json_chart
```

Preisdiagramm:

```text
ems-optimizer.0.Chart.EnergyPrice_48h_json_chart
ems-optimizer.0.Chart.GridFee_48h_json_chart
ems-optimizer.0.Chart.TotalPrice_48h_json_chart
```

Batteriediagramm:

```text
ems-optimizer.0.Chart.BatteryPower_48h_json_chart
ems-optimizer.0.Chart.BatterySoC_48h_json_chart
ems-optimizer.0.Chart.BatteryTargetSoC_48h_json_chart
```

## Vorzeichen

- `Actual.GridPower_W`: positive Werte bedeuten Netzbezug.
- `Plan.BatteryPower_48h_JSON`: positive Werte bedeuten Laden, negative Werte
  bedeuten Entladen.

## Sicherheit

Der Adapter ist kein Schutz- oder Sicherheitsgerät. Hausanschlussschutz,
Temperaturgrenzen, §14a-Vorgaben, Geräteschutz, Schütze und Notabschaltungen
müssen weiterhin durch geeignete lokale und deterministische Funktionen
gewährleistet werden.

Nichtnull-Stellbefehle erfordern ausdrückliche globale und gerätespezifische
Freigaben sowie gültige Schutz- und Messwerte. Sicherheits-Nullbefehle an zuvor
übernommene Ausgänge können auch bei ausgeschalteter Freigabe erforderlich sein.
Die konfigurierbaren Fremdausgänge sind Trinkwasser-Sollwert und optionaler
Istwert-Spiegel, die freigegebenen Wallbox-Ausgänge sowie ab alpha17 der
separat scharfgeschaltete Speicher-GS- und Heizpuffer-Sollwert. Die WP-Erweiterung
schreibt weiterhin nur eigene Empfehlungsobjekte. Details zur physisch
bestätigten Rückgabe und den Geräte-/Watchdog-Grenzen stehen in der
[alpha17-Anleitung](docs/alpha17-storage-thermal.md).

## Gerätefreigaben ab 0.11.0

Jedes geplante Gerät besitzt zwei getrennte Schalter auf der
Konfigurationsseite:

- **Vorhanden / in Planung berücksichtigen** nimmt das Gerät in Fahrplan und
  Simulation auf. Ist der Schalter aus, bleibt seine geplante Leistung null.
- **Steuerfreigabe** erlaubt beim Trinkwasser-EHZ zusammen mit dem globalen
  Hauptschalter die produktive Ansteuerung. Ab 0.16.0-alpha.1 können alle drei
  einzeln bestätigten Wallboxen freigegeben werden; die harte Verriegelung lässt
  weiterhin nur eine Wallbox gleichzeitig laden. Ab alpha17 können Batterie
  und Heizpuffer mit zusätzlichen getrennten Produktivfreigaben angebunden
  werden. Die Wärmepumpe bleibt zunächst eine reine Betriebs-Empfehlung ohne
  fremde Stellbefehle.

Darüber liegt die globale Freigabe **Master release for configured real outputs**.
Sie ist standardmäßig aus. Der EHZ-Ausgang wird erst freigegeben, wenn
alle drei Bedingungen gleichzeitig erfüllt sind: globaler Schalter,
gerätespezifische Steuerfreigabe und gültige Sicherheits-/Messwerte vorliegen.

Für den ersten Ausbau sollten nur Wallbox 0, Wallbox 1, Wallbox 2 und der
Trinkwasser-Heizstab als vorhanden markiert sein. Heizpuffer-Heizstab,
Hausbatterie und Wärmepumpe bleiben bis zur realen Inbetriebnahme ausgeschaltet.
Die vier Punkte der Trinkwasser-Temperaturkennlinie bestehen nun jeweils aus
einer frei einstellbaren Temperatur und der dazugehörigen maximalen Leistung.

### Produktiver Trinkwasser-EHZ ab 0.12.0

Der Ausgang ist im Auslieferungszustand gesperrt und zunächst auf 1.000 W
begrenzt. Vor jedem Schreiben prüft der Adapter die drei Freigaben, EMS- und
Reglergültigkeit, AC-THOR-Verbindung, vier Speichertemperaturen,
Ausgangstemperatur, Temperaturkennlinie, Hausanschlussschutz und die freie
Stromstärke jeder Phase. Die harten Stufen 2 und 3 besitzen wie im bisherigen
Skript eine Wiederzuschaltverzögerung von 30 Sekunden. Bei Verlust einer
Freigabe oder eines gültigen Messwerts sowie beim Adapterstopp wird ein zuvor
aktiver Ausgang auf 0 W gesetzt.

Alle fünf Temperaturwerte müssen zwischen 0 und 100 °C liegen. Für die
Temperaturkonfiguration gilt: Wiederanlauf < Abschaltung ≤ Notabschaltung und
Kennlinienbeginn < Leitungsschutz, jeweils innerhalb von 0–100 °C. Ungültige
Einstellungen sperren die Heizfreigabe. Eine konfigurierte Hausanschluss-
Schutzquelle muss einen bestätigten, qualitätsgültigen inaktiven Wert liefern;
ein älterer, unveränderter Schutzstatus bleibt gültig. Diese Prüfungen werden
auch nach Wartezeiten unmittelbar vor einem positiven Stellbefehl wiederholt.

```text
ems-optimizer.0.System.RealOutputsEnabled
ems-optimizer.0.Devices.MyPV_DHW.ControlEnabled
ems-optimizer.0.Devices.MyPV_DHW.OutputActive
ems-optimizer.0.Devices.MyPV_DHW.OutputCommand_W
ems-optimizer.0.Devices.MyPV_DHW.OutputStatus
ems-optimizer.0.Devices.MyPV_DHW.OutputLastWrite
ems-optimizer.0.Devices.MyPV_DHW.DirectGridPower_W
ems-optimizer.0.Devices.MyPV_DHW.ActuatorSettled
ems-optimizer.0.Devices.MyPV_DHW.ActuatorDifference_W
ems-optimizer.0.Devices.MyPV_DHW.CommandAge_s
ems-optimizer.0.Devices.MyPV_DHW.EffectiveStep_W
ems-optimizer.0.Devices.MyPV_DHW.ProductionRemainingError_W
ems-optimizer.0.Devices.MyPV_DHW.ControlReason
```

Seit Version 0.12.4 nutzt der produktive EHZ-Regler die aktuellen Import- und
Exportwerte direkt vom Netzverknüpfungspunkt. Nach einer Leistungserhöhung
wartet er, bis die gemessene AC-THOR-Leistung höchstens 300 W vom letzten
Befehl abweicht; nach spätestens 15 Sekunden darf er vorsichtig erneut
erhöhen. Bei Netzbezug reduziert er ohne diese Wartezeit. Die Schrittweite
wird nahe dem NVP-Ziel automatisch von maximal 1.000 W auf 500 W bzw. 200 W
verkleinert. Dadurch werden mehrere noch nicht umgesetzte Erhöhungen und das
beim Inbetriebnahmetest beobachtete Pendeln vermieden.

## Zweistufige Echtzeit-Simulation ab 0.8.0

Der 48-Stunden-Fahrplan ist eine strategische Freigabe und kein starrer
Leistungsdeckel. Wenn real mehr PV als prognostiziert zur Verfügung steht,
duerfen freigegebene Wallboxen und der Trinkwasser-Heizstab bis zu ihren
technischen, SoC- und Temperaturgrenzen mehr Leistung aufnehmen.

- Ab alpha.20 berechnet die Batterie die NVP-Abweichung jede Sekunde neu; Stellbefehle beachten weiterhin die konfigurierte Taktung und echte Rückmeldungen.
- Wallboxen und Heizstäbe ändern ihre Sollwerte standardmäßig alle 5 Sekunden. Damit kann der Trinkwasser-Heizstab den NVP ohne vorhandene Batterie zeitnah ausregeln.
- Wallboxen arbeiten nur mit ganzen Ampere und mindestens dem je Fahrzeug
  konfigurierten Mindeststrom.
- Wallboxänderungen sind auf 6 A je langsamem Zyklus begrenzt.
- Der Trinkwasser-Heizstab ändert sich um höchstens 1.000 W je langsamem Zyklus.
- Bei der Ampere-Abrundung freie Leistung wird dem stufenlosen Heizstab angeboten.
- Nach gedecktem Bedarf werden im Fahrplan weitere freigegebene Fahrzeuge
  nacheinander eingeplant. Produktiv startet die nächste Wallbox erst nach
  bestätigtem AUS der vorherigen.
- Die 1-/3-phasige Empfehlung beachtet den Umschalthaken und die getrennten
  Stromgrenzen jedes Fahrzeugs.
- Erreicht ein Gerät seine SoC-, Temperatur- oder Sicherheitsgrenze, bleibt es
  auch bei zusätzlicher PV-Leistung gesperrt.

Die unmittelbar simulierten Werte stehen vollständig unter:

```text
ems-optimizer.0.Control.Targets.Battery_W
ems-optimizer.0.Control.Targets.MyPV_DHW_W
ems-optimizer.0.Control.Targets.Wallbox0_W
ems-optimizer.0.Control.Targets.Wallbox0_A
ems-optimizer.0.Control.Targets.Wallbox1_W
ems-optimizer.0.Control.Targets.Wallbox1_A
ems-optimizer.0.Control.Targets.Wallbox2_W
ems-optimizer.0.Control.Targets.Wallbox2_A
ems-optimizer.0.Control.Targets.Wallbox0_Phases
ems-optimizer.0.Control.Targets.Wallbox1_Phases
ems-optimizer.0.Control.Targets.Wallbox2_Phases
```

## Abgleich der aktiven Wallbox- und E-Heizer-Skripte

Version 0.7.0 berücksichtigt ausschließlich die aktuell aktiven Skripte;
deaktivierte Altversionen wurden nicht übernommen.

| Funktion | Umsetzung im Adapter | Zuständigkeit bis zur Produktivfreigabe |
|---|---|---|
| Fahrzeugpriorität | Grundrang Wallbox 0/1/2, `socfrei`, `alw`, Fahrzeugstatus und `javascript.0.ev.prio` | Erst priorisiertes Fahrzeug, danach weitere Fahrzeuge mit Restueberschuss |
| SoC-Verwaltung | Mindest-/Ziel-SoC, `amin0..2` und die von `socfrei == 2` abhängigen Stromstufen | Fahrplan, Echtzeitverteilung und Produktivausgang |
| Phasenerkennung | Direkte Auswertung von L1/L2/L3 mit mehr als 5 A; alter Phasenwert nur als Rückfall | Adapter-Simulation |
| Wallbox + Trinkwasser | 50/50-Verteilung, Wallbox in ganzen Ampere, ungenutzter Anteil und Rundungsrest an den EHZ | Prognose und zentraler 2-s-Regler; produktiver Kombitest ab 0.14.0 separat gesperrt |
| Hysterese einphasig | EIN über 4.000 W, AUS unter 3.000 W | Konfigurierbar unter `Config.DHWParallelStartPower1P_W` und `Config.DHWParallelStopPower1P_W` |
| Hysterese dreiphasig | EIN über 9.000 W, AUS unter 8.000 W | Konfigurierbar unter `Config.DHWParallelStartPower3P_W` und `Config.DHWParallelStopPower3P_W` |
| E-Heizer-Schutz | 9-kW-Maximum und bestehende Temperaturkennlinie | Adapter simuliert den sicheren Sollwert |
| NVP-Ausregelung | Ein gemeinsamer Regler: Wallbox grob, stufenloser EHZ als Feinregler; später Batterie für den verbleibenden Fehler | Simulation; produktiv einzeln ab 0.12/0.13, Kombination ab 0.14.0 zur Abnahme vorbereitet |
| Ampere-/Freigabeschreiben, Hausanschlussschutz | Gesicherter Einzeltest mit Rückmeldung; ab 0.14.0 sichere gemeinsame Freigabekette | Je Aktor genau ein Schreiber; niemals Adapter und Bestandsskript gleichzeitig |
| Phasenumschaltung | rohe und stabilisierte 1-/3-phasige Empfehlung mit fahrzeugspezifischen Grenzen; kein Aktorzugriff | Ausschließlich bestehende lokale Skripte schalten real |
| RFID und Fehlerquittierung | Nicht doppelt implementiert | Bestehende lokale Skripte |
| EHZ-Pumpe und Raum-PV-Boost | Nicht doppelt implementiert | `EHZ-Pumpe_V2` und `EHZ-P2FBH` |

Der aktuelle Abgleich ist außerdem maschinenlesbar unter
`ems-optimizer.0.System.ActiveScriptAudit_JSON` abgelegt. Es werden mit dieser
Version keine Adapter-Objekte entfernt.

### Skriptumschaltung

Solange alle produktiven Gerätefreigaben ausgeschaltet sind, bleiben
**alle derzeit aktiven Wallbox- und E-Heizer-Skripte eingeschaltet**. Insbesondere
bleiben `PV_Sicherung`, `Werte_schreiben_0_V2`, `Werte_schreiben_1_V2`,
`Werte_schreiben_2_V2`, `EHZ-Pumpe_V2` und `EHZ-P2FBH` aktiv. Ein Abschalten der
Schreibskripte wäre ohne gezielte Übernahme falsch. Für den Wallbox-Einzeltest
und die spätere gemeinsame Inbetriebnahme gilt die konkrete Übergabeanleitung
oben. Version 0.15.1 schaltet kein Skript automatisch ab. Bei einer ausdrücklich
produktiv freigegebenen Übernahme werden wegen doppelter Entscheidungslogik
schrittweise folgende Skripte abgelöst:

- `PV_Fahrplan`
- `PV_Nacht`
- `PV_Ueberschuss_Freigabe`
- `PV_Ueberschuss_Stufen`
- `PV_Ueberschuss_Verteilung`
- `EHZ-Aufteilen_V5`
- `EHZ-Leistung_V2`

Die drei Skripte `Werte_schreiben_0_V2`, `Werte_schreiben_1_V2` und
`Werte_schreiben_2_V2` dürfen erst abgeschaltet werden, wenn der Adapter die
go-e-Ausgänge einschließlich Hausanschlussgrenze, §14a, Rampen und Rückmeldung
nachweislich selbst übernimmt. `PV_Sicherung`, die übergeordneten
§14a-/EEBUS-Funktionen, `EHZ-Pumpe_V2`, `EHZ-P2FBH`, Geräte- und
Temperaturschutz sowie Notabschaltungen bleiben auch dann als unabhängige
Sicherheitsebene aktiv. `PV_Ueberschuss_SOCmin` und `PV_min_max` bleiben in der
ersten Übergangsstufe ebenfalls aktiv, solange ihre Zustände noch Eingänge des
Adapters sind.

## Entwicklungshistorie

| Version | Änderung |
|---|---|
| 0.17.0-alpha.68 | Optionale temperaturabhängige Batterie-Mindestreserve mit variablen Schwellen, Prozentwerten und Prognosequelle; tägliche Auswahlperiode ab 20 Uhr Europe/Berlin, gleiche wirksame Untergrenze in Planung/Live, transparente Halte-/Ersatzdiagnose. Maximum und bestehende Tagesziele bleiben erhalten; keine neue Netzladefreigabe oder zusätzlicher SI-Schreiber. |
| 0.17.0-alpha.67 | Qualifizierte Parallelübergabe nach Ziel-SoC-Ende und unabhängig geprüfter Übernahme im aktuellen Prozess; bestehende −20-W-Wallboxtoleranz auch im zentralen Phasenbudget, Rohwerte und Schutzgrenzen erhalten. |
| 0.17.0-alpha.66 | Ungenutzte physisch freigegebene Wallboxen im Parallelbetrieb bestätigt AUS halten; bestehende Ladung erhalten, AUS-ACK und elektrische Ruhe abwarten, sequenzielle Leerlaufausnahme begrenzen. |
| 0.17.0-alpha.65 | Kontrollierte manuelle Prioritätsübergabe optionaler Ladungen im Parallelbetrieb; Reservierung bis frischem AUS-ACK und elektrischer Ruhe, geschützte Pflichtladungen, qualifizierter Start ohne zweiten vollständigen Countdown. |
| 0.17.0-alpha.60 | Laufende parallele Mindestladung mit gemessener Antwort und frischem Erhöhungsbudget; unveränderte EHZ-Nullfolge behält ihren Abschluss, unbeobachtete Reserven bleiben gesperrt; begrenzter lesender SQL-Abruf mit Sequenz-/Replaynachweis. |
| 0.17.0-alpha.59 | Bereits autorisierter 1P-Mindestladestart bleibt während Peer-Abschaltung innerhalb fester Befehls-/Fahrzeugfristen reserviert; zusätzliche Startabbrüche vermeiden, neue ON-/Erhöhungsbefehle und sämtliche Schutzbudgets bleiben geprüft. |
| 0.17.0-alpha.58 | Unbekannte EHZ-Temperaturen bleiben null; vollständige begrenzte Quellen-/Qualitätsdiagnose in Anzeige und produktiven Records, echte konstante Bestätigungen gültig, Schutzgrenzen unverändert. |
| 0.17.0-alpha.57 | Passive WP-Mess-/SG-Ready-Vorbereitung, getrennte Heiz-/Kühlboostwünsche mit Taupunktgrenze und übersetzter Admin; normierte vollständige WP-Messung für §14a, keine externen WP-Schreibausgänge. |
| 0.17.0-alpha.56 | Beobachtete Netz-Mindestladung endet ohne Nachlauf; PV-Fortsetzung erhält normale Timer, andere Mindestladungen und bestätigte Leistungsreservierungen bleiben geschützt. |
| 0.17.0-alpha.55 | Bereits bestätigte laufende 1P-Mindestladung bleibt beim Nachlauf einer anderen Wallbox erhalten; neue Starts, Phasenwechsel und reale Schutzbudgets bleiben begrenzt. |
| 0.17.0-alpha.54 | Begrenzte unabhängige go-e-Quellendiagnose, erhaltener AUS-Timeoutbefund und klare Anzeige der bleibenden Sperre nach spätem AUS; Schutzvertrag unverändert. |
| 0.17.0-alpha.53 | Parallele Mindest-SoC-Grundladung, Mehrleistung nach bestehender Priorität, sichere gemeinsame Last-/Phasenreservierung und passende Prognose-/SQL-Diagnose; sequenzieller Fallback bleibt einstellbar. |
| 0.17.0-alpha.52 | Einheitlich 30 s Quellenalter für zugeordnete SMA-Gesamt-/Phasen-Netzwerte und Hausanschluss-Stromfallback in Regelung, Schutz und Diagnose; asynchrone Quellenfehlerdiagnose auch für Hausphasen. |
| 0.17.0-alpha.51 | Eine frische, belegbar abgesteckte und elektrisch ruhende fremde Wallbox mit allow=1 unterbricht keine bereits aktive ausgewählte EMS-Ladung; neue Starts und offene Peeraktionen bleiben verriegelt. |
| 0.17.0-alpha.50 | Kompakte produktive Schema-3-Snapshots/Deltas mit verlustfreiem Replay, 30-s-Vollbasis und lesendem JSON-Decoder; Regelung und SQL-Einstellungen unverändert. |
| 0.17.0-alpha.49 | Wallbox-Netzdiagnose mit operativen 30 s, unabhängigen EHZ-Vertrag getrennt ausweisen; unveränderte zusätzliche Subsekunden-Snapshots vermeiden, Ereignisse und volle Rohframes erhalten. |
| 0.17.0-alpha.48 | SMA-Fehler mit Quellen- und Empfangszeit sowie einmaliger asynchroner ioBroker-Direktlesung diagnostizieren; Schutzpfad unverändert. |
| 0.17.0-alpha.47 | Gesamtnetzbezug/-einspeisung bis 30 s Alter; passende Ausgangs-, Phasenbudget- und Diagnoseprüfung. |
| 0.17.0-alpha.46 | Nutzbare Startphase für bestätigte gestoppte Zielwallbox vor Ladefreigabe nach Echtzeitbudget anfordern; laufende Phasenwechsel behalten ihre Timer. |
| 0.17.0-alpha.45 | Alte elektrische Schrittwartebedingung beim Ersetzen einer offenen Stromerhöhung entfernen; neue Schritte bleiben rückmelde- und budgetgebunden. |
| 0.17.0-alpha.44 | Gemessene Ein-Ampere-Nachführung laufender PV-Ladung mit elektrischer Schrittbestätigung und passenden EHZ-Reserven. |
| 0.17.0-alpha.43 | Verzögerte Echtzeit-Phasenentscheidung mit gültigem Budget; Topologieübergänge getrennt reserviert und negative Stromschritte korrigiert. |
| 0.17.0-alpha.42 | Gemessene Leistungsübergabe vom EHZ zur nächsten Wallboxstufe; qualifizierte Weitergabe nach Abstecken ohne erneuten vollständigen Starttimer. |
| 0.17.0-alpha.41 | Erwartete Phasen-Schreibechos und Ladepause als begrenzter Übergang; Ladeblock erhalten, Modus-ACK und elektrische Antwort getrennt. |
| 0.17.0-alpha.40 | Wallboxstart und Erhöhung nach realem Netzbudget statt nominaler EHZ-Sollabweichung; Startsequenz prüft Restleistung erneut. |
| 0.17.0-alpha.39 | Begrenzte EHZ-Wiederaufnahme nach frischer stabiler positiver Leistungsabweichung; Schutz- und ACK-Prüfungen bleiben erhalten. |
| 0.17.0-alpha.38 | Issue #98: produktive Ereigniskette im vorhandenen Recorder, PV-Quellenvertrag und klare Produktivtexte; deaktiviertes Master-gekoppeltes Phasenbeispiel und Asynchronie-/Timerregressionen. Reale Abnahme bleibt offen. |
| 0.17.0-alpha.37 | Issues #87–#92 und #94–#95: Warmwasserschutz, gültige Hysterese, bestätigte Schutzquelle, qualitätsgesicherte und zeitlich passende Prognosen, vollständige SQL-Grundlastbereinigung und gemeinsame Schatten-Zeitprüfung. Vergleichskriterien für die täglichen Probeläufe ergänzt. |
| 0.17.0-alpha.24 | Jahrestarife im Admin, direkte Viertelstundenpreise von Energy-Charts, gemeinsame Brutto-Preisberechnung und ausdrückliche Datenlücken ohne günstigen Ersatzpreis. |
| 0.17.0-alpha.23 | Issue #66: begrenzte historische Messwertpaarung im Schattenmodell, getrennte Telemetrie-/Korrekturgültigkeit, Sitzungsabdeckung und ereignistreue Recordverdichtung. |
| 0.17.0-alpha.22 | Issue #64: Plausibilitätsgrenze für zeitversetzte Netz-/WB-Messungen im Schattenmodell, aktuelle Versionsanzeige und korrekte Diagnose dauerhafter Benutzervorgaben. |
| 0.17.0-alpha.21 | Issue #62: −20-W-Toleranz für gültige Wallbox-Leistung, präzise Fehlerdiagnose, konsistente elektrische Schattenantwort, Budgetdiagnose und SQL-Auswertung mit Datenqualitätsprüfung. |
| 0.17.0-alpha.20 | Issues #57–#60: sekündlicher Speicher, Restladebedarf und Mehrfahrzeugplan, bestätigte Skriptphasen und begrenztes EMS-Phasenwarten, isoliertes Wallbox-Ausgangsmodell sowie zusammengehörige SQL-Ereignisdaten. |
| 0.17.0-alpha.15 | Start-/Stopp-Lifecycle, asynchrone go-e-Rückmeldungen, produktive Budgetauswahl, EHZ-Nachführung, SoC-Pflichtladung und Daten-/Planvalidierung geprüft und mit Regressionstests abgesichert. |
| 0.17.0-alpha.14 | Eigene konfigurierbare Wallbox-Ausschaltverzögerung bei vorübergehend zu wenig Überschuss. |
| 0.17.0-alpha.13 | Die Frischefrist der go-e-Messwerte beträgt konfigurierbar standardmäßig 30 Sekunden. Normales Abfragejitter knapp oberhalb von 15 Sekunden schaltet die Wallbox nicht mehr ab. |
| 0.17.0-alpha.12 | Produktive Abschaltungen werden nur einmal protokolliert. Fehlende oder veraltete Rückmeldungen nennen jetzt den konkreten betroffenen Messwert. |
| 0.17.0-alpha.11 | Die Restart-Übergabe akzeptiert nur System-, Regler- und Fahrplandaten, die nach Beginn des aktuellen Neustarts neu erzeugt wurden. Ein alter gespeicherter `Plan.Valid`-Wert kann die Übergabe nicht mehr vorzeitig beenden. |
| 0.17.0-alpha.10 | Dauerhafte Diagnoseobjekte `LastStopReason` und `LastStopAt` halten den letzten produktiven Abschaltgrund fest, auch wenn der normale Status bereits wieder einen Starttimer oder Wartestatus zeigt. |
| 0.17.0-alpha.9 | Eine begonnene Wallbox-Startsequenz bleibt bis zur bestätigten Ladefreigabe gegen weiche Sollwertsprünge geschützt. Dadurch führt der noch nachlaufende EHZ nicht mehr unmittelbar nach `allow=1` zu `allow=0` und einem neuen Starttimer. |
| 0.17.0-alpha.8 | Der externe 50/50-Schalter steuert nur noch die Verteilung. Beim Ausschalten bleibt die Wallbox aktiv und erhält Vorrang; die produktiven Sicherheitsfreigaben bleiben bestehen. |
| 0.17.0-alpha.7 | Restart-Übernahme endet erst nach zehn Sekunden durchgehend stabiler EMS-/Messdaten. Späte Initialisierungs-Nullwerte können die laufende Wallbox dadurch nicht mehr unmittelbar nach der Übernahme abschalten. |
| 0.17.0-alpha.6 | Eine neue Restart-Übergabe startet die produktive Mindestlaufzeit ausdrücklich auch im Echtzeitverteiler neu, selbst wenn `OutputActive=true` den Neustart ohne Zustandsflanke überlebt hat. |
| 0.17.0-alpha.5 | Ein sinkendes Wallbox-Soll ersetzt einen noch offenen höheren Amperebefehl, ohne `allow=0` auszulösen. Dadurch bleibt die Wallbox bei schnellen WB/EHZ-Neuverteilungen aktiv und fällt nicht erneut in die Einschaltverzögerung. |
| 0.17.0-alpha.4 | Produktive Wallboxregelung folgt dem bestätigten go-e-Phasenmodus: 1 = einphasig, 2 = dreiphasig. Während der geräteeigenen Umschaltung gilt eine Übergangstoleranz; 6 A werden dreiphasig als 4.140 W berechnet. Nach Restart-Übergabe beginnt die Mindestlaufzeit neu. |
| 0.17.0-alpha.3 | Erfolgreich übernommene Wallbox gegen kurzzeitiges Null-Soll während der Reglerinitialisierung geschützt; harte Sicherheitsgrenzen bleiben wirksam und die Einschaltverzögerung wird nicht neu aktiviert. |
| 0.17.0-alpha.2 | 50/50 startet exakt an der Einschaltschwelle; unterhalb der Ausschaltschwelle bleibt die Wallbox vorrangig aktiv und der EHZ schließt nur den Ampere-Rest. SoC-Ableitungen werden vor der Restart-Übergabe aktualisiert; Min-SoC- und höhere Ziel-SoC-Änderungen stoppen eine laufende Wallbox nicht. |
| 0.17.0-alpha.1 | Gemeinsame AP2-Umsetzung der Issues #5 und #28–#32: explizite Admin-Datenquellen mit JSON-Migration, zentrale Hausanschlussgrenze, eigene Wallbox-/Historien-/Prognosebereiche, externe Prioritäts- und Preisschalter sowie Diagnose. Kombiregelung nutzt gemessene Wallboxleistung und begrenzt Erhöhungen auf standardmäßig 1 A je Zyklus; EHZ-Einspeisenachführung bis 3 kW je bestätigtem Schritt. Laufende EMS-eigene Wallbox bleibt bei Restart/GitHub-Update aktiv und wird geprüft übernommen. Keine neue Ausgangsfreigabe wird aktiviert. |
| 0.16.0-alpha.2 | Zeitführung laufender Produktiv-Wallboxen korrigiert: kein erneuter Einschalt-Countdown bei kurzzeitigem internem Null-Sollwert; separate Diagnoseobjekte folgen der realen Mindestlaufzeit. |
| 0.16.0-alpha.1 | Alpha-Gesamtsteuerung für WB0, WB1, WB2 und Trinkwasser-EHZ. Harte Sequenzverriegelung: nie mehr als eine Wallbox gleichzeitig, bestätigtes AUS vor Übergabe, unbekannte laufende Fremdfreigaben werden zuerst kontrolliert gestoppt. EHZ bleibt während der Startverzögerung und parallel zur aktiven Wallbox Feinregler. Startreserve arbeitet nach Beginn des Countdowns als Hysterese; zusätzliche produktive Mindestlaufzeit-Sicherung direkt am Wallbox-Ausgang. Neue standardmäßig ausgeschaltete Alpha-Freigabe; reale Phasenumschaltung bleibt extern. |
| 0.15.5 | Sichere Wiederübernahme eines zuvor EMS-eigenen und weiterhin aktiven Wallbox-Auftrags nach ungeplantem Prozessneustart. Vollständige Live-Sicherheitsprüfung vor der Übernahme; bei fehlender Eigentümerschaft oder ungültigen Bedingungen wird nicht übernommen. Keine Objekte ergänzt oder entfernt und keine zusätzlichen Ausgänge aktiviert. |
| 0.15.4 | Produktive Wallbox-Mindestlaufzeit beginnt erst mit dem bestätigten realen Ausgang statt mit einem früheren Simulationssollwert. Einschaltverzögerung und verbleibende Mindestlaufzeit werden je Wallbox über vier Diagnoseobjekte sichtbar. Zwölf Objekte ergänzt, keine entfernt und keine zusätzlichen Ausgänge aktiviert. |
| 0.15.3 | Produktiven PV-Betrieb stabilisiert: konfigurierbare Startreserve, Startverzögerung und Wallbox-Mindestlaufzeit; nicht nutzbares Ganzampere-/Mindestleistungsbudget fällt an den EHZ-Feinregler zurück. Laufende Wallboxen werden anhand ihrer tatsächlichen Leistungsaufnahme nachgeregelt. 4/3-kW-Hysterese mit Tests abgesichert und Statusmeldungen für Fahrzeug/SoC präzisiert. Drei Konfigurationsobjekte ergänzt, keine Objekte entfernt und keine weiteren Ausgänge aktiviert. |
| 0.15.2 | Leere Wallbox-Abfahrtszeit als „keine Abfahrt“ umgesetzt. Das Fahrzeug bleibt dann im gesamten 48-Stunden-Horizont planbar; ohne Uhrzeit wird keine Deadline-Ladung ausgelöst. Keine Objekte ergänzt oder entfernt, keine Admin-Einstellungen und keine produktiven Ausgänge verändert. |
| 0.15.1 | Issue #8: statischen §14a-Binärkontakt mit konfigurierbarem Festlimit ergänzt. Binärkontakt und EEBUS-LPC werden automatisch anhand der angegebenen Datenpunkte ausgewertet; bei zwei aktiven Begrenzungen gilt das kleinere Limit. Statische Kontakte verfallen nicht wegen eines unveränderten Zeitstempels. Keine Objekte ergänzt oder entfernt und keine produktiven Ausgänge aktiviert. |
| 0.15.0 | Issues #8/#27: EEBUS-LPC als gemeinsames Budget von Wärmepumpe und Wallboxen umgesetzt; ungültige Signale sperren sicher. Phasenweisen Hausanschlussschutz um optionale getrennte Bezugs-/Einspeiseleistungen ergänzt und die zugehörigen Admin-Felder nach General verschoben. Der Adapter gibt weiterhin nur Phasenempfehlungen aus; reale Umschaltung bleibt beim externen Skript. Vier Diagnoseobjekte ergänzt, keine Objekte entfernt und keine produktiven Ausgänge aktiviert. |
| 0.14.0 | Issues #6/#7: manuelle Mindestströme `amin0..2` und nur bei `socfrei == 2` wirksame niedrige SoC-Stromstufen ergänzt; zentralen NVP-Regler für 50/50-Verteilung vorbereitet, Wallbox grob und EHZ stufenlos als Feinregler. Vorhandenes `javascript.0.ehz.aufteilen` als konfigurierbaren, nur gelesenen Laufzeitschalter übernommen; separater standardmäßig ausgeschalteter Kombinations-Arming-Schalter, Diagnose und sichere Übergabereihenfolge ergänzt. Keine Objekte entfernt. |
| 0.13.0 | Issue #4: Min-/Ziel-SoC und Fahrzeugpriorität im Admin, Mindest-SoC vor manueller Priorität, zwei konfigurierbare SoC-Reduktionsstufen in Prognose/Simulation/Output; gesicherter Wallbox-Einzeltest mit 6-A-Start, bestätigter Rückmeldung, Fehler-/NVP-/Hausanschlussprüfung. Neue Ausgänge bleiben aus; keine Objekte entfernt. |
| 0.12.4 | Produktive NVP-Regelung des Trinkwasser-EHZ auf direkte SMA-Netzwerte umgestellt; Rückmelde-/Beruhigungslogik für den AC THOR, sofortige Reduktion bei Netzbezug, adaptive 1.000-/500-/200-W-Schritte und zusätzliche Diagnoseobjekte ergänzt. |
| 0.12.3 | Zeitüberwachung an Sensorverhalten angepasst: unveränderte Tanktemperaturen bis 60 Minuten gültig, dynamische Ausgangstemperatur und Regler weiterhin eng überwacht. Produktiver Trinkwasser-Heizstab und langsame Zielverteilung standardmäßig alle 5 Sekunden. |
| 0.12.2 | Hausanschlussbegrenzung des EHZ auf aktuelle SMA-Phasenströme umgestellt; statische `FreieAmpere`-Werte dürfen unverändert bleiben, ohne den Watchdog auszulösen. |
| 0.12.1 | Watchdog ergänzt: produktiver EHZ fällt auf 0 W, wenn EMS- oder Echtzeitregelung nicht mehr innerhalb ihrer zulässigen Zeit aktualisiert werden. |
| 0.12.0 | Dreifach gesperrter Produktivausgang ausschließlich für den Trinkwasser-EHZ; konfigurierbarer Sollwert, 1-kW-Inbetriebnahmegrenze, Temperatur-/Daten-/HA-Prüfung, Stufenverzögerung und sichere Abschaltung. |
| 0.11.0 | Globale und gerätespezifische Freigaben ergänzt; nicht vorhandene Geräte werden aus Planung und Simulation entfernt. Trinkwasserkennlinie auf vier konfigurierbare Temperatur-/Leistungspaare umgestellt und sichere Skript-Umschaltfolge dokumentiert. |
| 0.10.0 | Konfigurationsseite fuer Fahrzeuge, beide Heizstaebe, Batterie, NVP-Regelung sowie Preise/Netzentgelte gegliedert; Trinkwasser-Temperaturkennlinie konfigurierbar. |
| 0.9.0 | Sichtbare Fahrzeugkonfiguration, eigener Haken fuer 1-/3-phasige Umschaltung, getrennte Stromgrenzen und parallele Nutzung mehrerer Wallboxen bei Restueberschuss. |
| 0.8.0 | Fahrplan als Freigabe statt starrem Leistungsdeckel; zusätzliche reale PV-Leistung wird verteilt. Wallboxen in ganzen Ampere ab 6 A, langsame Verbraucher alle 10 s und Batterieausregelung alle 2 s. |
| 0.7.0 | Aktive Wallbox-/E-Heizer-Skripte abgeglichen: vollständige Fahrzeugpriorität, direkte Phasenerkennung und 50/50-Verteilung mit 4/3-kW- bzw. 9/8-kW-Hysterese in Prognose und 2-s-Simulation. |
| 0.6.0 | Trinkwasser-Heizstab mit Temperaturkennlinie, 9-kW-Grenze und reiner Sollwertsimulation ergänzt. |
| 0.3.2 | Versionsmeldungen des Adapters vereinheitlicht; keine Änderung der EMS-Logik oder Objekte. |
| 0.3.1 | Konfigurierbare Mindestgrundlast verhindert unplausible Nullwerte nach Abzug historischer flexibler Verbraucher. Standard: 500 W über `ems-optimizer.0.Config.MinimumBaseload_W`. |
| 0.3.0 | EMS-Logik ohne Funktionsänderung in Module für Kern, Historie, Prognose, Planung, Beobachtung und Start getrennt. |
| 0.2.10 | Aufbewahrung der EMS-eigenen SQL-Ausgänge auf 90 Tage begrenzt. |
| 0.2.9 | SQL-Historie speicherschonend nacheinander und in Sieben-Tage-Blöcken. |
| 0.2.8 | Adapter-Icon und Objekt `info.connection` ergänzt. |
| 0.2.7 | Batterieladung in das spätestmögliche sichere PV-Fenster verschoben. |
| 0.2.6 | Fahrzeug-SoC, Ladeziel und Freigabe sowie parallele Verteilung zwischen Trinkwasser und Wallbox ergänzt. |
| 0.2.5 | Dreistufige Batterieladung: morgens 70 %, nachmittags 90 %, später Abschluss auf 100 %. |
| 0.2.4 | Batterieentladung für Eigenverbrauch und Kennzahlen zur Speicherbewertung ergänzt. |
| 0.2.3 | PV-Skalierung korrigiert; Hauslast und bereinigte Grundlast getrennt. |
| 0.2.2 | my-PV-Historie auf einen historisierten Gesamtleistungswert umgestellt. |
| 0.2.1 | ECharts-kompatible `json_chart`-Objekte ergänzt. |
| 0.2.0 | 48-Stunden-Gerätefahrplan für Batterie, zwei Heizstäbe, PV-Boost und drei Wallboxen. |
| 0.1.2 | Vier Unterzähler, Profile je Wochentag/Feiertag und getrennte Preisbestandteile. |
| 0.1.1 | Wetter- und PV-Prognose für fünf PV-Flächen. |
| 0.1.0 | Erster reiner Beobachtungsmodus. |

## Lizenz

MIT
