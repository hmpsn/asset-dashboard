import { randomUUID } from 'crypto';
import { z } from 'zod';

import db from '../../db/index.js';
import { parseJsonSafeArray } from '../../db/json-validation.js';
import { createStmtCache } from '../../db/stmt-cache.js';
import { createLogger } from '../../logger.js';
import {
  keywordComparisonKey,
  keywordIdentityKeyV1,
  keywordIdentityKeyV2,
} from '../../../shared/keyword-normalization.js';
import {
  LOCAL_SEO_MAX_RESULTS,
  evaluateLocalBusinessMatch,
  scrubOwnedLocalResults,
} from './business-match.js';
import {
  LOCAL_BUSINESS_MATCH_CONFIDENCE,
  LOCAL_SEO_DEVICE,
  LOCAL_SEO_VISIBILITY_POSTURE,
  LOCAL_VISIBILITY_SOURCE_ENDPOINT,
  LOCAL_VISIBILITY_STATUS,
  localSeoKeywordVisibilityFromSnapshot,
  localSeoKeywordVisibilitySummaryFromSnapshots,
  summarizeLocalSeoKeywordVisibility,
  type ClientLocation,
  type LocalBusinessMatchConfidence,
  type LocalSeoDevice,
  type LocalSeoKeywordVisibility,
  type LocalSeoKeywordVisibilitySummary,
  type LocalSeoMarket,
  type LocalSeoVisibilityTrendSeries,
  type LocalVisibilityBusinessResult,
  type LocalVisibilityProviderResult,
  type LocalVisibilitySnapshot,
  type LocalVisibilitySourceEndpoint,
} from '../../../shared/types/local-seo.js';

const log = createLogger('local-seo-snapshot-store');

export const RETENTION_RAW_DAYS = 180;
export const RETENTION_WEEKLY_MAX_DAYS = 548; // 18 months approx.
export const RETENTION_PRUNE_BATCH_SIZE = 200;

const localResultSchema = z.object({
  title: z.string(),
  rank: z.number().optional(),
  domain: z.string().optional(),
  url: z.string().optional(),
  phone: z.string().optional(),
  address: z.string().optional(),
  cid: z.string().optional(),
}).strip();

interface SnapshotRow {
  id: string;
  workspace_id: string;
  keyword: string;
  normalized_keyword: string;
  normalized_keyword_v2: string | null;
  market_id: string;
  market_label: string;
  captured_at: string;
  local_pack_present: number;
  business_found: number;
  business_match_confidence: string;
  business_match_reason: string | null;
  local_rank: number | null;
  top_competitors: string;
  source_endpoint: string;
  provider: string;
  device: string;
  language_code: string;
  status: string;
  degraded_reason: string | null;
  matched_location_id: string | null;
  matched_location_name: string | null;
  raw_results: string | null;
}

export interface SnapshotSummaryRow {
  id: string;
  keyword: string;
  normalized_keyword: string;
  normalized_keyword_v2?: string | null;
  market_id: string;
  market_label: string;
  captured_at: string;
  local_pack_present: number;
  business_found: number;
  business_match_confidence: string;
  business_match_reason: string | null;
  local_rank: number | null;
  source_endpoint: string;
  provider: string;
  device: string;
  language_code: string;
  status: string;
  degraded_reason: string | null;
}

interface VisibilityTrendSnapshotRow extends SnapshotIdentityRow {
  market_label: string;
  business_found: number;
  business_match_confidence: string;
  status: string;
}

interface CompetitorSnapshotRow {
  workspace_id: string;
  business_found: number;
  local_pack_present: number;
  market_label: string;
  top_competitors: string;
}

export interface LocalSeoCompetitorSnapshot {
  businessFound: boolean;
  localPackPresent: boolean;
  marketLabel: string;
  topCompetitors: LocalVisibilityBusinessResult[];
}

export interface LocalVisibilitySnapshotBackfillCursor {
  capturedAt: string;
  id: string;
}

export interface LocalVisibilitySnapshotBackfillItem {
  snapshot: LocalVisibilitySnapshot;
  rawResults: LocalVisibilityBusinessResult[];
  cursor: LocalVisibilitySnapshotBackfillCursor;
}

export interface LocalVisibilitySnapshotMatchUpdate {
  workspaceId: string;
  snapshotId: string;
  businessFound: boolean;
  businessMatchConfidence: LocalBusinessMatchConfidence;
  businessMatchReason: string | null;
  localRank: number | null;
  matchedLocationId: string | null;
  matchedLocationName: string | null;
  topCompetitors: LocalVisibilityBusinessResult[];
  rawResults: LocalVisibilityBusinessResult[];
}

const stmts = createStmtCache(() => ({
  insertSnapshot: db.prepare(`
    INSERT INTO local_visibility_snapshots (
      id, workspace_id, keyword, normalized_keyword, normalized_keyword_v2, market_id, market_label, captured_at,
      local_pack_present, business_found, business_match_confidence, business_match_reason,
      local_rank, top_competitors, source_endpoint, provider, device, language_code, status,
      degraded_reason, matched_location_id, matched_location_name, raw_results
    ) VALUES (
      @id, @workspace_id, @keyword, @normalized_keyword, @normalized_keyword_v2, @market_id, @market_label, @captured_at,
      @local_pack_present, @business_found, @business_match_confidence, @business_match_reason,
      @local_rank, @top_competitors, @source_endpoint, @provider, @device, @language_code, @status,
      @degraded_reason, @matched_location_id, @matched_location_name, @raw_results
    )
  `),
  updateSnapshotMatch: db.prepare(`
    UPDATE local_visibility_snapshots
    SET business_found = @business_found,
      business_match_confidence = @business_match_confidence,
      business_match_reason = @business_match_reason,
      local_rank = @local_rank,
      matched_location_id = @matched_location_id,
      matched_location_name = @matched_location_name,
      top_competitors = @top_competitors,
      raw_results = COALESCE(raw_results, @raw_results)
    WHERE id = @id AND workspace_id = @workspace_id
  `),
  countSnapshotsForWorkspace: db.prepare(`
    SELECT COUNT(*) AS count FROM local_visibility_snapshots
    WHERE workspace_id = ?
  `),
  maxUsableCapturedAtForWorkspace: db.prepare(`
    SELECT MAX(captured_at) AS max_captured_at FROM local_visibility_snapshots
    WHERE workspace_id = ? AND status != ?
  `),
  latestSnapshots: db.prepare(`
    SELECT * FROM (
      SELECT s.*, ROW_NUMBER() OVER (
        PARTITION BY market_id,
          CASE WHEN normalized_keyword_v2 IS NOT NULL AND normalized_keyword_v2 <> ''
            THEN 'v2:' || normalized_keyword_v2 ELSE 'raw:' || keyword END,
          device, language_code
        ORDER BY captured_at DESC, id ASC
      ) AS identity_rank
      FROM local_visibility_snapshots s
      WHERE workspace_id = ?
    ) WHERE identity_rank = 1
  `),
  latestSnapshotsByKeywordV2: db.prepare(`
    SELECT * FROM (
      SELECT s.*, ROW_NUMBER() OVER (
        PARTITION BY market_id, normalized_keyword_v2, device, language_code
        ORDER BY captured_at DESC, id ASC
      ) AS identity_rank
      FROM local_visibility_snapshots s
      WHERE workspace_id = ? AND normalized_keyword_v2 = ?
    ) WHERE identity_rank = 1
  `),
  listSnapshotsPageForBackfill: db.prepare(`
    SELECT * FROM local_visibility_snapshots
    WHERE workspace_id = ?
      AND (captured_at < ? OR (captured_at = ? AND id > ?))
    ORDER BY captured_at DESC, id ASC
    LIMIT ?
  `),
  listSnapshotsFirstPageForBackfill: db.prepare(`
    SELECT * FROM local_visibility_snapshots
    WHERE workspace_id = ?
    ORDER BY captured_at DESC, id ASC
    LIMIT ?
  `),
  retentionRows: db.prepare(`
    SELECT id, keyword, normalized_keyword, normalized_keyword_v2,
           market_id, captured_at, device, language_code
    FROM local_visibility_snapshots
    WHERE workspace_id = ?
    ORDER BY captured_at DESC, id ASC
  `),
  deleteSnapshotById: db.prepare(`
    DELETE FROM local_visibility_snapshots WHERE id = ? AND workspace_id = ?
  `),
  competitorSnapshots: db.prepare(`
    SELECT workspace_id, business_found, local_pack_present, market_label, top_competitors
    FROM local_visibility_snapshots
    WHERE workspace_id = @workspaceId
      AND captured_at >= datetime('now', '-' || @days || ' days')
      AND status = 'success'
    ORDER BY captured_at DESC
  `),
  visibilityTrendRows: db.prepare(`
    SELECT id, keyword, normalized_keyword, normalized_keyword_v2,
           market_id, market_label, captured_at, device, language_code,
           business_found, business_match_confidence, status
    FROM local_visibility_snapshots
    WHERE workspace_id = ?
      AND status NOT IN (?, ?)
      AND captured_at >= datetime('now', '-${RETENTION_RAW_DAYS} days')
    ORDER BY market_id ASC, captured_at ASC, id ASC
  `),
  latestSnapshotSummary: db.prepare(`
    SELECT
      s.id,
      s.keyword,
      s.normalized_keyword,
      s.normalized_keyword_v2,
      s.market_id,
      s.market_label,
      s.captured_at,
      s.local_pack_present,
      s.business_found,
      s.business_match_confidence,
      s.business_match_reason,
      s.local_rank,
      s.source_endpoint,
      s.provider,
      s.device,
      s.language_code,
      s.status,
      s.degraded_reason
    FROM (
      SELECT source.*, ROW_NUMBER() OVER (
        PARTITION BY market_id,
          CASE WHEN normalized_keyword_v2 IS NOT NULL AND normalized_keyword_v2 <> ''
            THEN 'v2:' || normalized_keyword_v2 ELSE 'raw:' || keyword END,
          device, language_code
        ORDER BY captured_at DESC, id ASC
      ) AS identity_rank
      FROM local_visibility_snapshots source
      WHERE workspace_id = ? AND status != ?
    ) s
    WHERE s.identity_rank = 1
  `),
}));

function isBusinessMatchConfidence(value: string): value is LocalBusinessMatchConfidence {
  return Object.values(LOCAL_BUSINESS_MATCH_CONFIDENCE).includes(value as LocalBusinessMatchConfidence);
}

function isLocalVisibilitySourceEndpoint(value: string): value is LocalVisibilitySourceEndpoint {
  return Object.values(LOCAL_VISIBILITY_SOURCE_ENDPOINT).includes(value as LocalVisibilitySourceEndpoint);
}

function rowToSnapshot(row: SnapshotRow): LocalVisibilitySnapshot {
  return {
    id: row.id,
    workspaceId: row.workspace_id,
    keyword: row.keyword,
    normalizedKeyword: row.normalized_keyword_v2 || keywordIdentityKeyV2(row.keyword) || row.normalized_keyword,
    marketId: row.market_id,
    marketLabel: row.market_label,
    capturedAt: row.captured_at,
    localPackPresent: row.local_pack_present === 1,
    businessFound: row.business_found === 1,
    businessMatchConfidence: isBusinessMatchConfidence(row.business_match_confidence)
      ? row.business_match_confidence
      : LOCAL_BUSINESS_MATCH_CONFIDENCE.UNKNOWN,
    businessMatchReason: row.business_match_reason ?? undefined,
    localRank: row.local_rank ?? undefined,
    topCompetitors: parseJsonSafeArray(row.top_competitors, localResultSchema, { workspaceId: row.workspace_id, table: 'local_visibility_snapshots', field: 'top_competitors' }),
    sourceEndpoint: isLocalVisibilitySourceEndpoint(row.source_endpoint)
      ? row.source_endpoint
      : LOCAL_VISIBILITY_SOURCE_ENDPOINT.GOOGLE_ORGANIC_SERP,
    provider: row.provider,
    device: row.device === LOCAL_SEO_DEVICE.MOBILE ? LOCAL_SEO_DEVICE.MOBILE : LOCAL_SEO_DEVICE.DESKTOP,
    languageCode: row.language_code,
    status: Object.values(LOCAL_VISIBILITY_STATUS).includes(row.status as LocalVisibilitySnapshot['status'])
      ? row.status as LocalVisibilitySnapshot['status']
      : LOCAL_VISIBILITY_STATUS.DEGRADED,
    degradedReason: row.degraded_reason ?? undefined,
    matchedLocationId: row.matched_location_id ?? undefined,
    matchedLocationName: row.matched_location_name ?? undefined,
  };
}

function rowToRawLocalResults(row: SnapshotRow): LocalVisibilityBusinessResult[] {
  return parseJsonSafeArray(row.raw_results ?? row.top_competitors, localResultSchema, {
    workspaceId: row.workspace_id,
    table: 'local_visibility_snapshots',
    field: row.raw_results ? 'raw_results' : 'top_competitors',
  });
}

export function isUsableLocalVisibilitySnapshot(snapshot: Pick<LocalVisibilitySnapshot, 'status'>): boolean {
  return snapshot.status !== LOCAL_VISIBILITY_STATUS.PROVIDER_FAILED;
}

export function snapshotFromProviderResult(
  workspaceId: string,
  locations: ClientLocation[],
  market: LocalSeoMarket,
  providerResult: LocalVisibilityProviderResult,
  device: LocalSeoDevice,
  languageCode: string,
): LocalVisibilitySnapshot {
  const match = evaluateLocalBusinessMatch(locations, providerResult.results);
  const isSuccess = providerResult.status === LOCAL_VISIBILITY_STATUS.SUCCESS;
  return {
    id: randomUUID(),
    workspaceId,
    keyword: providerResult.keyword,
    normalizedKeyword: keywordComparisonKey(providerResult.keyword),
    marketId: market.id,
    marketLabel: market.label,
    capturedAt: providerResult.capturedAt,
    localPackPresent: providerResult.localPackPresent,
    businessFound: isSuccess && match.found,
    businessMatchConfidence: isSuccess ? match.confidence : LOCAL_BUSINESS_MATCH_CONFIDENCE.UNKNOWN,
    businessMatchReason: isSuccess ? match.reason : providerResult.degradedReason,
    localRank: isSuccess ? match.rank : undefined,
    topCompetitors: scrubOwnedLocalResults(providerResult.results, locations),
    sourceEndpoint: providerResult.sourceEndpoint,
    provider: providerResult.provider,
    device,
    languageCode,
    status: providerResult.status,
    degradedReason: providerResult.degradedReason,
    matchedLocationId: isSuccess ? match.matchedLocationId : undefined,
    matchedLocationName: isSuccess ? match.matchedLocationName : undefined,
  };
}

export function storeLocalVisibilitySnapshot(
  snapshot: LocalVisibilitySnapshot,
  rawResults: LocalVisibilityBusinessResult[] = snapshot.topCompetitors,
): void {
  stmts().insertSnapshot.run({
    id: snapshot.id,
    workspace_id: snapshot.workspaceId,
    keyword: snapshot.keyword,
    normalized_keyword: keywordIdentityKeyV1(snapshot.keyword),
    normalized_keyword_v2: keywordIdentityKeyV2(snapshot.keyword),
    market_id: snapshot.marketId,
    market_label: snapshot.marketLabel,
    captured_at: snapshot.capturedAt,
    local_pack_present: snapshot.localPackPresent ? 1 : 0,
    business_found: snapshot.businessFound ? 1 : 0,
    business_match_confidence: snapshot.businessMatchConfidence,
    business_match_reason: snapshot.businessMatchReason ?? null,
    local_rank: snapshot.localRank ?? null,
    top_competitors: JSON.stringify(snapshot.topCompetitors),
    source_endpoint: snapshot.sourceEndpoint,
    provider: snapshot.provider,
    device: snapshot.device,
    language_code: snapshot.languageCode,
    status: snapshot.status,
    degraded_reason: snapshot.degradedReason ?? null,
    matched_location_id: snapshot.matchedLocationId ?? null,
    matched_location_name: snapshot.matchedLocationName ?? null,
    raw_results: JSON.stringify(rawResults.slice(0, LOCAL_SEO_MAX_RESULTS)),
  });
}

export function listLatestLocalVisibilitySnapshots(workspaceId: string): LocalVisibilitySnapshot[] {
  const rows = stmts().latestSnapshots.all(workspaceId) as SnapshotRow[];
  return dedupeLatestSnapshotRows(rows).map(rowToSnapshot);
}

export function listLatestLocalVisibilitySnapshotsForKeyword(
  workspaceId: string,
  keyword: string,
): LocalVisibilitySnapshot[] {
  const keywordV2 = keywordIdentityKeyV2(keyword);
  if (!keywordV2) return [];
  const v2Rows = stmts().latestSnapshotsByKeywordV2.all(workspaceId, keywordV2) as SnapshotRow[];
  if (v2Rows.length > 0) return dedupeLatestSnapshotRows(v2Rows).map(rowToSnapshot);
  // Pre-backfill raw spellings can have different v1 keys while converging under
  // NFKC (Café vs Cafe + combining mark), so a v1 predicate cannot be complete.
  const rows = stmts().latestSnapshots.all(workspaceId) as SnapshotRow[];
  const exactRecoverableRows = rows.filter(row => keywordIdentityKeyV2(row.keyword) === keywordV2);
  return dedupeLatestSnapshotRows(exactRecoverableRows)
    .map(rowToSnapshot);
}

export function listLatestLocalVisibilitySnapshotSummaryRows(workspaceId: string): SnapshotSummaryRow[] {
  const rows = stmts().latestSnapshotSummary.all(
    workspaceId,
    LOCAL_VISIBILITY_STATUS.PROVIDER_FAILED,
  ) as SnapshotSummaryRow[];
  return dedupeLatestSnapshotRows(rows);
}

type SnapshotIdentityRow = {
  id: string;
  keyword: string;
  normalized_keyword: string;
  normalized_keyword_v2?: string | null;
  market_id: string;
  captured_at: string;
  device: string;
  language_code: string;
};

/**
 * SQLite cannot derive NFKC identities for pre-backfill rows. The SQL queries
 * first bound each recoverable raw series, then this compatibility pass merges
 * canonically equivalent spellings without collapsing meaning-distinct v2 keys.
 */
function dedupeLatestSnapshotRows<T extends SnapshotIdentityRow>(rows: T[]): T[] {
  const latestBySeries = new Map<string, T>();
  for (const row of rows) {
    const identity = row.normalized_keyword_v2
      || keywordIdentityKeyV2(row.keyword)
      || `v1:${row.normalized_keyword}`;
    const seriesKey = [row.market_id, identity, row.device, row.language_code].join('\u0000');
    const current = latestBySeries.get(seriesKey);
    if (
      !current
      || row.captured_at > current.captured_at
      || (row.captured_at === current.captured_at && row.id < current.id)
    ) {
      latestBySeries.set(seriesKey, row);
    }
  }
  return [...latestBySeries.values()];
}

function snapshotSeriesKey(row: SnapshotIdentityRow): string {
  const identity = row.normalized_keyword_v2
    || keywordIdentityKeyV2(row.keyword)
    || `v1:${row.normalized_keyword}`;
  return [row.market_id, identity, row.device, row.language_code].join('\u0000');
}

function sundayWeekStart(capturedAt: string): string {
  const date = new Date(capturedAt);
  if (!Number.isFinite(date.getTime())) return capturedAt.slice(0, 10);
  date.setUTCDate(date.getUTCDate() - date.getUTCDay());
  return date.toISOString().slice(0, 10);
}

function postureFromSummaryRow(row: SnapshotSummaryRow) {
  if (row.status === LOCAL_VISIBILITY_STATUS.PROVIDER_FAILED || row.status === LOCAL_VISIBILITY_STATUS.DEGRADED) {
    return LOCAL_SEO_VISIBILITY_POSTURE.PROVIDER_DEGRADED;
  }
  if (row.business_found === 1 && row.business_match_confidence === LOCAL_BUSINESS_MATCH_CONFIDENCE.VERIFIED) {
    return LOCAL_SEO_VISIBILITY_POSTURE.VISIBLE;
  }
  if (
    row.business_found === 1
    && (
      row.business_match_confidence === LOCAL_BUSINESS_MATCH_CONFIDENCE.STRONG_MATCH
      || row.business_match_confidence === LOCAL_BUSINESS_MATCH_CONFIDENCE.POSSIBLE_MATCH
    )
  ) {
    return LOCAL_SEO_VISIBILITY_POSTURE.POSSIBLE_MATCH;
  }
  if (row.local_pack_present === 1) return LOCAL_SEO_VISIBILITY_POSTURE.LOCAL_PACK_PRESENT;
  return LOCAL_SEO_VISIBILITY_POSTURE.NOT_VISIBLE;
}

function visibilityFromSummaryRow(row: SnapshotSummaryRow): LocalSeoKeywordVisibility {
  const posture = postureFromSummaryRow(row);
  const businessMatchConfidence = isBusinessMatchConfidence(row.business_match_confidence)
    ? row.business_match_confidence
    : LOCAL_BUSINESS_MATCH_CONFIDENCE.UNKNOWN;
  const sourceEndpoint = isLocalVisibilitySourceEndpoint(row.source_endpoint)
    ? row.source_endpoint
    : LOCAL_VISIBILITY_SOURCE_ENDPOINT.GOOGLE_ORGANIC_SERP;
  const base = {
    keyword: row.keyword,
    normalizedKeyword: row.normalized_keyword_v2 || keywordIdentityKeyV2(row.keyword) || row.normalized_keyword,
    marketId: row.market_id,
    marketLabel: row.market_label,
    capturedAt: row.captured_at,
    localPackPresent: row.local_pack_present === 1,
    businessFound: row.business_found === 1,
    businessMatchConfidence,
    localRank: row.local_rank ?? undefined,
    sourceEndpoint,
    provider: row.provider,
    degradedReason: row.degraded_reason ?? undefined,
  };

  if (posture === LOCAL_SEO_VISIBILITY_POSTURE.VISIBLE) {
    return {
      ...base,
      posture,
      label: row.local_rank ? `Visible #${row.local_rank}` : 'Visible locally',
      detail: row.business_match_reason ?? 'Business appears in local results with verified match evidence.',
    };
  }
  if (posture === LOCAL_SEO_VISIBILITY_POSTURE.POSSIBLE_MATCH) {
    return {
      ...base,
      posture,
      label: row.local_rank ? `Possible match #${row.local_rank}` : 'Possible match',
      detail: row.business_match_reason ?? 'Possible business match; review before treating this as verified local visibility.',
    };
  }
  if (posture === LOCAL_SEO_VISIBILITY_POSTURE.PROVIDER_DEGRADED) {
    return {
      ...base,
      posture,
      label: 'Provider degraded',
      detail: row.degraded_reason ?? 'Local visibility data could not be refreshed cleanly.',
    };
  }
  if (posture === LOCAL_SEO_VISIBILITY_POSTURE.LOCAL_PACK_PRESENT) {
    return {
      ...base,
      posture,
      label: 'Local pack present',
      detail: row.business_match_reason ?? 'A local pack appeared, but this business was not confidently matched.',
    };
  }
  return {
    ...base,
    posture,
    label: 'Not found locally',
    detail: row.business_match_reason ?? 'No likely business match found in local results for this market.',
  };
}

export function buildLocalSeoKeywordVisibilitySummaryByKey(workspaceId: string): Map<string, LocalSeoKeywordVisibilitySummary> {
  const grouped = new Map<string, LocalSeoKeywordVisibility[]>();
  for (const row of listLatestLocalVisibilitySnapshotSummaryRows(workspaceId)) {
    const identity = row.normalized_keyword_v2 || keywordIdentityKeyV2(row.keyword) || row.normalized_keyword;
    if (!identity) continue;
    const current = grouped.get(identity) ?? [];
    current.push(visibilityFromSummaryRow(row));
    grouped.set(identity, current);
  }
  const summaries = new Map<string, LocalSeoKeywordVisibilitySummary>();
  for (const [key, visibility] of grouped) {
    const summary = summarizeLocalSeoKeywordVisibility(visibility);
    if (summary) summaries.set(key, summary);
  }
  return summaries;
}

export function buildLocalSeoKeywordVisibilityByKey(workspaceId: string): Map<string, LocalSeoKeywordVisibilitySummary> {
  const grouped = new Map<string, LocalSeoKeywordVisibility[]>();
  for (const snapshot of listLatestLocalVisibilitySnapshots(workspaceId)) {
    if (!isUsableLocalVisibilitySnapshot(snapshot)) continue;
    if (!snapshot.normalizedKeyword) continue;
    const current = grouped.get(snapshot.normalizedKeyword) ?? [];
    current.push(localSeoKeywordVisibilityFromSnapshot(snapshot));
    grouped.set(snapshot.normalizedKeyword, current);
  }
  const summaries = new Map<string, LocalSeoKeywordVisibilitySummary>();
  for (const [key, visibility] of grouped) {
    const summary = summarizeLocalSeoKeywordVisibility(visibility);
    if (summary) summaries.set(key, summary);
  }
  return summaries;
}

export function buildLocalSeoKeywordVisibilityForKeyword(
  workspaceId: string,
  keyword: string,
): LocalSeoKeywordVisibilitySummary | undefined {
  return localSeoKeywordVisibilitySummaryFromSnapshots(
    listLatestLocalVisibilitySnapshotsForKeyword(workspaceId, keyword),
  );
}

export function buildMarketKeywordVisibilityFromSnapshots(snapshots: LocalVisibilitySnapshot[]): Map<string, LocalSeoKeywordVisibility> {
  return buildLocalSeoVisibilityMap(
    snapshots,
    snapshot => `${snapshot.marketId}:${snapshot.normalizedKeyword}`,
  );
}

function buildLocalSeoVisibilityMap(
  snapshots: LocalVisibilitySnapshot[],
  keyForSnapshot: (snapshot: LocalVisibilitySnapshot) => string,
): Map<string, LocalSeoKeywordVisibility> {
  const map = new Map<string, LocalSeoKeywordVisibility>();
  for (const snapshot of snapshots) {
    const key = keyForSnapshot(snapshot);
    if (!snapshot.normalizedKeyword || map.has(key)) continue;
    map.set(key, localSeoKeywordVisibilityFromSnapshot(snapshot));
  }
  return map;
}

export function getLocalSeoVisibilityTrend(workspaceId: string): LocalSeoVisibilityTrendSeries[] {
  const rows = stmts().visibilityTrendRows.all(
    workspaceId,
    LOCAL_VISIBILITY_STATUS.PROVIDER_FAILED,
    LOCAL_VISIBILITY_STATUS.DEGRADED,
  ) as VisibilityTrendSnapshotRow[];

  const byMarketDay = new Map<string, {
    marketId: string;
    marketLabel: string;
    date: string;
    checked: Set<string>;
    visible: Set<string>;
  }>();
  for (const row of rows) {
    const date = row.captured_at.slice(0, 10);
    const bucketKey = `${row.market_id}\u0000${date}`;
    const bucket = byMarketDay.get(bucketKey) ?? {
      marketId: row.market_id,
      marketLabel: row.market_label,
      date,
      checked: new Set<string>(),
      visible: new Set<string>(),
    };
    const seriesKey = snapshotSeriesKey(row);
    bucket.checked.add(seriesKey);
    if (row.business_found === 1 && row.business_match_confidence === LOCAL_BUSINESS_MATCH_CONFIDENCE.VERIFIED) {
      bucket.visible.add(seriesKey);
    }
    byMarketDay.set(bucketKey, bucket);
  }

  const byMarket = new Map<string, LocalSeoVisibilityTrendSeries>();
  for (const bucket of byMarketDay.values()) {
    const series = byMarket.get(bucket.marketId) ?? {
      marketId: bucket.marketId,
      marketLabel: bucket.marketLabel,
      points: [],
    };
    series.points.push({
      date: bucket.date,
      visibleCount: bucket.visible.size,
      checkedCount: bucket.checked.size,
    });
    byMarket.set(bucket.marketId, series);
  }

  for (const series of byMarket.values()) series.points.sort((a, b) => a.date.localeCompare(b.date));
  return [...byMarket.values()].sort((a, b) => {
    const aLast = a.points[a.points.length - 1]?.date ?? '';
    const bLast = b.points[b.points.length - 1]?.date ?? '';
    return bLast.localeCompare(aLast);
  });
}

export function listLocalSeoCompetitorSnapshots(workspaceId: string, lookbackDays = 30): LocalSeoCompetitorSnapshot[] {
  const rows = stmts().competitorSnapshots.all({ workspaceId, days: lookbackDays }) as CompetitorSnapshotRow[];
  return rows.map(row => ({
    businessFound: row.business_found === 1,
    localPackPresent: row.local_pack_present === 1,
    marketLabel: row.market_label,
    topCompetitors: parseJsonSafeArray(row.top_competitors, localResultSchema, {
      workspaceId,
      table: 'local_visibility_snapshots',
      field: 'top_competitors',
    }),
  }));
}

export function countLocalVisibilitySnapshots(workspaceId: string): number {
  const row = stmts().countSnapshotsForWorkspace.get(workspaceId) as { count: number };
  return row.count;
}

export function latestLocalSnapshotAt(workspaceId: string): string | null {
  const row = stmts().maxUsableCapturedAtForWorkspace.get(workspaceId, LOCAL_VISIBILITY_STATUS.PROVIDER_FAILED) as { max_captured_at: string | null };
  return row.max_captured_at ?? null;
}

export function listLocalVisibilitySnapshotBackfillPage(
  workspaceId: string,
  pageSize: number,
  cursor: LocalVisibilitySnapshotBackfillCursor | null,
): LocalVisibilitySnapshotBackfillItem[] {
  const rows = cursor === null
    ? stmts().listSnapshotsFirstPageForBackfill.all(workspaceId, pageSize) as SnapshotRow[]
    : stmts().listSnapshotsPageForBackfill.all(
        workspaceId,
        cursor.capturedAt,
        cursor.capturedAt,
        cursor.id,
        pageSize,
      ) as SnapshotRow[];

  return rows.map(row => ({
    snapshot: rowToSnapshot(row),
    rawResults: rowToRawLocalResults(row),
    cursor: {
      capturedAt: row.captured_at,
      id: row.id,
    },
  }));
}

export function updateLocalVisibilitySnapshotMatch(input: LocalVisibilitySnapshotMatchUpdate): void {
  stmts().updateSnapshotMatch.run({
    id: input.snapshotId,
    workspace_id: input.workspaceId,
    business_found: input.businessFound ? 1 : 0,
    business_match_confidence: input.businessMatchConfidence,
    business_match_reason: input.businessMatchReason,
    local_rank: input.localRank,
    matched_location_id: input.matchedLocationId,
    matched_location_name: input.matchedLocationName,
    top_competitors: JSON.stringify(input.topCompetitors),
    raw_results: JSON.stringify(input.rawResults.slice(0, LOCAL_SEO_MAX_RESULTS)),
  });
}

export function updateLocalVisibilitySnapshotMatches(inputs: LocalVisibilitySnapshotMatchUpdate[]): void {
  if (inputs.length === 0) return;
  db.transaction(() => {
    for (const input of inputs) {
      updateLocalVisibilitySnapshotMatch(input);
    }
  })();
}

export function runSnapshotRetentionPrune(workspaceId: string): { pruned: number } {
  let totalPruned = 0;
  const rows = stmts().retentionRows.all(workspaceId) as SnapshotIdentityRow[];
  const latestIdBySeries = new Map<string, string>();
  for (const row of rows) {
    const key = snapshotSeriesKey(row);
    if (!latestIdBySeries.has(key)) latestIdBySeries.set(key, row.id);
  }

  const rawCutoff = Date.now() - RETENTION_RAW_DAYS * 24 * 60 * 60 * 1000;
  const hardCutoff = Date.now() - RETENTION_WEEKLY_MAX_DAYS * 24 * 60 * 60 * 1000;
  const weeklyWinner = new Map<string, string>();
  for (const row of rows) {
    const capturedAt = Date.parse(row.captured_at);
    if (!Number.isFinite(capturedAt) || capturedAt >= rawCutoff || capturedAt < hardCutoff) continue;
    const weekKey = `${snapshotSeriesKey(row)}\u0000${sundayWeekStart(row.captured_at)}`;
    if (!weeklyWinner.has(weekKey)) weeklyWinner.set(weekKey, row.id);
  }
  const deleteIds: string[] = [];
  for (const row of rows) {
    if (latestIdBySeries.get(snapshotSeriesKey(row)) === row.id) continue;
    const capturedAt = Date.parse(row.captured_at);
    if (!Number.isFinite(capturedAt) || capturedAt >= rawCutoff) continue;
    if (capturedAt < hardCutoff) {
      deleteIds.push(row.id);
      continue;
    }
    const weekKey = `${snapshotSeriesKey(row)}\u0000${sundayWeekStart(row.captured_at)}`;
    if (weeklyWinner.get(weekKey) !== row.id) deleteIds.push(row.id);
  }

  for (let offset = 0; offset < deleteIds.length; offset += RETENTION_PRUNE_BATCH_SIZE) {
    const batch = deleteIds.slice(offset, offset + RETENTION_PRUNE_BATCH_SIZE);
    db.transaction(() => {
      for (const id of batch) stmts().deleteSnapshotById.run(id, workspaceId);
    })();
    totalPruned += batch.length;
  }

  if (totalPruned > 0) {
    log.info({ workspaceId, pruned: totalPruned }, 'local visibility snapshot retention prune complete');
  }
  return { pruned: totalPruned };
}
