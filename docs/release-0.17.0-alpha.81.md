# 0.17.0-alpha.81

## Beobachtung und Ursache
Auf alpha.80 wurden am 15.10.2026 morgens frische exakte SQL-Bestätigungen ohne neue Abfragefehler beobachtet. Trotzdem stieg der unbestätigte Bestand von 7.099 auf 7.324, das 128-MiB-Journal blieb voll und weitere Aufzeichnungen wurden verworfen. Der Ablaufzähler war unverändert. Das ist kein erfolgreicher nachhaltiger Rückstauabbau.

Im Code begrenzte ein gemeinsames Originalbudget den gesamten Fünf-Sekunden-Durchlauf auf 16 Originale, obwohl bereits bis zu vier Transportaufrufe erlaubt waren. Die lokale Lesemenge war zudem mit dem kodierten Transportbudget gekoppelt. Ein aktuelles Transportpaket enthielt originale Quellen-, Befehls- und Qualitätsereignisse; diese werden nicht als Abhilfe weggefiltert. Der Engpass wurde mit endlichem Rückstau und kontinuierlichem Zulauf lokal reproduziert. Die ursprünglichen NAS-/Connector-Störungen sind dadurch nicht erklärt.

## Korrektur und Grenzen
Im gesunden Betrieb bis zu 64 Originale über die bestehenden maximal vier sequenziellen State-Schreibaufrufe pro fünf Sekunden. Pro Hülle weiterhin höchstens 16 Originale, 2 MiB dekomprimierter Inhalt und 60 KiB kodierter SQL-Wert. Das begrenzte lokale Arbeitsbudget beträgt 2 MiB pro Durchlauf; das bisherige kodierte Transportbudget von 512 KiB bleibt erhalten. Große oder schlecht komprimierbare Originale begrenzen die tatsächliche Menge früher; ein ungesendeter Rest bleibt im Journal. Keine Erhöhung der SQL-Abfragezahl oder Parallelität.

Fehlerbetrieb weiterhin höchstens ein Original und eine Abfrage pro 30 Sekunden. Unbekannte Backendabschlüsse sperren weiterhin. Nur unabhängig gelesene exakte Hash-/Sitzungs-/Sequenztreffer bestätigen Originale; erfolgreiche State-Schreibaufrufe reichen nicht. Das Originalformat und die Rohzeitstempel/NULL/ACK/q bleiben unverändert. Keine Veränderung von Regler, Schutzlogik, Anlagenkonfiguration, SQL-Einstellungen, Pufferkapazität oder Retention. Keine automatische Installation.

## Nachweise
Regression mit 400 ursprünglichen und 40 neu eintreffenden Originalen pro fünf Sekunden: Der unveränderte alpha.80 bleibt zurück; die Korrektur arbeitet alle 1.200 Originale innerhalb der endlichen Testfolge mit exaktem Nachweis ab. Weitere Tests prüfen fehlende SQL-Zeilen, Verlust zusammengehöriger Transportpakete, inkompressible Daten, erhaltene ungesendete Reste, unveränderte Fehlerkadenz, unbekannten Schreibabschluss und ungültige Grenzen. Die bestehende echte Journal-/Checkpoint-Gruppenregression läuft mit dem erweiterten Versand und prüft die Bereinigung erst nach exaktem SQL-Nachweis.

Nach manueller Installation bleibt nachzuweisen: frische Bestätigungen, nachhaltig sinkende unbestätigte Records **und** Pufferbytes, Ende neuer Aufzeichnungsverluste bei unverändertem Ablaufzähler. Kein versprochener Durchsatz für beliebige Quellenraten, kein Beweis eines realen vollständigen 24-h-Abrufs, keine Wiederherstellung verlorener Daten und keine zusätzlichen Scorepunkte allein durch Veröffentlichung oder Tests.
