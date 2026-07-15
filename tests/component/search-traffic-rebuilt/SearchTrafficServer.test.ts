import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from 'vitest';
import { IncomingMessage, ServerResponse } from 'http';
import { Socket } from 'net';
import type { Express } from 'express';
import { seedWorkspace, type SeededFullWorkspace } from '../../fixtures/workspace-seed.js';
import { parseJsonFallback } from '../../../server/db/json-validation.js';

vi.mock('../../../server/broadcast.js', () => ({
  setBroadcast: vi.fn(),
  broadcast: vi.fn(),
  broadcastToWorkspace: vi.fn(),
}));

const googleAuthState = vi.hoisted(() => ({
  credentials: { clientId: 'test-id', clientSecret: 'test-secret', redirectUri: 'http://localhost/callback' } as object | null,
  siteConnected: true,
}));

vi.mock('../../../server/google-auth.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../server/google-auth.js')>();
  return {
    ...actual,
    getGoogleCredentials: vi.fn(() => googleAuthState.credentials),
    isConnected: vi.fn(() => googleAuthState.siteConnected),
    getGlobalToken: vi.fn(async () => 'global-token'),
  };
});

const analyticsDataState = vi.hoisted(() => ({
  brandedMode: 'success' as 'success' | 'throw',
  trendCalls: [] as Array<{ days: number; dateRange?: { startDate: string; endDate: string } }>,
}));

vi.mock('../../../server/analytics-data.js', () => ({
  fetchSearchOverview: vi.fn(async () => ({
    totalClicks: 100,
    totalImpressions: 1000,
    avgCtr: 10,
    avgPosition: 4.2,
    topQueries: [{ query: 'acme', clicks: 10, impressions: 100, ctr: 10, position: 1 }],
    topPages: [],
    dateRange: { start: '2026-06-01', end: '2026-06-28' },
  })),
  fetchBrandedDemandSplit: vi.fn(async () => {
    if (analyticsDataState.brandedMode === 'throw') throw new Error('GSC branded split failed');
    return {
      status: 'ready',
      denominator: 'impressions',
      queryRowsSampled: 1,
      total: { clicks: 100, impressions: 1000 },
      branded: { clicks: 10, impressions: 100, sharePct: 10 },
      nonBranded: { clicks: 90, impressions: 900, sharePct: 90 },
    };
  }),
  fetchPerformanceTrend: vi.fn(async (_siteId: string, _gscUrl: string, days: number, dateRange?: { startDate: string; endDate: string }) => {
    analyticsDataState.trendCalls.push({ days, dateRange });
    return [{ date: dateRange?.startDate ?? '2026-06-01', clicks: 1, impressions: 10, ctr: 10, position: 4 }];
  }),
  fetchSearchDevices: vi.fn(async () => []),
  fetchSearchCountries: vi.fn(async () => []),
  fetchSearchTypes: vi.fn(async () => []),
  fetchSearchComparison: vi.fn(async () => null),
}));

vi.mock('../../../server/search-console.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../server/search-console.js')>();
  return {
    ...actual,
    listGscSites: vi.fn(async () => []),
  };
});

vi.mock('../../../server/google-analytics.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../server/google-analytics.js')>();
  return {
    ...actual,
    listGA4Properties: vi.fn(async () => []),
  };
});

vi.mock('../../../server/ai.js', () => ({
  callAI: vi.fn(async () => ({ text: 'AI response', usage: {} })),
}));

vi.mock('../../../server/workspace-intelligence.js', () => ({
  buildWorkspaceIntelligence: vi.fn(async () => null),
  formatForPrompt: vi.fn(() => ''),
  formatPageMapForPrompt: vi.fn(() => ''),
}));

let app: Express;

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

describe('search-traffic server ride-alongs', () => {
  let ws: SeededFullWorkspace;

  beforeAll(async () => {
    delete process.env.APP_PASSWORD;
    const { createApp } = await import('../../../server/app.js');
    app = createApp();
  }, 60_000);

  beforeEach(async () => {
    analyticsDataState.brandedMode = 'success';
    analyticsDataState.trendCalls = [];
    ws = seedWorkspace({ gscPropertyUrl: 'https://gsc.example.com/', ga4PropertyId: '123' });
  }, 30_000);

  afterEach(async () => {
    ws.cleanup();
  }, 15_000);

  it('records an error status on the branded-demand field when the split provider read fails', async () => {
    analyticsDataState.brandedMode = 'throw';
    const res = await requestJson(
      `/api/google/search-overview/${ws.webflowSiteId}?workspaceId=${ws.workspaceId}&gscSiteUrl=https://gsc.example.com/&days=28`,
    );

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      brandedDemand: {
        status: 'error',
        denominator: 'impressions',
      },
    });
  });

  it('threads SB-012 previous-window dates into the GSC trend provider call', async () => {
    const res = await requestJson(
      `/api/google/performance-trend/${ws.webflowSiteId}?workspaceId=${ws.workspaceId}&gscSiteUrl=https://gsc.example.com/&days=7&startDate=2026-06-10&endDate=2026-06-16&previous=true`,
    );

    expect(res.status).toBe(200);
    expect(analyticsDataState.trendCalls).toEqual([
      { days: 7, dateRange: { startDate: '2026-06-03', endDate: '2026-06-09' } },
    ]);
  });
});
