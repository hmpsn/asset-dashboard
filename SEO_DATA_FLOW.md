# SEO Edit Data Flow — Architecture Audit

> Created: March 8, 2026
> Purpose: Map every data path through the platform, identify disconnects, and design a unified model.
> **See also: [PLATFORM_AUDIT.md](./PLATFORM_AUDIT.md)** — comprehensive audit of all 18 admin + 11 client screens, 13 data stores, 4 background schedulers, 49 issues, 5-phase implementation plan.

---

## Current State: All Data Stores

The platform has **13 independent data stores** with minimal cross-referencing:

```
┌─────────────────────── DATA STORES ───────────────────────────┐
│                                                                │
│  1. Workspace Config       workspaces.json                     │
│     └── seoEditTracking    Record<pageId, {status, updatedAt}> │
│     └── auditSuppressions  {check, pageSlug, reason}[]         │
│     └── keywordStrategy    {pageMap, contentGaps, quickWins}   │
│                                                                │
│  2. Approval Batches       approvals/<wsId>.json               │
│     └── ApprovalBatch[]    {items: ApprovalItem[], status}     │
│                                                                │
│  3. Content Requests       content-requests/<wsId>.json        │
│     └── ContentTopicRequest[]  9-step lifecycle                │
│                                                                │
│  4. Client Requests        requests/<wsId>.json                │
│     └── ClientRequest[]    ticket system, notes + attachments  │
│                                                                │
│  5. Payments               payments/<wsId>.json                │
│     └── PaymentRecord[]    Stripe sessions, no work linkage    │
│                                                                │
│  6. Activity Log           .activity-log.json                  │
│     └── ActivityEntry[]    append-only, 500 max                │
│                                                                │
│  7. Audit Snapshots        reports/<siteId>/                   │
│     └── {audit, pages, issues, scores}                         │
│                                                                │
│  8. Chat Memory            chat-sessions/                      │
│     └── per-session messages + summaries                       │
│                                                                │
│  9. Recommendations        recommendations/<wsId>.json         │
│     └── RecommendationSet  traffic-weighted, status-tracked    │
│     ⚠️  Duplicated by client FixRecommendations.tsx            │
│                                                                │
│  10. Churn Signals         .churn-signals.json                 │
│      └── ChurnSignal[]     background scheduler, every 6h     │
│                                                                │
│  11. Sales Reports         sales-reports/                      │
│      └── Prospect audit reports (isolated from workspaces)     │
│                                                                │
│  12. Rank Tracking         rank-tracking/<wsId>/               │
│      └── Keyword position snapshots over time                  │
│                                                                │
│  13. Annotations           per-workspace timeline annotations  │
│                                                                │
│  + Email Queue, Jobs (in-memory), Audit Schedules,             │
│    Client Users (per-workspace login tracking)                 │
│                                                                │
│  ⚠️  Every store writes only to itself.                        │
│  Cross-store writes: only Stripe webhook + trackSeoEdit.       │
│  Cross-store reads:  only Monthly Report (reads 7 stores).     │
│                                                                │
│  There's no way to trace: audit issue → edit → approval → live │
│  There's no way to trace: payment → work order → fulfillment   │
│  There's no way to trace: brief → page → ROI                  │
│  There's no way to trace: recommendation → fix → completion    │
└────────────────────────────────────────────────────────────────┘
```

**See [PLATFORM_AUDIT.md](./PLATFORM_AUDIT.md) Part 4** for the full server-side infrastructure audit including background schedulers, job types, email triggers, Stripe webhook flow, and the recommendations engine analysis.

## Full Bidirectional Flow Map

### Admin → Webflow → Client

```
ADMIN ACTION                SERVER                  DATA WRITTEN           CLIENT SEES
─────────────────────────── ─────────────────────── ────────────────────── ─────────────────
Audit run                   GET /seo-audit/:site    audit snapshot         health score,
                                                    seoEditTracking→       issue count
                                                     'flagged'

SEO Editor save             PUT /pages/:id/seo      Webflow API write      nothing (no
                                                    seoEditTracking→       approval sent)
                                                     'live'

SEO Editor → Send           POST /approvals/:ws     approval batch         ApprovalsTab:
for Approval                                        seoEditTracking→       flat item list
                                                     'in-review'

CMS Editor save             PATCH /collections/     Webflow API write      nothing
                            :c/:id                  seoEditTracking→
                                                     'live'

CMS Editor → Send           POST /approvals/:ws     approval batch         ApprovalsTab:
for Approval                                        seoEditTracking→       flat item list
                                                     'in-review'           (NOT grouped
                                                                            by page)

Schema publish              POST /schema-publish    Webflow API write      nothing
                                                    seoEditTracking→
                                                     'live'

Schema → Send               POST /approvals/:ws     approval batch         ApprovalsTab
for Approval

Audit "Accept Fix"          PUT /pages/:id/seo      Webflow API write      ⚠️ NOTHING
                                                    seoEditTracking→       Client never
                                                     'live'                sees this change

Audit "Flag for Client"     POST /api/requests      content request        RequestsTab:
                                                    (status: 'new')        task card
                                                    ⚠️ NOT linked to
                                                    audit or tracking

Bulk SEO fix                POST /seo-bulk-fix      Webflow API write      nothing
                                                    seoEditTracking→
                                                     'live'
```

### Client → Admin

```
CLIENT ACTION               SERVER                  DATA WRITTEN           ADMIN SEES
─────────────────────────── ─────────────────────── ────────────────────── ─────────────────
Approve item                PATCH /approvals/       approval item →        ⚠️ Nothing
                            :ws/:b/:item             'approved'            updates in admin
                                                                           editor tools

Reject item                 PATCH /approvals/       approval item →        ⚠️ No tracking
                            :ws/:b/:item             'rejected'            update, no
                                                                           notification

Edit + approve              PATCH /approvals/       clientValue saved      ⚠️ Admin doesn't
                            :ws/:b/:item            item → 'approved'      see client edit

Push approved live          POST /approvals/        Webflow API write      Activity log
                            :ws/:b/apply            seoEditTracking→       entry only
                                                     'live'

Submit content request      POST /requests/:ws      content request        Requests tab
                                                    (status: 'requested')

Comment on request          POST /requests/         comment appended       Comment visible
                            :ws/:id/comment
```

### What's Missing (the gaps)

```
SCENARIO                              WHAT SHOULD HAPPEN              WHAT ACTUALLY HAPPENS
────────────────────────────────────── ──────────────────────────── ──────────────────────────
Audit finds issue on page X           All tools show "issue          Only audit shows it.
                                      detected" badge on X           Editor/CMS/Schema don't
                                                                     know.

Admin fixes page X from audit         Fix goes for client review     Fix applies directly to
                                                                     Webflow. Client never
                                                                     sees it.

Admin sends title + desc for          Client sees one grouped        Client sees 2 separate
same page                             card with both fields          flat items.

Client rejects a proposed change      Admin sees "rejected" badge    Nothing updates in any
                                      in the originating tool        admin tool. seoEditTracking
                                                                     still says 'in-review'.

Client edits a proposed value         Admin can see the client's     Admin has no visibility
                                      preferred version              into client edits from
                                                                     their editor tools.

Admin flags issue for client          Shows as linked task with      Creates orphan content
from audit                            audit context                  request with no pageId
                                                                     linkage to audit data.

Content request is delivered          Content appears in CMS or      No connection between
                                      editor tools                   content request and any
                                                                     page state.
```

---

## The 4 Problems You Identified

### Problem 1: Approval items are flat, not grouped by page
**Root cause**: `ApprovalItem` model has one item per field change. When CMS Editor sends title + description for the same page, they become 2 separate items in the UI.

**Data model**:
```
ApprovalBatch.items = [
  { pageId: "abc", field: "seoTitle", ...},      ← Invisalign Austin title
  { pageId: "abc", field: "seoDescription", ...}, ← Invisalign Austin desc
  { pageId: "def", field: "seoDescription", ...}, ← San Antonio desc
]
```
**Fix**: Group items by `pageId` in the **rendering layer** (ApprovalsTab). No data model change needed.

### Problem 2: Audit fixes aren't reflected in SEO/CMS editors as "pending review"
**Root cause**: The Audit "Accept Fix" button calls `PUT /api/webflow/pages/:pageId/seo` which applies the change **directly to Webflow** and marks tracking as `'live'`. There's no approval step. The fix bypasses the client entirely.

If you WANT these to go through client review (which makes sense), the audit should submit them to the approval flow instead of applying directly.

**Deeper issue**: There's no unified "issue → fix → review → publish" pipeline. The audit detects issues, but the resolution path is fragmented:
- Audit "Accept Fix" → applies directly (no review)
- Audit "Send to Client" → creates a task/flag (not an approval)
- Manual edit in SEO Editor → can send for approval (separate flow)
- Manual edit in CMS Editor → can send for approval (separate flow)

### Problem 3: CMS Editor doesn't reflect full lifecycle
**Root cause**: CMS Editor shows `editTracking` badges (Live/In Review/Flagged), but:
- Doesn't show "issue detected" from audit — it reads tracking, not audit data
- Doesn't link to the approval batch — can't show "awaiting client review in batch X"
- Items flagged by audit don't surface here unless manually tracked

### Problem 4: No unified view of all page states
**Root cause**: Each tool renders its own slice. No component shows a cross-tool page status overview.

---

## Proposed Architecture: Unified Work Item Model

The root problem isn't just SEO tracking — it's that the platform has **3 separate communication systems** that don't know about each other:

1. **Approval Batches** — admin proposes SEO changes, client reviews
2. **Content Requests** — client requests content, admin fulfills
3. **Audit Flags / Tasks** — admin flags issues from audit, creates ad-hoc request

All three represent **work items flowing between admin and client**, but they use different data models, different UI components, and different API endpoints.

### The Core Model: `PageEditState`

Replace `seoEditTracking` with a model that tracks the **full lifecycle** and links to approvals:

```typescript
interface PageEditState {
  pageId: string;
  pageTitle: string;
  pageSlug: string;
  collectionId?: string;           // present for CMS items

  // Lifecycle status — single source of truth
  status: 'clean'               // no issues, no pending work
        | 'issue-detected'      // audit found problems
        | 'fix-proposed'        // admin made edits (saved but not sent)
        | 'in-review'           // sent to client for approval
        | 'approved'            // client approved (not yet applied)
        | 'rejected'            // client rejected (needs admin attention)
        | 'live';               // applied to Webflow

  // What's been changed (grouped by page, not flat)
  fields: Array<{
    field: string;               // 'seoTitle', 'seoDescription', 'schema', CMS field slug
    currentValue: string;
    proposedValue?: string;
    clientValue?: string;        // client's edited version if they modified it
    source: 'audit' | 'editor' | 'schema' | 'cms' | 'bulk-fix';
    updatedAt: string;
  }>;

  // Audit linkage
  auditIssues?: string[];        // check IDs from audit (e.g., 'title', 'meta-description')

  // Approval linkage (bidirectional)
  approvalBatchId?: string;      // which approval batch this page is in
  approvalItemIds?: string[];    // specific item IDs in the batch

  // Timestamps
  firstDetectedAt?: string;      // when audit first found issues
  lastEditedAt: string;
  lastEditedBy: string;          // tool name
}
```

Stored at: `workspace.pageEditStates: Record<pageId, PageEditState>`
API: `GET/PATCH /api/workspaces/:id/page-states`

### Lifecycle Flow

```
                    Audit detects issue
                          │
                          ▼
                   ┌──────────────┐
                   │issue-detected│  (amber — visible in ALL tools)
                   └──────┬───────┘
                          │
              Admin edits in ANY tool (editor, CMS, schema, audit fix)
                          │
                          ▼
                   ┌──────────────┐
                   │ fix-proposed │  (blue — saved, not sent yet)
                   └──────┬───────┘
                          │
              Admin sends for client review
              (groups all fields for this page into one approval card)
                          │
                          ▼
                   ┌──────────────┐
                   │  in-review   │  (purple — client has it)
                   └──────┬───────┘
                          │
                ┌─────────┼─────────┐
                │         │         │
            Client     Client    Client
            approves   edits     rejects
                │      + approves   │
                ▼         │         ▼
         ┌──────────┐    │  ┌──────────────┐
         │ approved │◄───┘  │  rejected    │  (red — admin sees this)
         └────┬─────┘       └──────┬───────┘
              │                    │
              │              Admin revises → back to fix-proposed
              │
         Applied to Webflow (by client or auto)
              │
              ▼
         ┌──────────┐
         │   live   │  (teal — done)
         └──────────┘
```

### Client Approval Feedback → Admin Visibility

**Critical missing piece**: When a client approves/rejects/edits, the admin tools need to reflect this immediately.

```typescript
// When client updates an approval item:
PATCH /api/public/approvals/:ws/:batch/:item
  → updates ApprovalItem.status
  → ALSO updates PageEditState.status to match:
       'approved' → page state → 'approved'
       'rejected' → page state → 'rejected'
       clientValue set → page state.fields[].clientValue updated
  → Admin's editor tools show the change on next fetch
```

### What Changes — Layer by Layer

| Layer | Current | Proposed |
|-------|---------|----------|
| **Data model** | `seoEditTracking: Record<pageId, {status, updatedAt}>` | `pageEditStates: Record<pageId, PageEditState>` with field-level detail + approval linkage |
| **Audit run** | Detects issues → shows in audit UI only | Detects issues → writes `issue-detected` to page state → visible in all tools |
| **Audit "Accept Fix"** | Applies directly to Webflow (client never sees) | Two buttons: "Apply Now" (marks live) OR "Send for Review" (creates approval) |
| **Editor save** | Writes to Webflow immediately | Writes to Webflow + updates page state. If approval exists, warns "this page has a pending approval" |
| **Send for approval** | Creates flat item list | Groups fields by page. Links approval batch ID + item IDs into page state |
| **Client approve/reject** | Only updates approval item | Also updates page state → admin tools reflect client decision |
| **Client edit** | Stores `clientValue` on approval item only | Also stores on page state → admin can see client's preferred version |
| **Apply to Webflow** | Writes + marks 'live' | Writes + marks 'live' + clears proposed/client values + unlinks approval |
| **ApprovalsTab** | Flat list, one row per field | Grouped by page: one card per page, multiple fields inside |
| **All admin tools** | Each fetches tracking independently | Shared `usePageEditStates(wsId)` hook, consistent badges everywhere |
| **Activity feed** | Separate, no linkage | Activity entries include `pageId` for cross-referencing |

### Content Requests — Separate But Acknowledged

Content requests (briefs, full posts) have their own well-defined lifecycle:
```
requested → pending_payment → brief_generated → client_review → approved → in_progress → delivered
```
This is a **different workflow** from SEO edits. The content request model already handles this well. The gap is:
- When content is delivered, there's no connection to the page it was written for
- Recommendation: add optional `targetPageId` to `ContentTopicRequest` so delivered content can link back to a page

### Audit Flags — Merge Into Approvals

Currently "Flag for Client" creates an orphan content request with category 'seo'. This should instead create an **approval batch** with the audit context, so it flows through the same approval pipeline.

---

## Implementation Phases

### Phase 1 — Immediate UX Fixes (no model change, ~3h)
1. **Group approval items by page** in ApprovalsTab rendering
2. **Audit "Accept Fix" → option to send for review** instead of always applying directly
3. **Client approve/reject → update seoEditTracking** so admin tools reflect client decisions
4. **CMS Editor badge consistency** — ensure tracking fetch + display works for all statuses

### Phase 2 — PageEditState Model (~5h)
1. Replace `seoEditTracking` with `pageEditStates` on Workspace
2. Create `updatePageState()` server helper (replaces `trackSeoEdit()`)
3. Wire audit run to write `issue-detected` for all pages with issues
4. Wire all 8 server write endpoints to use `updatePageState()`
5. Wire client approval PATCH to update page state bidirectionally
6. Create shared `usePageEditStates(wsId)` React hook
7. Update all 4 frontend tools (SeoEditor, CmsEditor, SchemaSuggester, SeoAudit) to use shared hook
8. Add 'rejected' status display (red badge) to all tools

### Phase 3 — Unified Views + Polish (~4h)
1. **Unified SEO Changes panel** — all pages with lifecycle state, click to navigate
2. **WorkspaceHome summary** — "5 pages live, 2 in review, 3 issues detected"
3. **Client "What's Changed" view** — client sees all recent SEO work, not just pending approvals
4. **Audit flag → approval** — merge "Flag for Client" into approval flow

---

## Decision Point

**Phase 1 only (~3h)**: Fixes the visible UX pain. Systems still disconnected under the hood.

**Phase 1 + 2 (~8h)**: Proper foundation. Every tool reads from one model. Client decisions flow back to admin. Prevents this entire class of bugs. **← Recommended**

**All three (~12h)**: Complete unified experience. Admin and client both see the full picture.

All phases are backward-compatible — Phase 1 patches work with or without Phase 2, and Phase 2's model change is purely additive (old data migrates automatically).
