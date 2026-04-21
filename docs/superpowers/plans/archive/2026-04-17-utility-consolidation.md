# Utility Consolidation (Items 1–8, 19–21) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Eliminate ~60 duplicated utility functions across the server and frontend by extracting them into well-placed shared modules with no behavior change.

**Architecture:** New server utilities land in the already-existing `server/helpers.ts` (currently 364 lines). Frontend utilities go into `src/lib/`. Shared isomorphic scoring constants move to `shared/scoring.ts` (new file). No new npm dependencies. All 5 PRs target `staging` first before `main`.

**Tech Stack:** TypeScript strict, Express/Node.js (server), React 19/Vite (frontend), existing test infrastructure (`npx vitest run`, `npx tsx scripts/pr-check.ts`).

---

## Pre-Requisites

- [ ] Read `server/helpers.ts` current exports before any task — do not re-add functions that already exist.
- [ ] Run `grep -r 'createTestContext(' tests/` to confirm no port conflicts before writing any new integration test files. (This refactor adds unit tests only, not integration tests — no new ports needed.)

---

## File Map — What Is Created or Modified

### New files
| File | Purpose |
|------|---------|
| `src/lib/timeAgo.ts` | Shared frontend relative-time formatter (Item 2) |
| `shared/scoring.ts` | Isomorphic scoring constants + `computePageScore()` (Item 7) |

### Modified files — server
| File | Changes |
|------|---------|
| `server/helpers.ts` | Add `stripHtmlToText()`, `stripCodeFences()`, `normalizePageUrl()`, `resolveBaseUrl()`, `computePageScore()` (Items 1, 4, 6, 8, 20, 21) |
| `server/seo-audit.ts` | Add `export` to `fetchPageMeta`, `fetchPublishedHtml`; remove local `getToken`/`WEBFLOW_API` (Items 3, 4, 19) |
| `server/schema-suggester.ts` | Remove local `getToken`, `WEBFLOW_API`, `getSiteSubdomain`, `fetchPageMeta`, `fetchPublishedHtml`; add imports; replace 5× base-URL blocks (Items 3–5, 19, 20) |
| `server/pagespeed.ts` | Remove local `getToken`, `WEBFLOW_API`, `getSiteSubdomain`; add imports (Items 5, 19) |
| `server/redirect-scanner.ts` | Remove local `getToken`, `WEBFLOW_API`, `getSiteSubdomain`; replace 1× base-URL block (Items 5, 19, 20) |
| `server/link-checker.ts` | Remove local `getToken`, `WEBFLOW_API`; add imports (Item 19) |
| `server/audit-page.ts` | Remove inline scoring loop; import `computePageScore` from `shared/scoring.ts` (Item 7) |
| `server/analytics-intelligence.ts` | Replace local `normalizePageUrl` with import from `helpers.ts` (Item 8) |
| `server/roi-attribution.ts` | Replace local `normalizePageUrl` with import from `helpers.ts` (Item 8) |
| `server/internal-links.ts` | Replace inline HTML stripping with `stripHtmlToText`; replace inline fence strip with `stripCodeFences` (Items 1, 21) |
| `server/aeo-page-review.ts` | Same as internal-links.ts (Items 1, 21) |
| `server/routes/webflow-seo.ts` | Consolidate 4→1 `enforceLimit`; replace 7× HTML strip + 14× fence strip (Items 1, 6, 21) |
| `server/routes/keyword-strategy.ts` | Replace HTML strip + fence strip (Items 1, 21) |
| `server/routes/jobs.ts` | Replace HTML strip + fence strip (Items 1, 21) |
| `server/routes/webflow-keywords.ts` | Replace fence strip (Item 21) |
| `server/routes/public-analytics.ts` | Replace fence strip (Item 21) |
| `server/routes/rewrite-chat.ts` | Replace HTML strip (Item 1) |
| `server/routes/webflow-cms.ts` | Replace 1× base-URL block (Item 20) |
| `server/routes/webflow.ts` | Replace 1× base-URL block (Item 20) |
| `server/routes/workspaces.ts` | Replace 1× base-URL block (Item 20) |
| `server/routes/aeo-review.ts` | Replace 1× base-URL block (Item 20) |
| `server/routes/jobs.ts` | Replace 4× base-URL blocks (Item 20 — same file as above) |
| `server/copy-generation.ts` | Replace fence strip (Item 21) |
| `server/blueprint-generator.ts` | Replace fence strip (Item 21) |
| `server/content-brief.ts` | Replace fence strip (Item 21) |
| `server/openai-helpers.ts` | Replace fence strip (Item 21) |
| `server/outcome-measurement.ts` | Replace 1× base-URL block (Item 20) |

### Modified files — frontend
| File | Changes |
|------|---------|
| `src/components/WorkspaceOverview.tsx` | Replace local `timeAgo` (Item 2) |
| `src/components/AnomalyAlerts.tsx` | Replace local `timeAgo` (Item 2) |
| `src/components/workspace-home/ActivityFeed.tsx` | Replace local `timeAgo` (Item 2) |
| `src/components/workspace-home/ActiveRequestsAnnotations.tsx` | Replace local `timeAgo` (Item 2) |
| `src/components/ContentCalendar.tsx` | Replace local `relativeDate` (Item 2) |
| `src/components/matrix/CellDetailPanel.tsx` | Replace local `relativeTime` (Item 2) |
| `src/components/SeoAudit.tsx` | Replace inline scoring loop with `computePageScore` from `shared/scoring.ts` (Item 7) |

---

## Task Dependencies

```
Phase 1 (PR 1) — Items 2 + 8 — No deps on anything else
  Task 1.1 (create timeAgo.ts)  ∥  Task 1.2 (normalizePageUrl in helpers.ts)
  Task 1.3 (update 7 components — depends on 1.1)
  Task 1.4 (update 2 server files — depends on 1.2)

Phase 2 (PR 2) — Items 19 + 3 + 4 + 5 — No deps on Phase 1
  Task 2.1 (seo-audit.ts: remove getToken/WEBFLOW_API, add exports) — FIRST
  Then parallel:
    Task 2.2 (schema-suggester.ts) ∥ Task 2.3 (pagespeed.ts) ∥ Task 2.4 (redirect-scanner.ts + link-checker.ts)

Phase 3 (PR 3) — Items 1 + 21 — No deps on Phase 2
  Task 3.1 (add stripHtmlToText + stripCodeFences to helpers.ts) — FIRST
  Then parallel:
    Task 3.2 (webflow-seo.ts) ∥ Task 3.3 (multi-strip files) ∥ Task 3.4 (fence-only files)

Phase 4 (PR 4) — Item 20 — Depends on Phase 2 (getSiteSubdomain is already exported from webflow-pages.ts — no dep needed, but Phase 2 clean-up is nice to have first)
  Task 4.1 (add resolveBaseUrl to helpers.ts) — FIRST
  Then parallel:
    Task 4.2 (webflow-seo.ts) ∥ Task 4.3 (schema-suggester.ts) ∥ Task 4.4 (jobs.ts) ∥ Task 4.5 (remaining 7 files)

Phase 5 (PR 5) — Items 6 + 7 — No deps on prior phases
  Task 5.1 (enforceLimit in webflow-seo.ts) ∥ Task 5.2 (computePageScore in shared + audit-page + SeoAudit)
```

---

## Phase 1 — PR 1: `timeAgo` and `normalizePageUrl`

**Branch:** `refactor/pr1-time-url-utils` (from `staging`)

### Task 1.1 — Create `src/lib/timeAgo.ts` (Model: haiku)

**Owns:** `src/lib/timeAgo.ts` (NEW), `tests/unit/lib/timeAgo.test.ts` (NEW)  
**Must not touch:** Any component file — that is Task 1.3.

- [ ] **Step 1: Write the failing unit test**

Create `tests/unit/lib/timeAgo.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { timeAgo } from '../../../src/lib/timeAgo';

describe('timeAgo', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2024-06-15T12:00:00Z'));
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('returns "just now" for < 1 minute', () => {
    const d = new Date(Date.now() - 30_000).toISOString();
    expect(timeAgo(d)).toBe('just now');
  });

  it('returns "Xm ago" for < 1 hour', () => {
    const d = new Date(Date.now() - 5 * 60_000).toISOString();
    expect(timeAgo(d)).toBe('5m ago');
  });

  it('returns "Xh ago" for < 24 hours', () => {
    const d = new Date(Date.now() - 3 * 3_600_000).toISOString();
    expect(timeAgo(d)).toBe('3h ago');
  });

  it('returns "yesterday" for exactly 1 day', () => {
    const d = new Date(Date.now() - 1 * 86_400_000).toISOString();
    expect(timeAgo(d)).toBe('yesterday');
  });

  it('returns "Xd ago" for < 30 days', () => {
    const d = new Date(Date.now() - 5 * 86_400_000).toISOString();
    expect(timeAgo(d)).toBe('5d ago');
  });

  it('returns formatted date for >= 30 days', () => {
    const d = new Date(Date.now() - 35 * 86_400_000).toISOString();
    // exact output depends on locale but should not be "35d ago"
    expect(timeAgo(d)).not.toMatch(/^\d+d ago$/);
    expect(timeAgo(d)).toMatch(/^[A-Za-z]+ \d+$/); // e.g. "May 11"
  });
});
```

- [ ] **Step 2: Run test — expect it to fail (module not found)**

```bash
cd /Users/joshuahampson/CascadeProjects/asset-dashboard && npx vitest run tests/unit/lib/timeAgo.test.ts
```

Expected: `Error: Cannot find module '../../../src/lib/timeAgo'`

- [ ] **Step 3: Create `src/lib/timeAgo.ts`**

```typescript
/**
 * Format a date string as a human-readable relative time.
 * Superset of all 7 local variants in the codebase (WorkspaceOverview,
 * AnomalyAlerts, ActivityFeed, ActiveRequestsAnnotations, ContentCalendar,
 * CellDetailPanel, and related).
 */
export function timeAgo(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60_000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days === 1) return 'yesterday';
  if (days < 30) return `${days}d ago`;
  return new Date(dateStr).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}
```

- [ ] **Step 4: Run test — expect pass**

```bash
npx vitest run tests/unit/lib/timeAgo.test.ts
```

Expected: All 6 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/timeAgo.ts tests/unit/lib/timeAgo.test.ts
git commit -m "feat(utils): add shared timeAgo() to src/lib/timeAgo.ts"
```

---

### Task 1.2 — Add `normalizePageUrl` to `server/helpers.ts` (Model: haiku)

**Owns:** `server/helpers.ts` (modify), `tests/unit/helpers.normalizePageUrl.test.ts` (NEW)  
**Must not touch:** `server/analytics-intelligence.ts`, `server/roi-attribution.ts` — those are Task 1.4.

**Context:** `normalizePath(p)` already exists in `server/helpers.ts:24`. It ensures a leading slash and strips trailing slashes. The new `normalizePageUrl` wraps it to also handle full `https://` URLs by extracting the pathname first. `roi-attribution.ts` already defines this exact pattern locally — we are making it shared.

**Behavioral note:** The current `analytics-intelligence.ts` local version returns the FULL URL including origin (e.g., `https://example.com/blog`). The shared version — matching `roi-attribution.ts` — returns only the PATH (e.g., `/blog`). Before Task 1.4 replaces the analytics-intelligence.ts version, verify that it's only used for internal comparison (map keys compared to other normalized values), NOT for returning URLs in output. If that check fails, raise it before proceeding.

- [ ] **Step 1: Write the failing test**

Create `tests/unit/helpers.normalizePageUrl.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { normalizePageUrl } from '../../server/helpers';

describe('normalizePageUrl', () => {
  it('extracts and normalizes path from full URL', () => {
    expect(normalizePageUrl('https://example.com/blog/post/')).toBe('/blog/post');
  });

  it('handles path-only input', () => {
    expect(normalizePageUrl('/blog/post/')).toBe('/blog/post');
  });

  it('keeps root path', () => {
    expect(normalizePageUrl('https://example.com/')).toBe('/');
    expect(normalizePageUrl('/')).toBe('/');
  });

  it('handles malformed URL gracefully', () => {
    expect(normalizePageUrl('not-a-url')).toBe('/not-a-url');
  });

  it('strips query string and hash from full URL', () => {
    expect(normalizePageUrl('https://example.com/page?q=1#section')).toBe('/page');
  });
});
```

- [ ] **Step 2: Run test — expect failure**

```bash
npx vitest run tests/unit/helpers.normalizePageUrl.test.ts
```

Expected: `Error: normalizePageUrl is not exported`

- [ ] **Step 3: Add `normalizePageUrl` to `server/helpers.ts`**

Open `server/helpers.ts`. After the `resolvePagePath` function (around line 43), add:

```typescript
/**
 * Normalize a URL or path for cross-referencing.
 * Accepts full URLs (https://...) or bare paths. Strips origin, query,
 * and hash; normalizes trailing slash via normalizePath.
 * Used for reliable ROI page_url ↔ insight page_id matching.
 */
export function normalizePageUrl(url: string): string {
  try {
    if (url.startsWith('http')) {
      return normalizePath(new URL(url).pathname);
    }
  } catch {
    // fall through to path-only normalization
  }
  return normalizePath(url);
}
```

- [ ] **Step 4: Run test — expect pass**

```bash
npx vitest run tests/unit/helpers.normalizePageUrl.test.ts
```

Expected: All 5 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add server/helpers.ts tests/unit/helpers.normalizePageUrl.test.ts
git commit -m "feat(utils): export normalizePageUrl() from server/helpers.ts"
```

---

### Task 1.3 — Update 7 frontend components to use shared `timeAgo` (Model: haiku)

**Owns:** All 7 component files listed below.  
**Must not touch:** `src/lib/timeAgo.ts` (Task 1.1's file — read-only).  
**Prerequisite:** Task 1.1 committed.

For each file below, the pattern is identical:
1. Delete the local function definition.
2. Add `import { timeAgo } from '../../lib/timeAgo';` at the top (adjust relative path).
3. Replace all call sites of the local function with `timeAgo(...)`.
4. Run typecheck after each file.

**Files and local function names to replace:**

| File | Local function name | Relative import path |
|------|--------------------|-----------------------|
| `src/components/WorkspaceOverview.tsx` ~line 26 | `timeAgo` | `'../lib/timeAgo'` |
| `src/components/AnomalyAlerts.tsx` ~line 48 | `timeAgo` | `'../lib/timeAgo'` |
| `src/components/workspace-home/ActivityFeed.tsx` ~line 31 | `timeAgo` | `'../../lib/timeAgo'` |
| `src/components/workspace-home/ActiveRequestsAnnotations.tsx` ~line 6 | `timeAgo` | `'../../lib/timeAgo'` |
| `src/components/ContentCalendar.tsx` ~line 74 | `relativeDate` — rename calls to `timeAgo` | `'../lib/timeAgo'` |
| `src/components/matrix/CellDetailPanel.tsx` ~line 19 | `relativeTime` — rename calls to `timeAgo` | `'../../lib/timeAgo'` |

> **Note on `LlmsTxtGenerator.tsx`:** The spec mentions `formatFreshness` in this file. Before touching it, read the function — if it formats staleness differently from `timeAgo` (e.g., it uses threshold labels rather than elapsed time), leave it as-is and note that in the commit message.

- [ ] **Step 1: Check for existing tests that reference the local functions**

```bash
grep -r 'timeAgo\|relativeDate\|relativeTime' tests/ --include="*.ts" --include="*.tsx" -l
```

If any test files appear, update their imports to use `src/lib/timeAgo` too.

- [ ] **Step 2: Update each component file**

For each file: open it, locate the local function definition, delete it, add the import at the top of the import block, replace all usages with `timeAgo(...)`.

- [ ] **Step 3: Check `LlmsTxtGenerator.tsx`**

```bash
grep -n 'formatFreshness' src/components/LlmsTxtGenerator.tsx
```

Read the function body. If semantics differ from `timeAgo`, skip it and note why.

- [ ] **Step 4: Typecheck**

```bash
npm run typecheck
```

Expected: Zero errors.

- [ ] **Step 5: Run component tests**

```bash
npx vitest run tests/component/
```

Expected: All pass (same as before your changes).

- [ ] **Step 6: Commit**

```bash
git add src/components/WorkspaceOverview.tsx src/components/AnomalyAlerts.tsx \
  src/components/workspace-home/ActivityFeed.tsx \
  src/components/workspace-home/ActiveRequestsAnnotations.tsx \
  src/components/ContentCalendar.tsx src/components/matrix/CellDetailPanel.tsx
git commit -m "refactor(frontend): replace 6 local timeAgo variants with shared src/lib/timeAgo"
```

---

### Task 1.4 — Update `analytics-intelligence.ts` and `roi-attribution.ts` to use shared `normalizePageUrl` (Model: haiku)

**Owns:** `server/analytics-intelligence.ts`, `server/roi-attribution.ts`  
**Must not touch:** `server/helpers.ts` (Task 1.2's file).  
**Prerequisite:** Task 1.2 committed.

**STOP before editing `analytics-intelligence.ts`:** The current local `normalizePageUrl` returns the FULL URL including origin (e.g., `https://example.com/blog`). The shared version returns ONLY the path (e.g., `/blog`). This is a behavioral change.

- [ ] **Step 1: Verify safe replacement in `analytics-intelligence.ts`**

```bash
grep -n 'normalizePageUrl' server/analytics-intelligence.ts
```

Read each usage site. Confirm:
- The normalized value is only used as a map key compared to other normalized values from the SAME function call (internal deduplication).
- It is NOT returned in a response body or compared to externally-sourced full URLs.

If the check fails (i.e., normalized values ARE returned externally), stop and report — do not proceed with this file until the spec author clarifies.

- [ ] **Step 2: Update `analytics-intelligence.ts`**

Replace the local `normalizePageUrl` function definition (around line 56):

```typescript
// BEFORE (delete this):
function normalizePageUrl(url: string): string {
  try {
    const u = new URL(url);
    let path = u.pathname;
    if (path.length > 1 && path.endsWith('/')) path = path.slice(0, -1);
    return `${u.origin}${path}`;
  } catch (err) {
    return url.length > 1 && url.endsWith('/') ? url.slice(0, -1) : url;
  }
}
```

Add to the imports at the top of the file (check existing imports first with `grep -n '^import' server/analytics-intelligence.ts`):

```typescript
import { normalizePageUrl } from './helpers.js';
```

- [ ] **Step 3: Update `roi-attribution.ts`**

Replace the local `normalizePageUrl` function (lines 15-24) with the import. The logic is identical so no call-site changes are needed:

```typescript
// DELETE the local function block (lines 10-24 approximately)
```

Add to imports:

```typescript
import { normalizePath, normalizePageUrl } from './helpers.js';
```

Remove the now-unused `normalizePath` import from that file if it was only used by the local `normalizePageUrl`.

- [ ] **Step 4: Typecheck and test**

```bash
npm run typecheck && npx vitest run
```

Expected: Zero type errors, full test suite green.

- [ ] **Step 5: Commit**

```bash
git add server/analytics-intelligence.ts server/roi-attribution.ts
git commit -m "refactor(server): use shared normalizePageUrl() in analytics-intelligence + roi-attribution"
```

---

### Phase 1 PR Gate

- [ ] `npm run typecheck` — zero errors
- [ ] `npx vite build` — succeeds
- [ ] `npx vitest run` — full suite green
- [ ] `npx tsx scripts/pr-check.ts` — zero violations
- [ ] Open PR: `refactor/pr1-time-url-utils` → `staging`

---

## Phase 2 — PR 2: Webflow API Client Consolidation (Items 19 + 3 + 4 + 5)

**Branch:** `refactor/pr2-webflow-client` (from `staging`)

**Context:** `server/webflow-client.ts` already exports `getToken(workspaceId, tokenOverride?)` and `webflowFetch(endpoint, options, tokenOverride?)`. Several files define their own private copies of `getToken` and `WEBFLOW_API = 'https://api.webflow.com/v2'`. This PR deletes those copies and switches to the canonical exports. `getSiteSubdomain` is already exported from `server/webflow-pages.ts:132`.

### Task 2.1 — `seo-audit.ts`: Remove local `getToken`/`WEBFLOW_API`, add `export` to `fetchPageMeta` + `fetchPublishedHtml` (Model: haiku)

**Owns:** `server/seo-audit.ts`  
**Must not touch:** Any other file — those are Tasks 2.2–2.4.

- [ ] **Step 1: Read the current imports and function definitions**

```bash
grep -n 'WEBFLOW_API\|getToken\|fetchPageMeta\|fetchPublishedHtml' server/seo-audit.ts
```

Note the exact line numbers of the local `WEBFLOW_API` constant and `getToken` function.

- [ ] **Step 2: Delete local `WEBFLOW_API` and `getToken`**

Remove the `const WEBFLOW_API = 'https://api.webflow.com/v2'` line and the local `getToken` function definition. Add the import:

```typescript
import { getToken, webflowFetch } from './webflow-client.js';
```

Check if any existing calls in the file use `WEBFLOW_API + '/...'` directly (not via `getToken`). If so, replace with `webflowFetch('/...')` using the existing `tokenOverride` argument pattern.

- [ ] **Step 3: Add `export` to `fetchPageMeta` and `fetchPublishedHtml`**

Find the lines where these functions are declared. Change from:

```typescript
async function fetchPageMeta(...
async function fetchPublishedHtml(...
```

To:

```typescript
export async function fetchPageMeta(...
export async function fetchPublishedHtml(...
```

- [ ] **Step 4: Typecheck this file only**

```bash
npm run typecheck 2>&1 | grep 'seo-audit'
```

Expected: No errors mentioning `seo-audit.ts`.

- [ ] **Step 5: Commit**

```bash
git add server/seo-audit.ts
git commit -m "refactor(webflow): use shared getToken in seo-audit.ts; export fetchPageMeta/fetchPublishedHtml"
```

---

### Task 2.2 — `schema-suggester.ts`: Consolidate all Webflow API imports (Model: haiku)

**Owns:** `server/schema-suggester.ts`  
**Must not touch:** Any other file.  
**Prerequisite:** Task 2.1 committed (to import from `seo-audit.ts`).

- [ ] **Step 1: Audit current local definitions**

```bash
grep -n 'WEBFLOW_API\|getToken\|getSiteSubdomain\|fetchPageMeta\|fetchPublishedHtml' server/schema-suggester.ts
```

Record line numbers of all 5 patterns.

- [ ] **Step 2: Remove local definitions, add imports**

Delete the local `WEBFLOW_API`, `getToken`, `getSiteSubdomain`, `fetchPageMeta`, `fetchPublishedHtml` function definitions.

Add at the top of imports (check existing imports with `grep -n '^import' server/schema-suggester.ts` first):

```typescript
import { getToken, webflowFetch } from './webflow-client.js';
import { getSiteSubdomain } from './webflow-pages.js';
import { fetchPageMeta, fetchPublishedHtml } from './seo-audit.js';
```

**Note on `tokenOverride`:** The spec notes that `schema-suggester.ts`'s local `getToken` accepts a `tokenOverride` param — `webflowFetch` already supports this via its third argument. Anywhere the file calls `getToken(workspaceId, tokenOverride)` and then uses the token in a raw `fetch()`, replace the pattern:

```typescript
// BEFORE:
const token = await getToken(ws.id, tokenOverride);
const res = await fetch(`${WEBFLOW_API}/pages/${pageId}`, {
  headers: { Authorization: `Bearer ${token}` }
});

// AFTER:
const res = await webflowFetch(`/pages/${pageId}`, {}, tokenOverride);
```

- [ ] **Step 3: Typecheck**

```bash
npm run typecheck 2>&1 | grep 'schema-suggester'
```

Expected: No errors.

- [ ] **Step 4: Commit**

```bash
git add server/schema-suggester.ts
git commit -m "refactor(webflow): consolidate Webflow API access in schema-suggester.ts"
```

---

### Task 2.3 — `pagespeed.ts` + `redirect-scanner.ts` + `link-checker.ts`: Remove local Webflow API copies (Model: haiku)

**Owns:** `server/pagespeed.ts`, `server/redirect-scanner.ts`, `server/link-checker.ts`  
**Must not touch:** Any other file.

For each file, the pattern is the same as Task 2.2. Apply it independently to each.

- [ ] **Step 1: Audit each file**

```bash
grep -n 'WEBFLOW_API\|getToken\|getSiteSubdomain' server/pagespeed.ts server/redirect-scanner.ts server/link-checker.ts
```

- [ ] **Step 2: Update `pagespeed.ts`**

Remove local `WEBFLOW_API` and `getToken`. Check if `getSiteSubdomain` is also defined locally — if so, remove it too. Add:

```typescript
import { getToken, webflowFetch } from './webflow-client.js';
import { getSiteSubdomain } from './webflow-pages.js';
```

Replace raw fetch calls that used `WEBFLOW_API + ...` with `webflowFetch(...)`.

- [ ] **Step 3: Update `redirect-scanner.ts`**

Same pattern as pagespeed.ts.

- [ ] **Step 4: Update `link-checker.ts`**

Same pattern — note this file may only need the `getToken` removal (check the grep output from Step 1).

- [ ] **Step 5: Typecheck**

```bash
npm run typecheck
```

Expected: Zero errors.

- [ ] **Step 6: Run full test suite**

```bash
npx vitest run
```

Expected: All pass.

- [ ] **Step 7: Commit**

```bash
git add server/pagespeed.ts server/redirect-scanner.ts server/link-checker.ts
git commit -m "refactor(webflow): consolidate Webflow API access in pagespeed, redirect-scanner, link-checker"
```

---

### Phase 2 PR Gate

- [ ] `npm run typecheck` — zero errors
- [ ] `npx vite build` — succeeds
- [ ] `npx vitest run` — full suite green
- [ ] `npx tsx scripts/pr-check.ts` — zero violations
- [ ] Open PR: `refactor/pr2-webflow-client` → `staging`

---

## Phase 3 — PR 3: `stripHtmlToText` + `stripCodeFences` (Items 1 + 21)

**Branch:** `refactor/pr3-string-utils` (from `staging`)

### Task 3.1 — Add `stripHtmlToText` + `stripCodeFences` to `server/helpers.ts` (Model: haiku)

**Owns:** `server/helpers.ts` (modify — add two functions), `tests/unit/helpers.stringUtils.test.ts` (NEW)  
**Must not touch:** Any route file — those are Tasks 3.2–3.4.

- [ ] **Step 1: Write the failing tests**

Create `tests/unit/helpers.stringUtils.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { stripHtmlToText, stripCodeFences } from '../../server/helpers';

describe('stripHtmlToText', () => {
  it('extracts body content from full HTML document', () => {
    const html = '<html><head><title>T</title></head><body><p>Hello world</p></body></html>';
    expect(stripHtmlToText(html)).toBe('Hello world');
  });

  it('strips script and style tags', () => {
    const html = '<body><script>alert(1)</script><style>.x{}</style><p>Clean</p></body>';
    expect(stripHtmlToText(html)).toBe('Clean');
  });

  it('strips nav and footer by default', () => {
    const html = '<body><nav>Menu</nav><main>Content</main><footer>Footer</footer></body>';
    expect(stripHtmlToText(html)).not.toContain('Menu');
    expect(stripHtmlToText(html)).not.toContain('Footer');
    expect(stripHtmlToText(html)).toContain('Content');
  });

  it('strips header when stripHeader option is true', () => {
    const html = '<body><header>Site Header</header><main>Content</main></body>';
    expect(stripHtmlToText(html, { stripHeader: true })).not.toContain('Site Header');
    expect(stripHtmlToText(html, { stripHeader: false })).toContain('Site Header');
  });

  it('respects maxLength option', () => {
    const html = '<body><p>' + 'x'.repeat(200) + '</p></body>';
    const result = stripHtmlToText(html, { maxLength: 100 });
    expect(result.length).toBeLessThanOrEqual(100);
  });

  it('falls back to full input if no body tag found', () => {
    const html = '<p>No body tag here</p>';
    expect(stripHtmlToText(html)).toContain('No body tag here');
  });

  it('collapses whitespace', () => {
    const html = '<body><p>foo   bar\n\nbaz</p></body>';
    expect(stripHtmlToText(html)).toBe('foo bar baz');
  });
});

describe('stripCodeFences', () => {
  it('strips leading ```json fence', () => {
    expect(stripCodeFences('```json\n{"a":1}\n```')).toBe('{"a":1}');
  });

  it('strips leading ``` fence with no language', () => {
    expect(stripCodeFences('```\nsome text\n```')).toBe('some text');
  });

  it('strips leading ```html fence', () => {
    expect(stripCodeFences('```html\n<p>hi</p>\n```')).toBe('<p>hi</p>');
  });

  it('strips leading ```xml fence', () => {
    expect(stripCodeFences('```xml\n<root/>\n```')).toBe('<root/>');
  });

  it('returns unchanged string with no fences', () => {
    expect(stripCodeFences('{"a":1}')).toBe('{"a":1}');
  });

  it('does not strip fences in the middle of the string', () => {
    const s = 'intro\n```json\n{"a":1}\n```';
    expect(stripCodeFences(s)).toBe(s); // no leading fence
  });
});
```

- [ ] **Step 2: Run — expect failure**

```bash
npx vitest run tests/unit/helpers.stringUtils.test.ts
```

Expected: `Error: stripHtmlToText is not exported` (or similar).

- [ ] **Step 3: Add the two functions to `server/helpers.ts`**

Open `server/helpers.ts`. Check the current end of the file (`tail -n 30 server/helpers.ts`). Add after the last existing function:

```typescript
// ── HTML / AI-response string utilities ──────────────────────────────────────

/**
 * Extract readable text from an HTML document.
 * Strips script, style, nav, footer, and optionally header. Collapses whitespace.
 * NOTE: Not safe for untrusted external HTML (use server/sales-audit.ts or
 * server/seo-audit-html.ts patterns for external sites). Use only on internal
 * Webflow-fetched pages.
 */
export function stripHtmlToText(
  html: string,
  opts?: { maxLength?: number; stripHeader?: boolean },
): string {
  const bodyMatch = html.match(/<body[^>]*>([\s\S]*?)<\/body>/i);
  const body = bodyMatch ? bodyMatch[1] : html;
  let cleaned = body
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<nav[\s\S]*?<\/nav>/gi, '')
    .replace(/<footer[\s\S]*?<\/footer>/gi, '');
  if (opts?.stripHeader) {
    cleaned = cleaned.replace(/<header[\s\S]*?<\/header>/gi, '');
  }
  cleaned = cleaned
    .replace(/<[^>]+>/g, ' ')
    .replace(/&[a-z]+;/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return opts?.maxLength ? cleaned.slice(0, opts.maxLength) : cleaned;
}

/**
 * Strip Markdown code fences from AI responses.
 * Handles leading ```json, ```html, ```xml, or plain ``` fences.
 */
export function stripCodeFences(text: string): string {
  return text
    .replace(/^```(?:json|html|xml)?\s*/i, '')
    .replace(/\s*```\s*$/i, '');
}
```

- [ ] **Step 4: Run tests — expect pass**

```bash
npx vitest run tests/unit/helpers.stringUtils.test.ts
```

Expected: All tests PASS.

- [ ] **Step 5: Commit**

```bash
git add server/helpers.ts tests/unit/helpers.stringUtils.test.ts
git commit -m "feat(utils): add stripHtmlToText() and stripCodeFences() to server/helpers.ts"
```

---

### Task 3.2 — Update `server/routes/webflow-seo.ts` (Model: haiku)

**Owns:** `server/routes/webflow-seo.ts`  
**Must not touch:** `server/helpers.ts` (Task 3.1's file).  
**Prerequisite:** Task 3.1 committed.

This file has 7 occurrences of the HTML strip pattern and 14 occurrences of the code fence strip pattern. It is the largest single file in this PR.

- [ ] **Step 1: Check existing imports**

```bash
grep -n '^import' server/routes/webflow-seo.ts | head -20
```

- [ ] **Step 2: Add imports**

Add to the existing import block at the top (do not add mid-file):

```typescript
import { stripHtmlToText, stripCodeFences } from '../helpers.js';
```

- [ ] **Step 3: Replace HTML strip occurrences**

Search for the pattern:

```bash
grep -n 'replace.*<script' server/routes/webflow-seo.ts
```

Each inline chain like:

```typescript
const text = body
  .replace(/<script[\s\S]*?<\/script>/gi, '')
  .replace(/<style[\s\S]*?<\/style>/gi, '')
  // ... etc
  .trim()
  .slice(0, 800);
```

Replace with:

```typescript
const text = stripHtmlToText(html, { maxLength: 800 });
```

Use the `stripHeader: true` option where the original chain also stripped `<header>`. Use the `maxLength` option matching the original `.slice(0, N)` value:
- 7 occurrences with maxLength 800, 8000, or no limit — match exactly.

- [ ] **Step 4: Replace code fence occurrences**

Search:

```bash
grep -n 'replace.*```' server/routes/webflow-seo.ts | head -20
```

Each chain like:

```typescript
.replace(/^```json?\s*/i, '').replace(/```\s*$/, '')
```

Replace with `stripCodeFences(...)`. Example:

```typescript
// BEFORE:
const cleaned = raw.replace(/^```json?\s*/i, '').replace(/```\s*$/, '');

// AFTER:
const cleaned = stripCodeFences(raw);
```

- [ ] **Step 5: Typecheck**

```bash
npm run typecheck 2>&1 | grep 'webflow-seo'
```

Expected: No errors for this file.

- [ ] **Step 6: Commit**

```bash
git add server/routes/webflow-seo.ts
git commit -m "refactor(webflow-seo): replace inline HTML/fence strip patterns with shared helpers"
```

---

### Task 3.3 — Update multi-strip server files (Model: haiku)

**Owns:** `server/internal-links.ts`, `server/aeo-page-review.ts`, `server/routes/keyword-strategy.ts`, `server/routes/jobs.ts`, `server/routes/rewrite-chat.ts`, `server/schema-suggester.ts`  
**Must not touch:** `server/routes/webflow-seo.ts` (Task 3.2), or any fence-only files (Task 3.4).  
**Prerequisite:** Task 3.1 committed. These files need BOTH `stripHtmlToText` AND `stripCodeFences`.

For each file:
1. `grep -n '^import' <file>` — find the imports block.
2. Add `import { stripHtmlToText, stripCodeFences } from '../helpers.js';` (adjust relative path for non-route files: `'./helpers.js'`).
3. `grep -n 'replace.*<script\|replace.*```' <file>` — find all occurrences.
4. Replace HTML chains with `stripHtmlToText(html, opts)`, fence chains with `stripCodeFences(raw)`.

**File-specific notes:**

- `server/routes/rewrite-chat.ts` ~line 47: The spec notes this one only strips tags but doesn't extract `<body>` or replace HTML entities. Read the original code. If the pattern is simpler (just `<[^>]+>` removal), call `stripHtmlToText(html, { stripHeader: true })` which handles all of that — the entity stripping it adds is a harmless improvement.
- `server/schema-suggester.ts` ~line 1066 (`extractPageContent()`): uses `stripHeader: true, maxLength: 4000`.
- `server/routes/keyword-strategy.ts` ~line 450: uses `stripHeader: true, maxLength: SNIPPET_LIMIT` — look up what `SNIPPET_LIMIT` is in this file and preserve it as the `maxLength`.
- `server/routes/jobs.ts` ~line 431: `maxLength: 800`. ~line 754: `maxLength: 8000`.

- [ ] **Step 1: Update each file** (work through them one at a time)

- [ ] **Step 2: Typecheck after all edits**

```bash
npm run typecheck
```

- [ ] **Step 3: Run full tests**

```bash
npx vitest run
```

Expected: All pass.

- [ ] **Step 4: Commit**

```bash
git add server/internal-links.ts server/aeo-page-review.ts \
  server/routes/keyword-strategy.ts server/routes/jobs.ts \
  server/routes/rewrite-chat.ts server/schema-suggester.ts
git commit -m "refactor(server): replace inline HTML/fence strip patterns in 6 files"
```

---

### Task 3.4 — Update fence-only server files (Model: haiku)

**Owns:** `server/copy-generation.ts`, `server/blueprint-generator.ts`, `server/content-brief.ts`, `server/openai-helpers.ts`, `server/routes/public-analytics.ts`, `server/routes/webflow-keywords.ts`  
**Must not touch:** Any file owned by Tasks 3.2 or 3.3.  
**Prerequisite:** Task 3.1 committed.

For each file:
1. Check if it already has a `stripCodeFences` function internally — if `server/openai-helpers.ts` defines its own version, this is the canonical location to check. If it has one, consider making THAT the canonical export instead of duplicating in helpers.ts. But since Task 3.1 already added it to `helpers.ts`, import from there and delete the `openai-helpers.ts` local copy.
2. Add import: `import { stripCodeFences } from '../helpers.js';` (or `'./helpers.js'` for non-route files).
3. Replace `.replace(/^```json?\s*/i, '').replace(/```\s*$/, '')` chains with `stripCodeFences(raw)`.

- [ ] **Step 1: Check `server/openai-helpers.ts` first**

```bash
grep -n 'stripCodeFences\|```' server/openai-helpers.ts
```

If it defines its own stripping logic, delete that local definition.

- [ ] **Step 2: Update each file**

- [ ] **Step 3: Typecheck**

```bash
npm run typecheck
```

- [ ] **Step 4: Commit**

```bash
git add server/copy-generation.ts server/blueprint-generator.ts server/content-brief.ts \
  server/openai-helpers.ts server/routes/public-analytics.ts server/routes/webflow-keywords.ts
git commit -m "refactor(server): replace inline fence-strip patterns with shared stripCodeFences()"
```

---

### Phase 3 PR Gate

- [ ] `npm run typecheck` — zero errors
- [ ] `npx vite build` — succeeds
- [ ] `npx vitest run` — full suite green
- [ ] `npx tsx scripts/pr-check.ts` — zero violations
- [ ] Open PR: `refactor/pr3-string-utils` → `staging`

---

## Phase 4 — PR 4: `resolveBaseUrl` (Item 20)

**Branch:** `refactor/pr4-resolve-base-url` (from `staging`)

**Context:** 22+ occurrences of a 4–8 line pattern across 10 files:

```typescript
let baseUrl = '';
if (ws.liveDomain) {
  baseUrl = ws.liveDomain.startsWith('http') ? ws.liveDomain : `https://${ws.liveDomain}`;
} else if (ws.webflowSiteId) {
  const sub = await getSiteSubdomain(ws.webflowSiteId, tokenOverride);
  if (sub) baseUrl = `https://${sub}.webflow.io`;
}
```

This is replaced by `const baseUrl = await resolveBaseUrl(ws, token);`.

### Task 4.1 — Add `resolveBaseUrl` to `server/helpers.ts` (Model: haiku)

**Owns:** `server/helpers.ts` (modify), `tests/unit/helpers.resolveBaseUrl.test.ts` (NEW)  
**Must not touch:** Any route file.

- [ ] **Step 1: Write the failing test**

Create `tests/unit/helpers.resolveBaseUrl.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock getSiteSubdomain before importing helpers
vi.mock('../../server/webflow-pages.js', () => ({
  getSiteSubdomain: vi.fn(),
}));

import { resolveBaseUrl } from '../../server/helpers';
import { getSiteSubdomain } from '../../server/webflow-pages';

const mockGetSiteSubdomain = vi.mocked(getSiteSubdomain);

describe('resolveBaseUrl', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns liveDomain as-is if it already has https://', async () => {
    const ws = { liveDomain: 'https://example.com' };
    expect(await resolveBaseUrl(ws)).toBe('https://example.com');
  });

  it('prepends https:// to bare liveDomain', async () => {
    const ws = { liveDomain: 'example.com' };
    expect(await resolveBaseUrl(ws)).toBe('https://example.com');
  });

  it('falls back to webflow subdomain when no liveDomain', async () => {
    mockGetSiteSubdomain.mockResolvedValue('mysite');
    const ws = { webflowSiteId: 'site-abc' };
    expect(await resolveBaseUrl(ws)).toBe('https://mysite.webflow.io');
    expect(mockGetSiteSubdomain).toHaveBeenCalledWith('site-abc', undefined);
  });

  it('passes tokenOverride to getSiteSubdomain', async () => {
    mockGetSiteSubdomain.mockResolvedValue('mysite');
    const ws = { webflowSiteId: 'site-abc' };
    await resolveBaseUrl(ws, 'tok-override');
    expect(mockGetSiteSubdomain).toHaveBeenCalledWith('site-abc', 'tok-override');
  });

  it('returns empty string when no liveDomain and getSiteSubdomain returns null', async () => {
    mockGetSiteSubdomain.mockResolvedValue(null);
    const ws = { webflowSiteId: 'site-abc' };
    expect(await resolveBaseUrl(ws)).toBe('');
  });

  it('returns empty string when workspace has neither liveDomain nor webflowSiteId', async () => {
    const ws = {};
    expect(await resolveBaseUrl(ws)).toBe('');
  });
});
```

- [ ] **Step 2: Run — expect failure**

```bash
npx vitest run tests/unit/helpers.resolveBaseUrl.test.ts
```

Expected: `Error: resolveBaseUrl is not exported`

- [ ] **Step 3: Add `resolveBaseUrl` to `server/helpers.ts`**

Add the import at the TOP of helpers.ts (with the other server imports):

```typescript
import { getSiteSubdomain } from './webflow-pages.js';
```

Add the function after `stripCodeFences`:

```typescript
/**
 * Resolve the base URL for a workspace — either its custom live domain or
 * its Webflow staging subdomain. Returns empty string if neither is available.
 * Pass `tokenOverride` when the caller has a workspace-specific Webflow token.
 */
export async function resolveBaseUrl(
  ws: { liveDomain?: string | null; webflowSiteId?: string | null },
  tokenOverride?: string,
): Promise<string> {
  if (ws.liveDomain) {
    return ws.liveDomain.startsWith('http') ? ws.liveDomain : `https://${ws.liveDomain}`;
  }
  if (ws.webflowSiteId) {
    const sub = await getSiteSubdomain(ws.webflowSiteId, tokenOverride);
    if (sub) return `https://${sub}.webflow.io`;
  }
  return '';
}
```

- [ ] **Step 4: Run test — expect pass**

```bash
npx vitest run tests/unit/helpers.resolveBaseUrl.test.ts
```

Expected: All 6 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add server/helpers.ts tests/unit/helpers.resolveBaseUrl.test.ts
git commit -m "feat(utils): add resolveBaseUrl() to server/helpers.ts"
```

---

### Task 4.2 — Update `server/routes/webflow-seo.ts` (7 occurrences) (Model: haiku)

**Owns:** `server/routes/webflow-seo.ts`  
**Must not touch:** Other files.  
**Prerequisite:** Task 4.1 committed.

- [ ] **Step 1: Add import**

```bash
grep -n '^import' server/routes/webflow-seo.ts | grep 'helpers'
```

If `'../helpers.js'` is already imported, add `resolveBaseUrl` to the named imports. Otherwise add:

```typescript
import { resolveBaseUrl } from '../helpers.js';
```

- [ ] **Step 2: Find all 7 occurrences**

```bash
grep -n 'liveDomain.startsWith' server/routes/webflow-seo.ts
```

- [ ] **Step 3: Replace each occurrence**

Each block like:

```typescript
let baseUrl = '';
if (ws.liveDomain) {
  baseUrl = ws.liveDomain.startsWith('http') ? ws.liveDomain : `https://${ws.liveDomain}`;
} else if (ws.webflowSiteId) {
  const sub = await getSiteSubdomain(ws.webflowSiteId, token);
  if (sub) baseUrl = `https://${sub}.webflow.io`;
}
```

Becomes:

```typescript
const baseUrl = await resolveBaseUrl(ws, token);
```

Note: The local variable name in some occurrences may be `baseUrl`, `siteUrl`, or similar — use the same variable name as the original to avoid downstream breakage.

- [ ] **Step 4: Typecheck**

```bash
npm run typecheck 2>&1 | grep 'webflow-seo'
```

- [ ] **Step 5: Commit**

```bash
git add server/routes/webflow-seo.ts
git commit -m "refactor(webflow-seo): replace 7× inline base-URL resolution with resolveBaseUrl()"
```

---

### Task 4.3 — Update `server/schema-suggester.ts` (5 occurrences) (Model: haiku)

**Owns:** `server/schema-suggester.ts`  
**Prerequisite:** Task 4.1 committed.

Same pattern as Task 4.2. Run:

```bash
grep -n 'liveDomain.startsWith' server/schema-suggester.ts
```

Add `resolveBaseUrl` to imports, replace 5 blocks.

- [ ] Typecheck + commit with message: `"refactor(schema-suggester): replace 5× inline base-URL resolution with resolveBaseUrl()"`

---

### Task 4.4 — Update `server/routes/jobs.ts` (4 occurrences) (Model: haiku)

**Owns:** `server/routes/jobs.ts`  
**Prerequisite:** Task 4.1 committed.

Same pattern. 4 blocks.

- [ ] Typecheck + commit: `"refactor(jobs): replace 4× inline base-URL resolution with resolveBaseUrl()"`

---

### Task 4.5 — Update remaining 7 files (1 occurrence each) (Model: haiku)

**Owns:** `server/routes/keyword-strategy.ts`, `server/routes/webflow-cms.ts`, `server/routes/webflow.ts`, `server/routes/workspaces.ts`, `server/redirect-scanner.ts`, `server/outcome-measurement.ts`, `server/routes/aeo-review.ts`

For each: add import, replace the 1 base-URL block, commit per-file or as a batch.

- [ ] **Step 1: Batch replace**

For each file, run:
```bash
grep -n 'liveDomain.startsWith' server/routes/keyword-strategy.ts \
  server/routes/webflow-cms.ts server/routes/webflow.ts \
  server/routes/workspaces.ts server/redirect-scanner.ts \
  server/outcome-measurement.ts server/routes/aeo-review.ts
```

- [ ] **Step 2: Add import and replace in each file**

- [ ] **Step 3: Typecheck**

```bash
npm run typecheck
```

- [ ] **Step 4: Full test suite**

```bash
npx vitest run
```

- [ ] **Step 5: Commit all**

```bash
git add server/routes/keyword-strategy.ts server/routes/webflow-cms.ts \
  server/routes/webflow.ts server/routes/workspaces.ts \
  server/redirect-scanner.ts server/outcome-measurement.ts server/routes/aeo-review.ts
git commit -m "refactor(server): replace 7× inline base-URL resolution with resolveBaseUrl()"
```

---

### Phase 4 PR Gate

- [ ] `npm run typecheck` — zero errors
- [ ] `npx vite build` — succeeds
- [ ] `npx vitest run` — full suite green
- [ ] `npx tsx scripts/pr-check.ts` — zero violations
- [ ] Open PR: `refactor/pr4-resolve-base-url` → `staging`

---

## Phase 5 — PR 5: `enforceLimit` + `computePageScore` (Items 6 + 7)

**Branch:** `refactor/pr5-scoring-enforce` (from `staging`)

### Task 5.1 — Consolidate `enforceLimit` inside `webflow-seo.ts` (Model: haiku)

**Owns:** `server/routes/webflow-seo.ts` ONLY (internal refactor — function is not exported).  
**Must not touch:** Any other file.

The function currently has 4 definitions within this single file. The task is to keep one at the top and delete the other 3.

- [ ] **Step 1: Find all definitions**

```bash
grep -n 'enforceLimit\|function enforceLimit\|const enforceLimit' server/routes/webflow-seo.ts
```

Record all line numbers.

- [ ] **Step 2: Verify the "strict" version is the one at ~line 317**

Read lines 315–335 to confirm it's the one with `lastSpace`, `lastPeriod`, `lastExclamation` logic. This is the version to keep.

- [ ] **Step 3: Move the strict definition to right after the imports**

Cut the function from ~line 317, paste it after the last `import` statement at the top of the file.

- [ ] **Step 4: Delete the other 3 definitions**

Delete the simpler definitions at ~line 773, ~line 1259, and ~line 1596. Replace any direct usage of the inline ternary at ~line 1259 with a call to `enforceLimit(...)`.

- [ ] **Step 5: Verify all call sites use the consolidated function**

```bash
grep -n 'enforceLimit' server/routes/webflow-seo.ts
```

All occurrences should be CALLS, not definitions.

- [ ] **Step 6: Typecheck**

```bash
npm run typecheck 2>&1 | grep 'webflow-seo'
```

- [ ] **Step 7: Commit**

```bash
git add server/routes/webflow-seo.ts
git commit -m "refactor(webflow-seo): consolidate 4 enforceLimit definitions to 1"
```

---

### Task 5.2 — Extract `computePageScore` to `shared/scoring.ts` + update callers (Model: sonnet)

**Owns:** `shared/scoring.ts` (NEW), `server/helpers.ts` (modify), `server/audit-page.ts` (modify), `src/components/SeoAudit.tsx` (modify), `tests/unit/scoring.test.ts` (NEW)  
**Must not touch:** `server/routes/webflow-seo.ts` (Task 5.1).

**Why sonnet:** This task requires reconciling a naming inconsistency (`CRITICAL_CHECKS` in `audit-page.ts` vs `CRITICAL_CHECKS_SET` in `helpers.ts`), verifying the Sets have the same members, and placing isomorphic constants correctly so both server and browser can import them.

**Context:**
- `server/audit-page.ts:68-76` defines `CRITICAL_CHECKS` (a Set) and `MODERATE_CHECKS` (a Set)
- `server/helpers.ts` exports `CRITICAL_CHECKS_SET` and `MODERATE_CHECKS_SET` — verify these are the same values as in `audit-page.ts`
- `src/components/SeoAudit.tsx:602-612` has the same scoring loop

- [ ] **Step 1: Verify the Sets have the same members**

```bash
grep -A 20 'CRITICAL_CHECKS' server/audit-page.ts | head -25
grep -A 20 'CRITICAL_CHECKS_SET' server/helpers.ts | head -25
```

If they differ, record the difference. The `audit-page.ts` version is source-of-truth for which checks exist. The `helpers.ts` version is used by `applySuppressionsToAudit`. Resolve by moving the canonical definition to `shared/scoring.ts` and importing in both.

- [ ] **Step 2: Write failing tests**

Create `tests/unit/scoring.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { computePageScore, CRITICAL_CHECKS, MODERATE_CHECKS } from '../../shared/scoring';

describe('computePageScore', () => {
  it('returns 100 with no issues', () => {
    expect(computePageScore([])).toBe(100);
  });

  it('deducts 15 for a critical error', () => {
    const issues = [{ check: 'title', severity: 'error' }];
    expect(computePageScore(issues)).toBe(85);
  });

  it('deducts 10 for a non-critical error', () => {
    // 'img-alt' is not in CRITICAL_CHECKS
    const issues = [{ check: 'img-alt', severity: 'error' }];
    expect(computePageScore(issues)).toBe(90);
  });

  it('deducts 5 for a critical warning', () => {
    const issues = [{ check: 'title', severity: 'warning' }];
    expect(computePageScore(issues)).toBe(95);
  });

  it('deducts 3 for a moderate warning', () => {
    // 'content-length' is in MODERATE_CHECKS
    const issues = [{ check: 'content-length', severity: 'warning' }];
    expect(computePageScore(issues)).toBe(97);
  });

  it('deducts 2 for a minor warning', () => {
    // Some check that is neither critical nor moderate
    const issues = [{ check: 'some-minor-check', severity: 'warning' }];
    expect(computePageScore(issues)).toBe(98);
  });

  it('info severity has no score impact', () => {
    const issues = [{ check: 'title', severity: 'info' }];
    expect(computePageScore(issues)).toBe(100);
  });

  it('clamps to 0 on many errors', () => {
    const issues = Array.from({ length: 20 }, () => ({ check: 'title', severity: 'error' }));
    expect(computePageScore(issues)).toBe(0);
  });

  it('exports CRITICAL_CHECKS as a Set containing "title"', () => {
    expect(CRITICAL_CHECKS).toBeInstanceOf(Set);
    expect(CRITICAL_CHECKS.has('title')).toBe(true);
  });

  it('exports MODERATE_CHECKS as a Set containing "content-length"', () => {
    expect(MODERATE_CHECKS).toBeInstanceOf(Set);
    expect(MODERATE_CHECKS.has('content-length')).toBe(true);
  });
});
```

- [ ] **Step 3: Run — expect failure**

```bash
npx vitest run tests/unit/scoring.test.ts
```

Expected: `Error: Cannot find module '../../shared/scoring'`

- [ ] **Step 4: Create `shared/scoring.ts`**

Read `server/audit-page.ts` lines 68-76 for the exact Set members. Then create `shared/scoring.ts`:

```typescript
/**
 * Shared scoring constants and logic for SEO audit page scores.
 * Imported by both server (audit-page.ts, helpers.ts) and client (SeoAudit.tsx).
 * These constants are the single source of truth — do not duplicate in other files.
 */

export const CRITICAL_CHECKS = new Set([
  // Copy the exact array from server/audit-page.ts CRITICAL_CHECKS
  'title',
  'meta-description',
  'canonical',
  'h1',
  'robots',
  'duplicate-title',
  'mixed-content',
  'ssl',
  'robots-txt',
]);

export const MODERATE_CHECKS = new Set([
  // Copy the exact array from server/audit-page.ts MODERATE_CHECKS
  'content-length',
  'heading-hierarchy',
  'internal-links',
  'img-alt',
  'og-tags',
  'og-image',
  'link-text',
  'url',
  'lang',
  'viewport',
  'duplicate-description',
  'img-filesize',
  'html-size',
]);

/**
 * Compute a 0–100 SEO page score from an array of audit issues.
 * Weights: critical error −15, other error −10, critical warning −5,
 * moderate warning −3, other warning −2, info 0.
 */
export function computePageScore(
  issues: ReadonlyArray<{ check: string; severity: string }>,
): number {
  let score = 100;
  for (const issue of issues) {
    const isCritical = CRITICAL_CHECKS.has(issue.check);
    const isModerate = MODERATE_CHECKS.has(issue.check);
    if (issue.severity === 'error') {
      score -= isCritical ? 15 : 10;
    } else if (issue.severity === 'warning') {
      score -= isCritical ? 5 : isModerate ? 3 : 2;
    }
  }
  return Math.max(0, Math.min(100, score));
}
```

> **IMPORTANT:** Copy the actual Set members from `server/audit-page.ts`, not from the template above. The template lists the expected values but the file is authoritative.

- [ ] **Step 5: Run tests — expect pass**

```bash
npx vitest run tests/unit/scoring.test.ts
```

Expected: All tests PASS.

- [ ] **Step 6: Update `server/helpers.ts`**

Find `CRITICAL_CHECKS_SET` and `MODERATE_CHECKS_SET` in `server/helpers.ts`. Replace those local definitions with imports from `shared/scoring.ts`:

```typescript
import { CRITICAL_CHECKS as CRITICAL_CHECKS_SET, MODERATE_CHECKS as MODERATE_CHECKS_SET, computePageScore } from '../shared/scoring.js';
```

> **Re-export** with the old names if anything in the server imports them from helpers.ts:
> ```typescript
> export { CRITICAL_CHECKS_SET, MODERATE_CHECKS_SET };
> ```

Update `applySuppressionsToAudit()` in helpers.ts to call `computePageScore(filteredIssues)` instead of the inline scoring loop. The function signature already exists — replace its loop body.

- [ ] **Step 7: Update `server/audit-page.ts`**

Replace the local `CRITICAL_CHECKS` and `MODERATE_CHECKS` Set definitions and the inline scoring loop with imports:

```typescript
import { CRITICAL_CHECKS, MODERATE_CHECKS, computePageScore } from '../shared/scoring.js';
```

Replace the scoring loop (around line 482-493):

```typescript
// BEFORE:
let score = 100;
for (const issue of issues) {
  const isCritical = CRITICAL_CHECKS.has(issue.check);
  ...
}
score = Math.max(0, Math.min(100, score));

// AFTER:
const score = computePageScore(issues);
```

- [ ] **Step 8: Update `src/components/SeoAudit.tsx`**

Replace the local Set definitions and inline scoring loop (around line 602) with:

```typescript
import { computePageScore, CRITICAL_CHECKS, MODERATE_CHECKS } from '../../shared/scoring';
```

Replace the loop body with `const score = computePageScore(filtered);`.

Note: If `SeoAudit.tsx` was already importing `CRITICAL_CHECKS` and `MODERATE_CHECKS` from `server/helpers.ts` (which it can't — server imports don't work in browser), it must have been importing from somewhere else. Check:

```bash
grep -n 'CRITICAL_CHECKS\|MODERATE_CHECKS' src/components/SeoAudit.tsx
```

Update the import source to `shared/scoring`.

- [ ] **Step 9: Full typecheck**

```bash
npm run typecheck
```

Expected: Zero errors.

- [ ] **Step 10: Full test suite**

```bash
npx vitest run
```

Expected: All pass.

- [ ] **Step 11: Commit**

```bash
git add shared/scoring.ts tests/unit/scoring.test.ts \
  server/helpers.ts server/audit-page.ts src/components/SeoAudit.tsx
git commit -m "refactor(scoring): extract computePageScore to shared/scoring.ts; remove 3 duplicate scoring loops"
```

---

### Phase 5 PR Gate

- [ ] `npm run typecheck` — zero errors
- [ ] `npx vite build` — succeeds
- [ ] `npx vitest run` — full suite green
- [ ] `npx tsx scripts/pr-check.ts` — zero violations
- [ ] Open PR: `refactor/pr5-scoring-enforce` → `staging`

---

## Task Dependencies (Summary)

```
Phase 1 (PR 1)
  Task 1.1 (timeAgo.ts)          ∥  Task 1.2 (normalizePageUrl in helpers)
  Task 1.3 (update 7 components) → depends on 1.1
  Task 1.4 (update server files) → depends on 1.2

Phase 2 (PR 2)
  Task 2.1 (seo-audit.ts) — FIRST
  Task 2.2 (schema-suggester) ∥ Task 2.3 (pagespeed+redirect+link) → depend on 2.1

Phase 3 (PR 3)
  Task 3.1 (add to helpers.ts) — FIRST
  Task 3.2 (webflow-seo.ts) ∥ Task 3.3 (multi-strip files) ∥ Task 3.4 (fence-only) → depend on 3.1

Phase 4 (PR 4)
  Task 4.1 (resolveBaseUrl in helpers) — FIRST
  Task 4.2 (webflow-seo.ts) ∥ Task 4.3 (schema-suggester) ∥ Task 4.4 (jobs) ∥ Task 4.5 (7 files) → depend on 4.1

Phase 5 (PR 5)
  Task 5.1 (enforceLimit — webflow-seo internal) ∥ Task 5.2 (computePageScore — shared/scoring)

Inter-phase dependencies:
  All phases are mergeable independently (staging → main after each).
  Recommended order: 1, 2, 3, 4, 5.
  PR 4's resolveBaseUrl imports getSiteSubdomain from webflow-pages.ts (already exported — no dep on PR 2).
```

---

## Model Assignments

| Task | Model | Reason |
|------|-------|--------|
| 1.1 Create timeAgo.ts | haiku | Pure transcription from spec |
| 1.2 normalizePageUrl | haiku | Pure transcription |
| 1.3 Update 7 components | haiku | Mechanical find-and-replace |
| 1.4 Update 2 server files | haiku | Mechanical, with behavioral-risk check |
| 2.1–2.4 Webflow API cleanup | haiku | Mechanical import swapping |
| 3.1 Add to helpers.ts | haiku | Pure transcription |
| 3.2–3.4 Replace patterns | haiku | Mechanical find-and-replace |
| 4.1 resolveBaseUrl | haiku | Pure transcription |
| 4.2–4.5 Replace base-URL blocks | haiku | Mechanical |
| 5.1 enforceLimit consolidation | haiku | Internal rearrangement only |
| 5.2 computePageScore shared | **sonnet** | Set reconciliation, isomorphic placement, behavioral verification |

---

## Systemic Improvements

### pr-check rules to add (after all PRs land)

Consider adding a pr-check rule to prevent re-introducing duplicates:
- Flag any file outside `server/helpers.ts` that defines a function named `stripHtmlToText`, `stripCodeFences`, `resolveBaseUrl`, or `normalizePageUrl`.
- Flag any file in `server/routes/` that defines `WEBFLOW_API =` as a local constant.

### New tests added by this plan

| Test file | What it covers |
|-----------|---------------|
| `tests/unit/lib/timeAgo.test.ts` | All 7 branches of `timeAgo()` |
| `tests/unit/helpers.normalizePageUrl.test.ts` | Full URL, path, root, malformed, query strip |
| `tests/unit/helpers.stringUtils.test.ts` | `stripHtmlToText` (7 cases) + `stripCodeFences` (5 cases) |
| `tests/unit/helpers.resolveBaseUrl.test.ts` | All 6 branches including token override |
| `tests/unit/scoring.test.ts` | All 10 scoring cases + Set membership |

---

## Verification Strategy

After each PR merges to `staging`:

```bash
# Full quality gate (run from repo root)
npm run typecheck && npx vite build && npx vitest run && npx tsx scripts/pr-check.ts
```

For PR 5 specifically (behavioral verification — scoring must be unchanged):
```bash
# Spot-check that an audit page returns the same score before and after
# If you have a test workspace: compare score in the UI before merging PR 5 to staging
npx vitest run tests/unit/scoring.test.ts -t "deducts 15 for a critical error"
```

---

## Known Risks and Mitigations

| Risk | File | Mitigation |
|------|------|-----------|
| `analytics-intelligence.ts` `normalizePageUrl` currently returns FULL URL (including origin), shared version returns PATH only — behavioral change | `server/analytics-intelligence.ts` | Task 1.4 Step 1: read all call sites and confirm path-only is safe before replacing |
| `CRITICAL_CHECKS` vs `CRITICAL_CHECKS_SET` naming mismatch between `audit-page.ts` and `helpers.ts` — Sets may have diverged | Both | Task 5.2 Step 1: diff the two Sets before creating `shared/scoring.ts` |
| `resolveBaseUrl` function parameter may not match all callers if some pass `siteId` directly rather than `ws.webflowSiteId` | All Phase 4 files | Each Task 4.x step includes grep verification before mechanical replacement |
| `rewrite-chat.ts` HTML stripping is simpler than `stripHtmlToText` — calling the full function adds entity stripping | `server/routes/rewrite-chat.ts` | This is a harmless improvement — the caller receives cleaner text. Note in commit message. |
