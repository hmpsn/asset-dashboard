import { describe, it, expect } from 'vitest';
import { normalizeClientAction, normalizeApprovalBatch } from '../../src/lib/decision-adapters';
import type { ClientAction } from '../../shared/types/client-actions';
import type { ApprovalBatch } from '../../shared/types/approvals';

const baseAction: ClientAction = {
  id: 'ca-1',
  workspaceId: 'ws-1',
  sourceType: 'aeo_change',
  title: 'Update AEO answers',
  summary: '3 changes proposed',
  payload: { diffs: [{ page: '/about', current: 'old', proposed: 'new' }] },
  status: 'pending',
  priority: 'high',
  createdAt: '2026-05-01T00:00:00Z',
  updatedAt: '2026-05-01T00:00:00Z',
};

const baseBatch: ApprovalBatch = {
  id: 'ab-1',
  workspaceId: 'ws-1',
  siteId: 'site-1',
  name: 'SEO Editor — 5 pages',
  items: [
    {
      id: 'i1',
      pageId: 'p1',
      pageTitle: 'Home',
      pageSlug: '/',
      field: 'seoTitle',
      currentValue: 'Old',
      proposedValue: 'New',
      status: 'pending',
      createdAt: '2026-05-01T00:00:00Z',
      updatedAt: '2026-05-01T00:00:00Z',
    },
  ],
  status: 'pending',
  createdAt: '2026-05-01T00:00:00Z',
  updatedAt: '2026-05-01T00:00:00Z',
};

describe('normalizeClientAction', () => {
  it('produces id prefixed with ca-', () => {
    expect(normalizeClientAction(baseAction).id).toBe('ca-ca-1');
  });

  it('sets source to client_action', () => {
    expect(normalizeClientAction(baseAction).source).toBe('client_action');
  });

  it('preserves sourceId as original action id', () => {
    expect(normalizeClientAction(baseAction).sourceId).toBe('ca-1');
  });

  it('sets isSingleAction=false for aeo_change', () => {
    expect(normalizeClientAction(baseAction).isSingleAction).toBe(false);
  });

  it('sets isSingleAction=true for content_decay', () => {
    const decayAction = { ...baseAction, sourceType: 'content_decay' as const };
    expect(normalizeClientAction(decayAction).isSingleAction).toBe(true);
  });

  it('sets badge to "AEO" for aeo_change', () => {
    expect(normalizeClientAction(baseAction).badge).toBe('AEO');
  });

  it('sets badge to "Internal Links" for internal_link', () => {
    const linkAction = { ...baseAction, sourceType: 'internal_link' as const };
    expect(normalizeClientAction(linkAction).badge).toBe('Internal Links');
  });

  it('sets itemCount=1 for content_decay', () => {
    const decayAction = { ...baseAction, sourceType: 'content_decay' as const };
    expect(normalizeClientAction(decayAction).itemCount).toBe(1);
  });

  it('sets itemCount=3 for aeo_change with 3 diffs', () => {
    const action3 = {
      ...baseAction,
      payload: { diffs: [{}, {}, {}] },
    };
    expect(normalizeClientAction(action3 as ClientAction).itemCount).toBe(3);
  });

  it('sets priority from action', () => {
    expect(normalizeClientAction(baseAction).priority).toBe('high');
  });
});

describe('normalizeApprovalBatch', () => {
  it('produces id prefixed with ab-', () => {
    expect(normalizeApprovalBatch(baseBatch).id).toBe('ab-ab-1');
  });

  it('sets source to approval_batch', () => {
    expect(normalizeApprovalBatch(baseBatch).source).toBe('approval_batch');
  });

  it('sets isSingleAction=false', () => {
    expect(normalizeApprovalBatch(baseBatch).isSingleAction).toBe(false);
  });

  it('sets itemCount from total items', () => {
    const batch2 = {
      ...baseBatch,
      items: [
        { ...baseBatch.items[0], id: 'i1', status: 'pending' as const },
        { ...baseBatch.items[0], id: 'i2', status: 'applied' as const },
        { ...baseBatch.items[0], id: 'i3', status: 'pending' as const },
      ],
    };
    expect(normalizeApprovalBatch(batch2).itemCount).toBe(3);
  });

  it('sets badge based on batch name prefix', () => {
    expect(normalizeApprovalBatch(baseBatch).badge).toBe('SEO Editor');
  });

  it('sets badge to "Schema" for schema batches', () => {
    const schemaBatch = { ...baseBatch, name: 'Schema — 10 pages' };
    expect(normalizeApprovalBatch(schemaBatch).badge).toBe('Schema');
  });

  it('sets badge to "CMS" for CMS batches', () => {
    const cmsBatch = { ...baseBatch, name: 'CMS Editor — Blog collection' };
    expect(normalizeApprovalBatch(cmsBatch).badge).toBe('CMS');
  });
});
