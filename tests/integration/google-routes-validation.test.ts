/**
 * Integration tests for server/routes/google.ts — validation paths only.
 *
 * Focuses on routes that return 400/401/403/404 on bad input or missing auth,
 * without making real Google API calls. Every external API module is mocked.
 *
 * Routes covered:
 *  1.  GET /api/google/status/:siteId — configured and connected
 *  2.  GET /api/google/status/:siteId — not configured (credentials missing)
 *  3.  GET /api/google/auth-url — 400 when credentials are not set
 *  4.  GET /api/google/callback — 400 when error param present
 *  5.  GET /api/google/callback — 400 when code is missing
 *  6.  GET /api/google/callback — 400 when state is missing
 *  7.  GET /api/google/search-overview/:siteId — 400 when gscSiteUrl missing
 *  8.  GET /api/google/search-overview/:siteId — 400 when days is non-positive
 *  9.  GET /api/google/search-overview/:siteId — 400 when days is zero
 * 10.  GET /api/google/performance-trend/:siteId — 400 when gscSiteUrl missing
 * 11.  GET /api/google/performance-trend/:siteId — 400 when days is non-integer
 * 12.  GET /api/google/search-devices/:siteId — 400 when gscSiteUrl missing
 * 13.  GET /api/google/search-countries/:siteId — 400 when limit is invalid
 * 14.  GET /api/google/search-types/:siteId — 400 when gscSiteUrl missing
 * 15.  GET /api/google/search-comparison/:siteId — 400 when gscSiteUrl missing
 * 16.  GET /api/google/gsc-sites — 401 when not globally connected
 * 17.  POST /api/google/annotations/:workspaceId — 400 when required fields missing
 * 18.  GET /api/google/status — global status shape
 */

// @vitest-environment node
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { seedWorkspace, type SeededFullWorkspace } from '../fixtures/workspace-seed.js';
import db from '../../server/db/index.js';

// ---------------------------------------------------------------------------
// vi.mock declarations — all external Google API modules mocked
// ---------------------------------------------------------------------------

vi.mock('../../server/broadcast.js', () => ({
  setBroadcast: vi.fn(),
  broadcast: vi.fn(),
  broadcastToWorkspace: vi.fn(),
}));

const googleAuthState = vi.hoisted(() => ({
  credentials: { clientId: 'test-id', clientSecret: 'test-secret', redirectUri: 'http://localhost/callback' } as object | null,
  globalAuthUrl: 'https://accounts.google.com/o/oauth2/v2/auth?state=_global' as string | null,
  isGlobalConnected: true,
  siteConnected: true,
  globalToken: 'global-access-token' as string | null,
  exchangeResult: { success: true } as { success: boolean; error?: string },
}));

vi.mock('../../server/google-auth.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../server/google-auth.js')>();
  return {
    ...actual,
    GLOBAL_KEY: '_global',
    getGoogleCredentials: vi.fn(() => googleAuthState.credentials),
    getGlobalAuthUrl: vi.fn(() => googleAuthState.globalAuthUrl),
    isGlobalConnected: vi.fn(() => googleAuthState.isGlobalConnected),
    isConnected: vi.fn(() => googleAuthState.siteConnected),
    disconnectGlobal: vi.fn(),
    getGlobalToken: vi.fn(async () => googleAuthState.globalToken),
    getAuthUrl: vi.fn((siteId: string) => {
      if (!googleAuthState.credentials) return null;
      return `https://accounts.google.com/o/oauth2/v2/auth?state=${siteId}`;
    }),
    exchangeCode: vi.fn(async () => googleAuthState.exchangeResult),
    disconnect: vi.fn(),
  };
});

vi.mock('../../server/search-console.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../server/search-console.js')>();
  return {
    ...actual,
    listGscSites: vi.fn(async () => []),
  };
});

vi.mock('../../server/google-analytics.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../server/google-analytics.js')>();
  return {
    ...actual,
    listGA4Properties: vi.fn(async () => []),
  };
});

vi.mock('../../server/analytics-data.js', () => ({
  fetchSearchOverview: vi.fn(async () => ({ clicks: 0, impressions: 0, ctr: 0, position: 0 })),
  fetchPerformanceTrend: vi.fn(async () => []),
  fetchSearchDevices: vi.fn(async () => []),
  fetchSearchCountries: vi.fn(async () => []),
  fetchSearchTypes: vi.fn(async () => []),
  fetchSearchComparison: vi.fn(async () => ({})),
}));

vi.mock('../../server/ai.js', () => ({
  callAI: vi.fn(async () => ({ text: 'mocked', usage: {} })),
}));

vi.mock('../../server/workspace-intelligence.js', () => ({
  buildWorkspaceIntelligence: vi.fn(async () => null),
  formatForPrompt: vi.fn(() => ''),
  formatPageMapForPrompt: vi.fn(() => ''),
}));

// ---------------------------------------------------------------------------
// Shared in-process server helpers
// ---------------------------------------------------------------------------

async function startServer(): Promise<{ baseUrl: string; stop: () => Promise<void> }> {
  delete process.env.APP_PASSWORD;
  const { createApp } = await import('../../server/app.js'); // dynamic-import-ok
  const app = createApp();
  const server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  return {
    baseUrl: `http://127.0.0.1:${port}`,
    stop: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}

async function req(
  baseUrl: string,
  path: string,
  opts?: RequestInit,
): Promise<{ status: number; body: unknown; headers: Headers }> {
  const res = await fetch(`${baseUrl}${path}`, { ...opts, redirect: 'manual' });
  let body: unknown;
  const ct = res.headers.get('content-type') ?? '';
  if (ct.includes('application/json')) {
    body = await res.json().catch(() => ({}));
  } else {
    body = await res.text().catch(() => '');
  }
  return { status: res.status, body, headers: res.headers };
}

const getJson = (baseUrl: string, path: string) => req(baseUrl, path);
const postJson = (baseUrl: string, path: string, body: unknown) =>
  req(baseUrl, path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

// ---------------------------------------------------------------------------
// Test suites
// ---------------------------------------------------------------------------

describe('GET /api/google/status/:siteId — connection state', () => {
  let ws: SeededFullWorkspace;
  let baseUrl: string;
  let stop: () => Promise<void>;

  beforeEach(async () => {
    ws = seedWorkspace();
    googleAuthState.credentials = { clientId: 'test-id', clientSecret: 'test-secret', redirectUri: 'http://localhost/callback' };
    googleAuthState.siteConnected = true;
    const srv = await startServer();
    baseUrl = srv.baseUrl;
    stop = srv.stop;
  }, 30_000);

  afterEach(async () => {
    ws.cleanup();
    await stop();
  }, 15_000);

  it('returns configured:true when credentials are present', async () => {
    const { status, body } = await getJson(baseUrl, `/api/google/status/${ws.webflowSiteId}?workspaceId=${ws.workspaceId}`);
    expect(status).toBe(200);
    expect((body as Record<string, unknown>).configured).toBe(true);
  });

  it('returns configured:false when credentials are null', async () => {
    googleAuthState.credentials = null;
    const { getGoogleCredentials } = await import('../../server/google-auth.js');
    vi.mocked(getGoogleCredentials).mockReturnValueOnce(null);

    const { status, body } = await getJson(baseUrl, `/api/google/status/${ws.webflowSiteId}?workspaceId=${ws.workspaceId}`);
    expect(status).toBe(200);
    expect((body as Record<string, unknown>).configured).toBe(false);
  });
});

describe('GET /api/google/auth-url — global OAuth URL validation', () => {
  let baseUrl: string;
  let stop: () => Promise<void>;

  beforeEach(async () => {
    googleAuthState.credentials = { clientId: 'x', clientSecret: 'y', redirectUri: 'z' };
    const srv = await startServer();
    baseUrl = srv.baseUrl;
    stop = srv.stop;
  }, 30_000);

  afterEach(async () => { await stop(); }, 15_000);

  it('returns 400 when credentials are not configured', async () => {
    const { getGlobalAuthUrl } = await import('../../server/google-auth.js');
    vi.mocked(getGlobalAuthUrl).mockReturnValueOnce(null);

    const { status, body } = await getJson(baseUrl, '/api/google/auth-url');
    expect(status).toBe(400);
    expect((body as Record<string, unknown>).error).toContain('Google OAuth not configured');
  });
});

describe('GET /api/google/status — global connected status', () => {
  let baseUrl: string;
  let stop: () => Promise<void>;

  beforeEach(async () => {
    googleAuthState.isGlobalConnected = true;
    googleAuthState.credentials = { clientId: 'x', clientSecret: 'y', redirectUri: 'z' };
    const srv = await startServer();
    baseUrl = srv.baseUrl;
    stop = srv.stop;
  }, 30_000);

  afterEach(async () => { await stop(); }, 15_000);

  it('returns connected and configured flags', async () => {
    const { status, body } = await getJson(baseUrl, '/api/google/status');
    expect(status).toBe(200);
    const b = body as Record<string, unknown>;
    expect(typeof b.connected).toBe('boolean');
    expect(typeof b.configured).toBe('boolean');
  });
});

describe('GET /api/google/callback — error and missing params', () => {
  let ws: SeededFullWorkspace;
  let baseUrl: string;
  let stop: () => Promise<void>;

  beforeEach(async () => {
    ws = seedWorkspace();
    googleAuthState.exchangeResult = { success: true };
    const srv = await startServer();
    baseUrl = srv.baseUrl;
    stop = srv.stop;
  }, 30_000);

  afterEach(async () => {
    ws.cleanup();
    await stop();
  }, 15_000);

  it('returns 400 when Google passes an error param', async () => {
    const { status } = await getJson(baseUrl, '/api/google/callback?error=access_denied');
    expect(status).toBe(400);
  });

  it('returns 400 when code is missing', async () => {
    const { status, body } = await getJson(baseUrl, `/api/google/callback?state=${ws.webflowSiteId}`);
    expect(status).toBe(400);
    expect(body as string).toContain('Missing code or state');
  });

  it('returns 400 when state is missing', async () => {
    const { status, body } = await getJson(baseUrl, '/api/google/callback?code=authcode123');
    expect(status).toBe(400);
    expect(body as string).toContain('Missing code or state');
  });
});

describe('GET /api/google/search-overview/:siteId — validation', () => {
  let ws: SeededFullWorkspace;
  let baseUrl: string;
  let stop: () => Promise<void>;

  beforeEach(async () => {
    ws = seedWorkspace({ gscPropertyUrl: 'https://gsc.example.com/' });
    const srv = await startServer();
    baseUrl = srv.baseUrl;
    stop = srv.stop;
  }, 30_000);

  afterEach(async () => {
    ws.cleanup();
    await stop();
  }, 15_000);

  it('returns 400 when gscSiteUrl query param is missing', async () => {
    const { status, body } = await getJson(
      baseUrl,
      `/api/google/search-overview/${ws.webflowSiteId}?workspaceId=${ws.workspaceId}`,
    );
    expect(status).toBe(400);
    expect((body as Record<string, unknown>).error).toContain('gscSiteUrl');
  });

  it('returns 400 when days is a non-numeric string', async () => {
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

  it('returns 400 when days is negative', async () => {
    const { status, body } = await getJson(
      baseUrl,
      `/api/google/search-overview/${ws.webflowSiteId}?workspaceId=${ws.workspaceId}&gscSiteUrl=https://gsc.example.com/&days=-5`,
    );
    expect(status).toBe(400);
    expect((body as Record<string, unknown>).error).toContain('days');
  });
});

describe('GET /api/google/performance-trend/:siteId — validation', () => {
  let ws: SeededFullWorkspace;
  let baseUrl: string;
  let stop: () => Promise<void>;

  beforeEach(async () => {
    ws = seedWorkspace({ gscPropertyUrl: 'https://gsc.example.com/' });
    const srv = await startServer();
    baseUrl = srv.baseUrl;
    stop = srv.stop;
  }, 30_000);

  afterEach(async () => {
    ws.cleanup();
    await stop();
  }, 15_000);

  it('returns 400 when gscSiteUrl is missing', async () => {
    const { status, body } = await getJson(
      baseUrl,
      `/api/google/performance-trend/${ws.webflowSiteId}?workspaceId=${ws.workspaceId}`,
    );
    expect(status).toBe(400);
    expect((body as Record<string, unknown>).error).toContain('gscSiteUrl');
  });

  it('returns 400 when days is a non-integer float', async () => {
    const { status, body } = await getJson(
      baseUrl,
      `/api/google/performance-trend/${ws.webflowSiteId}?workspaceId=${ws.workspaceId}&gscSiteUrl=https://gsc.example.com/&days=3.7`,
    );
    expect(status).toBe(400);
    expect((body as Record<string, unknown>).error).toContain('days');
  });
});

describe('GET /api/google/search-devices/:siteId — validation', () => {
  let ws: SeededFullWorkspace;
  let baseUrl: string;
  let stop: () => Promise<void>;

  beforeEach(async () => {
    ws = seedWorkspace({ gscPropertyUrl: 'https://gsc.example.com/' });
    const srv = await startServer();
    baseUrl = srv.baseUrl;
    stop = srv.stop;
  }, 30_000);

  afterEach(async () => {
    ws.cleanup();
    await stop();
  }, 15_000);

  it('returns 400 when gscSiteUrl is missing', async () => {
    const { status, body } = await getJson(
      baseUrl,
      `/api/google/search-devices/${ws.webflowSiteId}?workspaceId=${ws.workspaceId}`,
    );
    expect(status).toBe(400);
    expect((body as Record<string, unknown>).error).toContain('gscSiteUrl');
  });
});

describe('GET /api/google/search-countries/:siteId — limit validation', () => {
  let ws: SeededFullWorkspace;
  let baseUrl: string;
  let stop: () => Promise<void>;

  beforeEach(async () => {
    ws = seedWorkspace({ gscPropertyUrl: 'https://gsc.example.com/' });
    const srv = await startServer();
    baseUrl = srv.baseUrl;
    stop = srv.stop;
  }, 30_000);

  afterEach(async () => {
    ws.cleanup();
    await stop();
  }, 15_000);

  it('returns 400 when limit is not a positive integer', async () => {
    const { status, body } = await getJson(
      baseUrl,
      `/api/google/search-countries/${ws.webflowSiteId}?workspaceId=${ws.workspaceId}&gscSiteUrl=https://gsc.example.com/&limit=bad`,
    );
    expect(status).toBe(400);
    expect((body as Record<string, unknown>).error).toContain('limit');
  });

  it('returns 400 when limit is zero', async () => {
    const { status, body } = await getJson(
      baseUrl,
      `/api/google/search-countries/${ws.webflowSiteId}?workspaceId=${ws.workspaceId}&gscSiteUrl=https://gsc.example.com/&limit=0`,
    );
    expect(status).toBe(400);
    expect((body as Record<string, unknown>).error).toContain('limit');
  });

  it('returns 400 when gscSiteUrl is missing', async () => {
    const { status, body } = await getJson(
      baseUrl,
      `/api/google/search-countries/${ws.webflowSiteId}?workspaceId=${ws.workspaceId}`,
    );
    expect(status).toBe(400);
    expect((body as Record<string, unknown>).error).toContain('gscSiteUrl');
  });
});

describe('GET /api/google/search-types/:siteId — validation', () => {
  let ws: SeededFullWorkspace;
  let baseUrl: string;
  let stop: () => Promise<void>;

  beforeEach(async () => {
    ws = seedWorkspace({ gscPropertyUrl: 'https://gsc.example.com/' });
    const srv = await startServer();
    baseUrl = srv.baseUrl;
    stop = srv.stop;
  }, 30_000);

  afterEach(async () => {
    ws.cleanup();
    await stop();
  }, 15_000);

  it('returns 400 when gscSiteUrl is missing', async () => {
    const { status, body } = await getJson(
      baseUrl,
      `/api/google/search-types/${ws.webflowSiteId}?workspaceId=${ws.workspaceId}`,
    );
    expect(status).toBe(400);
    expect((body as Record<string, unknown>).error).toContain('gscSiteUrl');
  });
});

describe('GET /api/google/search-comparison/:siteId — validation', () => {
  let ws: SeededFullWorkspace;
  let baseUrl: string;
  let stop: () => Promise<void>;

  beforeEach(async () => {
    ws = seedWorkspace({ gscPropertyUrl: 'https://gsc.example.com/' });
    const srv = await startServer();
    baseUrl = srv.baseUrl;
    stop = srv.stop;
  }, 30_000);

  afterEach(async () => {
    ws.cleanup();
    await stop();
  }, 15_000);

  it('returns 400 when gscSiteUrl is missing', async () => {
    const { status, body } = await getJson(
      baseUrl,
      `/api/google/search-comparison/${ws.webflowSiteId}?workspaceId=${ws.workspaceId}`,
    );
    expect(status).toBe(400);
    expect((body as Record<string, unknown>).error).toContain('gscSiteUrl');
  });
});

describe('GET /api/google/gsc-sites — 401 when not connected', () => {
  let baseUrl: string;
  let stop: () => Promise<void>;

  beforeEach(async () => {
    googleAuthState.globalToken = null;
    const srv = await startServer();
    baseUrl = srv.baseUrl;
    stop = srv.stop;
  }, 30_000);

  afterEach(async () => { await stop(); }, 15_000);

  it('returns 401 when no global token is present', async () => {
    const { getGlobalToken } = await import('../../server/google-auth.js');
    vi.mocked(getGlobalToken).mockResolvedValueOnce(null);

    const { status, body } = await getJson(baseUrl, '/api/google/gsc-sites');
    expect(status).toBe(401);
    expect((body as Record<string, unknown>).error).toBe('Google not connected');
  });
});

describe('POST /api/google/annotations/:workspaceId — validation', () => {
  let ws: SeededFullWorkspace;
  let baseUrl: string;
  let stop: () => Promise<void>;

  beforeEach(async () => {
    ws = seedWorkspace();
    const srv = await startServer();
    baseUrl = srv.baseUrl;
    stop = srv.stop;
  }, 30_000);

  afterEach(async () => {
    db.prepare('DELETE FROM analytics_annotations WHERE workspace_id = ?').run(ws.workspaceId);
    ws.cleanup();
    await stop();
  }, 15_000);

  it('returns 400 when date is missing', async () => {
    const { status, body } = await postJson(baseUrl, `/api/google/annotations/${ws.workspaceId}`, {
      label: 'Some event',
      category: 'other',
    });
    expect(status).toBe(400);
    expect((body as Record<string, unknown>).error).toBeTruthy();
  });

  it('returns 400 when label is missing', async () => {
    const { status, body } = await postJson(baseUrl, `/api/google/annotations/${ws.workspaceId}`, {
      date: '2026-05-01',
      category: 'other',
    });
    expect(status).toBe(400);
    expect((body as Record<string, unknown>).error).toBeTruthy();
  });

  it('returns 400 when category is missing', async () => {
    const { status, body } = await postJson(baseUrl, `/api/google/annotations/${ws.workspaceId}`, {
      date: '2026-05-01',
      label: 'Some event',
    });
    expect(status).toBe(400);
    expect((body as Record<string, unknown>).error).toBeTruthy();
  });

  it('returns 200 when all required fields are present', async () => {
    const { status, body } = await postJson(baseUrl, `/api/google/annotations/${ws.workspaceId}`, {
      date: '2026-05-01',
      label: 'Valid annotation',
      category: 'site_change',
    });
    expect(status).toBe(200);
    expect(typeof (body as Record<string, unknown>).id).toBe('string');
  });
});
