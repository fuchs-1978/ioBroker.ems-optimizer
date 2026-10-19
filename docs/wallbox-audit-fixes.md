# Fehlerkorrekturen nach der Ultra-Nachprüfung

Ausgangsstand: `25fd38b4e5a3568a6d1aeefda5277c94397c7e91` (`main`).
Branch: `fix/wallbox-phase-ack-and-literal-mapping`.
Die vollständige Ausgangssuite bestand mit 2.063 Tests unter Node 24.

Dieser Auftrag korrigiert drei separat reproduzierte Laufzeitfehler. Anders als
beim vorangegangenen Architektur-Refactoring sind die unten beschriebenen
Verhaltensänderungen ausdrücklich beabsichtigt. Andere Regelentscheidungen,
Rechen- und Rundungsverfahren, Zeitgrenzen und Stellsequenzen bleiben erhalten.
Paketversion, Admin-Vorgaben und Datenformate werden nicht geändert.

## Phasenwechsel unter unabhängiger Skriptführung

Vorher genügte ein bestätigter Wechsel des Modusdatenpunkts von 3P auf 1P,
um bereits mit 1P-Stromgrenzen und 1P-Reservierungen zu rechnen. Die elektrische
Last konnte während des Übergangs noch dreiphasig sein. Mit 16 A 3P-Maximum,
32 A 1P-Maximum und 11.040 W Leistungsgrenze ließ sich dadurch eine Anforderung
von 18 A bei weiterhin frischen 3P-Messungen reproduzieren.

Jetzt beginnt auch bei Skriptführung nach dem Modus-ACK die vorhandene
elektrische Phasenbeobachtung. Bis zu ihrer Bestätigung gelten die alte/neue
Topologie gemeinsam und die strengere Stromgrenze. Erst ein frischer Strom-ACK
und passende, nachfolgende Strom-/Leistungsmessungen erlauben die Freigabe der
alten Reserve. Die unabhängige Skriptführung folgt weiterhin ausschließlich
ihrem bestätigten Modus; eine fremde oder ungültige EMS-Phasenvorgabe wird nicht
in ihre Topologie übernommen.

Die bestehenden EMS-Chronologieprüfungen und Antwortfristen bleiben erhalten.
Eine widersprüchliche, aber frische elektrische Topologie bleibt auch nach
Ablauf der Antwortfrist konservativ reserviert und berechtigt zu keiner weiteren
Erhöhung. Fehlende neue elektrische Messungen führen weiterhin zum Schutzstopp.
Harte Stromreduktionen bleiben möglich und erhalten die offene Phasenbeobachtung.

13 zusätzliche Regressionen prüfen beide Wechselrichtungen, strengere Grenzen,
Quellenzeitpunkte, alte/fehlende Messungen, unabhängige Phasenvorgaben und die
Freigabe nach realer elektrischer Bestätigung. Gegen den unveränderten
Ausgangscode scheitern die elf neuen Skriptfälle; die zwei EMS-Kontrollen bestehen.

## Rechtzeitiger Strom-ACK bei verspäteter Verarbeitung

Vorher löste eine gewöhnliche Stromänderung eine verriegelte Rückmeldungsstörung
aus, wenn der nächste Reglertick erst nach dem ACK-Zeitlimit lief, selbst wenn
die Bestätigung rechtzeitig eingegangen war. Reproduktion: 6→12 A, ACK nach
1.001 ms, Verarbeitung nach 21 s bei 20 s Zeitlimit.

Jetzt wird bei gewöhnlichen Stromänderungen die rechtzeitige Bestätigung nach
denselben strikten Quellenvorgaben anerkannt. Ihr Zeitstempel muss nach dem
Stellbefehl und spätestens auf dessen Frist liegen; Wert, ACK, Qualität, Alter
und Zukunftsprüfung bleiben wirksam. Die elektrische Antwort verwendet den
ursprünglichen ACK-Zeitpunkt. Es wird weder eine Frist verlängert noch eine
ausstehende elektrische Antwort als erfolgreich angenommen.

Die getrennten Startübergaben für Strombefehl und Ladefreigabe behalten ihre
bisherigen Fristen und Bedingungen. 15 zusätzliche Tests sichern rechtzeitige
Bestätigungen einschließlich der exakten Fristgrenze, den unveränderten
Antworttimer sowie fehlende, falsche, unbestätigte, fehlerhafte, zu alte und
verspätete Bestätigungen ab. Am Ausgangscode scheitern sechs dieser Tests;
die neun Negativ-/Kontrollfälle bestehen bereits dort.

## Literale Datenpunkt-IDs im produktiven VM-Loader

Vorher interpretierte die Quelltextersetzung Zeichenfolgen wie `$&` und `$$`
innerhalb gültiger Datenpunkt-IDs als JavaScript-Ersetzungsmuster. Aus
`mqtt.0.grid.$&` wurde dadurch `mqtt.0.grid.__DP_GRID_IMPORT__`; die tatsächlich
vorhandene Netzquelle erschien als fehlend.

Die Ersetzung verwendet jetzt eine Callback-Rückgabe und übernimmt den bereits
maskierten Wert literal. Die bestehende Maskierung von Apostroph und Backslash,
die Modulliste, Modulreihenfolge, VM-Ausführungsgrenzen und Bootstrap-Trennung
bleiben erhalten. Acht Tests mit dem produktiven Loader prüfen die exakten IDs,
gültige Netzleistungsberechnung und unveränderte Qualitäts-/Altersvalidierung.
Fünf dieser Tests scheitern am alten Loader. Einige zusätzliche Escape-Fälle
prüfen ausschließlich die Loader-Grenze und sind keine Erweiterung der gültigen
ioBroker-ID-Zeichen.

## Vorher-/Nachher-Nachweise und ihre Grenzen

`npm run test:equivalence` führt zwei getrennte Werkzeuge aus:

- `tools/compare-refactor.js` behält die historischen 17 Spuren und den
  unveränderlichen Ausgangscommit `9585b276c75c3ed79634204ba8318166e577dc44` bei.
  Hinzu kommen tatsächlich aktivierte parallele Mindestladung mit bestätigten
  Freigabebefehlen sowie positive Dreiphasenquantisierung mit ausreichendem
  Leistungsbudget. Assertions prüfen die erreichten Pfade vor dem Vergleich.
  Insgesamt bleiben 19 Spuren mit 342.308 serialisierten Beobachtungen gleich;
  die ursprünglichen 17 Spuren stimmen auch mit ihren gespeicherten Hashes und
  Ereigniszahlen überein.
- `tools/compare-wallbox-fixes.js` vergleicht gegen den unmittelbaren
  Fehlerkorrektur-Ausgangspunkt `25fd38b4e5a3568a6d1aeefda5277c94397c7e91`.
  Beide Bäume erhalten dieselben kontrollierten Eingaben und laden ihren eigenen
  Produktivcode in getrennten Prozessen. Explizite Alt-/Neu-Verträge prüfen die
  beabsichtigten Änderungen; gewöhnliche IDs sowie unveränderte rechtzeitige
  und abgewiesene ACK-Abläufe werden vollständig spurengleich verglichen.
  Von 13 gezielten Verträgen sind acht vollständige Kontrollspuren identisch;
  fünf prüfen die ausdrücklich beabsichtigten Unterschiede. Auch die spätere
  elektrische 1P-Bestätigung und die Freigabe der Reserve werden beobachtet.

Die Werkzeuge beobachten geordnete Stellbefehle, Zustandsveröffentlichungen,
interne Phasen-/Antwortzustände, Reservierungen und Zeitpunkte. Die bisherigen
Recorder-, Journal-, SQL-, Start-/Shutdown-Spuren werden weiter unverändert
verglichen. Weder wird die historische Baseline pauschal ersetzt noch werden
abweichende Diagnosefelder herausgefiltert.

Die historischen Szenarionamen sind allein kein Abdeckungsnachweis. Der damals
benannte Parallelfall aktivierte die effektive Engine-Konfiguration nicht;
alle damaligen direkten 3P-Quantisierungen lagen unter dem Hardwareminimum.
Diese beiden Lücken sind durch die ergänzten, assertierten Fälle geschlossen.
Die historische Quellenfehlerfolge prüft weiterhin nicht jede Fehlerart als
eigenständige neue Episode; zwei ausgelagerte Diagnosepfade und das Ergebnis
der konkurrierenden Journalabfrage werden dort weiterhin nicht vollständig
differenziell beobachtet. Diese verbleibenden Nachweislücken werden ausdrücklich
nicht als erledigt bewertet. Die regulären Regressionstests sind davon getrennt
zu beurteilen. Die historische Anlagenfixture bildet weiterhin nur elektrische
Einphasenlast ab; ihr Phasenszenario schließt den angeforderten Wechsel nicht ab.
Der neue gezielte Controllervergleich ist kein vollständiges dreiphasiges
Anlagenmodell.

Fünf gezielt eingeschleuste Fehler wurden durch die neuen Assertions verworfen:
die alte ACK-Sperre, die abgeschaltete Skript-Phasenbeobachtung, die alte
ID-Ersetzung, eine weiterhin ausgeschaltete Parallelkonfiguration und ein für
3P unzureichendes Leistungsbudget. Die tatsächlichen Fehlerausgaben dieser
temporären Mutationsläufe sind separat gespeichert; produktive Dateien wurden
dabei nicht verändert.

## Prüfungen

Unter Node 22.23.3 und 24.19.0 bestehen jeweils alle **2.099 Tests**, ohne Fehler
oder übersprungene Tests. Dazu kommen Paketmetadaten, beide Vergleichswerkzeuge
und das frisch erzeugte, installierte npm-Tarball mit produktivem Loader und
isolierter Einstiegspunktprüfung. Die maschinenlesbaren Vergleichsnachweise
liegen unter `docs/evidence/wallbox-fixes-*-node{22,24}.json`.

Unabhängige synthetische Zusatzprüfungen kontrollieren eine parallele
Phasenreserve von 4.140 W bis zur Bestätigung und 1.380 W danach sowie einen
Phasenwechsel während eines offenen Stellbefehls mit anschließender Umkehr und
Shutdown. Auch dabei bleibt die Reserve erhalten und es entsteht kein weiterer
Strombefehl vor der elektrischen Bestätigung.

Keine produktive Installation, Konfigurationsänderung, reale Aktorbetätigung,
SQL-/NAS-Verbindung oder Veröffentlichung wurde durchgeführt. Elektrische
Hardwareumschaltung und tatsächliche Anlagenlast sind nicht abgenommen.
Die separate Release-Tag-Race und die offene Transportgarantie bei einem niemals
abschließenden Schreibpromise sind nicht Bestandteil dieser drei Korrekturen.
