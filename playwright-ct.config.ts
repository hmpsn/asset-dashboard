import { defineConfig, devices } from '@playwright/experimental-ct-react';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  testDir: './tests/ct',
  snapshotDir: './tests/ct/__snapshots__',
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: 0,
  workers: 1,
  reporter: process.env.CI ? 'github' : 'list',
  // Absorb the sub-pixel font-antialiasing diff between the Playwright linux container
  // where baselines are generated (v1.58.2-jammy) and GitHub's ubuntu-latest runner
  // (~1% of pixels observed). A real layout/content regression is far larger, so the
  // visual gate stays meaningful.
  expect: {
    toHaveScreenshot: { maxDiffPixelRatio: 0.03 },
  },
  use: {
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    ...devices['Desktop Chrome'],
    viewport: { width: 1280, height: 960 },
  },
  ctViteConfig: {
    plugins: [react(), tailwindcss()],
  },
});
