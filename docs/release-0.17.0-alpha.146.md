# 0.17.0-alpha.146 – Warnen statt altersbedingtem Wallbox-Stopp

## Anlass und enger Ursachenpfad

Am 25.10.2026 um 14:02:08 MEZ stoppte Mii/WB0 unter alpha.145 mit `Wallbox-Fehlerstatus: veraltet (Alter 32 s; maximal 30 s)`. Der letzte originale Fehlercode war 0, ACK=true/q=0. Letzte Leistung 1,76 kW und L1=7,9 A waren ebenfalls rund32 s alt; eine unabhaengige ioBroker-Lesung lieferte dieselben alten Werte. Das ist kein nachgewiesener Geraetefehler und keine neue Geraetebeobachtung. Ursache der ausbleibenden go-e-Aktualisierung bleibt offen.

Die Stromvorgabe9 A war bereits bestaetigt, die elektrische Antwort auf den vorigen8-A-Schritt noch offen. Die vorhandene Kommunikationsbruecke verlangte `ResponseState=confirmed` und erfasste diesen Zwischenzustand daher nicht. Stopp und elektrisches AUS wurden anschliessend bestaetigt. Das spaetere fehlende Startbudget war nicht der Ausloeser des Stopps.

## Aenderung

Eine zuvor laufende EMS-eigene Ladung darf auch bei `vehicle_response`/`limited` im bestehenden Telemetrie-Warnzustand bleiben, wenn genau ihr Strombefehl rechtzeitig ueber die richtige Quelle bestaetigt wurde und der laufende Prozess diesen Zustand vor der Kommunikationsluecke beobachtet hat. Befehl, Phasen, urspruenglicher ACK-/Antwortzeitpunkt und volle konservative Leistungsreserve bleiben erhalten. Fehlende elektrische Aufnahme wird nicht bestaetigt, keine weitere Erhoehung oder Phasenumschaltung ausgegeben, keine alte Quelle aufgefrischt und keine Frist zurueckgesetzt.

Gewoehnlicher Netzbezug von mehr als100 W ist waehrend dieser Kommunikationsueberbrueckung kein eigener AUS-Grund mehr. Das kann Netzenergie verursachen, solange die Wallbox nicht wieder frisch berichtet. Frische SMA-Gesamt-/Phasenmessungen, konservative Hausanschlussreserve und wirksame Netzbetreibergrenzen bleiben erforderlich. Nach Wiederverbindung entscheidet wieder die normale Budgetregelung.

Echte Geraetefehler, ungueltige Schutzmessungen, Grenzverletzungen, Benutzer-/Master-AUS, Ziel-SoC und entzogene Freigaben bleiben wirksam. Unbestaetigte Starts/Strombefehle, Phasenwechsel und unbekannte Sitzungen erhalten keine neue Ausnahme. Aktive/unklare groupNet-Grenzen behalten ihre eigenstaendigen Nachweise. Keine globale Abschaffung normaler Ladeenden oder Schutzstopps.

## Softwarepruefung und reale Abnahme

Gezielte Regression bildet bestaetigte9 A mit noch nicht nachgewiesener elektrischer Antwort und anschliessender Quellenalterung fuer1P/3P ab; sie scheitert unter alpha.145. Zusaetzlich realer Parallelverteiler mit/ohne Heizstab, lange Unterbrechung, Erholung ohne nachgeholtes AUS, volle Reserve, unveraenderte Quellenzeiten/Antwortfrist sowie negative ACK-/Start-/Phasen-/Schutz-/Freigabefaelle. Separater Test fuer normalen Haushaltsbezug und begrenzte Fahrzeugaufnahme.

Vollstaendige Test-, Paket-, Artefakt- und Aequivalenzpruefung sowie CI werden im PR belegt. Diese Softwaretests sind keine Anlagenabnahme. Keine Installation, Livekonfiguration oder Aktoraktion durch diese Aenderung.

Nach tatsaechlicher Installation nur ein natuerlich auftretendes neues Ereignis pruefen: frischer ACK des unveraenderten Strombefehls, Kommunikationsluecke bei unabhaengig frischem SMA, Warnung ohne altersbedingtes AUS/Erhoehung, erhaltene Reserve bis zur Erholung, anschliessend originale elektrische Antwort und normale Regelung. Bei echtem Schutz-/Freigabeereignis AUS-ACK und elektrische Ruhe getrennt belegen. Keine alten SQL-Fenster erneut laden und keinen Ausfall kuenstlich erzeugen.
