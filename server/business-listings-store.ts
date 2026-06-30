/**
 * business-listings-store — time-series store for the `business_listing_snapshots`
 * table (SEO Decision Engine P7, migration 154).
 *
 * Parallel to serp_snapshots / local_visibility_snapshots — Google Business Profile
 * health + reviews over time for the client's OWN listing and local competitors.
 * The three stores are NEVER conflated.
 *
 * Gotcha (see tests/fixtures/dataforseo-business-listings.ts): a business with zero
 * reviews has NO rating block — `rating`/`reviewCount` are ABSENT (undefined), NOT 0.
 * rowToBusinessListingSnapshot maps NULL columns → `undefined` (never `null`/`0`),
 * tri-state INTEGER flags (NULL/0/1) → (undefined/false/true). `attributes` is parsed
 * through parseJsonSafeArray and `rating_distribution` through parseJsonSafe — never
 * bare JSON.parse.
 */
import { z } from 'zod';

import db from './db/index.js';
import { parseJsonSafe, parseJsonSafeArray } from './db/json-validation.js';
import { createStmtCache } from './db/stmt-cache.js';

// ── SQLite row shape (mirrors migration 154) ──

export interface BusinessListingSnapshotRow {
  workspace_id: string;
  place_id: string;
  snapshot_date: string;
  is_owned: number | null;
  location_id: string | null;
  market_id: string | null;
  title: string | null;
  domain: string | null;
  cid: string | null;
  category: string | null;
  rating_value: number | null;
  review_count: number | null;
  rating_distribution: string | null;
  attributes: string;
  total_photos: number | null;
  claimed: number | null;
  fetched_at: string;
}

/** Per-star review distribution, e.g. {"1":2,"5":40}. */
export type RatingDistribution = Record<'1' | '2' | '3' | '4' | '5', number>;

/** In-memory shape: NULL columns → `undefined`; tri-state INTEGER → boolean|undefined. */
export interface BusinessListingSnapshot {
  workspaceId: string;
  placeId: string;
  snapshotDate: string;
  isOwned?: boolean;
  locationId?: string;
  marketId?: string;
  title?: string;
  domain?: string;
  cid?: string;
  category?: string;
  /** Star rating; undefined = no reviews (NEVER 0). */
  rating?: number;
  /** Review count; undefined = no reviews (NEVER 0). */
  reviewCount?: number;
  ratingDistribution?: RatingDistribution;
  /** Stored completeness attribute keys (the `attributes` column). */
  attributes: string[];
  totalPhotos?: number;
  claimed?: boolean;
  fetchedAt: string;
}

const ratingDistributionSchema = z.object({
  '1': z.number(),
  '2': z.number(),
  '3': z.number(),
  '4': z.number(),
  '5': z.number(),
});

/** A NULL column maps to `undefined` (omitted by JSON.stringify) — never `null`. */
function nullToUndefined<T>(value: T | null): T | undefined {
  return value === null ? undefined : value;
}

/** Tri-state INTEGER column → boolean|undefined: NULL → undefined, 1 → true, 0 → false.
 *  `false` is a real established value (0), NOT "empty" — do not collapse it to undefined. */
function triStateToBool(n: number | null): boolean | undefined {
  return n === null ? undefined : n === 1;
}

/** Map a raw DB row back to the in-memory BusinessListingSnapshot. */
export function rowToBusinessListingSnapshot(
  row: BusinessListingSnapshotRow,
): BusinessListingSnapshot {
  return {
    workspaceId: row.workspace_id,
    placeId: row.place_id,
    snapshotDate: row.snapshot_date,
    isOwned: triStateToBool(row.is_owned),
    locationId: nullToUndefined(row.location_id),
    marketId: nullToUndefined(row.market_id),
    title: nullToUndefined(row.title),
    domain: nullToUndefined(row.domain),
    cid: nullToUndefined(row.cid),
    category: nullToUndefined(row.category),
    rating: nullToUndefined(row.rating_value),
    reviewCount: nullToUndefined(row.review_count),
    ratingDistribution: parseJsonSafe(
      row.rating_distribution,
      ratingDistributionSchema,
      null,
      { workspaceId: row.workspace_id, table: 'business_listing_snapshots', field: 'rating_distribution' },
    ) ?? undefined,
    attributes: parseJsonSafeArray(row.attributes, z.string(), {
      workspaceId: row.workspace_id,
      table: 'business_listing_snapshots',
      field: 'attributes',
    }),
    totalPhotos: nullToUndefined(row.total_photos),
    claimed: triStateToBool(row.claimed),
    fetchedAt: row.fetched_at,
  };
}

// ── Lazy prepared statements ──

// Retention: keep only the most recent N distinct snapshot dates per workspace
// so the table cannot grow unbounded (mirrors rank_snapshots' 180-date cap).
const SNAPSHOT_RETAIN_DATES = 180;

const stmts = createStmtCache(() => ({
  upsert: db.prepare(`
    INSERT INTO business_listing_snapshots (
      workspace_id, place_id, snapshot_date, is_owned, location_id, market_id,
      title, domain, cid, category, rating_value, review_count,
      rating_distribution, attributes, total_photos, claimed, fetched_at
    ) VALUES (
      @workspace_id, @place_id, @snapshot_date, @is_owned, @location_id, @market_id,
      @title, @domain, @cid, @category, @rating_value, @review_count,
      @rating_distribution, @attributes, @total_photos, @claimed, @fetched_at
    )
    ON CONFLICT(workspace_id, place_id, snapshot_date) DO UPDATE SET
      is_owned = excluded.is_owned,
      location_id = excluded.location_id,
      market_id = excluded.market_id,
      title = excluded.title,
      domain = excluded.domain,
      cid = excluded.cid,
      category = excluded.category,
      rating_value = excluded.rating_value,
      review_count = excluded.review_count,
      rating_distribution = excluded.rating_distribution,
      attributes = excluded.attributes,
      total_photos = excluded.total_photos,
      claimed = excluded.claimed,
      fetched_at = excluded.fetched_at
  `),
  // Latest row per place_id: join each place_id to its max(snapshot_date) within the workspace.
  latestByWs: db.prepare<[workspaceId: string, workspaceId2: string]>(`
    SELECT b.* FROM business_listing_snapshots b
    JOIN (
      SELECT place_id, MAX(snapshot_date) AS max_date
      FROM business_listing_snapshots
      WHERE workspace_id = ?
      GROUP BY place_id
    ) latest ON b.place_id = latest.place_id AND b.snapshot_date = latest.max_date
    WHERE b.workspace_id = ?
    ORDER BY b.place_id ASC
  `),
  latestOwned: db.prepare<[workspaceId: string]>(`
    SELECT * FROM business_listing_snapshots
    WHERE workspace_id = ? AND is_owned = 1
    ORDER BY snapshot_date DESC
    LIMIT 1
  `),
  latestOwnedByLocation: db.prepare<[workspaceId: string, locationId: string]>(`
    SELECT * FROM business_listing_snapshots
    WHERE workspace_id = ? AND is_owned = 1 AND location_id = ?
    ORDER BY snapshot_date DESC
    LIMIT 1
  `),
  // Drop rows older than the most recent SNAPSHOT_RETAIN_DATES distinct snapshot_dates
  // for this workspace (no baseline/earliest-row reader → plain date-window prune).
  // Served by idx_business_listings_owned/_market (both lead with workspace_id, snapshot_date).
  prune: db.prepare(`
    DELETE FROM business_listing_snapshots
    WHERE workspace_id = @ws
      AND snapshot_date NOT IN (
        SELECT DISTINCT snapshot_date FROM business_listing_snapshots
        WHERE workspace_id = @ws ORDER BY snapshot_date DESC LIMIT @keep
      )
  `),
}));

// ── Public API ──

export interface StoreBusinessListingInput {
  placeId: string;
  isOwned?: boolean | null;
  locationId?: string | null;
  marketId?: string | null;
  title?: string | null;
  domain?: string | null;
  cid?: string | null;
  category?: string | null;
  rating?: number | null;
  reviewCount?: number | null;
  ratingDistribution?: RatingDistribution | null;
  attributes?: string[] | null;
  totalPhotos?: number | null;
  claimed?: boolean | null;
}

/** undefined/null in-memory → SQL NULL. */
function toNullableNumber(value: number | null | undefined): number | null {
  return value == null ? null : value;
}
function toNullableText(value: string | null | undefined): string | null {
  return value == null ? null : value;
}
/** boolean|null|undefined → tri-state INTEGER: null/undefined → NULL, true → 1, false → 0. */
function boolToTriState(value: boolean | null | undefined): number | null {
  return value == null ? null : value ? 1 : 0;
}

/**
 * Upsert a batch of business listing snapshots for one (workspace, date). Each
 * entry upserts on (workspace_id, place_id, snapshot_date) — re-running for the
 * same key UPDATES in place (no duplicate rows). Rows with a blank `placeId` are
 * dropped defensively. The whole batch runs in a single transaction (multi-write
 * must be transactional).
 */
export function storeBusinessListingSnapshots(
  workspaceId: string,
  date: string,
  rows: StoreBusinessListingInput[],
): void {
  const fetchedAt = new Date().toISOString();
  const run = db.transaction(() => {
    const upsert = stmts().upsert;
    for (const row of rows) {
      const placeId = row.placeId?.trim();
      if (!placeId) continue; // blank-drop defensively
      upsert.run({
        workspace_id: workspaceId,
        place_id: placeId,
        snapshot_date: date,
        is_owned: boolToTriState(row.isOwned),
        location_id: toNullableText(row.locationId),
        market_id: toNullableText(row.marketId),
        title: toNullableText(row.title),
        domain: toNullableText(row.domain),
        cid: toNullableText(row.cid),
        category: toNullableText(row.category),
        rating_value: toNullableNumber(row.rating),
        review_count: toNullableNumber(row.reviewCount),
        rating_distribution: row.ratingDistribution == null
          ? null
          : JSON.stringify(row.ratingDistribution),
        attributes: JSON.stringify(row.attributes ?? []),
        total_photos: toNullableNumber(row.totalPhotos),
        claimed: boolToTriState(row.claimed),
        fetched_at: fetchedAt,
      });
    }
    stmts().prune.run({ ws: workspaceId, keep: SNAPSHOT_RETAIN_DATES });
  });
  run();
}

/** The most recent snapshot per place_id for a workspace (max(snapshot_date) per place_id). */
export function getLatestBusinessListings(workspaceId: string): BusinessListingSnapshot[] {
  const rows = stmts().latestByWs.all(workspaceId, workspaceId) as BusinessListingSnapshotRow[];
  return rows.map(rowToBusinessListingSnapshot);
}

/**
 * The most recent OWNED (is_owned = 1) listing for a workspace, optionally filtered
 * to a specific location_id. Returns undefined if none exists.
 */
export function getLatestOwnedListing(
  workspaceId: string,
  locationId?: string,
): BusinessListingSnapshot | undefined {
  const row = (
    locationId
      ? stmts().latestOwnedByLocation.get(workspaceId, locationId)
      : stmts().latestOwned.get(workspaceId)
  ) as BusinessListingSnapshotRow | undefined;
  return row ? rowToBusinessListingSnapshot(row) : undefined;
}
