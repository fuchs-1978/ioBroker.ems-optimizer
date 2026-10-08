#!/usr/bin/env node
'use strict';

// Raw DecisionRecords are ordered by session and sequence; earliest SQL/event
// time orders sessions. Conflicting duplicates become unknown before replay.
// Missing bases stay unknown until a full checkpoint.
const fs = require('node:fs');
const {decodeDecisionRecords} = require('../lib/decision-record-codec');

function main() {
    const source = process.argv[2];
    if (process.argv.length > 3 || source === '--help' || source === '-h') {
        process.stdout.write('Usage: node tools/decode-decision-records.js [input.json|-] > decoded.json\n'
            + 'Input: records, or {records:[...]}; raw {ts,val} rows accepted. Sort/dedup is applied; conflicting identities become unknown.\n');
        return;
    }
    const input = JSON.parse(fs.readFileSync(source && source !== '-' ? source : 0, 'utf8'));
    const records = Array.isArray(input) ? input : input.records;
    const decoded = decodeDecisionRecords(records);
    const output = Array.isArray(input) ? decoded : {...input, records: decoded};
    process.stdout.write(`${JSON.stringify(output, null, 2)}\n`);
}

if (require.main === module) {
    try { main(); }
    catch (error) { process.stderr.write(`DecisionRecord-Dekodierung fehlgeschlagen: ${error.message}\n`); process.exitCode = 1; }
}

module.exports = {main};
