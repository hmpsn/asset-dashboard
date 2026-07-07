import crypto from 'crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import http from 'http';
import { createHmac } from 'crypto';
import { Socket } from 'net';
import type express from 'express';

import db from '../../server/db/index.js';
import { recordAction, recordOutcome } from '../../server/outcome-tracking.js';
import { saveSnapshot } from '../../server/reports.js';
import type { SeoAuditResult } from '../../server/seo-audit.js';
import { createWorkspace, deleteWorkspace } from '../../server/workspaces.js';
import { setBroadcast } from '../../server/broadcast.js';
import type { WorkspaceOverviewItem } from '../../shared/types/workspace-overview.js';

let app: express.Express;
let wsId = '';
const siteId = `site-overview-rollups-${crypto.randomUUID()}`;
const SESSION_SECRET = process.env.SESSION_SECRET ?? 'asset-dashboard-test-session-secret';
const adminAuthToken = createHmac('sha256', SESSION_SECRET).update('admin').digest('hex');

const winDelta = {
  primary_metric: 'clicks',
  baseline_value: 10,
  current_value: 50,
  delta_absolute: 40,
  delta_percent: 400,
  direction: 'up' as const,
};

const audit: SeoAuditResult = {
  siteScore: 74,
  totalPages: 4,
  errors: 2,
  warnings: 3,
  infos: 1,
  pages: [
    {
      pageId: 'home',
      page: 'Home',
      slug: 'home',
      url: '/home',
      score: 68,
      issues: [
        {
          check: 'title',
          severity: 'error',
          category: 'content',
          displayCategory: 'onpage',
          message: 'Missing title',
          recommendation: 'Add a specific title.',
        },
        {
          check: 'meta-description',
          severity: 'error',
          category: 'content',
          displayCategory: 'onpage',
          message: 'Missing description',
          recommendation: 'Add a description.',
        },
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
    {
      pageId: 'services',
      page: 'Services',
      slug: 'services',
      url: '/services',
      score: 82,
      issues: [
        {
          check: 'structured-data',
          severity: 'warning',
          category: 'technical',
          displayCategory: 'schema',
          message: 'Schema missing',
          recommendation: 'Add structured data.',
        },
        {
          check: 'link-text',
          severity: 'warning',
          category: 'links',
          displayCategory: 'links',
          message: 'Generic anchor text',
          recommendation: 'Use descriptive anchor text.',
        },
      ],
    },
  ],
  siteWideIssues: [],
  categoryScoreVersion: 1,
  categoryScores: [
    { category: 'onpage', label: 'On-page', score: 72, denominatorPages: 4, affectedPages: 2, errors: 2, warnings: 1, infos: 0 },
    { category: 'schema', label: 'Schema', score: 88, denominatorPages: 4, affectedPages: 1, errors: 0, warnings: 1, infos: 1 },
  ],
};

beforeAll(async () => {
  process.env.APP_PASSWORD = '';
  process.env.SESSION_SECRET = SESSION_SECRET;
  setBroadcast(() => {}, () => {});
  const { createApp } = await import('../../server/app.js');
  app = createApp();

  wsId = createWorkspace('Workspace Overview Rollups WS', siteId).id;
  saveSnapshot(siteId, 'Overview Rollups Site', audit);

  const executed = recordAction({ // recordAction-ok
    attribution: 'platform_executed',
    workspaceId: wsId,
    actionType: 'content_published',
    sourceType: 'test',
    sourceId: crypto.randomUUID(),
    pageUrl: '/executed',
    baselineSnapshot: { captured_at: new Date().toISOString(), clicks: 10 },
  });
  recordOutcome({
    actionId: executed.id,
    checkpointDays: 30,
    metricsSnapshot: { captured_at: new Date().toISOString(), clicks: 50 },
    score: 'strong_win',
    deltaSummary: winDelta,
    attributedValue: 125,
    valueBasis: 'clicks_delta_x_cpc',
  });

  const proposal = recordAction({ // recordAction-ok
    attribution: 'not_acted_on',
    workspaceId: wsId,
    actionType: 'content_published',
    sourceType: 'test',
    sourceId: crypto.randomUUID(),
    pageUrl: '/proposal',
    baselineSnapshot: { captured_at: new Date().toISOString(), clicks: 10 },
  });
  recordOutcome({
    actionId: proposal.id,
    checkpointDays: 30,
    metricsSnapshot: { captured_at: new Date().toISOString(), clicks: 90 },
    score: 'strong_win',
    deltaSummary: { ...winDelta, delta_absolute: 80, current_value: 90 },
    attributedValue: 500,
    valueBasis: 'clicks_delta_x_cpc',
  });
}, 60_000);

afterAll(async () => {
  db.prepare(`DELETE FROM action_outcomes WHERE action_id IN (SELECT id FROM tracked_actions WHERE workspace_id = ?)`).run(wsId);
  db.prepare(`DELETE FROM tracked_actions WHERE workspace_id = ?`).run(wsId);
  db.prepare(`DELETE FROM audit_snapshots WHERE site_id = ?`).run(siteId);
  deleteWorkspace(wsId);
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

describe('GET /api/workspace-overview — W6.0 additive rollups', () => {
  it('serializes value, GSC, and site-health matrix fields without removing existing fields', async () => {
    const res = await appGet('/api/workspace-overview');
    expect(res.status).toBe(200);
    const body = await res.json() as WorkspaceOverviewItem[];
    const row = body.find(workspace => workspace.id === wsId);

    expect(row).toBeDefined();
    expect(row).toHaveProperty('requests');
    expect(row).toHaveProperty('approvals');
    expect(row).toHaveProperty('pageStates');

    expect(row!.outcomeValue).toMatchObject({
      valuePerMonth: 125,
      clicks: 40,
      wins: 1,
      withValue: 1,
      platformExecuted: 1,
      externallyExecuted: 0,
      notActedOnExcluded: true,
    });
    expect(row!.gscRollup).toMatchObject({
      connected: false,
      dataAvailable: false,
      clicks: 0,
      traffic: 0,
      avgPosition: 0,
    });
    expect(row!.siteHealthIssueMatrix).toMatchObject({
      workspaceId: wsId,
      totalIssues: 5,
    });
    expect(row!.siteHealthIssueMatrix.issues.map(issue => issue.issueType)).toEqual(['onpage', 'schema', 'links']);
  });
});
