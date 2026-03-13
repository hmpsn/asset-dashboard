/**
 * API-level E2E test: Content request lifecycle.
 *
 * Tests the complete multi-step flow:
 * 1. Create workspace
 * 2. Create content brief via SQLite
 * 3. Create content request
 * 4. List content requests
 * 5. Update content request status through lifecycle
 * 6. Check content performance endpoint
 * 7. Clean up
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createTestContext } from './helpers.js';
import { createWorkspace, deleteWorkspace } from '../../server/workspaces.js';
import { createContentRequest } from '../../server/content-requests.js';
import db from '../../server/db/index.js';

const ctx = createTestContext(13231);
const { api, postJson, patchJson, del } = ctx;

let testWsId = '';
let requestId = '';

beforeAll(async () => {
  await ctx.startServer();
  const ws = createWorkspace('E2E Content Flow');
  testWsId = ws.id;

  // Seed a content request using the proper module function
  const req = createContentRequest(testWsId, {
    topic: 'E2E Test Topic',
    targetKeyword: 'e2e test keyword',
    intent: 'informational',
    priority: 'medium',
    rationale: 'E2E test rationale',
    pageType: 'blog',
    initialStatus: 'requested',
  });
  requestId = req.id;
}, 25_000);

afterAll(() => {
  // Clean up seeded data
  db.prepare('DELETE FROM content_topic_requests WHERE workspace_id = ?').run(testWsId);
  deleteWorkspace(testWsId);
  ctx.stopServer();
});

describe('E2E: Content request lifecycle', () => {
  it('Step 1: List content requests includes seeded request', async () => {
    const res = await api(`/api/content-requests/${testWsId}`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(Array.isArray(body)).toBe(true);
    const ours = body.find((r: { id: string }) => r.id === requestId);
    expect(ours).toBeDefined();
    expect(ours.topic).toBe('E2E Test Topic');
    expect(ours.status).toBe('requested');
  });

  it('Step 2: Get single content request', async () => {
    const res = await api(`/api/content-requests/${testWsId}/${requestId}`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.id).toBe(requestId);
    expect(body.targetKeyword).toBe('e2e test keyword');
  });

  it('Step 3: Update request to in_progress', async () => {
    const res = await patchJson(`/api/content-requests/${testWsId}/${requestId}`, {
      status: 'in_progress',
      internalNote: 'Writer assigned',
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.status).toBe('in_progress');
  });

  it('Step 4: Update request to delivered with URL', async () => {
    const res = await patchJson(`/api/content-requests/${testWsId}/${requestId}`, {
      status: 'delivered',
      deliveryUrl: 'https://example.com/blog/e2e-test',
      deliveryNotes: 'Blog post published successfully',
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.status).toBe('delivered');
    expect(body.deliveryUrl).toBe('https://example.com/blog/e2e-test');
  });

  it('Step 5: Content performance endpoint returns valid response', async () => {
    const res = await api(`/api/content-performance/${testWsId}`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toHaveProperty('items');
    expect(Array.isArray(body.items)).toBe(true);
    // Delivered requests appear in performance data (GSC/GA4 fields may be null
    // without integration credentials, but the shape should be correct)
    if (body.items.length > 0) {
      const first = body.items[0];
      expect(first).toHaveProperty('requestId');
      expect(first).toHaveProperty('topic');
      expect(first).toHaveProperty('status');
    }
  });

  it('Step 6: Delete the content request', async () => {
    const res = await del(`/api/content-requests/${testWsId}/${requestId}`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
  });

  it('Step 7: Request no longer exists', async () => {
    const res = await api(`/api/content-requests/${testWsId}/${requestId}`);
    expect(res.status).toBe(404);
  });
});
