/**
 * A9 — P1a flag-OFF byte-identical guard.
 *
 * With the-issue-client-spine ON but the-issue-client-measured-capture OFF, every Lane A change is
 * unread: computeROI selects estimate_ga4, emits no outcomeReconciliation / outcomeTypeBreakdown,
 * even with a pinned TYPED event + a stored form_submission present (proving OFF ignores P1a data).
 *
 * Capture is now Data-API POLLING (the HMAC webhook receiver was retired). The inert-when-OFF half is
 * proven by calling runWebflowFormPoll() directly: with selected forms + tracked sources, a flag-OFF
 * workspace is skipped before any Webflow call, so nothing is captured. The computeROI half is fully
 * Lane A and gates the pre-dispatch commit. Admin endpoints 404 when the flag is OFF.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createEphemeralTestContext } from './helpers.js';
import { seedWorkspace } from '../fixtures/workspace-seed.js';
import { computeROI } from '../../server/roi.js';
import { updateWorkspace } from '../../server/workspaces.js';
import { upsertPageKeywordsBatch } from '../../server/page-keywords.js';
import { saveGa4Snapshot } from '../../server/ga4-snapshots.js';
import { saveFormSubmission, countFormSubmissions } from '../../server/form-submissions.js';
import { runWebflowFormPoll } from '../../server/webflow-form-poller.js';
import { setWorkspaceFlagOverride } from '../../server/feature-flags.js';

const ctx = createEphemeralTestContext(import.meta.url, { autoPublicAuth: true });
const { api } = ctx;

let wsId: string;
const cleanups: Array<() => void> = [];

beforeAll(async () => {
  const s = seedWorkspace(); wsId = s.workspaceId; cleanups.push(s.cleanup);
  upsertPageKeywordsBatch(wsId, [{
    pagePath: '/services', pageTitle: 'Services', primaryKeyword: 'dentist near me',
    secondaryKeywords: [], clicks: 100, impressions: 1000, cpc: 3.5,
  }]);
  // P1a data IS present (typed pinned event + confirmation + selected forms + a captured lead) — but
  // measured-capture is OFF, so computeROI must ignore it entirely and stay on the P0 estimate_ga4 path,
  // and the poller must skip this workspace before any Webflow call.
  updateWorkspace(wsId, {
    outcomeValue: { valuePerOutcome: 800, unitLabel: 'new patient', currency: 'USD', basis: 'agency_estimate', monthlyRetainer: 1500 },
    eventConfig: [{ eventName: 'form_submit', displayName: 'Form fills', pinned: true, outcomeType: 'form_fill' }],
    conversionTrackingConfirmedAt: new Date().toISOString(),
    // Selected forms ARE set — so the poller-inert assertion proves the FLAG gate, not a missing-config skip.
    webflowFormSources: [{ formId: 'form_abc', formName: 'Contact', outcomeType: 'form_fill' }],
  });
  saveGa4Snapshot({
    workspaceId: wsId, capturedAt: new Date().toISOString(), totalConversions: 23, totalUsers: 300,
    byEvent: [{ eventName: 'form_submit', conversions: 23, users: 200, rate: 7 }],
  });
  const now = new Date().toISOString();
  saveFormSubmission({
    workspaceId: wsId, formId: 'form_abc', submissionId: 'wf_off_seed', formName: 'Contact',
    leadName: 'Jane Doe', leadEmail: 'jane@example.com', leadMessage: 'Quote',
    eventName: 'form_submit', outcomeType: 'form_fill', submittedAt: now, capturedAt: now,
  });
  setWorkspaceFlagOverride('the-issue-client-spine', wsId, true);
  setWorkspaceFlagOverride('the-issue-client-measured-capture', wsId, false);

  await ctx.startServer();
});

afterAll(async () => {
  setWorkspaceFlagOverride('the-issue-client-spine', wsId, null);
  setWorkspaceFlagOverride('the-issue-client-measured-capture', wsId, null);
  for (const c of cleanups) c();
  await ctx.stopServer();
});

describe('P1a flag-OFF byte-identical guard', () => {
  it('computeROI selects estimate_ga4 and emits no P1a reconciliation/typed-verdict fields', () => {
    const roi = computeROI(wsId)!;
    expect(roi.outcomeVerdict?.provenance).toBe('estimate_ga4');
    expect(roi.outcomeVerdict?.outcomeReconciliation).toBeUndefined();
    expect(roi.outcomeVerdict?.outcomeTypeBreakdown).toBeUndefined();
  });

  it('the Webflow form poller is inert when the flag is OFF — captures nothing (no new rows)', async () => {
    const before = countFormSubmissions(wsId, { startDate: '2026-06-01', endDate: '2026-06-30' });
    // A full poll pass: the OFF workspace is skipped before any Webflow API call, so the seeded count
    // is unchanged (no double-count of the pre-seeded lead, no new ingest).
    await runWebflowFormPoll();
    expect(countFormSubmissions(wsId, { startDate: '2026-06-01', endDate: '2026-06-30' })).toBe(before);
  });

  it('the admin conversion-tracking endpoints 404 when the flag is OFF', async () => {
    expect((await api(`/api/workspaces/${wsId}/conversion-tracking-status`)).status).toBe(404);
    expect((await api(`/api/workspaces/${wsId}/webflow-forms`)).status).toBe(404);
  });
});
