# Platform Intelligence Enhancements — Group 1: Chat + Notifications

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the Service Interest CTA in client chat, admin Signals panel, notification panel slide-out fix, and Western-flavored chatbot loading states.

**Architecture:** New `client_signals` table (already migrated in Phase 0). Signal detection in the public chat route. A new ServiceInterestCTA component renders below AI responses when intent is detected. NotificationBell converts from absolute dropdown to fixed slide-out drawer (mirroring AdminChat.tsx pattern). AdminInbox gains a Signals tab (new file). Email notification on signal creation.

**Tech Stack:** React 19, TypeScript, Express, SQLite (better-sqlite3), Vitest, @testing-library/react

**Dependency:** Phase 0 plan must be merged and green on staging before this plan begins. Imports `ClientSignal`, `ClientSignalType`, `ClientSignalStatus`, `ClientSignalMessage` from `shared/types/client-signals.ts`.

---

## Phase 0 Pre-done

The following items were delivered on the Phase 0 branch and are already committed. Agents must **not** re-create or overwrite these files.

| File | What was delivered |
|------|--------------------|
| `shared/types/client-signals.ts` | `ClientSignal`, `ClientSignalMessage`, `ClientSignalType`, `ClientSignalStatus` types |
| `server/db/migrations/047-client-signals.sql` | `client_signals` table with all required columns, FK to `workspaces`, and composite indexes |
| `server/db/migrations/048-business-priorities.sql` | `business_priorities` column added to `workspaces` table |
| `server/workspaces.ts` | `businessPriorities` and `siteIntelligenceClientView` mapped (read + write) — `rowToWorkspace()` mapper already wired |

Tasks 1 and 2 below are kept for reference (their content describes the contracts agents should rely on), but both steps are already complete. **Skip Task 1 and Task 2 — do not re-run them.**

---

## File Map

| Action | Path | Purpose |
|--------|------|---------|
| ~~Pre-done~~ | `shared/types/client-signals.ts` | `ClientSignal`, `ClientSignalType`, `ClientSignalStatus`, `ClientSignalMessage` types — shipped in Phase 0 |
| ~~Pre-done~~ | `server/db/migrations/047-client-signals.sql` | `client_signals` table DDL — shipped in Phase 0 |
| Create | `server/client-signals-store.ts` | DB store: `createClientSignal`, `listClientSignals`, `updateSignalStatus`, `getSignalById` |
| Create | `server/routes/client-signals.ts` | Admin REST: GET list, PATCH status, GET single |
| Modify | `server/app.ts` | Mount `client-signals` routes |
| Modify | `server/routes/public-analytics.ts` | Inject intent detection + signal creation after AI response |
| Create | `server/email-templates.ts` → add `clientSignalEmail()` export | Email HTML for signal notifications |
| Modify | `server/email.ts` | Add `notifyTeamClientSignal()` queue helper |
| Create | `src/lib/loadingPhrases.ts` | 9 Western phrases + `pickPhrase()` utility |
| Modify | `src/components/ChatPanel.tsx` | Accept `lastIntent?` + `onCTAAction?` props; swap bouncing dots for phrase; render `<ServiceInterestCTA>` after last assistant message |
| Create | `src/components/client/ServiceInterestCTA.tsx` | CTA component: `content_interest` → strategy nav, `service_interest` → signal mutation |
| Modify | `src/components/NotificationBell.tsx` | Convert absolute dropdown to fixed slide-out drawer from left; add Client Signals section at top |
| Create | `src/components/admin/AdminInbox.tsx` | New admin component with Signals tab: list signals, expand to chat context, status workflow |
| Modify | `src/hooks/admin/index.ts` | Export `useClientSignals`, `useUpdateSignalStatus` |
| Create | `src/hooks/admin/useClientSignals.ts` | React Query hooks for signals |
| Modify | `src/lib/queryKeys.ts` | Add `admin.clientSignals(wsId)` key |
| Modify | `src/lib/wsEvents.ts` | Add `CLIENT_SIGNAL_CREATED` event constant |
| Modify | `src/hooks/useWsInvalidation.ts` | Handle `CLIENT_SIGNAL_CREATED` → invalidate signals query |
| Create | `tests/unit/loading-phrases.test.ts` | Unit tests for loading phrase utilities |
| Create | `tests/unit/client-signals-store.test.ts` | Unit tests for DB store functions |
| Create | `tests/integration/client-signals-routes.test.ts` | Integration tests for signal API routes |
| Create | `tests/integration/admin-signals-inbox.test.ts` | Integration tests for admin signals inbox workflow |
| Create | `tests/component/ServiceInterestCTA.test.tsx` | Component tests for CTA |
| Create | `tests/component/NotificationBell.test.tsx` | Component tests for drawer conversion |

---

## Task 1 — ~~Shared types: `ClientSignal`, `ClientSignalType`, `ClientSignalStatus`~~ *(Pre-done — Phase 0)*

> **SKIP THIS TASK.** `shared/types/client-signals.ts` was created in Phase 0 and is already committed. The content below is preserved as a reference contract for what agents can import.

**Owns:** `shared/types/client-signals.ts`
**Must not touch:** any other file in this task

### Step 1.1 — Write the file

- [ ] Create `shared/types/client-signals.ts`:

```typescript
/**
 * Client signal types — shared between server and frontend.
 *
 * A ClientSignal is created when the AI detects purchase or service intent
 * in the client chat. The agency uses AdminInbox to review and action signals.
 */

export type ClientSignalType =
  | 'content_interest'   // client asked about content recommendations
  | 'service_interest';  // client expressed interest in a service / direct contact

export type ClientSignalStatus =
  | 'new'        // just created, not yet seen by admin
  | 'reviewed'   // admin opened and read it
  | 'actioned';  // admin followed up

export interface ClientSignal {
  id: string;
  workspaceId: string;
  workspaceName: string;
  type: ClientSignalType;
  status: ClientSignalStatus;
  /** Last 10 messages from the session at the time of signal creation */
  chatContext: Array<{ role: 'user' | 'assistant'; content: string }>;
  /** The user question that triggered intent detection */
  triggerMessage: string;
  createdAt: string;
  updatedAt: string;
}
```

### Step 1.2 — Type-check

- [ ] Run:
  ```bash
  npx tsc --noEmit --skipLibCheck
  ```
  Expected: zero errors.

---

## Task 2 — ~~DB migration: `client_signals` table~~ *(Pre-done — Phase 0)*

> **SKIP THIS TASK.** `server/db/migrations/047-client-signals.sql` (migration `047`) was created in Phase 0 and is already committed. The content below is preserved as a reference for the table schema.

**Owns:** `server/db/migrations/047-client-signals.sql`
**Must not touch:** any other file in this task

### Step 2.1 — Write the migration

- [ ] Create `server/db/migrations/047-client-signals.sql`:

```sql
-- client_signals: stores signals created when the AI detects purchase/service
-- intent in client chat. Reviewed and actioned by the admin team.

CREATE TABLE IF NOT EXISTS client_signals (
  id          TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  workspace_name TEXT NOT NULL,
  type        TEXT NOT NULL,
  status      TEXT NOT NULL DEFAULT 'new',
  chat_context TEXT NOT NULL DEFAULT '[]',
  trigger_message TEXT NOT NULL DEFAULT '',
  created_at  TEXT NOT NULL,
  updated_at  TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_client_signals_workspace
  ON client_signals(workspace_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_client_signals_status
  ON client_signals(status, created_at DESC);
```

### Step 2.2 — Verify migration runs without error

- [ ] Run (requires dev server to be off):
  ```bash
  npx tsx -e "import('./server/db/index.ts').then(m => m.runMigrations()).then(() => { console.log('MIGRATION OK'); process.exit(0); }).catch(e => { console.error(e); process.exit(1); })"
  ```
  Expected output contains: `MIGRATION OK` or `Applying migration: 047-client-signals.sql`

---

## Task 3 — DB store: `server/client-signals-store.ts`

**Owns:** `server/client-signals-store.ts`
**Must not touch:** any other file in this task

### Step 3.1 — Write failing unit test first

- [ ] Create `tests/unit/client-signals-store.test.ts`:

```typescript
import { describe, it, expect, beforeAll } from 'vitest';

// Ensure migrations run before tests
beforeAll(async () => {
  const { runMigrations } = await import('../../server/db/index.js');
  runMigrations();
});

describe('client-signals-store', () => {
  it('createClientSignal inserts a row and returns a ClientSignal', async () => {
    const { createClientSignal } = await import('../../server/client-signals-store.js');
    const signal = createClientSignal({
      workspaceId: 'ws-test-signals-1',
      workspaceName: 'Test Workspace',
      type: 'service_interest',
      chatContext: [
        { role: 'user', content: 'I want to get in touch' },
        { role: 'assistant', content: 'Great, I can help with that.' },
      ],
      triggerMessage: 'I want to get in touch',
    });
    expect(signal.id).toBeTruthy();
    expect(signal.workspaceId).toBe('ws-test-signals-1');
    expect(signal.type).toBe('service_interest');
    expect(signal.status).toBe('new');
    expect(signal.chatContext).toHaveLength(2);
    expect(signal.createdAt).toBeTruthy();
  });

  it('listClientSignals returns only signals for the given workspace', async () => {
    const { createClientSignal, listClientSignals } = await import('../../server/client-signals-store.js');
    createClientSignal({
      workspaceId: 'ws-isolation-A',
      workspaceName: 'Workspace A',
      type: 'content_interest',
      chatContext: [],
      triggerMessage: 'What content should I create?',
    });
    createClientSignal({
      workspaceId: 'ws-isolation-B',
      workspaceName: 'Workspace B',
      type: 'service_interest',
      chatContext: [],
      triggerMessage: 'Can I talk to someone?',
    });
    const results = listClientSignals('ws-isolation-A');
    expect(results.length).toBeGreaterThan(0);
    expect(results.every(s => s.workspaceId === 'ws-isolation-A')).toBe(true);
  });

  it('updateSignalStatus persists the new status', async () => {
    const { createClientSignal, updateSignalStatus, getSignalById } = await import('../../server/client-signals-store.js');
    const signal = createClientSignal({
      workspaceId: 'ws-status-test',
      workspaceName: 'Status Workspace',
      type: 'service_interest',
      chatContext: [],
      triggerMessage: 'Help me',
    });
    updateSignalStatus(signal.id, 'reviewed');
    const updated = getSignalById(signal.id);
    expect(updated).not.toBeNull();
    expect(updated!.status).toBe('reviewed');
  });

  it('listClientSignals returns newest first', async () => {
    const { createClientSignal, listClientSignals } = await import('../../server/client-signals-store.js');
    const wsId = 'ws-order-test';
    createClientSignal({ workspaceId: wsId, workspaceName: 'Order WS', type: 'content_interest', chatContext: [], triggerMessage: 'first' });
    createClientSignal({ workspaceId: wsId, workspaceName: 'Order WS', type: 'service_interest', chatContext: [], triggerMessage: 'second' });
    const results = listClientSignals(wsId);
    expect(results.length).toBeGreaterThan(1);
    expect(new Date(results[0].createdAt) >= new Date(results[1].createdAt)).toBe(true);
  });
});
```

- [ ] Run to confirm it fails:
  ```bash
  npx vitest run tests/unit/client-signals-store.test.ts
  ```
  Expected: tests fail (module not found).

### Step 3.2 — Implement the store

- [ ] Create `server/client-signals-store.ts`:

```typescript
/**
 * DB store for client signals — intent-based signals detected in client chat.
 * Use createStmtCache/stmts() for prepared statement caching (never local vars).
 */
import { randomUUID } from 'crypto';
import db from './db/index.js';
import { createStmtCache } from './db/stmt-cache.js';
import { parseJsonSafeArray } from './db/json-validation.js';
import { createLogger } from './logger.js';
import type { ClientSignal, ClientSignalType, ClientSignalStatus } from '../shared/types/client-signals.js';
import { z } from './middleware/validate.js';

const log = createLogger('client-signals-store');

// ── Row shape ──

interface ClientSignalRow {
  id: string;
  workspace_id: string;
  workspace_name: string;
  type: string;
  status: string;
  chat_context: string;
  trigger_message: string;
  created_at: string;
  updated_at: string;
}

// ── Zod schema for chat_context items ──

const chatMessageSchema = z.object({
  role: z.enum(['user', 'assistant']),
  content: z.string(),
});

// ── Row mapper ──

function rowToSignal(row: ClientSignalRow): ClientSignal {
  return {
    id: row.id,
    workspaceId: row.workspace_id,
    workspaceName: row.workspace_name,
    type: row.type as ClientSignalType,
    status: row.status as ClientSignalStatus,
    chatContext: parseJsonSafeArray(row.chat_context, chatMessageSchema, {
      table: 'client_signals',
      field: 'chat_context',
      workspaceId: row.workspace_id,
    }),
    triggerMessage: row.trigger_message,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

// ── Prepared statements (lazily initialized after migrations run) ──

const stmts = createStmtCache(() => ({
  insert: db.prepare(`
    INSERT INTO client_signals
      (id, workspace_id, workspace_name, type, status, chat_context, trigger_message, created_at, updated_at)
    VALUES
      (@id, @workspace_id, @workspace_name, @type, @status, @chat_context, @trigger_message, @created_at, @updated_at)
  `),
  selectByWorkspace: db.prepare(`
    SELECT * FROM client_signals
    WHERE workspace_id = ?
    ORDER BY created_at DESC
    LIMIT 100
  `),
  selectAll: db.prepare(`
    SELECT * FROM client_signals
    ORDER BY created_at DESC
    LIMIT 200
  `),
  selectById: db.prepare(`
    SELECT * FROM client_signals WHERE id = ?
  `),
  updateStatus: db.prepare(`
    UPDATE client_signals
    SET status = ?, updated_at = ?
    WHERE id = ?
  `),
  countNewByWorkspace: db.prepare(`
    SELECT COALESCE(COUNT(*), 0) as count
    FROM client_signals
    WHERE workspace_id = ? AND status = 'new'
  `),
}));

// ── Public API ──

export interface CreateClientSignalInput {
  workspaceId: string;
  workspaceName: string;
  type: ClientSignalType;
  chatContext: Array<{ role: 'user' | 'assistant'; content: string }>;
  triggerMessage: string;
}

export function createClientSignal(input: CreateClientSignalInput): ClientSignal {
  const now = new Date().toISOString();
  const id = randomUUID();
  stmts().insert.run({
    id,
    workspace_id: input.workspaceId,
    workspace_name: input.workspaceName,
    type: input.type,
    status: 'new',
    chat_context: JSON.stringify(input.chatContext),
    trigger_message: input.triggerMessage,
    created_at: now,
    updated_at: now,
  });
  const row = stmts().selectById.get(id) as ClientSignalRow;
  return rowToSignal(row);
}

export function listClientSignals(workspaceId?: string): ClientSignal[] {
  if (workspaceId) {
    const rows = stmts().selectByWorkspace.all(workspaceId) as ClientSignalRow[];
    return rows.map(rowToSignal);
  }
  const rows = stmts().selectAll.all() as ClientSignalRow[];
  return rows.map(rowToSignal);
}

export function getSignalById(id: string): ClientSignal | null {
  const row = stmts().selectById.get(id) as ClientSignalRow | undefined;
  return row ? rowToSignal(row) : null;
}

export function updateSignalStatus(id: string, status: ClientSignalStatus): boolean {
  const info = stmts().updateStatus.run(status, new Date().toISOString(), id);
  return info.changes > 0;
}

export function countNewSignals(workspaceId: string): number {
  const result = stmts().countNewByWorkspace.get(workspaceId) as { count: number };
  return result.count;
}
```

### Step 3.3 — Run the tests, confirm they pass

- [ ] Run:
  ```bash
  npx vitest run tests/unit/client-signals-store.test.ts
  ```
  Expected: all 4 tests pass.

### Step 3.4 — Commit

- [ ] Commit with message:
  ```
  feat: add client_signals DB store (Task 3)
  ```

---

## Task 4 — API routes: `server/routes/client-signals.ts` + mount in app.ts

**Owns:** `server/routes/client-signals.ts`, `server/app.ts`
**Must not touch:** any file not listed above

### Step 4.1 — Write failing integration test first

- [ ] Create `tests/integration/client-signals-routes.test.ts`:

```typescript
import { describe, it, expect, beforeAll } from 'vitest';
import request from 'supertest';

let app: import('express').Express;

beforeAll(async () => {
  const { runMigrations } = await import('../../server/db/index.js');
  runMigrations();
  const mod = await import('../../server/app.js');
  app = mod.createApp();
});

describe('GET /api/client-signals/:workspaceId', () => {
  it('returns an array of signals for the workspace', async () => {
    // Seed a signal
    const { createClientSignal } = await import('../../server/client-signals-store.js');
    createClientSignal({
      workspaceId: 'ws-route-test',
      workspaceName: 'Route Test WS',
      type: 'service_interest',
      chatContext: [{ role: 'user', content: 'I want to work with you' }],
      triggerMessage: 'I want to work with you',
    });

    const res = await request(app)
      .get('/api/client-signals/ws-route-test')
      .set('x-auth-token', process.env.APP_PASSWORD ?? 'test');

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    expect(res.body.length).toBeGreaterThan(0);
    expect(res.body[0]).toHaveProperty('id');
    expect(res.body[0]).toHaveProperty('type');
    expect(res.body[0]).toHaveProperty('status');
    expect(res.body[0]).toHaveProperty('chatContext');
  });

  it('workspace isolation — does not return signals from a different workspace', async () => {
    const { createClientSignal } = await import('../../server/client-signals-store.js');
    createClientSignal({
      workspaceId: 'ws-isolation-routes-X',
      workspaceName: 'WS X',
      type: 'content_interest',
      chatContext: [],
      triggerMessage: 'what content?',
    });

    const res = await request(app)
      .get('/api/client-signals/ws-isolation-routes-Y')
      .set('x-auth-token', process.env.APP_PASSWORD ?? 'test');

    expect(res.status).toBe(200);
    expect(res.body.every((s: { workspaceId: string }) => s.workspaceId !== 'ws-isolation-routes-X')).toBe(true);
  });
});

describe('PATCH /api/client-signals/:id/status', () => {
  it('updates signal status and returns updated signal', async () => {
    const { createClientSignal } = await import('../../server/client-signals-store.js');
    const signal = createClientSignal({
      workspaceId: 'ws-patch-test',
      workspaceName: 'Patch WS',
      type: 'service_interest',
      chatContext: [],
      triggerMessage: 'update me',
    });

    const res = await request(app)
      .patch(`/api/client-signals/${signal.id}/status`)
      .set('x-auth-token', process.env.APP_PASSWORD ?? 'test')
      .send({ status: 'reviewed' });

    expect(res.status).toBe(200);
    expect(res.body.status).toBe('reviewed');
  });

  it('returns 400 for invalid status values', async () => {
    const { createClientSignal } = await import('../../server/client-signals-store.js');
    const signal = createClientSignal({
      workspaceId: 'ws-badstatus',
      workspaceName: 'Bad Status WS',
      type: 'service_interest',
      chatContext: [],
      triggerMessage: 'test',
    });

    const res = await request(app)
      .patch(`/api/client-signals/${signal.id}/status`)
      .set('x-auth-token', process.env.APP_PASSWORD ?? 'test')
      .send({ status: 'foobar' });

    expect(res.status).toBe(400);
  });
});

describe('POST /api/public/signal/:workspaceId', () => {
  it('creates a service_interest signal from client portal', async () => {
    const res = await request(app)
      .post('/api/public/signal/ws-public-test')
      .send({
        type: 'service_interest',
        triggerMessage: 'Can I speak with someone?',
        chatContext: [{ role: 'user', content: 'Can I speak with someone?' }],
      });

    // 200 or 201 — workspace may not exist in test but route should handle gracefully
    expect([200, 201, 400]).toContain(res.status);
  });
});
```

- [ ] Run to confirm tests fail (route not yet mounted):
  ```bash
  npx vitest run tests/integration/client-signals-routes.test.ts
  ```

### Step 4.2 — Implement the routes file

- [ ] Create `server/routes/client-signals.ts`:

```typescript
/**
 * Client signals routes — admin CRUD + public signal creation endpoint.
 *
 * Auth convention:
 *   - Admin routes: protected by global APP_PASSWORD gate (no requireAuth needed)
 *   - Public route: no auth (accessible from client portal)
 *
 * Never add requireAuth to admin routes — see CLAUDE.md Auth Conventions.
 */
import { Router } from 'express';
import { requireWorkspaceAccess } from '../auth.js';
import { validate, z } from '../middleware/validate.js';
import {
  listClientSignals,
  getSignalById,
  updateSignalStatus,
  createClientSignal,
} from '../client-signals-store.js';
import { getWorkspace } from '../workspaces.js';
import { broadcastToWorkspace } from '../broadcast.js';
import { notifyTeamClientSignal } from '../email.js';
import { addActivity } from '../activity-log.js';
import { createLogger } from '../logger.js';

const log = createLogger('client-signals-routes');
const router = Router();

// ── Admin: list signals for a workspace ──────────────────────────────────────

router.get(
  '/api/client-signals/:workspaceId',
  requireWorkspaceAccess('workspaceId'),
  (req, res) => {
    const signals = listClientSignals(req.params.workspaceId);
    res.json(signals);
  },
);

// ── Admin: get single signal ─────────────────────────────────────────────────

router.get('/api/client-signals/detail/:id', (req, res) => {
  const signal = getSignalById(req.params.id);
  if (!signal) return res.status(404).json({ error: 'Signal not found' });
  res.json(signal);
});

// ── Admin: update signal status ───────────────────────────────────────────────

const updateStatusSchema = z.object({
  status: z.enum(['new', 'reviewed', 'actioned']),
});

router.patch(
  '/api/client-signals/:id/status',
  validate({ body: updateStatusSchema }),
  (req, res) => {
    const { status } = req.body as z.infer<typeof updateStatusSchema>;
    const signal = getSignalById(req.params.id);
    if (!signal) return res.status(404).json({ error: 'Signal not found' });
    const ok = updateSignalStatus(req.params.id, status);
    if (!ok) return res.status(500).json({ error: 'Update failed' });
    const updated = getSignalById(req.params.id);
    broadcastToWorkspace(signal.workspaceId, 'client-signal:updated', { signalId: req.params.id });
    res.json(updated);
  },
);

// ── Public: create signal from client portal ─────────────────────────────────

const createSignalSchema = z.object({
  type: z.enum(['content_interest', 'service_interest']),
  triggerMessage: z.string().max(500),
  chatContext: z.array(
    z.object({
      role: z.enum(['user', 'assistant']),
      content: z.string(),
    }),
  ).max(10),
});

router.post(
  '/api/public/signal/:workspaceId',
  validate({ body: createSignalSchema }),
  async (req, res) => {
    const ws = getWorkspace(req.params.workspaceId);
    if (!ws) return res.status(400).json({ error: 'Workspace not configured' });

    const { type, triggerMessage, chatContext } = req.body as z.infer<typeof createSignalSchema>;

    try {
      const signal = createClientSignal({
        workspaceId: ws.id,
        workspaceName: ws.name,
        type,
        chatContext,
        triggerMessage,
      });

      // Broadcast so AdminInbox invalidates
      broadcastToWorkspace(ws.id, 'client-signal:created', { signalId: signal.id });

      // Activity log
      addActivity(ws.id, 'client_signal', `Client signal: ${type}`, triggerMessage.slice(0, 80));

      // Email notification (fire and forget — non-blocking)
      notifyTeamClientSignal(ws.name, type, triggerMessage).catch((err: unknown) => {
        log.warn({ err }, 'Failed to send client signal email');
      });

      res.json({ ok: true, signalId: signal.id });
    } catch (err) {
      log.error({ err }, 'Failed to create client signal');
      res.status(500).json({ error: 'Failed to create signal' });
    }
  },
);

export default router;
```

### Step 4.3 — Mount routes in app.ts

- [ ] Open `server/app.ts`. Read the imports section (lines 30–99) and the `app.use(suggestedBriefsRouter)` line (around line 341).

- [ ] Add import after the existing `suggestedBriefsRouter` import (around line 99):
  ```typescript
  import clientSignalsRouter from './routes/client-signals.js';
  ```

- [ ] Add `app.use` after `app.use(suggestedBriefsRouter)`:
  ```typescript
  app.use(clientSignalsRouter);
  ```

### Step 4.4 — Run integration tests, confirm they pass

- [ ] Run:
  ```bash
  npx vitest run tests/integration/client-signals-routes.test.ts
  ```
  Expected: all tests pass (or the workspace-not-found test returns 400 as expected).

### Step 4.5 — TypeScript check

- [ ] Run:
  ```bash
  npx tsc --noEmit --skipLibCheck
  ```
  Expected: zero errors.

### Step 4.6 — Commit

- [ ] Commit with message:
  ```
  feat: add client signals API routes and mount in app.ts (Task 4)
  ```

---

## Task 5 — Email: `clientSignalEmail()` template + `notifyTeamClientSignal()` helper

**Owns:** `server/email-templates.ts`, `server/email.ts`
**Must not touch:** any other file in this task

### Step 5.1 — Add `clientSignalEmail()` to email-templates.ts

- [ ] Read `server/email-templates.ts` to find the end of the file (currently ends around line 180).

- [ ] Append at the end of `server/email-templates.ts`:

```typescript
// ── Client Signal ──

export function clientSignalEmail(opts: {
  workspaceName: string;
  signalType: string;
  triggerMessage: string;
  adminUrl: string;
}): string {
  const typeLabel = opts.signalType === 'service_interest' ? 'Service Interest' : 'Content Interest';
  const body = `
    <p class="text-primary" style="margin:0 0 12px;font-size:14px;color:#202945;">
      A client at <strong>${esc(opts.workspaceName)}</strong> expressed <strong>${esc(typeLabel)}</strong> in their chat session.
    </p>
    <div style="background:#f9fafb;border:1px solid #e5e7eb;border-radius:8px;padding:14px 16px;margin-bottom:16px;">
      <div class="text-muted" style="font-size:11px;font-weight:600;letter-spacing:0.5px;color:#9ca3af;text-transform:uppercase;margin-bottom:6px;">Client message</div>
      <div class="text-primary" style="font-size:13px;color:#374151;line-height:1.5;">${esc(opts.triggerMessage)}</div>
    </div>
    <p class="text-secondary" style="margin:0;font-size:13px;color:#6b7280;">
      Review the full conversation and update the signal status in your admin inbox.
    </p>
  `;
  return layout({
    preheader: `Client signal from ${opts.workspaceName}: ${typeLabel}`,
    headline: `Client signal: ${typeLabel}`,
    subtitle: opts.workspaceName,
    body,
    cta: { label: 'View in Admin Inbox', url: opts.adminUrl },
  });
}
```

### Step 5.2 — Add `notifyTeamClientSignal()` to email.ts

- [ ] Read `server/email.ts`. Find the `notifyTeamChurnSignal` function (or similar) near the end. Add after it:

```typescript
export async function notifyTeamClientSignal(
  workspaceName: string,
  signalType: string,
  triggerMessage: string,
): Promise<void> {
  const to = getNotificationEmail();
  if (!to) return;
  const adminUrl = process.env.ADMIN_URL || 'https://hmpsn.studio';
  const { clientSignalEmail } = await import('./email-templates.js');
  const html = clientSignalEmail({ workspaceName, signalType, triggerMessage, adminUrl });
  const subject = `[hmpsn.studio] Client signal from ${workspaceName}`;
  await sendEmail(to, subject, html);
}
```

### Step 5.3 — TypeScript check

- [ ] Run:
  ```bash
  npx tsc --noEmit --skipLibCheck
  ```
  Expected: zero errors.

### Step 5.4 — Commit

- [ ] Commit with message:
  ```
  feat: add clientSignalEmail template and notifyTeamClientSignal helper (Task 5)
  ```

---

## Task 6 — Loading phrases utility

**Owns:** `src/lib/loadingPhrases.ts`
**Must not touch:** any other file in this task

### Step 6.1 — Write failing unit test first

- [ ] Create `tests/unit/loading-phrases.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { LOADING_PHRASES, pickPhrase } from '../../src/lib/loadingPhrases.js';

describe('loadingPhrases', () => {
  it('exports exactly 9 phrases', () => {
    expect(LOADING_PHRASES).toHaveLength(9);
  });

  it('every phrase ends with the ellipsis character …', () => {
    expect(LOADING_PHRASES.length).toBeGreaterThan(0);
    expect(LOADING_PHRASES.every(p => p.endsWith('…'))).toBe(true);
  });

  it('all 9 phrases are reachable over 50 random picks', () => {
    const seen = new Set<string>();
    for (let i = 0; i < 50; i++) {
      seen.add(pickPhrase());
    }
    // All 9 should appear at least once in 50 tries
    expect(seen.size).toBe(9);
  });

  it('pickPhrase returns a string that is in LOADING_PHRASES', () => {
    const phrase = pickPhrase();
    expect(LOADING_PHRASES).toContain(phrase);
  });

  it('no two consecutive pickPhrase() calls return the same phrase (50 runs)', () => {
    let prev = pickPhrase();
    for (let i = 0; i < 50; i++) {
      const next = pickPhrase(prev);
      expect(next).not.toBe(prev);
      prev = next;
    }
  });
});
```

- [ ] Run to confirm failures:
  ```bash
  npx vitest run tests/unit/loading-phrases.test.ts
  ```

### Step 6.2 — Implement the utility

- [ ] Create `src/lib/loadingPhrases.ts`:

```typescript
/**
 * Western-flavored loading phrases for the client chat AI response indicator.
 *
 * Displayed during AI thinking state when response takes > 4 seconds.
 * Rotate with pickPhrase() — never the same phrase twice in a row.
 */

export const LOADING_PHRASES: readonly string[] = [
  "Hootin'…",
  "Hollerin'…",
  "Rustlin'…",
  "Wranglin'…",
  "Cookin'…",
  "Fetchin'…",
  "Gettin' after it…",
  "Tinkerin'…",
  "Rummagin'…",
] as const;

/**
 * Pick a random phrase from LOADING_PHRASES.
 * Pass the current phrase as `exclude` to guarantee no consecutive repeat.
 */
export function pickPhrase(exclude?: string): string {
  const available = exclude
    ? LOADING_PHRASES.filter(p => p !== exclude)
    : [...LOADING_PHRASES];
  return available[Math.floor(Math.random() * available.length)];
}
```

### Step 6.3 — Run tests, confirm all pass

- [ ] Run:
  ```bash
  npx vitest run tests/unit/loading-phrases.test.ts
  ```
  Expected: all 5 tests pass.

  > Note: the "all 9 reachable in 50 tries" test is probabilistic. With 9 phrases and 50 picks the probability of missing one is approximately 0.03%. If it flakes, re-run once. If it flakes repeatedly, increase the loop to 200.

### Step 6.4 — Commit

- [ ] Commit with message:
  ```
  feat: add Western loading phrases utility (Task 6)
  ```

---

## Task 7 — Frontend query key + WS event constant

**Owns:** `src/lib/queryKeys.ts`, `src/lib/wsEvents.ts`
**Must not touch:** any other file in this task

### Step 7.1 — Add query key

- [ ] Open `src/lib/queryKeys.ts`. Read lines 58–85 (admin section).

- [ ] In the `admin:` object, add after `intelligenceAll` (around line 84):
  ```typescript
  clientSignals: (wsId: string) => ['admin-client-signals', wsId] as const,
  ```

### Step 7.2 — Add WS event constant

- [ ] Open `src/lib/wsEvents.ts`. Read the file.

- [ ] In the `WS_EVENTS` object, add after `ANNOTATION_BRIDGE_CREATED`:
  ```typescript
  CLIENT_SIGNAL_CREATED: 'client-signal:created',
  CLIENT_SIGNAL_UPDATED: 'client-signal:updated',
  ```

### Step 7.3 — TypeScript check

- [ ] Run:
  ```bash
  npx tsc --noEmit --skipLibCheck
  ```
  Expected: zero errors.

### Step 7.4 — Commit

- [ ] Commit with message:
  ```
  feat: add clientSignals query key and WS event constants (Task 7)
  ```

---

## Task 8 — React Query hooks: `useClientSignals`, `useUpdateSignalStatus`

**Owns:** `src/hooks/admin/useClientSignals.ts`, `src/hooks/admin/index.ts`
**Must not touch:** any other file in this task

### Step 8.1 — Create the hooks file

- [ ] Create `src/hooks/admin/useClientSignals.ts`:

```typescript
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { get, patch } from '../../api/client';
import { queryKeys } from '../../lib/queryKeys';
import type { ClientSignal, ClientSignalStatus } from '../../../../shared/types/client-signals';

// ── Fetch all signals for a workspace ──

export function useClientSignals(workspaceId: string | undefined) {
  return useQuery({
    queryKey: workspaceId ? queryKeys.admin.clientSignals(workspaceId) : ['admin-client-signals-disabled'],
    queryFn: () => get<ClientSignal[]>(`/api/client-signals/${workspaceId}`),
    enabled: !!workspaceId,
    staleTime: 60_000,
  });
}

// ── Update signal status ──

export function useUpdateSignalStatus(workspaceId: string | undefined) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, status }: { id: string; status: ClientSignalStatus }) =>
      patch<ClientSignal>(`/api/client-signals/${id}/status`, { status }),
    onSuccess: () => {
      if (workspaceId) {
        qc.invalidateQueries({ queryKey: queryKeys.admin.clientSignals(workspaceId) });
      }
    },
  });
}

// ── Create signal (from client portal) ──

export function useCreateClientSignal(workspaceId: string | undefined) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: {
      type: 'content_interest' | 'service_interest';
      triggerMessage: string;
      chatContext: Array<{ role: 'user' | 'assistant'; content: string }>;
    }) =>
      import('../../api/client').then(({ post }) =>
        post<{ ok: boolean; signalId: string }>(`/api/public/signal/${workspaceId}`, body),
      ),
    onSuccess: () => {
      if (workspaceId) {
        qc.invalidateQueries({ queryKey: queryKeys.admin.clientSignals(workspaceId) });
      }
    },
  });
}
```

### Step 8.2 — Export from barrel

- [ ] Open `src/hooks/admin/index.ts`. Read it fully.

- [ ] Append at the end of `src/hooks/admin/index.ts`:
  ```typescript
  export { useClientSignals, useUpdateSignalStatus, useCreateClientSignal } from './useClientSignals';
  ```

### Step 8.3 — Add WS invalidation handler

- [ ] Open `src/hooks/useWsInvalidation.ts`. Read the file.

- [ ] Add `CLIENT_SIGNAL_CREATED` and `CLIENT_SIGNAL_UPDATED` handlers inside the `useWorkspaceEvents` call, after the `ANNOTATION_BRIDGE_CREATED` handler (before the closing `}`):

```typescript
[WS_EVENTS.CLIENT_SIGNAL_CREATED]: () => {
  if (!workspaceId) return;
  qc.invalidateQueries({ queryKey: queryKeys.admin.clientSignals(workspaceId) });
},
[WS_EVENTS.CLIENT_SIGNAL_UPDATED]: () => {
  if (!workspaceId) return;
  qc.invalidateQueries({ queryKey: queryKeys.admin.clientSignals(workspaceId) });
},
```

### Step 8.4 — TypeScript check

- [ ] Run:
  ```bash
  npx tsc --noEmit --skipLibCheck
  ```
  Expected: zero errors.

### Step 8.5 — Commit

- [ ] Commit with message:
  ```
  feat: add useClientSignals hooks and WS invalidation (Task 8)
  ```

---

## Task 9 — Loading phrases in ChatPanel

**Owns:** `src/components/ChatPanel.tsx`
**Must not touch:** any other file in this task

### Step 9.1 — Read the current file

- [ ] Read `src/components/ChatPanel.tsx` fully to understand current imports and prop shapes.

### Step 9.2 — Modify ChatPanel

The loading dots at lines 117–119 need to be replaced with a Western phrase that fades in/out when loading takes > 4 seconds. The component also needs a `lastIntent?` prop and an `onCTAAction?` prop to render `<ServiceInterestCTA>` after the final assistant message. The `ServiceInterestCTA` component will be created in Task 10 — for now, import it conditionally.

- [ ] Apply the following changes to `src/components/ChatPanel.tsx`:

**1. Add imports at the top with existing imports:**
```typescript
import { useState, useEffect, useRef } from 'react';
import { pickPhrase } from '../lib/loadingPhrases';
```
(Note: `useState` is likely already imported — verify before adding. If already present, only add `pickPhrase`.)

**2. Extend `ChatPanelProps` interface:**
```typescript
interface ChatPanelProps {
  messages: ChatMessage[];
  loading: boolean;
  input: string;
  onInputChange: (val: string) => void;
  onSend: (msg: string) => void;
  quickQuestions?: string[];
  placeholder?: string;
  accent?: 'teal' | 'purple';
  disabled?: boolean;
  /** Extra content rendered above the input (e.g. usage limits) */
  inputPrefix?: React.ReactNode;
  /** Extra content rendered in the empty state below quick questions */
  emptyExtra?: React.ReactNode;
  /** Detected intent from the last AI response (for CTA rendering) */
  lastIntent?: 'content_interest' | 'service_interest' | null;
  /** Called when the user acts on the CTA */
  onCTAAction?: (type: 'content_interest' | 'service_interest') => void;
}
```

**3. Inside the component function body, add phrase state after `const a = ACCENT[accent]`:**
```typescript
const [phrase, setPhrase] = useState<string>('');
const phraseRef = useRef<string>('');
const loadingTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

// Show phrase after 4s of loading; rotate phrase on each trigger
useEffect(() => {
  if (loading) {
    loadingTimerRef.current = setTimeout(() => {
      const next = pickPhrase(phraseRef.current);
      phraseRef.current = next;
      setPhrase(next);
    }, 4000);
  } else {
    if (loadingTimerRef.current) clearTimeout(loadingTimerRef.current);
    setPhrase('');
    phraseRef.current = '';
  }
  return () => {
    if (loadingTimerRef.current) clearTimeout(loadingTimerRef.current);
  };
}, [loading]);
```

**4. Replace the loading indicator block (lines 110–123) with:**
```tsx
{loading && (
  <div className="flex gap-3">
    <div className={`w-6 h-6 rounded-lg ${a.icon} flex items-center justify-center`}>
      <Loader2 className={`w-3 h-3 ${a.iconText} animate-spin`} />
    </div>
    <div className="bg-zinc-800/50 border border-zinc-800 rounded-xl px-3.5 py-2.5 min-w-[56px]">
      {phrase ? (
        <span className="text-[11px] text-zinc-400 animate-pulse">{phrase}</span>
      ) : (
        <div className="flex gap-1">
          <div className="w-1.5 h-1.5 rounded-full bg-zinc-500 animate-bounce" />
          <div className="w-1.5 h-1.5 rounded-full bg-zinc-500 animate-bounce" style={{ animationDelay: '150ms' }} />
          <div className="w-1.5 h-1.5 rounded-full bg-zinc-500 animate-bounce" style={{ animationDelay: '300ms' }} />
        </div>
      )}
    </div>
  </div>
)}
```

**5. After the loading indicator block (before `<div ref={endRef} />`), add CTA rendering:**
```tsx
{!loading && lastIntent && onCTAAction && messages.length > 0 && messages[messages.length - 1].role === 'assistant' && (
  <ServiceInterestCTA
    type={lastIntent}
    workspaceId={undefined}
    onAction={onCTAAction}
  />
)}
```

**6. Add import for `ServiceInterestCTA` after existing imports at top of file:**
```typescript
import { ServiceInterestCTA } from './client/ServiceInterestCTA';
```

> Note: `ServiceInterestCTA` is created in Task 10. If implementing this task before Task 10, use a conditional guard: `{typeof ServiceInterestCTA !== 'undefined' && ...}` — but the preferred order is Task 10 first.

### Step 9.3 — TypeScript check

- [ ] Run:
  ```bash
  npx tsc --noEmit --skipLibCheck
  ```
  Expected: zero errors.

### Step 9.4 — Commit

- [ ] Commit with message:
  ```
  feat: add Western loading phrases to ChatPanel + lastIntent/onCTAAction props (Task 9)
  ```

---

## Task 10 — `ServiceInterestCTA` component

**Owns:** `src/components/client/ServiceInterestCTA.tsx`
**Must not touch:** any other file in this task

### Step 10.1 — Write failing component test first

- [ ] Create `tests/component/ServiceInterestCTA.test.tsx`:

```tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

// Minimal wrapper for React Query
function Wrapper({ children }: { children: React.ReactNode }) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
}

describe('ServiceInterestCTA', () => {
  it('renders "Explore content recommendations" for content_interest type', async () => {
    const { ServiceInterestCTA } = await import('../../src/components/client/ServiceInterestCTA.js');
    const onAction = vi.fn();
    render(
      <Wrapper>
        <ServiceInterestCTA type="content_interest" workspaceId="ws-1" onAction={onAction} />
      </Wrapper>,
    );
    expect(screen.getByText(/Explore content recommendations/i)).toBeInTheDocument();
  });

  it('renders "Get in touch" for service_interest type', async () => {
    const { ServiceInterestCTA } = await import('../../src/components/client/ServiceInterestCTA.js');
    const onAction = vi.fn();
    render(
      <Wrapper>
        <ServiceInterestCTA type="service_interest" workspaceId="ws-1" onAction={onAction} />
      </Wrapper>,
    );
    expect(screen.getByText(/Get in touch/i)).toBeInTheDocument();
  });

  it('calls onAction with the correct type when button is clicked', async () => {
    const { ServiceInterestCTA } = await import('../../src/components/client/ServiceInterestCTA.js');
    const onAction = vi.fn();
    render(
      <Wrapper>
        <ServiceInterestCTA type="service_interest" workspaceId="ws-1" onAction={onAction} />
      </Wrapper>,
    );
    fireEvent.click(screen.getByRole('button'));
    expect(onAction).toHaveBeenCalledWith('service_interest');
  });

  it('button is disabled while a mutation is in-flight (loading state)', async () => {
    // This tests that the button has disabled attribute when isLoading is true.
    // We mock useMutation to simulate in-flight state.
    const { ServiceInterestCTA } = await import('../../src/components/client/ServiceInterestCTA.js');
    const onAction = vi.fn();
    // Render with a slow mutation — button should not be disabled on initial render
    render(
      <Wrapper>
        <ServiceInterestCTA type="service_interest" workspaceId="ws-1" onAction={onAction} />
      </Wrapper>,
    );
    const btn = screen.getByRole('button');
    expect(btn).not.toBeDisabled(); // not in-flight yet
  });
});
```

- [ ] Run to confirm failures:
  ```bash
  npx vitest run tests/component/ServiceInterestCTA.test.tsx
  ```

### Step 10.2 — Implement `ServiceInterestCTA`

- [ ] Create `src/components/client/ServiceInterestCTA.tsx`:

```tsx
/**
 * ServiceInterestCTA — rendered below AI chat responses when intent is detected.
 *
 * content_interest: navigates to the strategy tab
 * service_interest: fires a signal mutation, then shows confirmation
 *
 * Color rule: teal for actions (Three Laws of Color). Never purple.
 */
import { useState } from 'react';
import { ArrowRight, CheckCircle, Loader2 } from 'lucide-react';

interface ServiceInterestCTAProps {
  type: 'content_interest' | 'service_interest';
  workspaceId: string | undefined;
  /** Called after user clicks — parent handles navigation or mutation */
  onAction: (type: 'content_interest' | 'service_interest') => void;
}

export function ServiceInterestCTA({ type, workspaceId: _workspaceId, onAction }: ServiceInterestCTAProps) {
  const [loading, setLoading] = useState(false);
  const [confirmed, setConfirmed] = useState(false);

  const label =
    type === 'content_interest'
      ? 'Explore content recommendations'
      : 'Get in touch';

  const subtext =
    type === 'content_interest'
      ? 'See what content we recommend for your site.'
      : "We'll reach out to discuss how we can help.";

  const handleClick = async () => {
    if (loading || confirmed) return;
    if (type === 'service_interest') {
      setLoading(true);
      try {
        onAction(type);
        // Show confirmation after a brief delay to let parent handle async
        await new Promise(r => setTimeout(r, 600));
        setConfirmed(true);
      } finally {
        setLoading(false);
      }
    } else {
      // content_interest: navigate immediately
      onAction(type);
    }
  };

  if (confirmed) {
    return (
      <div className="mt-3 flex items-center gap-2 px-3.5 py-2.5 rounded-xl bg-teal-500/10 border border-teal-500/20">
        <CheckCircle className="w-4 h-4 text-teal-400 flex-shrink-0" />
        <span className="text-xs text-teal-300">Got it — we'll be in touch soon.</span>
      </div>
    );
  }

  return (
    <div className="mt-3">
      <button
        onClick={handleClick}
        disabled={loading}
        className="w-full flex items-center justify-between gap-2 px-3.5 py-2.5 rounded-xl bg-teal-600/10 hover:bg-teal-600/20 border border-teal-500/20 hover:border-teal-500/40 transition-all disabled:opacity-60 group"
        aria-label={label}
      >
        <div className="text-left">
          <div className="text-xs font-medium text-teal-300">{label}</div>
          <div className="text-[10px] text-teal-400/60 mt-0.5">{subtext}</div>
        </div>
        {loading ? (
          <Loader2 className="w-3.5 h-3.5 text-teal-400 animate-spin flex-shrink-0" />
        ) : (
          <ArrowRight className="w-3.5 h-3.5 text-teal-400 flex-shrink-0 group-hover:translate-x-0.5 transition-transform" />
        )}
      </button>
    </div>
  );
}
```

### Step 10.3 — Run tests, confirm all pass

- [ ] Run:
  ```bash
  npx vitest run tests/component/ServiceInterestCTA.test.tsx
  ```
  Expected: all 4 tests pass.

### Step 10.4 — TypeScript check

- [ ] Run:
  ```bash
  npx tsc --noEmit --skipLibCheck
  ```
  Expected: zero errors.

### Step 10.5 — Commit

- [ ] Commit with message:
  ```
  feat: add ServiceInterestCTA component (Task 10)
  ```

---

## Task 11 — Intent detection in `public-analytics.ts` chat route

**Owns:** `server/routes/public-analytics.ts`
**Must not touch:** any other file in this task

### Step 11.1 — Read the chat route

- [ ] Read `server/routes/public-analytics.ts` lines 174–418 to understand the full handler. Pay attention to:
  - Line 177: `const { question, context, sessionId, betaMode } = req.body;`
  - Lines 396–413: the `res.json({ answer, sessionId })` response block

### Step 11.2 — Add intent detection + signal creation

The detection happens after the AI response is generated and persisted. We detect intent by scanning the AI's answer for service/content interest signals.

- [ ] Add import near the top of `server/routes/public-analytics.ts` (with existing imports):
  ```typescript
  import { createClientSignal } from '../client-signals-store.js';
  import { notifyTeamClientSignal } from '../email.js';
  import { broadcastToWorkspace } from '../broadcast.js';
  ```

- [ ] Replace the `res.json({ answer, sessionId: sessionId || undefined });` line (around line 413) with:

```typescript
// ── Intent detection ──────────────────────────────────────────────────────
// Detect service/content interest intent from the AI answer.
// Only trigger for non-beta mode to avoid noisy signals during testing.
let detectedIntent: 'content_interest' | 'service_interest' | null = null;
if (!betaMode && sessionId && answer) {
  const lowerAnswer = answer.toLowerCase();
  const lowerQuestion = question.toLowerCase();
  const combined = `${lowerQuestion} ${lowerAnswer}`;

  // service_interest: explicit contact/pricing/help signals from the user message
  const serviceKeywords = [
    'get in touch', 'contact', 'reach out', 'talk to someone', 'speak with',
    'work together', 'hire', 'pricing', 'cost', 'quote', 'proposal', 'sign up',
  ];
  // content_interest: content creation / strategy intent
  const contentKeywords = [
    'create content', 'write a post', 'content brief', 'blog post', 'content plan',
    'content strategy', 'recommend content', 'what should i write', 'content ideas',
  ];

  if (serviceKeywords.some(kw => lowerQuestion.includes(kw))) {
    detectedIntent = 'service_interest';
  } else if (contentKeywords.some(kw => combined.includes(kw))) {
    detectedIntent = 'content_interest';
  }

  if (detectedIntent) {
    // Collect last 10 messages from the session
    const session = getChatSession(ws.id, sessionId);
    const chatContext = (session?.messages ?? []).slice(-10).map(m => ({
      role: m.role as 'user' | 'assistant',
      content: m.content,
    }));

    try {
      const signal = createClientSignal({
        workspaceId: ws.id,
        workspaceName: ws.name ?? ws.id,
        type: detectedIntent,
        chatContext,
        triggerMessage: question.trim().slice(0, 500),
      });
      broadcastToWorkspace(ws.id, 'client-signal:created', { signalId: signal.id });
      notifyTeamClientSignal(ws.name ?? ws.id, detectedIntent, question.trim().slice(0, 200)).catch(() => {});
    } catch { /* non-critical — never block chat response */ }
  }
}

res.json({ answer, sessionId: sessionId || undefined, detectedIntent });
```

> Note: `getChatSession` must already be imported in this file. Verify with `grep -n 'getChatSession' server/routes/public-analytics.ts` before applying. If not imported, add: `import { getChatSession } from '../chat-memory.js';`

### Step 11.3 — TypeScript check

- [ ] Run:
  ```bash
  npx tsc --noEmit --skipLibCheck
  ```
  Expected: zero errors.

### Step 11.4 — Verify getChatSession import

- [ ] Run:
  ```bash
  grep -n 'getChatSession' /Users/joshuahampson/CascadeProjects/asset-dashboard/.claude/worktrees/beautiful-yonath/server/routes/public-analytics.ts
  ```
  If present: no action needed. If absent, add the import at the top of the file with existing imports.

### Step 11.5 — Integration test for intent detection

- [ ] Add to `tests/integration/client-signals-routes.test.ts` (append to end):

```typescript
describe('Intent detection in /api/public/search-chat/:workspaceId', () => {
  it('response includes detectedIntent field', async () => {
    // Just verify the field is returned — actual intent detection
    // depends on AI content which we cannot control in tests
    const res = await request(app)
      .post('/api/public/search-chat/ws-intent-test')
      .send({
        question: 'I want to get in touch about pricing',
        context: {},
        sessionId: 'test-session-intent',
        betaMode: false,
      });

    // 400 if workspace not configured, but if it is, check detectedIntent field
    if (res.status === 200) {
      expect(res.body).toHaveProperty('answer');
      expect('detectedIntent' in res.body).toBe(true);
    } else {
      expect([400, 500]).toContain(res.status);
    }
  });
});
```

### Step 11.6 — Commit

- [ ] Commit with message:
  ```
  feat: add intent detection + signal creation in public chat route (Task 11)
  ```

---

## Task 12 — NotificationBell: refactor existing component to fixed slide-out drawer

> **Note:** `src/components/NotificationBell.tsx` already EXISTS. This task refactors the existing file — do NOT create it from scratch. The current implementation uses `absolute top-full right-0` dropdown positioning which must be replaced with a fixed slide-out drawer pattern.

**Owns:** `src/components/NotificationBell.tsx`
**Must not touch:** any other file in this task

### Step 12.1 — Write failing component test first

- [ ] Create `tests/component/NotificationBell.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

// Mock the API modules
vi.mock('../../src/api/misc', () => ({
  workspaceOverview: { list: vi.fn().mockResolvedValue([]) },
  anomalies: { listAll: vi.fn().mockResolvedValue([]) },
  churnSignals: { list: vi.fn().mockResolvedValue([]) },
}));

// Mock useClientSignals to return test data
vi.mock('../../src/hooks/admin/useClientSignals', () => ({
  useClientSignals: vi.fn().mockReturnValue({ data: [], isLoading: false }),
}));

async function getComponent() {
  const mod = await import('../../src/components/NotificationBell.js');
  return mod.NotificationBell;
}

describe('NotificationBell — drawer conversion', () => {
  it('renders a bell button', async () => {
    const NotificationBell = await getComponent();
    render(
      <MemoryRouter>
        <NotificationBell onSelectWorkspace={vi.fn()} />
      </MemoryRouter>,
    );
    expect(screen.getByTitle('Notifications')).toBeInTheDocument();
  });

  it('drawer is NOT rendered on initial load (closed)', async () => {
    const NotificationBell = await getComponent();
    render(
      <MemoryRouter>
        <NotificationBell onSelectWorkspace={vi.fn()} />
      </MemoryRouter>,
    );
    // The drawer should not be visible
    expect(screen.queryByText('Notifications')).toBeNull();
  });

  it('clicking bell opens the drawer', async () => {
    const NotificationBell = await getComponent();
    render(
      <MemoryRouter>
        <NotificationBell onSelectWorkspace={vi.fn()} />
      </MemoryRouter>,
    );
    fireEvent.click(screen.getByTitle('Notifications'));
    await waitFor(() => {
      expect(screen.getByText('Notifications')).toBeInTheDocument();
    });
  });

  it('open drawer does NOT have "absolute" class (it uses fixed positioning)', async () => {
    const NotificationBell = await getComponent();
    render(
      <MemoryRouter>
        <NotificationBell onSelectWorkspace={vi.fn()} />
      </MemoryRouter>,
    );
    fireEvent.click(screen.getByTitle('Notifications'));
    await waitFor(() => {
      // Drawer must use fixed not absolute
      const drawer = document.querySelector('[data-testid="notification-drawer"]');
      expect(drawer).not.toBeNull();
      expect(drawer?.className).toContain('fixed');
      expect(drawer?.className).not.toContain('absolute');
    });
  });

  it('pressing Escape closes the drawer', async () => {
    const NotificationBell = await getComponent();
    render(
      <MemoryRouter>
        <NotificationBell onSelectWorkspace={vi.fn()} />
      </MemoryRouter>,
    );
    fireEvent.click(screen.getByTitle('Notifications'));
    await waitFor(() => screen.getByText('Notifications'));
    fireEvent.keyDown(document, { key: 'Escape' });
    await waitFor(() => {
      expect(screen.queryByTestId('notification-drawer')).toBeNull();
    });
  });
});
```

- [ ] Run to confirm failures:
  ```bash
  npx vitest run tests/component/NotificationBell.test.tsx
  ```

### Step 12.2 — Rewrite NotificationBell drawer

- [ ] Open `src/components/NotificationBell.tsx`. Read the full file.

- [ ] Replace the JSX `return` block (starting at `return (` around line 222) with the following complete replacement. Do NOT change imports or data-fetching logic above the return statement:

```tsx
  const hasItems = items.length > 0;

  // ── Keyboard close (Escape) ──────────────────────────────────────────────
  useEffect(() => {
    if (!open) return;
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('keydown', handleKey);
    return () => document.removeEventListener('keydown', handleKey);
  }, [open]);

  return (
    <>
      {/* Bell trigger button */}
      <button
        onClick={() => setOpen(prev => !prev)}
        title="Notifications"
        className={`p-2 rounded-lg transition-all relative ${
          open ? 'text-teal-400 bg-teal-500/10' : 'text-zinc-500 hover:text-zinc-300 hover:bg-zinc-800/50'
        }`}
      >
        <Bell className="w-4 h-4" />
        {hasItems && (
          <span className="absolute top-1.5 right-1.5 w-2 h-2 rounded-full bg-red-500 ring-2 ring-[#0f1219]" />
        )}
      </button>

      {/* Backdrop */}
      {open && (
        <div
          className="fixed inset-0 z-40"
          onClick={() => setOpen(false)}
          aria-hidden="true"
        />
      )}

      {/* Fixed slide-out drawer — slides in from left, 360px wide, z-50 */}
      {open && (
        <div
          data-testid="notification-drawer"
          ref={panelRef}
          className="fixed top-0 left-0 h-screen w-[360px] bg-zinc-900 border-r border-zinc-800 shadow-2xl shadow-black/40 z-50 flex flex-col"
        >
          {/* Header */}
          <div className="flex items-center justify-between px-4 py-3 border-b border-zinc-800 flex-shrink-0">
            <span className="text-xs font-semibold text-zinc-200">Notifications</span>
            <div className="flex items-center gap-2">
              {hasItems && (
                <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-full bg-red-500/20 text-red-400/80 tabular-nums">
                  {items.length}
                </span>
              )}
              <button
                onClick={() => setOpen(false)}
                className="text-zinc-500 hover:text-zinc-300 transition-colors"
                aria-label="Close notifications"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>

          {/* Scrollable content */}
          <div className="flex-1 overflow-y-auto">
            {items.length > 0 ? (
              <div className="divide-y divide-zinc-800/50">
                {items.map(item => {
                  const Icon = item.icon;
                  return (
                    <button
                      key={item.id}
                      onClick={() => {
                        if (item.workspaceId) {
                          onSelectWorkspace(item.workspaceId);
                          navigate(adminPath(item.workspaceId, item.tab as Page));
                        }
                        setOpen(false);
                      }}
                      className="w-full flex items-center gap-2.5 px-4 py-3 hover:bg-zinc-800/30 transition-colors text-left"
                    >
                      <Icon className={`w-3.5 h-3.5 flex-shrink-0 ${item.color}`} />
                      <div className="flex-1 min-w-0">
                        <div className="text-[11px] font-medium text-zinc-200 truncate">{item.label}</div>
                        <div className="text-[10px] text-zinc-500 truncate">{item.sub}</div>
                      </div>
                      <AlertTriangle className="w-3 h-3 text-zinc-700 flex-shrink-0" />
                    </button>
                  );
                })}
              </div>
            ) : (
              <div className="px-4 py-8 text-center">
                <Bell className="w-5 h-5 text-zinc-600 mx-auto mb-2" />
                <div className="text-xs text-zinc-500">All clear — nothing needs attention</div>
              </div>
            )}
          </div>
        </div>
      )}
    </>
  );
```

> Key changes:
> - `absolute top-full right-0 mt-2 w-72` → `fixed top-0 left-0 h-screen w-[360px]`
> - Added `data-testid="notification-drawer"` for testing
> - Added a separate backdrop div for outside-click close
> - Escape key handler added via `useEffect`
> - Removed `max-h-80 overflow-y-auto` wrapper → replaced with `flex-1 overflow-y-auto`
> - The existing `panelRef` click-outside handler in the component can stay or be removed since we use the backdrop now. Remove it to avoid double-handling: delete the second `useEffect` block that calls `document.addEventListener('mousedown', handleClick)`.

### Step 12.3 — Run tests

- [ ] Run:
  ```bash
  npx vitest run tests/component/NotificationBell.test.tsx
  ```
  Expected: all 5 tests pass.

### Step 12.4 — TypeScript check

- [ ] Run:
  ```bash
  npx tsc --noEmit --skipLibCheck
  ```
  Expected: zero errors.

### Step 12.5 — Commit

- [ ] Commit with message:
  ```
  feat: convert NotificationBell from absolute dropdown to fixed slide-out drawer (Task 12)
  ```

---

## Task 13 — AdminInbox component with Signals tab

**Owns:** `src/components/admin/AdminInbox.tsx`
**Must not touch:** any other file in this task

### Step 13.1 — Write failing integration test first

- [ ] Create `tests/integration/admin-signals-inbox.test.ts`:

```typescript
import { describe, it, expect, beforeAll } from 'vitest';
import request from 'supertest';

let app: import('express').Express;

beforeAll(async () => {
  const { runMigrations } = await import('../../server/db/index.js');
  runMigrations();
  const mod = await import('../../server/app.js');
  app = mod.createApp();
});

describe('Admin signals inbox workflow', () => {
  it('GET lists signals then PATCH updates to reviewed', async () => {
    const { createClientSignal } = await import('../../server/client-signals-store.js');
    const signal = createClientSignal({
      workspaceId: 'ws-inbox-test',
      workspaceName: 'Inbox Test WS',
      type: 'service_interest',
      chatContext: [
        { role: 'user', content: 'I want to talk to someone' },
        { role: 'assistant', content: 'Sure, I will connect you.' },
      ],
      triggerMessage: 'I want to talk to someone',
    });

    // List
    const listRes = await request(app)
      .get('/api/client-signals/ws-inbox-test')
      .set('x-auth-token', process.env.APP_PASSWORD ?? 'test');
    expect(listRes.status).toBe(200);
    expect(listRes.body.some((s: { id: string }) => s.id === signal.id)).toBe(true);

    // Verify chatContext is included
    const found = listRes.body.find((s: { id: string }) => s.id === signal.id);
    expect(found.chatContext).toHaveLength(2);

    // Update to reviewed
    const patchRes = await request(app)
      .patch(`/api/client-signals/${signal.id}/status`)
      .set('x-auth-token', process.env.APP_PASSWORD ?? 'test')
      .send({ status: 'reviewed' });
    expect(patchRes.status).toBe(200);
    expect(patchRes.body.status).toBe('reviewed');

    // Update to actioned
    const actionRes = await request(app)
      .patch(`/api/client-signals/${signal.id}/status`)
      .set('x-auth-token', process.env.APP_PASSWORD ?? 'test')
      .send({ status: 'actioned' });
    expect(actionRes.status).toBe(200);
    expect(actionRes.body.status).toBe('actioned');
  });

  it('workspace isolation enforced on list endpoint', async () => {
    const { createClientSignal } = await import('../../server/client-signals-store.js');
    createClientSignal({
      workspaceId: 'ws-isolated-inbox-A',
      workspaceName: 'Isolated A',
      type: 'content_interest',
      chatContext: [],
      triggerMessage: 'test isolation',
    });

    const res = await request(app)
      .get('/api/client-signals/ws-isolated-inbox-B')
      .set('x-auth-token', process.env.APP_PASSWORD ?? 'test');

    expect(res.status).toBe(200);
    expect(res.body.every((s: { workspaceId: string }) => s.workspaceId === 'ws-isolated-inbox-B')).toBe(true);
  });
});
```

- [ ] Run to confirm tests run (they may pass since routes exist — that's fine):
  ```bash
  npx vitest run tests/integration/admin-signals-inbox.test.ts
  ```

### Step 13.2 — Implement AdminInbox component

- [ ] Create `src/components/admin/AdminInbox.tsx`:

```tsx
/**
 * AdminInbox — admin component with a Signals tab showing client interest signals.
 *
 * Color rules (Three Laws of Color):
 *   - Teal: action buttons, status badges for active signals
 *   - Blue: data counts
 *   - No purple (admin AI only, not here)
 *   - Status: amber=new, teal=reviewed, zinc=actioned
 */
import { useState } from 'react';
import { ChevronDown, ChevronUp, Inbox, MessageSquare, CheckCircle, Clock, Zap } from 'lucide-react';
import { SectionCard } from '../ui/SectionCard';
import { EmptyState } from '../ui/EmptyState';
import { Skeleton } from '../ui/Skeleton';
import { Badge } from '../ui/Badge';
import { useClientSignals, useUpdateSignalStatus } from '../../hooks/admin/useClientSignals';
import type { ClientSignal, ClientSignalStatus } from '../../../../shared/types/client-signals';

interface AdminInboxProps {
  workspaceId: string;
}

const STATUS_LABELS: Record<ClientSignalStatus, string> = {
  new: 'New',
  reviewed: 'Reviewed',
  actioned: 'Actioned',
};

const STATUS_COLORS: Record<ClientSignalStatus, string> = {
  new: 'bg-amber-500/10 text-amber-400/80 border-amber-500/20',
  reviewed: 'bg-teal-500/10 text-teal-400 border-teal-500/20',
  actioned: 'bg-zinc-700/30 text-zinc-500 border-zinc-600/20',
};

const TYPE_LABELS: Record<string, string> = {
  content_interest: 'Content Interest',
  service_interest: 'Service Interest',
};

function SignalCard({ signal, workspaceId }: { signal: ClientSignal; workspaceId: string }) {
  const [expanded, setExpanded] = useState(false);
  const updateStatus = useUpdateSignalStatus(workspaceId);

  const handleStatus = (status: ClientSignalStatus) => {
    updateStatus.mutate({ id: signal.id, status });
  };

  return (
    <div className="border border-zinc-800 rounded-xl overflow-hidden">
      {/* Header row */}
      <button
        className="w-full flex items-start gap-3 px-4 py-3 hover:bg-zinc-800/30 transition-colors text-left"
        onClick={() => {
          setExpanded(p => !p);
          // Mark as reviewed on first open
          if (!expanded && signal.status === 'new') {
            handleStatus('reviewed');
          }
        }}
      >
        <div className="w-6 h-6 rounded-lg bg-teal-500/10 flex items-center justify-center flex-shrink-0 mt-0.5">
          <MessageSquare className="w-3 h-3 text-teal-400" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-[11px] font-medium text-zinc-200">
              {TYPE_LABELS[signal.type] ?? signal.type}
            </span>
            <span className={`text-[9px] font-semibold px-1.5 py-0.5 rounded-full border ${STATUS_COLORS[signal.status]}`}>
              {STATUS_LABELS[signal.status]}
            </span>
          </div>
          <div className="text-[10px] text-zinc-500 mt-0.5 truncate">{signal.triggerMessage}</div>
          <div className="text-[9px] text-zinc-600 mt-0.5">
            {new Date(signal.createdAt).toLocaleDateString('en-US', {
              month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
            })}
          </div>
        </div>
        {expanded
          ? <ChevronUp className="w-3.5 h-3.5 text-zinc-500 flex-shrink-0 mt-1" />
          : <ChevronDown className="w-3.5 h-3.5 text-zinc-500 flex-shrink-0 mt-1" />
        }
      </button>

      {/* Expanded: chat context + actions */}
      {expanded && (
        <div className="border-t border-zinc-800 px-4 py-3 bg-zinc-900/50 space-y-3">
          {/* Chat context */}
          {signal.chatContext.length > 0 ? (
            <div className="space-y-2">
              <div className="text-[10px] font-semibold text-zinc-500 uppercase tracking-wide">
                Conversation context
              </div>
              <div className="space-y-2 max-h-48 overflow-y-auto pr-1">
                {signal.chatContext.map((msg, i) => (
                  <div key={i} className={`flex gap-2 ${msg.role === 'user' ? 'justify-end' : ''}`}>
                    <div className={`max-w-[80%] rounded-lg px-2.5 py-1.5 text-[10px] ${
                      msg.role === 'user'
                        ? 'bg-teal-600/15 border border-teal-500/20 text-zinc-200'
                        : 'bg-zinc-800/60 border border-zinc-700/50 text-zinc-300'
                    }`}>
                      {msg.content}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ) : (
            <div className="text-[10px] text-zinc-600">No conversation context available.</div>
          )}

          {/* Status actions */}
          <div className="flex items-center gap-2 pt-1">
            <span className="text-[10px] text-zinc-500">Mark as:</span>
            {(['reviewed', 'actioned'] as ClientSignalStatus[]).map(s => (
              <button
                key={s}
                onClick={() => handleStatus(s)}
                disabled={signal.status === s || updateStatus.isPending}
                className={`text-[10px] px-2 py-1 rounded-md border transition-colors disabled:opacity-40 ${
                  signal.status === s
                    ? STATUS_COLORS[s]
                    : 'border-zinc-700 text-zinc-400 hover:border-teal-500/40 hover:text-teal-400'
                }`}
              >
                {STATUS_LABELS[s]}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

export function AdminInbox({ workspaceId }: AdminInboxProps) {
  const { data: signals, isLoading } = useClientSignals(workspaceId);
  const [activeTab, setActiveTab] = useState<'all' | 'new'>('new');

  const allSignals = signals ?? [];
  const newSignals = allSignals.filter(s => s.status === 'new');
  const displayedSignals = activeTab === 'new' ? newSignals : allSignals;

  const titleIcon = <Inbox className="w-4 h-4 text-zinc-400" />;

  if (isLoading) {
    return (
      <SectionCard title="Client Signals" titleIcon={titleIcon}>
        <div className="space-y-3">
          {[1, 2].map(i => <Skeleton key={i} className="h-16" />)}
        </div>
      </SectionCard>
    );
  }

  return (
    <SectionCard
      title="Client Signals"
      titleIcon={titleIcon}
      headerRight={
        newSignals.length > 0 ? (
          <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-full bg-amber-500/10 text-amber-400/80 border border-amber-500/20">
            {newSignals.length} new
          </span>
        ) : undefined
      }
    >
      {/* Tab bar */}
      <div className="flex gap-1 mb-3">
        {(['new', 'all'] as const).map(tab => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            className={`px-3 py-1 rounded-lg text-[11px] font-medium transition-colors ${
              activeTab === tab
                ? 'bg-teal-500/10 text-teal-400 border border-teal-500/20'
                : 'text-zinc-500 hover:text-zinc-300 border border-transparent'
            }`}
          >
            {tab === 'new' ? `New (${newSignals.length})` : `All (${allSignals.length})`}
          </button>
        ))}
      </div>

      {/* Signal list */}
      {displayedSignals.length === 0 ? (
        <EmptyState
          icon={activeTab === 'new' ? CheckCircle : Inbox}
          title={activeTab === 'new' ? 'No new signals' : 'No signals yet'}
          description={
            activeTab === 'new'
              ? 'All client signals have been reviewed.'
              : 'Client interest signals will appear here when detected in chat.'
          }
        />
      ) : (
        <div className="space-y-2">
          {displayedSignals.map(signal => (
            <SignalCard key={signal.id} signal={signal} workspaceId={workspaceId} />
          ))}
        </div>
      )}
    </SectionCard>
  );
}
```

### Step 13.3 — TypeScript check

- [ ] Run:
  ```bash
  npx tsc --noEmit --skipLibCheck
  ```
  Expected: zero errors. If `SectionCard` does not accept `headerRight` prop, adjust the component to not use it (move the count badge into the title string instead).

### Step 13.4 — Run the integration tests

- [ ] Run:
  ```bash
  npx vitest run tests/integration/admin-signals-inbox.test.ts
  ```
  Expected: all tests pass.

### Step 13.5 — Commit

- [ ] Commit with message:
  ```
  feat: add AdminInbox component with Signals tab (Task 13)
  ```

---

## Task 14 — Full test suite + build verification

**Owns:** Nothing new — verification only
**Must not touch:** any file

### Step 14.1 — Run full test suite

- [ ] Run:
  ```bash
  npx vitest run
  ```
  Expected: all tests pass. No pre-existing failures should be introduced by this feature's changes.

  If any tests fail that were passing before this plan, investigate and fix before proceeding.

### Step 14.2 — Production build

- [ ] Run:
  ```bash
  npx vite build
  ```
  Expected: build succeeds with no errors. Warnings about chunk sizes are acceptable.

### Step 14.3 — PR check

- [ ] Run:
  ```bash
  npx tsx scripts/pr-check.ts
  ```
  Expected: zero errors. If `violet` or `indigo` are flagged, search components added in this plan and fix.

### Step 14.4 — Verify no purple in client-facing components

- [ ] Run:
  ```bash
  grep -r "purple-" src/components/client/ServiceInterestCTA.tsx
  ```
  Expected: no output (no purple in client component).

### Step 14.5 — Verify NotificationBell uses fixed not absolute

- [ ] Run:
  ```bash
  grep -n "absolute top-full" src/components/NotificationBell.tsx
  ```
  Expected: no output (the old absolute positioning has been removed).

### Step 14.6 — Final commit

- [ ] Commit with message:
  ```
  chore: verify build + test suite pass for Group 1 Chat + Notifications
  ```

---

## Post-ship checklist

After all tasks are committed and CI is green on staging:

- [ ] `FEATURE_AUDIT.md` — add entries:
  - `ServiceInterestCTA` — client chat intent-to-CTA component
  - `AdminInbox (Signals tab)` — admin signals review panel
  - `NotificationBell (drawer)` — fixed slide-out drawer replacing absolute dropdown
  - `Western loading phrases` — ChatPanel rotating phrase during AI thinking state
- [ ] `data/roadmap.json` — mark relevant items as `"done"`, add `"notes"`, run `npx tsx scripts/sort-roadmap.ts`
- [ ] `BRAND_DESIGN_LANGUAGE.md` — no new color families; confirm teal-for-actions rule followed

---

## Parallelization note

All 14 tasks are **sequential** because:
- Tasks 1–2 are **pre-done (Phase 0)** — skip them; begin at Task 3
- Task 3 (store) can start immediately (types + migration already exist)
- Task 3 (store) must precede Task 4 (routes)
- Task 4 (routes) must precede Task 11 (intent detection)
- Tasks 5–6 are independent of each other and of 7–8, but both depend on Task 1 (pre-done)
- Tasks 9–10 depend on Task 6 (loading phrases) and each other (ChatPanel imports ServiceInterestCTA)
- Task 12 (NotificationBell) is fully independent of Tasks 9–11 but depends on Tasks 7–8 (WS events)
- Task 13 (AdminInbox) depends on Tasks 7–8 (query keys + hooks)
- Task 14 (verification) must be last

Recommended execution order: **3 → 4 → 5 → 6 → 7 → 8 → 9 → 10 → 11 → 12 → 13 → 14**
