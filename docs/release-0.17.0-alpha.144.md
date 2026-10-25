# 0.17.0-alpha.144 – spaete SQL-Antworten als exakten Nachweis nutzen

## Beleg und enger Fehlerumfang

Im lesenden Status vom25.10.2026 lief installierte und laufende143. Eine interne Originalbestaetigung fuer11:20:06–11:20:07.999 MEZ ueberschritt um11:20:36 die lokale30-s-Frist. Der tatsaechliche Callback kam11:21:22 nach etwa75,843s Transportwartezeit; dauerhafter Fence-Abschluss folgte. Gegen11:22:11 war der Abrufweg wieder frei und eine nachfolgende Abfrage erfolgreich. Die Wartezeit ist keine isolierte DB-Ausfuehrungszeit; SQL-/Pool-/Nachrichtenwegursache bleibt offen. Andere erhaltene natuerliche Antworten waren ebenfalls verspaetet. Keine neue Historien-/SQL-Abfrage zur Reproduktion.

Codebefund auf main78e77d68152bf9b14e7934111706bde7b8cdc342: Nach der lokalen Deadline aktualisiert ein spaeter Callback seinen Fehlerbeleg und kann den eigenen Fence aufheben. Seine Ergebniszeilen erreichen jedoch den nach Promise.race liegenden Originalabgleich nicht mehr. Deshalb koennen bereits gespeicherte, exakt belegbare Originale im lokalen Rueckstau bleiben und eine weitere Nachweisabfrage benoetigen. Der neue Offline-Hauptfall zeigt zwei solche Originale, die mit unveraenderter143 trotz passender spaeter Paketantwort nicht bestaetigt werden.

## Umsetzung und Grenzen

Ein gemeinsamer Antwortverbraucher behandelt rechtzeitige und verspaetete Antworten. Unveraenderte Antwort-/Zeilen-/Zeitfenster-/Groessengrenzen, vollstaendige Validierung jeder schema4-Huelle und exakter Sitzung-/Sequenz-/Hashabgleich gegen die urspruenglich angeforderten lokalen Originale bleiben erforderlich. Doppelte Zeilen werden nur einmal bestaetigt. Nur ein nachgewiesener Treffer erlaubt die bestehende dauerhafte Bestaetigung/Bereinigung; Veroeffentlichung, Alter oder blosses Callbackende genuegen nicht.

Die Backendoperation umfasst jetzt auch den Originalabgleich. Nach einer Deadline bleibt das Gate bis zum Abschluss dieser Verarbeitung gesperrt; Shutdown wartet innerhalb seines bestehenden2-s-Budgets auf diese Operation. Nach bereits erfolgtem Stop wird eine neu eintreffende Antwort nicht mehr zur Bestaetigung verwendet; ihr realer Fence-Abschluss bleibt moeglich. Nie unbegrenzt auf Abschluss warten, nie vor unbekanntem Abschluss einen weiteren Read starten. Ein fehlgeschlagener dauerhafter Fence-Abschluss bleibt gesperrt.

Eine spaete Antwort liefert nur positive exakte Nachweise, keine neuen Fehl-/Replayentscheidungen aus fehlenden Zeilen. Alte SQL-Zeitstempel werden nicht zu frischen Recoverybelegen umgedeutet. Die urspruengliche Deadline, Fehlerklasse und Fehlerzahl bleiben erhalten. Derselbe begrenzte Fehlercheckpoint erhaelt optionale Zeitmarken, bestaetigte Originalzahl und eine feste Ergebnis-Kategorie fuer die Nachverarbeitung. Alte schema1-Checkpoints bleiben lesbar, weiterhin maximal16Eintraege/16KiB und keine Rohwerte/SQL/privaten Fehlertexte.

Keine Aenderung an SQL-Timeout, Abfrage-/Writebudgets, Parallelitaet, Pufferkapazitaet, Retention, fsync, Codec, Regler oder Schutzgrenzen. Keine zusaetzlichen SQL-Abfragen, Liveinstallation, Neustarts oder Anlagenwrites. Dies reduziert vermeidbare erneute Nachweisarbeit, behebt aber keine belegte DB-/NAS-/Poolursache und garantiert keine konkrete Laufzeit oder Speicherersparnis.

## Regression und reale Abnahme

Neue kontrollierte Offline-Faelle pruefen spaete gebuendelte/duplizierte Treffer ohne zweiten Read, alte Nachweise ohne frische Recovery, leere Antworten ohne Miss-/Replayanrechnung, falsche Hashes, beschaedigte Pakete, falsche Fenster, Zeilen-/Payloadgrenzen, fehlenden Backendabschluss, explizite SQL-Fehler, langsame dauerhafte Bestaetigung bei parallelem Tick/Shutdown sowie Stop vor Callback und fehlgeschlagenen Fence-Abschluss. Die Kernregression scheitert gegen unveraenderte143; Sicherheitskontrollen werden weiterhin separat geprueft. Testergebnisse im PR/Issue sind Softwarebelege.

Reale Abnahme erst nach separat erfolgter Installation an einer neuen natuerlichen spaeten Antwort: identischer Fehlerfall bleibt erhalten, Callback/Fence und lateProcessedAt/lateOutcome/lateConfirmedRecords nachvollziehbar, passende Originale werden genau einmal bestaetigt und keine weitere Abfrage dieses erledigten Fensters gestartet. Unbestaetigte Originale und Journalbytes gemeinsam beobachten; Ablaufzaehler nicht als Recovery werten. Vollstaendige SQL-Zustellung oder Ursache der langen Wartezeit daraus nicht behaupten. Energiepotenzial nicht belastbar quantifizierbar; keine Scorepunkte aus Softwaretests.
