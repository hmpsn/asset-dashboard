# PR 1.4 — Send-to-Client Optional-Note Convention

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Establish the optional-note UI pattern on all admin "Send to client" surfaces, storing notes in the backend for PR 1.2 routing.

**Architecture:** Backend migration + API schema updates for both client_actions and approval_batches. UI note state + textarea in each component. No client-side routing changes (that's PR 1.2).

**Tech Stack:** TypeScript / React 19 / Vitest / SQLite

**Spec:** `docs/superpowers/specs/2026-05-10-pr-1-4-send-to-client-convention-design.md`

**Worktree:** `/Users/joshuahampson/CascadeProjects/asset-dashboard/.claude/worktrees/send-to-client-convention/`

---

## File Map

### New files
- `server/db/migrations/093-approval-batch-note.sql`

### Modify — Shared Types (1)
- `shared/types/approvals.ts` — add `note?: string` to `ApprovalBatch`

### Modify — Server (3)
- `server/approvals.ts` — `createBatch()` accepts note; `rowToBatch()` maps it
- `server/routes/approvals.ts` — `createBatchSchema` accepts note
- `server/routes/client-actions.ts` — `createActionSchema` accepts clientNote; `createClientAction()` stores it

### Modify — Frontend API (2)
- `src/api/clientActions.ts` — `create()` accepts `clientNote?: string`
- `src/api/approvals.ts` — `createBatch()` accepts `note?: string`

### Modify — client_action UI components (4)
- `src/components/AeoReview.tsx`
- `src/components/ContentDecay.tsx`
- `src/components/InternalLinks.tsx`
- `src/components/RedirectManager.tsx`

### Modify — AuditIssueRow collapse (2)
- `src/components/audit/AuditIssueRow.tsx`
- `src/components/SeoAudit.tsx`

### Modify — Schema sender chain (3)
- `src/components/SchemaSuggester.tsx`
- `src/components/schema/BulkPublishPanel.tsx`
- `src/components/schema/SchemaPageCard.tsx`

---

## Task 1: Backend foundation

**Model:** Haiku

**Files:**
- Create: `server/db/migrations/093-approval-batch-note.sql`
- Modify: `shared/types/approvals.ts`
- Modify: `server/approvals.ts`
- Modify: `server/routes/approvals.ts`
- Modify: `server/routes/client-actions.ts`
- Modify: `server/client-actions.ts`

> **Context:** This codebase uses prepared statements via `createStmtCache()`/`stmts()` — never bare `let stmt`. Row mappers are `rowToX()` functions. Validation uses Zod via `validate()` middleware. The `client_actions` table already has `client_note TEXT` column (migration 083) but the POST endpoint's `createActionSchema` uses `.strict()` and doesn't accept it. The `approval_batches` table has no note column — needs migration. `createBatch()` is in `server/approvals.ts`; `rowToBatch()` maps DB rows to typed objects.

### Step 1: Create migration

- [ ] **Step 1a: Write `server/db/migrations/093-approval-batch-note.sql`**

```sql
-- 093-approval-batch-note.sql
-- Add optional note column to approval_batches for the Phase 1 send-to-client convention.
-- When present, the note converts a Decisions batch into a Conversations batch (PR 1.2 routing).
ALTER TABLE approval_batches ADD COLUMN note TEXT;
```

### Step 2: Update shared types

- [ ] **Step 2a: Read `shared/types/approvals.ts` (the `ApprovalBatch` interface)**

Find the `ApprovalBatch` interface. It currently ends with `updatedAt: string`. Add `note?: string` after `status`:

BEFORE (the interface, roughly):
```typescript
export interface ApprovalBatch {
  id: string;
  workspaceId: string;
  siteId: string;
  name: string;
  items: ApprovalItem[];
  status: 'pending' | 'partial' | 'approved' | 'rejected' | 'applied';
  createdAt: string;
  updatedAt: string;
}
```

AFTER:
```typescript
export interface ApprovalBatch {
  id: string;
  workspaceId: string;
  siteId: string;
  name: string;
  items: ApprovalItem[];
  status: 'pending' | 'partial' | 'approved' | 'rejected' | 'applied';
  /** Admin note attached at send-time. When present, signals client Conversations routing (PR 1.2). */
  note?: string;
  createdAt: string;
  updatedAt: string;
}
```

- [ ] **Step 2b: Run typecheck**

```bash
cd /Users/joshuahampson/CascadeProjects/asset-dashboard/.claude/worktrees/send-to-client-convention && npm run typecheck 2>&1 | tail -5
```

Expected: zero errors (adding optional field is non-breaking).

### Step 3: Update `server/approvals.ts`

Read the file first, then:

- [ ] **Step 3a: Update `rowToBatch()` to map `note`**

Find `rowToBatch()`. It constructs an `ApprovalBatch` from a DB row. Add `note: row.note ?? undefined` to the returned object.

- [ ] **Step 3b: Update `createBatch()` to accept and store `note`**

The function signature currently is:
```typescript
export function createBatch(
  workspaceId: string,
  siteId: string,
  name: string,
  items: Omit<ApprovalItem, 'id' | 'status' | 'createdAt' | 'updatedAt'>[]
): ApprovalBatch
```

Change to:
```typescript
export function createBatch(
  workspaceId: string,
  siteId: string,
  name: string,
  items: Omit<ApprovalItem, 'id' | 'status' | 'createdAt' | 'updatedAt'>[],
  note?: string
): ApprovalBatch
```

Inside the function, find the INSERT statement. Add `note` column to the insert (alongside `id`, `workspace_id`, etc.). Pass `note: note ?? null` to the prepared statement.

- [ ] **Step 3c: Typecheck**

```bash
cd /Users/joshuahampson/CascadeProjects/asset-dashboard/.claude/worktrees/send-to-client-convention && npm run typecheck 2>&1 | tail -5
```

### Step 4: Update route schemas

- [ ] **Step 4a: Update `server/routes/approvals.ts` — add `note` to `createBatchSchema`**

Find `createBatchSchema`. Add:
```typescript
note: z.string().max(2000).optional(),
```

Find the route handler that calls `createBatch()`. Pass `note: req.body.note` as the 5th argument.

- [ ] **Step 4b: Update `server/routes/client-actions.ts` — add `clientNote` to `createActionSchema`**

Find `createActionSchema` (the schema for the POST endpoint, currently `.strict()`). Add:
```typescript
clientNote: z.string().max(2000).optional(),
```

Find `createClientAction()` call in the route handler. Update the call to pass `clientNote: req.body.clientNote`.

- [ ] **Step 4c: Update `server/client-actions.ts` — update `CreateClientActionInput` + `createClientAction()`**

Find `CreateClientActionInput` interface. Add:
```typescript
clientNote?: string;
```

Find `createClientAction()`. It currently passes `client_note: null`. Change to:
```typescript
client_note: input.clientNote ?? null,
```

- [ ] **Step 4d: Final typecheck**

```bash
cd /Users/joshuahampson/CascadeProjects/asset-dashboard/.claude/worktrees/send-to-client-convention && npm run typecheck 2>&1 | tail -5
```

Expected: zero errors.

### Step 5: Run tests + pr-check

- [ ] **Step 5a: Run full test suite**

```bash
cd /Users/joshuahampson/CascadeProjects/asset-dashboard/.claude/worktrees/send-to-client-convention && npx vitest run 2>&1 | tail -15
```

Expected: all tests pass. If approval_batch or client-action integration tests fail because they're strict about accepted fields, update the test fixtures.

- [ ] **Step 5b: pr-check**

```bash
cd /Users/joshuahampson/CascadeProjects/asset-dashboard/.claude/worktrees/send-to-client-convention && npx tsx scripts/pr-check.ts 2>&1 | grep -E "error|Error|✗" | head -10
```

Expected: 0 errors.

### Step 6: Commit

```bash
cd /Users/joshuahampson/CascadeProjects/asset-dashboard/.claude/worktrees/send-to-client-convention
git add server/db/migrations/093-approval-batch-note.sql shared/types/approvals.ts server/approvals.ts server/routes/approvals.ts server/routes/client-actions.ts server/client-actions.ts
git commit -m "feat: backend foundation for send-to-client note convention (migration 093, API schema updates)"
```

---

## Task 2: Frontend API wrappers

**Model:** Haiku

**Files:**
- Modify: `src/api/clientActions.ts`
- Modify: `src/api/approvals.ts`

> **Context:** These are typed fetch wrappers. No raw `fetch()` in components — only these wrappers. Read each file fully before editing to understand the existing call signatures.

- [ ] **Step 1: Read `src/api/clientActions.ts`**

Find the `create()` function (or `createClientAction()` wrapper). It currently sends a POST with `sourceType`, `sourceId`, `title`, `summary`, `payload`, `priority`. Add `clientNote?: string` to the parameter type and include `clientNote` in the request body (only if provided — use `...(clientNote ? { clientNote } : {})` or just always include it).

- [ ] **Step 2: Read `src/api/approvals.ts`**

Find the function that calls `POST /api/approvals/:workspaceId`. Add `note?: string` to its parameter and include `note` in the request body.

- [ ] **Step 3: Typecheck**

```bash
cd /Users/joshuahampson/CascadeProjects/asset-dashboard/.claude/worktrees/send-to-client-convention && npm run typecheck 2>&1 | tail -5
```

Expected: zero errors.

- [ ] **Step 4: Commit**

```bash
cd /Users/joshuahampson/CascadeProjects/asset-dashboard/.claude/worktrees/send-to-client-convention
git add src/api/clientActions.ts src/api/approvals.ts
git commit -m "feat: frontend API wrappers accept optional note for send-to-client convention"
```

---

## Task 3: client_action UI components

**Model:** Haiku

**Files:**
- Modify: `src/components/AeoReview.tsx`
- Modify: `src/components/ContentDecay.tsx`
- Modify: `src/components/InternalLinks.tsx`
- Modify: `src/components/RedirectManager.tsx`

> **Context:** Each component has a "Send to client" button. The pattern to add:
> 1. `useState<string>('')` for the note value
> 2. A compact `<textarea>` below the send button — renders only when item has NOT been sent yet
> 3. Pass `clientNote: note.trim() || undefined` to the `clientActions.create()` call
>
> Note state scope:
> - **AeoReview + ContentDecay**: Per-page note (each page has its own send button and its own `sendingPage` / `sentPages` tracking). Use a `Record<string, string>` or `Map<pageUrl, note>` keyed by the page identifier.
> - **InternalLinks + RedirectManager**: Single-send (one button for the whole component). A single `const [note, setNote] = useState('')` is sufficient.
>
> Textarea class string to use:
> ```
> mt-2 w-full rounded-[var(--radius-md)] border border-[var(--brand-border)] bg-[var(--surface-2)] px-3 py-2 t-caption text-[var(--brand-text)] placeholder:text-[var(--brand-text-muted)] resize-none focus:outline-none focus:border-[var(--brand-border-hover)]
> ```
> Placeholder: `"Add a note for your client (optional)"` — helper text "turns this into a conversation" is Phase 1.2 concern.
> `rows={2}`
>
> Read each file fully before editing. Check existing imports at the top before adding any new ones.

### AeoReview.tsx

- [ ] **Step 1: Add per-page note state**

Find where other state is declared (near `sendingPage`, `sentPages`). Add:
```typescript
const [pageNotes, setPageNotes] = useState<Record<string, string>>({});
```

- [ ] **Step 2: Update `sendPageToClient()` to pass the note**

Find `clientActions.create(workspaceId, { ... })` call. Add `clientNote: pageNotes[page.pageUrl]?.trim() || undefined` to the options object.

- [ ] **Step 3: Add textarea UI**

Find each page's "Send to client" button render. After the button, add the textarea, rendered only when the page hasn't been sent yet:
```tsx
{!sentPages.has(page.pageUrl) && !sendingPage && (
  <textarea
    rows={2}
    placeholder="Add a note for your client (optional)"
    value={pageNotes[page.pageUrl] ?? ''}
    onChange={e => setPageNotes(prev => ({ ...prev, [page.pageUrl]: e.target.value }))}
    className="mt-2 w-full rounded-[var(--radius-md)] border border-[var(--brand-border)] bg-[var(--surface-2)] px-3 py-2 t-caption text-[var(--brand-text)] placeholder:text-[var(--brand-text-muted)] resize-none focus:outline-none focus:border-[var(--brand-border-hover)]"
  />
)}
```

- [ ] **Step 4: Typecheck**

```bash
cd /Users/joshuahampson/CascadeProjects/asset-dashboard/.claude/worktrees/send-to-client-convention && npm run typecheck 2>&1 | tail -5
```

### ContentDecay.tsx

Same pattern as AeoReview — per-page note keyed by `page.page` (the page URL/slug). Add `pageNotes` state, update `sendPageToClient()`, add textarea UI.

- [ ] **Step 5: Apply same pattern to ContentDecay.tsx** (note state + send update + textarea UI)

- [ ] **Step 6: Typecheck**

```bash
cd /Users/joshuahampson/CascadeProjects/asset-dashboard/.claude/worktrees/send-to-client-convention && npm run typecheck 2>&1 | tail -5
```

### InternalLinks.tsx

Single send — one note for the whole component.

- [ ] **Step 7: Add single note state to InternalLinks.tsx**

```typescript
const [note, setNote] = useState('');
```

- [ ] **Step 8: Pass note to `sendSuggestionsToClient()`**

In `clientActions.create()` call, add `clientNote: note.trim() || undefined`.

- [ ] **Step 9: Add textarea UI below the send button**

Render the textarea when `!sentToClient && !sendingToClient`.

- [ ] **Step 10: Typecheck**

```bash
cd /Users/joshuahampson/CascadeProjects/asset-dashboard/.claude/worktrees/send-to-client-convention && npm run typecheck 2>&1 | tail -5
```

### RedirectManager.tsx

Same as InternalLinks — single send.

- [ ] **Step 11: Apply same pattern to RedirectManager.tsx** (single note state + send update + textarea UI)

- [ ] **Step 12: Typecheck**

```bash
cd /Users/joshuahampson/CascadeProjects/asset-dashboard/.claude/worktrees/send-to-client-convention && npm run typecheck 2>&1 | tail -5
```

### Step 13: Run tests

```bash
cd /Users/joshuahampson/CascadeProjects/asset-dashboard/.claude/worktrees/send-to-client-convention && npx vitest run 2>&1 | tail -10
```

### Step 14: Commit

```bash
cd /Users/joshuahampson/CascadeProjects/asset-dashboard/.claude/worktrees/send-to-client-convention
git add src/components/AeoReview.tsx src/components/ContentDecay.tsx src/components/InternalLinks.tsx src/components/RedirectManager.tsx
git commit -m "feat: add optional note UI to client_action send-to-client components"
```

---

## Task 4: AuditIssueRow + SeoAudit — button collapse

**Model:** Haiku

**Files:**
- Modify: `src/components/audit/AuditIssueRow.tsx`
- Modify: `src/components/SeoAudit.tsx`

> **Context:** `AuditIssueRow` currently has TWO send paths:
> - "Send for Review" button (line ~135) — creates an approval_batch WITHOUT a note
> - "Flag for Client" in the overflow menu (line ~304) — expands an inline note field; calls `onFlagForClient(page, issue, flagNote)`
>
> `SeoAudit.tsx` implements `onFlagForClient` — it creates the approval_batch with the note concatenated into `proposedValue`.
>
> **Goal:** Remove the "Send for Review" button (the note-less path). The "Flag for Client" mechanism becomes the only path, renamed to "Send to client". The inline note field remains exactly as-is (it already works and the note is stored via existing concatenation).
>
> After this change: clicking "Send to client" expands the note field; submitting sends with the note. This is the single unified path.
>
> Read both files in full before editing.

- [ ] **Step 1: Read `src/components/audit/AuditIssueRow.tsx`**

Identify:
- The "Send for Review" button and its onClick handler (around line 135)
- The overflow menu "Flag for Client" item (around line 304)
- The inline note field (around lines 166-189)
- The `onSendForReview` and `onFlagForClient` props in the component's prop interface

- [ ] **Step 2: Remove "Send for Review" button from AuditIssueRow**

Delete the "Send for Review" `<button>` element (and its associated state management if any — e.g. `isSending` state specific to that button).

Remove `onSendForReview` from the prop interface (if it exists as a separate prop from `onFlagForClient`).

Rename the overflow "Flag for Client" label to "Send to client".

- [ ] **Step 3: Read `src/components/SeoAudit.tsx`**

Identify:
- Where `onSendForReview` prop is passed to AuditIssueRow (if any)
- The `flagForClient` handler (lines ~190-222)

- [ ] **Step 4: Update SeoAudit.tsx**

Remove any `onSendForReview` prop pass-through to AuditIssueRow (since we removed that button).

If `SeoAudit.tsx` also renders a "Send for Review" button at the page level (separate from AuditIssueRow's per-issue button), collapse it to use the same `flagForClient` flow.

- [ ] **Step 5: Typecheck**

```bash
cd /Users/joshuahampson/CascadeProjects/asset-dashboard/.claude/worktrees/send-to-client-convention && npm run typecheck 2>&1 | tail -5
```

Expected: zero errors. If `onSendForReview` was removed from props, any callers passing it will get a TypeScript error — remove those prop usages too.

- [ ] **Step 6: Run tests**

```bash
cd /Users/joshuahampson/CascadeProjects/asset-dashboard/.claude/worktrees/send-to-client-convention && npx vitest run 2>&1 | tail -10
```

Expected: all pass.

- [ ] **Step 7: Commit**

```bash
cd /Users/joshuahampson/CascadeProjects/asset-dashboard/.claude/worktrees/send-to-client-convention
git add src/components/audit/AuditIssueRow.tsx src/components/SeoAudit.tsx
git commit -m "feat: collapse AuditIssueRow double-button to single 'Send to client' with optional note"
```

---

## Task 5: Schema sender chain

**Model:** Sonnet

**Files:**
- Modify: `src/components/SchemaSuggester.tsx`
- Modify: `src/components/schema/BulkPublishPanel.tsx`
- Modify: `src/components/schema/SchemaPageCard.tsx`

> **Context:**
> - `SchemaSuggester.tsx` is the parent. It passes two callbacks to schema child components:
>   - `onSendToClient={sendSchemasToClient}` → BulkPublishPanel (bulk send)
>   - `onSendToClient={sendSingleSchemaToClient}` → SchemaPageCard (per-page send)
> - Both `sendSchemasToClient` and `sendSingleSchemaToClient` call `POST /api/approvals/${workspaceId}` to create an approval_batch.
> - After Task 1, the POST endpoint accepts an optional `note` field.
>
> **Approach:**
> 1. Add note state inside BulkPublishPanel and SchemaPageCard (each manages its own note)
> 2. Update `onSendToClient` callback type to accept `note?: string` in both components
> 3. Update `sendSchemasToClient` and `sendSingleSchemaToClient` in SchemaSuggester to accept and pass `note` to the API call
>
> Read all three files before editing.

- [ ] **Step 1: Read all three files**

Read `src/components/SchemaSuggester.tsx`, `src/components/schema/BulkPublishPanel.tsx`, `src/components/schema/SchemaPageCard.tsx`.

Identify:
- The `onSendToClient` prop interface in BulkPublishPanel (current type: `() => void` or similar)
- The `onSendToClient` prop interface in SchemaPageCard (current type: `(suggestion: SchemaPageSuggestion) => void` or similar)
- The `sendSchemasToClient` function body in SchemaSuggester (finds the API call with `siteId`, `name`, `items`)
- The `sendSingleSchemaToClient` function body in SchemaSuggester

- [ ] **Step 2: Update BulkPublishPanel**

Update the prop type:
```typescript
// Before:
onSendToClient: () => void;
// After:
onSendToClient: (note?: string) => void;
```

Add note state:
```typescript
const [note, setNote] = useState('');
```

Call `onSendToClient(note.trim() || undefined)` when the send button is clicked.

Add textarea UI below the send button (renders when not yet sent):
```tsx
{!sentToClient && (
  <textarea
    rows={2}
    placeholder="Add a note for your client (optional)"
    value={note}
    onChange={e => setNote(e.target.value)}
    className="mt-2 w-full rounded-[var(--radius-md)] border border-[var(--brand-border)] bg-[var(--surface-2)] px-3 py-2 t-caption text-[var(--brand-text)] placeholder:text-[var(--brand-text-muted)] resize-none focus:outline-none focus:border-[var(--brand-border-hover)]"
  />
)}
```

- [ ] **Step 3: Update SchemaPageCard**

Same pattern — update `onSendToClient` prop type to pass `note?: string` as a second parameter:
```typescript
// Before:
onSendToClient: (suggestion: SchemaPageSuggestion) => void;
// After:
onSendToClient: (suggestion: SchemaPageSuggestion, note?: string) => void;
```

Add note state, textarea UI, and pass note on click.

- [ ] **Step 4: Update SchemaSuggester.tsx**

Update `sendSchemasToClient` to accept `note?: string` and pass it to the API:
```typescript
const sendSchemasToClient = async (note?: string) => {
  // ...existing body...
  await approvals.createBatch(workspaceId, { siteId, name, items, note });
  // ...
};
```

Same for `sendSingleSchemaToClient`.

Update the `onSendToClient` prop pass-throughs to BulkPublishPanel and SchemaPageCard to match the new signatures.

- [ ] **Step 5: Typecheck**

```bash
cd /Users/joshuahampson/CascadeProjects/asset-dashboard/.claude/worktrees/send-to-client-convention && npm run typecheck 2>&1 | tail -5
```

Expected: zero errors.

- [ ] **Step 6: Run full test suite**

```bash
cd /Users/joshuahampson/CascadeProjects/asset-dashboard/.claude/worktrees/send-to-client-convention && npx vitest run 2>&1 | tail -10
```

- [ ] **Step 7: pr-check**

```bash
cd /Users/joshuahampson/CascadeProjects/asset-dashboard/.claude/worktrees/send-to-client-convention && npx tsx scripts/pr-check.ts 2>&1 | grep -E "error|✗" | head -10
```

- [ ] **Step 8: Build**

```bash
cd /Users/joshuahampson/CascadeProjects/asset-dashboard/.claude/worktrees/send-to-client-convention && npx vite build 2>&1 | tail -5
```

- [ ] **Step 9: Commit**

```bash
cd /Users/joshuahampson/CascadeProjects/asset-dashboard/.claude/worktrees/send-to-client-convention
git add src/components/SchemaSuggester.tsx src/components/schema/BulkPublishPanel.tsx src/components/schema/SchemaPageCard.tsx
git commit -m "feat: add optional note threading to schema sender chain (SchemaSuggester + panels)"
```

---

## Final Verification

After all tasks committed:

```bash
cd /Users/joshuahampson/CascadeProjects/asset-dashboard/.claude/worktrees/send-to-client-convention && npm run typecheck && npx vite build && npx vitest run && npx tsx scripts/pr-check.ts
```

Expected: typecheck zero errors, build clean, all tests pass, pr-check 0 errors (1 pre-existing PageHeader warning OK).
