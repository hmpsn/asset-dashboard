import { createHmac } from 'crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import db from '../../server/db/index.js';
import {
  decryptIntegrationSecret,
  encryptIntegrationSecret,
} from '../../server/integration-encryption.js';
import {
  consumeGbpOAuthState,
  createGbpOAuthState,
} from '../../server/google-business-profile-oauth-state.js';
import {
  disconnectGbpConnection,
  getGbpConnectionTokens,
  saveGbpConnectionTokens,
} from '../../server/google-business-profile-store.js';
import { disconnectGbp, getValidGbpAccessToken } from '../../server/google-business-profile-client.js';

const originalEnv = { ...process.env };

function clearGbpTables() {
  db.prepare('DELETE FROM workspace_google_business_locations').run();
  db.prepare('DELETE FROM google_business_locations').run();
  db.prepare('DELETE FROM google_business_accounts').run();
  db.prepare('DELETE FROM google_oauth_connections').run();
  db.prepare('DELETE FROM google_business_profile_oauth_states').run();
}

function signState(payload: unknown) {
  const unsigned = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
  const signature = createHmac('sha256', process.env.GOOGLE_OAUTH_STATE_SECRET!).update(unsigned).digest('base64url');
  return `${unsigned}.${signature}`;
}

describe('Google Business Profile security helpers', () => {
  beforeEach(() => {
    process.env.GOOGLE_OAUTH_ENCRYPTION_KEY = 'test-google-oauth-encryption-key';
    process.env.GOOGLE_OAUTH_STATE_SECRET = 'test-google-oauth-state-secret';
    process.env.GOOGLE_CLIENT_ID = 'google-client-id';
    process.env.GOOGLE_CLIENT_SECRET = 'google-client-secret';
    clearGbpTables();
  });

  afterEach(() => {
    clearGbpTables();
    vi.restoreAllMocks();
    process.env = { ...originalEnv };
  });

  it('encrypts token material without storing raw secrets', () => {
    const encrypted = encryptIntegrationSecret('refresh-token-secret');
    expect(encrypted).not.toContain('refresh-token-secret');
    expect(decryptIntegrationSecret(encrypted)).toBe('refresh-token-secret');
  });

  it('stores no raw token material and disconnect leaves no older active token row behind', () => {
    saveGbpConnectionTokens({
      id: 'gbp_old_connection',
      accessToken: 'old-access-token',
      refreshToken: 'old-refresh-token',
      expiresAt: Date.now() + 3600_000,
      scopes: ['https://www.googleapis.com/auth/business.manage'],
    });
    saveGbpConnectionTokens({
      id: 'gbp_new_connection',
      accessToken: 'new-access-token',
      refreshToken: 'new-refresh-token',
      expiresAt: Date.now() + 3600_000,
      scopes: ['https://www.googleapis.com/auth/business.manage'],
    });

    const raw = db.prepare(`
      SELECT encrypted_access_token, encrypted_refresh_token
      FROM google_oauth_connections
    `).all() as Array<{ encrypted_access_token: string | null; encrypted_refresh_token: string | null }>;
    expect(JSON.stringify(raw)).not.toContain('old-access-token');
    expect(JSON.stringify(raw)).not.toContain('new-refresh-token');
    expect(getGbpConnectionTokens()?.id).toBe('gbp_new_connection');

    disconnectGbpConnection('gbp_new_connection');
    expect(getGbpConnectionTokens()).toBeNull();
  });

  it('fails loudly in production when no integration encryption key is configured', () => {
    delete process.env.GOOGLE_OAUTH_ENCRYPTION_KEY;
    delete process.env.INTEGRATION_CONFIG_KEY;
    process.env.NODE_ENV = 'production';

    expect(() => encryptIntegrationSecret('secret')).toThrow(/GOOGLE_OAUTH_ENCRYPTION_KEY/);
  });

  it('accepts signed OAuth state once and rejects replay', () => {
    const state = createGbpOAuthState({ workspaceId: 'ws_state', returnTo: '/ws/ws_state/local-seo' });

    expect(consumeGbpOAuthState(state)).toEqual(expect.objectContaining({
      intent: 'gbp-auth',
      workspaceId: 'ws_state',
      returnTo: '/ws/ws_state/local-seo',
    }));
    expect(() => consumeGbpOAuthState(state)).toThrow(/Replayed/);
  });

  it('rejects tampered, expired, and wrong-intent OAuth state', () => {
    const state = createGbpOAuthState();
    expect(() => consumeGbpOAuthState(`${state.slice(0, -3)}abc`)).toThrow(/Invalid/);
    expect(() => consumeGbpOAuthState(`${state}.extra`)).toThrow(/Invalid/);

    const expiredPayload = {
      intent: 'gbp-auth',
      nonce: 'expired-state-nonce-123456',
      expiresAt: Date.now() - 1000,
    };
    db.prepare(`
      INSERT INTO google_business_profile_oauth_states (nonce, intent, expires_at, created_at)
      VALUES (?, ?, ?, ?)
    `).run(expiredPayload.nonce, expiredPayload.intent, expiredPayload.expiresAt, new Date().toISOString());
    expect(() => consumeGbpOAuthState(signState(expiredPayload))).toThrow(/Expired/);

    const wrongIntentPayload = {
      intent: 'not-gbp-auth',
      nonce: 'wrong-intent-state-nonce-123456',
      expiresAt: Date.now() + 60_000,
    };
    db.prepare(`
      INSERT INTO google_business_profile_oauth_states (nonce, intent, expires_at, created_at)
      VALUES (?, ?, ?, ?)
    `).run(wrongIntentPayload.nonce, wrongIntentPayload.intent, wrongIntentPayload.expiresAt, new Date().toISOString());
    expect(() => consumeGbpOAuthState(signState(wrongIntentPayload))).toThrow(/intent/);
  });

  it('refreshes access tokens while preserving refresh tokens Google omits', async () => {
    saveGbpConnectionTokens({
      id: 'gbp_refresh_preserve',
      accessToken: 'old-access',
      refreshToken: 'old-refresh',
      expiresAt: Date.now() - 1000,
      scopes: ['https://www.googleapis.com/auth/business.manage'],
    });
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({
      access_token: 'new-access',
      expires_in: 3600,
      scope: 'https://www.googleapis.com/auth/business.manage',
    }), { status: 200, headers: { 'Content-Type': 'application/json' } }));

    await expect(getValidGbpAccessToken()).resolves.toEqual({
      connectionId: 'gbp_refresh_preserve',
      accessToken: 'new-access',
    });
    expect(getGbpConnectionTokens()?.refreshToken).toBe('old-refresh');
  });

  it('rotates refresh tokens when Google returns a replacement', async () => {
    saveGbpConnectionTokens({
      id: 'gbp_refresh_rotate',
      accessToken: 'old-access',
      refreshToken: 'old-refresh',
      expiresAt: Date.now() - 1000,
      scopes: ['https://www.googleapis.com/auth/business.manage'],
    });
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({
      access_token: 'new-access',
      refresh_token: 'new-refresh',
      expires_in: 3600,
      scope: 'https://www.googleapis.com/auth/business.manage',
    }), { status: 200, headers: { 'Content-Type': 'application/json' } }));

    await getValidGbpAccessToken();
    expect(getGbpConnectionTokens()?.refreshToken).toBe('new-refresh');
  });

  it('revokes tokens via form body, not URL query parameters', async () => {
    saveGbpConnectionTokens({
      id: 'gbp_revoke_body',
      accessToken: 'access-for-revoke',
      refreshToken: 'refresh-for-revoke',
      expiresAt: Date.now() + 3600_000,
      scopes: ['https://www.googleapis.com/auth/business.manage'],
    });
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('', { status: 200 }));

    await disconnectGbp();

    expect(fetchMock).toHaveBeenCalledWith(
      'https://oauth2.googleapis.com/revoke',
      expect.objectContaining({
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: expect.any(URLSearchParams),
      }),
    );
    const [, init] = fetchMock.mock.calls[0]!;
    expect(String((init as RequestInit).body)).toBe('token=refresh-for-revoke');
    expect(getGbpConnectionTokens()).toBeNull();
  });
});
