# 0.17.0-alpha.202 — Warmwasserreserve vor dem Preissprung

## Beobachtung und Ursache

Der am 4. November um 22:54 Uhr Europe/Berlin gespeicherte Fahrplan fuer den 5. November plante den EHZ direkt nach dem Preissprung um 16:30 Uhr mit zweimal 9 kW. Die Preise stiegen von 30,04 auf 32,86 ct/kWh. Von 16:30 bis 21:00 wurden 4,3065 kWh Netz-Heizenergie prognostiziert. Das sind Zukunftsannahmen, keine gemessene Energie und kein freigegebener Heizbefehl.

Die bisherige Preisbruecke endete bereits an einer einzelnen vermeintlich ausreichenden PV-Viertelstunde. Dadurch wurde um 16:15 noch auf die Sonne um 16:30 gewartet, obwohl danach ein laengerer teurer Abschnitt ohne ausreichende PV folgte. Der Bedarf dieses Abschnitts wurde erst im teureren Fenster nachgeladen.

## Korrektur im bestehenden Planer

Vor einem strikt teureren Preisblock wird der notwendige Waermevorrat rueckwaerts berechnet. Der bekannte Block endet an einem gleich guenstigen/guenstigeren Preis, einer unbekannten Preisgrenze, am Prognoseende oder spaetestens am 24-Stunden-Horizont. Ein unbekannter Preis vor dem Anstieg erzeugt keine neue vorausschauende Netzanforderung.

Jede Viertelstunde des Blocks zaehlt ihren konfigurierten Verbrauch und Speicherverlust. Nutzbare prognostizierte PV nach Hauslast wird einmal und hoechstens bis zur Heizleistung angerechnet; ihre Energie kann im begrenzten Speicher in spaetere Viertelstunden uebertragen werden. Eine einzelne sonnige Viertelstunde beendet den Blick auf den Block nicht mehr.

Gleich teure Viertelstunden vor dem Anstieg koennen spaeter noch nachheizen. Nur der Teil, der mit deren verbleibender Heizleistung nicht mehr rechtzeitig aufgebaut werden kann, wird jetzt angefordert. Restzeit des aktuellen Fensters, maximale Heizleistung und freier Speicherplatz bleiben verbindlich. Fehlende Kapazitaet bleibt als spaetere notwendige Heizung beziehungsweise ungedeckte Reserve sichtbar; es wird kein voller Speicher oder verschwundener Waermebedarf erfunden.

Die bestehende Zuteilung verwendet den Waermebedarf vor optionaler Fahrzeugladung. Dadurch kann PV vorher von einem optional ladenden Fahrzeug zur Waermereserve wechseln. Quellen-, Fahrzeug-, Temperatur- und reale Ausgangsvertraege werden durch diese Prognose nicht ersetzt. Die Diagnose nennt einen zusaetzlichen Vorziehbedarf `price-preheat`; es gibt keine neuen States oder Admin-Parameter.

## Nachweis und Grenzen

[Bereinigte Eingabedaten](evidence/thermal-price-step-2026-11-05.json) enthalten die eingefrorenen PV-/Hauslast-/Gesamtpreiswerte, Waermeannahmen und die fuer die Planrechnung benoetigten Fahrzeugparameter. Es sind keine privaten Objekt-IDs, Verbindungsdaten oder kuenftigen Istwerte enthalten.

Der Regressionstest rekonstruiert mit den echten Planerfunktionen die alte 4,3065-kWh-HT-Spitze. Mit Alpha 202 verbleibt im betrachteten HT-Block keine Netz-Heizenergie; der erforderliche Vorrat wird vorher aufgebaut. Der Test kontrolliert auch die gemeinsame elektrische Bilanz, Mindestreserve, Heizleistungsgrenze und identische Ergebnisse bei wiederholter Berechnung. Ein weiterer Fall reproduziert den Fehler mit einer isolierten PV-Viertelstunde. Beide scheitern mit dem unveraenderten Alpha-201-Planer.

Weitere Grenzfaelle pruefen durchgehend ausreichende PV, eine vorher erreichbare guenstigere Gelegenheit, unbekannte Preise, kleinen Speicher mit zu kleinem Heizstab und nur eine verbleibende Minute vor dem Preissprung. Bereits vorhandene Kaltwasser-, Quellen-, Phasen- und Bilanztests bleiben wirksam.

Das Modell behaelt vier gleich grosse Speicherschichten, konfigurierten gleichmaessigen Verbrauch/Verlust und keinen sicheren Waermebeitrag von BHKW, Kessel oder WP. Es ist keine globale mathematische Kostenoptimierung und keine Zusage der tatsaechlichen PV-/Warmwassernutzung. Neue thermische Netzfreigaben, Temperaturgrenzen, reale Stellwerte und die Reglerzeitkonstanten werden nicht geaendert. Die laufende Anlage wird nicht automatisch installiert oder neu gestartet.
