/**
 * P1 (IA v2) — real month-over-month outcome delta rides the public ROI payload.
 *
 * Exercises the PUBLIC route GET /api/public/roi/:id (NOT the admin GET) so a regression in the
 * `priorPeriodCount` serialization is caught on the real read path computeROI() → res.json(roi).
 *
 * Two scenarios:
 *  1. Two GA4 conversion snapshots (prior @ ~30d ago: 5 pinned conversions; latest today: 12)
 *     → priorPeriodCount === 5, and outcomeCount − priorPeriodCount === 7 (+7 MoM).
 *  2. Single snapshot → priorPeriodCount === null (honest "establishing", never fabricated).
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createEphemeralTestContext } from './helpers.js';
import { seedWorkspace } from '../fixtures/workspace-seed.js';
import { updateWorkspace } from '../../server/workspaces.js';
import { upsertPageKeywordsBatch } from '../../server/page-keywords.js';
import { saveGa4Snapshot } from '../../server/ga4-snapshots.js';
import { setWorkspaceFlagOverride } from '../../server/feature-flags.js';

const ctx = createEphemeralTestContext(import.meta.url, { autoPublicAuth: true });
const { api } = ctx;

const PINNED_EVENT = 'form_submit';
let twoSnapWsId: string;
let oneSnapWsId: string;
let outOfWindowWsId: string;
const cleanups: Array<() => void> = [];

function configureOutcomeWorkspace(wsId: string): void {
  upsertPageKeywordsBatch(wsId, [{
    pagePath: '/services', pageTitle: 'Services', primaryKeyword: 'dentist near me',
    secondaryKeywords: [], clicks: 100, impressions: 1000, cpc: 3.5,
  }]);
  updateWorkspace(wsId, {
    outcomeValue: { valuePerOutcome: 800, unitLabel: 'new patient', currency: 'USD', basis: 'agency_estimate', monthlyRetainer: 1500 },
    eventConfig: [{ eventName: PINNED_EVENT, displayName: 'Form fills', pinned: true, outcomeType: 'form_fill' }],
  });
  setWorkspaceFlagOverride('the-issue-client-spine', wsId, true);
  cleanups.push(() => setWorkspaceFlagOverride('the-issue-client-spine', wsId, null));
}

beforeAll(async () => {
  const latestIso = new Date().toISOString();
  const priorIso = new Date(new Date(latestIso).getTime() - 30 * 24 * 60 * 60 * 1000).toISOString();

  // ── Workspace A: two snapshots (prior 5, latest 12) → +7 MoM ──
  const wsA = seedWorkspace(); twoSnapWsId = wsA.workspaceId; cleanups.push(wsA.cleanup);
  configureOutcomeWorkspace(twoSnapWsId);
  // Prior snapshot ~30 days before the latest: 5 conversions for the pinned event.
  saveGa4Snapshot({
    workspaceId: twoSnapWsId, capturedAt: priorIso, totalConversions: 5, totalUsers: 80,
    byEvent: [{ eventName: PINNED_EVENT, conversions: 5, users: 60, rate: 6 }],
  });
  // Latest snapshot today: 12 conversions for the pinned event.
  saveGa4Snapshot({
    workspaceId: twoSnapWsId, capturedAt: latestIso, totalConversions: 12, totalUsers: 200,
    byEvent: [{ eventName: PINNED_EVENT, conversions: 12, users: 150, rate: 8 }],
  });

  // ── Workspace B: single snapshot → priorPeriodCount === null ──
  const wsB = seedWorkspace(); oneSnapWsId = wsB.workspaceId; cleanups.push(wsB.cleanup);
  configureOutcomeWorkspace(oneSnapWsId);
  saveGa4Snapshot({
    workspaceId: oneSnapWsId, capturedAt: latestIso, totalConversions: 9, totalUsers: 120,
    byEvent: [{ eventName: PINNED_EVENT, conversions: 9, users: 100, rate: 7 }],
  });

  // ── Workspace C: two snapshots, but the prior is only ~5 days before the latest — INSIDE history
  // yet OUTSIDE the 15–45-day window. Proves computeROI() applies the window guard on the real read
  // path (not just the unit helper): priorPeriodCount must be null, not the 5-day-old count.
  const fiveDaysBackIso = new Date(new Date(latestIso).getTime() - 5 * 24 * 60 * 60 * 1000).toISOString();
  const wsC = seedWorkspace(); outOfWindowWsId = wsC.workspaceId; cleanups.push(wsC.cleanup);
  configureOutcomeWorkspace(outOfWindowWsId);
  saveGa4Snapshot({
    workspaceId: outOfWindowWsId, capturedAt: fiveDaysBackIso, totalConversions: 6, totalUsers: 90,
    byEvent: [{ eventName: PINNED_EVENT, conversions: 6, users: 70, rate: 6 }],
  });
  saveGa4Snapshot({
    workspaceId: outOfWindowWsId, capturedAt: latestIso, totalConversions: 11, totalUsers: 180,
    byEvent: [{ eventName: PINNED_EVENT, conversions: 11, users: 140, rate: 8 }],
  });

  await ctx.startServer();
});

afterAll(async () => {
  for (const c of cleanups) c();
  await ctx.stopServer();
});

describe('GET /api/public/roi — real month-over-month outcome delta', () => {
  it('carries priorPeriodCount from the ~30-day-prior snapshot and yields a +7 MoM delta', async () => {
    const res = await api(`/api/public/roi/${twoSnapWsId}`);
    expect(res.status).toBe(200);
    const roi = await res.json();
    expect(roi.outcomeVerdict).toBeTruthy();
    expect(roi.outcomeVerdict.outcomeCount).toBe(12);
    expect(roi.outcomeVerdict.priorPeriodCount).toBe(5);
    expect(roi.outcomeVerdict.outcomeCount - roi.outcomeVerdict.priorPeriodCount).toBe(7); // +7 MoM
  });

  it('returns priorPeriodCount === null for a single-snapshot account (honest, never fabricated)', async () => {
    const res = await api(`/api/public/roi/${oneSnapWsId}`);
    expect(res.status).toBe(200);
    const roi = await res.json();
    expect(roi.outcomeVerdict).toBeTruthy();
    expect(roi.outcomeVerdict.priorPeriodCount).toBeNull();
  });

  it('applies the 15–45-day window guard on the real read path: a ~5-day-prior snapshot yields priorPeriodCount === null', async () => {
    const res = await api(`/api/public/roi/${outOfWindowWsId}`);
    expect(res.status).toBe(200);
    const roi = await res.json();
    expect(roi.outcomeVerdict).toBeTruthy();
    // Latest count is still surfaced…
    expect(roi.outcomeVerdict.outcomeCount).toBe(11);
    // …but the too-recent (~5-day-old) prior snapshot is OUTSIDE the 15–45-day window, so computeROI
    // must NOT use it as the comparison period — never a fabricated MoM off a too-recent snapshot.
    expect(roi.outcomeVerdict.priorPeriodCount).toBeNull();
  });
});
