/**
 * Extended integration tests for server/routes/google.ts
 *
 * Uses in-process HTTP via createApp() + http.createServer() so vi.mock
 * interceptors apply to the google-auth, analytics-data, search-console,
 * google-analytics, and ai modules.
 *
 * Scenarios covered:
 *  1.  GET /api/google/status/:siteId — configured + connected
 *  2.  GET /api/google/status/:siteId — configured but NOT connected
 *  3.  GET /api/google/status/:siteId — not configured
 *  4.  GET /api/google/auth-url — global OAuth URL returned
 *  5.  GET /api/google/auth-url — 400 when credentials not set
 *  6.  GET /api/google/status — global connected status
 *  7.  POST /api/google/disconnect — clears global token
 *  8.  GET /api/google/gsc-sites — success path
 *  9.  GET /api/google/gsc-sites — 401 when not connected
 * 10.  GET /api/google/gsc-sites — 500 when listGscSites throws
 * 11.  GET /api/google/callback — missing code returns 400
 * 12.  GET /api/google/callback — missing state returns 400
 * 13.  GET /api/google/callback — Google error param returns 400
 * 14.  GET /api/google/callback — successful exchange redirects
 * 15.  GET /api/google/callback — failed exchange returns 500
 * 16.  GET /api/google/ga4-properties — success
 * 17.  GET /api/google/ga4-properties — 500 when listGA4Properties throws
 * 18.  GET /api/google/search-overview/:siteId — success
 * 19.  GET /api/google/search-overview/:siteId — missing gscSiteUrl returns 400
 * 20.  GET /api/google/search-overview/:siteId — invalid days returns 400
 * 21.  GET /api/google/performance-trend/:siteId — success
 * 22.  GET /api/google/search-devices/:siteId — success
 * 23.  GET /api/google/search-countries/:siteId — invalid limit returns 400
 * 24.  Analytics annotations — full CRUD cycle (create, list, update, delete)
 * 25.  Analytics annotations — workspace isolation (wsA cannot see wsB's annotations)
 * 26.  GET /api/google/annotations/:workspaceId — filter by category
 * 27.  PATCH /api/google/annotations/:workspaceId/:id — 404 for wrong workspace
 * 28.  DELETE /api/google/annotations/:workspaceId/:id — 404 for wrong workspace
 * 29.  GET /api/public/analytics-annotations/:workspaceId — public endpoint
 * 30.  GET /api/google/search-overview/:siteId — 500 when fetchSearchOverview throws
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import http from 'http';
import type { AddressInfo } from 'net';
import { seedWorkspace } from '../fixtures/workspace-seed.js';
import type { SeededFullWorkspace } from '../fixtures/workspace-seed.js';
import db from '../../server/db/index.js';
import { withPublicTestAuth } from './public-auth-test-helpers.js';

// ---------------------------------------------------------------------------
// vi.mock declarations (hoisted before imports)
// ---------------------------------------------------------------------------

vi.mock('../../server/broadcast.js', () => ({
  setBroadcast: vi.fn(),
  broadcast: vi.fn(),
  broadcastToWorkspace: vi.fn(),
}));

const mockInvalidateMonthlyDigestCache = vi.hoisted(() => vi.fn());
const mockClearIntelligenceCache = vi.hoisted(() => vi.fn());

vi.mock('../../server/monthly-digest-cache.js', () => ({
  invalidateMonthlyDigestCache: mockInvalidateMonthlyDigestCache,
}));

vi.mock('../../server/intelligence/cache-clear.js', () => ({
  clearIntelligenceCache: mockClearIntelligenceCache,
}));

// Mutable state captured in vi.hoisted so it can be mutated by individual tests
const googleAuthState = vi.hoisted(() => ({
  globalAuthUrl: 'https://accounts.google.com/o/oauth2/v2/auth?state=_global',
  isGlobalConnected: true,
  credentials: { clientId: 'test-id', clientSecret: 'test-secret', redirectUri: 'http://localhost/callback' } as object | null,
  globalToken: 'global-access-token' as string | null,
  exchangeResult: { success: true } as { success: boolean; error?: string },
  siteConnected: true,
}));

vi.mock('../../server/google-auth.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../server/google-auth.js')>();
  return {
    ...actual,
    GLOBAL_KEY: '_global',
    getGoogleCredentials: vi.fn(() => googleAuthState.credentials),
    getGlobalAuthUrl: vi.fn(() => googleAuthState.globalAuthUrl),
    isGlobalConnected: vi.fn(() => googleAuthState.isGlobalConnected),
    isConnected: vi.fn((siteId: string) => {
      void siteId;
      return googleAuthState.siteConnected;
    }),
    disconnectGlobal: vi.fn(),
    getGlobalToken: vi.fn(async () => googleAuthState.globalToken),
    getAuthUrl: vi.fn((siteId: string) => {
      if (!googleAuthState.credentials) return null;
      return `https://accounts.google.com/o/oauth2/v2/auth?state=${siteId}`;
    }),
    exchangeCode: vi.fn(async (_code: string, _siteId: string) => googleAuthState.exchangeResult),
    disconnect: vi.fn(),
  };
});

const gscState = vi.hoisted(() => ({
  sites: [{ siteUrl: 'https://example.com/', permissionLevel: 'siteOwner' }] as Array<{ siteUrl: string; permissionLevel: string }>,
  shouldThrow: false,
}));

vi.mock('../../server/search-console.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../server/search-console.js')>();
  return {
    ...actual,
    listGscSites: vi.fn(async (_siteId: string) => {
      if (gscState.shouldThrow) throw new Error('GSC API error');
      return gscState.sites;
    }),
  };
});

const ga4State = vi.hoisted(() => ({
  properties: [{ propertyId: '123456789', displayName: 'My Property', createTime: '2021-01-01' }] as Array<{ propertyId: string; displayName: string; createTime: string }>,
  landingPagesCalls: [] as Array<{ propertyId: string; days: number; limit: number; organicOnly: boolean }>,
  shouldThrow: false,
}));

vi.mock('../../server/google-analytics.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../server/google-analytics.js')>();
  return {
    ...actual,
    listGA4Properties: vi.fn(async () => {
      if (ga4State.shouldThrow) throw new Error('GA4 API error');
      return ga4State.properties;
    }),
    getGA4LandingPages: vi.fn(async (
      propertyId: string,
      days: number,
      limit: number,
      organicOnly: boolean,
    ) => {
      ga4State.landingPagesCalls.push({ propertyId, days, limit, organicOnly });
      return [{ landingPage: '/', sessions: 1, users: 1, bounceRate: 0, avgEngagementTime: 0, conversions: 0 }];
    }),
  };
});

const analyticsDataState = vi.hoisted(() => ({
  overview: { clicks: 100, impressions: 1000, ctr: 0.1, position: 5.5 },
  trend: [{ date: '2026-05-01', clicks: 10, impressions: 100 }],
  devices: [{ device: 'DESKTOP', clicks: 80, impressions: 800 }],
  countries: [{ country: 'usa', clicks: 90, impressions: 900 }],
  types: [{ searchType: 'web', clicks: 95, impressions: 950 }],
  comparison: { current: { clicks: 100 }, previous: { clicks: 80 } },
  brandedDemand: {
    status: 'ready' as const,
    denominator: 'impressions' as const,
    tokens: ['example'],
    queryRowsSampled: 3,
    total: { clicks: 100, impressions: 1000 },
    branded: { clicks: 40, impressions: 400, sharePct: 40 },
    nonBranded: { clicks: 60, impressions: 600, sharePct: 60 },
  },
  shouldThrow: false,
}));

vi.mock('../../server/analytics-data.js', () => ({
  fetchSearchOverview: vi.fn(async () => {
    if (analyticsDataState.shouldThrow) throw new Error('Search overview API error');
    return analyticsDataState.overview;
  }),
  fetchBrandedDemandSplit: vi.fn(async () => analyticsDataState.brandedDemand),
  fetchPerformanceTrend: vi.fn(async () => analyticsDataState.trend),
  fetchSearchDevices: vi.fn(async () => analyticsDataState.devices),
  fetchSearchCountries: vi.fn(async () => analyticsDataState.countries),
  fetchSearchTypes: vi.fn(async () => analyticsDataState.types),
  fetchSearchComparison: vi.fn(async () => analyticsDataState.comparison),
}));

vi.mock('../../server/ai.js', () => ({
  callAI: vi.fn(async () => ({ text: 'AI response', usage: {} })),
}));

vi.mock('../../server/workspace-intelligence.js', () => ({
  buildWorkspaceIntelligence: vi.fn(async () => null),
  formatForPrompt: vi.fn(() => ''),
  formatPageMapForPrompt: vi.fn(() => ''),
}));

// ---------------------------------------------------------------------------
// In-process server helpers
// ---------------------------------------------------------------------------

async function startTestServer(): Promise<{
  server: http.Server;
  baseUrl: string;
  stop: () => Promise<void>;
}> {
  delete process.env.APP_PASSWORD;
  const { createApp } = await import('../../server/app.js');
  const app = createApp();
  const server = http.createServer(app);

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  const baseUrl = `http://127.0.0.1:${port}`;

  const stop = () =>
    new Promise<void>((resolve) => {
      server.close(() => resolve());
    });

  return { server, baseUrl, stop };
}

async function req(
  baseUrl: string,
  path: string,
  opts?: RequestInit,
): Promise<{ status: number; body: unknown; headers: Headers }> {
  const res = await fetch(`${baseUrl}${path}`, withPublicTestAuth(path, { ...opts, redirect: 'manual' }));
  let body: unknown;
  const ct = res.headers.get('content-type') ?? '';
  if (ct.includes('application/json')) {
    body = await res.json().catch(() => ({}));
  } else {
    body = await res.text().catch(() => '');
  }
  return { status: res.status, body, headers: res.headers };
}

function getJson(baseUrl: string, path: string) {
  return req(baseUrl, path);
}

function postJson(baseUrl: string, path: string, body: unknown) {
  return req(baseUrl, path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

function patchJson(baseUrl: string, path: string, body: unknown) {
  return req(baseUrl, path, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

function del(baseUrl: string, path: string) {
  return req(baseUrl, path, { method: 'DELETE' });
}

// ---------------------------------------------------------------------------
// Test suites
// ---------------------------------------------------------------------------

describe('GET /api/google/status/:siteId', () => {
  let ws: SeededFullWorkspace;
  let baseUrl: string;
  let stop: () => Promise<void>;

  beforeEach(async () => {
    ws = seedWorkspace();
    googleAuthState.credentials = { clientId: 'test-id', clientSecret: 'test-secret', redirectUri: 'http://localhost/callback' };
    googleAuthState.siteConnected = true;
    const srv = await startTestServer();
    baseUrl = srv.baseUrl;
    stop = srv.stop;
  }, 30_000);

  afterEach(async () => {
    ws.cleanup();
    await stop();
  }, 15_000);

  it('returns configured:true and connected:true when creds exist and site is connected', async () => {
    const { status, body } = await getJson(baseUrl, `/api/google/status/${ws.webflowSiteId}?workspaceId=${ws.workspaceId}`);
    expect(status).toBe(200);
    const b = body as Record<string, unknown>;
    expect(b.configured).toBe(true);
    expect(b.connected).toBe(true);
  });

  it('returns connected:false when site is not connected', async () => {
    googleAuthState.siteConnected = false;
    const { status, body } = await getJson(baseUrl, `/api/google/status/${ws.webflowSiteId}?workspaceId=${ws.workspaceId}`);
    expect(status).toBe(200);
    const b = body as Record<string, unknown>;
    expect(b.connected).toBe(false);
  });

  it('returns configured:false when credentials are not set', async () => {
    googleAuthState.credentials = null;
    const { status, body } = await getJson(baseUrl, `/api/google/status/${ws.webflowSiteId}?workspaceId=${ws.workspaceId}`);
    expect(status).toBe(200);
    const b = body as Record<string, unknown>;
    expect(b.configured).toBe(false);
  });
});

describe('GET /api/google/auth-url — global OAuth URL', () => {
  let baseUrl: string;
  let stop: () => Promise<void>;

  beforeEach(async () => {
    googleAuthState.globalAuthUrl = 'https://accounts.google.com/o/oauth2/v2/auth?state=_global';
    googleAuthState.credentials = { clientId: 'x', clientSecret: 'y', redirectUri: 'z' };
    const srv = await startTestServer();
    baseUrl = srv.baseUrl;
    stop = srv.stop;
  });

  afterEach(async () => { await stop(); });

  it('returns 200 with url when credentials are configured', async () => {
    const { status, body } = await getJson(baseUrl, '/api/google/auth-url');
    expect(status).toBe(200);
    const b = body as Record<string, unknown>;
    expect(typeof b.url).toBe('string');
    expect((b.url as string).length).toBeGreaterThan(0);
  });

  it('returns 400 when getGlobalAuthUrl returns null (credentials missing)', async () => {
    googleAuthState.globalAuthUrl = null as unknown as string;
    // The mock for getGlobalAuthUrl needs to return null
    const { getGlobalAuthUrl } = await import('../../server/google-auth.js');
    vi.mocked(getGlobalAuthUrl).mockReturnValueOnce(null);

    const { status, body } = await getJson(baseUrl, '/api/google/auth-url');
    expect(status).toBe(400);
    expect((body as Record<string, unknown>).error).toContain('Google OAuth not configured');
  });
});

describe('GET /api/google/status — global status', () => {
  let baseUrl: string;
  let stop: () => Promise<void>;

  beforeEach(async () => {
    googleAuthState.isGlobalConnected = true;
    googleAuthState.credentials = { clientId: 'x', clientSecret: 'y', redirectUri: 'z' };
    const srv = await startTestServer();
    baseUrl = srv.baseUrl;
    stop = srv.stop;
  });

  afterEach(async () => { await stop(); });

  it('returns connected:true and configured:true', async () => {
    const { status, body } = await getJson(baseUrl, '/api/google/status');
    expect(status).toBe(200);
    const b = body as Record<string, unknown>;
    expect(b.connected).toBe(true);
    expect(b.configured).toBe(true);
  });

  it('returns connected:false when not globally connected', async () => {
    googleAuthState.isGlobalConnected = false;
    const { isGlobalConnected } = await import('../../server/google-auth.js');
    vi.mocked(isGlobalConnected).mockReturnValueOnce(false);

    const { status, body } = await getJson(baseUrl, '/api/google/status');
    expect(status).toBe(200);
    expect((body as Record<string, unknown>).connected).toBe(false);
  });
});

describe('POST /api/google/disconnect — global disconnect', () => {
  let baseUrl: string;
  let stop: () => Promise<void>;

  beforeEach(async () => {
    const srv = await startTestServer();
    baseUrl = srv.baseUrl;
    stop = srv.stop;
  });

  afterEach(async () => { await stop(); });

  it('returns success:true and calls disconnectGlobal', async () => {
    const { status, body } = await postJson(baseUrl, '/api/google/disconnect', {});
    expect(status).toBe(200);
    expect((body as Record<string, unknown>).success).toBe(true);

    const { disconnectGlobal } = await import('../../server/google-auth.js');
    expect(vi.mocked(disconnectGlobal)).toHaveBeenCalled();
  });
});

describe('GET /api/google/gsc-sites — global GSC sites', () => {
  let baseUrl: string;
  let stop: () => Promise<void>;

  beforeEach(async () => {
    googleAuthState.globalToken = 'global-access-token';
    gscState.shouldThrow = false;
    gscState.sites = [{ siteUrl: 'https://example.com/', permissionLevel: 'siteOwner' }];
    const srv = await startTestServer();
    baseUrl = srv.baseUrl;
    stop = srv.stop;
  });

  afterEach(async () => { await stop(); });

  it('returns 200 with sites array when connected', async () => {
    const { status, body } = await getJson(baseUrl, '/api/google/gsc-sites');
    expect(status).toBe(200);
    expect(Array.isArray(body)).toBe(true);
  });

  it('returns 401 when Google is not connected (no token)', async () => {
    const { getGlobalToken } = await import('../../server/google-auth.js');
    vi.mocked(getGlobalToken).mockResolvedValueOnce(null);

    const { status, body } = await getJson(baseUrl, '/api/google/gsc-sites');
    expect(status).toBe(401);
    expect((body as Record<string, unknown>).error).toBe('Google not connected');
  });

  it('returns 500 when listGscSites throws', async () => {
    gscState.shouldThrow = true;
    const { status, body } = await getJson(baseUrl, '/api/google/gsc-sites');
    expect(status).toBe(500);
    const error = String((body as Record<string, unknown>).error);
    expect(error).toBeTruthy();
    expect(error).not.toContain('GSC API error');
    expect(error).toContain('Unable to load Search Console sites');
  });
});

describe('GET /api/google/callback — OAuth callback edge cases', () => {
  let ws: SeededFullWorkspace;
  let baseUrl: string;
  let stop: () => Promise<void>;

  beforeEach(async () => {
    ws = seedWorkspace();
    googleAuthState.exchangeResult = { success: true };
    mockInvalidateMonthlyDigestCache.mockClear();
    mockClearIntelligenceCache.mockClear();
    const srv = await startTestServer();
    baseUrl = srv.baseUrl;
    stop = srv.stop;
  });

  afterEach(async () => {
    ws.cleanup();
    await stop();
  });

  it('returns 400 text when Google redirects with an error param', async () => {
    const reflectedPayload = encodeURIComponent('<script>alert("xss")</script>');
    const { status, body } = await getJson(baseUrl, `/api/google/callback?error=${reflectedPayload}`);
    expect(status).toBe(400);
    expect(typeof body).toBe('string');
    expect((body as string)).toContain('Google auth error.');
    expect((body as string)).not.toContain('<script>');
    expect((body as string)).not.toContain('alert("xss")');
  });

  it('returns 400 when code is missing', async () => {
    const { status, body } = await getJson(baseUrl, `/api/google/callback?state=${ws.webflowSiteId}`);
    expect(status).toBe(400);
    expect(typeof body).toBe('string');
    expect((body as string)).toContain('Missing code or state');
  });

  it('returns 400 when state (siteId) is missing', async () => {
    const { status, body } = await getJson(baseUrl, '/api/google/callback?code=authcode123');
    expect(status).toBe(400);
    expect(typeof body).toBe('string');
    expect((body as string)).toContain('Missing code or state');
  });

  it('redirects on successful code exchange', async () => {
    googleAuthState.exchangeResult = { success: true };
    const { status, headers } = await getJson(baseUrl, `/api/google/callback?code=validcode&state=${ws.webflowSiteId}`);
    // 302 redirect to the app
    expect(status).toBe(302);
    const location = headers.get('location') ?? '';
    expect(location).toContain('google=connected');
    expect(location).toContain(ws.webflowSiteId);
    expect(mockInvalidateMonthlyDigestCache).toHaveBeenCalledWith(ws.workspaceId);
    expect(mockClearIntelligenceCache).toHaveBeenCalledWith(ws.workspaceId);
  });

  it('returns 500 when code exchange fails', async () => {
    googleAuthState.exchangeResult = { success: false, error: 'Token exchange failed: 400' };
    const { status, body } = await getJson(baseUrl, `/api/google/callback?code=badcode&state=${ws.webflowSiteId}`);
    expect(status).toBe(500);
    expect(typeof body).toBe('string');
    expect((body as string)).toContain('Google auth failed');
    expect((body as string)).not.toContain('Token exchange failed');
  });
});

describe('GET /api/google/ga4-properties', () => {
  let baseUrl: string;
  let stop: () => Promise<void>;

  beforeEach(async () => {
    ga4State.shouldThrow = false;
    ga4State.properties = [{ propertyId: '123456789', displayName: 'My Property', createTime: '2021-01-01' }];
    const srv = await startTestServer();
    baseUrl = srv.baseUrl;
    stop = srv.stop;
  });

  afterEach(async () => { await stop(); });

  it('returns 200 with properties array', async () => {
    const { status, body } = await getJson(baseUrl, '/api/google/ga4-properties');
    expect(status).toBe(200);
    expect(Array.isArray(body)).toBe(true);
  });

  it('returns 500 when listGA4Properties throws', async () => {
    ga4State.shouldThrow = true;
    const { status, body } = await getJson(baseUrl, '/api/google/ga4-properties');
    expect(status).toBe(500);
    const error = String((body as Record<string, unknown>).error);
    expect(error).toBeTruthy();
    expect(error).not.toContain('GA4 API error');
    expect(error).toContain('Unable to load GA4 properties');
  });
});

describe('GET /api/google/analytics-landing-pages/:workspaceId', () => {
  let ws: SeededFullWorkspace;
  let baseUrl: string;
  let stop: () => Promise<void>;

  beforeEach(async () => {
    ws = seedWorkspace({ ga4PropertyId: 'ga4-prop-123' });
    ga4State.landingPagesCalls = [];
    const srv = await startTestServer();
    baseUrl = srv.baseUrl;
    stop = srv.stop;
  });

  afterEach(async () => {
    ws.cleanup();
    await stop();
  });

  it('passes days, limit, and organic flag through to GA4 provider', async () => {
    const { status, body } = await getJson(
      baseUrl,
      `/api/google/analytics-landing-pages/${ws.workspaceId}?days=14&limit=20&organic=true`,
    );

    expect(status).toBe(200);
    expect(Array.isArray(body)).toBe(true);
    expect(ga4State.landingPagesCalls).toEqual([{
      propertyId: 'ga4-prop-123',
      days: 14,
      limit: 20,
      organicOnly: true,
    }]);
  });

  it('rejects invalid limit values', async () => {
    const { status, body } = await getJson(
      baseUrl,
      `/api/google/analytics-landing-pages/${ws.workspaceId}?limit=0`,
    );

    expect(status).toBe(400);
    expect((body as Record<string, unknown>).error).toContain('limit');
    expect(ga4State.landingPagesCalls).toEqual([]);
  });
});

describe('GET /api/google/search-overview/:siteId — validation and errors', () => {
  let ws: SeededFullWorkspace;
  let baseUrl: string;
  let stop: () => Promise<void>;

  beforeEach(async () => {
    ws = seedWorkspace({ gscPropertyUrl: 'https://gsc.example.com/' });
    analyticsDataState.shouldThrow = false;
    const srv = await startTestServer();
    baseUrl = srv.baseUrl;
    stop = srv.stop;
  });

  afterEach(async () => {
    ws.cleanup();
    await stop();
  });

  it('returns 200 with overview data when properly configured', async () => {
    const { status, body } = await getJson(
      baseUrl,
      `/api/google/search-overview/${ws.webflowSiteId}?workspaceId=${ws.workspaceId}&gscSiteUrl=https://gsc.example.com/`,
    );
    expect(status).toBe(200);
    expect(body).toMatchObject({ clicks: expect.any(Number) });
  });

  it('returns 400 when gscSiteUrl is missing', async () => {
    const { status, body } = await getJson(
      baseUrl,
      `/api/google/search-overview/${ws.webflowSiteId}?workspaceId=${ws.workspaceId}`,
    );
    expect(status).toBe(400);
    expect((body as Record<string, unknown>).error).toContain('gscSiteUrl');
  });

  it('returns 400 when days is not a positive integer', async () => {
    const { status, body } = await getJson(
      baseUrl,
      `/api/google/search-overview/${ws.webflowSiteId}?workspaceId=${ws.workspaceId}&gscSiteUrl=https://gsc.example.com/&days=abc`,
    );
    expect(status).toBe(400);
    expect((body as Record<string, unknown>).error).toContain('days');
  });

  it('returns 400 when days is zero', async () => {
    const { status, body } = await getJson(
      baseUrl,
      `/api/google/search-overview/${ws.webflowSiteId}?workspaceId=${ws.workspaceId}&gscSiteUrl=https://gsc.example.com/&days=0`,
    );
    expect(status).toBe(400);
    expect((body as Record<string, unknown>).error).toContain('days');
  });

  it('returns 500 when fetchSearchOverview throws', async () => {
    analyticsDataState.shouldThrow = true;
    const { status, body } = await getJson(
      baseUrl,
      `/api/google/search-overview/${ws.webflowSiteId}?workspaceId=${ws.workspaceId}&gscSiteUrl=https://gsc.example.com/`,
    );
    expect(status).toBe(500);
    const error = String((body as Record<string, unknown>).error);
    expect(error).toBeTruthy();
    expect(error).not.toContain('Search overview API error');
    expect(error).toContain('Unable to load Search Console overview');
  });
});

describe('GET /api/google/performance-trend/:siteId', () => {
  let ws: SeededFullWorkspace;
  let baseUrl: string;
  let stop: () => Promise<void>;

  beforeEach(async () => {
    ws = seedWorkspace({ gscPropertyUrl: 'https://gsc.example.com/' });
    const srv = await startTestServer();
    baseUrl = srv.baseUrl;
    stop = srv.stop;
  });

  afterEach(async () => {
    ws.cleanup();
    await stop();
  });

  it('returns 200 with trend data', async () => {
    const { status, body } = await getJson(
      baseUrl,
      `/api/google/performance-trend/${ws.webflowSiteId}?workspaceId=${ws.workspaceId}&gscSiteUrl=https://gsc.example.com/`,
    );
    expect(status).toBe(200);
    expect(Array.isArray(body)).toBe(true);
  });

  it('returns 400 when gscSiteUrl is missing', async () => {
    const { status, body } = await getJson(
      baseUrl,
      `/api/google/performance-trend/${ws.webflowSiteId}?workspaceId=${ws.workspaceId}`,
    );
    expect(status).toBe(400);
    expect((body as Record<string, unknown>).error).toContain('gscSiteUrl');
  });
});

describe('GET /api/google/search-devices/:siteId', () => {
  let ws: SeededFullWorkspace;
  let baseUrl: string;
  let stop: () => Promise<void>;

  beforeEach(async () => {
    ws = seedWorkspace({ gscPropertyUrl: 'https://gsc.example.com/' });
    const srv = await startTestServer();
    baseUrl = srv.baseUrl;
    stop = srv.stop;
  });

  afterEach(async () => {
    ws.cleanup();
    await stop();
  });

  it('returns 200 with devices data', async () => {
    const { status, body } = await getJson(
      baseUrl,
      `/api/google/search-devices/${ws.webflowSiteId}?workspaceId=${ws.workspaceId}&gscSiteUrl=https://gsc.example.com/`,
    );
    expect(status).toBe(200);
    expect(Array.isArray(body)).toBe(true);
  });
});

describe('GET /api/google/search-countries/:siteId — limit validation', () => {
  let ws: SeededFullWorkspace;
  let baseUrl: string;
  let stop: () => Promise<void>;

  beforeEach(async () => {
    ws = seedWorkspace({ gscPropertyUrl: 'https://gsc.example.com/' });
    const srv = await startTestServer();
    baseUrl = srv.baseUrl;
    stop = srv.stop;
  });

  afterEach(async () => {
    ws.cleanup();
    await stop();
  });

  it('returns 400 when limit is not a positive integer', async () => {
    const { status, body } = await getJson(
      baseUrl,
      `/api/google/search-countries/${ws.webflowSiteId}?workspaceId=${ws.workspaceId}&gscSiteUrl=https://gsc.example.com/&limit=bad`,
    );
    expect(status).toBe(400);
    expect((body as Record<string, unknown>).error).toContain('limit');
  });

  it('returns 200 with countries data using default limit', async () => {
    const { status, body } = await getJson(
      baseUrl,
      `/api/google/search-countries/${ws.webflowSiteId}?workspaceId=${ws.workspaceId}&gscSiteUrl=https://gsc.example.com/`,
    );
    expect(status).toBe(200);
    expect(Array.isArray(body)).toBe(true);
  });
});

describe('Analytics Annotations — full CRUD cycle via /api/google/annotations', () => {
  let ws: SeededFullWorkspace;
  let baseUrl: string;
  let stop: () => Promise<void>;
  let annotationId = '';

  beforeEach(async () => {
    ws = seedWorkspace();
    const srv = await startTestServer();
    baseUrl = srv.baseUrl;
    stop = srv.stop;
    annotationId = '';
  });

  afterEach(async () => {
    // Clean up annotations
    db.prepare('DELETE FROM analytics_annotations WHERE workspace_id = ?').run(ws.workspaceId);
    ws.cleanup();
    await stop();
  });

  it('GET returns empty array initially', async () => {
    const { status, body } = await getJson(baseUrl, `/api/google/annotations/${ws.workspaceId}`);
    expect(status).toBe(200);
    expect(Array.isArray(body)).toBe(true);
    expect((body as unknown[]).length).toBe(0);
  });

  it('POST creates annotation and returns id', async () => {
    const { status, body } = await postJson(baseUrl, `/api/google/annotations/${ws.workspaceId}`, {
      date: '2026-05-01',
      label: 'Site launch',
      category: 'site_change',
    });
    expect(status).toBe(200);
    const b = body as Record<string, unknown>;
    expect(typeof b.id).toBe('string');
    annotationId = b.id as string;
  });

  it('POST without required fields returns 400', async () => {
    const { status, body } = await postJson(baseUrl, `/api/google/annotations/${ws.workspaceId}`, {
      date: '2026-05-01',
      // missing label and category
    });
    expect(status).toBe(400);
    expect((body as Record<string, unknown>).error).toBeTruthy();
  });

  it('POST without date returns 400', async () => {
    const { status, body } = await postJson(baseUrl, `/api/google/annotations/${ws.workspaceId}`, {
      label: 'Some label',
      category: 'other',
      // missing date
    });
    expect(status).toBe(400);
    expect((body as Record<string, unknown>).error).toBeTruthy();
  });

  it('GET lists created annotation', async () => {
    // Create first
    const create = await postJson(baseUrl, `/api/google/annotations/${ws.workspaceId}`, {
      date: '2026-05-10',
      label: 'Algorithm update',
      category: 'algorithm_update',
    });
    const created = create.body as Record<string, unknown>;
    annotationId = created.id as string;

    const { status, body } = await getJson(baseUrl, `/api/google/annotations/${ws.workspaceId}`);
    expect(status).toBe(200);
    const annotations = body as Array<Record<string, unknown>>;
    const found = annotations.find(a => a.id === annotationId);
    expect(found).toBeDefined();
    expect(found?.label).toBe('Algorithm update');
    expect(found?.category).toBe('algorithm_update');
  });

  it('PATCH updates annotation label', async () => {
    const create = await postJson(baseUrl, `/api/google/annotations/${ws.workspaceId}`, {
      date: '2026-05-15',
      label: 'Old label',
      category: 'campaign',
    });
    annotationId = (create.body as Record<string, unknown>).id as string;

    const { status, body } = await patchJson(
      baseUrl,
      `/api/google/annotations/${ws.workspaceId}/${annotationId}`,
      { label: 'Updated label' },
    );
    expect(status).toBe(200);
    expect((body as Record<string, unknown>).ok).toBe(true);

    // Verify the change
    const list = await getJson(baseUrl, `/api/google/annotations/${ws.workspaceId}`);
    const annotations = list.body as Array<Record<string, unknown>>;
    const updated = annotations.find(a => a.id === annotationId);
    expect(updated?.label).toBe('Updated label');
  });

  it('PATCH returns 404 for non-existent annotation id', async () => {
    const { status, body } = await patchJson(
      baseUrl,
      `/api/google/annotations/${ws.workspaceId}/nonexistent-id`,
      { label: 'Any label' },
    );
    expect(status).toBe(404);
    expect((body as Record<string, unknown>).error).toBeTruthy();
  });

  it('DELETE removes annotation', async () => {
    const create = await postJson(baseUrl, `/api/google/annotations/${ws.workspaceId}`, {
      date: '2026-05-20',
      label: 'To delete',
      category: 'other',
    });
    annotationId = (create.body as Record<string, unknown>).id as string;

    const { status, body } = await del(baseUrl, `/api/google/annotations/${ws.workspaceId}/${annotationId}`);
    expect(status).toBe(200);
    expect((body as Record<string, unknown>).ok).toBe(true);

    // Verify gone
    const list = await getJson(baseUrl, `/api/google/annotations/${ws.workspaceId}`);
    const annotations = list.body as Array<Record<string, unknown>>;
    const found = annotations.find(a => a.id === annotationId);
    expect(found).toBeUndefined();
  });

  it('DELETE returns 404 for non-existent annotation', async () => {
    const { status, body } = await del(
      baseUrl,
      `/api/google/annotations/${ws.workspaceId}/nonexistent-id`,
    );
    expect(status).toBe(404);
    expect((body as Record<string, unknown>).error).toBeTruthy();
  });
});

describe('Analytics Annotations — workspace isolation', () => {
  let wsA: SeededFullWorkspace;
  let wsB: SeededFullWorkspace;
  let baseUrl: string;
  let stop: () => Promise<void>;

  beforeEach(async () => {
    wsA = seedWorkspace();
    wsB = seedWorkspace();
    const srv = await startTestServer();
    baseUrl = srv.baseUrl;
    stop = srv.stop;
  });

  afterEach(async () => {
    db.prepare('DELETE FROM analytics_annotations WHERE workspace_id = ?').run(wsA.workspaceId);
    db.prepare('DELETE FROM analytics_annotations WHERE workspace_id = ?').run(wsB.workspaceId);
    wsA.cleanup();
    wsB.cleanup();
    await stop();
  });

  it('workspace A annotations do not appear in workspace B list', async () => {
    // Seed an annotation for wsA
    await postJson(baseUrl, `/api/google/annotations/${wsA.workspaceId}`, {
      date: '2026-05-01',
      label: 'WS-A annotation',
      category: 'site_change',
    });

    // wsB list should be empty
    const { status, body } = await getJson(baseUrl, `/api/google/annotations/${wsB.workspaceId}`);
    expect(status).toBe(200);
    const annotations = body as Array<Record<string, unknown>>;
    expect(annotations).toHaveLength(0);
    expect(annotations.some(a => a.label === 'WS-A annotation')).toBe(false);
  });

  it('PATCH on annotation from wrong workspace returns 404', async () => {
    // Create annotation for wsA
    const create = await postJson(baseUrl, `/api/google/annotations/${wsA.workspaceId}`, {
      date: '2026-05-01',
      label: 'WS-A annotation',
      category: 'other',
    });
    const aId = (create.body as Record<string, unknown>).id as string;

    // Attempt to update it from wsB context
    const { status, body } = await patchJson(
      baseUrl,
      `/api/google/annotations/${wsB.workspaceId}/${aId}`,
      { label: 'Hijacked' },
    );
    expect(status).toBe(404);
    expect((body as Record<string, unknown>).error).toBeTruthy();
  });

  it('DELETE annotation from wrong workspace returns 404', async () => {
    const create = await postJson(baseUrl, `/api/google/annotations/${wsA.workspaceId}`, {
      date: '2026-05-01',
      label: 'WS-A annotation',
      category: 'other',
    });
    const aId = (create.body as Record<string, unknown>).id as string;

    const { status, body } = await del(
      baseUrl,
      `/api/google/annotations/${wsB.workspaceId}/${aId}`,
    );
    expect(status).toBe(404);
    expect((body as Record<string, unknown>).error).toBeTruthy();
  });
});

describe('GET /api/google/annotations/:workspaceId — filter by category', () => {
  let ws: SeededFullWorkspace;
  let baseUrl: string;
  let stop: () => Promise<void>;

  beforeEach(async () => {
    ws = seedWorkspace();
    const srv = await startTestServer();
    baseUrl = srv.baseUrl;
    stop = srv.stop;

    // Seed two annotations of different categories
    await postJson(baseUrl, `/api/google/annotations/${ws.workspaceId}`, {
      date: '2026-05-01',
      label: 'Campaign annotation',
      category: 'campaign',
    });
    await postJson(baseUrl, `/api/google/annotations/${ws.workspaceId}`, {
      date: '2026-05-02',
      label: 'Algorithm annotation',
      category: 'algorithm_update',
    });
  });

  afterEach(async () => {
    db.prepare('DELETE FROM analytics_annotations WHERE workspace_id = ?').run(ws.workspaceId);
    ws.cleanup();
    await stop();
  });

  it('filtering by category=campaign returns only campaign annotations', async () => {
    const { status, body } = await getJson(
      baseUrl,
      `/api/google/annotations/${ws.workspaceId}?category=campaign`,
    );
    expect(status).toBe(200);
    const annotations = body as Array<Record<string, unknown>>;
    expect(annotations.length).toBeGreaterThan(0);
    expect(annotations.every(a => a.category === 'campaign')).toBe(true); // every-ok: length guard on line above
  });

  it('filtering by category=algorithm_update excludes campaign annotations', async () => {
    const { status, body } = await getJson(
      baseUrl,
      `/api/google/annotations/${ws.workspaceId}?category=algorithm_update`,
    );
    expect(status).toBe(200);
    const annotations = body as Array<Record<string, unknown>>;
    expect(annotations.some(a => a.category === 'campaign')).toBe(false);
  });
});

describe('GET /api/public/analytics-annotations/:workspaceId', () => {
  let ws: SeededFullWorkspace;
  let baseUrl: string;
  let stop: () => Promise<void>;

  beforeEach(async () => {
    // Seed with empty clientPassword so the public endpoint doesn't require a session
    ws = seedWorkspace({ clientPassword: '' });
    const srv = await startTestServer();
    baseUrl = srv.baseUrl;
    stop = srv.stop;
  });

  afterEach(async () => {
    db.prepare('DELETE FROM analytics_annotations WHERE workspace_id = ?').run(ws.workspaceId);
    ws.cleanup();
    await stop();
  });

  it('returns 200 with array (no auth required)', async () => {
    const { status, body } = await getJson(baseUrl, `/api/public/analytics-annotations/${ws.workspaceId}`);
    expect(status).toBe(200);
    expect(Array.isArray(body)).toBe(true);
  });

  it('reflects annotations created via admin endpoint', async () => {
    await postJson(baseUrl, `/api/google/annotations/${ws.workspaceId}`, {
      date: '2026-05-05',
      label: 'Public test annotation',
      category: 'other',
    });

    const { status, body } = await getJson(baseUrl, `/api/public/analytics-annotations/${ws.workspaceId}`);
    expect(status).toBe(200);
    const annotations = body as Array<Record<string, unknown>>;
    const found = annotations.find(a => a.label === 'Public test annotation');
    expect(found).toBeDefined();
  });
});
