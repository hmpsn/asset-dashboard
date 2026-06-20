/**
 * D4 — GA4 conversion snapshot aggregation + engagement baseline + backfill acceptance (P0.1/P0.2).
 *
 * Consumes the canonical Lane A modules: server/ga4-snapshots.ts (saveGa4Snapshot /
 * loadGa4SnapshotHistory / getEarliestGa4Snapshot) + server/the-issue-outcome.ts
 * (computeOutcomeBaseline / backfillGa4SnapshotsFromHistory).
 */
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';

// Mock GA4 at the module boundary so the in-process backfill never makes a real network call.
// The magic property id 'GA4_ERROR' throws so the FM-2 honest-degradation path is exercised.
vi.mock('../../server/google-analytics.js', () => ({
  getGA4Conversions: vi.fn(async (propertyId: string) => {
    if (propertyId === 'GA4_ERROR') throw new Error('GA4 unavailable');
    return [
      { eventName: 'phone_call', conversions: 7, users: 50, rate: 3 },
      { eventName: 'form_submit', conversions: 2, users: 12, rate: 1 },
    ];
  }),
}));

import { createEphemeralTestContext } from './helpers.js';
import { seedWorkspace } from '../fixtures/workspace-seed.js';
import { saveGa4Snapshot, loadGa4SnapshotHistory, getEarliestGa4Snapshot } from '../../server/ga4-snapshots.js';
import { computeOutcomeBaseline, backfillGa4SnapshotsFromHistory } from '../../server/the-issue-outcome.js';
import { getWorkspace, updateWorkspace } from '../../server/workspaces.js';

const ctx = createEphemeralTestContext(import.meta.url);
const cleanups: Array<() => void> = [];

beforeAll(async () => {
  await ctx.startServer();
});
afterAll(async () => {
  for (const c of cleanups) c();
  await ctx.stopServer();
});

describe('snapshot round-trip + boundary parsing', () => {
  it('round-trips byEvent at the boundary; rate stays a percentage (never ×100)', () => {
    const s = seedWorkspace(); cleanups.push(s.cleanup);
    saveGa4Snapshot({ workspaceId: s.workspaceId, capturedAt: '2026-03-01T00:00:00.000Z', totalConversions: 9, totalUsers: 62, byEvent: [{ eventName: 'phone_call', conversions: 7, users: 50, rate: 3 }] });
    const hist = loadGa4SnapshotHistory(s.workspaceId);
    expect(hist[0].byEvent[0].rate).toBe(3);
  });
});

describe('90-day prune guards the anchor', () => {
  it('removes far-old rolling rows but never the earliest (anchor) row', () => {
    const s = seedWorkspace(); cleanups.push(s.cleanup);
    // Earliest anchor far in the past.
    saveGa4Snapshot({ workspaceId: s.workspaceId, capturedAt: '2026-01-01T00:00:00.000Z', totalConversions: 6, totalUsers: 40, byEvent: [] });
    // A mid-old rolling row also older than 90 days back from now.
    saveGa4Snapshot({ workspaceId: s.workspaceId, capturedAt: '2026-01-15T00:00:00.000Z', totalConversions: 8, totalUsers: 50, byEvent: [] });
    // A fresh row triggers the prune.
    saveGa4Snapshot({ workspaceId: s.workspaceId, capturedAt: new Date().toISOString(), totalConversions: 20, totalUsers: 90, byEvent: [] });
    // Anchor survives.
    expect(getEarliestGa4Snapshot(s.workspaceId)?.capturedAt).toBe('2026-01-01T00:00:00.000Z');
  });
});

describe('computeOutcomeBaseline establishing → ready', () => {
  it('flips establishing → ready once a createdAt-anchored snapshot exists', () => {
    const s = seedWorkspace(); cleanups.push(s.cleanup);
    const ws = getWorkspace(s.workspaceId)!;
    expect(computeOutcomeBaseline(ws).state).toBe('establishing');
    // No events pinned on this fresh workspace → the baseline aggregates byEvent via the all-events
    // fallback, so byEvent must carry the conversions (the raw totalConversions column is not the
    // baseline source post-fix — it is re-aggregated through the pinned/fallback filter).
    saveGa4Snapshot({ workspaceId: ws.id, capturedAt: ws.createdAt, totalConversions: 5, totalUsers: 30, byEvent: [
      { eventName: 'form_submit', conversions: 5, users: 30, rate: 2 },
    ] });
    const b = computeOutcomeBaseline(getWorkspace(ws.id)!);
    expect(b.state).toBe('ready');
    expect(b.baselineConversions).toBe(5);
    expect(b.engagementStart).toBe(ws.createdAt);
  });
});

describe('backfillGa4SnapshotsFromHistory', () => {
  it('seeds the engagement anchor from the GA4 historical mock', async () => {
    const s = seedWorkspace({ ga4PropertyId: '999000' }); cleanups.push(s.cleanup);
    expect(getEarliestGa4Snapshot(s.workspaceId)).toBeNull();
    await backfillGa4SnapshotsFromHistory(getWorkspace(s.workspaceId)!);
    const earliest = getEarliestGa4Snapshot(s.workspaceId);
    expect(earliest?.totalConversions).toBe(9); // 7 + 2 from the mock
    // The anchor is stamped at createdAt, not "now".
    expect(earliest?.capturedAt).toBe(getWorkspace(s.workspaceId)!.createdAt);
  });

  it('on GA4 error the baseline stays establishing (FM-2, never fabricated)', async () => {
    const s = seedWorkspace(); cleanups.push(s.cleanup);
    updateWorkspace(s.workspaceId, { ga4PropertyId: 'GA4_ERROR' });
    await expect(backfillGa4SnapshotsFromHistory(getWorkspace(s.workspaceId)!)).resolves.not.toThrow();
    expect(computeOutcomeBaseline(getWorkspace(s.workspaceId)!).state).toBe('establishing');
  });
});
