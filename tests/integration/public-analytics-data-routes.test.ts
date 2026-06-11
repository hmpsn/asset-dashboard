/**
 * Integration tests for public-analytics data routes (Wave 7).
 *
 * Covers the untested paths in server/routes/public-analytics.ts:
 *
 * 1. Auth boundary — unauthenticated requests to password-protected workspaces return 401
 * 2. Auth pass-through — passwordless workspaces allow URL-only access
 * 3. GA4 endpoints — return 400 with descriptive error when ga4PropertyId not configured
 * 4. GSC endpoints — return 400 with descriptive error when gscPropertyUrl/webflowSiteId not configured
 * 5. GA4 analytics-event-trend — requires ?event= query param; returns 400 if missing
 * 6. insights/digest — runs regardless of external credentials; returns full MonthlyDigestData shape
 * 7. Non-existent workspace — 404 for insight sub-routes that do workspace lookup before credential check
 * 8. Additional GSC endpoint variants not tested in public-analytics.test.ts
 *
 * NOTE: All GA4 / GSC data-return paths (200 with actual data) require live API credentials
 * not available in CI. The 400 "not configured" guard is the correct observable behavior
 * in this test environment and is itself a meaningful correctness assertion.
 *
 * Port: 13368 (confirmed free)
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createTestContext } from './helpers.js';
import { seedWorkspace } from '../fixtures/workspace-seed.js';
import { createClientUser, deleteClientUser, signClientToken } from '../../server/client-users.js';
import { randomUUID } from 'crypto';

const ctx = createTestContext(13368, { autoPublicAuth: true }); // port-ok: confirmed free, above 13356 (current max)
const { api } = ctx;

// ── Workspace fixtures ──────────────────────────────────────────────────────
// wsId: no GA4 / GSC credentials, no client password (passwordless — URL-only auth)
let wsId = '';
let wsCleanup: (() => void) | undefined;

// wsProtectedId: has a client password → requires auth token
let wsProtectedId = '';
let wsProtectedCleanup: (() => void) | undefined;

// Client auth for wsProtectedId
let clientUserId = '';
let clientToken = '';

// Helper: make request with client_user_token cookie for wsProtectedId
function clientApi(urlPath: string, workspaceId = wsProtectedId, token = clientToken): Promise<Response> {
  return api(urlPath, {
    headers: {
      Cookie: `client_user_token_${workspaceId}=${token}`,
    },
  });
}

beforeAll(async () => {
  await ctx.startServer();

  // Passwordless workspace — no GA4 or GSC configured
  const wsA = seedWorkspace({ clientPassword: '' });
  wsId = wsA.workspaceId;
  wsCleanup = wsA.cleanup;

  // Password-protected workspace — no GA4 or GSC configured
  const wsB = seedWorkspace({ clientPassword: 'secret-pw-123' });
  wsProtectedId = wsB.workspaceId;
  wsProtectedCleanup = wsB.cleanup;

  // Create a client user for wsProtectedId so we can get a valid JWT
  const user = await createClientUser(
    `analytics-data-${randomUUID().slice(0, 8)}@test.local`,
    'ClientPass1!',
    'Analytics Data Test Client',
    wsProtectedId,
    'client_member',
  );
  clientUserId = user.id;
  clientToken = signClientToken(user);
}, 30_000);

afterAll(async () => {
  if (clientUserId) deleteClientUser(clientUserId, wsProtectedId);
  wsProtectedCleanup?.();
  wsCleanup?.();
  await ctx.stopServer();
});

// ─────────────────────────────────────────────────────────────────────────────
// 1. Auth boundary — password-protected workspace returns 401 without a token
// ─────────────────────────────────────────────────────────────────────────────

describe('Auth boundary — password-protected workspace', () => {
  it('GET /api/public/insights/:workspaceId returns 401 without token on password-protected workspace', async () => {
    const res = await api(`/api/public/insights/${wsProtectedId}`, { headers: { 'x-no-auto-public-auth': 'true' } });
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body).toHaveProperty('error');
  });

  it('GET /api/public/analytics-overview/:workspaceId returns 401 without token on protected workspace', async () => {
    const res = await api(`/api/public/analytics-overview/${wsProtectedId}`, { headers: { 'x-no-auto-public-auth': 'true' } });
    expect(res.status).toBe(401);
  });

  it('GET /api/public/search-overview/:workspaceId returns 401 without token on protected workspace', async () => {
    const res = await api(`/api/public/search-overview/${wsProtectedId}`, { headers: { 'x-no-auto-public-auth': 'true' } });
    expect(res.status).toBe(401);
  });

  it('GET /api/public/insights/:workspaceId/narrative returns 401 without token on protected workspace', async () => {
    const res = await api(`/api/public/insights/${wsProtectedId}/narrative`, { headers: { 'x-no-auto-public-auth': 'true' } });
    expect(res.status).toBe(401);
  });

  it('GET /api/public/insights/:workspaceId/digest returns 401 without token on protected workspace', async () => {
    const res = await api(`/api/public/insights/${wsProtectedId}/digest`, { headers: { 'x-no-auto-public-auth': 'true' } });
    expect(res.status).toBe(401);
  });

  it('authenticated client token allows access to protected workspace insights', async () => {
    const res = await clientApi(`/api/public/insights/${wsProtectedId}`);
    // With valid token, auth passes — endpoint proceeds (no GA4/GSC but insights route doesn't need them)
    expect(res.status).toBe(200);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 2. Passwordless workspace — no token required, URL-only access
// ─────────────────────────────────────────────────────────────────────────────

describe('Passwordless workspace — URL-only access (no token required)', () => {
  it('GET /api/public/insights/:workspaceId returns 200 without any token', async () => {
    const res = await api(`/api/public/insights/${wsId}`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(Array.isArray(body)).toBe(true);
  });

  it('GET /api/public/insights/:workspaceId/narrative returns 200 without any token', async () => {
    const res = await api(`/api/public/insights/${wsId}/narrative`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toHaveProperty('insights');
    expect(Array.isArray(body.insights)).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 3. GA4 endpoints — 400 when ga4PropertyId not configured
// ─────────────────────────────────────────────────────────────────────────────

describe('GA4 analytics endpoints — missing credential guard', () => {
  it('GET /api/public/analytics-trend returns 400 when GA4 not configured', async () => {
    const res = await api(`/api/public/analytics-trend/${wsId}`);
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body).toHaveProperty('error');
    expect(typeof body.error).toBe('string');
    expect(body.error.toLowerCase()).toMatch(/ga4|not configured/);
  });

  it('GET /api/public/analytics-top-pages returns 400 when GA4 not configured', async () => {
    const res = await api(`/api/public/analytics-top-pages/${wsId}`);
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body).toHaveProperty('error');
  });

  it('GET /api/public/analytics-sources returns 400 when GA4 not configured', async () => {
    const res = await api(`/api/public/analytics-sources/${wsId}`);
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body).toHaveProperty('error');
  });

  it('GET /api/public/analytics-devices returns 400 when GA4 not configured', async () => {
    const res = await api(`/api/public/analytics-devices/${wsId}`);
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body).toHaveProperty('error');
  });

  it('GET /api/public/analytics-countries returns 400 when GA4 not configured', async () => {
    const res = await api(`/api/public/analytics-countries/${wsId}`);
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body).toHaveProperty('error');
  });

  it('GET /api/public/analytics-comparison returns 400 when GA4 not configured', async () => {
    const res = await api(`/api/public/analytics-comparison/${wsId}`);
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body).toHaveProperty('error');
  });

  it('GET /api/public/analytics-new-vs-returning returns 400 when GA4 not configured', async () => {
    const res = await api(`/api/public/analytics-new-vs-returning/${wsId}`);
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body).toHaveProperty('error');
  });

  it('GET /api/public/analytics-events returns 400 when GA4 not configured', async () => {
    const res = await api(`/api/public/analytics-events/${wsId}`);
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body).toHaveProperty('error');
  });

  it('GET /api/public/analytics-conversions returns 400 when GA4 not configured', async () => {
    const res = await api(`/api/public/analytics-conversions/${wsId}`);
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body).toHaveProperty('error');
  });

  it('GET /api/public/analytics-landing-pages returns 400 when GA4 not configured', async () => {
    const res = await api(`/api/public/analytics-landing-pages/${wsId}`);
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body).toHaveProperty('error');
  });

  it('GET /api/public/analytics-organic returns 400 when GA4 not configured', async () => {
    const res = await api(`/api/public/analytics-organic/${wsId}`);
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body).toHaveProperty('error');
  });

  it('GET /api/public/analytics-event-explorer returns 400 when GA4 not configured', async () => {
    const res = await api(`/api/public/analytics-event-explorer/${wsId}`);
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body).toHaveProperty('error');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 4. analytics-event-trend — requires ?event= query param
// ─────────────────────────────────────────────────────────────────────────────

describe('GET /api/public/analytics-event-trend — query param validation', () => {
  it('returns 400 when GA4 not configured (credential check fires before param check)', async () => {
    // The route checks ga4PropertyId FIRST; since ws has no GA4, we get 400 immediately
    const res = await api(`/api/public/analytics-event-trend/${wsId}`);
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body).toHaveProperty('error');
  });

  it('returns 400 for missing ?event= param on a workspace that has GA4 configured', async () => {
    // Seed a workspace that has ga4PropertyId set so we can reach the param validation
    const wsWithGA4 = seedWorkspace({ clientPassword: '', ga4PropertyId: 'fake-ga4-prop-id' });
    try {
      const res = await api(`/api/public/analytics-event-trend/${wsWithGA4.workspaceId}`);
      // Credential check passes (ga4PropertyId present), param check fires → 400
      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body).toHaveProperty('error');
      expect(body.error).toMatch(/event/i);
    } finally {
      wsWithGA4.cleanup();
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 5. GSC endpoints — additional variants not covered in public-analytics.test.ts
// ─────────────────────────────────────────────────────────────────────────────

describe('GSC analytics endpoints — missing credential guard', () => {
  it('GET /api/public/search-devices returns 400 when GSC not configured', async () => {
    const res = await api(`/api/public/search-devices/${wsId}`);
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body).toHaveProperty('error');
    expect(body.error.toLowerCase()).toMatch(/search console|not configured/);
  });

  it('GET /api/public/search-countries returns 400 when GSC not configured', async () => {
    const res = await api(`/api/public/search-countries/${wsId}`);
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body).toHaveProperty('error');
  });

  it('GET /api/public/search-types returns 400 when GSC not configured', async () => {
    const res = await api(`/api/public/search-types/${wsId}`);
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body).toHaveProperty('error');
  });

  it('GET /api/public/search-comparison returns 400 when GSC not configured', async () => {
    const res = await api(`/api/public/search-comparison/${wsId}`);
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body).toHaveProperty('error');
  });

  it('all credential-error responses include a string error field (never null)', async () => {
    const endpoints = [
      `/api/public/search-devices/${wsId}`,
      `/api/public/search-countries/${wsId}`,
      `/api/public/search-types/${wsId}`,
      `/api/public/search-comparison/${wsId}`,
    ];
    for (const endpoint of endpoints) {
      const res = await api(endpoint);
      const body = await res.json() as { error: unknown };
      expect(typeof body.error).toBe('string');
      expect((body.error as string).length).toBeGreaterThan(0);
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 6. GET /api/public/insights/:workspaceId/digest — MonthlyDigestData shape
// ─────────────────────────────────────────────────────────────────────────────

describe('GET /api/public/insights/:workspaceId/digest — digest shape', () => {
  it('returns 200 and a valid MonthlyDigestData shape even when no external data configured', async () => {
    const res = await api(`/api/public/insights/${wsId}/digest`);
    // Digest degrades gracefully when GSC/GA4 missing — always returns 200
    expect(res.status).toBe(200);
    const body = await res.json() as Record<string, unknown>;
    // Required top-level fields per MonthlyDigestData
    expect(body).toHaveProperty('month');
    expect(body).toHaveProperty('period');
    expect(body).toHaveProperty('summary');
    expect(body).toHaveProperty('wins');
    expect(body).toHaveProperty('issuesAddressed');
    expect(body).toHaveProperty('metrics');
  });

  it('digest.month is a non-empty string', async () => {
    const res = await api(`/api/public/insights/${wsId}/digest`);
    expect(res.status).toBe(200);
    const body = await res.json() as { month: unknown };
    expect(typeof body.month).toBe('string');
    expect((body.month as string).length).toBeGreaterThan(0);
  });

  it('digest.period has start and end ISO strings', async () => {
    const res = await api(`/api/public/insights/${wsId}/digest`);
    expect(res.status).toBe(200);
    const { period } = await res.json() as { period: { start: unknown; end: unknown } };
    expect(period).toHaveProperty('start');
    expect(period).toHaveProperty('end');
    expect(typeof period.start).toBe('string');
    expect(typeof period.end).toBe('string');
    // Validate ISO format by parsing
    expect(new Date(period.start as string).getTime()).not.toBeNaN();
    expect(new Date(period.end as string).getTime()).not.toBeNaN();
  });

  it('digest.wins is an array', async () => {
    const res = await api(`/api/public/insights/${wsId}/digest`);
    expect(res.status).toBe(200);
    const { wins } = await res.json() as { wins: unknown };
    expect(Array.isArray(wins)).toBe(true);
  });

  it('digest.issuesAddressed is an array', async () => {
    const res = await api(`/api/public/insights/${wsId}/digest`);
    expect(res.status).toBe(200);
    const { issuesAddressed } = await res.json() as { issuesAddressed: unknown };
    expect(Array.isArray(issuesAddressed)).toBe(true);
  });

  it('digest.metrics has numeric fields (defaults to 0 when no GSC/GA4 data)', async () => {
    const res = await api(`/api/public/insights/${wsId}/digest`);
    expect(res.status).toBe(200);
    const { metrics } = await res.json() as {
      metrics: {
        clicksChange: unknown;
        impressionsChange: unknown;
        avgPositionChange: unknown;
        pagesOptimized: unknown;
      };
    };
    expect(typeof metrics.clicksChange).toBe('number');
    expect(typeof metrics.impressionsChange).toBe('number');
    expect(typeof metrics.avgPositionChange).toBe('number');
    expect(typeof metrics.pagesOptimized).toBe('number');
  });

  it('digest.summary is a non-empty string', async () => {
    const res = await api(`/api/public/insights/${wsId}/digest`);
    expect(res.status).toBe(200);
    const body = await res.json() as { summary: unknown };
    expect(typeof body.summary).toBe('string');
    expect((body.summary as string).length).toBeGreaterThan(0);
  });

  it('returns 404 for non-existent workspace', async () => {
    const res = await api('/api/public/insights/ws_does_not_exist_digest_test/digest');
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body).toHaveProperty('error');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 7. Non-existent workspace — 404 for all credential-gated endpoints
// ─────────────────────────────────────────────────────────────────────────────

describe('Non-existent workspace — 404 or 400 (not 500)', () => {
  const fakeId = 'ws_wave7_nonexistent_xyz';

  it('GET /api/public/analytics-trend with fake workspaceId returns 400 or 404 (not 500)', async () => {
    const res = await api(`/api/public/analytics-trend/${fakeId}`);
    expect([400, 404]).toContain(res.status);
  });

  it('GET /api/public/analytics-top-pages with fake workspaceId returns 400 or 404', async () => {
    const res = await api(`/api/public/analytics-top-pages/${fakeId}`);
    expect([400, 404]).toContain(res.status);
  });

  it('GET /api/public/analytics-sources with fake workspaceId returns 400 or 404', async () => {
    const res = await api(`/api/public/analytics-sources/${fakeId}`);
    expect([400, 404]).toContain(res.status);
  });

  it('GET /api/public/analytics-devices with fake workspaceId returns 400 or 404', async () => {
    const res = await api(`/api/public/analytics-devices/${fakeId}`);
    expect([400, 404]).toContain(res.status);
  });

  it('GET /api/public/analytics-countries with fake workspaceId returns 400 or 404', async () => {
    const res = await api(`/api/public/analytics-countries/${fakeId}`);
    expect([400, 404]).toContain(res.status);
  });

  it('GET /api/public/analytics-new-vs-returning with fake workspaceId returns 400 or 404', async () => {
    const res = await api(`/api/public/analytics-new-vs-returning/${fakeId}`);
    expect([400, 404]).toContain(res.status);
  });

  it('GET /api/public/analytics-events with fake workspaceId returns 400 or 404', async () => {
    const res = await api(`/api/public/analytics-events/${fakeId}`);
    expect([400, 404]).toContain(res.status);
  });

  it('GET /api/public/search-devices with fake workspaceId returns 400 or 404', async () => {
    const res = await api(`/api/public/search-devices/${fakeId}`);
    expect([400, 404]).toContain(res.status);
  });

  it('GET /api/public/search-countries with fake workspaceId returns 400 or 404', async () => {
    const res = await api(`/api/public/search-countries/${fakeId}`);
    expect([400, 404]).toContain(res.status);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 8. Response Content-Type — all JSON endpoints return application/json
// ─────────────────────────────────────────────────────────────────────────────

describe('Response Content-Type — all endpoints return application/json', () => {
  it('GET /api/public/insights/:workspaceId returns Content-Type: application/json', async () => {
    const res = await api(`/api/public/insights/${wsId}`);
    expect(res.headers.get('content-type')).toMatch(/application\/json/);
  });

  it('GET /api/public/analytics-overview returns Content-Type: application/json on 400', async () => {
    const res = await api(`/api/public/analytics-overview/${wsId}`);
    expect(res.status).toBe(400);
    expect(res.headers.get('content-type')).toMatch(/application\/json/);
  });

  it('GET /api/public/analytics-trend returns Content-Type: application/json on 400', async () => {
    const res = await api(`/api/public/analytics-trend/${wsId}`);
    expect(res.status).toBe(400);
    expect(res.headers.get('content-type')).toMatch(/application\/json/);
  });

  it('GET /api/public/search-overview returns Content-Type: application/json on 400', async () => {
    const res = await api(`/api/public/search-overview/${wsId}`);
    expect(res.status).toBe(400);
    expect(res.headers.get('content-type')).toMatch(/application\/json/);
  });

  it('GET /api/public/insights/:workspaceId/digest returns Content-Type: application/json', async () => {
    const res = await api(`/api/public/insights/${wsId}/digest`);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toMatch(/application\/json/);
  });
});
