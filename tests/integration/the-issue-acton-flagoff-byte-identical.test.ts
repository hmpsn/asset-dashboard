/**
 * Audit-resolution launch PR — Blocker 1, the #1 scrutiny target (Lane E).
 *
 * FLAG-OFF BYTE-IDENTICAL GUARD. With `strategy-the-issue` OFF for a workspace, the public
 * recommendation projection (`GET /api/public/recommendations/:workspaceId`) must carry NO `actOn`
 * descriptor on ANY rec — deep-assert its ABSENCE (the key must not exist, not merely be undefined),
 * exactly like the restricted `clientStatus` / `delivered` projection is absent when the flag is off.
 *
 * A flag-ON artifact leaking into the flag-OFF path is the named #1 regression hazard for this PR,
 * so this test asserts absence both as a raw-string scan AND as an own-property check on every rec.
 *
 * Exercises the REAL public read path (per CLAUDE.md: integration tests gate the public endpoint,
 * not the admin GET).
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { seedWorkspace } from '../fixtures/workspace-seed.js';
import { setWorkspaceFlagOverride } from '../../server/feature-flags.js';
import { createEphemeralTestContext } from './helpers.js';
import {
  saveRecommendations,
  loadRecommendations,
  computeRecommendationSummary,
} from '../../server/recommendations.js';
import type { Recommendation, RecommendationSet } from '../../shared/types/recommendations.js';

const ctx = createEphemeralTestContext(import.meta.url);
const { api } = ctx;

let workspaceId = '';
let cleanupWorkspace: (() => void) | undefined;

const now = () => new Date().toISOString();

function seedRec(recId: string, overrides: Partial<Recommendation> = {}): void {
  const ts = now();
  const rec: Recommendation = {
    id: recId,
    workspaceId,
    priority: 'fix_now',
    type: 'content', // monetizable — the type whose actOn descriptor would be computed when flag ON
    title: `Rec ${recId}`,
    description: 'desc',
    insight: 'why this matters to the client',
    impact: 'high',
    effort: 'low',
    impactScore: 60,
    source: 'audit:content',
    affectedPages: ['/blog/example'],
    trafficAtRisk: 10,
    impressionsAtRisk: 500,
    estimatedGain: 'Could capture meaningful organic demand',
    actionType: 'manual',
    targetKeyword: `keyword-${recId}`,
    status: 'pending',
    clientStatus: 'sent',
    sentAt: ts,
    lifecycle: 'active',
    createdAt: ts,
    updatedAt: ts,
    ...overrides,
  };
  const existing = loadRecommendations(workspaceId);
  const prior: Recommendation[] = existing
    ? existing.recommendations.filter((r) => r.id !== recId)
    : [];
  const recs = [...prior, rec];
  const set: RecommendationSet = {
    workspaceId,
    generatedAt: ts,
    recommendations: recs,
    summary: computeRecommendationSummary(recs),
  };
  saveRecommendations(set);
}

beforeAll(async () => {
  await ctx.startServer();
  // Passwordless portal so the public GET passes through without a token.
  const seeded = seedWorkspace({ clientPassword: '' });
  workspaceId = seeded.workspaceId;
  cleanupWorkspace = seeded.cleanup;
  // The named scrutiny target: strategy-the-issue is OFF (explicit override to false for clarity;
  // the default is also false). The public read must be byte-identical to the legacy payload.
  setWorkspaceFlagOverride('strategy-the-issue', workspaceId, false);
}, 25_000);

afterAll(async () => {
  setWorkspaceFlagOverride('strategy-the-issue', workspaceId, null);
  await ctx.stopServer();
  cleanupWorkspace?.();
});

describe('flag-OFF: actOn descriptor is ABSENT from the public projection (byte-identical guard)', () => {
  it('no rec in the public read carries an actOn key when strategy-the-issue is OFF', async () => {
    // Seed a monetizable (content) rec in every relevant post-send state — each would receive an
    // actOn descriptor on the flag-ON path; none may have it on the flag-OFF path.
    seedRec('rec_off_sent', { clientStatus: 'sent', sentAt: now() });
    seedRec('rec_off_approved', { clientStatus: 'approved' });
    seedRec('rec_off_discussing', { clientStatus: 'discussing' });

    const res = await api(`/api/public/recommendations/${workspaceId}`);
    expect(res.status).toBe(200);
    const raw = await res.text();

    // (1) Raw-string scan: the descriptor's field name must not appear anywhere in the payload.
    expect(raw).not.toContain('actOn');

    // (2) Deep own-property check on every projected rec: the key is ABSENT, not merely undefined.
    const body = JSON.parse(raw) as { recommendations: Array<Record<string, unknown>> };
    expect(body.recommendations.length).toBeGreaterThan(0);
    for (const rec of body.recommendations) {
      expect(Object.prototype.hasOwnProperty.call(rec, 'actOn')).toBe(false);
      // The companion restricted-clientStatus projection is likewise absent when the flag is off
      // (this is the exact gating actOn mirrors — proving the two stay in lockstep).
      expect(Object.prototype.hasOwnProperty.call(rec, 'clientStatus')).toBe(false);
    }
  });

  it('the ?clientStatus filter is also inert when the flag is OFF (no actOn, legacy payload)', async () => {
    seedRec('rec_off_filter', { clientStatus: 'sent', sentAt: now() });
    // Flag OFF → the ?clientStatus filter does not apply and no actOn descriptor is projected.
    const res = await api(`/api/public/recommendations/${workspaceId}?clientStatus=sent`);
    expect(res.status).toBe(200);
    const raw = await res.text();
    expect(raw).not.toContain('actOn');
    const body = JSON.parse(raw) as { recommendations: Array<Record<string, unknown>> };
    for (const rec of body.recommendations) {
      expect(Object.prototype.hasOwnProperty.call(rec, 'actOn')).toBe(false);
    }
  });
});
