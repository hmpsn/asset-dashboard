/**
 * The Issue — operator-steering REGEN survival (THE TRUST-CRITICAL TEST).
 *
 * The whole batch's promise is that the operator's three verbs survive the weekly regen that
 * re-mints the recommendation set. This file drives a REAL generateRecommendations() over a
 * minimally-seeded workspace (no audit/traffic → an empty `newSources`, so any seeded existing
 * rec whose source isn't re-detected hits the auto-resolve loop) and asserts:
 *
 *   (a) a `manual:` operator-minted rec SURVIVES regen (NOT auto-resolved to 'completed') — the
 *       new retention branch keeps it; the operator owns its lifecycle.
 *   (b) a `competitor:` rec SURVIVES regen — the SAME retention branch fixes the live
 *       pre-existing bug where an un-sent competitor rec silently auto-completed on the next regen.
 *   (c) a normal pending rec (`audit:title`) whose source vanished STILL auto-resolves to
 *       'completed' — the CONTROL: retention is scoped to operator-minted recs only, not a
 *       blanket "never auto-resolve".
 *   (d) NO BAKING: a wording override applied to a rec does NOT change loadRecommendations() —
 *       the stored blob keeps the SOURCE wording (overrides apply only at display boundaries).
 *
 * Drives a real regen (not a focused harness): generateRecommendations tolerates a bare workspace
 * (same as tests/integration/keeper-override.test.ts), so the actual auto-resolve loop runs.
 * In-process server modules share the test DATA_DIR. Full cleanup, no git writes.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import db from '../../server/db/index.js';
import { setBroadcast } from '../../server/broadcast.js';
import { seedWorkspace, type SeededFullWorkspace } from '../fixtures/workspace-seed.js';
import {
  saveRecommendations,
  loadRecommendations,
  computeRecommendationSummary,
  generateRecommendations,
  isOperatorMintedRec,
} from '../../server/recommendations.js';
import { setWordingOverride } from '../../server/rec-operator-overrides.js';
import type { Recommendation, RecommendationSet } from '../../shared/types/recommendations.js';

let seeded: SeededFullWorkspace;
let wsId = '';

function rec(overrides: Partial<Recommendation> = {}): Recommendation {
  const now = new Date().toISOString();
  return {
    id: 'r', workspaceId: wsId, priority: 'fix_soon', type: 'metadata',
    title: 'T', description: 'd', insight: 'Source insight', impact: 'medium', effort: 'medium',
    impactScore: 50, source: 'audit:title', affectedPages: [], trafficAtRisk: 0,
    impressionsAtRisk: 0, estimatedGain: 'g', actionType: 'manual',
    status: 'pending', createdAt: now, updatedAt: now, ...overrides,
  };
}

function seedSet(recs: Recommendation[]): void {
  const set: RecommendationSet = {
    workspaceId: wsId,
    generatedAt: new Date().toISOString(),
    recommendations: recs,
    summary: computeRecommendationSummary(recs),
  };
  saveRecommendations(set);
}

beforeAll(() => {
  // generateRecommendations calls broadcastToWorkspace, which throws unless the WS server's
  // setBroadcast() has run. This is an in-process regen (no spawned server), so wire a no-op
  // broadcast — we assert on the persisted rec set, not on emitted events.
  setBroadcast(() => {}, () => {});
  // No webflow site / audit → generateRecommendations produces a near-empty newSources,
  // exercising the auto-resolve loop against our seeded existing recs.
  seeded = seedWorkspace({ webflowToken: '' });
  wsId = seeded.workspaceId;
});

afterAll(() => {
  db.prepare('DELETE FROM rec_operator_override WHERE workspace_id = ?').run(wsId);
  db.prepare('DELETE FROM recommendation_sets WHERE workspace_id = ?').run(wsId);
  seeded.cleanup();
});

describe('isOperatorMintedRec', () => {
  it('classifies manual: and competitor: sources as operator-minted; others not', () => {
    expect(isOperatorMintedRec({ source: 'manual:abc123' })).toBe(true);
    expect(isOperatorMintedRec({ source: 'competitor:some keyword' })).toBe(true);
    expect(isOperatorMintedRec({ source: 'audit:title' })).toBe(false);
    expect(isOperatorMintedRec({ source: 'strategy:content-gap' })).toBe(false);
    expect(isOperatorMintedRec({ source: 'keyword_gap:foo' })).toBe(false);
  });
});

describe('operator-minted recs survive the weekly regen (trust-critical)', () => {
  it('manual + competitor recs survive; a normal source-gone rec auto-resolves (control)', async () => {
    seedSet([
      rec({ id: 'manual_rec', source: `manual:${'a'.repeat(12)}`, clientStatus: 'system', lifecycle: 'active' }),
      rec({ id: 'competitor_rec', source: 'competitor:enterprise crm', type: 'competitor', targetKeyword: 'enterprise crm', clientStatus: 'system', lifecycle: 'active' }),
      // CONTROL: an ordinary pending audit rec whose check is NOT re-detected this run.
      rec({ id: 'control_rec', source: 'audit:title-missing-xyz', affectedPages: ['orphan-page-xyz'] }),
    ]);

    await generateRecommendations(wsId);

    const after = loadRecommendations(wsId);
    expect(after).not.toBeNull();
    const byId = new Map(after!.recommendations.map(r => [r.id, r]));

    // (a) manual rec retained — present, NOT completed, and the two-axis curation fields preserved.
    const manual = byId.get('manual_rec');
    expect(manual, 'manual rec must survive regen').toBeDefined();
    expect(manual!.status).not.toBe('completed');
    expect(manual!.source.startsWith('manual:')).toBe(true);
    expect(manual!.clientStatus).toBe('system');
    expect(manual!.lifecycle).toBe('active');

    // (b) competitor rec retained — present, NOT completed (the bug fix), two-axis preserved.
    const competitor = byId.get('competitor_rec');
    expect(competitor, 'competitor rec must survive regen (bug fix)').toBeDefined();
    expect(competitor!.status).not.toBe('completed');
    expect(competitor!.source.startsWith('competitor:')).toBe(true);
    expect(competitor!.clientStatus).toBe('system');
    expect(competitor!.lifecycle).toBe('active');

    // (c) CONTROL: the ordinary audit rec whose source vanished auto-resolves to completed.
    const control = byId.get('control_rec');
    expect(control, 'control rec must still be present (as completed)').toBeDefined();
    expect(control!.status).toBe('completed');
  });
});

describe('no baking — overrides never write into the stored blob', () => {
  it('a wording override leaves loadRecommendations() returning the SOURCE wording', () => {
    seedSet([rec({ id: 'baking_rec', title: 'Source title', insight: 'Source insight' })]);

    setWordingOverride(wsId, 'baking_rec', { title: 'Operator-corrected', insight: 'Operator insight' });

    // loadRecommendations is PURE — the base blob is untouched by the override.
    const loaded = loadRecommendations(wsId);
    const stored = loaded!.recommendations.find(r => r.id === 'baking_rec')!;
    expect(stored.title).toBe('Source title');
    expect(stored.insight).toBe('Source insight');
  });

  it('the override is STILL not baked after a full regen cycle', async () => {
    // A manual rec is retained as-is across regen (the {...oldRec} retain branch reads the pure base
    // blob). With a wording override applied, the regen must NOT bake the override into the stored
    // rec — the override lives only in rec_operator_override and applies at display boundaries.
    seedSet([rec({
      id: 'bake_regen', source: `manual:${'b'.repeat(12)}`, clientStatus: 'system', lifecycle: 'active',
      title: 'Regen source title', insight: 'Regen source insight',
    })]);
    setWordingOverride(wsId, 'bake_regen', { title: 'Operator title', insight: 'Operator insight' });

    await generateRecommendations(wsId);

    const stored = loadRecommendations(wsId)!.recommendations.find(r => r.id === 'bake_regen')!;
    expect(stored.title).toBe('Regen source title');   // override NOT baked in across regen
    expect(stored.insight).toBe('Regen source insight');
  });
});
