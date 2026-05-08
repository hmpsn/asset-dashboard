# Client Inbox Redesign

**Date:** 2026-05-08
**Status:** Spec — ready for implementation planning

## Goal

Replace the current flat filter-bar inbox with a structured, three-section layout that is immediately scannable and actionable for clients. The current inbox mixes seven signal types behind an overcrowded filter bar with no clear hierarchy. The redesign makes urgency explicit (priority strip), gives each signal type a logical home (three sections), and removes resolved items from the default view (completed mode).

---

## Structure Overview

```
Inbox page
├── Page header + Active / Completed toggle (top right)
├── Filter chips  [All · Needs Action & Requests · SEO Changes · Content]
├── Priority strip  (always visible in Active mode)
├── Section 1: Needs Action & Requests
├── Section 2: SEO Changes
└── Section 3: Content
```

---

## Mode: Active vs. Completed

A two-state toggle in the top-right of the page header switches between modes.

**Active (default):** Shows only items that are unresolved — pending approvals, open requests, content awaiting review, action cards not yet approved/archived.

**Completed:** Shows a read-only history log of everything resolved. No action buttons. Grouped by section type with status badges (Applied, Closed, Delivered, Published, Approved). Filter chips are hidden in this mode — they only apply to the active view.

Items exit the active view as soon as they are fully resolved:
- Approval batch → all items `applied`
- Request → status `completed` or `closed`
- Client action card → status `approved`, `completed`, or `archived`
- Content item → status `delivered` or `published`
- Copy review section → approved
- Content plan cell → approved or flagged-and-resolved
- Schema plan → feedback submitted

---

## Filter Chips

Four pill-shaped chips sit below the page header, above the priority strip:

| Chip | Shows |
|------|-------|
| All | All three sections (default) |
| Needs Action & Requests | Section 1 only |
| SEO Changes | Section 2 only |
| Content | Section 3 only |

Chips carry a count badge showing pending items in that section. Selecting a chip hides the other sections — it does not change what is shown within a section. The priority strip is always visible regardless of chip selection.

---

## Priority Strip

Always visible at the top of the active view. Surfaces urgent items across all three sections so clients never have to hunt.

**What surfaces:**
- Client action cards with `status === 'pending'`
- Approval batches with any items in `pending` status
- Requests where the most recent note has `author === 'team'` (team replied, ball is in client's court)
- Content items at `client_review` or `post_review` status
- Content plan cells at `review` status
- Copy review sections awaiting client approval
- Schema plan pending initial client feedback

**Display per item:** One compact row — icon · title · section chip (so the client knows where it lives) · CTA button.

**CTA behaviour:**
- Simple decisions (content plan sign-off, action card approve/reject): actionable directly from the strip inline where possible.
- Anything requiring a modal or slide-over: the strip button opens that modal/panel directly.

**Ordering:** Team replies on requests first (time-sensitive), then pending SEO approvals (team is blocked), then action cards, then content reviews.

**Empty state:** Solid green "You're all caught up" state — no items, no strip border pulse. This should feel like a reward.

---

## Section 1 — Needs Action & Requests

Contains all items that require a client decision or represent ongoing client ↔ team communication.

**Subsections (within the section body):**

### Action Items
Client action cards for: AEO changes, internal link batches, redirect proposals, keyword strategy recommendations, content decay refresh recommendations, content plan sign-offs.

Each card shows:
- Title + summary text
- Source type chip (e.g. "Internal links", "Content decay")
- Actions based on source type (see below)

**Tier 1 — inline approve/reject** (short summary, no detailed payload review needed):
- `content_decay` — approve or reject the refresh recommendation, summary text is sufficient

**Tier 3 — "View details →" opens full-screen modal** (payload contains a list of items that must be reviewed before deciding):
- `internal_link` — table of anchor text + target URL + context snippet per suggestion
- `redirect_proposal` — source → target URL pairs with rationale
- `keyword_strategy` — mapped pages, quick wins, content gaps, opportunities
- `aeo_change` — current → proposed content diffs per page

**Note:** The full-screen modals for Tier 3 action card types are net-new UI — the current inbox shows these as summary-only cards with inline approve/reject. The redesign requires building a modal view that renders each `ClientActionPayload` type appropriately.

### Requests
Client-submitted requests (bug reports, content updates, design changes, SEO requests, new pages). Each card shows:
- Title, category chip, submitted date
- Status badge (New / In Review / In Progress / On Hold)
- If the most recent note is from `'team'`: amber "Team replied · Xh ago" badge — this card also appears in the priority strip
- Expand in place to show threaded conversation + file attachments + reply input

**Submit CTA:** A dashed-border row at the bottom of the Requests subsection: "Need something? Submit a new request →" with a "+ New request" button. This replaces the current standalone PageHeader + button pattern.

---

## Section 2 — SEO Changes

Contains all agency-initiated SEO changes proposed for client sign-off.

### Approval Batches
The existing approval batch pattern is preserved exactly. Items within a batch are **grouped by page** — the Homepage card shows both the title change and the meta description change together, not as separate rows. Within each page card:
- Page name / URL
- Per-field diff: current value (red) → proposed value (green)
- Per-field actions: Approve · Edit · Reject

Batch-level bulk actions at the bottom of each batch card: "Approve all remaining (N)" · "Reject all".

Interaction tier: **Tier 1 — inline expand.** The diff is short enough to read and decide without leaving the page.

### Schema Plan Review
One card per workspace (schema plans are one-per-workspace). Shows: plan name, page count, a one-line description. Single CTA: "Review schema plan →" opens a **full-screen modal** that wraps the existing `SchemaReviewTab` component, which currently lives as a standalone client route. The modal replaces that route — clients access schema review through the inbox rather than a dedicated tab.

**Collapsed by default when nothing pending:** When all approval batches are applied and no schema plan is pending, Section 2 collapses to a one-line summary header ("N changes applied · nothing pending") and does not expand automatically. This keeps Content visible on most days without requiring the client to scroll past a large resolved section.

---

## Section 3 — Content

Contains all content production signals — review items and pipeline status.

### Copy Review
One card per copy blueprint entry at `client_review` status. Shows: page/blueprint name, number of sections awaiting approval. CTA: "Review copy →" opens a **full-screen modal** with the section-by-section review experience (existing `ClientCopyReview` flow).

### Content Pipeline
Listed below a "Pipeline" sub-header. Each row shows:
- Status dot (colour-coded: amber = review, teal = in progress, green = delivered/published)
- Title + target keyword / page type
- Status pill (Ready to review / In progress / Published)
- "Read & Review →" button only for items at `client_review` or `post_review` — opens full-screen modal
- Status-only rows (In progress, Published) have no action button

Interaction tier for review items: **Tier 3 — full-screen modal.** Briefs and posts are long-form prose that need focused reading before a decision.

### Order Content CTA
A teal-tinted row at the bottom of the section: "Need a new blog post or landing page brief?" · "+ Order content". Opens the existing pricing/order flow.

---

## Interaction Tiers

Every inbox card is compact. What varies is what opens when the client clicks in:

| Tier | Pattern | Used for |
|------|---------|---------|
| 1 | Inline expand | SEO title/meta diffs (per-page grouped), content plan sign-offs, request threads, simple action card approve/reject |
| 2 | Slide-over panel | Redirect proposal pairs (source → target — compact list) |
| 3 | Full-screen modal | Internal link batches, schema plan review, keyword strategy, AEO change details, content briefs, blog posts/landing pages, copy review sections |

The rule for Tier 3 vs Tier 2: if the content needs **full width** to be properly evaluated (tables, long prose, context snippets), it's a full-screen modal. A slide-over is only appropriate for genuinely compact lists of simple pairs.

---

## Signal Routing Reference

| Signal | Section | Tier | Priority strip? |
|--------|---------|------|----------------|
| Client action card (AEO, internal links, redirects, decay) | Needs Action | 1 (simple) / 3 (complex) | Yes, if pending |
| Content plan sign-off | Needs Action | 1 inline | Yes |
| Client requests | Needs Action | 1 inline thread | Yes, if team replied |
| SEO approval batch | SEO Changes | 1 inline per-page diff | Yes, if pending |
| Schema plan review | SEO Changes | 3 full-screen modal | Yes, if pending |
| Copy review | Content | 3 full-screen modal | Yes, if awaiting approval |
| Content brief review | Content | 3 full-screen modal | Yes |
| Content post review | Content | 3 full-screen modal | Yes |
| Content pipeline status (in progress, published) | Content | No action | No |

---

## What Does NOT Change

- The per-page grouping within approval batches (title + meta together in one card per page) is preserved exactly.
- The existing `ApprovalsTab`, `RequestsTab`, `ContentTab`, `ClientCopyReview`, `SchemaReviewTab` component logic is reused — the redesign changes the containing layout and navigation, not the internal review UX of each component.
- The `InboxFilter` type and `useSearchParams`-based deep-link wiring must be updated to match the new section names. The `?tab=` two-halves contract applies.

---

## Open Questions for Implementation

None blocking the plan. The following are resolved at pre-plan audit:
- Exact `InboxFilter` values for the new three-section model
- Whether `ClientInboxAlias` values in `routes.ts` need updating
- How `ClientActionSourceType` maps to which interaction tier (Tier 1 vs 3)
