import js from '@eslint/js'
import globals from 'globals'
import tseslint from 'typescript-eslint'

/**
 * ESLint flat config for the BlueCairn monorepo.
 *
 * Applies across apps/* and packages/*. Per-package overrides can be added
 * as additional config objects below if they become necessary.
 *
 * Principles:
 * - Prettier owns formatting. ESLint owns correctness.
 * - Type-aware rules are deferred (they require `project: true` config and
 *   slow lint runs in a monorepo). Add when/if specific rules pay off.
 * - Drizzle-generated SQL migrations are ignored — they are artifacts.
 *
 * See ENGINEERING.md § Testing / Engineering principles.
 */

export default tseslint.config(
  {
    ignores: [
      '**/node_modules/**',
      '**/dist/**',
      '**/.next/**',
      '**/.turbo/**',
      '**/coverage/**',
      '**/eval-results/**',
      'packages/db/migrations/**', // Drizzle-generated SQL — do not lint
    ],
  },

  js.configs.recommended,
  ...tseslint.configs.recommended,

  {
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
      globals: {
        ...globals.node,
      },
    },
    rules: {
      // Unused vars: allow `_` prefix for intentional non-use
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrorsIgnorePattern: '^_' },
      ],

      // Prefer `import type` for type-only imports (works with verbatimModuleSyntax)
      '@typescript-eslint/consistent-type-imports': ['error', { prefer: 'type-imports' }],

      // `any` requires a justification comment per ENGINEERING.md
      '@typescript-eslint/no-explicit-any': 'warn',

      // Allow `console.warn/error/info` in all code; forbid bare console.log in committed code
      'no-console': ['warn', { allow: ['warn', 'error', 'info'] }],

      // Empty functions occasionally legitimate (e.g., no-op defaults)
      '@typescript-eslint/no-empty-function': 'off',
    },
  },

  // Scripts and config files — relax some rules
  {
    files: ['**/scripts/**/*.ts', '**/*.config.{js,ts,mjs}', 'eslint.config.js'],
    rules: {
      'no-console': 'off',
    },
  },

  // Test files — relax strictness
  {
    files: ['**/*.{test,spec}.ts', '**/test/**/*.ts'],
    rules: {
      '@typescript-eslint/no-explicit-any': 'off',
      'no-console': 'off',
    },
  },

  // Package boundary rules — enforce dependency directions from ENGINEERING.md.
  // Apps (apps/*) are unrestricted. For each package, list the workspace names
  // that must NOT be imported. Violations surface as lint errors, catching
  // drift before it becomes entrenched.
  ...boundaryOverrides(),
)

function boundaryOverrides() {
  const deny = (files, forbidden) => ({
    files,
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: forbidden.map((name) => ({
            group: [`@bluecairn/${name}`, `@bluecairn/${name}/*`],
            message: `boundary: this package may not depend on @bluecairn/${name}`,
          })),
        },
      ],
    },
  })

  return [
    deny(
      ['packages/core/**/*.ts'],
      ['db', 'memory', 'agents', 'integrations', 'mcp-servers', 'evals'],
    ),
    deny(['packages/db/**/*.ts'], ['memory', 'agents', 'integrations', 'mcp-servers', 'evals']),
    deny(['packages/integrations/**/*.ts'], ['db', 'memory', 'agents', 'mcp-servers', 'evals']),
    deny(['packages/memory/**/*.ts'], ['agents', 'integrations', 'mcp-servers', 'evals']),
    deny(['packages/agents/**/*.ts'], ['integrations', 'mcp-servers', 'evals']),
    deny(['packages/mcp-servers/**/*.ts'], ['memory', 'agents', 'evals']),
    deny(['packages/evals/**/*.ts'], ['db', 'memory', 'integrations', 'mcp-servers']),
  ]
}
