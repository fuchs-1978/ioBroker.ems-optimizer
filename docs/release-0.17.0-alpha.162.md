# 0.17.0-alpha.162 – Verständliche EMS-Übersicht

Ausgangspunkt: main95fdc1e7ca8e902a668fbcd43e500270bca21e3c / alpha.161.
Betreiberauftrag28.10.2026: #155, #158 und #162 als gemeinsame Diagnose-Version
umsetzen. Keine Installation, Anlagenversuche oder zusätzlichen SQL-Abfragen.

## Was sichtbar wird

Der neue erste Admin-Reiter **EMS-Übersicht** zeigt sechs ausschließlich lesende
Textfelder. Dieselben Inhalte stehen unter `Diagnostics.Live`, `.Recorder`,
`.SQL`, `.History`, `.CurrentDay` und `.PreviousDay`. `Diagnostics.Snapshot_JSON`
enthält die begrenzte strukturierte Fassung mit Zeitpunkt und Quellenalter.
Die dynamischen Erklärungen sind bewusst deutsch; alle neuen Admin-Feldnamen
sind in den bestehenden elf Sprachen übersetzt.

- **Live:** vorhandene Regler-/Ausgangsgründe, Freigaben, Soll versus gemessene
  Leistung, gültiger SoC/Ziel, Budget und Timer. Eine alte Stoppursache bleibt
  im strukturierten historischen Feld; sie wird nicht als heutiger Grund benutzt.
  Bei alter Regelbeobachtung heißt es unbekannt statt einer erfundenen Erklärung.
  AUS-Bestätigung und elektrische Ruhe bleiben getrennte Zustände.
- **Recorder:** aktuelle Arbeitsfähigkeit, neue beobachtete Verlust-/Fehlerzunahme,
  Laufzeitzähler, Journalfüllung und wartende Originale. Historisch unbestätigt
  abgelaufene Originale bleiben separat sichtbar. Das älteste unbestätigte
  Original wird ausschließlich aus vorhandenen Journal-Metadaten bestimmt;
  bei abweichendem Live-/Cachezähler oder unbekanntem Ereigniszeitpunkt bleibt
  es unbekannt. Bestätigte zurückgehaltene Abhängigkeiten zählen dafür nicht.
- **SQL:** echter letzter Speichernachweis, Fehler seit Start, wartende und aktive
  Anfragen sowie letzte Transportzeit. Eine normale laufende Anfrage mit Fence
  ist nicht automatisch eine Blockade. Eine überschrittene Anfrage bleibt
  blockiert, bis der bestehende Backendpfad ihren Abschluss tatsächlich belegt.
  Nach Erholung ist ein alter Fehler keine aktuelle Störung.
- **Externe Historie:** ausdrücklich **nicht geprüft**. Es gibt derzeit keinen
  angebundenen externen Abrufprüfstand. Letzter erfolgreicher externer Abruf,
  qualifizierte Ereignisabdeckung, Decoder- und Sequenzlücken bleiben `null`.
  Gute Recorder-/SQL-Werte füllen diese unabhängige Nachweislücke nicht auf.
- **Tagesrückblick:** vorhandene laufende/vorherige Bilanz ab20Uhr Europe/Berlin,
  einschließlich23-/25-Stunden-Tagen. Energie bleibt begrenztes Leistungsintegral,
  keine Zählerdifferenz. Quellenabdeckung, vergangene unbekannte Zeit und noch
  nicht beobachtete Restzeit werden getrennt. BHKW ohne Nachweis bleibt unbekannt.
  EHZ-Energie ist elektrisch, nicht gemessene Nutzwärme. Beobachtete Stopps und
  verdrängte Details sind keine automatische Ereignis-/Schutzabnahme.

## Grenzen und unveränderte Regelung

Die Anzeige erfindet weder historische Zielerreichung noch Kosten/Ersparnis:
den vorhandenen Summen fehlen vollständige SoC-/Freigabeketten beziehungsweise
eine passende Preis-/Vergleichsbasis. Diese Felder bleiben ausdrücklich unbekannt.
Keine optionale Benachrichtigung und kein weiterer Datensammler werden aktiviert.

Die bestehende5-s-Tagesabtastung liefert den Snapshot. SQL-/Journalzustände
werden aus dem vorhandenen Cache gelesen; keine weiteren SQL-/Historienaufrufe,
Datei-Lese-/Syncvorgänge oder Quellabonnements. Höchstens65536 vorhandene lokale
Journal-Metadateneinträge werden zur ältesten Originalzeit betrachtet. Pro
Anzeigezustand sind nur laufender und neuester Ersatzwert im Schreibpuffer;
strukturierter Zustand maximal48000Bytes. Hängende Anzeigen dürfen keine
unbegrenzte Warteschlange erzeugen. Diagnosefehler verändern keine Aktorbefehle.

Die Laderegelung, Quellen-/ACK-/Schutzfristen und SQL-Verifikation aus161 bleiben
unverändert. Keine Behebung der Storage-/SQL-Ursache in #60 behauptet. Die19
Recorderverluste unter160 und399,621s SQL-Antwort unter161 bleiben reale Befunde.
Kein automatischer Live-Installations- oder vollständiger Anlagenabnahmenachweis.

## Prüfung und Issue-Abnahme

Lokal abschließend3290/3290 Tests erfolgreich. Paketmetadaten mit sieben news,
isoliert tatsächlich installiertes Tarball273Dateien/747Engine-States plus sieben
zur Laufzeit angelegte lesende Diagnosezustände sowie beide historischen
Verhaltensvergleiche erfolgreich. Elf Kataloge mit je575Schlüsseln. Eine einmalig
lesend gelesene vorhandene reale Snapshot-/Tagesbilanz wurde offline durch die
Darstellung geführt; nicht atomare Statuszeiten bleiben unbekannt statt frisch
gerechnet. Keine Installation oder visuelle produktive Admin-Abnahme daraus.

Gezielte Tests prüfen echten recovered-161-Status, normalen Fence versus
Blockade, fehlende/alte/future Statuswerte, Neustart-/Zählergrenzen, bestätigte
Abhängigkeiten versus unbestätigte Originale, Reststrom nach AUS, ausstehende
elektrische Antwort, Master/Frische, ungültige Tageswerte, unbekannte Quellen,
Kosten/Ziele und begrenzte hängende Anzeigeschreibzugriffe. Zusätzlich gesamte
Suite, Paket-/installiertes Tarball, historische Verhaltensvergleiche und
GitHub-CI Node22/24/26 vor Merge.

#155/#158/#162 erhalten einen Software-Teilabschluss. Erst nach tatsächlicher
Installation und Prüfung der Anzeige mit aktuellen realen Zuständen kann die
entsprechende reale Anzeigeabnahme abgehakt werden. Für externe Historie ist
der angezeigte Zustand mangels angebundenem Prüfstand weiterhin ungeprüft;
eine zukünftige Berichtsanbindung ist keine bereits implementierte Funktion.
