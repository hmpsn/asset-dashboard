# Client Insights Briefing Refactor — Design Spec
**Date:** 2026-04-28
**Status:** Draft (awaiting user review)

---

## Problem Statement

A client looked at our client dashboard and asked: "Is this dashboard for you, or for me?" His follow-up: most SaaS products don't give him information he can reliably act on. The current `/client/:id` Insights tab confirms his read — it stacks ~9 sections (welcome header, composite health score, 5-card stat row, action banner, CTA banner, monthly digest, intelligence summary card, predictions card, then a 3/5 + 2/5 grid of insight feed and AI sidebar) before the client reaches a single specific recommendation. It reads like a data dashboard, not a briefing.

Compounding the problem:
- Most clients spend ≤5 minutes per visit (or never visit at all).
- The 10-tab navigation (Insights, Performance, Site Health, SEO Strategy, Content Plan, Inbox, Schema, Plans, ROI, Brand) telegraphs "lots of homework."
- Recent slimming work (`AI Hero Insight`, `MonthlySummary`, `AnomalyAlerts` removed from Overview per FEATURE_AUDIT.md:1307) shows the team has been moving in this direction; this spec is the next radical step.

The asset is undersized: we already have a substantial AI-insights stack (`server/recommendations.ts` auto-regenerated after audits, `server/analytics-insights-store.ts` + the `insight-narrative.ts`/`insight-enrichment.ts`/`insight-score-adjustments.ts` pipeline, Monday-only competitor monitoring in `server/intelligence-crons.ts`). The signals are there. The presentation isn't.

---

## Solution Overview

Reframe the client home from "data surface" to **weekly briefing for a busy person.** The new Insights page has two parts:
1. **Action queue** — a tight strip surfacing items that need the client's attention right now (approvals, brief reviews, post reviews, team replies, content-plan reviews).
2. **Editorial briefing** — 3–5 hand-curated story cards in an A3 "magazine" rhythm (one hero with rich treatment, secondary stories as divider rows). Stories cover Wins, Risks, Opportunities, Competitive Intel, and Period Changes. Each carries inline supporting metrics where they reinforce the narrative; no graphs, no tables.

The briefing is **AI-curated weekly**: a scheduled Monday job reads candidates from existing analytics_insights + recommendations stores, asks `callAI()` to pick 3–5 + write editorial prose, and queues the result for admin review (reusing the `approval_batches` pattern). The briefing is gated to **Premium and Growth tiers**; Free tier sees the action queue plus an upgrade CTA.

The 10-tab navigation collapses to **Insights + Inbox + Plans + Explore drawer**. The seven previously-top-level data tabs (Performance, Site Health, SEO Strategy, Content Plan, Schema, ROI, Brand) move into the Explore drawer and stay as they are — interior pages remain data-rich; only the home page changes. Stories deep-link directly into the drawer pages with appropriate filters (the deep-linking infrastructure already exists).

---

## Section 1 — The new Insights page

### Layout (top to bottom, A3 "magazine" rhythm)

```
Welcome back, Mike · Week of April 28
─────────────────────────────────────
[3 items need you · 2 SEO changes · 1 brief]   ← amber action strip → Inbox

THE HEADLINE                                    ← teal accent, large card
Your commercial vehicle bet is starting to pay back
Three new posts drove +12% in traffic this week. Two are already
ranking on page 1 of Google.
   +12% traffic   ·   2 on page 1                 ← inline metric badges
                                              → See the data

ALSO THIS WEEK                                  ← thin label, divider rows
⚠  /services/fleet and /contact slipped off page 1                  →
★  Three service pages now show stars in Google                     →
↗  Four new backlinks from industry sites                           →
💡 Content gap: "best fleet maintenance schedule" — 8.6K vol         →
🔍 Competitor X published on your "EV charger install" topic         →
```

Three rules govern the page:
- **No top-of-page health score, no stat row, no banner CTAs** — those are gone. Numbers appear only as inline badges inside story cards when supporting a narrative.
- **One hero story** with rich treatment + 1–2 inline metric badges as visual texture (the only "data" on the page).
- **Secondary stories are divider rows** — no card chrome, scannable in <30s, each with a category icon and a deep-link to the relevant Explore page.

### Action queue contents

Same items the current "Action needed" banner surfaces, in the same priority order:
1. Pending SEO change approvals (count)
2. Content briefs ready for review
3. Posts ready for review
4. Unread team-note replies
5. Content plan pages awaiting review

Each chip in the strip deep-links to the relevant Inbox tab section.

### Tier gating

| Tier | Insights page contents |
|---|---|
| Premium / Growth | Full briefing (action queue + 3–5 editorial stories) |
| Free | Action queue + upgrade CTA + `MonthlyDigest` fallback |

Use the canonical `<TierGate required="growth">` (`src/components/ui/TierGate.tsx`). The numeric `TIER_LEVEL` mapping (`free=0`, `growth=1`, `premium=2`) makes `required="growth"` correctly gate to "Growth and above," which captures both paid tiers — there is no separate "Premium and Growth" gate to invent.

`MonthlyDigest` (existing component, on-demand AI 2–3 sentence prose) renders below the upgrade CTA for Free workspaces — a tease of the editorial voice, served as-is. Premium/Growth never render `MonthlyDigest`.

---

## Section 2 — Story candidate pool

The pool draws from existing stores. The new briefing is a **consumer**, not a generator of raw signals.

| Briefing category | Reads from |
|---|---|
| ▲ Win | `analytics_insights` (win/proof category) + `weCalledIt` predictions from `assembleLearnings` (existing shape: `{ prediction: string; score: number; pageUrl?: string }` — `server/workspace-intelligence.ts:521-525`) |
| ⚠ Risk | `recommendations` (high severity, active status) + `analytics_insights` (risk category) |
| 💡 Opportunity | `recommendations` (active status) + `analytics_insights` (opportunity category) — content gaps, brief recommendations |
| 🔍 Competitive | `analytics_insights` (competitive category) — already populated by the existing Monday-only competitor cron |
| 📅 Period change | `analytics_insights` (period_change category) + audit deltas (W/W audit score, traffic, ranking movement) |

**Materiality scoring:** Each candidate gets a score = `impact × recency × actionability`. Impact comes from the existing insight scores (already computed). Recency is exponential decay over days. Actionability is a static category-level multiplier (Risks > Opportunities > Wins > Period Changes > Competitive — actionable risks beat heads-up wins).

**Always show ≥1 story.** On quiet weeks, lower the materiality threshold rather than show "no insights." The AI prompt explicitly handles this case ("if nothing material happened, write a short check-in story about what's currently working").

---

## Section 3 — Generation pipeline

### Schedule

**Explicit weekly cron**: `0 14 * * 1` (Monday 14:00 UTC, configurable per workspace timezone in a follow-up if needed). Explicit cron over relative `setInterval` because no existing job runs on a fixed clock — we want the briefing to be predictable so admin review windows are predictable.

### Pipeline stages

```
Mon 14:00 (per workspace, Premium + Growth only)
  ↓
1. Pre-flight freshness check
   - audit_schedules.lastRunAt fresh (within 8 days)?
   - competitor lastSnapshotAt fresh (within 8 days, if competitive monitoring enabled)?
   - intelligence cache fresh (within 24h)?
   If any stale → defer 24h. After 3 deferrals, generate anyway with a "pending data" admin note.
  ↓
2. Read top ~10 candidates from candidate-pool sources, ranked by materiality score
  ↓
3. callAI() — single call per workspace per week:
   - Picks 3–5 stories
   - Tags one as the headline
   - Writes headline + 2-sentence narrative + suggested inline metric for each
   - Uses buildSystemPrompt(workspaceId, briefingInstructions) — voice DNA + guardrails
     auto-injected (server/prompt-assembly.ts:60-122)
  ↓
4. Persist to briefing_drafts table (or approval_batches — see Section 4)
  ↓
5. Surface in admin review queue
  ↓
6. Admin reviews: approve / edit / swap stories / publish (or auto-publish after 24h
   if untouched, configurable per workspace via auto_publish_briefings flag)
  ↓
7. Published briefing replaces last week's on the client's Insights page
```

### Audit-completion bridge hook (event-driven happy path)

`server/scheduled-audits.ts:146,182,235` already fires bridges (`audit-auto-resolve`, `audit-page-health`, `audit-site-health`) on audit completion. Add a fourth: **`briefing-candidate-refresh`** that marks the workspace's briefing-candidate set fresh. Combined with the Monday-only competitor cron (which runs early Monday before our 14:00 job), this gives us event-driven freshness for both major data sources, with the pre-flight check as a belt-and-suspenders fallback.

### Monday ordering (informational, no enforcement primitive)

Existing schedulers run roughly in this Monday order:

```
Monday morning   — intelligence-crons competitor monitoring (24h cycle, fires once Monday)
Monday rolling   — scheduled-audits hourly poll; per-workspace audits run when 7-day cycle elapses
Monday 14:00 UTC — NEW briefing job (this feature)
Monday 6h ticks  — monthly-report poll (sends weekly email if frequency=weekly)
```

The briefing reads from candidates the earlier jobs produce. There's no shared-table contention (briefing only writes to `briefing_drafts`); collision risk is functional (stale data), and the pre-flight freshness check + bridge hook handle that.

### Notification

Phase 1 ships a `notifyClientBriefingReady(workspaceId, weekOf)` helper in `server/email.ts`, mirroring the existing `notifyClientBriefReady` / `notifyClientPostReady` pattern (`server/email.ts:159-199`). It fires when an admin publishes a briefing (or auto-publish runs). It is a no-op until Phase 4, when it becomes the canonical Monday email for `autoReportFrequency === 'weekly'` paid workspaces.

### WebSocket events

Two new events in `server/ws-events.ts` `WS_EVENTS` (workspace-scoped):

- `'briefing:generated'` — fired when the scheduled job writes a draft (admin-facing)
- `'briefing:published'` — fired when a draft is approved/auto-published (client-facing)

Frontend handlers via `useWorkspaceEvents(workspaceId, { 'briefing:generated': ..., 'briefing:published': ... })` invalidate the relevant React Query keys (`admin-briefings`, `client-briefing`).

---

## Section 4 — Data model

### `briefing_drafts` table (new)

Migration filename follows the canonical three-digit-prefix + slug pattern (`server/db/migrations/NNN-briefing-drafts.sql`), where `NNN` is the next sequential number after the latest existing migration.

```sql
CREATE TABLE briefing_drafts (
  id              TEXT PRIMARY KEY,        -- uuid
  workspace_id    TEXT NOT NULL,
  week_of         TEXT NOT NULL,           -- YYYY-MM-DD (Monday of week)
  status          TEXT NOT NULL,           -- 'draft' | 'approved' | 'published' | 'skipped'
  stories         TEXT NOT NULL,           -- JSON array: BriefingStory[]
  created_at      INTEGER NOT NULL,
  updated_at      INTEGER NOT NULL,
  published_at    INTEGER,
  auto_published  INTEGER NOT NULL DEFAULT 0,
  admin_note      TEXT,                    -- optional note from admin reviewer
  UNIQUE(workspace_id, week_of)
);
CREATE INDEX briefing_drafts_workspace_week ON briefing_drafts(workspace_id, week_of);
CREATE INDEX briefing_drafts_status ON briefing_drafts(status);
```

### `BriefingStory` type (in `shared/types/briefing.ts`)

```ts
export type BriefingCategory = 'win' | 'risk' | 'opportunity' | 'competitive' | 'period_change';

export interface BriefingMetric {
  /** e.g. "+12%", "2", "8.6K" — already-formatted for display */
  value: string;
  /** e.g. "traffic", "on page 1", "search volume" */
  label: string;
}

export interface BriefingStory {
  /** stable identifier within the briefing */
  id: string;
  category: BriefingCategory;
  /** true if this is the hero card (always exactly one per briefing) */
  isHeadline: boolean;
  headline: string;
  narrative: string;          // 1–3 sentences
  metrics: BriefingMetric[];  // 0–2 supporting metrics
  /** route + tab + filters to deep-link into the Explore drawer */
  drillIn: {
    page: string;             // e.g. 'performance' | 'health' | 'strategy'
    tab?: string;
    queryParams?: Record<string, string>;
  };
  /** for traceability — which source records produced this story */
  sourceRefs: Array<{
    type: 'analytics_insight' | 'recommendation' | 'audit_delta' | 'prediction';
    id: string;
  }>;
}

export interface BriefingDraft {
  id: string;
  workspaceId: string;
  weekOf: string;             // YYYY-MM-DD (Monday)
  status: 'draft' | 'approved' | 'published' | 'skipped';
  stories: BriefingStory[];
  createdAt: number;
  updatedAt: number;
  publishedAt: number | null;
  autoPublished: boolean;
  adminNote: string | null;
}

export interface BriefingSummary {
  weekOf: string;
  publishedAt: number | null;
  storyCount: number;
  hasHero: boolean;
}
```

### `approval_batches` reuse vs new table

Considered using `approval_batches` directly (each briefing = a batch, each story = an item). Decision: **separate `briefing_drafts` table.** Justification:
- `approval_batches` items have an `applied` status that means "written to Webflow" — that lifecycle doesn't map to briefing publication.
- Briefing stories have category-specific fields (metrics, drill-in, sourceRefs) that don't fit approval-batch item shape.
- The admin UX is similar but distinct: review-and-edit for editorial fidelity vs. review-and-apply for SEO field changes.

We **mirror the patterns** (status enum, item-level review, batch-level publish gate) without overloading the same table.

---

## Section 5 — Intelligence integration

Per CLAUDE.md rule ("any new table or store that captures workspace activity must be surfaced in `server/workspace-intelligence.ts`"), the briefing must be visible to AdminChat / ClientChat / the chat AI context.

### Slice update — `ClientSignalsSlice` (in `shared/types/intelligence.ts`)

Add one field:

```ts
export interface ClientSignalsSlice {
  // ... existing fields ...
  /** The most recent published briefing for the workspace (null if none) */
  latestBriefing: BriefingSummary | null;
}
```

`BriefingSummary` (defined in Section 4) is intentionally minimal — the chat AI doesn't need full story bodies, just "was a briefing published this week, with how many stories." If the chat needs full stories, it queries the dedicated endpoint.

### `assembleClientSignals` update (in `server/workspace-intelligence.ts`)

Extend the existing assembler (around line 1089 per the audit) to read the latest published briefing for the workspace and include the summary. If no briefing has ever been published, returns `null`. No schema-level scoping change — the slice's existing visibility rules (admin sees full, client sees scrubbed) apply automatically.

### Admin chat slice selection — no `ContextCategory` change required

`server/admin-chat-context.ts` uses a question-aware `ContextCategory` union (lines 49–65) to choose which slices to assemble for a given chat question. By placing `latestBriefing` on `ClientSignalsSlice` (rather than introducing a new slice), questions that already pull `clientSignals` (e.g., "what does the client see?", "what's the client's current health?") will surface the briefing summary without category expansion. Adding a dedicated `'briefing'` category is **deferred** — revisit only if real chat questions emerge that should pull briefing data without pulling clientSignals.

---

## Section 6 — Navigation

### Tab structure (replaces the current 10-tab nav)

```
[ Insights ]  [ Inbox ]  [ Plans ]      [ Explore ▾ ]
```

| Slot | Contents |
|---|---|
| Insights | The new home (this design) |
| Inbox | Approvals, brief reviews, post reviews, team replies, content-plan reviews. Unchanged from today; this is where action-queue chips deep-link. |
| Plans | Billing/tier. Unchanged. Hidden for `betaMode` and `isExternalBilling` (current behavior). |
| Explore ▾ | Drawer revealing: Performance, Site Health, SEO Strategy, Content Plan, Schema, ROI, Brand. **These pages stay as-is** — interior data depth is preserved; only the home page changes. |

Drawer behavior: hover or click reveals a panel listing all seven Explore destinations with their existing icons. Each link respects existing tier gates (e.g., Strategy still locked for `!isPaid`, ROI still requires `strategyData`). Clicking any item navigates to the existing route — no URL changes, no API changes, no interior page redesign.

### `ClientTab` type update (in `src/routes.ts`)

The type itself stays the same (all current values still valid for routing). Only the rendered nav array (`NAV` in `src/components/ClientDashboard.tsx:430-442`) changes — the seven now-drawer items are removed from top-level rendering and surfaced via the drawer instead.

---

## Section 7 — Existing components fate

| Component / module | Fate |
|---|---|
| `HealthScoreCard` (top of Insights) | Removed from Insights. Score still on Site Health page inside Explore. Health changes become candidate stories. |
| Stat cards row (Visitors / Clicks / Impressions / Position / Site Health) | Removed from Insights. Numbers appear only as inline metric badges inside story cards. |
| Action-needed banner | Replaced by the new amber action strip at top of Insights. |
| Primary CTA banner (Generate Brief / View Issues / Find Keywords) | Removed. Its three states become candidate stories instead. |
| `MonthlyDigest` | Repurposed as **Free-tier fallback content** (visible only to Free tier on Insights). Premium/Growth never see it. |
| `IntelligenceSummaryCard` | Removed from Insights. Its source data feeds candidate-pool inputs. |
| `PredictionShowcaseCard` ("we called it") | Removed from Insights. Its predictions become Win-category candidates. |
| `InsightsDigest` (component) | Removed from Insights. Its underlying `analytics_insights_store` is the candidate pool's primary source — store untouched. |
| Insights Engine sidebar (AI quick questions) | Moves to the existing floating chat widget (`ClientChatWidget`). Off the home page. |
| Content Opportunities sidebar | Removed. Folded into Opportunity-category candidates. |
| `InsightsEngine` (component, `src/components/client/InsightsEngine.tsx`) | No change — already retired from client Overview per the recent slimming pass; remains on admin home. |
| `FixRecommendations` (component) | No change — keeps role on Inbox/interior pages. A few of its rows surface as Risk / Opportunity stories on the briefing. |
| `recommendations.ts` (server engine) | Untouched. Briefing reads from it. |
| `analytics_insights_store.ts` | Untouched. Briefing reads from it. |
| `intelligence-crons.ts` | Untouched. Briefing job is a sibling, not a replacement. |
| `monthly-report.ts` | Untouched in Phase 1–3. In Phase 4, weekly-frequency reports become a "your briefing is ready" notification linking to the in-app briefing rather than independent metrics email. The email and the Insights page converge to the same source of truth every Monday. |
| `/api/public/insights/:workspaceId/narrative` (existing public endpoint that calls `generateMonthlyDigest`) | Untouched in Phase 1–3. In Phase 4, paid-tier workspaces' narrative endpoint switches to returning the latest published briefing (or its summary). Free-tier continues to receive `generateMonthlyDigest` output. |
| `AnomalyAlerts.tsx` (admin-side, lingering after slimming pass per FEATURE_AUDIT.md:1307) | Out of scope for this feature. Flagged for the verification list — not duplicating, just noting the file exists despite the feature being marked removed from the client Overview. |
| `intelligence-summary-card.test.ts` (and any other tests for components retired in this spec) | Plan-writing inventories and updates/removes per the rollout phase that retires the component. |

---

## Section 8 — Rollout

Feature flag: `client_insights_briefing_v2` in `shared/types/feature-flags.ts`. Each phase is a single PR per the CLAUDE.md "phase-per-PR" rule. Staging gets the flag flipped first; production stays off until ≥2 weekly briefings have been generated, reviewed, and visually verified on real workspaces.

### Phase 1 (PR 1) — Generation pipeline (dark-launched)

- `briefing_drafts` table + migration (next sequential `NNN-briefing-drafts.sql`)
- `BriefingStory` / `BriefingDraft` / `BriefingSummary` types in `shared/types/briefing.ts`
- Candidate-pool collectors (read-only — querying existing stores)
- `callAI()` integration with `buildSystemPrompt()` for voice
- Scheduled job (Monday 14:00 UTC cron) — start function in `server/briefing-crons.ts`, registered from `server/startup.ts`
- Pre-flight freshness check
- `briefing-candidate-refresh` bridge added to audit-completion path
- `notifyClientBriefingReady()` helper added to `server/email.ts` (no-op until Phase 4 wires it up)
- WebSocket events `'briefing:generated'` and `'briefing:published'` registered in `server/ws-events.ts`
- Admin review queue UI extension (mirrors `PendingApprovals` UX patterns: status badges, expand/collapse, retract action, `queryClient.invalidateQueries` on mutate)
- Feature flag `client_insights_briefing_v2` added to `shared/types/feature-flags.ts` (default `false`)
- No client-visible changes

### Phase 2 (PR 2) — Client Insights page rendering

- New client Insights page component (action strip + magazine briefing)
- Per-workspace flag gating — toggleable for individual workspaces (test on your own clients first)
- `ClientSignalsSlice.latestBriefing` field + `assembleClientSignals` extension
- Public client-portal endpoint to read published briefing (mirrors existing public-portal patterns)
- Free-tier upgrade CTA + `MonthlyDigest` repurposing as Free fallback

### Phase 3 (PR 3) — Navigation simplification

- `NAV` array in `src/components/ClientDashboard.tsx` collapsed to 4 slots
- New `Explore` drawer component
- All routes preserved — only the rendered nav changes
- Behind same feature flag — when off, current 10-tab nav still renders

### Phase 4 (post-soak, separate PR) — Email + briefing convergence

- Extend `monthly-report.ts`: when `autoReportFrequency === 'weekly'` AND a briefing was published this week AND the workspace is Premium/Growth, replace the metrics email body with the `notifyClientBriefingReady()` "your briefing is ready" email linking to the in-app briefing.
- `/api/public/insights/:workspaceId/narrative` returns the latest published briefing (or summary) for paid-tier workspaces; Free-tier continues to receive `generateMonthlyDigest`.
- Workspaces on `monthly` frequency or Free tier keep the existing email.
- Flip the feature flag default to `on`.
- Retire `OverviewTab` and the now-unused legacy components per the §7 table.
- Remove the feature flag in a follow-up cleanup PR (eligible for a `/schedule` cleanup agent ~2 weeks post-flag-flip).

---

## Section 9 — Out of scope

- **Interior Explore page redesign** — Performance, Site Health, etc. stay exactly as they are. The thesis is that interior pages are discretionary; their density is fine.
- **New raw signal sources** — competitor data, audit pipeline, content-gap detection are wired today; we just consume from them.
- **Mobile-specific work** — A3 stacks naturally on mobile; no separate mobile design.
- **Email design overhaul** — Phase 4 only changes the email's *body content* for weekly-frequency Premium/Growth workspaces; the email template/layout itself is not redesigned.
- **AdminChat / ClientChat awareness of briefing content** — the slice update makes the briefing *visible* to chat (so it can answer "was a briefing published?") but no chat prompt-engineering work to make it *cite* briefing stories. That's a follow-up.
- **Per-workspace timezone handling for the cron** — Phase 1 uses UTC. Per-workspace timezone is a follow-up.
- **Free-tier briefing generation** — Free workspaces don't get a generated briefing; they get the upgrade CTA + repurposed MonthlyDigest. Generating a degraded briefing for Free is explicitly out of scope.
- **`ContextCategory` expansion in `admin-chat-context.ts`** — deferred per §5. Briefing rides existing `clientSignals` slice selection.
- **Cleanup of `AnomalyAlerts.tsx`** — admin-side lingering import on `WorkspaceHome.tsx` is unrelated to this feature; tracked separately.

---

## Verification tasks for the implementation plan

Items I want the planning step to verify before committing to specific file changes:

1. **Existing admin review-queue UX** — `server/approvals.ts` types + `server/routes/approvals.ts` routes + `src/components/PendingApprovals.tsx` UI patterns (status badges, expand/collapse, retract/remind, `queryClient.invalidateQueries({ queryKey: queryKeys.admin.approvalBatches(wsId) })`). Briefing review should mirror these patterns precisely.
2. **`monthly-report.ts` weekly-mode behavior** — confirm exactly what it sends to clients today (HTML structure, sections, send time relative to the 6h poll). Phase 4 needs to know what's being replaced.
3. **`ClientChatWidget` integration point** for the relocated AI quick questions — where do those quick-question buttons live today, and what's the smallest change to surface them in the chat widget instead of the Insights sidebar?
4. **`scrubClientIntelligence` / public-portal serializer** — confirm the new `latestBriefing` field is automatically scrubbed correctly for client visibility (or needs explicit handling). Reference: `server/routes/client-intelligence.ts:40-120` allowlist pattern.
5. **Per-workspace timezone handling for the cron** — the codebase may already have a workspace-timezone utility. If so, plan should account for the eventual extension; if not, UTC-only is the explicit Phase 1 stance.
6. **Free-tier component visibility** — confirm `ws.tier === 'free'` is the correct gate (vs. `!isPaid`, vs. `betaMode` interaction). The current paid-tier helper in `ClientDashboard.tsx:425` is the source of truth.
7. **`auto_publish_briefings` flag location** — workspaces table column vs. workspace_settings table vs. column on `briefing_drafts`. Plan-writing decides per existing settings convention.
8. **`BriefingStory.drillIn.page` type** — should this be a constrained `ExplorePage` union or reuse `ClientTab`? Plan-writing finalizes.
9. **Cache coordination between MonthlyDigest and briefing** — both read `analytics_insights` and `weCalledIt` via `workspace-intelligence.ts`. The intelligence cache is workspace-level with 6h refresh; briefing runs Monday 14:00 UTC well after the morning refresh. Verify: is the cache stale on Monday afternoon, or is the morning intelligence refresh effectively pre-warming the candidate pool?
10. **`outcome-ai-injection` flag relationship** — `monthly-digest.ts` gates summary generation on this flag. Should the briefing job similarly respect this flag (skip generation when off) or is it independent? Plan-writing decides — likely briefing should respect since it consumes the same `weCalledIt` stream.
11. **`content-brief.ts` and `copy-generation.ts` voice paths** — audit confirmed both use intelligence slices but didn't confirm `buildSystemPrompt()` is the only path. Verify before relying on the "single Layer 2 voice authority" assumption for the briefing.
12. **`anomaly-detection.ts:506` voice injection** — anomaly's `aiSummary` calls `callOpenAI()`; verify it routes through `buildSystemPrompt()` or document the inconsistency.
13. **`ContextCategory` integration test** — write a test asserting the existing `clientSignals` category selection picks up `latestBriefing`. If not, the spec's "no category change required" assumption is wrong.

---

## Acceptance signals

The refactor is successful if:
- A returning client opens `/client/:id` and reads the entire page in <60 seconds.
- The page shows ≤7 distinct UI elements (action strip + hero + ≤5 secondary rows + week label) — measurably fewer than the current 9+ stacked sections.
- Each story has a clear category and a single deep-link to "where to see the data."
- Admin review of a weekly briefing takes ≤5 minutes per workspace at typical client volume.
- The same client revisiting after 6 days sees a *different* briefing (proves the content is fresh, not static).
- Zero tabs visible at top level beyond Insights / Inbox / Plans / Explore.
