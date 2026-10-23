# 0.17.0-alpha.125 — PV-/Wallbox-Leistung: Wechsel erhalten, Wiederholung nach zehn Minuten

## Verhalten

Carstens Auftrag vom 23.10.2026: Wechsel der PV- und Wallbox-Leistung behalten,
unveränderte Werte nur alle zehn Minuten statt minütlich wiederholen.

Die neue, standardmäßig eingeschaltete Admin-Option `sourcePowerHistoryEnabled`
verwaltet beim Adapterstart ausschließlich die bereits aktivierten SQL-Historien
der konfigurierten PV-Leistungsquelle und WB0-/WB1-/WB2-Leistungsquellen.
Native Zuordnungen haben wie bisher Vorrang vor dem alten JSON-Mapping.

- `changesOnly=true`, `changesRelogInterval=600` Sekunden.
- `changesMinDelta=0`, `blockTime=0`, `debounceTime=0`, altes `debounce=0`.
- Kein Null-/Bereichsfilter; Nullwechsel und kurze positive Leistungsfolgen
  werden durch diese Historienrichtlinie nicht unterdrückt.
- `disableSkippedValueLogging=true` vermeidet zusätzliche unveränderte
  Vorwerte bei einem nachfolgenden Wechsel.

Die aktuell gelesene PV-Historie hatte eine 100-W-Schwelle und 1 s Blockzeit.
Diese Filter entfallen für die genannten Quellen, damit auch kleine Wechsel
zur/von der Null erhalten bleiben. Bei aktiver, schwankender PV können dadurch
mehr Änderungswerte entstehen. Die Reduktion betrifft unveränderte
Wiederholungen; eine pauschale Einsparquote für alle SQL-/Recorderdaten ist
nicht nachgewiesen.

Aufbewahrung, Speicherformat/Präzision, andere SQL-Instanzen und andere Quellen
werden nicht geändert. Ausgeschaltete oder fehlende Historien werden nicht
eingeschaltet. Umgeleitete/aliasierte Quellen, Zähler, nichtnumerische oder
schreibbare Quellen sowie Einheiten außerhalb W/kW bleiben unberührt.
Die PV-Skriptquelle ohne explizite Schreibbarkeitsangabe ist zulässig;
ausdrücklich schreibbare Zustände sind es nicht.

Die Option AUS beendet künftige automatische Verwaltung; sie setzt vorhandene
SQL-Einstellungen nicht auf frühere Werte zurück. Das geschieht bewusst ohne
gespeicherte private Konfigurationskopie oder pauschale Rückmigration.

## Abgrenzung und Diagnose

Keine Änderung an DecisionRecord, Quellenabonnements, Reglerzyklus,
Telemetriefristen, Leistungs-/Phasen-/Freigabebefehlen oder Schutzgrenzen.
Die optionale Einrichtung läuft nach der Ausgangsinitialisierung und blockiert
den Regler nicht. Höchstens vier eindeutige Quellen, nur sequenzielle
SQL-`enableHistory`-Nachrichten, fünf Sekunden Antwortfrist je Schritt, kein
Retry bei unbekanntem Abschluss und keine zusätzliche SQL-Datenabfrage.

`Debug.SourcePowerHistory` dokumentiert je Quelle `configured`,
`already-configured`, `skipped` oder Fehler/Timeout. Ein Erfolg wird erst nach
Rücklesen der persistierten Metadaten gemeldet. Das bestätigt Einstellungen,
keine gespeicherten Messwerte oder durchgehende Gerätefrische. Nach Timeout
werden verbleibende Quellen nicht weiter eingerichtet; späte Antworten dürfen
keinen Erfolg oder neue Aufträge erzeugen. Entladen beendet die Einrichtung.

Ein SQL-Timer darf den letzten Wert wiederholen, auch wenn das Gerät keine
neue Messung geliefert hat. Zehn Minuten Abstand unveränderter SQL-Werte sind
deshalb kein Quellen-/Geräteausfall. Quellenalter, ACK/q, NULL und kurze
Unterbrechungen weiterhin aus echten Quellenbeobachtungen und geeigneten
DecisionRecords beurteilen; unbekannte Abschnitte nicht unbegrenzt fortschreiben.

## Softwareprüfung und spätere reale Abnahme

Regressionen prüfen exakte Begrenzung auf konfigurierte, bereits aktivierte
Quellen, Erhalt von Retention/anderen Instanzen, idempotente Wiederaufnahme,
Legacy-Mapping, SQL-Ablehnung, fehlenden Rückruf, fehlerhaften Readback,
Entladen und nicht blockierenden Adapterstart. Die bisherige strikte Grenze
von `ShadowHistory` bleibt bestehen und wird weiter getestet.

Zusätzlich wurde offline die unveränderte `pushHistory`-Methode aus
ioBroker.sql v4.2.1 (`build/main.js`, Git-Blob
`59093f26a18f86ed123d0a2b6abf28010454570c`) mit der neuen Richtlinie ausgeführt:
kurze PV-Folgen 0 → 30 → 0 W, Wallbox-Folgen 0 → 0,006 → 0 kW,
kleine Leistungsänderungen und NULL-Wechsel blieben erhalten; identische
Werte wurden unterdrückt, der Timer beträgt 600.000 ms.
Das ist eine Softwareverträglichkeitsprüfung ohne Datenbank oder Anlage.

Nach manueller Installation separat nachweisen: laufende/installierte Version,
Status und SQL-Metadaten der vier tatsächlichen Quellen; unveränderte Werte
im regulären Zehn-Minuten-Abstand (initiale SQL-Timer können versetzt starten),
natürliche Nullwechsel/Leistungswechsel mit originaler Zeit und Qualität,
unveränderte Aufbewahrung sowie weiter frische ereignisorientierte Diagnosen.
Es wurde keine Installation, Aktivierung, produktive SQL-Umstellung oder
künstliche Schaltung durch diese Entwicklung durchgeführt. Softwaretests
ersetzen keine reale Betriebsabnahme und ergeben keine Scorepunkte.
