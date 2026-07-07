/**
 * Integration test for the admin competitor-alerts route (The Issue, Phase 6 competitor page):
 *
 *   GET /api/workspaces/:workspaceId/competitor-alerts → CompetitorAlertsResponse
 *
 * The route promotes the never-shown `competitor_alerts` rows (written weekly by the competitor
 * cron) onto the dedicated admin Competitors page. These cases assert through the live HTTP read:
 *   - 200 + the response shape ({ workspaceId, alerts });
 *   - a seeded alert maps to the CompetitorAlertView wire shape (severity, positionChange, keyword
 *     present; optional store numerics normalized so they are present on the view);
 *   - newest-first ordering (created_at DESC) survives the route mapping;
 *   - an empty alerts array for a workspace with no alerts.
 *
 * In-process server pattern (http.createServer(createApp()) on port 0, APP_PASSWORD unset), mirror of
 * strategy-issue-lenses-route.test.ts. requireWorkspaceAccess passes through for HMAC (no JWT user)
 * when APP_PASSWORD is unset, so the unauthenticated fetch reaches the handler.
 *
 * Rows are seeded via direct SQL (migration 071-competitor-alerts.sql columns:
 *   id, workspace_id, competitor_domain, alert_type, keyword, previous_position, current_position,
 *   position_change, volume, severity, snapshot_date, insight_id, created_at)
 * with explicit created_at values so the ordering assertion is deterministic.
 */
import { afterAll, beforeAll, afterEach, describe, expect, it } from 'vitest';
import { IncomingMessage, ServerResponse } from 'http';
import { Socket } from 'net';
import type { Express } from 'express';

import { createWorkspace, deleteWorkspace } from '../../server/workspaces.js';
import db from '../../server/db/index.js';
import { parseJsonFallback } from '../../server/db/json-validation.js';
import type { CompetitorAlertsResponse } from '../../shared/types/competitor-alerts.js';

type CompetitorAlertsResponseWithRideAlong = CompetitorAlertsResponse & {
  lastSnapshotDate: string | null;
  alerts: Array<CompetitorAlertsResponse['alerts'][number] & { insightId: string | null }>;
};

let app: Express;
let wsId = '';
let otherWsId = '';

const insertAlert = db.prepare(`
  INSERT INTO competitor_alerts
    (id, workspace_id, competitor_domain, alert_type, keyword, previous_position,
     current_position, position_change, volume, severity, snapshot_date, insight_id, created_at)
  VALUES
    (@id, @workspace_id, @competitor_domain, @alert_type, @keyword, @previous_position,
     @current_position, @position_change, @volume, @severity, @snapshot_date, @insight_id, @created_at)
`);

const insertSnapshot = db.prepare(`
  INSERT INTO competitor_snapshots
    (id, workspace_id, competitor_domain, snapshot_date, keyword_count, organic_traffic, top_keywords, created_at)
  VALUES
    (@id, @workspace_id, @competitor_domain, @snapshot_date, @keyword_count, @organic_traffic, @top_keywords, @created_at)
`);

function seedAlert(opts: {
  id: string;
  workspaceId: string;
  competitorDomain?: string;
  alertType?: string;
  keyword?: string | null;
  previousPosition?: number | null;
  currentPosition?: number | null;
  positionChange?: number | null;
  volume?: number | null;
  severity?: string;
  insightId?: string | null;
  snapshotDate?: string;
  createdAt: string;
}): void {
  insertAlert.run({
    id: opts.id,
    workspace_id: opts.workspaceId,
    competitor_domain: opts.competitorDomain ?? 'competitor.example.com',
    alert_type: opts.alertType ?? 'keyword_gained',
    keyword: opts.keyword ?? 'roof repair',
    previous_position: opts.previousPosition ?? 12,
    current_position: opts.currentPosition ?? 4,
    position_change: opts.positionChange ?? 8,
    volume: opts.volume ?? 900,
    severity: opts.severity ?? 'warning',
    snapshot_date: opts.snapshotDate ?? '2026-06-15',
    insight_id: opts.insightId ?? null,
    created_at: opts.createdAt,
  });
}

function seedSnapshot(opts: {
  id: string;
  workspaceId: string;
  competitorDomain?: string;
  snapshotDate: string;
  createdAt?: string;
}): void {
  insertSnapshot.run({
    id: opts.id,
    workspace_id: opts.workspaceId,
    competitor_domain: opts.competitorDomain ?? 'competitor.example.com',
    snapshot_date: opts.snapshotDate,
    keyword_count: 12,
    organic_traffic: 1200,
    top_keywords: '[]',
    created_at: opts.createdAt ?? `${opts.snapshotDate}T00:00:00.000Z`,
  });
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

async function fetchAlerts(id: string): Promise<{ status: number; body: CompetitorAlertsResponseWithRideAlong }> {
  const { status, body } = await requestJson(`/api/workspaces/${id}/competitor-alerts`);
  return { status, body: body as CompetitorAlertsResponseWithRideAlong };
}

beforeAll(async () => {
  delete process.env.APP_PASSWORD;
  const { createApp } = await import('../../server/app.js'); // dynamic-import-ok
  app = createApp();

  wsId = createWorkspace('Competitor Alerts Route WS').id;
  otherWsId = createWorkspace('Competitor Alerts Route Empty WS').id;
}, 60_000);

afterEach(() => {
  db.prepare('DELETE FROM competitor_alerts WHERE workspace_id = ?').run(wsId);
  db.prepare('DELETE FROM competitor_alerts WHERE workspace_id = ?').run(otherWsId);
  db.prepare('DELETE FROM competitor_snapshots WHERE workspace_id = ?').run(wsId);
  db.prepare('DELETE FROM competitor_snapshots WHERE workspace_id = ?').run(otherWsId);
});

afterAll(async () => {
  deleteWorkspace(wsId);
  deleteWorkspace(otherWsId);
});

describe('GET /api/workspaces/:workspaceId/competitor-alerts', () => {
  it('returns 200 + the response shape { workspaceId, alerts }', async () => {
    seedAlert({ id: 'ca-1', workspaceId: wsId, createdAt: '2026-06-15T00:00:00.000Z' });

    const { status, body } = await fetchAlerts(wsId);

    expect(status).toBe(200);
    expect(body.workspaceId).toBe(wsId);
    expect(Array.isArray(body.alerts)).toBe(true);
    expect(body.alerts).toHaveLength(1);
  });

  it('maps a seeded alert to the CompetitorAlertView wire shape', async () => {
    seedAlert({
      id: 'ca-shape',
      workspaceId: wsId,
      competitorDomain: 'rival.example.com',
      alertType: 'keyword_gained',
      keyword: 'metal roofing',
      previousPosition: 9,
      currentPosition: 3,
      positionChange: 6,
      volume: 1200,
      severity: 'critical',
      snapshotDate: '2026-06-15',
      createdAt: '2026-06-15T08:00:00.000Z',
    });

    const { status, body } = await fetchAlerts(wsId);
    expect(status).toBe(200);

    const view = body.alerts.find(a => a.id === 'ca-shape');
    expect(view).toBeDefined();
    expect(view).toMatchObject({
      id: 'ca-shape',
      competitorDomain: 'rival.example.com',
      alertType: 'keyword_gained',
      keyword: 'metal roofing',
      previousPosition: 9,
      currentPosition: 3,
      positionChange: 6,
      volume: 1200,
      severity: 'critical',
      snapshotDate: '2026-06-15',
      createdAt: '2026-06-15T08:00:00.000Z',
    });
    // The wire shape normalizes the store's optional numerics to `| null` — they must be present.
    expect(view!.severity).toBe('critical');
    expect(view!.positionChange).toBe(6);
    expect(view!.keyword).toBe('metal roofing');
    expect(view!.insightId).toBeNull();
  });

  it('adds insightId to alert rows when an alert has been linked to an insight', async () => {
    seedAlert({
      id: 'ca-insight',
      workspaceId: wsId,
      insightId: 'insight-123',
      createdAt: '2026-06-15T08:00:00.000Z',
    });

    const { status, body } = await fetchAlerts(wsId);
    expect(status).toBe(200);
    expect(body.alerts[0]).toMatchObject({
      id: 'ca-insight',
      insightId: 'insight-123',
    });
  });

  it('returns the latest competitor snapshot date even when no alerts fired', async () => {
    seedSnapshot({ id: 'snap-old', workspaceId: otherWsId, snapshotDate: '2026-06-08' });
    seedSnapshot({ id: 'snap-new', workspaceId: otherWsId, snapshotDate: '2026-06-15' });

    const { status, body } = await fetchAlerts(otherWsId);
    expect(status).toBe(200);
    expect(body.alerts).toEqual([]);
    expect(body.lastSnapshotDate).toBe('2026-06-15');
  });

  it('scopes alerts to the workspace through the HTTP path (no cross-workspace leak)', async () => {
    seedAlert({ id: 'scope-mine', workspaceId: wsId, keyword: 'mine', createdAt: '2026-06-12T00:00:00.000Z' });
    seedAlert({ id: 'scope-other', workspaceId: otherWsId, keyword: 'theirs', createdAt: '2026-06-13T00:00:00.000Z' });

    const { status, body } = await fetchAlerts(wsId);
    expect(status).toBe(200);
    // Only wsId's alert returns — the other workspace's row (newer created_at) must not leak in.
    expect(body.alerts.map(a => a.id)).toEqual(['scope-mine']);
  });

  it('orders alerts newest-first (created_at DESC) through HTTP', async () => {
    seedAlert({ id: 'ord-mid', workspaceId: wsId, keyword: 'mid', createdAt: '2026-06-10T00:00:00.000Z' });
    seedAlert({ id: 'ord-old', workspaceId: wsId, keyword: 'old', createdAt: '2026-06-01T00:00:00.000Z' });
    seedAlert({ id: 'ord-new', workspaceId: wsId, keyword: 'new', createdAt: '2026-06-18T00:00:00.000Z' });

    const { status, body } = await fetchAlerts(wsId);
    expect(status).toBe(200);
    expect(body.alerts.map(a => a.id)).toEqual(['ord-new', 'ord-mid', 'ord-old']);
  });

  it('returns an empty alerts array for a workspace with no alerts', async () => {
    const { status, body } = await fetchAlerts(otherWsId);

    expect(status).toBe(200);
    expect(body.workspaceId).toBe(otherWsId);
    expect(body.alerts).toEqual([]);
  });
});
