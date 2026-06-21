/**
 * Unit test for the net-new Lane B store reader (The Issue, Phase 6 competitor page):
 *
 *   listCompetitorAlerts(workspaceId, limit?): CompetitorAlert[]
 *
 * The recent-alerts list backs the dedicated admin Competitors page (the `competitor_alerts` table is
 * written weekly by intelligence-crons.ts but had no UI before Phase 6). These cases assert:
 *   - newest-first ordering (ORDER BY created_at DESC, the existing index idx_competitor_alerts_ws_date);
 *   - the `limit` arg caps the row count;
 *   - workspace scoping — a second workspace's alerts are never returned;
 *   - an empty array when the workspace has no alerts.
 *
 * Rows are seeded via direct SQL with DISTINCT created_at values so ordering is deterministic — the
 * store's saveCompetitorAlerts() path stamps created_at via the column DEFAULT and cannot set it
 * explicitly, so it can't drive an ordering assertion.
 *
 * Migration 071-competitor-alerts.sql columns:
 *   id, workspace_id, competitor_domain, alert_type, keyword, previous_position, current_position,
 *   position_change, volume, severity, snapshot_date, insight_id, created_at
 */
import { describe, it, expect, beforeEach } from 'vitest';
import db from '../../server/db/index.js';
import { listCompetitorAlerts } from '../../server/competitor-snapshot-store.js';

const WS_ID = 'competitor-alerts-store-ws';
const OTHER_WS_ID = 'competitor-alerts-store-other-ws';

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
  workspaceId?: string;
  competitorDomain?: string;
  alertType?: string;
  keyword?: string | null;
  previousPosition?: number | null;
  currentPosition?: number | null;
  positionChange?: number | null;
  volume?: number | null;
  severity?: string;
  snapshotDate?: string;
  insightId?: string | null;
  createdAt: string;
}): void {
  insertAlert.run({
    id: opts.id,
    workspace_id: opts.workspaceId ?? WS_ID,
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

describe('listCompetitorAlerts', () => {
  beforeEach(() => {
    db.prepare("DELETE FROM competitor_alerts WHERE workspace_id LIKE 'competitor-alerts-store-%'").run();
  });

  it('returns alerts newest-first (created_at DESC)', () => {
    // Insert out of chronological order to prove the query sorts, not insertion order.
    seedAlert({ id: 'a-mid', keyword: 'mid', createdAt: '2026-06-10T12:00:00.000Z' });
    seedAlert({ id: 'a-old', keyword: 'old', createdAt: '2026-06-01T12:00:00.000Z' });
    seedAlert({ id: 'a-new', keyword: 'new', createdAt: '2026-06-18T12:00:00.000Z' });

    const alerts = listCompetitorAlerts(WS_ID);

    expect(alerts.map(a => a.id)).toEqual(['a-new', 'a-mid', 'a-old']);
  });

  it('respects the limit argument', () => {
    seedAlert({ id: 'a-1', createdAt: '2026-06-01T00:00:00.000Z' });
    seedAlert({ id: 'a-2', createdAt: '2026-06-02T00:00:00.000Z' });
    seedAlert({ id: 'a-3', createdAt: '2026-06-03T00:00:00.000Z' });

    const alerts = listCompetitorAlerts(WS_ID, 2);

    // limit caps the count; the two newest survive.
    expect(alerts).toHaveLength(2);
    expect(alerts.map(a => a.id)).toEqual(['a-3', 'a-2']);
  });

  it('is workspace-scoped — a second workspace\'s alerts are not returned', () => {
    seedAlert({ id: 'mine', workspaceId: WS_ID, createdAt: '2026-06-05T00:00:00.000Z' });
    seedAlert({ id: 'theirs', workspaceId: OTHER_WS_ID, createdAt: '2026-06-06T00:00:00.000Z' });

    const alerts = listCompetitorAlerts(WS_ID);

    expect(alerts.map(a => a.id)).toEqual(['mine']); // proves exactly one row (non-empty)
    expect(alerts.every(a => a.workspaceId === WS_ID)).toBe(true); // every-ok — prior assertion guarantees length 1
  });

  it('returns an empty array when the workspace has no alerts', () => {
    expect(listCompetitorAlerts(WS_ID)).toEqual([]);
  });

  it('maps optional numeric columns onto the CompetitorAlert store shape', () => {
    seedAlert({
      id: 'shaped',
      alertType: 'keyword_gained',
      keyword: 'metal roofing',
      previousPosition: 9,
      currentPosition: 3,
      positionChange: 6,
      volume: 1200,
      severity: 'critical',
      snapshotDate: '2026-06-15',
      createdAt: '2026-06-15T00:00:00.000Z',
    });

    const [alert] = listCompetitorAlerts(WS_ID);

    expect(alert).toMatchObject({
      id: 'shaped',
      workspaceId: WS_ID,
      alertType: 'keyword_gained',
      keyword: 'metal roofing',
      previousPosition: 9,
      currentPosition: 3,
      positionChange: 6,
      volume: 1200,
      severity: 'critical',
      snapshotDate: '2026-06-15',
    });
  });
});
