import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import db from '../../server/db/index.js';
import {
  GLOBAL_KEY,
  disconnect,
  disconnectGlobal,
  exchangeCode,
  getAuthUrl,
  getGlobalAuthUrl,
  getGlobalToken,
  getGoogleCredentials,
  getValidToken,
  isConnected,
  isGlobalConnected,
} from '../../server/google-auth.js';

const SITE_PREFIX = 'google-auth-test';
const SITE_ID = `${SITE_PREFIX}-site`;
const OTHER_SITE_ID = `${SITE_PREFIX}-other`;

const originalEnv = {
  GOOGLE_CLIENT_ID: process.env.GOOGLE_CLIENT_ID,
  GOOGLE_CLIENT_SECRET: process.env.GOOGLE_CLIENT_SECRET,
  GOOGLE_REDIRECT_URI: process.env.GOOGLE_REDIRECT_URI,
};

function cleanup(): void {
  db.prepare(`DELETE FROM google_tokens WHERE site_id LIKE ? OR site_id = ?`)
    .run(`${SITE_PREFIX}-%`, GLOBAL_KEY);
}

function setGoogleEnv(): void {
  process.env.GOOGLE_CLIENT_ID = 'client-id';
  process.env.GOOGLE_CLIENT_SECRET = 'client-secret';
  process.env.GOOGLE_REDIRECT_URI = 'https://app.example.com/api/google/callback';
}

function restoreGoogleEnv(): void {
  for (const [key, value] of Object.entries(originalEnv)) {
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }
}

function saveToken(siteId: string, overrides: {
  accessToken?: string;
  refreshToken?: string | null;
  expiresAt?: number;
  scope?: string;
} = {}): void {
  db.prepare(`
    INSERT OR REPLACE INTO google_tokens (site_id, access_token, refresh_token, expires_at, scope)
    VALUES (?, ?, ?, ?, ?)
  `).run(
    siteId,
    overrides.accessToken ?? `${siteId}-access`,
    overrides.refreshToken ?? `${siteId}-refresh`,
    overrides.expiresAt ?? Date.now() + 60 * 60 * 1000,
    overrides.scope ?? 'scope-a scope-b',
  );
}

function tokenRow(siteId: string): {
  access_token: string;
  refresh_token: string | null;
  expires_at: number;
  scope: string;
} | undefined {
  return db.prepare(`
    SELECT access_token, refresh_token, expires_at, scope
    FROM google_tokens
    WHERE site_id = ?
  `).get(siteId) as {
    access_token: string;
    refresh_token: string | null;
    expires_at: number;
    scope: string;
  } | undefined;
}

function mockJsonFetch(payload: unknown, status = 200): ReturnType<typeof vi.fn> {
  const response = new Response(JSON.stringify(payload), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
  const fetchMock = vi.fn(async () => response);
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

beforeEach(() => {
  cleanup();
  setGoogleEnv();
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-05-05T12:00:00.000Z'));
});

afterEach(() => {
  cleanup();
  restoreGoogleEnv();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('google-auth', () => {
  it('returns null credentials when required env vars are missing', () => {
    delete process.env.GOOGLE_CLIENT_ID;
    expect(getGoogleCredentials()).toBeNull();

    process.env.GOOGLE_CLIENT_ID = 'client-id';
    delete process.env.GOOGLE_CLIENT_SECRET;
    expect(getGoogleCredentials()).toBeNull();
  });

  it('uses configured credentials and falls back to the local callback URL', () => {
    delete process.env.GOOGLE_REDIRECT_URI;

    expect(getGoogleCredentials()).toEqual({
      clientId: 'client-id',
      clientSecret: 'client-secret',
      redirectUri: 'http://localhost:3000/api/google/callback',
    });
  });

  it('builds site and global OAuth URLs with the expected scopes and state', () => {
    const url = getAuthUrl(SITE_ID);
    expect(url).not.toBeNull();

    const parsed = new URL(url!);
    expect(parsed.origin + parsed.pathname).toBe('https://accounts.google.com/o/oauth2/v2/auth');
    expect(parsed.searchParams.get('client_id')).toBe('client-id');
    expect(parsed.searchParams.get('redirect_uri')).toBe('https://app.example.com/api/google/callback');
    expect(parsed.searchParams.get('response_type')).toBe('code');
    expect(parsed.searchParams.get('access_type')).toBe('offline');
    expect(parsed.searchParams.get('prompt')).toBe('consent');
    expect(parsed.searchParams.get('state')).toBe(SITE_ID);
    expect(parsed.searchParams.get('scope')).toContain('webmasters.readonly');
    expect(parsed.searchParams.get('scope')).toContain('analytics.readonly');

    const globalUrl = getGlobalAuthUrl();
    expect(globalUrl).not.toBeNull();
    expect(new URL(globalUrl!).searchParams.get('state')).toBe(GLOBAL_KEY);
  });

  it('returns null auth URLs when credentials are unavailable', () => {
    delete process.env.GOOGLE_CLIENT_ID;

    expect(getAuthUrl(SITE_ID)).toBeNull();
    expect(getGlobalAuthUrl()).toBeNull();
  });

  it('exchanges an authorization code and stores returned tokens', async () => {
    const fetchMock = mockJsonFetch({
      access_token: 'new-access',
      refresh_token: 'new-refresh',
      expires_in: 3600,
      scope: 'scope-a scope-b',
    });

    await expect(exchangeCode('auth-code', SITE_ID)).resolves.toEqual({ success: true });

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://oauth2.googleapis.com/token');
    expect(init.method).toBe('POST');
    expect(init.headers).toEqual({ 'Content-Type': 'application/x-www-form-urlencoded' });
    const body = init.body as URLSearchParams;
    expect(body.get('grant_type')).toBe('authorization_code');
    expect(body.get('code')).toBe('auth-code');
    expect(body.get('client_id')).toBe('client-id');
    expect(body.get('client_secret')).toBe('client-secret');
    expect(body.get('redirect_uri')).toBe('https://app.example.com/api/google/callback');

    expect(tokenRow(SITE_ID)).toMatchObject({
      access_token: 'new-access',
      refresh_token: 'new-refresh',
      expires_at: Date.now() + 3600 * 1000,
      scope: 'scope-a scope-b',
    });
  });

  it('does not store tokens when exchange fails or credentials are missing', async () => {
    mockJsonFetch({ error: 'invalid_grant' }, 400);

    await expect(exchangeCode('bad-code', SITE_ID)).resolves.toEqual({
      success: false,
      error: 'Token exchange failed: 400',
    });
    expect(isConnected(SITE_ID)).toBe(false);

    delete process.env.GOOGLE_CLIENT_ID;
    await expect(exchangeCode('missing-env', SITE_ID)).resolves.toEqual({
      success: false,
      error: 'Google credentials not configured',
    });
  });

  it('returns an error when token exchange throws', async () => {
    const throwingFetch = vi.fn(async () => {
      throw new TypeError('network failed');
    });
    vi.stubGlobal('fetch', throwingFetch);

    await expect(exchangeCode('network-error', SITE_ID)).resolves.toEqual({
      success: false,
      error: 'TypeError: network failed',
    });
    expect(isConnected(SITE_ID)).toBe(false);
  });

  it('returns a fresh per-site token without refreshing', async () => {
    saveToken(SITE_ID, { accessToken: 'fresh-access' });
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    await expect(getValidToken(SITE_ID)).resolves.toBe('fresh-access');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('falls back to a fresh global token when the site has no token', async () => {
    saveToken(GLOBAL_KEY, { accessToken: 'global-access' });

    await expect(getValidToken(OTHER_SITE_ID)).resolves.toBe('global-access');
    await expect(getGlobalToken()).resolves.toBe('global-access');
  });

  it('refreshes expired tokens and preserves the refresh token and scope', async () => {
    saveToken(SITE_ID, {
      accessToken: 'expired-access',
      refreshToken: 'refresh-me',
      expiresAt: Date.now() - 1000,
      scope: 'old-scope',
    });
    const fetchMock = mockJsonFetch({
      access_token: 'refreshed-access',
      expires_in: 7200,
    });

    await expect(getValidToken(SITE_ID)).resolves.toBe('refreshed-access');

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    const body = init.body as URLSearchParams;
    expect(body.get('grant_type')).toBe('refresh_token');
    expect(body.get('refresh_token')).toBe('refresh-me');

    expect(tokenRow(SITE_ID)).toMatchObject({
      access_token: 'refreshed-access',
      refresh_token: 'refresh-me',
      expires_at: Date.now() + 7200 * 1000,
      scope: 'old-scope',
    });
  });

  it('refreshes an expired global fallback token under the global key', async () => {
    saveToken(GLOBAL_KEY, {
      accessToken: 'expired-global-access',
      refreshToken: 'global-refresh',
      expiresAt: Date.now() - 1000,
      scope: 'global-scope',
    });
    mockJsonFetch({
      access_token: 'refreshed-global-access',
      expires_in: 1800,
    });

    await expect(getValidToken(OTHER_SITE_ID)).resolves.toBe('refreshed-global-access');

    expect(tokenRow(OTHER_SITE_ID)).toBeUndefined();
    expect(tokenRow(GLOBAL_KEY)).toMatchObject({
      access_token: 'refreshed-global-access',
      refresh_token: 'global-refresh',
      expires_at: Date.now() + 1800 * 1000,
      scope: 'global-scope',
    });
  });

  it('returns null when refresh is unavailable or fails', async () => {
    saveToken(SITE_ID, {
      refreshToken: null,
      expiresAt: Date.now() - 1000,
    });
    await expect(getValidToken(SITE_ID)).resolves.toBeNull();

    saveToken(SITE_ID, {
      refreshToken: 'refresh-me',
      expiresAt: Date.now() - 1000,
    });
    mockJsonFetch({ error: 'temporarily_unavailable' }, 503);
    await expect(getValidToken(SITE_ID)).resolves.toBeNull();

    const throwingFetch = vi.fn(async () => {
      throw new TypeError('network failed');
    });
    vi.stubGlobal('fetch', throwingFetch);
    await expect(getValidToken(SITE_ID)).resolves.toBeNull();
  });

  it('disconnects site and global tokens independently', () => {
    saveToken(SITE_ID);
    saveToken(GLOBAL_KEY);

    expect(isConnected(SITE_ID)).toBe(true);
    expect(isGlobalConnected()).toBe(true);

    disconnect(SITE_ID);
    expect(isConnected(SITE_ID)).toBe(false);
    expect(isGlobalConnected()).toBe(true);

    disconnectGlobal();
    expect(isGlobalConnected()).toBe(false);
  });
});
