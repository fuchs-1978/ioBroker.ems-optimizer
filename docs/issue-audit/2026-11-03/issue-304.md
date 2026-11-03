# Issue #304 – [Idee, zurückgestellt] KONNEX-Zeitpläne über konfigurierbare Objekt-Schnittstelle für EMS zugänglich machen

Historischer Originalstand vor der Aufgabenbereinigung am 2026-11-03. Quelle: https://github.com/fuchs-1978/ioBroker.ems-optimizer/issues/304. Letzte Issue-Änderung: 2026-10-31T10:02:24Z. Dieser Snapshot ist ein Archiv, keine aktuelle Aufgabenliste. Aktueller Stand: [Roadmap #36](https://github.com/fuchs-1978/ioBroker.ems-optimizer/issues/36).

## Ursprünglicher Issue-Text

## Status und Auftrag

Idee auf ausdrücklichen Betreiberwunsch festhalten. **Zurückgestellt: vorerst beobachten und vorhandene Daten sammeln. Kein unmittelbarer Implementierungs-, Installations- oder Steuerungsauftrag.**

## Ausgangslage

Die Raumzeitpläne liegen derzeit fest im separaten ioBroker-KONNEX-Skript. Es schaltet Komfort, Standby, Nacht und Frostschutz und berücksichtigt Ferien/Abwesenheit. Das zentrale Sommerbetriebsskript wirkt zusätzlich über einen Zwangsmodus.

Laut Betreiber beginnt der vorhandene PV-Boost, die Fußbodenheizung unabhängig vom normalen Raumtemperaturbedarf aufzuheizen. Er dient damit dem gezielten Laden des Estrichs als Wärmespeicher. Die konkreten Temperaturbegrenzungen und das Verhalten in den verschiedenen KNX-Modi sind vor einer späteren EMS-Anbindung zu prüfen, nicht vorauszusetzen.

## Idee

- KONNEX-Zeitpläne aus der festen Skriptdefinition in eine konfigurierbare Struktur überführen. **Dauerhafte Einstellungen und Raumzuordnungen im EMS-Admin pflegen**; keine versteckte Objekt-Konfiguration mit Vorrang vor sichtbaren Admin-Einstellungen.
- Objekte können als dokumentierte Schnittstelle zum bestehenden Heizskript dienen: geplanter Basismodus, nächste Nutzungs-/Komfortzeit, tatsächlicher Modus sowie gegebenenfalls zeitlich begrenzte EMS-Anforderung mit Herkunft, Gültigkeit und Rückmeldung. Konkretes Schema erst bei späterer Umsetzung festlegen.
- Zunächst dem EMS die Zeitpläne ausschließlich lesend zugänglich machen, damit zukünftiger Wärmebedarf und die Nutzungszeit gespeicherter Wärme bekannt sind. Reine Zustandsarchivierung liefert noch keinen zukünftigen Zeitplan.
- Später prüfen, ob die vorhandene PV-Boost-Funktion zum Vorheizen in geeigneten PV-/Preisfenstern genügt. Ein Vorziehen des KONNEX-Komfortmodus ist nicht automatisch erforderlich. Keine pauschale Übernahme der Raumregelung durch das EMS.

## Grenzen einer möglichen späteren Steuerung

- Genau eine zuständige Stelle schreibt den wirksamen KONNEX-Modus; keine konkurrierenden Schreibzugriffe von Zeitplanskript und EMS. Basiszeitplan und begrenzte Zusatzanforderung nachvollziehbar zusammenführen.
- Freigabe pro Raum, maximale Dauer und geeignete Raum-/Bodentemperaturgrenzen vor einer Aktorfreigabe festlegen. Sommerbetrieb, Abwesenheit, Fenster- und vorhandene Geräteschutzfunktionen berücksichtigen; manuellen Eingriff und Verhalten bei Ausfall/abgelaufener Anforderung definieren.
- Wassergeführte FBH erfordert passende Wärmeerzeugung. Elektrisch beheiztes Kind 3 separat modellieren und einen möglichen Boost als unmittelbaren zusätzlichen elektrischen Verbraucher im gemeinsamen Leistungsbudget berücksichtigen. Stell-/Schaltzustände sind kein unabhängiger Leistungs- oder Wärmemengennachweis.
- Zuerst geeignete Temperatur- und Leistungs-/Wärmedaten sowie tatsächlichen Nutzen auswerten. Keine Einsparung oder Flexibilität allein aus der Existenz des Boost-Datenpunkts ableiten.

## Bezug

#284: Lastprognosevergleich und Raumhistorie; #160: separate Wärme-/Wärmepumpenmodellierung.

Die aktuelle Raumhistorie und der Median-/Lasso-/Kombinationsvergleich laufen weiter. Bestehende KONNEX-Zeitpläne und PV-Boost bleiben unverändert. Dieses Issue erfasst die Idee und erteilt keine neue Umsetzungsfreigabe.

