import { describe, it, expect } from 'vitest';
import { cannibalizationAdapter } from '../../server/domains/inbox/deliverable-adapters/cannibalization';
import type { ClientAction } from '../../shared/types/client-actions';

const action = (over: Partial<ClientAction> = {}): ClientAction => ({
  id: 'ca_1', workspaceId: 'ws1', sourceType: 'cannibalization',
  title: 'Keyword cannibalization', summary: 'Consolidate to the primary page.',
  status: 'pending', priority: 'medium', createdAt: '', updatedAt: '',
  payload: {
    keyword: 'best crm',
    pages: [{ path: '/crm', position: 3 }, { path: '/blog/crm-guide', position: 11 }],
    recommendation: 'Consolidate to the primary page.',
    canonicalPath: '/crm',
    metadata: { origin: { targetKeyword: 'best crm', pageUrl: '/crm' } },
  },
  ...over,
});

describe('cannibalizationAdapter', () => {
  it('is the cannibalization deliverable type', () => {
    expect(cannibalizationAdapter.type).toBe('cannibalization');
  });

  it('rejects a send with no origin targetKeyword', () => {
    // payload without metadata.origin → not sendable (mirrors content_decay's B13 guard).
    const a = action({ payload: { keyword: 'x', pages: [], recommendation: 'r' } });
    expect(cannibalizationAdapter.validateSendable({ action: a, siteId: null }).ok).toBe(false);
  });

  it('accepts a send that carries a targetKeyword', () => {
    expect(cannibalizationAdapter.validateSendable({ action: action(), siteId: null }).ok).toBe(true);
  });

  it('builds a decision-kind payload with the issue as the single item', () => {
    const built = cannibalizationAdapter.buildPayload({ action: action(), siteId: null });
    expect(built.kind).toBe('decision');
    const payload = built.payload as { subType: string; items: Array<{ keyword: string; canonicalPath?: string }> };
    expect(payload.subType).toBe('cannibalization');
    expect(payload.items).toHaveLength(1);
    expect(payload.items[0].keyword).toBe('best crm');
    expect(payload.items[0].canonicalPath).toBe('/crm');
  });

  it('keys sourceRef on the stable per-keyword id', () => {
    expect(cannibalizationAdapter.sourceRef({ action: action(), siteId: null })).toBe('cannibalization:best crm');
  });

  it('opts out of apply (manual operator action — apply stub throws)', async () => {
    expect(cannibalizationAdapter.appliesOnApprove).toBeFalsy();
    await expect(cannibalizationAdapter.applyDeliverable?.({} as never)).rejects.toThrow();
  });
});
