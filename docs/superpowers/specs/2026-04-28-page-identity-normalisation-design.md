# Page Identity Normalisation — Design Spec

**Date:** 2026-04-28
**Branch:** fix/schema-generator-quality
**Status:** Approved for implementation

---

## Problem

The platform has two independent instances of the same class of bug: a "page identity" value is written using one format in one place and read using a different format in another. Both produce silent lookup failures — no errors, just features that silently return empty or stale data.

### Instance 1 — `analytics_insights.page_id` has no enforced format

`analytics_insights.page_id` stores different formats depending on insight type:

| Insight type | Stored format | Example |
|---|---|---|
| `page_health`, `ranking_mover`, `ctr_opportunity`, `serp_opportunity` | Full URL from GSC/GA4 | `https://example.com/blog/post` |
| `audit_finding` | Webflow page UUID | `abc-123-uuid` |

Consumers that filter insights by page compare against a third format — the relative path (`/blog/post`) that `workspace-intelligence.ts` uses as `pagePath`. None of the three formats match any of the others, so:

- Page profiles in admin chat show zero page-specific insights
- Anomaly diagnostics in `diagnostic-orchestrator.ts` find no concurrent insights
- One partial workaround exists (`webflow-seo.ts:340-342` uses `endsWith`) with a comment acknowledging the mismatch — but it only handles URL vs path, not UUID vs path, and breaks on the homepage

### Instance 2 — CMS synthetic `pageId` is generated with three different formulas

CMS pages discovered via `discoverCmsUrls` (sitemap-based) receive a synthetic ID of the form `cms-{derived-from-path}`. Three generators produce this ID with different formulas:

| Location | Formula | Output for `/blog/my-post` |
|---|---|---|
| `server/routes/webflow.ts:152` | `cms-${path.replace(/\//g, '-')}` | `cms--blog-my-post` (double-dash) |
| `server/routes/jobs.ts:721` | same | `cms--blog-my-post` |
| `server/schema-suggester.ts:2178` | `cms-${path.replace(/^\//, '')}` | `cms-blog/my-post` (slash remains) |

The frontend sources its CMS page IDs from `webflow.ts` (double-dash). DB tables (`schema_validations`, `schema_publish_history`, etc.) are written via the frontend — they all use the double-dash format. The schema suggester uses a completely different format, so:

- `lastPublishedAt` is always null for CMS pages in the schema UI (publish history keyed by double-dash, snapshot keyed by slash)
- CMS schema edits are silently discarded on reload (`updatePageSchemaInSnapshot` lookup misses)
- `_existingErrors` feature (being built on this branch) would always return empty for CMS pages
- `assemblePageProfile` schema validation lookup is always `null` for all pages (compares `v.pageId` against URL path — different format regardless of page type)

---

## Solution: Two sequential PRs

### PR 1 — Normalise `analytics_insights.page_id` to relative paths

**New contract:** `analytics_insights.page_id` always stores a **relative path** (`/blog/my-post`) or a **synthetic non-URL key** (`cannibalization::query`, `gap::keyword`, `cluster::label`). Never a full URL. Never a Webflow UUID.

#### Storage changes

**`server/analytics-intelligence.ts`** — 4 GSC/GA4 insight generators (`page_health`, `ranking_mover`, `ctr_opportunity`, `serp_opportunity`) currently write `pageId: row.page` (full GSC URL). Change to:

```ts
pageId: (() => { try { return new URL(row.page).pathname; } catch { return row.page; } })()
```

Wrap in try/catch to skip malformed URLs gracefully (keep original value as fallback).

**`server/routes/webflow-seo.ts:157`** — `audit_finding` write path currently uses `pageId: page.pageId` (Webflow UUID). Change to:

```ts
pageId: page.slug ? `/${page.slug}` : (() => { try { return new URL(page.url).pathname; } catch { return page.slug || page.pageId; } })()
```

`PageSeoResult` already has both `slug` and `url` — this is a field swap.

**`server/scheduled-audits.ts:221`** — same `audit_finding` write path, same change.

#### DB migration (TypeScript)

New migration file in `server/db/migrations/` (next available number):

```ts
// Normalises full-URL page_ids in analytics_insights to relative paths
const rows = db.prepare(
  `SELECT id, page_id FROM analytics_insights WHERE page_id LIKE 'http%'`
).all() as Array<{ id: string; page_id: string }>;

const update = db.prepare(`UPDATE analytics_insights SET page_id = ? WHERE id = ?`);
db.transaction(() => {
  for (const row of rows) {
    try {
      update.run(new URL(row.page_id).pathname, row.id);
    } catch { /* skip malformed — leave as-is */ }
  }
})();
```

UUID-format `audit_finding` rows are NOT migrated. They orphan harmlessly — they're analytics data, not primary records. New writes use the path format going forward, so coverage naturally improves over time.

#### Comparison fixes

Three broken sites become plain equality:

- `server/workspace-intelligence.ts:452` → `i.pageId === opts.pagePath`
- `server/workspace-intelligence.ts:2464` → `i.pageId === pagePath`
- `server/diagnostic-orchestrator.ts:381` → `i.pageId === affectedPagePath`

**Workaround removal:** `server/routes/webflow-seo.ts:340-342` — remove the `endsWith` workaround and its comment. Replace with `i.pageId === pagePath`.

#### Dedup check update

`server/routes/webflow-seo.ts:150` and `server/scheduled-audits.ts:158/165` — currently UUID-to-UUID comparisons for `audit_finding` dedup and auto-resolve. After the write path changes to path format, these comparisons remain structurally identical but compare `/blog/my-post` against `/blog/my-post`. No logic change required.

#### Tests

- Unit: insight path normalisation — full URL, HTTPS, HTTP, malformed URL, path already normalised (idempotent), synthetic key unchanged
- Unit: audit finding write path produces correct path format from slug and from URL fallback
- Integration: after migration, `analytics_insights WHERE page_id LIKE 'http%'` returns zero rows
- Integration: `assemblePageProfile` with a known pagePath returns matching insights
- Integration: audit finding dedup still prevents duplicate storage after format change

---

### PR 2 — CMS `pageId` canonical helper + `_existingErrors` wiring

**Depends on PR 1 merged and green on staging.**

**New contract:** All CMS synthetic page IDs use `toCmsPageId(path: string): string` from `server/webflow-pages.ts`. Formula:

```ts
export function toCmsPageId(path: string): string {
  return `cms-${path.replace(/^\//, '').replace(/\//g, '-')}`;
}
```

Strips leading slash before replacing remaining slashes with dashes. Produces `cms-blog-my-post` not `cms--blog-my-post`. This is the canonical format going forward.

#### DB migration (TypeScript)

Normalises double-dash rows (`cms--*`) to single-dash (`cms-*`) across all tables. Pre-migration: count and log affected rows per table; warn if any table has over 100 CMS rows (unexpected).

Tables migrated:
- `schema_validations` (keyed by `workspace_id, page_id`)
- `schema_publish_history` (keyed by `site_id, page_id`)
- `schema_page_types` (keyed by `site_id, page_id`)
- `page_states` (keyed by `workspace_id, page_id`)
- `seo_changes` (keyed by `workspace_id, page_id`)

```ts
const tables = [
  'schema_validations',
  'schema_publish_history',
  'schema_page_types',
  'page_states',
  'seo_changes',
];
db.transaction(() => {
  for (const table of tables) {
    const rows = db.prepare(
      `SELECT rowid, page_id FROM ${table} WHERE page_id LIKE 'cms--%'`
    ).all() as Array<{ rowid: number; page_id: string }>;
    if (rows.length > 0) {
      log.info({ table, count: rows.length }, 'Migrating CMS page_id rows');
    }
    const update = db.prepare(`UPDATE ${table} SET page_id = ? WHERE rowid = ?`);
    for (const row of rows) {
      update.run(row.page_id.replace(/^cms--/, 'cms-'), row.rowid);
    }
  }
})();
```

#### Generator fixes

Replace inline formula with `toCmsPageId` in 3 files:

- `server/routes/webflow.ts:152` — `id: toCmsPageId(cms.path)` (import from `./webflow-pages.js`)
- `server/routes/jobs.ts:721` — `id: toCmsPageId(cms.path)` (same import)
- `server/schema-suggester.ts:2178` — `pageId: toCmsPageId(item.path)` (fixes the divergent format; also fixes `SchemaPageSuggestion.pageId` for CMS pages so snapshots emit the correct key)

#### `_existingErrors` wiring

**`SchemaContext`** (in `schema-suggester.ts`):

```ts
_existingErrors?: Array<{ type: string; message: string }>;
```

**`generateSchemaSuggestions`** — before either loop, build lookup map:

```ts
const validationsByPageId = new Map<string, SchemaValidation>();
if (wsId) {
  for (const v of getValidations(wsId)) validationsByPageId.set(v.pageId, v);
}
```

Wire into static pages loop:
```ts
_existingErrors: validationsByPageId.get(page.id)?.errors as Array<{ type: string; message: string }> | undefined,
```

Wire into CMS loop (after `const cmsPageId = toCmsPageId(item.path)`):
```ts
_existingErrors: validationsByPageId.get(cmsPageId)?.errors as Array<{ type: string; message: string }> | undefined,
```

**`generateSchemaForPage`** — single targeted lookup using `pageId` (real Webflow UUID for static pages):

```ts
if (ctx.workspaceId) {
  const existing = getValidation(ctx.workspaceId, pageId);
  if (existing?.errors?.length) {
    ctx._existingErrors = existing.errors as Array<{ type: string; message: string }>;
  }
}
```

**`buildSchemaIntelligenceBlock`** — add after existing checks:

```ts
if (ctx._existingErrors && ctx._existingErrors.length > 0) {
  lines.push(`- Prior validation errors (fix these): ${ctx._existingErrors.map(e => e.message).join('; ')}`);
}
```

#### `assemblePageProfile` fix

`server/workspace-intelligence.ts:2502` — replace the always-failing `validations.find(v => v.pageId === pagePath)` with a two-step resolution:

```ts
// Resolve pagePath → pageId via schema snapshot, fall back to CMS synthetic ID
const { getSchemaSnapshot } = await import('./schema-store.js');
const { getWorkspace: getWsForSchema } = await import('./workspaces.js');
const wsForSchema = getWsForSchema(workspaceId);
const snapshot = wsForSchema?.webflowSiteId ? getSchemaSnapshot(wsForSchema.webflowSiteId) : null;
const resolvedPageId = snapshot?.results.find(r =>
  r.slug === pagePath.replace(/^\//, '') || `/${r.slug}` === pagePath
)?.pageId ?? toCmsPageId(pagePath);
const pageValidation = validations.find(v => v.pageId === resolvedPageId);
```

- CMS pages: resolved immediately via `toCmsPageId` fallback — works from day one post-migration
- Static pages: resolved via snapshot — works after first schema analysis run post-deploy
- Static pages without snapshot: degrade to `schemaStatus: 'none'` (same as current, self-heals on next job run)

#### Side effects fixed at no extra cost

- `lastPublishedAt` now correct for CMS pages in schema snapshot endpoint
- `updatePageSchemaInSnapshot` now finds CMS pages (snapshot key matches frontend key)
- `removePageFromSnapshot` now works for CMS pages

#### Tests

- Unit: `toCmsPageId` — leading slash stripped, interior slashes dashed, homepage `/` edge case, nested path `/a/b/c`
- Unit: `toCmsPageId('/blog/my-post') === 'cms-blog-my-post'` (contract test — locks in format so future "cleanup" doesn't break backward compat)
- Integration: post-migration, no `cms--*` rows remain in any affected table
- Integration: `generateSchemaSuggestions` CMS loop emits `pageId` matching `toCmsPageId` format
- Integration: `_existingErrors` populated correctly when a matching `schema_validations` row exists
- Integration: `generateSchemaForPage` populates `_existingErrors` for a page with a stored validation
- Integration: `assemblePageProfile` returns correct `schemaStatus` when snapshot is populated

---

## Quality gates (both PRs)

- `npm run typecheck` — zero errors
- `npx vite build` — clean
- `npx vitest run` — full suite passes
- `npx tsx scripts/pr-check.ts` — zero errors
- Manual staging verify: schema suggestions page shows CMS pages with correct `lastPublishedAt`; admin chat page profile shows non-empty schema status for pages with stored validations
