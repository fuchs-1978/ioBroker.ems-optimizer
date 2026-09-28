#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const {analyzeShadow} = require('../lib/shadow-analysis');

const args = process.argv.slice(2);
if (args.length === 1 && ['--help', '-h'].includes(args[0])) {
    process.stdout.write('Usage: node tools/analyze-shadow.js [input.json|-]\n'
        + 'Read-only analysis of an exported JSON object; stdin is the default.\n'
        + 'Input: {window:{from,to},records:[DecisionRecord or {ts,val}],energy?:{...}}\n'
        + 'See tools/README-shadow-analysis.md. Output is JSON; no database connection.\n');
} else if (args.length > 1 || (args[0]?.startsWith('-') && args[0] !== '-')) {
    process.stderr.write('Usage: node tools/analyze-shadow.js [input.json|-]\n');
    process.exitCode = 1;
} else {
    try {
        const source = fs.readFileSync(args[0] && args[0] !== '-' ? args[0] : 0, 'utf8');
        process.stdout.write(`${JSON.stringify(analyzeShadow(JSON.parse(source)), null, 2)}\n`);
    } catch (error) {
        process.stderr.write(`${JSON.stringify({error: error.message})}\n`);
        process.exitCode = 1;
    }
}
