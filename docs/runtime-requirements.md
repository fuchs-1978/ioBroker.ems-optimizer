# Laufzeitvoraussetzungen

Der aktuelle Entwicklungsstand setzt Node.js >=22, ioBroker js-controller >=6.0.11 und Admin >=7.8.23 voraus. Die Testmatrix kombiniert Node.js 22, 24 und 26 mit Ubuntu, Windows und macOS. [Testmatrix](../.github/workflows/test-and-release.yml)

Das lokale Aufzeichnungsjournal benötigt ein Dateisystem, das die Synchronisierung vorhandener Dateien und des Journalverzeichnisses bestätigt. Unter Windows steuern die geerbten NTFS-Zugriffsrechte des ioBroker-Instanzverzeichnisses den Zugriff auf die Aufzeichnungen. Unter Linux und macOS setzt der Adapter die Verzeichnisrechte auf `0700`.

Diese Mindestversionen betreffen künftig aus diesem Stand gebaute Adapterpakete. Bereits veröffentlichte Versionstags und Release-Artefakte werden nicht rückwirkend geändert. Betreiber älterer Plattformversionen müssen diese vor Installation eines entsprechenden neuen Pakets aktualisieren.

Die Metadatenänderungen übernehmen die geprüften Vorschläge aus PR #18, #23 und #24. Sie ändern keine EMS-Regelalgorithmen und führen keine Installation oder Aktualisierung der produktiven ioBroker-Plattform aus. Softwaretests ersetzen keine reale Anlagenabnahme.
