# Action Playbooks Resolution Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close the approval loop — when a client approves a `client_actions` card the system must notify the admin team, trigger any automated playbook appropriate to the action type, and provide an admin UI path to mark the action `completed` once implemented.

**Architecture:** Thin hooks into the existing `PATCH /api/public/client-actions/:workspaceId/:actionId/respond` endpoint. On `status === 'approved'`:  (1) fire an `action_approved` email event to the team's notification inbox; (2) for `content_decay` actions only, enqueue an `ACTION_PLAYBOOK_EXECUTE` background job that auto-generates a content brief; (3) all other action types surface in an admin "approved — awaiting implementation" badge in the existing `ClientActionsTab` and gain a one-click "Mark complete" endpoint. No new pages or tabs needed.

**Tech Stack:** Express + TypeScript, better-sqlite3, `createJob`/`updateJob` from `server/jobs.ts`, `queueEmail`/`makeEvent` pattern from `server/email.ts`, `generateBrief` from `server/content-brief.ts`, vitest integration tests.

---

## File Map

| File | Change type | Responsibility |
|------|-------------|----------------|
| `shared/types/background-jobs.ts` | **Modify** | Add `ACTION_PLAYBOOK_EXECUTE` to `BACKGROUND_JOB_TYPES` + metadata |
| `server/email-templates.ts` | **Modify** | Add `'action_approved'` to `EmailEventType` union; add `renderActionApproved()` renderer; add case to `renderDigest()` switch |
| `server/email.ts` | **Modify** | Add `notifyTeamActionApproved()` helper |
| `server/routes/client-actions.ts` | **Modify** | Wire `notifyTeamActionApproved()` and `enqueuePlaybook()` into the public respond endpoint |
| `server/playbooks.ts` | **Create** | `enqueuePlaybook(workspaceId, action)` dispatcher; `executeContentDecayPlaybook()` background job runner |
| `tests/integration/action-playbooks.test.ts` | **Create** | Port 13352 — integration tests for email event + job enqueue + mark-complete endpoint |

---

## Task 1: Add `ACTION_PLAYBOOK_EXECUTE` job type + `action_approved` email event type

**Files:**
- Modify: `shared/types/background-jobs.ts`
- Modify: `server/email-templates.ts` (EmailEventType union only — renderer added in Task 2)

- [ ] **Step 1: Add job type to BACKGROUND_JOB_TYPES**

Open `shared/types/background-jobs.ts`. Add one entry to `BACKGROUND_JOB_TYPES` and one to `BACKGROUND_JOB_METADATA`:

```typescript
// In BACKGROUND_JOB_TYPES:
ACTION_PLAYBOOK_EXECUTE: 'action-playbook-execute',
```

```typescript
// In BACKGROUND_JOB_METADATA:
[BACKGROUND_JOB_TYPES.ACTION_PLAYBOOK_EXECUTE]: {
  label: 'Action Playbook',
  description: 'Executes an automated implementation playbook after client approval.',
  cancellable: false,
  resultBehavior: 'domain-store',
},
```

- [ ] **Step 2: Add `action_approved` to EmailEventType**

In `server/email-templates.ts`, add `'action_approved'` to the `EmailEventType` union (line ~184, after `'content_changes_requested'`):

```typescript
export type EmailEventType =
  | 'approval_ready'
  | 'request_new'
  // ... (all existing entries) ...
  | 'content_changes_requested'
  | 'action_approved';   // ← add this line
```

- [ ] **Step 3: Typecheck**

```bash
cd /Users/joshuahampson/CascadeProjects/asset-dashboard/.claude/worktrees/stupefied-goodall-96b059
npm run typecheck
```

Expected: zero errors. The new EmailEventType entry creates a type error on the `renderDigest` switch (unhandled case) — this is caught in the next step; it may pass now because the `default:` branch handles it gracefully. If the error surfaces, proceed — it's fixed in Task 2.

- [ ] **Step 4: Commit**

```bash
git add shared/types/background-jobs.ts server/email-templates.ts
git commit -m "feat: add ACTION_PLAYBOOK_EXECUTE job type and action_approved email event type"
```

---

## Task 2: Admin notification email — renderer + helper + renderDigest case

**Files:**
- Modify: `server/email-templates.ts` (add renderer + `renderDigest` case)
- Modify: `server/email.ts` (add `notifyTeamActionApproved()`)

- [ ] **Step 1: Write failing test for `notifyTeamActionApproved`**

Create `tests/integration/action-playbooks.test.ts`:

```typescript
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createTestContext } from './helpers.js';

const PORT = 13352;
let ctx: Awaited<ReturnType<typeof createTestContext>>;
let testWsId: string;
let testSiteId: string;

beforeAll(async () => {
  ctx = await createTestContext(PORT);
  testWsId = ctx.workspaceId;
  testSiteId = ctx.siteId;
});

afterAll(async () => {
  await ctx.cleanup();
});

function api(path: string) {
  return fetch(`http://localhost:${PORT}${path}`, { headers: { 'x-auth-token': ctx.authToken } });
}

function postJson(path: string, body: unknown) {
  return fetch(`http://localhost:${PORT}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-auth-token': ctx.authToken },
    body: JSON.stringify(body),
  });
}

function patchJson(path: string, body: unknown, authHeader?: string) {
  return fetch(`http://localhost:${PORT}${path}`, {
    method: 'PATCH',
    headers: {
      'Content-Type': 'application/json',
      ...(authHeader ? { Authorization: authHeader } : { 'x-auth-token': ctx.authToken }),
    },
    body: JSON.stringify(body),
  });
}

describe('Action Playbooks — approval notification', () => {
  it('PATCH /respond with approved status returns 200 and updated action', async () => {
    // Create action first
    const createRes = await postJson(`/api/client-actions/${testWsId}`, {
      sourceType: 'internal_link',
      title: 'Add internal link',
      summary: 'Link from blog post to service page.',
    });
    expect(createRes.status).toBe(200);
    const action = await createRes.json();

    // Get client JWT to call public endpoint
    const clientToken = ctx.clientToken;
    const respondRes = await patchJson(
      `/api/public/client-actions/${testWsId}/${action.id}/respond`,
      { status: 'approved', clientNote: 'Looks great!' },
      `Bearer ${clientToken}`,
    );
    expect(respondRes.status).toBe(200);
    const updated = await respondRes.json();
    expect(updated.status).toBe('approved');
    expect(updated.clientNote).toBe('Looks great!');
  });

  it('admin PATCH to completed transitions approved action to completed', async () => {
    // Create + approve
    const createRes = await postJson(`/api/client-actions/${testWsId}`, {
      sourceType: 'redirect_proposal',
      title: 'Redirect old page',
      summary: 'Client approved redirect.',
    });
    const action = await createRes.json();
    await patchJson(
      `/api/public/client-actions/${testWsId}/${action.id}/respond`,
      { status: 'approved' },
      `Bearer ${ctx.clientToken}`,
    );

    // Admin marks complete
    const completeRes = await patchJson(`/api/client-actions/${testWsId}/${action.id}`, { status: 'completed' });
    expect(completeRes.status).toBe(200);
    const completed = await completeRes.json();
    expect(completed.status).toBe('completed');
  });

  it('returns 409 when transitioning approved → pending (invalid transition)', async () => {
    const createRes = await postJson(`/api/client-actions/${testWsId}`, {
      sourceType: 'aeo_change',
      title: 'AEO header rewrite',
      summary: 'Add FAQ section.',
    });
    const action = await createRes.json();
    await patchJson(
      `/api/public/client-actions/${testWsId}/${action.id}/respond`,
      { status: 'approved' },
      `Bearer ${ctx.clientToken}`,
    );

    const badRes = await patchJson(`/api/client-actions/${testWsId}/${action.id}`, { status: 'pending' });
    expect(badRes.status).toBe(409);
  });
});
```

- [ ] **Step 2: Run failing test**

```bash
cd /Users/joshuahampson/CascadeProjects/asset-dashboard/.claude/worktrees/stupefied-goodall-96b059
npx vitest run tests/integration/action-playbooks.test.ts
```

Expected: tests may partially pass (the endpoint already works) or fail if `ctx.clientToken` is not available on the test context. Confirm the helper shape before proceeding. Check `tests/integration/helpers.ts` — if `clientToken` isn't on the context, use the workspace's client login endpoint to obtain one.

- [ ] **Step 3: Check test helper shape**

```bash
grep -n "clientToken\|clientJwt\|clientLogin" /Users/joshuahampson/CascadeProjects/asset-dashboard/.claude/worktrees/stupefied-goodall-96b059/tests/integration/helpers.ts | head -20
```

If `clientToken` is not on the context object, obtain it within the test using the existing client login endpoint. The workspace seed creates a client user — look for `clientEmail`/`clientPassword` on the context:

```typescript
// Inside the test where clientToken is needed:
const loginRes = await fetch(`http://localhost:${PORT}/api/public/auth/login`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ workspaceId: testWsId, email: ctx.clientEmail, password: ctx.clientPassword }),
});
const { token: clientToken } = await loginRes.json();
```

Update the test accordingly based on what the helper actually provides.

- [ ] **Step 4: Add `renderActionApproved()` to `server/email-templates.ts`**

After the `renderFeedbackNew()` function (around line 273), add:

```typescript
function renderActionApproved(events: EmailEvent[], count: number, ws: string, dashUrl?: string, logoUrl?: string) {
  const items = events.map((e, i) => itemRow({
    title: (e.data.title as string) || 'Client Action',
    detail: (e.data.sourceType as string)
      ? `${(e.data.sourceType as string).replace(/_/g, ' ')} — ${(e.data.summary as string) || ''}`
      : (e.data.summary as string) || '',
    badge: { label: 'approved', color: '#059669', bg: '#d1fae5' },
    isLast: i === events.length - 1,
  })).join('');

  return {
    subject: count === 1
      ? `Client approved: ${(events[0].data.title as string) || 'action'} — ${ws}`
      : `${count} client approvals — ${ws}`,
    html: layout({
      preheader: `${ws} client approved ${count} action${count !== 1 ? 's' : ''}`,
      headline: count === 1 ? 'Client Approved an Action' : 'Client Approvals',
      subtitle: ws,
      body: count > 1 ? countPill(count, 'approval') + items : items,
      cta: dashUrl ? { label: 'View in Dashboard', url: dashUrl } : undefined,
      logoUrl,
    }),
  };
}
```

Add the case to `renderDigest()` switch (after the `'client_briefing_ready'` case, before `default:`):

```typescript
case 'action_approved':
  result = renderActionApproved(events, count, ws, dashUrl, logoUrl); break;
```

- [ ] **Step 5: Add `notifyTeamActionApproved()` to `server/email.ts`**

After `notifyClientStatusChange()`, add:

```typescript
export function notifyTeamActionApproved(opts: {
  workspaceName: string;
  workspaceId: string;
  actionTitle: string;
  sourceType: string;
  actionSummary: string;
  clientNote?: string;
  dashboardUrl?: string;
}): void {
  const to = getNotificationEmail();
  if (!to || !isEmailConfigured()) return;
  queueEmail(makeEvent('action_approved', to, opts.workspaceId, opts.workspaceName, opts.dashboardUrl, {
    title: opts.actionTitle,
    sourceType: opts.sourceType,
    summary: opts.actionSummary,
    clientNote: opts.clientNote,
  }));
}
```

- [ ] **Step 6: Typecheck**

```bash
npm run typecheck
```

Expected: zero errors.

- [ ] **Step 7: Run tests**

```bash
npx vitest run tests/integration/action-playbooks.test.ts
```

Expected: all tests in the file pass.

- [ ] **Step 8: Commit**

```bash
git add server/email-templates.ts server/email.ts tests/integration/action-playbooks.test.ts
git commit -m "feat: add action_approved email notification (renderer + helper + test)"
```

---

## Task 3: Create `server/playbooks.ts` — `enqueuePlaybook()` dispatcher + content decay job

**Files:**
- Create: `server/playbooks.ts`
- Modify: `tests/integration/action-playbooks.test.ts` (add job-enqueue test)

The playbook dispatcher is a thin switch: for `content_decay` it enqueues a background job; for all other types it is a no-op (the admin UI "mark complete" flow is sufficient). This is designed to be extended later — each new action type gets a case.

- [ ] **Step 1: Write failing test for content_decay job enqueue**

Add a new `describe` block to `tests/integration/action-playbooks.test.ts`:

```typescript
describe('Action Playbooks — content_decay job enqueue', () => {
  it('approving a content_decay action enqueues an ACTION_PLAYBOOK_EXECUTE job', async () => {
    // Create content_decay action with a pageUrl in payload so the job has context
    const createRes = await postJson(`/api/client-actions/${testWsId}`, {
      sourceType: 'content_decay',
      title: 'Refresh: /blog/old-post',
      summary: 'Traffic down 40% in 90 days. Recommend refreshing content.',
      payload: { pageUrl: '/blog/old-post', targetKeyword: 'seo tips' },
    });
    expect(createRes.status).toBe(200);
    const action = await createRes.json();

    // Approve via public endpoint
    const clientToken = await getClientToken(); // defined above in test scope
    const respondRes = await patchJson(
      `/api/public/client-actions/${testWsId}/${action.id}/respond`,
      { status: 'approved' },
      `Bearer ${clientToken}`,
    );
    expect(respondRes.status).toBe(200);

    // Check that a job was created
    const jobsRes = await api(`/api/jobs?workspaceId=${testWsId}`);
    expect(jobsRes.status).toBe(200);
    const jobs = await jobsRes.json() as { type: string; workspaceId: string }[];
    const playbookJob = jobs.find(j => j.type === 'action-playbook-execute' && j.workspaceId === testWsId);
    expect(playbookJob).toBeDefined();
  });
});
```

- [ ] **Step 2: Run test to confirm it fails**

```bash
npx vitest run tests/integration/action-playbooks.test.ts
```

Expected: new job-enqueue test fails (no job is created yet).

- [ ] **Step 3: Create `server/playbooks.ts`**

```typescript
import { createJob, updateJob } from './jobs.js';
import { generateBrief } from './content-brief.js';
import { updateClientAction } from './client-actions.js';
import { broadcastToWorkspace } from './broadcast.js';
import { WS_EVENTS } from './ws-events.js';
import { invalidateIntelligenceCache } from './workspace-intelligence.js';
import { createLogger } from './logger.js';
import { BACKGROUND_JOB_TYPES } from '../shared/types/background-jobs.js';
import type { ClientAction } from '../shared/types/client-actions.js';

const log = createLogger('playbooks');

/**
 * Enqueue the appropriate implementation playbook for an approved client action.
 * No-op for action types that have no automated playbook (admin handles manually).
 */
export function enqueuePlaybook(workspaceId: string, action: ClientAction): void {
  switch (action.sourceType) {
    case 'content_decay':
      enqueueContentDecayPlaybook(workspaceId, action);
      break;
    // aeo_change, internal_link, keyword_strategy, redirect_proposal:
    // No automated playbook — admin implements manually and marks complete via UI.
    default:
      break;
  }
}

function enqueueContentDecayPlaybook(workspaceId: string, action: ClientAction): void {
  const payload = action.payload as Record<string, unknown> | undefined;
  const targetKeyword = (payload?.targetKeyword as string) || action.title.replace(/^Refresh:\s*/i, '').trim();

  const job = createJob(BACKGROUND_JOB_TYPES.ACTION_PLAYBOOK_EXECUTE, {
    message: `Generating content brief for "${targetKeyword}"...`,
    workspaceId,
  });

  // Fire-and-forget — runs async, updates job status when done
  executeContentDecayPlaybook(workspaceId, action.id, job.id, targetKeyword, payload)
    .catch(err => {
      log.error({ err, jobId: job.id, actionId: action.id }, 'content_decay playbook failed');
      updateJob(job.id, { status: 'error', error: String(err), message: 'Brief generation failed' });
    });
}

async function executeContentDecayPlaybook(
  workspaceId: string,
  actionId: string,
  jobId: string,
  targetKeyword: string,
  payload: Record<string, unknown> | undefined,
): Promise<void> {
  updateJob(jobId, { status: 'running', progress: 10, message: 'Generating content brief...' });

  try {
    await generateBrief(workspaceId, targetKeyword, {
      pageType: 'BlogPosting',
      referenceUrls: payload?.pageUrl ? [payload.pageUrl as string] : undefined,
    });

    updateJob(jobId, { status: 'done', progress: 100, message: 'Content brief created' });

    // Transition the action to completed
    updateClientAction(workspaceId, actionId, { status: 'completed' });
    broadcastToWorkspace(workspaceId, WS_EVENTS.CLIENT_ACTION_UPDATE, { actionId, action: 'completed' });
    invalidateIntelligenceCache(workspaceId);

    log.info({ workspaceId, actionId, jobId }, 'content_decay playbook completed');
  } catch (err) {
    updateJob(jobId, { status: 'error', error: String(err), message: 'Brief generation failed' });
    log.error({ err, workspaceId, actionId, jobId }, 'content_decay playbook error');
  }
}
```

- [ ] **Step 4: Typecheck**

```bash
npm run typecheck
```

Expected: zero errors.

- [ ] **Step 5: Wire `enqueuePlaybook` + `notifyTeamActionApproved` into the respond endpoint**

Open `server/routes/client-actions.ts`. Add imports at the top with existing imports:

```typescript
import { notifyTeamActionApproved } from '../email.js';
import { enqueuePlaybook } from '../playbooks.js';
import { getWorkspace, getClientPortalUrl } from '../workspaces.js';
```

Note: `getWorkspace` and `getClientPortalUrl` are already imported — do not duplicate them.

In the `PATCH /api/public/client-actions/:workspaceId/:actionId/respond` handler, after `broadcastActionUpdate(...)`:

```typescript
  broadcastActionUpdate(req.params.workspaceId, req.params.actionId, 'responded');

  // Post-approval side effects
  if (req.body.status === 'approved') {
    const ws = getWorkspace(req.params.workspaceId);
    notifyTeamActionApproved({
      workspaceId: req.params.workspaceId,
      workspaceName: ws?.name || req.params.workspaceId,
      actionTitle: updated.title,
      sourceType: updated.sourceType,
      actionSummary: updated.summary,
      clientNote: req.body.clientNote,
      dashboardUrl: ws ? getClientPortalUrl(ws) : undefined,
    });
    enqueuePlaybook(req.params.workspaceId, updated);
  }

  res.json(updated);
```

Remove the old bare `res.json(updated)` line that was the last line before this block.

- [ ] **Step 6: Typecheck**

```bash
npm run typecheck
```

Expected: zero errors.

- [ ] **Step 7: Run tests**

```bash
npx vitest run tests/integration/action-playbooks.test.ts
```

Expected: all tests pass including the content_decay job-enqueue test.

- [ ] **Step 8: Full test suite**

```bash
npx vitest run
```

Expected: all existing tests still pass.

- [ ] **Step 9: Commit**

```bash
git add server/playbooks.ts server/routes/client-actions.ts tests/integration/action-playbooks.test.ts
git commit -m "feat: enqueue content_decay playbook + notify team on client action approval"
```

---

## Task 4: Admin "mark complete" tests and admin list filtering

**Files:**
- Modify: `tests/integration/action-playbooks.test.ts` (add list-filtering assertions)

The admin `PATCH /api/client-actions/:workspaceId/:actionId` endpoint with `{ status: 'completed' }` is the "mark complete" mechanism for non-automated action types. It was already wired in `server/routes/client-actions.ts` (lines 94–96 handle the `completed` activity log). This task verifies that behavior via tests and adds a list endpoint assertion to confirm approved-but-not-completed actions are surfaced for admin attention.

- [ ] **Step 1: Write failing tests for admin list filtering**

Add a `describe` block to `tests/integration/action-playbooks.test.ts`:

```typescript
describe('Action Playbooks — admin list and mark-complete flow', () => {
  it('GET /api/client-actions lists approved-but-not-completed actions', async () => {
    // Create + approve
    const createRes = await postJson(`/api/client-actions/${testWsId}`, {
      sourceType: 'aeo_change',
      title: 'AEO: Add FAQ block',
      summary: 'Add FAQ schema to service page.',
    });
    const action = await createRes.json();
    await patchJson(
      `/api/public/client-actions/${testWsId}/${action.id}/respond`,
      { status: 'approved' },
      `Bearer ${await getClientToken()}`,
    );

    // Admin list should include it
    const listRes = await api(`/api/client-actions/${testWsId}`);
    expect(listRes.status).toBe(200);
    const list = await listRes.json() as { id: string; status: string }[];
    const found = list.find(a => a.id === action.id);
    expect(found).toBeDefined();
    expect(found?.status).toBe('approved');
  });

  it('admin can mark an approved action as completed', async () => {
    // Create + approve
    const createRes = await postJson(`/api/client-actions/${testWsId}`, {
      sourceType: 'keyword_strategy',
      title: 'Keyword: target "local seo"',
      summary: 'Add to strategy quick wins.',
    });
    const action = await createRes.json();
    await patchJson(
      `/api/public/client-actions/${testWsId}/${action.id}/respond`,
      { status: 'approved' },
      `Bearer ${await getClientToken()}`,
    );

    // Admin marks complete
    const completeRes = await patchJson(`/api/client-actions/${testWsId}/${action.id}`, { status: 'completed' });
    expect(completeRes.status).toBe(200);
    const completed = await completeRes.json();
    expect(completed.status).toBe('completed');

    // Verify in list
    const listRes = await api(`/api/client-actions/${testWsId}`);
    const list = await listRes.json() as { id: string; status: string }[];
    const found = list.find(a => a.id === action.id);
    expect(found?.status).toBe('completed');
  });

  it('cannot mark a pending action as completed (invalid transition)', async () => {
    const createRes = await postJson(`/api/client-actions/${testWsId}`, {
      sourceType: 'redirect_proposal',
      title: 'Redirect: /old',
      summary: 'Redirect to /new.',
    });
    const action = await createRes.json();
    // Still pending — jump to completed should be rejected
    const badRes = await patchJson(`/api/client-actions/${testWsId}/${action.id}`, { status: 'completed' });
    expect(badRes.status).toBe(409);
  });
});
```

- [ ] **Step 2: Run tests**

```bash
npx vitest run tests/integration/action-playbooks.test.ts
```

Expected: all tests pass (the endpoint behavior already exists; these are verification tests).

If the "pending → completed" test fails, check `server/state-machines.ts` for `CLIENT_ACTION_TRANSITIONS` to confirm the transition is indeed blocked. If it's accidentally allowed, add the guard:

```bash
grep -n "CLIENT_ACTION_TRANSITIONS\|pending.*completed\|completed.*pending" /Users/joshuahampson/CascadeProjects/asset-dashboard/.claude/worktrees/stupefied-goodall-96b059/server/state-machines.ts | head -20
```

- [ ] **Step 3: Full test suite**

```bash
npx vitest run
```

Expected: all tests pass.

- [ ] **Step 4: Commit**

```bash
git add tests/integration/action-playbooks.test.ts
git commit -m "test: admin mark-complete flow and list filtering for approved client actions"
```

---

## Task 5: Admin UI badge — "Awaiting Implementation" indicator on approved actions

**Files:**
- Modify: `src/components/admin/ClientActionsTab.tsx` (or wherever the admin action list renders)

This is a UI-only change. Approved actions that are not `completed` get an amber "Awaiting implementation" badge and a "Mark complete" button that PATCHes `{ status: 'completed' }` to the admin endpoint.

- [ ] **Step 1: Find where approved actions render in the admin UI**

```bash
grep -rn "ClientAction\|client-actions\|approved" /Users/joshuahampson/CascadeProjects/asset-dashboard/.claude/worktrees/stupefied-goodall-96b059/src/components/admin/ | grep -i "status\|approved\|complete" | head -20
```

Look for the component that maps over `client_actions` and renders status badges. It may be in `ClientActionsTab.tsx`, `AdminInbox.tsx`, or a sub-component.

- [ ] **Step 2: Read the target component**

```bash
# Replace with the actual path found above
cat /Users/joshuahampson/CascadeProjects/asset-dashboard/.claude/worktrees/stupefied-goodall-96b059/src/components/admin/ClientActionsTab.tsx | head -80
```

- [ ] **Step 3: Add "Awaiting implementation" badge**

Locate where action cards render status. For each action where `action.status === 'approved'`, add alongside the existing status display:

```tsx
{action.status === 'approved' && (
  <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-medium bg-amber-500/10 text-accent-warning border border-amber-500/20">
    Awaiting implementation
  </span>
)}
```

- [ ] **Step 4: Add "Mark complete" button**

In the same approved-action rendering context, add a mutation call. Import the admin client actions hook or use `useMutation` directly:

```tsx
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { queryKeys } from '../../lib/queryKeys'; // check actual import path

// Inside the component:
const queryClient = useQueryClient();
const markComplete = useMutation({
  mutationFn: async (actionId: string) => {
    const res = await fetch(`/api/client-actions/${workspaceId}/${actionId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', 'x-auth-token': localStorage.getItem('auth_token') || '' },
      body: JSON.stringify({ status: 'completed' }),
    });
    if (!res.ok) throw new Error('Failed to mark complete');
    return res.json();
  },
  onSuccess: () => {
    queryClient.invalidateQueries({ queryKey: queryKeys.admin.clientActions(workspaceId) });
  },
});
```

In JSX for approved actions:

```tsx
{action.status === 'approved' && (
  <button
    onClick={() => markComplete.mutate(action.id)}
    disabled={markComplete.isPending}
    className="px-3 py-1 rounded text-xs font-medium bg-teal-600 hover:bg-teal-500 text-white transition-colors disabled:opacity-50"
  >
    {markComplete.isPending ? 'Marking...' : 'Mark complete'}
  </button>
)}
```

**Important:** check the actual API client for client actions — there may be a typed fetch wrapper in `src/api/` rather than raw `fetch()`. If `src/api/client-actions.ts` (or similar) exists, use it:

```bash
ls /Users/joshuahampson/CascadeProjects/asset-dashboard/.claude/worktrees/stupefied-goodall-96b059/src/api/ | grep -i action
```

If a typed wrapper exists, use it instead of raw fetch. The mutation body stays the same.

- [ ] **Step 5: Check queryKey shape**

```bash
grep -n "clientActions\|client_actions\|CLIENT_ACTIONS" /Users/joshuahampson/CascadeProjects/asset-dashboard/.claude/worktrees/stupefied-goodall-96b059/src/lib/queryKeys.ts | head -10
```

Use the exact key from the file — do not invent one.

- [ ] **Step 6: Typecheck and build**

```bash
npm run typecheck && npx vite build
```

Expected: zero errors, build succeeds.

- [ ] **Step 7: pr-check**

```bash
npx tsx scripts/pr-check.ts
```

Expected: zero errors. If `text-amber-*` triggers a violation, replace with `text-accent-warning` (already done in Step 3).

- [ ] **Step 8: Commit**

```bash
git add src/components/admin/ClientActionsTab.tsx  # adjust path as needed
git commit -m "feat: show 'Awaiting implementation' badge + Mark complete button on approved client actions"
```

---

## Task 6: Post-ship docs and quality gates

**Files:**
- Modify: `FEATURE_AUDIT.md`
- Modify: `data/roadmap.json`
- Modify: `BRAND_DESIGN_LANGUAGE.md` (minimal — confirm amber badge uses token, not raw class)

- [ ] **Step 1: Full test suite**

```bash
npx vitest run
```

Expected: all tests pass.

- [ ] **Step 2: Build verify**

```bash
npm run typecheck && npx vite build
```

- [ ] **Step 3: pr-check**

```bash
npx tsx scripts/pr-check.ts
```

- [ ] **Step 4: Update `FEATURE_AUDIT.md`**

Add the following entry at the end of the client-facing features section:

```markdown
## Feature 402: Action Playbooks Resolution
- **ID:** `action-playbooks-resolution`
- **Phase:** Phase 3.5
- **PR:** (add when opened)
- **Status:** Shipped
- **Description:** Closes the approval loop for client action cards. When a client approves an action, the system (1) notifies the admin team via email (`action_approved` event), (2) auto-generates a content brief for `content_decay` actions via the `ACTION_PLAYBOOK_EXECUTE` background job, and (3) surfaces non-automated approved actions in the admin UI with an "Awaiting implementation" badge and one-click "Mark complete" button.
- **Files:** `server/playbooks.ts`, `server/email-templates.ts` (action_approved), `server/email.ts` (notifyTeamActionApproved), `server/routes/client-actions.ts`, `shared/types/background-jobs.ts`, `src/components/admin/ClientActionsTab.tsx`
```

- [ ] **Step 5: Update `data/roadmap.json`**

Mark the Phase 3.5 roadmap item as done (see the pending roadmap items added earlier in this session).

Run:

```bash
npx tsx scripts/sort-roadmap.ts
```

- [ ] **Step 6: Final commit**

```bash
git add FEATURE_AUDIT.md data/roadmap.json BRAND_DESIGN_LANGUAGE.md
git commit -m "docs: update FEATURE_AUDIT and roadmap for Phase 3.5 action playbooks resolution"
```

---

## Self-Review

### Spec coverage check

| Requirement | Task |
|-------------|------|
| Email notification to admin on client approval | Task 2 — `notifyTeamActionApproved`, `action_approved` email event |
| Auto-generate content brief for `content_decay` approvals | Task 3 — `executeContentDecayPlaybook`, `ACTION_PLAYBOOK_EXECUTE` job |
| Admin UI surfaces approved-but-not-completed actions | Task 5 — "Awaiting implementation" badge |
| Admin can mark non-automated actions complete | Task 5 — "Mark complete" button → PATCH to existing admin endpoint |
| Job type registered in shared types | Task 1 — `BACKGROUND_JOB_TYPES.ACTION_PLAYBOOK_EXECUTE` |
| Integration test coverage | Tasks 2, 3, 4 — 7 assertions across 3 describe blocks |
| State machine guard: pending → completed blocked | Task 4 — test verifies 409 |
| Post-ship docs | Task 6 |

### Placeholder scan

No TBD/TODO entries. All code is complete and typed. The only dynamic lookup is "find the actual component path" in Task 5 Step 1–2 — this is intentional because the component name is not confirmed from the summary; the grep command in Step 1 resolves it before code is written.

### Type consistency

- `EmailEventType` extended with `'action_approved'` in Task 1, renderer uses it in Task 2, helper uses it in Task 2 — consistent.
- `BACKGROUND_JOB_TYPES.ACTION_PLAYBOOK_EXECUTE` added in Task 1, used in Task 3 playbooks.ts — consistent.
- `ClientAction` type imported from `shared/types/client-actions.ts` in playbooks.ts — uses the canonical type.
- `updateClientAction` called with `{ status: 'completed' }` — validated against `adminUpdateSchema.status` field which includes `'completed'`.
