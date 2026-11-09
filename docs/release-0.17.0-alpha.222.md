# 0.17.0-alpha.222

- Der Admin-Schalter „Mindest-SoC bis zur Abfahrt einplanen“ ist pro Fahrzeug vorhanden und standardmäßig aus. Mit ausgeschaltetem Schalter löst der Mindest-SoC weiterhin Sofortladung aus.
- Für die neue Planung braucht das EMS eine gültige Abfahrtszeit, eine gültige Preisladesitzung, aktivierte Abfahrts- und Preisladung sowie eine Mobilitätsreserve größer null und kleiner als der Mindest-SoC.
- Die Mobilitätsreserve wird sofort gedeckt. Der restliche Bedarf bis zum Mindest-SoC wird nach nutzbarer PV in den günstigsten verfügbaren Preisfenstern vor der Abfahrt eingeplant.
- Für den Mindest-SoC kann das EMS bei Bedarf teurere Intervalle einplanen, auch oberhalb der Preisobergrenze für freiwillige Ladung. Für die optionale Netzladung bis zum Ziel-SoC gilt weiter deren Preisobergrenze.
- Bei fehlenden oder ungültigen Voraussetzungen oder wenn der Plan den Bedarf bis zur Abfahrt rechnerisch nicht decken kann, greift die bisherige Sofortladung bis zum Mindest-SoC. Die Wallbox prüft weiterhin ihre Geräte- und Anschlussgrenzen.
