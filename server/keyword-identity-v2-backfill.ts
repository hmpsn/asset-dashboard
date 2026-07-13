import { createHash } from 'node:crypto';

import {
  KEYWORD_IDENTITY_ALIAS_KINDS,
  KEYWORD_IDENTITY_BACKFILL_MODES,
  KEYWORD_IDENTITY_STORES,
  KEYWORD_IDENTITY_VERSIONS,
  type KeywordIdentityBackfillError,
  type KeywordIdentityBackfillReport,
  type KeywordIdentityStore,
  type KeywordIdentityStoreReport,
  type RunKeywordIdentityBackfillOptions,
} from '../shared/types/keyword-identity.js';
import { keywordIdentityKeyV1, keywordIdentityKeyV2 } from '../shared/keyword-normalization.js';
import db from './db/index.js';
import { createStmtCache } from './db/stmt-cache.js';

const MIGRATION_HEAD = '183-keyword-identity-v2-compat.sql';
const MAX_ERROR_SAMPLES = 5;

interface TrackedLegacyRow {
  workspace_id: string;
  normalized_query: string;
  query: string;
  pinned: number;
  added_at: string;
  source: string | null;
  status: string | null;
  page_path: string | null;
  page_title: string | null;
  strategy_generated_at: string | null;
  last_strategy_seen_at: string | null;
  intent: string | null;
  volume: number | null;
  difficulty: number | null;
  cpc: number | null;
  authority_posture: string | null;
  baseline_position: number | null;
  baseline_clicks: number | null;
  baseline_impressions: number | null;
  replaced_by: string | null;
  deprecated_at: string | null;
  source_page_id: string | null;
  source_gap_key: string | null;
  strategy_owned: number | null;
  sort_order: number | null;
}

interface TrackedCompatRow extends TrackedLegacyRow {
  normalized_query_v2: string;
  normalized_query_v1: string;
  source_gap_key_v1: string | null;
  source_gap_key_v2: string | null;
  is_canonical: number;
  write_order: number;
}

interface SiteLegacyRow {
  workspace_id: string;
  normalized_query: string;
  keyword: string;
  volume: number | null;
  difficulty: number | null;
}

interface SiteCompatRow {
  workspace_id: string;
  normalized_query_v2: string;
  normalized_query_v1: string;
  keyword: string;
  volume: number | null;
  difficulty: number | null;
  is_canonical: number;
  write_order: number;
}

interface LocalVisibilityRow {
  id: string;
  workspace_id: string;
  keyword: string;
  normalized_keyword: string;
  normalized_keyword_v2: string | null;
}

interface SerpCompatCensusRow {
  date: string;
  query_v2: string;
  query_v1: string;
  raw_query: string;
  observed_at: string;
  position: number | null;
  matched_url: string | null;
  features: string;
  ai_overview_cited: number | null;
  ai_overview_present: number | null;
}

function emptyStoreReport(): KeywordIdentityStoreReport {
  return {
    scanned: 0,
    inserted: 0,
    updated: 0,
    alreadyPresent: 0,
    aliasesRetained: 0,
    aliasesByKind: {
      [KEYWORD_IDENTITY_ALIAS_KINDS.RAW_VARIANT]: 0,
      [KEYWORD_IDENTITY_ALIAS_KINDS.LEGACY_V1_ONLY]: 0,
      [KEYWORD_IDENTITY_ALIAS_KINDS.ROLLBACK_PROJECTION]: 0,
      [KEYWORD_IDENTITY_ALIAS_KINDS.V2_ONLY]: 0,
    },
    equivalentCollisions: 0,
    conflictingCollisions: 0,
    skipped: 0,
    errors: 0,
    provenanceUnresolved: 0,
  };
}

function emptyStores(): Record<KeywordIdentityStore, KeywordIdentityStoreReport> {
  return Object.fromEntries(KEYWORD_IDENTITY_STORES.map(store => [store, emptyStoreReport()])) as Record<
    KeywordIdentityStore,
    KeywordIdentityStoreReport
  >;
}

function addStoreReport(target: KeywordIdentityStoreReport, source: KeywordIdentityStoreReport): void {
  target.scanned += source.scanned;
  target.inserted += source.inserted;
  target.updated += source.updated;
  target.alreadyPresent += source.alreadyPresent;
  target.aliasesRetained += source.aliasesRetained;
  target.equivalentCollisions += source.equivalentCollisions;
  target.conflictingCollisions += source.conflictingCollisions;
  target.skipped += source.skipped;
  target.errors += source.errors;
  target.provenanceUnresolved += source.provenanceUnresolved;
  for (const kind of Object.values(KEYWORD_IDENTITY_ALIAS_KINDS)) {
    target.aliasesByKind[kind] += source.aliasesByKind[kind];
  }
}

function totalsFor(stores: Record<KeywordIdentityStore, KeywordIdentityStoreReport>): KeywordIdentityStoreReport {
  const totals = emptyStoreReport();
  for (const store of KEYWORD_IDENTITY_STORES) addStoreReport(totals, stores[store]);
  return totals;
}

/**
 * Reporting semantics:
 * - inserted/updated are additive-v2 mutations this invocation would perform
 *   (or performed in APPLY). Whole v1 projection rebuilds are intentionally not
 *   counted as one misleading "updated row".
 * - scanned is the number of physical source/compatibility rows inspected.
 * - alreadyPresent counts source rows already represented by v2 plus existing
 *   authoritative decision/evidence/cache rows discovered by the census.
 * - alias/collision fields are a post-run compatibility-state census over the
 *   simulated result, so they intentionally remain nonzero on an idempotent run.
 *   Alias kinds are roles and may overlap (for example a v2-only raw variant).
 */
function addAlias(
  report: KeywordIdentityStoreReport,
  kind: keyof KeywordIdentityStoreReport['aliasesByKind'],
  count: number,
): void {
  report.aliasesByKind[kind] += count;
  report.aliasesRetained += count;
}

function rawBinaryCompare(a: string, b: string): number {
  return Buffer.compare(Buffer.from(a, 'utf8'), Buffer.from(b, 'utf8'));
}

function stableRowRefHash(store: KeywordIdentityStore, workspaceId: string | undefined, rowRef: string): string {
  return createHash('sha256')
    .update(`${store}\0${workspaceId ?? ''}\0${rowRef}`, 'utf8')
    .digest('hex')
    .slice(0, 24);
}

function recordError(
  errors: KeywordIdentityBackfillError[],
  store: KeywordIdentityStore,
  code: string,
  workspaceId: string | undefined,
  rowRef: string,
): void {
  let entry = errors.find(error => error.store === store && error.code === code);
  if (!entry) {
    entry = { store, code, count: 0, samples: [] };
    errors.push(entry);
  }
  entry.count++;
  if (entry.samples.length < MAX_ERROR_SAMPLES) {
    entry.samples.push({ workspaceId, rowRefHash: stableRowRefHash(store, workspaceId, rowRef) });
  }
}

const STATUS_PRIORITY: Record<string, number> = {
  active: 5,
  paused: 4,
  replaced: 3,
  deprecated: 2,
};

const SOURCE_PRIORITY: Record<string, number> = {
  client_requested: 7,
  manual: 6,
  content_gap: 5,
  recommendation: 4,
  strategy_primary: 3,
  strategy_site_keyword: 2,
  unknown: 1,
};

function validTime(value: string | null): number | null {
  if (!value) return null;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function compareLatest(a: string | null, b: string | null): number {
  const at = validTime(a);
  const bt = validTime(b);
  if (at === null) return bt === null ? 0 : 1;
  if (bt === null) return -1;
  return bt - at;
}

function compareTracked(a: TrackedCompatRow, b: TrackedCompatRow): number {
  if (a.pinned !== b.pinned) return b.pinned - a.pinned;
  const status = (STATUS_PRIORITY[b.status ?? ''] ?? 0) - (STATUS_PRIORITY[a.status ?? ''] ?? 0);
  if (status !== 0) return status;
  const source = (SOURCE_PRIORITY[b.source ?? ''] ?? 0) - (SOURCE_PRIORITY[a.source ?? ''] ?? 0);
  if (source !== 0) return source;
  const seen = compareLatest(a.last_strategy_seen_at, b.last_strategy_seen_at);
  if (seen !== 0) return seen;
  const generated = compareLatest(a.strategy_generated_at, b.strategy_generated_at);
  if (generated !== 0) return generated;
  const addedA = validTime(a.added_at);
  const addedB = validTime(b.added_at);
  if (addedA !== addedB) {
    if (addedA === null) return 1;
    if (addedB === null) return -1;
    return addedA - addedB;
  }
  if (a.sort_order !== b.sort_order) {
    if (a.sort_order === null) return 1;
    if (b.sort_order === null) return -1;
    return a.sort_order - b.sort_order;
  }
  return rawBinaryCompare(a.query, b.query);
}

function compareSite(a: SiteCompatRow, b: SiteCompatRow): number {
  const populatedA = Number(a.volume !== null) + Number(a.difficulty !== null);
  const populatedB = Number(b.volume !== null) + Number(b.difficulty !== null);
  if (populatedA !== populatedB) return populatedB - populatedA;
  const volumeA = a.volume ?? Number.NEGATIVE_INFINITY;
  const volumeB = b.volume ?? Number.NEGATIVE_INFINITY;
  if (volumeA !== volumeB) return volumeB - volumeA;
  const difficultyA = a.difficulty ?? Number.NEGATIVE_INFINITY;
  const difficultyB = b.difficulty ?? Number.NEGATIVE_INFINITY;
  if (difficultyA !== difficultyB) return difficultyB - difficultyA;
  return rawBinaryCompare(a.keyword, b.keyword);
}

function groupByV2<T extends { normalized_query_v2: string }>(rows: T[]): Map<string, T[]> {
  const groups = new Map<string, T[]>();
  for (const row of rows) {
    const group = groups.get(row.normalized_query_v2) ?? [];
    group.push(row);
    groups.set(row.normalized_query_v2, group);
  }
  return groups;
}

const stmts = createStmtCache(() => ({
  workspaceIds: db.prepare('SELECT id FROM workspaces ORDER BY id'),
  workspaceExists: db.prepare<[workspaceId: string]>('SELECT 1 AS present FROM workspaces WHERE id = ?'),
  trackedLegacy: db.prepare<[workspaceId: string]>('SELECT * FROM tracked_keywords WHERE workspace_id = ?'),
  trackedCompat: db.prepare<[workspaceId: string]>('SELECT * FROM tracked_keywords_v2_compat WHERE workspace_id = ?'),
  trackedMaxOrder: db.prepare<[workspaceId: string]>(
    'SELECT COALESCE(MAX(write_order), 0) AS value FROM tracked_keywords_v2_compat WHERE workspace_id = ?',
  ),
  insertTrackedCompat: db.prepare(`
    INSERT INTO tracked_keywords_v2_compat (
      workspace_id, normalized_query_v2, normalized_query_v1, query, pinned, added_at,
      source, status, page_path, page_title, strategy_generated_at, last_strategy_seen_at,
      intent, volume, difficulty, cpc, authority_posture, baseline_position,
      baseline_clicks, baseline_impressions, replaced_by, deprecated_at, source_page_id,
      source_gap_key_v1, source_gap_key_v2, strategy_owned, sort_order, is_canonical, write_order
    ) VALUES (
      @workspace_id, @normalized_query_v2, @normalized_query_v1, @query, @pinned, @added_at,
      @source, @status, @page_path, @page_title, @strategy_generated_at, @last_strategy_seen_at,
      @intent, @volume, @difficulty, @cpc, @authority_posture, @baseline_position,
      @baseline_clicks, @baseline_impressions, @replaced_by, @deprecated_at, @source_page_id,
      @source_gap_key_v1, @source_gap_key_v2, @strategy_owned, @sort_order, @is_canonical, @write_order
    )
  `),
  promoteTracked: db.prepare<[workspaceId: string, v2: string, raw: string]>(`
    UPDATE tracked_keywords_v2_compat SET is_canonical = 1
     WHERE workspace_id = ? AND normalized_query_v2 = ? AND query = ? AND is_canonical = 0
  `),
  updateTrackedProvenance: db.prepare<[v2: string, workspaceId: string, identityV2: string, raw: string]>(`
    UPDATE tracked_keywords_v2_compat SET source_gap_key_v2 = ?
     WHERE workspace_id = ? AND normalized_query_v2 = ? AND query = ? AND source_gap_key_v2 IS NULL
  `),
  deleteTrackedLegacy: db.prepare<[workspaceId: string]>('DELETE FROM tracked_keywords WHERE workspace_id = ?'),
  insertTrackedLegacy: db.prepare(`
    INSERT INTO tracked_keywords (
      workspace_id, normalized_query, query, pinned, added_at, source, status, page_path,
      page_title, strategy_generated_at, last_strategy_seen_at, intent, volume, difficulty,
      cpc, authority_posture, baseline_position, baseline_clicks, baseline_impressions,
      replaced_by, deprecated_at, source_page_id, source_gap_key, strategy_owned, sort_order
    ) VALUES (
      @workspace_id, @normalized_query, @query, @pinned, @added_at, @source, @status, @page_path,
      @page_title, @strategy_generated_at, @last_strategy_seen_at, @intent, @volume, @difficulty,
      @cpc, @authority_posture, @baseline_position, @baseline_clicks, @baseline_impressions,
      @replaced_by, @deprecated_at, @source_page_id, @source_gap_key, @strategy_owned, @sort_order
    )
  `),
  siteLegacy: db.prepare<[workspaceId: string]>('SELECT * FROM site_keyword_metrics WHERE workspace_id = ?'),
  siteCompat: db.prepare<[workspaceId: string]>('SELECT * FROM site_keyword_metrics_v2_compat WHERE workspace_id = ?'),
  siteMaxOrder: db.prepare<[workspaceId: string]>(
    'SELECT COALESCE(MAX(write_order), 0) AS value FROM site_keyword_metrics_v2_compat WHERE workspace_id = ?',
  ),
  insertSiteCompat: db.prepare(`
    INSERT INTO site_keyword_metrics_v2_compat (
      workspace_id, normalized_query_v2, normalized_query_v1, keyword,
      volume, difficulty, is_canonical, write_order
    ) VALUES (
      @workspace_id, @normalized_query_v2, @normalized_query_v1, @keyword,
      @volume, @difficulty, @is_canonical, @write_order
    )
  `),
  promoteSite: db.prepare<[workspaceId: string, v2: string, raw: string]>(`
    UPDATE site_keyword_metrics_v2_compat SET is_canonical = 1
     WHERE workspace_id = ? AND normalized_query_v2 = ? AND keyword = ? AND is_canonical = 0
  `),
  deleteSiteLegacy: db.prepare<[workspaceId: string]>('DELETE FROM site_keyword_metrics WHERE workspace_id = ?'),
  insertSiteLegacy: db.prepare(`
    INSERT INTO site_keyword_metrics (workspace_id, normalized_query, keyword, volume, difficulty)
    VALUES (@workspace_id, @normalized_query, @keyword, @volume, @difficulty)
  `),
  localRows: db.prepare<[workspaceId: string]>(`
    SELECT id, workspace_id, keyword, normalized_keyword, normalized_keyword_v2
      FROM local_visibility_snapshots WHERE workspace_id = ? ORDER BY id
  `),
  updateLocalV2: db.prepare<[v2: string, id: string, workspaceId: string]>(`
    UPDATE local_visibility_snapshots SET normalized_keyword_v2 = ? WHERE id = ? AND workspace_id = ?
  `),
  feedbackLegacyCount: db.prepare<[archiveWorkspaceId: string, mainWorkspaceId: string]>(`
    SELECT (
      SELECT COUNT(*) FROM keyword_feedback_v1_legacy_aliases WHERE workspace_id = ?
    ) + (
      SELECT COUNT(*) FROM keyword_feedback f
       WHERE f.workspace_id = ? AND NOT EXISTS (
         SELECT 1 FROM keyword_feedback_v1_projection_keys p
          WHERE p.workspace_id = f.workspace_id AND p.keyword_v1 = f.keyword
       )
    ) AS value
  `),
  feedbackProjectionCount: db.prepare<[workspaceId: string]>(
    'SELECT COUNT(*) AS value FROM keyword_feedback_v1_projection_keys WHERE workspace_id = ?',
  ),
  feedbackCompatCount: db.prepare<[workspaceId: string]>(
    'SELECT COUNT(*) AS value FROM keyword_feedback_v2_compat WHERE workspace_id = ?',
  ),
  feedbackV2OnlyCount: db.prepare<[workspaceId: string]>(
    "SELECT COUNT(*) AS value FROM keyword_feedback_v2_compat WHERE workspace_id = ? AND keyword_v1 = ''",
  ),
  feedbackRawVariantCount: db.prepare<[workspaceId: string]>(`
    SELECT COALESCE(SUM(count - 1), 0) AS value FROM (
      SELECT COUNT(*) AS count FROM keyword_feedback_v2_aliases
       WHERE workspace_id = ? GROUP BY keyword_v2 HAVING COUNT(*) > 1
    )
  `),
  feedbackRawCollisionCount: db.prepare<[workspaceId: string]>(`
    SELECT COUNT(*) AS value FROM (
      SELECT keyword_v2 FROM keyword_feedback_v2_aliases
       WHERE workspace_id = ? GROUP BY keyword_v2 HAVING COUNT(*) > 1
    )
  `),
  feedbackAliasRowCount: db.prepare<[workspaceId: string]>(
    'SELECT COUNT(*) AS value FROM keyword_feedback_v2_aliases WHERE workspace_id = ?',
  ),
  voteLegacyCount: db.prepare<[archiveWorkspaceId: string, mainWorkspaceId: string]>(`
    SELECT (
      SELECT COUNT(*) FROM content_gap_votes_v1_legacy_aliases WHERE workspace_id = ?
    ) + (
      SELECT COUNT(*) FROM content_gap_votes v
       WHERE v.workspace_id = ? AND NOT EXISTS (
         SELECT 1 FROM content_gap_votes_v1_projection_keys p
          WHERE p.workspace_id = v.workspace_id AND p.keyword_v1 = v.keyword
       )
    ) AS value
  `),
  voteProjectionCount: db.prepare<[workspaceId: string]>(
    'SELECT COUNT(*) AS value FROM content_gap_votes_v1_projection_keys WHERE workspace_id = ?',
  ),
  voteCompatCount: db.prepare<[workspaceId: string]>(
    'SELECT COUNT(*) AS value FROM content_gap_votes_v2_compat WHERE workspace_id = ?',
  ),
  voteV2OnlyCount: db.prepare<[workspaceId: string]>(
    "SELECT COUNT(*) AS value FROM content_gap_votes_v2_compat WHERE workspace_id = ? AND keyword_v1 = ''",
  ),
  voteRawVariantCount: db.prepare<[workspaceId: string]>(`
    SELECT COALESCE(SUM(count - 1), 0) AS value FROM (
      SELECT COUNT(*) AS count FROM content_gap_vote_v2_aliases
       WHERE workspace_id = ? GROUP BY keyword_v2 HAVING COUNT(*) > 1
    )
  `),
  voteRawCollisionCount: db.prepare<[workspaceId: string]>(`
    SELECT COUNT(*) AS value FROM (
      SELECT keyword_v2 FROM content_gap_vote_v2_aliases
       WHERE workspace_id = ? GROUP BY keyword_v2 HAVING COUNT(*) > 1
    )
  `),
  voteAliasRowCount: db.prepare<[workspaceId: string]>(
    'SELECT COUNT(*) AS value FROM content_gap_vote_v2_aliases WHERE workspace_id = ?',
  ),
  serpLegacyCount: db.prepare<[archiveWorkspaceId: string, mainWorkspaceId: string]>(`
    SELECT (
      SELECT COUNT(*) FROM serp_snapshot_v1_legacy_aliases WHERE workspace_id = ?
    ) + (
      SELECT COUNT(*) FROM serp_snapshots s
       WHERE s.workspace_id = ? AND NOT EXISTS (
         SELECT 1 FROM serp_snapshot_v1_projection_keys p
          WHERE p.workspace_id = s.workspace_id AND p.date = s.date AND p.query_v1 = s.query
       )
    ) AS value
  `),
  serpProjectionCount: db.prepare<[workspaceId: string]>(
    'SELECT COUNT(*) AS value FROM serp_snapshot_v1_projection_keys WHERE workspace_id = ?',
  ),
  serpCompatRows: db.prepare<[workspaceId: string]>(`
    SELECT date, query_v2, query_v1, raw_query, observed_at, position, matched_url,
           features, ai_overview_cited, ai_overview_present
      FROM serp_snapshots_v2_compat WHERE workspace_id = ?
  `),
  metricsLegacyCount: db.prepare('SELECT COUNT(*) AS value FROM keyword_metrics_cache'),
  metricsV2Count: db.prepare('SELECT COUNT(*) AS value FROM keyword_metrics_cache_v2'),
  migrationHead: db.prepare('SELECT name FROM _migrations ORDER BY name DESC LIMIT 1'),
}));

function trackedCandidate(row: TrackedLegacyRow): TrackedCompatRow | null {
  const raw = row.query.trim();
  const v2 = keywordIdentityKeyV2(raw);
  if (!raw || !v2) return null;
  const v1 = keywordIdentityKeyV1(raw);
  const sourceGapV2 = row.source_gap_key && row.source_gap_key === v1 ? v2 : null;
  return {
    ...row,
    query: raw,
    normalized_query_v2: v2,
    normalized_query_v1: v1,
    source_gap_key_v1: row.source_gap_key,
    source_gap_key_v2: sourceGapV2,
    is_canonical: 0,
    write_order: 0,
  };
}

function siteCandidate(row: SiteLegacyRow): SiteCompatRow | null {
  const raw = row.keyword.trim();
  const v2 = keywordIdentityKeyV2(raw);
  if (!raw || !v2) return null;
  return {
    ...row,
    keyword: raw,
    normalized_query_v2: v2,
    normalized_query_v1: keywordIdentityKeyV1(raw),
    is_canonical: 0,
    write_order: 0,
  };
}

function trackedCollisionPayload(row: TrackedCompatRow): string {
  return JSON.stringify({
    pinned: row.pinned,
    added_at: row.added_at,
    source: row.source,
    status: row.status,
    page_path: row.page_path,
    page_title: row.page_title,
    strategy_generated_at: row.strategy_generated_at,
    last_strategy_seen_at: row.last_strategy_seen_at,
    intent: row.intent,
    volume: row.volume,
    difficulty: row.difficulty,
    cpc: row.cpc,
    authority_posture: row.authority_posture,
    baseline_position: row.baseline_position,
    baseline_clicks: row.baseline_clicks,
    baseline_impressions: row.baseline_impressions,
    replaced_by: row.replaced_by,
    deprecated_at: row.deprecated_at,
    source_page_id: row.source_page_id,
    source_gap_key_v1: row.source_gap_key_v1,
    source_gap_key_v2: row.source_gap_key_v2,
    strategy_owned: row.strategy_owned,
    sort_order: row.sort_order,
  });
}

function siteCollisionPayload(row: SiteCompatRow): string {
  return JSON.stringify({ volume: row.volume, difficulty: row.difficulty });
}

function countCollisions<T extends { normalized_query_v2: string; normalized_query_v1: string }>(
  rows: T[],
  report: KeywordIdentityStoreReport,
  payload: (row: T) => string,
): void {
  for (const group of groupByV2(rows).values()) {
    for (const row of group) {
      if (!row.normalized_query_v1) {
        addAlias(report, KEYWORD_IDENTITY_ALIAS_KINDS.V2_ONLY, 1);
      }
    }
    if (group.length < 2) continue;
    const aliases = group.length - 1;
    addAlias(report, KEYWORD_IDENTITY_ALIAS_KINDS.RAW_VARIANT, aliases);
    const payloads = new Set(group.map(payload));
    if (payloads.size === 1) report.equivalentCollisions++;
    else report.conflictingCollisions++;
  }
}

function trackedProjection(row: TrackedCompatRow): TrackedLegacyRow {
  return {
    workspace_id: row.workspace_id,
    normalized_query: row.normalized_query_v1,
    query: row.query,
    pinned: row.pinned,
    added_at: row.added_at,
    source: row.source,
    status: row.status,
    page_path: row.page_path,
    page_title: row.page_title,
    strategy_generated_at: row.strategy_generated_at,
    last_strategy_seen_at: row.last_strategy_seen_at,
    intent: row.intent,
    volume: row.volume,
    difficulty: row.difficulty,
    cpc: row.cpc,
    authority_posture: row.authority_posture,
    baseline_position: row.baseline_position,
    baseline_clicks: row.baseline_clicks,
    baseline_impressions: row.baseline_impressions,
    replaced_by: row.replaced_by,
    deprecated_at: row.deprecated_at,
    source_page_id: row.source_page_id,
    source_gap_key: row.source_gap_key_v1,
    strategy_owned: row.strategy_owned,
    sort_order: row.sort_order,
  };
}

function siteProjection(row: SiteCompatRow): SiteLegacyRow {
  return {
    workspace_id: row.workspace_id,
    normalized_query: row.normalized_query_v1,
    keyword: row.keyword,
    volume: row.volume,
    difficulty: row.difficulty,
  };
}

function stableRows(rows: unknown[]): string {
  return JSON.stringify(rows);
}

function desiredTrackedProjection(rows: TrackedCompatRow[]): TrackedLegacyRow[] {
  const winners = new Map<string, TrackedCompatRow>();
  for (const row of rows.filter(item => item.is_canonical === 1 && item.normalized_query_v1)) {
    const existing = winners.get(row.normalized_query_v1);
    if (!existing || row.write_order > existing.write_order
      || (row.write_order === existing.write_order && compareTracked(row, existing) < 0)) {
      winners.set(row.normalized_query_v1, row);
    }
  }
  return [...winners.values()]
    .sort((a, b) => a.normalized_query_v1.localeCompare(b.normalized_query_v1))
    .map(trackedProjection);
}

function desiredSiteProjection(rows: SiteCompatRow[]): SiteLegacyRow[] {
  const winners = new Map<string, SiteCompatRow>();
  for (const row of rows.filter(item => item.is_canonical === 1 && item.normalized_query_v1)) {
    const existing = winners.get(row.normalized_query_v1);
    if (!existing || row.write_order > existing.write_order
      || (row.write_order === existing.write_order && compareSite(row, existing) < 0)) {
      winners.set(row.normalized_query_v1, row);
    }
  }
  return [...winners.values()]
    .sort((a, b) => a.normalized_query_v1.localeCompare(b.normalized_query_v1))
    .map(siteProjection);
}

function normalizeTrackedLegacyForComparison(rows: TrackedLegacyRow[]): TrackedLegacyRow[] {
  return [...rows].sort((a, b) => a.normalized_query.localeCompare(b.normalized_query));
}

function normalizeSiteLegacyForComparison(rows: SiteLegacyRow[]): SiteLegacyRow[] {
  return [...rows].sort((a, b) => a.normalized_query.localeCompare(b.normalized_query));
}

function backfillTracked(
  workspaceId: string,
  apply: boolean,
  report: KeywordIdentityStoreReport,
): void {
  const legacy = stmts().trackedLegacy.all(workspaceId) as TrackedLegacyRow[];
  const existing = stmts().trackedCompat.all(workspaceId) as TrackedCompatRow[];
  report.scanned += legacy.length + existing.length;

  const candidates: TrackedCompatRow[] = [];
  for (const row of legacy) {
    const candidate = trackedCandidate(row);
    if (!candidate) {
      report.skipped++;
      continue;
    }
    if (row.source_gap_key && row.source_gap_key !== candidate.normalized_query_v1) {
      report.provenanceUnresolved++;
    }
    candidates.push(candidate);
  }
  const exact = new Map(existing.map(row => [`${row.normalized_query_v2}\0${row.query}`, row]));
  const simulated = existing.map(row => ({ ...row }));
  const missing: TrackedCompatRow[] = [];
  for (const candidate of candidates) {
    const key = `${candidate.normalized_query_v2}\0${candidate.query}`;
    const present = exact.get(key);
    if (!present) {
      missing.push(candidate);
      continue;
    }
    report.alreadyPresent++;
    if (!present.source_gap_key_v2 && candidate.source_gap_key_v2) {
      report.updated++;
      const simulatedRow = simulated.find(row => row.normalized_query_v2 === present.normalized_query_v2 && row.query === present.query);
      if (simulatedRow) simulatedRow.source_gap_key_v2 = candidate.source_gap_key_v2;
      if (apply) {
        stmts().updateTrackedProvenance.run(
          candidate.source_gap_key_v2,
          workspaceId,
          candidate.normalized_query_v2,
          candidate.query,
        );
      }
    }
  }

  const winnerByV2 = new Map<string, string>();
  const sourceByV2 = groupByV2([...existing, ...missing]);
  for (const [v2, group] of sourceByV2) {
    const retained = group.find(row => row.is_canonical === 1);
    winnerByV2.set(v2, retained?.query ?? [...group].sort(compareTracked)[0].query);
  }

  let writeOrder = (stmts().trackedMaxOrder.get(workspaceId) as { value: number }).value;
  const orderedMissing = [...groupByV2(missing).entries()]
    .map(([v2, rows]) => ({
      v2,
      groupV1: [...rows].sort((a, b) => rawBinaryCompare(a.query, b.query))[0].normalized_query_v1,
      rows: [...rows].sort(compareTracked),
    }))
    .sort((a, b) => rawBinaryCompare(a.groupV1, b.groupV1) || rawBinaryCompare(a.v2, b.v2))
    .flatMap(group => group.rows);
  for (const row of orderedMissing) {
    row.write_order = ++writeOrder;
    row.is_canonical = winnerByV2.get(row.normalized_query_v2) === row.query ? 1 : 0;
    report.inserted++;
    simulated.push({ ...row });
    if (apply) stmts().insertTrackedCompat.run(row);
  }

  for (const [v2, winnerRaw] of winnerByV2) {
    const winner = simulated.find(row => row.normalized_query_v2 === v2 && row.query === winnerRaw);
    if (!winner || winner.is_canonical === 1) continue;
    winner.is_canonical = 1;
    report.updated++;
    if (apply) stmts().promoteTracked.run(workspaceId, v2, winnerRaw);
  }

  const desired = desiredTrackedProjection(simulated);
  countCollisions(simulated, report, trackedCollisionPayload);
  addAlias(report, KEYWORD_IDENTITY_ALIAS_KINDS.ROLLBACK_PROJECTION, desired.length);
  const current = normalizeTrackedLegacyForComparison(legacy);
  if (stableRows(current) !== stableRows(desired)) {
    if (apply) {
      stmts().deleteTrackedLegacy.run(workspaceId);
      for (const row of desired) stmts().insertTrackedLegacy.run(row);
    }
  }
}

function backfillSite(
  workspaceId: string,
  apply: boolean,
  report: KeywordIdentityStoreReport,
): void {
  const legacy = stmts().siteLegacy.all(workspaceId) as SiteLegacyRow[];
  const existing = stmts().siteCompat.all(workspaceId) as SiteCompatRow[];
  report.scanned += legacy.length + existing.length;
  const candidates: SiteCompatRow[] = [];
  for (const row of legacy) {
    const candidate = siteCandidate(row);
    if (!candidate) report.skipped++;
    else candidates.push(candidate);
  }
  const exact = new Set(existing.map(row => `${row.normalized_query_v2}\0${row.keyword}`));
  const missing = candidates.filter(row => {
    if (!exact.has(`${row.normalized_query_v2}\0${row.keyword}`)) return true;
    report.alreadyPresent++;
    return false;
  });
  const simulated = existing.map(row => ({ ...row }));
  const winnerByV2 = new Map<string, string>();
  for (const [v2, group] of groupByV2([...existing, ...missing])) {
    const retained = group.find(row => row.is_canonical === 1);
    winnerByV2.set(v2, retained?.keyword ?? [...group].sort(compareSite)[0].keyword);
  }

  let writeOrder = (stmts().siteMaxOrder.get(workspaceId) as { value: number }).value;
  const orderedMissing = [...groupByV2(missing).entries()]
    .map(([v2, rows]) => ({
      v2,
      groupV1: [...rows].sort((a, b) => rawBinaryCompare(a.keyword, b.keyword))[0].normalized_query_v1,
      rows: [...rows].sort(compareSite),
    }))
    .sort((a, b) => rawBinaryCompare(a.groupV1, b.groupV1) || rawBinaryCompare(a.v2, b.v2))
    .flatMap(group => group.rows);
  for (const row of orderedMissing) {
    row.write_order = ++writeOrder;
    row.is_canonical = winnerByV2.get(row.normalized_query_v2) === row.keyword ? 1 : 0;
    report.inserted++;
    simulated.push({ ...row });
    if (apply) stmts().insertSiteCompat.run(row);
  }
  for (const [v2, winnerRaw] of winnerByV2) {
    const winner = simulated.find(row => row.normalized_query_v2 === v2 && row.keyword === winnerRaw);
    if (!winner || winner.is_canonical === 1) continue;
    winner.is_canonical = 1;
    report.updated++;
    if (apply) stmts().promoteSite.run(workspaceId, v2, winnerRaw);
  }

  const desired = desiredSiteProjection(simulated);
  countCollisions(simulated, report, siteCollisionPayload);
  addAlias(report, KEYWORD_IDENTITY_ALIAS_KINDS.ROLLBACK_PROJECTION, desired.length);
  const current = normalizeSiteLegacyForComparison(legacy);
  if (stableRows(current) !== stableRows(desired)) {
    if (apply) {
      stmts().deleteSiteLegacy.run(workspaceId);
      for (const row of desired) stmts().insertSiteLegacy.run(row);
    }
  }
}

function backfillLocal(
  workspaceId: string,
  apply: boolean,
  report: KeywordIdentityStoreReport,
): void {
  const rows = stmts().localRows.all(workspaceId) as LocalVisibilityRow[];
  report.scanned += rows.length;
  for (const row of rows) {
    const raw = row.keyword.trim();
    const v2 = keywordIdentityKeyV2(raw);
    if (!raw || !v2) {
      report.skipped++;
      continue;
    }
    if (!keywordIdentityKeyV1(raw)) {
      addAlias(report, KEYWORD_IDENTITY_ALIAS_KINDS.V2_ONLY, 1);
    }
    if (row.normalized_keyword_v2 === v2) {
      report.alreadyPresent++;
      continue;
    }
    report.updated++;
    if (apply) stmts().updateLocalV2.run(v2, row.id, workspaceId);
  }
}

function countValue(row: unknown): number {
  return Number((row as { value?: number } | undefined)?.value ?? 0) || 0;
}

function censusLegacyAliases(
  workspaceId: string,
  stores: Record<KeywordIdentityStore, KeywordIdentityStoreReport>,
): void {
  const feedback = countValue(stmts().feedbackLegacyCount.get(workspaceId, workspaceId));
  const feedbackProjections = countValue(stmts().feedbackProjectionCount.get(workspaceId));
  const feedbackCompat = countValue(stmts().feedbackCompatCount.get(workspaceId));
  const feedbackAliasRows = countValue(stmts().feedbackAliasRowCount.get(workspaceId));
  stores.keyword_feedback.scanned += feedback + feedbackProjections + feedbackCompat + feedbackAliasRows;
  stores.keyword_feedback.alreadyPresent += feedbackCompat;
  addAlias(stores.keyword_feedback, KEYWORD_IDENTITY_ALIAS_KINDS.LEGACY_V1_ONLY, feedback);
  addAlias(stores.keyword_feedback, KEYWORD_IDENTITY_ALIAS_KINDS.ROLLBACK_PROJECTION, feedbackProjections);
  addAlias(
    stores.keyword_feedback,
    KEYWORD_IDENTITY_ALIAS_KINDS.RAW_VARIANT,
    countValue(stmts().feedbackRawVariantCount.get(workspaceId)),
  );
  addAlias(
    stores.keyword_feedback,
    KEYWORD_IDENTITY_ALIAS_KINDS.V2_ONLY,
    countValue(stmts().feedbackV2OnlyCount.get(workspaceId)),
  );
  stores.keyword_feedback.equivalentCollisions += countValue(
    stmts().feedbackRawCollisionCount.get(workspaceId),
  );

  const votes = countValue(stmts().voteLegacyCount.get(workspaceId, workspaceId));
  const voteProjections = countValue(stmts().voteProjectionCount.get(workspaceId));
  const voteCompat = countValue(stmts().voteCompatCount.get(workspaceId));
  const voteAliasRows = countValue(stmts().voteAliasRowCount.get(workspaceId));
  stores.content_gap_votes.scanned += votes + voteProjections + voteCompat + voteAliasRows;
  stores.content_gap_votes.alreadyPresent += voteCompat;
  addAlias(stores.content_gap_votes, KEYWORD_IDENTITY_ALIAS_KINDS.LEGACY_V1_ONLY, votes);
  addAlias(stores.content_gap_votes, KEYWORD_IDENTITY_ALIAS_KINDS.ROLLBACK_PROJECTION, voteProjections);
  addAlias(
    stores.content_gap_votes,
    KEYWORD_IDENTITY_ALIAS_KINDS.RAW_VARIANT,
    countValue(stmts().voteRawVariantCount.get(workspaceId)),
  );
  addAlias(
    stores.content_gap_votes,
    KEYWORD_IDENTITY_ALIAS_KINDS.V2_ONLY,
    countValue(stmts().voteV2OnlyCount.get(workspaceId)),
  );
  stores.content_gap_votes.equivalentCollisions += countValue(
    stmts().voteRawCollisionCount.get(workspaceId),
  );

  const serp = countValue(stmts().serpLegacyCount.get(workspaceId, workspaceId));
  const serpProjections = countValue(stmts().serpProjectionCount.get(workspaceId));
  const serpCompat = stmts().serpCompatRows.all(workspaceId) as SerpCompatCensusRow[];
  stores.serp_snapshots.scanned += serp + serpProjections + serpCompat.length;
  stores.serp_snapshots.alreadyPresent += serpCompat.length;
  addAlias(stores.serp_snapshots, KEYWORD_IDENTITY_ALIAS_KINDS.LEGACY_V1_ONLY, serp);
  addAlias(stores.serp_snapshots, KEYWORD_IDENTITY_ALIAS_KINDS.ROLLBACK_PROJECTION, serpProjections);
  addAlias(
    stores.serp_snapshots,
    KEYWORD_IDENTITY_ALIAS_KINDS.V2_ONLY,
    serpCompat.filter(row => !row.query_v1).length,
  );
  const serpGroups = new Map<string, SerpCompatCensusRow[]>();
  for (const row of serpCompat) {
    const key = `${row.date}\0${row.query_v2}`;
    const group = serpGroups.get(key) ?? [];
    group.push(row);
    serpGroups.set(key, group);
  }
  for (const group of serpGroups.values()) {
    if (group.length < 2) continue;
    addAlias(stores.serp_snapshots, KEYWORD_IDENTITY_ALIAS_KINDS.RAW_VARIANT, group.length - 1);
    const payloads = new Set(group.map(row => JSON.stringify({
      observedAt: row.observed_at,
      position: row.position,
      matchedUrl: row.matched_url,
      features: row.features,
      aiOverviewCited: row.ai_overview_cited,
      aiOverviewPresent: row.ai_overview_present,
    })));
    if (payloads.size === 1) stores.serp_snapshots.equivalentCollisions++;
    else stores.serp_snapshots.conflictingCollisions++;
  }
}

function migrationHead(): string {
  try {
    return (stmts().migrationHead.get() as { name?: string } | undefined)?.name ?? MIGRATION_HEAD;
  } catch (error) {
    void error; // Expected only when the migration tracker is unavailable in an isolated diagnostic DB.
    return MIGRATION_HEAD;
  }
}

/**
 * Operator-only K3b backfill. This function is deliberately not imported by
 * server boot. Dry-run is the CLI default; mutation requires an explicit APPLY
 * mode and each workspace is isolated in its own BEGIN IMMEDIATE transaction.
 */
export function runKeywordIdentityV2Backfill(
  options: RunKeywordIdentityBackfillOptions,
): KeywordIdentityBackfillReport {
  const startedAt = new Date().toISOString();
  const stores = emptyStores();
  const errors: KeywordIdentityBackfillError[] = [];
  const apply = options.mode === KEYWORD_IDENTITY_BACKFILL_MODES.APPLY;
  const scopedWorkspaceId = options.workspaceId?.trim();
  if (options.workspaceId !== undefined && !scopedWorkspaceId) {
    throw new Error('workspaceId must be non-empty when provided');
  }
  const workspaceIds = scopedWorkspaceId !== undefined
    ? (stmts().workspaceExists.get(scopedWorkspaceId) ? [scopedWorkspaceId] : [])
    : (stmts().workspaceIds.all() as Array<{ id: string }>).map(row => row.id);

  if (scopedWorkspaceId !== undefined && workspaceIds.length === 0) {
    stores.tracked_keywords.errors++;
    recordError(errors, 'tracked_keywords', 'workspace_not_found', scopedWorkspaceId, 'workspace');
  }

  for (const workspaceId of workspaceIds) {
    const localStores = emptyStores();
    let currentStore: KeywordIdentityStore = 'tracked_keywords';
    try {
      db.transaction(() => {
        currentStore = 'tracked_keywords';
        backfillTracked(workspaceId, apply, localStores.tracked_keywords);
        currentStore = 'site_keyword_metrics';
        backfillSite(workspaceId, apply, localStores.site_keyword_metrics);
        currentStore = 'local_visibility_snapshots';
        backfillLocal(workspaceId, apply, localStores.local_visibility_snapshots);
        currentStore = 'keyword_feedback';
        censusLegacyAliases(workspaceId, localStores);
      }).immediate();

      for (const store of KEYWORD_IDENTITY_STORES) addStoreReport(stores[store], localStores[store]);
    } catch (error) {
      void error; // Report stays redacted; raw database error text is intentionally not serialized.
      stores[currentStore].errors++;
      recordError(errors, currentStore, 'workspace_backfill_failed', workspaceId, 'workspace-transaction');
    }
  }

  // The v1 cache is global and intentionally never copied into the v2 cache.
  // Only the all-workspaces report counts it; a workspace filter cannot safely
  // attribute global cache rows to that tenant.
  if (!options.workspaceId) {
    const legacyCache = countValue(stmts().metricsLegacyCount.get());
    const v2Cache = countValue(stmts().metricsV2Count.get());
    stores.keyword_metrics_cache.scanned = legacyCache + v2Cache;
    stores.keyword_metrics_cache.skipped = legacyCache;
    stores.keyword_metrics_cache.alreadyPresent = v2Cache;
  }

  return {
    schemaVersion: 1,
    identityVersion: KEYWORD_IDENTITY_VERSIONS.V2,
    mode: options.mode,
    migrationHead: migrationHead(),
    startedAt,
    completedAt: new Date().toISOString(),
    stores,
    totals: totalsFor(stores),
    errors,
  };
}
