# Pre-Plan Audit — Strategy "The Issue" (verified scope)

> Ground-truth verified against live code on branch `strategy-redesign-phase-4` (2026-06-19). Every net-new file below was confirmed absent; every reused symbol was confirmed present at the cited path. The implementation plan must not introduce a file that is not justified here.

---

## 1. Summary

**Reuse vs net-new.** This feature is **mostly wiring on existing backbone**, not greenfield. Across 6 lanes: ~45 distinct existing files/functions are reused as-is or as templates; **~30 net-new items** (8 SMALL infra/maps, ~9 net-new components, ~8 server net-new, ~5 pr-check rules/tests). The curation engine (5 verbs, policy registry, atomic bulk, `isActiveRec`, `applyLifecycleCarryOver`) is **100% reused** — the admin cockpit is composition, not new backend.

**The 4 biggest net-new lifts:**
1. **`DraftedPovEditor` + the strategy-POV fusion engine** (LARGE FE + MEDIUM BE) — the editable narrated POV where cutting a backing card removes its sentence. No POV store, op, or editable-prose surface exists today. Backend (`strategy-pov-generator.ts` + store + migration 140 + op-registry + Zod) and frontend (`DraftedPovEditor.tsx` + `useStrategyPov`) both net-new.
2. **The delivery loop — BOTH half-loops are open** (4 MEDIUM). Verified: neither the `sendChannel=deliverable` mirror branch in `/send` & `/bulk` NOR the client respond/act-on route exists (the `state-machines.ts` comment references a `/respond` route that is not implemented). Closing requires: rec→deliverable adapter + send-handler mirror + client act-on→content-request route + greenlight→TrackedAction attribution.
3. **`TheIssueClientPage` evergreen V2 client surface** (LARGE) — new composer; cannot reuse `InsightsBriefingPage` (dated magazine) at the shell level; the §5.2 content cards cannot reuse `StrategyContentOpportunitiesSection` (pricing/cart path). Reuses leaf bodies + `ROIDashboard` (orphaned, evergreen-safe — cleanest win).
4. **`BackingMovesQueue` + archetype/stance maps + `CannibalizationKeeperSelector`** (MEDIUM) — archetype map and keeper-override store both confirmed absent; keeper-override is a PENDING roadmap item that must survive the `cannibalization_issues` delete-reinsert clobber.

**Exhaustiveness confidence: HIGH.** All 6 lanes verified claims against code and corrected the capability map in 8 material places (see §9). One unresolved factual conflict I resolved by direct read: **`RecType` is 15 members, not 16** — the union is `technical, content, content_refresh, schema, metadata, performance, accessibility, strategy, aeo, keyword_gap, topic_cluster, cannibalization, local_visibility, local_service_gap, competitor`. Archetype/stance maps cover **15**.

---

## 2. Reuse map (by area, citeable for the plan)

### Curation engine + lifecycle (reuse AS-IS, keep OUT of parallel write set)
- `server/recommendation-lifecycle.ts` — `sendRecommendation`/`strikeRecommendation`/`unstrikeRecommendation`/`throttleRecommendation`/`fixRecommendation` (lines 82–149, all `mutateRec` txn re-read, none write `rec.status`) + `REC_POLICY_REGISTRY` (line 37). Backs all cockpit verbs; cockpit just calls existing PATCH routes.
- `server/recommendations.ts` — `isActiveRec` (661, import verbatim, never re-implement), `applyLifecycleCarryOver` (617, sent/struck/throttled survive regen w/ full v3-axis copy), `isExemptFromAutoResolve` (646), `computeRecommendationSummary`, `sortRecommendations`, `recommendationOutcomeActionType`, `loadRecommendations`. **2752 lines — needs NO edits for the overview phase** except the one new `isCuratedForClient` predicate (Phase 0).
- `server/routes/recommendations.ts` — per-row `/send /strike /unstrike /throttle /fix` + atomic bulk `POST /:ws/bulk` (max 200, one broadcast, batched doorbell). `stripEmvFromPublicRecs` (public allow-list projection). **HOT SHARED FILE — single owner for the loop lane.**
- `shared/types/recommendations.ts` — two-axis lifecycle (`clientStatus`/`lifecycle`/`throttledUntil`/`sentAt`/`struckAt`/`cascade`/`sendChannel`), `RecType` (15), `RecPolicyRegistry`, `OpportunityComponent.evidence`, `summary.topOpportunityRationale`.

### POV / brief engine (clone, re-point)
- `server/meeting-brief-generator.ts` — `assembleMeetingBriefMetrics` (44–58, pure, call verbatim), `buildBriefPrompt` (60–126, re-point at curated set), `buildBriefRecSignal` (179–185, reads `summary.topRecommendationId` READ-ONLY — the *inverse* of the curated set), `buildPromptHash` (139–175), the `meeting-brief` named-op + Zod-retry skeleton (225–263).
- `server/meeting-brief-store.ts` — `createStmtCache` + `rowToX` + `parseJsonSafe` + ON CONFLICT upsert pattern (template for new POV store).
- `server/ai-operation-registry.ts` — `'meeting-brief'` contract (366–384, clone for `'strategy-pov'`).
- `server/routes/meeting-brief.ts` — `BRIEF_UNCHANGED→200` catch (clone for POV `/generate`).
- `src/hooks/admin/useAdminMeetingBrief.ts` + `shared/types/meeting-brief.ts` — read-only POV shape model.

### Deliverable / loop substrate (template + already-wired reuse)
- `server/domains/inbox/deliverable-adapters/cannibalization.ts` + `types.ts` (`getAdapter`/`registerAdapter`, `applyDisabledStub`) — exact 1:1 template for the rec→deliverable adapter (respond-only).
- `server/domains/inbox/deliverable-adapters/content-request.ts` + `server/content-requests.ts` (`createContentRequest`, `source:'strategy'|'client'`, dedupe) — **`content_request` is ALREADY a registered DeliverableType auto-projected into both client + admin lists.** Client "Act on this" = `createContentRequest(initialStatus:'requested', briefId=null)`. Substrate exists — net-new is only 2 linkage columns + the public route.
- `server/domains/inbox/client-action-dual-write.ts` (`mirrorClientActionToDeliverable`, 49–119) — exact template for `mirrorRecommendationToDeliverable`.
- `server/domains/inbox/unified-inbox-read.ts` (147–184) + `server/routes/deliverables.ts` `/respond` (210–242) + `respondToDeliverable` — respond spine, plugs in unchanged.
- `server/outcome-tracking.ts` — `recordAction` (317), `getActionBySource` (idempotent) — greenlight→attribution join (the PATCH `:recId` completion route at 259–280 is the template; `/fix` route ~703 BYPASSES it — gap).
- `server/intelligence/client-signals-slice.ts` — `recResponses` (549–589, ADMIN-only slice) → admin loop strip reads it via `buildWorkspaceIntelligence`; client footer needs a net-new client-safe projection.

### Admin cockpit FE (reuse as substrate)
- `src/components/KeywordStrategy.tsx` (676 lines) — already a flag-branched assembler (`commandCenterEnabled && childFlag` pattern at 119/127/131). Add a **third composed branch** `theIssueEnabled = commandCenterEnabled && useFeatureFlag('strategy-the-issue')`. **Single integrator owner.** No new route (`seo-strategy` Page already mounts it at `App.tsx:426`; `navRegistry.tsx` entry exists).
- `src/components/strategy/` — `OrientZone`, `StrategyDiff`, `NeedsAttentionStrip`, `StrategyCockpit` (+ `CockpitRow`, `cockpitRowModel.ts`, `CurationBulkActionBar`), `WhyHowResult`, `CannibalizationTriage` (`keeperPathOf` = default), `StrategyConfigPanel`, rankings/competitive/keyword/content interior surfaces — all reuse verbatim/as substrate.
- Hooks: `useAdminRecommendations` (`useAdminRecommendationSet`), `useRecommendationLifecycle`, `useCurationSelection`, `useRecBulkMutation` — reuse verbatim.
- `src/lib/recCategoryMap.ts` (`REC_TYPE_ACT_CATEGORY`) + `src/lib/recTypeTab.ts` (`REC_TYPE_ADMIN_TAB`, `buildRecFixContext`) — exhaustive-Record template + deep-link routing.

### Client V2 FE (reuse — re-home + reskin)
- `src/components/client/ROIDashboard.tsx` + `useClientROI` — fully built, evergreen-safe, **orphaned**; re-home as "what your SEO is worth" (cleanest pure win).
- `src/components/client/strategy/StrategyClientOrientHeader.tsx` (corrected subdir path) — ring + `verdict()` narrative; **must strip "vs last refresh" deltas** (evergreen violation).
- `src/components/client/OverviewTab.tsx` — action banner, stat strip, #1-priority contribution bars (feed from curated rec). Branches on `client-briefing-v2` today — add the Issue branch parallel to it.
- `src/components/client/Briefing/ActionQueueStrip.tsx` + `WinsSurface.tsx` + `src/components/client/strategy/StrategyRequestedKeywordTrendSection.tsx` + `CompetitorGapsSection.tsx` + `ClientChatWidget.tsx` + `StrategyBusinessPrioritiesSection.tsx` — reuse as section bodies.
- `src/components/shared/ContentGapRow.tsx` — audience union `'admin'|'strategy-tab'|'briefing'` (verified); extend with `'issue'`.
- `src/hooks/useRecommendations.ts` (`useRecommendationSet`) + `useStrategyKeywordFeedback` — client read + Relevant/Not-relevant feedback.

### Cross-cutting infra
- `src/tokens.css` (all `--*`), `src/index.css` `.t-*` (14 utilities), `src/components/ui/` primitives, `useFeatureFlag`/`FeatureFlag`, `server/briefing-cron.ts` (clone for Phase 3 weekly tick — `currentWeekOfUTC`/mutex/`lastBriefingRunWeekOf` idempotency all verified), `scripts/pr-check.ts` CHECKS (hedge-words rule = template), `tests/contract/` + `tests/fixtures/strategy-seed.ts`.

---

## 3. Net-new work (sorted by dependency)

| # | Item | Where it lives | Lift | Depends-on |
|---|------|----------------|------|-----------|
| **P0-a** | `strategy-the-issue` flag (3 edits: FEATURE_FLAGS + CATALOG + GROUPS or import throws) | `shared/types/feature-flags.ts` | S | — (first commit) |
| **P0-b** | Archetype map: exhaustive `Record<RecType,Archetype>` (15) + `Archetype` union (6 buckets) + `ARCHETYPE_ORDER`/`LABELS` + create/refresh/defend headline-verb map; `satisfies` | `shared/types/strategy-archetype.ts` (shared) + consumed via `src/lib/recArchetypeMap.ts` | S | `RecType` (frozen) |
| **P0-c** | `isCuratedForClient(rec)` predicate (`clientStatus∈{sent,approved,discussing}`) | `server/recommendations.ts` (co-locate w/ `isActiveRec`) | S | — |
| **P0-d** | `DELIVERABLE_TYPES` += `'recommendation'` (+ payload Zod enum) | `shared/types/client-deliverable.ts` | S | — |
| **P0-e** | Migration 140 + `recommendationId`+`strategyCardContext` on `content_topic_requests` (row iface, `rowToRequest`, insert stmt, `createContentRequest` sig, `ContentTopicRequest` type — lockstep) | `server/db/migrations/140-content-request-rec-linkage.sql` + `server/content-requests.ts` + `shared/types/content.ts` | S | — |
| **P0-f** | `WS_EVENTS.STRATEGY_POV_GENERATED` (+ confirm `RECOMMENDATIONS_UPDATED`/`DELIVERABLE_SENT` reuse) | `server/ws-events.ts` | S | — |
| **P0-g** | `'strategy-pov'` AI operation contract (clone `meeting-brief`) | `server/ai-operation-registry.ts` | S | — |
| **P0-h** | `StrategyPov` shared type (resolved override∪draft) + `StrategyPovAIOutput` | `shared/types/strategy-pov.ts` | S | — |
| **P0-i** | `queryKeys.admin.strategyPov` + `queryKeys.client.theIssue`/`.recResponses` | `src/lib/queryKeys.ts` | S | — |
| **P0-j** | `ContentGapAudience` += `'issue'` (+ CHROME entry, no `$`) | `src/components/shared/ContentGapRow.tsx` | S | — |
| **P0-k** | `STRATEGY_ISSUE_PUSH` background-job type (+ metadata, mapped-type lockstep) — *pre-commit if cron lane needs constant early, else Phase 3* | `shared/types/background-jobs.ts` | S | — |
| P1-1 | `recArchetypeMap.ts` consumer + `recStance.ts` stance derivation (create/refresh/defend + cut/parked counts) | `src/lib/recArchetypeMap.ts`, `src/lib/recStance.ts` | S | P0-b |
| P1-2 | `StanceBar.tsx` (proportional segmented allocation bar) | `src/components/strategy/issue/StanceBar.tsx` | S | P1-1 |
| P1-3 | Keeper-override store + PATCH endpoint (keyed by `cannibalizationUrlSetKey`, survives regen clobber) + broadcast + activity | new migration + `server/cannibalization-keeper-override.ts` + route block in `routes/recommendations.ts` | M | P0 broadcast |
| P1-4 | `CannibalizationKeeperSelector` + `useKeeperOverride` | `src/components/strategy/CannibalizationTriage.tsx` (extend) or `issue/KeeperSelector.tsx` + `src/hooks/admin/useKeeperOverride.ts` | M | P1-3 |
| P1-5 | strategy-POV generator (re-point `buildBriefPrompt` at curated set; 2 prompt variants admin/client) | `server/strategy-pov-generator.ts` | M | P0-c,g,h + store |
| P1-6 | strategy-POV store + migration + Zod columns (versioned editable override) | `server/strategy-pov-store.ts` + `server/db/migrations/14X-strategy-pov.sql` + `server/schemas/strategy-pov-schemas.ts` | M | P0-h |
| P1-7 | strategy-POV routes (GET resolved / POST `/generate` UNCHANGED-200 / PATCH bump-version / POST `/regenerate`) | `server/routes/strategy-pov.ts` | M | P1-5,6 |
| P1-8 | `useStrategyPov` (get/save/regenerate) | `src/hooks/admin/useStrategyPov.ts` | S | P1-7 |
| P1-9 | `BackingMovesQueue` (extend `StrategyCockpit` w/ additive `groupBy`/`shortlistCap` props, byte-identical flag-OFF) | `src/components/strategy/issue/BackingMovesQueue.tsx` + `StrategyCockpit.tsx` | M | P1-1 |
| P1-10 | `DraftedPovEditor` (editable prose; cut→sentence removal) | `src/components/strategy/issue/DraftedPovEditor.tsx` | L | P1-8 + cut→sentence contract |
| P1-11 | `IssueHeader` + Preview-as-client `Toggle` | `src/components/strategy/issue/IssueHeader.tsx` | S | — |
| P1-12 | Orchestrator third branch (integration) | `src/components/KeywordStrategy.tsx` | S | all P1 |
| P2-1 | rec→deliverable adapter (respond-only, `applyDisabledStub`, `sourceRef=recommendation:<id>`) | `server/domains/inbox/deliverable-adapters/recommendation.ts` + barrel append + `DELIVERABLE_TYPE_BADGES` | M | P0-d |
| P2-2 | `mirrorRecommendationToDeliverable` + wire into BOTH `/send` per-row AND `/bulk` (closes half-loop #1) | `server/domains/inbox/recommendation-dual-write.ts` + `routes/recommendations.ts` (2 sites) | M | P2-1 |
| P2-3 | Client act-on route `POST /api/public/recommendations/:ws/:recId/act-on` (sets `clientStatus=approved`, creates content-request w/ lineage, NEVER fixContext) + `approveRecommendation()` single-writer (closes half-loop #2) | `routes/recommendations.ts` + `recommendation-lifecycle.ts` | M | P0-e + CLIENT_REC_TRANSITIONS |
| P2-4 | Greenlight→TrackedAction attribution + carry `recommendationId` onto brief + add `recordAction` to `/fix` route | `server/outcome-tracking.ts` + `routes/content-briefs.ts` + `routes/recommendations.ts` `/fix` ~703 | M | P0-e |
| P2-5 | Client-safe projection: add `clientStatus` (restricted union) + `delivered` to `stripEmvFromPublicRecs` allow-list + `?clientStatus=sent` GET filter | `routes/recommendations.ts` | S | — |
| P2-6 | Client-safe `recResponses` projection (for loop footer) | `routes/recommendations.ts` (client-safe summary) | M | P2-5 |
| P2-7 | `useActOnRecommendation` client hook | `src/hooks/client/useActOnRecommendation.ts` | M | P2-3 |
| P2-8 | `TheIssueClientPage` composer + `OverviewTab` flag-branch | `src/components/client/the-issue/TheIssueClientPage.tsx` + `OverviewTab.tsx` | L | P2-5,6,7 |
| P2-9 | `NarratedStatusHeadline` (client POV prose; degrades to `verdict()`) | `.../the-issue/NarratedStatusHeadline.tsx` | M | client POV field |
| P2-10 | `IssueContentPlanSection` + `IssueContentCard`/`ValueCard` (D1 content floor; Act-on=request, never "open brief"; strip pricing) | `.../the-issue/IssueContentPlanSection.tsx` + `IssueContentCard.tsx` (body via ContentGapRow `'issue'`) | L | P0-j + P2-7 |
| P2-11 | `IssueAlsoOnPlanSection` (client archetype grouping, no jargon) | `.../the-issue/IssueAlsoOnPlanSection.tsx` | M | client archetype map |
| P2-12 | `IssueLoopFooter` + `useClientRecResponses` + `IssueWorkInFlight` | `.../the-issue/IssueLoopFooter.tsx` + `src/hooks/client/useClientRecResponses.ts` + `IssueWorkInFlight.tsx` | M/S | P2-6 |
| P2-13 | `evergreenCopy.ts` helper + section-title constants | `.../the-issue/evergreenCopy.ts` | S | — |
| P3-1 | Weekly-Issue cron (clone `briefing-cron.ts`; gate on flag; swap pipeline for POV recompute + doorbell) | `server/strategy-issue-cron.ts` (clone) | M | P0-k + P1 POV |

---

## 4. Phase 0 — shared contracts to pre-commit (sequential, single owner, BEFORE any parallel lane)

> **This is the key to safe parallelization.** Every item below is touched by ≥2 lanes. Commit them in ONE Phase-0 batch (per CLAUDE.md "pre-commit shared contracts before dispatch"). Nothing flag-gated starts until this merges + green. `npm run verify:feature-flags` must pass.

1. **Flag** — `'strategy-the-issue': false` in `shared/types/feature-flags.ts` across all THREE locations (FEATURE_FLAGS + FEATURE_FLAG_CATALOG group `'Strategy'` + FEATURE_FLAG_GROUPS) — `assertFeatureFlagGroupingConsistency()` throws at import otherwise. *(P0-a)*
2. **Archetype contract** — `shared/types/strategy-archetype.ts`: `Archetype` 6-bucket union + `satisfies Record<RecType,Archetype>` over **15** RecTypes + `ARCHETYPE_ORDER`/`LABELS` + headline-verb map. Owner locks exact bucket labels + per-RecType assignment. Both admin (P1) + client (P2) import. *(P0-b)*
3. **`isCuratedForClient(rec)`** in `server/recommendations.ts` — the single curated-set predicate; POV lane AND loop/client-feed lane both consume it. *(P0-c)*
4. **`DELIVERABLE_TYPES` += `'recommendation'`** (+ payload Zod enum) in `shared/types/client-deliverable.ts` — adapter, badge map, every-active-type-has-adapter pr-check, and list-response Zod all key off it. *(P0-d)*
5. **Migration 140 + content-request rec-linkage** — `recommendationId?`+`strategyCardContext?` on `content_topic_requests` + `ContentTopicRequest` type + `createContentRequest` signature (DB column+mapper lockstep, one commit). *(P0-e)*
6. **`StrategyPov` shared type** (`shared/types/strategy-pov.ts`) — resolved override∪draft shape (JSDoc the authority-layered resolution) + `StrategyPovAIOutput`. *(P0-h)*
7. **`'strategy-pov'` AI operation** in `server/ai-operation-registry.ts` (`outputMode:'json'`, `researchMode:'forbidden'`, `executionMode:'sync-only'`). *(P0-g)*
8. **WS events** in `server/ws-events.ts` — `STRATEGY_POV_GENERATED`; confirm `RECOMMENDATIONS_UPDATED`/`DELIVERABLE_SENT` reuse. *(P0-f)*
9. **`ContentGapAudience` += `'issue'`** (+ CHROME entry, no `$`/pricing) in `src/components/shared/ContentGapRow.tsx`. *(P0-j)*
10. **Query keys** — `queryKeys.admin.strategyPov`, `queryKeys.client.theIssue`/`.recResponses` in `src/lib/queryKeys.ts`. *(P0-i)*
11. **Client-safe rec projection contract** — pin the field set (`insight`, `estimatedGain`/`topOpportunityRationale`, `opportunity.components` for #1-why bars, `recType`, `targetKeyword`, `strategyCardContext`, restricted `clientStatus`, `delivered`) as a shared type before any client lane forks.
12. **Cut→POV-sentence-removal contract** — POV sentences carry originating rec id; queue `onCut` and editor reconcile must agree.
13. **Keeper-override key contract** — keyed on `cannibalizationUrlSetKey` (order-independent slug set), NOT keyword, so it survives regen.
14. **`previewMode` prop contract** on the V2 client surface — admin Preview-as-client mounts it read-only; agree prop name + semantics cross-lane.
15. **`STRATEGY_ISSUE_PUSH` job type** (`shared/types/background-jobs.ts`) — pre-commit only if Phase 2 needs the constant; else defer to Phase 3 (mapped-type forces metadata lockstep). *(P0-k)*

---

## 5. Parallelization strategy (velocity-explicit)

### Phase 0 (sequential, 1 owner) → blocks everything. Ships the §4 contract batch.

### Phase 1 — Admin Issue cockpit (5 concurrent lanes after P0)
| Lane | Exclusive files | Ships |
|------|-----------------|-------|
| **1A** | `src/lib/recArchetypeMap.ts`, `src/lib/recStance.ts`, `src/components/strategy/issue/StanceBar.tsx` | stance glance |
| **1B (BE-POV)** | `server/strategy-pov-generator.ts`, `server/strategy-pov-store.ts`, `server/routes/strategy-pov.ts`, `server/schemas/strategy-pov-schemas.ts`, `server/db/migrations/14X-strategy-pov.sql` | POV engine (independently testable behind stub GET) |
| **1C** | `src/components/strategy/issue/DraftedPovEditor.tsx`, `src/hooks/admin/useStrategyPov.ts` | editable POV (builds against type; integ-tests after 1B) |
| **1D** | `src/components/strategy/issue/BackingMovesQueue.tsx` + `StrategyCockpit.tsx` (additive props only) | archetype queue |
| **1E** | `server/cannibalization-keeper-override.ts` + new migration + route block + `src/hooks/admin/useKeeperOverride.ts` + `CannibalizationTriage.tsx`/`issue/KeeperSelector.tsx` | keeper override |

**Sequential within P1:** `schemas/type → store+migration → generator → route` (1B internal). **Integration owner** (single) wires the third orchestrator branch in `KeywordStrategy.tsx` + `IssueHeader.tsx` AFTER 1A–1E land — **never parallelize the orchestrator edit.**

### Phase 2 — Close the loop + client surface (one PR; tracks inside)
**Sequential prerequisite:** Track A (migration 140 columns + `createContentRequest` ext) lands first. Then **A → (B ‖ C ‖ D ‖ E)**:
| Track | Exclusive files |
|-------|-----------------|
| **A** | `migrations/140-*.sql`, `server/content-requests.ts`, `shared/types/content.ts` |
| **B** | `server/domains/inbox/deliverable-adapters/recommendation.ts` + barrel line (append-only) |
| **C (hotspot)** | `server/domains/inbox/recommendation-dual-write.ts` + **`server/routes/recommendations.ts` EXCLUSIVE** (send mirror ×2, `/fix` recordAction, client act-on route, allow-list, `?clientStatus=sent` filter) |
| **D** | `server/outcome-tracking.ts` join + `routes/content-briefs.ts` recId carry |
| **E (client)** | `src/components/client/the-issue/*` + `src/hooks/client/useActOnRecommendation.ts`, `useClientRecResponses.ts` + `OverviewTab.tsx` flag-branch (composer owner only) |

`server/routes/recommendations.ts` is a **single-owner hotspot** across both phases — Track C (P2) and the loop lane own it exclusively; no other track touches it.

### Phase 3 (cron) → after P2 green on staging. Single lane: `server/strategy-issue-cron.ts`.
### Phases 4–6 (trust ladder / four-jobs lenses / competitor full page) + follow-up (operator steering) → out of this audit's verified depth; each is its own phase-per-PR.

**Hard rules:** parallel subagents in this shared checkout run **no git writes** (controller commits per-lane); diff-review + full `vitest` + `pr-check` after each batch; **never two full `vitest` concurrently** (deterministic-port EADDRINUSE); phase N+1 not started until N merged + green on staging.

---

## 6. Model assignments

| Task type | Model | Why |
|-----------|-------|-----|
| Phase 0 contracts (flag, types, migrations, op-registry, maps) | **Sonnet** | Mechanical but lockstep-sensitive; one wrong field name silently breaks `safeParse` — needs care, not deep judgment |
| Pure FE maps/derivations (`recArchetypeMap`, `recStance`, `evergreenCopy`) | **Haiku** | Deterministic, template-mirrored (`recCategoryMap`), exhaustiveness compile-guarded |
| Net-new components against pinned types (StanceBar, ValueCard, IssueHeader, sections) | **Sonnet** | Local judgment on styleguide/tokens + interaction, bounded scope |
| POV engine, rec→deliverable adapter, send-mirror, attribution join | **Sonnet** | Implementation w/ local judgment; clones existing patterns but cross-module wiring |
| `DraftedPovEditor` (cut→sentence linkage) + `TheIssueClientPage` composer | **Opus** | LARGE, cross-lane contracts, the signature interaction + editorial composition |
| Orchestrator integration (`KeywordStrategy.tsx` third branch) | **Opus** | Hot shared file; byte-identical flag-OFF invariant; Rules-of-Hooks |
| Loop-closure lane (`routes/recommendations.ts` hotspot, both half-loops) | **Opus** | Highest correctness risk; fixture-masked dead-spine failure mode |
| pr-check rules + contract tests | **Sonnet** | Pattern-clone (hedge-words) + customCheck closures |
| Post-batch holistic + scaled review | **Opus** | Cross-module, fixture-masked-bug detection (per `feedback_holistic_review`) |

---

## 7. UI/UX grounding

**Build on:** `src/tokens.css` (consume `--*` directly; surface-3 for panels inside surface-2 SectionCards; hover steps one tier `--brand-text`→`--brand-text-bright`, `--brand-border`→`--brand-border-hover`; `--radius-signature`; `--z-*` scale). `.t-*` utilities only (never `text-[Npx]`; `text-[11px]`→`t-caption-sm` NOT `t-micro`; `t-caption-sm` has no color — add `--brand-text-muted`; `t-micro` = admin timestamps only). Primitives: `PageHeader`, `CompactStatBar`, `TabBar`, `Badge` (no purple), `Toggle`, `TrendBadge`, `MetricRing`, `SectionCard` (mind the `p-4` double-wrap + `space-y-N`-doesn't-reach-children pitfall), `EmptyState`/`ErrorState`/`Skeleton`, `ClickableRow`. **No `TierGate` anywhere in these surfaces** (locked no-pricing). **No new tokens needed.**

**NEW components justified over primitives** (each is an interaction no primitive delivers; all token/`.t-*`-compliant):
- **StanceBar** — proportional segmented bar w/ per-segment accent fills; not labeled stat columns (`CompactStatBar` can't).
- **DraftedPovEditor** — inline-editable prose with backing-sentence→rec-id linkage; no editable-prose primitive exists.
- **CannibalizationKeeperSelector / KeeperSelector** — radio/segmented page-keeper picker carrying page metadata + fix-propagation.
- **ValueCard / IssueContentCard + ValueCardGrid** — varied editorial card rhythm with one decision + "full story" disclosure (the explicit §5 anti-monotony mandate); stretching `SectionCard`+`DataList` fails it.
- **ROITileStrip** — narrative result tiles (claim + trend + evidence), not bare label/value.
- **YourTurnQueue** — pending-decisions entry strip (may reuse `ActionQueueStrip` internals).
- **NarratedStatusHeadline** — evergreen POV prose + compact health/trend, degrades to `verdict()`.

Keep `StatCard`/`MetricRing`/`ChartCard`/`SectionCard`/`EmptyState` for supporting data surfaces (proof band, stats bar, trend, ROI). Client shell wraps in `.client-typography`. **Client-side: never purple, evergreen copy, teal=action, blue=data, emerald=wins.**

---

## 8. Prevention — new pr-check rules + tests

**pr-check rules** (owned by the infra lane; one CHECKS array, one `rules:generate` regen — single owner takes specs from other lanes):
1. **Evergreen-copy temporal-phrase guard** — clone hedge-words rule; `pathFilter: src/components/client/the-issue/` + `src/components/client/strategy/`; bans `since last week|this week|last week|vs last refresh|vs last period|N days ago|yesterday|issue #|week of`; hatch `// temporal-ok`. **Highest-value rule** (reused components carry time-relative copy — silent regression on copy-paste).
2. **Pricing/cart-in-client-issue guard** — fail if the-issue dir imports `useCart`/`fmtPrice`/`briefPrice` or renders `ShoppingCart`/"Get Brief"/"Full Post"/"open brief".
3. **`request-not-generate`** — client Act-on path must not call brief/post generators (`generateBrief`/`startContentBrief`/`prepare*Context`/`callAI`).
4. **`rec-send-must-mirror-to-deliverable`** — `sendRecommendation` in a route handler must be accompanied by `mirrorRecommendationToDeliverable` (hatch `// rec-mirror-ok`).
5. **`client-act-on-must-not-fire-fixContext`** — public act-on region must not reference `fixContext`/`buildRecFixContext`.
6. **`rec-deliverable-apply-disabled`** — recommendation adapter must omit `applyDeliverable`/set `appliesOnApprove` falsy.
7. **Archetype-map exhaustiveness customCheck** — parse `RecType` union, assert every member is a key (defense beyond `satisfies`).
8. Extend **every-active-type-has-an-adapter** to cover `'recommendation'`.

**Tests:**
- Contract: `strategy-archetype-exhaustiveness.test.ts` (15 RecTypes → bucket).
- Contract: every `recResponses` value (`approved`/`declined`/`discussing`) has a writing route (catches today's dead half-loop).
- Contract: extend `tab-deep-link-wiring.test.ts` for Issue interior deep-links (admin cockpit + client sections).
- Integration (PUBLIC read path): `GET /api/public/recommendations?clientStatus=sent` returns only sent recs + client-safe fields; **no admin axis leaks** (`lifecycle`/`struckAt`/`cascade`/`sendChannel`).
- Integration: client act-on → content_topic_requests row w/ `recommendationId`+`strategyCardContext`, `clientStatus=approved`, **no brief/post generated** (`briefId` null), projects into both client + admin lists.
- Integration: rec `/send` (per-row AND bulk) → `client_deliverable type='recommendation' status='awaiting_client'` minted, `DELIVERABLE_SENT` fired.
- Contract: `/apply` against rec-derived deliverable returns 400 (respond-only).
- Attribution: greenlight→delivered creates exactly one `TrackedAction` (idempotent); silent `/fix` route also creates one (§7 C5).
- Cache-completeness (unit): `buildStrategyPovHash` busts on every signal (curated id-set, `clientStatus`, `lifecycle`, prose-edit hash, regenerate nonce).
- Authority-resolution: GET strategy-pov returns edited override per-field, falls back to draft.
- Keeper-override survives a `generateRecommendations` regen cycle (delete-reinsert clobber).
- Byte-identical guard: snapshot with `strategy-the-issue` OFF = unchanged command-center Overview (mirror commit `a6ca7b5ae`).
- Real loading→loaded transition tests on both surfaces (Rules-of-Hooks; flag read unconditional before early returns).
- DB column+mapper lockstep contract for `strategy_pov` and content-request linkage.
- `verify:feature-flags` + `verify:coverage-ratchet` must pass; real-browser DOM probe for the design-system batch.

---

## 9. Open verification gaps (the plan MUST resolve)

1. **`RecType` count conflict — RESOLVED to 15 by direct read.** Lanes A/cross-cutting said "16 incl competitor"; the union has exactly **15** (competitor included). All archetype/stance maps + exhaustiveness tests must use **15**. *(Verified `shared/types/recommendations.ts:6`.)*
2. **POV persistence location** — lanes recommend a NEW `strategy_pov` sibling table/store (NOT extending `meeting_briefs`: inverse rec set, versioned override vs byte-identical regen). Plan must ratify (resolves spec §14.1 Q1) and assign the migration number (1B's strategy-pov migration is sequential after 140 — confirm exact number at write time; current max is 139).
3. **`normalizeRecommendation` — defer or build?** Confirmed absent. Per owner scope (client FEED, not Inbox Decisions), the feed reads the public rec projection + content-request projections that already work — so `normalizeRecommendation` may be **droppable** (removes a MEDIUM). Plan must explicitly decide whether recs surface in the unified Inbox Decisions section.
4. **Client-facing POV prose field** — which client read carries it (`ClientKeywordStrategy.strategyUx` vs rec-set summary)? Pin name + nullable contract; `NarratedStatusHeadline` degrades to `verdict()` if absent. Cross-lane (BE produces, FE consumes).
5. **Client-safe `recResponses` projection shape** — `IssueLoopFooter` is blocked on it (`ClientSignalsSlice.recResponses` is server-only). Pin field name + shape in P0/P2-5.
6. **Act-on endpoint canonical name** — `state-machines.ts` comment references a non-existent `POST .../:recId/respond`; lanes propose `/act-on`. Decide and **fix the stale comment in the same commit**.
7. **`StrategyCardContext` source for client act-on** — type confirmed at `shared/types/content.ts:604`; confirm which fields the client write populates (targetKeyword, rationale=insight, intent, priority).
8. **Weekly-tick value source (Phase 3)** — no meeting-date data exists; "Issue #N · week of" keys off `currentWeekOfUTC()`. Issue#/date are **admin-only** (evergreen guard). Phase 1 may stamp a client-side week-of for the admin header.
9. **`client-briefing-v2` vs `strategy-the-issue` precedence** in `OverviewTab` — mutually-exclusive composers. Lanes recommend strategy-the-issue wins when both ON; plan must lock branch precedence.
10. **NOT independently verified (flag for cross-lane sync at integration):** the cut→POV-sentence reconcile mechanism end-to-end, and the `previewMode` client-surface contract — both are pinned contracts the components build against but no single lane owns end-to-end.
