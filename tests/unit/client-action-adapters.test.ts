import { describe, it, expect, afterEach } from 'vitest';
import db from '../../server/db/index.js';
import { getAdapter } from '../../server/domains/inbox/deliverable-adapters/types.js';
// Importing the barrel self-registers the four PR-1b client_action adapters.
import '../../server/domains/inbox/deliverable-adapters/index.js';
import { upsertDeliverable, getDeliverable } from '../../server/client-deliverables.js';
import {
  CLIENT_ACTION_FAMILY_TYPES,
  type ClientActionFamilyType,
  type ClientActionInput,
  clientActionDeliverableType,
} from '../../server/domains/inbox/deliverable-adapters/client-action-shared.js';
import type { ClientAction, ClientActionPayload, ClientActionSourceType } from '../../shared/types/client-actions.js';

const WS = 'client-action-adapter-test';
const SITE = 'site-abc';

afterEach(() => {
  db.prepare('DELETE FROM client_deliverable WHERE workspace_id = ?').run(WS);
});

function makeAction(over: Partial<ClientAction> = {}): ClientAction {
  return {
    id: `ca_${Math.random().toString(36).slice(2, 10)}`,
    workspaceId: WS,
    sourceType: 'redirect_proposal',
    sourceId: undefined,
    title: 'A client action',
    summary: 'Some summary',
    payload: {},
    status: 'pending',
    priority: 'medium',
    createdAt: '2026-06-01T00:00:00.000Z',
    updatedAt: '2026-06-01T00:00:00.000Z',
    ...over,
  };
}

function input(action: ClientAction, siteId: string | null = SITE): ClientActionInput {
  return { action, siteId };
}

// Per-type fixtures: a sendable action + its expected (deliverable type, sourceType, sourceRef).
const REDIRECT_PAYLOAD: ClientActionPayload = {
  redirects: [
    { source: '/old', target: '/new', rationale: 'moved' },
    { source: '/gone', target: '/home', type: 'permanent' },
  ],
};
const INTERNAL_LINK_PAYLOAD: ClientActionPayload = {
  suggestions: [
    { anchorText: 'pricing', targetUrl: '/pricing', sourcePageUrl: '/home' },
  ],
};
const AEO_PAYLOAD: ClientActionPayload = {
  metadata: { origin: { pageUrl: '/faq' } },
  diffs: [{ page: 'FAQ', current: 'a', proposed: 'b', rationale: 'better' }],
};
const DECAY_PAYLOAD: ClientActionPayload = {
  metadata: { origin: { pageUrl: '/blog/post', targetKeyword: 'widgets' } },
  page: { page: '/blog/post', clickDeclinePct: 40, severity: 'critical' },
};

describe('client_action adapters — registration', () => {
  it('registers all four family adapters via the barrel', () => {
    for (const type of CLIENT_ACTION_FAMILY_TYPES) {
      const adapter = getAdapter(type);
      expect(adapter.type).toBe(type);
      // Apply stays disabled this family (D-apply, permanent) — no adapter opts in.
      expect(adapter.appliesOnApprove).toBeFalsy();
    }
  });

  it('maps the legacy redirect_proposal sourceType to the redirect deliverable type', () => {
    const map: Record<ClientActionSourceType, ClientActionFamilyType> = {
      redirect_proposal: 'redirect',
      internal_link: 'internal_link',
      aeo_change: 'aeo_change',
      content_decay: 'content_decay',
    };
    for (const [src, expected] of Object.entries(map)) {
      expect(clientActionDeliverableType(src as ClientActionSourceType)).toBe(expected);
    }
  });
});

describe('client_action adapters — round-trip (build → store → parse → assert-no-fallback)', () => {
  const cases: Array<{
    type: ClientActionFamilyType;
    sourceType: ClientActionSourceType;
    payload: ClientActionPayload;
    expectedKind: 'batch' | 'decision';
    expectedItemCount: number;
  }> = [
    { type: 'redirect', sourceType: 'redirect_proposal', payload: REDIRECT_PAYLOAD, expectedKind: 'batch', expectedItemCount: 2 },
    { type: 'internal_link', sourceType: 'internal_link', payload: INTERNAL_LINK_PAYLOAD, expectedKind: 'batch', expectedItemCount: 1 },
    { type: 'aeo_change', sourceType: 'aeo_change', payload: AEO_PAYLOAD, expectedKind: 'batch', expectedItemCount: 1 },
    { type: 'content_decay', sourceType: 'content_decay', payload: DECAY_PAYLOAD, expectedKind: 'decision', expectedItemCount: 1 },
  ];

  it.each(cases)('round-trips $type with no payload fallback (kind=$expectedKind)', (c) => {
    const adapter = getAdapter(c.type);
    const action = makeAction({ sourceType: c.sourceType, payload: c.payload, title: `title for ${c.type}` });
    const inp = input(action);

    expect(adapter.validateSendable(inp)).toEqual({ ok: true });

    const built = adapter.buildPayload(inp);
    const sourceRef = adapter.sourceRef(inp);
    expect(built.kind).toBe(c.expectedKind);
    // Sub-items ride in payload JSON, NOT typed _item columns (design §4.1).
    expect(built.items).toBeUndefined();

    const stored = upsertDeliverable({
      workspaceId: WS,
      type: c.type,
      kind: built.kind,
      status: 'awaiting_client',
      title: built.title,
      summary: built.summary ?? null,
      payload: built.payload,
      sourceRef,
      sentAt: '2026-06-01T00:00:00.000Z',
      items: built.items,
    });

    const got = getDeliverable(stored.id)!;
    expect(got.type).toBe(c.type);
    expect(got.kind).toBe(c.expectedKind);
    // assert-no-fallback: the payload round-trips the real discriminators, not {}.
    expect(got.payload).not.toEqual({});
    expect(got.payload.family).toBe('client_action');
    expect(got.payload.subType).toBe(c.type);
    expect(got.payload.legacyActionId).toBe(action.id);
    // The sub-items array round-trips losslessly inside payload JSON.
    expect(Array.isArray(got.payload.items)).toBe(true);
    expect((got.payload.items as unknown[]).length).toBe(c.expectedItemCount);
    // No typed child items written for this family.
    expect(got.items ?? []).toHaveLength(0);
  });
});

describe('client_action adapters — sourceRef map (B17/M2 stable key)', () => {
  it('redirect → redirect:<siteId>', () => {
    const ref = getAdapter('redirect').sourceRef(input(makeAction({ sourceType: 'redirect_proposal', payload: REDIRECT_PAYLOAD })));
    expect(ref).toBe(`redirect:${SITE}`);
  });
  it('internal_link → internal_link:<siteId>', () => {
    const ref = getAdapter('internal_link').sourceRef(input(makeAction({ sourceType: 'internal_link', payload: INTERNAL_LINK_PAYLOAD })));
    expect(ref).toBe(`internal_link:${SITE}`);
  });
  it('aeo_change → aeo:<pageUrl>', () => {
    const ref = getAdapter('aeo_change').sourceRef(input(makeAction({ sourceType: 'aeo_change', payload: AEO_PAYLOAD })));
    expect(ref).toBe('aeo:/faq');
  });
  it('content_decay → content_decay:<pagePath>', () => {
    const ref = getAdapter('content_decay').sourceRef(input(makeAction({ sourceType: 'content_decay', payload: DECAY_PAYLOAD })));
    expect(ref).toBe('content_decay:/blog/post');
  });

  it('redirect/internal_link sourceRef is null when the workspace has no siteId', () => {
    expect(getAdapter('redirect').sourceRef(input(makeAction({ sourceType: 'redirect_proposal', payload: REDIRECT_PAYLOAD }), null))).toBeNull();
    expect(getAdapter('internal_link').sourceRef(input(makeAction({ sourceType: 'internal_link', payload: INTERNAL_LINK_PAYLOAD }), null))).toBeNull();
  });

  it('sourceRef is STABLE across two sends with the same site/page → dedupes to one row', () => {
    // Two distinct redirect actions (different legacy ids / timestamp-keyed sourceIds) for the
    // SAME site collapse onto one client_deliverable row (B17 fix — the live producer would
    // have created two rows keyed by timestamp).
    const a1 = makeAction({ sourceType: 'redirect_proposal', sourceId: 'redirects:2026-06-01T00:00:00Z', payload: REDIRECT_PAYLOAD });
    const a2 = makeAction({ sourceType: 'redirect_proposal', sourceId: 'redirects:2026-06-02T11:22:33Z', payload: REDIRECT_PAYLOAD });
    const adapter = getAdapter('redirect');
    const ref1 = adapter.sourceRef(input(a1));
    const ref2 = adapter.sourceRef(input(a2));
    expect(ref1).toBe(ref2);

    const store = (action: ClientAction) => {
      const built = adapter.buildPayload(input(action));
      return upsertDeliverable({
        workspaceId: WS,
        type: 'redirect',
        kind: built.kind,
        status: 'awaiting_client',
        title: built.title,
        summary: built.summary ?? null,
        payload: built.payload,
        sourceRef: adapter.sourceRef(input(action)),
        items: built.items,
      });
    };
    const first = store(a1);
    const second = store(a2);
    expect(second.id).toBe(first.id); // deduped onto one row
    const rows = db.prepare('SELECT COUNT(*) AS n FROM client_deliverable WHERE workspace_id = ? AND type = ?').get(WS, 'redirect') as { n: number };
    expect(rows.n).toBe(1);
  });
});

describe('client_action adapters — validateSendable', () => {
  it('content_decay REJECTS an action with no targetKeyword (B13)', () => {
    const noKeyword = makeAction({
      sourceType: 'content_decay',
      payload: { metadata: { origin: { pageUrl: '/blog/post' } }, page: { page: '/blog/post' } },
    });
    expect(getAdapter('content_decay').validateSendable(input(noKeyword))).toEqual({
      ok: false,
      reason: 'content decay action has no targetKeyword (B13)',
    });
    // With a keyword present it IS sendable.
    expect(getAdapter('content_decay').validateSendable(input(makeAction({ sourceType: 'content_decay', payload: DECAY_PAYLOAD })))).toEqual({ ok: true });
  });

  it('content_decay rejects an empty-string targetKeyword (B13)', () => {
    const blank = makeAction({
      sourceType: 'content_decay',
      payload: { metadata: { origin: { pageUrl: '/p', targetKeyword: '   ' } }, page: { page: '/p' } },
    });
    expect(getAdapter('content_decay').validateSendable(input(blank)).ok).toBe(false);
  });

  it('redirect / internal_link / aeo_change reject empty item arrays', () => {
    expect(getAdapter('redirect').validateSendable(input(makeAction({ sourceType: 'redirect_proposal', payload: { redirects: [] } }))).ok).toBe(false);
    expect(getAdapter('internal_link').validateSendable(input(makeAction({ sourceType: 'internal_link', payload: { suggestions: [] } }))).ok).toBe(false);
    expect(getAdapter('aeo_change').validateSendable(input(makeAction({ sourceType: 'aeo_change', payload: { diffs: [] } }))).ok).toBe(false);
  });
});

describe('client_action adapters — apply stays disabled (D-apply, permanent)', () => {
  it('apply stub throws (this family lands in a manual operator queue)', async () => {
    const adapter = getAdapter('redirect');
    await expect(adapter.applyDeliverable!({} as never)).rejects.toThrow(/permanent no-op|manual operator queue/i);
  });
});
