# Keyword Value Scoring Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.
>
> **Plan style — contract+test-centric (project rule, overrides the skill's "full impl code" default):** each task pins the exact contract (signatures, types, behavior, file:line anchors) + the concrete tests (tests ARE the spec) + constraints + verification commands. Implementation *bodies* are written at execution against the real code, not pre-baked here. Concrete TEST code IS provided.

**Goal:** Replace the Keyword Hub's crude opportunity score (volume×ease) — and align the content-gap opportunity spine — with a value-first, posture-driven keyword value score, behind a new `keyword-value-scoring` flag (OFF = byte-identical to today).

**Architecture:** One new pure module `server/scoring/keyword-value-score.ts` (score + 5→4 intent adapter + pure local predicate + posture multiplier), consumed by (A) the Hub sort in `server/keyword-command-center.ts` — precomputed once per key, drift-free across the candidate/row stages — and (B) the content-gap opportunity score in `server/keyword-strategy-enrichment.ts`. Server-side flag gate `isFeatureEnabled('keyword-value-scoring', workspaceId)`.

**Tech Stack:** TypeScript (strict, NodeNext ESM — `.js` import suffixes server-side), better-sqlite3, Vitest (unit/integration/component), the existing `server/scoring/opportunity-value.ts` `INTENT_WEIGHT` money-model and `server/local-seo.ts` local signals.

**Spec:** `docs/superpowers/specs/2026-06-05-keyword-value-scoring-design.md` (owner-approved 2026-06-05; content-gap scope = contained spine-swap).

---

## Agent platform & model assignments

Claude/Anthropic ladder. Per phase:

| Phase / PR | Work | Implement | Review |
|---|---|---|---|
| Phase 0 (contracts) | Flag + pure scoring module + shared-type fields | **Sonnet** (well-specced, pure logic) | **Opus** adversarial (formula correctness, signal gate, intent adapter) |
| Phase 1 (Hub wiring) | Resolver symmetry, precompute, accessor selection, parity test | **Opus** (drift-sensitive integration) | **Opus** adversarial (candidate↔row parity, flag-OFF byte-identity) |
| Phase 2 (content-gap wiring) | enrichment.ts 3-site base swap | **Sonnet** | **Opus** adversarial (P4 × flag matrix, byte-identity OFF) |

## Task dependency graph

```
Phase 0 (PR 1)  ── flag + module + types ──┬──> Phase 1 (PR 2)  Hub wiring
                                           └──> Phase 2 (PR 3)  content-gap wiring
Phase 1 ⟂ Phase 2 (independent; both depend only on Phase 0). Ship Phase 1 then Phase 2 (or either order).
```

Phase-per-PR (CLAUDE.md): PR N+1 not opened until PR N is merged to `staging` and CI green. Each PR is independently shippable (flag OFF → no behavior change), so partial delivery is safe.

## File ownership (no parallel file conflicts within a phase)

- **Phase 0:** `shared/types/feature-flags.ts`, `data/roadmap.json`, `server/scoring/opportunity-value.ts` (export only), `server/scoring/keyword-value-score.ts` (new), `shared/types/keyword-command-center.ts`, `server/keyword-command-center.ts` (RowCandidateKey type only), `tests/unit/keyword-value-score.test.ts` (new), `tests/unit/feature-flags-keyword-hub.test.ts` (extend).
- **Phase 1:** `server/keyword-command-center.ts` (resolver/merge/merge-back/accessors/ScoringContext/parity), `tests/integration/keyword-command-center-routes.test.ts` (extend), `tests/unit/keyword-command-center-*.test.ts`.
- **Phase 2:** `server/keyword-strategy-enrichment.ts`, `tests/integration/` (new content-gap scoring test).

## Systemic improvements (in-scope)

- **Single source of truth** for the 4-bucket intent weights: export `INTENT_WEIGHT`/`DEFAULT_INTENT_WEIGHT` from `opportunity-value.ts` and reuse `ValueIntent = NonNullable<OpportunityInput['intent']>` — no second weight table.
- **New shared helper** `computeKeywordValueScore` is the one scorer both surfaces call (Hub + content gaps) → one definition of "valuable."
- **Parity-test hardening** (Phase 1 Task 1.6): fix the pre-existing `__candidateRowMetricParityForTest` key-set asymmetry so future one-sided source additions fail loudly — a systemic guard, not just coverage.
- **Reference doc** `docs/rules/keyword-command-center.md` exists; Phase 1 adds a short "value scoring is precomputed once per key; flag-selected accessor" contract note (DoD gate below).

## Definition-of-done gates (every PR)

- [ ] `npm run typecheck` — 0 errors (strict; uses `tsc -b`)
- [ ] `npx vite build` — ok
- [ ] `npx vitest run <new/changed tests>` + the touched suites — green; **red observed** for each new test before impl (TDD)
- [ ] `npx tsx scripts/pr-check.ts` — 0 errors
- [ ] `npm run verify:feature-flags` — passes (Phase 0)
- [ ] `npm run verify:coverage-ratchet` — no regression
- [ ] Kill orphan `13xxx` ports before commit/push (pre-commit hook flakes otherwise)
- [ ] Adversarial review (table above) run; Critical/Important findings fixed in the same PR
- [ ] `FEATURE_AUDIT.md` + `data/roadmap.json` updated on the final phase
- [ ] One phase per PR; merged to `staging` + CI green before the next phase

## Verification strategy

Per-task commands are inline. Per-PR: the DoD gates above. Cross-cutting smoke after Phase 1: a flag ON/OFF integration test asserting Hub default-sort order changes ON and is **byte-identical** OFF (rows + order + scores). Drift: extended `__candidateRowMetricParityForTest`.

---

# Phase 0 — Contracts (flag + pure scoring module + shared types) · PR 1

**Outcome:** the flag exists (OFF), the fully-unit-tested pure scorer exists, and the shared types carry the new fields. **Zero behavior change** (nothing consumes the scorer yet). This isolates the highest-logic-density piece for exhaustive testing before any wiring.

### Task 0.1: Add the `keyword-value-scoring` feature flag (OFF)

**Files:**
- Modify: `shared/types/feature-flags.ts` (FEATURE_FLAGS `:12`, FEATURE_FLAG_CATALOG `:119`, FEATURE_FLAG_GROUPS Keyword Hub bucket `:268`)
- Modify: `data/roadmap.json` (add a sprint item id `keyword-value-scoring`)
- Test: `tests/unit/feature-flags-keyword-hub.test.ts` (extend), plus `npm run verify:feature-flags`

- [ ] **Step 1: Write the failing test** — extend the existing Keyword Hub flag test to assert the new flag is present, defaults OFF, and is grouped.

```ts
// tests/unit/feature-flags-keyword-hub.test.ts — add:
import { FEATURE_FLAGS, FEATURE_FLAG_CATALOG, FEATURE_FLAG_GROUPS } from '../../shared/types/feature-flags.js';

it('keyword-value-scoring flag exists, defaults OFF, and is in the Keyword Hub group', () => {
  expect(FEATURE_FLAGS['keyword-value-scoring']).toBe(false);
  const entry = FEATURE_FLAG_CATALOG['keyword-value-scoring'];
  expect(entry.group).toBe('Keyword Hub');
  expect(entry.lifecycle.owner).toBe('analytics-intelligence');
  expect(entry.lifecycle.linkedRoadmapItemId).toBeTruthy();
  const hubBucket = FEATURE_FLAG_GROUPS.find(g => g.label === 'Keyword Hub');
  expect(hubBucket?.keys).toContain('keyword-value-scoring');
});
```

- [ ] **Step 2: Run red** — `npx vitest run tests/unit/feature-flags-keyword-hub.test.ts` → FAIL (`keyword-value-scoring` absent / typecheck error on missing catalog entry).

- [ ] **Step 3: Implement (contract)** — three coordinated edits per spec §11:
  1. `FEATURE_FLAGS`: `'keyword-value-scoring': false`.
  2. `FEATURE_FLAG_CATALOG`: entry with `label` (value-first opportunity scoring), `group: 'Keyword Hub'`, and the **nested** `lifecycle: { owner: 'analytics-intelligence', createdAt: '2026-06-02', rolloutTarget: 'staging-validation', removalCondition: '...', linkedRoadmapItemId: 'keyword-value-scoring', staleAuditCadence: 'weekly', lastReviewedAt: '2026-06-02' }`. **Dates `2026-06-02`** (match the existing Keyword Hub cohort, per the pinned audit horizon — not the commit day).
  3. `FEATURE_FLAG_GROUPS` Keyword Hub bucket `keys[]` += `'keyword-value-scoring'`.
  Add roadmap sprint item `{ "id": "keyword-value-scoring", "title": "...", "status": "in_progress", ... }` to `data/roadmap.json` (mirror the `keyword-universe-overhaul` item shape at `roadmap.json:20`).
  **Constraint:** the catalog is `Record<FeatureFlagKey, FeatureFlagCatalogEntry>` and `assertFeatureFlagGroupingConsistency` runs at import — a missing catalog entry or wrong group is a compile/import error, not just CI.

- [ ] **Step 4: Run green** — `npx vitest run tests/unit/feature-flags-keyword-hub.test.ts` PASS; `npm run verify:feature-flags` exits 0; `npm run typecheck` 0.

- [ ] **Step 5: Commit** — `git add shared/types/feature-flags.ts data/roadmap.json tests/unit/feature-flags-keyword-hub.test.ts && git commit -m "feat(keyword-value-scoring): add keyword-value-scoring feature flag (OFF)"`

### Task 0.2: Export the 4-bucket intent weights from the money-model

**Files:**
- Modify: `server/scoring/opportunity-value.ts:68-74` (add `export` to `INTENT_WEIGHT` and `DEFAULT_INTENT_WEIGHT`)
- Test: covered by Task 0.3 (the new module imports them); no behavior change here.

- [ ] **Step 1: Implement (contract)** — change `const INTENT_WEIGHT` → `export const INTENT_WEIGHT` and `const DEFAULT_INTENT_WEIGHT = 0.5` → `export const DEFAULT_INTENT_WEIGHT = 0.5`. No other change. **Constraint:** do NOT alter the values or `valuePerClick`/`intentWeight` logic — export only.

- [ ] **Step 2: Run green** — `npm run typecheck` 0; `npx vitest run tests/unit/opportunity-value*.test.ts` (existing) still green.

- [ ] **Step 3: Commit** — `git add server/scoring/opportunity-value.ts && git commit -m "refactor(scoring): export INTENT_WEIGHT/DEFAULT_INTENT_WEIGHT for reuse"`

### Task 0.3: New pure scoring module `keyword-value-score.ts`

**Files:**
- Create: `server/scoring/keyword-value-score.ts`
- Test: `tests/unit/keyword-value-score.test.ts` (new)

**Contract (exact):**

```ts
import type { OpportunityInput } from '../../shared/types/recommendations.js';
import type { LocalSeoPosture } from '../../shared/types/local-seo.js';
import type { LocalSeoMarket } from '../../shared/types/local-seo.js';   // confirm export path at execution
import { INTENT_WEIGHT, DEFAULT_INTENT_WEIGHT } from './opportunity-value.js';
import { hasMarketModifier, classifyLocalKeywordIntent } from '../local-seo.js';

export type ValueIntent = NonNullable<OpportunityInput['intent']>;   // 'transactional'|'commercial'|'informational'|'navigational'

export interface ScoringContext {
  posture: LocalSeoPosture;          // 'local'|'hybrid'|'non_local'|'unknown'
  markets: LocalSeoMarket[];         // from listLocalSeoMarkets(workspaceId)
  city?: string;                     // lowercased businessProfile.address.city
  state?: string;                    // lowercased businessProfile.address.state
}

export interface KeywordValueInput {
  keyword: string;
  volume?: number;
  impressions?: number;
  difficulty?: number;
  cpc?: number;
  intent?: string | null;            // raw provided intent from any source; undefined → derive from keyword
}

// Named constants (single source):
//   W_DEMAND = 0.40, W_WIN = 0.60   (within-tier tiebreak; sum to 1)
//   FLOOR = 0.50, DEMAND_REF = 10000, CPC_REF = 12, CPC_UNKNOWN = 0.5
//   LOCAL_MULT = { local:{isLocal:1.50, natInfo:0.60}, hybrid:{isLocal:1.25, natInfo:0.90} }

export function toValueIntent(raw: string | null | undefined): ValueIntent | null;
export function deriveValueIntent(keyword: string, provided?: string | null): ValueIntent;
export function valueIntentWeight(intent: ValueIntent | null): number;
export function isLocalKeyword(keyword: string, ctx: ScoringContext): boolean;
export function localRelevanceMultiplier(posture: LocalSeoPosture, isLocal: boolean, intent: ValueIntent): number;
export function computeKeywordValueScore(input: KeywordValueInput, ctx: ScoringContext): number | undefined;
```

**Behavior (from spec §5/§6/§8):**
- `toValueIntent`: `'comparison' → 'commercial'`; the 4 buckets pass through; anything else/null/undefined → `null`.
- `deriveValueIntent(kw, provided)` = `toValueIntent(provided) ?? toValueIntent(classifyLocalKeywordIntent(kw))`. Since `classifyLocalKeywordIntent` always returns a value that collapses to one of the 4 buckets, this is **non-null**.
- `valueIntentWeight(intent)` = `intent ? INTENT_WEIGHT[intent] : DEFAULT_INTENT_WEIGHT`.
- `isLocalKeyword(kw, ctx)` = `hasMarketModifier(kw, ctx.markets) || (ctx.city && kw.toLowerCase().includes(ctx.city)) || (ctx.state && kw.toLowerCase().includes(ctx.state)) || SERVICE_KEYWORD_RE.test(kw.toLowerCase())`, where `SERVICE_KEYWORD_RE = /dentist|dental|orthodont|implant|invisalign|veneer|emergency|clinic|lawyer|attorney|restaurant|contractor|plumber|roofing|med spa/`. **No DB read.**
- `localRelevanceMultiplier`: `non_local|unknown → 1.0`; `hybrid → isLocal?1.25 : (intent==='informational' && !isLocal)?0.90 : 1.0`; `local → isLocal?1.50 : (intent==='informational' && !isLocal)?0.60 : 1.0`. (national-informational ≡ `!isLocal && intent==='informational'`.)
- `computeKeywordValueScore(input, ctx)`:
  1. **Signal gate (first):** `hasSignal = (volume>0) || (impressions>0) || (difficulty != null) || (cpc != null && cpc>0) || (toValueIntent(input.intent) != null)`. If `!hasSignal` → return `undefined`.
  2. `intent = deriveValueIntent(input.keyword, input.intent)`; `local = isLocalKeyword(input.keyword, ctx)`.
  3. `cpcFactor = (cpc>0) ? min(cpc/CPC_REF, 1) : CPC_UNKNOWN`; `commercialValue = valueIntentWeight(intent) * cpcFactor`.
  4. `demand = min(log10(1 + (volume ?? impressions ?? 0)) / log10(1 + DEMAND_REF), 1)`; `winnability = 1 - (difficulty ?? 50)/100`.
  5. `tiebreak = W_DEMAND*demand + W_WIN*winnability`.
  6. `score = round( min(100, commercialValue * (FLOOR + (1-FLOOR)*tiebreak) * localRelevanceMultiplier(ctx.posture, local, intent) * 100) )`.

- [ ] **Step 1: Write the failing tests** (`tests/unit/keyword-value-score.test.ts`):

```ts
import { describe, it, expect } from 'vitest';
import {
  toValueIntent, deriveValueIntent, valueIntentWeight, isLocalKeyword,
  localRelevanceMultiplier, computeKeywordValueScore, type ScoringContext,
} from '../../server/scoring/keyword-value-score.js';

const NON_LOCAL: ScoringContext = { posture: 'non_local', markets: [] };
const LOCAL: ScoringContext = { posture: 'local', markets: [], city: 'sarasota', state: 'florida' };

describe('toValueIntent (5→4 adapter)', () => {
  it('maps comparison → commercial', () => expect(toValueIntent('comparison')).toBe('commercial'));
  it('passes the 4 buckets through', () => {
    for (const v of ['transactional', 'commercial', 'informational', 'navigational'] as const) {
      expect(toValueIntent(v)).toBe(v);
    }
  });
  it('returns null for unknown / nullish', () => {
    expect(toValueIntent('frobnicate')).toBeNull();
    expect(toValueIntent(null)).toBeNull();
    expect(toValueIntent(undefined)).toBeNull();
  });
});

describe('deriveValueIntent', () => {
  it('prefers a valid provided intent over the regex', () => {
    expect(deriveValueIntent('teeth cleaning sarasota', 'informational')).toBe('informational');
  });
  it('falls back to the regex classifier when none provided', () => {
    expect(deriveValueIntent('what causes bad breath')).toBe('informational'); // question-word prefix
    expect(deriveValueIntent('teeth cleaning sarasota')).toBe('transactional'); // regex default
    expect(deriveValueIntent('dentist vs orthodontist')).toBe('commercial');    // comparison → commercial
  });
});

describe('valueIntentWeight', () => {
  it('weights the 4 buckets and defaults 0.5 on null', () => {
    expect(valueIntentWeight('transactional')).toBe(1.0);
    expect(valueIntentWeight('commercial')).toBe(0.7);
    expect(valueIntentWeight('informational')).toBeCloseTo(0.3);
    expect(valueIntentWeight('navigational')).toBe(0.2);
    expect(valueIntentWeight(null)).toBe(0.5);
  });
});

describe('isLocalKeyword (pure)', () => {
  it('true on near-me / city match / service term', () => {
    expect(isLocalKeyword('dentist near me', NON_LOCAL)).toBe(true);     // hasMarketModifier near-me
    expect(isLocalKeyword('teeth cleaning sarasota', LOCAL)).toBe(true);  // ctx.city
    expect(isLocalKeyword('invisalign cost', NON_LOCAL)).toBe(true);      // service regex
  });
  it('false on a national non-service term', () => {
    expect(isLocalKeyword('what causes bad breath', NON_LOCAL)).toBe(false);
  });
});

describe('localRelevanceMultiplier', () => {
  it('non_local / unknown is a strict no-op', () => {
    expect(localRelevanceMultiplier('non_local', true, 'transactional')).toBe(1.0);
    expect(localRelevanceMultiplier('unknown', false, 'informational')).toBe(1.0);
  });
  it('local boosts local, demotes national-informational, spares national transactional (D5)', () => {
    expect(localRelevanceMultiplier('local', true, 'transactional')).toBe(1.5);
    expect(localRelevanceMultiplier('local', false, 'informational')).toBe(0.6);
    expect(localRelevanceMultiplier('local', false, 'transactional')).toBe(1.0); // D5
  });
  it('hybrid is the moderate version', () => {
    expect(localRelevanceMultiplier('hybrid', true, 'commercial')).toBe(1.25);
    expect(localRelevanceMultiplier('hybrid', false, 'informational')).toBe(0.9);
  });
});

describe('computeKeywordValueScore', () => {
  it('signal gate: returns undefined for a fully data-less, no-provided-intent input', () => {
    expect(computeKeywordValueScore({ keyword: 'anything at all' }, NON_LOCAL)).toBeUndefined();
  });
  it('a regex-derived intent does NOT rescue a metric-less keyword', () => {
    // "best dentist" classifies commercial via regex, but no volume/impr/diff/cpc and no PROVIDED intent → gated out
    expect(computeKeywordValueScore({ keyword: 'best dentist' }, NON_LOCAL)).toBeUndefined();
  });
  it('value-first: high-volume informational ranks below modest transactional (no CPC, non_local)', () => {
    const info = computeKeywordValueScore({ keyword: 'what causes bad breath', volume: 30000, difficulty: 15 }, NON_LOCAL)!;
    const txn  = computeKeywordValueScore({ keyword: 'teeth cleaning service', volume: 400, difficulty: 70, intent: 'transactional' }, NON_LOCAL)!;
    expect(txn).toBeGreaterThan(info);
  });
  it('§5.1 counterexample: low-difficulty high-volume informational < high-difficulty transactional (non_local)', () => {
    const info = computeKeywordValueScore({ keyword: 'what is teeth whitening', volume: 50000, difficulty: 0 }, NON_LOCAL)!;
    const txn  = computeKeywordValueScore({ keyword: 'buy whitening kit', volume: 100, difficulty: 95, cpc: 6, intent: 'transactional' }, NON_LOCAL)!;
    expect(txn).toBeGreaterThan(info);
  });
  it('named regression: sarasota transactional ≫ bad-breath informational under local posture', () => {
    const breath   = computeKeywordValueScore({ keyword: 'what causes bad breath', volume: 22000, difficulty: 40 }, LOCAL)!;
    const sarasota = computeKeywordValueScore({ keyword: 'teeth cleaning sarasota', volume: 480, difficulty: 30, cpc: 6 }, LOCAL)!;
    expect(sarasota).toBeGreaterThan(breath);
    expect(breath).toBeLessThan(15);
  });
  it('known high CPC lifts a transactional keyword above the same intent with low CPC', () => {
    const hi = computeKeywordValueScore({ keyword: 'commercial roofing quote', volume: 500, difficulty: 40, cpc: 20, intent: 'transactional' }, NON_LOCAL)!;
    const lo = computeKeywordValueScore({ keyword: 'commercial roofing price', volume: 500, difficulty: 40, cpc: 1, intent: 'transactional' }, NON_LOCAL)!;
    expect(hi).toBeGreaterThan(lo);
  });
  it('within tier, demand/winnability order two same-intent keywords', () => {
    const easy = computeKeywordValueScore({ keyword: 'service a', volume: 9000, difficulty: 10, intent: 'transactional' }, NON_LOCAL)!;
    const hard = computeKeywordValueScore({ keyword: 'service b', volume: 200, difficulty: 90, intent: 'transactional' }, NON_LOCAL)!;
    expect(easy).toBeGreaterThan(hard);
  });
  it('is bounded 0..100', () => {
    const s = computeKeywordValueScore({ keyword: 'dentist near me', volume: 999999, difficulty: 0, cpc: 999, intent: 'transactional' }, LOCAL)!;
    expect(s).toBeGreaterThanOrEqual(0);
    expect(s).toBeLessThanOrEqual(100);
  });
});
```

- [ ] **Step 2: Run red** — `npx vitest run tests/unit/keyword-value-score.test.ts` → FAIL (module not found).
- [ ] **Step 3: Implement** the module to the contract above. **Constraints:** pure (no DB, no workspace lookups); strict TS, no `any`; reuse `INTENT_WEIGHT`/`DEFAULT_INTENT_WEIGHT` (Task 0.2) and `classifyLocalKeywordIntent`/`hasMarketModifier` (do not duplicate the weight table or re-implement the classifier). Confirm the `LocalSeoMarket` import path at execution (read `shared/types/local-seo.ts`).
- [ ] **Step 4: Run green** — `npx vitest run tests/unit/keyword-value-score.test.ts` PASS; `npm run typecheck` 0.
- [ ] **Step 5: Commit** — `git add server/scoring/keyword-value-score.ts tests/unit/keyword-value-score.test.ts && git commit -m "feat(scoring): value-first keyword value score module (pure, unit-tested)"`

### Task 0.4: Add `intent` to metrics + `cpc`/`intent`/`valueScore` to the candidate type

**Files:**
- Modify: `shared/types/keyword-command-center.ts:104-112` (add `intent?: string` to `KeywordCommandCenterMetrics`)
- Modify: `server/keyword-command-center.ts:1940-1951` (add `cpc?: number`, `intent?: string`, `valueScore?: number` to `RowCandidateKey`)
- Test: `tests/unit/keyword-value-score.test.ts` already covers the scorer; this task is type-only → covered by `typecheck`.

- [ ] **Step 1: Implement (contract)** — add `intent?: string;` to `KeywordCommandCenterMetrics` (after `cpc?: number;`). Add to `RowCandidateKey`: `cpc?: number;`, `intent?: string;`, and `/** Precomputed value-first score (flag ON only); undefined when the signal gate returns no score. */ valueScore?: number;`. **Constraint:** types only — no consumer wired yet, so behavior is unchanged.
- [ ] **Step 2: Run green** — `npm run typecheck` 0; `npx vite build` ok.
- [ ] **Step 3: Commit** — `git add shared/types/keyword-command-center.ts server/keyword-command-center.ts && git commit -m "feat(keyword-hub): add intent to metrics + cpc/intent/valueScore to RowCandidateKey (types)"`

### Phase 0 PR gate
- [ ] All DoD gates pass. Open PR `feat/keyword-value-scoring` → **staging**. After CI green, merge. **Do not start Phase 1 until merged.**

---

# Phase 1 — Hub wiring (drift-free) · PR 2

**Outcome:** flag ON → the Hub `opportunity` sort is value-first; flag OFF → byte-identical to today. The value score is precomputed once per key (candidate + row), so the candidate↔row parity invariant holds.

### Task 1.1: Resolve `intent` symmetrically into both stages

**Files:**
- Modify: `server/keyword-command-center.ts` — `resolveBundleMetrics` (`:2188`, trackedKeywords merge `:2234`, pageMap `:~2220`, contentGaps `:~2225`) AND `populateDraftRows` (row stage, trackedKeywords `:1159`, pageMap `:~1089`, contentGaps).
- Test: `tests/unit/keyword-command-center-*.test.ts` (a resolver-level unit test or the parity test in 1.6).

- [ ] **Step 1: Write the failing test** — assert the resolved metrics map carries `intent` from each source, in BOTH the candidate resolver and the row stage. (Use the existing test harness/fixtures in the keyword-command-center unit tests; pattern: build a bundle with a trackedKeyword `{query:'x', intent:'commercial'}`, a pageMap entry `{keyword:'y', searchIntent:'transactional'}`, a contentGap `{targetKeyword:'z', intent:'informational'}`, run `resolveBundleMetrics`, assert `.get(key).intent` for each.)

```ts
it('resolveBundleMetrics carries intent from trackedKeywords, pageMap.searchIntent, and contentGaps', () => {
  const bundle = makeBundle({
    trackedKeywords: [{ query: 'tracked kw', intent: 'commercial' }],
    pageMap: [{ keyword: 'page kw', searchIntent: 'transactional' }],
    contentGaps: [{ targetKeyword: 'gap kw', intent: 'informational' }],
  });
  const resolved = resolveBundleMetrics(bundle, new Map());
  expect(resolved.get(keyOf('tracked kw'))?.intent).toBe('commercial');
  expect(resolved.get(keyOf('page kw'))?.intent).toBe('transactional');   // note: searchIntent → intent
  expect(resolved.get(keyOf('gap kw'))?.intent).toBe('informational');
});
```

- [ ] **Step 2: Run red** — the new test FAILs (intent undefined; `resolveBundleMetrics`/`keyOf` may need exporting for the test — confirm at execution).
- [ ] **Step 3: Implement (contract)** — in BOTH `resolveBundleMetrics` and `populateDraftRows`, add `intent` to the existing `merge(...)`/`mergeMetrics(...)` calls: trackedKeywords → `intent: keyword.intent`, pageMap → `intent: page.searchIntent` (**field name** is `searchIntent`), contentGaps → `intent: gap.intent`. **Constraints:** (a) keep the source merge ORDER identical between the two stages (pageMap → contentGaps → trackedKeywords) so last-writer-wins resolves the same; (b) `mergeMetricsInto` is spread-over-entries so no merge-fn edit is needed once `intent` is on the interface (Task 0.4); (c) do NOT touch `cpc` merging (already symmetric from trackedKeywords) and do NOT add `pageMap.cpc` to either side.
- [ ] **Step 4: Run green** — the new test PASSes; `npm run typecheck` 0.
- [ ] **Step 5: Commit** — `git commit -am "feat(keyword-hub): resolve keyword intent symmetrically into candidate+row metrics"`

### Task 1.2: Build the `ScoringContext` + flag once per request

**Files:**
- Modify: `server/keyword-command-center.ts` — `buildKeywordCommandCenterRowsSkinny` (`:2698`) and `buildKeywordCommandCenterRowsViaModel` (`:2665`).

- [ ] **Step 1: Implement (contract)** — in each rows-build entry point, after `getWorkspace`, compute once: `const valueScoringOn = isFeatureEnabled('keyword-value-scoring', workspaceId);` and (only when on) `const scoringContext: ScoringContext = { posture: getLocalSeoPosture(workspaceId), markets: listLocalSeoMarkets(workspaceId), city: workspace.businessProfile?.address?.city?.toLowerCase(), state: workspace.businessProfile?.address?.state?.toLowerCase() };`. Thread `valueScoringOn` + `scoringContext` into the candidate build (Task 1.3) and row finalize (Task 1.4) and sorter selection (Task 1.5). **Constraint:** `getLocalSeoPosture`/`listLocalSeoMarkets` are called **once per request**, never per keyword (DB reads). When `valueScoringOn` is false, skip building `scoringContext` entirely (no extra DB work on the flag-OFF path → preserves perf + byte-identity).
- [ ] **Step 2: Run green** — `npm run typecheck` 0 (no behavior assertion yet; wired in 1.3–1.5). Confirm imports at top of file (`isFeatureEnabled`, `getLocalSeoPosture`, `listLocalSeoMarkets`, `ScoringContext`, `computeKeywordValueScore`).
- [ ] **Step 3: Commit** — `git commit -am "feat(keyword-hub): build per-request ScoringContext + value-scoring flag gate"`

### Task 1.3: Precompute `valueScore` on candidates (merge-back)

**Files:**
- Modify: `server/keyword-command-center.ts:2164-2172` (candidate merge-back loop) — pass `valueScoringOn`/`scoringContext` into `addCandidateKeysFromBundle` / the merge-back as needed.

- [ ] **Step 1: Implement (contract)** — in the merge-back loop, after copying demand/clicks/rank/difficulty, also set `candidate.cpc = metrics.cpc; candidate.intent = metrics.intent;` and, when `valueScoringOn`, `candidate.valueScore = computeKeywordValueScore({ keyword: candidate.keyword, volume: metrics.volume, impressions: metrics.impressions, difficulty: metrics.difficulty, cpc: metrics.cpc, intent: metrics.intent }, scoringContext);`. **Constraint:** when `valueScoringOn` is false, `valueScore` stays undefined (drives the flag-OFF accessor fallback in 1.5).
- [ ] **Step 2: Run green** — `npm run typecheck` 0. (Behavior asserted via 1.5 integration + 1.6 parity.)
- [ ] **Step 3: Commit** — `git commit -am "feat(keyword-hub): precompute candidate valueScore at merge-back (flag ON)"`

### Task 1.4: Precompute `valueScore` on rows (finalize)

**Files:**
- Modify: `server/keyword-command-center.ts` — the row finalize where `row.metrics` is assembled (the populate/finalize path feeding `ROW_SORT_ACCESSORS`). Add a transient `valueScore` carrier on the working row object (need NOT be on the public API row type).

- [ ] **Step 1: Implement (contract)** — when `valueScoringOn`, after `row.metrics` is fully merged, set the row's transient `valueScore = computeKeywordValueScore({ keyword: row.keyword, volume: row.metrics.volume, impressions: row.metrics.impressions, difficulty: row.metrics.difficulty, cpc: row.metrics.cpc, intent: row.metrics.intent }, scoringContext);` — **the same function + same `scoringContext`** as Task 1.3, so candidate and row scores are identical by construction.
- [ ] **Step 2: Run green** — `npm run typecheck` 0.
- [ ] **Step 3: Commit** — `git commit -am "feat(keyword-hub): precompute row valueScore at finalize (flag ON)"`

### Task 1.5: Flag-selected `opportunity` accessor (field read, not recompute)

**Files:**
- Modify: `server/keyword-command-center.ts` — the `opportunity` accessor at `:855` (row) and `:2326` (candidate), and the sorter dispatch (`sortRowsForQuery` `:858`, `candidateSortForQuery` `:2336`).

- [ ] **Step 1: Write the failing test** (integration) — `tests/integration/keyword-command-center-routes.test.ts` (extend; allocate a fresh `13xxx` port — check `grep -r 'createTestContext(' tests/`): seed a workspace whose keywords include a high-volume informational keyword and a modest transactional/local keyword; request rows with `sort=opportunity`. With the flag **OFF**, assert today's order (volume-weighted). With the flag **ON** (set a workspace override), assert the transactional/local keyword now ranks above the informational one.

```ts
it('flag ON makes the opportunity sort value-first; OFF is unchanged', async () => {
  // seed: informational high-volume 'what causes bad breath' (vol 22000) + transactional local 'teeth cleaning <city>' (vol 480)
  await setWorkspaceFlagOverride(ws.id, 'keyword-value-scoring', false);
  const off = await getRows(ws.id, { sort: 'opportunity', direction: 'desc' });
  expect(indexOf(off, 'what causes bad breath')).toBeLessThan(indexOf(off, 'teeth cleaning'));   // volume-led today

  await setWorkspaceFlagOverride(ws.id, 'keyword-value-scoring', true);
  const on = await getRows(ws.id, { sort: 'opportunity', direction: 'desc' });
  expect(indexOf(on, 'teeth cleaning')).toBeLessThan(indexOf(on, 'what causes bad breath'));     // value-first
});
```

- [ ] **Step 2: Run red** — FAIL (flag ON order == OFF order; accessor still uses `computeOpportunityScore`).
- [ ] **Step 3: Implement (contract)** — at the sorter dispatch, when `valueScoringOn` the `opportunity` accessor is `(row) => row.valueScore` (row) / `(c) => c.valueScore` (candidate) — a **field read** (`undefined` flows through as missing-last via the existing `compareMetric`); when off, today's `computeOpportunityScore({ volume: row.metrics.volume ?? row.metrics.impressions, difficulty: row.metrics.difficulty })` (row) and `computeOpportunityScore({ volume: c.demand, difficulty: c.difficulty })` (candidate). Select by `valueScoringOn` (one conditional at dispatch) — **no per-comparison recompute**, no `buildSortAccessors` factory. **Constraint:** the candidate and row accessors must pick the SAME branch from the SAME `valueScoringOn`.
- [ ] **Step 4: Run green** — the integration test PASSes; existing keyword-command-center route tests still green.
- [ ] **Step 5: Commit** — `git commit -am "feat(keyword-hub): value-first opportunity sort via precomputed valueScore (flag-gated)"`

### Task 1.6: Extend + fix the candidate↔row parity test

**Files:**
- Modify: `server/keyword-command-center.ts:2378` (`__candidateRowMetricParityForTest`) — cover `valueScore`; fix the row-side key-set asymmetry.
- Test: the unit test that drives `__candidateRowMetricParityForTest`.

- [ ] **Step 1: Write the failing test** — assert candidate `valueScore` == row `valueScore` for EVERY key, AND assert the candidate/row **key sets are equal**. Drive it through real data including a localVisibility-only keyword and a small `pageSize`.

```ts
it('candidate and row value scores match for every key (no drift); key sets are equal', async () => {
  const { candidates, rows } = await __candidateRowMetricParityForTest(ws.id, { sort: 'opportunity', pageSize: 5 });
  const cByKey = new Map(candidates.map(c => [c.key, c.valueScore]));
  const rByKey = new Map(rows.map(r => [r.key, r.valueScore]));
  expect(new Set(cByKey.keys())).toEqual(new Set(rByKey.keys()));   // key-set equality (catches one-sided source adds)
  for (const [k, cv] of cByKey) expect(rByKey.get(k)).toBe(cv);     // per-key value parity
});
```

- [ ] **Step 2: Run red** — FAIL (key-set mismatch: row side omits `ensureLocalVisibilityRows`; and/or `valueScore` not exposed by the probe).
- [ ] **Step 3: Implement (contract)** — in `__candidateRowMetricParityForTest`: (a) call `ensureLocalVisibilityRows(rows, localVisibility)` on the row side after `populateDraftRows` to match the real skinny path (`:2729-2730`); (b) include `valueScore` (and `cpc`/`intent`) in the returned candidate/row projections; (c) run the probe with `valueScoringOn = true`. **Constraint:** this is a test-harness change — it must mirror production exactly, not paper over a real divergence.
- [ ] **Step 4: Run green** — parity test PASSes. **Revert-confirm-red:** temporarily break symmetry (e.g. compute the row score with a different `scoringContext.posture`), confirm the test goes RED, restore via `git checkout`.
- [ ] **Step 5: Commit** — `git commit -am "test(keyword-hub): extend parity probe to valueScore + fix key-set asymmetry"`

### Task 1.7: Reference-doc contract note

**Files:**
- Modify: `docs/rules/keyword-command-center.md` — add a short "value scoring" contract paragraph.

- [ ] **Step 1: Implement** — add: "When `keyword-value-scoring` is ON, the `opportunity` sort uses `computeKeywordValueScore` precomputed **once per key** at candidate merge-back and row finalize (same fn + same per-request `ScoringContext`); the accessor is a field read of `valueScore`. Never recompute the score inside the comparator. Flag OFF → `computeOpportunityScore({volume,difficulty})`, byte-identical."
- [ ] **Step 2: Commit** — `git commit -am "docs(keyword-hub): document value-scoring precompute + flag-selected accessor contract"`

### Phase 1 PR gate
- [ ] All DoD gates + the flag ON/OFF integration test + the extended parity test pass. PR → **staging**, CI green, merge. **Do not start Phase 2 until merged.**

---

# Phase 2 — Content-gap wiring (contained spine-swap) · PR 3

**Outcome:** flag ON → the content-gap opportunity score (feeding strategy/recs/briefing) is value-first; flag OFF → byte-identical regardless of the P4 (`relaxConservatism`) flag. The P4 control flow and `computeOpportunityValue` are untouched.

### Task 2.1: Gate the content-gap base score at the 3 call sites

**Files:**
- Modify: `server/keyword-strategy-enrichment.ts:572-600` (the per-gap loop; the 3 `computeOpportunityScore(cg)` sites at `:577` spine input, `:593` fallback, `:595` OFF write).
- Test: new integration test (allocate a fresh `13xxx` port).

- [ ] **Step 1: Write the failing test** — seed a strategy whose content gaps include a high-volume informational gap and a transactional/local gap; run enrichment (the path that writes `cg.opportunityScore`). With flag **OFF**, assert the persisted `opportunityScore` equals today's `computeOpportunityScore(cg)` for each (byte-identical). With flag **ON**, assert the transactional/local gap's `opportunityScore` now exceeds the informational gap's (value-first reorder), and the gaps array re-sorts accordingly.

```ts
it('content-gap opportunityScore is value-first under the flag; byte-identical when OFF (any P4 state)', async () => {
  await setWorkspaceFlagOverride(ws.id, 'keyword-value-scoring', false);
  const off = await runEnrichmentAndReadGaps(ws.id);
  expect(off.find(g => g.targetKeyword === 'what causes bad breath')!.opportunityScore)
    .toBe(computeOpportunityScore({ volume: 22000, difficulty: 40 }));   // legacy value, unchanged

  await setWorkspaceFlagOverride(ws.id, 'keyword-value-scoring', true);
  const on = await runEnrichmentAndReadGaps(ws.id);
  const info = on.find(g => g.targetKeyword === 'what causes bad breath')!.opportunityScore!;
  const txn  = on.find(g => g.targetKeyword === 'teeth cleaning sarasota')!.opportunityScore!;
  expect(txn).toBeGreaterThan(info);
});
```

- [ ] **Step 2: Run red** — FAIL (flag ON value == legacy value; scorer not wired).
- [ ] **Step 3: Implement (contract)** — at the top of the per-gap loop, build `ctx` once (`getLocalSeoPosture(workspaceId)` + `listLocalSeoMarkets(workspaceId)` + `businessProfile.address`) and compute `const base = isFeatureEnabled('keyword-value-scoring', workspaceId) ? computeKeywordValueScore({ keyword: cg.targetKeyword, volume: cg.volume, difficulty: cg.difficulty, cpc: undefined, intent: cg.intent }, ctx) : computeOpportunityScore(cg);`. Use `base` at **all three** sites (`:577` spine input, `:593` fallback, `:595` OFF write). **Constraints:** the `relaxConservatism`/P4 branching and `computeOpportunityValue` are unchanged — only the score VALUE swaps; `ContentGap` has no `cpc` so `cpc` is `undefined`; do NOT touch the `?? computeOpportunityScore(gap)` fallbacks in `briefing-candidates.ts:239`, `briefing-client-projection.ts:67`, `server/routes/public-content.ts:191`, `keyword-strategy-helpers.ts:158`.
- [ ] **Step 4: Run green** — the new integration test PASSes; existing enrichment/strategy tests green. **Revert-confirm-red:** flip the flag-gate condition, confirm RED, restore.
- [ ] **Step 5: Commit** — `git commit -am "feat(keyword-value-scoring): value-first content-gap opportunity score (flag-gated, P4 flow untouched)"`

### Task 2.2: Docs + roadmap close-out

**Files:**
- Modify: `FEATURE_AUDIT.md` (entry), `data/roadmap.json` (`keyword-value-scoring` → notes; `npx tsx scripts/sort-roadmap.ts`).

- [ ] **Step 1: Implement** — add a `FEATURE_AUDIT.md` entry for value-first keyword scoring; update the roadmap item notes (shipped DARK behind `keyword-value-scoring`, owner-gated flag-ON verify on staging). Run `npx tsx scripts/sort-roadmap.ts`.
- [ ] **Step 2: Commit** — `git commit -am "docs(keyword-value-scoring): FEATURE_AUDIT + roadmap close-out"`

### Phase 2 PR gate
- [ ] All DoD gates + the content-gap integration test pass. PR → **staging**, CI green, merge.

---

## Owner-gated (post-merge, NOT in this plan)

- Per-workspace flag-ON verification on staging: confirm value-first ordering on the Hub (sarasota-type keywords lead), national-informational demoted under local posture, content-gap/recs reorder, flag-OFF byte-identical. Then **staging → main** to ship to production (owner's step).
- Optional future: tune constants (`CPC_REF`, multipliers) or graduate to the `opportunity-value.ts` calibration loop — out of scope here.

---

## Self-review

**1. Spec coverage:**
- §3 D1 value-first → Task 0.3 (multiplicative formula + tests incl. counterexample). ✓
- §3 D2 posture-driven → Task 0.3 `localRelevanceMultiplier` + Task 1.2 posture fetch. ✓
- §3 D3 scope Hub+content-gaps → Phase 1 + Phase 2. ✓
- §3 D4 demote-not-filter → no filtering added anywhere (score only). ✓
- §3 D5 spare national transactional → Task 0.3 multiplier test. ✓
- §3 D6 dedicated flag, OFF byte-identical → Task 0.1 + flag-OFF assertions in 1.5/2.1. ✓
- §5 formula + signal gate → Task 0.3 contract + tests. ✓
- §6 intent resolution + 5→4 adapter → Task 0.3 `toValueIntent`/`deriveValueIntent`. ✓
- §7 CPC sparsity / mid-band → Task 0.3 `cpcFactor` + unknown-CPC tests. ✓
- §8 local relevance + pure `isLocalKeyword` → Task 0.3 + its no-DB test. ✓
- §9 Hub wiring (intent symmetry, precompute-once, accessor selection, parity-test fix) → Tasks 1.1–1.6. ✓
- §10 content-gap 3-site gated swap, P4 untouched → Task 2.1. ✓
- §11 flag triple-edit + nested lifecycle + 2026-06-02 dates → Task 0.1. ✓
- §12 tests → unit (0.3), parity (1.6), integration flag on/off (1.5, 2.1). ✓

**2. Placeholder scan:** No TBD/TODO; every code step shows real test code or a precise contract (impl bodies deliberately written at execution per the project plan style, with full signatures/behavior pinned). ✓

**3. Type consistency:** `ValueIntent`, `ScoringContext`, `KeywordValueInput`, `computeKeywordValueScore(input, ctx)`, `valueScore` field — used identically across Tasks 0.3, 0.4, 1.3, 1.4, 1.5, 1.6, 2.1. The `intent?: string` (metrics) vs `ValueIntent` (scorer input is raw string, normalized internally) distinction is intentional and consistent. ✓
