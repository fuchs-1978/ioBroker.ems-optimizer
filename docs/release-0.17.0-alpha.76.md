# 0.17.0-alpha.76 – Recorder-Ereignisse und SQL-Erholung

Die Betriebsanalyse #142/#143 zeigte einen nahezu vollen Journalpuffer und verspätete SQL-Veröffentlichungen. Zwei Adapterprobleme sind in deterministischen Tests reproduziert:

- Der schnelle NVP-Regler schrieb `PRODUKTIVFREIGABE` in `Control.Mode`, während der Ausgangstreiber dort seinen Besitzstatus wie `ALPHA_READY` publizierte. Jeder künstliche Wechsel öffnete Diagnoseereignisse. Jetzt verwendet der NVP-Regler `Control.RegulatorMode`; `Control.Mode` bleibt Ausgangsbesitz. Beide Felder sind diagnostisch, keine Steuerfreigabe.
- Bei einer SQL-Prüfung pro Durchlauf konnte ein altes, vollständig abgefragtes, leeres Nachweisfenster neue Fenster verdrängen. Abgeschlossene weiterhin offene Aufgaben wandern ans Ende der Warteschlange. Frische unabhängige Speicherbeweise können die Drosselung dadurch beenden.

Regression: Der Modus-Test scheitert auf unverändertem main. Der kombinierte SQL-Ausfall-/Erholungstest scheitert ohne faire Reihenfolge und besteht mit ihr. Er prüft erhaltene Originale, ausbleibenden Verkehr während der Pause, frischen exakten Speicherbeweis, begrenzte Veröffentlichung/Abfragen und anschließenden Abbau einer endlichen Warteschlange. Vorhandene Tests für unbekannten Backendabschluss, Altersbereinigung, Snapshotbasis und NULL/ACK/Qualität bleiben erforderlich.

Keine Änderung an Stellbefehlen, Schutzfristen, SQL-Konfiguration, Dateigrenzen oder Aufbewahrung. Ein unbekannter Backendabschluss bleibt gesperrt. Alte Verluste werden nicht nachträglich repariert oder als gespeichert ausgegeben. Die Fehler des QNAP bzw. des externen Abfragewegs sind damit nicht als gelöst nachgewiesen.

Nach manueller Installation prüfen: `Control.Mode` bleibt bei unverändertem Ausgangsbesitz stabil; `Control.RegulatorMode` zeigt die tatsächliche NVP-Freigabe. Neue Records behalten Ereigniszeiten, Session/Sequenz und Qualität; Master-/Befehlswechsel bleiben Ereignisse. Bei gesundem SQL sollen neue exakte Bestätigungen und sinkender Rückstand beobachtet werden. Pufferabbau durch Altersverlust ist kein erfolgreicher SQL-Nachweis. Kein zugesagter Scoregewinn oder vollständiger 24-h-Replay ohne reale Prüfung.
