import js from '@eslint/js'
import globals from 'globals'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import tseslint from 'typescript-eslint'
import { defineConfig, globalIgnores } from 'eslint/config'

export default defineConfig([
  globalIgnores(['dist']),
  {
    files: ['**/*.{ts,tsx}'],
    extends: [
      js.configs.recommended,
      tseslint.configs.recommended,
      reactHooks.configs['recommended-latest'],
      reactRefresh.configs.vite,
    ],
    languageOptions: {
      ecmaVersion: 2020,
      globals: globals.browser,
    },
  },
  // Restrict Firebase imports to only api.ts and firebase.ts
  {
    files: ['src/**/*.{ts,tsx}'],
    ignores: ['src/api.ts', 'src/firebase.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['firebase/*', 'firebase/**'],
              message: 'Import from ./api instead of using Firebase directly. Firebase access should only be in api.ts and firebase.ts.',
            },
          ],
        },
      ],
    },
  },
])
