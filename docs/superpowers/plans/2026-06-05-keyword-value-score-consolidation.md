# Keyword Value Score Consolidation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.
>
> **Plan style — contract+test-centric (project rule, overrides the skill's "full impl code" default):** each task pins the contract (signatures, behavior, file:line anchors) + the concrete tests (tests ARE the spec) + constraints + verification. Implementation *bodies* are written at execution against the real code.

**Goal:** Route both value scorers through **one keyword intent classifier** (`deriveValueIntent`) and formalize the Layer 1 → Layer 2 contract, closing the `comparison`-intent drift (0.7 Hub vs 0.5 recs) and the duplicated classification, with no behavior change beyond the intended full-derive correction.

**Architecture:** Approach ① — a shared classification core. `deriveValueIntent` (already in `server/scoring/keyword-value-score.ts`) becomes the single intent→4-bucket path; `toOpportunityIntent` and the inline copy are retired. A Layer-1 component-exposure interface (`computeKeywordValueComponents`) gives one value-component vocabulary. No feature flag; safety = a behavior-preserving full-object OV parity test + staging regen.

**Tech Stack:** TypeScript (strict, NodeNext ESM `.js` suffixes), Vitest. Spec: `docs/superpowers/specs/2026-06-05-keyword-value-score-consolidation-design.md`. Baseline: staging `8f9c7751` (post #1100).

---

## Agent platform & model assignments (Claude/Anthropic)

| PR | Work | Implement | Review |
|---|---|---|---|
| PR 1 (classifier + contract) | behavior-changing, drift-sensitive, touches the canonical OV rec path | **Opus** | **Opus** adversarial (full-object parity, all 4 sites migrated, value-inert sites zero-change, import direction) |
| PR 2 (component interface) | output-neutral additive interface | **Sonnet** | **Opus** adversarial (score parity incl. gated `undefined`, 4 scalar callers unaffected) |

## Task dependency graph

```
PR 1 (shared intent classifier + contract)  ──>  PR 2 (Layer-1 component-exposure interface)
PR 2 depends on PR 1 only for a clean base; they touch mostly different code. Ship PR 1 → staging green → PR 2.
```

Phase-per-PR (CLAUDE.md): PR 2 not opened until PR 1 is merged to `staging` + CI green.

## File ownership

- **PR 1:** `server/recommendations.ts` (migrate 3 sites + retire `toOpportunityIntent`), `server/keyword-strategy-enrichment.ts` (migrate inline `:611`), `server/scoring/keyword-value-score.ts` (confirm `deriveValueIntent` exported), `docs/rules/keyword-command-center.md` (contract note), `tests/unit/keyword-value-intent-consolidation.test.ts` (new), `tests/unit/recommendations*`/`opportunity-value*` (extend parity).
- **PR 2:** `server/scoring/keyword-value-score.ts` (sibling + wrapper), `tests/unit/keyword-value-score.test.ts` (extend).

## Systemic improvements (in-scope)

- **One classifier** — `deriveValueIntent` is the single intent→4-bucket path; `toOpportunityIntent` + the inline copy deleted. Prevents future drift by construction.
- **Contract doc** — `docs/rules/keyword-command-center.md` records the Layer 1 → Layer 2 spine + surface ownership + "one classifier" rule, so future code doesn't re-add a parallel coercion.
- **Full-object parity test** — a reusable OV before/after harness (full `OpportunityScore` + `topOpportunityRationale`) that any future OV change can reuse.

## Definition-of-done gates (every PR)

- [ ] `npm run typecheck` 0 · `npx vite build` ok
- [ ] `npx vitest run <new/changed>` + `recommendations*` `opportunity-value*` `keyword-value-score*` `keyword-command-center*` green; **red observed** for each new test pre-impl
- [ ] `npx tsx scripts/pr-check.ts` 0 (note the #1100 rule "recommendation impactScore must flow from canonical OV scorer" — do not violate)
- [ ] `npm run verify:coverage-ratchet` no regression · kill orphan 13xxx ports
- [ ] Adversarial review run; Critical/Important fixed in the same PR
- [ ] One PR per phase, merged to `staging` + CI green before the next
- [ ] PR 1: `FEATURE_AUDIT.md` + `data/roadmap.json` (`kwv-one-score-everywhere` notes) updated on the final phase

## Verification strategy

Per-task commands inline. Cross-cutting: the **OV full-object parity** harness proves the refactor is behavior-preserving except the documented `comparison`/absent-`searchIntent` change. **Staging regen** (manual, owner): after merge, regenerate a workspace's strategy on staging and confirm the small `ranking_opp` rec reordering — the persisted scores don't change until regen.

---

# PR 1 — Shared intent classifier (full-derive) + layered contract

**Outcome:** all keyword intent classification flows through `deriveValueIntent`; `toOpportunityIntent` is gone; the Hub-vs-recs `comparison` drift is closed; OV output is byte-identical except the intended full-derive correction.

### Task 1.1: Confirm `deriveValueIntent` is exported + unit-test it as the single classifier

**Files:**
- Modify (if needed): `server/scoring/keyword-value-score.ts` (ensure `export function deriveValueIntent`)
- Test: `tests/unit/keyword-value-intent-consolidation.test.ts` (new)

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from 'vitest';
import { deriveValueIntent, valueIntentWeight } from '../../server/scoring/keyword-value-score.js';
import { INTENT_WEIGHT, DEFAULT_INTENT_WEIGHT } from '../../server/scoring/opportunity-value.js';

describe('deriveValueIntent — the single keyword intent classifier', () => {
  it('maps comparison → commercial (0.7) from a provided intent', () => {
    expect(deriveValueIntent('dentist vs orthodontist', 'comparison')).toBe('commercial');
    expect(valueIntentWeight(deriveValueIntent('x', 'comparison'))).toBe(INTENT_WEIGHT.commercial); // 0.7
  });
  it('passes the 4 buckets through', () => {
    for (const v of ['transactional', 'commercial', 'informational', 'navigational'] as const) {
      expect(deriveValueIntent('kw', v)).toBe(v);
    }
  });
  it('falls back to the regex classifier when intent is absent (full-derive)', () => {
    expect(deriveValueIntent('what causes bad breath')).toBe('informational');
    expect(deriveValueIntent('teeth cleaning sarasota')).toBe('transactional');
    expect(deriveValueIntent('best dentist near me')).toBe('commercial');
  });
  it('never throws on an empty keyword (primaryKeyword can be "")', () => {
    expect(() => deriveValueIntent('', undefined)).not.toThrow();
    expect(deriveValueIntent('', undefined)).toBe('transactional'); // classifier default
  });
  it('is non-null for any input (no DEFAULT_INTENT_WEIGHT path via this fn)', () => {
    expect(deriveValueIntent('anything', 'garbage-not-a-bucket')).not.toBeNull();
    expect(DEFAULT_INTENT_WEIGHT).toBe(0.5); // sanity: the value the OLD toOpportunityIntent leaked to
  });
});
```

- [ ] **Step 2: Run red** — `npx vitest run tests/unit/keyword-value-intent-consolidation.test.ts` → FAIL only if `deriveValueIntent`/`valueIntentWeight` aren't exported; otherwise these pass immediately (the fn already exists). **Constraint:** if they already pass, that's expected — this task is the *contract lock* for the classifier; proceed.
- [ ] **Step 3: Implement** — ensure `deriveValueIntent` + `valueIntentWeight` are `export`ed (`keyword-value-score.ts:102`/`:115`). No logic change.
- [ ] **Step 4: Run green** + `npm run typecheck` 0.
- [ ] **Step 5: Commit** — `git commit -am "test(scoring): lock deriveValueIntent as the single keyword intent classifier"`

### Task 1.2: Build the OV full-object parity harness (refactor safety net) — RED before the migration

**Files:**
- Test: `tests/unit/recommendations-intent-parity.test.ts` (new)

- [ ] **Step 1: Write the test** — capture the FULL `OpportunityScore` (value + `components` array) + the rendered `topOpportunityRationale` for representative inputs across the keyword-bearing OV branches, asserting the **intended** post-migration values. Drive `computeOpportunityValue` directly with `OpportunityInput`s mirroring the call sites.

```ts
import { describe, it, expect } from 'vitest';
import { computeOpportunityValue } from '../../server/scoring/opportunity-value.js';
import { deriveValueIntent } from '../../server/scoring/keyword-value-score.js';

// ranking_opp with a comparison searchIntent: OLD=null→0.5, NEW=commercial→0.7
describe('OV intent parity after full-derive consolidation', () => {
  const base = { branch: 'ranking_opp' as const, volume: 500, difficulty: 30, currentPosition: 8 };
  it('comparison searchIntent now resolves commercial (0.7), not the 0.5 default', () => {
    const intent = deriveValueIntent('invisalign vs braces', 'comparison'); // 'commercial'
    const ov = computeOpportunityValue({ ...base, intent });
    const intentComp = ov.components.find(c => c.dimension === 'intent')!;
    expect(intentComp.rawValue).toBe('commercial');
    expect(intentComp.evidence).toContain('commercial intent');
    expect(ov.value).toBeGreaterThan(0);
  });
  it('a transactional keyword is byte-identical pre/post (non-comparison, intent present)', () => {
    // snapshot the FULL object — the refactor must not move it
    const ov = computeOpportunityValue({ ...base, intent: 'transactional' });
    expect(ov).toMatchObject({ value: expect.any(Number), components: expect.any(Array) });
    // (the implementer captures a concrete expected snapshot of value+components here from a pre-change run)
  });
  it('value-inert content_gap path: deriveValueIntent(cg.targetKeyword, cg.intent) === cg.intent for 4-bucket', () => {
    for (const v of ['transactional', 'commercial', 'informational', 'navigational'] as const) {
      expect(deriveValueIntent('teeth whitening', v)).toBe(v); // no change vs reading cg.intent directly
    }
  });
});
```

- [ ] **Step 2: Capture the pre-change snapshot** — run against the CURRENT code, record the concrete `value`+`components` for the transactional case into the test (the byte-identical baseline). Run green on current code.
- [ ] **Step 3: Commit the harness** — `git commit -am "test(recommendations): OV full-object intent-parity harness (pre-migration baseline)"`

### Task 1.3: Migrate all 4 intent sites to `deriveValueIntent` + retire `toOpportunityIntent` (ONE commit)

**Files:**
- Modify: `server/recommendations.ts` (`:245` retire `toOpportunityIntent`; `:1420` content_gap; `:1482` ranking_opp; `:1539` intent-mismatch)
- Modify: `server/keyword-strategy-enrichment.ts:611` (inline coercion)

**Contract (exact swaps — confirm line numbers at execution against `8f9c7751`+):**
- `recommendations.ts:1482`: `intent: toOpportunityIntent(pm.searchIntent)` → `intent: deriveValueIntent(pm.primaryKeyword, pm.searchIntent)` (**weight-changing**: `comparison`/absent).
- `recommendations.ts:1539`: `intent: toOpportunityIntent(pk.searchIntent)` → `intent: deriveValueIntent(pk.primaryKeyword, pk.searchIntent)` (**weight-changing**).
- `recommendations.ts:1420`: `intent: cg.intent ?? null` → `intent: deriveValueIntent(cg.targetKeyword, cg.intent)` (**value-inert** — `cg` here is from `listContentGaps`, whose `rowToContentGap` mapper coerces to the strict 4-bucket, so `deriveValueIntent` always equals `cg.intent`).
- `keyword-strategy-enrichment.ts:611`: inline 4-bucket coercion → `deriveValueIntent(cg.targetKeyword, cg.intent)` (**WEIGHT-CHANGING** — `cg` here is a freshly AI-synthesized `StrategyContentGap` whose `intent` is **free-form**, so `comparison`/absent reclassify; this shifts `cg.opportunityScore` on every strategy generation via the canonical `relaxConservatism=true` path. Must be tested — see Task 1.3b).
- Delete `toOpportunityIntent` (`recommendations.ts:242-251`); add `import { deriveValueIntent } from './scoring/keyword-value-score.js';` (recommendations.ts already imports `computeOpportunityValue` from `./scoring/opportunity-value.js` at `:54`, so the scoring-module import direction is established — no cycle: `keyword-value-score` → `opportunity-value`, neither imports `server/recommendations`).

**Constraints:** all four sites + the `toOpportunityIntent` deletion land in **one commit** (CLAUDE.md cross-cutting-constraint rule). `pm`/`pk` are `PageKeywordMap` — the keyword field is `primaryKeyword` (NOT `.keyword`). Do NOT touch hardcoded-intent local branches or no-keyword branches. Do NOT alter EMV/ROI/effort/calibration math or re-introduce any legacy/`pickImpactScore` path.

- [ ] **Step 1: Update the parity test for the NEW values** — change the comparison-case assertions in `recommendations-intent-parity.test.ts` to expect the post-migration commercial/0.7 outcome (they currently reflect intended-new; confirm). The transactional snapshot stays byte-identical.
- [ ] **Step 2: Run red** — the comparison case FAILs on current (pre-migration) code (still 0.5/`unspecified`).
- [ ] **Step 3: Implement** the 4 swaps + delete `toOpportunityIntent` per the contract.
- [ ] **Step 4: Run green** — `npx vitest run tests/unit/recommendations-intent-parity.test.ts tests/unit/recommendations*.test.ts tests/unit/opportunity-value*.test.ts` PASS; `npm run typecheck` 0 (a leftover `toOpportunityIntent` reference would error). **Revert-confirm-red:** restore one site to `toOpportunityIntent`, confirm the comparison-parity test goes RED, restore.
- [ ] **Step 5: Commit** — `git commit -am "refactor(scoring): one keyword intent classifier (deriveValueIntent); retire toOpportunityIntent (full-derive)"`

### Task 1.3b: Test the enrichment `:611` weight-change (content-gap synthesis path)

**Files:**
- Test: extend the existing content-gap enrichment test (Phase 2 added `tests/integration/keyword-value-scoring-content-gaps.test.ts`) or add a focused case.

`keyword-strategy-enrichment.ts:611` is **not** value-inert: `StrategyContentGap.intent` is free-form, so under full-derive a `comparison`/non-4-bucket intent reclassifies and shifts `cg.opportunityScore`. Prove the intended new behavior on the real enrichment path.

- [ ] **Step 1: Write the test** — run `enrichKeywordStrategy` over a `StrategyContentGap` with `intent: 'comparison'` (and one with absent/`undefined` intent) and assert the resulting `cg.opportunityScore` reflects the commercial/regex-derived classification — i.e. it differs from (is ≥) the score the old `null`→`DEFAULT_INTENT_WEIGHT` 0.5 coercion produced for the same gap. Use the existing enrichment harness (`makeEnrichOptions`/`makeStrategy` pattern from the Phase 2 test).
- [ ] **Step 2: Run red on the pre-migration code** (if testing the delta) or assert the intended-new value directly; **Step 3:** green on the migrated code.
- [ ] **Step 4: Commit** — `git commit -am "test(scoring): enrichment content-gap intent reclassifies under full-derive (not value-inert)"`

### Task 1.4: Cross-layer consistency test + contract documentation

**Files:**
- Test: `tests/unit/keyword-value-intent-consolidation.test.ts` (extend)
- Modify: `docs/rules/keyword-command-center.md`

- [ ] **Step 1: Write the consistency test** — a fixture keyword resolves to the SAME intent on both layers (Hub via `computeKeywordValueScore`'s internal `deriveValueIntent`; recs via the migrated call) — assert the `comparison` keyword no longer disagrees.

```ts
it('Hub and recs agree on a comparison keyword (drift closed)', () => {
  const kw = 'invisalign vs braces';
  // Layer 1 (Hub) intent weight contribution and Layer 2 (recs) intent both derive 'commercial'
  expect(deriveValueIntent(kw, 'comparison')).toBe('commercial');
  // (the OLD toOpportunityIntent returned null→0.5; this asserts the single-source behavior)
});
```

- [ ] **Step 2: Run green.**
- [ ] **Step 3: Document the contract** — add a "Value scoring layers" section to `docs/rules/keyword-command-center.md`: (a) Layer 1 = `computeKeywordValueScore` (keyword value, Hub); Layer 2 = `computeOpportunityValue` (action ROI, the sole canonical rec score post-#1100); (b) Layer 1 → Layer 2 grounded spine for content gaps; (c) **one classifier** — all keyword intent goes through `deriveValueIntent`; never add a parallel coercion; (d) surface ownership: keyword-ranking surfaces render Layer 1, action surfaces render Layer 2.
- [ ] **Step 4: Commit** — `git commit -am "docs(keyword-command-center): document the Layer 1/Layer 2 value-scoring contract + one-classifier rule"`

### PR 1 gate
- [ ] All DoD gates + parity/consistency tests pass. PR → **staging**, CI green, merge. **Do not start PR 2 until merged.** Owner: regen a workspace on staging to verify the small `ranking_opp` rec reordering.

---

# PR 2 — Layer-1 component-exposure interface

**Outcome:** Layer 1 exposes one value-component vocabulary (for `kwv-value-breakdown` later), with the scalar score byte-identical (incl. the signal-gated `undefined`).

### Task 2.1: `computeKeywordValueComponents` sibling + thin `computeKeywordValueScore` wrapper

**Files:**
- Modify: `server/scoring/keyword-value-score.ts`
- Test: `tests/unit/keyword-value-score.test.ts` (extend)

**Contract:**
```ts
export interface KeywordValueComponents {
  commercialValue: number; demand: number; winnability: number; localMultiplier: number; intent: ValueIntent;
}
export function computeKeywordValueComponents(
  input: KeywordValueInput, ctx: ScoringContext,
): { score: number | undefined; components: KeywordValueComponents | undefined };
// wrapper:
export function computeKeywordValueScore(input, ctx): number | undefined
  = computeKeywordValueComponents(input, ctx).score;
```
**Signal-gate parity (hard):** when the gate fails (`keyword-value-score.ts:184` early return), the sibling returns `{ score: undefined, components: undefined }` so the wrapper's `.score` is `undefined` byte-for-byte as today.

- [ ] **Step 1: Write the failing test**

```ts
import { computeKeywordValueComponents, computeKeywordValueScore } from '../../server/scoring/keyword-value-score.js';
it('sibling .score equals the scalar wrapper for the same input', () => {
  const ctx = { posture: 'non_local' as const, markets: [] };
  const input = { keyword: 'teeth cleaning sarasota', volume: 480, difficulty: 30, cpc: 6, intent: 'transactional' };
  const { score, components } = computeKeywordValueComponents(input, ctx);
  expect(score).toBe(computeKeywordValueScore(input, ctx));
  expect(components).toMatchObject({ commercialValue: expect.any(Number), demand: expect.any(Number), winnability: expect.any(Number), localMultiplier: expect.any(Number), intent: 'transactional' });
});
it('signal-gated input returns {score: undefined, components: undefined} and wrapper stays undefined', () => {
  const ctx = { posture: 'non_local' as const, markets: [] };
  const r = computeKeywordValueComponents({ keyword: 'anything' }, ctx);
  expect(r.score).toBeUndefined();
  expect(r.components).toBeUndefined();
  expect(computeKeywordValueScore({ keyword: 'anything' }, ctx)).toBeUndefined();
});
```

- [ ] **Step 2: Run red** — `npx vitest run tests/unit/keyword-value-score.test.ts` → FAIL (`computeKeywordValueComponents` not exported).
- [ ] **Step 3: Implement** — extract the existing body into `computeKeywordValueComponents` returning `{score, components}`; make `computeKeywordValueScore` the thin wrapper. Preserve the signal gate exactly (gate → both undefined). **Constraint:** the 4 existing scalar callers (`keyword-command-center.ts:1418`, `:2278`, `:2553`; `keyword-strategy-enrichment.ts:598`) are untouched — they call the wrapper.
- [ ] **Step 4: Run green** — the new tests + the full existing `keyword-value-score.test.ts` (all prior cases) PASS; `npx vitest run tests/unit/keyword-command-center*.test.ts` green (callers unaffected); `npm run typecheck` 0.
- [ ] **Step 5: Commit** — `git commit -am "feat(scoring): expose computeKeywordValueComponents (Layer-1 value breakdown interface)"`

### Task 2.2: Docs + roadmap close-out

**Files:** `FEATURE_AUDIT.md`, `data/roadmap.json` (`kwv-one-score-everywhere` → notes).

- [ ] **Step 1** — `FEATURE_AUDIT.md` entry (one keyword value classifier + Layer 1/2 contract + component interface); update `kwv-one-score-everywhere` roadmap notes (keystone foundation done: one classifier + contract + component interface; surface re-ranking remains its own item). `npx tsx scripts/sort-roadmap.ts`.
- [ ] **Step 2: Commit** — `git commit -am "docs(score-consolidation): FEATURE_AUDIT + roadmap close-out"`

### PR 2 gate
- [ ] All DoD gates pass. PR → **staging**, CI green, merge.

---

## Self-review

**1. Spec coverage:**
- §4 one classifier (full-derive) + retire `toOpportunityIntent` + 4 sites → Task 1.3 (+ 1.1 lock). ✓
- §4 value-inert sites assert zero change → Task 1.2/1.3 tests. ✓
- §5 layered contract + surface ownership → Task 1.4 doc. ✓
- §6 component-exposure interface + gated-undefined parity → Task 2.1. ✓
- §7 no flag + behavior-preserving full-object parity → Task 1.2 harness. ✓
- §8 tests (one-classifier, cross-layer, OV full-object parity, component interface, empty keyword) → 1.1/1.2/1.3/1.4/2.1. ✓
- §3 cpc OUT of scope → not implemented (correct; `kwv-real-cpc`). ✓
- §9 stale-grounding guard → "confirm line numbers at execution" in Task 1.3. ✓

**2. Placeholder scan:** the Task 1.2 transactional snapshot is intentionally captured by the implementer from a pre-change run (a concrete value, not a placeholder) — flagged as a real step, not a TODO. No other placeholders. ✓

**3. Type consistency:** `deriveValueIntent(keyword: string, provided?: string|null): ValueIntent`, `computeKeywordValueComponents(input, ctx) → {score, components}`, `KeywordValueComponents`, `primaryKeyword` (not `.keyword`) — consistent across tasks. ✓
