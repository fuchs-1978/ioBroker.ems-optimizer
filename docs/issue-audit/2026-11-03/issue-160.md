# Issue #160 – Feature: Komfortgeführte vorausschauende Bewirtschaftung von WW, Heizpuffer und FBH

Historischer Originalstand vor der Aufgabenbereinigung am 2026-11-03. Quelle: https://github.com/fuchs-1978/ioBroker.ems-optimizer/issues/160. Letzte Issue-Änderung: 2026-10-29T10:47:04Z. Dieser Snapshot ist ein Archiv, keine aktuelle Aufgabenliste. Aktueller Stand: [Roadmap #36](https://github.com/fuchs-1978/ioBroker.ems-optimizer/issues/36).

## Ursprünglicher Issue-Text

<!-- issue-audit-20261028 -->
## Betreiberentscheidung – Stand28.10.2026

Bewusst bis zur kommenden Wärmepumpe zurückgestellt. Die bekannte Wärmeplanung mit angenommener gleichmäßiger Warmwasserlast und später price-bridge-Nachholung wird jetzt nicht umgebaut. Vorhandene passive WP-/thermische Planungsfunktionen bleiben Grundlage; der Plan allein ist keine reale Netzheizfreigabe. Kein aktueller Implementierungs- oder Anlagenauftrag. Issue bleibt als späterer Wunsch offen.

---

Ich möchte mit der späteren Wärmepumpe Warmwasser, Heizpuffer und Fußbodenheizung gemeinsam vorausschauend als Wärmespeicher nutzen.

Dieser Wunsch erweitert vorhandene thermische Planung/PV-Boost-Funktionen; vor Umsetzung aktuellen Code und Roadmap #36 prüfen, vorhandene Funktionen nicht doppelt entwickeln.

- PV-/Preis-/Wetterprognose samt Unsicherheit, Raumkomfort, Wärmebedarf und Wärmeverluste berücksichtigen.
- WP und Heizstäbe nach geschätztem elektrischem Aufwand und nutzbarer Wärme koordinieren; keine pauschale COP-Annahme als Messwert ausgeben.
- Konfigurierbare Komfortgrenzen und nachvollziehbare Zieltemperaturen; Kühl-/Taupunktgrenzen separat erhalten.
- Unangeschlossene Geräte deaktiviert lassen; zuerst Vorschau/Empfehlung und realen Nachweis ermöglichen.

Abnahme: nachvollziehbare Planung mit begrenzten Prognosefehlern, Komfortgrenzen und sauberer Koordination. Keine aktuelle Anlagenänderung oder unmittelbare Umsetzung beauftragt.

Als Featurewunsch am 16.10.2026 aufgenommen. Kein Auftrag zur sofortigen Implementierung oder Installation; aktuelle alpha.83 unverändert weiter beobachten.

## Feature-Ergänzung: temperaturabhängige WP-Bedarfsprognose — 29.10.2026

Bei der späteren WP-Prognose die Außentemperatur von Anfang an als wesentlichen Eingang berücksichtigen. Bestehende Wetter-/thermische Planungsfunktionen vor Umsetzung prüfen und wiederverwenden.

- Prognostizierte Außentemperatur, geglättete/verzögerte Temperatur und Gebäudeträgheit berücksichtigen; Heizbedarf und elektrische WP-Aufnahme unterscheiden.
- Raumheizung und Warmwasserbedarf getrennt modellieren. Vorlauf-/Puffertemperaturen, Betriebszustand und verfügbare Wirkungsgrad-/Leistungsdaten berücksichtigen, soweit nachweisbar.
- Vor Inbetriebnahme nur nachvollziehbare Annahmen/physikalische Abschätzung mit ausgewiesener Unsicherheit; aus der Historie ohne WP kein gelerntes WP-Verhalten behaupten. Mit realen Betriebsdaten später kalibrieren.
- Wettervorhersage passend zum Planungshorizont verwenden; eine Auswertung mit später eingetretenem Wetter nicht als echte Vorhersagegüte ausgeben.
- WP-Bedarf getrennt von normaler Hauslast (#284), Fahrzeugen und EHZ führen. Bei der Gesamtbilanz vorhandene enthaltene Verbraucher konsistent bereinigen; keine Doppelzählung.
- Solare Wärmegewinne beziehungsweise Strahlungsprognose bei ausreichender Datenlage optional evaluieren.

### Zusätzliche Abnahmekriterien

- [ ] Annahmen, Temperaturwirkung, thermischer Bedarf und Umrechnung in elektrischen Bedarf nachvollziehbar dokumentieren.
- [ ] Nach Inbetriebnahme Prognosen mit realer WP-Aufnahme über ausreichend unterschiedliche Betriebs-/Temperaturfälle vergleichen.
- [ ] Warmwasser-/Heizanteile, Unsicherheit und fehlende Quellen sichtbar halten; Vorschau nicht als Gerätefreigabe behandeln.
- [ ] Gemeinsame Lastbilanz mit #284 ohne doppelt angesetzten WP-Verbrauch prüfen.

Die bestehende Betreiberentscheidung bleibt bestehen: **bis zur kommenden WP zurückgestellt; Batterie-/Modul-3-Integration #25 hat Vorrang.** Keine neue Version oder Anlagenänderung durch diese Feature-Erfassung.


