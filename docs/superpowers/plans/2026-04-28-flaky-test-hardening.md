# Flaky Integration Test Hardening — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Eliminate intermittent CI failures in `brand-engine-routes.test.ts` and `brand-identity-hardening.test.ts` by adding a two-stage server readiness check to `tests/integration/helpers.ts`.

**Architecture:** Add an exported `waitForServer(base, options?)` function that polls `GET /api/health` after the "running on" stdout signal fires. `startServer()` is updated to call it before resolving, so no test request can land before routes are serving. No server changes, no test-file changes — the fix is transparent.

**Tech Stack:** Node.js `fetch` (built-in, Node 18+), Vitest 4.x fake timers (`vi.useFakeTimers`, `vi.stubGlobal`, `vi.runAllTimersAsync`).

---

## Pre-requisites

- [x] Spec committed: `docs/superpowers/specs/2026-04-28-flaky-test-hardening-design.md`
- [ ] Pre-plan audit: not applicable (single-file utility addition, not a codebase-wide change)

---

## File Map

| Action | File | What changes |
|--------|------|-------------|
| **Modify** | `tests/integration/helpers.ts` | Add `waitForServer()` export; update `startServer()` to call it before resolving |
| **Create** | `tests/unit/wait-for-server.test.ts` | Unit tests for `waitForServer()` retry/resolve/throw behaviour |

No other files are touched.

---

## Task Dependencies

```
Task 1 (unit tests — write first, run to confirm FAIL) 
  → Task 2 (implement waitForServer + wire startServer)
    → Task 3 (stability runs + docs update)
```

All sequential. No parallel work; both changes land in the same file.

---

## Task 1 — Unit tests for `waitForServer` (Model: sonnet)

**Owns:**
- Create: `tests/unit/wait-for-server.test.ts`

**Must not touch:**
- `tests/integration/helpers.ts` (owned by Task 2)

These tests drive the implementation. Write them first, confirm they fail, then hand off to Task 2.

- [ ] **Step 1.1 — Create the test file**

Create `tests/unit/wait-for-server.test.ts` with the full content below. The file imports `waitForServer` from helpers before it is implemented, so the import will fail at runtime — that's the expected red state.

```typescript
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { waitForServer } from '../integration/helpers.js';

describe('waitForServer', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it('resolves immediately when /api/health returns 200 on the first attempt', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ status: 200 }));
    await expect(
      waitForServer('http://localhost:9999', { maxRetries: 3, intervalMs: 10 })
    ).resolves.toBeUndefined();
  });

  it('polls the /api/health path specifically', async () => {
    const mockFetch = vi.fn().mockResolvedValue({ status: 200 });
    vi.stubGlobal('fetch', mockFetch);
    await waitForServer('http://localhost:9999', { maxRetries: 1, intervalMs: 10 });
    expect(mockFetch).toHaveBeenCalledWith('http://localhost:9999/api/health');
  });

  it('retries on non-200 and resolves when 200 eventually arrives', async () => {
    const mockFetch = vi.fn()
      .mockResolvedValueOnce({ status: 503 })
      .mockResolvedValueOnce({ status: 503 })
      .mockResolvedValue({ status: 200 });
    vi.stubGlobal('fetch', mockFetch);

    const promise = waitForServer('http://localhost:9999', { maxRetries: 5, intervalMs: 10 });
    await vi.runAllTimersAsync();
    await expect(promise).resolves.toBeUndefined();
    expect(mockFetch).toHaveBeenCalledTimes(3);
  });

  it('retries when fetch throws (ECONNREFUSED) and resolves on eventual 200', async () => {
    const mockFetch = vi.fn()
      .mockRejectedValueOnce(new Error('ECONNREFUSED'))
      .mockRejectedValueOnce(new Error('ECONNREFUSED'))
      .mockResolvedValue({ status: 200 });
    vi.stubGlobal('fetch', mockFetch);

    const promise = waitForServer('http://localhost:9999', { maxRetries: 5, intervalMs: 10 });
    await vi.runAllTimersAsync();
    await expect(promise).resolves.toBeUndefined();
    expect(mockFetch).toHaveBeenCalledTimes(3);
  });

  it('throws after exhausting all retries', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ status: 503 }));

    const promise = waitForServer('http://localhost:9999', { maxRetries: 3, intervalMs: 10 });
    await vi.runAllTimersAsync();
    await expect(promise).rejects.toThrow('did not become healthy after 3 retries');
  });
});
```

- [ ] **Step 1.2 — Run to confirm failure (red state)**

```bash
npx vitest run tests/unit/wait-for-server.test.ts --reporter=verbose
```

Expected: all 5 tests fail with `SyntaxError` or `waitForServer is not a function` because the export does not exist yet.

---

## Task 2 — Implement `waitForServer` and wire into `startServer()` (Model: haiku)

**Owns:**
- Modify: `tests/integration/helpers.ts`

**Must not touch:**
- `tests/unit/wait-for-server.test.ts` (owned by Task 1)

The entire change is two edits to `tests/integration/helpers.ts`:

1. Add the `waitForServer` export before `createTestContext`.
2. Update the `startServer()` inner promise to call `waitForServer` before resolving.

- [ ] **Step 2.1 — Add the `waitForServer` export**

Open `tests/integration/helpers.ts`. After the closing brace of the `createTestContext` function (around line 214, after the `return { ... }` block), add this new exported function **before** the `// ─── Test assertion factories` comment:

```typescript
/**
 * Poll GET {base}/api/health until it returns 200.
 *
 * Called by startServer() after the "running on" stdout signal so tests never
 * fire before routes are actively serving. Also exported for test files that
 * need custom retry parameters.
 */
export async function waitForServer(
  base: string,
  options?: { maxRetries?: number; intervalMs?: number },
): Promise<void> {
  const { maxRetries = 15, intervalMs = 200 } = options ?? {};

  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      const res = await fetch(`${base}/api/health`);
      if (res.status === 200) return;
    } catch {
      // ECONNREFUSED or other transient error — retry
    }
    if (attempt < maxRetries - 1) {
      await new Promise<void>(resolve => setTimeout(resolve, intervalMs));
    }
  }
  throw new Error(
    `Server on ${base} did not become healthy after ${maxRetries} retries`,
  );
}
```

- [ ] **Step 2.2 — Wire `waitForServer` into `startServer()`**

Still in `tests/integration/helpers.ts`, inside the `startServer()` function, find the `proc!.stdout?.on('data', ...)` callback. Replace:

```typescript
      proc!.stdout?.on('data', (data: Buffer) => {
        const text = data.toString();
        if (text.includes('running on')) {
          clearTimeout(timeout);
          resolve();
        }
      });
```

with:

```typescript
      proc!.stdout?.on('data', (data: Buffer) => {
        const text = data.toString();
        if (text.includes('running on')) {
          // Stage 2: confirm routes are serving before resolving.
          // Keep the timeout active across both stages so a health-check hang
          // still triggers the 20-second deadline.
          waitForServer(BASE)
            .then(() => { clearTimeout(timeout); resolve(); })
            .catch(err => { clearTimeout(timeout); reject(err); });
        }
      });
```

> **Note:** The `waitForServer` call is deliberatedly placed *before* `clearTimeout` so the 20-second startup deadline still applies if `/api/health` never becomes healthy. `BASE` is already in scope from the outer `createTestContext(port)` closure.

- [ ] **Step 2.3 — Run the unit tests to confirm green**

```bash
npx vitest run tests/unit/wait-for-server.test.ts --reporter=verbose
```

Expected output: 5 tests pass.

```
✓ resolves immediately when /api/health returns 200 on the first attempt
✓ polls the /api/health path specifically
✓ retries on non-200 and resolves when 200 eventually arrives
✓ retries when fetch throws (ECONNREFUSED) and resolves on eventual 200
✓ throws after exhausting all retries
```

- [ ] **Step 2.4 — Typecheck**

```bash
npm run typecheck
```

Expected: zero errors.

- [ ] **Step 2.5 — Commit**

```bash
git add tests/integration/helpers.ts tests/unit/wait-for-server.test.ts
git commit -m "fix: add waitForServer health-check to eliminate integration test flakiness (roadmap #626)"
```

---

## Task 3 — Stability verification + docs (Model: haiku)

**Owns:**
- `data/roadmap.json`
- `FEATURE_AUDIT.md`

**Must not touch:** any file modified in Tasks 1–2.

- [ ] **Step 3.1 — Run the two previously-flaky test files 3× each**

Run each file three times in a row. All runs must pass before proceeding.

```bash
npx vitest run tests/integration/brand-engine-routes.test.ts --reporter=verbose
npx vitest run tests/integration/brand-engine-routes.test.ts --reporter=verbose
npx vitest run tests/integration/brand-engine-routes.test.ts --reporter=verbose
```

```bash
npx vitest run tests/integration/brand-identity-hardening.test.ts --reporter=verbose
npx vitest run tests/integration/brand-identity-hardening.test.ts --reporter=verbose
npx vitest run tests/integration/brand-identity-hardening.test.ts --reporter=verbose
```

Expected: 6 × PASS with no HTML-fallback or connection-drop errors.

If any run fails, re-read the `waitForServer` implementation in `helpers.ts` and confirm `clearTimeout` is only called inside `.then`/`.catch`, not before calling `waitForServer`.

- [ ] **Step 3.2 — Full test suite**

```bash
npx vitest run
```

Expected: full suite green. No regressions.

- [ ] **Step 3.3 — Build verify**

```bash
npm run typecheck && npx vite build
```

Expected: zero errors, build succeeds.

- [ ] **Step 3.4 — pr-check**

```bash
npx tsx scripts/pr-check.ts
```

Expected: zero errors. (The pre-existing `⚠ Page component missing PageHeader` warning is listed in CLAUDE.md Known Issues — ignore it.)

- [ ] **Step 3.5 — Update `data/roadmap.json`**

Find roadmap item `"id": 626` and update it:

```json
{
  "id": 626,
  "title": "Harden flaky brand-engine + brand-identity integration tests",
  "status": "done",
  "notes": "Shipped 2026-04-28. Added waitForServer(base, options?) to tests/integration/helpers.ts — polls GET /api/health after the 'running on' stdout signal before resolving startServer(). The 20-second startup timeout now covers both stage 1 (port bind) and stage 2 (health check). All five unit tests in tests/unit/wait-for-server.test.ts cover: immediate 200, ECONNREFUSED retry, non-200 retry, exhausted-retries throw, and correct path polling."
}
```

Then sort:

```bash
npx tsx scripts/sort-roadmap.ts
```

- [ ] **Step 3.6 — Final commit**

```bash
git add data/roadmap.json
git commit -m "chore: mark roadmap #626 done — flaky test hardening shipped"
```

---

## Task Dependencies (summary)

```
Task 1 (write unit tests → confirm RED)
  → Task 2 (implement + wire → confirm GREEN)
    → Task 3 (stability runs + docs)
```

---

## Systemic Improvements

- **Shared utility extracted:** `waitForServer` is exported from `helpers.ts`. Any future integration test suite that needs a custom readiness delay can import and call it directly in its own `beforeAll` rather than duplicating polling logic inline.
- **pr-check rule:** Not warranted — this is test infrastructure, not a recurring codebase pattern with a risk of regression.
- **New tests:** `tests/unit/wait-for-server.test.ts` (5 tests covering the full retry/resolve/throw behaviour of `waitForServer`).

---

## Verification Strategy

| Check | Command | Pass condition |
|---|---|---|
| Unit tests (new) | `npx vitest run tests/unit/wait-for-server.test.ts --reporter=verbose` | 5/5 pass |
| Flaky file 1 × 3 runs | `npx vitest run tests/integration/brand-engine-routes.test.ts` (×3) | 3/3 pass, no HTML-fallback error |
| Flaky file 2 × 3 runs | `npx vitest run tests/integration/brand-identity-hardening.test.ts` (×3) | 3/3 pass, no connection-drop error |
| Full suite | `npx vitest run` | All tests pass |
| Typecheck | `npm run typecheck` | Zero errors |
| Build | `npx vite build` | Succeeds |
| pr-check | `npx tsx scripts/pr-check.ts` | Zero errors |
