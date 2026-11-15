# EMS Optimizer

**Aktuelle Adapterversion 0.17.0-alpha.285.** EMS Optimizer verbindet PV-/Netzmessungen, Last- und Wetterprognosen sowie Strompreise zu einem rollierenden 48-Stunden-Fahrplan. Die Echtzeitregelung koordiniert bis zu drei Wallboxen, einen Warmwasser-Heizstab und die jeweils freigegebenen Speicher-/Heizpufferausgänge.

[English overview](README.md) · [Vollständige Admin-Feldreferenz](docs/admin-reference.de.md) · [Aktuelle Aufgaben #36](https://github.com/fuchs-1978/ioBroker.ems-optimizer/issues/36) · [Versionsänderungen](README.md#changelog)

## Aktuelle Änderungen

- **Alpha.285** bündelt kleine Lade- und Entladeleistungen auf einem Kopf und wechselt bei ähnlichem SoC die Startreihenfolge. Die Admin-Vorgaben sind 500 W und 5 Prozentpunkte. [Versionshinweise](docs/release-0.17.0-alpha.285.md)
- **Alpha.284** verteilt die geplante Warmwasserleistung im wiederkehrenden günstigen Nachtblock gleichmäßiger. [Versionshinweise](docs/release-0.17.0-alpha.284.md)
- **Alpha.283** verwirft überholte Speicher-Richtungswechsel vor der Ausgabe und berechnet den Sollwert mit der nächsten gültigen Netzmessung neu. Der zuletzt gesendete Auftrag darf innerhalb der aktuellen Schutzgrenzen weiterlaufen. [Versionshinweise](docs/release-0.17.0-alpha.283.md)
- **Alpha.282** kann WB1 (EQV) ab 800 W stabilem Tagesüberschuss einphasig mit 6 A starten. Ein nahezu voller Speicher liefert die fehlende Leistung bis 600 W. Steigender Überschuss kann wieder in den Speicher fließen. [Versionshinweise](docs/release-0.17.0-alpha.282.md)
- **Alpha.281** nimmt vor der Übertragung verworfene Speicheraufträge zurück. Der Regler bewertet die nächste Messung ausgehend vom letzten gesendeten Auftrag oder bestätigten Stillstand. [Versionshinweise](docs/release-0.17.0-alpha.281.md)
- **Alpha.280** zählt beim Einzelkopf aufeinanderfolgende gesendete GS-Aufträge ohne frische GS-Rückmeldung. GP dient zur Prüfung der tatsächlich wirksamen Leistung und der Leistungsreserve. [Versionshinweise](docs/release-0.17.0-alpha.280.md)
- **Alpha.279** lässt einen einzelnen SunEnergy-Kopf nach zwei Minuten nahe seiner Ladegrenze bei gemessener Einspeisung Leistung für den Wallboxstart freigeben. Der Speicher lädt danach mit dem verbleibenden Überschuss. [Versionshinweise](docs/release-0.17.0-alpha.279.md)

[Ältere Versionshinweise](CHANGELOG_OLD.md#deutsche-versionshistorie)

## Inhaltsverzeichnis

- [Installation und Aktualisierung](#installation-und-aktualisierung)
- [Betriebsarten und sichere Zuständigkeit](#betriebsarten-und-sichere-zuständigkeit)
- [Istwertverteilung ohne Fahrplan](#istwertverteilung-ohne-fahrplan)
- [Speicher-Nullregelung](#speicher-nullregelung)
- [Warmwasserplanung und Vorrang](#warmwasserplanung-und-vorrang)
- [Fahrzeug-SoC und Sitzungswechsel](#fahrzeug-soc-und-sitzungswechsel)
- [Mobilitätsreserve und Ladefenster](#mobilitätsreserve-und-vorhandene-abfahrtszeit)
- [Start, Stopp, Übergabe und Phasenwechsel](#start-stopp-übergabe-und-phasenwechsel)
- [EMS-Übersicht und Diagnose](#ems-übersicht-erklärung-datenqualität-und-tagesrückblick)
- [Prognosevergleich](#median-lasso-und-kombinationen)
- [Admin-Bereiche](#so-liest-man-die-admin-anleitung)
- [Offene Arbeiten](#offene-arbeiten)

## Installation und Aktualisierung

Voraussetzungen: Node.js ab 22, js-controller ab 6.0.11 und Admin ab 7.8.23. Die CI prüft Node 22, 24 und 26 unter Ubuntu. Der Adapter befindet sich im Alpha-Test; Softwaretests ersetzen keine vollständige Anlagenabnahme.

Die Alpha-Version wird über **ioBroker Admin → Adapter → Installation aus eigener Quelle → GitHub** installiert. Als Quelle `https://github.com/fuchs-1978/ioBroker.ems-optimizer` eintragen. Für eine reproduzierbare Installation den Commit des gewünschten geprüften Stands auswählen. [Prüfläufe für `main`](https://github.com/fuchs-1978/ioBroker.ems-optimizer/actions/workflows/test-and-release.yml?query=branch%3Amain)

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
| Fahrzeugladung zur Abfahrt | Optionale Planung des Mindest-SoC und sofortige Mobilitätsreserve je Fahrzeug. |
| Batteriestrategie | Optionale PV-Abstimmung von Speicher und Wallbox im Regler. Die gemeinsame Reserve- und Nachtplanung ist als lesende Vorschau verfügbar. |
| Wärmepumpe | Telemetrie und passive Empfehlungen. WP-, SG-Ready- und KNX-Stellbefehle sind nicht implementiert. |

Pro Stellregister muss genau ein Regler zuständig sein. Mess-, Schutz-, Phasen- und notwendige Pumpenskripte bleiben nach ihrem jeweiligen Vertrag erforderlich. Bei Rückgabe den externen EMS-Phasenfolger passend deaktivieren, EMS-Freigabe entziehen, unabhängiges AUS und elektrische Ruhe prüfen und danach den Folgeregler aktivieren. `OutputOwned=false` allein beweist keine physische Abschaltung.

## Istwertverteilung ohne Fahrplan

Fehlt ein gültiger aktueller Fahrplan, verteilt das EMS verfügbare Leistung weiter anhand gültiger Istwerte. Fahrzeugpriorität, Mindest-SoC/manuelle Vorgaben, EHZ-Temperaturfreigabe und alle Quellen-, Netz-, Phasen- und Gerätegrenzen gelten weiter. `Control.PlanFallbackActive` und `Control.PlanFallbackStatus` zeigen diesen Betrieb an; `Plan.Valid` wird dadurch nicht gültig. Preisfahrplan-Laden, günstiger Netzstrom für Wärme und geplanter PV-Boost bleiben gesperrt. Sobald ein echter aktueller Fahrplan vorliegt, wechselt der Regler automatisch zurück. [Historienwiederherstellung und Grenzen](docs/release-0.17.0-alpha.198.md).

Ein freigegebener EHZ kann während der Startwartezeit auch das vorgemerkte Budget weiterer wartender Fahrzeuge nutzen. Die Autos behalten Vorrang; vor deren Start muss die erforderliche Heizleistung nachweislich zurückgenommen sein. „Aufteilung AUS“ bedeutet keine feste gemeinsame Zuteilung und sperrt diese Restnutzung nicht. Eine entzogene EHZ-Freigabe wird dadurch nicht übergangen. Bei laufender 3P-Mindestladung wird keine neue Startreserve verlangt; gestoppte Fahrzeuge verwenden die konfigurierte Reserve. [Zwischenpuffer und Grenzen](docs/release-0.17.0-alpha.199.md).

## Speicher-Nullregelung

Nach einer abgeschlossenen SoC-Etappe gibt die optionale Speicher- und Wallbox-Koordination die vorgemerkte PV-Reserve frei. Der Live-Regler lädt mit dem verbleibenden Überschuss am Netzanschlusspunkt, auch wenn er vom BHKW kommt. Maßgeblich sind der Netzsollwert, das Speicher-Totband sowie die aktuell nutzbaren Leistungs- und SoC-Grenzen.

Bei 10 W Totband macht 1 W Netzbezug aus einem laufenden 11‑W‑Ladeauftrag 10 W. Ein freigegebener SunEnergy-Einzelkopf erhält den kleineren Ladeauftrag auch bei offener Rückmeldung. Ein direkter Richtungswechsel ist in beiden Richtungen möglich, wenn nach Abzug der bisherigen Speicherwirkung genügend Bezug oder Überschuss übrig bleibt. [Rechenbeispiele, Vorzeichen und Diagnose](docs/admin-reference.de.md#live-regelung-des-speichers)

## Warmwasserplanung und Vorrang

Der Fahrplan baut die nötige Warmwasserreserve vor einem teureren Preisblock in den letzten nutzbaren günstigeren Intervallen auf. PV, Heizleistung, Speicherplatz und Restzeit begrenzen die Vorziehung. Vor einem günstigeren Fenster kann der Planer die notwendige Überbrückungswärme gleichmäßig über gleich teure Viertelstunden verteilen. Voraussetzung sind ausreichende Mindestreserve und passende Heizgrenzen. Die tatsächliche Heizleistung benötigt eine eigene Freigabe. [Preisvorschau und Grenzen](docs/release-0.17.0-alpha.202.md) · [Änderungen in Alpha.203](CHANGELOG_OLD.md#0170-alpha203-2026-11-05)

Der EHZ kann Pflichtwärme liefern, während das bevorzugte Fahrzeug seine bestätigte einphasige Mindestladung hält, wenn beide Lasten ins Budget passen und oben ausreichend warmes Wasser verfügbar ist. Nach einem bestätigten Wärmestopp kann dasselbe Fahrzeug bei frischem Budget und erfüllten Schutz- und Freigabebedingungen früher wieder anlaufen. [Wärmepriorität und Wiederanlauf](docs/release-0.17.0-alpha.201.md)

## Fahrzeug-SoC und Sitzungswechsel

| Situation | Wirksame Quelle / Verhalten |
| --- | --- |
| Bestätigtes Abstecken | Berechnete Basis, gehaltener Schätzwert, manuelle Korrektur und zugehörige Warnung werden verworfen. |
| Danach, bis Ladeenergie in der neuen Sitzung erfasst wird | Gültiger Cloud-/Fahrzeugwert. `SocEstimateStatus = cloud-after-unplug` zeigt das Warten auf die neue Ladebasis an. |
| Neue Ladung bei aktivierter SoC-Schätzung | Letzten gültigen App-Wert mit dem frischen Wallbox-Zähler verankern und anhand der neu gemessenen Energie fortschreiben. |
| Ladebasis stammt von vor dem beobachteten Abstecken | `energy-estimate-provisional-trip` zeigt die vorläufige Schätzung. In den ersten 30 Minuten kann einmalig ein niedrigerer App-Wert mit passendem Zählerstand zur neuen Basis werden. |
| Neue manuelle Eingabe | Geprüften SoC von 0 bis 100 mit `ack=false` nach `Vehicles.WallboxN.SoCCorrection_pct` schreiben. Bei bestätigtem Abstecken wird er für das nächste Anstecken innerhalb von 30 Minuten vorgemerkt. Er gilt ab der ersten Ladeentscheidung. Die Fortschreibung beginnt mit dem frischen Energiezählerstand der neuen Sitzung. |
| Manuelle Eingabe zurücknehmen | `-1` schreiben. Status unter `SoCCorrectionActive` und `SoCCorrectionStatus` prüfen. |
| Fehlende oder widersprüchliche Daten einer manuellen Basis | Fortschreibung kann suspendiert werden; keine stillschweigende Übernahme einer alten Cloud-Meldung. |
| Ununterbrochene automatische Ladung ohne Sitzungsende | Vorhandene qualifizierte Fortschreibung bleibt erhalten; verspätete Cloud-Werte können eine Plausibilitätswarnung auslösen. |

Nach einer Fahrt gilt bis zum neuen Ladebeginn der jeweils aktuelle Cloud-Wert. Sobald die Wallbox Ladeenergie erfasst, rechnet das EMS auf dieser Basis weiter. Nach Ablauf der vorläufigen Phase oder Übernahme einer neuen Basis lösen abweichende spätere App-Werte ohne Fahrzeugmesszeitpunkt bei durchgängiger Zählung ab einem Unterschied von mehr als einem Prozentpunkt eine Warnung aus. Der geschätzte SoC bleibt dann wirksam. [Ausnahme und Nachweisgrenzen](docs/release-0.17.0-alpha.204.md) · [Fahrzeugmesszeitpunkt #320](https://github.com/fuchs-1978/ioBroker.ems-optimizer/issues/320).

`SoC_pct` ist der wirksame Regelwert, `ReportedSoC_pct` der gemeldete Wert und `EstimatedSoC_pct` die aktive Fortschreibung. [Vollständiger SoC-Vertrag](docs/admin-reference.de.md#optionale-soc-schätzung-aus-ladeenergie-alle-drei-fahrzeuge)

### Mobilitätsreserve und vorhandene Abfahrtszeit

Der Haken **Mindest-SoC bis zur Abfahrt einplanen** steht je Wallbox standardmäßig auf **Aus**. Bei Ladefreigabe gilt damit die Sofortladung bis zum Mindest-SoC. Für die Terminplanung braucht das EMS eine gültige Abfahrtszeit und Preisladesitzung, die Abfahrts- und Preis-Netzladefreigabe sowie eine Mobilitätsreserve größer 0 % und unter dem Mindest-SoC.

Unterhalb der Mobilitätsreserve lädt das EMS sofort. Für den restlichen Mindestbedarf rechnet es die bis zur Abfahrt nutzbare PV an und wählt Viertelstunden nach dem niedrigsten Gesamtpreis inklusive Netzentgelt. Bei festem Energiepreis und zeitvariablem Netzentgelt nutzt es zuerst den Niedrigtarif, bei Bedarf den Standardtarif und zuletzt den Hochtarif. Die Preisobergrenze gilt für die freiwillige Netzladung bis zum Ziel-SoC. Bei fehlendem oder rechnerisch unzureichendem Plan greift die Sofortladung bis zum Mindest-SoC. [Admin-Referenz](docs/admin-reference.de.md#mobilitätsreserve-und-vorhandene-abfahrtszeit) · [Versionshinweise](docs/release-0.17.0-alpha.222.md)

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

Die Admin-Referenz beschreibt Kopfzuordnung, SoC-Grenzen, Speichervorrang und die Pufferung von Wallbox-Stromschritten. [Speicherfelder im Admin](docs/admin-reference.de.md#admin-batteriespeicher) · [Integration und Abnahme #25](https://github.com/fuchs-1978/ioBroker.ems-optimizer/issues/25)

### Admin: Wärmepumpe

[Telemetrie und passive Empfehlungen](docs/admin-reference.de.md#admin-wärmepumpe).

### Admin: Wärmestrategie

[Vorhandene thermische Planungsparameter](docs/admin-reference.de.md#admin-wärmestrategie). Erweiterung mit realer WP bleibt [#160](https://github.com/fuchs-1978/ioBroker.ems-optimizer/issues/160).

### Admin: Echtzeitregelung

[NVP-Regelung und Echtzeitsimulation](docs/admin-reference.de.md#admin-echtzeitregelung).

### Admin: Erweiterte Datenpunkte

[Zusätzliche Quellen und konkrete Objektzuordnung](docs/admin-reference.de.md#admin-erweiterte-datenpunkte).

## Typische Einrichtung und Fehlersuche

Zuerst reale Gerätefreigabe, gültige Quellen und gemeinsame Zuteilung prüfen, danach Befehls-/ACK-/Leistungskette. [FAQ zu Preis-/Nachtladung, Priorität, Aufteilung, Phasen und Wärme](docs/admin-reference.de.md#typische-einrichtung-und-fehlersuche).

## Diagnose, SQL und Datenqualität

[Technische Referenz einschließlich Journal-Speicherort und SQL-Recovery](docs/admin-reference.de.md#diagnose-sql-und-datenqualität). Für Meldungen Version, Ereigniszeit mit Zeitzone, betroffenes Gerät und einen kleinen passenden Diagnoseausschnitt angeben. [Support](SUPPORT.md).

## Offene Arbeiten

Die [Issue-Sichtung zu Alpha.275](docs/issue-audit/2026-11-15/README.md) hält den Stand der offenen Aufgaben und datierten Berichte fest. Die Speicherabnahme umfasst die NVP-Regelung, kleine Ladeaufträge und die zeitliche Zuordnung von Befehl, Istleistung und Netzmessung. [Speicherintegration #25](https://github.com/fuchs-1978/ioBroker.ems-optimizer/issues/25) · [Ladestopps #410](https://github.com/fuchs-1978/ioBroker.ems-optimizer/issues/410) · [Sprungantwort #423](https://github.com/fuchs-1978/ioBroker.ems-optimizer/issues/423)

Die [Roadmap #36](https://github.com/fuchs-1978/ioBroker.ems-optimizer/issues/36) verknüpft die Betriebsabnahme und Integrationen. Frühere Berichte und Übergaben stehen in der [Sichtung vom 03.11.2026](docs/issue-audit/2026-11-03/README.md). [Übersetzungsstand](docs/translations.md) · [Ältere Versionen](CHANGELOG_OLD.md#deutsche-versionshistorie)
