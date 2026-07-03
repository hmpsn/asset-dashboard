# Phase 0 Additive-Parity Ledger — Insights (client-facing insight delivery)

- **Surface:** Insights — the insight-store delivery path to the **client**: unified client insights feed, narrative view-model, monthly digest, intelligence summary, and the resolution/queue machinery behind them.
- **Zone (new IA):** CLIENT · OVERVIEW → **Insights Engine** (operator composition) + **Client portal** (client render). `UI Rebuild Handoff Brief.html` surface map: "CLIENT · OVERVIEW Cockpit Insights Engine" / "CLIENT-FACING Recommendations Client portal".
- **HEAD entry points:** `ClientTab 'overview'` legacy body (`src/components/client/OverviewTab.tsx:567-586`), client `health` tab Action-Plan slot (`src/components/ClientDashboard.tsx:631-641`), admin `Page 'analytics-hub'` insight-feed mounts (owned by the search-traffic audit, cross-referenced below).
- **Prototype views read:** `mockup/app.js` (view map: `issue` = "Insights Engine" `app.js:10`, `diagnostics` `app.js:16`, `portal` `app.js` PortalView), `mockup/strategy.js` (IssueView: signals digest `strategy.js:177-199`, lost visibility `strategy.js:202-229`, deep-diagnostic CTA `strategy.js:284-288`), `mockup/portal.js` (full client-facing render, read in full), `mockup/store.js` (shared client-thread store wiring portal actions → operator inbox).
- **Audit date:** 2026-07-02, branch `ui-rebuild-phase-0` (post-Reconcile staging HEAD).

## Scope boundary (fan-out rule)

Sibling audits already own adjacent insight consumers — this file does not re-claim them, it cross-references:

- **Admin priority InsightFeed** (`src/components/insights/*`, mounts in `AnalyticsOverview.tsx:199-210`, `SearchDetail.tsx:234-241`, `TrafficDetail.tsx:195-202`) → owned by `search-traffic.md` rows I1–I6 (all marked at_risk there; this audit **concurs**, see Open Q6).
- **Admin Strategy "The Issue" / IntelligenceSignals / LostQueryRecoveryCard** → owned by `engine.md`.
- **Admin WorkspaceHome** → `cockpit.md` (no insight mounts at HEAD — verified `grep -i insight src/components/WorkspaceHome.tsx` = 0 hits).
- **InsightsEngine.tsx** (client "Prioritized Action Plan", despite the name it renders the *recommendations* set: `useClientRecommendationSetView` `InsightsEngine.tsx:164`, endpoints `server/routes/recommendations.ts:118,150,173,289`) → belongs to the **Recommendations** surface audit. Listed here only as boundary row B1.
- **OutcomeSummary / WinsSurface / PredictionShowcaseCard / TheIssueClientPage** on client Overview → Client-portal/Cockpit-client audits; noted where they interlock with insights.

## HEAD anatomy of this surface

1. **Insight store & compute** — `getOrComputeInsights()` (`server/domains/analytics-intelligence/orchestrator.ts:47`), 21-value `InsightType` union (`shared/types/analytics.ts:190-211`), enrichment fields + resolution tracking + `bridgeSource` (`shared/types/analytics.ts:217-241`). Public read: `GET /api/public/insights/:workspaceId` with admin-only `?force=true` recompute (`server/routes/public-analytics.ts:204-223`).
2. **Client narrative view-model** — `GET /api/public/insights/:workspaceId/narrative` (`server/routes/public-analytics.ts:179-189`) → `buildClientNarrativeInsightsView()` (`server/client-insight-narrative-view-model.ts:12-19`): impactScore ≥ 20 filter, client-excluded types (`strategy_alignment`, `keyword_cluster` — `server/signal-story-registry.ts:50-55,343`), outcome-language story per type (`buildClientInsightStory`), `actionTaken` from resolution note, sorted by impactScore, capped at 15. Contract type `ClientInsight` (`shared/types/narrative.ts:4-15`).
3. **Client unified feed** — `InsightsDigest.tsx` on the legacy Overview: 13 locally-generated data cards (`InsightsDigest.tsx:66-374`), server-insight mapping with per-type icon map covering all 21 types (`InsightsDigest.tsx:378-400`), severity→sentiment/color (`:402-414`), per-type deep-link actions to client tabs (`:416-438`), merge + dedupe + priority/sentiment sort (`:462-476`), show-4/expand-to-10 (`:511-514,576-585`), Win/Opportunity/Needs-attention/Info badges (`:488-493`).
4. **Monthly digest** — `GET /api/public/insights/:workspaceId/digest` (`server/routes/public-analytics.ts:192-202`) → `generateMonthlyDigest` with 24 h cache + request coalescing + AI summary w/ deterministic fallback (`server/monthly-digest.ts:18-54`); client `MonthlyDigest.tsx` growth-gated via `TierGate` (`MonthlyDigest.tsx:33-37`).
5. **Client intelligence summary** — `GET /api/public/intelligence/:workspaceId` tier-sliced (`server/routes/client-intelligence.ts:23`); `IntelligenceSummaryCard.tsx` (counts grid, win-rate Growth+).
6. **Resolution machinery** — `PUT /api/insights/:wsId/:insightId/resolve` (state-machine-guarded, activity-logged, WS-broadcast, outcome-baseline recording — `server/routes/insights.ts:27-51`) and `GET /api/insights/:wsId/queue` (`server/routes/insights.ts:15-23`). **No frontend consumer at HEAD** (grep `src` = 0 hits); consumed via MCP only.
7. **MCP tools** — `get_insights`, `get_anomalies`, `get_unresolved_insights`, `resolve_insight`, `bulk_resolve_insights` (`server/mcp/tools/insights.ts:22-53`).
8. **WS wiring** — `clientInsightKeys()` invalidation (`src/lib/wsInvalidation.ts:80-85`); `INSIGHT_RESOLVED` (`:261-267,713-714`), `INTELLIGENCE_SIGNALS_UPDATED` (`:269`), `INSIGHT_BRIDGE_UPDATED` (`:346-351,707`); events registered in `server/ws-events.ts:62,65,95`.
9. **Flag interplay (critical):** `strategy-the-issue` ON swaps the whole legacy Overview body — including InsightsDigest, MonthlyDigest, IntelligenceSummaryCard — for `TheIssueClientPage` (`OverviewTab.tsx:158-244`), which does **not** consume `useClientInsights`/narrative at all (grep `src/components/client/the-issue/` = 0 hits). So at HEAD the narrative feed reaches clients only on the flag-OFF path. Flags default OFF (`shared/types/feature-flags.ts:90,110,115`).

---

## Capability table

Status legend: **preserved** (obvious home, same or better) · **improved** (prototype upgrades it) · **new_proposed** (prototype-only, needs sign-off) · **at_risk** (exists at HEAD, no visible home — uncertain = at_risk).

### A. Client insights feed (InsightsDigest, legacy Overview)

| # | Capability | Evidence (HEAD) | Status | Home in new IA | Notes |
|---|---|---|---|---|---|
| A1 | Unified client insights feed: server narrative insights merged + deduped with locally-generated data cards, priority/sentiment sort, server-first | `src/components/client/InsightsDigest.tsx:462-476,497-514` | **at_risk** | portal.js renders a *curated* story, not an auto feed; `TheIssueClientPage` has no narrative mount | The auto-computed→client path has no demonstrated home (Open Q1, Q2) |
| A2 | Server narrative insight cards: outcome-language headline/narrative/impact, `actionTaken` line, impactScore→priority, severity→Win/Opportunity/Needs-attention badge | `InsightsDigest.tsx:440-460,488-493`; `server/client-insight-narrative-view-model.ts:12-53`; `shared/types/narrative.ts:4-15` | **at_risk** | Closest analogues: portal "What we did" moves + "Opportunities we spotted" (`portal.js:543-572`) — both operator-staged | Prototype replaces auto-surfacing with a staged send boundary — behavior change needs sign-off (Open Q1) |
| A3 | 21-type icon map incl. `milestone_attribution`, `lost_visibility`, `local_visibility_shift`, `serp_feature_opportunity` | `InsightsDigest.tsx:378-400` | **at_risk** | — | If a staged model wins, every client-relevant type still needs a story/render path |
| A4 | Per-card deep-link action per insight type (navigate to performance/health/strategy/inbox client tab) | `InsightsDigest.tsx:416-438,536` | **at_risk** | portal.js has no per-card navigation (curated microsite) | Drill-in from an insight to its evidence is a HEAD behavior with no home |
| A5 | 13 local data-card generators: traffic trend, search trend, top-3 ranking wins, low-hanging (almost page 1), site health, Core Web Vitals, pinned key events, strategy quick wins, content gaps, new-vs-returning, organic share, content-plan progress (3 variants), position jump | `InsightsDigest.tsx:66-374` | **at_risk** (partial) | portal.js covers analogues: climbing rankings (`portal.js:432-442`), traffic chart (`:532-541`), health ring + fixes (`:552-560`), opportunities (`:568-572`) | **No portal analogue at all** for: CWV page-speed card (`:194-218`), new-vs-returning (`:273-295`), pinned key-events card (`:220-238` — partially the value band), content-plan progress (`:314-352`), low-hanging fruit (`:156-171`) |
| A6 | Show-4 / expand-to-10 progressive disclosure ("Show N more insights") | `InsightsDigest.tsx:511-514,576-585` | preserved | Portal sections are inherently bounded lists | Pattern, not a literal control |
| A7 | `siteIntelligenceClientView` per-workspace kill-switch: hides server-computed insights from the client while local data cards keep rendering | `OverviewTab.tsx:540,584`; `InsightsDigest.tsx:54-56,500-506`; toggle UI `src/components/settings/FeaturesTab.tsx`; serialized `server/serializers/client-safe.ts` | preserved (verify) | wsettings "client dashboard (portal) config" (Parity Ledger Workspace Settings row, `wsettings.js`) | The staged-send model may subsume it (nothing staged = nothing shown) — confirm during build |
| A8 | Client Overview empty/onboarding state (no GSC/GA4/audit → setup checklist) | `OverviewTab.tsx:588-619` | **at_risk** | portal.js always renders a populated story; `onboard.js` is operator-side | Every surface owes empty/loading/error/locked (Build Conventions); the *client* empty state is undemonstrated |
| A9 | `PerformancePulse` compact metric chips | `InsightsDigest.tsx:610-684` | n/a — dead code | — | Exported but **never mounted** at HEAD (repo-wide grep = 0 imports). No parity requirement; flag for deletion (Open Q7) |

### B. Adjacent client-Overview insight consumers (boundary rows)

| # | Capability | Evidence (HEAD) | Status | Home in new IA | Notes |
|---|---|---|---|---|---|
| B1 | Client "Prioritized Action Plan" (`InsightsEngine`, recommendations set: priority groups, status transitions, dismiss, purchase CTAs, regenerate job, premium framing) | `src/components/client/InsightsEngine.tsx:133-739`; mounted `ClientDashboard.tsx:631-641` | cross-ref | Recommendations surface (`recs.js` + `portal.js:568-572`) | **Owned by the Recommendations audit** — must confirm pickup |
| B2 | MonthlyDigest: AI monthly summary + wins + issues addressed + metric deltas + ROI highlights, growth-gated | `src/components/client/MonthlyDigest.tsx:16-46`; `shared/types/narrative.ts:17-50`; `server/monthly-digest.ts:18-54`; endpoint `server/routes/public-analytics.ts:192-202` | **at_risk** (partial) | portal "What we did this month" (`portal.js:543-547`) + value band (`:398-415`) | Portal sections are operator-staged; the *automated* AI digest w/ deterministic fallback + 24 h cache + ROI highlights (`ROIHighlight` incl. `attributedValue`) has no confirmed home (Open Q4) |
| B3 | IntelligenceSummaryCard: high-priority insight count, briefs in progress, action win rate (Growth+ TierGate) | `src/components/client/IntelligenceSummaryCard.tsx:14-81`; endpoint `server/routes/client-intelligence.ts:23`; tier slicing `server/client-insight-view-model.ts:33-44` | **at_risk** | — | No portal analogue for the counts grid; win rate partially covered by Action Results (cross-ref `cockpit.md`/outcomes) |
| B4 | PredictionShowcaseCard ("we called it" predictions) gated on server-populated `clientIntel.weCalledIt` | `OverviewTab.tsx:560`; `src/components/client/PredictionShowcaseCard.tsx` | **at_risk** | — | Prediction-proof framing has no portal section; candidate fold into portal hook/value band |
| B5 | Tier gating + upsell teasers on client insight surfaces (`TierGate` growth+ on MonthlyDigest, win rate; `onGateHit` upsell tracking) | `MonthlyDigest.tsx:33-37`; `IntelligenceSummaryCard.tsx` (TierGate import); FEATURE_AUDIT.md:4708 (7) | **at_risk** | — | portal.js shows zero tier gating/locked states. Monetization semantics must not be dropped (Open Q3) |

### C. Server pipeline, resolution, agents (survives UI rebuild by default)

| # | Capability | Evidence (HEAD) | Status | Home in new IA | Notes |
|---|---|---|---|---|---|
| C1 | Insight compute + store: 21 types, enrichment (pageTitle fallback, strategy alignment, pipeline status, domain, impactScore), 24 h recompute TTL, stable IDs, bridge immunity | `server/domains/analytics-intelligence/orchestrator.ts:47`; `shared/types/analytics.ts:190-241`; FEATURE_AUDIT.md:4710 | preserved | n/a (backend) | Rebuild consumes, never re-computes |
| C2 | Public insights read + admin-only `?force=true` recompute | `server/routes/public-analytics.ts:204-223` | preserved / improved | Insights Engine "Recompute now" (`strategy.js:195,471`) | Prototype makes recompute a first-class button (currently URL-param-only) |
| C3 | Narrative filtering contract: impactScore ≥ 20, client-excluded types, cap 15, resolution note → `actionTaken` | `server/client-insight-narrative-view-model.ts:12-53`; `server/signal-story-registry.ts:50-55,343` | preserved | n/a (backend) | Whatever client render wins must keep this as the source contract |
| C4 | Resolution machinery: `PUT …/resolve` (state machine `validateTransition`, `addActivity`, `INSIGHT_RESOLVED` broadcast, outcome-baseline snapshot) + unresolved queue endpoint | `server/routes/insights.ts:15-51`; `server/outcome-tracking.ts` (recordInsightResolutionOutcome) | preserved (backend) | — | **No frontend consumer at HEAD** (admin ActionQueue UI was retired; MCP-only). Rebuild may add a resolve affordance in the Insights Engine — Open Q7 |
| C5 | MCP agent tools: `get_insights` / `get_anomalies` / `get_unresolved_insights` / `resolve_insight` / `bulk_resolve_insights` | `server/mcp/tools/insights.ts:22-53` | preserved | n/a | Agent path is UI-independent; operator + agent resolutions share the outcome-baseline seam |
| C6 | WS live-refresh wiring: `INSIGHT_RESOLVED` / `INSIGHT_BRIDGE_UPDATED` / `INTELLIGENCE_SIGNALS_UPDATED` / workspace-update → `clientInsights` + `intelligence` + `insightFeed` query keys, client + admin scopes | `src/lib/wsInvalidation.ts:80-85,261-269,346-351,707-714`; `server/ws-events.ts:62,65,95` | preserved | n/a | Rebuild must re-register every invalidation (Data Flow rule #2) |
| C7 | React Query cache contract: `clientInsights` / `monthlyDigest` / `intelligence` keys, 10 min/60 min/5 min staleTimes, `getSafe` fallbacks (never hard-fail the Overview) | `src/hooks/client/useClientInsightViewModel.ts:33-104`; `src/lib/queryKeys.ts:303-306` | preserved | n/a | View-model hook family survives as the data layer |
| C8 | Deep-diagnostic path from anomaly insights (client-side: diagnostic reports fetched for The Issue page; admin CTA owned by search-traffic I5) | `OverviewTab.tsx:119,240`; `src/hooks/admin/useDiagnostics.ts:17-30`; prototype `strategy.js:284-288`, `diagnostics.js`, `app.js:16` | preserved (verify) | Insights Engine → Deep diagnostic (Parity Ledger Diagnostics row: **improved**) | Note the *admin-surface* ledger also carries a Diagnostics **Gap** row (`Platform Parity Ledger.html:384`) for the old non-nav route — the two rows conflict; diagnostics audit should reconcile |

### D. Prototype-only functionality (needs sign-off)

| # | Capability | Prototype evidence | Status | Notes |
|---|---|---|---|---|
| D1 | Operator **send boundary**: client sees only what the operator stages/sends ("curated story, not the workbench" — verdict → value → proof) | `portal.js:1-13,594`; staging bridges `traffic.js:493-497`, `strategy.js:284-288` | new_proposed | Direct inversion of HEAD's auto-surfacing (A1/A2). Requires explicit owner decision — it changes *when* clients learn about issues |
| D2 | "Since your last visit" return hook + delta chips + value band with provenance badges ("agency estimate", "projected") | `portal.js:385-415,506-512` | improved | HEAD already has flag-gated seeds: `the-issue-client-return-hook`, outcome provenance (`shared/types/feature-flags.ts:110,416`; `src/components/client/the-issue/outcomeProvenance.ts`). Prototype completes them |
| D3 | Client one-tap greenlight on spotted opportunities → operator inbox as promotable request (two-way thread via shared store) | `portal.js:455-463,612-621`; `store.js:1-50` | improved | HEAD analogue is the recommendations respond loop (Recommendations audit); the *insight-to-request* graduation is an upgrade |

---

## Prototype coverage notes

**portal.js demonstrates (client render):** branded light-theme microsite; hook headline + lede driven by growth/defense direction (`portal.js:386-396`); value band (revenue recovered/protected vs target, page-one rankings, guides published); proof vitals w/ sparklines; climbing-rankings list; 12-month traffic chart; "What we did this month" moves w/ $/mo values + provenance; site-health ring + humanized fixes; "What's next" pipeline peek; opportunities w/ one-tap greenlight; provable-only leads bonus tile (`portal.js:465-471` — hides when unprovable); approve/request/reply conversation wired to the operator store; full-screen "view as client" chrome.

**portal.js omits (vs HEAD Insights):** auto-computed narrative insight cards (A1–A4); CWV, new-vs-returning, key-events, content-plan, low-hanging local cards (A5); automated AI monthly digest (B2); intelligence counts (B3); tier gates/locked states (B5); per-card deep links (A4); client empty/onboarding state (A8); negative-severity insights — the portal shows a "defending" framing (`portal.js:388-391`) but never a critical/warning insight card, whereas HEAD pushes `warning`/`critical` narrative insights directly to clients.

**strategy.js (Insights Engine, operator side)** demonstrates the staged-value composition, signals digest w/ recompute, lost-visibility recovery, and deep-diagnostic run — the operator half this surface's client render depends on (owned by `engine.md`).

## Parity Ledger reconciliation

- **No Gap/Partial rows exist for this surface** — because the Platform Parity Ledger is scoped to **admin surfaces only** ("MIGRATION PARITY AUDIT · ADMIN SURFACES"). The entire client-facing insight delivery path (InsightsDigest, narrative endpoint, MonthlyDigest, IntelligenceSummaryCard, tier gating) has **zero ledger rows**. This is a ledger coverage hole, not a resolved status — recorded here as the authoritative inventory.
- **Search & Traffic row** claims "Insights / narrative read-out — present ('story read-out')" (`Platform Parity Ledger.html:178,186`): this audit **concurs with search-traffic.md's contest** — `traffic.js` renders no insight feed; the claim holds only for narrative framing.
- **Diagnostics** appears twice: as a Gap row (`:384`) and as improved under Non-nav routes (`:417-420`, → Insights Engine → Deep diagnostic). The improved row appears to supersede the Gap row, but the ledger was not updated — flag to the ledger owner.

## Trade-offs (quick win vs full)

| Item | Quick win | Full version | Risk of quick win |
|---|---|---|---|
| Client insight feed (A1–A5) | Mount the existing `InsightsDigest` (tokens-only restyle) as an "Also detected" section inside the new portal below the curated story | Operator staging queue in the Insights Engine: server insights become stageable proof points/opportunities; only staged items render in the portal | Quick win preserves parity but keeps the auto-surfaced noise the redesign exists to kill; full version risks insights silently never reaching clients when operators don't stage (dark-loop regression) — needs a "unstaged insights" nudge |
| Monthly digest (B2) | Pipe the existing `/digest` payload (AI summary + wins + ROI highlights) into the portal's "What we did this month" section verbatim | Operator-composed monthly story with AI polish, digest as pre-filled draft | Quick win ships deterministic/AI copy unreviewed to clients — same trust exposure as today, so acceptable as a bridge |
| Tier gating (B5) | Wrap portal value-band/digest/opportunities in the existing `TierGate` component | Portal-native locked states per Content & Access conventions (light-theme lock treatments) | `TierGate`'s dark-theme styling clashes with the light portal; monetization semantics preserved either way |
| Resolution UI (C4) | Keep resolution MCP/agent-only (status quo — no UI consumer exists at HEAD) | Resolve/in-progress affordances on Insights Engine feed rows, wired to `PUT …/resolve` | Quick win leaves `GET /api/insights/:wsId/queue` dead code and keeps operator resolution invisible; zero client-facing risk |
| Per-card drill-ins (A4) | Static section anchors (insight card → portal proof section) | Deep links into the client's Performance/Health/Strategy equivalents in the new client IA | Quick win loses evidence drill-down; acceptable only if the portal sections themselves carry the evidence |

## Open questions (stop-and-ask — owner sign-off required)

1. **Auto-surface vs staged send boundary (A1/A2/D1).** HEAD auto-pushes server-computed narrative insights (including `warning`/`critical`) plus 13 local data cards to the client Overview with zero operator involvement. The prototype portal renders only operator-staged content below a send boundary. Is auto-surfacing intentionally retired (behavior change — clients would no longer see issues until staged), retained as a secondary feed, or hybrid (auto for positives, staged for negatives)?
2. **Which client Overview is the parity baseline?** HEAD has two: legacy flag-OFF body (mounts InsightsDigest/MonthlyDigest/IntelligenceSummaryCard) and `TheIssueClientPage` flag-ON (no narrative feed at all). The Handoff Brief gates all client-facing builds on a "client dashboard decision" sign-off. Which body's capabilities are the contract for the portal build?
3. **Tier gating on the portal (B5).** portal.js shows no Free/Growth/Premium differentiation or locked states. Confirm which portal sections are gated at which tier, or explicitly decide the portal is ungated (a monetization change).
4. **Automated monthly digest (B2).** Does the portal's "What we did this month" absorb the automated AI digest (auto-render), or become operator-composed? If composed, the automated digest + ROI-highlight capability is lost unless kept as a draft generator.
5. **IntelligenceSummaryCard + PredictionShowcaseCard (B3/B4).** Counts grid and "we called it" showcase have no portal home — fold into the value band / hook, or drop (drop = loss, forbidden without sign-off)?
6. **Admin insight feed home (cross-ref search-traffic I1–I6).** Confirm the Insights Engine will host the full 21-type priority feed (severity pills, domain filters, expandable evidence, diagnostic CTA) — the mockup shows only signals/lost-visibility/regression archetypes. One decision covers both audits.
7. **Intentional retirements.** `PerformancePulse` (dead export, A9) and the unconsumed `GET /api/insights/:wsId/queue` + resolve endpoints' missing UI (C4): confirm status-quo (MCP-only, delete dead component) vs re-home in the rebuild.

## Status counts

- preserved: 9 (A6, A7, C1–C3, C5–C8)
- improved: 3 (C2 recompute affordance, D2, D3)
- new_proposed: 1 (D1)
- at_risk: 10 (A1, A2, A3, A4, A5, A8, B2, B3, B4, B5)
- boundary/cross-ref (owned elsewhere, pickup required): B1 (Recommendations), search-traffic I1–I6, engine.md IssueView rows
- n/a dead code: A9
