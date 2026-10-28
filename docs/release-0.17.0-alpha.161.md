# 0.17.0-alpha.161 – SQL-Zeitbereich direkt per numerischer Datenpunkt-ID lesen

Ausgangspunkt: main `d782b9505e225a06ad0a88d7c36d086b70c0d9a7`, alpha.160.
Auftrag vom 28.10.2026: Erkenntnisse der gemeinsam durchgefuehrten SQL-Pruefung
umsetzen und im Changelog erhalten. Der Betreiber hat das SQL-Fenster geschlossen;
keine weiteren manuellen SQL-Anfragen oder Wiederholungen alter Historienfenster.
Diese Entwicklung verwendet die bereits gelieferten Befunde und Offline-Tests.

## Vom Betreiber gelieferte SQL-Befunde

Die folgenden Werte wurden im Chat aus der Datenbankoberflaeche mitgeteilt;
keine Behauptung eigener Hostabfragen, synchroner Messzeitpunkte oder einer
bereits abgeschlossenen SQL-/Anlagenabnahme.

| Befund | Ergebnis / Einordnung |
| --- | --- |
| Vorhandener Index auf `ts_string` | PRIMARY KEY `(id,ts)`, BTREE; zusaetzlicher Index dafuer nicht erforderlich |
| Datenpunktmetadaten | `ems-optimizer.0.Debug.Shadow.DecisionRecord`, Typ1, lokale ID358; diese ID ist installationsspezifisch und wird nicht im Produktivcode festgelegt |
| EXPLAIN mit `id=(SELECT id FROM datapoints ...)` | `ts_string`: type=ref, key=PRIMARY, key_len=4, rows=4587, Using index condition; Using where |
| Zugehoerige Metadaten-Unterabfrage | `datapoints`: type=ALL, rows=281; kein eigener Beleg fuer minutenlange Laufzeit |
| Derselbe Plan mit festen Zeitgrenzen statt Zeitfunktionen | Weiterhin ref / 4 / 4587; Zeitfunktionen erklaeren diesen Unterschied nicht |
| EXPLAIN mit Literal `id=358` und denselben Zeitgrenzen | type=range, key=PRIMARY, key_len=12, rows=2, Using index condition |
| Server `max_connections` | 1500; die gemeldete historische Spitze402 beweist somit keine erschoepfte Servergrenze |
| SQL-Adapter-Verbindungsmaximum | 400 laut gelesener Konfiguration; keine Aenderung durch diesen Auftrag |
| Thread-Modell / bisheriger Cache | one-thread-per-connection, thread_cache_size=0; Connections/Threads_created jeweils etwa8,31Millionen, Threads_cached=0 |
| Uptime / langsame Abfragen | 6369222s (etwa73,7Tage), Slow_queries=1699; kumulierte Werte, Schwelle/Verursacher und Zeitverteilung unbekannt |
| Betreiberoptimierung | `SET GLOBAL thread_cache_size=32`; gemeldete Cachebelegung zuerst17, spaeter30; nur Laufzeiteinstellung, dauerhafte Serverkonfiguration nicht bestaetigt |
| Vergleich nach Cacheaktivierung | Connections8312188→8317157: +4969; Threads_created8312017→8312190: +173, grob96,5% Wiederverwendung. Zaehlersnapshots nicht als exakt synchroner Lasttest behandeln |

**Belegt ist ein guenstigerer Abfrageplan fuer die gepruefte Literal-ID-Abfrage,
keine gemessene Beschleunigung um den Faktor4587/2.** `rows` sind Schaetzungen;
EXPLAIN misst keine Laufzeit. Die neue produktive Abfrage enthaelt zusaetzlich
einen unten beschriebenen Identitaetsguard; ihr realer MySQL-/MariaDB-Plan und
ihre Latenz sind nach Installation noch zu bestaetigen, ohne alte Fenster neu
abzufragen. Die vorhandene reine Literal-ID-Gegenprobe ist kein nachtraeglicher
EXPLAIN-Nachweis dieses erweiterten Statements.

Der zuvor unter alpha.160 beobachtete SQL-Transportfall benoetigte rund760,455s
(12min40s). Eine passende spaete Antwort wurde verarbeitet, lokale Recorderverluste
waren im geprueften Abschnitt0. Diese Transportzeit ist keine isolierte DB-Laufzeit.
Verbindungspool, Datenbanksperren, Datentraeger und Ruecktransport bleiben als
moegliche Mitursachen ungeprueft. Thread-Cache-Wiederverwendung alleine beweist
keine Behebung dieser Antwortverzoegerung.

## Neue Abfrage und Cachegrenzen

1. Beim ersten Bedarf wird ausschliesslich die SQL-Metadaten-ID zum exakten
   Datenpunkt-/Aliasnamen und Typ1 gelesen, mit hoechstens zwei Zeilen. Fehlende,
   mehrdeutige oder ungueltige IDs werden nicht geraten und nicht bestaetigt.
2. Genau ein Eintrag pro Adaptergeneration wird maximal fuenf Minuten gehalten.
   Instanz, Namespace, Alias, DB-Typ, DB-Name und Verbindungsziel gehoeren zum
   Schluessel. Aenderungen, SQL-Fehler, leere/ungueltige Historienantworten,
   Rueckwaertssprung der Uhr und Neustart verwerfen die Zuordnung.
3. Die eigentliche SQL-Pruefung verwendet `WHERE id = <gepruefte Ganzzahl>` plus
   feste inklusive Zeitgrenzen. Die bisherige `id=(SELECT ...)`-Suche entfaellt.
   Ein kleiner `EXISTS`-Guard mit derselben festen ID, exaktem Namen und Typ1
   verhindert Treffer einer zwischenzeitlich neu zugeordneten ID. Ein leeres
   Ergebnis bleibt unbekannte Abdeckung; die naechste normale Pruefung darf
   die Metadaten neu aufloesen. Kein sofortiger Fallback oder Wiederholsturm.
4. Nach asynchroner ID-Aufloesung wird die Konfiguration erneut geprueft. Ein
   spaeter Metadaten-Callback nach Abort/Unload/Instanzwechsel darf keinen neuen
   Daten-SELECT starten. Aendert sich das Ziel waehrend des Daten-SELECTs, werden
   dessen alte Ergebnisse nicht als Nachweis fuer das neue Ziel verwendet.

Ein normaler Cachetreffer erzeugt einen Datenbank-SELECT. Ein Cachemiss erzeugt
hoechstens zwei **nacheinander** ausgefuehrte SELECTs (Metadaten und Daten), unter
derselben bereits vorhandenen dauerhaften Verifikationssperre und Gesamtfrist.
Der vorhandene `queryCount` zaehlt logische Verifikationsvorgaenge, nicht einzelne
SQL-Statements; die Transportdauer umfasst bei Cachemiss beide Schritte und
Objektlesungen. Keine zusaetzliche parallele Datenbankanfrage, keine Aenderung
von Fristen, Row-/Fenstergrenzen, Retrybudget oder Poolgroesse.

Erst der echte letzte Callback erlaubt das Aufheben der Sperre. Ein spaeter
Metadatenabschluss bestaetigt keine Originale. Ein bereits ausgefuehrter
Daten-SELECT darf weiterhin seine echte spaete Antwort liefern; die bewaehrten
Sitzungs-/Sequenz-/Hashpruefungen gelten unveraendert. Keine Historiencachetreffer,
kein ACK als Persistenzbeweis und keine Wiederherstellung alter verlorener Daten.
MySQL/MariaDB, PostgreSQL, SQLite und MSSQL behalten streng begrenzte Dialekte.

## Softwarepruefung und Betrieb

Gezielte Offline-Pruefungen: vier Dialekte, ganzzahlige IDs, exakte Aliasse und
Typen, fehlende/mehrdeutige Metadaten, begrenzter Cache und Zielaenderungen,
ID-Neuvergabe, geaenderte Konfiguration vor/nach Dispatch, Abbruch waehrend
Metadatenlesung sowie Transportwurf ohne erfundene Abschlussbestaetigung.
Echte SQLite-Abfragen pruefen NULL-/Rand-/Limit-/ID-Guard und zusammengesetzte
Bereichssuche. Echte Journal-/Delivery-Gegenproben pruefen die dauerhafte Sperre
bei spaeter ID- bzw. Datenantwort: keine neue Anfrage nach Fristablauf, keine
Speicherbestaetigung aus Metadaten, echte spaete Originalbestaetigung genau einmal.
Lokale Gesamtpruefungen, Paket-/Tarballpruefung, historische Verhaltensvergleiche,
CI und gemergter Baum werden im PR getrennt nachgewiesen.

Keine Live-SQL-Anfrage, Index-/Server-/Thread-Cache-/Poolaenderung,
Installation, Aktor-/Freigabe-/Timer-/Waermeplanungs-Aenderung durch diesen Auftrag.
Die vom Betreiber gesetzten32Threads sind keine neue Adaptervorgabe und wurden
hier nicht dauerhaft gespeichert. Der alte Thread-Cache-Wert0 war ineffizient,
jedoch kein bewiesener alleiniger Grund der langen SQL-Antworten.

Nach separat bestaetigter Installation ausschliesslich neue natuerliche SQL-Faelle,
spaete Abschluesse, lokale Verluste, unbestaetigte Originale/Journalbytes und
Ablaufzaehler beurteilen. Kein neuer Score aus Softwaretests oder Installation.
Issue #60 bleibt fuer nachhaltige reale SQL-/Recorderabnahme offen. Die
Segment-/Rueckexportanforderungen aus alpha.160 bleiben unveraendert gueltig.
