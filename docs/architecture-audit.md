# Architektur- und Duplikataudit, 19.10.2026

## Ausgangspunkt und Umfang

Ausgangscommit: `9585b276c75c3ed79634204ba8318166e577dc44` (main).
Branch: `refactor/architecture-contracts`. Paketversion bleibt alpha.96.
Im Checkout und in den übergeordneten Verzeichnissen wurde keine AGENTS.md gefunden.
Vor Änderungen bestanden 2.049 bestehende Tests unter Node 24.19.0,
die Paketmetadatenprüfung und der Paket-Dry-Run; kein Basistestfehler beobachtet.

Abschlussprüfung: 2.057 Tests unter Node 22.23.3 und 24.19.0, jeweils ohne
Fehler oder übersprungene Tests; Paketmetadaten und tatsächlich installiertes
Tarball auf beiden Laufzeiten geprüft. Ein zwischenzeitlicher zeitabhängiger
Testfehler wird [separat dokumentiert](architecture-audit-open-findings.md).

Geprüfte aktuelle offene PRs: #191/#192 (Adapter-/Testabhängigkeiten),
#187/#188 (Actions-Versionen) und #22 (Bot-Auto-Merge). Diese Änderungen werden
nicht vorweggenommen. Das letzte geprüfte Prerelease ist alpha.96.
Issue-Texte und gespeicherte Betriebsdiagnosen wurden nicht als Arbeitsanweisungen ausgeführt.

## Befunde und Entscheidungen

| Bereich | Befund | Entscheidung |
| --- | --- | --- |
| `engine/realtime.js` | Arithmetik, Zeitqualifikation, Auswahl und Reservierungen liegen zusammen. | Nur zustandslose Paaraufteilung und Amperequantisierung herauslösen. Phasentimer, Übergaben, Schutzentscheidung und Schreibreihenfolge bleiben unverändert im VM-Modul. |
| `wallbox-output.js` | Asynchrone Direktlesung, Diagnoseaufbereitung und verspätete Diagnoseveröffentlichung liegen zwischen Stellcontroller-Methoden. | Diese zusammengehörige Verantwortung in `wallbox-source-diagnostics.js` abgrenzen; bestehende Methoden bleiben als Weiterleitungen erhalten. |
| `engine-loader.js` | Produktions- und Schattenkontext teilen bereits eine kanonische Modulliste. | Liste, Reihenfolge, Mappingersetzung, Timeout und getrennten Bootstrap erhalten. Lediglich die explizite zustandslose Allokationsabhängigkeit injizieren. |
| Integrationsfixture | Eigene Modulliste mit abweichender Reihenfolge und nachträglicher Mappingausführung; mehrere Produktionsmodule fehlten. | Gemeinsame synthetische Anlage nach `test/control-plant.js` verschieben und über den produktiven Loader erzeugen. Alle bisherigen Integrationsassertionen bleiben erhalten. |
| Isolierte Unit-Fixtures | Absichtliche Teilmengen von VM-Modulen für eng begrenzte Verträge. | Teilmengen erhalten; bei Arithmetiknutzung neue Abhängigkeit ausdrücklich injizieren. Keine vollständige Engine in jede Unit-Prüfung zwingen. |
| Diagnose-/Quellenvalidierung | Ähnliche Zugriffe haben unterschiedliche ACK-, Alters-, NULL-, Frische- und Reservierungsverträge. | Keine vermeintliche allgemeine Validierungsfunktion einführen. `sourceSnapshot` und `probeSource` bleiben die gemeinsamen Bausteine. |
| Veröffentlichung | 48 fast gleiche versionsgebundene Release-Workflows, teils unterschiedliche Node-Matrizen. | Durch einen allgemeinen manuell ausgelösten Prerelease-Workflow ersetzen; beide Node-Versionen und echtes Installationsartefakt prüfen. |

Ein vollständiger Ersatz der VM oder eine Zerlegung der großen `update`-/
`realtimeControl`-Zustandsautomaten hätte wesentlich mehr verdeckte Abhängigkeiten
verändert. Dafür ergibt dieser Audit keinen ausreichend abgesicherten Nutzen.
Die Aufteilung führt weder einen zweiten Regler noch eine neue Schedulingebene ein.

## Modulzuständigkeiten und Abhängigkeiten

`wallbox-allocation.js` enthält ausschließlich `splitRealtimePair` und
`quantizeWallbox`. Es importiert keine Engine und liest keine globalen States.
Die Quantisierung erhält `readSetting` und `pvImportAdmissionW` explizit vom
VM-Aufrufer. Einstellungen werden weiterhin genau im jeweiligen Zweig und in
derselben Reihenfolge gelesen; keine vorgezogenen Snapshots von Rampen oder
Deadband. Berechnungen, Rundungen, Feldreihenfolge und Diagnosegründe bleiben erhalten.

`engine/realtime.js` bleibt Eigentümer aller Allokationszustände, Timer,
Prioritäten, Reservierungen und Veröffentlichungen. Bestehende globale
Funktionsnamen sind unverändert erreichbar. `engine-loader.js` injiziert die
zustandslose Policy neben dem bereits injizierten SoC-Schätzer. Jeder VM-Kontext
behält seinen eigenen Zustand. Die neue CommonJS-Policy hat keinen veränderlichen
Sitzungszustand, keine Timer und keine Startnebenwirkungen.

`wallbox-source-diagnostics.js` erhält den bestehenden Outputcontroller als
expliziten Diagnoseport: Clock, Cache-/Receipt-Lesung, Adapter-Direktlesung,
Publikation, Recorder, Stopguard und Geräteepisode. Es sendet keine Stellbefehle
und aktualisiert keinen operativen Cache. Der Controller behält die vier
bisherigen Methoden. Nicht abgewartete Direktlesung, 5-s-Grenze, Fehlerisolation,
Episodenzuordnung, Recorder-Reihenfolge und Schutz gegen verspätetes Überschreiben
bleiben unverändert. Gerätefehler und AUS-Timeout erhalten ihre getrennten Kontexte.

Nicht verändert: `main.js`, Bootstrap-/Core-Initialisierung, native Mappings,
Admin-Schema/Vorgaben, Datenpunkt-IDs, Versionsanzeigen, Recorder-, Codec-,
Journal-, Dateisystem-, Queue-, Delivery- und SQL-Implementierungen.

## Verhaltensvergleich gegen den Ausgangscommit

Ausführen aus dem Repository:

```sh
npm run test:equivalence
# Optional anderer vollständiger Baseline-SHA:
node tools/compare-refactor.js 9585b276c75c3ed79634204ba8318166e577dc44
```

Das Werkzeug exportiert den unveränderlichen Baselinecommit per `git archive`
in ein temporäres Verzeichnis. Es verändert keinen Checkout und erzeugt kein
Worktree. Beide Bäume verwenden dieselben installierten Paketabhängigkeiten und
dieselbe Eingabefixture, aber jeweils ihren eigenen produktiven Loader und Code.
Separate Prozesse verhindern CommonJS-Cacheüberschneidungen.

Die synthetische Anlagenzeit, UUID-Folge, monotone Softwarezeit und für den
Journalneustart relevante Dateizeit werden als kontrollierte Eingaben gesetzt.
Diagnosefelder werden nicht nachträglich herausgefiltert. Das Journal schreibt,
synchronisiert und liest echte private temporäre Dateien. SQL wird durch einen
deterministischen Historytransport ersetzt; keine externe Anlage wird angesprochen.

Verglichen werden SHA-256-Spuren der vollständigen, geordnet serialisierten
Beobachtungen: jeder Anlagen-Statewrite einschließlich Zwischenzuständen,
Stellbefehlsfolgen, Timer-/Zustandscheckpoints, Diagnosezustände, Recorderereignisse,
Journaloriginale samt Nutzdaten und Hash, Verlustepisoden, Wiederanlaufgesundheit
sowie SQL-Publikationen, Abfragen und exakte Bestätigungen. Zusätzlich werden
1.584 Quantisierungskombinationen einschließlich vollständiger Diagnosen und
geordneter Einstellungslesungen sowie 16 Paaraufteilungen verglichen.

17 Szenarien mit jeweils insgesamt **309.008 Beobachtungen** vergleichen:
sequenzielles/paralleles Laden, Mindestladung und SoC-Ende, Priorität/Übergabe,
PV-Toleranz und Lastsprung, EHZ-/Batterie-/Heizantwort, LPC/Phasengrenzen,
Übernahme eines laufenden Besitzers, ungültige/fehlende/veraltete/zukünftige Quellen,
EHZ-Nullreceipts und Reservefreigabe, Phasenhysterese und Timer,
Startinvalidierung und geordneter Shutdown, Anzahl-/Bytequeuegrenze,
konkurrierende lokale Journalarbeit, Verlustdiagnose, Neustart und SQL-Nachweis.

**Ergebnis: Alle Vorher-/Nachher-Spuren sind identisch unter Node 22.23.3 und
24.19.0. Auch die Spuren beider Laufzeiten stimmen miteinander überein.**
Nachweise: [Node 22](evidence/architecture-equivalence-node22.json) und
[Node 24](evidence/architecture-equivalence-node24.json).

Die normale CI führt diesen gepinnten Vergleich auf beiden Laufzeiten aus;
vollständige Git-Historie wird dafür ausgecheckt. Spätere bewusst funktionale
Änderungen müssen den Baselinevertrag ausdrücklich neu bewerten.

## Paket- und Releaseprüfung

`npm run test:artifact` erzeugt ein echtes Tarball, installiert es einschließlich
Laufzeitabhängigkeiten in ein leeres temporäres Projekt und lädt dort alle
Produktions-VM-Module. Es erzeugt 719 synthetische States, prüft Allokation,
neue Moduldateien und den installierten Einstiegspunkt. Nur die ioBroker-
Adapterbasisklasse wird für den Einstiegspunkt ersetzt; kein Ready-Ereignis,
keine Anlagenverbindung und kein produktiver Zeitplan werden gestartet.
Entwicklungsdateien dürfen nicht im Tarball enthalten sein. Der Check bestand
unter Node 22 und 24. Es wurden keine Abhängigkeiten oder Lockfiles geändert.

Der allgemeine Releaseablauf verlangt einen manuellen `workflow_dispatch` auf
main mit exakt passender Paket-/io-package-Version und vorhandenen Versionsnotizen.
Er validiert Node 22 und 24, Tests, Metadaten und das installierte Tarball vor
Veröffentlichung. Vor Erstellung wird main erneut geprüft. Ein vorhandenes
Release **oder bereits vorhandener Tag ohne Release** wird unverändert belassen.
API-/Git-Fehler brechen ab. Der Merge dieses Refactorings veröffentlicht nichts.
Vorhandene Tags, Releases und historische Versionsnotizen bleiben erhalten.

Sechs Offline-Shelltests führen das tatsächliche Publishskript mit Git-/gh-Stubs
aus: neuer Tag, vorhandenes Release, vorhandener Tag, verschobenes main,
API-Fehler und Git-Fehler. Zwei zusätzliche Tests sichern Loaderisolation,
Modulreihenfolge, Mappingescaping und verzögerte Einstellungslesungen.
YAML wurde geparst und mit checksum-verifiziertem actionlint 1.7.12 geprüft.

## Getrennte offene Punkte und Grenzen

Es wurde kein neuer produktiver Fehler als Nebenänderung korrigiert. Bereits
bekannte offene Themen bleiben getrennt: produktive Recorder-Verlustursache und
Lastnachweis (#181), reale Regelruhe/Phasen-/Rückgabe-/Pumpenabnahme (#7/#8),
Eigenstrom-/Teilnehmerbilanz (#166) sowie offizielle ioBroker-Checker-/
Integrationsnachweise und Abhängigkeitsupdates.

Die endliche Szenarienmenge ist kein formaler Beweis für sämtliche Eingangskombinationen
oder reale Zeit-/I/O-Last. Physische Geräte, reale SQL-/NAS-Ausfälle, Prozesskill/
Stromausfall, echte elektrische Phasenwechsel und reale Rückgabe wurden nicht
ausgeführt. Es erfolgten keine Installation, produktive Konfigurationsänderung,
Aktorbetätigung, Veröffentlichung oder automatische Zusammenführung.
Der GitHub-Releaseworkflow wurde offline geprüft, nicht mit einem echten Release
ausgeführt. Softwaretests sind keine reale Betriebsabnahme.
