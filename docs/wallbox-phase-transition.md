# go-e-Phasenübergang ab alpha.41

## Beobachteter Fehler

Am 07.10.2026 um 10:44:30 Europe/Berlin schrieb der aktive EMS-Phasenfolger für den EQV `phaseSwitchMode=2` mit `ack=false`. Um 10:44:32 behandelte der Ausgang dieses noch nicht zurückgelesene Schreibecho als ungültigen Modus und schrieb Ladefreigabe AUS. Eine normale go-e-Umschaltpause wurde damit zusätzlich zum echten EMS-Stopp. Quellen: produktiver DecisionRecord, Session 1791361414121, Stopptimestamp 1791362672016. Alpha.39 war installiert. Modus 1 bedeutet konfigurierte 1P, Modus 2 konfigurierte 3P; eine Modus-ACK ist keine elektrische Phasenbestätigung.

## Verhalten

- Nur im EMS-Phasenmodus und bei passender offener Anforderung wird ein gültiges `ack=false`-Echo akzeptiert. Ein vorher tatsächlich bestätigter Modus ist erforderlich. Null, falscher Wert, ungültige Qualität oder Zukunftszeit bleiben unbrauchbar.
- Die letzte bestätigte Stellung wird weiter ausgewiesen. Die ursprüngliche Phasenfrist (konfiguriert, bisher 180 s) wird nicht durch neue Echos verlängert. Nach Ablauf bleibt der sichere Stopp erhalten.
- Während des Übergangs werden alte und gewünschte Phasen sowie die kleinere 1P-/3P-Stromgrenze geschützt. Leistungserhöhungen warten auf Bestätigung. Reduktionen und echte Schutzstopps bleiben wirksam.
- Nullleistung bei weiterhin freigegebener go-e ist während des Wechsels eine erwartete Pause. Besitz, aktiver Ladeblock und ursprüngliche Laufzeit bleiben erhalten. Keine neue 600-s-Einschaltverzögerung allein durch diese Pause.
- Die eigenständige Strombefehls-ACK muss weiterhin rechtzeitig eintreffen. Erst nach echter Phasenmodus-ACK beginnt eine frische Rückmeldeprüfung für Strom und elektrische Antwort. Bei 3P müssen alle drei frischen Strommessungen die erwartete Lastaufnahme zeigen; bei 1P müssen L2/L3 elektrisch ruhig sein. Ausbleibende Lastaufnahme bleibt begrenzt/unklar und erhält keine Erfolgsbestätigung.
- Ein tatsächlicher Benutzerfreigabeentzug oder ein nicht erklärter `allow_charging=0` wird nicht als Phasenpause übergangen. Das gelesene Bestandsskript schreibt nur den Phasenmodus.

## Nächste reale Prüfung

Nach manueller Installation bei einem begleiteten Wechsel aufzeichnen: angeforderte Phasen, mode-Schreibecho, echte Modus-ACK, go-e-Freigabe/Stromvorgabe samt ACK, Leistung und L1–L3-Ströme, PhaseSwitchPending/Status, ResponseState, OutputActive/Owned, LastStopAt und StartDelayRemaining_s. Erwartet: kein zusätzlicher EMS-AUS-Befehl/Stoppeintrag durch das passende Echo oder die normale Pause; frische elektrische Bestätigung erst nach realen Quellen. Schutzstopps weiter getrennt dokumentieren. Code-Tests ersetzen keine reale Abnahme.
