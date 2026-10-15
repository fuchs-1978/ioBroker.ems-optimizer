# 0.17.0-alpha.83

## Belegter Anlass
Auf alpha.82 wurde am 15.10.2026 in einem begrenzten Kontrollabschnitt weiterhin lokaler Queueverlust beobachtet, obwohl SQL wieder bestaetigte und der Plattenpuffer frei war. Ein einzelnes gelesenes Paket mit 16 Originalen enthielt 192.602 unkomprimierte JSON-Bytes; 168.271 Byte entfielen auf 1.936 wiederholte Alters-Pfadoperationen, die eigentlichen Ereignisobjekte auf 5.943 Byte. Die bestehende Kompression reduzierte die gesamte Huelle bereits auf 17.761 Byte: Das Rohdatenverhaeltnis ist keine pauschale SQL-Einsparquote.

## Gezielte Korrektur
Schema-3-Deltas koennen eine erste Operation `age-shifts` enthalten. Ihre Gruppen speichern endliche exakte Differenzen `by` und eindeutige `indices` in das deterministische Woerterbuch bestehender numerischer `ageMs`/`ageS`/`age_s`-Blaetter des vorherigen rekonstruierten Datenobjekts. Die Traversierung sortiert eigene Objektschluessel lexikografisch; Array-Schluessel werden als numerische Pfadteile benutzt. Nur wenn vorheriger Wert plus Differenz exakt dem neuen Wert entspricht, wird die Einzeloperation ersetzt. NULL, Typ-/Strukturaenderungen, nicht exakt darstellbare Differenzen und sonstige Felder bleiben normale Operationen. Keine Ableitung aus heutiger Uhrzeit, keine Schaetzung und keine stillschweigende Erneuerung von Quellenzeit/Frische.

Der Decoder prueft Basis/Session/Sequenz wie bisher, Altersgruppen/Indices/Endlichkeit und Duplikate vollstaendig. Ungueltige Deltas verwerfen die Rekonstruktionsbasis und bleiben unbekannt. Maximal 16.384 Altersreferenzen; die kompakte Form wird nur gewaehlt, wenn sie kleiner ist. Periodische Vollcheckpoints und Originalereignisse bleiben erhalten. Transporthuellen und SQL-Speichernachweis vergleichen weiter exakt die gespeicherten Originalstrings.

**Leserkompatibilitaet:** Aktuellen Decoder aus diesem main/Release verwenden. Aeltere Decoder kennen `age-shifts` nicht und melden diese Deltas als unbekannt; sie duerfen keine alte Basis als aktuellen Zustand ausgeben. Alte Schema-1/2/3-Records ohne neue Operation bleiben lesbar. Kein neues Transporthuellenformat.

Der ausloesende Rohsample bleibt unmittelbar in `source.update`, wird aber nicht zusaetzlich in `recording.pre_event` kopiert. Alle frueheren Rohsamples bleiben erhalten; tatsaechliche Vorlauf-Batchgrenzen werden aus enthaltenen Samples angegeben. Dieselbe Session/sampleSequence bezeichnet weiterhin dieselbe Beobachtung; Ereigniszeit/Quelle-ts/lc/ACK/q/NULL bleiben unveraendert. Keine Lockerung des Gap-Triggers.

Grosse RecordJournalStatus-/RecordDeliveryStatus-JSONs und die dazugehoerige Delivery-Health-Berechnung sind auf einmal pro Sekunde begrenzt. RecordSQLLastError folgt derselben Statuskadenz. Unveraenderte Diagnose-Skalare werden nicht erneut geschrieben; geaenderte Verlustzaehler bleiben sichtbar und Verluste weiterhin im Record markiert. Statusanzeigen sind kein Ersatz fuer Ereignishistorie.

## Bewusst unveraendert
Keine Ausduennung eindeutiger Rohquellen, Befehle oder ACK-/Qualitaetswechsel. Nur die doppelte Darstellung desselben sofortigen Rohsamples im Vorlauf entfaellt. Keine Lockerung von Schutz- oder Diagnose-Gap-Fristen. Keine automatische SQL-, Anlagen-, Aktor- oder Konfigurationsaenderung. Keine Erhoehung von Abfragezahl, Parallelitaet, Journalgroesse oder Retention. Bestehende Datei-/Verzeichnis-Synchronisation und Crash-Wiederherstellung bleiben erhalten; ein Segmentjournal wird in dieser Version nicht eingefuehrt. Keine automatische Installation.

## Validierung und offene reale Abnahme
Regressionen pruefen exakte Rekonstruktion vieler Altersfelder samt Rohquelle/NULL/ACK/q/Ereignis, Null-/Typ-/Array-/Gleitkommaaenderungen, Sequenzluecken und Checkpoints sowie ungueltige Altersindices/-gruppen. Ein begrenzter lokaler Vergleich mit 128 gleichmaessig alternden Messfeldern ergab fuer einen Deltaframe 8.862 Byte vorher und 639 Byte nachher; kein zugesagter realer Tages-/Transport-Einsparwert. Der alte Decoder wurde separat geprueft und verwirft die neue Operation als unbekannt. Statusregression prueft die Ein-Sekunden-Kadenz bei weiterhin sichtbaren geaenderten Verlustzaehlern.

Nach manueller Installation pruefen: decodierbare neue Originale, exakte Rekonstruktion mit aktuellem Decoder, Roh-/Transportmengen getrennt, lokale Queueverluste und Puffer/Rueckstau ueber Zeit. Kein Softwaretest beweist den realen vollstaendigen 24-h-Abruf oder dauerhafte Anlagenabnahme. Bestehende sporadische SQL-/NAS-/Connector-Abbrueche und bereits verlorene Daten bleiben offen. Keine Scorepunkte allein durch Release.
