# EMS Optimizer – Anleitung für ioBroker

[English overview](README.md) · [Admin-Feldreferenz](docs/admin-reference.de.md) · [Versionsänderungen](README.md#changelog) · [Offene Arbeiten auf GitHub](https://github.com/fuchs-1978/ioBroker.ems-optimizer/issues/36)

**Entwicklungs-Alpha für Testinstallationen.** Für den produktiven Einsatz ist der Adapter noch nicht freigegeben. Für einen Testlauf können alle Stellfreigaben ausgeschaltet bleiben.

EMS Optimizer hilft, den eigenen Strom für Hausbatterie, E-Autos und elektrische Heizstäbe zu nutzen. Mit angeschlossenen Preis- und Prognosequellen kann er bestimmte Verbräuche in günstige Zeitfenster verschieben. Du entscheidest je Gerät, ob es in der Planung auftaucht und ob das EMS es steuern darf.

Der **Fahrplan** rechnet für die nächsten 48 Stunden in Viertelstunden. Die **Echtzeitregelung** prüft laufend, was an der Anlage gerade möglich ist. Zieht eine Wolke vor die PV-Anlage, begrenzen die aktuellen Messwerte die Leistung auch bei einem sonnigen Fahrplan. Die beiden Ebenen findest du in der EMS-Übersicht.

## Installation und Aktualisierung

Vorausgesetzt werden Node.js ab 22, ioBroker js-controller ab 6.0.11 und Admin ab 7.8.23. Die aktuelle Entwicklungsfassung steht im Changelog. Die auf deiner Instanz laufende Version siehst du unter `ems-optimizer.0.System.Version`. [Versionsstand auf main](README.md#changelog)

1. Prüfe für deine Testinstanz den Versionsstand und das zugehörige Testergebnis. Die folgenden Schritte beschreiben die Einrichtung nach der Installation. [GitHub-Prüfläufe auf main](https://github.com/fuchs-1978/ioBroker.ems-optimizer/actions/workflows/test-and-release.yml?query=branch%3Amain)
2. Öffne **Instanzen → ems-optimizer.0 → Einstellungen**. Bei einer weiteren Instanz lautet die Nummer entsprechend anders.
3. Beginne bei **Allgemein**, **Netzanschluss / §14a / EEBUS** und **Messwerte**. Lass die Master-Freigabe beim Einrichten aus. Schalte in den jeweiligen Reitern **vorhanden** für Geräte aus, die deine Anlage nicht hat.
4. Ergänze **Historie und Prognose** sowie **Preise & Tarife**, wenn du einen Fahrplan nutzen willst. Richte anschließend einen realen Ausgang ein, etwa eine Wallbox mit einer bewusst niedrigen Inbetriebnahmegrenze.
5. Speichere und prüfe unter **EMS-Übersicht** die Messwerte, Hinweise und Gerätezuordnung. Erst danach folgt die [Freigabe des einzelnen Ausgangs](#admin-allgemein).
6. Prüfe nach einem Update `System.Version` und die wirksamen Einstellungen. Zeigt der Prozess noch die alte Version, starte die Instanz neu und prüfe erneut. [Laufzeitvoraussetzungen](docs/runtime-requirements.md)

## So liest man die Admin-Anleitung

| Begriff | Bedeutung beim Einrichten |
| --- | --- |
| Datenpunkt oder Objekt-ID | Vollständige Adresse unter **Objekte**, etwa `zaehler.0.netz.bezug_W` als Beispiel. Kopiere die ID deiner Anlage. Ein Basisdatenpunkt ist der gemeinsame Anfang mehrerer Objekt-IDs in einem Baum. |
| Sollwert und Istwert | Der Sollwert ist der Auftrag, etwa 6 A. Der Istwert ist die gemessene Reaktion. Eine Gerätebestätigung (ACK) und der tatsächliche Strom sind zwei eigene Prüfungen. |
| Leistung und Energie | W und kW geben an, wie viel Leistung gerade fließt. Eine Stunde mit 2 kW ergibt 2 kWh Energie. 1 kW entspricht 1.000 W. |
| SoC | Füllstand eines Akkus in Prozent. Bei 20 % Mindest-SoC darf eine 15-kWh-Batterie für den normalen Betrieb nur den Bereich oberhalb von ungefähr 3 kWh nutzen. |
| Netzverknüpfungspunkt (NVP) | Stelle, an der dein Haus Strom aus dem öffentlichen Netz bezieht oder dorthin abgibt. Das EMS rechnet mit positivem Saldo bei Bezug und negativem bei Einspeisung. |
| Hysterese | Abstand zwischen zwei Umschaltgrenzen. Sie verhindert häufiges Hin- und Herschalten in der Nähe einer Grenze. |

In **Objekte** kannst du Einheiten, Zustände und Zeitstempel ansehen. Ein als optional gekennzeichnetes Feld kannst du leer lassen, wenn die Funktion für deine Anlage entbehrlich ist. Bei einem Update kann für ein leeres Feld noch eine alte [Datenpunktzuordnung](#admin-erweiterte-datenpunkte) greifen. Die Feldreferenz nennt Vorgaben für neue Installationen und die technischen Schlüsselnamen. Verwende für Leistungen, Ströme und Temperaturen die Grenzen deiner Geräte und Anlage.

### Die Admin-Reiter in Bildschirmreihenfolge

| Reiter | Wann du ihn brauchst |
| --- | --- |
| [EMS-Übersicht](#admin-ems-übersicht) | Messwerte, Gründe und Gerätestatus kontrollieren |
| [Allgemein](#admin-allgemein) | Reale Ausgänge freigeben |
| [Netzanschluss / §14a / EEBUS](#admin-netzanschluss--14a--eebus) | Hausanschluss und vorhandene Netzbetreibersignale abbilden |
| [Messwerte](#admin-messwerte) | PV, Bezug und Einspeisung zuordnen |
| [Historie und Prognose](#admin-historie-und-prognose) | Verbrauch und Erzeugung vorausschätzen |
| [PV-Korrektur](#admin-pv-korrektur) | Wiederkehrende Prognoseabweichungen je PV-Fläche ausgleichen |
| [Preise & Tarife](#admin-preise-und-tarife) | Strompreis und gegebenenfalls zeitvariable Netzentgelte hinterlegen |
| [Wallboxen allgemein](#admin-wallboxen-allgemein) | Priorität, Parallelbetrieb und Wartezeiten festlegen |
| [Wallbox 0 – Mii/e-Up](#admin-wallbox-0--miie-up) | Erste Wallbox einrichten und gemeinsame Fahrzeugfelder verstehen |
| [Wallbox 1 – EQV](#admin-wallbox-1--eqv) | Zweite Wallbox einrichten |
| [Wallbox 2 – EQE](#admin-wallbox-2--eqe) | Dritte Wallbox einrichten |
| [Warmwasser-Heizstab](#admin-warmwasser-heizstab) | Trinkwarmwasser mit einem my-PV-Heizstab einplanen oder regeln |
| [Heizpuffer](#admin-heizpuffer) | Einen separaten Heizstab für den Heizkreis einrichten |
| [Batteriespeicher](#admin-batteriespeicher) | Stationären Speicher einrichten und seine Strategie festlegen |
| [Wärmepumpe](#admin-wärmepumpe) | Elektrische Leistung, Temperaturen und Empfehlungen anzeigen |
| [Wärmestrategie](#admin-wärmestrategie) | Kühlstatus und optionales Heizen bei günstigen Preisen einrichten |
| [Echtzeitregelung](#admin-echtzeitregelung) | Netzsollwert und Toleranzen einstellen |
| [Erweiterte Datenpunkte](#admin-erweiterte-datenpunkte) | Alte Zuordnungen bei einem Update prüfen |
| [Geräte](#admin-geräte) | Haushaltsprogramme oder Temperatur-Sollwerte einrichten |

## Admin: EMS-Übersicht

Hier siehst du die Ergebnisse und die Gründe für die aktuelle Zuteilung. Einstellungen änderst du im jeweiligen Gerätereiter.

| Anzeige | Was du dort prüfst |
| --- | --- |
| **Betriebszustand** und **Aktuelle Hinweise** | Sind die aktuellen Messwerte nutzbar? Liegt ein Konflikt oder eine fehlende Freigabe vor? |
| **Geräte auf einen Blick** | Welches Gerät ist verfügbar? Welche Leistung wird verlangt und welche gemessen? |
| **Fahrplan und Batterie-Vorschau** | Welche Abfahrt ist rechnerisch erreichbar und welche Speicherreserve zeigt der Plan an? |
| **Tagesbilanzen** | Netzbezug, Einspeisung und weitere Leistungsintegrale für die jeweilige Periode. Die Bilanzperiode wechselt um 20:00 Uhr (Europe/Berlin). Die Werte sind Schätzungen aus aufgezeichneten Messungen. Prüfe die Zeitabdeckung mit. |
| **Technische Diagnose** | Quellenqualität, Aufzeichnung, SQL-Speicherbestätigung, Reaktionszeiten und Gründe der Regelung. |

Unter **Objekte** ergänzen `Plan.Valid` und `Control.Valid` die Übersicht. Bei gültigen Istwerten kann die normale Leistungszuteilung mit `Control.PlanFallbackActive` weiterlaufen, wenn der Fahrplan fehlt. Preisgeführtes Laden, günstiger Netzstrom für Wärme und geplanter PV-Boost warten dann auf einen gültigen Fahrplan. [Übersicht und Zustände](docs/admin-reference.de.md#admin-ems-übersicht) · [Fahrplan-Ersatzbetrieb](docs/release-0.17.0-alpha.198.md)

## Admin: Allgemein

Die **Master-Freigabe für konfigurierte reale Ausgänge** erlaubt grundsätzlich Stellbefehle. Die Schalter **vorhanden**, **Regelfreigabe** und **Ausgang freigeben** geben zusätzlich das jeweilige Gerät und seinen Steuerpfad frei. Für die gemeinsame Wallbox-/Warmwasserregelung gibt es die **ALPHA-Regelung** und beim Heizstab eine **gemeinsame Produktivfreigabe**. Die Wärmepumpen-Empfehlung hat ihren eigenen lesenden Pfad.

1. Prüfe die Messung des betroffenen Geräts bei ausgeschaltetem Master. Der Schattenbetrieb modelliert eine Wallboxreaktion für die Diagnose.
2. Kläre, wer den Strom-, Leistungs- oder Startdatenpunkt schreibt. Beende konkurrierende Stellskripte des betreffenden Ausgangs. Getrennte Mess-, Schutz- und gegebenenfalls Phasen- oder Pumpenfunktionen bleiben entsprechend ihrer Zuordnung in Betrieb.
3. Setze die nötigen Freigaben für **einen** Ausgang und beobachte bei niedriger Inbetriebnahmegrenze Auftrag, Bestätigung und gemessene Wirkung. Prüfe auch den Stopp und die elektrische Ruhe.
4. Soll ein anderer Regler übernehmen, nimm die EMS-Freigabe zurück und deaktiviere gegebenenfalls den EMS-Phasenfolger gemäß seiner Anleitung. Gib den Folgeregler erst nach bestätigtem Stopp frei. `OutputOwned` beschreibt die Zuständigkeit im EMS. Für die Abschaltung brauchst du die Geräterückmeldung und die elektrische Messung. [Freigaben](docs/admin-reference.de.md#admin-allgemein) · [Phasenfolger](docs/phase-follower-v2.md)

## Admin: Netzanschluss / §14a / EEBUS

Trage bei **Physische Hausanschlusssicherung je Phase** den Anlagenwert ein. Die **Regelreserve unterhalb des Sicherungsnennstroms** lässt Abstand für wechselnde Hauslasten. Rechnerisch ergeben 50 A je Phase und 4 A Reserve eine Betriebsgrenze von 46 A je Phase. Das ist ein Rechenbeispiel. Reale Phasenmesswerte ordnest du unter **Messwerte** zu. Prüfe auch, auf welcher Netzphase eine einphasig ladende Wallbox tatsächlich liegt.

| Vorhandener Eingang | Einstellung und Kontrolle |
| --- | --- |
| §14a-Binärkontakt | Datenpunkt, Schaltlogik und Budgetquelle passend zur Anlage zuordnen. Das Signal und das gemeinsame Limit müssen in der Diagnose im erwarteten Zustand erscheinen. |
| EEBUS | Zusammengehörige Datenpunkte für **LPC.state** und **LPC.limit** verwenden. Die optionalen LPP-Datenpunkte gehören zur getrennten Erzeugungsseite. Sobald ein LPC-Eingang konfiguriert ist, sperrt der aktuelle Adapter die zusätzliche Gruppen-Netzbezugsbilanz (`groupNet`). |
| Deklarierte Gruppen-Netzbezugsbilanz | Benötigt eine erklärte gemeinsame AC-Messgrenze, vollständige zeitlich passende Quellen für die Gruppe und die konfigurierte Erfassung von Speichern. Die Felder gehören zur Inbetriebnahme einer solchen Gruppe. |

**Preise & Tarife** bestimmt den Kostenvergleich. Dieser Reiter bestimmt die im Betrieb einzuhaltenden elektrischen Budgets. Prüfe vor Stellfreigabe das Verhalten im Normalbetrieb und bei aktivem Begrenzungssignal. [Budgetquellen, Phasen und Messgrenzen](docs/admin-reference.de.md#admin-netzanschluss--14a--eebus) · [LPC-Integration #166](https://github.com/fuchs-1978/ioBroker.ems-optimizer/issues/166)

## Admin: Messwerte

Ordne zuerst **PV-Erzeugungsleistung**, **Netzbezugsleistung** und **Netzeinspeiseleistung** in W zu. Für die getrennten Netzfelder verwendest du positive oder null betragende Werte. Liefert dein Zähler nur einen gemeinsamen Wert mit Vorzeichen, stelle passende getrennte Quellen bereit und prüfe die Zuordnung. Das EMS bildet aus diesen beiden Werten das Saldo Bezug minus Einspeisung.

- Schalte einen bekannten Verbraucher im normalen Betrieb ein. Der Bezug sollte steigen oder die Einspeisung sinken. Prüfe bei PV-Überschuss die Gegenrichtung.
- Ergänze Außentemperatur, Haus-/Unterzähler und BHKW je nach Anlage. Ein Unterzähler zählt für die Lastprognose nur mit seiner tatsächlichen Messgrenze. Ziehe beispielsweise eine Wallboxleistung aus der gemessenen Hauslast nur ab, wenn der Hauszähler sie mitmisst. Das BHKW lässt sich separat anzeigen. Der Netzanschlusszähler enthält seine Wirkung bereits.
- Für die elektrische Begrenzung ordnest du vorhandene Messwerte auf L1, L2 und L3 zu. Eine Gesamtleistung kann eine hohe Belastung auf einer einzelnen Phase verdecken.
- Lass den normalen **Zeitstempelvertrag der Netzquelle** bei **Veröffentlichungszeiten**, solange dein Treiber keine gemeinsame Telegramm-Empfangszeit für Bezug und Einspeisung nachweislich liefert. Prüfe, dass die Quellen auch gleichbleibende Werte regelmäßig als aktuell bestätigen. [Messquellen, Zeitgrenzen und Datenqualität](docs/admin-reference.de.md#admin-messwerte)

## Admin: Historie und Prognose

Die Historie schätzt die typische Last deines Haushalts. PV- und Wetterprognose beschreiben die nächsten Stunden. Damit kann der Plan zum Beispiel Platz im Batteriespeicher für erwartete PV-Erzeugung vorsehen.

1. Trage bei **Instanz des Historien-/SQL-Adapters** die vorhandene Instanz ein, etwa `sql.0`. Prüfe unter **Objekte**, ob die genutzten Leistungsquellen tatsächlich historisiert werden. Der standardmäßige Rückblick von 84 Tagen nutzt die vorhandenen Werte.
2. Weise bei **Wetterprognose** und **PV-Prognose** jeweils den Basisdatenpunkt des unterstützten Baums zu. Vergleiche mindestens eine künftige Stunde mit Datum, Einheit und Leistung der Quelle. PV-Leistung wird in W für die jeweilige Fläche erwartet. Ordne die Namen der Flächen im [JSON-Feld für die Prognose](#pv-flächen-im-prognosebaum) zu.
3. Beginne beim **Verfahren für historische Lastprofile** mit **Median**. Es verwendet typische gemessene Werte nach Wochentag und Uhrzeit. Die aktuelle Gewichtung räumt jüngeren Tagen mehr Einfluss ein.
4. Für **50/50 Median + Lasso** aktiviere zusätzlich **Prognosevergleich Median / Lasso**. Lasso lernt Zusammenhänge aus der Historie. Die Mischung gilt je Viertelstunde, sobald ein gültiges, vorab gespeichertes Paar passt. In den übrigen Viertelstunden verwendet der Fahrplan den Median. Das Feld `source` in `Forecast.Baseload_48h_JSON` zeigt die verwendete Methode. Zum Zurückstellen wählst du **Median**.

Der Prognosevergleich kann auch bei produktivem Median mitlaufen. Vergleiche Modelle für dieselben gemessenen Viertelstunden und prüfe Abdeckung, Leistungsfehler und Energieabweichung. Das Wetterarchiv und die optionale Raumhistorie sammeln Daten für spätere Auswertungen. [Quellformate, Cache und Vergleich](docs/admin-reference.de.md#admin-historie-und-prognose) · [50/50-Fahrplan](docs/release-0.17.0-alpha.293.md)

## Admin: PV-Korrektur

Unter **Monatliche PV-Korrekturfaktoren** kannst du für jede Fläche eine Zeile anlegen. Kopiere deren genauen Namen aus dem PV-Prognosebaum. **0,80** übernimmt 80 % der prognostizierten Leistung. **1,20** erhöht die Prognose um 20 %. Ohne gültigen Monatsfaktor verwendet das EMS 1,00.

Wenn eine Fläche im November an vergleichbaren Tagen regelmäßig etwa 8 kWh aus erwarteten 10 kWh erzeugt, ist 0,80 ein prüfbarer Ansatz für diesen Monat. Vergleiche danach mehrere Tage. Die Korrektur ändert die Vorausschau, während die Live-Regelung weiterhin die aktuelle Messung verwendet. [Zuordnung und Geltungsbereich](docs/admin-reference.de.md#admin-pv-korrektur)

<a name="admin-preise-und-tarife"></a>

## Admin: Preise & Tarife

Das EMS vergleicht den **gesamten Brutto-Arbeitspreis in ct/kWh** je Viertelstunde. 0,29 €/kWh entsprechen 29 ct/kWh. Der monatliche Grundpreis gehört nicht in dieses Feld. Beginne mit der für deinen Vertrag zutreffenden Preisart.

| Vertrag oder Datenquelle | Was du einträgst |
| --- | --- |
| Fester Arbeitspreis als Gesamtbetrag | Wähle **Vertragspreis gesamt mit Referenz-Netzentgelt**. Hinterlege den gesamten Vertragspreis brutto und das darin enthaltene Referenz-Netzentgelt. Für den Festbetrieb trägst du im Feld **Festes Netzentgelt** das geltende Entgelt mit der gewählten Brutto-/Nettobasis ein. Beispiel bei durchgehend brutto: 29 − 7 + 7 = 29 ct/kWh. |
| Getrennte Preisbestandteile | Wähle **Energieanteil plus Netzentgelt** und gib beide Beträge in ihrer korrekt gewählten Brutto-/Nettobasis an. |
| Dynamischer Energiepreis | Aktiviere ihn und wähle **Energy-Charts: DE-LU Day-Ahead** oder eine unterstützte externe Reihe. Ergänze die tatsächlich anfallenden Aufschläge. Bei externer Reihe kontrollierst du Einheit und Brutto-/Nettobasis. |
| Zeitabhängiges Netzentgelt | Aktiviere es für den anzuwendenden Tarif. Wähle die zeitbezogene externe Reihe oder **Jahrestarif mit Zeitfenstern**. Trage Tarifjahr, Standard-, Hoch- und Niedrigtarif sowie für alle vier Quartale lückenlose Tage im 15-Minuten-Raster ein. |

Ein zugeordneter externer Freigabeschalter bestimmt, ob die dynamische Quelle verwendet wird. Kontrolliere in `Forecast.TotalPrice_48h_JSON` den Preis vor und nach einem Tarifwechsel und vergleiche ihn mit deinem Vertrag. **Netzladen** wird gesondert im Reiter des Fahrzeugs oder der Batterie freigegeben. **Günstigpreisheizen** hat ebenfalls eine eigene Freigabe. [Preise, Reihen und Beispiele](docs/prices-and-tariffs.md) · [Admin-Felder](docs/admin-reference.de.md#admin-preise-und-tarife)

## Admin: Wallboxen allgemein

- **Wallboxen parallel laden** erlaubt mehrere gleichzeitige Ladevorgänge, sofern Mindestströme und das gemeinsame Budget zusammenpassen. Die **bevorzugte Wallbox** erhält bei knappem Budget Vorrang nach den geltenden Lade- und Schutzregeln. Für die manuelle Auswahl im Admin stellst du die Prioritätsquelle passend auf **Auswahl im Admin**.
- **Zusätzlicher Überschuss vor dem Start** und **Dauer des stabilen Überschusses vor dem Start** helfen bei wechselnder PV. Eine einphasige Wallbox benötigt bei 6 A und 230 V rund 1.380 W. Bei 300 W zusätzlichem Startüberschuss ergibt das im einfachen PV-Fall rund 1.680 W. Dreiphasig sind 6 A je Phase rund 4.140 W vor Startreserve. Weitere Lasten und Schutzreserven können die Freigabe beeinflussen.
- **Mindestlaufzeit** und **Ausschaltverzögerung** begrenzen Wechsel bei kurzen Wolken. Schutzbedingungen und ausdrückliche Stopps gelten auch während der Wartezeiten. Zeiteinheiten beachten, etwa 120 s = 2 min.
- Ändere Stromschritte, Rückmeldefristen und Phasenwechselzeiten erst anhand einer beobachteten Reaktion. Prüfe in der Übersicht, ob ein Fahrzeug auf Überschuss, die Startzeit, ein anderes Fahrzeug oder eine Gerätebestätigung wartet. [Gemeinsame Timer und Prioritäten](docs/admin-reference.de.md#admin-wallboxen-allgemein)

<a name="admin-wallbox-0-1-und-2"></a>

## Admin: Wallbox 0 – Mii/e-Up

Die drei Wallbox-Reiter haben dieselbe Vorgehensweise. Die Reiternamen sind vorgegeben. Mit **Fahrzeugname** gibst du deine tatsächliche Zuordnung an. Richte die erste tatsächlich vorhandene Wallbox ein. Die Nummer kann auch 1 oder 2 sein.

### Datenpunkte und elektrische Grenzen

| Bereich | Einrichten und prüfen |
| --- | --- |
| Fahrzeug und Verbindung | **SoC-Datenpunkt** des Fahrzeugs in %, **Fahrzeug-Verbindungsstatus** der Wallbox und gegebenenfalls **Ladefreigabe durch Benutzer** zuordnen. An- und Abstecken muss in der Diagnose erkennbar sein. |
| Messung | Für `wbNPowerId` erwartet das EMS die go-e-Ladeleistung in **kW**, etwa `go-e.N.energy.power`. Die Phasenströme werden in **A** zugeordnet. Prüfe beide bei einer laufenden Ladung. |
| Stromgrenzen | Tatsächliche 1P-/3P-Minima und -Maxima sowie Leistungslimit von Wallbox, Fahrzeug und Installation eintragen. **Von Wallbox L1 verwendete Netzphase** und **Feste Phasen im Produktivbetrieb** prüfen. |
| go-e-Ausgang | **Beschreibbarer go-e-Strom (amperePV)** und **beschreibbare go-e-Freigabe (allow_charging, 0/1)** getrennt von **bestätigtem go-e-Strom (ampere)**, Verbindung und Fehlercode zuordnen. Die Rückmeldung und die elektrische Reaktion beim Start und Stopp ablesen. |
| Phasenumschaltung | Für einen festen Betrieb **Dynamischen 1-/3-Phasenbetrieb** aus lassen. Beim dynamischen Betrieb schaltet ein geeignetes externes Skript entweder nach eigener Führung oder nach EMS-Vorgabe. Nur eine Instanz führt den Phasenwechsel. Prüfe bestätigten go-e-Phasenmodus und realen Strom je Phase. |

### Fahrzeug-SoC und Sitzungswechsel

Wähle bei **Quelle der SoC-Grenzen**, ob die Grenzwerte im Admin oder aus zugeordneten Datenpunkten kommen. **Mindest-SoC** ist der Bedarf für Pflichtladung. **Ziel-SoC** ist die Grenze, bis zu der mit PV oder ausdrücklich erlaubtem Netzladen weitergeladen werden kann. Beispiel mit gültiger Ladefreigabe und ausreichender Leistung bei 18 % Ist, 20 % Minimum und 80 % Ziel: zuerst bis 20 % laden, die weitere Ladung folgt der gewählten Strategie.

Bei eingetragener Abfahrt kann der EMS einen Teil der Ladung für die erwartete PV-Erzeugung freihalten. Entfällt ein PV-Fenster nach Erreichen des Zwischen-SoC, zeigt der Fahrzeugstatus den abgesicherten Beginn der Nachladung an. [Rechenbeispiel](docs/release-0.17.0-alpha.315.md)

Bei verzögerten Fahrzeugmeldungen kann **SoC aus gemessener Ladeenergie schätzen** den Ladestand zwischen zwei Fahrzeugmessungen fortschreiben. Dafür braucht das EMS einen echten Fahrzeug-SoC, die nutzbare Akkukapazität und einen zugeordneten AC-Ladeenergiezähler in kWh. Unter `Vehicles.WallboxN` zeigt `ReportedSoC_pct` den eingegangenen Fahrzeugwert, `EstimatedSoC_pct` die Schätzung und `SoC_pct` den wirksamen Ladestand.

Für Fahrzeugmeldung und manuelle Korrektur zählt der **Messzeitpunkt**. Ohne separates Messzeitobjekt verwendet das EMS das native `ts` der SoC-Quelle. Der Treiber muss dort die Fahrzeugmesszeit liefern. Bei gleicher Zeit hat die manuelle Korrektur Vorrang. Ein neuerer Fahrzeugwert kann sie auch mit niedrigerem SoC ablösen. Abstecken beendet die Fortschreibung aus der bisherigen Ladeenergie. Der letzte maßgebliche SoC bleibt über Abstecken und Neustart hinweg vor älteren Meldungen geschützt. [Zeitstempel, Zähler und manuelle Korrektur](docs/admin-reference.de.md#optionale-soc-schätzung-aus-ladeenergie-alle-drei-fahrzeuge)

### Mobilitätsreserve und vorhandene Abfahrtszeit

Im Web-Dashboard öffnet ein Klick auf die Fahrzeugkachel die Ladeziele. Für eine einzelne Fahrt kannst du **Abfahrtsdatum**, **Abfahrtszeit** und **Abfahrts-SoC** eintragen. Mit der Netzfreigabe für diesen Termin darf das EMS fehlende Energie bis zum Fahrtziel aus dem Netz ergänzen. Nach dem Termin gelten wieder die normalen SoC-Grenzen. [Beispiel und Datenpunkte](docs/release-0.17.0-alpha.338.md)

Bei aktivierter Abfahrt reserviert das EMS die Leistung, die das Fahrzeug für seinen Mindest-SoC zum eingestellten Zeitpunkt benötigt. Reicht die PV-Leistung dafür nicht aus, darf es die Differenz aus dem Netz beziehen. Das gilt auch für eine Wallbox ohne Fahrzeugvorrang im Parallelbetrieb. Die Rechnung zielt auf den Abschluss 15 Minuten vor Abfahrt und berücksichtigt die eingestellten Stromgrenzen am Ladeende.

Ab Alpha 331 beendet der erreichte Mindest-SoC die reguläre Abfahrtsladung. Bei 75 % Minimum und 100 % Ziel kann das Fahrzeug oberhalb von 75 % weiter mit PV-Überschuss laden. Wer zur Abfahrt auch den oberen Zielwert aus dem Netz anstrebt, aktiviert an der gewünschten Wallbox **Zusätzlich bis zum Ziel-SoC aus dem Netz laden**. Beim Update ist dieser Schalter aus.

**PV vor Abfahrt bei ausgeschalteter Preisladung.** Bei geeignetem Fahrplan lädt das Auto nachts nur bis zum nötigen Zwischenstand. Das EMS rechnet höchstens 80 % der bis zur Abfahrt nutzbaren PV an und prüft, ob das Mindestziel auch bei vollständigem PV-Ausfall mit der verbleibenden Netzladezeit erreichbar wäre. Den Zwischenstand und den Beginn des PV-Fensters findest du in `Plan.WallboxN_48h_JSON` unter `departurePv.reservePct` und `departurePv.releaseAt`. Manuelle Mindestströme und Ladestufen bei tiefem SoC können unmittelbar Leistung anfordern. [Abfahrtsladung](docs/release-0.17.0-alpha.306.md) · [PV-Fenster und Rückfall](docs/release-0.17.0-alpha.310.md)

Mit **Mindest-SoC bis zur Abfahrt einplanen** kannst du die Ladung oberhalb der Mobilitätsreserve bis zur Abfahrt verschieben. Dafür braucht das EMS eine aktive Abfahrtsfreigabe, eine Uhrzeit in `Vehicles.WallboxN.DepartureTime` und eine positive `MobilityReserve_pct` unter dem Mindest-SoC. Bei ausgeschalteter Preisladung bekommt ein Auto ohne Termin bis zu seinem Minimum zuerst Leistung. Das Auto mit Termin kann übrigen PV-Überschuss nutzen. Der Fahrplan reserviert genug Zeit, um seinen Mindest-SoC auch ohne Sonne zu erreichen. Bei eingeschalteter Preisladung plant das EMS den Mindestbedarf in geeigneten Preisfenstern. [Einstellungen und Rückfallbedingungen](docs/admin-reference.de.md#mobilitätsreserve-und-vorhandene-abfahrtszeit)

### Start, Stopp, Übergabe und Phasenwechsel

Lädt im Parallelbetrieb ein Auto allein bis zum Mindest-SoC und schwankt der verfügbare Strom um mehrere Ampere, braucht jede zusätzliche PV-Stufe nach einem Rückgang 45 Sekunden durchgehenden Überschuss. Bei sinkendem Überschuss kann das EMS den Strom sofort wieder senken. [Prüffall EQE](docs/release-0.17.0-alpha.337.md)

Bei einer Lücke in den Leistungsmeldungen der go-e-Wallboxen kann ein bereits ladendes Fahrzeug mit seinem bestätigten Strom weiterladen. Das EMS reserviert die Leistung und prüft Netzbezug, Einspeisung, jede Hausanschlussphase und die Netzbetreibergrenzen. Sind diese Prüfungen erfolgreich, hält die Wallbox den Strom bis zur nächsten gültigen Zuteilung. [Beispiel mit dem EQV bei 6 A](docs/release-0.17.0-alpha.333.md)

Aktiviere nach dem Zuordnen **Regelfreigabe Wallbox N** und **Wallboxausgang freigeben** mit passender **Stromgrenze für die produktive Inbetriebnahme**. Prüfe unter `Devices.WallboxN` den Auftrag und die Bestätigung und am Messwert den tatsächlichen Ladestrom. Wartet das nächste Fahrzeug, muss die bisherige Leistung zuerst physisch reduziert oder beendet und das Budget freigegeben sein. [Wallbox-Felder und Abnahmeschritte](docs/admin-reference.de.md#admin-wallbox-0-1-und-2) · [Phasenfolger](docs/phase-follower-v2.md)

## Admin: Wallbox 1 – EQV

Übernimm die [Einrichtungsschritte von Wallbox 0](#admin-wallbox-0--miie-up) mit den IDs der **zweiten** Wallbox und des dazugehörigen Fahrzeugs. Prüfe insbesondere echte 1P-/3P-Stromgrenzen und die Netzphase bei 1P. Unter **Objekte** findest du die Ergebnisse unter `Vehicles.Wallbox1` und `Devices.Wallbox1`. [Feldreferenz](docs/admin-reference.de.md#admin-wallbox-0-1-und-2)

## Admin: Wallbox 2 – EQE

Verwende für die **dritte** Wallbox die [Einrichtungsschritte von Wallbox 0](#admin-wallbox-0--miie-up) mit eigener Geräteinstanz, eigenem SoC und eigenen Grenzen. Prüfe die Messung unter `Vehicles.Wallbox2` und `Devices.Wallbox2`. Teste einen tatsächlichen Parallel- oder Übergabefall erst nach Prüfung der beteiligten Einzelausgänge. [Feldreferenz](docs/admin-reference.de.md#admin-wallbox-0-1-und-2)

## Admin: Warmwasser-Heizstab

Der Warmwasser-Heizstab erwärmt Trinkwasser im Speicher. Die **Mindesttemperatur** und der angenommene Tagesverbrauch bestimmen die modellierte Pflichtwärme. Die **Zieltemperatur** beschreibt den weiteren geplanten Wärmebedarf. Schutz- und Abschalttemperaturen gehören zur konkreten Anlage.

1. Aktiviere **Warmwasser-Heizstab vorhanden** und trage Speichervolumen, Leistungsgrenzen und die betrieblich vorgesehenen Mindest-, Ziel- und Schutztemperaturen ein. Gib Tagesbedarf und Verluste in kWh pro 24 h als Planungsannahmen an.
2. Ordne den beschreibbaren Leistungssollwert, die gemessenen Ausgangsleistungen, Verbindung, Freigabe sowie die vorgesehenen Speicher- und Austrittsfühler zu. Prüfe die Reihenfolge der Fühler von unten nach oben.
3. Wenn **Gemeinsamen Verteiler für Wallbox und Warmwasser verwenden** aktiv ist, gilt der **Warmwasseranteil** im gemeinsamen Leistungsbereich. Bei 50 % hängen die tatsächlichen Watt weiter von Wallbox-Mindeststrom, den Ein-/Ausschaltschwellen und dem nutzbaren Heizbudget ab. Eine laufende Mindestladung und Pflichtwärme können bei ausreichender Leistung und geeigneter oberer Warmwassertemperatur zusammenlaufen.
4. Prüfe den ersten Stelltest mit niedriger **Leistungsgrenze für die produktive Inbetriebnahme**. Vergleiche Sollwert, drei Ist-Ausgänge, Freigabe und Fühler. Ein eingeplanter Heizblock im Tarifplan benötigt eine tatsächliche Leistungsfreigabe.

In jeder Viertelstunde zeigt `Plan.Allocation_48h_JSON` die zulässige Netzleistung für Wärme (`thermalGridLimitW`) und den tatsächlich eingeplanten Netzanteil für Warmwasser (`dhwGridW`). Bei 0 W kann der Heizstab weiter PV-Überschuss nutzen. Ein ungedeckter Bedarf bleibt in der Wärmebilanz sichtbar.

Eine Spitze im Warmwasserfahrplan lässt sich in `Plan.DHWThermalDiagnostics_JSON` nachvollziehen. Unter `gridHeatShift` steht, wie viel bereits geplante Netzheizung in frühere, günstigere Heizviertelstunden verschoben wurde. Tankvolumen, Mindestwärmereserve, Batteriereserve und verfügbare Anschlussleistung begrenzen die Verschiebung. Ob der Heizstab tatsächlich Netzstrom nutzen darf, stellst du unter **Wärmestrategie** ein. [Beispiel mit Netz- und PV-Anteil](docs/release-0.17.0-alpha.313.md)

Der optionale Notbetrieb braucht einen passenden separaten Sensor und eine bewusst konfigurierte Einschalttemperatur. [Heizstab-Felder, Temperaturkennlinie und Rückmeldung](docs/admin-reference.de.md#admin-warmwasser-heizstab)

## Admin: Heizpuffer

Ein eigener Heizstab kann Wasser im Puffer des Heizkreises erwärmen. Verwende einen **separaten** my-PV-Aktor mit eigenem Sollwert, Verbindung und gemessenen Leistungen für L1 bis L3. Weise die reale Puffertemperatur zu und kontrolliere Volumen, Min-/Ziel-/Stopp-Temperatur und Maximalleistung. Der manuelle Temperatur-Ersatzwert dient der Planung.

Die **Heizpuffer-Sperre** und der gemeinsame [Kühlstatus](#admin-wärmestrategie) können die Freigabe begrenzen. Nach der einzelnen Ausgangsfreigabe prüfst du Sollwert, Leistung pro Phase, Temperatur und Sperrgrund des Heizpuffers. [Heizpuffer-Felder und Schutzbedingungen](docs/admin-reference.de.md#admin-heizpuffer)

## Admin: Batteriespeicher

### Anschließen und prüfen

1. Aktiviere **Batteriespeicher vorhanden / in Planung berücksichtigen**. Wähle bei **Verteilung des Speicherausgangs** für die aktuelle SunEnergy-Anbindung **SunEnergy-Standardadapter: 1–3 Köpfe mit SoC-Ausgleich** und gib die Treiberinstanz sowie Kopfanzahl an. Ein Kopf ist die Leistungselektronik eines Batterieturms. Ein Turm kann mehrere Akkupacks haben.
2. Am SunEnergy-Standardadapter steht **Steuermodus Aus** für einen deaktivierten Eigenregler. Jeder zugeordnete Kopf muss den lokalen Modus `LM=1` und den deaktivierten manuellen Modus `MM=0` bestätigen. Unter **Bisherige Einzelkopf-Zuordnung** werden Sollwert, AC-Rückmeldung, SoC, Treiberstatus und Modusdatenpunkte ausdrücklich zugeordnet. Die vorhandene Zuordnung kannst du in der Feldreferenz nachvollziehen.
3. Trage die bestätigte **Kapazität** der gesamten Batterie manuell ein oder wähle die Summe der online gemeldeten, gleich großen Packs und gib die bestätigte Kapazität pro Pack vor. Setze **maximale Ladeleistung** und **maximale Entladeleistung** als **Gesamtgrenzen**. Bei Kopfverteilung setzt du zusätzlich die Grenze je Kopf. Beispiel für zwei Köpfe mit je 2.400 W erlaubter Entladung: Eine Gesamtgrenze von 2.400 W hält beide zusammen bei höchstens 2.400 W. Bis zu 4.800 W sind erst mit entsprechender Gesamtgrenze, passenden Gerätegrenzen und freiem Anlagenbudget möglich.
4. Prüfe unter `Devices.Battery.Profile` gültigen SoC, Kapazität und Istleistung. Schalte **Regelfreigabe Batteriespeicher** und den **begleiteten Speicherausgang** für den Stelltest ein. Der SunEnergy-Sollwert `control.GS` und die AC-Leistung `grid.GP` sind positiv beim Entladen und negativ beim Laden. Im EMS ist das Batterievorzeichen umgekehrt. Kontrolliere beim Test die Änderung am Netzzähler. [Anbindung, Feldtabellen und Vorzeichen](docs/admin-reference.de.md#admin-batteriespeicher)

### Entladegrenzen und Fahrzeugvorrang

| Grenze oder Regel | Was sie bewirkt |
| --- | --- |
| **Mindest-SoC** im EMS | Grundwert für die Entladung. Neue Installationen starten bei 15 %. Passe ihn an die gewünschte Nutzung und die Batteriegrenzen an. |
| Mindest-SoC am SunEnergy-Gerät (`SI`) | Eigene Entladegrenze des Speichers. Die Kopfverteilung berücksichtigt sie zusätzlich. Die Gerätehysterese `SI1` beeinflusst, bei welchem SoC ein Kopf nach einem Stopp wieder entladen darf. |
| **Temperaturprognose für den Mindest-SoC verwenden** | Optional. Mit gültiger Wetterquelle wählt das EMS den eingestellten Mindestwert des passenden Temperaturbereichs für seine Tagesperiode ab 20:00 Uhr. |
| Prognosereserve | Bei mehr als sechs zusammenhängenden Stunden erwarteten Füllstands unter 20 % hebt das EMS die wirksame Grenze auf mindestens 20 %. Maßgeblich ist die 48-Stunden-Prognose vor der zusätzlichen Reserve. |
| Fahrzeug unter Mindest-SoC | Die Pflichtladung hat Vorrang. Sobald die Fahrzeuge nachweislich laden, kann der Speicher den am Netzzähler gemessenen Restüberschuss aufnehmen. Ausstehende Leistungsanstiege bleiben für die Verbraucher reserviert. Die Entladung für die Pflichtladung bleibt gesperrt. Die optionale Speicherhilfe außerhalb der Pflichtladung setzt mindestens 80 % Speicher-SoC und die Geräte- und Leistungsfreigaben voraus. [Beispiel und Messbedingungen](docs/release-0.17.0-alpha.316.md) |

Beispiel mit **10 %** am Speicher und einem EMS-Grundwert von **10 %**. Bei aktiver Prognosereserve beendet das EMS die Entladung bei **20 %** über den Leistungssollwert. Die 10 % sind als Gerätegrenze in `SI` hinterlegt. Den wirksamen EMS-Wert siehst du in `Devices.Battery.EffectiveMinimumSoC_pct`. Ein einzelner Kopf kann durch seine eigene Geräte- oder Wiederanlaufgrenze früher gesperrt sein.

Liegt der gemessene SoC bei aktiver Prognosereserve unter 20 %, lädt das EMS bei verfügbarer Leistung nach. Freier PV-Überschuss darf bis zur zulässigen Ladeleistung genutzt werden. Netzstrom ergänzt im freigegebenen Fenster den fehlenden Anteil bis 1.000 W Gesamtladung. Bei 600 W freiem PV-Überschuss sind das bis zu 400 W Netzanteil. Bei genügend PV kann die Gesamtladung über 1.000 W liegen. Für den Netzanteil sucht das EMS ein rechtzeitig nutzbares günstiges Zeitfenster. Die Nachladung darf neben Fahrzeug-Pflichtladung laufen, soweit Netz-, Phasen- und Gerätegrenzen es zulassen. [Prognosereserve](docs/release-0.17.0-alpha.288.md) · [Nachladung mit PV](docs/release-0.17.0-alpha.292.md)

### Kleine Leistungen, PV-Vorrang und Netzladen

- **Netzphase von Kopf 1/2/3** ordnet jeden Speicherkopf L1, L2 oder L3 zu. **Unbekannt** verwendet eine vorsichtige Reserve auf allen Phasen. Mit **Phasenlage testen** misst das EMS die Zuordnung. Nach bestätigter elektrischer Rücknahme übernimmt es eine eindeutig erkannte Phase automatisch, auch wenn zuvor eine andere eingestellt war. Bei uneindeutiger Messung bleibt die bisherige Zuordnung erhalten. Derselbe Button steht bei jeder Wallbox. Während eines Wallboxtests pausiert der Speicher nach bestätigtem Stillstand. [Voraussetzungen und Ablauf](docs/release-0.17.0-alpha.296.md)
- **Bis zu dieser Gesamtleistung einen Speicherkopf verwenden** bündelt kleine Aufträge ab zwei Köpfen. Bei der Vorgabe **500 W** gehen auch 100 W an einen geeigneten Kopf. Beim Laden werden Köpfe mit niedrigerem, beim Entladen mit höherem SoC bevorzugt. Die **SoC-Hysterese für die Kopfauswahl** hält einen laufenden Kopf innerhalb der vorgegebenen **5 Prozentpunkte** im Einsatz. Neue Starts rotieren unter passenden Köpfen. Oberhalb der Schwelle verteilt das EMS nach SoC und Online-Packzahl. [Verteilung und Rückmeldung](docs/release-0.17.0-alpha.285.md)
- **Speicher vor PV-Autoladung laden und kleine Wallbox-Leistungssprünge puffern** und **Wallbox-Stromschritte nach dem Ziel-SoC des Speichers abstimmen** beeinflussen die optionale PV-Zuteilung. Die Tagesziele bestimmen, wie viel Kapazität für spätere PV und wie viel Ladebudget für Autos vorgesehen sind.
- **Speicherenergie für das nächste Hochtariffenster reservieren** hält gespeicherte Energie für die erwartete Hauslast im nächsten eingestellten Hochfenster zurück. Bei gleichem Preis bevorzugt der Fahrplan Viertelstunden mit höherer erwarteter Last nach PV. Der Regler entlädt nach dem gemessenen Bedarf. Aktiviere die Option, wenn die zeitabhängigen Netzentgelte für deinen Anschluss gelten. [Beispiel und Diagnose](docs/release-0.17.0-alpha.295.md)
- **Speicher-Netzladen in ausgewählten günstigen Zeiten erlauben** steuert die optionale Preisladung und lässt sich separat einschalten. Prüfe Preisobergrenze, Preis-Ziel-SoC und Mindestersparnis nach Speicherverlusten. Die Schutz-Nachladung der Prognosereserve folgt der oben beschriebenen eigenen Freigabelogik.
- **Totband der Speicher-Netzregelung**, Schrittweite und Rückmeldefrist bestimmen das Verhalten bei kleinen Änderungen. Prüfe zunächst die Geschwindigkeit deiner Netz- und Gerätemessung. Das Totband ist eine Toleranz in W. Die Kopfauswahl und der Geräte-Wiederanlauf verwenden eigene SoC-Abstände in Prozentpunkten.

Bei vorgehender Gerätezeit nutzt die koordinierte Einzelkopfregelung zwei fortlaufende Originalmeldungen. Für Leistungen über 100 W darf der Vorlauf beider Messungen jeweils höchstens zehn Sekunden betragen. Zusätzlich braucht das EMS aktuelle Messwerte für Netzbezug und Einspeisung. [Beispiel mit 2,4 kW Entladung](docs/release-0.17.0-alpha.332.md)

**Wiederanlauf nach GS-Konflikt.** Nach dem gesendeten Nullbefehl muss jeder konfigurierte Kopf in einer frischen Originalmeldung zugleich `GS = 0 W` und `GP = 0 W` bestätigen. Sobald alle Köpfe den Stillstand bestätigt haben, kann das EMS den nächsten Auftrag aus der aktuellen Netzleistung und den wirksamen Grenzen berechnen. `Devices.Battery.OutputStatus` zeigt den Grund, falls der Speicher weiter wartet. [Zeitfolge am Speicherkopf](docs/release-0.17.0-alpha.314.md)

Zur Diagnose zeigen `Plan.BatteryForecastReserve_JSON` die erwartete Unterschreitungsdauer und `Control.BatteryForecastReserveCharge_W` sowie `Control.BatteryForecastReserveGridCharge_W` die zugeteilte Gesamt- und Netzladeleistung. [Speicher-Nullregelung und Diagnose](docs/admin-reference.de.md#live-regelung-des-speichers)

## Admin: Wärmepumpe

Der Reiter liest die Wärmepumpe und kann interne Empfehlungen anzeigen. Die Wärmepumpe, ihr SG-Ready-Eingang und KNX-Aktoren werden weiterhin von ihrer vorhandenen Steuerung bedient.

1. Aktiviere **Wärmepumpe vorhanden** und ordne Leistung, Einheit **W** oder **kW** sowie Messumfang zu. Eine Invertermessung bildet nur diesen Teil der Aufnahme ab. Ergänze, soweit vorhanden, Verbindung, die tatsächliche dekodierte SG-Ready-Stufe 1–4 und Temperaturen.
2. Für interne Empfehlungen aktiviere **An EMS-Empfehlungen teilnehmen** und **Passive SG-Ready-Empfehlungen aktivieren**. Setze passende Temperaturziele und eine Überschuss-Einschaltschwelle oberhalb der Ausschaltschwelle. Stufe 4 braucht zusätzlich ihre eigene Freigabe.
3. Prüfe **tatsächlichen SG-Ready-Zustand**, **empfohlenen SG-Ready-Zustand** und **Grund** getrennt. Für die optionale interne Kühl-Empfehlung braucht das EMS gültige Raum-, Vorlauf- und Taupunktwerte. Prüfe auch dort die getrennte Anzeige. [Quellen, SG Ready und Kühl-Empfehlung](docs/admin-reference.de.md#admin-wärmepumpe)

## Admin: Wärmestrategie

Ordne den **gemeinsamen Kühlstatus** zu, wenn der Heizpuffer-Kreis auch kühlt. Ein bestätigtes `true` beziehungsweise `1` meldet Kühlung. Prüfe bei einem konstanten Signal, ob der Treiber oder ein echter Quell-Heartbeat seine Aktualität nachweist. Während der Kühlung sperrt das EMS den Heizpuffer-Heizstab. Die Trinkwarmwasserbereitung hat einen eigenen Pfad.

Für bewusstes **Günstigpreisheizen** setzt du die gemeinsame Freigabe, den maximal akzeptierten Gesamtpreis in ct/kWh und das maximale gesamte Netzleistungsbudget in W. 0 W erlaubt kein preisgeführtes Netzheizen. Beim vorgesehenen Festtarif ist eine zusätzliche Zustimmung erforderlich. Prüfe im Fahrplan Zeitfenster und Wärmebedarf sowie im Livebetrieb Temperatur, Freigabe und gemessene Leistung. [Wärmefreigaben und Kühlstatus](docs/admin-reference.de.md#admin-wärmestrategie)

## Admin: Echtzeitregelung

Der **Netzsollwert** gibt das gewünschte Saldo vor. `0 W` bedeutet Ausgleich am Netzanschluss. `−100 W` zielt auf 100 W Einspeisung. `+100 W` zielt auf 100 W Bezug. Wähle den Sollwert, den du am Zähler prüfen willst.

Das **Totband** toleriert kleine Abweichungen. Die **gemeinsame Netzbezugstoleranz für PV-Wallboxen** betrifft die PV-Fahrzeugladung. Der Speicher besitzt zusätzlich sein eigenes Totband. **Simulation aktivieren** schaltet die gemeinsame Berechnung ein. Reale Befehle hängen weiterhin von den passenden Freigaben ab. Vergleiche `Control.ActualGridPower_W` und `Control.TargetGridPower_W` über mehrere Messzyklen. [Regelzyklus und Toleranzen](docs/admin-reference.de.md#admin-echtzeitregelung)

## Admin: Erweiterte Datenpunkte

Verwende für Mess- und Gerätedatenpunkte die beschrifteten Felder ihrer Reiter. Hier stehen zusätzlich die alte JSON-Zuordnung, die Namen der PV-Prognoseflächen und frühere Datenpunkte für freien Phasenstrom.

Bei einem Update kann ein vorhandener JSON-Eintrag für ein leeres normales Feld weiterwirken. Ein ausdrücklich ausgefülltes Feld hat Vorrang. Übertrage alte Zuordnungen einzeln und prüfe danach Quelle und Diagnose. [Migration und Priorität](docs/admin-reference.de.md#admin-erweiterte-datenpunkte)

### PV-Flächen im Prognosebaum

Für den direkten PV-Prognosepfad wertet der aktuelle Stand fünf Flächenplätze aus. Trage die tatsächlichen Namen der Unterordner im Feld **Bisherige Datenpunktzuordnung als JSON** ein. Beispiel für fünf bereits im Prognoseadapter eingerichtete Flächen

```json
{
  "PV_AREA1_NAME": "Ost",
  "PV_AREA2_NAME": "Sued",
  "PV_AREA3_NAME": "West",
  "PV_AREA4_NAME": "Carport",
  "PV_AREA5_NAME": "Garage"
}
```

Übernimm vorhandene JSON-Einträge in dasselbe Objekt. Prüfe `Forecast.PV_48h_JSON` gegen die Summe der zugeordneten Flächen für dieselbe Stunde. Der direkte Pfad braucht gültige Werte für alle fünf Plätze. Mit weniger Flächen kannst du die aktuelle PV-Messung und die Istwertregelung einrichten. Für den direkten PV-Fahrplan braucht der Prognosepfad eine passende Quellenstruktur. [Prognosequellen](docs/admin-reference.de.md#prognosequellen)

## Admin: Geräte

Die beiden Tabellen nutzen vorhandene ioBroker-Geräteobjekte. Art und Werte der Datenpunkte hängen vom Geräteadapter ab.

**Netzphasen der Hausgeräte im Betrieb erkennen** beobachtet die gemessene Leistung der eingetragenen Geräte und die Änderungen von L1–L3 am Netzanschluss. Nach mindestens drei passenden Lastwechseln mit Anstieg und Abfall zeigt die Übersicht die erkannte Phase. Wechselnde Speicher-, PV- oder andere gemessene Leistungen verwerfen die Messung. Eine Master-Freigabe ist dafür nicht nötig. Ergebnisse und Messnachweise bleiben je Leistungsmesspunkt gespeichert. Kleine oder uneindeutige Lastwechsel bleiben unbekannt. Für Kühlschränke kann auch in der Temperaturtabelle ein Leistungsobjekt mit Einheit eingetragen werden. Unter **Geräte → Erkannte Netzphasen der Hausgeräte** siehst du das Ergebnis. Für Geschirrspüler, Trockner und andere Hausgeräte ist die Phase schreibgeschützt. Einen eigenen Button **Phasenlage testen** gibt es bei jeder Wallbox und jedem eingerichteten Speicherkopf. [Messung der Hausgeräte](docs/release-0.17.0-alpha.297.md) · [Test für Wallbox und Speicher](docs/release-0.17.0-alpha.296.md)

### Programmplanung für Haushaltsgeräte

1. Lege für Geschirrspüler oder Trockner eine Zeile im Modus **Beobachten** an. Ordne das Objekt für die Fernstartfreigabe samt Wert, das Statusobjekt und dessen genaue Werte für bereit, läuft und fertig zu. Der JSON-Freigabewert kann zum Beispiel `true`, `1` oder `"Ready"` sein. Prüfe Wert und Typ im Objektbaum.
2. Für **Gewähltes Programm starten** ordnest du das Objekt der Programmauswahl und das passende beschreibbare Startobjekt zu. Ein vorhandenes Objekt für das aktive Programm unterstützt die Zuordnung zur tatsächlichen Ausführung. Aktivierte Fernstartfunktion am Gerät, bestätigter Bereitstatus und Programmauswahl müssen zusammenpassen.
3. Ordne eine historisierte Geräte-Leistungsmessung mit der passenden Einheit **W**, **mW** oder **kW** zu. Hat das Gerät noch kein gemessenes Programmprofil, starte ein beliebiges Programm einmal manuell und lass es vollständig durchlaufen. Danach kann das EMS auch ein erstmals gewähltes Programm per Fernstart einplanen. Dafür nutzt es je Viertelstunde den Mittelwert der bekannten Programmprofile dieses Geräts. Den tatsächlichen Verbrauch lernt es unter der ausgeführten Programmkennung. Schon beim nächsten Fernstart verwendet es das eigene Profil, sobald eine vollständige Messung vorliegt. Unter `Devices.ProgramProfiles` prüfst du Programm, Anzahl der gemessenen Läufe und Energie. Bei einer Zeile ohne Programmauswahl kannst du ein festes Viertelstundenprofil vorgeben, zum Beispiel `[1000, 500, 100, 0]`. Dieses Beispiel steht für eine Stunde mit etwa 0,4 kWh.
4. Wähle bei Bedarf ein Zeitfenster. `06:00` bedeutet **bis 06:00 Uhr fertig** (Ortszeit des ioBroker-Hosts). `+4` bedeutet **innerhalb von vier Stunden nach der Fernstartfreigabe starten**. Dieses Fenster läuft auch bei Neuplanung, Programmwechsel und Neustart ab der ursprünglichen Freigabe. Unter `Devices.Programs.N` stehen der geplante Start und die geschätzten Kosten gegenüber dem Sofortstart.
5. Setze **Automatisch** erst nach dem Zuordnungs- und Profiltest. Mit Master und aktiver Echtzeitregelung prüft das EMS bei der Planung und unmittelbar vor dem Start die zugehörige Fernstartfreigabe, den Status und das gewählte Programm. Die laufende Leistungsaufnahme bestätigt den realen Start. `Devices.Programs.N.Announcement` liefert in diesem Modus Ansagedaten, die ein eigenes Skript etwa für Alexa ausgeben kann.

Alle freigegebenen Geräte der Programmtabelle teilen sich denselben prognostizierten Überschuss. Das EMS berücksichtigt zuerst laufende Programme und bereits gesendete Starts mit ihrem verbleibenden Lastprofil. Unter den wartenden Automatikgeräten hat die frühere Fernstartfreigabe Vorrang. Bei Gleichstand entscheidet die Tabellenreihenfolge. Die Startzeiten werden im 15-Sekunden-Zyklus anhand der aktuellen Prognose neu berechnet. Zwei Geräte können gleichzeitig laufen, wenn der Überschuss für beide reicht oder das gemeinsame Zeitfenster günstiger ist. Ein bereits laufendes Gerät im Modus **Beobachten** zählt ebenfalls mit. Unter `Devices.Programs.N` findest du den neuen Start in `plan.plannedStartAt` und den verwendeten Prognosestand in `plan.forecastUpdatedAt`. [Gemeinsame Planung und Startprüfung](docs/release-0.17.0-alpha.298.md)

<a name="geräte-relatives-startfenster-und-diagrammkurven-alpha301"></a>

Für ein Diagramm liefert `Plan.Appliances_48h_JSON` je Gerät den stabilen `deviceKey`, Programm, Start, Ende und eine Viertelstundenreihe mit mittlerer Leistung (`valueW`) und Energie (`energy_kWh`). Die Summenreihe umfasst eingeplante, gestartete und laufende Geräte. Vorschauen tragen `scheduled: false`. Unter `unresolvedDevices` stehen laufende Geräte ohne verwertbares Restprofil. Wenn der Hauszähler ein Gerät mitmisst, ist seine Last in der gemessenen Hauslast schon enthalten. [Gerätekurven und Zeitfenster](docs/release-0.17.0-alpha.301.md)

Startest du ein Programm direkt am Gerät, übernimmt der 48-Stunden-Fahrplan sein Restprofil mit der gemeldeten Startzeit. So berechnen Speicher, Wallboxen und Warmwasser den verfügbaren PV-Überschuss neu. Unter `Plan.Allocation_48h_JSON` zeigt `applianceW` den bereits in `baseW` enthaltenen Programmanteil. Misst ein konfigurierter Haus-Unterzähler das Gerät mit, kannst du das in der Programmzeile bestätigen. Dann zieht das EMS vollständig gemessene Programmlast beim Lernen der Grundlast ab. [Rechenbeispiel und Messzuordnung](docs/release-0.17.0-alpha.318.md)

### Temperatur-Sollwertoptimierung

Ordne die aktuelle Temperatur und den **beschreibbaren Sollwert** eines geeigneten Geräts zu, etwa bei einem Kühlschrank mit dafür vorgesehener Schnittstelle. Trage die vom Gerät erlaubte niedrigere Optimierungstemperatur und die normale Temperatur ein. Bei stabilen Bedingungen kann das EMS einen niedrigeren Wert in ein günstiges Preisfenster oder in verfügbaren Überschuss legen. Ohne geeigneten Anlass wählt es die Normaltemperatur. Starte die Prüfung mit Master aus und kontrolliere `Devices.Setpoints.N`. Ein realer Schreibbefehl erfordert beide gültigen Rückmeldungen und passende Objektgrenzen. [Gerätefelder und Statuswerte](docs/admin-reference.de.md#admin-geräte)

## Typische Einrichtung und Fehlersuche

| Was du beobachtest | Wo du zuerst nachsiehst |
| --- | --- |
| Die Übersicht meldet fehlende Daten | **Messwerte**, richtige Instanz, Einheit, Aktualität und Bestätigung. Bei verbundenen Quellen den zugehörigen Originalstatus prüfen. |
| Ein Gerät steht im Fahrplan und bleibt aus | **Allgemein** und Gerätereiter, dann Geräte-, Benutzer- oder Fernstartfreigabe, aktuelle Begrenzungen und vorhandene Leistung prüfen. |
| Das Auto lädt aus dem Netz, obwohl wenig PV da ist | **Wallbox N** prüfen. Unter Mindest-SoC kann Pflichtladung greifen. Zusätzliche Gründe sind manuelle Mindeststromvorgabe, Abfahrts- oder Preisfreigabe. |
| Der Speicher entlädt nicht | **Batteriespeicher** und `Devices.Battery.EffectiveMinimumSoC_pct` prüfen. Dazu kommen eine mögliche Fahrzeug-Pflichtladung, Geräte-SoC, Wiederanlaufgrenze und Rückmeldung. |
| Die passende Ladung beginnt später | Überschuss, Startwartezeit, priorisierte Geräte, bestehende Leistung und mögliche Tarif-/SoC-Ziele in der Übersicht prüfen. |

Bei einem Störungsbericht helfen laufende Version, Uhrzeit mit Zeitzone, Gerät, erwartetes Verhalten und ein kleiner passender Ausschnitt von Auftrag, Bestätigung und Messwert. [Diagnose und SQL](docs/admin-reference.de.md#diagnose-sql-und-datenqualität) · [Support](SUPPORT.md)

## Aktuelle Änderungen

Die jüngsten Änderungen stehen mit Datum und Link zum jeweiligen Versionshinweis im englischen Changelog. Die Versionshinweise erläutern die Betriebsbedingungen und enthalten Rechen- oder Messbeispiele. [Aktuelles Changelog](README.md#changelog) · [Ältere Versionshinweise](CHANGELOG_OLD.md#deutsche-versionshistorie)

## Offene Arbeiten

Die [Roadmap #36](https://github.com/fuchs-1978/ioBroker.ems-optimizer/issues/36) verlinkt aktuelle Integrationen, tatsächliche Anlagenprüfungen und datierte Betriebsberichte. Eine gute erste Anlaufstelle für Anzeigefehler ist [Admin-Abnahme #26](https://github.com/fuchs-1978/ioBroker.ems-optimizer/issues/26).

### Einzelne Geräteprognosen in ECharts (Alpha.323)

In ECharts eine Datenreihe hinzufügen, Datenquelle **JSON** auswählen und `ems-optimizer.0.Chart.DeviceProgram1_48h_json_chart` für die erste Gerätezeile bzw. `ems-optimizer.0.Chart.DeviceProgram2_48h_json_chart` für die zweite eintragen. Einheit **W**, Faktor **1**, Darstellung Linie oder Stufenlinie. Die Nummer entspricht der Reihenfolge unter Geräte → Programmplanung. Die JSONs liefern direkt `ts` und `val`; SQL-Aufzeichnung und Umwandlungsskript werden nicht benötigt. Zurückgenommene Pläne werden entfernt, Beobachten-Vorschauen nicht als eingeplante Last gezeigt.
