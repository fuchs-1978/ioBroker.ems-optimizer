'use strict';

// getHistory may serve SQL-adapter cache/in-flight values. Persistence proof
// must instead use a single database-only SELECT, without border/history work.
function buildVerificationSelect({dbtype, dbname}, id, {start, end, limit}) {
    if (!Number.isSafeInteger(start) || start < 0 || !Number.isSafeInteger(end) || end < start
        || end - start > 10000 || !Number.isInteger(limit) || limit < 1 || limit > 32)
        throw new Error('Invalid bounded SQL verification window');
    // Keep identifiers/literals deliberately restricted, not SQL-escaped using
    // server-dependent backslash rules. Unsupported configuration fails closed.
    if (typeof id !== 'string' || id.length > 1024 || !/^[A-Za-z0-9_.:-]+$/.test(id))
        throw new Error('Unsupported SQL verification datapoint name');
    let prefix;
    if (dbtype === 'mysql' || dbtype === 'mssql') {
        if (typeof dbname !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(dbname))
            throw new Error('Unsupported SQL verification database identifier');
        prefix = dbtype === 'mysql' ? `\`${dbname}\`.` : `[${dbname}].dbo.`;
    } else if (dbtype === 'sqlite' || dbtype === 'postgresql') prefix = '';
    else throw new Error('Unsupported SQL verification database type');
    const top = dbtype === 'mssql' ? `TOP ${limit} ` : '';
    const tail = dbtype === 'mssql' ? '' : ` LIMIT ${limit}`;
    return `SELECT ${top}ts, val FROM ${prefix}ts_string WHERE id = `
        + `(SELECT id FROM ${prefix}datapoints WHERE name = '${id}' AND type = 1)`
        + ` AND ts >= ${start} AND ts <= ${end} ORDER BY ts ASC${tail};`;
}

function notIssued(error) {
    return {error, backendCompletionObserved: false, backendRequestIssued: false,
        localNotIssuedEvidence: 'Local SQL verification configuration/stop gate: no SQL transport was invoked'};
}

async function readDecisionRecordDatabase(adapter, options) {
    const instance = String(adapter.config.historyInstance || '').trim();
    const stopped = () => adapter.unloading || options.signal?.aborted;
    if (stopped()) return notIssued('SQL verification stopped before dispatch');
    if (!/^sql\.\d+$/.test(instance)) return notIssued('No SQL instance configured');
    if (!/^[A-Za-z0-9_-]+\.\d+$/.test(adapter.namespace))
        return notIssued('Invalid SQL verification namespace');
    const stateId = `${adapter.namespace}.Debug.Shadow.DecisionRecord`;
    let select;
    try {
        const [sql, state] = await Promise.all([
            adapter.getForeignObjectAsync(`system.adapter.${instance}`),
            adapter.getForeignObjectAsync(stateId)]);
        if (!sql?.native || !state) return notIssued('SQL verification configuration unavailable');
        const alias = state.common?.custom?.[instance]?.aliasId;
        if (alias !== undefined && alias !== null && alias !== '' && typeof alias !== 'string')
            return notIssued('Invalid SQL verification datapoint alias');
        select = buildVerificationSelect(sql.native, alias || stateId, options);
    } catch {
        // Do not leak connection configuration, queries or arbitrary object
        // errors into persisted diagnostics. No SQL call has happened here.
        return notIssued('SQL verification configuration or bounded request invalid');
    }
    // Metadata reads can outlive delivery's deadline or shutdown. They must
    // never dispatch a delayed request after its never-issued fence is cleared.
    if (stopped() || String(adapter.config.historyInstance || '').trim() !== instance)
        return notIssued('SQL verification stopped or configuration changed before dispatch');
    return new Promise((resolve, reject) => {
        try {
            adapter.sendTo(instance, 'query', select, response => resolve({...response,
                backendRequestIssued: true, backendCompletionObserved: true,
                backendCompletionEvidence: 'Actual SQL callback from database-only verification SELECT'}));
        } catch (error) {
            // A throw at the transport boundary is not proof of non-dispatch.
            reject(error);
        }
    });
}

module.exports = {buildVerificationSelect, readDecisionRecordDatabase};
