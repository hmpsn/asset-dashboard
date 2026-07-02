import { describe, it, expect, afterEach, afterAll, beforeEach } from 'vitest';
import db from '../../server/db/index.js';
// The barrel self-registers the four family adapters the mirror resolves.
import '../../server/domains/inbox/deliverable-adapters/index.js';
import { mirrorClientActionToDeliverable } from '../../server/domains/inbox/client-action-dual-write.js';
import { listDeliverables, getDeliverable } from '../../server/client-deliverables.js';
import { setBroadcast } from '../../server/broadcast.js';
import { WS_EVENTS } from '../../server/ws-events.js';
import { createWorkspace, deleteWorkspace } from '../../server/workspaces.js';
import type { ClientAction, ClientActionPayload, ClientActionSourceType } from '../../shared/types/client-actions.js';

// A real workspace (with a webflowSiteId) so the redirect/internal_link sourceRef resolves.
const ws = createWorkspace('client-action-dualwrite-test', 'site-dw-1');
const WS = ws.id;

function makeAction(over: Partial<ClientAction> = {}): ClientAction {
  return {
    id: `ca_${Math.random().toString(36).slice(2, 10)}`,
    workspaceId: WS,
    sourceType: 'redirect_proposal',
    sourceId: `redirects:${new Date().toISOString()}`,
    title: 'Redirect recommendations (2)',
    summary: 'Review 2 redirect proposals.',
    payload: { redirects: [{ source: '/a', target: '/b' }, { source: '/c', target: '/d' }] } as ClientActionPayload,
    status: 'pending',
    priority: 'medium',
    createdAt: '2026-06-01T00:00:00.000Z',
    updatedAt: '2026-06-01T00:00:00.000Z',
    ...over,
  };
}

afterEach(() => {
  db.prepare('DELETE FROM client_deliverable WHERE workspace_id = ?').run(WS);
});

afterAll(() => {
  db.prepare('DELETE FROM client_deliverable WHERE workspace_id = ?').run(WS);
  deleteWorkspace(WS);
});

// R4-PR1: the mirror now returns a typed MirrorResult { ok, deliverableId?, skipped?, reason?, error? }
// instead of a bare ClientDeliverable | null. Success carries deliverableId (read back through the
// store); a benign adapter rejection is ok:true + skipped:true (NOT a failure). These pins updated for
// the verifiable-outcome shape.
describe('client-action dual-write mirror', () => {
  it('mirrors a redirect deliverable with the stable site sourceRef', () => {
    const result = mirrorClientActionToDeliverable(WS, makeAction());
    expect(result.ok).toBe(true);
    expect(result.ok && result.deliverableId).toBeTruthy();
    const mirrored = result.ok && result.deliverableId ? getDeliverable(result.deliverableId) : null;
    expect(mirrored).not.toBeNull();
    expect(mirrored!.type).toBe('redirect'); // redirect_proposal → redirect
    expect(mirrored!.kind).toBe('batch');
    expect(mirrored!.status).toBe('awaiting_client');
    expect(mirrored!.sourceRef).toBe('redirect:site-dw-1'); // stable per-site key (B17), NOT the timestamp sourceId
    expect(listDeliverables(WS)).toHaveLength(1);
  });

  it('mirrors content_decay as a decision kind', () => {
    const action = makeAction({
      sourceType: 'content_decay',
      sourceId: 'content-decay:/blog/x',
      title: 'Refresh /blog/x',
      payload: { metadata: { origin: { pageUrl: '/blog/x', targetKeyword: 'widgets' } }, page: { page: '/blog/x' } },
    });
    const result = mirrorClientActionToDeliverable(WS, action);
    expect(result.ok).toBe(true);
    const mirrored = result.ok && result.deliverableId ? getDeliverable(result.deliverableId) : null;
    expect(mirrored!.type).toBe('content_decay');
    expect(mirrored!.kind).toBe('decision');
    expect(mirrored!.sourceRef).toBe('content_decay:/blog/x');
  });

  it('is idempotent for the same site (two redirect sends → one row)', () => {
    // Two distinct actions (different timestamp-keyed legacy ids) for the same site.
    const first = mirrorClientActionToDeliverable(WS, makeAction({ sourceId: 'redirects:t1' }));
    const second = mirrorClientActionToDeliverable(WS, makeAction({ sourceId: 'redirects:t2' }));
    expect(first.ok && second.ok).toBe(true);
    expect(second.ok && second.deliverableId).toBe(first.ok ? first.deliverableId : undefined);
    expect(listDeliverables(WS)).toHaveLength(1);
  });

  it('rejects a content_decay action with no targetKeyword (B13) → ok:true skipped, no row, no throw', () => {
    const action = makeAction({
      sourceType: 'content_decay',
      sourceId: 'content-decay:/p',
      payload: { metadata: { origin: { pageUrl: '/p' } }, page: { page: '/p' } },
    });
    const result = mirrorClientActionToDeliverable(WS, action);
    // A benign not-sendable skip is ok:true (nothing to mirror) — NOT a failure the caller alerts on.
    expect(result.ok).toBe(true);
    expect(result.ok && result.skipped).toBe(true);
    expect(result.ok && result.deliverableId).toBeUndefined();
    expect(listDeliverables(WS)).toHaveLength(0);
  });

  it('rejects an empty redirect array via validateSendable → ok:true skipped, no row, no throw', () => {
    const result = mirrorClientActionToDeliverable(WS, makeAction({ payload: { redirects: [] } as ClientActionPayload }));
    expect(result.ok).toBe(true);
    expect(result.ok && result.skipped).toBe(true);
    expect(listDeliverables(WS)).toHaveLength(0);
  });
});

// 2026-06-09 audit (data-flow confirmed #4): the send-time mirror must broadcast
// DELIVERABLE_SENT so an open unified Inbox shows the new Decision live.
describe('client-action mirror DELIVERABLE_SENT broadcast', () => {
  let events: Array<{ event: string; data: Record<string, unknown> }> = [];

  beforeEach(() => {
    events = [];
    setBroadcast(
      () => {},
      (_workspaceId, event, data) => events.push({ event, data: data as Record<string, unknown> }),
    );
  });

  it('broadcasts DELIVERABLE_SENT exactly once on successful mirror creation', () => {
    const result = mirrorClientActionToDeliverable(WS, makeAction());
    expect(result.ok && result.deliverableId).toBeTruthy();
    const sent = events.filter(e => e.event === WS_EVENTS.DELIVERABLE_SENT);
    expect(sent).toHaveLength(1);
    expect(sent[0].data.deliverableId).toBe(result.ok ? result.deliverableId : undefined);
  });

  it('does not broadcast when the adapter rejects the action', () => {
    const rejected = mirrorClientActionToDeliverable(WS, makeAction({
      payload: { redirects: [] } as never,
    }));
    expect(rejected.ok).toBe(true);
    expect(rejected.ok && rejected.skipped).toBe(true);
    expect(events).toHaveLength(0);
  });
});
