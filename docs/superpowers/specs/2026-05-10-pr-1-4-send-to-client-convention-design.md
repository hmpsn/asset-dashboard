# PR 1.4 — Platform "Send to Client" Optional-Note Convention

**Date:** 2026-05-10
**PR:** feat/send-to-client-convention → staging
**Phase:** Phase 1 of Client IA Redesign
**Depends on:** PR 1.1 (merged — shared contracts on staging)
**Parallel-safe with:** PR 1.2, PR 1.3

---

## Goal

Apply a consistent "Send to client" one-button + optional-note UI pattern to all admin send surfaces. When a note is provided, it signals a Conversation intent (PR 1.2 will route it there). When no note is provided, the item routes to Decisions (the default). This PR ships the send-side convention only; client-side routing is PR 1.2.

---

## Problem

Currently there are two anti-patterns across 12 remaining admin components:

1. **No note field** — 4 client_action components + 5 approval_batch components send without any annotation. The admin has no way to attach context to the send.
2. **Double-button** — `AuditIssueRow` has "Send for Review" + "Flag for Client" (with note). This should collapse to one button.

---

## Backend Changes Required

### A. client_actions POST endpoint — accept `clientNote` at create time

**File:** `server/routes/client-actions.ts`
- `createActionSchema` currently uses `.strict()` and excludes `clientNote`
- Add `clientNote: z.string().max(2000).optional()` to the schema

**File:** `server/client-actions.ts`
- `CreateClientActionInput` interface: add `clientNote?: string`
- `createClientAction()` function: use `input.clientNote ?? null` instead of hardcoded `null`

**Why this works:** The `client_actions` table already has a `client_note TEXT` column (migration 083, line 13). The column exists; only the write path needs updating.

**No migration needed.**

### B. approval_batches — add `note` column + API support

**Migration:** `server/db/migrations/093-approval-batch-note.sql`
```sql
-- 093-approval-batch-note.sql
-- Add optional note column to approval_batches for the Phase 1 send-to-client convention.
-- The note converts a Decisions item into a Conversations item (used by PR 1.2 routing).
ALTER TABLE approval_batches ADD COLUMN note TEXT;
```

**File:** `shared/types/approvals.ts`
- `ApprovalBatch` interface: add `note?: string`

**File:** `server/approvals.ts`
- `createBatch()`: add `note?: string` parameter; write to DB
- `rowToBatch()` mapper: map `row.note` → `note` field

**File:** `server/routes/approvals.ts`
- `createBatchSchema`: add `note: z.string().max(2000).optional()`

**File:** `src/api/approvals.ts`
- Update `createBatch()` API call to accept optional `note` field

---

## UI Pattern (applied to all components)

Every admin send button follows this pattern:

```
[Current state]
  <button>Send to client</button>

[PR 1.4 state]
  <button>Send to client</button>
  [if !sent && !sending]
    <textarea
      placeholder="Add a note for your client (optional) — turns this into a conversation"
      value={note}
      onChange={e => setNote(e.target.value)}
      rows={2}
      className="mt-2 w-full rounded-[var(--radius-md)] border border-[var(--brand-border)] bg-[var(--surface-2)] px-3 py-2 t-caption text-[var(--brand-text)] placeholder:text-[var(--brand-text-muted)] resize-none focus:outline-none focus:border-[var(--brand-border-hover)]"
    />
```

The textarea renders **only before the item is sent** (hidden once `sent`). Inline, beneath the button. Compact: 2 rows, full width of the button.

---

## Component-by-Component Changes

### Group A: client_action senders (4 components)

All 4 use `clientActions.create()`. Adding a note requires:
- `useState<string>('')` for note value
- `<textarea>` beneath the button (renders when not yet sent)
- Pass `clientNote: note || undefined` to `clientActions.create()`

**Files:**
1. `src/components/AeoReview.tsx` — one note per page (AeoReview has one button per page in the review table); `sendingPage` / `sentPages` pattern already exists
2. `src/components/ContentDecay.tsx` — one note per page; `sendingPage` / `sentPages` pattern
3. `src/components/InternalLinks.tsx` — one note for the whole send (single button); `sendingToClient` / `sentToClient` boolean pattern
4. `src/components/RedirectManager.tsx` — one note for the whole send (single button); `sendingToClient` / `sentToClient` boolean pattern

**AeoReview note state:** Per-page note stored as `Map<pageUrl, note>` or as a single `noteByPage: Record<string, string>` state object.

### Group B: AuditIssueRow + SeoAudit — button collapse only

**AuditIssueRow.tsx:**
- Currently: "Send for Review" button (line 135) + "Flag for Client" in overflow (line 304) with inline note field (lines 166-189)
- Change: Remove the separate "Send for Review" button; the overflow "Flag for Client" becomes the primary button, relabeled "Send to client". The note field stays exactly as-is (already implemented and working).
- Net result: One "Send to client" button that expands an inline note field (the existing note field), same as today's "Flag for Client" but now the only send path.

**SeoAudit.tsx:**
- Mirror the button collapse in the parent component's rendering logic for AuditIssueRow

### Group C: approval_batch senders — hook-based (2 files)

**`src/components/editor/useSeoEditorApprovalWorkflow.ts`:**
- Add `note?: string` parameter to `sendPageToClient(pageId, note?)` and `sendForApproval(note?)`
- Pass `note` to the `/api/approvals/${workspaceId}` POST body

**`src/components/cms-editor/useCmsEditorApprovalWorkflow.ts`:**
- Add `note?: string` parameter to `sendForApproval(note?)`
- Pass `note` to the POST body

The calling components (SEO Editor, CMS Editor) will receive the note value from their UI and pass it through.

### Group D: Schema batch senders (3 components)

**`src/components/schema/BulkPublishPanel.tsx`:**
- Add `note` prop to the component's prop interface
- Call `onSendToClient(note)` instead of `onSendToClient()`
- Render note textarea UI

**`src/components/schema/SchemaPageCard.tsx`:**
- Add `note` state and textarea UI
- Call `onSendToClient(suggestion, note)` when sending

**`src/components/schema/SchemaPlanPanel.tsx`:**
- Has its own endpoint: `POST /api/webflow/schema-plan/${siteId}/send-to-client`
- Add `note` state and textarea UI
- Pass `note` in the API body (update the endpoint to accept it)

### Group E: Deferred (out of scope for PR 1.4)

- `src/components/brand/CopyReviewPanel.tsx` — uses a status update path, not client_action or approval_batch; routing to Reviews is a PR 1.2 concern
- `src/components/briefs/BriefDetail.tsx` — path unclear from audit; requires human confirmation

---

## Frontend API Changes

**`src/api/clientActions.ts`:**
- `create()` function: add `clientNote?: string` to the request body type and call

**`src/api/approvals.ts`:**
- `createBatch()` function (or equivalent): add `note?: string` to the request body type and call

---

## Not Included

- Client-side routing logic (note → Conversations vs no-note → Decisions): PR 1.2
- BriefDetail.tsx and CopyReviewPanel.tsx: deferred (requires human confirmation)
- SeoEditorApprovalWorkflow calling-component UI (the actual textarea in SEO Editor UI): PR 1.2 or separate follow-on (the hook API is updated here; callers can opt in)

---

## Affected Files

| File | Change |
|------|--------|
| `server/db/migrations/093-approval-batch-note.sql` | New: ADD COLUMN note TEXT to approval_batches |
| `shared/types/approvals.ts` | Add `note?: string` to ApprovalBatch |
| `server/approvals.ts` | createBatch accepts note; rowToBatch maps it |
| `server/routes/approvals.ts` | createBatchSchema accepts note |
| `shared/types/client-actions.ts` | (already updated in PR 1.1 — no changes needed) |
| `server/routes/client-actions.ts` | createActionSchema accepts clientNote |
| `server/client-actions.ts` | CreateClientActionInput + createClientAction accept clientNote |
| `src/api/clientActions.ts` | create() accepts clientNote |
| `src/api/approvals.ts` | createBatch accepts note |
| `src/components/AeoReview.tsx` | Add per-page note state + textarea UI |
| `src/components/ContentDecay.tsx` | Add per-page note state + textarea UI |
| `src/components/InternalLinks.tsx` | Add note state + textarea UI |
| `src/components/RedirectManager.tsx` | Add note state + textarea UI |
| `src/components/audit/AuditIssueRow.tsx` | Collapse double-button → single "Send to client" |
| `src/components/SeoAudit.tsx` | Mirror button collapse |
| `src/components/editor/useSeoEditorApprovalWorkflow.ts` | Add note param to send functions |
| `src/components/cms-editor/useCmsEditorApprovalWorkflow.ts` | Add note param to sendForApproval |
| `src/components/schema/BulkPublishPanel.tsx` | Add note prop + textarea UI |
| `src/components/schema/SchemaPageCard.tsx` | Add note state + textarea UI |
| `src/components/schema/SchemaPlanPanel.tsx` | Add note state + textarea + update endpoint call |
