# Strategy Redesign — Phase 4: Reference Band Consolidation — Implementation Plan

## Overview

Phase 4 consolidates the **Reference band** of the decision-first Strategy IA (flag `strategy-decision-bands`, ON only). It merges Backlink + Competitive into one Authority & Backlinks leaf, dedups the competitor-evidence surface and adds inline Track, demotes Site Target Keywords to a Hub deep-link, makes Keyword Opportunities actionable, compacts the stat grid, makes the ranking distribution click-through, folds the Guide into a single help disclosure, and deletes orphaned dead code. It also fixes three folded-in bugs (BacklinkProfile React-Query migration, the Competitive Intel cache-label, and the `STRATEGY_UPDATED → competitorIntel` invalidation gap).

**Owning bounded context:** SEO Strategy (admin). Surface: `src/components/KeywordStrategy.tsx` + `src/components/strategy/*`. No new server routes; one shared deep-link helper change; two React-Query invalidation wirings.

**Grounding:** pre-plan audit `wf_af040c1c-091` (8 agents). Every file/line/symbol below is verified against real code.

---

## The one hard constraint (load-bearing, repeated from Phases 2–3)

`legacyAnalysis` (`KeywordStrategy.tsx` L434–473, flag OFF) **must stay byte-identical**. The orchestrator builds a single shared `realLeaves` map consumed by BOTH `bandsAnalysis` (flag ON) and `legacyAnalysis`. Therefore:

- **Never** edit a shared leaf's internals in a way that changes its rendered DOM if `legacyAnalysis` consumes it. The ONLY exception is a render-output-neutral data-layer swap (useEffect→useQuery) producing identical output — the accepted Phase-2 precedent (StrategyDiff).
- For new behavior, **ADD a new `realLeaves` key** and reference it ONLY inside the bands Reference block (`L416–427`). This is exactly how Phase 2 added `opportunitiesList` and Phase 3 added `cannibalizationTriage`.
- **The TabBar (analysis/guide) is top-level, OUTSIDE the bands/legacy split (`L477–484`).** Removing the Guide tab unconditionally would change flag-OFF behavior. The Guide demotion MUST be flag-conditional (see 4c).

**Flag NOT removed this phase.** The spec §7 table folds "remove the flag" into Phase 4, but (a) the resuming instruction says "behind the flag," (b) spec §7 intro says the old layout stays "until the flag is removed *after* Phase 4," and (c) the deferred cumulative `scaled-code-review` over all redesign work is the safety net that flag-removal+legacy-deletion would destroy. **Flag removal + `legacyAnalysis` deletion is a dedicated final step after Phase 5 + the cumulative review.** This plan documents the removal checklist but does not execute it.

---

## PR split (3 sub-PRs, each → staging behind the flag, normal single-agent review before merge)

| Sub-PR | Scope | Why grouped |
|---|---|---|
| **4a — Authority & Backlinks** | New `AuthorityAndBacklinks` (merge Backlink + Competitive comparison bars); RQ-migrate BacklinkProfile via shared `useBacklinkProfile`; remove own-domain stat bar; fix cache-label; wire `backlinkProfile` + `competitorIntelAll` into `strategyMutationKeys`. Dedup of the embedded keyword-gaps happens implicitly (merged leaf omits gaps). | Data/competitive cluster; shares the queryKeys/wsInvalidation/CompetitiveIntel surface |
| **4b — Competitor evidence + keyword surfaces** | KeywordGaps → optional inline Track + move Act→Reference (the single deduped competitor-evidence surface); SiteTargetKeywords → "Manage in Keyword Hub" deep-link card; KeywordOpportunities → per-row "Explore in Hub". | The "keyword rows" cluster; all reuse `useTrackKeyword`/`buildHubDeepLinkQuery`; all gate new affordances on optional props for legacy parity |
| **4c — Visualization + help + dead code** | `StrategyStatBar` (compact); RankingDistribution click-to-filter + `HUB_SEGMENT_VALUES` striking_distance fix; Guide → flag-conditional help disclosure; delete orphaned `ActionQueue` (coupled). | Reference-band visual polish + help + cleanup |

Each sub-PR must pass the full gate before the next opens. 4a → 4b → 4c sequential (all touch the orchestrator's Reference block + `realLeaves`).

---

## Execution discipline (every task)

Per `docs/PLAN_WRITING_GUIDE.md`: (1) READ the real code; (2) write the failing test from the assertions below and RUN it (confirm red for the right reason); (3) implement minimally against real signatures; (4) RUN test green + `npm run typecheck`; (5) commit. Never transcribe; never skip the red. If real code contradicts a contract here, STOP and report. Model ladder (Anthropic): Sonnet for the leaf/data tasks; Opus for the orchestrator rewiring, the deep-link-helper change, and review.

---

## Sub-PR 4a — Authority & Backlinks

### Contracts

**New shared hook** `src/hooks/admin/useBacklinkProfile.ts`:
```ts
export interface BacklinkData {
  domain: string;
  overview: BacklinksOverview | null;   // mirror server/seo-data-provider.ts L82-91
  referringDomains: ReferringDomain[];  // mirror server/seo-data-provider.ts L93-98 (capped 15)
}
export function useBacklinkProfile(workspaceId: string): UseQueryResult<BacklinkData | null>;
// queryKey: queryKeys.admin.backlinkProfile(workspaceId); queryFn: backlinks.get(workspaceId);
// enabled: !!workspaceId; staleTime: 48h (backlink data changes slowly; matches the existing competitor cache window)
```

**New query key** `src/lib/queryKeys.ts` (admin block, near `strategyDiff` L90–93):
```ts
backlinkProfile: (wsId: string) => ['admin-backlink-profile', wsId] as const,
```

**API typing** `src/api/seo.ts` L154–157: retype `backlinks.get` from `getOptional<unknown>` → `getOptional<BacklinkData>` (returns `BacklinkData | null`).

**Invalidation** `src/lib/wsInvalidation.ts` `strategyMutationKeys()` (L38–58): append BOTH
`queryKeys.admin.backlinkProfile(workspaceId)` AND `queryKeys.admin.competitorIntelAll(workspaceId)`.
(The competitor-domains save route already broadcasts `STRATEGY_UPDATED` — frontend-registry half only; do NOT add a new broadcast.)

**New leaf** `src/components/strategy/AuthorityAndBacklinks.tsx` (Reference-band-only):
- Props: `{ workspaceId; competitors: string[]; seoDataAvailable: boolean }` (declare `AuthorityAndBacklinksProps` in `strategy/types.ts`).
- Consumes `useBacklinkProfile` + the existing `competitorIntel` query (lift the query into a small `useCompetitorIntel` hook OR keep inline — implementer's call; if inline, set `staleTime: 168h` to match the real server TTL).
- Renders: backlink StatCards (the canonical grid from BacklinkProfile L105–112) + Top Referring Domains table + per-competitor `ComparisonBar` set (organicTraffic/organicKeywords/referringDomains/organicCost) + "Their Top Keywords".
- **Omits** the own-domain "Your …" StatCard grid (CompetitiveIntel L188–195) and the embedded Keyword Gaps section (CompetitiveIntel L259–289). This omission IS the dedup — no edit to `CompetitiveIntel.tsx` needed.
- **Cache label fix:** do not render "Cached 48h". `fetchedAt` is response-assembly time, not cache age, so label honestly as "Updated {relative time from fetchedAt}". Set the React-Query `staleTime` to `168 * 60 * 60 * 1000` and correct/remove the stale `// 48h` comment.
- Preserve BacklinkProfile's string-fragile error branches (`error.includes('No SEO data provider configured')` → amber "requires DataForSEO") — `getOptional` still throws 503, surfaced via `useQuery` `error`.
- Color: teal = own/authority, orange = competitor (existing ComparisonBar convention). No blue/purple. Reuse `useToggleSet(UNBOUNDED_TOGGLE_SET_OPTIONS)` for collapsibles.

**Migrate legacy `BacklinkProfile.tsx`** to consume `useBacklinkProfile` (delete the useState+useEffect+`backlinks.get` block L44–53). This is render-output-neutral → legacy DOM unchanged. Preserve all four render branches (loading/error/empty/success) exactly.

**Orchestrator** `KeywordStrategy.tsx`:
- Add `authorityAndBacklinks:` to `realLeaves` (Reference-band-only).
- Bands Reference block (L420–421): replace `{realLeaves.backlink}{realLeaves.competitive}` with `{realLeaves.authorityAndBacklinks}`.
- `realLeaves.backlink` + `realLeaves.competitive` keys STAY (legacy L465–466 consumes them, plus the `cachedKeywordGaps={strategy?.keywordGaps}` prop pass at L369 stays for legacy). Legacy block untouched.

### Tests (4a)
1. `useBacklinkProfile` / AuthorityAndBacklinks component test: loading/error/empty/success branches; the no-provider 503 still shows the amber "requires DataForSEO" message (regression guard for the string-fragile check); merged leaf renders ComparisonBars but NOT the own-domain "Your …" grid and NOT a Keyword Gaps list.
2. Unit test: `strategyMutationKeys(wsId)` includes `queryKeys.admin.backlinkProfile(wsId)` AND `queryKeys.admin.competitorIntelAll(wsId)` (pure-function regression guard for the invalidation gap).
3. Flag-OFF parity: legacy still renders standalone BacklinkProfile + CompetitiveIntel (their `realLeaves` keys intact); BacklinkProfile DOM unchanged after the hook migration (extend/keep `tests/component/BacklinkProfile-link-types.test.tsx`).

---

## Sub-PR 4b — Competitor evidence + keyword surfaces

### Contracts

**KeywordGaps.tsx → inline Track (the "Competitor evidence" surface):**
- Extend props (in `KeywordGaps.tsx` inline, matching its existing style) with OPTIONAL tracking fields mirroring `SiteTargetKeywordsProps` (`strategy/types.ts` L213–221):
  `trackedKeywords?: Set<string>; trackingPending?: Set<string>; trackingErrors?: Map<string,string>; onTrack?: (kw: string) => void;`
- Gate the new per-row Track IconButton with `showTrack = !!onTrack` (mirror the existing `showHubLink` guard L25) so the legacy call site (no tracking props) renders byte-identically (View-in-Hub only).
- Per-row Track button: copy SiteTargetKeywords L28–32 (derive `key = keywordTrackingKey(gap.keyword)`, tracked/pending/error) + L43–52 (IconButton: Plus/Loader2/Check, teal hover untracked / `text-accent-success` tracked / spinning muted pending, disabled while pending) + L63–67 (`InlineBanner size="sm" icon={false}` for `trackError`). Keep the existing View-in-Hub button → two IconButtons per row.
- Use the passed `kdColor` for KD% (already wired). Optionally converge the local `KeywordGapItem` (L6–12) onto shared `KeywordGapItem` (`shared/types/workspace.ts` L68–74) — they are field-identical; do only if it keeps the diff clean.

**Orchestrator** `KeywordStrategy.tsx`:
- Thread `tracking.trackedKeywords/trackingPending/trackingErrors` + `onTrack={tracking.trackKeyword}` into `realLeaves.keywordGaps` (L344–351). The `tracking` hook instance already exists (L83).
- **Move** `{realLeaves.keywordGaps}` from the bands ACT block (L412) into the bands Reference block (L416–427), positioned as the competitor-evidence surface (e.g. after `authorityAndBacklinks`). Legacy (L456) untouched.
- Net effect: competitor-gap evidence renders exactly once in the flag-ON layout (KeywordGaps in Reference; the merged AuthorityAndBacklinks deliberately omits gaps).

**SiteTargetKeywords → Hub deep-link card:**
- Add a NEW `manageInHub:` leaf to `realLeaves`: a compact `<SectionCard title="Site Target Keywords" titleIcon={Target}>` wrapping a single teal `<Button variant="link" icon={ArrowUpRight} iconPosition="right">Manage in Keyword Hub</Button>` whose onClick navigates to:
  `adminPath(workspaceId, 'seo-keywords') + '?tab=in_strategy'`
  — use the **literal** `'?tab=in_strategy'` form so the two-halves contract test (`tests/contract/tab-deep-link-wiring.test.ts` L220 regex) detects + validates the sender. Do NOT route through `buildHubDeepLinkQuery({keyword:''})` (emits a stray `?q=`). Add `KEYWORD_COMMAND_CENTER_FILTERS` import only if used; the literal is preferred for test visibility.
- Bands Reference block (L422): replace `{realLeaves.siteKeywords}` with `{realLeaves.manageInHub}`.
- `realLeaves.siteKeywords` key + `SiteTargetKeywords.tsx` STAY (legacy L467 consumes them — not orphaned).

**KeywordOpportunities → per-row "Explore in Hub":**
- Opportunities are freeform AI **prose**, not clean keywords (verified: `StoredKeywordStrategy.opportunities: string[]`, never enriched; fixtures like "Optimize for featured snippets"). Auto-Track would pollute rank tracking. **Decision: per-row "Explore in Hub" deep-link only** (lands the analyst in Hub research with the phrase pre-filled), matching the existing "validate with keyword research before acting" disclaimer. No Track button.
- Extend `KeywordOpportunitiesProps` (`strategy/types.ts` L223–225) with OPTIONAL `workspaceId?: string; navigate?: (to: string) => void` (mirror KeywordGaps' optional-nav pattern). Per-row "Explore in Hub" IconButton (ArrowUpRight) → `navigate(adminPath(workspaceId,'seo-keywords') + buildHubDeepLinkQuery({ keyword: opp }))`, gated on `!!workspaceId && !!navigate`.
- Legacy mount (L468) passes only `opportunities` → no affordance renders → byte-identical. Bands mount (L383) passes `workspaceId` + `navigate`. Preserve early-return-null-on-empty and verbatim string rendering.

### Tests (4b)
1. KeywordGaps: Track IconButton renders per row when `onTrack` provided; click calls `onTrack(gap.keyword)`; tracked/pending/error visual states; AND no Track button when `onTrack` omitted (legacy parity, mirror the existing `showHubLink=false` test in `tests/component/cross-surface-handoffs-w3-3.test.tsx`).
2. Orchestrator/dedup: competitor-gap rows appear exactly once in the flag-ON layout (in Reference, not Act).
3. Hub deep-link card: renders a "Manage in Keyword Hub" link targeting `seo-keywords` with `?tab=in_strategy`; `npx vitest run tests/contract/tab-deep-link-wiring.test.ts` stays green (sender detected, receiver reads it).
4. KeywordOpportunities (`tests/unit/strategy/KeywordOpportunities.test.tsx`): existing heading/per-string/empty-null assertions stay green; with `workspaceId`+`navigate` a per-row "Explore in Hub" affordance renders; WITHOUT them, none renders (legacy parity).

---

## Sub-PR 4c — Visualization + help + dead code

### Contracts

**StrategyStatBar (compact):**
- New `src/components/strategy/StrategyStatBar.tsx` wrapping `<CompactStatBar items={...}>` (`src/components/ui/StatCard.tsx`). Map the four StrategyStatGrid metrics to compact items (Pages / Impressions / Clicks / Avg Position). `valueColor` for Avg Position = `positionColor(avgPos)` — **verified returns a Tailwind class** (`text-accent-*`), safe for CompactStatBar's className-only application. Icons are dropped (CompactStatBar has no icon slot — accepted compaction trade-off).
- Props `StrategyStatBarProps` in `strategy/types.ts` (same inputs as `StrategyStatGridProps`).
- Add `statBar:` to `realLeaves`; Reference block (L417) uses `{realLeaves.statBar}`. `realLeaves.statGrid` + `StrategyStatGrid.tsx` STAY for legacy (L451).

**RankingDistribution click-to-filter + deep-link-helper fix:**
- **Fix the helper omission** `src/lib/keywordHubDeepLink.ts`: add `KEYWORD_COMMAND_CENTER_FILTERS.STRIKING_DISTANCE` to `HUB_SEGMENT_VALUES` (the Hub receiver already honors `striking_distance` via `VALID_SEGMENTS`; the sender's allow-set wrongly omits it → silent fallback to `all`). Update the "SIX segments" doc comment to "SEVEN".
- New `src/components/strategy/RankingDistributionClickable.tsx` (or pass optional `workspaceId?`+`navigate?` to a new Reference-band leaf — do NOT edit the shared `RankingDistribution` consumed by legacy L452). The **striking-distance band (positions 11–20 / `top20`)** is the meaningful click target → button deep-linking to `adminPath(ws,'seo-keywords') + '?tab=striking_distance'` (literal, test-visible). Honest scope: only striking-distance has a real Hub destination; other bands have no Hub segment — leave them non-interactive (do NOT invent fake filters that silently fall back to `all`). Legend rows are the a11y-preferred click target (labeled, focusable).
- Add `distributionClickable:` to `realLeaves`; Reference block (L418) uses it. `realLeaves.distribution` + `RankingDistribution.tsx` STAY for legacy.

**Guide → flag-conditional help disclosure:**
- Build a collapsible help disclosure as the LAST child of the bands Reference band (replacing the `{realLeaves.howItWorks}` slot at L426, flag-ON only). Mirror the `StrategySettings` `settingsOpen`/`setSettingsOpen` disclosure pattern (no `Disclosure` primitive exists in `src/components/ui/` — confirmed). It consolidates: the `StrategyHowItWorks` prose (embed the component to keep its conditional DataForSEO/GSC tip logic) + the `METRIC_GLOSSARY` block from `KeywordStrategyGuide`. **Drop the stale "Rank Tracker" string** (`KeywordStrategyGuide.tsx` L98 — Rank Tracker was retired in the 2026-06-12 Keyword Hub cutover).
- **Flag-conditional TabBar (preserves flag-OFF parity):** restructure the return so flag-ON renders `bandsAnalysis` directly (no top-level TabBar, no Guide tab — Guide content now lives in the disclosure), while flag-OFF renders the unchanged `TabBar(analysis|guide)` + `{strategyTab==='guide' && <KeywordStrategyGuide/>}` + `legacyAnalysis`. Keep `strategyTab` state + `KeywordStrategyGuide` import (flag-OFF still uses them). The `tab-deeplink-ok` hatch (L477) confirms this TabBar is local state, not URL-driven — no `?tab=` contract break.

**Dead code — orphaned ActionQueue (coupled removal):**
- Delete `src/components/admin/ActionQueue.tsx` (confirmed unmounted anywhere). To avoid leaving a freshly-orphaned hook, also remove its only consumer chain: `src/hooks/admin/useActionQueue.ts` + barrel export (`src/hooks/admin/index.ts` L26) + `queryKeys.admin.actionQueue` (`queryKeys.ts` L118) + the 3 `wsInvalidation.ts` references (L257/331/406) + the platform-org report regex (`scripts/report-platform-organization.ts` L82 + `tests/unit/platform-organization-report.test.ts` L57). Delete the tests: `tests/components/admin/admin-components.test.tsx` `describe('ActionQueue')` (L224–329) + its import (L17), and `tests/unit/hooks/admin-queries-a.test.tsx` `describe('useActionQueue')` (L149–172) + import (L138).
- DO NOT touch `ActionQueueStrip` (live client component, distinct) or `CannibalizationAlert` (still used by `ContentPipeline.tsx` L215). The `/api/insights/:workspaceId/queue` server route may stay (harmless) or be removed — implementer's call; if removed, confirm no other consumer.
- If the coupled removal proves messier than expected at implementation, fall back to deleting the component + its component-test block only and leave the hook (note it explicitly). Prefer the full clean removal.

### Tests (4c)
1. StrategyStatBar renders the four metrics via CompactStatBar with correct labels/values.
2. Deep-link-helper parity: a test pinning the sender allow-set (`HUB_SEGMENT_VALUES`/`isKeywordHubSegment`) now accepts `striking_distance` and the Hub receiver (`VALID_SEGMENTS`) honors it (sender-set == receiver-honored-set, the silent-fallback bug class).
3. RankingDistribution click-to-filter: clicking the striking-distance row navigates to `?tab=striking_distance`; non-striking bands are not interactive.
4. Help disclosure: collapsed by default, expands, contains glossary/how-it-works prose, and (regression) does NOT contain "Rank Tracker". Orchestrator-level: flag-ON has no Guide tab; flag-OFF still renders the `TabBar(analysis|guide)` + `StrategyHowItWorks` unchanged.
5. `npx vitest run` full suite green after ActionQueue removal (no dangling imports).

---

## Task dependency graph

```
4a:  T1 useBacklinkProfile + queryKey + api typing
     → T2 wsInvalidation (backlinkProfile + competitorIntelAll)        [parallel w/ T1 after queryKey lands]
     → T3 migrate legacy BacklinkProfile to the hook (render-neutral)
     → T4 AuthorityAndBacklinks leaf (uses T1) + types.ts
     → T5 orchestrator Reference rewire (backlink+competitive → authorityAndBacklinks)
     → review → staging

4b (after 4a merged):
     T6 KeywordGaps Track (optional props)  ∥  T7 Hub deep-link card leaf  ∥  T8 KeywordOpportunities Explore-in-Hub
     → T9 orchestrator: thread tracking into keywordGaps, move Act→Reference, swap siteKeywords→manageInHub, pass nav to opportunities
     → review → staging

4c (after 4b merged):
     T10 keywordHubDeepLink striking_distance fix + parity test
     → T11 StrategyStatBar  ∥  T12 RankingDistributionClickable (uses T10)
     → T13 help disclosure + flag-conditional TabBar
     → T14 ActionQueue coupled removal  (independent — can land first or last)
     → T15 orchestrator: statBar/distributionClickable/help-disclosure rewire
     → review → staging
```

Sequential within each sub-PR because they all converge on `KeywordStrategy.tsx` (orchestrator) + shared `realLeaves`. The leaf components within a sub-PR are independent files (parallelizable), but given the small count the controller builds them directly with TDD.

---

## File ownership (controller-built, single-agent)

Shared/sequential: `KeywordStrategy.tsx`, `strategy/types.ts`, `strategy/index.ts`, `src/lib/queryKeys.ts`, `src/lib/wsInvalidation.ts`, `src/lib/keywordHubDeepLink.ts`.
New files: `useBacklinkProfile.ts`, `AuthorityAndBacklinks.tsx`, `StrategyStatBar.tsx`, `RankingDistributionClickable.tsx`, the Hub deep-link card (inline in orchestrator or a tiny leaf), the help disclosure (inline in orchestrator or a leaf).
Must-not-break (legacy parity): `legacyAnalysis` block, `BacklinkProfile.tsx` DOM output, `CompetitiveIntel.tsx` (untouched), `SiteTargetKeywords.tsx`, `RankingDistribution.tsx`, `StrategyStatGrid.tsx`, `StrategyHowItWorks.tsx`, `KeywordStrategyGuide.tsx`.

---

## Systemic improvements

- **Shared utility:** `useBacklinkProfile` retires the last hand-rolled useState+useEffect+fetch in `src/components/strategy/` (spec §10). Consider extracting a small `useCompetitorIntel` hook from CompetitiveIntel's inline query so AuthorityAndBacklinks and the (legacy) CompetitiveIntel share one source — optional, only if it keeps the diff clean.
- **Deep-link helper correctness:** adding `striking_distance` to `HUB_SEGMENT_VALUES` fixes a latent silent-fallback bug affecting any future striking-distance deep-link, not just this one. Pin sender==receiver with a test.
- **Disclosure extraction (noted, not required):** Settings and Help both now implement a collapse. If a third appears, extract a `<Disclosure>` primitive (UI/UX rule 9). Mirror `StrategySettings` for now.
- **pr-check:** no new rule required; existing rules (raw `<button>`, score-color, SectionCard, tab-deep-link two-halves) already cover the surface. Run `pr-check:all` each sub-PR.

---

## Flag-removal checklist (DEFERRED — document only, do NOT execute)

One commit, after Phase 5 + the cumulative `scaled-code-review`:
1. `shared/types/feature-flags.ts`: remove `'strategy-decision-bands'` from `FEATURE_FLAGS` (L53), `FEATURE_FLAG_CATALOG` (L263–275), and the `FEATURE_FLAG_GROUPS` 'Strategy' group keys (L305). If 'Strategy' empties, remove the group + its `FEATURE_FLAG_GROUP_LABELS` entry (L104) or the lifecycle grouping-lockstep test fails (`tests/unit/feature-flag-lifecycle.test.ts` L91–106). `totalFlags===FEATURE_FLAG_KEYS.length` auto-adjusts.
2. `KeywordStrategy.tsx`: delete `useFeatureFlag` usage (L60), delete `legacyAnalysis` (L434–473), inline `bandsAnalysis`, remove now-dead `realLeaves.quickWins`/`lhf`/`cannibalization` (L332–337, L355–357) + the `QuickWins`/`LowHangingFruit`/`CannibalizationAlert` imports (L14/16/18). Verify `QuickWins.tsx`/`LowHangingFruit.tsx` have no other consumers before deleting those files. **NEVER delete `CannibalizationAlert`** (shared with ContentPipeline L215). Restore the TabBar/Guide-tab decision (already removed for flag-ON; flag-OFF path goes away).
3. Docs: spec, roadmap, `FEATURE_AUDIT.md`, feature-flag-lifecycle reference.

---

## Verification strategy (each sub-PR)

```
npm run typecheck                                  # zero errors (project-aware tsc -b)
npx vite build                                     # production build
npx vitest run                                     # FULL suite green (not just new tests)
npx tsx scripts/pr-check.ts                        # zero violations  (+ pr-check:all)
npm run verify:feature-flags                       # flag catalog consistent
npm run verify:coverage-ratchet                    # no coverage regression
npx vitest run tests/contract/tab-deep-link-wiring.test.ts   # 4b/4c deep-link senders
grep -rn "violet\|indigo\|rose-\|pink-\|text-green-400\|purple-" src/components/strategy/  # color laws
git diff origin/staging...HEAD --name-only         # confirm no foreign files before PR
```
Manual/preview: render the Strategy page flag-ON (verify Reference band: merged Authority, single competitor-evidence surface with Track, Hub card, Explore-in-Hub, compact stats, clickable striking-distance, help disclosure) AND flag-OFF (verify byte-identical legacy: Guide tab present, both Backlink+Competitive separate, gaps in old place). Docs after each: `FEATURE_AUDIT.md`, `data/roadmap.json` (+ `sort-roadmap`), `BRAND_DESIGN_LANGUAGE.md` (band layout), `data/features.json` if client-relevant.
