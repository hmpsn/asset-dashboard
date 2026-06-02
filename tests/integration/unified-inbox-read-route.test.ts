/**
 * Integration tests for GET /api/public/deliverables/:workspaceId (PR-2a, DARK).
 *
 * The unified client-facing deliverable read endpoint. Asserts:
 *  1. It returns PHYSICAL client_deliverable rows in client-facing statuses (seeded rows).
 *  2. It EXCLUDES non-client-facing statuses (draft / applied / cancelled).
 *  3. It returns PROJECTED content_request entries (the D-hybrid projected type) for
 *     client-facing production states.
 *  4. The route is client-portal gated (a password-protected workspace 401s unauthenticated).
 *
 * The endpoint is independent of the unified-inbox flag (the flag gates whether the CLIENT
 * fetches it; the read itself is inert until cutover). It is exercised here with seeded rows.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createTestContext } from './helpers.js';
import { seedWorkspace } from '../fixtures/workspace-seed.js';
import type { SeededFullWorkspace } from '../fixtures/workspace-seed.js';
import { upsertDeliverable } from '../../server/client-deliverables.js';
import { createContentRequest, updateContentRequest } from '../../server/content-requests.js';
import type { ClientDeliverable } from '../../shared/types/client-deliverable.js';

const ctx = createTestContext(13875); // port-ok: next free after 13874

let pwless: SeededFullWorkspace;
let pw: SeededFullWorkspace;

function listUrl(wsId: string): string {
  return `/api/public/deliverables/${wsId}`;
}

beforeAll(async () => {
  await ctx.startServer();
  // Passwordless workspace: the global app.ts client-session gate lets reads through, so
  // requireClientPortalAuth() passes (the URL is the credential) and we can read the list.
  pwless = seedWorkspace({ clientPassword: '' });
  // Password-protected workspace: an unauthenticated read is 401 by the global gate + route guard.
  pw = seedWorkspace({ clientPassword: 'secret-pass' });
}, 25_000);

afterAll(async () => {
  pwless?.cleanup();
  pw?.cleanup();
  await ctx.stopServer();
});

describe('GET /api/public/deliverables/:workspaceId — physical rows', () => {
  it('returns client-facing physical deliverables and excludes non-client-facing statuses', async () => {
    // Client-facing (should appear)
    const awaiting = upsertDeliverable({
      workspaceId: pwless.workspaceId,
      type: 'redirect',
      kind: 'decision',
      status: 'awaiting_client',
      title: 'Redirect plan',
      summary: 'Proposed redirects',
      payload: { family: 'redirect' },
      sourceRef: 'redirect:read-test-site',
      sentAt: new Date().toISOString(),
    });
    const changes = upsertDeliverable({
      workspaceId: pwless.workspaceId,
      type: 'aeo_change',
      kind: 'batch',
      status: 'changes_requested',
      title: 'AEO changes',
      payload: { family: 'aeo' },
      sourceRef: 'aeo:read-test-page',
      sentAt: new Date().toISOString(),
    });
    // Non-client-facing (should NOT appear)
    upsertDeliverable({
      workspaceId: pwless.workspaceId,
      type: 'seo_edit',
      kind: 'batch',
      status: 'draft',
      title: 'Draft edits (hidden)',
      payload: {},
      sourceRef: 'seo:read-test-draft',
    });
    upsertDeliverable({
      workspaceId: pwless.workspaceId,
      type: 'internal_link',
      kind: 'batch',
      status: 'applied',
      title: 'Applied links (hidden)',
      payload: {},
      sourceRef: 'internal_link:read-test-applied',
      sentAt: new Date().toISOString(),
    });

    const res = await ctx.api(listUrl(pwless.workspaceId));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { deliverables: ClientDeliverable[] };
    const ids = body.deliverables.map((d) => d.id);

    expect(ids).toContain(awaiting.id);
    expect(ids).toContain(changes.id);
    // Excluded statuses must not leak into the client list.
    const titles = body.deliverables.map((d) => d.title);
    expect(titles).not.toContain('Draft edits (hidden)');
    expect(titles).not.toContain('Applied links (hidden)');

    // The returned rows carry the full ClientDeliverable contract (Zod-validated response).
    const ret = body.deliverables.find((d) => d.id === awaiting.id)!;
    expect(ret.type).toBe('redirect');
    expect(ret.kind).toBe('decision');
    expect(ret.status).toBe('awaiting_client');
    expect(ret.sentAt).toBeTruthy();
  });
});

describe('GET /api/public/deliverables/:workspaceId — projected content_request', () => {
  it('projects a content request in a client-facing production state into the unified list', async () => {
    // Seed a content request, advance it to client_review (a client-facing state) with a brief.
    const request = createContentRequest(pwless.workspaceId, {
      topic: 'Unified inbox projection test',
      targetKeyword: 'unified inbox',
      intent: 'informational',
      priority: 'high',
      rationale: 'test',
      serviceType: 'brief_only',
      initialStatus: 'brief_generated',
    });
    updateContentRequest(pwless.workspaceId, request.id, {
      briefId: 'brief_test_123',
      status: 'client_review',
    });

    const res = await ctx.api(listUrl(pwless.workspaceId));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { deliverables: ClientDeliverable[] };

    const projected = body.deliverables.find((d) => d.id === `content_request:${request.id}`);
    expect(projected).toBeTruthy();
    expect(projected!.type).toBe('content_request');
    expect(projected!.kind).toBe('review');
    expect(projected!.status).toBe('awaiting_client'); // client_review → awaiting_client (M4)
    // The raw production state is carried in payload so it's never lost.
    expect(projected!.payload.contentRequestStatus).toBe('client_review');
  });
});

describe('GET /api/public/deliverables/:workspaceId — auth', () => {
  it('401s unauthenticated on a password-protected workspace', async () => {
    const res = await ctx.api(listUrl(pw.workspaceId));
    expect(res.status).toBe(401);
  });
});
