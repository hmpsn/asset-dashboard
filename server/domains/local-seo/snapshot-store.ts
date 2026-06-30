import { randomUUID } from 'crypto';
import { z } from 'zod';

import db from '../../db/index.js';
import { parseJsonSafeArray } from '../../db/json-validation.js';
import { createStmtCache } from '../../db/stmt-cache.js';
import { createLogger } from '../../logger.js';
import { keywordComparisonKey } from '../../../shared/keyword-normalization.js';
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
  type LocalSeoVisibilityTrendPoint,
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
  keyword: string;
  normalized_keyword: string;
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
  status: string;
  degraded_reason: string | null;
}

interface VisibilityTrendRow {
  market_id: string;
  market_label: string;
  day: string;
  visible_count: number;
  checked_count: number;
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
      id, workspace_id, keyword, normalized_keyword, market_id, market_label, captured_at,
      local_pack_present, business_found, business_match_confidence, business_match_reason,
      local_rank, top_competitors, source_endpoint, provider, device, language_code, status,
      degraded_reason, matched_location_id, matched_location_name, raw_results
    ) VALUES (
      @id, @workspace_id, @keyword, @normalized_keyword, @market_id, @market_label, @captured_at,
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
    SELECT s.*
    FROM local_visibility_snapshots s
    WHERE s.workspace_id = ?
      AND s.id IN (
        SELECT MIN(id)
        FROM local_visibility_snapshots
        WHERE workspace_id = ?
          AND (market_id, normalized_keyword, device, language_code, captured_at) IN (
            SELECT market_id, normalized_keyword, device, language_code, MAX(captured_at)
            FROM local_visibility_snapshots
            WHERE workspace_id = ?
            GROUP BY market_id, normalized_keyword, device, language_code
          )
        GROUP BY market_id, normalized_keyword, device, language_code
      )
  `),
  latestSnapshotsByKeyword: db.prepare(`
    SELECT s.*
    FROM local_visibility_snapshots s
    WHERE s.workspace_id = ? AND s.normalized_keyword = ?
      AND s.id IN (
        SELECT MIN(id)
        FROM local_visibility_snapshots
        WHERE workspace_id = ? AND normalized_keyword = ?
          AND (market_id, normalized_keyword, device, language_code, captured_at) IN (
            SELECT market_id, normalized_keyword, device, language_code, MAX(captured_at)
            FROM local_visibility_snapshots
            WHERE workspace_id = ? AND normalized_keyword = ?
            GROUP BY market_id, normalized_keyword, device, language_code
          )
        GROUP BY market_id, normalized_keyword, device, language_code
      )
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
  pruneWeeklyThinIds: db.prepare(`
    SELECT s.id
    FROM local_visibility_snapshots s
    JOIN (
      SELECT outer_k.market_id, outer_k.normalized_keyword, outer_k.device,
             outer_k.language_code, top.week_start,
             MIN(outer_k.id) AS keep_id
      FROM local_visibility_snapshots outer_k
      JOIN (
        SELECT market_id, normalized_keyword, device, language_code,
               date(captured_at, '-' || strftime('%w', captured_at) || ' days') AS week_start,
               MAX(captured_at) AS max_captured_at
        FROM local_visibility_snapshots
        WHERE workspace_id = ?
          AND captured_at < datetime('now', '-' || ? || ' days')
          AND captured_at >= datetime('now', '-' || ? || ' days')
        GROUP BY market_id, normalized_keyword, device, language_code, week_start
      ) top ON outer_k.market_id = top.market_id
           AND outer_k.normalized_keyword = top.normalized_keyword
           AND outer_k.device = top.device
           AND outer_k.language_code = top.language_code
           AND date(outer_k.captured_at, '-' || strftime('%w', outer_k.captured_at) || ' days') = top.week_start
           AND outer_k.captured_at = top.max_captured_at
      WHERE outer_k.workspace_id = ?
        AND outer_k.captured_at < datetime('now', '-' || ? || ' days')
        AND outer_k.captured_at >= datetime('now', '-' || ? || ' days')
      GROUP BY outer_k.market_id, outer_k.normalized_keyword, outer_k.device,
               outer_k.language_code, top.week_start
    ) keepers ON keepers.market_id = s.market_id
             AND keepers.normalized_keyword = s.normalized_keyword
             AND keepers.device = s.device
             AND keepers.language_code = s.language_code
             AND date(s.captured_at, '-' || strftime('%w', s.captured_at) || ' days') = keepers.week_start
    WHERE s.workspace_id = ?
      AND s.captured_at < datetime('now', '-' || ? || ' days')
      AND s.captured_at >= datetime('now', '-' || ? || ' days')
      AND s.id != keepers.keep_id
      AND s.id NOT IN (
        SELECT MIN(id)
        FROM local_visibility_snapshots
        WHERE workspace_id = ?
          AND (captured_at, market_id, normalized_keyword, device, language_code) IN (
            SELECT MAX(captured_at), market_id, normalized_keyword, device, language_code
            FROM local_visibility_snapshots
            WHERE workspace_id = ?
            GROUP BY market_id, normalized_keyword, device, language_code
          )
        GROUP BY market_id, normalized_keyword, device, language_code
      )
    LIMIT ?
  `),
  pruneHardCutoffIds: db.prepare(`
    SELECT s.id
    FROM local_visibility_snapshots s
    WHERE s.workspace_id = ?
      AND s.captured_at < datetime('now', '-' || ? || ' days')
      AND s.id NOT IN (
        SELECT MIN(id)
        FROM local_visibility_snapshots
        WHERE workspace_id = ?
          AND (captured_at, market_id, normalized_keyword, device, language_code) IN (
            SELECT MAX(captured_at), market_id, normalized_keyword, device, language_code
            FROM local_visibility_snapshots
            WHERE workspace_id = ?
            GROUP BY market_id, normalized_keyword, device, language_code
          )
        GROUP BY market_id, normalized_keyword, device, language_code
      )
    LIMIT ?
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
  visibilityTrend: db.prepare(`
    SELECT
      s.market_id AS market_id,
      s.market_label AS market_label,
      date(s.captured_at) AS day,
      COUNT(DISTINCT CASE
        WHEN s.business_found = 1 AND s.business_match_confidence = ?
        THEN s.normalized_keyword || '::' || s.device || '::' || s.language_code
      END) AS visible_count,
      COUNT(DISTINCT s.normalized_keyword || '::' || s.device || '::' || s.language_code) AS checked_count
    FROM local_visibility_snapshots s
    WHERE s.workspace_id = ?
      AND s.status NOT IN (?, ?)
      AND s.captured_at >= datetime('now', '-${RETENTION_RAW_DAYS} days')
    GROUP BY s.market_id, s.market_label, day
    ORDER BY s.market_id ASC, day ASC
  `),
  latestSnapshotSummary: db.prepare(`
    SELECT
      s.keyword,
      s.normalized_keyword,
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
      s.status,
      s.degraded_reason
    FROM local_visibility_snapshots s
    WHERE s.workspace_id = ? AND s.status != ?
      AND s.id IN (
        SELECT MIN(id)
        FROM local_visibility_snapshots
        WHERE workspace_id = ? AND status != ?
          AND (market_id, normalized_keyword, device, language_code, captured_at) IN (
            SELECT market_id, normalized_keyword, device, language_code, MAX(captured_at)
            FROM local_visibility_snapshots
            WHERE workspace_id = ? AND status != ?
            GROUP BY market_id, normalized_keyword, device, language_code
          )
        GROUP BY market_id, normalized_keyword, device, language_code
      )
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
    normalizedKeyword: row.normalized_keyword,
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
    normalized_keyword: snapshot.normalizedKeyword,
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
  const rows = stmts().latestSnapshots.all(workspaceId, workspaceId, workspaceId) as SnapshotRow[];
  return rows.map(rowToSnapshot);
}

export function listLatestLocalVisibilitySnapshotsForKeyword(
  workspaceId: string,
  normalizedKeyword: string,
): LocalVisibilitySnapshot[] {
  const rows = stmts().latestSnapshotsByKeyword.all(
    workspaceId, normalizedKeyword,
    workspaceId, normalizedKeyword,
    workspaceId, normalizedKeyword,
  ) as SnapshotRow[];
  return rows.map(rowToSnapshot);
}

export function listLatestLocalVisibilitySnapshotSummaryRows(workspaceId: string): SnapshotSummaryRow[] {
  return stmts().latestSnapshotSummary.all(
    workspaceId,
    LOCAL_VISIBILITY_STATUS.PROVIDER_FAILED,
    workspaceId,
    LOCAL_VISIBILITY_STATUS.PROVIDER_FAILED,
    workspaceId,
    LOCAL_VISIBILITY_STATUS.PROVIDER_FAILED,
  ) as SnapshotSummaryRow[];
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
    normalizedKeyword: row.normalized_keyword,
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
    if (!row.normalized_keyword) continue;
    const current = grouped.get(row.normalized_keyword) ?? [];
    current.push(visibilityFromSummaryRow(row));
    grouped.set(row.normalized_keyword, current);
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
  normalizedKeyword: string,
): LocalSeoKeywordVisibilitySummary | undefined {
  return localSeoKeywordVisibilitySummaryFromSnapshots(
    listLatestLocalVisibilitySnapshotsForKeyword(workspaceId, normalizedKeyword),
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
  const rows = stmts().visibilityTrend.all(
    LOCAL_BUSINESS_MATCH_CONFIDENCE.VERIFIED,
    workspaceId,
    LOCAL_VISIBILITY_STATUS.PROVIDER_FAILED,
    LOCAL_VISIBILITY_STATUS.DEGRADED,
  ) as VisibilityTrendRow[];

  const byMarket = new Map<string, LocalSeoVisibilityTrendSeries>();
  for (const row of rows) {
    let series = byMarket.get(row.market_id);
    if (!series) {
      series = { marketId: row.market_id, marketLabel: row.market_label, points: [] };
      byMarket.set(row.market_id, series);
    }
    const point: LocalSeoVisibilityTrendPoint = {
      date: row.day,
      visibleCount: row.visible_count,
      checkedCount: row.checked_count,
    };
    series.points.push(point);
  }

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

  let batch: Array<{ id: string }>;
  do {
    batch = stmts().pruneWeeklyThinIds.all(
      workspaceId,
      RETENTION_RAW_DAYS,
      RETENTION_WEEKLY_MAX_DAYS,
      workspaceId,
      RETENTION_RAW_DAYS,
      RETENTION_WEEKLY_MAX_DAYS,
      workspaceId,
      RETENTION_RAW_DAYS,
      RETENTION_WEEKLY_MAX_DAYS,
      workspaceId,
      workspaceId,
      RETENTION_PRUNE_BATCH_SIZE,
    ) as Array<{ id: string }>;
    if (batch.length > 0) {
      db.transaction(() => {
        for (const row of batch) {
          stmts().deleteSnapshotById.run(row.id, workspaceId);
        }
      })();
      totalPruned += batch.length;
    }
  } while (batch.length === RETENTION_PRUNE_BATCH_SIZE);

  do {
    batch = stmts().pruneHardCutoffIds.all(
      workspaceId,
      RETENTION_WEEKLY_MAX_DAYS,
      workspaceId,
      workspaceId,
      RETENTION_PRUNE_BATCH_SIZE,
    ) as Array<{ id: string }>;
    if (batch.length > 0) {
      db.transaction(() => {
        for (const row of batch) {
          stmts().deleteSnapshotById.run(row.id, workspaceId);
        }
      })();
      totalPruned += batch.length;
    }
  } while (batch.length === RETENTION_PRUNE_BATCH_SIZE);

  if (totalPruned > 0) {
    log.info({ workspaceId, pruned: totalPruned }, 'local visibility snapshot retention prune complete');
  }
  return { pruned: totalPruned };
}
