/**
 * R2 — respond propagation (the LINCHPIN). Proves that a unified-inbox client decision
 * (`respondToDeliverable`) writes back to the REAL SOURCE artifact (legacy approval batch /
 * client_action / schema_plan), not just the client_deliverable mirror — and that the team is
 * notified exactly ONCE (the source path owns the team email; the deliverable-level email is
 * suppressed for types with a respondToSource).
 *
 * For each physical family we seed BOTH:
 *   (a) the SOURCE artifact (approval_batches / client_actions / schema_site_plans), AND
 *   (b) its client_deliverable MIRROR (via the registered adapter — same path the dual-write uses),
 * then call respondToDeliverable(approve | changes_requested) and assert:
 *   1. the SOURCE artifact status changed (the real linchpin),
 *   2. the deliverable mirror status changed,
 *   3. the team-notify fired exactly once (no double-notify).
 * Plus: respond on a projected id still 404s (unchanged).
 *
 * Email is mocked so we can COUNT team-notify calls deterministically (the source path and the
 * deliverable path both call into ../../server/email.js — the mock lets us assert "once").
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';

// Mock email FIRST (hoisted) so every importer (send-to-client, approval-batch-respond,
// client-actions-mutations) sees the spied notify fns. isEmailConfigured → true so the
// deliverable-level notifyTeamOfResponse would fire IF it were not suppressed (proving suppression).
// vi.hoisted keeps the spies accessible despite the vi.mock factory hoisting.
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
// The barrel self-registers every physical adapter (with R2 respondToSource wired).
import '../../server/domains/inbox/deliverable-adapters/index.js';
import { getAdapter } from '../../server/domains/inbox/deliverable-adapters/index.js';
import { respondToDeliverable, SendToClientError } from '../../server/domains/inbox/send-to-client.js';
import { upsertDeliverable, getDeliverable } from '../../server/client-deliverables.js';
import { createBatch, getBatch } from '../../server/approvals.js';
import { createClientAction, getClientAction } from '../../server/client-actions.js';
import { saveSchemaPlan, getSchemaPlan } from '../../server/schema-store.js';
import { createWorkspace, deleteWorkspace } from '../../server/workspaces.js';
import type { ClientActionPayload } from '../../shared/types/client-actions.js';
import type { SchemaSitePlan } from '../../shared/types/schema-plan.js';
import type { ClientDeliverable, DeliverableType } from '../../shared/types/client-deliverable.js';

const SITE = 'site-r2-respond';
const ws = createWorkspace('r2-respond-propagation-test', SITE);
const WS = ws.id;

beforeAll(() => {
  setBroadcast(vi.fn(), vi.fn());
});

afterAll(() => {
  db.prepare('DELETE FROM approval_batches WHERE workspace_id = ?').run(WS);
  db.prepare('DELETE FROM client_actions WHERE workspace_id = ?').run(WS);
  db.prepare('DELETE FROM schema_site_plans WHERE workspace_id = ?').run(WS);
  db.prepare('DELETE FROM client_deliverable WHERE workspace_id = ?').run(WS);
  deleteWorkspace(WS);
});

beforeEach(() => {
  mockNotifyTeamActionApproved.mockClear();
  mockNotifyTeamChangesRequested.mockClear();
  mockNotifyApprovalReady.mockClear();
  db.prepare('DELETE FROM approval_batches WHERE workspace_id = ?').run(WS);
  db.prepare('DELETE FROM client_actions WHERE workspace_id = ?').run(WS);
  db.prepare('DELETE FROM schema_site_plans WHERE workspace_id = ?').run(WS);
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
    source: 'r2-test-mirror',
    sourceRef: adapter.sourceRef(input),
    items: built.items,
  });
}

// ── approval_batch family (seo_edit / audit_issue / schema_item / content_plan_*) ──

describe('R2 respond propagation — approval_batch family', () => {
  it('approve writes the SOURCE batch items → approved (+ mirror approved, team-notify once)', async () => {
    const batch = createBatch(WS, SITE, 'SEO Changes', [
      { pageId: 'p1', pageTitle: 'P1', pageSlug: 'p1', field: 'seoTitle', currentValue: 'a', proposedValue: 'b' },
      { pageId: 'p2', pageTitle: 'P2', pageSlug: 'p2', field: 'seoDescription', currentValue: 'c', proposedValue: 'd' },
    ]);
    const deliverable = mirror('seo_edit', batch);

    const updated = await respondToDeliverable(WS, deliverable.id, { decision: 'approved' });

    // 1. THE LINCHPIN: the real source batch + its items moved to approved.
    const sourceAfter = getBatch(WS, batch.id)!;
    expect(sourceAfter.status).toBe('approved');
    expect(sourceAfter.items).toHaveLength(2);
    expect(sourceAfter.items.every(i => i.status === 'approved')).toBe(true); // every-ok: length asserted above
    // 2. the deliverable mirror moved.
    expect(updated.status).toBe('approved');
    expect(getDeliverable(deliverable.id)!.status).toBe('approved');
    // 3. team-notify fired EXACTLY once (source path owns it; deliverable-level suppressed).
    expect(mockNotifyTeamActionApproved).toHaveBeenCalledTimes(1);
    expect(mockNotifyTeamChangesRequested).not.toHaveBeenCalled();
  });

  it('changes_requested writes the SOURCE batch items → rejected (+ note, team-notify once)', async () => {
    const batch = createBatch(WS, SITE, 'SEO Changes', [
      { pageId: 'p1', pageTitle: 'P1', pageSlug: 'p1', field: 'seoTitle', currentValue: 'a', proposedValue: 'b' },
    ]);
    const deliverable = mirror('seo_edit', batch);

    const updated = await respondToDeliverable(WS, deliverable.id, {
      decision: 'changes_requested',
      note: 'tweak the title',
    });

    const sourceAfter = getBatch(WS, batch.id)!;
    expect(sourceAfter.status).toBe('rejected');
    expect(sourceAfter.items).toHaveLength(1);
    expect(sourceAfter.items.every(i => i.status === 'rejected')).toBe(true); // every-ok: length asserted above
    expect(sourceAfter.items[0].clientNote).toBe('tweak the title');
    expect(updated.status).toBe('changes_requested');
    expect(mockNotifyTeamChangesRequested).toHaveBeenCalledTimes(1);
    expect(mockNotifyTeamActionApproved).not.toHaveBeenCalled();
  });

  it('declined also routes the SOURCE batch items → rejected (deliverable declined vocabulary)', async () => {
    const batch = createBatch(WS, SITE, 'SEO Changes', [
      { pageId: 'p1', pageTitle: 'P1', pageSlug: 'p1', field: 'seoTitle', currentValue: 'a', proposedValue: 'b' },
    ]);
    const deliverable = mirror('seo_edit', batch);

    const updated = await respondToDeliverable(WS, deliverable.id, { decision: 'declined', note: 'no' });

    // deliverable mirror uses the `declined` vocabulary; the approval batch reject path is `rejected`.
    expect(getBatch(WS, batch.id)!.status).toBe('rejected');
    expect(updated.status).toBe('declined');
    expect(mockNotifyTeamChangesRequested).toHaveBeenCalledTimes(1);
    expect(mockNotifyTeamActionApproved).not.toHaveBeenCalled();
  });

  it('audit_issue + content_plan_* also propagate to their source batch on approve', async () => {
    for (const [type, name] of [
      ['audit_issue', '[Review] Missing meta description'],
      ['content_plan_sample', 'Content Plan: Spring — Sample Review (1 page)'],
      ['content_plan_template', 'Content Plan: Spring — Template Review'],
    ] as const) {
      const batch = createBatch(WS, SITE, name, [
        { pageId: 'p1', pageTitle: 'P1', pageSlug: 'p1', field: 'seoDescription', currentValue: 'a', proposedValue: 'b' },
      ]);
      const deliverable = mirror(type, batch);
      await respondToDeliverable(WS, deliverable.id, { decision: 'approved' });
      expect(getBatch(WS, batch.id)!.status).toBe('approved');
      db.prepare('DELETE FROM approval_batches WHERE workspace_id = ?').run(WS);
      db.prepare('DELETE FROM client_deliverable WHERE workspace_id = ?').run(WS);
    }
  });
});

// ── client_action family (redirect / internal_link / aeo_change / content_decay) ──

describe('R2 respond propagation — client_action family', () => {
  function seedAction(
    sourceType: 'redirect_proposal' | 'internal_link' | 'aeo_change' | 'content_decay',
    payload: ClientActionPayload,
  ) {
    return createClientAction({
      workspaceId: WS,
      sourceType,
      sourceId: `src-${sourceType}-${Math.random().toString(36).slice(2, 8)}`,
      title: `${sourceType} recs`,
      summary: 'review',
      payload,
    });
  }

  it('approve writes the SOURCE client_action → approved (+ mirror approved, team-notify once)', async () => {
    const action = seedAction('redirect_proposal', { redirects: [{ source: '/a', target: '/b' }] } as ClientActionPayload);
    const deliverable = mirror('redirect', { action, siteId: SITE });

    const updated = await respondToDeliverable(WS, deliverable.id, { decision: 'approved' });

    // 1. THE LINCHPIN: the real source action moved to approved.
    expect(getClientAction(WS, action.id)!.status).toBe('approved');
    // 2. mirror moved.
    expect(updated.status).toBe('approved');
    // 3. team-notify fired once (respondToPublicClientAction's approve email; deliverable suppressed).
    expect(mockNotifyTeamActionApproved).toHaveBeenCalledTimes(1);
  });

  it('changes_requested writes the SOURCE client_action → changes_requested (+ note)', async () => {
    const action = seedAction('internal_link', { suggestions: [{ anchorText: 'x', targetUrl: '/x' }] } as ClientActionPayload);
    const deliverable = mirror('internal_link', { action, siteId: SITE });

    const updated = await respondToDeliverable(WS, deliverable.id, {
      decision: 'changes_requested',
      note: 'use a different anchor',
    });

    const sourceAfter = getClientAction(WS, action.id)!;
    expect(sourceAfter.status).toBe('changes_requested');
    expect(sourceAfter.clientNote).toBe('use a different anchor');
    expect(updated.status).toBe('changes_requested');
    // The legacy public respond mutation does NOT email on changes_requested (known B4 gap, out of
    // scope) — and the deliverable-level email is suppressed for this family, so NEITHER fires.
    // The contract proven here: no DOUBLE notify (the source path is the single owner).
    expect(mockNotifyTeamActionApproved).not.toHaveBeenCalled();
    expect(mockNotifyTeamChangesRequested).not.toHaveBeenCalled();
  });

  it('declined maps to the client_action changes path (no declined status in that family)', async () => {
    const action = seedAction('aeo_change', { metadata: { origin: { pageUrl: '/faq' } }, diffs: [{ page: 'FAQ', current: 'a', proposed: 'b' }] } as ClientActionPayload);
    const deliverable = mirror('aeo_change', { action, siteId: SITE });

    await respondToDeliverable(WS, deliverable.id, { decision: 'declined', note: 'not now' });

    expect(getClientAction(WS, action.id)!.status).toBe('changes_requested');
  });

  it('content_decay (kind=decision) also propagates to its source action', async () => {
    const action = seedAction('content_decay', {
      metadata: { origin: { pageUrl: '/blog/x', targetKeyword: 'widgets' } },
      page: { page: '/blog/x' },
    } as unknown as ClientActionPayload);
    const deliverable = mirror('content_decay', { action, siteId: SITE });

    await respondToDeliverable(WS, deliverable.id, { decision: 'approved' });

    expect(getClientAction(WS, action.id)!.status).toBe('approved');
    expect(mockNotifyTeamActionApproved).toHaveBeenCalledTimes(1);
  });
});

// ── schema_plan ──

describe('R2 respond propagation — schema_plan', () => {
  function seedPlan(): SchemaSitePlan {
    const plan: SchemaSitePlan = {
      id: `plan_${Math.random().toString(36).slice(2, 10)}`,
      siteId: SITE,
      workspaceId: WS,
      siteUrl: 'https://example.com',
      canonicalEntities: [
        { type: 'Organization', name: 'Ex', canonicalUrl: 'https://example.com', id: 'https://example.com/#org' },
      ],
      pageRoles: [
        { pagePath: '/', pageTitle: 'Home', role: 'homepage', primaryType: 'Organization', entityRefs: [] },
      ],
      status: 'sent_to_client',
      generatedAt: '2026-05-30T12:00:00.000Z',
      updatedAt: '2026-06-01T00:00:00.000Z',
    };
    return saveSchemaPlan(plan);
  }

  it('approve writes the SOURCE plan → client_approved (+ mirror approved)', async () => {
    seedPlan();
    const deliverable = mirror('schema_plan', { plan: getSchemaPlan(SITE)! });

    const updated = await respondToDeliverable(WS, deliverable.id, { decision: 'approved' });

    // 1. THE LINCHPIN: the real schema plan moved to client_approved.
    expect(getSchemaPlan(SITE)!.status).toBe('client_approved');
    // 2. mirror moved.
    expect(updated.status).toBe('approved');
    // 3. schema_plan source path has no team email (parity with legacy route); deliverable-level
    //    suppressed → neither email fires (no double-notify; the source signal is activity+broadcast).
    expect(mockNotifyTeamActionApproved).not.toHaveBeenCalled();
    expect(mockNotifyTeamChangesRequested).not.toHaveBeenCalled();
  });

  it('changes_requested writes the SOURCE plan → client_changes_requested', async () => {
    seedPlan();
    const deliverable = mirror('schema_plan', { plan: getSchemaPlan(SITE)! });

    const updated = await respondToDeliverable(WS, deliverable.id, {
      decision: 'changes_requested',
      note: 'add FAQ schema',
    });

    expect(getSchemaPlan(SITE)!.status).toBe('client_changes_requested');
    expect(updated.status).toBe('changes_requested');
  });
});

// ── projected types still 404 (unchanged) ──

describe('R2 respond propagation — projected ids still 404', () => {
  it('respond on a non-existent (projected/unknown) deliverable id 404s, unchanged', async () => {
    await expect(
      respondToDeliverable(WS, 'projected-or-missing-id', { decision: 'approved' }),
    ).rejects.toThrow(SendToClientError);
  });
});
