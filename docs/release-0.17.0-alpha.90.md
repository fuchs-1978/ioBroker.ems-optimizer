# 0.17.0-alpha.90 – Einstellbare EMS-Gleichzeitigkeit im Admin

## Umfang und Bedienung

Neuer Reiter **Netzanschluss / §14a / EEBUS**. Hausanschlussschutz sowie Kontakt-/EEBUS-Zuordnungen wechseln mit identischen technischen Schluesseln aus Allgemein dorthin. Die Budgetquelle des Binaerkontakts ist waehlbar: bisheriges Festbudget, berechnetes EMS-Mindestbudget oder externer Gesamtwert. LPC bleibt separat ueber Status und Watt-Limit angebunden und wird niemals nochmals mit GZF multipliziert.

EMS-Berechnung aus fester Teilnehmertabelle mit eindeutigen Namen, Einrichtungstyp und elektrischer Netzanschlussleistung in W. Keine Ableitung aus angeschlossenen/ladenden Autos. Ladepunkte und Speicher werden einzeln gezaehlt, WP und Klima je Fallgruppe zusammengefasst. Grenze >4200 W, WP-/Klima-Sonderregel >11000 W, Zusatzheizung genau einmal innerhalb WP-Leistung. Standardwerte n=2:0.8, 3:0.75, 4:0.7, 5:0.65, 6:0.6, 7:0.55, 8:0.5, ab 9:0.45. Erweiterte Faktorabweichungen sind separat aktivierbar und werden validiert/markiert.

Offizielle Grundlagen am 18.10.2026 geprueft: [BNetzA Anlage 1 BK6-22-300, 4.5.2](https://www.bundesnetzagentur.de/DE/Beschlusskammern/1_GZ/BK6-GZ/2022/BK6-22-300/Beschluss/BK6-22-300_Beschluss_Anlage1.pdf?__blob=publicationFile&v=1), [BNetzA Mitteilung 6](https://www.bundesnetzagentur.de/DE/Beschlusskammern/1_GZ/BK6-GZ/2022/BK6-22-300/Mitteilung/Mitteilung_06/Mitteilung_Nr_06.html?nn=877500) und [finaler VDE-FNN-Hinweis April 2025](https://www.vde.com/resource/blob/2384602/0cb47de901b1129acad8510257ecc582/vde-fnn-hinweis-mindestleistung-data.pdf). FNN empfiehlt Beibehaltung der initialen Faktoren/Formeln. Dies ist keine Abnahme einer individuellen Teilnehmerzuordnung.

## Durchsetzung und Diagnose

Gemeinsame reine Berechnung fuer Planung und unabhaengigen Wallbox-Ausgang. Der EHZ-/Koordinationspfad verwendet weiterhin denselben zentralen Verbraucherschutz. Externes Binaerbudget benoetigt einen separat zugeordneten, bestaetigten, qualitaetsgueltigen und maximal 15 s alten W-/kW-Wert. Bei aktiver Begrenzung keine positive Freigabe aus ungueltiger Gruppe, fehlerhafter Einheit, fehlenden Quellen oder unvollstaendigen Faktorabweichungen. Gleichzeitig aktive Kontakt-/LPC-Grenzen behalten das kleinere Gesamtbudget. Bei inaktivem Kontakt aktiviert eine ungueltige Rechentabelle keine Begrenzung.

`Control.GridOperatorCalculation_JSON` zeigt Rechenherkunft, Teilnehmer, ausgeschlossene Gruppen, GZF, Sockel, Formel und Ergebnis, getrennt vom bisherigen wirksamen Ausgangsbudget. Der DecisionRecord enthaelt diese Herkunft als begrenzten strukturierten Kontext, keine abgeschnittene Teil-JSON.

## Migration, Tests und offene Abgrenzung

Ohne bewusste Quellenumstellung bleibt `fixed` mit dem bisherigen individuellen Watt-Limit aktiv. Teilnehmerliste leer, Faktorabweichung AUS, externe Quelle leer. Keine automatische Limiterhoehung, Installation, Aktorbetätigung oder Aenderung der Produktivkonfiguration.

Regressionen pruefen die komplette GZF-Tabelle inklusive n=1 und ab 9, Gruppierung und 11-kW-Grenze, 4.2-kW-Qualifikation, fehlende/doppelte Teilnehmer, Faktorvalidierung und fehlende Override-Tabelle, W/kW und Quellenqualitaet, Planung/Ausgang, strengeres LPC ohne Doppelskalierung, Migration und getrennte Mapping-IDs sowie begrenzte Recorder-Provenienz. Positive Rechen-/Planungs-/Ausgangstests scheitern an alpha.89. Vollstaendige Tests und Paketpruefungen vor Veroeffentlichung ausfuehren.

**Issue #166 bleibt offen:** Eigenstrom-/Netzbezugsbilanz, physische Teilnehmer-Messgrenzen und teilnehmerspezifische Budgetpools sind nicht Teil dieses GZF-Schritts. Zur Laufzeit gilt weiterhin die konservative gemeinsame Brutto-Kappung ohne PV-/Speicherbonus. Keine Aussage ueber bereits erfolgte reale §14a-/LPC-Abnahme. Die Toleranzregelung aus alpha.89 bleibt enthalten und kann diese Schutzgrenze nicht erhoehen.
