/**
 * Google OAuth2 authentication for Search Console & GA4.
 * Requires GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, and GOOGLE_REDIRECT_URI env vars.
 * Tokens are stored per-site in SQLite.
 */

import db from './db/index.js';
import { createLogger } from './logger.js';

const log = createLogger('google-auth');

interface GoogleTokens {
  access_token: string;
  refresh_token?: string;
  expires_at: number;
  scope: string;
}

// ── Prepared statements (lazy) ──

let _upsert: ReturnType<typeof db.prepare> | null = null;
function upsertStmt() {
  if (!_upsert) {
    _upsert = db.prepare(`
      INSERT OR REPLACE INTO google_tokens
        (site_id, access_token, refresh_token, expires_at, scope)
      VALUES (@site_id, @access_token, @refresh_token, @expires_at, @scope)
    `);
  }
  return _upsert;
}

let _get: ReturnType<typeof db.prepare> | null = null;
function getStmt() {
  if (!_get) {
    _get = db.prepare(`SELECT * FROM google_tokens WHERE site_id = ?`);
  }
  return _get;
}

let _del: ReturnType<typeof db.prepare> | null = null;
function deleteStmt() {
  if (!_del) {
    _del = db.prepare(`DELETE FROM google_tokens WHERE site_id = ?`);
  }
  return _del;
}

interface TokenRow {
  site_id: string;
  access_token: string;
  refresh_token: string | null;
  expires_at: number;
  scope: string;
}

function loadTokenForSite(siteId: string): GoogleTokens | null {
  const row = getStmt().get(siteId) as TokenRow | undefined;
  if (!row) return null;
  return {
    access_token: row.access_token,
    refresh_token: row.refresh_token ?? undefined,
    expires_at: row.expires_at,
    scope: row.scope,
  };
}

function saveTokenForSite(siteId: string, tokens: GoogleTokens): void {
  upsertStmt().run({
    site_id: siteId,
    access_token: tokens.access_token,
    refresh_token: tokens.refresh_token ?? null,
    expires_at: tokens.expires_at,
    scope: tokens.scope,
  });
}

export function getGoogleCredentials(): { clientId: string; clientSecret: string; redirectUri: string } | null {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  const redirectUri = process.env.GOOGLE_REDIRECT_URI || 'http://localhost:3000/api/google/callback';
  if (!clientId || !clientSecret) return null;
  return { clientId, clientSecret, redirectUri };
}

const GLOBAL_KEY = '_global';

export function getAuthUrl(siteId: string): string | null {
  const creds = getGoogleCredentials();
  if (!creds) return null;

  const scopes = [
    'https://www.googleapis.com/auth/webmasters.readonly',
    'https://www.googleapis.com/auth/analytics.readonly',
  ].join(' ');

  const params = new URLSearchParams({
    client_id: creds.clientId,
    redirect_uri: creds.redirectUri,
    response_type: 'code',
    scope: scopes,
    access_type: 'offline',
    prompt: 'consent',
    state: siteId,
  });

  const url = `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`;
  log.info(`Auth URL generated, redirect_uri=${creds.redirectUri}`);
  return url;
}

export function getGlobalAuthUrl(): string | null {
  return getAuthUrl(GLOBAL_KEY);
}

export async function exchangeCode(code: string, siteId: string): Promise<{ success: boolean; error?: string }> {
  const creds = getGoogleCredentials();
  if (!creds) return { success: false, error: 'Google credentials not configured' };

  try {
    const res = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        code,
        client_id: creds.clientId,
        client_secret: creds.clientSecret,
        redirect_uri: creds.redirectUri,
        grant_type: 'authorization_code',
      }),
    });

    if (!res.ok) {
      const err = await res.text();
      log.error({ err: err }, 'Google token exchange failed');
      return { success: false, error: `Token exchange failed: ${res.status}` };
    }

    const data = await res.json() as {
      access_token: string;
      refresh_token?: string;
      expires_in: number;
      scope: string;
    };

    saveTokenForSite(siteId, {
      access_token: data.access_token,
      refresh_token: data.refresh_token,
      expires_at: Date.now() + (data.expires_in * 1000),
      scope: data.scope,
    });

    return { success: true };
  } catch (err) {
    log.error({ err: err }, 'Google token exchange error');
    return { success: false, error: String(err) };
  }
}

export async function getValidToken(siteId: string): Promise<string | null> {
  // Try per-site token first, fall back to global token
  const tokens = loadTokenForSite(siteId) || (siteId !== GLOBAL_KEY ? loadTokenForSite(GLOBAL_KEY) : null);
  if (!tokens) return null;

  // If token is still valid (with 5 min buffer)
  if (tokens.expires_at > Date.now() + 300000) {
    return tokens.access_token;
  }

  // Refresh the token
  if (!tokens.refresh_token) return null;
  const creds = getGoogleCredentials();
  if (!creds) return null;

  try {
    const res = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        refresh_token: tokens.refresh_token,
        client_id: creds.clientId,
        client_secret: creds.clientSecret,
        grant_type: 'refresh_token',
      }),
    });

    if (!res.ok) return null;

    const data = await res.json() as {
      access_token: string;
      expires_in: number;
    };

    saveTokenForSite(siteId, {
      ...tokens,
      access_token: data.access_token,
      expires_at: Date.now() + (data.expires_in * 1000),
    });

    return data.access_token;
  } catch {
    return null;
  }
}

export function isConnected(siteId: string): boolean {
  return !!loadTokenForSite(siteId);
}

export function disconnect(siteId: string): void {
  deleteStmt().run(siteId);
}

export function isGlobalConnected(): boolean {
  return isConnected(GLOBAL_KEY);
}

export function disconnectGlobal(): void {
  disconnect(GLOBAL_KEY);
}

export async function getGlobalToken(): Promise<string | null> {
  return getValidToken(GLOBAL_KEY);
}

export { GLOBAL_KEY };
