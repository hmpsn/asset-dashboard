import { defineConfig, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { readFileSync, writeFileSync, mkdirSync } from 'fs'
import { resolve, dirname } from 'path'
import { fileURLToPath } from 'url'

const __dirname = dirname(fileURLToPath(import.meta.url))

/** Copies src/tokens.css → public/tokens.css so the styleguide can
 *  reference it at /tokens.css in both dev and prod. */
function copyTokensPlugin(): Plugin {
  return {
    name: 'copy-tokens',
    buildStart() {
      const src = resolve(__dirname, 'src/tokens.css')
      const dest = resolve(__dirname, 'public/tokens.css')
      try {
        const content = readFileSync(src, 'utf-8')
        mkdirSync(dirname(dest), { recursive: true })
        writeFileSync(dest, content, 'utf-8')
      } catch (e) {
        this.error(`copy-tokens: failed to copy tokens.css — ${e}`)
      }
    },
  }
}

// Dynamically load @sentry/vite-plugin only when SENTRY_AUTH_TOKEN is set
// and the package is installed. This avoids build failures when the package
// is not present (e.g. production builds on Render with --omit=dev).
async function getSentryPlugin(): Promise<Plugin[]> {
  if (!process.env.SENTRY_AUTH_TOKEN) return [];
  try {
    const { sentryVitePlugin } = await import('@sentry/vite-plugin');
    const result = sentryVitePlugin({
      org: process.env.SENTRY_ORG,
      project: process.env.SENTRY_PROJECT,
      authToken: process.env.SENTRY_AUTH_TOKEN,
      sourcemaps: {
        filesToDeleteAfterUpload: ['./dist/**/*.map'],
      },
    });
    return Array.isArray(result) ? result : [result];
  } catch {
    return [];
  }
}

const API_PORT = process.env.PORT || '3001';

export default defineConfig(async () => ({
  build: {
    sourcemap: !!process.env.SENTRY_AUTH_TOKEN, // Only generate source maps when Sentry is configured
    rollupOptions: {
      output: {
        manualChunks(id: string) {
          if (id.includes('node_modules/react-dom/') || id.includes('node_modules/react/') || id.includes('node_modules/react-router-dom/')) return 'react-vendor';
        },
      },
    },
  },
  plugins: [
    copyTokensPlugin(),
    react(),
    tailwindcss(),
    ...(await getSentryPlugin()),
  ],
  server: {
    proxy: {
      '/api': `http://localhost:${API_PORT}`,
      // Only proxy the exact /ws path (WebSocket endpoint), not /ws/:id/:tab admin routes
      '^/ws$': {
        target: `ws://localhost:${API_PORT}`,
        ws: true,
        rewrite: () => '/ws',
      },
    },
  },
  test: {
    silent: 'passed-only',
    globalSetup: ['tests/global-setup.ts'],
    projects: [
      {
        extends: true,
        test: {
          name: 'component',
          environment: 'jsdom',
          setupFiles: ['tests/component/setup.ts'],
          include: [
            'tests/**/*.test.tsx',
            'tests/unit/cms-editor-publish-bulk-workflow.test.ts',
            'tests/unit/cms-editor-save-workflow.test.ts',
            'tests/unit/cms-editor-shell-state-hook.test.ts',
            'tests/unit/page-rewrite-chat-shell-hook.test.ts',
            'tests/unit/smart-placeholder.test.ts',
            'tests/unit/strategy-keyword-feedback.test.ts',
            'tests/unit/use-page-join.test.ts',
            'tests/unit/useAutoSave.test.ts',
            'tests/unit/useClientBriefing.test.ts',
          ],
        },
      },
      {
        extends: true,
        test: {
          name: 'contract',
          environment: 'node',
          setupFiles: ['tests/db-setup.ts'],
          include: [
            'tests/contract/**/*.test.ts',
            'tests/pr-check.test.ts',
            'tests/meta-port-uniqueness.test.ts',
          ],
        },
      },
      {
        extends: true,
        test: {
          name: 'integration',
          environment: 'node',
          setupFiles: ['tests/db-setup.ts'],
          include: [
            'tests/integration/**/*.test.ts',
            'tests/smoke.test.ts',
          ],
        },
      },
      {
        extends: true,
        test: {
          name: 'unit',
          environment: 'node',
          setupFiles: ['tests/db-setup.ts'],
          include: [
            'tests/**/*.test.ts',
            'server/__tests__/**/*.test.ts',
          ],
          exclude: [
            'tests/contract/**/*.test.ts',
            'tests/integration/**/*.test.ts',
            'tests/**/*.test.tsx',
            'tests/smoke.test.ts',
            'tests/unit/cms-editor-publish-bulk-workflow.test.ts',
            'tests/unit/cms-editor-save-workflow.test.ts',
            'tests/unit/cms-editor-shell-state-hook.test.ts',
            'tests/unit/page-rewrite-chat-shell-hook.test.ts',
            'tests/unit/smart-placeholder.test.ts',
            'tests/unit/strategy-keyword-feedback.test.ts',
            'tests/unit/use-page-join.test.ts',
            'tests/unit/useAutoSave.test.ts',
            'tests/unit/useClientBriefing.test.ts',
            'tests/pr-check.test.ts',
            'tests/meta-port-uniqueness.test.ts',
          ],
        },
      },
    ],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'text-summary', 'lcov', 'json-summary'],
      reportsDirectory: './coverage',
      include: ['server/**/*.ts', 'src/**/*.{ts,tsx}', 'shared/**/*.ts'],
      exclude: [
        'server/index.ts',
        'server/db/migrations/**',
        'src/main.tsx',
        '**/*.d.ts',
        'scripts/**',
        '**/*.test.{ts,tsx}',
      ],
      // Baseline 2026-05-05 (staging): lines 28.6%, branches 21.4%, functions 20.4%, stmts 26.9%
      // Thresholds = baseline - 5pts. Ratchet up as coverage improves.
      thresholds: {
        lines: 24,
        branches: 16,
        functions: 15,
        statements: 22,
      },
    },
  },
}))
