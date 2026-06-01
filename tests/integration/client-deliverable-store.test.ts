import { describe, it, expect, afterAll } from 'vitest';
import db from '../../server/db/index.js';
import {
  upsertDeliverable,
  getDeliverable,
  listDeliverables,
} from '../../server/client-deliverables.js';

const WS = 'cd-store-test';

afterAll(() => {
  db.prepare('DELETE FROM client_deliverable WHERE workspace_id = ?').run(WS);
});

describe('client_deliverable store round-trip', () => {
  it('persists and reads back every field with no fallback', () => {
    const d = upsertDeliverable({
      workspaceId: WS,
      type: 'redirect',
      kind: 'decision',
      status: 'awaiting_client',
      title: 'Redirect proposal',
      summary: 'Two redirects to review',
      payload: { redirects: [{ source: '/a', target: '/b' }] },
      note: 'please review',
      sourceRef: 'redirect:site-1',
      source: 'redirect-manager',
      sentAt: '2026-06-01T00:00:00.000Z',
      dueAt: '2026-06-08T00:00:00.000Z',
      generatedAt: '2026-06-01T00:00:00.000Z',
    });
    const got = getDeliverable(d.id)!;
    expect(got).toBeDefined();
    expect(got.workspaceId).toBe(WS);
    expect(got.type).toBe('redirect');
    expect(got.kind).toBe('decision');
    expect(got.status).toBe('awaiting_client');
    expect(got.title).toBe('Redirect proposal');
    expect(got.summary).toBe('Two redirects to review');
    // payload must survive the JSON round-trip with NO fallback (the keywordStrategy.pageMap scar).
    expect(got.payload).toEqual({ redirects: [{ source: '/a', target: '/b' }] });
    expect(got.note).toBe('please review');
    expect(got.sourceRef).toBe('redirect:site-1');
    expect(got.source).toBe('redirect-manager');
    expect(got.sentAt).toBe('2026-06-01T00:00:00.000Z');
    expect(got.dueAt).toBe('2026-06-08T00:00:00.000Z');
    expect(got.generatedAt).toBe('2026-06-01T00:00:00.000Z');
    expect(got.createdAt).toBeTruthy();
    expect(got.updatedAt).toBeTruthy();
  });

  it('round-trips child items with typed columns and item_payload JSON (no fallback)', () => {
    const d = upsertDeliverable({
      workspaceId: WS,
      type: 'audit_issue',
      kind: 'batch',
      status: 'awaiting_client',
      title: 'Audit issues',
      payload: { checkCount: 1 },
      sourceRef: 'audit_issue:batch-1',
      items: [
        {
          status: 'pending',
          targetRef: 'page-1',
          collectionId: null,
          field: 'seoTitle',
          currentValue: 'Old title',
          proposedValue: 'New title',
          clientValue: null,
          clientNote: null,
          applyable: true,
          itemPayload: { check: 'title-length', severity: 'high' },
          sortOrder: 0,
        },
      ],
    });
    const got = getDeliverable(d.id)!;
    expect(got.items).toHaveLength(1);
    const item = got.items![0];
    expect(item.targetRef).toBe('page-1');
    expect(item.field).toBe('seoTitle');
    expect(item.currentValue).toBe('Old title');
    expect(item.proposedValue).toBe('New title');
    expect(item.applyable).toBe(true);
    expect(item.itemPayload).toEqual({ check: 'title-length', severity: 'high' });
    expect(item.sortOrder).toBe(0);
    expect(item.createdAt).toBeTruthy();
  });

  it('dedups on (workspace, type, source_ref): resend updates the same row', () => {
    const first = upsertDeliverable({
      workspaceId: WS,
      type: 'internal_link',
      kind: 'decision',
      status: 'awaiting_client',
      title: 'Internal links v1',
      payload: { links: [] },
      sourceRef: 'internal_link:site-2',
    });
    const second = upsertDeliverable({
      workspaceId: WS,
      type: 'internal_link',
      kind: 'decision',
      status: 'awaiting_client',
      title: 'Internal links v2',
      payload: { links: [{ from: '/x', to: '/y' }] },
      sourceRef: 'internal_link:site-2',
    });
    expect(second.id).toBe(first.id);
    const got = getDeliverable(first.id)!;
    expect(got.title).toBe('Internal links v2');
    expect(got.payload).toEqual({ links: [{ from: '/x', to: '/y' }] });
  });

  it('listDeliverables returns the workspace rows', () => {
    const rows = listDeliverables(WS);
    expect(rows.length).toBeGreaterThanOrEqual(1);
    const foreign = rows.filter((r) => r.workspaceId !== WS);
    expect(foreign).toHaveLength(0);
  });
});
