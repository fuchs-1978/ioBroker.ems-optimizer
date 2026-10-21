# #166: geprüfter Restumfang und offene Voraussetzung am 21.10.2026

## Ausgangspunkt und Abschlussstatus

Codebasis ist main
[`76db3611b56dbe5c2335b7d78c8ccef793e35874`](https://github.com/fuchs-1978/ioBroker.ems-optimizer/commit/76db3611b56dbe5c2335b7d78c8ccef793e35874),
alpha.115. [#166](https://github.com/fuchs-1978/ioBroker.ems-optimizer/issues/166)
und [#220](https://github.com/fuchs-1978/ioBroker.ems-optimizer/issues/220) wurden
vor Verwendung anhand GitHub-Metadaten dem Autor `fuchs-1978` zugeordnet.
#166 hatte keine Kommentare. Weitere Arbeitsgrundlagen sind die ebenfalls
autorengeprüften #219, #60, #7, #8, #216 und #26; keine fremden Issues.

**Die Implementierung ist nicht abgeschlossen und hier nicht begonnen.**
Es gibt keine neue Laufzeitfunktion, Versionsanhebung, Installation oder
Veröffentlichung. Die Diagnosefortschreibung steht getrennt in
[issue220-diagnosis-followup.md](issue220-diagnosis-followup.md).

## Konkreter externer Blocker

Der Auftrag setzt vor Umsetzung eine erneute Prüfung aktueller offizieller
Vorgaben voraus. Der Abruf der
[BNetzA-Seite](https://www.bundesnetzagentur.de/DE/Vportal/Energie/SteuerbareVBE/artikel.html)
über die vorgesehene Cloud-Proxyroute am 21.10.2026 scheitert mit
`CONNECT tunnel failed, response 403` (curl Exit 56). Die wirksame
Netzkonfiguration erlaubt den offiziellen Zielhost nicht. Das ist kein
Repository-, ioBroker- oder SQL-Fehler.

Im Cloud-Umgebungsentwurf wurden `www.bundesnetzagentur.de`, `www.vde.com` und
`www.eebus.org` ergänzt; der vorhandene explizite GitHub-API-Zugang und die
Paketmanager-Presets bleiben erhalten. Der Speichervorgang meldet
`requires_publish=true`. Ein gespeicherter Entwurf ist keine wirksame
Netzfreigabe. Erforderlich ist seine Veröffentlichung/Anwendung über die
Umgebungseinstellungen; eine Proxyumgehung wurde nicht versucht.

Danach sind die offiziellen Originale erneut zu prüfen:

- [BK6-22-300 Anlage 1](https://www.bundesnetzagentur.de/DE/Beschlusskammern/1_GZ/BK6-GZ/2022/BK6-22-300/Beschluss/BK6-22-300_Beschluss_Anlage1.pdf?__blob=publicationFile&v=1),
  insbesondere EMS/netzwirksamer Bezug und Abschnitt 4.5.2;
- [BNetzA Mitteilung 6](https://www.bundesnetzagentur.de/DE/Beschlusskammern/1_GZ/BK6-GZ/2022/BK6-22-300/Mitteilung/Mitteilung_06/Mitteilung_Nr_06.html?nn=877500);
- [VDE-FNN Mindestleistung, April 2025](https://www.vde.com/resource/blob/2384602/0cb47de901b1129acad8510257ecc582/vde-fnn-hinweis-mindestleistung-data.pdf)
  und die zum unterstützten LPC-Eingang passenden aktuellen Schnittstellenverträge.

Die dokumentierte Prüfung vom 18.10. in den alpha.90-Releasehinweisen ersetzt
diesen aktuellen Pflichtschritt nicht. Keine regulatorische Inhaltsaussage wird
aus der fehlgeschlagenen Anfrage abgeleitet.

## Vorhandene Funktionen wiederverwenden

`lib/grid-constraints.js` enthält Fest-/Extern-/EMS-Budgetquellen,
Teilnehmer-/GZF-Berechnung, thermische Gruppierung und externes Gesamtbudget ohne
erneute GZF-Skalierung. Admin und konservative Migration bestehen seit alpha.90.
`test/grid-constraints.test.js` prüft diese Funktionen bereits.

`currentConsumptionLimit()` in `lib/engine/realtime.js` und der unabhängige
`WallboxOutput.gridOperatorLimit()` werten dagegen weiterhin einen gemeinsamen
Bruttodeckel aus. Die Diagnose nennt ausdrücklich
`conservative-gross-ceiling; no own-generation uplift`. Die vorhandene
WP-Gesamtleistungsprüfung unterscheidet vollständige Leistung von Inverterteilleistung.

Die bestehende Teilnehmertabelle enthält Name, Typ und Anschlussleistung, jedoch
keine eindeutige Zuordnung von Ausgang, tatsächlichem Leistungszähler und
Messgrenze. Die generischen LPC-Status-/Limit-IDs enthalten ebenfalls keine
maschinenlesbare Gruppen-/Messgrenzenidentität. Unbekannte private IDs allein
verhindern keine generische Implementierung: Ein neuer expliziter, standardmäßig
deaktivierter Vertrag kann diese Bindungen definieren. Ihre physische Richtigkeit
und Aktivierung bleiben eine spätere Anlagenaufgabe.

## Erforderlicher zusammenhängender Softwarevertrag

1. Stabile Gruppen-/Messgrenzenidentität und explizite Zuordnung der Teilnehmer
   zu Ausgängen und vollständigen AC-Messungen. Aggregat und enthaltene Teilzähler
   dürfen nicht doppelt gezählt werden. WP muss relevante Zusatzverbraucher
   vollständig abdecken; Inverter allein erlaubt keine positive Gutschrift.
2. Binär- und LPC-Eingänge ausdrücklich an ihre Gruppe/Messgrenze binden.
   Nur passende Umfänge dürfen als gemeinsames Minimum kombiniert werden.
   Unpassende aktive Gruppen müssen unabhängig durchgesetzt oder im neuen Modus
   mit genauer Diagnose gesperrt werden. Externe Gesamtbudgets bleiben unskaliert.
3. Tatsächliche positive Teilnehmeraufnahme und belegte Eigenversorgung strikt
   von Sollwerten und Reservierungen trennen. `coordinatedConsumptionLoads()`
   verwendet absichtlich `max(Ist, Befehl, Reserve)` und ist deshalb keine
   zulässige Quelle für Eigenstromgutschriften. Kein sich selbst finanzierender
   Stromschritt und kein eigener Eigenstrompool pro Wallbox.
4. Ganze NVP-Messgrenze, Speicher-AC-Umfang und Vorzeichen deklarieren. Ladung und
   Entladung getrennt behandeln; DC-/Hybridwerte nicht als AC-Teilnehmermessung
   ausgeben. PV/BHKW/Speicherwirkung im NVP nicht nochmals addieren. Ein
   NVP-Rest ist weder eine separat gemessene PV-Erzeugung noch eine vollständig
   gemessene Haushalts-Bruttolast; unbelegte Diagnosefelder bleiben unbekannt.
5. Gemeinsame Quellenkohärenz zusätzlich zu individuellem Alter/ACK/q prüfen.
   Alter NVP plus neue Gruppenlast und alte Gruppenlast plus neuer NVP nach
   Lastabfall können beide künstliche Eigenversorgung erzeugen. NULL oder
   unbekannte Qualität darf keine Budgeterhöhung erzeugen.
6. Teilnehmerabhängig begrenzen: Der heutige skalare Deckel umfasst auch EHZ und
   Heizpuffer. Nichtteilnehmer dürfen nicht als zusätzliche §14a-Einrichtung
   behandelt werden; ihre tatsächlichen und ausstehenden Lasten können jedoch
   die belegte verfügbare Eigenversorgung verringern.
7. Allocator und sämtliche unabhängigen Ausgangsprüfungen müssen dasselbe Ergebnis
   durchsetzen: parallele/sequenzielle Wallboxen, EHZ/Heizung, Einzel-/Mehrkopf-
   Speicher sowie erneute Prüfung nach wartenden Schreibaufträgen. Offene
   positive Stellwirkungen bleiben bis zum elektrischen Nachweis belastet.
   Hausanschluss-, Phasen-, Geräte-, ACK-/Antwort- und Neustartverträge erhalten.
8. Default und Migration behalten die konservative bisherige Wirkung. Keine
   automatische Aktivierung, Teilnehmererzeugung oder Erhöhung vorhandener Limits.
   Diagnose trennt Netzbudget, belegte Eigenversorgung, tatsächlichen
   Gruppennetzbezug, zulässiges Bruttobudget, Reserven und begrenzende Quelle.

## Nachweise vor einem späteren Abschluss

Die notwendige neue Regressionsfolge umfasst ohne PV, Überschuss, PV unter
Hauslast, schnelle Erzeugungsabnahme, beide Quellenversatzrichtungen,
NULL/ACK/q/Alter/Zukunft, mehrere Wallboxen und einmalige gemeinsame Vergabe,
WP-Gesamt-/Teilmessung und Zusätze, Speicher in beiden Richtungen, Teilnehmer-
und Nichtteilnehmerreservierungen, passende/unpassende gleichzeitig aktive
Gruppen sowie Migration. Integration über den produktiven Loader, unabhängige
Ausgänge und Quellenänderungen während einer Schreibqueue gehören dazu.

Unveränderte Ausgangsprüfung am genannten Commit:

| Prüfung | Ergebnis |
| --- | --- |
| Vollständiges `npm test`, Node 24.19.0 | 2.390 bestanden, 0 Fehler, 0 übersprungen |
| Vollständiges `npm test`, Node 22.23.3 | 2.390 bestanden, 0 Fehler, 0 übersprungen |
| `npm run test:package`, Node 22/24 | bestanden |
| `npm run test:artifact`, Node 22/24 | tatsächlich gepacktes/installiertes alpha.115: 193 Dateien, 719 States |

Der anfänglich unbeschreibbare npm-Homecache wurde durch einen expliziten
beschreibbaren Cache ersetzt. Das ist ein Umgebungsbefund, kein Codefehler.
Die Ergebnisse prüfen **bestehendes alpha.115**, nicht die fehlende #166-Funktion.

Erst nach erfüllter Voraussetzung und implementiertem, geprüftem Restumfang
folgen eine konsistente neue Version, abschließende CI, Main-Übernahme und ein
neuer Tag/Release. Keine Diagnoseversion. Natürliche aktive §14a-/LPC-Abnahme,
tatsächliche Messgrenzen und Energiepotenzial bleiben getrennt; Score 71/100,
Änderung 0. Die konkreten nächsten SQL-Prüfpunkte stehen im Diagnosefolgeplan.
