/**
 * Unit tests for normalizeDeliverable (PR-2a) — the unified ClientDeliverable → NormalizedDecision
 * adapter. Asserts each deliverable kind adapts correctly (the inline-vs-modal discriminant,
 * item count, badge, and the sentAt staleness clock), and that legacy adapters still carry `kind`.
 */
import { describe, it, expect } from 'vitest';
import {
  normalizeDeliverable,
  normalizeClientAction,
  normalizeApprovalBatch,
  deliverableTypeBadge,
  isProjectedDeliverable,
} from '../../src/lib/decision-adapters.js';
import type { ClientDeliverable } from '../../shared/types/client-deliverable.js';
import type { ClientAction } from '../../shared/types/client-actions.js';
import type { ApprovalBatch } from '../../shared/types/approvals.js';

function makeDeliverable(overrides: Partial<ClientDeliverable> = {}): ClientDeliverable {
  return {
    id: 'cd_123',
    workspaceId: 'ws-1',
    externalRef: null,
    type: 'redirect',
    kind: 'decision',
    status: 'awaiting_client',
    title: 'Redirect plan',
    summary: 'Proposed redirects',
    payload: {},
    note: null,
    clientResponseNote: null,
    parentDeliverableId: null,
    sentAt: '2026-05-30T00:00:00.000Z',
    decidedAt: null,
    dueAt: null,
    appliedAt: null,
    generatedAt: null,
    source: null,
    sourceRef: null,
    createdAt: '2026-05-29T00:00:00.000Z',
    updatedAt: '2026-05-30T00:00:00.000Z',
    ...overrides,
  };
}

describe('normalizeDeliverable', () => {
  it('decision kind → inline single-action (isSingleAction true)', () => {
    const d = normalizeDeliverable(makeDeliverable({ kind: 'decision', type: 'content_decay' }));
    expect(d.source).toBe('deliverable');
    expect(d.kind).toBe('decision');
    expect(d.isSingleAction).toBe(true);
    expect(d.id).toBe('cd-cd_123');
    expect(d.sourceId).toBe('cd_123');
    expect(d.badge).toBe('Content');
    expect(d.sentAt).toBe('2026-05-30T00:00:00.000Z');
  });

  it('batch kind → modal (isSingleAction false), item count from child items', () => {
    const d = normalizeDeliverable(
      makeDeliverable({
        kind: 'batch',
        type: 'seo_edit',
        items: [
          {
            id: 'i1', deliverableId: 'cd_123', status: 'pending', targetRef: null, collectionId: null,
            field: 'seoTitle', currentValue: 'a', proposedValue: 'b', clientValue: null, clientNote: null,
            applyable: true, itemPayload: null, sortOrder: 0, createdAt: '2026-05-29T00:00:00.000Z',
          },
          {
            id: 'i2', deliverableId: 'cd_123', status: 'pending', targetRef: null, collectionId: null,
            field: 'metaDescription', currentValue: 'c', proposedValue: 'd', clientValue: null, clientNote: null,
            applyable: true, itemPayload: null, sortOrder: 1, createdAt: '2026-05-29T00:00:00.000Z',
          },
        ],
      }),
    );
    expect(d.kind).toBe('batch');
    expect(d.isSingleAction).toBe(false);
    expect(d.itemCount).toBe(2);
    expect(d.badge).toBe('SEO Editor');
  });

  it('review kind (copy) → modal, item count defaults to 1 when no child items', () => {
    const d = normalizeDeliverable(makeDeliverable({ kind: 'review', type: 'copy_section' }));
    expect(d.kind).toBe('review');
    expect(d.isSingleAction).toBe(false);
    expect(d.itemCount).toBe(1);
    expect(d.badge).toBe('Copy');
  });

  it('order kind (work_order) → not inline', () => {
    const d = normalizeDeliverable(makeDeliverable({ kind: 'order', type: 'work_order' }));
    expect(d.kind).toBe('order');
    expect(d.isSingleAction).toBe(false);
    expect(d.badge).toBe('Work Order');
  });

  it('null summary becomes empty string', () => {
    const d = normalizeDeliverable(makeDeliverable({ summary: null }));
    expect(d.summary).toBe('');
  });

  it('content_request type maps to a Content badge', () => {
    const d = normalizeDeliverable(makeDeliverable({ type: 'content_request', kind: 'review' }));
    expect(d.badge).toBe('Content');
  });
});

describe('normalizeDeliverable — itemCount (R1: payload.items vs items[])', () => {
  it('redirect counts payload.items.length (sub-items ride in payload, items[] is empty)', () => {
    const d = normalizeDeliverable(
      makeDeliverable({
        type: 'redirect',
        kind: 'batch',
        items: [], // client_action family: typed _item rows are empty
        payload: { family: 'client_action', subType: 'redirect', items: [{}, {}, {}] },
      }),
    );
    // Must NOT fall back to 1 — the three redirects live in payload.items.
    expect(d.itemCount).toBe(3);
  });

  it('internal_link counts payload.items.length', () => {
    const d = normalizeDeliverable(
      makeDeliverable({
        type: 'internal_link',
        kind: 'batch',
        items: [],
        payload: { family: 'client_action', subType: 'internal_link', items: [{}, {}] },
      }),
    );
    expect(d.itemCount).toBe(2);
  });

  it('aeo_change counts payload.items.length', () => {
    const d = normalizeDeliverable(
      makeDeliverable({
        type: 'aeo_change',
        kind: 'batch',
        items: [],
        payload: { family: 'client_action', subType: 'aeo_change', items: [{}, {}, {}, {}] },
      }),
    );
    expect(d.itemCount).toBe(4);
  });

  it('redirect with no payload.items falls back to 1 (not 0)', () => {
    const d = normalizeDeliverable(
      makeDeliverable({ type: 'redirect', kind: 'batch', items: [], payload: { items: [] } }),
    );
    expect(d.itemCount).toBe(1);
  });

  it('approval/SEO family counts items[].length (NOT payload.items)', () => {
    const d = normalizeDeliverable(
      makeDeliverable({
        type: 'seo_edit',
        kind: 'batch',
        // payload.items is intentionally present but must be IGNORED for the typed-item family.
        payload: { family: 'approval_batch', items: [{}, {}, {}, {}, {}] },
        items: [
          {
            id: 'i1', deliverableId: 'cd_123', status: 'awaiting_client', targetRef: 'p1',
            collectionId: null, field: 'seoTitle', currentValue: 'old', proposedValue: 'new',
            clientValue: null, clientNote: null, applyable: false, itemPayload: null, sortOrder: 0,
            createdAt: '2026-05-29T00:00:00.000Z',
          },
          {
            id: 'i2', deliverableId: 'cd_123', status: 'awaiting_client', targetRef: 'p2',
            collectionId: null, field: 'metaDescription', currentValue: 'c', proposedValue: 'd',
            clientValue: null, clientNote: null, applyable: false, itemPayload: null, sortOrder: 1,
            createdAt: '2026-05-29T00:00:00.000Z',
          },
        ],
      }),
    );
    expect(d.itemCount).toBe(2);
  });
});

describe('normalizeDeliverable — carries items + payload to the card contract (R1)', () => {
  it('carries the typed items[] (field/currentValue/proposedValue/clientValue/targetRef/applyable/itemPayload)', () => {
    const items = [
      {
        id: 'i1', deliverableId: 'cd_123', status: 'awaiting_client', targetRef: 'page-1',
        collectionId: 'col-1', field: 'seoTitle', currentValue: 'Old title',
        proposedValue: 'New title', clientValue: null, clientNote: null, applyable: true,
        itemPayload: { check: 'title' }, sortOrder: 0, createdAt: '2026-05-29T00:00:00.000Z',
      },
    ];
    const d = normalizeDeliverable(makeDeliverable({ type: 'seo_edit', kind: 'batch', items }));
    expect(d.items).toEqual(items);
    expect(d.items?.[0].field).toBe('seoTitle');
    expect(d.items?.[0].currentValue).toBe('Old title');
    expect(d.items?.[0].proposedValue).toBe('New title');
    expect(d.items?.[0].targetRef).toBe('page-1');
    expect(d.items?.[0].applyable).toBe(true);
    expect(d.items?.[0].itemPayload).toEqual({ check: 'title' });
  });

  it('carries the deliverable payload (so payload.items reaches R3 for the client_action family)', () => {
    const payload = { family: 'client_action', subType: 'redirect', items: [{ source: '/a', target: '/b' }] };
    const d = normalizeDeliverable(makeDeliverable({ type: 'redirect', kind: 'batch', items: [], payload }));
    expect(d.payload).toEqual(payload);
    expect((d.payload?.items as unknown[]).length).toBe(1);
  });

  it('source is "deliverable" so the additive fields never leak onto legacy adapters', () => {
    const d = normalizeDeliverable(makeDeliverable());
    expect(d.source).toBe('deliverable');
    // The legacy adapters (normalizeClientAction/normalizeApprovalBatch) never set items/payload.
  });
});

describe('deliverableTypeBadge', () => {
  it('falls back to a generic label for an unknown type', () => {
    expect(deliverableTypeBadge('totally_unknown')).toBe('Update');
  });
});

describe('isProjectedDeliverable (projected vs physical tagging)', () => {
  it('tags copy_section and content_request as projected (no physical row → /respond would 404)', () => {
    expect(isProjectedDeliverable('copy_section')).toBe(true);
    expect(isProjectedDeliverable('content_request')).toBe(true);
  });

  it('tags physical types (redirect, seo_edit, schema_plan, work_order, …) as NOT projected', () => {
    expect(isProjectedDeliverable('redirect')).toBe(false);
    expect(isProjectedDeliverable('seo_edit')).toBe(false);
    expect(isProjectedDeliverable('schema_plan')).toBe(false);
    expect(isProjectedDeliverable('work_order')).toBe(false);
    expect(isProjectedDeliverable('aeo_change')).toBe(false);
  });

  it('an unknown type is not projected (safe default)', () => {
    expect(isProjectedDeliverable('totally_unknown')).toBe(false);
  });
});

describe('legacy adapters carry kind (back-compat widening)', () => {
  it('content_decay client action → decision kind + isSingleAction', () => {
    const action = {
      id: 'ca1', title: 'Decay', summary: 's', sourceType: 'content_decay',
      status: 'pending', priority: 'high', payload: {}, createdAt: '2026-01-01T00:00:00.000Z',
    } as unknown as ClientAction;
    const d = normalizeClientAction(action);
    expect(d.kind).toBe('decision');
    expect(d.isSingleAction).toBe(true);
  });

  it('non-decay client action → batch kind (opens modal)', () => {
    const action = {
      id: 'ca2', title: 'AEO', summary: 's', sourceType: 'aeo_change',
      status: 'pending', priority: 'medium', payload: { diffs: [{}, {}] }, createdAt: '2026-01-01T00:00:00.000Z',
    } as unknown as ClientAction;
    const d = normalizeClientAction(action);
    expect(d.kind).toBe('batch');
    expect(d.isSingleAction).toBe(false);
    expect(d.itemCount).toBe(2);
  });

  it('approval batch → batch kind, never single-action', () => {
    const batch = {
      id: 'ab1', name: 'SEO Editor — 3 pages',
      items: [{ id: '1' }, { id: '2' }, { id: '3' }], createdAt: '2026-01-01T00:00:00.000Z',
    } as unknown as ApprovalBatch;
    const d = normalizeApprovalBatch(batch);
    expect(d.kind).toBe('batch');
    expect(d.isSingleAction).toBe(false);
    expect(d.itemCount).toBe(3);
  });
});
