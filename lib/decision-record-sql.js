'use strict';

// Cache only metadata, NEVER history or persistence proofs. One bounded entry
// per adapter generation; process restart deliberately starts without an ID.
const ID_CACHE_MS = 5 * 60 * 1000;
const idCache = new WeakMap();
function dialect({dbtype, dbname}, name) {
    if (typeof name !== 'string' || name.length > 1024 || !/^[A-Za-z0-9_.:-]+$/.test(name))
        throw new Error('Unsupported SQL verification datapoint name');
    let prefix;
    if (dbtype === 'mysql' || dbtype === 'mssql') {
        if (typeof dbname !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(dbname))
            throw new Error('Unsupported SQL verification database identifier');
        prefix = dbtype === 'mysql' ? `\`${dbname}\`.` : `[${dbname}].dbo.`;
    } else if (dbtype === 'sqlite' || dbtype === 'postgresql') prefix = '';
    else throw new Error('Unsupported SQL verification database type');
    return {prefix, top: limit => dbtype === 'mssql' ? `TOP ${limit} ` : '',
        tail: limit => dbtype === 'mssql' ? '' : ` LIMIT ${limit}`};
}
function numericId(value) {
    if (typeof value === 'string' && /^[1-9][0-9]{0,9}$/.test(value)) value = Number(value);
    if (!Number.isSafeInteger(value) || value < 1 || value > 2147483647)
        throw new Error('Invalid SQL datapoint integer ID');
    return value;
}
function buildDatapointSelect(native, name) {
    const {prefix, top, tail} = dialect(native, name);
    // Two rows detect ambiguous metadata instead of picking an arbitrary ID.
    return `SELECT ${top(2)}id, type FROM ${prefix}datapoints WHERE name = '${name}' AND type = 1${tail(2)};`;
}
function buildVerificationSelect(native, name, {start, end, limit}, resolvedId) {
    if (!Number.isSafeInteger(start) || start < 0 || !Number.isSafeInteger(end) || end < start
        || end - start > 10000 || !Number.isInteger(limit) || limit < 1 || limit > 32)
        throw new Error('Invalid bounded SQL verification window');
    const {prefix, top, tail} = dialect(native, name), id = numericId(resolvedId);
    // A literal id allows (id,ts) range access. The small constant-ID metadata
    // guard prevents a cached ID reassigned after restore from reading another
    // datapoint. It is NOT the former WHERE id=(SELECT ...) lookup.
    return `SELECT ${top(limit)}ts, val FROM ${prefix}ts_string WHERE id = ${id}`
        + ` AND ts >= ${start} AND ts <= ${end}`
        + ` AND EXISTS (SELECT 1 FROM ${prefix}datapoints WHERE id = ${id} AND name = '${name}' AND type = 1)`
        + ` ORDER BY ts ASC${tail(limit)};`;
}
function notIssued(error) {
    return {error, backendCompletionObserved: false, backendRequestIssued: false,
        localNotIssuedEvidence: 'Local SQL verification configuration/stop gate: no SQL transport was invoked'};
}
function completed(response) {
    return {...response, backendRequestIssued: true, backendCompletionObserved: true,
        backendCompletionEvidence: 'Actual SQL callback from database-only verification SELECT or completed metadata lookup; no SQL request remains outstanding'};
}
async function context(adapter, instance) {
    const stateId = `${adapter.namespace}.Debug.Shadow.DecisionRecord`;
    const [sql, state] = await Promise.all([
        adapter.getForeignObjectAsync(`system.adapter.${instance}`), adapter.getForeignObjectAsync(stateId)]);
    if (!sql?.native || !state) throw new Error('SQL verification configuration unavailable');
    const alias = state.common?.custom?.[instance]?.aliasId;
    if (alias !== undefined && alias !== null && alias !== '' && typeof alias !== 'string')
        throw new Error('Invalid SQL verification datapoint alias');
    const name = alias || stateId;
    // Retain only fields affecting the actual endpoint/table identity. Never
    // include passwords or persist/export connection configuration.
    const native = Object.fromEntries(['dbtype', 'dbname', 'host', 'port', 'user', 'fileName', 'socketPath']
        .map(key => [key, sql.native[key]]));
    const key = JSON.stringify([instance, adapter.namespace, name, native]);
    return {native, name, key};
}
async function readDecisionRecordDatabase(adapter, options) {
    const instance = String(adapter.config.historyInstance || '').trim();
    const stopped = () => adapter.unloading || options.signal?.aborted
        || String(adapter.config.historyInstance || '').trim() !== instance;
    if (stopped()) return notIssued('SQL verification stopped before dispatch');
    if (!/^sql\.\d+$/.test(instance)) return notIssued('No SQL instance configured');
    if (!/^[A-Za-z0-9_-]+\.\d+$/.test(adapter.namespace)) return notIssued('Invalid SQL verification namespace');
    let ctx;
    try {
        ctx = await context(adapter, instance);
        buildVerificationSelect(ctx.native, ctx.name, options, 1); // Validate bounds BEFORE any SQL.
    } catch {
        idCache.delete(adapter);
        return notIssued('SQL verification configuration or bounded request invalid');
    }
    if (stopped()) {idCache.delete(adapter); return notIssued('SQL verification stopped before dispatch');}
    const query = sql => new Promise((resolve, reject) => {
        // No local timer/fallback: delivery's durable fence covers both serial
        // requests. A transport throw is NOT proof of non-dispatch. An actual
        // late metadata callback may close its fence but must never launch SELECT.
        let settled = false;
        try {adapter.sendTo(instance, 'query', sql, response => {
            if (settled) return; settled = true; resolve(response);
        });} catch (error) {reject(error);}
    });
    try {
        let cached = idCache.get(adapter);
        const at = Date.now();
        if (!cached || cached.key !== ctx.key || at < cached.at || at - cached.at >= ID_CACHE_MS) {
            idCache.delete(adapter);
            const lookup = await query(buildDatapointSelect(ctx.native, ctx.name));
            if (lookup?.error) return completed({error: 'SQL datapoint lookup failed', result: null});
            if (stopped()) return completed({error: 'SQL verification stopped after metadata lookup', result: null});
            let id;
            try {
                if (!Array.isArray(lookup?.result) || lookup.result.length !== 1
                    || ![1, '1'].includes(lookup.result[0]?.type)) throw new Error('Ambiguous SQL metadata');
                id = numericId(lookup.result[0].id);
                const current = await context(adapter, instance);
                if (current.key !== ctx.key) throw new Error('SQL verification configuration changed');
            } catch {
                return completed({error: 'SQL datapoint metadata missing, ambiguous or configuration changed', result: null});
            }
            if (stopped()) return completed({error: 'SQL verification stopped after metadata lookup', result: null});
            cached = {key: ctx.key, id, at: Date.now()}; idCache.set(adapter, cached);
        }
        if (stopped()) {idCache.delete(adapter); return notIssued('SQL verification stopped before dispatch');}
        const response = await query(buildVerificationSelect(ctx.native, ctx.name, options, cached.id));
        try {
            if (String(adapter.config.historyInstance || '').trim() !== instance
                || (await context(adapter, instance)).key !== ctx.key)
                throw new Error('SQL verification configuration changed');
        } catch {
            idCache.delete(adapter);
            return completed({error: 'SQL verification configuration changed or unavailable after response', result: null});
        }
        // Empty history remains empty, never a cache proof. It also invalidates
        // metadata so missing/reassigned IDs are re-resolved on a later fenced
        // attempt rather than triggering an extra query in this operation.
        if (stopped() || response?.error || !Array.isArray(response?.result) || !response.result.length)
            idCache.delete(adapter);
        return completed(response);
    } catch (error) {
        idCache.delete(adapter);
        throw error;
    }
}
module.exports = {buildVerificationSelect, buildDatapointSelect, readDecisionRecordDatabase, ID_CACHE_MS};
