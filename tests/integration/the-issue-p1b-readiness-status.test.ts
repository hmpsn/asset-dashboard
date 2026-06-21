/**
 * The Issue (Client) P1b — Lane A A4: readiness rollup on the ADMIN conversion-tracking-status endpoint.
 *
 * The admin status endpoint (requireWorkspaceAccess, flag-gated on the-issue-client-measured-capture)
 * gains an additive `readiness: SetupReadinessState | null` field. Public payloads are untouched.
 *
 * D7: the readiness rollup is PII-free — even though a named lead is captured, the raw response carries
 * no lead identity. Flag-OFF → the endpoint 404s (readiness never leaks when OFF).
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createEphemeralTestContext } from './helpers.js';
import { seedWorkspace } from '../fixtures/workspace-seed.js';
import { updateWorkspace } from '../../server/workspaces.js';
import { saveFormSubmission } from '../../server/form-submissions.js';
import { setWorkspaceFlagOverride } from '../../server/feature-flags.js';

const ctx = createEphemeralTestContext(import.meta.url, { contextName: 'p1b-readiness-status' });
const { api } = ctx;

let wsOn: string;
let wsOff: string;
const cleanups: Array<() => void> = [];

beforeAll(async () => {
  const sOn = seedWorkspace(); wsOn = sOn.workspaceId; cleanups.push(sOn.cleanup);
  const sOff = seedWorkspace(); wsOff = sOff.workspaceId; cleanups.push(sOff.cleanup);

  updateWorkspace(wsOn, {
    ga4PropertyId: 'properties/123',
    outcomeValue: { valuePerOutcome: 800, unitLabel: 'new patient', currency: 'USD', basis: 'agency_estimate' },
    eventConfig: [{ eventName: 'form_submit', displayName: 'Form fills', pinned: true, outcomeType: 'form_fill' }],
    webflowFormSources: [{ formId: 'f1', formName: 'Contact', outcomeType: 'form_fill' }],
    conversionTrackingConfirmedAt: '2026-06-20T00:00:00.000Z',
    segmentConfig: { segment: 'b2b_saas' },
  });
  const now = '2026-06-19T12:00:00.000Z';
  saveFormSubmission({
    workspaceId: wsOn, formId: 'f1', submissionId: 'sub-1', formName: 'Contact',
    leadName: 'Jane Doe', leadEmail: 'jane@example.com', leadMessage: 'secret note',
    eventName: 'form_submit', outcomeType: 'form_fill', submittedAt: now, capturedAt: now,
  });

  setWorkspaceFlagOverride('the-issue-client-measured-capture', wsOn, true);
  setWorkspaceFlagOverride('the-issue-client-measured-capture', wsOff, false);

  await ctx.startServer();
});

afterAll(async () => {
  setWorkspaceFlagOverride('the-issue-client-measured-capture', wsOn, null);
  setWorkspaceFlagOverride('the-issue-client-measured-capture', wsOff, null);
  for (const c of cleanups) c();
  await ctx.stopServer();
});

describe('GET /api/workspaces/:id/conversion-tracking-status — readiness rollup (A4)', () => {
  it('flag-ON → body.readiness exists with the expected gate booleans', async () => {
    const res = await api(`/api/workspaces/${wsOn}/conversion-tracking-status`);
    expect(res.status).toBe(200);
    const s = await res.json();
    expect(s.readiness).toBeTruthy();
    expect(s.readiness.ga4Connected).toBe(true);
    expect(s.readiness.valueSet).toBe(true);
    expect(s.readiness.eventsPinned).toBe(true);
    expect(s.readiness.eventsTyped).toBe(true);
    expect(s.readiness.webflowConnected).toBe(true);
    expect(s.readiness.segmentConfirmed).toBe(true);
    expect(typeof s.readiness.openGapCount).toBe('number');
    // Resolved fields the cockpit renders verbatim (A4 enrichment) — present on the live payload.
    expect(['estimate_ga4', 'measured_action', 'actual_reconciled']).toContain(s.readiness.resolvedProvenance);
    expect(typeof s.readiness.segmentLabel).toBe('string');
    expect(s.readiness.segmentLabel.length).toBeGreaterThan(0);
    // outcomeValueLabel is the pre-formatted value line (value is set in this fixture → non-null string).
    expect(typeof s.readiness.outcomeValueLabel).toBe('string');
  });

  it('readiness rollup is PII-free (D7)', async () => {
    const raw = await (await api(`/api/workspaces/${wsOn}/conversion-tracking-status`)).text();
    expect(raw).not.toContain('leadName');
    expect(raw).not.toContain('leadEmail');
    expect(raw).not.toContain('leadMessage');
    expect(raw).not.toContain('jane@example.com');
    expect(raw).not.toContain('Jane Doe');
    expect(raw).not.toContain('secret note');
  });

  it('flag-OFF → 404 (readiness never leaks when OFF)', async () => {
    const res = await api(`/api/workspaces/${wsOff}/conversion-tracking-status`);
    expect(res.status).toBe(404);
  });
});
