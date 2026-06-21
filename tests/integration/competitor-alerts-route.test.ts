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
import http from 'http';
import type { AddressInfo } from 'net';

import { createWorkspace, deleteWorkspace } from '../../server/workspaces.js';
import db from '../../server/db/index.js';
import type { CompetitorAlertsResponse } from '../../shared/types/competitor-alerts.js';

let baseUrl = '';
let server: http.Server | undefined;
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
    insight_id: null,
    created_at: opts.createdAt,
  });
}

async function fetchAlerts(id: string): Promise<{ status: number; body: CompetitorAlertsResponse }> {
  const res = await fetch(`${baseUrl}/api/workspaces/${id}/competitor-alerts`);
  const body = await res.json() as CompetitorAlertsResponse;
  return { status: res.status, body };
}

beforeAll(async () => {
  delete process.env.APP_PASSWORD;
  const { createApp } = await import('../../server/app.js'); // dynamic-import-ok
  server = http.createServer(createApp());
  await new Promise<void>(resolve => server!.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  baseUrl = `http://127.0.0.1:${port}`;

  wsId = createWorkspace('Competitor Alerts Route WS').id;
  otherWsId = createWorkspace('Competitor Alerts Route Empty WS').id;
}, 60_000);

afterEach(() => {
  db.prepare('DELETE FROM competitor_alerts WHERE workspace_id = ?').run(wsId);
  db.prepare('DELETE FROM competitor_alerts WHERE workspace_id = ?').run(otherWsId);
});

afterAll(async () => {
  deleteWorkspace(wsId);
  deleteWorkspace(otherWsId);
  if (server) await new Promise<void>((resolve, reject) => server!.close(err => (err ? reject(err) : resolve())));
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
    // toMatchObject is a SUBSET matcher, so assert the admin-internal `insightId` is NOT leaked onto
    // the wire shape (toView omits it; a future `...alert` spread would silently re-expose it).
    expect(view).not.toHaveProperty('insightId');
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
