/**
 * R3b — Apply to Website (DARK). Verifies that the SEPARATE client "Apply to Website" step reuses
 * the PROVEN legacy `/api/public/approvals/:workspaceId/:batchId/apply` route (no new apply logic),
 * and that — behind APPROVAL_FAMILY_FLAG — the unified deliverable MIRROR flips to `applied` after
 * the legacy apply. Mirror status is asserted via `getDeliverable` DIRECTLY, never the public client
 * list (which filters `applied` out).
 *
 * The faithful flow exercised here: send (mirror born awaiting_client) → client approves via the
 * shared `respondToDeliverable` (mirror → approved, legacy items → approved/held) → client applies
 * via the legacy /apply route (Webflow write + mirror flip to applied). This matches production: the
 * mirror is `approved` (not `awaiting_client`) by the time apply runs, so `approved → applied` is the
 * legal transition.
 *
 * In-process harness (createApp + vi.mock) — the proven pattern for apply-route tests
 * (seo-apply-resolves-recommendations.test.ts): the spawned-server helper cannot apply `vi.mock`
 * for the Webflow boundary, and this test must (a) mock Webflow, (b) toggle the flag in-process,
 * (c) drive the mirror, and (d) read `getDeliverable` directly. Uses an ephemeral port (listen(0)),
 * so no fixed-port allocation is needed (the 13201–13899 range is for the spawned-server helper).
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
import { mirrorApprovalBatchToDeliverable, APPROVAL_FAMILY_FLAG } from '../../server/domains/inbox/approval-batch-dual-write.js';
import { markDeliverableApplied, respondToDeliverable } from '../../server/domains/inbox/send-to-client.js';
import { setFlagOverride } from '../../server/feature-flags.js';
import type { ClientDeliverable } from '../../shared/types/client-deliverable.js';

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
  return fetch(`${baseUrl}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
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
  setFlagOverride(APPROVAL_FAMILY_FLAG, null);
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
  setFlagOverride(APPROVAL_FAMILY_FLAG, null);
  ws.cleanup();
});

describe('R3b — Apply to Website (legacy route reuse + mirror flip)', () => {
  it('applies an approved static seoTitle deliverable and flips the mirror to applied', async () => {
    setFlagOverride(APPROVAL_FAMILY_FLAG, true);
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

    const res = await postJson(`/api/public/approvals/${ws.workspaceId}/${batch.id}/apply`, {});
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

  it('does not apply a subset-held item; only the approved item is applied; mirror still flips', async () => {
    setFlagOverride(APPROVAL_FAMILY_FLAG, true);
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

    const res = await postJson(`/api/public/approvals/${ws.workspaceId}/${batch.id}/apply`, {});
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

    // Mirror still flips to applied (gated on appliedIds.length > 0, which is 1 here).
    expect(getDeliverable(mirror.id)?.status).toBe('applied');
  });

  it('rejects a schema_item batch at the route gate (400) and does not flip the mirror', async () => {
    setFlagOverride(APPROVAL_FAMILY_FLAG, true);
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

    const res = await postJson(`/api/public/approvals/${ws.workspaceId}/${batch.id}/apply`, {});
    expect(res.status).toBe(400);

    // No apply happened → mirror unchanged (stays approved, never applied).
    expect(getDeliverable(mirror.id)?.status).toBe('approved');
  });

  it('flag OFF: apply response is byte-identical and the mirror is not flipped', async () => {
    setFlagOverride(APPROVAL_FAMILY_FLAG, true);
    const batch = createBatch(ws.workspaceId, ws.webflowSiteId, 'SEO Changes', [{
      pageId: 'page-flagoff-1',
      pageTitle: 'Home',
      pageSlug: '/home',
      field: 'seoTitle',
      currentValue: 'Old',
      proposedValue: 'New',
    }]);
    const mirror = mirrorApprovalBatchToDeliverable(ws.workspaceId, batch)!;
    await respondToDeliverable(ws.workspaceId, mirror.id, { decision: 'approved' });
    expect(getDeliverable(mirror.id)?.status).toBe('approved');

    // Turn the flag OFF — the apply route must not touch the mirror.
    setFlagOverride(APPROVAL_FAMILY_FLAG, false);

    const res = await postJson(`/api/public/approvals/${ws.workspaceId}/${batch.id}/apply`, {});
    expect(res.status).toBe(200);
    const body = await res.json() as { applied: number; failed: number; results: unknown[] };
    expect(body.applied).toBe(1);
    expect(body.failed).toBe(0);
    expect(body.results).toHaveLength(1);

    // Mirror NOT flipped (the gate is off) — stays approved, never applied.
    expect(getDeliverable(mirror.id)?.status).toBe('approved');
  });

  it('markDeliverableApplied is idempotent (a second call does not throw)', async () => {
    setFlagOverride(APPROVAL_FAMILY_FLAG, true);
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

    await postJson(`/api/public/approvals/${ws.workspaceId}/${batch.id}/apply`, {});
    expect(getDeliverable(mirror.id)?.status).toBe('applied');

    // Second call directly — must short-circuit (already applied), not throw InvalidTransitionError.
    const again = markDeliverableApplied(ws.workspaceId, mirror.id);
    expect(again?.status).toBe('applied');
  });
});
