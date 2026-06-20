/**
 * The Issue (Client) P1a — conversion-tracking admin endpoints (Webflow Data-API POLLING model).
 *
 * Replaces the retired HMAC-webhook integration test. There is no public receiver anymore — capture is
 * via the daily poller (server/webflow-form-poller.ts; logic covered by tests/unit/webflow-form-poller).
 * This file exercises the ADMIN HTTP surface over the real boundary (requireWorkspaceAccess; flag-gated)
 * plus the PII boundary on the public workspace payload:
 *
 *   GET  /api/workspaces/:id/conversion-tracking-status  — verification readout (counts + freshness)
 *   GET  /api/workspaces/:id/webflow-forms               — forms picker (empty + 200 when no token)
 *   PUT  /api/workspaces/:id/form-sources                — save mappings + confirm setup (provenance flip)
 *
 * form_submissions are seeded in-process via saveFormSubmission (the store shares the same DB file the
 * spawned server reads), so the status/PII assertions exercise real captured rows without the live API.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createEphemeralTestContext } from './helpers.js';
import { seedWorkspace } from '../fixtures/workspace-seed.js';
import { updateWorkspace } from '../../server/workspaces.js';
import { saveFormSubmission, countFormSubmissions } from '../../server/form-submissions.js';
import { setWorkspaceFlagOverride } from '../../server/feature-flags.js';

const ctx = createEphemeralTestContext(import.meta.url, { autoPublicAuth: true });
const { api } = ctx;

// ON ws — flag ON, a pinned typed event, and a seeded captured lead (the live readout).
let wsOn: string;
// OFF ws — flag OFF (every admin endpoint must 404).
let wsOff: string;
// Setup ws — flag ON, NO sources yet (tests the form-sources save + provenance flip).
let wsSetup: string;
const cleanups: Array<() => void> = [];

beforeAll(async () => {
  const sOn = seedWorkspace(); wsOn = sOn.workspaceId; cleanups.push(sOn.cleanup);
  const sOff = seedWorkspace(); wsOff = sOff.workspaceId; cleanups.push(sOff.cleanup);
  const sSetup = seedWorkspace(); wsSetup = sSetup.workspaceId; cleanups.push(sSetup.cleanup);

  updateWorkspace(wsOn, {
    eventConfig: [{ eventName: 'form_submit', displayName: 'Form fills', pinned: true, outcomeType: 'form_fill' }],
    webflowFormSources: [{ formId: 'form_abc', formName: 'Contact', outcomeType: 'form_fill' }],
    conversionTrackingConfirmedAt: new Date().toISOString(),
  });
  const now = new Date('2026-06-19T12:00:00.000Z').toISOString();
  saveFormSubmission({
    workspaceId: wsOn, formId: 'form_abc', submissionId: 'wf_sub_seed', formName: 'Contact',
    leadName: 'Jane Doe', leadEmail: 'jane@example.com', leadMessage: 'Need a quote',
    eventName: 'form_submit', outcomeType: 'form_fill', submittedAt: now, capturedAt: now,
  });

  setWorkspaceFlagOverride('the-issue-client-spine', wsOn, true);
  setWorkspaceFlagOverride('the-issue-client-measured-capture', wsOn, true);
  setWorkspaceFlagOverride('the-issue-client-spine', wsOff, true);
  setWorkspaceFlagOverride('the-issue-client-measured-capture', wsOff, false);
  setWorkspaceFlagOverride('the-issue-client-spine', wsSetup, true);
  setWorkspaceFlagOverride('the-issue-client-measured-capture', wsSetup, true);

  await ctx.startServer();
});

afterAll(async () => {
  for (const id of [wsOn, wsOff, wsSetup]) {
    setWorkspaceFlagOverride('the-issue-client-spine', id, null);
    setWorkspaceFlagOverride('the-issue-client-measured-capture', id, null);
  }
  for (const c of cleanups) c();
  await ctx.stopServer();
});

describe('GET /api/workspaces/:id/conversion-tracking-status (requireWorkspaceAccess)', () => {
  it('returns pinned/typed/connected/last-lead readout for a flag-ON workspace', async () => {
    const res = await api(`/api/workspaces/${wsOn}/conversion-tracking-status`);
    expect(res.status).toBe(200);
    const s = await res.json();
    expect(s.pinnedCount).toBe(1);
    expect(s.typedCount).toBe(1);
    // Connected = confirmed setup AND ≥1 selected form (no webhook secret involved).
    expect(s.formCaptureConnected).toBe(true);
    expect(s.submissionCount).toBeGreaterThanOrEqual(1);
    expect(s.lastSubmissionAt).toBeTruthy();
  });

  it('404s when the measured-capture flag is OFF', async () => {
    const res = await api(`/api/workspaces/${wsOff}/conversion-tracking-status`);
    expect(res.status).toBe(404);
  });
});

describe('GET /api/workspaces/:id/webflow-forms (forms picker)', () => {
  it('returns a forms array (empty + 200 when no Webflow token is configured)', async () => {
    const res = await api(`/api/workspaces/${wsOn}/webflow-forms`);
    // With no WEBFLOW_API_TOKEN in the test env, listWebflowForms short-circuits to [] (it never calls
    // the live API), so the picker degrades to an empty list + 200 — never a 500. The two error branches
    // of this endpoint (400 no-site-linked, 502 Webflow-unreachable) need in-process module spying and
    // are covered in the-issue-conversion-tracking-error-branches.test.ts.
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(Array.isArray(json.forms)).toBe(true);
  });

  it('404s when the flag is OFF', async () => {
    const res = await api(`/api/workspaces/${wsOff}/webflow-forms`);
    expect(res.status).toBe(404);
  });
});

describe('PUT /api/workspaces/:id/form-sources (save mappings + confirm setup)', () => {
  it('saves the formId→outcomeType mappings and flips setup-confirmed (provenance basis)', async () => {
    const res = await api(`/api/workspaces/${wsSetup}/form-sources`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sources: [{ formId: 'f1', formName: 'Contact', outcomeType: 'form_fill' }] }),
    });
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.saved).toBe(true);
    expect(json.formCaptureConnected).toBe(true);

    // The readout now reflects the saved + confirmed state.
    const status = await (await api(`/api/workspaces/${wsSetup}/conversion-tracking-status`)).json();
    expect(status.formCaptureConnected).toBe(true);
  });

  it('rejects a garbage outcomeType at the boundary (400, not a silent drop)', async () => {
    const res = await api(`/api/workspaces/${wsSetup}/form-sources`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sources: [{ formId: 'f1', formName: 'Contact', outcomeType: 'not_a_real_type' }] }),
    });
    expect(res.status).toBe(400);
  });

  it('404s when the flag is OFF', async () => {
    const res = await api(`/api/workspaces/${wsOff}/form-sources`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sources: [] }),
    });
    expect(res.status).toBe(404);
  });
});

describe('PII boundary — public workspace payload', () => {
  it('carries formCaptureConnected but NEVER lead identity or any secret field (D7)', async () => {
    const res = await api(`/api/public/workspace/${wsOn}`);
    expect(res.status).toBe(200);
    const raw = await res.text();
    expect(raw).toContain('formCaptureConnected');
    expect(raw).not.toContain('jane@example.com');
    expect(raw).not.toContain('Jane Doe');
    expect(raw).not.toMatch(/webflowFormWebhookSecret|leadEmail|leadName|leadMessage/);
    // A captured lead exists, but only the anonymous count is public.
    expect(countFormSubmissions(wsOn, { startDate: '2026-06-01', endDate: '2026-06-30' })).toBeGreaterThanOrEqual(1);
  });
});
