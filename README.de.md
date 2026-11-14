# EMS Optimizer

**Aktuelle Adapterversion 0.17.0-alpha.267.** EMS Optimizer verbindet PV-/Netzmessungen, Last- und Wetterprognosen sowie Strompreise zu einem rollierenden 48-Stunden-Fahrplan. Die Echtzeitregelung koordiniert bis zu drei Wallboxen, einen Warmwasser-Heizstab und die jeweils freigegebenen Speicher-/Heizpufferausgänge.

[English overview](README.md) · [Vollständige Admin-Feldreferenz](docs/admin-reference.de.md) · [Aktuelle Aufgaben #36](https://github.com/fuchs-1978/ioBroker.ems-optimizer/issues/36) · [Versionsänderungen](README.md#changelog)

## Aktuelle Änderungen

- **Alpha.267** ergänzt die 6-A-Ladung des Mii tagsüber mit bis zu 500 W aus dem Speicher. Nach dem Abschalten lädt der Speicher aus dem verbleibenden Überschuss nach. [Versionshinweise](docs/release-0.17.0-alpha.267.md)
- **Alpha.266** pausiert freiwillige Autoladung bei der geplanten PV-Schlussladung sofort, wenn der ladebereite Speicher den gemessenen Überschuss beansprucht und für die Wallbox zu wenig übrig bleibt. [Versionshinweise](docs/release-0.17.0-alpha.266.md)
- **Alpha.265** nutzt die bestehende Nulltoleranz für go-e auch im gemeinsamen Verbrauchs- und Phasenbudget. Ein Messwert von −10 W beim Anlauf entzieht der Wallbox dadurch nicht mehr die Ladefreigabe. [Versionshinweise](docs/release-0.17.0-alpha.265.md)
- **Alpha.264** regelt eine laufende einphasige Wallbox bei einem belegten Rücksprung nach einem PV-Schritt um 1 A herunter und lässt die Ladefreigabe aktiv. [Versionshinweise](docs/release-0.17.0-alpha.264.md)
- **Alpha.263** puffert Netzbezug beim Abregeln einer laufenden PV-Wallbox und während ihrer Ausschaltverzögerung. Für diese Entladung gilt eine SoC-Untergrenze von 70 %. [Versionshinweise](docs/release-0.17.0-alpha.263.md)
- **Alpha.262** pausiert die PV-Speicherladung am erreichten SoC-Ziel. Bis zum nächsten höheren Fahrplanziel steht der Überschuss den Wallboxen zur Verfügung. [Versionshinweise](docs/release-0.17.0-alpha.262.md)
- **Alpha.261** bildet die SoC-Stufen und die Übergabe ans Auto im Fahrplan ab. Im Reiter PV-Korrektur lassen sich zwölf Faktoren pro Anlage pflegen. [Versionshinweise](docs/release-0.17.0-alpha.261.md)
- **Alpha.260** zählt stabil gemessenen Speicherüberschuss für den Wallboxstart und priorisiert Speicher und Auto vor optionaler PV-Wärme. [Versionshinweise](docs/release-0.17.0-alpha.260.md)
- **Alpha.259** hält bestätigte SunEnergy-Entladeaufträge bei kleinen Netzabweichungen, führt die Entladegrenze bei belegter Minderleistung nach und teilt PV-Überschuss früher mit der Wallbox. [Versionshinweise](docs/release-0.17.0-alpha.259.md)
- **Alpha.258** erfasst im Recorder je SunEnergy-Kopf die Zeit bis zum Sollwert-Echo und bis zur gemessenen AC-Reaktion. [Versionshinweise](docs/release-0.17.0-alpha.258.md)
- **Alpha.257** setzt die SunEnergy-Regelung nach einer eindeutig verspäteten Rückmeldung und bestätigtem Stillstand fort. Im PV-Beobachtungsmodus kann steigender Überschuss einen wirkungslosen Kleinladeauftrag ablösen. [Versionshinweise](docs/release-0.17.0-alpha.257.md)
- **Alpha.256** berücksichtigt bei der SunEnergy-Haushaltsentladung kurzzeitig versetzte Rückmeldungen und berechnet überholte Entladekorrekturen erneut. [Versionshinweise](docs/release-0.17.0-alpha.256.md)
- **Alpha.255** reduziert bestätigte SunEnergy-Entladeaufträge bei kurzer Einspeisung direkt, wenn weiter Haushaltsbedarf besteht. [Versionshinweise](docs/release-0.17.0-alpha.255.md)
- **Alpha.254** hält bestätigte SunEnergy-Entladeaufträge bei kleiner AC-Minderleistung an der Entladegrenze. [Versionshinweise](docs/release-0.17.0-alpha.254.md)
- **Alpha.253** lädt SunEnergy bei unterschrittenem Mindest-SoC mit bis zu 1.000 W nach. [Versionshinweise](docs/release-0.17.0-alpha.253.md)
- **Alpha.252** ergänzt optional die nächtliche Mii-Ladung mit BHKW-Überschuss und Speicherpuffer. [Versionshinweise](docs/release-0.17.0-alpha.252.md)
- **Alpha.251** setzt einen SunEnergy-Richtungswechsel nach bestätigtem Nullbefehl und gemessenem Stillstand früher fort. [Versionshinweise](docs/release-0.17.0-alpha.251.md)
- **Alpha.250** senkt den bestätigten SunEnergy-Entladeauftrag auch bei der Haushaltsentladung direkt. [Versionshinweise](docs/release-0.17.0-alpha.250.md)
- **Alpha.249** senkt beim Wallbox-Puffern den bestätigten SunEnergy-Entladeauftrag direkt. [Versionshinweise](docs/release-0.17.0-alpha.249.md)
- **Alpha.248** gibt SunEnergy-Altaufträge nach mehreren frischen Nullrückmeldungen automatisch frei. [Versionshinweise](docs/release-0.17.0-alpha.248.md)
- **Alpha.247** überbrückt einen PV-Fehlbetrag während der Wallbox-Ausschaltverzögerung aus dem SunEnergy-Speicher. [Versionshinweise](docs/release-0.17.0-alpha.247.md)
- **Alpha.246** übernimmt bei einem regulären Neustart bestätigte SunEnergy-Lade- und Entladeaufträge. [Versionshinweise](docs/release-0.17.0-alpha.246.md)
- **Alpha.245** wartet bei sinkendem Entladeziel oder Neustart kurz auf eine ausstehende SunEnergy-Bestätigung. [Versionshinweise](docs/release-0.17.0-alpha.245.md)
- **Alpha.244** gibt bestätigte SunEnergy-Entladeaufträge nach frischer Nullrückmeldung automatisch frei. [Versionshinweise](docs/release-0.17.0-alpha.244.md)
- **Alpha.243** korrigiert den SunEnergy-Ladeauftrag im Beobachtungsmodus anhand der gemessenen Abweichung am Netzanschlusspunkt. [Versionshinweise](docs/release-0.17.0-alpha.243.md)
- **Alpha.242** gibt einer ausstehenden SunEnergy-Laderückmeldung bei regulärem Neustart kurz Zeit vor dem Nullbefehl. [Versionshinweise](docs/release-0.17.0-alpha.242.md)
- **Alpha.241** hält laufende Ladeschritte bis zur Rückmeldung und speichert die GS-Bestätigung für den Wiederanlauf. [Versionshinweise](docs/release-0.17.0-alpha.241.md)
- **Alpha.240** nimmt die SunEnergy-Regelung nach einem Neustart automatisch wieder auf, sobald die Rückgabe des bekannten Auftrags bestätigt ist. [Versionshinweise](docs/release-0.17.0-alpha.240.md)
- **Alpha.239** nutzt im SunEnergy-Beobachtungsmodus nach bestätigter Ladeleistung wieder die eingestellte Schrittweite, begrenzt durch die aktuelle Einspeisung. [Versionshinweise](docs/release-0.17.0-alpha.239.md)
- **Alpha.238** hält im SunEnergy-Beobachtungsmodus einen offenen Ladeauftrag auch bei vorübergehendem Netzbezug. [Versionshinweise](docs/release-0.17.0-alpha.238.md)
- **Alpha.237** ergänzt einen optionalen Beobachtungsmodus für die SunEnergy-PV-Laderückmeldung. [Versionshinweise](docs/release-0.17.0-alpha.237.md)
- **Alpha.236** wartet beim XT500 bei einem PV-Einbruch kurz auf die Bestätigung des gerade gesendeten Ladestarts. [Versionshinweise](docs/release-0.17.0-alpha.236.md)
- **Alpha.235** senkt beim einzelnen SunEnergy-Kopf einen bestätigten PV-Ladeauftrag auch bei nachlaufender Istleistung. Beim Hochregeln geht jeder Schritt von der gemessenen Leistung aus. [Versionshinweise](docs/release-0.17.0-alpha.235.md)
- **Alpha.234** behält die gelernte SunEnergy-Ladegrenze bei vorübergehend geringerem PV-Überschuss. [Versionshinweise](docs/release-0.17.0-alpha.234.md)
- **Alpha.233** gibt die Leistungsreserve für einen vor der Ausgabe verworfenen SunEnergy-Auftrag nach frischer Nullbestätigung frei. [Versionshinweise](docs/release-0.17.0-alpha.233.md)
- **Alpha.232** senkt beim einzelnen SunEnergy-Kopf den bestätigten PV-Ladeauftrag, wenn die gemessene Leistung stabil darunter bleibt. Bei genügend PV-Überschuss prüft es nach 60 Sekunden bis zu 50 W mehr. [Versionshinweise](docs/release-0.17.0-alpha.232.md)
- **Alpha.231** lässt bei einem bereits ladenden SunEnergy-Kopf eine PV-Sollwertsenkung um bis zu 200 W zu, während die Rückmeldung zum laufenden Auftrag aussteht. [Versionshinweise](docs/release-0.17.0-alpha.231.md)
- **Alpha.230** wartet bei einem einzelnen SunEnergy-Kopf und einer kleinen PV-Sollwertsenkung innerhalb der Leistungstoleranz auf die ausstehende Laderückmeldung. [Versionshinweise](docs/release-0.17.0-alpha.230.md)
- **Alpha.229** ermöglicht die Rückgabe eines blockierten SunEnergy-Speicherausgangs bei deaktivierter Speicher-Steuerfreigabe. Wallboxen und Heizstäbe können weiter geregelt werden. [Versionshinweise](docs/release-0.17.0-alpha.229.md)
- **Alpha.228** berücksichtigt die Leistung einer nachlaufenden Wallbox im gemeinsamen Ladebudget. Bei ausreichendem PV-Überschuss kann ein anderes Fahrzeug schon während der Abschaltverzögerung hochregeln. [Versionshinweise](docs/release-0.17.0-alpha.228.md)
- **Alpha.227** nutzt die SoC-Stromstufen des Mii/e-Up im Parallelbetrieb, sobald nach den Mindestströmen der anderen Fahrzeuge Netzreserve verfügbar ist. [Versionshinweise](docs/release-0.17.0-alpha.227.md)
- **Alpha.226** protokolliert den Stopp am Mindest-SoC als Info und meldet Anforderung und Bestätigung getrennt. [Versionshinweise](docs/release-0.17.0-alpha.226.md)
- **Alpha.225** hält den SQL-Startcache nutzbar, wenn das rollierende Historienfenster über ältere Datenlücken hinauswandert. [Versionshinweise](docs/release-0.17.0-alpha.225.md)
- **Alpha.224** berücksichtigt gemessene Ladeenergie beim Mindest-SoC, übernimmt geänderte Abfahrtszeiten und plant bei konkurrierenden Fahrzeugen frühere Abfahrten zuerst. [Versionshinweise](docs/release-0.17.0-alpha.224.md)
- **Alpha.223** verteilt die geplante Warmwasserladung vor einem Preisanstieg auch dann im gleich teuren Tarifblock, wenn bis zum Ende des Fahrplans kein weiteres Versorgungsfenster sichtbar ist. [Versionshinweise](docs/release-0.17.0-alpha.223.md)
- **Alpha.222** ergänzt je Fahrzeug die optionale Planung des Mindest-SoC bis zur Abfahrt. Die Vorgabe bleibt die Sofortladung. [Mobilitätsreserve und Ladefenster](#mobilitätsreserve-und-vorhandene-abfahrtszeit)
- **Alpha.221** merkt eine manuelle SoC-Korrektur bis zu 30 Minuten für das nächste Anstecken vor. Der Wert gilt ab der ersten Ladeentscheidung. [Versionshinweise](docs/release-0.17.0-alpha.221.md)
- **Alpha.220** ergänzt die optionale PV-Abstimmung zwischen Speicher und Wallbox anhand des geplanten Speicher-Ziel-SoC. [Batteriespeicher](#admin-batteriespeicher)

## Inhaltsverzeichnis

- [Installation und Aktualisierung](#installation-und-aktualisierung)
- [Betriebsarten und sichere Zuständigkeit](#betriebsarten-und-sichere-zuständigkeit)
- [Istwertverteilung ohne Fahrplan](#istwertverteilung-ohne-fahrplan)
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

Seit Alpha.220 kann die optionale PV-Abstimmung den geplanten Speicher-Ziel-SoC für die Aufteilung zwischen Speicher und Wallbox nutzen. Bei ausreichender Reserve kann der Speicher einen halben Wallbox-Stromschritt puffern, bis zu 115 W einphasig beziehungsweise 345 W dreiphasig. Bei Speichervorrang kann die Wallbox mit Mindeststrom starten, sobald der Überschuss ausreicht. Danach steigt die Speicherladung bis zur Ladegrenze, bevor die Wallbox den Strom weiter erhöht. Offen sind die gemeinsame Reserve- und Nachtplanung sowie die reale Speicherabnahme. [Admin-Referenz zum Speicher](docs/admin-reference.de.md#admin-batteriespeicher) · [Integration und Abnahme #25](https://github.com/fuchs-1978/ioBroker.ems-optimizer/issues/25)

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

Die [Roadmap #36](https://github.com/fuchs-1978/ioBroker.ems-optimizer/issues/36) ordnet die offenen Nachweise und Integrationen. Für die aktuelle Version stehen insbesondere der Live-Nachweis der SoC-Fortschreibung nach einer Fahrt, die Wärmeplanung und ein realer Fall der 1‑A‑Wiederübernahme aus. [Betriebsabnahme #7](https://github.com/fuchs-1978/ioBroker.ems-optimizer/issues/7) · [go-e-Rückmeldungen #216](https://github.com/fuchs-1978/ioBroker.ems-optimizer/issues/216) · [SoC-Quellzeit #320](https://github.com/fuchs-1978/ioBroker.ems-optimizer/issues/320)

Abgeschlossene Tagesberichte bleiben datierte Belege. Die [Bereinigung vom 03.11.2026](docs/issue-audit/2026-11-03/README.md) dokumentiert Übergaben und erhält die ursprünglichen Issue-Texte. [Übersetzungsstand](docs/translations.md) · [Aktuelle Änderungen](README.md#changelog) · [Ältere Versionen](CHANGELOG_OLD.md).
