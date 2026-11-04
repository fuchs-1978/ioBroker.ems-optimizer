# 0.17.0-alpha.198 — Istwertverteilung und Historienwiederherstellung

## Beobachtung und Ursache

Nach dem Neustart am 3. November 2026 um 20:45 Uhr blieb `Plan.Valid=false`; am 4. November um 00:10 Uhr meldete der Historienaufbau nach 4,4 Sekunden nur 15 Hauslast-/Grundlastwerte und 16 PV-Werte. Die Wochentagsprofile waren damit unvollständig. Das EMS lief, sperrte aber die normale Verteilung wegen des fehlenden Fahrplans.

Ein begrenzter SQL-Abruf eines Hauszählers für den 2. November lieferte später 98 numerische Viertelstunden-/Randwerte. Die alte Historie war somit weiterhin abrufbar. Der genaue Auslöser der ersten leeren Antworten ist durch die verfügbaren Startprotokolle nicht bewiesen. Ein SQL-Anlaufproblem ist eine mögliche Erklärung, kein nachgewiesener Ablauf.

Zwei Softwarefehler sind reproduzierbar:

1. Der Historiencache verschob seine Lesemarke auch bei leeren Tagesantworten. Spätere Builds lasen überwiegend den aktuellen Rand; früher leer gelieferte Tage blieben leer. Ein ohne Ausnahme beendeter, aber unvollständiger Build löschte außerdem den Wiederholungsbedarf.
2. Die Echtzeitregelung verlangte einen gültigen aktuellen Fahrplan. Ohne Plan gab es nur den Sonderweg für manuelle Mindestladung, keine normale Verteilung des gemessenen Überschusses.

## Verhalten ab dieser Version

- Leere Tagesantworten bleiben vorläufig. Der nächste Aufbau liest diese Zeiträume erneut, zusätzlich zum überlappenden aktuellen Rand. Gefüllte abgeschlossene Tage bleiben im Prozesscache. Ein leeres Update löscht keine vorhandenen Messwerte.
- Vor dem Aufbau müssen Historienadapter und bei `sql.N` die SQL-Verbindung bestätigt bereit sein. Bestätigte Fehler und unvollständige Profile führen zu drei Wiederholungen im Minutenabstand; danach folgt eine Pause von 15 Minuten vor der nächsten Gruppe. Solange eine SQL-Abfrage noch unbeantwortet ist, startet keine weitere Historienabfrage. Ein bereits vollständiges Profil bleibt bei unvollständiger Aktualisierung erhalten.
- Bei ungültigem Plan, fehlendem aktuellem Pflichtslot oder einem mehr als 20 Minuten alten bzw. ungültigen Berechnungszeitpunkt nutzt die normale Regelung neutrale interne Planwerte und verteilt anhand der Istwerte. Sie setzt dadurch weder `Plan.Valid` noch `History.Ready` auf wahr und veröffentlicht keinen künstlichen Fahrplan.
- Fahrzeugpriorität, Mindest-SoC und manuelle Mindestladung behalten ihre normalen Regeln. Einzel- und Parallelverteilung, EHZ-Freigaben, elektrische Phasen-/Netzgrenzen, Quellenqualität, Gerätefehler, bestätigte Abschaltung und Leistungsreservierungen bleiben wirksam. Normale Mindestlauf- und Stoppzeiten gelten auch beim Entfernen einer manuellen Mindestvorgabe.
- Preisfahrplan-Freigaben für Fahrzeug/Speicher, günstiger Netzstrom für Wärme und geplanter PV-Boost bleiben im Ersatzbetrieb aus. Eine Mindest-SoC-/manuelle Ladefreigabe kann nach den bestehenden Regeln weiterhin Netzbezug erlauben; Ersatzbetrieb bedeutet daher nicht grundsätzlich null Netzbezug.
- Live-basierte Fahrzeugübergabe und Taper-Erkennung benötigen keinen Prognosefahrplan. Ein abgesenkter Strom gibt sein reserviertes Budget weiterhin erst nach unabhängiger Bestätigung frei.
- Die Neustartübernahme akzeptiert auch frisch nach dem Neustart bestätigte gültige Istwert-Reglerdaten. Alte gespeicherte Ersatzbetriebsmarkierungen, schlechte Qualität und unbestätigte oder zukünftige Meldungen reichen nicht.
- Sobald wieder ein echter aktueller Plan vorliegt, berechnet der Regler seine langsamen Ziele sofort neu und kehrt automatisch zum Planbetrieb zurück.

## Diagnose

| Datenpunkt | Bedeutung |
| --- | --- |
| `Control.PlanFallbackActive` | Istwertverteilung ohne nutzbaren aktuellen Fahrplan aktiv |
| `Control.PlanFallbackStatus` | Grund und eingeschränkte Fahrplanberechtigungen |
| `Control.PlanSlotTimestamp` | Im Ersatzbetrieb 0; sonst verwendeter echter Planslot |
| `Control.Valid` | Gültigkeit der tatsächlichen Regelberechnung, unabhängig von Prognosebereitschaft |
| `Plan.Valid` / `History.Ready` | Weiterhin echte Prognose-/Historienbereitschaft |

## Prüfung und Grenzen

Die neuen Regressionen reproduzieren acht Fehler auf alpha.197: vier Historien-/Cachefälle und vier fehlende-Plan-Verteilungen. Die korrigierte Version prüft reale Allokator- und Ausgangszustandsmaschinen mit verzögerten Gerätebestätigungen, ohne Anlagenzugriffe: Einzel-/Parallelbetrieb mit Fahrzeug und EHZ, Schutzsperren bei vorhandenem Überschuss, Planrückkehr, fehlende Preis-/Boostberechtigungen, qualifizierte Neustartübernahme und bestätigte Taper-Budgetübergabe. Der Schattenregler verwendet bei fehlendem aktuellem Slot ebenfalls den echten Istwert-Allokator; seine übergeordneten Frische- und Schreibsperren bleiben bestehen.

Dies ist Software- und Simulationsnachweis. Die Installation und der natürliche Anlauf der Anlage müssen anschließend `Control.PlanFallbackActive`, einen wieder aufgebauten echten Plan und die tatsächliche Leistungsübernahme bestätigen. Fehlende SQL-Aufzeichnungen oder Wetterdaten werden nicht erfunden. Ein gesunder aktueller Abruf beweist weder die ursprüngliche Fehlerursache noch die Vollständigkeit aller historischen Quellen. Keine automatische SQL-Neustart-, Installations- oder Anlagenparameteränderung gehört zu diesem Fix.
