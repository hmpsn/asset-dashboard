/**
 * Integration tests for the R5 work-order TRACK lane in GET /api/public/deliverables/:workspaceId.
 *
 * R5 makes `kind:'order'` deliverables (work orders) client-facing as a READ-ONLY track lane: the
 * client FOLLOWS order progress, they do NOT decide on it. The server read (unified-inbox-read.ts)
 * admits order rows in the canonical ORDER-lifecycle statuses `ordered | in_progress | completed`
 * — ONLY for `kind:'order'`. Asserts:
 *   1. `kind:'order'` rows in `ordered`/`in_progress`/`completed` are INCLUDED.
 *   2. A `cancelled` order is EXCLUDED.
 *   3. CROSS-LEAK GUARD: a NON-order row (type:'seo_edit', kind:'batch') in `in_progress`/`ordered`
 *      is EXCLUDED — proving the admission is kind-scoped, not a blanket status widening.
 *   4. Existing review-status rows (awaiting_client) are still INCLUDED (no regression).
 *   5. The route stays client-portal gated (a password-protected workspace 401s unauthenticated).
 *
 * The endpoint is independent of the unified-inbox flag (the flag gates whether the CLIENT fetches
 * it; the read itself is inert until cutover). It is exercised here with seeded rows.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createTestContext } from './helpers.js';
import { seedWorkspace } from '../fixtures/workspace-seed.js';
import type { SeededFullWorkspace } from '../fixtures/workspace-seed.js';
import { upsertDeliverable } from '../../server/client-deliverables.js';
import type { ClientDeliverable } from '../../shared/types/client-deliverable.js';

// port-ok: 13878 (verified free; 13877 is taken by projected-review-respond-routes.test.ts).
const ctx = createTestContext(13878);

let pwless: SeededFullWorkspace;
let pw: SeededFullWorkspace;

function listUrl(wsId: string): string {
  return `/api/public/deliverables/${wsId}`;
}

/** Seed a work-order (kind:'order') deliverable in the given canonical track status. */
function seedOrder(wsId: string, status: ClientDeliverable['status'], title: string): ClientDeliverable {
  return upsertDeliverable({
    workspaceId: wsId,
    type: 'work_order',
    kind: 'order',
    status,
    title,
    summary: '3 pages',
    payload: { family: 'work_order', workOrderStatus: 'in_progress', pageIds: ['p1', 'p2', 'p3'] },
    sourceRef: `work_order:track-${status}-${title}`,
    sentAt: new Date().toISOString(),
  });
}

beforeAll(async () => {
  await ctx.startServer();
  // Passwordless workspace: the global app.ts client-session gate lets reads through, so the
  // route's requireClientPortalAuth() passes (the URL is the credential) and we can read the list.
  pwless = seedWorkspace({ clientPassword: '' });
  // Password-protected workspace: an unauthenticated read is 401 by the global gate + route guard.
  pw = seedWorkspace({ clientPassword: 'secret-pass' });
}, 25_000);

afterAll(async () => {
  pwless?.cleanup();
  pw?.cleanup();
  await ctx.stopServer();
});

describe('GET /api/public/deliverables/:workspaceId — work-order TRACK lane (R5)', () => {
  it('INCLUDES kind:order rows in ordered/in_progress/completed and EXCLUDES cancelled', async () => {
    const ordered = seedOrder(pwless.workspaceId, 'ordered', 'Order: fix meta (ordered)');
    const inProgress = seedOrder(pwless.workspaceId, 'in_progress', 'Order: fix meta (in progress)');
    const completed = seedOrder(pwless.workspaceId, 'completed', 'Order: schema page (completed)');
    const cancelled = seedOrder(pwless.workspaceId, 'cancelled', 'Order: cancelled (hidden)');

    const res = await ctx.api(listUrl(pwless.workspaceId));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { deliverables: ClientDeliverable[] };
    const ids = body.deliverables.map((d) => d.id);

    // The three canonical track statuses are surfaced to the client.
    expect(ids).toContain(ordered.id);
    expect(ids).toContain(inProgress.id);
    expect(ids).toContain(completed.id);

    // The returned order rows carry kind:'order' so the client renders the track lane (no verbs).
    const retInProgress = body.deliverables.find((d) => d.id === inProgress.id)!;
    expect(retInProgress.kind).toBe('order');
    expect(retInProgress.status).toBe('in_progress');

    // A cancelled order is a terminal internal state — NOT a track-lane item.
    expect(ids).not.toContain(cancelled.id);
    const titles = body.deliverables.map((d) => d.title);
    expect(titles).not.toContain('Order: cancelled (hidden)');
  });

  it('CROSS-LEAK GUARD: a NON-order row (seo_edit/batch) in in_progress/ordered is EXCLUDED', async () => {
    // The order-lifecycle statuses are admitted ONLY for kind:'order'. A batch row that somehow holds
    // an order-lifecycle status must NOT leak into the client list — proving the predicate is
    // kind-scoped, not a blanket status widening.
    const batchInProgress = upsertDeliverable({
      workspaceId: pwless.workspaceId,
      type: 'seo_edit',
      kind: 'batch',
      status: 'in_progress',
      title: 'SEO edit in_progress (must NOT leak)',
      payload: { family: 'approval_batch' },
      sourceRef: 'seo_edit:cross-leak-in-progress',
      sentAt: new Date().toISOString(),
    });
    const batchOrdered = upsertDeliverable({
      workspaceId: pwless.workspaceId,
      type: 'seo_edit',
      kind: 'batch',
      status: 'ordered',
      title: 'SEO edit ordered (must NOT leak)',
      payload: { family: 'approval_batch' },
      sourceRef: 'seo_edit:cross-leak-ordered',
      sentAt: new Date().toISOString(),
    });

    const res = await ctx.api(listUrl(pwless.workspaceId));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { deliverables: ClientDeliverable[] };
    const ids = body.deliverables.map((d) => d.id);

    expect(ids).not.toContain(batchInProgress.id);
    expect(ids).not.toContain(batchOrdered.id);
  });

  it('still INCLUDES existing review-status rows (no regression from the kind-aware predicate)', async () => {
    const awaiting = upsertDeliverable({
      workspaceId: pwless.workspaceId,
      type: 'redirect',
      kind: 'decision',
      status: 'awaiting_client',
      title: 'Redirect plan (still client-facing)',
      summary: 'Proposed redirects',
      payload: { family: 'redirect' },
      sourceRef: 'redirect:r5-regression-check',
      sentAt: new Date().toISOString(),
    });

    const res = await ctx.api(listUrl(pwless.workspaceId));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { deliverables: ClientDeliverable[] };
    const ids = body.deliverables.map((d) => d.id);

    expect(ids).toContain(awaiting.id);
  });
});

describe('GET /api/public/deliverables/:workspaceId — auth (R5 track lane stays gated)', () => {
  it('401s unauthenticated on a password-protected workspace', async () => {
    const res = await ctx.api(listUrl(pw.workspaceId));
    expect(res.status).toBe(401);
  });
});
