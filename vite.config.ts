import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { sentryVitePlugin } from '@sentry/vite-plugin'

export default defineConfig({
  build: {
    sourcemap: !!process.env.SENTRY_AUTH_TOKEN, // Only generate source maps when Sentry is configured
  },
  plugins: [
    react(),
    tailwindcss(),
    // Upload source maps to Sentry during production builds (requires SENTRY_AUTH_TOKEN)
    ...(process.env.SENTRY_AUTH_TOKEN
      ? [sentryVitePlugin({
          org: process.env.SENTRY_ORG,
          project: process.env.SENTRY_PROJECT,
          authToken: process.env.SENTRY_AUTH_TOKEN,
          sourcemaps: {
            filesToDeleteAfterUpload: ['./dist/**/*.map'],
          },
        })]
      : []),
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
})
