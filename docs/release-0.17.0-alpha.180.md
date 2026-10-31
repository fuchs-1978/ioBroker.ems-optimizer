# 0.17.0-alpha.180 – vorhandene Raumtemperaturhistorien laenger erhalten

Bereits in SQL aktivierte Originalreihen fuer Raum-Isttemperatur und wirksame Solltemperatur werden wiederverwendet. Es gibt **keine zweite Temperaturhistorie, keinen neuen Temperatur-Snapshot und keine kopierten Messwerte**. Fuer zugeordnete Quellen wird ausschliesslich die bestehende SQL-Aufbewahrung auf mindestens 90 Tage verlaengert. Laengere Fristen sowie unbegrenzte Aufbewahrung bleiben erhalten. Abtastrate, Entprellung, Aenderungsfilter, Wiederholintervall, Alias und andere vorhandene Einstellungen werden unveraendert an SQL uebergeben und danach auf unveraenderten Bestand geprueft.

## Einrichtung

Im Prognose-/Historienreiter:

- `roomHistoryEnabled`: standardmaessig an; ohne zugeordnete Quellen keine SQL-Aenderung.
- `roomHistoryRetentionDays`: 90 Tage, einstellbar zwischen 14 und 365 Tagen; nur verlaengern, niemals automatisch verkuerzen.
- `roomHistoryRooms`: maximal 20 Eintraege mit Raumname, Heizungsart (`hydronic`, `electric`, `unknown`), `actualId` und `setpointId`. Keine installationsspezifischen Datenpunkt-IDs im Code oder in Standardwerten.

Als alternative ausdrueckliche Laufzeitzuordnung kann `Config.RoomHistory.Rooms_JSON` dieselbe Liste enthalten. Ein nichtleerer Wert hat Vorrang vor der Admin-Tabelle; leer bedeutet Admin-Tabelle verwenden. Die Liste wird im Minutenabstand auf Aenderungen geprueft, ohne Quellwerte zu lesen. Nach erfolgter Bearbeitung wird dieselbe Liste in diesem Prozess nicht wiederholt angewandt. Ungueltige Listen fuehren zu keiner SQL-Aenderung. Ein leerer Arraywert deaktiviert die Zuordnung, loescht oder verkuerzt aber keine vorhandenen Historien. Ausschalten beendet kuenftige Verwaltung; alte Daten und Einstellungen bleiben erhalten.

Beispiel mit bewusst allgemeinen Quellen:

```json
[
  {"name":"Wohnbereich","heatingType":"hydronic","actualId":"knx.0.room.actual","setpointId":"knx.0.room.setpoint"},
  {"name":"Elektrisch beheizter Raum","heatingType":"electric","actualId":"knx.0.electric.actual","setpointId":"knx.0.electric.setpoint"}
]
```

Nur bereits aktivierte numerische Originalquellen in °C werden beruecksichtigt. Fehlende Objekte, nicht aktivierte SQL-Aufzeichnung, unbekannte Aufbewahrung, Wildcards, doppelte IDs, eigene Adapterzustaende und Systemobjekte werden abgelehnt bzw. ausdruecklich als ungeprueft gemeldet. Die Verwaltung aktiviert keine neue Temperaturhistorie und schreibt keinen KNX-Sollwert oder Aktor.

## Nachweise und Grenzen

`Debug.RoomHistory.Status` zeigt den Umfang gepruefter Quellen. `Debug.RoomHistory.Status_JSON` enthaelt Quellenzuordnung, getrennte Heizungsart, Pruefzeit und Ergebnis pro Quelle; keine Temperaturkopien. Die Statuszustaende bekommen keine automatische SQL-Aufzeichnung.

SQL-Antwort und zurueckgelesene Metadaten werden geprueft. Das belegt keine vollstaendige Zustellung aller Messwerte. Fehlgeschlagene/unklare Aenderungen werden in diesem Prozess fuer dieselbe Liste nicht automatisch wiederholt; eine Fristueberschreitung beweist keinen Backendabschluss. Bereits geloeschte Altwerte werden nicht wiederhergestellt. Eine laengere Datenbasis entsteht durch Erhalt kuenftiger Originalwerte.

Fuer die konkrete Auswahl sind Kueche, Wohnzimmer, Bad sowie drei Kinderzimmer vorgesehen. Der elektrisch beheizte Raum bleibt getrennt gekennzeichnet. Wirksamen Sollwert verwenden, nicht einen unbestaetigten Schreibbefehl oder eine leere Vorgabe. Eine Heizungsart ist eine Zuordnung, kein gemessener Leistungs-/Waermenachweis.

Die bisherigen Last-/Wetterquellen kommen aus der Adapterkonfiguration. Die Merkmalsdefinition der 16-dimensionalen Lasso-Vergleichsprognose ist dagegen im Code festgelegt. Raumwerte werden durch diese Version **noch nicht zu Lasso-Merkmalen** und beeinflussen keine produktive Prognose oder Steuerung. Spaetere Waerme-/Elektroheizmodelle benoetigen passende Leistungs-/Waermemessungen und zeitlich verfuegbare Eingangsmerkmale.
