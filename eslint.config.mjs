import pluginJs from '@eslint/js';
import tseslint from 'typescript-eslint';
import tsParser from '@typescript-eslint/parser';
import perfectionist from 'eslint-plugin-perfectionist';
import unusedImports from 'eslint-plugin-unused-imports';

const eslintConfig = [
    { files: ['**/*.ts'] },
    {
        languageOptions: {
            parser: tsParser,
            ecmaVersion: 2022,
            sourceType: 'module',
        },
    },
    pluginJs.configs.recommended,
    ...tseslint.configs.recommended,
    {
        rules: {
            '@typescript-eslint/consistent-type-imports': [
                'error',
                {
                    fixStyle: 'inline-type-imports',
                },
            ],
        },
    },
    {
        plugins: {
            'unused-imports': unusedImports,
        },
        rules: {
            'no-unused-vars': 'off', // or "@typescript-eslint/no-unused-vars": "off",
            'unused-imports/no-unused-imports': 'warn',
            'unused-imports/no-unused-vars': [
                'warn',
                {
                    vars: 'all',
                    varsIgnorePattern: '^_',
                    args: 'after-used',
                    argsIgnorePattern: '^_',
                },
            ],
        },
    },
    {
        plugins: {
            perfectionist,
        },
        rules: {
            'perfectionist/sort-imports': [
                'warn',
                {
                    groups: [
                        ['builtin', 'external', 'builtin-type', 'type'],
                        ['internal-type', 'internal'],
                        ['parent-type', 'parent'],
                        ['sibling-type', 'index-type', 'sibling', 'index'],
                        ['side-effect', 'side-effect-style'],
                        ['style'],
                        ['object', 'unknown'],
                    ],

                    newlinesBetween: 'always',
                    order: 'asc',
                    type: 'line-length',
                },
            ],
        },
    },
];

export default eslintConfig;
