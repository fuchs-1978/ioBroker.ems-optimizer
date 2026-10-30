# 0.17.0-alpha.171 – manuelle Fahrzeug-SoC-Korrektur

Nach einmaliger Installation dieser Version ist fuer Korrekturen kein Neustart erforderlich.

Unter `ems-optimizer.0.Vehicles.Wallbox0` (Mii), `Wallbox1` (EQV) bzw. `Wallbox2` (EQE):

- `SoCCorrection_pct`: einen aktuellen, am Fahrzeug oder in der App geprueften Wert von 0 bis 100 mit **ack=false** schreiben. Beispiel: 94. Wiederholtes Schreiben desselben Wertes setzt eine neue Basis.
- `SoCCorrectionStatus`: Annahme oder Ablehnungsgrund des letzten Befehls.
- `SoCCorrectionActive`: eine geschuetzte manuelle Basis ist gespeichert. Ob sie nutzbar ist, zeigen `SoCValid`, `SocEstimateStatus` und `SoCStatus`.
- `SoCCorrection_pct = -1` mit **ack=false** hebt die manuelle Basis explizit auf; danach gilt wieder die konfigurierte Fahrzeugquelle. Nur tun, wenn diese wieder verlaessliche Werte liefert.

Voraussetzungen: SoC-Schaetzung aktiviert, Fahrzeug angeschlossen, Ladeenergiezaehler gueltig und maximal 60 Sekunden alt. Ungueltige oder ueber 60 Sekunden alte Befehle werden abgelehnt und bestaetigt. Ein gespeicherter Befehlswert wird beim Neustart nicht erneut angewendet; die zusammenhaengende Basis liegt im `SocEstimateLedger_JSON`.

Die aktuelle Zaehlerablesung wird als neue Basis gespeichert. Bereits vor der Korrektur geladene Energie wird nicht hinzuaddiert. Neue gueltige Ladeenergie wird mit konfigurierter Batteriekapazitaet und Ladewirkungsgrad fortgeschrieben. Wiederholte oder geaenderte Cloud-Werte ohne echten Fahrzeug-Messzeitpunkt koennen die Korrektur nicht ersetzen. Auch die schnelle produktive Wallboxpruefung benutzt diese qualifizierte Berechnung.

Die Basis bleibt beim Abstecken gespeichert, wird aber nach erkanntem Abstecken, ungeklaertem Sitzungswechsel, Zaehlerreset, unplausiblem Energieanstieg oder einer Unterbrechung der Zaehlerkette ausgesetzt (`manual-suspended`, `SoCValid=false`). Nach einer Fahrt erneut einen geprueften SoC setzen oder die Korrektur bewusst aufheben. Eine gueltige, neuere und zur Ladeenergie zugeordnete Fahrzeugmessung mit konfiguriertem Messzeitpunkt darf die manuelle Basis automatisch abloesen. Reine Wechsel zwischen verbunden/laden werden nicht als Fahrt gewertet.

Es werden keine VW-/Mercedes-Quelldaten ueberschrieben. Die alte Cloud-Quelle kann weiterhin veraltet sein; diese Version bietet eine geschuetzte, explizite Korrektur und behauptet keine Reparatur der Fahrzeug-Cloud. Allgemeine SoC-Schaetzung ohne manuelle Korrektur bleibt unveraendert.

Tests: Regression 65 % Cloud / 94 % manuell, neue Ladeenergie genau einmal, Neustart, identische Korrekturen, ungueltige Eingaben, Abstecken/Wiederanstecken, Zaehlerreset/-sprung/-luecke, neue echte Fahrzeugmessung, sofortige Ziel-SoC-Sperre und unveraenderte fremde Quelldaten.


## Warnung bei wiederholtem altem Cloud-SoC

`SoCWarning` und `SoCWarningText` melden einen Verdacht, wenn ein identischer Cloud-Prozentwert mit neuem Publikationszeitpunkt mindestens drei Prozentpunkte unter der aus einer lueckenlos gemessenen Ladekette erwarteten Groesse liegt. Normale Rundungsabweichungen loesen nicht aus. Ohne belastbare Zaehlerkette wird kein Verdacht erfunden. Die Warnung erscheint einmal beim Auftreten im Log und bleibt bis zur manuellen Korrektur oder bewussten Ruecksetzung erhalten. Sie aendert allein keine Ladefreigabe und beweist keinen realen Fahrzeug-SoC.
