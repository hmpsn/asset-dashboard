# Flaky Integration Test Hardening

**Date:** 2026-04-28  
**Roadmap:** Item 626 (P1, est. 1-2h)  
**Status:** Approved

---

## Problem

Two integration test files produce intermittent CI failures that always pass on rerun, blocking confident staging merges:

| File | Port | Failure |
|---|---|---|
| `tests/integration/brand-engine-routes.test.ts` | 13317 | `SyntaxError: Unexpected token '<'...` — server returns Vite SPA fallback HTML instead of JSON |
| `tests/integration/brand-identity-hardening.test.ts` | 13226 | `TypeError: fetch failed / SocketError: other side closed` — connection drops mid-test |

**Root cause:** `startServer()` in `tests/integration/helpers.ts` resolves as soon as it sees the `"running on"` string in the child process stdout. This confirms `server.listen()` fired, but does not confirm that Express routes are actively serving. Under CI load, the first test request can arrive in the gap between port-bind and route-ready, causing the Vite SPA catch-all to respond instead, or the connection to drop.

---

## Design

### One file, one function

All changes are in `tests/integration/helpers.ts`. No test files are modified. No server code changes.

### `waitForServer(base, options?)` — new exported helper

Polls `GET {base}/api/health` after the port binds. Returns a promise that resolves when the server responds with HTTP 200.

```
waitForServer(base: string, options?: { maxRetries?: number; intervalMs?: number }): Promise<void>
```

**Defaults:** `maxRetries = 15`, `intervalMs = 200` (3 seconds total budget).

**Retry logic:**
- Connection refused → retry after `intervalMs`
- Non-200 response → retry after `intervalMs`
- 200 → resolve immediately
- Exhausted retries → throw `Error('Server on ${base} did not become healthy after ${maxRetries} retries')`

**Exported** so individual `beforeAll` blocks can call it standalone if a test file needs custom retry parameters (e.g. the brand-identity suite with its 30s timeout).

### `startServer()` — two-stage readiness

```
stage 1: stdout includes "running on"  → server.listen() callback fired, OS port is bound
stage 2: waitForServer(BASE)           → GET /api/health returned 200, routes are serving
```

`startServer()` resolves only after both stages pass. The existing 20-second timeout covers the combined wait without changes.

### What does NOT change

- `api`, `postJson`, `patchJson`, `del`, and auth variants — identical, no retry-on-HTML logic added
- Vitest thread/pool config — parallelism stays default
- Server code — no changes to `server/index.ts` or route files
- Individual test files — no changes needed; the fix is transparent via `startServer()`

---

## `/api/health` endpoint

Already exists at `server/routes/health.ts:97`. Returns 200 with no auth required. Safe to hit in test environments. No changes needed.

---

## Acceptance criteria

- `brand-engine-routes.test.ts` passes on 5 consecutive local runs without HTML-fallback errors
- `brand-identity-hardening.test.ts` passes on 5 consecutive local runs without connection-drop errors
- Full test suite (`npx vitest run`) still passes
- `npm run typecheck && npx vite build` passes
- `npx tsx scripts/pr-check.ts` passes

---

## Out of scope

- `--threads=1` / `--pool` config changes
- Retry-on-HTML in HTTP helpers
- Any other flaky test files (this PR targets item 626 specifically)
