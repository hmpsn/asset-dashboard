/**
 * Integration tests — Task 2.6 (content-publish path)
 *
 * Verifies that the manual publish route (POST
 * /api/content-posts/:workspaceId/:postId/publish-to-webflow) records exactly
 * one tracked_action row on success, and that a second identical call is a
 * no-op (idempotency via getActionByWorkspaceAndSource guard).
 *
 * Uses the in-process createApp() pattern so vi.mock interceptors work.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import http from 'http';
import type { AddressInfo } from 'net';
import { vi } from 'vitest';
import db from '../../server/db/index.js';
import {
  setupWebflowMocks,
  mockWebflowSuccess,
  resetWebflowMocks,
} from '../mocks/webflow.js';
import { seedContentData } from '../fixtures/content-seed.js';
import type { SeededContent } from '../fixtures/content-seed.js';

// ── Mock setup ─────────────────────────────────────────────────────────────
// setupWebflowMocks() calls vi.mock() at module scope (hoisted by Vitest).
setupWebflowMocks();

// Broadcast is a no-op in tests — the WS layer is not initialised.
vi.mock('../../server/broadcast.js', () => ({
  setBroadcast: vi.fn(),
  broadcast: vi.fn(),
  broadcastToWorkspace: vi.fn(),
}));

// captureBaselineFromGsc is fire-and-forget; silence it so we don't need a
// real GSC token in this test.
vi.mock('../../server/outcome-measurement.js', () => ({
  captureBaselineFromGsc: vi.fn().mockResolvedValue(undefined),
  computeAttributedValue: vi.fn().mockResolvedValue(null),
  scoreActionAtCheckpoint: vi.fn(),
  runMeasurementCycle: vi.fn(),
}));

// ── Constants ──────────────────────────────────────────────────────────────
const TEST_SITE_ID = 'site_action_tracking_test';
const TEST_COLLECTION_ID = 'col_action_tracking_test';
const TEST_ITEM_ID = 'item_action_tracking_test';
const TEST_TOKEN = 'token-action-tracking-test';

const PUBLISH_TARGET = JSON.stringify({
  collectionId: TEST_COLLECTION_ID,
  collectionName: 'Blog',
  fieldMap: { title: 'name', slug: 'slug', body: 'post-body' },
});

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

// ── Seed helper ────────────────────────────────────────────────────────────
function seedPublishableContent(): SeededContent {
  const seeded = seedContentData();
  db.prepare(
    `UPDATE workspaces
     SET webflow_site_id = ?, webflow_token = ?, publish_target = ?
     WHERE id = ?`,
  ).run(TEST_SITE_ID, TEST_TOKEN, PUBLISH_TARGET, seeded.workspaceId);
  db.prepare(`UPDATE content_posts SET status = 'draft' WHERE id = ?`).run(seeded.postId);
  return seeded;
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
describe('Task 2.6 — content-publish path records tracked_action', () => {
  let content: SeededContent;
  let baseUrl: string;
  let stopServer: () => void;

  beforeEach(async () => {
    resetWebflowMocks();
    const server = await startTestServer();
    baseUrl = server.baseUrl;
    stopServer = server.stop;
    content = seedPublishableContent();
  });

  afterEach(() => {
    stopServer();
    content.cleanup();
    // Clean up any tracked_actions rows seeded by the test
    db.prepare('DELETE FROM tracked_actions WHERE workspace_id = ?').run(content.workspaceId);
  });

  it('records exactly one tracked_action on a successful publish', async () => {
    // Arrange — Webflow responds with success for both create and publish
    mockWebflowSuccess(`/collections/${TEST_COLLECTION_ID}/items`, { id: TEST_ITEM_ID });
    mockWebflowSuccess(`/collections/${TEST_COLLECTION_ID}/items/publish`, {
      publishedItemIds: [TEST_ITEM_ID],
    });

    // Precondition: no tracked action exists yet
    expect(countTrackedActions(content.workspaceId, 'post', content.postId)).toBe(0);

    // Act
    const { status } = await postJson(
      baseUrl,
      `/api/content-posts/${content.workspaceId}/${content.postId}/publish-to-webflow`,
      {},
    );

    expect(status).toBe(200);

    // Assert — exactly one row recorded
    expect(countTrackedActions(content.workspaceId, 'post', content.postId)).toBe(1);

    // Verify the row carries the correct action_type
    const row = db.prepare(
      `SELECT action_type, source_type, source_id FROM tracked_actions
       WHERE workspace_id = ? AND source_type = 'post' AND source_id = ?`,
    ).get(content.workspaceId, content.postId) as {
      action_type: string; source_type: string; source_id: string;
    } | undefined;
    expect(row).toBeDefined();
    expect(row!.action_type).toBe('content_published');
  });

  it('is idempotent — a second publish call does NOT add a second tracked_action row', async () => {
    // Arrange — two successful Webflow round-trips
    mockWebflowSuccess(`/collections/${TEST_COLLECTION_ID}/items`, { id: TEST_ITEM_ID });
    mockWebflowSuccess(`/collections/${TEST_COLLECTION_ID}/items/publish`, {
      publishedItemIds: [TEST_ITEM_ID],
    });

    // First publish
    const first = await postJson(
      baseUrl,
      `/api/content-posts/${content.workspaceId}/${content.postId}/publish-to-webflow`,
      {},
    );
    expect(first.status).toBe(200);
    expect(countTrackedActions(content.workspaceId, 'post', content.postId)).toBe(1);

    // Second publish (update path — item already has webflow_item_id)
    mockWebflowSuccess(
      `/collections/${TEST_COLLECTION_ID}/items/${TEST_ITEM_ID}`,
      { id: TEST_ITEM_ID },
    );
    mockWebflowSuccess(`/collections/${TEST_COLLECTION_ID}/items/publish`, {
      publishedItemIds: [TEST_ITEM_ID],
    });

    const second = await postJson(
      baseUrl,
      `/api/content-posts/${content.workspaceId}/${content.postId}/publish-to-webflow`,
      {},
    );
    expect(second.status).toBe(200);

    // Still only one tracked action — guard prevented duplication
    expect(countTrackedActions(content.workspaceId, 'post', content.postId)).toBe(1);
  });
});
