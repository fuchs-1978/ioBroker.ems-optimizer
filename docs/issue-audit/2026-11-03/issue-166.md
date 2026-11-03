# Issue #166 – §14a/LPC: Netzbezugsbudget statt Bruttoverbrauch begrenzen und Eigenstrom berücksichtigen

Historischer Originalstand vor der Aufgabenbereinigung am 2026-11-03. Quelle: https://github.com/fuchs-1978/ioBroker.ems-optimizer/issues/166. Letzte Issue-Änderung: 2026-10-28T19:28:10Z. Dieser Snapshot ist ein Archiv, keine aktuelle Aufgabenliste. Aktueller Stand: [Roadmap #36](https://github.com/fuchs-1978/ioBroker.ems-optimizer/issues/36).

## Ursprünglicher Issue-Text

<!-- issue-audit-20261028 -->
## Tatsächlich implementierter Umfang und Rest – 28.10.2026

Die untenstehende Einordnung vom19.10. ist durch weitere Entwicklung überholt:

- [x] Teilnehmer-/GZF-/Budgetquellen und Admin-Einrichtung seit alpha.90 vorhanden.
- [x] Gruppen-Netz-/Eigenstrombilanz als unabhängiger Kern seit alpha.116 und produktiv mit gemeinsamer Zuteilung/Ausgangsprüfung verbunden seit alpha.117.
- [x] Konservativer Bruttorückfall ohne Eigenstrombonus bei zeitversetzten ansonsten gültigen Quellen seit alpha.118. Zeitversetzte Summen sind kein synchroner Eigenstromnachweis.
- [x] Kompatibilität: legacyGross bleibt Standard; keine automatische neue Messgrenze, Teilnehmerfreigabe oder Limitanhebung.
- [ ] LPC-Vertrag/Endpunkt-/Gruppenzuordnung und darauf abgestimmte Integration. Jede konfigurierte LPC-Quelle sperrt den neuen groupNet-Modus weiterhin bewusst.
- [ ] Tatsächliche physische Mess-/Teilnehmerzuordnung und natürliche aktive §14a-Betriebsketten mit Quellenqualität, Reserven, ACK/elektrischer Wirkung und Schutz getrennt abnehmen.

Belege am geprüften main95fdc1e: [Runtime-Vertrag](https://github.com/fuchs-1978/ioBroker.ems-optimizer/blob/95fdc1e7ca8e902a668fbcd43e500270bca21e3c/docs/issue166-runtime-integration.md), [alpha.117](https://github.com/fuchs-1978/ioBroker.ems-optimizer/blob/95fdc1e7ca8e902a668fbcd43e500270bca21e3c/docs/release-0.17.0-alpha.117.md), [alpha.118](https://github.com/fuchs-1978/ioBroker.ems-optimizer/blob/95fdc1e7ca8e902a668fbcd43e500270bca21e3c/docs/release-0.17.0-alpha.118.md). Kein erneuter Entwicklungsauftrag für die bereits vorhandene Binärkontakt-Bilanz; Issue bleibt für LPC und reale Abnahme offen. Kein neues Rechts-/Normgutachten, keine Konfigurationsänderung.

---

## Teilumsetzung und verbleibende Entwicklung – 19.10.2026

Bleibt offen. Seit alpha.90 sind eigener Admin-Reiter, explizite Teilnehmer/GZF-Berechnung und Budgetquellen teilweise umgesetzt. Diese vorhandenen Funktionen wiederverwenden; nicht erneut zur Entwicklung beauftragen. Verbleibender Hauptumfang: tatsächliche Eigenstrom-/Netzbezugsbilanz der definierten Teilnehmergruppe mit eindeutigen Messgrenzen, ohne doppelte Erzeugungsgutschrift, samt Schutz-/Qualitäts-/Reservierungsverträgen und kompatibler Migration. Reale aktive §14a-/LPC-Abnahme separat offen; angezeigtes Festbudget ohne aktives Signal ist kein Test.

Aktuellen Code und offizielle Vorgaben vor einer späteren Implementierung erneut prüfen. Diese Issue-Bereinigung selbst ändert keinen Code und keine Anlage.

---

## Ziel

Ich möchte, dass das EMS ein aktives §14a-/LPC-Limit als zulässigen netzwirksamen Bezug der zugeordneten steuerbaren Verbrauchseinrichtungen behandelt. Die bisherige konservative Bruttobegrenzung soll in einer kommenden Version um eine belastbare Eigenstrombilanz erweitert werden.

## Geprüfter Ausgangspunkt

Am 16.10.2026 wurde alpha.83 / Commit `7bf79b285f54f7cd21b15c5a9fceb4421390050c` geprüft. Die bisherige Budgetierung ist konservativ brutto ausgelegt. Binärkontakt-Festlimit und LPC-Limit sind bereits vorgesehen; bei gleichzeitig aktiven Limits gilt das kleinere. Die produktive Konfiguration wird durch dieses Issue nicht geändert.

## Gewünschtes Verhalten

- Festlimit des Binärkontakts und empfangenes LPC-Limit gleichermaßen als Netzbezugsbudget der jeweils zugeordneten §14a-Teilnehmergruppe auswerten.
- Nachweislich verfügbarer Eigenstrom darf zusätzliche Verbraucherleistung ermöglichen. Beispiel: 4.200 W Netzbudget plus 3.000 W tatsächlich verfügbarer PV-Überschuss für diese Gruppe ergeben bis zu 7.200 W Verbraucherleistung, sofern sonstige Grenzen eingehalten werden.
- Normalen Haushaltsverbrauch und nicht teilnehmende Verbraucher korrekt separat bilanzieren. Keine pauschale Begrenzung des gesamten Hausanschlussbezugs auf das §14a-Budget.
- Eigenstrom nach Abzug anderer tatsächlicher Verbräuche bestimmen; bereits in SMA-NVP-Leistung enthaltene PV/BHKW-/Speicherbeiträge nicht doppelt gutschreiben. Speicherladung/-entladung und unterschiedliche Messumfänge ausdrücklich modellieren; unbekannte Beiträge nicht als freies Budget annehmen.
- Teilnehmergruppe und Messumfang explizit zuordnen. WP einschließlich relevanter Zusatzverbraucher korrekt erfassen; eigenständige Heizstäbe nicht pauschal als zusätzliche §14a-Einrichtung zählen.
- Bei sinkender Erzeugung, Lastsprüngen, Quellenversatz, ungültigen Daten und ausstehenden Stellwirkungen das zulässige Budget sicher einhalten; bestehende ACK-/Antwort-/Reservierungsverträge erhalten.
- Hausanschluss-, Phasen-, Geräte- und sonstige Schutzgrenzen bleiben zusätzlich wirksam. SoC-Mindestladung und Preisladung dürfen Limits nicht übersteuern.
- Ein bereits als Gesamtbudget empfangenes LPC-Limit nicht nochmals mit einem Gleichzeitigkeitsfaktor erhöhen. Automatische EMS-Mindestleistungsberechnung für den Binärkontakt ist ein getrennt zu klärender Umfang; abgestimmte Teilnehmerzahl und Netzbetreibervorgaben erforderlich.
- Diagnose soll Netzbudget, belegten Eigenstromanteil, daraus resultierendes Bruttobudget, tatsächlichen Bezug der Gruppe und begrenzendes Kriterium getrennt zeigen.

## Nachweise und Abnahme

Vor Umsetzung aktuellen Code, #8, #25, #7 und bestehende Budgettests prüfen; bereits vorhandene Funktionen wiederverwenden. Reale Ursache und Bilanzgrenzen vor Änderungen reproduzieren.

Regressionen für: ohne PV, PV-Überschuss, PV unter Hauslast, schnelle PV-Abnahme, mehrere Wallboxen, WP/Zusatzheizung, Speicherladung/-entladung, gleichzeitiger Binärkontakt/LPC, ungültige/veraltete Quellen und verzögerte Geräteantwort. Prüfen, dass Eigenstrom nicht mehrfach vergeben und Haushaltsverbrauch nicht unzulässig dem §14a-Teilbudget zugerechnet wird. Unbekannte Messungen dürfen keine positive Freigabe erzeugen.

Softwaretests und reale begleitete Abnahme getrennt dokumentieren. Keine Erfolgsaussage allein aus Installation oder Simulation.

## Offizielle Grundlage

Bundesnetzagentur: https://www.bundesnetzagentur.de/DE/Vportal/Energie/SteuerbareVBE/artikel.html

Anlage 1 zu BK6-22-300, insbesondere EMS-Steuerung und Mindestleistung: https://www.bundesnetzagentur.de/DE/Beschlusskammern/1_GZ/BK6-GZ/2022/BK6-22-300/Beschluss/BK6-22-300_Beschluss_Anlage1.pdf?__blob=publicationFile&v=1

Aktuelle offizielle Vorgaben und relevante Netzbetreiber-/Schnittstellenverträge vor Implementierung erneut prüfen.

## Admin-Erweiterung und Umsetzung in der nächsten Version (Auftrag 18.10.2026)

Ich beauftrage die Umsetzung dieses Issues einschließlich der folgenden Admin-Erweiterung in der nächsten Adapterversion. Dies ersetzt die frühere reine Vormerkung vom 16.10.; keine automatische Installation oder Änderung meiner produktiven Einstellungen.

- Auswahl der Budgetquelle: festes gemeinsames Netzbezugsbudget beim Binärkontakt, berechnetes EMS-Budget anhand expliziter Teilnehmergruppe oder externes Gesamtbudget über LPC.
- Festbudget in Watt konfigurierbar; Zustand und Leistungsgrenze extern als getrennte Datenpunkte zuordnen. Aktives/inaktives/ungültiges Signal, Einheit und Quellenqualität ausdrücklich behandeln.
- Berechnungshilfe mit Teilnehmerzuordnung und benötigten elektrischen Anschlussleistungen. Offizielle GZF-Tabelle als sichtbare Standardwerte hinterlegen; vor Umsetzung aktuellen offiziellen Stand prüfen. Faktorüberschreibungen nur in erweiterten Einstellungen, validiert und als Abweichung gekennzeichnet.
- Teilnehmerzahl aus der konfigurierten Gruppe, niemals aus aktuell ladenden/angeschlossenen Fahrzeugen ableiten. Zusammenfassung von WP/Klimageräten und Sonderregel oberhalb 11 kW elektrischer Netzanschlussleistung berücksichtigen. Keine thermische Nennleistung verwenden.
- Berechnungsergebnis mit Formel, Faktoren, Teilnehmern und Herkunft transparent anzeigen. Konfigurierter Einsatz muss der mit dem Netzbetreiber abgestimmten Gruppe entsprechen; Vorschlag ist kein Anmeldenachweis.
- Extern empfangenes LPC-Gesamtbudget direkt übernehmen, nicht erneut mit GZF hochrechnen.
- Gleichzeitige Grenzen nur bei passender Gruppen-/Messumfangszuordnung kombinieren; kleinere wirksame Grenze transparent darstellen. Ein alter 4200-W-Fallback darf eine andere Teilnehmergruppe nicht stillschweigend falsch abbilden.
- Netzbudget, tatsächlichen netzwirksamen Bezug und zusätzlich nutzbaren Eigenstrom getrennt ausweisen; Hauptumfang dieses Issues bleibt erhalten.
- Bestehende Konfiguration kompatibel migrieren: keine automatische Erhöhung des bisherigen Limits und keine automatische Aktivierung neuer Quellen oder Teilnehmer.

### Fertigstellung

Aktuellen main-/Release-/Installationsstand sowie parallele Arbeiten vor Umsetzung erneut prüfen. Die datierte alpha.83-Codeprüfung oben ist kein aktueller Installationsnachweis; zuletzt am 17.10. alpha.84 gelesen.

Änderung mit passenden Regressionen einschließlich GZF-Berechnung, Sonderfällen, externer Budgetübernahme ohne Doppelberechnung, Migration, Teilnehmerzuordnung und Eigenstrombilanz testen. Admin-Hilfe/README, Manifeste und Versionsanzeigen konsistent aktualisieren. Als nachvollziehbaren PR dokumentieren, nach bestandenen relevanten Prüfungen in main übernehmen und mit Versionstag und GitHub-Release veröffentlichen. Aktuellen Versionsstand vor Veröffentlichung erneut prüfen; keine Versionsnummer vorab reservieren.

Tests, verbleibende Grenzen sowie PR-, Commit- und Release-Link dokumentieren. Reale §14a-/LPC-Abnahme bleibt getrennt. Keine automatische Installation, produktive Konfigurationsänderung oder Aktorbetätigung.


