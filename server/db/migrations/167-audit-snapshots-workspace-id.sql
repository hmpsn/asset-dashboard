-- 167-audit-snapshots-workspace-id.sql
-- Reconcile R11-T5 (Task C1) — retrofit the 3 legacy snapshot tables that predate
-- workspace scoping (audit_snapshots, performance_snapshots, redirect_snapshots) to
-- carry a first-class workspace_id column with FK ON DELETE CASCADE, matching the 10
-- already-modern snapshot tables (serp_snapshots, business_listing_snapshots,
-- llm_mention_snapshots, roi_snapshots, rank_snapshots, competitor_snapshots,
-- workspace_metrics_snapshots, ga4_conversion_snapshots, local_visibility_snapshots,
-- schema_snapshots). See server/db/snapshot-registry.ts for the full 13-table census
-- and tests/contract/snapshot-envelope-registry.test.ts for the enforcing contract.
--
-- WHY site_id CANNOT BE DROPPED IN THIS MIGRATION
-- ──────────────────────────────────────────────────────────────────────────
-- All three tables were designed pre-workspace, keyed on `site_id` — which in
-- practice holds workspaces.webflow_site_id (a Webflow site id), NOT
-- workspaces.id. Every live read path (server/reports.ts, server/performance-store.ts,
-- server/redirect-store.ts, and their callers in server/intelligence/site-health-slice.ts
-- + server/intelligence/page-profile-slice.ts) looks these rows up BY webflow site id,
-- resolved via workspace.webflowSiteId at the call site — never by workspace_id. This
-- migration is additive: it adds workspace_id (backfilled, FK CASCADE) for the registry
-- contract and future workspace-scoped reads/deletes, but does not repoint existing
-- site_id-keyed reads. A follow-up migration may drop site_id once every read path is
-- confirmed migrated to workspace_id — see docs/rules/destructive-migrations.md, that
-- drop is deliberately out of scope here.
--
-- performance_snapshots' site_id is additionally an OVERLOADED composite key for some
-- `sub` values (pagespeed-single stores `${webflowSiteId}_${pageKey}`; competitor
-- stores a URL-derived comparison key with no workspace at all) — see
-- server/performance-store.ts saveSinglePageSpeed / saveCompetitorCompare /
-- competitorKey. Rows whose site_id does not resolve to EXACTLY ONE workspace are
-- quarantined, never deleted, into performance_snapshots_orphaned (counts asserted
-- in tests/contract/snapshot-envelope-registry.test.ts — the pure-SQL migration
-- cannot log, so the test pins the "counted" half of the spec's counted+logged).
--
-- RESOLUTION MUST BE PROVABLY 1:1 (CV-1)
-- ──────────────────────────────────────────────────────────────────────────
-- workspaces.webflow_site_id has NO UNIQUE constraint (migration 005 declares it a
-- plain nullable TEXT; migration 128 adds only a NON-unique index). A naive
-- `JOIN workspaces ON webflow_site_id = site_id` therefore emits ONE ROW PER MATCHING
-- workspace: if a site_id maps to >1 workspace, that duplicates the snapshot row's
-- primary key and the INSERT aborts with UNIQUE/PRIMARY-KEY-constraint-failed,
-- rolling back the ENTIRE migration. The dev DB happens to have zero duplicate
-- site_ids (so every gate passed), but there is no schema guarantee — any environment
-- with a shared webflow_site_id would fail the deploy. To make the copy collision-proof
-- regardless of data, the resolvable partition joins against a subquery that yields at
-- most ONE workspace id per site_id:
--     SELECT webflow_site_id, MIN(id) AS workspace_id
--     FROM workspaces
--     WHERE webflow_site_id IS NOT NULL AND webflow_site_id != ''
--     GROUP BY webflow_site_id HAVING COUNT(*) = 1
-- This guarantees exactly one output row per input row, so the INSERT can never
-- collide. An AMBIGUOUS site_id (maps to >1 workspace) is a NON-resolution — we do NOT
-- guess an arbitrary workspace — so it is quarantined alongside the zero-match rows.
--
-- PATTERN: RENAME-TO-OLD, EXPLICIT-COLUMN REBUILD (migration 164 precedent)
-- ──────────────────────────────────────────────────────────────────────────
-- Each live table is renamed aside to `<table>_r11_old`, a new table is created with
-- the additive workspace_id column + FK CASCADE, and rows are copied back with an
-- EXPLICIT column list (never `SELECT *`) split into two INSERTs per table:
-- rows whose site_id maps to EXACTLY ONE workspace land in the rebuilt live table with
-- workspace_id populated; all other rows — zero-match ("unresolvable") AND >1-match
-- ("ambiguous") — land in a parallel `_orphaned` quarantine table (created fresh,
-- workspace_id always NULL there since it is by definition not 1:1-resolvable) and are
-- REMOVED from the live table's copy. They still exist under `<table>_r11_old` and
-- permanently in `<table>_orphaned`, so no row is ever dropped and the identity
-- COUNT(live) + COUNT(orphaned) == COUNT(_r11_old) holds for every table. The
-- `_r11_old` renamed-aside originals are NOT dropped here — a delayed-drop follow-up
-- migration removes them after staging verify + one backup retention window, per
-- docs/rules/destructive-migrations.md.

-- ── audit_snapshots rebuild ─────────────────────────────────────────────

ALTER TABLE audit_snapshots RENAME TO audit_snapshots_r11_old;

CREATE TABLE audit_snapshots (
  id TEXT PRIMARY KEY,
  site_id TEXT NOT NULL,
  workspace_id TEXT REFERENCES workspaces(id) ON DELETE CASCADE,
  site_name TEXT NOT NULL,
  created_at TEXT NOT NULL,
  audit TEXT NOT NULL,
  logo_url TEXT,
  action_items TEXT,
  previous_score INTEGER
);

-- Resolvable partition: join against the exactly-one-workspace-per-site_id set so
-- the copy can never emit >1 output row per input row (CV-1). See header note.
INSERT INTO audit_snapshots
  (id, site_id, workspace_id, site_name, created_at, audit, logo_url, action_items, previous_score)
SELECT
  o.id, o.site_id, w1.workspace_id, o.site_name, o.created_at, o.audit, o.logo_url, o.action_items, o.previous_score
FROM audit_snapshots_r11_old AS o
JOIN (
  SELECT webflow_site_id, MIN(id) AS workspace_id
  FROM workspaces
  WHERE webflow_site_id IS NOT NULL AND webflow_site_id != ''
  GROUP BY webflow_site_id HAVING COUNT(*) = 1
) AS w1 ON w1.webflow_site_id = o.site_id;

CREATE TABLE audit_snapshots_orphaned (
  id TEXT PRIMARY KEY,
  site_id TEXT NOT NULL,
  site_name TEXT NOT NULL,
  created_at TEXT NOT NULL,
  audit TEXT NOT NULL,
  logo_url TEXT,
  action_items TEXT,
  previous_score INTEGER,
  quarantined_at TEXT NOT NULL DEFAULT (datetime('now')),
  quarantine_reason TEXT NOT NULL DEFAULT 'site_id did not resolve to exactly one workspaces.webflow_site_id (zero-match or ambiguous >1 match) at migration 167'
);

-- Orphan partition: every row NOT in the exactly-one-workspace set — this catches
-- BOTH zero-match (unresolvable) AND >1-match (ambiguous) site_ids.
INSERT INTO audit_snapshots_orphaned
  (id, site_id, site_name, created_at, audit, logo_url, action_items, previous_score)
SELECT
  o.id, o.site_id, o.site_name, o.created_at, o.audit, o.logo_url, o.action_items, o.previous_score
FROM audit_snapshots_r11_old AS o
WHERE o.site_id NOT IN (
  SELECT webflow_site_id
  FROM workspaces
  WHERE webflow_site_id IS NOT NULL AND webflow_site_id != ''
  GROUP BY webflow_site_id HAVING COUNT(*) = 1
);

-- NOTE: `ALTER TABLE ... RENAME TO` carries the OLD table's index names along with it
-- (they now point at audit_snapshots_r11_old), so re-using the original index name here
-- would silently no-op under CREATE INDEX IF NOT EXISTS (name already taken by the
-- renamed-aside table) and leave the rebuilt live table completely unindexed on site_id.
-- New index names avoid the collision.
CREATE INDEX IF NOT EXISTS idx_audit_snapshots_site_v2 ON audit_snapshots(site_id, created_at);
CREATE INDEX IF NOT EXISTS idx_audit_snapshots_workspace ON audit_snapshots(workspace_id, created_at);

-- ── redirect_snapshots rebuild ──────────────────────────────────────────

ALTER TABLE redirect_snapshots RENAME TO redirect_snapshots_r11_old;

CREATE TABLE redirect_snapshots (
  id TEXT PRIMARY KEY,
  site_id TEXT NOT NULL,
  workspace_id TEXT REFERENCES workspaces(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL,
  result TEXT NOT NULL
);

-- Resolvable partition: exactly-one-workspace-per-site_id set (CV-1 — see header).
INSERT INTO redirect_snapshots
  (id, site_id, workspace_id, created_at, result)
SELECT
  o.id, o.site_id, w1.workspace_id, o.created_at, o.result
FROM redirect_snapshots_r11_old AS o
JOIN (
  SELECT webflow_site_id, MIN(id) AS workspace_id
  FROM workspaces
  WHERE webflow_site_id IS NOT NULL AND webflow_site_id != ''
  GROUP BY webflow_site_id HAVING COUNT(*) = 1
) AS w1 ON w1.webflow_site_id = o.site_id;

CREATE TABLE redirect_snapshots_orphaned (
  id TEXT PRIMARY KEY,
  site_id TEXT NOT NULL,
  created_at TEXT NOT NULL,
  result TEXT NOT NULL,
  quarantined_at TEXT NOT NULL DEFAULT (datetime('now')),
  quarantine_reason TEXT NOT NULL DEFAULT 'site_id did not resolve to exactly one workspaces.webflow_site_id (zero-match or ambiguous >1 match) at migration 167'
);

-- Orphan partition: zero-match AND >1-match (ambiguous) site_ids.
INSERT INTO redirect_snapshots_orphaned
  (id, site_id, created_at, result)
SELECT
  o.id, o.site_id, o.created_at, o.result
FROM redirect_snapshots_r11_old AS o
WHERE o.site_id NOT IN (
  SELECT webflow_site_id
  FROM workspaces
  WHERE webflow_site_id IS NOT NULL AND webflow_site_id != ''
  GROUP BY webflow_site_id HAVING COUNT(*) = 1
);

-- Same rename-carries-the-index-name collision as audit_snapshots above — new name.
CREATE INDEX IF NOT EXISTS idx_redirect_snapshots_site_v2 ON redirect_snapshots(site_id);
CREATE INDEX IF NOT EXISTS idx_redirect_snapshots_workspace ON redirect_snapshots(workspace_id);

-- ── performance_snapshots rebuild ───────────────────────────────────────
-- No id column on this table (PRIMARY KEY (sub, site_id)) — the orphan copy uses a
-- surrogate rowid-friendly PK since (sub, site_id) alone is sufficient to dedupe.

ALTER TABLE performance_snapshots RENAME TO performance_snapshots_r11_old;

CREATE TABLE performance_snapshots (
  sub TEXT NOT NULL,
  site_id TEXT NOT NULL,
  workspace_id TEXT REFERENCES workspaces(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL,
  result TEXT NOT NULL,
  PRIMARY KEY (sub, site_id)
);

-- Exact-1:1 resolution only (see header note): pagespeed-single's composite
-- `${webflowSiteId}_${pageKey}` site_id values and competitor's URL-derived keys
-- never equal a real workspaces.webflow_site_id, and an AMBIGUOUS site_id (>1
-- workspace) is likewise not resolved — all fall through to quarantine below rather
-- than being mis-attributed (prefix guess or arbitrary-workspace pick). The subquery
-- also guarantees the (sub, site_id) PK can never collide during this copy (CV-1).
INSERT INTO performance_snapshots
  (sub, site_id, workspace_id, created_at, result)
SELECT
  o.sub, o.site_id, w1.workspace_id, o.created_at, o.result
FROM performance_snapshots_r11_old AS o
JOIN (
  SELECT webflow_site_id, MIN(id) AS workspace_id
  FROM workspaces
  WHERE webflow_site_id IS NOT NULL AND webflow_site_id != ''
  GROUP BY webflow_site_id HAVING COUNT(*) = 1
) AS w1 ON w1.webflow_site_id = o.site_id;

CREATE TABLE performance_snapshots_orphaned (
  sub TEXT NOT NULL,
  site_id TEXT NOT NULL,
  created_at TEXT NOT NULL,
  result TEXT NOT NULL,
  quarantined_at TEXT NOT NULL DEFAULT (datetime('now')),
  quarantine_reason TEXT NOT NULL DEFAULT 'site_id did not resolve to exactly one workspaces.webflow_site_id (zero-match or ambiguous >1 match) at migration 167',
  PRIMARY KEY (sub, site_id)
);

-- Orphan partition: zero-match AND >1-match (ambiguous) site_ids.
INSERT INTO performance_snapshots_orphaned
  (sub, site_id, created_at, result)
SELECT
  o.sub, o.site_id, o.created_at, o.result
FROM performance_snapshots_r11_old AS o
WHERE o.site_id NOT IN (
  SELECT webflow_site_id
  FROM workspaces
  WHERE webflow_site_id IS NOT NULL AND webflow_site_id != ''
  GROUP BY webflow_site_id HAVING COUNT(*) = 1
);

CREATE INDEX IF NOT EXISTS idx_performance_snapshots_workspace ON performance_snapshots(workspace_id);

-- ── Delayed drop (NOT this migration) ───────────────────────────────────
-- audit_snapshots_r11_old, redirect_snapshots_r11_old, and
-- performance_snapshots_r11_old are intentionally left in place. A follow-up
-- migration drops them only after staging verify + one backup retention window has
-- elapsed, per docs/rules/destructive-migrations.md. Do not add DROP TABLE
-- statements to this file.
