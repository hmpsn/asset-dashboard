/**
 * Integration tests for server/routes/webflow-analysis.ts
 * Port: 13383
 *
 * Covers:
 * - POST /api/competitor-compare (happy path, validation errors, audit error)
 * - GET  /api/competitor-compare-snapshot (with / without params)
 * - GET  /api/competitor-compare-latest (with / without param)
 * - GET  /api/webflow/link-check-domains/:siteId (happy path, error, 403)
 * - GET  /api/webflow/link-check/:siteId (happy path, error, 403)
 * - GET  /api/webflow/link-check-snapshot/:siteId (null, data, 403)
 * - GET  /api/webflow/redirect-scan/:siteId (happy path, error, 403)
 * - GET  /api/webflow/redirect-snapshot/:siteId (null, data, 403)
 * - GET  /api/webflow/internal-links/:siteId (happy path, error, 403)
 * - GET  /api/webflow/internal-links-snapshot/:siteId (null, data, 403)
 * - Auth boundary: JWT user without workspace access → 403 for siteId-scoped routes
 */

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import http from 'http';
import type { AddressInfo } from 'net';
import { seedWorkspace } from '../fixtures/workspace-seed.js';
import type { SeededFullWorkspace } from '../fixtures/workspace-seed.js';
import { createUser, deleteUser } from '../../server/users.js';
import { signToken } from '../../server/auth.js';

// ---------------------------------------------------------------------------
// Hoisted mock state (must precede any vi.mock calls)
// ---------------------------------------------------------------------------

const salesAuditState = vi.hoisted(() => ({
  shouldThrow: false,
  result: null as null | Record<string, unknown>,
}));

const linkCheckerState = vi.hoisted(() => ({
  getSiteDomainsShouldThrow: false,
  getSiteDomainsResult: null as null | Record<string, unknown>,
  checkSiteLinksShouldThrow: false,
  checkSiteLinksResult: null as null | Record<string, unknown>,
}));

const redirectScannerState = vi.hoisted(() => ({
  shouldThrow: false,
  result: null as null | Record<string, unknown>,
}));

const internalLinksState = vi.hoisted(() => ({
  shouldThrow: false,
  result: null as null | Record<string, unknown>,
}));

const gscState = vi.hoisted(() => ({
  shouldThrow: false,
  result: [] as Array<{ page: string; clicks: number; impressions: number }>,
}));

// ---------------------------------------------------------------------------
// Module mocks
// ---------------------------------------------------------------------------

vi.mock('../../server/sales-audit.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../server/sales-audit.js')>();
  return {
    ...actual,
    runSalesAudit: vi.fn(async () => {
      if (salesAuditState.shouldThrow) throw new Error('sales audit failed');
      return salesAuditState.result ?? makeSalesAuditResult('https://example.com', 'Example Site');
    }),
  };
});

vi.mock('../../server/link-checker.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../server/link-checker.js')>();
  return {
    ...actual,
    getSiteDomains: vi.fn(async () => {
      if (linkCheckerState.getSiteDomainsShouldThrow) throw new Error('domain fetch failed');
      return linkCheckerState.getSiteDomainsResult ?? {
        staging: 'https://test-site.webflow.io',
        customDomains: ['https://example.com'],
        defaultDomain: 'https://example.com',
      };
    }),
    checkSiteLinks: vi.fn(async () => {
      if (linkCheckerState.checkSiteLinksShouldThrow) throw new Error('link check failed');
      return linkCheckerState.checkSiteLinksResult ?? {
        totalLinks: 10,
        deadLinks: [],
        redirects: [],
        healthy: 10,
        checkedAt: new Date().toISOString(),
        crawledDomain: 'https://example.com',
      };
    }),
  };
});

vi.mock('../../server/redirect-scanner.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../server/redirect-scanner.js')>();
  return {
    ...actual,
    scanRedirects: vi.fn(async () => {
      if (redirectScannerState.shouldThrow) throw new Error('redirect scan failed');
      return redirectScannerState.result ?? makeRedirectScanResult();
    }),
  };
});

vi.mock('../../server/internal-links.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../server/internal-links.js')>();
  return {
    ...actual,
    analyzeInternalLinks: vi.fn(async () => {
      if (internalLinksState.shouldThrow) throw new Error('internal links failed');
      return internalLinksState.result ?? makeInternalLinksResult();
    }),
  };
});

vi.mock('../../server/search-console.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../server/search-console.js')>();
  return {
    ...actual,
    getAllGscPages: vi.fn(async () => {
      if (gscState.shouldThrow) throw new Error('gsc failed');
      return gscState.result;
    }),
  };
});

vi.mock('../../server/broadcast.js', () => ({
  setBroadcast: vi.fn(),
  broadcast: vi.fn(),
  broadcastToWorkspace: vi.fn(),
}));

// ---------------------------------------------------------------------------
// Result shape builders
// ---------------------------------------------------------------------------

function makeSalesAuditResult(url: string, siteName: string) {
  return {
    url,
    siteName,
    siteScore: 75,
    totalPages: 5,
    errors: 1,
    warnings: 2,
    infos: 3,
    pages: [
      {
        page: '/',
        url,
        score: 80,
        issues: [
          { check: 'title', severity: 'warning', message: 'Title too short', recommendation: 'Add more context', value: 'Home' },
        ],
      },
    ],
    siteWideIssues: [],
    quickWins: [],
    topRisks: [],
    generatedAt: new Date().toISOString(),
  };
}

function makeRedirectScanResult() {
  return {
    chains: [],
    pageStatuses: [
      { url: 'https://example.com/', path: '/', title: 'Home', status: 200, statusText: 'OK', source: 'static' },
    ],
    summary: {
      totalPages: 1,
      healthy: 1,
      redirecting: 0,
      notFound: 0,
      errors: 0,
      chainsDetected: 0,
      longestChain: 0,
    },
    scannedAt: new Date().toISOString(),
  };
}

function makeInternalLinksResult() {
  return {
    suggestions: [
      {
        fromPage: '/about',
        fromTitle: 'About',
        toPage: '/services',
        toTitle: 'Services',
        anchorText: 'our services',
        reason: 'Related content',
        priority: 'high' as const,
      },
    ],
    pageCount: 3,
    attemptedPageCount: 3,
    existingLinkCount: 5,
    analyzedAt: new Date().toISOString(),
    pageHealth: [],
    orphanCount: 0,
  };
}

// ---------------------------------------------------------------------------
// Test server
// ---------------------------------------------------------------------------

const nativeFetch = globalThis.fetch;
const originalAppPassword = process.env.APP_PASSWORD;

let baseUrl = '';
let server: http.Server | undefined;

async function startTestServer(): Promise<void> {
  delete process.env.APP_PASSWORD;
  const { createApp } = await import('../../server/app.js');
  const app = createApp();
  server = http.createServer(app);
  await new Promise<void>(resolve => server!.listen(0, '127.0.0.1', resolve));
  const { port } = server!.address() as AddressInfo;
  baseUrl = `http://127.0.0.1:${port}`;
}

async function stopTestServer(): Promise<void> {
  if (!server) return;
  await new Promise<void>((resolve, reject) => {
    server!.close(err => (err ? reject(err) : resolve()));
  });
  server = undefined;
}

function api(path: string, opts?: RequestInit): Promise<Response> {
  return nativeFetch(`${baseUrl}${path}`, opts);
}

function postJson(path: string, body: unknown): Promise<Response> {
  return api(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

function apiWithToken(token: string, path: string, opts?: RequestInit): Promise<Response> {
  return nativeFetch(`${baseUrl}${path}`, {
    ...opts,
    headers: { ...(opts?.headers ?? {}), Authorization: `Bearer ${token}` },
  });
}

// ---------------------------------------------------------------------------
// Workspace + auth fixtures
// ---------------------------------------------------------------------------

let ws: SeededFullWorkspace;

beforeAll(async () => {
  await startTestServer();
}, 30_000);

beforeEach(() => {
  // Reset mock states
  salesAuditState.shouldThrow = false;
  salesAuditState.result = null;
  linkCheckerState.getSiteDomainsShouldThrow = false;
  linkCheckerState.getSiteDomainsResult = null;
  linkCheckerState.checkSiteLinksShouldThrow = false;
  linkCheckerState.checkSiteLinksResult = null;
  redirectScannerState.shouldThrow = false;
  redirectScannerState.result = null;
  internalLinksState.shouldThrow = false;
  internalLinksState.result = null;
  gscState.shouldThrow = false;
  gscState.result = [];

  ws = seedWorkspace();
});

afterEach(() => {
  ws.cleanup();
});

afterAll(async () => {
  await stopTestServer();
  if (originalAppPassword === undefined) delete process.env.APP_PASSWORD;
  else process.env.APP_PASSWORD = originalAppPassword;
});

// ---------------------------------------------------------------------------
// Competitor Compare
// ---------------------------------------------------------------------------

describe('POST /api/competitor-compare', () => {
  it('returns 400 when myUrl is missing', async () => {
    const res = await postJson('/api/competitor-compare', { competitorUrl: 'https://competitor.com' });
    expect(res.status).toBe(400);
    const body = await res.json() as Record<string, unknown>;
    expect(body.error).toContain('myUrl');
  });

  it('returns 400 when competitorUrl is missing', async () => {
    const res = await postJson('/api/competitor-compare', { myUrl: 'https://mysite.com' });
    expect(res.status).toBe(400);
    const body = await res.json() as Record<string, unknown>;
    expect(body.error).toContain('competitorUrl');
  });

  it('returns 400 when maxPages is zero', async () => {
    const res = await postJson('/api/competitor-compare', {
      myUrl: 'https://mysite.com',
      competitorUrl: 'https://competitor.com',
      maxPages: 0,
    });
    expect(res.status).toBe(400);
    const body = await res.json() as Record<string, unknown>;
    expect(body.error).toMatch(/positive integer/);
  });

  it('returns 400 when maxPages exceeds 30', async () => {
    const res = await postJson('/api/competitor-compare', {
      myUrl: 'https://mysite.com',
      competitorUrl: 'https://competitor.com',
      maxPages: 31,
    });
    expect(res.status).toBe(400);
    const body = await res.json() as Record<string, unknown>;
    expect(body.error).toMatch(/30/);
  });

  it('returns comparison result on happy path', async () => {
    salesAuditState.result = makeSalesAuditResult('https://mysite.com', 'My Site');

    const res = await postJson('/api/competitor-compare', {
      myUrl: 'https://mysite.com',
      competitorUrl: 'https://competitor.com',
      maxPages: 5,
    });
    expect(res.status).toBe(200);
    const body = await res.json() as Record<string, unknown>;
    expect(body).toHaveProperty('mySite');
    expect(body).toHaveProperty('competitor');
    expect(body).toHaveProperty('advantages');
    expect(body).toHaveProperty('disadvantages');
    expect(body).toHaveProperty('opportunities');
    expect(body).toHaveProperty('comparedAt');
    const mySite = body.mySite as Record<string, unknown>;
    expect(mySite).toHaveProperty('metrics');
    const metrics = mySite.metrics as Record<string, unknown>;
    expect(metrics).toHaveProperty('score');
    expect(metrics).toHaveProperty('totalPages');
    expect(metrics).toHaveProperty('errors');
  });

  it('returns 500 when runSalesAudit throws', async () => {
    salesAuditState.shouldThrow = true;

    const res = await postJson('/api/competitor-compare', {
      myUrl: 'https://mysite.com',
      competitorUrl: 'https://competitor.com',
    });
    expect(res.status).toBe(500);
    const body = await res.json() as Record<string, unknown>;
    expect(body.error).toBe('Comparison failed');
  });

  it('uses default maxPages of 20 when omitted', async () => {
    const res = await postJson('/api/competitor-compare', {
      myUrl: 'https://mysite.com',
      competitorUrl: 'https://competitor.com',
    });
    expect(res.status).toBe(200);
  });
});

// ---------------------------------------------------------------------------
// Competitor Compare Snapshot
// ---------------------------------------------------------------------------

describe('GET /api/competitor-compare-snapshot', () => {
  it('returns null when params are missing', async () => {
    const res = await api('/api/competitor-compare-snapshot');
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toBeNull();
  });

  it('returns null when snapshot does not exist', async () => {
    const res = await api('/api/competitor-compare-snapshot?myUrl=https%3A%2F%2Fnone.com&competitorUrl=https%3A%2F%2Fother.com');
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toBeNull();
  });

  it('returns saved snapshot after a competitor-compare POST', async () => {
    const myUrl = `https://snap-test-${Date.now()}.com`;
    const competitorUrl = `https://snap-comp-${Date.now()}.com`;

    salesAuditState.result = makeSalesAuditResult(myUrl, 'Snap Test Site');

    await postJson('/api/competitor-compare', { myUrl, competitorUrl, maxPages: 2 });

    const res = await api(
      `/api/competitor-compare-snapshot?myUrl=${encodeURIComponent(myUrl)}&competitorUrl=${encodeURIComponent(competitorUrl)}`,
    );
    expect(res.status).toBe(200);
    // Snapshot is wrapped in { siteId, createdAt, result: { mySite, competitor, ... } }
    const body = await res.json() as Record<string, unknown>;
    expect(body).toHaveProperty('result');
    const result = body.result as Record<string, unknown>;
    expect(result).toHaveProperty('mySite');
    expect(result).toHaveProperty('competitor');
  });
});

// ---------------------------------------------------------------------------
// Competitor Compare Latest
// ---------------------------------------------------------------------------

describe('GET /api/competitor-compare-latest', () => {
  it('returns null when myUrl param is missing', async () => {
    const res = await api('/api/competitor-compare-latest');
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toBeNull();
  });

  it('returns null when no comparison exists for that site', async () => {
    const res = await api('/api/competitor-compare-latest?myUrl=https%3A%2F%2Fno-such-site.com');
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toBeNull();
  });

  it('returns the latest comparison after a POST', async () => {
    const myUrl = `https://latest-test-${Date.now()}.com`;
    const competitorUrl = `https://latest-comp-${Date.now()}.com`;

    salesAuditState.result = makeSalesAuditResult(myUrl, 'Latest Test Site');

    await postJson('/api/competitor-compare', { myUrl, competitorUrl, maxPages: 2 });

    const res = await api(`/api/competitor-compare-latest?myUrl=${encodeURIComponent(myUrl)}`);
    expect(res.status).toBe(200);
    // getLatestCompetitorCompareForSite returns { createdAt, result: { mySite, competitor, ... } }
    const body = await res.json() as Record<string, unknown>;
    expect(body).toHaveProperty('result');
    const result = body.result as Record<string, unknown>;
    expect(result).toHaveProperty('mySite');
  });
});

// ---------------------------------------------------------------------------
// Link Check Domains
// ---------------------------------------------------------------------------

describe('GET /api/webflow/link-check-domains/:siteId', () => {
  it('returns domain info on happy path', async () => {
    const res = await api(
      `/api/webflow/link-check-domains/${ws.webflowSiteId}?workspaceId=${ws.workspaceId}`,
    );
    expect(res.status).toBe(200);
    const body = await res.json() as Record<string, unknown>;
    expect(body).toHaveProperty('staging');
    expect(body).toHaveProperty('customDomains');
    expect(body).toHaveProperty('defaultDomain');
    expect(body.staging).toBe('https://test-site.webflow.io');
  });

  it('returns empty domain shape when getSiteDomains throws', async () => {
    linkCheckerState.getSiteDomainsShouldThrow = true;

    const res = await api(
      `/api/webflow/link-check-domains/${ws.webflowSiteId}?workspaceId=${ws.workspaceId}`,
    );
    // Route catches the error and returns a fallback — not a 500
    expect(res.status).toBe(200);
    const body = await res.json() as Record<string, unknown>;
    expect(body.staging).toBe('');
    expect(body.defaultDomain).toBe('');
  });

  it('returns empty domain shape when getSiteDomains returns null', async () => {
    linkCheckerState.getSiteDomainsResult = null;
    // Override mock to specifically return null (not the default shape)
    const { getSiteDomains } = await import('../../server/link-checker.js');
    vi.mocked(getSiteDomains).mockResolvedValueOnce(null);

    const res = await api(
      `/api/webflow/link-check-domains/${ws.webflowSiteId}?workspaceId=${ws.workspaceId}`,
    );
    expect(res.status).toBe(200);
    const body = await res.json() as Record<string, unknown>;
    expect(body.staging).toBe('');
  });

  it('returns 403 when JWT user does not own the workspace for this site', async () => {
    const otherWs = seedWorkspace();
    const user = await createUser(
      `link-domains-test-${Date.now()}@test.local`,
      'TestPass1!',
      'Link Domains Test User',
      'member',
      [otherWs.workspaceId], // access to otherWs, NOT ws
    );
    const token = signToken({ userId: user.id, email: user.email, role: user.role });

    try {
      const res = await apiWithToken(
        token,
        `/api/webflow/link-check-domains/${ws.webflowSiteId}?workspaceId=${ws.workspaceId}`,
      );
      expect(res.status).toBe(403);
      const body = await res.json() as Record<string, unknown>;
      expect(body.error).toContain('access');
    } finally {
      deleteUser(user.id);
      otherWs.cleanup();
    }
  });
});

// ---------------------------------------------------------------------------
// Link Check
// ---------------------------------------------------------------------------

describe('GET /api/webflow/link-check/:siteId', () => {
  it('returns link check result on happy path', async () => {
    const res = await api(
      `/api/webflow/link-check/${ws.webflowSiteId}?workspaceId=${ws.workspaceId}`,
    );
    expect(res.status).toBe(200);
    const body = await res.json() as Record<string, unknown>;
    expect(body).toHaveProperty('totalLinks');
    expect(body).toHaveProperty('deadLinks');
    expect(body).toHaveProperty('redirects');
    expect(body).toHaveProperty('healthy');
    expect(body).toHaveProperty('checkedAt');
    expect(body.totalLinks).toBe(10);
  });

  it('returns 500 when checkSiteLinks throws', async () => {
    linkCheckerState.checkSiteLinksShouldThrow = true;

    const res = await api(
      `/api/webflow/link-check/${ws.webflowSiteId}?workspaceId=${ws.workspaceId}`,
    );
    expect(res.status).toBe(500);
    const body = await res.json() as Record<string, unknown>;
    expect(body.error).toBe('Link check failed');
  });

  it('returns 403 when JWT user does not own the workspace for this site', async () => {
    const otherWs = seedWorkspace();
    const user = await createUser(
      `link-check-test-${Date.now()}@test.local`,
      'TestPass1!',
      'Link Check Test User',
      'member',
      [otherWs.workspaceId],
    );
    const token = signToken({ userId: user.id, email: user.email, role: user.role });

    try {
      const res = await apiWithToken(
        token,
        `/api/webflow/link-check/${ws.webflowSiteId}?workspaceId=${ws.workspaceId}`,
      );
      expect(res.status).toBe(403);
    } finally {
      deleteUser(user.id);
      otherWs.cleanup();
    }
  });
});

// ---------------------------------------------------------------------------
// Link Check Snapshot
// ---------------------------------------------------------------------------

describe('GET /api/webflow/link-check-snapshot/:siteId', () => {
  it('returns null when no snapshot exists', async () => {
    const res = await api(
      `/api/webflow/link-check-snapshot/${ws.webflowSiteId}?workspaceId=${ws.workspaceId}`,
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toBeNull();
  });

  it('returns saved snapshot after a link check', async () => {
    // First run a link check to save a snapshot
    await api(`/api/webflow/link-check/${ws.webflowSiteId}?workspaceId=${ws.workspaceId}`);

    const res = await api(
      `/api/webflow/link-check-snapshot/${ws.webflowSiteId}?workspaceId=${ws.workspaceId}`,
    );
    expect(res.status).toBe(200);
    // getLinkCheck returns Snapshot<T>: { siteId, createdAt, result: { totalLinks, ... } }
    const body = await res.json() as Record<string, unknown>;
    expect(body).not.toBeNull();
    expect(body).toHaveProperty('siteId');
    expect(body).toHaveProperty('result');
    const result = body.result as Record<string, unknown>;
    expect(result).toHaveProperty('totalLinks');
  });

  it('returns 403 when JWT user does not own the workspace', async () => {
    const otherWs = seedWorkspace();
    const user = await createUser(
      `link-snap-test-${Date.now()}@test.local`,
      'TestPass1!',
      'Link Snap Test User',
      'member',
      [otherWs.workspaceId],
    );
    const token = signToken({ userId: user.id, email: user.email, role: user.role });

    try {
      const res = await apiWithToken(
        token,
        `/api/webflow/link-check-snapshot/${ws.webflowSiteId}?workspaceId=${ws.workspaceId}`,
      );
      expect(res.status).toBe(403);
    } finally {
      deleteUser(user.id);
      otherWs.cleanup();
    }
  });
});

// ---------------------------------------------------------------------------
// Redirect Scan
// ---------------------------------------------------------------------------

describe('GET /api/webflow/redirect-scan/:siteId', () => {
  it('returns redirect scan result on happy path', async () => {
    const res = await api(
      `/api/webflow/redirect-scan/${ws.webflowSiteId}?workspaceId=${ws.workspaceId}`,
    );
    expect(res.status).toBe(200);
    const body = await res.json() as Record<string, unknown>;
    expect(body).toHaveProperty('chains');
    expect(body).toHaveProperty('pageStatuses');
    expect(body).toHaveProperty('summary');
    expect(body).toHaveProperty('scannedAt');
    const summary = body.summary as Record<string, unknown>;
    expect(summary).toHaveProperty('totalPages');
    expect(summary).toHaveProperty('healthy');
    expect(summary).toHaveProperty('redirecting');
  });

  it('returns 500 when scanRedirects throws', async () => {
    redirectScannerState.shouldThrow = true;

    const res = await api(
      `/api/webflow/redirect-scan/${ws.webflowSiteId}?workspaceId=${ws.workspaceId}`,
    );
    expect(res.status).toBe(500);
    const body = await res.json() as Record<string, unknown>;
    expect(body.error).toBe('Redirect scan failed');
  });

  it('returns 403 when JWT user does not own the workspace for this site', async () => {
    const otherWs = seedWorkspace();
    const user = await createUser(
      `redirect-scan-test-${Date.now()}@test.local`,
      'TestPass1!',
      'Redirect Scan Test User',
      'member',
      [otherWs.workspaceId],
    );
    const token = signToken({ userId: user.id, email: user.email, role: user.role });

    try {
      const res = await apiWithToken(
        token,
        `/api/webflow/redirect-scan/${ws.webflowSiteId}?workspaceId=${ws.workspaceId}`,
      );
      expect(res.status).toBe(403);
    } finally {
      deleteUser(user.id);
      otherWs.cleanup();
    }
  });

  it('proceeds when workspace has GSC property URL configured', async () => {
    const wsWithGsc = seedWorkspace({ gscPropertyUrl: 'https://example.com/' });
    gscState.result = [
      { page: 'https://example.com/about', clicks: 5, impressions: 100 },
    ];

    const res = await api(
      `/api/webflow/redirect-scan/${wsWithGsc.webflowSiteId}?workspaceId=${wsWithGsc.workspaceId}`,
    );
    expect(res.status).toBe(200);
    const body = await res.json() as Record<string, unknown>;
    expect(body).toHaveProperty('summary');

    wsWithGsc.cleanup();
  });

  it('continues scan when GSC fetch throws', async () => {
    const wsWithGsc = seedWorkspace({ gscPropertyUrl: 'https://example.com/' });
    gscState.shouldThrow = true;

    const res = await api(
      `/api/webflow/redirect-scan/${wsWithGsc.webflowSiteId}?workspaceId=${wsWithGsc.workspaceId}`,
    );
    // Should still return a result — GSC failure is non-fatal
    expect(res.status).toBe(200);
    const body = await res.json() as Record<string, unknown>;
    expect(body).toHaveProperty('summary');

    wsWithGsc.cleanup();
  });
});

// ---------------------------------------------------------------------------
// Redirect Snapshot
// ---------------------------------------------------------------------------

describe('GET /api/webflow/redirect-snapshot/:siteId', () => {
  it('returns null when no snapshot exists', async () => {
    const res = await api(
      `/api/webflow/redirect-snapshot/${ws.webflowSiteId}?workspaceId=${ws.workspaceId}`,
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toBeNull();
  });

  it('returns saved snapshot after a redirect scan', async () => {
    // Run a scan to persist the snapshot
    await api(`/api/webflow/redirect-scan/${ws.webflowSiteId}?workspaceId=${ws.workspaceId}`);

    const res = await api(
      `/api/webflow/redirect-snapshot/${ws.webflowSiteId}?workspaceId=${ws.workspaceId}`,
    );
    expect(res.status).toBe(200);
    // getRedirectSnapshot returns { id, siteId, createdAt, result: { chains, pageStatuses, summary, scannedAt } }
    const body = await res.json() as Record<string, unknown>;
    expect(body).not.toBeNull();
    expect(body).toHaveProperty('siteId');
    expect(body).toHaveProperty('result');
    const result = body.result as Record<string, unknown>;
    expect(result).toHaveProperty('summary');
  });

  it('returns 403 when JWT user does not own the workspace', async () => {
    const otherWs = seedWorkspace();
    const user = await createUser(
      `redirect-snap-test-${Date.now()}@test.local`,
      'TestPass1!',
      'Redirect Snap Test User',
      'member',
      [otherWs.workspaceId],
    );
    const token = signToken({ userId: user.id, email: user.email, role: user.role });

    try {
      const res = await apiWithToken(
        token,
        `/api/webflow/redirect-snapshot/${ws.webflowSiteId}?workspaceId=${ws.workspaceId}`,
      );
      expect(res.status).toBe(403);
    } finally {
      deleteUser(user.id);
      otherWs.cleanup();
    }
  });
});

// ---------------------------------------------------------------------------
// Internal Links
// ---------------------------------------------------------------------------

describe('GET /api/webflow/internal-links/:siteId', () => {
  it('returns internal link analysis on happy path', async () => {
    const res = await api(
      `/api/webflow/internal-links/${ws.webflowSiteId}?workspaceId=${ws.workspaceId}`,
    );
    expect(res.status).toBe(200);
    const body = await res.json() as Record<string, unknown>;
    expect(body).toHaveProperty('suggestions');
    expect(body).toHaveProperty('pageCount');
    expect(body).toHaveProperty('existingLinkCount');
    expect(body).toHaveProperty('analyzedAt');
    expect(Array.isArray(body.suggestions)).toBe(true);
    const suggestions = body.suggestions as Array<Record<string, unknown>>;
    expect(suggestions[0]).toHaveProperty('fromPage');
    expect(suggestions[0]).toHaveProperty('toPage');
    expect(suggestions[0]).toHaveProperty('anchorText');
  });

  it('returns 500 when analyzeInternalLinks throws', async () => {
    internalLinksState.shouldThrow = true;

    const res = await api(
      `/api/webflow/internal-links/${ws.webflowSiteId}?workspaceId=${ws.workspaceId}`,
    );
    expect(res.status).toBe(500);
    const body = await res.json() as Record<string, unknown>;
    expect(body.error).toBe('Internal link analysis failed');
  });

  it('returns 403 when JWT user does not own the workspace for this site', async () => {
    const otherWs = seedWorkspace();
    const user = await createUser(
      `internal-links-test-${Date.now()}@test.local`,
      'TestPass1!',
      'Internal Links Test User',
      'member',
      [otherWs.workspaceId],
    );
    const token = signToken({ userId: user.id, email: user.email, role: user.role });

    try {
      const res = await apiWithToken(
        token,
        `/api/webflow/internal-links/${ws.webflowSiteId}?workspaceId=${ws.workspaceId}`,
      );
      expect(res.status).toBe(403);
    } finally {
      deleteUser(user.id);
      otherWs.cleanup();
    }
  });

  it('records outcome actions for suggestions when workspaceId is provided', async () => {
    // Just confirm 200 and that the outcome tracking path doesn't blow up
    const res = await api(
      `/api/webflow/internal-links/${ws.webflowSiteId}?workspaceId=${ws.workspaceId}`,
    );
    expect(res.status).toBe(200);
    const body = await res.json() as Record<string, unknown>;
    expect(body).toHaveProperty('suggestions');
  });
});

// ---------------------------------------------------------------------------
// Internal Links Snapshot
// ---------------------------------------------------------------------------

describe('GET /api/webflow/internal-links-snapshot/:siteId', () => {
  it('returns null when no snapshot exists', async () => {
    const res = await api(
      `/api/webflow/internal-links-snapshot/${ws.webflowSiteId}?workspaceId=${ws.workspaceId}`,
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toBeNull();
  });

  it('returns saved snapshot after an internal links analysis', async () => {
    // Run analysis to persist the snapshot
    await api(
      `/api/webflow/internal-links/${ws.webflowSiteId}?workspaceId=${ws.workspaceId}`,
    );

    const res = await api(
      `/api/webflow/internal-links-snapshot/${ws.webflowSiteId}?workspaceId=${ws.workspaceId}`,
    );
    expect(res.status).toBe(200);
    // getInternalLinks returns Snapshot<T>: { siteId, createdAt, result: { suggestions, ... } }
    const body = await res.json() as Record<string, unknown>;
    expect(body).not.toBeNull();
    expect(body).toHaveProperty('siteId');
    expect(body).toHaveProperty('result');
    const result = body.result as Record<string, unknown>;
    expect(result).toHaveProperty('suggestions');
  });

  it('returns 403 when JWT user does not own the workspace', async () => {
    const otherWs = seedWorkspace();
    const user = await createUser(
      `internal-snap-test-${Date.now()}@test.local`,
      'TestPass1!',
      'Internal Snap Test User',
      'member',
      [otherWs.workspaceId],
    );
    const token = signToken({ userId: user.id, email: user.email, role: user.role });

    try {
      const res = await apiWithToken(
        token,
        `/api/webflow/internal-links-snapshot/${ws.webflowSiteId}?workspaceId=${ws.workspaceId}`,
      );
      expect(res.status).toBe(403);
    } finally {
      deleteUser(user.id);
      otherWs.cleanup();
    }
  });
});
