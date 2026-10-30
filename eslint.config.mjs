import ioBroker from '@iobroker/eslint-config';
import fs from 'node:fs';
import path from 'node:path';
import * as espree from 'espree';

// The engine consists of scripts sharing one VM lexical environment. Declare
// only actual top-level bindings; misspelled or undeclared names still fail.
const engineGlobals = {};
function binding(pattern) {
    if (!pattern) return;
    if (pattern.type === 'Identifier') engineGlobals[pattern.name] = 'writable';
    else if (pattern.type === 'ObjectPattern') for (const p of pattern.properties) binding(p.value || p.argument);
    else if (pattern.type === 'ArrayPattern') for (const p of pattern.elements) binding(p);
    else if (pattern.type === 'AssignmentPattern') binding(pattern.left);
    else if (pattern.type === 'RestElement') binding(pattern.argument);
}
for (const name of fs.readdirSync('lib/engine').filter(name => name.endsWith('.js'))) {
    const ast = espree.parse(fs.readFileSync(path.join('lib/engine', name), 'utf8'), {ecmaVersion: 'latest', sourceType: 'script'});
    for (const node of ast.body) {
        if (node.type === 'VariableDeclaration') for (const declaration of node.declarations) binding(declaration.id);
        else if (['FunctionDeclaration', 'ClassDeclaration'].includes(node.type)) binding(node.id);
    }
}

export default [
    {ignores: ['node_modules/**', 'coverage/**', 'test/fixtures/**', 'private/**']},
    ...ioBroker,
    {
        files: ['**/*.js', '**/*.mjs'],
        rules: {
            // Keep the existing compact source style. This change introduces
            // correctness checks, not a repository-wide formatting rewrite.
            'prettier/prettier': 'off', curly: 'off', 'brace-style': 'off', 'quote-props': 'off',
            'prefer-template': 'off', 'no-else-return': 'off',
            'no-extra-boolean-cast': 'off',
            'jsdoc/require-jsdoc': 'off', 'jsdoc/require-param': 'off', 'jsdoc/multiline-blocks': 'off',
            '@typescript-eslint/no-this-alias': 'off',
            '@typescript-eslint/no-unused-vars': ['error', {ignoreRestSiblings: true, argsIgnorePattern: '^_', caughtErrors: 'none'}],
            'no-restricted-syntax': ['error', {
                selector: "CallExpression[callee.type='Identifier'][callee.name='setTimeout']",
                message: 'Use adapter-owned timers or an explicit bounded native deadline; see docs/adapter-quality.md.'
            }]
        }
    },
    {
        files: ['lib/engine/*.js'],
        languageOptions: {sourceType: 'script', globals: {
            ...engineGlobals,
            nativeConfig: 'readonly', getState: 'readonly', existsState: 'readonly', createState: 'readonly',
            setState: 'readonly', writeForeignState: 'readonly', updateWallboxProductionOutput: 'readonly',
            sendTo: 'readonly', schedule: 'readonly', on: 'readonly', log: 'readonly',
            historySourceEnabled: 'readonly', historyQueryAllowed: 'readonly',
            readHeaterWriteProof: 'readonly', readHeaterWriteStatus: 'readonly',
            loadComparisonAllowed: 'readonly', loadForecastComparison: 'readonly', vehicleSocEstimator: 'readonly', wallboxAllocationPolicy: 'readonly', gridConstraints: 'readonly',
            gridMeasurement: 'readonly', gridOperatorRuntime: 'readonly', batteryTemperatureReserve: 'readonly', sunEnergyHeads: 'readonly',
            heatPumpTelemetryParser: 'readonly', SMA_GRID_MAX_AGE_MS: 'readonly'
            , getSourceUnit: 'readonly', getHeaterWriteOnlyZeroStatus: 'readonly', getActualState: 'readonly',
            historyRetryAllowed: 'readonly', shadowElectricalResponseValid: 'readonly', normalizeWallboxPowerKW: 'readonly'
        }},
        rules: {'no-redeclare': ['error', {builtinGlobals: false}],
            '@typescript-eslint/no-unused-vars': ['error', {vars: 'local', ignoreRestSiblings: true, argsIgnorePattern: '^_', caughtErrors: 'none'}]}
    },
    {files: ['test/**/*.js'], rules: {'no-restricted-syntax': 'off'}}
];
