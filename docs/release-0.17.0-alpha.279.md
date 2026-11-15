# 0.17.0-alpha.279

Der Live-Regler beobachtet bei einem SunEnergy-Einzelkopf die tatsächliche Ladeleistung und die Netzmessung. Zwei Minuten zusammenhängender Ladung bis auf 50 W an der verfügbaren Ladegrenze qualifizieren die Übergabe an die bevorzugte PV-Wallbox. Für die Freigabe müssen eine aktuelle Einspeisung oberhalb des Speichertotbands und genügend Leistung für den Mindeststrom samt Startreserve vorliegen. Eine bereits belegte Ladezeit kann diese Zweiminutenprüfung vor dem ersten Einspeisen erfüllen.

| Überschuss bei 6 A einphasig und 150 W Startreserve | Speicher während des Starts | Speicher bei 1.380 W Fahrzeugladung |
| --- | ---: | ---: |
| 2.430 W | 900 W | 1.050 W |
| 3.400 W | 1.870 W | 2.020 W |

Die Watt für den Start werden aus dem gemeinsamen Überschuss freigegeben. Die Wallbox prüft vor dem Einschalten die tatsächlich freigewordene Netzleistung. Nach dem Start kann sich die Speicherladung an wechselnden Überschuss anpassen, solange das Fahrzeug mit seinem Mindeststrom aus PV versorgt werden kann.

Eine unterbrochene Messreihe, ungeeignete Phasenlage, Mindest-SoC, erforderliche Wärmeladung und eine aktive Netzbetreiberbegrenzung können die Übergabe sperren. Nach einem erfolglosen Start erhält der Speicher sein Budget zurück. Für Starts ohne diesen Nachweis gilt die normale Startqualifikation.
