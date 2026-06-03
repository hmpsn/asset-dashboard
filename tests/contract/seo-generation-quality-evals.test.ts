/**
 * SEO Generation Quality — advisory eval fixtures (Phase 0).
 *
 * These two scenarios encode FUTURE acceptance bars for the keyword-strategy
 * generation pipeline. They are intentionally ADVISORY at P0: the acceptance
 * assertions are `it.todo` (logged, never executed → can never fail CI) until
 * the phase that implements them lands, at which point they are promoted to real
 * assertions. The matching soft fixtures in scripts/ai-reliability-registry.ts
 * (`seo-gen-quality-sparse-content-gaps`, `seo-gen-quality-malformed-ai-throws`)
 * are `severity: 'soft'` so a RED contract surfaces as an advisory warning in
 * `npm run verify:ai-quality`, never a hard CI failure.
 *
 * Why advisory at P0: per docs/rules/ai-quality-evals.md, hard quality fixtures
 * are reserved for authority/output-format/evidence-contract breaks; these encode
 * a generation-volume + error-handling bar that is RED until P1–P3 resolve input
 * starvation and add Zod-validated never-empty handling. P0 is pure infrastructure.
 *
 * No server port is allocated: this is a deterministic contract test (no
 * createTestContext / HTTP boot), so it leaves no orphan 13xxx port.
 */
import { describe, expect, it } from 'vitest';

import type { GenerationQuality } from '../../shared/types/generation-quality.js';

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

describe('SEO generation-quality acceptance bars (P0, advisory — RED until later phases)', () => {
  // ── Fixture (a): Faros-like sparse workspace ───────────────────────────────
  // ACCEPTANCE BAR: a sparse provider-backed workspace must produce at least
  // SIX content gaps (contentGaps >= 6), not the "2 gaps" starvation symptom.
  // RED today: input starvation (provider gating + whole-pool-US geo) is not yet
  // fixed. This is the P1–P2 acceptance bar.
  //
  // TODO(P1–P2): PROMOTE to a hard assertion once buildKeywordUniverse (P1) +
  // the un-suppress/deterministic-backfill-floor (P2) land. Seed a sparse
  // provider-backed workspace, generate a strategy, and assert
  // result.strategy.contentGaps.length >= 6 (the soft floor) and
  // result.generationQuality.poolSize > 0.
  it.todo(
    'sparse Faros-like workspace produces contentGaps >= 6 (PROMOTE to hard-fail when P1–P2 land)',
  );

  // ── Fixture (b): malformed AI response ─────────────────────────────────────
  // ACCEPTANCE BAR: when the synthesis AI returns a malformed / unparseable
  // payload, the generation path must THROW (a KeywordStrategyGenerationError),
  // NOT silently return an empty strategy. A silent empty is the worst failure
  // mode — it under-serves with no signal.
  // RED today: neither keyword op has post-parse Zod validation, so a
  // malformed-but-parseable response can yield empty contentGaps without error.
  //
  // TODO(P3): PROMOTE to a hard assertion once the Zod-validated named ops land.
  // Mock the synthesis AI to return a malformed response and assert
  // generateKeywordStrategy(...) rejects (throws) rather than resolving with an
  // empty strategy. (P3 then changes the contract to retry-once → deterministic
  // backfill → never-empty; update this bar accordingly at P3.)
  it.todo(
    'malformed AI synthesis response makes generation THROW, not return empty (PROMOTE to hard-fail at P3)',
  );
});
