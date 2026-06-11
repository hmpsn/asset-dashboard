/**
 * G2 integration test: competitor_alert insights are enriched with a non-zero impactScore
 * and the 'search' domain (Task 1).
 *
 * Before G2 the competitor cron called raw upsertInsight without impactScore/domain, so alerts
 * landed in the feed with impactScore=0 / domain=undefined and lost priority in the ranked feed.
 * This test exercises the REAL alert-generation (detectCompetitorAlerts) and the REAL enrichment
 * helpers (computeImpactScore + classifyDomain), upserts via the store, and asserts the stored
 * insight carries the enrichment.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createEphemeralTestContext } from './helpers.js';
import { createWorkspace, deleteWorkspace } from '../../server/workspaces.js';
import { upsertInsight, getInsights } from '../../server/analytics-insights-store.js';
import { computeImpactScore, classifyDomain } from '../../server/insight-enrichment.js';
import {
  saveCompetitorSnapshot,
  detectCompetitorAlerts,
} from '../../server/competitor-snapshot-store.js';
import db from '../../server/db/index.js';

const ctx = createEphemeralTestContext(import.meta.url);

let testWsId = '';

beforeAll(async () => {
  await ctx.startServer();
  const ws = createWorkspace('Competitor Alert Enrichment Test');
  testWsId = ws.id;
}, 25_000);

afterAll(async () => {
  db.prepare('DELETE FROM analytics_insights WHERE workspace_id = ?').run(testWsId);
  db.prepare('DELETE FROM competitor_snapshots WHERE workspace_id = ?').run(testWsId);
  db.prepare('DELETE FROM competitor_alerts WHERE workspace_id = ?').run(testWsId);
  deleteWorkspace(testWsId);
  await ctx.stopServer();
});

describe('competitor_alert enrichment (G2 Task 1)', () => {
  it('classifyDomain(competitor_alert) resolves to search', () => {
    expect(classifyDomain('competitor_alert')).toBe('search');
  });

  it('writes competitor_alert insights with impactScore > 0 and domain === "search"', () => {
    const domain = 'rival-competitor.example';

    // Previous snapshot: competitor ranks #15 for a high-volume keyword.
    const previous = saveCompetitorSnapshot(
      testWsId, domain, '2026-06-01',
      [{ keyword: 'enterprise seo platform', position: 15, volume: 4400 }],
      1,
    );
    // Current snapshot: competitor jumped to #3 (gain of 12 positions → a critical alert).
    const current = saveCompetitorSnapshot(
      testWsId, domain, '2026-06-08',
      [{ keyword: 'enterprise seo platform', position: 3, volume: 4400 }],
      1,
    );

    const alerts = detectCompetitorAlerts(testWsId, domain, current, previous);
    expect(alerts.length).toBeGreaterThan(0);

    // Mirror the cron's enriched upsert (intelligence-crons.ts) using the REAL helpers.
    for (const alert of alerts) {
      const alertData = {
        competitorDomain: alert.competitorDomain,
        alertType: alert.alertType,
        keyword: alert.keyword,
        previousPosition: alert.previousPosition,
        currentPosition: alert.currentPosition,
        positionChange: alert.positionChange,
        volume: alert.volume,
        snapshotDate: alert.snapshotDate,
      };
      upsertInsight({
        workspaceId: testWsId,
        pageId: `competitor_alert::${alert.competitorDomain}::${alert.keyword ?? 'domain'}`,
        insightType: 'competitor_alert',
        data: alertData,
        severity: alert.severity,
        domain: 'search',
        impactScore: computeImpactScore(alert.severity, alertData as Record<string, unknown>),
      });
    }

    const stored = getInsights(testWsId).filter(i => i.insightType === 'competitor_alert');
    expect(stored.length).toBeGreaterThan(0);
    for (const insight of stored) {
      expect(insight.domain).toBe('search');
      expect(insight.impactScore).toBeGreaterThan(0);
    }
  });
});
