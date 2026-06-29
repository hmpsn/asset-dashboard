import db from './db/index.js';
import { createStmtCache } from './db/stmt-cache.js';
import {
  decryptIntegrationSecret,
  encryptIntegrationSecret,
} from './integration-encryption.js';
import {
  GBP_CONNECTION_STATUSES,
  GBP_LOCATION_SYNC_STATUSES,
  type GbpAccountSummary,
  type GbpConnectionSafe,
  type GbpConnectionStatus,
  type GbpLocationSummary,
  type WorkspaceGbpLocationMapping,
  type WorkspaceGbpMappingInput,
  type WorkspaceGbpMappingRead,
} from '../shared/types/google-business-profile.js';

interface ConnectionRow {
  id: string;
  encrypted_access_token: string | null;
  encrypted_refresh_token: string | null;
  expires_at: number | null;
  scopes: string;
  status: GbpConnectionStatus;
  last_refresh_at: string | null;
  last_synced_at: string | null;
  revoked_at: string | null;
}

interface AccountRow {
  id: string;
  connection_id: string;
  account_resource_name: string;
  display_name: string | null;
  permission_level: string | null;
  synced_at: string;
}

interface LocationRow {
  id: string;
  connection_id: string;
  account_id: string;
  account_resource_name: string;
  location_resource_name: string;
  title: string | null;
  place_id: string | null;
  website_uri: string | null;
  phone_number: string | null;
  address_line1: string | null;
  address_line2: string | null;
  locality: string | null;
  administrative_area: string | null;
  postal_code: string | null;
  region_code: string | null;
  category_name: string | null;
  sync_status: string;
  synced_at: string;
}

interface MappingRow extends LocationRow {
  workspace_id: string;
  client_location_id: string;
  google_location_id: string;
  is_primary: number;
  mapping_created_at: string;
  mapping_updated_at: string;
}

export interface GbpConnectionTokens {
  id: string;
  accessToken: string;
  refreshToken?: string;
  expiresAt?: number;
  scopes: string[];
  status: GbpConnectionStatus;
}

const stmts = createStmtCache(() => ({
  getActiveConnection: db.prepare(`
    SELECT *
    FROM google_oauth_connections
    WHERE revoked_at IS NULL
    ORDER BY updated_at DESC
    LIMIT 1
  `),
  insertConnection: db.prepare(`
    INSERT INTO google_oauth_connections (
      id, encrypted_access_token, encrypted_refresh_token, expires_at, scopes,
      status, connected_by, last_refresh_at, created_at, updated_at
    )
    VALUES (
      @id, @encryptedAccessToken, @encryptedRefreshToken, @expiresAt, @scopes,
      @status, @connectedBy, @lastRefreshAt, @createdAt, @updatedAt
    )
  `),
  revokeActiveConnections: db.prepare(`
    UPDATE google_oauth_connections
    SET encrypted_access_token = NULL,
        encrypted_refresh_token = NULL,
        status = @status,
        revoked_at = @revokedAt,
        updated_at = @revokedAt
    WHERE revoked_at IS NULL
  `),
  updateConnectionTokens: db.prepare(`
    UPDATE google_oauth_connections
    SET encrypted_access_token = @encryptedAccessToken,
        encrypted_refresh_token = @encryptedRefreshToken,
        expires_at = @expiresAt,
        scopes = @scopes,
        status = @status,
        last_refresh_at = @lastRefreshAt,
        updated_at = @updatedAt
    WHERE id = @id
  `),
  // status-ok: OAuth connection health is not a platform workflow state-machine column.
  markConnectionStatus: db.prepare(`
    UPDATE google_oauth_connections
    SET status = @status, updated_at = @updatedAt -- status-ok: OAuth connection health is not a platform workflow state-machine column.
    WHERE id = @id
  `),
  markConnectionSynced: db.prepare(`
    UPDATE google_oauth_connections
    SET last_synced_at = @syncedAt, updated_at = @syncedAt
    WHERE id = @id
  `),
  disconnectConnection: db.prepare(`
    UPDATE google_oauth_connections
    SET encrypted_access_token = NULL,
        encrypted_refresh_token = NULL,
        status = @status,
        revoked_at = @revokedAt,
        updated_at = @revokedAt
    WHERE revoked_at IS NULL
  `),
  countAccounts: db.prepare(`SELECT COUNT(*) AS count FROM google_business_accounts`),
  countLocations: db.prepare(`SELECT COUNT(*) AS count FROM google_business_locations`),
  countMappedLocations: db.prepare(`SELECT COUNT(*) AS count FROM workspace_google_business_locations`),
  upsertAccount: db.prepare(`
    INSERT INTO google_business_accounts (
      id, connection_id, account_resource_name, display_name, permission_level,
      synced_at, created_at, updated_at
    )
    VALUES (
      @id, @connectionId, @resourceName, @displayName, @permissionLevel,
      @syncedAt, @syncedAt, @syncedAt
    )
    ON CONFLICT(account_resource_name) DO UPDATE SET
      connection_id = excluded.connection_id,
      display_name = excluded.display_name,
      permission_level = excluded.permission_level,
      synced_at = excluded.synced_at,
      updated_at = excluded.updated_at
  `),
  upsertLocation: db.prepare(`
    INSERT INTO google_business_locations (
      id, connection_id, account_id, account_resource_name, location_resource_name,
      title, place_id, website_uri, phone_number, address_line1, address_line2,
      locality, administrative_area, postal_code, region_code, category_name,
      sync_status, synced_at, created_at, updated_at
    )
    VALUES (
      @id, @connectionId, @accountId, @accountResourceName, @resourceName,
      @title, @placeId, @websiteUri, @phoneNumber, @addressLine1, @addressLine2,
      @locality, @administrativeArea, @postalCode, @regionCode, @categoryName,
      @syncStatus, @syncedAt, @syncedAt, @syncedAt
    )
    ON CONFLICT(location_resource_name) DO UPDATE SET
      connection_id = excluded.connection_id,
      account_id = excluded.account_id,
      account_resource_name = excluded.account_resource_name,
      title = excluded.title,
      place_id = excluded.place_id,
      website_uri = excluded.website_uri,
      phone_number = excluded.phone_number,
      address_line1 = excluded.address_line1,
      address_line2 = excluded.address_line2,
      locality = excluded.locality,
      administrative_area = excluded.administrative_area,
      postal_code = excluded.postal_code,
      region_code = excluded.region_code,
      category_name = excluded.category_name,
      sync_status = excluded.sync_status,
      synced_at = excluded.synced_at,
      updated_at = excluded.updated_at
  `),
  listAccounts: db.prepare(`
    SELECT * FROM google_business_accounts
    ORDER BY display_name COLLATE NOCASE, account_resource_name
  `),
  listLocations: db.prepare(`
    SELECT * FROM google_business_locations
    ORDER BY title COLLATE NOCASE, location_resource_name
  `),
  listMappings: db.prepare(`
    SELECT
      m.workspace_id, m.client_location_id, m.google_location_id, m.is_primary,
      m.created_at AS mapping_created_at, m.updated_at AS mapping_updated_at,
      l.*
    FROM workspace_google_business_locations m
    JOIN google_business_locations l ON l.id = m.google_location_id
    WHERE m.workspace_id = ?
    ORDER BY m.is_primary DESC, l.title COLLATE NOCASE, l.location_resource_name
  `),
  clearMappings: db.prepare(`
    DELETE FROM workspace_google_business_locations
    WHERE workspace_id = ?
  `),
  insertMapping: db.prepare(`
    INSERT INTO workspace_google_business_locations (
      workspace_id, client_location_id, google_location_id, is_primary, created_at, updated_at
    )
    VALUES (@workspaceId, @clientLocationId, @googleLocationId, @isPrimary, @createdAt, @updatedAt)
  `),
  getClientLocationWorkspace: db.prepare(`
    SELECT workspace_id FROM client_locations WHERE id = ?
  `),
  getGoogleLocation: db.prepare(`
    SELECT id FROM google_business_locations WHERE id = ?
  `),
  getGoogleLocationMappingWorkspace: db.prepare(`
    SELECT workspace_id
    FROM workspace_google_business_locations
    WHERE google_location_id = ?
    LIMIT 1
  `),
  listMappedWorkspaceIds: db.prepare(`
    SELECT DISTINCT workspace_id
    FROM workspace_google_business_locations
    ORDER BY workspace_id
  `),
}));

function count(stmt: unknown): number {
  return (((stmt as { get: () => { count: number } | undefined }).get())?.count) ?? 0;
}

function splitScopes(scopes: string | null | undefined): string[] {
  return (scopes ?? '').split(/\s+/).filter(Boolean);
}

function rowToAccount(row: AccountRow): GbpAccountSummary {
  return {
    id: row.id,
    connectionId: row.connection_id,
    resourceName: row.account_resource_name,
    ...(row.display_name ? { displayName: row.display_name } : {}),
    ...(row.permission_level ? { permissionLevel: row.permission_level } : {}),
    syncedAt: row.synced_at,
  };
}

function rowToLocation(row: LocationRow): GbpLocationSummary {
  return {
    id: row.id,
    connectionId: row.connection_id,
    accountId: row.account_id,
    accountResourceName: row.account_resource_name,
    resourceName: row.location_resource_name,
    ...(row.title ? { title: row.title } : {}),
    ...(row.place_id ? { placeId: row.place_id } : {}),
    ...(row.website_uri ? { websiteUri: row.website_uri } : {}),
    ...(row.phone_number ? { phoneNumber: row.phone_number } : {}),
    addressLines: [row.address_line1, row.address_line2].filter((line): line is string => Boolean(line)),
    ...(row.locality ? { locality: row.locality } : {}),
    ...(row.administrative_area ? { administrativeArea: row.administrative_area } : {}),
    ...(row.postal_code ? { postalCode: row.postal_code } : {}),
    ...(row.region_code ? { regionCode: row.region_code } : {}),
    ...(row.category_name ? { categoryName: row.category_name } : {}),
    syncStatus: row.sync_status as GbpLocationSummary['syncStatus'],
    syncedAt: row.synced_at,
  };
}

function rowToMapping(row: MappingRow): WorkspaceGbpLocationMapping {
  return {
    workspaceId: row.workspace_id,
    clientLocationId: row.client_location_id,
    googleLocationId: row.google_location_id,
    isPrimary: row.is_primary === 1,
    createdAt: row.mapping_created_at,
    updatedAt: row.mapping_updated_at,
    location: rowToLocation(row),
  };
}

function activeConnectionRow(): ConnectionRow | undefined {
  return stmts().getActiveConnection.get() as ConnectionRow | undefined;
}

export function getGbpConnectionSafe(): GbpConnectionSafe {
  const row = activeConnectionRow();
  if (!row) {
    return {
      configured: false,
      connected: false,
      status: GBP_CONNECTION_STATUSES.DISCONNECTED,
      scopes: [],
      accountCount: count(stmts().countAccounts),
      locationCount: count(stmts().countLocations),
      mappedLocationCount: count(stmts().countMappedLocations),
      needsReconnect: true,
    };
  }
  const scopes = splitScopes(row.scopes);
  const needsReconnect = row.status !== GBP_CONNECTION_STATUSES.CONNECTED || !row.encrypted_refresh_token;
  return {
    configured: true,
    connected: row.status === GBP_CONNECTION_STATUSES.CONNECTED && !needsReconnect,
    status: row.status,
    connectionId: row.id,
    scopes,
    ...(row.expires_at ? { expiresAt: new Date(row.expires_at).toISOString() } : {}),
    ...(row.last_refresh_at ? { lastRefreshAt: row.last_refresh_at } : {}),
    ...(row.last_synced_at ? { lastSyncedAt: row.last_synced_at } : {}),
    ...(row.revoked_at ? { revokedAt: row.revoked_at } : {}),
    accountCount: count(stmts().countAccounts),
    locationCount: count(stmts().countLocations),
    mappedLocationCount: count(stmts().countMappedLocations),
    needsReconnect,
  };
}

export function getGbpConnectionTokens(): GbpConnectionTokens | null {
  const row = activeConnectionRow();
  if (!row?.encrypted_access_token) return null;
  return {
    id: row.id,
    accessToken: decryptIntegrationSecret(row.encrypted_access_token),
    ...(row.encrypted_refresh_token ? { refreshToken: decryptIntegrationSecret(row.encrypted_refresh_token) } : {}),
    ...(row.expires_at ? { expiresAt: row.expires_at } : {}),
    scopes: splitScopes(row.scopes),
    status: row.status,
  };
}

export function saveGbpConnectionTokens(input: {
  id: string;
  accessToken: string;
  refreshToken?: string;
  expiresAt?: number;
  scopes: string[];
  connectedBy?: string;
}): void {
  const now = new Date().toISOString();
  const tx = db.transaction(() => {
    stmts().revokeActiveConnections.run({
      status: GBP_CONNECTION_STATUSES.REVOKED,
      revokedAt: now,
    });
    stmts().insertConnection.run({
      id: input.id,
      encryptedAccessToken: encryptIntegrationSecret(input.accessToken),
      encryptedRefreshToken: input.refreshToken ? encryptIntegrationSecret(input.refreshToken) : null,
      expiresAt: input.expiresAt ?? null,
      scopes: input.scopes.join(' '),
      status: GBP_CONNECTION_STATUSES.CONNECTED,
      connectedBy: input.connectedBy ?? null,
      lastRefreshAt: now,
      createdAt: now,
      updatedAt: now,
    });
  });
  tx();
}

export function updateGbpConnectionTokens(
  connectionId: string,
  input: { accessToken: string; refreshToken?: string; expiresAt?: number; scopes: string[] },
): void {
  const existing = getGbpConnectionTokens();
  const refreshToken = input.refreshToken ?? existing?.refreshToken;
  stmts().updateConnectionTokens.run({
    id: connectionId,
    encryptedAccessToken: encryptIntegrationSecret(input.accessToken),
    encryptedRefreshToken: refreshToken ? encryptIntegrationSecret(refreshToken) : null,
    expiresAt: input.expiresAt ?? null,
    scopes: input.scopes.join(' '),
    status: GBP_CONNECTION_STATUSES.CONNECTED,
    lastRefreshAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  });
}

export function markGbpConnectionStatus(connectionId: string, status: GbpConnectionStatus): void {
  stmts().markConnectionStatus.run({
    id: connectionId,
    status,
    updatedAt: new Date().toISOString(),
  });
}

export function disconnectGbpConnection(_connectionId: string): void {
  stmts().disconnectConnection.run({
    status: GBP_CONNECTION_STATUSES.REVOKED,
    revokedAt: new Date().toISOString(),
  });
}

export function upsertGbpDiscovery(input: {
  connectionId: string;
  accounts: GbpAccountSummary[];
  locations: GbpLocationSummary[];
  syncedAt: string;
}): void {
  const tx = db.transaction(() => {
    for (const account of input.accounts) {
      stmts().upsertAccount.run({
        id: account.id,
        connectionId: input.connectionId,
        resourceName: account.resourceName,
        displayName: account.displayName ?? null,
        permissionLevel: account.permissionLevel ?? null,
        syncedAt: input.syncedAt,
      });
    }
    for (const location of input.locations) {
      stmts().upsertLocation.run({
        id: location.id,
        connectionId: input.connectionId,
        accountId: location.accountId,
        accountResourceName: location.accountResourceName,
        resourceName: location.resourceName,
        title: location.title ?? null,
        placeId: location.placeId ?? null,
        websiteUri: location.websiteUri ?? null,
        phoneNumber: location.phoneNumber ?? null,
        addressLine1: location.addressLines[0] ?? null,
        addressLine2: location.addressLines[1] ?? null,
        locality: location.locality ?? null,
        administrativeArea: location.administrativeArea ?? null,
        postalCode: location.postalCode ?? null,
        regionCode: location.regionCode ?? null,
        categoryName: location.categoryName ?? null,
        syncStatus: GBP_LOCATION_SYNC_STATUSES.AVAILABLE,
        syncedAt: input.syncedAt,
      });
    }
    stmts().markConnectionSynced.run({ id: input.connectionId, syncedAt: input.syncedAt });
  });
  tx();
}

export function listGbpAccounts(): GbpAccountSummary[] {
  return (stmts().listAccounts.all() as AccountRow[]).map(rowToAccount);
}

export function listGbpLocations(): GbpLocationSummary[] {
  return (stmts().listLocations.all() as LocationRow[]).map(rowToLocation);
}

export function listGbpMappedWorkspaceIds(): string[] {
  return (stmts().listMappedWorkspaceIds.all() as Array<{ workspace_id: string }>).map((row) => row.workspace_id);
}

export function getWorkspaceGbpMappingRead(workspaceId: string): WorkspaceGbpMappingRead {
  return {
    connection: getGbpConnectionSafe(),
    locations: listGbpLocations(),
    mappings: (stmts().listMappings.all(workspaceId) as MappingRow[]).map(rowToMapping),
  };
}

export function replaceWorkspaceGbpMappings(
  workspaceId: string,
  mappings: WorkspaceGbpMappingInput[],
): WorkspaceGbpMappingRead {
  const now = new Date().toISOString();
  const tx = db.transaction(() => {
    for (const mapping of mappings) {
      const clientLocation = stmts().getClientLocationWorkspace.get(mapping.clientLocationId) as { workspace_id: string } | undefined;
      if (!clientLocation || clientLocation.workspace_id !== workspaceId) {
        throw new Error('Client location does not belong to this workspace');
      }
      const googleLocation = stmts().getGoogleLocation.get(mapping.googleLocationId) as { id: string } | undefined;
      if (!googleLocation) {
        throw new Error('Google Business Profile location was not found');
      }
      const existingMapping = stmts().getGoogleLocationMappingWorkspace.get(mapping.googleLocationId) as { workspace_id: string } | undefined;
      if (existingMapping && existingMapping.workspace_id !== workspaceId) {
        throw new Error('Google Business Profile location is already mapped to another workspace');
      }
    }
    stmts().clearMappings.run(workspaceId);
    for (const mapping of mappings) {
      stmts().insertMapping.run({
        workspaceId,
        clientLocationId: mapping.clientLocationId,
        googleLocationId: mapping.googleLocationId,
        isPrimary: mapping.isPrimary ? 1 : 0,
        createdAt: now,
        updatedAt: now,
      });
    }
  });
  tx();
  return getWorkspaceGbpMappingRead(workspaceId);
}
