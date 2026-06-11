# Client Dashboard Audit — Significant Changes (2026-06-11)

> Deliverable 2 of 3. Substantial new features and reworked surfaces (days-to-weeks each),
> all within the current architecture: existing `ClientTab` structure, intelligence-slice
> data flow (ADR 0002), background job platform (ADR 0001), unified inbox sections,
> three-tier soft-gating. Source: [00-findings.md](./00-findings.md).
>
> Companion docs: 01 (quick wins, <1 day each), 03 (strategic/architectural bets).

---

## Ranked summary (value vs effort)

| # | Recommendation | Value | Effort | Tier angle | Phase |
|---|----------------|-------|--------|-----------|-------|
| 1 | "Agency at work" transparency layer | Very high — #1 untapped-value finding; retention + perceived value for every tier | 5–8 d | All tiers (free sees it too — it sells the agency) | 1 |
| 5 | Health tab → revenue ("Fix this ($X)" cart wiring) | Very high — direct revenue; Stripe products + cart already exist | 4–6 d | Per-item purchases; Premium hours alternative | 1 |
| 9 | Data-layer hardening (enabler) | High — unblocks #1/#6/#7; fixes quota burn + silent failures | 5–7 d | n/a (infrastructure) | 1 |
| 2 | Outcome scorecard + playbook justification + "We Called It" | High — answers "is this working?"; strongest Growth retention story | 4–6 d | Growth+; detailed breakdown stays Premium | 2 |
| 4 | Premium tier rescue (competitor gaps, hours, discount) | High — Premium is $999/mo and nearly empty in code | 8–12 d | Premium-exclusive; soft-gated for Growth | 2 |
| 7 | Global "needs my attention" system | High — converts logins into approvals; respects inbox contract | 3–5 d | All tiers | 2 |
| 3 | Keyword rank dashboard + competitor benchmarking | Med-high — competitor snapshots exist server-side, never shown | 5–7 d | Ranks Growth+; competitor columns Premium (soft-gated) | 2 |
| 6 | Performance/Analytics narrative upgrade | Med-high — Analytics is the weakest data tab; aligns roadmap #30/#33 | 4–6 d | Free sees data; AI summary Growth+ | 3 |
| 8 | Inbox v2 polish (hold-back, awaiting-team, conversations) | Medium — friction removal on an already-working loop | 3–5 d | All tiers | 3 |
| 10 | Local SEO visibility surface | Medium — high value but only for local-business workspaces | 4–6 d | Growth+; competitor brands Premium | 3 |

Total: roughly 45–63 agent-days across three phases. Each numbered item ships as one or
more single-phase PRs into `staging` per the phase-per-PR rule.

---

## 1. "Agency at work" transparency layer

### Problem (findings §6)

Clients see results, not process — the agency feels like a black box. The server already
assembles everything needed: 50+ admin-only activity types vs only ~20 in
`CLIENT_VISIBLE_TYPES` (`server/activity-log.ts:190`), in-progress background jobs, and
diagnostic narratives. Crucially, **the plumbing for a client work feed already exists
and is unused by any client surface**:

- `GET /api/public/jobs/:workspaceId` returns client-visible jobs with scrubbed payloads
  (`server/routes/jobs.ts:69` `CLIENT_VISIBLE_JOB_TYPES`, `isClientVisibleJob`).
- `server/websocket.ts:23` already filters `JOB_CREATED`/`JOB_UPDATED` broadcasts to the
  same client-visible set.
- Integration coverage exists (`tests/integration/public-jobs-routes.test.ts`).

Nothing in `src/components/client/` consumes any of it.

### Proposed design

**UX.** A "What we're working on" section on the Overview tab (`OverviewTab.tsx`),
rendered with `<SectionCard>`, in three stacked zones:

1. **Live now** — active client-visible jobs as progress rows: label from
   `getBackgroundJobLabel()` (`shared/types/background-jobs.ts`), progress bar (blue —
   data, per the Four Laws), and a one-line process narrative ("Crawling 42 pages of
   your site to refresh health scores"). Empty when no jobs run — collapses to nothing,
   no empty state needed here.
2. **Recent work** — last 14 days of client-visible activity, grouped by day, rendered
   via `<DataList>`. Expand `CLIENT_VISIBLE_TYPES` with a curated set of process types
   (audit started/completed, briefs generated, schema deployed, keyword research run),
   each mapped to client-friendly narrative copy in a single `shared/` label map (never
   inline literals — same pattern as `BACKGROUND_JOB_TYPES`).
3. **This month in numbers** — a `<CompactStatBar>`: actions taken, pages touched,
   briefs produced. Computed from the activity log on the server, not client-side.

A slim "live" indicator (pulsing teal dot + count) can also appear in `ClientHeader.tsx`
when jobs are active, deep-linking to Overview.

**Data flow.**
- New `agencyActivity` field on the `operational` slice (or a narrow extension of
  `ClientSignalsSlice`) in `server/intelligence/` — per CLAUDE.md, new client-visible
  data wires through a slice, surfaced into `ClientIntelligence`
  (`shared/types/intelligence.ts:615`) via the existing scrubbing projection.
- Jobs: reuse `GET /api/public/jobs/:workspaceId` directly via a new typed module in
  `src/api/` + `useClientJobs` hook in `src/hooks/client/` (React Query, `client-jobs`
  key).
- WS: `useWorkspaceEvents(workspaceId, ...)` handler for `WS_EVENTS.JOB_CREATED` /
  `JOB_UPDATED` (`server/ws-events.ts:16-17`) invalidating `client-jobs`; activity
  additions already broadcast via the existing activity events.
- Curate `CLIENT_VISIBLE_JOB_TYPES` additions deliberately — both copies
  (`server/routes/jobs.ts` and `server/websocket.ts`) must move in lockstep;
  consolidating them into one shared constant is part of this work.

**Tier placement.** All tiers including free — this is the sales tool ("look how much
the agency does"), consistent with the free-data-visibility lock. No gating.

**Effort.** 5–8 days. Slice field + scrubbing (1–2d), label maps + activity-type
curation (1d), Overview section + header indicator (2–3d), WS wiring + tests (1–2d).

**Dependencies.** Benefits from #9 (per-slice fetch) but not blocked — jobs come from
the dedicated endpoint. Ship behind a `client-work-feed` flag in
`shared/types/feature-flags.ts`.

**Risks.** Over-exposure: an internal job label or payload fragment leaking client-side
is a trust incident — every new visible job type needs the scrub test extended.
Narrative copy drift: keep all client-facing strings in one map and run them through
`docs/workflows/ui-vocabulary.md` review. Don't show failed jobs as failures — render
"re-running" language; clients should never debug our pipeline.

---

## 2. Outcome scorecard + playbook justification + "We Called It"

### Problem (findings §6)

Outcome playbooks, per-action win rates, and confidence scores exist server-side
(`server/outcome-playbooks.ts`, `LearningsSlice`) but clients never see "schema fixes
worked 73% of the time in your vertical". `PredictionShowcaseCard.tsx` and
`Briefing/WinsSurface.tsx` exist but are thin; the "We Called It" expansion was flagged
as a quick win — this item is the full surface around it.

### Proposed design

**UX.** A scorecard section on the **ROI tab** (the natural "is this working" home),
plus justification chips inline elsewhere:

- **Scorecard** — `<StatCard>` row: actions taken (90d), win rate, avg. time-to-impact.
  Below it, a `<DataList>` of recent scored outcomes: action → what happened → outcome
  badge (emerald `scoreColorClass()` semantics for wins, amber for pending, never
  green-400). Each row expands (progressive disclosure) to the playbook justification:
  "We recommended this because similar fixes in your vertical succeed 73% of the time."
- **"We Called It" wins strip** — predictions that came true, rendered as narrative
  cards ("In March we said fixing your service-page titles would lift clicks. It did:
  +34% in 6 weeks."). Extends `WinsSurface.tsx` / `PredictionShowcaseCard.tsx` rather
  than new components.
- **Justification chips** — wherever a recommendation renders (HealthTab action plan,
  Overview #1 priority), a small "73% win rate" `<Badge>` (blue — it's data) sourced
  from the same playbook stats.

**Data flow.**
- `LearningsSlice` already exists (`shared/types/intelligence.ts`); extend the
  `ClientIntelligence` projection to include a scrubbed `outcomeScorecard` +
  `playbookStats` summary (no internal notes, no admin attribution detail). Use the
  typed unions in `shared/types/outcome-tracking.ts` (`OutcomeScore`, `Attribution`,
  `EarlySignal`) — never inline literals.
- Respect the learnings-availability contract: consume `LearningsSlice.availability`
  as authoritative (`docs/rules/outcome-learning-default-path.md`); when unavailable,
  the scorecard renders an honest `<EmptyState>` ("We're still gathering outcome data
  — first scores land ~30 days after your first approved action").
- WS: handlers for `OUTCOME_SCORED`, `OUTCOME_LEARNINGS_UPDATED`,
  `OUTCOME_PLAYBOOK_DISCOVERED` (`server/ws-events.ts:74-78`) — currently unhandled
  client-side (findings §5) — invalidating the ROI/intelligence query keys.

**Tier placement.** Scorecard summary + "We Called It": **Growth+** (soft-gated blur +
CTA for free via `<TierGate>`). Per-action detailed breakdown stays **Premium** — this
is the one premium-exclusive that already exists in code; keep it and make it visible.
Monetization angle: this is the retention surface — MONETIZATION.md's "never questions
the retainer" logic applied to Growth.

**Effort.** 4–6 days. Projection + scrubbing (1–2d), ROI scorecard UI (1–2d), wins
strip expansion + justification chips (1d), WS handlers + tests (1d).

**Dependencies.** None hard. Coordinates with roadmap #74 (ROI dashboard polish) —
implement as part of that item, not alongside it. Win-rate displays must obey the
rate-display rule: numerator and denominator from the same server aggregation.

**Risks.** Small-N embarrassment: a 1-of-2 "50% win rate" reads terribly — suppress
rates below a minimum sample (e.g. n<5, show "early data" instead). Over-claiming
attribution invites client pushback; reuse the conservative ROI-tab framing and add the
methodology "(i)" explainer the findings flagged as missing.

---

## 3. Keyword rank dashboard with competitor benchmarking

### Problem (findings §6)

Weekly competitor snapshots (keyword counts, traffic) are captured in
`server/competitor-snapshot-store.ts` (migration `070-competitor-snapshots.sql`) and
flow into `seoContext` (`server/intelligence/seo-context-slice.ts`) — but no client
surface shows them. Tracked keywords exist on the Strategy tab but there's no
rank-over-time view, and MONETIZATION.md promises "competitor keyword analysis —
blurred with Premium upgrade CTA" for Growth (line 677) that doesn't exist.

### Proposed design

**UX.** New section on the **Search sub-tab** of Performance (keeps the tab structure;
no new `ClientTab`):

- **Rank table** — tracked keywords via `<DataList>`: keyword, current position,
  4-week trend (`<TrendBadge>`), clicks. Sort by movement. Blue for data values, teal
  only on actions ("Track more keywords" → Strategy tab).
- **Competitor columns** — per keyword, best competitor position + a workspace-level
  "share of voice" `<ChartCard>` from weekly snapshots (you vs named competitors over
  12 weeks). Competitor names visible; this is the wedge.
- **Movement narrative** — one takeaway line at top, same pattern as the existing
  Search takeaway summary (findings §3 calls it a strength — replicate it).

**Data flow.**
- Extend the `seoContext` projection into `ClientIntelligence` with
  `keywordRanks` + `competitorBenchmark` (typed interfaces in
  `shared/types/intelligence.ts` first — boundary-types rule). Snapshot reads stay
  inside the slice assembler; no route-level reads of `competitor_snapshot` tables.
- Rank history from existing GSC position data (already fetched for Search tab) joined
  with tracked keywords from the strategy store.
- WS: snapshots refresh weekly via cron (`server/briefing-cron.ts` pattern) — broadcast
  an event registered in `server/ws-events.ts` and handle via `useWorkspaceEvents`.

**Tier placement.** Rank table: **Growth+** (free sees own GSC data already — the rank
*tracking* view soft-gates). Competitor columns + share-of-voice chart: **Premium**,
soft-gated for Growth with blurred competitor names — exactly the MONETIZATION.md §677
promise. This is item one of the Premium rescue (#4) shipped on its own surface.

**Effort.** 5–7 days. Projection + types (1–2d), rank table + trend logic (2d),
competitor chart + TierGate (1–2d), tests incl. public-endpoint read-path integration
test (1d).

**Dependencies.** Coordinates with roadmap #29 (competitive monitoring) — this is its
client-facing half. Benefits from #9 per-slice fetch (rank history is heavy).
Sequencing: ship after or with #4's gating groundwork so the Premium gate lands once.

**Risks.** Snapshot data sparsity for new workspaces — need a "collecting data, first
benchmark in N days" empty state. GSC position averages are noisy week-to-week; smooth
with 7-day windows and label methodology. Premium blur must not leak competitor names
in the DOM (render placeholders server-side in the scrubbed projection, don't
CSS-blur real data — the projection is the enforcement point, per ADR 0002).

---

## 4. Premium tier rescue

### Problem (findings §7)

Premium is $999/mo and **nearly empty in code** — only "detailed outcome breakdown" is
premium-exclusive. MONETIZATION.md documents but the code never built: competitor
keyword analysis (§677), 3 implementation hours/month (§101), 10% content discount
(§253), premium approvals. A client comparing what they pay against what the dashboard
shows them has every reason to downgrade. betaMode (forced premium) also shows no
premium identity at all.

### Proposed design

Four sub-deliverables, each its own PR:

**4a. Competitor gap analysis (Premium-exclusive surface).** Builds on #3: a "Gaps"
section under Search showing keywords competitors rank for that the workspace doesn't
(`keyword_gaps` table — normalized out of JSON in migration 088). `<DataList>` ranked
by opportunity, each row linking to "Request a brief on this" (→ purchase flow). Growth
sees the section soft-gated: gap counts visible, keywords blurred via the scrubbed
projection. Data: extend the keyword-strategy reads already inside the seoContext
slice; nothing new server-side beyond projection fields.

**4b. Implementation hours tracker.** Premium-only `<SectionCard>` on the Plans tab:
"2.5 of 3 hours remaining this month", a `<DataList>` ledger of hour-consuming work
(pulled from a new `implementation_hours` table + migration, written by admin when
logging work; full DB-column-and-mapper lockstep rule applies), and a "Request work"
CTA that opens the existing work-order conversation flow. Monthly reset via cron.
Aligns with roadmap #77 (usage tracking/limits) — build on its usage-counter
infrastructure, don't fork it.

**4c. 10% content discount wiring.** In `useCart` / `SeoCart.tsx`
(`src/components/client/`), apply a premium discount line item when
`tier === 'premium'`: strikethrough original price, "Premium saves you $X" in teal.
Server-side enforcement in the Stripe Checkout session builder (never trust
client-computed prices) — a discount coupon or adjusted line amounts in the checkout
session. Also surfaces in brief/post purchase CTAs ("$315 — $283.50 with Premium"),
which doubles as a Growth-tier upsell hook everywhere prices render.

**4d. Premium identity + upsell surfaces.** A `<TierBadge>`-anchored "Your Premium
plan this month" digest card on Overview for premium workspaces (hours used, discount
saved, competitor insights count) — making the $999 legible. For Growth: a single
consolidated "What Premium adds" soft-gate panel on the Plans tab (avoid scattering
upsells; soft-gating is locked but tasteful).

**Tier placement.** This *is* the tier work. Monetization: directly defends $999/mo
and gives `#88 self-service Stripe tier upgrade` something to upgrade *to*.

**Effort.** 8–12 days total (4a: 2–3d on top of #3; 4b: 3–4d; 4c: 2–3d; 4d: 1–2d).

**Dependencies.** 4a depends on #3. 4b coordinates with roadmap #77. 4c touches Stripe
— follow `docs/workflows/stripe-integration.md`, verify on staging with test-mode keys
before `main`. All four behind one `premium-tier-v2` feature flag, sub-features gated
at the narrowest point (toggle-scope-minimality rule).

**Risks.** 4c is the riskiest: pricing math errors are refund-generating; needs
integration tests asserting the Stripe session amount, not just UI display. 4b creates
an admin obligation (logging hours) — if admins don't log, the tracker shows "0 used"
and *undermines* value; pair with an admin-side logging affordance in the same phase.
Discount + bundle-pricing (see #5) interactions must be defined before either ships
(discount applies after bundling, once, server-side).

---

## 5. Health tab → revenue: "Fix this ($X)" + impact estimates

### Problem (findings §7, §3)

The Health tab shows issues with **no purchase path** — Stripe products exist
(`fix_meta`, `fix_alt`, `schema_page`…), the cart exists (`src/components/client/useCart.tsx`,
`SeoCart.tsx`), but HealthTab never wires them together. Separately, the recommendation
engine computes `opportunity.emvPerWeek` internally (exposed admin-side via
`useAdminRecommendations.ts`, deliberately leak-tested on the public path in
`tests/integration/recommendations-public-emv-leak.test.ts`) while clients see fixes
with no dollar/traffic impact framing.

### Proposed design

**UX.** In `health-tab/HealthTabSections.tsx` (881 lines — extract the touched
sections rather than growing the god component, per platform-organization rules):

- Each fixable issue row gains a price-tagged action: "Fix this — $49" (teal CTA →
  `useCart.add()`), plus an impact line: "Est. impact: ~$120/mo in organic value"
  derived from a *banded* client-safe projection of `emvPerWeek` (see risks).
- **Bundle pricing**: when 3+ items of one family are in cart, the cart shows pack
  pricing ("Metadata pack — 10 pages, $199, save $91") per MONETIZATION.md §233.
  Bundle math lives server-side in the checkout session builder; the cart UI mirrors it.
- A sticky cart summary within the Health tab when items are added ("3 fixes — $147 ·
  est. +$310/mo"), respecting `--z-sticky`.
- Premium variant: instead of prices, rows show "Covered by your implementation hours —
  request fix" (per MONETIZATION.md §239 Premium vs Growth table), routing to the
  work-order flow. This is the tier table made tangible.

**Data flow.**
- Impact estimates: add a scrubbed `impactBand` (e.g. `'low' | 'medium' | 'high'` +
  rounded monthly $ range) to the recommendation payload in the `ClientIntelligence`
  projection — **not** raw `emvPerWeek`; the existing leak test stays green and a new
  contract test pins the banding.
- Catalog: a typed fix-product map in `shared/types/` (issue type → Stripe product +
  price + bundle family) shared by HealthTab rendering and the server checkout builder
  — single const object, both sides import it.
- Purchases already flow through Stripe Checkout; post-purchase, the fix lands as a
  work order and — once #1 ships — appears in the work feed ("Your metadata fixes are
  in progress"), closing the loop.

**Tier placement.** Free + Growth: per-item purchases (this is the core monetization
ladder — free data → paid fixes). Premium: hours-covered framing (no double-charging).
10% discount from 4c applies when present.

**Effort.** 4–6 days. Catalog + banding projection (1–2d), HealthTab wiring + cart
summary (2d), bundle logic server-side + tests (1–2d).

**Dependencies.** None hard; bundle/discount interaction must be specified with 4c.
Sequencing: ship in Phase 1 — it's the highest revenue-per-effort item and independent
of the intelligence work.

**Risks.** Impact-estimate over-promising: showing "$120/mo" then delivering nothing
measurable erodes trust — use ranges, conservative bands, and the same methodology "(i)"
treatment as ROI. Price-display drift between client map and Stripe products — the
shared const + an integration test asserting catalog/Stripe parity. Don't put prices on
issues the agency can't actually fix per-item (manual Designer work) — those route to
"talk to us" instead.

---

## 6. Performance/Analytics narrative upgrade

### Problem (findings §3)

The Analytics sub-tab (`AnalyticsTab.tsx`, 567 lines) is raw data: no takeaway
narrative, no good/bad color coding on conversion rates, 12+ ungrouped events, no
forward-looking framing. Search/Analytics sub-tabs also have **no URL state** — unlike
Inbox's `?tab=` contract — so Analytics can't be deep-linked from insights, emails, or
the work feed. Data freshness is implicit (GA4 lags 24–48h, no "as of" anywhere but
Health).

### Proposed design

**UX.**
- **AI takeaway block** at top of Analytics: 2–3 sentence narrative ("Sessions up 12%;
  most growth from organic; your contact-form conversion dipped — likely the slow
  mobile LCP we flagged"). Same visual pattern as the Search takeaway (reuse, don't
  invent). Refreshed when the underlying GA4 snapshot refreshes, cached — never
  generated per page view.
- **Anomaly cards** (roadmap #33): detected anomalies render as insight cards in
  Analytics and feed the Overview digest. WS `ANOMALIES_UPDATE`
  (`server/ws-events.ts:55`) is currently an unhandled broadcast (findings §5) — wire
  the client handler.
- **Conversion color coding** via shared band helpers (extend `ui/constants.ts`
  patterns; never hand-rolled hex), event grouping with progressive disclosure
  (top 5 + "show all").
- **URL state**: `?tab=search|analytics` on the Performance tab following the
  two-halves contract — sender appends, receiver initializes from `useSearchParams`.
  The contract test (`tests/contract/tab-deep-link-wiring.test.ts`) and pr-check
  already enforce the receiver half once introduced.
- **Freshness stamps**: "Data through Jun 9 (GA4 lags ~24–48h)" `.t-caption` line on
  GA4-backed cards.

**Data flow.**
- AI summary: server-side generation through `callAI()` with a named operation in
  `server/ai-operation-registry.ts` + Zod-validated output
  (`docs/rules/ai-operation-contracts.md`), assembled from the analytics/insights
  slices via `buildWorkspaceIntelligence()` — generated on snapshot refresh (background
  job if batched), stored, served from the projection. Model: `gpt-5.4-mini` class.
- Anomalies: roadmap #33's detection output lands as insight types — full four-part
  registration per `docs/rules/analytics-insights.md` (union + typed `XData` +
  `InsightDataMap` + Zod + renderer, one commit).

**Tier placement.** Raw data + freshness + URL state: free (locked decision). AI
takeaway + anomaly narrative: **Growth+**, soft-gated — free sees a blurred summary
("Upgrade to get the story behind your numbers"), which is a strong, cheap upsell.

**Effort.** 4–6 days. URL state + freshness (1d), AI summary pipeline + operation
contract (2d), anomaly surfacing UI (1–2d), grouping/color polish (1d).

**Dependencies.** This *is* roadmap #30 + #33's client half — mark those items, don't
duplicate. Depends on #9's `staleTime` fix landing first (otherwise the summary
trigger competes with quota-burning refetches). URL-state PR is independent and tiny —
can ship in Phase 1 inside #9's hardening batch.

**Risks.** AI summary hallucinating numbers — the operation contract must inject exact
figures and instruct the model to only reference provided values; deterministic eval
fixture per `docs/rules/ai-quality-evals.md`. Anomaly noise (alert fatigue) — ship
detection thresholds conservative, dedup per the analytics-insights rules.

---

## 7. Global "needs my attention" system

### Problem (findings §4)

No global signal that action is needed: `PriorityStrip` is inbox-internal, the header
badge counts legacy items/batches while the inbox renders unified deliverables
(granularity mismatch flagged in the 2026-06-09 platform audit —
`ClientHeader.tsx:220`, `ClientDashboard.tsx:532`, `UnifiedInbox.tsx:394`). Clients who
land on Overview or Performance can miss pending decisions entirely. Constraint: the
`ActionQueueStrip` was retired from `InboxTab.tsx` by the inbox IA restructure (§5.6 —
urgency is carried through chip counts, not a strip) and its re-introduction is blocked
by pr-check rule `inbox-action-queue-strip`. **This proposal must not resurrect it.**

### Proposed design

**UX.**
- **Header badge** on the Inbox nav entry in `ClientHeader.tsx`: count of items
  *awaiting the client* (pending decisions + reviews awaiting response), computed from
  the unified `ClientDeliverable`/`NormalizedDecision` model — fixing the
  legacy-count mismatch as part of this work, not alongside it. Amber dot + count;
  clicking goes to `/inbox` (default section).
- **Cross-tab attention banner**: a single dismissible-per-session banner (not a strip,
  not inside InboxTab) rendered by the `ClientDashboard.tsx` shell above tab content
  when attention count > 0 and current tab ≠ inbox: "2 items need your decision →
  Review now" deep-linking with `?tab=decisions` (sections use `InboxFilter` values per
  the routing contract — `decisions|reviews|conversations`, never legacy aliases).
- **Section-level counts** in the banner link text when mixed ("1 decision, 1 review").

**Data flow.**
- One server-computed `attentionCounts` summary endpoint (or field on the bootstrap
  payload in `useClientWorkspaceBootstrap.ts`) derived from the same queries the
  unified inbox uses — single source so badge and inbox never disagree (rate-display
  rule generalized: a count and the list it summarizes share a source).
- WS: invalidate on the deliverable/approval events the inbox already handles; the
  attention count piggybacks on those keys, no new event names needed.

**Tier placement.** All tiers. Indirect monetization: faster approvals → faster
publishing → visible outcomes → retention.

**Effort.** 3–5 days. Unified count source + endpoint (1–2d), header badge + banner
(1d), inbox-side reconciliation + tests (1–2d).

**Dependencies.** None. Must land before or with #8 (both touch inbox counts).
Respect `docs/rules/inbox-section-routing.md` for what counts as "awaiting client":
note-based routing means a conversation awaiting client reply counts; one awaiting the
team does not.

**Risks.** Count disagreement is the failure mode users notice most — the single-source
design is the mitigation; add a contract test asserting badge query and inbox list
query use the same server function. Banner fatigue: cap at one banner, session
dismissal, never stack with the trial-countdown banner (define precedence: trial-ending
> attention).

---

## 8. Inbox v2 polish

### Problem (findings §4)

The approval loop works, but: no batch approve with selective hold-back (all-or-nothing
in `DecisionDetailModal`); `changes_requested` items vanish from the inbox ("did they
get it?" anxiety); post-approval transition is silent; work-order conversation threads
lack comment-count badges, hurting conversation discoverability.

### Proposed design

**UX.**
- **Selective hold-back**: in `DecisionDetailModal` (full-screen batch modal,
  `--z-modal-fullscreen`), per-item checkboxes default-checked with "Approve 7, hold 2"
  on the CTA. Held items stay pending in Decisions with a "held by you" chip. Status
  changes route through `validateTransition()` (`server/state-machines.ts`) — partial
  approval is per-item transitions, not a new batch state. Also fix the modal's missing
  `role="dialog"` (findings §8) in the same PR.
- **"Awaiting team" visibility**: a collapsed, count-labelled group at the bottom of
  the relevant inbox section listing items the client acted on that are now with the
  team (`changes_requested`, approved-awaiting-publish), each with a passive
  `<StatusBadge>` ("With our team", orange for changes-requested per the status color
  map). Read-only — it must not compete with actionable items, hence collapsed by
  default (progressive disclosure). This is a *view filter* within existing sections,
  not a fourth section — the three-section inbox is locked.
- **Post-approval feedback**: on approve, a toast + the item visibly moving to the
  awaiting-team group ("Approved — now with our team, typically published within 2
  days").
- **Conversation badges**: unread/total comment counts on Conversations rows and on the
  section chip, from the work-order thread store; clears on open.

**Data flow.** Mostly existing stores. Server: partial-approve endpoint accepting item
ID subsets (extend the unified deliverables respond path — **not** the legacy
`/approvals/:batchId/apply`, which #9 deprecates); unread tracking needs a
last-read-at per client user on conversation threads (migration + mapper lockstep).
Broadcasts: existing approval/deliverable events; add a thread-read event only if
admin UI needs it. All mutations log via `addActivity()` (public-portal mutations are
pr-check-enforced).

**Tier placement.** All tiers (inbox is core loop). No direct monetization; reduces
approval latency, which gates content revenue recognition.

**Effort.** 3–5 days. Hold-back (1–2d), awaiting-team group + toasts (1d), badges +
unread tracking (1–2d).

**Dependencies.** After #7 (shared count source). Touches `UnifiedInbox.tsx` (793
lines) — extract the awaiting-team group as its own component in
`src/components/client/`.

**Risks.** Partial approval creates split batches the admin side must render coherently
— verify the admin batch view before shipping; this is the cross-system half people
forget. State-machine gaps: if `held` isn't representable as existing pending status,
resist adding a new status — "held" is client-side framing of `pending`, not a
transition.

---

## 9. Data-layer hardening (enabler)

### Problem (findings §5)

Foundation issues that cap everything above: GA4/GSC hooks lack `staleTime`
(`useClientGA4.ts`, `useClientSearch.ts` — every tab focus fires 7–12 Google API
calls); `getSafe()` in `useClientQueries.ts` masks errors as empty data;
`/api/public/intelligence/:wsId` is 100–300KB with all slices recomputed per request,
no `assembledAt`, no per-slice param; unpaginated list endpoints; audit-detail N+1
(`public-portal.ts:273-295`, ~200KB on 50-page sites); legacy
`/approvals/:batchId/apply` coexists with the unified respond path; client JWT is 24h
with no refresh and `/api/public/*` has no rate limiting.

### Proposed design (work items, each a small PR)

1. **`staleTime` + retry policy** on all GA4/GSC hooks (5–15 min staleTime matching
   upstream data latency) and a shared query-options helper in `src/hooks/client/` so
   future hooks can't forget it.
2. **Error-visible `getSafe()` replacement**: failures surface as `<ErrorState>` with
   retry instead of "no data". Keep graceful degradation for genuinely optional
   sections; the rule is *errors look like errors*.
3. **Per-slice intelligence fetch**: `?slices=seoContext,clientSignals` param on
   `/api/public/intelligence/:wsId` mapping to `buildWorkspaceIntelligence({ slices })`
   (already supported server-side — `shared/types/intelligence.ts:493` documents the
   pattern), plus an `assembledAt` field on the response. Client hooks split into
   per-surface queries with per-slice keys (`client-intel-<slice>`), so #1/#2/#3/#6
   fetch only what they render. Add short-TTL server-side memoization per
   (workspace, slice).
4. **Pagination** on approvals/actions/requests/content-plan-cell endpoints (cursor or
   offset; keep `{ error: string }` shape) + audit-detail page windowing and removal of
   the N+1 diff computation.
5. **JWT refresh**: sliding refresh on the client token (re-issue when <2h remain on an
   authenticated request) so a working session never hard-expires mid-approval; plus
   basic per-IP rate limiting on `/api/public/*`.
6. **Legacy approvals-apply deprecation**: follow
   `docs/rules/deprecation-lifecycle.md` — mark `deprecated`, log usage, route
   remaining callers to the unified deliverables respond path, then `removed` in a
   later phase once telemetry shows zero hits.

**Tier placement.** n/a — infrastructure. Indirect value: quota safety (Google API),
faster tabs, honest failure states.

**Effort.** 5–7 days across 5–6 small PRs.

**Dependencies.** None; this is Phase 1 precisely because #1, #3, and #6 lean on
per-slice fetch and sane caching. Item 5 (auth) follows
`docs/workflows/auth-system.md`; never touch the admin HMAC path.

**Risks.** Per-slice fetch changes cache-invalidation granularity — every existing
`useWorkspaceEvents` handler that invalidates the monolithic intelligence key must be
re-pointed; do this in one PR with the broadcast-handler-pairs integration test
extended. Pagination can silently truncate admin-facing assumptions — check both
portals. JWT changes need explicit staging soak before `main`.

---

## 10. Local SEO visibility surface

### Problem (findings §6)

The local SEO visibility matrix, service gaps, and local-pack competitor brands exist
server-side (`server/local-seo.ts`, `LocalSeoSlice` —
`shared/types/intelligence.ts:124`, contracts in `docs/rules/local-seo-visibility.md`)
with a `LOCAL_SEO_UPDATED` WS event (`server/ws-events.ts:142`) — and none of it
reaches clients. For local-business workspaces (a large share of agency clients),
"do we show up when nearby customers search" is *the* question.

### Proposed design

**UX.** A "Local visibility" section on the **Search sub-tab**, rendered only when the
workspace has local SEO data (slice returns empty for non-local workspaces — same
conditional-section pattern as elsewhere; given the no-silent-hiding finding, include a
one-line note in Search settings/footer for non-local workspaces: "Local visibility
appears for businesses with physical service areas").

- **Visibility matrix** — `<ChartCard>`/grid of market × service: strong / weak /
  invisible cells (score colors via `scoreColorClass()` semantics).
- **Service gaps** — `<DataList>`: "You don't rank for 'emergency plumber' in
  Riverside — competitors do", each with "Request content" linking to the brief
  purchase flow (revenue hook).
- **Local-pack competitors** — who owns the map pack per market (Premium detail,
  consistent with #3's competitor gating).

**Data flow.** `LocalSeoSlice` already exists — extend the `ClientIntelligence`
projection with a scrubbed local block (respect the location backfill queue +
market-primary contracts in `docs/rules/local-seo-visibility.md`). Client handler for
`LOCAL_SEO_UPDATED` via `useWorkspaceEvents` invalidating the per-slice key (depends on
#9 item 3 for clean granularity). Fetch via the per-slice param —
`slices=localSeo`.

**Tier placement.** Matrix + gaps: **Growth+** (soft-gated for free with blurred
markets). Local-pack competitor brands: **Premium** (rounds out #4). Monetization:
service-gap rows are direct brief-purchase generators — likely the highest
content-purchase intent surface in the dashboard.

**Effort.** 4–6 days. Projection + scrubbing (1–2d), matrix + gaps UI (2d), pack
competitors + gates + tests (1–2d).

**Dependencies.** #9 (per-slice fetch) strongly preferred first. Coordinate gating
visuals with #3/#4a so "competitor data is Premium" reads consistently everywhere.

**Risks.** Only valuable for local workspaces — guard against rendering thin/empty
matrices for marginal data (minimum-data threshold before the section appears).
Local rank data is volatile; show "checked weekly" freshness stamps to pre-empt
"why did this change" tickets.

---

## Suggested rollout (phase-per-PR, staging-first)

Every item ships as one PR per phase into `staging`, verified on the staging deploy
before `staging` → `main` (per `docs/workflows/deploy.md`). Multi-phase items get a
feature flag in `shared/types/feature-flags.ts` **before** the first commit and
dark-launch incomplete phases. Each phase batch ends with the standard gates
(`npm run typecheck`, `npx vite build`, `npx vitest run`, `npm run pr-check`,
coverage ratchet) and, where parallel agents are used, the `scaled-code-review` skill.

### Phase 1 — Foundation + fastest revenue (~2–3 weeks)

| Item | Why now |
|------|---------|
| #9 Data-layer hardening (PRs 1–5; deprecation marked) | Enabler for everything; quota risk is live today |
| #5 Health → revenue (cart + impact bands + bundles) | Highest revenue per effort; independent of intelligence work |
| #6 (partial) Performance `?tab=` URL state + freshness stamps | Tiny, unblocks deep links the later phases need |
| #1 "Agency at work" feed (behind `client-work-feed` flag) | #1 value finding; public jobs endpoint already exists |

### Phase 2 — Proof of value + Premium substance (~3–4 weeks)

| Item | Why now |
|------|---------|
| #7 Global attention system | Fixes the count-mismatch debt; prerequisite for #8 |
| #2 Outcome scorecard + "We Called It" (with roadmap #74) | Retention story once the work feed shows process |
| #3 Keyword rank + competitor benchmarking | Foundation for Premium gating |
| #4 Premium rescue (4a → 4d, sequential PRs; 4c last after staging soak) | Depends on #3; defends the $999 tier |

### Phase 3 — Narrative + polish (~2–3 weeks)

| Item | Why now |
|------|---------|
| #6 (remainder) AI analytics summary + anomaly surfacing (roadmap #30/#33) | Needs #9 caching + per-slice fetch in place |
| #8 Inbox v2 polish | After #7's unified counts |
| #10 Local SEO surface | Needs per-slice fetch; gating language settled by #3/#4 |
| #9 item 6 completion: legacy approvals-apply `removed` (if telemetry is zero) | Deprecation lifecycle close-out |

**Cross-phase contracts to pre-commit before Phase 2 dispatch** (multi-agent
coordination rule): the scrubbed projection field shapes for `outcomeScorecard`,
`keywordRanks`/`competitorBenchmark`, and `localSeo` in `shared/types/intelligence.ts`;
the fix-product catalog type in `shared/types/`; the `attentionCounts` contract; and
the Premium gating visual spec (what "blurred via projection" renders as), so #3, #4a,
and #10 don't drift.

**Post-ship per item**: `FEATURE_AUDIT.md` entry, `data/roadmap.json` status updates
(#29/#30/#33/#74/#77 alignment), `BRAND_DESIGN_LANGUAGE.md` for any new UI patterns,
and `data/features.json` for the sales-relevant items (#1, #2, #3, #4, #5, #10).
