/**
 * Phase 2 visual baseline suite.
 *
 * Captures full-page screenshots of the 11 pages enumerated in
 * docs/superpowers/plans/2026-04-24-phase-2-kickoff.md §1 Gate 4. Phase 2
 * worker PRs run this same suite against their branch preview deploy and
 * assert zero-diff against the baseline committed to `phase2-baseline/`.
 *
 * Reads required config from env vars so the suite can run against any
 * deployed URL (staging, branch preview, etc.) without code changes:
 *
 *   BASE_URL               — e.g. https://asset-dashboard-staging.onrender.com
 *   PHASE2_ADMIN_TOKEN     — x-auth-token value for HMAC admin login
 *   PHASE2_ADMIN_WS_ID     — workspace UUID used for admin page captures
 *   PHASE2_CLIENT_WS_ID    — workspace UUID used for client page captures
 *   PHASE2_CLIENT_PASSWORD — client-portal shared password (falls back to
 *                            bypass mode if the workspace has no password)
 *
 * Missing env vars → that specific page test is skipped (and logged).
 * Styleguide + login pages always run since they need no auth.
 */
import { test, expect, type Page } from '@playwright/test';

const ADMIN_TOKEN = process.env.PHASE2_ADMIN_TOKEN;
const ADMIN_WS_ID = process.env.PHASE2_ADMIN_WS_ID;
const CLIENT_WS_ID = process.env.PHASE2_CLIENT_WS_ID;
const CLIENT_PASSWORD = process.env.PHASE2_CLIENT_PASSWORD;

/**
 * Injects the HMAC admin auth token into localStorage before page load so
 * admin routes don't redirect to the login gate. The app reads this key to
 * attach `x-auth-token` to every API request.
 */
async function loginAsAdmin(page: Page, token: string): Promise<void> {
  await page.addInitScript((value) => {
    try {
      window.localStorage.setItem('x-auth-token', value);
    } catch {
      // localStorage may be unavailable in some embedded contexts; ignore.
    }
  }, token);
}

/**
 * Navigate and wait for the route to reach a stable render state. Admin
 * pages load data via React Query — the 1200ms settle lets placeholders +
 * skeletons resolve into real content. If the app later grows a reliable
 * "ready" signal (e.g. a data-ready attribute on root), prefer that.
 */
async function gotoAndSettle(page: Page, path: string): Promise<void> {
  await page.goto(path, { waitUntil: 'networkidle' });
  await page.waitForTimeout(1200);
}

/**
 * Captures a full-page screenshot named for the route. Snapshot path is
 * controlled by `playwright.visual.config.ts` → `snapshotDir`, so all
 * baselines land under `tests/playwright/visual/phase2-baseline/`.
 */
async function capture(page: Page, name: string): Promise<void> {
  await expect(page).toHaveScreenshot(`${name}.png`, {
    fullPage: true,
  });
}

test.describe('Phase 2 visual baseline — public pages', () => {
  test('login page', async ({ page }) => {
    await gotoAndSettle(page, '/');
    await capture(page, '01-login');
  });

  test('styleguide', async ({ page }) => {
    await gotoAndSettle(page, '/styleguide.html');
    await capture(page, '11-styleguide');
  });
});

test.describe('Phase 2 visual baseline — admin pages', () => {
  test.skip(
    !ADMIN_TOKEN || !ADMIN_WS_ID,
    'PHASE2_ADMIN_TOKEN + PHASE2_ADMIN_WS_ID required',
  );

  test.beforeEach(async ({ page }) => {
    await loginAsAdmin(page, ADMIN_TOKEN!);
  });

  test('admin overview', async ({ page }) => {
    await gotoAndSettle(page, `/ws/${ADMIN_WS_ID}/overview`);
    await capture(page, '02-admin-overview');
  });

  test('admin analytics', async ({ page }) => {
    await gotoAndSettle(page, `/ws/${ADMIN_WS_ID}/analytics`);
    await capture(page, '03-admin-analytics');
  });

  test('admin pages (PageIntelligence)', async ({ page }) => {
    await gotoAndSettle(page, `/ws/${ADMIN_WS_ID}/pages`);
    await capture(page, '04-admin-pages');
  });

  test('admin strategy (KeywordStrategy)', async ({ page }) => {
    await gotoAndSettle(page, `/ws/${ADMIN_WS_ID}/strategy`);
    await capture(page, '05-admin-strategy');
  });

  test('admin content (ContentBriefs)', async ({ page }) => {
    await gotoAndSettle(page, `/ws/${ADMIN_WS_ID}/content`);
    await capture(page, '06-admin-content');
  });

  test('admin audit (SeoAudit)', async ({ page }) => {
    await gotoAndSettle(page, `/ws/${ADMIN_WS_ID}/audit`);
    await capture(page, '07-admin-audit');
  });

  test('admin brand (BrandHub)', async ({ page }) => {
    await gotoAndSettle(page, `/ws/${ADMIN_WS_ID}/brand`);
    await capture(page, '08-admin-brand');
  });
});

test.describe('Phase 2 visual baseline — client pages', () => {
  test.skip(!CLIENT_WS_ID, 'PHASE2_CLIENT_WS_ID required');

  test.beforeEach(async ({ page }) => {
    if (!CLIENT_PASSWORD) return;
    // Pre-fill client shared password so the portal skips the password gate.
    // Key matches the client portal's localStorage convention.
    await page.addInitScript((value) => {
      try {
        window.localStorage.setItem('client-portal-password', value);
      } catch {
        // ignore
      }
    }, CLIENT_PASSWORD);
  });

  test('client overview (ClientDashboard)', async ({ page }) => {
    await gotoAndSettle(page, `/client/${CLIENT_WS_ID}/overview`);
    await capture(page, '09-client-overview');
  });

  test('client inbox', async ({ page }) => {
    await gotoAndSettle(page, `/client/${CLIENT_WS_ID}/inbox`);
    await capture(page, '10-client-inbox');
  });
});
