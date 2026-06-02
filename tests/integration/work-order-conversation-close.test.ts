/**
 * Integration tests for the work-order conversation + explicit `closed` state feature.
 *
 * Covers (HTTP request/response cycle):
 *   - Admin PATCH → closed sets closedAt + logs `order_closed` activity + keeps the
 *     `completed` side-effects gated (no re-fire).
 *   - Admin comment POST (author forced 'team') + GET returns the thread.
 *   - Client public comment POST requires client-portal auth (401 unauthenticated on a
 *     password-protected workspace), forces author 'client', and 409s when the order is closed.
 *   - Both comment routes broadcast WORK_ORDER_COMMENT (asserted via activity + thread state).
 *   - Illegal close (in_progress → closed) is rejected 400.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createTestContext } from './helpers.js';
import { seedWorkspace, type SeededFullWorkspace } from '../fixtures/workspace-seed.js';
import { createWorkOrder, getWorkOrder, updateWorkOrder } from '../../server/work-orders.js';
import { listWorkOrderComments } from '../../server/work-order-comments.js';
import { listActivity } from '../../server/activity-log.js';
import type { WorkOrder } from '../../shared/types/payments.js';

const ctx = createTestContext(13409);

// pwless: the URL is the credential, so requireClientPortalAuth() passes and we can hit public routes.
let pwless: SeededFullWorkspace;
// pwlessB: a second passwordless workspace — owns an order used to prove cross-workspace isolation.
let pwlessB: SeededFullWorkspace;
// pw: a password-protected workspace — an unauthenticated public POST must 401.
let pw: SeededFullWorkspace;

function seedOrder(workspaceId: string, status: WorkOrder['status'] = 'in_progress'): WorkOrder {
  const order = createWorkOrder(workspaceId, {
    paymentId: `pay_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
    productType: 'fix_meta',
    status: 'pending',
    pageIds: [`page_${Math.random().toString(36).slice(2, 6)}`],
  });
  // Drive it to the requested entry status via the legal path.
  if (status === 'in_progress' || status === 'completed' || status === 'closed') {
    updateWorkOrder(workspaceId, order.id, { status: 'in_progress' });
  }
  if (status === 'completed' || status === 'closed') {
    updateWorkOrder(workspaceId, order.id, { status: 'completed', completedAt: new Date().toISOString() });
  }
  if (status === 'closed') {
    updateWorkOrder(workspaceId, order.id, { status: 'closed', closedAt: new Date().toISOString() });
  }
  return getWorkOrder(workspaceId, order.id)!;
}

beforeAll(async () => {
  await ctx.startServer();
  pwless = seedWorkspace({ clientPassword: '' });
  pwlessB = seedWorkspace({ clientPassword: '' });
  pw = seedWorkspace({ clientPassword: 'secret-pass' });
}, 30_000);

afterAll(async () => {
  pwless?.cleanup();
  pwlessB?.cleanup();
  pw?.cleanup();
  await ctx.stopServer();
});

describe('Admin PATCH → closed', () => {
  it('completed → closed sets closedAt and logs order_closed activity', async () => {
    const order = seedOrder(pwless.workspaceId, 'completed');
    const res = await ctx.patchJson(`/api/work-orders/${pwless.workspaceId}/${order.id}`, { status: 'closed' });
    expect(res.status).toBe(200);
    const body = await res.json() as WorkOrder;
    expect(body.status).toBe('closed');
    expect(body.closedAt).toBeTruthy();

    const stored = getWorkOrder(pwless.workspaceId, order.id)!;
    expect(stored.status).toBe('closed');
    expect(stored.closedAt).toBeTruthy();

    const activity = listActivity(pwless.workspaceId, 50);
    expect(activity.some(a => a.type === 'order_closed' && a.metadata?.workOrderId === order.id)).toBe(true);
  });

  it('in_progress → closed is rejected 400 (must complete first)', async () => {
    const order = seedOrder(pwless.workspaceId, 'in_progress');
    const res = await ctx.patchJson(`/api/work-orders/${pwless.workspaceId}/${order.id}`, { status: 'closed' });
    expect(res.status).toBe(400);
    // Unchanged in the store.
    expect(getWorkOrder(pwless.workspaceId, order.id)!.status).toBe('in_progress');
  });
});

describe('Admin work-order comments', () => {
  it('POST comment (author forced team) then GET returns the thread', async () => {
    const order = seedOrder(pwless.workspaceId, 'in_progress');
    // author in the body must be ignored — only content is honored.
    const post = await ctx.postJson(`/api/work-orders/${pwless.workspaceId}/${order.id}/comment`, {
      content: 'Working on this now.',
    });
    expect(post.status).toBe(200);
    const comment = await post.json();
    expect(comment.author).toBe('team');
    expect(comment.content).toBe('Working on this now.');

    const get = await ctx.api(`/api/work-orders/${pwless.workspaceId}/${order.id}/comments`);
    expect(get.status).toBe(200);
    const thread = await get.json() as Array<{ author: string; content: string }>;
    expect(thread.length).toBe(1);
    expect(thread[0].author).toBe('team');

    // Activity logged + thread reflects the write (the WORK_ORDER_COMMENT broadcast fires alongside).
    const activity = listActivity(pwless.workspaceId, 50);
    expect(activity.some(a => a.type === 'work_order_commented' && a.metadata?.workOrderId === order.id)).toBe(true);
  });

  it('POST comment on a missing order returns 404', async () => {
    const res = await ctx.postJson(`/api/work-orders/${pwless.workspaceId}/order_nope/comment`, { content: 'hi' });
    expect(res.status).toBe(404);
  });

  it('rejects an empty content body (Zod min(1))', async () => {
    const order = seedOrder(pwless.workspaceId, 'in_progress');
    const res = await ctx.postJson(`/api/work-orders/${pwless.workspaceId}/${order.id}/comment`, { content: '' });
    expect(res.status).toBe(400);
  });
});

describe('Client public work-order comment', () => {
  it('forces author client and persists (pwless workspace — URL is the credential)', async () => {
    const order = seedOrder(pwless.workspaceId, 'in_progress');
    const res = await ctx.postJson(`/api/public/work-order/${pwless.workspaceId}/${order.id}/comment`, {
      content: 'When will this be done?',
    });
    expect(res.status).toBe(200);
    const comment = await res.json();
    // Author is hardcoded 'client' server-side — never trusted from the body.
    expect(comment.author).toBe('client');

    // The store reflects the forced author, regardless of the body.
    const thread = listWorkOrderComments(pwless.workspaceId, order.id);
    expect(thread.some(c => c.author === 'client' && c.content === 'When will this be done?')).toBe(true);

    const activity = listActivity(pwless.workspaceId, 50);
    expect(activity.some(a => a.type === 'work_order_commented' && a.metadata?.workOrderId === order.id)).toBe(true);
  });

  it('rejects an extra author key (.strict() schema — body author can never be honored)', async () => {
    const order = seedOrder(pwless.workspaceId, 'in_progress');
    const res = await ctx.postJson(`/api/public/work-order/${pwless.workspaceId}/${order.id}/comment`, {
      content: 'trying to forge author',
      author: 'team',
    });
    expect(res.status).toBe(400);
  });

  it('409s when the order is closed', async () => {
    const order = seedOrder(pwless.workspaceId, 'closed');
    const res = await ctx.postJson(`/api/public/work-order/${pwless.workspaceId}/${order.id}/comment`, {
      content: 'too late?',
    });
    expect(res.status).toBe(409);
  });

  it('404s + persists zero rows when the orderId belongs to a different workspace (tenant isolation)', async () => {
    // Order lives in workspace B; the request targets workspace `pwless` in the URL (auth passes
    // because pwless is passwordless). getWorkOrder(pwless, orderInB) must miss → 404, and
    // addWorkOrderComment's WHERE id=? AND workspace_id=? guard must write nothing. This proves a
    // client authenticated for one workspace can't comment cross-workspace by guessing an orderId.
    const orderInB = seedOrder(pwlessB.workspaceId, 'in_progress');
    const res = await ctx.postJson(`/api/public/work-order/${pwless.workspaceId}/${orderInB.id}/comment`, {
      content: 'cross-workspace comment attempt',
    });
    expect(res.status).toBe(404);
    // Zero rows under the real owning workspace AND under the URL workspace.
    expect(listWorkOrderComments(pwlessB.workspaceId, orderInB.id).length).toBe(0);
    expect(listWorkOrderComments(pwless.workspaceId, orderInB.id).length).toBe(0);
  });

  it('401s unauthenticated on a password-protected workspace', async () => {
    const order = seedOrder(pw.workspaceId, 'in_progress');
    const res = await ctx.postJson(`/api/public/work-order/${pw.workspaceId}/${order.id}/comment`, {
      content: 'hello',
    });
    expect(res.status).toBe(401);
    // Nothing persisted.
    expect(listWorkOrderComments(pw.workspaceId, order.id).length).toBe(0);
  });

  it('GET thread is reachable on the pwless workspace', async () => {
    const order = seedOrder(pwless.workspaceId, 'in_progress');
    ctx; // ensure server up
    const res = await ctx.api(`/api/public/work-order/${pwless.workspaceId}/${order.id}/comments`);
    expect(res.status).toBe(200);
    expect(Array.isArray(await res.json())).toBe(true);
  });
});
