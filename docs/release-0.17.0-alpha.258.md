# 0.17.0-alpha.258

Der Recorder misst im SunEnergy-Kopfmodus je gesendetem Auftrag, wann der XT500 den neuen Sollwert `GS` zurückmeldet und wann sich `GP` erstmals in Richtung des Sollwerts bewegt. Bei einer Anforderung von 12 W mit `GS = −12 W` und `GP = 0 W` zeigt er daher ein beobachtetes Sollwert-Echo und eine ausstehende AC-Reaktion.

Die Daten stehen im `Debug.Snapshot_JSON` unter `battery.headFeedback.heads[].feedbackTiming` und im bestehenden `Debug.Shadow.DecisionRecord`. `gsEcho.latency_ms` und `gpResponse.latency_ms` beziehen sich auf den Zeitpunkt unmittelbar vor dem ioBroker-Schreibaufruf und die erste geeignete Erfassung laut XT500. Der Erfassungszeitpunkt des Geräts, der ioBroker-Quellzeitstempel und der Empfangszeitpunkt des EMS bleiben sichtbar. Für die AC-Reaktion zählt eine Änderung um mindestens 5 W gegenüber der letzten geeigneten Messung vor dem Auftrag. Bei kleineren Schritten zählt die volle erforderliche Änderung. Die Auflösung hängt von den vorhandenen Abfragen ab.

Vor dem Auftrag erfasste oder erneut veröffentlichte Messungen zählen nicht als Rückmeldung. Bei fehlenden oder zeitlich unplausiblen Zeitstempeln, nicht zuordenbaren Aufträgen oder nach Ablauf der Rückmeldefrist bleibt der betreffende Zeitabstand `null`. Ein beobachteter Fremdschreibzugriff beendet ausstehende Zuordnungen. Soweit gemeldet, zeigen die Kopfbeobachtungen zusätzlich den USV-Modus und die Gerätefehler-Bitmasken.

[Issue #416](https://github.com/fuchs-1978/ioBroker.ems-optimizer/issues/416)
