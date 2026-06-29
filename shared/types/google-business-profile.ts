export const GBP_CONNECTION_STATUSES = {
  DISCONNECTED: 'disconnected',
  CONNECTED: 'connected',
  RECONNECT_NEEDED: 'reconnect_needed',
  REVOKED: 'revoked',
} as const;

export type GbpConnectionStatus =
  (typeof GBP_CONNECTION_STATUSES)[keyof typeof GBP_CONNECTION_STATUSES];

export const GBP_LOCATION_SYNC_STATUSES = {
  AVAILABLE: 'available',
  MAPPED: 'mapped',
  UNAVAILABLE: 'unavailable',
} as const;

export type GbpLocationSyncStatus =
  (typeof GBP_LOCATION_SYNC_STATUSES)[keyof typeof GBP_LOCATION_SYNC_STATUSES];

export interface GbpConnectionSafe {
  configured: boolean;
  connected: boolean;
  status: GbpConnectionStatus;
  connectionId?: string;
  scopes: string[];
  expiresAt?: string;
  lastRefreshAt?: string;
  lastSyncedAt?: string;
  revokedAt?: string;
  accountCount: number;
  locationCount: number;
  mappedLocationCount: number;
  needsReconnect: boolean;
}

export interface GbpAccountSummary {
  id: string;
  connectionId: string;
  resourceName: string;
  displayName?: string;
  permissionLevel?: string;
  syncedAt: string;
}

export interface GbpLocationSummary {
  id: string;
  connectionId: string;
  accountId: string;
  accountResourceName: string;
  resourceName: string;
  title?: string;
  placeId?: string;
  websiteUri?: string;
  phoneNumber?: string;
  addressLines: string[];
  locality?: string;
  administrativeArea?: string;
  postalCode?: string;
  regionCode?: string;
  categoryName?: string;
  syncStatus: GbpLocationSyncStatus;
  syncedAt: string;
}

export interface WorkspaceGbpLocationMapping {
  workspaceId: string;
  clientLocationId: string;
  googleLocationId: string;
  isPrimary: boolean;
  createdAt: string;
  updatedAt: string;
  location: GbpLocationSummary;
}

export interface WorkspaceGbpMappingInput {
  clientLocationId: string;
  googleLocationId: string;
  isPrimary?: boolean;
}

export interface WorkspaceGbpMappingsUpdateRequest {
  mappings: WorkspaceGbpMappingInput[];
}

export interface WorkspaceGbpMappingRead {
  connection: GbpConnectionSafe;
  locations: GbpLocationSummary[];
  mappings: WorkspaceGbpLocationMapping[];
}

export interface GbpSyncResponse {
  accountCount: number;
  locationCount: number;
  syncedAt: string;
}

export const GBP_REVIEW_SYNC_STATUSES = {
  NOT_SYNCED: 'not_synced',
  SYNCED: 'synced',
  PARTIAL: 'partial',
  FAILED: 'failed',
} as const;

export type GbpReviewSyncStatus =
  (typeof GBP_REVIEW_SYNC_STATUSES)[keyof typeof GBP_REVIEW_SYNC_STATUSES];

export const GBP_REVIEW_RATINGS = {
  UNSPECIFIED: 'STAR_RATING_UNSPECIFIED',
  ONE: 'ONE',
  TWO: 'TWO',
  THREE: 'THREE',
  FOUR: 'FOUR',
  FIVE: 'FIVE',
} as const;

export type GbpReviewRating =
  (typeof GBP_REVIEW_RATINGS)[keyof typeof GBP_REVIEW_RATINGS];

export interface GbpReviewSummary {
  id: string;
  googleLocationId: string;
  clientLocationId?: string;
  reviewResourceName: string;
  reviewId: string;
  rating: GbpReviewRating;
  ratingValue?: number;
  commentExcerpt?: string;
  reviewerDisplayName?: string;
  reviewerIsAnonymous: boolean;
  createTime?: string;
  updateTime?: string;
  hasReply: boolean;
  replyUpdateTime?: string;
  syncedAt: string;
}

export interface GbpLocationReviewSummary {
  googleLocationId: string;
  clientLocationId: string;
  isPrimary: boolean;
  location: GbpLocationSummary;
  syncStatus: GbpReviewSyncStatus;
  lastSyncedAt?: string;
  lastError?: string;
  averageRating?: number;
  totalReviewCount?: number;
  storedReviewCount: number;
  newestReviewAt?: string;
  unansweredCount: number;
  lowRatingCount: number;
}

export interface GbpAuthenticatedReviewsRead {
  connection: GbpConnectionSafe;
  mappedLocationCount: number;
  locations: GbpLocationReviewSummary[];
  recentReviews: GbpReviewSummary[];
  aggregate: {
    averageRating?: number;
    totalReviewCount: number;
    storedReviewCount: number;
    unansweredCount: number;
    lowRatingCount: number;
    newestReviewAt?: string;
    lastSyncedAt?: string;
  };
  copyPolicy: {
    rawReviewTextStored: boolean;
    aiUseAllowed: boolean;
    guidance: string;
  };
}

export interface GbpReviewSyncResponse {
  workspaceId: string;
  locationCount: number;
  reviewCount: number;
  syncedAt: string;
  partial: boolean;
}
