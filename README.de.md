# EMS Optimizer

**Aktuelle Adapterversion: 0.17.0-alpha.215.** EMS Optimizer verbindet PV-/Netzmessungen, Last- und Wetterprognosen sowie Strompreise zu einem rollierenden 48-Stunden-Fahrplan. Die Echtzeitregelung koordiniert bis zu drei Wallboxen, einen Warmwasser-Heizstab und die jeweils freigegebenen Speicher-/Heizpufferausgänge.

[English overview](README.md) · [Vollständige Admin-Feldreferenz](docs/admin-reference.de.md) · [Aktuelle Aufgaben #36](https://github.com/fuchs-1978/ioBroker.ems-optimizer/issues/36) · [Versionsänderungen](README.md#changelog)

Alpha.215 erzeugt vollständige Recorder-Snapshots erst, wenn ein Datensatz ansteht. Befehle, Schutzwechsel und Rohmessungen werden nach den bisherigen Regeln erfasst.

Alpha.214 verwendet die bereits gemessene UTF-8-Bytezahl bei regulären Recorder-Paketen und im Ereignisvorlauf erneut.

Alpha.213 verkürzt den Start mit gespeicherten SQL-Viertelstunden und spart wiederholtes Einlesen und Schreiben im Regeltakt. [Funktionsweise und Grenzen](docs/release-0.17.0-alpha.213.md)

Alpha.212 ergänzt einen getrennten Notbetrieb mit Netzstrom für beide Heizstäbe. [Einstellungen und Schutzgrenzen](docs/release-0.17.0-alpha.212.md)

Alpha.211 wählt bei abgestecktem Wunschfahrzeug den Ersatz nach Abstand zum Ziel-SoC. [Auswahl und Ladestopp](docs/release-0.17.0-alpha.211.md)

Alpha.210 korrigiert die Zeitstempel für Live-Updates der EMS-Diagramme in eCharts. [Details](docs/release-0.17.0-alpha.210.md)

Alpha.209 ergänzt einen separaten Vergleich mit einer interpolierten Lasso-Viertelstunde. [Auswertung und Grenzen](docs/release-0.17.0-alpha.209.md)

Alpha.208 verwendet verfügbare Open-Meteo-Viertelstunden für Wetter und PV in den ersten vier Stunden des Fahrplans und archiviert die detaillierte Wetterreihe. [Quellen und Abdeckung](docs/release-0.17.0-alpha.208.md)

Alpha.207 glättet den gemeinsamen Wärmebedarf für die PV-Brücke und den teureren Preisblock. [Planung und Nachweisgrenzen](docs/release-0.17.0-alpha.207.md)

Alpha.206 glättet geplante Warmwasserspitzen vor einem Tarifanstieg. [Planung und Nachweisgrenzen](docs/release-0.17.0-alpha.206.md)

Alpha.205 kann bei laufender einphasiger Ladung einen bestätigten Rücksprung um 1 A abfangen. Alpha.204 berücksichtigt einen frühen niedrigeren App-SoC nach einer Fahrt. [Stromkorrektur](docs/release-0.17.0-alpha.205.md) · [SoC nach der Fahrt](docs/release-0.17.0-alpha.204.md)

## Inhaltsverzeichnis

- [Installation und Aktualisierung](#installation-und-aktualisierung)
- [Betriebsarten und sichere Zuständigkeit](#betriebsarten-und-sichere-zuständigkeit)
- [Istwertverteilung ohne Fahrplan](#istwertverteilung-ohne-fahrplan)
- [Warmwasserplanung und Vorrang](#warmwasserplanung-und-vorrang)
- [Fahrzeug-SoC und Sitzungswechsel](#fahrzeug-soc-und-sitzungswechsel)
- [Start, Stopp, Übergabe und Phasenwechsel](#start-stopp-übergabe-und-phasenwechsel)
- [EMS-Übersicht und Diagnose](#ems-übersicht-erklärung-datenqualität-und-tagesrückblick)
- [Prognosevergleich](#median-lasso-und-kombinationen)
- [Admin-Bereiche](#so-liest-man-die-admin-anleitung)
- [Offene Arbeiten](#offene-arbeiten)

## Installation und Aktualisierung

Voraussetzungen: Node.js ab 22, js-controller ab 6.0.11 und Admin ab 7.8.23. Die CI prüft Node 22, 24 und 26 unter Ubuntu. Der Adapter befindet sich im Alpha-Test; Softwaretests ersetzen keine vollständige Anlagenabnahme.

Die Alpha-Version wird über **ioBroker Admin → Adapter → Installation aus eigener Quelle → GitHub** installiert. Als Quelle `https://github.com/fuchs-1978/ioBroker.ems-optimizer` eintragen und für eine reproduzierbare Installation den geprüften Stand auswählen. [Alpha.205 auf GitHub](https://github.com/fuchs-1978/ioBroker.ems-optimizer/tree/2db6dfb491231f524913220ad342edfb3539041a)

1. Vorhandene Geräte und echte Quellen im Admin zuordnen; Einheiten und Messgrenzen prüfen.
2. Ausgänge zunächst deaktiviert lassen und Quellen, Plan und Diagnosen prüfen.
3. Geräte einzeln mit den vorgesehenen Freigaben und Schutzgrenzen in Betrieb nehmen.
4. Nach Updates installierte Version mit `System.Version` vergleichen. Zeigt der laufende Prozess noch die alte Version, die EMS-Instanz neu starten und danach Einstellungen/Freigaben prüfen.

Die vollständigen Feldbeschreibungen und Auslieferungswerte stehen in der [Adminreferenz](docs/admin-reference.de.md). Ein SQL-Neustart ist kein allgemeiner Updateschritt.

## Betriebsarten und sichere Zuständigkeit

| Bereich | Bedeutung |
| --- | --- |
| Planung/Beobachtung | Fahrplan, Prognosen und Empfehlungen; keine Bestätigung einer Stellwirkung. |
| Schattenbetrieb | Isolierte modellierte Wallboxantwort bei Master AUS. Kein vollständiges Anlagenmodell für Batterie, Wärme und Fahrzeug-SoC. |
| Livebetrieb | Reale Befehle bei passender Master-, Geräte- und Ausgangsfreigabe sowie gültigen Quellen und Grenzen. |
| Phasenführung | Ein passend konfiguriertes externes Skript schaltet den go-e-Modus. EMS-Ziel, Modus-ACK und elektrische Phasenlage sind getrennte Nachweise. |
| Neue Batterie-/EV-Strategie | Lesende Vorschau; die neue Reserve-/Abfahrts-/Modul-3-Koordination ist noch nicht produktiv integriert. |
| Wärmepumpe | Telemetrie und passive Empfehlungen. WP-, SG-Ready- und KNX-Stellbefehle sind nicht implementiert. |

Pro Stellregister muss genau ein Regler zuständig sein. Mess-, Schutz-, Phasen- und notwendige Pumpenskripte bleiben nach ihrem jeweiligen Vertrag erforderlich. Bei Rückgabe den externen EMS-Phasenfolger passend deaktivieren, EMS-Freigabe entziehen, unabhängiges AUS und elektrische Ruhe prüfen und danach den Folgeregler aktivieren. `OutputOwned=false` allein beweist keine physische Abschaltung.

## Istwertverteilung ohne Fahrplan

Fehlt ein gültiger aktueller Fahrplan, verteilt das EMS verfügbare Leistung weiter anhand gültiger Istwerte. Fahrzeugpriorität, Mindest-SoC/manuelle Vorgaben, EHZ-Temperaturfreigabe und alle Quellen-, Netz-, Phasen- und Gerätegrenzen gelten weiter. `Control.PlanFallbackActive` und `Control.PlanFallbackStatus` zeigen diesen Betrieb an; `Plan.Valid` wird dadurch nicht gültig. Preisfahrplan-Laden, günstiger Netzstrom für Wärme und geplanter PV-Boost bleiben gesperrt. Sobald ein echter aktueller Fahrplan vorliegt, wechselt der Regler automatisch zurück. [Historienwiederherstellung und Grenzen](docs/release-0.17.0-alpha.198.md).

Ein freigegebener EHZ kann während der Startwartezeit auch das vorgemerkte Budget weiterer wartender Fahrzeuge nutzen. Die Autos behalten Vorrang; vor deren Start muss die erforderliche Heizleistung nachweislich zurückgenommen sein. „Aufteilung AUS“ bedeutet keine feste gemeinsame Zuteilung und sperrt diese Restnutzung nicht. Eine entzogene EHZ-Freigabe wird dadurch nicht übergangen. Bei laufender 3P-Mindestladung wird keine neue Startreserve verlangt; gestoppte Fahrzeuge verwenden die konfigurierte Reserve. [Zwischenpuffer und Grenzen](docs/release-0.17.0-alpha.199.md).

## Warmwasserplanung und Vorrang

Der Fahrplan baut die nötige Warmwasserreserve vor einem teureren Preisblock in den letzten nutzbaren günstigeren Intervallen auf. PV, Heizleistung, Speicherplatz und Restzeit begrenzen die Vorziehung. Vor einem günstigeren Fenster kann der Planer die notwendige Überbrückungswärme gleichmäßig über gleich teure Viertelstunden verteilen. Voraussetzung sind ausreichende Mindestreserve und passende Heizgrenzen. Die tatsächliche Heizleistung benötigt eine eigene Freigabe. [Preisvorschau und Grenzen](docs/release-0.17.0-alpha.202.md) · [Änderungen in Alpha.203](README.md#0170-alpha203-2026-11-05)

Der EHZ kann Pflichtwärme liefern, während das bevorzugte Fahrzeug seine bestätigte einphasige Mindestladung hält, wenn beide Lasten ins Budget passen und oben ausreichend warmes Wasser verfügbar ist. Nach einem bestätigten Wärmestopp kann dasselbe Fahrzeug bei frischem Budget und erfüllten Schutz- und Freigabebedingungen früher wieder anlaufen. [Wärmepriorität und Wiederanlauf](docs/release-0.17.0-alpha.201.md)

## Fahrzeug-SoC und Sitzungswechsel

| Situation | Wirksame Quelle / Verhalten |
| --- | --- |
| Bestätigtes Abstecken | Berechnete Basis, gehaltener Schätzwert, manuelle Korrektur und zugehörige Warnung werden verworfen. |
| Danach, bis Ladeenergie in der neuen Sitzung erfasst wird | Gültiger Cloud-/Fahrzeugwert. `SocEstimateStatus = cloud-after-unplug` zeigt das Warten auf die neue Ladebasis an. |
| Neue Ladung bei aktivierter SoC-Schätzung | Letzten gültigen App-Wert mit dem frischen Wallbox-Zähler verankern und anhand der neu gemessenen Energie fortschreiben. |
| Ladebasis stammt von vor dem beobachteten Abstecken | `energy-estimate-provisional-trip` zeigt die vorläufige Schätzung. In den ersten 30 Minuten kann einmalig ein niedrigerer App-Wert mit passendem Zählerstand zur neuen Basis werden. |
| Neue manuelle Eingabe | Geprüften SoC von 0 bis 100 mit `ack=false` nach `Vehicles.WallboxN.SoCCorrection_pct` schreiben. Ein frischer Energiezähler und ein angeschlossenes Fahrzeug sind erforderlich. Nur nachfolgende Energie wird addiert. |
| Manuelle Eingabe zurücknehmen | `-1` schreiben. Status unter `SoCCorrectionActive` und `SoCCorrectionStatus` prüfen. |
| Fehlende oder widersprüchliche Daten einer manuellen Basis | Fortschreibung kann suspendiert werden; keine stillschweigende Übernahme einer alten Cloud-Meldung. |
| Ununterbrochene automatische Ladung ohne Sitzungsende | Vorhandene qualifizierte Fortschreibung bleibt erhalten; verspätete Cloud-Werte können eine Plausibilitätswarnung auslösen. |

Nach einer Fahrt gilt bis zum neuen Ladebeginn der jeweils aktuelle Cloud-Wert. Sobald die Wallbox Ladeenergie erfasst, rechnet das EMS auf dieser Basis weiter. Nach Ablauf der vorläufigen Phase oder Übernahme einer neuen Basis lösen abweichende spätere App-Werte ohne Fahrzeugmesszeitpunkt bei durchgängiger Zählung ab einem Unterschied von mehr als einem Prozentpunkt eine Warnung aus. Der geschätzte SoC bleibt dann wirksam. [Ausnahme und Nachweisgrenzen](docs/release-0.17.0-alpha.204.md) · [Fahrzeugmesszeitpunkt #320](https://github.com/fuchs-1978/ioBroker.ems-optimizer/issues/320).

`SoC_pct` ist der wirksame Regelwert, `ReportedSoC_pct` der gemeldete Wert und `EstimatedSoC_pct` die aktive Fortschreibung. [Vollständiger SoC-Vertrag](docs/admin-reference.de.md#optionale-soc-schätzung-aus-ladeenergie-alle-drei-fahrzeuge)

### Start, Stopp, Übergabe und Phasenwechsel

Eine beobachtete EMS-Ladung kann unter den vorgesehenen Bedingungen ihre Startqualifikation übertragen. Das bisherige Fahrzeug bleibt bis zum unabhängigen AUS-ACK und zur bestätigten elektrischen Ruhe reserviert; erst freies Budget erlaubt den Empfängerstart. Ein angestecktes Fahrzeug oder ein erfolgreich geschriebener Befehl ist noch keine bestätigte Ladung.

Bei anhaltend begrenzter Aufnahme kann das EMS den Bedarf des weiterladenden Fahrzeugs begrenzen und seinen Befehl absenken. Das nächste Fahrzeug erhält Budget erst nach qualifizierter Freigabe der alten nominalen Reserve. Dieser Fall ist getrennt vom vollständigen Ladeende zu prüfen. [Budgetweitergabe](docs/release-0.17.0-alpha.195.md).

Frisches go-e-Finish nach vorheriger eigener Ladung und zehn Sekunden bestätigter elektrischer Ruhe kann Ladeende und anschließende Übergabe auslösen. Der Hinweis bittet um Prüfung von SoC und Fahrzeuglimit. [Ladeende](docs/release-0.17.0-alpha.194.md) · [Reale Abnahmereste #7](https://github.com/fuchs-1978/ioBroker.ems-optimizer/issues/7).

Melden beide go-e-Stromdatenpunkte nach einem bestätigten 1‑A‑Schritt den vorherigen niedrigeren Strom, kann das EMS eine laufende einphasige Ladung einmalig übernehmen. Eine frische elektrische Messung muss dazu passen. Das EMS fordert höchstens diesen niedrigeren Wert an und senkt ihn bei kleinerem Budget weiter. Beide Rückmeldungen müssen den neuen Auftrag innerhalb der vorhandenen Frist bestätigen. Bei fehlender Bestätigung oder einer verletzten Schutzgrenze greift der Stopp. [Alpha.205 und Nachweisgrenzen](docs/release-0.17.0-alpha.205.md)

## EMS-Übersicht: Erklärung, Datenqualität und Tagesrückblick

Der erste Admin-Reiter zeigt **Betriebszustand**, **aktuelle Hinweise** und **Geräte auf einen Blick**. Fahrplan/Batterievorschau, Tagesbilanzen und technische Diagnose lassen sich darunter aufklappen. Alle Anzeigen sind lesend.

| Zustände relativ zur Instanz | Wofür sie stehen |
| --- | --- |
| `System.Version` | Laufende Adapterversion. |
| `Diagnostics.*` | Übersicht, aktuelle Hinweise, Planerklärung, Tagesbilanzen und technische Details. |
| `Control.*` | Gültigkeit, Zuteilung, Budgets und Phasenentscheidungen. |
| `Devices.WallboxN.*` | Aufträge, ACK-/Antwortstatus, Reserven, Eigentum und Ausgangsfehler. |
| `Vehicles.WallboxN.*` | Gemeldeter/wirksamer SoC, Quelle, manuelle Korrektur und Ladeziele. |
| `Debug.DailySummary_JSON` | Begrenzte persistente Leistungsintegrale und Ereignisse pro Berlin-20-Uhr-Periode. |
| `Debug.Shadow.RecordDeliveryStatus` | Originalzustellung, Rückstand und unabhängige SQL-Bestätigung. |
| `Debug.Shadow.RecordWriterStatus`, `RecordReaderStatus` | Getrennte Schreib-/Leseprüfung einschließlich offener oder unbekannt abgeschlossener Anfrage. |
| `Forecast.LoadComparison.*` | Vorab gespeicherte Modellprognosen und paarweise Ist-Auswertung. |

Die vollständige ID beginnt beispielsweise mit `ems-optimizer.0.`. Sollwert, Geräte-ACK und elektrische Wirkung getrennt lesen. Bei der Stromantwortdiagnose bedeutet `superseded`, dass ein neuer Befehl den noch offenen Vorgang abgelöst hat; unvollständige Nachweise bleiben innerhalb ihrer ursprünglichen Frist offen. Solche Ereignisse belegen allein keinen Gerätefehler.

### SQL-Wiederherstellung und historische Lücken

Recorderaufnahme, exakte SQL-Speicherbestätigung und externe historische Abrufbarkeit sind getrennte Qualitätsfragen. Ohne angebundenen externen Prüfbericht steht die Historie auf **„nicht geprüft“**. Tagesenergie aus Leistungsintegralen ist eine Schätzung; unbekannte Zeit, historische Zielerreichung und Kosten werden nicht als Null oder Erfolg ausgegeben.

Ein hängender Verifikationsleser sperrt weitere Prüfqueries, während begrenzte neue Veröffentlichungen weiterlaufen können. Unbestätigte Originale werden nicht nach Alter gelöscht; endliche Kapazität und neue Verluste bleiben sichtbar. Eine frische Bestätigung heilt frühere Verluste nicht. Ein unbekannter SQL-Abschluss darf nicht erzwungen quittiert werden. [Diagnose und qualifizierte Recovery](docs/admin-reference.de.md#diagnose-sql-und-datenqualität) · [Offene technische Ursache #60](https://github.com/fuchs-1978/ioBroker.ems-optimizer/issues/60).

### Median, Lasso und Kombinationen

Der passive Vergleich stellt Median, Lasso, feste 50/50-Mischung und Lasso-Tagesenergie mit Median-Verlauf gegenüber. Prognosen werden vorab gespeichert und bei Neustart nicht rückwirkend ersetzt. Training startet beim Adapterstart und täglich um 00:10, mit höchstens 84 Tagen.

Die Istwerte werden aus zeitgewichteten Rohmessungen auf gemeinsamen Viertelstunden berechnet. Lücken bleiben unbekannt. MAE, RMSE und Energiefehler nur für dieselben gültigen Messpaare vergleichen. Die 7-/14‑Kalendertage-Fenster zeigen die Abdeckung. Eine Tagesenergie erfordert 96 gültige Paare. Tage mit 92 oder 100 Viertelstunden sind derzeit ausgeschlossen. Die produktive Profilwahl erfolgt separat. [Berechnung und Grenzen](docs/release-0.17.0-alpha.200.md) · [Aktueller Vergleich #284](https://github.com/fuchs-1978/ioBroker.ems-optimizer/issues/284)

## So liest man die Admin-Anleitung

Die [vollständige Adminreferenz](docs/admin-reference.de.md) enthält alle bisherigen Feldtabellen, Schlüssel, Auslieferungswerte und technischen Grenzen. Die folgenden Einstiegspunkte halten auch die bisherigen Bereichslinks erreichbar.

### Admin: Allgemein

[Master-, Geräte- und gemeinsame Ausgangsfreigaben](docs/admin-reference.de.md#admin-allgemein).

### Admin: Netzanschluss / §14a / EEBUS

[Hausanschluss, Phasenquellen, Teilnehmergruppe und Budgetarten](docs/admin-reference.de.md#admin-netzanschluss--14a--eebus). LPC/groupNet-Integration bleibt [#166](https://github.com/fuchs-1978/ioBroker.ems-optimizer/issues/166).

### Admin: Messwerte

[PV, Netz, Haushalt, BHKW und Quellenzeiten](docs/admin-reference.de.md#admin-messwerte). Nur Verbraucher abziehen, die tatsächlich innerhalb der gewählten Messgrenze liegen.

### Admin: Historie und Prognose

[Historien-, Wetter-, Raum- und Prognosequellen](docs/admin-reference.de.md#admin-historie-und-prognose).

### Admin: Preise und Tarife

[Gesamtpreis, Zeitfenster und bestehende Preisladung](docs/admin-reference.de.md#admin-preise-und-tarife).

### Admin: Wallboxen allgemein

[Gemeinsame Zuteilung, Mindeststrom, Prioritäten und Timer](docs/admin-reference.de.md#admin-wallboxen-allgemein).

### Admin: Wallbox 0, 1 und 2

[Geräte-/SoC-/Leistungsquellen, Stromgrenzen und Ausgangsvertrag](docs/admin-reference.de.md#admin-wallbox-0-1-und-2). Fahrzeugnummer und reale Zuordnung im Admin prüfen.

### Admin: Warmwasser-Heizstab

[Temperaturen, Leistungsgrenzen, Freigaben und my-PV-Rückmeldung](docs/admin-reference.de.md#admin-warmwasser-heizstab). Das Schichtungsminimum kann kleinen Restüberschuss ungenutzt lassen.

### Admin: Heizpuffer

[Getrennter Heizpufferausgang und thermische Grenzen](docs/admin-reference.de.md#admin-heizpuffer).

### Admin: Batteriespeicher

[SunEnergy-Kopfprofile, Gerätegrenzen, Temperaturreserve und bestehende Preisplanung](docs/admin-reference.de.md#admin-batteriespeicher). Die neue Batterie-/Fahrzeugstrategie bleibt Vorschau; produktive Integration [#25](https://github.com/fuchs-1978/ioBroker.ems-optimizer/issues/25).

### Admin: Wärmepumpe

[Telemetrie und passive Empfehlungen](docs/admin-reference.de.md#admin-wärmepumpe).

### Admin: Wärmestrategie

[Vorhandene thermische Planungsparameter](docs/admin-reference.de.md#admin-wärmestrategie). Erweiterung mit realer WP bleibt [#160](https://github.com/fuchs-1978/ioBroker.ems-optimizer/issues/160).

### Admin: Echtzeitregelung

[NVP-Regelung und Echtzeitsimulation](docs/admin-reference.de.md#admin-echtzeitregelung).

### Admin: Erweiterte Datenpunkte

[Zusätzliche Quellen und konkrete Objektzuordnung](docs/admin-reference.de.md#admin-erweiterte-datenpunkte).

### Mobilitätsreserve und vorhandene Abfahrtszeit

[Reserveobjekt und bestehende Fristen](docs/admin-reference.de.md#mobilitätsreserve-und-vorhandene-abfahrtszeit). Reserve/Abfahrt sind für die neue Strategie lesend vorbereitet; die produktive Umstellung bleibt #25. Ein Reservewert allein gibt keine Netzladung frei.

## Typische Einrichtung und Fehlersuche

Zuerst reale Gerätefreigabe, gültige Quellen und gemeinsame Zuteilung prüfen, danach Befehls-/ACK-/Leistungskette. [FAQ zu Preis-/Nachtladung, Priorität, Aufteilung, Phasen und Wärme](docs/admin-reference.de.md#typische-einrichtung-und-fehlersuche).

## Diagnose, SQL und Datenqualität

[Technische Referenz einschließlich Journal-Speicherort und SQL-Recovery](docs/admin-reference.de.md#diagnose-sql-und-datenqualität). Für Meldungen Version, Ereigniszeit mit Zeitzone, betroffenes Gerät und einen kleinen passenden Diagnoseausschnitt angeben. [Support](SUPPORT.md).

## Offene Arbeiten

Die [Roadmap #36](https://github.com/fuchs-1978/ioBroker.ems-optimizer/issues/36) ordnet die offenen Nachweise und Integrationen. Für die aktuelle Version stehen insbesondere der Live-Nachweis der SoC-Fortschreibung nach einer Fahrt, die Wärmeplanung und ein realer Fall der 1‑A‑Wiederübernahme aus. [Betriebsabnahme #7](https://github.com/fuchs-1978/ioBroker.ems-optimizer/issues/7) · [go-e-Rückmeldungen #216](https://github.com/fuchs-1978/ioBroker.ems-optimizer/issues/216) · [SoC-Quellzeit #320](https://github.com/fuchs-1978/ioBroker.ems-optimizer/issues/320)

Abgeschlossene Tagesberichte bleiben datierte Belege. Die [Bereinigung vom 03.11.2026](docs/issue-audit/2026-11-03/README.md) dokumentiert Übergaben und erhält die ursprünglichen Issue-Texte. [Übersetzungsstand](docs/translations.md) · [Aktuelle Änderungen](README.md#changelog) · [Ältere Versionen](CHANGELOG_OLD.md).
