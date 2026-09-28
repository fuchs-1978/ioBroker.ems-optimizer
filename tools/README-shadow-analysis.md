# SQL-Schattenaufzeichnungen auswerten

`node tools/analyze-shadow.js export.json` liest ausschließlich eine vorhandene
JSON-Datei und schreibt das Ergebnis als JSON nach stdout. Ohne Dateinamen bzw.
mit `-` wird stdin gelesen. Das Werkzeug hat keinen Zugriff auf ioBroker, SQL oder
Aktoren und verändert weder Daten noch Einstellungen.

Das folgende Beispiel verwendet frei gewählte Zeitstempel und enthält keine
Messdaten einer Anlage.

```json
{
  "window": {
    "from": "2025-01-01T00:00:00Z",
    "to": "2025-01-02T00:00:00Z"
  },
  "records": [],
  "maxRecordGapMs": 65000,
  "activePowerThresholdW": 100,
  "energy": {
    "counterUnit": "kWh",
    "importCounter": [],
    "exportCounter": [],
    "netPower": [],
    "maxPowerHoldMs": 65000
  }
}
```

`records` enthält die exportierten `Debug.Shadow.DecisionRecord`-SQL-Zeilen
`{ts, val}` (JSON-Text in `val`) oder bereits geparste Entscheidungsobjekte. Das
Zeitfenster ist verpflichtend: Millisekunden seit Epoch oder ISO-Zeit mit Zeitzone.
Die Reihenfolge wird anhand der **Entscheidungszeit** rekonstruiert, nicht anhand
des möglicherweise verspäteten SQL-Schreibzeitpunkts.

Pro Wallbox werden `modeled` (virtuelle Ausgangsleistung) und `measured`
(aufgezeichnete reale Leistung) getrennt ausgewertet. Eine abgeschlossene
Unterbrechung benötigt aktive Leistung davor und danach. Datenlücken, ungültige
Datensätze, fehlende Werte, ein eingeschalteter Master, Sessionwechsel,
Sequenzsprünge und neu gemeldete Schreibfehler brechen diese Kette. Sie werden
**nicht** als Ladeunterbrechung gezählt. Eine noch offene Unterbrechung erscheint
separat. Die Zeiten sind durch die Aufzeichnung bestimmt; ein gemessener
Leistungseinbruch beweist weder eine Freigabeabschaltung noch dessen Ursache.
Auch stabile positive Leistung unterhalb der einstellbaren Schwelle ist in
dieser Auswertung „inaktiv“.

Ein abgestecktes Fahrzeug (`car=1`), ein erreichtes Ziel-SoC oder eine entzogene
Benutzerfreigabe beendet den Ladevorgang regulär. Solche Ereignisse erscheinen
unter `normalEnds`; späteres erneutes Anstecken wird nicht als stundenlange
Ladeunterbrechung gewertet. Ein kurzzeitiges `allow=0` allein gilt dagegen nicht
als reguläres Ende.

Duplikate, abweichende Daten mit derselben Sequenznummer, Zeitkollisionen,
Aufzeichnungsfehler und fehlende Sequenzen erscheinen unter `diagnostics`.
`unknownMs` bzw. `coverage` zeigen die auswertbare Dauer. Vor dem ersten und nach
dem letzten Datensatz wird kein Zustand extrapoliert. Kumulierte Fehlerzähler
beziehen sich auf die Recorder-Session; ein bereits vor dem Fenster bestehender
Fehler macht einen späteren lückenlosen Abschnitt nicht automatisch ungültig.

Netzenergie wird bevorzugt aus **beiden** monotonen Zählerreihen berechnet.
`importCounter` und `exportCounter` benötigen gültige Messungen exakt an den
gewählten Fenstergrenzen; rückläufige Zählerstände oder ungültige Zwischenwerte
verhindern diese Berechnung. Zählerrücksetzungen werden nicht still korrigiert.
Die Werte in `{ts,val}` verwenden die Einheit `counterUnit` (`kWh`, alternativ
`Wh`). Die Abdeckung beider Zähler muss dasselbe Zeitfenster umfassen.

Fehlen geeignete Zähler, wird `netPower` in Watt integriert: positiv ist Bezug,
negativ Einspeisung. Es gibt keine automatische Subtraktion zweier asynchroner
SMA-Leistungsreihen. Ein Wert gilt höchstens `maxPowerHoldMs`, standardmäßig
65 Sekunden, und nie über den letzten vorhandenen Zeitstempel hinaus. `null`,
fehlerhafte Qualität und widersprüchliche Duplikate werden nicht als 0 behandelt.
Bei `complete:false` betreffen die Energiemengen ausschließlich die abgedeckten
Intervalle und dürfen **nicht** als Tagesbilanz bezeichnet werden. Auch bei
vollständiger Abdeckung bleibt die Leistungsintegration eine Näherung.

Für die Einbindung in andere lokale Auswertungen exportiert
`lib/shadow-analysis.js` die reinen Funktionen `analyzeShadow(input)` und
`analyzeEnergy(energy, window)`.
