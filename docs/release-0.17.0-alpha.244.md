# 0.17.0-alpha.244

Das EMS wertet bei SunEnergy-Entladeaufträgen jetzt auch eine verspätete Bestätigung des vorherigen Sollwerts aus. Sobald der Kopf anschließend nach dem Nullbefehl einen frischen Nullsollwert und AC-Leistung innerhalb der Nulltoleranz meldet, gibt das EMS den Ausgang automatisch wieder frei. Das gilt auch, wenn die Entladeleistung den früheren Sollwert vor dem Stopp noch nicht erreicht hat.

Fehlt die Bestätigung des früheren Auftrags vollständig, bleibt dessen Eintrag bestehen.
