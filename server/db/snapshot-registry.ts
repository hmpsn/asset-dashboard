/**
 * Snapshot table registry (Reconcile R11-T5, Task C1).
 *
 * A machine-readable census of every `*_snapshots` table in this codebase. Historically
 * these tables accreted ad hoc — some workspace-scoped with FK ON DELETE CASCADE from
 * day one, three legacy tables (`audit_snapshots`, `performance_snapshots`,
 * `redirect_snapshots`) keyed only on a Webflow `site_id` with no workspace linkage at
 * all. Migration 167 retrofitted those three with an additive, backfilled
 * `workspace_id` column (FK CASCADE), closing that gap — see
 * `server/db/migrations/167-audit-snapshots-workspace-id.sql` for the retrofit and its
 * orphan-quarantine handling.
 *
 * This registry exists so "is every snapshot table workspace-scoped?" is answerable by
 * code, not tribal knowledge. `tests/contract/snapshot-envelope-registry.test.ts` reads
 * `sqlite_master` for every `*_snapshots` table and asserts it is BOTH registered here
 * AND workspace-scoped — a new snapshot table that skips registration or skips
 * workspace_id fails that test immediately, rather than silently accumulating as a 15th
 * unscoped table the way the original three did.
 *
 * `*_orphaned` and `*_r11_old` tables (migration 167's quarantine copies and
 * renamed-aside originals) are deliberately NOT part of this registry — they are
 * migration bookkeeping, not live snapshot stores read by application code, and the
 * contract test's table-discovery regex excludes them explicitly.
 *
 * captureColumn: the column that records "when was this snapshot taken" — used by
 * time-series readers (charts, trend deltas) to order rows. This is NOT always
 * `created_at`; several tables use `snapshot_date`, `captured_at`, `date`, or
 * `computed_at` depending on when they were designed.
 *
 * writerModule: the single module owning INSERT/UPSERT for this table, expressed as a
 * repo-relative path from the project root (matches the convention used elsewhere in
 * this codebase for documentation cross-references, e.g. docs/rules/*.md file paths).
 */

export interface SnapshotTableDescriptor {
  /** SQLite table name, exactly as it appears in sqlite_master. */
  name: string;
  /**
   * True if the table carries a `workspace_id` column that identifies the owning
   * workspace. All 14 registered tables are `true` post-migration-167 — a `false` entry
   * here would mean the retrofit is incomplete for that table.
   */
  workspaceScoped: boolean;
  /**
   * True if `workspace_id` is enforced with `REFERENCES workspaces(id) ON DELETE
   * CASCADE` (verified via `PRAGMA foreign_key_list`). `workspace_metrics_snapshots` is
   * the sole exception in this codebase — it has a NOT NULL `workspace_id` column but no
   * FK constraint (migration 080 predates the FK-CASCADE convention and has not been
   * retrofitted; pruning already happens via the 90-day rolling retention sweep in
   * server/workspace-metrics-snapshots.ts, so an orphan window there is low-risk, but the
   * registry documents the gap rather than glossing over it).
   */
  hasForeignKeyCascade: boolean;
  /** Column that records when the snapshot was captured, for time-series ordering. */
  captureColumn: string;
  /** Repo-relative path to the module owning writes to this table. */
  writerModule: string;
  /** One-line human note — provenance, quirks, or the migration that last touched scoping. */
  note: string;
}

/**
 * The full 14-table snapshot census. Order is alphabetical by table name — this list
 * has no semantic ordering dependency, alphabetical just keeps diffs small when a new
 * entry is inserted.
 */
export const SNAPSHOT_TABLE_REGISTRY: readonly SnapshotTableDescriptor[] = [
  {
    name: 'audit_snapshots',
    workspaceScoped: true,
    hasForeignKeyCascade: true,
    captureColumn: 'created_at',
    writerModule: 'server/reports.ts',
    note: 'Legacy table retrofitted by migration 167. Still keyed by `site_id` (Webflow site id) for all live reads (server/reports.ts, server/intelligence/site-health-slice.ts) — workspace_id is additive for the registry contract and future workspace-scoped reads/deletes.',
  },
  {
    name: 'business_listing_snapshots',
    workspaceScoped: true,
    hasForeignKeyCascade: true,
    captureColumn: 'snapshot_date',
    writerModule: 'server/business-listings-store.ts',
    note: 'SEO Decision Engine P7 (migration 154). Time series of GBP health + reviews for owned + competitor listings.',
  },
  {
    name: 'competitor_snapshots',
    workspaceScoped: true,
    hasForeignKeyCascade: true,
    captureColumn: 'snapshot_date',
    writerModule: 'server/competitor-snapshot-store.ts',
    note: 'Migration 070. Per-competitor-domain keyword/traffic snapshots, written by the briefing cron.',
  },
  {
    name: 'ga4_conversion_snapshots',
    workspaceScoped: true,
    hasForeignKeyCascade: true,
    captureColumn: 'captured_at',
    writerModule: 'server/ga4-snapshots.ts',
    note: 'The Issue (Client) P0 (migration 146). Daily GA4 key-event conversion snapshots, modeled on roi_snapshots.',
  },
  {
    name: 'llm_mention_snapshots',
    workspaceScoped: true,
    hasForeignKeyCascade: true,
    captureColumn: 'snapshot_date',
    writerModule: 'server/llm-mentions-store.ts',
    note: 'SEO Decision Engine P8 (migration 155). AI-visibility (AEO) mention time series.',
  },
  {
    name: 'local_visibility_snapshots',
    workspaceScoped: true,
    hasForeignKeyCascade: true,
    captureColumn: 'captured_at',
    writerModule: 'server/domains/local-seo/snapshot-store.ts',
    note: 'Migration 096. Local-pack visibility per keyword/market; also FK-CASCADEs on market_id to local_seo_markets.',
  },
  {
    name: 'performance_snapshots',
    workspaceScoped: true,
    hasForeignKeyCascade: true,
    captureColumn: 'created_at',
    writerModule: 'server/performance-store.ts',
    note: 'Legacy table retrofitted by migration 167. `site_id` is an OVERLOADED composite key for some `sub` values (pagespeed-single: `${webflowSiteId}_${pageKey}`; competitor: a URL-derived key with no workspace at all) — rows whose site_id does not exactly match workspaces.webflow_site_id were quarantined to performance_snapshots_orphaned by migration 167, never deleted. Live reads remain keyed by (sub, site_id).',
  },
  {
    name: 'rank_snapshots',
    workspaceScoped: true,
    hasForeignKeyCascade: true,
    captureColumn: 'date',
    writerModule: 'server/rank-tracking.ts',
    note: 'Migration 003. GSC average position + clicks/impressions/ctr per (workspace_id, date). Parallel to, never conflated with, serp_snapshots (true SERP rank).',
  },
  {
    name: 'redirect_snapshots',
    workspaceScoped: true,
    hasForeignKeyCascade: true,
    captureColumn: 'created_at',
    writerModule: 'server/redirect-store.ts',
    note: 'Legacy table retrofitted by migration 167. Still keyed by `site_id` (Webflow site id) for all live reads (server/redirect-store.ts, server/intelligence/site-health-slice.ts) — workspace_id is additive.',
  },
  {
    name: 'roi_snapshots',
    workspaceScoped: true,
    hasForeignKeyCascade: true,
    captureColumn: 'computed_at',
    writerModule: 'server/roi.ts',
    note: 'Organic-traffic-value time series, one row per workspace per computation.',
  },
  {
    name: 'schema_snapshots',
    workspaceScoped: true,
    hasForeignKeyCascade: true,
    captureColumn: 'created_at',
    writerModule: 'server/schema-store.ts',
    note: 'Migration 004/082. Carries BOTH a legacy `site_id` column and `workspace_id` (FK CASCADE) — already modern by the R11-T5 definition despite the retained site_id column.',
  },
  {
    name: 'serp_snapshots',
    workspaceScoped: true,
    hasForeignKeyCascade: true,
    captureColumn: 'date',
    writerModule: 'server/serp-snapshots-store.ts',
    note: 'SEO Decision Engine P6 (migration 153). True national SERP rank + SERP-feature time series, keyed (workspace_id, date, query). Parallel to, never conflated with, rank_snapshots.',
  },
  {
    name: 'serp_snapshots_v2_compat',
    workspaceScoped: true,
    hasForeignKeyCascade: true,
    captureColumn: 'date',
    writerModule: 'server/serp-snapshots-store.ts',
    note: 'K3b additive Unicode-identity sidecar (migration 183). Retains one coherent full SERP observation per raw query variant while serp_snapshots remains the v1 rollback/legacy-alias store.',
  },
  {
    name: 'workspace_metrics_snapshots',
    workspaceScoped: true,
    hasForeignKeyCascade: false,
    captureColumn: 'snapshot_date',
    writerModule: 'server/workspace-metrics-snapshots.ts',
    note: 'Migration 080. Weekly metrics snapshots for briefing "best week since X" anchors. workspace_id is NOT NULL but has no FK CASCADE constraint (predates the FK-CASCADE convention); 90-day rolling retention is enforced at write time by pruneOld() instead.',
  },
] as const;

/** Fast lookup by table name. */
const REGISTRY_BY_NAME: ReadonlyMap<string, SnapshotTableDescriptor> = new Map(
  SNAPSHOT_TABLE_REGISTRY.map(entry => [entry.name, entry]),
);

/** Returns the descriptor for a registered snapshot table, or undefined if unregistered. */
export function getSnapshotTableDescriptor(tableName: string): SnapshotTableDescriptor | undefined {
  return REGISTRY_BY_NAME.get(tableName);
}

/** Every registered table name, for quick membership checks. */
export const SNAPSHOT_TABLE_NAMES: ReadonlySet<string> = new Set(
  SNAPSHOT_TABLE_REGISTRY.map(entry => entry.name),
);
