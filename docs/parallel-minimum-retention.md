# Laufende Mindestladung bei Peer-Nachlauf

## Beobachteter Anlass

Am 09.10.2026 im produktiven Betrieb von 0.17.0-alpha.54 erreichte WB0 Mii
gegen 02:51 Uhr Europe/Berlin seinen Mindest-SoC von 70 %. WB1 EQV lag
weiterhin bei 79 % unter seinem Mindest-SoC von 80 %. Beide Fahrzeuge luden
einphasig mit einer Vorgabe von 6 A. Preisbedingte Ladung war deaktiviert,
PV-Leistung im untersuchten Ereignis 0 W.

Der vollständig rekonstruierte Ereignisausschnitt umfasst Sitzung
`1791489026293`, Sequenzen `91676–92041`, ohne interne Sequenzlücke oder
gemeldeten Schreibverlust. Er belegt den Zustand unmittelbar vor dem Stopp
und den Wiederanlauf; eine vollständige nächtliche Befehlsanalyse wird damit
nicht behauptet. Die gültige Vollbasis 91676 vom 09.10.03:01:02 zeigt:

- Mii: kein Mindestbedarf, Mindestzuteilung 0 W, reservierte Leistung 1.380 W.
- EQV: Mindestbedarf aktiv, Mindestzuteilung 1.380 W, reservierte Leistung
  1.380 W, aber Zielstrom 0 A.
- Beide Stopptimer: noch 4 s; konfigurierte Ausschaltverzögerung 600 s.
- Gültige Netz- und Gerätequellen; kein gemeldeter Ausgangsfehler.

Um 03:01:06 erfolgten reale AUS-Befehle an beide Wallboxen, mit ACK=true
und Qualität 0 etwa 03:01:06,4. Der Mii lieferte um 03:01:17,632 erstmals
0 W, der EQV um 03:01:18,384. Nach frei gewordener Mii-Reservierung erhielt
der EQV um 03:01:23 wieder 6 A Budget. EIN-Befehl: 03:01:28,025;
ACK: 03:01:28,250; gemessene Leistung 1.300 W: 03:01:48,334.
Die interne gemessene Ladepause betrug rund 30 s. Die Fahrzeugantwort nach
EIN lag innerhalb der eingestellten 45-s-Frist und ist kein eigener Fehler.

Die regelmäßigen Budgetziele am Anfang der Nullzuteilung um 02:51 wurden
nicht vollständig rekonstruiert; deren genauer Beginn bleibt offen. Die
Zuordnung unmittelbar vor den AUS-Befehlen und der Wiederanlauf sind belegt.
Der spätere EQV-Stopp um 03:37 nach Erreichen seines Mindest-SoC gegen
03:27 gehört zum normalen Ladeende und nicht zu dieser internen Pause.

## Ursache und eng begrenzte Korrektur

Die gemeinsame weiche Fahrzeugzuteilung sank auf den verbleibenden
Mindestbedarf von 1.380 W. Die noch gebundene Mii-Reservierung wurde vom
weichen EQV-Deckel abgezogen. Der EQV erhielt dadurch 0 A, obwohl seine
bereits laufende Mindestladung weiterhin benötigt wurde. Beide
Ausschaltverzögerungen liefen ab.

Ab alpha.55 erhält nur eine bereits aktive, EMS-eigene und bestätigte
einphasige Mindestladung einen weichen Mindestdeckel. Voraussetzungen sind
gültige Quellen, eine Vorgabe mindestens in Höhe des konfigurierten
1P-Mindeststroms, bestätigte 1P-Topologie, frische reale EIN-/Stromrückmeldung
und elektrische Last. Eine laufende oder offene Phasenumschaltung qualifiziert
nicht. Neue Starts bekommen keine zusätzliche Berechtigung.

Der harte gemeinsame Deckel zählt weiterhin Peer- und Heizstabreservierungen,
bereits verteilte Leistung und die anderen Mindestzuteilungen. Der produktive
Ausgang prüft zusätzlich die realen Hausphasen, §14a-/Netzbetreiber- und
Gerätegrenzen. Reservierte Leistung wird nicht vorzeitig frei gegeben. Der
Mii-Zielstrom bleibt 0 A; seine eingestellte Stoppverzögerung wird nicht
verlängert. Der sequenzielle Betrieb und das Schattenmodell erhalten keine
produktive Fortsetzungsausnahme.

Die bestehende Zuteilungsdiagnose ergänzt `runningMinimumW`: qualifizierter
laufender Mindestbedarf vor Anwendung der harten Deckel. Ein positiver Wert
ist kein Beweis für reale Ladung oder eine tatsächlich erteilte Zuteilung;
`targetA`, `safetyBudgetW`, Befehle, ACK und elektrische Antwort gemeinsam prüfen.

## Regressionen und nächste Betriebsprüfung

Die Regressionen verwenden die echten Engine-Dateien mit expliziten
Quellenzuständen. Zwei neue Ladefortsetzungsfälle scheitern am unveränderten
alpha.54-Code und bestehen mit der Korrektur:

1. Mii erreicht Mindest-SoC, EQV liegt darunter: Ziele 0/6 A, Mii-Reservierung
   bleibt bestehen, auch nach erneutem Reglerzyklus.
2. Von drei laufenden Fahrzeugen erreicht eines den Mindest-SoC: Die beiden
   anderen behalten 6 A unabhängig von der Prioritätsreihenfolge.

Zusätzliche Schutzfälle prüfen knappe harte Kapazität inklusive Heizstab,
neue inaktive Fahrzeuge, ungültige Quellen sowie 3P-/Phasenwechsel- und
unbestätigte EIN-Rückmeldungen. Bei knapper realer Kapazität bleibt eine
Fortsetzung gesperrt, bis elektrische Freigabe der reservierten Leistung
belegt ist. Bestehende Ausgangstests prüfen die unabhängigen Schutzgrenzen.

Nach manueller Installation bei einem passenden echten Ereignis prüfen:

- Das Fahrzeug oberhalb Mindest-SoC erhält Ziel 0 und endet nach seinem
  tatsächlichen Stopptimer.
- Das bereits ladende Fahrzeug unter Mindest-SoC behält Mindestziel und
  reale Freigabe ohne internen AUS-/EIN-Zyklus, sofern die harten Grenzen
  ausreichen; seine Leistung bleibt mit vorhandener Pollauflösung belegt.
- Reservierungen bleiben bis zur bestätigten elektrischen Reaktion erhalten.
- Bei tatsächlich knappem Schutzbudget oder ungültigen Quellen wird die
  Ausnahme nicht als Erfolg gewertet; die wirksame Begrenzung bleibt belegt.

Softwaretests ersetzen keine reale Mehrfahrzeugabnahme. Keine automatische
Installation, Aktor- oder Konfigurationsänderung und keine zugesagten
Scorepunkte. Bezug: Issues #7 und #116.
