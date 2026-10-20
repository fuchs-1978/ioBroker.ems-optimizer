# 0.17.0-alpha.112 — Phasenziel bei Neustart erhalten

## Befund

Am 20.10.2026 lief der EQE vor dem Update dreiphasig. Nach Start von alpha.111 wurde um 09:30:51 Europe/Berlin das EMS-Phasenziel 1P veröffentlicht, während die Wallbox weiterhin 3P bestätigte. Die Wiederübernahme des Auftrags gelang um 09:31:50 mit 6 A; um 09:33:54 folgte der Schutzstopp wegen nach 180 s nicht bestätigter 1P-Umschaltung. Der Ziel-State war nicht historisiert; aktuelle Zeitstempel, Start-/Stopp-Log und Codepfad stützen die Zuordnung. Das vollständige Verhalten des externen Phasenfolgers wurde damit nicht rekonstruiert.

`zeroRealtimeTargets()` setzte bisher bei noch ungültigem Fahrplan neben Watt und Ampere auch die Phasenvorgabe pauschal auf 1P. Der externe Phasenfolger und die Ausgangsprüfung können dies als echten Umschaltauftrag behandeln. Dieser Pfad bestand bereits vor alpha.111; deren gemessener Nachregelversuch wurde nicht als Auslöser nachgewiesen.

## Korrektur und Grenzen

Nur bei aktivem Neustart-Handoff, zuvor eigenem und aktivem Ausgang sowie EMS-Phasenführung bleibt die bisherige gültige Phasenvorgabe unverändert. Auch eine echte laufende Umschaltung behält ihr bisheriges Ziel, statt ungeprüft die Hardwarephase zum neuen Soll zu machen. Ein ungültiges oder fehlendes Ziel wird nicht als gültige 1P-Vorgabe erfunden. Der interne langsame Phasenzielwert folgt dem erhaltenen gültigen Ziel.

Leistungs-/Stromziele bleiben null und die Zuteilung ungültig, bis die reguläre Prüfung neue Freigaben liefert. Hardware-Rückmeldung, konservative Phasenreservierung, ACK-/Umschaltfristen, Quellenqualität und Schutzstopps sind unverändert. Ohne geerbten laufenden EMS-Auftrag bleibt der bisherige Nullpfad bestehen. Keine pauschale Timeout-Löschung oder automatisierte Aktorbetätigung durch diese Entwicklung.

Diese Korrektur verhindert den reproduzierten neuen Fehlauftrag bei laufender Übernahme. Sie ist kein allgemeiner Reparaturmechanismus für eine bereits abgeschaltete Wallbox mit widersprüchlichem Soll/Ist. Dieser bestehende Zustand und der externe Phasenfolger müssen nach Installation lesend erneut geprüft werden.

## Validierung und reale Folgeprüfung

Neue Regressionen für alle drei Wallboxplätze erhalten 3P durch wiederholte Ungültigkeit und halten Watt/Ampere gesperrt. Negativfälle ohne Handoff, Eigentum, Aktivität oder EMS-Phasenführung behalten ihr bisheriges Verhalten. Eine echte 1P-Zielvorgabe bleibt erhalten, ein ungültiges Ziel bleibt ungültig.

Ein integrierter Test benutzt den echten VM-Engine-/Output-Pfad mit dreiphasig geerbtem Auftrag, Neustartinitialisierung und History-Warmup länger als 180 s. Er prüft ausbleibenden künstlichen Phasenwechsel/Phasentimeout und keine OFF-Ausgabe. Drei Platzregressionen und der integrierte Fall scheitern mit unverändertem alpha.111 und bestehen mit der Korrektur. Testmessungen sind kontrollierte Eingaben und keine lückenlose SQL-Rekonstruktion.

Nach Installation bei einer natürlichen laufenden Wiederübernahme Phasenziel, bestätigten go-e-Modus, L1–L3, Freigabe und Zeitstempel gemeinsam prüfen. Kein künstlicher Live-Schaltversuch. Softwaretests und CI ersetzen keine reale Anlagenabnahme; keine zugesagten Scorepunkte oder Energieeinsparungen. 600-s-Stoppverzögerung, Polling, SQL und Bestands-Phasenfolger unverändert.
