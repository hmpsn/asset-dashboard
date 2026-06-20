/**
 * Lane C C3/C4 — The Issue (Client) P1a Webflow webhook receiver + admin conversion-tracking
 * endpoints (status / enable / disable).
 *
 * Exercises the PUBLIC webhook route (POST /api/public/webflow-form-webhook/:workspaceId) over the
 * real HTTP boundary so the raw-body / HMAC mount ordering is proven, plus the admin status + enable
 * endpoints (requireWorkspaceAccess). Flag-gated: OFF → the receiver 404s (A9's receiver-inert case).
 *
 * Per-flag DB overrides are set BEFORE the server starts (the 10s per-workspace flag cache can't leak
 * a toggle across cases). PII boundary: the public workspace payload carries formCaptureConnected but
 * NEVER the signing secret or lead identity (D7).
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import crypto from 'node:crypto';
import { createEphemeralTestContext } from './helpers.js';
import { seedWorkspace } from '../fixtures/workspace-seed.js';
import { updateWorkspace } from '../../server/workspaces.js';
import { countFormSubmissions, reconcileFormCountVsGa4 } from '../../server/form-submissions.js';
import { setWorkspaceFlagOverride } from '../../server/feature-flags.js';

const ctx = createEphemeralTestContext(import.meta.url, { autoPublicAuth: true });
const { api } = ctx;

const SECRET = 'whsec_conv_test_secret_abc123';
// Webflow signs `${timestamp}:${rawBody}` — sign over the same prefixed string the receiver verifies.
const sign = (body: string, ts: string) => crypto.createHmac('sha256', SECRET).update(`${ts}:${body}`).digest('hex');

// ON ws — secret + pinned event + flag ON (the live capture path).
let wsOn: string;
// OFF ws — secret set but flag OFF (the receiver must 404).
let wsOff: string;
// Enable-flow ws — flag ON, NO secret yet (tests the enable endpoint minting a fresh secret).
let wsEnable: string;
// Rotate-flow ws — flag ON, NO secret yet (tests enable-twice idempotency + disable+enable rotation).
let wsRotate: string;
const cleanups: Array<() => void> = [];

function bodyFor(submissionId: string) {
  return JSON.stringify({
    triggerType: 'form_submission',
    payload: {
      formId: 'form_abc',
      name: 'Contact',
      id: submissionId,
      submittedAt: '2026-06-19T12:00:00.000Z',
      data: { Name: 'Jane Doe', Email: 'jane@example.com', Message: 'Need a quote' },
    },
  });
}

beforeAll(async () => {
  const sOn = seedWorkspace(); wsOn = sOn.workspaceId; cleanups.push(sOn.cleanup);
  const sOff = seedWorkspace(); wsOff = sOff.workspaceId; cleanups.push(sOff.cleanup);
  const sEn = seedWorkspace(); wsEnable = sEn.workspaceId; cleanups.push(sEn.cleanup);
  const sRot = seedWorkspace(); wsRotate = sRot.workspaceId; cleanups.push(sRot.cleanup);

  updateWorkspace(wsOn, {
    webflowFormWebhookSecret: SECRET,
    eventConfig: [{ eventName: 'form_submit', displayName: 'Form fills', pinned: true, outcomeType: 'form_fill' }],
  });
  updateWorkspace(wsOff, { webflowFormWebhookSecret: SECRET });

  setWorkspaceFlagOverride('the-issue-client-spine', wsOn, true);
  setWorkspaceFlagOverride('the-issue-client-measured-capture', wsOn, true);
  setWorkspaceFlagOverride('the-issue-client-spine', wsOff, true);
  setWorkspaceFlagOverride('the-issue-client-measured-capture', wsOff, false);
  setWorkspaceFlagOverride('the-issue-client-spine', wsEnable, true);
  setWorkspaceFlagOverride('the-issue-client-measured-capture', wsEnable, true);
  setWorkspaceFlagOverride('the-issue-client-spine', wsRotate, true);
  setWorkspaceFlagOverride('the-issue-client-measured-capture', wsRotate, true);

  await ctx.startServer();
});

afterAll(async () => {
  for (const id of [wsOn, wsOff, wsEnable, wsRotate]) {
    setWorkspaceFlagOverride('the-issue-client-spine', id, null);
    setWorkspaceFlagOverride('the-issue-client-measured-capture', id, null);
  }
  for (const c of cleanups) c();
  await ctx.stopServer();
});

async function postWebhook(wsId: string, body: string, signature: string, ts: string) {
  return api(`/api/public/webflow-form-webhook/${wsId}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Webflow-Signature': signature,
      'X-Webflow-Timestamp': ts,
    },
    body,
  });
}

/** A fresh timestamp inside the 5-minute skew window + its matching signature. */
function fresh(body: string): { ts: string; sig: string } {
  const ts = String(Date.now());
  return { ts, sig: sign(body, ts) };
}

describe('POST /api/public/webflow-form-webhook/:workspaceId — HMAC receiver', () => {
  it('valid signature → 200, lead stored, outcomeType resolved to form_fill', async () => {
    const body = bodyFor('wf_sub_valid_1');
    const { ts, sig } = fresh(body);
    const res = await postWebhook(wsOn, body, sig, ts);
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.inserted).toBe(true);
    expect(countFormSubmissions(wsOn, { startDate: '2026-06-01', endDate: '2026-06-30' })).toBe(1);
  });

  it('bad signature → 401, nothing stored', async () => {
    const before = countFormSubmissions(wsOn, { startDate: '2026-06-01', endDate: '2026-06-30' });
    const body = bodyFor('wf_sub_badsig');
    const res = await postWebhook(wsOn, body, 'deadbeef', String(Date.now()));
    expect(res.status).toBe(401);
    expect(countFormSubmissions(wsOn, { startDate: '2026-06-01', endDate: '2026-06-30' })).toBe(before);
  });

  it('missing timestamp → 401, nothing stored', async () => {
    const before = countFormSubmissions(wsOn, { startDate: '2026-06-01', endDate: '2026-06-30' });
    const body = bodyFor('wf_sub_nots');
    // Sign correctly but omit X-Webflow-Timestamp entirely.
    const res = await api(`/api/public/webflow-form-webhook/${wsOn}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Webflow-Signature': sign(body, String(Date.now())) },
      body,
    });
    expect(res.status).toBe(401);
    expect(countFormSubmissions(wsOn, { startDate: '2026-06-01', endDate: '2026-06-30' })).toBe(before);
  });

  it('stale timestamp (>5min skew) → 401, nothing stored (replay bound)', async () => {
    const before = countFormSubmissions(wsOn, { startDate: '2026-06-01', endDate: '2026-06-30' });
    const body = bodyFor('wf_sub_stale');
    const staleTs = String(Date.now() - 6 * 60 * 1000); // 6 minutes old
    const res = await postWebhook(wsOn, body, sign(body, staleTs), staleTs);
    expect(res.status).toBe(401);
    expect(countFormSubmissions(wsOn, { startDate: '2026-06-01', endDate: '2026-06-30' })).toBe(before);
  });

  it('duplicate submissionId → 200, count stays 1 (idempotent)', async () => {
    const body = bodyFor('wf_sub_dup');
    const a = fresh(body);
    const r1 = await postWebhook(wsOn, body, a.sig, a.ts);
    expect((await r1.json()).inserted).toBe(true);
    const b = fresh(body);
    const r2 = await postWebhook(wsOn, body, b.sig, b.ts);
    expect(r2.status).toBe(200);
    expect((await r2.json()).inserted).toBe(false);
  });

  it('flag OFF → 404, nothing stored', async () => {
    const body = bodyFor('wf_sub_off');
    const { ts, sig } = fresh(body);
    const res = await postWebhook(wsOff, body, sig, ts);
    expect(res.status).toBe(404);
    expect(countFormSubmissions(wsOff, { startDate: '2026-06-01', endDate: '2026-06-30' })).toBe(0);
  });

  it('reconcileFormCountVsGa4 surfaces the discrepancy (counts only, never hidden)', () => {
    const r = reconcileFormCountVsGa4(wsOn, 5, { startDate: '2026-06-01', endDate: '2026-06-30' });
    expect(r.capturedCount).toBeGreaterThanOrEqual(1);
    expect(r.ga4Count).toBe(5);
    expect(r.discrepancy).toBe(5 - r.capturedCount);
  });
});

describe('admin conversion-tracking endpoints (requireWorkspaceAccess)', () => {
  it('GET status → pinned/typed/connected/last-lead readout', async () => {
    const res = await api(`/api/workspaces/${wsOn}/conversion-tracking-status`);
    expect(res.status).toBe(200);
    const s = await res.json();
    expect(s.pinnedCount).toBe(1);
    expect(s.typedCount).toBe(1);
    expect(typeof s.formCaptureConnected).toBe('boolean');
    expect(s.submissionCount).toBeGreaterThanOrEqual(1);
  });

  it('POST enable → mints + returns the signing secret ONCE + a copyable webhook URL', async () => {
    const res = await api(`/api/workspaces/${wsEnable}/form-capture/enable`, { method: 'POST' });
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.webhookSecret).toMatch(/^[0-9a-f]{32,}$/);
    expect(json.webhookUrl).toContain(`/api/public/webflow-form-webhook/${wsEnable}`);
  });

  it('GET status 404s when the flag is OFF', async () => {
    const res = await api(`/api/workspaces/${wsOff}/conversion-tracking-status`);
    expect(res.status).toBe(404);
  });

  it('enable-twice returns the SAME secret (idempotent); disable+enable ROTATES it', async () => {
    // First enable mints a fresh secret.
    const e1 = await (await api(`/api/workspaces/${wsRotate}/form-capture/enable`, { method: 'POST' })).json();
    expect(e1.webhookSecret).toMatch(/^[0-9a-f]{32,}$/);

    // Re-enable without disabling → same secret (the operator's pasted Webflow secret keeps working).
    const e2 = await (await api(`/api/workspaces/${wsRotate}/form-capture/enable`, { method: 'POST' })).json();
    expect(e2.webhookSecret).toBe(e1.webhookSecret);

    // Disable clears the secret + sources.
    const dis = await api(`/api/workspaces/${wsRotate}/form-capture/disable`, { method: 'POST' });
    expect(dis.status).toBe(200);
    expect((await dis.json()).disabled).toBe(true);

    // Enable again → a NEW secret is minted (rotation = disable then enable).
    const e3 = await (await api(`/api/workspaces/${wsRotate}/form-capture/enable`, { method: 'POST' })).json();
    expect(e3.webhookSecret).toMatch(/^[0-9a-f]{32,}$/);
    expect(e3.webhookSecret).not.toBe(e1.webhookSecret);
  });
});

describe('PII boundary — public workspace payload', () => {
  it('carries formCaptureConnected but NEVER the secret or lead identity (D7)', async () => {
    // A captured lead exists on wsOn from the cases above.
    const res = await api(`/api/public/workspace/${wsOn}`);
    expect(res.status).toBe(200);
    const raw = await res.text();
    expect(raw).toContain('formCaptureConnected');
    expect(raw).not.toContain(SECRET);
    expect(raw).not.toContain('jane@example.com');
    expect(raw).not.toMatch(/webflowFormWebhookSecret|leadEmail|leadName|leadMessage/);
  });
});
