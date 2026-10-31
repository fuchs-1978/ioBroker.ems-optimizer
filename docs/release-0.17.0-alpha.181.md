# 0.17.0-alpha.181 – Zeitumstellung im Lasso-Rückblick

Bisher wurden alle Messwerte eines 23- oder 25-Stunden-Tages entfernt. Dadurch fehlten am 1.11.2026 sämtliche Wochenrückblicke auf den 25.10.2026.

Die Messwerte bleiben jetzt anhand ihrer eindeutigen absoluten Zeitstempel erhalten. Kalender-Rückblicke verwenden dieselbe lokale Viertelstunde vor zwei beziehungsweise sieben Tagen. Bei der Herbstumstellung wird für eine doppelt vorkommende lokale Viertelstunde der Mittelwert beider gleich langen, tatsächlich gemessenen Intervalle verwendet. Beide Messwerte müssen vorhanden und gültig sein; fehlende oder widersprüchliche Daten bleiben unbekannt. Bei der Frühjahrsumstellung existiert 02:00–02:45 nicht; diese Lücken werden nicht nach 03:00–03:45 verschoben oder aufgefüllt.

Die bisherigen Regeln für Median-Trainingswerte und Lasso-Zielwerte auf regulären Tagen bleiben erhalten. Prognosen für Umstellungstage selbst werden weiterhin nicht als vollständige 96-Slot-Tage ausgegeben oder bewertet. Dies ist eine gezielte Korrektur der Rückblicke, keine Erweiterung auf 92-/100-Slot-Zieltage.

Bereits gespeicherte Vorabprognosen bleiben unverändert. Neue Prognosen verwenden die korrigierten Rückblicke nach dem nächsten Historienaufbau (auch beim Adapterstart). Vollständigkeit setzt weiterhin vorhandene Messwerte, Wetterdaten und Medianwerte voraus. Keine Änderungen an produktiver Steuerung, Zählerzuordnung oder SQL-Aufzeichnung.

Geprüft: vollständige 96-Slot-Prognose am 1.11. mit Wochenrückblick auf den 25.10.; Mittelwert der beiden Herbstvorkommen; fehlendes erstes oder zweites Vorkommen bleibt unbekannt; Frühlingslücke bleibt unbekannt; eindeutiger Mittag auf dem Frühjahrsumstellungstag bleibt nutzbar; bestehende Prognosen werden beim Neuaufbau nicht verändert.
