/**
 * D3 — Public read-path gate for The Issue (Client) P0.
 *
 * Exercises the PUBLIC routes (GET /api/public/roi/:id and GET /api/public/workspace/:id),
 * NOT the admin GET, so a fixture-masked serialization regression on a money surface is caught.
 *
 * Distinct workspaces per flag state (overrides set BEFORE the server starts) so the child
 * server reads the fresh DB value on first access and the 10s per-workspace flag cache can't
 * leak a toggle across cases.
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

// ON + outcomeValue set + GA4 conversions → hydrated verdict.
let wsOn: string;
// OFF + outcomeValue set → byte-identical (no verdict).
let wsOff: string;
// ON but outcomeValue unset → honest degradation (no verdict).
let wsOnNoValue: string;
const cleanups: Array<() => void> = [];

function seedRoiCpcData(wsId: string): void {
  upsertPageKeywordsBatch(wsId, [{
    pagePath: '/services', pageTitle: 'Services', primaryKeyword: 'dentist near me',
    secondaryKeywords: [], clicks: 100, impressions: 1000, cpc: 3.5,
  }]);
  updateWorkspace(wsId, { eventConfig: [{ eventName: 'phone_call', displayName: 'Calls', pinned: true }] });
}

beforeAll(async () => {
  const sOn = seedWorkspace(); wsOn = sOn.workspaceId; cleanups.push(sOn.cleanup);
  const sOff = seedWorkspace(); wsOff = sOff.workspaceId; cleanups.push(sOff.cleanup);
  const sOnNo = seedWorkspace(); wsOnNoValue = sOnNo.workspaceId; cleanups.push(sOnNo.cleanup);

  for (const id of [wsOn, wsOff, wsOnNoValue]) seedRoiCpcData(id);

  // ON ws — outcomeValue set + a current GA4 snapshot of 14 conversions.
  updateWorkspace(wsOn, { outcomeValue: { valuePerOutcome: 800, unitLabel: 'new patient', currency: 'USD', basis: 'agency_estimate', monthlyRetainer: 1500 } });
  saveGa4Snapshot({ workspaceId: wsOn, capturedAt: new Date().toISOString(), totalConversions: 14, totalUsers: 200, byEvent: [{ eventName: 'phone_call', conversions: 14, users: 200, rate: 7 }] });
  setWorkspaceFlagOverride('the-issue-client-spine', wsOn, true);

  // OFF ws — outcomeValue + GA4 set, but the flag is OFF → no verdict (byte-identical).
  updateWorkspace(wsOff, { outcomeValue: { valuePerOutcome: 800, unitLabel: 'new patient', currency: 'USD', basis: 'agency_estimate', monthlyRetainer: 1500 } });
  saveGa4Snapshot({ workspaceId: wsOff, capturedAt: new Date().toISOString(), totalConversions: 14, totalUsers: 200, byEvent: [{ eventName: 'phone_call', conversions: 14, users: 200, rate: 7 }] });
  setWorkspaceFlagOverride('the-issue-client-spine', wsOff, false);

  // ON-but-no-value ws — flag ON, outcomeValue UNSET → honest degradation.
  setWorkspaceFlagOverride('the-issue-client-spine', wsOnNoValue, true);

  await ctx.startServer();
});

afterAll(async () => {
  setWorkspaceFlagOverride('the-issue-client-spine', wsOn, null);
  setWorkspaceFlagOverride('the-issue-client-spine', wsOff, null);
  setWorkspaceFlagOverride('the-issue-client-spine', wsOnNoValue, null);
  for (const c of cleanups) c();
  await ctx.stopServer();
});

describe('GET /api/public/roi — outcomeVerdict gate', () => {
  it('flag-OFF + outcomeValue set → raw response omits outcomeVerdict (byte-identical)', async () => {
    const res = await api(`/api/public/roi/${wsOff}`);
    expect(res.status).toBe(200);
    const raw = await res.text();
    expect(raw).not.toContain('outcomeVerdict');
    expect(raw).not.toContain('estimatedValue');
    expect(raw).toContain('organicTrafficValue'); // legacy payload still present
  });

  it('flag-ON but outcomeValue unset → no outcomeVerdict (honest degradation)', async () => {
    const res = await api(`/api/public/roi/${wsOnNoValue}`);
    expect(res.status).toBe(200);
    const body = await res.json() as { outcomeVerdict?: unknown };
    expect(body.outcomeVerdict).toBeUndefined();
  });

  it('flag-ON + outcomeValue + a current GA4 snapshot → hydrated estimate_ga4 verdict, no P1 leakage', async () => {
    const res = await api(`/api/public/roi/${wsOn}`);
    expect(res.status).toBe(200);
    const raw = await res.text();
    const body = JSON.parse(raw) as { outcomeVerdict?: { outcomeCount: number; estimatedValue: number; monthlyRetainer: number | null; provenance: string } };
    expect(body.outcomeVerdict?.outcomeCount).toBe(14);
    expect(body.outcomeVerdict?.estimatedValue).toBe(14 * 800);
    expect(body.outcomeVerdict?.monthlyRetainer).toBe(1500);
    expect(body.outcomeVerdict?.provenance).toBe('estimate_ga4');
    // No P1 leakage in the P0 payload.
    expect(raw).not.toContain('actual_reconciled');
    expect(raw).not.toContain('contactName');
  });
});

describe('GET /api/public/workspace/:id — segmentProfile lockstep', () => {
  it('flag-OFF → raw text omits segmentProfile', async () => {
    const res = await api(`/api/public/workspace/${wsOff}`);
    expect(res.status).toBe(200);
    const raw = await res.text();
    expect(raw).not.toContain('segmentProfile');
  });

  it('flag-ON → segmentProfile present', async () => {
    const res = await api(`/api/public/workspace/${wsOn}`);
    expect(res.status).toBe(200);
    const body = await res.json() as { segmentProfile?: { segment: string } };
    expect(body.segmentProfile).toBeDefined();
    expect(body.segmentProfile?.segment).toBeTruthy();
  });
});
