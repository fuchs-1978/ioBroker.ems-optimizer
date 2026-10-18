# 0.17.0-alpha.88 – Bestaetigten Wallboxstrom ruhiger nachregeln

## Problem und Verhalten

Bei der Nachpruefung des EQV wurden wechselnde 7-/8-A-Ziele und Rest-Rueckspeisung beobachtet. Die gemeinsame Zuteilung nutzt zwar die reale Ladeleistung, kappte den Strom anschliessend jedoch nochmals am nominellen PV-Leistungsbudget. Eine bestaetigte 8-A-Ladung mit 1730 W Aufnahme wurde bei 1800 W Budget dadurch auf 7 A begrenzt, obwohl ihre aktuelle Aufnahme gedeckt war. Das ist ein belegbarer Mechanismus fuer unnoetige Reduktionen, keine vollstaendige kausale Zuordnung der zuvor beobachteten Rueckspeiseenergie.

In der produktiven Mehrfahrzeugregelung kann jeder der drei Ladepunkte den bereits elektrisch bestaetigten Strom jetzt halten, wenn frische Leistungs-/Strommessungen nach dem letzten Befehl und zur passenden Rueckmeldung vorliegen und die gemessene Aufnahme vollstaendig im aktuellen PV-Budget liegt. Die Abweichung zur nominellen Softgrenze darf maximal ein Ampere betragen (einphasig bei 230 V: 230 W; dreiphasig: 690 W). Das gilt auch, wenn bei aktivierter Mehrfahrzeugfunktion nur ein Auto laedt.

Die Ausnahme erlaubt ausschliesslich Halten, keinen zusaetzlichen Stromschritt oder neuen Ladestart. Neue Erhoehungen im Parallelbetrieb benoetigen weiterhin das volle nominelle Budget und eine frische elektrische Antwort. Pflicht-/Preisladung, Phasenwechsel, unbestaetigte Antworten, fehlende Quellen und groessere nominale Abweichungen erhalten keine neue Halteberechtigung. Reale Budgetdefizite und kleinere zentrale Zuteilungen fuehren weiterhin zur Reduktion.

Geraete-/Inbetriebnahmegrenzen, SoC-Abregelung, nominale gemeinsame LPC-/Leistungsgrenzen und Hausanschlusspruefungen bleiben wirksam. Reserven gegenueber anderen Autos und EHZ bleiben mindestens auf voller nomineller Leistung; die gemessene Differenz wird nicht an einen zweiten Verbraucher vergeben. Kein neuer Admin-Schalter; vorhandene Freigaben, Parameter und Regeltakte bleiben unveraendert.

## Diagnose und Validierung

`Control.WallboxN.AllocationDiagnostics_JSON` zeigt `measuredCurrentHeld`, `nominalMaximumA` und den Grund `measured-current-held`. `Devices.WallboxN.IncreaseBudget_JSON` kennzeichnet die Ausgangspruefung mit `measured-current-hold`.

Regressionen pruefen den 8-A-/1730-W-/1800-W-Fall ueber wechselnde Budgets, jede der drei Wallboxen, den dreiphasigen 8-A-/5200-W-/5283-W-Fall, keine Erhoehung aus der Halteausnahme, hoechstens ein Ampere nominale Differenz, volle Reservierung fuer andere Verbraucher, kleinere gemeinsame Limits sowie fehlende/unbestaetigte/vor dem Befehl liegende Messungen und Phasenwechsel. Die positiven zentralen und Ausgangsregressionen scheitern an alpha.87. Gesamttests und Paketpruefungen werden vor der Veroeffentlichung ausgefuehrt.

## Reale Nachpruefung

Nach Installation Anzahl und Folge realer Amperebefehle, neue elektrische Antworten, Rueckspeiseenergie und Netzbezug unter vergleichbaren Bedingungen auswerten. Weniger unnoetige Stromreduktionen sind das Ziel; eine bereits gemessene Energieeinsparung wird nicht behauptet. Wetter, Hauslast, Neustart und die Messverzoegerung des go-e bleiben Einfluesse. Der Recorder-Fix aus alpha.87 ist enthalten. Keine Installation oder produktive Konfigurationsaenderung erfolgt mit dieser Veroeffentlichung.
