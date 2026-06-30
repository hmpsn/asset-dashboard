import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';

// broadcastToWorkspace throws when called before the WS server's setBroadcast() runs (no server
// boots in this direct-call test). Mock it so the scan's broadcast is a no-op.
vi.mock('../../server/broadcast.js', () => ({
  setBroadcast: vi.fn(),
  broadcast: vi.fn(),
  broadcastToWorkspace: vi.fn(),
}));

import {
  classifyStaleSentRec,
  STALE_SENT_REC_THRESHOLD_DAYS,
  scanWorkspaceStaleness,
  runSentRecStalenessScan,
} from '../../server/recommendation-staleness.js';
import { seedWorkspace } from '../fixtures/workspace-seed.js';
import { saveRecommendations } from '../../server/recommendations.js';
import { countActivityByType } from '../../server/activity-log.js';
import { setWorkspaceFlagOverride } from '../../server/feature-flags.js';
import db from '../../server/db/index.js';
import type { Recommendation } from '../../shared/types/recommendations.js';

describe('classifyStaleSentRec', () => {
  const now = Date.parse('2026-06-18T00:00:00.000Z');

  it('returns null for a sent rec younger than the threshold', () => {
    const sentAt = new Date(now - 5 * 24 * 60 * 60 * 1000).toISOString();
    expect(classifyStaleSentRec({ clientStatus: 'sent', sentAt }, now)).toBeNull();
  });

  it('returns a "stale_sent" nudge for a sent rec past the threshold with no response', () => {
    const sentAt = new Date(now - (STALE_SENT_REC_THRESHOLD_DAYS + 1) * 24 * 60 * 60 * 1000).toISOString();
    const result = classifyStaleSentRec({ clientStatus: 'sent', sentAt }, now);
    expect(result).toEqual({ nudgeKind: 'stale_sent', ageDays: STALE_SENT_REC_THRESHOLD_DAYS + 1 });
  });

  it('returns null once the client has responded (approved/declined/discussing)', () => {
    const sentAt = new Date(now - 30 * 24 * 60 * 60 * 1000).toISOString();
    expect(classifyStaleSentRec({ clientStatus: 'approved', sentAt }, now)).toBeNull();
    expect(classifyStaleSentRec({ clientStatus: 'declined', sentAt }, now)).toBeNull();
    expect(classifyStaleSentRec({ clientStatus: 'discussing', sentAt }, now)).toBeNull();
  });

  it('returns null when sentAt is absent (never actually sent)', () => {
    expect(classifyStaleSentRec({ clientStatus: 'sent' }, now)).toBeNull();
  });
});

describe('scanWorkspaceStaleness', () => {
  const now = Date.parse('2026-06-18T00:00:00.000Z');
  const oldSent = new Date(now - 20 * 24 * 60 * 60 * 1000).toISOString();

  it('returns a stale_sent nudge for each old unanswered sent rec', () => {
    const recs = [
      { id: 'r1', title: 'Fix decay on /pricing', clientStatus: 'sent', sentAt: oldSent, affectedPages: ['/pricing'] },
      { id: 'r2', title: 'Recent send', clientStatus: 'sent', sentAt: new Date(now - 2 * 86400000).toISOString(), affectedPages: ['/about'] },
    ] as any;
    const nudges = scanWorkspaceStaleness(recs, now);
    expect(nudges).toHaveLength(1);
    expect(nudges[0]).toMatchObject({ recId: 'r1', nudgeKind: 'stale_sent', ageDays: 20 });
  });

  it('flags a sent rec as superseded when a newer active rec covers the same page', () => {
    const recs = [
      { id: 'r1', title: 'Old sent for /pricing', clientStatus: 'sent', sentAt: oldSent, affectedPages: ['/pricing'], createdAt: oldSent },
      { id: 'r2', title: 'Newer active for /pricing', clientStatus: 'system', lifecycle: 'active', affectedPages: ['/pricing'], createdAt: new Date(now).toISOString() },
    ] as any;
    const nudges = scanWorkspaceStaleness(recs, now);
    const superseded = nudges.find(n => n.nudgeKind === 'superseded');
    expect(superseded).toMatchObject({ recId: 'r1', nudgeKind: 'superseded' });
  });

  it('returns an empty array when nothing needs attention', () => {
    expect(scanWorkspaceStaleness([], now)).toEqual([]);
  });
});

// FIX 1 — type-filtered dedup. Proves the dedup read finds a rec_nudge_stale row even when it
// sits behind >500 UNRELATED activity rows. With the old listActivity(ws, 500) top-N-across-
// ALL-types read, the nudge fell past position 500 and was re-written every tick; the type-scoped
// listActivityByType cap applies only to rec_nudge_stale rows, so it stays found.
describe('runSentRecStalenessScan — dedup is robust to high unrelated activity volume', () => {
  let wsId: string;
  let cleanup: () => void;

  beforeAll(() => {
    const seeded = seedWorkspace();
    wsId = seeded.workspaceId;
    cleanup = seeded.cleanup;

    // One old sent rec that classifies as stale_sent (>14d, no client response).
    const oldSent = new Date(Date.now() - 20 * 24 * 60 * 60 * 1000).toISOString();
    const recs: Recommendation[] = [{
      id: 'rec-stale-vol', type: 'content_refresh', title: 'Old sent rec', description: 'd', insight: 'i',
      impact: 'high', effort: 'low', impactScore: 70, priority: 'fix_now', actionType: 'manual',
      trafficAtRisk: 0, impressionsAtRisk: 0, estimatedGain: '', workspaceId: wsId,
      affectedPages: ['/pricing'], source: 'test',
      clientStatus: 'sent', sentAt: oldSent, lifecycle: 'active',
      status: 'pending', createdAt: oldSent, updatedAt: oldSent,
    } as unknown as Recommendation];
    saveRecommendations({ workspaceId: wsId, generatedAt: oldSent, recommendations: recs, summary: {
      fixNow: 0, fixSoon: 0, fixLater: 0, ongoing: 0, totalImpactScore: 0, trafficAtRisk: 0,
      totalOpportunityValue: 0, actionableOpportunityValue: 0, topRecommendationId: null,
    } });

    // Insert the rec_nudge_stale dedup row FIRST (oldest created_at, but still within the 14d
    // dedup window: 3 days ago), then bury it under 600 unrelated rows with NEWER timestamps.
    // We insert directly (bypassing addActivity's global 500-row prune) to control created_at and
    // guarantee the nudge sits behind >500 unrelated rows in DESC-ordered reads.
    const nudgeAt = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString();
    const ins = db.prepare(`
      INSERT INTO activity_log (id, workspace_id, type, title, description, metadata, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `);
    ins.run('act-nudge-vol', wsId, 'rec_nudge_stale', 'stale nudge', 'desc',
      JSON.stringify({ recId: 'rec-stale-vol', nudgeKind: 'stale_sent', ageDays: 20 }), nudgeAt);
    const insMany = db.transaction(() => {
      for (let i = 0; i < 600; i++) {
        const at = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000 + i * 1000).toISOString();
        ins.run(`act-portal-${i}`, wsId, 'portal_session', 'session', null, null, at);
      }
    });
    insMany();

    setWorkspaceFlagOverride('strategy-staleness-scan', wsId, true);
  });

  afterAll(() => {
    setWorkspaceFlagOverride('strategy-staleness-scan', wsId, null);
    db.prepare('DELETE FROM activity_log WHERE workspace_id = ?').run(wsId);
    db.prepare('DELETE FROM recommendation_sets WHERE workspace_id = ?').run(wsId);
    cleanup();
  });

  it('does NOT re-write a nudge that sits behind >500 unrelated activity rows', () => {
    expect(countActivityByType(wsId, 'rec_nudge_stale', 30)).toBe(1);
    const result = runSentRecStalenessScan();
    expect(result.workspacesScanned).toBeGreaterThanOrEqual(1);
    // The pre-existing nudge is found (deduped) → no new rec_nudge_stale row written.
    expect(countActivityByType(wsId, 'rec_nudge_stale', 30)).toBe(1);
  });
});
