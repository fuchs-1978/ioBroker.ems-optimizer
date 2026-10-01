# Tarife und Preisquellen ab alpha.24

Der Reiter **Preise & Tarife** trennt den Energieanteil vom Netzentgelt.
Beide können unabhängig fest oder zeitabhängig verwendet werden. Die vorhandenen
Freigabeschalter einschließlich externer Schalter bleiben wirksam.

## Jahresprofil für Netzentgelte

Als Netzentgeltquelle **Jahrestarif / Zeitfenster** auswählen. Tarifjahr,
Preisbasis (netto oder brutto) und Standard-, Hoch- und Niedrigtarif eingeben.
Die Tabelle legt je Quartal Beginn, Ende und Tarifstufe fest. `24:00` ist als
Tagesende erlaubt. Zeiten werden in **Europe/Berlin** ausgewertet; auch die
doppelte Herbststunde und die fehlende Frühlingsstunde verwenden echte
Zeitstempel. Lücken, Überschneidungen und ein abgelaufenes Tarifjahr ergeben
keinen vermeintlich gültigen Standardpreis.

Das vorbelegte, bearbeitbare Beispiel stammt aus dem öffentlichen
[Avacon-Preisblatt 2026](https://www.avacon-netz.de/content/dam/revu-global/avacon-netz/documents/netzentgelte-strom/2026/Preisbl%C3%A4tter_AVANG_Strom_01.01.2026%20%281%29.pdf),
Seiten 12–13, Stand 10.12.2025. Es muss zum tatsächlich vereinbarten Tarif passen:

| Stufe | Netto ct/kWh | Brutto ct/kWh |
|---|---:|---:|
| Standard | 6,04 | 7,19 |
| Hoch | 8,41 | 10,01 |
| Niedrig | 0,60 | 0,71 |

Im ersten und vierten Quartal gilt Niedrigtarif von 23:00 bis 05:00,
Hochtarif von 16:30 bis 21:00 und sonst Standardtarif. Im zweiten und dritten
Quartal gilt durchgehend Standardtarif. Die Eingabetabelle teilt das
Nachtfenster an Mitternacht. Alle Wochentage haben in diesem Beispiel dasselbe
Profil. Die Netzentgeltprognose benötigt dafür keine Börsenpreis-JSON-Reihe.

## Netto, brutto und fester Gesamtarbeitspreis

Alle veröffentlichten Preisprognosen und preisabhängigen Schwellen beziehen
sich auf **ct/kWh brutto**. Bei Nettoeingaben wird die konfigurierte Umsatzsteuer
einmal angewendet. Die Basis externer Börsenpreise und des Jahrestarifs ist
getrennt auswählbar. Bereits enthaltene Abgaben dürfen nicht ein zweites Mal
als Aufschlag eingetragen werden.

Im Modus **Energieanteil** ist der Festwert ausdrücklich ohne Netzentgelt
anzugeben. Alternativ lässt sich ein **Gesamtarbeitspreis bei Referenz-Netzentgelt**
eingeben. Beide Eingaben dieses Modus sind brutto. Die Berechnung lautet:

`Gesamtarbeitspreis − enthaltenes Referenz-Netzentgelt + aktuelles Netzentgelt`

Rechenbeispiel mit frei gewähltem Gesamtarbeitspreis: 30,00 ct/kWh bei
7,19 ct/kWh Referenz-Netzentgelt ergeben 22,81 ct/kWh verbleibenden Energieanteil.
Bei 0,71 ct/kWh Niedrigtarif beträgt der Gesamtpreis 23,52 ct/kWh, beim
Standardtarif weiterhin 30,00 ct/kWh. Monatliche Grundpreise sind keine
verbrauchsabhängigen Arbeitspreise und gehören nicht in diese Rechnung.

## Börsenpreise

**Energy-Charts (DE-LU)** lädt veröffentlichte Viertelstundenpreise direkt
von der [Energy-Charts API](https://api.energy-charts.info/). Die Quelle wird
als EUR/MWh netto geprüft und in ct/kWh netto übernommen; die gemeinsame
Preisberechnung ergänzt die konfigurierten Aufschläge und Umsatzsteuer.
Das Umschalten der Quelle allein aktiviert keinen dynamischen Energiepreis:
Der zugehörige Freigabeschalter bestimmt weiterhin, ob der Festtarif oder die
Börsenreihe in die Planung eingeht.

Die API wird regelmäßig aktualisiert. Noch nicht veröffentlichte Zeiträume
bleiben unbekannt. Aus Stundenwerten werden keine unterschiedlichen
Viertelstundenpreise erfunden. Die alternative externe Quelle kann weiterhin
gültige Stunden- oder Viertelstundenprodukte liefern; explizite Intervallenden
haben Vorrang. Ein fehlendes Viertelstundenprodukt wird nicht mit dem
Stundenanfang oder einem alten Preis aufgefüllt.

Datenquelle und Namensnennung: **Energy-Charts.info, Fraunhofer ISE**.
Die API nennt [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/)
als Standardlizenz; zusätzliche quellenspezifische Hinweise bleiben maßgeblich.
[API-Dokumentation](https://api.energy-charts.info/openapi.json).

## Datenlücken und Umstieg

`Forecast.PriceStatus` erklärt fehlende Intervalle. `Forecast.PriceValid`
bezeichnet die Vollständigkeit der gesamten 48-Stunden-Preisreihe; bei noch
nicht veröffentlichten Börsenpreisen kann dieser Wert regulär falsch sein.
Jeder einzelne JSON-Preisslot trägt zusätzlich `valid` und `reason`.
`Control.ThermalPriceValid` bewertet den aktuell verwendbaren Gesamtpreis.
Bei direktem Abruf zeigen `Market.Source`, `Market.Status`,
`Market.Resolution_min` und `Market.LastUpdate` Quelle und Abrufzustand.
`Market.Valid` gilt nur für das aktuelle Lieferintervall; `Market.ValidUntil`
ist das Ende des letzten bekannten Intervalls und garantiert keine Lückenfreiheit.

Die Preisprognose markiert ungültige Intervalle. Diagramme zeigen Lücken;
Preisquantile und wirtschaftlich begründetes Netzladen verwenden nur gültige
Preise. PV-Nutzung und anderweitig zwingende Fahrzeugladebedarfe bleiben
von der Preisverfügbarkeit getrennt. Ein bekannter Netzpreis bleibt sichtbar,
auch wenn für den Energieanteil noch kein Börsenpreis vorliegt.

Beim Update bleiben externe Quellen und bisherige Zahlen erhalten. Die neue
Jahrestarifquelle und die direkte Börsenquelle werden bewusst im Admin gewählt.
Die bisherige Addition ohne Steuerumrechnung wird durch die Vorgabe „brutto“
numerisch erhalten; dies bestätigt nicht, dass alte Eingaben tatsächlich brutto
waren. Bestehende Werte anhand des Liefervertrags prüfen oder den Modus mit
Gesamtarbeitspreis und Referenz-Netzentgelt verwenden. Es werden keine
Gerätefreigaben und kein EMS-Master automatisch aktiviert.

Der 48-Stunden-Fahrplan hat weiterhin 15-Minuten-Schritte. Neue Eingangsdaten
können eine frühere Neuplanung auslösen. Die schnellen Regelzyklen für
Netzleistung, Wallboxen, Heizstäbe und Speicher werden nicht auf 15 Minuten
verlangsamt.
