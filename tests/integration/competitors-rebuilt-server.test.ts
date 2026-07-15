import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { IncomingMessage, ServerResponse } from 'http';
import { Socket } from 'net';
import type { Express } from 'express';
import { seedWorkspace } from '../fixtures/workspace-seed.js';
import type { SeededFullWorkspace } from '../fixtures/workspace-seed.js';
import { parseJsonFallback } from '../../server/db/json-validation.js';
import type {
  BacklinksOverview,
  DomainAuthorityMetric,
  DomainKeyword,
  DomainOverview,
  KeywordGapEntry,
  SeoDataProvider,
} from '../../server/seo-data-provider.js';

const providerState = vi.hoisted(() => ({
  provider: null as unknown,
}));

vi.mock('../../server/seo-data-provider.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../server/seo-data-provider.js')>();
  return {
    ...actual,
    getConfiguredProvider: vi.fn(() => providerState.provider),
    getBacklinksProvider: vi.fn(() => providerState.provider),
  };
});

let app: Express;
let ws: SeededFullWorkspace | null = null;

const OVERVIEWS: Record<string, DomainOverview> = {
  'test.example.com': {
    domain: 'test.example.com',
    organicKeywords: 120,
    organicTraffic: 4600,
    organicCost: 9100,
    paidKeywords: 0,
    paidTraffic: 0,
    paidCost: 0,
  },
  'rival.com': {
    domain: 'rival.com',
    organicKeywords: 210,
    organicTraffic: 5400,
    organicCost: 12400,
    paidKeywords: 0,
    paidTraffic: 0,
    paidCost: 0,
  },
};

const BACKLINKS: Record<string, BacklinksOverview> = {
  'test.example.com': {
    totalBacklinks: 2500,
    referringDomains: 180,
    followLinks: 1900,
    nofollowLinks: 600,
    textLinks: 2300,
    imageLinks: 200,
    formLinks: 0,
    frameLinks: 0,
  },
  'rival.com': {
    totalBacklinks: 3100,
    referringDomains: 220,
    followLinks: 2600,
    nofollowLinks: 500,
    textLinks: 2800,
    imageLinks: 300,
    formLinks: 0,
    frameLinks: 0,
  },
};

const AUTHORITY_METRICS: DomainAuthorityMetric[] = [
  { domain: 'test.example.com', authorityRank: 46, top3Keywords: 18 },
  { domain: 'rival.com', authorityRank: 55, top3Keywords: 32 },
];

function makeProvider(overrides: Partial<SeoDataProvider> = {}): SeoDataProvider {
  return {
    name: 'dataforseo',
    isConfigured: () => true,
    getKeywordMetrics: vi.fn(async () => []),
    getRelatedKeywords: vi.fn(async () => []),
    getQuestionKeywords: vi.fn(async () => []),
    getDomainOverview: vi.fn(async (domain: string) => OVERVIEWS[domain] ?? null),
    getCompetitors: vi.fn(async () => []),
    getKeywordGap: vi.fn(async (): Promise<KeywordGapEntry[]> => [
      {
        keyword: 'emergency dentist austin',
        volume: 900,
        difficulty: 41,
        competitorPosition: 2,
        competitorDomain: 'rival.com',
      },
    ]),
    getDomainKeywords: vi.fn(async (domain: string): Promise<DomainKeyword[]> => [
      {
        keyword: domain === 'rival.com' ? 'emergency dentist austin' : 'cosmetic dentist',
        position: domain === 'rival.com' ? 2 : 4,
        volume: domain === 'rival.com' ? 900 : 1400,
        difficulty: domain === 'rival.com' ? 41 : 38,
        cpc: 10,
        url: `https://${domain}/service`,
        traffic: domain === 'rival.com' ? 410 : 320,
        trafficPercent: 3,
      },
    ]),
    getDomainAuthorityMetrics: vi.fn(async () => AUTHORITY_METRICS),
    getBacklinksOverview: vi.fn(async (domain: string) => BACKLINKS[domain] ?? null),
    getReferringDomains: vi.fn(async () => []),
    ...overrides,
  };
}

async function requestJson(path: string): Promise<{ status: number; body: unknown }> {
  return await new Promise<{ status: number; body: unknown }>((resolve, reject) => {
    const req = new IncomingMessage(new Socket());
    req.method = 'GET';
    req.url = path;
    req.headers = { host: 'localhost' };

    const res = new ServerResponse(req);
    const chunks: Buffer[] = [];
    let settled = false;

    function settle(bodyText: string): void {
      if (settled) return;
      settled = true;
      resolve({
        status: res.statusCode,
        body: bodyText ? parseJsonFallback<unknown>(bodyText, bodyText) : undefined,
      });
    }

    res.write = ((chunk: unknown, encodingOrCallback?: BufferEncoding | ((error?: Error) => void), callback?: (error?: Error) => void): boolean => {
      if (chunk != null) {
        const encoding = typeof encodingOrCallback === 'string' ? encodingOrCallback : undefined;
        chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk), encoding));
      }
      if (typeof encodingOrCallback === 'function') encodingOrCallback();
      if (callback) callback();
      return true;
    }) as typeof res.write;

    res.end = ((chunk?: unknown, encodingOrCallback?: BufferEncoding | (() => void), callback?: () => void): ServerResponse => {
      if (chunk != null) {
        const encoding = typeof encodingOrCallback === 'string' ? encodingOrCallback : undefined;
        chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk), encoding));
      }
      if (typeof encodingOrCallback === 'function') encodingOrCallback();
      if (callback) callback();
      settle(Buffer.concat(chunks).toString('utf8'));
      return res;
    }) as typeof res.end;

    app.handle(req, res, (err) => {
      if (err) {
        reject(err);
        return;
      }
      res.statusCode = 404;
      res.end('{"error":"Not found"}');
    });

    req.push(null);
  });
}

beforeAll(async () => {
  delete process.env.APP_PASSWORD;
  const { createApp } = await import('../../server/app.js');
  app = createApp();
  ws = seedWorkspace();
}, 60_000);

beforeEach(() => {
  providerState.provider = makeProvider();
});

afterAll(() => {
  providerState.provider = null;
  ws?.cleanup();
});

describe('GET /api/seo/competitive-intel/:workspaceId - rebuilt competitors ride-along fields', () => {
  it('returns additive authority rank and top-3 keyword fields per domain when the provider supplies them', async () => {
    const { status, body } = await requestJson(`/api/seo/competitive-intel/${ws!.workspaceId}?competitors=rival.com`);

    expect(status).toBe(200);
    const result = body as {
      domains: Array<{
        domain: string;
        authorityRank?: number | null;
        top3Keywords?: number | null;
      }>;
    };
    const own = result.domains.find((domain) => domain.domain === 'test.example.com');
    const rival = result.domains.find((domain) => domain.domain === 'rival.com');

    expect(own).toMatchObject({ authorityRank: 46, top3Keywords: 18 });
    expect(rival).toMatchObject({ authorityRank: 55, top3Keywords: 32 });
  });

  it('gracefully degrades when authority metrics fail without crashing the competitive-intel read', async () => {
    providerState.provider = makeProvider({
      getDomainAuthorityMetrics: vi.fn(async () => {
        throw new Error('DataForSEO authority secret failed');
      }),
    });

    const { status, body } = await requestJson(`/api/seo/competitive-intel/${ws!.workspaceId}?competitors=rival.com`);

    expect(status).toBe(200);
    const result = body as {
      degraded?: boolean;
      providerFailures?: Array<{ area: string; provider: string }>;
      domains: Array<{
        domain: string;
        authorityRank?: number | null;
        top3Keywords?: number | null;
      }>;
    };

    expect(result.degraded).toBe(true);
    expect(result.providerFailures?.some((failure) => failure.area === 'authority')).toBe(true);
    expect(result.domains.length).toBeGreaterThan(0);
    expect(result.domains.every((domain) => !('authorityRank' in domain) && !('top3Keywords' in domain))).toBe(true); // every-ok — length asserted on the line above
  });
});
