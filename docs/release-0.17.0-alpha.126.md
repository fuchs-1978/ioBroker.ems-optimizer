# 0.17.0-alpha.126 – EMS-SoC statt externer SOCmin-Freigabe

## Anlass und Ursache

Am 23.10.2026 um 09:33 MESZ war beim Mii eine manuelle Mindestladung mit 6 A eingestellt. Der gültige EMS-SoC betrug 51 %, das Ladeziel 90 %. Der Nutzer bestätigte die 51 % anhand der Seat-App. Das bisherige externe Skript `PV_Ueberschuss_SOCmin` verwendete dagegen einen alten SoC von 94 % und lieferte `socfrei0=0`. Der Adapter behandelte deshalb die manuelle Mindestladung nicht als Pflichtladung und erteilte bei fehlendem PV-Startbudget keine Freigabe.

Die konkrete Ursache war die zusätzliche Bedingung `legacyRelease > 0` bei der manuellen Mindestladung. Sie bestand sowohl in der aktuellen Fahrzeugbewertung als auch im zukünftigen Fahrplan.

## Änderung

- Für alle drei Wallboxen entscheiden der gültige EMS-SoC (einschließlich der vorhandenen Fortschreibung aus Ladeenergie), EMS-Mindest-/Ziel-SoC und die Benutzerfreigabe. Die manuelle Mindestladung benötigt keine externe `socfrei`-Freigabe mehr.
- Die Fahrplanberechnung verwendet dieselbe SoC-Grundlage. Ein fremder `socfrei`-Wert kann weder die manuelle Ladung sperren noch sie bei ungültigem SoC oder erreichtem Ziel erzwingen.
- `LegacySoCRelease` und die bestehende Eingangszuordnung bleiben als optionale Vergleichsdiagnose kompatibel erhalten, ohne Einfluss auf Ladeentscheidung oder Priorität. Die Admin-Hilfe kennzeichnet das ausdrücklich.
- Nach manueller Installation dieser Version kann das alte Skript `EV-Charge → PV_Ueberschuss_SOCmin` ausgeschaltet bleiben. Andere Helfer, insbesondere Sicherungs-/Leistungsgrenzen, Min-/Max-Eingaben und der EMS-Phasenfolger, werden dadurch nicht überflüssig.

Benutzerfreigabe, Anschluss-/Gerätezustand, Quellenqualität, gültiger SoC, Zielabschaltung, Phasenfreigabe, Leistungs-/Hausanschluss-/§14a-Grenzen sowie vorhandene Start-, Stopp- und Reaktionsfristen gelten weiterhin. Eine manuelle Stromvorgabe setzt keine Schutzgrenze außer Kraft.

## Prüfungen und Grenzen

Die Regressionen prüfen alle drei Wallboxen mit gesperrtem, positivem oder fehlendem Legacy-Signal, widersprüchlichem Alt-SoC, fehlender Benutzerfreigabe, abgestecktem Fahrzeug und ungültigen/veralteten/unbestätigten SoC-Quellen. Weitere Fälle prüfen Zielabschaltung durch den intern aus Ladeenergie fortgeschriebenen SoC und die Verteilung des manuellen Mindestbudgets gegenüber dem Heizstab.

Die deterministische Anlagenmodell-Prüfung führt den realen Allocator und die Ausgangszustandsmaschine aus: Mii-Start mit 6 A ohne Legacy-Freigabe, verzögerte ACK und elektrische Antwort, Zielabschaltung und elektrische Ruhe, jeweils mit und ohne parallele Ladeverteilung. Eine §14a-Leistungsgrenze unterhalb des Mindestladestroms verhindert den Start. Es werden keine realen Geräte angesprochen.

GitHub prüft vor der Veröffentlichung die vollständige Testsuite, Paket-/Installationsartefakt und die bestehenden Äquivalenzverträge unter Node.js 22 und 24. Softwaretests ersetzen keine reale Betriebsabnahme. Nach Installation sind der tatsächliche Ladebeginn, ACK/Leistungsantwort und die Zielabschaltung in der Betriebshistorie gesondert zu prüfen; aus dem Release folgen keine Scorepunkte.

Keine automatische Installation und keine Änderungen an ioBroker, Skripten, Freigaben oder Aktoren durch diesen Auftrag.
