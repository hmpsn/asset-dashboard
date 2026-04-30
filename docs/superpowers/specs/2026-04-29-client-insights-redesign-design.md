# Client Insights Redesign — Design Spec
**Date:** 2026-04-29
**Status:** Draft (awaiting user review)
**Builds on:** `2026-04-28-client-insights-briefing-refactor-design.md` (Phase 1 + 2 — merged)
**Phasing:** Five sub-phases (2.5a / 2.5b / 2.5c / 2.5d / 2.5e). One PR per phase. Reuse-first. The optional AI-polish sub-flag `client-briefing-v2-ai-polish` lands in 2.5e; `client-briefing-v2` gates the rest. **Reorder note (2026-04-29):** AI hero-punch + weekly-opener moved from 2.5c → 2.5e (post-cleanup) so they land on a tidy `briefing-prompt.ts` rather than next to the dead full-narrative path.

---

## Problem Statement

Phase 2 (PR #375) shipped the client-side magazine layout — action queue strip + hero card + "Also this week" rows + Free-tier upgrade CTA + un-gated MonthlyDigest. The architecture works. The **content doesn't.**

Smoke testing on hmpsn studio surfaced three failures in the briefing's editorial voice:

1. **AI re-narrates structured data into vagueness.** The Phase 2 pipeline takes typed `analytics_insights` records (each with a rich `data` payload — concrete metrics, page paths, deltas) and asks the AI to write 1-3 sentence narratives. The AI strips the numbers and hedges with "potentially / could impact / appears to suggest." The first three published stories — "Competitors Using Similar Studio Branding," "Strong Portfolio Content Driving Engagement," "Domain Extension Strategy Needs Review" — quoted zero numbers and named zero specific competitors.

2. **Content gaps from the keyword strategy aren't surfaced.** They're the agency's primary upsell vehicle ($X per content brief generation). They're typed-up with `volume`, `difficulty`, `impressions`, `competitorProof`, `serpFeatures`, `opportunityScore` — all rich, all server-computed, all currently buried 3+ clicks deep on the Strategy tab. The Phase 2 briefing pulls insights and recommendations but never queries `keywordStrategy.contentGaps[]`.

3. **The OLD `<InsightsDigest>` was data-rooted; the briefing replaced it with prose.** The legacy digest produced concrete "{N} keywords almost on page 1," "{N} content opportunities," "Site health: 91/100" cards — all deterministic, all anchored in numbers, all specific. The Phase 2 magazine reads softer because it asks AI to rewrite what was already strong.

Compounding the problem: the platform already runs an `analytics_insights` engine, an `insight-enrichment.ts` enrichment layer, an `opportunityScore` computation in `keyword-strategy.ts`, an ROI engine in `roi.ts` (organic traffic value, ad-spend equivalent, per-brief attribution), `<ContentGaps>` admin row layout, `<InsightsDigest>` deterministic generators, and `<MonthlyDigest>` summarization. **The data is there. The plumbing is there. The voice and the surfacing aren't.**

---

## Solution Overview

Replace the AI-narration step with **deterministic story templates** that project typed insight data into a fixed editorial voice. Add `keywordStrategy.contentGaps[]` to the candidate pool. Restructure the page to surface the data in a "weekly investor briefing" rhythm.

The redesign is divided into three phases, each shippable on its own:

- **Phase 2.5a** — Server-side template rebuild. **Zero frontend changes.** Magazine layout stays; content becomes data-rooted. Validates the thesis at minimum risk.
- **Phase 2.5b** — Add new layout sections (Pulse, Data Spread, Recommended for You, Issue Summary, Date Line) using existing primitives.
- **Phase 2.5c** — Historical anchors + milestone attribution + weCalledIt outcome stories.
- **Phase 2.5d** — Cleanup of dead Phase 1/2 AI narrative code (housekeeping, net deletions).
- **Phase 2.5e** — Optional Premium AI polish (hero-headline punch + weekly opener), gated behind `client-briefing-v2-ai-polish`. Runs AFTER 2.5d so it builds on a clean `briefing-prompt.ts`.

The whole redesign is gated behind the existing `client-briefing-v2` feature flag. Workspaces with the flag off see the legacy `<OverviewTab>`. No data migration required at any phase.

---

## Reuse Map (load-bearing — read first)

This redesign is contract-bound to reuse the following existing code. New implementers MUST consult this section before writing replacement code. Anything not on this list is fair game to build new.

### Already shipped in Phase 2 (extend, don't rewrite)

| Component / module | Path | Role in redesign |
|---|---|---|
| `<HeroStoryCard>` | `src/components/client/Briefing/HeroStoryCard.tsx` | Lead Story container. Add a "data receipt" line below the metric pills (~30 LOC extension). |
| `<SecondaryStoryRow>` | `src/components/client/Briefing/SecondaryStoryRow.tsx` | Watch List rows. Works as-is. |
| `<ActionQueueStrip>` | `src/components/client/Briefing/ActionQueueStrip.tsx` | Top-of-page action strip. Add stale-item color escalation (~50 LOC). |
| `<FreeTierUpgradeCTA>` | `src/components/client/Briefing/FreeTierUpgradeCTA.tsx` | Free-tier CTA. Keep as-is. |
| `<InsightsBriefingPage>` | `src/components/client/Briefing/InsightsBriefingPage.tsx` | Composer. Extend to mount new sections. |
| `<MonthlyDigestContent>` | `src/components/client/MonthlyDigest.tsx` | Free-tier digest body. Keep. |
| `renderDrillInUrl` | `src/components/client/Briefing/drillIn.ts` | Deep-link helper. Keep. |
| `useClientBriefing` | `src/hooks/client/useClientBriefing.ts` | Briefing data hook. Keep. |
| `briefingApi` | `src/api/briefing.ts` | API client. Keep. |
| `BriefingStory` / `BriefingDraft` types | `shared/types/briefing.ts` | Story shape contract. May extend with optional `dataReceipt: string`. |
| `briefing_drafts` table | `server/db/migrations/077-briefing-drafts.sql` | Storage. Keep. |
| `markPublished`, `getLatestPublishedBriefing`, etc. | `server/briefing-store.ts` | DB layer. Keep. |
| Cron orchestration | `server/briefing-cron.ts` | Replace AI step with deterministic mapper, keep everything else. |

### Pre-existing platform primitives (compose; do NOT duplicate)

| Primitive | Path | Use in redesign |
|---|---|---|
| `<StatCard size="hero">` | `src/components/ui/StatCard.tsx` | Pulse strip cells (4 of them) |
| `<MetricRing>` | `src/components/ui/MetricRing.tsx` | Pulse cell for Site Health |
| `<TierGate>` | `src/components/ui/TierGate.tsx` | Free-tier gating |
| `<EmptyState>`, `<LoadingState>`, `<Icon>` | `src/components/ui/` | Standard state handling |
| `<ContentGaps>` row layout | `src/components/strategy/ContentGaps.tsx` (admin) | **Port to client** as `<RecommendedForYou>` row treatment. Different CTAs (request brief vs draft brief), same visual structure. |
| `<InsightsDigest>` deterministic generators | `src/components/client/InsightsDigest.tsx` lines 64–372 | **Reference, don't extract.** The 12 generators here are tightly coupled to React props + DigestInsight client type. The new server-side templates source from typed `analytics_insights` payloads directly (different data path); InsightsDigest serves as a *spec for what shapes work*, not as code we lift. Confirmed by audit. |
| `monthly-digest.ts` selection logic | `server/monthly-digest.ts` | Reuse `getInsights()`, `getROIHighlights()` selection logic for templates. |
| `fmtNum`, `pct`, `formatNumbers` | `src/utils/formatNumbers.ts` (and equivalent) | All number rendering. ContentGaps duplicates `fmtNum` locally — fix when porting. |
| `computeOpportunityScore` | exported from `server/routes/keyword-strategy.ts` | Use as fallback when `gap.opportunityScore` is null. |
| `useClientData` | `src/hooks/useClientData.ts` | All Pulse + Action strip data already flows through this hook. No new orchestrator hook. |
| `useClientIntelligence` | `src/hooks/client/` | Composite health score + clientSignals slice. |
| `<TierGate>` + existing upgrade modals | `src/components/ui/TierGate.tsx` | Free-tier gating + upgrade CTA. |

### Pre-existing data sources (no new endpoints)

| Data | Source | What it carries |
|---|---|---|
| `analytics_insights` typed payloads | `server/analytics-insights-store.ts` + `insight-enrichment.ts` | All 12 insight types with typed `data` + enrichment (page title, traffic deltas, page IDs) |
| `keywordStrategy.contentGaps[]` | `shared/types/workspace.ts` `KeywordStrategy` | Gap rows with `topic`, `targetKeyword`, `volume`, `difficulty`, `impressions`, `competitorProof`, `serpFeatures`, `trendDirection`, `suggestedPageType`, `intent`, `priority`, optional `opportunityScore` |
| ROI computation | `server/roi.ts` `computeROI()` | `organicTrafficValue`, `avgCPC`, `growthPercent`, per-page breakdown, `contentItems[]` (per-brief attribution) |
| Audit summary | `useClientAuditSummary()` → `/api/public/audit-summary/:wsId` | `siteScore`, `previousScore` (delta computable), issue counts |
| GA4 / GSC | `useClientGA4()`, `useClientSearch()` | `totalUsers`, `totalClicks`, `totalImpressions`, `comparison.changePercent.*` deltas |
| Strategy pageMap | `useClientStrategy()` | Per-page `currentPosition`, `previousPosition`, `clicks`, `impressions`, `pageTitle`, `cpc` |
| Action counts | `useClientData` exposes `pendingApprovals`, `unreadTeamNotes`, `contentPlanSummary?.reviewCells`, `contentRequests` array | All counts + their `createdAt` timestamps for stale-item escalation |
| `weCalledIt` predictions | `tracked_actions` + `action_outcomes` (admin-only today) | Phase 2.5c will add a client allowlist OR pipe through `latestBriefing` slice |

### Genuinely new code (allowed in this redesign)

| New | Phase | LOC est. | Justification |
|---|---|---|---|
| `server/insight-to-story.ts` | 2.5a | ~500 | Deterministic templates per InsightType. No equivalent exists. |
| `briefing-candidates.ts` `collectContentGapCandidates` | 2.5a | ~150 | New collector reading from existing `keywordStrategy.contentGaps[]`. |
| `server/briefing-templates/` directory (per-type template files) | 2.5a | ~600 (pure additive — not extraction) | Build deterministic templates from typed `analytics_insights` payloads directly. Audit found InsightsDigest generators are React-coupled; build server-native rather than extract. |
| `<PulseStrip>` component | 2.5b | ~80 | Composes `<StatCard>` + `<MetricRing>`. No new variants. |
| `<DataSpread>` component | 2.5b | ~200 | Genuinely new 2-column layout. No existing equivalent. |
| `<RecommendedForYou>` component | 2.5b | ~150 | Port admin `<ContentGaps>` layout, swap CTA target. |
| `<IssueSummaryLine>` component | 2.5b | ~50 | Renders deterministic line. |
| `<DateLine>` component | 2.5b | ~50 | Tiny. |
| `server/briefing-summary.ts` | 2.5b | ~80 | Generates issue summary from candidate composition. |
| `workspace_metrics_snapshots` table + module | 2.5c | ~250 | Confirmed needed (`roi_snapshots` is dollar-only). |
| `server/briefing-anchors.ts` | 2.5c | ~150 | "Best week since" formatter. |
| `weCalledIt` client allowlist edit | 2.5c | ~50 | `summarizeInsightsForClient` extension. |
| `milestone_attribution` story type | 2.5c | ~100 | Reuses `tracked_actions` table — no new state. |
| Optional AI hero-punch + weekly-opener (Premium, fail-soft) | 2.5e | ~200 | Two small AI passes. Reordered out of 2.5c on 2026-04-29 so they land on a clean `briefing-prompt.ts` after 2.5d's deletion pass. |
| Tests across all phases | each | ~1,200 total | Golden tests per template + component tests + integration |

**Revised total: ~3,650 LOC across three PRs.**

---

## Page Structure (the eight-stop reading rhythm)

The redesigned page follows this stop sequence top-to-bottom. Each stop has one job. Each is independently scrollable past.

```
═══════════════════════════════════════════════════════════════════
WEEK OF APR 28, 2026                                      ISSUE 17
═══════════════════════════════════════════════════════════════════

  A win at the top, two risks to watch, seven opportunities
  to consider.                                                       ← Issue Summary

  ⌐ 2 SEO changes need your review · 7 content opportunities      ⌐  ← Action Strip
                                                                       (only when items)
═══════════════════════════════════════════════════════════════════

THE PULSE                                              vs prev 28d  ← Pulse Strip
  ┌──────────┬──────────┬─────────────────┬──────────┐
  │   91     │   205    │   20 / 611      │  #15.1   │
  │  −2 vs   │  +6.8%   │  −4.8% / −38%   │  +1.2 Δ  │
  └──────────┴──────────┴─────────────────┴──────────┘

───────────────────────────────────────────────────────────────────

THE LEAD                                                            ← Hero Story
  [adaptive, materiality-driven, never competitor_alert]

───────────────────────────────────────────────────────────────────

THIS WEEK                                                           ← Data Spread
  WINS (≤3)                       │  RISKS (≤3)
                                  │

───────────────────────────────────────────────────────────────────

RECOMMENDED FOR YOU                                                 ← Recommended
  [3 gaps inline · "Show more" expand · sorted by opportunityScore]

───────────────────────────────────────────────────────────────────

ALSO THIS WEEK                                                      ← Watch List
  [≤6 secondary stories as divider rows]

───────────────────────────────────────────────────────────────────

  Next briefing arrives Monday May 5.       Ask the engine →        ← Footer
═══════════════════════════════════════════════════════════════════
```

### Reading rhythm timings (target ≤5 min total)

| Stop | Time | Reader's question |
|---|---|---|
| Dateline + Issue Summary | ~5s | "Where am I, what's it about" |
| Action Strip | ~5s | "Anything urgent today?" |
| The Pulse | ~10s | "Vital signs OK?" |
| The Lead | ~30s | "What's the news?" |
| This Week (Data Spread) | ~30s | "What changed?" |
| Recommended for You | ~60s | "What should I invest in next?" ← **upsell moment** |
| Also This Week (Watch List) | ~30s | "What else am I missing?" |
| Footer | ~5s | "When do I come back?" |

**Total: ~3 min engaged scan; ~5 min if reader drills into a story.** Fits the documented client behavior (≤5 min/week).

---

## Story Type Catalog

Each insight type maps to a deterministic template. Each template produces a `BriefingStory` shape with `headline`, `narrative`, `metrics[]`, `dataReceipt` (new optional field), `drillIn`. NO AI in this projection.

### Template structure (all types)

```
[CATEGORY · DATE]

  {Deterministic headline — anchored in a number}

  {1-3 sentence narrative — every sentence cites a number from
   typed insight data; no hedge words: "potentially", "could",
   "may", "appears", "suggests"}

  ┌─────────────┐  ┌─────────────┐
  │ {value 1}   │  │ {value 2}   │
  │ {label 1}   │  │ {label 2}   │
  └─────────────┘  └─────────────┘

  ─ Source: {data origin} · {comparison anchor} · {workspace's
    actual numerical context}

                                          {Drill-in label →}
```

### Voice rules (banned in narratives)

- **Hedge words**: *potentially, could, may, appears, suggests, might, seems*
- **Tense violations**: future-tense speculation ("could rank," "might capture") — only past or present
- **Vague comparators**: "a bit," "somewhat," "noticeable"
- **Generic phrases**: "in line with industry trends," "worth keeping an eye on"

Required:
- Every narrative cites at least one number sourced from the typed payload
- Every metric badge is rendered with tabular figures (`+12%`, `#11→#4`, `$340`)
- Every story has a single `drillIn` destination
- Comparison anchors required: `+12%` always reads `+12% MoM` or `+12% vs prev 28d` — never bare

### Type catalog

| InsightType | Phase 2.5a status | Lead-eligible? | Template fields used |
|---|---|---|---|
| `ranking_mover` (positive) | ✅ Ready | Yes | pageUrl, pageTitle, keyword, currentPosition, previousPosition, clicksDelta |
| `ranking_opportunity` | ✅ Ready | Yes | keyword, pageUrl, pageTitle, currentPosition, gapToPageOne, searchVolume |
| `anomaly_digest` (positive) | ✅ Ready | Yes | metric, magnitude, direction, period, baseline, currentValue |
| `ctr_opportunity` | ✅ Ready | Watch List | query, pageUrl, currentCtr, expectedCtr, impressions, currentPosition |
| `freshness_alert` | ✅ Ready | Watch List | pageUrl, lastUpdated, daysSinceLastAnalysis |
| `cannibalization` | ⚠️ Light derive | Watch List | competing pages, shared keyword, computed severity |
| `content_decay` | ⚠️ Simplified | Yes (degraded) | currentClicks, baselineClicks, decayPercent (peak tracking deferred to Phase 3) |
| `audit_finding` (workspace-level) | ⚠️ Simplified | Yes (when scoreΔ ≥5) | currentScore, previousScore, scoreDelta, issueMessages (parsed) |
| `weCalledIt` | ⚠️ Path-through (2.5c) | Yes | prediction text, predicted date, current outcome, days-to-deliver |
| `competitor_alert` | ✅ Ready | **Never lead** | competitor name, alertType, keyword, snapshotDate |
| `page_health` | ⚠️ Simplified | Watch List | pageUrl, score (CWV values deferred — no LCP/INP fields today) |
| `content_gap` (NEW collector) | ✅ Ready | Yes | targetKeyword, volume, difficulty, impressions, competitorProof, opportunityScore |
| `milestone_attribution` (Phase 2.5c) | New (~100 LOC) | Yes | brief topic, target page, current clicks, value crossed threshold |

### Sample rendered templates

#### `ranking_mover` — Lead

```
RANKING WIN · APR 28

Your fleet maintenance page just cracked the top 5.

  /services/fleet for "fleet maintenance austin" rose from
  #11 to #4 over the last 14 days. Clicks for the page jumped
  from 23 to 142 in the same window.

  ─ Source: GSC last-28-day vs prior-28-day window. Verified
    across 7 daily samples since Apr 14.

  ┌ #11 → #4 ┐ ┌ +119 clicks ┐
  └ position ┘ └  2-week Δ   ┘

                                          View page details →
```

#### `content_gap` — Lead variant

```
NEW OPPORTUNITY · APR 28

A keyword you don't yet target is searched 8.6K times per
month locally.

  "best fleet maintenance schedule" sees high local intent.
  You haven't published anything targeting the query, but
  Plumber Pros ranks #2 and is capturing the bulk. A fresh
  page could realistically land top-5 within 90 days.

  ─ Source: SEMrush volume 8.6K/mo · KD 27 (medium) · Plumber
    Pros at #2 since Jan 14. Your impressions for the term:
    142/mo (you appear at #50–100 occasionally). ≈ $425/mo
    ad-spend equivalent at rank #3.

  ┌    8.6K    ┐ ┌    KD 27    ┐
  │   vol/mo   │ │ achievable  │
  └────────────┘ └─────────────┘

                                            Generate Brief →
```

#### `weCalledIt` — Lead (the trust play)

```
WE CALLED IT · APR 28

The prediction we made on Mar 14 just landed.

  We told you /services/fleet would crack page 1 within 60
  days, based on its rising impressions trend and the brief
  we delivered Feb 22. As of this week, it's ranking #4 for
  "fleet maintenance austin" with 142 clicks in the last 14
  days.

  ─ Original prediction recorded Mar 14 (#wci_24): "Likely to
    enter top 10 within 8 weeks." First crossed Apr 22 — 39
    days, ahead of schedule.

  ┌  predicted ┐ ┌   39 days   ┐
  │   Mar 14   │ │  to deliver │
  └────────────┘ └─────────────┘

                                          View page details →
```

---

## Data Plumbing Requirements

### Phase 2.5a (server-side rebuild)

1. **`server/insight-to-story.ts`** (NEW) — One deterministic mapper function per insight type. Takes the typed `data` payload + enrichment + workspace context. Returns `BriefingStory`.

2. **`server/briefing-candidates.ts` extension** — Add `collectContentGapCandidates(workspaceId)` that reads `keywordStrategy.contentGaps[]`, computes `opportunityScore` via `computeOpportunityScore()` when missing, returns standard candidate format. Materiality scoring already handles them.

3. **`server/briefing-cron.ts` modification** — Replace the AI call with deterministic projection. Keep AI call as opt-in only via flag (`outcome-ai-injection` already exists for this).

4. **No DB changes.** No new endpoints.

### Phase 2.5b (layout sections)

5. **`server/briefing-summary.ts`** (NEW) — Deterministic generator from candidate composition. Output: single-line "issue summary" string.

6. **No DB changes.** No new endpoints.

### Phase 2.5c (anchors + AI polish)

7. **`workspace_metrics_snapshots` table** (NEW) — One row per workspace per week. Columns:
   ```sql
   CREATE TABLE workspace_metrics_snapshots (
     id              INTEGER PRIMARY KEY AUTOINCREMENT,
     workspace_id    TEXT NOT NULL,
     snapshot_date   TEXT NOT NULL,           -- YYYY-MM-DD
     total_clicks    INTEGER,
     total_impressions INTEGER,
     avg_position    REAL,
     audit_score     INTEGER,
     organic_traffic_value REAL,
     computed_at     INTEGER NOT NULL,
     UNIQUE(workspace_id, snapshot_date)
   );
   CREATE INDEX wms_workspace_date ON workspace_metrics_snapshots(workspace_id, snapshot_date);
   ```
   Retention: 90 days rolling. Updated by piggyback on existing weekly cron (no new cron).

8. **`server/briefing-anchors.ts`** (NEW) — Computes "best week since X," "first time below X," "longest streak" anchors against the snapshot table.

9. **`weCalledIt` client allowlist** — `summarizeInsightsForClient` exists at `server/routes/client-intelligence.ts:36`. Extend its allowlist to permit weCalledIt entries, OR pipe through the `latestBriefing` slice. Recommend: pipe through `latestBriefing` (Phase 2 already added the slice field) so weCalledIt rendered as a story is independent of insights serialization.

10. **`milestone_attribution` story type** — Triggered when a `contentItems[]` traffic value crosses a threshold (e.g., first time a delivered brief hits $X/mo or N clicks/mo). Baseline captured by tying briefs to existing `tracked_actions` rows — no new table.

---

## Tier Variants

| Section | Free | Growth | Premium |
|---|---|---|---|
| Dateline | ✅ | ✅ | ✅ |
| Issue Summary | ✅ (preview "Upgrade for the full briefing") | ✅ | ✅ |
| Action Strip | ✅ | ✅ | ✅ |
| The Pulse | ✅ (4 cells) | ✅ | ✅ |
| The Lead | Locked (preview headline + upgrade CTA) | ✅ | ✅ + AI hero punch |
| Data Spread | Locked | ✅ | ✅ |
| Recommended for You | Ghosted rows + "Upgrade to Growth" | Per-gap "Generate Brief" CTA | "Generate Brief (included)" |
| Watch List | ❌ | ✅ | ✅ |
| Monthly Digest legacy | ✅ (un-gated tease) | ❌ | ❌ |
| Footer | "Upgrade to unlock weekly briefings" | ✅ | ✅ |

**Free-tier rendering simpler than full design (per audit decision):** action strip + upgrade CTA + un-gated `<MonthlyDigestContent>`. No half-rendered states. Same as Phase 2 today. Re-evaluate after paid tiers ship cleanly.

---

## AI's Residual Scope

**Default state: zero AI calls per briefing render.** Pure deterministic projection.

Two optional AI passes, both gated behind the `client-briefing-v2-ai-polish` flag, both fail-soft to deterministic templates, both Premium-only. Both ship in **Phase 2.5e** (post-cleanup) — see the phasing reorder note at the top of this spec:

1. **Hero headline punch** (Phase 2.5e) — given the deterministic headline + the underlying typed insight, request a punchier 5–12-word version. Cost: ~50 tokens per briefing. Fail-soft: original deterministic headline.

2. **Weekly opener line** (Phase 2.5e) — one short narrative line above the Pulse strip ("A quiet week on the rankings front, with momentum building in fleet content"). Cost: ~80 tokens per briefing. Fail-soft: omit.

Both AI passes:
- Require `client-briefing-v2-ai-polish` sub-flag (default off)
- Only render for tier === `premium`
- Use existing `callAI({ provider: 'anthropic' })` infrastructure
- Defer to deterministic output on any error (timeout, malformed response, rate limit)

**No AI is allowed in narrative rendering, metric selection, drill-in resolution, or candidate selection.** Voice fidelity depends on this constraint.

---

## Out of Scope

- **Phase 3 (navigation simplification)** — separate spec, not blocked by this redesign.
- **Phase 4 (email + narrative endpoint convergence)** — original briefing spec covers this.
- **Peak tracking for content_decay** — would require historical click time-series per page. `content_decay` template runs in degraded mode (clicks delta + decayPercent only) until that data exists.
- **Core Web Vitals fields on `page_health`** — would require external instrumentation (PageSpeed Insights API or Web Vitals library). `page_health` template renders score-based summary only.
- **Structured `audit_finding` category breakdown** — `issueMessages` is a delimited string today. Template parses it best-effort. Building a typed `categories: AuditCategory[]` field is a separate cleanup.
- **Mobile-specific layout** — A3-style stacks naturally on mobile. No dedicated mobile design needed.
- **Historical anchors before Phase 2.5c** — Phase 2.5a + 2.5b ship without "best since X" framing. Still valuable.
- **AdminChat / ClientChat awareness of new story types** — slice population already exists for `latestBriefing`. Templates are not chat-aware.

---

## Acceptance Signals

The redesign is successful if:

1. **Voice quality** — every published briefing's narratives cite specific numbers (zero hedge words from the banned list). Sample 5 briefings post-2.5a; manual pass.
2. **Content-gap surfacing** — every briefing for a workspace with ≥3 unfulfilled content gaps surfaces at least one as a story (lead, secondary, or in `RecommendedForYou`).
3. **5-minute test** — a returning client opens `/client/:id` and reports they got the week's headline within 30 seconds; could close the tab without missing critical info; could find a "next thing to invest in" within 60 seconds.
4. **Data fidelity** — pr-check rule blocks hedge words in `server/insight-to-story.ts` template files.
5. **No AI fallthrough degrade** — when both AI sub-flags are off, briefings still render fully (verified by integration tests using disabled flags).
6. **Tier separation** — Free workspaces never query the public briefing endpoint; Growth workspaces never receive AI-punched headlines; Premium workspaces' briefings carry `dataReceipt` strings on every story.
7. **Reuse contract** — diff review on each PR confirms the components/utilities listed in the Reuse Map are imported, not reimplemented.

---

## Verification Tasks for Implementation Plans

Each phase plan must verify before committing to file changes:

### Phase 2.5a plan must verify:
1. **Every insight type's typed `data` payload** — confirm fields the template assumes are present in production data. Use staging workspaces (hmpsn studio, Swish) to check populated values.
2. **`computeOpportunityScore` signature** — confirm exported from `server/routes/keyword-strategy.ts`, callable for fallback computation.
3. **`monthly-digest.ts` selection logic** — confirm `getInsights()` and `getROIHighlights()` are reusable as shared utilities (extract or call).
4. **Banned-word pr-check rule** — write the regex, verify it doesn't false-positive on legitimate uses elsewhere in the codebase.
5. **AI call gating** — confirm `briefing-cron.ts` can be configured to skip AI per-flag without breaking the existing "manual generate-now" path.

### Phase 2.5b plan must verify:
1. **`<StatCard>` size variants** — confirm "hero" size renders correctly inside a 4-column Pulse strip on desktop AND mobile.
2. **`<ContentGaps>` admin component** — read every line, identify CTAs that need parameterization for client port. Estimate the diff before declaring "port" instead of "rebuild."
3. **`<MetricRing>` size variants** — confirm size=44 (current OverviewTab usage) works inside a Pulse cell.
4. **Data Spread layout primitives** — confirm there's no existing 2-column win/risk component (the agent confirmed there isn't, but verify before building).
5. **Issue summary template** — write the 4–6 deterministic phrasings, confirm they cover every realistic candidate composition.

### Phase 2.5c plan must verify:
1. **`workspace_metrics_snapshots` migration number** — check current highest in `server/db/migrations/` and pick next sequential.
2. **Existing weekly cron** — find the right cron to piggyback on for snapshot writes (likely `intelligence-crons.ts` or `briefing-cron.ts`'s tick).
3. **`tracked_actions` reuse for `milestone_attribution`** — confirm we can write a baseline_snapshot at brief delivery time without breaking the existing outcome-tracking flow.
4. **`weCalledIt` client allowlist path** — decide between (a) `summarizeInsightsForClient` extension and (b) `latestBriefing` slice path-through. Plan documents the choice with reasoning.

### Phase 2.5e plan must verify (AI polish, post-cleanup):
1. **`client-briefing-v2-ai-polish` sub-flag** — add to `shared/types/feature-flags.ts` before any AI code lands.
2. **Fail-soft testing** — golden tests that exercise every AI-error path (timeout, rate-limit, hedge-word violation, word-count violation) and confirm deterministic fallback renders.
3. **`briefing-prompt.ts` clean slate** — confirm 2.5d's deletion pass left the file empty (or fully removed). 2.5e re-adds only `punchHeroHeadline` + `writeWeeklyOpener`.

---

## Phasing Strategy (per-PR breakdown)

### Phase 2.5a — Server-side template rebuild

**PR scope:** Backend only. Zero frontend changes.

**Files touched:**
- NEW: `server/insight-to-story.ts`
- NEW: `server/briefing-templates/` directory — per-type template modules (built fresh against typed insight payloads; not extracted from React-coupled InsightsDigest)
- MODIFIED: `server/briefing-candidates.ts` (add content gap collector)
- MODIFIED: `server/briefing-cron.ts` (replace AI step)
- MODIFIED: `server/briefing-prompt.ts` (keep but make AI passes opt-in)
- NEW: pr-check rule for banned hedge words
- NEW: `tests/unit/insight-to-story.test.ts` (golden tests per type)
- NEW: `tests/integration/briefing-content-gap-collector.test.ts`

**Validates:** "Data-rooted templates feel better than AI prose."

**Soak:** Ship behind `client-briefing-v2`. Toggle on for hmpsn studio + Swish for one week. Read sample briefings. Confirm voice. THEN proceed to 2.5b.

### Phase 2.5b — New layout sections

**PR scope:** Frontend additions + small server helper.

**Files touched:**
- NEW: `src/components/client/Briefing/PulseStrip.tsx`
- NEW: `src/components/client/Briefing/DataSpread.tsx`
- NEW: `src/components/client/Briefing/RecommendedForYou.tsx` (port from admin ContentGaps)
- NEW: `src/components/client/Briefing/IssueSummaryLine.tsx`
- NEW: `src/components/client/Briefing/DateLine.tsx`
- MODIFIED: `src/components/client/Briefing/InsightsBriefingPage.tsx` (compose new sections)
- MODIFIED: `src/components/client/Briefing/HeroStoryCard.tsx` (data receipt line)
- MODIFIED: `src/components/client/Briefing/ActionQueueStrip.tsx` (stale escalation)
- NEW: `server/briefing-summary.ts`
- NEW: component tests

**Validates:** "The new visual rhythm reads better than Phase 2's magazine."

**Soak:** Same workspaces. One more week. Then decide on 2.5c.

### Phase 2.5c — Anchors + outcome stories

**PR scope:** Backend infra. Anchors + two new story types (weCalledIt, milestone_attribution).

**Files touched:**
- NEW: migration `079-workspace-metrics-snapshots.sql`
- NEW: `server/workspace-metrics-snapshots.ts`
- NEW: `server/briefing-anchors.ts`
- NEW: `server/briefing-templates/we-called-it.ts`
- NEW: `server/briefing-templates/milestone-attribution.ts`
- MODIFIED: per-template anchor wiring (e.g. `ranking-mover.ts`, `audit-finding.ts` — others opt-in incrementally)
- MODIFIED: `briefing-candidates.ts` (collectors) + `briefing-cron.ts` (dispatch)
- NEW: `milestone_attribution` InsightType (4-place lockstep)
- Tests

**Validates:** Historical anchor framing + outcome attribution.

### Phase 2.5d — Cleanup (housekeeping, NET DELETIONS)

**PR scope:** Delete the dead Phase 1/2 AI narrative path. See plan §"Phase 2.5d" for the full audit list.

### Phase 2.5e — Premium AI polish (OPTIONAL)

**PR scope:** AI hero-headline punch + weekly opener, both gated behind `client-briefing-v2-ai-polish` AND `tier === 'premium'`. Built fresh on the cleaned-up `briefing-prompt.ts` from 2.5d.

**Files touched:**
- MODIFIED: `shared/types/feature-flags.ts` (new sub-flag)
- NEW content in: `server/briefing-prompt.ts` (`punchHeroHeadline`, `writeWeeklyOpener`)
- MODIFIED: `server/briefing-cron.ts` (post-template AI block, fail-soft)
- MODIFIED: `shared/types/briefing.ts` (`weeklyOpener?: string` on `PublishedBriefingResponse`)
- MODIFIED: `src/components/client/Briefing/InsightsBriefingPage.tsx` (renders opener above DateLine)
- Tests

**Validates:** Editorial polish for Premium. Flag-flip is the rollback.

**Optional:** If 2.5c feels done at the soak interval, skip or defer indefinitely. Anchors are the only piece that genuinely improves the editorial voice; AI passes are tier-polish.

---

**End of spec.** Five plan PRs are tracked in the master plan document (`docs/superpowers/plans/2026-04-29-client-insights-redesign.md`).
