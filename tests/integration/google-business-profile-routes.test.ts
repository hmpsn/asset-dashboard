import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import db from '../../server/db/index.js';
import { createEphemeralTestContext } from './helpers.js';
import { seedWorkspace, type SeededFullWorkspace } from '../fixtures/workspace-seed.js';
import { seedAuthData, type SeededAuth } from '../fixtures/auth-seed.js';
import type { GbpAuthenticatedReviewsRead, GbpReviewResponseWorkflowRead, WorkspaceGbpMappingRead } from '../../shared/types/google-business-profile.js';
import { markGbpReviewSyncFailed } from '../../server/google-business-profile-reviews-store.js';
import { upsertGbpReviewResponseDraft } from '../../server/google-business-profile-review-responses-store.js';

const ctx = createEphemeralTestContext(import.meta.url, {
  env: {
    FEATURE_GBP_AUTH_CONNECTION: 'true',
    FEATURE_GBP_AUTH_REVIEWS: 'true',
    FEATURE_GBP_REVIEW_RESPONSES: 'true',
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
  db.prepare('DELETE FROM google_business_review_reply_publish_attempts').run();
  db.prepare('DELETE FROM google_business_review_response_events').run();
  db.prepare('DELETE FROM google_business_review_responses').run();
  db.prepare('DELETE FROM google_business_review_sync_status').run();
  db.prepare('DELETE FROM google_business_reviews').run();
  db.prepare('DELETE FROM workspace_google_business_locations').run();
  db.prepare('DELETE FROM google_business_locations').run();
  db.prepare('DELETE FROM google_business_accounts').run();
  db.prepare('DELETE FROM google_oauth_connections').run();
  db.prepare('DELETE FROM google_business_profile_oauth_states').run();
}

function seedAuthenticatedReview() {
  const now = new Date().toISOString();
  db.prepare(`
    INSERT INTO google_business_review_sync_status (
      google_location_id, workspace_id, client_location_id, sync_status,
      average_rating, total_review_count, last_synced_at, created_at, updated_at
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run('locations/456', workspaceId, clientLocationId, 'synced', 4.5, 2, now, now, now);
  db.prepare(`
    INSERT INTO google_business_reviews (
      id, workspace_id, google_location_id, client_location_id, review_resource_name,
      review_id, star_rating, rating_value, comment, reviewer_display_name,
      reviewer_is_anonymous, create_time, update_time, synced_at, created_at, updated_at
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    'accounts_123_locations_456_reviews_rev_1',
    workspaceId,
    'locations/456',
    clientLocationId,
    'accounts/123/locations/456/reviews/rev-1',
    'rev-1',
    'FIVE',
    5,
    'Fantastic local service and fast follow-up.',
    'Jane Reviewer',
    0,
    '2026-06-29T12:00:00.000Z',
    '2026-06-29T12:30:00.000Z',
    now,
    now,
    now,
  );
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

  it('returns authenticated review summaries for mapped workspace locations', async () => {
    seedAuthenticatedReview();

    const res = await ctx.api(`/api/google-business-profile/workspaces/${workspaceId}/reviews`);

    expect(res.status).toBe(200);
    const body = await res.json() as GbpAuthenticatedReviewsRead;
    expect(body.mappedLocationCount).toBe(1);
    expect(body.locations[0]).toEqual(expect.objectContaining({
      googleLocationId: 'locations/456',
      storedReviewCount: 1,
      totalReviewCount: 2,
      averageRating: 4.5,
    }));
    expect(body.recentReviews[0]).toEqual(expect.objectContaining({
      reviewId: 'rev-1',
      commentExcerpt: 'Fantastic local service and fast follow-up.',
      hasReply: false,
    }));
    expect(body.copyPolicy.aiUseAllowed).toBe(false);
  });

  it('lists review response workflows for eligible unanswered reviews', async () => {
    db.prepare('DELETE FROM google_business_review_responses WHERE workspace_id = ?').run(workspaceId);
    db.prepare('DELETE FROM google_business_review_sync_status WHERE workspace_id = ?').run(workspaceId);
    db.prepare('DELETE FROM google_business_reviews WHERE workspace_id = ?').run(workspaceId);
    seedAuthenticatedReview();
    const draft = upsertGbpReviewResponseDraft({
      workspaceId,
      reviewResourceName: 'accounts/123/locations/456/reviews/rev-1',
      draftText: 'Thank you for the kind words. We appreciate the chance to help.',
      actor: { type: 'admin' },
    });

    const res = await ctx.api(`/api/google-business-profile/workspaces/${workspaceId}/review-responses`);

    expect(res.status).toBe(200);
    const body = await res.json() as GbpReviewResponseWorkflowRead;
    expect(body.policy.rawReviewTextUsedForDraftingOnly).toBe(true);
    expect(body.eligibleReviews[0]).toEqual(expect.objectContaining({
      reviewResourceName: 'accounts/123/locations/456/reviews/rev-1',
      commentExcerpt: 'Fantastic local service and fast follow-up.',
    }));
    expect(body.eligibleReviews[0]).not.toHaveProperty('commentText');
    expect(body.responses[0]).toEqual(expect.objectContaining({
      id: draft.id,
      status: 'draft',
      draftText: 'Thank you for the kind words. We appreciate the chance to help.',
    }));
  });

  it('does not return old review excerpts after a GBP location is unmapped', async () => {
    db.prepare('DELETE FROM workspace_google_business_locations WHERE workspace_id = ?').run(workspaceId);

    const res = await ctx.api(`/api/google-business-profile/workspaces/${workspaceId}/reviews`);

    expect(res.status).toBe(200);
    const body = await res.json() as GbpAuthenticatedReviewsRead;
    expect(body.mappedLocationCount).toBe(0);
    expect(body.recentReviews).toHaveLength(0);

    const now = new Date().toISOString();
    db.prepare(`
      INSERT INTO workspace_google_business_locations (
        workspace_id, client_location_id, google_location_id, is_primary, created_at, updated_at
      )
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(workspaceId, clientLocationId, 'locations/456', 1, now, now);
  });

  it('preserves last-known review metadata when sync status fails', async () => {
    markGbpReviewSyncFailed({
      workspaceId,
      googleLocationId: 'locations/456',
      clientLocationId,
      status: 'failed',
      lastError: 'Quota unavailable',
    });

    const res = await ctx.api(`/api/google-business-profile/workspaces/${workspaceId}/reviews`);

    expect(res.status).toBe(200);
    const body = await res.json() as GbpAuthenticatedReviewsRead;
    expect(body.locations[0]).toEqual(expect.objectContaining({
      syncStatus: 'failed',
      averageRating: 4.5,
      totalReviewCount: 2,
      lastError: 'Quota unavailable',
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
