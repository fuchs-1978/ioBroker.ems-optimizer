# 0.17.0-alpha.141 – SQL-Prueffehler mit erhaltenen Phasenzeiten

## Anlass und Verhalten

In der Nacht zum25.10.2026 stieg der produktive SQL-Prueffehlerzaehler von3 auf13. Die aktuelle erfolgreiche Abfrage ueberschreibt `lastQuery`; der interne128-Abfragen-Ring wird bewusst nicht als grosser Status veroeffentlicht. Damit fehlten spaeter die einzelnen Fehlerfenster und die Zuordnung verspaeteter Antworten. Siehe [Leit-Issue60](https://github.com/fuchs-1978/ioBroker.ems-optimizer/issues/60).

Diese Version behebt diese belegte Diagnoseluecke. Sie ist **kein nachgewiesener Fix der naechtlichen SQL-Verzoegerungsursache**. Die zehn zusaetzlichen Prueffehler sind nicht automatisch zehn sicher belegte SQL-Timeouts. Ein Prueffehler beweist weder Datenverlust noch eine fehlgeschlagene SQL-Speicherung.

## Neuer Diagnosezustand

`Debug.Shadow.RecordSQLFailures_JSON` enthaelt schema1, hoechstens16 Fehlerfaelle und insgesamt hoechstens16KiB JSON. Erfolge verdraengen keine Fehler. Bei Kapazitaetsverdraengung steigt `evicted`; unbekannte alte Ereignisse werden nicht rekonstruiert. Der Zustand ist nur lesbar und wird nicht automatisch fuer SQL-Historisierung angemeldet. Die vorhandene Zustandsdatenbank dient als neustartfester Pruefstand, nicht als unabhaengiger SQL-Originalnachweis. Abrupter Ausfall vor abgeschlossener Zustandsspeicherung kann weiterhin den juengsten Stand verlieren.

Enthalten sind ausschliesslich fest ausgewaehlte skalare Metadaten: Verification-ID, Fenster/Limit, Fehlerzeit, feste Fehlerklasse/Phase, Ausgabe-/Callback-/Fence-Status sowie lokale Zeitmessungen und kleine Journalzaehler. Keine SQL-Texte, Rohrecords, Zugangsdaten oder beliebigen Fehlermeldungen werden in den Fehlerverlauf uebernommen. Der bisherige letzte Fehlertext bleibt kompatibel im bestehenden Status.

- `journalBeginAt` / `journalBeginMs`: lokale dauerhafte Vorbereitung des Verification-Fence einschliesslich Queuewartezeit.
- `transportAt` / `transportWaitMs` / `transportSettledAt`: Aufruf und Rueckkehr des injizierten ioBroker→SQL-Lesewegs. **Keine isolierte DB-Ausfuehrungszeit**; eine Promise-Ablehnung beweist keinen Backendabschluss.
- `callbackAt` und `backendCompletionObserved`: explizit beobachtete Backendantwort, auch nach lokalem Timeout.
- `fenceCompletedAt` / `fenceCompleteMs`: abgeschlossener lokaler dauerhafter Fence-Abschluss, getrennt von der Callbackbeobachtung.
- `deadlineAt` / `deadlineOverrunMs`: lokale Fristbeobachtung und Verspaetung des Timeraufrufs gegen die monotone Uhr. Kein vollstaendiger historischer CPU-/Eventloopnachweis.

Ein spaeter Callback aktualisiert denselben Fehlerfall. Das alte Fehlerdatum und die Fehlerphase bleiben erhalten. Ein bereits kapazitaetsbedingt verdraengter Fall wird nicht wieder eingefuegt. Unbekannte Zeiten bleiben null.

Die regulaere Veroeffentlichung erfolgt nur bei geaendertem Fehlerstand und hoechstens im vorhandenen1-s-Statustakt. Der Zustand wird vor der Erfassung restauriert; falsches/zu grosses/beschaedigtes Format wird nicht teilweise als gueltiger Verlauf uebernommen (`checkpointStatus=invalid`), fehlender Zustandszugriff ist `unavailable`. Beim geordneten Beenden wird nach dem bereits vorhandenen begrenzten SQL-Drain der aktuelle Fehlerstand nochmals gespeichert. Keine neuen Hintergrundabfragen oder Zusatzpolls.

## Unveraenderte Vertrauensgrenzen

Keine Aenderung an SQL-Instanz/Retention/Index/Pool, 30-s-Prueffrist, Queuegroessen, Query-/Writeparallelitaet, Sperren/Recovery oder Wiederholregeln. Ein Diagnosecheckpoint kann keinen Fence freigeben und keine Originalspeicherung bestaetigen. Regler, Stellbefehle, Schutzgrenzen und Anlagenkonfiguration bleiben unveraendert. Keine Installation oder Neustarts durch diesen Entwicklungsauftrag.

## Regression und reale Abnahme

Gezielte Offline-Regressionen pruefen Fehlererhalt ueber mehr als128 erfolgreiche Folgeabfragen, getrennte Fehlerklassen, spaeten echten Callback, Timeout waehrend lokaler Journalvorbereitung bzw. lokalem Fence-Abschluss, streng begrenzte/validierte Wiederherstellung sowie Veroeffentlichung ohne automatische SQL-Anmeldung. Vorhandene Deadline-/Recovery-Tests bleiben massgeblich.

Nach einer separat vorgenommenen Installation zunaechst System.Version und den neuen Diagnosezustand lesen. Bei einer **neuen natuerlichen** Stoerung muss derselbe Fall nach erfolgreichen Folgeabfragen und nach geordnetem Adapterneustart erhalten bleiben; spaeter Callback und lokaler Abschluss muessen getrennt erkennbar sein. Keine kuenstlichen Anlagenversuche, SQL-Lasttests oder Wiederholung alter Fenster. Erst die neue zeitliche Wirkungskette kann einen konkreten Performance-/SQL-Folgefix begruenden. Keine erwarteten Scorepunkte.
