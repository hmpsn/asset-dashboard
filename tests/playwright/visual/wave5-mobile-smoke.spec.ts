import { test, expect, type Page } from '@playwright/test';

const ADMIN_TOKEN = process.env.PHASE2_ADMIN_TOKEN;
const WORKSPACE_ID = process.env.PHASE2_ADMIN_WS_ID;
const CLIENT_PASSWORD = process.env.PHASE2_CLIENT_PASSWORD;

const BREAKPOINTS = [
  { width: 375, height: 812, label: 'mobile' },
  { width: 640, height: 900, label: 'sm' },
  { width: 768, height: 900, label: 'md' },
  { width: 1024, height: 900, label: 'lg' },
] as const;

const ROUTES = [
  { key: 'admin-overview', path: (workspaceId: string) => `/ws/${workspaceId}/overview` },
  { key: 'admin-audit', path: (workspaceId: string) => `/ws/${workspaceId}/audit` },
  { key: 'workspace-settings-connections', path: (workspaceId: string) => `/ws/${workspaceId}/workspace-settings?tab=connections` },
  { key: 'workspace-settings-client-dashboard', path: (workspaceId: string) => `/ws/${workspaceId}/workspace-settings?tab=dashboard` },
  { key: 'client-overview', path: (workspaceId: string) => `/client/${workspaceId}/overview` },
  { key: 'client-strategy', path: (workspaceId: string) => `/client/${workspaceId}/strategy` },
  { key: 'client-content', path: (workspaceId: string) => `/client/${workspaceId}/content` },
] as const;

async function loginAsAdmin(page: Page, token: string): Promise<void> {
  await page.addInitScript((value) => {
    try {
      window.localStorage.setItem('auth_token', value);
    } catch {
      // ignore
    }
  }, token);
}

async function enableClientPassword(page: Page, password: string): Promise<void> {
  await page.addInitScript((value) => {
    try {
      window.localStorage.setItem('client-portal-password', value);
    } catch {
      // ignore
    }
  }, password);
}

async function gotoAndSettle(page: Page, path: string): Promise<void> {
  await page.goto(path, { waitUntil: 'networkidle' });
  await page.waitForTimeout(1200);
}

async function pageHasHorizontalOverflow(page: Page): Promise<boolean> {
  return page.evaluate(() => {
    const doc = document.documentElement;
    return doc.scrollWidth > window.innerWidth + 2;
  });
}

test.describe('Wave 5 mobile breakpoint smoke', () => {
  test.skip(!ADMIN_TOKEN || !WORKSPACE_ID, 'PHASE2_ADMIN_TOKEN + PHASE2_ADMIN_WS_ID required');

  test.beforeEach(async ({ page }) => {
    await loginAsAdmin(page, ADMIN_TOKEN!);
    if (CLIENT_PASSWORD) {
      await enableClientPassword(page, CLIENT_PASSWORD);
    }
  });

  for (const viewport of BREAKPOINTS) {
    for (const route of ROUTES) {
      test(`${viewport.label} ${route.key}`, async ({ page }, testInfo) => {
        await page.setViewportSize({ width: viewport.width, height: viewport.height });
        await gotoAndSettle(page, route.path(WORKSPACE_ID!));

        await expect(page).not.toHaveURL(/\/login$/);
        await expect(pageHasHorizontalOverflow(page)).resolves.toBe(false);

        await page.screenshot({
          path: testInfo.outputPath(`${viewport.label}-${route.key}.png`),
          fullPage: true,
        });
      });
    }
  }
});
