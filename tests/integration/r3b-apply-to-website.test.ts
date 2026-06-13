/**
 * R3b — Apply to Website (DARK). Verifies that the SEPARATE client "Apply to Website" step calls
 * the canonical `/api/public/deliverables/:workspaceId/:id/apply` route, which delegates to the
 * proven approval-batch apply service (no new Webflow apply logic), and that the unified deliverable
 * mirror flips to `applied` after apply. Mirror status is asserted via `getDeliverable` DIRECTLY,
 * never the public client list (which filters `applied` out).
 *
 * The faithful flow exercised here: send (mirror born awaiting_client) → client approves via the
 * shared `respondToDeliverable` (mirror → approved, legacy items → approved/held) → client applies
 * via the deliverables /apply route (Webflow write + mirror flip to applied). This matches production: the
 * mirror is `approved` (not `awaiting_client`) by the time apply runs, so `approved → applied` is the
 * legal transition.
 *
 * In-process harness (createApp + vi.mock) — the proven pattern for apply-route tests
 * (seo-apply-resolves-recommendations.test.ts): the spawned-server helper cannot apply `vi.mock`
 * for the Webflow boundary, and this test must (a) mock Webflow, (b) drive the mirror, and
 * (c) read `getDeliverable` directly. Uses an ephemeral port (listen(0)),
 */
import http from 'http';
import { AddressInfo } from 'net';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const webflowState = vi.hoisted(() => ({
  seoResult: { success: true } as { success: boolean; error?: string },
  seoPageIds: [] as string[],
}));

vi.mock('../../server/broadcast.js', () => ({
  setBroadcast: vi.fn(),
  broadcast: vi.fn(),
  broadcastToWorkspace: vi.fn(),
}));

vi.mock('../../server/webflow.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../server/webflow.js')>();
  return {
    ...actual,
    updatePageSeo: vi.fn(async (pageId: string) => {
      webflowState.seoPageIds.push(pageId);
      return webflowState.seoResult;
    }),
    updateCollectionItem: vi.fn(async () => ({ success: true })),
    publishCollectionItems: vi.fn(async () => ({ success: true })),
  };
});

import { seedWorkspace } from '../fixtures/workspace-seed.js';
import type { SeededFullWorkspace } from '../fixtures/workspace-seed.js';
import { createBatch, getBatch } from '../../server/approvals.js';
import { getDeliverable } from '../../server/client-deliverables.js';
import { mirrorApprovalBatchToDeliverable } from '../../server/domains/inbox/approval-batch-dual-write.js';
import { markDeliverableApplied, respondToDeliverable } from '../../server/domains/inbox/send-to-client.js';
import type { ClientDeliverable } from '../../shared/types/client-deliverable.js';
import { withPublicTestAuth } from './public-auth-test-helpers.js';

let server: http.Server | null = null;
let baseUrl = '';

async function startTestServer(): Promise<void> {
  delete process.env.APP_PASSWORD;
  const { createApp } = await import('../../server/app.js');
  const app = createApp();
  server = http.createServer(app);
  await new Promise<void>((resolve) => server!.listen(0, '127.0.0.1', resolve));
  const { port } = server!.address() as AddressInfo;
  baseUrl = `http://127.0.0.1:${port}`;
}

async function postJson(path: string, body: unknown): Promise<Response> {
  return fetch(`${baseUrl}${path}`, withPublicTestAuth(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  }));
}

/** Resolve a mirror item's id by its legacy page id (for building flaggedItems subsets). */
function mirrorItemIdByPage(mirror: ClientDeliverable, pageId: string): string {
  const fresh = getDeliverable(mirror.id)!;
  const found = (fresh.items ?? []).find(
    (i) => (i.itemPayload as { pageId?: unknown } | null)?.pageId === pageId || i.targetRef === pageId,
  );
  if (!found) throw new Error(`no mirror item for page ${pageId}`);
  return found.id;
}

let ws: SeededFullWorkspace;

beforeAll(async () => {
  await startTestServer();
}, 25_000);

afterAll(async () => {
  if (server) await new Promise<void>((resolve) => server!.close(() => resolve()));
});

beforeEach(() => {
  // Passwordless workspace → the workspace id is the credential, so requireClientPortalAuth passes
  // through (no client session cookie needed for the public apply route in-test).
  ws = seedWorkspace({ clientPassword: '' });
  webflowState.seoResult = { success: true };
  webflowState.seoPageIds = [];
});

afterEach(() => {
  ws.cleanup();
});

describe('R3b — Apply to Website (canonical deliverable apply + mirror flip)', () => {
  it('applies an approved static seoTitle deliverable and flips the mirror to applied', async () => {
    const batch = createBatch(ws.workspaceId, ws.webflowSiteId, 'SEO Changes', [{
      pageId: 'page-static-1',
      pageTitle: 'Home',
      pageSlug: '/home',
      field: 'seoTitle',
      currentValue: 'Old title',
      proposedValue: 'New title',
    }]);
    const mirror = mirrorApprovalBatchToDeliverable(ws.workspaceId, batch)!;
    expect(mirror.type).toBe('seo_edit');

    // Client approves (no flags) — mirror → approved, legacy item → approved.
    await respondToDeliverable(ws.workspaceId, mirror.id, { decision: 'approved' });
    expect(getDeliverable(mirror.id)?.status).toBe('approved');

    const res = await postJson(`/api/public/deliverables/${ws.workspaceId}/${mirror.id}/apply`, {});
    expect(res.status).toBe(200);
    const body = await res.json() as { applied: number };
    expect(body.applied).toBeGreaterThanOrEqual(1);

    // Legacy items applied.
    expect(getBatch(ws.workspaceId, batch.id)?.items[0].status).toBe('applied');

    // Mirror flipped to applied (assert DIRECTLY, NOT via the public client list).
    const appliedMirror = getDeliverable(mirror.id);
    expect(appliedMirror?.status).toBe('applied');
    expect(appliedMirror?.appliedAt).toBeTruthy();
  });

  it('keeps the legacy approval apply URL as deprecated compatibility', async () => {
    const batch = createBatch(ws.workspaceId, ws.webflowSiteId, 'SEO Changes', [{
      pageId: 'page-legacy-compat',
      pageTitle: 'Home',
      pageSlug: '/home',
      field: 'seoTitle',
      currentValue: 'Old title',
      proposedValue: 'New title',
    }]);
    const mirror = mirrorApprovalBatchToDeliverable(ws.workspaceId, batch)!;

    await respondToDeliverable(ws.workspaceId, mirror.id, { decision: 'approved' });

    const res = await postJson(`/api/public/approvals/${ws.workspaceId}/${batch.id}/apply`, {});
    expect(res.status).toBe(200);
    expect(res.headers.get('x-deprecated-route')).toBe('/api/public/deliverables/:workspaceId/:id/apply');
    const body = await res.json() as { applied: number };
    expect(body.applied).toBeGreaterThanOrEqual(1);
    expect(getDeliverable(mirror.id)?.status).toBe('applied');
  });

  it('does not apply a subset-held item; only the approved item is applied; mirror still flips', async () => {
    const batch = createBatch(ws.workspaceId, ws.webflowSiteId, 'SEO Changes', [
      { pageId: 'page-A', pageTitle: 'A', pageSlug: '/a', field: 'seoTitle', currentValue: 'oa', proposedValue: 'na' },
      { pageId: 'page-B', pageTitle: 'B', pageSlug: '/b', field: 'seoDescription', currentValue: 'ob', proposedValue: 'nb' },
    ]);
    const mirror = mirrorApprovalBatchToDeliverable(ws.workspaceId, batch)!;

    // Client approves but FLAGS item B (held) — mirror → approved; legacy A → approved, B → rejected.
    const heldItemId = mirrorItemIdByPage(mirror, 'page-B');
    await respondToDeliverable(ws.workspaceId, mirror.id, {
      decision: 'approved',
      flaggedItems: [{ itemId: heldItemId, note: 'hold this one' }],
    });

    const afterApprove = getBatch(ws.workspaceId, batch.id)!;
    const itemA = afterApprove.items.find((i) => i.pageId === 'page-A')!;
    const itemB = afterApprove.items.find((i) => i.pageId === 'page-B')!;
    expect(itemA.status).toBe('approved');
    expect(itemB.status).toBe('rejected');

    const res = await postJson(`/api/public/deliverables/${ws.workspaceId}/${mirror.id}/apply`, {});
    expect(res.status).toBe(200);
    const body = await res.json() as { applied: number };
    expect(body.applied).toBe(1);

    // Only item A applied; B stays rejected (held).
    const afterApply = getBatch(ws.workspaceId, batch.id)!;
    expect(afterApply.items.find((i) => i.pageId === 'page-A')!.status).toBe('applied');
    expect(afterApply.items.find((i) => i.pageId === 'page-B')!.status).toBe('rejected');

    // Webflow called for A's page, NOT for B's page.
    expect(webflowState.seoPageIds).toContain('page-A');
    expect(webflowState.seoPageIds).not.toContain('page-B');

    // Mirror still flips to applied: the held item B is `rejected` (not in the `approved` set), so
    // the FULLY-successful gate holds — failed === 0 AND all 1 `approved` item (A) was applied.
    expect(getDeliverable(mirror.id)?.status).toBe('applied');
  });

  it('rejects a schema_item batch at the route gate (400) and does not flip the mirror', async () => {
    const batch = createBatch(ws.workspaceId, ws.webflowSiteId, 'Schema Review', [{
      pageId: 'page-schema-1',
      pageTitle: 'Schema Page',
      pageSlug: '/schema',
      field: 'schemaJson',
      currentValue: '{}',
      proposedValue: '{"@type":"FAQPage"}',
    }]);
    const mirror = mirrorApprovalBatchToDeliverable(ws.workspaceId, batch)!;
    expect(mirror.type).toBe('schema_item');

    await respondToDeliverable(ws.workspaceId, mirror.id, { decision: 'approved' });

    const res = await postJson(`/api/public/deliverables/${ws.workspaceId}/${mirror.id}/apply`, {});
    expect(res.status).toBe(400);

    // No apply happened → mirror unchanged (stays approved, never applied).
    expect(getDeliverable(mirror.id)?.status).toBe('approved');
  });

  it('total Webflow write failure: applied:0/failed:1 (HTTP 200), item NOT applied, mirror stays approved (flip skipped)', async () => {
    // FM-2 external-API-error test: mock the Webflow SEO write to FAIL at runtime. The apply
    // route catches the failure per-item and falls through to res.json with applied:0/failed:N — a
    // success-shaped HTTP 200 envelope, NOT a 4xx. The mirror flip must therefore see failed > 0
    // and skip the transition, leaving the mirror `approved` so the client can retry.
    webflowState.seoResult = { success: false, error: 'Webflow API write failed' };

    const batch = createBatch(ws.workspaceId, ws.webflowSiteId, 'SEO Changes', [{
      pageId: 'page-fail-1',
      pageTitle: 'Home',
      pageSlug: '/home',
      field: 'seoTitle',
      currentValue: 'Old',
      proposedValue: 'New',
    }]);
    const mirror = mirrorApprovalBatchToDeliverable(ws.workspaceId, batch)!;
    expect(mirror.type).toBe('seo_edit');

    await respondToDeliverable(ws.workspaceId, mirror.id, { decision: 'approved' });
    expect(getDeliverable(mirror.id)?.status).toBe('approved');

    const res = await postJson(`/api/public/deliverables/${ws.workspaceId}/${mirror.id}/apply`, {});
    // Total runtime write failure is still HTTP 200 with a failed count (not a 4xx).
    expect(res.status).toBe(200);
    const body = await res.json() as { applied: number; failed: number; results: unknown[] };
    expect(body.applied).toBe(0);
    expect(body.failed).toBe(1);
    expect(body.results).toHaveLength(1);

    // markBatchApplied was NOT invoked (no succeeded ids) → the legacy item stays `approved`/retryable.
    expect(getBatch(ws.workspaceId, batch.id)?.items[0].status).toBe('approved');

    // The mirror flip was SKIPPED (failed > 0) → mirror stays `approved` (assert DIRECTLY, NOT via
    // the public client list) so it remains in "Ready to publish" and the client can retry.
    const afterApply = getDeliverable(mirror.id);
    expect(afterApply?.status).toBe('approved');
    expect(afterApply?.appliedAt).toBeFalsy();
  });

  it('markDeliverableApplied is idempotent (a second call does not throw)', async () => {
    const batch = createBatch(ws.workspaceId, ws.webflowSiteId, 'SEO Changes', [{
      pageId: 'page-idem-1',
      pageTitle: 'Home',
      pageSlug: '/home',
      field: 'seoTitle',
      currentValue: 'Old',
      proposedValue: 'New',
    }]);
    const mirror = mirrorApprovalBatchToDeliverable(ws.workspaceId, batch)!;
    await respondToDeliverable(ws.workspaceId, mirror.id, { decision: 'approved' });

    await postJson(`/api/public/deliverables/${ws.workspaceId}/${mirror.id}/apply`, {});
    expect(getDeliverable(mirror.id)?.status).toBe('applied');

    // Second call directly — must short-circuit (already applied), not throw InvalidTransitionError.
    const again = markDeliverableApplied(ws.workspaceId, mirror.id);
    expect(again?.status).toBe('applied');
  });
});
