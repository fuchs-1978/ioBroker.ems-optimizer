# 0.17.0-alpha.87 – Recorder-Schreiben und Lesen

## Befund

Am 18.10.2026 wurden unter alpha.86 87 neue RecordDropped/RecordWriteErrors beobachtet. Die Meldung nannte die volle lokale Recorder-Warteschlange. Das Journal belegte zu diesem Zeitpunkt nur etwa 1,8–2 MiB von 128 MiB; volle Festplattenkapazitaet ist dadurch nicht belegt. Die 128 Raw-Frames/8-MiB-Vorwarteschlange ist ein eigener Engpass. Ein SQL-Fehler war erholt; frische unabhaengige Speicherbestaetigungen liefen weiter. Bereits verlorene Originale bleiben unbekannt.

## Aenderung

- Geordnete Raw-Frame-Verarbeitung in Paketen von maximal 16 Records und 256 KiB Raw-Daten; ein einzelner groesserer Record nutzt den bisherigen Einzelpfad. Das Journal begrenzt Mehrfachpakete zusaetzlich auf 512 KiB Nutzdaten.
- Jedes Original behaelt Format, Identitaet, Hash, eigene Datei und Datei-fsync. Maximal vier Dateioperationen gleichzeitig; zwei gemeinsame Verzeichnisbarrieren statt zwei pro Original. Erst nach dem kompletten dauerhaften Paket werden Originale zur Veroeffentlichung registriert.
- Alle gestarteten Dateioperationen werden auch im Fehlerfall abgewartet. Ein fehlgeschlagenes Paket liefert keinen scheinbar guten Praefix. Artefakte bleiben fuer die bisherige Wiederanlaufpruefung erhalten; unklare Kapazitaet sperrt neue Appends. Encoder-Neustart verhindert neue Deltas auf abgewiesene Vorgaenger.
- Unveraenderliche Originale innerhalb eines Lesepakets mit maximal vier parallelen Dateizugriffen lesen, Reihenfolge und Byte-/Anzahlgrenzen erhalten. Mutationen bleiben bis zum Ende gesperrt. Ein korruptes Original verwirft das gesamte Leseergebnis.
- RecordJournalStatus ergaenzt recorderQueue mit aktuellem Bestand, RAM-Grenzen und High-Water-Werten sowie lastAppendBatch/lastReadBatch fuer Paketgroesse und Laufzeit. Zeitwerte sind Diagnostik, keine zugesicherte Latenz.

Die RAM-Grenzen von 128 wartenden Records/8 MiB und lokalen Journalgrenzen bleiben erhalten. Keine Aufzeichnung wird absichtlich zur Lastsenkung ausgeduennt. SQL-Versand, unabhaengiger exakter History-Nachweis, unbekannte Backend-Abschluesse, Wiederanlauf, Aufbewahrung und historischer Decoder wurden mit den bestehenden Tests erneut geprueft. Veroeffentlichung ist weiterhin kein SQL-Speichernachweis; Bereinigung erfordert weiterhin den unabhaengigen Nachweis beziehungsweise die ausdruecklich diagnostizierte Aufbewahrungsfrist.

## Validierung und Betriebsnachweis

Gezielte Regressionen pruefen 16 Originale mit zwei statt 32 Verzeichnisbarrieren, maximal vier Dateioperationen, bytegenauen Wiederanlauf, Schreibfehler mitten im Paket, ungueltige fehlende Delta-Basis nach Wiederanlauf, ganze Paketabweisung bei Kapazitaetsmangel, geordnete begrenzte Lesezugriffe, Korruption ohne Teilergebnis sowie unveraenderte Vorwarteschlangengrenzen und Encoder-Neustart nach Fehlern. Vollstaendige Tests und Paketpruefung sind Voraussetzung der Veroeffentlichung.

Nach Installation sind neue RecordDropped/RecordWriteErrors, Warteschlangenspitzen, Paketzeiten und frische SQL-Nachweise unter realer NAS-Last zu vergleichen. Der Test belegt reduzierte Synchronisationsarbeit, keine bereits erreichte Verlustfreiheit im Livebetrieb. Keine Installation, produktive SQL-/Admin-Aenderung oder Aenderung der EMS-Regelung ist Teil dieser Veroeffentlichung.
