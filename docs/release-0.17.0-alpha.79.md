# 0.17.0-alpha.79

## Ursache und Änderung
Am 14.10.2026 wurden zwei SQL-Rohwerte mit jeweils exakt 65.535 Zeichen gelesen: abgeschnittene Transportbundles mit fehlenden verschachtelten Escape-Zeichen. Diese Werte konnten keinen exakten Speichernachweis liefern. Die konkrete Datenbankspaltendefinition und der Ort der Escape-Entfernung sind nicht direkt geprüft.

Neue Transporte verwenden deflate-raw-base64 in schema-4-Hüllen, einschließlich einzelner Originalrecords. Jede Hülle ist höchstens 60 KiB groß; Dekompression ist auf 2 MiB begrenzt. Originalstrings, Hashes, Ereignisse, NULL/ACK/q, Sitzung und Sequenz bleiben unverändert. Legacy-Frames bis zum bisherigen Limit bleiben lesbar. Nicht transportierbare Originale bleiben lokal erhalten mit Fehlerstatus. Keine Datenbank- oder Anlagenänderung.

## Prüfung und Grenzen
Regressionen simulieren Backslash-Entfernung und TEXT-Abschneidung sowie große Unicode-/NULL-/Qualitätsdaten. Beschädigte Hüllen und Dekompressionsüberschreitung liefern keine Teilbestätigung. Bestehende Journal-/Wiederholungs-/Abfragegrenzen bleiben erhalten.

Vorhandene beschädigte SQL-Werte werden nicht repariert. Nur noch vorhandene lokale Originale können erneut übertragen werden; abgelaufene oder verlorene Records bleiben unbekannt. Reale Abnahme nach manueller Installation: neue SQL-Werte decodierbar, exakte Bestätigungen steigen, Rückstau sinkt ohne unbekannte Verluste. Ein erfolgreicher Softwaretest ersetzt dies nicht. Keine automatische Installation oder Scoreerhöhung.
