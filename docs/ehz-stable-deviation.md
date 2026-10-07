# EHZ: stabile positive Leistungsabweichung

## Beobachtung und Grenze der Diagnose

07.10.2026 ca. 09:34–09:36 Europe/Berlin, installiert alpha.38 (96bfd9e0a176728b6d33c51463dabf4d7fe9cbc5), Master EIN: Befehl 3394 W, gültige frische Ausgangssumme 3729–3745 W, zweiter Ausgang etwa 3304–3316 W, während rund 3,3–4,7 kW eingespeist wurden. Die 300-W-Toleranz wurde überschritten; der Befehl blieb über 205 Sekunden gleich. Dies sind mehrere Snapshots, kein vollständiger historischer Export und keine durchgehende Abnahme. Das Schreibregister 1000 ist nicht gepollt; sein null-Lesewert ist keine Transportfehlerdiagnose. Keine Modbus-Warnung im abgefragten Fenster. Geräteskalierung, feste Stufen und mögliche fremde Schreiber sind weiter zu prüfen; die physische Ursache ist nicht bewiesen.

## Änderung und Reproduktion

Der Test reproduziert 3394 W Soll, 428/3316/0 W Ist und frische Messsätze im 5-s-Abstand. Erst nach mindestens drei neuen Messsätzen über 15 s darf ein gewöhnlicher Rampenschritt erfolgen. Neue Befehle starten den Nachweis neu. Die normale Stellbestätigung bleibt separat und wird nicht aus der Offset-Toleranz abgeleitet. Negative, große, schwankende oder ungültige Abweichungen autorisieren keine Erhöhung. Reduktion, Master AUS, Sensorfehler und Schutzbegrenzungen behalten Vorrang.

## Nach Installation manuell beobachten

- Befehls-/Rückmeldekette samt ts, ACK, q, drei Ausgangsleistungen, Netzwert und Temperatur gemeinsam lesen. Kein Erfolg aus aktuellen Snapshots rückdatieren.
- Bei begrenzter stabiler positiver Abweichung muss ControlReason die Wiederaufnahme ausdrücklich nennen; OutputCommand_W darf nur in normaler Schrittgröße und innerhalb aller aktuellen Caps steigen. ActuatorSettled bleibt eine eigene Prüfung.
- Einspeisung sollte durch reale zusätzliche Heizleistung sinken; ausbleibende Antwort, Schwingungen oder Grenzverletzungen untersuchen. Geräteabweichung nicht als behoben behaupten.
- Bei Netzbezug, niedrigerem Budget, Temperaturgrenze, Hausanschluss-/§14a-Limit oder Master AUS weiterhin unverzügliche Reduktion bzw. Stopps gemäß Schutzpfad prüfen. Softwaretests ersetzen diese reale Abnahme nicht.

Keine ioBroker-, SQL-, Skript- oder Aktoränderungen durch diesen Entwicklungsauftrag.
