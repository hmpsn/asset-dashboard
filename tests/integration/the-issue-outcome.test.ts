import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createEphemeralTestContext } from './helpers.js';
import { seedWorkspace } from '../fixtures/workspace-seed.js';
import { aggregatePinnedOutcomes, computeOutcomeBaseline } from '../../server/the-issue-outcome.js';
import { saveGa4Snapshot } from '../../server/ga4-snapshots.js';
import { updateWorkspace, getWorkspace } from '../../server/workspaces.js';

const ctx = createEphemeralTestContext(import.meta.url);
let wsId: string;
let cleanup: () => void;

beforeAll(async () => {
  await ctx.startServer();
  const s = seedWorkspace();
  wsId = s.workspaceId;
  cleanup = s.cleanup;
  updateWorkspace(wsId, { eventConfig: [
    { eventName: 'phone_call', displayName: 'Calls', pinned: true },
    { eventName: 'form_submit', displayName: 'Form fills', pinned: true },
    { eventName: 'scroll', displayName: 'Scroll', pinned: false },
  ] });
});
afterAll(async () => {
  cleanup();
  await ctx.stopServer();
});

describe('pinned-event outcome aggregation', () => {
  it('sums ONLY pinned eventConfig events and labels units by displayName', () => {
    const byEvent = [
      { eventName: 'phone_call', conversions: 8, users: 60, rate: 4 },
      { eventName: 'form_submit', conversions: 6, users: 40, rate: 3 },
      { eventName: 'scroll', conversions: 999, users: 900, rate: 50 },
    ];
    const agg = aggregatePinnedOutcomes(getWorkspace(wsId)!, byEvent);
    expect(agg.totalConversions).toBe(14);
    expect(agg.units.map(u => u.label)).toEqual(['Calls', 'Form fills']);
    expect(agg.usedFallback).toBe(false);
  });
  it('falls back to ALL key-events when no events are pinned', () => {
    const s2 = seedWorkspace();
    const agg = aggregatePinnedOutcomes(getWorkspace(s2.workspaceId)!, [{ eventName: 'x', conversions: 3, users: 3, rate: 1 }]);
    expect(agg.totalConversions).toBe(3);
    expect(agg.usedFallback).toBe(true);
    s2.cleanup();
  });
});

describe('engagement baseline anchor', () => {
  it('state=establishing with null baseline when no snapshot at/after createdAt', () => {
    const s4 = seedWorkspace();
    const b = computeOutcomeBaseline(getWorkspace(s4.workspaceId)!);
    expect(b.state).toBe('establishing');
    expect(b.baselineConversions).toBeNull();
    s4.cleanup();
  });
  it('state=ready; baselineConversions re-aggregated through the PINNED filter, not the raw all-events total', () => {
    // The anchor snapshot's all-events total is 105 (4 + 2 + 99) but only phone_call + form_submit
    // are pinned on wsId. The baseline MUST be the pinned-only 6 so baselineDeltaCount compares the
    // pinned-vs-pinned like-for-like — using the raw all-events 105 would invert "vs. when we started".
    saveGa4Snapshot({ workspaceId: wsId, capturedAt: getWorkspace(wsId)!.createdAt, totalConversions: 105, totalUsers: 90, byEvent: [
      { eventName: 'phone_call', conversions: 4, users: 30, rate: 2 },
      { eventName: 'form_submit', conversions: 2, users: 15, rate: 1 },
      { eventName: 'scroll', conversions: 99, users: 90, rate: 40 },
    ] });
    const b = computeOutcomeBaseline(getWorkspace(wsId)!);
    expect(b.state).toBe('ready');
    expect(b.baselineConversions).toBe(6); // pinned-only (4 + 2), NOT the all-events 105
    expect(b.engagementStart).toBe(getWorkspace(wsId)!.createdAt);
  });
});
