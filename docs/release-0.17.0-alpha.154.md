# 0.17.0-alpha.154 – zusammenhaengender Startablauf

## Befund

Die Einzelkorrekturen 151–153 beseitigten nicht alle Rueckkopplungen des gemeinsamen Ablaufs. Im Live-Verlauf wechselte ein noch nicht gestarteter EQE zwischen 1P und 3P, verlor seine Startqualifikation und gab sein Budget erneut an den Heizstab ab. Die Integrationstests deckten ausserdem auf, dass ein optionaler Spender nach Neustart eine frische Entziehung der Ladezuteilung als fehlenden Fahrplan behandeln konnte und deshalb weiterlief. Beim Hochlauf konnte der Heizstab die Differenz zwischen beabsichtigtem Ladebudget und gerampter Stromvorgabe wieder belegen.

## Aenderungen

- Eine kontinuierliche Startvorbereitung behaelt ihre erste Phasenwahl bis zur produktiven Freigabe. Steigende PV-Leistung allein bewirkt waehrend dieser Vorbereitung keinen 1P-zu-3P-Wechsel. Eine reale Unterdeckung des 3P-Minimums darf auf 1P zurueckfallen; erst nach dem Start greifen wieder normale Hochqualifikation und Phasenhaltezeit. Ungueltige Quellen, Beobachtungsluecken, Freigabe-/Auswahlverlust und echte Budgetunterdeckung erhalten keine alte Startqualifikation.
- Ein bereits vorbereiteter, exakt passender und zeitlich begrenzter ack=false-Phasenbefehl behaelt sein Ziel auch dann, wenn die Rueckmeldung dem vom Ausgangstreiber publizierten Pending-Status zuvorkommt. Er bestaetigt weder Hardware noch Ladefreigabe. Falsches Ziel, schlechte Qualitaet, unbestaetigtes EMS-Ziel, abgelaufene Anfrage und Phasen-Timeout liefern keinen solchen Nachweis.
- Das geplante Budget der bevorzugten Vorbereitung bleibt ueber Phasenwechsel und Startwartezeit vor optionalen Verbrauchern geschuetzt. Beim laufenden Hochregeln bleibt auch noch nicht durch den Rampenschritt abgerufene beabsichtigte Ladeleistung vor dem Heizstab geschuetzt. Nur verbleibende Leistung innerhalb von Fahrzeuggrenzen/Quantisierung geht an den Heizstab. Konfigurierte aktive Parallelaufteilung oder Warmwasserpflicht bleiben eigenstaendige Regeln.
- Ein frisch und strukturell gueltig entzogener Ladeanteil kann einen optionalen Spender auch waehrend seiner Neustart-Uebernahme geordnet abschalten. Ein fehlender/alter/ungueltiger Fahrplan ist weiterhin kein solcher Abschaltauftrag. Physische Spenderreserven bleiben bis AUS-ACK und elektrischer Ruhe gebunden.

Die bestehende fruehe, gemessen finanzierte 1-A-Nachregelung aus 151 wird nicht veraendert. Der Ausgangstreiber unterscheidet zusaetzlich explizite neue Entziehung von noch fehlenden Neustartdaten und akzeptiert die explizite Stromobergrenze einer qualifizierten 1P-zu-3P-Vorbereitung. Damit darf das Halten einer alten bestaetigten Stromvorgabe die erforderliche Reduktion vor dem Phasenwechsel nicht blockieren. Ein unmittelbar bevorstehender qualifizierter 3P-zu-1P-Wechsel bekommt einen kurzen absoluten Ablaufpuffer gegen ein gleichzeitig auslaufendes Soft-Stopp-Timing. Der bereits laufende Wechsel darf auf seine bounded native/electrische Bestaetigung warten; harte Grenzen, Quellen- und Freigabegates gelten weiter. Keine Schreibzugriffe auf die reale Anlage erfolgen durch Tests.

## Durchgehende Pruefung

Die erweiterte Testanlage benutzt echte Produktionsmodule fuer Zuteilung, Ausgangsautomat und Heizstab. Eine optionale simulierte Phasenfuehrung liefert einen nativen ack=false-Befehl, anschliessend eine um 18 Sekunden verspaetete Phasenbestaetigung und die passenden drei Strom-/Leistungsmessungen. Die Heizstableistung reagiert neun Sekunden verspaetet. Standardfaelle ohne diese Simulation bleiben unveraendert.

Die neuen Ablaeufe pruefen jeweils mehrere hundert Regelzyklen:

1. Bereits laufender optionaler Spender, bevorzugter 1P-Start und PV-Wechsel zwischen 3,9 und 5,2 kW: Start ohne erneute Phasenwahl und ohne Reset des Countdowns.
2. 3P-Start mit verzogerter nativer Bestaetigung: Budget bleibt erhalten; kein ON vor echtem Phasen-ACK.
3. Reale Unterdeckung waehrend 3P-Vorbereitung: einmaliger Rueckfall auf 1P, kein Ruecksprung bei wieder steigender PV vor dem Start.
4. Freigabeentzug waehrend des Phasenbefehls: kein Start; Vorbereitung wird verworfen.
5. Hochlauf: Heizstab kann die beabsichtigte Autoleistung nicht wieder belegen.
6. Fehlender Phasen-ACK ueber den Timeout hinaus: kein Start trotz abgelaufener Startwartezeit.
7. Echter PV-Einbruch: alte Wartezeit geht verloren; neue volle Qualifikation nach Erholung.

8. Nach dem Start ein vollstaendiger 1P-zu-3P-zu-1P-Zyklus mit 8 kW und anschliessend 3,5 kW: beide Uebergaenge laufen ohne zusaetzlichen Kaltstartcountdown durch.
9. Hausanschlusskritisch waehrend eines bevorstehenden Rueckwechsels: sofort AUS, keine erneute Freigabe.

Zusaetzliche Gegenproben grenzen native Phasenechos und Neustart-Entziehungen ab. Die bisherigen EQE-Offset-, Last-/Phasengrenzen-, SQL-, Pflichtlade-, Freigabe- und ACK-Tests bleiben aktiv. Die Start-/Hochlaufregressionen scheitern mit den Produktionsdateien aus 153.

Der historische bytegenaue Ablaufvergleich trennt unveraenderte Spender-Uebernahme/Abschaltung und laufenden Phasenwechsel von den bewusst geaenderten Start-/Spenderuebergaben. Letztere sind jetzt durch die durchgehenden Produktionssimulationen abgedeckt. Andere historische Szenarien bleiben exakt verglichen.

Softwarepruefung belegt diese simulierten Ablaeufe. Der echte Live-Nachweis erfolgt nach Installation; ein fehlerfreier Startlog allein ist keine Abnahme der Regelung.
