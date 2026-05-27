import db from '../db/index.js';
import { createStmtCache } from '../db/stmt-cache.js';

interface EntityResolutionCacheRow {
  cache_key: string;
  entity_label: string;
  entity_type: 'Thing' | 'Place';
  wikidata_qid: string | null;
  wikidata_label: string | null;
  wikidata_description: string | null;
  wikidata_same_as: string | null;
  confidence: number;
  status: 'resolved' | 'unresolved' | 'error';
  error_message: string | null;
  fetched_at: string;
  expires_at: string;
}

export interface CachedEntityResolution {
  cacheKey: string;
  entityLabel: string;
  entityType: 'Thing' | 'Place';
  wikidata: {
    qid: string;
    label: string;
    description?: string;
    sameAs: string;
  } | null;
  confidence: number;
  status: 'resolved' | 'unresolved' | 'error';
  errorMessage: string | null;
  fetchedAt: string;
  expiresAt: string;
}

const stmts = createStmtCache(() => ({
  getLive: db.prepare<[cacheKey: string, nowIso: string]>(
    'SELECT * FROM entity_resolution_cache WHERE cache_key = ? AND expires_at > ?',
  ),
  upsert: db.prepare(`
    INSERT INTO entity_resolution_cache (
      cache_key,
      entity_label,
      entity_type,
      wikidata_qid,
      wikidata_label,
      wikidata_description,
      wikidata_same_as,
      confidence,
      status,
      error_message,
      fetched_at,
      expires_at
    ) VALUES (
      @cache_key,
      @entity_label,
      @entity_type,
      @wikidata_qid,
      @wikidata_label,
      @wikidata_description,
      @wikidata_same_as,
      @confidence,
      @status,
      @error_message,
      @fetched_at,
      @expires_at
    )
    ON CONFLICT(cache_key) DO UPDATE SET
      entity_label = excluded.entity_label,
      entity_type = excluded.entity_type,
      wikidata_qid = excluded.wikidata_qid,
      wikidata_label = excluded.wikidata_label,
      wikidata_description = excluded.wikidata_description,
      wikidata_same_as = excluded.wikidata_same_as,
      confidence = excluded.confidence,
      status = excluded.status,
      error_message = excluded.error_message,
      fetched_at = excluded.fetched_at,
      expires_at = excluded.expires_at
  `),
}));

function rowToCachedResolution(row: EntityResolutionCacheRow): CachedEntityResolution {
  const hasWikidata = !!(row.wikidata_qid && row.wikidata_label && row.wikidata_same_as);
  return {
    cacheKey: row.cache_key,
    entityLabel: row.entity_label,
    entityType: row.entity_type,
    wikidata: hasWikidata
      ? {
          qid: row.wikidata_qid!,
          label: row.wikidata_label!,
          description: row.wikidata_description ?? undefined,
          sameAs: row.wikidata_same_as!,
        }
      : null,
    confidence: row.confidence,
    status: row.status,
    errorMessage: row.error_message,
    fetchedAt: row.fetched_at,
    expiresAt: row.expires_at,
  };
}

export function getCachedEntityResolution(
  cacheKey: string,
  nowIso = new Date().toISOString(),
): CachedEntityResolution | null {
  const row = stmts().getLive.get(cacheKey, nowIso) as EntityResolutionCacheRow | undefined;
  return row ? rowToCachedResolution(row) : null;
}

export function upsertEntityResolutionCache(entry: CachedEntityResolution): void {
  stmts().upsert.run({
    cache_key: entry.cacheKey,
    entity_label: entry.entityLabel,
    entity_type: entry.entityType,
    wikidata_qid: entry.wikidata?.qid ?? null,
    wikidata_label: entry.wikidata?.label ?? null,
    wikidata_description: entry.wikidata?.description ?? null,
    wikidata_same_as: entry.wikidata?.sameAs ?? null,
    confidence: entry.confidence,
    status: entry.status,
    error_message: entry.errorMessage,
    fetched_at: entry.fetchedAt,
    expires_at: entry.expiresAt,
  });
}
