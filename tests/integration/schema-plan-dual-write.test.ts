import { describe, it, expect, afterEach, afterAll } from 'vitest';
import db from '../../server/db/index.js';
// The barrel self-registers the schema_plan adapter the mirror resolves.
import '../../server/domains/inbox/deliverable-adapters/index.js';
import { mirrorSchemaPlanToDeliverable } from '../../server/domains/inbox/schema-plan-dual-write.js';
import { listDeliverables, upsertDeliverable } from '../../server/client-deliverables.js';
import { createWorkspace, deleteWorkspace } from '../../server/workspaces.js';
import type { SchemaSitePlan } from '../../shared/types/schema-plan.js';

// A real workspace (with a webflowSiteId) so the seam resolution mirrors production.
const ws = createWorkspace('schema-plan-dualwrite-test', 'site-sp-dw');
const WS = ws.id;
const SITE = 'site-sp-dw';

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
      { pagePath: '/', pageTitle: 'Home', role: 'homepage', primaryType: 'Organization', entityRefs: [] },
    ],
    status: 'sent_to_client',
    generatedAt: '2026-05-30T12:00:00.000Z',
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

describe('schema-plan dual-write mirror', () => {
  it('mirrors one schema_plan deliverable (kind review, externalRef = siteId)', () => {
    const mirrored = mirrorSchemaPlanToDeliverable(WS, makePlan());
    expect(mirrored).not.toBeNull();
    expect(mirrored!.type).toBe('schema_plan');
    expect(mirrored!.kind).toBe('review');
    expect(mirrored!.status).toBe('awaiting_client');
    expect(mirrored!.externalRef).toBe(SITE);
    expect(mirrored!.sourceRef).toBe(`schema_plan:${SITE}`);
    // generatedAt is the plan's own timestamp, not "now".
    expect(mirrored!.generatedAt).toBe('2026-05-30T12:00:00.000Z');
    expect(listDeliverables(WS)).toHaveLength(1);
  });

  it('is idempotent (two sends of the same site → one row)', () => {
    const first = mirrorSchemaPlanToDeliverable(WS, makePlan({ id: 'plan_v1' }));
    const second = mirrorSchemaPlanToDeliverable(WS, makePlan({ id: 'plan_v2' }));
    expect(second!.id).toBe(first!.id);
    expect(listDeliverables(WS)).toHaveLength(1);
  });

  it('rejects an empty plan via validateSendable (no row, no throw)', () => {
    const result = mirrorSchemaPlanToDeliverable(WS, makePlan({ pageRoles: [], canonicalEntities: [] }));
    expect(result).toBeNull();
    expect(listDeliverables(WS)).toHaveLength(0);
  });

  it('resolves parentDeliverableId when the schema_item deliverable exists', () => {
    const BATCH_ID = 'batch-dw';
    const parent = upsertDeliverable({
      workspaceId: WS,
      type: 'schema_item',
      kind: 'batch',
      status: 'awaiting_client',
      title: 'Schema Review',
      payload: { family: 'approval_batch', subType: 'schema_item' },
      sourceRef: `schema_item:${BATCH_ID}`,
    });
    const mirrored = mirrorSchemaPlanToDeliverable(WS, makePlan({ clientPreviewBatchId: BATCH_ID }));
    expect(mirrored!.parentDeliverableId).toBe(parent.id);
    expect(mirrored!.payload.clientPreviewBatchId).toBe(BATCH_ID);
  });

  it('leaves parentDeliverableId null when the schema_item batch is not mirrored', () => {
    const mirrored = mirrorSchemaPlanToDeliverable(WS, makePlan({ clientPreviewBatchId: 'unmirrored' }));
    expect(mirrored!.parentDeliverableId).toBeNull();
    // The raw soft-FK is stashed so linkage is never lost.
    expect(mirrored!.payload.clientPreviewBatchId).toBe('unmirrored');
  });
});
