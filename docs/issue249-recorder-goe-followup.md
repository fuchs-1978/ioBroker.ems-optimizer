# Recorder und go-e: gezielter Nachauftrag vom 24.10.2026

Nutzerauftrag: die beiden nach Tagesbericht [#249](https://github.com/fuchs-1978/ioBroker.ems-optimizer/issues/249)
noch offenen Untersuchungen bearbeiten. Arbeitsbeginn 21:19:22 Europe/Berlin.
EMS-Codebasis: `995f7bd3e04945eb37b4fec14b6ac6caec16f43c` / alpha.140;
aktuell gelesenes `System.Version` weiterhin alpha.137. Anlage ausschließlich gelesen.
Keine neuen SQL-Abfragen, keine Wiederholung bereits erfolgreich geladener Fenster,
keine Installation, Aktor-/Konfigurationsänderung oder künstlichen Anlagenversuche.

## 1. Recorder: Kapazitätsfolge belegt, auslösende Verzögerung nicht abschließend zugeordnet

Bestehender Fall [#60](https://github.com/fuchs-1978/ioBroker.ems-optimizer/issues/60).
Gesicherte Originale vom 24.10.12:01:05–12:01:26, Sitzung `1792835138248`,
fehlende Sequenzen 3915–3925 und 3928–3930. Die 14 Abweisungen traten
12:01:15.278–12:01:16.751 auf. Beide Teilfolgen trafen die **Bytegrenze**,
nicht die Anzahlgrenze: 94/128 Records, 8.367.909 bzw. 8.372.729 von
8.388.608 erlaubten Rohbytes. Älteste wartende Daten bis 8.051 ms alt.
Rohbytes der zwei Verlustfolgen zusammen 1.236.365; keine verlorenen Originale rekonstruiert.

Sechs voneinander verschiedene, bereits gespeicherte `lastAppendBatch`-Messungen
im unmittelbaren Stauaufbau (12:01:06.661–12:01:16.445):

|Batch|Originale|Warten in Journalqueue ms|Aktiver Append ms|
|---|---:|---:|---:|
|1|2|0|65|
|2|2|278|725|
|3|2|112|603|
|4|2|1262|2671|
|5|2|2064|110|
|6|2|146|1471|

Zusammen 3.862 ms Warte- und 5.645 ms Appendzeit **dieser sechs Batches**.
Das sind keine vollständige Tagesmessung, isolierten SQL-Zeiten oder NAS-Latenzen.
Der aktive Append umfasst mehrere lokale Verarbeitungsschritte und Dateibarrieren;
die Messung endet vor anschließender Gruppenbereinigung. Sie ist kein einzelner
`fsync`-Messwert. Am zweiten Verlustbeginn lief eine Health-Operation, doch deren
damals beobachtete 19 ms erklären nicht den ganzen vorherigen Stau.
Später sanken die beobachteten Appendzeiten wieder auf etwa 11–58 ms.

**Codeabgleich:** Append, lokale Original-Lesegruppen, Health-/Verifikationsmetadaten
und Bereinigung teilen die serialisierte Journalqueue. Das bewahrt die bestehenden
Durabilitäts-/Retirement-Grenzen. Die damaligen Snapshots nennen nicht, welche
bereits abgeschlossene Operation jeweils vor dem wartenden Append lag; außerdem
fehlen getrennte Zeitanteile für Schreiben, Datei-/Verzeichnis-Sync und Bereinigung.
Ein externer SQL-Fehler oder Dateisystemfehler ist damit nicht nachgewiesen.
Der bekannte Shutdown-Fix aus PR193 ist im geprüften Code bereits vorhanden und
erklärt diese aktive Laufzeit-Episode nicht.

Die **38 vorhandenen** Journal-/langsamen-Append-Regressionen bestanden erneut:
gebremster lokaler Append kann die Byte-/Anzahlgrenze auslösen; eine gebremste
lokale Leseoperation erzeugt separat messbare Append-Wartezeit; erhaltene Originale,
Sequenzlücken, Verlustzähler und Wiederaufnahme bleiben konsistent. Diese Offline-
Nachweise unterscheiden mögliche Mechanismen, identifizieren aber keinen davon
nachträglich als tatsächlichen Verursacher dieser 14 Verluste.

**Ergebnis:** begrenzter lokaler Rückstau erklärt die Abweisung; die auslösende
Verzögerung bleibt offen. Kein spekulativer Performancefix, keine größere Queue,
keine zusätzliche Parallelität. Kleinster fehlender Nachweis: beim nächsten neuen
natürlichen Stau den Vorgänger der wartenden Journaloperation sowie ihre einzelnen
lokalen Phasen zeitlich zuordnen. Vor einer dafür nötigen Instrumentierung den
aktuellen Code prüfen; vorhandene Batch-Appends nicht erneut entwickeln.

## 2. go-e: abgesicherter Upstream-Patch vorbereitet

Aktueller Upstream-main `aca7fbdeaa4704bb9dd035597d95bf9ab0215d29`,
`main.js` Blob `9b130f277bd5885034e2f1050af297becf99e60d`, Version1.0.42.
Kein fremdes Issue als Arbeitsgrundlage gelesen. Unveränderter Quellstand und
Apache-2.0-Lizenz liegen als ausschließlich offline verwendete Testfixture bei.

Der [Patch](patches/go-e-1.0.42-status-order.patch) vergibt eine Generation bei
HTTP-Absendung, ordnet Veröffentlichungen je Quellfeld und schützt das Feld einer
Schreibanforderung vor älteren Pollantworten. Bereits parallel verarbeitete
Antworten werden auch unmittelbar vor dem jeweiligen Statewriter geprüft.
Veröffentlichungen desselben Felds werden serialisiert; ein fehlgeschlagener
Statewrite vergiftet spätere Arbeit nicht. V1/V2-Status, V1-Schreibantworten und
Phasenstatus berücksichtigen diese Ordnung. Eine sparse V2-Set-Antwort erzeugt
weiterhin keinen erfundenen Lade-ACK. Pollintervall, EMS-Schutzfristen und
Aktorkommandos bleiben unverändert.

**Regression:** Sechs gezielte Korrekturkriterien scheitern mit unverändertem
Upstream-Code. Mit angewendetem Patch bestehen alle zehn Offline-Tests einschließlich
der ursprünglichen Fehlerreproduktion, echter neuer AUS-Meldung, unabhängigen
Feldern, konkurrierenden Schreib-/Pollantworten, verzögerten/fehlgeschlagenen
Statewrites und Phasenstatus. Vollständige EMS-Tests: 2.999/2.999 unter Node24.

Nachweisgrenze: Die Generation ordnet HTTP-Absendungen, nicht unbekannte reale
Geräte-Erfassungszeiten. Sie kann keinen bereits abgesendeten Statewrite zurückholen.
Der Patch zeigt eine korrigierte Adapter-Komponentenfunktion; er beweist weiterhin
nicht, dass genau diese Antwortreihenfolge den historischen Mii-Stopp verursachte.
Dafür fehlt die damalige HTTP-/Request-Provenienz.

**Veröffentlichungsstand:** Patch und Tests im EMS-Repository zur Übergabe,
kein Upstream-Merge/-Release und keine go-e-Installation. Upstream-Schreibrecht
fehlt (`push=false`); ein verfügbarer schreibbarer Fork ist nicht belegt und der
Connector stellt keine Fork-Erstellung bereit. Die Korrektur wurde deshalb nicht
als Änderung am installierten Adapter ausgegeben. Keine neue EMS-Adapterversion:
dieser Nachauftrag ändert nur Diagnosebelege, Offline-Tests und den Upstream-Patch.

Spätere reale Abnahme erst nach separat bestätigter Installation eines geprüften
go-e-Fixes: neue natürliche Ladeereignisse, Request-Reihenfolge und echte
AUS-Rückmeldungen gemeinsam betrachten. Keine historischen Grundfenster erneut
laden und keine echten neuen AUS-Meldungen im EMS pauschal ignorieren.
