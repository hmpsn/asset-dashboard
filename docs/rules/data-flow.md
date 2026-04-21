# Data Flow Consistency Rules

These rules MUST be followed whenever creating or modifying features that write data visible to users (admin or client).

## Rule 1: Every write endpoint MUST broadcast to workspace clients

When a server endpoint (POST, PUT, PATCH, DELETE) modifies data that is displayed on either the admin dashboard or the client dashboard, it MUST call `broadcastToWorkspace(workspaceId, eventName, data)` in addition to any admin-global `broadcast()` call.

**Why**: Without this, the other side (admin or client) won't see changes in real-time. This was the root cause of tier sync, request reply visibility, and approval creation bugs.

**Pattern**:
```typescript
// Admin endpoint
app.patch('/api/my-resource/:id', (req, res) => {
  const updated = updateResource(req.params.id, req.body);
  broadcast('resource:updated', updated);                              // admin-global
  broadcastToWorkspace(updated.workspaceId, 'resource:update', data);  // workspace-scoped (reaches client)
  res.json(updated);
});

// Public/client endpoint
app.patch('/api/public/my-resource/:workspaceId/:id', (req, res) => {
  const updated = updateResource(req.params.id, req.body);
  broadcast('resource:updated', updated);                                       // admin-global (reaches admin)
  broadcastToWorkspace(req.params.workspaceId, 'resource:update', data);        // workspace-scoped (reaches other client tabs)
  res.json(updated);
});
```

## Rule 2: Frontend handlers MUST exist for every broadcast event

For every `broadcastToWorkspace()` event, there MUST be a corresponding handler in:
- `ClientDashboard.tsx` → `useWorkspaceEvents()` (for client dashboard)
- `WorkspaceHome.tsx` or relevant admin component → `useWorkspaceEvents()` (for admin dashboard)

**Workspace-scoped events** — the full list is maintained in `server/ws-events.ts` (`WS_EVENTS` constant). Always check that file before emitting a new event — reuse existing event names rather than inventing new string literals. As of the current codebase there are 40+ events covering approvals, requests, content, insights, intelligence, bridges, brand engine, copy pipeline, and more.

Representative examples:
- `workspace:updated` — refetch workspace info (tier, settings, branding)
- `insight:bridge_updated` — insight bridge modified one or more records; invalidate insight feeds
- `strategy:updated` — keyword strategy was modified; invalidate strategy caches
- `activity:new` — new activity log entry; refetch activity feed
- `audit:complete` — site audit finished; refetch audit data

## Rule 3: Delete endpoints MUST capture workspaceId BEFORE deleting

When deleting an entity, you need the `workspaceId` for `broadcastToWorkspace()`. Since the entity won't exist after deletion, you must read it first:

```typescript
app.delete('/api/my-resource/:id', (req, res) => {
  const existing = getResource(req.params.id);  // read BEFORE delete
  const ok = deleteResource(req.params.id);
  if (!ok) return res.status(404).json({ error: 'Not found' });
  broadcast('resource:deleted', { id: req.params.id });
  if (existing) broadcastToWorkspace(existing.workspaceId, 'resource:update', { id: req.params.id, deleted: true });
  res.json({ ok: true });
});
```

## Rule 4: External modules use broadcast callbacks

Modules outside `server/index.ts` cannot import `broadcastToWorkspace` directly. They MUST use the callback pattern:

```typescript
// In the module (e.g., server/my-module.ts):
type WorkspaceBroadcastFn = (workspaceId: string, event: string, data: unknown) => void;
let _broadcastFn: WorkspaceBroadcastFn | null = null;
export function initMyModuleBroadcast(fn: WorkspaceBroadcastFn) { _broadcastFn = fn; }

// In server/websocket.ts (at startup, alongside initActivityBroadcast etc.):
initMyModuleBroadcast(broadcastToWorkspace);
```

Existing callbacks: `initActivityBroadcast`, `initAnomalyBroadcast`, `initStripeBroadcast`.

## Rule 5: New event names MUST be registered in ws-events.ts

All WebSocket event names must be added to `server/ws-events.ts` as constants. This file serves as the single source of truth for what events exist and prevents typos.

## Rule 6: Public API endpoints MUST NOT leak internal data

Public endpoints (`/api/public/*`) must only return fields safe for client consumption. Never expose:
- API tokens (webflowToken, stripeSecretKey)
- Passwords (clientPassword)
- Internal IDs not needed by the client
- Admin-only configuration

## Rule 7: Activity logging for significant actions

Every significant write action should call `addActivity()` to log the event. This automatically broadcasts to workspace clients via `initActivityBroadcast`. Activity types are defined in `server/activity-log.ts`.

Client-visible types are filtered by `CLIENT_VISIBLE_TYPES` in `listClientActivity()`. If adding a new activity type that clients should see, add it to that set.

## Rule 8: Client-facing copy MUST use STUDIO_NAME constant

Any user-facing text that references the studio, team, or agency name MUST use the `STUDIO_NAME` constant. Never hardcode "your team", "Web Team", "SEO team", "our team", "your web team", or "hmpsn studio".

**Why**: Centralizes branding for easy rebrand and future per-workspace agency resale (white-label).

**Constants**:
- Client: `import { STUDIO_NAME } from '../constants'` (or `'../../constants'` depending on depth)
- Server: `import { STUDIO_NAME } from './constants.js'`

**Interpolation rules**:
```tsx
// ✅ JSX text
<p>{STUDIO_NAME} will handle this.</p>

// ✅ Template literal (JS/TS)
setToast({ message: `Brief approved! ${STUDIO_NAME} will begin.` });

// ❌ Single-quoted string — won't interpolate
setToast({ message: 'Brief approved! ${STUDIO_NAME} will begin.' });

// ❌ JSX text with dollar sign — renders literal ${STUDIO_NAME}
<p>Brief approved! ${STUDIO_NAME} will begin.</p>
```
