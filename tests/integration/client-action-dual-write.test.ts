import { describe, it, expect, afterEach, afterAll } from 'vitest';
import db from '../../server/db/index.js';
// The barrel self-registers the four family adapters the mirror resolves.
import '../../server/domains/inbox/deliverable-adapters/index.js';
import { mirrorClientActionToDeliverable } from '../../server/domains/inbox/client-action-dual-write.js';
import { listDeliverables } from '../../server/client-deliverables.js';
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

describe('client-action dual-write mirror', () => {
  it('mirrors a redirect deliverable with the stable site sourceRef', () => {
    const mirrored = mirrorClientActionToDeliverable(WS, makeAction());
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
    const mirrored = mirrorClientActionToDeliverable(WS, action);
    expect(mirrored!.type).toBe('content_decay');
    expect(mirrored!.kind).toBe('decision');
    expect(mirrored!.sourceRef).toBe('content_decay:/blog/x');
  });

  it('is idempotent for the same site (two redirect sends → one row)', () => {
    // Two distinct actions (different timestamp-keyed legacy ids) for the same site.
    const first = mirrorClientActionToDeliverable(WS, makeAction({ sourceId: 'redirects:t1' }));
    const second = mirrorClientActionToDeliverable(WS, makeAction({ sourceId: 'redirects:t2' }));
    expect(second!.id).toBe(first!.id);
    expect(listDeliverables(WS)).toHaveLength(1);
  });

  it('rejects a content_decay action with no targetKeyword (B13, no row, no throw)', () => {
    const action = makeAction({
      sourceType: 'content_decay',
      sourceId: 'content-decay:/p',
      payload: { metadata: { origin: { pageUrl: '/p' } }, page: { page: '/p' } },
    });
    const result = mirrorClientActionToDeliverable(WS, action);
    expect(result).toBeNull();
    expect(listDeliverables(WS)).toHaveLength(0);
  });

  it('rejects an empty redirect array via validateSendable (no row, no throw)', () => {
    const result = mirrorClientActionToDeliverable(WS, makeAction({ payload: { redirects: [] } as ClientActionPayload }));
    expect(result).toBeNull();
    expect(listDeliverables(WS)).toHaveLength(0);
  });
});
