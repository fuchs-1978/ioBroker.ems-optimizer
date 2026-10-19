# Alpha.101 — bestätigte Fahrzeugantwort bei nachlaufender Zuteilung halten

## Betriebsbefund

SMA-Einspeisehistorie 19.10.2026, 12:30–13:00 MESZ: 335 Messpunkte, näherungsweise 588 Wh Einspeisung, zeitgewichtetes Mittel 1179 W, Spitze 5013 W, etwa 15,09 Minuten mindestens 1 kW. Integration mit fortgeschriebenem letztem Wert, nur Intervalle bis 30 Sekunden; größte Messlücke 12,995 Sekunden, 4,128 Sekunden am Fensterrand ohne Anfangswert. Dies ist eingespeiste Energie, keine nachgewiesene vollständig vermeidbare Energie. Das Fenster enthält den Versionswechsel zu Alpha.100.

Begrenzter Originalabruf 13:00–13:02: 80 SQL-Transportzeilen, 1152 dekodierte Originalereignisse. 199 Ereignisse vor dem ersten verfügbaren Vollsnapshot bleiben für vollständige Zustandsrekonstruktion unbekannt; 953 sind danach rekonstruierbar. Zusätzlich 26 fehlende Sequenzen in fünf Lücken zwischen 13:00:14.622 und 13:00:19.485; dies ist die zeitliche Einordnung der Lücken, keine Behauptung einer durchgehend unbeobachteten Zeitspanne. Die beiden verwendeten Rücknahmefälle liegen danach. Sitzung 1792406488181, Alpha.100:

- Sequenz 10846, 13:00:58.221: 12 auf 11 A trotz 2680 W Ladeleistung und 794,2 W Einspeisung. Zuteilungsmessung 1920 W, neueste Wallboxantwort 2680 W; live 3474,2 W verfügbar.
- Sequenz 10985, 13:01:14.176: 14 auf 11 A trotz 3200 W Ladeleistung und 271,5 W Einspeisung. Zuteilungsmessung 2680 W; live 3471,5 W verfügbar. Die nominalen 3220 W für 14 A waren weiterhin reserviert und gedeckt.
- Sequenz 10402, 13:00:16.119: echter Netzbezug 1244,6 W; diese Absenkung darf nicht durch die Korrektur unterdrückt werden.

## Änderung und Grenzen

Nur einen bestehenden bestätigten Strom halten, wenn die neuesten frischen Strom-/Leistungsmessungen das aktuelle Niveau nachweisen und neuer als die Messbasis der zugeordneten gültigen Zuteilung sind. Deren Zeitstempel muss zur aktuellen Zuteilung passen. Der gehaltene Strom bleibt vollständig in der bestehenden eigenen Reserve und innerhalb des aktuellen realen Budgets sowie aller Geräte-/Haus-/Betreibergrenzen. Keine neue Stromerhöhung, kein neuer Start und keine neue Frist.

Nicht im Tarif-/Schatten-/Phasenübergang und nicht während offener Befehle oder elektrischer Antwort. Keine geplante zusätzliche Peer- oder Heizleistung zulassen, die durch bestehende reale Reserven nicht abgedeckt ist. Sobald die Zuteilung die neueste Messung berücksichtigt, gilt ihr gewöhnlicher Sollwert wieder. Diagnosebasis im vorhandenen IncreaseBudget_JSON: fresh-response-allocation-hold.

## Nutzen und Abnahme

Der zweite Fall vermeidet vorübergehend eine unnötige nominale Rücknahme um 3 A, entsprechend etwa 690 W einphasig. Wie lange diese zusätzliche Leistung im geänderten Betrieb tatsächlich aufgenommen wird, muss real gemessen werden; kein belastbarer Wh-Gewinn für die ganze halbe Stunde ableitbar. Die 588 Wh sind eine beobachtete Einspeisemenge und keine Einsparzusage.

Bestehende go-e-Konfiguration: serverInterval 15 Sekunden, ampUpdateInterval 5 Sekunden. Laut Adapterquelltext steuert serverInterval den Statusabruf, ampUpdateInterval die Leistungsbefehlsbegrenzung. Kürzere Statusabfragen können den Versatz verkürzen, ersetzen jedoch keine korrekte Verarbeitung asynchroner Quellen; keine produktive Intervalländerung und kein Lasttest durchgeführt.

Regression: ursprünglicher 14-auf-11-A-Fall scheitert mit Alpha.100 und besteht mit Alpha.101. Negative Fälle: aktualisierte Messbasis, echtes Defizit, harte Grenze, zurückgezogene Freigabe/Reserve, fehlende Provenienz und neue Heiz-/Peerlastzusage. Reale Abnahme: nach Installation bestätigte Ladung ohne die belegten Rücknahmen; NVP-Wh und Datenlücken separat messen. Netzwerkstörungen und das gesamte verbleibende Einspeisepotenzial bleiben unabhängig offen.
