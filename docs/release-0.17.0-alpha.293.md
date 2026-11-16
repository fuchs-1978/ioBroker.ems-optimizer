# 0.17.0-alpha.293

Im Admin unter der historischen Grundlast-Profilmethode **50/50 Median + Lasso** auswählen und den Median-/Lasso-Vergleich aktivieren. Median bleibt die Standardmethode.

Die optionale Fahrplanprognose verwendet ausschließlich timestampgleiche Paare aus der eingefrorenen Vortagsprognose. Unvollständige, verspätete oder für andere Quellen erzeugte Prognosen sowie die separat gespeicherte Lasso-Interpolation liefern keine paarweise Fahrplanbasis. Viertelstunden ohne gültiges Paar nutzen das etablierte Medianprofil. Der Grundlast-Mindestwert bleibt bei beiden Methoden wirksam. In `Forecast.Baseload_48h_JSON` zeigt `source` im 50/50-Modus je Viertelstunde die verwendete Methode.

Bei einem rollierenden 48-Stunden-Plan können Randstunden des übernächsten Tages auf Median bleiben. Die Vergleichsaufzeichnung und die direkten Schutz- und Gerätefreigaben behalten ihre Gültigkeit. Zur Rückkehr die Profilmethode im Admin auf **Median** setzen.
