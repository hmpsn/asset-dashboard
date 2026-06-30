import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createEphemeralTestContext } from '../integration/helpers.js';
import { seedWorkspace } from '../fixtures/workspace-seed.js';
import { computeROI } from '../../server/roi.js';
import { updateWorkspace } from '../../server/workspaces.js';
import { upsertPageKeywordsBatch } from '../../server/page-keywords.js';
import { saveGa4Snapshot } from '../../server/ga4-snapshots.js';
import { setWorkspaceFlagOverride } from '../../server/feature-flags.js';

const ctx = createEphemeralTestContext(import.meta.url);
let wsId: string;
let cleanup: () => void;

beforeAll(async () => {
  await ctx.startServer();
  const s = seedWorkspace();
  wsId = s.workspaceId;
  cleanup = s.cleanup;
  // Seed page_keywords so computeROI() != null.
  upsertPageKeywordsBatch(wsId, [{
    pagePath: '/services', pageTitle: 'Services', primaryKeyword: 'dentist near me',
    secondaryKeywords: [], clicks: 100, impressions: 1000, cpc: 3.5,
  }]);
  // Seed pinned eventConfig so aggregatePinnedOutcomes sums the pinned event.
  updateWorkspace(wsId, { eventConfig: [
    { eventName: 'phone_call', displayName: 'Calls', pinned: true },
  ] });
});
afterAll(async () => {
  cleanup();
  await ctx.stopServer();
});

describe('computeROI outcomeVerdict (flag-gated, estimate_ga4)', () => {
  it('omits outcomeVerdict when outcomeValue is unset (legacy byte-identical)', () => {
    setWorkspaceFlagOverride('the-issue-client-spine', wsId, true);
    expect(computeROI(wsId)?.outcomeVerdict).toBeUndefined();
  });

  it('omits outcomeVerdict when the flag is OFF even if outcomeValue is set', () => {
    setWorkspaceFlagOverride('the-issue-client-spine', wsId, false);
    updateWorkspace(wsId, { outcomeValue: { valuePerOutcome: 800, unitLabel: 'new patient', currency: 'USD', basis: 'agency_estimate', monthlyRetainer: 1500 } });
    saveGa4Snapshot({ workspaceId: wsId, capturedAt: new Date().toISOString(), totalConversions: 14, totalUsers: 200, byEvent: [{ eventName: 'phone_call', conversions: 14, users: 200, rate: 7 }] });
    expect(computeROI(wsId)?.outcomeVerdict).toBeUndefined();
  });

  it('hydrates outcomeVerdict (estimate_ga4) when flag ON + outcomeValue + GA4 conversions present', () => {
    setWorkspaceFlagOverride('the-issue-client-spine', wsId, true);
    const v = computeROI(wsId)?.outcomeVerdict;
    expect(v?.provenance).toBe('estimate_ga4');
    expect(v?.outcomeCount).toBe(14);
    expect(v?.estimatedValue).toBe(14 * 800);
    expect(v?.monthlyRetainer).toBe(1500);
    expect(v?.baseline.state).toBeDefined();
  });

  it('clears the per-workspace override at the end (no leakage)', () => {
    setWorkspaceFlagOverride('the-issue-client-spine', wsId, null);
    expect(computeROI(wsId)?.outcomeVerdict).toBeUndefined();
  });
});
