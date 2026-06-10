# PR 1 — Money + Trust Fixes — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:executing-plans (inline) — single-agent execution, `requesting-code-review` before PR. Contract+test-centric per docs/PLAN_WRITING_GUIDE.md: contracts and test assertions are locked here; implementation bodies are written at execution time against the real code. For each task: READ the real code → write the failing test from the assertions below and RUN it (confirm red for the right reason) → minimal implementation → green + typecheck → commit. If real code contradicts a contract here, STOP that task and record it in the PR body.

**Goal:** Fix the five S-effort user-facing trust issues from the 2026-06-09 audit: the seoDataMode billing regression, dead cannibalization detection for non-GSC workspaces, inconsistent generation-credit metering, raw camelCase field labels shown to clients, and silently-inert decision buttons.

**Branch:** `claude/audit-pr1-money-trust` off `origin/staging`. **Base PR:** `staging`.

**Owning bounded contexts:** keyword-strategy (server: Tasks 1–3) and client inbox (frontend: Tasks 4–5). New behavior: none — all five are corrections to existing behavior. No new WS events, no new query keys, no schema changes, no flags.

---

## Task Dependencies

```
Sequential (shared file server/keyword-strategy-generation.ts):
  Task 1 (seoDataMode) → Task 3 (no-op refund)

Parallel with the above:
  Task 2 (cannibalization — owns keyword-strategy-enrichment.ts only)

Frontend, parallel with all server tasks:
  Task 4 (field labels) → Task 5 (submitting state)
  (sequenced only because both may touch the same adapter/helper module — verify
   where approveCtaLabel lives before Task 5; if different files, they are independent)
```

Model assignments (Claude platform): all tasks Sonnet-tier or orchestrator-inline; reviewer Opus-tier.

---

## Task 1 — Honor explicit `seoDataMode: 'none'` (zero provider calls)

**Audit:** confirmed finding #1 (adversarially verified). Regression introduced by `a5644282` (2026-06-05).

**Files:**
- Modify: `server/keyword-strategy-generation.ts` (normalization ~:91, promotion ~:163-169)
- Modify: `server/routes/jobs.ts` (~:375 `(params.seoDataMode as string) || 'none'`)
- Inspect + modify if needed: `server/routes/keyword-strategy.ts` (any same-pattern defaulting), `server/keyword-strategy-universe.ts` (:104-107, :142-145 — comments say "'none' is treated as 'quick' depth when a provider exists"; any internal promotion must also be removed), `server/keyword-strategy-seo-data.ts` (:114 gates on mode 'none' — must hold post-fix)
- Test: new `tests/unit/keyword-strategy-seo-data-mode.test.ts` (or extend the existing generation test file if one already mocks the provider — check `rg 'generateKeywordStrategy' tests/` first)

**Contracts:**
1. `seoDataMode` distinguishes three caller states end-to-end: `undefined` (no choice → promote to `'quick'` when a provider is configured), explicit `'none'` (→ **zero** SeoDataProvider calls anywhere in the generation run), explicit `'quick' | 'full'` (unchanged).
2. Route handlers must not collapse `undefined` into `'none'` before calling `generateKeywordStrategy` — grep ALL call sites of `generateKeywordStrategy` and any `seoDataMode` defaulting (`|| 'none'`, `?? 'none'`) in one pass; fix every one in this commit (CLAUDE.md cross-cutting-constraint rule).
3. The zero-call guarantee is asserted at the provider boundary, not at the mode variable: mock/spy the configured provider and count calls.
4. UI copy in `src/components/KeywordStrategy.tsx:544` ("No DataForSEO credits used") becomes true again — no copy change needed.

**Test assertions (write first, run red):**
- `generateKeywordStrategy(ws, { seoDataMode: 'none', … })` with a registered mock provider → every provider method spy has `callCount === 0`, and generation still completes (AI/GSC-only path).
- Same call with `seoDataMode: undefined` → resolved mode is `'quick'` (assert provider discovery/metrics spies were called, or assert the resolved-mode value if the function exposes it in its result/log).
- Jobs-route param mapping: `params.seoDataMode` absent → `generateKeywordStrategy` receives `undefined`, not `'none'` (unit-test the params extraction or assert via the integration path).

**Steps:** (1) read the real normalization chain + every call site; (2) failing tests; (3) minimal fix preserving absent-vs-explicit through the chain; (4) full keyword-strategy test files green + typecheck; (5) commit `fix: honor explicit seoDataMode 'none' with zero provider calls`.

---

## Task 2 — Cannibalization detection without GSC data

**Audit:** strategy-keywords medium, re-verified against source 2026-06-09 (loop is nested inside `if (gscData.length > 0)`).

**Files:**
- Modify: `server/keyword-strategy-enrichment.ts` (~:656-760 — the `// Cannibalization Detection` block)
- Test: new `tests/unit/keyword-strategy-cannibalization.test.ts` (the existing `tests/unit/cannibalization.test.ts` is a module-load smoke for an unrelated module — leave it; do not overload it)

**Contracts:**
1. The `for (const [kw, pages] of kwPages)` detection loop executes for `gscData = []`. `kwPages` from `strategy.pageMap` (source `'keyword_map'`) is sufficient input.
2. `gscByQuery` is hoisted above the guard and initialized empty; GSC merge/enrichment lookups (`gscByQuery.get(kw)`) degrade to `undefined` positions/impressions/clicks.
3. Severity without GSC metrics falls back to the page-count rule already in the block (read the real severity logic before assuming its shape — if severity strictly requires GSC fields, the fallback is: 3+ pages → high, else medium/low per the existing tiers).
4. Behavior with GSC data present is unchanged (existing enriched path identical).

**Test assertions:**
- Strategy whose `pageMap` has two entries sharing `primaryKeyword: 'fitness coaching'` (different `pagePath`s), `gscData: []` → result `cannibalization.length >= 1`, the issue lists both paths, all page sources `'keyword_map'`.
- Same input with `gscData` containing 2-page rows for an unrelated query → previously-passing GSC-path behavior still holds (pin one assertion on the merged path so the hoist didn't break enrichment).
- Note the export surface: if the block lives inside a non-exported enrichment function, test through the smallest exported function that wraps it — do NOT export internals just for the test unless no exported path reaches the block.

**Steps:** read block → failing test → hoist + fallback → green (run the whole enrichment test file) → commit `fix: detect keyword-map cannibalization without GSC data`.

---

## Task 3 — Refund usage slot on sanitizer-only no-op generation

**Audit:** strategy-keywords low (metering inconsistency between two no-op exits).

**Files:**
- Modify: `server/keyword-strategy-generation.ts` (`noOpChanged` path ~:332-379; reference refund at ~:383 `decrementUsage`)
- Test: extend the Task 1 test file (same module, sequential task) or the existing generation test file

**Contracts:**
1. Metering invariant: a generation run that performs **zero AI synthesis** (both the pure no-op and the sanitizer-only `noOpChanged` exits) leaves `strategy_generations` usage at its prior value.
2. The sanitizer re-persist behavior itself is unchanged (rows still repaired/persisted, broadcast still fires).
3. Scope guard: do NOT redesign the result shape. If making the jobs-route message honest ("Strategy repaired" vs "Strategy complete") requires more than a localized flag read at the existing result-consuming site, leave the message as-is and note it in the PR body.

**Test assertions:**
- Drive the `noOpChanged` exit (all pages fresh per the upToDate early-return at `keyword-strategy-ai-synthesis.ts:414-421`, with the sanitizer reporting removed/repaired rows — read how the existing tests construct this state; if no test reaches this path today, construct via the smallest seam, e.g. a strategy blob with a row the sanitizer deterministically removes) → usage counter after === usage counter before.
- Pure no-op path still refunds (pin the existing behavior with an assertion so the two exits can't diverge again).

**Steps:** read both exits → failing metering test → add the refund → green → commit `fix: refund strategy-generation usage on sanitizer-only no-op`.

---

## Task 4 — Humanize client-facing field identifiers

**Audit:** client-ux medium, re-verified (raw `field` rendered at `decision-renderers.tsx` ~:126-129; `item.field ?? 'Item'` at `InlineApprovalCard.tsx` ~:163).

**Files:**
- Modify: `src/lib/decision-adapters.ts` (new exported helper — this module already owns NormalizedDecision adaptation)
- Modify: `src/components/client/decision-renderers.tsx` (ItemDiffRow header render)
- Modify: `src/components/client/inbox/InlineApprovalCard.tsx` (multi-page label)
- Test: `tests/unit/decision-field-labels.test.ts` (pure function) — plus check whether an existing component test renders ItemDiffRow and would pin the change

**Contracts:**
1. `humanizeFieldLabel(field: string | null | undefined): string | null` exported from `src/lib/decision-adapters.ts`. Known map: `seoTitle → 'SEO Title'`, `seoDescription → 'Meta Description'`, `schema → 'Schema Markup'`. Unknown fields: generic camelCase → Title Case split (so no raw camelCase can ever reach the DOM again). `null`/`undefined`/`''` → `null`.
2. Both render sites route through the helper: ItemDiffRow's `— ${field}` suffix and InlineApprovalCard's multi-page `label={item.field ?? 'Item'}`.
3. Grep `\.field` across `src/components/client/` for any other raw render of the same payload field; fix all in this commit (cross-cutting-constraint rule). Do NOT touch admin components.
4. Visual: ItemDiffRow's header has `uppercase tracking-wider` styling — 'SEO Title' renders 'SEO TITLE'; acceptable and consistent with current design.

**Test assertions:**
- `humanizeFieldLabel('seoTitle') === 'SEO Title'`; `('seoDescription') === 'Meta Description'`; `('schema') === 'Schema Markup'`; `('targetKeyword') === 'Target Keyword'` (generic fallback); `(null) === null`; `('') === null`.

**Steps:** failing unit test → helper → wire both render sites → green + typecheck → preview screenshot of an approval card (verification section) → commit `fix: humanize field labels in client inbox diff rows`.

---

## Task 5 — DecisionCard disabled state while a response is submitting

**Audit:** client-ux low, re-verified (`UnifiedInbox.tsx` ~:557-571 passes `undefined` handlers when `submittingId === d.id`; DecisionCard renders enabled-looking buttons).

**Files:**
- Modify: `src/components/client/DecisionCard.tsx` (new optional prop)
- Modify: `src/components/client/inbox/UnifiedInbox.tsx` (pass the prop at the call site shown above)
- Test: component test — check for an existing `DecisionCard` test file first (`rg 'DecisionCard' tests/component/`); extend it if present, else create `tests/component/DecisionCard.test.tsx` following the existing component-test patterns in `tests/component/`

**Contracts:**
1. `DecisionCardProps.submitting?: boolean` (default false). When true: Approve / Request changes / Decline buttons render `disabled`, and the approve CTA label reflects in-flight state. Before writing: READ how `approveCtaLabel` is defined and what signature it actually has (InlineApprovalCard calls a 3-arg form per the audit; DecisionCard currently calls a 1-arg form — they may be different helpers or one helper with optional args; reuse, don't fork).
2. UnifiedInbox passes `submitting={submittingId === d.id}` at the uniform-mode call site. Keep the existing `undefined`-handler guards (defense in depth) — `submitting` adds the visual state on top.
3. No change to legacy bulk-mode paths (the uniform-mode block is explicitly scoped in the component's own comments).

**Test assertions:**
- Render DecisionCard with `submitting` → all three verb buttons have the `disabled` attribute.
- Render without `submitting` → buttons enabled (pin the default).

**Steps:** read DecisionCard + approveCtaLabel → failing component test → prop + disabled wiring + call-site → green + typecheck → commit `fix: disable DecisionCard verbs while response is submitting`.

---

## Systemic Improvements

- **New tests:** zero-provider-call contract for explicit 'none' (Task 1 — this is the regression test the audit found missing), cannibalization-without-GSC unit (Task 2), metering invariant (Task 3), field-label unit (Task 4), DecisionCard submitting component test (Task 5).
- **Shared utility:** `humanizeFieldLabel` (Task 4) — single authority for payload-field display names; future inbox renderers must use it.
- **pr-check rules:** none in this PR (the audit's proposed rules land with their owning PRs: 3, 4, 7).
- **Feature-class gates:** bug-fix class — full suite + typecheck + build + pr-check; no FEATURE_AUDIT/flag entries required. BRAND_DESIGN_LANGUAGE: no color/pattern changes (label text + disabled states only).

## Verification Strategy

- [ ] `npx vitest run tests/unit/keyword-strategy-seo-data-mode.test.ts tests/unit/keyword-strategy-cannibalization.test.ts tests/unit/decision-field-labels.test.ts` — new tests green
- [ ] `npx vitest run` — full suite green
- [ ] `npm run typecheck && npx vite build && npm run pr-check && npm run verify:feature-flags && npm run verify:coverage-ratchet`
- [ ] Preview screenshot: client inbox approval card showing humanized labels (desktop + 375px width)
- [ ] Preview interaction: click Approve on a decision, observe disabled buttons during flight
- [ ] `superpowers:requesting-code-review` — single-agent gate; fix anything surfaced before opening the PR
