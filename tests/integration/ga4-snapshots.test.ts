import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createEphemeralTestContext } from './helpers.js';
import { seedWorkspace } from '../fixtures/workspace-seed.js';
import { saveGa4Snapshot, loadGa4SnapshotHistory, getEarliestGa4Snapshot } from '../../server/ga4-snapshots.js';

const ctx = createEphemeralTestContext(import.meta.url);
let wsId: string;
let cleanup: () => void;

beforeAll(async () => {
  await ctx.startServer();
  const s = seedWorkspace();
  wsId = s.workspaceId;
  cleanup = s.cleanup;
});
afterAll(async () => {
  cleanup();
  await ctx.stopServer();
});

describe('ga4_conversion_snapshots store', () => {
  it('round-trips a snapshot through the typed mapper (byEvent parsed via parseJsonSafeArray)', () => {
    saveGa4Snapshot({
      workspaceId: wsId, capturedAt: '2026-02-01T00:00:00.000Z',
      totalConversions: 14, totalUsers: 200,
      byEvent: [{ eventName: 'phone_call', conversions: 8, users: 100, rate: 4 }],
    });
    const hist = loadGa4SnapshotHistory(wsId);
    expect(hist).toHaveLength(1);
    expect(hist[0].byEvent[0].eventName).toBe('phone_call');
    expect(hist[0].byEvent[0].rate).toBe(4); // rate stays a percentage, never ×100
    expect(hist[0].totalConversions).toBe(14);
  });
  it('getEarliestGa4Snapshot returns the createdAt-anchored row for the baseline', () => {
    saveGa4Snapshot({ workspaceId: wsId, capturedAt: '2026-01-01T00:00:00.000Z', totalConversions: 6, totalUsers: 80, byEvent: [] });
    expect(getEarliestGa4Snapshot(wsId)?.totalConversions).toBe(6);
  });
  it('90-day prune never deletes the earliest (anchor) row', () => {
    // Insert a brand-new snapshot now — the prune cutoff is 90 days back, so the
    // far-old anchor (2026-01-01) survives because it is the earliest row.
    saveGa4Snapshot({ workspaceId: wsId, capturedAt: new Date().toISOString(), totalConversions: 20, totalUsers: 300, byEvent: [] });
    expect(getEarliestGa4Snapshot(wsId)?.totalConversions).toBe(6);
    expect(getEarliestGa4Snapshot(wsId)?.capturedAt).toBe('2026-01-01T00:00:00.000Z');
  });
});
