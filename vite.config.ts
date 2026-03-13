import { defineConfig, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// Dynamically load @sentry/vite-plugin only when SENTRY_AUTH_TOKEN is set
// and the package is installed. This avoids build failures when the package
// is not present (e.g. production builds on Render with --omit=dev).
async function getSentryPlugin(): Promise<Plugin[]> {
  if (!process.env.SENTRY_AUTH_TOKEN) return [];
  try {
    const { sentryVitePlugin } = await import('@sentry/vite-plugin');
    return [sentryVitePlugin({
      org: process.env.SENTRY_ORG,
      project: process.env.SENTRY_PROJECT,
      authToken: process.env.SENTRY_AUTH_TOKEN,
      sourcemaps: {
        filesToDeleteAfterUpload: ['./dist/**/*.map'],
      },
    })];
  } catch {
    return [];
  }
}

export default defineConfig(async () => ({
  build: {
    sourcemap: !!process.env.SENTRY_AUTH_TOKEN, // Only generate source maps when Sentry is configured
  },
  plugins: [
    react(),
    tailwindcss(),
    ...(await getSentryPlugin()),
  ],
  server: {
    proxy: {
      '/api': 'http://localhost:3001',
      // Only proxy the exact /ws path (WebSocket endpoint), not /ws/:id/:tab admin routes
      '^/ws$': {
        target: 'ws://localhost:3001',
        ws: true,
        rewrite: () => '/ws',
      },
    },
  },
  test: {
    environment: 'jsdom',
    setupFiles: ['tests/component/setup.ts'],
    include: ['tests/**/*.test.{ts,tsx}'],
  },
}))
