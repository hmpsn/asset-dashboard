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
          if (id.includes('node_modules/@stripe/')) return 'stripe';
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
    environment: 'jsdom',
    globalSetup: ['tests/global-setup.ts'],
    setupFiles: ['tests/db-setup.ts', 'tests/component/setup.ts'],
    include: ['tests/**/*.test.{ts,tsx}', 'server/__tests__/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'text-summary', 'lcov'],
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
      // Baseline 2026-04-11: lines 17.3%, branches 12.1%, functions 10.8%, stmts 16.2%
      // Thresholds = baseline - 5pts. Ratchet up as coverage improves.
      thresholds: {
        lines: 12,
        branches: 7,
        functions: 6,
        statements: 11,
      },
    },
  },
}))
