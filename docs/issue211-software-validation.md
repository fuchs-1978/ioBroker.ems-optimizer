# Softwarevalidierung zu Issue #211

Ausgangsstand: main `72dee1bbbd9326fcc06d1d40cdcc1283f84a605b`
(alpha.109). Vor den Änderungen bestanden unter Node 24 alle **2.243 Tests**.
Die Betriebswerte stammen aus dem anhand GitHub-Metadaten geprüften,
betreibereigenen [Issue #211](https://github.com/fuchs-1978/ioBroker.ems-optimizer/issues/211).
Der genaue installierte Commit und sämtliche historischen Einzelquellenzeiten
sind dadurch nicht nachgewiesen.

## Drei reproduzierte Ursachen

1. Die Hausphase L2/L3 wurde in elektrischen 1P-Nachweisen als go-e-Kanalindex
   verwendet. Der aktive lokale L1-Strom konnte deshalb trotz bestätigter
   Fahrzeugantwort weder den Haltenachweis noch den ausstehenden Schritt abschließen.
2. Eine nach der Zuteilung bestätigte identische Probe wurde verworfen, wenn
   beide Auswertungen denselben Millisekundenzeitstempel hatten. Der ausdrücklich
   beobachtete Übergang `vehicle_response` → `confirmed` belegt die Reihenfolge
   auch innerhalb einer Millisekunde.
3. Eine spätere Wiederholung derselben ACK konnte eine bereits bestätigte,
   weiterhin frische Leistungs-/Stromprobe entwerten. Der begrenzte Haltepfad
   verwendet jetzt die ursprüngliche rechtzeitige ACK desselben bestätigten
   Befehls. Schreibbeginn, asynchroner Schreibabschluss und Bestätigung bleiben
   getrennt; auch eine ACK vor dem Promiseabschluss ist abgedeckt.

Die Korrektur erhält das nominal reservierte Bestandskommando. Eine ACK-Wiederholung
allein bestätigt keine Aufnahme, verlängert keine Antwortfrist und finanziert
keinen weiteren Ampere-Schritt. Neue/unbestätigte Befehle behalten ihre bisherigen
ACK-Prüfungen. Harte Netz-, Geräte-, Phasen-, Peer- und EHZ-Grenzen bleiben wirksam.

## Reproduktion gegen unveränderten main

Sieben ausgewählte integrierte Fälle wurden mit den neuen Testdateien, aber
vollständig unverändertem Produktionscode des genannten main ausgeführt:
**1 bestanden, 6 fehlgeschlagen, 0 übersprungen**. Der Hausphase-1-Kontrollfall
bestand; Hausphase 2/3, gleiche Millisekunde und drei ACK-Wiederholungsfälle
scheiterten. Für Hausphase 2/3 entstand der gemeldete Gegenbefehl 7 → 6 A mit
`nominal`, `liveMaximumA=6`, `awaitingElectricalStep=true` bei bestätigter Antwort.

Reproduzierbar aus dem Checkout mit diesen versionierten Tests; der letzte
Befehl muss am Ausgangsstand mit Status 1 enden:

```bash
set -e
baseline=72dee1bbbd9326fcc06d1d40cdcc1283f84a605b
baseline_dir=$(mktemp -d)
git archive --format=tar --output="$baseline_dir/source.tar" "$baseline"
tar -xf "$baseline_dir/source.tar" -C "$baseline_dir"
cp test/control-plant.js test/issue211-pv-replay.test.js "$baseline_dir/test/"
node --test --test-name-pattern='confirms7A on house phase|share one millisecond|repeating the confirmed7A ACK|first electrical confirmation accepts' "$baseline_dir/test/issue211-pv-replay.test.js"
```

## Neue und bestehende Regressionen

In `test/parallel-wallbox-output.test.js` kommen **37 zusätzliche Outputfälle** hinzu:

| Gruppe | Fälle |
| --- | ---: |
| Lokaler L1 auf Hausphase 2/3, beide ACK-Verbrauchsreihenfolgen | 4 |
| Fehlender Zeit-/Stromnachweis auf lokalem L1 wird nicht durch ruhendes L2/L3 ersetzt | 4 |
| Relative Reduktion und begrenzter finanzierter Nachregelversuch auf Hausphase 2/3 | 4 |
| Zusätzliche gleiche-Millisekundenvarianten zweier bestehender Bestätigungstests | 2 |
| Bestätigte Aufnahme trotz ACK-Wiederholung auf Hausphase 1/2/3 | 3 |
| Ungültiger ursprünglicher Nachweis, alte/zukünftige Quellen, anderer Befehl oder Prozess | 18 |
| Kein weiterer Schritt aus alter Probe; neue Probe erlaubt ihn wieder | 1 |
| Unverändertes ACK-Pollingverhalten des sequenziellen Pfads | 1 |

Die ersten 14 Fälle ergeben gegen alpha.109 **4 bestanden / 10 fehlgeschlagen**;
die weiteren 23 ergeben **19 bestanden / 4 fehlgeschlagen**. Nach der Korrektur
bestehen alle 37; vorhandene Negativprüfungen wurden nicht abgeschwächt.

`test/issue211-pv-replay.test.js` besteht unter **Node 22 und 24 mit jeweils
27/27 Fällen**, ohne übersprungene Tests. Es prüft Produktionsloader,
Zuteilung und Ausgang gemeinsam: echte lokale Start-/Schreib-/ACK-Sequenz,
Hausphasen 1–3, gleiche Millisekunde, 1.450/1.460 W bei 6,6 A,
ACK-Wiederholungen vor/bei/nach Bestätigung, Neustart und unveränderte ausstehende
Wirkung. Import, Hausanschluss, Geräte-/LPC-Grenzen, Peer-/EHZ-Lastsprünge,
Qualität und Quellenzeiten bleiben Gegenproben. Transportabschlüsse nach
5 beziehungsweise 400 ms decken beide Reihenfolgen zur ursprünglichen ACK nach
250 ms ab. Alte Proben halten höchstens 7 A; erst neue elektrische Proben
ermöglichen bei neuem Budget 8 A.

Der separate Journalschlussfix ist Commit `272ed1a`. Seine zwei neuen Regressionen
prüfen das Ende weiterer Dateisystemarbeit nach `close()` und die endgültige
Persistenz von Ablehnungen vorher angenommener Arbeit. Vorher scheiterte die
erste Prüfung an acht nachträglichen Dateisystemaufrufen; danach bestanden alle
**35 Journaltests unter Node 22 und 24**. Das erklärt keine Tages-Queueverluste.

Die vollständige Prüfung `npm test` besteht unter **Node 22 und 24 jeweils
mit 2.309 bestanden, 0 fehlgeschlagen und 0 übersprungenen Tests**:
2.243 Ausgangsfälle + 37 Outputfälle + 27 integrierte Fälle + 2 Journalfälle.

Wiederholung, jeweils unter dem ausgewählten Node-Hauptstand:

```bash
node --version
node --test test/issue211-pv-replay.test.js
node --test test/parallel-wallbox-output.test.js test/parallel-realtime.test.js test/wallbox-output.test.js
node --test test/decision-record-journal.test.js
npm test
```

## Aussagegrenze

Die logische Uhr, einzelne Quellenzeiten, Startvorlauf, NVP-Ziel 0 W und
100 W Halte-/80 W Erhöhungszulassung sind kontrollierte Testeingaben.
Allocator, Befehlsreihenfolge, ACK-Verbrauch und elektrische Bestätigung werden
nicht durch vorgefertigte Zuteilungs- oder Pendingobjekte ersetzt. Gleiche
Probenzeit wird nur mit dem expliziten Bestätigungsübergang akzeptiert;
ältere oder widersprüchliche Proben bleiben Gegenfälle.

Damit sind drei konkrete Codefehler und passende Folgen reproduziert. Es ist
kein vollständiger Replay aller 41 historischen Befehle und kein Beweis, dass
jeder Wechsel dieselbe Ursache hatte. Die Tests verändern keine Anlage und
ersetzen weder natürliche Betriebsabnahme noch einen Einsparnachweis. Nächste
reale Prüfpunkte stehen im [Abnahmefolgeplan](issue211-real-acceptance-followup.md).
