# Client Information Architecture Redesign

**Status:** Approved (IA decisions); implementation specs to follow as Phase 1 / 2 / 3
**Date:** 2026-05-09
**Supersedes (in part):** `2026-05-08-client-inbox-redesign.md` — that spec is narrower and admin-shaped; this spec re-frames the client surface around client tasks, then re-wraps the earlier work as Phase 1 of a multi-phase rollout.
**Related:** `tracked_actions` outcome system (migration 041), `ApprovalsTab`, `ClientActionDetailModal`, `InsightsBriefingPage`, `requests` / `feedback` tables.

---

## 1. Context

### 1.1 What prompted this

A planned redesign of the client Inbox surfaced four payload-mismatch bugs and an HTML-entity rendering bug. Fixing those exposed a deeper question: what should the Inbox actually contain, and is its current shape the right one?

A four-agent audit then mapped the entire "send to client" landscape:

- **5 client_action source types** (aeo_change, internal_link, redirect_proposal, keyword_strategy, content_decay)
- **7 distinct approval_batch source paths** (SEO Editor per-page + bulk, CMS Editor, SchemaSuggester per-page + bulk, SchemaPlan, SeoAudit "Send for Review", SeoAudit "Flag for Client")
- **3 content workflow surfaces** (briefs, post drafts, copy review)
- **2 conversational tables** (`requests` + `feedback` — overlapping)
- **3 orphaned admin-created tables** (`client_signals`, `tracked_actions`, `action_playbooks`) that never reach the client

Recurring user feedback: "the platform is too complicated, too much information."

### 1.2 The diagnosis

**The current information architecture is admin-shaped, not client-shaped.**

The client Inbox has three sections — "Needs Action & Requests," "SEO Changes," "Content" — that mirror the internal admin tools that produced the work. From the team's perspective each section is meaningful. From the client's perspective the boundaries are arbitrary: a title-tag change can land in either "Needs Action" (via AEO recommendations → `aeo_change`) or "SEO Changes" (via SEO Editor → `approval_batches`), depending on which admin tool generated it. Same data, different sections, different approval flows.

This is Conway's law in the UI — the org chart of the codebase becoming the navigation of the client app. It's the concrete form of the "too complicated" feedback.

### 1.3 The principle

**Section by what the client is doing, not by what tool produced the work.** The internal source (AEO vs SEO Editor vs Audit vs Schema) becomes a small badge on each item. It is no longer a navigation primitive.

---

## 2. Decision: Three-Section Client-Shaped Inbox

The Inbox restructures from three admin-shaped sections to **three client-shaped sections**, each aligned with a distinct cognitive mode:

| Section | What the client is doing | Time per item |
|---------|-------------------------|---------------|
| **Decisions** | Quick approvals — scan, decide, move on | < 1 minute |
| **Reviews** | Long-form work — read deeply, possibly edit | 5+ minutes |
| **Conversations** | Threaded dialogue with the team | Variable |

A fourth client-facing surface, **Wins**, lives on the Insights page (not in the Inbox) — it is read-only narrative, not action-required.

### 2.1 What does NOT live in the Inbox

The Inbox is for things that require the client. The following move out:

- **Wins** (`tracked_actions` + `action_outcomes`) → Insights page
- **In-progress content** (status updates with no required action) → small "Coming soon" footer inside Reviews section, not its own surface
- **Monthly digest** (already on Insights) → unchanged
- **PriorityStrip on InboxTab** → removed; urgency is now carried by chip counts and inline amber borders within the new sections

### 2.2 What stays on the Insights page

- WeeklyOpener, DateLine, IssueSummaryLine
- **ActionQueueStrip — RETAINED** (compass for clients reading the briefing; provides quick reminder of pending Inbox work)
- PulseStrip (live vital signs)
- MonthlyDigestContent
- DataSpread (editorial wins/risks from briefing stories)
- **Wins surface — NEW** (data-driven ledger from `tracked_actions`)
- RecommendedForYou
- SecondaryStoryRow

**"We called it" tab — REMOVED** (deprecated for now; can be reinstated later if a use case emerges).

---

## 3. Section Inventory and Routing Rules

### 3.1 Decisions

Quick approvals where the client's job is to confirm a batch with optional exceptions. Uses the **trust-first primitive** (§4.1).

**Routes here:**

| Source | Currently lives in | Notes |
|--------|-------------------|-------|
| AEO recommendations (`aeo_change` client_actions) | Section 1 | Existing; payload needs enrichment (`rationale`, `effort`, `priority` fields per §3.5) |
| Internal link suggestions (`internal_link`) | Section 1 | Existing |
| Redirect proposals (`redirect_proposal`) | Section 1 | Existing |
| Content decay alerts (`content_decay`) | Section 1 | Existing; remains inline-style card within Decisions |
| SEO Editor batches (titles/metas, per-page or bulk) | Section 2 (via `approval_batches`) | Re-routed; same primitive as other batches |
| SEO Audit "Send to client" with **no** note | Section 2 (via `approval_batches`) | Collapsed to one button (§3.5) |
| Schema Suggester per-page → batch | Section 2 (via `approval_batches`) | Re-routed |
| Schema Suggester bulk → batch | Section 2 (via `approval_batches`) | Re-routed; renders as one card with grouping (§4.1.2) |
| CMS Editor batches (field-level) | Section 2 (via `approval_batches`) | Re-routed |
| Content plan cells — when admin "approves a topic for the calendar" only | Section 1 | Per-cell approval; if cell contains a brief or outline that needs reading → Reviews instead |

**Does NOT route here:**

- `keyword_strategy` client_actions — **deprecated as a client_action type**; lives on the SEO Strategy page with its own workflow (§3.5)

### 3.2 Reviews

Long-form work where the client's job is to read deeply and possibly edit. Uses the **review primitive** (§4.2).

**Routes here:**

| Source | Currently lives in | Notes |
|--------|-------------------|-------|
| Content briefs (`content_topic_requests` at `client_review` status) | Section 3 | Existing; full-screen review |
| Content posts (at `post_review` status) | Section 3 | Existing; PostReviewCard inline editing |
| Copy review (sections at `client_review` status) | Section 3 | Existing; ClientCopyReview section-by-section |
| Schema Plan strategic doc (`SchemaPlanPanel` output) | Section 2 | Re-routed; SchemaReviewTab as the renderer body |
| Content plan cells — when cell contains a brief/outline that needs reading | Section 1 (currently flagged inline) | Re-routed; the per-cell flag affordance moves into the full-screen review |

### 3.3 Conversations

Threaded dialogue where the client's job is to read replies and respond. Uses the **conversation primitive** (§4.3).

**Routes here:**

| Source | Currently lives in | Notes |
|--------|-------------------|-------|
| Client-submitted requests (`requests` table) with team replies | Section 1 (RequestsTab subsection) | Re-framed as Conversations, not "Requests" |
| SEO Audit "Send to client" **with** an attached note | Section 2 (via `approval_batches`) | Re-routed; presence of note triggers Conversation routing (§3.5) |
| Any other "Send to client" admin action with an attached note | Various | Same routing rule — note presence converts a Decision into a Conversation |

**Does NOT route here:**

- `feedback` table → **fully deprecated** (§3.5)

### 3.4 Wins (on Insights page, not Inbox)

Read-only ledger of completed actions with measured outcomes. Uses the **wins primitive** (§4.4).

**Source:** `tracked_actions` joined with `action_outcomes`, filtered to `score = 'strong_win'` or `'win'`, last 30 days, capped at 10 most recent.

### 3.5 Cross-cutting routing rules

These rules govern how items get categorized at send-time and apply across all sections.

**Rule 1 — Note presence routes to Conversations.** Any admin "Send to client" action with an attached note routes to **Conversations** (the team's note becomes the first message). Without a note, it routes to **Decisions** (or **Reviews** if long-form). This is a single mechanism that replaces the current SEO Audit double-button ("Send for Review" + "Flag for Client") and applies platform-wide.

**Rule 2 — Length and inspection cost routes Decisions vs Reviews.** If the client's job is to scan a list and confirm, it's a Decision. If the client's job is to read prose / inspect strategy / edit content, it's a Review. The Schema Plan moves from Decisions to Reviews under this rule.

For content plan items, the discriminator is the entity type, not a field on a single type:
- **`ContentPlanReviewCell` rows → Decisions** (cells are always topic-level placeholders in a calendar; never contain long-form content directly)
- **`ClientContentRequest` at `client_review` status → Reviews** (the brief generated *from* a previously-approved topic — this is where long-form review happens)

**Rule 3 — `keyword_strategy` is removed as a client_action.** Keyword strategy already has a dedicated SEO Strategy page with its own approval/feedback workflow. Surfacing it as an Inbox client_action duplicated the mental model. The `keyword_strategy` source type is deprecated; existing rows transition to `archived` status during Phase 1 migration.

**Rule 4 — `feedback` table is fully deprecated.** Both client-facing and admin paths retire. Existing rows migrate to `requests` with `category: 'general'`. The FeedbackWidget component and `/api/public/feedback/*` and `/api/feedback/*` routes are removed. Aligns with the user's "one client-facing channel" intent.

**Rule 5 — AeoChangeDiff payload enriched.** The current `AeoChangeDiff` type has only `page`, `section?`, `current`, `proposed`. The trust-first Decisions experience requires three additional optional fields:
- `rationale?: string` — "Why this change" (one sentence)
- `effort?: 'low' | 'medium' | 'high'` — internal effort estimate (rendered as small badge or hidden in Phase 1; see §6)
- `priority?: 'high' | 'medium' | 'low'` — urgency hint

These are populated from `AeoPageChange` at send-time in `AeoReview.tsx`.

**Rule 6 — Status simplification for client view.** The 6 admin states for `requests` collapse to 4 client-visible states (the synthesized "Team replied" state is computed from latest note author):

| Admin state | Client sees |
|-------------|-------------|
| `new`, `in_review` | Awaiting team |
| `in_progress`, `on_hold` | In progress (`on_hold` shows a sub-note "on hold — waiting on X") |
| `completed`, `closed` | Resolved |
| Any state with latest note author = `'team'` and unread | **Team replied** (urgency trigger, amber border) |

---

## 4. Interaction Primitives

Each section has one primitive that the implementing components plug into.

### 4.1 Decisions primitive — trust-first batch approval

The Decisions surface optimizes for the 80% client who trusts the team's recommendations and just wants to approve. Per-item friction is minimized; flagging an exception is a single-tap inline action that adds a one-sentence note.

**Two presentation modes within Decisions:**

- **Bulk** (AEO, internal links, redirects, SEO Editor batches, schema batches, CMS Editor batches, SEO Audit) — Inbox card is an entry point; clicking opens the full-screen trust-first modal with the components below.
- **Single-action** (`content_decay`) — Inbox card renders the action inline with a compact approve / flag-with-note affordance. No full-screen modal. The one item is the entire decision; a modal would be theatre.

The components in §4.1.1 describe the **bulk** mode. Single-action items use the same flag-with-note pattern but skip the list/header/footer shell.

#### 4.1.1 Standard scale (5–15 items, bulk mode, full-screen modal)

**Modal shell (consistent with Reviews modal shell, §4.2):** header with title + source badge + breadcrumb back to Inbox, escape key closes, scrollable body, fixed footer.

**Body components (top to bottom):**

1. **Summary header** — plain-language title and a one-sentence summary written for the client (no admin jargon: no "AEO," no "approval batch"; effort/priority badges hidden by default per §5.3).
2. **Item list** — collapsed cards, one per change. Each row shows: change label (e.g. "Meta description"), inline **Flag** button, and an expand affordance to see the current → proposed diff with the rationale.
3. **Flag interaction** — clicking Flag reveals an inline note field ("What's your concern? — optional"). Flagged items get an amber border and a "Flagged" pill. Unflag = "Clear flag" button.
4. **Footer primary CTA** — large, full-width button: **"Looks good — implement N of M →"** (where N updates as items are flagged). This is the only primary action; no competing buttons.
5. **Footer escape hatch** — small text link below the CTA: "Save for later" (closes without action).

**Submission semantics:**
- Approve sends the entire batch to `status = 'approved'`. Flagged items are NOT excluded from implementation in Phase 1 — instead, the client's flag notes are serialized into the `clientNote` field and surfaced to the team for manual handling. This avoids backend API changes while still capturing the client's concern.
- Phase 3 may revisit this to support per-item exclusion if the manual handling proves to be a bottleneck.

#### 4.1.2 At-scale (50+ items, e.g. 200 schema markups)

The primitive scales with the same shell + CTA, but adds:

- **Type breakdown** in the header — pill row summarizing the batch contents ("180 LocalBusiness · 12 Service · 8 FAQ")
- **Search bar** — find a specific page (only renders when batch size exceeds threshold, e.g. 25 items)
- **Grouped collapse** — items grouped by type (e.g. schema type, page section), each group collapsed by default, expandable
- **Virtualized rendering** — performance only; UX-invisible

The big primary CTA remains the same; the 80% client still clicks "Looks good — implement 200 of 200" without scrolling.

#### 4.1.3 Empty state

"All caught up — no decisions needed right now."

### 4.2 Reviews primitive — full-screen long-form

The Reviews surface gives the client room to read, inspect, and edit. The Inbox card is just an entry point; the actual work happens full-screen.

**Inbox card:** title, one-line summary, estimated reading time (e.g. "~6 min"), source badge, primary CTA "Read & review →".

**Full-screen shell (consistent across all Review types):**

- **Header** — title, source badge, breadcrumb back to Inbox, escape key closes
- **Body** — type-specific renderer (existing components plug in here):
  - Brief → BriefDetail rendering
  - Post draft → PostReviewCard (inline rich-text editing, auto-save)
  - Copy review → ClientCopyReview (section-by-section approval)
  - Schema Plan → SchemaReviewTab (already exists)
  - Content plan cell with brief/outline → cell-specific renderer
- **Footer** — primary CTA "Approve" / "Approved" status, plus "Request changes" with inline note field. Same flag-with-note pattern as Decisions, applied to sub-elements (e.g. flag a section of a brief).

**Coming-soon footer (Reviews section in Inbox):**
"3 items expected by Friday: …" — small, muted, just an awareness signal. Not actionable; uses `content_topic_requests` and `content_posts` rows in pre-review states.

### 4.3 Conversations primitive — threaded dialogue

Familiar chat-style interface (Intercom / Slack DMs). Single chronological list per workspace, sorted by recency.

**Inbox card per conversation:**
- Title + 80-char preview of latest message
- "Sarah replied 2h ago" — author + relative timestamp
- Status pill (per §3.5 Rule 6): **Team replied** (amber, urgency trigger) / **Awaiting team** (muted) / **In progress** (blue) / **Resolved** (faded)
- Small category badge (bug / content / design / SEO / feature / general)
- Click → opens full-screen thread

**Full-screen thread:**
- **Header** — title, category, status, breadcrumb back to Inbox; overflow menu with "Mark resolved", "Change category", "Change priority"
- **Message list** — chronological, alternating left (team) / right (client) bubbles with avatar, name, timestamp; inline attachments at message level
- **Reply composer** — text area + attach button + send button at bottom

**Submit-request modal (from Inbox header "+ Submit a request" button):**
- Title (required), description (required), category (optional dropdown), file attach (optional)
- No priority field exposed to client (defaults to medium server-side)
- Smart defaults — minimum friction; team can re-categorize later

**No sub-sectioning by category or status.** Single chronological list. Filter chips at the top can scope by status (e.g. "Open only") but the default view shows everything sorted by recency.

### 4.4 Wins primitive (on Insights page)

A structured ledger of completed actions with measured outcomes. Title: **"What we shipped"**.

**Card per win:**
- One-line action description, translated from `action_type` enum (e.g. `meta_updated` → "Updated meta description")
- Linked page affected (e.g. `/services/commercial-plumbing`)
- Outcome metric inline (e.g. `position 15 → 8 (+7)` or `clicks +24% vs baseline`) — sourced from `action_outcomes.delta_summary`
- Win quality badge: **Strong win** (emerald) / **Win** (teal) — sourced from `action_outcomes.score`
- Shipped date (relative — "3 days ago")

**List shape:**
- Chronological, last 30 days, capped at 10 most recent
- "See full history →" link if more exist (deferred to a future ROI dashboard or paginated view)

**Action_type → human label translation map (Phase 1):**

```
meta_updated         → "Updated meta description"
content_published    → "Published new post"
content_refreshed    → "Refreshed existing content"
schema_deployed      → "Added structured data"
internal_link_added  → "Added internal links"
audit_fix_applied    → "Fixed audit issue"
brief_created        → "Created content brief"
strategy_keyword_added → "Added keyword to strategy"
voice_calibrated     → "Calibrated brand voice"
insight_acted_on     → "Acted on a recommendation"
```

**Empty state:**
"We're working — wins appear here once your changes start showing measurable impact."

**Placement on Insights page:**
Insert between MonthlyDigestContent and DataSpread. The digest establishes the big-picture story; Wins shows the concrete actions; DataSpread continues the narrative.

**Tier gating:** Growth+ (matches the rest of the Insights premium territory). Free tier sees a teaser: "N wins shipped this month — upgrade to see what we built."

---

## 5. Cross-Cutting Platform Changes

These changes are pre-conditions for the section primitives to work cleanly. They are not optional refinements; the IA depends on them.

### 5.1 Retire the `feedback` table and FeedbackWidget

- Remove `FeedbackWidget` from any page that mounts it (confirmed mounted in `src/components/ClientDashboard.tsx:916`)
- Migrate existing `feedback` rows to `requests` with `category: 'general'` in the same migration that drops the table
- Remove `/api/public/feedback/*` and `/api/feedback/*` routes
- **Drop the `feedback` table immediately** in the same migration (no grace period — `feedback` is platform-internal app feedback, not client-facing in any flow we support going forward)

### 5.2 Collapse SEO Audit double-button to one "Send to client"

- Replace "Send for Review" and "Flag for Client" overflow option with a single "Send to client" button
- Optional inline note field with helper text: "Add a note (turns this into a conversation)"
- Send-time logic: if note is empty → `approval_batch` routed to client's Decisions; if note is present → `approval_batch` routed to client's Conversations (note becomes first message in the thread)
- Apply the same one-button + optional-note pattern to AeoReview, RedirectManager, SchemaPanel, etc. — platform-wide convention

### 5.3 Enrich `AeoChangeDiff` payload

- Add `rationale?: string`, `effort?: 'low' | 'medium' | 'high'`, `priority?: 'high' | 'medium' | 'low'` to the type
- Populate from `AeoPageChange` at send-time in `AeoReview.tsx`
- The Decisions renderer surfaces `rationale` inline on row expand; `effort` and `priority` are stored on the payload but **hidden in client view by default** (per §1.3 — client doesn't need our internal estimation vocabulary). They remain available for admin-side analytics and may be conditionally surfaced in the future if a client use case emerges.

### 5.4 Deprecate `keyword_strategy` as a client_action source type

- Stop creating new `keyword_strategy` client_actions from `KeywordStrategy.tsx`
- Existing pending rows transition to `archived` during Phase 1 migration
- Surface keyword strategy state via the SEO Strategy page's existing approval/feedback workflow (no Inbox involvement)

### 5.5 Schema entry point note (admin-side, Phase 3)

The three schema entry points (per-page, bulk, strategic plan) all produce client output that lands cleanly in the new IA. The admin-side fragmentation (per-page and bulk doing the same job at different volumes) is real but **out of scope** for this redesign. Logged for future consolidation.

### 5.6 Remove ActionQueueStrip from InboxTab

The action queue strip in the current InboxTab was compensating for the admin-shaped IA's fragmented urgency. The new Inbox carries urgency through chip counts and inline amber borders. Remove the in-Inbox priority strip. The Insights page ActionQueueStrip is **retained** (it serves a different purpose — compass for clients in the briefing context).

### 5.7 Hide "we called it" via feature flag

`PredictionShowcaseCard` is rendered on `OverviewTab.tsx:331` from `clientIntel.weCalledIt` data. Phase 1 hides it behind a feature flag (default `false`) rather than deleting the component. Files involved (`WeCalledIt.tsx`, `PredictionShowcaseCard.tsx`, the `useClientOutcomes` "we called it" feed, the `WeCalledItEntry` type) are retained for potential future reinstatement under a redesigned use case.

---

## 6. Phase Plan

This spec drives **multiple small implementation specs**, each shipped as its own PR (staging → main per project convention). Phase 1 is sliced into 6 PRs to avoid monolith risk; Phase 2 stays as a focused refactor; Phase 3 expands into independent sub-projects.

### Phase 1 — Restructure existing data into the new IA (6 PRs)

**Goal:** Re-organize what exists today into the three-section Inbox + Wins surface, with minimal underlying-system changes. Sliced into shippable units to keep individual PRs reviewable and to enable parallel development after the shared-contracts PR lands.

| # | PR scope | Files (~) | Depends on | Parallel-safe with |
|---|----------|----------:|------------|--------------------|
| **1.0a** | Retire `feedback` table (delete files, routes, table) | 7 | — | 1.0b, 1.3, 1.4 |
| **1.0b** | Deprecate `keyword_strategy` client_action (remove button, archive existing rows, drop type) | 8 | — | 1.0a, 1.3, 1.4 |
| **1.1** | Shared contracts: types, migrations, route alias updates, `AeoChangeDiff` payload enrichment, `ClientRequestStatus` derived type + mapping function | 10 | — | (sequential — must merge before 1.2) |
| **1.2** | Inbox restructure: new 3-section `InboxTab` + chip bar + section adapters + trust-first `<DecisionPrimitive>` modal + `ClientActionDetailModal` renderer updates. **Behind feature flag `new_inbox_ia`** | 15 | After 1.1 | 1.3, 1.4 |
| **1.3** | Insights / Wins: `<WinsSurface>` component + `GET /api/public/wins/:wsId` + `useClientWins` hook + "we called it" feature-flag hide. **Behind feature flag `client_wins_surface`** | 7 | After 1.1 | 1.2, 1.4 |
| **1.4** | Platform "Send to client" convention: optional-note pattern across 13 admin components | 13 | After 1.1 | 1.2, 1.3 |
| **1.5** | Prevention + docs: 5 new pr-check rules + CLAUDE.md/ui-vocabulary updates + new `docs/rules/inbox-section-routing.md` | 8 | Last (after 1.0–1.4) | — |

**Parallelization opportunities** (after 1.1 lands): 1.2 + 1.3 + 1.4 can run in 3 separate worktrees with strict file ownership per audit §5.3.

**Feature-flag protection:** 1.2 (high UX blast radius) and 1.3 (new component) ship behind feature flags defaulting to `false` in production. Flags are flipped manually after staging verification. 1.5 removes the flags once stable.

**Out of scope for Phase 1:**
- Unifying presenters across `client_actions` and `approval_batches` (Phase 2)
- At-scale grouping/search for 200+ item batches (Phase 2)
- Per-item exclusion semantics (Phase 3)
- Schema admin entry-point consolidation (Phase 3)
- Rich Wins surface — aggregates, ROI value, win patterns (Phase 3)
- `client_signals` and `action_playbooks` orphan resolution (Phase 3)

### Phase 2 — Unify presenters across `client_actions` and `approval_batches`

**Goal:** From the client view, every Decisions card uses one component family regardless of whether the underlying record is a `client_action` or an `approval_batch`. Tables stay separate; rendering converges.

Estimated as **2 PRs**:

- **2.1** Presenter unification — new `<DecisionCard>` + `<DecisionDetailModal>` that consume a normalized shape; adapters mapping `client_actions` and `approval_batches` rows into the shared shape; shared "approve with optional flagged-item notes" submission path
- **2.2** At-scale Decisions — grouping by type, search bar, virtualized list rendering for 50+ item batches (per §4.1.2)

### Phase 3 — Consolidation, wins enrichment, retire orphans

**Goal:** Clean up the platform's long-tail debt now that the IA is stable. Each item is a separate sub-project with its own spec:

- **3.1 schema-admin-consolidation** — merge per-page and bulk schema entry points into one admin surface
- **3.2 wins-enrichment** — aggregates ("N wins this month, est. $X organic value"), win patterns ("your meta updates win 80% of the time"), competitive context, full ROI dashboard / wins history page
- **3.3 per-item-exclusion** — backend support for per-item exclusion in the Decisions primitive (only if Phase 1's note-only workaround proves insufficient)
- **3.4 client-signals-resolution** — decide: surface to client, repurpose for admin chat context, or retire
- **3.5 action-playbooks-resolution** — decide: surface as recommendations, keep internal, or retire

---

## 7. Open Questions and Future Work

### 7.1 Confirmed open questions

- **Per-item exclusion** — Phase 1 ships with notes-only handling on flagged items (team manually holds them). Phase 3 may need to add backend support if the manual workflow proves to be a bottleneck.
- **At-scale Decisions** — Phase 1 ships standard scale (5–15 items). Schema bulk batches at 200+ items will land via the same primitive but with degraded UX until Phase 2 adds grouping/search. Acceptable trade-off because at-scale schema batches are infrequent.

### 7.2 Future work explicitly out of scope

- **Email/external notifications** — beyond the existing email triggers. The current `notifyApprovalReady`, `notifyClientStatusChange`, etc. continue as-is.
- **Client mobile app** — out of scope.
- **Admin Inbox redesign** — this spec is purely client-side. Admin tooling unchanged except for the §5.2 button collapse and §5.4/§5.1 retirements.

---

## 8. References

- Audit findings (4-agent parallel sweep, 2026-05-09) covering: admin send-to-client UI, client-side receive surfaces, documentation/roadmap, backend tables/routes/broadcasts
- `docs/superpowers/specs/2026-05-08-client-inbox-redesign.md` — the prior, narrower spec; superseded as Phase 1 of this redesign
- `tracked_actions` migration (server/db/migrations/041-outcome-tracking.sql)
- `shared/types/client-actions.ts` — discriminated union types for `client_actions` payloads
- `src/components/client/InboxTab.tsx` — current Inbox shell
- `src/components/client/ClientActionDetailModal.tsx` — current modal shell with per-sourceType renderers
- `src/components/client/Briefing/InsightsBriefingPage.tsx` — Insights page where Wins surface is added
