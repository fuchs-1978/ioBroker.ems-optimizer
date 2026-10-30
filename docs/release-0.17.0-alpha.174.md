# 0.17.0-alpha.174 – kleine Rueckwaertsschwankungen des Ladeenergiezaehlers

Beobachtung: Der go-e-Zaehler fiel von 15,007747222222223 kWh auf 15,007702777777777 kWh – rund 0,044 Wh. Die bisherige strikte Monotoniepruefung behandelte dies wie einen Zaehlerreset, setzte die manuelle SoC-Basis bei zuletzt rund 99,30 % aus und veroeffentlichte null/SoCValid=false. Eine VIS kann null faelschlich als 0 anzeigen; es war kein realer leerer Akku.

Der gemeinsame SoC-Schaetzer haelt bei Rueckwaertsschwankungen bis einschliesslich 1 Wh den zuletzt gespeicherten hoechsten Energiestand. Eine anschliessende Erholung zaehlt dadurch nicht doppelt. Die Toleranz bezieht sich immer auf den festen Hoechststand; wiederholte kleine Rueckgaenge koennen nicht zu einer beliebig grossen Gesamttoleranz werden. Die fremden go-e-Rohdaten werden nicht veraendert.

Groessere Rueckgaenge, echte Resets, Quellenfehler, alte Zeitstempel und unplausible positive Energiespruenge bleiben abgesichert. Die Normalisierung aendert keine Messzeitpunkte oder Qualitaetsmerkmale. Sie gilt fuer die gemeldete sowie manuell korrigierte SoC-Fortschreibung.

Regressionen bilden den real beobachteten Bruchwert, Neustart, wiederholte Dellen und Rueckkehr ohne Doppelzaehlung, kumulative Rueckgaenge ueber 1 Wh, echte Resets sowie ungueltige/alte Zaehlerdaten ab. Eine bereits ausgesetzte Basis wird nicht ohne neue Pruefung reaktiviert. Nach Installation aktuellen Fahrzeug-/App-SoC pruefen und bei Bedarf erneut unter SoCCorrection_pct mit ack=false eintragen.
