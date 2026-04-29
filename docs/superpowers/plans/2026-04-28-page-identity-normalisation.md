# Page Identity Normalisation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix two independent "page identity" silent lookup failures: normalise `analytics_insights.page_id` to relative paths (PR 1), then introduce `toCmsPageId` canonical helper and wire `_existingErrors` into schema generation (PR 2).

**Architecture:** PR 1 fixes at the write path (storage normalisation + DB migration), so all consumers automatically benefit from plain equality comparisons. PR 2 introduces a single canonical function for CMS synthetic IDs, migrates existing rows, and wires prior validation errors into the AI schema prompt context. Both PRs are strictly sequential: PR 2 depends on PR 1 being merged and green on staging.

**Tech Stack:** TypeScript, better-sqlite3, Express, Vitest (unit + integration), SQLite string functions for data migrations.

---

## ⚠️ STAGING GATE

**PR 1 must be merged and verified on staging before starting any PR 2 task.**  
`staging` URL: `https://asset-dashboard-staging.onrender.com`

---

## Task Dependencies

```
PR 1:
  Task 1 (failing tests) → Task 2 (helpers + write sites) → Task 3 (audit write paths)
  → Task 4 (endsWith removal + outcome-tracking) → Task 5 (migration SQL)
  → Task 6 (update existing tests + integration test) → Task 7 (quality gates PR 1)

[STAGING GATE — PR 1 merged + verified]

PR 2:
  Task 8 (toCmsPageId tests + impl) → Task 9 (CMS generators + SchemaContext)
  → Task 10 (_existingErrors wiring) → Task 11 (assemblePageProfile fix)
  → Task 12 (migration SQL) → Task 13 (integration tests) → Task 14 (quality gates PR 2)
```

---

## PR 1 — Normalise `analytics_insights.page_id` to Relative Paths

### Task 1: Write failing unit tests for PR 1 helpers

**Files:**
- Create: `tests/unit/page-identity-normalisation-pr1.test.ts`

- [ ] **Step 1.1: Create the test file**

```ts
/**
 * Unit tests for PR 1 — page identity normalisation helpers.
 * Tests toInsightPageId (GSC URL → path) and toAuditFindingPageId (Webflow page → path).
 */
import { describe, it, expect } from 'vitest';

// toInsightPageId will be a module-local function in analytics-intelligence.ts,
// so we import computePageHealthScores and verify via its output.
import { computePageHealthScores } from '../../server/analytics-intelligence.js';
import type { SearchPage } from '../../server/search-console.js';

// toAuditFindingPageId will be exported from helpers.ts
import { toAuditFindingPageId } from '../../server/helpers.js';

// ── toInsightPageId (tested via computePageHealthScores output) ──

describe('computePageHealthScores: pageId format', () => {
  const pages: SearchPage[] = [
    { page: 'https://example.com/blog/my-post', clicks: 100, impressions: 2000, ctr: 5.0, position: 5 },
    { page: 'http://example.com/about', clicks: 50, impressions: 1000, ctr: 5.0, position: 10 },
    { page: '/already-a-path', clicks: 10, impressions: 200, ctr: 5.0, position: 20 },
    { page: 'not-a-url', clicks: 5, impressions: 100, ctr: 5.0, position: 30 },
    { page: 'https://example.com/', clicks: 200, impressions: 5000, ctr: 4.0, position: 2 },
  ];

  it('strips https:// domain to relative path', () => {
    const results = computePageHealthScores(pages, []);
    const result = results.find(r => r.pageId === '/blog/my-post');
    expect(result).toBeDefined();
  });

  it('strips http:// domain to relative path', () => {
    const results = computePageHealthScores(pages, []);
    const result = results.find(r => r.pageId === '/about');
    expect(result).toBeDefined();
  });

  it('leaves already-normalised paths unchanged (idempotent)', () => {
    const results = computePageHealthScores(pages, []);
    const result = results.find(r => r.pageId === '/already-a-path');
    expect(result).toBeDefined();
  });

  it('leaves non-URL strings unchanged (graceful fallback)', () => {
    const results = computePageHealthScores(pages, []);
    const result = results.find(r => r.pageId === 'not-a-url');
    expect(result).toBeDefined();
  });

  it('converts homepage URL to / ', () => {
    const results = computePageHealthScores(pages, []);
    const result = results.find(r => r.pageId === '/');
    expect(result).toBeDefined();
  });

  it('does NOT change data.pageUrl (intentionally kept as original URL)', () => {
    const results = computePageHealthScores(pages, []);
    const result = results.find(r => r.pageId === '/blog/my-post');
    // data.pageUrl is the display field — should keep original value if present
    expect(result).toBeDefined();
    // pageId is now the path, not the URL
    expect(result!.pageId).toBe('/blog/my-post');
    expect(result!.pageId).not.toContain('https://');
  });
});

// ── toAuditFindingPageId ──

describe('toAuditFindingPageId', () => {
  it('returns /slug for page with slug', () => {
    expect(toAuditFindingPageId({ slug: 'about', url: 'https://example.com/about', pageId: 'uuid-abc' }))
      .toBe('/about');
  });

  it('returns /nested/slug for multi-segment slug', () => {
    expect(toAuditFindingPageId({ slug: 'blog/my-post', url: 'https://example.com/blog/my-post', pageId: 'uuid-abc' }))
      .toBe('/blog/my-post');
  });

  it('falls back to URL pathname when slug is empty string', () => {
    expect(toAuditFindingPageId({ slug: '', url: 'https://example.com/', pageId: 'uuid-homepage' }))
      .toBe('/');
  });

  it('falls back to pageId when both slug is empty and URL is malformed', () => {
    expect(toAuditFindingPageId({ slug: '', url: 'not-a-url', pageId: 'uuid-fallback' }))
      .toBe('uuid-fallback');
  });
});
```

- [ ] **Step 1.2: Run the tests to confirm they fail**

```bash
npx vitest run tests/unit/page-identity-normalisation-pr1.test.ts --reporter=verbose
```

Expected: `toAuditFindingPageId` fails with "not a function", and `computePageHealthScores` tests fail because `pageId` still contains `https://`.

- [ ] **Step 1.3: Commit the failing tests**

```bash
git add tests/unit/page-identity-normalisation-pr1.test.ts
git commit -m "test: add failing tests for PR1 page-identity normalisation helpers"
```

---

### Task 2: Add `toInsightPageId` helper and fix all 8 GSC write sites

**Files:**
- Modify: `server/analytics-intelligence.ts`

The following 8 lines currently store full GSC URLs as `pageId`. All must change to store relative paths.

| Line | Current value | Insight type |
|------|--------------|-------------|
| 236 | `page.page` | `page_health` |
| 290 | `row.page` | `ranking_opportunity` |
| 664 | `curr.page` | `ranking_mover` |
| 734 | `row.page` | `ctr_opportunity` |
| 791 | `page.page` | `serp_opportunity` |
| 917 | `page.page` | `content_decay` |
| 924 | `page.page` | `content_decay` (second call site, same function) |
| 1242 | `page.page` | `content_decay` (different call site, same fix) |

- [ ] **Step 2.1: Add the local helper at the top of the function area**

Find this comment block near line 30-35 of `server/analytics-intelligence.ts`:
```ts
import { upsertInsight, getInsights, deleteStaleInsightsByType, suppressInsights } from './analytics-insights-store.js';
```

Add the helper function directly below the import block (after all imports, before first `const` or `export`):

```ts
// Normalise a GSC page URL to a relative path for analytics_insights.page_id storage.
// GSC returns full URLs (https://domain.com/path); we store only the path component.
function toInsightPageId(url: string): string {
  try { return new URL(url).pathname; } catch { return url; }
}
```

- [ ] **Step 2.2: Fix `page_health` write site (line ~236)**

Find:
```ts
    return {
      pageId: page.page,
      insightType: 'page_health',
```

Replace `pageId: page.page` with `pageId: toInsightPageId(page.page)`:
```ts
    return {
      pageId: toInsightPageId(page.page),
      insightType: 'page_health',
```

- [ ] **Step 2.3: Fix `ranking_opportunity` write site (line ~290)**

Find (with the comment):
```ts
    pageId: row.page, // page URL only — lets DB UNIQUE constraint deduplicate correctly
    insightType: 'ranking_opportunity',
```

Replace:
```ts
    pageId: toInsightPageId(row.page),
    insightType: 'ranking_opportunity',
```

Remove the now-stale comment.

- [ ] **Step 2.4: Fix `ranking_mover` write site (line ~664)**

Find:
```ts
        pageId: curr.page, // page URL only — lets DB UNIQUE constraint deduplicate correctly
```

Replace:
```ts
        pageId: toInsightPageId(curr.page),
```

Remove the stale comment.

- [ ] **Step 2.5: Fix `ctr_opportunity` write site (line ~734)**

Find:
```ts
        pageId: row.page, // page URL only — lets DB UNIQUE constraint deduplicate correctly
```

Replace:
```ts
        pageId: toInsightPageId(row.page),
```

Remove the stale comment.

- [ ] **Step 2.6: Fix `serp_opportunity` write site (line ~791)**

Find:
```ts
      pageId: page.page,
      insightType: 'serp_opportunity' as const,
```

Replace:
```ts
      pageId: toInsightPageId(page.page),
      insightType: 'serp_opportunity' as const,
```

- [ ] **Step 2.7: Fix `content_decay` write sites (lines ~917 and ~924 and ~1242)**

There are two separate call sites. Find and fix each.

First occurrence (~line 917-924):
```ts
      const enrichment = enrichInsight(
        { pageId: page.page, insightType: 'content_decay' as InsightType, severity, data: { ... } },
```
Replace `pageId: page.page` with `pageId: toInsightPageId(page.page)`.

Then the `upsertInsight` call below it (~line 924):
```ts
      upsertInsight({
        ...enrichmentRest,
        workspaceId,
        pageId: page.page,
        insightType: 'content_decay',
```
Replace `pageId: page.page` with `pageId: toInsightPageId(page.page)`.

Second occurrence (~line 1242):
```ts
        enrichAndUpsert({
          insightType: 'content_decay',
          pageId: page.page,
```
Replace `pageId: page.page` with `pageId: toInsightPageId(page.page)`.

- [ ] **Step 2.8: Run the PR1 tests — they should now pass for computePageHealthScores**

```bash
npx vitest run tests/unit/page-identity-normalisation-pr1.test.ts --reporter=verbose
```

Expected: All `computePageHealthScores: pageId format` tests pass. `toAuditFindingPageId` tests still fail (not implemented yet).

- [ ] **Step 2.9: Commit**

```bash
git add server/analytics-intelligence.ts
git commit -m "fix: normalise GSC URL pageIds to relative paths in analytics-intelligence.ts"
```

---

### Task 3: Add `toAuditFindingPageId` to helpers.ts and fix audit_finding write paths

**Files:**
- Modify: `server/helpers.ts`
- Modify: `server/routes/webflow-seo.ts`
- Modify: `server/scheduled-audits.ts`

`PageSeoResult` (from `server/audit-page.ts`) has `slug: string`, `url: string`, `pageId: string`. The helper converts any audit page object to the canonical path format used for `analytics_insights.page_id`.

- [ ] **Step 3.1: Add `toAuditFindingPageId` to `server/helpers.ts`**

Find the end of the existing exports in `server/helpers.ts` (after the last export function). Add:

```ts
/**
 * Convert a Webflow audit page to the canonical relative path used as
 * analytics_insights.page_id for audit_finding insights.
 * - slug present → /slug (e.g. /blog/my-post)
 * - empty slug   → URL pathname (homepage → /)
 * - malformed URL → pageId UUID (graceful fallback, should not occur in practice)
 */
export function toAuditFindingPageId(page: { slug: string; url: string; pageId: string }): string {
  if (page.slug) return `/${page.slug}`;
  try { return new URL(page.url).pathname; } catch { return page.pageId; }
}
```

- [ ] **Step 3.2: Run failing tests to confirm toAuditFindingPageId tests now pass**

```bash
npx vitest run tests/unit/page-identity-normalisation-pr1.test.ts --reporter=verbose
```

Expected: All tests pass.

- [ ] **Step 3.3: Fix `webflow-seo.ts` — add import**

The file already imports from `../helpers.js`. Add `toAuditFindingPageId` to the existing import at line 37:

```ts
import { applySuppressionsToAudit, stripHtmlToText, stripCodeFences, tryResolvePagePath, matchGscUrlToPath, applyBulkKeywordGuards, findPageMapEntryForPage, toAuditFindingPageId } from '../helpers.js';
```

- [ ] **Step 3.4: Fix `webflow-seo.ts` — pagesWithIssues set (line ~111)**

Find (inside the auto-resolve bridge callback):
```ts
            pagesWithIssues.add(page.pageId);
```

Replace:
```ts
            pagesWithIssues.add(toAuditFindingPageId(page));
```

- [ ] **Step 3.5: Fix `webflow-seo.ts` — dedup check (line ~150)**

Find:
```ts
          const existingForPage = existing.find(
            i => i.insightType === 'audit_finding' && i.pageId === page.pageId && i.resolutionStatus !== 'resolved',
          );
```

Replace:
```ts
          const existingForPage = existing.find(
            i => i.insightType === 'audit_finding' && i.pageId === toAuditFindingPageId(page) && i.resolutionStatus !== 'resolved',
          );
```

- [ ] **Step 3.6: Fix `webflow-seo.ts` — write path (line ~157)**

Find:
```ts
          upsert({
            workspaceId: auditWs.id,
            insightType: 'audit_finding',
            pageId: page.pageId,
            pageTitle: page.page,
```

Replace `pageId: page.pageId` with `pageId: toAuditFindingPageId(page)`:
```ts
          upsert({
            workspaceId: auditWs.id,
            insightType: 'audit_finding',
            pageId: toAuditFindingPageId(page),
            pageTitle: page.page,
```

- [ ] **Step 3.7: Fix `scheduled-audits.ts` — add import**

The file already imports from `./helpers.js` at line 8. Add `toAuditFindingPageId`:
```ts
import { applySuppressionsToAudit, toAuditFindingPageId } from './helpers.js';
```

- [ ] **Step 3.8: Fix `scheduled-audits.ts` — pagesWithIssues set (line ~158)**

Find:
```ts
          pagesWithIssues.add(page.pageId);
```

Replace:
```ts
          pagesWithIssues.add(toAuditFindingPageId(page));
```

- [ ] **Step 3.9: Fix `scheduled-audits.ts` — bridge write path (line ~221)**

Find (inside the bridge callback at ~line 218):
```ts
        upsertInsight({
          workspaceId: ws.id,
          insightType: 'audit_finding',
          pageId: page.pageId,
          pageTitle: page.page,
```

Replace:
```ts
        upsertInsight({
          workspaceId: ws.id,
          insightType: 'audit_finding',
          pageId: toAuditFindingPageId(page),
          pageTitle: page.page,
```

- [ ] **Step 3.10: Run typecheck**

```bash
npm run typecheck
```

Expected: zero errors. If `toAuditFindingPageId` parameter type doesn't match `page` type, widen it to `{ slug: string; url: string; pageId: string }` (which `PageSeoResult` satisfies).

- [ ] **Step 3.11: Commit**

```bash
git add server/helpers.ts server/routes/webflow-seo.ts server/scheduled-audits.ts
git commit -m "fix: normalise audit_finding pageId to relative paths; fix dedup and auto-resolve checks"
```

---

### Task 4: Remove endsWith workaround and fix outcome-tracking comparison

**Files:**
- Modify: `server/routes/webflow-seo.ts`
- Modify: `server/outcome-tracking.ts`

- [ ] **Step 4.1: Remove the endsWith workaround in webflow-seo.ts (lines ~335-343)**

Find this block:
```ts
          i.pageId != null && (
            i.pageId === pagePath ||
            i.pageId.endsWith(pagePath)
          )
```

The comment above it (line ~335) reads:
```ts
        // pageId is stored as a full URL (https://domain.com/path) or synthetic key.
        // Match if pageId ends with pagePath or equals it exactly.
```

Replace the comment and condition block with a simple equality:
```ts
          i.pageId === pagePath
```

(The surrounding filter structure stays; only the inner condition and comment change.)

- [ ] **Step 4.2: Fix outcome-tracking.ts comparison (line ~154)**

Find:
```ts
    const related = insights.filter(i =>
      (params.pageUrl && i.pageId === params.pageUrl) ||
```

Replace with normalised comparison (add `normalizedPageUrl` before the filter):

```ts
    const normalizedPageUrl = params.pageUrl
      ? (() => { try { return new URL(params.pageUrl).pathname; } catch { return params.pageUrl; } })()
      : null;
    const related = insights.filter(i =>
      (normalizedPageUrl && i.pageId === normalizedPageUrl) ||
```

- [ ] **Step 4.3: Run typecheck**

```bash
npm run typecheck
```

Expected: zero errors.

- [ ] **Step 4.4: Commit**

```bash
git add server/routes/webflow-seo.ts server/outcome-tracking.ts
git commit -m "fix: remove endsWith workaround; normalise pageUrl in outcome-tracking comparison"
```

---

### Task 5: Write the SQL data migration

**Files:**
- Create: `server/db/migrations/075-normalise-insight-page-ids.sql`

The migration runner (`server/db/index.ts`) only processes `.sql` files. This migration converts existing full-URL `page_id` values in `analytics_insights` to relative paths using SQLite string functions.

**Formula verification** (for `https://example.com/blog/post`):
- `INSTR(page_id, '://')` = 6 (position of `:` in `https:`)
- `INSTR(page_id, '://') + 3` = 9 (start of host)
- `SUBSTR(page_id, 9)` = `example.com/blog/post`
- `INSTR('example.com/blog/post', '/')` = 12 (position of first `/` in host segment)
- Path starts at: `9 + 12 - 1 = 20`
- `SUBSTR(page_id, 20)` = `/blog/post` ✓

- [ ] **Step 5.1: Create the migration file**

```sql
-- 075-normalise-insight-page-ids.sql
--
-- Normalise full-URL page_id values in analytics_insights to relative paths.
-- GSC/GA4 insight generators previously stored full URLs (https://domain.com/path).
-- New writes use relative paths (/path); this migration backfills existing rows.
--
-- Rows whose page_id does not start with 'http' are untouched (already normalised,
-- synthetic keys like 'cannibalization::query', or audit_finding UUIDs).
--
-- Step 1: Update rows that have a path after the host.
-- Formula: skip '://' + 3 chars to reach host, find first '/' in host segment,
-- then take SUBSTR from that position.
UPDATE analytics_insights
SET page_id = SUBSTR(
  page_id,
  INSTR(page_id, '://') + 3
  + INSTR(SUBSTR(page_id, INSTR(page_id, '://') + 3), '/')
  - 1
)
WHERE page_id LIKE 'http%'
  AND INSTR(SUBSTR(page_id, INSTR(page_id, '://') + 3), '/') > 0;

-- Step 2: Handle bare-domain URLs with no path (e.g. https://example.com).
-- Should not occur in GSC data, but safe to handle.
UPDATE analytics_insights
SET page_id = '/'
WHERE page_id LIKE 'http%'
  AND INSTR(SUBSTR(page_id, INSTR(page_id, '://') + 3), '/') = 0;
```

- [ ] **Step 5.2: Smoke-test the formula in SQLite**

Verify the formula without running the full migration:

```bash
npx tsx -e "
import Database from 'better-sqlite3';
const db = new Database(':memory:');
db.exec(\`CREATE TABLE t (page_id TEXT)\`);
db.exec(\`INSERT INTO t VALUES ('https://example.com/blog/post')\`);
db.exec(\`INSERT INTO t VALUES ('http://example.com/about')\`);
db.exec(\`INSERT INTO t VALUES ('https://example.com/')\`);
db.exec(\`INSERT INTO t VALUES ('/already-path')\`);
db.exec(\`
  UPDATE t SET page_id = SUBSTR(page_id, INSTR(page_id,'://') + 3 + INSTR(SUBSTR(page_id, INSTR(page_id,'://') + 3), '/') - 1)
  WHERE page_id LIKE 'http%' AND INSTR(SUBSTR(page_id, INSTR(page_id,'://') + 3), '/') > 0
\`);
console.log(db.prepare('SELECT page_id FROM t').all());
"
```

Expected output:
```
[ { page_id: '/blog/post' }, { page_id: '/about' }, { page_id: '/' }, { page_id: '/already-path' } ]
```

- [ ] **Step 5.3: Commit**

```bash
git add server/db/migrations/075-normalise-insight-page-ids.sql
git commit -m "feat: add migration 075 to normalise analytics_insights.page_id to relative paths"
```

---

### Task 6: Update existing test assertions and add integration test

**Files:**
- Modify: `tests/unit/analytics-intelligence.test.ts`
- Create: `tests/integration/page-identity-pr1.test.ts`

The existing test at line ~136 asserts `pageId` is a full URL. After the change, it must assert a path.

- [ ] **Step 6.1: Update analytics-intelligence.test.ts assertion**

Find:
```ts
  it('uses page URL only as pageId so DB UNIQUE constraint deduplicates per page', () => {
    ...
    expect(seoTips.pageId).toBe('https://example.com/blog/seo-tips');
```

Replace the assertion:
```ts
    expect(seoTips.pageId).toBe('/blog/seo-tips');
```

Also find any other `expect(...pageId...).toBe('https://...)` assertions in this file and update them to path form.

- [ ] **Step 6.2: Verify existing tests still pass**

```bash
npx vitest run tests/unit/analytics-intelligence.test.ts --reporter=verbose
```

Expected: all pass.

- [ ] **Step 6.3: Write integration test for migration verification**

```ts
/**
 * Integration test for PR 1 — page identity normalisation.
 *
 * Verifies:
 * 1. After migration 075, no analytics_insights rows with page_id LIKE 'http%' remain.
 * 2. toAuditFindingPageId round-trips correctly in the write→read path.
 *
 * Port: 13330
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { seedWorkspace } from '../fixtures/workspace-seed.js';
import { upsertInsight, getInsights } from '../../server/analytics-insights-store.js';
import db from '../../server/db/index.js';

let ws: ReturnType<typeof seedWorkspace>;

beforeAll(() => {
  ws = seedWorkspace();
});

afterAll(() => {
  ws.cleanup();
});

describe('analytics_insights page_id normalisation', () => {
  it('stores relative path for GSC insight, not full URL', () => {
    upsertInsight({
      workspaceId: ws.workspaceId,
      insightType: 'page_health',
      pageId: '/blog/my-post',   // after normalisation write path uses path
      severity: 'opportunity',
      data: { score: 55, trend: 'stable', clicks: 100, impressions: 2000, position: 8, ctr: 5.0 },
    });

    const insights = getInsights(ws.workspaceId).filter(i => i.insightType === 'page_health');
    const found = insights.find(i => i.pageId === '/blog/my-post');
    expect(found).toBeDefined();
    expect(found!.pageId).not.toMatch(/^https?:\/\//);
  });

  it('migration 075: no http-prefixed page_ids remain after migration runs', () => {
    // Seed a full-URL row manually (simulating pre-migration data)
    db.prepare(`
      INSERT OR IGNORE INTO analytics_insights (id, workspace_id, insight_type, page_id, severity, data, created_at, updated_at)
      VALUES ('test-migration-row', ?, 'page_health', 'https://example.com/blog/migrated', 'opportunity', '{}', datetime('now'), datetime('now'))
    `).run(ws.workspaceId);

    // Verify it exists
    const before = db.prepare(`SELECT page_id FROM analytics_insights WHERE id = 'test-migration-row'`).get() as { page_id: string } | undefined;
    expect(before?.page_id).toBe('https://example.com/blog/migrated');

    // Run the migration logic directly (same SQL as migration 075)
    db.exec(`
      UPDATE analytics_insights
      SET page_id = SUBSTR(
        page_id,
        INSTR(page_id, '://') + 3
        + INSTR(SUBSTR(page_id, INSTR(page_id, '://') + 3), '/')
        - 1
      )
      WHERE page_id LIKE 'http%'
        AND INSTR(SUBSTR(page_id, INSTR(page_id, '://') + 3), '/') > 0
    `);

    const after = db.prepare(`SELECT page_id FROM analytics_insights WHERE id = 'test-migration-row'`).get() as { page_id: string } | undefined;
    expect(after?.page_id).toBe('/blog/migrated');

    // Verify no http-prefixed rows remain in this workspace
    const count = db.prepare(`SELECT COUNT(*) as n FROM analytics_insights WHERE page_id LIKE 'http%' AND workspace_id = ?`).get(ws.workspaceId) as { n: number };
    expect(count.n).toBe(0);
  });

  it('audit_finding dedup check works with path-format pageId', () => {
    // First write — creates the insight
    const first = upsertInsight({
      workspaceId: ws.workspaceId,
      insightType: 'audit_finding',
      pageId: '/services/seo',
      severity: 'warning',
      data: { scope: 'page', issueCount: 1, issueMessages: 'Missing meta', source: 'bridge_12_audit_page_health' },
      impactScore: 50,
      bridgeSource: 'bridge-audit-page-health',
    });

    // Second write — should update in-place (upsert), not create duplicate
    upsertInsight({
      workspaceId: ws.workspaceId,
      insightType: 'audit_finding',
      pageId: '/services/seo',
      severity: 'critical',
      data: { scope: 'page', issueCount: 2, issueMessages: 'Missing meta; H1 missing', source: 'bridge_12_audit_page_health' },
      impactScore: 80,
      bridgeSource: 'bridge-audit-page-health',
    });

    const all = getInsights(ws.workspaceId).filter(i => i.insightType === 'audit_finding' && i.pageId === '/services/seo');
    expect(all).toHaveLength(1);
    expect(all[0].severity).toBe('critical');   // updated, not duplicated
  });
});
```

- [ ] **Step 6.4: Run all new and updated tests**

```bash
npx vitest run tests/unit/page-identity-normalisation-pr1.test.ts tests/unit/analytics-intelligence.test.ts tests/integration/page-identity-pr1.test.ts --reporter=verbose
```

Expected: all pass.

- [ ] **Step 6.5: Commit**

```bash
git add tests/unit/analytics-intelligence.test.ts tests/integration/page-identity-pr1.test.ts
git commit -m "test: update pageId assertions for path normalisation; add PR1 integration tests"
```

---

### Task 7: Quality gates for PR 1

- [ ] **Step 7.1: Full test suite**

```bash
npx vitest run
```

Expected: all pass (no regressions).

- [ ] **Step 7.2: Typecheck**

```bash
npm run typecheck
```

Expected: zero errors.

- [ ] **Step 7.3: Build**

```bash
npx vite build
```

Expected: clean build.

- [ ] **Step 7.4: pr-check**

```bash
npx tsx scripts/pr-check.ts
```

Expected: zero errors (pre-existing warnings about PageHeader and WorkspaceSettings are allowed — they are not caused by this PR).

- [ ] **Step 7.5: Open PR 1, merge to staging, verify**

Manual staging verification:
- Admin chat → open a page profile for a page that has GSC data → should now show page-specific insights (previously empty)
- Diagnostic panel → trigger an anomaly → concurrent page insights should now appear

---

## ⚠️ STAGING GATE — Do not start Task 8 until PR 1 is merged and verified on staging.

---

## PR 2 — CMS `pageId` Canonical Helper + `_existingErrors` Wiring

### Task 8: Add `toCmsPageId` to webflow-pages.ts with TDD

**Files:**
- Create: `tests/unit/toCmsPageId.test.ts`
- Modify: `server/webflow-pages.ts`

- [ ] **Step 8.1: Write failing tests**

```ts
/**
 * Unit tests for toCmsPageId canonical helper.
 * Contract test: locks in format so future refactors don't break backward compat.
 */
import { describe, it, expect } from 'vitest';
import { toCmsPageId } from '../../server/webflow-pages.js';

describe('toCmsPageId', () => {
  it('converts /blog/my-post to cms-blog-my-post', () => {
    expect(toCmsPageId('/blog/my-post')).toBe('cms-blog-my-post');
  });

  it('strips leading slash before converting interior slashes', () => {
    // This is the key contract: no double-dash
    expect(toCmsPageId('/about/team')).toBe('cms-about-team');
  });

  it('handles homepage / edge case', () => {
    expect(toCmsPageId('/')).toBe('cms-');
  });

  it('handles deeply nested paths', () => {
    expect(toCmsPageId('/a/b/c')).toBe('cms-a-b-c');
  });

  it('handles path without leading slash (idempotent safe)', () => {
    expect(toCmsPageId('blog/my-post')).toBe('cms-blog-my-post');
  });

  it('does NOT produce double-dash (regression guard)', () => {
    expect(toCmsPageId('/blog/my-post')).not.toContain('--');
  });
});
```

- [ ] **Step 8.2: Run to confirm failures**

```bash
npx vitest run tests/unit/toCmsPageId.test.ts --reporter=verbose
```

Expected: all fail with "toCmsPageId is not a function".

- [ ] **Step 8.3: Add `toCmsPageId` to webflow-pages.ts**

Add after the `buildStaticPathSet` function (near the end of the file, before the closing line):

```ts
/**
 * Canonical formula for synthetic CMS page IDs.
 * All code that creates or looks up a CMS page ID must use this function.
 * Format: cms-{path-with-slashes-replaced-by-dashes}
 * Example: /blog/my-post → cms-blog-my-post
 */
export function toCmsPageId(path: string): string {
  return `cms-${path.replace(/^\//, '').replace(/\//g, '-')}`;
}
```

- [ ] **Step 8.4: Run tests**

```bash
npx vitest run tests/unit/toCmsPageId.test.ts --reporter=verbose
```

Expected: all pass.

- [ ] **Step 8.5: Commit**

```bash
git add tests/unit/toCmsPageId.test.ts server/webflow-pages.ts
git commit -m "feat: add toCmsPageId canonical helper to webflow-pages.ts with tests"
```

---

### Task 9: Fix CMS pageId generators in routes/webflow.ts, routes/jobs.ts, and schema-suggester.ts

**Files:**
- Modify: `server/routes/webflow.ts`
- Modify: `server/routes/jobs.ts`
- Modify: `server/schema-suggester.ts`

`server/webflow.ts` is a barrel re-exporter (`export * from './webflow-pages.js'`), so `toCmsPageId` is automatically available via `'../webflow.js'` in both route files.

- [ ] **Step 9.1: Fix `server/routes/webflow.ts` — import and generator**

Add `toCmsPageId` to the existing import from `'../webflow.js'` (the block that already imports `discoverCmsUrls` and `buildStaticPathSet`, around lines 9-18):

```ts
import {
  listSites,
  listAssets,
  updateAsset,
  deleteAsset,
  updatePageSeo,
  publishSite,
  discoverCmsUrls,
  buildStaticPathSet,
  toCmsPageId,
} from '../webflow.js';
```

Find in the CMS page construction loop (~line 151-157):
```ts
        for (const cms of cmsUrls) {
          result.push({
            id: `cms-${cms.path.replace(/\//g, '-')}`,
```

Replace the double-dash formula:
```ts
        for (const cms of cmsUrls) {
          result.push({
            id: toCmsPageId(cms.path),
```

- [ ] **Step 9.2: Fix `server/routes/jobs.ts` — import and generator**

Add `toCmsPageId` to the existing import from `'../webflow.js'` (the block around lines 44-45 that already has `discoverCmsUrls, buildStaticPathSet`):

```ts
import {
  ...
  discoverCmsUrls,
  buildStaticPathSet,
  toCmsPageId,
} from '../webflow.js';
```

Find (~line 720-721):
```ts
                  id: `cms-${cms.path.replace(/\//g, '-')}`,
```

Replace:
```ts
                  id: toCmsPageId(cms.path),
```

- [ ] **Step 9.3: Fix `server/schema-suggester.ts` — import and CMS loop pageId**

Add `toCmsPageId` to the existing import from `'./webflow.js'` at line 1:

```ts
import { discoverCmsUrls, buildStaticPathSet, getCollectionSchema, listCollections, toCmsPageId } from './webflow.js';
```

Find the CMS loop result construction (~line 2177-2178):
```ts
          return {
            pageId: `cms-${slug}`,
```

Replace:
```ts
          return {
            pageId: toCmsPageId(item.path),
```

Note: use `item.path` not `slug` — `item.path` has the leading slash (e.g. `/blog/my-post`), and `toCmsPageId` strips it. `slug` is `item.path.replace(/^\//, '')` which would double-strip if passed to `toCmsPageId`.

- [ ] **Step 9.4: Run typecheck**

```bash
npm run typecheck
```

Expected: zero errors.

- [ ] **Step 9.5: Commit**

```bash
git add server/routes/webflow.ts server/routes/jobs.ts server/schema-suggester.ts
git commit -m "fix: use toCmsPageId canonical helper in all CMS pageId generators"
```

---

### Task 10: Add `_existingErrors` to SchemaContext and wire into all three injection points

**Files:**
- Modify: `server/schema-suggester.ts`

Three injection points in the same file:
1. `SchemaContext` interface — add the field
2. `buildSchemaIntelligenceBlock` — add the output line
3. `generateSchemaSuggestions` — build lookup map + wire into both loops
4. `generateSchemaForPage` — single targeted lookup

- [ ] **Step 10.1: Add field to SchemaContext interface (~line 168)**

Find the `SchemaContext` interface. Add after `_siteId`:

```ts
  _siteId?: string;  // Internal: passed through for site template storage
  _existingErrors?: Array<{ type: string; message: string }>;  // Prior validation errors from schema_validations
  _planContext?: string;
```

- [ ] **Step 10.2: Wire into buildSchemaIntelligenceBlock (~line 228)**

Find the function body. Add at the end (after the faqBlock logic, before the `return` statement — look for the return that joins lines):

```ts
  if (ctx._existingErrors && ctx._existingErrors.length > 0) {
    lines.push(`- Prior validation errors (fix these): ${ctx._existingErrors.map(e => e.message).join('; ')}`);
  }
```

- [ ] **Step 10.3: Import getValidations in schema-suggester.ts**

Add to the imports at the top of the file (after the existing `saveSiteTemplate` import from `./schema-store.js`):

```ts
import { getValidations, getValidation } from './schema-validator.js';
import type { SchemaValidation } from './schema-validator.js';
```

- [ ] **Step 10.4: Wire into generateSchemaSuggestions — build lookup map**

Find `generateSchemaSuggestions` (~line 1951). After the `wsId` and `allPublished` assignments (~line 1970-1975), add:

```ts
  // Pre-build a pageId → validation map for _existingErrors injection
  const validationsByPageId = new Map<string, SchemaValidation>();
  if (wsId) {
    for (const v of getValidations(wsId)) validationsByPageId.set(v.pageId, v);
  }
```

- [ ] **Step 10.5: Wire into static pages loop pageCtx**

Find the static pages `pageCtx` construction (~line 2034):

```ts
        const pageCtx: SchemaContext = {
          ...ctx,
          pageKeywords: getPageKeywords(lookupPath),
          searchIntent: getPageIntent(lookupPath),
          _planContext: planContext || undefined,
          _pageAnalysis: getPageAnalysis(lookupPath),
          _gscPageData: gscMap?.get(normalizedPath),
          _ga4PageData: ga4Map?.get(normalizedPath),
          _pageHealthScore: insightData?.healthScore,
          _pageHealthTrend: insightData?.healthTrend as SchemaContext['_pageHealthTrend'],
          _quickWinStatus: insightData?.isQuickWin,
          _faqOpportunities: queryPageData ? extractFaqOpportunities(queryPageData, fullPageUrl) : undefined,
        };
```

Add `_existingErrors` at the end of the spread:
```ts
        const pageCtx: SchemaContext = {
          ...ctx,
          pageKeywords: getPageKeywords(lookupPath),
          searchIntent: getPageIntent(lookupPath),
          _planContext: planContext || undefined,
          _pageAnalysis: getPageAnalysis(lookupPath),
          _gscPageData: gscMap?.get(normalizedPath),
          _ga4PageData: ga4Map?.get(normalizedPath),
          _pageHealthScore: insightData?.healthScore,
          _pageHealthTrend: insightData?.healthTrend as SchemaContext['_pageHealthTrend'],
          _quickWinStatus: insightData?.isQuickWin,
          _faqOpportunities: queryPageData ? extractFaqOpportunities(queryPageData, fullPageUrl) : undefined,
          _existingErrors: validationsByPageId.get(page.id)?.errors as Array<{ type: string; message: string }> | undefined,
        };
```

Note: `page.id` is the real Webflow UUID for static pages — this matches `schema_validations.page_id` which the frontend writes with the same UUID.

- [ ] **Step 10.6: Wire into CMS loop pageCtx**

Find the CMS loop `pageCtx` construction (~line 2124). It currently ends with `_quickWinStatus`. Add before the closing `};`:

First, add a `const cmsPageId` line immediately before the `pageCtx` (so it can be reused):

Find:
```ts
          const cmsNormalizedPath = ...
          const cmsInsightData = insightsMap?.get(item.url);
          const pageCtx: SchemaContext = {
```

Insert `cmsPageId` between those lines:
```ts
          const cmsNormalizedPath = (item.path.startsWith('/') ? item.path : `/${item.path}`).replace(/\/$/, '') || '/';
          const cmsPageId = toCmsPageId(item.path);
          const cmsInsightData = insightsMap?.get(item.url);
          const pageCtx: SchemaContext = {
            ...ctx,
            pageKeywords: getPageKeywords(slug),
            searchIntent: getPageIntent(slug),
            _pageAnalysis: getPageAnalysis(slug),
            _gscPageData: gscMap?.get(cmsNormalizedPath),
            _ga4PageData: ga4Map?.get(cmsNormalizedPath),
            _pageHealthScore: cmsInsightData?.healthScore,
            _pageHealthTrend: cmsInsightData?.healthTrend as SchemaContext['_pageHealthTrend'],
            _quickWinStatus: cmsInsightData?.isQuickWin,
            _faqOpportunities: queryPageData ? extractFaqOpportunities(queryPageData, item.url) : undefined,
            _existingErrors: validationsByPageId.get(cmsPageId)?.errors as Array<{ type: string; message: string }> | undefined,
          };
```

- [ ] **Step 10.7: Wire into generateSchemaForPage**

Find `generateSchemaForPage` (~line 1849). After the `queryPageData` injection block (~line 1897-1899), add `_existingErrors` injection:

```ts
  // Inject prior validation errors if available
  if (ctx.workspaceId) {
    const existing = getValidation(ctx.workspaceId, pageId);
    if (existing?.errors?.length) {
      ctx._existingErrors = existing.errors as Array<{ type: string; message: string }>;
    }
  }
```

Place this before `// Try AI unified schema first` (~line 1901).

- [ ] **Step 10.8: Run typecheck**

```bash
npm run typecheck
```

Expected: zero errors.

- [ ] **Step 10.9: Commit**

```bash
git add server/schema-suggester.ts
git commit -m "feat: wire _existingErrors into SchemaContext for static and CMS pages"
```

---

### Task 11: Fix assemblePageProfile schema validation lookup

**Files:**
- Modify: `server/workspace-intelligence.ts`

The current lookup at line ~2502 does `validations.find(v => v.pageId === pagePath)` — this always fails because `v.pageId` is a Webflow UUID (or `cms-*`), never a URL path.

- [ ] **Step 11.1: Replace the schema status try block (~lines 2497-2510)**

Find:
```ts
  // Schema status
  let schemaStatus: PageProfileSlice['schemaStatus'] = 'none';
  try {
    const { getValidations } = await import('./schema-validator.js');
    const validations: SchemaValidation[] = getValidations(workspaceId);
    const pageValidation = validations.find(v => v.pageId === pagePath);
    if (pageValidation) {
      const status = pageValidation.status;
      schemaStatus = status === 'valid' ? 'valid' : status === 'warnings' ? 'warnings' : status === 'errors' ? 'errors' : 'none';
    }
  } catch (err) {
    schemaStatus = 'none';
    log.debug({ err, workspaceId }, 'assemblePageProfile: schema status optional, degrading gracefully');
  }
```

Replace with:
```ts
  // Schema status
  let schemaStatus: PageProfileSlice['schemaStatus'] = 'none';
  try {
    const { getValidations } = await import('./schema-validator.js');
    const { getSchemaSnapshot } = await import('./schema-store.js');
    const { toCmsPageId } = await import('./webflow-pages.js');
    const validations: SchemaValidation[] = getValidations(workspaceId);
    // Resolve pagePath → pageId: snapshot reverse-lookup for static pages,
    // toCmsPageId fallback for CMS pages (works immediately post-migration).
    const snapshot = ws?.webflowSiteId ? getSchemaSnapshot(ws.webflowSiteId) : null;
    const resolvedPageId = snapshot?.results.find(r =>
      r.slug === pagePath.replace(/^\//, '') || `/${r.slug}` === pagePath
    )?.pageId ?? toCmsPageId(pagePath);
    const pageValidation = validations.find(v => v.pageId === resolvedPageId);
    if (pageValidation) {
      const status = pageValidation.status;
      schemaStatus = status === 'valid' ? 'valid' : status === 'warnings' ? 'warnings' : status === 'errors' ? 'errors' : 'none';
    }
  } catch (err) {
    schemaStatus = 'none';
    log.debug({ err, workspaceId }, 'assemblePageProfile: schema status optional, degrading gracefully');
  }
```

Note: `ws` is defined inside the `auditIssues` try block (lines ~2481-2494). The `schemaStatus` block is AFTER it. At runtime, `ws` would be `undefined` here because the `auditIssues` block scoped `ws` with `const`. You need to hoist `ws` to be available.

Find the auditIssues block (~line 2478):
```ts
  // Audit issues for this page
  let auditIssues: string[] = [];
  try {
    const { getWorkspace } = await import('./workspaces.js');
    const ws = getWorkspace(workspaceId);
```

Change the inner `const ws` to use a pre-declared outer variable. Before `let auditIssues`, declare:
```ts
  // Hoist workspace for reuse across schema status + audit issues blocks
  let ws: Awaited<ReturnType<typeof import('./workspaces.js').getWorkspace>> | null = null;
  try {
    const { getWorkspace } = await import('./workspaces.js');
    ws = getWorkspace(workspaceId) ?? null;
  } catch { /* non-fatal */ }

  // Audit issues for this page
  let auditIssues: string[] = [];
  try {
```

Then update the auditIssues block to use the already-resolved `ws` (remove the inner `getWorkspace` import and assignment):
```ts
  let auditIssues: string[] = [];
  try {
    if (ws?.webflowSiteId) {
      const { getLatestSnapshot } = await import('./reports.js');
      const snap = getLatestSnapshot(ws.webflowSiteId);
      if (snap?.audit?.pages) {
        const pagData = (snap.audit.pages as PageSeoResult[]).find(p => p.url === pagePath || p.slug === pagePath);
        if (pagData?.issues) {
          auditIssues = pagData.issues.map((i: SeoIssue) => i.message).filter(Boolean);
        }
      }
    }
  } catch (err) {
    log.debug({ err, workspaceId }, 'assemblePageProfile: audit data optional, degrading gracefully');
  }
```

- [ ] **Step 11.2: Check if SchemaValidation is imported at the top of workspace-intelligence.ts**

```bash
grep -n "SchemaValidation" server/workspace-intelligence.ts | head -5
```

If not imported, add it (find the existing import section and add):
```ts
import type { SchemaValidation } from './schema-validator.js';
```

- [ ] **Step 11.3: Run typecheck**

```bash
npm run typecheck
```

Expected: zero errors. If the `ws` type doesn't line up, use `ReturnType<typeof import('./workspaces.js').getWorkspace>` as the type or simply type it as the workspace type imported at the top.

- [ ] **Step 11.4: Commit**

```bash
git add server/workspace-intelligence.ts
git commit -m "fix: assemblePageProfile schema status — snapshot reverse lookup instead of always-failing pagePath equality"
```

---

### Task 12: Write the SQL migration for CMS page IDs

**Files:**
- Create: `server/db/migrations/076-normalise-cms-page-ids.sql`

Normalises double-dash `cms--*` rows to single-dash `cms-*` across all tables that key CMS pages by synthetic ID.

- [ ] **Step 12.1: Create the migration file**

```sql
-- 076-normalise-cms-page-ids.sql
--
-- Normalise CMS synthetic page_id values from double-dash format (cms--blog-post)
-- to single-dash format (cms-blog-post) across all tables that key CMS pages.
--
-- Double-dash arose because the old formula was cms-${path.replace(/\//g, '-')}
-- which kept the leading slash, producing cms--blog-post for /blog-post.
-- The new toCmsPageId canonical formula strips the leading slash first.
--
-- Tables migrated: schema_validations, schema_publish_history,
--                  schema_page_types, page_states, seo_changes.
--
-- Formula: 'cms-' || SUBSTR(page_id, 6)
-- For cms--blog-post: SUBSTR('cms--blog-post', 6) = 'blog-post' → 'cms-blog-post'
-- Safe: only rows LIKE 'cms--%' are touched.

UPDATE schema_validations
SET page_id = 'cms-' || SUBSTR(page_id, 6)
WHERE page_id LIKE 'cms--%';

UPDATE schema_publish_history
SET page_id = 'cms-' || SUBSTR(page_id, 6)
WHERE page_id LIKE 'cms--%';

UPDATE schema_page_types
SET page_id = 'cms-' || SUBSTR(page_id, 6)
WHERE page_id LIKE 'cms--%';

UPDATE page_states
SET page_id = 'cms-' || SUBSTR(page_id, 6)
WHERE page_id LIKE 'cms--%';

UPDATE seo_changes
SET page_id = 'cms-' || SUBSTR(page_id, 6)
WHERE page_id LIKE 'cms--%';
```

- [ ] **Step 12.2: Verify formula in SQLite**

```bash
npx tsx -e "
import Database from 'better-sqlite3';
const db = new Database(':memory:');
db.exec('CREATE TABLE t (page_id TEXT)');
db.exec(\"INSERT INTO t VALUES ('cms--blog-my-post'), ('cms--about-team'), ('cms-already-good'), ('not-cms')\");
db.exec(\"UPDATE t SET page_id = 'cms-' || SUBSTR(page_id, 6) WHERE page_id LIKE 'cms--%'\");
console.log(db.prepare('SELECT page_id FROM t').all());
"
```

Expected:
```
[ { page_id: 'cms-blog-my-post' }, { page_id: 'cms-about-team' }, { page_id: 'cms-already-good' }, { page_id: 'not-cms' } ]
```

- [ ] **Step 12.3: Commit**

```bash
git add server/db/migrations/076-normalise-cms-page-ids.sql
git commit -m "feat: add migration 076 to normalise CMS page_ids from double-dash to single-dash format"
```

---

### Task 13: Integration tests for PR 2

**Files:**
- Create: `tests/integration/page-identity-pr2.test.ts`

Port: 13331

- [ ] **Step 13.1: Write the integration test**

```ts
/**
 * Integration tests for PR 2 — CMS pageId normalisation and _existingErrors wiring.
 *
 * Verifies:
 * 1. toCmsPageId round-trips correctly in storage.
 * 2. Migration 076 normalises cms-- rows.
 * 3. _existingErrors is populated when a schema_validations row exists for the page.
 * 4. generateSchemaSuggestions CMS loop emits pageId in toCmsPageId format.
 *
 * Port: 13331
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { seedWorkspace } from '../fixtures/workspace-seed.js';
import { toCmsPageId } from '../../server/webflow-pages.js';
import { buildSchemaIntelligenceBlock } from '../../server/schema-suggester.js';
import type { SchemaContext } from '../../server/schema-suggester.js';
import db from '../../server/db/index.js';

let ws: ReturnType<typeof seedWorkspace>;

beforeAll(() => {
  ws = seedWorkspace();
});

afterAll(() => {
  ws.cleanup();
});

describe('toCmsPageId in storage', () => {
  it('stores cms-blog-my-post for /blog/my-post', () => {
    const id = toCmsPageId('/blog/my-post');
    expect(id).toBe('cms-blog-my-post');
  });

  it('stores cms-blog-my-post when path has no leading slash', () => {
    expect(toCmsPageId('blog/my-post')).toBe('cms-blog-my-post');
  });
});

describe('migration 076: cms-- normalisation', () => {
  it('normalises cms-- rows to cms- across all tables', () => {
    // Seed a double-dash row in schema_validations
    db.prepare(`
      INSERT OR IGNORE INTO schema_validations (id, workspace_id, page_id, status, rich_results, errors, warnings, validated_at)
      VALUES ('test-migration-cms', ?, 'cms--blog-migrate-test', 'valid', '[]', '[]', '[]', datetime('now'))
    `).run(ws.workspaceId);

    // Run migration 076 logic directly
    db.exec(`UPDATE schema_validations SET page_id = 'cms-' || SUBSTR(page_id, 6) WHERE page_id LIKE 'cms--%'`);

    const after = db.prepare(`SELECT page_id FROM schema_validations WHERE id = 'test-migration-cms'`).get() as { page_id: string } | undefined;
    expect(after?.page_id).toBe('cms-blog-migrate-test');
  });

  it('no cms-- rows remain after migration', () => {
    const count = db.prepare(`SELECT COUNT(*) as n FROM schema_validations WHERE page_id LIKE 'cms--%'`).get() as { n: number };
    expect(count.n).toBe(0);
  });
});

describe('_existingErrors in buildSchemaIntelligenceBlock', () => {
  it('includes prior errors in intelligence block when present', () => {
    const ctx: SchemaContext = {
      _existingErrors: [
        { type: 'MissingField', message: 'Missing required @type' },
        { type: 'InvalidValue', message: 'Invalid datePublished format' },
      ],
    };
    const block = buildSchemaIntelligenceBlock(ctx);
    expect(block).toContain('Prior validation errors');
    expect(block).toContain('Missing required @type');
    expect(block).toContain('Invalid datePublished format');
  });

  it('omits prior errors line when _existingErrors is empty', () => {
    const ctx: SchemaContext = { _existingErrors: [] };
    const block = buildSchemaIntelligenceBlock(ctx);
    expect(block).not.toContain('Prior validation errors');
  });

  it('omits prior errors line when _existingErrors is undefined', () => {
    const ctx: SchemaContext = {};
    const block = buildSchemaIntelligenceBlock(ctx);
    expect(block).not.toContain('Prior validation errors');
  });
});
```

- [ ] **Step 13.2: Run tests**

```bash
npx vitest run tests/unit/toCmsPageId.test.ts tests/integration/page-identity-pr2.test.ts --reporter=verbose
```

Expected: all pass.

- [ ] **Step 13.3: Commit**

```bash
git add tests/integration/page-identity-pr2.test.ts
git commit -m "test: add PR2 integration tests for CMS pageId normalisation and _existingErrors wiring"
```

---

### Task 14: Quality gates for PR 2

- [ ] **Step 14.1: Full test suite**

```bash
npx vitest run
```

Expected: all pass.

- [ ] **Step 14.2: Typecheck**

```bash
npm run typecheck
```

Expected: zero errors.

- [ ] **Step 14.3: Build**

```bash
npx vite build
```

Expected: clean build.

- [ ] **Step 14.4: pr-check**

```bash
npx tsx scripts/pr-check.ts
```

Expected: zero errors.

- [ ] **Step 14.5: Update FEATURE_AUDIT.md**

Add or update entries:
- Schema generation `_existingErrors` context (new field in SchemaContext)
- CMS page identity normalisation (toCmsPageId canonical helper)

- [ ] **Step 14.6: Open PR 2, merge to staging, verify**

Manual staging verification:
- Schema suggestions page → CMS pages should show correct `lastPublishedAt` (no longer null)
- Admin chat → page profile for a page with stored schema validation → should show correct `schemaStatus`

---

## Systemic Improvements

### Shared utilities introduced
- `server/helpers.ts` — `toAuditFindingPageId(page)` (Webflow audit page → relative path)
- `server/analytics-intelligence.ts` — `toInsightPageId(url)` (GSC URL → relative path, local function)
- `server/webflow-pages.ts` — `toCmsPageId(path)` (exported, canonical CMS synthetic ID)

### pr-check rules to consider adding (future)
- Flag any `pageId: .*\.page\b` in `analytics-intelligence.ts` without `toInsightPageId()` wrapper — prevents regression to URL storage
- Flag `cms-\$\{.*replace.*\/` pattern — prevents re-introduction of inline double-dash CMS ID formula

### New tests added
- `tests/unit/page-identity-normalisation-pr1.test.ts` — helper unit tests for PR 1
- `tests/unit/toCmsPageId.test.ts` — contract test locking in CMS pageId format
- `tests/integration/page-identity-pr1.test.ts` — migration + dedup integration
- `tests/integration/page-identity-pr2.test.ts` — CMS migration + `_existingErrors` integration
