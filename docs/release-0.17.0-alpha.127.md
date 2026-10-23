# 0.17.0-alpha.127 – Kommunikationswarnung mit gehaltener Wallboxreserve

## Beobachteter Anlass

Am 23.10.2026 endeten beim Mii die aktuellen go-e-Leistungs-/Stromproben um 10:54:52 MESZ. Um 10:55:24 forderte das EMS AUS an, mit dem Grund „Parallelbetrieb: gemeinsame Zuteilung ungueltig oder abgelaufen“. Der go-e-Adapter meldete danach ECONNRESET und Nichterreichbarkeit. Die Quellendiagnose um 10:55:46 las 54 Sekunden alte 1,31 kW/5,9 A und ein unbestaetigtes AUS. Sie belegte zu diesem Zeitpunkt weder frische Leistung noch elektrische Abschaltung. Die spaetere Wiederaufnahme mit bestaetigter elektrischer Antwort ist belegt. Ein konkreter WLAN-Ausfall oder eine Netzueberlastung wurde damit nicht bewiesen.

Die bisherige Ueberbrueckung war auf 60 Sekunden Quellenalter begrenzt und bei aktivierter SoC-Stromreduzierung ausgeschlossen. Carstens Auftrag betrifft ausschliesslich Nichterreichbarkeit beziehungsweise ausbleibende Poll-Rueckmeldungen einer bereits bestaetigten Ladung bei weiterhin gueltiger SMA-Ueberwachung.

## Verhalten ab dieser Version

- Die bestehende Ladung darf bei Nichterreichbarkeit oder veralteten Rueckmeldungen unveraendert bestehen bleiben, solange unabhaengige aktuelle SMA-Gesamt-/Phasenmessungen und saemtliche weiteren Berechtigungs-/Schutzpruefungen passen. Kein AUS allein durch Ablauf von 30/60 Sekunden Wallbox-Messwertalter.
- Vollstaendige konservative Reservierung: Maximum aus bestaetigtem Strom/Phasenstellung, vorhandener hoeherer Leistungsreserve und belastbaren bisherigen elektrischen Werten. Bei 6 A einphasig mindestens 1.380 W, auch bei zuletzt gemessenen 1.310 W. Keine Freigabe dieser Reserve an andere Lasten. Fehlende Quellen bleiben unbekannt; keine Historie oder Zeitstempel werden erfunden.
- Keine neuen Wallbox-Strom-/Freigabebefehle und keine neue Phasenumschaltung im Warnzustand. Die Statusanzeige nennt `TELEMETRIE-WARNUNG`, Quellenalter und Reserve. Das Log warnt einmal pro Episode und meldet eine frische Wiederverbindung einmal.
- Nach frischer Wiederverbindung normale Regelung ohne durch den Kommunikationsausfall erzeugten Zwischenstopp. Die Ausnahme gilt auch bei aktivierter SoC-Stromreduzierung; eine inzwischen niedrigere wirksame Stromgrenze bleibt verbindlich. Eine gueltige manuelle Mindestladung darf ihren vorgesehenen Netzanteil weiter nutzen.

## Grenzen

Die Ausnahme setzt eine in diesem laufenden Prozess elektrisch bestaetigte stabile Sitzung voraus. Sie uebernimmt keinen unbekannten Zustand nach Neustart und keinen unbestaetigten Start oder offenen Stell-/Phasenauftrag. Sie gilt nicht fuer Schattenmodelle. Die normale Quellenfrische von 30 Sekunden bleibt fuer neue Befehle bestehen; historische Wallboxwerte werden nur als alte Zustandsbelege verwendet.

Benutzer-AUS, Ziel-SoC, entfallene Berechtigungen, explizite Geraetefehler, NULL/unbestaetigte/schlecht qualifizierte Daten, fehlende SMA-Ueberwachung, Phasenueberlastung, reduzierte Grenzwerte und unbekannte Schutzbudgets bleiben wirksam. Optionales PV-Laden erhaelt keine unbeschraenkte Netzstromfreigabe. Aktive oder unklare groupNet-Begrenzungen benoetigen weiterhin ihre unabhaengigen frischen Gruppenmessnachweise; der bestehende LPC-Vertragsvorbehalt wird nicht umgangen. Auch SoC- und EMS-Frischefristen bleiben bestehen.

Ein erforderlicher AUS-Auftrag ist weiterhin keine garantierte physische Abschaltung einer unerreichbaren Wallbox. Ausgangsbesitz und Leistungsreserve werden erst nach bestaetigtem AUS **und** frischer elektrischer Ruhe freigegeben. Eine bereits aus anderem Grund laufende Abschaltung wird nicht aufgehoben.

## Validierung und reale Nachpruefung

Regressionen pruefen lange Kommunikationsausfaelle ueber 60 Sekunden bis zu einer Stunde, explizites Offline, Mii mit SoC-Stromreduzierung und interner SoC-Schaetzung, manuelle Mindestladung mit Netzanteil, 1P/3P-Reserven sowie Wiederverbindung ohne nachtraeglichen AUS-Auftrag. Negative Faelle pruefen SMA-/Quellenqualitaet, Benutzer-AUS, Ziel, Grenzen, unbekannte Verbindung und fehlenden Sitzungsnachweis. Ein erforderliches AUS behaelt seine volle Reserve bis zur elektrischen Bestaetigung. Der reale Allocator und Ausgangsautomat werden im deterministischen Anlagenmodell mit/ohne paralleles Laden, EHZ und inaktivem groupNet-Vertrag geprueft; keine Anlage wird geschaltet.

Vor Veroeffentlichung laufen unter Node.js 22 und 24 die vollstaendige Testsuite, Paket-/Installationsartefakt und die bestehenden Aequivalenzvertraege. Softwaretests ersetzen keine reale Abnahme. Nach manueller Installation sind natuerliche Kommunikationsausfaelle auf Warnstatus, unveraenderten Strom/Phasen, erhaltene Reserve, frische SMA-Werte und Wiederaufnahme ohne altersbedingten AUS-Auftrag zu pruefen. Keine kuenstlichen WLAN-/Schaltversuche, automatische Installation oder produktiven Konfigurations-/Skriptaenderungen durch diesen Auftrag.
