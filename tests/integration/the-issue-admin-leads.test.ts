/**
 * The Issue (Client) P1b — Lane A A5: admin named-leads endpoint (PII, paginated).
 *
 * GET /api/workspaces/:id/form-submissions (requireWorkspaceAccess, flag-gated on
 * the-issue-client-measured-capture) returns the operator's captured leads WITH PII, paginated.
 * `total` is the unbounded count (rate-display-shares-source: header N = full count, not page length).
 *
 * D7: PII rides ONLY this admin route. The public ROI payload carries NO lead identity even when
 * capture is ON.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createEphemeralTestContext } from './helpers.js';
import { seedWorkspace } from '../fixtures/workspace-seed.js';
import { updateWorkspace } from '../../server/workspaces.js';
import { upsertPageKeywordsBatch } from '../../server/page-keywords.js';
import { saveGa4Snapshot } from '../../server/ga4-snapshots.js';
import { saveFormSubmission } from '../../server/form-submissions.js';
import { setWorkspaceFlagOverride } from '../../server/feature-flags.js';

const ctx = createEphemeralTestContext(import.meta.url, { contextName: 'p1b-admin-leads' });
const { api } = ctx;

const SENTINEL_NAME = 'LEAK_SENTINEL_NAME';
const SENTINEL_EMAIL = 'leak-sentinel@example.test';

let wsOn: string;
let wsOff: string;
const cleanups: Array<() => void> = [];

beforeAll(async () => {
  const sOn = seedWorkspace(); wsOn = sOn.workspaceId; cleanups.push(sOn.cleanup);
  const sOff = seedWorkspace(); wsOff = sOff.workspaceId; cleanups.push(sOff.cleanup);

  // Seed ROI CPC + GA4 so the public ROI route returns 200 (for the D7 cross-check), plus 2 leads.
  upsertPageKeywordsBatch(wsOn, [{
    pagePath: '/services', pageTitle: 'Services', primaryKeyword: 'dentist near me',
    secondaryKeywords: [], clicks: 100, impressions: 1000, cpc: 3.5,
  }]);
  updateWorkspace(wsOn, { outcomeValue: { valuePerOutcome: 800, unitLabel: 'new patient', currency: 'USD', basis: 'agency_estimate' } });
  saveGa4Snapshot({ workspaceId: wsOn, capturedAt: new Date().toISOString(), totalConversions: 2, totalUsers: 50, byEvent: [{ eventName: 'form_submit', conversions: 2, users: 50, rate: 4 }] });

  saveFormSubmission({
    workspaceId: wsOn, formId: 'f1', submissionId: 'sub-1', formName: 'Contact',
    leadName: SENTINEL_NAME, leadEmail: SENTINEL_EMAIL, leadMessage: 'first',
    eventName: 'form_submit', outcomeType: 'form_fill',
    submittedAt: '2026-06-18T10:00:00.000Z', capturedAt: '2026-06-18T10:00:00.000Z',
  });
  saveFormSubmission({
    workspaceId: wsOn, formId: 'f1', submissionId: 'sub-2', formName: 'Contact',
    leadName: 'Second Lead', leadEmail: 'second@example.test', leadMessage: 'second',
    eventName: 'form_submit', outcomeType: 'call',
    submittedAt: '2026-06-19T10:00:00.000Z', capturedAt: '2026-06-19T10:00:00.000Z',
  });

  setWorkspaceFlagOverride('the-issue-client-spine', wsOn, true);
  setWorkspaceFlagOverride('the-issue-client-measured-capture', wsOn, true);
  setWorkspaceFlagOverride('the-issue-client-measured-capture', wsOff, false);

  await ctx.startServer();
});

afterAll(async () => {
  setWorkspaceFlagOverride('the-issue-client-spine', wsOn, null);
  setWorkspaceFlagOverride('the-issue-client-measured-capture', wsOn, null);
  setWorkspaceFlagOverride('the-issue-client-measured-capture', wsOff, null);
  for (const c of cleanups) c();
  await ctx.stopServer();
});

describe('GET /api/workspaces/:id/form-submissions (requireWorkspaceAccess, A5)', () => {
  it('flag-OFF → 404', async () => {
    const res = await api(`/api/workspaces/${wsOff}/form-submissions`);
    expect(res.status).toBe(404);
  });

  it('flag-ON, admin → 200 with PII, total === 2, ordered submittedAt DESC', async () => {
    const res = await api(`/api/workspaces/${wsOn}/form-submissions`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.total).toBe(2);
    expect(Array.isArray(body.leads)).toBe(true);
    expect(body.leads.length).toBe(2);
    // DESC by submittedAt → second lead (2026-06-19) first.
    expect(body.leads[0].leadName).toBe('Second Lead');
    expect(body.leads[1].leadName).toBe(SENTINEL_NAME);
    expect(body.leads[1].leadEmail).toBe(SENTINEL_EMAIL);
    // NamedLeadView shape — leadMessage omitted (admin-internal).
    expect(body.leads[0]).not.toHaveProperty('leadMessage');
    expect(body.leads[0]).toHaveProperty('outcomeType');
  });

  it('pagination ?limit=1&offset=0 → 1 lead, total still 2', async () => {
    const res = await api(`/api/workspaces/${wsOn}/form-submissions?limit=1&offset=0`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.leads.length).toBe(1);
    expect(body.total).toBe(2);
  });

  it('D7 cross-check — PUBLIC /api/public/roi carries NO lead PII', async () => {
    const raw = await (await api(`/api/public/roi/${wsOn}`)).text();
    expect(raw).not.toContain(SENTINEL_NAME);
    expect(raw).not.toContain(SENTINEL_EMAIL);
    expect(raw).not.toContain('leadName');
    expect(raw).not.toContain('leadEmail');
  });
});
