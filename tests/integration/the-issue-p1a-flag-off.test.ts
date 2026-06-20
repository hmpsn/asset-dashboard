/**
 * A9 — P1a flag-OFF byte-identical guard.
 *
 * With the-issue-client-spine ON but the-issue-client-measured-capture OFF, every Lane A change is
 * unread: computeROI selects estimate_ga4, emits no outcomeReconciliation / outcomeTypeBreakdown,
 * even with a pinned TYPED event + a stored form_submission present (proving OFF ignores P1a data).
 *
 * The webhook-receiver-404 assertion depends on Lane C's route mount (C3); converted from `it.todo`
 * to a live assertion in C3's commit (POST /api/public/webflow-form-webhook/:wsId → 404 when the flag
 * is OFF, and nothing is captured). The computeROI half is fully Lane A and gates the pre-dispatch
 * commit. The 404 case needs a running server, so this file now spins up an ephemeral context.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import crypto from 'node:crypto';
import { createEphemeralTestContext } from './helpers.js';
import { seedWorkspace } from '../fixtures/workspace-seed.js';
import { computeROI } from '../../server/roi.js';
import { updateWorkspace } from '../../server/workspaces.js';
import { upsertPageKeywordsBatch } from '../../server/page-keywords.js';
import { saveGa4Snapshot } from '../../server/ga4-snapshots.js';
import { saveFormSubmission, countFormSubmissions } from '../../server/form-submissions.js';
import { setWorkspaceFlagOverride } from '../../server/feature-flags.js';

const ctx = createEphemeralTestContext(import.meta.url, { autoPublicAuth: true });
const { api } = ctx;

const OFF_SECRET = 'whsec_flag_off_secret_xyz';

let wsId: string;
const cleanups: Array<() => void> = [];

beforeAll(async () => {
  const s = seedWorkspace(); wsId = s.workspaceId; cleanups.push(s.cleanup);
  upsertPageKeywordsBatch(wsId, [{
    pagePath: '/services', pageTitle: 'Services', primaryKeyword: 'dentist near me',
    secondaryKeywords: [], clicks: 100, impressions: 1000, cpc: 3.5,
  }]);
  // P1a data IS present (typed pinned event + confirmation + a captured lead) — but measured-capture
  // is OFF, so computeROI must ignore it entirely and stay on the P0 estimate_ga4 path.
  updateWorkspace(wsId, {
    outcomeValue: { valuePerOutcome: 800, unitLabel: 'new patient', currency: 'USD', basis: 'agency_estimate', monthlyRetainer: 1500 },
    eventConfig: [{ eventName: 'form_submit', displayName: 'Form fills', pinned: true, outcomeType: 'form_fill' }],
    conversionTrackingConfirmedAt: new Date().toISOString(),
    // A secret IS set — so the 404 below proves the FLAG gate, not a missing-config 400.
    webflowFormWebhookSecret: OFF_SECRET,
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

  // The receiver-inert (404) assertion — wired in Lane C C3 (route now mounted).
  it('the Webflow webhook receiver is inert (404) when the flag is OFF, captures nothing', async () => {
    const before = countFormSubmissions(wsId, { startDate: '2026-06-01', endDate: '2026-06-30' });
    const body = JSON.stringify({
      triggerType: 'form_submission',
      payload: { formId: 'f', id: 'wf_off_receiver_1', name: 'Contact', data: { Email: 'leak@example.com' } },
    });
    const signature = crypto.createHmac('sha256', OFF_SECRET).update(body).digest('hex'); // valid sig — still 404 (flag gate beats it)
    const res = await api(`/api/public/webflow-form-webhook/${wsId}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Webflow-Signature': signature },
      body,
    });
    expect(res.status).toBe(404);
    expect(countFormSubmissions(wsId, { startDate: '2026-06-01', endDate: '2026-06-30' })).toBe(before);
  });
});
