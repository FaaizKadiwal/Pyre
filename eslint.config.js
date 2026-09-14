import js from '@eslint/js';
import globals from 'globals';

export default [
    js.configs.recommended,
    {
        files: ['server/**/*.js', 'test/**/*.js', 'eslint.config.js'],
        languageOptions: {
            ecmaVersion: 2022,
            sourceType: 'module',
            globals: { ...globals.node },
        },
    },
    {
        files: ['public/js/**/*.js'],
        languageOptions: {
            ecmaVersion: 2022,
            sourceType: 'module',
            globals: { ...globals.browser, io: 'readonly' },
        },
    },
    {
        rules: {
            'no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
            eqeqeq: ['error', 'always', { null: 'ignore' }],
            'prefer-const': 'error',
            'no-var': 'error',
            curly: ['error', 'multi-line'],
            'no-implicit-coercion': 'error',
            'no-return-await': 'error',
        },
    },
];
