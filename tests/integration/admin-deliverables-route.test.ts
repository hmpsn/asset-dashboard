/**
 * Integration tests for GET /api/deliverables/:workspaceId (PR-2b, DARK) — the admin
 * "Client Deliverables" pane read endpoint.
 *
 * Asserts:
 *  1. It returns ALL of the workspace's deliverables (every status, not just client-facing) —
 *     incl. draft / declined that the client read filters out (E2 completeness).
 *  2. Each row is annotated with the operator STATUS AXIS (awaiting_client / changes_requested /
 *     approved / other) and an `ageDays` + derived `stale` flag.
 *  3. Stale derivation: an OLD awaiting_client (sentAt > 7d) → stale=true; a FRESH one → stale=false;
 *     changes_requested and approved are never stale.
 *  4. The route is admin-gated via requireWorkspaceAccess (404 for an unknown workspace).
 *
 * The endpoint is independent of the unified-inbox flag (the flag gates whether the admin pane
 * FETCHES it; the read itself is inert until cutover). It is exercised here with seeded rows.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createTestContext } from './helpers.js';
import { seedWorkspace } from '../fixtures/workspace-seed.js';
import type { SeededFullWorkspace } from '../fixtures/workspace-seed.js';
import { upsertDeliverable } from '../../server/client-deliverables.js';
import type { AdminDeliverableView } from '../../shared/types/admin-deliverable-view.js';

const ctx = createTestContext(13876); // port-ok: next free after 13875

let ws: SeededFullWorkspace;

function adminListUrl(wsId: string): string {
  return `/api/deliverables/${wsId}`;
}

function daysAgo(n: number): string {
  return new Date(Date.now() - n * 24 * 60 * 60 * 1000).toISOString();
}

// Seeded row ids (resolved in beforeAll).
let staleId = '';
let freshId = '';
let changesId = '';
let approvedId = '';
let draftId = '';

beforeAll(async () => {
  await ctx.startServer();
  ws = seedWorkspace({ clientPassword: '' });

  // OLD awaiting_client (10 days) → must be stale.
  staleId = upsertDeliverable({
    workspaceId: ws.workspaceId,
    type: 'redirect',
    kind: 'decision',
    status: 'awaiting_client',
    title: 'Old redirect plan',
    payload: {},
    sourceRef: 'redirect:stale',
    sentAt: daysAgo(10),
  }).id;
  // FRESH awaiting_client (1 day) → not stale.
  freshId = upsertDeliverable({
    workspaceId: ws.workspaceId,
    type: 'aeo_change',
    kind: 'batch',
    status: 'awaiting_client',
    title: 'Fresh AEO change',
    payload: {},
    sourceRef: 'aeo:fresh',
    sentAt: daysAgo(1),
  }).id;
  // changes_requested → axis=changes_requested, never stale.
  changesId = upsertDeliverable({
    workspaceId: ws.workspaceId,
    type: 'internal_link',
    kind: 'batch',
    status: 'changes_requested',
    title: 'Internal links — changes requested',
    payload: {},
    sourceRef: 'internal_link:changes',
    sentAt: daysAgo(20),
  }).id;
  // approved → axis=approved (to apply).
  approvedId = upsertDeliverable({
    workspaceId: ws.workspaceId,
    type: 'schema_item',
    kind: 'decision',
    status: 'approved',
    title: 'Schema item — approved',
    payload: {},
    sourceRef: 'schema:approved',
    sentAt: daysAgo(3),
  }).id;
  // draft → not client-facing (excluded from the CLIENT read) but PRESENT in the ADMIN read.
  draftId = upsertDeliverable({
    workspaceId: ws.workspaceId,
    type: 'seo_edit',
    kind: 'batch',
    status: 'draft',
    title: 'Draft edits',
    payload: {},
    sourceRef: 'seo:draft',
  }).id;
}, 25_000);

afterAll(async () => {
  ws?.cleanup();
  await ctx.stopServer();
});

describe('GET /api/deliverables/:workspaceId — admin all-status view', () => {
  it('returns every status incl. non-client-facing draft (E2 completeness)', async () => {
    const res = await ctx.api(adminListUrl(ws.workspaceId));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { deliverables: AdminDeliverableView[] };
    const ids = body.deliverables.map((d) => d.id);

    expect(ids).toContain(staleId);
    expect(ids).toContain(freshId);
    expect(ids).toContain(changesId);
    expect(ids).toContain(approvedId);
    // The draft row is NOT client-facing but MUST be in the admin operator view.
    expect(ids).toContain(draftId);
  });

  it('annotates each row with the status axis', async () => {
    const res = await ctx.api(adminListUrl(ws.workspaceId));
    const body = (await res.json()) as { deliverables: AdminDeliverableView[] };
    const byId = new Map(body.deliverables.map((d) => [d.id, d]));

    expect(byId.get(staleId)!.statusAxis).toBe('awaiting_client');
    expect(byId.get(freshId)!.statusAxis).toBe('awaiting_client');
    expect(byId.get(changesId)!.statusAxis).toBe('changes_requested');
    expect(byId.get(approvedId)!.statusAxis).toBe('approved');
    expect(byId.get(draftId)!.statusAxis).toBe('other');
  });

  it('derives the stale flag + ageDays from sentAt (old awaiting → stale; fresh → not)', async () => {
    const res = await ctx.api(adminListUrl(ws.workspaceId));
    const body = (await res.json()) as { deliverables: AdminDeliverableView[] };
    const byId = new Map(body.deliverables.map((d) => [d.id, d]));

    const stale = byId.get(staleId)!;
    expect(stale.stale).toBe(true);
    expect(stale.ageDays).toBeGreaterThanOrEqual(7);

    const fresh = byId.get(freshId)!;
    expect(fresh.stale).toBe(false);
    expect(fresh.ageDays).toBeLessThan(7);

    // Old, but NOT awaiting_client → never stale (stale is an awaiting-response nudge signal).
    expect(byId.get(changesId)!.stale).toBe(false);
    expect(byId.get(approvedId)!.stale).toBe(false);

    // Never-sent draft → ageDays null, not stale.
    const draft = byId.get(draftId)!;
    expect(draft.ageDays).toBeNull();
    expect(draft.stale).toBe(false);
  });
});

describe('GET /api/deliverables/:workspaceId — admin auth/handler', () => {
  it('404s for an unknown workspace (route is registered + reaches the handler)', async () => {
    const res = await ctx.api(adminListUrl('no-such-ws'));
    expect(res.status).toBe(404);
  });
});
