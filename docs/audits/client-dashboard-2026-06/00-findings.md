# Client Dashboard Audit — Consolidated Findings (2026-06-11)

> Source material for the three recommendation documents in this folder.
> Produced by 8 parallel research agents auditing `origin/staging` (ff6c3caa).
> Scope: the client portal at `/client/:workspaceId/:tab` (and `/client/beta/...`).

## 1. Product vision & locked decisions (must-respect constraints)

**Value proposition:** transparent, AI-powered SEO partnership hub. Free data viewing
(GSC/GA4/health) is the sales tool and login habit; revenue comes from deliverables
(briefs $75–350, posts $250–2,500, fixes $19–299), tiers (Growth $249, Premium $999),
and the AI advisor that warm-hands-off into purchases.

**Locked decisions any recommendation must respect:**
- Unified inbox with three sections (Decisions / Reviews / Conversations), note-based
  routing (`docs/rules/inbox-section-routing.md`). Do NOT re-propose separate
  approvals/requests/content tabs.
- Soft-gating (blur + upgrade CTA), never hard-hiding paid features entirely.
- Free data visibility stays free (retention cornerstone).
- Client/admin route + auth split (ADR 0004). Client data flows through
  `ClientIntelligence` — the scrubbed, tier-gated projection (ADR 0002); new client
  data sources wire through intelligence slices, not ad hoc route reads.
- Long-running work uses the background job platform (ADR 0001).
- Three tiers (free/growth/premium) are canonical.

**Relevant pending roadmap items (don't re-propose as new ideas; align with them):**
#74 ROI dashboard polish, #88 self-service Stripe tier upgrade, #75 churn signals,
#77 usage tracking/limits, #25 client onboarding wizard, #30 "what happened this
month" AI summary, #31 content performance tracker, #33 anomaly detection,
#29 competitive monitoring, #52 responsive mobile layout, #22 multi-modal chat.
AI advisor phases 1–5 shipped; phase 6 (multi-modal responses) pending.
A `client-briefing-v2` feature flag exists with a magazine-layout Overview redesign
(`InsightsBriefingPage`) behind it.

## 2. Structure / information architecture

- Shell: `src/components/ClientDashboard.tsx` (821 lines), nav built by
  `clientDashboardNav.ts`, tab resolution in `src/lib/client-dashboard-tab.ts`.
- Tab visibility is conditional on tier, admin flags (`seoClientView`,
  `analyticsClientView`), workspace state (`contentPlanSummary.totalCells > 0`),
  `billingMode === 'external'`, and betaMode — with **no client-facing explanation**
  of why a tab is missing/locked.
- **Performance tab hides two full sub-tabs** (SearchTab 265 lines, AnalyticsTab 567
  lines) with no URL state — can't deep-link to Analytics (unlike Inbox's `?tab=`).
- Naming confusion: "Plans" (pricing/billing) vs "Content Plan" (content matrix).
- Legacy redirects are silent (old `approvals/requests/content/schema-review` URLs).
- Dead code: `ApprovalsTab.tsx` (586), `RequestsTab.tsx` (241), `ContentTab` legacy,
  `SchemaReviewTab.tsx` exist but are unmounted.
- betaMode = forced premium tier, no upsells/pricing/trial UI.

## 3. Core data tabs (overview, performance/search/analytics, health)

**Strong:** Overview (narrative subtitle, #1 priority card with "why", action-needed
banner, monthly digest, "we called it" predictions, insights digest); Search (takeaway
summary, health grid with interpretive labels, insight cards); Health (score bands,
top fixes, ranked Action Plan via recommendation engine, "last scanned" date).

**Weak:**
- **Analytics sub-tab is raw data**: no takeaway/narrative, no good/bad color coding
  on conversion rates, 12+ ungrouped events by default, powerful but unguided explorer.
- **Data freshness implicit everywhere except Health** — no "as of [time]" on metric
  cards; GA4 lags 24–48h and clients can't tell.
- **No forward-looking estimates**: low-hanging-fruit keywords lack "fix → expect +X
  clicks/mo"; health fixes lack $/traffic impact estimates (engine has
  `opportunity.emvPerWeek` internally).
- Cross-metric storytelling missing (e.g. organic share of total traffic callout).
- Tab-level redundancy is intentional and fine (summary on Overview, detail in tabs).

## 4. Workflow tabs (inbox, strategy, plans, roi, content-plan, brand)

- Inbox approval loop works (1 click inline single-action; 2 clicks batch via
  `DecisionDetailModal`); unified `ClientDeliverable` model + adapters.
- **Friction:** no global "needs my attention" badge in header (PriorityStrip is
  inbox-internal); silent post-approval transition (client doesn't know item moved to
  "Ready to publish"); changes_requested items vanish from inbox ("did they get it?"
  anxiety); work-order conversation threads have no comment-count badge; no batch
  approve with selective hold-back.
- Strategy tab is genuinely living (client keyword feedback, tracked keywords,
  business priorities) but "request content" requires navigating away.
- ROI tab: transparent formula, conservative, but **no methodology explainer** (i).
- Content-plan: client can flag cells but flag submission is silent (no toast), no
  notification when cells become ready; feels read-only.
- Brand tab: editable business profile; voice summary read-only.

## 5. Data layer

- 21 client hooks; hierarchical query keys; tabs lazy-loaded. Solid foundation.
- **GA4/GSC hooks have no `staleTime`** → every tab focus refires 7–12 parallel
  Google API calls (quota + perf risk). Files: `useClientGA4.ts`, `useClientSearch.ts`.
- **`getSafe()` masks failures silently** (activity, ranks, anomalies, approvals…)
  — errors render as "no data". `useClientQueries.ts`.
- **Only ~37 of 67 broadcast WS events have client handlers** — e.g. BRIEF_UPDATED,
  ANOMALIES_UPDATE, INTELLIGENCE_SIGNALS_UPDATED, OUTCOME_*, SCHEMA_* unhandled →
  stale-cache windows.
- `/api/public/intelligence/:wsId` can be 100–300KB, all slices recomputed per
  request, **no `assembledAt` staleness field**, no per-slice fetch param.
- Unpaginated list endpoints (approvals, actions, requests, content plan cells);
  audit-detail returns all pages+issues (~200KB on 50-page sites) with an N+1 diff
  computation (`public-portal.ts:273-295`).
- Legacy `/approvals/:batchId/apply` coexists with unified deliverables respond path.
- Client JWT is 24h with no refresh flow; no rate limiting on `/api/public/*`.

## 6. Untapped server-side value (exists, not surfaced to clients)

Theme: **clients see results but not process or justification** — agency work feels
like a black box. Assembled server-side but not client-visible:
- Outcome playbooks + per-action win rates/confidence (`outcome-playbooks.ts`,
  learnings-slice) — "schema fixes worked 73% of the time in your vertical".
- In-progress background jobs ("your audit is running", "generating 3 briefs…").
- 50+ admin-only activity types (process work) vs 20 client-visible (results only).
- Competitor snapshots (weekly keyword counts/traffic) — never shown client-side.
- Local SEO visibility matrix, service gaps, local-pack competitor brands.
- Diagnostic root-cause reports ("traffic dropped because…").
- Composite health score components (churn 40% + ROI 30% + engagement 30%) — score
  shown, weighting opaque.
- Keyword feedback patterns ("you approve 91% of suggestions").
- EEAT trust-signal inventory; page edit states (in review / live / needs fixes).
- Admin AI has full intelligence context; client chat gets a small subset.

Quick wins flagged: composite health ring breakdown (~2h), keyword feedback summary
card (~2h), "We Called It" narrative card expansion (~3h).

## 7. Monetization

- Tier system, trial mechanics, Stripe checkout, brief→post purchase flow all work.
- **Premium is nearly empty in code** — only "detailed outcome breakdown" is
  premium-exclusive. Documented-but-unbuilt: competitor keyword analysis, 3 impl
  hours/mo, 10% content discount, premium approvals.
- **Growth 50-chat/month limit counted but not enforced** (free 3/mo IS enforced).
- **Trial ends silently**: no day-10 warning email, no in-dashboard countdown banner
  (MONETIZATION.md specifies both).
- **Health tab shows issues with no "fix this ($X)" purchase path** — Stripe products
  (fix_meta, fix_alt, schema_page…) exist; cart exists (`useCart`); not wired into
  HealthTab.
- No chat-usage counter shown ("2 of 3 free conversations left").
- No bundle pricing logic in cart despite design (metadata packs etc.).
- No post-subscription confirmation/onboarding moment after Stripe checkout returns.
- `client-briefing-v2-ai-polish` flag described as premium-only but has no tier check.

## 8. Code quality

- **Design laws: fully compliant** (no purple/violet/indigo/rose/pink, no
  text-green-400, primitives used, scoreColorClass used). Z-index overrides all have
  escape hatches.
- God components: `health-tab/HealthTabSections.tsx` (881), `ContentTab.tsx` (843);
  large-but-OK: StrategyTab 873, UnifiedInbox 793, InsightsEngine 735.
- 1 unjustified eslint-disable: `useClientWorkspaceBootstrap.ts:168`.
- A11y: mostly good; `DecisionDetailModal` missing `role="dialog"`; ClientHeader
  dropdowns missing `role="menu"`; some buttons missing aria-labels.
- Tests: inbox flows well covered; gaps: `ClientCopyReview.tsx` (562 LOC, no dedicated
  component test), InsightsEngine filter edge cases.
- Mobile spot-checks pass (responsive classes throughout).
