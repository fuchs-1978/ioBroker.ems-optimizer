# Änderungen aus Issues #57–#60 in 0.17.0-alpha.20

Die Auswertungen vom 22. und 26. September 2026 zeigten stabile reale
Skript-Ladeblöcke und mehrere Lücken in der EMS-Vorschau. Weil der Master AUS
war, belegen diese Messungen keine bestandene EMS-Liveabnahme. Die am 22.09.
bewusst angehobenen Mindest-SoC-Werte waren eine gewollte manuelle Vorgabe.

## Fahrplan für mehrere Fahrzeuge (#59)

Ein reproduzierter Fehler ließ einen kleinen Restladebedarf des ersten Autos
stehen: War er kleiner als die Energie einer ganzen Viertelstunde bei
Mindeststrom, wurde er auf null Leistung begrenzt, blieb aber als offener Bedarf
erhalten. Alle nachfolgenden Autos konnten dadurch leer ausgehen.

Die Schlussladung darf jetzt entsprechend kürzer dauern. Der Fahrplan zeigt
die durchschnittliche Slotleistung, `currentA` und `chargingMinutes` beschreiben
den Mindeststrom während der tatsächlichen Ladezeit. Es bleibt bei höchstens
einem Fahrzeug pro Slot; die nächste Wallbox nutzt frühestens den nächsten Slot.
Numerische Rundungsreste blockieren die Reihenfolge nicht mehr.

Mindest-SoC, Pflichtladung, Priorität und innerhalb der Prognose eintretende
Abfahrtsfristen fließen in die Reihenfolge ein. Ein im Plan erreichtes
Mindest-SoC verliert seinen Dringlichkeitsbonus. Die aktuelle Echtzeitauswahl
bleibt eine getrennte Ausgangssperre und sperrt keine zukünftigen Slots.

`Plan.WallboxStatus_JSON` ergänzt je Fahrzeug:

| Feld | Bedeutung |
| --- | --- |
| `planningStatus` | `complete`, `partial`, `no-window`, `ineligible` oder `unknown-demand` |
| `planningReason` | Grund für diese Planung |
| `plannedEnergyKWh`, `remainingEnergyKWh` | Eingeplante und noch offene Fahrzeugenergie nach Ladewirkungsgrad |
| `firstPlannedTimestamp`, `lastPlannedTimestamp` | Erste/letzte zugeordnete Viertelstunde |

Bei unbekanntem SoC wird kein bekannter Abschluss erfunden. Ein fehlender
Ladeslot wird nicht mit „aktuell andere Wallbox gewählt“ verwechselt.

## Sekündliche Speicherregelung (#58)

Ein gemeinsamer Sekundentakt berechnet erst den Bedarf aus frischen
Netzmessungen und ruft danach den Speicher-Ausgang auf. Der zehnsekündliche
Beobachterwert wird nicht als aktuelle Netzleistung wiederverwendet.
Auch im Betrieb ohne Speicher wird die reale EHZ-Leistung unmittelbar aus
den drei gültigen Phasenmessungen gelesen. Ein alter Beobachterwert kann daher
einen gerade hochgefahrenen EHZ nicht als fremde Hauslast erscheinen lassen
und dessen Sollwert oder den Wallbox-Startcountdown unnötig zurücksetzen.

`Battery control cycle` im Admin erlaubt jetzt 1 s und verwendet dies als
Standard. Beim Update von alpha.19 oder älter innerhalb 0.17 werden bisherige
2 s einmalig auf 1 s umgestellt und im Admin gespeichert. Andere selbst
eingestellte Intervalle sowie spätere Änderungen bleiben erhalten. Das Speichern
erfolgt erst nach der sicheren Ausgangsinitialisierung und kann einen weiteren
Adapterneustart auslösen. Ein Speicherfehler verhindert die Ausgangssicherung
nicht und erscheint im Log.

Auch ein unveränderter GS-Sollwert wird zyklisch aufgefrischt, sobald der
vorherige Auftrag übertragen und physisch bestätigt wurde. Langsamere
Geräterückmeldungen begrenzen daher die tatsächlich mögliche Schreibfrequenz.
Ein offener Auftrag wird weder gestapelt noch durch Wiederholungen seiner
Rückmeldefrist entzogen. Vorzeichen, SoC-Grenzen, Reservierungen, Master und
Gerätefreigaben bleiben wirksam.

Der Speicher arbeitet in kleinen Schritten; die EHZ-Ausgänge behalten ihren
eigenen Takt, die Wallboxen ihre Ampere-Rampen und Haltezeiten. Bei deaktiviertem
oder nicht verfügbarem Speicher bleibt der EHZ für die schnelle Nachführung
zuständig.

## Phasenkoordination und Ladeunterbrechungen (#57/#60)

Bei aktivierter dynamischer Phasenumschaltung gibt es im Admin je Wallbox eine
ausdrückliche Auswahl:

| Betriebsart | Verantwortung |
| --- | --- |
| `script` – neuer Standard | Das vorhandene Skript entscheidet den Phasenwechsel. EMS-Budget und EHZ-Verteilung verwenden die bestätigte go-e-Phase. |
| `ems` | Ein externes Skript übernimmt `Control.Targets.WallboxN_Phases`. Der EMS-Ausgang wartet auf passende echte go-e-Bestätigung. |
| Phasenumschaltung deaktiviert | Bestehende feste Topologie. |

**Upgradeänderung:** Die bisher implizite Erwartung, dass ein externes Skript
dem EMS-Phasensoll folgt, ist jetzt eine ausdrückliche Auswahl. Für die in #57
geprüften eigenständig entscheidenden Phasenskripte ist `script` passend.
Ein bereits an EMS-Sollwerte gekoppeltes Skript benötigt ausdrücklich `ems`.
Keine dieser Einstellungen schreibt selbst einen Phasenbefehl an die Hardware.

Im EMS-Modus gilt folgende Schnittstelle für ein externes Phasenskript:

1. Nur bei real freigegebenem Master, gültigen frischen EMS-Daten und passender
   Wallbox-/Reglerfreigabe das stabilisierte `Control.Targets.WallboxN_Phases`
   als Wunsch übernehmen. Schattenziele sind niemals Hardwarebefehle.
2. Eigene Geräteschutz-, Stillstands- und Schaltbedingungen ausführen. Dabei
   darf kein zweiter Regler gleichzeitig Ladestrom/Freigabe schreiben.
3. Der Adapter liest den konfigurierten echten go-e-Phasenmodus: `1` bedeutet
   1P, `2` bedeutet 3P. Eine Echo-Schreibbestätigung des Wunschwerts ersetzt
   keine Gerätemeldung. Fehlende/ungültige Rückmeldung sperrt.

`Maximum wait for external phase confirmation` begrenzt die Wartezeit
standardmäßig auf 180 s (30–900 s). Bei ausbleibender Bestätigung stoppt ein
EMS-eigener Ausgang und bleibt bis zur echten Bestätigung oder Rücknahme der
Phasenanforderung gesperrt. Diese Sicherheitsfrist kann eine Mindestlaufzeit
beenden. Die Ausschaltbestätigung bleibt Voraussetzung für die nächste Wallbox.

Während des Wartens kann ein Strom sinken, aber nicht steigen. Ein fehlendes
Leistungsbudget wird nicht durch einen künstlichen Halteauftrag verdeckt:
Mindestlaufzeit und Abschaltverzögerung laufen normal, harte Schutzgrenzen wirken
sofort. Diagnose unter `Devices.WallboxN`:
`PhaseControlMode`, `PhaseSwitchPending`, `PhaseSwitchElapsed_s`,
`PhaseSwitchRemaining_s`, `PhaseSwitchTimedOut`, `PhaseSwitchStatus`.

## Schattenmodell und SQL (#57/#60)

`Targets` bleibt der angeforderte Bedarf. `Modeled.WallboxN_*` zeigt zusätzlich
den Ablauf des produktiven Wallbox-Ausgangs in einer privaten Umgebung:
Startsequenz, virtuelle Befehlsbestätigung, Stromrampe, Mindestlaufzeit,
Abschaltverzögerung, Phasenwarten und Sequenzsperre. `Actuals` und `realFeedback`
bleiben echte Messungen. Die Modellannahme wird im Snapshot benannt.

Frische PV-Werte eines Skripts dürfen `ack=false` tragen. Qualitätsfehler,
fehlende Werte und veraltete Zeitstempel bleiben ungültig; für
Aktorrückmeldungen gelten weiterhin die strengen Bestätigungsregeln.

Der SQL-Befund mit 84 ms aus #60 beweist keine physische Abschaltung. Die
genaue historische Ursache ist nicht abschließend belegt. Künftig liefert
`Debug.Shadow.DecisionRecord` einen zusammengehörigen Datensatz mit eigener
Zyklusnummer und Zeitpunkt, angefordertem und modelliertem Ausgang sowie realen
Rückmeldungen mit Quellzeitpunkten. SQL erzeugt dafür keine künstlichen
Wiederholungen. Der Adapter schreibt Zustandswechsel und einen eigenen
60-Sekunden-Lebensnachweis. Bei Master EIN bleibt das Modell ungültig/pausiert;
die realen Wallbox-Rückmeldungen werden im Datensatz weiter erfasst.
Eine begrenzte Warteschlange erhält die Reihenfolge auch bei langsamen
Schreibzugriffen. Überlauf und Schreibfehler werden gezählt; Datensatznummer und
Adapterlaufzeit markieren Lücken ausdrücklich statt Ereignisse unbemerkt
zusammenzufassen.

Soll- und Modellausgangswechsel haben keine 10-s-Sperre mehr. Kontinuierliche
Istleistung und Countdownwerte bleiben gedrosselt. Die Einzelreihen sind keine
atomare Datenbankzeile; für Start-/Stopp-Auswertungen den zusammengehörigen
Datensatz, seine Gültigkeit und echte Rückmeldungen heranziehen. Der größere
`Snapshot_JSON` und Debug-Ringspeicher werden nicht zusätzlich historisiert.
SQL-Aufbewahrung weiterhin 86.400 s; kein versprochener Wochen-Rohdatensatz.

## Prüfungen und noch nötige Liveabnahme

Abschlussprüfung: **547/547 Tests bestanden**, zusätzlich gültige
Paket-/Admin-Metadaten, `git diff --check` und Paketinhalt geprüft.

Automatisierte Regressionen umfassen zwei/drei Fahrzeuge über 192 Slots,
knappe PV, Teil-Slots, Prioritätswechsel, Plan-/Chart-Bilanz, sekündliche
Speicherschritte, konstante GS-Auffrischung, fehlende Rückmeldung, Master AUS,
Phasen-Timeout, Leistungsabfall während des Wartens, Mindestlaufzeit,
Abschaltverzögerung, EHZ-Übernahme und die Trennung echter und virtueller Werte.

Die Tests ersetzen nicht die noch offene begleitete Liveabnahme aus #57/#60:

- Nach Installation Version, Admin-Phasenmodus, Sekundenzyklus und
  `Debug.Shadow.SQL.Status` prüfen; anschließend Schattenmodell beobachten.
- Im begleiteten EMS-Test kurze/lange PV-Dellen, echtes Ladeende,
  Freigabeentzug und Wechsel zur nächsten Wallbox unterscheiden.
- Externe Phasenumschaltung samt echter Bestätigung unter Lastbedingungen
  prüfen; im EMS-Modus muss das externe Skript die oben beschriebene
  Schnittstelle tatsächlich unterstützen.
- Speicher, zweiter my-PV und WP erst bei ihrer realen Einbindung beurteilen.
  Die unveränderten Kühl-, Temperatur- und SoC-Sperren gemeinsam prüfen.

Die bestehende Skriptladung, einschließlich gewollter Mindest-SoC-Pflichtladung,
wird durch reine Schattenbeobachtung nicht umgeschaltet. Es wurden bei dieser
Umsetzung keine laufenden ioBroker-Skripte oder Ausgangsfreigaben verändert.
