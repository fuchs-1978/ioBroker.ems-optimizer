function observe() {
    const invalid = [];
    const pv = readFreshNumber(CFG.dp.pvPower, invalid);
    const gridImport = readFreshNumber(CFG.dp.gridImport, invalid);
    const gridExport = readFreshNumber(CFG.dp.gridExport, invalid);
    const outside = readFreshNumber(CFG.dp.outsideTemp, invalid, false);
    const dhwTemp = readFreshNumber(CFG.dp.dhwTemp, invalid, false);
    const submeterValues = CFG.dp.houseMetersW.map(id => readFreshNumber(id, invalid));
    const wallboxes = Math.round(sum(CFG.dp.wallboxesKW, 1000));
    const myPvDhw = Math.round(sum(CFG.dp.myPvDhwW));
    const myPvHeating = Math.round(sum(CFG.dp.myPvHeatingW));
    const gridPower = Math.round(gridImport - gridExport);
    const houseLoad = Math.max(0, Math.round(pv + gridImport - gridExport));
    const flexible = wallboxes + myPvDhw + myPvHeating;
    const submetersTotal = Math.max(0, Math.round(submeterValues.reduce((a, b) => a + b, 0)));
    const includedFlexible =
        (Boolean(getState(`${CFG.root}.Config.WallboxesIncludedInSubmeters`)?.val) ? wallboxes : 0)
        + (Boolean(getState(`${CFG.root}.Config.MyPV_DHW_IncludedInSubmeters`)?.val) ? myPvDhw : 0)
        + (Boolean(getState(`${CFG.root}.Config.MyPV_Heating_IncludedInSubmeters`)?.val) ? myPvHeating : 0);
    const baseload = Math.max(0, submetersTotal - includedFlexible);
    const haFreePower = Math.max(0, readNumber(CFG.dp.haFreePower, 0));
    const haCritical = Boolean(getState(CFG.dp.haCritical)?.val);

    write(`${CFG.root}.Actual.PV_W`, Math.round(pv));
    write(`${CFG.root}.Actual.GridImport_W`, Math.round(gridImport));
    write(`${CFG.root}.Actual.GridExport_W`, Math.round(gridExport));
    write(`${CFG.root}.Actual.GridPower_W`, gridPower);
    write(`${CFG.root}.Actual.HouseLoad_W`, houseLoad);
    write(`${CFG.root}.Actual.SubmetersTotal_W`, submetersTotal);
    write(`${CFG.root}.Actual.Baseload_W`, baseload);
    write(`${CFG.root}.Actual.House1_W`, Math.round(submeterValues[0]));
    write(`${CFG.root}.Actual.House2_W`, Math.round(submeterValues[1]));
    write(`${CFG.root}.Actual.Hall_W`, Math.round(submeterValues[2]));
    write(`${CFG.root}.Actual.Apartment_W`, Math.round(submeterValues[3]));
    write(`${CFG.root}.Actual.Wallboxes_W`, wallboxes);
    write(`${CFG.root}.Actual.MyPV_DHW_W`, myPvDhw);
    write(`${CFG.root}.Actual.MyPV_Heating_W`, myPvHeating);
    write(`${CFG.root}.Actual.FlexibleLoads_W`, flexible);
    write(`${CFG.root}.Actual.OutsideTemperature_C`, outside);
    write(`${CFG.root}.Actual.DHWTemperature_C`, dhwTemp);
    write(`${CFG.root}.Actual.HAFreePower_W`, Math.round(haFreePower));
    write(`${CFG.root}.System.InvalidInputs_JSON`, JSON.stringify(invalid));
    write(`${CFG.root}.System.DataValid`, invalid.length === 0);
    write(`${CFG.root}.System.LastUpdate`, Date.now());

    recommend({pv, gridExport, haFreePower, haCritical, invalid});
}

function recommend(x) {
    const r = CFG.root;
    if (!historyReady) {
        write(`${r}.Recommendation.Valid`, false);
        write(`${r}.Recommendation.PVBoostRelease`, false);
        write(`${r}.Recommendation.PVBoostAvailable_W`, 0);
        write(`${r}.Recommendation.MyPV_DHW_W`, 0);
        write(`${r}.Recommendation.MyPV_Heating_W`, 0);
        write(`${r}.Recommendation.Reason`, 'Keine ausreichende 84-Tage-Historie (mindestens 14 vollstaendige Tage erforderlich)');
        return;
    }
    if (x.invalid.length || x.haCritical) {
        write(`${r}.Recommendation.Valid`, false);
        write(`${r}.Recommendation.PVBoostRelease`, false);
        write(`${r}.Recommendation.PVBoostAvailable_W`, 0);
        write(`${r}.Recommendation.MyPV_DHW_W`, 0);
        write(`${r}.Recommendation.MyPV_Heating_W`, 0);
        write(`${r}.Recommendation.Reason`, x.haCritical
            ? 'Hausanschluss kritisch'
            : `Ungültige Eingangsdaten: ${x.invalid.join(', ')}`);
        return;
    }

    const forecast2hWh = readNumber(`${r}.Forecast.PVNext2h_Wh`, 0);
    const forecastAverageW = forecast2hWh / 2;
    const safeNowW = Math.max(0, Math.min(x.gridExport, x.haFreePower));
    const boost = safeNowW >= 1000 || forecastAverageW >= CFG.limits.pvBoostMinExpectedW;

    // Nur Beobachterempfehlung: keine Temperatur-Automatik und keine Geräteausgänge.
    const dhwRecommendation = Math.min(CFG.limits.myPvDhwMaxW, safeNowW);
    const heatingRecommendation = Math.min(
        CFG.limits.myPvHeatingMaxW,
        Math.max(0, safeNowW - dhwRecommendation)
    );
    const boostBudget = Math.min(
        Math.max(safeNowW, Math.round(forecastAverageW)),
        Math.max(0, x.haFreePower)
    );

    write(`${r}.Recommendation.Valid`, true);
    write(`${r}.Recommendation.PVBoostRelease`, boost);
    write(`${r}.Recommendation.PVBoostAvailable_W`, boost ? boostBudget : 0);
    write(`${r}.Recommendation.MyPV_DHW_W`, dhwRecommendation);
    write(`${r}.Recommendation.MyPV_Heating_W`, heatingRecommendation);
    write(`${r}.Recommendation.Reason`, boost
        ? `Beobachtung: ${Math.round(x.gridExport)} W Ueberschuss, Wetterprognose Ø ${Math.round(forecastAverageW)} W PV in den naechsten 2 h`
        : `Kein Boost: ${Math.round(x.gridExport)} W Ueberschuss, Wetterprognose Ø ${Math.round(forecastAverageW)} W PV in den naechsten 2 h`);
    write(`${r}.Recommendation.GeneratedAt`, Date.now());
    write(`${r}.System.Status`, getState(`${r}.System.NoActuation`)?.val === false
        ? 'Beobachter/Fahrplaner mit separat freigegebenem Produktivausgang'
        : 'OBSERVER – keine Aktoren werden beschrieben');
}

