# PR 1.0a — Retire `feedback` Table — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fully retire the `feedback` table by migrating its rows to `requests`, removing all routes/components/emails/intelligence wiring, and verifying no endpoint or UI reference remains.

**Architecture:** Pure deletion PR — no new features. Migration preserves data by inserting feedback rows into the `requests` table with `category='general'` before dropping the table. Server routes, client component, admin UI, email template, intelligence slice field, and all tests are removed in coordinated tasks ordered to keep TypeScript clean at every commit boundary.

**Tech Stack:** TypeScript / React 19 / Express / SQLite (better-sqlite3) / Vitest / React Query

---

## File Map

### Delete (6 files)
- `src/components/client/FeedbackWidget.tsx` — 341-line sidebar widget
- `server/routes/feedback.ts` — 5 admin API routes
- `server/routes/public-feedback.ts` — 3 client portal routes
- `server/feedback.ts` — CRUD module + types + DB operations
- `tests/integration/feedback-routes.test.ts` — port 13220; deleted with routes
- `tests/integration/public-feedback-broadcasts.test.ts` — broadcast tests; deleted with routes

### Create (2 files)
- `server/db/migrations/091-retire-feedback-table.sql` — data migration + table drop
- `tests/integration/feedback-retirement.test.ts` — port 13352; verifies 404 on all removed endpoints

### Modify — Server (9 files)
- `server/app.ts:57` — remove feedbackRoutes import + use
- `server/route-groups/public.ts:9,19` — remove publicFeedbackRoutes import + use
- `server/ws-events.ts:37-38` — remove FEEDBACK_NEW + FEEDBACK_UPDATE constants
- `server/email.ts:381-391` — remove `notifyTeamNewFeedback()` function
- `server/email-templates.ts:180,254-287` — remove `feedback_new` from union + case + renderer
- `server/email-throttle.ts:60` — remove `feedback_new: 'internal'` entry
- `shared/types/intelligence.ts:247` — remove `feedbackItems` from `ClientSignalsSlice`
- `server/intelligence/client-signals-slice.ts:243-247,375` — remove feedbackItems assembly
- `server/intelligence/formatters.ts:668-670` — remove feedbackItems formatter block

### Modify — Frontend (7 files)
- `src/components/client/index.ts:4` — remove FeedbackWidget export
- `src/components/ClientDashboard.tsx:30,916` — remove import + mount
- `src/components/client/ClientChatWidget.tsx:28,91` — remove JSDoc comments referencing FeedbackWidget
- `src/api/misc.ts:200-205` — remove `feedback` object
- `src/api/index.ts:9` — remove `feedback` re-export
- `src/hooks/admin/useWorkspaceOverview.ts:41-52,71,91` — remove FeedbackItem type/field/call
- `src/components/WorkspaceOverview.tsx:7,31,43,373-466` — remove feedback state + UI section

### Modify — Tests & Fixtures (4 files)
- `tests/fixtures/rich-intelligence.ts:233` — remove `feedbackItems` array
- `tests/assemble-client-signals.test.ts:35,134,156,323-337,408-448` — remove feedback mock + assertions
- `tests/format-for-prompt.test.ts:104,267` — remove feedback formatting test cases
- `tests/unit/row-mapper-completeness.test.ts:70,129,816-906` — remove feedback table assertions

### Modify — Docs (1 file)
- `FEATURE_AUDIT.md` — remove FeedbackWidget/feedback entry

---

## Task 1: Write the retirement verification test (TDD — write first, observe failure)

**Why first:** TDD discipline — write the test that defines the desired end state before making changes. This test should currently FAIL because the routes still exist.

**Files:**
- Create: `tests/integration/feedback-retirement.test.ts`

- [ ] **Step 1: Read the test helpers to understand auth pattern**

```bash
head -60 tests/integration/helpers.ts
```

Note the `createTestContext` signature and how `ctx.token` / auth headers work. Also confirm that admin routes require the `x-auth-token` header (APP_PASSWORD gate in `server/app.ts`).

- [ ] **Step 2: Read an existing integration test to confirm auth header format**

```bash
head -50 tests/integration/feedback-routes.test.ts
```

Confirm: what header does the test set for admin auth? Use the same pattern.

- [ ] **Step 3: Write the retirement test**

```typescript
// tests/integration/feedback-retirement.test.ts
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createTestContext } from './helpers.js';

// Port 13352 — feedback retirement verification
// Verifies that all feedback API endpoints return 404 after retirement.
// These routes must NOT exist: /api/feedback/* and /api/public/feedback/*
const ctx = createTestContext(13352);

beforeAll(async () => {
  await ctx.start();
});

afterAll(async () => {
  await ctx.stop();
});

describe('feedback retirement — all endpoints return 404', () => {
  it('GET /api/feedback returns 404', async () => {
    const res = await fetch(`${ctx.baseUrl}/api/feedback`, {
      headers: { 'x-auth-token': ctx.token },
    });
    expect(res.status).toBe(404);
  });

  it('GET /api/feedback/:wsId returns 404', async () => {
    const res = await fetch(`${ctx.baseUrl}/api/feedback/nonexistent-ws`, {
      headers: { 'x-auth-token': ctx.token },
    });
    expect(res.status).toBe(404);
  });

  it('PATCH /api/feedback/:wsId/:id returns 404', async () => {
    const res = await fetch(`${ctx.baseUrl}/api/feedback/nonexistent-ws/nonexistent-id`, {
      method: 'PATCH',
      headers: { 'x-auth-token': ctx.token, 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'acknowledged' }),
    });
    expect(res.status).toBe(404);
  });

  it('POST /api/feedback/:wsId/:id/reply returns 404', async () => {
    const res = await fetch(`${ctx.baseUrl}/api/feedback/nonexistent-ws/nonexistent-id/reply`, {
      method: 'POST',
      headers: { 'x-auth-token': ctx.token, 'Content-Type': 'application/json' },
      body: JSON.stringify({ content: 'test' }),
    });
    expect(res.status).toBe(404);
  });

  it('DELETE /api/feedback/:wsId/:id returns 404', async () => {
    const res = await fetch(`${ctx.baseUrl}/api/feedback/nonexistent-ws/nonexistent-id`, {
      method: 'DELETE',
      headers: { 'x-auth-token': ctx.token },
    });
    expect(res.status).toBe(404);
  });

  it('POST /api/public/feedback/:wsId returns 404', async () => {
    const res = await fetch(`${ctx.baseUrl}/api/public/feedback/nonexistent-ws`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: 'bug', title: 'test', description: 'test' }),
    });
    expect(res.status).toBe(404);
  });

  it('GET /api/public/feedback/:wsId returns 404', async () => {
    const res = await fetch(`${ctx.baseUrl}/api/public/feedback/nonexistent-ws`);
    expect(res.status).toBe(404);
  });

  it('POST /api/public/feedback/:wsId/:id/reply returns 404', async () => {
    const res = await fetch(
      `${ctx.baseUrl}/api/public/feedback/nonexistent-ws/nonexistent-id/reply`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: 'test' }),
      }
    );
    expect(res.status).toBe(404);
  });

  it('feedback table does not exist in the database', async () => {
    // Verify the migration dropped the table.
    // Use an admin endpoint that exposes DB schema info, or check via the
    // absence of any rows from a query — but the cleanest approach is to
    // confirm via the ctx.db helper if available.
    // If ctx.db is not available, skip this test; the 404s above are sufficient.
    if (!ctx.db) return;
    const row = ctx.db
      .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='feedback'")
      .get();
    expect(row).toBeUndefined();
  });
});
```

> **Note on auth:** If `ctx.token` is not the correct property name for the admin password header, check `tests/integration/helpers.ts` and `tests/integration/feedback-routes.test.ts` for the correct property. The admin gate uses `x-auth-token: <APP_PASSWORD>`. The test context should expose this. If `ctx.token` does not exist, use `process.env.APP_PASSWORD ?? 'test-password'` or whatever the test helpers provide.

- [ ] **Step 4: Run the test — expect it to FAIL (routes still exist)**

```bash
cd /Users/joshuahampson/CascadeProjects/asset-dashboard/.claude/worktrees/feedback-retirement && npx vitest run tests/integration/feedback-retirement.test.ts --reporter=verbose 2>&1 | tail -40
```

Expected output: Tests fail with `expected 200 to be 404` (or similar). **This is correct — the test is validating the desired end state.** If any test PASSES at this point, investigate why (the route may already be gone or the auth is wrong).

- [ ] **Step 5: Commit the failing test**

```bash
git add tests/integration/feedback-retirement.test.ts
git commit -m "test: add feedback retirement verification (currently failing — routes not yet removed)"
```

---

## Task 2: Write migration 091

**Files:**
- Create: `server/db/migrations/091-retire-feedback-table.sql`

The `requests` table schema (confirmed from migration 002 + 019):
```
id TEXT PRIMARY KEY
workspace_id TEXT NOT NULL
title TEXT NOT NULL
description TEXT NOT NULL
category TEXT NOT NULL
priority TEXT NOT NULL DEFAULT 'medium'
status TEXT NOT NULL DEFAULT 'new'
submitted_by TEXT
page_url TEXT
page_id TEXT
attachments TEXT
notes TEXT NOT NULL DEFAULT '[]'
created_at TEXT NOT NULL
updated_at TEXT NOT NULL
```

- [ ] **Step 1: Write the migration file**

```sql
-- Migration 091: Retire the feedback table
--
-- Migrates existing feedback rows into the requests table (category='general')
-- so no data is permanently lost. Titles are prefixed with
-- '[migrated from feedback]' for provenance tracking.
-- Replies are intentionally dropped — they are internal team notes on an
-- archived widget; the data is not client-facing in requests.
--
-- Uses INSERT OR IGNORE to be idempotent (safe to run on an already-clean DB).

INSERT OR IGNORE INTO requests (
  id,
  workspace_id,
  title,
  description,
  category,
  priority,
  status,
  submitted_by,
  page_url,
  page_id,
  attachments,
  notes,
  created_at,
  updated_at
)
SELECT
  id,
  workspace_id,
  '[migrated from feedback] ' || title,
  description,
  'general',
  'medium',
  'new',
  submitted_by,
  NULL,
  NULL,
  NULL,
  '[]',
  created_at,
  updated_at
FROM feedback;

-- Drop composite index first (SQLite requires explicit index drops)
DROP INDEX IF EXISTS idx_feedback_ws_status;

-- Drop single-column index
DROP INDEX IF EXISTS idx_feedback_workspace;

-- Drop the table
DROP TABLE IF EXISTS feedback;
```

- [ ] **Step 2: Verify migration file has no syntax errors by counting statements**

Read the file back and confirm:
1. The INSERT OR IGNORE covers all NOT NULL columns (id, workspace_id, title, description, category, priority, status, notes, created_at, updated_at) ✅
2. The two DROP INDEX statements use `IF EXISTS` ✅
3. The DROP TABLE uses `IF EXISTS` ✅

- [ ] **Step 3: Commit**

```bash
git add server/db/migrations/091-retire-feedback-table.sql
git commit -m "db: migration 091 — migrate feedback rows to requests and drop feedback table"
```

---

## Task 3: Server route cleanup (makes the retirement test pass)

**Goal:** Delete all server-side feedback infrastructure. After this task the retirement test from Task 1 should pass.

**Files:**
- Delete: `server/routes/feedback.ts`
- Delete: `server/routes/public-feedback.ts`
- Delete: `server/feedback.ts`
- Delete: `tests/integration/feedback-routes.test.ts`
- Delete: `tests/integration/public-feedback-broadcasts.test.ts`
- Modify: `server/app.ts`
- Modify: `server/route-groups/public.ts`
- Modify: `server/ws-events.ts`
- Modify: `server/email.ts`
- Modify: `server/email-templates.ts`
- Modify: `server/email-throttle.ts`

- [ ] **Step 1: Delete the server module and route files**

```bash
rm server/routes/feedback.ts
rm server/routes/public-feedback.ts
rm server/feedback.ts
```

- [ ] **Step 2: Remove feedbackRoutes from server/app.ts**

Read `server/app.ts` and locate:
- The import: `import feedbackRoutes from './routes/feedback.js';` (near line 57)
- The `app.use(feedbackRoutes)` call (search the file for it)

Remove both lines. The file must typecheck cleanly after this edit.

- [ ] **Step 3: Remove publicFeedbackRoutes from server/route-groups/public.ts**

Read `server/route-groups/public.ts`. Remove:
- Line 9: `import publicFeedbackRoutes from '../routes/public-feedback.js';`
- Line 19: `app.use(publicFeedbackRoutes);`

- [ ] **Step 4: Remove WS event constants from server/ws-events.ts**

Read `server/ws-events.ts` lines 35–40. Remove:
```typescript
FEEDBACK_NEW: 'feedback:new',
FEEDBACK_UPDATE: 'feedback:update',
```

These two lines only. Leave all other WS_EVENTS entries intact.

- [ ] **Step 5: Remove notifyTeamNewFeedback from server/email.ts**

Read `server/email.ts` around lines 381–395. Remove the entire `notifyTeamNewFeedback` function:
```typescript
export function notifyTeamNewFeedback(opts: {
  workspaceName: string;
  workspaceId: string;
  feedbackType: string;
  title: string;
  description: string;
}): void {
  const to = getNotificationEmail();
  if (!to || !isEmailConfigured()) return;
  queueEmail(makeEvent('feedback_new', to, opts.workspaceId, opts.workspaceName, undefined, {
    feedbackType: opts.feedbackType, title: opts.title, description: opts.description,
  }));
}
```

- [ ] **Step 6: Remove feedback_new from server/email-templates.ts**

Read `server/email-templates.ts`. Make three removals:

**6a.** In the `EmailEventType` union type, remove `| 'feedback_new'` (around line 180). The union lists event type strings — remove only the `'feedback_new'` entry.

**6b.** In the switch statement, remove the case:
```typescript
case 'feedback_new':
  result = renderFeedbackNew(events, count, ws, dashUrl, logoUrl); break;
```

**6c.** Remove the entire `renderFeedbackNew` function (the private function that builds the email HTML for feedback notifications — roughly lines 277–290). Search for `function renderFeedbackNew` and delete from the `function` keyword through its closing `}`.

- [ ] **Step 7: Remove feedback_new from server/email-throttle.ts**

Read `server/email-throttle.ts`. Find the throttle config object and remove:
```typescript
feedback_new: 'internal',
```
(around line 60). Leave all other throttle entries intact.

- [ ] **Step 8: Delete the old test files (they reference deleted modules)**

```bash
rm tests/integration/feedback-routes.test.ts
rm tests/integration/public-feedback-broadcasts.test.ts
```

- [ ] **Step 9: Run typecheck — expect clean output**

```bash
cd /Users/joshuahampson/CascadeProjects/asset-dashboard/.claude/worktrees/feedback-retirement && npm run typecheck 2>&1 | tail -20
```

Expected: zero errors. If TypeScript reports errors about missing `feedback.js` module, confirm that all import sites in the modified files have been cleaned up.

- [ ] **Step 10: Run the retirement test — expect ALL PASS**

```bash
npx vitest run tests/integration/feedback-retirement.test.ts --reporter=verbose 2>&1 | tail -30
```

Expected: All 8 endpoint tests pass (404). If any still return 200, the route registration was not fully removed — re-read `server/app.ts` and `server/route-groups/public.ts` for any remaining `use()` calls.

- [ ] **Step 11: Commit**

```bash
git add -A
git commit -m "feat: remove feedback routes, module, email, WS events, and old tests

Deletes server/feedback.ts, server/routes/feedback.ts, server/routes/public-feedback.ts.
Removes route registrations from server/app.ts and server/route-groups/public.ts.
Removes WS_EVENTS.FEEDBACK_NEW and FEEDBACK_UPDATE from ws-events.ts.
Removes notifyTeamNewFeedback() from email.ts, feedback_new template/case
from email-templates.ts, and feedback_new throttle entry from email-throttle.ts.
All /api/feedback/* and /api/public/feedback/* endpoints now return 404."
```

---

## Task 4: Intelligence + shared type cleanup

**Goal:** Remove `feedbackItems` from the intelligence slice interface and its assembly/formatting code. Must typecheck cleanly.

**Files:**
- Modify: `shared/types/intelligence.ts:247`
- Modify: `server/intelligence/client-signals-slice.ts:243-247,375`
- Modify: `server/intelligence/formatters.ts:668-670`

- [ ] **Step 1: Remove feedbackItems from shared/types/intelligence.ts**

Read `shared/types/intelligence.ts`. Find `ClientSignalsSlice` interface (around line 240+). Remove the `feedbackItems` field:
```typescript
feedbackItems?: Array<{ id: string; type: string; status: string; createdAt: string }>;
```

This field is optional (`?`) so removing it will not break callers that read it — TypeScript will flag any remaining access as an error (which is what we want).

- [ ] **Step 2: Remove feedbackItems from server/intelligence/client-signals-slice.ts**

Read `server/intelligence/client-signals-slice.ts`. Find and remove three things:

**2a.** The `FeedbackItem` import (if the module imports from `server/feedback.js` — search for it and remove the import).

**2b.** The feedbackItems variable declaration and DB query (around lines 243-247):
```typescript
let feedbackItems: ClientSignalsSlice['feedbackItems'] = [];
// ... DB query to populate feedbackItems ...
feedbackItems = items.slice(0, 10).map((f: FeedbackItem) => ({
  id: f.id, type: f.type, status: f.status, createdAt: f.createdAt,
}));
```
Remove everything from the `let feedbackItems` declaration through the end of the map call.

**2c.** The field in the returned slice object (around line 375):
```typescript
feedbackItems,
```
Remove this line from the object literal.

- [ ] **Step 3: Remove feedbackItems formatter from server/intelligence/formatters.ts**

Read `server/intelligence/formatters.ts`. Find around lines 668-670:
```typescript
if (signals.feedbackItems && signals.feedbackItems.length > 0) {
  const openCount = signals.feedbackItems.filter(f => f.status === 'new').length;
  lines.push(`Feedback: ${signals.feedbackItems.length} items (${openCount} open)`);
}
```
Remove these 3 lines (the entire if-block).

- [ ] **Step 4: Typecheck**

```bash
cd /Users/joshuahampson/CascadeProjects/asset-dashboard/.claude/worktrees/feedback-retirement && npm run typecheck 2>&1 | tail -20
```

Expected: zero errors. Errors about `feedbackItems` in formatter or assembler mean a reference was missed in Steps 2–3.

- [ ] **Step 5: Commit**

```bash
git add shared/types/intelligence.ts server/intelligence/client-signals-slice.ts server/intelligence/formatters.ts
git commit -m "feat: remove feedbackItems from intelligence slice and formatter"
```

---

## Task 5: Frontend cleanup

**Goal:** Remove the FeedbackWidget component and all its call sites from the frontend. TypeScript must be clean after this task.

**Files:**
- Delete: `src/components/client/FeedbackWidget.tsx`
- Modify: `src/components/client/index.ts:4`
- Modify: `src/components/ClientDashboard.tsx:30,916`
- Modify: `src/components/client/ClientChatWidget.tsx:28,91`
- Modify: `src/api/misc.ts:200-205`
- Modify: `src/api/index.ts:9`
- Modify: `src/hooks/admin/useWorkspaceOverview.ts:41-52,71,91`
- Modify: `src/components/WorkspaceOverview.tsx:7,31,43,373-466`

- [ ] **Step 1: Delete FeedbackWidget.tsx**

```bash
rm src/components/client/FeedbackWidget.tsx
```

- [ ] **Step 2: Remove FeedbackWidget export from src/components/client/index.ts**

Read `src/components/client/index.ts`. Remove line 4:
```typescript
export { FeedbackWidget } from './FeedbackWidget';
```

- [ ] **Step 3: Remove FeedbackWidget from src/components/ClientDashboard.tsx**

Read `src/components/ClientDashboard.tsx`. Make two edits:

**3a.** Remove the import (around line 30):
```typescript
import { FeedbackWidget } from './client/FeedbackWidget';
```

**3b.** Remove the mount (around line 916). Search for `<FeedbackWidget` and remove the entire JSX expression. It looks like:
```tsx
{ws && <FeedbackWidget workspaceId={workspaceId} currentTab={tab} submittedBy={undefined} chatExpanded={chatExpanded} />}
```
Remove this line. Also check if `chatExpanded` is used anywhere else in `ClientDashboard.tsx` — if `chatExpanded` was declared solely to be passed to `FeedbackWidget`, remove its declaration too.

- [ ] **Step 4: Clean up ClientChatWidget.tsx comments**

Read `src/components/client/ClientChatWidget.tsx`. Remove two comment lines:
- Around line 28: `/** Called when the expanded state changes — used by FeedbackWidget. */`
- Around line 91: `// Bubble up expanded state for FeedbackWidget`

> **Important:** Only remove the comments. Do NOT remove the `chatExpanded` callback or its logic — this prop may be used by other consumers or simply retained for future use. Verify by grepping: `grep -n "chatExpanded" src/components/client/ClientChatWidget.tsx` and `grep -n "chatExpanded" src/components/ClientDashboard.tsx` before deciding whether to remove the prop.

- [ ] **Step 5: Remove feedback from src/api/misc.ts**

Read `src/api/misc.ts` around lines 200–205. Remove the `feedback` object:
```typescript
feedback: {
  submit: (wsId: string, body: unknown) => post<unknown>(`/api/public/feedback/${wsId}`, body),
  list: (wsId: string) => getSafe<unknown[]>(`/api/feedback/${wsId}`, []),
},
```
This is a property inside the exported object — remove only the `feedback: { ... },` entry. Leave all surrounding properties.

- [ ] **Step 6: Remove feedback re-export from src/api/index.ts**

Read `src/api/index.ts`. Find around line 9:
```typescript
export { ..., feedback, ... } from './misc.js';
```
Remove `feedback` from the named exports (or remove the entire export line for `feedback` if it's on its own line).

- [ ] **Step 7: Clean up useWorkspaceOverview.ts**

Read `src/hooks/admin/useWorkspaceOverview.ts`. Make three edits:

**7a.** Remove the local `FeedbackItem` type definition (lines 41-52). It looks like:
```typescript
export type FeedbackItem = {
  id: string;
  workspaceId: string;
  type: string;
  title: string;
  // ... more fields
};
```
Remove the entire `FeedbackItem` type declaration.

**7b.** Remove `feedback: FeedbackItem[]` from the `WorkspaceOverviewData` interface (around line 71).

**7c.** Remove the `getSafe<FeedbackItem[]>('/api/feedback', [])` call from the parallel data-fetching block (around line 91). This is inside a `Promise.all(...)` or similar — remove only the feedback fetch entry and adjust any surrounding destructuring accordingly.

- [ ] **Step 8: Remove Client Feedback section from WorkspaceOverview.tsx**

Read `src/components/WorkspaceOverview.tsx`. Make four edits:

**8a.** Remove `FeedbackItem` from the import on line 7.

**8b.** Remove `feedbackReply` state (around line 31):
```typescript
const [feedbackReply, setFeedbackReply] = useState<Record<string, string>>({});
```

**8c.** Remove the feedback variable (around line 43):
```typescript
const feedback = overviewData?.feedback ?? [];
```

**8d.** Remove the entire `{/* ── Client Feedback ── */}` JSX section (lines 373–466). This section starts with `{feedback.length > 0 && (() => {` and includes the `SectionCard` with the feedback list and reply form. Remove from the comment through the closing of that expression/block.

> **Tip:** Search for `Client Feedback` as a comment to find the exact start. The section ends with the matching `})()} ` or `})()}` closure. Count braces carefully or use the linter to confirm the JSX is balanced after removal.

- [ ] **Step 9: Typecheck**

```bash
cd /Users/joshuahampson/CascadeProjects/asset-dashboard/.claude/worktrees/feedback-retirement && npm run typecheck 2>&1 | tail -30
```

Expected: zero errors. Common errors and fixes:
- `Cannot find module './client/FeedbackWidget'` → Step 3a was missed
- `Property 'chatExpanded' does not exist` → `chatExpanded` callback was removed but is still used elsewhere; restore it in ClientChatWidget.tsx
- `Property 'feedback' does not exist on type 'WorkspaceOverviewData'` → Step 7b was missed
- `'FeedbackItem' is not defined` → Step 7a or 8a was missed

- [ ] **Step 10: Commit**

```bash
git add src/components/client/FeedbackWidget.tsx src/components/client/index.ts src/components/ClientDashboard.tsx src/components/client/ClientChatWidget.tsx src/api/misc.ts src/api/index.ts src/hooks/admin/useWorkspaceOverview.ts src/components/WorkspaceOverview.tsx
git commit -m "feat: remove FeedbackWidget component and all frontend feedback references"
```

---

## Task 6: Test fixture + intelligence test cleanup

**Goal:** Clean up all test files that reference `feedbackItems` or mock `server/feedback.js`. Full vitest run must be green after this task.

**Files:**
- Modify: `tests/fixtures/rich-intelligence.ts`
- Modify: `tests/assemble-client-signals.test.ts`
- Modify: `tests/format-for-prompt.test.ts`
- Modify: `tests/unit/row-mapper-completeness.test.ts`

- [ ] **Step 1: Remove feedbackItems from the rich-intelligence fixture**

Read `tests/fixtures/rich-intelligence.ts`. Find the `feedbackItems` property (around line 233):
```typescript
feedbackItems: [
  { id: '...', type: 'bug', status: 'new', createdAt: '...' },
  // ...
],
```
Remove the entire `feedbackItems: [...]` property (including trailing comma). TypeScript will confirm the removal is clean since we removed `feedbackItems` from `ClientSignalsSlice` in Task 4.

- [ ] **Step 2: Clean up assemble-client-signals.test.ts**

Read `tests/assemble-client-signals.test.ts`. Make these removals:

**2a.** Remove the `vi.mock('../../server/feedback.js', ...)` call (around line 35). This mocks the deleted `server/feedback.ts` module. Remove the entire `vi.mock(...)` block.

**2b.** Find all references to `feedbackItems` in the test file (search: `grep -n "feedbackItems\|feedback" tests/assemble-client-signals.test.ts`). Remove:
- Any `feedbackItems` assertions in test expectations
- Any `feedbackItems` values in test setup fixtures
- Any imports of feedback-related types

**2c.** Run the file in isolation to confirm it passes with no feedback-related assertions:
```bash
npx vitest run tests/assemble-client-signals.test.ts --reporter=verbose 2>&1 | tail -20
```

- [ ] **Step 3: Clean up format-for-prompt.test.ts**

Read `tests/format-for-prompt.test.ts`. Find around lines 104 and 267 where feedback item formatting is tested. Remove the feedback-related test cases only. Keep all other formatting tests intact.

Run in isolation to confirm:
```bash
npx vitest run tests/format-for-prompt.test.ts --reporter=verbose 2>&1 | tail -20
```

- [ ] **Step 4: Clean up row-mapper-completeness.test.ts**

Read `tests/unit/row-mapper-completeness.test.ts` around lines 816–906. This test verifies that the `feedback` table has a corresponding row mapper. Remove:
- Any `it` or `test` block that references the `feedback` table or `FeedbackRow`
- Any import of `listFeedback`, `getFeedbackItem`, `createFeedback`, or similar from `server/feedback.js`

Run in isolation to confirm:
```bash
npx vitest run tests/unit/row-mapper-completeness.test.ts --reporter=verbose 2>&1 | tail -20
```

- [ ] **Step 5: Run the full test suite**

```bash
cd /Users/joshuahampson/CascadeProjects/asset-dashboard/.claude/worktrees/feedback-retirement && npx vitest run 2>&1 | tail -40
```

Expected: all tests pass. Common failures:
- `Cannot find module '../../server/feedback.js'` → missed a `vi.mock` in Step 2a or another test file also mocks it. Run `grep -rn "server/feedback" tests/` to find all references.
- `feedbackItems` type error → missed an assertion in Step 2b
- Any `feedback-routes` test failure → those files were deleted in Task 3; if they appear, they were somehow restored

- [ ] **Step 6: Commit**

```bash
git add tests/fixtures/rich-intelligence.ts tests/assemble-client-signals.test.ts tests/format-for-prompt.test.ts tests/unit/row-mapper-completeness.test.ts
git commit -m "test: remove feedback references from intelligence fixtures and test files"
```

---

## Task 7: Docs + final verification

**Goal:** Remove FEATURE_AUDIT.md entry, then run the full quality gate to confirm the PR is ready.

**Files:**
- Modify: `FEATURE_AUDIT.md`

- [ ] **Step 1: Remove FeedbackWidget entry from FEATURE_AUDIT.md**

```bash
grep -n "feedback\|FeedbackWidget" FEATURE_AUDIT.md
```

Remove the entry (or entries) referencing the FeedbackWidget or the feedback table. Each entry is typically a short bullet. Remove only the feedback-related entry; leave all other entries intact.

- [ ] **Step 2: Run the full quality gate**

```bash
cd /Users/joshuahampson/CascadeProjects/asset-dashboard/.claude/worktrees/feedback-retirement && npm run typecheck && npx vite build && npx vitest run && npx tsx scripts/pr-check.ts
```

Expected:
- `typecheck` → zero errors
- `vite build` → succeeds, no warnings about missing modules
- `vitest run` → all tests pass
- `pr-check` → zero errors (the pre-existing PageHeader warning is acceptable — it's pre-existing and not caused by this PR)

If any failures appear, fix them before committing. Common issues:
- Build error: a component still references a deleted module → grep for `FeedbackWidget` and `feedback` in src/
- Test failure: a vi.mock of `server/feedback.js` exists somewhere → `grep -rn "server/feedback" tests/`
- pr-check error: a new rule catches something in the modified files → read the rule and fix the violation

- [ ] **Step 3: Commit docs**

```bash
git add FEATURE_AUDIT.md
git commit -m "docs: remove FeedbackWidget from FEATURE_AUDIT.md"
```

- [ ] **Step 4: Final git log to confirm all 7 tasks committed cleanly**

```bash
git log --oneline -10
```

Expected: 7+ commits on `feat/feedback-retirement` branch, each scoped to one task.

---

## Self-Review Checklist

After all tasks are complete, verify against the spec:

**Spec §"Files to delete" coverage:**
- [x] Task 3: `server/routes/feedback.ts` ✅
- [x] Task 3: `server/routes/public-feedback.ts` ✅  
- [x] Task 5: `src/components/client/FeedbackWidget.tsx` ✅
- [x] Task 3: `server/feedback.ts` ✅ (the CRUD module containing types is the server/feedback.ts file)
- [x] Task 3: `tests/integration/feedback-routes.test.ts` ✅
- [x] Task 3: `tests/integration/public-feedback-broadcasts.test.ts` (covered via audit finding) ✅
- [x] No `useFeedback*` hooks found in audit ✅

**Spec §"Migration" coverage:**
- [x] Task 2: migrate rows to requests with `category: 'general'` ✅
- [x] Task 2: prefix title with `[migrated from feedback]` ✅
- [x] Task 2: drop table and indexes ✅
- [x] Task 1: retirement test verifies endpoints return 404 ✅

**Spec §"Tests" coverage:**
- [x] Task 1: integration test for 404 on removed endpoints ✅
- [x] Task 6: old test files removed / trimmed ✅

**Spec §"Documentation":**
- [x] Task 7: FEATURE_AUDIT.md updated ✅

**Additional audit findings covered:**
- [x] Task 4: intelligence slice + formatter cleaned ✅
- [x] Task 3: email notification, template, throttle removed ✅
- [x] Task 3: WS events removed ✅
- [x] Task 5: admin WorkspaceOverview.tsx feedback UI removed ✅
- [x] Task 5: useWorkspaceOverview.ts hook cleaned ✅
