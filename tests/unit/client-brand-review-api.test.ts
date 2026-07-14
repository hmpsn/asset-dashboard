import { afterEach, describe, expect, it, vi } from 'vitest';
import { publicDeliverables } from '../../src/api/deliverables';
import type { ClientBrandReviewDecisionReceipt } from '../../shared/types/brand-generation';

const receipt: ClientBrandReviewDecisionReceipt = {
  reviewDeliverableId: 'review-1',
  deliverableItemId: 'client-item-1',
  itemStatus: 'changes_requested',
  bundleStatus: 'partial',
};

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('publicDeliverables.respondToBrandReview', () => {
  it('uses the canonical respond URL with the strict item-level request body', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      statusText: 'OK',
      json: async () => receipt,
    });
    vi.stubGlobal('fetch', fetchMock);

    const body = {
      deliverableItemId: 'client-item-1',
      reviewToken: 'a'.repeat(64),
      decision: 'changes_requested' as const,
      note: 'Make the promise more concrete.',
    };
    const result = await publicDeliverables.respondToBrandReview('ws-1', 'review-1', body);

    expect(fetchMock).toHaveBeenCalledWith(
      '/api/public/deliverables/ws-1/review-1/respond',
      expect.objectContaining({
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      }),
    );
    expect(result).toEqual(receipt);
    expect(JSON.stringify(result)).not.toMatch(
      /runId|runRevision|generationItemRevision|sourceDeliverableVersion|decidedBy|generation-item|brand-deliverable/,
    );
  });
});
