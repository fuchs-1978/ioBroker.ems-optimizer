# 0.17.0-alpha.82

## Befund und Ursachenabgrenzung
Am 15.10.2026 gegen 09:52 MESZ wurden auf alpha.81 25.692 Originale bei 482 internen Abfragen ohne Abfragefehler bestaetigt. Trotzdem standen 188 Prueffenster/7.505 laufende Nachweise aus; die letzte abgearbeitete Publikation lag rund 14 Minuten zurueck. Unbestaetigter Journalbestand 7.523, 131.886.375 Byte, RecordDropped seit Start 2.914; Ablaufzaehler unveraendert. Steuerung/Fahrplan meldeten gueltigen Betrieb. Das ist kein Nachweis einer vollstaendigen Anlagenabnahme.

Der Versand kann mehrere Zwei-Sekunden-Fenster pro Paketfolge erzeugen. Einzelnes Abfragen jedes Fensters begrenzt die Nachweisrate. Zusaetzlich pruefte das lokale Journal pro einzelnem SQL-Treffer alle bereinigbaren Gruppen und schrieb den Gesundheitsstatus erneut. Die bisherige gesamte Abfragedauer enthaelt auch lokale Nachweis-/Dateiarbeit und darf nicht als reine Datenbanklaufzeit ausgegeben werden.

Installierter SQL-Adapter: 4.2.1. Dessen passender Quellstand war ueber den GitHub-Connector nicht zugreifbar (404 fuer Versionsref und main.js). Es wird deshalb keine direkte dauerhafte Speicherquittung dieses Adapters unterstellt und keine neue SQL-Schreibschnittstelle eingefuehrt.

## Korrektur
- Faellige urspruengliche Prueffenster werden im gesunden Betrieb innerhalb maximal zehn Sekunden, acht Aufgaben und 1.024 erwarteten Identitaeten gemeinsam gelesen. Weiterhin maximal 32 SQL-Werte, 2 MiB kodierte Antwort und eine sequenzielle Abfrage pro Durchlauf. Fehlerbetrieb bleibt eng; gesplittete/fehlerhafte Fenster werden nicht wieder zusammengefuehrt. Vollstaendige Fehlstellen gelten weiterhin nur innerhalb der wirklich gelesenen Grenzen. Limit/Abschneidung fuehren zu Teilung, nicht zu Vollstaendigkeit.
- Exakte Hash-/Sitzungs-/Sequenztreffer einer Antwort werden dedupliziert und als begrenzter Satz (maximal 512 Originale) an das Journal gegeben. Der gesamte Satz wird vor jeder Markierung validiert; dann erfolgen Gruppenpruefung und Gesundheitsmetadaten gemeinsam. Dauerhafte Gruppenmarker und kapazitaetssperrende Behandlung von Bereinigungsfehlern bleiben erhalten. Nach Neustart muessen erhaltene Originale erneut bewiesen werden. Eine erfolgreiche State-Publikation allein loescht nichts.
- `responseObservedMs` enthaelt Antwortbeobachtung samt lokaler Anfrage-/Sperrverwaltung; `proofProcessingMs` zeigt die anschliessende Nachweis-/Bereinigungsarbeit. `elapsedMs` bleibt die Gesamtdauer. Keine dieser Zahlen behauptet reine SQL-Serverlaufzeit.

Keine Aenderung von Regler, Schutz, Aktoren, SQL-Konfiguration, Journalgroesse, Retention, Originalformat oder Rohquellen/NULL/ACK/q. Kein paralleler SQL-Zugriff und keine automatische Installation.

## Tests und reale Grenzen
Ein lokaler Fall mit 640 Originalen und zeitlich ueber mehrere kleine Fenster verteilten Paket-Schreibvorgaengen bestaetigt am unveraenderten alpha.81 nach zehn Durchlaeufen nur 304 Originale. Die Korrektur bestaetigt alle 640 mit derselben Abfragezahl. Regressionen pruefen fehlende Pakete, Limitteilung ohne erneutes Vergroessern, unbekannten Backendabschluss, Grenzen sowie deduplizierte Stapelnachweise. Echte Dateitests pruefen ein gemeinsames Gesundheitsschreiben, Ablehnung eines fehlerhaften Nachweis-Praefixes und Neustart nach unterbrochener Gruppenbereinigung mit erhaltenem unbestaetigtem Folgecheckpoint.

Nach manueller Installation: Pruefverzug, offene Fenster, unbestaetigte Records und Pufferbytes muessen nachhaltig sinken, neue Aufzeichnungsverluste enden. Ablaufverlust bleibt separat. Neue Zeitfelder zur Ursachenabgrenzung nutzen. Softwaretests beweisen keinen vollstaendigen realen 24-h-Abruf und keinen dauerhaften Anlagenbetrieb; keine zugesagten Scorepunkte, keine Wiederherstellung bereits verlorener Daten und kein behaupteter Fix aller NAS-/Connector-Probleme.
