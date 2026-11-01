# 0.17.0-alpha.186 – SoC-Fortschritt, Kommunikationshalt und Recorder

## SoC

Ein wiederholt unveränderter Cloud-Prozentwert mit neuem Veröffentlichungszeitstempel setzt eine lückenlos aus dem AC-Zähler fortgeschriebene Ladebasis nicht mehr zurück. Die ursprüngliche Energiebasis bleibt erhalten; Energie wird genau einmal gezählt. Geänderte Prozentwerte und konfigurierte tatsächliche Fahrzeug-Messzeitpunkte werden weiterhin zeitlich ausgerichtet ausgewertet. Quellenwechsel, Zählerreset, unplausible Sprünge und Beobachtungslücken erhalten ihre bisherigen Sperren. Die Plausibilitätswarnung bleibt sichtbar.

Bereits vor dem Update verlorener Fortschritt wird nicht rückwirkend erfunden. Ein am Fahrzeug oder in der App bestätigter aktueller SoC kann über Vehicles.WallboxN.SoCCorrection_pct mit ack=false korrigiert werden. Die Korrektur ist nicht fahrzeugspezifisch im Code hinterlegt und bleibt gegen unveränderte Cloud-Wiederholungen geschützt. Die Tests decken wiederholte 69-%-Publikationen über drei Stunden sowie Quellzeit, Neustart und manuelle Korrektur ab.

## Laufende Wallbox bei Verbindungsverlust

Für einen bereits gesendeten Folgestromschritt wird dessen privater Fortsetzungsnachweis jetzt auch vor Ablauf der ACK-Frist genutzt, falls die Verbindung ausfällt. Bisher konnte der normale Offline-Stopp den erst später greifenden Haltepfad überholen. Die Ladung bleibt ohne neue Aktorbefehle bestehen; der größte mögliche Strom bleibt reserviert. Es wird weder ein ACK noch eine Fahrzeugantwort fingiert. Gültige unabhängige Netz-/Schutzwerte, Freigaben, SoC und passende Phasen bleiben erforderlich. Ein neuer Start oder ein Phasenwechsel erhält dadurch keine Freigabe. Regressionstests prüfen 1P/3P und den weiterhin wirksamen Schutzstopp.

## Recorder und bestehende SQL-Sperre

Die Datapunkt-Metadatenabfrage liest bei MySQL-Konfiguration zusätzlich die Serverversion. Für erkannte MariaDB-Versionen ab 10.1 wird die eigentliche, weiterhin zeitlich/zeilenmäßig begrenzte Historienprüfung mit SET STATEMENT max_statement_time=2, lock_wait_timeout=2 FOR SELECT ausgeführt. Das begrenzt diese einzelne Anfrage auf dem Server, ohne globale oder dauerhafte Sitzungseinstellungen zu verändern. Andere Server behalten ihren bisherigen SQL-Dialekt. Ein Serverabbruch führt nicht zu einem unbeschränkten Ersatzversuch. Die lokale Frist ersetzt weiterhin keinen tatsächlichen Backend-Abschluss; Warteschlangen, Verbindungsverlust oder ein Prozessabbruch können deshalb nach wie vor einen unbekannten Abschluss hinterlassen.

Die lesende Wiederherstellung nach nachgewiesenem SQL-Prozesswechsel erhält höchstens drei Versuche pro 15-Minuten-Fenster. Vorübergehende andere Datenbankarbeit erschöpft die Wiederherstellung damit nicht mehr für immer. Fehlende Rechte, aktive DB-Arbeit und unbekannte Abschlussnachweise bleiben sperrend; es werden keine Rechte geändert oder Anfragen abgebrochen. Der Status nennt nun den erforderlichen SQL-Neustart ausdrücklich.

**Für eine bereits verwaiste Anfrage reicht das EMS-Update allein nicht:** Der SQL-Adapter muss einmal vom Nutzer neu gestartet werden. Nach einer Minute stabiler SQL-Laufzeit prüft das EMS die beobachtete neue Prozessgeneration und liest Berechtigungen sowie aktive Datenbankarbeit. Nur mit den vorhandenen unabhängigen Nachweisen wird die alte Anfragesperre aufgehoben. Ein neuer EMS-Neustart allein ist kein Nachweis. Das EMS startet weder den SQL-Adapter noch andere Adapter automatisch neu.

Eine aufgehobene Anfragesperre bestätigt noch keine SQL-Speicherung. Erst exakte, unabhängig gelesene Originaltreffer erlauben die normale Bereinigung des Journals. Volle Puffer, historische Aufzeichnungslücken und unbestätigte Daten bleiben sichtbar; diese Version löscht sie nicht stillschweigend und verspricht keine unbegrenzte Speicherung.

Referenz zur anfragebezogenen MariaDB-Begrenzung: https://mariadb.com/docs/server/reference/sql-statements/administrative-sql-statements/set-commands/set-statement
