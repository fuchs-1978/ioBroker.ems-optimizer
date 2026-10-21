# 0.17.0-alpha.116 — Veröffentlichung und vorbereitender Gruppenbilanzkern

## Umfang und unveränderte Produktivregelung

Diese Veröffentlichung bündelt die seit der letzten nachgewiesenen
GitHub-Veröffentlichung alpha.110 bereits in main enthaltenen Korrekturen aus
alpha.111–115. Neu hinzu kommt der unabhängig getestete Berechnungskern aus
[PR #221](https://github.com/fuchs-1978/ioBroker.ems-optimizer/pull/221) für einen
Teil von [#166](https://github.com/fuchs-1978/ioBroker.ems-optimizer/issues/166).
Der Gesamtauftrag #166 ist damit **noch nicht abgeschlossen**.

`lib/grid-operator-accounting.js` wird weder von der produktiven Engine noch
von Ausgangscontrollern oder Admin-Konfiguration geladen. Der Kern liest und
schreibt keine ioBroker-States und erteilt keine Stellbefehle. Gegenüber dem
geprüften main-Ausgangspunkt
[`76db3611b56dbe5c2335b7d78c8ccef793e35874`](https://github.com/fuchs-1978/ioBroker.ems-optimizer/commit/76db3611b56dbe5c2335b7d78c8ccef793e35874)
(alpha.115) bleiben produktive Regelentscheidungen, Quellenprüfung, Timer,
ACK-/Ist-Nachweise, Stellreihenfolge, Reserven und Recorderverträge unverändert.
Die Laufzeitversionsanzeige wird konsistent auf alpha.116 fortgeschrieben.

Es gibt keine neuen aktivierten Admin-Einstellungen, automatische Migration
auf einen Gruppen-Netzmodus, Erhöhung bestehender Limits oder Installation.
Der bestehende konservative Bruttodeckel bleibt wirksam; eine neue produktive
Eigenstromgutschrift wird nicht freigegeben. Die allgemeine vorhandene
LPC-Begrenzung wird nicht neu interpretiert.

## Bereits enthaltene Korrekturen seit alpha.110

| Stand | Bereits auf main vorhandene Änderung |
| --- | --- |
| [alpha.111](release-0.17.0-alpha.111.md) | Begrenzter gemessener 1-A-PV-Versuch nach rechtzeitig bestätigter Teilaufnahme; nominale Schutzreserve, Antwortfrist und Versuchslimit bleiben erhalten. |
| [alpha.112](release-0.17.0-alpha.112.md) | Geerbte EMS-Phasenziele bei geprüfter Neustart-Übernahme erhalten, Leistungs-/Strombudgets während des Anlaufs weiter sperren. |
| [alpha.113](release-0.17.0-alpha.113.md) | Aktuellen Beobachtungszeitpunkt einer qualifizierten 3P-Vorbereitung fortschreiben; reguläre Zyklen erzeugen keinen künstlichen Countdown-Neustart. |
| [alpha.114](release-0.17.0-alpha.114.md) | Qualifiziertes negatives Wallbox-Nullrauschen bis −30 W behandeln; optionale EHZ-Leistung vor Pflichtladestart samt Reserve freigeben; genau eine begrenzte Sollstromkorrektur je eigenem Ladezyklus ermöglichen. |
| [alpha.115](release-0.17.0-alpha.115.md) | Nächsten ausgeschalteten Empfänger anhand begrenzten Ersatzbudgets auf 1P vorbereiten, während der Geber weiterlädt; tatsächliche Zuteilung und Geber-AUS/Ruhe bleiben unabhängig erforderlich. |

Diese Korrekturen werden hier zusammen veröffentlicht, nicht erneut entwickelt.
Für eine nachweislich identische alpha.115-Installation ist der neue #166-Kern
vorbereitender Code. Die bloße Versionsnummer belegt jedoch keinen identischen
installierten Build.

## Neuer unabhängiger Bilanzkern

Die reinen Funktionen `evaluateGroupAccounting`, `commandBudget` und
`reserveGroupCommands` trennen eine ausdrücklich deklarierte Teilnehmergruppe,
ihre vollständige gemeinsame AC-Messgrenze, tatsächliche Gruppenaufnahme,
zugeordneten Gruppennetzbezug und konservativ verfügbare Eigenversorgung.
Ausstehende Wirkungen und High-Water-Reserven bleiben Belastungen; Befehle sind
keine Erzeugungsnachweise. Eine gemeinsame unveränderliche Reservierung prüft
einen ganzen Vorschlagsvektor gegen denselben Eigenstrompool. Einzelvorschauen
erteilen keine unabhängig addierbaren Freigaben.

Die Prüfung verlangt vollständige, nicht überlappende Messabdeckung sowie
endliche Originalwerte mit `ack=true`, `q=0`, gültiger Zeit und begrenztem
Quellenversatz. Fehlende, veraltete oder unbekannte Beiträge erzeugen kein
positives Budget. WP-Teilmessung ersetzt keine vollständige Abdeckung mit
relevanten Zusatzverbrauchern. Speicherladung/-entladung wird ausdrücklich
abgegrenzt; Entladung finanziert keine neue diskretionäre Aufnahme. PV, BHKW
und Speicher werden nicht nochmals auf ihre bereits im NVP enthaltene Wirkung
addiert. Getrennte Ergebnisse derselben Messgrenze dürfen nicht als
unabhängige Eigenstrombudgets verwendet werden.

Offizielle BNetzA- und VDE-FNN-Quellen wurden am 21.10.2026 erfolgreich
abgerufen. Eine erreichbare, nachweislich offizielle normative
EEBUS-LPC-Spezifikation konnte trotz begrenzter Suche nicht verifiziert werden.
Daraus folgt keine angenommene LPC-Semantik. Der noch offene Gruppen- und
Messgrenzenvertrag, produktive Reservierungsablauf, Allocator und unabhängige
Ausgangsprüfungen sind vor einer späteren Integration gemeinsam zu klären.
Quellenbelege, Verträge und Grenzen stehen in
[issue166-implementation-prerequisites.md](issue166-implementation-prerequisites.md).

## Softwareprüfung und verbleibende Abnahme

Der unabhängige Kern ergänzt 159 gezielte Testfälle. Die vollständige Suite
umfasst damit 2.549 Tests; unter Node 22.23.3 und 24.19.0 bestehen sie ohne
Fehler oder übersprungene Fälle. Paketprüfungen und die isolierte Installation
des tatsächlich gepackten Adapters prüfen beide Node-Versionen. Die
historischen deterministischen Vergleichsläufe bleiben ebenfalls erforderlich:
19 Architekturszenarien mit 342.308 identischen Beobachtungen sowie 13
Wallboxszenarien mit den bereits vorhandenen dokumentierten Abweichungen gegen
ihre historischen Ausgangsstände. Die GitHub-CI prüft den Release-Stand vor
Übernahme nach main nochmals unter Node 22 und 24; konkrete Ergebnisse gehören
in PR und GitHub-Release.

Die neuen Gegenproben decken ohne PV, Export und PV unter Hauslast,
Erzeugungsabfall, Quellenversatz in beiden Richtungen, NULL/ACK/q/Alter/Zukunft,
mehrere Wallboxen und gemeinsame Vergabe, WP-Gesamt-/Teilmessung, Speicher in
beiden Richtungen sowie ausstehende Teilnehmer-/Nichtteilnehmerwirkungen ab.
Ein deaktivierter Kern beansprucht keine Budgetautorität. Unpassende Gruppen
oder Messgrenzen liefern keine positive Freigabe.

Eine produktive Ende-zu-Ende-Abnahme der neuen #166-Regelung ist mangels
Integration ausdrücklich nicht erfolgt. Softwaretests und Veröffentlichung
sind keine reale Betriebsabnahme. Es gab keine künstlichen Schaltversuche,
Installation oder Änderung des laufenden EMS. Die Diagnoseziele aus
[#220](https://github.com/fuchs-1978/ioBroker.ems-optimizer/issues/220) begründen
keinen weiteren Recorder-/EHZ-Fix; gesicherte Befunde und Lücken bleiben in
[issue220-diagnosis-followup.md](issue220-diagnosis-followup.md) getrennt.

Die nächste natürliche SQL-Abnahme muss aktive Grenze, Teilnehmer-/Messumfang,
Eigenstrom-/Netz-/Bruttobilanz, Quellenzeiten und Qualität sowie Sollbefehle,
ACKs und elektrische Antwort zusammenhängend belegen. Beim Recorder bleiben
exakte neue Originalbestätigungen, Session-/Sequenz-/Sample-Verluste,
Queue-/Journalbytes, unbestätigte Records und `expiry`/`expiredUnconfirmed`
getrennt. Für die aktuelle EHZ-Sperre sind überlappende Writes, zugehörige ACKs
und unabhängige Nullproben zeitlich zu rekonstruieren; die Reserve wird nicht
automatisch gelöscht. Fehlende Originalabschnitte bleiben unbekannt. Es gibt
keinen zugesagten Energiegewinn und keinen Scorebonus.
