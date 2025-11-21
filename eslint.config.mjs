import eslint from '@eslint/js';
import tseslint from '@typescript-eslint/eslint-plugin';
import tsparser from '@typescript-eslint/parser';
import importPlugin from 'eslint-plugin-import';
import unusedImports from 'eslint-plugin-unused-imports';

export default [
  eslint.configs.recommended,
  {
    files: ['src/**/*.ts', 'src/**/*.tsx', 'extensions/**/*.ts', 'extensions/**/*.tsx'],
    languageOptions: {
      parser: tsparser,
      parserOptions: {
        ecmaVersion: 2020,
        sourceType: 'module',
        ecmaFeatures: { jsx: true },
      },
      globals: {
        // Common browser globals
        window: 'readonly',
        document: 'readonly',
        navigator: 'readonly',
        console: 'readonly',
        setTimeout: 'readonly',
        setInterval: 'readonly',
        clearTimeout: 'readonly',
        clearInterval: 'readonly',
        requestAnimationFrame: 'readonly',
        cancelAnimationFrame: 'readonly',
        URL: 'readonly',
        Worker: 'readonly',
        self: 'readonly',
        fetch: 'readonly',
        // IndexedDB / Web APIs
        indexedDB: 'readonly',
        IDBDatabase: 'readonly',
        IDBOpenDBRequest: 'readonly',
        IDBRequest: 'readonly',
        IDBCursorWithValue: 'readonly',
        Blob: 'readonly',
        // Text encoders/decoders and base64
        TextEncoder: 'readonly',
        TextDecoder: 'readonly',
        btoa: 'readonly',
        atob: 'readonly',
        crypto: 'readonly',
        localStorage: 'readonly',
        CustomEvent: 'readonly',
        KeyboardEvent: 'readonly',
        HTMLElement: 'readonly',
        Element: 'readonly',
        WheelEvent: 'readonly',
        TouchEvent: 'readonly',
        // React (in case some modules reference it explicitly)
        React: 'readonly',
      },
    },
    plugins: {
      '@typescript-eslint': tseslint,
      import: importPlugin,
      'unused-imports': unusedImports,
    },
    rules: {
      ...tseslint.configs.recommended.rules,
      'import/order': [
        'error',
        {
          groups: [['builtin', 'external'], 'internal', ['parent', 'sibling'], 'index'],
          'newlines-between': 'always',
          alphabetize: { order: 'asc', caseInsensitive: true },
        },
      ],
      'indent': [
        'error',
        2,
        {
          SwitchCase: 1,
          VariableDeclarator: 1,
          outerIIFEBody: 1,
          MemberExpression: 1,
          FunctionDeclaration: { parameters: 1, body: 1 },
          FunctionExpression: { parameters: 1, body: 1 },
          CallExpression: { arguments: 1 },
          ArrayExpression: 1,
          ObjectExpression: 1,
          ImportDeclaration: 1,
          flatTernaryExpressions: false,
          ignoredNodes: [],
          ignoreComments: false,
        }
      ],
      '@typescript-eslint/no-unused-vars': 'off', // Completely disabled
      '@typescript-eslint/explicit-function-return-type': 'warn',
      '@typescript-eslint/no-explicit-any': 'warn',
      'unused-imports/no-unused-imports': 'error',
      'prefer-const': 'error',
      'no-var': 'error',
      'no-unused-vars': 'off', // Also disable the base rule
    },
  },
  {
    files: ['**/*.test.ts', '**/*.spec.ts', '**/*.test.js', '**/*.test.mjs', 'tests/**/*.mjs'],
    rules: {
      '@typescript-eslint/explicit-function-return-type': 'off',
      'no-console': 'off',
    },
    languageOptions: {
      globals: {
        console: 'readonly',
        JSON: 'readonly',
        // Jest globals used in test files
        describe: 'readonly',
        it: 'readonly',
        test: 'readonly',
        expect: 'readonly',
        beforeEach: 'readonly',
        afterEach: 'readonly',
        beforeAll: 'readonly',
        afterAll: 'readonly',
      },
    },
  },
  {
    ignores: ['out', 'node_modules', '*.js', '.next', 'dist', 'build', 'public', 'coverage', '**/*.d.ts', 'scripts/extensions/samples'],
  },
];