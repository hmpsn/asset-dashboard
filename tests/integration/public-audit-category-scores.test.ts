import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import http from 'http';
import { createHmac } from 'crypto';
import { Socket } from 'net';
import type express from 'express';
import { seedWorkspace, type SeededFullWorkspace } from '../fixtures/workspace-seed.js';
import { updateWorkspace } from '../../server/workspaces.js';
import { saveSnapshot } from '../../server/reports.js';
import { setBroadcast } from '../../server/broadcast.js';
import type { SeoAuditResult } from '../../server/seo-audit.js';

let seeded: SeededFullWorkspace;
let app: express.Express;
const SESSION_SECRET = process.env.SESSION_SECRET ?? 'asset-dashboard-test-session-secret';
const adminAuthToken = createHmac('sha256', SESSION_SECRET).update('admin').digest('hex');

const audit: SeoAuditResult = {
  siteScore: 82,
  totalPages: 2,
  errors: 1,
  warnings: 1,
  infos: 0,
  pages: [
    {
      pageId: 'page-home',
      page: 'Home',
      slug: 'home',
      url: '/home',
      score: 75,
      issues: [
        {
          check: 'title',
          severity: 'error',
          category: 'content',
          displayCategory: 'onpage',
          message: 'Missing title',
          recommendation: 'Add a specific page title.',
        },
      ],
    },
    {
      pageId: 'page-services',
      page: 'Services',
      slug: 'services',
      url: '/services',
      score: 90,
      issues: [
        {
          check: 'structured-data',
          severity: 'warning',
          category: 'technical',
          displayCategory: 'schema',
          message: 'Schema missing',
          recommendation: 'Add structured data.',
        },
      ],
    },
  ],
  siteWideIssues: [],
};

beforeAll(async () => {
  process.env.APP_PASSWORD = '';
  process.env.SESSION_SECRET = SESSION_SECRET;
  setBroadcast(() => {}, () => {});
  const { createApp } = await import('../../server/app.js');
  app = createApp();
  seeded = seedWorkspace({ clientPassword: '' });
  updateWorkspace(seeded.workspaceId, {
    clientPortalEnabled: true,
    webflowSiteId: `site-category-${seeded.workspaceId}`,
    webflowSiteName: 'Category Score Site',
  });
  saveSnapshot(`site-category-${seeded.workspaceId}`, 'Category Score Site', audit);
}, 30_000);

afterAll(async () => {
  seeded?.cleanup();
});

async function appGet(path: string): Promise<{ status: number; json: () => Promise<unknown> }> {
  const socket = new Socket();
  const req = new http.IncomingMessage(socket);
  req.method = 'GET';
  req.url = path;
  req.headers = {
    host: '127.0.0.1',
    'x-auth-token': adminAuthToken,
  };

  const res = new http.ServerResponse(req);
  const chunks: Buffer[] = [];

  return new Promise((resolve, reject) => {
    const finish = () => {
      const body = Buffer.concat(chunks).toString('utf8');
      resolve({
        status: res.statusCode,
        json: async () => (body ? new Response(body).json() : null),
      });
    };

    res.write = ((chunk: unknown, encoding?: BufferEncoding | ((error?: Error | null) => void), cb?: (error?: Error | null) => void) => {
      if (chunk) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk), typeof encoding === 'string' ? encoding : undefined));
      if (typeof encoding === 'function') encoding();
      if (cb) cb();
      return true;
    }) as typeof res.write;

    res.end = ((chunk?: unknown, encoding?: BufferEncoding | (() => void), cb?: () => void) => {
      if (chunk) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk), typeof encoding === 'string' ? encoding : undefined));
      if (typeof encoding === 'function') encoding();
      if (cb) cb();
      finish();
      return res;
    }) as typeof res.end;

    app(req, res, (error: unknown) => {
      if (error) reject(error);
      else finish();
    });
  });
}

describe('public audit additive category scoring', () => {
  it('serializes displayCategory and category scores on the public audit read path while preserving audit-traffic map shape', async () => {
    const detailRes = await appGet(`/api/public/audit-detail/${seeded.workspaceId}`);
    expect(detailRes.status).toBe(200);
    const detail = await detailRes.json() as {
      audit: SeoAuditResult;
    };

    expect(detail.audit.pages[0]?.issues[0]?.displayCategory).toBe('onpage');
    expect(detail.audit.pages[1]?.issues[0]?.displayCategory).toBe('schema');
    expect(detail.audit.categoryScoreVersion).toBe(1);
    expect(detail.audit.categoryScores?.map((score) => score.category).sort()).toEqual([
      'index',
      'links',
      'mobile',
      'onpage',
      'perf',
      'schema',
    ]);
    const onpage = detail.audit.categoryScores?.find((score) => score.category === 'onpage');
    expect(onpage).toMatchObject({
      label: 'On-page',
      denominatorPages: 2,
      affectedPages: 1,
      errors: 1,
    });

    const summaryRes = await appGet(`/api/public/audit-summary/${seeded.workspaceId}`);
    expect(summaryRes.status).toBe(200);
    const summary = await summaryRes.json() as {
      siteScore: number;
      totalPages: number;
      categoryScoreVersion?: number;
      categoryScores?: Array<{ category: string; score: number }>;
    };
    expect(summary.siteScore).toBe(82);
    expect(summary.totalPages).toBe(2);
    expect(summary.categoryScoreVersion).toBe(1);
    expect(summary.categoryScores?.some((score) => score.category === 'schema')).toBe(true);

    const trafficRes = await appGet(`/api/public/audit-traffic/${seeded.workspaceId}`);
    expect(trafficRes.status).toBe(200);
    const traffic = await trafficRes.json() as Record<string, { clicks: number; impressions: number; sessions: number; pageviews: number }>;
    expect(traffic && typeof traffic).toBe('object');
    for (const [path, metrics] of Object.entries(traffic)) {
      expect(path.startsWith('/')).toBe(true);
      expect(metrics).toEqual(expect.objectContaining({
        clicks: expect.any(Number),
        impressions: expect.any(Number),
        sessions: expect.any(Number),
        pageviews: expect.any(Number),
      }));
    }
  });
});
