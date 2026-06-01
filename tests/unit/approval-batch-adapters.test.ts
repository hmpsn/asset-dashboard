import { describe, it, expect, afterEach } from 'vitest';
import db from '../../server/db/index.js';
import { getAdapter } from '../../server/domains/inbox/deliverable-adapters/types.js';
// Importing the barrel self-registers the five PR-1a adapters.
import '../../server/domains/inbox/deliverable-adapters/index.js';
import { upsertDeliverable, getDeliverable } from '../../server/client-deliverables.js';
import {
  auditCheckField,
  isAuditCheckApplyable,
} from '../../server/domains/inbox/deliverable-adapters/approval-batch-shared.js';
import { resolveAuditItemField } from '../../server/domains/inbox/deliverable-adapters/audit-issue.js';
import {
  classifyApprovalBatch,
  APPROVAL_BATCH_FAMILY_TYPES,
} from '../../server/domains/inbox/deliverable-adapters/approval-batch-classifier.js';
import type { ApprovalBatch, ApprovalItem } from '../../shared/types/approvals.js';
import type { DeliverableType } from '../../shared/types/client-deliverable.js';

const WS = 'approval-adapter-test';

afterEach(() => {
  db.prepare('DELETE FROM client_deliverable WHERE workspace_id = ?').run(WS);
});

function makeItem(over: Partial<ApprovalItem> = {}): ApprovalItem {
  return {
    id: `ai_${Math.random().toString(36).slice(2, 8)}`,
    pageId: 'page-1',
    pageTitle: 'Home',
    pageSlug: 'home',
    field: 'seoTitle',
    currentValue: 'old title',
    proposedValue: 'new title',
    status: 'pending',
    createdAt: '2026-06-01T00:00:00.000Z',
    updatedAt: '2026-06-01T00:00:00.000Z',
    ...over,
  };
}

function makeBatch(over: Partial<ApprovalBatch> = {}): ApprovalBatch {
  return {
    id: `ab_${Math.random().toString(36).slice(2, 8)}`,
    workspaceId: WS,
    siteId: 'site-1',
    name: 'SEO Changes',
    items: [makeItem()],
    status: 'pending',
    createdAt: '2026-06-01T00:00:00.000Z',
    updatedAt: '2026-06-01T00:00:00.000Z',
    ...over,
  };
}

describe('approval_batch adapters — registration', () => {
  it('registers all five family adapters via the barrel', () => {
    for (const type of APPROVAL_BATCH_FAMILY_TYPES) {
      const adapter = getAdapter(type as DeliverableType);
      expect(adapter.type).toBe(type);
      // Apply stays disabled this PR (D-apply) — no adapter opts in.
      expect(adapter.appliesOnApprove).toBeFalsy();
    }
  });
});

describe('approval_batch adapters — round-trip (build → store → parse → assert-no-fallback)', () => {
  // The payload schema in the store falls back to {} on a parse miss; assert the read-back
  // payload is the real object, not the empty fallback (the keywordStrategy.pageMap scar).
  it.each(APPROVAL_BATCH_FAMILY_TYPES)('round-trips %s with no payload fallback', (type) => {
    const adapter = getAdapter(type as DeliverableType);
    const batch = makeBatch({
      name: `batch for ${type}`,
      items: [
        makeItem({ field: 'seoTitle', proposedValue: 'T1' }),
        makeItem({ pageId: 'page-2', field: 'seoDescription', proposedValue: 'D1' }),
      ],
    });
    const built = adapter.buildPayload(batch);
    const sourceRef = adapter.sourceRef(batch);
    expect(sourceRef).toBe(`${type}:${batch.id}`);

    const stored = upsertDeliverable({
      workspaceId: WS,
      type: type as DeliverableType,
      kind: built.kind,
      status: 'awaiting_client',
      title: built.title,
      summary: built.summary ?? null,
      payload: built.payload,
      sourceRef,
      sentAt: '2026-06-01T00:00:00.000Z',
      items: built.items,
    });

    const got = getDeliverable(stored.id)!;
    expect(got.kind).toBe('batch');
    expect(got.type).toBe(type);
    // assert-no-fallback: the payload round-trips the real discriminators, not {}.
    expect(got.payload).not.toEqual({});
    expect(got.payload.family).toBe('approval_batch');
    expect(got.payload.subType).toBe(type);
    expect(got.payload.legacyBatchId).toBe(batch.id);
    // Items round-trip with target_ref = pageId.
    expect(got.items).toHaveLength(2);
    expect(got.items!.map((i) => i.targetRef)).toEqual(['page-1', 'page-2']);
    expect(got.items!.map((i) => i.sortOrder)).toEqual([0, 1]);
    // item_payload (heterogeneous extras) round-trips without fallback.
    expect(got.items![0].itemPayload).not.toBeNull();
    expect(got.items![0].itemPayload).toMatchObject({ legacyItemId: expect.any(String) });
  });

  it('validateSendable rejects an empty batch', () => {
    const adapter = getAdapter('seo_edit');
    expect(adapter.validateSendable(makeBatch({ items: [] }))).toEqual({
      ok: false,
      reason: 'approval batch has no items',
    });
    expect(adapter.validateSendable(makeBatch())).toEqual({ ok: true });
  });

  it('apply stub throws (apply is not wired this PR — D-apply)', async () => {
    const adapter = getAdapter('audit_issue');
    await expect(adapter.applyDeliverable!({} as never)).rejects.toThrow(/not wired until cutover/i);
  });
});

describe('B1 fix — audit_issue per-check field map', () => {
  it('maps title checks to seoTitle and meta-description checks to seoDescription', () => {
    expect(auditCheckField('title')).toBe('seoTitle');
    expect(auditCheckField('duplicate-title')).toBe('seoTitle');
    expect(auditCheckField('meta-description')).toBe('seoDescription');
    expect(auditCheckField('duplicate-description')).toBe('seoDescription');
  });

  it('returns null (NON-applyable) for EVERY non-meta check (the B1 kill)', () => {
    const nonMetaChecks = [
      'h1', 'h1-title-match', 'heading-hierarchy', 'dead-links', 'redirects',
      'redirect-chains', 'structured-data', 'img-alt', 'og-tags', 'og-image',
      'twitter-card', 'canonical', 'viewport', 'robots', 'robots-txt', 'sitemap',
      'ssl', 'mixed-content', 'lang', 'favicon', 'content-length', 'internal-links',
      'link-text', 'url', 'cwv-lab', 'render-blocking', 'indexability', 'orphan-pages',
    ];
    for (const check of nonMetaChecks) {
      expect(auditCheckField(check), `${check} must NOT map to a writable field`).toBeNull();
      expect(isAuditCheckApplyable(check), `${check} must be NON-applyable`).toBe(false);
    }
  });

  it('defaults UNKNOWN checks to NON-applyable (B1 safety default)', () => {
    expect(auditCheckField('some-future-check-we-have-not-enumerated')).toBeNull();
    expect(isAuditCheckApplyable('some-future-check-we-have-not-enumerated')).toBe(false);
  });

  it('resolveAuditItemField: a non-meta check carries the REAL field (null) + applyable=false', () => {
    // Post-cutover producer shape: item carries an explicit `check`.
    const h1Item = makeItem({ field: 'seoDescription', check: 'h1' } as Partial<ApprovalItem>);
    const resolved = resolveAuditItemField(h1Item);
    // The B1 collapse set field=seoDescription, but the adapter resolves the REAL field
    // from the check (h1 → null), so an approved H1 item can NEVER write the meta description.
    expect(resolved.field).toBeNull();
    expect(resolved.applyable).toBe(false);
  });

  it('resolveAuditItemField: a meta-description check resolves seoDescription (still non-applyable this PR)', () => {
    const metaItem = makeItem({ field: 'seoDescription', check: 'meta-description' } as Partial<ApprovalItem>);
    const resolved = resolveAuditItemField(metaItem);
    expect(resolved.field).toBe('seoDescription');
    expect(resolved.applyable).toBe(false); // D-apply keeps apply disabled this PR
  });

  it('resolveAuditItemField: legacy B1 shape (no check) does NOT trust a non-meta field', () => {
    // No `check` survived. A literal seoTitle/seoDescription is recorded as its field, but a
    // non-meta-looking collapsed field is recorded as null (never an unverified meta write).
    expect(resolveAuditItemField(makeItem({ field: 'seoTitle' }))).toEqual({ field: 'seoTitle', applyable: false });
    expect(resolveAuditItemField(makeItem({ field: 'seoDescription' }))).toEqual({ field: 'seoDescription', applyable: false });
    expect(resolveAuditItemField(makeItem({ field: 'something-weird' }))).toEqual({ field: null, applyable: false });
  });

  it('the audit_issue adapter stores applyable=false for a non-meta check item', () => {
    const adapter = getAdapter('audit_issue');
    const batch = makeBatch({
      name: '[Review] Missing H1 tag',
      items: [makeItem({ field: 'seoDescription', check: 'h1' } as Partial<ApprovalItem>)],
    });
    const built = adapter.buildPayload(batch);
    expect(built.items![0].applyable).toBe(false);
    expect(built.items![0].field).toBeNull();
  });
});

describe('approval_batch classifier (deterministic, total)', () => {
  it('classifies content-plan synthetic fields first', () => {
    expect(
      classifyApprovalBatch({ name: 'anything', items: [makeItem({ field: 'content_plan_sample' })] }),
    ).toBe('content_plan_sample');
    expect(
      classifyApprovalBatch({ name: 'anything', items: [makeItem({ field: 'content_plan_template' })] }),
    ).toBe('content_plan_template');
  });

  it('classifies [Review] name prefix as audit_issue', () => {
    expect(classifyApprovalBatch({ name: '[Review] Missing meta description', items: [makeItem()] })).toBe('audit_issue');
  });

  it('classifies Schema name prefix as schema_item', () => {
    expect(classifyApprovalBatch({ name: 'Schema Review — 3 pages', items: [makeItem()] })).toBe('schema_item');
  });

  it('defaults to seo_edit (SEO/CMS editor batches)', () => {
    expect(classifyApprovalBatch({ name: 'SEO Changes', items: [makeItem()] })).toBe('seo_edit');
    expect(classifyApprovalBatch({ name: 'SEO Editor — 2 pages', items: [makeItem()] })).toBe('seo_edit');
    expect(classifyApprovalBatch({ name: 'CMS Editor — blog', items: [makeItem()] })).toBe('seo_edit');
  });

  it('is total — every batch resolves to exactly one of the five family types', () => {
    const familySet = new Set<string>(APPROVAL_BATCH_FAMILY_TYPES);
    const samples = ['', 'random', 'schema', '[review] x', 'SEO Changes', 'CMS Editor'];
    for (const name of samples) {
      expect(familySet.has(classifyApprovalBatch({ name, items: [makeItem()] }))).toBe(true);
    }
  });
});
