import js from '@eslint/js';
import { plugin as shadcn } from '@shadcn/lint';
import eslintConfigPrettier from 'eslint-config-prettier/flat';
import globals from 'globals';
import reactHooks from 'eslint-plugin-react-hooks';
import reactRefresh from 'eslint-plugin-react-refresh';
import tseslint from 'typescript-eslint';
import { defineConfig, globalIgnores } from 'eslint/config';

export default defineConfig([
  globalIgnores(['dist']),
  {
    files: ['**/*.{ts,tsx}'],
    extends: [
      js.configs.recommended,
      tseslint.configs.recommended,
      reactHooks.configs.flat.recommended,
      reactRefresh.configs.vite,
    ],
    languageOptions: {
      globals: globals.browser,
    },
    plugins: {
      shadcn,
    },
    settings: {
      shadcn: {
        componentImports: ['^@/components(?:/|$)', '^(?:\\.\\.?/)+components(?:/|$)'],
      },
    },
    rules: {
      'shadcn/no-raw-colors': 'error',
      'shadcn/no-unknown-classes': ['error', { allow: ['trace-map', 'trace-packets'] }],
      'shadcn/no-arbitrary-values': [
        'error',
        {
          allow: [
            'layout',
            'tracking-[0.16em]',
            'backdrop-blur-[3px]',
            'transition-[height]',
            'pb-[env(safe-area-inset-bottom)]',
          ],
        },
      ],
      'shadcn/no-inline-styles': 'error',
      'shadcn/no-restyle': [
        'error',
        {
          allow: ['layout'],
          contracts: [
            {
              pattern: '^Timestamp$',
              allow: [
                'layout',
                'font-mono',
                'text-size-10',
                'text-size-11',
                'text-size-13',
                'text-text-dim',
                'text-text-muted',
                'text-text-normal',
              ],
            },
          ],
        },
      ],
      'shadcn/require-static-classes': 'warn',
    },
  },
  {
    files: ['src/components/**'],
    rules: {
      'shadcn/no-arbitrary-values': 'off',
      'shadcn/no-restyle': 'off',
      'shadcn/require-static-classes': 'off',
    },
  },
  eslintConfigPrettier,
]);
