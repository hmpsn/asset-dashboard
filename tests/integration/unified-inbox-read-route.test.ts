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
import { randomUUID } from 'node:crypto';
import { createEphemeralTestContext } from './helpers.js';
import { seedWorkspace } from '../fixtures/workspace-seed.js';
import type { SeededFullWorkspace } from '../fixtures/workspace-seed.js';
import db from '../../server/db/index.js';
import { upsertDeliverable } from '../../server/client-deliverables.js';
import { createContentRequest, updateContentRequest } from '../../server/content-requests.js';
import { saveMetadata } from '../../server/copy-review.js';
import { addEntry, createBlueprint } from '../../server/page-strategy.js';
import type { ClientDeliverable } from '../../shared/types/client-deliverable.js';

const ctx = createEphemeralTestContext(import.meta.url, { autoPublicAuth: true });

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

describe('GET /api/public/deliverables/:workspaceId — physical child items[] (R1 read path)', () => {
  it("attaches a seeded seo_edit deliverable's typed items[] (field/currentValue/proposedValue) in the response", async () => {
    // Seed an approval/SEO-family deliverable WITH typed child items (the substance that lives in
    // the client_deliverable_item table, NOT payload). The R1 read path must load and serialize it.
    const seoEdit = upsertDeliverable({
      workspaceId: pwless.workspaceId,
      type: 'seo_edit',
      kind: 'batch',
      status: 'awaiting_client',
      title: 'SEO Editor — 2 pages',
      summary: '2 items for review',
      payload: { family: 'approval_batch', subType: 'seo_edit' },
      sourceRef: 'seo_edit:read-test-items-batch',
      sentAt: new Date().toISOString(),
      items: [
        {
          status: 'awaiting_client',
          targetRef: 'page-home',
          field: 'seoTitle',
          currentValue: 'Old home title',
          proposedValue: 'New optimized home title',
          applyable: false,
          itemPayload: { check: 'title', pageSlug: '/' },
          sortOrder: 0,
        },
        {
          status: 'awaiting_client',
          targetRef: 'page-about',
          field: 'metaDescription',
          currentValue: 'Old about meta',
          proposedValue: 'New about meta description',
          applyable: false,
          sortOrder: 1,
        },
      ],
    });

    const res = await ctx.api(listUrl(pwless.workspaceId));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { deliverables: ClientDeliverable[] };
    const ret = body.deliverables.find((d) => d.id === seoEdit.id);
    expect(ret).toBeTruthy();

    // The typed child items[] MUST reach the client over the PUBLIC GET (the read-path rule).
    expect(ret!.items).toBeTruthy();
    expect(ret!.items!.length).toBe(2);
    const titleItem = ret!.items!.find((i) => i.field === 'seoTitle')!;
    expect(titleItem).toBeTruthy();
    expect(titleItem.currentValue).toBe('Old home title');
    expect(titleItem.proposedValue).toBe('New optimized home title');
    expect(titleItem.targetRef).toBe('page-home');
    expect(titleItem.applyable).toBe(false);
    expect(titleItem.itemPayload).toEqual({ check: 'title', pageSlug: '/' });
    const metaItem = ret!.items!.find((i) => i.field === 'metaDescription')!;
    expect(metaItem.currentValue).toBe('Old about meta');
    expect(metaItem.proposedValue).toBe('New about meta description');
  });

  it("carries the client_action family's sub-items in payload.items (redirect — no typed _item rows)", async () => {
    // The redirect/internal_link/aeo_change family stores its sub-items in payload JSON, not the
    // typed _item table (design §4.1). The read must carry that payload through so the count + the
    // future R3 surface have the substance.
    const redirect = upsertDeliverable({
      workspaceId: pwless.workspaceId,
      type: 'redirect',
      kind: 'batch',
      status: 'awaiting_client',
      title: 'Redirect plan — 2 redirects',
      summary: '2 redirects for review',
      payload: {
        family: 'client_action',
        subType: 'redirect',
        items: [
          { source: '/old-a', target: '/new-a', type: '301' },
          { source: '/old-b', target: '/new-b', type: '301' },
        ],
      },
      sourceRef: 'redirect:read-test-payload-items-site',
      sentAt: new Date().toISOString(),
    });

    const res = await ctx.api(listUrl(pwless.workspaceId));
    const body = (await res.json()) as { deliverables: ClientDeliverable[] };
    const ret = body.deliverables.find((d) => d.id === redirect.id)!;
    expect(ret).toBeTruthy();
    // No typed child items for this family (read attaches an empty array).
    expect(ret.items ?? []).toEqual([]);
    // The substance rides in payload.items.
    const payloadItems = ret.payload.items as unknown[];
    expect(Array.isArray(payloadItems)).toBe(true);
    expect(payloadItems.length).toBe(2);
  });
});

describe('GET /api/public/deliverables/:workspaceId — projected content_request', () => {
  it('projects only the client-safe note and never exposes the operator internal note', async () => {
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
      clientNote: 'Please review the proposed outline.',
      internalNote: 'PRIVATE_OPERATOR_REQUEST_NOTE_SENTINEL',
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
    expect(projected!.note).toBe('Please review the proposed outline.');
    const raw = JSON.stringify(body);
    expect(raw).not.toContain('PRIVATE_OPERATOR_REQUEST_NOTE_SENTINEL');
    expect(projected).not.toHaveProperty('internalNote');
  });
});

describe('GET /api/public/deliverables/:workspaceId — projected copy_section privacy', () => {
  it('keeps operator reasoning, flags, steering, workspace identity, and provenance private', async () => {
    const blueprint = createBlueprint({
      workspaceId: pwless.workspaceId,
      name: `Unified copy privacy ${randomUUID().slice(0, 8)}`,
    });
    const entry = addEntry(pwless.workspaceId, blueprint.id, {
      name: 'Client review page',
      pageType: 'service',
      sectionPlan: [],
    });
    expect(entry).toBeTruthy();

    const now = new Date().toISOString();
    const sectionId = `copy_${randomUUID().slice(0, 8)}`;
    db.prepare(`
      INSERT INTO copy_sections (
        id, workspace_id, entry_id, section_plan_item_id, generated_copy, status,
        ai_annotation, ai_reasoning, steering_history, client_suggestions, quality_flags,
        version, generation_revision, generation_provenance, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, 'client_review', ?, ?, ?, NULL, ?, 1, 9, ?, ?, ?)
    `).run(
      sectionId,
      pwless.workspaceId,
      entry!.id,
      `plan_${randomUUID().slice(0, 8)}`,
      'Client-safe generated copy.',
      'Client-safe annotation.',
      'PRIVATE_COPY_REASONING_SENTINEL',
      JSON.stringify([{ type: 'note', note: 'PRIVATE_COPY_STEERING_SENTINEL', resultVersion: 1, timestamp: now }]),
      JSON.stringify([{ type: 'guardrail_violation', message: 'PRIVATE_COPY_FLAG_SENTINEL', severity: 'warning' }]),
      JSON.stringify({
        runId: 'PRIVATE_COPY_RUN_SENTINEL',
        operation: 'copy-generation',
        provider: 'anthropic',
        model: 'private-model',
        inputFingerprint: 'a'.repeat(64),
        startedAt: now,
        completedAt: now,
      }),
      now,
      now,
    );
    const metadata = saveMetadata(entry!.id, pwless.workspaceId, {
      seoTitle: 'Client-safe SEO title',
      metaDescription: 'Client-safe meta description',
      ogTitle: 'Client-safe OG title',
      ogDescription: 'Client-safe OG description',
    });
    db.prepare('UPDATE copy_metadata SET steering_history = ? WHERE id = ?').run(
      JSON.stringify([{ type: 'note', note: 'PRIVATE_METADATA_STEERING_SENTINEL', resultVersion: 1, timestamp: now }]),
      metadata.id,
    );

    const res = await ctx.api(listUrl(pwless.workspaceId));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { deliverables: ClientDeliverable[] };
    const projected = body.deliverables.find((d) => d.id === `copy:${entry!.id}`);
    expect(projected).toBeTruthy();
    const payload = projected!.payload as {
      sections: Array<Record<string, unknown>>;
      copyMetadata: Record<string, unknown> | null;
    };
    expect(payload.sections[0]).toMatchObject({
      id: sectionId,
      generatedCopy: 'Client-safe generated copy.',
      aiAnnotation: 'Client-safe annotation.',
    });
    for (const privateKey of [
      'workspaceId',
      'aiReasoning',
      'qualityFlags',
      'steeringHistory',
      'generationRevision',
      'generationProvenance',
    ]) {
      expect(payload.sections[0]).not.toHaveProperty(privateKey);
    }
    expect(payload.copyMetadata).toMatchObject({ seoTitle: 'Client-safe SEO title' });
    expect(payload.copyMetadata).not.toHaveProperty('workspaceId');
    expect(payload.copyMetadata).not.toHaveProperty('steeringHistory');
    const raw = JSON.stringify(body);
    for (const sentinel of [
      'PRIVATE_COPY_REASONING_SENTINEL',
      'PRIVATE_COPY_STEERING_SENTINEL',
      'PRIVATE_COPY_FLAG_SENTINEL',
      'PRIVATE_COPY_RUN_SENTINEL',
      'PRIVATE_METADATA_STEERING_SENTINEL',
    ]) {
      expect(raw).not.toContain(sentinel);
    }
  });
});

describe('GET /api/public/deliverables/:workspaceId — auth', () => {
  it('401s unauthenticated on a password-protected workspace', async () => {
    const res = await ctx.api(listUrl(pw.workspaceId), {
      headers: { 'x-no-auto-public-auth': 'true' },
    });
    expect(res.status).toBe(401);
  });
});
