// @ds-rebuilt
import type { default as SharpConstructor } from 'sharp';
import db from './db/index.js';
import { createStmtCache } from './db/stmt-cache.js';
import { createLogger } from './logger.js';

const log = createLogger('webflow-asset-dimensions');

const MAX_BATCH_SIZE = 12;
const MAX_CONCURRENT_PROBES = 2;
const FETCH_TIMEOUT_MS = 8_000;
const FAILED_RETRY_MS = 30 * 60 * 1000;
const MAX_METADATA_BYTES = 18 * 1024 * 1024;

export interface WebflowAssetDimensionFields {
  width?: number;
  height?: number;
  dimensionsDerivedAt?: string;
}

interface DimensionSourceAsset {
  id: string;
  contentType?: string;
  hostedUrl?: string;
  url?: string;
  size?: number;
}

interface DimensionSuccess {
  status: 'ready';
  width: number;
  height: number;
  derivedAt: string;
}

interface DimensionFailure {
  status: 'failed';
  failedAt: number;
  nextRetryAt: number;
}

type DimensionEntry = DimensionSuccess | DimensionFailure;

interface DimensionRow {
  asset_id: string;
  width: number | null;
  height: number | null;
  derived_at: string | null;
  failed_at: string | null;
  next_retry_at: string | null;
}

const dimensionsByAsset = new Map<string, DimensionEntry>();
const loadedSites = new Set<string>();
const queuedKeys = new Set<string>();
let queue: Array<{ siteId: string; asset: DimensionSourceAsset }> = [];
let activeProbes = 0;
let drainScheduled = false;

// The webflow_asset_dimension_cache table is created by migration
// 177-webflow-asset-dimension-cache.sql (under the migration runner like every
// other feature table), so no runtime CREATE TABLE is needed here.
const stmts = createStmtCache(() => {
  return {
    selectBySite: db.prepare(`
      SELECT asset_id, width, height, derived_at, failed_at, next_retry_at
      FROM webflow_asset_dimension_cache
      WHERE site_id = ?
    `),
    upsertReady: db.prepare(`
      INSERT INTO webflow_asset_dimension_cache
        (site_id, asset_id, width, height, derived_at, failed_at, next_retry_at, updated_at)
      VALUES
        (@siteId, @assetId, @width, @height, @derivedAt, NULL, NULL, @updatedAt)
      ON CONFLICT(site_id, asset_id) DO UPDATE SET
        width = excluded.width,
        height = excluded.height,
        derived_at = excluded.derived_at,
        failed_at = NULL,
        next_retry_at = NULL,
        updated_at = excluded.updated_at
    `),
    upsertFailure: db.prepare(`
      INSERT INTO webflow_asset_dimension_cache
        (site_id, asset_id, width, height, derived_at, failed_at, next_retry_at, updated_at)
      VALUES
        (@siteId, @assetId, NULL, NULL, NULL, @failedAt, @nextRetryAt, @updatedAt)
      ON CONFLICT(site_id, asset_id) DO UPDATE SET
        failed_at = excluded.failed_at,
        next_retry_at = excluded.next_retry_at,
        updated_at = excluded.updated_at
    `),
  };
});

function cacheKey(siteId: string, assetId: string): string {
  return `${siteId}:${assetId}`;
}

function loadSiteCache(siteId: string): void {
  if (loadedSites.has(siteId)) return;
  try {
    const rows = stmts().selectBySite.all(siteId) as DimensionRow[];
    for (const row of rows) {
      const key = cacheKey(siteId, row.asset_id);
      if (row.width && row.height && row.derived_at) {
        dimensionsByAsset.set(key, {
          status: 'ready',
          width: row.width,
          height: row.height,
          derivedAt: row.derived_at,
        });
        continue;
      }
      if (row.next_retry_at) {
        const nextRetryAt = Date.parse(row.next_retry_at);
        const failedAt = row.failed_at ? Date.parse(row.failed_at) : nextRetryAt - FAILED_RETRY_MS;
        if (Number.isFinite(nextRetryAt)) {
          dimensionsByAsset.set(key, {
            status: 'failed',
            failedAt: Number.isFinite(failedAt) ? failedAt : Date.now(),
            nextRetryAt,
          });
        }
      }
    }
    loadedSites.add(siteId);
  } catch (err) {
    log.debug({ err, siteId }, 'asset dimension cache read failed');
  }
}

function isImageCandidate(asset: DimensionSourceAsset): boolean {
  if (!asset.id) return false;
  const type = asset.contentType ?? '';
  if (!type.startsWith('image/')) return false;
  if (type.includes('svg')) return false;
  if (!(asset.hostedUrl || asset.url)) return false;
  if (asset.size != null && asset.size > MAX_METADATA_BYTES) return false;
  return true;
}

function shouldProbe(siteId: string, asset: DimensionSourceAsset): boolean {
  if (!isImageCandidate(asset)) return false;
  const key = cacheKey(siteId, asset.id);
  if (queuedKeys.has(key)) return false;
  const cached = dimensionsByAsset.get(key);
  if (!cached) return true;
  if (cached.status === 'ready') return false;
  return Date.now() >= cached.nextRetryAt;
}

export function applyCachedAssetDimensions<T extends DimensionSourceAsset>(
  siteId: string,
  assets: T[],
): Array<T & WebflowAssetDimensionFields> {
  loadSiteCache(siteId);
  return assets.map((asset) => {
    const cached = dimensionsByAsset.get(cacheKey(siteId, asset.id));
    if (!cached || cached.status !== 'ready') return asset;
    return {
      ...asset,
      width: cached.width,
      height: cached.height,
      dimensionsDerivedAt: cached.derivedAt,
    };
  });
}

export function scheduleAssetDimensionDerivation(siteId: string, assets: DimensionSourceAsset[]): void {
  loadSiteCache(siteId);
  const candidates = assets.filter((asset) => shouldProbe(siteId, asset)).slice(0, MAX_BATCH_SIZE);
  if (candidates.length === 0) return;

  for (const asset of candidates) {
    const key = cacheKey(siteId, asset.id);
    queuedKeys.add(key);
    queue.push({ siteId, asset });
  }
  scheduleDrain();
}

function scheduleDrain(): void {
  if (drainScheduled) return;
  drainScheduled = true;
  setTimeout(() => {
    drainScheduled = false;
    void drainQueue();
  }, 0);
}

async function drainQueue(): Promise<void> {
  while (activeProbes < MAX_CONCURRENT_PROBES && queue.length > 0) {
    const next = queue.shift();
    if (!next) return;
    activeProbes += 1;
    void probeAndCache(next.siteId, next.asset)
      .catch((err) => {
        log.debug({ err, siteId: next.siteId, assetId: next.asset.id }, 'asset dimension probe failed');
      })
      .finally(() => {
        activeProbes -= 1;
        queuedKeys.delete(cacheKey(next.siteId, next.asset.id));
        if (queue.length > 0) scheduleDrain();
      });
  }
}

async function probeAndCache(siteId: string, asset: DimensionSourceAsset): Promise<void> {
  const key = cacheKey(siteId, asset.id);
  const url = asset.hostedUrl || asset.url;
  if (!url) return;

  try {
    const dimensions = await fetchImageDimensions(url);
    if (!dimensions) {
      markFailure(siteId, asset.id);
      return;
    }
    const derivedAt = new Date().toISOString();
    dimensionsByAsset.set(key, {
      status: 'ready',
      width: dimensions.width,
      height: dimensions.height,
      derivedAt,
    });
    try {
      stmts().upsertReady.run({
        siteId,
        assetId: asset.id,
        width: dimensions.width,
        height: dimensions.height,
        derivedAt,
        updatedAt: derivedAt,
      });
    } catch (err) {
      log.debug({ err, siteId, assetId: asset.id }, 'asset dimension cache write failed');
    }
  } catch (err) {
    markFailure(siteId, asset.id);
    log.debug({ err, siteId, assetId: asset.id }, 'asset dimension metadata read failed');
  }
}

function markFailure(siteId: string, assetId: string): void {
  const now = Date.now();
  const failedAt = new Date(now).toISOString();
  const nextRetryAt = new Date(now + FAILED_RETRY_MS).toISOString();
  const key = cacheKey(siteId, assetId);
  dimensionsByAsset.set(key, {
    status: 'failed',
    failedAt: now,
    nextRetryAt: now + FAILED_RETRY_MS,
  });
  try {
    stmts().upsertFailure.run({
      siteId,
      assetId,
      failedAt,
      nextRetryAt,
      updatedAt: failedAt,
    });
  } catch (err) {
    log.debug({ err, siteId, assetId }, 'asset dimension failure cache write failed');
  }
}

async function fetchImageDimensions(url: string): Promise<{ width: number; height: number } | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const response = await fetch(url, { redirect: 'follow', signal: controller.signal });
    if (!response.ok) return null;
    // Guard the buffered read: isImageCandidate only enforces MAX_METADATA_BYTES when the
    // Webflow payload carried a `size`. When it did not, fall back to the response's
    // Content-Length so an unexpectedly large image is not fully buffered into memory.
    const contentLength = Number(response.headers.get('content-length') ?? '');
    if (Number.isFinite(contentLength) && contentLength > MAX_METADATA_BYTES) return null;
    const buffer = Buffer.from(await response.arrayBuffer());
    const sharp: typeof SharpConstructor = (await import('sharp')).default; // dynamic-import-ok
    const metadata = await sharp(buffer, { limitInputPixels: false }).metadata();
    if (!metadata.width || !metadata.height) return null;
    return { width: metadata.width, height: metadata.height };
  } finally {
    clearTimeout(timer);
  }
}
