import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import db from '../../server/db/index.js';
import { createEphemeralTestContext } from './helpers.js';
import { seedWorkspace, type SeededFullWorkspace } from '../fixtures/workspace-seed.js';
import { seedAuthData, type SeededAuth } from '../fixtures/auth-seed.js';
import type { WorkspaceGbpMappingRead } from '../../shared/types/google-business-profile.js';

const ctx = createEphemeralTestContext(import.meta.url, {
  env: {
    FEATURE_GBP_AUTH_CONNECTION: 'true',
    GOOGLE_CLIENT_ID: 'gbp-client-id',
    GOOGLE_CLIENT_SECRET: 'gbp-client-secret',
    GOOGLE_OAUTH_ENCRYPTION_KEY: 'test-google-oauth-encryption-key',
    GOOGLE_OAUTH_STATE_SECRET: 'test-google-oauth-state-secret',
  },
});

const callbackGateCtx = createEphemeralTestContext(import.meta.url, {
  contextName: 'gbp-callback-auth-gate',
  env: {
    APP_PASSWORD: 'gbp-callback-test-password',
    FEATURE_GBP_AUTH_CONNECTION: 'true',
    GOOGLE_CLIENT_ID: 'gbp-client-id',
    GOOGLE_CLIENT_SECRET: 'gbp-client-secret',
    GOOGLE_OAUTH_ENCRYPTION_KEY: 'test-google-oauth-encryption-key',
    GOOGLE_OAUTH_STATE_SECRET: 'test-google-oauth-state-secret',
  },
});

let seeded: SeededFullWorkspace | null = null;
let otherSeeded: SeededFullWorkspace | null = null;
let workspaceId = '';
let foreignAuth: SeededAuth | null = null;
let clientLocationId = '';
let otherClientLocationId = '';

function clearGbpTables() {
  db.prepare('DELETE FROM workspace_google_business_locations').run();
  db.prepare('DELETE FROM google_business_locations').run();
  db.prepare('DELETE FROM google_business_accounts').run();
  db.prepare('DELETE FROM google_oauth_connections').run();
  db.prepare('DELETE FROM google_business_profile_oauth_states').run();
}

function seedStoredGbpDiscovery() {
  const now = new Date().toISOString();
  db.prepare(`
    INSERT INTO google_oauth_connections (
      id, encrypted_access_token, encrypted_refresh_token, expires_at, scopes, status,
      last_refresh_at, last_synced_at, created_at, updated_at
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    'gbp_route_connection',
    'encrypted-access-token-placeholder',
    'encrypted-refresh-token-placeholder',
    Date.now() + 3600_000,
    'https://www.googleapis.com/auth/business.manage',
    'connected',
    now,
    now,
    now,
    now,
  );
  db.prepare(`
    INSERT INTO google_business_accounts (
      id, connection_id, account_resource_name, display_name, permission_level,
      synced_at, created_at, updated_at
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run('accounts/123', 'gbp_route_connection', 'accounts/123', 'GBP Account', 'OWNER_LEVEL', now, now, now);
  db.prepare(`
    INSERT INTO google_business_locations (
      id, connection_id, account_id, account_resource_name, location_resource_name,
      title, place_id, address_line1, locality, administrative_area, region_code,
      sync_status, synced_at, created_at, updated_at
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    'locations/456',
    'gbp_route_connection',
    'accounts/123',
    'accounts/123',
    'locations/456',
    'Austin Office',
    'ChIJ123',
    '100 Congress Ave',
    'Austin',
    'TX',
    'US',
    'available',
    now,
    now,
    now,
  );
}

function seedSecondGbpLocation() {
  const now = new Date().toISOString();
  db.prepare(`
    INSERT OR IGNORE INTO google_business_locations (
      id, connection_id, account_id, account_resource_name, location_resource_name,
      title, place_id, address_line1, locality, administrative_area, region_code,
      sync_status, synced_at, created_at, updated_at
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    'locations/789',
    'gbp_route_connection',
    'accounts/123',
    'accounts/123',
    'locations/789',
    'Dallas Office',
    'ChIJ789',
    '200 Main St',
    'Dallas',
    'TX',
    'US',
    'available',
    now,
    now,
    now,
  );
}

describe('Google Business Profile routes', () => {
  beforeAll(async () => {
    await ctx.startServer();
    seeded = seedWorkspace();
    otherSeeded = seedWorkspace();
    workspaceId = seeded.workspaceId;
    foreignAuth = await seedAuthData();
    clearGbpTables();
    seedStoredGbpDiscovery();

    const locationRes = await ctx.api(`/api/local-seo/${workspaceId}/locations`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'Austin Office',
        city: 'Austin',
        stateOrRegion: 'TX',
        country: 'US',
        status: 'confirmed',
      }),
    });
    expect(locationRes.status).toBe(201);
    const locationBody = await locationRes.json() as { location: { id: string } };
    clientLocationId = locationBody.location.id;

    const otherLocationRes = await ctx.api(`/api/local-seo/${otherSeeded.workspaceId}/locations`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'Dallas Office',
        city: 'Dallas',
        stateOrRegion: 'TX',
        country: 'US',
        status: 'confirmed',
      }),
    });
    expect(otherLocationRes.status).toBe(201);
    const otherLocationBody = await otherLocationRes.json() as { location: { id: string } };
    otherClientLocationId = otherLocationBody.location.id;
  }, 25_000);

  afterAll(async () => {
    clearGbpTables();
    foreignAuth?.cleanup();
    otherSeeded?.cleanup();
    seeded?.cleanup();
    await callbackGateCtx.stopServer();
    await ctx.stopServer();
  });

  it('allows unauthenticated Google callback requests through the global API auth gate', async () => {
    await callbackGateCtx.startServer();
    const res = await fetch(`${callbackGateCtx.BASE}/api/google-business-profile/callback?code=fake-code&state=invalid-state`, {
      redirect: 'manual',
    });
    expect(res.status).toBe(400);
  }, 25_000);

  it('creates an auth URL with business.manage scope and signed state', async () => {
    const res = await ctx.api(`/api/google-business-profile/auth-url?workspaceId=${workspaceId}`);
    expect(res.status).toBe(200);
    const body = await res.json() as { url: string };
    const url = new URL(body.url);

    expect(url.hostname).toBe('accounts.google.com');
    expect(url.searchParams.get('scope')).toBe('https://www.googleapis.com/auth/business.manage');
    expect(url.searchParams.get('access_type')).toBe('offline');
    expect(url.searchParams.get('state')).toMatch(/\./);
  });

  it('rejects invalid callback state without writing a connection', async () => {
    const before = await ctx.api('/api/google-business-profile/status');
    expect(before.status).toBe(200);
    const callback = await ctx.api('/api/google-business-profile/callback?code=fake-code&state=invalid-state');

    expect(callback.status).toBe(400);
    const after = await ctx.api('/api/google-business-profile/status');
    const status = await after.json() as { connectionId?: string };
    expect(status.connectionId).toBe('gbp_route_connection');
  });

  it('returns stored discovery and maps a workspace client location to a GBP location', async () => {
    const readBefore = await ctx.api(`/api/google-business-profile/workspaces/${workspaceId}/mappings`);
    expect(readBefore.status).toBe(200);
    const before = await readBefore.json() as WorkspaceGbpMappingRead;
    expect(before.locations).toHaveLength(1);
    expect(before.mappings).toHaveLength(0);

    const write = await ctx.api(`/api/google-business-profile/workspaces/${workspaceId}/mappings`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        mappings: [{ clientLocationId, googleLocationId: 'locations/456', isPrimary: true }],
      }),
    });
    expect(write.status).toBe(200);
    const mapped = await write.json() as WorkspaceGbpMappingRead;
    expect(mapped.mappings).toHaveLength(1);
    expect(mapped.mappings[0]).toEqual(expect.objectContaining({
      workspaceId,
      clientLocationId,
      googleLocationId: 'locations/456',
      isPrimary: true,
    }));
  });

  it('rejects mapping a GBP location already mapped to another workspace', async () => {
    seedSecondGbpLocation();
    db.prepare('DELETE FROM workspace_google_business_locations').run();
    const now = new Date().toISOString();
    db.prepare(`
      INSERT INTO workspace_google_business_locations (
        workspace_id, client_location_id, google_location_id, is_primary, created_at, updated_at
      )
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(otherSeeded!.workspaceId, otherClientLocationId, 'locations/789', 1, now, now);

    const write = await ctx.api(`/api/google-business-profile/workspaces/${workspaceId}/mappings`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        mappings: [{ clientLocationId, googleLocationId: 'locations/789', isPrimary: true }],
      }),
    });

    expect(write.status).toBe(400);
    const body = await write.json() as { error: string };
    expect(body.error).toMatch(/already mapped/);
  });

  it('enforces workspace access for mapping routes', async () => {
    const res = await ctx.api(`/api/google-business-profile/workspaces/${workspaceId}/mappings`, {
      headers: { Authorization: `Bearer ${foreignAuth!.adminToken}` },
    });
    expect(res.status).toBe(403);
  });
});
