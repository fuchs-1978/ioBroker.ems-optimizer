# 0.17.0-alpha.89 – Kleinen PV-Netzbezug statt eines ungenutzten Ampere-Schritts zulassen

## Verhalten und Einstellung

Im Admin-Reiter Echtzeitregelung gibt es die gemeinsame Netzbezugstoleranz fuer PV-Wallboxen (`wallboxPVImportToleranceW`). Voreinstellung 50 W, Bereich 0–200 W; 0 deaktiviert die Erweiterung. Die Toleranz gilt zusaetzlich zum Netzsollwert. Bei 0 W Sollwert kann aus 220 W Einspeisung durch einen einphasigen 1-A-Schritt von nominell 230 W rechnerisch 10 W Bezug werden.

Neue Schritte muessen innerhalb der halben Toleranz erwartet werden (voreingestellt 25 W); zum Halten gilt die volle Toleranz (50 W). Damit liegen Zuschalt- und Ruecknahmeschwelle auseinander. Dreiphasig wird der volle 690-W-Schritt bei 230 V gerechnet; 220 W Restueberschuss reichen dafuer nicht.

Die produktive gemeinsame Zuteilung vergibt genau einen Toleranz-Eigentuemer unter den bereits aktiven eigenen PV-Ladepunkten. Der Zuschlag wird nicht pro Auto addiert. Nur frische, bestaetigte elektrische Antwort nach dem letzten Befehl erlaubt einen neuen Schritt; maximal ein Ampere und maximal eine nominale Stufe ueber dem weichen PV-Limit. Ein nicht beantworteter Schritt kann keine weitere Erhoehung finanzieren. Seine unveraenderte Antwortfrist bleibt bestehen. Faellt das reale Budget weg, wird auch ein wartender Schritt reduziert.

Volle nominelle Reserven fuer andere Autos und Waermeverbraucher bleiben erhalten. Geraete-, Phasen-, Inbetriebnahme-, SoC- und gemeinsame LPC-/Schutzgrenzen werden nicht erhoeht. Kalte Starts, Pflicht-/Preisladung und Phasenwechsel erhalten keine neue Toleranzfreigabe. Der Ausgang prueft das inkrementelle Netzbudget unmittelbar vor dem gemessenen Stellbefehl erneut. Ungueltige Konfiguration oder fehlende Eigentuemerfreigabe gewaehren keinen Zuschlag.

Die 50 W sind eine Regeltoleranz, keine Garantie einer momentanen Netzbezugsobergrenze: Hauslast, Pflichtladung, Messverzoegerung und wechselnde PV koennen den realen Netzbezug beeinflussen. Der vorhandene Netzsollwert wird nicht geaendert; fuer den gewuenschten Betrieb ist er separat auf 0 W gesetzt worden.

## Diagnose und Validierung

Die gemeinsame Allocation enthaelt `pvStepOwner` und `pvStepToleranceW`. Einzelzuteilung meldet `measuredPVStep`, `pvStepToleranceW` und `measured-pv-step`; die Ausgangsdiagnose zeigt Toleranz, halbe Zuschaltgrenze, reale und nominelle Leistungsanforderung sowie die bestehende elektrische Schrittsperre.

Gezielte Regressionen pruefen 220 W Restueberschuss -> 10 W erwarteten Bezug, 25-/50-W-Hysterese, 3P-Schrittgroesse, einen gemeinsamen Eigentuemer, unveraenderte Schutz- und Fremdreserven, keine Kaltstartfreigabe, abgeschaltete/ungueltige Konfiguration, fehlende/neue elektrische Antwort, live wegfallendes Budget unmittelbar vor der Ausgabe und Reduktion eines noch offenen Schritts bei echtem Defizit oder kleinerer Schutzgrenze. Die positiven 1P-/3P- und Ausgangstests scheitern an alpha.88. Vollstaendige Tests und Paketpruefungen vor Veroeffentlichung ausfuehren.

Nach Installation reale Sollstromfolgen, frische Fahrzeugantworten, Netzbezug und Rueckspeiseenergie vergleichen. Erwartete geringere Rest-Einspeisung ist noch kein gemessener Betriebserfolg. Recorder- und Nachregelungsverbesserungen aus alpha.87/88 bleiben enthalten. Keine Installation, Aktorfreigabe oder weitere produktive Konfigurationsaenderung durch diese Veroeffentlichung.
