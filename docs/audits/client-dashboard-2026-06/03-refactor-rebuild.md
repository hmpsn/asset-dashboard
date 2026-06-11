# Client Dashboard Rebuild — Vision & Architecture (Deliverable 3 of 3)

> Audit: `docs/audits/client-dashboard-2026-06/` · Source findings: [`00-findings.md`](./00-findings.md)
> Scope: the client portal (`/client/:workspaceId/:tab`) rebuilt as if we were starting from the
> product's actual job — being the reason a client stays with the agency — rather than from the
> data sources we happen to integrate.

---

## Executive summary

The client dashboard today is a competent **data viewer** organized around our integrations
(GSC tab, GA4 tab, audit tab). Clients don't think in data sources. They think in four questions:
**Is it working? What are you doing for me? What do I need to do? What's it worth?** The rebuild
reorganizes the entire portal around those four questions, and makes three strategic bets:

1. **Narrative is the product, data is the appendix.** Every metric ships with interpretation,
   freshness, and a forward-looking estimate — server-assembled, cached, and AI-polished — with
   the client AI advisor as a first-class navigation layer over it, not a widget in the corner.
2. **Transparency is the moat.** The single biggest untapped asset in the codebase (findings §6)
   is process visibility: playbook win rates, in-flight jobs, diagnostic root-cause, the 50+
   admin-only activity types. A dedicated "Work" surface turns the agency black box into the
   retention engine. No competitor dashboard shows *why* the agency chose an action and how often
   that action has worked.
3. **Monetization lives at the point of pain.** The Stripe products, cart, and tier machinery all
   exist (findings §7); they are simply not wired to the moments where clients feel problems.
   Premium gets a real value ladder (competitor intelligence, evidence depth, implementation
   hours) instead of one exclusive card.

All locked decisions hold: unified Inbox (Decisions/Reviews/Conversations), soft-gating, free
data visibility, ADR 0004 client/admin split, ADR 0002 `ClientIntelligence` projections, ADR 0001
background jobs, three canonical tiers. The rebuild is a phased, feature-flagged migration
(`client-dashboard-v2`), not a parallel app — roughly six phases over 10–14 weeks, each phase one
PR, staging-first, with per-phase kill-switches.

---

## 1. Target experience & IA redesign

### 1.1 The mental-model map

Current nav is eleven tabs shaped by data source and internal org structure, with visibility rules
(tier, `seoClientView`, `analyticsClientView`, `contentPlanSummary.totalCells > 0`,
`billingMode === 'external'`, betaMode) that are never explained to the client (findings §2).
Target nav is **six tabs**, each owning one client question:

| Question | Tab | Contents |
|---|---|---|
| *(all four, summarized)* | **Home** | Magazine-layout briefing (promote `client-briefing-v2`) |
| Is it working? | **Results** | Traffic, search, engagement, site health — one narrative surface, four views |
| What are you doing for me? | **Work** | NEW — activity timeline, in-flight jobs, playbook evidence, diagnostics |
| What do I need to do? | **Inbox** | Unchanged (locked: Decisions / Reviews / Conversations) |
| What's the plan? | **Strategy** | Living strategy + content plan + brand profile as views |
| What's it worth? | **Value** | ROI (default view) + plan/billing/upgrade |

Opinionated calls embedded in that table:

- **Build on `client-briefing-v2`, don't restart.** `InsightsBriefingPage`
  (`src/components/client/Briefing/InsightsBriefingPage.tsx`) and `useClientBriefing.ts` are the
  right direction — editorial, prioritized, narrative. Home *is* the briefing page graduated from
  its flag. The current `OverviewTab.tsx` strengths (narrative subtitle, #1 priority card with
  "why", action-needed banner, "we called it" predictions — findings §3) migrate into briefing
  sections rather than surviving as a second overview.
- **Kill the hidden sub-tabs problem with URL state, not more top-level tabs.** Performance today
  hides `SearchTab.tsx` and `AnalyticsTab.tsx` behind local state with no deep-linking
  (findings §2). Results uses the existing `?tab=` two-halves contract (same machinery as Inbox,
  enforced by `tests/contract/tab-deep-link-wiring.test.ts` and pr-check):
  `/client/:ws/results?tab=traffic|search|engagement|health`. Every view is linkable — which the
  AI advisor and email digests depend on (§2.4).
- **Resolve "Plans vs Content Plan" by renaming both out of existence.** Pricing/billing becomes a
  view inside **Value** ("Plan & Billing"); the content matrix becomes a view inside **Strategy**
  ("Content Plan"). Two confusing siblings become children of the questions they actually answer.
- **Fold Health into Results, not out of prominence.** "Is it working?" includes "is the asset
  sound?". Health keeps its score bands, ranked Action Plan, and last-scanned date — and gains the
  point-of-pain purchase CTAs (§5.3). The Home briefing surfaces the health headline so it never
  loses visibility.
- **Explain absence.** Every tab/view that is hidden or locked for a reason
  (tier, admin flag, no data yet) gets a client-facing explanation instead of silently vanishing:
  locked views render a soft-gate (`<TierGate>` pattern — locked decision) and "not yet" states
  render an `<EmptyState>` with what will unlock them ("Your content plan appears here once your
  strategist publishes the first cells"). Mystery tabs are a trust leak; the fix is cheap.

### 1.2 Route migration map

New `ClientTab` union: `'home' | 'results' | 'work' | 'inbox' | 'strategy' | 'value'`.
Old values redirect; **no client bookmark ever 404s.**

| Current `ClientTab` | New route | Mechanism |
|---|---|---|
| `overview` | `/client/:ws` (home) | default tab rename |
| `performance` | `/client/:ws/results?tab=traffic` | redirect map |
| `search` | `/client/:ws/results?tab=search` | redirect map |
| `analytics` | `/client/:ws/results?tab=engagement` | redirect map |
| `health` | `/client/:ws/results?tab=health` | redirect map |
| `inbox` | unchanged | — |
| `strategy` | `/client/:ws/strategy` (default view) | unchanged path |
| `content-plan` | `/client/:ws/strategy?tab=content-plan` | redirect map |
| `brand` | `/client/:ws/strategy?tab=brand` | redirect map |
| `roi` | `/client/:ws/value` (default view) | redirect map |
| `plans` | `/client/:ws/value?tab=plan` | redirect map |
| `approvals`/`requests`/`content`/`schema-review` (legacy) | existing Inbox alias machinery (`CLIENT_INBOX_ALIASES` in `src/routes.ts`) | keep as-is |

Implementation notes:

- Extend the proven `CLIENT_INBOX_ALIASES` pattern into a general
  `CLIENT_TAB_MIGRATIONS: Record<LegacyClientTab, { tab: ClientTab; search?: string }>` in
  `src/routes.ts`, consumed by `clientPath()` and the resolver in
  `src/lib/client-dashboard-tab.ts`. One table, one resolver, contract-tested.
- The route-removal checklist (`docs/rules/route-removal-checklist.md`) governs `Page` changes —
  7 files per change. `ClientTab` changes touch their own fixed set (`src/routes.ts`,
  `src/lib/client-dashboard-tab.ts`, `clientDashboardNav.ts`, `ClientDashboard.tsx`, the deep-link
  contract test, pr-check, and any `clientPath()` callers). **Add a client-route-removal section
  to that checklist doc in the first IA PR** so the eleven→six migration doesn't leak strays.
- Redirects are *loud*, briefly: a one-time dismissible toast ("Search now lives under Results")
  on alias hits for the first release cycle. Findings §2 flags silent redirects as disorienting.

### 1.3 Global "needs attention" surface

Findings §4: PriorityStrip is inbox-internal; there is no header-level signal. The rebuilt
`ClientHeader.tsx` gets a persistent attention badge (count of pending Decisions + unread
Conversations) sourced from the same `NormalizedDecision` pipeline `useUnifiedInbox.ts` already
builds, deep-linking to the right Inbox section. Post-approval transitions become visible: a
toast + a "Recently approved → now in production" strip at the top of Inbox, fed by the work-log
slice (§3), closing the "did they get it?" anxiety loop for `changes_requested` items too.

---

## 2. Narrative-first data architecture

### 2.1 The `MetricNarrative` envelope

The core architectural change: **no client surface renders a bare number.** Every metric flows
through a shared envelope defined in `shared/types/` before any UI is built (Data Flow rule 5):

```ts
interface MetricNarrative<T> {
  value: T;
  interpretation: { tone: 'good' | 'neutral' | 'attention'; label: string };  // deterministic
  aiNarrative?: { text: string; generatedAt: string };                         // cached, optional
  freshness: { source: 'gsc' | 'ga4' | 'audit' | 'internal'; asOf: string; lagNote?: string };
  forecast?: { metric: string; estimate: number; confidence: 'low' | 'med' | 'high'; basis: string };
}
```

- **Deterministic interpretation first.** Tone/label comes from thresholds and trend math
  (Search's takeaway summary and Health's score bands already do this — findings §3 calls them
  strong). This fixes the Analytics sub-tab's raw-data problem (no good/bad coding on conversion
  rates) without an AI call on the hot path.
- **AI narrative is async and cached, never blocking.** Nightly + event-triggered background jobs
  (ADR 0001; new `BACKGROUND_JOB_TYPES` entry, `resultBehavior: 'domain-store'`) generate prose
  via named operations in `server/ai-operation-registry.ts` with Zod-validated output
  (per `docs/rules/ai-operation-contracts.md`), stored and served like any other column. This
  aligns directly with roadmap #30 ("what happened this month" AI summary) — same pipeline,
  per-metric granularity.
- **Freshness everywhere.** Findings §3: only Health shows "last scanned". The envelope makes
  `asOf` structurally unavoidable; GA4 surfaces carry `lagNote: "GA4 data lags 24–48h"`.
- **Forecasts use what the engine already knows.** The recommendation engine computes
  `opportunity.emvPerWeek` internally; low-hanging-fruit keywords and health fixes expose it as
  "fix this → expect ~+X clicks/mo" with explicit confidence and basis ("based on current rank,
  CTR curves, and search volume"). Conservative framing, same philosophy as the ROI tab.

### 2.2 Where narratives are assembled

Server-side, inside `ClientIntelligence` projections (ADR 0002) — not in components, not in hooks.
The seoContext precedent applies: expose **one resolved representation**
(CLAUDE.md authority-layered-fields rule). Components receive ready-to-render envelopes; the only
client-side logic is tone→color mapping via the existing `scoreColorClass()` family and Blue-for-data
law.

### 2.3 Cross-metric storytelling

A small set of composed narratives (organic share of total traffic, content-published →
ranking-gained chains, "your conversion rate vs. your 90-day baseline") assembled in a new
`narratives` projection that reads *across* slices. These power the Home briefing's lead stories
and the monthly digest. Roadmap #31 (content performance tracker) and #33 (anomaly detection)
plug into this projection rather than getting bespoke surfaces.

### 2.4 The AI advisor as a first-class layer

Phases 1–5 are shipped; the rebuild positions the advisor (`ClientChatWidget.tsx`) as the fourth
navigation primitive (nav, search, deep-links, advisor):

- **Dashboard-aware:** the widget passes current route + active `?tab=` + visible entity IDs as
  structured context with every message, so "why did this drop?" resolves against what the client
  is looking at. Server-side this is a context parameter into the existing client-chat
  intelligence subset — no new data path.
- **Deep-links out:** advisor responses return structured link payloads built with `clientPath()`
  (never raw URLs), rendered as chips: "See the full breakdown → Results › Search". This is why
  §1.1's everything-is-linkable requirement is load-bearing.
- **Multi-modal (phase 6 / roadmap #22):** responses carry typed blocks
  (`{ kind: 'metric' | 'chart' | 'deliverable-cta' | 'link' }`) rendered by the *existing*
  primitives (`StatCard`, `ChartCard`, `TrendBadge`) — the advisor composes the same components as
  the dashboard, guaranteeing visual and color-law consistency. The prompt↔rendering contract is
  documented in the system prompt per UI/UX rule 10.
- **Warm hand-off intact:** advisor remains the top of the purchase funnel (§5), with the usage
  meter visible in-widget ("2 of 3 free conversations left" — findings §7).

---

## 3. Transparency engine

This is the pillar that justifies a rebuild rather than a polish pass. Findings §6 is unambiguous:
the platform assembles enormous process evidence that clients never see, and "agency work feels
like a black box" is the churn driver the data layer is best positioned to kill.

### 3.1 The Work tab

Four sections, progressive disclosure (UI/UX rule 8):

1. **Now** — in-flight background jobs projected client-safe: "Your site audit is running
   (32 of 50 pages)", "Generating 3 content briefs". Sourced from the job platform (ADR 0001) with
   labels from `BACKGROUND_JOB_TYPES` via `getBackgroundJobLabel()` — plus a client-label override
   layer, since internal labels aren't client vocabulary.
2. **Done for you** — the activity timeline, expanded from ~20 client-visible activity types
   toward ~40. Process work (audits run, pages re-crawled, schema deployed, briefs drafted)
   becomes visible with client-safe phrasing. This is a *curation* exercise over the existing
   `addActivity()` stream, not a new write path: an allowlist + label map per activity type,
   reviewed once, enforced in the projection.
3. **Why we did it** — playbook evidence. Each significant action links its playbook and the
   learnings-slice win rate: "Schema fixes like this have improved rankings in 73% of similar
   sites" (`server/outcome-playbooks.ts`, `LearningsSlice`). Availability follows the
   authoritative `LearningsSlice.availability` contract
   (`docs/rules/outcome-learning-default-path.md`) — graceful "evidence still accumulating" copy
   when learnings are thin, never a fabricated percentage.
4. **When something breaks** — diagnostic root-cause reports ("traffic dropped because the
   /pricing page lost its featured snippet") surfaced from the diagnostics machinery that today
   stops at the admin `diagnostics` page.

### 3.2 New `ClientIntelligence` projections required

Per the locked ADR 0002 rule — new client data wires through intelligence slices, never ad hoc
route reads. The Work tab needs these scrubbed, tier-aware projections:

| Projection | Source slice / store | Tier gate |
|---|---|---|
| `workLog` | `operational` slice + activity allowlist | free (results-level), growth+ (process-level) |
| `jobsInFlight` | job platform read, client-label map | free |
| `playbookEvidence` | `learnings` slice + `outcome-playbooks.ts` | growth summary; premium full breakdown (the existing premium exclusive, now in context) |
| `diagnostics` | diagnostics root-cause store | growth+ |
| `competitorPulse` | competitor snapshots (weekly keyword counts/traffic) | **premium** (see §5.1) |
| `healthScoreFactors` | composite score components (churn 40 / ROI 30 / engagement 30) | free — opacity here costs trust, gains nothing |
| `engagementMirror` | keyword feedback patterns ("you approve 91% of suggestions") | free — flagged as a ~2h quick win in findings §6 |

Each follows the slice contract (`docs/rules/workspace-intelligence.md`): typed interface in
`shared/types/intelligence.ts`, `assembleX()` in `server/intelligence/`, consumed via
`buildWorkspaceIntelligence()` and projected through the ClientIntelligence scrubber. The
projection layer is where tier gating and admin-vocabulary scrubbing happen — components stay dumb.

### 3.3 Transparency leaks into every tab

The Work tab is the home, but the engine feeds everywhere: Health fixes show their playbook win
rate inline next to the price (§5.3); Inbox decisions show "why we're proposing this" evidence;
the Home briefing's "we called it" card (findings §6 quick win) becomes a standing prediction
ledger — predictions made, outcomes recorded, hit rate shown. An agency confident enough to show
its batting average is an agency clients don't churn from.

---

## 4. Data-layer rebuild

The findings (§5) describe a good foundation (21 hooks, hierarchical keys, lazy tabs) with five
structural debts. The rebuild pays all five in Phase 0, *before* any UI work, because every new
surface above multiplies traffic over this layer.

### 4.1 Per-slice intelligence fetch with `assembledAt`

`/api/public/intelligence/:wsId` (100–300KB, all slices recomputed per request, no staleness
field) becomes:

- `GET /api/public/intelligence/:wsId?slices=a,b,c` — slice selection mirrors the server-internal
  `buildWorkspaceIntelligence({ slices })` API, so this is plumbing, not new architecture.
- Response: `{ slices: { a: { data, assembledAt } }, ... }` — `assembledAt` per slice, surfaced in
  the UI as the freshness source for §2.1 envelopes.
- Server-side per-slice cache keyed `(workspaceId, slice)`, invalidated by the same
  `broadcastToWorkspace()` events that invalidate client caches — one invalidation taxonomy, two
  consumers. Slices that read Google data get TTL caching aligned with the client `staleTime`
  policy below.
- `useClientIntelligence.ts` splits into per-slice queries (`['client-intel', wsId, slice]`) so a
  Work-tab invalidation doesn't refetch the Results payload.

### 4.2 `staleTime` policy + complete WS handler coverage

Two halves, both mandatory (Data Flow rules 1–2):

- **Policy table, not per-hook guesswork.** A single `CLIENT_QUERY_POLICY` map in
  `src/lib/queryClient.ts`: Google-backed data (`useClientGA4.ts`, `useClientSearch.ts` — the
  no-`staleTime` quota hazard in findings §5) gets `staleTime: 15m`; intelligence slices `5m`;
  inbox/deliverables `30s` (WS-driven anyway); billing `1m`. Every client hook declares its policy
  key; a lint-level grep in pr-check catches hooks that don't.
- **Broadcast↔handler contract test.** The 37-of-67 handler gap (BRIEF_UPDATED,
  ANOMALIES_UPDATE, INTELLIGENCE_SIGNALS_UPDATED, OUTCOME_*, SCHEMA_* unhandled) is a class of bug,
  so it gets a class-level fix: a declarative `CLIENT_EVENT_BINDINGS: Record<WsEvent,
  QueryKeyFactory[] | 'admin-only'>` module consumed by a single `useWorkspaceEvents` registration
  in the dashboard shell. A contract test (`tests/contract/`) imports `server/ws-events.ts`,
  asserts every event constant appears in the bindings map, and fails the build when someone adds
  an event without classifying it. "admin-only" is an explicit, reviewable claim — not an
  accidental omission. This mirrors the tab-deep-link contract test pattern the project already
  trusts.

### 4.3 Pagination and payload discipline

- Cursor pagination on approvals, actions, requests, and content-plan cells (the unpaginated
  endpoints in findings §5), with a shared `Paginated<T>` envelope in `shared/types/`.
- Audit detail splits into summary (scores, counts, top issues) + paged issue listing; the N+1
  diff computation at `public-portal.ts:273-295` moves to audit-write time (computed once, stored)
  instead of per-read.

### 4.4 Auth hardening

- **JWT refresh:** client tokens stay 24h but gain a sliding refresh endpoint with rotation; the
  API client (`src/api/`) auto-refreshes on 401-with-expired, so a client who leaves a tab open
  overnight doesn't land on a login wall mid-review. Stays inside the client-JWT system — never
  touches the admin HMAC path (Auth Conventions).
- **Rate limiting on `/api/public/*`:** per-token and per-IP buckets. Non-negotiable once the
  advisor and per-slice fetches increase request counts.

### 4.5 Kill legacy, surface errors

- **Deprecation lifecycle** (`docs/rules/deprecation-lifecycle.md`) for
  `/approvals/:batchId/apply` (superseded by the unified deliverables respond path) and the four
  unmounted components — `ApprovalsTab.tsx` (586), `RequestsTab.tsx` (241), legacy `ContentTab`,
  `SchemaReviewTab.tsx`. They are `hidden` today; the rebuild moves them to `removed` in the
  cleanup phase. ~1,700 lines of dead client code is a real maintenance tax.
- **`getSafe()` dies.** Findings §5: it renders failures as "no data" across activity, ranks,
  anomalies, approvals. Replacement: per-section error envelopes — each query exposes
  `{ data, error }` and sections render `<ErrorState>` with retry (UI/UX rule 4), with Sentry
  capture auto-tagged `workspaceId`. A client told "we couldn't load your rankings — retry"
  trusts the product; a client shown an empty chart assumes the agency did nothing. Error
  surfacing *is* transparency.

---

## 5. Monetization architecture

### 5.1 A Premium ladder that exists in code

Findings §7: Premium is nearly empty (one exclusive card). The rebuild gives Premium three pillars,
each riding infrastructure from §2–§3 rather than net-new systems:

1. **Competitor intelligence** — the `competitorPulse` projection (§3.2) + roadmap #29: weekly
   competitor keyword/traffic movement, local-pack competitor brands, service-gap callouts.
   Premium-exclusive, soft-gated (blurred preview + upgrade CTA, per locked decision) so Growth
   clients see exactly what they're missing.
2. **Evidence depth** — full playbook breakdowns, detailed outcome attribution, the prediction
   ledger with per-prediction detail (extends the existing premium-exclusive outcome breakdown).
3. **Hands-on allocation** — the documented-but-unbuilt 3 implementation hours/mo and 10% content
   discount, made real via the usage-metering service below (hours as a metered entitlement,
   discount as cart logic).

Also: `client-briefing-v2-ai-polish` gets the tier check it's documented as having (findings §7) —
a one-line fix that should land in Phase 0.

### 5.2 Usage metering as a platform service (roadmap #77)

One service, not per-feature counters: a `usage_events` table + meter definitions
(`chat_conversations`, `briefs_purchased`, `impl_hours`, …) with period windows, an
entitlements map per tier, and two consumers — **enforcement** (server middleware that returns a
typed `limit_reached` error) and **display** (a `useUsageMeter` hook rendering "2 of 3 free
conversations left" in the chat widget and Value tab). This immediately fixes the
Growth-50-chat-counted-but-not-enforced gap and gives every future limit a home. Meter mutations
broadcast (`USAGE_UPDATED` in `server/ws-events.ts`) so displays are live.

### 5.3 Purchases at the point of pain

- **Health fixes:** every issue row in the Health view gets "Fix this — $X" wired to the existing
  Stripe products (fix_meta, fix_alt, schema_page…) and `useCart` (`src/components/client/useCart.tsx`),
  annotated with the §2.1 forecast ("expect ~+120 clicks/mo") and §3 playbook win rate. Price +
  predicted impact + historical evidence in one row is the strongest purchase surface the product
  can build, and all three inputs already exist server-side.
- **Strategy gaps:** "request content" stops requiring navigation away (findings §4) — the
  Strategy tab embeds brief-purchase CTAs on keyword gaps and content-plan cells inline.
- **Bundles:** the designed-but-unbuilt bundle pricing (metadata packs) lands in the cart as a
  pricing rule, surfaced when ≥N same-type fixes are carted.
- **Advisor hand-off:** the multi-modal `deliverable-cta` block (§2.4) lets the advisor put a
  purchasable fix directly in a chat response.

### 5.4 Self-serve upgrade as a flow (roadmap #88)

Not a redirect — a three-step in-dashboard flow in Value: (1) plan comparison anchored to *this
client's* data ("Premium would have shown you 14 competitor movements this month" — computed from
the data they can't see), (2) Stripe Checkout (locked: Checkout, not Payment Intents), (3) a
**post-purchase onboarding moment** on return — "here's what just unlocked", deep-linking each
newly visible surface. The same flow skeleton serves trial mechanics: in-dashboard countdown
banner from day 10 + the day-10 email MONETIZATION.md already specifies (findings §7: trial
currently ends silently). betaMode keeps its zero-upsell contract — all of §5 renders nothing
under forced-premium beta.

---

## 6. Component architecture

### 6.1 Decompose the god components

| Component | Lines | Plan |
|---|---|---|
| `ClientDashboard.tsx` (shell) | 821 | Split: `ClientShell` (providers, auth gate, WS registration via `CLIENT_EVENT_BINDINGS`), `ClientNav` (from `clientDashboardNav.ts` + visibility-explanation logic), `ClientTabRouter` (resolver + migration map). Target ≤250 each. |
| `health-tab/HealthTabSections.tsx` | 881 | One file per section (`ScoreBands`, `TopFixes`, `ActionPlan`, `IssueList`) + a `useHealthSections` hook owning shared state. Purchase CTAs (§5.3) land in the *decomposed* `IssueList`, never the monolith. |
| `ContentTab.tsx` | 843 | Mostly superseded legacy — dies in the cleanup phase via deprecation lifecycle. Don't refactor what you're deleting. |

Large-but-OK components (StrategyTab 873, UnifiedInbox 793, InsightsEngine 735) are left alone
unless a phase touches them — refactor opportunistically, not recreationally.

### 6.2 Shared interaction hooks

Per UI/UX rule 9 (2+ implementations → extract), the rebuild standardizes:

- `useTabParam(TABS, defaultTab)` — the receiver half of the `?tab=` two-halves contract, used by
  Results, Strategy, Value, and Inbox alike. One implementation, contract-tested once.
- `useSectionQuery(policyKey, queryFn)` — wraps `useQuery` with the `CLIENT_QUERY_POLICY`
  staleTime and the `{ data, error }` envelope replacing `getSafe()`.
- `useUsageMeter(meterId)` — §5.2 display consumer.
- `useAttentionCount()` — header badge + PriorityStrip share one source (§1.3).

### 6.3 Testing strategy (per project conventions)

- **Contract tests:** `CLIENT_EVENT_BINDINGS` coverage (§4.2); tab deep-link wiring extended to
  the new `?tab=` receivers; `ClientTab` migration map (every legacy value resolves, none 404).
- **Integration tests:** every new `/api/public/*` read path tested against the *public* endpoint
  (CLAUDE.md: admin-route tests give false confidence), unique ports per the 13201–13899 registry,
  fixtures from `tests/fixtures/`, paired `afterAll` cleanup.
- **Component tests:** close the flagged gaps — `ClientCopyReview.tsx` (562 LOC, untested) and
  InsightsEngine filter edges — plus one test per decomposed Health section.
- **A11y debt paid in decomposition PRs:** `DecisionDetailModal` gets `role="dialog"`,
  `ClientHeader` dropdowns get `role="menu"`, missing aria-labels added (findings §8) — cheap when
  the file is already open.
- The one unjustified eslint-disable (`useClientWorkspaceBootstrap.ts:168`) gets fixed or
  justified in Phase 0.

---

## 7. Migration strategy

### 7.1 Principles

Phase-per-PR, staging → main, dark-launch via `<FeatureFlag>` (all project mandates). One master
flag `client-dashboard-v2` plus per-pillar flags (`client-work-tab`, `client-usage-metering`,
`client-purchase-cta`) registered in `shared/types/feature-flags.ts` *before* the first commit.
The old dashboard remains fully functional throughout — the master flag selects nav + routing,
and per-workspace rollout targets let us pilot with 2–3 friendly clients before fleet-wide cutover.

### 7.2 Phases

| Phase | Ships | Visible? | Effort |
|---|---|---|---|
| **0 — Foundations** | staleTime policy, `CLIENT_EVENT_BINDINGS` + contract test, per-slice intelligence + `assembledAt`, pagination, getSafe removal, JWT refresh, rate limiting, ai-polish tier check | No (benefits old UI too) | ~2 wks |
| **1 — IA shell** | New `ClientTab` union, migration map + redirects, `ClientShell`/`ClientNav`/`ClientTabRouter` split, visibility explanations, header attention badge | Flagged | ~1.5 wks |
| **2 — Home** | Briefing-v2 promoted to Home, OverviewTab strengths migrated, monthly digest integrated | Flagged | ~1.5 wks |
| **3 — Results** | Performance/Search/Analytics/Health merged with `?tab=` views, `MetricNarrative` envelopes, narrative job pipeline, Analytics gets its takeaway layer | Flagged | ~2.5 wks |
| **4 — Work** | New tab + the §3.2 projections (workLog, jobsInFlight, playbookEvidence, diagnostics, healthScoreFactors, engagementMirror) | Flagged | ~2.5 wks |
| **5 — Value & monetization** | Value tab, usage metering service, point-of-pain CTAs in Health/Strategy, upgrade flow + trial countdown, Premium pillars (competitorPulse) | Flagged | ~2.5 wks |
| **6 — Cutover & cleanup** | Flag default-on → per-workspace rollout → fleet; delete legacy components + `/approvals/:batchId/apply` (lifecycle `removed`); retire flags; docs/FEATURE_AUDIT/roadmap updates | Yes | ~1 wk |

**Total: ~13–14 calendar weeks** for one senior engineer driving an agent fleet (per
`docs/PLAN_WRITING_GUIDE.md` model-ladder conventions: Haiku-class for mechanical migration work,
Sonnet-class for implementation, Opus-class for cross-context phases 3–5 and review). Each phase
gets its own implementation plan with dependency graph, exclusive file ownership, and the
feature-class definition-of-done gates. Phases 4 and 5 are independent after 3 and can be
parallelized if two owners exist.

### 7.3 Guardrails-first

Per Session Protocol rule 7 (multi-phase features generate guardrails before code), Phase 0's PR
also lands `docs/rules/client-dashboard-v2.md` covering: the `MetricNarrative` envelope contract,
the `CLIENT_EVENT_BINDINGS` classification requirement, the ClientIntelligence projection rules
for new client data, and the migration-map invariant (no legacy `ClientTab` may 404). Candidate
pr-check rules: bare-number-rendering in `src/components/client/` metric surfaces, and client
hooks missing a `CLIENT_QUERY_POLICY` key.

### 7.4 Risks and kill-switches

| Risk | Mitigation / kill-switch |
|---|---|
| Route churn breaks bookmarks/emails | Migration map is permanent (aliases never removed); contract test asserts total coverage; redirect toasts for one cycle |
| Per-slice fetch regresses payload/perf | Phase 0 ships both shapes; old monolith endpoint stays until Phase 6; compare p95 on staging before flipping consumers |
| Google API quota spikes (more surfaces) | staleTime policy lands *first* (Phase 0); server-side slice TTL cache; rate limiting |
| Narrative jobs produce bad prose at scale | Deterministic interpretation always renders; `aiNarrative` is optional in the envelope — per-pillar flag disables AI text instantly without losing the page |
| Monetization regression mid-flight (revenue!) | §5 is entirely behind `client-usage-metering`/`client-purchase-cta`; existing checkout paths untouched until Phase 5 verified on staging; Stripe flows covered by FM-2-pattern error tests |
| Pilot clients confused by new IA | betaMode workspaces pilot first (already premium-forced, no upsell noise); rollback = flip the workspace's flag, old dashboard intact |
| Half-migrated state lingers | Phase 6 is a real phase with its own PR and definition-of-done — deletion is scheduled work, not aspiration; coverage ratchet + `verify:feature-flags` gate every phase |

### 7.5 What we explicitly do not revisit

Unified Inbox structure and note-based routing, soft-gating, free data visibility, the
client/admin split, intelligence-slice data flow, background jobs, and the three-tier model all
survive the rebuild unchanged — the audit found no evidence any of them is the constraint. The
constraint is that the product shows clients *data* when what retains them is *meaning, evidence,
and momentum*. That is what this rebuild ships.
