/**
 * SEO Generation Quality — advisory eval fixtures (Phase 0).
 *
 * These scenarios encode acceptance bars for the keyword-strategy generation
 * pipeline. As of P2, fixture (a) — "sparse workspace produces contentGaps >= 6" —
 * is a HARD assertion (the P2 deterministic backfill floor guarantees it). As of
 * P3, fixture (b) — malformed-AI handling — is also PROMOTED to a HARD assertion:
 * the flag-ON path validates with Zod, retries once, then deterministically
 * backfills to a NON-EMPTY content-gap set (never a silent empty); the flag-OFF
 * legacy path still THROWS. The matching fixtures in
 * scripts/ai-reliability-registry.ts (`seo-gen-quality-sparse-content-gaps` and
 * `seo-gen-quality-malformed-ai-throws`) are both `severity: 'hard'` in lockstep.
 *
 * Per docs/rules/ai-quality-evals.md, hard quality fixtures are reserved for
 * authority/output-format/evidence-contract breaks — the never-empty + error-handling
 * bar qualifies as an evidence-grounding contract now that P3 enforces it deterministically.
 *
 * No server port is allocated: this is a deterministic contract test (no
 * createTestContext / HTTP boot), so it leaves no orphan 13xxx port.
 */
import { describe, expect, it } from 'vitest';

import type { GenerationQuality } from '../../shared/types/generation-quality.js';
import {
  backfillContentGapsToFloor,
  STRATEGY_CONTENT_GAP_FLOOR,
} from '../../server/keyword-strategy-helpers.js';
import type { StrategyContentGap } from '../../server/keyword-strategy-ai-synthesis.js';

describe('SEO generation-quality telemetry contract (P0, hard)', () => {
  // The telemetry shape generation emits today. poolSize + aiReturnedCount are
  // knowable now; suppressedCount/backfilledCount/floorHit are P1–P2 (0/false).
  it('GenerationQuality has the typed P0 fields with the documented P1–P2 defaults', () => {
    const sample: GenerationQuality = {
      workspaceId: 'ws-test',
      poolSize: 120,
      aiReturnedCount: 8,
      suppressedCount: 0,
      backfilledCount: 0,
      floorHit: false,
    };

    expect(sample.workspaceId).toBe('ws-test');
    expect(typeof sample.poolSize).toBe('number');
    expect(typeof sample.aiReturnedCount).toBe('number');
    // P1–P2 substrate: present + typed now, populated later.
    expect(sample.suppressedCount).toBe(0);
    expect(sample.backfilledCount).toBe(0);
    expect(sample.floorHit).toBe(false);
  });
});

describe('SEO generation-quality acceptance bars', () => {
  // ── Fixture (a): Faros-like sparse workspace — PROMOTED to a HARD assertion ──
  // ACCEPTANCE BAR: a sparse workspace must produce at least SIX content gaps
  // (contentGaps >= 6), not the "2 gaps" starvation symptom. P2's deterministic
  // backfill floor (server/keyword-strategy-helpers.ts:backfillContentGapsToFloor,
  // wired into generation) GUARANTEES this when >= 6 real candidates exist, so the
  // P0 it.todo is now a real assertion. The end-to-end generation-path proof lives
  // in tests/integration/seo-genquality-p2-backfill-floor-generation.test.ts
  // (flag-ON fills to 6 + tags backfilled; flag-OFF stays at 2). This contract
  // asserts the deterministic GUARANTEE directly (boot-free) on a Faros-like
  // fixture of 2 organic + >= 6 prunable candidates.
  it('sparse Faros-like workspace produces contentGaps >= 6 via the deterministic floor', () => {
    const organic: StrategyContentGap[] = [
      { targetKeyword: 'faros analytics platform', topic: 'Analytics platform', volume: 800, difficulty: 30, opportunityScore: 70 },
      { targetKeyword: 'faros pricing', topic: 'Pricing', volume: 400, difficulty: 15, opportunityScore: 60 },
    ];
    const prunable: StrategyContentGap[] = [
      { targetKeyword: 'faros ci insights', topic: 'CI insights', volume: 1500, difficulty: 25, opportunityScore: 75 },
      { targetKeyword: 'faros deployment frequency', topic: 'Deployment frequency', volume: 900, difficulty: 20, opportunityScore: 65 },
      { targetKeyword: 'faros dora metrics', topic: 'DORA metrics', volume: 1200, difficulty: 28, opportunityScore: 62 },
      { targetKeyword: 'faros engineering benchmarks', topic: 'Benchmarks', volume: 600, difficulty: 22, opportunityScore: 55 },
      { targetKeyword: 'faros lead time tracking', topic: 'Lead time', volume: 300, difficulty: 18, opportunityScore: 48 },
      { targetKeyword: 'faros incident cost', topic: 'Incident cost', volume: 150, difficulty: 12, opportunityScore: 40 },
    ];
    const result = backfillContentGapsToFloor(organic, prunable, STRATEGY_CONTENT_GAP_FLOOR);
    expect(result.gaps.length).toBeGreaterThanOrEqual(6);
    expect(result.gaps.length).toBe(STRATEGY_CONTENT_GAP_FLOOR);
    expect(result.floorHit).toBe(true);
    // Organic gaps stay first + untagged; re-admitted gaps are tagged backfilled.
    expect(result.gaps.slice(0, 2).every(g => !g.backfilled)).toBe(true); // every-ok: length === 6 asserted above
    expect(result.gaps.slice(2).every(g => g.backfilled === true)).toBe(true); // every-ok: length === 6 asserted above
  });

  // ── Fixture (b): malformed AI response — PROMOTED to a HARD assertion at P3 ──
  // P3 changed the flag-ON semantics. The Zod-validated named ops
  // (`keyword-page-assignment` / `keyword-site-synthesis`) validate the parsed
  // payload, retry ONCE on failure, and — when still malformed — fall to a
  // TYPED-EMPTY object whose contentGaps are then deterministically backfilled from
  // the keyword universe to the floor. So on the flag-ON path a malformed AI
  // response yields a NON-EMPTY content-gap set, NOT a throw and NOT silent empty.
  //
  // The flag-OFF legacy path is UNCHANGED: a malformed AI synthesis response makes
  // generation THROW (KeywordStrategySynthesisError → KeywordStrategyGenerationError).
  // The end-to-end proof of both halves lives in
  // tests/integration/seo-genquality-p3-fm2-named-ops.test.ts. This contract asserts
  // the deterministic flag-ON GUARANTEE directly (boot-free): a typed-empty synthesis
  // result, backfilled from the universe candidates, is never empty.
  it('flag-ON malformed synthesis → typed-empty → deterministic backfill is NEVER empty', () => {
    // Simulate the flag-ON "still malformed after retry" branch: master returns the
    // typed-empty object (contentGaps: []). The synthesis-internal backfill then
    // re-admits universe candidates to the floor.
    const typedEmptyContentGaps: StrategyContentGap[] = [];
    const universeBackedCandidates: StrategyContentGap[] = [
      { targetKeyword: 'platform analytics', topic: 'Analytics', volume: 1500, difficulty: 25, opportunityScore: 75 },
      { targetKeyword: 'deployment frequency', topic: 'Deployment', volume: 900, difficulty: 20, opportunityScore: 65 },
      { targetKeyword: 'dora metrics', topic: 'DORA', volume: 1200, difficulty: 28, opportunityScore: 62 },
      { targetKeyword: 'engineering benchmarks', topic: 'Benchmarks', volume: 600, difficulty: 22, opportunityScore: 55 },
      { targetKeyword: 'lead time tracking', topic: 'Lead time', volume: 300, difficulty: 18, opportunityScore: 48 },
      { targetKeyword: 'incident cost', topic: 'Incident cost', volume: 150, difficulty: 12, opportunityScore: 40 },
    ];
    const result = backfillContentGapsToFloor(typedEmptyContentGaps, universeBackedCandidates, STRATEGY_CONTENT_GAP_FLOOR);
    // NEVER empty — the floor fills the typed-empty set from the universe.
    expect(result.gaps.length).toBeGreaterThan(0);
    expect(result.gaps.length).toBe(STRATEGY_CONTENT_GAP_FLOOR);
    expect(result.floorHit).toBe(true);
    expect(result.gaps.every(g => g.backfilled === true)).toBe(true); // every-ok: length === floor asserted above
  });
});
