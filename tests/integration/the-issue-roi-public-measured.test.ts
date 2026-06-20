/**
 * A8 — Public ROI payload carries typed measured outcomes + anonymous reconciliation, never PII.
 *
 * Exercises the PUBLIC route GET /api/public/roi/:id (NOT the admin GET) so a serialization
 * regression on the measured money surface — or a PII leak — is caught on the real read path.
 * PII (leadName/leadEmail/leadMessage) must NEVER appear in the raw response.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createEphemeralTestContext } from './helpers.js';
import { seedWorkspace } from '../fixtures/workspace-seed.js';
import { updateWorkspace } from '../../server/workspaces.js';
import { upsertPageKeywordsBatch } from '../../server/page-keywords.js';
import { saveGa4Snapshot } from '../../server/ga4-snapshots.js';
import { saveFormSubmission } from '../../server/form-submissions.js';
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
  updateWorkspace(wsId, {
    outcomeValue: { valuePerOutcome: 800, unitLabel: 'new patient', currency: 'USD', basis: 'agency_estimate', monthlyRetainer: 1500 },
    eventConfig: [{ eventName: 'form_submit', displayName: 'Form fills', pinned: true, outcomeType: 'form_fill' }],
    conversionTrackingConfirmedAt: new Date().toISOString(),
    webflowFormSources: [{ formId: 'form_abc', formName: 'Contact', outcomeType: 'form_fill' }],
  });
  saveGa4Snapshot({
    workspaceId: wsId, capturedAt: new Date().toISOString(), totalConversions: 23, totalUsers: 300,
    byEvent: [{ eventName: 'form_submit', conversions: 23, users: 200, rate: 7 }],
  });
  // Two captured named leads (with PII) inside the current period.
  const now = new Date().toISOString();
  saveFormSubmission({
    workspaceId: wsId, formId: 'form_abc', submissionId: 'wf_sub_a', formName: 'Contact',
    leadName: 'Jane Doe', leadEmail: 'jane@example.com', leadMessage: 'Quote please',
    eventName: 'form_submit', outcomeType: 'form_fill', submittedAt: now, capturedAt: now,
  });
  saveFormSubmission({
    workspaceId: wsId, formId: 'form_abc', submissionId: 'wf_sub_b', formName: 'Contact',
    leadName: 'John Roe', leadEmail: 'john@example.com', leadMessage: 'Interested',
    eventName: 'form_submit', outcomeType: 'form_fill', submittedAt: now, capturedAt: now,
  });
  setWorkspaceFlagOverride('the-issue-client-spine', wsId, true);
  setWorkspaceFlagOverride('the-issue-client-measured-capture', wsId, true);
  await ctx.startServer();
});

afterAll(async () => {
  setWorkspaceFlagOverride('the-issue-client-spine', wsId, null);
  setWorkspaceFlagOverride('the-issue-client-measured-capture', wsId, null);
  for (const c of cleanups) c();
  await ctx.stopServer();
});

describe('GET /api/public/roi — measured outcomes + reconciliation, no PII', () => {
  it('public ROI payload carries typed measured outcomes + anonymous reconciliation, never PII', async () => {
    const res = await api(`/api/public/roi/${wsId}`);
    expect(res.status).toBe(200);
    const raw = await res.text();
    const roi = JSON.parse(raw);
    expect(roi.outcomeVerdict.provenance).toBe('measured_action');
    expect(roi.outcomeVerdict.outcomeTypeBreakdown[0].outcomeType).toBe('form_fill');
    expect(roi.outcomeVerdict.outcomeReconciliation.ga4Count).toBe(23);
    expect(roi.outcomeVerdict.outcomeReconciliation.capturedCount).toBe(2);
    // PII boundary — names, emails, and messages never ride the public payload.
    expect(raw).not.toContain('jane@example.com');
    expect(raw).not.toContain('john@example.com');
    expect(raw).not.toContain('Jane Doe');
    expect(raw).not.toMatch(/leadName|leadEmail|leadMessage|webflowFormWebhookSecret/);
  });
});
