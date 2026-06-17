# Strategy v2 (SEO Command Center) — Pre-Plan Audit

**Date:** 2026-06-17
**Spec:** `docs/superpowers/specs/2026-06-17-strategy-v2-command-center.md`
**Total components / modules mapped:** 75 distinct entries across 7 scan areas — 27 Strategy leaf components + 5 hooks + 9 support files (Current Surface Inventory), 15 recommendation-engine modules, 9 visibility-score candidates, 14 monetization modules, 15 Rankings/Hub-boundary modules, 16 Competitive-tab modules, 24 client-portal modules, 19 charting modules, 25 data-flow wiring entries (with overlap across scans). The adversarial verifications resolved all 3 spec open questions plus surfaced one omitted pre-existing score (`calculateStrategyHealth`) and two audit-claim corrections.

---

## Reuse / Rebuild Map

Verdict legend: **reuse** = mount as-is, **adapt** = wrapper/composition/prop changes, **rebuild** = significant new logic on an existing concept, **retire** = delete after cutover, **new** = no precedent.

### Orient zone (main page — visibility score + hero trend + 4-stat strip + AI verdict)

| Component / module | path:lines | Current role | v2 verdict | Evidence |
|---|---|---|---|---|
| `MetricRing` / `MetricRingSvg` | `src/components/ui/MetricRing.tsx:1-100` (export `:12-71`, svg `:74-99`) | Animated 0–100 circular gauge; consumes `scoreColor()` at `:17` | **reuse** | Zero UI work for the visibility-score ring; spec mandates "0–100, colored per `scoreColor()` bands". `noAnimation` flag exists for compact use. |
| `scoreColor()` / `scoreColorClass()` | `src/components/ui/constants.ts:9-22` (impl `:11-17`) | ≥80 emerald `#34d399` / ≥60 amber / <60 red | **reuse** | Exactly the spec's banding. No new color logic. |
| `AnnotatedTrendChart` | `src/components/charts/AnnotatedTrendChart.tsx:1-447` (export `:273-447`) | Dual-axis area chart w/ annotations, used in SearchDetail/TrafficDetail | **reuse** | Hero 6-mo organic-clicks trend = pass a single `TrendLine`. Spec: "ONE hero trend chart (organic clicks, 6 mo)". |
| `ChartCard` | `src/components/ui/ChartCard.tsx:1-39` | Chart wrapper w/ title + `TrendBadge` + action slot | **reuse** | Container for the Orient hero chart. |
| `TrendBadge` | `src/components/ui/TrendBadge.tsx:1-61` (export `:22-60`) | Inline delta indicator (up/down/minus) | **reuse** | The 4-stat strip needs a delta per stat. |
| `StatCard` | `src/components/ui/StatCard.tsx` | Stat display primitive (value/label/icon/sub) | **reuse** | Building block for the 4-stat strip and Orient stats. |
| `StrategyStatGrid` | `src/components/strategy/StrategyStatGrid.tsx:1-14` | 4-stat hero grid (no deltas) | **adapt → rebuild** | Two scans disagree on intensity. Inventory scan says **rebuild** Orient zone entirely (`StrategyStatGrid / StrategyStatBar (Orient)` entry); charting scan says **adapt** (rename to `OrientStatStrip`, add `TrendBadge` deltas, reuse `StatCard`). Reconciliation: the *wrapper* is rebuilt (new layout + deltas + visibility score), the *StatCard children* are reused. Flag-OFF keeps `StrategyStatGrid` byte-identical. |
| `StrategyStatBar` | `src/components/strategy/StrategyStatBar.tsx:1-31` | Reference-band compact stat bar (Phase 4c) | **retire** | Phase 4 intermediate; superseded by new Orient stat strip post-cutover. |
| `IntelligenceSummaryCard` | `src/components/client/IntelligenceSummaryCard.tsx:14-81` | Briefs/insights/win-rate counts; tier-gated | **adapt** | Repurpose to show visibility score + delta + ranked-kw + avg-position for client Orient. |
| `StrategyEmptyState` | `src/components/strategy/StrategyEmptyState.tsx:1-17` | "No keyword strategy yet" UI | **reuse** | Pure UI state; Orient zone keeps it. |
| `StrategyHeaderActions` | `src/components/strategy/StrategyHeaderActions.tsx` (lines **unknown** — scan did not read) | Generate / Refresh buttons in PageHeader | **reuse** | Scan flagged "[Need to read this file]"; verdict reuse is tentative pending a read during planning. |
| `StrategyStalenessNudges` | `src/components/strategy/StrategyStalenessNudges.tsx:1-65` | Unvalidated + reverse-staleness warnings | **adapt** | Move to Orient zone; render before the score so data-quality caveat precedes the metric. |
| `useStrategyMetrics` | `src/components/strategy/hooks/useStrategyMetrics.ts:1-89` | Central memoized metrics (pageMap, ranked, top3/10/20, intent, feedback) | **reuse + extend** | Backbone for all zones; must add deltas (Δclicks/Δimpr/Δpos) + visibility score field. Position bands `:28-31`, intentCounts `:39-43`. |
| **Visibility score (0–100)** | N/A — does not exist | net-new top-line metric | **new** | See Open-Question §1. Confirmed absent (grep ZERO matches); build as a pure helper in `server/scoring/`, append to `seoContext.rankTracking.visibilityScore`. |

### Act queue (the hero — single impact-ranked action queue)

| Component / module | path:lines | Current role | v2 verdict | Evidence |
|---|---|---|---|---|
| `DecisionQueue` | `src/components/strategy/DecisionQueue.tsx:1-80` (sort `:20-21`, filter `:47`) | Decide-band hero: top rec + fix_now/fix_soon queue, dedup, sorted by `opportunity.value ?? impactScore` | **adapt** | THE v2 hero. Already prioritized-list-based. Adapt: filter chips (All/Content/Technical/Quick wins), per-row projected impact label, CTA labels (Create brief/cluster/refresh/Fix). |
| `OpportunitiesList` | `src/components/strategy/OpportunitiesList.tsx:1-110` | Act-band merged QuickWins + LHF; Fix CTA → Page Intelligence | **adapt** | Becomes one sub-section of the larger queue; keep its dedup + Fix wiring. |
| `buildOpportunityRows` | `src/components/strategy/buildOpportunityRows.ts:1-41` | Merges quickWins + LHF, dedup by page identity | **adapt** | Extend to merge ALL action types (ContentGaps, Decay, LostQueries, Cannibalization, QuickWins, LHF); add impact-value field; sort by impact. |
| `QuickWins` | `src/components/strategy/QuickWins.tsx:1-47` | Legacy standalone quick-wins card | **retire** | Folds into queue; logic already in `buildOpportunityRows`. |
| `LowHangingFruit` | `src/components/strategy/LowHangingFruit.tsx:1-50` | Legacy #4–20 high-impressions card | **retire** | Folds into queue; `buildOpportunityRows` dedups it. |
| `LostQueryRecoveryCard` | `src/components/strategy/LostQueryRecoveryCard.tsx:1-55` | Top-5 lost queries + "Create recovery content" | **adapt** | Action → belongs in queue with impact sorting; CTA already pre-fills content-pipeline. |
| `CannibalizationTriage` | `src/components/strategy/CannibalizationTriage.tsx:1-211` | Per-duplicate Fix-in-editor + Mark-resolved + Send-to-client | **adapt** | Feature-complete; integrate into queue with impact scoring (traffic dilution). |
| `IntelligenceSignals` | `src/components/strategy/IntelligenceSignals.tsx:1-124` | Standalone momentum/misalignment/content_gap signals card | **rebuild** | Spec lock #2: "signals fold INTO the action queue." Convert each signal to a recommendation with impact scoring; card disappears post-v2. |
| `recommendations.ts` (engine) | `server/recommendations.ts:1-2500` | All 14 RecTypes; every path runs `computeOpportunityValue()` → `deriveCanonicalRecommendationFields()` | **reuse** | Confirmed exhaustive: every type carries `impactScore` + `opportunity`. Per-branch refs e.g. content gaps `:1495-1506`, decay `:2109-2117`, cannibalization `:1794-1801`. |
| `computeOpportunityValue` | `server/scoring/opportunity-value.ts:1-150,353-375` (import `recommendations.ts:54`) | EMV model → `OpportunityScore{value, emvPerWeek, ...}` | **reuse** | Single value source. `MODEL_VERSION='ov-1'`. |
| `deriveOvTier` | `server/recommendations.ts:796-806` | Priority from `opportunity.value` (fix_now/soon/later/ongoing) | **reuse** | Legacy fallback at `:801` (`value == null → rec.priority`) — see Risk. |
| `computeRecommendationSummary` | `server/recommendations.ts:599-626` | Set summary: counts, totalImpactScore, topRec | **reuse** | `:602` `opportunity.value ?? impactScore` — scalar per rec. |
| `recommendationOutcomeActionType` | `server/recommendations.ts:198-241` | Exhaustive RecType switch w/ `never` guard `:237` | **reuse** | Forces any NEW RecType to declare outcome mapping at compile time. |
| `RecommendationRow` | `src/components/admin/recommendations/RecommendationRow.tsx:45-70,87,114-127` | OV badge + emvPerWeek/wk + breakdown | **reuse** | `:87` `ovScore = opportunity?.value ?? impactScore`. Renders the per-row impact. |
| `useAdminRecommendationSet` | `src/hooks/admin/useAdminRecommendations.ts:1-39` (`:19-26`) | Fetches full admin RecommendationSet (w/ emvPerWeek) | **reuse** | DecisionQueue data source. |
| `buildRecFixContext` / `REC_TYPE_ADMIN_TAB` | `src/lib/recTypeTab.ts:1-52` (map `:15-30`, fn `:41-52`) | Maps all 14 RecTypes → admin tab + fixContext | **reuse** | Every type routes to a real handler; powers CTA deep-links. |
| `RecSource` builders / `RecSourceCategory` | `server/recommendations.ts:258-329` | 11 typed source-category builders | **reuse** | Every rec flows through exactly one builder. |

### Content tab (the money page — gaps + refreshes + clusters)

| Component / module | path:lines | Current role | v2 verdict | Evidence |
|---|---|---|---|---|
| `ContentGaps` | `src/components/strategy/ContentGaps.tsx:1-109` | Net-new gaps w/ Draft Brief / Generate Brief CTAs | **adapt** | Compose with Decay + Clusters into one Content-tab surface; add per-item `$/mo`, summary line "N opportunities · ~$X/mo". |
| `DecayingPagesCard` | `src/components/strategy/DecayingPagesCard.tsx:1-72` (CTA `:48-55`, go `:29-30`) | Top-5 decaying pages + "Refresh brief" → content-pipeline | **adapt** | Integrate as a Content-tab subsection. CTA is navigation-only (router fixContext), not a direct API call — see Open-Question §3 correction. |
| `TopicClusters` | `src/components/strategy/TopicClusters.tsx:1-87` (gap chips `:69-80`) | Coverage bars + gap-keyword chips, **no CTA** | **adapt** | Add the missing "Create cluster" CTA (net-new — only CTA in the trio without wiring). |
| `StrategyContentOpportunitiesSection` | `src/components/client/strategy/StrategyContentOpportunitiesSection.tsx:221,233,243` | Client content gaps + price modal + add-to-cart | **adapt** | Client Content-tab. `setPricingModal` `:221/:243`, add-to-cart `:233`. Already ships Add·$price. |
| `content-gaps.ts` | `server/content-gaps.ts:1-256` (list `:105-106`, `opportunity_score` `:72,96`) | `content_gaps` table, sorted by opportunityScore DESC | **reuse** | Data source; carries 0–100 composite + cpc. |
| `content-decay.ts` | `server/content-decay.ts:1-100` (load `:56`, analyze `:80-99`) | `decay_analyses` table; 30-day GSC compare | **reuse** | Refresh data source. |
| `topic-clusters.ts` | `server/topic-clusters.ts:1-120` (list `:106`, schema `:109-115`) | `topic_clusters` table w/ gap keywords | **reuse** | Cluster data source. |
| `content-brief.ts` | `server/content-brief.ts:1-150` (`buildBriefIntelligenceBlock` `:65-112`) | Brief generation + enrichment (decay/cannib/quick-wins) | **reuse** | Decay refresh = normal brief seeded with decay context (`:83-89`). No distinct refresh endpoint. |
| `content-requests.ts` (server) | `server/content-requests.ts:1-200` (create `:177`, update `:240`, status enum `:47`) | ContentTopicRequest CRUD + state machine | **reuse** | Brief flow backing; pending_payment for cart. |

### Rankings tab (summarize + deep-link to Hub; do NOT rebuild tracking)

| Component / module | path:lines | Current role | v2 verdict | Evidence |
|---|---|---|---|---|
| `RankingDistribution` | `src/components/strategy/RankingDistribution.tsx:1-72` (deep-link `:40`, bars `:28-34`) | Position distribution bar + intent mix + striking-distance Hub deep-link | **reuse / adapt** | Reusable as-is for distribution + intent. Adapt: new Rankings-tab container; **30-day movements are NOT in `useStrategyMetrics`** — see Risk + Open-Question. |
| `RankingDistributionProps` | `src/components/strategy/types.ts:202-218` | Prop contract w/ optional workspaceId + navigate | **reuse** | Same contract in Rankings tab. |
| `RankHistoryChart` | `src/components/shared/RankTable.tsx:12-57` (`:21-56`, palette `:19`) | Multi-keyword rank sparkline (≤5 lines) | **reuse** | For 30-day position movements if surfaced. |
| `KeywordSparkline` | `src/components/keyword-command-center/KeywordSparkline.tsx:1-66` (`:25-66`) | SVG position-over-time sparkline | **reuse** | Per-row trend if needed. Note: spec forbids per-card sparklines on main page; allowed on interior tabs. |
| `keywordHubDeepLink` | `src/lib/keywordHubDeepLink.ts:1-89` (`HUB_SEGMENT_VALUES` `:35-43`) | Two-halves deep-link contract (sender/receiver) | **reuse** | `striking_distance` is the one band with a real Hub destination. |
| `KeywordHub` | `src/components/KeywordHub.tsx:1-100+` (readHubDeepLink `:37`) | Canonical keyword surface; reads `?tab=` | **reuse** | Spec lock #3: Rankings tab never forks tracking. |
| `HubSegmentBar` / `HUB_SEGMENT_METAS` | `src/components/keyword-hub/HubSegmentBar.tsx` | 7 segment pills incl. striking_distance | **reuse** | Receiver-side UI for deep-links. |
| `rank-tracking.ts` (core) | `server/rank-tracking.ts:1-482` (`getLatestRanks`, `getRankHistory`, `buildLatestRanks` `:459`) | Authoritative rank state (tracked_keywords + snapshots) | **reuse** | Single source of truth; Rankings tab consumes only output. |
| `server/routes/rank-tracking.ts` | `server/routes/rank-tracking.ts:1-152` | GET keywords/history/latest, POST snapshot/keyword | **reuse** | Serves the Hub; Rankings tab does not call directly. |
| `keyword-command-center.ts` (striking-distance filter) | `server/keyword-command-center.ts` (`isStrikingDistanceRow`: pos 11–20) | Server filter for striking_distance segment | **reuse** | Load-bearing for the deep-link contract. |
| `PageKeywordMap.currentPosition` | `shared/types/workspace.ts:21-66` (`:27`) | Per-page latest rank (hydrated at enrichment) | **reuse** | Source for `useStrategyMetrics` position bands. |
| `useTrackKeyword` | `src/components/strategy/hooks/useTrackKeyword.ts:1-56` | Inline Track mutation (SiteTargetKeywords/Reference) | **retire (from Rankings tab)** | Rankings tab only summarizes + deep-links; Hub owns Track. Hook survives elsewhere if SiteTargetKeywords survives (but SiteTargetKeywords is itself retired — so this hook likely fully retires post-cutover; scans note it "survives in the strategy orchestrator" but that orchestrator usage is retired). **Flag this contradiction for planning.** |
| **30-day movements (improved/declined/new/lost)** | N/A in `useStrategyMetrics` | net-new aggregation | **new** | Exists only in Hub (`getRankHistory` + delta). See Risk/Open-Question — recommend extending `useStrategyMetrics`, ~20 lines. |

### Competitive tab (share of voice + keyword gaps + backlinks — research mode)

| Component / module | path:lines | Current role | v2 verdict | Evidence |
|---|---|---|---|---|
| `CompetitiveIntel` | `src/components/strategy/CompetitiveIntel.tsx:99-327` (variant `:60-73`, ComparisonBar `:81-97`) | Live competitive fetch, per-competitor drill-down, comparison bars, gaps | **adapt** | Mount at `variant='full'`; ComparisonBar `:91-94` is binary (own vs one) — generalize to n-way for share-of-voice. |
| `BacklinkProfile` | `src/components/strategy/BacklinkProfile.tsx:12-119` (stats `:68-75`, table `:78-116`) | Backlink stat cards + referring-domains table | **reuse** | Competitive-tab section. Missing "new/lost" referring domains over 30d — add if spec requires. |
| `KeywordGaps` | `src/components/strategy/KeywordGaps.tsx:32-106` | Competitor gaps + optional Track + Hub deep-link | **reuse / adapt** | Add Create-brief CTA per row (spec: "keyword gaps with Create-brief"). |
| `AuthorityAndBacklinks` | `src/components/strategy/AuthorityAndBacklinks.tsx:1-27` (`:18-24`) | Phase-4 merged wrapper (BacklinkProfile + CompetitiveIntel `variant='merged'`) | **adapt → retire** | Adapt to use `variant='full'` for the standalone tab; the *merged wrapper* itself retires post-cutover (render the two children directly as tab sections). |
| `useBacklinkProfile` | `src/hooks/admin/useBacklinkProfile.ts:18-24` | RQ hook, 168h staleTime | **reuse** | infra. |
| `/api/seo/competitive-intel` | `server/routes/seo-provider.ts:53-160` | Live competitive fetch (DataForSEO), graceful degrade | **reuse** | infra. Sync (not async job) — wrapping in a job needed only if exposed via MCP. |
| `/api/backlinks/:id` | `server/routes/backlinks.ts:13-46` | Backlinks overview + referring domains | **reuse** | infra. |
| `SeoDataProvider` | `server/seo-data-provider.ts:100-144` | Provider interface (DataForSEO only) | **reuse** | infra. No alternate providers in scope. |
| `keyword-gaps.ts` | `server/keyword-gaps.ts:1-192` (list `:95-98`, replace `:100-116`) | `keyword_gaps` table (normalized from blob) | **reuse** | Cache fallback when live fetch fails. |
| `keyword-strategy-seo-data.ts` | `server/keyword-strategy-seo-data.ts:218-235` (`:222`) | Fetches `getKeywordGap` during strategy regen | **reuse** | Only place gaps are fetched from provider. |
| **Share-of-Voice chart** | N/A — grep ZERO matches | net-new | **new** | No `shareOfVoice`/`SOV` anywhere. Compute from domain-overview traffic; n-way bar via generalized ComparisonBar / `AIUsageSection` BarChart pattern (`src/components/AIUsageSection.tsx:119-152`). |

### Client view (thin reframe of the same server data — Premium gating, no purple)

| Component / module | path:lines | Current role | v2 verdict | Evidence |
|---|---|---|---|---|
| `StrategyTab` (client) | `src/components/client/StrategyTab.tsx:51-150+` | Client strategy reframe (priorities, gaps, feedback, pricing modal) | **rebuild** | Split into StrategyOverviewTab + Content/Rankings/Competitive tabs per v2 IA; add `useSearchParams` for `?tab=`. |
| `StrategyKeywordsSection` | `src/components/client/strategy/StrategyKeywordsSection.tsx` | Tracked/recommended keywords + approve/decline | **adapt** | → Rankings tab: distribution + 30-day movements + Hub deep-links; do not rebuild tracking. |
| `DecisionCard` | `src/components/client/DecisionCard.tsx:1-73,76-132` | Unified inbox entry (bulk modal / inline approve) | **reuse** | Each rec row = a DecisionCard derivative; Approve (retainer) + Add·$price (à-la-carte). |
| `TierGate` / `tierAtLeast` | `src/components/ui/TierGate.tsx:1-120` (TIER_COLORS `:22-26`) | Tier gate; palette zinc/teal/amber (no purple) | **reuse** | Competitive tab Premium-gated. Note: gating is client-side; server must validate tier (Risk). |
| `ROIDashboard` | `src/components/client/ROIDashboard.tsx:70-82,163-209` | Organic value $/mo, content ROI | **reuse** | Evidence/metadata for queue impact values. |
| `useClientIntelligence` | `src/hooks/client/useClientIntelligence.ts:6-13` | RQ wrapper, 5-min staleTime | **reuse** | All client tabs read this. |
| `client-intelligence.ts` (route) | `server/routes/client-intelligence.ts:36-211` (slices `:165-211`) | Tier-gated, scrubbed ClientIntelligence | **reuse** | No code change; already tier-gated + admin-jargon-scrubbed. |
| `client-safe.ts` | `server/serializers/client-safe.ts:43-87,108-145` | `toPublicWorkspaceView` + inbox serializers | **reuse** | Strips admin fields; enforces tier. |
| `public-portal.ts` | `server/routes/public-portal.ts:86-95,224-249` | Workspace bootstrap + pricing | **reuse** | Pricing already client-accessible + tiered. |
| `client-actions.ts` (route) | `server/routes/client-actions.ts:82-100` (respond schema `:46-49`) | Public approve/changes flow | **adapt** | Add `sourceType='strategy_recommendation'`; Approve → PATCH /respond. **Do NOT add a net-new Add·$price route** — see Open-Question §3 correction (cart-checkout + upgrade already ship). |
| `TrendChart` / `DualTrendChart` | `src/components/client/helpers.tsx:28-93` | Client trend charts (no purple) | **reuse** | Client Orient visits trend. |
| `DecisionDetailModal` | `src/components/client/DecisionDetailModal.tsx` (referenced) | Bulk approval modal | **reuse** | For multi-item recs. |
| NormalizedDecision + adapters | `shared/types/decision.ts:1-80`, `src/lib/decision-adapters.ts` | Normalizes client_actions/batches/deliverables | **adapt** | New adapter branch `source='strategy_recommendation'`. |
| `useClientInsights` | `src/hooks/client/useClientInsights.ts:10-21` | Narrative-layer client insights | **retire (from Strategy v2)** | Signals fold into the queue; endpoint not used by v2 Strategy (may remain for Portfolio). |
| `InsightsDigest` | `src/components/client/InsightsDigest.tsx:66-587` (COLORS `:478-484`) | Local + server insights merge | **adapt (retire from Strategy main)** | Keep in Portfolio/Briefing; signals route via DecisionCard adapter for v2. |
| `client-signals.ts` (route) | `server/routes/client-signals.ts:33-117` | Free-form client signal CRUD | **retire (from Strategy v2)** | Signals → recommendations; not referenced by v2. |

### Retire-after-cutover (Phase 4 intermediates, legacy-only surfaces)

| Component / module | path:lines | Current role | v2 verdict | Evidence |
|---|---|---|---|---|
| `StrategyBand` | `src/components/strategy/StrategyBand.tsx:1-30` | Decide/Act/Reference label divider | **retire** | v2 IA (Orient/Act/Evidence + tabs) replaces band concept. |
| `StrategyStatBar` | `src/components/strategy/StrategyStatBar.tsx:1-31` | Reference-band stat bar | **retire** | Superseded by Orient strip. |
| `SiteTargetKeywords` | `src/components/strategy/SiteTargetKeywords.tsx:1-74` | Legacy full keyword list | **retire** | Keywords live in Hub; already replaced by `ManageInHubCard` in bands. |
| `ManageInHubCard` | `src/components/strategy/ManageInHubCard.tsx:1-41` | "Manage in Keyword Hub" link card | **retire** | v2 removes keyword listing from Strategy entirely. |
| `KeywordOpportunities` | `src/components/strategy/KeywordOpportunities.tsx:1-49` | AI keyword-suggestion list | **retire** | Not in v2 IA. |
| `AuthorityAndBacklinks` | `src/components/strategy/AuthorityAndBacklinks.tsx:1-27` | Phase-4 merged wrapper | **retire** (wrapper) | Children move to Competitive tab as separate sections. |
| `StrategyFeedbackNudge` | `src/components/strategy/StrategyFeedbackNudge.tsx` (lines **unknown**) | Feedback-newer-than-strategy banner | **retire** | Fold into Decide-band/queue UI. |
| `StrategyHowItWorks` | `src/components/strategy/StrategyHowItWorks.tsx:1-28` | Footer help prose | **adapt → retire** | Superseded by `StrategyHelpDisclosure`; v2 may keep collapsible help or retire. |
| `StrategyHelpDisclosure` | `src/components/strategy/StrategyHelpDisclosure.tsx:1-49` | Collapsible help + glossary | **adapt** | Keep as per-tab/global collapsible; glossary reusable. |
| `ScoreTrendChart` | `src/components/audit/ScoreTrendChart.tsx:1-54` | Audit score history | **retire (from Strategy)** | Audit-specific; Strategy uses organic-clicks trend. Stays on audit surface. |
| `ClientKeywordFeedback` | `src/components/strategy/ClientKeywordFeedback.tsx:1-116` | Requested + declined feedback card | **adapt / retire** | If admin-side feedback stays → compact Decide element; if moved to client-portal → retire from admin. **Decision needed.** |
| `RequestedKeywordTriage` | `src/components/strategy/RequestedKeywordTriage.tsx:1-68` | Decide-band requested-keyword triage | **adapt** | Keep in Decide; integrate with queue if keyword-add becomes a prioritized action. |
| `StrategyDiff` | `src/components/strategy/StrategyDiff.tsx:1-198` | "What Changed" collapsible (Act band) | **adapt** | Spec gives no explicit home — move to an Evidence/Changes sub-tab or footer collapsible. **Decision needed.** |
| Hooks: `useStrategySettings`, `useStrategyGeneration`, `useTrackKeyword`, `useKeywordFeedback` | `src/components/strategy/hooks/*` (most lines **unknown** — scan flagged "[Need to read this file]") | Settings/generation/track/feedback orchestration | **reuse / adapt** | Generation + settings reuse; track/feedback adapt. Several hook files were not fully read by the scan. |
| `StrategySettings` | `src/components/strategy/StrategySettings.tsx` (lines **unknown**) | Collapsible generation config | **adapt** | Keep compact in Decide; thread competitor list to Competitive tab. |

---

## Open-Question Resolutions

### (1) Visibility score (0–100) — **ABSENT, must build**

**Grounded answer (high confidence).** No organic-visibility 0–100 score exists anywhere. `grep -rni visibilityscore` over `server/ src/ shared/` returned **ZERO** matches (independently verified). The three scores the scans cited are real but none measure search visibility:
- `compositeHealthScore` (`server/intelligence/client-signals-slice.ts:440-506`) = client *business* health (40% retention + 30% ROI + 30% engagement).
- `auditScore` (`server/intelligence/site-health-slice.ts:68,514-516`) = technical SEO health.
- **Omission caught by verification:** a *fourth* pre-existing 0–100 score the scans missed — `calculateStrategyHealth()` at `src/lib/strategy-health-score.ts:31-50` (`gaps*4 + quickWins*6 + coverage*30`), rendered in `StrategyTab`. It measures **strategy progress, not visibility**, so the "must build" verdict stands — but the spec author must be told it exists to decide what Orient shows.

**Formula correction (high confidence).** The scans' proposed `100 - (avgPosition * 2.5)` is **wrong**: self-inconsistent (claims position 1 ≈ 94; the arithmetic is 97.5) and linear, which mislabels a 1.8%-CTR position-10 ranking as "75/100 good." The codebase already contains a calibrated CTR-decay primitive: `ctrAt()` (`server/scoring/ctr-curve.ts:116`), `industryCtr()` (`:46`), `buildCtrCurve()` (`:62`, calibrates to workspace GSC with industry fallback), with `INDUSTRY_CTR` pos1=0.28 / pos10=0.018 (`:38-43`).

**Recommendation / default to confirm:** Build it, but use the CTR-decay primitive, not the linear formula:
`visibilityScore = round(100 * Σ(volumeᵢ · ctrAt(positionᵢ)) / Σ(volumeᵢ · ctrAt(1)))`.
Volume from `PageKeywordMap.volume` (`shared/types/workspace.ts:34`) or GSC impressions; unweighted mean fallback when volume is null. Implement as a pure helper in `server/scoring/visibility-score.ts`, compute inside `assembleSeoContext` (~`server/intelligence/seo-context-slice.ts:155`), append `seoContext.rankTracking.visibilityScore: { current, delta }`. Render via existing `MetricRing` + `scoreColor()`. Three open items the owner must confirm: (a) disclose `calculateStrategyHealth()` and decide what Orient shows; (b) do **NOT** serialize the admin visibility score to public/client routes; (c) if a linear v1 is kept anyway, fix the pos-1 claim and track the CTR-curve upgrade — but building the CTR version directly is preferred.

### (2) Impact value model — **PARTIAL (no nulls, but real zeros exist)**

**Grounded answer (high confidence).** No recommendation type renders a *null/blank* impact — every type runs `computeOpportunityValue()` → `deriveCanonicalRecommendationFields()`, and the queue sorts by `opportunity.value ?? impactScore` (`DecisionQueue.tsx:20-21`, `RecommendationRow.tsx:87`). The Content-Monetization scan's "no blanks" conclusion is correct. **However**, the adversarial verification found that **zero impacts do occur** for the `technical` and `freshness` branches on **zero-traffic pages**, and `CRITICAL_CHECKS` short-circuit those to `fix_now` (`server/recommendations.ts:751-760`). The result: a critical check with a real-but-zero impact can lead the queue with a "zero" pill.

**Recommendation / default to confirm:** Do **not** mark this resolved. Two mitigations: (a) render a non-dollar "Health fix" chip when the score/impact is zero (or feed a floor value for zero-traffic critical checks); and (b) decouple urgency tier from the impact pill so a `fix_now` critical item doesn't display "$0/mo." Separately confirm the legacy-fallback risk (`deriveOvTier` `:801` keeps legacy `rec.priority` when `value == null`) and the impactBand display floor ($25–$50/mo) so the client UI distinguishes "below floor" from "no impact."

### (3) Monetization wiring — **PARTIAL: 4 of 5 CTAs real, 1 net-new**

**Grounded answer (high confidence).** Mapping the 5 CTA flows:
1. **Admin Create brief — REAL, navigation-only.** `ContentGaps.tsx:78/:86` call `navigate(adminPath, {state:{fixContext}})` — a router state handoff, **not** a direct API call. Real backing endpoints exist: `POST /api/content-briefs/:workspaceId/generate` (`server/routes/content-briefs.ts:154`) and `POST /api/content-requests/:workspaceId/:id/generate-brief` (`server/routes/content-requests.ts:290`). **Correction:** the Content-Monetization scan overstated that these CTAs call endpoints directly.
2. **Admin Create refresh — REAL, navigation-only.** `DecayingPagesCard.tsx:48-55` → `go('content-pipeline', page.page)`. **No distinct refresh endpoint** — it is a normal brief seeded with decay context. Do not scope a separate refresh API.
3. **Admin Create cluster — NET-NEW.** `TopicClusters.tsx` renders gap chips (`:69-80`) but has **zero** CTA/onClick; repo-wide grep finds no cluster-brief CTA. Backing `topic_clusters` table + `gap[]` data exist; only the CTA + batch-create handler are missing.
4. **Client Approve — REAL.** `POST /api/public/content-request/:workspaceId/:id/approve` (`server/routes/public-content.ts:392`), guarded by `assertClientReviewRequest` (`:94`); retainer-included, no payment.
5. **Client Add·$price — REAL and ALREADY SHIPPING.** `StrategyContentOpportunitiesSection.tsx:221/:233/:243` → `addContentToCart`/`useCart`; backed by `POST /api/stripe/cart-checkout` (`server/routes/stripe.ts:223` → `createCartCheckoutSession` `server/stripe.ts:382`) with server-side `contentProductType` re-derivation preventing downgrade, plus upgrade via `POST /api/public/content-request/:workspaceId/:id/upgrade` (`public-content.ts:449`). **Correction:** the Client-Portal scan's open-question wrongly claimed Add·$price is net-new and needs a new route/schema — it already ships.

**Recommendation / default to confirm:** Treat 4 of 5 CTAs as **reuse**; scope **only admin Create cluster** as net-new (add a batch-gap-brief CTA in `TopicClusters.tsx` or the Act queue that loops `gap[]` keywords into `createContentRequest`/generate-brief). In the plan: decide whether admin Create brief/refresh keep the content-pipeline router handoff or call `POST .../generate-brief` directly (do **not** assume a one-shot create-brief API fires from the CTA today). Disregard any net-new Add·$price route proposal — reuse cart-checkout + upgrade.

---

## Existing Coverage (reuse, do not rebuild)

- **Charting infra (recharts v3.8.0 + custom SVG).** `AnnotatedTrendChart` (hero trend), `MetricRing`/`MetricRingSvg` (score ring), `TrendBadge` (deltas), `ChartCard`, `RankHistoryChart`, `KeywordSparkline`, `RankingDistribution` bar pattern, `DepthChart` compact-bar pattern (`src/components/SiteArchitecture.tsx`), `CHART_SERIES_COLORS`/chart utilities (`src/components/ui/constants.ts:128-170`). No new dependency.
- **Deep-link helpers.** `keywordHubDeepLink` two-halves contract (`src/lib/keywordHubDeepLink.ts`), `resolveTabSearchParam`/`clearTabSearchParam` (`src/lib/tab-search-param.ts`), proven `?tab=` pattern in `ContentPipeline.tsx:57-62,83-105` (the template for interior tabs). Contract test `tests/contract/tab-deep-link-wiring.test.ts:1-438`.
- **Recompute job.** `runIntelligenceRecomputeJob` (`server/intelligence-recompute-job.ts:20-79`) broadcasts `INTELLIGENCE_SIGNALS_UPDATED`; manual "Recompute now" always queues (`keyword-strategy.ts:731-741`); `enqueueIntelligenceRecompute` gated on `signal-auto-recompute` flag (OFF by default).
- **Query keys.** Full strategy-mutation key set in `src/lib/wsInvalidation.ts:38-60` (`strategyMutationKeys`): `keywordStrategy`, `strategyDiff`, `backlinkProfile`, `competitorIntelAll`, `keywordFeedback`, `keywordCommandCenter`, `rankTracking*`, `intelligence*`, `recommendations`, `roi`. All exist.
- **WS events.** `STRATEGY_UPDATED` (`server/ws-events.ts:137-138`), `RECOMMENDATIONS_UPDATED` (`:135`), `INTELLIGENCE_SIGNALS_UPDATED` (`:64-65`), `RANK_TRACKING_UPDATED` (`:139`) — all wired in `src/hooks/useWsInvalidation.ts:17-89`. **No dedicated `COMPETITOR_UPDATED` event** — Competitive tab refresh piggybacks on `STRATEGY_UPDATED`.
- **Tier gating.** `TierGate`/`tierAtLeast`/`TIER_LEVEL` (`src/components/ui/TierGate.tsx`), no-purple `TIER_COLORS` palette.
- **Approve flow.** Public approve/changes endpoints + `respondToPublicClientAction` + `toClientInboxItem` serializer + `DecisionCard`/`DecisionDetailModal` UI. Add·$price (cart-checkout + upgrade) and pricing endpoint (`public-portal.ts:224-249`) all ship.
- **Recommendation engine + value model.** All 14 RecTypes produce `impactScore` + `opportunity`; `stripEmvFromPublicRecs`/`computeImpactBand` (`server/routes/recommendations.ts:39-89`, `shared/types/impact-band.ts`) project client-safe banded impact.

---

## Net-New Work

| Net-new item | Size | Notes / evidence |
|---|---|---|
| **Visibility score (0–100) computation** | **M** | CTR-decay weighted helper in `server/scoring/visibility-score.ts` + integrate into `assembleSeoContext` + append `seoContext.rankTracking.visibilityScore{current,delta}` + 1 unit test. ~30–50 lines server, ~5 lines frontend. Uses existing `ctrAt()`. Do NOT serialize to public/client routes. |
| **Share-of-voice chart (n-way)** | **M** | No `shareOfVoice`/`SOV` exists. Generalize `CompetitiveIntel` ComparisonBar (`:81-97`, currently binary) or extract a reusable `<ShareBar>` from the `AIUsageSection` stacked-bar pattern. Compute SOV from domain-overview traffic (my / (my + competitors)). |
| **30-day rankings movements (improved/declined/new/lost)** | **S–M** | Not in `useStrategyMetrics`; exists only in Hub. Recommend extending `useStrategyMetrics` (~20 lines, snapshot[0] vs snapshot[-30]) behind the flag so flag-OFF is byte-identical. Confirm against mockup whether it's in scope for v1 or deferred. |
| **Interior sub-tab shell (admin + client)** | **M** | New `StrategyInteriorTab = 'overview'\|'content'\|'rankings'\|'competitive'` union; wire `useSearchParams` + `resolveTabSearchParam` in `KeywordStrategyPanel` (admin) and `StrategyTab` (client) per `ContentPipeline` template. Update `tab-deep-link-wiring.test.ts` for new senders/receivers. No new `Page` union values. |
| **Act-queue merge + filter chips + impact labels** | **L** | Extend `buildOpportunityRows` to merge all action types; convert `IntelligenceSignals` → recommendations; add All/Content/Technical/Quick-wins chips with counts; per-row projected impact + zero-impact "Health fix" chip handling (Open-Question §2). |
| **Admin "Create cluster" CTA + batch handler** | **S–M** | The only missing CTA in the trio. Add to `TopicClusters.tsx` or Act queue; loop `gap[]` into `createContentRequest`/generate-brief. Backing data exists. |
| **Client Strategy reframe (Orient/Act/tabs)** | **L** | Rebuild `StrategyTab` into Overview + Content + Rankings + Competitive (Premium-gated); reuse `useClientIntelligence`, `DecisionCard`, `TierGate`, `TrendChart`. No purple. |
| **`strategy-recommendation` source type + decision adapter** | **S** | New `sourceType` enum value (no schema change — `client_actions.payload` is JSON) + new `decision-adapters.ts` branch; Approve → PATCH /respond. |
| **`strategy-command-center` feature flag** | **S** | New flag in `FEATURE_FLAG_CATALOG` (`shared/types/feature-flags.ts`) — audit recommends NEW flag, not extending `strategy-decision-bands`. See Infrastructure. |
| **Per-row projected-impact label decoupling (zero-impact)** | **S** | Health-fix chip / floor value per Open-Question §2. |

---

## Infrastructure Recommendations

**Shared utilities to extract:**
- `server/scoring/visibility-score.ts` — pure CTR-weighted score helper (reuses `ctrAt()`); single source of truth, append to `SeoContextSlice.rankTracking`.
- `<ShareBar>` (or generalized `CompetitiveIntel` ComparisonBar) — n-way competitor share bar, reusable across Competitive tab.
- `<DistributionBar>` / `<CompactDistributionChart>` — extract from `RankingDistribution` (`:28-34`) + `DepthChart`, reused for position distribution, share-of-voice, coverage.
- Extend `useStrategyMetrics` with delta fields + visibility score + (optional) 30-day movements, isolating new fields so legacy flag-OFF stays byte-identical.
- `useWorkspaceFeatureFlag(flag, workspaceId)` — **the current `useFeatureFlag()` (`src/hooks/useFeatureFlag.ts:16-25`) does NOT accept `workspaceId`** (global only). Per-workspace v2 rollout requires this hook or a server call to `isFeatureEnabled(flag, workspaceId)` (`server/feature-flags.ts:147-153`).

**pr-check rules to add:**
- No-purple in client Strategy surfaces (`grep -r "purple-" src/components/client/strategy/`).
- `?tab=` two-halves wiring for the new interior tabs (extend the existing contract test).
- Premium-discount constant sync between `SeoCart.tsx` and `server/stripe.ts` (flagged as a divergence risk).
- Guard that the admin visibility score is never serialized on public/client routes.

**Test coverage to add:**
- Unit test for `visibility-score.ts` (formula + edge cases: null avgPosition, null volume, zero-traffic).
- Contract test update for new `?tab=content|rankings|competitive` senders (DecisionQueue, ContentGaps, RankingDistribution, CompetitiveIntel) → receivers (`KeywordStrategyPanel`, `StrategyTab`).
- Integration test for the Content-tab CTA path through the **public** read path (per CLAUDE.md "integration tests must cover the actual read path").
- EMV-leak test extension confirming `stripEmvFromPublicRecs` covers all v2 public recommendation routes.
- Activity-type fix test: **`strategy_generated` is missing from the `ActivityType` union** (`server/activity-log.ts:18-152`) despite `addActivity('strategy_generated')` being called — a real bug to fix in the first phase.

**Feature-flag decision (high confidence — recommend NEW flag):** Create **`strategy-command-center`**, do **not** extend `strategy-decision-bands`. Rationale (from routing scan): (a) `strategy-decision-bands` gates *layout only* and is already scheduled for Phase-4 removal (`shared/types/feature-flags.ts:267-279`); (b) v2 spans layout + routing + data delivery — a distinct lifecycle; (c) keeping them separate lets flag-OFF be byte-identical and allows independent rollout. Proposed entry: `owner='analytics-intelligence'`, `group='Strategy'`, `rolloutTarget='staging-validation'`, `removalCondition='Remove after v2 ships as default; legacy decision-bands layout deleted (Phase 4)'`. If **both** flags are ON during dual-landing, `strategy-command-center` must take precedence — define this explicitly.

---

## Bounded-Context Ownership

(Per `docs/rules/platform-organization.md`. Spec leaves primary owner "TBD via audit.")

- **Primary owner: `analytics-intelligence`** — owns the recommendation/queue engine (`server/recommendations.ts`, `server/scoring/`), the intelligence slices (`server/intelligence/*`), `useStrategyMetrics`, the visibility score, and the Orient/Act zones. This is the largest surface and the home of the net-new top-line metric.
- **Secondary integrations:**
  - `seo-health` — recommendations type taxonomy, rankings distribution, backlinks/competitive provider routes (`server/routes/seo-provider.ts`, `server/routes/backlinks.ts`, `server/seo-data-provider.ts`).
  - `content-pipeline` — content opportunities → briefs (`server/content-gaps.ts`, `server/content-brief.ts`, `server/content-requests.ts`, Create cluster CTA).
  - `billing-monetization` — per-item purchase / tier gating (`server/stripe.ts`, `server/payments.ts`, `public-portal.ts` pricing, `TierGate`).
  - `client-portal` — client spin-out (`server/routes/client-intelligence.ts`, `client-safe.ts`, `StrategyTab`, `DecisionCard`).
  - `keyword-hub` — Rankings deep-link target; **read-only from Strategy's perspective** (no forks per spec lock #3).
- **Shared coordination files (pre-commit before parallel dispatch):**
  - `shared/types/feature-flags.ts` (new flag), `shared/types/intelligence.ts` (`SeoContextSlice.rankTracking.visibilityScore` field), `shared/types/recommendations.ts` (if new RecType/source), `shared/types/decision.ts` (`strategy_recommendation` source), `src/lib/tab-search-param.ts` + the new `StrategyInteriorTab` union, `src/components/strategy/types.ts`.

---

## Parallelization Strategy

**Phase-per-PR (spec success criterion: "Phase-per-PR; each phase flag-gated; flag-OFF byte-identical").** Each phase merges to `staging`, validates, then the next begins.

- **Phase 0 — Contracts + flag + score (sequential, blocking).**
  - Add `strategy-command-center` flag; add `SeoContextSlice.rankTracking.visibilityScore` type; build `server/scoring/visibility-score.ts` + integrate in `assembleSeoContext` + unit test; fix the `strategy_generated` `ActivityType` bug; pre-commit the `StrategyInteriorTab` union + shared types. **Everything downstream depends on this.**
- **Phase 1 — Orient zone** (depends on Phase 0). Visibility-score `MetricRing`, hero `AnnotatedTrendChart`, 4-stat strip with deltas, AI verdict line, staleness nudges relocation. Flag-gated.
- **Phase 2 — Act queue** (depends on Phase 0; can overlap Phase 1's later half). `buildOpportunityRows` extension, `IntelligenceSignals`→recommendations rebuild, filter chips, per-row impact + zero-impact handling, CTA wiring.
- **Phase 3 — Interior tab shell + Content tab** (depends on Phase 0 shell decision; Content tab depends on Phase 2 CTA patterns). Sub-tab routing in `KeywordStrategyPanel`, Content tab composition (ContentGaps + Decay + Clusters), Create-cluster CTA, contract-test update.
- **Phase 4 — Rankings tab** (depends on Phase 3 shell). `RankingDistribution` reuse + 30-day movements + Hub deep-links.
- **Phase 5 — Competitive tab** (depends on Phase 3 shell). `CompetitiveIntel` (variant='full') + `BacklinkProfile` + `KeywordGaps`-with-Create-brief + share-of-voice chart.
- **Phase 6 — Client reframe** (depends on Phases 1–5 data shapes being stable). `StrategyTab` rebuild into Overview + interior tabs, Premium gating, no-purple verification.

**Dependency graph:** `Phase 0 → {1, 2}`; `{0,2} → 3`; `3 → {4, 5}`; `{1,2,3,4,5} → 6`.

**File ownership per parallel task (within a phase, when subagents run concurrently):**
- Within Phase 1: one agent owns `MetricRing` integration + Orient layout; another owns the `useStrategyMetrics` delta extension (coordination file — must be pre-committed). Avoid two agents touching `useStrategyMetrics`.
- Within Phase 5: one agent owns the share-of-voice chart extraction (`CompetitiveIntel`/`<ShareBar>`); another owns `KeywordGaps` Create-brief CTA; another owns `BacklinkProfile` new/lost. Exclusive files each.
- **No parallel agent runs git writes** in a shared checkout — controller commits per lane (per memory `feedback_parallel_agents_no_git`).

---

## Model Assignments

(Anthropic ladder per CLAUDE.md multi-agent rules.)

| Task type | Model | Reasoning |
|---|---|---|
| Phase 0 contracts (types, flag entry, `ActivityType` fix) | **Sonnet** | Mechanical-but-load-bearing; needs local judgment on shared-type placement, low ambiguity. |
| Visibility-score helper + CTR-curve integration | **Opus** | Cross-context (scoring + intelligence slice), formula correctness is high-stakes (verification flagged a wrong default), needs careful reasoning about CTR weighting + null fallbacks. |
| Orient zone UI assembly (MetricRing/ChartCard/StatCard wiring) | **Sonnet** | Primitive composition with established patterns; design-system-bound. |
| Act-queue merge + `IntelligenceSignals`→recommendations rebuild | **Opus** | Highest-complexity cross-context work: merging 6 action types, impact ranking, zero-impact edge cases, signal→rec conversion. |
| Interior sub-tab shell + `?tab=` wiring | **Sonnet** | Proven `ContentPipeline` template to copy; two-halves contract is well-specified. |
| Content / Rankings / Competitive tab composition | **Sonnet** | Reuse + composition of existing leaves; per-tab judgment but bounded. |
| Share-of-voice chart (n-way) | **Opus** | Net-new chart + n-way data shape + palette rotation; no precedent to copy. |
| Client reframe (no-purple, Premium gating) | **Sonnet** | Reframe of existing data with strict design laws; pattern-bound, design-system-enforced. |
| pr-check rule authoring | **Sonnet** | Regex/customCheck authoring against documented patterns. |
| Test authoring (unit/contract/integration) | **Sonnet** | Existing factories + helpers; deterministic. |
| Cross-phase diff review / scaled-code-review | **Opus** | Cross-module correctness, byte-identical flag-OFF verification, catching the kinds of silent regressions memory warns about (collapsed grids, contrast, deep-link receiver gaps). |

**Explicit uncertainties carried forward (do not guess in the plan):** (a) several Strategy hook files and `StrategyHeaderActions`/`StrategySettings`/`StrategyFeedbackNudge` line ranges were "[Need to read]" in the scan — read them before assigning ownership; (b) `useTrackKeyword` retire-vs-survive is contradictory between scans (SiteTargetKeywords retires, but a scan says the hook "survives in the orchestrator") — resolve before Phase 4; (c) `StrategyDiff` and `ClientKeywordFeedback` have no explicit v2 home in the spec — owner decision needed; (d) whether 30-day movements are v1 or deferred depends on the mockup, which the scans could not read.
