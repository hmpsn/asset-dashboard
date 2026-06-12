import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import db from '../../server/db/index.js';
import { createWorkspace, deleteWorkspace } from '../../server/workspaces.js';
import { getClientLocations } from '../../server/client-locations.js';
import { BACKGROUND_JOB_TYPES } from '../../shared/types/background-jobs.js';
import { createEphemeralTestContext } from './helpers.js';

// Coverage signal for background-job-coverage-contract:
// POST/PUT/DELETE locations endpoints enqueue BACKGROUND_JOB_TYPES.LOCAL_SEO_LOCATION_BACKFILL
void BACKGROUND_JOB_TYPES.LOCAL_SEO_LOCATION_BACKFILL;

const ctx = createEphemeralTestContext(import.meta.url);

let workspaceId: string;

interface LocationResponse {
  location: {
    id: string;
    name: string;
    workspaceId: string;
    isPrimary: boolean;
    status: string;
  };
  jobId: string;
}

async function readJson<T>(res: Response): Promise<T> {
  return await res.json() as T;
}

async function putJson(urlPath: string, body: unknown): Promise<Response> {
  return ctx.api(urlPath, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

function insertSnapshot(workspaceIdForSnapshot: string): void {
  const now = new Date().toISOString();
  const marketId = `market_${workspaceIdForSnapshot}`;
  db.prepare(`
    INSERT INTO local_seo_markets (
      id, workspace_id, label, city, state_or_region, country, source, status, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    marketId,
    workspaceIdForSnapshot,
    'Austin, TX',
    'Austin',
    'TX',
    'US',
    'admin_override',
    'active',
    now,
    now,
  );
  db.prepare(`
    INSERT INTO local_visibility_snapshots (
      id, workspace_id, keyword, normalized_keyword, market_id, market_label, captured_at,
      local_pack_present, business_found, business_match_confidence, business_match_reason,
      local_rank, top_competitors, source_endpoint, provider, device, language_code, status,
      degraded_reason, matched_location_id, matched_location_name, raw_results
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    `snap_${workspaceIdForSnapshot}`,
    workspaceIdForSnapshot,
    'dentist austin',
    'dentist austin',
    marketId,
    'Austin, TX',
    now,
    1,
    0,
    'not_found',
    'No likely business match found in local results',
    null,
    JSON.stringify([]),
    'google_organic_serp',
    'dataforseo',
    'desktop',
    'en',
    'success',
    null,
    null,
    null,
    JSON.stringify([]),
  );
}

beforeAll(async () => {
  await ctx.startServer();
  const ws = createWorkspace('Location Test Workspace');
  workspaceId = ws.id;
});

afterAll(async () => {
  deleteWorkspace(workspaceId);
  await ctx.stopServer();
});

describe('GET /api/local-seo/:workspaceId/locations', () => {
  it('returns empty array when no locations are configured', async () => {
    const res = await ctx.api(`/api/local-seo/${workspaceId}/locations`);
    const body = await readJson<{ locations: unknown[] }>(res);
    expect(res.status).toBe(200);
    expect(body.locations).toEqual([]);
  });
});

describe('POST /api/local-seo/:workspaceId/locations', () => {
  it('creates a location and returns it with a backfill job id', async () => {
    const res = await ctx.postJson(`/api/local-seo/${workspaceId}/locations`, {
      name: 'Downtown Office',
      domain: 'locationtest.com',
      phone: '5125550100',
      streetAddress: '123 Congress Ave',
      city: 'Austin',
      stateOrRegion: 'TX',
      country: 'US',
      isPrimary: true,
      status: 'confirmed',
    });
    const body = await readJson<LocationResponse>(res);
    expect(res.status).toBe(201);
    expect(body.location.name).toBe('Downtown Office');
    expect(body.location.isPrimary).toBe(true);
    expect(body.location.status).toBe('confirmed');
    expect(body.location.workspaceId).toBe(workspaceId);
    expect(body.jobId).toBeTruthy();
  });

  it('returns 400 for missing name', async () => {
    const res = await ctx.postJson(`/api/local-seo/${workspaceId}/locations`, {});
    expect(res.status).toBe(400);
  });
});

describe('PUT /api/local-seo/:workspaceId/locations/:locationId', () => {
  it('updates the location', async () => {
    const createRes = await ctx.postJson(`/api/local-seo/${workspaceId}/locations`, {
      name: 'Branch A',
      status: 'needs_review',
    });
    const createBody = await readJson<LocationResponse>(createRes);

    const updateRes = await putJson(`/api/local-seo/${workspaceId}/locations/${createBody.location.id}`, {
      name: 'Branch A Updated',
      status: 'confirmed',
    });
    const updateBody = await readJson<LocationResponse>(updateRes);
    expect(updateRes.status).toBe(200);
    expect(updateBody.location.name).toBe('Branch A Updated');
    expect(updateBody.location.status).toBe('confirmed');
    expect(updateBody.jobId).toBeTruthy();
  });

  it('returns 404 for unknown location', async () => {
    const res = await putJson(`/api/local-seo/${workspaceId}/locations/nonexistent`, { name: 'X' });
    expect(res.status).toBe(404);
  });
});

describe('DELETE /api/local-seo/:workspaceId/locations/:locationId', () => {
  it('blocks deletion of the last configured location when snapshots exist', async () => {
    const freshWs = createWorkspace('Delete Test Workspace');
    try {
      insertSnapshot(freshWs.id);
      const createRes = await ctx.postJson(`/api/local-seo/${freshWs.id}/locations`, {
        name: 'Only Location',
        status: 'confirmed',
      });
      const createBody = await readJson<LocationResponse>(createRes);
      const deleteRes = await ctx.del(`/api/local-seo/${freshWs.id}/locations/${createBody.location.id}`);
      const deleteBody = await readJson<{ error: string }>(deleteRes);
      expect(deleteRes.status).toBe(409);
      expect(deleteBody.error).toContain('only configured location');
    } finally {
      deleteWorkspace(freshWs.id);
    }
  });

  it('does not count draft locations as replacements for the last confirmed location', async () => {
    const freshWs = createWorkspace('Confirmed Delete Guard Workspace');
    try {
      insertSnapshot(freshWs.id);
      const confirmedRes = await ctx.postJson(`/api/local-seo/${freshWs.id}/locations`, {
        name: 'Confirmed Location',
        status: 'confirmed',
      });
      await ctx.postJson(`/api/local-seo/${freshWs.id}/locations`, {
        name: 'Draft Location',
        status: 'needs_review',
      });
      const confirmedBody = await readJson<LocationResponse>(confirmedRes);
      const deleteRes = await ctx.del(`/api/local-seo/${freshWs.id}/locations/${confirmedBody.location.id}`);
      const deleteBody = await readJson<{ error: string }>(deleteRes);
      expect(deleteRes.status).toBe(409);
      expect(deleteBody.error).toContain('only configured location');
    } finally {
      deleteWorkspace(freshWs.id);
    }
  });

  it('returns 404 when deleting a nonexistent location', async () => {
    const res = await ctx.del(`/api/local-seo/${workspaceId}/locations/does-not-exist`);
    expect(res.status).toBe(404);
  });

  it('deletes the last location when no snapshots exist', async () => {
    const freshWs = createWorkspace('No Snapshot Delete Workspace');
    try {
      // No insertSnapshot call — zero snapshots.
      const createRes = await ctx.postJson(`/api/local-seo/${freshWs.id}/locations`, {
        name: 'Only Location No Snaps',
        status: 'confirmed',
      });
      const createBody = await readJson<LocationResponse>(createRes);
      const deleteRes = await ctx.del(`/api/local-seo/${freshWs.id}/locations/${createBody.location.id}`);
      const deleteBody = await readJson<{ deleted: boolean }>(deleteRes);
      expect(deleteRes.status).toBe(200);
      expect(deleteBody.deleted).toBe(true);
      expect(getClientLocations(freshWs.id)).toHaveLength(0);
    } finally {
      deleteWorkspace(freshWs.id);
    }
  });

  it('deletes a location when others remain', async () => {
    const freshWs = createWorkspace('Multi Delete Workspace');
    try {
      const res1 = await ctx.postJson(`/api/local-seo/${freshWs.id}/locations`, { name: 'Loc A' });
      await ctx.postJson(`/api/local-seo/${freshWs.id}/locations`, { name: 'Loc B' });
      const body1 = await readJson<LocationResponse>(res1);
      const deleteRes = await ctx.del(`/api/local-seo/${freshWs.id}/locations/${body1.location.id}`);
      const deleteBody = await readJson<{ deleted: boolean; jobId: string }>(deleteRes);
      expect(deleteRes.status).toBe(200);
      expect(deleteBody.deleted).toBe(true);
      expect(deleteBody.jobId).toBeTruthy();
      expect(getClientLocations(freshWs.id)).toHaveLength(1);
    } finally {
      deleteWorkspace(freshWs.id);
    }
  });
});
