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

## Quellenprüfung nach Veröffentlichung der Umgebung, 21.10.2026

Die veröffentlichte Netzkonfiguration ist jetzt wirksam: aktueller Runtime-
Status mit `observations_current=true`, Revision 3 und Netzwerkstatus `enforced`.
Die offiziellen Domains sind erlaubt. Die frühere CONNECT-403-Sperre für
BNetzA/VDE ist aufgehoben. Folgende Originale wurden neu mit HTTP 200 geladen
und als HTML beziehungsweise mit `pdftotext -layout` gelesen:

| Quelle | Geprüfte Aussage für den Restumfang |
| --- | --- |
| [BNetzA-Verbraucherinformation](https://www.bundesnetzagentur.de/DE/Vportal/Energie/SteuerbareVBE/artikel.html) | Normaler Haushaltsverbrauch bleibt unberührt. Selbst erzeugter Strom wird nicht gegen die Netzbezugsgrenze verrechnet. Die zulässige Netzleistung gilt für die zugeordneten SteuVE. |
| [BK6-22-300 Anlage 1](https://www.bundesnetzagentur.de/DE/Beschlusskammern/1_GZ/BK6-GZ/2022/BK6-22-300/Beschluss/BK6-22-300_Beschluss_Anlage1.pdf?__blob=publicationFile&v=1), Ziff. 2.3, 2.4, 4.4–4.6 | Zeitgleicher netzwirksamer Bezug der zugeordneten Gruppe; WP inklusive Zusatz-/Notheizung, Speicher hinsichtlich Einspeicherung; gemeinsamer EMS-Sollwert. Netzsteuerung hat Vorrang vor marktlicher Steuerung. |
| [BNetzA Mitteilung 6](https://www.bundesnetzagentur.de/DE/Beschlusskammern/1_GZ/BK6-GZ/2022/BK6-22-300/Mitteilung/Mitteilung_06/Mitteilung_Nr_06.html?nn=877500) | Empfehlung der finalen FNN-Regeln innerhalb ihres jeweiligen Umfangs; keine darüber hinausgehende Erzeugungsfreigabe ableiten. |
| [VDE-FNN Mindestleistung, April 2025](https://www.vde.com/resource/blob/2384602/0cb47de901b1129acad8510257ecc582/vde-fnn-hinweis-mindestleistung-data.pdf), Kap. 2–4 | Keine Änderung der bestehenden Faktoren/Formeln empfohlen. Vorhandene GZF-/Budgetquellenberechnung wiederverwenden. |

SHA256 der tatsächlich geladenen PDF-Antworten:

- BNetzA Anlage 1: `c8cf59ea475bb4cb866e8b4eeb4b3e2b3306cb3f3ff1c432799b090bfb5b2d35`
- VDE-FNN: `d20fdf17b34370fe8e7878cf6c1e22ad5f3f8fa05d9bf31a2477e898da6cb067`

Die Quellen bestätigen einen Gruppen-Netzbezugsdeckel mit belegter
Eigenversorgung, liefern aber keine private ioBroker-Topologie. Gruppen-IDs,
AC-Messabdeckung, Quellenkohärenz und Reservierungsverfahren unten sind
technische Adapterverträge; sie werden nicht als einzelne vorgeschriebene
Normformel oder als Zertifizierung ausgegeben.

**Verbleibender Zugriffspunkt ist EEBUS.** `https://www.eebus.org/` liefert nach
45 s keinen Inhalt (curl Exit 28, 0 Bytes). Der einmal alternativ geprüfte
kanonische Host `https://eebus.org/` endet nach 25,002 s ebenfalls ohne Inhalt.
Die HTTP-200-Zeile der Proxy-CONNECT-Antwort ist keine erfolgreiche Antwort des
Ursprungsservers. Es wurde keine aktuell zugängliche, nachweislich offizielle
normative LPC-Spezifikation festgestellt. Öffentlicher Fremdadaptercode ist
dafür kein Ersatz und belegt auch nicht den tatsächlich installierten Endpunkt.
Die Ursache des Timeouts ist nicht nachgewiesen.

Die jüngste Anweisung verlangt zuerst erfolgreichen Zugriff auf die offiziellen
BNetzA-, VDE- und EEBUS-Quellen. Die EEBUS-Voraussetzung bleibt daher offen;
abhängige Runtimeänderungen werden noch nicht vorgenommen. Ein direkter
offizieller LPC-Spezifikationslink kann die nächste gezielte Prüfung ermöglichen.
Die frühere Aufforderung zur Veröffentlichung des Umgebungsentwurfs ist erledigt
und wird nicht wiederholt. Keine Installation oder Adapterveröffentlichung.

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
