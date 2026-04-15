/**
 * Integration test: public comment author override enforcement.
 *
 * The POST /api/public/content-request/:workspaceId/:id/comment endpoint
 * is unauthenticated. The handler hardcodes `author = 'client'` and must
 * NEVER persist a client-supplied 'team' value — even if the Zod schema
 * previously accepted it or a future developer re-introduces that pattern.
 *
 * This test is the safety net for that contract. If someone widens the
 * schema back to `z.enum(['client', 'team'])` and uses `req.body.author`,
 * this test will catch the regression.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createTestContext } from './helpers.js';
import { createWorkspace, deleteWorkspace } from '../../server/workspaces.js';
import { createContentRequest } from '../../server/content-requests.js';

// ── Unique port ──────────────────────────────────────────────────────────────
const ctx = createTestContext(13262);
const { postJson } = ctx;

let wsId = '';
let requestId = '';

beforeAll(async () => {
  await ctx.startServer();
  const ws = createWorkspace('Comment Author Test Workspace');
  wsId = ws.id;
  const req = createContentRequest(wsId, {
    topic: 'Test topic',
    targetKeyword: 'test-keyword',
    intent: 'informational',
    priority: 'medium',
    rationale: 'Test rationale',
  });
  requestId = req.id;
}, 25_000);

afterAll(() => {
  deleteWorkspace(wsId);
  ctx.stopServer();
});

describe('POST /api/public/content-request/:workspaceId/:id/comment — author override', () => {
  it('saves author as "client" when caller supplies author: "team"', async () => {
    const res = await postJson(
      `/api/public/content-request/${wsId}/${requestId}/comment`,
      { content: 'Test comment from team impersonator', author: 'team' },
    );
    expect(res.status).toBe(200);
    const body = await res.json() as { comments: Array<{ author: string; content: string }> };
    const saved = body.comments.at(-1);
    expect(saved?.author).toBe('client');
    expect(saved?.content).toBe('Test comment from team impersonator');
  });

  it('saves author as "client" when caller omits author', async () => {
    const res = await postJson(
      `/api/public/content-request/${wsId}/${requestId}/comment`,
      { content: 'Another comment, no author field' },
    );
    expect(res.status).toBe(200);
    const body = await res.json() as { comments: Array<{ author: string }> };
    expect(body.comments.at(-1)?.author).toBe('client');
  });

  it('rejects empty content with 400', async () => {
    const res = await postJson(
      `/api/public/content-request/${wsId}/${requestId}/comment`,
      { content: '' },
    );
    expect(res.status).toBe(400);
  });
});
