# Action Playbooks Resolution — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

## Overview

When a client approves a `client_actions` card (sourceType: aeo_change, internal_link, redirect_proposal, keyword_strategy, content_decay), the system currently does nothing downstream — approval is a dead-end signal. This plan closes the loop: (1) fire an admin notification email, (2) auto-generate a content brief for `content_decay` approvals via a background job, and (3) surface all other approved actions in the admin UI with an "Awaiting implementation" badge and one-click "Mark complete" button. No new pages, no new DB tables.

## Pre-requisites

- [ ] Worktree is at `/Users/joshuahampson/CascadeProjects/asset-dashboard/.claude/worktrees/stupefied-goodall-96b059/` on branch `fix/approval-batch-note-persistence` (or a new branch cut from staging)
- [ ] No pre-plan audit required — this is new-file feature work, not a codebase-wide migration

---

## Task Dependencies

```
Sequential:
  Task 1 (Shared type contracts) — must commit before any agent starts

Parallel after Task 1:
  Task 2 (Email renderer + helper)  ∥  Task 3 (server/playbooks.ts)

Sequential after Task 2 + Task 3 both done:
  Task 4 (Wire into respond endpoint)

Parallel after Task 4:
  Task 5 (Admin UI badge + Mark complete)  ∥  Task 6 (Integration tests)

Sequential (after all above):
  Task 7 (Post-ship docs)
```

**Why Task 1 is a gate:** `server/email-templates.ts` (EmailEventType union) and `shared/types/background-jobs.ts` (BACKGROUND_JOB_TYPES) are shared imports. Tasks 2 and 3 both import from these files. They must be committed before any parallel agent reads them.

**Why Task 4 is a gate:** The respond endpoint imports from both `server/email.js` (Task 2) and `server/playbooks.js` (Task 3). It cannot be wired until both modules exist.

**Tasks 5 and 6 can be parallel:** the admin UI calls the existing PATCH endpoint (no new server code needed), and the integration tests exercise the respond endpoint directly.

---

## File Ownership

| Task | Owns (create/modify freely) | Must not touch |
|------|-----------------------------|----------------|
| 1 | `shared/types/background-jobs.ts`, `server/email-templates.ts` (EmailEventType only) | Everything else |
| 2 | `server/email-templates.ts` (renderer + renderDigest case), `server/email.ts` | All other files |
| 3 | `server/playbooks.ts` (new file) | All existing files |
| 4 | `server/routes/client-actions.ts` | All other files |
| 5 | `src/components/admin/ClientActionsTab.tsx` (or wherever approved actions render — grep first) | All server files |
| 6 | `tests/integration/action-playbooks.test.ts` (new file) | All non-test files |
| 7 | `FEATURE_AUDIT.md`, `data/roadmap.json`, `BRAND_DESIGN_LANGUAGE.md` | Source files |

---

## Task 1 — Shared Type Contracts (Model: haiku)

**Owns:** `shared/types/background-jobs.ts`, `server/email-templates.ts` (EmailEventType union only)  
**Must not touch:** any other file

- [ ] **Step 1: Add `ACTION_PLAYBOOK_EXECUTE` to `BACKGROUND_JOB_TYPES`**

Open `shared/types/background-jobs.ts`. Add one entry to `BACKGROUND_JOB_TYPES` const (after `SEO_BULK_ACCEPT_FIXES`):

```typescript
ACTION_PLAYBOOK_EXECUTE: 'action-playbook-execute',
```

Add the corresponding metadata entry to `BACKGROUND_JOB_METADATA` (the exhaustive map must stay in sync — TypeScript will error if a key is missing):

```typescript
[BACKGROUND_JOB_TYPES.ACTION_PLAYBOOK_EXECUTE]: {
  label: 'Action Playbook',
  description: 'Executes an automated implementation playbook after client approval.',
  cancellable: false,
  resultBehavior: 'domain-store',
},
```

- [ ] **Step 2: Add `'action_approved'` to `EmailEventType` union**

In `server/email-templates.ts`, find the `EmailEventType` union (currently ends with `'content_changes_requested'`). Add one entry:

```typescript
  | 'content_changes_requested'
  | 'action_approved';   // ← add
```

The `renderDigest()` switch has a `default:` branch, so TypeScript will not error yet — the renderer is added in Task 2.

- [ ] **Step 3: Typecheck**

```bash
npm run typecheck
```

Expected: zero errors.

- [ ] **Step 4: Commit (gates Task 2 and Task 3)**

```bash
git add shared/types/background-jobs.ts server/email-templates.ts
git commit -m "feat(contracts): add ACTION_PLAYBOOK_EXECUTE job type and action_approved email event type"
```

---

## Task 2 — Email Renderer + Admin Notification Helper (Model: sonnet)

**Owns:** `server/email-templates.ts` (renderer function + renderDigest case), `server/email.ts`  
**Must not touch:** `shared/types/background-jobs.ts`, `server/routes/client-actions.ts`, any test file

**Depends on:** Task 1 committed

- [ ] **Step 1: Read existing renderer pattern**

Read lines 273–320 of `server/email-templates.ts` to understand the `renderFeedbackNew` pattern — specifically how `itemRow()`, `layout()`, and `countPill()` are called. Match this pattern exactly.

- [ ] **Step 2: Add `renderActionApproved()` function**

After the `renderFeedbackNew()` function, add:

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

- [ ] **Step 3: Add case to `renderDigest()` switch**

Find the switch in `renderDigest()`. Add before the `default:` case:

```typescript
case 'action_approved':
  result = renderActionApproved(events, count, ws, dashUrl, logoUrl); break;
```

- [ ] **Step 4: Add `notifyTeamActionApproved()` to `server/email.ts`**

Find `notifyClientStatusChange()` in `server/email.ts`. After it, add:

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

- [ ] **Step 5: Typecheck**

```bash
npm run typecheck
```

Expected: zero errors.

- [ ] **Step 6: Commit**

```bash
git add server/email-templates.ts server/email.ts
git commit -m "feat: add action_approved email renderer and notifyTeamActionApproved helper"
```

---

## Task 3 — `server/playbooks.ts` (Model: sonnet)

**Owns:** `server/playbooks.ts` (new file — create it)  
**Must not touch:** any existing file  

**Depends on:** Task 1 committed  
**Parallel with:** Task 2

The playbook dispatcher is a thin switch — for `content_decay` it enqueues a background job; for all other types it is a no-op. This is intentionally extensible: future action types get a new `case`.

- [ ] **Step 1: Read `server/jobs.ts` createJob/updateJob signatures**

```bash
grep -n "export function createJob\|export function updateJob" server/jobs.ts
```

Confirm signatures:
- `createJob(type: BackgroundJobType | string, opts?: { message?: string; total?: number; workspaceId?: string }): Job`
- `updateJob(id: string, update: Partial<Omit<Job, 'id' | 'type' | 'createdAt'>>): void`

- [ ] **Step 2: Read `generateBrief` signature**

```bash
grep -n "export async function generateBrief" server/content-brief.ts
```

The function signature starts at line ~833. Note that `context` is a large optional object — only pass the fields available from the client action payload.

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
 * No-op for action types that have no automated playbook — those surface in the
 * admin UI as "Awaiting implementation" and are completed manually.
 */
export function enqueuePlaybook(workspaceId: string, action: ClientAction): void {
  switch (action.sourceType) {
    case 'content_decay':
      enqueueContentDecayPlaybook(workspaceId, action);
      break;
    // aeo_change, internal_link, keyword_strategy, redirect_proposal:
    // No automated playbook. Admin implements manually and marks complete via UI.
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

  // Fire-and-forget — runs async, updates job status on completion or error.
  void executeContentDecayPlaybook(workspaceId, action.id, job.id, targetKeyword, payload)
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

    // Transition the action to completed now that the brief exists.
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

- [ ] **Step 5: Commit**

```bash
git add server/playbooks.ts
git commit -m "feat: add server/playbooks.ts with enqueuePlaybook dispatcher and content_decay brief auto-generation"
```

---

## Task 4 — Wire into Respond Endpoint (Model: sonnet)

**Owns:** `server/routes/client-actions.ts`  
**Must not touch:** any other file  

**Depends on:** Task 2 AND Task 3 both committed

- [ ] **Step 1: Read `server/routes/client-actions.ts` imports block**

```bash
grep -n "^import" server/routes/client-actions.ts
```

Confirm what is already imported. `getWorkspace` and `getClientPortalUrl` are already present. Do not re-import them.

- [ ] **Step 2: Add two new imports**

At the top of the file with existing imports, add (do NOT add mid-file):

```typescript
import { notifyTeamActionApproved } from '../email.js';
import { enqueuePlaybook } from '../playbooks.js';
```

- [ ] **Step 3: Wire side effects after broadcastActionUpdate in the respond handler**

In `PATCH /api/public/client-actions/:workspaceId/:actionId/respond`, the current last two lines are:

```typescript
  broadcastActionUpdate(req.params.workspaceId, req.params.actionId, 'responded');
  res.json(updated);
```

Replace with:

```typescript
  broadcastActionUpdate(req.params.workspaceId, req.params.actionId, 'responded');

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

- [ ] **Step 4: Typecheck**

```bash
npm run typecheck
```

Expected: zero errors.

- [ ] **Step 5: pr-check**

```bash
npx tsx scripts/pr-check.ts
```

Expected: zero new errors.

- [ ] **Step 6: Commit**

```bash
git add server/routes/client-actions.ts
git commit -m "feat: wire notifyTeamActionApproved and enqueuePlaybook into client action respond endpoint"
```

---

## Task 5 — Admin UI Badge + Mark Complete Button (Model: sonnet)

**Owns:** the admin component that renders `client_actions` (grep to confirm path — likely `src/components/admin/ClientActionsTab.tsx`)  
**Must not touch:** any server file  

**Depends on:** Task 4 committed  
**Parallel with:** Task 6

- [ ] **Step 1: Find the admin component**

```bash
grep -rn "client-actions\|clientActions\|ClientAction" src/components/admin/ | grep -i "status\|approved" | head -20
```

Read the target component to understand existing status badge rendering before writing anything.

- [ ] **Step 2: Check for a typed API wrapper**

```bash
ls src/api/ | grep -i action
```

If a typed wrapper exists (e.g. `src/api/client-actions.ts`), use it for the mutation — do not use raw `fetch()` in the component.

- [ ] **Step 3: Check queryKey for client actions**

```bash
grep -n "clientActions\|client_actions" src/lib/queryKeys.ts | head -10
```

Note the exact key factory call — use it verbatim in `invalidateQueries`.

- [ ] **Step 4: Add the badge and button**

In the component's action card render path, for actions where `action.status === 'approved'`, add an amber badge:

```tsx
{action.status === 'approved' && (
  <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-[var(--radius-sm)] text-xs font-medium bg-amber-500/10 text-accent-warning border border-amber-500/20">
    Awaiting implementation
  </span>
)}
```

Add a `useMutation` hook (inside the component or in a local hook) that calls PATCH with `{ status: 'completed' }`:

```tsx
const queryClient = useQueryClient();
const markComplete = useMutation({
  mutationFn: async (actionId: string) => {
    // Use typed API wrapper if available, otherwise:
    const res = await fetch(`/api/client-actions/${workspaceId}/${actionId}`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        'x-auth-token': localStorage.getItem('auth_token') || '',
      },
      body: JSON.stringify({ status: 'completed' }),
    });
    if (!res.ok) throw new Error('Failed to mark complete');
    return res.json();
  },
  onSuccess: () => {
    queryClient.invalidateQueries({ queryKey: queryKeys.admin.clientActions(workspaceId) });
    // ↑ replace with the exact key factory from Step 3
  },
});
```

Add a "Mark complete" button beside the badge (teal CTA per design system):

```tsx
{action.status === 'approved' && (
  <button
    onClick={() => markComplete.mutate(action.id)}
    disabled={markComplete.isPending}
    className="px-3 py-1 rounded-[var(--radius-sm)] t-caption font-medium bg-teal-600 hover:bg-teal-500 text-white transition-colors disabled:opacity-50"
  >
    {markComplete.isPending ? 'Marking...' : 'Mark complete'}
  </button>
)}
```

- [ ] **Step 5: Typecheck and build**

```bash
npm run typecheck && npx vite build
```

Expected: zero errors, build succeeds.

- [ ] **Step 6: pr-check**

```bash
npx tsx scripts/pr-check.ts
```

Expected: zero new violations. If `rounded-lg` appears, replace with `rounded-[var(--radius-sm)]` as shown in Step 4.

- [ ] **Step 7: Commit**

```bash
git add src/components/admin/  # add only the modified component file
git commit -m "feat: add Awaiting implementation badge and Mark complete button for approved client actions"
```

---

## Task 6 — Integration Tests (Model: sonnet)

**Owns:** `tests/integration/action-playbooks.test.ts` (new file — port 13352)  
**Must not touch:** any non-test file  

**Depends on:** Task 4 committed  
**Parallel with:** Task 5

- [ ] **Step 1: Verify port 13352 is unused**

```bash
grep -r "createTestContext(" tests/integration/ | grep -oE "1[0-9]{4}" | sort -n | uniq | tail -5
```

Expected: 13351 or lower. If 13352 is already taken, use the next available port.

- [ ] **Step 2: Check test helper shape**

```bash
grep -n "clientToken\|clientEmail\|clientPassword\|clientLogin" tests/integration/helpers.ts | head -20
```

Confirm how to obtain a client JWT from the test context (either it's on the context object, or there's a login endpoint to call). Use whichever pattern the existing tests use.

- [ ] **Step 3: Create `tests/integration/action-playbooks.test.ts`**

```typescript
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createTestContext } from './helpers.js';

const PORT = 13352;
let ctx: Awaited<ReturnType<typeof createTestContext>>;
let testWsId: string;

beforeAll(async () => {
  ctx = await createTestContext(PORT);
  testWsId = ctx.workspaceId;
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

// Helper: obtain client JWT. Adjust based on what ctx exposes.
async function getClientToken(): Promise<string> {
  // If ctx.clientToken exists, return it directly:
  // return ctx.clientToken;
  //
  // Otherwise, login via the public endpoint:
  const res = await fetch(`http://localhost:${PORT}/api/public/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ workspaceId: testWsId, email: ctx.clientEmail, password: ctx.clientPassword }),
  });
  if (!res.ok) throw new Error(`Client login failed: ${res.status}`);
  const body = await res.json() as { token: string };
  return body.token;
}

describe('Action Playbooks — client respond endpoint', () => {
  it('approving an action returns 200 with status=approved', async () => {
    const createRes = await postJson(`/api/client-actions/${testWsId}`, {
      sourceType: 'internal_link',
      title: 'Add internal link',
      summary: 'Link from blog post to service page.',
    });
    expect(createRes.status).toBe(200);
    const action = await createRes.json() as { id: string };

    const clientToken = await getClientToken();
    const respondRes = await patchJson(
      `/api/public/client-actions/${testWsId}/${action.id}/respond`,
      { status: 'approved', clientNote: 'Looks great!' },
      `Bearer ${clientToken}`,
    );
    expect(respondRes.status).toBe(200);
    const updated = await respondRes.json() as { status: string; clientNote: string };
    expect(updated.status).toBe('approved');
    expect(updated.clientNote).toBe('Looks great!');
  });

  it('approving a content_decay action enqueues an action-playbook-execute job', async () => {
    const createRes = await postJson(`/api/client-actions/${testWsId}`, {
      sourceType: 'content_decay',
      title: 'Refresh: /blog/old-post',
      summary: 'Traffic down 40% in 90 days. Recommend refreshing content.',
      payload: { pageUrl: '/blog/old-post', targetKeyword: 'seo tips' },
    });
    expect(createRes.status).toBe(200);
    const action = await createRes.json() as { id: string };

    const clientToken = await getClientToken();
    const respondRes = await patchJson(
      `/api/public/client-actions/${testWsId}/${action.id}/respond`,
      { status: 'approved' },
      `Bearer ${clientToken}`,
    );
    expect(respondRes.status).toBe(200);

    // Job should be enqueued (check immediately — job is created synchronously before the async work starts)
    const jobsRes = await api(`/api/jobs?workspaceId=${testWsId}`);
    expect(jobsRes.status).toBe(200);
    const jobs = await jobsRes.json() as { type: string; workspaceId: string }[];
    expect(jobs.length).toBeGreaterThan(0); // guard before .some()
    const playbookJob = jobs.find(j => j.type === 'action-playbook-execute' && j.workspaceId === testWsId);
    expect(playbookJob).toBeDefined();
  });

  it('returns 409 when the action is not pending', async () => {
    const createRes = await postJson(`/api/client-actions/${testWsId}`, {
      sourceType: 'aeo_change',
      title: 'AEO header rewrite',
      summary: 'Add FAQ section.',
    });
    const action = await createRes.json() as { id: string };

    const clientToken = await getClientToken();
    // Approve once
    await patchJson(
      `/api/public/client-actions/${testWsId}/${action.id}/respond`,
      { status: 'approved' },
      `Bearer ${clientToken}`,
    );
    // Try to approve again — should 409
    const secondRes = await patchJson(
      `/api/public/client-actions/${testWsId}/${action.id}/respond`,
      { status: 'approved' },
      `Bearer ${clientToken}`,
    );
    expect(secondRes.status).toBe(409);
  });
});

describe('Action Playbooks — admin mark-complete flow', () => {
  it('admin PATCH to completed transitions an approved action', async () => {
    const createRes = await postJson(`/api/client-actions/${testWsId}`, {
      sourceType: 'redirect_proposal',
      title: 'Redirect old page',
      summary: 'Client approved redirect.',
    });
    const action = await createRes.json() as { id: string };

    const clientToken = await getClientToken();
    await patchJson(
      `/api/public/client-actions/${testWsId}/${action.id}/respond`,
      { status: 'approved' },
      `Bearer ${clientToken}`,
    );

    const completeRes = await patchJson(`/api/client-actions/${testWsId}/${action.id}`, { status: 'completed' });
    expect(completeRes.status).toBe(200);
    const completed = await completeRes.json() as { status: string };
    expect(completed.status).toBe('completed');
  });

  it('returns 409 when transitioning pending → completed directly (invalid)', async () => {
    const createRes = await postJson(`/api/client-actions/${testWsId}`, {
      sourceType: 'keyword_strategy',
      title: 'Keyword: target local seo',
      summary: 'Add to strategy.',
    });
    const action = await createRes.json() as { id: string };
    // Still pending — jump to completed should be rejected by the state machine
    const badRes = await patchJson(`/api/client-actions/${testWsId}/${action.id}`, { status: 'completed' });
    expect(badRes.status).toBe(409);
  });

  it('approved action appears in admin list', async () => {
    const createRes = await postJson(`/api/client-actions/${testWsId}`, {
      sourceType: 'aeo_change',
      title: 'AEO: Add FAQ block',
      summary: 'Add FAQ schema to service page.',
    });
    const action = await createRes.json() as { id: string };

    const clientToken = await getClientToken();
    await patchJson(
      `/api/public/client-actions/${testWsId}/${action.id}/respond`,
      { status: 'approved' },
      `Bearer ${clientToken}`,
    );

    const listRes = await api(`/api/client-actions/${testWsId}`);
    expect(listRes.status).toBe(200);
    const list = await listRes.json() as { id: string; status: string }[];
    expect(list.length).toBeGreaterThan(0); // guard before .find()
    const found = list.find(a => a.id === action.id);
    expect(found).toBeDefined();
    expect(found?.status).toBe('approved');
  });
});
```

- [ ] **Step 4: Run tests**

```bash
npx vitest run tests/integration/action-playbooks.test.ts
```

Expected: all 6 tests pass. If `pending → completed` returns 200 instead of 409, check `server/state-machines.ts` `CLIENT_ACTION_TRANSITIONS` to confirm the guard is in place.

- [ ] **Step 5: Full test suite**

```bash
npx vitest run
```

Expected: all existing tests still pass.

- [ ] **Step 6: Commit**

```bash
git add tests/integration/action-playbooks.test.ts
git commit -m "test: integration tests for action playbook approval flow and mark-complete"
```

---

## Task 7 — Post-Ship Docs (Model: haiku)

**Owns:** `FEATURE_AUDIT.md`, `data/roadmap.json`, `BRAND_DESIGN_LANGUAGE.md`  
**Must not touch:** any source file  

**Depends on:** all prior tasks committed and quality gates green

- [ ] **Step 1: Full quality gates**

```bash
npm run typecheck && npx vite build && npx vitest run && npx tsx scripts/pr-check.ts
```

All must pass before proceeding.

- [ ] **Step 2: Update `FEATURE_AUDIT.md`**

Add entry (next sequential feature number — check current highest):

```markdown
## Feature 402: Action Playbooks Resolution
- **ID:** `action-playbooks-resolution`
- **Phase:** Phase 3.5
- **PR:** #(fill when opened)
- **Flag:** none (always on — post-approval server side effects, not gated)
- **Status:** Shipped
- **Description:** Closes the client approval dead-end. On `approved` response: (1) admin team notified via `action_approved` email event; (2) `content_decay` actions auto-create a content brief via `ACTION_PLAYBOOK_EXECUTE` background job and transition to `completed`; (3) all other approved actions surface in admin UI with "Awaiting implementation" badge + one-click "Mark complete" button.
- **Files:** `server/playbooks.ts` (new), `server/email-templates.ts`, `server/email.ts`, `server/routes/client-actions.ts`, `shared/types/background-jobs.ts`, admin ClientActionsTab component
```

- [ ] **Step 3: Update `data/roadmap.json`**

Mark `client-inbox-phase35-action-playbooks-resolution` status from `"pending"` → `"done"`, add `"shippedAt": "YYYY-MM-DD"` and `"notes": "Shipped PR #X."` then run:

```bash
npx tsx scripts/sort-roadmap.ts
```

- [ ] **Step 4: Update `BRAND_DESIGN_LANGUAGE.md`**

Add a note under the client actions / inbox section: "Approved client actions show an amber `Awaiting implementation` badge (`bg-amber-500/10 text-accent-warning`) and a teal "Mark complete" CTA in the admin UI."

- [ ] **Step 5: Commit**

```bash
git add FEATURE_AUDIT.md data/roadmap.json BRAND_DESIGN_LANGUAGE.md
git commit -m "docs: update FEATURE_AUDIT, roadmap, and brand doc for Phase 3.5 action playbooks resolution"
```

---

## Systemic Improvements

**Shared utilities introduced:**
- `server/playbooks.ts` — `enqueuePlaybook(workspaceId, action)` is the extension point for future action types. Next sourceType gets a new `case` here, not a change to the route.

**pr-check rules to consider adding** (not required for this PR, file as separate task if desired):
- After this ships, a rule flagging any `respond` endpoint handler that doesn't call `enqueuePlaybook()` could prevent future action types from being wired without a playbook.

**New tests added:**
- `tests/integration/action-playbooks.test.ts` — 6 assertions: approval returns 200, content_decay enqueues a job, double-approve returns 409, admin mark-complete transitions status, pending→completed is blocked, approved action appears in list.

---

## Verification Strategy

After all tasks committed:

```bash
# Type safety
npm run typecheck

# Production build
npx vite build

# Full test suite (not just new tests)
npx vitest run

# pr-check (zero violations)
npx tsx scripts/pr-check.ts

# Targeted integration test
npx vitest run tests/integration/action-playbooks.test.ts --reporter=verbose
```

**Manual QA on staging (after PR merged to staging):**

1. Create a `content_decay` client action via admin: `POST /api/client-actions/:workspaceId`
2. Approve it via the client portal
3. Check `GET /api/jobs?workspaceId=X` — should have a job with `type: "action-playbook-execute"`
4. Check content briefs list — a new brief should appear once the job completes
5. Create an `internal_link` action, approve it — no job created, but action appears in admin list with "Awaiting implementation" badge
6. Click "Mark complete" — badge disappears, status becomes `completed`
7. Check admin notification inbox — `action_approved` email should have been queued (visible in SMTP logs if NOTIFICATION_EMAIL is set)
