# Development Patterns — Operational Reference

> Companion to `CLAUDE.md`. This doc covers **operational patterns** — the concrete "how-to" details for common development workflows. `CLAUDE.md` covers the rules and philosophy; this doc covers the implementation patterns to follow.

---

## React Query Data Fetching

All frontend data fetching uses React Query. These are the patterns to follow:

### Query Key Factory

All query keys are centralized in `src/lib/queryKeys.ts`. Never use inline string keys.

```ts
// CORRECT — use the factory
queryKey: queryKeys.admin.briefs(wsId)

// WRONG — inline string key (causes cache mismatch bugs)
queryKey: ['admin-briefs', wsId]
```

Key hierarchy enables prefix-based invalidation:
- `queryKeys.admin.ga4All(wsId)` → invalidates all GA4 queries for a workspace
- `queryKeys.client.gscAll(wsId)` → invalidates all GSC queries for a workspace

### Stale Time Tiers

Use `STALE_TIMES` from `src/lib/queryClient.ts`:

| Tier | Duration | Use for |
|------|----------|---------|
| `STABLE` | 5 min | Config, workspace list, health, publish targets |
| `NORMAL` | 1 min | Default — most dashboard data (analytics, audit, activity) |
| `FAST` | 30 sec | Queue, SEO editor pages, frequently-changing state |
| `REALTIME` | 0 | Always revalidate on access (use sparingly) |

### Typed API Client

Use `src/api/client.ts` functions — never raw `fetch()` in components:

```ts
import { get, post, patch, del, postForm } from '../../api/client';

// GET with type safety
const data = await get<MyType>(`/api/my-feature/${wsId}`);

// POST with body
const result = await post<ResponseType>('/api/my-feature', { name: 'test' });

// For endpoints that may 404 legitimately (returns null on non-2xx)
const data = await getOptional<MyType>(`/api/maybe-exists/${id}`);

// For endpoints where errors should return a fallback instead of throwing
// Signature: getSafe<T>(url: string, fallback: T, signal?: AbortSignal)
const data = await getSafe<MyType>(`/api/safe/${id}`, defaultValue);
```

### Hook Pattern

```ts
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { get, post } from '../../api/client';
import { queryKeys } from '../../lib/queryKeys';
import { STALE_TIMES } from '../../lib/queryClient';

export function useMyData(wsId: string) {
  return useQuery({
    queryKey: queryKeys.admin.myData(wsId),
    queryFn: () => get<MyType>(`/api/my-data/${wsId}`),
    staleTime: STALE_TIMES.NORMAL,
  });
}

// Mutation with cache invalidation
export function useUpdateMyData(wsId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: UpdateBody) => post<MyType>(`/api/my-data/${wsId}`, body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: queryKeys.admin.myData(wsId) });
    },
  });
}
```

---

## WebSocket Event Wiring (Complete Checklist)

When a mutation needs real-time updates, wire both halves:

### Server Side

1. Register event in `server/ws-events.ts`:
   ```ts
   // In WS_EVENTS object:
   MY_FEATURE_UPDATED: 'my-feature:updated',
   ```

2. Broadcast after DB write in the route handler:
   ```ts
   import { broadcastToWorkspace } from '../broadcast.js';
   import { WS_EVENTS } from '../ws-events.js';

   // After successful DB write:
   broadcastToWorkspace(workspaceId, WS_EVENTS.MY_FEATURE_UPDATED, { id, ...data });
   ```

3. If both admin AND public endpoints mutate the same data, BOTH must broadcast.

### Frontend Side

4. Handle the event in the relevant component:
   ```ts
   import { useWorkspaceEvents } from '../../hooks/useWorkspaceEvents';

   useWorkspaceEvents(workspaceId, {
     'my-feature:updated': () => {
       queryClient.invalidateQueries({ queryKey: queryKeys.admin.myFeature(workspaceId) });
     },
   });
   ```

### Common Mistakes

- **Using `useGlobalAdminEvents` for workspace data** — it doesn't send `subscribe`, so the server's workspace filter excludes the connection. Handler is dead code.
- **Broadcasting from admin endpoint only** — client portal stays stale.
- **Using string literals** — typos cause silent failures. Always `WS_EVENTS.*`.

---

## Route File Template

The canonical pattern for new route files in `server/routes/`:

```ts
import { Router } from 'express';
import { validate, z } from '../middleware/validate.js';
import { requireWorkspaceAccess } from '../auth.js';
import { addActivity } from '../activity-log.js';
import { broadcastToWorkspace } from '../broadcast.js';
import { WS_EVENTS } from '../ws-events.js';
import { createLogger } from '../logger.js';
import db from '../db/index.js';
import { createStmtCache } from '../db/stmt-cache.js';

const log = createLogger('my-feature');
const router = Router();

// Prepared statements (lazy-initialized)
const stmts = createStmtCache(() => ({
  select: db.prepare(`SELECT * FROM my_table WHERE workspace_id = ?`),
  insert: db.prepare(`INSERT INTO my_table (id, workspace_id, name) VALUES (?, ?, ?)`),
}));

// GET — read data
router.get('/api/my-feature/:workspaceId',
  requireWorkspaceAccess('workspaceId'),
  (req, res) => {
    const rows = stmts().select.all(req.params.workspaceId);
    res.json(rows.map(rowToMyFeature));
  }
);

// POST — write data
router.post('/api/my-feature/:workspaceId',
  requireWorkspaceAccess('workspaceId'),
  validate(z.object({ name: z.string().min(1) })),
  (req, res) => {
    const { workspaceId } = req.params;
    const { name } = req.body;
    const id = `mf_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;

    stmts().insert.run(id, workspaceId, name);

    addActivity(workspaceId, 'my_type', `Created ${name}`);
    broadcastToWorkspace(workspaceId, WS_EVENTS.MY_FEATURE_UPDATED, { id, name });

    res.json({ id, name });
  }
);

export default router;
```

**After creating the file:** Mount in `server/app.ts` with `app.use(myFeatureRoutes)`.

---

## Auth Middleware Decision Tree

```
Is this an admin API route (/api/...)?
├── YES → Do NOT use requireAuth (admin uses HMAC, not JWT)
│   └── Use requireWorkspaceAccess('workspaceId') for workspace-scoped routes
│
└── NO → Is this a public/client route (/api/public/...)?
    ├── YES → Rate limiters are already global in app.ts — do NOT apply again
    │   └── Use requireClientPortalAuth() from server/middleware.ts
    │
    └── Is this /api/auth/* or /api/users/*?
        └── YES → requireAuth is correct here (JWT-based)
```

---

## Feature Flag Lifecycle

### 1. Define the flag

In `shared/types/feature-flags.ts`:
```ts
export const FEATURE_FLAGS = {
  // ... existing flags ...
  'my-new-feature': false,  // Description of what it controls
} as const;
```

### 2. Gate in frontend

```tsx
// Option A: Component wrapper (preferred for UI sections)
import { FeatureFlag } from '../ui/FeatureFlag';
<FeatureFlag flag="my-new-feature">
  <MyNewComponent />
</FeatureFlag>

// Option B: Hook (for conditional logic)
import { useFeatureFlag } from '../../hooks/useFeatureFlag';
const enabled = useFeatureFlag('my-new-feature');
```

### 3. Gate on server

```ts
import { isFeatureEnabled } from '../feature-flags.js';
if (!isFeatureEnabled('my-new-feature')) {
  return res.status(404).json({ error: 'Not found' });
}
```

### 4. Enable per environment

Set in Render dashboard env vars:
- Server: `FEATURE_MY_NEW_FEATURE=true`
- Frontend: `VITE_FEATURE_MY_NEW_FEATURE=true`

---

## Database Query Patterns

### Prepared Statement Cache

Always use `createStmtCache` — never bare `let stmt`:

```ts
import { createStmtCache } from '../db/stmt-cache.js';

const stmts = createStmtCache(() => ({
  select: db.prepare(`SELECT * FROM my_table WHERE workspace_id = ?`),
  insert: db.prepare(`INSERT INTO my_table (...) VALUES (...)`),
}));

// Usage — stmts() lazily initializes on first call
const rows = stmts().select.all(workspaceId);
```

### JSON Column Safety

Never use bare `JSON.parse` on DB data:

```ts
import { parseJsonSafe, parseJsonSafeArray } from '../db/json-validation.js';

// Single object with Zod validation
const config = parseJsonSafe(row.config_json, configSchema, defaultConfig, {
  workspaceId, field: 'config_json', table: 'my_table',
});

// Array with per-item validation (bad items filtered, not whole array dropped)
const items = parseJsonSafeArray(row.items_json, itemSchema, {
  workspaceId, field: 'items_json', table: 'my_table',
});
```

### Row Mapper Pattern

```ts
interface MyFeatureRow {
  id: string;
  workspace_id: string;
  name: string;
  config_json: string | null;
  created_at: string;
}

function rowToMyFeature(row: MyFeatureRow): MyFeature {
  return {
    id: row.id,
    workspaceId: row.workspace_id,
    name: row.name,
    config: row.config_json
      ? parseJsonSafe(row.config_json, configSchema, defaultConfig)
      : defaultConfig,
    createdAt: row.created_at,
  };
}
```

### Transaction Wrapping

```ts
const batchInsert = db.transaction((items: Item[]) => {
  for (const item of items) {
    stmts().insert.run(item.id, item.workspaceId, item.name);
  }
});

// Call as a single atomic operation
batchInsert(items);
```

---

## Testing Quick Reference

### Integration Test Setup

```ts
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createTestContext } from './helpers';

// IMPORTANT: Use a unique port — check with: grep -r 'createTestContext(' tests/
// Current range: 13201–13319. Next available: 13320.
const ctx = createTestContext(13320);

describe('my-feature', () => {
  beforeAll(() => ctx.startServer());
  afterAll(() => ctx.stopServer());

  it('should create a feature', async () => {
    const res = await ctx.authPostJson('/api/my-feature/ws_test', { name: 'Test' });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.name).toBe('Test');
  });

  it('should reject invalid body', async () => {
    const res = await ctx.authPostJson('/api/my-feature/ws_test', {});
    expect(res.status).toBe(400);
  });
});
```

### Workspace Isolation Test

```ts
import { assertWorkspaceIsolation } from './helpers';

// Verifies that workspace A's data is invisible to workspace B
await assertWorkspaceIsolation(ctx, '/api/my-feature');
```

### Available Test Helpers

From `tests/integration/helpers.ts`:
- `ctx.api(path)` — unauthenticated GET
- `ctx.authApi(path)` — authenticated GET
- `ctx.postJson(path, body)` — unauthenticated POST
- `ctx.authPostJson(path, body)` — authenticated POST
- `ctx.patchJson(path, body)` — unauthenticated PATCH
- `ctx.authPatchJson(path, body)` — authenticated PATCH
- `ctx.del(path)` — unauthenticated DELETE
- `ctx.authDel(path)` — authenticated DELETE
- `assertWorkspaceIsolation()` — cross-workspace data isolation
- `assertConcurrentGenerateSafe()` — idempotent AI generation
- `assertIdempotentGenerate()` — 409 on duplicate generation
