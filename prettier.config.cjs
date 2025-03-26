/**
 * @see https://prettier.io/docs/en/configuration.html
 * @type {import("prettier").Config}
 */
const config = {
    // Base config
    arrowParens: 'always',
    bracketSpacing: true,
    endOfLine: 'lf',
    jsxBracketSameLine: false,
    overrides: [
        {
            files: ['*.ya?ml', '*.tf'],
            options: {
                endOfLine: 'auto',
                tabWidth: 2,
            },
        },
    ],
    printWidth: 120,
    semi: true,
    singleQuote: true,
    tabWidth: 4,
    trailingComma: 'all',
};

module.exports = config;
