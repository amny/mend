import js from '@eslint/js'
import globals from 'globals'
import tseslint from 'typescript-eslint'

export default tseslint.config(
  { ignores: ['**/dist/**', '**/node_modules/**', 'fixtures/**', 'spikes/**'] },
  js.configs.recommended,
  ...tseslint.configs.strict,
  {
    languageOptions: { globals: { ...globals.browser, ...globals.node } },
    rules: {
      '@typescript-eslint/no-explicit-any': 'error',
      // Invisible characters (U+00A0, BOM, ZWJ...) must be written as String.fromCodePoint(...):
      // Prettier rewrites \u escapes into literal characters, which this rule then reports.
      'no-irregular-whitespace': [
        'error',
        { skipStrings: false, skipTemplates: false, skipComments: false },
      ],
    },
  },
)
