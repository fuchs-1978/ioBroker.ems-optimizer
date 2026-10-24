'use strict';

// Diagnostic thresholds only; never protection or actuation settings.
const POLICY = Object.freeze({exportW: 200, deviationW: 500, powerMinMs: 60000,
    sourceGapMinMs: 30000, maxClosed: 24, contextMs: 60000});
// Independent quotas stop ordinary import deviations from evicting exports
// or quality gaps. Active candidates are separate, bounded by known sources.
const RETENTION = Object.freeze({export: 8, deviation: 8, 'source-gap': 6, 'sampling-gap': 2});
const IMPORTANCE = Object.freeze({deviation: 0, 'sampling-gap': 1, 'source-gap': 2, export: 3});
const strength = (a, b) => b.magnitudeWms - a.magnitudeWms || b.durationMs - a.durationMs || b.to - a.to;
const finite = n => typeof n === 'number' && Number.isFinite(n);
function ensure(p, at) {
    if (!p.investigation) p.investigation = {schema: 1, availableFrom: at,
        policy: {...POLICY}, closed: [], active: {}, overflow: 0};
    const d = p.investigation;
    if (!d.retention) {
        d.retention = {limits: {...RETENTION}, overflowBeforeRetention: d.overflow,
            droppedByType: Object.fromEntries(Object.keys(RETENTION).map(type => [type, 0]))};
    }
    return d;
}
function finish(p, key, reason) {
    const d = p.investigation, e = d?.active[key];
    if (!e) return;
    delete d.active[key]; e.endReason = reason;
    if (e.durationMs < e.minimumMs) return;
    d.closed.push(e);
    retain(p);
}
function drop(d, e) {
    d.closed.splice(d.closed.indexOf(e), 1); d.overflow++;
    d.retention.droppedByType[e.type]++;
}
function retain(p) {
    const d = ensure(p, p.observedUntil ?? p.from);
    for (const [type, limit] of Object.entries(RETENTION)) {
        const list = d.closed.filter(e => e.type === type).sort(strength);
        for (const e of list.slice(limit)) drop(d, e);
    }
    d.closed.sort((a, b) => IMPORTANCE[b.type] - IMPORTANCE[a.type] || strength(a, b));
}
function dropForSize(periods) {
    const candidates = periods.filter(p => p?.investigation?.closed.length)
        .flatMap(p => p.investigation.closed.map(e => ({p, e})));
    candidates.sort((a, b) => IMPORTANCE[a.e.type] - IMPORTANCE[b.e.type] || -strength(a.e, b.e));
    const victim = candidates[0];
    if (!victim) return false;
    drop(ensure(victim.p, victim.p.observedUntil), victim.e);
    return true;
}
function add(p, key, type, source, from, to, magnitude, context, minimumMs) {
    const d = ensure(p, from);
    let e = d.active[key];
    if (e && e.to !== from) { finish(p, key, 'discontinuous'); e = null; }
    if (!e) e = d.active[key] = {type, source, from, to: from, durationMs: 0,
        minimumMs, peakW: 0, peakAt: from, magnitudeWms: 0, contextStart: context, contextEnd: context};
    e.to = to; e.durationMs += to - from; e.contextEnd = context;
    if (finite(magnitude)) { if (magnitude > e.peakW) { e.peakW = magnitude; e.peakAt = from; } e.magnitudeWms += magnitude * (to - from); }
}
function context(s, targetW) {
    return {master: s.system.RealOutputsEnabled ?? null, selectedWallbox: s.control.SelectedWallbox ?? null,
        gridLimitActive: s.control.GridOperatorLimitActive ?? null, targetGridW: finite(targetW) ? targetW : null,
        wallboxes: s.wallboxes.map(w => ({wb: w.wb, actualW: w.actual_W, phases: w.ConfirmedPhases ?? null,
            phaseTransition: w.PhaseTransitionActive ?? null})), ehzW: s.ehz.actual_W};
}
function observe(p, from, to, before, after, configured, ctx, targetW) {
    if (to <= from) return;
    ensure(p, from);
    const a = before.grid, b = after.grid;
    const coherent = finite(a) && finite(b);
    for (const [key, condition, magnitude] of [
        ['export', coherent && a < -POLICY.exportW && b < -POLICY.exportW, -a],
        ['deviation', coherent && finite(targetW) && Math.abs(a - targetW) > POLICY.deviationW
            && Math.abs(b - targetW) > POLICY.deviationW, Math.abs(a - targetW)]
    ]) {
        if (condition) add(p, key, key, 'grid', from, to, magnitude, ctx, POLICY.powerMinMs);
        else finish(p, key, coherent ? 'threshold-ended' : 'source-unknown');
    }
    for (const source of configured) {
        const key = `gap:${source}`;
        if (!finite(before[source]) || !finite(after[source]))
            add(p, key, 'source-gap', source, from, to, null, ctx, POLICY.sourceGapMinMs);
        else finish(p, key, 'valid-again');
    }
}
function interrupt(p, reason) {
    if (p?.investigation) for (const key of Object.keys(p.investigation.active)) finish(p, key, reason);
}
function gap(p, from, to, ctx) {
    if (to <= from) return;
    interrupt(p, 'sampling-gap');
    add(p, 'observation', 'sampling-gap', 'all', from, to, null, ctx, 10000);
    finish(p, 'observation', 'sampling-resumed');
}
function windows(p) {
    if (!p?.investigation) return [];
    return [...p.investigation.closed, ...Object.values(p.investigation.active)
        .filter(e => e.durationMs >= e.minimumMs).map(e => ({...e, endReason: 'ongoing'}))]
        .map(e => ({...e, meanMagnitudeW: e.durationMs && e.type !== 'source-gap' && e.type !== 'sampling-gap'
            ? e.magnitudeWms / e.durationMs : null,
            estimatedMagnitudeWh: ['export', 'deviation'].includes(e.type) ? e.magnitudeWms / 3600000 : null,
            investigateFrom: Math.max(p.from, e.from - POLICY.contextMs),
            investigateTo: Math.min(p.to, p.observedUntil, e.to + POLICY.contextMs),
            suggestedFrom: Math.max(p.from, (['export', 'deviation'].includes(e.type) ? e.peakAt : e.to) - POLICY.contextMs),
            suggestedTo: Math.min(p.to, p.observedUntil,
                (['export', 'deviation'].includes(e.type) ? e.peakAt : e.to) + POLICY.contextMs)}));
}
function valid(d, p) {
    const validEpisode = e => e && ['export', 'deviation', 'source-gap', 'sampling-gap'].includes(e.type)
        && typeof e.source === 'string' && e.source.length <= 20
        && ['from', 'to', 'durationMs', 'minimumMs', 'peakW', 'peakAt', 'magnitudeWms'].every(k => finite(e[k]))
        && e.from >= p.from && e.to <= p.to && e.to >= e.from && e.durationMs === e.to - e.from
        && e.durationMs >= 0 && e.magnitudeWms >= 0;
    const retentionValid = !d?.retention || d.retention.limits
        && finite(d.retention.overflowBeforeRetention) && d.retention.overflowBeforeRetention >= 0
        && Object.keys(RETENTION).every(type => finite(d.retention.droppedByType?.[type])
            && d.retention.droppedByType[type] >= 0);
    return retentionValid && d?.schema === 1 && finite(d.availableFrom) && finite(d.overflow) && d.overflow >= 0
        && Array.isArray(d.closed) && d.closed.length <= POLICY.maxClosed && d.closed.every(validEpisode)
        && d.active && typeof d.active === 'object' && !Array.isArray(d.active)
        && Object.keys(d.active).length <= 10 && Object.values(d.active).every(validEpisode);
}
module.exports = {POLICY, RETENTION, retain, dropForSize, valid, ensure, observe, interrupt, gap, context, windows};
