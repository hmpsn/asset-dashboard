/**
 * Integration tests — Page Strategy Lifecycle
 *
 * Covers mutation-side concerns NOT exercised by the existing 25 + 3 + 3 + 8 tests:
 *   - Broadcast payload verification for every mutating endpoint
 *   - Blueprint status field transitions (draft → active → archived)
 *   - Blueprint update with nullable optional fields
 *   - Entry keyword field updates (secondaryKeywords, keywordSource)
 *   - Entry sectionPlan array update
 *   - Version creation with no changeNotes (optional field)
 *   - Reorder validation (empty orderedIds → 400)
 *   - Zod enum validation (invalid status, scope, keywordSource)
 *   - Cross-workspace blueprint delete isolation
 *   - Cross-workspace version listing isolation
 *
 * Uses in-process HTTP via createApp() + http.createServer(listen(0)) so
 * vi.mock intercepts broadcastToWorkspace synchronously in-process.
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import http from 'http';
import type { AddressInfo } from 'net';

// ---------------------------------------------------------------------------
// Hoisted mock state — must be before any imports
// ---------------------------------------------------------------------------
const broadcastState = vi.hoisted(() => ({
  calls: [] as Array<{ workspaceId: string; event: string; payload: unknown }>,
}));

vi.mock('../../server/broadcast.js', () => ({
  setBroadcast: vi.fn(),
  broadcast: vi.fn(),
  broadcastToWorkspace: vi.fn((workspaceId: string, event: string, payload: unknown) => {
    broadcastState.calls.push({ workspaceId, event, payload });
  }),
}));

vi.mock('../../server/email.js', () => ({
  isEmailConfigured: vi.fn(() => false),
  sendEmail: vi.fn(),
  notifyApprovalReady: vi.fn(),
  notifyTeamActionApproved: vi.fn(),
  notifyTeamChangesRequested: vi.fn(),
  notifyTeamNewRequest: vi.fn(),
  notifyClientBriefReady: vi.fn(),
  notifyClientContentPublished: vi.fn(),
  notifyClientPostReady: vi.fn(),
  notifyClientFixesApplied: vi.fn(),
  notifyClientStatusChange: vi.fn(),
  notifyTeamContentRequest: vi.fn(),
}));

// ---------------------------------------------------------------------------
// Lazy imports after mocks are installed
// ---------------------------------------------------------------------------
import { createWorkspace, deleteWorkspace } from '../../server/workspaces.js';
import { WS_EVENTS } from '../../server/ws-events.js';
import type { SiteBlueprint, BlueprintEntry, BlueprintVersion } from '../../shared/types/page-strategy.js';

// ---------------------------------------------------------------------------
// In-process server lifecycle
// ---------------------------------------------------------------------------
let baseUrl = '';
let server: http.Server | undefined;
let wsId = '';
let wsIdB = '';

async function startTestServer(): Promise<void> {
  delete process.env.APP_PASSWORD;
  const { createApp } = await import('../../server/app.js');
  const app = createApp();
  server = http.createServer(app);
  await new Promise<void>((resolve) => server!.listen(0, '127.0.0.1', resolve));
  const { port } = server!.address() as AddressInfo;
  baseUrl = `http://127.0.0.1:${port}`;
}

async function stopTestServer(): Promise<void> {
  if (!server) return;
  await new Promise<void>((resolve, reject) => {
    server!.close((err) => (err ? reject(err) : resolve()));
  });
  server = undefined;
}

// ---------------------------------------------------------------------------
// HTTP helpers
// ---------------------------------------------------------------------------
async function api(path: string, opts?: RequestInit): Promise<Response> {
  return fetch(`${baseUrl}${path}`, opts);
}

async function postJson(path: string, body: unknown): Promise<Response> {
  return api(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

async function putJson(path: string, body: unknown): Promise<Response> {
  return api(path, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

async function del(path: string): Promise<Response> {
  return api(path, { method: 'DELETE' });
}

// ---------------------------------------------------------------------------
// Setup / teardown
// ---------------------------------------------------------------------------
beforeAll(async () => {
  await startTestServer();
  const primary = createWorkspace('Page Strategy Lifecycle Primary');
  wsId = primary.id;
  const secondary = createWorkspace('Page Strategy Lifecycle Secondary');
  wsIdB = secondary.id;
}, 30_000);

beforeEach(() => {
  broadcastState.calls = [];
});

afterAll(async () => {
  deleteWorkspace(wsId);
  deleteWorkspace(wsIdB);
  await stopTestServer();
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function blueprintBroadcasts(forWorkspaceId: string) {
  return broadcastState.calls.filter(
    (c) => c.event === WS_EVENTS.BLUEPRINT_UPDATED && c.workspaceId === forWorkspaceId,
  );
}

// ===========================================================================
// Blueprint create — broadcast payload
// ===========================================================================
describe('Blueprint create — broadcast payload', () => {
  let blueprintId = '';

  afterAll(async () => {
    if (blueprintId) await del(`/api/page-strategy/${wsId}/${blueprintId}`).catch(() => undefined);
  });

  it('POST blueprint fires BLUEPRINT_UPDATED broadcast with action=created', async () => {
    const res = await postJson(`/api/page-strategy/${wsId}`, {
      name: 'Broadcast Create Test',
      status: 'draft',
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as SiteBlueprint;
    blueprintId = body.id;

    const broadcasts = blueprintBroadcasts(wsId);
    expect(broadcasts.length).toBeGreaterThanOrEqual(1);
    const last = broadcasts[broadcasts.length - 1].payload as Record<string, unknown>;
    expect(last.action).toBe('created');
    expect(last.blueprint).toBeDefined();
  });

  it('broadcast payload contains correct workspaceId target', async () => {
    const res = await postJson(`/api/page-strategy/${wsId}`, {
      name: 'Workspace Target Test',
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as SiteBlueprint;

    const broadcasts = blueprintBroadcasts(wsId);
    expect(broadcasts.length).toBeGreaterThanOrEqual(1);
    // All blueprint broadcasts must target wsId, not wsIdB
    for (const b of broadcasts) {
      expect(b.workspaceId).toBe(wsId);
      expect(b.workspaceId).not.toBe(wsIdB);
    }

    await del(`/api/page-strategy/${wsId}/${body.id}`).catch(() => undefined);
  });
});

// ===========================================================================
// Blueprint update — broadcast + status transitions
// ===========================================================================
describe('Blueprint update — broadcast + status transitions', () => {
  let blueprintId = '';

  beforeAll(async () => {
    const res = await postJson(`/api/page-strategy/${wsId}`, {
      name: 'Status Transition Blueprint',
      status: 'draft',
    });
    const body = (await res.json()) as SiteBlueprint;
    blueprintId = body.id;
  });

  afterAll(async () => {
    if (blueprintId) await del(`/api/page-strategy/${wsId}/${blueprintId}`).catch(() => undefined);
  });

  it('PUT blueprint fires BLUEPRINT_UPDATED broadcast with action=updated', async () => {
    const res = await putJson(`/api/page-strategy/${wsId}/${blueprintId}`, {
      name: 'Updated Name',
    });
    expect(res.status).toBe(200);

    const broadcasts = blueprintBroadcasts(wsId);
    expect(broadcasts.length).toBeGreaterThanOrEqual(1);
    const last = broadcasts[broadcasts.length - 1].payload as Record<string, unknown>;
    expect(last.action).toBe('updated');
    expect(last.blueprint).toBeDefined();
  });

  it('PUT blueprint status draft → active returns 200 with updated status', async () => {
    const res = await putJson(`/api/page-strategy/${wsId}/${blueprintId}`, {
      status: 'active',
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as SiteBlueprint;
    expect(body.status).toBe('active');
  });

  it('PUT blueprint status active → archived returns 200 with updated status', async () => {
    const res = await putJson(`/api/page-strategy/${wsId}/${blueprintId}`, {
      status: 'archived',
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as SiteBlueprint;
    expect(body.status).toBe('archived');
  });

  it('PUT blueprint with nullable fields (notes, industryType) returns 200', async () => {
    // First set them to non-null values
    await putJson(`/api/page-strategy/${wsId}/${blueprintId}`, {
      notes: 'Some notes',
      industryType: 'healthcare',
    });

    // Then clear them to null
    const res = await putJson(`/api/page-strategy/${wsId}/${blueprintId}`, {
      notes: null,
      industryType: null,
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as SiteBlueprint;
    // The mapper converts null DB values to undefined (omitted key) — both are falsy
    expect(body.notes == null).toBe(true);
    expect(body.industryType == null).toBe(true);
  });

  it('PUT blueprint with nonexistent blueprintId returns 404', async () => {
    const res = await putJson(`/api/page-strategy/${wsId}/bp_does_not_exist`, {
      name: 'Should Not Work',
    });
    expect(res.status).toBe(404);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body).toHaveProperty('error');
  });
});

// ===========================================================================
// Blueprint delete — broadcast payload
// ===========================================================================
describe('Blueprint delete — broadcast payload', () => {
  it('DELETE blueprint fires BLUEPRINT_UPDATED broadcast with deleted=true', async () => {
    const createRes = await postJson(`/api/page-strategy/${wsId}`, {
      name: 'Delete Broadcast Blueprint',
    });
    expect(createRes.status).toBe(200);
    const { id: bpId } = (await createRes.json()) as SiteBlueprint;

    const delRes = await del(`/api/page-strategy/${wsId}/${bpId}`);
    expect(delRes.status).toBe(204);

    const broadcasts = blueprintBroadcasts(wsId);
    expect(broadcasts.length).toBeGreaterThanOrEqual(1);
    const last = broadcasts[broadcasts.length - 1].payload as Record<string, unknown>;
    expect(last.deleted).toBe(true);
    expect(last.blueprintId).toBe(bpId);
  });

  it('DELETE blueprint in wrong workspace returns 404 (cross-workspace isolation)', async () => {
    // Create a blueprint in wsId
    const createRes = await postJson(`/api/page-strategy/${wsId}`, {
      name: 'Cross-Workspace Delete Target',
    });
    expect(createRes.status).toBe(200);
    const { id: bpId } = (await createRes.json()) as SiteBlueprint;

    // Attempt to delete it via wsIdB — must return 404
    const delRes = await del(`/api/page-strategy/${wsIdB}/${bpId}`);
    expect(delRes.status).toBe(404);

    // Blueprint must still exist in wsId
    const getRes = await api(`/api/page-strategy/${wsId}/${bpId}`);
    expect(getRes.status).toBe(200);

    // Cleanup
    await del(`/api/page-strategy/${wsId}/${bpId}`);
  });
});

// ===========================================================================
// Entry mutations — broadcast payloads
// ===========================================================================
describe('Entry mutations — broadcast payloads', () => {
  let blueprintId = '';
  let entryId = '';

  beforeAll(async () => {
    const res = await postJson(`/api/page-strategy/${wsId}`, {
      name: 'Entry Broadcast Blueprint',
    });
    blueprintId = ((await res.json()) as SiteBlueprint).id;
  });

  afterAll(async () => {
    if (blueprintId) await del(`/api/page-strategy/${wsId}/${blueprintId}`).catch(() => undefined);
  });

  it('POST entry fires BLUEPRINT_UPDATED broadcast with action=entries_updated', async () => {
    const res = await postJson(`/api/page-strategy/${wsId}/${blueprintId}/entries`, {
      name: 'Entry Broadcast Test',
      pageType: 'service',
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as BlueprintEntry;
    entryId = body.id;

    const broadcasts = blueprintBroadcasts(wsId);
    expect(broadcasts.length).toBeGreaterThanOrEqual(1);
    const last = broadcasts[broadcasts.length - 1].payload as Record<string, unknown>;
    expect(last.action).toBe('entries_updated');
    expect(last.blueprintId).toBe(blueprintId);
  });

  it('PUT entry fires BLUEPRINT_UPDATED broadcast with action=entries_updated', async () => {
    const res = await putJson(
      `/api/page-strategy/${wsId}/${blueprintId}/entries/${entryId}`,
      { name: 'Entry Updated' },
    );
    expect(res.status).toBe(200);

    const broadcasts = blueprintBroadcasts(wsId);
    expect(broadcasts.length).toBeGreaterThanOrEqual(1);
    const last = broadcasts[broadcasts.length - 1].payload as Record<string, unknown>;
    expect(last.action).toBe('entries_updated');
    expect(last.blueprintId).toBe(blueprintId);
  });

  it('PUT entries/reorder fires BLUEPRINT_UPDATED broadcast with action=entries_updated', async () => {
    // Add a second entry to have two to reorder
    const res2 = await postJson(`/api/page-strategy/${wsId}/${blueprintId}/entries`, {
      name: 'Second Entry',
      pageType: 'blog',
    });
    const entry2 = (await res2.json()) as BlueprintEntry;

    const reorderRes = await putJson(
      `/api/page-strategy/${wsId}/${blueprintId}/entries/reorder`,
      { orderedIds: [entry2.id, entryId] },
    );
    expect(reorderRes.status).toBe(200);

    const broadcasts = blueprintBroadcasts(wsId);
    expect(broadcasts.length).toBeGreaterThanOrEqual(1);
    const last = broadcasts[broadcasts.length - 1].payload as Record<string, unknown>;
    expect(last.action).toBe('entries_updated');

    await del(`/api/page-strategy/${wsId}/${blueprintId}/entries/${entry2.id}`).catch(() => undefined);
  });

  it('DELETE entry fires BLUEPRINT_UPDATED broadcast with action=entries_updated', async () => {
    const delRes = await del(`/api/page-strategy/${wsId}/${blueprintId}/entries/${entryId}`);
    expect(delRes.status).toBe(204);

    const broadcasts = blueprintBroadcasts(wsId);
    expect(broadcasts.length).toBeGreaterThanOrEqual(1);
    const last = broadcasts[broadcasts.length - 1].payload as Record<string, unknown>;
    expect(last.action).toBe('entries_updated');
  });
});

// ===========================================================================
// Entry field updates — keyword and sectionPlan fields
// ===========================================================================
describe('Entry field updates — keywords and sectionPlan', () => {
  let blueprintId = '';
  let entryId = '';

  beforeAll(async () => {
    const bpRes = await postJson(`/api/page-strategy/${wsId}`, {
      name: 'Entry Field Update Blueprint',
    });
    blueprintId = ((await bpRes.json()) as SiteBlueprint).id;

    const entryRes = await postJson(`/api/page-strategy/${wsId}/${blueprintId}/entries`, {
      name: 'Keyword Entry',
      pageType: 'service',
    });
    entryId = ((await entryRes.json()) as BlueprintEntry).id;
  });

  afterAll(async () => {
    if (blueprintId) await del(`/api/page-strategy/${wsId}/${blueprintId}`).catch(() => undefined);
  });

  it('PUT entry with secondaryKeywords array persists correctly', async () => {
    const keywords = ['seo services', 'local seo', 'technical seo'];
    const res = await putJson(
      `/api/page-strategy/${wsId}/${blueprintId}/entries/${entryId}`,
      { secondaryKeywords: keywords },
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as BlueprintEntry;
    expect(body.secondaryKeywords).toEqual(keywords);
  });

  it('PUT entry with keywordSource=semrush persists correctly', async () => {
    const res = await putJson(
      `/api/page-strategy/${wsId}/${blueprintId}/entries/${entryId}`,
      { keywordSource: 'semrush' },
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as BlueprintEntry;
    expect(body.keywordSource).toBe('semrush');
  });

  it('PUT entry with sectionPlan array persists section types', async () => {
    const sectionPlan = [
      { sectionType: 'hero', order: 0 },
      { sectionType: 'features', order: 1, wordCountTarget: 300 },
    ];
    const res = await putJson(
      `/api/page-strategy/${wsId}/${blueprintId}/entries/${entryId}`,
      { sectionPlan },
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as BlueprintEntry;
    expect(Array.isArray(body.sectionPlan)).toBe(true);
    const types = (body.sectionPlan ?? []).map((s: { sectionType: string }) => s.sectionType);
    expect(types).toContain('hero');
    expect(types).toContain('features');
  });

  it('PUT entry with nullable fields (primaryKeyword null) returns 200', async () => {
    // First set primaryKeyword
    await putJson(`/api/page-strategy/${wsId}/${blueprintId}/entries/${entryId}`, {
      primaryKeyword: 'seo agency',
    });

    // Now clear it
    const res = await putJson(
      `/api/page-strategy/${wsId}/${blueprintId}/entries/${entryId}`,
      { primaryKeyword: null },
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as BlueprintEntry;
    // The mapper converts null DB values to undefined (omitted key) — both are falsy
    expect(body.primaryKeyword == null).toBe(true);
  });
});

// ===========================================================================
// Version creation — broadcast + optional changeNotes
// ===========================================================================
describe('Version creation — broadcast + optional changeNotes', () => {
  let blueprintId = '';

  beforeAll(async () => {
    const res = await postJson(`/api/page-strategy/${wsId}`, {
      name: 'Version Broadcast Blueprint',
    });
    blueprintId = ((await res.json()) as SiteBlueprint).id;
  });

  afterAll(async () => {
    if (blueprintId) await del(`/api/page-strategy/${wsId}/${blueprintId}`).catch(() => undefined);
  });

  it('POST versions fires BLUEPRINT_UPDATED broadcast with action=version_created', async () => {
    const res = await postJson(`/api/page-strategy/${wsId}/${blueprintId}/versions`, {
      changeNotes: 'Lifecycle test snapshot',
    });
    expect(res.status).toBe(200);

    const broadcasts = blueprintBroadcasts(wsId);
    expect(broadcasts.length).toBeGreaterThanOrEqual(1);
    const last = broadcasts[broadcasts.length - 1].payload as Record<string, unknown>;
    expect(last.action).toBe('version_created');
    expect(last.blueprintId).toBe(blueprintId);
    expect(typeof last.version).toBe('number');
  });

  it('POST versions without changeNotes (optional) still creates version at 200', async () => {
    const res = await postJson(`/api/page-strategy/${wsId}/${blueprintId}/versions`, {});
    expect(res.status).toBe(200);
    const body = (await res.json()) as BlueprintVersion;
    expect(body.id).toBeDefined();
    expect(body.blueprintId).toBe(blueprintId);
    // changeNotes may be null or undefined — just verify snapshot is present
    expect(body.snapshot).toBeDefined();
  });

  it('POST versions for nonexistent blueprint returns 404', async () => {
    const res = await postJson(`/api/page-strategy/${wsId}/bp_nonexistent_xyz/versions`, {
      changeNotes: 'Should fail',
    });
    expect(res.status).toBe(404);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body).toHaveProperty('error');
  });

  it('GET versions for wrong workspace returns 404 (cross-workspace isolation)', async () => {
    const res = await api(`/api/page-strategy/${wsIdB}/${blueprintId}/versions`);
    expect(res.status).toBe(404);
  });
});

// ===========================================================================
// Zod validation — enum fields
// ===========================================================================
describe('Zod validation — enum fields', () => {
  let blueprintId = '';

  beforeAll(async () => {
    const res = await postJson(`/api/page-strategy/${wsId}`, {
      name: 'Zod Validation Blueprint',
    });
    blueprintId = ((await res.json()) as SiteBlueprint).id;
  });

  afterAll(async () => {
    if (blueprintId) await del(`/api/page-strategy/${wsId}/${blueprintId}`).catch(() => undefined);
  });

  it('POST blueprint with invalid status enum returns 400', async () => {
    const res = await postJson(`/api/page-strategy/${wsId}`, {
      name: 'Invalid Status',
      status: 'published', // not in enum
    });
    expect(res.status).toBe(400);
  });

  it('PUT blueprint with invalid status enum returns 400', async () => {
    const res = await putJson(`/api/page-strategy/${wsId}/${blueprintId}`, {
      status: 'live', // not in enum
    });
    expect(res.status).toBe(400);
  });

  it('POST entry with invalid scope enum returns 400', async () => {
    const res = await postJson(`/api/page-strategy/${wsId}/${blueprintId}/entries`, {
      name: 'Bad Scope',
      pageType: 'service',
      scope: 'optional', // not 'included' | 'recommended'
    });
    expect(res.status).toBe(400);
  });

  it('POST entry with invalid keywordSource enum returns 400', async () => {
    const res = await postJson(`/api/page-strategy/${wsId}/${blueprintId}/entries`, {
      name: 'Bad Source',
      pageType: 'service',
      keywordSource: 'google_ads', // not in enum
    });
    expect(res.status).toBe(400);
  });

  it('PUT entries/reorder with empty orderedIds array returns 400', async () => {
    const res = await putJson(
      `/api/page-strategy/${wsId}/${blueprintId}/entries/reorder`,
      { orderedIds: [] }, // min(1) — empty array is invalid
    );
    expect(res.status).toBe(400);
  });
});
