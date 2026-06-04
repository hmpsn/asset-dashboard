/**
 * Integration tests: competitor monitoring lifecycle
 * port-ok: unique in integration suite
 *
 * Covers the full lifecycle of competitor domain management and competitive
 * intelligence via:
 *   POST   /api/seo/competitors/:workspaceId  — save competitor domains
 *   GET    /api/seo/competitive-intel/:workspaceId — get comparison data
 *   GET    /api/seo/discover-competitors/:workspaceId — auto-discover
 *   GET    /api/seo/diagnose/:workspaceId — diagnostic (domain + cache state)
 *
 * Architecture: single in-process HTTP server for the file (createApp + http.createServer)
 * so vi.mock interceptors apply to seo-data-provider. Workspaces seeded/cleaned per-suite
 * via seedWorkspace()/cleanup() from tests/fixtures/workspace-seed.ts.
 *
 * Scenarios covered:
 *   Section 1: Save competitors — valid domains stored, returned in state (3 tests)
 *   Section 2: Duplicate/idempotent save — same domains → deduplication (2 tests)
 *   Section 3: Remove/replace competitors — POST with empty/new list (3 tests)
 *   Section 4: List competitors — GET diagnose returns stored domains (3 tests)
 *   Section 5: Cross-workspace isolation — workspace A domains not in B response (3 tests)
 *   Section 6: Competitive-intel endpoint — returns comparison data (4 tests)
 *   Section 7: No domain configured — 400 on save and intel (2 tests)
 *   Section 8: Max competitors limit — >5 domains capped to MAX_COMPETITORS (2 tests)
 *   Section 9: Domain format validation — invalid domains filtered or rejected (3 tests)
 *   Section 10: Unknown workspace — 404 (2 tests)
 *   Section 11: Provider not configured — 503 on intel endpoint (2 tests)
 *   Section 12: Provider returns empty data — graceful empty result (3 tests)
 */

import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import http from 'http';
import type { AddressInfo } from 'net';
import { seedWorkspace, seedTwoWorkspaces } from '../fixtures/workspace-seed.js';
import type { SeededFullWorkspace } from '../fixtures/workspace-seed.js';
import type {
  SeoDataProvider,
  DomainOverview,
  OrganicCompetitor,
  KeywordGapEntry,
  DomainKeyword,
} from '../../server/seo-data-provider.js';

// ---------------------------------------------------------------------------
// Module-level vi.mock declarations — hoisted before imports by Vitest
// ---------------------------------------------------------------------------

const broadcastState = vi.hoisted(() => ({
  calls: [] as Array<{ workspaceId: string; event: string; payload: unknown }>,
}));

vi.mock('../../server/broadcast.js', () => ({
  setBroadcast: vi.fn(),
  broadcast: vi.fn(),
  broadcastToWorkspace: vi.fn((wsId: string, event: string, payload: unknown) => {
    broadcastState.calls.push({ workspaceId: wsId, event, payload });
  }),
}));

// Mutable reference so tests can swap provider implementations per-suite
let mockProviderRef: SeoDataProvider | null = null;

vi.mock('../../server/seo-data-provider.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../server/seo-data-provider.js')>();
  return {
    ...actual,
    getConfiguredProvider: vi.fn(() => mockProviderRef),
    getBacklinksProvider: vi.fn(() => null),
  };
});

// ---------------------------------------------------------------------------
// In-process server — single shared instance for the whole file
// ---------------------------------------------------------------------------

let baseUrl = '';
let server: http.Server | undefined;

async function startSharedServer(): Promise<void> {
  if (server) return;
  delete process.env.APP_PASSWORD;
  const { createApp } = await import('../../server/app.js');
  const app = createApp();
  server = http.createServer(app);
  await new Promise<void>((resolve) => server!.listen(0, '127.0.0.1', resolve));
  const { port } = server!.address() as AddressInfo;
  baseUrl = `http://127.0.0.1:${port}`;
}

async function stopSharedServer(): Promise<void> {
  if (!server) return;
  await new Promise<void>((resolve) => server!.close(() => resolve()));
  server = undefined;
  baseUrl = '';
}

// Start/stop the shared server once for the whole file
beforeAll(async () => {
  await startSharedServer();
}, 60_000);

afterAll(async () => {
  await stopSharedServer();
});

// ---------------------------------------------------------------------------
// HTTP helpers
// ---------------------------------------------------------------------------

async function getJson(
  path: string,
): Promise<{ status: number; body: unknown }> {
  const res = await fetch(`${baseUrl}${path}`);
  const responseBody = await res.json().catch(() => ({}));
  return { status: res.status, body: responseBody };
}

async function postJson(
  path: string,
  payload: unknown,
): Promise<{ status: number; body: unknown }> {
  const res = await fetch(`${baseUrl}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  const responseBody = await res.json().catch(() => ({}));
  return { status: res.status, body: responseBody };
}

// ---------------------------------------------------------------------------
// Mock provider factory
// ---------------------------------------------------------------------------

const DEFAULT_OVERVIEW: DomainOverview = {
  domain: 'competitor.com',
  organicKeywords: 1500,
  organicTraffic: 8000,
  organicCost: 4500,
  paidKeywords: 50,
  paidTraffic: 200,
  paidCost: 300,
};

const DEFAULT_COMPETITORS: OrganicCompetitor[] = [
  {
    domain: 'rival-a.com',
    competitorRelevance: 0.85,
    commonKeywords: 120,
    organicKeywords: 1800,
    organicTraffic: 9000,
    organicCost: 5000,
  },
  {
    domain: 'rival-b.io',
    competitorRelevance: 0.70,
    commonKeywords: 80,
    organicKeywords: 1200,
    organicTraffic: 6000,
    organicCost: 3000,
  },
];

const DEFAULT_KEYWORD_GAP: KeywordGapEntry[] = [
  {
    keyword: 'seo audit tool',
    volume: 2400,
    difficulty: 62,
    competitorPosition: 3,
    competitorDomain: 'competitor.com',
  },
  {
    keyword: 'on-page seo checker',
    volume: 1800,
    difficulty: 55,
    competitorPosition: 5,
    competitorDomain: 'competitor.com',
  },
];

const DEFAULT_DOMAIN_KEYWORDS: DomainKeyword[] = [
  {
    keyword: 'seo tools',
    position: 4,
    volume: 5000,
    difficulty: 70,
    cpc: 3.5,
    url: 'https://competitor.com/tools',
    traffic: 800,
    trafficPercent: 10,
  },
];

function makeMockProvider(overrides?: {
  overview?: DomainOverview | null;
  competitors?: OrganicCompetitor[];
  keywordGap?: KeywordGapEntry[];
  domainKeywords?: DomainKeyword[];
  shouldThrow?: boolean;
}): SeoDataProvider {
  const overview = overrides?.overview !== undefined ? overrides.overview : DEFAULT_OVERVIEW;
  const competitors = overrides?.competitors ?? DEFAULT_COMPETITORS;
  const keywordGap = overrides?.keywordGap ?? DEFAULT_KEYWORD_GAP;
  const domainKeywords = overrides?.domainKeywords ?? DEFAULT_DOMAIN_KEYWORDS;
  const shouldThrow = overrides?.shouldThrow ?? false;

  return {
    name: 'semrush',
    isConfigured: vi.fn(() => true),
    getKeywordMetrics: vi.fn(async () => {
      if (shouldThrow) throw new Error('Provider unavailable');
      return [];
    }),
    getRelatedKeywords: vi.fn(async () => []),
    getQuestionKeywords: vi.fn(async () => []),
    getDomainKeywords: vi.fn(async () => {
      if (shouldThrow) throw new Error('Provider unavailable');
      return domainKeywords;
    }),
    getDomainOverview: vi.fn(async () => {
      if (shouldThrow) throw new Error('Provider unavailable');
      return overview;
    }),
    getCompetitors: vi.fn(async () => {
      if (shouldThrow) throw new Error('Provider unavailable');
      return competitors;
    }),
    getKeywordGap: vi.fn(async () => {
      if (shouldThrow) throw new Error('Provider unavailable');
      return keywordGap;
    }),
    getBacklinksOverview: vi.fn(async () => null),
    getReferringDomains: vi.fn(async () => []),
  } as unknown as SeoDataProvider;
}

// ---------------------------------------------------------------------------
// Section 1: Save competitors — valid domains stored and returned
// ---------------------------------------------------------------------------

describe('POST /api/seo/competitors/:workspaceId — valid domains stored', () => {
  let ws: SeededFullWorkspace;

  beforeAll(() => {
    ws = seedWorkspace();
    mockProviderRef = makeMockProvider();
    broadcastState.calls.length = 0;
  });

  afterAll(() => {
    ws.cleanup();
    mockProviderRef = null;
  });

  it('returns 200 with the cleaned domain list', async () => {
    const { status, body } = await postJson(
      `/api/seo/competitors/${ws.workspaceId}`,
      { domains: ['competitor.com', 'rival.io'] },
    );
    expect(status).toBe(200);
    const b = body as Record<string, unknown>;
    expect(Array.isArray(b.competitors)).toBe(true);
  });

  it('saved domains appear in the diagnose response', async () => {
    await postJson(
      `/api/seo/competitors/${ws.workspaceId}`,
      { domains: ['acme-seo.com'] },
    );
    const { status, body } = await getJson(
      `/api/seo/diagnose/${ws.workspaceId}`,
    );
    expect(status).toBe(200);
    const b = body as { competitors: string[] };
    expect(b.competitors.length).toBeGreaterThan(0);
    expect(b.competitors.some((d) => d.includes('acme-seo'))).toBe(true);
  });

  it('accepts the legacy "competitors" body key as an alias for "domains"', async () => {
    const { status, body } = await postJson(
      `/api/seo/competitors/${ws.workspaceId}`,
      { competitors: ['legacy-alias.com'] },
    );
    expect(status).toBe(200);
    const b = body as Record<string, unknown>;
    expect(Array.isArray(b.competitors)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Section 2: Duplicate/idempotent save
// ---------------------------------------------------------------------------

describe('POST /api/seo/competitors/:workspaceId — deduplication', () => {
  let ws: SeededFullWorkspace;

  beforeAll(() => {
    ws = seedWorkspace();
    mockProviderRef = makeMockProvider();
    broadcastState.calls.length = 0;
  });

  afterAll(() => {
    ws.cleanup();
    mockProviderRef = null;
  });

  it('deduplicates repeated domains in a single payload', async () => {
    const { status, body } = await postJson(
      `/api/seo/competitors/${ws.workspaceId}`,
      { domains: ['dup.com', 'dup.com', 'unique.com'] },
    );
    expect(status).toBe(200);
    const b = body as { competitors: string[] };
    expect(Array.isArray(b.competitors)).toBe(true);
    const dupCount = b.competitors.filter((d) => d === 'dup.com').length;
    expect(dupCount).toBe(1);
  });

  it('saving the same domain twice across two requests results in a single entry', async () => {
    await postJson(
      `/api/seo/competitors/${ws.workspaceId}`,
      { domains: ['stable.com'] },
    );
    const { body: secondBody } = await postJson(
      `/api/seo/competitors/${ws.workspaceId}`,
      { domains: ['stable.com'] },
    );
    const b = secondBody as { competitors: string[] };
    expect(Array.isArray(b.competitors)).toBe(true);
    const count = b.competitors.filter((d) => d.includes('stable')).length;
    expect(count).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// Section 3: Remove/replace competitors
// ---------------------------------------------------------------------------

describe('POST /api/seo/competitors/:workspaceId — replace/clear list', () => {
  let ws: SeededFullWorkspace;

  beforeAll(() => {
    ws = seedWorkspace();
    mockProviderRef = makeMockProvider();
    broadcastState.calls.length = 0;
  });

  afterAll(() => {
    ws.cleanup();
    mockProviderRef = null;
  });

  it('replaces existing domains when a new list is POSTed', async () => {
    await postJson(
      `/api/seo/competitors/${ws.workspaceId}`,
      { domains: ['old-rival.com'] },
    );
    const { status, body } = await postJson(
      `/api/seo/competitors/${ws.workspaceId}`,
      { domains: ['new-rival.com'] },
    );
    expect(status).toBe(200);
    const b = body as { competitors: string[] };
    // old-rival should no longer appear
    expect(b.competitors.some((d) => d.includes('old-rival'))).toBe(false);
    expect(b.competitors.some((d) => d.includes('new-rival'))).toBe(true);
  });

  it('POSTing an empty array clears the competitor list', async () => {
    await postJson(
      `/api/seo/competitors/${ws.workspaceId}`,
      { domains: ['to-remove.com'] },
    );
    const { status, body } = await postJson(
      `/api/seo/competitors/${ws.workspaceId}`,
      { domains: [] },
    );
    expect(status).toBe(200);
    const b = body as { competitors: string[] };
    expect(Array.isArray(b.competitors)).toBe(true);
    expect(b.competitors).toHaveLength(0);
  });

  it('returns 400 when body is missing domains and competitors keys', async () => {
    const { status } = await postJson(
      `/api/seo/competitors/${ws.workspaceId}`,
      { unrelated: 'field' },
    );
    expect(status).toBe(400);
  });
});

// ---------------------------------------------------------------------------
// Section 4: List competitors via diagnose endpoint
// ---------------------------------------------------------------------------

describe('GET /api/seo/diagnose/:workspaceId — competitor list state', () => {
  let ws: SeededFullWorkspace;

  beforeAll(() => {
    ws = seedWorkspace();
    mockProviderRef = makeMockProvider();
    broadcastState.calls.length = 0;
  });

  afterAll(() => {
    ws.cleanup();
    mockProviderRef = null;
  });

  it('returns 200 with a competitors array', async () => {
    const { status, body } = await getJson(
      `/api/seo/diagnose/${ws.workspaceId}`,
    );
    expect(status).toBe(200);
    expect(Array.isArray((body as Record<string, unknown>).competitors)).toBe(true);
  });

  it('fresh workspace has an empty competitors array', async () => {
    const { status, body } = await getJson(
      `/api/seo/diagnose/${ws.workspaceId}`,
    );
    expect(status).toBe(200);
    const b = body as { competitors: string[] };
    expect(b.competitors).toHaveLength(0);
  });

  it('stored domains are reflected in the diagnose response', async () => {
    await postJson(
      `/api/seo/competitors/${ws.workspaceId}`,
      { domains: ['diagnose-test.com'] },
    );
    const { status, body } = await getJson(
      `/api/seo/diagnose/${ws.workspaceId}`,
    );
    expect(status).toBe(200);
    const b = body as { competitors: string[] };
    expect(b.competitors.length).toBeGreaterThan(0);
    expect(b.competitors.some((d) => d.includes('diagnose-test'))).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Section 5: Cross-workspace isolation
// ---------------------------------------------------------------------------

describe('Cross-workspace isolation — competitor domains', () => {
  let wsA: SeededFullWorkspace;
  let wsB: SeededFullWorkspace;

  beforeAll(() => {
    const pair = seedTwoWorkspaces();
    wsA = pair.wsA;
    wsB = pair.wsB;
    mockProviderRef = makeMockProvider();
    broadcastState.calls.length = 0;
  });

  afterAll(() => {
    wsA.cleanup();
    wsB.cleanup();
    mockProviderRef = null;
  });

  it('domains saved to workspace A do not appear in workspace B diagnose', async () => {
    await postJson(
      `/api/seo/competitors/${wsA.workspaceId}`,
      { domains: ['wsa-only.com'] },
    );
    const { body } = await getJson(
      `/api/seo/diagnose/${wsB.workspaceId}`,
    );
    const b = body as { competitors: string[] };
    expect(Array.isArray(b.competitors)).toBe(true);
    expect(b.competitors.some((d) => d.includes('wsa-only'))).toBe(false);
  });

  it('workspace B can have its own independent competitor list', async () => {
    await postJson(
      `/api/seo/competitors/${wsB.workspaceId}`,
      { domains: ['wsb-only.com'] },
    );
    const { body } = await getJson(
      `/api/seo/diagnose/${wsB.workspaceId}`,
    );
    const b = body as { competitors: string[] };
    expect(b.competitors.some((d) => d.includes('wsb-only'))).toBe(true);
  });

  it('saving to workspace A does not overwrite workspace B competitor list', async () => {
    await postJson(
      `/api/seo/competitors/${wsB.workspaceId}`,
      { domains: ['wsb-stable.com'] },
    );
    await postJson(
      `/api/seo/competitors/${wsA.workspaceId}`,
      { domains: ['wsa-write.com'] },
    );
    const { body } = await getJson(
      `/api/seo/diagnose/${wsB.workspaceId}`,
    );
    const b = body as { competitors: string[] };
    expect(b.competitors.some((d) => d.includes('wsb-stable'))).toBe(true);
    expect(b.competitors.some((d) => d.includes('wsa-write'))).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Section 6: Competitive-intel endpoint
// ---------------------------------------------------------------------------

describe('GET /api/seo/competitive-intel/:workspaceId — comparison data', () => {
  let ws: SeededFullWorkspace;

  beforeAll(() => {
    ws = seedWorkspace();
    mockProviderRef = makeMockProvider();
    broadcastState.calls.length = 0;
  });

  afterAll(() => {
    ws.cleanup();
    mockProviderRef = null;
  });

  it('returns 200 with domains, keywordGaps, and fetchedAt', async () => {
    const { status, body } = await getJson(
      `/api/seo/competitive-intel/${ws.workspaceId}?competitors=competitor.com`,
    );
    expect(status).toBe(200);
    const b = body as Record<string, unknown>;
    expect(b).toHaveProperty('domains');
    expect(b).toHaveProperty('keywordGaps');
    expect(b).toHaveProperty('fetchedAt');
  });

  it('domains array includes own site entry (isOwn: true)', async () => {
    const { status, body } = await getJson(
      `/api/seo/competitive-intel/${ws.workspaceId}?competitors=competitor.com`,
    );
    expect(status).toBe(200);
    const b = body as { domains: Array<{ isOwn: boolean }> };
    expect(Array.isArray(b.domains)).toBe(true);
    expect(b.domains.length).toBeGreaterThan(0);
    expect(b.domains.some((d) => d.isOwn === true)).toBe(true);
  });

  it('keywordGaps is an array (may be empty or populated)', async () => {
    const { status, body } = await getJson(
      `/api/seo/competitive-intel/${ws.workspaceId}?competitors=competitor.com`,
    );
    expect(status).toBe(200);
    expect(Array.isArray((body as Record<string, unknown>).keywordGaps)).toBe(true);
  });

  it('returns 400 when no competitors query param is provided', async () => {
    const { status } = await getJson(
      `/api/seo/competitive-intel/${ws.workspaceId}`,
    );
    expect(status).toBe(400);
  });
});

// ---------------------------------------------------------------------------
// Section 7: No domain configured
// ---------------------------------------------------------------------------

describe('No live domain configured', () => {
  let noDomainWsId: string;

  beforeAll(async () => {
    mockProviderRef = makeMockProvider();
    broadcastState.calls.length = 0;

    const { default: db } = await import('../../server/db/index.js');
    const { randomUUID } = await import('crypto');
    const suffix = randomUUID().slice(0, 8);
    noDomainWsId = `test-nodomain-competitor-${suffix}`;

    db.prepare(`
      INSERT INTO workspaces (id, name, folder, webflow_site_id, webflow_token,
        client_password, live_domain, tier, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      noDomainWsId,
      `No Domain Competitor WS ${suffix}`,
      `no-domain-competitor-${suffix}`,
      `site-${suffix}`,
      `token-${suffix}`,
      'test-password',
      null,
      'free',
      new Date().toISOString(),
    );
  });

  afterAll(async () => {
    const { default: db } = await import('../../server/db/index.js');
    db.prepare('DELETE FROM workspaces WHERE id = ?').run(noDomainWsId);
    mockProviderRef = null;
  });

  it('competitive-intel returns 400 when workspace has no live domain', async () => {
    const { status } = await getJson(
      `/api/seo/competitive-intel/${noDomainWsId}?competitors=rival.com`,
    );
    expect(status).toBe(400);
  });

  it('discover-competitors returns 400 when workspace has no live domain', async () => {
    const { status } = await getJson(
      `/api/seo/discover-competitors/${noDomainWsId}`,
    );
    expect(status).toBe(400);
  });
});

// ---------------------------------------------------------------------------
// Section 8: Max competitors limit
// ---------------------------------------------------------------------------

describe('POST /api/seo/competitors/:workspaceId — MAX_COMPETITORS cap', () => {
  let ws: SeededFullWorkspace;

  beforeAll(() => {
    ws = seedWorkspace();
    mockProviderRef = makeMockProvider();
    broadcastState.calls.length = 0;
  });

  afterAll(() => {
    ws.cleanup();
    mockProviderRef = null;
  });

  it('result is capped to MAX_COMPETITORS (5) when more are provided', async () => {
    const tooMany = [
      'a.com', 'b.com', 'c.com', 'd.com', 'e.com', 'f.com',
    ];
    const { status, body } = await postJson(
      `/api/seo/competitors/${ws.workspaceId}`,
      { domains: tooMany },
    );
    expect(status).toBe(200);
    const b = body as { competitors: string[] };
    expect(Array.isArray(b.competitors)).toBe(true);
    expect(b.competitors.length).toBeLessThanOrEqual(5);
  });

  it('competitive-intel returns 400 when competitors param exceeds MAX_COMPETITORS', async () => {
    const tooManyParam = 'a.com,b.com,c.com,d.com,e.com,f.com';
    const { status } = await getJson(
      `/api/seo/competitive-intel/${ws.workspaceId}?competitors=${tooManyParam}`,
    );
    expect(status).toBe(400);
  });
});

// ---------------------------------------------------------------------------
// Section 9: Domain format validation
// ---------------------------------------------------------------------------

describe('POST /api/seo/competitors/:workspaceId — invalid domain filtering', () => {
  let ws: SeededFullWorkspace;

  beforeAll(() => {
    ws = seedWorkspace();
    mockProviderRef = makeMockProvider();
    broadcastState.calls.length = 0;
  });

  afterAll(() => {
    ws.cleanup();
    mockProviderRef = null;
  });

  it('strips http/https protocol prefix before storing', async () => {
    const { status, body } = await postJson(
      `/api/seo/competitors/${ws.workspaceId}`,
      { domains: ['https://withprotocol.com'] },
    );
    expect(status).toBe(200);
    const b = body as { competitors: string[] };
    // The stored value should not contain the https:// prefix
    const stored = b.competitors.find((d) => d.includes('withprotocol'));
    expect(stored).toBeTruthy();
    expect(stored).not.toContain('https://');
  });

  it('filters out bare words without a TLD (invalid provider-unsafe domains)', async () => {
    const { status, body } = await postJson(
      `/api/seo/competitors/${ws.workspaceId}`,
      // 'nodot' has no TLD, 'valid.com' is valid
      { domains: ['nodot', 'valid.com'] },
    );
    expect(status).toBe(200);
    const b = body as { competitors: string[] };
    expect(b.competitors.some((d) => d === 'nodot')).toBe(false);
    expect(b.competitors.some((d) => d.includes('valid'))).toBe(true);
  });

  it('filters out generic social/discovery domains (e.g. facebook.com)', async () => {
    const { status, body } = await postJson(
      `/api/seo/competitors/${ws.workspaceId}`,
      { domains: ['facebook.com', 'legit-competitor.com'] },
    );
    expect(status).toBe(200);
    const b = body as { competitors: string[] };
    expect(b.competitors.some((d) => d.includes('facebook'))).toBe(false);
    expect(b.competitors.some((d) => d.includes('legit-competitor'))).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Section 10: Unknown workspace
// ---------------------------------------------------------------------------

describe('Unknown workspaceId — 404 responses', () => {
  beforeAll(() => {
    mockProviderRef = makeMockProvider();
    broadcastState.calls.length = 0;
  });

  afterAll(() => {
    mockProviderRef = null;
  });

  it('POST competitors returns 404 for an unknown workspaceId', async () => {
    const { status } = await postJson(
      '/api/seo/competitors/ws_unknown_lifecycle_99',
      { domains: ['shouldfail.com'] },
    );
    expect(status).toBe(404);
  });

  it('competitive-intel returns 404 for an unknown workspaceId', async () => {
    const { status } = await getJson(
      '/api/seo/competitive-intel/ws_unknown_lifecycle_99?competitors=rival.com',
    );
    expect(status).toBe(404);
  });
});

// ---------------------------------------------------------------------------
// Section 11: Provider not configured
// ---------------------------------------------------------------------------

describe('No SEO provider configured', () => {
  let ws: SeededFullWorkspace;

  beforeAll(() => {
    ws = seedWorkspace();
    // No provider — getConfiguredProvider returns null
    mockProviderRef = null;
    broadcastState.calls.length = 0;
  });

  afterAll(() => {
    ws.cleanup();
  });

  it('competitive-intel returns 503 when no provider is configured', async () => {
    const { status, body } = await getJson(
      `/api/seo/competitive-intel/${ws.workspaceId}?competitors=rival.com`,
    );
    expect(status).toBe(503);
    expect((body as Record<string, unknown>).error).toBeTruthy();
  });

  it('discover-competitors returns 400 when no provider is configured', async () => {
    const { status } = await getJson(
      `/api/seo/discover-competitors/${ws.workspaceId}`,
    );
    // The route returns 400 (not 503) when provider is missing for discovery
    expect(status).toBe(400);
  });
});

// ---------------------------------------------------------------------------
// Section 12: Provider returns empty data — graceful empty result
// ---------------------------------------------------------------------------

describe('GET /api/seo/competitive-intel — empty provider data', () => {
  let ws: SeededFullWorkspace;

  beforeAll(() => {
    ws = seedWorkspace();
    mockProviderRef = makeMockProvider({
      overview: null,
      competitors: [],
      keywordGap: [],
      domainKeywords: [],
    });
    broadcastState.calls.length = 0;
  });

  afterAll(() => {
    ws.cleanup();
    mockProviderRef = null;
  });

  it('returns 200 even when provider returns no overview data', async () => {
    const { status } = await getJson(
      `/api/seo/competitive-intel/${ws.workspaceId}?competitors=empty-rival.com`,
    );
    expect(status).toBe(200);
  });

  it('keywordGaps is an empty array when provider returns nothing', async () => {
    const { status, body } = await getJson(
      `/api/seo/competitive-intel/${ws.workspaceId}?competitors=empty-rival.com`,
    );
    expect(status).toBe(200);
    const b = body as { keywordGaps: unknown[] };
    expect(Array.isArray(b.keywordGaps)).toBe(true);
    expect(b.keywordGaps).toHaveLength(0);
  });

  it('domains array is still returned (with nulled overview) when provider has no data', async () => {
    const { status, body } = await getJson(
      `/api/seo/competitive-intel/${ws.workspaceId}?competitors=empty-rival.com`,
    );
    expect(status).toBe(200);
    const b = body as { domains: Array<{ domain: string; overview: unknown }> };
    expect(Array.isArray(b.domains)).toBe(true);
    expect(b.domains.length).toBeGreaterThan(0);
    // Own domain entry should always be present
    expect(b.domains.some((d) => d.domain === 'test.example.com')).toBe(true);
  });
});
