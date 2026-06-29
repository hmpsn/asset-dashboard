import db from './db/index.js';
import { createStmtCache } from './db/stmt-cache.js';
import {
  GBP_REVIEW_RATINGS,
  GBP_REVIEW_SYNC_STATUSES,
  type GbpAuthenticatedReviewsRead,
  type GbpLocationReviewSummary,
  type GbpReviewRating,
  type GbpReviewSummary,
  type GbpReviewSyncStatus,
  type GbpLocationSummary,
} from '../shared/types/google-business-profile.js';
import { getGbpConnectionSafe, getWorkspaceGbpMappingRead } from './google-business-profile-store.js';

export interface GbpReviewUpsertInput {
  workspaceId: string;
  googleLocationId: string;
  clientLocationId: string;
  reviewResourceName: string;
  reviewId: string;
  rating: GbpReviewRating;
  ratingValue?: number;
  comment?: string;
  reviewerDisplayName?: string;
  reviewerIsAnonymous: boolean;
  createTime?: string;
  updateTime?: string;
  replyComment?: string;
  replyUpdateTime?: string;
  replyState?: string;
}

export interface GbpReviewLocationSyncInput {
  workspaceId: string;
  googleLocationId: string;
  clientLocationId: string;
  status: GbpReviewSyncStatus;
  averageRating?: number;
  totalReviewCount?: number;
  lastError?: string;
  nextPageToken?: string;
}

interface ReviewRow {
  id: string;
  workspace_id: string;
  google_location_id: string;
  client_location_id: string | null;
  review_resource_name: string;
  review_id: string;
  star_rating: GbpReviewRating;
  rating_value: number | null;
  comment: string | null;
  reviewer_display_name: string | null;
  reviewer_is_anonymous: number;
  create_time: string | null;
  update_time: string | null;
  reply_comment: string | null;
  reply_update_time: string | null;
  reply_state: string | null;
  synced_at: string;
}

interface LocationSummaryRow {
  google_location_id: string;
  stored_review_count: number;
  newest_review_at: string | null;
  unanswered_count: number;
  low_rating_count: number;
}

interface SyncStatusRow {
  google_location_id: string;
  workspace_id: string;
  client_location_id: string | null;
  sync_status: GbpReviewSyncStatus;
  average_rating: number | null;
  total_review_count: number | null;
  last_synced_at: string | null;
  last_error: string | null;
  next_page_token: string | null;
}

const stmts = createStmtCache(() => ({
  upsertReview: db.prepare(`
    INSERT INTO google_business_reviews (
      id, workspace_id, google_location_id, client_location_id, review_resource_name, review_id,
      star_rating, rating_value, comment, reviewer_display_name, reviewer_is_anonymous,
      create_time, update_time, reply_comment, reply_update_time, reply_state,
      synced_at, created_at, updated_at
    )
    VALUES (
      @id, @workspaceId, @googleLocationId, @clientLocationId, @reviewResourceName, @reviewId,
      @rating, @ratingValue, @comment, @reviewerDisplayName, @reviewerIsAnonymous,
      @createTime, @updateTime, @replyComment, @replyUpdateTime, @replyState,
      @syncedAt, @syncedAt, @syncedAt
    )
    ON CONFLICT(review_resource_name) DO UPDATE SET
      workspace_id = excluded.workspace_id,
      google_location_id = excluded.google_location_id,
      client_location_id = excluded.client_location_id,
      review_id = excluded.review_id,
      star_rating = excluded.star_rating,
      rating_value = excluded.rating_value,
      comment = excluded.comment,
      reviewer_display_name = excluded.reviewer_display_name,
      reviewer_is_anonymous = excluded.reviewer_is_anonymous,
      create_time = excluded.create_time,
      update_time = excluded.update_time,
      reply_comment = excluded.reply_comment,
      reply_update_time = excluded.reply_update_time,
      reply_state = excluded.reply_state,
      synced_at = excluded.synced_at,
      updated_at = excluded.updated_at
  `),
  upsertSyncStatus: db.prepare(`
    INSERT INTO google_business_review_sync_status (
      google_location_id, workspace_id, client_location_id, sync_status,
      average_rating, total_review_count, last_synced_at, last_error, next_page_token,
      created_at, updated_at
    )
    VALUES (
      @googleLocationId, @workspaceId, @clientLocationId, @syncStatus,
      @averageRating, @totalReviewCount, @lastSyncedAt, @lastError, @nextPageToken,
      @updatedAt, @updatedAt
    )
    ON CONFLICT(google_location_id) DO UPDATE SET
      workspace_id = excluded.workspace_id,
      client_location_id = excluded.client_location_id,
      sync_status = excluded.sync_status,
      average_rating = excluded.average_rating,
      total_review_count = excluded.total_review_count,
      last_synced_at = excluded.last_synced_at,
      last_error = excluded.last_error,
      next_page_token = excluded.next_page_token,
      updated_at = excluded.updated_at
  `),
  listRecentReviews: db.prepare(`
    SELECT r.*
    FROM google_business_reviews r
    JOIN workspace_google_business_locations m
      ON m.workspace_id = r.workspace_id
      AND m.google_location_id = r.google_location_id
    WHERE r.workspace_id = ?
    ORDER BY COALESCE(r.update_time, r.create_time, r.synced_at) DESC
    LIMIT ?
  `),
  listLocationSummaries: db.prepare(`
    SELECT
      google_location_id,
      COUNT(*) AS stored_review_count,
      MAX(COALESCE(update_time, create_time)) AS newest_review_at,
      COALESCE(SUM(CASE WHEN reply_comment IS NULL OR TRIM(reply_comment) = '' THEN 1 ELSE 0 END), 0) AS unanswered_count,
      COALESCE(SUM(CASE WHEN rating_value IS NOT NULL AND rating_value <= 3 THEN 1 ELSE 0 END), 0) AS low_rating_count
    FROM google_business_reviews
    WHERE workspace_id = ?
    GROUP BY google_location_id
  `),
  listSyncStatuses: db.prepare(`
    SELECT *
    FROM google_business_review_sync_status
    WHERE workspace_id = ?
  `),
  upsertFailedSyncStatus: db.prepare(`
    INSERT INTO google_business_review_sync_status (
      google_location_id, workspace_id, client_location_id, sync_status,
      average_rating, total_review_count, last_synced_at, last_error, next_page_token,
      created_at, updated_at
    )
    VALUES (
      @googleLocationId, @workspaceId, @clientLocationId, @syncStatus,
      @averageRating, @totalReviewCount, @lastSyncedAt, @lastError, @nextPageToken,
      @updatedAt, @updatedAt
    )
    ON CONFLICT(google_location_id) DO UPDATE SET
      workspace_id = excluded.workspace_id,
      client_location_id = excluded.client_location_id,
      sync_status = excluded.sync_status,
      average_rating = COALESCE(excluded.average_rating, google_business_review_sync_status.average_rating),
      total_review_count = COALESCE(excluded.total_review_count, google_business_review_sync_status.total_review_count),
      last_synced_at = COALESCE(excluded.last_synced_at, google_business_review_sync_status.last_synced_at),
      last_error = excluded.last_error,
      next_page_token = COALESCE(excluded.next_page_token, google_business_review_sync_status.next_page_token),
      updated_at = excluded.updated_at
  `),
}));

function ratingValue(rating: GbpReviewRating): number | undefined {
  switch (rating) {
    case GBP_REVIEW_RATINGS.ONE: return 1;
    case GBP_REVIEW_RATINGS.TWO: return 2;
    case GBP_REVIEW_RATINGS.THREE: return 3;
    case GBP_REVIEW_RATINGS.FOUR: return 4;
    case GBP_REVIEW_RATINGS.FIVE: return 5;
    default: return undefined;
  }
}

export function normalizeGbpReviewRating(value: string | undefined): GbpReviewRating {
  const values = Object.values(GBP_REVIEW_RATINGS);
  return values.includes(value as GbpReviewRating) ? value as GbpReviewRating : GBP_REVIEW_RATINGS.UNSPECIFIED;
}

function reviewPrimaryKey(resourceName: string): string {
  return resourceName;
}

function excerpt(value: string | null): string | undefined {
  const cleaned = (value ?? '').replace(/\s+/g, ' ').trim();
  if (!cleaned) return undefined;
  return cleaned.length > 260 ? `${cleaned.slice(0, 257).trim()}...` : cleaned;
}

function rowToReview(row: ReviewRow): GbpReviewSummary {
  return {
    id: row.id,
    googleLocationId: row.google_location_id,
    ...(row.client_location_id ? { clientLocationId: row.client_location_id } : {}),
    reviewResourceName: row.review_resource_name,
    reviewId: row.review_id,
    rating: row.star_rating,
    ...(typeof row.rating_value === 'number' ? { ratingValue: row.rating_value } : {}),
    ...(excerpt(row.comment) ? { commentExcerpt: excerpt(row.comment) } : {}),
    ...(row.reviewer_display_name ? { reviewerDisplayName: row.reviewer_display_name } : {}),
    reviewerIsAnonymous: row.reviewer_is_anonymous === 1,
    ...(row.create_time ? { createTime: row.create_time } : {}),
    ...(row.update_time ? { updateTime: row.update_time } : {}),
    hasReply: Boolean(row.reply_comment?.trim()),
    ...(row.reply_update_time ? { replyUpdateTime: row.reply_update_time } : {}),
    syncedAt: row.synced_at,
  };
}

function mapByLocation<T extends { google_location_id: string }>(rows: T[]): Map<string, T> {
  return new Map(rows.map(row => [row.google_location_id, row]));
}

export function upsertGbpReviewsForLocation(input: {
  workspaceId: string;
  googleLocationId: string;
  clientLocationId: string;
  reviews: GbpReviewUpsertInput[];
  averageRating?: number;
  totalReviewCount?: number;
  nextPageToken?: string;
  syncedAt: string;
}): void {
  const tx = db.transaction(() => {
    for (const review of input.reviews) {
      const rating = normalizeGbpReviewRating(review.rating);
      stmts().upsertReview.run({
        id: reviewPrimaryKey(review.reviewResourceName),
        workspaceId: input.workspaceId,
        googleLocationId: input.googleLocationId,
        clientLocationId: input.clientLocationId,
        reviewResourceName: review.reviewResourceName,
        reviewId: review.reviewId,
        rating,
        ratingValue: review.ratingValue ?? ratingValue(rating) ?? null,
        comment: review.comment ?? null,
        reviewerDisplayName: review.reviewerDisplayName ?? null,
        reviewerIsAnonymous: review.reviewerIsAnonymous ? 1 : 0,
        createTime: review.createTime ?? null,
        updateTime: review.updateTime ?? null,
        replyComment: review.replyComment ?? null,
        replyUpdateTime: review.replyUpdateTime ?? null,
        replyState: review.replyState ?? null,
        syncedAt: input.syncedAt,
      });
    }
    stmts().upsertSyncStatus.run({
      googleLocationId: input.googleLocationId,
      workspaceId: input.workspaceId,
      clientLocationId: input.clientLocationId,
      syncStatus: input.nextPageToken ? GBP_REVIEW_SYNC_STATUSES.PARTIAL : GBP_REVIEW_SYNC_STATUSES.SYNCED,
      averageRating: input.averageRating ?? null,
      totalReviewCount: input.totalReviewCount ?? null,
      lastSyncedAt: input.syncedAt,
      lastError: null,
      nextPageToken: input.nextPageToken ?? null,
      updatedAt: input.syncedAt,
    });
  });
  tx();
}

export function markGbpReviewSyncFailed(input: GbpReviewLocationSyncInput): void {
  const now = new Date().toISOString();
  stmts().upsertFailedSyncStatus.run({
    googleLocationId: input.googleLocationId,
    workspaceId: input.workspaceId,
    clientLocationId: input.clientLocationId,
    syncStatus: GBP_REVIEW_SYNC_STATUSES.FAILED,
    averageRating: input.averageRating ?? null,
    totalReviewCount: input.totalReviewCount ?? null,
    lastSyncedAt: null,
    lastError: input.lastError ?? 'Google Business Profile review sync failed',
    nextPageToken: input.nextPageToken ?? null,
    updatedAt: now,
  });
}

export function getWorkspaceGbpAuthenticatedReviews(workspaceId: string): GbpAuthenticatedReviewsRead {
  const connection = getGbpConnectionSafe();
  const mappingRead = getWorkspaceGbpMappingRead(workspaceId);
  const summaries = mapByLocation(stmts().listLocationSummaries.all(workspaceId) as LocationSummaryRow[]);
  const statuses = mapByLocation(stmts().listSyncStatuses.all(workspaceId) as SyncStatusRow[]);
  const locations: GbpLocationReviewSummary[] = mappingRead.mappings.map(mapping => {
    const summary = summaries.get(mapping.googleLocationId);
    const status = statuses.get(mapping.googleLocationId);
    return {
      googleLocationId: mapping.googleLocationId,
      clientLocationId: mapping.clientLocationId,
      isPrimary: mapping.isPrimary,
      location: mapping.location as GbpLocationSummary,
      syncStatus: status?.sync_status ?? GBP_REVIEW_SYNC_STATUSES.NOT_SYNCED,
      ...(status?.last_synced_at ? { lastSyncedAt: status.last_synced_at } : {}),
      ...(status?.last_error ? { lastError: status.last_error } : {}),
      ...(typeof status?.average_rating === 'number' ? { averageRating: status.average_rating } : {}),
      ...(typeof status?.total_review_count === 'number' ? { totalReviewCount: status.total_review_count } : {}),
      storedReviewCount: summary?.stored_review_count ?? 0,
      ...(summary?.newest_review_at ? { newestReviewAt: summary.newest_review_at } : {}),
      unansweredCount: summary?.unanswered_count ?? 0,
      lowRatingCount: summary?.low_rating_count ?? 0,
    };
  });
  const recentReviews = connection.connected
    ? (stmts().listRecentReviews.all(workspaceId, 20) as ReviewRow[]).map(rowToReview)
    : [];
  const totalReviewCount = locations.reduce((sum, location) => sum + (location.totalReviewCount ?? location.storedReviewCount), 0);
  const storedReviewCount = locations.reduce((sum, location) => sum + location.storedReviewCount, 0);
  const unansweredCount = locations.reduce((sum, location) => sum + location.unansweredCount, 0);
  const lowRatingCount = locations.reduce((sum, location) => sum + location.lowRatingCount, 0);
  const weightedRatingNumerator = locations.reduce((sum, location) => {
    const count = location.totalReviewCount ?? location.storedReviewCount;
    return sum + (location.averageRating && count ? location.averageRating * count : 0);
  }, 0);
  const newestReviewAt = locations
    .map(location => location.newestReviewAt)
    .filter((value): value is string => Boolean(value))
    .sort()
    .at(-1);
  const lastSyncedAt = locations
    .map(location => location.lastSyncedAt)
    .filter((value): value is string => Boolean(value))
    .sort()
    .at(-1);

  return {
    connection,
    mappedLocationCount: mappingRead.mappings.length,
    locations,
    recentReviews,
    aggregate: {
      ...(weightedRatingNumerator && totalReviewCount ? { averageRating: weightedRatingNumerator / totalReviewCount } : {}),
      totalReviewCount,
      storedReviewCount,
      unansweredCount,
      lowRatingCount,
      ...(newestReviewAt ? { newestReviewAt } : {}),
      ...(lastSyncedAt ? { lastSyncedAt } : {}),
    },
    copyPolicy: {
      rawReviewTextStored: true,
      aiUseAllowed: false,
      guidance: 'Authenticated review text is stored for admin triage only in Phase 2B. Do not use raw review text in AI or generated copy until explicit review-text policy controls ship.',
    },
  };
}

export function getWorkspaceGbpReviewSyncTargets(workspaceId: string) {
  return getWorkspaceGbpMappingRead(workspaceId).mappings.map(mapping => ({
    workspaceId,
    clientLocationId: mapping.clientLocationId,
    googleLocationId: mapping.googleLocationId,
    accountResourceName: mapping.location.accountResourceName,
    locationResourceName: mapping.location.resourceName,
  }));
}
