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
