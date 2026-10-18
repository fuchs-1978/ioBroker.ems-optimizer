# 0.17.0-alpha.86 – EHZ-Budgetwechsel vor der Ausgabe

## Problem und Korrektur

Am 17.10.2026 um 12:02:41 MESZ wurde ein wartender 2200-W-EHZ-Auftrag nach einer Budgetaenderung abgewiesen. Der Fehlerpfad behandelte dies wie einen Transportfehler und sendete um 12:02:45 einen Nullauftrag. Danach wurden 2800 und 4300 W angefordert. Parallel steigende PV und die Lastdelle begleiteten eine Rueckspeisespitze um 12:02:49. Das belegt einen Mitfaktor, keine vollstaendige kausale Energiezuordnung; im vorausgehenden Abschnitt fehlen 13 Recordsequenzen.

Wenn ausschliesslich das aktuelle positive EHZ-Ziel kleiner als der wartende Auftrag ist, kann die Ausgabe jetzt den auf 100 W abgerundeten kleineren Wert erneut vollstaendig pruefen. Nur bei bestandener zweiter Pruefung wird er gesendet. Der urspruengliche hoehere Auftrag wird nicht ausgegeben. Diagnose, interner letzter Sollwert und Antwortfrist werden auf den tatsaechlich transportierten kleineren Wert nachgefuehrt.

Null/ungueltiges Budget, thermische oder elektrische Sperren, fehlende Quellen und echte Schreibfehler bleiben im bisherigen Fehler-/Stopppfad. Eine kleinere Gesamtleistung ist bei AC-THOR-Stufentopologie nicht automatisch phasenweise sicher; deshalb komplette erneute Pruefung. Bestehende High-Water-Reserven bleiben erhalten, bis unabhaengige Messungen ihre Ruecknahme belegen. Kein automatischer Retry-Zyklus und keine pauschale Reserveloeschung.

## Validierung

Regression des realen Adapter-Wartepfads: 2200 W werden bei Zielwechsel nur als neu gepruefte 1800 W ausgegeben; dieser Test scheitert am unveraenderten alpha.85-Adapter. Weitere Regressionen pruefen abgewiesene Ersatzwerte, Phasen-/LPC-/Temperatur-/Quellensperren, echten Guard-Vorschlag und EHZ-Sollnachfuehrung ohne erfundene Null oder Reservefreigabe. Gesamttests und Paketpruefung vor Veroeffentlichung ausfuehren.

## Reale Nachpruefung

Nach spaeterer bewusster Installation echte Budgetwechsel mit Sollauftrag, tatsaechlichem Transport, drei EHZ-Ausgangsleistungen und SMA-Netzleistung vergleichen. Weniger unnoetige Nullfolgen und Rueckspeisespitzen sind ein zu pruefendes Ziel, kein bereits gemessener Erfolg. Vollstaendige Tagesabnahme und Recorder-Verlustdiagnose bleiben getrennt.

Keine Installation, produktive Konfigurations-/SQL-Aenderung oder Aktorfreigabe. §14a-/Admin-Erweiterung #166 ist nicht Teil dieses gezielten Regelfixes.
