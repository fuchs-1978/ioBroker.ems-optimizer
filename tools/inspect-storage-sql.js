'use strict';
// Host-side metadata inspection. No EMS/history rows, credentials or query texts
// are printed. Uses the operator's MySQL client configuration, never ioBroker's
// encrypted credentials. DDL is opt-in and only for a proven missing index.
const {execFile} = require('node:child_process');
const {promisify} = require('node:util');
const path = require('node:path');
const run = promisify(execFile);
function rows(text) {
    const lines = text.trim().split(/\r?\n/); if (!lines[0]) return [];
    const headers = lines.shift().split('\t');
    return lines.filter(Boolean).map(line => Object.fromEntries(line.split('\t').map((value, i) => [headers[i], value])));
}
function hasTimeIndex(indexRows) {
    const keys = new Map();
    for (const row of indexRows) {
        if (row.Index_type !== 'BTREE' || row.Sub_part && row.Sub_part !== 'NULL'
            || row.Visible === 'NO' || row.Ignored === 'YES') continue;
        if (!keys.has(row.Key_name)) keys.set(row.Key_name, new Map());
        keys.get(row.Key_name).set(Number(row.Seq_in_index), row.Column_name);
    }
    return [...keys.values()].some(columns => columns.get(1) === 'id' && columns.get(2) === 'ts');
}
function queries({database, datapoint = 'ems-optimizer.0.Debug.Shadow.DecisionRecord', now = Date.now()}) {
    if (!/^[A-Za-z0-9_-]{1,128}$/.test(database || '') || !/^[A-Za-z0-9_.:-]{1,1024}$/.test(datapoint)
        || !Number.isSafeInteger(now) || now < 2000) throw new Error('Invalid bounded inspection configuration');
    return {
        indexes: 'SHOW INDEX FROM ts_string;',
        plan: `EXPLAIN SELECT ts,val FROM ts_string WHERE id = (SELECT id FROM datapoints WHERE name='${datapoint}' AND type=1) AND ts >= ${now - 2000} AND ts <= ${now} ORDER BY ts ASC LIMIT 32;`,
        sessions: 'SELECT ID,USER,HOST,DB,COMMAND,TIME,STATE FROM information_schema.PROCESSLIST WHERE DB=DATABASE() ORDER BY TIME DESC LIMIT 32;',
        locks: 'SELECT OBJECT_TYPE,OBJECT_SCHEMA,OBJECT_NAME,LOCK_TYPE,LOCK_DURATION,LOCK_STATUS FROM performance_schema.metadata_locks WHERE OBJECT_SCHEMA=DATABASE() LIMIT 32;',
        transactions: 'SELECT trx_id,trx_state,trx_started,trx_wait_started,trx_mysql_thread_id,trx_tables_locked,trx_rows_locked FROM information_schema.innodb_trx LIMIT 32;',
        engine: "SELECT ENGINE FROM information_schema.TABLES WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='ts_string';",
        // No blocking fallback and no timeout/pool/global configuration changes.
        createIndex: 'SET SESSION lock_wait_timeout=3; SET SESSION innodb_lock_wait_timeout=3; ALTER TABLE ts_string ADD INDEX ems_id_ts (id,ts), ALGORITHM=INPLACE, LOCK=NONE;'
    };
}
async function inspect(options) {
    const {database, journal, defaultsFile, loginPath, applyIndex = false} = options;
    const statements = queries(options);
    if (!path.isAbsolute(journal || '')) throw new Error('--journal requires the actual absolute journal path');
    if (defaultsFile && !path.isAbsolute(defaultsFile)) throw new Error('Client defaults file must be absolute');
    if (loginPath && !/^[A-Za-z0-9_-]+$/.test(loginPath)) throw new Error('Invalid MySQL login path');
    const args = [...(defaultsFile ? [`--defaults-extra-file=${defaultsFile}`] : []),
        ...(loginPath ? [`--login-path=${loginPath}`] : []), '--batch', '--raw', '--connect-timeout=5', `--database=${database}`];
    const query = async (sql, ddl = false) => {
        const result = await run('mysql', [...args, '-e', sql], {timeout: ddl ? 60000 : 10000, maxBuffer: 1024 * 1024});
        return rows(result.stdout);
    };
    const output = {readOnly: !applyIndex, databaseChanges: [], storage: {}};
    for (const [name, command, params] of [
        ['mount', 'findmnt', ['-T', journal, '-o', 'SOURCE,FSTYPE,TARGET,OPTIONS']],
        ['capacity', 'df', ['-h', journal]], ['io', 'iostat', ['-xz', '1', '2']]]) {
        try {output.storage[name] = (await run(command, params, {timeout: 5000, maxBuffer: 65536})).stdout.trim();}
        catch {output.storage[name] = 'unavailable';}
    }
    output.indexes = await query(statements.indexes);
    output.usableIdTimeIndex = hasTimeIndex(output.indexes);
    output.plan = await query(statements.plan);
    for (const name of ['sessions', 'locks', 'transactions', 'engine']) {
        try {output[name] = await query(statements[name]);} catch {output[name] = 'unavailable with current database permissions';}
    }
    if (applyIndex && !output.usableIdTimeIndex) {
        if (!Array.isArray(output.engine) || output.engine[0]?.ENGINE !== 'InnoDB')
            throw new Error('Missing index; automatic online change is limited to confirmed InnoDB');
        if (output.indexes.some(row => row.Key_name === 'ems_id_ts')) throw new Error('Index name already exists with another definition');
        await query(statements.createIndex, true); output.databaseChanges.push('added ems_id_ts(id,ts) with ALGORITHM=INPLACE, LOCK=NONE');
        output.indexes = await query(statements.indexes); output.usableIdTimeIndex = hasTimeIndex(output.indexes);
        output.plan = await query(statements.plan);
    }
    return output;
}
if (require.main === module) {
    const args = process.argv.slice(2), options = {};
    const keys = {'--database': 'database', '--journal': 'journal', '--defaults-file': 'defaultsFile', '--login-path': 'loginPath', '--datapoint': 'datapoint'};
    for (let i = 0; i < args.length; i++) {
        if (args[i] === '--apply-index') options.applyIndex = true;
        else if (keys[args[i]]) options[keys[args[i]]] = args[++i];
        else throw new Error('Unknown inspection option');
    }
    inspect(options).then(result => console.log(JSON.stringify(result, null, 2))).catch(() => {
        // Child-process errors contain argv; never dump a client configuration.
        console.error('Inspection/change did not complete; check client access and permissions. No blocking DDL fallback is attempted.'); process.exitCode = 1;
    });
}
module.exports = {rows, hasTimeIndex, queries, inspect};
