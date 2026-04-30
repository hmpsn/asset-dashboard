/**
 * Unit tests for server/workspace-metrics-snapshots.ts — Phase 2.5c.
 *
 * Covers the pure snapshot read/write/anchor surface. The async
 * `recordWeeklyBriefingSnapshot` orchestrator (which calls into GSC,
 * audit, ROI) is exercised via integration tests in briefing-cron;
 * here we focus on the synchronous DB layer.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import db from '../../server/db/index.js';
import {
  recordSnapshot,
  getSnapshots,
  getBestValueSinceDate,
  pruneOld,
} from '../../server/workspace-metrics-snapshots.js';

const WS = `ws_snapshots_test_${Math.random().toString(36).slice(2, 8)}`;

const DAY_MS = 24 * 60 * 60 * 1000;

function dateKey(daysAgo: number): string {
  const d = new Date(Date.now() - daysAgo * DAY_MS);
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, '0');
  const day = String(d.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

describe('workspace-metrics-snapshots', () => {
  beforeEach(() => {
    // Isolate per-test state by deleting the workspace's rows.
    db.prepare('DELETE FROM workspace_metrics_snapshots WHERE workspace_id = ?').run(WS);
  });

  describe('recordSnapshot + getSnapshots', () => {
    it('persists a snapshot and reads it back', () => {
      const snap = recordSnapshot({
        workspaceId: WS,
        snapshotDate: '2026-04-20',
        metrics: { totalClicks: 100, totalImpressions: 5000, avgPosition: 12.5, auditScore: 85, organicTrafficValue: 1200 },
      });
      expect(snap.workspaceId).toBe(WS);
      expect(snap.snapshotDate).toBe('2026-04-20');
      expect(snap.totalClicks).toBe(100);
      expect(snap.auditScore).toBe(85);

      const list = getSnapshots(WS, 90);
      expect(list).toHaveLength(1);
      expect(list[0].snapshotDate).toBe('2026-04-20');
    });

    it('upserts on (workspaceId, snapshotDate) — re-records overwrite', () => {
      recordSnapshot({ workspaceId: WS, snapshotDate: '2026-04-20', metrics: { totalClicks: 50 } });
      const second = recordSnapshot({ workspaceId: WS, snapshotDate: '2026-04-20', metrics: { totalClicks: 75 } });
      expect(second.totalClicks).toBe(75);

      const list = getSnapshots(WS, 90);
      expect(list).toHaveLength(1);
    });

    it('persists nulls for unset metrics', () => {
      recordSnapshot({
        workspaceId: WS,
        snapshotDate: '2026-04-20',
        metrics: { totalClicks: 100 }, // others omitted
      });
      const list = getSnapshots(WS, 90);
      expect(list[0].totalClicks).toBe(100);
      expect(list[0].totalImpressions).toBeNull();
      expect(list[0].avgPosition).toBeNull();
      expect(list[0].auditScore).toBeNull();
      expect(list[0].organicTrafficValue).toBeNull();
    });

    it('returns snapshots newest-first', () => {
      recordSnapshot({ workspaceId: WS, snapshotDate: dateKey(7), metrics: { totalClicks: 50 } });
      recordSnapshot({ workspaceId: WS, snapshotDate: dateKey(14), metrics: { totalClicks: 30 } });
      recordSnapshot({ workspaceId: WS, snapshotDate: dateKey(0), metrics: { totalClicks: 100 } });

      const list = getSnapshots(WS, 90);
      // Snapshots in descending date order
      expect(list[0].totalClicks).toBe(100);
      expect(list[1].totalClicks).toBe(50);
      expect(list[2].totalClicks).toBe(30);
    });
  });

  describe('getBestValueSinceDate', () => {
    it('returns null when window has fewer than 2 snapshots', () => {
      recordSnapshot({ workspaceId: WS, snapshotDate: dateKey(7), metrics: { totalClicks: 50 } });
      expect(getBestValueSinceDate(WS, 'total_clicks', 100)).toBeNull();
    });

    it('returns the most recent prior reading that beat current (current isnt a new best)', () => {
      // When current is below a recent prior reading, the anchor is the date
      // of that prior reading. Phrasing reads naturally either way: "best
      // week since {date}" can frame the past peak whether current beats
      // it or not.
      recordSnapshot({ workspaceId: WS, snapshotDate: dateKey(7), metrics: { totalClicks: 100 } });
      recordSnapshot({ workspaceId: WS, snapshotDate: dateKey(14), metrics: { totalClicks: 200 } });
      const r = getBestValueSinceDate(WS, 'total_clicks', 50);
      expect(r).not.toBeNull();
      expect(r!.sinceDate).toBe(dateKey(7));
    });

    it('returns null when current beats all prior AND window < 4 rows (insufficient history)', () => {
      recordSnapshot({ workspaceId: WS, snapshotDate: dateKey(7), metrics: { totalClicks: 50 } });
      recordSnapshot({ workspaceId: WS, snapshotDate: dateKey(14), metrics: { totalClicks: 200 } });
      recordSnapshot({ workspaceId: WS, snapshotDate: dateKey(21), metrics: { totalClicks: 80 } });
      // current = 250 — beats EVERY prior; only 3 rows < 4-week threshold
      expect(getBestValueSinceDate(WS, 'total_clicks', 250)).toBeNull();
    });

    it('returns earliest row when current beats all prior AND window >= 4 rows', () => {
      recordSnapshot({ workspaceId: WS, snapshotDate: dateKey(7), metrics: { totalClicks: 50 } });
      recordSnapshot({ workspaceId: WS, snapshotDate: dateKey(14), metrics: { totalClicks: 100 } });
      recordSnapshot({ workspaceId: WS, snapshotDate: dateKey(21), metrics: { totalClicks: 80 } });
      recordSnapshot({ workspaceId: WS, snapshotDate: dateKey(28), metrics: { totalClicks: 60 } });
      const r = getBestValueSinceDate(WS, 'total_clicks', 250);
      expect(r).not.toBeNull();
      // listInWindow sorts ASC by date; rows[0] is the earliest (28d ago)
      expect(r!.sinceDate).toBe(dateKey(28));
    });

    it('anchors to the most recent prior snapshot that beat current', () => {
      // 5 snapshots, current=150. Most recent that beat 150 = the row at 14d ago (200).
      recordSnapshot({ workspaceId: WS, snapshotDate: dateKey(7), metrics: { totalClicks: 80 } });
      recordSnapshot({ workspaceId: WS, snapshotDate: dateKey(14), metrics: { totalClicks: 200 } });
      recordSnapshot({ workspaceId: WS, snapshotDate: dateKey(21), metrics: { totalClicks: 50 } });
      recordSnapshot({ workspaceId: WS, snapshotDate: dateKey(28), metrics: { totalClicks: 90 } });
      recordSnapshot({ workspaceId: WS, snapshotDate: dateKey(35), metrics: { totalClicks: 70 } });
      const r = getBestValueSinceDate(WS, 'total_clicks', 150);
      expect(r).not.toBeNull();
      expect(r!.sinceDate).toBe(dateKey(14));
    });

    it('uses lower-is-better comparator for avg_position', () => {
      recordSnapshot({ workspaceId: WS, snapshotDate: dateKey(7), metrics: { avgPosition: 12 } });
      recordSnapshot({ workspaceId: WS, snapshotDate: dateKey(14), metrics: { avgPosition: 5 } });
      recordSnapshot({ workspaceId: WS, snapshotDate: dateKey(21), metrics: { avgPosition: 15 } });
      recordSnapshot({ workspaceId: WS, snapshotDate: dateKey(28), metrics: { avgPosition: 20 } });
      recordSnapshot({ workspaceId: WS, snapshotDate: dateKey(35), metrics: { avgPosition: 25 } });
      // current = 8 (good); most recent snapshot with avg_position < 8 was 14d ago (5)
      const r = getBestValueSinceDate(WS, 'avg_position', 8);
      expect(r!.sinceDate).toBe(dateKey(14));
    });

    it('skips snapshots where the metric is null', () => {
      recordSnapshot({ workspaceId: WS, snapshotDate: dateKey(7), metrics: { totalClicks: 50 } });
      recordSnapshot({ workspaceId: WS, snapshotDate: dateKey(14), metrics: { /* totalClicks omitted */ } });
      recordSnapshot({ workspaceId: WS, snapshotDate: dateKey(21), metrics: { totalClicks: 200 } });
      recordSnapshot({ workspaceId: WS, snapshotDate: dateKey(28), metrics: { totalClicks: 30 } });
      recordSnapshot({ workspaceId: WS, snapshotDate: dateKey(35), metrics: { totalClicks: 10 } });
      // current = 150; beats most recent comparable (50, 30, 10) but not 200
      const r = getBestValueSinceDate(WS, 'total_clicks', 150);
      expect(r!.sinceDate).toBe(dateKey(21));
    });
  });

  describe('pruneOld', () => {
    it('deletes snapshots older than retentionDays', () => {
      recordSnapshot({ workspaceId: WS, snapshotDate: dateKey(7), metrics: { totalClicks: 50 } });
      recordSnapshot({ workspaceId: WS, snapshotDate: dateKey(95), metrics: { totalClicks: 100 } });
      const deleted = pruneOld(WS, 90);
      expect(deleted).toBe(1);
      const list = getSnapshots(WS, 365);
      expect(list).toHaveLength(1);
      expect(list[0].snapshotDate).toBe(dateKey(7));
    });

    it('returns 0 when nothing is old enough to prune', () => {
      recordSnapshot({ workspaceId: WS, snapshotDate: dateKey(7), metrics: { totalClicks: 50 } });
      expect(pruneOld(WS, 90)).toBe(0);
    });
  });
});
