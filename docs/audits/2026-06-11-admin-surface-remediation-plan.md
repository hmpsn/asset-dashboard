# Admin Surface Audit — Phased Remediation Plan

> **Source:** [2026-06-11-admin-surface-audit.md](./2026-06-11-admin-surface-audit.md) (18-agent audit, 187 claims verified: 164 confirmed / 23 adjusted / 0 refuted).
> **Roadmap:** sprints `sprint-admin-surfaces-w1…w6-2026-06-11` + `sprint-admin-surfaces-polish-2026-06-11` in `data/roadmap.json`.
> **This doc is the wave/PR map, not the implementation plan.** Per `docs/PLAN_WRITING_GUIDE.md`, the full contract+test plan for each wave is written at execution time (with `pre-plan-audit` where the wave touches many files). This doc locks: PR slicing, file ownership, dependency graph, parallelization lanes, model ladder, and verification gates.

---

## Execution model

- **One PR per lane item, staging-first.** Phase-per-PR rule applies; no wave-N+1 PR opens while a same-lane wave-N PR is unmerged.
- **Lanes within a wave are parallel** — exclusive file ownership per lane (declared below). Lanes never share files; shared-file work (e.g. `src/lib/wsInvalidation.ts`, nav registry) is its own sequential PR.
- **Platform:** Claude/Anthropic ladder. Mechanical sweeps → Haiku; pattern-following fixes → Sonnet; cross-context/shared-contract work and all reviewers → Opus.
- **Every PR:** typecheck + build + full vitest + pr-check + the wave's verification gate below; bugs found in review get fixed in-PR (CLAUDE.md decision framework).

---

## Wave 1 — Stop the Silent Failures (6 parallel lanes, all S)

Theme: every fetch/mutation failure currently rendering as success or empty state. Same fix shape: remove `.catch(() => null)`-style swallows, branch on `isError`, render `ErrorState` with a retry that retries *the failed thing*.

| Lane | PR scope | Owns (exclusive) | Model |
|------|----------|------------------|-------|
| 1.1 Strategy | Remove `useKeywordStrategy` `.catch(() => null)` + `isError` ErrorState; decouple "Add to Strategy" errors from the generation ErrorState (whose Try Again burns credits); stop `trackKeyword` swallowing all failures as duplicates | `src/hooks/admin/useKeywordStrategy.ts`, `src/components/KeywordStrategy.tsx` | Sonnet |
| 1.2 Local SEO | `ErrorState` branch before the panel's `null` return (fixes 3 mounts at once); drawer edit-wipe guard on WS refetch; surface drawer save/validation errors in-view | `src/components/local-seo/*` | Sonnet |
| 1.3 Content editor | Rethrow in `saveField` + `'error'` SaveStatus (kills "Saved" after failed save); un-swallow ContentManager/PostEditor mutation errors; failure-aware empty states in ContentManager/ContentCalendar | `src/components/ContentManager.tsx`, `src/components/ContentCalendar.tsx`, post-editor save path | Sonnet |
| 1.4 KCC realtime | Copy Hub's `wsHandlers` block into `KeywordCommandCenter.tsx` (production surface currently has zero WS wiring) | `src/components/KeywordCommandCenter.tsx` | Haiku |
| 1.5 Schema | Un-silence send-to-client / save-as-template / page-type / rollback failures; stop a single-page generation failure replacing the whole results view | `src/components/SchemaSuggester.tsx`, `src/components/schema/*` (UI error paths only) | Sonnet |
| 1.6 Admin shell | Palette "Run Audit" actually runs an audit (or is relabeled honestly); `pendingContentRequests` badge onto React Query + WS invalidation; one badge count → one destination | `src/components/CommandPalette.tsx`, `src/App.tsx` badge path | Sonnet |

**Verification gate:** for each lane, a component/integration test asserting the error path renders an error affordance (FM-2 pattern: mock failure → assert failure surfaced, not success).

## Wave 2 — Data Integrity & Protection (5 parallel lanes, S–M)

| Lane | PR scope | Owns (exclusive) | Model |
|------|----------|------------------|-------|
| 2.1 Strategy data loss | Thread `assembled.siteKeywordMetrics` into `buildKeywordStrategyUxPayload` (volume/difficulty evidence silently lost today); add `broadcastToWorkspace` + `addActivity` to `POST /api/seo/competitors`; fix entity-resolution slice's dead `ws.keywordStrategy.pageMap` read | `server/keyword-strategy-ux.ts`, `server/routes/seo*` (competitors), `server/intelligence/entity-resolution*` | Sonnet |
| 2.2 Hub protection holes | Resolve `findTracked` from `listTrackedKeywordRows` so `stripUndefinedKeys` can't delete `sourceGapKey`/`strategyOwned` (server returns 409, + integration test); gate the Hub drawer's one-click force-bypass behind the existing ConfirmDialog pattern | `server/tracked-keywords-store.ts`, `server/keyword-command-center.ts`, `src/components/keyword-hub/*` drawer path | Sonnet |
| 2.3 Schema persistence | Persist single-page generation/regeneration to the snapshot + broadcast; seed `published` Set from `page.lastPublishedAt`; guard stale manual JSON edits from silently overriding regenerated schema | `server/schema-store.ts`, `server/routes/webflow-schema.ts`, `src/components/schema/useSchemaSuggester*` | Opus (cross-layer contract) |
| 2.4 Local SEO storage | Replace both `LIMIT 500` callers with the `GROUP BY MAX(captured_at)` query; stream the backfill job instead of loading every snapshot row; snapshot retention policy (owner decision D4 sets the values); make "Remove" semantics honest (remove vs deactivate) | `server/local-seo.ts`, `server/local-seo-location-backfill-queue.ts`, drawer remove path | Sonnet |
| 2.5 Content wiring | Stop the brief job dispatcher dropping `fixContext` `targetPageId`/`targetPageSlug`; dedupe repeated brief "Send to Client"; stop `regenerateBrief` accumulating orphaned siblings | `server/content-brief-generation-job.ts`, `server/content-brief.ts`, `server/routes/content-briefs.ts` | Sonnet |

**Verification gate:** integration tests on the actual read path for every persistence fix (not the admin GET only); 409 test for 2.2.

## Wave 3 — Unlocks & Broken Handoffs (after W1+W2 merge; 3.2 depends on 2.3)

| Lane | PR scope | Depends on | Model |
|------|----------|------------|-------|
| 3.1 AI Suggested → Brief | Wire the suggestion's keyword through the existing `fixContext` prefill path; add the missing `refresh_suggestion` action button | W2.5 | Sonnet |
| 3.2 CMS publish unlock | Add `cmsDeliveryStatus` to the frontend type; show Publish for `'ready'` CMS items; route retract/rollback through CMS delivery mode | **W2.3** | Opus |
| 3.3 Deep-link repair batch | Page Intelligence → Schema (`pageSlug`→`pageId`); WorkspaceHome's three broken senders (incl. `?tab=` on client-requests CTA); Strategy KeywordGaps → Hub links (mirror the shipped site-keywords pattern); RepeatCompetitorList inert keywords → one-click Track via `useRankTrackingAddKeyword`; Content Decay → refresh-brief/review-page handoffs | W1 | Sonnet; **`?tab=` two-halves contract test per link** |
| 3.4 Nav registry (sequential, shared files) | Single nav metadata registry consumed by Sidebar + CommandPalette + Breadcrumbs; remove `needsSite` from `requests`; **pr-check rule: nav entries must come from the registry** | after 3.3 | Opus |
| 3.5 Journey visibility | Resolve TaskPanel-vs-NotificationBell (delete dead TaskPanel, fix `CLAUDE.md:274`, verify bell delivers cross-tab job visibility); live progress + cancel on audit run; onboarding "Link Webflow site" dead-end gets a real path | W1.6 | Sonnet |

## Wave 4 — Keyword Hub Cutover (existing roadmap item; phased, sequential)

Extends `simp-feature-keyword-hub-kcc-rank-consolidation` + `keyword-surface-dedup-audit` (already pending). Audit adds one **hard precondition** and a flag-ON blocker list:

1. **Port `LocalSeoVisibilityPanel mode='keywords'` + market-setup drawer entry into the Hub** — KCC is currently their only keyword-mode mount; flipping today silently drops both.
2. Clear flag-ON blockers: pin/unpin unreachable, Hub drops GSC variants KCC renders, filter-change pagination/selection reset, dead "View in Hub"/"View replaced-by" buttons, redirect dropping `location.search`.
3. Flip `keyword-hub`; retire `KeywordCommandCenter.tsx`, `RankTracker.tsx`, `seo-ranks` per `docs/rules/route-removal-checklist.md` (fold `RankHistoryChart` into the Hub drawer first).

Run `pre-plan-audit` before this wave's plan — it's a migration.

## Wave 5 — Close the Loop (read-side; parallel lanes)

The platform already *writes* all of this; nothing reads it back.

- **5.1 Outcome chips:** join `tracked_actions`/`outcome_actions` into Strategy pageMap/Quick-Win rows, Hub drawer (baseline→current + verdict), and Briefs/Posts lists (90-day clicks/position delta). `OUTCOME_SCORED` invalidation is already mapped.
- **5.2 Persisted AI review read-back:** seed ReviewChecklist from stored `post.aiReview` (saves a redundant AI call per session).
- **5.3 Local visibility insights bridge:** diff snapshots at the end of `runLocalSeoRefreshJob`, mint insights for visibility transitions (follow `docs/rules/bridge-authoring.md`); visibility trend read from the existing time series.

## Wave 6 — Quality & De-bias (parallel lanes; some need decisions first)

- **6.1** Derive Local SEO city/service classifiers from configured markets + business profile (kills the hardcoded Texas/dental bias for every non-first-client workspace).
- **6.2** Schema value prioritization: populate dead `ctx.searchIntent` + per-page value score; sort page list and bulk-generation order by value (**merge into existing `kwv-titles-metas-schema-priority`** — do not duplicate).
- **6.3** Move the five synchronous heavyweight AI route handlers onto the job platform; pagination on unbounded post/brief list endpoints; `schema_snapshots` pruning.
- **6.4** Wire-or-delete: suggested-briefs subsystem (D2), calendar intelligence (D3), half-built pending-schemas pipeline.
- **6.5** Schema plan status transitions through `validateTransition`; `content-templates` routes onto `validate()` Zod middleware.

## Polish sweeps (any time, one Haiku/Sonnet PR per surface)

One batched PR per surface for the 🟡 minors (report §1–6 minors lists are the line-item spec): Strategy, Keyword Hub, Local SEO, Schema, Content, Admin shell. Includes all Four-Laws fixes (orange-as-active, `sky-*`, cyan CTAs, violet/green StatCard `iconColor` hexes), a11y batches (aria-expanded, color-only selection, hover-only controls), and dead-code deletes.

---

## Dependency graph

```
Wave 1 (6 lanes ∥) ──┬── Wave 3.1/3.3/3.5 (∥) ── 3.4 (sequential, shared nav files)
Wave 2 (5 lanes ∥) ──┤         3.2 (needs 2.3)
                     ├── Wave 4 (sequential phases, pre-plan-audit first)
                     ├── Wave 5 (3 lanes ∥)
                     └── Wave 6 (after decisions D1–D4)
Polish sweeps: independent, schedulable into any gap.
W1 ∥ W2 is allowed EXCEPT lanes touching the same files (1.1/2.1 both touch strategy → sequence those two; 1.5/2.3 schema → sequence; rest overlap-free).
```

## Systemic improvements (per plan-guide §6)

- **Shared utility:** an `ErrorState`-on-`isError` wrapper/hook pattern for the recurring swallow fix (extract if 3+ call sites end up identical).
- **pr-check rules to add:** (1) nav-registry rule (W3.4); (2) `.catch(() => null)` inside `queryFn` forbidden; (3) consider SectionCard double-wrap rule (already flagged in memory).
- **Tests:** FM-2 error-path tests per W1 lane; 409 protection test (W2.2); read-path integration tests (W2.3/2.4); `?tab=` contract tests per W3.3 link.

## Owner decisions needed (blocking only the lanes named)

- **D1 — Fold `seo-briefs` into `content-pipeline?tab=briefs`?** (audit recommends yes; route-removal checklist applies). Blocks nothing until Wave 4-adjacent.
- **D2 — Suggested-briefs subsystem:** build the missing UI or delete the subsystem? Blocks 6.4.
- **D3 — Calendar intelligence:** wire it or delete dead code? Blocks 6.4.
- **D4 — Snapshot retention values** for `local_visibility_snapshots` + `schema_snapshots` (e.g. 180d / last-N). Blocks 2.4/6.3 pruning halves only.

## Deferred ideas (NOT migrated to roadmap — promote deliberately)

Missing-capability findings that are feature options, not defects: export (Strategy/Hub/Local/Content), scheduled regeneration & staleness policies, bulk brief generation from Hub selection, strategy history browser/restore, per-keyword notes, cross-page selection, SERP/social preview in PostEditor (primitives exist), per-market comparison view, virtualization, content-refresh workflow, undo-after-bulk. Already tracked elsewhere: GBP health / reviews / geo-grid / client local dashboard (`intel-quality-*`), Command Palette 2.0 (`542`), WCAG (`516`/`44`), schema auto-schedule (`38`), widget home (`540`).
