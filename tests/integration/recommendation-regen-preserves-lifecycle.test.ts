/**
 * Strategy v3 Phase 1 exit gate (00-contracts §6.3, spec §6.3 / audit prevention #3).
 *
 * Suite A — carry-over (pure merge helper):
 *   Carry-over: send a rec (clientStatus='sent'), run a regen merge, assert clientStatus
 *   is STILL 'sent' afterward. Guards the merge carry-over at recommendations.ts ~2364-2382,
 *   which pre-v3 copied only status/id/createdAt and would silently drop the lifecycle axis.
 *   Uses applyLifecycleCarryOver directly (the pure merge helper) so the test is fast +
 *   deterministic — no full generateRecommendations crawl.
 *
 * Suite B — vanishing-source regen (full generateRecommendations path):
 *   A sent/discussing/approved rec whose source condition clears during regen must be RETAINED
 *   (not auto-resolved to 'completed', not silently dropped). This is the trust-critical bug
 *   fixed in Phase 1 (§6.5): the auto-resolve loop now pushes exempt recs into the output
 *   when their source is absent from newSources. Guards generateRecommendations lines ~2459-2461.
 *
 *   Companion assertion: a NON-exempt (pending) rec whose source vanishes IS auto-resolved to
 *   'completed', proving the fix did not break the normal auto-resolve path.
 */

// ── Hoisted module-level mocks ───────────────────────────────────────────────
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

vi.mock('../../server/broadcast.js', () => ({
  broadcastToWorkspace: vi.fn(),
  broadcast: vi.fn(),
  setBroadcast: vi.fn(),
}));

vi.mock('../../server/analytics-insights-store.js', () => ({
  getInsights: vi.fn(() => []),
}));

vi.mock('../../server/diagnostic-store.js', () => ({
  listDiagnosticReports: vi.fn(() => []),
}));

vi.mock('../../server/intelligence/generation-context-builders.js', () => ({
  buildRecommendationGenerationContext: vi.fn(async () => ({
    intelligence: {
      learnings: null,
      seoContext: { backlinkProfile: null },
    },
  })),
}));

// ── Imports (after vi.mock declarations) ─────────────────────────────────────
import {
  applyLifecycleCarryOver,
  generateRecommendations,
  saveRecommendations,
  loadRecommendations,
  computeRecommendationSummary,
} from '../../server/recommendations.js';
import { sendRecommendation } from '../../server/recommendation-lifecycle.js';
import { replaceAllQuickWins, deleteAllQuickWins } from '../../server/quick-wins.js';
import { createWorkspace, deleteWorkspace, updateWorkspace } from '../../server/workspaces.js';
import type { Recommendation, RecommendationSet } from '../../shared/types/recommendations.js';
import type { QuickWin } from '../../shared/types/workspace.js';

// ─────────────────────────────────────────────────────────────────────────────
// Suite A — applyLifecycleCarryOver (fast, deterministic, pure helper)
// ─────────────────────────────────────────────────────────────────────────────

function rec(overrides: Partial<Recommendation> = {}): Recommendation {
  const now = new Date().toISOString();
  return {
    id: 'old1', workspaceId: 'ws1', priority: 'fix_now', type: 'metadata',
    title: 'Fix meta', description: 'd', insight: 'i', impact: 'high', effort: 'low',
    impactScore: 50, source: 'audit:meta', affectedPages: ['home'], trafficAtRisk: 0,
    impressionsAtRisk: 0, estimatedGain: 'g', actionType: 'manual',
    status: 'pending', createdAt: now, updatedAt: now, ...overrides,
  };
}

describe('regen preserves the client-facing lifecycle axis', () => {
  it('carries clientStatus=sent + sentAt onto the freshly-minted matching rec', () => {
    const sentAt = new Date(Date.now() - 3_600_000).toISOString();
    const oldRec = rec({ id: 'old1', clientStatus: 'sent', sentAt, status: 'pending' });
    // a freshly-minted rec from the new run with the SAME merge key (source+pages+title)
    const newRec = rec({ id: 'new1', status: 'pending' });

    applyLifecycleCarryOver([newRec], [oldRec]);

    expect(newRec.clientStatus).toBe('sent');
    expect(newRec.sentAt).toBe(sentAt);
    expect(newRec.id).toBe('old1'); // continuity: keep the old id
  });

  it('carries struck + throttled lifecycle and cascade metadata across a regen', () => {
    const struckAt = new Date(Date.now() - 7_200_000).toISOString();
    const oldStruck = rec({ id: 'old2', source: 'audit:keyword', title: 'kw', lifecycle: 'struck', struckAt, cascade: { removedKeywords: ['foo'], reversible: true } });
    const newStruck = rec({ id: 'new2', source: 'audit:keyword', title: 'kw' });

    applyLifecycleCarryOver([newStruck], [oldStruck]);

    expect(newStruck.lifecycle).toBe('struck');
    expect(newStruck.struckAt).toBe(struckAt);
    expect(newStruck.cascade?.removedKeywords).toEqual(['foo']);
  });

  it('leaves a brand-new rec with no matching old rec untouched (no lifecycle injected)', () => {
    const fresh = rec({ id: 'fresh', source: 'audit:new-check', title: 'new' });
    applyLifecycleCarryOver([fresh], []);
    expect(fresh.clientStatus).toBeUndefined();
    expect(fresh.lifecycle).toBeUndefined();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Suite B — vanishing-source regen (full generateRecommendations path)
//
// This suite exercises the trust-critical bug fix (§6.5): when a sent rec's
// source condition clears on the next regen, the rec must be RETAINED in the
// output set — not auto-resolved to 'completed' (the pre-fix behaviour was a
// bare `continue` that caused a silent DROP instead).
// ─────────────────────────────────────────────────────────────────────────────

describe('vanishing-source regen — exempt recs are retained, non-exempt are auto-resolved', () => {
  // Each test gets its own workspace so lifecycle state from one run cannot bleed into another.
  let wsId = '';

  beforeEach(() => {
    wsId = createWorkspace('Regen Vanishing Source Test').id;
    // keywordStrategy must be set for the strategy branch (quick-win producer) to run.
    updateWorkspace(wsId, {
      keywordStrategy: {
        generatedAt: '2026-05-20T00:00:00.000Z',
        siteKeywords: [],
        opportunities: [],
      },
    });
  });

  afterEach(() => {
    deleteAllQuickWins(wsId);
    deleteWorkspace(wsId);
    wsId = '';
  });

  /**
   * Primary regression guard: a sent rec whose source vanishes on regen must be
   * RETAINED (preserved as-is, clientStatus='sent', status unchanged from pending).
   *
   * To prove the fix is load-bearing: without lines ~2459-2461 of recommendations.ts
   * (the `if (!newSources.has(buildMergeKey(oldRec))) recs.push({ ...oldRec })` branch),
   * the sent rec would be skipped by the bare `continue` and dropped from the output set.
   * This test would then fail at `expect(sentRecAfter).toBeDefined()`.
   */
  it('retains a sent rec (clientStatus=sent) when its source vanishes on regen', async () => {
    // ── Run 1: seed a quick-win → generateRecommendations produces a strategy:quick-win rec ──
    const quickWin: QuickWin = {
      pagePath: '/services/emergency-audit',
      action: 'Fix page title keyword alignment',
      estimatedImpact: 'high',
      rationale: 'Top keyword absent from title tag.',
    };
    replaceAllQuickWins(wsId, [quickWin]);

    const run1 = await generateRecommendations(wsId);
    const quickWinRec = run1.recommendations.find(r => r.source === 'strategy:quick-win');
    expect(quickWinRec).toBeDefined();

    // ── Mark the rec as sent ──
    const sentRec = sendRecommendation(wsId, quickWinRec!.id);
    expect(sentRec?.clientStatus).toBe('sent');

    // ── Run 2: clear quick-wins → source is gone ──
    deleteAllQuickWins(wsId);

    const run2 = await generateRecommendations(wsId);

    // The sent rec must still be present in the output set (the fix under test).
    const sentRecAfter = run2.recommendations.find(r => r.id === quickWinRec!.id);
    expect(sentRecAfter).toBeDefined();
    expect(sentRecAfter!.clientStatus).toBe('sent');
    // RecStatus must NOT have been mutated to 'completed' by the auto-resolve sweep.
    expect(sentRecAfter!.status).not.toBe('completed');
    // The retained rec must also not have been added to the autoResolvedRecs path
    // (i.e. it should not have the auto-resolve insight prefix injected).
    expect(sentRecAfter!.insight).not.toMatch(/Auto-resolved/);
  });

  /**
   * Companion: a NON-exempt (pending, clientStatus absent) rec whose source vanishes on
   * regen IS auto-resolved to 'completed'. This proves the fix did not accidentally disable
   * the normal auto-resolve path — only exempt recs are exempted.
   */
  it('auto-resolves a non-exempt pending rec whose source vanishes (normal path intact)', async () => {
    // ── Run 1: seed a quick-win, generate, leave the rec as pending (no send) ──
    const quickWin: QuickWin = {
      pagePath: '/services/normal-audit',
      action: 'Add structured data markup',
      estimatedImpact: 'medium',
      rationale: 'No schema on service page.',
    };
    replaceAllQuickWins(wsId, [quickWin]);

    const run1 = await generateRecommendations(wsId);
    const pendingRec = run1.recommendations.find(r => r.source === 'strategy:quick-win');
    expect(pendingRec).toBeDefined();
    // clientStatus is absent on a freshly-generated rec (not yet sent) — non-exempt.
    expect(pendingRec!.clientStatus).toBeUndefined();

    // ── Run 2: clear quick-wins → source vanishes, rec is NOT exempt → auto-resolve ──
    deleteAllQuickWins(wsId);

    const run2 = await generateRecommendations(wsId);

    // The rec should now be auto-resolved to 'completed' (normal path).
    const resolvedRec = run2.recommendations.find(r => r.id === pendingRec!.id);
    expect(resolvedRec).toBeDefined();
    expect(resolvedRec!.status).toBe('completed');
    // The auto-resolve insight prefix must be present.
    expect(resolvedRec!.insight).toMatch(/Auto-resolved/);
  });
});
