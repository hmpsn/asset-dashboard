# Strategy v2 — "SEO Command Center" — Spec

**Date:** 2026-06-17
**Status:** Approved direction. Supersedes the Phase 4 `Decide/Act/Reference` *bucketing* layout (currently behind the `strategy-decision-bands` flag). Net-new information architecture that **reuses** the Phase 0–5 components rather than replacing them.
**Owning context(s):** primary TBD via audit (likely `analytics-intelligence` for the recommendation/queue engine), with secondary integrations across `seo-health` (recommendations type, rankings, backlinks), `content-pipeline` (content opportunities → briefs), `billing-monetization` (per-item purchase / tier gating), and `client-portal` (client spin-out). The audit names the precise owner.

---

## Problem

After Phases 0–5 shipped, the Strategy page is still a ~20-card vertical wall (`src/components/KeywordStrategy.tsx:465`). The 3-band layout *relabeled* the pile (Decide/Act/Reference) but did not reduce density or create a decision narrative. `StrategyBand` is just a label + rule + `space-y-8` children. Every card renders at equal weight, so the page has no opinion about what matters. Owner verdict (2026-06-17): "noisy, overwhelming, not leading me through a journey."

## North Star

A **one-stop shop** that answers, in order:
1. **Where does this site sit?** (orientation)
2. **What moves the needle fastest?** (prioritized action)
3. **How do we serve the client well?** (delivery + monetization)

Grounded in the dominant SEO-platform pattern (SEMrush / Ahrefs / Moz): one score + one trend (orient) → impact-ranked actions with "why/how" (act) → breakdowns on demand (evidence), with competitive analysis as a distinct research surface.

## Information Architecture: Orient → Act → Evidence

### Main page (Overview tab)
- **Orient** — ONE visibility score (0–100, colored per `scoreColor()` bands: ≥80 emerald / ≥60 amber / <60 red) + ONE hero trend chart (organic clicks, 6 mo) + a compact 4-stat strip (clicks / impressions / ranked kw / avg position, each with delta) + a one-line AI verdict. Replaces today's `StrategyStatGrid` + scattered orientation cards.
- **Act (the hero)** — a SINGLE impact-ranked action queue. `Decide` + `Act` bands collapse into one ranked list (to the user they are one category: "things to do"). Content opportunities lead. The #1 lever is visually elevated. Filter chips (All / Content / Technical / Quick wins) with counts. Each row = title + target page/kw + **projected impact (`$/mo` or clicks)** + a **"turn into work" CTA** (admin: Create brief / Create cluster / Create refresh / Fix; client: Approve / Add to plan). This is the monetization surface.
- **Evidence (on demand)** — interior sub-tabs under Strategy, NOT a scroll-past pile. The Reference band (10 cards) dissolves into three tabs.

### Interior tabs (`?tab=content|rankings|competitive`, two-halves deep-link contract)
- **Content opportunities** (the money page) — net-new gaps, decaying-page refreshes, topic-cluster coverage. Each item priced + "Create brief/refresh/cluster". A summary line ("N opportunities · ~$X/mo combined value"). Path from opportunity → brief → pipeline → invoice is explicit.
- **Rankings & movements** — position distribution, 30-day movements (improved/declined/new/lost), striking-distance (11–20). **Summarizes and deep-links into the Keyword Hub; does NOT rebuild keyword tracking.**
- **Competitive & backlinks** — share of voice vs competitor set, keyword gaps (they rank / you don't) with Create-brief, backlink profile (ref domains / authority / new / lost). The distinct "research mode" surface.

### Client view (spin-out — thin reframe of the SAME data, not a second system)
- Plain-language verdict + visits trend (no jargon, no admin terms).
- "Recommended this month" — recs as **Approve** (retainer-included) and **Add · $price** (à-la-carte add-on).
- Competitive comparison gated as **Premium** (`<TierGate>`).
- **No purple.** Narrative, outcome-oriented framing.

## Design / UX laws (non-negotiable)
- Teal = actions only. Blue = data only. Emerald = good/success. Score colors via `scoreColor()`/`scoreColorClass()`. No purple in any client-facing surface.
- One hero chart on the main page (trend). Breakdown charts (distribution bars, share-of-voice bars, coverage bars) live on the interior tabs. No gauges, no pies, no per-card sparklines.
- Shared UI primitives only (`SectionCard`, `StatCard`, `MetricRing`, `Badge`, `TabBar`, `EmptyState`, `TierGate`, etc.). No hand-rolled cards/stats.
- Mobile-first; progressive disclosure (summary first).

## Decisions locked (2026-06-17)
1. Interior pages = **sub-tabs under Strategy** (one surface), NOT top-level routes. Competitive stays a tab for v1 (may graduate later).
2. **Intelligence signals fold INTO the action queue** — a signal that matters is a recommendation, not a peer card.
3. **Reuse the Keyword Hub** — Rankings tab summarizes + deep-links; never forks tracking.
4. Client view = **thin reframe** of the same data; competitive = Premium; no purple.
5. Ship **behind a flag** (new `strategy-command-center` flag, or extend `strategy-decision-bands` — audit recommends). Flag-OFF must remain byte-identical to the current shipped behavior until a deliberate cutover after staging validation.

## Open questions — resolve in the pre-plan audit (owner defaults to confirm)
1. **Visibility score (0–100)** — the one genuinely net-new top-line metric. Default: volume-weighted average position normalized 0–100 (SEMrush-style). Audit must first determine whether an equivalent score already exists (analytics-intelligence / seo-health / workspace overview) before we build one.
2. **Impact `$/mo`** — default: reuse the existing recommendation/opportunity value model (`opportunity.value` / `emvPerWeek` / `impactScore`, already sorted on by `DecisionQueue`). Audit must confirm every rec type surfaced in the queue carries a real value (no blanks).
3. **Monetization model** — default: hybrid (retainer-approve + purchasable à-la-carte add-ons / Premium). Audit must map the existing content-purchase / pipeline / Stripe wiring so the CTA paths are real, not invented.

## Non-goals (this effort)
- NOT deleting `legacyAnalysis` or removing the existing flag yet — cutover happens after the new IA is staging-validated.
- NOT rebuilding the Keyword Hub or any surface that already exists — consolidate and link.
- NOT a whole-repo reorganization. New/adjacent files follow `platform-organization.md` placement; no churn of unrelated files.

## Success criteria
- Main Strategy page presents ~5 functional zones (down from ~20 equal cards).
- Every action-queue row shows a real, sourced impact value and a real CTA wired to an existing flow.
- Phase-per-PR; each phase flag-gated; flag-OFF byte-identical to current shipped Strategy.
- Rankings tab demonstrably links into the Hub (no duplicated tracking UI).
- Client view ships as a thin reframe reusing the same server data + tier gating.
- All quality gates pass (typecheck, build, full vitest, pr-check); docs updated (FEATURE_AUDIT, roadmap, BRAND_DESIGN_LANGUAGE if UI tokens change).

## Reference
- High-fidelity approved mockups: main + 3 interior tabs + client view (this session, 2026-06-17).
- Component inheritance from Phases 0–5: merged competitor surface (`AuthorityAndBacklinks`), dedup, Hub deep-links (`keywordHubDeepLink`), signal recompute (`intelligence-recompute-job`) — all survive into the new homes.
- Memory: `project_strategy_redesign_v2_ia.md`, `project_strategy_redesign.md`.
