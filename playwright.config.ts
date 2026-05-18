import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: 1,
  reporter: process.env.CI ? 'github' : 'html',
  use: {
    baseURL: 'http://localhost:3001',
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
  webServer: {
    // Use a production-style server for both local and CI runs so E2E startup does
    // not depend on local file-watcher limits (`npm run dev:all` can fail with EMFILE).
    command: "npm run build && APP_PASSWORD= JWT_SECRET=e2e-test-secret DATA_DIR=/tmp/asset-dashboard-e2e npm start",
    url: 'http://localhost:3001/api/health',
    reuseExistingServer: false,
    timeout: 180_000,
    stdout: 'pipe',
    stderr: 'pipe',
  },
});
