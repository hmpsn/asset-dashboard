import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
  plugins: [react(), tailwindcss()],
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
