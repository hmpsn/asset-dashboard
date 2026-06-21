/**
 * The Issue (Client) P1b — Lane A A6: client-authed export + "your leads" endpoints.
 *
 * GET /api/public/export/:workspaceId/one-pager — segment one-pager HTML (print-from-browser).
 * GET /api/public/export/:workspaceId/my-leads   — the client's OWN captured leads (PII, JSON).
 * Both requireAuthenticatedClientPortalAuth, both flag-gated on the-issue-client-return-hook.
 *
 * D7: PII rides ONLY because the guard authenticated the caller. An unauthenticated request never
 * gets PII (rejected). The PUBLIC roi/workspace payloads carry NO lead PII, flag-ON or flag-OFF.
 *
 * autoPublicAuth=true → /api/public/ calls auto-inject the admin HMAC token (which the guard passes
 * through). The "unauthenticated" case opts out via the x-no-auto-public-auth header.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createEphemeralTestContext } from './helpers.js';
import { seedWorkspace } from '../fixtures/workspace-seed.js';
import { updateWorkspace } from '../../server/workspaces.js';
import { upsertPageKeywordsBatch } from '../../server/page-keywords.js';
import { saveGa4Snapshot } from '../../server/ga4-snapshots.js';
import { saveFormSubmission } from '../../server/form-submissions.js';
import { setWorkspaceFlagOverride } from '../../server/feature-flags.js';

const ctx = createEphemeralTestContext(import.meta.url, { autoPublicAuth: true, contextName: 'p1b-client-export' });
const { api } = ctx;

const SENTINEL_NAME = 'LEAK_SENTINEL_NAME';
const SENTINEL_EMAIL = 'leak-sentinel@example.test';
const NO_AUTO = { headers: { 'x-no-auto-public-auth': 'true' } };

let wsOn: string;
let wsOff: string;
let wsNoVerdict: string; // return-hook ON, spine ON, but no outcomeValue → no verdict (the 404 branch)
const cleanups: Array<() => void> = [];

function seedExportable(wsId: string): void {
  upsertPageKeywordsBatch(wsId, [{
    pagePath: '/services', pageTitle: 'Services', primaryKeyword: 'dentist near me',
    secondaryKeywords: [], clicks: 100, impressions: 1000, cpc: 3.5,
  }]);
  updateWorkspace(wsId, {
    clientPassword: 'client-pass',
    outcomeValue: { valuePerOutcome: 800, unitLabel: 'new patient', currency: 'USD', basis: 'agency_estimate', monthlyRetainer: 1500 },
    eventConfig: [{ eventName: 'form_submit', displayName: 'Form fills', pinned: true, outcomeType: 'form_fill' }],
  });
  saveGa4Snapshot({ workspaceId: wsId, capturedAt: new Date().toISOString(), totalConversions: 14, totalUsers: 200, byEvent: [{ eventName: 'form_submit', conversions: 14, users: 200, rate: 7 }] });
  saveFormSubmission({
    workspaceId: wsId, formId: 'f1', submissionId: 'sub-1', formName: 'Contact',
    leadName: SENTINEL_NAME, leadEmail: SENTINEL_EMAIL, leadMessage: 'secret note',
    eventName: 'form_submit', outcomeType: 'form_fill',
    submittedAt: '2026-06-19T10:00:00.000Z', capturedAt: '2026-06-19T10:00:00.000Z',
  });
}

beforeAll(async () => {
  const sOn = seedWorkspace(); wsOn = sOn.workspaceId; cleanups.push(sOn.cleanup);
  const sOff = seedWorkspace(); wsOff = sOff.workspaceId; cleanups.push(sOff.cleanup);
  const sNoV = seedWorkspace(); wsNoVerdict = sNoV.workspaceId; cleanups.push(sNoV.cleanup);
  seedExportable(wsOn);
  seedExportable(wsOff);
  // wsNoVerdict: SEO data present but NO outcomeValue/GA4 snapshot → computeROI hydrates no verdict,
  // so assembleOnePagerExport returns null and the route takes its "verdict not yet established" branch.
  upsertPageKeywordsBatch(wsNoVerdict, [{
    pagePath: '/services', pageTitle: 'Services', primaryKeyword: 'dentist near me',
    secondaryKeywords: [], clicks: 100, impressions: 1000, cpc: 3.5,
  }]);
  updateWorkspace(wsNoVerdict, { clientPassword: 'client-pass' });

  setWorkspaceFlagOverride('the-issue-client-spine', wsOn, true);
  setWorkspaceFlagOverride('the-issue-client-return-hook', wsOn, true);
  // wsOff: spine ON (so computeROI hydrates → public roi 200) but return-hook OFF.
  setWorkspaceFlagOverride('the-issue-client-spine', wsOff, true);
  setWorkspaceFlagOverride('the-issue-client-return-hook', wsOff, false);
  // wsNoVerdict: both flags ON so the route passes the flag gate and reaches the null-payload branch.
  setWorkspaceFlagOverride('the-issue-client-spine', wsNoVerdict, true);
  setWorkspaceFlagOverride('the-issue-client-return-hook', wsNoVerdict, true);

  await ctx.startServer();
});

afterAll(async () => {
  for (const id of [wsOn, wsOff, wsNoVerdict]) {
    setWorkspaceFlagOverride('the-issue-client-spine', id, null);
    setWorkspaceFlagOverride('the-issue-client-return-hook', id, null);
  }
  for (const c of cleanups) c();
  await ctx.stopServer();
});

describe('GET /api/public/export/:id/my-leads (requireAuthenticatedClientPortalAuth, A6)', () => {
  it('unauthenticated → 401 and NO PII on the reject path', async () => {
    const res = await api(`/api/public/export/${wsOn}/my-leads`, NO_AUTO);
    expect(res.status).toBe(401);
    const raw = await res.text();
    expect(raw).not.toContain(SENTINEL_NAME);
    expect(raw).not.toContain(SENTINEL_EMAIL);
  });

  it('authenticated → 200, the client sees their OWN leads (PII present)', async () => {
    const res = await api(`/api/public/export/${wsOn}/my-leads`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(Array.isArray(body.leads)).toBe(true);
    expect(body.leads[0].leadName).toBe(SENTINEL_NAME);
    expect(body.leads[0].leadEmail).toBe(SENTINEL_EMAIL);
    expect(body.leads[0]).not.toHaveProperty('leadMessage');
  });

  it('flag-OFF → 404', async () => {
    const res = await api(`/api/public/export/${wsOff}/my-leads`);
    expect(res.status).toBe(404);
  });
});

describe('GET /api/public/export/:id/one-pager (A6)', () => {
  it('authenticated → 200 text/html with the verdict + methodology line', async () => {
    const res = await api(`/api/public/export/${wsOn}/one-pager`);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('text/html');
    const html = await res.text();
    expect(html).toContain('<!DOCTYPE html>');
    expect(html).toMatch(/new patients?|in value/);
    expect(html).toContain('Counts are');
  });

  it('flag-OFF → 404', async () => {
    const res = await api(`/api/public/export/${wsOff}/one-pager`);
    expect(res.status).toBe(404);
  });

  it('flag-ON but no verdict yet → 404 with the "not yet established" message (not a 500 throw)', async () => {
    const res = await api(`/api/public/export/${wsNoVerdict}/one-pager`);
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.error).toMatch(/not yet established/i);
  });
});

describe('D7 — public payloads carry NO lead PII (flag-ON and flag-OFF)', () => {
  it('flag-ON /api/public/roi + /api/public/workspace are PII-free', async () => {
    const roiRaw = await (await api(`/api/public/roi/${wsOn}`)).text();
    const wsRaw = await (await api(`/api/public/workspace/${wsOn}`)).text();
    for (const raw of [roiRaw, wsRaw]) {
      expect(raw).not.toContain(SENTINEL_NAME);
      expect(raw).not.toContain(SENTINEL_EMAIL);
      expect(raw).not.toContain('leadName');
      expect(raw).not.toContain('leadEmail');
      expect(raw).not.toContain('leadMessage');
    }
  });

  it('flag-OFF /api/public/roi + /api/public/workspace are PII-free', async () => {
    const roiRaw = await (await api(`/api/public/roi/${wsOff}`)).text();
    const wsRaw = await (await api(`/api/public/workspace/${wsOff}`)).text();
    for (const raw of [roiRaw, wsRaw]) {
      expect(raw).not.toContain(SENTINEL_NAME);
      expect(raw).not.toContain(SENTINEL_EMAIL);
      expect(raw).not.toContain('leadName');
      expect(raw).not.toContain('leadEmail');
    }
  });
});
