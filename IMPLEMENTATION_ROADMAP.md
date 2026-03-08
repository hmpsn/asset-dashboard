# Data Flow Unification — Implementation Roadmap

> **Created**: March 8, 2026
> **Source**: [PLATFORM_AUDIT.md](./PLATFORM_AUDIT.md) (49 issues) + [SEO_DATA_FLOW.md](./SEO_DATA_FLOW.md) (13 data stores)
> **Goal**: Unify all data flows end-to-end so every page edit, content request, payment, and approval is traceable across the entire platform
> **Total estimated effort**: ~18h across 6 sprints

---

## How To Use This Document

This is an **instruction manual** for implementing the data flow unification. Each sprint is:

1. **Self-contained** — can be deployed independently
2. **Ordered by dependency** — later sprints build on earlier ones
3. **Broken into tasks** — each task lists exact files, what to change, and how to verify

**Convention**: Each task references the audit issue(s) it resolves with `[#N]` notation (from PLATFORM_AUDIT.md).

---

## Architecture Overview

### Before (Current State)
```
13 isolated data stores, each writing only to itself.
No shared page state. No cross-store writes (except Stripe webhook + trackSeoEdit).
4 disconnected communication systems. 5 broken pipelines.
```

### After (Target State)
```
PageEditState as the universal page lifecycle model.
All tools read/write shared state via usePageEditStates() hook.
Cross-store event propagation: audit → page state → approvals → activity.
Stripe webhook → work orders → fulfillment → page state.
Content requests linked to pages → delivery updates page state → ROI tracks per-page.
```

### The PageEditState Model (Central to Everything)

```typescript
interface PageEditState {
  pageId: string;
  slug: string;
  status: 'clean' | 'issue-detected' | 'fix-proposed' | 'in-review'
        | 'approved' | 'rejected' | 'live';
  auditIssues?: string[];           // e.g. ['title', 'meta-description']
  fields?: string[];                // which fields were edited
  source?: 'audit' | 'editor' | 'cms' | 'schema' | 'bulk-fix' | 'cart-fix';
  approvalBatchId?: string;         // links to approval store
  contentRequestId?: string;        // links to content store
  workOrderId?: string;             // links to work order store
  rejectionNote?: string;           // client feedback on rejection
  updatedAt: string;
  updatedBy?: 'admin' | 'client' | 'system';
}
```

This replaces the current `seoEditTracking: Record<string, { status, updatedAt }>` with a richer model that cross-references other stores.

---

## Sprint 0: Foundation (~2.5h)
**Theme**: Build the shared infrastructure everything else depends on.
**Resolves**: [#5-9] [#14] [#16] (partial — enables later sprints to complete these)

### Task 0.1 — Define PageEditState Interface
**Time**: 20m
**File**: `server/workspaces.ts`

**What to do**:
1. Add the `PageEditState` interface (shown above) after the existing `Workspace` interface
2. Add `pageEditStates?: Record<string, PageEditState>` to the `Workspace` interface alongside the existing `seoEditTracking`
3. Keep `seoEditTracking` for backward compatibility during migration

**Verification**: `npx tsc --noEmit` passes

---

### Task 0.2 — Create updatePageState() Server Helper
**Time**: 30m
**File**: `server/workspaces.ts`

**What to do**:
1. Create `updatePageState(workspaceId, pageId, updates: Partial<PageEditState>): PageEditState`
2. This function should:
   - Read the workspace
   - Get or create the `pageEditStates[pageId]` entry
   - Merge updates (preserving existing fields not in the update)
   - Set `updatedAt` automatically
   - Write the workspace back
   - **Also** write to the legacy `seoEditTracking` for backward compat (map status down to the simpler `flagged | in-review | live` format)
3. Create `getPageState(workspaceId, pageId): PageEditState | undefined`
4. Create `getAllPageStates(workspaceId): Record<string, PageEditState>`
5. Export all three functions

**Verification**: Write a quick test in a scratch file or verify via API after Task 0.3

---

### Task 0.3 — CRUD API Endpoints for Page States
**Time**: 25m
**File**: `server/index.ts`

**What to do**:
1. `GET /api/workspaces/:id/page-states` → returns `getAllPageStates(id)`
2. `GET /api/public/page-states/:workspaceId` → same, for client dashboard
3. `PATCH /api/workspaces/:id/page-states/:pageId` → calls `updatePageState()` with request body
4. `DELETE /api/workspaces/:id/page-states/:pageId` → removes a single page state entry

**Where to add**: After the existing `/api/workspaces/:id/seo-edit-tracking` endpoints (~line 863). Follow the same pattern (requireWorkspaceAccess middleware for admin, no auth for public).

**Verification**: `curl localhost:3000/api/workspaces/<wsId>/page-states` returns `{}`

---

### Task 0.4 — StatusBadge Shared Component
**Time**: 25m
**File**: `src/components/ui/StatusBadge.tsx` (new file)

**What to do**:
Create a reusable component:
```tsx
interface StatusBadgeProps {
  status: PageEditState['status'];
  size?: 'sm' | 'md';
  showLabel?: boolean;
}
```

Color map (from PLATFORM_AUDIT.md Color System):
| Status | Border | BG | Text |
|--------|--------|----|------|
| `clean` | *(no badge)* | — | — |
| `issue-detected` | `border-amber-500/30` | `bg-amber-500/10` | `text-amber-400` |
| `fix-proposed` | `border-blue-500/30` | `bg-blue-500/10` | `text-blue-400` |
| `in-review` | `border-purple-500/30` | `bg-purple-500/10` | `text-purple-400` |
| `approved` | `border-green-500/30` | `bg-green-500/10` | `text-green-400` |
| `rejected` | `border-red-500/30` | `bg-red-500/10` | `text-red-400` |
| `live` | `border-teal-500/30` | `bg-teal-500/10` | `text-teal-400` |

Also export a `statusBorderClass(status)` utility for page card borders.

**Verification**: Import in one component, render all 7 states, visually confirm colors match spec

---

### Task 0.5 — usePageEditStates() React Hook
**Time**: 25m
**File**: `src/hooks/usePageEditStates.ts` (new file)

**What to do**:
```typescript
function usePageEditStates(workspaceId: string | undefined): {
  states: Record<string, PageEditState>;
  loading: boolean;
  refresh: () => void;
  getState: (pageId: string) => PageEditState | undefined;
  summary: { clean: number; issueDetected: number; inReview: number; approved: number; rejected: number; live: number; total: number };
}
```

1. Fetch from `/api/workspaces/:id/page-states` (admin) or `/api/public/page-states/:id` (client)
2. Cache in a module-level `Map<string, { data, fetchedAt }>` — stale after 30s
3. Compute `summary` from the states record
4. Detect admin vs client context from URL path (or accept a `public` flag)

**Verification**: Import in `SeoEditor.tsx` temporarily, `console.log(summary)`, confirm it logs

---

### Task 0.6 — Wire Existing trackSeoEdit Calls to updatePageState
**Time**: 25m
**File**: `server/index.ts`, `server/workspaces.ts`

**What to do**:
1. Find all calls to `trackSeoEdit()` in `server/index.ts` (there are ~5-6 calls)
2. Replace each with `updatePageState()` call, mapping the old parameters:
   - `trackSeoEdit(wsId, pageId, 'live', fields)` → `updatePageState(wsId, pageId, { status: 'live', fields, source: '<context>' })`
   - `trackSeoEdit(wsId, pageId, 'in-review')` → `updatePageState(wsId, pageId, { status: 'in-review' })`
3. Keep `trackSeoEdit` as a deprecated wrapper that calls `updatePageState` internally (for any places we missed)

**Where the calls are** (from the audit):
- Schema publish endpoint (~line 1603)
- Approval apply endpoint (~line 5260)
- Bulk SEO fix job (~line 6254)
- Synchronous bulk SEO fix (~line 2204)
- Any inline editors that call it directly

**Verification**: Edit a page in SeoEditor, confirm page state updates. Run bulk fix job, confirm states update.

---

## Sprint 1: SEO Edit Pipeline (~3h)
**Theme**: Fix the core edit → approve → apply pipeline end-to-end.
**Resolves**: [#1] [#2] [#3] [#5-8] [#9] [#12] [#13] [#14] [#15] [#16] [#19-22]
**Depends on**: Sprint 0

### Task 1.1 — Group Approval Items by Page [#19]
**Time**: 45m
**File**: `src/components/client/ApprovalsTab.tsx`

**What to do**:
1. After loading `batch.items`, group them: `Map<string, ApprovalItem[]>` keyed by `pageId` (or `itemId` for CMS items)
2. Render one card per page, with all field changes listed inside
3. Each page card gets a `StatusBadge` for its current state
4. Keep individual approve/reject per field, but add a page-level "Approve All for This Page" button
5. Show page slug/title as the card header

**Key detail**: `ApprovalItem` has `pageId` and `field` properties. Group by `pageId`.

**Verification**: Send 3 field changes for the same page via SeoEditor → open client approvals → see one grouped card

---

### Task 1.2 — Batch Approve All Button [#22]
**Time**: 15m
**File**: `src/components/client/ApprovalsTab.tsx`

**What to do**:
1. Add "Approve All" button at the top of each batch (next to existing "Push Approved Changes Live")
2. On click: iterate all items in the batch, call `updateApprovalItem(batchId, itemId, 'approved')` for each
3. Show confirmation: "Approve all X changes in this batch?"

**Verification**: Send a batch with 5 items → click "Approve All" → all items show approved

---

### Task 1.3 — Client Approve/Reject → Update PageEditState [#2] [#6] [#7]
**Time**: 30m
**File**: `server/index.ts` — find the `PATCH /api/public/approvals/:workspaceId/:batchId/items/:itemId` endpoint

**What to do**:
1. After updating the approval item status, also call `updatePageState()`:
   - `approved` → `updatePageState(wsId, pageId, { status: 'approved', updatedBy: 'client' })`
   - `rejected` → `updatePageState(wsId, pageId, { status: 'rejected', rejectionNote: req.body.note, updatedBy: 'client' })`
   - `edited` → keep as `in-review` (client modified the proposed value)
2. Log activity: `addActivity(wsId, 'approval_decided', ...)` with client actor info

**Verification**: Approve an item as client → switch to admin → SeoEditor shows green "Approved" badge on that page

---

### Task 1.4 — Audit "Accept Fix" Choice [#12]
**Time**: 45m
**File**: `src/components/SeoAudit.tsx`

**What to do**:
1. Replace the current "Accept Fix" button with a dropdown or two-button group:
   - **"Apply Now"** — keeps current behavior (direct Webflow write)
   - **"Send for Review"** — creates an approval batch item for this fix
2. For "Send for Review":
   - Build an `ApprovalItem` with `pageId`, `field`, `currentValue`, `proposedValue`
   - POST to `/api/approvals/:workspaceId`
   - Call `updatePageState(wsId, pageId, { status: 'in-review', source: 'audit', auditIssues: [check] })`
3. For "Apply Now":
   - Keep existing behavior
   - Call `updatePageState(wsId, pageId, { status: 'live', source: 'audit', fields: [field] })`
4. Mark the issue row visually after action: strikethrough + green "Fixed" or purple "Sent for Review" [#15]

**Verification**: Run audit → click "Send for Review" on a title issue → client sees it in approvals tab → page shows "In Review" in all admin tools

---

### Task 1.5 — Audit "Send to Client" → Creates Approval [#13]
**Time**: 30m
**File**: `src/components/SeoAudit.tsx`, `server/index.ts`

**What to do**:
1. Find the "flagForClient" / "Send to Client" function in `SeoAudit.tsx`
2. Instead of creating an orphan content request, create an approval batch item
3. Include the audit context: issue check, severity, recommendation text, current value
4. Update page state to `in-review`

**Verification**: Flag an issue for client → it appears in client Inbox > SEO Changes (not Requests)

---

### Task 1.6 — Wire Audit Run to Write issue-detected States
**Time**: 25m
**File**: `server/index.ts` — find the `seo-audit` job completion handler (~line 6056)

**What to do**:
1. After audit job completes successfully, iterate through `result.pages`
2. For each page with errors or warnings:
   - `updatePageState(wsId, pageId, { status: 'issue-detected', auditIssues: [list of check names], source: 'audit', updatedBy: 'system' })`
3. For pages with NO issues that previously had `issue-detected` status:
   - `updatePageState(wsId, pageId, { status: 'clean' })` (clear the state)
4. Skip pages that are currently `in-review`, `approved`, or `live` (don't overwrite active workflow states)

**Verification**: Run audit on a site with issues → check page states API → pages with errors show `issue-detected`

---

### Task 1.7 — Update Admin Tools to Use Shared Hook + StatusBadge [#5-9] [#14] [#16]
**Time**: 45m
**Files**: `SeoEditor.tsx`, `CmsEditor.tsx`, `SeoAudit.tsx`, `SchemaSuggester.tsx`

**What to do**:
For each component:
1. Replace the local `editTracking` state + fetch with `usePageEditStates(workspaceId)`
2. Replace inline badge JSX with `<StatusBadge status={state?.status} />`
3. Replace inline border class logic with `statusBorderClass(state?.status)`
4. Now ALL statuses render (including `approved`, `rejected`, `issue-detected` — previously missing)

**Verification**: Approve an item as client → all 4 admin tools show the green "Approved" badge

---

### Task 1.8 — Summary Bars in Admin Tools
**Time**: 20m
**Files**: `SeoEditor.tsx`, `CmsEditor.tsx`, `SeoAudit.tsx`, `SchemaSuggester.tsx`

**What to do**:
1. Use `summary` from `usePageEditStates()` hook
2. Add a bar below the toolbar in each component:
   ```
   24 pages · 5 live · 3 in review · 2 issue detected · 14 clean
   ```
3. Each count is a small pill using StatusBadge colors
4. Optional: clicking a count filters the page list to that status

**Verification**: Open SeoEditor → see summary bar → counts match actual page states

---

## Sprint 2: Content Pipeline Links (~2.5h)
**Theme**: Connect content briefs to pages, add delivery tracking, show pipeline status.
**Resolves**: [#25] [#26] [#27] [#28] [#33] [#36] [#37] [#38]
**Depends on**: Sprint 0

### Task 2.1 — Add targetPageId to ContentTopicRequest [#37]
**Time**: 15m
**File**: `server/content-requests.ts`

**What to do**:
1. Add `targetPageId?: string` to the `ContentTopicRequest` interface
2. Add `targetPageSlug?: string` for display purposes

**Verification**: `npx tsc --noEmit` passes

---

### Task 2.2 — Populate targetPageId from Audit and Strategy [#37]
**Time**: 30m
**Files**: `src/components/ContentBriefs.tsx`, `src/components/client/StrategyTab.tsx`, `server/index.ts`

**What to do**:
1. **Audit Fix→ flow**: When the audit Fix→ button routes to Content Briefs, it passes page context. Capture the `pageId` and include it in the content request creation POST body.
2. **Strategy "Order Brief"**: The strategy page map has `pagePath` and potentially `pageId`. Include in the request.
3. **Server**: In the POST `/api/content-requests/:workspaceId` endpoint, accept and store `targetPageId` and `targetPageSlug`.

**Verification**: Click Fix→ from audit on a thin content issue → generate brief → check the content request JSON → `targetPageId` is populated

---

### Task 2.3 — Add 'published' Status [#28]
**Time**: 20m
**Files**: `server/content-requests.ts`, `src/components/ContentBriefs.tsx`, `src/components/client/ContentTab.tsx`

**What to do**:
1. Add `'published'` to the `status` union type in `ContentTopicRequest`
2. In `ContentBriefs.tsx`: After "Delivered" status, add a "Mark Published" button that PATCHes status to `published`
3. In `ContentTab.tsx`: Show "Published" badge with teal styling for `published` status
4. On publish: if `targetPageId` exists, `updatePageState(wsId, targetPageId, { status: 'live', source: 'content-delivery' })`

**Verification**: Deliver content → mark as published → target page shows "Live" in admin tools

---

### Task 2.4 — Strategy "Already Ordered" Badges [#25]
**Time**: 25m
**File**: `src/components/client/StrategyTab.tsx`

**What to do**:
1. Fetch content requests for this workspace (already available or add a fetch)
2. For each strategy keyword row, check if any content request has matching `targetKeyword`
3. If match found, show badge instead of "Order Brief" button:
   - `requested` → "Brief Ordered" (blue)
   - `brief_generated` / `client_review` → "In Review" (purple)
   - `approved` / `in_progress` → "In Progress" (blue)
   - `delivered` / `published` → "Delivered ✓" (teal)

**Verification**: Order a brief for a keyword → return to Strategy tab → that keyword shows "Brief Ordered" badge

---

### Task 2.5 — Content Pipeline Counts in Command Center [#36]
**Time**: 15m
**File**: `src/components/WorkspaceOverview.tsx`

**What to do**:
1. The overview endpoint already returns some workspace stats
2. Add content request counts to each workspace card: "X briefs pending, Y in progress, Z delivered"
3. Pull from `/api/content-requests/:workspaceId` or add counts to the overview endpoint

**Verification**: Open Command Center → workspace cards show content pipeline stats

---

### Task 2.6 — Content ROI Attribution [#33]
**Time**: 25m
**Files**: `server/index.ts` (ROI endpoint), `src/components/client/ROIDashboard.tsx`

**What to do**:
1. In the `/api/public/roi/:workspaceId` endpoint: if content requests have `targetPageId`, cross-reference with traffic data to compute per-content-request ROI
2. Return `contentROI: { requestId, topic, targetPageId, clicks, impressions, trafficValue }[]`
3. In `ROIDashboard.tsx`: render content ROI section linking each delivered piece to its traffic value

**Verification**: Deliver content targeting a page with traffic → ROI dashboard shows that content's attributed value

---

## Sprint 3: Self-Service Fulfillment (~3h)
**Theme**: Close the cart checkout → fulfillment gap. Admin gets work orders, client gets tracking.
**Resolves**: [#30] [#31] [#32] [#35] [#43] [#44]
**Depends on**: Sprint 0

### Task 3.1 — Define WorkOrder Model
**Time**: 25m
**File**: `server/work-orders.ts` (new file)

**What to do**:
Create a new data store module:
```typescript
interface WorkOrder {
  id: string;
  workspaceId: string;
  paymentId: string;
  productType: ProductType;
  status: 'pending' | 'in_progress' | 'completed' | 'cancelled';
  pageIds: string[];              // which pages this fix covers
  issueChecks?: string[];         // which audit checks this addresses
  quantity: number;
  assignedTo?: string;
  completedAt?: string;
  notes?: string;
  createdAt: string;
  updatedAt: string;
}
```

Storage: `work-orders/<wsId>.json` (same pattern as other stores)

CRUD functions: `createWorkOrder()`, `updateWorkOrder()`, `listWorkOrders()`, `getWorkOrder()`

**Verification**: `npx tsc --noEmit` passes

---

### Task 3.2 — Create Work Order on Stripe Webhook [#30] [#43]
**Time**: 30m
**File**: `server/stripe.ts` — inside `handleWebhookEvent()`

**What to do**:
1. In the `checkout.session.completed` handler, after updating the PaymentRecord:
2. If the product is a fix type (`fix_*` or `schema_*`), create a WorkOrder:
   ```typescript
   if (productType.startsWith('fix_') || productType.startsWith('schema_')) {
     createWorkOrder(workspaceId, {
       paymentId: payment.id,
       productType,
       status: 'pending',
       pageIds: metadata.pageIds ? JSON.parse(metadata.pageIds) : [],
       issueChecks: metadata.issueChecks ? JSON.parse(metadata.issueChecks) : [],
       quantity: parseInt(metadata.quantity || '1'),
     });
   }
   ```
3. For cart checkouts (multiple items): create one WorkOrder per line item
4. Add email notification: `notifyTeamPaymentReceived()` — new function in `email.ts`

**Also add to `server/email.ts`**:
```typescript
export function notifyTeamPaymentReceived(opts: {
  workspaceName: string;
  workspaceId: string;
  productType: string;
  amount: string;
}): void { ... }
```

**Verification**: Complete a cart checkout (test mode) → check `work-orders/<wsId>.json` → work order exists with status `pending`

---

### Task 3.3 — Store pageIds in Cart Checkout Metadata [#32]
**Time**: 20m
**Files**: `src/components/client/useCart.tsx`, `src/components/client/SeoCart.tsx`, `server/stripe.ts`

**What to do**:
1. `CartItem` already has `pageIds`. When building the checkout request, include `pageIds` in the Stripe session metadata
2. In `createCartCheckoutSession()`: pass `pageIds` through to the metadata (JSON-stringified)
3. This ensures the webhook handler (Task 3.2) can populate `WorkOrder.pageIds`

**Verification**: Add a meta fix to cart with specific pages → checkout → work order has those pageIds

---

### Task 3.4 — Admin Work Order Visibility [#35]
**Time**: 30m
**Files**: `src/components/WorkspaceOverview.tsx`, `src/components/WorkspaceHome.tsx`, `server/index.ts`

**What to do**:
1. Add API endpoints:
   - `GET /api/work-orders/:workspaceId` → list work orders
   - `PATCH /api/work-orders/:workspaceId/:orderId` → update status/notes
2. In `WorkspaceOverview.tsx` (Command Center): Add attention item "X purchased fixes awaiting fulfillment" when any workspace has pending work orders
3. In `WorkspaceHome.tsx`: Add action item card with count of pending work orders, linking to a work order list

**Verification**: Complete a cart checkout → Command Center shows "1 purchased fix awaiting fulfillment"

---

### Task 3.5 — Client Order Tracking View [#31]
**Time**: 40m
**File**: `src/components/client/OrderStatus.tsx` (new file)

**What to do**:
1. Create a client-facing order tracking component
2. Fetch from `GET /api/public/work-orders/:workspaceId` (new public endpoint)
3. Show each order with: product name, status (pending/in progress/completed), affected pages, purchase date, completion date
4. Status progression: `Pending → In Progress → Completed` with visual stepper
5. Link this from the SeoCart "Order History" section and from client OverviewTab action banners

**Verification**: Complete checkout → navigate to orders → see "Meta Fix — Pending" with page list

---

### Task 3.6 — Admin Completes Work Order → Updates Everything [#44]
**Time**: 25m
**File**: `server/index.ts`

**What to do**:
1. In the `PATCH /api/work-orders/:workspaceId/:orderId` endpoint:
2. When status changes to `completed`:
   - For each `pageId` in the work order: `updatePageState(wsId, pageId, { status: 'live', source: 'cart-fix', workOrderId: order.id })`
   - Log activity: `addActivity(wsId, 'fix_completed', ...)`
   - Email client: `notifyClientFixesApplied()` (new email function)
3. Add `notifyClientFixesApplied()` to `server/email.ts`

**Verification**: Mark work order complete → client sees "Fixes Applied" email → pages show "Live" status

---

## Sprint 4: Recommendations Unification (~2h)
**Theme**: Eliminate the duplicate recommendation systems. Wire server engine to client UI.
**Resolves**: [#47] [#48] [#49]
**Depends on**: Sprint 0

### Task 4.1 — FixRecommendations Consumes Server Engine [#47]
**Time**: 45m
**File**: `src/components/client/FixRecommendations.tsx`

**What to do**:
1. Instead of building categories from raw audit data, fetch from `/api/public/recommendations/:workspaceId`
2. Group server recommendations by `type` (technical, metadata, schema, accessibility, etc.)
3. Use the server's `impactScore`, `priority`, and `productType` for display and cart integration
4. Keep the existing UI layout but populate from server data
5. Show `status` from server (pending/in_progress/completed/dismissed) — already-addressed recs are dimmed

**Verification**: Generate recommendations on server → open client fix recommendations → see traffic-weighted, prioritized recs

---

### Task 4.2 — Recommendation Completion → Update PageEditState [#48]
**Time**: 20m
**File**: `server/recommendations.ts`, `server/index.ts`

**What to do**:
1. In `updateRecommendationStatus()`: when status changes to `completed`:
   - For each page in `rec.affectedPages`: `updatePageState(wsId, pageId, { status: 'live' })`
2. In the `PATCH /api/public/recommendations/:workspaceId/:recId` endpoint: import and call the updated function

**Verification**: Mark a recommendation as completed → affected pages show "Live" in admin tools

---

### Task 4.3 — Auto-Audit → Auto-Regenerate Recommendations [#49]
**Time**: 20m
**File**: `server/index.ts` — inside the `seo-audit` job completion handler

**What to do**:
1. After audit job completes and snapshot is saved:
   ```typescript
   // Auto-regenerate recommendations after audit
   try {
     await generateRecommendations(wsId);
     console.log(`[audit] Auto-regenerated recommendations for ${wsId}`);
   } catch (err) {
     console.error('[audit] Failed to regenerate recommendations:', err);
   }
   ```
2. This ensures recommendations are always in sync with the latest audit data

**Verification**: Run audit → check recommendations → they reflect the latest audit issues

---

### Task 4.4 — Churn Signals → Admin Email + Action Items
**Time**: 20m
**Files**: `server/churn-signals.ts`, `server/email.ts`, `src/components/WorkspaceHome.tsx`

**What to do**:
1. In `runChurnCheck()`: after adding critical signals, send email notification to admin
2. Add `notifyTeamChurnSignal()` to `email.ts`
3. In `WorkspaceHome.tsx`: fetch churn signals for this workspace, show critical ones as action items

**Verification**: Trigger a churn signal (e.g., set a workspace's last login to 15 days ago) → admin gets email → WorkspaceHome shows alert

---

## Sprint 5: Cross-Tool Polish (~2h)
**Theme**: Tie everything together. Both dashboards show the complete picture.
**Resolves**: [#1] [#2] [#3] [#4] [#20] [#21] [#23] [#24] [#34] [#39] [#40] [#41] [#42] [#45] [#46]
**Depends on**: Sprints 0-4

### Task 5.1 — WorkspaceHome SEO Status Summary [#1] [#2]
**Time**: 25m
**File**: `src/components/WorkspaceHome.tsx`

**What to do**:
1. Use `usePageEditStates(workspaceId)` to get summary
2. Add a "SEO Work Status" section card showing:
   - "X pages with issues" (amber) — clickable → navigates to audit
   - "X in review" (purple) — clickable → shows which pages
   - "X approved — ready to push" (green) — clickable → shows approved pages with "Apply All" button
   - "X rejected — needs revision" (red) — clickable → shows pages with client notes
3. This becomes a primary action driver for the admin

**Verification**: Have pages in various states → WorkspaceHome shows accurate counts → clicking navigates correctly

---

### Task 5.2 — Activity Feed for Client Actions [#3]
**Time**: 20m
**File**: `server/index.ts` — approval endpoints

**What to do**:
1. In every client-facing approval/request action endpoint, add `addActivity()` calls:
   - Client approves: `addActivity(wsId, 'client_approved', ...)`
   - Client rejects: `addActivity(wsId, 'client_rejected', ...)`
   - Client edits proposed value: `addActivity(wsId, 'client_edited', ...)`
   - Client purchases fixes: `addActivity(wsId, 'client_purchased', ...)`
2. Include client actor info from `getClientActor(req, workspaceId)`

**Verification**: Approve an item as client → admin activity feed shows "Client approved meta title change on /about"

---

### Task 5.3 — Approval Context / Reason Field [#20]
**Time**: 20m
**Files**: `server/approvals.ts`, `SeoEditor.tsx`, `CmsEditor.tsx`, `SchemaSuggester.tsx`, `SeoAudit.tsx`

**What to do**:
1. Add `reason?: string` to the `ApprovalItem` interface
2. When creating approval items from audit: populate `reason` with the audit issue message + recommendation
3. When creating from editors: populate `reason` with a generic "SEO optimization" or allow admin to add context
4. In `ApprovalsTab.tsx`: display `reason` below the current/proposed values in an info box

**Verification**: Send an approval from audit → client sees "Why: Your meta description is only 45 characters. Google recommends 150-160 characters for optimal display."

---

### Task 5.4 — Apply Approved Changes Copy [#21]
**Time**: 10m
**File**: `src/components/client/ApprovalsTab.tsx`

**What to do**:
1. Rename "Push Approved Changes Live" to "Apply to Website"
2. Add confirmation dialog: "This will update your live website with the approved changes. Continue?"

**Verification**: Visual check — button text and dialog are clear

---

### Task 5.5 — Command Center SEO Work Status [#34]
**Time**: 20m
**File**: `src/components/WorkspaceOverview.tsx`

**What to do**:
1. For each workspace card, fetch page state summary
2. Show compact status pills: `3 issues · 2 in review · 1 approved`
3. Add to "Needs Attention" section: workspaces with rejected items or unfulfilled work orders

**Verification**: Open Command Center → workspace cards show SEO status → attention items include rejected work

---

### Task 5.6 — Request pageId Linkage [#41] [#42]
**Time**: 15m
**Files**: `server/requests.ts`, `src/components/SeoAudit.tsx`

**What to do**:
1. Ensure the `ClientRequest` interface has a structured `pageId` field (not just text in description)
2. When audit "Flag for Client" creates a request (any remaining cases after Task 1.5), populate `pageId`
3. When request is completed: if `pageId` exists, optionally update page state

**Verification**: Flag an issue → request has `pageId` → completing it updates page state

---

### Task 5.7 — Prospect → Onboard CTA [#40]
**Time**: 15m
**File**: `src/components/SalesReport.tsx`

**What to do**:
1. Add "Onboard as Client" button on each completed sales report
2. On click: navigate to workspace creation with site URL pre-filled
3. If the report has a domain, pre-fill the workspace name from it

**Verification**: Generate sales report → click "Onboard" → workspace creation form has URL pre-filled

---

### Task 5.8 — Missing Email Notifications [#45] [#46]
**Time**: 15m
**File**: `server/email.ts`, `server/index.ts`

**What to do**:
1. Add `notifyClientRecommendationsReady()` — called after recommendation generation (optional, only if workspace has email)
2. Add `notifyClientAuditImproved()` — called when audit score increases vs previous snapshot
3. Wire into the audit job completion handler (check current vs previous score)

**Verification**: Run audit that improves score → client gets "Your site health improved!" email

---

## Sprint Order & Dependencies

```
Sprint 0: Foundation ──────────────┐
  (PageEditState, StatusBadge,     │
   usePageEditStates, API)         │
                                   │
         ┌─────────────────────────┼──────────────────────────┐
         │                         │                          │
    Sprint 1              Sprint 2              Sprint 3
    SEO Edit Pipeline     Content Pipeline      Self-Service
    (3h)                  (2.5h)                Fulfillment
         │                         │            (3h)
         │                         │                          │
         └─────────────────────────┼──────────────────────────┘
                                   │
                            Sprint 4
                            Recommendations
                            (2h)
                                   │
                            Sprint 5
                            Cross-Tool Polish
                            (2h)
```

**Sprints 1, 2, and 3 can be worked in parallel** after Sprint 0 is complete.
Sprint 4 depends on Sprint 0 only.
Sprint 5 depends on all previous sprints.

---

## Testing Checklist

After all sprints, verify these end-to-end scenarios:

### SEO Edit Pipeline
- [ ] Run audit → pages with issues show "Issue Detected" in all admin tools
- [ ] Fix from audit via "Send for Review" → client sees grouped page card with context
- [ ] Fix from audit via "Apply Now" → page shows "Live" immediately
- [ ] Edit in SeoEditor → page state updates → visible in CmsEditor, Audit, Schema
- [ ] Client approves → admin sees "Approved" badge → "Apply to Website" works
- [ ] Client rejects with note → admin sees "Rejected" badge with note
- [ ] Apply to Webflow → all tools show "Live" → next audit clears to "Clean" or "Issue Detected"

### Content Pipeline
- [ ] Strategy → "Order Brief" → content request created with targetPageId
- [ ] Brief generated → client reviews → approves → admin delivers
- [ ] Mark as "Published" → page state updated → ROI tracks value
- [ ] Strategy tab shows "Brief Ordered" / "In Progress" / "Delivered" per keyword

### Self-Service Fixes
- [ ] Client adds fixes to cart with specific pages → checkout via Stripe
- [ ] Payment succeeds → work order created → admin sees in Command Center
- [ ] Admin marks fix complete → client sees "Completed" → page state = "Live"
- [ ] Client can view order history with status progression

### Recommendations
- [ ] Client fix recommendations come from server engine (traffic-weighted)
- [ ] Completing a recommendation updates affected page states
- [ ] Auto-audit auto-regenerates recommendations

### Cross-Tool Visibility
- [ ] Command Center: per-workspace health + SEO work status + unfulfilled orders + content pipeline
- [ ] WorkspaceHome: action items for approved/rejected/purchased items
- [ ] Client Overview: banners for pending reviews, delivered content, applied changes
- [ ] Activity feed shows client approval/rejection/purchase events

---

## Risk Notes

1. **Migration**: Sprint 0 adds `pageEditStates` alongside existing `seoEditTracking`. Both are maintained during transition. After all sprints are complete, `seoEditTracking` can be deprecated.

2. **Performance**: `pageEditStates` is stored on the workspace object. For sites with 500+ pages, this could grow large. If needed, move to a separate file per workspace (like approvals/payments). Not expected to be an issue for typical Webflow sites (10-100 pages).

3. **Race conditions**: Multiple admin tools can update page state simultaneously. `updatePageState()` uses read-modify-write on the workspace JSON. For a single-user deployment, this is fine. If multi-user becomes critical, consider a write lock or move to a proper DB.

4. **Backward compatibility**: All new fields are optional. Existing API consumers continue to work. The `usePageEditStates()` hook falls back gracefully if `pageEditStates` is empty.

---

## Relationship to Other Documents

| Document | Relationship |
|----------|-------------|
| [PLATFORM_AUDIT.md](./PLATFORM_AUDIT.md) | Source of all 49 issues this roadmap resolves |
| [SEO_DATA_FLOW.md](./SEO_DATA_FLOW.md) | Data store map and flow diagrams |
| [PRODUCT_ROADMAP.md](./PRODUCT_ROADMAP.md) | Client-facing roadmap (this work is internal infrastructure) |
| [FEATURE_VISION.md](./FEATURE_VISION.md) | Items #1 (auto-publish) and #10 (change tracking) build directly on this foundation |
| [FEATURE_AUDIT.md](./FEATURE_AUDIT.md) | Feature value assessments (this work increases the value of existing features by connecting them) |

---

*This roadmap is a living document. Update task statuses as work progresses. Each sprint should end with a commit and deploy.*
