import { describe, it, expect, afterEach } from 'vitest';
import db from '../../server/db/index.js';
import { getAdapter } from '../../server/domains/inbox/deliverable-adapters/types.js';
// Importing the barrel self-registers the PR-1c schema_plan adapter (+ the others).
import '../../server/domains/inbox/deliverable-adapters/index.js';
import type { SchemaPlanInput } from '../../server/domains/inbox/deliverable-adapters/schema-plan.js';
import { upsertDeliverable, getDeliverable } from '../../server/client-deliverables.js';
import type { SchemaSitePlan } from '../../shared/types/schema-plan.js';

const WS = 'schema-plan-adapter-test';
const SITE = 'site-sp-1';

afterEach(() => {
  db.prepare('DELETE FROM client_deliverable WHERE workspace_id = ?').run(WS);
});

function makePlan(over: Partial<SchemaSitePlan> = {}): SchemaSitePlan {
  return {
    id: `plan_${Math.random().toString(36).slice(2, 10)}`,
    siteId: SITE,
    workspaceId: WS,
    siteUrl: 'https://example.com',
    canonicalEntities: [
      { type: 'Organization', name: 'Example', canonicalUrl: 'https://example.com', id: 'https://example.com/#org' },
    ],
    pageRoles: [
      { pagePath: '/', pageTitle: 'Home', role: 'homepage', primaryType: 'Organization', entityRefs: ['https://example.com/#org'] },
      { pagePath: '/about', pageTitle: 'About', role: 'about', primaryType: 'AboutPage', entityRefs: [] },
    ],
    status: 'sent_to_client',
    generatedAt: '2026-05-30T12:00:00.000Z',
    updatedAt: '2026-06-01T00:00:00.000Z',
    ...over,
  };
}

function input(plan: SchemaSitePlan): SchemaPlanInput {
  return { plan };
}

describe('schema_plan adapter — registration', () => {
  it('is registered via the barrel as a review artifact with apply disabled (D-apply)', () => {
    const adapter = getAdapter('schema_plan');
    expect(adapter.type).toBe('schema_plan');
    // schema_plan client-approve does NOT auto-apply — operator publish is separate.
    expect(adapter.appliesOnApprove).toBeFalsy();
  });
});

describe('schema_plan adapter — round-trip (build → store → parse → assert-no-fallback)', () => {
  it('round-trips a plan as a review deliverable with externalRef + generatedAt, no fallback', () => {
    const adapter = getAdapter('schema_plan');
    const plan = makePlan();
    const inp = input(plan);

    expect(adapter.validateSendable(inp)).toEqual({ ok: true });

    const built = adapter.buildPayload(inp);
    const sourceRef = adapter.sourceRef(inp);
    expect(built.kind).toBe('review'); // schema strategy is a review artifact
    expect(built.externalRef).toBe(SITE); // externalRef = siteId
    expect(built.items).toBeUndefined(); // per-page markup is the schema_item family, not here

    const stored = upsertDeliverable({
      workspaceId: WS,
      type: 'schema_plan',
      kind: built.kind,
      status: 'awaiting_client',
      title: built.title,
      summary: built.summary ?? null,
      payload: built.payload,
      externalRef: built.externalRef ?? null,
      parentDeliverableId: built.parentDeliverableId ?? null,
      sourceRef,
      sentAt: '2026-06-01T00:00:00.000Z',
      generatedAt: plan.generatedAt, // carried from the plan, not "now"
    });

    const got = getDeliverable(stored.id)!;
    expect(got.type).toBe('schema_plan');
    expect(got.kind).toBe('review');
    expect(got.externalRef).toBe(SITE);
    // generatedAt is the PLAN's timestamp, carried through.
    expect(got.generatedAt).toBe('2026-05-30T12:00:00.000Z');
    // assert-no-fallback: the payload round-trips the real content, not {}.
    expect(got.payload).not.toEqual({});
    expect(got.payload.family).toBe('schema_plan');
    expect(got.payload.siteId).toBe(SITE);
    expect(got.payload.legacyPlanId).toBe(plan.id);
    expect(Array.isArray(got.payload.pageRoles)).toBe(true);
    expect((got.payload.pageRoles as unknown[]).length).toBe(2);
    expect(Array.isArray(got.payload.canonicalEntities)).toBe(true);
    expect((got.payload.canonicalEntities as unknown[]).length).toBe(1);
    // No typed child items written for this type.
    expect(got.items ?? []).toHaveLength(0);
  });
});

describe('schema_plan adapter — sourceRef (stable per-site)', () => {
  it('sourceRef → schema_plan:<siteId>', () => {
    expect(getAdapter('schema_plan').sourceRef(input(makePlan()))).toBe(`schema_plan:${SITE}`);
  });

  it('sourceRef is null when the plan has no siteId', () => {
    expect(getAdapter('schema_plan').sourceRef(input(makePlan({ siteId: '' })))).toBeNull();
  });

  it('sourceRef is STABLE across two sends of the same site → dedupes to one row', () => {
    const adapter = getAdapter('schema_plan');
    // Two distinct plan generations (different legacy ids) for the SAME site.
    const p1 = makePlan({ id: 'plan_v1', generatedAt: '2026-05-30T12:00:00.000Z' });
    const p2 = makePlan({ id: 'plan_v2', generatedAt: '2026-05-31T12:00:00.000Z' });
    expect(adapter.sourceRef(input(p1))).toBe(adapter.sourceRef(input(p2)));

    const store = (plan: SchemaSitePlan) => {
      const built = adapter.buildPayload(input(plan));
      return upsertDeliverable({
        workspaceId: WS,
        type: 'schema_plan',
        kind: built.kind,
        status: 'awaiting_client',
        title: built.title,
        summary: built.summary ?? null,
        payload: built.payload,
        externalRef: built.externalRef ?? null,
        sourceRef: adapter.sourceRef(input(plan)),
        generatedAt: plan.generatedAt,
      });
    };
    const first = store(p1);
    const second = store(p2);
    expect(second.id).toBe(first.id); // deduped onto one row
    const rows = db
      .prepare('SELECT COUNT(*) AS n FROM client_deliverable WHERE workspace_id = ? AND type = ?')
      .get(WS, 'schema_plan') as { n: number };
    expect(rows.n).toBe(1);
  });
});

describe('schema_plan adapter — validateSendable', () => {
  it('rejects an empty plan (no pageRoles and no canonicalEntities)', () => {
    const empty = makePlan({ pageRoles: [], canonicalEntities: [] });
    expect(getAdapter('schema_plan').validateSendable(input(empty))).toEqual({
      ok: false,
      reason: 'schema plan is empty (no pageRoles or canonicalEntities to review)',
    });
  });

  it('a plan with pageRoles but no entities IS sendable', () => {
    const onlyRoles = makePlan({ canonicalEntities: [] });
    expect(getAdapter('schema_plan').validateSendable(input(onlyRoles))).toEqual({ ok: true });
  });

  it('a plan with entities but no pageRoles IS sendable', () => {
    const onlyEntities = makePlan({ pageRoles: [] });
    expect(getAdapter('schema_plan').validateSendable(input(onlyEntities))).toEqual({ ok: true });
  });
});

describe('schema_plan adapter — parentDeliverableId resolution (soft-FK to schema_item)', () => {
  it('resolves parentDeliverableId when the schema_item deliverable exists', () => {
    const BATCH_ID = 'batch-xyz';
    // Mirror the schema_item deliverable the plan links to (sourceRef = schema_item:<batchId>).
    const parent = upsertDeliverable({
      workspaceId: WS,
      type: 'schema_item',
      kind: 'batch',
      status: 'awaiting_client',
      title: 'Schema Review',
      payload: { family: 'approval_batch', subType: 'schema_item' },
      sourceRef: `schema_item:${BATCH_ID}`,
    });

    const built = getAdapter('schema_plan').buildPayload(input(makePlan({ clientPreviewBatchId: BATCH_ID })));
    expect(built.parentDeliverableId).toBe(parent.id);
    // The raw soft-FK is ALSO stashed in payload (survives even when resolved).
    expect(built.payload.clientPreviewBatchId).toBe(BATCH_ID);
  });

  it('leaves parentDeliverableId null when the schema_item deliverable is not mirrored yet', () => {
    // Expected while dark: the schema_item batch is not yet in client_deliverable.
    const built = getAdapter('schema_plan').buildPayload(input(makePlan({ clientPreviewBatchId: 'unmirrored-batch' })));
    expect(built.parentDeliverableId).toBeNull();
    // The raw id is stashed so the linkage is never lost (re-resolvable at cutover).
    expect(built.payload.clientPreviewBatchId).toBe('unmirrored-batch');
  });

  it('parentDeliverableId is null and the stash is null when the plan has no clientPreviewBatchId', () => {
    const built = getAdapter('schema_plan').buildPayload(input(makePlan({ clientPreviewBatchId: undefined })));
    expect(built.parentDeliverableId).toBeNull();
    expect(built.payload.clientPreviewBatchId).toBeNull();
  });
});

describe('schema_plan adapter — apply stays disabled (D-apply)', () => {
  it('apply stub throws (client approve does NOT auto-publish; operator publish is separate)', async () => {
    const adapter = getAdapter('schema_plan');
    await expect(adapter.applyDeliverable!({} as never)).rejects.toThrow(
      /separate operator transition|D-apply|does NOT auto-publish/i,
    );
  });
});
