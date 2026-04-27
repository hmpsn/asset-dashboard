import { defineConfig, devices } from '@playwright/test';

/**
 * Separate Playwright config for Phase 2 visual baseline + diff suite.
 *
 * Rationale: the main `playwright.config.ts` runs functional smoke/e2e tests
 * against a local `npm run dev:all` instance. The visual baseline suite is
 * different:
 *   - Must run against a deployed environment (staging by default) so the
 *     captured screenshots reflect production-equivalent render output, not
 *     local-only seeded data.
 *   - Uses `toHaveScreenshot()` with a tight pixel diff threshold — Phase 2
 *     PRs are expected to produce zero diffs against the committed baseline.
 *   - Runs its own testDir so functional e2e runs don't re-capture baselines.
 *
 * Usage (capture baselines against staging — one-time, before Phase 2 opens):
 *   BASE_URL=https://asset-dashboard-staging.onrender.com \
 *   PHASE2_ADMIN_TOKEN=<x-auth-token> \
 *   PHASE2_ADMIN_WS_ID=<workspace-uuid> \
 *   PHASE2_CLIENT_WS_ID=<workspace-uuid> \
 *   PHASE2_CLIENT_PASSWORD=<client-portal-password> \
 *   npm run phase2:baseline:update
 *
 * Usage (diff against committed baseline — Phase 2 worker PRs run this):
 *   BASE_URL=https://<phase-2-branch-preview>.onrender.com \
 *   PHASE2_ADMIN_TOKEN=<x-auth-token> \
 *   PHASE2_ADMIN_WS_ID=<workspace-uuid> \
 *   PHASE2_CLIENT_WS_ID=<workspace-uuid> \
 *   PHASE2_CLIENT_PASSWORD=<client-portal-password> \
 *   npm run phase2:baseline
 *
 * Any diff > 0 fails the run. See tests/playwright/visual/README.md.
 */

const BASE_URL =
  process.env.BASE_URL ?? 'https://asset-dashboard-staging.onrender.com';

export default defineConfig({
  testDir: './tests/playwright/visual',
  fullyParallel: false,
  workers: 1,
  forbidOnly: !!process.env.CI,
  retries: 0,
  reporter: process.env.CI ? 'github' : 'html',
  use: {
    baseURL: BASE_URL,
    viewport: { width: 1440, height: 900 },
    trace: 'retain-on-failure',
    screenshot: 'off',
  },
  // Absolute paths keep update/diff runs deterministic across machines.
  snapshotDir: './tests/playwright/visual/phase2-baseline',
  expect: {
    toHaveScreenshot: {
      // Phase 2 PRs should produce zero visual drift against baseline. Small
      // subpixel tolerance covers font rendering / antialiasing noise but
      // flags any real styling change.
      maxDiffPixelRatio: 0.001,
      animations: 'disabled',
    },
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
  // NO webServer — this suite runs against a deployed URL (staging or branch
  // preview), never a local dev server. That's the whole point: baselines
  // reflect production-equivalent render.
});
