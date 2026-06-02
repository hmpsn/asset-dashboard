/**
 * Item 2 — EDIT-before-approve propagation. A unified-inbox
 * `respondToDeliverable({ decision:'approved', editedItems:[{itemId, value}] })` must persist the
 * client's edited proposed value as the legacy approval item's `clientValue`, while approving the
 * item. The Webflow apply path already prefers `item.clientValue || item.proposedValue`
 * (server/routes/approvals.ts), so persisting `clientValue` is the ONLY change needed for apply to
 * honor the edit.
 *
 * Edit is orthogonal to flag: a client can EDIT and APPROVE the same item, or EDIT one + FLAG
 * another. Edit is APPROVAL-FAMILY ONLY (typed item rows with `itemPayload.legacyItemId`); the
 * client_action family has no typed items, so editedItems is a no-op there.
 *
 * Email is mocked so the team-notify contract stays deterministic (mirrors
 * respond-per-item-propagation.test.ts).
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
import { createWorkspace, deleteWorkspace } from '../../server/workspaces.js';
import type { ClientDeliverable, DeliverableType } from '../../shared/types/client-deliverable.js';

const SITE = 'site-edit-before-approve';
const ws = createWorkspace('edit-before-approve-test', SITE);
const WS = ws.id;

beforeAll(() => {
  setBroadcast(vi.fn(), vi.fn());
});

afterAll(() => {
  db.prepare('DELETE FROM approval_batches WHERE workspace_id = ?').run(WS);
  db.prepare('DELETE FROM client_deliverable WHERE workspace_id = ?').run(WS);
  deleteWorkspace(WS);
});

beforeEach(() => {
  mockNotifyTeamActionApproved.mockClear();
  mockNotifyTeamChangesRequested.mockClear();
  mockNotifyApprovalReady.mockClear();
  db.prepare('DELETE FROM approval_batches WHERE workspace_id = ?').run(WS);
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
    source: 'edit-test-mirror',
    sourceRef: adapter.sourceRef(input),
    items: built.items,
  });
}

/** deliverable item id → legacy approval item id (itemPayload.legacyItemId). */
function legacyIdByDeliverableItemId(d: ClientDeliverable): Record<string, string> {
  const map: Record<string, string> = {};
  for (const item of d.items ?? []) {
    const legacy = (item.itemPayload as { legacyItemId?: unknown } | null)?.legacyItemId;
    if (typeof legacy === 'string') map[item.id] = legacy;
  }
  return map;
}

describe('Item 2 — edit-before-approve propagation (approval_batch family)', () => {
  it('approve with editedItems persists the edited value as the legacy item clientValue (apply prefers it)', async () => {
    const batch = createBatch(WS, SITE, 'SEO Changes', [
      { pageId: 'p1', pageTitle: 'P1', pageSlug: 'p1', field: 'seoTitle', currentValue: 'a', proposedValue: 'Proposed title' },
      { pageId: 'p2', pageTitle: 'P2', pageSlug: 'p2', field: 'seoDescription', currentValue: 'c', proposedValue: 'Proposed desc' },
    ]);
    const deliverable = mirror('seo_edit', batch);
    const idMap = legacyIdByDeliverableItemId(deliverable);

    // Edit the deliverable item mapping to legacy item p1, with a client-fixed title.
    const editedDeliverableItemId = (deliverable.items ?? []).find(
      (i) => idMap[i.id] === batch.items[0].id,
    )!.id;
    const EDITED = 'Client-fixed title under 60 chars';

    const updated = await respondToDeliverable(WS, deliverable.id, {
      decision: 'approved',
      editedItems: [{ itemId: editedDeliverableItemId, value: EDITED }],
    });

    const sourceAfter = getBatch(WS, batch.id)!;
    const byId = new Map(sourceAfter.items.map((i) => [i.id, i]));
    // 1. THE LINCHPIN: the edited item's clientValue holds the client's edit; the apply path
    //    (`item.clientValue || item.proposedValue`) will therefore write the EDITED value, not the
    //    original proposal.
    expect(byId.get(batch.items[0].id)!.clientValue).toBe(EDITED);
    // 1b. The edited item is still APPROVED (edit ≠ flag — the client approves the edited value).
    expect(byId.get(batch.items[0].id)!.status).toBe('approved');
    // 2. The un-edited item keeps its original proposal (no spurious clientValue) and is approved.
    expect(byId.get(batch.items[1].id)!.clientValue ?? null).toBeNull();
    expect(byId.get(batch.items[1].id)!.status).toBe('approved');
    // 3. Both approved → batch approved; the deliverable mirror is approved.
    expect(sourceAfter.status).toBe('approved');
    expect(updated.status).toBe('approved');
    expect(getDeliverable(deliverable.id)!.status).toBe('approved');
  });

  it('edit + flag on the SAME respond: edited item approved-with-clientValue, flagged item held', async () => {
    const batch = createBatch(WS, SITE, 'SEO Changes', [
      { pageId: 'p1', pageTitle: 'P1', pageSlug: 'p1', field: 'seoTitle', currentValue: 'a', proposedValue: 'Proposed A' },
      { pageId: 'p2', pageTitle: 'P2', pageSlug: 'p2', field: 'seoTitle', currentValue: 'c', proposedValue: 'Proposed B' },
    ]);
    const deliverable = mirror('seo_edit', batch);
    const idMap = legacyIdByDeliverableItemId(deliverable);
    const editId = (deliverable.items ?? []).find((i) => idMap[i.id] === batch.items[0].id)!.id;
    const flagId = (deliverable.items ?? []).find((i) => idMap[i.id] === batch.items[1].id)!.id;

    await respondToDeliverable(WS, deliverable.id, {
      decision: 'approved',
      editedItems: [{ itemId: editId, value: 'Edited A' }],
      flaggedItems: [{ itemId: flagId, note: 'hold this one' }],
    });

    const sourceAfter = getBatch(WS, batch.id)!;
    const byId = new Map(sourceAfter.items.map((i) => [i.id, i]));
    // Edited item: approved + clientValue.
    expect(byId.get(batch.items[0].id)!.status).toBe('approved');
    expect(byId.get(batch.items[0].id)!.clientValue).toBe('Edited A');
    // Flagged item: rejected (held) + its flag note.
    expect(byId.get(batch.items[1].id)!.status).toBe('rejected');
    expect(byId.get(batch.items[1].id)!.clientNote).toBe('hold this one');
    // Mixed → partial.
    expect(sourceAfter.status).toBe('partial');
  });

  it('BACK-COMPAT: approve with NO editedItems/flaggedItems approves all + sets no clientValue', async () => {
    const batch = createBatch(WS, SITE, 'SEO Changes', [
      { pageId: 'p1', pageTitle: 'P1', pageSlug: 'p1', field: 'seoTitle', currentValue: 'a', proposedValue: 'b' },
    ]);
    const deliverable = mirror('seo_edit', batch);

    await respondToDeliverable(WS, deliverable.id, { decision: 'approved' });

    const sourceAfter = getBatch(WS, batch.id)!;
    expect(sourceAfter.status).toBe('approved');
    expect(sourceAfter.items[0].clientValue ?? null).toBeNull();
  });

  it('changes_requested ignores editedItems — whole batch rejected, no clientValue persisted', async () => {
    const batch = createBatch(WS, SITE, 'SEO Changes', [
      { pageId: 'p1', pageTitle: 'P1', pageSlug: 'p1', field: 'seoTitle', currentValue: 'a', proposedValue: 'b' },
    ]);
    const deliverable = mirror('seo_edit', batch);
    const editId = (deliverable.items ?? [])[0].id;

    await respondToDeliverable(WS, deliverable.id, {
      decision: 'changes_requested',
      note: 'redo it',
      editedItems: [{ itemId: editId, value: 'should be ignored' }],
    });

    const sourceAfter = getBatch(WS, batch.id)!;
    expect(sourceAfter.status).toBe('rejected');
    // Edit discarded on reject — the team is redoing the work; no clientValue persisted.
    expect(sourceAfter.items[0].clientValue ?? null).toBeNull();
  });
});
