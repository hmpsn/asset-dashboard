/**
 * Google OAuth2 authentication for Search Console & GA4.
 * Requires GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, and GOOGLE_REDIRECT_URI env vars.
 * Tokens are stored per-workspace in a JSON file.
 */

import fs from 'fs';
import path from 'path';

const IS_PROD = process.env.NODE_ENV === 'production' || process.env.RAILWAY_ENVIRONMENT === 'production';
const DATA_DIR = process.env.DATA_DIR || (IS_PROD ? '/tmp/asset-dashboard' : path.join(process.env.HOME || '', '.asset-dashboard'));

const TOKEN_FILE = path.join(DATA_DIR, 'google-tokens.json');

interface GoogleTokens {
  access_token: string;
  refresh_token?: string;
  expires_at: number;
  scope: string;
}

interface TokenStore {
  [siteId: string]: GoogleTokens;
}

function loadTokens(): TokenStore {
  try {
    if (fs.existsSync(TOKEN_FILE)) {
      return JSON.parse(fs.readFileSync(TOKEN_FILE, 'utf-8'));
    }
  } catch { /* ignore */ }
  return {};
}

function saveTokens(store: TokenStore): void {
  fs.mkdirSync(path.dirname(TOKEN_FILE), { recursive: true });
  fs.writeFileSync(TOKEN_FILE, JSON.stringify(store, null, 2));
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
  console.log(`[google-auth] Auth URL generated, redirect_uri=${creds.redirectUri}`);
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
      console.error('Google token exchange failed:', err);
      return { success: false, error: `Token exchange failed: ${res.status}` };
    }

    const data = await res.json() as {
      access_token: string;
      refresh_token?: string;
      expires_in: number;
      scope: string;
    };

    const store = loadTokens();
    store[siteId] = {
      access_token: data.access_token,
      refresh_token: data.refresh_token,
      expires_at: Date.now() + (data.expires_in * 1000),
      scope: data.scope,
    };
    saveTokens(store);

    return { success: true };
  } catch (err) {
    console.error('Google token exchange error:', err);
    return { success: false, error: String(err) };
  }
}

export async function getValidToken(siteId: string): Promise<string | null> {
  const store = loadTokens();
  const tokens = store[siteId];
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

    store[siteId] = {
      ...tokens,
      access_token: data.access_token,
      expires_at: Date.now() + (data.expires_in * 1000),
    };
    saveTokens(store);

    return data.access_token;
  } catch {
    return null;
  }
}

export function isConnected(siteId: string): boolean {
  const store = loadTokens();
  return !!store[siteId];
}

export function disconnect(siteId: string): void {
  const store = loadTokens();
  delete store[siteId];
  saveTokens(store);
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
