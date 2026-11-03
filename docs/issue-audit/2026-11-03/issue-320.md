# Issue #320 – [Wartet auf vw-connect #467] Fahrzeug-SoC ab Quellzeitpunkt mit Ladeenergie fortschreiben

Historischer Originalstand vor der Aufgabenbereinigung am 2026-11-03. Quelle: https://github.com/fuchs-1978/ioBroker.ems-optimizer/issues/320. Letzte Issue-Änderung: 2026-11-02T15:07:29Z. Dieser Snapshot ist ein Archiv, keine aktuelle Aufgabenliste. Aktueller Stand: [Roadmap #36](https://github.com/fuchs-1978/ioBroker.ems-optimizer/issues/36).

## Ursprünglicher Issue-Text

## Status und Abhängigkeit

**Zurückgestellt / wartet auf den Quelladapter.** Abhängig von https://github.com/TA2k/ioBroker.vw-connect/issues/467, insbesondere dem [Nachtrag mit JSON-Beleg](https://github.com/TA2k/ioBroker.vw-connect/issues/467#issuecomment-6580109313).

Auf Betreiberwunsch am 02.11.2026 als spätere EMS-Aufgabe aufgenommen. Zuerst Antwort bzw. Umsetzung in vw-connect abwarten. Dieses Issue beauftragt **keine sofortige Implementierung, neue Version, Installation oder Änderung der laufenden SoC-Korrektur**.

Voraussetzung für die Integration: vw-connect stellt den zum jeweiligen SoC gehörenden `Data[].timestampUtc` zuverlässig bereit; Format, Einheit und Zuordnung von Wert und Quellzeit müssen geklärt sein. Ein geschlossener Upstream-Issue allein reicht nicht als Funktionsnachweis.

## Ziel

Ein verspätet gemeldeter Fahrzeug-SoC wird an seinem **Quellzeitpunkt x** verankert. Das EMS ermittelt die seit x tatsächlich gemessene Ladeenergie und schreibt den damaligen SoC bis jetzt fort:

`SoC_jetzt = SoC_x + 100 × (E_AC_jetzt − E_AC_x) × η / C_nutzbar`

Beispiel: **60 % von 14:02:24 Uhr** plus die seit diesem Zeitpunkt geladene Energie einschließlich konfigurierter Ladeverluste. Nicht den verspäteten Empfang als neuen Fahrzeug-Messzeitpunkt behandeln; Energie nicht doppelt zählen.

## Konkreter Befund vom 02.11.2026

Vom Betreiber gelieferter JSON-Ausschnitt, ohne Fahrzeug-/Benutzerkennung:

```json
{
  "dataFieldName": "state_of_charge",
  "value": "60",
  "timestampUtc": "2026-11-02T13:02:24.000Z"
}
```

Alle folgenden Ortszeiten Europe/Berlin (CET):

| Information | Zeitpunkt |
| --- | --- |
| SoC-Quellzeitpunkt im JSON | **14:02:24** |
| ioBroker letzte Wertänderung, lc=1793628488323 | 15:08:08.323 |
| Export-Erstellung laut _dataset_created_on | 15:25:21 |
| ioBroker letzte Veröffentlichung, ts=1793629566728 | **15:26:06.728** |

Beim letzten Abruf ist der Quellwert somit bereits **1 h 23 min 42,728 s** alt. Zwei Exportdateien mit Namenszeiten **14:25:02 UTC** und **14:39:56 UTC** enthalten dieselben **57 Einträge mit unveränderten Werten und Quellzeitstempeln**. Im zweiten Export beträgt der Abstand zwischen Namenszeit und SoC-Quellzeit etwa **98 Minuten**. Ein neuer Export oder ioBroker-ts belegt deshalb keine neue Fahrzeugmessung.

## Vorhandenes wiederverwenden und erforderlichen Rest prüfen

Im EMS existieren bereits `lib/vehicle-soc-estimator.js`, eine optionale Messzeitzuordnung (`wbNSocMeasurementTimeId`), ein Energie-Ledger und die geschützte manuelle SoC-Korrektur. **Keine zweite SoC-Berechnung oder parallele Historienlösung bauen.** Nach Klärung des Upstream-Vertrags zuerst prüfen, welche Fälle bereits korrekt unterstützt werden.

- SoC, Quellzeit und Veröffentlichungszeit eindeutig zuordnen; Format/Einheit des künftigen Adapter-Datenpunkts prüfen. Keine künstliche Zeitzonenverschiebung.
- Energiezähler am Quellzeitpunkt aus einer belastbaren, zeitlich zugeordneten Historie bestimmen; dazwischen geladene Energie genau einmal berücksichtigen. Keine gesamte Ladesitzung auf einen späteren Anker addieren.
- Begrenzte, neustartfeste Historie ausreichend für den belegten Verzug von rund 98 Minuten plus begründeter Reserve auslegen bzw. vorhandene Aufzeichnung wiederverwenden. Bestehende Grenzen von 2 Stunden / maximal 256 Ledger-Proben gegen die tatsächliche Abtastrate prüfen. Verdichtung darf Lücken, Zählerrücksetzungen oder Sitzungswechsel nicht verdecken.
- Wiederholungen desselben Quellzeitpunkts idempotent behandeln; verspätete ältere Berichte dürfen einen neueren gültigen Anker nicht verdrängen. Ein tatsächlich neuerer SoC darf auch niedriger sein.
- Fehlende/ungültige/zukünftige Quellzeit, widersprüchliche Wert-Zeit-Zuordnung, fehlender Zähleranker, Qualitätslücken, Zählerreset und unklare Fahrzeug-/Ladesitzung explizit behandeln. Keine Ladeenergie über eine Fahrt oder eine unbelegte Lücke erfinden.
- Manuelle Korrektur weiter schützen. Ablösung nur nach vorhandenen bzw. überprüften Wiederaufnahmebedingungen durch eine nach der Korrektur liegende, gültige und zeitlich zuordenbare Fahrzeugmessung.
- Diagnose zeigt gemeldeten SoC mit Quellzeit/Quellalter, Veröffentlichungszeit, fortgeschriebenen SoC, verwendete Energie und Status bzw. Grund einer nicht möglichen Fortschreibung.

## Abnahme nach verfügbarer Adapter-Unterstützung

- [ ] Upstream-Datenpunkt, Version und Wert-/Zeitvertrag belegt; vorhandene Messzeitkonfiguration verwendet.
- [ ] Verspäteter 60-%-Bericht wird mit der Energie **ab 14:02:24** bis jetzt verrechnet, nicht ab 15:08 oder 15:26.
- [ ] Wiederholung desselben Quellwerts/-zeitpunkts setzt den SoC nicht zurück und zählt keine Energie doppelt.
- [ ] Belegter Verzug von rund 98 Minuten wird bei vollständiger Historie unterstützt; fehlende Historie führt zu einem nachvollziehbaren eingeschränkten Status.
- [ ] Ältere/neuere Meldungen, echter SoC-Rückgang, Zeitformate, Grenzwerte, Neustart, Zählerreset, Abstecken/Fahrt, Datenlücken und manuelle Korrektur sinnvoll geprüft.
- [ ] Reale Zuordnung und Fortschreibung nach separatem Implementierungs-/Installationsauftrag nachgewiesen; Softwaretests allein sind keine Anlagenabnahme.


