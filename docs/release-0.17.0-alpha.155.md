# 0.17.0-alpha.155 – SoC behalten und nicht ladende Fahrzeuge pausieren

Der Mii hatte einen bestaetigten Fahrzeugbericht mit 84 %, den das EMS nach exakt zwei Stunden als ungueltig und mit 0 % ausgab. Beim EQE waren Freigabe und 6 A bestaetigt, die frischen Leistungsmessungen blieben jedoch bei null. Ein solcher Auftrag konnte seine Leistung weiter reservieren, ohne sie zu nutzen. Diese Version baut auf alpha.154 auf.

## Fahrzeug-SoC

Ein plausibler bestaetigter Fahrzeugbericht zwischen 0 und 100 % bleibt fuer Ziel-SoC, Mindestladung und Planung verwendbar, auch wenn das Fahrzeug oder der Cloud-Adapter laenger nichts meldet. Das Original wird nicht neu geschrieben oder kuenstlich verjuengt. `Vehicles.WallboxN.SoCStale`, `SoCAge_s`, `SoCReportedAt` und `SoCStatus` zeigen Alter und Herkunft. Die bisherige Zwei-Stunden-Grenze kennzeichnet nun Alter statt Ladeberechtigung.

Die vorhandene Energieinterpolation hat weiterhin begrenzte, gepruefte Messgrundlagen. Beim Ablauf der Interpolationsbasis bleibt ein bereits ermittelter SoC fuer denselben unveraenderten Bericht erhalten; es wird keine weitere Energie erfunden. Ein neuer, auch niedrigerer Fahrzeugbericht ersetzt den alten Wert. Fehlende Werte, schlechte Qualitaet, ack=false, unplausible Zahlen und zukuenftige Zeitstempel bleiben ungueltig und werden als `null` statt 0 % ausgegeben. Ein wirklich gemeldeter gueltiger Wert 0 % bleibt 0 %.

Der letzte bekannte Wert ist kein Nachweis des aktuellen Fahrzeugzustands nach einer Fahrt. Die bewusst gewaehlte Betriebsregel verwendet ihn bis zum naechsten gueltigen Bericht weiter. Die Fahrzeugbatterie behaelt ihre eigenen Schutzfunktionen; vorhandene elektrische, Nutzer- und Leistungsgrenzen werden nicht geaendert.

## 15 Minuten ohne Leistungsaufnahme

Der Ausgangstreiber beobachtet einen eigenen aktiven Ladeauftrag mit bestaetigter Freigabe und Stromvorgabe. Erst 15 zusammenhaengende Minuten mit frischen, gueltigen Messungen innerhalb der bestehenden Nulltoleranz (hoechstens 20 W und auf jeder Phase hoechstens 0,5 A) loesen eine Pause aus. Messluecken, Leistungsaufnahme, ausstehende Strombefehle und Phasenwechsel starten diese Qualifikation neu. Ein Neustart rekonstruiert keine unbeobachteten 15 Minuten.

Nach Ablauf wird der Auftrag AUS geschaltet und fuer die Zuteilung ausgeschlossen. Die Leistungsreserve wird weiterhin erst nach echtem AUS-ACK und frischer elektrischer Ruhe aufgehoben. Erst diese vorhandene Abschaltkette gibt die Leistung fuer andere Fahrzeuge oder den verbleibenden Heizbedarf frei. Die Pause ist kein Wallboxfehler und aendert weder manuelle Mindeststromwerte noch Benutzerfreigaben.

`Devices.WallboxN.NoDrawElapsed_s`, `NoDrawRemaining_s`, `NoDrawPaused` und `NoDrawRetryAfter` machen den Ablauf sichtbar. `NoDrawPause_JSON` erhaelt eine bereits erreichte Pause ueber Neustarts. Ein automatischer neuer Versuch ist fruehestens nach weiteren 15 Minuten vorgesehen und wartet, solange ein anderes Fahrzeug einen laufenden oder noch nicht abgeschlossenen Auftrag hat. Abstecken, explizites Ausschalten der Benutzerfreigabe oder ein geaenderter positiver manueller Mindeststrom geben einen neuen Versuch frei; alle normalen Startbedingungen gelten erneut.

## Nachweise

- Alter Bericht mit 84 % bleibt angezeigt und steuerwirksam, sowohl mit als auch ohne Schaetzung. Unter einem Ziel von 80 % wird trotz manuell angeforderter Mindestladung nicht gestartet; mit Ziel 90 % ist ein normaler Start moeglich. Ein neuer niedrigerer Bericht wird unmittelbar uebernommen.
- Produktionsnahe Anlagensimulation mit echter Zuteilung, Ausgangsautomat und verzoegertem ACK: EQE nimmt trotz Freigabe nichts ab, wird nach 15 Minuten gestoppt und der Mii beginnt erst nach bestaetigter Abschaltung. Sequenzieller und paralleler Betrieb werden getrennt geprueft.
- Eine periodische Wiederholung verdraengt den ladenden Mii nicht. Nach dessen Zielerreichung kann der EQE mit den normalen Bedingungen erneut starten.
- Fehlendes AUS-ACK oder Restleistung geben keine Reserve frei. Unterbrochene Messung, Phasenwechsel und reale Leistungsaufnahme ergeben keine durchgehende Nullleistungszeit. Persistenz und die Trennung von Diagnose und AUS werden geprueft.

Tests steuern ausschliesslich simulierte Datenpunkte. Die Wirkung an der echten Anlage ist erst nach Installation beobachtbar.
