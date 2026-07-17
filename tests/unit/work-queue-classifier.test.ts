import { describe, expect, it } from 'vitest';
import { classifyWorkQueue } from '../../server/domains/work-queue.js';
import { WORK_QUEUE_STREAMS } from '../../shared/types/work-queue.js';

describe('classifyWorkQueue', () => {
  it('buckets raw workspace-home inputs deterministically and keeps stream counts in parity', () => {
    const result = classifyWorkQueue({
      clientId: 'ws-queue',
      requests: [
        { id: 'req-1', status: 'new', title: 'Need help' },
        { id: 'req-2', status: 'closed', title: 'Done' },
      ],
      workOrders: [
        { id: 'wo-1', status: 'pending', productType: 'fix_meta', quantity: 1 },
        { id: 'wo-2', status: 'closed', productType: 'fix_alt', quantity: 1 },
      ],
      contentRequests: [
        { id: 'cr-1', status: 'requested', topic: 'Service area page', serviceType: 'brief_only' },
        { id: 'cr-2', status: 'pending_payment', topic: 'Full post package', serviceType: 'full_post' },
      ],
      ranks: [
        { keyword: 'alpha', change: -1, previousPosition: 4, position: 5 },
        { keyword: 'bravo', change: -2, previousPosition: 8, position: 10 },
        { keyword: 'charlie', change: -3, previousPosition: 11, position: 14 },
        { keyword: 'delta', change: -4, previousPosition: 16, position: 20 },
        { keyword: 'echo', change: 1, previousPosition: 6, position: 5 },
      ],
      contentDecay: { critical: 1, warning: 2, totalDecaying: 3, avgDeclinePct: 18.4 },
      audit: { errors: 7, warnings: 3, siteScore: 71 },
      contentPipeline: { reviewCells: 2 },
      setup: { webflowSiteId: 'site-1', gscPropertyUrl: null, ga4PropertyId: null, includeGaps: true },
      churnSignals: [{ id: 'risk-1', title: 'Client has not logged in', description: 'No activity in 30 days', severity: 'warning' }],
    });

    expect(result.items.map(item => [item.id, item.stream, item.sourceType])).toEqual([
      ['new-requests', 'unclassified', 'request'],
      ['open-work-orders', 'opt', 'work_order'],
      ['churn-risk-1', 'unclassified', 'churn_signal'],
      ['content-decay', 'opt', 'content_decay'],
      ['monetization-content', 'money', 'content_request'],
      ['pending-content', 'send', 'content_request'],
      ['seo-errors', 'opt', 'audit_error'],
      ['rank-drops', 'opt', 'rank_drop'],
      ['pipeline-review', 'send', 'content_pipeline'],
      ['setup-gsc', 'opt', 'setup_gap'],
      ['setup-ga4', 'opt', 'setup_gap'],
    ]);

    expect(result.streams).toEqual({
      opt: 6,
      send: 2,
      money: 1,
      unclassified: 2,
    });
    expect(result.items.find(item => item.id === 'monetization-content')).toEqual(expect.objectContaining({
      stream: 'money',
      title: '1 growth play to propose',
    }));

    for (const stream of WORK_QUEUE_STREAMS) {
      expect(result.streams[stream]).toBe(result.items.filter(item => item.stream === stream).length);
    }
  });
});
