# Strategy Redesign — Phase 3a: Cannibalization Triage UI + Fix-in-Editor

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:executing-plans. Steps use `- [ ]` checkboxes.

**Goal:** Replace the passive `CannibalizationAlert` (in the Act band only) with an actionable **CannibalizationTriage** queue: each keyword-cannibalization issue shows the competing pages with the keeper marked, the recommended fix, and a per-duplicate **Fix in editor** CTA that opens the SEO Editor focused on that page.

**Architecture:** New leaf `CannibalizationTriage` mounts in the bands Act band only (flag `strategy-decision-bands`); the legacy layout keeps the unchanged `CannibalizationAlert` (byte-identical). Mirrors the Phase 2 OpportunitiesList pattern (keep old leaf, add new element-const, swap only the bands mount). The Fix-in-Editor CTA uses the existing `fixContext` router-state contract — but the SEO Editor prefill effect currently hard-gates on `fixContext.pageId`, which no caller sets (so prefill is dead). We relax that gate to fire on `pageId || pageSlug` (the slug-fallback match already exists in the hook; this also fixes the latent no-prefill bug for PageIntelligence + DeadLinkPanel, and matches the schema-suggester slug→id precedent).

**Scope boundary:** 3a is READ-ONLY (navigation only). The write paths — **Mark resolved** (`cannibalization_resolved` outcome) and **Send to client** (dedicated `cannibalization` client-action type, per owner decision) — are **Phase 3b**.

**Flag:** `strategy-decision-bands` (band-level gating; no per-leaf flag, no new flag).

---

## Verified facts (from the Phase 3 sweep)

- Data: `strategy.cannibalization` is `CannibalizationItem[]` (`shared/types/workspace.ts:131-139`): `{ keyword; pages: {path; position?; impressions?; clicks?; source}[]; severity: 'high'|'medium'|'low'; recommendation; canonicalPath?; canonicalUrl?; action? }`. No id, no resolved field. Row identity is `keyword`.
- Current mount (`src/components/KeywordStrategy.tsx`): `realLeaves.cannibalization = strategy.cannibalization?.length ? <CannibalizationAlert entries={strategy.cannibalization} /> : null` (~line 354-356). Rendered in **both** the bands Act band (~line 408, between `keywordGaps` and `strategyDiff`) and the legacy layout (~line 457-459). `CannibalizationAlert` has a **second** consumer (`ContentPipeline.tsx`) — do NOT modify it; build a new component.
- SEO Editor prefill: `src/components/editor/useSeoEditorSessionState.ts:64-80`. Effect gate (line 65): `if (fixContext?.pageId && fixContext.targetRoute === 'seo-editor' && pages.length > 0 && !fixConsumed.current)`. Match predicate already does `p.id === pageId || p.slug === pageSlug || matchPageIdentity(p.publishedPath||p.slug, pageSlug)`. `matchPageIdentity` is imported from `'../../lib/pathUtils'`. On match: `setExpanded(new Set([match.id]))` + scroll to `seo-editor-page-${match.id}`.
- fixContext travels via React Router `location.state` → App lifts it → passes as a **prop** down App → SeoEditorWrapper → SeoEditor → useSeoEditorSessionState. Only **static** pages receive prefill (CmsEditor is not wired); a CMS-backed loser degrades to plain navigation.
- No test pins the gate condition; the extraction contract test only checks delegation. Schema-suggester precedent (`tests/unit/schema-suggester-generation-fixcontext.test.tsx`) resolves pageSlug→id from inventory.

---

## Task 1: Relax the SEO Editor prefill gate (+ test)

**Files:** Modify `src/components/editor/useSeoEditorSessionState.ts:65`; Test `tests/contract/seo-editor-session-state-extraction.test.ts` is structure-only (leave); add a focused behavior test (new file or extend an existing hook test).

- [ ] **Step 1:** Change the gate so prefill fires when EITHER pageId or pageSlug is present (the match already handles both):

```ts
// before
if (fixContext?.pageId && fixContext.targetRoute === 'seo-editor' && pages.length > 0 && !fixConsumed.current) {
// after
if ((fixContext?.pageId || fixContext?.pageSlug) && fixContext.targetRoute === 'seo-editor' && pages.length > 0 && !fixConsumed.current) {
```

- [ ] **Step 2:** Add `tests/unit/strategy/seoEditorPrefillGate.test.ts` (or extend the session-state test) — render `useSeoEditorSessionState` with `fixContext={{ targetRoute:'seo-editor', pageSlug:'/blog/x' }}` (NO pageId) and a `pages` array containing a page whose `publishedPath`/`slug` matches `/blog/x`; assert the matched page id is in `expanded`. Add a negative case: a non-matching slug leaves `expanded` empty. (Use a small fake `pages` array; the hook is pure-ish — mock the persistence module reads if needed, mirroring `tests/contract/seo-editor-persistence-extraction.test.ts` setup.)

- [ ] **Step 3:** `npm run typecheck` + run the new test → green.

---

## Task 2: CannibalizationTriage component (+ props + barrel)

**Files:** Create `src/components/strategy/CannibalizationTriage.tsx`; Modify `src/components/strategy/types.ts` (add `CannibalizationTriageProps`); Modify `src/components/strategy/index.ts` (barrel export); Test `tests/unit/strategy/CannibalizationTriage.test.tsx`.

- [ ] **Step 1:** Add to `src/components/strategy/types.ts` under the leaf-prop banner (import `CannibalizationItem` from `'../../../shared/types/workspace'`):

```ts
/** Act band: keyword-cannibalization triage queue with per-duplicate Fix-in-Editor CTAs. */
export interface CannibalizationTriageProps {
  entries: CannibalizationItem[];
  workspaceId: string;
}
```

- [ ] **Step 2:** Create `CannibalizationTriage.tsx`. Returns `null` when `entries` empty. `SectionCard title="Keyword cannibalization"` (titleIcon `Copy`, `text-accent-danger`; titleExtra = `${highCount} critical` red Badge when high-severity issues exist). Per issue: keyword (quoted) + severity Badge (`high→red, medium→amber, low→zinc`) + `{n} pages`; recommendation text; competing pages list where the **keeper** = `item.canonicalPath ?? best-position page` (lowest `position`; ties → highest `impressions`; fallback first page), marked with an emerald "keep" tag, and every **non-keeper** page gets a `Fix in editor` `Button` (teal CTA, mirror OpportunitiesList's button styling) that calls:

```tsx
const fixInEditor = (path: string) =>
  navigate(adminPath(workspaceId, 'seo-editor'), {
    state: { fixContext: { targetRoute: 'seo-editor', pageSlug: path, pageName: path } },
  });
```

Use `matchPageIdentity` from `'../../../shared/page-address-utils'` to compare a page path to the keeper path. Top imports only. Watch the SectionCard double-wrap rule. No purple. No `TrendingUp/Down` icons.

- [ ] **Step 3:** Barrel: append `export * from './CannibalizationTriage';` to `src/components/strategy/index.ts`.

- [ ] **Step 4:** Test `CannibalizationTriage.test.tsx` (mirror OpportunitiesList.test.tsx): (a) empty entries → renders null; (b) renders the keyword, severity, and pages; (c) the keeper page has NO Fix button and a non-keeper page's `Fix in editor` button navigates to `seo-editor` with `fixContext.pageSlug = <loser path>`; (d) when `canonicalPath` is set, that page is the keeper (no Fix button) and others are losers.

- [ ] **Step 5:** typecheck + run the test → green.

---

## Task 3: Orchestrator integration (bands Act band only)

**Files:** Modify `src/components/KeywordStrategy.tsx`.

- [ ] **Step 1:** Add `CannibalizationTriage` to the `from './strategy'` destructured import block.

- [ ] **Step 2:** Add a new `realLeaves` element-const (after the existing `cannibalization:` leaf, keeping it intact for legacy):

```tsx
    cannibalizationTriage: strategy.cannibalization && strategy.cannibalization.length > 0
      ? <CannibalizationTriage entries={strategy.cannibalization} workspaceId={workspaceId} />
      : null,
```

- [ ] **Step 3:** In the **bands** Act band only, replace `{realLeaves.cannibalization}` with `{realLeaves.cannibalizationTriage}`. **Do NOT touch the legacy layout's `{realLeaves.cannibalization}`** (parity).

- [ ] **Step 4:** typecheck + `npx vite build`.

---

## Quality gates (before PR)

- [ ] `npm run typecheck` · `npx vite build` · `npx vitest run` · `npx tsx scripts/pr-check.ts` · `npm run verify:feature-flags` · `npm run verify:coverage-ratchet`
- [ ] Orchestrator diff confirms legacy `legacyAnalysis` cannibalization mount is byte-identical.
- [ ] Scaled review (correctness + compliance + parity) → fix confirmed findings.
- [ ] Docs: FEATURE_AUDIT entry, roadmap phase-3a item, memory.

---

## Phase 3b (next, NOT this PR) — recorded scope
- **Mark resolved** → `recordAction({ actionType:'cannibalization_resolved', sourceType:'cannibalization', sourceId:<stable keyword key>, pageUrl:<canonical>, targetKeyword:keyword, baselineSnapshot })` via the recommendation-completion template (dedupe with `getActionByWorkspaceAndSource`, `void captureBaselineFromGsc`, broadcast `OUTCOME_ACTION_RECORDED`, `invalidateIntelligenceCache`). **Fix the stale `actionTypeEnum`** in `server/schemas/outcome-schemas.ts` (omits `cannibalization_resolved` + 4 others). Resolved state is inferred from the tracked action (durable; survives strategy regen) — **no resolved column** (would be clobbered by `replaceAllCannibalizationIssues`). Needs a resolved-set read path + a `useWorkspaceEvents` handler on `OUTCOME_ACTION_RECORDED` to re-filter.
- **Send to client** → **dedicated `cannibalization` client-action type** (owner decision): add to `ClientActionSourceType` + `validSources` + `createActionSchema.sourceTypeSchema` + `clientActionDeliverableType()` mapping (+ a `cannibalization` `DeliverableType` + adapter, or guard the dual-write mirror) + a `ClientActionDetailModal` renderer case. Reuse the grandfathered `createAdminClientAction` / `POST /api/client-actions` path (pr-check-compliant; a new `/send-to-client` route would violate `unified-send-to-client-bespoke-route`). Single "Send to client" button + optional note (note → Conversations, no note → Decisions).
