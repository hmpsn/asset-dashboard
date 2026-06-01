/**
 * Integration tests — Task 2.6 (webflow-schema CMS-field branch)
 *
 * Verifies that the CMS-field delivery path of POST
 * /api/webflow/schema-publish/:siteId records exactly one tracked_action row
 * on success, and that a second identical call is a no-op (idempotency via
 * getActionByWorkspaceAndSource guard).
 *
 * The CMS-field branch is taken when publishSchemaToCmsField() returns a
 * non-null, non-blocked/failed status.  This requires seeding:
 *   - A workspace row with webflow_site_id
 *   - A schema_snapshots row with a page whose generationDiagnostics.collection
 *     has collectionId + itemId
 *   - A schema_cms_field_mappings row mapping that collectionId to a fieldSlug
 * Then mocking the three Webflow API calls made by publishSchemaToCmsField.
 *
 * Uses the in-process createApp() pattern so vi.mock interceptors work.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import http from 'http';
import type { AddressInfo } from 'net';
import { vi } from 'vitest';
import { randomUUID } from 'crypto';
import db from '../../server/db/index.js';
import {
  setupWebflowMocks,
  mockWebflowSuccess,
  resetWebflowMocks,
} from '../mocks/webflow.js';

// ── Mock setup ─────────────────────────────────────────────────────────────
setupWebflowMocks();

vi.mock('../../server/broadcast.js', () => ({
  setBroadcast: vi.fn(),
  broadcast: vi.fn(),
  broadcastToWorkspace: vi.fn(),
}));

vi.mock('../../server/outcome-measurement.js', () => ({
  captureBaselineFromGsc: vi.fn().mockResolvedValue(undefined),
  computeAttributedValue: vi.fn().mockResolvedValue(null),
  scoreActionAtCheckpoint: vi.fn(),
  runMeasurementCycle: vi.fn(),
}));

// ── Constants ──────────────────────────────────────────────────────────────
const TEST_COLLECTION_ID = 'col_schema_tracking_test';
const TEST_ITEM_ID = 'item_schema_tracking_test';
const TEST_SCHEMA_FIELD_SLUG = 'schema-json';

// Minimal WebPage schema — passes skipValidation=true path so we don't need
// to satisfy Google Rich Results validation.
const VALID_SCHEMA: Record<string, unknown> = {
  '@context': 'https://schema.org',
  '@type': 'WebPage',
  name: 'Test Page for Action Tracking',
};

// ── In-process server ──────────────────────────────────────────────────────
async function startTestServer(): Promise<{ baseUrl: string; stop: () => void }> {
  delete process.env.APP_PASSWORD;
  const { createApp } = await import('../../server/app.js');
  const app = createApp();
  const server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  return {
    baseUrl: `http://127.0.0.1:${port}`,
    stop: () => server.close(),
  };
}

async function postJson(
  baseUrl: string,
  path: string,
  body: unknown,
): Promise<{ status: number; body: unknown }> {
  const res = await fetch(`${baseUrl}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  return { status: res.status, body: await res.json().catch(() => ({})) };
}

// ── Seed helpers ───────────────────────────────────────────────────────────

interface SeededSchemaEnv {
  workspaceId: string;
  siteId: string;
  pageId: string;
  cleanup: () => void;
}

/**
 * Seeds a workspace + schema_snapshots + schema_cms_field_mappings such that
 * publishSchemaToCmsField() will take the CMS-field delivery path.
 */
function seedCmsFieldEnv(): SeededSchemaEnv {
  const suffix = randomUUID().slice(0, 8);
  const workspaceId = `ws-schema-track-${suffix}`;
  const siteId = `site-schema-track-${suffix}`;
  const pageId = `page-schema-track-${suffix}`;
  const snapshotId = `snap-${suffix}`;
  const now = new Date().toISOString();

  // Workspace
  db.prepare(
    `INSERT OR IGNORE INTO workspaces (id, name, folder, tier, webflow_site_id, webflow_token, created_at)
     VALUES (?, ?, ?, 'free', ?, 'test-token', ?)`,
  ).run(workspaceId, `Schema Track WS ${suffix}`, `schema-track-${suffix}`, siteId, now);

  // Schema snapshot — the page must have generationDiagnostics.collection with
  // collectionId and itemId so publishSchemaToCmsField returns non-null.
  const pageResult = {
    pageId,
    pageTitle: `Test Page ${suffix}`,
    suggestedSchemas: [{ template: VALID_SCHEMA }],
    generationDiagnostics: {
      collection: {
        collectionId: TEST_COLLECTION_ID,
        itemId: TEST_ITEM_ID,
        collectionName: 'Pages',
      },
    },
  };
  db.prepare(
    `INSERT OR REPLACE INTO schema_snapshots (id, site_id, workspace_id, created_at, results, page_count)
     VALUES (?, ?, ?, ?, ?, 1)`,
  ).run(snapshotId, siteId, workspaceId, now, JSON.stringify([pageResult]));

  // CMS field mapping — maps collectionId to schemaFieldSlug
  db.prepare(
    `INSERT OR REPLACE INTO schema_cms_field_mappings
       (site_id, collection_id, collection_name, collection_slug, schema_field_slug, updated_at)
     VALUES (?, ?, 'Pages', 'pages', ?, ?)`,
  ).run(siteId, TEST_COLLECTION_ID, TEST_SCHEMA_FIELD_SLUG, now);

  const cleanup = () => {
    db.prepare('DELETE FROM tracked_actions WHERE workspace_id = ?').run(workspaceId);
    db.prepare('DELETE FROM schema_cms_field_mappings WHERE site_id = ?').run(siteId);
    db.prepare('DELETE FROM schema_snapshots WHERE site_id = ?').run(siteId);
    db.prepare('DELETE FROM workspaces WHERE id = ?').run(workspaceId);
  };

  return { workspaceId, siteId, pageId, cleanup };
}

// ── Webflow API mocks for the CMS-field delivery path ─────────────────────
//
// publishSchemaToCmsField makes three Webflow calls:
//   1. GET /collections/:id          (getCollectionSchema)
//   2. GET /collections/:id/items/:id (getCollectionItem)
//   3. PATCH /collections/:id/items/:id (updateCollectionItem)
//
// We return a PlainText field with the expected slug and an item whose current
// field value differs from the new schema JSON so the update branch is taken.

function mockCmsFieldSuccess(): void {
  // 1. Collection schema — returns one PlainText field with our slug
  mockWebflowSuccess(`/collections/${TEST_COLLECTION_ID}`, {
    fields: [
      { id: 'f1', displayName: 'Schema JSON', type: 'PlainText', slug: TEST_SCHEMA_FIELD_SLUG },
    ],
  });

  // 2. Collection item — field has a stale/different value so update is triggered
  mockWebflowSuccess(`/collections/${TEST_COLLECTION_ID}/items/${TEST_ITEM_ID}`, {
    fieldData: { [TEST_SCHEMA_FIELD_SLUG]: 'stale-schema-value' },
  });

  // 3. Update collection item — succeeds
  mockWebflowSuccess(`/collections/${TEST_COLLECTION_ID}/items/${TEST_ITEM_ID}`, {
    id: TEST_ITEM_ID,
  });
}

// ── Tracked-action query helper ────────────────────────────────────────────
function countTrackedActions(workspaceId: string, sourceType: string, sourceId: string): number {
  const row = db.prepare(
    `SELECT COUNT(*) AS cnt FROM tracked_actions
     WHERE workspace_id = ? AND source_type = ? AND source_id = ?`,
  ).get(workspaceId, sourceType, sourceId) as { cnt: number };
  return row.cnt;
}

// ── Tests ──────────────────────────────────────────────────────────────────
describe('Task 2.6 — webflow-schema CMS-field branch records tracked_action', () => {
  let env: SeededSchemaEnv;
  let baseUrl: string;
  let stopServer: () => void;

  beforeEach(async () => {
    resetWebflowMocks();
    const server = await startTestServer();
    baseUrl = server.baseUrl;
    stopServer = server.stop;
    env = seedCmsFieldEnv();
  });

  afterEach(() => {
    stopServer();
    env.cleanup();
  });

  it('records exactly one tracked_action on a successful CMS-field schema deploy', async () => {
    mockCmsFieldSuccess();

    // Precondition: no tracked action exists
    expect(countTrackedActions(env.workspaceId, 'schema', env.pageId)).toBe(0);

    // Act — skipValidation=true so we bypass Google Rich Results validation
    const { status, body } = await postJson(
      baseUrl,
      `/api/webflow/schema-publish/${env.siteId}`,
      {
        pageId: env.pageId,
        schema: VALID_SCHEMA,
        publishAfter: false,
        skipValidation: true,
      },
    );

    expect(status).toBe(200);
    // CMS-field delivery returns success:true + cmsDeliveryStatus
    const b = body as Record<string, unknown>;
    expect(b.success).toBe(true);

    // Assert — exactly one tracked action row
    expect(countTrackedActions(env.workspaceId, 'schema', env.pageId)).toBe(1);

    // Verify action_type
    const row = db.prepare(
      `SELECT action_type FROM tracked_actions
       WHERE workspace_id = ? AND source_type = 'schema' AND source_id = ?`,
    ).get(env.workspaceId, env.pageId) as { action_type: string } | undefined;
    expect(row).toBeDefined();
    expect(row!.action_type).toBe('schema_deployed');
  });

  it('is idempotent — second CMS-field publish call does NOT add a second tracked_action', async () => {
    // First call
    mockCmsFieldSuccess();
    const first = await postJson(
      baseUrl,
      `/api/webflow/schema-publish/${env.siteId}`,
      { pageId: env.pageId, schema: VALID_SCHEMA, publishAfter: false, skipValidation: true },
    );
    expect(first.status).toBe(200);
    expect(countTrackedActions(env.workspaceId, 'schema', env.pageId)).toBe(1);

    // Second call — even if Webflow returns 'unchanged', the guard prevents a
    // duplicate tracked_action.
    // Re-mock: field now matches current value so CMS returns 'unchanged' status
    mockWebflowSuccess(`/collections/${TEST_COLLECTION_ID}`, {
      fields: [{ id: 'f1', displayName: 'Schema JSON', type: 'PlainText', slug: TEST_SCHEMA_FIELD_SLUG }],
    });
    const currentSchemaJson = JSON.stringify(VALID_SCHEMA).replace(/<\/script/gi, '<\\/script');
    mockWebflowSuccess(`/collections/${TEST_COLLECTION_ID}/items/${TEST_ITEM_ID}`, {
      fieldData: { [TEST_SCHEMA_FIELD_SLUG]: currentSchemaJson },
    });

    const second = await postJson(
      baseUrl,
      `/api/webflow/schema-publish/${env.siteId}`,
      { pageId: env.pageId, schema: VALID_SCHEMA, publishAfter: false, skipValidation: true },
    );
    expect(second.status).toBe(200);

    // Still only one row
    expect(countTrackedActions(env.workspaceId, 'schema', env.pageId)).toBe(1);
  });
});
