# Begleiteter Regelungstest – 0.17.0-alpha.15

Diese Version ist eine Testgrundlage, keine Freigabe für unbeobachteten Betrieb.
Die Prüfungen erfolgen bei unveränderten Messwerten und aktiven Schutzfunktionen.
Keine Hausanschluss-/Temperatur-/Netzbetreiber-Schutzwerte zum Test manipulieren.

## Vorbereitung

1. Bis zum begleiteten Test den bestehenden Skriptbetrieb unverändert lassen.
   Zum Test zuerst die alten Ampere-/Ladefreigabe- und EHZ-Leistungsschreiber
   stoppen, erst danach alpha.15 installieren/starten. Lokale Phasenumschaltung
   nur wie vereinbart separat laufen lassen. Hauptfreigabe zunächst AUS lassen.
   Auch mit Hauptfreigabe AUS kann der Adapter einen früher als EMS-eigen
   gespeicherten Ausgang einmalig abschalten; deshalb keine parallelen Schreiber.
2. `System.Version`, `History.Ready`, `Plan.Valid`, `Plan.LastUpdate`,
   `Control.Valid` und alle benötigten Messwertquellen kontrollieren.
3. Gewünschte vorhandene Wallboxen: `ControlEnabled` und `ProductionArmed`;
   bei mehreren zusätzlich ALPHA-Mehrgerätefreigabe. EHZ-Kombinationsfreigabe
   beibehalten. Erst dann die Hauptfreigabe aktivieren.

## Prüfungen

| Fall | Erwartung | Zu beobachten |
| --- | --- | --- |
| Nur Überschuss, kein ladebereites Fahrzeug | EHZ nimmt nutzbaren Überschuss innerhalb seiner konfigurierten Schritte auf | EHZ Soll/Ist, NVP, Stellgrenze |
| WB wartet auf 120-s-Starttimer | EHZ darf weiterhin Überschuss nutzen | StartDelayRemaining_s, EHZ Ist |
| WB startet, EHZ noch hoch | EHZ senkt Budget sofort; WB wartet nur auf nötige Leistungsabgabe, nicht auf EHZ-Hochlauf | allow, Ampere, EHZ Soll/Ist |
| Kurzer natürlicher PV-Einbruch | WB reduziert auf wirksamen Mindeststrom, keine sofortige Abschaltung | StopDelayActive/Remaining_s, Mindestlaufzeit, LastStopReason |
| Längere Unterdeckung | Nach Ablauf beider noch wirksamen Schutzzeiten regulärer Stopp; keine endlose Timer-Verlängerung | allow=0 bestätigt, OutputOwned=false |
| 50/50 EIN/AUS | Nur Budgetverteilung ändert sich; kein allein dadurch ausgelöstes allow=0 | ParallelDistributionActive, WB/EHZ Soll/Ist |
| Nicht produktiv freigegebene WB priorisiert | Sie erhält kein produktives Budget; freigegebener Verbraucher bleibt nutzbar | SelectedWallbox, Targets, OutputStatus |
| Mehrere ladebereite Autos | Immer nur eine reale Ladefreigabe; nächste erst nach bestätigtem AUS | alle allow-/OutputOwned-Zustände |
| Mindest-SoC angehoben | Pflichtladung darf Netzstrom verwenden | MustCharge, MinimumSoC, aktueller SoC |
| Mindest-SoC erreicht | Keine Pflichtladung allein wegen alter socfrei=2-Meldung | MustCharge, RequestedMinimumCurrent_A |
| Normaler Adapterneustart beim Laden | Nur zuvor EMS-eigene Ladung darf mit frischen Daten übernommen werden | RestartHandoffActive, LastStopReason |
| Hauptfreigabe AUS | Kontrollierter einmaliger Stopp; keine positive Ausgabe danach | alle OutputOwned=false, EHZ OutputOwned=false |

## Rückgabe an Skripte

Hauptfreigabe deaktivieren, speichern und die tatsächliche Freigabe aller
EMS-Ausgänge abwarten. Erst wenn die Wallbox- und EHZ-`OutputOwned`-Zustände
false sind und keine neue EMS-Ausgabe erfolgt, die bisherigen Skripte starten.
Ein unveränderter alter `OutputLastWrite`-Zeitpunkt allein beweist keine
abgeschlossene Rückgabe. Bei unbestätigtem Stopp nicht parallel übernehmen,
sondern Verbindung/Fehlerdiagnose prüfen.
Bei sehr frühem Startabbruch oder nicht erreichbarer Datenbank kann die
automatische Abschaltung nicht bestätigt werden. Dann den tatsächlichen
Gerätezustand prüfen und nötigenfalls vor Ort abschalten.

## Grenzen der Prüfung

Automatisierte Tests simulieren Zustandswechsel, Rückmeldeverzögerungen,
Leistungsrampen, Sicherheitsstopps und Neustarts. Reales WLAN-/Modbus-Timing,
die tatsächliche AC-THOR-Kennlinie und die externe Phasenumschaltung müssen
im begleiteten Betrieb zusätzlich bestätigt werden. Ein Kaltstart wartet
weiterhin auf einen gültigen Fahrplan nach dem Historienaufbau.
