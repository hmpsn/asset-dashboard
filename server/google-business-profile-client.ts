import { randomUUID } from 'crypto';
import {
  GBP_CONNECTION_STATUSES,
  GBP_LOCATION_SYNC_STATUSES,
  type GbpAccountSummary,
  type GbpLocationSummary,
  type GbpSyncResponse,
} from '../shared/types/google-business-profile.js';
import {
  GoogleProviderError,
  googleJson,
  isGoogleProviderError,
} from './google-provider-client.js';
import {
  disconnectGbpConnection,
  getGbpConnectionTokens,
  markGbpConnectionStatus,
  saveGbpConnectionTokens,
  updateGbpConnectionTokens,
  upsertGbpDiscovery,
} from './google-business-profile-store.js';

export const GBP_SCOPE = 'https://www.googleapis.com/auth/business.manage';

const TOKEN_ENDPOINT = 'https://oauth2.googleapis.com/token';
const REVOKE_ENDPOINT = 'https://oauth2.googleapis.com/revoke';
const AUTH_ENDPOINT = 'https://accounts.google.com/o/oauth2/v2/auth';
const ACCOUNT_MANAGEMENT_BASE = 'https://mybusinessaccountmanagement.googleapis.com/v1';
const BUSINESS_INFORMATION_BASE = 'https://mybusinessbusinessinformation.googleapis.com/v1';
const LOCATION_READ_MASK = [
  'name',
  'title',
  'storefrontAddress',
  'phoneNumbers',
  'categories',
  'metadata',
  'websiteUri',
].join(',');

interface GbpTokenResponse {
  access_token: string;
  refresh_token?: string;
  expires_in?: number;
  scope?: string;
  token_type?: string;
}

interface GbpAccountApiRow {
  name: string;
  accountName?: string;
  permissionLevel?: string;
}

interface GbpAccountsApiResponse {
  accounts?: GbpAccountApiRow[];
  nextPageToken?: string;
}

interface GbpLocationApiRow {
  name: string;
  title?: string;
  websiteUri?: string;
  storefrontAddress?: {
    addressLines?: string[];
    locality?: string;
    administrativeArea?: string;
    postalCode?: string;
    regionCode?: string;
  };
  phoneNumbers?: {
    primaryPhone?: string;
  };
  categories?: {
    primaryCategory?: {
      displayName?: string;
    };
  };
  metadata?: {
    placeId?: string;
  };
}

interface GbpLocationsApiResponse {
  locations?: GbpLocationApiRow[];
  nextPageToken?: string;
}

function googleClientConfig(): { clientId: string; clientSecret: string; redirectUri: string } {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  const redirectUri =
    process.env.GOOGLE_BUSINESS_PROFILE_REDIRECT_URI ||
    process.env.GOOGLE_OAUTH_REDIRECT_URI ||
    'http://localhost:3000/api/google-business-profile/callback';
  if (!clientId || !clientSecret) {
    throw new Error('GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET are required for Google Business Profile OAuth');
  }
  return { clientId, clientSecret, redirectUri };
}

function scopesFromTokenResponse(response: GbpTokenResponse): string[] {
  return (response.scope ?? GBP_SCOPE).split(/\s+/).filter(Boolean);
}

function expiresAt(response: GbpTokenResponse): number | undefined {
  return response.expires_in ? Date.now() + response.expires_in * 1000 : undefined;
}

export function createGbpAuthUrl(state: string): string {
  const { clientId, redirectUri } = googleClientConfig();
  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: 'code',
    scope: GBP_SCOPE,
    access_type: 'offline',
    prompt: 'consent',
    include_granted_scopes: 'true',
    state,
  });
  return `${AUTH_ENDPOINT}?${params.toString()}`;
}

export async function exchangeGbpOAuthCode(code: string): Promise<string> {
  const { clientId, clientSecret, redirectUri } = googleClientConfig();
  const body = new URLSearchParams({
    code,
    client_id: clientId,
    client_secret: clientSecret,
    redirect_uri: redirectUri,
    grant_type: 'authorization_code',
  });
  const token = await googleJson<GbpTokenResponse>({
    endpoint: TOKEN_ENDPOINT,
    source: 'gbp',
    body,
  });
  const connectionId = randomUUID();
  saveGbpConnectionTokens({
    id: connectionId,
    accessToken: token.access_token,
    refreshToken: token.refresh_token,
    expiresAt: expiresAt(token),
    scopes: scopesFromTokenResponse(token),
  });
  return connectionId;
}

export async function getValidGbpAccessToken(): Promise<{ connectionId: string; accessToken: string }> {
  const existing = getGbpConnectionTokens();
  if (!existing) {
    throw new Error('Google Business Profile is not connected');
  }
  if (
    existing.status === GBP_CONNECTION_STATUSES.CONNECTED &&
    existing.expiresAt &&
    existing.expiresAt - Date.now() > 60_000
  ) {
    return { connectionId: existing.id, accessToken: existing.accessToken };
  }
  if (!existing.refreshToken) {
    markGbpConnectionStatus(existing.id, GBP_CONNECTION_STATUSES.RECONNECT_NEEDED);
    throw new Error('Google Business Profile reconnect is required');
  }

  const { clientId, clientSecret } = googleClientConfig();
  const body = new URLSearchParams({
    client_id: clientId,
    client_secret: clientSecret,
    refresh_token: existing.refreshToken,
    grant_type: 'refresh_token',
  });

  try {
    const token = await googleJson<GbpTokenResponse>({
      endpoint: TOKEN_ENDPOINT,
      source: 'gbp',
      body,
    });
    updateGbpConnectionTokens(existing.id, {
      accessToken: token.access_token,
      refreshToken: token.refresh_token,
      expiresAt: expiresAt(token),
      scopes: scopesFromTokenResponse(token),
    });
    return { connectionId: existing.id, accessToken: token.access_token };
  } catch (error) {
    if (isGoogleProviderError(error) && error.status === 400) {
      markGbpConnectionStatus(existing.id, GBP_CONNECTION_STATUSES.RECONNECT_NEEDED);
    }
    throw error;
  }
}

function normalizeAccount(row: GbpAccountApiRow, connectionId: string, syncedAt: string): GbpAccountSummary {
  return {
    id: row.name,
    connectionId,
    resourceName: row.name,
    ...(row.accountName ? { displayName: row.accountName } : {}),
    ...(row.permissionLevel ? { permissionLevel: row.permissionLevel } : {}),
    syncedAt,
  };
}

function normalizeLocation(
  row: GbpLocationApiRow,
  connectionId: string,
  account: GbpAccountSummary,
  syncedAt: string,
): GbpLocationSummary {
  const address = row.storefrontAddress;
  return {
    id: row.name,
    connectionId,
    accountId: account.id,
    accountResourceName: account.resourceName,
    resourceName: row.name,
    ...(row.title ? { title: row.title } : {}),
    ...(row.metadata?.placeId ? { placeId: row.metadata.placeId } : {}),
    ...(row.websiteUri ? { websiteUri: row.websiteUri } : {}),
    ...(row.phoneNumbers?.primaryPhone ? { phoneNumber: row.phoneNumbers.primaryPhone } : {}),
    addressLines: address?.addressLines ?? [],
    ...(address?.locality ? { locality: address.locality } : {}),
    ...(address?.administrativeArea ? { administrativeArea: address.administrativeArea } : {}),
    ...(address?.postalCode ? { postalCode: address.postalCode } : {}),
    ...(address?.regionCode ? { regionCode: address.regionCode } : {}),
    ...(row.categories?.primaryCategory?.displayName ? { categoryName: row.categories.primaryCategory.displayName } : {}),
    syncStatus: GBP_LOCATION_SYNC_STATUSES.AVAILABLE,
    syncedAt,
  };
}

export async function listGbpAccountsFromGoogle(accessToken: string): Promise<GbpAccountSummary[]> {
  const accounts: GbpAccountSummary[] = [];
  let pageToken: string | undefined;
  const syncedAt = new Date().toISOString();
  do {
    const params = new URLSearchParams({ pageSize: '100' });
    if (pageToken) params.set('pageToken', pageToken);
    const response = await googleJson<GbpAccountsApiResponse>({
      endpoint: `${ACCOUNT_MANAGEMENT_BASE}/accounts?${params.toString()}`,
      source: 'gbp',
      token: accessToken,
    });
    for (const account of response.accounts ?? []) {
      accounts.push(normalizeAccount(account, '', syncedAt));
    }
    pageToken = response.nextPageToken;
  } while (pageToken);
  return accounts;
}

export async function listGbpLocationsFromGoogle(
  accessToken: string,
  connectionId: string,
  accounts: GbpAccountSummary[],
): Promise<GbpLocationSummary[]> {
  const locations: GbpLocationSummary[] = [];
  const syncedAt = new Date().toISOString();
  for (const account of accounts) {
    let pageToken: string | undefined;
    do {
      const params = new URLSearchParams({
        pageSize: '100',
        readMask: LOCATION_READ_MASK,
      });
      if (pageToken) params.set('pageToken', pageToken);
      const response = await googleJson<GbpLocationsApiResponse>({
        endpoint: `${BUSINESS_INFORMATION_BASE}/${account.resourceName}/locations?${params.toString()}`,
        source: 'gbp',
        token: accessToken,
      });
      for (const location of response.locations ?? []) {
        locations.push(normalizeLocation(location, connectionId, account, syncedAt));
      }
      pageToken = response.nextPageToken;
    } while (pageToken);
  }
  return locations;
}

export async function syncGbpAccountsAndLocations(): Promise<GbpSyncResponse> {
  const { connectionId, accessToken } = await getValidGbpAccessToken();
  const syncedAt = new Date().toISOString();
  const rawAccounts = await listGbpAccountsFromGoogle(accessToken);
  const accounts = rawAccounts.map(account => ({ ...account, connectionId, syncedAt }));
  const locations = await listGbpLocationsFromGoogle(accessToken, connectionId, accounts);
  upsertGbpDiscovery({ connectionId, accounts, locations, syncedAt });
  return { accountCount: accounts.length, locationCount: locations.length, syncedAt };
}

export async function disconnectGbp(): Promise<void> {
  const existing = getGbpConnectionTokens();
  if (!existing) return;
  try {
    const response = await fetch(REVOKE_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ token: existing.refreshToken ?? existing.accessToken }),
    });
    if (!response.ok && response.status >= 500) {
      throw new GoogleProviderError({
        endpoint: REVOKE_ENDPOINT,
        source: 'gbp',
        kind: 'http',
        status: response.status,
        body: await response.text(),
      });
    }
  } finally {
    disconnectGbpConnection(existing.id);
  }
}
