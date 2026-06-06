# Legible + Dollarized Keyword Value Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.
>
> **Plan style — contract+test-centric (project rule, overrides the skill's "full impl code" default):** each task pins the contract (signatures, behavior, file:line anchors) + concrete tests (tests ARE the spec) + constraints + verification. Implementation *bodies* are written at execution against the real code.
>
> **Stale-grounding guard (spec §7):** file:line refs are from staging `f896d7bc`; **re-confirm at execution** — esp. the server keyword-strategy serialization that attaches `explanation`/`opportunityScore` to the strategy rows, the `page_keywords` cpc-join points, and the content-gap public-serialization field list.

**Goal:** Make the consolidated keyword value score legible (plain-language "why it's worth it") and dollarized (per-keyword $/mo + portfolio "revenue at stake") on the existing client + admin keyword surfaces, with one $ definition and one reasons definition.

**Architecture:** Two pure shared helpers — `keywordValueReasons` (components → reason strings) and `keywordDollarValue` (`clicks×cpc` + position uplift, matching `roi.ts`) — each defined once and called by `roi.ts`, the KCC builder, and the keyword-strategy serialization. Ride existing pipelines (no new endpoint). No merge with the OV recommendation breakdown.

**Tech Stack:** TypeScript (strict, NodeNext ESM `.js`), better-sqlite3 + migrations, Vitest, React + React Query. Spec: `docs/superpowers/specs/2026-06-05-keyword-value-legible-dollarized-design.md`. Baseline: staging `f896d7bc`.

---

## Agent platform & model assignments (Claude/Anthropic; subagent-driven, ultracode OFF)

| PR | Work | Implement | Review |
|---|---|---|---|
| PR 1 `kwv-real-cpc` | DB column + mapper lockstep + enrichment populate | **Sonnet** | **Opus** (lockstep completeness, score-delta, public boundary) |
| PR 2 `kwv-value-breakdown` | reasons helper + server serialize + client/admin render | **Sonnet** | **Opus** (server-computed not client-derived; Four Laws; distinct-from-OV) |
| PR 3 `kwv-dollar-value` | $ helper + cpc-join + per-keyword $ + ROI rollup | **Opus** (cpc-join is the trickiest) | **Opus** ($ one-definition equivalence; no second engine; tier boundary) |

## Task dependency graph

```
PR 1 (real-cpc) ──> PR 2 (breakdown) ──> PR 3 (dollar-value)
PR 2 depends on PR 1 only for an accurate content-gap score (loose). PR 3 reuses PR 2's serialization plumbing (the row fields). Ship 1 → 2 → 3, each green on staging before the next.
```

Phase-per-PR (CLAUDE.md): PR N+1 not opened until PR N merged to `staging` + CI green.

## File ownership

- **PR 1:** new migration `server/db/migrations/NNN-content-gap-cpc.sql`; `shared/types/workspace.ts` (ContentGap); `server/keyword-strategy-ai-synthesis.ts` (StrategyContentGap); `server/content-gaps.ts` (row+mapper+upsert); `server/keyword-strategy-enrichment.ts` (populate + pass to scorer); `server/routes/public-content.ts` (field list); tests.
- **PR 2:** `server/scoring/keyword-value-score.ts` (`keywordValueReasons`); `shared/types/keyword-command-center.ts` + `server/keyword-command-center.ts` (valueReasons); the server keyword-strategy serialization (valueReasons) + `src/components/client/strategy/strategyKeywordDisplay.ts` + `StrategyTab.tsx` (attach); `StrategyKeywordDrawer.tsx` + `keyword-command-center/KeywordDetailDrawer.tsx` (render); tests.
- **PR 3:** new `server/scoring/keyword-value-money.ts` (`keywordDollarValue`); `server/roi.ts` + `shared/types/roi.ts` (revenueAtStake); the two keyword builders (cpc-join + $); `ROIDashboard.tsx` + the two drawers (render); tests.

## Systemic improvements (in-scope)

- **Two shared helpers** are the anti-dup guarantee — one $ formula + one reasons formula, reused by every consumer (no per-surface re-derivation).
- A pr-check-worthy invariant (note, not necessarily a new rule): the per-keyword realized $ must equal `roi.ts` `trafficValue` for matching inputs — enforced by a cross-module equivalence test (Task 3.1).

## Definition-of-done gates (every PR)

- [ ] `npm run typecheck` 0 · `npx vite build` ok
- [ ] `npx vitest run <new/changed>` + touched suites green; **red observed** for each new test pre-impl
- [ ] `npx tsx scripts/pr-check.ts` 0 (Four Laws: $ = emerald/`scoreColor`, data = blue; no purple/violet; primitives) · `npm run verify:coverage-ratchet`
- [ ] Kill orphan 13xxx ports · adversarial review run, Critical/Important fixed in-PR
- [ ] One PR per phase; merged to `staging` + CI green before next
- [ ] Final PR: `FEATURE_AUDIT.md` + `data/roadmap.json` (the 3 items → done) updated

## Verification strategy

Per-task inline. Cross-cutting: the `currentMonthly == roi.ts trafficValue` equivalence test (one $ definition). PR 1 + PR 3 change persisted/derived scores → owner verifies on staging after a strategy regen.

---

# PR 1 — `kwv-real-cpc` (content-gap CPC, DB column + mapper lockstep)

**Outcome:** content-gap value scores reflect real CPC instead of the `CPC_UNKNOWN` 0.5 proxy. All lockstep edits in ONE commit (CLAUDE.md "DB column + mapper lockstep").

### Task 1.1: Migration + types + mapper + populate (single lockstep commit)

**Files:**
- Create: `server/db/migrations/NNN-content-gap-cpc.sql` (NNN = next number; confirm at execution)
- Modify: `shared/types/workspace.ts` (`ContentGap`, ~:76-106), `server/keyword-strategy-ai-synthesis.ts` (`StrategyContentGap`, ~:65-93), `server/content-gaps.ts` (`ContentGapRow` ~:23, `rowToModel` ~:49, `modelToParams` ~:77, UPSERT ~:108-136), `server/keyword-strategy-enrichment.ts` (`~:440` domain-hit, `~:456` API, `~:599` pass to scorer)
- Test: `tests/integration/content-gaps.test.ts` (extend or new), `tests/integration/keyword-value-scoring-content-gaps.test.ts` (extend)

- [ ] **Step 1: Write the failing test** — a content gap persisted with a cpc round-trips, AND a gap with a real cpc scores differently from the 0.5 proxy.

```ts
// content_gaps cpc round-trip
it('persists + reads ContentGap.cpc', () => {
  const ws = createWorkspace('cpc round-trip').id;
  replaceAllContentGaps(ws, [{ topic: 't', targetKeyword: 'dental implants', intent: 'commercial', priority: 'high', rationale: 'r', volume: 1000, difficulty: 40, cpc: 12 }]);
  expect(listContentGaps(ws).find(g => g.targetKeyword === 'dental implants')!.cpc).toBe(12);
  deleteWorkspace(ws);
});
// score reflects real cpc (drive the value scorer via enrichment, relaxConservatism=true)
it('a content gap with a real cpc scores higher than the same gap with no cpc (commercialValue uses real CPC)', async () => {
  const ws = createWorkspace('cpc score').id;
  const withCpc = await enrichKeywordStrategy(makeEnrichOptions(ws, strategyWith({ targetKeyword: 'commercial widget', intent: 'commercial', priority: 'high', volume: 1000, difficulty: 40, cpc: 15 }), true));
  const noCpc  = await enrichKeywordStrategy(makeEnrichOptions(ws, strategyWith({ targetKeyword: 'commercial widget', intent: 'commercial', priority: 'high', volume: 1000, difficulty: 40 }), true));
  const a = withCpc.strategy.contentGaps!.find(g => g.targetKeyword === 'commercial widget')!.opportunityScore!;
  const b = noCpc.strategy.contentGaps!.find(g => g.targetKeyword === 'commercial widget')!.opportunityScore!;
  expect(a).toBeGreaterThan(b);
  deleteWorkspace(ws);
});
```

- [ ] **Step 2: Run red** — `npx vitest run tests/integration/content-gaps.test.ts tests/integration/keyword-value-scoring-content-gaps.test.ts` → FAIL (cpc not persisted / undefined; `StrategyContentGap` has no `cpc` → TS error).
- [ ] **Step 3: Implement (contract)** — migration `ALTER TABLE content_gaps ADD COLUMN cpc REAL;`; `cpc?: number` on both types; `cpc` on `ContentGapRow` + `rowToModel` (`if (r.cpc != null) m.cpc = r.cpc;`) + `modelToParams` (`cpc: m.cpc ?? null`) + INSERT + ON CONFLICT lists; enrichment `cg.cpc = domainHit.cpc` (`~:440`) and `cg.cpc = m.cpc` (`~:456`); change `:599` to pass `cpc: cg.cpc` (was `undefined`). **Constraint:** all in one commit. Run the migration locally (`npm run db:migrate`) before the test.
- [ ] **Step 4: Run green** + `npm run typecheck` 0.
- [ ] **Step 5: Commit** — `git commit -am "feat(content-gaps): add cpc (column+mapper+enrichment) so value scores use real CPC"`

### Task 1.2: Public serialization boundary

**Files:** `server/routes/public-content.ts` (content-gap field list, ~:160-191)

- [ ] **Step 1: Decide + implement** — content-gap `cpc` feeds the SCORE (already client-visible via `opportunityScore`); the raw cpc itself need NOT be added to the public content-gap projection unless a client surface renders it. **Default: do NOT add raw `cpc` to the public list** (admin-only raw value; the score already reflects it). Add a one-line comment at the field list noting cpc is intentionally score-only. **Constraint:** verify the public route does not error on the new column.
- [ ] **Step 2: Run green** — existing public-content tests pass; `npx tsx scripts/pr-check.ts` 0.
- [ ] **Step 3: Commit** — `git commit -am "chore(public-content): content-gap cpc is score-only (not raw-exposed)"`

### PR 1 gate
- [ ] DoD gates pass. PR → **staging**, CI green, merge. Owner: regen a workspace strategy on staging to see content-gap scores shift.

---

# PR 2 — `kwv-value-breakdown` (plain-language "why it's worth it")

**Outcome:** the Layer-1 value components render as plain-language reasons on the client `StrategyKeywordDrawer` + admin Hub drawer, computed server-side, distinct from OV's breakdown.

### Task 2.1: `keywordValueReasons` helper

**Files:**
- Modify: `server/scoring/keyword-value-score.ts` (add `keywordValueReasons`)
- Test: `tests/unit/keyword-value-score.test.ts` (extend)

**Contract:**
```ts
export function keywordValueReasons(
  components: KeywordValueComponents,                 // {commercialValue, demand, winnability, localMultiplier, intent}
  raw: { cpc?: number; volume?: number; difficulty?: number },
): string[];
```
Behavior (ordered by contribution; plain-language, mirrors OV evidence):
- intent: `cpc>0` → `"Commercial intent · $9 CPC"` (intent label + `$<cpc>`); else `"<Intent> intent"` (capitalized).
- winnability: `raw.difficulty != null` → `"Winnable · KD 24"`; else `"Winnability unknown"` omitted.
- demand: `raw.volume` present → `"Strong demand · 2,400/mo"` (or "Modest/Low" banded); else omit.
- local: ONLY when `components.localMultiplier > 1` → `"Local boost ×1.5"`.

- [ ] **Step 1: Write the failing test**

```ts
import { keywordValueReasons } from '../../server/scoring/keyword-value-score.js';
it('builds plain-language reasons from components + raw', () => {
  const reasons = keywordValueReasons(
    { commercialValue: 0.5, demand: 0.8, winnability: 0.76, localMultiplier: 1.5, intent: 'commercial' },
    { cpc: 9, volume: 2400, difficulty: 24 },
  );
  expect(reasons.some(r => /commercial intent/i.test(r) && r.includes('$9'))).toBe(true);
  expect(reasons.some(r => /KD 24/.test(r))).toBe(true);
  expect(reasons.some(r => /2,?400/.test(r))).toBe(true);
  expect(reasons.some(r => /local/i.test(r) && /1\.5/.test(r))).toBe(true);
});
it('omits the local reason when localMultiplier <= 1', () => {
  const reasons = keywordValueReasons({ commercialValue: 0.5, demand: 0.5, winnability: 0.7, localMultiplier: 1.0, intent: 'transactional' }, { difficulty: 30 });
  expect(reasons.some(r => /local/i.test(r))).toBe(false);
});
it('falls back to "<Intent> intent" with no cpc', () => {
  const reasons = keywordValueReasons({ commercialValue: 0.5, demand: 0.5, winnability: 0.7, localMultiplier: 1.0, intent: 'transactional' }, {});
  expect(reasons.some(r => /transactional intent/i.test(r) && !r.includes('$'))).toBe(true);
});
```

- [ ] **Step 2: Run red** → FAIL (not exported). **Step 3: Implement** the contract. **Step 4: Run green** + typecheck 0.
- [ ] **Step 5: Commit** — `git commit -am "feat(scoring): keywordValueReasons — plain-language value breakdown"`

### Task 2.2: Serialize `valueReasons` onto the admin KCC row

**Files:** `shared/types/keyword-command-center.ts` (`KeywordCommandCenterRow` + `valueReasons?: string[]`); `server/keyword-command-center.ts` (`finalizeDraftRow` ~:1279-1344) — **re-confirm lines at execution**.

- [ ] **Step 1: Write the failing test** (extend the KCC route/unit test) — a Hub row carries `valueReasons` (non-empty) for a scored keyword.
- [ ] **Step 2: Run red.** **Step 3: Implement** — in `finalizeDraftRow`, when value scoring is on, compute components via `computeKeywordValueComponents` (the Hub already computes the score; reuse its inputs) and set `row.valueReasons = keywordValueReasons(components, { cpc, volume, difficulty })`. Add the field to the type. **Constraint:** server-computed; admin-only path (no public stripping needed).
- [ ] **Step 4: Run green** + typecheck. **Step 5: Commit** — `git commit -am "feat(keyword-hub): serialize valueReasons onto KCC rows"`

### Task 2.3: Serialize `valueReasons` onto the client strategy data

**Files:** the **server keyword-strategy serialization** that attaches `explanation`/`opportunityScore` to strategy rows (**re-confirm the function at execution** — likely in the keyword-strategy route/helpers; grep for where `KeywordStrategyExplanation` is built for the client); `src/components/client/strategy/strategyKeywordDisplay.ts` (`StrategyKeywordTableRow` + `valueReasons?: string[]`, ~:18-42); `src/components/client/StrategyTab.tsx` (`buildKeywordRow` ~:558-626, attach).

- [ ] **Step 1: Write the failing test** — the server keyword-strategy response for a keyword carries `valueReasons`; the client `buildKeywordRow` maps it onto the row. (Server: integration on the strategy endpoint; client: a `buildKeywordRow` unit test asserting `row.valueReasons`.)
- [ ] **Step 2: Run red.** **Step 3: Implement** — build `valueReasons` server-side from the keyword's value components alongside `explanation`/`opportunityScore`, serialize it, and attach in `buildKeywordRow`. **Constraint:** server-computed (NOT re-derived client-side); the field is safe for all tiers (no $).
- [ ] **Step 4: Run green** + typecheck. **Step 5: Commit** — `git commit -am "feat(strategy): serialize valueReasons to the client keyword rows"`

### Task 2.4: Render reasons in both drawers

**Files:** `src/components/client/strategy/StrategyKeywordDrawer.tsx` (the "See the numbers"/"Why it's in the strategy" area, ~:167-262); `src/components/keyword-command-center/KeywordDetailDrawer.tsx`.

- [ ] **Step 1: Write the failing component test** — `StrategyKeywordDrawer` renders the `valueReasons` rows; absent when none.
- [ ] **Step 2: Run red.** **Step 3: Implement** — render `valueReasons` as muted reason rows (reuse the OverviewTab evidence-row pattern; **blue for data** per Four Laws; existing primitives, no hand-rolled cards). Same in `KeywordDetailDrawer`. **Constraint:** do NOT touch the OverviewTab "Why this is #1" (OV breakdown — distinct).
- [ ] **Step 4: Run green** + `npx tsx scripts/pr-check.ts` 0 (Four Laws / primitives). **Step 5: Commit** — `git commit -am "feat(keyword drawers): render value reasons (why it's worth it)"`

### PR 2 gate
- [ ] DoD gates + component tests pass. PR → **staging**, CI green, merge.

---

# PR 3 — `kwv-dollar-value` (per-keyword $/mo + portfolio "revenue at stake")

**Outcome:** one `keywordDollarValue` helper feeds per-keyword $ on the drawers + a "Revenue at stake" hero stat on ROIDashboard, all riding existing pipelines, one $ definition.

### Task 3.1: `keywordDollarValue` helper + the one-definition equivalence test

**Files:**
- Create: `server/scoring/keyword-value-money.ts`
- Test: `tests/unit/keyword-value-money.test.ts` (new)

**Contract:**
```ts
import { ctrAt, type CtrCurve } from './ctr-curve.js';
export function keywordDollarValue(args: {
  clicks?: number; cpc?: number; currentPosition?: number | null; impressions?: number; ctrCurve?: CtrCurve | null;
}): { currentMonthly: number; upsideMonthly: number };
// currentMonthly = (clicks ?? 0) * (cpc ?? 0)
// target = (currentPosition != null && currentPosition <= 3) ? Math.max(1, currentPosition - 1) : 3
// ctrUplift = Math.max(0, ctrAt(target, curve) - ctrAt(currentPosition ?? 20, curve))
// upsideMonthly = (impressions ?? 0) * ctrUplift * (cpc ?? 0)   // NO intentWeight (realized $)
```

- [ ] **Step 1: Write the failing tests**

```ts
import { keywordDollarValue } from '../../server/scoring/keyword-value-money.js';
it('currentMonthly = clicks × cpc (matches roi.ts trafficValue definition)', () => {
  expect(keywordDollarValue({ clicks: 120, cpc: 4 }).currentMonthly).toBe(480);
});
it('upside is positive when below page 1 and 0 floor otherwise', () => {
  const up = keywordDollarValue({ clicks: 5, cpc: 4, currentPosition: 11, impressions: 2000 });
  expect(up.upsideMonthly).toBeGreaterThan(0);
  expect(keywordDollarValue({ clicks: 50, cpc: 4, currentPosition: 1, impressions: 2000 }).upsideMonthly).toBe(0);
});
it('missing data floors to 0 (no throw)', () => {
  expect(keywordDollarValue({}).currentMonthly).toBe(0);
  expect(keywordDollarValue({}).upsideMonthly).toBe(0);
});
```

- [ ] **Step 2: Run red.** **Step 3: Implement** the contract (reuse `ctrAt`). **Step 4: Run green** + typecheck.
- [ ] **Step 5: Commit** — `git commit -am "feat(scoring): keywordDollarValue — one realized $/mo + uplift definition"`

### Task 3.2: Join cpc onto the two keyword builders (the only missing input)

**Files:** `server/keyword-command-center.ts` (`populateDraftRows` ~:1059-1277 — populate `metrics.cpc` from `page_keywords`); the client strategy build (`StrategyTab.tsx buildKeywordRow` ~:558-626 — add `cpc` from the page/`page_keywords`); `strategyKeywordDisplay.ts` (`StrategyKeywordTableRow` + `cpc?: number`). **Re-confirm the page_keywords cpc source + join key at execution.**

- [ ] **Step 1: Write the failing test** — a KCC row's `metrics.cpc` is populated for a keyword that has a page_keywords cpc; the strategy row carries `cpc`.
- [ ] **Step 2: Run red.** **Step 3: Implement** — join `cpc` from `page_keywords` (the same source `roi.ts` reads) by the row's page/keyword key, in both builders. **Constraint:** reuse the existing page_keywords read; do not add a provider call.
- [ ] **Step 4: Run green** + typecheck. **Step 5: Commit** — `git commit -am "feat(keyword rows): join cpc from page_keywords onto KCC + strategy rows"`

### Task 3.3: Per-keyword $ on the drawers

**Files:** `StrategyKeywordDrawer.tsx` (a "Revenue potential" block), `KeywordDetailDrawer.tsx`; the server serialization (compute `currentMonthly`/`upsideMonthly` via `keywordDollarValue` and serialize, OR compute client-side from the now-present clicks/cpc/position — prefer server for one source of truth + the ctrCurve).

- [ ] **Step 1: Write the failing component test** — the drawer renders the current $/mo + the upside; absent when no cpc.
- [ ] **Step 2: Run red.** **Step 3: Implement** — serialize `keywordDollarValue(...)` onto the rows (server) and render `currentMonthly` + `upsideMonthly` with `fmtMoney` (reuse ROIDashboard's). **Four Laws: $ = emerald/success** (not blue). **Constraint:** one helper; no inline $ math.
- [ ] **Step 4: Run green** + pr-check 0. **Step 5: Commit** — `git commit -am "feat(keyword drawers): per-keyword $/mo + upside"`

### Task 3.4: ROIDashboard "Revenue at stake" rollup

**Files:** `shared/types/roi.ts` (`ROIData` + `revenueAtStake?: number`); `server/roi.ts` (`computeROI` ~:139-250 — sum `keywordDollarValue(...).upsideMonthly` over tracked keywords, reusing the SAME helper); `src/components/client/ROIDashboard.tsx` (hero stat ~:109-144).

- [ ] **Step 1: Write the failing test** — `computeROI` returns a positive `revenueAtStake` for a workspace with below-page-1 keywords; 0 when all are #1.
- [ ] **Step 2: Run red.** **Step 3: Implement** — in `computeROI`, build `revenueAtStake = Σ keywordDollarValue(kw).upsideMonthly` from the page_keywords it already loads; add the field; render a 4th `StatCard` ("Revenue at stake", emerald, `fmtMoneyFull`). **Constraint:** reuse the helper (no second $ math); rides `/api/public/roi` (no endpoint change); Growth+ tier gate already wraps ROIDashboard.
- [ ] **Step 4: Run green** + pr-check 0. **Step 5: Commit** — `git commit -am "feat(roi): Revenue-at-stake rollup on ROIDashboard (reuses keywordDollarValue)"`

### Task 3.5: Docs + roadmap close-out

**Files:** `FEATURE_AUDIT.md`, `data/roadmap.json` (`kwv-real-cpc`/`kwv-value-breakdown`/`kwv-dollar-value` → done; `npx tsx scripts/sort-roadmap.ts`).

- [ ] **Step 1: Implement** the doc updates. **Step 2: Commit** — `git commit -am "docs: legible+dollarized keyword value — FEATURE_AUDIT + roadmap"`

### PR 3 gate
- [ ] DoD gates + the equivalence test pass. PR → **staging**, CI green, merge. Owner: verify on staging (after regen for the content-gap/score-derived figures).

---

## Self-review

**1. Spec coverage:**
- §3 `keywordValueReasons` → Task 2.1; `keywordDollarValue` → Task 3.1. ✓
- §4 PR1 real-cpc (column+mapper+populate+pass+public) → Tasks 1.1/1.2. ✓
- §4 PR2 reasons serialize (KCC + strategy) + render (both drawers) → Tasks 2.2/2.3/2.4. ✓
- §4 PR3 $ helper + cpc-join + per-keyword $ + revenue-at-stake → Tasks 3.1-3.4. ✓
- D2 one $ definition (matches roi.ts) → Task 3.1 equivalence test. ✓
- D3 ride existing pipelines (no endpoint) → Tasks 3.3/3.4 (existing /api/public/roi + serialization). ✓
- D4 distinct from OV → Task 2.4 constraint ("do NOT touch OverviewTab"). ✓
- §5 anti-dup (one formula each; tier; EMV internal) → helpers + constraints throughout. ✓
- §7 stale-grounding guard → "re-confirm at execution" on Tasks 1.1/2.2/2.3/3.2. ✓

**2. Placeholder scan:** migration number `NNN` and the strategy-serialization function are deliberate re-confirm-at-execution anchors (not lazy TODOs — the guard is the point); every code step shows a concrete test or a pinned contract. ✓

**3. Type consistency:** `keywordValueReasons(components, raw)`, `keywordDollarValue({...}) → {currentMonthly, upsideMonthly}`, `valueReasons?: string[]`, `cpc?: number`, `revenueAtStake?: number` — consistent across tasks. ✓
