// @ds-rebuilt
import { randomUUID } from 'crypto';
import http from 'http';
import type { AddressInfo } from 'net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import db from '../../server/db/index.js';
import { setBroadcast } from '../../server/broadcast.js';
import { createWorkspace, deleteWorkspace, updateWorkspace } from '../../server/workspaces.js';

let workspaceId = '';
let sovWorkspaceId = '';
let clientLocationId = '';
let baseUrl = '';
let server: http.Server | undefined;
const connectionId = `gbp_conn_${randomUUID()}`;
const accountId = `accounts/${randomUUID()}`;
const googleLocationId = `locations/${randomUUID()}`;
const reviewResourceOne = `${accountId}/${googleLocationId}/reviews/rev-manual`;
const reviewResourceTwo = `${accountId}/${googleLocationId}/reviews/rev-send`;
const envKeys = [
  'APP_PASSWORD',
  'FEATURE_GBP_AUTH_CONNECTION',
  'FEATURE_GBP_AUTH_REVIEWS',
  'FEATURE_GBP_REVIEW_RESPONSES',
  'GOOGLE_CLIENT_ID',
  'GOOGLE_CLIENT_SECRET',
  'GOOGLE_OAUTH_ENCRYPTION_KEY',
  'GOOGLE_OAUTH_STATE_SECRET',
] as const;
const originalEnv = Object.fromEntries(envKeys.map((key) => [key, process.env[key]]));

async function startTestServer(): Promise<void> {
  delete process.env.APP_PASSWORD;
  process.env.FEATURE_GBP_AUTH_CONNECTION = 'true';
  process.env.FEATURE_GBP_AUTH_REVIEWS = 'true';
  process.env.FEATURE_GBP_REVIEW_RESPONSES = 'true';
  process.env.GOOGLE_CLIENT_ID = 'gbp-client-id';
  process.env.GOOGLE_CLIENT_SECRET = 'gbp-client-secret';
  process.env.GOOGLE_OAUTH_ENCRYPTION_KEY = 'test-google-oauth-encryption-key';
  process.env.GOOGLE_OAUTH_STATE_SECRET = 'test-google-oauth-state-secret';

  const { createApp } = await import('../../server/app.js');
  const app = createApp();
  server = http.createServer(app);
  await new Promise<void>((resolve) => server!.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  baseUrl = `http://127.0.0.1:${port}`;
}

async function stopTestServer(): Promise<void> {
  if (!server) return;
  await new Promise<void>((resolve, reject) => {
    server!.close((err) => (err ? reject(err) : resolve()));
  });
  server = undefined;
}

function restoreEnv(): void {
  for (const key of envKeys) {
    const value = originalEnv[key];
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }
}

async function api(urlPath: string, opts?: RequestInit): Promise<Response> {
  return fetch(`${baseUrl}${urlPath}`, opts);
}

function deleteGbpRowsForWorkspace(id: string): void {
  db.prepare('DELETE FROM google_business_review_reply_publish_attempts WHERE workspace_id = ?').run(id);
  db.prepare('DELETE FROM google_business_review_response_events WHERE workspace_id = ?').run(id);
  db.prepare('DELETE FROM google_business_review_responses WHERE workspace_id = ?').run(id);
  db.prepare('DELETE FROM google_business_review_sync_status WHERE workspace_id = ?').run(id);
  db.prepare('DELETE FROM google_business_reviews WHERE workspace_id = ?').run(id);
  db.prepare('DELETE FROM workspace_google_business_locations WHERE workspace_id = ?').run(id);
}

function seedGbpDiscovery(): void {
  const now = new Date().toISOString();
  db.prepare(`
    INSERT INTO google_oauth_connections (
      id, encrypted_access_token, encrypted_refresh_token, expires_at, scopes, status,
      last_refresh_at, last_synced_at, created_at, updated_at
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    connectionId,
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
  `).run(accountId, connectionId, accountId, 'GBP Account', 'OWNER_LEVEL', now, now, now);
  db.prepare(`
    INSERT INTO google_business_locations (
      id, connection_id, account_id, account_resource_name, location_resource_name,
      title, place_id, address_line1, locality, administrative_area, region_code,
      sync_status, synced_at, created_at, updated_at
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    googleLocationId,
    connectionId,
    accountId,
    accountId,
    googleLocationId,
    'Austin Office',
    'ChIJ-local-presence',
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

function seedWorkspaceGbpMapping(): void {
  const now = new Date().toISOString();
  db.prepare(`
    INSERT INTO workspace_google_business_locations (
      workspace_id, client_location_id, google_location_id, is_primary, created_at, updated_at
    )
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(workspaceId, clientLocationId, googleLocationId, 1, now, now);
  db.prepare(`
    INSERT INTO google_business_review_sync_status (
      google_location_id, workspace_id, client_location_id, sync_status,
      average_rating, total_review_count, last_synced_at, created_at, updated_at
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(googleLocationId, workspaceId, clientLocationId, 'synced', 4.8, 2, now, now, now);
}

function seedAuthenticatedReview(reviewResourceName: string, reviewId: string, comment: string): void {
  const now = new Date().toISOString();
  db.prepare(`
    INSERT INTO google_business_reviews (
      id, workspace_id, google_location_id, client_location_id, review_resource_name,
      review_id, star_rating, rating_value, comment, reviewer_display_name,
      reviewer_is_anonymous, create_time, update_time, synced_at, created_at, updated_at
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    `review_${randomUUID()}`,
    workspaceId,
    googleLocationId,
    clientLocationId,
    reviewResourceName,
    reviewId,
    'FIVE',
    5,
    comment,
    'Jane Reviewer',
    0,
    '2026-07-01T12:00:00.000Z',
    '2026-07-01T12:10:00.000Z',
    now,
    now,
    now,
  );
}

function seedSovSnapshots(): void {
  const marketId = randomUUID();
  const now = new Date().toISOString();
  db.prepare(`
    INSERT INTO local_seo_markets (id, workspace_id, label, city, country, source, status, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(marketId, sovWorkspaceId, 'Austin, TX', 'Austin', 'US', 'admin_override', 'active', now, now);
  const insertSnapshot = db.prepare(`
    INSERT INTO local_visibility_snapshots (
      id, workspace_id, keyword, normalized_keyword, market_id, market_label,
      captured_at, local_pack_present, business_found, business_match_confidence,
      local_rank, top_competitors, source_endpoint, provider, device, language_code, status
    ) VALUES (
      @id, @workspace_id, @keyword, @normalized_keyword, @market_id, @market_label,
      @captured_at, @local_pack_present, @business_found, @business_match_confidence,
      @local_rank, @top_competitors, @source_endpoint, @provider, @device, @language_code, @status
    )
  `);
  const rival = JSON.stringify([{ title: 'Map Pack Rival', domain: 'rival.example' }]);
  // Duplicate the same rival within ONE snapshot (franchise / repeated business name):
  // per-snapshot dedup must count this as a single appearance, else totalAppearances (3)
  // would exceed the checked-snapshot count and push SoV past 100%.
  const rivalDuplicatedInOneSnapshot = JSON.stringify([
    { title: 'Map Pack Rival', domain: 'rival.example' },
    { title: 'Map Pack Rival', domain: 'rival.example' },
  ]);
  const other = JSON.stringify([{ title: 'Other Practice', domain: 'other.example' }]);
  const rows = [
    { keyword: 'dentist austin', competitors: rivalDuplicatedInOneSnapshot, businessFound: 0 },
    { keyword: 'emergency dentist', competitors: rival, businessFound: 1 },
    { keyword: 'teeth whitening', competitors: other, businessFound: 0 },
    { keyword: 'dental implants', competitors: '[]', businessFound: 0 },
  ];
  for (const row of rows) {
    insertSnapshot.run({
      id: randomUUID(),
      workspace_id: sovWorkspaceId,
      keyword: row.keyword,
      normalized_keyword: row.keyword,
      market_id: marketId,
      market_label: 'Austin, TX',
      captured_at: now,
      local_pack_present: 1,
      business_found: row.businessFound,
      business_match_confidence: row.businessFound ? 'verified' : 'not_found',
      local_rank: row.businessFound ? 2 : null,
      top_competitors: row.competitors,
      source_endpoint: 'google_local_pack',
      provider: 'dataforseo',
      device: 'desktop',
      language_code: 'en',
      status: 'success',
    });
  }
}

beforeAll(async () => {
  await startTestServer();
  // createApp() alone does not wire the broadcast singleton (production does this in
  // index.ts via setBroadcast); initialize it with no-ops so workspace mutations that
  // call broadcastToWorkspace() don't throw "called before init".
  setBroadcast(() => {}, () => {});
  const ws = createWorkspace('Local Presence Rebuilt GBP Test');
  workspaceId = ws.id;
  updateWorkspace(workspaceId, { liveDomain: 'https://local-presence.example.com' });
  const sovWs = createWorkspace('Local Presence Rebuilt SoV Test');
  sovWorkspaceId = sovWs.id;
  updateWorkspace(sovWorkspaceId, { liveDomain: 'https://local-presence-sov.example.com' });
  seedGbpDiscovery();
  const locationRes = await api(`/api/local-seo/${workspaceId}/locations`, {
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
  seedWorkspaceGbpMapping();
  seedAuthenticatedReview(reviewResourceOne, 'rev-manual', 'Fantastic service and clear communication.');
  seedAuthenticatedReview(reviewResourceTwo, 'rev-send', 'Helpful team and quick local support.');
  seedSovSnapshots();
}, 25_000);

afterAll(async () => {
  deleteGbpRowsForWorkspace(workspaceId);
  db.prepare('DELETE FROM google_business_locations WHERE id = ?').run(googleLocationId);
  db.prepare('DELETE FROM google_business_accounts WHERE id = ?').run(accountId);
  db.prepare('DELETE FROM google_oauth_connections WHERE id = ?').run(connectionId);
  deleteWorkspace(workspaceId);
  deleteWorkspace(sovWorkspaceId);
  await stopTestServer();
  restoreEnv();
});

describe('Local Presence rebuilt server ride-alongs', () => {
  it('returns server-computed map-pack share of voice fields, deduped per snapshot (never >100%)', async () => {
    const res = await api(`/api/local-seo/${sovWorkspaceId}`);
    expect(res.status).toBe(200);
    const body = await res.json() as { competitorBrands: Array<Record<string, unknown>> };
    const rival = body.competitorBrands.find((brand) => brand.title === 'Map Pack Rival');

    // Map Pack Rival is listed TWICE in the "dentist austin" snapshot and once in
    // "emergency dentist" → 2 distinct snapshots of 4. Per-snapshot dedup keeps
    // totalAppearances at 2 (not 3) and SoV at 50% (not 75%). winsAgainstClient stays 1
    // (the one lost snapshot), not double-counted.
    expect(rival).toEqual(expect.objectContaining({
      totalAppearances: 2,
      winsAgainstClient: 1,
      mapPackShareOfVoicePct: 50,
      mapPackShareOfVoiceBasis: 4,
    }));
    expect(rival!.mapPackShareOfVoicePct as number).toBeLessThanOrEqual(100);
  });

  it('creates a manual review-response draft without invoking the AI draft route', async () => {
    const res = await api(`/api/google-business-profile/workspaces/${workspaceId}/review-responses/manual-draft`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        reviewResourceName: reviewResourceOne,
        draftText: 'Thank you for trusting our local team. We appreciate the feedback and look forward to helping again.',
      }),
    });

    expect(res.status).toBe(200);
    const body = await res.json() as { status: string; draftText: string; reviewResourceName: string };
    expect(body).toEqual(expect.objectContaining({
      status: 'draft',
      reviewResourceName: reviewResourceOne,
      draftText: 'Thank you for trusting our local team. We appreciate the feedback and look forward to helping again.',
    }));
  });

  it('creates a manual draft and sends it to the client in one route call', async () => {
    const res = await api(`/api/google-business-profile/workspaces/${workspaceId}/review-responses/draft-and-send`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        reviewResourceName: reviewResourceTwo,
        draftText: 'Thank you for sharing this review. We are glad the local team could help quickly and clearly.',
        note: 'Please approve this public reply when ready.',
      }),
    });

    expect(res.status).toBe(200);
    const body = await res.json() as {
      response: { status: string; sentDeliverableId?: string; reviewResourceName: string };
      deliverable: { id: string; type: string };
    };
    expect(body.response).toEqual(expect.objectContaining({
      status: 'awaiting_client',
      reviewResourceName: reviewResourceTwo,
      sentDeliverableId: body.deliverable.id,
    }));
    expect(body.deliverable.type).toBe('gbp_review_response');
  });
});
