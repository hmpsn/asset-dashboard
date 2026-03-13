/**
 * Playwright E2E smoke tests for critical UI flows.
 *
 * Tests:
 * - App loads and shows login or dashboard
 * - Health endpoint accessible
 * - Workspace creation flow (if authenticated)
 */
import { test, expect } from '@playwright/test';

test.describe('Smoke tests', () => {
  test('health endpoint returns ok', async ({ request }) => {
    const res = await request.get('/api/health');
    expect(res.ok()).toBe(true);
    const body = await res.json();
    expect(body.ok).toBe(true);
  });

  test('app loads without errors', async ({ page }) => {
    // No unhandled JS errors — register listener before navigation
    const errors: string[] = [];
    page.on('pageerror', (err) => errors.push(err.message));
    await page.goto('/');
    // Should load the React app — either login page or dashboard
    await expect(page.locator('body')).not.toBeEmpty();
    await page.waitForTimeout(2000);
    // Allow WebSocket errors but no React crashes
    const criticalErrors = errors.filter(
      (e) => !e.includes('WebSocket') && !e.includes('ws://'),
    );
    expect(criticalErrors).toHaveLength(0);
  });

  test('API returns workspace list', async ({ request }) => {
    const res = await request.get('/api/workspaces');
    expect(res.ok()).toBe(true);
    const body = await res.json();
    expect(Array.isArray(body)).toBe(true);
  });
});
