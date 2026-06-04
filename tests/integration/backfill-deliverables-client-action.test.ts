import { describe, it, expect, afterEach, afterAll } from 'vitest';
import db from '../../server/db/index.js';
import { createClientAction } from '../../server/client-actions.js';
// The barrel self-registers the four family adapters the backfill resolves.
import '../../server/domains/inbox/deliverable-adapters/index.js';
import {
  backfillClientActionDeliverables,
  assertEveryActionResolvesToOneType,
} from '../../scripts/backfill-deliverables-client-action.js';
import { listDeliverables } from '../../server/client-deliverables.js';
import { createWorkspace, deleteWorkspace } from '../../server/workspaces.js';
import { mirrorClientActionToDeliverable } from '../../server/domains/inbox/client-action-dual-write.js';
import type { ClientActionPayload } from '../../shared/types/client-actions.js';

const ws = createWorkspace('backfill-client-action-test', 'site-bf-1');
const WS = ws.id;

afterEach(() => {
  db.prepare('DELETE FROM client_actions WHERE workspace_id = ?').run(WS);
  db.prepare('DELETE FROM client_deliverable WHERE workspace_id = ?').run(WS);
});

afterAll(() => {
  db.prepare('DELETE FROM client_actions WHERE workspace_id = ?').run(WS);
  db.prepare('DELETE FROM client_deliverable WHERE workspace_id = ?').run(WS);
  deleteWorkspace(WS);
});

function seedRedirect(sourceId: string) {
  return createClientAction({
    workspaceId: WS,
    sourceType: 'redirect_proposal',
    sourceId,
    title: 'Redirect recs',
    summary: 'review',
    payload: { redirects: [{ source: '/a', target: '/b' }] } as ClientActionPayload,
  });
}
function seedInternalLink(sourceId: string) {
  return createClientAction({
    workspaceId: WS,
    sourceType: 'internal_link',
    sourceId,
    title: 'Link recs',
    summary: 'review',
    payload: { suggestions: [{ anchorText: 'x', targetUrl: '/x' }] } as ClientActionPayload,
  });
}
function seedAeo() {
  return createClientAction({
    workspaceId: WS,
    sourceType: 'aeo_change',
    sourceId: 'aeo:/faq',
    title: 'AEO recs',
    summary: 'review',
    payload: { metadata: { origin: { pageUrl: '/faq' } }, diffs: [{ page: 'FAQ', current: 'a', proposed: 'b' }] } as ClientActionPayload,
  });
}
function seedDecay(keyword: string | undefined) {
  return createClientAction({
    workspaceId: WS,
    sourceType: 'content_decay',
    sourceId: 'content-decay:/blog/p',
    title: 'Refresh /blog/p',
    summary: 'review',
    payload: { metadata: { origin: { pageUrl: '/blog/p', targetKeyword: keyword } }, page: { page: '/blog/p' } } as ClientActionPayload,
  });
}

describe('backfill-deliverables-client-action', () => {
  it('classifies and backfills each legacy action into exactly one type', () => {
    seedRedirect('redirects:2026-06-01T00:00:00Z');
    seedInternalLink('internal-links:2026-06-01T00:00:00Z');
    seedAeo();
    seedDecay('widgets');

    const result = backfillClientActionDeliverables();
    expect(result.total).toBe(4);
    expect(result.inserted).toBe(4);
    expect(result.skipped).toBe(0);
    expect(result.byType).toEqual({ redirect: 1, internal_link: 1, aeo_change: 1, content_decay: 1 });

    const types = listDeliverables(WS).map((r) => r.type).sort();
    expect(types).toEqual(['aeo_change', 'content_decay', 'internal_link', 'redirect'].sort());
  });

  it('NORMALIZES the legacy timestamp sourceId to the stable site sourceRef (audit §B.4)', () => {
    // The legacy producer keyed redirect on a timestamp; the backfill must store the STABLE
    // redirect:<siteId> sourceRef so legacy + fresh dedupe as one.
    seedRedirect('redirects:2026-06-01T00:00:00Z');
    backfillClientActionDeliverables();
    const row = listDeliverables(WS).find((r) => r.type === 'redirect')!;
    expect(row.sourceRef).toBe('redirect:site-bf-1');
  });

  it('is idempotent — two timestamp-keyed redirect rows for one site collapse to one deliverable', () => {
    seedRedirect('redirects:t1');
    seedRedirect('redirects:t2'); // a second, distinct legacy row for the same site
    const first = backfillClientActionDeliverables();
    // Both legacy rows normalize to redirect:<siteId>, so the second collapses onto the first.
    expect(first.inserted).toBe(1);
    expect(first.skipped).toBe(1);

    const second = backfillClientActionDeliverables();
    expect(second.inserted).toBe(0);
    expect(second.skipped).toBe(2);
    expect(listDeliverables(WS).filter((r) => r.type === 'redirect')).toHaveLength(1);
  });

  it('skips a content_decay action with no targetKeyword (B13 not-ready)', () => {
    seedDecay(undefined);
    const result = backfillClientActionDeliverables();
    expect(result.total).toBe(1);
    expect(result.inserted).toBe(0);
    expect(result.skipped).toBe(1);
    expect(listDeliverables(WS)).toHaveLength(0);
  });

  it('--dry-run classifies + counts but writes nothing', () => {
    seedRedirect('redirects:t');
    const result = backfillClientActionDeliverables({ dryRun: true });
    expect(result.total).toBe(1);
    expect(result.inserted).toBe(0);
    expect(listDeliverables(WS)).toHaveLength(0);
  });

  it('CROSS-PATH cutover invariant: a dual-written deliverable + a backfilled legacy row for the same site collapse to ONE', () => {
    // This is the invariant the stable sourceRef exists to deliver: the two seams
    // (live dual-write + historical backfill) must converge on one row per (site, type).
    // Fresh send via the DUAL-WRITE path → one redirect:<siteId> deliverable.
    const fresh = seedRedirect('redirects:fresh');
    const mirrored = mirrorClientActionToDeliverable(WS, fresh);
    expect(mirrored!.sourceRef).toBe('redirect:site-bf-1');
    expect(listDeliverables(WS).filter((r) => r.type === 'redirect')).toHaveLength(1);
    // A second, distinct legacy (timestamp-keyed) row for the SAME site, then BACKFILL.
    seedRedirect('redirects:legacy-ts');
    const result = backfillClientActionDeliverables();
    // Both client_actions normalize to redirect:<siteId>, which already exists → no new row.
    expect(result.inserted).toBe(0);
    expect(listDeliverables(WS).filter((r) => r.type === 'redirect')).toHaveLength(1);
  });

  it('parity assertion accepts the four-type family', () => {
    expect(() =>
      assertEveryActionResolvesToOneType([
        { id: 'x', workspaceId: WS, sourceType: 'redirect_proposal', title: 't', summary: 's', payload: {}, status: 'pending', priority: 'medium', createdAt: '', updatedAt: '' },
      ]),
    ).not.toThrow();
  });
});
