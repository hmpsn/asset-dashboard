# Strategy Surface — Reimagination Understanding Brief

_Auto-assembled from a 6-agent understanding audit (2026-06-19). GROUNDING for a from-scratch reimagination of the admin Strategy surface — read alongside `2026-06-19-strategy-redesign-walkthrough-feedback.md` (what's wrong + the north-star). This brief = what exists + what data/AI-drafting capability you have to design with._

---

## Contents
1. Current Strategy surface + interaction model
2. Recommendation engine + two-axis lifecycle (the reusable substrate)
3. **Data catalog** — everything available to the surface
4. What the system can already DRAFT (system-drafts-human-curates)
5. Downstream — client dashboard (#12c) + content pipeline
6. External patterns + inspiration seeds

---

# The Current Strategy Surface + Its Interaction Model

> **Scope of this section:** the admin Strategy page as it exists today, with the `strategy-command-center` flag **ON** (the validated path being walked through). This is the layout the redesign is replacing. The flag-OFF path is documented inline only where it clarifies what the redesign already moved.

## 1. The orchestrator: `KeywordStrategy.tsx` (`KeywordStrategyPanel`)

`src/components/KeywordStrategy.tsx` is a ~676-line **arrangement orchestrator**, not a renderer. It does three things:

1. **Fetches everything up front** — one big bundle of React Query hooks: `useKeywordStrategy` (the strategy blob: `pageMap`, `siteKeywords`, `opportunities`, `contentGaps`, `keywordGaps`, `topicClusters`, `cannibalization`, `quickWins`, `strategyUx.orient`), `useAdminRecommendationSet` (the unified rec set, separately generated from the strategy blob), `useRecommendationLifecycle`, `useStrategyKeywordSet` (managed keyword set), `useContentDecay`, `useLocalSeo`, plus the extracted logic hooks `useStrategyMetrics / Settings / Generation`, `useTrackKeyword`, `useKeywordFeedback`.
2. **Builds every section as a named local element** (`realLeaves.quickWins`, `.cannibalization`, `.siteKeywords`, `.opportunities`, `orientEl`, `cockpitEl`, `clientFeedbackCombinedEl`, `settingsEl`, …). The orchestrator's entire reason for existing is that **the same leaf elements are arranged differently by flag and by tab** — the components don't change, only their grouping/order does.
3. **Threads four feature flags** that compose into the layout: `strategy-command-center` (master), `strategy-keywords-managed-set`, `strategy-competitor-send`, `strategy-signal-fold`. The child flags are gated on `commandCenterEnabled && childFlag`, so the managed-set/send/fold features only appear inside the v3 layout.

**The page never asks the system for a point of view.** It asks the *operator* to read the leaves and form one. This is the architectural fingerprint of the core critique: the orchestrator is a layout switch over a fixed set of inputs.

### Page chrome (above the tabs)
`PageHeader` ("Keyword Strategy", subtitle = `Generated {date} · {N} pages mapped`) + header actions (`StrategyHeaderActions`: Generate / Incremental / Full refresh) + an optional `?`-icon Tooltip (`StrategyHowItWorks`, demoted from an inline section to a hover). Then a stack of conditional banners: refresh-ordering prompt, AI-context indicator, generation progress bar, error state, "Strategy ready" next-steps card, feedback nudge, staleness nudges, empty state. **Note (walkthrough item #1): the owner expects `StrategyConfigPanel` to live up here as page chrome; today it renders at the very bottom of the Overview tab instead.**

### The 4 interior tabs (`TabBar`, `?tab=` deep-linkable)
Tab ids are stable: `overview | content | rankings | competitive`. Flag-ON renames the `rankings` *label* to "Keywords & Rankings" but never the id (deep-link contract).

## 2. Tab-by-tab content

### Overview tab — the synthesis dump (flag-ON order)
Renders, top to bottom: feedback nudge → staleness nudges → **`OrientZone`** → **`StrategyDiff` ("What Changed")** → **`StrategyCockpit`** → **`CannibalizationTriage`** → **`StrategyConfigPanel`** (mis-placed at the bottom). This is the "decision pipeline" graft — the old "Reference & Analysis" divider was deleted, and `SiteTargetKeywords` / `KeywordOpportunities` / `ClientKeywordFeedback` were pushed to the Keywords tab.

### Content tab — reference view
A caption ("Reference view — actionable items also surface in the Act queue on Overview") + `ContentGaps` (cap 5) + `TopicClusters` (cap 5) + `DecayingPagesCard`. Falls back to an `EmptyState` when none have content.

### Keywords & Rankings tab — `StrategyRankingsTab`
Hub deep-link row → `SiteTargetKeywords` → `KeywordOpportunities` → `ClientKeywordFeedback` → `RankingDistribution` → position-movements `CompactStatBar` (only renders after a 2nd refresh produces real movement). The owner wants this order *flipped* (#10): rankings → feedback → target keywords → opportunities.

### Competitive tab — `StrategyCompetitiveTab`
The "research mode" surface: `ShareBar` → `CompetitiveIntel` (merged variant) → `KeywordGaps` (with Create-brief CTA) → `BacklinkProfile`. Empty-states out when DataForSEO isn't configured or no competitors are set.

## 3. Every strategy component — what it shows · what the operator can DO · interaction pattern

| Component | Shows | Operator can DO | Interaction pattern |
|---|---|---|---|
| **OrientZone** | Visibility-score `MetricRing` + one-line deterministic verdict + 4-stat strip (clicks / impressions / ranked keywords / avg position) with deltas vs last generation | Nothing — read-only | **Glance.** Pure orientation, no affordances |
| **StrategyDiff** ("What Changed") | Collapsed callout: "{N} strategy updates since {date}". Expands to a 5-stat grid (Added/Retained/Reassigned/Retired/Preserved), a "Why these matter" list (per-keyword reasons + next-action CTA), and added/lost keyword / gap / reassignment chip lists | Click into a per-keyword next-action (deep-links to editor/briefs/etc. via `strategyNextActionTarget`) | **Disclosure + deep-link.** Read the delta, jump elsewhere to act |
| **StrategyCockpit** | The Overview hero. `CurationMeter` ("{N} sent · curate, don't just send") + `NeedsAttentionStrip` + a **"Fix now" pin** (cap 5, by value) + a **lifecycle segmented control** (Active/Sent/Approved/Throttled) + **category toggle chips** (Content/Technical/Quick-wins) + a **Value/Impact/Age sort** + the faceted rec list. Bulk-selection via per-row checkboxes feeds a sticky `CurationBulkActionBar` | Per-rec: **Send to client** (note panel), **Fix** (deep-link), **Throttle** (7/30/90d) or **Strike** (with cascade confirm), **Undo** on struck rows. Bulk: send / throttle / strike across a selection. Select-all-in-filter | **Faceted curation list.** The closest thing to "curate a system draft" today — but it's a *control panel over a flat rec list*, not a drafted narrative. **Known bugs (#3, #4, #5):** sort doesn't reorder; "Select all N" is a ghost text-button mid-list (not a checkbox at top); the main list is **uncapped** — `useShowMore` was never applied here, so it renders the full ~195-rec wall |
| **CockpitRow** | One rec: left-edge lifecycle accent rail + title + 3 fixed tag slots `[severity][value ##][lifecycle]` + a **single-line truncated** why-line (`rec.description` collapsed to one line) + the action buttons | Inline-expand Send / Throttle / Strike sub-panels; toggle the selection checkbox | **Fixed-slot row with inline action modes.** The "why" is one ellipsized line — the reasoning is compressed to near-nothing |
| **SiteTargetKeywords** | The managed working set (~15 curated keywords): each row = keyword Badge + "In Set" badge/teal dot + volume/mo + KD% + a row of icon-only actions | **Track** (Hub), **View in Hub**, **Keep in set** (heart, survives regen), **Remove from set** (×), **Add to set** (bookmark) on candidates; a search-and-add input | **Icon-action row + show-more.** **Walkthrough #8 (north-star item):** the icons are unlabeled (hover `title` only) so the operator "has no idea what they do"; and it's unclear these are even the *right* highest-value keywords or the *right* per-keyword data to decide add/remove |
| **KeywordOpportunities** | Numbered AI-suggested keywords + a disclaimer ("validate before acting"). When a matching sendable `keyword_gap` rec exists, the row also shows a `WhyHowResult` why-line | **Explore in Hub** (icon-only); **"Interested in this one?"** → inline confirm → `recommendations.send()` (the client-feedback ask); optional add-to-managed-set seam after send | **Numbered list + conditional send.** **#9:** the "Interested?" affordance appears on *only some rows* (only where a backing rec exists), which reads as arbitrary; purpose isn't legible |
| **TopicClusters** ("Topical Authority") | Topic clusters ranked by coverage gap: coverage % + bar, owned/total, avg ranked position, top competitor coverage, gap-keyword chips | **Keep** (durable via `tracked_actions`) — that's it | **Keep-marker list.** **#6:** no add / suggest / remove / run-research — keep-only by design |
| **CannibalizationTriage** | Each cannibalization issue: keyword, severity badge, recommended action, and the competing pages with an auto-derived **keeper** marked (canonical tag if set, else best-ranking page) | **Send to client** (bespoke consolidation card), **Mark resolved** (drops from queue via `tracked_actions`), **Fix in editor** per duplicate page | **Triage list.** **#2 (long-missed):** the keeper is *auto-derived and read-only* — the operator **cannot override which page is the keeper**, despite that being specced and roadmapped months ago |
| **DecayingPagesCard** | Top-5 most-severe decaying pages: title, severity, click decline (prev → current, % drop), and a `WhyHowResult` why-line from the page's `content_refresh` rec | **Send to client**, **Refresh brief** (→ content pipeline), **Review page** (→ page intelligence) | **Severity-ranked row list.** **#7 (bug):** `WhyHowResult` renders in *compact* mode → the why-line is truncated to one ellipsized line, making the narrative the operator needs unreadable |
| **WhyHowResult** | Shared presenter for the **Why → How → Result** triad. *Compact (default):* Why line only, **truncated**. *Expanded:* all three tiers (Why text, How label, Result as a blue gain badge or emerald/amber impact band). Exports `isSendable()` — the gate consumers use to enable Send only when why+result both resolve | Nothing — presenter | **Presenter.** Built to carry the per-item rationale that makes a rec client-sendable — but **every Strategy consumer renders it compact/truncated**, so its core value (readable why) is invisible on this surface |
| **StrategyConfigPanel** | Collapsed disclosure wrapping `StrategySettings` (DataForSEO provider, max pages, business context, competitor domains, discover-competitors) + Local SEO market config. Collapsed header shows a summary line ("DataForSEO · Austin TX · 500 pages max · Context set · 5 competitors") | Edit all strategy-generation config; open the Local SEO setup drawer | **Bottom-of-page disclosure.** **#1:** the owner expects this *above the tabs* as page-level chrome (it's the parent that drives the whole strategy), not buried at the foot of Overview |
| **StrategyRankingsTab** | Orchestrates the Keywords & Rankings tab — injects the keyword surfaces above `RankingDistribution` + position-movements | n/a (composition shell) | **Tab composition shell** |

## 4. The mental model the UI imposes today

**"Read N co-equal sections and synthesize a point of view in your head."**

- The page presents **all the evidence as parallel, co-equal cards** — orientation stats, what-changed, a faceted rec cockpit, cannibalization, decay, clusters, keyword set, opportunities, competitive analysis — and makes the **human do the first-draft synthesis**.
- Reasoning that *should* anchor each recommendation (the Why → How → Result that `WhyHowResult` was built for) is **truncated to one line** on this surface, so even the per-item "why" is mostly invisible.
- The one component that comes closest to "curate a draft" — `StrategyCockpit` — is still framed as **a control panel over a flat list of ~195 recs**: facets, toggles, sorts, bulk actions. It lets you *filter and dispatch* inputs; it does not *present a drafted narrative* to curate.
- The operator's job is unchanged across every redesign round: **assemble a dashboard, hold it all in working memory, decide what to send.** The redesign moved/relabeled/wired the parts but never flipped the job from **"operator assembles inputs"** to **"system drafts a meeting-ready point of view; operator curates + sends."** This surface is supposed to do four jobs at once from one artifact (client-meeting prep · source of the client dashboard · content direction · keyword targets) — and today it serves none of them as a finished draft.

## 5. Flag posture

All Strategy redesign flags are **`rolloutTarget: 'staging-validation'`, default OFF** in `FEATURE_FLAG_CATALOG` (`shared/types/feature-flags.ts`), owner `analytics-intelligence`:

- **`strategy-command-center`** (master) — the v2/v3 Orient/Act/Evidence + interior-tabs IA. Removal condition: promote to default once validated on staging, then delete the legacy sequential layout. The whole walkthrough was run with this ON.
- **`strategy-keywords-managed-set`** — the `SiteTargetKeywords` add/remove/keep/replenish controls (dedicated `strategy_keyword_set` table). Gated on `commandCenterEnabled && flag`.
- **`strategy-competitor-send`** — competitor-RecType send-to-client. Doubly gated.
- **`strategy-signal-fold`** — folds the old standalone `IntelligenceSignals` card into the cockpit as real recs at generation time (which is why `IntelligenceSignals` is absent from the flag-ON Overview).
- Adjacent: **`strategy-staleness-scan`** (sent-rec staleness nudge/supersession cron — feeds `NeedsAttentionStrip`) and **`strategy-paid-topics`** (deferred monetization).

The **client-facing 3-layer recommendation platform (#12c) is NOT built** — the keystone gap. The admin surface above produces curated recs, but the streamlined client-dashboard view that should consume them does not yet exist.

**Key pointers:**
- src/components/KeywordStrategy.tsx — the ~676-line orchestrator (`KeywordStrategyPanel`); builds every section as a named local element (`realLeaves.*`, `cockpitEl`, `orientEl`) and arranges them by flag + interior tab. The 4 tabs: overview|content|rankings|competitive (line 57). flag-ON Overview order at lines 491-537; Keywords&Rankings wiring at 597-647
- src/components/strategy/StrategyCockpit.tsx — the Overview hero faceted curation list (Fix-now pin + lifecycle segmented control + category chips + Value/Impact/Age sort + bulk select). Known bugs: sort doesn't reorder (sortRecs at cockpitRowModel.ts:118), 'Select all N' is a ghost text-button mid-list (line 199), main `visible` list is uncapped (line 213 — no useShowMore)
- src/components/strategy/CockpitRow.tsx — fixed [severity][value][lifecycle] tag slots + single-line-truncated why-line (line 88) + inline Send/Fix/Throttle/Strike action modes
- src/components/strategy/shared/WhyHowResult.tsx — Why→How→Result presenter + isSendable() gate. Compact mode (default) truncates the Why to one line (line 128); expanded 3-tier mode (line 134+) is never used by Strategy consumers
- src/components/strategy/SiteTargetKeywords.tsx — managed keyword set with unlabeled icon-only row actions (Track/View/Keep/Remove/Add) + search-and-add. Walkthrough #8 north-star surface
- src/components/strategy/KeywordOpportunities.tsx — numbered AI keyword suggestions + conditional 'Interested in this one?' send (only when a matching sendable keyword_gap rec exists — walkthrough #9 'arbitrary' affordance)
- src/components/strategy/TopicClusters.tsx — coverage-gap cluster cards, Keep-only affordance (no add/suggest/remove — walkthrough #6)
- src/components/strategy/CannibalizationTriage.tsx — keeper is auto-derived read-only via keeperPathOf() (line 39); no operator keeper override (walkthrough #2, long-missed roadmap item)
- src/components/strategy/DecayingPagesCard.tsx — top-5 decaying pages with Send/Refresh-brief/Review-page; renders WhyHowResult compact → truncated/unreadable (walkthrough #7)
- src/components/strategy/StrategyConfigPanel.tsx — bottom-of-Overview config disclosure (DataForSEO/pages/context/competitors + Local SEO); owner expects it as page chrome above the tabs (walkthrough #1)
- src/components/strategy/StrategyDiff.tsx — 'What Changed' collapsed callout: 5-stat delta grid + 'Why these matter' next-action deep-links + keyword/gap chip lists
- src/components/strategy/OrientZone.tsx — read-only visibility-score MetricRing + verdict + 4-stat delta strip (reads strategyUx.orient)
- src/components/strategy/StrategyRankingsTab.tsx — Keywords&Rankings composition shell; owner wants section order flipped (walkthrough #10)
- src/components/strategy/StrategyCompetitiveTab.tsx — research-mode tab: ShareBar → CompetitiveIntel → KeywordGaps → BacklinkProfile
- src/components/strategy/CurationBulkActionBar.tsx + CurationMeter.tsx + NeedsAttentionStrip.tsx — cockpit support: sticky bulk send/throttle/strike bar, 'curate don't just send' meter, stale-sent/superseded/new-reply attention strip
- src/lib/recCategoryMap.ts — RecType → ActCategory (content/technical/quick-win) map that drives the cockpit category chips
- shared/types/feature-flags.ts (lines 297-371) — flag posture: strategy-command-center + strategy-keywords-managed-set + strategy-competitor-send + strategy-signal-fold + strategy-staleness-scan, all default OFF, rolloutTarget 'staging-validation', owner analytics-intelligence
- docs/superpowers/notes/2026-06-19-strategy-redesign-walkthrough-feedback.md — the owner's verbatim walkthrough + CORE CRITIQUE (rearranged not reimagined) + the four jobs this surface must serve + the #12c client keystone gap

---

# The Recommendation Engine + Lifecycle (the substrate to reuse)

This is the substrate that produces and governs the recommendations. The redesign should treat this as a **stable engine to reskin**, not rebuild. The data model already encodes a full curation lifecycle — `curate → send → approve`, plus `throttle`, `strike`, and `discuss` — and a single authoritative writer enforces it. **The operator's "assemble a dashboard" job exists today only because the *surface* re-derives everything from the rec list; the engine already knows how to mint, rank, carry-over, and curate a point of view.** That is the gap the redesign closes.

## 1. The two-axis model (already built — this is the crux)

Every `Recommendation` (`shared/types/recommendations.ts`) carries **three orthogonal status axes**, deliberately decoupled so a curated/sent rec can never read as "done" to a client:

| Axis | Field | Values | Owner | Meaning |
|---|---|---|---|---|
| **Internal triage** | `status` (`RecStatus`) | `pending → in_progress → completed / dismissed` | Admin | "Is the agency working on this / is it fixed?" |
| **Client-facing curation** | `clientStatus` | `system → curated → sent → approved / declined / discussing` | Operator picks, then client responds | "Has the operator chosen this, sent it, and what did the client say?" |
| **Suppression** | `lifecycle` | `active / throttled / struck` | Operator | "Should this surface at all right now?" |

Supporting fields: `throttledUntil`, `sentAt`, `struckAt`, `sendChannel` (`'rec'`/`'deliverable'`), and `cascade` (`{ removedKeywords?, removedClusters?, reversible }` — the Undo payload for keyword/topic strikes that also remove strategy items).

**All three axes are optional.** Absent ⇒ legacy rec ⇒ treated as `clientStatus:'system', lifecycle:'active'`. This means the redesign can render a fully-curated experience *and* still handle pre-existing recs byte-identically.

The trust-critical invariant (spec §6.1): **strike/throttle/send NEVER write `RecStatus`.** A struck rec must never get swept to `completed` and read as "✓ done" to the client.

### The "active" predicate — one function, imported everywhere
`isActiveRec(rec, now)` (`server/recommendations.ts`) is THE single definition of "should this surface in the Act queue / top-rec / AI context / briefings." A rec is active iff: not `completed`/`dismissed`, not `struck`, not throttled-into-the-future (auto-resurfaces on-read once `throttledUntil` passes — no cron), and `clientStatus` is not `sent`/`approved`/`declined`. **Every reader must import this rather than re-implement a partial filter** (the documented "leak bug" pattern). The redesign's new surfaces should consume `isActiveRec` directly.

## 2. The single-writer lifecycle (server/recommendation-lifecycle.ts)

All curation mutations flow through **one module** — the SINGLE WRITER. Each is a short synchronous `db.transaction()` that re-reads the set *inside* the txn (never a stale route copy), mutates exactly one axis, recomputes the summary (so a sent/struck rec drops out of `topRecommendationId`), and persists. The regen scheduler's per-workspace single-flight serializes the long regen; these short txns are safe against it.

| Function | Axis written | Edge | Notes |
|---|---|---|---|
| `sendRecommendation` | `clientStatus → sent` | `system→curated→sent` or `curated→sent` | Stamps `sentAt` + `sendChannel` from policy. Throws `InvalidTransitionError` on illegal edge (already approved/declined). |
| `strikeRecommendation` | `lifecycle → struck` | `active→struck` | Stamps `struckAt`; idempotent re-strike; accepts `cascade` payload. |
| `unstrikeRecommendation` | `lifecycle → active` | `struck→active` | Clears `throttledUntil`/`struckAt`/`cascade`. Strategy-item restore for reversible cascade is a route-layer concern. |
| `throttleRecommendation` | `lifecycle → throttled` | `active→throttled` | `throttledUntil = now + {7\|30\|90}d`. Auto-resurfaces on-read. |
| `fixRecommendation` | `status → completed` | via `updateRecommendationStatus` | "We'll do it ourselves" — the INTERNAL triage axis, NOT a client-facing change. Distinct from Send. |

### Policy registry — routing + cascade per RecType
`REC_POLICY_REGISTRY` (one entry per `RecType`) decides, per type: `sendChannel` (`'rec'` = Send mutates `clientStatus` directly; `'deliverable'` = routes to the deliverable spine, e.g. `cannibalization`), `cascadeOnStrike` (true for `keyword_gap`/`topic_cluster` — striking also removes strategy items), and `monetizable` (whether a priced "Add-to-plan" CTA is allowed). **An unlisted RecType cannot be curated** — registering a policy is the deliberate gate.

### State machines (server/state-machines.ts)
Three guarded maps, validated independently:
- `RECOMMENDATION_TRANSITIONS` — internal `RecStatus` axis (`completed`/`dismissed` are reopenable to `pending` so a re-detected issue revives) AND the operator curation edges (`system→curated`, `curated→{sent,system}`). `sent` has no operator-side forward edge.
- `CLIENT_REC_TRANSITIONS` — client response axis: `sent → {approved, declined, discussing}`, `discussing → {approved, declined}`, both decisions terminal. The client respond route validates ONLY this map and mutates ONLY `clientStatus`.

## 3. How recs are produced (generateRecommendations)

`generateRecommendations(workspaceId)` (~1316–2751, the engine) assembles **all producers into one in-memory `recs[]`, merges with the prior run, then persists once.** It is GSC-lag-gated (a full regen). Producers, each minting `Recommendation` rows:

| # | Producer | Source data | RecType(s) | Source key builder |
|---|---|---|---|---|
| 1 | **Audit issues** (grouped by check) + **site-wide issues** | `getLatestSnapshot` (Webflow audit) + traffic | `metadata`/`schema`/`accessibility`/`performance`/`technical`/`aeo` | `audit:<check>`, `audit:site-wide:<check>` |
| 2 | **Quick wins** | `listQuickWins` | `strategy` | `strategy:quick-win` |
| 2 | **Content gaps** | `listContentGaps` | `content` | `strategy:content-gap` |
| 2 | **Ranking opportunities** (pos 4–20, >100 impr) | `listPageKeywords` | `strategy` | `strategy:ranking-opportunity` |
| 2 | **Intent mismatches** (page-type vs keyword intent) | `listPageKeywords` | `strategy` | `strategy:intent-mismatch:<slug>` |
| 2b | **Keyword gaps** (competitor outranks us) | `listKeywordGaps` | `keyword_gap` | `keyword_gap:<keyword>` |
| 2b | **Topic clusters** (weakest only — ONE rec) | `listTopicClusters` | `topic_cluster` | `topic_cluster:<topic>` |
| 2b | **Cannibalization** (deduped vs active insight) | `listCannibalizationIssues` | `cannibalization` | `cannibalization:<urlSetKey>` |
| 2c | **Local visibility** (competitor brands + not-visible markets) | `getLocalSeoCompetitorBrands`, `buildLocalSeoKeywordVisibilitySummaryByKey` | `local_visibility` | `local_visibility:<marketKey>` |
| 2c | **Local service gaps** | `getLocalSeoServiceGaps` | `local_service_gap` | `local_service_gap:<serviceId>` |
| 3 | **Content decay** (critical/warning) | `loadDecayAnalysis` | `content_refresh` | `decay:<slug>` |
| 4 | **CTR opportunity** (top 10 by click gap) | `getInsights('ctr_opportunity')` | `metadata` | `insight:ctr_opportunity:<slug>` |
| 5 | **Diagnostic remediation** | `listDiagnosticReports` | `content`/`technical` | `diagnostic:<reportId>:<idx>:<title>` |
| 6 | **Content freshness** | `getInsights('freshness_alert')` | `content_refresh` | `insight:freshness_alert:<slug>` |
| 7 | **Signal-fold** (`mintSignalRecs`) | `buildStrategySignals(getInsights(...))` | `keyword_gap`/`topic_cluster`/`strategy` | `signal:<insightId>` |

`competitor` is the 15th `RecType` — minted by a dedicated route (POST), not this generator.

**`mintSignalRecs`** folds the standalone IntelligenceSignals feed into first-class recs (flag `strategy-signal-fold`). Maps `StrategySignal.type`: `momentum→keyword_gap`, `content_gap→topic_cluster`, else `strategy`. Runs AFTER carry-over/merge, dedups per-`insightId` via `buildMergeKey`. Pure feed-map: carries `impactScore` directly, no `opportunity` (so the OV post-pass skips it).

### Scoring spine (every producer converges on it)
Each producer maps its fields into `computeOpportunityValue(OpportunityInput)` → an `OpportunityScore` (`opportunity` on the rec). `impactScore` (0–100, sort key) is a **derived read of `opportunity.value`**, and the served `priority` tier is derived from it via `deriveOvTier` (OV bands, except genuine `CRITICAL_CHECKS` which stay `fix_now`). The score carries `emvPerWeek`/`predictedEmv`/`roiPerEffortDay` (admin/AI-only — stripped on every public route), `confidence`, `calibration`, and self-describing `components[]` (dimension, evidence one-liner — this powers "why this is #1" and the client breakdown bars). Per-workspace inputs resolved once per cycle: `ovWeights`, `ovCalibration`, `ovAuthority`, `ovCtrCurve`, `timingBoosts`.

### Ranking
`sortRecommendations`: (1) priority tier PRIMARY, (2) learned `rankScore`/`impactScore` SECONDARY, (3) business-intent alignment as a within-tier-only tiebreaker (`effectiveBusinessPriorities`, resolved from client+admin stores). Intent can only break a tie — never cross tiers.

### Summary (the headline the surface should reuse, not recompute)
`computeRecommendationSummary` filters to `isActiveRec`, then emits `fixNow/fixSoon/fixLater/ongoing` counts, `totalOpportunityValue`, `actionableOpportunityValue`, `topRecommendationId`, `topOpportunityValue`, and `topOpportunityRationale` (client-safe, from the #1's top-2 OV components). **This is the system-drafted point of view in nascent form** — there is already a designated #1 with a rationale.

## 4. Carry-over & merge (why curation survives regen)

On each regen, `applyLifecycleCarryOver(newRecs, oldRecs)` (keyed by `buildMergeKey`) copies the ENTIRE client-facing axis (`clientStatus`, `lifecycle`, `throttledUntil`, `sentAt`, `struckAt`, `cascade`, `sendChannel`) plus `id`+`createdAt` continuity from each matched old rec onto its freshly-minted counterpart. **A sent rec stays sent through regen** — the trust-critical graft. `isExemptFromAutoResolve` shields `sent`/`discussing`/`approved`/`struck`/`throttled` recs from the destructive auto-resolve-to-`completed` sweep (whose source vanished → retained as-is). Source keys are stable-per-logical-issue and distinct-per-page so fixing one never auto-resolves another.

## 5. Triggering, persistence, feedback loop

- **Generation triggers:** daily cron + on-mutation, both funneled through `runRecommendationRegen` (per-workspace single-flight) / `queueDelayedRecommendationRegen` (debounced) in `server/recommendation-regen-scheduler.ts`. Also a manual "Recompute now" + "Computed X ago" surface.
- **Storage:** single `recommendation_sets` row per workspace (`workspace_id` PK, `recommendations` + `summary` as JSON TEXT), upserted whole. Read via `loadRecommendations`, written via `saveRecommendations`.
- **In-place resolvers** (fire without waiting for a GSC-lagged regen): `resolveRecommendationsForChange` (page-slug intersection), `resolveRecommendationsForPageIds` (Webflow page ids → slugs), `resolveContentRecommendationsForPublishedPost` (matches `content` recs by `targetKeyword`). Each validates transitions, recomputes summary, invalidates intelligence cache, and broadcasts.
- **Feedback loop:** mutations call `invalidateIntelligenceCache(workspaceId)` + `broadcastToWorkspace(..., WS_EVENTS.RECOMMENDATIONS_UPDATED, ...)`. Frontend must invalidate the React Query cache on that event. Auto-resolved pages also broadcast `PAGE_STATE_UPDATED`.

## 6. The API surface the redesign drives (server/routes/recommendations.ts)

Per-rec single-writer endpoints (all `requireWorkspaceAccess`, all return the mutated rec, all broadcast + log activity):
- `PATCH …/:recId/send` — curate→send; optional `note` becomes a strategist discussion entry; fires `notifyClientCuratedRecsSent` doorbell email if `clientEmail` set.
- `PATCH …/:recId/strike` / `…/unstrike` — strike is ADMIN-ONLY activity (never reads as a client decision); Undo keeps `cascade` open.
- `PATCH …/:recId/throttle` — `{days: 7|30|90}`.
- `PATCH …/:recId/fix` — internal completion.
- A **batch** endpoint applies send/throttle/strike to N recs in ONE `db.transaction()` (atomic curation session).

Client side: `POST /api/public/recommendations/:ws/:recId/respond` validates `CLIENT_REC_TRANSITIONS`, mutates only `clientStatus` (`approved`/`declined`/`discussing`). Discussion threads (`rec_discussion` table, `RecDiscussionEntry`) carry the narrative between strategist and client.

## Implications for the reimagination
1. **The curation lifecycle is done — reskin it, don't rebuild it.** The data model supports a system-drafted-POV workflow (mint → operator curates → sends → client responds), with throttle/strike/discuss as first-class. The surface today simply doesn't *present* it that way.
2. **`isActiveRec` + `computeRecommendationSummary` already produce a ranked, deduped, system-drafted point of view with a designated #1 and a client-safe rationale.** New surfaces should consume these, never re-derive.
3. **All writes must go through the single-writer + state machines.** The redesign adds presentation, not new mutation paths. The `RECOMMENDATIONS_UPDATED` broadcast + cache-invalidation contract is the wiring.
4. **The three-axis separation is load-bearing for trust** — any UI must keep "we'll do it" (`fix`/`status`) visually distinct from "sent to client" (`send`/`clientStatus`) and from "suppressed" (`throttle`/`strike`/`lifecycle`).

**Key pointers:**
- server/recommendations.ts — generateRecommendations() (~L1316-2751): the engine. Producers: audit/site-wide (L1438), quick-wins (L1597), content-gaps (L1647), ranking-opp (L1726), intent-mismatch (L1790), keyword_gap (L1844), topic_cluster (L1895), cannibalization (L1942), local-visibility/service-gap (L2025+), decay (L2270), ctr_opportunity (L2339), diagnostic (L2406), freshness (L2457), signal-fold (L2666). Merge/auto-resolve tail L2525-2656; OV post-pass + sort + summary + persist L2703-2750.
- server/recommendations.ts — mintSignalRecs() (L1255), signalToRecType (L1222), signalPriority (L1235); RecSource builders (L318-348); RecSourceCategory union (L268); buildMergeKey (L971); applyLifecycleCarryOver (L617); isActiveRec (L661); isExemptFromAutoResolve (L646); computeRecommendationSummary (L675); deriveOvTier (L872); sortRecommendations (L796); in-place resolvers L482/L547/L578.
- server/recommendation-lifecycle.ts — THE single writer: sendRecommendation (L82), strikeRecommendation (L102), unstrikeRecommendation (L119), throttleRecommendation (L131), fixRecommendation (L147), mutateRec txn helper (L58), REC_POLICY_REGISTRY (L37).
- shared/types/recommendations.ts — Recommendation interface (L10-80, three axes L50-77), RecStatus/RecType/RecPriority (L5-7), OpportunityScore + OpportunityInput + OpportunityComponent (L113-189), RecommendationSet.summary (L82-111), RecPolicy/RecPolicyRegistry (L240-249), RecDiscussionEntry (L208), StrategyRecommendationPayload (L221).
- server/state-machines.ts — RECOMMENDATION_TRANSITIONS (L100, internal RecStatus + operator curation edges), CLIENT_REC_TRANSITIONS (L118, client response axis).
- server/routes/recommendations.ts — per-rec endpoints: /send (L607), /strike (L644), /unstrike (L662), /throttle (L680), /fix (L703), competitor mint (~L585), batch curation txn (L410-452). Client respond: POST /api/public/recommendations/:ws/:recId/respond (CLIENT_REC_TRANSITIONS).
- server/recommendation-regen-scheduler.ts — runRecommendationRegen (L63, per-workspace single-flight) + queueDelayedRecommendationRegen (L93, debounced). Generation triggers: daily cron + on-mutation.
- Storage: recommendation_sets table (one JSON row per workspace, upserted whole). loadRecommendations/saveRecommendations in server/recommendations.ts L407-432.
- Feedback-loop contract: every mutation calls invalidateIntelligenceCache + broadcastToWorkspace(WS_EVENTS.RECOMMENDATIONS_UPDATED). Frontend must invalidate React Query on that event. docs/rules/strategy-recommendations.md is the canonical lifecycle contract doc.

---

# The Data Catalog — Everything Available to the Strategy Surface

This is the complete inventory of data a reimagined Strategy surface can draw on. It is grounded in the actual shared-type contracts and server stores, not aspiration. The central design fact: **almost all of this data already exists and is already assembled** — the redesign critique ("we rearranged, didn't reimagine") is true partly *because* the raw material to draft a point of view is already here. The system has the evidence; it just renders it as co-equal input panels instead of synthesizing a draft.

A few structural facts that shape everything below:

- **Two read paths.** Most surfaces read the **assembler** `assembleStoredKeywordStrategy(workspaceId)` → `StoredKeywordStrategy` (collapses 5 historically-divergent strategy reads onto one, table-as-truth with blob fallback). The **AI/advisor path** reads `buildWorkspaceIntelligence({ slices: [...] })` which orchestrates typed slices (`SeoContextSlice`, `InsightsSlice`, `LearningsSlice`, `ClientSignalsSlice`, `SiteHealthSlice`, etc.). A reimagined surface should prefer the intelligence facade — it is the same context the AI advisor sees, which is exactly what you want if the system is to "draft a point of view."
- **Normalized vs blob.** Migrations 088–090 extracted `keyword_gaps`, `topic_clusters`, `cannibalization_issues` into dedicated tables; `content_gaps` (086/115), `quick_wins` (087), `page_keywords` (024), `site_keyword_metrics` (117) are also tables. These are filterable/sortable. The legacy `keywordStrategy` JSON blob is the fallback only.
- **Client-safe stripping is enforced at the route boundary**, not the data layer. The raw admin data carries `emvPerWeek`, `predictedEmv`, raw volume/KD/$ — all stripped on public routes (`stripEmvFromPublicRecs`, `competitor-gaps-projection.ts`). This matters because the Strategy surface is *job #2: the source of the client dashboard* — the admin curates the rich version; the system already knows how to project the safe version.

---

## 1. Recommendations — the product artifact (value / impact / why)

The single most important data source: this IS what the surface produces. Stored in `recommendation_sets` table; loaded via `loadRecommendations(workspaceId)` → `RecommendationSet`.

| Field | What it carries | Notes for design |
|---|---|---|
| `title`, `description`, `insight` | The "what" + the **human-readable why-this-matters** | `insight` is the why-line the cockpit/cards already render. The narrative draft material exists per-rec. |
| `type` (`RecType`) | 16 types: technical, content, content_refresh, schema, metadata, performance, accessibility, strategy, aeo, **keyword_gap, topic_cluster, cannibalization**, local_visibility, local_service_gap, competitor | Note: rec types map 1:1 to the other data sources below — the rec set is the *unification* of all evidence. |
| `priority` | `fix_now` / `fix_soon` / `fix_later` / `ongoing` | The triage bucket. |
| `impact`, `effort`, `impactScore` (0–100) | Sort/rank axis | `impactScore` is a derived read of `opportunity.value` when OV is present. |
| **`opportunity` (`OpportunityScore`)** | The grounded value model: `value` (0–100), `emvPerWeek` ($, admin-only), `predictedEmv`, `confidence` (0.4–1.0), `calibration` (per-workspace), and **`components[]`** | **This is the gold.** Each `OpportunityComponent` is self-describing: `dimension` (demand/winnability/intent/effort/businessFit/timing/evidence), `rawValue`, `normalized`, `weight`, `contribution`, and a one-line **`evidence` string the advisor recites verbatim**. This is a ready-made "why this is #1" narrative — already computed. |
| `affectedPages[]`, `trafficAtRisk`, `impressionsAtRisk`, `estimatedGain` | The blast radius + a human gain string | Concrete numbers for client-meeting framing. |
| `targetKeyword` | The keyword a content/gap rec targets | Joins recs to keywords (job #4). |
| **`clientStatus`** | v3 curation axis: `system` → `curated` → `sent` → `approved`/`declined`/`discussing` | **The curation lifecycle already exists.** This is the spine for "system drafts → operator curates → client responds." |
| **`lifecycle`** | Suppression axis: `active` / `throttled` (hidden until `throttledUntil`) / `struck` (permanent) | Orthogonal to clientStatus. Strike/throttle/send never touch internal `RecStatus`. |
| `sendChannel`, `cascade`, `impactBand` | Routing (`rec` vs `deliverable`), strike-reversal payload, client-safe banded impact | `impactBand` is the client-facing value (set only on public projection). |
| `RecDiscussionEntry` | Per-rec client↔strategist thread (`author`, `body`) | Backs the "discussing" status — two-way conversation substrate exists. |

**`RecommendationSet.summary`** is pre-aggregated: `fixNow/fixSoon/fixLater/ongoing` counts, `totalOpportunityValue`, `actionableOpportunityValue`, `topOpportunityValue`, `topRecommendationId`, and **`topOpportunityRationale`** (one-line rendered rationale for the #1). A "lay of the land" headline is already computed.

**Freshness:** Regenerated by `generateRecommendations` (audit-driven, GSC-lag-gated). In-place lifecycle resolution via `resolveRecommendationsForChange/ForPageIds/ForPublishedPost` (carry-over, auto-resolve). A daily **staleness scan** (`runSentRecStalenessScan`, flag `strategy-staleness-scan`) derives "needs attention" nudges (`stale_sent` after 14d, `superseded`) **fresh each scan, never persisted**. **Richness: RICH** for any real workspace — this is the densest source (the walkthrough showed ~195–197 recs).

---

## 2. Analytics Insights + Anomalies — the live evidence feed

Stored in `analytics_insights` (migration 035+); read via `InsightsSlice` (intelligence) or `getInsights`. The raw, per-page signal layer that *feeds* recommendations but is also directly usable.

**`AnalyticsInsight<T>`** carries `insightType` (20 types), `data` (type-safe via `InsightDataMap`), `severity` (critical/warning/opportunity/positive), `impactScore`, plus rich enrichment: `pageTitle`, `strategyKeyword`, **`strategyAlignment`** (aligned/misaligned/untracked), `pipelineStatus` (brief_exists/in_progress/published), `resolutionStatus`, `bridgeSource`.

The 20 insight types, each with a typed data shape — these are the orientation primitives:

| Insight type | Key data fields | Strategy relevance |
|---|---|---|
| `ranking_mover` | currentPosition, previousPosition, **positionChange**, current/previousClicks | **Position movements** — the lay-of-the-land delta |
| `content_decay` | baselineClicks, currentClicks, deltaPercent, periods | Decay (also has its own richer store, §4) |
| `cannibalization` | query, pages[], positions[], totalImpressions | Cannibalization (also richer store, §7) |
| `ctr_opportunity` | actualCtr vs expectedCtr, ctrRatio, **estimatedClickGap** | High-impression low-CTR wins |
| `ranking_opportunity` | currentPosition, impressions, **estimatedTrafficGain** | Striking-distance / quick wins |
| `competitor_gap` | competitorDomain, competitorPosition, ourPosition, volume, difficulty | Competitor gaps (§8) |
| `strategy_alignment` | alignedCount, misalignedCount, untrackedCount | **Strategy-vs-reality** — directly answers "are we on target?" |
| `serp_opportunity` | impressions, position, ctr, schemaStatus | Rich-result eligibility |
| `page_health` | score, trend, full GSC+GA4 metrics, errorCount, topIssues | Per-page composite |
| `anomaly_digest` | anomalyType, currentValue, expectedValue, deviationPercent, durationDays, firstDetected, affectedPage, diagnosticReportId | **Anomalies** — surfaced deviations w/ optional deep-diagnostic link |
| `emerging_keyword` | keyword, volume, difficulty, trendData[], suggestedAngle | Trend-rising opportunities |
| `competitor_alert` | competitorDomain, alertType, position change, volume | Weekly competitor moves |
| `lost_visibility` | lostCount, topQueries[] (lastPosition, lastSeen, totalImpressions) | Queries that fully dropped from GSC |
| `local_visibility_shift` | direction (risk/win/competitor), market, keyword, rank change | Local-pack transitions |
| `milestone_attribution` | briefId/Title, thresholdCrossed, currentClicks, trafficValue | "We delivered X, it crossed Y clicks" wins |
| `site_health`, `audit_finding`, `freshness_alert`, `keyword_cluster`, `conversion_attribution` | site score deltas, audit issues, staleness, cluster pillar pages, conversion rate/revenue | Supporting orientation |

The slice pre-computes **`countsByType`, `bySeverity`, `countsByTypeBySeverity`** (full pre-cap counts — authoritative for "how many of type X"), `topByImpact`, and `all` (top 100 by impactScore). **Freshness:** Recomputed by `intelligence-recompute-job` (manual "Recompute now" button + daily activity-gated cron + on-mutation triggers, flag `signal-auto-recompute`). Surface shows "Computed X ago." **Richness: RICH** when GSC/GA4 connected; THIN for new/disconnected workspaces.

Also available: **`StrategySignal`** and **`PipelineSignal`** (derived feedback-loop signals: momentum/misalignment/content_gap and suggested_brief/refresh_suggestion) — these are the pre-built bridges from insights into strategy and content actions.

---

## 3. Ranking Distribution + Position Movements

**Not a dedicated store** — computed client-side in `StrategyMetrics` from `pageMap[].currentPosition` / `previousPosition`. This is a derived aggregate, cheap to recompute or move server-side.

- **Distribution buckets**: `top3`, `top10` (4–10), `top20` (11–20, "striking distance"), `beyond20`, `notRankingCount` — plus `ranked` count and "N of M pages with ranking data."
- **`movements`**: `{ improved, declined, new, lost }` vs each page's `previousPosition`.
- **`intentCounts`**: search-intent mix (commercial/informational/transactional/navigational) across the page map.
- **`avgPos`, `totalImpressions`, `totalClicks`**, `lowHangingFruit` (striking-distance pages).
- The 11–20 band already deep-links to the Keyword Hub `?tab=striking_distance`.

The richer **`OrientMetrics`** (computed server-side on both admin and public reads) is the proper "where the site sits" glance: `visibilityScore` (CTR-weighted), `clicks`, `impressions`, `rankedKeywords`, `avgPosition` — **each paired with a signed delta vs the previous strategy generation** (`...Delta`, null when no prior snapshot). This is client-safe by construction (no $/emv). **And `RankTrackingSummary`** (intelligence): `trackedKeywords`, `avgPosition`, `positionChanges {improved, declined, stable}`, and **`topKeywordMovers[]`** (query, position, signed change, direction, clicks, impressions, ctr, pagePath/Title). **Freshness:** daily rank-tracking scheduler. **Richness: RICH** when rank tracking is on; the distribution is RICH whenever `pageMap` has positions (GSC-backed).

---

## 4. Content Decay

Dedicated analyzer `server/content-decay.ts`; `GET /api/content-decay/:id` → `DecayAnalysis`. Read by `DecayingPagesCard`.

- **`DecayingPage[]`**: `page`, `title`, current/previous **clicks**, `clickDeclinePct`, current/previous **impressions** + `impressionChangePct`, current/previous **position** + `positionChange`, `severity` (critical/warning/watch), **`refreshRecommendation`** (the why→how narrative), **`isRepeatDecay`**, `priority`.
- **`summary`**: counts by critical/warning/watch, `totalDecaying`, `avgDeclinePct`.
- Lighter `DecayAlert` form in `ContentPipelineSlice`: `pageUrl`, `clickDrop`, `detectedAt`, **`hasRefreshBrief`** (already-actioned?), `isRepeatDecay`.

**Freshness:** computed on read (GSC period comparison). **Richness: RICH** for established sites with content (decay needs a history baseline). Note from walkthrough: the `refreshRecommendation` narrative renders truncated today — the *data* is full, the *rendering* clamps it.

---

## 5. Keyword Gaps (competitor keywords we don't rank for)

`keyword_gaps` table (migration 088). `KeywordGapItem`: `keyword`, `volume`, `difficulty`, **`competitorPosition`**, **`competitorDomain`**. Read via `StoredKeywordStrategy.keywordGaps` and `SeoContextSlice.keywordGaps`.

Client-safe projection (`ClientCompetitorGap`, §8) bands these into `opportunityBand` + `demandLabel` + a you-vs-them `benchmark` sentence, stripping raw volume/KD. **Freshness:** populated at strategy generation from competitor domain organic data. **Richness: MEDIUM–RICH** — depends on competitors being configured (the config panel sets up to 5 competitors); THIN if no competitors set.

---

## 6. Topic Clusters (topical authority coverage)

`topic_clusters` table (migration 089). `TopicCluster`: `topic`, `keywords[]`, **`ownedCount` / `totalCount` / `coveragePercent`**, `avgPosition`, **`topCompetitor` / `topCompetitorCoverage`**, **`gap[]`** (cluster keywords with no coverage), plus v3 fields **`rationale`** (operator/AI prioritization narrative) and **`projectedImpact`** (banded, client-safe). Read via `StoredKeywordStrategy.topicClusters`, `SeoContextSlice.topicClusters`, rendered by `TopicClusters`.

Coverage % is the headline ("you own 40% of the 'dental implants' cluster; competitor X owns 80%"). **Curation state:** keep-only today (`topic_cluster_keep` in `tracked_actions`); the walkthrough flags no add/suggest/remove. **Freshness:** strategy generation. **Richness: MEDIUM** — depends on keyword pool depth; the `rationale`/`projectedImpact` v3 fields are absent on legacy blobs (THIN there).

---

## 7. Cannibalization Issues

`cannibalization_issues` table (migration 090; action metadata in 094). `CannibalizationItem`: `keyword`, **`pages[]`** (each: `path`, `position`, `impressions`, `clicks`, `source: keyword_map|gsc`), `severity` (high = 3+ pages), **`recommendation`**, `canonicalPath`/`canonicalUrl`, `action` (`canonical_tag` / `redirect_301` / `differentiate` / `noindex`). Read via `StoredKeywordStrategy.cannibalization`, `SeoContextSlice.cannibalizationIssues`; rendered by `CannibalizationTriage`.

**Important gap (walkthrough #2):** the keeper page is **auto-derived read-only** (`keeperPathOf()` = canonical tag or best-ranking page). There is **no operator keeper-override store/endpoint** — tracked-but-unbuilt (`strategy-cannibalization-operator-keeper-override`). A reimagined surface that wants operator curation of the keeper has no persistence layer for it yet. **Freshness:** strategy generation + a `cannibalization` insight type. **Richness: MEDIUM** — common on content-heavy sites, sparse on small ones.

---

## 8. Competitor / Share-of-Voice + Backlinks

Three distinct sources:

- **`competitor_snapshots` table (migration 070)** → `SeoContextSlice.competitorSnapshots[]`: per tracked competitor domain — `snapshotDate`, `keywordCount`, `organicTraffic`, **`topKeywords[]`** (keyword, position, volume). This is the share-of-voice substrate (you-vs-them keyword counts + organic traffic). Plus `competitor_alerts` (071) feeding `competitor_alert` insights.
- **Competitor gaps**: §5 raw `keyword_gaps` → client-safe `ClientCompetitorGap` (`opportunityBand`, `demandLabel`, `benchmark`). `GET /api/public/competitor-gaps/:id` is paginated.
- **Backlinks**: `SeoContextSlice.backlinkProfile` (`BacklinkProfile`): `totalBacklinks`, `referringDomains`, `trend` (growing/stable/declining). Fetched live from the backlinks provider (`getBacklinksProvider` → DataForSEO/SEMRush) at slice-assembly time. `SerpFeatures` slice: `featuredSnippets`, `peopleAlsoAsk`, `localPack`, `videoCarousel` counts.

**Freshness:** competitor snapshots fetched on a competitor-fetch cadence (the config panel triggers fetches); backlinks fetched live per intelligence assembly. **Richness: THIN–MEDIUM** — gated entirely on competitors being configured and a backlinks provider being enabled. This is the most likely-to-be-empty source for a typical workspace; design must degrade gracefully.

---

## 9. Client Keyword Feedback (requested / approved / declined)

`keyword_feedback` table (migration 020; table retired/rebuilt 091). Read via `AdminKeywordFeedbackListRow[]` and `ClientSignalsSlice.keywordFeedback`.

- Each row: `keyword`, **`status`** (`approved` / `declined` / `requested`), `reason`, **`source`** (content_gap / page_map / opportunity / topic_cluster / keyword_gap — which surface the client reacted to), `created_at`, `updated_at`, `declined_by` (admin view).
- `StrategyMetrics` splits these into `declinedFeedback`, `requestedFeedback`, `approvedFeedback` and computes **`feedbackNewerThanStrategy`** (the client asked for something the latest strategy doesn't reflect — a freshness/triage signal).
- `ClientSignalsSlice.keywordFeedback` adds aggregate **`patterns`**: `approveRate`, `topRejectionReasons[]` — *what kinds of keywords this client tends to reject*, which is direct curation intelligence.

**Freshness:** real-time on client action (broadcast). **Richness: MEDIUM** — depends on client engagement; `requested` is the highest-value, lowest-volume signal (a direct client ask). This is **job #1 fuel** — the single strongest "what does the client care about" input for meeting prep.

---

## 10. The Managed Keyword Set (`strategy_keyword_set`)

`strategy_keyword_set` table (migration 139). **The curated working set** — the operator's deliberate target list, distinct from the auto-computed `siteKeywords`. Sole writer is the reconciler in `server/domains/strategy/managed-keyword-set.ts`, grafted into `persistKeywordStrategy`'s transaction so **regen never clobbers it** (this table exists specifically because `tracked_keywords` is delete-then-reinserted on every sync).

`StrategyKeywordSetRow` / `ActiveStrategyKeyword`: `keyword`, **`source`** (`regen_computed` / `client_request` / `manual_add`), **`keptAt`** (operator explicitly kept → survives regen), **`removedAt`** (operator removed → excluded from replenish), `slotOrder`, `createdAt`. "In the set" = row with `removedAt IS NULL`. Rendered by `SiteTargetKeywords` (gated `strategy-keywords-managed-set`), hook `useStrategyKeywordSet`. Each row joins to volume/KD metrics and tracked-keyword state.

This is the **closest existing thing to a curated point of view** — it already encodes operator intent (keep/remove/add) with provenance. **Freshness:** real-time on operator mutation; reconciled on regen. **Richness: MEDIUM** — only populated where the flag is on and the operator has curated (Faros has it; most workspaces don't yet).

---

## 11. Strategy History / "What Changed" Diffs

`strategy_history` table (migration 030, FK-rebuilt 119): snapshots `strategy_json` + `page_map_json` + `generated_at` on every generation. Written by `snapshotStrategyHistory`. Two derived shapes:

- **`KeywordStrategyDiff`**: `previousGeneratedAt` / `currentGeneratedAt`, **`newKeywords[]` / `lostKeywords[]`**, **`newGaps[]` / `resolvedGaps[]`**, **`keywordChanges[]`** (per-page old→new keyword), site-keyword count deltas, optional `summary` + `explanations`.
- **`KeywordStrategyRefreshSummary`**: counts of `added / retained / reassigned / deprecated / replaced / preserved / skipped / newContentGaps / resolvedContentGaps`.
- Lightweight `StrategyHistory` (intelligence): `revisionsCount`, `lastRevisedAt`.

This is the substrate for "since last time, here's what moved" — directly serving meeting prep ("what changed since we last spoke"). **Freshness:** snapshot per generation + on manual PATCH (Phase 5a fix). **Richness: MEDIUM** — needs ≥2 generations to diff; THIN on a brand-new workspace's first run.

---

## 12. Outcome Tracking + Workspace Learnings (what's worked before)

The "we've seen this before" memory. Tables: `tracked_actions` (041), `action_outcomes`, `action_playbooks`, plus `predicted_emv` (116) and `action_outcome_value` (106). Read via `LearningsSlice` (intelligence) and outcome routes.

- **`TrackedAction`**: every tracked move — `actionType` (16 types incl. `strategy_keyword_added`, `cannibalization_resolved`, `content_refreshed`, `topic_cluster_keep`...), `baselineSnapshot` (position/clicks/impressions/ctr/sessions/...), `trailingHistory`, `attribution` (platform_executed / externally_executed / not_acted_on), `predictedEmv`.
- **`ActionOutcome`**: per-checkpoint (7/30/60/90d) verdict — `score` (strong_win/win/neutral/loss/inconclusive), `earlySignal` (on_track/no_movement/too_early), `deltaSummary`, **`attributedValue`** ($ = clicks_delta × CPC).
- **`OutcomeReadback`**: the compact single-chip verdict for keyword rows ("#14→#6 · Win") — already joined into `KeywordStrategyExplanation.outcome`.
- **`WorkspaceLearnings`** (the aggregate intelligence): `confidence`, `totalScoredActions`, and four sub-models:
  - **`ContentLearnings`**: `winRateByFormat`, `avgDaysToPage1`, **`bestPerformingTopics[]`**, `optimalWordCount`, `refreshRecoveryRate`, `voiceScoreCorrelation`.
  - **`StrategyLearnings`**: `winRateByDifficultyRange`, `winRateByCheckpoint`, **`bestIntentTypes[]`**, **`keywordVolumeSweetSpot`**.
  - **`TechnicalLearnings`**: `winRateByFixType`, `schemaTypesWithRichResults`, etc.
  - **`OverallLearnings`**: `totalWinRate`, `strongWinRate`, **`topActionTypes[]`** (type, winRate, count), `recentTrend`.
- **`LearningsSlice.availability`** (`ready` / `disabled` / `no_data` / `degraded`) is the **authoritative usability gate** — don't re-derive. When `no_data`/`degraded`, the slice falls back to **`platformPriors[]`** (anonymized cross-workspace benchmarks — must be labeled "across all clients," never "your" rate). Also: `topWins[]`, `weCalledIt[]`, `roiAttribution[]`, `playbooks[]` (`ActionPlaybook` — trigger condition + action sequence + `historicalWinRate` + `confidence`).

**This is the data that lets the system *justify* a drafted recommendation with precedent** ("refreshes recover ~X% of decay for you in ~Y days; informational gaps in the 200–800 volume band are your sweet spot"). **Freshness:** outcome crons measure at 7/30/60/90d checkpoints; learnings recomputed on a cadence. **Richness: THIN until a workspace has scored history** (`totalScoredActions` floor) — explicitly designed to fall back to platform priors. For Faros/established workspaces, MEDIUM. This is the source most likely THIN early and richest over time — design for the cold-start fallback.

---

## Richness summary (for a real workspace)

| Source | Typical richness | Empty when... |
|---|---|---|
| Recommendations (incl. OpportunityScore + components) | **RICH** | brand-new workspace pre-first-generation |
| Analytics insights + anomalies | **RICH** | GSC/GA4 not connected |
| Ranking distribution / OrientMetrics / movements | **RICH** | no GSC position data |
| Content decay | **RICH** (established sites) | no content history baseline |
| Client keyword feedback | **MEDIUM** | client not engaging the portal |
| Managed keyword set | **MEDIUM** | flag off / operator hasn't curated |
| Strategy history / What Changed | **MEDIUM** | fewer than 2 generations |
| Topic clusters | **MEDIUM** | shallow keyword pool |
| Cannibalization | **MEDIUM** | small site |
| Keyword gaps / competitor SoV / backlinks | **THIN–MEDIUM** | no competitors configured / no backlinks provider |
| Outcome tracking / workspace learnings | **THIN early → richer over time** | no scored action history (falls back to platform priors) |

**The design implication:** the rich, always-present sources (recommendations with full opportunity components, insights, ranking distribution, decay) are exactly the ones needed to draft a meeting-ready point of view *today*. The thin sources (learnings, competitor/backlinks) are precisely the ones with built-in graceful-degradation fallbacks already in the contracts (`availability` gate, `platformPriors`, banded projections). A reimagined surface can lead with the rich evidence and treat the thin sources as progressive enhancement without inventing any new data.

**Key pointers:**
- shared/types/recommendations.ts — Recommendation, OpportunityScore, OpportunityComponent (with .evidence one-liners), RecommendationSet.summary (topOpportunityRationale), clientStatus/lifecycle curation axes, RecDiscussionEntry, RecPolicyRegistry
- server/recommendations.ts — loadRecommendations(), generateRecommendations, isActiveRec, computeRecommendationSummary, resolveRecommendationsForChange/ForPageIds/ForPublishedPost, applyLifecycleCarryOver
- server/recommendation-staleness.ts — runSentRecStalenessScan / scanWorkspaceStaleness (derived 'needs attention' nudges, 14-day stale_sent + superseded, never persisted)
- shared/types/analytics.ts — AnalyticsInsight<T>, InsightDataMap (20 insight types incl. ranking_mover, ctr_opportunity, strategy_alignment, anomaly_digest, lost_visibility, milestone_attribution), enrichment fields (strategyAlignment, pipelineStatus)
- shared/types/insights.ts — FeedInsight, StrategySignal, PipelineSignal (feedback-loop bridges from insights → strategy/content)
- shared/types/intelligence.ts — SeoContextSlice (backlinkProfile, competitorSnapshots, topicClusters, cannibalizationIssues, keywordGaps, topOpportunity), InsightsSlice (countsByType/bySeverity), LearningsSlice (availability gate, platformPriors, playbooks, topWins), ClientSignalsSlice (keywordFeedback.patterns, effectiveBusinessPriorities), SiteHealthSlice, RankTrackingSummary
- shared/types/keyword-strategy.ts — StoredKeywordStrategy (the unified assembler read: pageMap, contentGaps, quickWins, keywordGaps, topicClusters, cannibalization, opportunitiesDetailed)
- shared/types/keyword-strategy-ux.ts — OrientMetrics (visibilityScore + deltas), KeywordStrategyDiff + KeywordStrategyRefreshSummary ('What Changed'), KeywordStrategyExplanation (per-keyword why + outcome readback + valueReasons + currentMonthly/upsideMonthly)
- shared/types/strategy-keyword-set.ts + server/db/migrations/139-strategy-keyword-set.sql + server/domains/strategy/managed-keyword-set.ts — the curated working set (keptAt/removedAt/source), regen-safe (sole writer is the reconciler)
- shared/types/workspace.ts — PageKeywordMap, ContentGap, QuickWin, KeywordGapItem, TopicCluster, CannibalizationItem, KeywordStrategy.searchSignals (GSC device/period/country + GA4 organic overview/landing pages)
- shared/types/content-decay.ts — DecayingPage/DecayAnalysis; server/content-decay.ts; GET /api/content-decay/:workspaceId; rendered by DecayingPagesCard (refreshRecommendation narrative currently truncated)
- shared/types/keyword-feedback.ts — AdminKeywordFeedbackListRow (status approved/declined/requested, source, reason, declined_by); keyword_feedback table (migrations 020/091); StrategyMetrics.feedbackNewerThanStrategy
- shared/types/outcome-tracking.ts — TrackedAction, ActionOutcome (7/30/60/90d, attributedValue), OutcomeReadback, WorkspaceLearnings (Content/Strategy/Technical/Overall sub-models with winRate/sweetSpot/bestTopics), ActionPlaybook
- shared/types/competitor-gaps.ts — ClientCompetitorGap (client-safe banded projection); server/competitor-gaps-projection.ts; competitor_snapshots table (migration 070) + competitor-snapshot-store.ts (share-of-voice)
- server/db/migrations/030-strategy-history.sql (+119 FK) — strategy_history; server/keyword-strategy-persistence.ts:snapshotStrategyHistory
- server/intelligence-recompute-job.ts — daily cron + on-mutation + manual 'Recompute now' (flag signal-auto-recompute); drives 'Computed X ago' freshness
- src/components/strategy/ — StrategyCockpit.tsx, SiteTargetKeywords.tsx, RankingDistribution.tsx, StrategyRankingsTab.tsx, types.ts (StrategyMetrics derived aggregates: buckets, movements, intentCounts, feedback splits)

---

## What the system can already DRAFT (the key to "system drafts, human curates")

**Bottom line:** The hardest, most expensive half of "system drafts a point of view, operator curates" is **already built and running in production** — just not on the Strategy surface. Three independent draft-generation engines (the **meeting brief**, the **recommendation set**, and the **weekly client briefing**) already read the same evidence base via the intelligence slices and emit plain-English narrative, ranked moves with why→result, and meeting-ready talking points. The Strategy redesign does not need to invent the drafting brain; it needs to **point the existing brain at the Strategy surface and wrap it in a curation UI**. The "system never drafts a point of view" critique is a UI/integration gap, not a capability gap.

### The shared substrate every draft already reads

All generation flows through one facade: `buildWorkspaceIntelligence(workspaceId, { slices: [...] })` (`server/workspace-intelligence.ts`), which assembles typed **slices** (each a `assembleX()` function registered in `server/intelligence/slice-metadata-registry.ts`). Every evidence stream the operator currently reads by eye is already a typed slice:

| Slice | What it assembles (the raw material for a point of view) |
|---|---|
| `seoContext` | Strategy keywords, page map, brand voice, backlink profile, business context |
| `insights` | Open insights ranked by impact (`topByImpact`), `bySeverity`, `countsByType` (incl. `ranking_opportunity`) |
| `clientSignals` | `effectiveBusinessPriorities`, client keyword feedback, engagement, composite health score, briefing summary |
| `siteHealth` | Audit score + delta, decay alerts, cannibalization warnings, CWV, redirects |
| `contentPipeline` | Briefs/posts in flight, `inFlightTargetKeywords` (used to suppress redundant recs) |
| `learnings` | `overallWinRate`, `topWins` with measured deltas ("we called it") |
| `localSeo` | Local market visibility (gated to workspaces with active markets) |

Two prompt-ready entry points sit on top: `buildRecommendationGenerationContext()` and `buildContentGenerationContext()` (`server/intelligence/generation-context-builders.ts`) — they return both the raw `intelligence` object **and** a pre-formatted `promptContext` string plus a `learningsAvailability` signal. Dispatch is unified through `callAI()` (`server/ai.ts`) with a named **operation registry** (`server/ai-operation-registry.ts`) that already contains the relevant operations: `meeting-brief`, `keyword-site-synthesis`, `keyword-recommendation-rank`, `diagnostic-root-causes`, `content-decay`. `callAI` supports `researchMode` (factual-grounding instructions) and JSON `responseFormat`.

### (a) Plain-English situation summary — EXISTS, production-grade

`server/meeting-brief-generator.ts` already does exactly this. `generateMeetingBrief(workspaceId)`:
- Reads `['seoContext','insights','learnings','siteHealth','contentPipeline','clientSignals']` (+ localSeo when active).
- Calls `callAI({ operation: 'meeting-brief' })` (gpt-5.4, temp 0.3) with a system prompt that explicitly bans admin jargon ("no 'insight', 'severity', 'impact score'"), demands named pages/queries/percentages, and "wins before challenges."
- Returns a typed `MeetingBrief` (`shared/types/meeting-brief.ts`) with a **`situationSummary`** ("2-3 sentence narrative of the site's current state and momentum"), plus `wins[]`, `attention[]`, and an AI-free `metrics` block (site health, open ranking opportunities, content-in-pipeline, win rate, critical issues — assembled directly from slices in `assembleMeetingBriefMetrics()`, never hallucinated).
- Is **content-hash cached** (`buildPromptHash`) so it only re-runs when the underlying evidence — including the top recommendation's tier — actually changes.

A second, fully-deterministic one-liner already exists too: `generateIssueSummary()` in `server/briefing-summary.ts` produces "A win at the top, two risks to watch, seven opportunities to consider." from typed story categories with **no AI at all**.

### (b) Ranked recommended moves with why → projected-result — EXISTS, this IS the rec set

`generateRecommendations(workspaceId)` in `server/recommendations.ts` (142 KB, the single largest mint path) already produces the ranked point of view. Each `Recommendation` (`shared/types/recommendations.ts`) carries every field a "drafted move" needs:
- `title` + `description` (the move), `insight` = **"human-readable 'why this matters'"**, `estimatedGain` = **human-readable projected result** ("Fixing this could increase organic clicks by …").
- A canonical **`opportunity` (OpportunityScore)** with per-dimension `components[]`, each carrying an `evidence` one-liner ("the advisor recites verbatim") — i.e. machine-generated why→result rationale already exists per move.
- Ranking via `priority` tier (`fix_now`/`fix_soon`/`fix_later`/`ongoing`) and `impactScore` derived from Opportunity Value; `summary.topRecommendationId` + `summary.topOpportunityRationale` already name the **#1 move and why**.
- Recs are minted from **every evidence stream** the operator reads: audit findings, decay, cannibalization, content gaps, ranking opportunities, competitor, local (`auditInsight()` + the per-branch mint blocks).
- A **two-axis curation lifecycle already exists in the data model**: `clientStatus` (system→curated→sent→approved/declined/discussing) + `lifecycle` (active/throttled/struck). The "system drafts (clientStatus:'system'), human curates (→'curated'), sends (→'sent')" state machine is **already specced and persisted** — this is the exact "system drafts, human curates" contract the redesign wants, already wired at the type/DB layer.

The frontend even has the presenter for it: `WhyHowResult.tsx` renders the why → how → projected-result triad and exports an `isSendable()` gate (why + result both present). **Walkthrough item [7] confirms it works but is rendered in truncated/compact mode** — the artifact exists; it's mis-displayed, not missing.

### (c) Client-meeting talking points — EXISTS in two forms

1. **Meeting brief** (above): `wins[]` + `attention[]` + `recommendations[]` (each `{action, rationale}`) is literally a meeting talking-points list, jargon-stripped and client-safe. Rendered today at `src/components/admin/MeetingBrief/MeetingBriefPage.tsx` (`AtAGlanceStrip` + `RecommendationsList`) — but on the **Workspace Home / "Meeting Brief" tab, NOT on Strategy**.
2. **Weekly client briefing** — a fuller "system-drafted editorial point of view" pipeline: `server/briefing-templates/*` (one deterministic template per evidence type: content-gap, decay, cannibalization, competitor-alert, ranking-mover, ctr-opportunity, we-called-it, etc.) emit typed `BriefingStory` objects (`category`: win/risk/opportunity/competitive/period_change, `isHeadline`, 5-12 word `headline`, 1-3 sentence `narrative`, `metrics`, `dataReceipt` citation, `sourceRefs` traceability). A cron (`server/briefing-cron.ts`) auto-drafts these weekly; optional AI passes (`briefing-prompt.ts`) punch the hero headline and write a premium "letter from the editor." Critically, there is **already a draft → approved → published → skipped curation flow** with an `adminNote` field (`BriefingDraft` in `shared/types/briefing.ts`, reviewed in `src/components/admin/BriefingReviewQueue.tsx`). **This is the closest existing analog to the target "system drafts a point of view, operator curates, then it ships" model — it just lives in the client-briefing track, not Strategy.**

### What exists vs what is net-new

**Already exists (reusable as-is or with light adaptation):**
- The full intelligence read layer (all slices the operator reads by eye are typed and queryable).
- AI dispatch + operation registry + research-mode grounding.
- Three independent draft generators: situation summary + wins/attention + recommended actions (meeting-brief), ranked moves with why→result (recommendation set), and an editorial story-based point of view with a curation/approval flow (weekly briefing).
- The two-axis **curation lifecycle** (system→curated→sent) at the type + DB level for recommendations.
- The why→how→projected-result presenter component (`WhyHowResult`) and `isSendable` gate.

**Net-new (the actual work for the redesign):**
1. **Wiring, not generation.** None of the three draft engines is mounted on the Strategy surface; Strategy still renders raw slice sections (`StrategyCockpit` reads the rec list directly with no synthesized top-of-page narrative). The net-new work is a **Strategy-scoped "drafted point of view" view** that calls `generateMeetingBrief()` / `loadRecommendations()` (already content-hash cached) and renders the situation summary + ranked moves + talking points at the top of the page.
2. **A unified "Strategy draft" artifact.** Today the three drafts are separate (brief vs rec set vs weekly briefing). A reimagined surface likely wants ONE artifact that fuses: situation summary (from meeting-brief) + ranked curated moves (from rec set, with the existing clientStatus lifecycle as the curation axis) + meeting talking points — produced as a first draft the operator edits/reorders/cuts.
3. **Curation UX on Strategy.** The `BriefingReviewQueue` draft→approve→publish + adminNote pattern is the proven template, but it isn't applied to the rec set on Strategy. The cockpit's curation controls exist but are input-panel-shaped (walkthrough [3]/[4]/[5] — sort broken, no cap, button-not-checkbox); they need to be re-cast as "curate the draft" affordances.
4. **Strategy-specific generation context.** `buildRecommendationGenerationContext()` exists, but there is **no `buildStrategyDraftContext()` / no `strategy-point-of-view` operation** in the registry that fuses meeting-brief narrative + rec ranking + talking points into one call. That fusion (or an orchestrator over the existing three) is the one genuinely new server-side piece — and it's an assembly job over existing parts, not a new model capability.

**Net:** the system can already draft (a), (b), and (c) today with current plumbing. The redesign's "system drafts, human curates" thesis is roughly **70% built** — the generators, the grounded evidence, the why→result rationale, the curation lifecycle, and a proven draft→approve→publish flow all exist. The missing 30% is **integration + a single fused Strategy artifact + a curation-first UI**, not new AI capability.

**Key pointers:**
- server/meeting-brief-generator.ts — generateMeetingBrief(): AI-drafted client-safe situationSummary + wins[] + attention[] + recommendations[{action,rationale}] + AI-free metrics; content-hash cached. This IS a working (a)+(c) draft engine, mounted on Workspace Home, NOT Strategy.
- shared/types/meeting-brief.ts — MeetingBrief / MeetingBriefAIOutput shape (the talking-points artifact).
- server/recommendations.ts — generateRecommendations() + auditInsight(); each Recommendation carries insight ('why this matters'), estimatedGain (projected result), and opportunity.components[].evidence (per-dimension why). This IS the ranked-moves draft (b).
- shared/types/recommendations.ts — Recommendation.clientStatus (system→curated→sent→approved/declined/discussing) + lifecycle (active/throttled/struck): the 'system drafts, human curates, sends' state machine ALREADY in the data model. summary.topRecommendationId + topOpportunityRationale name the #1 move + why.
- server/workspace-intelligence.ts — buildWorkspaceIntelligence() facade + buildIntelPrompt(); the single read layer all drafts consume.
- server/intelligence/generation-context-builders.ts — buildRecommendationGenerationContext() / buildContentGenerationContext(): return raw intelligence + pre-formatted promptContext + learningsAvailability. No buildStrategyDraftContext() exists yet (net-new).
- server/ai.ts (callAI dispatcher, researchMode grounding) + server/ai-operation-registry.ts — registered ops include 'meeting-brief', 'keyword-site-synthesis', 'keyword-recommendation-rank', 'diagnostic-root-causes'. No 'strategy-point-of-view' fusion op exists (net-new).
- server/briefing-templates/* + server/briefing-cron.ts + shared/types/briefing.ts (BriefingStory category=win/risk/opportunity/competitive, isHeadline, narrative, dataReceipt) + src/components/admin/BriefingReviewQueue.tsx — the weekly client briefing: a fully-built system-drafts-a-point-of-view pipeline WITH a draft→approved→published→skipped curation flow + adminNote. The proven curation-UI template, living in the client-briefing track, not Strategy.
- server/briefing-summary.ts — generateIssueSummary(): deterministic (no-AI) one-line situation summary from typed story categories.
- src/components/strategy/shared/WhyHowResult.tsx — why→how→projected-result presenter + isSendable() gate (why + result present). Confirmed working but rendered truncated/compact in DecayingPagesCard (walkthrough [7]).
- src/components/strategy/StrategyCockpit.tsx — current Strategy surface: reads the raw Recommendation[] list directly via useRecBulkMutation/useCurationSelection; renders sections, NO synthesized top-of-page situation summary or fused draft. This is where a drafted-point-of-view view would mount.
- src/components/admin/MeetingBrief/MeetingBriefPage.tsx (AtAGlanceStrip, RecommendationsList) + src/components/WorkspaceHome.tsx:54 ('meeting-brief' tab) — where the existing brief draft renders today (Workspace Home), proving the render-side exists but is off-Strategy.

---

## Downstream — Where the Recommendations Flow

The Strategy surface produces recommendations that are supposed to feed four destinations off **one** curated artifact. Today they feed **four disconnected artifacts**, and the most important downstream path (the curated client feed, keystone #12c) is a **write-only dead end** — the operator's "Send to client" mutates a `clientStatus` axis that **no client-facing component reads**. This is the structural reason the redesign feels like rearrangement: the surface emits curation signals into the void instead of into a single object that simultaneously becomes the meeting brief, the client feed, the content plan, and the keyword targets.

### The core data object: `Recommendation` and its two-axis lifecycle

`shared/types/recommendations.ts` defines the `Recommendation` with a deliberately separated **two-axis model** (Strategy v3, spec §6):
- **Internal triage axis** — `status: 'pending' | 'in_progress' | 'completed' | 'dismissed'` (the admin's "we'll do it / it's done" axis).
- **Client-facing curation axis** — `clientStatus: 'system' → 'curated' → 'sent' → 'approved' | 'declined' | 'discussing'` PLUS a suppression axis `lifecycle: 'active' | 'throttled' | 'struck'`.

The single writer for the curation axis is `server/recommendation-lifecycle.ts` (`sendRecommendation`, `strikeRecommendation`, `throttleRecommendation`, `unstrikeRecommendation`, `fixRecommendation`). Routing per `RecType` is governed by `REC_POLICY_REGISTRY` (`sendChannel: 'rec' | 'deliverable'`, `cascadeOnStrike`, `monetizable`). **This is the most important concept for the redesign**: the data model already supports "operator curates a point of view." The plumbing to *deliver* that point of view to the client is the missing half.

---

### (1) The CLIENT dashboard — what exists vs. the #12c 3-layer keystone

**What the client currently sees** (`src/components/client/StrategyTab.tsx` + `src/components/client/strategy/*` + `src/components/client/InsightsEngine.tsx`):

- A **command-center tab layout** mirroring the admin: `Overview | Content | Rankings | Competitive` (`CLIENT_STRATEGY_TABS`).
- **Layer-1-ish (data):** `StrategyClientOrientHeader` — a visibility-score ring + narrative verdict + a 4-stat strip (clicks/impressions/ranked keywords/avg position with deltas). Warm, jargon-free, no purple. This is the closest thing to "Layer 1 — the data," and it's well-built.
- **A recommendations list** (`InsightsEngine`) that reads `GET /api/public/recommendations/:workspaceId` and **groups recs by `priority`** (`fix_now/fix_soon/fix_later/ongoing`), excluding `dismissed`. The client can mark a rec `in_progress`/`completed`/`dismissed` via `PATCH /api/public/recommendations/:workspaceId/:recId`.
- Keyword feedback (`StrategyKeywordsSection`, relevant/not-relevant + add/decline), content opportunities (`StrategyContentOpportunitiesSection`), page improvements, competitor gaps.

**The keystone gap (#12c — NOT built), confirmed at the data layer:**

The owner's vision is the client dashboard as a **3-layer system: data → system observations → agency-curated recommendations.** Only Layer 1 (data) and a raw, un-curated Layer 3 exist. Critically:

| Symptom | Evidence |
|---|---|
| Client sees the **raw rec set**, not the curated subset | `GET /api/public/recommendations` (`server/routes/recommendations.ts:170`) filters **only** by internal `status` and `priority`. It does **NOT** filter to `clientStatus === 'sent'`. |
| "Send to client" is **write-only** for `sendChannel: 'rec'` recs | `sendRecommendation` sets `clientStatus='sent'` + `sentAt`, fires a doorbell email (`notifyClientCuratedRecsSent`) pointing at a "curated hub"… that hub doesn't exist. `InsightsEngine` ignores `clientStatus` entirely. |
| No "system observations" layer (Layer 2) | Nothing renders `rec.insight` ("why this matters") as a distinct narrative tier; `rec.opportunity.components[].evidence` (the self-describing "why" strings) are computed but unsurfaced client-side. |
| Discussion thread half-built | `RecDiscussionEntry` (`author: 'client' | 'strategist'`, migration 138) + `addRecDiscussionEntry` exist on send; the client-side `CuratedRecDiscussThread` (P4) is referenced in the type JSDoc but not shipped. |

So the admin's whole curation vocabulary (curate/send/strike/throttle/discuss) currently changes **nothing the client sees** unless the rec happens to route through the deliverable channel (see §3). **This is the single highest-leverage thing for the designer to fix**: make the client dashboard's recommendation layer read the *curated/sent* projection (filter `clientStatus`), render `insight` as a "what we noticed" observation tier, and render the agency's curated cards + discussion as Layer 3.

---

### (2) The CONTENT pipeline — how a rec/gap becomes a brief → post

A content recommendation becomes a brief via the **`fixContext` navigation-state handoff** — a React Router `state` object passed on `navigate()`, not a server entity. The canonical example is `src/components/strategy/ContentGaps.tsx` ("Draft Brief" / "Generate Brief" buttons):

```
navigate(adminPath(workspaceId, 'content-pipeline'), {
  state: { fixContext: {
    targetRoute: 'content-pipeline', primaryKeyword: gap.targetKeyword,
    pageType, autoGenerate: true, rationale, competitorProof, volume,
    intent, questionKeywords, serpFeatures } } })
```

- **Pre-seed payload:** the strategy card carries its full computed context (`rationale`, `competitorProof`, `volume`, `intent`, `questionKeywords`, `serpFeatures`) so the brief generator references it without re-fetching. This shape aligns with `StrategyCardContext` in `shared/types/content.ts`.
- **Receiver:** `src/components/ContentPipeline.tsx` / `ContentBriefs.tsx` read `fixContext` (guarded by `targetRoute` / `BRIEF_ROUTES` so stale context from other tabs is ignored) and auto-trigger generation when `autoGenerate: true`. `useSeoEditorSessionState.ts` does the same for the `seo-editor` target (matches a page by normalized path). `CannibalizationTriage` and `DecayingPagesCard` also emit `fixContext` (to `seo-editor` and `content-pipeline`/`seo-briefs` respectively).
- **Server brief generation:** `server/content-brief.ts` (via `buildContentGenerationContext` + `buildSystemPrompt`); the brief then flows brief → post through the standard content pipeline.
- **The MCP / server-side equivalent:** `mcp__hmpsn-studio__prepare_brief_context` + `create_content_request` exist for the programmatic path.

**The gap for the 4-jobs vision:** this handoff is a **per-card, ephemeral, client-side jump** — the rec's content intent lives only in router state for one navigation. There is no durable link from a *curated/sent* recommendation to a brief; the content plan and the curated rec set are not the same object. A `content`-type rec that's been curated, sent, and approved by the client does not auto-create or pre-seed a brief — the operator must manually click "Draft Brief" from a *different* surface.

---

### (3) The send-to-client mechanism — clientActions, deliverables, the decision adapter, inbox + response

There are **two parallel send spines**, and which one a rec uses depends on `REC_POLICY_REGISTRY[rec.type].sendChannel`:

**Spine A — `sendChannel: 'rec'` (most RecTypes: content, schema, technical, keyword_gap, topic_cluster, strategy, competitor, local_*)**
- `sendRecommendation` flips `clientStatus → 'sent'`, broadcasts `RECOMMENDATIONS_UPDATED`, emails the client.
- **Dead end (as in §1):** no decision adapter exists for a `recommendation` source. `src/lib/decision-adapters.ts` adapts `client_action`, `approval_batch`, and unified `deliverable` rows into `NormalizedDecision` — there is **no `normalizeRecommendation`**. So a sent rec never becomes a client **inbox** item and never appears in `DecisionCard`/`DecisionDetailModal`. The client can only encounter it as an undifferentiated row in `InsightsEngine` (which doesn't even filter on `sent`).

**Spine B — `sendChannel: 'deliverable'` (cannibalization, content_decay)**
- These route to the **unified send-to-client deliverable spine**, the real, working inbox path. `mirrorClientActionToDeliverable` (`server/domains/inbox/client-action-dual-write.ts`) mirrors a `client_action` into a `ClientDeliverable` (`shared/types/client-deliverable.ts`) via a per-type **deliverable adapter** (`server/domains/inbox/deliverable-adapters/*` — `cannibalization.ts`, `content-decay.ts`, etc.), born `awaiting_client`, broadcasting `DELIVERABLE_SENT`.
- **Client inbox render:** `GET /api/public/deliverables/:workspaceId` → `normalizeDeliverable()` → `NormalizedDecision` (`shared/types/decision.ts`). `kind === 'decision'` ⇒ `isSingleAction: true` (inline approve/flag in the Inbox Decisions section); otherwise an entry-point card opening `DecisionDetailModal`. Inbox section routing (Decisions vs Conversations vs Reviews) per `docs/rules/inbox-section-routing.md`.
- **Client response closes the loop:** `PATCH /api/public/deliverables/:workspaceId/:id/respond` (`server/routes/deliverables.ts`) with `decision: 'approved' | 'changes_requested' | 'declined'` → `respondToDeliverable`; optional `POST .../apply`.

**Net:** the **only** recommendations that actually complete the round-trip (admin sends → client sees in inbox → client approves/declines → status flows back) are the two deliverable-channel types. Every other curated rec is sent into a `clientStatus` axis with no reader. The designer should treat the **deliverable spine as the proven delivery substrate** and decide whether `sendChannel: 'rec'` recs should also flow through it (giving them a real inbox presence + response loop) rather than the orphaned `clientStatus`-only path.

---

### (4) The fourth job — the Meeting Brief is a *separate* artifact, not the curated set

The owner's north-star ("pop in, understand the lay of the land, prepare for a client meeting") has a literal artifact today: `server/meeting-brief-generator.ts` → `MeetingBriefPage.tsx` (`shared/types/meeting-brief.ts`). **But it's disconnected from curation:** it is an independent AI call built from `buildWorkspaceIntelligence()` slices + `loadRecommendations()` (it reads the *top* rec, not the *curated/sent* set), producing its own `situationSummary / wins / attention / recommendations[] / blueprintProgress`. The operator's curate/send/strike decisions do **not** shape the meeting brief, and the meeting brief's recommendations are not the same objects the client receives.

### The unification opportunity (one curated set → four outputs)

All four destinations already key off the same `Recommendation` rows — they're just read through four divergent paths:

| Job | Reads today | Should read |
|---|---|---|
| **Meeting brief** | independent AI call over intelligence + top rec | the operator's **curated/sent** rec set + their notes |
| **Client feed** | raw rec set by `priority`, ignores `clientStatus` | the **`clientStatus:'sent'`** projection, as 3 layers |
| **Content plan** | ephemeral `fixContext` per card | durable rec→brief link from curated content recs |
| **Keyword targets** | managed keyword set / feedback (separate store) | curated keyword/topic recs (already same rec rows via `keyword_gap`/`topic_cluster` types + `cascadeOnStrike`) |

The bones exist (two-axis lifecycle, single writer, policy registry, deliverable spine, `insight`/`opportunity.components` narrative fields, `fixContext` pre-seed shape). What's missing is making **one curated recommendation set** the shared source object that simultaneously projects into all four — which is exactly the "system drafts a point of view, operator curates, output is the meeting brief AND the client feed AND the content plan AND the keyword targets" reframe.

**Key pointers:**
- shared/types/recommendations.ts — `Recommendation` two-axis model: internal `status` vs client-facing `clientStatus` ('system'→'curated'→'sent'→'approved'/'declined'/'discussing') + `lifecycle` ('active'/'throttled'/'struck'); `RecPolicyRegistry`; `RecDiscussionEntry`; `StrategyRecommendationPayload`
- server/recommendation-lifecycle.ts — SINGLE WRITER for the curation axis: `sendRecommendation`, `strikeRecommendation`, `throttleRecommendation`, `unstrikeRecommendation`, `fixRecommendation`; `REC_POLICY_REGISTRY` maps each RecType to `sendChannel: 'rec' | 'deliverable'`
- server/routes/recommendations.ts — `PATCH /:recId/send|strike|throttle|fix`; CRITICAL: `GET /api/public/recommendations/:workspaceId` (line 170) filters only by internal `status`+`priority`, NOT `clientStatus` — sent recs are invisible to the client read path
- src/components/client/InsightsEngine.tsx — the client recommendation surface; reads `/api/public/recommendations`, groups by `priority`, ignores `clientStatus`. No 3-layer (data→observations→curated) structure. This is the #12c keystone gap.
- src/components/client/StrategyTab.tsx + src/components/client/strategy/StrategyClientOrientHeader.tsx — client command-center; OrientHeader is the existing 'Layer 1 (data)' (visibility ring + stat strip)
- src/lib/decision-adapters.ts — adapts client_action / approval_batch / deliverable → NormalizedDecision. NO `recommendation` adapter exists, so `sendChannel:'rec'` recs never become inbox items
- server/domains/inbox/client-action-dual-write.ts (`mirrorClientActionToDeliverable`) + server/domains/inbox/deliverable-adapters/* (cannibalization.ts, content-decay.ts) — the WORKING send spine; only `sendChannel:'deliverable'` recs (cannibalization/content_decay) reach the client inbox
- server/routes/deliverables.ts — `PATCH /api/public/deliverables/:workspaceId/:id/respond` (decision: approved/changes_requested/declined) → `respondToDeliverable`; the only path that closes the admin→client→response loop
- shared/types/decision.ts (`NormalizedDecision`, `kind`, `isSingleAction`) + shared/types/client-deliverable.ts (`ClientDeliverable`, DELIVERABLE_TYPES/KINDS/STATUSES) — the unified inbox contract
- src/components/strategy/ContentGaps.tsx — canonical rec→brief handoff via `fixContext` navigation state (Draft Brief/Generate Brief); also CannibalizationTriage.tsx + DecayingPagesCard.tsx emit fixContext to seo-editor/content-pipeline
- src/components/ContentBriefs.tsx + ContentPipeline.tsx + src/components/editor/useSeoEditorSessionState.ts — `fixContext` receivers (guarded by targetRoute/BRIEF_ROUTES, autoGenerate); shared/types/content.ts `StrategyCardContext` is the pre-seed shape
- server/content-brief.ts — server brief generation (buildContentGenerationContext + buildSystemPrompt); MCP equivalents `prepare_brief_context` + `create_content_request`
- server/meeting-brief-generator.ts + src/components/admin/MeetingBrief/MeetingBriefPage.tsx + shared/types/meeting-brief.ts — the meeting-brief artifact is a SEPARATE AI call over intelligence slices + top rec; NOT derived from the curated/sent rec set (the disconnect to fix for job #1)

---

# External Patterns + Inspiration — How the Best Tools Solve "Turn a Pile of Signals Into a Decision-Ready, Curatable Point of View"

> **The core critique to design against:** the redesign "rearranged, didn't reimagine — the operator's job was never changed from assembling a dashboard to curating a system-drafted point of view." Every pattern below is chosen because the product *already made that flip*. They don't show the operator a wall of co-equal inputs; the system reads the evidence, **drafts a position**, and the human's job becomes **curate / edit / approve / send** — exactly the four-jobs reframe (meeting prep · client-dashboard source · content direction · keyword targets). Read this section as a menu of *how other people moved the operator up the value chain*, not as feature requests.

---

## Category 1 — SEO/content platforms: from "report" to "prioritized action plan"

The whole industry has already abandoned the dashboard-of-inputs model. The leading tools converge on **one prioritized list of recommended moves**, each pre-scored, each with a rationale.

**Semrush Copilot** — synthesizes data across six tools into *one* prioritized, dashboard-level "action plan." The explicit framing in their own marketing: *"Rather than overwhelming users with data, you receive a clear, prioritized action plan."* It compiles a custom strategy and hands you a ranked list of activities. This is the exact opposite of the current Strategy page (sections of inputs the human must synthesize). **Translation:** the operator should open Strategy to a *single ranked queue of "what to do for this client this cycle,"* not five parallel signal panels.

**MarketMuse** — prioritizes content opportunities on **two named axes the operator can reason about: Authority and ROI**, plus a "Competitive Advantage Metric" (the gap between *general* difficulty and *this client's personalized* difficulty — surfacing topics where the client structurally punches above its weight). It outputs a **Content Plan with a recommended *count* of items to create vs. update** and the exact pages/topics. **Translation:** don't make the operator infer priority from raw volume + KD (item [8a]); compute a defensible "why this one, why now, why it's winnable *for this client specifically*" score, and present the plan as "create N, refresh M" rather than an undifferentiated list.

**Ahrefs Opportunities / "low-hanging fruit"** — pre-filters the entire signal pile into **named opportunity archetypes**: "position 2–8 with a featured snippet you don't own," "page-one refresh candidates," "content-gap quick wins." Each archetype bundles impact + effort framing ("low-KD ranks in 4–6 weeks"). **Translation:** instead of one flat "197 recommendations" list (items [3][5]), group the draft into a handful of *operator-legible archetypes* ("Quick wins," "Refresh & reclaim," "Defend cannibalized pages," "New authority bets") — far easier to curate and to narrate in a client meeting.

**Clearscope (the curation model done right)** — its content workflow is the cleanest "draft → human curates" loop in the space: AI generates the outline, then *"users review and tailor the AI-generated outline — edit or remove headings, rearrange sections, add new headings for fresh themes."* Their own positioning: *"human control at every step — you pick the intent, approve the outline."* **Translation:** this is the literal interaction the Strategy page is missing. The system drafts the recommended set; the operator's primitives are **keep / cut / edit / reorder / add**, and *nothing ships until the human approves*. The current page has the inputs but not this verb set applied to a draft.

---

## Category 2 — BI "insight digest" + decision cockpits: the system narrates, the human reads a story

BI tools solved the "billions of data points → what should I care about" problem years before SEO tools did. Their answer: **proactive, narrated insight digests** — the machine scans, ranks, and *writes the sentence*.

**ThoughtSpot SpotIQ** — *"automatically ask thousands of questions about billions of data points and bring back dozens of insights,"* each one *"accompanied by a smart narrative in natural language explaining what is meaningful."* Crucially it surfaces **drivers** ("the *why* behind a KPI change"), **anomalies**, and **a starting narrative** — and it *"learns as you go"* from user feedback. **Translation:** the operator shouldn't read decay/cannibalization/gaps as raw tables and write the story in their head (the core critique). The system should *pre-write the why → how → result narrative* (items [7][8c]) — and the operator's keep/cut feedback should train future drafts.

**Tableau Pulse** — the strongest analogue to "pop in cold and get oriented." It delivers **personalized metric digests** that *"summarize the most significant changes in plain language,"* **proactively flags drift "before the next reporting cycle,"** auto-detects **hidden drivers/contributors/outliers**, and lets you **ask follow-up questions** (typed or AI-suggested). It pairs every plain-language insight with a viz. **Translation:** this is the north-star [8c] made literal — *"understand the lay of the land"* = a Pulse-style top-of-page digest ("Here's what changed for Faros since last cycle, here's what's at risk, here's the one thing to talk about") *before* any controls. Proactive drift detection maps directly onto decay + ranking-loss surfacing.

**Power BI Smart Narratives / Narrative Science Quill** — auto-generate **editable** natural-language summaries of a dataset; the key property is *"users can customize the generated text to match their audience's needs."* The narrative is a **first draft you edit**, not a fixed caption. **Translation:** the meeting-prep artifact (job #1) should be a *generated, editable narrative* the operator tightens before walking into the room — and the same narrative, post-edit, becomes the client-dashboard copy (job #2). One artifact, two audiences, human-tuned in the middle.

---

## Category 3 — AI "draft → human curates/approves" products: the interaction grammar

This is the category that names the exact UX the Strategy page needs. The recurring, battle-tested pattern:

**The suggestion-mode ladder** (from AI UX pattern literature): *AI proposes → human decides*, with a deliberate progression — "AI suggests draft → user edits and sends → user approves AI sends → AI sends with review period → AI sends automatically." Trust is earned in stages; forcing automation before trust exists causes abandonment. **Translation:** the Strategy surface should launch at rung 1–2 (system drafts the recommendation set, human curates and sends), with an explicit path to "auto-approve the obvious quick wins later." Don't over-automate the send; *do* automate the drafting.

**The review-queue speed law:** *"Review queues that take more than 60 seconds per item won't be used consistently. Show the AI output, the key decision points, and a clear approve/reject/edit interface."* **Translation:** this is a direct indictment of the current cockpit — 197 uncapped rows [5], unlabeled icon actions [8b], a sort that doesn't sort [3], a mid-list select-all [4]. Curation must be *fast and unambiguous per item*: one glance → keep / cut / edit / send. Cap the queue, label every action, make the primary verb obvious.

**Confidence + provenance display:** mature draft-then-approve tools show *why* the AI proposed each item and *how sure* it is, with progressive disclosure (summary first, evidence on demand). **Translation:** every drafted rec needs a one-line "because" (the evidence that generated it) the operator can expand — both to trust it and to *say it out loud in the meeting*. This is the why→how→result [7] rendered as a confidence-bearing rationale, not a truncated line.

---

## Category 4 — Sales/CS account-briefing + meeting-prep generators: the "walk in fully briefed" pattern

This category is the *closest behavioral match* to the north-star ("pop in, understand the lay of the land, prepare for a client meeting"). These tools exist *solely* to compress a pile of signals into a meeting-ready brief — and they're a goldmine of structure.

**Gong AI Briefer** — generates **structured briefs that unify conversations, emails, web data, and CRM** for a chosen purpose: *"preparing for a meeting, reviewing deal status, onboarding."* Same underlying data, **different brief per intent**, via **admin-defined templates** ("Account Health," "Post-Sales"). Pre-meeting, the rep gets *"key topics, action items, and tailored questions based on the upcoming meeting and your role."* **Translation:** the Strategy "draft" should be **intent-templated** — a *"client QBR prep"* view, a *"content-pipeline feed"* view, a *"keyword-targeting"* view — all rendered from the *same* curated recommendation set (the four jobs from one artifact). And it should output **questions to ask the client**, not just recommendations to tell them (echoes item [9]'s "interested in this one?" — but generalized to a whole prepared agenda).

**Cirrus Insight / general meeting-prep agents** — deliver *"a concise, actionable research digest for every meeting: key contacts, relationship history, company overview, and recommended talking points,"* arriving **automatically before the call** in the channels you already use. The pitch: a brief that *"would take 20–30 minutes to create manually in under 2 minutes."* **Translation:** the win condition is **time-to-prepared**. The Strategy page should be measured by "how fast can an operator who's never seen this client walk in ready" — and ideally the brief is *pushed* (pre-generated each cycle / before a scheduled client meeting), not pulled.

**Microsoft Executive Briefing Agent (template pattern):** a reusable *agent template* that assembles a briefing from connected sources on a schedule. **Translation:** "draft the point of view" can be a **scheduled background job** (the platform already has the job system) that pre-bakes each client's briefing so the operator opens to a *fresh, ready draft* rather than triggering a slow generation on arrival.

---

## Category 5 — Editorial curation surfaces: digest + accept/dismiss as a first-class loop

**Notion AI digests** — auto-populate a database field with *"summaries, status labels, or key points"* and compile *"repeatable reporting (weekly/quarterly) from templates,"* e.g. an Incident Digest that ends with *"patterns across incidents and preventative actions linked to each."* **Translation:** the recommendation set is a recurring, templated digest — *"this cycle's Faros strategy brief,"* regenerated each period, with the operator's edits carried forward, ending (like the incident digest) in **synthesized patterns + the one recommended focus**, not just a list of atoms.

---

## Design seeds — "What if the Strategy surface were like ___?"

Provocations to free the designer while staying grounded in the four jobs and the north-star:

1. **What if Strategy opened like Tableau Pulse — not a page of controls, but a narrated digest?** Top of page: *"Since last cycle, Faros lost 3 keywords to cannibalization, 2 pages are decaying, and there's 1 quick win worth ~X traffic. Here's the point of view I'd bring to the meeting."* Controls live *below* the story, for when you want to dig. Orientation is the default state; curation is the next click. (Directly answers [1], [8c].)

2. **What if the operator's job were Clearscope's outline editor — but for the whole client strategy?** The system drafts the ranked recommendation set; the only verbs on screen are **keep / cut / edit the rationale / reorder / add one I'm missing**. Nothing is a "section to read" — everything is a *draft line you accept or reject*. The page is a curation queue, not a dashboard. (Answers the core critique + [3][4][5][6].)

3. **What if Strategy generated a Gong-style, intent-templated client brief from one curated set?** One toggle re-renders the *same* approved recommendations as a **QBR talking-points deck**, a **content-pipeline work order**, a **keyword-target list**, or the **client-dashboard view** — four jobs, one artifact, four output skins. The operator curates once; the platform fans out. (Answers jobs #1–#4 unification.)

4. **What if every recommendation carried a confidence chip and a one-line "because," like a mature draft-then-approve tool?** Expandable to the full why → how → result + the raw evidence (the decaying page, the cannibalization pair, the competitor gap). The operator skims confidence to triage fast (<60s/item), expands only the ones they'll defend in the meeting. Curation feedback (keep/cut) trains the next draft — SpotIQ's "learns as you go." (Answers [7], [8b], the review-queue speed law.)

5. **What if the brief were *pushed*, pre-baked by a scheduled job, like a meeting-prep agent — and tied to the calendar?** The night before (or on a cron each cycle) the platform regenerates each client's draft point-of-view so the operator opens to a *ready* brief, never a spinner. Bonus: "Faros meeting Thursday → here's your prepared agenda + questions to ask." Win condition = time-to-prepared, not features-on-page. (Answers the north-star + scheduled-job platform fit.)

6. **What if Strategy graded itself like MarketMuse — "create N, refresh M, defend K" — instead of listing 197 atoms?** The headline is the *shape of the plan* ("this cycle: 4 new authority bets, 3 refreshes, 2 cannibalization fixes"), each archetype a named, collapsible bucket (Ahrefs-style). The operator curates within archetypes; the client meeting narrative writes itself from the archetype counts. (Answers [5] overload, [8a] right-data, [10] orient-then-act ordering.)

> **Through-line:** every leading product moved the human *up the stack* — from "assemble and synthesize the inputs" to "curate and approve a system-drafted position." The components to do this already exist in the codebase (the critique's own finding: the parts were built, the *integration into a drafting-then-curating surface* is what's missing). The external pattern says the missing piece isn't another control — it's a **first-class generated draft** plus a **fast, unambiguous curation grammar** sitting on top of it.

**Key pointers:**
- Semrush Copilot — prioritized 'action plan' over data dump: https://www.semrush.com/blog/top-ai-powered-semrush-features/ and https://www.resultfirst.com/blog/ai-seo/how-can-semrush-copilot-ai-assistant-improve-seo-strategy/
- MarketMuse — Authority/ROI prioritization + Competitive Advantage Metric + 'create vs update' content plan: https://www.marketmuse.com/content-planning/ and https://blog.marketmuse.com/what-content-should-i-optimize/ and https://www.marketingaiinstitute.com/blog/marketmuse-spotlight
- Ahrefs — named opportunity archetypes / low-hanging-fruit (pos 2-8, featured-snippet, page-one refresh) + impact/effort framing: https://ahrefs.com/blog/low-hanging-fruit-seo and https://searchatlas.com/blog/ahrefs-features/
- Clearscope — canonical 'AI drafts outline → human edits/removes/rearranges/approves; human control at every step': https://www.clearscope.io/support/draft-with-ai and https://www.clearscope.io/blog/how-to-create-seo-content-brief
- ThoughtSpot SpotIQ — auto-generated insights with natural-language narrative, driver/anomaly detection, 'starting narrative', learns from feedback: https://www.thoughtspot.com/product/analytics/spotiq and https://www.thoughtspot.com/glossary/SpotIQ
- Tableau Pulse — personalized plain-language metric digest, proactive drift detection before next cycle, 'why' drivers, guided follow-up questions: https://www.salesforce.com/analytics/tableau/pulse/ and https://help.tableau.com/current/online/en-us/pulse_insights_platform_insight_types.htm
- Power BI Smart Narratives / Narrative Science Quill — auto-generated, EDITABLE natural-language data narratives (customize text to audience): https://powerbi.microsoft.com/en-us/blog/get-natural-language-narratives-in-power-bi/ and https://medium.com/@mokkup/an-overview-of-the-smart-narrative-visual-in-power-bi-2efa5c72a490
- Gong AI Briefer — intent-templated structured briefs (meeting prep / deal review) unifying calls+email+web+CRM, admin templates, 'topics + action items + tailored questions': https://help.gong.io/docs/understanding-ai-briefer and https://help.gong.io/docs/get-ready-for-meetings-with-ai-powered-meeting-prep
- Cirrus Insight / meeting-prep agents — auto-delivered pre-meeting research digest with recommended talking points; '20-30 min of work in under 2 min': https://www.cirrusinsight.com/features/meeting-ai and https://blog.launchlemonade.app/blog/how-to-use-ai-for-meeting-prep-and-walk-into-every-meeting-fully-briefed/
- Microsoft Executive Briefing Agent template — scheduled briefing-assembly agent pattern: https://learn.microsoft.com/en-us/microsoft-365/copilot/extensibility/agent-template-executive-briefing and roundup https://www.octavehq.com/post/best-ai-tools-for-executive-briefing-preparation-in-2026
- AI draft-then-approve UX laws — suggestion-mode ladder, '<60s per review-queue item', confidence/provenance display, progressive disclosure: https://www.institutepm.com/knowledge-hub/ai-ux-design-patterns
- Notion AI — recurring templated digests, auto-populated summary fields, 'patterns + recommended actions' ending pattern: https://www.notion.com/help/guides/5-ai-prompts-to-surface-fresh-insights-from-your-databases and https://zapier.com/blog/how-to-use-notion-ai/

---
