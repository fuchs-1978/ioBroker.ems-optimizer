# 0.17.0-alpha.95

Die gemeinsame PV-Bezugstoleranz gilt jetzt auch fuer laufende Mindest-SoC-Ladungen. Die Einstellung wallboxPVImportToleranceW ist die volle Haltegrenze; fuer neue gemessene 1-A-Schritte gilt max(0, Einstellung minus 20 W) statt der bisherigen Haelfte. Die gleiche Regel gilt in Zuteilung, Ausgang und unmittelbar vor dem Senden.

Bei Einstellung 100 W und Netzsollwert 0 W: Zuschalten bis rechnerisch 80 W, Halten bis 100 W. Beispiel 160 W Einspeisung, zusaetzliche 230 W Ladeleistung: rechnerisch 70 W Bezug und damit Zuschaltung moeglich. Der 20-W-Abstand wirkt gegen Pendeln.

Nur eine bereits laufende freigegebene Wallbox bekommt den gemeinsamen Zuschlag, nicht jedes Auto. Pflichtlade-Mindestbudgets sind kein Beleg fuer weitere PV-finanzierte Schritte; die zentrale Freigabe benoetigt auch die echte PV-Budgetzuordnung. Vollstaendige nominelle Peer-/Heizreserven, Geraete-/Phasengrenzen und harte Netzbetreibergrenzen bleiben bestehen. Neue Starts und Preisladungen erhalten keine zusaetzliche Freigabe. Vor einem weiteren gemessenen Schritt ist weiterhin eine elektrische Antwort erforderlich.

Die Einstellung begrenzt den erlaubten zusaetzlichen Regelungszuschlag, nicht den gesamten Haus-Netzbezug. Pflichtladung, andere Verbraucher, Messverzoegerungen und Lastwechsel koennen hoehere Momentanwerte verursachen.

Admin nach Installation: Echtzeitregelung, gemeinsame Netzbezugstoleranz fuer PV-Wallboxen auf 100 W setzen, Netzsollwert bei 0 W lassen, speichern. Bestehende Werte werden nicht automatisch geaendert.

Validierung umfasst den 160-W-Fall unter Mindest-SoC, 80-W-Zuschaltgrenze und 100-W-Haltegrenze, einen gemeinsamen Besitzer, fehlendes reales PV-Budget trotz Pflichtladefloor, sowie erneute Netzmessung vor dem Senden.
