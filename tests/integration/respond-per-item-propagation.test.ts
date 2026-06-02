/**
 * R3 — per-item subset respond propagation. Extends the R2 whole-batch linchpin: a unified-inbox
 * `respondToDeliverable({ decision:'approved', flaggedItemIds:[…] })` must approve the UNFLAGGED
 * legacy approval items and REJECT (hold) the flagged ones ("implement N of M"), while the
 * deliverable mirror stays `approved`. Back-compat: `approved` with no flaggedItemIds approves ALL
 * pending (the R2 behavior — unchanged).
 *
 * Per-item flag/subset is APPROVAL-FAMILY ONLY (the approval_batch family stores typed item rows
 * with `itemPayload.legacyItemId` = the legacy approval_item.id). The client_action family has no
 * typed items, so flaggedItemIds is a no-op there (asserted: whole-action approve still works).
 *
 * Email is mocked so the suppression/no-double-notify contract stays deterministic (same pattern
 * as respond-propagation.test.ts).
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';

const { mockNotifyTeamActionApproved, mockNotifyTeamChangesRequested, mockNotifyApprovalReady } =
  vi.hoisted(() => ({
    mockNotifyTeamActionApproved: vi.fn(),
    mockNotifyTeamChangesRequested: vi.fn(),
    mockNotifyApprovalReady: vi.fn(),
  }));
vi.mock('../../server/email.js', () => ({
  isEmailConfigured: () => true,
  notifyTeamActionApproved: mockNotifyTeamActionApproved,
  notifyTeamChangesRequested: mockNotifyTeamChangesRequested,
  notifyApprovalReady: mockNotifyApprovalReady,
}));

import db from '../../server/db/index.js';
import { setBroadcast } from '../../server/broadcast.js';
import '../../server/domains/inbox/deliverable-adapters/index.js';
import { getAdapter } from '../../server/domains/inbox/deliverable-adapters/index.js';
import { respondToDeliverable } from '../../server/domains/inbox/send-to-client.js';
import { upsertDeliverable, getDeliverable } from '../../server/client-deliverables.js';
import { createBatch, getBatch } from '../../server/approvals.js';
import { createClientAction, getClientAction } from '../../server/client-actions.js';
import { createWorkspace, deleteWorkspace } from '../../server/workspaces.js';
import type { ClientActionPayload } from '../../shared/types/client-actions.js';
import type { ClientDeliverable, DeliverableType } from '../../shared/types/client-deliverable.js';

const SITE = 'site-r3-per-item';
const ws = createWorkspace('r3-per-item-propagation-test', SITE);
const WS = ws.id;

beforeAll(() => {
  setBroadcast(vi.fn(), vi.fn());
});

afterAll(() => {
  db.prepare('DELETE FROM approval_batches WHERE workspace_id = ?').run(WS);
  db.prepare('DELETE FROM client_actions WHERE workspace_id = ?').run(WS);
  db.prepare('DELETE FROM client_deliverable WHERE workspace_id = ?').run(WS);
  deleteWorkspace(WS);
});

beforeEach(() => {
  mockNotifyTeamActionApproved.mockClear();
  mockNotifyTeamChangesRequested.mockClear();
  mockNotifyApprovalReady.mockClear();
  db.prepare('DELETE FROM approval_batches WHERE workspace_id = ?').run(WS);
  db.prepare('DELETE FROM client_actions WHERE workspace_id = ?').run(WS);
  db.prepare('DELETE FROM client_deliverable WHERE workspace_id = ?').run(WS);
});

/** Mirror a source artifact into a client_deliverable via the registered adapter (dual-write path). */
function mirror(type: DeliverableType, input: unknown): ClientDeliverable {
  const adapter = getAdapter(type);
  const built = adapter.buildPayload(input);
  const nowIso = new Date().toISOString();
  return upsertDeliverable({
    workspaceId: WS,
    type,
    kind: built.kind,
    status: 'awaiting_client',
    title: built.title,
    summary: built.summary ?? null,
    payload: built.payload,
    externalRef: built.externalRef ?? null,
    parentDeliverableId: built.parentDeliverableId ?? null,
    sentAt: nowIso,
    generatedAt: nowIso,
    source: 'r3-test-mirror',
    sourceRef: adapter.sourceRef(input),
    items: built.items,
  });
}

/**
 * Build a deliverable item id → legacy approval item id map from the mirrored deliverable.
 * `itemPayload.legacyItemId` is the legacy approval_item.id stashed by batchItemsToDeliverableItems.
 */
function legacyIdByDeliverableItemId(d: ClientDeliverable): Record<string, string> {
  const map: Record<string, string> = {};
  for (const item of d.items ?? []) {
    const legacy = (item.itemPayload as { legacyItemId?: unknown } | null)?.legacyItemId;
    if (typeof legacy === 'string') map[item.id] = legacy;
  }
  return map;
}

describe('R3 per-item subset propagation — approval_batch family', () => {
  it('approve with flaggedItemIds=[one item] → unflagged approved, flagged rejected (mirror approved)', async () => {
    const batch = createBatch(WS, SITE, 'SEO Changes', [
      { pageId: 'p1', pageTitle: 'P1', pageSlug: 'p1', field: 'seoTitle', currentValue: 'a', proposedValue: 'b' },
      { pageId: 'p2', pageTitle: 'P2', pageSlug: 'p2', field: 'seoTitle', currentValue: 'c', proposedValue: 'd' },
      { pageId: 'p3', pageTitle: 'P3', pageSlug: 'p3', field: 'seoTitle', currentValue: 'e', proposedValue: 'f' },
    ]);
    const deliverable = mirror('seo_edit', batch);
    const idMap = legacyIdByDeliverableItemId(deliverable);

    // Flag the deliverable item that maps to legacy item p2 (the second).
    const flaggedDeliverableItemId = (deliverable.items ?? []).find(
      (i) => idMap[i.id] === batch.items[1].id,
    )!.id;

    const updated = await respondToDeliverable(WS, deliverable.id, {
      decision: 'approved',
      flaggedItemIds: [flaggedDeliverableItemId],
    });

    // 1. THE LINCHPIN: the real source items — unflagged approved, flagged rejected.
    const sourceAfter = getBatch(WS, batch.id)!;
    const byId = new Map(sourceAfter.items.map((i) => [i.id, i]));
    expect(byId.get(batch.items[0].id)!.status).toBe('approved');
    expect(byId.get(batch.items[1].id)!.status).toBe('rejected'); // flagged → held
    expect(byId.get(batch.items[2].id)!.status).toBe('approved');
    // Mixed approved+rejected → batch status `partial`.
    expect(sourceAfter.status).toBe('partial');
    // 2. the deliverable mirror is still `approved` (client approved; a subset held).
    expect(updated.status).toBe('approved');
    expect(getDeliverable(deliverable.id)!.status).toBe('approved');
    // 3. team-notify fired exactly once (source path owns it; deliverable-level suppressed).
    expect(mockNotifyTeamActionApproved).toHaveBeenCalledTimes(1);
    expect(mockNotifyTeamChangesRequested).not.toHaveBeenCalled();
  });

  it('approve with flaggedItemIds=[multiple] holds each flagged item, approves the rest', async () => {
    const batch = createBatch(WS, SITE, 'SEO Changes', [
      { pageId: 'p1', pageTitle: 'P1', pageSlug: 'p1', field: 'seoTitle', currentValue: 'a', proposedValue: 'b' },
      { pageId: 'p2', pageTitle: 'P2', pageSlug: 'p2', field: 'seoTitle', currentValue: 'c', proposedValue: 'd' },
      { pageId: 'p3', pageTitle: 'P3', pageSlug: 'p3', field: 'seoTitle', currentValue: 'e', proposedValue: 'f' },
    ]);
    const deliverable = mirror('seo_edit', batch);
    const idMap = legacyIdByDeliverableItemId(deliverable);
    const flag1 = (deliverable.items ?? []).find((i) => idMap[i.id] === batch.items[0].id)!.id;
    const flag3 = (deliverable.items ?? []).find((i) => idMap[i.id] === batch.items[2].id)!.id;

    await respondToDeliverable(WS, deliverable.id, {
      decision: 'approved',
      flaggedItemIds: [flag1, flag3],
    });

    const sourceAfter = getBatch(WS, batch.id)!;
    const byId = new Map(sourceAfter.items.map((i) => [i.id, i]));
    expect(byId.get(batch.items[0].id)!.status).toBe('rejected');
    expect(byId.get(batch.items[1].id)!.status).toBe('approved');
    expect(byId.get(batch.items[2].id)!.status).toBe('rejected');
    expect(sourceAfter.status).toBe('partial');
  });

  it('BACK-COMPAT: approve with NO flaggedItemIds approves ALL pending (R2 behavior)', async () => {
    const batch = createBatch(WS, SITE, 'SEO Changes', [
      { pageId: 'p1', pageTitle: 'P1', pageSlug: 'p1', field: 'seoTitle', currentValue: 'a', proposedValue: 'b' },
      { pageId: 'p2', pageTitle: 'P2', pageSlug: 'p2', field: 'seoTitle', currentValue: 'c', proposedValue: 'd' },
    ]);
    const deliverable = mirror('seo_edit', batch);

    await respondToDeliverable(WS, deliverable.id, { decision: 'approved' });

    const sourceAfter = getBatch(WS, batch.id)!;
    expect(sourceAfter.status).toBe('approved');
    expect(sourceAfter.items.every((i) => i.status === 'approved')).toBe(true); // every-ok: length>0 (2 items seeded)
  });

  it('BACK-COMPAT: approve with empty flaggedItemIds[] approves ALL pending', async () => {
    const batch = createBatch(WS, SITE, 'SEO Changes', [
      { pageId: 'p1', pageTitle: 'P1', pageSlug: 'p1', field: 'seoTitle', currentValue: 'a', proposedValue: 'b' },
      { pageId: 'p2', pageTitle: 'P2', pageSlug: 'p2', field: 'seoTitle', currentValue: 'c', proposedValue: 'd' },
    ]);
    const deliverable = mirror('seo_edit', batch);

    await respondToDeliverable(WS, deliverable.id, { decision: 'approved', flaggedItemIds: [] });

    const sourceAfter = getBatch(WS, batch.id)!;
    expect(sourceAfter.status).toBe('approved');
    expect(sourceAfter.items.every((i) => i.status === 'approved')).toBe(true); // every-ok: length>0 (2 items seeded)
  });

  it('changes_requested ignores flaggedItemIds — whole batch rejected', async () => {
    const batch = createBatch(WS, SITE, 'SEO Changes', [
      { pageId: 'p1', pageTitle: 'P1', pageSlug: 'p1', field: 'seoTitle', currentValue: 'a', proposedValue: 'b' },
      { pageId: 'p2', pageTitle: 'P2', pageSlug: 'p2', field: 'seoTitle', currentValue: 'c', proposedValue: 'd' },
    ]);
    const deliverable = mirror('seo_edit', batch);
    const flaggedId = (deliverable.items ?? [])[0].id;

    await respondToDeliverable(WS, deliverable.id, {
      decision: 'changes_requested',
      note: 'redo all',
      flaggedItemIds: [flaggedId],
    });

    const sourceAfter = getBatch(WS, batch.id)!;
    expect(sourceAfter.status).toBe('rejected');
    expect(sourceAfter.items.every((i) => i.status === 'rejected')).toBe(true); // every-ok: length>0 (2 items seeded)
  });
});

describe('R3 per-item — client_action family ignores flaggedItemIds (whole-action only)', () => {
  it('approve with flaggedItemIds on a redirect deliverable still approves the whole action', async () => {
    const action = createClientAction({
      workspaceId: WS,
      sourceType: 'redirect_proposal',
      sourceId: `src-redirect-${Math.random().toString(36).slice(2, 8)}`,
      title: 'redirect recs',
      summary: 'review',
      payload: { redirects: [{ source: '/a', target: '/b' }] } as ClientActionPayload,
    });
    const deliverable = mirror('redirect', { action, siteId: SITE });

    const updated = await respondToDeliverable(WS, deliverable.id, {
      decision: 'approved',
      flaggedItemIds: ['ignored-id'],
    });

    expect(getClientAction(WS, action.id)!.status).toBe('approved');
    expect(updated.status).toBe('approved');
  });
});
