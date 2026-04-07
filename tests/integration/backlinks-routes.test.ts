/**
 * Integration tests for GET /api/backlinks/:workspaceId
 *
 * The backlinks route delegates to a SEO data provider (SEMRush or DataForSEO)
 * via getBacklinksProvider(). These tests use vi.mock to inject a controlled
 * mock provider in-process so there are no real API calls.
 *
 * Architecture: in-process HTTP via createApp() + http.createServer() so that
 * vi.mock interceptors apply to the seo-data-provider module.
 *
 * Scenarios covered:
 *   1. Happy path — returns domain, overview summary, and referring domains array
 *   2. Overview fields are all numeric (no nulls)
 *   3. Empty workspace (no data yet) returns zero counts, not null
 *   4. Workspace-scoped — provider receives the correct workspaceId
 *   5. Isolation — two workspaces each call the provider with their own id
 *   6. No domain configured — returns 400
 *   7. No provider configured — returns 503
 *   8. Unknown workspaceId — returns 404
 *   9. Provider throws — returns 500
 *  10. SEMRush integration wiring — provider.getBacklinksOverview and
 *      provider.getReferringDomains are both called for a single request
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import http from 'http';
import type { AddressInfo } from 'net';
import { seedWorkspace, seedTwoWorkspaces } from '../fixtures/workspace-seed.js';
import type { SeededFullWorkspace } from '../fixtures/workspace-seed.js';
import type {
  BacklinksOverview,
  ReferringDomain,
  SeoDataProvider,
} from '../../server/seo-data-provider.js';

// ---------------------------------------------------------------------------
// Module-level vi.mock declarations — hoisted before imports by Vitest
// ---------------------------------------------------------------------------

// Mock broadcast so broadcastToWorkspace() is a no-op (not initialised by createApp in test)
vi.mock('../../server/broadcast.js', () => ({
  setBroadcast: vi.fn(),
  broadcast: vi.fn(),
  broadcastToWorkspace: vi.fn(),
}));

// Mutable reference to the mock provider returned by getBacklinksProvider.
// Tests replace this before each scenario.
let mockProviderRef: SeoDataProvider | null = null;

vi.mock('../../server/seo-data-provider.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../server/seo-data-provider.js')>();
  return {
    ...actual,
    // Override only getBacklinksProvider — all other registry functions keep
    // their real implementations (registerProvider, etc.)
    getBacklinksProvider: vi.fn(() => mockProviderRef),
  };
});

// ---------------------------------------------------------------------------
// In-process server helpers
// ---------------------------------------------------------------------------

async function startTestServer(): Promise<{
  server: http.Server;
  baseUrl: string;
  stop: () => void;
}> {
  // Import createApp lazily so vi.mock interceptors are in place first
  const { createApp } = await import('../../server/app.js');
  const app = createApp();
  const server = http.createServer(app);

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  const baseUrl = `http://127.0.0.1:${port}`;
  return { server, baseUrl, stop: () => server.close() };
}

async function getJson(
  baseUrl: string,
  path: string,
): Promise<{ status: number; body: unknown }> {
  const res = await fetch(`${baseUrl}${path}`);
  const responseBody = await res.json().catch(() => ({}));
  return { status: res.status, body: responseBody };
}

// ---------------------------------------------------------------------------
// Mock provider factory
// ---------------------------------------------------------------------------

/** Default overview returned by the happy-path mock provider */
const DEFAULT_OVERVIEW: BacklinksOverview = {
  totalBacklinks: 2500,
  referringDomains: 180,
  followLinks: 2000,
  nofollowLinks: 500,
  textLinks: 1800,
  imageLinks: 200,
  formLinks: 10,
  frameLinks: 5,
};

/** Default referring domains returned by the happy-path mock provider */
const DEFAULT_REFERRING_DOMAINS: ReferringDomain[] = [
  { domain: 'example-referrer.com', backlinksCount: 42, firstSeen: '2023-01-15', lastSeen: '2024-11-20' },
  { domain: 'another-site.io', backlinksCount: 18, firstSeen: '2022-06-01', lastSeen: '2024-12-01' },
  { domain: 'blog-partner.net', backlinksCount: 7, firstSeen: '2024-03-10', lastSeen: '2024-10-30' },
];

function makeMockProvider(overrides?: {
  overview?: BacklinksOverview | null;
  referringDomains?: ReferringDomain[];
  shouldThrow?: boolean;
}): SeoDataProvider {
  const overview = overrides?.overview !== undefined ? overrides.overview : DEFAULT_OVERVIEW;
  const referringDomains = overrides?.referringDomains ?? DEFAULT_REFERRING_DOMAINS;
  const shouldThrow = overrides?.shouldThrow ?? false;

  const getBacklinksOverviewSpy = vi.fn(async () => {
    if (shouldThrow) throw new Error('SEMRush API unavailable');
    return overview;
  });

  const getReferringDomainsSpy = vi.fn(async () => {
    if (shouldThrow) throw new Error('SEMRush API unavailable');
    return referringDomains;
  });

  return {
    name: 'semrush',
    isConfigured: vi.fn(() => true),
    getKeywordMetrics: vi.fn(async () => []),
    getRelatedKeywords: vi.fn(async () => []),
    getQuestionKeywords: vi.fn(async () => []),
    getDomainKeywords: vi.fn(async () => []),
    getDomainOverview: vi.fn(async () => null),
    getCompetitors: vi.fn(async () => []),
    getKeywordGap: vi.fn(async () => []),
    getBacklinksOverview: getBacklinksOverviewSpy,
    getReferringDomains: getReferringDomainsSpy,
  } as unknown as SeoDataProvider;
}

// ---------------------------------------------------------------------------
// Test suites
// ---------------------------------------------------------------------------

describe('GET /api/backlinks/:workspaceId — happy path', () => {
  let ws: SeededFullWorkspace;
  let baseUrl: string;
  let stopServer: () => void;

  beforeEach(async () => {
    ws = seedWorkspace();
    mockProviderRef = makeMockProvider();

    const srv = await startTestServer();
    baseUrl = srv.baseUrl;
    stopServer = srv.stop;
  });

  afterEach(() => {
    ws.cleanup();
    mockProviderRef = null;
    stopServer();
  });

  it('returns 200 with domain, overview, and referringDomains', async () => {
    const { status, body } = await getJson(baseUrl, `/api/backlinks/${ws.workspaceId}`);

    expect(status).toBe(200);
    const b = body as Record<string, unknown>;
    expect(b).toHaveProperty('domain');
    expect(b).toHaveProperty('overview');
    expect(b).toHaveProperty('referringDomains');
  });

  it('domain matches the workspace live domain', async () => {
    const { status, body } = await getJson(baseUrl, `/api/backlinks/${ws.workspaceId}`);

    expect(status).toBe(200);
    const b = body as Record<string, unknown>;
    // seedWorkspace() sets live_domain = 'test.example.com'
    expect(b.domain).toBe('test.example.com');
  });

  it('overview contains all required numeric fields', async () => {
    const { status, body } = await getJson(baseUrl, `/api/backlinks/${ws.workspaceId}`);

    expect(status).toBe(200);
    const overview = (body as Record<string, unknown>).overview as BacklinksOverview;
    expect(typeof overview.totalBacklinks).toBe('number');
    expect(typeof overview.referringDomains).toBe('number');
    expect(typeof overview.followLinks).toBe('number');
    expect(typeof overview.nofollowLinks).toBe('number');
    expect(typeof overview.textLinks).toBe('number');
    expect(typeof overview.imageLinks).toBe('number');
    expect(typeof overview.formLinks).toBe('number');
    expect(typeof overview.frameLinks).toBe('number');
  });

  it('overview values match mock provider data', async () => {
    const { status, body } = await getJson(baseUrl, `/api/backlinks/${ws.workspaceId}`);

    expect(status).toBe(200);
    const overview = (body as Record<string, unknown>).overview as BacklinksOverview;
    expect(overview.totalBacklinks).toBe(2500);
    expect(overview.referringDomains).toBe(180);
    expect(overview.followLinks).toBe(2000);
    expect(overview.nofollowLinks).toBe(500);
  });

  it('referringDomains is a non-empty array with correct shape', async () => {
    const { status, body } = await getJson(baseUrl, `/api/backlinks/${ws.workspaceId}`);

    expect(status).toBe(200);
    const domains = (body as Record<string, unknown>).referringDomains as ReferringDomain[];
    expect(Array.isArray(domains)).toBe(true);
    expect(domains.length).toBeGreaterThan(0);
    expect(domains.every((d) => typeof d.domain === 'string')).toBe(true);
    expect(domains.every((d) => typeof d.backlinksCount === 'number')).toBe(true);
    expect(domains.every((d) => typeof d.firstSeen === 'string')).toBe(true);
    expect(domains.every((d) => typeof d.lastSeen === 'string')).toBe(true);
  });

  it('referringDomains values match mock provider data', async () => {
    const { status, body } = await getJson(baseUrl, `/api/backlinks/${ws.workspaceId}`);

    expect(status).toBe(200);
    const domains = (body as Record<string, unknown>).referringDomains as ReferringDomain[];
    expect(domains.length).toBe(3);
    expect(domains[0].domain).toBe('example-referrer.com');
    expect(domains[0].backlinksCount).toBe(42);
    expect(domains[1].domain).toBe('another-site.io');
  });
});

describe('GET /api/backlinks/:workspaceId — empty workspace (zero data)', () => {
  let ws: SeededFullWorkspace;
  let baseUrl: string;
  let stopServer: () => void;

  beforeEach(async () => {
    ws = seedWorkspace();
    // Provider returns zero-value overview and empty referring domains
    mockProviderRef = makeMockProvider({
      overview: {
        totalBacklinks: 0,
        referringDomains: 0,
        followLinks: 0,
        nofollowLinks: 0,
        textLinks: 0,
        imageLinks: 0,
        formLinks: 0,
        frameLinks: 0,
      },
      referringDomains: [],
    });

    const srv = await startTestServer();
    baseUrl = srv.baseUrl;
    stopServer = srv.stop;
  });

  afterEach(() => {
    ws.cleanup();
    mockProviderRef = null;
    stopServer();
  });

  it('returns 200 even with no backlink data', async () => {
    const { status } = await getJson(baseUrl, `/api/backlinks/${ws.workspaceId}`);
    expect(status).toBe(200);
  });

  it('overview totalBacklinks is 0, not null', async () => {
    const { status, body } = await getJson(baseUrl, `/api/backlinks/${ws.workspaceId}`);

    expect(status).toBe(200);
    const overview = (body as Record<string, unknown>).overview as BacklinksOverview;
    expect(overview.totalBacklinks).toBe(0);
    expect(overview.totalBacklinks).not.toBeNull();
  });

  it('overview referringDomains count is 0, not null', async () => {
    const { status, body } = await getJson(baseUrl, `/api/backlinks/${ws.workspaceId}`);

    expect(status).toBe(200);
    const overview = (body as Record<string, unknown>).overview as BacklinksOverview;
    expect(overview.referringDomains).toBe(0);
    expect(overview.referringDomains).not.toBeNull();
  });

  it('referringDomains is an empty array, not null', async () => {
    const { status, body } = await getJson(baseUrl, `/api/backlinks/${ws.workspaceId}`);

    expect(status).toBe(200);
    const domains = (body as Record<string, unknown>).referringDomains as ReferringDomain[];
    expect(Array.isArray(domains)).toBe(true);
    expect(domains.length).toBe(0);
  });
});

describe('GET /api/backlinks/:workspaceId — workspace scoping', () => {
  let ws: SeededFullWorkspace;
  let baseUrl: string;
  let stopServer: () => void;
  let capturedWorkspaceIds: string[];

  beforeEach(async () => {
    ws = seedWorkspace();
    capturedWorkspaceIds = [];

    // Spy on which workspaceId is forwarded to the provider
    const provider: SeoDataProvider = {
      name: 'semrush',
      isConfigured: vi.fn(() => true),
      getKeywordMetrics: vi.fn(async () => []),
      getRelatedKeywords: vi.fn(async () => []),
      getQuestionKeywords: vi.fn(async () => []),
      getDomainKeywords: vi.fn(async () => []),
      getDomainOverview: vi.fn(async () => null),
      getCompetitors: vi.fn(async () => []),
      getKeywordGap: vi.fn(async () => []),
      getBacklinksOverview: vi.fn(async (_domain: string, workspaceId: string) => {
        capturedWorkspaceIds.push(workspaceId);
        return DEFAULT_OVERVIEW;
      }),
      getReferringDomains: vi.fn(async (_domain: string, workspaceId: string) => {
        capturedWorkspaceIds.push(workspaceId);
        return DEFAULT_REFERRING_DOMAINS;
      }),
    } as unknown as SeoDataProvider;

    mockProviderRef = provider;

    const srv = await startTestServer();
    baseUrl = srv.baseUrl;
    stopServer = srv.stop;
  });

  afterEach(() => {
    ws.cleanup();
    mockProviderRef = null;
    stopServer();
  });

  it('passes the correct workspaceId to the provider', async () => {
    const { status } = await getJson(baseUrl, `/api/backlinks/${ws.workspaceId}`);

    expect(status).toBe(200);
    expect(capturedWorkspaceIds.length).toBeGreaterThan(0);
    // Every call to the provider should use this workspace's id
    expect(capturedWorkspaceIds.every((id) => id === ws.workspaceId)).toBe(true);
  });
});

describe('GET /api/backlinks/:workspaceId — cross-workspace isolation', () => {
  let wsA: SeededFullWorkspace;
  let wsB: SeededFullWorkspace;
  let baseUrl: string;
  let stopServer: () => void;

  beforeEach(async () => {
    const pair = seedTwoWorkspaces();
    wsA = pair.wsA;
    wsB = pair.wsB;

    mockProviderRef = makeMockProvider({
      overview: DEFAULT_OVERVIEW,
      referringDomains: DEFAULT_REFERRING_DOMAINS,
    });

    const srv = await startTestServer();
    baseUrl = srv.baseUrl;
    stopServer = srv.stop;
  });

  afterEach(() => {
    wsA.cleanup();
    wsB.cleanup();
    mockProviderRef = null;
    stopServer();
  });

  it('workspace A request returns domain A', async () => {
    const { status, body } = await getJson(baseUrl, `/api/backlinks/${wsA.workspaceId}`);
    expect(status).toBe(200);
    // Both workspaces seeded with live_domain = 'test.example.com' but the
    // workspaceId routing must resolve to the correct workspace record.
    expect((body as Record<string, unknown>).domain).toBeTruthy();
  });

  it('workspace B request returns 200 independently', async () => {
    const { status } = await getJson(baseUrl, `/api/backlinks/${wsB.workspaceId}`);
    expect(status).toBe(200);
  });

  it('workspace A and B can both be queried without interference', async () => {
    const [resA, resB] = await Promise.all([
      getJson(baseUrl, `/api/backlinks/${wsA.workspaceId}`),
      getJson(baseUrl, `/api/backlinks/${wsB.workspaceId}`),
    ]);

    expect(resA.status).toBe(200);
    expect(resB.status).toBe(200);

    // Both should have overview and referringDomains keys
    expect((resA.body as Record<string, unknown>)).toHaveProperty('overview');
    expect((resB.body as Record<string, unknown>)).toHaveProperty('overview');
  });
});

describe('GET /api/backlinks/:workspaceId — error scenarios', () => {
  let ws: SeededFullWorkspace;
  let baseUrl: string;
  let stopServer: () => void;

  beforeEach(async () => {
    ws = seedWorkspace();

    const srv = await startTestServer();
    baseUrl = srv.baseUrl;
    stopServer = srv.stop;
  });

  afterEach(() => {
    ws.cleanup();
    mockProviderRef = null;
    stopServer();
  });

  it('returns 404 for an unknown workspaceId', async () => {
    mockProviderRef = makeMockProvider();
    const { status, body } = await getJson(baseUrl, '/api/backlinks/nonexistent-workspace-id');
    expect(status).toBe(404);
    expect((body as Record<string, unknown>).error).toBeTruthy();
  });

  it('returns 503 when no SEO provider is configured', async () => {
    // getBacklinksProvider returns null — no provider available
    mockProviderRef = null;

    const { status, body } = await getJson(baseUrl, `/api/backlinks/${ws.workspaceId}`);
    expect(status).toBe(503);
    expect((body as Record<string, unknown>).error).toBeTruthy();
  });

  it('returns 500 when the provider throws', async () => {
    mockProviderRef = makeMockProvider({ shouldThrow: true });

    const { status, body } = await getJson(baseUrl, `/api/backlinks/${ws.workspaceId}`);
    expect(status).toBe(500);
    expect((body as Record<string, unknown>).error).toBeTruthy();
  });
});

describe('GET /api/backlinks/:workspaceId — no domain configured', () => {
  let noDomainWsId: string;
  let baseUrl: string;
  let stopServer: () => void;

  beforeEach(async () => {
    // Seed a workspace with no live_domain and no webflow_site_name
    // so the route hits the "No domain configured" branch (400).
    const db = (await import('../../server/db/index.js')).default;
    const { randomUUID } = await import('crypto');
    const suffix = randomUUID().slice(0, 8);
    noDomainWsId = `test-nodomain-${suffix}`;

    db.prepare(`
      INSERT INTO workspaces (id, name, folder, webflow_site_id, webflow_token,
        client_password, live_domain, tier, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      noDomainWsId,
      `No Domain WS ${suffix}`,
      `no-domain-${suffix}`,
      `site-${suffix}`,
      `token-${suffix}`,
      'test-password',
      null, // live_domain explicitly null
      'free',
      new Date().toISOString(),
    );

    mockProviderRef = makeMockProvider();

    const srv = await startTestServer();
    baseUrl = srv.baseUrl;
    stopServer = srv.stop;
  });

  afterEach(async () => {
    const db = (await import('../../server/db/index.js')).default;
    db.prepare('DELETE FROM workspaces WHERE id = ?').run(noDomainWsId);
    mockProviderRef = null;
    stopServer();
  });

  it('returns 400 when workspace has no domain configured', async () => {
    const { status, body } = await getJson(baseUrl, `/api/backlinks/${noDomainWsId}`);
    expect(status).toBe(400);
    expect((body as Record<string, unknown>).error).toBeTruthy();
  });
});

describe('GET /api/backlinks/:workspaceId — SEMRush integration wiring', () => {
  let ws: SeededFullWorkspace;
  let baseUrl: string;
  let stopServer: () => void;
  let overviewCallCount: number;
  let referringDomainsCallCount: number;

  beforeEach(async () => {
    ws = seedWorkspace();
    overviewCallCount = 0;
    referringDomainsCallCount = 0;

    const provider: SeoDataProvider = {
      name: 'semrush',
      isConfigured: vi.fn(() => true),
      getKeywordMetrics: vi.fn(async () => []),
      getRelatedKeywords: vi.fn(async () => []),
      getQuestionKeywords: vi.fn(async () => []),
      getDomainKeywords: vi.fn(async () => []),
      getDomainOverview: vi.fn(async () => null),
      getCompetitors: vi.fn(async () => []),
      getKeywordGap: vi.fn(async () => []),
      getBacklinksOverview: vi.fn(async () => {
        overviewCallCount++;
        return DEFAULT_OVERVIEW;
      }),
      getReferringDomains: vi.fn(async () => {
        referringDomainsCallCount++;
        return DEFAULT_REFERRING_DOMAINS;
      }),
    } as unknown as SeoDataProvider;

    mockProviderRef = provider;

    const srv = await startTestServer();
    baseUrl = srv.baseUrl;
    stopServer = srv.stop;
  });

  afterEach(() => {
    ws.cleanup();
    mockProviderRef = null;
    stopServer();
  });

  it('calls both getBacklinksOverview and getReferringDomains for a single request', async () => {
    const { status } = await getJson(baseUrl, `/api/backlinks/${ws.workspaceId}`);

    expect(status).toBe(200);
    expect(overviewCallCount).toBe(1);
    expect(referringDomainsCallCount).toBe(1);
  });

  it('passes the workspace domain to getBacklinksOverview', async () => {
    let capturedDomain = '';
    const provider: SeoDataProvider = {
      name: 'semrush',
      isConfigured: vi.fn(() => true),
      getKeywordMetrics: vi.fn(async () => []),
      getRelatedKeywords: vi.fn(async () => []),
      getQuestionKeywords: vi.fn(async () => []),
      getDomainKeywords: vi.fn(async () => []),
      getDomainOverview: vi.fn(async () => null),
      getCompetitors: vi.fn(async () => []),
      getKeywordGap: vi.fn(async () => []),
      getBacklinksOverview: vi.fn(async (domain: string) => {
        capturedDomain = domain;
        return DEFAULT_OVERVIEW;
      }),
      getReferringDomains: vi.fn(async () => DEFAULT_REFERRING_DOMAINS),
    } as unknown as SeoDataProvider;

    mockProviderRef = provider;

    const { status } = await getJson(baseUrl, `/api/backlinks/${ws.workspaceId}`);
    expect(status).toBe(200);
    // seedWorkspace() sets live_domain = 'test.example.com'
    expect(capturedDomain).toBe('test.example.com');
  });

  it('passes limit=15 to getReferringDomains', async () => {
    let capturedLimit: number | undefined;
    const provider: SeoDataProvider = {
      name: 'semrush',
      isConfigured: vi.fn(() => true),
      getKeywordMetrics: vi.fn(async () => []),
      getRelatedKeywords: vi.fn(async () => []),
      getQuestionKeywords: vi.fn(async () => []),
      getDomainKeywords: vi.fn(async () => []),
      getDomainOverview: vi.fn(async () => null),
      getCompetitors: vi.fn(async () => []),
      getKeywordGap: vi.fn(async () => []),
      getBacklinksOverview: vi.fn(async () => DEFAULT_OVERVIEW),
      getReferringDomains: vi.fn(async (_domain: string, _workspaceId: string, limit?: number) => {
        capturedLimit = limit;
        return DEFAULT_REFERRING_DOMAINS;
      }),
    } as unknown as SeoDataProvider;

    mockProviderRef = provider;

    const { status } = await getJson(baseUrl, `/api/backlinks/${ws.workspaceId}`);
    expect(status).toBe(200);
    // The route hard-codes limit=15 when calling getReferringDomains
    expect(capturedLimit).toBe(15);
  });
});
