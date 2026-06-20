# The Issue — Client Dashboard Re-Design (Spec)

> **Status:** Design spec — **advisory; owner review gate before any plan or code.** **Date:** 2026-06-20. **Derived from** the clean-room client-discovery panel ([discovery + gap](2026-06-20-the-issue-client-discovery-spec.md)); **supersedes the CLIENT-dashboard direction** in [the original The Issue design](2026-06-19-strategy-the-issue-design.md) — the admin curation cockpit is unchanged. Owner-ratified calls are in the Decision Register; segment detection resolved 2026-06-20.

**Goal:** Rebuild "The Issue" client surface so it leads with a checkable dollar verdict and outcome count against an engagement-start baseline — the one thing all seven discovery personas named as the product itself — instead of a curated content plan and an agency-invented visibility score.

**Architecture:** Build to the client-discovery spec's persona-dictated spine (verdict → outcome count → money frame → what-needs-me → work-log → everything-SEO-buried), with segment-adaptive layers that swap only the *outcome noun*, *money-frame altitude*, and two optional inserts — never the slot order. Reuse the existing recommendation/deliverable/outcome substrate (`tracked_actions`/`action_outcomes`, `computeROI()`, `getGA4Conversions()`, the Inbox decision loop) wherever it already exists; the dollar/outcome numbers are **phased** — P0 is an honestly-labeled estimate (GA4 key-events × a per-workspace lead value, baseline-anchored to `workspace.createdAt`), P1 graduates to reconciled named records. Every phase ships **flag-gated and flag-OFF byte-identical**, one PR per phase.

**Tech stack:** React 19 + Vite + Tailwind 4 (client surface, shared UI primitives), Express + TypeScript + SQLite/better-sqlite3 (snapshot tables, computeROI extension, public-portal serialization), GA4 Data API via `getGA4Conversions()` (P0 outcome source), the background job platform (`server/jobs.ts`) for the daily snapshot cron, `shared/types/` contracts (`the-issue.ts`, extensions to `workspace.ts`/`roi.ts`/`outcome-tracking.ts`), and the feature-flag catalog in `shared/types/feature-flags.ts`.

---

## DECISION REGISTER (owner-ratified — zero TBDs on these)

| # | Decision | Locked call | Consequence in this spec |
|---|---|---|---|
| **D1 — DATA** | How are outcomes/dollars sourced? | **Phased.** P0 = GA4 key-event conversions × a one-time per-workspace lead/customer-value input, labeled an estimate. P1 = true named-record reconciliation (call tracking + CRM + form capture). | Single `OutcomeProvenance` enum (`estimate_ga4` → `actual_reconciled`) carried on every outcome/money number; P0 never wears P1's confidence; "expand attribution" CTA is the upgrade path. |
| **D2 — BASELINE** | Is a comparison allowed against the evergreen no-dates contract? | **Allowed, surgically.** The verdict (slot 1) and money frame (slot 3) carry a fixed engagement-start baseline anchored to `workspace.createdAt`. Evergreen framing still governs the content plan (slot 5). | `evergreenCopy.ts` splits into two zones: `BANNED_TEMPORAL_PATTERNS` (banned, plan zone) + `ALLOWED_BASELINE_PATTERNS` (required, verdict/proof zone). Rolling/shifting windows stay banned everywhere. A dateless verdict now *fails* CI. |
| **D3 — PROOF HIERARCHY** | Which surfaces lead, which demote? | **Leads:** dollar verdict + outcome count + money frame. **Demoted:** content plan → slot 5 (work-log); proof un-collapsed from `<details>`; 0–100 visibility `MetricRing` **removed** from the headline (under-the-hood only). | Spine re-sequenced (§The Spine). `IssueVerdictHeadline` replaces `NarratedStatusHeadline` at the headline; `MetricRing` import dropped from the headline call site only. |
| **D4 — SCOPE** | Full redesign incl. segments, or spine-only? | **Full**, including segment-adaptive layers driven by an explicit `ClientSegment` model. | Net-new `segment` field + `resolveSegmentProfile()` resolver; five things adapt (outcome noun, money-frame altitude, competitor/authority insert, portfolio roll-up, export format); spine order never forks. |

---

## OWNER RESOLUTIONS (2026-06-20, post-review)

All five review-gate open questions are resolved. **These govern build scope and override anything below that conflicts.**

| Q | Resolution |
|---|---|
| **Lead-value capture** | **Both, with AI fallback.** Per-workspace `outcomeValue` carries a `basis` enum with precedence `client_provided` → `agency_estimate` → `ai_enriched`. Agency can set/override; client can correct it in-portal; if neither exists, an AI-enriched estimate fills in (labeled as such, lowest confidence). Every dollar figure inherits the verdict's `OutcomeProvenance` AND this `basis`. |
| **GA4 conversion selection** | **Reuse the existing `eventConfig` — do NOT build a new config surface.** Workspaces already carry `ws.eventConfig: { eventName, pinned, displayName }[]` (admin pins which GA4 events are true conversions + names them; surfaced today via `isEventPinned` / `eventDisplayName` in `ClientDashboard.tsx:443-448`). The outcome count (slot 2) and verdict (slot 1) sum **pinned** events only and use each event's `displayName` as the outcome noun. If a workspace has no pinned events, fall back to GA4 key-events with an admin nudge to pin. |
| **Baseline window** | **90-day rolling for the trend + one persisted engagement-start anchor.** Reuse the existing ~90-day `roi_snapshots` / `ga4_conversion_snapshots` retention for "vs. last period." ADD a single cheap persisted **engagement-baseline anchor row** (captured/backfilled once at `workspace.createdAt`) so the verdict's "vs. when we started" survives beyond 90 days without full-history retention. Resolves the personas' baseline demand at near-zero storage cost. |
| **P1 integration priority** | **Deferred to roadmap.** No new acquisition integrations (call tracking, CRM/HubSpot, form capture) until the GA4-estimate core works well. The `OutcomeProvenance` enum still reserves `actual_reconciled`, but reconciliation ships later. A `data/roadmap.json` item tracks it. |
| **Legacy workspaces** | **Backfill via GA4 historical API** at `createdAt` to seed the engagement-start anchor; where GA4 retention does not reach, fall back to a labeled "since measurement started [date]" anchor. |

**Net re-scope (honors "get this working well first"):**
- **Build now — Phase 1 = P0 only:** the trust spine on GA4 *estimates* (verdict → outcome count → money frame → what-needs-me → work-log → under-the-hood), wired to `eventConfig` pinned events + the `outcomeValue`/`basis` input + the dual baseline (90-day rolling + engagement anchor, backfilled).
- **Fast-follow (after P0 proves out) — cheap, no-integration P1:** return-hook push/export, the local map-pack/reviews insert (existing data), the segment-conditional competitor block.
- **Roadmap (deferred) — integration-dependent reconciliation:** call tracking, CRM/HubSpot, form capture (the `actual_reconciled` graduation).

---
## The Spine (universal layout, slots 0–6)

A single top-to-bottom layout every client gets, regardless of segment or tier. It replaces the inverted spine in `TheIssueClientPage.tsx` (where `IssueContentPlanSection` is the HERO and the proof band sits behind a `<details>`). The three D3 reversals are baked into the slot order and contracts. Segment behavior never changes slot order — it swaps the outcome noun and money-frame altitude inside slots 1–3 and toggles inserts inside slot 6 (see §Segment-Adaptive Layers).

### Spine-to-persona-slot map

| Spine slot | Persona slot (discovery §B) | What it shows | Fill | D-decision applied |
|---|---|---|---|---|
| **0. Your turn** (conditional) | §B.4 (early surface) | Escalation pill / `null` when empty | **Reuse** `ActionQueueStrip` | unchanged |
| **1. The Verdict** | §B.1 | One-line dollar/outcome verdict vs. spend, baseline-anchored | **Net-new** `IssueVerdictHeadline` (replaces `NarratedStatusHeadline` at headline) | D3 verdict leads; ring removed · D2 baseline allowed |
| **2. The Outcome Count** | §B.2 | Outcomes in human units + trend vs. last period AND vs. baseline | **Net-new** `OutcomeCountBand` | D3 promoted to slot 2 |
| **3. The Money Frame** | §B.3 | Outcome value next to retainer (estimate-labeled) | **Reuse + extend** `ROIDashboard` (un-collapsed, lead-value aware) | D3 un-collapsed, promoted · D1 lead-value |
| **4. What needs ME** | §B.4 | Decision queue (max 3) or explicit "Nothing needed" | **Reuse** `ActionQueueStrip` (canonical home) | unchanged |
| **5. What we did + what's shipping next** | §B.5 | Outcome-tagged work-log + curated content plan (demoted here) | **Reuse** `WinsSurface`, `OutcomeSummary`, `IssueContentPlanSection`, `IssueAlsoOnPlanSection`, `IssueLoopFooter` | D3 content plan demoted from HERO |
| **6. Under the hood** | §B.6 | Rankings/traffic/health + segment inserts, collapsed | **Reuse** `CompactStatBar`, `ROIDashboard` page tables, `CompetitorGapsSection`, `StrategyRequestedKeywordTrendSection` | D4 competitor block becomes segment-conditional; demoted ring lives here |

Slots are numbered 0–6 because slot 0 ("Your turn") is the same `ActionQueueStrip` that anchors slot 4, surfaced early only when something is blocked. When nothing is pending, `ActionQueueStrip` renders `null` (existing empty-state law) and the page opens directly on the Verdict.

### Slot 0 — Your turn (conditional escalation strip)
- **Reuse:** `ActionQueueStrip` (`src/components/client/Briefing/ActionQueueStrip.tsx`), unchanged. Wired through `actionCounts`. Suppressed in `previewMode`. Renders `null` when empty (line 137, KEEP) — the page opens on the Verdict.

### Slot 1 — The Verdict (net-new headline — the product itself)
- **Maps to §B.1** — *"the one-line verdict, plain English, dated baseline, trend… a conclusion, not a chart."* Named "the product itself" by every persona.
- **Shows:** one human sentence with a checkable number and a baseline anchor. Examples at different altitudes: Local SMB *"New patient inquiries: 14, up from 9 — and up from 6 when we started"*; B2B-SaaS *"Organic-influenced pipeline $X (4.2× your retainer), up from $Y at start"*; Board/VC *"Organic CAC $X, down Y% since Q[start], vs. $Z paid — on track."*
- **D2 baseline relaxation:** the verdict carries a comparison anchored to `workspace.createdAt` (NOT a rolling window, NOT `action.created_at`). Verb tense stays achieved-state ("up from… when we started"). The `evergreenCopy.ts` carve-out (§Anti-Features & Reversals) applies here.
- **D3 ring removal:** the 0–100 `MetricRing` is removed from this headline. The net-new component must not import `MetricRing`. The visibility score survives only at slot 6.
- **Fill — net-new `IssueVerdictHeadline`** (`src/components/client/the-issue/IssueVerdictHeadline.tsx`), replacing `NarratedStatusHeadline` at the top. It KEEPS from the old component: (a) the "Curated by your strategist" byline, (b) the optional `topRec.opportunity` contribution bars as opt-in progressive disclosure. It DROPS the `score`/`evergreenVerdict()` band sentence and the `MetricRing`.
- **Canonical data shape** (assembled server-side, rides the public payload):
  ```ts
  // shared/types/the-issue.ts (net-new)
  export interface IssueVerdict {
    outcomeNoun: string;            // per-segment, e.g. 'new patients' | 'qualified leads' | 'pipeline $'
    current: number;                // current-period outcome value (count or dollars)
    baseline: number | null;        // same metric at workspace.createdAt; null until baseline exists
    priorPeriod: number | null;     // previous comparable period; null when unavailable
    unit: 'count' | 'dollars';
    sentence: string;               // plain-English, pre-templated server-side from segment dictionary
    provenance: OutcomeProvenance;  // 'estimate_ga4' (P0) | 'actual_reconciled' (P1)
  }
  ```
  > **Naming note (drift fix):** the single confidence/provenance field across the whole spec is `provenance: OutcomeProvenance` (values `estimate_ga4` | `actual_reconciled`). The render contract derives the human label and the precision rounding from it. Earlier drafts called this `confidence: 'approximate'|'reconciled'`; that is normalized to `provenance` everywhere.
- **Data source (P0):** `outcomeNoun` count from `getGA4Conversions()` (`server/google-analytics.ts:438`), dollar verdict = count × the new per-workspace lead/customer value; `baseline` anchored to `workspace.createdAt`. Requires GA4 conversion persistence (see §Data Layer). `provenance==='estimate_ga4'` MUST render a visible estimate label.
- **Data source (P1):** `provenance` flips to `actual_reconciled` once named records close the loop; the number becomes click-through-able to the named list (slot 2). Shape and copy don't change.
- **Thin state:** when `baseline === null` (new workspace), render *"We're establishing your baseline now; your verdict appears here as outcomes land."* and show `current` without a fabricated delta. When GA4 is unconnected, fall back to the strongest available outcome (e.g. search clicks) explicitly labeled a proxy.

### Slot 2 — The Outcome Count (net-new band)
- **Maps to §B.2** — *"the outcome count in real human units, trend vs. last period AND vs. baseline, clickable to the actual list."*
- **Shows:** the verdict number decomposed into segment units (calls + form fills + bookings / leads + demos / qualified inquiries by title & firm), each with a dual trend arrow (vs. last period AND vs. baseline) and intended to be clickable to named records.
- **Fill — net-new `OutcomeCountBand`** (`src/components/client/the-issue/OutcomeCountBand.tsx`), composing `StatCard` (delta badges, hero size) / `CompactStatBar` for the dense variant. It does NOT replace `OutcomeSummary`/`WinsSurface` (those stay the win-quality scorecard and win ledger at slot 5).
- **Canonical data shape:**
  ```ts
  // shared/types/the-issue.ts (net-new)
  export interface IssueOutcomeCount {
    units: {
      label: string;                // 'calls' | 'form fills' | 'demos' | …
      current: number;
      baseline: number | null;
      priorPeriod: number | null;
      eventName?: string;           // GA4 key-event backing this unit (P0)
    }[];
    provenance: OutcomeProvenance;
    namedRecordsAvailable: boolean;  // false at P0 → render the honest upsell affordance
  }
  ```
- **Data source (P0):** counts from persisted GA4 key-events broken out by `eventName` from `GA4ConversionSummary`. Trend-vs-last-period from period-over-period snapshots; trend-vs-baseline from the `createdAt`-anchored first snapshot. The "clickable" affordance links to the per-event aggregate (`getGA4EventsByPage()`) with a "names available with call/CRM tracking" upsell.
- **Data source (P1):** clickable to the actual named inquiry list once reconciliation exists. Row contract (`onClick` per unit) is designed for this now — P1 is a data swap, not a re-layout.
- **Thin state:** when no conversion events are configured, render `EmptyState` with a set-up-event-tracking CTA — never a zero count as a measured outcome. Genuinely flat periods show the flat number honestly (no all-green spin).

### Slot 3 — The Money Frame (reuse + extend `ROIDashboard`, un-collapsed)
- **Maps to §B.3** — *"the money frame: outcome value vs. retainer, in dollars."* The personas want customer value next to the retainer, not cost-to-buy-traffic.
- **Two changes to `ROIDashboard`** (`src/components/client/ROIDashboard.tsx`):
  1. **Un-collapse it.** Promote it out of the `<details>` (currently slot 5) to a top-level slot above the content plan. The per-page traffic-value table and content-attribution table move to slot 6 via a `compact` prop, so slot 3 shows only the headline money frame.
  2. **Make it lead-value aware.** `ROIData` gains optional outcome-value fields (see §Data Layer). The lead money frame renders *alongside* the traffic-value model (which demotes to a labeled secondary metric). `ROIMethodologyDisclosure` prose (lines 67–68: "We do not multiply by lead value…") must be **rewritten** in the same PR — the route-removal/string-rename discipline applies.
- **Data source (P0):** outcome count (slot 2) × the per-workspace lead/customer value input. The MoM rolling stat stays suppressed (`showMoM` at `ROIDashboard.tsx:189`), but the baseline-anchored "vs. when we started" comparison is now allowed and replaces the dateless "Pages Tracked" stat when a baseline exists.
- **Data source (P1):** graduates from "estimated value" to "influenced revenue" via closed-loop attribution, with the "expand attribution" CTA.
- **Thin state:** existing `ROIDashboard` states reused (free-tier `TierGate`, loading, error, "ROI appears once traffic and keyword cost data are available"). When lead-value is unset, render the traffic-value model alone + an admin-only nudge — never fabricate a dollar verdict.

### Slot 4 — What needs ME (canonical decision queue)
- **Reuse** `ActionQueueStrip` as the full queue. The explicit "Nothing needed from you right now" affirmation renders here when counts are zero — the "permission to close the tab happily" the personas wanted, placed *below* results so the verdict leads. Same `actionCounts` prop.

### Slot 5 — What we did + what's shipping next (work-log; content plan demoted here)
- **Maps to §B.5** — *"what YOU did since I last looked + what's shipping next — concise, outcome-tagged, clickable."* **Placement law:** activity is reassurance, not the headline.
- **Shows, in order:** (1) outcome-tagged wins (`WinsSurface`), (2) win-quality scorecard (`OutcomeSummary`), (3) the demoted curated content plan (`IssueContentPlanSection` via `IssueContentCard`, + `IssueAlsoOnPlanSection`, + `IssueLoopFooter`). The content plan KEEPS its full internal treatment (value-first cards, "Relevant/Not relevant" feedback, "Let us talk" soft-yes) but loses its HERO styling — it reads as peer to the work-log. Evergreen *framing* governs this zone (no false weekly urgency).
- **Reuse, all existing:** `WinsSurface` (`{ workspaceId, effectiveTier }`), `OutcomeSummary` (`{ workspaceId, tier }`), `IssueContentPlanSection`, `IssueAlsoOnPlanSection`, `IssueLoopFooter`.
- **Data source:** outcomes from `getTopWinsFromActions()`/`action_outcomes`; content plan from `useClientTheIssue` recommendations; loop status from `useClientRecResponses` + `useClientContentRequests`.
- **Thin state:** existing honest-floor lines (`ISSUE_SECTION_INTROS.contentPlanFloor`); tier-aware empty states. Never manufacture wins.

### Slot 6 — Under the hood (collapsed; everything SEO + segment inserts)
- **Maps to §B.6** — *"everything an SEO cares about but the client doesn't — collapsed below the fold."*
- **Shows (collapsed by default):** the raw metric strip (impressions/clicks/position/site health/**the demoted visibility score**), `ROIDashboard` per-page + content-attribution tables (via `compact` on the slot-3 instance), the requested-keyword trend, and the segment-conditional competitor/authority insert.
- **Reuse:** `CompactStatBar` (`statItems` array, blue=data per Four Laws), `ROIDashboard` page/content tables, `StrategyRequestedKeywordTrendSection`, `CompetitorGapsSection` — **now segment-conditional** (D4): shown for B2B-SaaS + professional-services, hidden for local SMB. The Premium `TierGate` still applies *within* segments that get it; segment decides *whether* it appears, tier decides *depth*.
- **Data source:** existing `overview` (GSC), `ga4Overview`, `ga4Conversions`, `audit`, `strategyData.strategyUx.orient` (visibility score). Never auto-expand — the collapse IS the design.

---

## The Data Layer (phased outcome + money)

The load-bearing section. The governing honesty principle (VC: *"false precision reads as spin"*; churned client: *"a single number you control with no shown formula is an instant trust kill"*): **never present an estimate as an actual, always show the methodology, never invent a number we can't source.**

### The honesty boundary (the `OutcomeProvenance` enum)
GA4's Data API intentionally omits user/pseudo-IDs, so P0 conversions are **event-level aggregates only** — no contact-level granularity, no name attribution. P0 answers *"how many key-event conversions, roughly what they're worth."* P1 answers *"who, by name, did they close"* — and requires call tracking + CRM + form capture that **zero files implement today** (no HubSpot/Salesforce/Twilio/CallRail anywhere in `server/integrations/`). The boundary is enforced by one shared enum carried on every outcome/money number:

```ts
// shared/types/outcome-tracking.ts (net-new)
export type OutcomeProvenance =
  | 'estimate_ga4'        // P0: GA4 key-event aggregate × client lead value. Renders an "estimate" label.
  | 'actual_reconciled';  // P1: reconciled to call-tracking / CRM / form capture. Renders "actual".
```

P0 hard-codes `estimate_ga4`. Render rule (data-honesty requirement): `estimate_ga4` MUST render an "estimate" qualifier + a one-line methodology disclosure (reusing the disciplined `ROIMethodologyDisclosure` pattern, repointed to outcome value), and MUST NOT render two-decimal precision — a new `fmtEstimate()` companion to `fmtMoney` in `src/utils/formatNumbers.ts` rounds estimated ratios to one significant figure ("~7×") and dollars to a band ("~$11,000"). `actual_reconciled` may show exact figures because they are sourced.

### P0 — outcome count + dollar verdict against a baseline (buildable now)

**P0.1 — Persisted GA4 key-events.** Source: `getGA4Conversions()` (`server/google-analytics.ts:438`) → `GA4ConversionSummary[]` (`{ eventName, conversions, users, rate }`, `isKeyEvent=true`). The blocking gap: conversions are pulled on demand and discarded — no time series, no baseline. Fix with one net-new daily snapshot table, modeled on `roi_snapshots`:

```ts
// shared/types/outcome-tracking.ts (net-new) — backing table: ga4_conversion_snapshots
export interface Ga4ConversionSnapshot {
  workspaceId: string;
  capturedAt: string;            // ISO; daily cron stamp
  totalConversions: number;
  byEvent: { eventName: string; conversions: number; users: number; rate: number }[]; // mirrors GA4ConversionSummary
  totalUsers: number;
  /** @remarks rate is already a percentage (e.g. 6.3 for 6.3%). Do NOT multiply by 100. */
}
```
A daily cron (sibling to the ROI snapshot writer, on the background job platform) persists one row per workspace, back-anchored to `workspace.createdAt` so the baseline is "since we started," not "since we first queried GA4." Aggregates only — consistent with the GA4 privacy constraint. **Honest gap to disclose, not paper over:** P0 cannot make the count clickable to named records; it ships the count with an honest affordance and the named list is a P1 deliverable.

**P0.2 — The baseline anchor.**
```ts
// shared/types/the-issue.ts (net-new)
export interface OutcomeBaseline {
  engagementStart: string;            // workspace.createdAt — fixed, never shifts
  baselineConversions: number | null; // earliest snapshot at/after engagementStart; null until enough history
  baselineCapturedAt: string | null;  // ISO of the snapshot used, for "vs. Jan" labeling + audit
  state: 'establishing' | 'ready';
}
```
Reuse the `computeGrowthPercent()` window discipline (`server/roi.ts:63`) so comparison logic is identical to ROI's and can't drift. This deliberately mirrors but does NOT conflate the existing per-action `BaselineSnapshot` (`shared/types/outcome-tracking.ts:51`, anchored to `action.created_at`): `OutcomeBaseline` is workspace-level/engagement-start-anchored and powers the *client verdict only*; the per-action substrate continues to power admin read-back and the `WinsSurface` ledger.

**P0.3 — The dollar verdict (per-workspace value input).** No `leadValue`/`customerValue` exists today (`contentPricing` is pricing-only). Add a net-new optional block on `Workspace`, adjacent to `contentPricing` (line 352) / `intelligenceProfile` (line 376):
```ts
// shared/types/workspace.ts (net-new, optional — absent = count-only, no dollar verdict)
outcomeValue?: {
  valuePerOutcome: number;           // dollar value of one converted outcome (client's number)
  unitLabel: string;                 // 'new patient' | 'qualified lead' | 'booking' …
  currency: string;                  // reuse contentPricing currency convention
  basis: 'client_provided' | 'agency_estimate';
  monthlyRetainer?: number;          // optional — enables value-vs-spend in one line
};
```
Edited by the admin in `src/components/settings/ClientDashboardTab.tsx`, a net-new "Outcome value" subsection directly after Content Pricing (the natural seam; the PATCH reuses the existing workspace-update route family, not a new endpoint). Computation extends `computeROI()` (`server/roi.ts:146`) — do not fork the endpoint — to return an outcome-denominated block when both GA4 conversions and `outcomeValue` are present:
```ts
// shared/types/roi.ts — additive, all optional (legacy callers unaffected)
outcomeVerdict?: {
  outcomeCount: number;              // current-period total key-event conversions
  outcomeUnitLabel: string;
  valuePerOutcome: number;
  estimatedValue: number;            // outcomeCount × valuePerOutcome
  monthlyRetainer: number | null;
  baseline: OutcomeBaseline;
  baselineDeltaCount: number | null; // null while establishing
  provenance: OutcomeProvenance;     // ALWAYS 'estimate_ga4' in P0
};
```
The verdict string ("14 new patients ≈ ~$11,000 vs. your $1,500 retainer; up from 9") is a pure render of this block, composed in `IssueVerdictHeadline`, not assembled client-side.

**P0.4 — Segment altitude (data-layer scope).** The verdict *slot* is fixed; the *noun/unit* adapt via `outcomeValue.unitLabel` + segment (full classification is §Segment-Adaptive Layers). Altitudes the data layer supports: Local SMB / professional services → count × value vs. retainer; B2B / VC → the same `outcomeVerdict` block rendered as a ratio (`estimatedValue / monthlyRetainer`) or CAC framing. True pipeline→closed-won and true organic-CAC-vs-paid require CRM data and are **P1**; P0 delivers the conversion-count estimate and labels it.

### P1 — true named-record reconciliation (net-new acquisition infrastructure)
P1 graduates `provenance` to `actual_reconciled` and unlocks "clickable to named records." Each integration is independently shippable and upgrades the *same* field rather than building a parallel surface.

```ts
// shared/types/outcome-tracking.ts (net-new, P1) — backing table: conversion_records
export interface ConversionRecord {
  id: string;
  workspaceId: string;
  occurredAt: string;
  source: 'call_tracking' | 'crm' | 'form_capture';
  contactName?: string;              // the named record
  contactCompany?: string;
  quality?: 'qualified' | 'spam' | 'existing' | 'out_of_area' | 'unscored'; // "don't count garbage"
  revenueClosedWon?: number;         // closed-loop, when CRM provides it
  attributedActionId?: string;       // links back to the rec/action — reuses existing lineage
}
```
The three P1 inputs (each absent today, each its own integration): **(1) call tracking + recording + quality scoring** (`source='call_tracking'`; strongest local upsell; enables dollarized "missed N callable leads"), **(2) CRM/HubSpot** (`source='crm'`; graduates the money frame to influenced/closed-won revenue, supplies `revenueClosedWon`; `attributedActionId` stamps closed-won back onto the originating recommendation, completing the lead→opp→closed-won chain the substrate already half-built), **(3) form capture** (`source='form_capture'`; on-site form fills as named records). A net-new daily reconciliation job matches `ConversionRecord`s to the GA4 aggregate; **discrepancies are shown, not hidden** — if the dashboard count and the client's source-of-truth diverge, display both and explain why.

### Per-payload exposure (both phases)
The client surface reads everything from `GET /api/public/roi/:workspaceId` (extending `ROIData`), reusing the `useClientROI` hook (`useClientQueries.ts:133`) and the client-safe serialization boundary — extend, not invent. Per the DB-column-+-mapper-lockstep rule, every net-new public-payload field must be added to its serializer's explicit field list in the same change, or it silently never reaches the client. The integration test must exercise the **public** endpoint, not the admin GET.

---

## Segment-Adaptive Layers (D4: full scope)

**Design principle — "one product, configured," not five products.** The dentist and the VC want the *same slot filled at a different altitude*, never a different layout. `TheIssueClientPage.tsx` stays the single spine container; it reads one resolved `ResolvedSegmentProfile` and passes its fields as props. The five things that adapt: **(1) the outcome noun, (2) the money-frame altitude, (3) whether the competitor/authority insert renders, (4) whether a portfolio roll-up renders, (5) the export format.** Everything else is fixed.

### The segment model (net-new — the load-bearing piece)
There is no segment classifier today. The only signals are unstructured (`intelligenceProfile.industry` free text, `businessProfile.numberOfEmployees` string range, `businessContext` narrative, the `client_locations` table). **Tier must NOT be reused as a segment proxy** — a free dentist and a free SaaS team are the same tier, opposite segments. Segment and tier are orthogonal: segment decides *which* slots; tier decides *how deep*.

```ts
// shared/types/workspace.ts (net-new) — backing column: segment_config (typed JSON, parseJsonSafe at read boundary)
export type ClientSegment =
  | 'local_smb'             // single-location service: calls/forms/bookings
  | 'b2b_saas'              // pipeline-led: leads/demos → pipeline $ → influenced revenue
  | 'board_vc'              // efficiency-led: organic CAC vs paid
  | 'professional_services' // authority-led: qualified inbound by title/firm
  | 'multi_location';       // portfolio/triage: roll-up + ranked needs-attention

export interface SegmentConfig {
  segment: ClientSegment;
  outcomeNounSingular?: string;   // admin override, e.g. "new patient"
  outcomeNounPlural?: string;     // "new patients"
  reportingAudience?: 'self' | 'board' | 'partners' | 'owners';
}
```

**Owner-ratified detection (2026-06-20): the Strategy local setup is the deterministic source for the local axis; Brand & AI is the source for the non-local split.**
- **`local_smb`** — exactly one `client_locations` row (a local market configured in the Strategy local setup).
- **`multi_location`** — two or more `client_locations` rows.
  Both of the above are **fully deterministic** from `getClientLocations(workspaceId).length` — no AI, no guess, no confirmation needed.
- **`b2b_saas` / `professional_services` / `board_vc`** — only reached when the workspace has **zero** `client_locations`. The split is **derived from the Brand & AI business profile** (`intelligenceProfile.industry` + `targetAudience`/personas, with `numberOfEmployees` / `businessContext` as secondary signals) via `callAI({ operation: ... })` with a named operation contract returning a Zod-validated `{ segment, confidence }`.

The local/multi axis is authoritative and silent. The non-local 3-way proposal is **advisory** — set in `ClientDashboardTab.tsx` (where the lead-value input also lives); the admin confirms or overrides, and derivation never silently sets a client-facing verdict noun (a misclassification is itself a trust violation). `board_vc` is an audience choice (`reportingAudience`), typically an explicit admin selection rather than derived.

**Resolution + exposure.** A net-new server-side `resolveSegmentProfile(ws)` (sibling to `computeEffectiveTier`) returns one pre-resolved representation (per the authority-layered-fields rule — the client never gets raw `industry`/`numberOfEmployees` to re-derive):
```ts
export interface ResolvedSegmentProfile {
  segment: ClientSegment;
  outcomeNounSingular: string;
  outcomeNounPlural: string;
  moneyFrameAltitude: 'production_vs_retainer' | 'pipeline_ratio' | 'cac_vs_paid' | 'portfolio_cost_per_lead';
  showCompetitorAuthority: boolean;   // gates the B2B/services insert
  showPortfolioRollup: boolean;       // gates the multi-location inversion
  showLocalMapAndReviews: boolean;    // gates the local-only first-screen insert
  exportProfile: 'sms_recap' | 'board_one_pager' | 'partner_summary' | 'owner_portfolio' | null;
}
```
Added to `toPublicWorkspaceView()` so `WorkspaceInfo` carries it exactly as it carries `tier`. DB-column + mapper lockstep applies (migration + row interface + `rowToX` mapper + write path + public-portal serialization, one commit). Sections read the boolean flags, never the raw segment, so segment logic lives in one place.

### What is FIXED across all segments
Spine order; the verdict leads with a baseline-anchored comparison; the visibility `MetricRing` removed from the headline; `ActionQueueStrip` + its "Nothing needed" state; anti-feature discipline (no keyword tables, DA/DR, confetti, raw impressions-as-headline); no-jargon copy; the "Curated by your strategist" byline; the "why this is the move" bars; the P0 estimate-labeled dollar verdict as the slot-3 substrate. Segment never re-promotes the ring and never forks the layout.

### The swap matrix (single source of truth for `resolveSegmentProfile`)

| Segment | Outcome noun (slots 1–2) | `moneyFrameAltitude` (slot 3) | `showCompetitorAuthority` | `showPortfolioRollup` | `showLocalMapAndReviews` | `exportProfile` |
|---|---|---|---|---|---|---|
| `local_smb` | calls + forms + bookings ("new patients"/"leads") | `production_vs_retainer` | **false** | false | **true** | `sms_recap` |
| `b2b_saas` | leads/demos → pipeline $ → influenced rev | `pipeline_ratio` (4.2×) | **true** (commercial-term SOV) | false | false | `board_one_pager` |
| `board_vc` | organic CAC vs paid; payback; share trend | `cac_vs_paid` | true (secondary) + moat slot | false | false | `board_one_pager` |
| `professional_services` | qualified inbound by title/firm | `pipeline_ratio` | **true** (topic-vs-firm authority) | false | false | `partner_summary` |
| `multi_location` | portfolio leads + cost/lead | `portfolio_cost_per_lead` | false (portfolio level) | **true** | per-location (drill-down) | `owner_portfolio` |

### Per-segment specifics
- **Local SMB:** money frame = `production_vs_retainer` (the read-aloud sentence). Competitor block **OFF by segment** (not tier — a premium local SMB still sees none). The one local-only first-screen citizen (`showLocalMapAndReviews=true`): map-pack/"near me" position + Google reviews status (rating, new-review count, unanswered/negative flagged) — net-new client UI over existing `server/local-seo.ts` + `getClientLocations`. Export = `sms_recap`.
- **B2B-SaaS:** money frame = `pipeline_ratio` (ratio at top); competitor insert ON as **commercial-intent share-of-voice** vs. 2–3 named competitors ("the 10 money terms, not 500"); adds commercial-keyword movement + emerging AI-answer visibility (P2). Block *visibility* is segment-driven; *depth* stays `TierGate`-gated. Export = `board_one_pager`.
- **Board/VC:** primary deliverable is the export + the two-line push (this persona barely logs in). Money frame = `cac_vs_paid` with honest denominator, consistent (non-silently-restated) attribution methodology, no all-green, no invented score. Unique moat slot = the compounding-asset view (P2). Export = `board_one_pager`.
- **Professional services:** outcome noun includes inquiry *quality* (title/firm). The authority insert REPLACES the keyword slot, in its topic-vs-firm configuration (distinct from B2B's commercial-SOV configuration). Unique trust guard fuses slots 4+5: a **partner-byline approve-before-publish gate** wired into the existing decision/approval loop (reuse the plumbing `IssueContentCard`/`ActionQueueStrip` already use). Brand-mention monitoring + AI-answer visibility are P2. Export = `partner_summary`.
- **Multi-location:** the spine *inverts* (the one structural exception). Slot 1 = portfolio number; slot 2 = a ranked "needs attention" triage list (3–5 slipping locations, biggest-$-impact first) — a net-new triage component over per-location `local-seo.ts` snapshots + per-location outcome counts; plus top-3 over-performers and an "X of 22 clean" consistency roll-up. The 22-row table is a collapsed drill-down, never the front door. Money frame = `portfolio_cost_per_lead`. Export = `owner_portfolio`.

---

## Money Mechanics + Trust Guards

Expansion mechanics and trust guards are **one contract**, not two features (churned client: *"a trust instrument first and a reporting tool second"*). Every expansion lever fires only after the trust guard underneath it holds.

### Pay-more / expansion levers (mapped to UI moments)
**Governing rule:** every expand moment is a transparent ROI math problem (dollars in, expected dollars out), never a sales pitch. Each card shows cost and projected return.

| Lever | UI moment (component / phase) | Personas |
|---|---|---|
| **Call/lead tracking + recording + quality scoring** | Net-new `MissedOpportunityCard` adjacent to the outcome count: *"~6 callable calls went to voicemail ≈ ~$X lost"* (reuses `StatCard` + `outcomeValue`). **P1.** | Dentist, HVAC, churned |
| **Closed-loop revenue attribution** | The money-frame "expand attribution" affordance, inline in `ROIDashboard` when `provenance==='estimate_ga4'`. Graduates `attributed_value` basis to `'reconciled_revenue'`. **P1.** | SaaS, VC, consulting, HVAC |
| **Do-more-of-the-work** | "We can take this off your plate" affordance on `IssueLoopFooter`/`AgencyWorkFeed` work-log items, time-saved framing. **P0 copy hook, P1 wiring.** | SaaS, consulting |
| **Proactive "next bets" with projected $** | Net-new `NextBetsCard` in slot 6/strategy: *"3 plays — here's what each could be worth,"* from existing recommendation `estimatedGain` re-expressed in dollars via `outcomeValue`. **P0** (reframe only). | SaaS, VC, churned |
| **High-value service / market expansion** | Opportunity card reusing `ContentGapRow`/`CompetitorGapsSection` rendering, re-pointed at high-value service gaps. **P0/P1.** | Dentist, multi-location |
| **Competitive intelligence (standing service)** | `CompetitorGapsSection`, **segment-conditional** (not Premium-for-all). **P1 (segment gating).** | SaaS, consulting, churned, multi-location |
| **AI-answer visibility** | Net-new section: *"Do you show up when buyers ask ChatGPT 'who's best for X'."* **P2.** | SaaS, consulting |
| **Forwardable board/QBR one-pager export** | "Download board-ready one-pager" button on the verdict. **P1 — the return hook.** | SaaS, VC, consulting, multi-location |

**Expansion-moment design law:** no expand affordance appears while its underlying trust guard is failing. The "expand attribution" CTA is suppressed if the *current* count cannot reconcile — we never invite paying for *more* attribution on top of a number the client already distrusts.

### The reconciliation guard (the #1 churn trigger, 7/7)
*"If the dashboard says 47 leads and my phone says 12, I'm gone that day."* Reconciliation is a first-class, always-visible provenance layer, not a footnote.

```ts
// shared/types/reconciliation.ts (net-new)
export type OutcomeSource =
  | 'ga4_key_events' | 'call_tracking' | 'form_capture' | 'crm' | 'agency_estimate';
export interface ReconciliationBadge {
  source: OutcomeSource;
  label: string;                       // rendered verbatim, e.g. "Sourced from your GA4 conversions"
  provenance: OutcomeProvenance;       // normalized to the single shared enum
  asOf: string;                        // freshness anchor — drives the stale-data guard
}
```
> **Drift fix:** this badge's confidence field is normalized to `provenance: OutcomeProvenance` (one enum across the whole spec), not a separate `'approximate'|'reconciled'` string.

Rendered as a small caption under each number (reusing `Badge`/`CompactStatBar` typography). P0 every count reads *"Sourced from your GA4 conversions"*; P1 *"Matched to your front desk / HubSpot."* A net-new `ReconciliationNote` proactively explains why the platform number and the client's truth can diverge (*"This counts Google-attributed conversions only — direct calls and walk-ins aren't included yet; connect call tracking to see those"*). The "what counts as a win" definition is shown, locked, and **never silently restated** (versioned/annotated on the trend, never applied retroactively without a visible note).

### The remaining trust guards (anti-spin contract)

| Guard | Enforcement seam |
|---|---|
| **No agency-controlled invented score as the headline** | `MetricRing` removed from `IssueVerdictHeadline` (D3); under-the-hood only, with a shown formula. |
| **No false precision** | `fmtEstimate()` render contract — one-sig-fig ratios, banded dollars whenever `provenance==='estimate_ga4'`; exact figures only on `actual_reconciled`. |
| **No all-green / show honest dips** | Verdict/trend render declines truthfully (existing score-color bands); a flat/down period shows the honest number plus the plan. |
| **Baseline always present** | Every headline number carries `baseline` ("since we started"); a number with no baseline is suppressed, not shown. |
| **No stale data** | `ReconciliationBadge.asOf` renders "last updated"; a stale snapshot surfaces a visible "data may be delayed" state. |
| **Verifiable, dated, clickable work-log** | Reuse `IssueLoopFooter` + `WinsSurface` + `AgencyWorkFeed`; P1 adds the clickable-to-live-artifact link. Demoted to slot 5 (D3), never the hero. |
| **No lock-in / easy export** | The forwardable one-pager (P1) doubles as the anti-hostage guard. |
| **Don't count garbage as wins** | "What counts" definition excludes reschedules/spam/job-seekers/out-of-area; P1 `ConversionRecord.quality` scoring flags low-quality leads rather than inflating the count. |
| **Credibility gate (services)** | Partner-byline approve-before-publish gate fused into the work-log (slots 4+5). **P2.** |

---

## Anti-Features Kept + The Reversals

The discipline boundary is **asymmetric**: the anti-feature discipline is load-bearing and survives the reorg untouched; the three reversals are surgical and bounded. A worker who deletes a KEEP item to make room for a reversal has regressed.

### Part A — KEEP (the anti-feature discipline the personas praised)
- **A1. No keyword ranking tables / position grids / "you rank for N keywords" up top.** The raw click/impression/position strip (`CompactStatBar`, `TheIssueClientPage.tsx` `statItems` lines 151–159) stays *below* the verdict and money frame. The reversals change *what* leads, never re-promote a keyword grid.
- **A2. No vanity/composite score as a headline number.** Extends the Four Laws' "no hand-rolled score colors" to "no invented number a client can't put in a model." (The one we violated — the ring — is Reversal 3.)
- **A3. No jargon walls.** The `ISSUE_SECTION_TITLES`/`ISSUE_SECTION_INTROS` contract (`evergreenCopy.ts` lines 14–33) and client-friendly archetype labels in `IssueAlsoOnPlanSection` are KEEP. The new verdict/money frame are authored *through* `evergreenCopy.ts`, not as raw metric labels.
- **A4. ROI honesty labels.** `ROIMethodologyDisclosure` (`ROIDashboard.tsx` lines 24–72). KEEP the disclosure pattern + estimate-labeling discipline. NOTE: the prose at **lines 67–68** ("We do not multiply by lead value…") must be **edited, not deleted** when the P0 dollar verdict lands — it changes to "we multiply your outcomes by the per-lead value *you gave us* — a labeled estimate, not booked revenue." This is the single co-design seam between KEEP and BUILD; the change ships in the same commit.
- **A5. `ActionQueueStrip` empty-state `null`** (`ActionQueueStrip.tsx` line 137). KEEP exactly; suppressed in `previewMode`. (P0 may add an *explicit* "Nothing needed from you right now" line at slot 4 as an enhancement, not a regression of the null behavior.)
- **A6. The "Curated by your strategist" byline** (`TheIssueClientPage.tsx` lines 173–176). KEEP, attached to the verdict/status block.
- **A7. The "why this is the move" bars + Relevant/Not-relevant + "Let us talk" loop** (`NarratedStatusHeadline.tsx` lines 68–101; `TheIssueClientPage.tsx` lines 124–133). KEEP, hidden-by-default. Rule: keep, do not expand.
- **A8. No confetti/gamification/badges/speedometers.** The new verdict is a sentence with a number, never a dial.

### Part B — The reversals (precise, bounded)

**Reversal 1 — Evergreen relaxation (D2), two zones, both enforced through `evergreenCopy.ts`:**
- **Zone 1 (relaxation applies): VERDICT (slot 1) + PROOF/money frame (slot 3).** MAY carry exactly one anchored comparison: a since-engagement-start baseline (anchored to `workspace.createdAt`) and, where data supports it, a vs-last-period trend. Never a rolling/cherry-picked window.
- **Zone 2 (evergreen still holds): CONTENT PLAN (slot 5) + ALSO-ON-PLAN.** No false weekly urgency, no issue numbers, no manufactured cadence.
- **Precise `evergreenCopy.ts` changes:** `BANNED_TEMPORAL_PATTERNS` (lines 90–100) applies ONLY to Zone 2; a new `ALLOWED_BASELINE_PATTERNS` allow-list (`/\bsince we started\b/i`, `/\bvs\.?\s+when we started\b/i`, `/\bsince [A-Z][a-z]+\b/`) is required for Zone 1 strings (a Zone-1 string with *no* baseline is now a lint failure — the inverse of the old rule). The rolling-window regex `/\bvs\.?\s+last\s+(refresh|period|week|month)\b/i` (line 94) stays banned in both zones. `hasTemporalLanguage()` becomes zone-aware: `hasTemporalLanguage(text, zone: 'plan' | 'verdict')`.
- **`NarratedStatusHeadline.tsx`:** `evergreenVerdict()` (lines 34–41) is superseded by a baseline-anchored `baselineVerdict()`; the band-only form survives only as the degradation fallback when no baseline data has accrued.
- **`ROIDashboard.tsx`:** the `showMoM` suppression (line 189) narrows — it suppresses the rolling 30-day MoM stat but the band gains a baseline "vs. when we started" stat. Keep the `evergreen` prop name for caller compatibility; update its JSDoc (lines 18–21) from "dateless" to "no-rolling-window." Every legacy caller (`evergreen=false`) stays byte-identical.

**Reversal 2 — Content-plan demotion (D3):** promote the verdict + outcome count + money frame to the top; remove the `<details>` wrapper at `TheIssueClientPage.tsx` lines 205–223 (proof renders open, the "See full report →" link survives only as the slot-6 affordance); demote `IssueContentPlanSection` to slot 5 (positional only — nothing inside is cut) and strip its HERO styling (the ⭐/HERO cue in the section comment lines 11–12). New canonical order: Your turn → **Verdict + outcome count** → **Money frame** → What needs me → **Content plan + work-log** → Under the hood.

**Reversal 3 — Visibility-ring removal (D3):** remove the `MetricRing` from the headline (it renders today at `NarratedStatusHeadline.tsx` line 57, driven by `orient.visibilityScore` line 47). `orient.visibilityScore` may still surface inside the collapsed slot 6 as one secondary signal — never the headline, never with a dollar claim. The headline number becomes the outcome/dollar verdict. **`MetricRing` is NOT deleted as a primitive** — remove only the headline call site; other consumers (admin, under-the-hood) keep it.

### Part C — Discipline guards (so a worker can't over-correct)
1. **The evergreen contract test gains the inverse assertion:** Zone-2 strings match no banned pattern AND Zone-1 strings match at least one baseline anchor (a dateless verdict now *fails* CI).
2. **Reuse-vs-net-new is explicit** (see §summary table) — most of this is reorder + edit.
3. **No anti-feature is sacrificed to make room.** If a worker finds themselves deleting a KEEP item (Part A) to fit a reversal, the plan has been misread.

---

## Phased Roadmap + Acceptance + Flags

One PR per phase; phase N+1 does not begin until phase N is merged and green on `staging`. Maps 1:1 onto discovery §6 P0/P1/P2.

### P0 — The trust spine (the non-negotiables we don't yet satisfy)
**Ships:** the dollarized verdict + outcome count baseline-anchored (slots 1+2); the per-workspace `outcomeValue` input + admin UI; GA4 conversion persistence (`ga4_conversion_snapshots` + daily cron, `createdAt`-anchored baseline); spine inversion + ring demotion; the two-zone evergreen relaxation; the reconciliation guard (provenance badge + honest degradation when GA4 unconnected). Dollar verdict is `estimate_ga4`, clearly labeled.

**Acceptance (P0):**
- [ ] With the flag ON + GA4 connected + `outcomeValue` set, the surface LEADS with a dollar verdict and outcome count, both baseline-anchored.
- [ ] The 0–100 `MetricRing` no longer appears in any client headline (`grep src/components/client/` confirms).
- [ ] Content plan renders below the proof band (no `<details>`); section order matches the spine.
- [ ] Every dollar figure is estimate-labeled; the disclosure states the lead-value multiplier + the client-supplied value + that records are not yet reconciled; no two-decimal precision on estimates (`fmtEstimate()`).
- [ ] GA4-not-connected and `outcomeValue`-not-set states degrade honestly (no fabricated number); no all-green when the count is flat.
- [ ] `outcomeVerdict` flows through `GET /api/public/roi` and the public-portal serializer (integration test exercises the **public** read path).
- [ ] Evergreen contract test asserts both zones (baseline allowed on verdict/proof, banned on plan; rolling windows banned everywhere).
- [ ] **Flag-OFF byte-identical:** `the-issue-client-spine` OFF renders today's `TheIssueClientPage` exactly (ring headline, plan-as-hero, collapsed proof). Verified by DOM-probe diff.

### P1 — Reconciliation, return hook, highest-value expansion (sub-phased)
**Ships:** named-record reconciliation (`conversion_records` + call-tracking + form-capture + CRM/HubSpot + daily matching job; count becomes clickable, junk quality-scored out); closed-loop attribution (`valueBasis='reconciled_revenue'`, "expand attribution" CTA); event-driven SMS/email push (reusing `broadcastToWorkspace()`/`useWorkspaceEvents` as the trigger, never "report ready"); forwardable zero-edit one-pager export; local map-pack + reviews insert; the `ClientSegment` field + `resolveSegmentProfile()` + segment-conditional competitor/authority insert + segment swap-matrix wiring; "next bets" $-forecast reframe.

**Acceptance (P1):**
- [ ] Outcome count is clickable to a named-record list; junk is quality-scored out.
- [ ] Money frame shows reconciled influenced revenue when CRM is connected, with the "expand attribution" CTA when it isn't; numbers reconcile or explain the discrepancy.
- [ ] At least one push channel fires on a money/customer/blocked-decision event and deep-links; no "report is ready" nag exists.
- [ ] Zero-edit one-pager downloads from the verdict, segment-formatted.
- [ ] Competitor/authority block shown by segment (B2B/services), hidden for local SMB; local insert appears only for local SMB.
- [ ] `ResolvedSegmentProfile` is set/derived per workspace and drives every conditional insert.
- [ ] **Flag-OFF byte-identical:** each P1 sub-feature behind its own child flag; all OFF = identical to P0-ON.

**Sub-phasing:** ship as independently-flagged sub-PRs under the P1 umbrella — reconciliation → attribution → push → export → local-insert → segment-conditional-competitor → next-bets — each merged and green before the next (mirroring `strategy-keywords-managed-set`/`strategy-competitor-send` declared-then-activated).

### P2 — Segment depth + premium frontiers
**Ships:** multi-location roll-up + ranked triage (spine inverts; 22-row table is a drill-down); professional-services authority topic-vs-firm slot + partner-byline approve-before-publish gate + brand-mention monitoring; AI-answer visibility; VC compounding-asset view + locked/visible attribution methodology.

**Acceptance (P2):**
- [ ] Multi-location opens on roll-up + ranked triage, never a 22-row table.
- [ ] Professional-services shows topic-vs-firm authority + a partner-byline approve-before-publish gate before any partner-named content ships.
- [ ] AI-answer visibility renders for requesting segments; VC compounding-asset view shows prior-quarter assets still earning, methodology visible/locked.
- [ ] Anti-feature discipline survives (grep guard + DOM probe: no keyword tables / DA-DR / vanity ring up top).
- [ ] **Flag-OFF byte-identical:** each insert behind its own child flag; all OFF = identical to P1.

### Feature-flag / dark-launch strategy
The client re-spec is a distinct concern from the existing admin `strategy-the-issue` master flag (which composes as `theIssueEnabled = commandCenterEnabled && strategy-the-issue`, `shared/types/feature-flags.ts:77-79`), so it gets its own flag family, declared in `FEATURE_FLAGS` and registered in `FEATURE_FLAG_CATALOG` with `lifecycle` + `rolloutTarget`:
- **`the-issue-client-spine`** (P0 master) — verdict + count + baseline + spine-inversion + ring-demotion + reconciliation-guard. `rolloutTarget: 'pilot-clients'`. OFF = today's `TheIssueClientPage` byte-identical.
- **`the-issue-client-reconciliation`** (P1) — named-record reconciliation + closed-loop attribution. `rolloutTarget: 'pilot-clients'`.
- **`the-issue-client-return-hook`** (P1) — SMS/email push + one-pager export. `rolloutTarget: 'staging-validation'` initially (delivery cost watched on staging first, mirroring `signal-auto-recompute`).
- **`the-issue-client-segment-inserts`** (P1) — segment-conditional competitor/authority + local map-pack/reviews + the `ClientSegment` field.
- **`the-issue-client-next-bets`** (P1) — $-forecast next-bets reframe.
- **`the-issue-client-multi-location`**, **`the-issue-client-authority`**, **`the-issue-client-ai-visibility`**, **`the-issue-client-compounding-asset`** (P2 child flags) — declared in the P1→P2 pre-commit, activated per P2 sub-phase.

**Flag contract (every phase):** OFF = byte-identical (new optional fields — `outcomeValue?`, `ROIData.outcomeVerdict?`, `segment_config` — are additive and unread when OFF); feature-toggle scope minimality (the flag is passed down and gates the verdict/ordering/insert at the narrowest point — `TheIssueClientPage` is *not* wrapped wholesale); phase-per-PR; catalog consistency (`npm run verify:feature-flags` passes).

### Verification approach (per phase)
Standard gates (`npm run typecheck`, `npx vite build`, `npx vitest run`, `npx tsx scripts/pr-check.ts`, `npm run verify:feature-flags`, `npm run verify:coverage-ratchet`) plus, per phase:
- **Flag-OFF byte-identical proof (all phases):** a real-browser DOM probe comparing flag-OFF render to current `TheIssueClientPage` — mandatory, because layout reorders are exactly the class where the four code gates pass while the visible surface regresses.
- **Public read-path integration test (P0/P1):** exercises `GET /api/public/roi` + the public-portal serializer, not the admin GET.
- **Evergreen-copy contract test (P0):** the two-zone assertion.
- **Anti-feature grep guards (all phases):** `grep -r "purple-" src/components/client/`; plus a guard that no keyword table / DA-DR / vanity ring reappears in the headline.
- **External-API error tests (P1):** mock CRM/call-tracking/SMS to error; assert honest degradation (records `failed`, shows the "connect / estimate" state) rather than a fabricated number (FM-2 pattern).
- **Scaled review at parallel checkpoints (P1):** invoke `scaled-code-review` at each P1 sub-phase checkpoint + a holistic end-to-end review before merge — the per-lane-green-but-feature-dead failure mode is the specific risk for this multi-lane money-and-attribution work.

---

## Reuse vs. Net-New (summary)

| Concern | Reuse (exists today) | Net-new (this spec) |
|---|---|---|
| **Spine container** | `TheIssueClientPage.tsx` — re-sequence sections, do not rewrite | — |
| **Verdict headline** | byline + why-bars from `NarratedStatusHeadline` | `IssueVerdictHeadline` (replaces headline; drops ring + band sentence); `IssueVerdict` type |
| **Outcome count** | `StatCard`, `CompactStatBar`, `EmptyState` | `OutcomeCountBand`; `IssueOutcomeCount` type |
| **Money frame** | `ROIDashboard` + `ROIMethodologyDisclosure`; `computeROI()`; `useClientROI` | un-collapse + `compact` prop; `outcomeValue` on `Workspace`; `outcomeVerdict` on `ROIData`; admin input in `ClientDashboardTab.tsx`; `fmtEstimate()` |
| **Outcome source** | `getGA4Conversions()`; `GA4ConversionSummary` | `Ga4ConversionSnapshot` table + daily cron (modeled on `roi_snapshots`) |
| **Baseline** | `workspace.createdAt`; `computeGrowthPercent()` window discipline | `OutcomeBaseline` (workspace-anchored, distinct from per-action `BaselineSnapshot`) |
| **Honesty / provenance** | `ROIMethodologyDisclosure`; estimate-labeling discipline | `OutcomeProvenance` enum (single source); `ReconciliationBadge`/`ReconciliationNote` |
| **Evergreen contract** | `evergreenCopy.ts` titles/intros; `BANNED_TEMPORAL_PATTERNS` | two-zone split + `ALLOWED_BASELINE_PATTERNS`; zone-aware `hasTemporalLanguage()`; `baselineVerdict()` |
| **Work-log + content plan** | `WinsSurface`, `OutcomeSummary`, `IssueContentPlanSection`, `IssueContentCard`, `IssueAlsoOnPlanSection`, `IssueLoopFooter`, `ActionQueueStrip` | positional demotion only (+ services partner-byline gate reusing the decision loop, P2) |
| **Under-the-hood** | `CompactStatBar`, `ROIDashboard` page tables, `StrategyRequestedKeywordTrendSection`, `CompetitorGapsSection` | competitor block → segment-conditional gating |
| **Segment** | `computeEffectiveTier` (sibling pattern); `getClientLocations`; `intelligenceProfile`/`businessContext` (derivation inputs) | `ClientSegment`/`SegmentConfig`/`ResolvedSegmentProfile`; `segment_config` JSON column; `resolveSegmentProfile()`; AI derivation assist; local map-pack/reviews insert; multi-location triage |
| **Named records / closed-loop (P1)** | `tracked_actions`/`action_outcomes`; `ContentTopicRequest.recommendationId` lineage; `broadcastToWorkspace`/`useWorkspaceEvents` | `ConversionRecord` table; call-tracking / CRM / form-capture integrations; daily reconciliation cron; SMS/email layer; one-pager export; `MissedOpportunityCard`; `NextBetsCard` |
| **Removed from headline** | `MetricRing` (kept as primitive elsewhere) | — (call site removed only) |

---

## Flag-OFF byte-identical + phase-per-PR (preservation note)

Every phase ships behind its own flag, and **flag-OFF must render the current surface byte-for-byte** — the established convention (`keyword-universe-full`: "OFF = today's capped behavior, byte-identical"; `strategy-the-issue`: "OFF = the current command-center cockpit, byte-identical"). Concretely: every net-new field (`Workspace.outcomeValue?`, `ROIData.outcomeVerdict?`, `segment_config`, the snapshot/reconciliation tables) is **additive and optional**, unread on the flag-OFF path; the flag is passed *down into* `TheIssueClientPage` and gates the verdict/ordering/insert at the narrowest point (the container is never wrapped wholesale); the `ROIDashboard` `evergreen` prop name is preserved so all legacy callers stay identical. **One phase = one PR** (P1 sub-phases = one PR each); phase N+1 starts only after phase N is merged and green on `staging`; all PRs land on `staging` before `main`. Flag-OFF identity is proven each phase by a real-browser DOM-probe diff, not just the four code gates — because section reorders are precisely where typecheck/build/pr-check/CI all pass while the visible surface silently regresses.

---

## Open Questions for the Owner — ALL RESOLVED (2026-06-20)

> All five were resolved at review; see **Owner Resolutions (2026-06-20, post-review)** near the top for the governing answers. The original questions are retained below for provenance.


1. **Segment-detection mechanism — RESOLVED (owner, 2026-06-20).** Local & multi-location are **deterministic** from the Strategy local setup (`client_locations` count: exactly 1 → `local_smb`, ≥2 → `multi_location`). The non-local split (`b2b_saas` / `professional_services` / `board_vc`) is **derived from the Brand & AI business profile** (`industry` + audience), operator-confirmed. *Residual sub-question:* for the non-local 3-way, keep the AI-assisted proposal (operator-confirmed) as specced, or start with a pure-manual admin dropdown to eliminate any first-screen misclassification risk? (`board_vc` is an audience choice via `reportingAudience`, admin-set regardless.)
2. **`outcomeValue` capture ownership.** P0 needs a per-workspace lead/customer value. Is this **agency-set** (we estimate it with the client and stamp `basis: 'agency_estimate'`), **client-supplied during onboarding** (`basis: 'client_provided'`), or both with the client able to correct it in-portal? The data shape supports all three; the *capture UX* differs (admin-only field vs. a client-facing input).
3. **GA4 key-event selection per workspace.** GA4 "key events" are a property-wide GA4 config, not per-workspace-selectable in our system today (grounding gap). When a workspace's GA4 property has multiple key events, do we (a) sum all key events as "outcomes," or (b) need an admin step to pick *which* key events count as the client's business outcome? Option (b) is more honest per segment but adds a config surface in `ClientDashboardTab`.
4. **Snapshot cron retention + cadence.** The `ga4_conversion_snapshots` table mirrors `roi_snapshots` (daily, pruned to a rolling window). **Confirm** the baseline window length before the verdict flips from `state:'establishing'` to `'ready'` (spec assumes ~30 days of snapshots) and the retention horizon (ROI uses 90 days — does the client baseline need longer, e.g. the full engagement, to honestly show "vs. when we started" a year in?).
5. **P1 integration vendor priority.** P1 spans three independent integrations (call tracking, CRM/HubSpot, form capture). Which is the first sub-PR? The drafts imply **call tracking first** (strongest local-SMB upsell, highest dollarized "missed leads" impact), but if your pilot cohort skews B2B/SaaS, **CRM-first** may unlock the reconciled money frame sooner. This ordering decision drives the P1 sub-phase sequence.
6. **Pre-baseline workspaces (existing clients).** For workspaces created before snapshots existed, there is no historical GA4 snapshot at `createdAt` to anchor the baseline. **Confirm** the fallback: (a) back-fill via GA4's historical API at the `createdAt` date if available, or (b) treat the first post-launch snapshot as a labeled "baseline established [date]" anchor and be explicit that "since we started" means "since measurement started" for legacy accounts.
