'use strict';

const {sourceSnapshot, probeSource} = require('./source-diagnostics');

// Read-only stop evidence. `output` is the WallboxOutput diagnostic port:
// clock/cache/receipt reads, publish/record methods, and the stopping guard.
// No command is sent and no operative cache is refreshed here.
function measurementFaultDiagnostic(output, d, sources, reason) {
    if (d.sourceFaultEpisode) return `${reason}; ${d.sourceFaultEpisode.summary}`;
    const at = output.now();
    const key = `${d.wb}:${at}:${++output.diagnosticSequence}`;
    const episode = {key, checkedAt: at, reason,
        recordSession: output.adapter.shadowController?.recordSession ?? null,
        recordSequenceAtCheck: output.adapter.shadowController?.recordSequence ?? null,
        stopGeneration: d.stopGeneration || 0, sources: sources.map(({id, maxAgeMs}) => ({
        id, maxAgeMs, cached: sourceSnapshot(output.measurementState(id), at),
        receipt: output.adapter.getCachedStateReceipt?.(id) || null,
        direct: {status: 'pending'}}))};
    episode.summary = `[diag ${key}] ` + episode.sources.map(s =>
        `${s.id}: Wert=${JSON.stringify(s.cached.val)}, ts=${s.cached.ts}, lc=${s.cached.lc}, `
        + `ACK=${s.cached.ack}, q=${s.cached.q}, Alter=${s.cached.ageMs} ms, `
        + `EMS-Empfang=${s.receipt?.receivedAt ?? 'unbekannt'} (${s.receipt?.via ?? 'unbekannt'}); Direktlesung ausstehend`).join('; ');
    d.sourceFaultEpisode = episode;
    output.publish(d.wb, 'LastStopSourceDiagnostics_JSON', JSON.stringify(episode));
    output.recordSourceDiagnostic('request', d, episode);
    // Diagnostic read only: never await it in the control/stop path and
    // never populate the operative cache with its result.
    Promise.all(episode.sources.map(async s => {
        s.direct = await probeSource(() => output.adapter.getForeignStateAsync(s.id), output.now, 5000);
        s.cacheAtCompletion = sourceSnapshot(output.measurementState(s.id), output.now());
        s.receiptAtCompletion = output.adapter.getCachedStateReceipt?.(s.id) || null;
    })).then(() => {
        if (output.stopping) return;
        // Keep completion evidence in the existing bounded recorder even
        // when a subsequent stop has replaced the latest diagnostic state.
        output.recordSourceDiagnostic('complete', d, episode);
        let retained;
        try { retained = JSON.parse(output.own(`Devices.Wallbox${d.wb}.LastStopSourceDiagnostics_JSON`) || '{}'); }
        catch { return; }
        if (retained.key !== key || d.sourceFaultEpisode && d.sourceFaultEpisode !== episode) return;
        const directSummary = episode.sources.map(s => `${s.id}: Direktlesung=${s.direct.status}, `
            + `Dauer=${s.direct.durationMs} ms, ts=${s.direct.snapshot?.ts ?? 'unbekannt'}, `
            + `Alter=${s.direct.snapshot?.ageMs ?? 'unbekannt'} ms, `
            + `Wert=${JSON.stringify(s.direct.snapshot?.val ?? null)}, lc=${s.direct.snapshot?.lc ?? 'unbekannt'}, `
            + `ACK=${s.direct.snapshot?.ack ?? 'unbekannt'}, q=${s.direct.snapshot?.q ?? 'unbekannt'}`).join('; ');
        episode.summary += `; ${directSummary}`;
        output.publish(d.wb, 'LastStopSourceDiagnostics_JSON', JSON.stringify(episode));
        const previous = String(output.own(`Devices.Wallbox${d.wb}.LastStopReason`) || '');
        if (previous.includes(`[diag ${key}]`))
            output.publish(d.wb, 'LastStopReason', `${previous}; ${directSummary}`);
        output.adapter.log.warn?.(`Wallbox ${d.wb}: Quellendiagnose [diag ${key}] ${directSummary}; `
            + 'Direktlesung prueft ioBroker, nicht das Geraet; keine Steuerungsfreigabe');
    }).catch(error => output.adapter.log.error?.(`Quellendiagnose fehlgeschlagen: ${error.message}`));
    return `${reason}; ${episode.summary}`;
}


function recordSourceDiagnostic(output, stage, d, episode) {
    try {
        output.adapter.shadowController?.productionRecord?.({type: `source_diagnostic.${stage}`, wb: d.wb, episode});
    } catch (error) {
        // A diagnostic recorder failure must not interrupt an OFF command.
        try {output.adapter.log.error?.(`Quellendiagnose-Recorder fehlgeschlagen: ${error.message}`);}
        catch (_) { /* Logging is not a safety prerequisite either. */ }
    }
}


function deviceFaultDiagnostic(output, d, sources, reason) {
    if (output.measurementSource || !d.owned) return reason;
    const mapping = output.adapter.readMapping();
    // Fixed, bounded stop evidence; electrical/allow reads do not prove
    // why a device stopped or whether unplugging caused the zero load.
    const ids = [...sources.map(s => s.id), d.ids.allow, mapping[`DP_WB${d.wb}_POWER`],
        ...[1, 2, 3].map(p => mapping[`DP_WB${d.wb}_L${p}_A`])];
    return output.measurementFaultDiagnostic(d, [...new Set(ids.filter(Boolean))]
        .map(id => ({id, maxAgeMs: sources.find(s => s.id === id)?.maxAgeMs
            ?? output.measurementMaxAgeMs()})), reason);
}


function stopTimeoutDiagnostic(output, d) {
    if (output.measurementSource) return;
    output.deviceFaultDiagnostic(d, [{id: d.ids.allow, maxAgeMs: output.measurementMaxAgeMs()}],
        d.stopRequest.reason);
    const episode = d.sourceFaultEpisode;
    if (!episode || episode.offTimeout) return;
    const at = output.now();
    episode.offTimeout = {checkedAt: at, firstStopAt: output.own(`Devices.Wallbox${d.wb}.LastStopAt`) ?? null,
        lastAttempt: d.stopRequest.lastAttempt, id: d.ids.allow,
        cached: sourceSnapshot(output.state(d.ids.allow), at),
        receipt: output.adapter.getCachedStateReceipt?.(d.ids.allow) || null, direct: {status: 'pending'}};
    output.publish(d.wb, 'LastStopSourceDiagnostics_JSON', JSON.stringify(episode));
    output.recordSourceDiagnostic('off_timeout', d, episode);
    probeSource(() => output.adapter.getForeignStateAsync(d.ids.allow), output.now, 5000).then(direct => {
        episode.offTimeout.direct = direct;
        if (output.stopping) return;
        output.recordSourceDiagnostic('off_timeout_complete', d, episode);
        let retained;
        try {retained = JSON.parse(output.own(`Devices.Wallbox${d.wb}.LastStopSourceDiagnostics_JSON`) || '{}');}
        catch {return;}
        if (retained.key === episode.key && (!d.sourceFaultEpisode || d.sourceFaultEpisode === episode))
            output.publish(d.wb, 'LastStopSourceDiagnostics_JSON', JSON.stringify(episode));
    }).catch(error => output.adapter.log.error?.(`AUS-Quellendiagnose fehlgeschlagen: ${error.message}`));
}


module.exports = {measurementFaultDiagnostic, recordSourceDiagnostic, deviceFaultDiagnostic, stopTimeoutDiagnostic};
