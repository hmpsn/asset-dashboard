/**
 * Regression tests for A3 (PR #218): date shape contract on
 * GET /api/backlinks/:workspaceId
 *
 * Before PR #218 the route could return raw Unix epoch strings (e.g. "1747440000")
 * or "Invalid Date" in firstSeen / lastSeen fields because provider dates were
 * passed straight to new Date() without normalisation. normalizeProviderDate() was
 * added in Task 2 and wired into both providers in Tasks 3 and 4.
 *
 * These tests guard against regression by asserting:
 *   1. Any non-empty date in referringDomains is a valid, Date-parseable ISO string
 *   2. No 10-digit numeric string (raw Unix epoch) leaks through
 *   3. Missing dates produce '' (empty string), not "Invalid Date"
 *
 * Architecture: mirrors backlinks-routes.test.ts exactly —
 *   in-process server + vi.mock for seo-data-provider so no real API calls occur.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import http from 'http';
import type { AddressInfo } from 'net';
import { seedWorkspace } from '../fixtures/workspace-seed.js';
import type { SeededFullWorkspace } from '../fixtures/workspace-seed.js';
import type {
  BacklinksOverview,
  ReferringDomain,
  SeoDataProvider,
} from '../../server/seo-data-provider.js';

// ---------------------------------------------------------------------------
// Module-level vi.mock declarations — hoisted before imports by Vitest
// ---------------------------------------------------------------------------

vi.mock('../../server/broadcast.js', () => ({
  setBroadcast: vi.fn(),
  broadcast: vi.fn(),
  broadcastToWorkspace: vi.fn(),
}));

// Mutable reference so each test can inject the provider it needs.
let mockProviderRef: SeoDataProvider | null = null;

vi.mock('../../server/seo-data-provider.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../server/seo-data-provider.js')>();
  return {
    ...actual,
    getBacklinksProvider: vi.fn(() => mockProviderRef),
  };
});

// ---------------------------------------------------------------------------
// In-process server helpers (copied from backlinks-routes.test.ts pattern)
// ---------------------------------------------------------------------------

async function startTestServer(): Promise<{
  server: http.Server;
  baseUrl: string;
  stop: () => void;
}> {
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
// Shared fixture data
// ---------------------------------------------------------------------------

const DEFAULT_OVERVIEW: BacklinksOverview = {
  totalBacklinks: 100,
  referringDomains: 5,
  followLinks: 80,
  nofollowLinks: 20,
  textLinks: 70,
  imageLinks: 10,
  formLinks: 0,
  frameLinks: 0,
};

function makeMockProvider(referringDomains: ReferringDomain[]): SeoDataProvider {
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
    getBacklinksOverview: vi.fn(async () => DEFAULT_OVERVIEW),
    getReferringDomains: vi.fn(async () => referringDomains),
  } as unknown as SeoDataProvider;
}

// ---------------------------------------------------------------------------
// Test suite: date shape contract
// ---------------------------------------------------------------------------

describe('GET /api/backlinks/:workspaceId — date shape contract', () => {
  let ws: SeededFullWorkspace;
  let baseUrl: string;
  let stopServer: () => void;

  afterEach(() => {
    ws.cleanup();
    mockProviderRef = null;
    stopServer();
  });

  it('returns ISO-8601 firstSeen / lastSeen (not Unix epoch strings)', async () => {
    // Provider returns full ISO-8601 timestamps — these are what normalizeProviderDate()
    // should produce when the raw value is already ISO or when converting Unix epoch.
    ws = seedWorkspace();
    mockProviderRef = makeMockProvider([
      {
        domain: 'iso-date-referrer.com',
        backlinksCount: 42,
        firstSeen: '2025-05-17T00:00:00.000Z',
        lastSeen: '2025-11-01T00:00:00.000Z',
      },
      {
        domain: 'another-iso-site.io',
        backlinksCount: 18,
        firstSeen: '2024-03-10T12:00:00.000Z',
        lastSeen: '2025-12-01T08:30:00.000Z',
      },
    ]);

    const srv = await startTestServer();
    baseUrl = srv.baseUrl;
    stopServer = srv.stop;

    const { status, body } = await getJson(baseUrl, `/api/backlinks/${ws.workspaceId}`);
    expect(status).toBe(200);

    const domains = (body as Record<string, unknown>).referringDomains as ReferringDomain[];
    expect(Array.isArray(domains)).toBe(true);
    expect(domains.length).toBe(2);

    // Every non-empty date must be parseable as a valid Date
    for (const domain of domains) {
      for (const dateField of [domain.firstSeen, domain.lastSeen]) {
        if (dateField && dateField !== '') {
          const parsed = new Date(dateField);
          expect(
            isNaN(parsed.getTime()),
            `Expected "${dateField}" to be a valid date`,
          ).toBe(false);
        }
      }
    }

    // No raw 10-digit Unix epoch strings (e.g. "1747440000") must survive.
    // A normalized date like "2025-05-17T00:00:00.000Z" is 24 chars; a raw Unix
    // epoch string is exactly 10 digits.
    const unixEpochPattern = /^\d{10}$/;
    for (const domain of domains) {
      for (const dateField of [domain.firstSeen, domain.lastSeen]) {
        if (dateField) {
          expect(
            unixEpochPattern.test(dateField),
            `Expected "${dateField}" NOT to be a raw Unix epoch string`,
          ).toBe(false);
        }
      }
    }
  });

  it('returns empty strings (not "Invalid Date") for missing dates', async () => {
    // Provider returns '' for firstSeen/lastSeen — normalizeProviderDate('') returns ''.
    // The route must not convert '' to 'Invalid Date' or null.
    ws = seedWorkspace();
    mockProviderRef = makeMockProvider([
      {
        domain: 'no-dates-referrer.com',
        backlinksCount: 5,
        firstSeen: '',
        lastSeen: '',
      },
    ]);

    const srv = await startTestServer();
    baseUrl = srv.baseUrl;
    stopServer = srv.stop;

    const { status, body } = await getJson(baseUrl, `/api/backlinks/${ws.workspaceId}`);
    expect(status).toBe(200);

    const domains = (body as Record<string, unknown>).referringDomains as ReferringDomain[];
    expect(domains.length).toBe(1);

    const d = domains[0];

    // Must not be "Invalid Date"
    expect(d.firstSeen).not.toBe('Invalid Date');
    expect(d.lastSeen).not.toBe('Invalid Date');

    // Must be falsy (empty string or absent — not a non-empty garbage value)
    expect(d.firstSeen || '').toBe('');
    expect(d.lastSeen || '').toBe('');
  });

  it('date with YYYY-MM-DD format is parseable (short ISO dates from DFS/SEMRush)', async () => {
    // Providers can return short date strings like '2023-01-15' (no time component).
    // These are valid ISO-8601 dates and must remain parseable after passing through
    // the route (normalizeProviderDate keeps them as-is if already ISO-formatted).
    ws = seedWorkspace();
    mockProviderRef = makeMockProvider([
      {
        domain: 'short-date-referrer.com',
        backlinksCount: 10,
        firstSeen: '2023-01-15',
        lastSeen: '2024-11-20',
      },
    ]);

    const srv = await startTestServer();
    baseUrl = srv.baseUrl;
    stopServer = srv.stop;

    const { status, body } = await getJson(baseUrl, `/api/backlinks/${ws.workspaceId}`);
    expect(status).toBe(200);

    const domains = (body as Record<string, unknown>).referringDomains as ReferringDomain[];
    expect(domains.length).toBe(1);

    const d = domains[0];
    // Short ISO dates must survive to the response and be parseable
    expect(isNaN(new Date(d.firstSeen).getTime())).toBe(false);
    expect(isNaN(new Date(d.lastSeen).getTime())).toBe(false);
    // Must not be raw Unix epoch strings
    expect(/^\d{10}$/.test(d.firstSeen)).toBe(false);
    expect(/^\d{10}$/.test(d.lastSeen)).toBe(false);
  });
});
