# 0.17.0-alpha.193 – Begrenzter PV-Nachregelversuch bei kleiner Stromabweichung

Der Mii-Recorder zeigte 18 A Vorgabe bei 16,9 A Aufnahme und rund 300 W Einspeisung. Ein fehlender Strom-/Leistungsanstieg nach 17 auf 18 A hielt die Antwortpruefung bis zu 45 Sekunden offen. Die bisherige fruehe Nachregelqualifikation verlangte bei einer Phase mindestens 430 W Einspeisung; gleichzeitig nominierte die Zuteilung waehrend der offenen Antwort keinen weiteren gemessenen Schritt. Mehr Stromtoleranz allein behebt diese beiden Grenzen nicht.

## Gemeinsame Korrektur

- Der Ausgang kann nach mindestens zehn Sekunden beobachtetem Ueberschuss einen einzelnen frueheren +1-A-Versuch vorbereiten, wenn die gemessene Nettoeinspeisung den Phasenschritt plus 50 W deckt. Bei 230 V sind das 280 W fuer 1P beziehungsweise 740 W fuer 3P. Die 50 W sind eine verbleibende Ueberschussreserve, keine erhoehte Strom- oder Netzbezugstoleranz.
- Weiterhin erforderlich sind der rechtzeitig bestaetigte Befehl, neue unabhaengige Strom-/Leistungsmessungen, nach der Qualifikation aktualisierte Quellen und ein unveraenderter Phasenzustand. Ein Rueckgang des Ueberschusses verwirft die laufende Qualifikation. Nachweis und elektrische Bestaetigung bleiben getrennt: Eine konstante Aufnahme gilt dadurch nicht als befolgte Stromerhoehung.
- `Devices.WallboxN.ResponseProbe_JSON` ist eine kurz gueltige Nominierung fuer die Zuteilung, keine Stellfreigabe. Sie benennt Befehl, ACK, Phasen, Qualifikations-/Beobachtungszeit, naechsten Amperewert und verbleibende Versuche. Sie gilt hoechstens zehn Sekunden und niemals ueber die urspruengliche elektrische Antwortfrist hinaus. Initialisierung, neuer Befehl, echte Bestaetigung, fehlender Ueberschuss oder ausgeschoepfte Versuche loeschen sie.
- Die Zuteilung akzeptiert nur einen aktuellen, bestaetigten, fehlerfreien und zur laufenden Sitzung sowie zum exakten Befehl passenden Nachweis. Sie kann damit hoechstens ein weiteres Ampere nominieren. Das gemeinsame Schutzbudget und die Geraete-/Phasengrenzen reservieren weiterhin die volle nominale Leistung des neuen Befehls.
- Der Ausgang prueft kurz vor dem Schreiben erneut seine privaten Antwort-/Versuchsdaten, die aktuelle Zuteilung, NVP, Messqualitaet, Heizstab-/Fahrzeugreserven und harte Grenzen. Ein noch offener gemessener Schritt kann nur innerhalb dieses begrenzten Nachregelpfads ersetzt werden. Eine reine Nominierung kann keinen Stellbefehl ausloesen.
- Hoechstens zwei unbeantwortete Versuche bleiben erlaubt. Erst ein nachgewiesener realer Strom- und Leistungsanstieg setzt diesen Zaehler zurueck. Start, Phasenwechsel, Preisladung und Schattenmodell erhalten durch diese Korrektur keine neue Erhoehungsfreigabe.

## Diagnose und Grenzen

Der Recorder uebernimmt die Nominierung unter `production.wallboxes[].responseProbe` und zeichnet ihren eigenen Quellzustand auf. `ResponseState` bleibt waehrend der offenen elektrischen Antwort `vehicle_response`; der neue Nachweis fingiert kein `confirmed`.

Die vorhandene Unteraufnahmegrenze von 3 A, die konfigurierte obere Stromabweichung, Antwortfristen, Netzbezugsgrenzen und das Schichtungsminimum des E-Heizers bleiben unveraendert. Ein tatsaechlich begrenzendes Fahrzeug kann weiterhin Ueberschuss uebrig lassen. Die Installation und reale Abnahme erfolgen durch den Betreiber.

## Validierung

Der deterministische Anlagentest verbindet echte Zuteilung und echten Ausgangsregler mit einer eigenstaendigen verzoegerten Fahrzeugantwort: Bei 18 A Vorgabe bleibt die Aufnahme zunaechst 16,9 A. Der begrenzte 19-A-Versuch erfolgt vor Ablauf der bisherigen 45 Sekunden; bei danach um 1 A steigender Aufnahme sinkt die Test-Einspeisung von 300 auf etwa 70 W. Das ist ein Simulatorergebnis, kein Nachweis des realen Mii-Verhaltens nach Installation.

Weitere Regressionen pruefen ein dauerhaft strombegrenztes Fahrzeug ohne Aufintegrieren ueber zwei unbeantwortete Versuche, die reale Inbetriebnahmegrenze, verschwundenen Ueberschuss, fehlende/alte/falsche Nominierungen, Sitzung/Befehl/ACK/Phasen, Ablaufzeiten, fehlende elektrische Antwort und die Begrenzung auf einen Ampere-Schritt. Die beiden Hauptregressionen scheitern gegen Alpha 192.
