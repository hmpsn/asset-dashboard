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

export const GBP_REVIEW_RESPONSE_STATUSES = {
  DRAFT: 'draft',
  AWAITING_CLIENT: 'awaiting_client',
  CHANGES_REQUESTED: 'changes_requested',
  DECLINED: 'declined',
  APPROVED: 'approved',
  PUBLISHING: 'publishing',
  PUBLISHED: 'published',
  PUBLISH_FAILED: 'publish_failed',
  CANCELLED: 'cancelled',
} as const;

export type GbpReviewResponseStatus =
  (typeof GBP_REVIEW_RESPONSE_STATUSES)[keyof typeof GBP_REVIEW_RESPONSE_STATUSES];

export const GBP_REVIEW_RESPONSE_ACTOR_TYPES = {
  ADMIN: 'admin',
  CLIENT: 'client',
  SYSTEM: 'system',
} as const;

export type GbpReviewResponseActorType =
  (typeof GBP_REVIEW_RESPONSE_ACTOR_TYPES)[keyof typeof GBP_REVIEW_RESPONSE_ACTOR_TYPES];

export const GBP_REVIEW_RESPONSE_EVENT_TYPES = {
  DRAFT_GENERATED: 'draft_generated',
  DRAFT_EDITED: 'draft_edited',
  SENT_TO_CLIENT: 'sent_to_client',
  CLIENT_APPROVED: 'client_approved',
  ADMIN_APPROVED: 'admin_approved',
  CHANGES_REQUESTED: 'changes_requested',
  DECLINED: 'declined',
  PUBLISH_STARTED: 'publish_started',
  PUBLISH_SUCCEEDED: 'publish_succeeded',
  PUBLISH_FAILED: 'publish_failed',
  PUBLISH_RETRIED: 'publish_retried',
} as const;

export type GbpReviewResponseEventType =
  (typeof GBP_REVIEW_RESPONSE_EVENT_TYPES)[keyof typeof GBP_REVIEW_RESPONSE_EVENT_TYPES];

export interface GbpReviewResponseReviewContext extends GbpReviewSummary {
  commentText?: string;
  locationTitle?: string;
}

export interface GbpReviewResponseSummary {
  id: string;
  workspaceId: string;
  reviewResourceName: string;
  googleLocationId: string;
  clientLocationId?: string;
  status: GbpReviewResponseStatus;
  draftText: string;
  editedText?: string;
  sentDeliverableId?: string;
  approvedAt?: string;
  approvedByType?: GbpReviewResponseActorType;
  approvedById?: string;
  publishedAt?: string;
  googleReplyUpdateTime?: string;
  publishJobId?: string;
  lastError?: string;
  createdAt: string;
  updatedAt: string;
  review: GbpReviewResponseReviewContext;
}

export interface GbpReviewResponseEvent {
  id: string;
  responseId: string;
  workspaceId: string;
  type: GbpReviewResponseEventType;
  actorType: GbpReviewResponseActorType;
  actorId?: string;
  note?: string;
  createdAt: string;
}

export interface GbpReviewResponseWorkflowRead {
  connection: GbpConnectionSafe;
  eligibleReviews: GbpReviewResponseReviewContext[];
  responses: GbpReviewResponseSummary[];
  policy: {
    rawReviewTextUsedForDraftingOnly: boolean;
    guidance: string;
  };
}

export interface GbpReviewResponseDraftRequest {
  reviewResourceName: string;
}

export interface GbpReviewResponseUpdateRequest {
  draftText: string;
}

export interface GbpReviewResponseSendToClientRequest {
  note?: string;
}

export interface GbpReviewResponsePublishResponse {
  response: GbpReviewResponseSummary;
  jobId: string;
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
